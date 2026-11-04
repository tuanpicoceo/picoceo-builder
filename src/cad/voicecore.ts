// Voice core for XiaoZhi (ESP32-S3), Raspberry Pi and Jetson robots: everything a talking robot needs, packed inside the
// hollow free-form body that the composer opens at a magnet seam (see openShell in composer.ts). Follows the Claw face
// pattern (claw.ts): functions return `add` / `cut` solids for the body plus their own printed parts and components.
//
//   face block  (front cover)  display behind a window (round for GC9A01), INMP441 mic behind a Ø1.6 port,
//                               speaker behind a grille; one screwed retainer plate holds all three from behind
//   core sled   (rear half)     a printed sled screwed to the floor from below: level 0 on the deck (battery cradle,
//                               buck, amp, servo board), a shelf on two side walls over it, the board on the shelf on
//                               standoffs at its STANDARD hole pattern (or in a rim), Pi HATs stacked on the header
//   body cuts                   I/O window for the board's power / USB edge in the rear wall, HAT mic ports and vents
//                               in the top, two M3 floor screws, cable pass-through to the face
//
// The CAD only sees the spec, not the Directory: the parts come from `spec.voice` (set it with `voicePartsFor(platform,
// directory)`), else from the platform's kit preset (POPULAR_KITS xiaozhi_voice / rpi_voice / jetson_voice).

import { CATALOG, type ComponentDirectory } from '../catalog/components';
import { STANDARD } from '../catalog/standard';
import { HOLES } from '../catalog/rules';
import type { Platform, RobotSpec } from '../design/spec';
import { Build, bb, box, cylY, cylZ, sub, union, type M } from './kernel';
import { getComponentColor, getComponentSolid } from './components3d';
import type { Vec3 } from './types';

export type VoicePlatform = 'xiaozhi' | 'rpi' | 'jetson';
export const isVoiceCore = (p?: Platform | string): p is VoicePlatform => p === 'xiaozhi' || p === 'rpi' || p === 'jetson';

/** Catalog ids of the voice hardware (null = none). `servo` / `spinServo` must be micro-class (composer housings). */
export interface VoiceParts {
  board: string;
  mic: string | null;
  amp: string | null;
  speaker: string | null;
  display: string | null;
  servoBoard: string | null;
  servo: string;
  spinServo: string;
  battery: string | null;
  buck: string | null;
  /** Wheels: a DC gear motor (N20-MOTOR, GA12-N20) on an H-bridge driven from the servo board, instead of continuous servos. */
  driveMotor?: string | null;
  motorDriver?: string | null;
}
export type VoiceSpec = RobotSpec & { voice?: Partial<VoiceParts> };

/** Kit presets (same parts as DEFAULT_KIT_DIRECTORY_ITEMS xiaozhi_voice / rpi_voice / jetson_voice). */
export const VOICE_DEFAULTS: Record<VoicePlatform, VoiceParts> = {
  xiaozhi: { board: 'ESP32-S3-DEVKIT', mic: 'MIC-INMP441', amp: 'AMP-MAX98357A', speaker: 'SPK-8OHM-2W', display: 'LCD-GC9A01-128',
    servoBoard: 'PCA9685-SERVO-16', servo: 'SG90-SERVO', spinServo: 'FS90R-SERVO', battery: 'BAT-18650-1S', buck: null },
  rpi: { board: 'RPI-5', mic: 'RESPEAKER-2MIC-HAT', amp: null, speaker: 'SPK-8OHM-2W', display: 'LCD-ST7789-20',
    servoBoard: 'PCA9685-SERVO-16', servo: 'SG92R-SERVO', spinServo: 'FS90R-SERVO', battery: 'BAT-18650-2S', buck: 'BUCK-5V-5A' },
  jetson: { board: 'JETSON-NANO', mic: 'USB-MIC-MINI', amp: 'AMP-MAX98357A', speaker: 'SPK-8OHM-2W', display: 'LCD-ST7789-169',
    servoBoard: 'PCA9685-SERVO-16', servo: 'MG90S-SERVO', spinServo: 'FS90R-SERVO', battery: 'BAT-18650-2S', buck: 'BUCK-5V-5A' },
};

/** Micro-class servo (fits the composer's 9 g housing). */
export const microServo = (id: string) => {
  const c = CATALOG[id];
  return !!c && (c.kind === 'servo' || c.kind === 'cservo') && c.size[0] <= 24 && c.size[1] <= 13 && c.size[2] <= 32;
};

/** Voice parts from a Directory: the first stocked part for each role (kit preset when there is no directory). */
export function voicePartsFor(platform: Platform | undefined, dir?: ComponentDirectory | null): VoiceParts | undefined {
  if (!isVoiceCore(platform)) return undefined;
  const d = VOICE_DEFAULTS[platform];
  if (!dir) return { ...d };
  const has = (id: string) => (Number(dir[id]) || 0) > 0;
  const pick = (ids: string[]) => ids.find(has) ?? null;
  const pi = platform === 'rpi';
  const board = pick({ xiaozhi: ['ZHAOZHI-AI-CORE', 'ESP32-S3-DEVKIT', 'XIAO-ESP32-S3'], rpi: ['RPI-5', 'RPI-4B', 'RPI-ZERO-2W'], jetson: ['JETSON-NANO', 'JETSON-ORIN-NANO'] }[platform]) ?? d.board;
  const builtIn = board === 'ZHAOZHI-AI-CORE';                    // mics + I2S amp on the board
  const mic = builtIn ? null : pick([...(pi ? ['RESPEAKER-2MIC-HAT'] : []), 'MIC-INMP441', 'USB-MIC-MINI']);
  const amp = builtIn || mic === 'RESPEAKER-2MIC-HAT' ? null : pick(['AMP-MAX98357A']);
  const stocked = (kind: string) => Object.keys(dir).find(id => has(id) && CATALOG[id]?.kind === kind && microServo(id));
  return {
    board, mic, amp,
    speaker: pick(['SPK-8OHM-2W', 'SPK-MICRO-1W', 'ZHAOZHI-SPEAKER-MOD']),
    display: pick(['LCD-GC9A01-128', 'LCD-ST7789-169', 'LCD-ST7789-20', 'OLED-SSD1306']),
    servoBoard: pick([...(pi ? ['WAVESHARE-SERVO-HAT', 'ADAFRUIT-SERVO-BONNET'] : []), 'PCA9685-SERVO-16', 'BUS-SERVO-ADAPTER']),
    servo: stocked('servo') ?? d.servo,
    spinServo: stocked('cservo') ?? d.spinServo,
    battery: pick([...(pi ? ['UPS-HAT-PI'] : []), ...(platform === 'xiaozhi' ? ['BAT-18650-1S', 'BAT-LIPO-1S-1000', 'B-BA001', 'BAT-18650-2S'] : ['BAT-18650-2S', 'B-PC003', 'BAT-18650-1S', 'BAT-LIPO-1S-1000'])]),
    buck: pick(['BUCK-5V-5A']),
    driveMotor: pick(['N20-MOTOR']),
    motorDriver: pick(['DRV8833-DRIVER', 'TB6612-DRIVER']),
  };
}

/** The parts the CAD builds: `spec.voice` over the platform preset; unknown ids fall back to the preset. */
export function voiceParts(spec: RobotSpec): VoiceParts {
  const p = (isVoiceCore(spec.platform) ? spec.platform : 'xiaozhi') as VoicePlatform;
  const d = VOICE_DEFAULTS[p], o = (spec as VoiceSpec).voice ?? {};
  const ok = (v: string | null | undefined, dv: string | null) => (v === null ? null : v && CATALOG[v] ? v : dv);
  const out: VoiceParts = {
    board: ok(o.board, d.board)!, mic: ok(o.mic, d.mic), amp: ok(o.amp, d.amp), speaker: ok(o.speaker, d.speaker),
    display: ok(o.display, d.display), servoBoard: ok(o.servoBoard, d.servoBoard), servo: ok(o.servo, d.servo)!,
    spinServo: ok(o.spinServo, d.spinServo)!, battery: ok(o.battery, d.battery), buck: ok(o.buck, d.buck),
    driveMotor: ok(o.driveMotor, null), motorDriver: ok(o.motorDriver, null),
  };
  if (out.board === 'ZHAOZHI-AI-CORE' && o.mic === undefined) out.mic = null;
  if (out.board === 'ZHAOZHI-AI-CORE' && o.amp === undefined) out.amp = null;
  return out;
}

export const FLOOR = 4;                   // voice bodies get a 4 mm floor (sled screws come up through it)
const DECK = 2.5, SHELF = 2.5, SIDE = 5, GAP = 2;
const isHat = (id: string | null) => !!id && ['RESPEAKER-2MIC-HAT', 'WAVESHARE-SERVO-HAT', 'ADAFRUIT-SERVO-BONNET', 'UPS-HAT-PI'].includes(id);

// ---------------------------------------------------------------- face block (display, mic, speaker)

interface FaceItem { role: 'display' | 'mic' | 'speaker'; id: string; w: number; h: number; t: number; dx: number; dz: number }
export interface FaceLayout { kind: 'row' | 'column' | 'stack'; items: FaceItem[]; w: number; h: number; t: number }
const FM = 5, FGAP = 4, BEZEL = 1.5, RET = 2;

/** Display windows: round (GC9A01), rectangular active area, or the SSD1306 glass offset. */
const WINDOW: Record<string, { round?: number; w?: number; h?: number; dz?: number }> = {
  'LCD-GC9A01-128': { round: 33.0 },
  'LCD-ST7789-169': { w: 28.5, h: 33.2 },
  'LCD-ST7789-20': { w: 31.1, h: 41.3 },
  'OLED-SSD1306': { w: 22.2, h: 11.4, dz: 2 },
};

/** Row (mic | display | speaker) and column (mic over display over speaker) layouts of the face block. */
export function faceLayouts(parts: VoiceParts): FaceLayout[] {
  const items: FaceItem[] = [];
  const add = (role: FaceItem['role'], id: string | null) => {
    if (!id || !CATALOG[id]) return;
    const [w, h, t] = CATALOG[id].size;
    items.push({ role, id, w, h, t, dx: 0, dz: 0 });
  };
  if (parts.mic === 'MIC-INMP441') add('mic', parts.mic);
  add('display', parts.display);
  add('speaker', parts.speaker);
  if (!items.length) return [];
  const t = Math.max(...items.map(i => i.t));
  const row = (): FaceLayout => {
    const w = items.reduce((s, i) => s + i.w, 0) + FGAP * (items.length - 1) + 2 * FM;
    let x = -w / 2 + FM;
    const its = items.map(i => { const o = { ...i, dx: x + i.w / 2, dz: 0 }; x += i.w + FGAP; return o; });
    return { kind: 'row', items: its, w, h: Math.max(...items.map(i => i.h)) + 2 * FM, t };
  };
  const column = (): FaceLayout => {
    const h = items.reduce((s, i) => s + i.h, 0) + FGAP * (items.length - 1) + 2 * FM;
    let z = h / 2 - FM;
    const its = items.map(i => { const o = { ...i, dx: 0, dz: z - i.h / 2 }; z -= i.h + FGAP; return o; });
    return { kind: 'column', items: its, w: Math.max(...items.map(i => i.w)) + 2 * FM, h, t };
  };
  // display on the left, the mic over the speaker beside it (the most compact block for three parts)
  const stack = (): FaceLayout | null => {
    const d = items.find(i => i.role === 'display'), rest = items.filter(i => i !== d);
    if (!d || rest.length < 2) return null;
    const rw = Math.max(...rest.map(i => i.w)), rh = rest.reduce((s, i) => s + i.h, 0) + FGAP * (rest.length - 1);
    const w = d.w + FGAP + rw + 2 * FM, h = Math.max(d.h, rh) + 2 * FM;
    let z = rh / 2;
    const its = [{ ...d, dx: -w / 2 + FM + d.w / 2, dz: 0 }, ...rest.map(i => { const o = { ...i, dx: w / 2 - FM - rw / 2, dz: z - i.h / 2 }; z -= i.h + FGAP; return o; })];
    return { kind: 'stack', items: its, w, h, t };
  };
  return items.length > 1 ? [row(), stack(), column()].filter((L): L is FaceLayout => !!L) : [row()];
}

/** Outline of a face block whose front is at y = yF and centre at (x, z). */
export function faceBox(L: FaceLayout, x: number, yF: number, z: number) {
  const yBack = yF - BEZEL - L.t - 0.3;
  return { x0: x - L.w / 2, x1: x + L.w / 2, y0: yBack - RET, yBack, y1: yF, z0: z - L.h / 2, z1: z + L.h / 2 };
}

/** Solid of a face component, front (glass / sound port / cone) toward +y at y = yFront, centred at (x, z). */
function faceSolid(id: string, x: number, yFront: number, z: number): M {
  const [w, h, t] = CATALOG[id].size;
  if (id === 'MIC-INMP441') return getComponentSolid(id, 0, 0, 0).rotate([90, 0, 0]).translate([x, yFront, z]);   // bottom port -> +y
  if (CATALOG[id].kind === 'speaker') {
    const frame = sub(box(x - w / 2, x + w / 2, yFront - t, yFront, z - h / 2, z + h / 2), box(x - w / 2 + 2, x + w / 2 - 2, yFront - 1, yFront + 1, z - h / 2 + 2, z + h / 2 - 2));
    return union([frame, box(x - w / 2 + 2, x + w / 2 - 2, yFront - t, yFront - 1.5, z - h / 2 + 2, z + h / 2 - 2)]);
  }
  return getComponentSolid(id, 0, 0, 0).rotate([-90, 0, 0]).translate([x, yFront - t, z]);              // +z (glass) -> +y
}

/**
 * The face block at centre (x, z), front at yF: pockets open to the back, a window / port / grille in front of each
 * part, one retainer plate (2 x M2) behind them with a cable window per part. Returns `add` (the block, for the body's
 * cover half) and `cut` (pockets, openings, screw taps and the retainer envelope), like `clawFace`.
 */
export function voiceFace(b: Build, spec: RobotSpec, link: string, L: FaceLayout, at: { x: number; yF: number; z: number }, tag = '') {
  const f = faceBox(L, at.x, at.yF, at.z), front = at.yF - BEZEL;
  const cuts: M[] = [], pads: M[] = [], windows: M[] = [];
  // `openings`: what must stay open in front of the block (screen window, mic port, speaker grille), 120 mm deep,
  // so features on any part (a bezel, a visor, a hat brim) are cut back there but can frame them
  const openings: M[] = [];
  for (const it of L.items) {
    const cx = at.x + it.dx, cz = at.z + it.dz;
    cuts.push(box(cx - it.w / 2 - 0.2, cx + it.w / 2 + 0.2, f.yBack - 0.01, front, cz - it.h / 2 - 0.2, cz + it.h / 2 + 0.2));
    if (it.role === 'display') {
      const wdw = WINDOW[it.id] ?? { w: it.w - 4, h: it.h - 6 };
      const win = (y1: number) => (wdw.round ? cylY(cx, cz, wdw.round / 2, front - 0.5, y1, 64)
        : box(cx - wdw.w! / 2, cx + wdw.w! / 2, front - 0.5, y1, cz + (wdw.dz ?? 0) - wdw.h! / 2, cz + (wdw.dz ?? 0) + wdw.h! / 2));
      cuts.push(win(at.yF + 40));
      openings.push(win(at.yF + 120));
    } else if (it.role === 'mic') {
      cuts.push(cylY(cx, cz, 0.8, front - 0.5, at.yF + 40, 16));                                  // Ø1.6 sound port
      openings.push(cylY(cx, cz, 2.5, front - 0.5, at.yF + 120, 16));
    } else {
      for (let gx = -(it.w - 8) / 2; gx <= (it.w - 8) / 2 + 0.01; gx += 3)                     // Ø2 grille, 3 mm pitch (35 % open)
        for (let gz = -(it.h - 8) / 2; gz <= (it.h - 8) / 2 + 0.01; gz += 3) cuts.push(cylY(cx + gx, cz + gz, 1.0, front - 0.5, at.yF + 40, 12));
      openings.push(box(cx - (it.w - 8) / 2 - 1.5, cx + (it.w - 8) / 2 + 1.5, front - 0.5, at.yF + 120, cz - (it.h - 8) / 2 - 1.5, cz + (it.h - 8) / 2 + 1.5));
    }
    const back = front - it.t;
    if (back - f.yBack > 0.6) pads.push(box(cx - it.w / 2 + 1, cx + it.w / 2 - 1, f.yBack - 0.03, back - 0.2, cz - it.h / 2 + 1, cz + it.h / 2 - 1));
    windows.push(box(cx - 6, cx + 6, f.y0 - 1, back - 0.1, cz - it.h / 2 + 1.5, cz - it.h / 2 + 7.5));   // cable window
    const label = it.role === 'display' ? `${CATALOG[it.id].name} (the face)` : it.role === 'mic' ? 'Microphone (INMP441)' : 'Speaker';
    b.comp({ key: `voice_${it.role}`, catalogId: it.id, label, link, solid: faceSolid(it.id, cx, front, cz),
      color: it.role === 'speaker' ? '#27272a' : getComponentColor(it.id) });
  }
  const screws: [number, number][] = [[f.x0 + 2.5, f.z1 - 2.5], [f.x1 - 2.5, f.z0 + 2.5]];
  cuts.push(...screws.map(([sx, sz]) => cylY(sx, sz, HOLES.M2.tap / 2, f.yBack - 0.5, f.yBack + 6, 12)),
    box(f.x0 - 0.2, f.x1 + 0.2, f.y0 - 0.2, f.yBack, f.z0 - 0.2, f.z1 + 0.2));                    // retainer envelope
  // `tag` names a second block (e.g. the speaker on the body when the display face is on the head)
  b.part({ id: `face_retainer${tag ? '_' + tag : ''}`, name: `Face retainer${tag ? ` (${tag})` : ''}`, link, material: spec.structural, profile: 'shell', color: spec.accentColor,
    solid: sub(union([box(f.x0, f.x1, f.y0, f.yBack - 0.02, f.z0, f.z1), ...pads]),
      ...screws.map(([sx, sz]) => cylY(sx, sz, HOLES.M2.clear / 2, f.y0 - 1, f.yBack + 1, 12)), ...windows),
    printRot: [90, 0, 0], printNote: 'Flat; screws over the backs of the display, mic and speaker.' });
  b.screw('M2×6 self-tap', 2, 'face retainer');
  return { add: box(f.x0, f.x1, f.yBack, f.y1, f.z0, f.z1), cut: union(cuts), box: f, openings: union(openings) };
}

// ---------------------------------------------------------------- core sled (board, HATs, battery, buck, amp, servo board)

interface L0Item { id: string; role: string; w: number; d: number; rot: number; mount: 'rim' | 'bosses' | 'cradle'; x: number; y: number }
export interface CoreLayout {
  parts: VoiceParts;
  /** Shelf inner width, sled depth, sled outer width, height of everything above the sled bottom. */
  W: number; D: number; sledW: number; H: number;
  l0: L0Item[]; l0H: number; shelfZ: number | null; boardZ: number; boardRot: number;
  board: { w: number; d: number; h: number; minY: number; cx: number };
  hats: { id: string; z: number }[];
}

const BOARD_ROT: Record<string, number> = { 'ZHAOZHI-AI-CORE': 90, 'XIAO-ESP32-S3': 180, 'XIAO-ESP32-C3': 180 };
const footprint = (m: M) => { const q = bb(m); return { w: q.max[0] - q.min[0], d: q.max[1] - q.min[1], h: q.max[2] - q.min[2], q }; };

/** STANDARD hole centres of a part, relative to its envelope centre (face -z). */
function holesOf(id: string): [number, number][] {
  const h = STANDARD[id]?.holes;
  if (!h || (h.face && h.face !== '-z')) return [];
  const [w, d] = CATALOG[id].size;
  if (Array.isArray(h.pitch[0])) return (h.pitch as number[][]).map(([u, v]) => [u - w / 2, v - d / 2]);
  const [du, dv] = h.pitch as [number, number];
  return dv ? [[-du / 2, -dv / 2], [du / 2, -dv / 2], [-du / 2, dv / 2], [du / 2, dv / 2]] : [[-du / 2, 0], [du / 2, 0]];
}
const rotXY = ([x, y]: [number, number], deg: number): [number, number] =>
  deg === 90 ? [-y, x] : deg === 180 ? [-x, -y] : deg === 270 ? [y, -x] : [x, y];

/** Shelf packing of the level-0 parts in rows across width W (rotation allowed). */
function pack(items: { id: string; role: string; w: number; d: number; mount: L0Item['mount'] }[], W: number) {
  const rows: { d: number; used: number; y: number }[] = [];
  const out: L0Item[] = [];
  let D = 0;
  for (const it of [...items].sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d))) {
    const opts = [{ w: it.w, d: it.d, rot: 0 }, { w: it.d, d: it.w, rot: 90 }].filter(o => o.w <= W + 0.01);
    if (!opts.length) return null;
    let placed = false;
    for (const r of rows) {
      const o = opts.filter(o => r.used + o.w <= W + 0.01 && o.d <= r.d + 0.01).sort((a, b) => b.d - a.d)[0];
      if (o) { out.push({ ...it, ...o, x: -W / 2 + r.used + o.w / 2, y: r.y + o.d / 2 }); r.used += o.w + GAP; placed = true; break; }
    }
    if (placed) continue;
    const o = opts.sort((a, b) => a.d - b.d)[0];
    const y = rows.length ? D + GAP : 0;
    rows.push({ d: o.d, used: o.w + GAP, y });
    out.push({ ...it, ...o, x: -W / 2 + o.w / 2, y: y + o.d / 2 });
    D = y + o.d;
  }
  return { out, D };
}

/** Sizes and positions of the core, relative to the sled origin (x centre, y = rear edge, z = sled bottom). */
export function coreLayout(parts: VoiceParts, servos: boolean): CoreLayout {
  const rot = BOARD_ROT[parts.board] ?? 0;
  const bf = footprint(getComponentSolid(parts.board, 0, 0, 0).rotate([0, 0, rot]));
  const stackable = parts.board.startsWith('RPI-');
  const cell = (id: string, role: string) => {
    const f = footprint(getComponentSolid(id, 0, 0, 0));
    const mount: L0Item['mount'] = CATALOG[id].kind === 'battery' ? 'cradle' : holesOf(id).length ? 'bosses' : 'rim';
    const pad = mount === 'cradle' ? 2 * 1.6 + 1.5 : mount === 'rim' ? 2 * 1.6 + 0.4 : 1;
    return { id, role, w: f.w + pad, d: f.d + pad, h: f.h + (mount === 'bosses' ? 3 : 0), mount };
  };
  const l0in: ReturnType<typeof cell>[] = [];
  if (parts.battery && !isHat(parts.battery)) l0in.push(cell(parts.battery, 'battery'));
  if (parts.buck && parts.battery !== 'UPS-HAT-PI') l0in.push(cell(parts.buck, 'buck'));
  if (parts.amp) l0in.push(cell(parts.amp, 'amp'));
  if (servos && parts.servoBoard && !(stackable && isHat(parts.servoBoard))) l0in.push(cell(parts.servoBoard, 'servo_driver'));
  const base = Math.max(bf.w, ...l0in.map(i => Math.min(i.w, i.d)));
  let best: { W: number; out: L0Item[]; D: number } | null = null;
  for (let W = base; W <= base + 45; W += 5) {
    const p = pack(l0in, W);
    if (p && (!best || W + Math.max(bf.d, p.D) < best.W + Math.max(bf.d, best.D) - 0.5)) best = { W, ...p };
  }
  const W = best!.W, D = Math.max(bf.d, best!.D) + 2;
  const l0H = l0in.length ? Math.max(...l0in.map(i => i.h)) + 2 : 0;
  const shelfZ = l0in.length ? DECK + l0H : null;
  const boardHoles = holesOf(parts.board);
  const standoff = boardHoles.length ? Math.max(4, STANDARD[parts.board]?.holes?.standoff ?? 5) : 0;
  const boardZ = (shelfZ !== null ? shelfZ + SHELF : DECK) + standoff;
  // Pi HATs stack on the 40-pin header: servo HAT, UPS, then the ReSpeaker on top (its mics face up)
  const hats: { id: string; z: number }[] = [];
  if (stackable) {
    let z = boardZ + 1.6 + 8.5;
    for (const id of [servos ? parts.servoBoard : null, parts.battery, parts.mic].filter(isHat) as string[]) {
      hats.push({ id, z });
      z += CATALOG[id].size[2];
    }
  }
  const H = Math.max(boardZ + bf.h, ...hats.map(h => h.z + CATALOG[h.id].size[2]), shelfZ !== null ? shelfZ + SHELF : DECK);
  return { parts, W, D, sledW: W + 2 * SIDE, H, l0: best!.out, l0H, shelfZ, boardZ, boardRot: rot,
    board: { w: bf.w, d: bf.d, h: bf.h, minY: bf.q.min[1], cx: (bf.q.min[0] + bf.q.max[0]) / 2 }, hats };
}

/** Envelope of the core at sled origin (x, y0, z0), with a 1 mm margin (the fit test of the body growth loop). */
export function coreEnvelope(L: CoreLayout, at: Vec3): M {
  const [x, y0, z0] = at;
  return box(x - L.sledW / 2 - 1, x + L.sledW / 2 + 1, y0 - 1, y0 + L.D + 1, z0, z0 + L.H + 2);
}

/**
 * Build the core at sled origin `at`: the sled part, the board, HATs and level-0 parts. Returns body `cuts` (rear I/O
 * window, floor screws), `topCuts` (HAT mic ports and vents through the top wall; the caller subtracts the servo
 * housings) and the solids the magnet search must avoid.
 */
export function buildVoiceCore(b: Build, spec: RobotSpec, link: string, L: CoreLayout, at: Vec3) {
  const [x, y0, z0] = at, P = L.parts;
  const sx0 = x - L.sledW / 2, sx1 = x + L.sledW / 2, y1 = y0 + L.D;
  const adds: M[] = [box(sx0, sx1, y0, y1, z0, z0 + DECK)];
  const cuts: M[] = [];
  const deckTop = z0 + DECK;
  // ---- level 0: cradle / rims / bosses
  for (const it of L.l0) {
    const cx = x + it.x, cy = y0 + it.y;
    const raw = getComponentSolid(it.id, 0, 0, 0).rotate([0, 0, it.rot]);
    const q = bb(raw);
    const zc = deckTop + (it.mount === 'bosses' ? 3 : 0);
    const solid = raw.translate([cx - (q.min[0] + q.max[0]) / 2, cy - (q.min[1] + q.max[1]) / 2, zc - q.min[2]]);
    const f = bb(solid);
    if (it.mount === 'bosses') {
      const hs = holesOf(it.id).map(p => rotXY(p, it.rot));
      adds.push(...hs.map(([hx, hy]) => cylZ(cx + hx, cy + hy, 2.6, deckTop - 0.01, zc, 16)));
      cuts.push(...hs.map(([hx, hy]) => cylZ(cx + hx, cy + hy, (holesOf(it.id).length && STANDARD[it.id]?.holes?.size === 'M3' ? HOLES.M3.tap : HOLES.M2_5.tap) / 2, deckTop - 1, zc + 0.5, 12)));
    } else {
      const m = it.mount === 'cradle' ? [0.5, 0.75] : [0.2, 0.2], rh = it.mount === 'cradle' ? 4 : 2;
      const ix0 = f.min[0] - m[0], ix1 = f.max[0] + m[0], iy0 = f.min[1] - m[1], iy1 = f.max[1] + m[1];
      adds.push(sub(box(ix0 - 1.6, ix1 + 1.6, iy0 - 1.6, iy1 + 1.6, deckTop - 0.01, deckTop + rh), box(ix0, ix1, iy0, iy1, deckTop - 1, deckTop + rh + 1),
        box((ix0 + ix1) / 2 - 6, (ix0 + ix1) / 2 + 6, iy1 - 1, iy1 + 3, deckTop + 0.5, deckTop + rh + 1)));   // lead notch at the front
    }
    const label = it.role === 'battery' ? `Battery ${CATALOG[it.id].name}` : it.role === 'buck' ? '5 V buck converter' : it.role === 'amp' ? 'I2S amplifier (MAX98357A)' : `Servo driver ${CATALOG[it.id].name}`;
    b.comp({ key: `voice_${it.role}`, catalogId: it.id, label, link, solid, color: getComponentColor(it.id) });
  }
  // ---- shelf on two side walls, screw blocks at the rear
  let top = deckTop;
  if (L.shelfZ !== null) {
    const s0 = z0 + L.shelfZ, s1 = s0 + SHELF;
    adds.push(box(sx0, sx0 + SIDE, y0, y1, deckTop - 0.01, s0 + 0.01), box(sx1 - SIDE, sx1, y0, y1, deckTop - 0.01, s0 + 0.01), box(sx0, sx1, y0, y1, s0, s1));
    cuts.push(box(x - 8, x + 8, y1 - 12, y1 - 4, s0 - 1, s1 + 1));                                  // cable pass-through
    top = s1;
  }
  const screwAt: [number, number][] = [[sx0 + SIDE / 2, y0 + 5], [sx1 - SIDE / 2, y0 + 5]];
  if (L.shelfZ === null) adds.push(...screwAt.map(([px, py]) => cylZ(px, py, 3.5, deckTop - 0.01, deckTop + 5, 20)));
  cuts.push(...screwAt.map(([px, py]) => cylZ(px, py, HOLES.M3.tap / 2, z0 - 1, z0 + 9, 16)));
  // ---- board on standoffs (STANDARD hole pattern) or in a rim
  const rawBoard = getComponentSolid(P.board, 0, 0, 0).rotate([0, 0, L.boardRot]);
  const dx = x - L.board.cx, dy = y0 - L.board.minY + 0.5, bz = z0 + L.boardZ;
  const boardSolid = rawBoard.translate([dx, dy, bz]);
  const holes = holesOf(P.board).map(p => rotXY(p, L.boardRot)).map(([hx, hy]) => [hx + dx, hy + dy] as [number, number]);
  if (holes.length) {
    adds.push(...holes.map(([hx, hy]) => cylZ(hx, hy, 2.9, top - 0.01, bz, 20)));
    cuts.push(...holes.map(([hx, hy]) => cylZ(hx, hy, HOLES.M2_5.tap / 2, top - 1, bz + 0.5, 12)));
    b.screw('M2.5×6', holes.length, 'board to the sled standoffs');
  } else {
    const q = bb(boardSolid);
    adds.push(sub(box(q.min[0] - 1.8, q.max[0] + 1.8, q.min[1] + 1, q.max[1] + 1.8, top - 0.01, top + 2.5), box(q.min[0] - 0.2, q.max[0] + 0.2, q.min[1], q.max[1] + 0.2, top - 1, top + 4)));
  }
  b.comp({ key: 'voice_board', catalogId: P.board, label: CATALOG[P.board].name, link, solid: boardSolid, color: getComponentColor(P.board) });
  // ---- Pi HATs on the header, aligned with the board's min-x / max-y corner (the GPIO edge)
  const bq = bb(boardSolid);
  const hatSolids: { id: string; solid: M }[] = [];
  // the 40-pin header runs along the GPIO edge (51 × 5 mm, 3.5 mm in); each HAT above the first carries the stacking
  // header that bridges down to the PCB below it, so the stack is one connected body
  const hdrX = bq.min[0] + 32.5, hdrY = (P.board === 'RPI-ZERO-2W' ? bq.max[1] - 0.5 : bq.max[1] - 1) - 3.5;
  let prev = boardSolid;
  for (const h of L.hats) {
    const [hw, hd] = CATALOG[h.id].size;
    const w = Math.min(hw, 64.5);
    let s = (h.id === 'RESPEAKER-2MIC-HAT' ? getComponentSolid(h.id, 0, 0, 0) : getComponentSolid(h.id, 0, 0, 0).intersect(box(-hw / 2 - 1, -hw / 2 + w, -500, 500, -500, 500)))
      .translate([bq.min[0] + hw / 2, (P.board === 'RPI-ZERO-2W' ? bq.max[1] - 0.5 : bq.max[1] - 1) - hd / 2, z0 + h.z]);
    // bridge from the top of whatever is below in the header footprint (its pins, or its PCB) up to this HAT
    const col = (m: M) => m.intersect(box(hdrX - 25.5, hdrX + 25.5, hdrY - 2.5, hdrY + 2.5, -500, 500));
    const under = col(prev), self = col(s);
    const below = under.isEmpty() ? bb(prev).max[2] : bb(under).max[2], bottom = self.isEmpty() ? bb(s).min[2] : bb(self).min[2];
    if (bottom > below + 0.5) s = union([s, box(hdrX - 25.5, hdrX + 25.5, hdrY - 2.5, hdrY + 2.5, below, bottom + 0.01)]);
    prev = s;
    hatSolids.push({ id: h.id, solid: s });
    b.comp({ key: `voice_hat_${h.id.toLowerCase()}`, catalogId: h.id, label: CATALOG[h.id].name, link, solid: s, color: getComponentColor(h.id) });
  }
  if (L.hats.length) b.screw('M2.5×11 standoff', 4 * L.hats.length, 'HATs on the Pi');
  // ---- USB mic in the board's rear USB-A port (Pi / Jetson), poking out of the I/O window
  let usbMic: M | null = null;
  if (P.mic === 'USB-MIC-MINI') {
    const usb = boardSolid.intersect(box(bq.min[0] + (P.board === 'JETSON-NANO' ? 45 : 0), bq.max[0], bq.min[1] - 1, bq.min[1] + 14, bz + 8, bz + 40));
    const q = usb.isEmpty() ? null : bb(usb);
    const ux = q ? (q.min[0] + q.max[0]) / 2 : x, uz = q ? Math.max(q.min[2] + 3, q.max[2] - 7) : bz + 8;
    usbMic = box(ux - 6, ux + 6, bq.min[1] - 22, bq.min[1] - 0.05, uz - 3, uz + 3);
    b.comp({ key: 'voice_mic', catalogId: 'USB-MIC-MINI', label: 'USB microphone (in the rear USB port)', link, solid: usbMic, color: '#27272a' });
  }
  // ---- rear I/O window over the board's -y edge (power + USB), floor screws
  const rear = union([boardSolid, ...hatSolids.filter(h => h.id === 'UPS-HAT-PI').map(h => h.solid)]).intersect(box(-500, 500, bq.min[1] - 3, bq.min[1] + 5, bz + 1.7, 500));   // connectors on the rear edge, not the PCB
  const rq = rear.isEmpty() ? { min: [x - 7, 0, bz] as Vec3, max: [x + 7, 0, bz + 6] as Vec3 } : bb(rear);
  const wx0 = Math.min(rq.min[0] - 1.5, (rq.min[0] + rq.max[0]) / 2 - 7), wx1 = Math.max(rq.max[0] + 1.5, (rq.min[0] + rq.max[0]) / 2 + 7);
  const wz0 = Math.min(rq.min[2] - 1.5, (rq.min[2] + rq.max[2]) / 2 - 4.5), wz1 = Math.max(rq.max[2] + 1.5, (rq.min[2] + rq.max[2]) / 2 + 4.5);
  const bodyCuts: M[] = [box(wx0, wx1, -500, bq.min[1] + 1, wz0, wz1)];
  bodyCuts.push(...screwAt.map(([px, py]) => union([cylZ(px, py, HOLES.M3.clear / 2, -1, z0 + 0.5, 16), cylZ(px, py, HOLES.M3.cbore / 2, -1, 1.5, 20)])));
  b.screw('M3×10 self-tap', 2, 'voice core sled to the body floor (from below)');
  // ---- top openings: ReSpeaker mic ports, vents over the SBC
  const topCuts: M[] = [];
  const respeaker = hatSolids.find(h => h.id === 'RESPEAKER-2MIC-HAT');
  if (respeaker) {
    const q = bb(respeaker.solid);
    for (const mx of [q.min[0] + 5, q.max[0] - 5]) topCuts.push(cylZ(mx, (q.min[1] + q.max[1]) / 2, 0.9, q.max[2] - 3, 500, 16));
  }
  if (P.board.startsWith('RPI-') || P.board.startsWith('JETSON')) {
    const vw = bq.max[0] - bq.min[0], vy0 = bq.min[1] + 12, vy1 = bq.max[1] - 10;
    for (let vy = vy0; vy <= vy1 - 3; vy += 7) topCuts.push(box(x - vw * 0.3, x + vw * 0.3, vy, vy + 3, z0 + L.H + 3, 500));
  }
  const sled = sub(union(adds), ...cuts);
  b.part({ id: 'voice_sled', name: 'Voice core sled', link, material: spec.structural, profile: 'chassis', color: spec.accentColor,
    solid: sled, printRot: [0, 0, 0], printNote: 'Deck down; supports under the shelf. Fit the parts, slide it in from the front and screw it from below (2 × M3×10).' });
  return { sled, bodyCuts, topCuts, screws: screwAt, comps: [boardSolid, ...hatSolids.map(h => h.solid), ...(usbMic ? [usbMic] : [])], window: { x0: wx0, x1: wx1, z0: wz0, z1: wz1 } };
}
