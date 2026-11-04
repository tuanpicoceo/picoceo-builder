// Walking legs for a composed robot (composition mobility "legs"): the base tub becomes the pelvis and two 4-DOF
// legs (hip, knee and ankle pitch plus ankle roll, all on the PCA9685) carry it, like a MicroDuck / Open Duck biped. The body,
// neck and head are composed above the pelvis as usual.
//
// The pitch joints turn about x (the ankle roll about y). To keep the legs narrow the pitch servos alternate: the hip servo (in a housing on the tub's
// side wall) and the ankle servo point their shafts outward, the knee servo inward, so each leg zig-zags in x:
//   hip housing   x 28 .. 49.4   on the tub wall          thigh plate  x 59.5 .. 63.5  on the hip horn
//   knee housing  x 38.1 .. 59.5 hangs inside the thigh   shin plate   x 24 .. 28      on the knee horn
//   ankle housing x 28 .. 49.4   on the shin's outer face  ankle block  x 59.5 .. 63.5  on the ankle horn
//   roll housing  x 25 .. 63     lying under the block     foot         hub in front of it on the roll horn (shaft +y), a wide sole
// Built in the tub's frame (tub floor at z = 0); the composer lifts the whole robot onto its feet afterwards.

import { FIT, HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, bb, box, cylX, cylY, cylZ, hull, rrect, sub, union, type M } from './kernel';
import { BASE } from './companion';
import { EAR_HOLES, EAR_X0, EAR_X1, HORN_SEAT, SV, SV_X0, SV_X1, hornSeatCuts, hornSolid, place, servoSolid, type Frame } from './modules';
import type { Collider, Vec3 } from './types';

const T = 4;                                   // link plate thickness
const HOUSE = SV.below + 3;                    // housing depth from the ear face (3 mm floor behind the case)
const OUT: Vec3[] = [[0, 0, 90], [0, 90, 0]];  // servo x -> +Y, y -> +Z, shaft -> +X
const IN: Vec3[] = [[0, 0, 90], [0, -90, 0]];  // shaft -> -X

export interface Legs {
  lift: number;                                // tub floor height above the ground
  support: [number, number][];
  colliders: Collider[];
  ports: number;                               // servo board channels used (S1..S8)
  addLinks: () => void;                        // the eight leg links, once the base link exists
  fitFeet: (comY: number, comZ: number) => void;   // grow the soles under the robot's centre of mass (mm, tub frame)
}

/** Two 3-DOF legs on the base tub's side walls (right leg built, left mirrored). `servoId`: the directory's micro servo. */
export function buildLegs(b: Build, spec: RobotSpec, servoId: string): Legs {
  const P = spec.params;
  const hw = BASE.hw;
  const yh = -6, zh = 15;                      // hip axis: mid-height of the tub wall, a little behind the middle
  // thigh = shin length: ≥ 44 so the knee hub swings clear of the tub's underside over the hip's ±35°
  const L = Math.min(60, Math.max(44, (P.legLen || 90) / 2));
  const e1 = hw + HOUSE;                       // hip ear face (49.4)
  const tp0 = e1 + HORN_SEAT;                  // thigh plate inner face (59.5)
  const ek = tp0 - HOUSE;                      // knee ear face (38.1), shaft inward
  const sp1 = ek - HORN_SEAT;                  // shin plate outer face (28)
  const ea = sp1 + HOUSE;                      // ankle ear face (49.4)
  const fp0 = ea + HORN_SEAT;                  // foot plate inner face (59.5)
  const zk = zh - L, za = zk - L;
  // ankle roll: a servo lying under the ankle block, shaft forward (+y), tilts the foot sideways so the robot can lean
  // its weight onto one foot and lift the other (pitch alone only shuffles). Its housing clears the shin's ankle housing
  // over ±25° of ankle pitch, and the sole clears the roll housing over ±20° of roll.
  const xf = 38.5;                             // roll axis x: the servo body is centred under the leg (x ≈ 44)
  const zf = za - 28;                          // roll axis height (the foot's hub then clears the shin over ±19° of ankle pitch)
  const yf0 = yh + 10.7;                       // roll servo ear face (front): its housing is centred on the leg in y
  const soleTop = zf - 17, ground = soleTop - 4;
  const footLen = Math.min(110, Math.max(60, P.footLen || 76)), footBack = 0.4 * footLen;
  const sx0 = xf - 24, sx1 = xf + 24;          // sole across the leg, centred on the roll axis
  const yr = [yh + EAR_X0 - 3, yh + EAR_X1 + 3] as const;   // housing y range (servo long axis along y)

  const frame = (rots: Vec3[], x: number, z: number): Frame => ({ rots, pos: [x, yh, z] });
  const hipF = frame(OUT, e1, zh), kneeF = frame(IN, ek, zk), ankleF = frame(OUT, ea, za);
  const rollF: Frame = { rots: [[-90, 0, 0]], pos: [xf, yf0, zf] };   // servo x -> +X, y -> -Z, shaft -> +Y
  const housing = (f: Frame) => place(box(EAR_X0 - 3, EAR_X1 + 3, -SV.W / 2 - 3, SV.W / 2 + 3, -HOUSE, 0), f);
  const pocket = (f: Frame) => place(union([
    box(SV_X0 - FIT.push / 2, SV_X1 + FIT.push / 2, -SV.W / 2 - FIT.push / 2, SV.W / 2 + FIT.push / 2, -SV.below - 0.6, 0.5),
    ...EAR_HOLES.map(ex => cylZ(ex, 0, HOLES.M2.tap / 2, -8, 0.5, 16)),
  ]), f);
  const bar = (x0: number, x1: number, zTop: number, zBot: number) =>
    hull([cylX(yh, zTop, 9, x0, x1, 32), cylX(yh, zBot, 9, x0, x1, 32)]);

  // ---- hip housings on the tub walls (added to the tub part)
  const tub = b.parts.find(p => p.id === 'base');
  const hipHousing = sub(housing(hipF), pocket(hipF));
  if (tub) tub.solid = union([tub.solid, hipHousing, hipHousing.mirror([1, 0, 0])]);

  // ---- links (right side; the left one is the mirror)
  const thigh = sub(union([
    bar(tp0, tp0 + T, zh, zk), cylX(yh, zh, 11, tp0, tp0 + T, 40),
    box(tp0, tp0 + T, yr[0], yr[1], zk - SV.W / 2 - 3, zk + SV.W / 2 + 3),     // pad that carries the knee housing
    housing(kneeF),
  ]), place(hornSeatCuts(T), hipF), pocket(kneeF));
  const shin = sub(union([
    bar(sp1 - T, sp1, zk, za), cylX(yh, zk, 11, sp1 - T, sp1, 40),
    box(sp1 - T, sp1, yr[0], yr[1], za - SV.W / 2 - 3, za + SV.W / 2 + 3),
    housing(ankleF),
  ]), place(hornSeatCuts(T), kneeF), pocket(ankleF));
  // ankle block on the ankle (pitch) horn: hub plate down to the lying roll servo's housing
  const ankleBlock = sub(union([
    cylX(yh, za, 11, fp0, fp0 + T, 40),
    box(fp0, fp0 + T, yh - 10, yh + 10, zf - SV.W / 2 - 3, za),
    housing(rollF),
  ]), place(hornSeatCuts(T), ankleF), pocket(rollF));
  // foot on the roll horn: hub plate in front of the roll housing, down to a wide sole
  const yp = yf0 + HORN_SEAT;
  const foot = sub(union([
    cylY(xf, zf, 11, yp, yp + T, 40),
    box(xf - 11, xf + 11, yp, yp + T, soleTop - 0.01, zf),
    hull([box(xf - 11, xf + 11, yp - 8, yp + T, soleTop - 0.01, soleTop + 0.01), box(xf - 11, xf + 11, yp, yp + T, soleTop + 8, soleTop + 8.01)]),   // gusset
    rrect(sx1 - sx0, footLen, 8, (sx0 + sx1) / 2, yh - footBack + footLen / 2, ground, soleTop),
  ]), place(hornSeatCuts(T), rollF));

  const sides = [{ s: 'R', k: 1 }, { s: 'L', k: -1 }] as const;
  const mir = (m: M, k: number) => (k > 0 ? m : m.mirror([1, 0, 0]));
  const mf = (f: Frame, k: number): Frame => (k > 0 ? f : { ...f, mirrorX: true });
  const joints = [
    { id: 'hip', f: hipF, out: true, link: 'thigh', solid: thigh, parent: (s: string) => 'base' },
    { id: 'knee', f: kneeF, out: false, link: 'shin', solid: shin, parent: (s: string) => `hip_${s}` },
    { id: 'ankle', f: ankleF, out: true, link: 'ankle_block', solid: ankleBlock, parent: (s: string) => `knee_${s}` },
    { id: 'roll', f: rollF, out: true, link: 'foot', solid: foot, parent: (s: string) => `ankle_${s}` },
  ];
  const range: Record<string, [number, number]> = { hip: [-35, 35], knee: [-60, 60], ankle: [-25, 25], roll: [-20, 20] };
  const links: (() => void)[] = [];
  for (const [ji, j] of joints.entries()) {
    for (const { s, k } of sides) {
      const lid = `${j.id}_${s}`;
      const port = `S${2 * ji + (s === 'L' ? 1 : 2)}`;
      const name = `${s === 'L' ? 'Left' : 'Right'} ${j.id === 'roll' ? 'ankle roll' : j.id}`;
      b.comp({ key: `servo_${lid}`, catalogId: servoId, label: `${name} servo (${port})`, link: j.parent(s), solid: place(servoSolid(), mf(j.f, k)) });
      b.comp({ key: `horn_${lid}`, catalogId: 'horn', label: `${name} horn`, link: lid, solid: place(hornSolid(), mf(j.f, k)), color: '#f0f0f0' });
      b.part({ id: `${j.link}_${s}`, name: `${s === 'L' ? 'Left' : 'Right'} ${j.link.replace('_', ' ')}`, link: lid, material: spec.structural, profile: j.link === 'foot' ? 'chassis' : 'cantilever',
        color: j.link === 'foot' ? spec.accentColor : spec.primaryColor, solid: mir(j.solid, k), printRot: [0, k > 0 ? -90 : 90, 0],
        printNote: j.link === 'foot' ? 'Hub plate face down; supports under the sole.' : 'Plate face down; the servo housing prints upright.' });
      const o = j.f.pos;
      // the joint axis is the servo shaft: +x for an outward shaft on the right, mirrored on the left
      const ax = (j.out ? 1 : -1) * k;
      const axis: Vec3 = j.id === 'roll' ? [0, k, 0] : [ax, 0, 0];   // the roll shaft points forward
      // (added once the composer has made the base link: a link's parent comes first; the part's solid then, as the
      // feet may have grown under the centre of mass)
      const partId = `${j.link}_${s}`;
      links.push(() => { const q = bb(b.parts.find(p => p.id === partId)!.solid); b.link({ id: lid, name, parent: j.parent(s),
        joint: { origin: [k * o[0], o[1], o[2]], axis, limit: range[j.id], actuator: { kind: 'servo', catalogId: servoId, port, label: lid } },
        colliders: [{ shape: 'box', center: [(q.min[0] + q.max[0]) / 2, (q.min[1] + q.max[1]) / 2, (q.min[2] + q.max[2]) / 2],
          half: [(q.max[0] - q.min[0]) / 2, (q.max[1] - q.min[1]) / 2, (q.max[2] - q.min[2]) / 2], friction: j.id === 'roll' ? 0.9 : 0.5 }] }); });
    }
  }
  // servo leads down the legs: each knee and ankle lead runs clipped along the thigh / shin plate, with a service
  // loop over every joint, up to the hip housing and in through its lead channel
  const centreOf = (m: M): Vec3 => { const q = bb(m); return [0, 1, 2].map(i => (q.min[i] + q.max[i]) / 2) as Vec3; };
  for (const { s, k } of sides) {
    const at = (f: Frame) => centreOf(place(servoSolid(), mf(f, k)));
    b.cablePort(at(hipF), at(kneeF), `${s === 'L' ? 'left' : 'right'} knee lead along the thigh`, 20);
    b.cablePort(at(kneeF), at(ankleF), `${s === 'L' ? 'left' : 'right'} ankle lead along the shin`, 20);
    b.cablePort(at(ankleF), at(rollF), `${s === 'L' ? 'left' : 'right'} ankle-roll lead over the ankle`, 20);
  }
  b.extra('Cable clips / zip ties for the leg servo leads', 10);
  b.screw('M2×8 self-tap', 16, 'leg servo ears into their housings');
  b.screw('M2×6 self-tap', 16, 'horns to the thigh, shin, ankle block and foot hubs');
  b.step(`Legs: centre all eight servos (\`calib\`) with the legs straight. Push the hip servos into the housings on the base sides, the knee servos into the thighs, the ankle servos into the shins and the ankle-roll servos (lying, shaft forward) into the ankle blocks (ears screwed, 2 × M2×8 each). Leads: hips S1 / S2, knees S3 / S4, ankles S5 / S6, ankle rolls S7 / S8 (left / right) on the PCA9685. Fit each horn into its hub, legs straight and feet flat, and drive the centre screws.`);
  b.check({ id: 'legs', label: 'Walking legs', status: 'pass',
    detail: `Two 4-DOF legs (hip, knee and ankle pitch plus ankle roll: ${servoId} × 8 on PCA9685 S1-S8, joints from S9): thigh and shin ${L.toFixed(0)} mm, feet ${(sx1 - sx0).toFixed(0)} × ${footLen.toFixed(0)} mm, ${(2 * sx1).toFixed(0)} mm across; the base sits ${(-ground).toFixed(0)} mm above the floor. The ankle rolls lean the robot over one flat foot so the other lifts and steps (forward with the pitch joints, sideways with the rolls).` });
  // standing on both feet: the support polygon is their hull
  let y0 = yh - footBack, y1 = y0 + footLen;
  const legs: Legs = {
    lift: -ground, support: [], colliders: [], ports: 8, addLinks: () => links.forEach(f => f()),
    // The robot's centre of mass (a big head, a beak out front) must stand over the feet with a margin: the soles grow
    // forward or back until it is well inside them (≤ 140 mm long).
    fitFeet: (comY: number, comZ: number) => {
      // the taller the robot, the more foot it needs each way (≈ 14° of tilt before the centre of mass leaves the sole)
      const margin = Math.max(22, Math.min(55, 0.25 * (comZ - ground)));
      const lo = Math.min(y0, comY - margin), hi = Math.max(y1, comY + margin);
      if (hi - lo > 140 || (lo === y0 && hi === y1)) return;
      for (const { s, k } of sides) {
        const p = b.parts.find(q => q.id === `foot_${s}`);
        if (p) p.solid = union([p.solid, mir(rrect(sx1 - sx0, hi - lo, 8, (sx0 + sx1) / 2, (lo + hi) / 2, ground, soleTop), k)]);
      }
      y0 = lo; y1 = hi;
      legs.support = [[-sx1, y0], [sx1, y0], [sx1, y1], [-sx1, y1]];
    },
  };
  legs.support = [[-sx1, y0], [sx1, y0], [sx1, y1], [-sx1, y1]];
  return legs;
}
