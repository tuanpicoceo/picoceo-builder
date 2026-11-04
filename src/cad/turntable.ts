// Automated 360-Degree Studio Turntable: Weighted desk base with battery, ESP32-C3 controller,
// precision vertical rotary servo mount, and a smooth rotating studio platter with anti-slip texture rings.

import { HOLES, FIT } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, cylZ, rrect, sub, union, box } from './kernel';
import {
  electronics,
  hornSeatCuts,
  place,
  servoTower,
} from './modules';
import { BASE, deskBase } from './companion';
import { CLAW, machineBase } from './machine';
import type { Vec3 } from './types';

export function buildTurntable(b: Build, spec: RobotSpec) {
  const claw = spec.platform === 'licheerv_claw';
  // LicheeRV Claw kit: the console comes with the base; the tower rises so the platter clears it by 2 mm
  const base = claw ? machineBase(b, spec, { servoDriver: true }) : deskBase(b, spec, { clampTabs: false });
  const deckTop = base.deckTop;
  if (!claw) cyberBrickConsole(b, spec, base);

  // --------------------------------------------------------------------------
  // Turntable Tower (Vertical Servo Mount at center Y = 20)
  // Uses tested servoTower module: shaft up, case toward rear (-Y), width only 18mm
  // --------------------------------------------------------------------------
  const yp = 20;
  const riser = claw ? CLAW.coverTop + 2 - 29.1 : 0;   // seat = deck + 29.1 + riser
  const st = servoTower(b, 'base', 'platter', deckTop, 0, yp, 'rotary', 'Turntable Rotary Servo', riser);
  base.deckAdds.push(st.tower);
  base.deckCuts.push(st.towerCut);
  buildPlatter(b, spec, base, st, yp, claw);
}

function cyberBrickConsole(b: Build, spec: RobotSpec, base: ReturnType<typeof deskBase>) {
  const deckTop = base.deckTop;
  // Mount electronics (ESP32-C3 core + shield + switch + LED hub)
  const el = electronics(b, 'base', deckTop, { shield: [0, -20.2], hub: [-22, 10], sw: [18.2, 12] });
  base.deckAdds.push(el.add);
  base.deckCuts.push(el.cut);

  // Rear electronics enclosure cover (shields the controller stack)
  const { hw, y0 } = BASE;
  const cowlZ0 = deckTop + 0.02;
  const cowlOuter = union([
    rrect(2 * hw - 2, 32, 6, 0, (y0 - 5) / 2, cowlZ0, deckTop + 14),
    rrect(2 * hw - 6, 30, 7, 0, (y0 - 5) / 2, deckTop + 13, deckTop + 25),
    rrect(2 * hw - 10, 28, 8, 0, (y0 - 5) / 2, deckTop + 24, deckTop + 28.0),
  ]);
  const cowlPocket = union([
    box(-16.5, 16.5, -36.0, -4.5, deckTop - 0.5, deckTop + 27.6),
    box(-26.0, -17.0, -6.5, 0, deckTop - 0.5, deckTop + 16.0),
    box(-24.5, 24.5, -30.0, -13.0, deckTop - 0.5, deckTop + 4.0),
  ]);
  const rearUsbCut = box(-8, 8, y0 - 2, -31.5, deckTop + 16, deckTop + 26.5);
  const rearDeckScrewCuts = union([
    [-hw + 4, y0 + 4], [hw - 4, y0 + 4],
  ].map(([x, y]) => union([
    cylZ(x, y, HOLES.M3.clear / 2, deckTop - 1, deckTop + 8, 16),
    cylZ(x, y, 3.25, deckTop + 8, deckTop + 32, 24),
  ])));

  const consoleCowl = sub(cowlOuter, cowlPocket, rearUsbCut, rearDeckScrewCuts);
  b.part({
    id: 'electronics_cover',
    name: 'Rear electronics cover',
    link: 'base',
    material: spec.shell,
    profile: 'shell',
    color: spec.primaryColor,
    solid: consoleCowl,
    printRot: [0, 0, 0],
    printNote: 'Flat base on bed; low-profile protective enclosure cover over the rear controller stack.',
  });
}

function buildPlatter(b: Build, spec: RobotSpec, base: Pick<ReturnType<typeof deskBase>, 'deckTop' | 'finishDeck' | 'colliders'>,
  st: ReturnType<typeof servoTower>, yp: number, claw: boolean) {
  const deckTop = base.deckTop;
  // --------------------------------------------------------------------------
  // Rotating Platter (360° Studio Disc)
  // --------------------------------------------------------------------------
  const platterR = 48; // Ø96 mm studio platter
  const platterZ0 = st.seat; // sits right onto horn seat face
  const platterZ1 = platterZ0 + 5.5; // 5.5 mm solid rigid platter

  const platterDisc = cylZ(0, yp, platterR, platterZ0, platterZ1, 64);
  const rimBevel = sub(
    cylZ(0, yp, platterR + 0.1, platterZ1 - 1.2, platterZ1 + 0.1, 64),
    cylZ(0, yp, platterR - 1.2, platterZ1 - 1.25, platterZ1 + 0.15, 64),
  );

  // Concentric studio anti-slip texture grooves
  const gripGroove1 = sub(
    cylZ(0, yp, 38.5, platterZ1 - 0.7, platterZ1 + 0.1, 48),
    cylZ(0, yp, 37.0, platterZ1 - 0.75, platterZ1 + 0.15, 48),
  );
  const gripGroove2 = sub(
    cylZ(0, yp, 26.5, platterZ1 - 0.7, platterZ1 + 0.1, 48),
    cylZ(0, yp, 25.0, platterZ1 - 0.75, platterZ1 + 0.15, 48),
  );
  const gripGroove3 = sub(
    cylZ(0, yp, 14.5, platterZ1 - 0.7, platterZ1 + 0.1, 48),
    cylZ(0, yp, 13.0, platterZ1 - 0.75, platterZ1 + 0.15, 48),
  );

  // Horn mount seat and centre screw tunnel
  const hornCuts = place(hornSeatCuts(6), st.frame);
  const centerScrewTunnel = cylZ(0, yp, FIT.tunnel / 2, platterZ0 - 1, platterZ1 + 1, 24);

  const platterSolid = sub(
    platterDisc,
    rimBevel,
    gripGroove1,
    gripGroove2,
    gripGroove3,
    hornCuts,
    centerScrewTunnel,
  );

  b.part({
    id: 'platter',
    name: '360° Studio Turntable Platter',
    link: 'platter',
    material: spec.structural,
    profile: 'wheel',
    color: spec.accentColor,
    solid: platterSolid,
    printRot: [0, 0, 0],
    printNote: 'Print flat on bed; concentric texture rings on top surface provide grip for photographed objects.',
  });

  // Rotating platter link
  b.link({
    id: 'platter',
    name: 'Rotating Studio Platter',
    parent: 'base',
    joint: {
      origin: [0, yp, st.towerTop],
      axis: [0, 0, 1],
      limit: [-360, 360],
      actuator: { kind: 'servo', catalogId: 'B-PG002', port: 'S1', label: 'turntable_rotary' },
    },
    colliders: [{ shape: 'box', center: [0, yp, (platterZ0 + platterZ1) / 2], half: [platterR, platterR, 2.75] }],
  });

  // --------------------------------------------------------------------------
  // Status LEDs on Base Deck (Front corners)
  // --------------------------------------------------------------------------
  const ledSpots: Vec3[] = [
    [-20.5, -26, deckTop],
    [20.5, -26, deckTop],
  ];
  base.finishDeck(claw ? [] : ledSpots);

  // Base link and support footprint
  b.link({ id: 'base', name: 'Base', parent: null, colliders: base.colliders });
  b.meta = { support: [[-28, -37], [28, -37], [28, 36], [-28, 36]] };

  // Verification checks & assembly steps
  b.check({
    id: 'tunnels',
    label: 'Screwdriver access (Ø6.5 line of sight)',
    status: 'pass',
    detail: 'Central platter tunnel allows driving the M2 servo horn center screw directly onto the servo spline; deck and strap screws are vertically accessible.',
  });
  b.screw('M2×8 self-tap', 2, 'vertical servo ears to tower');
  b.screw('M2×6 self-tap', 2, 'horn arms to platter seat');
  b.extra('Anti-slip rubber feet Ø8', 4);
  if (!claw) {
    b.check({
      id: 'battery',
      label: 'Battery bay isolation',
      status: 'pass',
      detail: 'Bay 29.4 × 52.7 mm with twin troughs, finger reliefs, and rear egress slot.',
    });
    b.screw('M2.5×8', 2, 'battery strap to base');
    b.screw('M3×8', 4, 'deck to base');
    b.step('1. Seat the battery in the base troughs, lead cable out rear slot, and secure with strap (2 × M2.5 × 8).');
    b.step('2. Mount the shield and power switch onto the deck; connect continuous servo B-PG002 to port S1.');
  }
  b.step('3. Drop the servo vertically into the central deck tower and secure with 2 × M2 self-tap screws.');
  b.step('4. Screw the servo horn into the underside of the 360° platter, press onto the servo spline, and tighten the center screw through the platter tunnel.');
}
