// "Edit the output": change the generated design directly, without the AI. Every change goes through
// normalizeSpec (so it stays buildable), rebuilds live and is recorded as a version (undo).
import { useEffect, useRef, type ReactNode } from 'react';
import {
  EMPTY_COMPOSITION, FACES, POINTS, RANGES, SHAPES, normalizeSpec,
  type CompFeature, type CompJoint, type Composition, type RobotParams, type RobotSpec,
} from '../design/spec';

type Vec3 = [number, number, number];

function Num(props: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="ed-num">
      <span>{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onChange={e => props.onChange(+e.target.value)} aria-label={props.label} />
      <input type="number" min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
        onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) props.onChange(Math.min(props.max, Math.max(props.min, v))); }} aria-label={`${props.label} value`} />
      {props.unit && <em>{props.unit}</em>}
    </label>
  );
}

function Pick<T extends string>(props: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void; names?: Partial<Record<T, string>> }) {
  return (
    <label className="ed-pick">
      <span>{props.label}</span>
      <select value={props.value} onChange={e => props.onChange(e.target.value as T)}>
        {props.options.map(o => <option key={o} value={o}>{props.names?.[o] ?? o.replace(/_/g, ' ')}</option>)}
      </select>
    </label>
  );
}

function Section(props: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="ed-sec">
      <header><h3>{props.title}</h3>{props.aside}</header>
      {props.children}
    </section>
  );
}

function ShapePicker(props: { value: string; options: readonly string[]; onChange: (v: string) => void; label: string }) {
  return (
    <div className="shape-picker" role="radiogroup" aria-label={props.label}>
      {props.options.map(s => (
        <button key={s} role="radio" aria-checked={props.value === s} className={props.value === s ? 'on' : ''} onClick={() => props.onChange(s)} title={s.replace(/_/g, ' ')}>
          <ShapeIcon shape={s} /><span>{s.replace(/_/g, ' ')}</span>
        </button>
      ))}
    </div>
  );
}

function ShapeIcon({ shape }: { shape: string }) {
  const p = { fill: 'currentColor', opacity: 0.85 } as const;
  const body: Record<string, ReactNode> = {
    box: <rect x="5" y="5" width="14" height="14" {...p} />,
    rounded_box: <rect x="4" y="5" width="16" height="14" rx="4" {...p} />,
    cylinder: <><ellipse cx="12" cy="6" rx="7" ry="2.5" {...p} /><rect x="5" y="6" width="14" height="12" {...p} /><ellipse cx="12" cy="18" rx="7" ry="2.5" {...p} /></>,
    sphere: <circle cx="12" cy="12" r="8" {...p} />,
    egg: <ellipse cx="12" cy="13" rx="7" ry="9" {...p} />,
    capsule: <rect x="7" y="3" width="10" height="18" rx="5" {...p} />,
    cone: <path d="M12 3 L20 20 H4 Z" {...p} />,
    wedge: <path d="M4 20 L20 20 L20 6 Z" {...p} />,
    disc: <ellipse cx="12" cy="12" rx="9" ry="4" {...p} />,
    fin: <path d="M5 20 C 8 10, 14 5, 20 4 C 17 10, 15 16, 15 20 Z" {...p} />,
    prism: <path d="M12 4 L20 18 H4 Z M4 18 L4 20 H20 V18" {...p} />,
    led: <><circle cx="12" cy="12" r="5" {...p} /><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5" /></>,
    // domes, rings, turned profiles
    dome: <path d="M3 19 A9 9 0 0 1 21 19 Z" {...p} />,
    arch: <path d="M3 20 V12 A9 8 0 0 1 21 12 V20 Z" {...p} />,
    arch_top: <path d="M5 21 V11 A7 7 0 0 1 19 11 V21 Z" {...p} />,
    helmet: <path d="M5 17 A7 8 0 0 1 19 17 H21 V19 H3 V17 Z" {...p} />,
    bowl: <path d="M3 6 H21 A9 10 0 0 1 3 6 Z" {...p} />,
    saucer: <><ellipse cx="12" cy="15" rx="10" ry="3" {...p} /><path d="M8 14 A4 5 0 0 1 16 14 Z" {...p} /></>,
    torus: <path d="M12 6 A9 6 0 1 1 11.9 6 Z M12 10 A3 2 0 1 0 12.1 10 Z" fillRule="evenodd" {...p} />,
    hoop: <path d="M12 3 A9 9 0 1 1 11.9 3 Z M12 7 A5 5 0 1 0 12.1 7 Z" fillRule="evenodd" {...p} />,
    tube: <path d="M5 5 H19 V19 H5 Z M8 5 H16 V19 H8 Z" fillRule="evenodd" {...p} />,
    frustum: <path d="M8 4 H16 L20 20 H4 Z" {...p} />,
    bell: <path d="M12 3 C 7 3, 7 9, 6 15 L 4 19 H20 L18 15 C 17 9, 17 3, 12 3 Z" {...p} />,
    vase: <path d="M9 3 H15 V5 C 20 9, 19 17, 15 21 H9 C 5 17, 4 9, 9 5 Z" {...p} />,
    gumdrop: <path d="M4 20 C 4 10, 9 4, 12 4 C 15 4, 20 10, 20 20 Z" {...p} />,
    barrel: <path d="M7 3 H17 C 21 8, 21 16, 17 21 H7 C 3 16, 3 8, 7 3 Z" {...p} />,
    pear: <path d="M12 3 C 15 3, 15 8, 17 11 C 21 16, 18 21, 12 21 C 6 21, 3 16, 7 11 C 9 8, 9 3, 12 3 Z" {...p} />,
    teardrop: <path d="M12 3 C 15 8, 19 12, 19 15 A7 7 0 0 1 5 15 C 5 12, 9 8, 12 3 Z" {...p} />,
    hourglass: <path d="M5 3 H19 L13 12 L19 21 H5 L11 12 Z" {...p} />,
    spinning_top: <path d="M11 2 H13 V6 L21 11 L12 22 L3 11 L11 6 Z" {...p} />,
    acorn: <><path d="M4 10 C 4 5, 20 5, 20 10 Z" {...p} /><path d="M6 11 H18 C 18 17, 15 21, 12 21 C 9 21, 6 17, 6 11 Z" {...p} /></>,
    mushroom: <><path d="M3 12 C 3 4, 21 4, 21 12 Z" {...p} /><rect x="9.5" y="12" width="5" height="9" {...p} /></>,
    puck: <rect x="3" y="8" width="18" height="8" rx="3" {...p} />,
    drum: <><ellipse cx="12" cy="12" rx="8" ry="8" {...p} /><ellipse cx="12" cy="12" rx="5" ry="5" fill="none" stroke="currentColor" opacity="0.4" /></>,
    mug: <path d="M4 5 H16 V20 H4 Z M16 8 H19 A2 2 0 0 1 21 10 V14 A2 2 0 0 1 19 16 H16 V14 H19 V10 H16 Z" {...p} />,
    // prisms and polyhedra
    pyramid: <path d="M12 3 L21 20 H3 Z M12 3 L15 20" {...p} />,
    trapezoid: <path d="M7 4 H17 L21 20 H3 Z" {...p} />,
    triangle: <path d="M12 4 L21 20 H3 Z" {...p} />,
    pent_prism: <path d="M12 3 L21 10 L17.5 21 H6.5 L3 10 Z" {...p} />,
    hex_prism: <path d="M7 3 H17 L22 12 L17 21 H7 L2 12 Z" {...p} />,
    oct_prism: <path d="M8 3 H16 L21 8 V16 L16 21 H8 L3 16 V8 Z" {...p} />,
    gem: <path d="M7 4 H17 L21 9 L12 21 L3 9 Z" {...p} />,
    crystal: <path d="M12 2 L18 8 V16 L12 22 L6 16 V8 Z" {...p} />,
    chamfer_box: <path d="M8 4 H16 L20 8 V16 L16 20 H8 L4 16 V8 Z" {...p} />,
    soft_cube: <rect x="4" y="4" width="16" height="16" rx="5" {...p} />,
    house: <path d="M12 3 L21 11 H19 V21 H5 V11 H3 Z" {...p} />,
    lantern: <path d="M8 3 H16 L18 6 V18 L16 21 H8 L6 18 V6 Z" {...p} />,
    // screens and characters
    crt: <path d="M3 5 H21 V18 H3 Z M7 8 H17 V15 H7 Z" fillRule="evenodd" {...p} />,
    monitor: <path d="M3 4 H21 V15 H3 Z M11 15 H13 V19 H17 V21 H7 V19 H11 Z" {...p} />,
    cat_head: <path d="M4 3 L9 9 H15 L20 3 V14 A8 7 0 0 1 4 14 Z" {...p} />,
    bear_head: <><circle cx="6" cy="6" r="3" {...p} /><circle cx="18" cy="6" r="3" {...p} /><circle cx="12" cy="13" r="8" {...p} /></>,
    bunny_head: <><rect x="7" y="2" width="3" height="10" rx="1.5" {...p} /><rect x="14" y="2" width="3" height="10" rx="1.5" {...p} /><ellipse cx="12" cy="16" rx="8" ry="6" {...p} /></>,
    ghost: <path d="M4 21 V11 A8 8 0 0 1 20 11 V21 L17 18 L14 21 L12 18 L10 21 L7 18 Z" {...p} />,
    cloud: <path d="M6 19 A4 4 0 0 1 6 11 A5 5 0 0 1 15 8 A5 5 0 0 1 19 19 Z" {...p} />,
    blob: <path d="M12 3 C 19 3, 22 10, 19 15 C 16 21, 8 22, 5 17 C 2 12, 6 3, 12 3 Z" {...p} />,
    bean: <path d="M7 4 C 3 4, 2 12, 4 17 C 6 22, 14 21, 18 17 C 22 13, 19 8, 15 9 C 12 10, 11 4, 7 4 Z" {...p} />,
    beak: <path d="M3 8 C 10 7, 16 9, 22 13 C 16 16, 10 17, 3 16 Z" {...p} />,
    horn: <path d="M5 21 C 5 12, 9 6, 18 3 C 14 8, 12 14, 13 21 Z" {...p} />,
    // flat cut-outs
    star: <path d="M12 2 L14.9 8.6 L22 9.3 L16.7 14 L18.2 21 L12 17.3 L5.8 21 L7.3 14 L2 9.3 L9.1 8.6 Z" {...p} />,
    heart: <path d="M12 21 C 5 15, 2 11, 2 8 A5 5 0 0 1 12 6 A5 5 0 0 1 22 8 C 22 11, 19 15, 12 21 Z" {...p} />,
    crescent: <path d="M15 3 A9 9 0 1 0 21 17 A7 7 0 1 1 15 3 Z" {...p} />,
    cross: <path d="M9 3 H15 V9 H21 V15 H15 V21 H9 V15 H3 V9 H9 Z" {...p} />,
    leaf: <path d="M12 2 C 19 7, 19 17, 12 22 C 5 17, 5 7, 12 2 Z" {...p} />,
    shield: <path d="M3 3 H21 V11 C 21 16, 16 20, 12 22 C 8 20, 3 16, 3 11 Z" {...p} />,
    wing: <path d="M3 14 C 8 6, 15 3, 22 3 C 19 8, 16 14, 9 20 Z" {...p} />,
    stadium: <rect x="2" y="7" width="20" height="10" rx="5" {...p} />,
    semicircle: <path d="M3 18 A9 9 0 0 1 21 18 Z" {...p} />,
    petal: <path d="M12 2 C 18 9, 18 16, 12 22 C 6 16, 6 9, 12 2 Z" {...p} />,
    bubble: <path d="M3 4 H21 V15 H10 L5 20 V15 H3 Z" {...p} />,
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>{body[shape] ?? body.box}</svg>;
}

function Vec(props: { label: string; value: number[]; min: number; max: number; axes?: string[]; unit?: string; onChange: (v: number[]) => void }) {
  const axes = props.axes ?? ['x', 'y', 'z'];
  return (
    <div className="ed-vec">
      <span className="ed-vec-label">{props.label}</span>
      {props.value.map((v, i) => (
        <Num key={i} label={axes[i]} value={v} min={props.min} max={props.max} unit={props.unit}
          onChange={n => { const next = [...props.value]; next[i] = n; props.onChange(next); }} />
      ))}
    </div>
  );
}

const PARAM_LABEL: Partial<Record<keyof typeof RANGES, string>> = {
  wheelDia: 'Wheel diameter', wheelWidth: 'Wheel width', upperLen: 'Upper arm', foreLen: 'Forearm', gripperLen: 'Gripper',
  payloadG: 'Payload (g)', leds: 'LEDs', headWidth: 'Head width', legLen: 'Leg length', footLen: 'Foot length', footWidth: 'Foot width',
  armLen: 'Arm length', mountAngle: 'Mount angle', cradleWidth: 'Cradle width', cradleHeight: 'Cradle height', leverLen: 'Lever length',
  pivotH: 'Pivot height', rotorDia: 'Rotor diameter', bladeCount: 'Blades', stroke: 'Stroke',
};
const BOOL_PARAMS: (keyof RobotParams)[] = ['panTilt', 'bumper', 'tpuTires', 'hasArms', 'hasTail', 'hasWings', 'hasMagnetPockets', 'hasCableSlot'];

export function DesignEditor(props: {
  spec: RobotSpec;
  onChange: (next: RobotSpec, label: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  onClose: () => void;
  /** Item to highlight: 'body' or a joint name (set when a part is clicked in the 3D view). */
  focus: string | null;
  onFocusItem: (id: string | null) => void;
  className?: string;
}) {
  const s = props.spec;
  const comp: Composition | null = s.composition?.use ? s.composition : null;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.focus) return;
    const el = root.current?.querySelector(`[data-item="${CSS.escape(props.focus)}"]`);
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }, [props.focus]);

  const commit = (raw: RobotSpec, label: string) => props.onChange(normalizeSpec(raw).spec, label);
  const setComp = (c: Composition, label: string) => commit({ ...s, composition: c }, label);
  const setJoint = (i: number, patch: Partial<CompJoint>, label: string) => {
    if (!comp) return;
    const old = comp.joints[i];
    let joints = comp.joints.map((j, k) => (k === i ? { ...j, ...patch } : j));
    let features = comp.features;
    if (patch.name !== undefined && patch.name !== old.name) {
      const name = patch.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 20) || old.name;
      joints = joints.map((j, k) => (k === i ? { ...j, name } : j.parent === old.name ? { ...j, parent: name } : j));
      features = features.map(f => (f.parent === old.name ? { ...f, parent: name } : f));
    }
    setComp({ ...comp, joints, features }, label);
  };
  const setFeature = (i: number, patch: Partial<CompFeature>, label: string) => {
    if (!comp) return;
    setComp({ ...comp, features: comp.features.map((f, k) => (k === i ? { ...f, ...patch } : f)) }, label);
  };
  const addJoint = () => {
    if (!comp || comp.joints.length >= 4) return;
    let n = comp.joints.length + 1, name = `joint${n}`;
    while (comp.joints.some(j => j.name === name)) name = `joint${++n}`;
    const j: CompJoint = { name, parent: 'body', face: '+x', at: [0, 0], kind: 'swing', range: [-45, 45], point: 'down', reach: 30, shape: 'capsule', size: [14, 14, 40] };
    setComp({ ...comp, joints: [...comp.joints, j] }, `Add joint ${name}`);
    props.onFocusItem(name);
  };
  const removeJoint = (i: number) => {
    if (!comp) return;
    const gone = new Set<string>([comp.joints[i].name]);
    for (const j of comp.joints) if (gone.has(j.parent)) gone.add(j.name);   // children go too
    setComp({ ...comp, joints: comp.joints.filter(j => !gone.has(j.name)), features: comp.features.filter(f => !gone.has(f.parent)) }, `Remove joint ${comp.joints[i].name}`);
  };
  const addFeature = (shape: CompFeature['shape']) => {
    if (!comp || comp.features.length >= 16) return;
    const f: CompFeature = shape === 'led'
      ? { parent: 'body', shape: 'led', size: [6, 6, 6], at: [0, comp.body.size[1] / 2, comp.body.size[2] / 5], color: 'accent' }
      : { parent: 'body', shape, size: [16, 16, 16], at: [0, 0, comp.body.size[2] / 2 + 6], color: 'accent' };
    setComp({ ...comp, features: [...comp.features, f] }, `Add ${shape === 'led' ? 'LED eye' : shape} feature`);
  };
  const parents = comp ? ['body', ...comp.joints.map(j => j.name)] : ['body'];

  return (
    <aside className={`design-editor ${props.className ?? ''}`} ref={root} aria-label="Design editor">
      <header className="ed-head">
        <div>
          <h2>Edit design</h2>
          <small>Direct edits, no AI. Rebuilds live; every change is a version.</small>
        </div>
        <div className="ed-head-btns">
          <button onClick={props.onUndo} disabled={!props.canUndo} title="Undo the last change">↶ Undo</button>
          <button className="ghost" onClick={props.onClose} aria-label="Close the editor">✕</button>
        </div>
      </header>
      <div className="ed-scroll">
        <Section title="Identity">
          <label className="ed-text"><span>Name</span>
            <input value={s.name} maxLength={40} onChange={e => props.onChange({ ...s, name: e.target.value }, 'Rename')} onBlur={e => { if (!e.target.value.trim()) commit({ ...s, name: '' }, 'Rename'); }} />
          </label>
          <div className="ed-colors">
            <label><input type="color" value={s.primaryColor} onChange={e => commit({ ...s, primaryColor: e.target.value }, 'Primary colour')} /><span>Primary</span><code>{s.primaryColor}</code></label>
            <label><input type="color" value={s.accentColor} onChange={e => commit({ ...s, accentColor: e.target.value }, 'Accent colour')} /><span>Accent</span><code>{s.accentColor}</code></label>
            <button className="mini-btn" onClick={() => commit({ ...s, primaryColor: s.accentColor, accentColor: s.primaryColor }, 'Swap colours')} title="Swap primary and accent">⇄</button>
          </div>
        </Section>

        {comp ? (
          <>
            <Section title="Body">
              <div data-item="body" className={`ed-item ${props.focus === 'body' ? 'focused' : ''}`} onClick={() => props.onFocusItem('body')}>
                <ShapePicker label="Body shape" value={comp.body.shape} options={SHAPES} onChange={v => setComp({ ...comp, body: { ...comp.body, shape: v as Composition['body']['shape'] } }, 'Body shape')} />
                <Vec label="Size" unit="mm" value={comp.body.size} min={8} max={160} axes={['width', 'depth', 'height']}
                  onChange={v => setComp({ ...comp, body: { ...comp.body, size: v as Vec3 } }, 'Body size')} />
                <Num label="Neck (standH)" unit="mm" value={comp.standH} min={0} max={80} onChange={v => setComp({ ...comp, standH: v }, 'Neck height')} />
                <Pick label="Mobility" value={comp.mobility} options={(s.platform === 'licheerv_claw' ? ['none', 'wheels', 'legs'] : ['none', 'wheels']) as readonly Composition['mobility'][]}
                  names={{ none: 'Stands still', wheels: s.platform && s.platform !== 'cyberbrick' && s.platform !== 'licheerv_claw' ? 'Drives on wheels' : 'Drives (2 wheels + skid)', legs: 'Walks on 2 legs' }}
                  onChange={v => setComp({ ...comp, mobility: v }, 'Mobility')} />
                {comp.mobility === 'wheels' && s.platform && s.platform !== 'cyberbrick' && s.platform !== 'licheerv_claw' && (
                  <Pick label="Wheels" value={String(comp.wheelCount ?? 2) as '2' | '4'} options={['2', '4'] as const} names={{ 2: '2 + front skid', 4: '4 (tank steering)' }}
                    onChange={v => setComp({ ...comp, wheelCount: v === '4' ? 4 : 2 }, 'Wheels')} />
                )}
              </div>
            </Section>

            <Section title={`Joints (${comp.joints.length}/4)`} aside={<button className="mini-btn" onClick={addJoint} disabled={comp.joints.length >= 4}>+ Add joint</button>}>
              {!comp.joints.length && <p className="ed-empty">No moving parts yet. Add a joint for a nodding head, a waving arm or a tail.</p>}
              {comp.joints.map((j, i) => (
                <details key={i} open={props.focus === j.name || undefined} data-item={j.name} className={`ed-item ${props.focus === j.name ? 'focused' : ''}`}>
                  <summary onClick={() => props.onFocusItem(j.name)}>
                    <b>{j.name}</b><span>{j.kind} on {j.parent} {j.face}</span>
                    <button className="ghost danger" onClick={e => { e.preventDefault(); removeJoint(i); }} aria-label={`Remove joint ${j.name}`}>✕</button>
                  </summary>
                  <label className="ed-text"><span>Name</span><input value={j.name} onChange={e => setJoint(i, { name: e.target.value }, `Rename joint ${j.name}`)} /></label>
                  <div className="ed-row">
                    <Pick label="Parent" value={j.parent} options={parents.filter(p => p !== j.name && comp.joints.findIndex(x => x.name === p) < i)} onChange={v => setJoint(i, { parent: v }, `${j.name}: parent`)} />
                    <Pick label="Face" value={j.face} options={FACES} onChange={v => setJoint(i, { face: v }, `${j.name}: face`)} />
                  </div>
                  <div className="ed-row">
                    <Pick label="Kind" value={j.kind} options={['swing', 'spin'] as const} names={{ swing: 'Swing (servo)', spin: 'Spin (continuous)' }} onChange={v => setJoint(i, { kind: v, range: v === 'spin' ? [0, 0] : [-45, 45] }, `${j.name}: kind`)} />
                    <Pick label="Points" value={j.point} options={POINTS} onChange={v => setJoint(i, { point: v }, `${j.name}: direction`)} />
                  </div>
                  {j.kind === 'swing' && (
                    <Vec label="Range" unit="°" value={j.range} min={-90} max={90} axes={['from', 'to']}
                      onChange={v => setJoint(i, { range: [Math.min(v[0], v[1] - 1), Math.max(v[1], v[0] + 1)] }, `${j.name}: range`)} />
                  )}
                  <Vec label="Offset on face" unit="mm" value={j.at} min={-80} max={80} axes={['u', 'v']} onChange={v => setJoint(i, { at: v as [number, number] }, `${j.name}: offset`)} />
                  <Num label="Reach" unit="mm" value={j.reach} min={0} max={150} onChange={v => setJoint(i, { reach: v }, `${j.name}: reach`)} />
                  <ShapePicker label={`${j.name} shape`} value={j.shape} options={SHAPES} onChange={v => setJoint(i, { shape: v as CompJoint['shape'] }, `${j.name}: shape`)} />
                  <Vec label="Member size" unit="mm" value={j.size} min={3} max={150} onChange={v => setJoint(i, { size: v as Vec3 }, `${j.name}: size`)} />
                </details>
              ))}
            </Section>

            <Section title={`Features (${comp.features.length}/16)`} aside={
              <span className="ed-add">
                <button className="mini-btn" onClick={() => addFeature('led')} disabled={comp.features.length >= 16}>+ LED eye</button>
                <button className="mini-btn" onClick={() => addFeature('sphere')} disabled={comp.features.length >= 16}>+ Shape</button>
                <button className="mini-btn" onClick={() => setComp({ ...comp, features: [...comp.features, { parent: 'body', shape: 'cylinder', size: [10, 10, 20], at: [0, 0, comp.body.size[2] / 2], color: 'primary', cut: true }] }, 'Add hole')} disabled={comp.features.length >= 16}>+ Hole</button>
              </span>}>
              {!comp.features.length && <p className="ed-empty">No features. Add LED eyes, ears, a nose or a hat.</p>}
              {comp.features.map((f, i) => (
                <details key={i} className="ed-item">
                  <summary>
                    <i className="swatch" style={{ background: f.color === 'accent' ? s.accentColor : s.primaryColor }} aria-hidden />
                    <b>{f.shape === 'led' ? 'LED eye' : (f.cut ? 'Hole: ' : '') + f.shape.replace(/_/g, ' ')}</b><span>{f.cut ? 'in' : 'on'} {f.parent}</span>
                    <button className="ghost danger" onClick={e => { e.preventDefault(); setComp({ ...comp, features: comp.features.filter((_, k) => k !== i) }, 'Remove feature'); }} aria-label={`Remove feature ${i + 1}`}>✕</button>
                  </summary>
                  <div className="ed-row">
                    <Pick label="On" value={f.parent} options={parents} onChange={v => setFeature(i, { parent: v }, 'Feature parent')} />
                    {f.shape !== 'led' && <Pick label="Kind" value={f.cut ? 'hole' : 'part'} options={['part', 'hole'] as const} onChange={v => setFeature(i, { cut: v === 'hole' ? true : undefined }, v === 'hole' ? 'Feature is a hole' : 'Feature is a part')} />}
                    {!f.cut && <Pick label="Colour" value={f.color} options={['primary', 'accent'] as const} onChange={v => setFeature(i, { color: v }, 'Feature colour')} />}
                  </div>
                  <ShapePicker label="Feature shape" value={f.shape} options={[...SHAPES, 'led']} onChange={v => setFeature(i, { shape: v as CompFeature['shape'] }, 'Feature shape')} />
                  <Vec label="Size" unit="mm" value={f.size} min={2} max={140} onChange={v => setFeature(i, { size: v as Vec3 }, 'Feature size')} />
                  <Vec label="Position (at)" unit="mm" value={f.at} min={-120} max={120} onChange={v => setFeature(i, { at: v as Vec3 }, 'Feature position')} />
                </details>
              ))}
            </Section>
          </>
        ) : (
          <>
            <Section title={`Parameters · ${s.archetype.replace(/_/g, ' ')}`}>
              <p className="ed-empty">This design uses a prebuilt CAD type. Tune its parameters, or turn it into a free-form composition to edit shapes and joints.</p>
              {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map(k => (
                <Num key={k} label={PARAM_LABEL[k] ?? k} value={s.params[k] as number} min={RANGES[k][0]} max={RANGES[k][1]} step={k === 'leds' || k === 'bladeCount' ? 1 : 0.5}
                  onChange={v => commit({ ...s, params: { ...s.params, [k]: v } }, `${PARAM_LABEL[k] ?? k}`)} />
              ))}
              <div className="ed-bools">
                {BOOL_PARAMS.map(k => (
                  <label key={k} className="check"><input type="checkbox" checked={Boolean(s.params[k])} onChange={e => commit({ ...s, params: { ...s.params, [k]: e.target.checked } }, k)} />{k.replace(/^has/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase()}</label>
                ))}
              </div>
            </Section>
            <button className="primary ed-convert" onClick={() => setComp({ ...EMPTY_COMPOSITION, use: true, features: [
              { parent: 'body', shape: 'led', size: [6, 6, 6], at: [-12, 25, 6], color: 'accent' },
              { parent: 'body', shape: 'led', size: [6, 6, 6], at: [12, 25, 6], color: 'accent' },
            ] }, 'Convert to free-form')}>Convert to free-form</button>
          </>
        )}
      </div>
    </aside>
  );
}
