// RobotSpec: the design document the AI writes and the CAD generators read.
// Every field has a safe range; `normalizeSpec` clamps whatever comes in (AI output, imported JSON).

import type { Material } from '../catalog/rules';

export type Archetype = string;
export type RobotTheme = string;
export type DriveType = 'B-PG002' | 'B-GM001';
export type HeadFeature = 'none' | 'beak' | 'ears' | 'visor' | 'dome';
export type FootStyle = 'standard' | 'webbed' | 'wide';
export type MountType = 'none' | 'phone_stand' | 'magnetic_mount' | 'camera_mount' | 'pan_tilt_head' | 'tablet_stand';
export type LeverTool = 'boom' | 'cup' | 'flag' | 'paddle';
export type RotorStyle = 'fan' | 'windmill' | 'wheel' | 'paddle' | 'carousel';
export type LinearOrient = 'horizontal' | 'vertical';
export type LinearTool = 'table' | 'fork' | 'camera';

// ---------------------------------------------------------------- free-form composition
// For ideas no dedicated builder matches (a fish with a wagging tail, a clock, a plant waterer), the AI
// composes the robot instead: a body shape on a neck above the standard battery / electronics base, up to
// four servo joints mounted on faces of the body or of another member, each driving a member shape, plus
// static features and LED eyes. Sizes and offsets are in world axes at the zero pose (x right, y front, z up).

/**
 * Electronics platform, set from the user's Directory (`platformOf`). Voice robots (mic + speaker, display optional):
 * LicheeRV Claw (Linux, built-in LCD / battery / speaker), XiaoZhi ESP32-S3 (MicroPython), Raspberry Pi and Jetson
 * (Linux). CyberBrick is the original ESP32-C3 kit without audio. See docs/BACKBONE_MCP.md.
 */
export const PLATFORMS = ['cyberbrick', 'licheerv_claw', 'xiaozhi', 'rpi', 'jetson'] as const;
export type Platform = typeof PLATFORMS[number];
/** Platforms whose robots talk: they connect to the user's AI backbone over MCP. */
export const VOICE_PLATFORMS: readonly Platform[] = ['licheerv_claw', 'xiaozhi', 'rpi', 'jetson'];

/** The composer's shape library (src/cad/shapes.ts): any of them can be a body, head, member or feature. */
export const SHAPES = [
  // basics
  'box', 'rounded_box', 'cylinder', 'sphere', 'egg', 'capsule', 'cone', 'wedge', 'disc', 'fin', 'prism',
  // domes, arches, caps
  'dome', 'arch', 'arch_top', 'helmet', 'bowl', 'saucer',
  // rings and tubes
  'torus', 'hoop', 'tube',
  // revolved
  'frustum', 'bell', 'vase', 'gumdrop', 'barrel', 'pear', 'teardrop', 'hourglass', 'spinning_top', 'acorn', 'mushroom', 'puck', 'drum', 'mug',
  // prisms and polyhedra
  'pyramid', 'trapezoid', 'triangle', 'pent_prism', 'hex_prism', 'oct_prism', 'gem', 'crystal', 'chamfer_box', 'soft_cube', 'house', 'lantern',
  // screens and characters
  'crt', 'monitor', 'cat_head', 'bear_head', 'bunny_head', 'ghost', 'cloud', 'blob', 'bean', 'beak', 'horn',
  // flat profiles
  'star', 'heart', 'crescent', 'cross', 'leaf', 'shield', 'wing', 'stadium', 'semicircle', 'petal', 'bubble',
] as const;
export type ShapeKind = (typeof SHAPES)[number];
export const FACES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;
export type Face = (typeof FACES)[number];
export const POINTS = ['up', 'down', 'front', 'back', 'left', 'right', 'axis'] as const;
export type PointDir = (typeof POINTS)[number];

export interface CompJoint {
  name: string;               // link id, [a-z0-9_]
  parent: string;             // 'body' or an earlier joint's name
  face: Face;                 // face of the parent's bounding box the servo shaft points out of
  at: [number, number];       // offset from that face's centre, mm (in-plane world axes: ±x face → (y, z); ±y → (x, z); ±z → (x, y))
  kind: 'swing' | 'spin';     // B-PG001 positional / B-PG002 continuous
  range: [number, number];    // swing limits, degrees
  point: PointDir;            // direction the member extends at the zero pose ('axis' = centred on the shaft)
  reach: number;              // shaft → member shape centre, mm
  shape: ShapeKind;
  size: [number, number, number];
}
export interface CompFeature {
  parent: string;             // 'body' or a joint name
  shape: ShapeKind | 'led';   // 'led' = B-KB003 eye in a front-facing pocket
  size: [number, number, number];
  at: [number, number, number];   // centre, relative to the parent shape's centre, mm
  color: 'primary' | 'accent';
  /** a hole, not a part: the shape is cut out of the parent (a cable hole, a vent, a slot, a socket) */
  cut?: boolean;
}
export interface Composition {
  use: boolean;
  /** 'wheels' mounts the body on the differential-drive rover chassis (drive / wheel params from RobotParams). */
  /** 'legs' (LicheeRV Claw): the base becomes a pelvis on two 3-DOF walking legs (src/cad/legs.ts). */
  mobility: 'none' | 'wheels' | 'legs';
  /** Voice platforms only: 2 drive wheels + a front skid, or 4 wheels steered like a tank. */
  wheelCount?: 2 | 4;
  body: { shape: ShapeKind; size: [number, number, number] };
  standH: number;             // neck height between the deck and the body, mm
  joints: CompJoint[];
  features: CompFeature[];
}

export const EMPTY_COMPOSITION: Composition = { use: false, mobility: 'none', body: { shape: 'rounded_box', size: [60, 50, 40] }, standH: 20, joints: [], features: [] };

/** Clamp an untrusted composition into a buildable one (max 4 joints, valid parents, sane sizes). */
export function normalizeComposition(raw: any, fixes: string[] = []): Composition {
  if (!raw || typeof raw !== 'object' || !raw.use) return EMPTY_COMPOSITION;
  const n = (v: unknown, lo: number, hi: number, d: number) => {
    const x = typeof v === 'number' && Number.isFinite(v) ? v : d;
    return Math.round(Math.min(hi, Math.max(lo, x)) * 2) / 2;
  };
  const vec = <K extends number>(v: unknown, k: K, lo: number, hi: number, d: number) =>
    Array.from({ length: k }, (_, i) => n(Array.isArray(v) ? v[i] : undefined, lo, hi, d)) as any;
  const one = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
  const body = { shape: one(raw.body?.shape, SHAPES, 'rounded_box'), size: vec(raw.body?.size, 3, 8, 160, 60) as [number, number, number] };
  const names = new Set(['body']);
  const joints: CompJoint[] = [];
  for (const j of Array.isArray(raw.joints) ? raw.joints : []) {
    if (joints.length === 4) { fixes.push('composition: more than 4 joints (servo headers S1-S4); extra joints dropped'); break; }
    let name = String(j?.name ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || `joint${joints.length + 1}`;
    if (name === 'base' || names.has(name)) name = `${name}_${joints.length + 1}`;
    const parent = names.has(j?.parent) ? j.parent : 'body';
    const kind = j?.kind === 'spin' ? 'spin' : 'swing';
    const r = vec(j?.range, 2, -90, 90, 0) as [number, number];
    joints.push({
      name, parent, face: one(j?.face, FACES, '+y'), at: vec(j?.at, 2, -80, 80, 0), kind,
      range: kind === 'spin' ? [0, 0] : r[0] < r[1] ? r : [-45, 45],
      point: one(j?.point, POINTS, 'front'), reach: n(j?.reach, 0, 150, 30),
      shape: one(j?.shape, SHAPES, 'box'), size: vec(j?.size, 3, 3, 150, 20),
    });
    names.add(name);
  }
  const features: CompFeature[] = (Array.isArray(raw.features) ? raw.features : []).slice(0, 16).map((f: any) => ({
    parent: names.has(f?.parent) ? f.parent : 'body',
    shape: f?.shape === 'led' ? 'led' : one(f?.shape, SHAPES, 'sphere'),
    size: vec(f?.size, 3, 2, 140, 10), at: vec(f?.at, 3, -120, 120, 0),
    color: f?.color === 'accent' ? 'accent' : 'primary',
    ...(f?.cut === true && f?.shape !== 'led' ? { cut: true } : {}),
  }));
  const mobility = raw.mobility === 'wheels' ? 'wheels' : raw.mobility === 'legs' ? 'legs' : 'none';
  return { use: true, mobility, ...(mobility === 'wheels' ? { wheelCount: raw.wheelCount === 4 ? 4 : 2 } : {}), body, standH: n(raw.standH, 0, 80, 20), joints, features };
}

/** Stationary mechanism families with their own CAD builders (see docs/CAD_BUILDERS.md). */
export type MechanismFamily = 'scara' | 'lever' | 'rotor' | 'linear';

const word = (s: string, w: string) =>
  /^[a-z0-9 ]+$/.test(w) ? new RegExp(`(^|[^a-z])${w}(s|es)?([^a-z]|$)`).test(s) : s.includes(w);
export const hasWord = (s: string, ...ws: string[]) => ws.some(w => word(s.toLowerCase(), w));

const FAMILY_WORDS: [MechanismFamily, string[]][] = [
  ['scara', ['scara', 'plotter', 'drawbot', 'draw', 'drawing', 'sketch', 'handwriting', 'writer', 'laser pointer', 'vẽ']],
  ['lever', ['barrier', 'gate', 'catapult', 'trebuchet', 'lever', 'flag', 'semaphore', 'drawbridge', 'flipper', 'hammer', 'whack', 'wiper',
    'railway', 'crossing', 'metronome', 'turnstile', 'cổng', 'barie', 'bắn đá', 'cần gạt']],
  ['rotor', ['fan', 'windmill', 'wind turbine', 'turbine', 'ferris', 'propeller', 'rotor', 'pinwheel', 'spinner', 'waterwheel', 'paddle wheel',
    'carousel', 'feeder', 'dispenser', 'sorter', 'quạt', 'cối xay', 'đu quay', 'máy cho ăn', 'thức ăn']],
  ['linear', ['slider', 'linear', 'rail', 'lift', 'elevator', 'forklift', 'actuator', 'drawer', 'sliding door', 'curtain', 'syringe', 'dolly',
    'gantry', 'conveyor', 'shuttle', 'piston', 'thang máy', 'xe nâng', 'ray trượt', 'băng tải']],
];

/**
 * Rack-and-pinion sizing shared by the linear builder and its behaviours: module 1.5, ≥ 26 teeth, and
 * 180° of B-PG001 travel = π × pitch radius, less 1 mm of margin at each end.
 */
export function linearTravel(stroke: number) {
  const module = 1.5;
  const teeth = Math.max(26, Math.round((2 * stroke) / Math.PI / module));
  const pitchR = (module * teeth) / 2;
  const travel = Math.floor(Math.PI * pitchR) - 2;
  return { module, teeth, pitchR, travel, half: Math.floor(travel / 2) };
}

/** Which mechanism builder an archetype string asks for (null = a robot archetype). */
export function mechanismFamily(archetype: string): MechanismFamily | null {
  const t = archetype.toLowerCase().replace(/[_-]+/g, ' ');
  for (const [fam, ws] of FAMILY_WORDS) if (hasWord(t, ...ws)) return fam;
  return null;
}

export interface RobotParams {
  // theme & aesthetic shape
  theme: string;
  headFeature: HeadFeature;
  footStyle: FootStyle;
  hasTail: boolean;
  hasWings: boolean;
  // functional mount & device accessories (AI-designed)
  mountType: MountType;
  mountAngle: number;        // degrees tilt from horizontal (e.g. 65° viewing angle)
  hasMagnetPockets: boolean; // embedded recesses for Neodymium N52 / MagSafe magnets
  hasCableSlot: boolean;     // cable passthrough notch for USB-C / Lightning charging
  cradleWidth: number;       // mm width of support backplate
  cradleHeight: number;      // mm height of backplate
  // rover
  drive: DriveType;
  wheelDia: number;        // mm
  wheelWidth: number;      // mm
  tpuTires: boolean;
  bumper: boolean;
  // rover + companion
  panTilt: boolean;
  // arm
  upperLen: number;        // shoulder -> elbow, mm
  foreLen: number;         // elbow -> wrist, mm
  gripperLen: number;      // finger length, mm
  payloadG: number;        // design payload, grams
  // humanoid
  legLen: number;          // hip -> ankle, mm
  footLen: number;         // foot length, mm
  footWidth: number;       // foot width, mm
  armLen: number;          // shoulder -> hand, mm
  hasArms: boolean;        // articulated arms (shoulder servos)
  // lever (gates, catapults, flags, flippers)
  leverLen: number;        // pivot -> tip, mm
  leverTool: LeverTool;
  pivotH: number;          // pivot height above the deck, mm (also the rotor pillar minimum)
  // rotor (fans, windmills, wheels, carousels)
  rotorStyle: RotorStyle;
  rotorDia: number;        // swept diameter, mm
  bladeCount: number;      // blades / spokes / paddles / carousel cells
  // linear axis (sliders, lifts, forklift masts)
  stroke: number;          // requested travel, mm (rounded to the pinion)
  linearOrient: LinearOrient;
  linearTool: LinearTool;
  // all
  leds: number;            // B-KB003 count (0-6)
  headWidth: number;       // pan-tilt head width, mm
}

export interface RobotSpec {
  version: 1;
  name: string;
  archetype: Archetype;
  theme: RobotTheme;
  summary: string;
  params: RobotParams;
  structural: Material;
  shell: Material;
  primaryColor: string;
  accentColor: string;
  behaviors: string[];
  /** Free-form composition; when `use` is true the composer builds the robot instead of an archetype builder. */
  composition?: Composition;
  /** Electronics platform (from the user's Directory): CyberBrick ESP32-C3 + shield, or the Sipeed LicheeRV Claw kit. */
  platform?: Platform;
}

export const DEFAULT_BEHAVIORS = [
  { id: 'patrol', label: 'Patrol / Move' },
  { id: 'look', label: 'Look around' },
  { id: 'nod', label: 'Nod / Gesture' },
  { id: 'dance', label: 'Action demo' },
];

export const BEHAVIORS: Record<string, { id: string; label: string }[]> = {
  rover: [
    { id: 'square', label: 'Drive a square' },
    { id: 'patrol', label: 'Patrol back and forth' },
    { id: 'spin', label: 'Spin in place' },
    { id: 'look', label: 'Look around (pan-tilt)' },
  ],
  arm: [
    { id: 'pick', label: 'Pick and place' },
    { id: 'wave', label: 'Wave' },
    { id: 'reach', label: 'Reach test (max torque)' },
  ],
  companion: [
    { id: 'look', label: 'Look around' },
    { id: 'nod', label: 'Nod yes' },
    { id: 'shake', label: 'Shake no' },
  ],
  humanoid: [
    { id: 'walk', label: 'Bipedal walk' },
    { id: 'wave', label: 'Wave arm' },
    { id: 'dance', label: 'Shuffle dance' },
    { id: 'bow', label: 'Bow' },
  ],
  duck: [
    { id: 'walk', label: 'Waddle walk' },
    { id: 'look', label: 'Look around' },
    { id: 'dance', label: 'Waddle dance' },
    { id: 'bow', label: 'Dip beak' },
  ],
  quadruped: [
    { id: 'walk', label: 'Trot walk' },
    { id: 'patrol', label: 'Patrol terrain' },
    { id: 'look', label: 'Look around' },
    { id: 'bow', label: 'Play bow' },
  ],
  walker: [
    { id: 'walk', label: 'Stride walk' },
    { id: 'look', label: 'Scan area' },
    { id: 'dance', label: 'Step dance' },
  ],
  snake: [
    { id: 'slither', label: 'Serpentine slither' },
    { id: 'wave', label: 'Lateral wave' },
    { id: 'coil', label: 'Coil strike pose' },
    { id: 'look', label: 'Look around' },
  ],
  desk_agent: [
    { id: 'listen', label: 'Listen & attentive nod' },
    { id: 'talk', label: 'Speak with expression' },
    { id: 'think', label: 'Contemplative head tilt' },
    { id: 'greet', label: 'Greeting scan & chime' },
    { id: 'look', label: 'Look around desk' },
  ],
  stationary: [
    { id: 'listen', label: 'Listen & attentive nod' },
    { id: 'talk', label: 'Speak with expression' },
    { id: 'think', label: 'Contemplative head tilt' },
    { id: 'greet', label: 'Greeting scan & chime' },
    { id: 'look', label: 'Look around desk' },
  ],
  lever: [
    { id: 'raise', label: 'Raise / lower (gate cycle)' },
    { id: 'launch', label: 'Launch swing' },
    { id: 'wave', label: 'Wave' },
    { id: 'tap', label: 'Tap / strike' },
  ],
  rotor: [
    { id: 'spin', label: 'Spin' },
    { id: 'pulse', label: 'Speed ramp' },
    { id: 'index', label: 'Index one step' },
  ],
  linear: [
    { id: 'slide', label: 'Slide end to end' },
    { id: 'lift', label: 'Lift & hold' },
    { id: 'scan', label: 'Step & pause scan' },
  ],
  composer: [
    { id: 'wave', label: 'Wave all joints' },
    { id: 'look', label: 'Exercise each joint' },
    { id: 'dance', label: 'Dance' },
    { id: 'spin', label: 'Spin rotors' },
  ],
  scara: [
    { id: 'draw', label: 'Draw a circle' },
    { id: 'sweep', label: 'Sweep the workspace' },
    { id: 'wave', label: 'Wave' },
  ],
};

/** Behaviour list for an archetype: exact key, then mechanism family. */
export const behaviorsOf = (archetype: string) => BEHAVIORS[archetype] ?? BEHAVIORS[mechanismFamily(archetype) ?? ''];

export const RANGES = {
  wheelDia: [44, 90], wheelWidth: [10, 24], upperLen: [45, 100], foreLen: [45, 100],
  gripperLen: [20, 40], payloadG: [0, 80], leds: [0, 6], headWidth: [36, 60],
  legLen: [35, 70], footLen: [35, 65], footWidth: [22, 38], armLen: [30, 60],
  mountAngle: [15, 85], cradleWidth: [40, 95], cradleHeight: [30, 110],
  leverLen: [50, 180], pivotH: [44, 90], rotorDia: [60, 140], bladeCount: [2, 8], stroke: [60, 120],
} as const;

export const DEFAULT_PARAMS: RobotParams = {
  theme: 'classic',
  headFeature: 'none',
  footStyle: 'standard',
  hasTail: false,
  hasWings: false,
  mountType: 'none',
  mountAngle: 65,
  hasMagnetPockets: false,
  hasCableSlot: true,
  cradleWidth: 64,
  cradleHeight: 68,
  drive: 'B-PG002', wheelDia: 60, wheelWidth: 14, tpuTires: true, bumper: true, panTilt: false,
  upperLen: 65, foreLen: 70, gripperLen: 28, payloadG: 20, leds: 2, headWidth: 44,
  legLen: 46, footLen: 50, footWidth: 28, armLen: 42, hasArms: false,
  leverLen: 110, leverTool: 'boom', pivotH: 50,
  rotorStyle: 'fan', rotorDia: 100, bladeCount: 4,
  stroke: 80, linearOrient: 'horizontal', linearTool: 'table',
};

/** Archetype-aware defaults for the mechanism families (tool, style, orientation). */
function familyDefaults(archetype: string): Partial<RobotParams> {
  const t = archetype.toLowerCase().replace(/[_-]+/g, ' ');
  switch (mechanismFamily(archetype)) {
    case 'lever':
      return {
        leverTool: hasWord(t, 'catapult', 'trebuchet', 'bắn đá') ? 'cup' : hasWord(t, 'flag', 'semaphore') ? 'flag'
          : hasWord(t, 'flipper', 'hammer', 'whack', 'wiper', 'turnstile') ? 'paddle' : 'boom',
        leverLen: hasWord(t, 'catapult', 'trebuchet', 'flipper', 'hammer', 'whack') ? 90 : 140,
      };
    case 'rotor':
      if (hasWord(t, 'carousel', 'feeder', 'dispenser', 'sorter', 'máy cho ăn', 'thức ăn')) return { rotorStyle: 'carousel', rotorDia: 100, bladeCount: 6 };
      if (hasWord(t, 'windmill', 'wind turbine', 'turbine', 'cối xay')) return { rotorStyle: 'windmill', rotorDia: 120, bladeCount: 4 };
      if (hasWord(t, 'ferris', 'đu quay')) return { rotorStyle: 'wheel', rotorDia: 120, bladeCount: 8 };
      if (hasWord(t, 'waterwheel', 'paddle wheel')) return { rotorStyle: 'paddle', rotorDia: 90, bladeCount: 8 };
      return { rotorStyle: 'fan', rotorDia: 100, bladeCount: 5 };
    case 'linear': {
      const vertical = hasWord(t, 'lift', 'elevator', 'forklift', 'thang máy', 'xe nâng');
      return { linearOrient: vertical ? 'vertical' : 'horizontal', linearTool: hasWord(t, 'forklift', 'xe nâng') ? 'fork' : hasWord(t, 'camera', 'dolly') ? 'camera' : 'table', stroke: vertical ? 100 : 80 };
    }
    case 'scara':
      return { upperLen: 60, foreLen: 60 };
    default:
      return {};
  }
}

export function defaultSpec(archetype: string = 'rover'): RobotSpec {
  const t = archetype.toLowerCase();
  const isQuadruped = t.includes('quadruped') || t.includes('dog') || t.includes('chó') || t.includes('puppy') || t.includes('hound') || t.includes('cat');
  const isAgent = t.includes('agent') || t.includes('desk') || t.includes('stationary') || t.includes('stand') || t.includes('xiaozhi') || t.includes('zhaozhi');
  const isFeeder = t.includes('feeder') || t.includes('dispenser') || t.includes('máy cho ăn') || t.includes('thức ăn');
  const isTurntable = t.includes('turntable') || t.includes('platter') || t.includes('bàn xoay') || t.includes('scanner');
  const isGate = t.includes('gate') || t.includes('barrier') || t.includes('cổng');
  const isCrane = t.includes('crane') || t.includes('cần cẩu') || t.includes('digger');
  const isCatapult = t.includes('catapult') || t.includes('bắn đá');
  const isFan = t.includes('fan') || t.includes('quạt');
  const isMachine = isFeeder || isTurntable || isGate || isFan || isCrane || isCatapult || t.includes('machine') || t.includes('device');
  const family = mechanismFamily(archetype);
  const famName = ({ scara: 'Draw Bot', lever: isCatapult ? 'Mechanical Catapult' : 'Swing Lever', rotor: isFan ? 'Smart Fan' : 'Rotor Machine', linear: 'Linear Slider' } as Record<string, string>)[family ?? ''];

  const name = isFeeder ? 'Smart Pet Feeder'
    : isTurntable ? '360 Turntable'
    : isGate ? 'Smart Barrier Gate'
    : isCrane ? 'Robotic Crane'
    : isCatapult ? 'Mechanical Catapult'
    : isFan ? 'Smart Fan'
    : famName ? famName
    : isQuadruped ? 'CyberDog'
    : isAgent ? 'AI Desk Agent'
    : t.includes('arm') ? 'Desk Arm'
    : t.includes('companion') ? 'Buddy Bot'
    : t.includes('humanoid') || t.includes('biped') || t.includes('duck') ? 'Mini Biped'
    : t.includes('snake') || t.includes('serpent') || t.includes('rắn') || t.includes('ran') || t.includes('worm') ? 'Cyber Snake'
    : t.includes('rover') || t.includes('xe') || t.includes('car') ? 'Scout Rover'
    : archetype.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const primaryColor = isFeeder ? '#0284c7'
    : isTurntable ? '#6366f1'
    : isGate ? '#e11d48'
    : isCrane ? '#f59e0b'
    : isFan ? '#14b8a6'
    : family === 'scara' ? '#0ea5e9'
    : family === 'linear' ? '#f97316'
    : family ? '#14b8a6'
    : isQuadruped ? '#e06c75'
    : isAgent ? '#00b4d8'
    : t.includes('arm') ? '#ff7a1a'
    : t.includes('companion') ? '#22c3a6'
    : t.includes('humanoid') ? '#8e5cf0'
    : t.includes('snake') || t.includes('serpent') || t.includes('rắn') || t.includes('ran') ? '#2bb673'
    : '#4f8cff';

  const allowed = (behaviorsOf(archetype) ?? (isQuadruped ? BEHAVIORS.quadruped : isAgent || isMachine ? BEHAVIORS.desk_agent : DEFAULT_BEHAVIORS)).map(b => b.id);
  const base: RobotSpec = {
    version: 1,
    name,
    archetype,
    theme: isQuadruped ? 'dog' : 'classic',
    summary: '',
    params: {
      ...DEFAULT_PARAMS,
      headFeature: isQuadruped ? 'ears' : 'none',
      hasTail: isQuadruped,
      panTilt: isAgent || isMachine || t.includes('companion'),
      hasArms: false,
      legLen: isQuadruped ? 46 : DEFAULT_PARAMS.legLen,
      footLen: isQuadruped ? 30 : DEFAULT_PARAMS.footLen,
      footWidth: isQuadruped ? 22 : DEFAULT_PARAMS.footWidth,
      ...(family ? { panTilt: false } : {}),
      ...familyDefaults(archetype),
    },
    structural: 'PETG',
    shell: 'PLA+',
    primaryColor,
    accentColor: isQuadruped ? '#f59e0b' : '#f4f4f4',
    behaviors: allowed,
  };
  return base;
}

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
};
const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const MATS: Material[] = ['PETG', 'PLA+', 'ABS/ASA', 'TPU 95A', 'PA-CF'];

/** Clamp an untrusted spec into a buildable one. Returns the spec plus human-readable fixes. */
export function normalizeSpec(raw: any): { spec: RobotSpec; fixes: string[] } {
  const fixes: string[] = [];
  const archetype: string = typeof raw?.archetype === 'string' && raw.archetype.trim() ? raw.archetype.trim() : 'rover';
  const d = defaultSpec(archetype);
  const p = raw?.params ?? {};

  const rawTheme = raw?.theme ?? p?.theme;
  const theme: string = typeof rawTheme === 'string' && rawTheme.trim() ? rawTheme.trim().slice(0, 40) : 'classic';
  const headFeature: HeadFeature = ['none', 'beak', 'ears', 'visor', 'dome'].includes(p?.headFeature) ? p.headFeature : 'none';
  const footStyle: FootStyle = ['standard', 'webbed', 'wide'].includes(p?.footStyle) ? p.footStyle : 'standard';
  const hasTail = Boolean(p?.hasTail);
  const hasWings = Boolean(p?.hasWings);
  const mountType: MountType = ['none', 'phone_stand', 'magnetic_mount', 'camera_mount', 'pan_tilt_head', 'tablet_stand'].includes(p?.mountType) ? p.mountType : 'none';
  const hasMagnetPockets = Boolean(p?.hasMagnetPockets);
  const hasCableSlot = p?.hasCableSlot !== undefined ? Boolean(p.hasCableSlot) : true;

  const num = (k: keyof typeof RANGES) => {
    const v = clamp(p[k], RANGES[k], d.params[k] as number);
    if (typeof p[k] === 'number' && Math.abs(v - p[k]) > 1e-6) fixes.push(`${k} ${p[k]} → ${v} (allowed ${RANGES[k][0]}-${RANGES[k][1]})`);
    return k === 'leds' || k === 'bladeCount' ? Math.round(v) : Math.round(v * 2) / 2;
  };
  const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
  const params: RobotParams = {
    theme,
    headFeature,
    footStyle,
    hasTail,
    hasWings,
    mountType,
    mountAngle: num('mountAngle'),
    hasMagnetPockets,
    hasCableSlot,
    cradleWidth: num('cradleWidth'),
    cradleHeight: num('cradleHeight'),
    drive: p.drive === 'B-GM001' ? 'B-GM001' : 'B-PG002',
    wheelDia: num('wheelDia'), wheelWidth: num('wheelWidth'),
    tpuTires: p.tpuTires ?? d.params.tpuTires, bumper: p.bumper ?? d.params.bumper,
    panTilt: archetype === 'companion' ? true : archetype === 'arm' || mechanismFamily(archetype) ? false : !!p.panTilt,
    upperLen: num('upperLen'), foreLen: num('foreLen'), gripperLen: num('gripperLen'), payloadG: num('payloadG'),
    legLen: num('legLen'), footLen: num('footLen'), footWidth: num('footWidth'), armLen: num('armLen'),
    hasArms: typeof p.hasArms === 'boolean' ? p.hasArms : d.params.hasArms,
    leverLen: num('leverLen'), leverTool: pick(p.leverTool, ['boom', 'cup', 'flag', 'paddle'], d.params.leverTool), pivotH: num('pivotH'),
    rotorStyle: pick(p.rotorStyle, ['fan', 'windmill', 'wheel', 'paddle', 'carousel'], d.params.rotorStyle), rotorDia: num('rotorDia'), bladeCount: num('bladeCount'),
    stroke: num('stroke'), linearOrient: pick(p.linearOrient, ['horizontal', 'vertical'], d.params.linearOrient),
    linearTool: pick(p.linearTool, ['table', 'fork', 'camera'], d.params.linearTool),
    leds: num('leds'), headWidth: num('headWidth'),
  };
  let structural: Material = MATS.includes(raw?.structural) ? raw.structural : 'PETG';
  if (structural === 'PLA+' || structural === 'TPU 95A') {
    fixes.push(`structural material ${structural} → PETG (guide: never PLA for motor mounts; TPU is not rigid)`);
    structural = 'PETG';
  }
  const shell: Material = MATS.includes(raw?.shell) && raw.shell !== 'TPU 95A' ? raw.shell : 'PLA+';
  const composition = normalizeComposition(raw?.composition, fixes);
  const allowed = (composition.use
    ? [...BEHAVIORS.composer, ...(composition.mobility === 'wheels' ? BEHAVIORS.rover.filter(b => b.id !== 'look') : []),
      ...(composition.mobility === 'legs' ? [{ id: 'walk', label: 'Shuffle walk' }, { id: 'bow', label: 'Bow' }, { id: 'nod', label: 'Nod' }] : [])]
    : behaviorsOf(archetype) ?? DEFAULT_BEHAVIORS).map(b => b.id);
  const behaviors = Array.isArray(raw?.behaviors) && raw.behaviors.length ? raw.behaviors : allowed;

  return {
    spec: {
      version: 1,
      name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : d.name,
      archetype,
      theme,
      summary: typeof raw?.summary === 'string' ? raw.summary.slice(0, 600) : '',
      params, structural, shell,
      primaryColor: hex(raw?.primaryColor, d.primaryColor),
      accentColor: hex(raw?.accentColor, d.accentColor),
      behaviors: behaviors.length ? behaviors : allowed,
      ...(composition.use ? { composition } : {}),
      ...(PLATFORMS.includes(raw?.platform) && raw.platform !== 'cyberbrick' ? { platform: raw.platform as Platform } : {}),
    },
    fixes,
  };
}
