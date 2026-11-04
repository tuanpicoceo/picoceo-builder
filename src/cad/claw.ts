// Sipeed LicheeRV Claw kit parts shared by every builder: the Claw face (LicheeRV Nano W + PicoClaw board in a
// frame whose 240x240 LCD is the robot's face) and the deck electronics that replace the CyberBrick shield stack
// in robot bodies (PCA9685 servo board, speaker). Dimensions of the PicoClaw board are estimated from photos.

import { HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, box, cboxXY, cylX, cylY, cylZ, sub, union, type M } from './kernel';

/**
 * Module stack, upright, LCD facing +y: LCD + PicoClaw board (5.4), the Nano behind it (5.0) and the built-in battery and
 * speaker behind that (`pack`). Estimated from photos: keyUp (one key per side edge) and pack are not published.
 */
export const CLAW_MOD = { w: 30.5, h: 38.5, lcd: 27.7, lcdUp: 21.5, keyUp: 26.5, pack: 6, depth: 16.4, wall: 2.5, end: 3.5, retainer: 2 };

/** Frame outline for a face whose front surface is at y = yF and LCD centre at (x, z): lets callers size heads. */
export function clawFaceBox(x: number, yF: number, z: number) {
  const m = CLAW_MOD, fy = yF - 1.5, zb = z - m.lcdUp;
  return {
    x0: x - m.w / 2 - 0.2 - m.wall, x1: x + m.w / 2 + 0.2 + m.wall,
    y0: fy - m.depth - 0.2 - m.retainer, y1: yF,
    z0: zb - 0.2 - m.end, z1: zb + m.h + 0.2 + m.end,
  };
}

/**
 * The Claw face at LCD centre (x, z) with its front surface at y = yF. Returns `add` (the frame, to union into the
 * head part) and `cut` (pocket, LCD window, LED / switch window, open chin for USB-C, key access, and the retainer
 * envelope, to subtract from the whole head part). Adds the module, a screw-on retainer and two key plungers, one out
 * through each side wall of the frame (the board has one key on each side edge), or out to `keyReach` (x of the head's
 * outer side surfaces, [left, right]; a single number is the right side, mirrored) when the head is wider there.
 */
export function clawFace(b: Build, spec: RobotSpec, link: string, at: { x: number; yF: number; z: number; keyReach?: number | [number, number] }) {
  const m = CLAW_MOD, { x, yF, z } = at;
  const fy = yF - 1.5;                                     // inner face of the 1.5 mm bezel = LCD glass front
  const zb = z - m.lcdUp, zt = zb + m.h;                    // module bottom / top edges
  const f = clawFaceBox(x, yF, z);
  const yBack = fy - m.depth - 0.2;                         // open back of the pocket (retainer face)
  const kz = zb + m.keyUp, ky = fy - 3.8;
  const screws: [number, number][] = [[x, zt + 0.2 + m.end / 2], [x + 10, zb - 0.2 - m.end / 2]];

  const r = at.keyReach;
  const reach = [Math.min(Array.isArray(r) ? r[0] : r !== undefined ? 2 * x - r : f.x0, f.x0), Math.max(Array.isArray(r) ? r[1] : r ?? f.x1, f.x1)];
  const keys = [-1, 1].map((s, i) => ({ s, edge: x + s * m.w / 2, out: reach[i] }));   // left key, right key
  const span = (a: number, c: number) => [Math.min(a, c), Math.max(a, c)] as const;
  const add = box(f.x0, f.x1, yBack, f.y1, f.z0, f.z1);
  const keyCut = union(keys.map(k => cylX(ky, kz, 2.7, ...span(k.edge - k.s * 0.5, k.out + k.s), 24)));
  const cut = union([
    box(x - m.w / 2 - 0.2, x + m.w / 2 + 0.2, yBack - 0.01, fy, zb - 0.2, zt + 0.2),                        // module pocket
    // key bodies, each with a groove back to the open end of the pocket so the module slides in with its side keys
    ...keys.map(k => box(...span(k.edge - k.s * 0.5, k.edge + k.s * 1.8), yBack - 0.01, fy - 1.8, kz - 2.6, kz + 2.6)),
    box(x - m.lcd / 2, x + m.lcd / 2, fy - 0.5, yF + 1, z - m.lcd / 2, z + m.lcd / 2),                       // LCD window
    box(x - 8, x + 8, fy - 0.5, yF + 1, zb + 0.5, zb + 5.5),                                                // LEDs + ON/OFF
    box(x - 8, x + 8, yBack - 0.01, fy, f.z0 - 1, zb + 0.1),                                               // chin: USB-C, switch
    keyCut,
    box(f.x0 - 0.2, f.x1 + 0.2, f.y0 - 0.2, yBack, f.z0 - 0.2, f.z1 + 0.2),                                 // retainer envelope
    ...screws.map(([sx, sz]) => cylY(sx, sz, HOLES.M2.tap / 2, yBack - 0.5, yBack + 6, 12)),
    box(x - 7, x + 7, f.y0 - 12, f.y0 + 0.1, zb - 3, zb + 3),                                              // the leads on into the head behind
  ]);

  // the module's leads: out of its bottom edge through the retainer window and on into the head behind the face
  b.cableway(box(x - 7, x + 7, f.y0 - 12, fy, zb - 3, zb + 3));
  b.part({ id: 'claw_retainer', name: 'Claw module retainer', link, material: spec.structural, profile: 'shell', color: spec.accentColor,
    solid: sub(box(f.x0, f.x1, f.y0, yBack - 0.02, f.z0, f.z1),
      ...screws.map(([sx, sz]) => cylY(sx, sz, HOLES.M2.clear / 2, f.y0 - 1, yBack + 1, 12)),
      box(x - 7, x + 7, f.y0 - 1, yBack + 1, zb - 3, zb + 3)),                                              // cable window (module's bottom edge)
    printRot: [90, 0, 0], printNote: 'Flat; screws over the back of the Claw module.' });
  keys.forEach((k, i) => b.part({
    id: `key_plunger_${i + 1}`, name: `Key plunger ${i ? 'right' : 'left'}`, link, material: spec.structural, profile: 'shell', color: spec.accentColor,
    solid: union([cylX(ky, kz, 2.4, ...span(k.edge + k.s * 1.6, k.out + k.s * 1.5), 24), cylX(ky, kz, 3.4, ...span(k.out + k.s * 1.5, k.out + k.s * 3), 24)]),
    printRot: [0, 90, 0], printNote: 'Cap down; slides in its bore and presses the side key.',
  }));

  b.comp({ key: 'core', catalogId: 'LICHEERV-NANO-W', label: 'LicheeRV Nano W', link, color: '#1c1917',
    solid: union([box(x - 11.43, x + 11.43, fy - 10.4, fy - 5.4, zb + 1, zb + 1 + 35.56), box(x - 4.5, x + 4.5, fy - 9.2, fy - 6.2, zb - 3, zb + 1.01)]) });
  b.comp({ key: 'shield', catalogId: 'PICOCLAW-BOARD', label: 'PicoClaw board + 240x240 LCD (the face)', link, color: '#0f172a',
    solid: union([
      box(x - m.w / 2, x + m.w / 2, fy - 5.4, fy - 3.8, zb, zt),
      box(x - 14.25, x + 14.25, fy - 3.81, fy - 0.1, z - 15, z + 15),
      ...keys.map(k => box(...span(k.edge - k.s * 0.01, k.edge + k.s * 1.5), fy - 5.4, fy - 2.2, kz - 2, kz + 2)),
      box(x - 7.5, x + 7.5, fy - 3.81, fy - 0.6, zb, zb + 5),
      box(x - 14, x + 14, fy - m.depth, fy - 10.45, zb + 3, zt - 3),   // built-in LiPo + speaker behind the Nano
    ]) });
  b.screw('M2×6 self-tap', 2, 'Claw retainer');
  b.step('Face: flash the PicoClaw image to the TF card, push the two key plungers into their bores from outside, slide the Claw module into the face frame from behind (LCD forward, USB-C down through the chin) and screw the retainer on (2 × M2×6). The module has its own battery and speaker; only the servo-board lead (if any) runs with its cable. Charge through the USB-C under the chin (use a right-angle plug where the head is closed below).');
  // what must stay open in front of the face (LCD window, LEDs + switch) and beside it (the key plungers), 120 mm out,
  // so features on any part can frame the screen but never cover it
  const openings = union([
    box(x - m.lcd / 2, x + m.lcd / 2, fy - 0.5, yF + 120, z - m.lcd / 2, z + m.lcd / 2),
    box(x - 8, x + 8, fy - 0.5, yF + 120, zb + 0.5, zb + 5.5),
    ...keys.map(k => cylX(ky, kz, 4, ...span(k.edge, k.out + k.s * 20), 24)),
  ]);
  return { add, cut, box: f, keyZ: kz, screws, openings };
}

/**
 * Claw deck electronics in place of the CyberBrick shield stack: a PCA9685 lying on 4 bosses (headers up) for the
 * servos. `alongY` turns the board's long side along Y. (The battery and speaker are built into the Claw module.)
 */
export function clawDeck(b: Build, link: string, deckTop: number, at: { pca?: [number, number]; alongY?: boolean }) {
  const adds: M[] = [], cuts: M[] = [];
  if (at.pca) {
    const [px, py] = at.pca;
    const [lx, ly] = at.alongY ? [25.4, 62.5] : [62.5, 25.4];
    const [hx, hy] = at.alongY ? [19.1 / 2, 55.9 / 2] : [55.9 / 2, 19.1 / 2];
    const holes = [-1, 1].flatMap(sx => [-1, 1].map(sy => [px + sx * hx, py + sy * hy] as [number, number]));
    const z0 = deckTop + 4;
    adds.push(...holes.map(([hx2, hy2]) => cylZ(hx2, hy2, 2.9, deckTop - 0.01, z0)));
    cuts.push(...holes.map(([hx2, hy2]) => cylZ(hx2, hy2, HOLES.M2_5.tap / 2, deckTop - 3, z0 + 1, 16)), cboxXY(px, py, 10, 6, deckTop - 5, deckTop + 1));
    b.comp({ key: 'servo_driver', catalogId: 'PCA9685-SERVO-16', label: 'PCA9685 servo driver (I2C)', link, color: '#1565c0',
      solid: union([cboxXY(px, py, lx, ly, z0, z0 + 1.6), ...(at.alongY
        ? [cboxXY(px - 7, py, 9, 48, z0 + 1.6, z0 + 10.1), cboxXY(px + 7, py - 25.5, 7, 11, z0 + 1.6, z0 + 9.6)]
        : [cboxXY(px, py - 7, 48, 9, z0 + 1.6, z0 + 10.1), cboxXY(px - 25.5, py + 7, 11, 7, z0 + 1.6, z0 + 9.6)])]) });
    b.screw('M2.5×6', 4, 'PCA9685 board to deck');
  }
  return { add: adds.length ? union(adds) : null, cut: cuts.length ? union(cuts) : null };
}

/** Battery catalog id for a twin-cell bay: the 1S2P 14500 pack on the Claw kit (same envelope as B-PC003). */
export const bayBattery = (spec: RobotSpec) => spec.platform === 'licheerv_claw'
  ? { id: 'BAT-1S2P-14500', label: 'Battery 1S2P 14500 (Claw)' }
  : { id: 'B-PC003', label: 'Battery B-PC003' };
