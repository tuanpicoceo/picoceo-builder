// 1-DOF swing lever: barrier gates, catapults, flag wavers, flippers, drawbridges, hammers, wipers,
// railway-crossing arms. One B-PG001 (S1) on a ribbed deck pillar with a horizontal shaft (+X); the lever
// plate rides on the horn and swings in the YZ plane from -15° (down) to +90° (up).

import type { RobotSpec } from '../design/spec';
import { Build, box, cylX, cylZ, hull, sub, union, type M } from './kernel';
import { axisWorld, hornSeatCuts, place } from './modules';
import { machineBase, sidePillarServo } from './machine';
import type { Collider } from './types';

export function buildLever(b: Build, spec: RobotSpec) {
  const P = spec.params;
  const L = P.leverLen;
  const base = machineBase(b, spec);
  const deckTop = base.deckTop;
  const xr = 4, yp = 20, zt = deckTop + P.pivotH;
  const sp = sidePillarServo(b, 'base', 'lever', deckTop, xr, yp, zt, 'lever', 'Lever servo (S1)');
  base.deckAdds.push(sp.pillar); base.deckCuts.push(sp.leadCut);
  base.finishDeck(base.statusLeds(P.leds));

  // ---------------------------------------------------------------- lever (on the horn)
  const x0 = sp.faceX, T = 5, x1 = x0 + T, xm = (x0 + x1) / 2;
  const yEnd = yp + L;
  const hub = box(x0, x1, yp - 19, yp + 8, zt - 7, zt + 7);
  const beam = hull([box(x0, x1, yp, yp + 1, zt - 6, zt + 6), box(x0, x1, yEnd - 1, yEnd, zt - 3.5, zt + 3.5)]);
  const tool = P.leverTool;
  const adds: M[] = [hub, beam];
  const cuts: M[] = [place(hornSeatCuts(T), sp.frame)];
  let colliders: Collider[] = [{ shape: 'box', center: [xm, (yp - 19 + yEnd) / 2, zt], half: [T / 2, (yEnd - yp + 19) / 2, 7] }];
  let payloadAt: [number, number, number] = [xm, yEnd - 4, zt + 4];
  if (tool === 'cup') {
    // catapult bucket: Ø20 cup on the beam end, opening up at the zero pose
    const cy = yEnd - 9;
    adds.push(cylZ(xm, cy, 10, zt + 2, zt + 13, 40));
    cuts.push(cylZ(xm, cy, 8, zt + 4.5, zt + 14, 40));
    payloadAt = [xm, cy, zt + 7];
    colliders.push({ shape: 'box', center: [xm, cy, zt + 7.5], half: [10, 10, 5.5], friction: 0.9 });
  } else if (tool === 'flag') {
    const fy0 = Math.max(yp + 20, yEnd - 45);
    adds.push(box(x0 + 1.5, x1 - 1.5, fy0, yEnd, zt + 3, zt + 30));
    colliders.push({ shape: 'box', center: [xm, (fy0 + yEnd) / 2, zt + 16.5], half: [1, (yEnd - fy0) / 2, 13.5] });
  } else if (tool === 'paddle') {
    const py0 = Math.max(yp + 25, yEnd - 30);
    adds.push(box(x0 - 8, x1 + 8, py0, yEnd, zt - 4, zt + 4));
    colliders.push({ shape: 'box', center: [xm, (py0 + yEnd) / 2, zt], half: [T / 2 + 8, (yEnd - py0) / 2, 4], friction: 0.8 });
  } else {
    // barrier boom: rounded tip knob and reflective stripe recesses
    adds.push(cylX(yEnd, zt, 4.5, x0, x1, 24));
    for (let y = yp + 30; y < yEnd - 12; y += 24) cuts.push(box(x1 - 0.6, x1 + 1, y, y + 10, zt - 2.5, zt + 2.5));
  }
  const lever = sub(union(adds), ...cuts);
  const toolName = ({ cup: 'Catapult arm + cup', flag: 'Flag arm', paddle: 'Paddle arm' } as Record<string, string>)[tool] ?? 'Boom arm';
  b.part({ id: 'lever', name: toolName, link: 'lever', material: spec.structural, profile: 'cantilever', color: spec.accentColor, solid: lever,
    printRot: [0, 90, 0], printNote: 'On its side (plate face down) so the layers run along the arm (guide s.7).' });

  b.link({ id: 'base', name: 'Base', parent: null, colliders: base.colliders });
  b.link({ id: 'lever', name: 'Lever', parent: 'base',
    joint: { origin: [xr, yp, zt], axis: axisWorld(sp.frame), limit: [-15, 90], actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S1', label: 'lever' } },
    colliders });
  b.meta = { payload: { link: 'lever', at: payloadAt }, support: [[-28, -37], [28, -37], [28, 36], [-28, 36]] };

  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass',
    detail: 'Servo ears screw into the open outer face of the pillar; the horn centre screw is driven through the Ø6.5 tunnel in the lever hub.' });
  b.check({ id: 'orientation', label: 'Print orientation (bending loads)', status: 'pass',
    detail: 'The lever prints on its side so the perimeters run along the arm; the pillar is ribbed front and rear.' });
  b.screw('M2×8 self-tap', 2, 'servo ears to pillar');
  b.screw('M2×6 self-tap', 2, 'horn arm to lever hub');
  b.step('3. Centre the servo (`calib`), push it through the pillar from the outside and screw the ears (2 × M2×8).');
  b.step(`4. Screw the horn into the lever hub recess, press it onto the spline with the ${toolName.toLowerCase()} level and pointing forward, and drive the centre screw through the Ø6.5 tunnel.`);
}
