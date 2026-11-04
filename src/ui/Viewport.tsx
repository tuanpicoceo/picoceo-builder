import { useEffect, useMemo, useRef, useState } from 'react';
import type { Assembly } from '../cad/types';
import { sample, type Behavior } from '../design/behaviors';
import { firmwareFiles } from '../design/firmware';
import { fk, type Angles } from '../design/kinematics';
import type { RobotSpec } from '../design/spec';
import { download, firmwareZip, slug } from '../export/files';
import type { Sim, Telemetry } from '../sim/physics';
import {
  DEFAULT_RL_POLICY,
  DEFAULT_RL_TRAINING_CONFIG,
  UNTRAINED_RL_POLICY,
  evaluateRLPolicy,
  readRootImu,
  stabilizeKeyframeTargets,
  trainRLPolicy,
  type RLEpisodeMetric,
  type RLPolicyParams,
  type RLTrainingConfig,
} from '../sim/rl';
import { Viewer } from '../viewer/Viewer';
import * as THREE from 'three';

type Mode = 'assembly' | 'print' | 'sim';

export function Viewport(props: {
  built: { spec: RobotSpec; asm: Assembly } | null;
  building?: boolean;
  behaviors: Behavior[];
  selected: string | null;
  onPick: (id: string | null) => void;
  error: string | null;
  externalMode?: { mode: Mode; behavior?: string; seq: number } | null;
  rlPolicy?: RLPolicyParams;
  onPolicyChange?: (policy: RLPolicyParams) => void;
  lastFirmwarePolicy?: RLPolicyParams | null;
  onUpdateFirmware?: (policy?: RLPolicyParams) => void;
  /** Modes this view offers (Phase 1: assembly + sim; Phase 2 print tab: print). The first is the start mode. */
  modes?: Mode[];
  /** Bump to play the reveal: parts fly in (explode max → 0), then a slow turntable spin. */
  reveal?: number;
  /** Show a rotating holographic placeholder while there is no assembly yet (build theatre). */
  placeholder?: boolean;
  theme?: 'dark' | 'light';
}) {
  const modes = props.modes ?? ['assembly', 'print', 'sim'];
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const sim = useRef<Sim | null>(null);
  const [mode, setMode] = useState<Mode>(modes[0]);
  const [explode, setExplode] = useState(0);
  const [section, setSection] = useState(false);
  const [sectionX, setSectionX] = useState(0);
  const [angles, setAngles] = useState<Angles>({});
  const [running, setRunning] = useState(false);
  const [behavior, setBehavior] = useState<string>('manual');
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [opts, setOpts] = useState({ clampBase: true, payload: true, obstacles: true, ramp: false, follow: false });
  const [simKey, setSimKey] = useState(0);

  // Reinforcement Learning state & hyperparameters
  const [rlPolicy, setRlPolicy] = useState<RLPolicyParams>(() => props.rlPolicy ?? { ...DEFAULT_RL_POLICY });
  const [rlConfig, setRlConfig] = useState<RLTrainingConfig>(() => ({ ...DEFAULT_RL_TRAINING_CONFIG }));
  const [rlTraining, setRlTraining] = useState(false);
  const [rlHistory, setRlHistory] = useState<RLEpisodeMetric[]>([]);
  const [showRlHud, setShowRlHud] = useState(false);
  const [rlTab, setRlTab] = useState<'train' | 'policy'>('train');
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const stopRlRef = useRef(false);
  const rlTrainingRef = useRef(false);
  const resetSimRef = useRef<(() => void) | null>(null);
  const rlPolicyRef = useRef<RLPolicyParams>(rlPolicy);
  rlPolicyRef.current = rlPolicy;
  const behaviorRef = useRef(behavior);
  behaviorRef.current = behavior;

  useEffect(() => {
    if (props.rlPolicy) {
      setRlPolicy(props.rlPolicy);
      rlPolicyRef.current = props.rlPolicy;
    }
  }, [props.rlPolicy]);

  const isFirmwareOutdated = useMemo(() => {
    if (!props.lastFirmwarePolicy) return true;
    const p1 = rlPolicy;
    const p2 = props.lastFirmwarePolicy;
    return (
      Math.abs(p1.strideAmpDeg - p2.strideAmpDeg) > 0.05 ||
      Math.abs(p1.waddleAmpDeg - p2.waddleAmpDeg) > 0.05 ||
      Math.abs(p1.freqHz - p2.freqHz) > 0.02 ||
      Math.abs(p1.phaseLeadRad - p2.phaseLeadRad) > 0.02 ||
      Math.abs(p1.pitchTrimDeg - p2.pitchTrimDeg) > 0.05 ||
      Math.abs(p1.kpPitch - p2.kpPitch) > 0.02 ||
      Math.abs(p1.kpRoll - p2.kpRoll) > 0.02
    );
  }, [rlPolicy, props.lastFirmwarePolicy]);

  const handleSavePolicy = () => {
    props.onPolicyChange?.(rlPolicy);
    try {
      localStorage.setItem('cyberbuild.rl_policy.latest', JSON.stringify(rlPolicy));
      if (props.built?.spec.name) {
        localStorage.setItem(`cyberbuild.rl_policy.${props.built.spec.name}`, JSON.stringify(rlPolicy));
      }
    } catch {}
    setSavedToast('✓ Policy saved to browser storage');
    setTimeout(() => setSavedToast(null), 3000);
  };

  const handleUpdateFirmware = () => {
    props.onPolicyChange?.(rlPolicy);
    props.onUpdateFirmware?.(rlPolicy);
    setSavedToast('⚡ Firmware updated with latest gait params!');
    setTimeout(() => setSavedToast(null), 3000);
  };

  const handleDownloadFirmware = () => {
    if (!props.built) return;
    const files = firmwareFiles(props.built.spec, props.built.asm, props.behaviors, rlPolicy);
    download(
      `${slug(props.built.spec.name)}_firmware.zip`,
      firmwareZip(props.built.spec, files),
      'application/zip',
    );
    props.onUpdateFirmware?.(rlPolicy);
    setSavedToast('⬇ Firmware downloaded (.zip)');
    setTimeout(() => setSavedToast(null), 3000);
  };

  const keys = useRef(new Set<string>());
  const asm = props.built?.asm ?? null;
  const spec = props.built?.spec;
  const servoLinks = asm?.links.filter(l => l.joint?.actuator.kind === 'servo') ?? [];
  const isRover = spec?.archetype === 'rover' || Boolean(asm?.links.some(l => l.id === 'wheel_L'));
  const isMobileRobot =
    isRover ||
    spec?.archetype === 'quadruped' ||
    Boolean(
      asm?.links.some(
        l => l.id.startsWith('leg_') || l.id === 'segment_1' || l.id === 'wheel_L',
      ),
    );

  const totalPlannedEpisodes = rlConfig.generations * rlConfig.populationSize;

  useEffect(() => {
    if (!props.externalMode || !modes.includes(props.externalMode.mode)) return;
    setMode(props.externalMode.mode);
    if (props.externalMode.mode === 'sim') {
      setRunning(true);
      if (props.externalMode.behavior) setBehavior(props.externalMode.behavior);
      setSimKey(k => k + 1);
    }
  }, [props.externalMode?.seq]);

  useEffect(() => {
    const v = new Viewer(host.current!);
    viewer.current = v;
    return () => v.dispose();
  }, []);
  useEffect(() => { if (viewer.current) viewer.current.onPick = props.onPick; }, [props.onPick]);

  // new assembly
  const first = useRef(true);
  useEffect(() => {
    if (!viewer.current) return;
    if (!asm) {
      viewer.current.clearAssembly();
      first.current = true;
      setRunning(false);
      setTele(null);
      setAngles({});
      return;
    }
    viewer.current.setAssembly(asm, !first.current);
    first.current = false;
    viewer.current.setExplode(explode);
    viewer.current.setMode(mode === 'print' ? 'print' : 'assembly');
    setAngles(a => Object.fromEntries(Object.entries(a).filter(([k]) => asm.links.some(l => l.id === k))));
    if (mode === 'sim') setSimKey(k => k + 1);
    viewer.current.setLedColor([40, 200, 255]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asm]);

  useEffect(() => { viewer.current?.highlight(props.selected); }, [props.selected, asm]);
  useEffect(() => { viewer.current?.setExplode(mode === 'assembly' ? explode : 0); }, [explode, mode]);

  // theme: the 3D background follows the app theme
  useEffect(() => {
    if (viewer.current) viewer.current.scene.background = new THREE.Color(props.theme === 'light' ? '#e9eef6' : '#0f1218');
  }, [props.theme]);

  // turntable spin (stops as soon as the user grabs the view)
  const [spin, setSpin] = useState(false);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.controls.autoRotate = spin && mode !== 'print';
    v.controls.autoRotateSpeed = 1.1;
    if (!spin) return;
    const stop = () => setSpin(false);
    v.renderer.domElement.addEventListener('pointerdown', stop);
    v.renderer.domElement.addEventListener('wheel', stop, { passive: true });
    return () => { v.renderer.domElement.removeEventListener('pointerdown', stop); v.renderer.domElement.removeEventListener('wheel', stop); };
  }, [spin, mode]);

  // reveal: fly the parts in from an exploded view, then spin slowly
  const [revealing, setRevealing] = useState(false);
  const [replay, setReplay] = useState(0);
  const lastReveal = useRef(`${props.reveal ?? 0}:0`);      // a remount (phase switch) does not replay it
  useEffect(() => {
    const v = viewer.current;
    const key = `${props.reveal ?? 0}:${replay}`;
    if (key === lastReveal.current || !v || !asm) return;
    lastReveal.current = key;
    if (mode !== 'assembly') setMode('assembly');
    setExplode(0);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { v.setExplode(0); return; }
    let raf = 0, done = false;
    const t0 = performance.now(), D = 1800, F = 1.6;
    setRevealing(true);
    const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); v.setExplode(0); setRevealing(false); setSpin(true); };
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / D);
      const e = 1 - Math.pow(1 - k, 3);
      v.setExplode(F * (1 - e));
      if (k < 1) raf = requestAnimationFrame(tick); else finish();
    };
    v.setExplode(F);
    raf = requestAnimationFrame(tick);
    const timer = window.setTimeout(finish, D + 120);     // rAF pauses in hidden tabs; the parts must still land
    return () => { done = true; cancelAnimationFrame(raf); window.clearTimeout(timer); v.setExplode(0); setRevealing(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reveal, replay]);

  // placeholder: a rotating wireframe robot while the AI is still designing
  useEffect(() => {
    const v = viewer.current;
    if (!v || !props.placeholder || asm) return;
    const g = new THREE.Group();
    const accent = new THREE.Color(props.theme === 'light' ? '#3b6fe0' : '#4f8cff');
    const lineMat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.85 });
    const fillMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.08, depthWrite: false });
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, fillMat); m.position.set(x, y, z);
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), lineMat));
      g.add(m); return m;
    };
    add(new THREE.BoxGeometry(90, 26, 70), 0, 13, 0);                      // base
    add(new THREE.CylinderGeometry(9, 9, 22, 16), 0, 37, 0);               // neck
    const head = add(new THREE.SphereGeometry(42, 18, 12), 0, 86, 0);      // head
    head.scale.set(1.15, 0.9, 1);
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#2ec4f1' });
    for (const x of [-15, 15]) { const e = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), eyeMat); e.position.set(x, 90, 36); g.add(e); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(80, 0.8, 6, 96), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.6 }));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    v.scene.add(g);
    v.controls.target.set(0, 55, 0);
    v.camera.position.set(190, 150, 230);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      g.rotation.y = t * 0.6;
      ring.position.y = 10 + ((t * 40) % 110);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - ((t * 40) % 110) / 110);
      lineMat.opacity = 0.55 + 0.3 * Math.sin(t * 3);
      raf = requestAnimationFrame(tick);
    };
    if (!reduce) tick();
    return () => {
      cancelAnimationFrame(raf);
      v.scene.remove(g);
      g.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
      lineMat.dispose(); fillMat.dispose(); eyeMat.dispose(); (ring.material as THREE.Material).dispose();
    };
  }, [props.placeholder, asm, props.theme]);
  useEffect(() => {
    if (!asm || !viewer.current) return;
    const b = asm.parts.reduce((m, p) => Math.max(m, Math.abs(p.bbox.min[0]), Math.abs(p.bbox.max[0])), 10);
    viewer.current.setSection(section && mode !== 'print', sectionX * b);
  }, [section, sectionX, mode, asm]);
  useEffect(() => { if (mode === 'assembly' && asm) viewer.current?.setPose(fk(asm.links, angles)); }, [angles, mode, asm]);
  useEffect(() => {
    if (!viewer.current) return;
    viewer.current.setMode(mode === 'print' ? 'print' : 'assembly');
    if (mode !== 'sim') {
      viewer.current.clearObstacles();
      viewer.current.follow = false;
      setRunning(false);
      stopRlRef.current = true;
      setRlTraining(false);
    } else {
      setRunning(true);
      if (behavior === 'manual' && props.behaviors.length > 0) {
        setBehavior(props.behaviors[0].id);
      }
    }
  }, [mode]);
  useEffect(() => { if (viewer.current) viewer.current.follow = mode === 'sim' && opts.follow; }, [opts.follow, mode]);

  useEffect(() => {
    if (behavior !== 'manual' && behavior !== 'rl_policy' && !props.behaviors.some(b => b.id === behavior)) {
      setBehavior(props.behaviors[0]?.id ?? 'manual');
    }
  }, [props.behaviors, behavior]);

  // keyboard drive
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest('input,textarea,select')) return; keys.current.add(e.key.toLowerCase()); };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const handleTrainRL = async () => {
    if (!asm) return;
    if (rlTraining) {
      stopRlRef.current = true;
      rlTrainingRef.current = false;
      setRlTraining(false);
      resetSimRef.current?.();
      return;
    }
    stopRlRef.current = false;
    rlTrainingRef.current = true;
    setRlTraining(true);
    setShowRlHud(true);
    setRlHistory([]);

    // If startFromScratch is checked, begin from UNTRAINED_RL_POLICY; otherwise retain current learned policy!
    const startPolicy = rlConfig.startFromScratch
      ? { ...UNTRAINED_RL_POLICY }
      : { ...rlPolicyRef.current };
    setRlPolicy(startPolicy);
    rlPolicyRef.current = startPolicy;
    setBehavior('rl_policy');
    behaviorRef.current = 'rl_policy';
    setAngles({});
    resetSimRef.current?.();

    try {
      const { initPhysics } = await import('../sim/physics');
      await initPhysics();
      // Give browser 1 frame to render the reset original state [0, 0, 0] before episodes begin
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));

      const res = await trainRLPolicy(asm, {
        config: rlConfig,
        initialPolicy: startPolicy,
        liveSim: sim.current,
        onVisualStep: async s => {
          viewer.current?.setPose(s.poses());
          setTele(s.telemetry());
          await new Promise(resolve => setTimeout(resolve, 4));
        },
        shouldStop: () => stopRlRef.current,
        onEpisode: (metric, currentBest) => {
          setRlHistory(prev => [...prev, metric]);
          if (metric.isNewBest) {
            setRlPolicy({ ...currentBest });
            rlPolicyRef.current = { ...currentBest };
            props.onPolicyChange?.({ ...currentBest });
            try {
              localStorage.setItem('cyberbuild.rl_policy.latest', JSON.stringify(currentBest));
              if (spec?.name) {
                localStorage.setItem(`cyberbuild.rl_policy.${spec.name}`, JSON.stringify(currentBest));
              }
            } catch {}
          }
        },
      });
      setRlPolicy({ ...res.bestPolicy });
      rlPolicyRef.current = { ...res.bestPolicy };
      props.onPolicyChange?.({ ...res.bestPolicy });
      try {
        localStorage.setItem('cyberbuild.rl_policy.latest', JSON.stringify(res.bestPolicy));
        if (spec?.name) {
          localStorage.setItem(`cyberbuild.rl_policy.${spec.name}`, JSON.stringify(res.bestPolicy));
        }
      } catch {}
      setSavedToast('✓ Training finished · Policy auto-saved');
      setTimeout(() => setSavedToast(null), 4000);
      setBehavior('rl_policy');
      behaviorRef.current = 'rl_policy';
    } catch (err) {
      console.error('RL training error:', err);
    } finally {
      rlTrainingRef.current = false;
      setRlTraining(false);
      // Reset the 3D model back to its exact original state [0, 0, 0] after the learning run finishes
      setRunning(false);
      runningRef.current = false;
      resetSimRef.current?.();
    }
  };

  // simulation lifecycle
  useEffect(() => {
    if (mode !== 'sim' || !asm || !spec) return;
    let alive = true, raf = 0, frame = 0;
    let tBeh = 0, last = performance.now();
    import('../sim/physics').then(async ({ Sim, initPhysics }) => {
      try {
        await initPhysics();
        if (!alive) return;
        sim.current?.dispose();
        const s = new Sim(asm, { clampBase: spec.archetype === 'arm' ? opts.clampBase : false, payloadG: spec.archetype === 'arm' && opts.payload ? spec.params.payloadG : 0, obstacles: isRover && opts.obstacles, ramp: isRover && opts.ramp });
        sim.current = s;
        resetSimRef.current = () => {
          s.reset();
          tBeh = 0;
          last = performance.now();
          viewer.current?.setPose(s.poses());
          viewer.current?.setObstacles(s.obstacles(), isRover && opts.ramp);
          setTele(s.telemetry());
        };
        const loop = () => {
          raf = requestAnimationFrame(loop);
          const now = performance.now();
          const dt = Math.min(0.05, (now - last) / 1000); last = now;
          if (rlTrainingRef.current) return;
          if (!runningRef.current) { viewer.current?.setPose(s.poses()); return; }
          let targets: Record<string, number> = { ...anglesRef.current };
          let drive: [number, number] = [0, 0];

          const pol = rlPolicyRef.current;
          s.balanceGains = {
            kpPitch: pol.kpPitch,
            kdPitch: pol.kdPitch,
            kpRoll: pol.kpRoll,
            kdRoll: pol.kdRoll,
          };

          const curBehavior = behaviorRef.current;
          const beh = props.behaviors.find(b => b.id === curBehavior);

          if (curBehavior === 'rl_policy') {
            tBeh += dt;
            const imu = readRootImu(s, asm);
            const rlOut = evaluateRLPolicy(pol, tBeh, imu, asm);
            targets = { ...targets, ...rlOut.joints };
            drive = rlOut.drive;
            if (frame % 6 === 0) viewer.current?.setLedColor([56, 209, 122]);
          } else if (beh) {
            tBeh += dt;
            const smp = sample(beh, tBeh);
            const imu = readRootImu(s, asm);
            const stabilized = stabilizeKeyframeTargets(smp.joints, imu, asm, pol);
            targets = { ...targets, ...stabilized };
            drive = smp.drive;
            if (frame % 6 === 0) viewer.current?.setLedColor(smp.color);
          } else {
            const k = keys.current;
            const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
            const t = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
            drive = [Math.max(-1, Math.min(1, f + t * 0.6)), Math.max(-1, Math.min(1, f - t * 0.6))];
          }
          s.command(targets, { wheel_L: drive[0], wheel_R: drive[1], spin: drive[0] });
          s.step(dt);
          viewer.current?.setPose(s.poses());
          viewer.current?.setObstacles(s.obstacles(), isRover && opts.ramp);
          if (frame++ % 6 === 0) setTele(s.telemetry());
        };
        viewer.current?.setPose(s.poses());
        viewer.current?.setObstacles(s.obstacles(), isRover && opts.ramp);
        setTele(s.telemetry());
        loop();
      } catch (err) {
        console.error('Physics simulation error:', err);
      }
    }).catch(err => {
      console.error('Physics load error:', err);
    });
    return () => { alive = false; cancelAnimationFrame(raf); resetSimRef.current = null; sim.current?.dispose(); sim.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, asm, simKey, opts.clampBase, opts.payload, opts.obstacles, opts.ramp]);

  const runningRef = useRef(running); runningRef.current = running;
  const anglesRef = useRef(angles); anglesRef.current = angles;

  const latestMetric = rlHistory.length > 0 ? rlHistory[rlHistory.length - 1] : null;
  const initialMetric = rlHistory.length > 0 ? rlHistory[0] : null;
  const bestMetric = rlHistory.reduce<RLEpisodeMetric | null>(
    (best, m) => (!best || m.reward > best.reward ? m : best),
    null,
  );

  const updatePolicyParam = <K extends keyof RLPolicyParams>(k: K, v: number) => {
    setRlPolicy(prev => {
      const next = { ...prev, [k]: v };
      rlPolicyRef.current = next;
      props.onPolicyChange?.(next);
      try {
        localStorage.setItem('cyberbuild.rl_policy.latest', JSON.stringify(next));
        if (spec?.name) {
          localStorage.setItem(`cyberbuild.rl_policy.${spec.name}`, JSON.stringify(next));
        }
      } catch {}
      return next;
    });
    if (behavior !== 'rl_policy') {
      setBehavior('rl_policy');
    }
  };

  return (
    <section className={`viewport ${revealing ? 'revealing' : ''}`}>
      {asm && (
        <div className="toolbar">
          <div className="seg" hidden={modes.length < 2}>
            {modes.map(m => <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); if (m === 'sim') setRunning(true); }}>{m === 'assembly' ? 'Assembly' : m === 'print' ? 'Print plates' : 'Simulate'}</button>)}
          </div>
          {mode === 'assembly' && <>
            <label className="slider">Explode<input type="range" min={0} max={1} step={0.01} value={explode} onChange={e => setExplode(+e.target.value)} /></label>
            <label className="check"><input type="checkbox" checked={section} onChange={e => setSection(e.target.checked)} />Section</label>
            {section && <input type="range" min={-1} max={1} step={0.01} value={sectionX} onChange={e => setSectionX(+e.target.value)} aria-label="Section position" />}
            <button className={spin ? 'on' : ''} aria-pressed={spin} onClick={() => setSpin(s => !s)} title="Slow turntable spin">⟳ Spin</button>
            <button onClick={() => { setSpin(false); setReplay(r => r + 1); }} disabled={revealing} title="Replay the assembly animation">▶ Assemble</button>
          </>}
          {mode === 'sim' && <>
            <button className={running ? 'on' : 'primary'} onClick={() => setRunning(r => !r)}>{running ? '❚❚ Pause' : '▶ Run'}</button>
            <button onClick={() => { setAngles({}); resetSimRef.current?.(); }}>↺ Reset</button>
            <select value={behavior} onChange={e => { setBehavior(e.target.value); behaviorRef.current = e.target.value; resetSimRef.current?.(); }} aria-label="Behaviour">
              <option value="manual">{isRover ? 'Manual (WASD / arrows)' : 'Manual (joint sliders)'}</option>
              <option value="rl_policy">🤖 RL Policy (Closed-Loop Balance)</option>
              {props.behaviors.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
            {isMobileRobot && (
              <button
                className={rlTraining ? 'on' : 'ai-rerun-btn'}
                onClick={() => {
                  if (!showRlHud && !rlTraining) {
                    setShowRlHud(true);
                  } else {
                    handleTrainRL();
                  }
                }}
                title="Open Reinforcement Learning Studio & train locomotion policy"
              >
                {rlTraining ? `⏹ Stop RL (${rlHistory.length}/${totalPlannedEpisodes})` : '🧠 RL Studio & Train'}
              </button>
            )}
            {isRover && <><label className="check"><input type="checkbox" checked={opts.obstacles} onChange={e => setOpts({ ...opts, obstacles: e.target.checked })} />Obstacles</label>
              <label className="check"><input type="checkbox" checked={opts.ramp} onChange={e => setOpts({ ...opts, ramp: e.target.checked })} />12° ramp</label></>}
            {isMobileRobot && (
              <label className="check"><input type="checkbox" checked={opts.follow} onChange={e => setOpts({ ...opts, follow: e.target.checked })} />Follow</label>
            )}
            {spec?.archetype === 'arm' && <><label className="check"><input type="checkbox" checked={opts.clampBase} onChange={e => setOpts({ ...opts, clampBase: e.target.checked })} />Base clamped</label>
              <label className="check"><input type="checkbox" checked={opts.payload} onChange={e => setOpts({ ...opts, payload: e.target.checked })} />Payload {spec.params.payloadG} g</label></>}
          </>}
          <span className="grow" />
          <button onClick={() => { const url = viewer.current?.screenshot(); if (url) { const a = document.createElement('a'); a.href = url; a.download = 'cyberbuild.png'; a.click(); } }} title="Save a PNG of the view">📷</button>
        </div>
      )}
      <div className="canvas" ref={host}>
        {props.error && <pre className="overlay err">{props.error}</pre>}
        {!asm && !props.error && props.building && <div className="overlay">Building 3D model…</div>}

        {mode === 'sim' && showRlHud && (
          <div className="rl-hud-card" style={{ width: 'min(410px, calc(100% - 24px))' }}>
            <div className="rl-hud-head">
              <div>
                <b>🧠 Reinforcement Learning Locomotion Studio</b>
                <small>
                  {rlTraining
                    ? `Training Ep ${rlHistory.length}/${totalPlannedEpisodes} · Gen ${latestMetric?.generation ?? 1}/${rlConfig.generations}…`
                    : rlHistory.length > 0
                      ? `Completed ${rlHistory.length} episodes (${initialMetric?.forwardMm.toFixed(0) ?? 0} mm → ${bestMetric?.forwardMm.toFixed(0) ?? 0} mm)`
                      : 'Configure training budget or tune CPG + IMU reflex parameters'}
                </small>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  type="button"
                  className="mini-btn"
                  title="Save current policy parameters to local browser storage"
                  onClick={handleSavePolicy}
                  style={{ padding: '2px 6px', fontSize: 10 }}
                >
                  💾 Save
                </button>
                <button className="ghost" onClick={() => setShowRlHud(false)} aria-label="Close RL HUD">✕</button>
              </div>
            </div>

            <div className="seg" style={{ width: '100%' }}>
              <button
                type="button"
                className={rlTab === 'train' ? 'on' : ''}
                style={{ flex: 1 }}
                onClick={() => setRlTab('train')}
              >
                Training & Hyperparams
              </button>
              <button
                type="button"
                className={rlTab === 'policy' ? 'on' : ''}
                style={{ flex: 1 }}
                onClick={() => setRlTab('policy')}
              >
                Actuator &amp; Servo Params
              </button>
            </div>

            {bestMetric && (
              <div className="rl-kpi-row">
                <div>
                  <span>Reward Gain</span>
                  <b className="pass">
                    {initialMetric ? `${initialMetric.reward.toFixed(0)} → ` : ''}
                    +{bestMetric.reward.toFixed(0)}
                  </b>
                </div>
                <div>
                  <span>Forward (+Y)</span>
                  <b className={bestMetric.forwardMm > 0 ? 'pass' : 'fail'}>
                    +{bestMetric.forwardMm.toFixed(1)} mm
                  </b>
                </div>
                <div>
                  <span>Max Tilt</span>
                  <b>{bestMetric.maxTiltDeg.toFixed(1)}°</b>
                </div>
                <div>
                  <span>Balance</span>
                  <b className={bestMetric.survived ? 'pass' : 'fail'}>
                    {bestMetric.survived ? '✓ Stable' : 'Tipped'}
                  </b>
                </div>
              </div>
            )}

            {rlHistory.length > 0 && (
              <div className="rl-spark-bars" title="Episode reward progression across generations">
                {rlHistory.slice(-60).map(m => {
                  const norm = Math.max(8, Math.min(100, ((m.reward + 20) / 160) * 100));
                  const isBest = bestMetric && m.episode === bestMetric.episode;
                  return (
                    <div
                      key={m.episode}
                      className={`rl-spark-col ${!m.survived || m.forwardMm < 0 ? 'fail' : isBest ? 'best' : ''}`}
                      style={{ height: `${norm}%` }}
                      title={`Ep ${m.episode} (Gen ${m.generation}): Reward ${m.reward}, Forward +${m.forwardMm}mm, Max Tilt ${m.maxTiltDeg}°`}
                    />
                  );
                })}
              </div>
            )}

            {rlTab === 'train' ? (
              <div className="rl-controls-stack">
                <label className="rl-slider-row">
                  <span>Generations</span>
                  <input
                    type="range"
                    min={4}
                    max={50}
                    step={2}
                    value={rlConfig.generations}
                    disabled={rlTraining}
                    onChange={e => setRlConfig(c => ({ ...c, generations: +e.target.value }))}
                  />
                  <b>{rlConfig.generations} gens</b>
                </label>

                <label className="rl-slider-row">
                  <span>Population / Gen</span>
                  <input
                    type="range"
                    min={2}
                    max={16}
                    step={1}
                    value={rlConfig.populationSize}
                    disabled={rlTraining}
                    onChange={e => setRlConfig(c => ({ ...c, populationSize: +e.target.value }))}
                  />
                  <b>{rlConfig.populationSize} eps ({totalPlannedEpisodes} total)</b>
                </label>

                <label className="rl-slider-row">
                  <span>Episode Duration</span>
                  <input
                    type="range"
                    min={1.0}
                    max={6.0}
                    step={0.5}
                    value={rlConfig.episodeDurationSec}
                    disabled={rlTraining}
                    onChange={e => setRlConfig(c => ({ ...c, episodeDurationSec: +e.target.value }))}
                  />
                  <b>{rlConfig.episodeDurationSec.toFixed(1)} s</b>
                </label>

                <label className="rl-slider-row">
                  <span>Learning Rate (α)</span>
                  <input
                    type="range"
                    min={0.15}
                    max={1.0}
                    step={0.05}
                    value={rlConfig.learningRate}
                    disabled={rlTraining}
                    onChange={e => setRlConfig(c => ({ ...c, learningRate: +e.target.value }))}
                  />
                  <b>{rlConfig.learningRate.toFixed(2)}</b>
                </label>

                <label className="rl-slider-row">
                  <span>Exploration (σ)</span>
                  <input
                    type="range"
                    min={0.3}
                    max={2.0}
                    step={0.1}
                    value={rlConfig.explorationScale}
                    disabled={rlTraining}
                    onChange={e => setRlConfig(c => ({ ...c, explorationScale: +e.target.value }))}
                  />
                  <b>{rlConfig.explorationScale.toFixed(1)}×</b>
                </label>

                <label className="check" style={{ fontSize: 11, color: '#38d17a', fontWeight: 600, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={rlConfig.untilSuccess ?? false}
                    disabled={rlTraining}
                    onChange={e => setRlConfig(c => ({ ...c, untilSuccess: e.target.checked }))}
                  />
                  Run continuously until success (&gt;= {rlConfig.successTargetMm ?? 35} mm forward + balanced)
                </label>

                <label className="check" style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>
                  <input
                    type="checkbox"
                    checked={rlConfig.startFromScratch}
                    disabled={rlTraining}
                    onChange={e => setRlConfig(c => ({ ...c, startFromScratch: e.target.checked }))}
                  />
                  Reset &amp; restart from scratch (uncheck to continue training current policy)
                </label>
              </div>
            ) : (
              <div className="rl-controls-stack">
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', fontWeight: 700, marginBottom: 2 }}>
                  🦾 Servo Actuator Kinematics &amp; Timing
                </div>
                <label className="rl-slider-row">
                  <span title="Hip pitch servo swing amplitude (S1/S2 B-PG001)">Hip Stride (S1/S2)</span>
                  <input
                    type="range"
                    min={2}
                    max={14}
                    step={0.5}
                    value={rlPolicy.strideAmpDeg}
                    onChange={e => updatePolicyParam('strideAmpDeg', +e.target.value)}
                  />
                  <b>{rlPolicy.strideAmpDeg.toFixed(1)}°</b>
                </label>
                <label className="rl-slider-row">
                  <span title="Ankle roll servo weight-shift tilt amplitude (S3/S4 B-PG001)">Ankle Roll (S3/S4)</span>
                  <input
                    type="range"
                    min={2}
                    max={14}
                    step={0.5}
                    value={rlPolicy.waddleAmpDeg}
                    onChange={e => updatePolicyParam('waddleAmpDeg', +e.target.value)}
                  />
                  <b>{rlPolicy.waddleAmpDeg.toFixed(1)}°</b>
                </label>
                <label className="rl-slider-row">
                  <span title="Actuator cycle frequency (steps per second)">Servo Cadence</span>
                  <input
                    type="range"
                    min={0.4}
                    max={1.15}
                    step={0.02}
                    value={rlPolicy.freqHz}
                    onChange={e => updatePolicyParam('freqHz', +e.target.value)}
                  />
                  <b>{rlPolicy.freqHz.toFixed(2)} Hz</b>
                </label>
                <label className="rl-slider-row">
                  <span title="Phase offset between ankle weight-shift and hip swing servos">Servo Phase (Δφ)</span>
                  <input
                    type="range"
                    min={-0.5}
                    max={2.4}
                    step={0.05}
                    value={rlPolicy.phaseLeadRad}
                    onChange={e => updatePolicyParam('phaseLeadRad', +e.target.value)}
                  />
                  <b>{((rlPolicy.phaseLeadRad * 180) / Math.PI).toFixed(0)}°</b>
                </label>
                <label className="rl-slider-row">
                  <span title="Baseline servo pitch angle bias on hip servos">Hip Pitch Trim</span>
                  <input
                    type="range"
                    min={-6}
                    max={6}
                    step={0.25}
                    value={rlPolicy.pitchTrimDeg}
                    onChange={e => updatePolicyParam('pitchTrimDeg', +e.target.value)}
                  />
                  <b>{rlPolicy.pitchTrimDeg.toFixed(1)}°</b>
                </label>

                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', fontWeight: 700, marginTop: 4, marginBottom: 2 }}>
                  ⚡ Closed-Loop Balance Reflex Feedback
                </div>
                <label className="rl-slider-row">
                  <span title="Pitch reflex correction sent to hip servos">Hip Pitch Reflex</span>
                  <input
                    type="range"
                    min={0.15}
                    max={1.6}
                    step={0.05}
                    value={rlPolicy.kpPitch}
                    onChange={e => updatePolicyParam('kpPitch', +e.target.value)}
                  />
                  <b>{rlPolicy.kpPitch.toFixed(2)}</b>
                </label>
                <label className="rl-slider-row">
                  <span title="Roll reflex correction sent to ankle servos">Ankle Roll Reflex</span>
                  <input
                    type="range"
                    min={0.15}
                    max={1.4}
                    step={0.05}
                    value={rlPolicy.kpRoll}
                    onChange={e => updatePolicyParam('kpRoll', +e.target.value)}
                  />
                  <b>{rlPolicy.kpRoll.toFixed(2)}</b>
                </label>
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <button
                    type="button"
                    className="mini-btn"
                    style={{ flex: 1 }}
                    onClick={() => {
                      const next = { ...UNTRAINED_RL_POLICY };
                      setRlPolicy(next);
                      rlPolicyRef.current = next;
                      props.onPolicyChange?.(next);
                      try {
                        localStorage.setItem('cyberbuild.rl_policy.latest', JSON.stringify(next));
                        if (spec?.name) {
                          localStorage.setItem(`cyberbuild.rl_policy.${spec.name}`, JSON.stringify(next));
                        }
                      } catch {}
                      setBehavior('rl_policy');
                      behaviorRef.current = 'rl_policy';
                      resetSimRef.current?.();
                    }}
                  >
                    Reset Untrained
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    style={{ flex: 1 }}
                    onClick={() => {
                      const next = { ...DEFAULT_RL_POLICY };
                      setRlPolicy(next);
                      rlPolicyRef.current = next;
                      props.onPolicyChange?.(next);
                      try {
                        localStorage.setItem('cyberbuild.rl_policy.latest', JSON.stringify(next));
                        if (spec?.name) {
                          localStorage.setItem(`cyberbuild.rl_policy.${spec.name}`, JSON.stringify(next));
                        }
                      } catch {}
                      setBehavior('rl_policy');
                      behaviorRef.current = 'rl_policy';
                      resetSimRef.current?.();
                    }}
                  >
                    Load Pre-Trained
                  </button>
                </div>
              </div>
            )}

            <div className="rl-hud-actions">
              <button
                className="primary"
                onClick={handleTrainRL}
              >
                {rlTraining
                  ? `⏹ Stop Training (${rlHistory.length}${rlConfig.untilSuccess ? ' eps · until success' : `/${totalPlannedEpisodes}`})`
                  : rlConfig.untilSuccess
                    ? `🧠 Train Until Success (target ${rlConfig.successTargetMm ?? 35}mm)`
                    : `🧠 Start RL Training (${totalPlannedEpisodes} eps)`}
              </button>
              <button
                onClick={() => {
                  setBehavior('rl_policy');
                  behaviorRef.current = 'rl_policy';
                  resetSimRef.current?.();
                  setRunning(true);
                  runningRef.current = true;
                }}
              >
                ▶ Test Policy
              </button>
            </div>

            <div className="rl-hud-actions secondary" style={{ marginTop: 4, display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="mini-btn"
                title="Save policy parameters to project storage"
                onClick={handleSavePolicy}
                style={{ flex: 1, fontSize: 10.5 }}
              >
                💾 Save Policy Params
              </button>
              <button
                type="button"
                className={`mini-btn ${isFirmwareOutdated ? 'primary' : ''}`}
                style={{
                  flex: 1.2,
                  fontSize: 10.5,
                  ...(isFirmwareOutdated ? { background: '#d97706', borderColor: '#f59e0b', color: '#fff' } : { color: '#34d399', borderColor: '#059669' })
                }}
                title={isFirmwareOutdated ? 'Policy params changed: compile into ESP32-C3 firmware files' : 'Firmware contains up-to-date gait parameters'}
                onClick={handleUpdateFirmware}
              >
                {isFirmwareOutdated ? '⚡ Update Firmware' : '✓ Firmware Updated'}
              </button>
              {props.built && (
                <button
                  type="button"
                  className="mini-btn"
                  title="Direct 1-click download of all firmware files (.zip)"
                  onClick={handleDownloadFirmware}
                  style={{ fontSize: 10.5, padding: '4px 6px' }}
                >
                  ⬇ .ZIP
                </button>
              )}
            </div>

            {savedToast && (
              <div style={{
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 4,
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#6ee7b7',
                textAlign: 'center',
                animation: 'fadeIn 0.2s ease-in-out',
                marginTop: 2,
              }}>
                {savedToast}
              </div>
            )}
          </div>
        )}
      </div>
      {mode !== 'print' && servoLinks.length > 0 && (behavior === 'manual' || mode === 'assembly') && (
        <div className="joints">
          {servoLinks.map(l => {
            const [lo, hi] = l.joint!.limit ?? [-90, 90];
            return (
              <label key={l.id}><span>{l.joint!.actuator.label} <em>{l.joint!.actuator.port}</em></span>
                <input type="range" min={lo} max={hi} step={1} value={angles[l.id] ?? 0} onChange={e => setAngles({ ...angles, [l.id]: +e.target.value })} />
                <b>{(angles[l.id] ?? 0).toFixed(0)}{l.joint!.type === 'prismatic' ? ' mm' : '°'}</b></label>
            );
          })}
          <button onClick={() => setAngles({})}>Zero</button>
        </div>
      )}
      {mode === 'sim' && tele && (
        <div className="telemetry">
          <div><span>t</span>{tele.t.toFixed(1)} s</div>
          {isMobileRobot && (
            <>
              <div><span>speed</span>{(tele.speed * 100).toFixed(1)} cm/s</div>
              <div><span>heading</span>{tele.heading.toFixed(0)}°</div>
              <div><span>forward</span>{(tele.pos[1] / 10).toFixed(1)} cm</div>
            </>
          )}
          <div><span>battery</span>{tele.currentA.toFixed(2)} A</div>
          {tele.tipped ? (
            <div className="bad">TIPPED OVER</div>
          ) : isMobileRobot ? (
            <div style={{ color: 'var(--pass)', fontWeight: 600 }}>✓ BALANCED</div>
          ) : null}
          {tele.joints.map(j => (
            <div key={j.id} className={j.stalled ? 'bad' : ''} title={`${j.currentA.toFixed(2)} A`}>
              <span>{j.port} {j.label}</span>
              {j.kind === 'servo' ? `${j.angle.toFixed(0)}° → ${j.target.toFixed(0)}°` : `${(j.angle).toFixed(0)}°`}
              <i className="bar"><i style={{ width: `${Math.min(100, (j.torque / j.torqueMax) * 100)}%` }} /></i>
              {j.stalled && ' STALL'}
            </div>
          ))}
        </div>
      )}
      {mode === 'sim' && !running && <div className="hint">Press ▶ Run, select a behaviour, or open 🧠 RL Studio & Train to optimize a closed-loop locomotion policy.</div>}
    </section>
  );
}
