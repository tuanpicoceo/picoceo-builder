// Animated virtual robot face for the AI Brain console. One SVG, driven per frame through refs (no React re-render
// per frame): idle blinking + glances, listening rings that follow the mic level, thinking dots, a mouth synced to
// the reply audio level, and every `show_face` expression of the backbone contract.
import { useEffect, useRef, type CSSProperties } from 'react';
import type { Expression } from '../backbone/client';

export type FaceMode = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface RobotFaceProps {
  expression: Expression;
  mode: FaceMode;
  /** 0..1, read every frame: mic level while listening, output level while speaking. */
  level?: () => number;
  /** Text from `show_text`, shown as a ticker under the face. */
  text?: string | null;
  /** LED colour from `set_led`. */
  led?: string | null;
  name?: string;
  size?: 'normal' | 'compact';
}

interface Pose { eyeH: number; eyeW: number; curve: number; open: number; mouthW: number; brow: number; browY: number; lookX: number; lookY: number }
type EyeKind = 'round' | 'arc' | 'heart' | 'line';

const POSES: Record<Expression, Pose & { eye: EyeKind; brows: boolean }> = {
  neutral:   { eye: 'round', brows: false, eyeH: 1, eyeW: 1, curve: 0.25, open: 0, mouthW: 1, brow: 0, browY: 0, lookX: 0, lookY: 0 },
  happy:     { eye: 'arc', brows: false, eyeH: 1, eyeW: 1.05, curve: 1, open: 0.35, mouthW: 1.15, brow: 0, browY: 0, lookX: 0, lookY: 0 },
  sad:       { eye: 'round', brows: true, eyeH: 0.75, eyeW: 0.95, curve: -0.7, open: 0, mouthW: 0.8, brow: -1, browY: 0, lookX: 0, lookY: 0.25 },
  surprised: { eye: 'round', brows: true, eyeH: 1.25, eyeW: 1.15, curve: 0, open: 0.9, mouthW: 0.42, brow: 0, browY: -12, lookX: 0, lookY: 0 },
  thinking:  { eye: 'round', brows: true, eyeH: 0.72, eyeW: 0.95, curve: -0.1, open: 0, mouthW: 0.5, brow: 0.5, browY: -4, lookX: 0.6, lookY: -0.6 },
  sleepy:    { eye: 'line', brows: false, eyeH: 0.12, eyeW: 1, curve: 0.1, open: 0.1, mouthW: 0.45, brow: 0, browY: 0, lookX: 0, lookY: 0.4 },
  love:      { eye: 'heart', brows: false, eyeH: 1, eyeW: 1.1, curve: 0.9, open: 0.2, mouthW: 1, brow: 0, browY: 0, lookX: 0, lookY: 0 },
  angry:     { eye: 'round', brows: true, eyeH: 0.68, eyeW: 1, curve: -0.45, open: 0.08, mouthW: 0.85, brow: 1, browY: 2, lookX: 0, lookY: 0 },
  listening: { eye: 'round', brows: false, eyeH: 1.12, eyeW: 1.05, curve: 0.35, open: 0, mouthW: 0.7, brow: 0, browY: 0, lookX: 0, lookY: 0 },
  speaking:  { eye: 'round', brows: false, eyeH: 1, eyeW: 1, curve: 0.35, open: 0.25, mouthW: 0.95, brow: 0, browY: 0, lookX: 0, lookY: 0 },
};

const W = 400, H = 300, CX = 200, EYE_Y = 128, EYE_DX = 72, MOUTH_Y = 214;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mouthPath(curve: number, open: number, width: number) {
  const w = 92 * width, x0 = CX - w / 2, x1 = CX + w / 2;
  const top = MOUTH_Y + curve * 26 - open * 10;
  const bottom = top + Math.max(2, open * 46) + Math.max(0, curve) * 6 * open;
  const y = MOUTH_Y - curve * 4;
  return `M${x0.toFixed(1)} ${y.toFixed(1)} Q${CX} ${top.toFixed(1)} ${x1.toFixed(1)} ${y.toFixed(1)} Q${CX} ${bottom.toFixed(1)} ${x0.toFixed(1)} ${y.toFixed(1)} Z`;
}

function Eye({ kind, side }: { kind: EyeKind; side: -1 | 1 }) {
  const cx = CX + side * EYE_DX;
  switch (kind) {
    case 'arc':
      return <path d={`M${cx - 26} ${EYE_Y + 8} Q${cx} ${EYE_Y - 30} ${cx + 26} ${EYE_Y + 8}`} fill="none" stroke="currentColor" strokeWidth={13} strokeLinecap="round" />;
    case 'heart':
      return <path className="rf-heart" d={`M${cx} ${EYE_Y + 24} C${cx - 44} ${EYE_Y - 4} ${cx - 26} ${EYE_Y - 38} ${cx} ${EYE_Y - 16} C${cx + 26} ${EYE_Y - 38} ${cx + 44} ${EYE_Y - 4} ${cx} ${EYE_Y + 24} Z`} fill="currentColor" />;
    case 'line':
      return <path d={`M${cx - 24} ${EYE_Y + 4} Q${cx} ${EYE_Y + 14} ${cx + 24} ${EYE_Y + 4}`} fill="none" stroke="currentColor" strokeWidth={10} strokeLinecap="round" />;
    default:
      return (
        <>
          <rect x={cx - 23} y={EYE_Y - 30} width={46} height={60} rx={22} fill="currentColor" />
          <circle className="rf-glint" cx={cx + 9} cy={EYE_Y - 13} r={6.5} />
        </>
      );
  }
}

export function RobotFace({ expression, mode, level, text, led, name, size = 'normal' }: RobotFaceProps) {
  const eyesL = useRef<SVGGElement>(null), eyesR = useRef<SVGGElement>(null);
  const mouth = useRef<SVGPathElement>(null);
  const browL = useRef<SVGLineElement>(null), browR = useRef<SVGLineElement>(null);
  const rings = useRef<SVGGElement>(null);
  const glow = useRef<SVGRectElement>(null);
  const target = useRef({ expression, mode, level });
  target.current = { expression, mode, level };

  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cur: Pose = { ...POSES.neutral };
    let raf = 0, last = performance.now();
    let nextBlink = last + 1800, blinkT = -1;
    let nextGlance = last + 2600, glance = { x: 0, y: 0 };
    let smoothLevel = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const { expression: ex, mode: md, level: lv } = target.current;
      const effective: Expression = md === 'listening' && ex === 'neutral' ? 'listening' : md === 'thinking' && ex === 'neutral' ? 'thinking' : ex;
      const p = POSES[effective];
      const k = reduce ? 1 : 1 - Math.pow(0.0008, dt); // ~ smooth approach
      (Object.keys(cur) as (keyof Pose)[]).forEach(key => { cur[key] = lerp(cur[key], p[key], k); });

      const raw = lv && (md === 'speaking' || md === 'listening') ? lv() : 0;
      smoothLevel = lerp(smoothLevel, raw, reduce ? 1 : Math.min(1, dt * 22));

      // blink (not while sleepy / arcs) + idle glances
      let blink = 1;
      if (!reduce && p.eye === 'round') {
        if (blinkT < 0 && now > nextBlink) { blinkT = 0; }
        if (blinkT >= 0) {
          blinkT += dt;
          const t = blinkT / 0.16;
          blink = t < 0.5 ? 1 - t * 1.9 : t < 1 ? 0.05 + (t - 0.5) * 1.9 : 1;
          if (t >= 1) { blinkT = -1; nextBlink = now + 1800 + Math.random() * 3200 + (Math.random() < 0.2 ? -1500 : 0); }
        }
        if (md === 'idle' && now > nextGlance) {
          glance = Math.random() < 0.4 ? { x: 0, y: 0 } : { x: (Math.random() - 0.5) * 1.4, y: (Math.random() - 0.5) * 0.6 };
          nextGlance = now + 1500 + Math.random() * 3000;
        }
        if (md !== 'idle') glance = { x: 0, y: 0 };
      }
      const gx = (cur.lookX + glance.x) * 9, gy = (cur.lookY + glance.y) * 8;
      const breathe = reduce ? 0 : Math.sin(now / 900) * 1.5;
      const listenBoost = md === 'listening' ? smoothLevel * 0.12 : 0;
      const sy = Math.max(0.05, cur.eyeH * blink + listenBoost), sx = cur.eyeW;
      for (const [g, side] of [[eyesL.current, -1], [eyesR.current, 1]] as const) {
        if (!g) continue;
        const ex0 = CX + side * EYE_DX;
        g.setAttribute('transform', `translate(${(ex0 + gx).toFixed(2)} ${(EYE_Y + gy + breathe).toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${-ex0} ${-EYE_Y})`);
      }
      // brows: tilt (-1 sad, +1 angry), raised for surprise
      const by = EYE_Y - 48 + cur.browY + gy * 0.5 + breathe;
      const t = cur.brow * 11;
      const thinking = effective === 'thinking';
      if (browL.current) {
        browL.current.setAttribute('x1', String(CX - EYE_DX - 26)); browL.current.setAttribute('x2', String(CX - EYE_DX + 24));
        browL.current.setAttribute('y1', (by - t).toFixed(1)); browL.current.setAttribute('y2', (by + t).toFixed(1));
      }
      if (browR.current) {
        const tr = thinking ? -t - 8 : t;
        browR.current.setAttribute('x1', String(CX + EYE_DX - 24)); browR.current.setAttribute('x2', String(CX + EYE_DX + 26));
        browR.current.setAttribute('y1', (by + tr - (thinking ? 6 : 0)).toFixed(1)); browR.current.setAttribute('y2', (by - tr - (thinking ? 6 : 0)).toFixed(1));
      }
      // mouth: speaking opens with the audio level (with a little chatter so quiet TTS still moves)
      let open = cur.open;
      if (md === 'speaking') {
        const chatter = reduce ? 0.25 : 0.12 + 0.1 * Math.abs(Math.sin(now / 70));
        open = Math.min(1, Math.max(open * 0.5, smoothLevel * 1.4 + (raw > 0.01 ? 0 : chatter)));
      }
      mouth.current?.setAttribute('d', mouthPath(cur.curve, open, cur.mouthW));
      if (mouth.current) mouth.current.setAttribute('transform', thinking ? 'translate(18 2)' : '');
      // listening rings follow the mic
      if (rings.current) {
        const on = md === 'listening';
        rings.current.style.opacity = on ? String(0.35 + smoothLevel * 0.65) : '0';
        const s = 1 + (on ? smoothLevel * 0.25 + (reduce ? 0 : Math.sin(now / 260) * 0.03) : 0);
        rings.current.setAttribute('transform', `translate(${CX} ${H / 2}) scale(${s.toFixed(3)}) translate(${-CX} ${-H / 2})`);
      }
      if (glow.current) glow.current.style.opacity = String(0.45 + (md === 'speaking' ? smoothLevel * 0.5 : md === 'thinking' && !reduce ? 0.15 + 0.15 * Math.sin(now / 300) : 0));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pose = POSES[mode === 'listening' && expression === 'neutral' ? 'listening' : mode === 'thinking' && expression === 'neutral' ? 'thinking' : expression];
  const label = `${name ?? 'Robot'} face: ${expression}${mode !== 'idle' ? `, ${mode}` : ''}`;
  return (
    <div className={`robot-face rf-${size} rf-mode-${mode} rf-ex-${expression}`} style={led ? ({ '--rf-led': led } as CSSProperties) : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <radialGradient id="rf-screen" cx="50%" cy="42%" r="70%">
            <stop offset="0%" stopColor="var(--rf-screen-hi)" />
            <stop offset="100%" stopColor="var(--rf-screen)" />
          </radialGradient>
          <filter id="rf-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect className="rf-bezel" x={6} y={6} width={W - 12} height={H - 12} rx={64} />
        <rect x={22} y={22} width={W - 44} height={H - 44} rx={50} fill="url(#rf-screen)" />
        <rect ref={glow} className="rf-glowrect" x={22} y={22} width={W - 44} height={H - 44} rx={50} />
        <g ref={rings} className="rf-rings" fill="none">
          <circle cx={CX} cy={H / 2} r={118} /><circle cx={CX} cy={H / 2} r={100} />
        </g>
        <g className="rf-features" filter="url(#rf-glow)">
          <g ref={eyesL}><Eye kind={pose.eye} side={-1} /></g>
          <g ref={eyesR}><Eye kind={pose.eye} side={1} /></g>
          <g className="rf-brows" style={{ opacity: pose.brows ? 1 : 0 }}>
            <line ref={browL} strokeWidth={9} strokeLinecap="round" />
            <line ref={browR} strokeWidth={9} strokeLinecap="round" />
          </g>
          <path ref={mouth} className="rf-mouth" d={mouthPath(0.25, 0, 1)} />
          {expression === 'sad' && <path className="rf-tear" d={`M${CX - EYE_DX + 16} ${EYE_Y + 34} q6 12 0 16 q-6 -4 0 -16z`} />}
          {(expression === 'love' || expression === 'happy') && (
            <g className="rf-blush"><ellipse cx={CX - EYE_DX - 18} cy={EYE_Y + 50} rx={20} ry={9} /><ellipse cx={CX + EYE_DX + 18} cy={EYE_Y + 50} rx={20} ry={9} /></g>
          )}
          {expression === 'angry' && <path className="rf-vein" d="M318 62 l10 6 l-6 4 l10 6 M330 56 l6 10" />}
        </g>
        {(mode === 'thinking' || expression === 'thinking') && (
          <g className="rf-dots"><circle cx={300} cy={74} r={7} /><circle cx={322} cy={56} r={9} /><circle cx={348} cy={40} r={11} /></g>
        )}
        {expression === 'sleepy' && (
          <g className="rf-zzz"><text x={292} y={92}>z</text><text x={316} y={70}>z</text><text x={342} y={48}>Z</text></g>
        )}
        {expression === 'surprised' && <g className="rf-spark"><path d="M58 70 l8 -18 M42 92 l-18 -6 M70 52 l-2 -18" /></g>}
      </svg>
      {text ? <div className="rf-ticker" aria-live="polite"><span>{text}</span></div> : null}
      <div className="rf-led" aria-hidden={!led} title={led ? `LED ${led}` : 'LEDs off'} />
    </div>
  );
}
