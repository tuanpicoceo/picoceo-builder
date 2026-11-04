// Build theatre: the live view of the AI design flow (vertical stepper with status, timing and reasoning,
// the visual reference pictures and a progress glow), shown over the 3D stage while a new design is made.
import { useEffect, useRef, useState } from 'react';
import type { AiStepOutputs, StepNumber, VisualRefs } from '../design/pipeline';

export const THEATRE_STEPS: { step: StepNumber; icon: string; title: string; doing: string }[] = [
  { step: 1, icon: '🧩', title: 'Picking the parts', doing: 'Choosing the board, mic, speaker and servos from your directory' },
  { step: 2, icon: '✏️', title: 'Sketching the form', doing: 'Working out the silhouette and overall size' },
  { step: 3, icon: '📦', title: 'Packing the electronics', doing: 'Fitting every module inside and growing the shell if needed' },
  { step: 4, icon: '🛠', title: 'Shaping printable parts', doing: 'Composing the body, joints and features, then building the CAD' },
  { step: 5, icon: '🔍', title: 'Engineering audit', doing: 'Checking torque, balance, power, wiring and print rules' },
  { step: 6, icon: '🎭', title: 'Teaching it to move', doing: 'Planning gestures and behaviours for the simulator' },
  { step: 8, icon: '✅', title: 'Final sign-off', doing: 'End-to-end review and readiness score' },
];

type Times = Partial<Record<StepNumber, { start: number; end?: number }>>;

function summaryOf(step: StepNumber, s: AiStepOutputs): { line?: string; reasoning?: string; model?: string } {
  switch (step) {
    case 1: { const o = s[1]; if (!o) return {}; return { line: o.selectedComponents?.length ? `${o.name ? `${o.name}: ` : ''}${o.selectedComponents.map(c => `${c.qty > 1 ? `${c.qty}× ` : ''}${c.name}`).slice(0, 6).join(', ')}` : o.summary, reasoning: o.aiReasoning, model: o.model }; }
    case 2: { const o = s[2]; if (!o) return {}; return { line: [o.overallDimensionsMm?.length ? `${o.overallDimensionsMm.map(n => Math.round(n)).join(' × ')} mm` : '', o.envelopeShape?.replace(/_/g, ' '), o.silhouetteSummary].filter(Boolean).join(' · '), reasoning: o.aiReasoning, model: o.model }; }
    case 3: { const o = s[3]; if (!o) return {}; return { line: o.fitStatus === 'auto_expanded' ? `Shell widened to ${o.adjustedEnvelopeMm?.map(n => Math.round(n)).join(' × ')} mm` : o.fitExplanation || 'Everything fits', reasoning: o.aiReasoning, model: o.model }; }
    case 4: { const o = s[4]; if (!o) return {}; const d = o.design as { name?: string; composition?: { joints?: unknown[]; features?: unknown[] } }; return { line: `${d?.name ?? 'Design'}${d?.composition ? ` · ${d.composition.joints?.length ?? 0} joints, ${d.composition.features?.length ?? 0} features` : ''}`, reasoning: o.aiReasoning, model: o.model }; }
    case 5: { const o = s[5]; if (!o) return {}; return { line: `${o.auditVerdict?.replace(/_/g, ' ').toLowerCase() ?? 'audited'}${o.findings?.length ? ` · ${o.findings.length} findings` : ''}${o.needsRefinement ? ' · refined the design' : ''}`, reasoning: o.aiReasoning, model: o.model }; }
    case 6: { const o = s[6]; if (!o) return {}; return { line: o.behaviors?.length ? `Behaviours: ${o.behaviors.join(', ')}` : o.physicsNotes, reasoning: o.aiReasoning, model: o.model }; }
    case 8: { const o = s[8]; if (!o) return {}; return { line: `${o.readinessScore ?? '–'}% ready · ${o.verdict?.replace(/_/g, ' ').toLowerCase() ?? ''}`, reasoning: o.executiveSummary || o.aiReasoning, model: o.model }; }
    default: return {};
  }
}

const fmt = (ms: number) => (ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`);

export function BuildTheatre(props: {
  runId: number;
  running: boolean;
  activeStep: StepNumber | null;
  aiSteps: AiStepOutputs;
  refs: VisualRefs | null;
  prompt: string;
  offline: boolean;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [times, setTimes] = useState<Times>({});
  const [open, setOpen] = useState<Partial<Record<StepNumber, boolean>>>({});
  const [now, setNow] = useState(() => Date.now());
  const runStart = useRef(Date.now());
  const prev = useRef<StepNumber | null>(null);

  useEffect(() => { setTimes({}); setOpen({}); prev.current = null; runStart.current = Date.now(); }, [props.runId]);
  useEffect(() => {
    const t = Date.now();
    setTimes(old => {
      const n = { ...old };
      if (prev.current && n[prev.current] && !n[prev.current]!.end) n[prev.current] = { ...n[prev.current]!, end: t };
      if (props.activeStep && !n[props.activeStep]) n[props.activeStep] = { start: t };
      return n;
    });
    prev.current = props.activeStep;
  }, [props.activeStep, props.runId]);
  useEffect(() => {
    if (!props.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [props.running]);

  const activeIdx = THEATRE_STEPS.findIndex(s => s.step === props.activeStep);
  const statusOf = (i: number, step: StepNumber): 'done' | 'running' | 'pending' | 'skipped' => {
    if (props.activeStep === step && props.running) return 'running';
    if (props.aiSteps[step] || times[step]?.end) return 'done';
    if (activeIdx > i) return props.offline ? 'done' : 'skipped';
    if (!props.running && times[step]) return 'done';
    if (!props.running && activeIdx < 0 && Object.keys(times).length) return props.offline ? 'done' : 'skipped';
    return 'pending';
  };
  const statuses = THEATRE_STEPS.map((s, i) => statusOf(i, s.step));
  const doneCount = statuses.filter(s => s === 'done' || s === 'skipped').length;
  const progress = Math.min(1, (doneCount + (statuses.includes('running') ? 0.5 : 0)) / THEATRE_STEPS.length);
  const elapsed = (props.running ? now : Math.max(...Object.values(times).map(t => t?.end ?? t?.start ?? 0), runStart.current)) - runStart.current;

  return (
    <div className={`theatre ${props.running ? 'running' : 'finished'}`} role="region" aria-label="AI design progress">
      <div className="theatre-bar" aria-hidden><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div className="theatre-card">
        <header className="theatre-head">
          <div>
            <b>{props.running ? 'Designing your robot' : 'Design complete'}</b>
            <small title={props.prompt}>“{props.prompt.length > 90 ? `${props.prompt.slice(0, 88)}…` : props.prompt}”</small>
          </div>
          <div className="theatre-meta">
            <span className="theatre-pct" aria-label={`${Math.round(progress * 100)} percent done`}>{Math.round(progress * 100)}%</span>
            <span className="theatre-time">{fmt(Math.max(0, elapsed))}</span>
            {props.running
              ? <button className="stop-btn" onClick={props.onCancel}>■ Stop</button>
              : <button className="ghost" onClick={props.onClose} aria-label="Hide the design steps">✕</button>}
          </div>
        </header>
        <ol className="stepper">
          {THEATRE_STEPS.map((s, i) => {
            const st = statuses[i];
            const t = times[s.step];
            const dur = t ? (t.end ?? now) - t.start : 0;
            const sum = summaryOf(s.step, props.aiSteps);
            const isOpen = open[s.step] ?? false;
            return (
              <li key={s.step} className={`step ${st}`} aria-current={st === 'running' ? 'step' : undefined}>
                <span className="step-ico" aria-hidden>{st === 'done' ? '✓' : st === 'skipped' ? '–' : s.icon}</span>
                <div className="step-main">
                  <div className="step-row">
                    <b>{s.title}</b>
                    <span className="step-time">{st === 'pending' ? '' : st === 'skipped' ? 'skipped' : fmt(dur)}</span>
                  </div>
                  {st === 'running' && <div className="step-doing">{s.doing}<span className="dots" aria-hidden><i>.</i><i>.</i><i>.</i></span></div>}
                  {st === 'done' && sum.line && <div className="step-line">{sum.line}</div>}
                  {st === 'done' && sum.reasoning && (
                    <div className="step-why">
                      <button className="link-btn" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [s.step]: !isOpen }))}>
                        {isOpen ? '▾ Hide reasoning' : '▸ Why?'}{sum.model ? <em> · {sum.model}</em> : null}
                      </button>
                      {isOpen && <p>{sum.reasoning}</p>}
                    </div>
                  )}
                  {s.step === 1 && props.refs && props.refs.images.length > 0 && (
                    <div className="theatre-refs">
                      <span>Visual reference: <b>{props.refs.title}</b></span>
                      <div>
                        {props.refs.images.slice(0, 5).map((im, k) => (
                          <a key={im.thumb} href={im.page} target="_blank" rel="noreferrer" title={`${im.title} · ${im.license}`} className={k === 0 ? 'lead' : ''}>
                            <img src={im.thumb} alt={im.title} referrerPolicy="no-referrer" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
