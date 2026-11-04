import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { STEP_DEFINITIONS, type AiStepOutputs, type ReferenceImage, type Segmentation, type SevenStepFlowReport, type StepNumber, type VisualRefs } from '../design/pipeline';

const SEG_COLORS = ['#38bdf8', '#f472b6', '#facc15', '#34d399', '#a78bfa', '#fb923c', '#f87171', '#2dd4bf'];

/** The reference picture with SAM 3.1's part boxes over it (boxes are in the picture's own pixels). */
function SegmentedPicture({ seg }: { seg: Segmentation & { src: string } }) {
  const W = seg.width || 1, H = seg.height || 1;
  return (
    <div className="seg-ref">
      <div className="seg-pic">
        <img src={seg.src} alt="Reference picture split into parts by SAM 3.1" referrerPolicy="no-referrer" />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          {seg.parts.flatMap((p, i) => p.boxes.map((b, k) => (
            <rect key={`${p.concept}-${k}`} x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1}
              fill="none" stroke={SEG_COLORS[i % SEG_COLORS.length]} strokeWidth={Math.max(2, W / 160)} vectorEffect="non-scaling-stroke" />
          )))}
        </svg>
      </div>
      <div className="seg-legend">
        {seg.parts.map((p, i) => <span key={p.concept}><i style={{ background: SEG_COLORS[i % SEG_COLORS.length] }} />{p.concept}{p.boxes.length > 1 ? ` ×${p.boxes.length}` : ''}</span>)}
        <small>{seg.model} · Meta Model API</small>
      </div>
    </div>
  );
}
import type { Archetype, RobotSpec } from '../design/spec';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  image?: ReferenceImage;
  spec?: RobotSpec;
  source?: string;
  search?: { query: string; theme: string; snippets: string[] } | null;
  assumptions?: string[];
  outOfScope?: string[];
  fixes?: string[];
  /** Visual reference search shown before designing (images link to their Wikipedia / Commons source). */
  refs?: VisualRefs;
  /** SAM 3.1 parts of the reference picture, drawn as boxes over it (src: the picture's URL or data URL). */
  segmentation?: Segmentation & { src: string };
  /** Message type for the conversation layout (older saved chats infer it from role / source / spec). */
  kind?: 'design' | 'edit' | 'system' | 'error';
  /** Error messages: the prompt a "Retry" button sends again. */
  retry?: string;
  at?: number;
}

export type MsgKind = 'user' | 'design' | 'edit' | 'system' | 'error' | 'note';

/** The layout type of a message (works for chats saved before `kind` existed). */
export function kindOf(m: ChatMsg): MsgKind {
  if (m.role === 'user') return 'user';
  if (m.kind) return m.kind;
  if (m.source === 'error') return 'error';
  if (m.refs || m.source === 'Visual reference search') return 'system';
  if (m.spec) return /· edit$/.test(m.source ?? '') ? 'edit' : 'design';
  return 'note';
}

const EXAMPLES: { label: string; prompt: string }[] = [
  { label: 'Pet feeder', prompt: 'An automated pet feeder with a rotating servo dispenser drum, stable weighted base, and LED indicator.' },
  { label: 'Patrol rover', prompt: 'A small patrol rover for my desk with a pan-tilt head and LED eyes, blue and white, that can bump into things safely.' },
  { label: 'Duck robot', prompt: 'A cute yellow duck robot in the shape of a duck with orange beak, webbed feet, and waddling legs.' },
  { label: 'Cyber dog', prompt: 'A playful quadruped robot dog with 4 articulated legs, pointed ears, and wagging tail.' },
];

/** Contextual follow-ups for the current design. */
export function suggestionsFor(spec: RobotSpec | undefined, failing: number): { label: string; prompt?: string; action?: 'talk' | 'fix' | 'edit' }[] {
  const out: { label: string; prompt?: string; action?: 'talk' | 'fix' | 'edit' }[] = [];
  if (failing > 0) out.push({ label: `Fix ${failing} check${failing > 1 ? 's' : ''}`, action: 'fix' });
  const comp = spec?.composition?.use ? spec.composition : null;
  const hasFace = comp ? comp.features.some(f => f.shape === 'led') : (spec?.params.leds ?? 0) > 0;
  if (!hasFace) out.push({ label: 'Give it a face', prompt: 'Give it a friendly face: two LED eyes on the front of the head and a small display for the mouth.' });
  const swing = comp ? comp.joints.filter(j => j.kind === 'swing') : [];
  if (comp && swing.length === 0 && comp.joints.length < 4) out.push({ label: 'Make it wave', prompt: 'Add an arm on one side that can wave hello.' });
  else if (swing.length) out.push({ label: 'Make it wave', prompt: `Make it wave: add a waving behaviour using the ${swing[0].name.replace(/_/g, ' ')} joint.` });
  if (comp && !comp.joints.some(j => j.parent === 'body' && j.face === '+z')) out.push({ label: 'Add a nodding head', prompt: 'Put the head on a servo so it can nod and turn while it talks.' });
  out.push({ label: 'Smaller', prompt: 'Make it about 20% smaller overall while keeping the electronics fitting.' });
  out.push({ label: 'Change colour', prompt: 'Change the colour scheme to something warmer and friendlier.' });
  out.push({ label: 'Edit by hand', action: 'edit' });
  out.push({ label: 'Talk to it', action: 'talk' });
  return out;
}

/** Short human list of what differs between two specs (version compare). */
export function specDiff(a: RobotSpec, b: RobotSpec): string[] {
  const d: string[] = [];
  if (a.name !== b.name) d.push(`Name: ${a.name} → ${b.name}`);
  if (a.archetype !== b.archetype) d.push(`Type: ${a.archetype} → ${b.archetype}`);
  if (a.primaryColor !== b.primaryColor) d.push(`Primary colour ${a.primaryColor} → ${b.primaryColor}`);
  if (a.accentColor !== b.accentColor) d.push(`Accent colour ${a.accentColor} → ${b.accentColor}`);
  const ca = a.composition?.use ? a.composition : null, cb = b.composition?.use ? b.composition : null;
  if (!!ca !== !!cb) d.push(cb ? 'Now a free-form composition' : 'Now a prebuilt CAD type');
  if (ca && cb) {
    if (ca.body.shape !== cb.body.shape) d.push(`Body shape ${ca.body.shape} → ${cb.body.shape}`);
    if (ca.body.size.join() !== cb.body.size.join()) d.push(`Body ${ca.body.size.join('×')} → ${cb.body.size.join('×')} mm`);
    if (ca.standH !== cb.standH) d.push(`Neck ${ca.standH} → ${cb.standH} mm`);
    const ja = new Set(ca.joints.map(j => j.name)), jb = new Set(cb.joints.map(j => j.name));
    for (const n of jb) if (!ja.has(n)) d.push(`+ joint ${n}`);
    for (const n of ja) if (!jb.has(n)) d.push(`− joint ${n}`);
    for (const j of cb.joints) {
      const o = ca.joints.find(x => x.name === j.name);
      if (o && JSON.stringify(o) !== JSON.stringify(j)) d.push(`~ joint ${j.name} changed`);
    }
    if (ca.features.length !== cb.features.length) d.push(`Features ${ca.features.length} → ${cb.features.length}`);
    else if (JSON.stringify(ca.features) !== JSON.stringify(cb.features)) d.push('Features adjusted');
  }
  for (const k of Object.keys(b.params) as (keyof RobotSpec['params'])[]) {
    if (a.params[k] !== b.params[k] && typeof b.params[k] !== 'object') d.push(`${k}: ${String(a.params[k])} → ${String(b.params[k])}`);
    if (d.length > 14) break;
  }
  if (a.behaviors.join() !== b.behaviors.join()) d.push(`Behaviours: ${b.behaviors.join(', ')}`);
  return d;
}

const providerLabel = (p?: string) => (p === 'meta' ? 'Meta Muse' : p === 'gemini' ? 'Gemini' : 'Claude');

export function AiModeSelect(props: { ai: { ai: boolean; provider?: string } | null; aiMode: 'auto' | 'offline'; setAiMode: (m: 'auto' | 'offline') => void }) {
  return (
    <div className="ai-mode">
      <span className={`dot ${props.aiMode === 'auto' && props.ai?.ai ? 'on' : 'off'}`} aria-hidden />
      <select value={props.aiMode} onChange={e => props.setAiMode(e.target.value as 'auto' | 'offline')} aria-label="Planner">
        <option value="auto">{props.ai?.ai ? `${providerLabel(props.ai.provider)} AI` : 'Autonomous Engine'}</option>
        <option value="offline">Built-in Planner</option>
      </select>
    </div>
  );
}

function readImageFile(file: File, done: (img: ReferenceImage) => void) {
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    if (dataUrl) done({ dataUrl, mimeType: file.type || 'image/png', name: file.name });
  };
  reader.readAsDataURL(file);
}

/** Prompt box with reference-image attach (drop / paste / pick), used by the chat and the landing hero. */
export function Composer(props: {
  onSend: (p: string, image?: ReferenceImage) => void;
  thinking: boolean;
  onCancel?: () => void;
  placeholder?: string;
  submitLabel?: string;
  variant?: 'chat' | 'hero';
  autoFocus?: boolean;
  extra?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [refImage, setRefImage] = useState<ReferenceImage | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const promptText = text.trim() || (refImage ? 'Design a talking robot matching this reference image.' : '');
    if (!promptText || props.thinking) return;
    props.onSend(promptText, refImage ?? undefined);
    setText('');
    setRefImage(null);
  };

  return (
    <form
      className={`composer ${props.variant === 'hero' ? 'hero-composer' : ''} ${dragOver ? 'drag-over' : ''}`}
      onSubmit={e => { e.preventDefault(); submit(); }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) readImageFile(f, setRefImage); }}
    >
      {refImage && (
        <div className="ref-img-preview">
          <img src={refImage.dataUrl} alt={refImage.name || 'Reference image'} />
          <div className="ref-img-meta"><b>Reference image</b><span>{refImage.name || 'Pasted image'}</span></div>
          <button type="button" className="ref-img-remove" onClick={() => setRefImage(null)} aria-label="Remove reference image">✕</button>
        </div>
      )}
      <textarea
        value={text}
        autoFocus={props.autoFocus}
        aria-label="Describe your robot"
        onChange={e => setText(e.target.value)}
        placeholder={refImage ? 'Describe how to adapt this picture (or just press Design)…' : props.placeholder}
        onPaste={e => {
          for (const item of Array.from(e.clipboardData?.items ?? [])) {
            if (item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) readImageFile(f, setRefImage); }
          }
        }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        rows={props.variant === 'hero' ? 3 : 2}
      />
      <div className="composer-bar">
        <div className="composer-tools">
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) readImageFile(f, setRefImage); e.target.value = ''; }} />
          <button type="button" className={`mini-btn ref-upload-btn ${refImage ? 'active' : ''}`} onClick={() => fileInputRef.current?.click()}
            title="Upload, paste, or drag & drop a reference image">
            🖼 {refImage ? 'Change image' : 'Reference image'}
          </button>
          {props.extra}
        </div>
        {props.thinking && props.onCancel ? (
          <button type="button" className="stop-btn" onClick={props.onCancel} aria-label="Stop the AI">■ Stop</button>
        ) : (
          <button type="submit" className="design-submit-btn" disabled={props.thinking || (!text.trim() && !refImage)}>
            {props.submitLabel ?? 'Design'}
          </button>
        )}
      </div>
    </form>
  );
}

function Typing(props: { label: string }) {
  return (
    <div className="msg assistant typing-msg" role="status" aria-live="polite">
      <span className="typing-dots" aria-hidden><i /><i /><i /></span>
      <span className="typing-label">{props.label}</span>
    </div>
  );
}

export function Chat(props: {
  msgs: ChatMsg[]; thinking: boolean; onSend: (p: string, image?: ReferenceImage) => void; ai: { ai: boolean; provider?: string; model?: string; clientSide?: boolean } | null;
  aiMode: 'auto' | 'offline'; setAiMode: (m: 'auto' | 'offline') => void;
  archetype: Archetype; hasDesign: boolean; onFix: () => void; failing: number;
  onOpenDirectory?: () => void; inventoryCount?: number;
  activeStep?: StepNumber | null;
  aiSteps?: AiStepOutputs;
  flowReport?: SevenStepFlowReport | null;
  onSelectFlowStep?: (step: StepNumber) => void;
  includeFirmware?: boolean;
  setIncludeFirmware?: (v: boolean) => void;
  /** The design on screen (for "current" badges, compare and suggestions). */
  currentSpec?: RobotSpec;
  readiness?: number | null;
  onCancel?: () => void;
  onRestore?: (spec: RobotSpec, label: string) => void;
  onEditDesign?: () => void;
  onTalk?: () => void;
  /** Edit-and-resend: replace the user message at this id (and everything after it) with new text. */
  onResend?: (id: string, text: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [props.msgs.length, props.thinking, props.activeStep]);

  const currentJson = useMemo(() => (props.currentSpec ? JSON.stringify(props.currentSpec) : ''), [props.currentSpec]);
  const lastAssistantIdx = useMemo(() => {
    for (let i = props.msgs.length - 1; i >= 0; i--) if (props.msgs[i].role === 'assistant') return i;
    return -1;
  }, [props.msgs]);
  const designMsgs = props.msgs.filter(m => m.spec);
  const suggestions = props.hasDesign ? suggestionsFor(props.currentSpec, props.failing) : [];

  const runSuggestion = (s: ReturnType<typeof suggestionsFor>[number]) => {
    if (s.action === 'talk') props.onTalk?.();
    else if (s.action === 'fix') props.onFix();
    else if (s.action === 'edit') props.onEditDesign?.();
    else if (s.prompt) props.onSend(s.prompt);
  };

  const typingLabel = props.activeStep
    ? STEP_DEFINITIONS.find(s => s.step === props.activeStep)?.action ?? 'Thinking'
    : 'Thinking';

  return (
    <aside className="panel chat" aria-label="Design conversation">
      <div className="panel-head">
        <h2>Design assistant</h2>
        <div className="chat-controls">
          {props.onOpenDirectory && (
            <button className="mini-btn inv-quick-btn" onClick={props.onOpenDirectory} title="Manage the component directory and stock">
              <span>📦 Directory</span>
              {props.inventoryCount !== undefined && <span className="inv-badge">{props.inventoryCount}</span>}
            </button>
          )}
          <AiModeSelect ai={props.ai} aiMode={props.aiMode} setAiMode={props.setAiMode} />
        </div>
      </div>
      <div className="msgs" aria-live="polite">
        {!props.msgs.length && (
          <div className="intro">
            <p>Describe <b>a robot that talks</b>: a desk buddy, a pet, a greeter. PICOCEO Builder designs its body, parts and wiring, then gives it a voice through your AI brain.</p>
            <div className="chips">{EXAMPLES.map(e => <button key={e.label} onClick={() => props.onSend(e.prompt)}>{e.label}</button>)}</div>
          </div>
        )}
        {props.msgs.map((m, idx) => {
          const kind = kindOf(m);
          const isCurrent = !!m.spec && JSON.stringify(m.spec) === currentJson;
          const versionNo = m.spec ? designMsgs.indexOf(m) + 1 : 0;
          if (kind === 'user') {
            const isEditing = editing?.id === m.id;
            return (
              <div key={m.id} className="msg user">
                {m.image && (
                  <div className="msg-ref-img">
                    <img src={m.image.dataUrl} alt={m.image.name || 'Reference image'} />
                    <span>🖼 {m.image.name || 'Reference image'}</span>
                  </div>
                )}
                {isEditing ? (
                  <form className="msg-edit" onSubmit={e => { e.preventDefault(); if (editing.text.trim()) { props.onResend?.(m.id, editing.text.trim()); setEditing(null); } }}>
                    <textarea value={editing.text} autoFocus rows={3} aria-label="Edit message"
                      onChange={e => setEditing({ id: m.id, text: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
                    <div className="msg-edit-bar">
                      <button type="button" className="ghost" onClick={() => setEditing(null)}>Cancel</button>
                      <button type="submit" className="primary" disabled={props.thinking}>Resend</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="txt">{m.text}</div>
                    {props.onResend && !props.thinking && (
                      <button className="msg-edit-btn" onClick={() => setEditing({ id: m.id, text: m.text })} aria-label="Edit and resend this message" title="Edit and resend">✎</button>
                    )}
                  </>
                )}
              </div>
            );
          }
          if (kind === 'system') {
            return (
              <div key={m.id} className="msg system">
                <div className="sys-line"><span className="sys-ico" aria-hidden>{m.refs ? '🔎' : m.segmentation ? '✂' : 'ℹ'}</span>{m.text}</div>
                {m.segmentation && <SegmentedPicture seg={m.segmentation} />}
                {m.refs && (
                  <div className="visual-refs">
                    {m.refs.images.map((im, i) => (
                      <a key={im.thumb} href={im.page} target="_blank" rel="noreferrer" title={`${im.title} · ${im.license}`} className={i === 0 ? 'lead' : ''}>
                        <img src={im.thumb} alt={im.title} referrerPolicy="no-referrer" loading="lazy" />
                        {i === 0 && <span>used as reference</span>}
                      </a>
                    ))}
                    <small>Images: Wikipedia / Wikimedia Commons ({[...new Set(m.refs.images.map(i => i.license))].join(', ')})</small>
                  </div>
                )}
              </div>
            );
          }
          if (kind === 'error') {
            return (
              <div key={m.id} className="msg assistant error" role="alert">
                <div className="src">Something went wrong</div>
                <div className="txt">{m.text}</div>
                {m.retry && <button className="retry-btn" disabled={props.thinking} onClick={() => props.onSend(m.retry!)}>↻ Retry</button>}
              </div>
            );
          }
          const isEdit = kind === 'edit';
          return (
            <div key={m.id} className={`msg assistant ${kind === 'note' ? 'note' : isEdit ? 'edit-card' : 'design-card'} ${isCurrent ? 'current' : ''}`}>
              <div className="card-head">
                <span className="src">{m.source === 'offline' ? 'Built-in planner' : (m.source ?? '').replace(/ · edit$/, '')}</span>
                {m.spec && <span className="ver-tag">{isEdit ? 'Edit' : 'Design'} · v{versionNo}</span>}
                {isCurrent && <span className="cur-tag">current</span>}
              </div>
              {m.spec && !isEdit && (
                <div className="card-title">
                  <i className="swatch" style={{ background: m.spec.primaryColor }} aria-hidden />
                  <i className="swatch" style={{ background: m.spec.accentColor }} aria-hidden />
                  <b>{m.spec.name}</b>
                  {isCurrent && props.readiness != null && idx === lastAssistantIdx && (
                    <span className={`flow-score-badge ${props.readiness >= 85 ? 'pass' : props.readiness >= 60 ? 'warn' : 'fail'}`}>{props.readiness}% ready</span>
                  )}
                </div>
              )}
              <div className="txt">{m.text}</div>
              {isEdit && !!m.fixes?.length && <ul className="edit-list">{m.fixes.slice(0, 4).map((f, i) => <li key={i}>{f}</li>)}</ul>}
              {m.search && (
                <details className="search-refs">
                  <summary>🔍 Reference search: <em>"{m.search.query}"</em> ({m.search.snippets.length} sources)</summary>
                  <ul>{m.search.snippets.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </details>
              )}
              {!!m.outOfScope?.length && <ul className="oos">{m.outOfScope.map((o, i) => <li key={i}>⚠ {o}</li>)}</ul>}
              {!!m.assumptions?.length && <details><summary>Assumptions ({m.assumptions.length})</summary><ul>{m.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
              {m.spec && (
                <div className="card-actions">
                  {isCurrent ? (
                    <button onClick={props.onEditDesign}>✎ Edit design</button>
                  ) : (
                    <>
                      <button onClick={() => props.onRestore?.(m.spec!, `Restore v${versionNo}`)} disabled={props.thinking}>↺ Restore v{versionNo}</button>
                      {props.currentSpec && <button aria-expanded={compare === m.id} onClick={() => setCompare(compare === m.id ? null : m.id)}>⇄ Compare</button>}
                    </>
                  )}
                </div>
              )}
              {compare === m.id && m.spec && props.currentSpec && (() => {
                const diff = specDiff(m.spec, props.currentSpec);
                return (
                  <div className="compare-box">
                    <b>v{versionNo} → current</b>
                    {diff.length ? <ul>{diff.map((d, i) => <li key={i}>{d}</li>)}</ul> : <p>No differences.</p>}
                  </div>
                );
              })()}
              {idx === lastAssistantIdx && !props.thinking && suggestions.length > 0 && (
                <div className="chips suggest" role="group" aria-label="Suggestions">
                  {suggestions.map(s => (
                    <button key={s.label} className={s.action === 'fix' ? 'fix' : s.action === 'talk' ? 'talk' : ''} onClick={() => runSuggestion(s)}>{s.label}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {props.thinking && <Typing label={typingLabel} />}
        {!props.thinking && props.onResend && props.msgs.length > 0 && props.msgs[props.msgs.length - 1].role === 'user' && (() => {
          const last = props.msgs[props.msgs.length - 1];
          return (
            <div className="msg system">
              <div className="sys-line"><span className="sys-ico" aria-hidden>ℹ</span>This request was interrupted before the AI answered.</div>
              <button className="retry-btn" onClick={() => props.onResend!(last.id, last.text)}>↻ Send again</button>
            </div>
          );
        })()}
        <div ref={end} />
      </div>
      <Composer
        onSend={props.onSend}
        thinking={props.thinking}
        onCancel={props.onCancel}
        submitLabel={props.hasDesign ? 'Send' : 'Design'}
        placeholder={props.hasDesign ? 'Ask for a change: “bigger ears”, “make it wave”…' : 'e.g. a talking desk buddy with a display face'}
        extra={props.setIncludeFirmware && (
          <label className="fw-opt-toggle">
            <input type="checkbox" checked={Boolean(props.includeFirmware)} onChange={e => props.setIncludeFirmware?.(e.target.checked)} />
            <span>Generate firmware</span>
          </label>
        )}
      />
    </aside>
  );
}
