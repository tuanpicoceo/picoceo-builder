// AI Brain (backbone) section: the user's robot brain on the shared server key, paired robots and a talk console.
// Contract: docs/BACKBONE_MCP.md ("Browser API"). Left: talk console with the virtual robot face. Right: brain config,
// paired robots and how the MCP link works.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RobotSpec } from '../design/spec';
import {
  BackboneError, DEFAULT_CONFIG, EXPRESSIONS, LANGUAGES, LIMITS, PAIR_PLATFORMS, STYLES, VOICES,
  buildRobotTools, configPySnippet, createBackboneClient, curlInitialize, designAbilities, errorText, storeRobotCredentials, validateConfig,
  type BackboneConfig, type BackboneErrorKind, type BackboneState, type ConverseArgs, type Expression, type PairPlatform,
  type PairedRobot, type RobotAction,
} from '../backbone/client';
import { MAX_SECONDS, MicRecorder, WavPlayer, micSupported } from '../backbone/audio';
import { RobotFace, type FaceMode } from './RobotFace';
import './brain.css';

export interface BrainPhaseProps {
  /** Firebase ID token of the signed-in user (null in the dev preview). */
  getToken: () => Promise<string | null>;
  /** Dev preview (`/?preview`): the server accepts `X-Dev-User: local-preview` instead of a token. */
  localPreview: boolean;
  /** The current design, if any (its name, platform, joints and behaviours seed the robot's abilities). */
  spec: RobotSpec | null;
}

// ---------------------------------------------------------------- persona templates

const PERSONAS: { id: string; icon: string; label: string; style: BackboneConfig['style']; audience: BackboneConfig['audience']; persona: string; greeting: string }[] = [
  { id: 'desk', icon: '🖥️', label: 'Desk buddy', style: 'friendly', audience: 'general', greeting: "Hi, I'm {name}! What are we working on?",
    persona: '{name} is a cheerful little desk buddy. It keeps answers short and warm, celebrates small wins, reminds the user to stretch and drink water, and loves a gentle pun. It nods or looks around when it is curious.' },
  { id: 'owl', icon: '🦉', label: "Kids' story owl", style: 'playful', audience: 'kids', greeting: 'Hoo-hoo! I am {name}. Shall we make up a story?',
    persona: '{name} is a wise, gentle owl who tells short bedtime and adventure stories for children aged 4 to 9. It asks the child to choose what happens next, uses simple words, never says anything scary, and ends stories on a happy note.' },
  { id: 'coach', icon: '📚', label: 'Study coach', style: 'teacher', audience: 'general', greeting: "I'm {name}, your study coach. What topic today?",
    persona: '{name} is a patient study coach. It explains one idea at a time, checks understanding with a quick question, uses the Socratic method instead of giving answers away, and suggests 25-minute focus sessions with short breaks.' },
  { id: 'plant', icon: '🪴', label: 'Plant whisperer', style: 'calm', audience: 'general', greeting: 'Hello, friend. The leaves say hi too.',
    persona: '{name} is a calm, slightly poetic plant whisperer. It gives practical care tips (light, water, soil, pests) in a soothing voice, speaks on behalf of the plants now and then, and encourages slow, mindful moments.' },
  { id: 'reception', icon: '🛎️', label: 'Receptionist', style: 'concise', audience: 'general', greeting: 'Welcome! I am {name}. How can I help you today?',
    persona: '{name} is a polite front-desk receptionist robot. It greets visitors, asks who they are here to see, gives clear directions, keeps replies brief and professional, and never shares private information.' },
  { id: 'cat', icon: '😼', label: 'Grumpy cat', style: 'playful', audience: 'general', greeting: 'Ugh. You again. Fine, I am {name}.',
    persona: '{name} is a grumpy but secretly affectionate cat robot. It sighs, complains about Mondays and empty food bowls, answers with dry sarcasm, but always helps in the end. It is never truly mean.' },
];

const STYLE_LABEL: Record<BackboneConfig['style'], string> = { friendly: 'Friendly', playful: 'Playful', calm: 'Calm', teacher: 'Teacher', concise: 'Concise' };
const EXPRESSION_ICON: Record<Expression, string> = {
  neutral: '😐', happy: '😊', sad: '😢', surprised: '😮', thinking: '🤔', sleepy: '😴', love: '😍', angry: '😠', listening: '👂', speaking: '🗣️',
};

// ---------------------------------------------------------------- helpers

type LoadState = 'loading' | 'ready' | BackboneErrorKind;

type Msg =
  | { id: number; role: 'user'; text: string; pending?: boolean }
  | { id: number; role: 'robot'; reply: string; emotion: Expression; actions: RobotAction[]; textOnly: boolean; preview?: string }
  | { id: number; role: 'error'; kind: BackboneErrorKind; text: string; retry?: ConverseArgs };

type NewMsg = Msg extends infer M ? (M extends Msg ? Omit<M, 'id'> & { id?: number } : never) : never;

interface Toast { id: number; icon: string; text: string }

function toMs(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(n) ? n : null;
}
function relTime(ms: number | null, now: number): string {
  if (ms == null) return 'never connected';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch { return false; }
  }
}
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState<'' | 'ok' | 'fail'>('');
  return (
    <button type="button" className="br-copy" onClick={async () => { setDone((await copyText(text)) ? 'ok' : 'fail'); setTimeout(() => setDone(''), 1600); }}>
      {done === 'ok' ? '✓ Copied' : done === 'fail' ? 'Copy failed' : label}
    </button>
  );
}
const isEditable = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = e.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable;
};
const actionLabel = (a: RobotAction) => {
  const v = Object.values(a.arguments ?? {});
  return `${a.tool}${v.length ? ' ' + v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') : ''}`;
};
const platformMeta = (id: string) => PAIR_PLATFORMS.find(p => p.id === id) ?? { id, label: id, short: id, icon: '🤖' };

function Section({ title, icon, children, extra, id }: { title: string; icon: string; children: ReactNode; extra?: ReactNode; id?: string }) {
  return (
    <section className="br-card" aria-labelledby={id}>
      <header className="br-card-head">
        <h3 id={id}><span aria-hidden>{icon}</span> {title}</h3>
        {extra}
      </header>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- component

export function BrainPhase({ getToken, localPreview, spec }: BrainPhaseProps) {
  const uid = useId();
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const client = useMemo(() => createBackboneClient({ getToken: () => tokenRef.current(), localPreview }), [localPreview]);

  const [status, setStatus] = useState<LoadState>('loading');
  const [server, setServer] = useState<BackboneState | null>(null);
  const [draft, setDraft] = useState<BackboneConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState<BackboneConfig>(DEFAULT_CONFIG);
  const [errors, setErrors] = useState<ReturnType<typeof validateConfig>>({});
  const [saveNote, setSaveNote] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setStatus(s => (s === 'ready' ? s : 'loading'));
    try {
      const s = await client.get();
      setServer(s);
      if (!quiet) { setDraft(s.config); setSaved(s.config); }
      setStatus('ready');
    } catch (e) {
      if (!quiet) setStatus(e instanceof BackboneError ? e.kind : 'network');
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);
  // signed in later: the token getter changes, so retry once a token is there
  useEffect(() => {
    if (status !== 'signed_out') return;
    let live = true;
    void client.canAuth().then(ok => { if (ok && live) void load(); });
    return () => { live = false; };
  }, [getToken, status, client, load]);
  // keep robots' last-seen fresh
  useEffect(() => {
    if (status !== 'ready') return;
    const t = setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') void load(true); }, 30000);
    return () => clearInterval(t);
  }, [status, load]);

  const ready = status === 'ready';
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof BackboneConfig>(k: K, v: BackboneConfig[K]) => {
    setDraft(d => ({ ...d, [k]: v }));
    setSaveNote(null);
    if (errors[k]) setErrors(e => { const n = { ...e }; delete n[k]; return n; });
  };

  const save = async () => {
    const errs = validateConfig(draft);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setSaveNote({ tone: 'err', text: 'Fix the highlighted fields first.' });
      document.getElementById(`${uid}-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const c = await client.save(draft);
      const adjusted = JSON.stringify(c) !== JSON.stringify(draft);
      setSaved(c); setDraft(c);
      setSaveNote({ tone: 'ok', text: adjusted ? 'Saved. The server adjusted some values to its limits.' : 'Saved. Your robots use the new brain on their next turn.' });
    } catch (e) {
      const k = e instanceof BackboneError ? e.kind : 'network';
      setSaveNote({ tone: 'err', text: e instanceof BackboneError ? e.message : errorText.network });
      if (k === 'signed_out' || k === 'not_deployed') setStatus(k);
    } finally { setSaving(false); }
  };

  // Ctrl/Cmd+S saves while this phase is mounted
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---------------------------------------------------------------- console state
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<FaceMode>('idle');
  const [expression, setExpression] = useState<Expression>('neutral');
  const [ticker, setTicker] = useState<string | null>(null);
  const [led, setLed] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [voiceOff, setVoiceOff] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const idSeq = useRef(1);
  const recRef = useRef<MicRecorder | null>(null);
  const player = useRef(new WavPlayer());
  const abortRef = useRef<AbortController | null>(null);
  const wantStop = useRef(false);
  const starting = useRef(false);
  const exprTimer = useRef(0), tickerTimer = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const voiceAvailable = ready && !!server?.voice && !voiceOff;
  const canMic = voiceAvailable && micSupported();
  const canTalk = ready && !limitHit && !busy;
  const tools = useMemo(() => buildRobotTools(spec, draft.abilities), [spec, draft.abilities]);
  const abilities = useMemo(() => designAbilities(spec), [spec]);

  useEffect(() => () => { abortRef.current?.abort(); player.current.stop(); recRef.current?.cancel(); clearTimeout(exprTimer.current); clearTimeout(tickerTimer.current); }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs]);
  useEffect(() => { if (server && !server.voice) setVoiceOff(true); }, [server]);
  useEffect(() => {
    if (!recording) { setRecSecs(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => setRecSecs((Date.now() - t0) / 1000), 100);
    return () => clearInterval(t);
  }, [recording]);

  const push = (m: NewMsg) => { const id = m.id ?? idSeq.current++; setMsgs(ms => [...ms, { ...m, id } as Msg]); return id; };
  const toast = (icon: string, t: string) => {
    const id = idSeq.current++;
    setToasts(ts => [...ts.slice(-2), { id, icon, text: t }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 2800);
  };
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  /** Virtual robot: run the returned actions the way a robot would. */
  const runActions = async (actions: RobotAction[]) => {
    for (const a of actions) {
      const g = a.arguments ?? {};
      switch (a.tool) {
        case 'show_face': if ((EXPRESSIONS as readonly string[]).includes(String(g.expression))) setExpression(g.expression as Expression); break;
        case 'show_text':
          setTicker(String(g.text ?? '').slice(0, 120));
          clearTimeout(tickerTimer.current);
          tickerTimer.current = window.setTimeout(() => setTicker(null), 7000);
          break;
        case 'play_behavior': toast('▶', `Playing “${g.name}”`); break;
        case 'move_joint': toast('↻', `${g.joint} → ${Number(g.degrees) || 0}°`); break;
        case 'set_led': if (typeof g.color === 'string') { setLed(g.color); toast('💡', `LEDs ${g.color}`); } break;
        case 'set_volume': player.current.setVolume(Number(g.level)); toast('🔊', `Volume ${Number(g.level)}%`); break;
        default: toast('⚙', actionLabel(a));
      }
      await sleep(260);
    }
  };

  const send = async (args: ConverseArgs, userText: string | null, opts: { preview?: string; voiceLabel?: string } = {}) => {
    if (!ready || busy) return;
    setHint(null);
    const userId = userText != null ? push({ role: 'user', text: userText, pending: !!opts.voiceLabel }) : -1;
    setBusy(true); setMode('thinking');
    clearTimeout(exprTimer.current);
    const ctl = new AbortController(); abortRef.current = ctl;
    try {
      const res = await client.converse({
        ...args,
        robot_tools: opts.preview ? [] : tools,
        state: { virtual: true, face: abilities.display, design: spec?.name ?? null, archetype: spec?.archetype ?? null, battery: 1 },
        ...(voiceAvailable ? { audio_out: { format: 'wav', rate: 24000 } } : {}),
      }, ctl.signal);
      if (opts.voiceLabel && userId > 0) {
        setMsgs(ms => ms.map(m => (m.id === userId && m.role === 'user' ? { ...m, text: res.transcript || '(nothing heard)', pending: false } : m)));
      }
      setServer(s => (s ? { ...s, usage: { ...s.usage, today: s.usage.today + 1 } } : s));
      if (!res.voice) setVoiceOff(true);
      push({ role: 'robot', reply: res.reply, emotion: res.emotion, actions: res.actions, textOnly: !res.audio, preview: opts.preview });
      setLive(`${draft.name || 'Robot'} says: ${res.reply}`);
      setExpression(res.emotion === 'speaking' || res.emotion === 'listening' ? 'neutral' : res.emotion);
      const acting = runActions(res.actions);
      setMode('speaking');
      if (res.audio?.data) {
        await player.current.play(res.audio.data).catch(() => sleep(Math.min(5000, 400 + res.reply.split(/\s+/).length * 220)));
      } else {
        await sleep(Math.min(5000, 500 + res.reply.split(/\s+/).length * 230));
      }
      await acting;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      const err = e instanceof BackboneError ? e : new BackboneError('network', errorText.network);
      if (opts.voiceLabel && userId > 0) setMsgs(ms => ms.map(m => (m.id === userId && m.role === 'user' ? { ...m, text: opts.voiceLabel!, pending: false } : m)));
      if (err.kind === 'daily_limit') setLimitHit(true);
      if (err.kind === 'voice_unavailable') setVoiceOff(true);
      if (err.kind === 'signed_out' || err.kind === 'not_deployed') setStatus(err.kind);
      push({ role: 'error', kind: err.kind, text: err.message, retry: err.kind === 'network' || err.kind === 'server' ? args : undefined });
      setLive(err.message);
      setExpression(err.kind === 'daily_limit' ? 'sleepy' : 'sad');
    } finally {
      setBusy(false); setMode('idle');
      exprTimer.current = window.setTimeout(() => setExpression('neutral'), 5000);
    }
  };

  const sendText = () => {
    const t = text.trim();
    if (!t || !canTalk) return;
    setText('');
    void send({ text: t }, t);
  };

  // ---------------------------------------------------------------- hold to talk
  const stopTalk = async () => {
    if (starting.current) { wantStop.current = true; return; }
    const rec = recRef.current;
    if (!rec?.recording && !recording) return;
    setRecording(false);
    const r = await rec!.stop();
    if (!r) { setMode('idle'); setHint('Hold the mic button (or Space) while you talk, then let go.'); return; }
    const label = `🎙 Voice message · ${r.seconds.toFixed(1)} s`;
    void send({ audio: { mime: 'audio/wav', data: r.base64 } }, '…', { voiceLabel: label });
  };

  const startTalk = async () => {
    if (!canTalk || !canMic || recording || starting.current) return;
    player.current.stop();
    recRef.current ??= new MicRecorder();
    const rec = recRef.current;
    rec.onAutoStop = () => { setHint(`Recording stops at ${MAX_SECONDS} s.`); void stopRef.current(); };
    starting.current = true; wantStop.current = false;
    try {
      await rec.start();
      starting.current = false;
      setRecording(true); setMode('listening'); setExpression('neutral');
      if (wantStop.current) { wantStop.current = false; setTimeout(() => void stopRef.current(), 350); }
    } catch (e) {
      starting.current = false;
      const denied = (e as DOMException)?.name === 'NotAllowedError';
      setHint(denied ? 'Microphone access is blocked. Allow it in the address bar, or type instead.' : 'No microphone found. Type to talk instead.');
    }
  };
  const startRef = useRef(startTalk); startRef.current = startTalk;
  const stopRef = useRef(stopTalk); stopRef.current = stopTalk;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === 'BUTTON' && !t.classList.contains('br-mic')) return; // let Space press other buttons
      if (!document.querySelector('.brain')) return;
      e.preventDefault();
      void startRef.current();
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && (recRef.current?.recording || starting.current)) { e.preventDefault(); void stopRef.current(); } };
    const blur = () => { if (recRef.current?.recording) void stopRef.current(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  const faceLevel = useCallback(() => (recRef.current?.recording ? recRef.current.level() : player.current.level()), []);

  // ---------------------------------------------------------------- voice preview / memory
  const [previewing, setPreviewing] = useState(false);
  const previewVoice = async () => {
    if (!ready || busy) return;
    setPreviewing(true);
    try {
      if (draft.voice !== saved.voice) {
        // the server speaks with the saved voice: save just the voice choice first
        const c = await client.save({ ...saved, voice: draft.voice });
        setSaved(c);
      }
      await send({ text: 'Say hello in one short sentence' }, null, { preview: draft.voice });
    } catch (e) {
      push({ role: 'error', kind: e instanceof BackboneError ? e.kind : 'network', text: e instanceof BackboneError ? e.message : errorText.network });
    } finally { setPreviewing(false); }
  };

  const [memNote, setMemNote] = useState<string | null>(null);
  const [memConfirm, setMemConfirm] = useState(false);
  const resetMemory = async () => {
    setMemConfirm(false);
    try {
      const onServer = await client.resetMemory();
      setMsgs([]);
      setMemNote(onServer ? 'Memory cleared. Your robot starts fresh.' : 'Console cleared. (This server has no memory-reset route yet; robots can call reset_memory over MCP.)');
    } catch (e) { setMemNote(e instanceof BackboneError ? e.message : errorText.network); }
    setTimeout(() => setMemNote(null), 5000);
  };

  // ---------------------------------------------------------------- robots
  const defaultPlatform: PairPlatform = (PAIR_PLATFORMS.some(p => p.id === spec?.platform) ? spec!.platform : 'licheerv_claw') as PairPlatform;
  const [pairName, setPairName] = useState(spec?.name ?? '');
  const [pairPlatform, setPairPlatform] = useState<PairPlatform>(defaultPlatform);
  const [pairing, setPairing] = useState(false);
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ robot: PairedRobot; token: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  useEffect(() => { if (spec?.name) setPairName(n => n || spec.name); }, [spec?.name]);

  const mcpUrl = server?.mcpUrl ?? `${typeof location !== 'undefined' ? location.origin : ''}/api/mcp`;
  const pair = async () => {
    const name = pairName.trim() || draft.name || 'My robot';
    setPairing(true); setPairErr(null);
    try {
      const r = await client.pair(name.slice(0, 40), pairPlatform);
      setRevealed(r);
      storeRobotCredentials(mcpUrl, r.token);
      setServer(s => (s ? { ...s, robots: [...s.robots.filter(x => x.id !== r.robot.id), r.robot] } : s));
    } catch (e) {
      setPairErr(e instanceof BackboneError ? e.message : errorText.network);
    } finally { setPairing(false); }
  };
  const removeRobot = async (id: string) => {
    setConfirmRemove(null);
    try {
      await client.remove(id);
      setServer(s => (s ? { ...s, robots: s.robots.filter(r => r.id !== id) } : s));
      if (revealed?.robot.id === id) setRevealed(null);
    } catch (e) { setPairErr(e instanceof BackboneError ? e.message : errorText.network); }
  };

  // ---------------------------------------------------------------- render pieces
  const usage = server?.usage ?? { today: 0, limit: 300 };
  const usagePct = Math.min(100, (usage.today / Math.max(1, usage.limit)) * 100);
  const f = (k: keyof BackboneConfig) => `${uid}-${k}`;
  const err = (k: keyof BackboneConfig) => errors[k] ? <span className="br-err" id={`${f(k)}-err`}>{errors[k]}</span> : null;
  const aria = (k: keyof BackboneConfig) => ({ id: f(k), 'aria-invalid': !!errors[k] || undefined, 'aria-describedby': errors[k] ? `${f(k)}-err` : undefined });

  const banner = (() => {
    if (status === 'loading') return <div className="br-banner info" role="status"><span className="br-spin" aria-hidden /> Waking up your AI brain…</div>;
    if (status === 'signed_out') return (
      <div className="br-banner warn" role="status"><b>Sign in to give your robot a brain.</b> The brain runs on the PICOCEO server under your account, so your settings, robots and memory follow you. Everything below is a preview until you sign in.</div>
    );
    if (status === 'not_deployed') return (
      <div className="br-banner warn" role="status"><b>Backbone server not deployed.</b> This host doesn’t serve <code>/api/backbone</code> yet. You can still explore the brain settings; talking and pairing come online when the server ships. <button type="button" onClick={() => void load()}>Retry</button></div>
    );
    if (status === 'network') return <div className="br-banner err" role="alert"><b>Can’t reach the server.</b> {errorText.network} <button type="button" onClick={() => void load()}>Retry</button></div>;
    if (status !== 'ready') return <div className="br-banner err" role="alert"><b>Something went wrong.</b> {errorText[status]} <button type="button" onClick={() => void load()}>Retry</button></div>;
    return null;
  })();

  const faceName = draft.name || 'Robot';
  const statusLine = recording ? `Listening… ${recSecs.toFixed(1)} s / ${MAX_SECONDS} s`
    : busy && mode === 'thinking' ? 'Thinking…'
    : mode === 'speaking' ? 'Speaking…'
    : limitHit ? 'Resting until tomorrow'
    : !ready ? (status === 'loading' ? 'Connecting…' : 'Offline')
    : canMic ? 'Hold to talk, or type' : 'Type to talk';

  return (
    <div className="brain">
     <div className="br-layout">
      <div className="br-live" aria-live="polite" aria-atomic="true">{live}</div>

      {/* ================================================================ console */}
      <section className="br-console" aria-label="Talk to your robot">
        <header className="br-console-head">
          <div>
            <h2>Talk to your robot</h2>
            <p className="br-sub">
              {spec ? <>Brain for <b>{spec.name}</b> · {tools.length} tools from the design</> : <>No design open · the console uses a virtual robot</>}
            </p>
          </div>
          <div className={`br-pill ${ready ? (voiceAvailable ? 'on' : 'text') : 'off'}`} title={voiceAvailable ? 'Speech in and out' : 'Text only'}>
            <i aria-hidden /> {ready ? (voiceAvailable ? 'Voice on' : 'Text only') : status === 'loading' ? 'Connecting' : 'Offline'}
          </div>
        </header>

        <div className="br-stage">
          <RobotFace expression={expression} mode={mode} level={faceLevel} text={ticker} led={led} name={faceName} />
          <div className="br-face-name"><b>{faceName}</b><span>{statusLine}</span></div>
          <div className="br-toasts" aria-live="polite">
            {toasts.map(t => <div key={t.id} className="br-toast"><span aria-hidden>{t.icon}</span> {t.text}</div>)}
          </div>
        </div>

        <div className="br-chat" ref={listRef} role="log" aria-label="Conversation">
          {!msgs.length && (
            <div className="br-empty">
              <p>{ready ? <>Say hi to <b>{faceName}</b>. It answers with its persona, a face and real robot actions.</> : banner ? 'The console wakes up when the brain is reachable.' : ''}</p>
              {ready && (
                <div className="br-suggest">
                  {['Hi! Who are you?', 'Show me a happy face', spec?.behaviors[0] ? `Can you ${spec.behaviors[0]}?` : 'Tell me a joke', 'Set your lights to purple'].map(s => (
                    <button key={s} type="button" disabled={!canTalk} onClick={() => void send({ text: s }, s)}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {msgs.map(m => {
            if (m.role === 'user') return <div key={m.id} className={`br-msg user${m.pending ? ' pending' : ''}`}><p>{m.text}</p></div>;
            if (m.role === 'error') return (
              <div key={m.id} className={`br-msg error k-${m.kind}`} role="alert">
                <p>{m.text}</p>
                {m.retry && <button type="button" disabled={!canTalk} onClick={() => void send(m.retry!, null)}>Try again</button>}
              </div>
            );
            return (
              <div key={m.id} className="br-msg robot">
                <div className="br-msg-head">
                  <span className="br-emo" title={m.emotion}>{EXPRESSION_ICON[m.emotion]}</span>
                  <b>{faceName}</b>
                  {m.preview && <span className="br-tag">voice preview · {m.preview}</span>}
                  {m.textOnly && !m.preview && <span className="br-tag mute">text</span>}
                </div>
                <p>{m.reply || <i>(no words, just actions)</i>}</p>
                {m.actions.length > 0 && (
                  <div className="br-actions" aria-label="Robot actions">
                    {m.actions.map((a, i) => <span key={i} className={`br-act t-${a.tool}`}>▶ {actionLabel(a)}</span>)}
                  </div>
                )}
              </div>
            );
          })}
          {busy && mode === 'thinking' && <div className="br-msg robot typing" aria-label="Thinking"><span /><span /><span /></div>}
        </div>

        {(limitHit || voiceOff || hint) && (
          <div className="br-notes">
            {limitHit && <p className="br-note warn" role="status">😴 {errorText.daily_limit}</p>}
            {voiceOff && ready && !limitHit && <p className="br-note info">🔇 {errorText.voice_unavailable}</p>}
            {hint && <p className="br-note">{hint}</p>}
          </div>
        )}

        <form className="br-input" onSubmit={e => { e.preventDefault(); sendText(); }}>
          <button
            type="button"
            className={`br-mic${recording ? ' rec' : ''}`}
            disabled={!canMic || !canTalk}
            aria-pressed={recording}
            aria-label={canMic ? 'Hold to talk (or hold Space)' : 'Voice not available'}
            title={canMic ? 'Hold to talk (or hold Space)' : voiceOff ? 'Voice not available on this server' : 'Microphone not available'}
            onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); void startTalk(); }}
            onPointerUp={() => void stopTalk()}
            onPointerCancel={() => void stopTalk()}
            onContextMenu={e => e.preventDefault()}
          >
            <svg viewBox="0 0 24 24" aria-hidden><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" /></svg>
            {recording && <span className="br-mic-ring" aria-hidden style={{ ['--p' as string]: String(recSecs / MAX_SECONDS) }} />}
          </button>
          <label className="br-vh" htmlFor={`${uid}-say`}>Message</label>
          <input
            id={`${uid}-say`} ref={inputRef} value={text} onChange={e => setText(e.target.value)} maxLength={500}
            placeholder={!ready ? 'Brain offline' : limitHit ? 'Daily limit reached' : `Say something to ${faceName}…`}
            disabled={!ready || limitHit} autoComplete="off"
          />
          <button type="submit" className="primary br-send" disabled={!canTalk || !text.trim()}>{busy ? '…' : 'Send'}</button>
        </form>
        <p className="br-kbd">{canMic ? <>Hold <kbd>Space</kbd> or the mic to talk · up to {MAX_SECONDS} s</> : <>Press <kbd>Enter</kbd> to send</>}</p>
      </section>

      {/* ================================================================ config + robots */}
      <aside className="br-side" aria-label="Brain settings and robots">
        {banner}

        <div className="br-fields">
          <Section title="Identity" icon="🪪" id={`${uid}-h-id`}>
            <div className="br-grid2">
              <label className="br-field"><span>Name</span>
                <input {...aria('name')} value={draft.name} maxLength={LIMITS.name + 10} onChange={e => set('name', e.target.value)} placeholder="Pip" />
                {err('name')}
              </label>
              <label className="br-field"><span>Wake word</span>
                <input {...aria('wakeWord')} value={draft.wakeWord} maxLength={50} onChange={e => set('wakeWord', e.target.value)} placeholder="hey pip" />
                {err('wakeWord')}
              </label>
            </div>
            <label className="br-field"><span>Greeting <em>{draft.greeting.length}/{LIMITS.greeting}</em></span>
              <input {...aria('greeting')} value={draft.greeting} onChange={e => set('greeting', e.target.value)} placeholder="Hi, I'm Pip!" />
              {err('greeting')}
            </label>
            <div className="br-field">
              <span id={`${uid}-tpl`}>Persona templates</span>
              <div className="br-templates" role="group" aria-labelledby={`${uid}-tpl`}>
                {PERSONAS.map(p => {
                  const nm = draft.name.trim() || 'Pip';
                  const text = p.persona.replace(/\{name\}/g, nm);
                  const on = draft.persona === text;
                  return (
                    <button key={p.id} type="button" className={on ? 'on' : ''} aria-pressed={on}
                      onClick={() => { setDraft(d => ({ ...d, persona: text, greeting: p.greeting.replace(/\{name\}/g, nm), style: p.style, audience: p.audience })); setErrors({}); setSaveNote(null); }}>
                      <span aria-hidden>{p.icon}</span>{p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="br-field"><span>Persona <em className={draft.persona.length > LIMITS.persona ? 'over' : ''}>{draft.persona.length}/{LIMITS.persona}</em></span>
              <textarea {...aria('persona')} rows={5} value={draft.persona} onChange={e => set('persona', e.target.value)} placeholder="Who is your robot? How does it talk, what does it love, what should it never do?" />
              {err('persona')}
            </label>
            <div className="br-grid2">
              <label className="br-field"><span>Style</span>
                <select id={f('style')} value={draft.style} onChange={e => set('style', e.target.value as BackboneConfig['style'])}>
                  {STYLES.map(s => <option key={s} value={s}>{STYLE_LABEL[s]}</option>)}
                </select>
              </label>
              <label className="br-field"><span>Language</span>
                <select id={f('language')} value={draft.language} onChange={e => set('language', e.target.value as BackboneConfig['language'])}>
                  {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
            </div>
            <label className="br-field"><span>Reply length <em>≤ {draft.maxWords} words</em></span>
              <input type="range" min={LIMITS.maxWords[0]} max={LIMITS.maxWords[1]} step={5} value={draft.maxWords} onChange={e => set('maxWords', Number(e.target.value))} />
            </label>
            <label className="br-switch">
              <input type="checkbox" checked={draft.audience === 'kids'} onChange={e => set('audience', e.target.checked ? 'kids' : 'general')} />
              <i aria-hidden />
              <span><b>Kids mode</b><small>Extra safety rules, simple words, no scary or grown-up topics.</small></span>
            </label>
          </Section>

          <Section title="Voice" icon="🎤" id={`${uid}-h-voice`}
            extra={<button type="button" className="br-preview" disabled={!ready || busy || previewing || limitHit || !voiceAvailable} onClick={() => void previewVoice()}
              title={voiceAvailable ? 'Hear this voice say hello' : 'Voice not available'}>{previewing ? 'Playing…' : '▶ Preview'}</button>}>
            <div className="br-voices" role="radiogroup" aria-label="Voice">
              {VOICES.map(v => (
                <label key={v.id} className={`br-voice${draft.voice === v.id ? ' on' : ''}`}>
                  <input type="radio" name={`${uid}-voice`} value={v.id} checked={draft.voice === v.id} onChange={() => set('voice', v.id)} />
                  <b>{v.id}</b><small>{v.hint}</small>
                </label>
              ))}
            </div>
            {ready && !voiceAvailable && <p className="br-help">This server has no speech key yet, so the robot replies in text. Voice settings are saved for later.</p>}
          </Section>

          <Section title="Abilities" icon="🦾" id={`${uid}-h-ab`}>
            <p className="br-help">Which robot tools the brain may use. The robot only offers what its hardware has.</p>
            <div className="br-abilities">
              {([
                ['face', '🙂', 'Face & text', abilities.virtualDisplay ? 'virtual face in the console' : 'robot display'],
                ['motion', '🦿', 'Motion', abilities.behaviors.length || abilities.joints.length ? `${abilities.behaviors.length} behaviours · ${abilities.joints.length} joints` : 'no design open'],
                ['leds', '💡', 'LEDs', abilities.leds ? 'LEDs in the design' : 'no LEDs in this design'],
              ] as const).map(([k, icon, label, sub]) => (
                <label key={k} className="br-switch">
                  <input type="checkbox" checked={draft.abilities[k]} onChange={e => set('abilities', { ...draft.abilities, [k]: e.target.checked })} />
                  <i aria-hidden />
                  <span><b><span aria-hidden>{icon}</span> {label}</b><small>{sub}</small></span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Memory" icon="🧠" id={`${uid}-h-mem`}>
            <label className="br-field"><span>Remembers <em>{draft.memoryTurns === 0 ? 'nothing (every turn is fresh)' : `last ${draft.memoryTurns} exchanges`}</em></span>
              <input type="range" min={LIMITS.memoryTurns[0]} max={LIMITS.memoryTurns[1]} step={1} value={draft.memoryTurns} onChange={e => set('memoryTurns', Number(e.target.value))} aria-valuetext={`${draft.memoryTurns} exchanges`} />
            </label>
            <div className="br-row">
              {memConfirm ? (
                <>
                  <span className="br-help">Forget the console conversation?</span>
                  <button type="button" className="br-danger" onClick={() => void resetMemory()}>Yes, forget</button>
                  <button type="button" className="ghost" onClick={() => setMemConfirm(false)}>Cancel</button>
                </>
              ) : <button type="button" disabled={!ready} onClick={() => setMemConfirm(true)}>↺ Reset memory</button>}
              {memNote && <span className="br-help" role="status">{memNote}</span>}
            </div>
          </Section>

          <Section title="Usage today" icon="📊" id={`${uid}-h-use`}>
            <div className={`br-meter${usagePct >= 100 ? ' full' : usagePct >= 80 ? ' high' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.today} aria-label="Turns used today">
              <i style={{ width: `${usagePct}%` }} />
            </div>
            <p className="br-help"><b>{usage.today}</b> of {usage.limit} turns · shared PICOCEO AI key, resets daily. No API key needed.</p>
          </Section>
        </div>

        <div className={`br-savebar${dirty ? ' dirty' : ''}`}>
          <span className={`br-save-note ${saveNote?.tone ?? ''}`} role="status" aria-live="polite">
            {saveNote ? saveNote.text : dirty ? '● Unsaved changes' : ready ? 'All changes saved' : 'Not connected'}
          </span>
          <button type="button" className="ghost" disabled={!dirty || saving} onClick={() => { setDraft(saved); setErrors({}); setSaveNote(null); }}>Revert</button>
          <button type="button" className="primary" disabled={!dirty || saving || !ready} onClick={() => void save()} title="Save (Ctrl+S)">{saving ? 'Saving…' : 'Save brain'}</button>
        </div>

        {/* ---------------------------------------------------------------- robots */}
        <Section title="Robots" icon="🤖" id={`${uid}-h-robots`} extra={<span className="br-count">{server?.robots.length ?? 0} paired</span>}>
          <form className="br-pair" onSubmit={e => { e.preventDefault(); void pair(); }}>
            <label className="br-field"><span>Robot name</span>
              <input value={pairName} maxLength={40} onChange={e => setPairName(e.target.value)} placeholder={draft.name || 'My robot'} />
            </label>
            <div className="br-field">
              <span id={`${uid}-plat`}>Platform</span>
              <div className="br-platforms" role="radiogroup" aria-labelledby={`${uid}-plat`}>
                {PAIR_PLATFORMS.map(p => (
                  <label key={p.id} className={`br-plat${pairPlatform === p.id ? ' on' : ''}`}>
                    <input type="radio" name={`${uid}-plat`} value={p.id} checked={pairPlatform === p.id} onChange={() => setPairPlatform(p.id)} />
                    <span aria-hidden>{p.icon}</span><b>{p.short}</b>
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" className="primary" disabled={!ready || pairing}>{pairing ? 'Pairing…' : '＋ Pair a robot'}</button>
            {pairErr && <p className="br-err" role="alert">{pairErr}</p>}
          </form>

          {revealed && (
            <div className="br-reveal" role="region" aria-label="New robot token">
              <div className="br-reveal-head">
                <b>🔑 {revealed.robot.name} is paired</b>
                <span className="br-help">Copy the token now: it is shown <b>once</b> and only its hash is stored.</span>
              </div>
              <div className="br-kv"><span>Token</span><code className="br-secret">{revealed.token}</code><CopyButton text={revealed.token} /></div>
              <div className="br-kv"><span>MCP URL</span><code>{mcpUrl}</code><CopyButton text={mcpUrl} /></div>
              <div className="br-code">
                <div className="br-code-head"><span>config.py</span><CopyButton text={configPySnippet(mcpUrl, revealed.token, revealed.robot.name)} /></div>
                <pre>{configPySnippet(mcpUrl, revealed.token, revealed.robot.name)}</pre>
              </div>
              <p className="br-help">Saved for the Code editor too: it fills <code>BACKBONE_URL</code> and <code>BACKBONE_TOKEN</code> in the robot app.</p>
              <button type="button" onClick={() => setRevealed(null)}>I saved it, hide the token</button>
            </div>
          )}

          <ul className="br-robots">
            {(server?.robots ?? []).length === 0 && <li className="br-none">No robots yet. Pair one, paste the snippet into its config.py and it shows up here.</li>}
            {(server?.robots ?? []).map(r => {
              const seen = toMs(r.lastSeen);
              const online = seen != null && now - seen < 120000;
              const pm = platformMeta(r.platform);
              return (
                <li key={r.id} className="br-robot">
                  <span className="br-robot-ico" aria-hidden>{pm.icon}</span>
                  <div className="br-robot-main">
                    <b>{r.name}</b>
                    <small>{pm.label} · {online ? <span className="br-online">● online</span> : <>last seen {relTime(seen, now)}</>}</small>
                  </div>
                  {confirmRemove === r.id ? (
                    <span className="br-row">
                      <button type="button" className="br-danger" onClick={() => void removeRobot(r.id)}>Remove</button>
                      <button type="button" className="ghost" onClick={() => setConfirmRemove(null)}>Keep</button>
                    </span>
                  ) : (
                    <button type="button" className="ghost br-x" aria-label={`Remove ${r.name}`} onClick={() => setConfirmRemove(r.id)}>✕</button>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>

        {/* ---------------------------------------------------------------- how it connects */}
        <Section title="How it connects" icon="🔌" id={`${uid}-h-how`}>
          <ConnectDiagram />
          <dl className="br-dl">
            <dt>Endpoint</dt><dd><code>POST {mcpUrl}</code> <CopyButton text={mcpUrl} /></dd>
            <dt>Protocol</dt><dd>MCP <code>2025-06-18</code>, Streamable HTTP, stateless JSON-RPC 2.0 (JSON replies, no SSE). <code>Authorization: Bearer &lt;robot token&gt;</code></dd>
            <dt>Backbone tools</dt><dd className="br-tools"><code>converse</code><code>get_profile</code><code>reset_memory</code></dd>
            <dt>Robot tools</dt>
            <dd className="br-tools">
              {tools.map(t => <code key={t.name} title={t.description}>{t.name}</code>)}
              <small>{spec ? `from “${spec.name}”` : 'open a design to add its behaviours and joints'}</small>
            </dd>
          </dl>
          <details className="br-code">
            <summary><span>Try it: <code>initialize</code> with curl</span><CopyButton text={curlInitialize(mcpUrl)} /></summary>
            <pre>{curlInitialize(mcpUrl)}</pre>
          </details>
          <details className="br-code">
            <summary><span>Tool schemas this design sends</span></summary>
            <pre>{JSON.stringify(tools, null, 2)}</pre>
          </details>
        </Section>
      </aside>
     </div>
    </div>
  );
}

function ConnectDiagram() {
  const NW = 100;
  const nodes = [
    { x: 4, label: 'Robot', sub: 'mic · speaker', icon: '🤖' },
    { x: 136, label: 'MCP', sub: '/api/mcp', icon: '🔗' },
    { x: 268, label: 'Backbone', sub: 'persona · memory', icon: '🧠' },
    { x: 396, label: 'Meta Muse', sub: 'Transcribe · Spark', icon: '✨' },
  ];
  return (
    <svg className="br-diagram" viewBox="0 0 500 150" role="img" aria-label="Robot sends audio over MCP to the backbone, which runs speech-to-text, the language model and text-to-speech, then returns a reply, a face and actions to the robot.">
      <defs>
        <marker id="br-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="br-d-head" /></marker>
      </defs>
      {nodes.slice(0, -1).map((n, i) => (
        <line key={i} x1={n.x + NW + 3} y1={48} x2={nodes[i + 1].x - 4} y2={48} className="br-d-line fwd" markerEnd="url(#br-arrow)" />
      ))}
      <path d="M446 82 C446 136 54 136 54 84" className="br-d-line back" markerEnd="url(#br-arrow)" fill="none" />
      <text x={250} y={146} textAnchor="middle" className="br-d-cap">reply · WAV · emotion · actions[] → robot runs its tools</text>
      <text x={250} y={11} textAnchor="middle" className="br-d-cap sm">tools/call converse {'{'} audio 16 kHz WAV · robot_tools · state {'}'}</text>
      {nodes.map(n => (
        <g key={n.label} transform={`translate(${n.x} 18)`}>
          <rect width={NW} height={60} rx={12} className="br-d-node" />
          <text x={NW / 2} y={26} textAnchor="middle" className="br-d-title">{n.icon} {n.label}</text>
          <text x={NW / 2} y={44} textAnchor="middle" className="br-d-sub">{n.sub}</text>
        </g>
      ))}
    </svg>
  );
}
