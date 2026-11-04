// Drive base for a talking robot that drives around (composition mobility "wheels" on XiaoZhi / Raspberry Pi / Jetson).
// The hollow voice body sits in the tray of a printed drive plate; the voice core's two floor screws come up through
// the plate too, so one pair of screws holds plate, body and sled. The wheels hang under the plate, driven either by
//   continuous micro servos   (FS90R) between pillar pairs, one servo board channel each (the rover's servo drive)
//   DC gear motors            (GA12-N20, catalog N20-MOTOR) in clip-in blocks with a strap, through an H-bridge module (DRV8833: 2
//                             channels per side, TB6612FNG: 3) whose inputs take servo board channels. The PCA9685
//                             can't power a motor itself (≈25 mA logic outputs); on 4 wheels each side's pair runs
//                             in parallel on one bridge.
// with 2 wheels behind the middle plus a front skid (a tripod), or 4 wheels steered like a tank.
// Everything here is built below the body floor (z = 0); the composer then lifts the whole build onto the ground.

import { FIT, HOLES } from '../catalog/rules';
import { CATALOG } from '../catalog/components';
import type { RobotSpec } from '../design/spec';
import { Build, box, cylX, cylZ, rrect, sphere, sub, union, type M } from './kernel';
import { EAR_HOLES, HORN_SEAT, SV, SV_X0, SV_X1, hornSeatCuts, hornSolid, place, servoSolid, type Frame } from './modules';
import type { Collider, Vec3 } from './types';

const PLATE = 5;          // plate thickness (the sled screws' counterbores sink 3 mm into it from below)
const LIP = 3, LIP_T = 2, GAP = 0.4;   // tray lip round the body's foot
// GA12-N20: 12 x 10 mm body (12 along y, 10 along z here), 9 mm gearbox + 15 mm can + 2.5 mm end cap, Ø3 D-shaft 10 mm
const N20 = { w: 12, h: 10, gear: 9, len: 26.5, shaft: 10, holes: 4.5 };

export interface VoiceDriveIn {
  foot: { min: Vec3; max: Vec3 };     // the body's flat bottom (z = 0)
  servoId: string;                    // continuous micro servo
  /** DC gear motors through an H-bridge instead of continuous servos; `stocked` = the driver is in the directory */
  motor?: { id: string; driver: string; stocked: boolean } | null;
  count: 2 | 4;
  firstPort: number;                  // servo board channel of the first wheel (after the joints)
  screws: [number, number][];         // voice core floor screws (through the plate)
  lead: [number, number] | null;      // where the wheel leads go up through the body floor to the core
  battery?: string | null;
}

export function buildVoiceDrive(b: Build, spec: RobotSpec, o: VoiceDriveIn) {
  const P = spec.params;
  const motor = o.motor ?? null;
  // the wheels sit under the plate, so they set the ride height: Ø44-52 keeps the robot low
  // (four wheels take Ø44, so both pairs fit under a ~95 mm deep foot)
  const R = o.count === 4 ? 22 : Math.min(26, Math.max(22, P.wheelDia / 2)), W = Math.min(16, Math.max(10, P.wheelWidth));
  const f = o.foot;
  const px0 = f.min[0] - GAP - LIP_T, px1 = f.max[0] + GAP + LIP_T, py0 = f.min[1] - GAP - LIP_T, py1 = f.max[1] + GAP + LIP_T;
  const zBot = -PLATE, zA = zBot - 1 - R, ground = zA - R;   // the wheel tops stay 1 mm under the plate
  const half = Math.min(-px0, px1);
  // servo: ear face, the wheel's outer face flush with the plate edge (servos back to back at least)
  // motor: gearbox face, the wheel 2.5 mm out past the block's end wall (motors back to back at least)
  const xs = motor ? Math.max(N20.len + 2.5, half - 2.5 - W) : Math.max(21, half - HORN_SEAT - W);
  const wheelX0 = motor ? xs + 2.5 : xs + HORN_SEAT, wc = wheelX0 + W / 2;
  // wheel axles (y): a pair at each end, or one pair behind the middle with a skid in front
  const lo = py0 + Math.max(R + 1, 13), hi = py1 - Math.max(R + 1, 24);
  let count = o.count;
  if (count === 4 && hi - lo < 2 * R + 4) {
    count = 2;
    b.check({ id: 'drive_4wd', label: 'Four wheels', status: 'warn', detail: `The body's foot (${(py1 - py0).toFixed(0)} mm deep) is too short for two wheel pairs of Ø${2 * R}: two drive wheels and a front skid instead.` });
  }
  const axles = count === 4 ? [lo, hi] : [Math.max(lo, (py0 + py1) / 2 - 0.15 * (py1 - py0))];
  const skidY = py1 - 9;

  const adds: M[] = [rrect(px1 - px0, py1 - py0, 6, (px0 + px1) / 2, (py0 + py1) / 2, zBot, 0)];
  adds.push(sub(rrect(px1 - px0, py1 - py0, 6, (px0 + px1) / 2, (py0 + py1) / 2, 0, LIP),
    box(f.min[0] - GAP, f.max[0] + GAP, f.min[1] - GAP, f.max[1] + GAP, -1, LIP + 1)));
  const cuts: M[] = [];
  const frames: { side: 'L' | 'R'; end: string; fr: Frame; y: number }[] = [];
  const hz0 = zA - N20.h / 2 - 0.2;               // underside of a motor pocket (open; the strap closes it)
  for (const [k, wy] of axles.entries()) {
    const end = count === 4 && k === 1 ? 'F' : '';
    const fr: Frame = { rots: [[0, 0, 90], [0, 90, 0]], pos: [xs, wy, zA] };   // servo x -> +Y, y -> +Z, shaft -> +X
    frames.push({ side: 'L', end, fr: { ...fr, mirrorX: true }, y: wy }, { side: 'R', end, fr, y: wy });   // left first, as on the rover
    for (const s of [-1, 1]) {
      const X = (a: number, c: number): [number, number] => (s > 0 ? [a, c] : [-c, -a]);   // an x range on this side
      if (motor) {
        // motor block: a pocket open underneath, the gearbox face against a 2 mm end wall (shaft + 2 × M1.6 holes),
        // 4 mm side walls tapped for the strap; the can's back end and terminals stick out inboard for the leads
        adds.push(box(...X(xs - 24, xs + 2), wy - 10.2, wy + 10.2, hz0, zBot + 0.01));
        cuts.push(box(...X(xs - 30, xs), wy - N20.w / 2 - 0.2, wy + N20.w / 2 + 0.2, hz0 - 1, zA + N20.h / 2 + 0.2),
          cylX(wy, zA, 2.3, ...X(xs - 1, xs + 3), 24),
          ...[-1, 1].map(t => cylX(wy + t * N20.holes, zA, 0.95, ...X(xs - 1, xs + 3), 12)),
          ...[-1, 1].map(t => cylZ(s * (xs - 12), wy + t * 8.2, HOLES.M2.tap / 2, hz0 - 1, hz0 + 7, 12)));
      } else {
        // two pillars per servo (ahead of and behind its case) carry the ears; the ear screws go in from the wheel side
        adds.push(box(...X(xs - 9, xs), wy - 12.5, wy + SV_X0 - 0.2, zA - SV.W / 2, zBot + 0.01), box(...X(xs - 9, xs), wy + SV_X1 + 0.2, wy + 23.5, zA - SV.W / 2, zBot + 0.01));
        for (const ey of EAR_HOLES) cuts.push(cylX(wy + ey, zA, HOLES.M2.tap / 2, ...X(xs - 8, xs + 1), 16));
      }
    }
  }
  // front skid: a post with a Ø12 dome on the ground
  if (count === 2) adds.push(cylZ(0, skidY, 5, ground + 6, zBot + 0.01, 24), sphere([0, skidY, ground + 6], 6, 24));
  // H-bridge module in a 3 mm rim under the plate (foam tape), between the motor pairs / ahead of the axle
  if (motor) {
    const [dw, dd, dh] = CATALOG[motor.driver]?.size ?? [20, 20, 4];
    const ahead = axles[0] + 10.2 + 4 + dd / 2;
    const dy = count === 4 ? (axles[0] + axles[1]) / 2 : ahead + dd / 2 + 4 < skidY - 6 ? ahead : axles[0] - 10.2 - 4 - dd / 2;
    adds.push(sub(box(-dw / 2 - 1.9, dw / 2 + 1.9, dy - dd / 2 - 1.9, dy + dd / 2 + 1.9, zBot - 3, zBot + 0.01), box(-dw / 2 - 0.3, dw / 2 + 0.3, dy - dd / 2 - 0.3, dy + dd / 2 + 0.3, zBot - 4, zBot + 0.02)));
    b.comp({ key: 'drive_driver', catalogId: motor.driver, label: CATALOG[motor.driver]?.name ?? motor.driver, link: 'base',
      solid: box(-dw / 2, dw / 2, dy - dd / 2, dy + dd / 2, zBot - dh, zBot), color: '#b91c1c' });
  }
  // the core's floor screws (M3×16 now) go up through the plate; heads sink into it from below
  for (const [x, y] of o.screws) cuts.push(cylZ(x, y, HOLES.M3.clear / 2, zBot - 1, LIP + 1, 16), cylZ(x, y, HOLES.M3.cbore / 2, zBot - 1, zBot + 3, 20));
  // wheel leads up into the body
  const bodyCuts: M[] = [];
  if (o.lead) {
    cuts.push(box(o.lead[0] - 7, o.lead[0] + 7, o.lead[1] - 4, o.lead[1] + 4, zBot - 1, 1));
    bodyCuts.push(box(o.lead[0] - 7, o.lead[0] + 7, o.lead[1] - 4, o.lead[1] + 4, -1, 4.5));
  }
  b.part({ id: 'drive_plate', name: 'Drive plate', link: 'base', material: spec.structural, profile: 'chassis', color: spec.accentColor,
    solid: sub(union(adds), ...cuts), printRot: [180, 0, 0], printNote: `Tray face down on the bed; the ${motor ? 'motor blocks' : 'servo pillars'} and the skid point up.` });

  // drives, wheels, links
  const rimR = P.tpuTires ? R - 3 : R;
  const names: Record<string, string> = { L: 'left', R: 'right' };
  const colliders: Collider[] = [
    { shape: 'box', center: [(px0 + px1) / 2, (py0 + py1) / 2, zBot / 2], half: [(px1 - px0) / 2, (py1 - py0) / 2, PLATE / 2], friction: 0.4 },
    ...(count === 2 ? [{ shape: 'ball' as const, center: [0, skidY, ground + 6] as Vec3, radius: 6, friction: 0.05 }] : []),
  ];
  // motor channels: each side's bridge (both wheels of a side on it), IN1 / IN2 (DRV8833) or PWM / IN1 / IN2 (TB6612)
  const perSide = motor ? (CATALOG[motor.driver]?.data?.channelsPerMotor ?? 2) : 0;
  const portOf = (side: 'L' | 'R', i: number) => (motor ? o.firstPort + (side === 'L' ? 0 : perSide) : o.firstPort + i);
  frames.forEach(({ side, end, fr, y }, i) => {
    const id = `wheel_${side}${end}`, label = `${names[side]}${end ? ' front' : count === 4 ? ' rear' : ''} wheel`;
    const Label = `${label[0].toUpperCase()}${label.slice(1)}`;
    const s = side === 'R' ? 1 : -1;
    const port = `S${portOf(side, i) + 1}`;
    const x0 = wheelX0, x1 = wheelX0 + W;
    const ring = [cylX(y, zA, rimR, x0, x0 + 3, 64), sub(cylX(y, zA, rimR, x0, x1, 64), cylX(y, zA, rimR - 2.4, x0 - 1, x1 + 1, 64))];
    if (P.tpuTires) ring.push(
      sub(cylX(y, zA, rimR + 1.2, x0, x0 + 1.2, 64), cylX(y, zA, rimR - 1, x0 - 1, x0 + 2, 64)),
      sub(cylX(y, zA, rimR + 1.2, x1 - 1.2, x1, 64), cylX(y, zA, rimR - 1, x1 - 2, x1 + 1, 64)));
    let right: M;
    if (motor) {
      // N20 in its pocket (flats up / down), D-shaft out through the end wall; the wheel hub takes the D-shaft
      const g0 = xs - N20.gear, c0 = xs - N20.len + 2.5;
      const can = box(c0, g0, y - N20.w / 2, y + N20.w / 2, zA - N20.h / 2, zA + N20.h / 2).intersect(cylX(y, zA, 6.6, c0 - 1, g0 + 1, 32));
      const shaft = sub(cylX(y, zA, 1.5, xs, xs + N20.shaft, 24), box(xs - 1, xs + N20.shaft + 1, y - 3, y + 3, zA + 1.0, zA + 3));
      const body = union([box(g0, xs, y - N20.w / 2, y + N20.w / 2, zA - N20.h / 2, zA + N20.h / 2), can,
        box(xs - N20.len, c0, y - 5, y + 5, zA - 4, zA + 4), cylX(y, zA, 2, xs, xs + 1, 24), shaft]);
      const mot = s > 0 ? body : body.mirror([1, 0, 0]);
      b.comp({ key: `motor_${id}`, catalogId: motor.id, label: `${Label} motor (${motor.driver.split('-')[0]} on ${port})`, link: 'base', solid: mot });
      b.allowContact(`Wheel ${side}${end}`, `${Label} motor (${motor.driver.split('-')[0]} on ${port})`);   // the D-shaft turns with the wheel
      ring.push(cylX(y, zA, 5, x0, xs + N20.shaft - 0.5, 32));
      const bore = sub(cylX(y, zA, (3 + FIT.press) / 2, x0 - 1, xs + N20.shaft + 0.5, 24), box(x0 - 2, xs + N20.shaft + 1, y - 5, y + 5, zA + 1.0 + FIT.press, zA + 5));
      right = sub(union(ring), bore);
      // strap under the pocket: 2 × M2 into the block walls
      const strap = sub(box(...(s > 0 ? [xs - 21, xs - 3] as const : [-(xs - 3), -(xs - 21)] as const), y - 10.2, y + 10.2, hz0 - 2.5, hz0),
        ...[-1, 1].map(t => cylZ(s * (xs - 12), y + t * 8.2, HOLES.M2.clear / 2, hz0 - 4, hz0 + 1, 12)));
      b.part({ id: `motor_strap_${side}${end}`, name: `Motor strap ${side}${end}`, link: 'base', material: spec.structural, profile: 'chassis', color: spec.accentColor,
        solid: strap, printRot: [0, 0, 0], printNote: 'Flat.' });
    } else {
      b.comp({ key: `servo_${id}`, catalogId: o.servoId, label: `${Label} servo (${port})`, link: 'base', solid: place(servoSolid(), fr) });
      b.comp({ key: `horn_${id}`, catalogId: 'horn', label: `${label} horn`, link: id, solid: place(hornSolid(), fr), color: '#f0f0f0' });
      // the right wheel is built on +x; the left one is its mirror (horn seat included)
      right = sub(union(ring), place(hornSeatCuts(3), { ...fr, mirrorX: false }));
    }
    const wheel = s > 0 ? right : right.mirror([1, 0, 0]);
    b.part({ id, name: `Wheel ${side}${end}`, link: id, material: spec.structural, profile: 'wheel', color: spec.accentColor, solid: wheel,
      printRot: s > 0 ? [0, -90, 0] : [0, 90, 0], printNote: 'Hub face down.' });
    if (P.tpuTires) {
      const tire = sub(cylX(y, zA, R, x0 + 1.2, x1 - 1.2, 64), cylX(y, zA, rimR, x0, x1, 64));
      b.part({ id: `tire_${side}${end}`, name: `Tyre ${side}${end}`, link: id, material: 'TPU 95A', profile: 'tire', color: '#2b2b2b',
        solid: s > 0 ? tire : tire.mirror([1, 0, 0]), printRot: [0, s > 0 ? -90 : 90, 0], printNote: 'Flat, TPU 95A; stretch over the rim between the lips.' });
    }
    b.link({ id, name: Label, parent: 'base',
      joint: { origin: [s * wheelX0, y, zA], axis: [-1, 0, 0],
        actuator: motor ? { kind: 'motor', catalogId: motor.id, port, label } : { kind: 'cservo', catalogId: o.servoId, port, label } },
      colliders: [{ shape: 'cylX', center: [s * wc, y, zA], radius: R, halfLen: W / 2, friction: P.tpuTires ? 1.1 : 0.6 }] });
  });

  const channels = motor
    ? `channels ${o.firstPort}-${o.firstPort + 2 * perSide - 1} to the ${CATALOG[motor.driver]?.name ?? motor.driver} inputs (left ${o.firstPort}-${o.firstPort + perSide - 1}, right ${o.firstPort + perSide}-${o.firstPort + 2 * perSide - 1})`
    : `channels ${frames.map((_, i) => o.firstPort + i).join(', ')}`;
  if (motor) {
    b.screw('M1.6×4', 2 * frames.length, 'N20 gearbox faces to the block end walls');
    b.screw('M2×8 self-tap', 2 * frames.length, 'motor straps into the motor blocks');
    b.extra('Double-sided foam tape (motor driver module)', 1);
    if (!motor.stocked) b.check({ id: 'motor_driver', label: 'Motor driver', status: 'warn',
      detail: `The PCA9685 can't power the ${motor.id} (its outputs are ~25 mA logic signals): it needs an H-bridge. Add a ${CATALOG[motor.driver]?.name ?? motor.driver} to your directory (a few dollars); its IN pins take the servo board channels.` });
    const cells = o.battery && /2S|7\.4|UPS/i.test(`${o.battery} ${CATALOG[o.battery]?.name ?? ''}`) ? 2 : 1;
    const vmin = CATALOG[motor.driver]?.data?.vinMin ?? 2.7;
    if (cells === 1 && vmin > 4.2) b.check({ id: 'motor_supply', label: 'Motor supply', status: 'warn',
      detail: `The ${CATALOG[motor.driver]?.name} needs ≥ ${vmin} V on VM, more than a 1S pack (3.0-4.2 V) gives: use a DRV8833 (2.7 V up) or a 2S pack.` });
  } else {
    b.screw('M2×8 self-tap', 2 * frames.length, 'drive servo ears into the plate pillars');
    b.screw('M2×6 self-tap', frames.length, 'horns to the wheel hubs');
  }
  if (P.tpuTires) b.extra('TPU 95A filament for tyres', 1);
  const support: [number, number][] = count === 4
    ? [[-wc, axles[0]], [wc, axles[0]], [wc, axles[1]], [-wc, axles[1]]]
    : [[-wc, axles[0]], [wc, axles[0]], [0, skidY]];
  const what = motor ? `${frames.length} × ${motor.id} DC gear motors through a ${CATALOG[motor.driver]?.name ?? motor.driver}${count === 4 ? ' (each side\'s pair in parallel)' : ''}` : `${frames.length} × ${o.servoId} continuous servos`;
  b.check({ id: 'voice_drive', label: 'Drive base', status: 'pass',
    detail: `${what} under a ${(px1 - px0).toFixed(0)} × ${(py1 - py0).toFixed(0)} mm drive plate on servo board ${channels}; Ø${2 * R} wheels, track ${(2 * wc).toFixed(0)} mm${count === 2 ? `, front skid ${(skidY - axles[0]).toFixed(0)} mm ahead of the axle` : ', tank steering'}; the body sits ${(-ground).toFixed(0)} mm above the floor.` });
  const step = motor
    ? `Drive base: push each ${motor.id} into its block (gearbox face against the end wall, 2 × M1.6), screw the straps on (2 × M2×8 each), stick the ${CATALOG[motor.driver]?.name ?? motor.driver} into its rim under the plate with foam tape and wire the motors to its outputs (${count === 4 ? 'each side\'s two motors in parallel on one output pair' : 'left on A, right on B'}). Run its ${motor.driver.startsWith('TB') ? 'PWMA / AIN1 / AIN2 / PWMB / BIN1 / BIN2' : 'IN1-IN4'} wires up through the slot to servo board ${channels.replace(/^channels /, 'channels ')} (signal pins only), VM to the battery and GND to the board ground${motor.driver.startsWith('TB') ? ', STBY to VCC' : ''}. Set the body into the tray, drive the two sled screws (M3×16) up through the plate, and press the wheels onto the D-shafts.`
    : `Drive base: screw the ${frames.length} ${o.servoId} servos between their pillars under the plate (ears from the wheel side, 2 × M2×8 each), feed their leads up through the slot into the body to ${channels} of the servo board, set the body into the tray and drive the two sled screws (M3×16, instead of M3×10) up through the plate. Press the wheels onto the horns and drive the centre screws.`;
  return { lift: -ground, colliders, support, wheelR: R, track: 2 * wc, bodyCuts, wheels: frames.length, channels: motor ? 2 * perSide : frames.length, step };
}
