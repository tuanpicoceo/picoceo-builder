// Hardware design standard: how every CATALOG part is mounted / housed in printed CAD.
// Authority: CyberBrick guide (B-* parts, all FDM fits, holes, tunnels, battery bay). Other parts use
// published datasheet values where known; anything else is `source: 'estimated'` and listed in `unverified`.
// Human-readable version: docs/HARDWARE_DESIGN_STANDARD.md.
//
// Frame: envelope = CATALOG size [X, Y, Z]. Z is the part's "up" (component side of a PCB, shaft of a
// servo); -z is the underside that rests on the chassis. Hole patterns lie on `face` (default '-z').

import { CATALOG, type ComponentKind } from './components';
import { CLEARANCE, FIT, HOLES, bearingBore, type Material, type ProfileKey } from './rules';

export type MountMethod = 'screw_bosses' | 'ear_screws' | 'clamp' | 'cradle' | 'press_pocket' | 'strap' | 'glue_pocket' | 'edge_slot' | 'stack';
export type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export type HoleSize = 'M1_6' | 'M2' | 'M2_5' | 'M3' | 'M4';
export type FitKey = 'journal' | 'slide' | 'push' | 'press';
type V3 = [number, number, number];

export interface HolePattern {
  size: HoleSize;
  /** [du, dv] rectangle centred on the face, or explicit centres [[u, v], ...] from the face's min corner. */
  pitch: [number, number] | number[][];
  /** Face the pattern lies on (default '-z'). u,v axes: ±z -> (x,y), ±x -> (y,z), ±y -> (x,z). */
  face?: Face;
  /** Boss / standoff height under the part (0 = flush or through-bolt). */
  standoff: number;
  /** 'tap' = self-tap into printed boss (HOLES.tap); 'clear' = through-hole (HOLES.clear). */
  drill: 'tap' | 'clear';
}

export interface Keepout { face: Face; what: string; depth: number }

export interface MountStandard {
  id: string;
  source: 'guide' | 'datasheet' | 'estimated';
  envelope: V3;
  /** Envelope + fit allowance (push-fit +0.40 unless the guide gives an explicit pocket). */
  pocket: V3;
  /** Outer footprint on the hole face incl. ears / flanges, when larger than the envelope. */
  span?: [number, number];
  method: MountMethod;
  holes?: HolePattern;
  keepouts: Keepout[];
  cable: string;
  profile: ProfileKey;
  material: Material[];
  rules: string[];
  unverified?: string[];
}

/** M1.6 is not in the guide (s.5); values extrapolated from the M2 row. */
export const EXTRA_HOLES = { M1_6: { clear: 1.9, tap: 1.3, minWall: 1.2, tunnel: 5.0 } };

export function holeDia(h: HolePattern): number {
  const t = h.size === 'M1_6' ? EXTRA_HOLES.M1_6 : HOLES[h.size];
  return h.drill === 'tap' ? t.tap : t.clear;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const grow = (v: V3, d: V3): V3 => [r2(v[0] + d[0]), r2(v[1] + d[1]), r2(v[2] + d[2])];
const env = (id: string): V3 => (CATALOG[id]?.size ?? [0, 0, 0]) as V3;
const PUSH: V3 = [FIT.push, FIT.push, FIT.push];
/** Battery bay: +1.0 width, +1.5 length (s.11), +0.5 height for the trough lift. */
const SWELL: V3 = [CLEARANCE.batterySwellWid, CLEARANCE.batterySwellLen, 0.5];
const MAG: V3 = [FIT.magnetD - 4, FIT.magnetD - 4, FIT.magnetH - 2];   // +0.20 / +0.20

const STRUCT: Material[] = ['PETG', 'ABS/ASA'];
const MOTOR: Material[] = ['PETG', 'ABS/ASA', 'PA-CF'];
const SHELL: Material[] = ['PETG', 'PLA+'];
const ANTENNA = 'PCB antenna: no metal, screws or PA-CF (conductive carbon) within 5 mm';
const TUNNEL = 'Any fastener behind a wall gets a Ø6.5 line-of-sight driver tunnel (s.6)';

type Def = Omit<MountStandard, 'id' | 'envelope' | 'pocket'> & { pocket?: V3 };
const def = (id: string, d: Def): MountStandard => ({ id, envelope: env(id), ...d, pocket: d.pocket ?? grow(env(id), PUSH) });

// ---------------------------------------------------------------- shared definitions
const cbServo = (id: string, extra: string[]): MountStandard => def(id, {
  source: 'guide', method: 'ear_screws', span: [32.4, 12.0],
  holes: { size: 'M2', pitch: [27.8, 0], standoff: 0, drill: 'tap' },
  keepouts: [
    { face: '+z', what: '21T Ø4.8 spline + horn; horn arm sweeps R16.2 around the shaft', depth: 12 },
    { face: '-x', what: 'Servo lead exit at the case end', depth: 6 },
  ],
  cable: '3-pin lead [GND, 5V, PWM] to S1-S4; 6 x 10 slot down through the deck, no pinch at the pocket edge',
  profile: 'motorMount', material: MOTOR,
  rules: [
    'Through-pocket 23.2 x 12.4 (22.8 x 12.0 + 0.40 push-fit); ears rest on the plate',
    '2x M2 self-tap, Ø1.7 tap holes on 27.8 pitch (ear span 32.4); boss wall ≥1.4 mm',
    'Horn seat: recess for the 21T Ø4.8 spline hub + arm; centre screw through a Ø6.5 tunnel; horn pilots M2 tap',
    'Horizontal shaft: never trap between closed bulkheads; two vertical ear pillars (front/rear) with outer Ø6.5 tunnels (s.6)',
    'PETG/ABS mounts only; motorMount profile (0.16 mm, 5 walls, 45 % gyroid)',
    ...extra,
  ],
  unverified: ['Shaft offset 5.9 mm from the case end and the 18.4 / 4.3 mm below / above-ear split are CAD values (src/cad/modules.ts), not in the guide'],
});

const hobbyServo = (id: string, span: [number, number], src: MountStandard['source']): MountStandard => def(id, {
  source: src, method: 'ear_screws', span,
  holes: { size: 'M2', pitch: [27.8, 0], standoff: 0, drill: 'tap' },
  keepouts: [
    { face: '+z', what: 'Ø4.8 21T spline + horn sweep', depth: 12 },
    { face: '-x', what: 'Servo lead exit', depth: 6 },
  ],
  cable: '3-pin servo lead (brown GND, red V+, orange signal); 6 x 10 deck slot',
  profile: 'motorMount', material: MOTOR,
  rules: [
    'Same 9 g footprint as B-PG001: through-pocket body + 0.40, M2 self-tap ears on 27.8 pitch',
    'Ear pitch varies ±0.5 mm between vendors: elongate the ear holes 1.0 mm along X',
    'Ø6.5 driver tunnels to ear and horn screws (s.6)',
  ],
  unverified: ['Ear span / pitch are typical vendor values, measure your batch'],
});

const piHoles = (yTop: number): HolePattern => ({ size: 'M2_5', pitch: [[3.5, 3.5], [61.5, 3.5], [3.5, yTop], [61.5, yTop]], standoff: 5, drill: 'tap' });
const UNO_HOLES: number[][] = [[13.97, 2.54], [15.24, 50.8], [66.04, 7.62], [66.04, 35.56]];

const cradle = (id: string, extra: string[], src: MountStandard['source'], unverified?: string[]): MountStandard => def(id, {
  source: src, method: 'cradle', pocket: grow(env(id), SWELL),
  keepouts: [
    { face: '-y', what: 'Lead / BMS end: 10 x 6 egress slot in the rear wall', depth: 4 },
    { face: '+z', what: '2.8 mm cross-strap + lift-out access', depth: 3 },
  ],
  cable: 'Leads exit a 10 x 6 rear-wall slot straight toward the switch, no sharp bends (s.11)',
  profile: 'chassis', material: STRUCT,
  rules: [
    'Isolated bay: no motor, servo ear or bulkhead inside the bay volume (s.11)',
    'Swell margin +1.5 length, +1.0 width (s.11)',
    'Finger reliefs Ø18-24 on the left/right walls',
    'Rigid 2.8 mm cross-strap, 2x M2.5 into bosses fully outside the bay (|X| ≥ bay half-width + 2.0)',
    'Subtract the cavity after all bosses are unified (s.12 #2)',
    ...extra,
  ],
  ...(unverified ? { unverified } : {}),
});

// ---------------------------------------------------------------- the standard
const LIST: MountStandard[] = [
  // ---- CyberBrick (guide)
  def('B-XA003', {
    source: 'guide', method: 'stack',
    keepouts: [
      { face: '+z', what: ANTENNA, depth: 5 },
      { face: '-y', what: 'USB-C: open window ≥12 x 7 for the plug', depth: 20 },
    ],
    cable: 'Plugs onto the B-XA004 female 1.27 mm header; USB-C for flashing only',
    profile: 'chassis', material: SHELL,
    rules: [
      'Never screwed: stacks on B-XA004; reserve 11.2 + 1.0 mm above the shield top',
      'Keep a USB-C access window through any shell on the port side',
    ],
    unverified: ['USB-C and antenna faces are not given in the guide'],
  }),
  def('B-XA004', {
    source: 'guide', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [23.0, 24.0], standoff: 4, drill: 'tap' },
    keepouts: [{ face: '+z', what: 'B-XA003 core stack (11.2) + header plugs', depth: 13 }],
    cable: 'Servo leads S1-S4 and the XH2.54 battery lead: ≥4.0 mm routing gap around the stack, 10 x 6 deck pass-through',
    profile: 'chassis', material: STRUCT,
    rules: [
      '4x M2.5 self-tap (Ø2.15) on 23.0 x 24.0 pitch; bosses Ø5.8, 4 mm high so solder joints clear the deck',
      'Input 6.0-9.0 V only: 2S packs (B-PC003, BAT-18650-2S); 1S cells need a boost converter',
      TUNNEL,
    ],
  }),
  cbServo('B-PG001', ['Positional 180°: check the horn arc against the body over the full travel']),
  cbServo('B-PG002', ['Continuous: wheel / platter hubs sit on the horn; idler sides use a journal bore = shaft + 0.40']),
  def('B-GM001', {
    source: 'guide', method: 'clamp',
    keepouts: [
      { face: '+x', what: 'Ø3.0 D-shaft (flat 2.5) + wheel hub', depth: 12 },
      { face: '-x', what: 'Motor terminals + leads', depth: 6 },
    ],
    cable: '2-wire leads to the shield motor port (M1/M2 assumed); ≥4.0 mm routing gap',
    profile: 'motorMount', material: MOTOR,
    rules: [
      'Push-fit saddle 38.4 x 15.9 (+0.40) around the gearbox, closed by a 2.8 mm strap with 2x M2.5 into bosses',
      'Hub D-bore: Ø3.0 + 0.05 press, or Ø3.0 + 0.40 with an M3 set screw on the flat (captive nut 5.6 AF)',
      'PETG/ABS only: motors run 45-60 °C (s.9)',
    ],
    unverified: ['Shaft position and mounting holes are not in the guide (shaft assumed axial, centred on the 15.5 x 12 end face)'],
  }),
  cradle('B-PC003', [
    'Cradle space 34.0 x 56.5 (guide s.3) = bay 29.4 x 52.7 + 2.0 walls',
    'Twin half-cylinder troughs R = 7.1 + 0.5 = 7.6 for the two 14500 cells',
  ], 'guide'),
  def('B-XA007', {
    source: 'guide', method: 'ear_screws',
    holes: { size: 'M2_5', pitch: [[2.0, 7.0]], standoff: 0, drill: 'tap' },
    keepouts: [{ face: '+z', what: 'Slide actuator, 4.0 mm stroke: open slot = knob + 4.0 + 0.40', depth: 6 }],
    cable: 'XH2.54 2-pin inline pass-through: battery in, shield out; 10 x 6 deck pass-through',
    profile: 'chassis', material: STRUCT,
    rules: [
      'Push-fit cradle walls (+0.40) around the 20.5 x 14.0 base, 1x M2.5 self-tap through the ear',
      'Actuator reachable from outside the shell without opening it',
      'Rated 0.5 A: put it only on the battery lead',
      TUNNEL,
    ],
    unverified: ['Ear position not in the guide (assumed at the -x end, centred)'],
  }),
  def('B-XA006', {
    source: 'guide', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [[14.0, 3.0]], standoff: 3, drill: 'tap' },
    keepouts: [{ face: '+z', what: '6x JST-SH 1.0 branch headers: plug access', depth: 8 }],
    cable: 'D1 port from the shield in; 6 JST-SH 3-pin branches to the LEDs',
    profile: 'chassis', material: SHELL,
    rules: [
      'Single M2.5 centre boss Ø5.8, 3 mm high (self-tap Ø2.15)',
      'Add 1 mm locating ribs on both long sides: one screw does not stop rotation',
    ],
    unverified: ['Header face not given in the guide'],
  }),
  def('B-KB003', {
    source: 'guide', method: 'press_pocket', pocket: [6.6, 6.6, 3.0],
    keepouts: [{ face: '+z', what: 'Light window Ø4.5 through a 1.0 mm skin (top-mounted: Ø3.0)', depth: 1 }],
    cable: '3-wire daisy-chain ribbon from the back; 3 mm wire channel to the hub',
    profile: 'shell', material: SHELL,
    rules: [
      'Pocket 6.6 x 6.6 (guide s.3) cut from the inside, leaving a 1.0 mm front skin',
      'Retain with CA or hot glue; no screws',
      'Light-coloured PETG / PLA+ diffuses best; avoid PA-CF',
    ],
  }),

  // ---- From the architecture doc
  cradle('B-BA001', [
    'Pouch: no screws, sharp edges or point loads; retain with the strap or a slide-in lid (slot = tongue + 0.40)',
    '+0.5 mm thickness margin for pouch swell',
    '1S 3.7 V cannot feed B-XA004 (6-9 V): add a boost converter, or use in XIAO-class 3.7 V builds',
  ], 'estimated', ['Size 30 x 35 x 5.5 (503035 class) and JST-PH connector are estimates; the arch doc gives only 3.7 V 500 mAh']),
  def('B-XL001', {
    source: 'datasheet', method: 'press_pocket',
    keepouts: [{ face: '+z', what: 'Light window Ø4.0 through a 1.0 mm skin', depth: 1 }],
    cable: '4 pads (DIN, 5V, GND, DOUT): 3 mm wire channel behind the pocket',
    profile: 'shell', material: SHELL,
    rules: [
      'Pocket = 5.0 x 5.0 + 0.40 for the bare 5050 package; for a breakout PCB use breakout size + 0.40',
      'Glue only; never press on the lens',
    ],
    unverified: ['Breakout / matrix form factor not specified by the arch doc'],
  }),

  // ---- SBCs & controllers
  def('RPI-4B', {
    source: 'datasheet', method: 'screw_bosses', holes: piHoles(52.5),
    keepouts: [
      { face: '+x', what: '2x USB 3.0 + 2x USB 2.0 + RJ45 plugs', depth: 25 },
      { face: '-y', what: 'USB-C power + 2x micro-HDMI', depth: 20 },
      { face: '-x', what: 'microSD (underside, protrudes ~2.5 mm)', depth: 5 },
      { face: '+z', what: 'SoC heat: vent / heatsink / fan; GPIO + HAT stack', depth: 12 },
    ],
    cable: 'USB-C 5 V 3 A; 40-pin GPIO on the +y edge; leave the port edges open',
    profile: 'chassis', material: STRUCT,
    rules: [
      'M2.5 on 58 x 49, holes 3.5 mm from the edges (official drawing); self-tap Ø2.15 bosses',
      'Standoffs ≥5 mm (underside parts, airflow); M2.5 x 11 between Pi and HAT',
      'Vent slots over the SoC; no PLA+ near it (SoC runs 60-80 °C)',
    ],
  }),
  def('RPI-5', {
    source: 'datasheet', method: 'screw_bosses', holes: piHoles(52.5),
    keepouts: [
      { face: '+x', what: '2x USB 3.0 + 2x USB 2.0 + RJ45 plugs', depth: 25 },
      { face: '-y', what: 'USB-C PD + 2x micro-HDMI + power button', depth: 20 },
      { face: '-x', what: 'microSD (underside) + PCIe FFC', depth: 8 },
      { face: '+z', what: 'Active Cooler fan intake + vents', depth: 12 },
    ],
    cable: 'USB-C PD 5 V 5 A; 40-pin GPIO on the +y edge; PCIe FFC on the -x edge',
    profile: 'chassis', material: STRUCT,
    rules: [
      'Same 58 x 49 M2.5 pattern as Pi 4B, 3.5 mm from the edges',
      'Active cooling needed under load: open area above the fan ≥ fan diameter, exhaust vents on the side',
      'Standoffs ≥5 mm; ABS/ASA or PETG near the SoC',
    ],
  }),
  def('RPI-ZERO-2W', {
    source: 'datasheet', method: 'screw_bosses', holes: { ...piHoles(26.5), standoff: 3 },
    keepouts: [
      { face: '-y', what: 'mini-HDMI + 2x micro-USB', depth: 15 },
      { face: '-x', what: 'microSD', depth: 4 },
      { face: '+x', what: 'CSI camera FFC', depth: 8 },
    ],
    cable: 'Micro-USB power; 40-pin footprint on the +y edge (unpopulated)',
    profile: 'chassis', material: SHELL,
    rules: ['M2.5 on 58 x 23, holes 3.5 mm from the edges; self-tap Ø2.15 bosses, 3 mm standoffs'],
  }),
  def('ESP32-DEV', {
    source: 'estimated', method: 'edge_slot',
    keepouts: [
      { face: '+x', what: ANTENNA, depth: 5 },
      { face: '-x', what: 'USB connector + plug', depth: 20 },
      { face: '-z', what: 'Header pins (2x15, 2.54)', depth: 9 },
    ],
    cable: 'Dupont leads on the header pins; USB for power/flashing',
    profile: 'chassis', material: SHELL,
    rules: [
      'Most V1 boards have no holes: slide the PCB into two side grooves (PCB 1.6 + 0.40 slide-fit) or plug into female headers on a carrier',
      'Leave 1.0 mm free around the header rows for the Dupont housings',
    ],
    unverified: ['No standard hole pattern; header row spacing varies by vendor (25.4 mm typical)'],
  }),
  def('XIAO-ESP32-C3', {
    source: 'datasheet', method: 'edge_slot',
    keepouts: [
      { face: '+x', what: 'USB-C plug', depth: 20 },
      { face: '-x', what: 'U.FL external antenna lead; stick the FPC antenna on a non-metal wall', depth: 5 },
      { face: '-z', what: 'Battery pads (underside)', depth: 2 },
    ],
    cable: 'Castellated / 2x7 2.54 pins; LiPo on the underside pads',
    profile: 'shell', material: SHELL,
    rules: [
      'No holes: slide-in slot 21.4 x 17.9 with a 1.0 mm lip over the PCB edge, or solder to a carrier',
      'FPC antenna ≥5 mm from motors, batteries and PA-CF',
    ],
  }),
  def('XIAO-ESP32-S3', {
    source: 'datasheet', method: 'edge_slot',
    keepouts: [
      { face: '+x', what: 'USB-C plug', depth: 20 },
      { face: '-x', what: 'U.FL antenna lead', depth: 5 },
      { face: '+z', what: 'Sense camera / mic expansion board + lens FOV', depth: 10 },
    ],
    cable: 'Castellated / 2x7 2.54 pins; B2B connector for the Sense board',
    profile: 'shell', material: SHELL,
    rules: [
      'Same slide-in slot as XIAO-ESP32-C3 (21.4 x 17.9, 1.0 mm lip)',
      'Sense: open lens window and a Ø1.5 mic port in front of the expansion board',
    ],
    unverified: ['Sense expansion board height (10 mm keep-out) is an estimate'],
  }),
  def('ZHAOZHI-AI-CORE', {
    source: 'estimated', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [32.0, 32.0], standoff: 4, drill: 'tap' },
    keepouts: [
      { face: '+z', what: 'Dual MEMS mic ports: Ø1.5 openings, gasketed', depth: 2 },
      { face: '-x', what: 'USB-C plug', depth: 20 },
      { face: '+x', what: 'Speaker JST-ZH + LCD header', depth: 8 },
    ],
    cable: 'USB-C power; 4-pin JST-ZH speaker; SPI LCD header',
    profile: 'shell', material: SHELL,
    rules: [
      'Mic ports open to the outside, acoustically sealed from the speaker chamber',
      'Keep the speaker ≥20 mm from the mics or behind a separate wall',
    ],
    unverified: ['Board variant specific; 32 x 32 M2.5 pattern taken from the CAD model'],
  }),
  def('JETSON-ORIN-NANO', {
    source: 'estimated', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [86.0, 58.0], standoff: 6, drill: 'tap' },
    keepouts: [
      { face: '+z', what: 'Heatsink fan intake', depth: 15 },
      { face: '+x', what: 'USB 3.2 x4, RJ45, DisplayPort plugs', depth: 25 },
      { face: '-y', what: 'DC barrel 9-20 V', depth: 20 },
    ],
    cable: 'DC barrel 9-20 V; 40-pin GPIO on the +y edge',
    profile: 'chassis', material: ['ABS/ASA', 'PETG', 'PA-CF'],
    rules: [
      'Heavy (145 g): mount low on the chassis base, 4+ walls',
      'Fan intake open area ≥ fan diameter + exhaust vents; ABS/ASA preferred (hot)',
    ],
    unverified: ['Carrier hole pattern (86 x 58, M2.5) is the commonly cited Jetson Nano dev-kit value: verify'],
  }),
  def('ARDUINO-UNO', {
    source: 'datasheet', method: 'screw_bosses',
    holes: { size: 'M3', pitch: UNO_HOLES, standoff: 5, drill: 'tap' },
    keepouts: [
      { face: '-x', what: 'USB-B / USB-C + DC barrel jack (USB-B overhangs ~6 mm)', depth: 20 },
      { face: '+z', what: 'Shield stack on the headers', depth: 15 },
    ],
    cable: 'USB or DC jack 7-12 V on the -x edge; female headers on top',
    profile: 'chassis', material: SHELL,
    rules: [
      'Official Uno hole centres (mm from the -x/-y corner): (13.97, 2.54), (15.24, 50.8), (66.04, 7.62), (66.04, 35.56); Ø3.2 holes',
      'M3 self-tap Ø2.6 bosses Ø7.0, 5 mm high (THT leads underneath)',
    ],
  }),
  def('RPI-PICO-W', {
    source: 'datasheet', method: 'screw_bosses',
    holes: { size: 'M2', pitch: [[2.0, 4.8], [49.0, 4.8], [2.0, 16.2], [49.0, 16.2]], standoff: 3, drill: 'tap' },
    keepouts: [
      { face: '-x', what: 'USB plug', depth: 20 },
      { face: '+x', what: 'Pico W antenna end: ' + ANTENNA, depth: 5 },
    ],
    cable: '40 castellated / 2.54 pins; or plug into a carrier socket',
    profile: 'shell', material: SHELL,
    rules: ['4x Ø2.1 holes on 47 x 11.4: M2 self-tap Ø1.7 bosses, 3 mm high'],
  }),
  def('ESP32-S3-DEVKIT', {
    source: 'estimated', method: 'edge_slot',
    keepouts: [
      { face: '+x', what: ANTENNA, depth: 5 },
      { face: '-x', what: '2x USB-C plugs', depth: 20 },
      { face: '-z', what: 'Header pins (2x22, 2.54)', depth: 9 },
    ],
    cable: 'Dupont leads on the header pins; USB-C for power/flashing',
    profile: 'chassis', material: SHELL,
    rules: ['No mounting holes: side grooves (1.6 + 0.40) or female headers on a carrier'],
    unverified: ['Mounting depends on carrier; no official hole pattern'],
  }),
  def('MICROBIT-V2', {
    source: 'datasheet', method: 'edge_slot',
    keepouts: [
      { face: '-y', what: 'Edge connector into its socket', depth: 10 },
      { face: '+z', what: 'LED matrix, buttons A/B, touch logo, mic hole: keep visible / reachable', depth: 3 },
      { face: '+y', what: 'micro-USB + JST-PH battery', depth: 20 },
    ],
    cable: 'Edge connector (socket on the robot board); JST-PH battery',
    profile: 'shell', material: SHELL,
    rules: [
      'Hold by the edge-connector socket + a rear clip; the shell opens over the front face',
      'Bolting through the 5 ring pads makes electrical contact: only with that intent',
    ],
  }),

  // ---- Actuators
  hobbyServo('SG90-SERVO', [32.5, 11.8], 'datasheet'),
  hobbyServo('MG90S-SERVO', [32.5, 12.2], 'estimated'),
  def('N20-MOTOR', {
    source: 'datasheet', method: 'clamp',
    holes: { size: 'M1_6', pitch: [9.0, 0], face: '+x', standoff: 0, drill: 'clear' },
    keepouts: [
      { face: '+x', what: 'Ø3 D-shaft (10 mm) + hub', depth: 12 },
      { face: '-x', what: 'Motor terminals / encoder', depth: 8 },
    ],
    cable: '2-wire leads (or 6-pin encoder) from the -x end; ≥4.0 mm routing gap',
    profile: 'motorMount', material: MOTOR,
    rules: [
      'Face plate ≥2 mm with 2x M1.6 clearance holes Ø1.9 on 9 mm pitch beside the shaft; Ø4.5 relief for the shaft boss',
      'Push-fit saddle (+0.40) under the gearbox / can, closed by a strap',
      'PETG/ABS only',
    ],
    unverified: ['M1.6 hole sizes extrapolated (not in guide s.5)'],
  }),
  def('TT-MOTOR', {
    source: 'estimated', method: 'clamp',
    holes: { size: 'M3', pitch: [17.5, 0], face: '+y', standoff: 0, drill: 'clear' },
    keepouts: [
      { face: '+y', what: 'Output shaft Ø5.4 (flats 3.6) + wheel hub', depth: 12 },
      { face: '-y', what: 'Second output shaft', depth: 12 },
    ],
    cable: '2-wire leads from the motor can end',
    profile: 'motorMount', material: MOTOR,
    rules: [
      '2x M3 x 30 through-bolts across the gearbox into captive M3 nuts (5.6 AF x 2.6)',
      'Pocket for the locating nub beside the shaft; saddle the motor can',
    ],
    unverified: ['Through-hole pitch (17.5 mm) and nub position vary by vendor'],
  }),

  // ---- Audio
  def('ZHAOZHI-SPEAKER-MOD', {
    source: 'estimated', method: 'cradle',
    keepouts: [
      { face: '+z', what: 'Speaker front: grille ≥30 % open area over the cone', depth: 2 },
      { face: '-z', what: 'Sealed back chamber: do not vent', depth: 0 },
    ],
    cable: 'JST-PH 2.0 4-pin (I2S + 5 V)',
    profile: 'shell', material: SHELL,
    rules: [
      'Push-fit cradle (+0.40) + strap or glue; 0.5-1 mm gasket lip between cone rim and grille (no rattle)',
      'Mic port acoustically separated from the speaker (≥20 mm or own wall)',
    ],
    unverified: ['Module outline and fixing points not published'],
  }),
  def('SPK-8OHM-2W', {
    source: 'estimated', method: 'press_pocket',
    keepouts: [{ face: '+z', what: 'Sound port: grille ≥30 % open area', depth: 2 }],
    cable: '2-wire JST-1.25 or pads',
    profile: 'shell', material: SHELL,
    rules: ['Push-fit pocket (+0.40), seal the front to the grille, strap or glue at the back'],
    unverified: ['Ear / sound-port position varies by vendor'],
  }),
  def('SPK-MICRO-1W', {
    source: 'estimated', method: 'glue_pocket',
    keepouts: [{ face: '+z', what: 'Sound port: grille ≥30 % open area', depth: 2 }],
    cable: '2-pin micro connector',
    profile: 'shell', material: SHELL,
    rules: ['Push-fit pocket (+0.40), glue the rim to the grille wall'],
    unverified: ['Sound-port position varies by vendor'],
  }),

  // ---- Batteries
  cradle('BAT-18650-1S', [
    'Protected 18650 cells are up to 69-70 mm long: bay length 70 + 1.5 = 71.5',
    'Single trough R = 9.25 + 0.5 = 9.75',
  ], 'datasheet'),
  cradle('BAT-18650-2S', [
    'Protected cells up to 69-70 mm: bay length 71.5',
    'Twin troughs R = 9.25 + 0.5 = 9.75',
  ], 'datasheet'),
  cradle('BAT-1S2P-14500', [
    'Same bay as B-PC003: 29.4 x 52.7 with twin R 7.6 troughs, strap on bosses outside the bay',
    'Lead to the PicoClaw board BAT pads (JST-PH); route it with the Claw cable bundle',
  ], 'estimated'),
  cradle('BAT-LIPO-1S-1000', [
    'Pouch: no screws, sharp edges or point loads; flat floor, strap or slide-in lid',
    '+0.5 mm thickness margin for pouch swell',
  ], 'datasheet'),

  // ---- Shields
  def('SHIELD-RPI-ROBOT', {
    source: 'estimated', method: 'stack', holes: { ...piHoles(52.5), standoff: 11 },
    keepouts: [
      { face: '+z', what: 'Servo headers + motor screw terminals (screwdriver access)', depth: 15 },
      { face: '-y', what: 'Motor / power terminal wires', depth: 10 },
    ],
    cable: '8x servo leads, 4x motor pairs, 6-12 V power terminal',
    profile: 'chassis', material: STRUCT,
    rules: ['HAT on the Pi 58 x 49 pattern with M2.5 x 11 standoffs; screws into the Pi bosses below'],
    unverified: ['Generic HAT; terminal positions vary'],
  }),
  def('LICHEERV-NANO-W', {
    source: 'datasheet', method: 'stack',
    keepouts: [
      { face: '-y', what: 'USB-C (power + USB network) on the short edge: plug + bend radius', depth: 25 },
      { face: '-z', what: 'TF card slot (underside, short edge): card must slide out', depth: 15 },
      { face: '+x', what: 'WiFi 6 / BLE antenna area: no metal, motors or PA-CF within 5 mm', depth: 5 },
    ],
    cable: 'USB-C from the bottom of the Claw stack; 2 x 14 castellated edges carry the PicoClaw board',
    profile: 'shell', material: SHELL,
    rules: [
      'No mounting holes (castellated / half-hole edges): carry it on the PicoClaw board, or a 23.3 x 36.0 slot with a 1 mm lip',
      'Keep the TF slot reachable: the OS image lives on the card',
      'Onboard mic: leave a Ø2 sound port in the case wall in front of it',
    ],
    unverified: ['Stack height 5 mm (TF slot) and antenna position estimated from photos'],
  }),
  def('PICOCLAW-BOARD', {
    source: 'estimated', method: 'cradle',
    keepouts: [
      { face: '+y', what: 'LCD: 27.7 x 27.7 active window; frame the glass, never press it', depth: 2 },
      { face: '-x', what: 'Left side key: 6 x 6 access hole or a printed plunger', depth: 4 },
      { face: '+x', what: 'Right side key: 6 x 6 access hole or a printed plunger', depth: 4 },
      { face: '-y', what: 'Bottom edge: USB-C, ON/OFF slide switch, 2 status LEDs', depth: 20 },
    ],
    cable: 'Battery (1S LiPo) and speaker JST leads from the back; USB-C exits the bottom edge',
    profile: 'shell', material: SHELL,
    rules: [
      'Cradle the 30.5 x 38.5 stack (+0.40 push fit) upright behind a 28 x 28 LCD window, 1 mm bezel lip holds the glass edge',
      'Leave the side keys, the ON/OFF switch and the USB-C reachable from outside the case',
      'Speaker: sealed back volume, grille ≥ 30 % open area in front of the cone',
    ],
    unverified: ['Board outline, LCD position and key positions are estimated from Sipeed photos; measure before printing'],
  }),
  def('PCA9685-SERVO-16', {
    source: 'datasheet', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [55.9, 19.1], standoff: 4, drill: 'tap' },
    keepouts: [
      { face: '+z', what: '16 servo headers + V+ screw terminal: plugs and screwdriver', depth: 14 },
      { face: '-x', what: 'I2C / power header (6-pin)', depth: 10 },
    ],
    cable: '4-wire I2C to the Nano header (SDA, SCL, 3V3, GND); separate 5 V servo supply on the V+ terminal',
    profile: 'chassis', material: STRUCT,
    rules: ['4 x M2.5 self-tap bosses, 4 mm standoffs; may hang under a deck (headers down) with ≥ 4 mm cable gap'],
    unverified: ['Hole pitch 55.9 x 19.1 follows the common Adafruit board; clones vary'],
  }),
  def('SHIELD-ESP32-SERVO', {
    source: 'estimated', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [48.0, 48.0], standoff: 5, drill: 'tap' },
    keepouts: [
      { face: '+z', what: '16 servo plugs + power terminal screwdriver', depth: 15 },
    ],
    cable: '16x 3-pin servo leads; 2-pin screw terminal for servo power',
    profile: 'chassis', material: STRUCT,
    rules: ['M2.5 self-tap bosses 5 mm high; ≥4.0 mm cable-route gap on the header side'],
    unverified: ['Hole pattern (3 mm inset) taken from the CAD model'],
  }),
  def('SHIELD-ARDUINO-MOTOR', {
    source: 'datasheet', method: 'stack',
    holes: { size: 'M3', pitch: UNO_HOLES, standoff: 5, drill: 'tap' },
    keepouts: [
      { face: '+z', what: 'Driver heatsink: vents above', depth: 10 },
      { face: '-x', what: 'Motor screw terminals', depth: 10 },
    ],
    cable: '4x motor pairs + external 5-12 V terminal',
    profile: 'chassis', material: STRUCT,
    rules: ['Stacks on the Uno headers; shares the Uno hole pattern (screws through both boards)', 'Vent over the driver heatsink'],
  }),
  def('SHIELD-PICO-ROBOT', {
    source: 'estimated', method: 'screw_bosses', holes: piHoles(52.5),
    keepouts: [
      { face: '+z', what: 'Pico socket + servo headers + on/off switch', depth: 15 },
      { face: '-y', what: 'Motor screw terminals', depth: 10 },
    ],
    cable: '8x servo leads, 4x motor pairs, terminal-block power 3-11 V',
    profile: 'chassis', material: STRUCT,
    rules: ['M2.5 self-tap bosses 5 mm high', 'On/off switch reachable from outside the shell'],
    unverified: ['Hole pattern (3.5 mm inset) taken from the CAD model'],
  }),

  // ---- Sensors, displays, cameras
  def('HC-SR04', {
    source: 'datasheet', method: 'press_pocket',
    holes: { size: 'M2', pitch: [41.0, 16.0], standoff: 0, drill: 'tap' },
    keepouts: [
      { face: '+z', what: 'Ø16 transducers on 26 mm centres: front holes Ø16.5; 15° beam, no lip in the cone', depth: 50 },
      { face: '-y', what: '4-pin header + Dupont plug', depth: 12 },
    ],
    cable: '4-pin 2.54 header (VCC, Trig, Echo, GND)',
    profile: 'shell', material: SHELL,
    rules: [
      'Front plate with 2x Ø16.5 holes on 26 mm centres; transducer faces flush or ≤1 mm recessed',
      'Retain the PCB with a back clip or 4 corner screws',
    ],
    unverified: ['Corner hole pitch 41 x 16 is typical, not datasheet'],
  }),
  def('OLED-SSD1306', {
    source: 'datasheet', method: 'screw_bosses',
    holes: { size: 'M2', pitch: [23.5, 23.8], standoff: 2, drill: 'tap' },
    keepouts: [
      { face: '+z', what: 'Glass: window ≥ active area 21.7 x 10.9 + 0.5 each side; glass recess', depth: 2 },
      { face: '+y', what: '4-pin header + Dupont plug', depth: 12 },
    ],
    cable: '4-pin 2.54 header (GND, VCC, SCL, SDA)',
    profile: 'shell', material: SHELL,
    rules: [
      'Mount from behind a bezel: M2 self-tap Ø1.7 on ~23.5 x 23.8',
      'Glass is fragile: no screw clamping on the glass, 0.2 mm gap around it',
    ],
    unverified: ['Hole pitch and window offset vary by vendor (±0.5 mm)'],
  }),
  def('MPU-6050', {
    source: 'datasheet', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [[2.8, 2.8], [17.7, 2.8]], standoff: 3, drill: 'tap' },
    keepouts: [{ face: '+y', what: '8-pin header + Dupont plug', depth: 12 }],
    cable: '8-pin 2.54 header; I2C only needs VCC, GND, SCL, SDA',
    profile: 'chassis', material: STRUCT,
    rules: [
      'GY-521: 2x Ø3 holes, M2.5 self-tap Ø2.15; rigid mount, axes aligned with the robot frame',
      'Near the centre of mass / pivot axis; ≥10 mm from motor cans (heat drift)',
    ],
    unverified: ['Hole centres taken from the CAD model'],
  }),
  def('RPI-CAMERA-V2', {
    source: 'datasheet', method: 'screw_bosses',
    holes: { size: 'M2', pitch: [[2.0, 9.5], [23.0, 9.5], [2.0, 22.0], [23.0, 22.0]], standoff: 2, drill: 'tap' },
    keepouts: [
      { face: '+z', what: 'Lens FOV 62.2° x 48.8°: window ≥ Ø8 and no lip in the cone', depth: 20 },
      { face: '-y', what: '15-pin FFC: exit slot 17 x 2, no sharp fold', depth: 10 },
    ],
    cable: '15-pin 1.0 mm FFC to the Pi CSI port',
    profile: 'cantilever', material: SHELL,
    rules: [
      'M2 on 21 x 12.5, holes 2.0 mm from the side edges; self-tap Ø1.7 bosses 2 mm high',
      'Camera masts: print on the side (cantilever profile, s.7)',
    ],
    unverified: ['Lens centre offset from the hole pattern: measure before cutting the window'],
  }),
  def('VL53L0X-TOF', {
    source: 'estimated', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [[2.5, 6.5]], standoff: 2, drill: 'tap' },
    keepouts: [{ face: '+z', what: '25° FOV cone: open aperture, or IR-clear cover touching the sensor', depth: 30 }],
    cable: '6-pin 2.54 header (VIN, GND, SCL, SDA, XSHUT, GPIO1)',
    profile: 'shell', material: SHELL,
    rules: ['No printed lip in the FOV cone (cross-talk); dark matte aperture walls'],
    unverified: ['Breakout outline / hole positions vary by vendor'],
  }),

  // ---- Voice-robot hardware (src/cad/voicecore.ts places these in the voice core)
  def('JETSON-NANO', {
    source: 'datasheet', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [86.0, 58.0], standoff: 6, drill: 'tap' },
    keepouts: [
      { face: '-y', what: 'I/O edge: DC barrel 5 V 4 A, micro-USB, 4x USB 3.0, HDMI, DP, RJ45 plugs', depth: 25 },
      { face: '+z', what: 'Module heatsink (+ optional 40 mm fan): vents ≥ heatsink area above it', depth: 12 },
      { face: '-x', what: 'microSD slot on the module (under the heatsink edge)', depth: 6 },
    ],
    cable: 'DC barrel (J25) 5 V 4 A with the J48 jumper fitted; 40-pin header on the +y edge (I2C bus 1, I2S); leave the I/O edge open',
    profile: 'chassis', material: ['ABS/ASA', 'PETG', 'PA-CF'],
    rules: [
      '4x M2.5 self-tap Ø2.15 bosses on 86 x 58 (NVIDIA B01 carrier drawing), standoffs ≥ 6 mm',
      'Put the I/O edge against a wall slot: barrel and USB plugs go in from outside',
      'Heatsink runs 50-70 °C: ABS/ASA or PETG, vent slots above, no PLA+ within 10 mm',
    ],
    unverified: ['Mass (≈ 140 g with heatsink) is an estimate'],
  }),
  def('MIC-INMP441', {
    source: 'estimated', method: 'glue_pocket',
    keepouts: [{ face: '-z', what: 'Bottom sound port through the PCB: Ø1.6 port in the wall right in front of it, sealed to the PCB', depth: 2 }],
    cable: '6-pin header: SD, WS, SCK to the I2S pins, L/R to GND (left channel), VDD 3.3 V',
    profile: 'shell', material: SHELL,
    rules: [
      'Push-fit pocket (+0.40) with the port side against the inner wall; Ø1.5-2.0 port hole through the wall on the mic axis',
      'Keep ≥ 20 mm (or a wall) between the mic and the speaker; never put it in the speaker chamber',
      'Glue the PCB rim (no glue in the port)',
    ],
    unverified: ['Round Ø14.5 breakout and port position are typical clone values'],
  }),
  def('RESPEAKER-2MIC-HAT', {
    source: 'datasheet', method: 'stack', holes: { ...piHoles(26.5), standoff: 0 },
    keepouts: [
      { face: '+z', what: 'Two mics at the board ends: Ø1.6 sound port above each, ≤ 3 mm air gap', depth: 3 },
      { face: '-y', what: 'JST-PH speaker out + 3.5 mm jack', depth: 10 },
      { face: '+z', what: 'User button (GPIO17) and 3 APA102 LEDs: light pipe or window', depth: 2 },
    ],
    cable: 'Stacks on the 40-pin header (I2S + I2C + SPI); speaker on the JST-PH 2.0; Grove I2C port for a PCA9685',
    profile: 'shell', material: SHELL,
    rules: [
      'pHAT on the Pi 58 x 23 corner holes (M2.5 x 11 standoffs to the Pi)',
      'Open a sound port right above each mic; seal the speaker from the mics',
    ],
    unverified: ['Mic positions (board ends, centred in Y) are taken from photos'],
  }),
  def('USB-MIC-MINI', {
    source: 'estimated', method: 'stack',
    keepouts: [{ face: '+x', what: 'Mic opening at the plug end: leave it in the port window, open to the room', depth: 5 }],
    cable: 'None: plugs into a USB-A port',
    profile: 'shell', material: SHELL,
    rules: ['Plug into a USB-A port that faces a wall window; the window clears the dongle by 1 mm all round'],
    unverified: ['Dongle outline varies by vendor'],
  }),
  def('AMP-MAX98357A', {
    source: 'datasheet', method: 'glue_pocket',
    keepouts: [
      { face: '+z', what: 'Speaker screw terminal: screwdriver access', depth: 8 },
      { face: '-y', what: '7-pin header + Dupont plugs', depth: 10 },
    ],
    cable: 'LRC, BCLK, DIN on the I2S pins; Vin 5 V and GND (≥ 22 AWG, up to 0.65 A); 2-wire speaker on the terminal',
    profile: 'chassis', material: SHELL,
    rules: ['No holes: push-fit pocket (+0.40) 2 mm deep, or a rim; glue', 'Keep the 5 V lead short: class-D peaks draw 0.6 A'],
  }),
  def('LCD-GC9A01-128', {
    source: 'estimated', method: 'cradle',
    holes: { size: 'M2', pitch: [34.4, 31.5], standoff: 0, drill: 'tap' },
    keepouts: [
      { face: '+z', what: 'Round active area Ø32.4: round window Ø33.0, 1.5 mm bezel, no pressure on the glass', depth: 2 },
      { face: '-z', what: '8-pin header + cable', depth: 10 },
    ],
    cable: '8-wire SPI (VCC, GND, DIN, CLK, CS, DC, RST, BL) to the board',
    profile: 'shell', material: SHELL,
    rules: [
      'Push-fit pocket (+0.40) behind a round Ø33 window; a screwed retainer plate holds the PCB from behind',
      'The window centre is the module centre; check yours (±0.5 mm)',
    ],
    unverified: ['Module outline 40.4 x 37.5 and the 34.4 x 31.5 hole pitch follow the Waveshare drawing; clones differ'],
  }),
  def('LCD-ST7789-169', {
    source: 'estimated', method: 'cradle',
    keepouts: [
      { face: '+z', what: 'Active area 27.97 x 32.63 (rounded corners): window + 0.5 each side, 1.5 mm bezel', depth: 2 },
      { face: '-z', what: 'Header / GH1.25 cable', depth: 10 },
    ],
    cable: '8-wire SPI (VCC, GND, DIN, CLK, CS, DC, RST, BL)',
    profile: 'shell', material: SHELL,
    rules: ['Push-fit pocket (+0.40) behind the window; retainer plate from behind, never clamp the glass'],
    unverified: ['Module outline 31 x 41 and window position are estimates'],
  }),
  def('LCD-ST7789-20', {
    source: 'estimated', method: 'cradle',
    keepouts: [
      { face: '+z', what: 'Active area 30.6 x 40.8: window + 0.5 each side, 1.5 mm bezel', depth: 2 },
      { face: '-z', what: 'Header / GH1.25 cable', depth: 10 },
    ],
    cable: '8-wire SPI (VCC, GND, DIN, CLK, CS, DC, RST, BL)',
    profile: 'shell', material: SHELL,
    rules: ['Push-fit pocket (+0.40) behind the window; retainer plate from behind'],
    unverified: ['Module outline 34.5 x 51 and window position are estimates'],
  }),
  def('MG996R-SERVO', {
    source: 'datasheet', method: 'ear_screws', span: [54.5, 19.7],
    holes: { size: 'M4', pitch: [49.5, 10.0], standoff: 0, drill: 'tap' },
    keepouts: [
      { face: '+z', what: '25T spline + horn: horn arm sweeps R25 round the shaft', depth: 14 },
      { face: '-x', what: 'Servo lead exit', depth: 8 },
    ],
    cable: '3-pin lead (brown GND, red V+, orange signal); 2.5 A stall per servo on the 5-6 V rail',
    profile: 'motorMount', material: MOTOR,
    rules: [
      'Through-pocket 41.1 x 20.1 (+0.40); 4x M4 (or M3 + nut) through the ears on 49.5 x 10',
      'Housing walls ≥ 4 mm, PETG/ABS; the horn load is 10x a micro servo',
    ],
    unverified: ['Not used by the composer housings (micro-class only): design a dedicated mount'],
  }),
  def('DS3218-SERVO', {
    source: 'datasheet', method: 'ear_screws', span: [54.5, 20.0],
    holes: { size: 'M4', pitch: [49.5, 10.0], standoff: 0, drill: 'tap' },
    keepouts: [
      { face: '+z', what: '25T spline + horn sweep', depth: 14 },
      { face: '-x', what: 'Servo lead exit', depth: 8 },
    ],
    cable: '3-pin lead; budget 2.6 A stall per servo',
    profile: 'motorMount', material: MOTOR,
    rules: ['Standard-servo pocket 40.4 x 20.4 (+0.40), 4x M4 / M3 ears on 49.5 x 10, walls ≥ 4 mm'],
    unverified: ['Stall current and ear pitch are typical values'],
  }),
  hobbyServo('SG92R-SERVO', [32.5, 12.5], 'datasheet'),
  hobbyServo('FS90R-SERVO', [32.5, 12.5], 'datasheet'),
  def('DRV8833-DRIVER', {
    source: 'estimated', method: 'glue_pocket',
    keepouts: [{ face: '-z', what: 'Pin headers + Dupont plugs / soldered leads', depth: 8 }],
    cable: 'IN1-IN4 to servo board signal pins (2 per motor), VM to the battery (2.7-10.8 V), GND common with the board; OUT1-OUT4 to the motors',
    profile: 'chassis', material: SHELL,
    rules: ['Rim pocket (+0.30) 3 mm deep, foam tape; keep the motor leads short and twisted'],
    unverified: ['Module outline varies (Pololu 15.2 x 12.7, generic 18.5 x 16)'],
  }),
  def('TB6612-DRIVER', {
    source: 'estimated', method: 'glue_pocket',
    keepouts: [{ face: '-z', what: 'Pin headers + Dupont plugs / soldered leads', depth: 8 }],
    cable: 'PWMA, AIN1, AIN2, PWMB, BIN1, BIN2 to servo board signal pins (3 per motor), STBY to VCC, VCC 3.3-5 V, VM 4.5-13.5 V, GND common',
    profile: 'chassis', material: SHELL,
    rules: ['Rim pocket (+0.30) 3 mm deep, foam tape; VM needs ≥ 4.5 V (a 2S pack, not 1S)'],
    unverified: ['SparkFun 20.3 x 20.3 outline assumed; clones differ'],
  }),
  def('ST3215-SERVO', {
    source: 'estimated', method: 'screw_bosses',
    holes: { size: 'M3', pitch: [[6.0, 6.0], [39.2, 6.0], [6.0, 18.7], [39.2, 18.7]], standoff: 0, drill: 'clear' },
    keepouts: [
      { face: '+z', what: 'Output disc (25T) + horn; idler shaft on the opposite side', depth: 14 },
      { face: '-x', what: '2 bus connectors (daisy chain in / out)', depth: 10 },
    ],
    cable: '3-pin bus (GND, V+, DATA) daisy-chained from the BUS-SERVO-ADAPTER; 7.4-12 V supply',
    profile: 'motorMount', material: MOTOR,
    rules: ['Bolt through the metal case holes (M3 clearance) or use the vendor brackets; walls ≥ 4 mm'],
    unverified: ['Case hole positions are estimates from the Feetech drawing; measure before printing'],
  }),
  def('WAVESHARE-SERVO-HAT', {
    source: 'datasheet', method: 'stack', holes: { ...piHoles(52.5), standoff: 11 },
    keepouts: [
      { face: '+z', what: '16 servo headers + VIN screw terminal', depth: 15 },
      { face: '-y', what: 'Servo leads fan out', depth: 10 },
    ],
    cable: 'Stacks on the 40-pin header (I2C bus 1, 0x40); 6-12 V on the VIN terminal; 16 servo leads',
    profile: 'chassis', material: STRUCT,
    rules: ['HAT on the 58 x 49 pattern with M2.5 x 11 standoffs; leave the servo headers reachable from the opening'],
    unverified: ['Regulator rating (3 A) is the vendor figure'],
  }),
  def('ADAFRUIT-SERVO-BONNET', {
    source: 'datasheet', method: 'stack', holes: { ...piHoles(26.5), standoff: 11 },
    keepouts: [{ face: '+z', what: '16 servo headers + power jack', depth: 15 }],
    cable: 'Stacks on the 40-pin header (I2C 0x40); servo power 5 V 4 A into the DC jack',
    profile: 'chassis', material: STRUCT,
    rules: ['Bonnet on the 58 x 23 corner holes; servo power jack reachable through a wall slot'],
  }),
  def('BUS-SERVO-ADAPTER', {
    source: 'estimated', method: 'screw_bosses',
    holes: { size: 'M2_5', pitch: [36.0, 26.0], standoff: 4, drill: 'tap' },
    keepouts: [
      { face: '-y', what: 'USB-C + power jack', depth: 15 },
      { face: '+x', what: '2 servo bus ports', depth: 10 },
    ],
    cable: 'USB-C (or UART) to the board; one 3-pin bus daisy-chains the servos; 6-12 V power in',
    profile: 'chassis', material: STRUCT,
    rules: ['4x M2.5 self-tap bosses, 4 mm standoffs'],
    unverified: ['Outline and hole pattern are estimates'],
  }),
  def('BUCK-5V-5A', {
    source: 'estimated', method: 'screw_bosses',
    holes: { size: 'M3', pitch: [[3.0, 12.0], [33.0, 12.0]], standoff: 3, drill: 'tap' },
    keepouts: [{ face: '+z', what: 'Inductor + MOSFET heat: 3 mm air gap above, no PLA+ contact', depth: 6 }],
    cable: '2S pack in (≥ 20 AWG), 5.1 V out to the board power input with short thick leads',
    profile: 'chassis', material: STRUCT,
    rules: ['2x M3 self-tap bosses 3 mm high (air under the board)', 'Put it next to the battery, away from the mics (switching noise)'],
    unverified: ['Generic module outline and hole positions'],
  }),
  def('UPS-HAT-PI', {
    source: 'estimated', method: 'stack', holes: { ...piHoles(52.5), standoff: 11 },
    pocket: grow(env('UPS-HAT-PI'), SWELL),
    keepouts: [
      { face: '+z', what: 'Two 18650 cells in holders: lift-out access, +1 mm swell margin', depth: 4 },
      { face: '-y', what: 'USB-C charge input: wall slot', depth: 15 },
    ],
    cable: 'Feeds the Pi through the 40-pin header 5 V pins; USB-C charge input through a wall slot',
    profile: 'chassis', material: STRUCT,
    rules: ['HAT on the 58 x 49 pattern; cells removable from the opening side', 'Charge port reachable without opening the body'],
    unverified: ['Outline, output current and fuel-gauge address depend on the vendor'],
  }),

  // ---- Hardware
  def('MAG-N52-10X2', {
    source: 'guide', method: 'glue_pocket', pocket: grow(env('MAG-N52-10X2'), MAG),
    keepouts: [{ face: '+z', what: 'Mating magnet / steel face', depth: 0 }],
    cable: 'None',
    profile: 'chassis', material: SHELL,
    rules: [
      'Pocket Ø = D + 0.20, depth = t + 0.20 (s.4) -> Ø10.2 x 2.2; CA capillary bond',
      'Mark polarity on the part; hidden magnets under a 0.4-0.6 mm skin',
    ],
  }),
  def('MAG-MAGSAFE-RING', {
    source: 'estimated', method: 'glue_pocket', pocket: [54.2, 54.2, 1.7],
    keepouts: [{ face: '+z', what: 'Phone back: flush, ≤0.6 mm skin', depth: 0 }],
    cable: 'None',
    profile: 'cantilever', material: SHELL,
    rules: ['Annular channel OD 54.2 / ID 45.8, depth 1.7 (+0.20 per the magnet rule); glue'],
    unverified: ['Ring OD/ID vary by vendor'],
  }),
  def('MAG-N52-4X2', {
    source: 'guide', method: 'glue_pocket', pocket: grow(env('MAG-N52-4X2'), MAG),
    keepouts: [{ face: '+z', what: 'Mating magnet / steel face', depth: 0 }],
    cable: 'None',
    profile: 'chassis', material: SHELL,
    rules: ['Pocket Ø4.2 x 2.2 (guide s.4, checklist #6); CA capillary bond'],
  }),
  def('BRG-683ZZ', {
    source: 'guide', method: 'press_pocket', pocket: [bearingBore(7), bearingBore(7), 3.0],
    keepouts: [{ face: '+z', what: 'Inner race: Ø4.5 relief so the housing only touches the outer race', depth: 0.5 }],
    cable: 'None',
    profile: 'wheel', material: MOTOR,
    rules: [
      'Housing bore Ø7.05 (Hole = OD + 0.05, s.4), 0.5 mm shoulder on the far side',
      'Ø3 steel pin / M3 screw axle; without a bearing use a journal bore Ø3.40',
      'Bore axis vertical (Z) so it prints round and support-free',
    ],
  }),
  def('BRG-688ZZ', {
    source: 'guide', method: 'press_pocket', pocket: [bearingBore(16), bearingBore(16), 5.0],
    keepouts: [{ face: '+z', what: 'Inner race: Ø10 relief so the housing only touches the outer race', depth: 0.5 }],
    cable: 'None',
    profile: 'wheel', material: MOTOR,
    rules: [
      'Housing bore Ø16.05 (Hole = OD + 0.05, s.4), 0.5 mm shoulder on the far side',
      'Ø8 shaft; bore axis vertical (Z), support-free',
    ],
  }),
];

export const STANDARD: Record<string, MountStandard> = Object.fromEntries(LIST.map(s => [s.id, s]));

// ---------------------------------------------------------------- fallbacks & helpers
const KIND_DEFAULT: Record<ComponentKind, { method: MountMethod; profile: ProfileKey; material: Material[] }> = {
  controller: { method: 'screw_bosses', profile: 'chassis', material: SHELL },
  shield: { method: 'screw_bosses', profile: 'chassis', material: STRUCT },
  servo: { method: 'ear_screws', profile: 'motorMount', material: MOTOR },
  cservo: { method: 'ear_screws', profile: 'motorMount', material: MOTOR },
  motor: { method: 'clamp', profile: 'motorMount', material: MOTOR },
  battery: { method: 'cradle', profile: 'chassis', material: STRUCT },
  switch: { method: 'ear_screws', profile: 'chassis', material: STRUCT },
  ledhub: { method: 'screw_bosses', profile: 'chassis', material: SHELL },
  led: { method: 'press_pocket', profile: 'shell', material: SHELL },
  speaker: { method: 'press_pocket', profile: 'shell', material: SHELL },
  hardware: { method: 'press_pocket', profile: 'chassis', material: STRUCT },
  sensor: { method: 'screw_bosses', profile: 'shell', material: SHELL },
  display: { method: 'screw_bosses', profile: 'shell', material: SHELL },
  camera: { method: 'screw_bosses', profile: 'shell', material: SHELL },
};

/** Standard for a part; unknown ids get a kind-based, push-fit default (source 'estimated'). */
export function standardFor(id: string): MountStandard {
  const s = STANDARD[id];
  if (s) return s;
  const item = CATALOG[id];
  const envelope: V3 = item ? [...item.size] as V3 : [30, 30, 10];
  const k = KIND_DEFAULT[item?.kind ?? 'hardware'];
  return {
    id, source: 'estimated', envelope, pocket: grow(envelope, PUSH), method: k.method,
    keepouts: [], cable: `Route leads with a ${CLEARANCE.cableRoute} mm gap; no pinch at pocket edges`,
    profile: k.profile, material: k.material,
    rules: ['No standard entry: push-fit pocket (+0.40), measure the part before printing', TUNNEL],
    unverified: ['Everything except the envelope'],
  };
}

const ALLOW: Record<FitKey, number> = { journal: FIT.journal, slide: 2 * FIT.slide, push: FIT.push, press: FIT.press };

/** Pocket for a part: the standard's pocket, or envelope + the diametral allowance of `fit`. */
export function pocketFor(id: string, fit?: FitKey): V3 {
  const s = standardFor(id);
  if (!fit) return [...s.pocket] as V3;
  const a = ALLOW[fit];
  return grow(s.envelope, [a, a, a]);
}

/** Which CATALOG ids have an explicit STANDARD entry. */
export function standardCoverage(): { covered: string[]; missing: string[] } {
  const ids = Object.keys(CATALOG);
  return { covered: ids.filter(i => STANDARD[i]), missing: ids.filter(i => !STANDARD[i]) };
}

/** u,v extents of a face of an envelope (see HolePattern.face). */
export function faceExtent(e: V3, face: Face = '-z'): [number, number] {
  return face[1] === 'z' ? [e[0], e[1]] : face[1] === 'x' ? [e[1], e[2]] : [e[0], e[2]];
}

/** Values where the architecture doc (or the code) disagrees with the guide; the guide wins. */
export const DISCREPANCIES: string[] = [
  'Push-fit: arch +0.2 mm; guide formula Pocket = Part + 0.40 (used). The guide row itself also says "+0.10 radial (+0.20 diametrical)".',
  'Slide fit: arch +0.35 mm; guide +0.15-0.25 per wall, Slot = Tongue + 0.40.',
  'Journal: arch +0.5 mm; guide +0.20 radial / +0.40 diametrical.',
  'Tap drills: arch M2 Ø1.8 / M2.5 Ø2.2 / M3 Ø2.7; guide Ø1.70 / Ø2.15 / Ø2.60.',
  'Clearance holes: arch M2 Ø2.4 / M2.5 Ø2.9; guide Ø2.30 / Ø2.80 (M3 Ø3.4 agrees).',
  'B-PG001 torque: arch 1.8 kg·cm; guide 1.2 kgf·cm @ 6 V.',
  'B-XA003 size: arch 24 x 24 mm; guide 22.0 x 27.0 x 11.2 mm.',
  'B-XA004: arch "8 servo ports + LiPo charger"; guide 4 servo headers S1-S4, 6.0-9.0 V input, no charger.',
  'B-GM001: arch "N20, 1:50, 150 RPM"; guide 030 geared motor 38.0 x 15.5 x 12.0, 180 RPM @ 6 V, 2.4 kgf·cm (Ø3 D-shaft agrees).',
  'B-XA007: arch "3-pin slide switch"; guide SPDT with XH2.54 2-pin inline harness.',
  'Power: arch budgets runtime on B-BA001 (1S 3.7 V); guide bus is 2S 7.4 V (B-PC003) and B-XA004 needs 6-9 V.',
  'LED: arch B-XL001 WS2812B RGB; guide kit LED is B-KB003 WS2812 RGBW (both catalogued).',
  'Print density: arch 1.24 g/cm³ (PLA); guide primary material PETG (1.27).',
];
