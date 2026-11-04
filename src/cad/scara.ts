// 2-DOF SCARA arm: drawing robots / plotters, laser-pointer toys, planar pick-and-place and sorting arms.
// Shoulder B-PG001 (S1) in a raised deck tower, elbow B-PG001 (S2) dropped through the end of link 1 with
// its ears on top; both axes are vertical, so gravity never loads the servos. Link 2 carries a Ø10 pen /
// pointer holder with an M3 thumbscrew.

import { FIT, HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, cylX, cylZ, rrect, sub, union } from './kernel';
import { HORN_SEAT, axisWorld, hornSeatCuts, hornSolid, place, servoSolid, servoTower, type Frame } from './modules';
import { machineBase, plateServoCuts } from './machine';

export function buildScara(b: Build, spec: RobotSpec) {
  const P = spec.params;
  const L1 = P.upperLen, L2 = P.foreLen;
  const base = machineBase(b, spec);
  const yp = 20;
  // 4 mm riser: link 1 sweeps ≥ 2 mm above the electronics cover
  const st = servoTower(b, 'base', 'link1', base.deckTop, 0, yp, 'shoulder', 'Shoulder servo (S1)', 4);
  base.deckAdds.push(st.tower); base.deckCuts.push(st.towerCut);
  base.finishDeck(base.statusLeds(P.leds));

  const T = 5, W = 20;
  const z1 = st.seat, ye = yp + L1;
  const elF: Frame = { rots: [[0, 0, -90]], pos: [0, ye, z1 + T] };          // S x -> -Y: case toward the shoulder
  const l1y0 = yp - 19, l1y1 = ye + 12;
  const link1 = sub(rrect(W, l1y1 - l1y0, 6, 0, (l1y0 + l1y1) / 2, z1, z1 + T), place(hornSeatCuts(T), st.frame), place(plateServoCuts(T), elF));
  b.part({ id: 'link1', name: 'Link 1 (shoulder → elbow)', link: 'link1', material: spec.structural, profile: 'cantilever', color: spec.primaryColor,
    solid: link1, printRot: [0, 0, 0], printNote: 'Flat: the link is loaded in its own plane, so the layers already run along it.' });
  b.comp({ key: 'servo_elbow', catalogId: 'B-PG001', label: 'Elbow servo (S2)', link: 'link1', solid: place(servoSolid(), elF) });
  b.comp({ key: 'horn_elbow', catalogId: 'horn', label: 'Elbow horn', link: 'link2', solid: place(hornSolid(), elF), color: '#f0f0f0' });

  const z2 = z1 + T + HORN_SEAT, yt = ye + L2;
  const penR = (10 + FIT.push) / 2;                                              // Ø10 pen, push fit
  const link2 = sub(union([
    rrect(W, yt + 10 - (ye - 19), 6, 0, (ye - 19 + yt + 10) / 2, z2, z2 + T),
    cylZ(0, yt, penR + 2.6, z2, z2 + 20, 40),
  ]),
  place(hornSeatCuts(T), elF),
  cylZ(0, yt, penR, z2 - 1, z2 + 21, 40),
  cylX(yt, z2 + 14, HOLES.M3.tap / 2, 0, penR + 3, 16));                          // M3 thumbscrew
  b.part({ id: 'link2', name: 'Link 2 + pen holder', link: 'link2', material: spec.structural, profile: 'cantilever', color: spec.accentColor,
    solid: link2, printRot: [0, 0, 0], printNote: 'Flat, holder tube upright.' });

  b.link({ id: 'base', name: 'Base', parent: null, colliders: base.colliders });
  b.link({ id: 'link1', name: 'Shoulder', parent: 'base',
    joint: { origin: [0, yp, st.towerTop], axis: [0, 0, 1], limit: [-90, 90], actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S1', label: 'shoulder' } },
    colliders: [{ shape: 'box', center: [0, (l1y0 + l1y1) / 2, z1 + T / 2], half: [W / 2, (l1y1 - l1y0) / 2, T / 2] }] });
  b.link({ id: 'link2', name: 'Elbow', parent: 'link1',
    joint: { origin: [0, ye, z1 + T], axis: axisWorld(elF), limit: [-90, 90], actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S2', label: 'elbow' } },
    colliders: [{ shape: 'box', center: [0, (ye - 19 + yt + 10) / 2, z2 + T / 2], half: [W / 2, (yt + 29 - ye) / 2, T / 2] }] });
  b.meta = { payload: { link: 'link2', at: [0, yt, z2 + 10] }, support: [[-28, -37], [28, -37], [28, 36], [-28, 36]] };

  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass',
    detail: 'Both horn centre screws are driven straight down Ø6.5 tunnels; the elbow servo ears screw onto the open top of link 1.' });
  b.check({ id: 'reach', label: 'Workspace', status: 'pass',
    detail: `Reach ${(L1 + L2).toFixed(0)} mm (min ${Math.abs(L1 - L2).toFixed(0)} mm); shoulder ±90°, elbow ±90° (the servo's travel). Keep the drawing area in front of the base: the pen is not modelled below the holder.` });
  b.screw('M2×8 self-tap', 4, 'servo ears (servo bag)');
  b.screw('M2×6 self-tap', 4, 'horn arms to the links (servo bag)');
  b.screw('M3×8', 1, 'pen thumbscrew');
  b.extra('Pen / marker Ø10 (or laser pointer)', 1);
  b.step('3. Centre both servos (`calib`). Drop the shoulder servo into the tower and the elbow servo down through link 1; screw all ears.');
  b.step('4. Fit the horns into link 1 and link 2, press them on with both links pointing straight forward, and drive the centre screws through the Ø6.5 tunnels.');
  b.step('5. Clamp the pen in the holder so its tip just touches the paper at the zero pose.');
}
