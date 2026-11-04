// Reusable CyberBrick modules: component envelopes, servo mounts and horn seats, the isolated battery
// bay, the electronics deck and the pan-tilt head. Shared by every archetype generator.

import { FIT, HOLES } from '../catalog/rules';
import { CATALOG } from '../catalog/components';
import type { RobotSpec } from '../design/spec';
import type { Vec3 } from './types';
import { Build, box, cboxXY, cylX, cylY, cylZ, rrect, sub, union, type M } from './kernel';
import { getComponentSolid, getComponentColor } from './components3d';
import { CLAW_MOD, clawFace, clawFaceBox } from './claw';

export * from './components3d';

// ---------------------------------------------------------------- B-PG001 / B-PG002 envelope
// Servo frame S: shaft = +z through the origin, z = 0 is the underside of the mounting ears
// (the face that rests on the mounting plate). Case length runs along +x.
export const SV = {
  L: 22.8, W: 12.0, shaftOff: 5.9, below: 18.4, above: 4.3, earT: 2.5, earSpan: 32.4, earPitch: 27.8,
  splineTop: 10.1, splineR: 2.4,
};
export const SV_X0 = -SV.shaftOff;                 // -5.9
export const SV_X1 = SV.L - SV.shaftOff;           // 16.9
export const SV_CX = (SV_X0 + SV_X1) / 2;          // 5.5
export const EAR_HOLES = [SV_CX - SV.earPitch / 2, SV_CX + SV.earPitch / 2]; // -8.4, 19.4
export const EAR_X0 = SV_CX - SV.earSpan / 2, EAR_X1 = SV_CX + SV.earSpan / 2; // -10.7, 21.7
/** Child parts seat on the horn arm's lower face, which is level with the spline tip. */
export const HORN_SEAT = SV.splineTop;             // 10.1
export const HORN_FACE = 11.6;
export const HORN_PILOTS = [10.0, 13.5];

/** A placement of the servo frame in the world: rotations applied in order, then translate. */
export interface Frame { rots: Vec3[]; pos: Vec3; mirrorX?: boolean }
export const place = (m: M, f: Frame): M => {
  let r = m;
  for (const a of f.rots) r = r.rotate(a);
  r = r.translate(f.pos);
  return f.mirrorX ? r.mirror([1, 0, 0]) : r;
};
/** Map a point from servo frame to world. */
export function toWorld(p: Vec3, f: Frame): Vec3 {
  let [x, y, z] = p;
  for (const [ax, ay, az] of f.rots) {
    // manifold applies X, then Y, then Z rotations (extrinsic)
    if (ax) { const c = Math.cos(ax * Math.PI / 180), s = Math.sin(ax * Math.PI / 180); [y, z] = [c * y - s * z, s * y + c * z]; }
    if (ay) { const c = Math.cos(ay * Math.PI / 180), s = Math.sin(ay * Math.PI / 180); [x, z] = [c * x + s * z, -s * x + c * z]; }
    if (az) { const c = Math.cos(az * Math.PI / 180), s = Math.sin(az * Math.PI / 180); [x, y] = [c * x - s * y, s * x + c * y]; }
  }
  const w: Vec3 = [x + f.pos[0], y + f.pos[1], z + f.pos[2]];
  if (f.mirrorX) w[0] = -w[0];
  return w;
}
export const axisWorld = (f: Frame): Vec3 => {
  const o = toWorld([0, 0, 0], f), a = toWorld([0, 0, 1], f);
  return [Math.round(a[0] - o[0]), Math.round(a[1] - o[1]), Math.round(a[2] - o[2])] as Vec3;
};

export function servoSolid(): M {
  return union([
    box(SV_X0, SV_X1, -SV.W / 2, SV.W / 2, -SV.below, SV.above),
    box(EAR_X0, EAR_X1, -SV.W / 2, SV.W / 2, 0, SV.earT),
    cylZ(0, 0, SV.splineR, SV.above, SV.splineTop),
  ]);
}

/** Single-arm horn (belongs to the driven link). */
export function hornSolid(): M {
  return sub(union([cylZ(0, 0, 3.5, 7.6, HORN_FACE), box(-2.5, 16.0, -2.5, 2.5, HORN_SEAT, HORN_FACE)]),
    cylZ(0, 0, SV.splineR + 0.05, 7.5, SV.splineTop + 0.05));
}

/** Cuts for a child part whose face sits on the horn seat (servo frame, part on +z side). */
export function hornSeatCuts(depth = 8): M {
  const d = HORN_FACE - HORN_SEAT + 0.2;
  return union([
    box(-2.7, 16.2, -2.7, 2.7, HORN_SEAT - 0.01, HORN_SEAT + d),       // arm recess
    cylZ(0, 0, 3.7, HORN_SEAT - 0.01, HORN_SEAT + d),                   // hub recess
    cylZ(0, 0, FIT.tunnel / 2, HORN_SEAT - 1, HORN_SEAT + depth + 1),   // Ø6.5 tunnel for the centre screw
    ...HORN_PILOTS.map(x => cylZ(x, 0, HOLES.M2.tap / 2, HORN_SEAT - 1, HORN_SEAT + depth + 1, 16)),
  ]);
}

/** Through-pocket for the case in a plate lying in z ∈ [-t, 0], with M2 ear tap holes going -z. */
export function servoPlateCuts(t: number, tapDepth = 8): M {
  const c = FIT.push / 2;
  return union([
    box(SV_X0 - c, SV_X1 + c, -SV.W / 2 - c, SV.W / 2 + c, -t - 1, 1),
    ...EAR_HOLES.map(x => cylZ(x, 0, HOLES.M2.tap / 2, -tapDepth, 1, 16)),
  ]);
}

// ---------------------------------------------------------------- other modules
export const BAT = { x: 28.4, y: 51.2, z: 16.3, cellR: 7.1 };
export const BAY = { x: BAT.x + 1.0, y: BAT.y + 1.5, wall: 2.0 };   // swell margin (guide s.11)
export const SHIELD = { x: 29, y: 30, z: 12, holes: [23, 24] as const };
export const CORE = { x: 22, y: 27, z: 11.2 };
export const SWITCH = { x: 14.0, y: 20.5, z: 13.5 };
export const HUB = { x: 6, y: 28, z: 11 };
export const LED = 6.0;

/** Battery as two cells plus the BMS/wrap top (so the trough clearance is real). */
export function batterySolid(cx: number, cy: number, z0: number): M {
  const zc = z0 + BAT.cellR;
  return union([
    cylY(cx - BAT.cellR, zc, BAT.cellR, cy - BAT.y / 2, cy + BAT.y / 2),
    cylY(cx + BAT.cellR, zc, BAT.cellR, cy - BAT.y / 2, cy + BAT.y / 2),
    box(cx - BAT.x / 2, cx + BAT.x / 2, cy - BAT.y / 2, cy + BAT.y / 2, zc, z0 + BAT.z),
  ]);
}

/**
 * Isolated battery bay (guide s.11): walls, twin troughs, finger reliefs, 10x6 egress slot, and
 * strap bosses outside |x| = half-width + 2. Battery lies along Y. Returns solids to add/cut.
 */
export function batteryBay(cx: number, cy: number, floorTop: number, opts: { reliefY: number; strapY: number; egress: 'rear' | 'front' }) {
  const hx = BAY.x / 2, hy = BAY.y / 2, w = BAY.wall;
  const wallTop = floorTop + 12;
  const batZ0 = floorTop + 0.5;
  const strapZ0 = batZ0 + BAT.z + 0.2;
  const bossX = hx + 2.0 + 2.9 + 0.2;           // boss fully outside the bay (guide rule)
  const add = union([
    box(cx - hx - w, cx - hx, cy - hy - w, cy + hy + w, floorTop - 0.01, wallTop),
    box(cx + hx, cx + hx + w, cy - hy - w, cy + hy + w, floorTop - 0.01, wallTop),
    box(cx - hx - w, cx + hx + w, cy - hy - w, cy - hy, floorTop - 0.01, wallTop),
    box(cx - hx - w, cx + hx + w, cy + hy, cy + hy + w, floorTop - 0.01, wallTop),
    // trough pad
    sub(box(cx - hx, cx + hx, cy - hy, cy + hy, floorTop - 0.01, floorTop + 3),
      cylY(cx - BAT.cellR, batZ0 + BAT.cellR, BAT.cellR + 0.5, cy - hy - 1, cy + hy + 1),
      cylY(cx + BAT.cellR, batZ0 + BAT.cellR, BAT.cellR + 0.5, cy - hy - 1, cy + hy + 1)),
  ]);
  const ey = opts.egress === 'rear' ? cy - hy - w / 2 : cy + hy + w / 2;
  const cut = union([
    // Ø18 finger reliefs on the left/right walls only
    sub(cylX(opts.reliefY, wallTop, 9, cx - hx - w - 9, cx + hx + w + 9), box(cx - hx + 0.01, cx + hx - 0.01, cy - hy - 50, cy + hy + 50, -50, 200)),
    box(cx - 5, cx + 5, ey - w, ey + w, wallTop - 6, wallTop + 1),             // 10 x 6 egress slot
  ]);
  const bosses = union([-1, 1].map(s => cylZ(cx + s * bossX, opts.strapY, 2.9, floorTop - 0.01, strapZ0)));
  const bossTaps = union([-1, 1].map(s => cylZ(cx + s * bossX, opts.strapY, HOLES.M2_5.tap / 2, strapZ0 - 10, strapZ0 + 1, 16)));
  return { add, cut, bosses, bossTaps, batZ0, strapZ0, bossX, top: strapZ0 + 2.8, outerHX: hx + w, outerHY: hy + w };
}

/** Rigid 2.8 mm cross-strap (guide s.11). */
export function strapPart(cx: number, y: number, z0: number, bossX: number): M {
  return sub(rrect(2 * bossX + 6, 12, 3, cx, y, z0, z0 + 2.8),
    ...[-1, 1].map(s => cylZ(cx + s * bossX, y, HOLES.M2_5.clear / 2, z0 - 1, z0 + 4, 16)));
}

export function shieldStack(cx: number, cy: number, z0: number): { shield: M; core: M } {
  return {
    shield: cboxXY(cx, cy, SHIELD.x, SHIELD.y, z0, z0 + SHIELD.z),
    core: cboxXY(cx, cy, CORE.x, CORE.y, z0 + SHIELD.z, z0 + SHIELD.z + CORE.z),
  };
}

/** Electronics on a deck top surface: shield bosses, LED hub boss, switch cradle. Returns adds/cuts. */
export function electronics(
  b: Build,
  link: string,
  deckTop: number,
  at: { shield: [number, number]; hub: [number, number]; sw: [number, number]; swAlongX?: boolean },
  opts?: { coreId?: string; shieldId?: string }
) {
  const [sx, sy] = at.shield, [hx, hy] = at.hub, [wx, wy] = at.sw;
  const swX = at.swAlongX ? SWITCH.y : SWITCH.x, swY = at.swAlongX ? SWITCH.x : SWITCH.y;
  const bossH = 4;
  const holes = [-1, 1].flatMap(i => [-1, 1].map(j => [sx + i * SHIELD.holes[0] / 2, sy + j * SHIELD.holes[1] / 2] as [number, number]));
  const add = union([
    ...holes.map(([x, y]) => cylZ(x, y, 2.9, deckTop - 0.01, deckTop + bossH)),
    cylZ(hx, hy, 2.9, deckTop - 0.01, deckTop + 3),
    // switch cradle: 4 mm push-fit walls + ear boss
    sub(cboxXY(wx, wy, swX + FIT.push + 4, swY + FIT.push + 4, deckTop - 0.01, deckTop + 4),
      cboxXY(wx, wy, swX + FIT.push, swY + FIT.push, deckTop, deckTop + 5)),
  ]);
  const cut = union([
    ...holes.map(([x, y]) => cylZ(x, y, HOLES.M2_5.tap / 2, deckTop - 3, deckTop + bossH + 1, 16)),
    cylZ(hx, hy, HOLES.M2_5.tap / 2, deckTop - 3, deckTop + 4, 16),
    cboxXY(wx, wy, 10, 6, deckTop - 5, deckTop + 1),                     // switch lead pass-through
  ]);

  const coreId = opts?.coreId ?? 'B-XA003';
  const shieldId = opts?.shieldId ?? 'B-XA004';

  if (coreId === 'B-XA003' && shieldId === 'B-XA004') {
    const st = shieldStack(sx, sy, deckTop + bossH);
    b.comp({ key: 'shield', catalogId: 'B-XA004', label: 'Shield B-XA004', link, solid: st.shield, color: '#1d5e3a' });
    b.comp({ key: 'core', catalogId: 'B-XA003', label: 'Core B-XA003', link, solid: st.core, color: '#202020' });
  } else {
    const shieldSolid = getComponentSolid(shieldId, sx, sy, deckTop + bossH);
    const shieldColor = getComponentColor(shieldId);
    b.comp({ key: 'shield', catalogId: shieldId, label: CATALOG[shieldId]?.name ?? shieldId, link, solid: shieldSolid, color: shieldColor });

    const coreSolid = getComponentSolid(coreId, sx, sy, deckTop + bossH + (CATALOG[shieldId]?.size[2] ?? 12));
    const coreColor = getComponentColor(coreId);
    b.comp({ key: 'core', catalogId: coreId, label: CATALOG[coreId]?.name ?? coreId, link, solid: coreSolid, color: coreColor });
  }

  b.comp({ key: 'hub', catalogId: 'B-XA006', label: 'LED hub B-XA006', link, solid: cboxXY(hx, hy, HUB.x, HUB.y, deckTop + 3, deckTop + 3 + HUB.z), color: '#244a8a' });
  b.comp({ key: 'switch', catalogId: 'B-XA007', label: 'Switch B-XA007', link, solid: cboxXY(wx, wy, swX, swY, deckTop + 0.01, deckTop + SWITCH.z), color: '#3a3a3a' });
  b.screw('M2.5×6', 4, 'shield to deck');
  b.screw('M2.5×6', 2, 'LED hub + switch ear');
  return { add, cut };
}

/** LED pocket for a B-KB003 behind a face, pointing along `dir` (+y or +z). */
export function ledPocketCuts(c: Vec3, dir: 'y' | 'z', faceT: number): M {
  const p = 3.3;  // 6.6 x 6.6 pocket (guide s.3)
  if (dir === 'y') return union([
    box(c[0] - p, c[0] + p, c[1] - faceT - 1, c[1] - 1.0, c[2] - p, c[2] + p),   // from the back, 1 mm front skin
    cylY(c[0], c[2], 2.25, c[1] - faceT - 1, c[1] + 1, 24),                     // Ø4.5 light window
  ]);
  return union([
    box(c[0] - p, c[0] + p, c[1] - p, c[1] + p, c[2] - 2.0, c[2] + 1),
    cylZ(c[0], c[1], 1.5, c[2] - faceT - 1, c[2], 16),
  ]);
}

export function ledSolid(c: Vec3, dir: 'y' | 'z'): M {
  return dir === 'y' ? cboxXY(c[0], c[1] - 1.05 - 1.4, LED, 2.8, c[2] - LED / 2, c[2] + LED / 2)
    : cboxXY(c[0], c[1], LED, LED, c[2] - 2.0 + 0.1, c[2] + 0.8);
}

// ---------------------------------------------------------------- pan-tilt head
/**
 * Pan servo in a tower on the deck (shaft up), tilt bracket on the pan horn carrying the tilt servo
 * (shaft along +X, ears on the outer face of the right wall), and a U-shaped head on the tilt horn
 * with an M3 idler axle on the left. Returns joint data for links 'pan' and 'tilt'.
 */
/** A positional servo standing shaft-up in a hollow tower on a deck (case toward the rear). */
export function servoTower(b: Build, parentLink: string, childLink: string, deckTop: number, x0: number, yp: number, key: string, label: string, riser = 0, catalogId = 'B-PG001') {
  const towerTop = deckTop + riser + SV.below + 0.6;
  const f: Frame = { rots: [[0, 0, -90]], pos: [x0, yp, towerTop] };  // S x -> -Y: case extends toward the rear
  const hwT = SV.W / 2 + FIT.push / 2 + 2.3;
  const ty0 = yp - (EAR_X1 + 2.0), ty1 = yp - (EAR_X0 - 2.0);
  const tower = sub(
    union([
      sub(box(x0 - hwT, x0 + hwT, ty0, ty1, deckTop - 0.01, towerTop), box(x0 - hwT + 2.3, x0 + hwT - 2.3, ty0 + 2.3, ty1 - 2.3, deckTop - 1, towerTop - 3)),
      ...EAR_HOLES.map(ex => { const w = toWorld([ex, 0, 0], f); return cylZ(w[0], w[1], 2.3, towerTop - 8, towerTop); }),
    ]),
    place(servoPlateCuts(3, 8), f),
  );
  const towerCut = cboxXY(x0, (ty0 + ty1) / 2, 6, 10, deckTop - 4, deckTop + 1);   // servo lead into the deck
  b.comp({ key: `servo_${key}`, catalogId, label, link: parentLink, solid: place(servoSolid(), f) });
  b.comp({ key: `horn_${key}`, catalogId: 'horn', label: `${label} horn`, link: childLink, solid: place(hornSolid(), f), color: '#f0f0f0' });
  return { tower, towerCut, towerTop, frame: f, seat: towerTop + HORN_SEAT, footprint: { x0: x0 - hwT, x1: x0 + hwT, y0: ty0, y1: ty1 } };
}

export function panTilt(b: Build, spec: RobotSpec, parentLink: string, deckTop: number, x0: number, yp: number, leds: number, ports: [string, string] = ['S3', 'S4']) {
  const st = servoTower(b, parentLink, 'pan', deckTop, x0, yp, 'pan', `Pan servo (${ports[0]})`);
  const { tower, towerCut, towerTop } = st;
  const panF = st.frame;

  // ---- tilt bracket (pan link)
  const ps = towerTop + HORN_SEAT;           // bracket underside
  const xr = x0 + 8;                         // outer face of the right wall = tilt servo ear face
  const zt = ps + 4 + 0.6 + SV.W / 2;        // tilt axis height
  const tiltF: Frame = { rots: [[0, 90, 0], [-90, 0, 0]], pos: [xr, yp, zt] };
  // Ry(90) then Rx(-90): S z -> +X (shaft), S x -> -Y (case toward the rear), S y -> -Z.
  const bx0 = x0 - 16, bx1 = xr;
  const by0 = yp - (EAR_X1 + 1.5), by1 = yp - (EAR_X0 - 1.5);
  const bracket = sub(
    union([
      box(bx0, bx1, yp - 9, yp + 9, ps, ps + 4),
      box(xr - 5, xr, by0, by1, ps, zt + SV.W / 2 + 3),                  // right wall (servo ears)
      box(bx0, bx0 + 4, yp - 6, yp + 6, ps, zt + 6),                     // left wall (idler axle)
    ]),
    place(hornSeatCuts(4), panF),
    place(union([
      box(SV_X0 - 0.2, SV_X1 + 0.2, -SV.W / 2 - 0.2, SV.W / 2 + 0.2, -6, 1),
      ...EAR_HOLES.map(ex => cylZ(ex, 0, HOLES.M2.tap / 2, -5.5, 1, 16)),
    ]), tiltF),
    cylX(yp, zt, HOLES.M3.tap / 2, bx0 - 1, bx0 + 4.5),
  );
  b.part({ id: 'tilt_bracket', name: 'Tilt bracket', link: 'pan', material: spec.structural, profile: 'motorMount', color: spec.accentColor, solid: bracket, printRot: [0, 0, 0], printNote: 'Flat on its base; the walls print upright.' });
  b.comp({ key: 'servo_tilt', catalogId: 'B-PG001', label: `Tilt servo (${ports[1]})`, link: 'pan', solid: place(servoSolid(), tiltF) });
  b.comp({ key: 'horn_tilt', catalogId: 'horn', label: 'Tilt horn', link: 'tilt', solid: place(hornSolid(), tiltF), color: '#f0f0f0' });

  // ---- multi-part screw-together head (tilt link): Head Front Shell + Head Top & Rear Enclosure Cap
  // LicheeRV Claw kit: the Claw module is the face (src/cad/claw.ts), in front of the bracket; no LED eyes.
  const claw = spec.platform === 'licheerv_claw';
  const cx0 = bx0 - 1.0 - 4, cx1 = xr + HORN_SEAT + 4;   // cheek outer faces
  const hc = (cx0 + cx1) / 2;
  const faceAt = { x: hc, yF: yp + 24 + CLAW_MOD.depth - 4.4, z: zt + 12 };     // the frame's lower back corner must clear the pan servo when tilting
  const face = claw ? clawFaceBox(faceAt.x, faceAt.yF, faceAt.z) : null;
  const width = Math.max(spec.params.headWidth, cx1 - cx0 + 4, face ? face.x1 - face.x0 + 12 : 0);
  const fy0 = face ? face.y0 : yp + 17, fy1 = face ? face.y1 : fy0 + 4;   // face far enough forward to clear the walls at ±35°
  const fz0 = zt - 10, fz1 = face ? face.z1 : zt + 16;
  const capZ0 = fz1 + 0.02, capZ1 = fz1 + 4.5;
  const eyeZ = zt + 5;
  const eyes: Vec3[] = claw ? [] : leds >= 2 ? [[hc - width * 0.24, fy1, eyeZ], [hc + width * 0.24, fy1, eyeZ]] : leds === 1 ? [[hc, fy1, eyeZ]] : [];
  const cf = claw ? clawFace(b, spec, 'tilt', faceAt) : null;

  // 4 corner M2.5 screw bosses joining Head Top & Rear Cap to Head Front Shell
  const headCapBosses: [number, number][] = [
    [cx0 + 2, yp - 5],
    [cx1 - 2, yp - 5],
    [hc - width / 2 + 4, yp + 12],
    [hc + width / 2 - 4, yp + 12],
  ];

  const frontFeatures: M[] = [];
  if (claw) {
    // the screen is the face: no beak or visor over it
  } else if (spec.params.headFeature === 'beak') {
    frontFeatures.push(
      sub(
        rrect(16, 12, 4, hc, fy1 + 5, zt - 4, zt + 1),
        box(hc - 7, hc + 7, fy1 + 1, fy1 + 12, zt - 1.8, zt - 1.2)
      )
    );
  } else if (spec.params.headFeature === 'visor') {
    frontFeatures.push(rrect(width + 2, 5, 2, hc, fy1 + 1, zt + 9, zt + 13));
  }

  const cheekY1 = cf ? cf.box.y0 + 2.2 + 3 : fy0 + 0.01;                 // claw: cheeks run into the frame's side walls
  const headFront = sub(
    union([
      cf ? cf.add : box(hc - width / 2, hc + width / 2, fy0, fy1, fz0, fz1),
      box(hc - width / 2, cx0 + 4, yp - 9, cheekY1, zt - 9, fz1),        // sculpted left cheek wall (idler)
      box(cx1 - 4, hc + width / 2, yp - 9, cheekY1, zt - 9, fz1),        // sculpted right cheek wall (horn)
      box(hc - width / 2, hc + width / 2, yp + 8, fy0 + 0.01, zt + 13, fz1), // upper front bridge
      ...headCapBosses.map(([bx, by]) => cylZ(bx, by, 2.2, zt + 11, fz1)),
      ...frontFeatures,
    ]),
    place(hornSeatCuts(4), tiltF),
    cylX(yp, zt, HOLES.M3.clear / 2, hc - width / 2 - 1, cx0 + 5),
    ...headCapBosses.map(([bx, by]) => cylZ(bx, by, HOLES.M2_5.tap / 2, zt + 11.5, fz1 + 1, 16)),
    ...eyes.map(e => ledPocketCuts(e, 'y', 4)),
    ...(cf ? [cf.cut] : [box(hc - 8, hc + 8, fy0 - 1, fy1 + 1, zt - 8, zt - 5)]),   // Claw face, or the sensor / mouth acoustic slot
  );

  b.part({
    id: 'head',
    name: 'Head front face & cheek shell',
    link: 'tilt',
    material: spec.structural,
    profile: 'shell',
    color: spec.primaryColor,
    solid: headFront,
    printRot: [-90, 0, 0],
    printNote: 'Face down on the bed; cheeks and bridge print upright with open access to install LEDs and horn.',
  });

  // Part 2 of Pan-Tilt Head: Enclosed Top & Rear Cap (screws onto Head Front Shell with 4 × M2.5×6)
  const capFeatures: M[] = [];
  if (spec.params.headFeature === 'ears') {
    capFeatures.push(
      box(hc - width / 2 + 2, hc - width / 2 + 9, fy0 - 6, fy0 - 2, capZ1 - 1, capZ1 + 8),
      box(hc + width / 2 - 9, hc + width / 2 - 2, fy0 - 6, fy0 - 2, capZ1 - 1, capZ1 + 8),
    );
  } else if (spec.params.headFeature === 'dome') {
    capFeatures.push(cylZ(hc, (yp + fy1) / 2, width * 0.28, capZ1 - 1, capZ1 + 4, 24));
  }

  const headRearCap = sub(
    union([
      // Main curved crown roof over head
      rrect(width, fy1 - (yp - 6), 4, hc, (yp - 6 + fy1) / 2, capZ0, capZ1),
      // Rear cheek roof extensions over the left/right cheek bosses
      box(hc - width / 2, cx0 + 4.5, yp - 9, yp - 4, capZ0, capZ1 - 1),
      box(cx1 - 4.5, hc + width / 2, yp - 9, yp - 4, capZ0, capZ1 - 1),
      ...capFeatures,
    ]),
    ...headCapBosses.map(([bx, by]) => cylZ(bx, by, HOLES.M2_5.clear / 2, capZ0 - 1, capZ1 + 2, 16)),
  );

  b.part({
    id: 'head_cap',
    name: 'Head top & rear enclosure cap',
    link: 'tilt',
    material: spec.shell,
    profile: 'shell',
    color: spec.accentColor,
    solid: headRearCap,
    printRot: [0, 0, 0],
    printNote: 'Flat base on bed; closes the top of the head and fastens with 4 × M2.5×6 screws.',
  });

  eyes.forEach((e, i) => b.comp({ key: `led_eye${i}`, catalogId: 'B-KB003', label: `Eye LED ${i + 1}`, link: 'tilt', solid: ledSolid(e, 'y'), color: '#f6f6f6' }));

  b.link({
    id: 'pan', name: 'Pan', parent: parentLink,
    joint: { origin: [x0, yp, towerTop], axis: [0, 0, 1], limit: [-90, 90], actuator: { kind: 'servo', catalogId: 'B-PG001', port: ports[0], label: 'pan' } },
    colliders: [{ shape: 'box', center: [(bx0 + bx1) / 2, yp, (ps + zt + 6) / 2], half: [(bx1 - bx0) / 2, 9, (zt + 6 - ps) / 2] }],
  });
  b.link({
    id: 'tilt', name: 'Tilt', parent: 'pan',
    joint: { origin: [xr, yp, zt], axis: axisWorld(tiltF), limit: [claw ? -15 : -30, 35], actuator: { kind: 'servo', catalogId: 'B-PG001', port: ports[1], label: 'tilt' } },
    colliders: [{ shape: 'box', center: [hc, (yp - 9 + fy1) / 2, (Math.min(fz0, face?.z0 ?? fz0) + capZ1) / 2], half: [width / 2, (fy1 - yp + 9) / 2, (capZ1 - Math.min(fz0, face?.z0 ?? fz0)) / 2] }],
  });
  b.screw('M2×8 self-tap', 8, 'pan + tilt servo ears (servo bag)');
  b.screw('M2×6 self-tap', 4, 'horn arms to bracket/head (servo bag)');
  b.screw('M2.5×6', 4, 'head top enclosure cap to head front shell');
  b.screw('M3×12', 1, 'head idler axle');
  b.extra('Nylon washer M3', 1);
  b.step('Pan-tilt: centre both servos (send `calib`). Drop the pan servo into the tower from above, cable down through the deck slot, and screw the ears. Fit the tilt servo through the bracket wall from outside and screw its ears. Screw a horn into the bracket recess, press it onto the pan spline facing forward and drive the centre screw through the Ø6.5 tunnel. Mount the Head Front Shell on the tilt horn, fit the M3×12 idler axle through the left cheek, install the eye LEDs, and screw the Head Top & Rear Enclosure Cap on with 4 × M2.5×6 screws.');
  return { tower, towerCut, towerTop, top: capZ1, eyes: eyes.length };
}

// ---------------------------------------------------------------- Speaker & Acoustic Chamber
export function speakerSolid(cx: number, cy: number, cz0: number): M {
  return union([
    box(cx - 10, cx + 10, cy - 7, cy + 7, cz0, cz0 + 5),
    cylZ(cx, cy, 5.5, cz0 + 4.9, cz0 + 5.5, 20),
  ]);
}

export function speakerGrilleCuts(cx: number, cy: number, z0: number, z1: number): M[] {
  const cuts: M[] = [];
  const rHole = 1.0;
  cuts.push(cylZ(cx, cy, rHole, z0 - 1, z1 + 1, 16));
  for (let r = 3.5; r <= 8.5; r += 2.5) {
    const n = Math.round((2 * Math.PI * r) / 3.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      cuts.push(cylZ(cx + r * Math.cos(a), cy + r * Math.sin(a), rHole, z0 - 1, z1 + 1, 12));
    }
  }
  return cuts;
}

// ---------------------------------------------------------------- Magnetic Phone Stand & Device Mount
export interface PhoneStandResult {
  solid: M;
  magnets: { key: string; solid: M; catalogId: string; label: string }[];
}

export function phoneStandModule(
  deckTop: number,
  spec: RobotSpec,
  opts?: { yBase?: number; maxW?: number }
): PhoneStandResult {
  const P = spec.params;
  const yBase = opts?.yBase ?? 42;
  const w = Math.min(opts?.maxW ?? 56, Math.max(46, P.cradleWidth || 54));
  const h = Math.min(65, Math.max(45, P.cradleHeight || 56));
  const tiltDeg = Math.min(80, Math.max(35, P.mountAngle || 65));
  const alpha = 90 - tiltDeg; // tilt from vertical (e.g. 25 deg)
  const thick = 3.2;
  const halfW = w / 2;

  // Angled backplate built by rotating a box of dimensions [w, thick, h]
  const rawPlate = box(-halfW, halfW, -thick, 0, 0, h);
  const rotPlate = rawPlate.rotate([alpha, 0, 0]).translate([0, yBase, deckTop]);

  // Bottom shelf to support the base of the smartphone (8.0mm forward, clears LED hub at Y=52)
  const shelf = box(-halfW, halfW, yBase - 0.5, yBase + 8.0, deckTop, deckTop + 3.2);
  const lip = box(-halfW, halfW, yBase + 6.0, yBase + 8.0, deckTop + 3.2, deckTop + 7.5);

  // USB-C / Lightning cable slot in the bottom shelf
  const cableCut = box(-7.0, 7.0, yBase - 2, yBase + 9.5, deckTop - 1, deckTop + 8.5);

  // Switch clearance pocket so backplate/gusset never touches B-XA007 toggle
  const swCut = box(-13.0, 13.0, 20.0, 37.0, deckTop - 1, deckTop + 16.0);

  // Triangular side gussets connecting the back of backplate to the deck
  const gussetThick = 2.4;
  const gussetX = Math.min(halfW - 3, 18);
  const gussets: M[] = [-gussetX, gussetX - gussetThick].map(gx => {
    const gb = box(gx, gx + gussetThick, yBase - 8, yBase, deckTop, deckTop + 20);
    const cut = box(gx - 1, gx + gussetThick + 1, yBase - 12, yBase + 2, deckTop + 20, deckTop + 26);
    return sub(gb, cut);
  });

  // Neodymium magnet pockets and component solids
  const magnetCuts: M[] = [];
  const magnetComps: { key: string; solid: M; catalogId: string; label: string }[] = [];
  const magDia = 10.2; // guide s.4: pocket = magnet Ø + 0.20 (CA glue gap)
  const magDepth = 2.2;
  const magZ = h * 0.55;

  for (const [s, key, label] of [[-1, 'magnet_L', 'Neodymium N52 Magnet (Left)'], [1, 'magnet_R', 'Neodymium N52 Magnet (Right)']] as const) {
    const magX = s * Math.min(halfW - 9, 15);
    const rawCylCut = cylY(magX, magZ, magDia / 2, -magDepth, 1.0, 24);
    const rotCut = rawCylCut.rotate([alpha, 0, 0]).translate([0, yBase, deckTop]);
    magnetCuts.push(rotCut);

    const rawMagSolid = cylY(magX, magZ, 5.0, -2.0, -0.1, 24);
    const rotMag = rawMagSolid.rotate([alpha, 0, 0]).translate([0, yBase, deckTop]);
    magnetComps.push({ key, solid: rotMag, catalogId: 'MAG-N52-10X2', label });
  }

  const cuts: M[] = [cableCut, swCut, ...magnetCuts];
  const solid = sub(union([rotPlate, shelf, lip, ...gussets]), ...cuts);

  return { solid, magnets: magnetComps };
}
