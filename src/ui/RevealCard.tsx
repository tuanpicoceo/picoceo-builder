// Reveal card: shown when a new design arrives (name, readiness ring, key stats and the next actions).
import type { Check } from '../design/analysis';
import type { RobotSpec } from '../design/spec';

/** Readiness from the engineering checks: pass = 1, warn = ½, fail = 0 (kit limits count half as much). */
export function readinessOf(checks: Check[] | undefined): number | null {
  if (!checks?.length) return null;
  const v = checks.reduce((s, c) => s + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((100 * v) / checks.length);
}

export function ScoreRing(props: { score: number; size?: number; label?: string }) {
  const size = props.size ?? 84, r = size / 2 - 7, c = 2 * Math.PI * r;
  const tone = props.score >= 85 ? 'pass' : props.score >= 60 ? 'warn' : 'fail';
  return (
    <svg className={`score-ring ${tone}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${props.label ?? 'Readiness'} ${props.score} percent`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - props.score / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="ring-num">{props.score}</text>
      <text x="50%" y="70%" textAnchor="middle" className="ring-cap">ready</text>
    </svg>
  );
}

export function RevealCard(props: {
  spec: RobotSpec;
  checks: Check[];
  stats: { parts: number; printH: number; massG: number; runtimeMin: number; joints: number };
  talks: boolean;
  onEdit: () => void;
  onTalk: () => void;
  onBuild: () => void;
  onClose: () => void;
}) {
  const score = readinessOf(props.checks) ?? 0;
  const fails = props.checks.filter(c => c.status === 'fail').length;
  const warns = props.checks.filter(c => c.status === 'warn').length;
  const stats: [string, string][] = [
    ['Parts', String(props.stats.parts)],
    ['Print time', props.stats.printH >= 1 ? `${props.stats.printH.toFixed(1)} h` : `${Math.round(props.stats.printH * 60)} min`],
    ['Mass', `${Math.round(props.stats.massG)} g`],
    ['Runtime', props.stats.runtimeMin >= 120 ? `${(props.stats.runtimeMin / 60).toFixed(1)} h` : `${Math.round(props.stats.runtimeMin)} min`],
    ['Joints', String(props.stats.joints)],
  ];
  return (
    <div className="reveal-card" role="dialog" aria-labelledby="reveal-name">
      <button className="ghost reveal-x" onClick={props.onClose} aria-label="Close">✕</button>
      <div className="reveal-top">
        <ScoreRing score={score} />
        <div className="reveal-title">
          <span className="reveal-kicker">✦ Your robot is ready</span>
          <h2 id="reveal-name">
            <i className="swatch" style={{ background: props.spec.primaryColor }} aria-hidden />
            <i className="swatch" style={{ background: props.spec.accentColor }} aria-hidden />
            {props.spec.name}
          </h2>
          <p>{props.spec.summary || 'A free-form robot composed by the AI.'}</p>
          <small>{props.checks.length - fails - warns} checks pass{warns ? ` · ${warns} warnings` : ''}{fails ? ` · ${fails} to fix` : ''}{props.talks ? ' · voice ready' : ''}</small>
        </div>
      </div>
      <dl className="reveal-stats">
        {stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="reveal-actions">
        <button className="big" onClick={props.onEdit}><span aria-hidden>✎</span> Edit design</button>
        <button className="big talk" onClick={props.onTalk}><span aria-hidden>🎙</span> Talk to it</button>
        <button className="big primary" onClick={props.onBuild}><span aria-hidden>🖨</span> Build it</button>
      </div>
    </div>
  );
}
