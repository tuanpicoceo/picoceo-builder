// Desk companion: a battery base with an electronics deck and an expressive pan-tilt head.
// `deskBase` is shared with the arm.

import { HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, box, cylY, cylZ, rrect, sub, union, type M } from './kernel';
import { batteryBay, batterySolid, electronics, ledPocketCuts, ledSolid, panTilt, strapPart } from './modules';
import { machineBase } from './machine';
import type { Collider, Vec3 } from './types';

export const BASE = { hw: 28, y0: -37, y1: 36, floorT: 3 };

/**
 * Base tub (battery bay along Y at the centre) + deck. The caller adds the tower/payload onto the deck
 * through `deckAdds`/`deckCuts` before `finishDeck` is called.
 */
export function deskBase(b: Build, spec: RobotSpec, opts: { clampTabs: boolean }) {
  const { hw, y0, y1, floorT } = BASE;
  const floorTop = floorT;
  const wallTop = floorTop + 20.5;
  const deckTop = wallTop + 3;
  const outline = (z0: number, z1: number) => rrect(2 * hw, y1 - y0, 6, 0, (y0 + y1) / 2, z0, z1);
  const bay = batteryBay(0, 0, floorTop, { reliefY: -14, strapY: 12, egress: 'rear' });
  const deckBosses: [number, number][] = [[-hw + 4, y0 + 4], [hw - 4, y0 + 4], [-hw + 4, y1 - 4], [hw - 4, y1 - 4]];
  const adds: M[] = [
    outline(0, floorTop), bay.add, bay.bosses,
    sub(outline(0, wallTop), rrect(2 * hw - 4, y1 - y0 - 4, 4, 0, (y0 + y1) / 2, -1, wallTop + 1)),
    ...deckBosses.map(([x, y]) => cylZ(x, y, 3.5, floorTop - 0.01, wallTop)),
  ];
  if (opts.clampTabs) adds.push(...[-1, 1].map(s => sub(rrect(16, 20, 4, s * (hw + 6), 0, 0, 4), cylZ(s * (hw + 8), 0, HOLES.M4.clear / 2, -1, 5, 24))));
  const cuts: M[] = [bay.cut, bay.bossTaps, ...deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.tap / 2, wallTop - 10, wallTop + 1, 16))];
  const tub = sub(union(adds), ...cuts, box(-14.7, 14.7, -26.35, 26.35, floorTop + 3, wallTop + 1));
  b.part({ id: 'base', name: 'Base tub', link: 'base', material: spec.structural, profile: 'chassis', color: spec.primaryColor, solid: tub, printRot: [0, 0, 0], printNote: 'Floor on the bed.' });
  b.comp({ key: 'battery', catalogId: 'B-PC003', label: 'Battery B-PC003', link: 'base', solid: batterySolid(0, 0, bay.batZ0), color: '#1f6fd1' });
  b.part({ id: 'strap', name: 'Battery strap', link: 'base', material: spec.structural, profile: 'chassis', color: spec.accentColor, solid: strapPart(0, 12, bay.strapZ0, bay.bossX), printRot: [0, 0, 0], printNote: 'Flat.' });
  b.screw('M2.5×8', 2, 'battery strap');
  b.screw('M3×8', 4, 'deck to base');
  if (opts.clampTabs) b.screw('M4 wood screw / clamp', 2, 'base tabs to the desk or a board');

  const deckAdds: M[] = [outline(wallTop, deckTop)];
  const deckCuts: M[] = [...deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, wallTop - 1, deckTop + 1, 16))];
  const finishDeck = (statusLeds: Vec3[]) => {
    deckCuts.push(...statusLeds.map(s => ledPocketCuts(s, 'z', 3)));
    statusLeds.forEach((s, i) => b.comp({ key: `led_s${i}`, catalogId: 'B-KB003', label: `Status LED ${i + 1}`, link: 'base', solid: ledSolid(s, 'z'), color: '#f6f6f6' }));
    b.part({ id: 'deck', name: 'Deck + servo tower', link: 'base', material: spec.structural, profile: 'motorMount', color: spec.accentColor, solid: sub(union(deckAdds), ...deckCuts), printRot: [0, 0, 0], printNote: 'Flat; the tower prints upright (its top plate is a short bridge).' });
  };
  const colliders: Collider[] = [{ shape: 'box', center: [0, (y0 + y1) / 2, deckTop / 2], half: [hw, (y1 - y0) / 2, deckTop / 2], friction: 0.7 }];
  b.step('1. Seat the battery in the troughs, lead out through the rear egress slot, and screw the strap down (2 × M2.5 × 8).');
  b.step('2. Mount the shield (core on top, USB-C to the rear), LED hub and switch on the deck; servo leads go down through the slot under the tower.');
  return { deckTop, wallTop, deckAdds, deckCuts, finishDeck, colliders };
}

export function buildCompanion(b: Build, spec: RobotSpec) {
  if (spec.platform === 'licheerv_claw') return buildClawCompanion(b, spec);
  const P = spec.params;
  const base = deskBase(b, spec, { clampTabs: false });
  const yp = 20;
  const el = electronics(b, 'base', base.deckTop, { shield: [0, -20.2], hub: [-22, 10], sw: [18.2, 12] });
  base.deckAdds.push(el.add); base.deckCuts.push(el.cut);

  // Separate screw-on rear electronics enclosure cover (allows open access to wire deck first, then screws on)
  const { hw, y0 } = BASE;
  const deckTop = base.deckTop;
  const cowlZ0 = deckTop + 0.02;
  const cowlOuter = union([
    rrect(2 * hw - 2, 32, 6, 0, (y0 - 5) / 2, cowlZ0, deckTop + 14),
    rrect(2 * hw - 6, 30, 7, 0, (y0 - 5) / 2, deckTop + 13, deckTop + 26),
    rrect(2 * hw - 10, 28, 8, 0, (y0 - 5) / 2, deckTop + 25, deckTop + 29.5),
  ]);

  const cowlPocket = union([
    box(-16.5, 16.5, -36.0, -4.5, deckTop - 0.5, deckTop + 28.0),
    box(-26.0, -17.0, -6.5, 0, deckTop - 0.5, deckTop + 16.0),
    // Clearance over status LEDs on rear deck
    box(-24.5, 24.5, -30.0, -13.0, deckTop - 0.5, deckTop + 4.0),
  ]);

  const rearUsbCut = box(-8, 8, y0 - 2, -31.5, deckTop + 16, deckTop + 26.5);
  const rearDeckScrewCuts = union([
    [-hw + 4, y0 + 4], [hw - 4, y0 + 4],
  ].map(([x, y]) => union([
    cylZ(x, y, HOLES.M3.clear / 2, deckTop - 1, deckTop + 8, 16),
    cylZ(x, y, 3.25, deckTop + 8, deckTop + 32, 24),
  ])));

  const isAgent = (spec.archetype || '').toLowerCase().includes('agent') ||
                  (spec.archetype || '').toLowerCase().includes('desk') ||
                  (spec.archetype || '').toLowerCase().includes('stationary') ||
                  (spec.archetype || '').toLowerCase().includes('stand') ||
                  (spec.archetype || '').toLowerCase().includes('xiaozhi') ||
                  (spec.archetype || '').toLowerCase().includes('zhaozhi') ||
                  (spec.archetype || '').toLowerCase().includes('speaker');

  const consoleCowl = sub(
    cowlOuter,
    cowlPocket,
    rearUsbCut,
    rearDeckScrewCuts
  );

  b.part({
    id: 'electronics_cover',
    name: 'Rear electronics enclosure cover',
    link: 'base',
    material: spec.shell,
    profile: 'shell',
    color: spec.primaryColor,
    solid: consoleCowl,
    printRot: [0, 0, 0],
    printNote: 'Flat base on bed; smooth closed top cover that screws over the rear electronics stack.',
  });
  const pt = panTilt(b, spec, 'base', base.deckTop, 0, yp, Math.min(2, P.leds), ['S1', 'S2']);
  base.deckAdds.push(pt.tower); base.deckCuts.push(pt.towerCut);

  if (isAgent) {
    // Mount acoustic micro speaker inside the head cavity behind the mouth slot (link: 'tilt')
    // Placed between X in [-10, 1] to cleanly clear tilt bracket side walls (X in [-16, -12] and [3, 8])
    const ps = base.deckTop + 24.5 + 0.6 + 4.5;
    const zt = ps + 4 + 0.6 + 6.0;
    const spkSolid = union([
      box(-10, 1, 33.5, 36.8, zt + 1, zt + 8),
      cylY(-4.5, zt + 4.5, 3.2, 36.8, 37.0, 16),
    ]);
    b.comp({
      key: 'speaker',
      catalogId: 'SPK-8OHM-2W',
      label: '8Ω 2W Audio Speaker',
      link: 'tilt',
      solid: spkSolid,
      color: '#2a2a2a',
    });
    b.step('Stationary AI Desk Agent audio: Connect 8Ω 2W speaker to the amplifier output and seat into head acoustic pocket behind the mouth slot.');
  }
  const rest = Math.max(0, P.leds - pt.eyes);
  const spots: Vec3[] = [[-20.5, -26, base.deckTop], [20.5, -26, base.deckTop], [-20.5, -17, base.deckTop], [20.5, -17, base.deckTop]];
  base.finishDeck(spots.slice(0, rest));
  b.link({ id: 'base', name: 'Base', parent: null, colliders: base.colliders });
  b.meta = { support: [[-28, -37], [28, -37], [28, 36], [-28, 36]] };
  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass', detail: 'Servo ear screws go in from above / outside; horn centre screws through Ø6.5 tunnels in the bracket and head; deck and strap screws are vertical.' });
  b.check({ id: 'battery', label: 'Battery bay isolation', status: 'pass', detail: 'Bay 29.4 × 52.7 mm with twin troughs, Ø18 finger reliefs, 10 × 6 egress slot, strap bosses outside the bay.' });
  b.extra('Rubber feet Ø8 (optional)', 4);
}

/** LicheeRV Claw kit: the Claw module is the head's face; the pan-tilt servos run off the PCA9685 under the deck. */
function buildClawCompanion(b: Build, spec: RobotSpec) {
  const base = machineBase(b, spec, { servoDriver: true, face: true });
  const pt = panTilt(b, spec, 'base', base.deckTop, 0, 20, 0, ['S1', 'S2']);
  base.deckAdds.push(pt.tower); base.deckCuts.push(pt.towerCut);
  base.finishDeck(base.statusLeds(0));
  b.link({ id: 'base', name: 'Base', parent: null, colliders: base.colliders });
  b.meta = { support: [[-28, -37], [28, -37], [28, 36], [-28, 36]] };
  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass', detail: 'Servo ear screws go in from above / outside; horn centre screws through Ø6.5 tunnels in the bracket and head; console and deck screws are vertical.' });
  b.extra('Rubber feet Ø8 (optional)', 4);
}
