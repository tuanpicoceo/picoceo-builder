// 4-servo desk arm: base yaw (S1), shoulder (S2), elbow (S3), gripper (S4).
// Every link is a flat plate driven directly by a horn; servo ears are screwed to the plate's outer
// face from outside, horn centre screws go through Ø6.5 tunnels.

import { FIT, HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, box, sub, union } from './kernel';
import { EAR_HOLES, HORN_SEAT, SV, SV_X0, SV_X1, electronics, hornSeatCuts, hornSolid, place, servoSolid, servoTower, type Frame } from './modules';
import { cylZ } from './kernel';
import { deskBase } from './companion';
import { CLAW, machineBase } from './machine';
import type { Vec3 } from './types';

/** Pocket + ear taps for a servo whose ear face sits on a plate's outer face (plate on the -z side of S). */
const plateServoCuts = (t: number) => union([
  box(SV_X0 - FIT.push / 2, SV_X1 + FIT.push / 2, -SV.W / 2 - FIT.push / 2, SV.W / 2 + FIT.push / 2, -t - 1, 1),
  ...EAR_HOLES.map(ex => cylZ(ex, 0, HOLES.M2.tap / 2, -t - 0.5, 1, 16)),
]);

export function buildArm(b: Build, spec: RobotSpec) {
  const P = spec.params;
  const L1 = P.upperLen, L2 = P.foreLen, gL = P.gripperLen;
  // LicheeRV Claw kit: the console comes with the base and the yaw tower rises so the turntable clears it
  const claw = spec.platform === 'licheerv_claw';
  const base = claw ? machineBase(b, spec, { clampTabs: true, servoDriver: true }) : deskBase(b, spec, { clampTabs: true });
  if (!claw) {
    const el = electronics(b, 'base', base.deckTop, { shield: [0, -20.2], hub: [-22, 10], sw: [18.2, 12] });
    base.deckAdds.push(el.add); base.deckCuts.push(el.cut);
  }

  const yp = 20;
  const st = servoTower(b, 'base', 'yaw', base.deckTop, 0, yp, 'yaw', 'Base yaw servo (S1)', claw ? CLAW.coverTop + 2 - 29.1 : 0);
  base.deckAdds.push(st.tower); base.deckCuts.push(st.towerCut);
  const status: Vec3[] = [[-20.5, -26, base.deckTop], [20.5, -26, base.deckTop], [-20.5, -17, base.deckTop], [20.5, -17, base.deckTop], [-20.5, 30, base.deckTop], [20.5, 30, base.deckTop]];
  base.finishDeck(claw ? [] : status.slice(0, P.leds));

  // ---------------------------------------------------------------- turntable (yaw link)
  const ps = st.seat;
  const xr = -4.1;                                   // shoulder servo ear face
  const zs = ps + 4 + 0.6 + SV.W / 2;                // shoulder axis
  const shF: Frame = { rots: [[0, 90, 0], [-90, 0, 0]], pos: [xr, yp, zs] };   // S z->+X, S x->-Y
  const xu0 = xr + HORN_SEAT;                        // upper arm plate inner face (6.0)
  const turntable = sub(union([
    box(-24, xu0 - 0.5, yp - 12, yp + 12, ps, ps + 4),
    box(xr - 5, xr, yp - (SV_X1 + 6.3), yp - (SV_X0 - 6.3), ps, zs + SV.W / 2 + 3),
  ]), place(hornSeatCuts(4), st.frame), place(plateServoCuts(5), shF));
  b.part({ id: 'turntable', name: 'Turntable', link: 'yaw', material: spec.structural, profile: 'motorMount', color: spec.accentColor, solid: turntable, printRot: [0, 0, 0], printNote: 'Base plate down; the servo wall prints upright.' });
  b.comp({ key: 'servo_sh', catalogId: 'B-PG001', label: 'Shoulder servo (S2)', link: 'yaw', solid: place(servoSolid(), shF) });
  b.comp({ key: 'horn_sh', catalogId: 'horn', label: 'Shoulder horn', link: 'upper', solid: place(hornSolid(), shF), color: '#f0f0f0' });

  // ---------------------------------------------------------------- upper arm
  const ze = zs + L1;
  const elF: Frame = { rots: [[0, 90, 0]], pos: [xu0 + 5, yp, ze] };          // S z->+X, S x->-Z
  const upper = sub(union([
    box(xu0, xu0 + 5, yp - 18, yp + 8, zs - 6, zs + 8),
    box(xu0, xu0 + 5, yp - 8, yp + 8, zs - 6, ze + 12.5),
  ]), place(hornSeatCuts(5), shF), place(plateServoCuts(5), elF));
  b.part({ id: 'upper_arm', name: 'Upper arm', link: 'upper', material: spec.structural, profile: 'cantilever', color: spec.primaryColor, solid: upper, printRot: [0, 90, 0], printNote: 'On its side (flat face down) so the layers run along the arm.' });
  b.comp({ key: 'servo_el', catalogId: 'B-PG001', label: 'Elbow servo (S3)', link: 'upper', solid: place(servoSolid(), elF) });
  b.comp({ key: 'horn_el', catalogId: 'horn', label: 'Elbow horn', link: 'fore', solid: place(hornSolid(), elF), color: '#f0f0f0' });

  // ---------------------------------------------------------------- forearm (+ fixed finger)
  const xf0 = xu0 + 5 + HORN_SEAT;
  const yw = yp + L2;
  const zp = ze - 10;                                // pinch line
  const grF: Frame = { rots: [[0, 90, 0], [-90, 0, 0]], pos: [xf0 + 5, yw, ze] };
  const xg0 = xf0 + 5 + HORN_SEAT;
  const fore = sub(union([
    box(xf0, xf0 + 5, yp - 8, yp + 8, ze - 18, ze + 8),
    box(xf0, xf0 + 5, yp - 8, yw + 12.5, zp - 5, ze + 8),
    box(xf0, xg0 + 5, yw + 11, yw + 19, zp - 5, zp),          // bridge to the finger plane
    box(xg0, xg0 + 5, yw + 11, yw + 12 + gL, zp - 5, zp),     // fixed finger
  ]), place(hornSeatCuts(5), elF), place(plateServoCuts(5), grF));
  b.part({ id: 'forearm', name: 'Forearm + fixed finger', link: 'fore', material: spec.structural, profile: 'cantilever', color: spec.primaryColor, solid: fore, printRot: [0, -90, 0], printNote: 'On its side, finger bridge up (short bridge).' });
  b.comp({ key: 'servo_gr', catalogId: 'B-PG001', label: 'Gripper servo (S4)', link: 'fore', solid: place(servoSolid(), grF) });
  b.comp({ key: 'horn_gr', catalogId: 'horn', label: 'Gripper horn', link: 'grip', solid: place(hornSolid(), grF), color: '#f0f0f0' });

  // ---------------------------------------------------------------- jaw
  const jaw = sub(union([
    box(xg0, xg0 + 5, yw - 18, yw + 8, ze - 8, ze + 8),
    box(xg0, xg0 + 5, yw, yw + 12 + gL, zp + 0.5, zp + 5.5),
  ]), place(hornSeatCuts(5), grF));
  b.part({ id: 'jaw', name: 'Gripper jaw', link: 'grip', material: spec.structural, profile: 'cantilever', color: spec.accentColor, solid: jaw, printRot: [0, 90, 0], printNote: 'On its side.' });

  b.meta = { payload: { link: 'grip', at: [xg0 + 2.5, yw + 12 + gL * 0.6, zp] }, clampable: true,
    support: [[-28, -37], [28, -37], [28, 36], [-28, 36]] };

  // ---------------------------------------------------------------- links
  b.link({ id: 'base', name: 'Base', parent: null, colliders: base.colliders });
  b.link({ id: 'yaw', name: 'Base yaw', parent: 'base', joint: { origin: [0, yp, st.towerTop], axis: [0, 0, 1], limit: [-90, 90], actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S1', label: 'yaw' } },
    colliders: [{ shape: 'box', center: [-9, yp - 3, (ps + zs + 9) / 2], half: [15, 15, (zs + 9 - ps) / 2] }] });
  b.link({ id: 'upper', name: 'Shoulder', parent: 'yaw', joint: { origin: [xr, yp, zs], axis: [1, 0, 0], limit: [-50, 50], actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S2', label: 'shoulder' } },
    colliders: [{ shape: 'box', center: [xu0 + 2.5, yp, (zs - 6 + ze + 12.5) / 2], half: [2.5, 8, (ze + 18.5 - zs) / 2] }] });
  b.link({ id: 'fore', name: 'Elbow', parent: 'upper', joint: { origin: [xu0 + 5, yp, ze], axis: [1, 0, 0], limit: [-45, 90], actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S3', label: 'elbow' } },
    colliders: [
      { shape: 'box', center: [xf0 + 2.5, (yp - 8 + yw + 12.5) / 2, (zp - 5 + ze + 8) / 2], half: [2.5, (yw + 20.5 - yp) / 2, (ze + 13 - zp) / 2] },
      { shape: 'box', center: [xg0 + 2.5, yw + 11.5 + gL / 2, zp - 2.5], half: [2.5, gL / 2 + 0.5, 2.5], friction: 1.0 },
    ] });
  b.link({ id: 'grip', name: 'Gripper', parent: 'fore', joint: { origin: [xf0 + 5, yw, ze], axis: [1, 0, 0], limit: [0, 45], actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S4', label: 'gripper' } },
    colliders: [{ shape: 'box', center: [xg0 + 2.5, yw + 6 + gL / 2, zp + 3], half: [2.5, 6 + gL / 2, 2.5], friction: 1.0 }] });

  b.screw('M2×8 self-tap', 8, 'servo ears (servo bag)');
  b.screw('M2×6 self-tap', 8, 'horn arms to the links (servo bag)');
  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass', detail: 'Every horn centre screw has a Ø6.5 tunnel through the driven plate; servo ears are screwed from the open outer face of each plate.' });
  b.check({ id: 'orientation', label: 'Print orientation (bending loads)', status: 'pass', detail: 'Upper arm, forearm and jaw print on their side so the layers run along the bending direction (guide s.7).' });
  b.step('3. Centre all servos with `calib`. Screw the yaw servo into the tower and the shoulder servo onto the turntable wall.');
  b.step('4. Fit horns into the recesses of the turntable, upper arm, forearm and jaw (2 × M2 per horn). Press each onto its spline at the zero pose shown in the viewer (upper arm vertical, forearm forward, gripper closed) and drive the centre screws through the Ø6.5 tunnels.');
  b.step('5. Screw the base tabs to the desk (M4) or clamp them: the arm can tip an unclamped base at full reach.');
  b.extra('Grip tape / TPU pads for the fingers (optional)', 2);
}
