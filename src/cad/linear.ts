// Rack-and-pinion linear axis: camera sliders, linear actuators, shuttle conveyors, drawer / sliding-door
// openers (horizontal), and lifts, elevators and forklift masts (vertical). A B-PG001 (S1) stands in a tower
// beside a T-rail and turns a module-1.5 pinion that meshes with a rack on the carriage, so 180° of servo
// travel gives π × pitch radius of stroke. The carriage wraps the rail flange with sliding-fit clearance.
// The axis module is drawn in a local frame (rail along +Y, floor at z = 0) and mapped to the world.

import { FIT, HOLES } from '../catalog/rules';
import { linearTravel, type RobotSpec } from '../design/spec';
import { Build, box, cylZ, prismXY, sub, union, type M } from './kernel';
import { HORN_SEAT, SV, hornSeatCuts, hornSolid, place, servoSolid, type Frame } from './modules';
import { machineBase, towerInFrame } from './machine';
import type { Collider, Vec3 } from './types';

const MOD = linearTravel(60).module;     // gear module
const SLIDE = FIT.slide;                 // +0.20 per mating wall (guide s.4)

/** Pinion outline: trapezoidal teeth, 0.4 p tooth thickness at the pitch circle (≈0.5 mm backlash). */
function gearOutline(n: number): [number, number][] {
  const r = (MOD * n) / 2, ra = r + MOD, rf = r - 1.25 * MOD, p = (2 * Math.PI) / n;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const c = i * p;
    for (const [rad, a] of [[rf, c - 0.3 * p], [ra, c - 0.12 * p], [ra, c + 0.12 * p], [rf, c + 0.3 * p]])
      pts.push([rad * Math.cos(a), rad * Math.sin(a)]);
  }
  return pts;
}

/** Convex hull (monotone chain) of support points, counter-clockwise. */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => {
    const h: [number, number][] = [];
    for (const q of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

export function buildLinear(b: Build, spec: RobotSpec) {
  const P = spec.params;
  const vertical = P.linearOrient === 'vertical';
  const tool = P.linearTool;
  const base = machineBase(b, spec, { clampTabs: true });
  base.finishDeck(base.statusLeds(P.leds));

  // ---------------------------------------------------------------- sizing
  const { teeth: n, pitchR: R, travel, half } = linearTravel(P.stroke);
  const Lc = 44, endT = 6;
  const Lr = Lc + travel + 2 * endT + 2;
  const rackRoot = 16, rackPitch = rackRoot + 1.25 * MOD;
  const xc = rackPitch + R;                                  // pinion centre
  const xF = xc + 10.5;
  const towerTop = 6 + SV.below + 0.6, seat = towerTop + HORN_SEAT;
  const zTop = seat + 12;                                     // carriage table top

  // ---------------------------------------------------------------- local → world
  const dx = 42.2 + 20;                                       // floor's -X edge just past the base clamp tab
  const Tx = 42.2 + xF, Ty = -2, Tz = Lr / 2 + 6;
  const map = (m: M) => (vertical ? m.rotate([90, 0, 0]).rotate([0, 0, 180]).translate([Tx, Ty, Tz]) : m.translate([dx, 0, 0]));
  const mapP = ([x, y, z]: Vec3): Vec3 => (vertical ? [-x + Tx, z + Ty, y + Tz] : [x + dx, y, z]);
  const mapD = ([x, y, z]: Vec3): Vec3 => (vertical ? [-x, z, y] : [x, y, z]);
  const mapHalf = ([x, y, z]: Vec3): Vec3 => (vertical ? [x, z, y] : [x, y, z]);

  // ---------------------------------------------------------------- rail base (local)
  const f: Frame = { rots: [[0, 0, 90]], pos: [xc, 0, towerTop] };   // S x -> +Y: the case runs along the rail
  const ry = Lr / 2 - endT;
  const capHoles: [number, number][] = [[-14, Lr / 2 - endT / 2], [10, Lr / 2 - endT / 2]];
  const railLocal = sub(union([
    box(-20, xF, -Lr / 2, Lr / 2, 0, 6),
    box(-4, 4, -ry, ry, 5.99, 12),                            // rail stem
    box(-9, 9, -ry, ry, 11.99, 16),                           // rail flange
    box(-20, rackRoot, -Lr / 2, -ry, 5.99, 22),               // fixed end stop
    place(towerInFrame(towerTop - 6), f),
  ]),
  box(xc + 5, xc + 12, -4, 4, 5, 12),                         // servo lead out of the tower
  ...capHoles.map(([x, y]) => cylZ(x, y, HOLES.M3.tap / 2, 0.8, 6.5, 16)));
  const railName = vertical ? 'Mast + rail' : 'Rail base';
  const railSolid = map(railLocal);

  const tongue = sub(box(28.2, 42.21, -10.2, 10.2, 4.2, 9), cylZ(36, 0, HOLES.M4.clear / 2, 3, 10, 24));
  const foot = vertical ? box(42.2, Tx + 20, -22, 50, 0, 6) : null;
  b.part({ id: 'rail', name: railName, link: 'base', material: spec.structural, profile: 'motorMount', color: spec.accentColor,
    solid: union([railSolid, tongue, foot]), printRot: vertical ? [90, 0, 0] : [0, 0, 0],
    printNote: vertical ? 'Backplate down: the rail, tower and foot print upright.' : 'Floor down; the rail and the servo tower print upright.' });

  const cap = sub(box(-20, rackRoot, ry, Lr / 2, 6, 22), ...capHoles.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, 5, 23, 16)));
  b.part({ id: 'end_cap', name: 'Screw-on end stop', link: 'base', material: spec.structural, profile: 'chassis', color: spec.primaryColor,
    solid: map(cap), printRot: vertical ? [90, 0, 0] : [0, 0, 0], printNote: 'Fit it after sliding the carriage onto the rail.' });

  b.comp({ key: 'servo_slide', catalogId: 'B-PG001', label: 'Pinion servo (S1)', link: 'base', solid: map(place(servoSolid(), f)) });
  b.comp({ key: 'horn_slide', catalogId: 'horn', label: 'Pinion horn', link: 'base', solid: map(place(hornSolid(), f)), color: '#f0f0f0' });

  const pinion = sub(prismXY(gearOutline(n), seat, seat + 8).translate([xc, 0, 0]), place(hornSeatCuts(8), f));
  b.part({ id: 'pinion', name: 'Pinion gear', link: 'base', material: spec.structural, profile: 'wheel', color: '#f4f4f4',
    solid: map(pinion), printRot: vertical ? [90, 0, 0] : [0, 0, 0], printNote: `Horn recess down. ${n} teeth, module ${MOD}, pitch Ø${(2 * R).toFixed(1)}.` });

  // ---------------------------------------------------------------- carriage (local)
  const cav = (x: number) => x + SLIDE;
  const adds: M[] = [
    box(-16, 16, -Lc / 2, Lc / 2, 7, 22),
    box(12, 16, -Lc / 2, Lc / 2, 21.99, zTop - 3.49),
    box(-16, -12, -Lc / 2, Lc / 2, 21.99, zTop - 3.49),
    box(-16, 16, -Lc / 2, Lc / 2, zTop - 3.5, zTop),
  ];
  const pitch = Math.PI * MOD, tipZ0 = seat - 0.5, tipZ1 = seat + 8.5;
  for (let y = -Lc / 2 + pitch / 2 + 0.5; y < Lc / 2 - pitch / 2; y += pitch)
    adds.push(prismXY([[rackRoot - 0.01, y - 1.66], [rackPitch + MOD, y - 0.435], [rackPitch + MOD, y + 0.435], [rackRoot - 0.01, y + 1.66]], tipZ0, tipZ1));
  const cuts: M[] = [
    box(-cav(9), cav(9), -Lc / 2 - 1, Lc / 2 + 1, 12 - SLIDE, 16 + SLIDE),
    box(-cav(4), cav(4), -Lc / 2 - 1, Lc / 2 + 1, 6.5, 12 - SLIDE + 0.01),
  ];
  let toolTop = zTop;
  if (tool === 'fork') {
    const forkLen = 45;
    adds.push(...[-14, 8].map(x => box(x, x + 6, -Lc / 2, -Lc / 2 + 5, zTop - 0.01, zTop + forkLen)));
    toolTop = zTop + forkLen;
  } else if (tool === 'camera') {
    cuts.push(cylZ(0, 0, 3.3, zTop - 4, zTop + 1, 24));    // 1/4"-20 tripod screw clearance
  }
  cuts.push(...[-1, 1].flatMap(sx => [-1, 1].map(sy => cylZ(sx * 10, sy * (Lc / 2 - 6), HOLES.M3.tap / 2, zTop - 3.5, zTop + 1, 16))));
  const carriage = sub(union(adds), ...cuts);
  const carriageRot: Vec3 = tool === 'fork' ? (vertical ? [0, 90, 0] : [0, -90, 0]) : vertical ? [0, 0, 0] : [90, 0, 0];
  b.part({ id: 'carriage', name: 'Carriage + rack', link: 'carriage', material: spec.structural, profile: 'motorMount', color: spec.primaryColor,
    solid: map(carriage), printRot: carriageRot,
    printNote: tool === 'fork' ? 'On its side so the tines print flat.' : 'Tunnel axis vertical: the rail channel and rack teeth print without supports.' });
  b.allowContact('Pinion gear', 'Carriage + rack');

  // ---------------------------------------------------------------- links, meta, checks
  const railHalf: Vec3 = [(xF + 20) / 2, Lr / 2, 8];
  const baseColliders: Collider[] = [
    ...base.colliders,
    { shape: 'box', center: mapP([(xF - 20) / 2, 0, 8]), half: mapHalf(railHalf), friction: 0.7 },
    ...(vertical ? [{ shape: 'box' as const, center: [(42.2 + Tx + 20) / 2, 14, 3] as Vec3, half: [(Tx + 20 - 42.2) / 2, 36, 3] as Vec3, friction: 0.7 }] : []),
  ];
  b.link({ id: 'base', name: 'Base', parent: null, colliders: baseColliders });
  b.link({ id: 'carriage', name: vertical ? 'Lift carriage' : 'Carriage', parent: 'base',
    joint: { origin: mapP([0, 0, (7 + zTop) / 2]), axis: mapD([0, 1, 0]), type: 'prismatic', pinionR: R, limit: [-half, half],
      actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S1', label: vertical ? 'lift' : 'slide' } },
    colliders: [{ shape: 'box', center: mapP([0, 0, (7 + toolTop) / 2]), half: mapHalf([16, Lc / 2, (toolTop - 7) / 2]), friction: 0.8 }] });

  const railCorners: Vec3[] = vertical
    ? [[42.2, -22, 0], [Tx + 20, -22, 0], [Tx + 20, 50, 0], [42.2, 50, 0]]
    : [mapP([-20, -Lr / 2, 0]), mapP([xF, -Lr / 2, 0]), mapP([xF, Lr / 2, 0]), mapP([-20, Lr / 2, 0])];
  b.meta = {
    payload: { link: 'carriage', at: mapP(tool === 'fork' ? [0, -Lc / 2 + 8, (zTop + toolTop) / 2] : [0, 0, zTop + 5]) },
    clampable: true,
    support: convexHull([[-28, -37], [28, -37], [28, 36], [-28, 36], ...railCorners.map(([x, y]) => [x, y] as [number, number])]),
  };

  b.check({ id: 'gear', label: 'Rack & pinion mesh', status: 'pass',
    detail: `Module ${MOD}, ${n}-tooth pinion (pitch Ø${(2 * R).toFixed(1)} mm), 20°-flank rack; 0.375 mm tip clearance, ≈0.5 mm backlash. ±90° of servo travel = ±${half} mm of stroke.` });
  b.check({ id: 'slide', label: 'Sliding fit (guide s.4)', status: 'pass',
    detail: `Carriage channel = rail flange/stem + ${SLIDE.toFixed(2)} mm per wall; the carriage wraps under the flange so it cannot lift off.` });
  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass',
    detail: 'The pinion centre screw is driven straight down its Ø6.5 tunnel; servo ears and end-stop screws are vertical and open from above.' });
  b.screw('M2×8 self-tap', 2, 'servo ears to tower');
  b.screw('M2×6 self-tap', 2, 'horn arm to pinion');
  b.screw('M3×20', 2, 'end stop to rail base');
  b.screw('M4 wood screw / clamp', 1, 'rail tongue + base tab to the desk or a board');
  b.step('3. Drop the servo into the rail tower (lead out through the side slot) and screw the ears. Send `calib` so it sits at 0.');
  b.step('4. Slide the carriage onto the rail from the open end, centre it, then screw the end stop on (2 × M3×20).');
  b.step('5. Screw the horn into the pinion recess, press the pinion onto the spline so it meshes with the rack with the carriage centred, and drive the centre screw down the Ø6.5 tunnel.');
  b.step('6. Screw the rail tongue and the base tab to the desk (M4) or clamp them together.');
}
