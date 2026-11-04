// Shared scaffolding for the stationary mechanism builders (lever, rotor, linear axis, SCARA): the desk
// base with its battery bay and electronics deck plus a screw-on rear electronics cover, a deck pillar
// for a servo with a horizontal shaft (guide s.6: open side, ears screwed from outside), and a hollow
// servo tower for any servo frame.

import { FIT, HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, box, cboxXY, cylX, cylZ, hull, rrect, sub, union, type M } from './kernel';
import { BASE, deskBase } from './companion';
import { EAR_HOLES, EAR_X0, EAR_X1, HORN_SEAT, SV, SV_X0, SV_X1, electronics, hornSolid, place, servoSolid, strapPart, type Frame } from './modules';
import type { Collider, Vec3 } from './types';
import { CLAW_MOD } from './claw';

/** Status LED spots under the rear cover (pocketed clear of the cover). */
export const STATUS_SPOTS: Vec3[] = [[-20.5, -26, 0], [20.5, -26, 0], [-20.5, -17, 0], [20.5, -17, 0]];

/**
 * Desk base + electronics deck (shield at the rear, LED hub left, switch right) + rear cover. On the LicheeRV Claw
 * platform this is the Claw base instead (same footprint and deck, taller rear console). Builders read `coverTop`
 * (rear housing height above the deck, y ≤ -5) and `ledBudget` (addressable LEDs available) rather than assuming them.
 */
export function machineBase(b: Build, spec: RobotSpec, opts: { coverTop?: number; clampTabs?: boolean; servoDriver?: boolean; face?: boolean } = {}) {
  if (spec.platform === 'licheerv_claw') return clawBase(b, spec, opts);
  const base = deskBase(b, spec, { clampTabs: !!opts.clampTabs });
  const el = electronics(b, 'base', base.deckTop, { shield: [0, -20.2], hub: [-22, 10], sw: [18.2, 12] });
  base.deckAdds.push(el.add); base.deckCuts.push(el.cut);
  b.part({
    id: 'electronics_cover', name: 'Rear electronics cover', link: 'base', material: spec.shell, profile: 'shell', color: spec.primaryColor,
    solid: electronicsCover(base.deckTop, base.deckTop + (opts.coverTop ?? 29.5)), printRot: [0, 0, 0],
    printNote: 'Flat base on the bed; screws over the controller stack with the deck screws.',
  });
  const statusLeds = (n: number) => STATUS_SPOTS.slice(0, Math.max(0, Math.min(4, n))).map(([x, y]) => [x, y, base.deckTop] as Vec3);
  return { ...base, statusLeds, coverTop: opts.coverTop ?? 29.5, ledBudget: spec.params.leds };
}

// ---------------------------------------------------------------- Sipeed LicheeRV Claw platform
/** Claw module stack (LicheeRV Nano W + PicoClaw board), standing upright, LCD facing +y. Estimated from photos. */
export const CLAW = { w: 30.5, h: 38.5, lcd: 27.7, coverTop: 46 };

/**
 * Claw base: the CyberBrick desk-base footprint with a 1S LiPo pouch on the floor, an optional PCA9685 servo board
 * hanging under the deck, and a rear console that holds the Claw module upright behind its LCD window, with printed
 * key plungers, a speaker grille and a USB-C path. Same interface as `machineBase`.
 */
export function clawBase(b: Build, spec: RobotSpec, opts: { clampTabs?: boolean; servoDriver?: boolean; face?: boolean } = {}) {
  const { hw, y0, y1, floorT } = BASE;
  const wallTop = floorT + 25, deckTop = wallTop + 3, top = deckTop + CLAW.coverTop;
  const outline = (z0: number, z1: number) => rrect(2 * hw, y1 - y0, 6, 0, (y0 + y1) / 2, z0, z1);
  const corners: [number, number][] = [[-hw + 4, y0 + 4], [hw - 4, y0 + 4], [-hw + 4, y1 - 4], [hw - 4, y1 - 4]];

  // ---- tub: pouch bay (+1.0 / +1.5 swell), strap bosses outside the bay, deck bosses, USB-C cable exit at the rear
  const pouch = { x: 34, y: 50, z: 6.2 }, bayX = pouch.x + 1.0, bayY = pouch.y + 1.5;
  const strapZ0 = floorT + pouch.z + 0.4, bossX = bayX / 2 + 2.0 + 2.9 + 0.2;
  const tub = sub(union([
    outline(0, floorT),
    sub(outline(0, wallTop), rrect(2 * hw - 4, y1 - y0 - 4, 4, 0, (y0 + y1) / 2, -1, wallTop + 1)),
    sub(box(-bayX / 2 - 2, bayX / 2 + 2, -bayY / 2 - 2, bayY / 2 + 2, floorT - 0.01, floorT + 4), box(-bayX / 2, bayX / 2, -bayY / 2, bayY / 2, floorT, floorT + 5)),
    ...[-1, 1].map(s => cylZ(s * bossX, 0, 2.9, floorT - 0.01, strapZ0)),
    ...corners.map(([x, y]) => cylZ(x, y, 3.5, floorT - 0.01, wallTop)),
    ...(opts.clampTabs ? [-1, 1].map(s => sub(rrect(16, 20, 4, s * (hw + 6), 0, 0, 4), cylZ(s * (hw + 8), 0, HOLES.M4.clear / 2, -1, 5, 24))) : []),
  ]),
  ...[-1, 1].map(s => cylZ(s * bossX, 0, HOLES.M2_5.tap / 2, strapZ0 - 8, strapZ0 + 1, 16)),
  ...corners.map(([x, y]) => cylZ(x, y, HOLES.M3.tap / 2, wallTop - 10, wallTop + 1, 16)),
  box(-7, 7, y0 - 1, y0 + 3, floorT + 8, wallTop - 2),                       // USB-C cable exit
  box(-5, 5, bayY / 2 - 1, bayY / 2 + 3, floorT + 1, floorT + 6));             // pouch lead egress
  b.part({ id: 'base', name: 'Base tub', link: 'base', material: spec.structural, profile: 'chassis', color: spec.primaryColor, solid: tub, printRot: [0, 0, 0], printNote: 'Floor on the bed.' });
  // the module runs on its own built-in cell; this pouch is the servo power pack (PCA9685 V+ through a 5 V boost)
  b.comp({ key: 'battery', catalogId: 'BAT-LIPO-1S-1000', label: 'LiPo 1S 1000 mAh pouch (servo power)', link: 'base', solid: box(-pouch.x / 2, pouch.x / 2, -pouch.y / 2, pouch.y / 2, floorT + 0.1, floorT + 0.1 + pouch.z), color: '#c0c6cf' });
  b.part({ id: 'strap', name: 'Battery strap', link: 'base', material: spec.structural, profile: 'chassis', color: spec.accentColor, solid: strapPart(0, 0, strapZ0, bossX), printRot: [0, 0, 0], printNote: 'Flat. Never screw through or press on the pouch.' });
  b.screw('M2.5×8', 2, 'battery strap');
  b.screw('M3×8', 4, 'deck to base');

  // ---- deck: corner holes, USB-C plug well under the module, PCA9685 hanging bosses
  const deckAdds: M[] = [outline(wallTop, deckTop)];
  const deckCuts: M[] = [
    ...corners.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, wallTop - 1, deckTop + 1, 16)),
    cboxXY(0, -12.8, 14, 10, wallTop - 1, deckTop + 1),                            // USB-C plug down into the tub
    cboxXY(-18, 18, 8, 6, wallTop - 1, deckTop + 1),                               // leads between the tub and the deck top (beside the PCA9685)
  ];
  if (opts.servoDriver !== false) {
    const holes = [-1, 1].flatMap(sx => [-1, 1].map(sy => [sx * 9.55, sy * 27.95] as [number, number]));
    deckAdds.push(...holes.map(([x, y]) => cylZ(x, y, 2.9, wallTop - 4, wallTop + 0.01)));
    deckCuts.push(...holes.map(([x, y]) => cylZ(x, y, HOLES.M2_5.tap / 2, wallTop - 5, wallTop - 0.5, 16)));
    const pz = wallTop - 4;   // board hangs headers-down under the deck
    b.comp({ key: 'servo_driver', catalogId: 'PCA9685-SERVO-16', label: 'PCA9685 servo driver (I2C)', link: 'base', color: '#1565c0',
      solid: union([box(-12.7, 12.7, -31.25, 31.25, pz - 1.6, pz), box(-11, -2, -24, 24, pz - 10.1, pz - 1.6), box(4, 11, -31, -20, pz - 9.6, pz - 1.6)]) });
    b.screw('M2.5×6', 4, 'PCA9685 board under the deck');
    b.step('Servo driver: screw the PCA9685 under the deck (headers down), wire SDA / SCL / 3V3 / GND to the Nano header, and a 5 V supply to its V+ terminal.');
  }

  // ---- head mode: the Claw module (with its own battery and speaker) is the robot's face (src/cad/claw.ts)
  if (opts.face) {
    b.extra('Foam pad / double-sided tape for the battery pouch', 1);
    b.step('1. Lay the servo-power LiPo pouch in its bay, lead toward the front, and screw the strap over it (never on the pouch). Its lead goes to the PCA9685 V+ (through a 5 V boost); the Claw module in the head runs on its own built-in cell.');
    // the leads from the face and the body's servos run taped along the deck top to its two cable slots
    b.cableway(outline(deckTop, deckTop + 5));
    const finishDeck = (_spots: Vec3[]) => {
      b.part({ id: 'deck', name: 'Deck', link: 'base', material: spec.structural, profile: 'motorMount', color: spec.accentColor, solid: sub(union(deckAdds), ...deckCuts), printRot: [0, 0, 0], printNote: 'Flat; towers print upright.' });
    };
    b.check({ id: 'platform', label: 'Electronics platform', status: 'pass',
      detail: `LicheeRV Claw kit: the Nano W + PicoClaw module (built-in battery and speaker) is the head's face (240x240 LCD); servo-power LiPo pouch in the base${opts.servoDriver !== false ? ', PCA9685 servo driver under the deck' : ''}. Module outline is estimated from Sipeed photos: measure your board before printing.` });
    return { deckTop, wallTop, deckAdds, deckCuts, finishDeck, colliders: [{ shape: 'box', center: [0, (y0 + y1) / 2, deckTop / 2], half: [hw, (y1 - y0) / 2, deckTop / 2], friction: 0.7 }] as Collider[],
      statusLeds: (_n: number): Vec3[] => [], coverTop: 7, ledBudget: 0 };
  }

  // ---- console: Claw module cradle + LCD window, LED / switch slot, key plungers, screw tunnels
  const cz0 = deckTop + 4;                     // module bottom edge (USB-C below it)
  const lcdZ = cz0 + 21.5;                         // 30 mm LCD module between the LED / switch strip (≤ 5) and the top edge (38.5), estimated
  const kz = cz0 + CLAW_MOD.keyUp;                 // one key on each side edge, same height (estimated)
  const cy0 = -36, cy1 = -5, cx = 27;
  const ky = cy1 - 2 - 3.8;                       // key centre line
  const sides = [-1, 1];
  const shell = sub(rrect(2 * cx, cy1 - cy0, 5, 0, (cy0 + cy1) / 2, deckTop + 0.02, top), box(-cx + 2, cx - 2, cy0 + 2, cy1 - 2, deckTop - 1, top - 2.5));
  const rails = sides.map(s => box(s > 0 ? CLAW.w / 2 + 0.2 : -CLAW.w / 2 - 3, s > 0 ? CLAW.w / 2 + 3 : -CLAW.w / 2 - 0.2, -14.5, -7.01, deckTop, cz0 + 16));
  const guides = sides.map(s => cylX(ky, kz, 4, ...(s > 0 ? [19, cx - 1.99] : [-cx + 1.99, -19]) as [number, number], 24));
  const screwBosses = [-1, 1].map(s => cylZ(s * (hw - 4), y0 + 4, 3, deckTop, deckTop + 6));
  const console = sub(union([shell, ...rails, ...guides, ...screwBosses]),
    box(-CLAW.lcd / 2, CLAW.lcd / 2, cy1 - 3, cy1 + 1, lcdZ - CLAW.lcd / 2, lcdZ + CLAW.lcd / 2),        // LCD window
    box(-8, 8, cy1 - 3, cy1 + 1, cz0 + 0.5, cz0 + 5.5),                                                // LEDs + ON/OFF switch
    cylX(ky, kz, 2.7, -cx - 1, -17, 24), cylX(ky, kz, 2.7, 17, cx + 1, 24),                           // plunger bores (journal fit)
    ...[-1, 1].map(s => union([cylZ(s * (hw - 4), y0 + 4, HOLES.M3.clear / 2, deckTop - 1, deckTop + 7, 16), cylZ(s * (hw - 4), y0 + 4, FIT.tunnel / 2, deckTop + 6, top + 1, 24)])),
  );
  b.part({ id: 'electronics_cover', name: 'Claw console', link: 'base', material: spec.shell, profile: 'shell', color: spec.primaryColor, solid: console,
    printRot: [-90, 0, 0], printNote: 'Front face (LCD window) down; the rails and plunger guides print without supports.' });
  sides.forEach((s, i) => b.part({
    id: `key_plunger_${i + 1}`, name: `Key plunger ${s > 0 ? 'right' : 'left'}`, link: 'base', material: spec.structural, profile: 'shell', color: spec.accentColor,
    solid: union([cylX(ky, kz, 2.5, ...(s > 0 ? [CLAW.w / 2 + 1.6, cx + 1.5] : [-cx - 1.5, -CLAW.w / 2 - 1.6]) as [number, number], 24),
      cylX(ky, kz, 3.6, ...(s > 0 ? [CLAW.w / 2 + 1.6, 18.6] : [-18.6, -CLAW.w / 2 - 1.6]) as [number, number], 24)]),
    printRot: [0, 90, 0], printNote: 'Collar down; slides in its guide and presses the side key.',
  }));

  // module: Nano behind the PicoClaw board, LCD glass at the window, one key on each side edge, USB-C at the bottom
  const fy = cy1 - 2;   // inner face of the front wall
  b.comp({ key: 'core', catalogId: 'LICHEERV-NANO-W', label: 'LicheeRV Nano W', link: 'base', color: '#1c1917',
    solid: union([box(-11.43, 11.43, fy - 10.4, fy - 5.4, cz0 + 1, cz0 + 1 + 35.56), box(-4.5, 4.5, fy - 9.2, fy - 6.2, cz0 - 3, cz0 + 1.01)]) });
  b.comp({ key: 'shield', catalogId: 'PICOCLAW-BOARD', label: 'PicoClaw board + 240x240 LCD', link: 'base', color: '#0f172a',
    solid: union([
      box(-CLAW.w / 2, CLAW.w / 2, fy - 5.4, fy - 3.8, cz0, cz0 + CLAW.h),
      box(-14.25, 14.25, fy - 3.81, fy - 0.1, lcdZ - 15, lcdZ + 15),
      box(-CLAW.w / 2 - 1.5, -CLAW.w / 2 + 0.01, fy - 5.4, fy - 2.2, kz - 2, kz + 2), box(CLAW.w / 2 - 0.01, CLAW.w / 2 + 1.5, fy - 5.4, fy - 2.2, kz - 2, kz + 2),
      box(-7.5, 7.5, fy - 3.81, fy - 0.6, cz0, cz0 + 5),
      box(-14, 14, fy - CLAW_MOD.depth, fy - 10.45, cz0 + 3, cz0 + CLAW.h - 3),   // built-in LiPo + speaker behind the Nano
    ]) });
  b.screw('M3×10', 2, 'console to deck (through the top tunnels)');
  b.extra('Foam pad / double-sided tape for the battery pouch', 1);
  b.step('1. Lay the servo-power LiPo pouch in its bay, lead toward the front, and screw the strap over it (never on the pouch). The Claw module runs on its own built-in cell.');
  b.step('2. Flash the PicoClaw image to the TF card, slide the Claw module (LCD forward, USB-C down) into the console rails, drop the key plungers into their guides, and screw the console to the deck.');

  const statusLeds = (_n: number): Vec3[] => [];   // the kit has no addressable LEDs: the LCD is the face
  const finishDeck = (_spots: Vec3[]) => {
    b.part({ id: 'deck', name: 'Deck', link: 'base', material: spec.structural, profile: 'motorMount', color: spec.accentColor, solid: sub(union(deckAdds), ...deckCuts), printRot: [0, 0, 0], printNote: 'Flat; towers print upright.' });
  };
  const colliders: Collider[] = [
    { shape: 'box', center: [0, (y0 + y1) / 2, deckTop / 2], half: [hw, (y1 - y0) / 2, deckTop / 2], friction: 0.7 },
    { shape: 'box', center: [0, (cy0 + cy1) / 2, (deckTop + top) / 2], half: [cx, (cy1 - cy0) / 2, (top - deckTop) / 2] },
  ];
  b.check({ id: 'platform', label: 'Electronics platform', status: 'pass',
    detail: `LicheeRV Claw kit: Nano W + PicoClaw module (built-in battery and speaker) upright in the rear console behind a ${CLAW.lcd} mm LCD window; servo-power LiPo pouch in the tub${opts.servoDriver !== false ? '; PCA9685 servo driver under the deck' : ''}. Module outline is estimated from Sipeed photos: measure your board before printing.` });
  return { deckTop, wallTop, deckAdds, deckCuts, finishDeck, colliders, statusLeds, coverTop: CLAW.coverTop, ledBudget: 0 };
}

/** Stepped cover over the shield stack (stack top = deck + 27.2), USB-C window at the rear. */
export function electronicsCover(deckTop: number, top: number): M {
  const { hw, y0 } = BASE;
  const cy = (y0 - 5) / 2;
  const outer = union([
    rrect(2 * hw - 2, 32, 6, 0, cy, deckTop + 0.02, deckTop + 14),
    rrect(2 * hw - 6, 30, 7, 0, cy, deckTop + 13, top - 3.5),
    rrect(2 * hw - 10, 28, 8, 0, cy, top - 4.5, top),
  ]);
  const pocket = union([
    box(-16.5, 16.5, -36.0, -4.5, deckTop - 0.5, top - 1.2),
    box(-26.0, -17.0, -6.5, 0, deckTop - 0.5, deckTop + 16.0),
    box(-24.5, 24.5, -30.0, -13.0, deckTop - 0.5, deckTop + 4.0),     // status LEDs
  ]);
  const usb = box(-8, 8, y0 - 2, -31.5, deckTop + 16, top - 3);
  const screws = union([[-hw + 4, y0 + 4], [hw - 4, y0 + 4]].map(([x, y]) => union([
    cylZ(x, y, HOLES.M3.clear / 2, deckTop - 1, deckTop + 8, 16),
    cylZ(x, y, FIT.tunnel / 2, deckTop + 8, top + 2, 24),
  ])));
  return sub(outer, pocket, usb, screws);
}

/** Case pocket + M2 ear taps for a servo whose ears sit on a plate's outer face (plate on the -z side of S). */
export const plateServoCuts = (t: number) => union([
  box(SV_X0 - FIT.push / 2, SV_X1 + FIT.push / 2, -SV.W / 2 - FIT.push / 2, SV.W / 2 + FIT.push / 2, -t - 1, 1),
  ...EAR_HOLES.map(ex => cylZ(ex, 0, HOLES.M2.tap / 2, -t - 0.5, 1, 16)),
]);

/**
 * Servo with its shaft along +X, ears screwed to the outer (+X) face of a ribbed deck pillar at x = xr; the
 * case hangs through the pillar toward -X and the case length runs toward -Y. The driven part's inner face
 * is at x = xr + HORN_SEAT.
 */
export function sidePillarServo(b: Build, parent: string, child: string, deckTop: number, xr: number, yp: number, zt: number, key: string, label: string, catalogId = 'B-PG001') {
  const f: Frame = { rots: [[0, 90, 0], [-90, 0, 0]], pos: [xr, yp, zt] };   // S z -> +X, S x -> -Y, S y -> -Z
  const y0 = yp - (EAR_X1 + 2.5), y1 = yp - (EAR_X0 - 2.5);
  const ribs = [[y0, y0 + 4], [y1 - 4, y1]].map(([a, c]) =>
    hull([box(xr - 16, xr, a, c, deckTop - 0.01, deckTop + 2), box(xr - 1.5, xr, a, c, zt - 9, zt - 8)]));
  const pillar = sub(union([box(xr - 5, xr, y0, y1, deckTop - 0.01, zt + SV.W / 2 + 4), ...ribs]), place(plateServoCuts(5), f));
  const leadCut = cboxXY(xr - 8, yp + 2, 6, 10, deckTop - 4, deckTop + 1);
  b.comp({ key: `servo_${key}`, catalogId, label, link: parent, solid: place(servoSolid(), f) });
  b.comp({ key: `horn_${key}`, catalogId: 'horn', label: `${label} horn`, link: child, solid: place(hornSolid(), f), color: '#f0f0f0' });
  return { pillar, leadCut, frame: f, faceX: xr + HORN_SEAT, footprint: { x0: xr - 16, x1: xr, y0, y1 } };
}

/**
 * Hollow tower holding a servo shaft-up, built in the servo frame so any yaw works: walls 2.3 mm around the
 * push-fit pocket, M2 ear bosses, `h` tall below the ear face (bottom at S z = -h).
 */
export function towerInFrame(h = SV.below + 0.6): M {
  const hw = SV.W / 2 + FIT.push / 2 + 2.3;
  const shell = sub(box(EAR_X0 - 2, EAR_X1 + 2, -hw, hw, -h - 0.01, 0), box(EAR_X0 + 0.3, EAR_X1 - 0.3, -hw + 2.3, hw - 2.3, -h - 1, -3));
  return sub(union([shell, ...EAR_HOLES.map(ex => cylZ(ex, 0, 2.3, -8, 0))]), place(plateServoCuts(3), { rots: [], pos: [0, 0, 0] }));
}
