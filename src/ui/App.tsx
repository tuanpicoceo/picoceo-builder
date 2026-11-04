import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { buildInWorker } from '../cad/client';
import { voicePartsFor, type VoiceSpec } from '../cad/voicecore';
import type { Assembly } from '../cad/types';
import { familyOf, patternComposition, withPattern } from '../design/patterns';
import { CATALOG, type ComponentDirectory, getDefaultComponentDirectory, getDirectoryTotals, platformOf } from '../catalog/components';
import { KIT_LIMITS, analyze } from '../design/analysis';
import { behaviorsFor, jointLimits } from '../design/behaviors';
import { localPlan } from '../design/localPlanner';
import { buildSevenStepReport, fetchAiDesignStep, fetchAiRefine, fetchSegmentation, fetchVisualReferences, freeformRetry, segmentConcepts, isComposed, shoppingList, wantsNewDesign, withBuyRule, withFreeform, withToBuy, type AiStepOutputs, type ReferenceImage, type StepNumber, type VisualRefs } from '../design/pipeline';
import { defaultSpec, normalizeSpec, VOICE_PLATFORMS, type RobotSpec } from '../design/spec';
import { DEFAULT_RL_POLICY, type RLPolicyParams } from '../sim/rl';
import {
  type CloudProject,
  deleteProjectFromFirestore,
  isFirebaseConfigured,
  loadUserProfileFromFirestore,
  saveProjectToFirestore,
  saveUserDirectoryToFirestore,
  signInWithGoogle,
  signOutFirebase,
  subscribeAuthState,
  subscribeProjectsFromFirestore,
} from '../firebase/client';
import { AuthModal } from './AuthModal';
import { Chat, type ChatMsg } from './Chat';
import { DirectoryModal } from './DirectoryModal';
import { BomTab, Inspector, PrintTab, WiringTab, type Tab as InspectorTab } from './Inspector';
import { CodeEditor } from './CodeEditor';
import { MenuBar, type MenuItem } from './MenuBar';
import { LoginScreen } from './LoginScreen';
import { download, slug, threeMF } from '../export/files';
import { strToU8 } from 'fflate';
import { Viewport } from './Viewport';
import { Landing } from './Landing';
import { BuildTheatre } from './BuildTheatre';
import { RevealCard, readinessOf } from './RevealCard';
import { DesignEditor } from './DesignEditor';
import { BrainPhase } from './BrainPanel';

type Phase = 1 | 2 | 3;
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const LS = 'cyberbuild.project.v1';
const LS_INV = 'cyberbuild.inventory.v1';
const LS_RL = 'cyberbuild.rl_policy.latest';

interface Version { spec: RobotSpec; label: string; at: number }

/**
 * Dev-server only (`npm run dev`, then open /?preview): a stand-in local user so the UI can be exercised without
 * Google sign-in. Nothing is synced to the cloud. `import.meta.env.DEV` is false in production builds, so this
 * branch is removed there.
 */
const LOCAL_PREVIEW = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('preview');

function load(): { id: string; createdAt: number; spec: RobotSpec; versions: Version[]; chat: ChatMsg[]; hasDesign: boolean; aiSteps?: AiStepOutputs } | null {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return null;
    const j = JSON.parse(raw);
    const chat: ChatMsg[] = j.chat ?? [];
    const hasDesign = typeof j.hasDesign === 'boolean' ? j.hasDesign : chat.some(m => m.role === 'assistant' && m.spec);
    return {
      id: typeof j.id === 'string' && j.id ? j.id : crypto.randomUUID(),
      createdAt: typeof j.createdAt === 'number' ? j.createdAt : Date.now(),
      spec: normalizeSpec(j.spec).spec,
      versions: j.versions ?? [],
      chat,
      hasDesign,
      aiSteps: j.aiSteps ?? {},
    };
  } catch { return null; }
}

function loadInventory(): ComponentDirectory {
  try {
    const raw = localStorage.getItem(LS_INV);
    if (raw) return JSON.parse(raw);
  } catch { /* fallback */ }
  return getDefaultComponentDirectory('cyberbrick', 1);
}

export function App() {
  const saved = useMemo(load, []);
  const [projectId, setProjectId] = useState<string>(() => saved?.id ?? crypto.randomUUID());
  const [projectCreatedAt, setProjectCreatedAt] = useState<number>(() => saved?.createdAt ?? Date.now());
  const [spec, setSpecRaw] = useState<RobotSpec>(saved?.spec ?? defaultSpec('rover'));
  const [hasDesign, setHasDesign] = useState<boolean>(saved?.hasDesign ?? false);
  const [versions, setVersions] = useState<Version[]>(saved?.versions ?? []);
  const [chat, setChat] = useState<ChatMsg[]>(saved?.chat ?? []);
  const [inventory, setInventory] = useState<ComponentDirectory>(loadInventory);
  const [showDirectory, setShowDirectory] = useState(false);
  const [built, setBuilt] = useState<{ spec: RobotSpec; asm: Assembly } | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [activeStep, setActiveStep] = useState<StepNumber | null>(null);
  const [aiSteps, setAiSteps] = useState<AiStepOutputs>(saved?.aiSteps ?? {});
  const [phase, setPhaseRaw] = useState<Phase>(() => { try { const p = localStorage.getItem('cyberbuild.phase'); return p === '2' ? 2 : p === '3' ? 3 : 1; } catch { return 1; } });
  const setPhase = (p: Phase) => { setPhaseRaw(p); try { localStorage.setItem('cyberbuild.phase', String(p)); } catch { /* blocked */ } };
  const [theme, setThemeRaw] = useState<'dark' | 'light'>(() => { try { return localStorage.getItem('cyberbuild.theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  const setTheme = (t: 'dark' | 'light') => { setThemeRaw(t); try { localStorage.setItem('cyberbuild.theme', t); } catch { /* blocked */ } };
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  // creation flow: build theatre, reveal and the direct design editor
  const [theatre, setTheatre] = useState<{ run: number; prompt: string; refs: VisualRefs | null; offline: boolean; running: boolean } | null>(null);
  const [revealSeq, setRevealSeq] = useState(0);
  const [showReveal, setShowReveal] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFocus, setEditorFocus] = useState<string | null>(null);
  const runRef = useRef(0);                 // bumped by Stop: a running flow checks it after every await
  const pendingReveal = useRef(false);      // the next assembly that lands plays the reveal
  const [searchRefs, setSearchRefsRaw] = useState<boolean>(() => { try { return localStorage.getItem('cyberbuild.search_refs') !== '0'; } catch { return true; } });
  const setSearchRefs = (v: boolean) => { setSearchRefsRaw(v); try { localStorage.setItem('cyberbuild.search_refs', v ? '1' : '0'); } catch { /* blocked */ } };
  // "Free-form design only": the AI must compose every robot itself instead of picking a prebuilt CAD type
  // Generic by default: on unless the user turned it off in the Tools menu.
  const [freeform, setFreeformRaw] = useState<boolean>(() => { try { return localStorage.getItem('cyberbuild.freeform') !== '0'; } catch { return true; } });
  const setFreeform = (v: boolean) => { setFreeformRaw(v); try { localStorage.setItem('cyberbuild.freeform', v ? '1' : '0'); } catch { /* blocked */ } };
  // "Use any parts": the AI fulfils every feature with whatever parts it needs and the user buys what the Directory
  // lacks. `toBuy` (the current design's shopping list) tops the Directory up for the CAD and the later AI steps.
  // "use any parts" is on by default; only an explicit untick (stored '0') turns it off
  const [buyAny, setBuyAnyRaw] = useState<boolean>(() => { try { return localStorage.getItem('cyberbuild.buy_missing') !== '0'; } catch { return true; } });
  const setBuyAny = (v: boolean) => { setBuyAnyRaw(v); try { localStorage.setItem('cyberbuild.buy_missing', v ? '1' : '0'); } catch { /* blocked */ } };
  const [toBuy, setToBuyRaw] = useState<ComponentDirectory>(() => { try { return JSON.parse(localStorage.getItem('cyberbuild.to_buy.v1') || '{}'); } catch { return {}; } });
  const setToBuy = (d: ComponentDirectory) => { setToBuyRaw(d); try { localStorage.setItem('cyberbuild.to_buy.v1', JSON.stringify(d)); } catch { /* blocked */ } };
  const planInventory = useMemo(() => withToBuy(inventory, toBuy), [inventory, toBuy]);
  const [phase2Tab, setPhase2Tab] = useState<'print' | 'code' | 'wiring' | 'bom'>('print');
  const [drawer, setDrawer] = useState(false);
  const [drawerTab, setDrawerTab] = useState<{ tab: InspectorTab; seq: number } | null>(null);
  const openDrawer = (tab: InspectorTab) => { setEditorOpen(false); setDrawer(true); setDrawerTab(p => ({ tab, seq: (p?.seq ?? 0) + 1 })); };
  const [refImage, setRefImage] = useState<ReferenceImage | undefined>(undefined);
  const [externalFlowStep, setExternalFlowStep] = useState<{ step: StepNumber | 'all'; seq: number } | null>(null);
  const [externalViewportMode, setExternalViewportMode] = useState<{ mode: 'assembly' | 'print' | 'sim'; behavior?: string; seq: number } | null>(null);
  const [ai, setAi] = useState<{ ai: boolean; provider?: string; model?: string } | null>(null);
  const [aiMode, setAiMode] = useState<'auto' | 'offline'>('auto');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([]);
  const [fbConfigVersion, setFbConfigVersion] = useState(0);
  const [rlPolicy, setRlPolicyRaw] = useState<RLPolicyParams>(() => {
    try {
      const k = saved?.spec?.name ? `cyberbuild.rl_policy.${saved.spec.name}` : LS_RL;
      const raw = localStorage.getItem(k) || localStorage.getItem(LS_RL);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { ...DEFAULT_RL_POLICY };
  });
  const [lastFirmwarePolicy, setLastFirmwarePolicy] = useState<RLPolicyParams | null>(null);

  const setRlPolicy = useCallback((p: RLPolicyParams) => {
    setRlPolicyRaw(p);
    try {
      localStorage.setItem(LS_RL, JSON.stringify(p));
      if (spec?.name) {
        localStorage.setItem(`cyberbuild.rl_policy.${spec.name}`, JSON.stringify(p));
      }
    } catch {}
  }, [spec?.name]);

  const handleUpdateFirmware = useCallback((policyToCompile?: RLPolicyParams) => {
    const pol = policyToCompile ?? rlPolicy;
    setLastFirmwarePolicy({ ...pol });
  }, [rlPolicy]);

  const debounce = useRef<number>(0);
  // Electronics platform follows the Directory (LicheeRV Claw kit vs CyberBrick); every CAD build carries it.
  // (The Directory plus the parts the design will buy: the board itself is never bought over the user's own.)
  const platform = useMemo(() => platformOf(planInventory), [planInventory]);
  // the CAD only sees the spec: pass the platform and, for voice cores (XiaoZhi / Pi / Jetson), the Directory's parts
  const withPlatform = useCallback((s: RobotSpec): RobotSpec => (platform === 'cyberbrick'
    ? { ...s, platform: undefined }
    : { ...s, platform, voice: voicePartsFor(platform, planInventory) } as VoiceSpec), [platform, planInventory]);
  const importRef = useRef<HTMLInputElement>(null);
  const cloudSaveTimer = useRef<number>(0);
  const invSaveTimer = useRef<number>(0);

  const refreshAiStatus = useCallback(() => {
    fetch('/api/health')
      .then(r => {
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return r.json();
      })
      .then(setAi)
      .catch(() => setAi({ ai: false }));
  }, []);

  useEffect(() => {
    refreshAiStatus();
  }, [refreshAiStatus]);

  // Subscribe to Firebase Google Auth state & Cloud Firestore projects
  useEffect(() => {
    if (LOCAL_PREVIEW) {
      setUser({ uid: 'local-preview', email: 'preview@localhost', displayName: 'Local preview' } as User);
      setAuthLoading(false);
      return;
    }
    if (!isFirebaseConfigured()) {
      setUser(null);
      setAuthLoading(false);
      return;
    }
    let unsubProjects: (() => void) | null = null;
    const unsubAuth = subscribeAuthState(async u => {
      setUser(u);
      setAuthLoading(false);
      if (unsubProjects) {
        unsubProjects();
        unsubProjects = null;
      }
      if (!u) {
        setNeedsOnboarding(false);
        setCloudProjects([]);
        setCloudStatus('idle');
        return;
      }
      const onboardedFlag = localStorage.getItem(`cyberbuild.onboarded.v1.${u.uid}`);
      if (!onboardedFlag) {
        setNeedsOnboarding(true);
      }
      setCloudStatus('syncing');
      try {
        const profile = await loadUserProfileFromFirestore(u.uid);
        if (profile?.inventory) {
          setInventory(profile.inventory);
        }
        setCloudStatus('synced');
        setCloudError(null);
      } catch (e) {
        setCloudStatus('error');
        setCloudError((e as Error).message);
      }
      unsubProjects = subscribeProjectsFromFirestore(u.uid, projects => setCloudProjects(projects));
    });
    return () => {
      unsubAuth();
      if (unsubProjects) unsubProjects();
    };
  }, [fbConfigVersion]);

  // Auto-save active project to Cloud Firestore when signed in
  useEffect(() => {
    if (!user || LOCAL_PREVIEW) return;
    window.clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = window.setTimeout(async () => {
      setCloudStatus('syncing');
      try {
        await saveProjectToFirestore(user, {
          id: projectId,
          uid: user.uid,
          name: spec.name || 'Untitled Robot',
          spec,
          hasDesign,
          versions,
          chat,
          aiSteps,
          createdAt: projectCreatedAt,
          updatedAt: Date.now(),
        });
        setCloudStatus('synced');
        setCloudError(null);
      } catch (e) {
        setCloudStatus('error');
        setCloudError((e as Error).message);
      }
    }, 800);
    return () => window.clearTimeout(cloudSaveTimer.current);
  }, [user, projectId, projectCreatedAt, spec, hasDesign, versions, chat, aiSteps]);

  // Auto-save component directory to Cloud Firestore when signed in
  useEffect(() => {
    if (!user || LOCAL_PREVIEW) return;
    window.clearTimeout(invSaveTimer.current);
    invSaveTimer.current = window.setTimeout(async () => {
      try {
        await saveUserDirectoryToFirestore(user, inventory, projectId);
      } catch (e) {
        setCloudStatus('error');
        setCloudError((e as Error).message);
      }
    }, 900);
    return () => window.clearTimeout(invSaveTimer.current);
  }, [user, inventory, projectId]);

  // rebuild CAD whenever the spec changes (debounced for slider drags), only when a design exists
  useEffect(() => {
    window.clearTimeout(debounce.current);
    if (!hasDesign) {
      setBuilt(null);
      setBuilding(false);
      setBuildError(null);
      return;
    }
    debounce.current = window.setTimeout(() => {
      setBuilding(true);
      const s = withPlatform(spec);
      buildInWorker(s)
        .then(asm => { setBuilt({ spec: s, asm }); setBuildError(null); })
        .catch(e => setBuildError(String(e.message ?? e)))
        .finally(() => setBuilding(false));
    }, 220);
  }, [spec, hasDesign, withPlatform]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS,
        JSON.stringify({
          id: projectId,
          createdAt: projectCreatedAt,
          spec,
          hasDesign,
          versions: versions.slice(-30),
          chat: chat.slice(-60),
          aiSteps,
        }),
      );
    } catch { /* storage full or blocked */ }
  }, [projectId, projectCreatedAt, spec, hasDesign, versions, chat, aiSteps]);

  useEffect(() => {
    try { localStorage.setItem(LS_INV, JSON.stringify(inventory)); } catch { /* storage full or blocked */ }
  }, [inventory]);

  const analysis = useMemo(() => (built ? analyze(built.spec, built.asm, inventory) : null), [built, inventory]);
  const behaviors = useMemo(() => built ? behaviorsFor(built.spec, { trackMm: built.asm.meta.trackMm ?? 80, topSpeed: analysis?.totals.topSpeed ?? 0.15 }, jointLimits(built.asm)) : [], [built, analysis]);
  const totalStockCount = useMemo(() => getDirectoryTotals(inventory).totalItems, [inventory]);

  const latestAssistant = useMemo(() => {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].role === 'assistant' && chat[i].spec) return chat[i];
    }
    return null;
  }, [chat]);

  const latestUserPrompt = useMemo(() => {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].role === 'user') return chat[i].text;
    }
    return '';
  }, [chat]);

  const flowReport = useMemo(
    () =>
      built
        ? buildSevenStepReport(
            built.spec,
            built.asm,
            inventory,
            latestUserPrompt,
            latestAssistant?.text ?? '',
            latestAssistant?.fixes ?? [],
            aiSteps,
            lastFirmwarePolicy ?? rlPolicy,
          )
        : null,
    [built, inventory, latestUserPrompt, latestAssistant, aiSteps, lastFirmwarePolicy, rlPolicy],
  );

  /** Set the design; with a label it becomes a version. `coalesce` merges rapid edits with the same label (slider drags). */
  const setSpec = useCallback((s: RobotSpec, label?: string, coalesce = false) => {
    setSpecRaw(s);
    setHasDesign(true);
    if (label) setVersions(v => {
      const last = v[v.length - 1];
      if (coalesce && last && last.label === label && Date.now() - last.at < 2500) return [...v.slice(0, -1), { spec: s, label, at: Date.now() }];
      return [...v, { spec: s, label, at: Date.now() }].slice(-30);
    });
  }, []);

  const undo = useCallback(() => {
    if (versions.length < 2) return;
    setSpecRaw(versions[versions.length - 2].spec);
    setVersions(v => v.slice(0, -1));
  }, [versions]);

  // the first assembly of a new design plays the reveal (parts fly in, then a turntable spin)
  useEffect(() => {
    if (built && pendingReveal.current) { pendingReveal.current = false; setRevealSeq(n => n + 1); }
  }, [built]);

  const cancelRun = useCallback(() => {
    runRef.current++;
    pendingReveal.current = false;
    setThinking(false);
    setActiveStep(null);
    setTheatre(null);
    setChat(c => [...c, { id: crypto.randomUUID(), role: 'assistant', kind: 'system', text: 'Stopped. The design on screen is kept; send a message to continue.', at: Date.now() }]);
  }, []);

  const send = useCallback(async (prompt: string, image?: ReferenceImage, opts?: { truncateAt?: number }) => {
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    const activeImage = image ?? refImage;
    if (image) setRefImage(image);
    // edit-and-resend: drop that message and everything after it, and go back to the design it was sent against
    const baseChat = opts?.truncateAt != null ? chat.slice(0, opts.truncateAt) : chat;
    let baseSpec = spec;
    if (opts?.truncateAt != null) {
      const lastSpec = [...baseChat].reverse().find(m => m.spec)?.spec;
      if (lastSpec && JSON.stringify(lastSpec) !== JSON.stringify(spec)) { baseSpec = lastSpec; setSpec(lastSpec, 'Before edited message'); }
    }
    const user: ChatMsg = { id: crypto.randomUUID(), role: 'user', text: prompt, image, at: Date.now() };
    setChat([...baseChat, user]);
    setThinking(true);
    setShowReveal(false);
    const fresh = !hasDesign || !baseChat.some(m => m.spec);
    let reply: ChatMsg;
    const collectedSteps: AiStepOutputs = {};
    let atStep: StepNumber = 1;           // the step running now (named in an error)
    const aiPrompt = withBuyRule(withFreeform(prompt, freeform), buyAny);   // what the AI gets; the chat keeps the user's words
    // the Directory the AI steps see: the stock, then (use any parts) the stock plus this design's shopping list
    let stepInv = buyAny && !fresh ? planInventory : inventory;
    const composed = isComposed;
    const isRefine = !fresh && !!built && !wantsNewDesign(prompt);
    if (!isRefine) {
      setAiSteps({});
      pendingReveal.current = true;
      setTheatre({ run, prompt, refs: null, offline: aiMode === 'offline', running: true });
      setEditorOpen(false);
    }

    try {
      if (aiMode === 'offline') throw new Error('offline');

      // Turn by turn: with a design on screen, a follow-up ("make it bigger", "fix the collision", "add a tail")
      // edits that design in one AI call with its check results and the recent chat. Only an explicit new idea
      // (or the AI answering intent "new") runs the full 8-step flow below.
      if (isRefine) {
        setActiveStep(4);
        const refine = (p: string) => fetchAiRefine({
          prompt: p,
          current: baseSpec,
          checks: (analysis?.checks ?? []).map(c => `[${c.status}${KIT_LIMITS.has(c.id) ? ', limit' : ''}] ${c.label}: ${c.detail}`),
          history: baseChat.slice(-8).map(m => ({ role: m.role, text: m.text })),
          inventory: stepInv,
          image,
          buy: buyAny,
        });
        let r = await refine(aiPrompt);
        if (!alive()) return;
        if (freeform && r.design?.intent !== 'new' && !composed(r.design)) r = await refine(freeformRetry(aiPrompt, String(r.design?.archetype ?? '')));
        if (!alive()) return;
        if (r.design?.intent !== 'new') {
          // an edit that came back as a prebuilt type keeps the free-form promise through its family's pattern
          const patterned = freeform && !composed(r.design);
          const { spec: next, fixes } = normalizeSpec(patterned ? withPattern(normalizeSpec(r.design).spec, platform) : r.design);
          if (patterned) fixes.push(`Composed with the generic ${familyOf(next)} pattern: the AI answered with a prebuilt CAD type.`);
          setSpec(next, prompt.slice(0, 48));
          setActiveStep(null);
          setChat(c => [...c, {
            id: crypto.randomUUID(), role: 'assistant', kind: 'edit', text: r.design.rationale || next.summary, spec: next,
            source: `${r.model ?? ai?.provider ?? 'ai'} · edit`, search: r.search ?? null,
            assumptions: [...(r.design.assumptions ?? []), ...fixes], outOfScope: r.design.outOfScope ?? [], fixes, at: Date.now(),
          }]);
          setThinking(false);
          return;
        }
        // the AI says this is a new robot: run the full flow with the theatre
        setAiSteps({});
        pendingReveal.current = true;
        setTheatre({ run, prompt, refs: null, offline: false, running: true });
      }

      // STEP 1: AI selects components from Directory based on user idea & reference image
      setActiveStep(atStep = 1);
      const r1 = await fetchAiDesignStep({
        step: 1,
        prompt: aiPrompt,
        inventory: stepInv, buy: buyAny,
        currentSpec: fresh ? undefined : spec,
        image: activeImage,
      });
      if (!alive()) return;
      collectedSteps[1] = { ...r1.result, model: r1.model };
      setAiSteps({ ...collectedSteps });

      // Use any parts: what step 1 picked beyond the stock is this design's shopping list; the CAD and the later steps
      // build with it. Otherwise a new design never carries an old list.
      const buyList = buyAny ? shoppingList(r1.result?.selectedComponents, inventory) : {};
      setToBuy(buyList);
      stepInv = withToBuy(inventory, buyList);
      if (Object.keys(buyList).length) {
        setChat(c => [...c, {
          id: crypto.randomUUID(), role: 'assistant', kind: 'system', source: 'Parts to buy',
          text: `🛒 Using parts you don't have yet, so nothing is left out. Picked beyond your directory: ${Object.entries(buyList).map(([id, q]) => `${q}× ${CATALOG[id]?.name ?? id}`).join(', ')}. The exact shopping list for the robot as built is in Parts & software → BOM ("To buy").`,
          at: Date.now(),
        }]);
      }

      // Part of the idea is beyond the stock or the platform: the flow goes on with the closest buildable version,
      // tells the user now what was left out, and the later steps design without it.
      const leftOut = String(r1.result?.refusalReason ?? '').split(/\n+|(?<=\.)\s+(?=Left out)/).map(s => s.trim()).filter(Boolean);
      if (leftOut.length) {
        setChat(c => [...c, {
          id: crypto.randomUUID(), role: 'assistant', kind: 'system', source: 'Closest buildable version',
          text: 'Building the closest version your parts allow. ' + leftOut.join(' '), at: Date.now(),
        }]);
      }

      // Visual reference search: before shaping anything, look up what the subject step 1 named actually looks
      // like (Wikipedia lead image + Commons photos), show it in the chat, and give the lead picture to the
      // vision-capable steps as the reference image. A picture the user attached always wins.
      let designPrompt = leftOut.length ? `${aiPrompt}\n\nBuild it WITHOUT these (not possible with the parts or platform): ${leftOut.join(' ')}` : aiPrompt;
      let designImage = activeImage;
      let shownSrc: string | undefined;
      const subject = String(r1.result?.visualSubject ?? '').trim();
      if (searchRefs && subject && !activeImage) {
        const refs = await fetchVisualReferences(subject);
        if (!alive()) return;
        if (refs?.images.length) {
          const { image: refImg, ...shown } = refs;
          setTheatre(t => (t && t.run === run ? { ...t, refs: shown } : t));
          setChat(c => [...c, {
            id: crypto.randomUUID(), role: 'assistant', kind: 'system', source: 'Visual reference search',
            text: `Looked up “${refs.title}”${refs.description ? ` (${refs.description})` : ''} so the design matches its real shape.`,
            refs: shown,
          }]);
          if (refImg) { designImage = { ...refImg, name: `${refs.title} reference picture` }; shownSrc = refs.images[0].thumb; }
          designPrompt = `${designPrompt}\n\n[Visual reference for "${refs.title}": ${refs.extract}]\nMatch this subject's recognisable shape and proportions (see the attached reference picture).`;
        }
      }

      // SAM 3.1: split the reference picture into named parts (head, body, wings, ...) and measure where each sits and
      // how big it is; the boxes are shown over the picture and the measured layout goes to every later design step.
      if (designImage) {
        const seg = await fetchSegmentation(designImage, segmentConcepts(r1.result));
        if (!alive()) return;
        if (seg) {
          setChat(c => [...c, {
            id: crypto.randomUUID(), role: 'assistant', kind: 'system', source: 'SAM 3.1 parts',
            text: `Segmented the reference with SAM 3.1: ${seg.parts.map(p => `${p.concept}${p.boxes.length > 1 ? ` ×${p.boxes.length}` : ''}`).join(', ')}. The design follows these measured proportions.`,
            segmentation: { ...seg, src: shownSrc ?? designImage!.dataUrl },
          }]);
          designPrompt = `${designPrompt}\n\n[Part layout measured by SAM 3.1 on the reference picture]\n${seg.layout}\nKeep these relative sizes and positions in the silhouette, the joints and the parts.`;
        }
      }

      // STEP 2: AI creates overall 3D form & envelope based on user prompt
      setActiveStep(atStep = 2);
      const r2 = await fetchAiDesignStep({
        step: 2,
        prompt: designPrompt,
        inventory: stepInv, buy: buyAny,
        currentSpec: fresh ? undefined : spec,
        previousSteps: { 1: collectedSteps[1] },
        image: designImage,
      });
      if (!alive()) return;
      collectedSteps[2] = { ...r2.result, model: r2.model };
      setAiSteps({ ...collectedSteps });

      // STEP 3: AI packages components into 3D form & auto-adjusts/widens envelope if not fit
      setActiveStep(atStep = 3);
      const r3 = await fetchAiDesignStep({
        step: 3,
        prompt: designPrompt,
        inventory: stepInv, buy: buyAny,
        currentSpec: fresh ? undefined : spec,
        previousSteps: { 1: collectedSteps[1], 2: collectedSteps[2] },
        image: designImage,
      });
      if (!alive()) return;
      collectedSteps[3] = { ...r3.result, model: r3.model };
      setAiSteps({ ...collectedSteps });

      // STEP 4: AI designs 3D printed parts & overall RobotSpec form
      setActiveStep(atStep = 4);
      const step4 = (p: string, current: RobotSpec | undefined) => fetchAiDesignStep({
        step: 4,
        prompt: p,
        inventory: stepInv, buy: buyAny,
        currentSpec: current,
        previousSteps: { 1: collectedSteps[1], 2: collectedSteps[2], 3: collectedSteps[3] },
        image: designImage,
      });
      // one design pass: free-form retry, the generic pattern if the AI still answers with a prebuilt type
      const designPass = async (p: string, current: RobotSpec | undefined) => {
        let r = await step4(p, current);
        if (freeform && !composed(r.result)) r = await step4(freeformRetry(p, String(r.result?.archetype ?? '')), current);
        const patterned = freeform && !composed(r.result);
        if (patterned) r = { ...r, result: { ...r.result, composition: patternComposition(normalizeSpec(r.result).spec, platform) } };
        const { spec: s, fixes } = normalizeSpec(r.result);
        if (patterned) fixes.push(`Composed with the generic ${familyOf(s)} pattern: the AI answered with a prebuilt CAD type.`);
        collectedSteps[4] = { design: r.result, aiReasoning: r.result.rationale ?? '', model: r.model };
        setAiSteps({ ...collectedSteps });
        return { r, s, fixes };
      };
      let { r: r4, s: spec4, fixes: fixes4 } = await designPass(designPrompt, fresh ? undefined : spec);
      if (!alive()) return;
      setSpec(spec4, prompt.slice(0, 48));

      // Build CAD assembly right at Step 4 so Step 5 can audit real geometry & physics
      let activeSpec = spec4;
      let activeFixes = [...fixes4];
      let activeAsm = await buildInWorker(withPlatform(activeSpec));
      if (!alive()) return;
      setBuilt({ spec: withPlatform(activeSpec), asm: activeAsm });
      let activeAnalysis = analyze(activeSpec, activeAsm, inventory);

      // STEP 5 ⇄ STEP 4: the AI audits the built CAD and its checks. While checks still fail, the design goes back to
      // step 4 with them (at most 2 rounds), is rebuilt and audited again.
      for (let round = 0; ; round++) {
        setActiveStep(atStep = 5);
        const checkStrings = activeAnalysis.checks.map(
          c => `[${c.status}${KIT_LIMITS.has(c.id) ? ', limit' : ''}] ${c.label}: ${c.detail}`,
        );
        const r5 = await fetchAiDesignStep({
          step: 5,
          prompt: aiPrompt,
          inventory: stepInv, buy: buyAny,
          currentSpec: activeSpec,
          checks: checkStrings,
          previousSteps: { 1: collectedSteps[1], 2: collectedSteps[2], 3: collectedSteps[3] },
          image: designImage,
        });
        if (!alive()) return;
        collectedSteps[5] = { ...r5.result, model: r5.model };
        setAiSteps({ ...collectedSteps });

        // a refinement that falls back to a prebuilt CAD type is ignored while free-form only is on
        if (r5.result.needsRefinement && r5.result.refinedDesign && (!freeform || composed(r5.result.refinedDesign))) {
          const { spec: spec5, fixes: fixes5 } = normalizeSpec(r5.result.refinedDesign);
          activeSpec = spec5;
          activeFixes = [...activeFixes, ...fixes5];
          setSpec(activeSpec, `${prompt.slice(0, 36)} (AI Audit)`);
          activeAsm = await buildInWorker(withPlatform(activeSpec));
          if (!alive()) return;
          setBuilt({ spec: withPlatform(activeSpec), asm: activeAsm });
          activeAnalysis = analyze(activeSpec, activeAsm, inventory);
        }

        const fails = activeAnalysis.checks.filter(c => c.status === 'fail');
        if (!fails.length || round >= 2) break;
        // back to the design step with what failed
        setChat(c => [...c, { id: crypto.randomUUID(), role: 'assistant', kind: 'system', source: 'Audit', at: Date.now(),
          text: `🔁 The audit found ${fails.length} failed check${fails.length > 1 ? 's' : ''} (${fails.slice(0, 3).map(f => f.label).join('; ')}${fails.length > 3 ? ' …' : ''}): back to step 4 to fix the design (round ${round + 1} of 2).` }]);
        setActiveStep(atStep = 4);
        const redo = await designPass(
          `${designPrompt}\n\nREDESIGN (audit round ${round + 1}): the current design (Current RobotSpec) failed these engineering checks. Change the design so they pass, keep everything else that works:\n${fails.map(f => `- ${f.label}: ${f.detail}`).join('\n')}`,
          activeSpec,
        );
        if (!alive()) return;
        r4 = redo.r;
        activeSpec = redo.s;
        activeFixes = [...activeFixes, ...redo.fixes];
        setSpec(activeSpec, `${prompt.slice(0, 36)} (redesign ${round + 1})`);
        activeAsm = await buildInWorker(withPlatform(activeSpec));
        if (!alive()) return;
        setBuilt({ spec: withPlatform(activeSpec), asm: activeAsm });
        activeAnalysis = analyze(activeSpec, activeAsm, inventory);
      }
      if (!alive()) return;
      // STEP 6: AI develops simulation behaviors & scenarios
      setActiveStep(atStep = 6);
      try {
        const r6 = await fetchAiDesignStep({
          step: 6,
          prompt: aiPrompt,
          inventory: stepInv, buy: buyAny,
          currentSpec: activeSpec,
          previousSteps: { 1: collectedSteps[1], 2: collectedSteps[2], 3: collectedSteps[3], 5: collectedSteps[5] },
        });
        collectedSteps[6] = { ...r6.result, model: r6.model };
        setAiSteps({ ...collectedSteps });
        if (Array.isArray(r6.result.behaviors) && r6.result.behaviors.length > 0) {
          activeSpec = { ...activeSpec, behaviors: r6.result.behaviors };
          setSpecRaw(activeSpec);
        }
      } finally { /* a failed step 6 (after 3 tries) stops the flow with its error: no fallback */ }
      if (!alive()) return;

      // Step 7 (firmware) is not part of designing any more: it runs on demand in Phase 2 (3D parts & software).

      // STEP 8: AI performs overall audit & end-to-end testing sign-off
      setActiveStep(atStep = 8);
      let r8Model: string | undefined;
      let r8Summary: string | undefined;
      try {
        const finalChecks = activeAnalysis.checks.map(c => `[${c.status}] ${c.label}: ${c.detail}`);
        const r8 = await fetchAiDesignStep({
          step: 8,
          prompt: aiPrompt,
          inventory: stepInv, buy: buyAny,
          currentSpec: activeSpec,
          checks: finalChecks,
          previousSteps: {
            1: collectedSteps[1],
            2: collectedSteps[2],
            3: collectedSteps[3],
            5: collectedSteps[5],
            6: collectedSteps[6],
            7: collectedSteps[7],
          },
          image: designImage,
        });
        collectedSteps[8] = { ...r8.result, model: r8.model };
        setAiSteps({ ...collectedSteps });
        r8Model = r8.model;
        r8Summary = r8.result.executiveSummary;
      } finally { /* a failed step 8 (after 3 tries) stops the flow with its error: no fallback */ }
      if (!alive()) return;

      reply = {
        id: crypto.randomUUID(),
        role: 'assistant',
        kind: 'design',
        at: Date.now(),
        text: r8Summary || r4.result.rationale || activeSpec.summary,
        spec: activeSpec,
        source: `${r8Model ?? r4.model ?? ai?.provider ?? 'ai'}`,
        search: r1.search ?? r2.search ?? r4.search ?? null,
        assumptions: [...(r4.result.assumptions ?? []), ...activeFixes],
        outOfScope: [...leftOut, ...(r4.result.outOfScope ?? [])],
        fixes: activeFixes,
      };
    } catch (e) {
      if (!alive()) return;
      const status = (e as { status?: number }).status;
      if (status === 422) {
        reply = { id: crypto.randomUUID(), role: 'assistant', kind: 'error', text: (e as Error).message, source: 'error', at: Date.now() };
      } else if (aiMode !== 'offline' && !(e as { auth?: boolean }).auth) {
        // With the AI on, a failed step (already retried 3 times) is an error: say which step and why, and offer a retry.
        // Never swap in the offline planner and pace its stages as if the AI steps had run. (The built-in planner is only
        // for the offline mode or when no AI key is set up at all.)
        const failed = isRefine ? 'the edit' : `step ${atStep}`;
        console.error('AI design flow failed at', failed, e);
        reply = { id: crypto.randomUUID(), role: 'assistant', kind: 'error', source: 'error', retry: prompt, at: Date.now(),
          text: `The design stopped at ${failed}: ${(e as Error)?.message || String(e)} (tried 3 times). Press retry to run it again.` };
      } else {
        try {
          // The built-in planner is instant; in the theatre its stages are paced so the steps can be followed.
          const staged = !isRefine && !reducedMotion();
          const stage = async (steps: StepNumber[]) => {
            for (const st of steps) { setActiveStep(st); if (staged) await sleep(240); if (!alive()) return false; }
            return true;
          };
          if (!isRefine && !(await stage([1, 2, 3, 4]))) return;
          const plan = localPlan(prompt, fresh ? undefined : baseSpec, 1, inventory);
          // the offline planner only knows the prebuilt types: with free-form on, its family's generic composition
          const planPatterned = freeform && !composed(plan.spec);
          if (planPatterned) plan.spec = normalizeSpec(withPattern(plan.spec, platform)).spec;
          setSpec(plan.spec, prompt.slice(0, 48));
          if (!isRefine && !(await stage([5, 6, 8]))) return;
          const why =
            (aiMode === 'offline'
              ? ''
              : '\n\n*(⚡ Generated using PICOCEO Builder autonomous morphological engine)*') +
            (planPatterned ? `\n\n*(Composed free-form from the generic ${familyOf(plan.spec)} pattern; edit it in the chat or the design editor.)*` : '');
          reply = { id: crypto.randomUUID(), role: 'assistant', kind: isRefine ? 'edit' : 'design', text: plan.rationale + why, spec: plan.spec, source: 'offline', assumptions: plan.assumptions, outOfScope: plan.outOfScope, at: Date.now() };
        } catch (err) {
          reply = { id: crypto.randomUUID(), role: 'assistant', kind: 'error', text: (err as Error).message, source: 'error', retry: prompt, at: Date.now() };
        }
      }
    }
    if (!alive()) return;
    setActiveStep(null);
    setChat(c => [...c, reply]);
    setThinking(false);
    const ok = reply.kind !== 'error';
    if (!isRefine || reply.kind === 'design') {
      if (ok) setShowReveal(true); else pendingReveal.current = false;
      setTheatre(t => (t && t.run === run ? { ...t, running: false } : t));
      // the reveal card takes over; the finished stepper folds away shortly after
      window.setTimeout(() => setTheatre(t => (t && t.run === run && ok ? null : t)), 1400);
    }
  }, [ai, aiMode, analysis, built, buyAny, chat, freeform, hasDesign, inventory, planInventory, platform, refImage, searchRefs, spec, setSpec, withPlatform]);

  const rerunStep = useCallback(async (step: StepNumber) => {
    if (!built) return;
    const prompt = latestUserPrompt || `Design ${built.spec.name}: ${built.spec.summary}`;
    setActiveStep(step);
    try {
      const checkStrings = analysis?.checks.map(c => `[${c.status}] ${c.label}: ${c.detail}`) ?? [];
      const r = await fetchAiDesignStep({
        step,
        prompt: withBuyRule(withFreeform(prompt, freeform), buyAny),
        inventory: buyAny ? planInventory : inventory,
        buy: buyAny,
        currentSpec: built.spec,
        checks: checkStrings,
        previousSteps: aiSteps,
        image: refImage,
      });
      if (step === 4 && !(freeform && !isComposed(r.result))) {
        const { spec: s4 } = normalizeSpec(r.result);
        setSpec(s4, `AI Step 4 (${r.model})`);
        setAiSteps(prev => ({
          ...prev,
          4: { design: r.result, aiReasoning: r.result.rationale ?? '', model: r.model },
        }));
      } else if (step === 5) {
        setAiSteps(prev => ({ ...prev, 5: { ...r.result, model: r.model } }));
        if (r.result.needsRefinement && r.result.refinedDesign && (!freeform || isComposed(r.result.refinedDesign))) {
          const { spec: s5 } = normalizeSpec(r.result.refinedDesign);
          setSpec(s5, `AI Step 5 Audit (${r.model})`);
        }
      } else {
        setAiSteps(prev => ({ ...prev, [step]: { ...r.result, model: r.model } }));
      }
    } catch (e) {
      alert(`AI Step ${step} error: ${(e as Error).message}`);
    } finally {
      setActiveStep(null);
    }
  }, [aiSteps, analysis, built, buyAny, freeform, inventory, latestUserPrompt, planInventory, refImage, setSpec]);

  const reset = () => {
    window.clearTimeout(debounce.current);
    setProjectId(crypto.randomUUID());
    setProjectCreatedAt(Date.now());
    setHasDesign(false);
    setBuilt(null);
    setBuilding(false);
    setBuildError(null);
    setChat([]);
    setVersions([]);
    setAiSteps({});
    setRefImage(undefined);
    setSpecRaw(defaultSpec('rover'));
    setSelected(null);
    runRef.current++;
    setThinking(false);
    setActiveStep(null);
    setTheatre(null);
    setShowReveal(false);
    setEditorOpen(false);
    if (phase === 2) setPhase(1);
  };

  const loadCloudProject = (p: CloudProject) => {
    window.clearTimeout(debounce.current);
    setProjectId(p.id);
    setProjectCreatedAt(p.createdAt || Date.now());
    setSpecRaw(normalizeSpec(p.spec).spec);
    setHasDesign(p.hasDesign);
    setVersions(p.versions ?? []);
    setChat(p.chat ?? []);
    setAiSteps(p.aiSteps ?? {});
    setRefImage(undefined);
    setSelected(null);
  };

  const handleDeleteCloudProject = async (id: string) => {
    if (!user) return;
    await deleteProjectFromFirestore(user.uid, id);
    if (id === projectId) {
      reset();
    }
  };

  const handleSignIn = async () => {
    setCloudError(null);
    const u = await signInWithGoogle();
    setUser(u);
  };

  const handleSignOut = async () => {
    await signOutFirebase();
    setUser(null);
    setNeedsOnboarding(false);
    setCloudStatus('idle');
  };

  const handleCompleteOnboarding = async (inv: ComponentDirectory) => {
    setInventory(inv);
    if (user) {
      try {
        localStorage.setItem(`cyberbuild.onboarded.v1.${user.uid}`, '1');
      } catch { /* ignore */ }
      try {
        await saveUserDirectoryToFirestore(user, inv, projectId);
      } catch (e) {
        setCloudStatus('error');
        setCloudError((e as Error).message);
      }
    }
    setNeedsOnboarding(false);
  };

  if (authLoading) {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ alignItems: 'center', textAlign: 'center', padding: '36px 28px' }}>
          <div className="login-logo-badge">◆</div>
          <h2 className="login-title" style={{ fontSize: 18 }}>PICOCEO Builder</h2>
          <p className="login-subtitle">Checking Google authentication session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onSignIn={handleSignIn}
        onConfigUpdated={() => setFbConfigVersion(v => v + 1)}
      />
    );
  }

  if (needsOnboarding) {
    return (
      <DirectoryModal
        isOpen={true}
        onboarding={true}
        userEmail={user.email}
        onSignOut={handleSignOut}
        onClose={() => {}}
        inventory={inventory}
        onSave={handleCompleteOnboarding}
      />
    );
  }

  const openEditor = () => { setPhase(1); setDrawer(false); setShowReveal(false); setEditorOpen(true); };
  const talk = () => { setShowReveal(false); setPhase(3); };
  const buildIt = () => { setShowReveal(false); setPhase(2); setPhase2Tab('print'); };
  const getToken = async () => (LOCAL_PREVIEW || !user || typeof user.getIdToken !== 'function' ? null : user.getIdToken());
  const pick = (id: string | null) => {
    setSelected(id);
    if (!editorOpen || !id || !built) return;
    const link = built.asm.parts.find(p => p.id === id)?.link;
    if (link) setEditorFocus(link === 'base' ? 'body' : link);
  };
  const focusEditorItem = (item: string | null) => {
    setEditorFocus(item);
    if (!item || !built) return;
    const link = item === 'body' ? 'base' : item;
    const part = built.asm.parts.find(p => p.link === link);
    if (part) setSelected(part.id);
  };
  const readiness = readinessOf(analysis?.checks);
  const landing = phase === 1 && !hasDesign && chat.length === 0 && !thinking;
  const talks = VOICE_PLATFORMS.includes(platform);
  const fixPrompt = 'Fix every failed and warned check that the design can change, while keeping the robot\'s purpose. Say what the fix costs (e.g. reach, speed).';
  const failing = analysis?.checks.filter(c => c.status !== 'pass' && !KIT_LIMITS.has(c.id)).length ?? 0;
  const exportJson = () => download(`${slug(spec.name)}.picoceo.json`, strToU8(JSON.stringify(spec, null, 2)), 'application/json');
  const menus: { label: string; items: MenuItem[] }[] = [
    { label: 'File', items: [
      { label: 'New project', onClick: reset },
      { label: 'Cloud projects…', hint: `${cloudProjects.length}`, onClick: () => setShowAuthModal(true) },
      { separator: true },
      { label: 'Save version', onClick: () => setSpec(spec, 'Manual save') },
      ...(versions.length ? [{ heading: `History (${versions.length})` } as MenuItem,
        ...versions.slice(-8).reverse().map(v => ({ label: `${new Date(v.at).toLocaleTimeString()} · ${v.label}`, onClick: () => setSpec(v.spec) }))] : []),
      { separator: true },
      { label: 'Import project (.json)…', onClick: () => importRef.current?.click() },
      { label: 'Export project (.json)', onClick: exportJson },
      { label: 'Download 3MF (Bambu Studio)', disabled: !built, onClick: () => built && download(`${slug(spec.name)}.3mf`, threeMF(spec, built.asm), 'model/3mf') },
      { separator: true },
      { label: 'Sign out', hint: user.email ?? '', onClick: handleSignOut },
    ] },
    { label: 'Edit', items: [
      { label: 'Undo last change', hint: versions.length >= 2 ? versions[versions.length - 1].label : '', disabled: versions.length < 2, onClick: undo },
      { label: 'Rename project…', onClick: () => { const n = window.prompt('Project name', spec.name); if (n?.trim()) setSpecRaw({ ...spec, name: n.trim().slice(0, 40) }); } },
      { separator: true },
      { label: 'Edit design (no AI)…', disabled: !hasDesign, checked: editorOpen, onClick: () => openEditor() },
      { label: `Fix failing checks${failing ? ` (${failing})` : ''}`, disabled: !failing || thinking, onClick: () => send(fixPrompt) },
      { label: 'Design parameters…', disabled: !built, onClick: () => { setPhase(1); openDrawer('design'); } },
    ] },
    { label: 'View', items: [
      { label: 'Phase 1 · Design', checked: phase === 1, onClick: () => setPhase(1) },
      { label: 'Phase 2 · 3D parts & software', checked: phase === 2, disabled: !built, onClick: () => setPhase(2) },
      { label: 'Phase 3 · AI Brain', checked: phase === 3, onClick: () => setPhase(3) },
      { separator: true },
      { label: 'Light theme', checked: theme === 'light', onClick: () => setTheme(theme === 'light' ? 'dark' : 'light') },
      { label: 'Design steps (build theatre)', disabled: !Object.keys(aiSteps).length || thinking, checked: !!theatre, onClick: () => setTheatre(t => (t ? null : { run: runRef.current, prompt: latestUserPrompt, refs: null, offline: aiMode === 'offline', running: false })) },
      { separator: true },
      { label: 'Design panel', checked: phase === 1 && drawer, onClick: () => { setPhase(1); drawer ? setDrawer(false) : openDrawer('design'); } },
      { label: 'Checks', hint: failing ? `${failing}` : '', onClick: () => { setPhase(1); openDrawer('checks'); } },
      { label: 'Design report', onClick: () => { setPhase(1); openDrawer('flow'); } },
      { label: 'Hardware specs', onClick: () => { setPhase(1); openDrawer('catalog'); } },
      { separator: true },
      { label: 'Simulate', disabled: !built, onClick: () => { setPhase(1); setExternalViewportMode(p => ({ mode: 'sim', seq: (p?.seq ?? 0) + 1 })); } },
      { label: 'Print plates', disabled: !built, onClick: () => { setPhase(2); setPhase2Tab('print'); } },
      { label: 'Code editor', disabled: !built, onClick: () => { setPhase(2); setPhase2Tab('code'); } },
    ] },
    { label: 'Tools', items: [
      { label: 'Component directory…', hint: `${totalStockCount}`, onClick: () => setShowDirectory(true) },
      { separator: true },
      { label: 'Flash to board…', disabled: !built, onClick: () => { setPhase(2); setPhase2Tab('code'); } },
      { label: 'Generate AI controller (step 7)', disabled: !built || activeStep !== null, onClick: () => { setPhase(2); setPhase2Tab('code'); void rerunStep(7); } },
      { separator: true },
      { label: 'Re-run AI audit (step 5)', disabled: !built || activeStep !== null, onClick: () => void rerunStep(5) },
      { label: 'Re-run AI sign-off (step 8)', disabled: !built || activeStep !== null, onClick: () => void rerunStep(8) },
      { label: aiMode === 'offline' ? 'Use AI planner' : 'Use offline planner', onClick: () => setAiMode(aiMode === 'offline' ? 'auto' : 'offline') },
      { label: 'Search visual references before designing', checked: searchRefs, onClick: () => setSearchRefs(!searchRefs) },
      { label: 'Free-form design only (no prebuilt CAD types)', checked: freeform, onClick: () => setFreeform(!freeform) },
      { label: 'Use any parts (I\'ll buy what my directory lacks)', checked: buyAny, onClick: () => setBuyAny(!buyAny) },
    ] },
    { label: 'Help', items: [
      { label: 'How it works', onClick: () => alert('Phase 1 · Design: describe the robot in the chat. The AI designs it in 8 steps the first time; after that every message edits the current design (say "start over" or "design a …" for a new robot). The 3D view shows the assembly and the physics simulation.\n\nPhase 2 · 3D parts & software: download print plates (3MF / STL), edit the generated MicroPython and flash it to the board over USB.') },
      { label: 'Flashing the board', onClick: () => alert('Use Chrome or Edge on a desktop. Connect the CyberBrick ESP32-C3 core by USB-C, open Phase 2 → Code editor, click Connect board and pick the USB serial port, then Flash. The app stops the running program, writes every .py file through the MicroPython raw REPL, checks each file size and resets the board so main.py runs. The serial monitor shows the robot\'s output.') },
      { label: 'About PICOCEO Builder', onClick: () => alert(`PICOCEO Builder — AI robot designer for CyberBrick.\n${ai?.ai ? `AI: ${ai.provider ?? ''} ${ai.model ?? ''}` : 'AI: offline planner'}`) },
    ] },
  ];

  return (
    <div className="app">
      <MenuBar
        brand={<><span className="logo">◆</span> PICOCEO Builder</>}
        menus={menus}
        right={<>
          <div className="phase-switch" role="tablist" aria-label="Phase">
            <button role="tab" aria-selected={phase === 1} className={phase === 1 ? 'on' : ''} onClick={() => setPhase(1)}><b>1</b> Design</button>
            <button role="tab" aria-selected={phase === 2} className={phase === 2 ? 'on' : ''} onClick={() => setPhase(2)} disabled={!built}><b>2</b> Parts &amp; software</button>
            <button role="tab" aria-selected={phase === 3} className={`brain-tab ${phase === 3 ? 'on' : ''}`} onClick={() => setPhase(3)}><b>3</b> AI Brain</button>
          </div>
          <button className="theme-btn ghost" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title="Light / dark theme">{theme === 'light' ? '☾' : '☀'}</button>
          <input className="name" value={spec.name} onChange={e => setSpecRaw({ ...spec, name: e.target.value })} aria-label="Project name" />
          <span className={`status ${building ? 'busy' : buildError ? 'err' : ''}`}>
            {building ? 'Building CAD…' : buildError ? 'CAD error' : built ? `${built.asm.parts.length} parts` : ''}
          </span>
          <button className="account" onClick={() => setShowAuthModal(true)} title={`Signed in as ${user.email} · cloud ${cloudStatus}`}
            style={{ borderColor: cloudStatus === 'error' ? 'rgba(248, 113, 113, 0.5)' : 'rgba(74, 222, 128, 0.45)' }}>
            {(user.email ?? '?')[0].toUpperCase()}
          </button>
        </>}
      />
      <input ref={importRef} type="file" accept=".json" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) { try { setSpec(normalizeSpec(JSON.parse(await f.text())).spec, `Import ${f.name}`); } catch { alert('Not a PICOCEO Builder project file'); } } e.target.value = ''; }} />
      <main className={`layout phase${phase} ${landing ? 'landing-layout' : ''}`}>
        {landing ? (
          <Landing onSend={send} thinking={thinking} ai={ai} aiMode={aiMode} setAiMode={setAiMode} userName={user.displayName} />
        ) : phase === 3 ? (
          // Phase 3 · AI Brain: the user's backbone, paired robots and the talk console
          <section className="phase3">
            <BrainPhase getToken={getToken} localPreview={LOCAL_PREVIEW} spec={built?.spec ?? null} />
          </section>
        ) : (<>
        <Chat
          msgs={chat}
          thinking={thinking}
          onSend={send}
          ai={ai}
          aiMode={aiMode}
          setAiMode={setAiMode}
          archetype={spec.archetype}
          hasDesign={hasDesign}
          onFix={() => send(fixPrompt)}
          failing={failing}
          onOpenDirectory={() => setShowDirectory(true)}
          inventoryCount={totalStockCount}
          activeStep={activeStep}
          aiSteps={aiSteps}
          flowReport={flowReport}
          onSelectFlowStep={step => { setPhase(1); setDrawer(true); setExternalFlowStep(prev => ({ step, seq: (prev?.seq ?? 0) + 1 })); }}
          currentSpec={hasDesign ? spec : undefined}
          readiness={readiness}
          onCancel={cancelRun}
          onRestore={(s, label) => setSpec(s, label)}
          onEditDesign={openEditor}
          onTalk={talk}
          onResend={(id, text) => { const i = chat.findIndex(m => m.id === id); if (i >= 0) void send(text, chat[i].image, { truncateAt: i }); }}
        />
        {phase === 1 ? (
          // Phase 1 · Design: the full 3D view (assembly + simulation); details in a drawer on demand
          <div className={`stage ${drawer || editorOpen ? 'with-drawer' : ''} ${theatre?.running ? 'theatre-on' : ''} ${thinking && !theatre ? 'refining' : ''}`}>
            <Viewport
              modes={['assembly', 'sim']}
              built={built}
              building={building}
              behaviors={behaviors}
              selected={selected}
              onPick={pick}
              error={buildError}
              externalMode={externalViewportMode}
              rlPolicy={rlPolicy}
              onPolicyChange={setRlPolicy}
              lastFirmwarePolicy={lastFirmwarePolicy}
              onUpdateFirmware={handleUpdateFirmware}
              reveal={revealSeq}
              placeholder={!!theatre?.running}
              theme={theme}
            />
            {theatre && (
              <BuildTheatre
                runId={theatre.run}
                running={theatre.running && thinking}
                activeStep={activeStep}
                aiSteps={aiSteps}
                refs={theatre.refs}
                prompt={theatre.prompt}
                offline={theatre.offline}
                onCancel={cancelRun}
                onClose={() => setTheatre(null)}
              />
            )}
            {thinking && !theatre && (
              <div className="refine-pill" role="status"><span className="typing-dots" aria-hidden><i /><i /><i /></span> Editing the design…
                <button className="link-btn" onClick={cancelRun}>Stop</button></div>
            )}
            {showReveal && built && analysis && !thinking && (
              <RevealCard
                spec={built.spec}
                checks={analysis.checks}
                stats={{ parts: built.asm.parts.length, printH: analysis.totals.printH, massG: analysis.totals.massG, runtimeMin: analysis.totals.runtimeMin, joints: built.asm.links.filter(l => l.joint).length }}
                talks={talks}
                onEdit={openEditor}
                onTalk={talk}
                onBuild={buildIt}
                onClose={() => setShowReveal(false)}
              />
            )}
            {editorOpen && hasDesign && (
              <DesignEditor
                className="drawer"
                spec={spec}
                onChange={(s, label) => setSpec(s, `Edit: ${label}`, true)}
                onUndo={undo}
                canUndo={versions.length >= 2}
                onClose={() => { setEditorOpen(false); setEditorFocus(null); }}
                focus={editorFocus}
                onFocusItem={focusEditorItem}
              />
            )}
            {!drawer && !editorOpen && hasDesign && (
              <button className="editor-open" onClick={openEditor} title="Edit the generated design directly, without the AI">✎ Edit design</button>
            )}
            {!drawer && !editorOpen && (
              <button className="drawer-open" onClick={() => openDrawer('design')} title="Design parameters, checks, BOM and the design report">
                {failing ? <span className="badge">{failing}</span> : null}Design panel ◂
              </button>
            )}
            {drawer && (
              <Inspector
                className="drawer"
                onClose={() => setDrawer(false)}
                openTab={drawerTab}
                spec={spec}
                setSpec={s => setSpec(s)}
                built={built}
                analysis={analysis}
                behaviors={behaviors}
                selected={selected}
                onSelect={setSelected}
                inventory={inventory}
                buyMode={buyAny}
                onOpenDirectory={() => setShowDirectory(true)}
                flowReport={flowReport}
                externalFlowStep={externalFlowStep}
                onRequestViewportMode={(mode, behavior) => mode === 'print'
                  ? (setPhase(2), setPhase2Tab('print'))
                  : setExternalViewportMode(prev => ({ mode, behavior, seq: (prev?.seq ?? 0) + 1 }))}
                onFixChecks={() => send(fixPrompt)}
                onRerunStep={rerunStep}
                runningStep={activeStep}
                rlPolicy={rlPolicy}
                lastFirmwarePolicy={lastFirmwarePolicy}
                onUpdateFirmware={handleUpdateFirmware}
              />
            )}
          </div>
        ) : (
          // Phase 2 · 3D parts & software
          <section className="phase2">
            <nav className="tabs">
              {([['print', 'Print plates'], ['code', 'Code editor'], ['wiring', 'Wiring'], ['bom', 'BOM']] as const).map(([t, l]) => (
                <button key={t} className={phase2Tab === t ? 'on' : ''} onClick={() => setPhase2Tab(t)}>{l}</button>
              ))}
            </nav>
            {!built ? (
              <div className="empty-state">Design a robot in Phase 1 first; its printable parts and firmware appear here.</div>
            ) : phase2Tab === 'print' ? (
              <div className="print-split">
                <Viewport modes={['print']} built={built} building={building} behaviors={behaviors} selected={selected} onPick={setSelected} error={buildError} />
                <div className="print-list"><PrintTab asm={built.asm} spec={built.spec} selected={selected} onSelect={setSelected} behaviors={behaviors} /></div>
              </div>
            ) : phase2Tab === 'code' ? (
              <CodeEditor
                projectId={projectId}
                spec={built.spec}
                asm={built.asm}
                behaviors={behaviors}
                rlPolicy={lastFirmwarePolicy ?? undefined}
                aiModule={aiSteps[7]?.aiModuleCode ? { filename: aiSteps[7].aiModuleFilename || 'ai_controller.py', code: aiSteps[7].aiModuleCode } : null}
                onGenerateAi={() => void rerunStep(7)}
                generatingAi={activeStep === 7}
              />
            ) : (
              <div className="tab-body">
                {phase2Tab === 'wiring' ? <WiringTab asm={built.asm} /> : <BomTab asm={built.asm} spec={built.spec} inventory={inventory} buyMode={buyAny} onOpenDirectory={() => setShowDirectory(true)} />}
              </div>
            )}
          </section>
        )}
        </>)}
      </main>

      <DirectoryModal
        isOpen={showDirectory}
        onClose={() => setShowDirectory(false)}
        inventory={inventory}
        onSave={setInventory}
      />

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        user={user}
        cloudStatus={cloudStatus}
        cloudError={cloudError}
        projects={cloudProjects}
        activeProjectId={projectId}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onSelectProject={loadCloudProject}
        onDeleteProject={handleDeleteCloudProject}
        onNewCloudProject={reset}
        onConfigUpdated={() => setFbConfigVersion(v => v + 1)}
      />
    </div>
  );
}
