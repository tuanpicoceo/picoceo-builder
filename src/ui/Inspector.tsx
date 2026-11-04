import { useEffect, useMemo, useState } from 'react';
import { CATALOG, type ComponentDirectory, getDirectoryTotals, GPIO, PIN_STANDARD, POPULAR_KITS } from '../catalog/components';
import { CHECKLIST, FIT, HOLES, MATERIALS, PROFILES, type Material } from '../catalog/rules';
import type { Assembly } from '../cad/types';
import { bom, partStats, voiceWiring, type Check } from '../design/analysis';
import type { Behavior } from '../design/behaviors';
import { firmwareFiles } from '../design/firmware';
import { STEP_DEFINITIONS, type SevenStepFlowReport, type StepNumber } from '../design/pipeline';
import { BEHAVIORS, DEFAULT_BEHAVIORS, RANGES, type RobotSpec } from '../design/spec';
import type { RLPolicyParams } from '../sim/rl';
import { download, firmwareZip, projectZip, slug, stlBinary, threeMF } from '../export/files';

export type Tab = 'flow' | 'design' | 'checks' | 'bom' | 'print' | 'wiring' | 'firmware' | 'catalog';
type Analysis = { checks: Check[]; totals: { massG: number; printG: number; printH: number; avgA: number; peakA: number; runtimeMin: number; topSpeed?: number; maxSlopeDeg?: number } };

export function Inspector(props: {
  spec: RobotSpec;
  setSpec: (s: RobotSpec) => void;
  built: { spec: RobotSpec; asm: Assembly } | null;
  analysis: Analysis | null;
  behaviors: Behavior[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  inventory?: ComponentDirectory;
  buyMode?: boolean;
  onOpenDirectory?: () => void;
  flowReport?: SevenStepFlowReport | null;
  externalFlowStep?: { step: StepNumber | 'all'; seq: number } | null;
  onRequestViewportMode?: (mode: 'assembly' | 'print' | 'sim', behavior?: string) => void;
  onFixChecks?: () => void;
  onRerunStep?: (step: StepNumber) => void;
  runningStep?: StepNumber | null;
  rlPolicy?: RLPolicyParams;
  lastFirmwarePolicy?: RLPolicyParams | null;
  onUpdateFirmware?: (policy?: RLPolicyParams) => void;
  className?: string;
  onClose?: () => void;
  /** Tab to show when opened from the menu (e.g. View → Checks). */
  openTab?: { tab: Tab; seq: number } | null;
}) {
  const [tab, setTab] = useState<Tab>('design');
  useEffect(() => { if (props.openTab) setTab(props.openTab.tab); }, [props.openTab?.seq]);
  const [flowStep, setFlowStep] = useState<StepNumber | 'all'>('all');

  const isFirmwareOutdated = useMemo(() => {
    if (!props.rlPolicy) return false;
    if (!props.lastFirmwarePolicy) return true;
    const p1 = props.rlPolicy;
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
  }, [props.rlPolicy, props.lastFirmwarePolicy]);

  useEffect(() => {
    if (!props.externalFlowStep) return;
    setTab('flow');
    setFlowStep(props.externalFlowStep.step);
  }, [props.externalFlowStep?.seq]);

  const a = props.analysis;
  const counts = a ? { fail: a.checks.filter(c => c.status === 'fail').length, warn: a.checks.filter(c => c.status === 'warn').length } : { fail: 0, warn: 0 };
  const tabs: [Tab, string][] = [
    ['design', 'Design'],
    ['checks', `Checks${!a ? '' : counts.fail ? ` ✕${counts.fail}` : counts.warn ? ` !${counts.warn}` : ' ✓'}`],
    ['bom', 'BOM'],
    ['wiring', 'Wiring'],
    ['flow', `Report${props.flowReport ? ` (${props.flowReport.step8?.readinessScore ?? props.flowReport.step7?.readinessScore}%)` : ''}`],
    ['catalog', 'Specs'],
  ];
  return (
    <aside className={`panel inspector ${props.className ?? ''}`}>
      {props.onClose && <button className="drawer-close" onClick={props.onClose} title="Close the design panel">✕</button>}
      <nav className="tabs">{tabs.map(([t, l]) => <button key={t} className={`${tab === t ? 'on' : ''} ${t === 'checks' && counts.fail ? 'fail' : t === 'checks' && counts.warn ? 'warn' : ''}`} onClick={() => setTab(t)}>{l}</button>)}</nav>
      {a && props.built && (
        <div className="kpis">
          <div><b>{(a.totals.massG).toFixed(0)} g</b><span>mass</span></div>
          <div><b>{props.built.asm.dims.w.toFixed(0)}×{props.built.asm.dims.d.toFixed(0)}×{props.built.asm.dims.h.toFixed(0)}</b><span>mm</span></div>
          <div><b>{a.totals.printG.toFixed(0)} g</b><span>filament</span></div>
          <div><b>{a.totals.printH.toFixed(1)} h</b><span>print</span></div>
          <div><b>{a.totals.runtimeMin.toFixed(0)} min</b><span>runtime</span></div>
          {a.totals.topSpeed !== undefined && <div><b>{(a.totals.topSpeed * 100).toFixed(0)} cm/s</b><span>top speed</span></div>}
        </div>
      )}
      <div className="tab-body">
        {!props.built && tab !== 'design' && tab !== 'catalog' && (
          <div className="empty-state">
            No robot design generated yet. Describe your idea in the Design assistant to begin.
          </div>
        )}
        {tab === 'flow' && props.flowReport && props.built && (
          <FlowTab
            report={props.flowReport}
            asm={props.built.asm}
            spec={props.built.spec}
            activeStep={flowStep}
            setActiveStep={setFlowStep}
            selected={props.selected}
            onSelect={props.onSelect}
            onOpenDirectory={props.onOpenDirectory}
            onRequestViewportMode={props.onRequestViewportMode}
            onFixChecks={props.onFixChecks}
            onRerunStep={props.onRerunStep}
            runningStep={props.runningStep}
            rlPolicy={props.rlPolicy}
            isFirmwareOutdated={isFirmwareOutdated}
            onUpdateFirmware={props.onUpdateFirmware}
          />
        )}
        {tab === 'design' && <DesignTab {...props} />}
        {tab === 'checks' && a && <ChecksTab checks={a.checks} />}
        {tab === 'bom' && props.built && (
          <BomTab
            asm={props.built.asm}
            spec={props.built.spec}
            inventory={props.inventory}
            buyMode={props.buyMode}
            onOpenDirectory={props.onOpenDirectory}
          />
        )}
        {tab === 'print' && props.built && <PrintTab asm={props.built.asm} spec={props.built.spec} selected={props.selected} onSelect={props.onSelect} behaviors={props.behaviors} />}
        {tab === 'wiring' && props.built && <WiringTab asm={props.built.asm} />}
        {tab === 'firmware' && props.built && (
          <FirmwareTab
            asm={props.built.asm}
            spec={props.built.spec}
            behaviors={props.behaviors}
            rlPolicy={props.rlPolicy}
            isFirmwareOutdated={isFirmwareOutdated}
            onUpdateFirmware={props.onUpdateFirmware}
          />
        )}
        {tab === 'catalog' && <CatalogTab />}
      </div>
    </aside>
  );
}

function Num(p: { label: string; k: keyof typeof RANGES; spec: RobotSpec; set: (s: RobotSpec) => void; unit?: string; step?: number }) {
  const [lo, hi] = RANGES[p.k];
  const v = p.spec.params[p.k] as number;
  return (
    <label className="field"><span>{p.label}</span>
      <input type="range" min={lo} max={hi} step={p.step ?? 1} value={v} onChange={e => p.set({ ...p.spec, params: { ...p.spec.params, [p.k]: +e.target.value } })} />
      <b>{v}{p.unit ?? ''}</b></label>
  );
}
function Bool(p: { label: string; k: 'tpuTires' | 'bumper' | 'panTilt' | 'hasArms' | 'hasTail' | 'hasWings'; spec: RobotSpec; set: (s: RobotSpec) => void }) {
  return <label className="field check"><input type="checkbox" checked={Boolean(p.spec.params[p.k])} onChange={e => p.set({ ...p.spec, params: { ...p.spec.params, [p.k]: e.target.checked } })} /><span>{p.label}</span></label>;
}

function DesignTab({ spec, setSpec, built, selected }: { spec: RobotSpec; setSpec: (s: RobotSpec) => void; built: { spec: RobotSpec; asm: Assembly } | null; selected: string | null }) {
  const P = spec.params;
  const sel = built?.asm.parts.find(p => p.id === selected);
  const t = (spec.archetype || '').toLowerCase();
  const isArm = t.includes('arm') || t.includes('crane');
  const isRover = t.includes('rover') || t.includes('car') || t.includes('vehicle') || t.includes('wheel') || t.includes('racer');
  const isCompanion = t.includes('companion') || t.includes('turret') || t.includes('head');
  const isLegged = t.includes('humanoid') || t.includes('biped') || t.includes('duck') || t.includes('quadruped') || t.includes('walker') || t.includes('crawler') || (!isArm && !isRover && !isCompanion);

  return (
    <div className="design">
      {sel && <div className="selected-card"><b>{sel.name}</b> · {sel.material} · {PROFILES[sel.profile].label}<br /><small>{sel.printNote}</small></div>}
      <label className="field"><span>Type</span>
        <input list="archetype-list" type="text" value={spec.archetype || ''} placeholder="e.g. duck, rover, humanoid, arm, quadruped" onChange={e => {
          const ar = e.target.value;
          const allowed = (BEHAVIORS[ar] ?? DEFAULT_BEHAVIORS).map(b => b.id);
          setSpec({ ...spec, archetype: ar, behaviors: allowed });
        }} />
        <datalist id="archetype-list">
          <option value="rover">Rover</option>
          <option value="humanoid">Humanoid</option>
          <option value="duck">Duck</option>
          <option value="arm">Desk Arm</option>
          <option value="companion">Companion</option>
          <option value="quadruped">Quadruped</option>
          <option value="walker">Walker</option>
        </datalist>
      </label>
      <label className="field"><span>Theme</span>
        <input type="text" value={spec.theme || ''} placeholder="e.g. duck, cat, retro, classic" onChange={e => {
          const val = e.target.value;
          setSpec({ ...spec, theme: val, params: { ...P, theme: val } });
        }} />
      </label>
      {spec.summary && <p className="summary">{spec.summary}</p>}
      {isRover && <>
        <label className="field"><span>Drive</span><select value={P.drive} onChange={e => setSpec({ ...spec, params: { ...P, drive: e.target.value as 'B-PG002' | 'B-GM001' } })}>
          <option value="B-PG002">B-PG002 continuous servos (S1/S2)</option><option value="B-GM001">B-GM001 geared motors (M1/M2, unverified)</option></select></label>
        <Num label="Wheel Ø" k="wheelDia" unit=" mm" spec={spec} set={setSpec} />
        <Num label="Wheel width" k="wheelWidth" unit=" mm" spec={spec} set={setSpec} />
        <Bool label="TPU tyres" k="tpuTires" spec={spec} set={setSpec} />
        <Bool label="TPU bumper + headlights" k="bumper" spec={spec} set={setSpec} />
        <Bool label="Pan-tilt head (S3/S4)" k="panTilt" spec={spec} set={setSpec} />
      </>}
      {isArm && <>
        <Num label="Upper arm" k="upperLen" unit=" mm" spec={spec} set={setSpec} />
        <Num label="Forearm" k="foreLen" unit=" mm" spec={spec} set={setSpec} />
        <Num label="Finger length" k="gripperLen" unit=" mm" spec={spec} set={setSpec} />
        <Num label="Design payload" k="payloadG" unit=" g" spec={spec} set={setSpec} />
      </>}
      {isLegged && <>
        <label className="field"><span>Head feature</span>
          <select value={P.headFeature || 'none'} onChange={e => setSpec({ ...spec, params: { ...P, headFeature: e.target.value as any } })}>
            <option value="none">Standard visor</option>
            <option value="beak">Beak / bill</option>
            <option value="ears">Pointed ears</option>
            <option value="visor">Visor brow</option>
            <option value="dome">Dome</option>
          </select>
        </label>
        <label className="field"><span>Foot style</span>
          <select value={P.footStyle || 'standard'} onChange={e => setSpec({ ...spec, params: { ...P, footStyle: e.target.value as any } })}>
            <option value="standard">Standard sole</option>
            <option value="webbed">Webbed flippers</option>
            <option value="wide">Wide stability sole</option>
          </select>
        </label>
        <Bool label="Tail feature" k="hasTail" spec={spec} set={setSpec} />
        <Bool label="Side wings / flippers" k="hasWings" spec={spec} set={setSpec} />
        <Num label="Leg length" k="legLen" unit=" mm" spec={spec} set={setSpec} />
        <Num label="Foot length" k="footLen" unit=" mm" spec={spec} set={setSpec} />
        <Num label="Foot width" k="footWidth" unit=" mm" spec={spec} set={setSpec} />
        <Bool label="Articulated arms (S5/S6)" k="hasArms" spec={spec} set={setSpec} />
        {P.hasArms && <Num label="Arm length" k="armLen" unit=" mm" spec={spec} set={setSpec} />}
      </>}
      {(isCompanion || (isRover && P.panTilt)) && <Num label="Head width" k="headWidth" unit=" mm" spec={spec} set={setSpec} />}
      <Num label="LEDs (B-KB003)" k="leds" spec={spec} set={setSpec} />
      <label className="field"><span>Structure</span><select value={spec.structural} onChange={e => setSpec({ ...spec, structural: e.target.value as Material })}>
        {(['PETG', 'ABS/ASA', 'PA-CF'] as Material[]).map(m => <option key={m} value={m}>{m} — {MATERIALS[m].use}</option>)}</select></label>
      <div className="colors">
        <label>Primary <input type="color" value={spec.primaryColor} onChange={e => setSpec({ ...spec, primaryColor: e.target.value })} /></label>
        <label>Accent <input type="color" value={spec.accentColor} onChange={e => setSpec({ ...spec, accentColor: e.target.value })} /></label>
      </div>
      <div className="field"><span>Behaviours</span>
        <div className="chips">{(BEHAVIORS[spec.archetype] ?? DEFAULT_BEHAVIORS).map(b => (
          <label key={b.id} className="chip"><input type="checkbox" checked={spec.behaviors.includes(b.id)} onChange={e => setSpec({ ...spec, behaviors: e.target.checked ? [...spec.behaviors, b.id] : spec.behaviors.filter(x => x !== b.id) })} />{b.label}</label>
        ))}</div></div>
      {built && <details className="steps" open><summary>Assembly steps</summary><ol>{built.asm.assemblySteps.map((s, i) => <li key={i}>{s.replace(/^\d+\.\s*/, '')}</li>)}</ol></details>}
    </div>
  );
}

function ChecksTab({ checks }: { checks: Check[] }) {
  const groups = ['Electrical', 'Power', 'Motion', 'Stability', 'Mechanical', 'Print'] as const;
  return (
    <div className="checks">
      {groups.map(g => {
        const list = checks.filter(c => c.group === g);
        if (!list.length) return null;
        return (
          <section key={g}><h3>{g}</h3>
            {list.map(c => <div key={c.id} className={`check ${c.status}`}><i>{c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✕'}</i><div><b>{c.label}</b><p>{c.detail}</p></div></div>)}
          </section>
        );
      })}
      <details><summary>CyberBrick 10-point pre-print checklist</summary><ol>{CHECKLIST.map((c, i) => <li key={i}>{c}</li>)}</ol></details>
    </div>
  );
}

export function BomTab({
  asm,
  spec,
  inventory,
  onOpenDirectory,
  buyMode,
}: {
  asm: Assembly;
  spec: RobotSpec;
  inventory?: ComponentDirectory;
  onOpenDirectory?: () => void;
  /** "Use any parts" is on: list what the built robot uses beyond the Directory */
  buyMode?: boolean;
}) {
  const lines = useMemo(() => bom(asm), [asm]);
  // the shopping list of the robot as built (not the AI's first pick): each part it uses minus what the Directory has
  const buy: [string, number][] = buyMode
    ? lines.filter(l => l.kind === 'module').map(l => [l.id, l.qty - (Number(inventory?.[l.id]) || 0)] as [string, number]).filter(([, q]) => q > 0)
    : [];
  const csv = () => 'kind,id,name,qty,note\n' + lines.map(l => [l.kind, l.id, l.name, l.qty, l.note ?? ''].map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');

  const dirTotals = useMemo(() => inventory ? getDirectoryTotals(inventory) : null, [inventory]);

  const maxServos = dirTotals ? dirTotals.servos : 4;
  const maxMotors = dirTotals ? dirTotals.motors : 2;
  const maxLeds = dirTotals ? dirTotals.leds : 6;
  const maxControllers = dirTotals ? dirTotals.controllers : 1;

  const acts = asm.links.filter(l => l.joint).map(l => l.joint!.actuator);
  const totalServos = acts.filter(x => x.kind === 'servo' || x.kind === 'cservo').length;
  const totalMotors = acts.filter(x => x.kind === 'motor').length;
  const totalLeds = asm.components.filter(c => c.catalogId === 'B-KB003').length;
  const totalCores = asm.components.filter(c => CATALOG[c.catalogId]?.kind === 'controller').length;
  const exceeds = totalServos > maxServos || totalMotors > maxMotors || totalLeds > maxLeds || (totalCores > 0 && maxControllers > 0 && totalCores > maxControllers);

  return (
    <div className="bom">
      <div className={`kit-usage-card ${exceeds ? 'over' : ''}`}>
        <div className="kit-usage-hd">
          <b>Component Directory Stock</b>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className={`kit-badge ${exceeds ? 'err' : 'ok'}`}>{exceeds ? 'Shortage' : 'In Stock'}</span>
            {onOpenDirectory && <button className="mini-btn" onClick={onOpenDirectory} title="Manage component stock directory">⚙ Stock</button>}
          </div>
        </div>
        <div className="kit-usage-stats">
          <div className={totalServos > maxServos ? 'warn' : ''}><span>Servos</span><b>{totalServos}/{maxServos}</b></div>
          <div className={totalMotors > maxMotors ? 'warn' : ''}><span>Motors</span><b>{totalMotors}/{maxMotors}</b></div>
          <div className={totalLeds > maxLeds ? 'warn' : ''}><span>LEDs</span><b>{totalLeds}/{maxLeds}</b></div>
          <div className={totalCores > maxControllers ? 'warn' : ''}><span>Core</span><b>{totalCores}/{maxControllers}</b></div>
        </div>
      </div>

      {buy.length > 0 && (
        <section className="to-buy">
          <h3>🛒 To buy ({buy.length})</h3>
          <p style={{ fontSize: 12, opacity: 0.8, margin: '0 0 6px' }}>"Use any parts" is on: the design uses these, and your directory doesn't have them (or has too few). Add them to the directory once you have them.</p>
          <table>
            <tbody>
              {buy.map(([id, q]) => (
                <tr key={id} style={{ background: 'rgba(245, 166, 35, 0.12)' }}>
                  <td className="q">{q}×</td>
                  <td><code>{id}</code> {CATALOG[id]?.name ?? id}{CATALOG[id]?.electrical && <small>{CATALOG[id]!.electrical}</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => download(`${slug(spec.name)}_to_buy.csv`, 'id,name,qty\n' + buy.map(([id, q]) => `"${id}","${(CATALOG[id]?.name ?? id).replace(/"/g, '""')}",${q}`).join('\n'), 'text/csv')}>Download shopping list (CSV)</button>
        </section>
      )}
      {(['module', 'fastener', 'print', 'other'] as const).map(k => {
        const list = lines.filter(l => l.kind === k);
        if (!list.length) return null;
        return (
          <section key={k}>
            <h3>{{ module: 'CyberBrick & Maker Components', fastener: 'Fasteners', print: 'Filament', other: 'Other Hardware' }[k]}</h3>
            <table>
              <tbody>
                {list.map(l => {
                  const stock = inventory && l.id in inventory ? inventory[l.id] : undefined;
                  const short = stock !== undefined && stock < l.qty;
                  return (
                    <tr key={l.id + l.name} style={short ? { background: 'rgba(240, 78, 93, 0.12)' } : undefined}>
                      <td className="q">{l.qty}{k === 'print' ? ' g' : '×'}</td>
                      <td>
                        {k === 'module' && <code>{l.id}</code>} {l.name}
                        {stock !== undefined && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: short ? 'var(--fail)' : 'var(--pass)', fontWeight: 500 }}>
                            ({stock} owned{short ? ' ⚠ deficit' : ' ✓'})
                          </span>
                        )}
                        {l.note && <small>{l.note}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      <button onClick={() => download(`${slug(spec.name)}_bom.csv`, csv(), 'text/csv')}>Download BOM (CSV)</button>
    </div>
  );
}

export function PrintTab({ asm, spec, selected, onSelect, behaviors }: { asm: Assembly; spec: RobotSpec; selected: string | null; onSelect: (id: string | null) => void; behaviors: Behavior[] }) {
  const stats = useMemo(() => partStats(asm), [asm]);
  const fw = () => firmwareFiles(spec, asm, behaviors);
  const readme = () => `# ${spec.name}\n\n${spec.summary}\n\nGenerated by PICOCEO Builder.\n\n## Parts\n\n| Part | Material | Profile | Orientation |\n|---|---|---|---|\n${asm.parts.map(p => `| ${p.name} | ${p.material} | ${PROFILES[p.profile].layer} mm, ${PROFILES[p.profile].walls} walls, ${Math.round(PROFILES[p.profile].infill * 100)} % ${PROFILES[p.profile].pattern} | ${p.printNote} |`).join('\n')}\n\n## Assembly\n\n${asm.assemblySteps.map(s => `- ${s}`).join('\n')}\n`;
  return (
    <div className="print">
      <div className="actions">
        <button className="primary" onClick={() => download(`${slug(spec.name)}.3mf`, threeMF(spec, asm), 'model/3mf')}>Download 3MF (Bambu Studio)</button>
        <button onClick={() => {
          const files = fw(); const extra: Record<string, string> = { 'README.md': readme() };
          for (const [k, v] of Object.entries(files)) extra[`firmware/${k}`] = v;
          extra['bom.csv'] = 'kind,id,name,qty,note\n' + bom(asm).map(l => [l.kind, l.id, l.name, l.qty, l.note ?? ''].map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
          download(`${slug(spec.name)}_project.zip`, projectZip(spec, asm, extra), 'application/zip');
        }}>Download full project (ZIP)</button>
      </div>
      <table className="parts">
        <thead><tr><th>Part</th><th>Material</th><th>Slicer</th><th>g</th><th>h</th><th /></tr></thead>
        <tbody>{asm.parts.map((p, i) => {
          const pr = PROFILES[p.profile];
          return (
            <tr key={p.id} className={selected === p.id ? 'sel' : ''} onClick={() => onSelect(selected === p.id ? null : p.id)}>
              <td><span className="sw" style={{ background: p.color }} />{p.name}<small>{p.printNote}</small></td>
              <td>{p.material}</td>
              <td>{pr.layer} · {pr.walls}W · {Math.round(pr.infill * 100)}%<small>{pr.pattern}</small></td>
              <td>{stats[i].grams.toFixed(0)}</td>
              <td>{stats[i].hours.toFixed(1)}</td>
              <td><button className="mini" onClick={e => { e.stopPropagation(); download(`${p.id}.stl`, stlBinary(p.printMesh, p.name), 'model/stl'); }}>STL</button></td>
            </tr>
          );
        })}</tbody>
      </table>
      <p className="note">Meshes are watertight and already in print orientation. Fits: push +{FIT.push} · slide +{FIT.slide}/wall · journal +{FIT.journal} · taps M2 Ø{HOLES.M2.tap} / M2.5 Ø{HOLES.M2_5.tap} / M3 Ø{HOLES.M3.tap}. Times are estimates for a Bambu-class printer.</p>
    </div>
  );
}

export function WiringTab({ asm }: { asm: Assembly }) {
  const acts = asm.links.filter(l => l.joint).map(l => l.joint!.actuator);
  const leds = asm.components.filter(c => c.catalogId === 'B-KB003');
  const voice = voiceWiring(asm);
  if (voice) {
    const linux = !asm.components.some(c => c.key === 'voice_board' && !/^(RPI|JETSON)/.test(c.catalogId));
    return (
      <div className="wiring">
        <table><thead><tr><th>From</th><th>To</th><th>Pin</th><th>Notes</th></tr></thead><tbody>{voice.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
        <p className="note warn">{linux
          ? <>Enable I2C / SPI / I2S on the board (<code>raspi-config</code> or <code>jetson-io</code>), check <code>i2cdetect -y 1</code> shows 40 and <code>arecord -l</code> / <code>aplay -l</code> list the mic and speaker, then send <code>calib</code> before fitting horns.</>
          : <>Pins follow the XiaoZhi bread-board wiring used in config.py; change them there if yours differ. Send <code>calib</code> before fitting horns.</>}</p>
      </div>
    );
  }
  if (asm.components.some(c => c.catalogId === 'LICHEERV-NANO-W')) {
    const ch = (port: string) => Number(port.slice(1)) - 1;
    const claw: [string, string, string, string][] = [
      ['1S battery (in the base / body)', 'PicoClaw board BAT', '—', 'red +3.7 V, black GND; charges over USB-C; runs up to the head with the module cable'],
      ['Speaker 8 Ω 1 W', 'PicoClaw speaker pads', '—', 'glued behind the grille'],
      ['Left / right side keys, LEDs', 'on the PicoClaw board', 'GPIO 504 / 509, 495 / 498', 'sysfs numbers (Sipeed wiki)'],
      ...(acts.length ? [
        ['PCA9685 VCC · GND · SDA · SCL', 'Nano 3V3 · GND · I2C', 'addr 0x40', 'bus number: I2C_BUS in config.py'],
        ['5 V supply', 'PCA9685 V+ terminal', '—', 'servo power'],
      ] as [string, string, string, string][] : []),
      ...acts.map(x => [`${x.label} (${x.catalogId})`, `PCA9685 channel ${ch(x.port)}`, `PWM ch${ch(x.port)}`, 'brown GND · red V+ · orange signal'] as [string, string, string, string]),
    ];
    return (
      <div className="wiring">
        <table><thead><tr><th>From</th><th>To</th><th>Pin</th><th>Notes</th></tr></thead><tbody>{claw.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
        <p className="note warn">Check the I2C bus on your image (<code>ls /dev/i2c-*</code>, <code>i2cdetect -y 1</code> shows 40) and send <code>calib</code> before fitting horns.</p>
      </div>
    );
  }
  const rows: [string, string, string, string][] = [
    ['B-PC003 battery (XH2.54)', 'B-XA007 switch', '—', 'red +7.4 V, black GND'],
    ['B-XA007 switch', 'Shield power input', '—', '6.0-9.0 V'],
    ...acts.map(x => [`${x.label} (${x.catalogId})`, `Shield ${x.port}`, x.port.startsWith('S') ? `GPIO ${(GPIO as Record<string, number>)[x.port]}` : 'unverified', x.port.startsWith('S') ? 'brown GND · red 5 V · orange signal' : 'H-bridge output'] as [string, string, string, string]),
    ...(leds.length ? [['B-XA006 LED hub input', 'Shield D1', `GPIO ${GPIO.D1}`, '5 V · GND · data'] as [string, string, string, string]] : []),
    ...leds.map((l, i) => [l.label, `Hub branch ${i + 1}`, `chain index ${i}`, 'JST-SH 3-pin'] as [string, string, string, string]),
  ];
  return (
    <div className="wiring">
      <table><thead><tr><th>From</th><th>To</th><th>Pin</th><th>Notes</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
      <p className="note">{PIN_STANDARD}</p>
      <p className="note warn">GPIO numbers are from the community CyberBrick_ESPNOW wiki, not official documentation. Verify each joint with <code>j &lt;joint&gt; 10</code> before fitting horns.</p>
    </div>
  );
}

function FirmwareTab({
  asm,
  spec,
  behaviors,
  rlPolicy,
  isFirmwareOutdated,
  onUpdateFirmware,
}: {
  asm: Assembly;
  spec: RobotSpec;
  behaviors: Behavior[];
  rlPolicy?: RLPolicyParams;
  isFirmwareOutdated?: boolean;
  onUpdateFirmware?: (policy?: RLPolicyParams) => void;
}) {
  const files = useMemo(() => firmwareFiles(spec, asm, behaviors, rlPolicy), [asm, spec, behaviors, rlPolicy]);
  const [f, setF] = useState('main.py');
  return (
    <div className="firmware">
      <div className="actions">
        <div className="seg">{Object.keys(files).map(k => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{k}</button>)}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isFirmwareOutdated ? (
            <button
              className="mini-btn primary"
              style={{ background: '#d97706', borderColor: '#f59e0b', color: '#fff' }}
              onClick={() => onUpdateFirmware?.(rlPolicy)}
              title="Locomotion parameters modified in simulation. Click to update firmware files."
            >
              ⚡ Update Firmware
            </button>
          ) : (
            <button
              className="mini-btn"
              style={{ color: '#34d399', borderColor: '#059669' }}
              onClick={() => onUpdateFirmware?.(rlPolicy)}
            >
              ✓ Firmware Up to Date
            </button>
          )}
          <button className="primary" onClick={() => download(`${slug(spec.name)}_firmware.zip`, firmwareZip(spec, files), 'application/zip')}>
            Download (.ZIP)
          </button>
        </div>
      </div>
      {rlPolicy && (
        <div style={{
          fontSize: 11,
          background: '#090d14',
          border: '1px solid #1e293b',
          borderRadius: 4,
          padding: '6px 10px',
          marginBottom: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ color: '#cbd5e1' }}>
            🧠 <b>Learned Gait:</b> S1/S2 Stride {rlPolicy.strideAmpDeg.toFixed(1)}° · S3/S4 Waddle {rlPolicy.waddleAmpDeg.toFixed(1)}° · {rlPolicy.freqHz.toFixed(2)} Hz · Pitch Trim {rlPolicy.pitchTrimDeg.toFixed(1)}° · Balance Reflex kp {rlPolicy.kpPitch.toFixed(2)}
          </span>
          {isFirmwareOutdated && (
            <span style={{ color: '#f59e0b', fontWeight: 600, fontSize: 10, marginLeft: 8 }}>
              ● Update Available
            </span>
          )}
        </div>
      )}
      <pre className="code">{files[f]}</pre>
    </div>
  );
}

const COMPONENT_STLS: Record<string, string> = {
  'B-XA003': 'B-XA003_ESP32_Core.stl',
  'B-XA004': 'B-XA004_Power_Shield.stl',
  'B-PG001': 'B-PG001_180_Servo.stl',
  'B-PG002': 'B-PG002_Continuous_Servo.stl',
  'B-GM001': 'B-GM001_Geared_Motor.stl',
  'B-PC003': 'B-PC003_2S_Battery.stl',
  'B-XA007': 'B-XA007_Toggle_Switch.stl',
  'B-XA006': 'B-XA006_LED_Hub.stl',
  'B-KB003': 'B-KB003_RGBW_LED.stl',
};

function CatalogTab() {
  return (
    <div className="catalog">
      <div className="card hero-ref">
        <div className="hd">CyberBrick 3D Reference Library (Guide s.1-3, s.10)</div>
        <p>Watertight 3D CAD models of all CyberBrick hardware modules & reference mechanisms encoded from <code>CyberBrick_Robotics_Hardware_and_3D_Design_Guide.pdf</code>.</p>
        <a className="btn primary" href="/reference/CyberBrick_Reference_3D_Models.zip" download="CyberBrick_Reference_3D_Models.zip">
          Download All 3D Models (.ZIP)
        </a>
      </div>

      <div className="card">
        <div className="hd">Popular Robot Kits on the Market</div>
        <p>Pre-configured robotics kits supported out of the box in PICOCEO Builder with component sizing & inventory checks:</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px', marginTop: '10px' }}>
          {Object.values(POPULAR_KITS).map(kit => (
            <div key={kit.id} style={{ padding: '10px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ color: '#38bdf8', fontSize: '13px' }}>{kit.name}</b>
              </div>
              <p style={{ margin: '4px 0 8px', fontSize: '11px', color: '#94a3b8', lineHeight: '1.4' }}>{kit.description}</p>
              <div style={{ fontSize: '10px', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div>• Controller: <code>{kit.mainController}</code></div>
                <div>• Battery: <code>{kit.defaultBattery}</code></div>
                <div>• Servos/Motors: <code>{kit.servoModel}</code></div>
                {kit.hasSpeaker && <div style={{ color: '#4ade80' }}>✓ Built-in Speaker & Audio chamber</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="hd">Reference Mechanisms (Guide s.10, Figure 4.1)</div>
        <dl>
          <dt>Cross-Clamp</dt>
          <dd>Under-Hood Horizontal Cross-Clamping Joint: Flange collar, tongue & cheek clearance +0.30mm, M3 bolt, captive M3 nut pocket (5.60mm AF).</dd>
          <dt>21T Horn</dt>
          <dd>21T Micro Spline Horn (Ø4.8mm spline) with pilot holes at 10.0 and 13.5 mm.</dd>
        </dl>
        <div className="actions" style={{ marginTop: 8 }}>
          <a href="/reference/Reference_Under_Hood_Tongue_Cheek_Clamp.stl" download="Reference_Under_Hood_Tongue_Cheek_Clamp.stl" className="btn-sm">
            Clamp Mechanism (.STL)
          </a>
          <a href="/reference/Horn_21T_Micro_Spline.stl" download="Horn_21T_Micro_Spline.stl" className="btn-sm">
            21T Spline Horn (.STL)
          </a>
        </div>
      </div>

      {Object.values(CATALOG).map(c => (
        <div key={c.id} className="card">
          <div className="hd"><code>{c.id}</code> {c.name}</div>
          <dl>
            <dt>Size</dt><dd>{c.size.join(' × ')} mm · {c.massG} g{c.massEstimated ? ' (est.)' : ''}</dd>
            <dt>Electrical</dt><dd>{c.electrical}</dd>
            {c.mechanical && <><dt>Mechanical</dt><dd>{c.mechanical}</dd></>}
            {c.connector && <><dt>Connector</dt><dd>{c.connector}</dd></>}
          </dl>
          {COMPONENT_STLS[c.id] && (
            <div className="model-link">
              <a href={`/reference/${COMPONENT_STLS[c.id]}`} download={COMPONENT_STLS[c.id]} className="btn-sm">
                Download 3D Model ({COMPONENT_STLS[c.id]})
              </a>
            </div>
          )}
          {c.notes?.map((n, i) => <p key={i} className="note warn">{n}</p>)}
        </div>
      ))}
      <div className="card"><div className="hd">Slicing profiles (guide s.8)</div>
        <table><tbody>{Object.values(PROFILES).map(p => <tr key={p.key}><td>{p.label}</td><td>{p.layer} mm · {p.walls} walls · {Math.round(p.infill * 100)} % {p.pattern}</td></tr>)}</tbody></table></div>
      <div className="card"><div className="hd">Materials (guide s.9)</div>
        <table><tbody>{(Object.keys(MATERIALS) as Material[]).map(m => <tr key={m}><td>{m}</td><td>{MATERIALS[m].tensile} · HDT {MATERIALS[m].hdt}<small>{MATERIALS[m].use}</small></td></tr>)}</tbody></table></div>
    </div>
  );
}

function AiLeadCard(props: {
  step: StepNumber;
  reasoning?: string;
  model?: string;
  runningStep?: StepNumber | null;
  onRerun?: (step: StepNumber) => void;
}) {
  const busy = props.runningStep === props.step;
  return (
    <div className="ai-lead-card">
      <div className="ai-lead-hd">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="ai-lead-badge">🤖 AI Lead Architect</span>
          {props.model && <code className="ai-model-tag">{props.model}</code>}
        </div>
        {props.onRerun && (
          <button
            type="button"
            className="mini-btn ai-rerun-btn"
            disabled={busy || props.runningStep !== null && props.runningStep !== undefined}
            onClick={() => props.onRerun?.(props.step)}
            title={`Ask AI to lead and re-synthesize ${STEP_DEFINITIONS.find(s => s.step === props.step)?.shortTitle || 'this stage'}`}
          >
            {busy
              ? `Synthesizing ${STEP_DEFINITIONS.find(s => s.step === props.step)?.shortTitle || ''}…`
              : `✨ AI Lead ${STEP_DEFINITIONS.find(s => s.step === props.step)?.shortTitle || 'Stage'}`}
          </button>
        )}
      </div>
      {props.reasoning && <p className="ai-lead-text">{props.reasoning}</p>}
    </div>
  );
}

function FlowTab(props: {
  report: SevenStepFlowReport;
  asm: Assembly;
  spec: RobotSpec;
  activeStep: StepNumber | 'all';
  setActiveStep: (s: StepNumber | 'all') => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpenDirectory?: () => void;
  onRequestViewportMode?: (mode: 'assembly' | 'print' | 'sim', behavior?: string) => void;
  onFixChecks?: () => void;
  onRerunStep?: (step: StepNumber) => void;
  runningStep?: StepNumber | null;
  rlPolicy?: RLPolicyParams;
  isFirmwareOutdated?: boolean;
  onUpdateFirmware?: (policy?: RLPolicyParams) => void;
}) {
  const { report, asm, spec, activeStep, setActiveStep, selected, onSelect } = props;
  const [fwFile, setFwFile] = useState<string>('main.py');
  const showStep = (s: StepNumber) => activeStep === 'all' || activeStep === s;

  const readme = () => `# ${spec.name}\n\n${spec.summary}\n\nGenerated by PICOCEO Builder.\n`;

  return (
    <div className="flow-tab">
      {/* Design Flow Stepper Navigation */}
      <div className="flow-stepper">
        <button
          type="button"
          className={`flow-step-btn all ${activeStep === 'all' ? 'on' : ''}`}
          onClick={() => setActiveStep('all')}
        >
          All Stages
        </button>
        {STEP_DEFINITIONS.map(sd => {
          const st = report.steps.find(x => x.step === sd.step)?.status ?? 'pass';
          return (
            <button
              key={sd.step}
              type="button"
              className={`flow-step-btn ${st} ${activeStep === sd.step ? 'on' : ''}`}
              onClick={() => setActiveStep(sd.step)}
              title={sd.title}
            >
              <i className={`st-dot ${st}`}>{st === 'fail' ? '✕' : st === 'warn' ? '!' : st === 'optional' ? '○' : '✓'}</i>
              <span>{sd.shortTitle}</span>
            </button>
          );
        })}
      </div>

      {/* STEP 1: From Idea to Selection of Components */}
      {showStep(1) && (
        <section className="flow-section">
          <div className="flow-sec-hd">
            <div>
              <span className="step-num-tag">COMPONENTS</span>
              <h3>Selection of Components</h3>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className={`kit-badge ${report.step1.allInStock ? 'ok' : 'err'}`}>
                {report.step1.allInStock ? 'All In Stock' : 'Stock Shortage'}
              </span>
              {props.onOpenDirectory && (
                <button className="mini-btn" onClick={props.onOpenDirectory}>⚙ Directory Stock</button>
              )}
            </div>
          </div>
          <AiLeadCard
            step={1}
            reasoning={report.step1.aiReasoning || report.step1.selectionRationale}
            model={report.step1.aiModel}
            runningStep={props.runningStep}
            onRerun={props.onRerunStep}
          />
          <table className="flow-table">
            <thead>
              <tr>
                <th>Qty</th>
                <th>Component</th>
                <th>Role in Robot</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {report.step1.selectedComponents.map(c => (
                <tr key={c.id} className={!c.inStock ? 'row-warn' : ''}>
                  <td className="q">{c.qty}×</td>
                  <td>
                    <code>{c.id}</code> <b>{c.name}</b>
                    <small>{c.envelopeMm.join('×')} mm · {c.electrical}</small>
                  </td>
                  <td><small>{c.role}</small></td>
                  <td>
                    <span className={`stock-pill ${c.inStock ? 'ok' : 'short'}`}>
                      {c.owned} owned {c.inStock ? '✓' : '⚠'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.step1.fasteners.length > 0 && (
            <div className="flow-fasteners">
              <b>Fasteners: </b>
              {report.step1.fasteners.map(f => `${f.qty}× ${f.name}`).join(' · ')}
            </div>
          )}
        </section>
      )}

      {/* STEP 2: Overall 3D Form & Concept Envelope */}
      {showStep(2) && (
        <section className="flow-section">
          <div className="flow-sec-hd">
            <div>
              <span className="step-num-tag">3D FORM &amp; SILHOUETTE</span>
              <h3>Overall 3D Form &amp; Concept Envelope</h3>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="morph-chip" style={{ background: '#0284c7', color: '#fff' }}>
                {report.step2.form.overallDimensionsMm.join(' × ')} mm
              </span>
            </div>
          </div>
          <AiLeadCard
            step={2}
            reasoning={report.step2.aiReasoning || report.step2.form.silhouetteSummary}
            model={report.step2.aiModel}
            runningStep={props.runningStep}
            onRerun={props.onRerunStep}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, margin: '10px 0' }}>
            <div style={{ background: '#0b1329', padding: '10px 12px', borderRadius: 6, border: '1px solid #1e293b' }}>
              <small style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>Shape Archetype</small>
              <div style={{ fontWeight: 600, color: '#38bdf8', marginTop: 2 }}>{report.step2.form.envelopeShape}</div>
            </div>
            <div style={{ background: '#0b1329', padding: '10px 12px', borderRadius: 6, border: '1px solid #1e293b' }}>
              <small style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>Design Style</small>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginTop: 2 }}>{report.step2.form.designStyle}</div>
            </div>
            <div style={{ background: '#0b1329', padding: '10px 12px', borderRadius: 6, border: '1px solid #1e293b' }}>
              <small style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>Initial Bounding Box</small>
              <div style={{ fontWeight: 600, color: '#34d399', marginTop: 2 }}>{report.step2.form.overallDimensionsMm.join(' × ')} mm</div>
            </div>
          </div>

          <div className="flow-morph-chips" style={{ marginTop: 8 }}>
            {report.step2.form.features.map((f, i) => (
              <span key={i} className="morph-chip">★ {f}</span>
            ))}
          </div>
        </section>
      )}

      {/* STEP 3: Component Packaging & 3D Fit Optimization */}
      {showStep(3) && (
        <section className="flow-section">
          <div className="flow-sec-hd">
            <div>
              <span className="step-num-tag">PACKAGING &amp; FIT</span>
              <h3>Component Packaging &amp; 3D Fit Optimization</h3>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className={`fit-badge ${report.step3.fitStatus === 'perfect_fit' ? 'pass' : 'warn'}`}>
                {report.step3.fitStatus === 'perfect_fit'
                  ? '✓ Perfect Fit'
                  : `⚡ Auto-Expanded (+${report.step3.expansionDeltaMm[0]}W, +${report.step3.expansionDeltaMm[1]}D, +${report.step3.expansionDeltaMm[2]}H)`}
              </span>
              {props.onRequestViewportMode && (
                <button className="mini-btn" onClick={() => props.onRequestViewportMode?.('assembly')}>
                  View 3D Assembly
                </button>
              )}
            </div>
          </div>
          <AiLeadCard
            step={3}
            reasoning={report.step3.aiReasoning || report.step3.fitExplanation}
            model={report.step3.aiModel}
            runningStep={props.runningStep}
            onRerun={props.onRerunStep}
          />

          <div style={{
            background: report.step3.fitStatus === 'perfect_fit' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.1)',
            border: `1px solid ${report.step3.fitStatus === 'perfect_fit' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.4)'}`,
            borderRadius: 6,
            padding: '10px 12px',
            marginBottom: 12,
            fontSize: 12,
            color: report.step3.fitStatus === 'perfect_fit' ? '#6ee7b7' : '#fde68a',
          }}>
            <b>{report.step3.fitStatus === 'perfect_fit' ? '✓ Fit Verification:' : '⚡ Auto-Adjustment Applied:'}</b> {report.step3.fitExplanation}
          </div>

          <table className="flow-table compact" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>3D Envelope Phase</th>
                <th>Width (X)</th>
                <th>Depth (Y)</th>
                <th>Height (Z)</th>
                <th>Adjustment Delta</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>Initial Form (Step 2)</b></td>
                <td className="mono">{report.step3.initialEnvelopeMm[0]} mm</td>
                <td className="mono">{report.step3.initialEnvelopeMm[1]} mm</td>
                <td className="mono">{report.step3.initialEnvelopeMm[2]} mm</td>
                <td><small style={{ color: '#94a3b8' }}>Baseline concept</small></td>
              </tr>
              <tr style={{ background: report.step3.fitStatus === 'auto_expanded' ? 'rgba(245, 158, 11, 0.07)' : undefined }}>
                <td><b>Fitted Enclosure (Step 3)</b></td>
                <td className="mono" style={{ color: report.step3.expansionDeltaMm[0] > 0 ? '#f59e0b' : '#38bdf8', fontWeight: 600 }}>{report.step3.adjustedEnvelopeMm[0]} mm</td>
                <td className="mono" style={{ color: report.step3.expansionDeltaMm[1] > 0 ? '#f59e0b' : '#38bdf8', fontWeight: 600 }}>{report.step3.adjustedEnvelopeMm[1]} mm</td>
                <td className="mono" style={{ color: report.step3.expansionDeltaMm[2] > 0 ? '#f59e0b' : '#38bdf8', fontWeight: 600 }}>{report.step3.adjustedEnvelopeMm[2]} mm</td>
                <td>
                  <span className={`stock-pill ${report.step3.fitStatus === 'perfect_fit' ? 'ok' : 'short'}`}>
                    {report.step3.fitStatus === 'perfect_fit'
                      ? '0 mm (Fits cleanly)'
                      : `+${report.step3.expansionDeltaMm.join(' × +')} mm expanded`}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          <h4 className="flow-sub-hd">Internal Module Placement &amp; Clearance</h4>
          <table className="flow-table compact">
            <thead>
              <tr>
                <th>Module</th>
                <th>Link</th>
                <th>Position [X, Y, Z]</th>
                <th>Envelope</th>
              </tr>
            </thead>
            <tbody>
              {report.step3.spatialLayout.map(sp => (
                <tr key={sp.id}>
                  <td><code>{sp.catalogId}</code> {sp.label}</td>
                  <td><code>{sp.link}</code></td>
                  <td className="mono">[{sp.pos.join(', ')}]</td>
                  <td className="mono">{sp.size.join('×')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {report.step3.kinematicChain.length > 0 && (
            <>
              <h4 className="flow-sub-hd">Kinematic Joint Chain</h4>
              <table className="flow-table compact">
                <thead>
                  <tr>
                    <th>Joint / Link</th>
                    <th>Actuator &amp; Port</th>
                    <th>Pivot [X, Y, Z]</th>
                    <th>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {report.step3.kinematicChain.map(k => (
                    <tr key={k.linkId}>
                      <td><b>{k.name}</b> <small>({k.parent} → {k.linkId})</small></td>
                      <td><code>{k.actuatorId}</code> · <b>{k.port}</b></td>
                      <td className="mono">[{k.pivot.join(', ')}]</td>
                      <td>{k.range ? `${k.range[0]}°..${k.range[1]}°` : '360° cont.'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h4 className="flow-sub-hd">Electrical &amp; Signal Connections</h4>
          <table className="flow-table compact">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Pin / GPIO</th>
                <th>Wire Spec</th>
              </tr>
            </thead>
            <tbody>
              {report.step3.connections.map((w, i) => (
                <tr key={i}>
                  <td>{w.from}</td>
                  <td>{w.to}</td>
                  <td><code>{w.gpio}</code></td>
                  <td><small>{w.wireSpec}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* STEP 4: 3D Printed Parts & Geometry Synthesis */}
      {showStep(4) && (
        <section className="flow-section">
          <div className="flow-sec-hd">
            <div>
              <span className="step-num-tag">3D PARTS &amp; FORM</span>
              <h3>Printed Parts &amp; Overall Form</h3>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {props.onRequestViewportMode && (
                <button className="mini-btn" onClick={() => props.onRequestViewportMode?.('print')}>
                  View Print Plates
                </button>
              )}
              <button
                className="mini-btn"
                onClick={() => download(`${slug(spec.name)}.3mf`, threeMF(spec, asm), 'model/3mf')}
              >
                Download 3MF
              </button>
            </div>
          </div>
          <AiLeadCard
            step={4}
            reasoning={report.step4.aiReasoning}
            model={report.step4.aiModel}
            runningStep={props.runningStep}
            onRerun={props.onRerunStep}
          />

          <div className="flow-morph-chips">
            {report.step4.morphologyFeatures.map((f, i) => (
              <span key={i} className="morph-chip">{f}</span>
            ))}
          </div>

          <table className="flow-table parts">
            <thead>
              <tr>
                <th>3D Printed Part</th>
                <th>Mat / Profile</th>
                <th>Dims (mm)</th>
                <th>Mass / Time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {report.step4.printedParts.map(p => {
                const rawPart = asm.parts.find(x => x.id === p.id);
                return (
                  <tr
                    key={p.id}
                    className={selected === p.id ? 'sel' : ''}
                    onClick={() => onSelect(selected === p.id ? null : p.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <span className="sw" style={{ background: p.color }} />
                      <b>{p.name}</b>
                      <small>{p.printNote}</small>
                    </td>
                    <td>{p.material}<small>{p.profile}</small></td>
                    <td className="mono">{p.dims.join('×')}<small>Fits {p.fitsPrinter}</small></td>
                    <td>{p.grams} g<small>{p.hours} h</small></td>
                    <td>
                      {rawPart && (
                        <button
                          className="mini"
                          onClick={e => {
                            e.stopPropagation();
                            download(`${p.id}.stl`, stlBinary(rawPart.printMesh, p.name), 'model/stl');
                          }}
                        >
                          STL
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* STEP 5: Engineering Rules & Interference Audit */}
      {showStep(5) && (
        <section className="flow-section">
          <div className="flow-sec-hd">
            <div>
              <span className="step-num-tag">AUDIT</span>
              <h3>Engineering Rules Audit</h3>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="audit-pill pass">✓ {report.step5.passCount} Pass</span>
              {report.step5.warnCount > 0 && <span className="audit-pill warn">! {report.step5.warnCount} Warn</span>}
              {report.step5.failCount > 0 && <span className="audit-pill fail">✕ {report.step5.failCount} Fail</span>}
              {report.step5.designFailCount > 0 && props.onFixChecks && (
                <button className="mini-btn fix-btn" onClick={props.onFixChecks}>
                  Auto-Fix ({report.step5.designFailCount})
                </button>
              )}
            </div>
          </div>
          <AiLeadCard
            step={5}
            reasoning={report.step5.aiReasoning}
            model={report.step5.aiModel}
            runningStep={props.runningStep}
            onRerun={props.onRerunStep}
          />

          {report.step5.aiFindings && report.step5.aiFindings.length > 0 && (
            <div className="checks">
              {report.step5.aiFindings.map((f, i) => (
                <div key={i} className={`check ${f.status}`}>
                  <i>{f.status === 'pass' ? '✓' : f.status === 'warn' ? '!' : '✕'}</i>
                  <div>
                    <b>[AI Audit · {f.domain}] {f.analysis}</b>
                    <p>{f.actionTaken}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {report.step5.fixesApplied.length > 0 && (
            <div className="flow-fixes-box">
              <b>Auto-clamped &amp; normalized rules:</b>
              <ul>
                {report.step5.fixesApplied.map((fx, i) => <li key={i}>{fx}</li>)}
              </ul>
            </div>
          )}

          <div className="checks">
            {report.step5.checks.map(c => (
              <div key={c.id} className={`check ${c.status}`}>
                <i>{c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✕'}</i>
                <div>
                  <b>[{c.group}] {c.label}</b>
                  <p>{c.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* STEP 6: Physics & Behavior Simulation */}
      {showStep(6) && (
        <section className="flow-section">
          <div className="flow-sec-hd">
            <div>
              <span className="step-num-tag">SIMULATION</span>
              <h3>Physics &amp; Behavior Simulation</h3>
            </div>
            {props.onRequestViewportMode && (
              <button
                className="primary mini-btn"
                onClick={() => props.onRequestViewportMode?.('sim', report.step6.behaviors[0]?.id)}
              >
                ▶ Run in 3D Simulator
              </button>
            )}
          </div>
          <AiLeadCard
            step={6}
            reasoning={
              report.step6.aiReasoning ||
              `Physics Engine: ${report.step6.engine} · ${report.step6.linksCount} rigid links · ${report.step6.jointsCount} active joints`
            }
            model={report.step6.aiModel}
            runningStep={props.runningStep}
            onRerun={props.onRerunStep}
          />

          {report.step6.simulationScenarios && report.step6.simulationScenarios.length > 0 && (
            <div className="checks">
              {report.step6.simulationScenarios.map((sc, i) => (
                <div key={i} className="check pass">
                  <i>▶</i>
                  <div>
                    <b>Scenario: {sc.name}</b>
                    <p>{sc.description} — <em>Target: {sc.targetMetric}</em></p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="sim-behaviors-grid">
            {report.step6.behaviors.map(b => {
              const dur = b.keys.length > 0 ? b.keys[b.keys.length - 1].t : 0;
              return (
                <div key={b.id} className="sim-beh-card">
                  <div>
                    <b>{b.label}</b>
                    <small>{b.keys.length} keyframes · {dur.toFixed(1)}s {b.loop ? 'loop' : 'one-shot'}</small>
                  </div>
                  {props.onRequestViewportMode && (
                    <button
                      className="mini-btn"
                      onClick={() => props.onRequestViewportMode?.('sim', b.id)}
                    >
                      ▶ Simulate "{b.label}"
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* STEP 7: Firmware & Embedded Control */}
      {showStep(7) && (
        <section className="flow-section">
          <div className="flow-sec-hd">
            <div>
              <span className="step-num-tag">FIRMWARE · OPTIONAL</span>
              <h3>Firmware &amp; Embedded Control</h3>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {props.isFirmwareOutdated ? (
                <button
                  className="mini-btn primary"
                  style={{ background: '#d97706', borderColor: '#f59e0b', color: '#fff' }}
                  onClick={() => props.onUpdateFirmware?.(props.rlPolicy)}
                  title="Locomotion parameters modified: click to compile into ESP32-C3 firmware"
                >
                  ⚡ Update Firmware
                </button>
              ) : (
                <button
                  className="mini-btn"
                  style={{ color: '#34d399', borderColor: '#059669' }}
                  onClick={() => props.onUpdateFirmware?.(props.rlPolicy)}
                >
                  ✓ Firmware Up to Date
                </button>
              )}
              <button
                className="mini-btn"
                onClick={() =>
                  download(
                    `${slug(spec.name)}_firmware.zip`,
                    firmwareZip(spec, report.step7.files),
                    'application/zip',
                  )
                }
              >
                Download (.ZIP)
              </button>
            </div>
          </div>

          {props.isFirmwareOutdated && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}>
              <span style={{ fontSize: 11.5, color: '#fef3c7' }}>
                ⚠️ <b>Policy parameters changed:</b> Stride {props.rlPolicy?.strideAmpDeg.toFixed(1)}°, Waddle {props.rlPolicy?.waddleAmpDeg.toFixed(1)}°, Freq {props.rlPolicy?.freqHz.toFixed(2)}Hz. Click Update Firmware to compile into <code>config.py</code> and <code>robot.py</code>.
              </span>
              <button
                className="mini-btn primary"
                style={{ background: '#d97706', borderColor: '#f59e0b', color: '#fff', whiteSpace: 'nowrap' }}
                onClick={() => props.onUpdateFirmware?.(props.rlPolicy)}
              >
                ⚡ Update Firmware
              </button>
            </div>
          )}

          {!report.step7.aiModel && (
            <div style={{
              background: '#090e17',
              border: '1px solid #1e293b',
              borderRadius: 6,
              padding: '10px 12px',
              marginBottom: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8' }}>
                  ⚡ MicroPython Firmware Ready (ESP32-C3)
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Compiled directly from joint kinematics, receiver shield pin mapping, and RL balance controller.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="mini-btn"
                  onClick={() => props.onUpdateFirmware?.(props.rlPolicy)}
                >
                  ⚡ Create / Refresh Firmware
                </button>
                <button
                  className="mini-btn"
                  onClick={() => props.onRerunStep?.(7)}
                  disabled={props.runningStep === 7}
                >
                  ✨ AI Lead Firmware
                </button>
              </div>
            </div>
          )}

          {props.rlPolicy && (
            <div style={{
              fontSize: 11,
              background: '#090d14',
              border: '1px solid #1e293b',
              borderRadius: 4,
              padding: '6px 10px',
              marginBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ color: '#cbd5e1' }}>
                🧠 <b>Trained Locomotion Policy:</b> S1/S2 {props.rlPolicy.strideAmpDeg.toFixed(1)}° · S3/S4 {props.rlPolicy.waddleAmpDeg.toFixed(1)}° · {props.rlPolicy.freqHz.toFixed(2)} Hz · Reflex kp {props.rlPolicy.kpPitch.toFixed(2)}
              </span>
              <code style={{ fontSize: 10, color: '#38d17a' }}>robot.rl_walk()</code>
            </div>
          )}

          <AiLeadCard
            step={7}
            reasoning={
              report.step7.aiReasoning ||
              report.step7.architectureSummary ||
              `Optional Stage — Target MCU: ${report.step7.controllerId} (${report.step7.controllerName}). Click "✨ AI Lead Firmware" to have AI write custom embedded firmware.`
            }
            model={report.step7.aiModel}
            runningStep={props.runningStep}
            onRerun={props.onRerunStep}
          />

          <table className="flow-table compact">
            <thead>
              <tr>
                <th>Port</th>
                <th>MCU Pin / Bus</th>
                <th>Connected Hardware</th>
              </tr>
            </thead>
            <tbody>
              {report.step7.pinMap.map((pm, idx) => (
                <tr key={idx}>
                  <td><b>{pm.port}</b></td>
                  <td><code>{pm.gpio}</code></td>
                  <td>{pm.connectedTo}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="firmware" style={{ marginTop: 8 }}>
            <div className="actions">
              <div className="seg">
                {Object.keys(report.step7.files).map(k => (
                  <button key={k} className={fwFile === k ? 'on' : ''} onClick={() => setFwFile(k)}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <pre className="code" style={{ maxHeight: 200 }}>{report.step7.files[fwFile] ?? Object.values(report.step7.files)[0]}</pre>
          </div>
        </section>
      )}

      {/* STEP 8: Overall Audit and Testing */}
      {showStep(8) && (
        <section className="flow-section">
          <div className="flow-sec-hd">
            <div>
              <span className="step-num-tag">SYSTEM VERIFICATION</span>
              <h3>System Audit &amp; End-to-End Verification</h3>
            </div>
            <span className={`verdict-badge ${report.step8.verdict}`}>
              {report.step8.readinessScore}% · {report.step8.verdictLabel}
            </span>
          </div>
          <AiLeadCard
            step={8}
            reasoning={report.step8.aiReasoning || report.step8.executiveSummary}
            model={report.step8.aiModel}
            runningStep={props.runningStep}
            onRerun={props.onRerunStep}
          />

          <div className="checks">
            {report.step8.testSuites.map(t => (
              <div key={t.id} className={`check ${t.status}`}>
                <i>{t.status === 'pass' ? '✓' : t.status === 'warn' ? '!' : '✕'}</i>
                <div>
                  <b>[{t.category}] {t.name}</b>
                  <p>{t.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="step7-actions">
            {props.onRequestViewportMode && (
              <button className="primary" onClick={() => props.onRequestViewportMode?.('sim', report.step6.behaviors[0]?.id)}>
                ▶ Launch 3D Physics Test
              </button>
            )}
            <button onClick={() => download(`${slug(spec.name)}.3mf`, threeMF(spec, asm), 'model/3mf')}>
              Download 3MF Print Plate
            </button>
            <button
              onClick={() => {
                const extra: Record<string, string> = { 'README.md': readme() };
                for (const [k, v] of Object.entries(report.step7.files)) extra[`firmware/${k}`] = v;
                extra['bom.csv'] =
                  'kind,id,name,qty,note\n' +
                  bom(asm)
                    .map(l => [l.kind, l.id, l.name, l.qty, l.note ?? ''].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))
                    .join('\n');
                download(`${slug(spec.name)}_project.zip`, projectZip(spec, asm, extra), 'application/zip');
              }}
            >
              Download Full Project (.ZIP)
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
