// Continuous rotor on a B-PG002 (S1): fans, windmills, ferris / display wheels, paddle wheels (horizontal
// shaft on a deck pillar) and compartment carousels for pet feeders, dispensers and sorters (vertical shaft
// on a raised tower). The rotor has no joint limit; clearances are designed in instead of swept.

import { FIT } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, box, cylX, cylZ, hull, sphere, sub, union, type M } from './kernel';
import { axisWorld, hornSeatCuts, place, servoTower } from './modules';
import { machineBase, sidePillarServo } from './machine';

const spin = { kind: 'cservo' as const, catalogId: 'B-PG002', port: 'S1', label: 'spin' };

export function buildRotor(b: Build, spec: RobotSpec) {
  if (spec.params.rotorStyle === 'carousel') return buildCarousel(b, spec);
  const P = spec.params;
  const R = P.rotorDia / 2;
  const n = Math.round(P.bladeCount);
  const style = P.rotorStyle;
  const base = machineBase(b, spec);
  const deckTop = base.deckTop;
  // Pillar height: the swept disc (plus the 10 mm wheel gondolas) clears the switch / LED hub (deck + 14) by
  // 4 mm and the rear electronics cover (deck + 29.5, y ≤ -5) by the 2 mm rotating-part gap.
  const xr = 4, yp = 20;
  const hang = style === 'wheel' ? 10 : 0;
  const overCover = base.coverTop + 2 + Math.sqrt(Math.max(0, R * R - (yp + 5) ** 2));
  const zt = deckTop + Math.max(P.pivotH, R + hang + 18, overCover + hang);
  const sp = sidePillarServo(b, 'base', 'rotor', deckTop, xr, yp, zt, 'rotor', 'Rotor servo (S1)', 'B-PG002');
  base.deckAdds.push(sp.pillar); base.deckCuts.push(sp.leadCut);
  base.finishDeck(base.statusLeds(P.leds));

  const x0 = sp.faceX, xm = x0 + 2.5;
  /** Rotate a rotor feature drawn in the plane through the axis (radial = +Z) to blade i. */
  const around = (m: M, i: number) => m.rotate([(360 / n) * i, 0, 0]).translate([0, yp, zt]);
  const nose = sub(sphere([x0 + 6, yp, zt], 9, 32), box(x0 - 4, x0 + 6, yp - 10, yp + 10, zt - 10, zt + 10));
  const hub = union([cylX(yp, zt, 19, x0, x0 + 6, 48), nose]);
  const adds: M[] = [hub];
  const cuts: M[] = [place(hornSeatCuts(6), sp.frame), cylX(yp, zt, FIT.tunnel / 2, x0 + 5, x0 + 16, 24)];
  let name = 'Fan rotor';
  if (style === 'fan') {
    // pitched blades (25°), wider at the tip
    const blade = hull([box(-1, 1, -5, 5, 15, 16), box(-1, 1, -11, 11, R - 1, R)]).rotate([0, 0, 25]).translate([xm, 0, 0]);
    for (let i = 0; i < n; i++) adds.push(around(blade, i));
  } else if (style === 'windmill') {
    name = 'Windmill sails';
    const spar = box(xm - 1.5, xm + 1.5, -1.5, 1.5, 15, R);
    const w = Math.min(18, R * 0.35);
    const sail = sub(box(xm - 1, xm + 1, 1.5, 1.5 + w, R * 0.35, R),
      ...[0.45, 0.62, 0.79].map(f => box(xm - 2, xm + 2, 3.5, w - 0.5, R * f, R * f + R * 0.12)));
    for (let i = 0; i < n; i++) adds.push(around(union([spar, sail]), i));
  } else if (style === 'wheel') {
    name = 'Display wheel';
    adds.push(sub(cylX(yp, zt, R, x0, x0 + 4, 72), cylX(yp, zt, R - 4, x0 - 1, x0 + 5, 72)));
    const spoke = box(x0, x0 + 4, -1.5, 1.5, 15, R - 2);
    for (let i = 0; i < n; i++) {
      adds.push(around(spoke, i));
      // fixed gondola below each rim point, on the outer face
      const a = ((360 / n) * i * Math.PI) / 180;
      const py = yp - R * Math.sin(a), pz = zt + R * Math.cos(a);
      adds.push(box(x0 + 3.9, x0 + 14, py - 6, py + 6, pz - 10, pz + 1));
    }
  } else {
    name = 'Paddle wheel';
    const paddle = box(x0, x0 + 16, -1.25, 1.25, 15, R);
    for (let i = 0; i < n; i++) adds.push(around(paddle, i));
  }
  const rotor = sub(union(adds), ...cuts);
  b.part({ id: 'rotor', name, link: 'rotor', material: spec.structural, profile: 'wheel', color: spec.accentColor, solid: rotor,
    printRot: [0, -90, 0], printNote: 'Hub face down; blades and spokes print flat (no supports except under the nose).' });

  b.link({ id: 'base', name: 'Base', parent: null, colliders: base.colliders });
  b.link({ id: 'rotor', name: 'Rotor', parent: 'base', joint: { origin: [xr, yp, zt], axis: axisWorld(sp.frame), actuator: spin },
    colliders: [{ shape: 'cylX', center: [x0 + 5, yp, zt], radius: R, halfLen: 5 }] });
  b.meta = { support: [[-28, -37], [28, -37], [28, 36], [-28, 36]] };

  b.check({ id: 'clearance', label: 'Rotor clearance', status: 'pass',
    detail: `Ø${(2 * R).toFixed(0)} rotor on a ${(zt - deckTop).toFixed(0)} mm pillar: the swept disc clears the deck parts by ≥ 4 mm and the electronics cover by ≥ 2 mm, and runs outboard of the pillar.` });
  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass', detail: 'The horn centre screw is driven through the Ø6.5 tunnel in the rotor nose; servo ears screw into the open pillar face.' });
  b.screw('M2×8 self-tap', 2, 'servo ears to pillar');
  b.screw('M2×6 self-tap', 2, 'horn arm to rotor hub');
  b.step('3. Push the continuous servo through the pillar from the outside and screw the ears (2 × M2×8). Send `calib` and trim DRIVE_TRIM_US until the horn stands still.');
  b.step(`4. Screw the horn into the ${name.toLowerCase()} hub recess, press it onto the spline and drive the centre screw through the Ø6.5 nose tunnel.`);
  if (style === 'fan') b.extra('Finger guard: keep the fan below 50 % speed near people (printed PETG blades)', 1);
}

/** Vertical compartment carousel: pet feeders, candy / pill dispensers, sorting trays. */
function buildCarousel(b: Build, spec: RobotSpec) {
  const P = spec.params;
  const R = Math.min(60, P.rotorDia / 2);
  const n = Math.max(3, Math.round(P.bladeCount));
  const base = machineBase(b, spec);
  const yp = 20;
  // the riser keeps the tray ≥ 2 mm above the electronics cover / console (rotating-part gap); seat = riser + 29.1
  const st = servoTower(b, 'base', 'rotor', base.deckTop, 0, yp, 'rotor', 'Carousel servo (S1)', Math.max(4, base.coverTop + 2 - 29.1), 'B-PG002');
  base.deckAdds.push(st.tower); base.deckCuts.push(st.towerCut);
  base.finishDeck(base.statusLeds(P.leds));

  const z0 = st.seat, floorT = 3, wallH = 18, rHub = 19;
  const wall = sub(cylZ(0, yp, R, z0, z0 + floorT + wallH, 72), cylZ(0, yp, R - 2, z0 + floorT, z0 + floorT + wallH + 1, 72));
  const dividers = Array.from({ length: n }, (_, i) =>
    box(-1, 1, rHub - 1, R - 1, z0 + floorT - 0.01, z0 + floorT + wallH).rotate([0, 0, (360 / n) * i]).translate([0, yp, 0]));
  const tray = sub(union([cylZ(0, yp, R, z0, z0 + floorT, 72), wall, cylZ(0, yp, rHub, z0, z0 + floorT + wallH, 48), ...dividers]),
    place(hornSeatCuts(floorT + wallH), st.frame));
  b.part({ id: 'rotor', name: `${n}-cell carousel tray`, link: 'rotor', material: spec.structural, profile: 'wheel', color: spec.accentColor, solid: tray,
    printRot: [0, 0, 0], printNote: 'Floor down; open-top cells need no supports.' });

  b.link({ id: 'base', name: 'Base', parent: null, colliders: base.colliders });
  b.link({ id: 'rotor', name: 'Carousel', parent: 'base', joint: { origin: [0, yp, st.towerTop], axis: [0, 0, 1], actuator: spin },
    colliders: [{ shape: 'box', center: [0, yp, z0 + (floorT + wallH) / 2], half: [R * 0.85, R * 0.85, (floorT + wallH) / 2] }] });
  b.meta = { support: [[-28, -37], [28, -37], [28, 36], [-28, 36]] };

  b.check({ id: 'clearance', label: 'Rotor clearance', status: 'pass', detail: `Tray underside ${(z0 - base.deckTop - base.coverTop).toFixed(1)} mm above the electronics cover (rotating-part gap ≥ 2.0 mm).` });
  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass', detail: 'The horn centre screw is driven down the Ø6.5 tunnel in the centre column.' });
  b.screw('M2×8 self-tap', 2, 'servo ears to tower');
  b.screw('M2×6 self-tap', 2, 'horn arm to tray');
  b.step('3. Drop the continuous servo into the tower and screw the ears. Trim DRIVE_TRIM_US until it stands still.');
  b.step(`4. Screw the horn under the tray, press it onto the spline and drive the centre screw down the Ø6.5 tunnel. Each of the ${n} cells holds one portion; \`index\` advances one cell.`);
}
