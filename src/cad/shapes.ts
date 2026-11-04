// The shape library of the free-form composer: bodies, heads, members and features. Each shape is built in a unit
// cube (centred, 1 × 1 × 1, x right, y front, z up) and then scaled to its world size, so any size works. Profile
// shapes (star, heart, crescent ...) lie in the plane of the two larger sizes and are extruded through the smallest.
//
// Any of them can be the outer shell that covers the electronics: `erode` insets a shape by intersecting copies of it
// shifted by the wall thickness (an approximate Minkowski erosion), which gives an even wall on any shape, convex or not,
// so a cat head, a cloud, a heart or a CRT can hold the core sled, the Claw module and the face block behind it.

import { box, coneZ, cylY, cylZ, ellipsoid, hull, onFreeAll, revolveZ, rrect, sub, taperZ, union, type M } from './kernel';
import type { ShapeKind } from '../design/spec';
import type { Vec3 } from './types';

const unit = (i: number, s = 1): Vec3 => [i === 0 ? s : 0, i === 1 ? s : 0, i === 2 ? s : 0];
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const aabb = (c: Vec3, h: Vec3) => box(c[0] - h[0], c[0] + h[0], c[1] - h[1], c[1] + h[1], c[2] - h[2], c[2] + h[2]);
const UNIT = () => box(-0.5, 0.5, -0.5, 0.5, -0.5, 0.5);
const S = 40;                                           // segments for round unit shapes

/** Polygon / unit solid laid in the plane of the two larger sizes, extruded through the thinnest (a star facing front). */
function throughThin(m: M, s: Vec3): M {
  const thin = s.indexOf(Math.min(...s));
  // built as XY profile extruded along z; turn z onto the thin axis, keeping the profile's "up" (y) on world z
  return thin === 2 ? m : thin === 1 ? m.rotate([90, 0, 0]) : m.rotate([90, 0, 0]).rotate([0, 0, 90]);
}
/** A profile extruded through z; counter-clockwise first (a clockwise outline is an empty cross-section). */
const flat = (pts: [number, number][]) => {
  const area = pts.reduce((s, [x0, y0], i) => { const [x1, y1] = pts[(i + 1) % pts.length]; return s + x0 * y1 - x1 * y0; }, 0);
  return taperZ(area < 0 ? [...pts].reverse() : pts, -0.5, 0.5, 1);
};
const ring = (n: number, r: number, a0 = 90): [number, number][] =>
  Array.from({ length: n }, (_, k) => { const a = (a0 + (360 * k) / n) * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)]; });
/** A regular n-gon prism (vertical), corners on the unit square's inscribed circle. */
const ngon = (n: number) => taperZ(ring(n, 0.5), -0.5, 0.5, 1);
const torusUnit = (major: number, minor: number) => revolveZ(ring(24, minor, 0).map(([x, y]) => [x + major, y] as [number, number]), S);

/** Unit shapes that keep their proportions under any size (all z-up unless noted). */
const UNIT_SHAPES: Partial<Record<ShapeKind, (s: Vec3) => M>> = {
  // ---- domes, arches and caps
  dome: () => sub(ellipsoid([0, 0, -0.5], [0.5, 0.5, 1], S), box(-1, 1, -1, 1, -2, -0.5)),
  arch: () => cylY(0, 0, 0.5, -0.5, 0.5, S).scale([1, 1, 2]).translate([0, 0, -0.5]).intersect(UNIT()),            // loaf / tunnel
  arch_top: () => union([box(-0.5, 0.5, -0.5, 0.5, -0.5, 0), cylY(0, 0, 0.5, -0.5, 0.5, S).intersect(box(-1, 1, -1, 1, 0, 1))]),   // tombstone
  helmet: () => union([sub(ellipsoid([0, 0, -0.35], [0.46, 0.46, 0.85], S), box(-1, 1, -1, 1, -2, -0.35)), cylZ(0, 0, 0.5, -0.5, -0.35, S)]),
  bowl: () => sub(ellipsoid([0, 0, 0.5], [0.5, 0.5, 1], S), box(-1, 1, -1, 1, 0.5, 2)),
  saucer: () => union([ellipsoid([0, 0, -0.15], [0.5, 0.5, 0.2], S), sub(ellipsoid([0, 0, -0.05], [0.25, 0.25, 0.5], S), box(-1, 1, -1, 1, -2, -0.05))]),
  // ---- rings and tubes
  torus: () => torusUnit(0.3, 0.2).scale([1, 1, 2.5]),
  hoop: () => torusUnit(0.3, 0.2).scale([1, 1, 2.5]).rotate([90, 0, 0]),
  tube: () => sub(cylZ(0, 0, 0.5, -0.5, 0.5, S), cylZ(0, 0, 0.36, -1, 1, S)),
  // ---- revolved profiles [radius, z]
  frustum: () => coneZ(0, 0, 0.5, 0.3, -0.5, 0.5, S),
  bell: () => revolveZ([[0, -0.5], [0.5, -0.5], [0.46, -0.42], [0.33, -0.15], [0.27, 0.15], [0.22, 0.38], [0.12, 0.48], [0, 0.5]], S),
  vase: () => revolveZ([[0, -0.5], [0.3, -0.5], [0.46, -0.22], [0.42, 0.08], [0.26, 0.33], [0.3, 0.5], [0, 0.5]], S),
  gumdrop: () => revolveZ([[0, -0.5], [0.5, -0.5], [0.47, -0.2], [0.36, 0.15], [0.2, 0.4], [0, 0.5]], S),
  barrel: () => revolveZ([[0, -0.5], [0.4, -0.5], [0.48, -0.25], [0.5, 0], [0.48, 0.25], [0.4, 0.5], [0, 0.5]], S),
  pear: () => revolveZ([[0, -0.5], [0.33, -0.47], [0.48, -0.3], [0.47, -0.08], [0.32, 0.12], [0.23, 0.3], [0.2, 0.42], [0, 0.5]], S),
  teardrop: () => revolveZ([[0, -0.5], [0.34, -0.44], [0.5, -0.22], [0.45, 0.02], [0.28, 0.24], [0.1, 0.42], [0, 0.5]], S),
  hourglass: () => revolveZ([[0, -0.5], [0.5, -0.5], [0.45, -0.3], [0.22, -0.05], [0.22, 0.05], [0.45, 0.3], [0.5, 0.5], [0, 0.5]], S),
  spinning_top: () => revolveZ([[0, -0.5], [0.12, -0.35], [0.5, 0.05], [0.42, 0.22], [0.12, 0.3], [0.08, 0.5], [0, 0.5]], S),
  acorn: () => union([revolveZ([[0, -0.5], [0.3, -0.42], [0.42, -0.2], [0.42, 0.05], [0, 0.05]], S),
    revolveZ([[0, 0.02], [0.5, 0.02], [0.46, 0.22], [0.25, 0.36], [0.06, 0.4], [0.05, 0.5], [0, 0.5]], S)]),
  mushroom: () => union([cylZ(0, 0, 0.18, -0.5, 0.02, S), sub(ellipsoid([0, 0, -0.05], [0.5, 0.5, 0.55], S), box(-1, 1, -1, 1, -2, -0.05))]),
  puck: () => hull([cylZ(0, 0, 0.5, -0.32, 0.32, S), cylZ(0, 0, 0.42, -0.5, 0.5, S)]),
  drum: () => cylY(0, 0, 0.5, -0.5, 0.5, S),                                                                  // a cylinder facing front
  mug: () => union([cylZ(-0.08, 0, 0.42, -0.5, 0.5, S), torusUnit(0.17, 0.05).rotate([90, 0, 0]).scale([1, 1, 1.6]).translate([0.33, 0, 0])]).intersect(UNIT()),
  // ---- prisms and polyhedra
  pyramid: () => taperZ([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], -0.5, 0.5, 0.02),
  trapezoid: () => taperZ([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], -0.5, 0.5, 0.65),            // frustum of a box
  triangle: () => ngon(3).scale([1.15, 1.15, 1]).translate([0, -0.1, 0]).intersect(UNIT()),
  pent_prism: () => ngon(5),
  hex_prism: () => ngon(6),
  oct_prism: () => ngon(8),
  gem: () => hull([taperZ(ring(8, 0.5, 22.5), 0.08, 0.16, 1), taperZ(ring(8, 0.3, 22.5), 0.46, 0.5, 1), box(-0.01, 0.01, -0.01, 0.01, -0.5, -0.48)]),
  crystal: () => hull([taperZ(ring(6, 0.5), -0.22, 0.22, 1), box(-0.01, 0.01, -0.01, 0.01, 0.48, 0.5), box(-0.01, 0.01, -0.01, 0.01, -0.5, -0.48)]),
  chamfer_box: () => hull([box(-0.5, 0.5, -0.38, 0.38, -0.38, 0.38), box(-0.38, 0.38, -0.5, 0.5, -0.38, 0.38), box(-0.38, 0.38, -0.38, 0.38, -0.5, 0.5)]),
  soft_cube: () => hull([-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => ellipsoid([x * 0.32, y * 0.32, z * 0.32], [0.18, 0.18, 0.18], 20))))),
  house: () => union([box(-0.5, 0.5, -0.5, 0.5, -0.5, 0.05), hull([box(-0.5, 0.5, -0.5, 0.5, 0.05, 0.06), box(-0.02, 0.02, -0.5, 0.5, 0.49, 0.5)])]),
  lantern: () => union([ngon(6).scale([0.86, 0.86, 0.7]), taperZ(ring(6, 0.5), 0.35, 0.5, 0.4), taperZ(ring(6, 0.5), -0.5, -0.35, 1)]),
  // ---- screens and characters (desk robots)
  crt: () => hull([box(-0.5, 0.5, 0.05, 0.5, -0.5, 0.5), box(-0.3, 0.3, -0.5, -0.42, -0.3, 0.32)]),           // old TV: flat front, tapered back
  monitor: () => union([box(-0.5, 0.5, -0.12, 0.12, -0.12, 0.5), box(-0.08, 0.08, -0.08, 0.08, -0.42, -0.1), box(-0.32, 0.32, -0.3, 0.3, -0.5, -0.42)]),
  cat_head: () => union([ellipsoid([0, 0, -0.12], [0.5, 0.42, 0.38], S),
    ...[-1, 1].map(k => hull([ellipsoid([k * 0.28, 0, 0.12], [0.14, 0.08, 0.06], 16), box(k * 0.36 - 0.01, k * 0.36 + 0.01, -0.01, 0.01, 0.48, 0.5)]))]),
  bear_head: () => union([ellipsoid([0, 0, -0.1], [0.46, 0.42, 0.4], S), ...[-1, 1].map(k => ellipsoid([k * 0.33, 0, 0.3], [0.15, 0.1, 0.15], 20))]),
  bunny_head: () => union([ellipsoid([0, 0, -0.25], [0.46, 0.42, 0.25], S), ...[-1, 1].map(k => ellipsoid([k * 0.17, 0, 0.2], [0.1, 0.07, 0.3], 20))]),
  ghost: () => sub(union([sub(ellipsoid([0, 0, 0], [0.5, 0.5, 0.5], S), box(-1, 1, -1, 1, -2, 0)), box(-0.5, 0.5, -0.5, 0.5, -0.5, 0)]).intersect(cylZ(0, 0, 0.5, -1, 1, S)),
    ...[-0.33, 0, 0.33].map(x => cylY(x, -0.5, 0.11, -1, 1, 20))),
  // puffs round in depth too (a cloud seen from the side is still puffy), the middle one the deepest
  cloud: () => union([[0, 0, -0.05, 0.32], [-0.28, 0, -0.15, 0.22], [0.28, 0, -0.15, 0.22], [-0.12, 0, 0.18, 0.24], [0.16, 0, 0.14, 0.22]]
    .map(([x, y, z, r]) => ellipsoid([x, y, z], [r, Math.min(0.5, r * 1.55), r], 24))),
  blob: () => hull([ellipsoid([-0.15, -0.05, -0.15], [0.34, 0.36, 0.32], 24), ellipsoid([0.18, 0.06, -0.1], [0.3, 0.32, 0.3], 24), ellipsoid([0, 0.05, 0.2], [0.28, 0.3, 0.28], 24)]).intersect(UNIT()),
  bean: () => hull([ellipsoid([-0.32, -0.1, 0], [0.18, 0.2, 0.5], 20), ellipsoid([0, 0.12, 0], [0.2, 0.22, 0.5], 20), ellipsoid([0.32, -0.1, 0], [0.18, 0.2, 0.5], 20)]).intersect(UNIT()),
  beak: () => hull([ellipsoid([0, -0.45, -0.05], [0.5, 0.05, 0.45], 24), box(-0.03, 0.03, 0.48, 0.5, -0.2, -0.15)]),     // points front
  horn: () => hull([ellipsoid([0, 0, -0.38], [0.32, 0.32, 0.12], 24), ellipsoid([0.12, 0, 0.1], [0.16, 0.16, 0.1], 16), box(0.3, 0.33, -0.02, 0.02, 0.47, 0.5)]),
  // ---- flat profiles (through the thinnest size)
  star: () => flat(Array.from({ length: 10 }, (_, k) => { const a = (90 + 36 * k) * Math.PI / 180, r = k % 2 ? 0.2 : 0.5; return [r * Math.cos(a), r * Math.sin(a) - 0.05] as [number, number]; })),
  heart: () => flat(Array.from({ length: 48 }, (_, k) => { const t = (2 * Math.PI * k) / 48; return [16 * Math.sin(t) ** 3 / 34, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 34 + 0.07] as [number, number]; })),
  crescent: () => sub(cylZ(0, 0, 0.5, -0.5, 0.5, S), cylZ(0.24, 0.06, 0.42, -1, 1, S)),
  cross: () => union([box(-0.17, 0.17, -0.5, 0.5, -0.5, 0.5), box(-0.5, 0.5, -0.17, 0.17, -0.5, 0.5)]),
  leaf: () => cylZ(-0.3, 0, 0.8, -0.5, 0.5, 64).intersect(cylZ(0.3, 0, 0.8, -0.5, 0.5, 64)).scale([1, 0.5 / 0.742, 1]),
  shield: () => flat([[-0.5, 0.5], [0.5, 0.5], [0.5, 0.05], [0.36, -0.22], [0, -0.5], [-0.36, -0.22], [-0.5, 0.05]]),
  wing: () => flat([[-0.5, -0.1], [-0.2, 0.3], [0.5, 0.5], [0.42, 0.1], [0.2, -0.2], [-0.1, -0.5]]),
  stadium: () => hull([cylZ(-0.25, 0, 0.25, -0.5, 0.5, 32).scale([1, 2, 1]), cylZ(0.25, 0, 0.25, -0.5, 0.5, 32).scale([1, 2, 1])]).intersect(UNIT()),
  semicircle: () => cylZ(0, 0, 0.5, -0.5, 0.5, S).scale([1, 2, 1]).translate([0, -0.5, 0]).intersect(UNIT()),
  petal: () => hull([cylZ(0, -0.18, 0.32, -0.5, 0.5, 32), box(-0.01, 0.01, 0.48, 0.5, -0.5, 0.5)]),
  bubble: () => union([hull([-1, 1].flatMap(x => [-1, 1].map(y => cylZ(x * 0.38, 0.08 + y * 0.28, 0.12, -0.5, 0.5, 20)))),
    hull([box(-0.3, -0.12, -0.25, -0.2, -0.5, 0.5), box(-0.42, -0.4, -0.5, -0.48, -0.5, 0.5)])]),
};
const unitCache = new Map<ShapeKind, M>();
onFreeAll(() => unitCache.clear());

/** Profile shapes are extruded through the thinnest size; the rest keep z up. */
const FLAT = new Set<ShapeKind>(['star', 'heart', 'crescent', 'cross', 'leaf', 'shield', 'wing', 'stadium', 'semicircle', 'petal', 'bubble']);

/** A shape centred at c with world-axis size s (w along x, d along y, h along z). */
export function shapeSolid(kind: ShapeKind, c: Vec3, s: Vec3): M {
  const [w, d, h] = s;
  const r: Vec3 = [w / 2, d / 2, h / 2];
  const long = s.indexOf(Math.max(...s)), thin = s.indexOf(Math.min(...s));
  /** Unit cylinder along axis i, scaled to the size. */
  const cylAlong = (i: number, taper = 1) => {
    const z = coneZ(0, 0, 0.5, 0.5 * taper, -0.5, 0.5, 48);
    const oriented = i === 2 ? z : i === 1 ? z.rotate([-90, 0, 0]) : z.rotate([0, 90, 0]);
    return oriented.scale(s).translate(c);
  };
  const lib = UNIT_SHAPES[kind];
  if (lib) {
    // every library shape is stretched to fill the unit cube exactly, so it fills the size it is given
    // (built once per build: the cache is dropped when the build frees its manifolds)
    let m = unitCache.get(kind);
    if (!m) {
      const m0 = lib(s), q = m0.boundingBox();
      const ext = [0, 1, 2].map(i => Math.max(1e-6, q.max[i] - q.min[i])) as Vec3;
      m = m0.translate([0, 1, 2].map(i => -(q.min[i] + q.max[i]) / 2) as Vec3).scale(ext.map(e => 1 / e) as Vec3);
      unitCache.set(kind, m);
    }
    // a profile is drawn x by y, then turned so it faces through the thinnest size: scale in the turned frame
    if (FLAT.has(kind)) {
      const t = s.indexOf(Math.min(...s));
      const [p, q] = [0, 1, 2].filter(i => i !== t);
      const local: Vec3 = [s[p], s[q], s[t]];
      return throughThin(m.scale(local), s).translate(c);
    }
    return m.scale(s).translate(c);
  }
  switch (kind) {
    case 'box': return aabb(c, r);
    case 'rounded_box': return rrect(w, d, Math.max(0.5, Math.min(6, w / 4, d / 4)), c[0], c[1], c[2] - h / 2, c[2] + h / 2);
    case 'cylinder': return cylAlong(2);
    case 'disc': return cylAlong(thin);
    case 'cone': return cylAlong(2, 0.15);
    case 'sphere': return ellipsoid(c, r, 40);
    case 'egg': {
      // fat end toward -axis, narrower nose toward +axis. The axis is y when the egg is longest front-to-back (a fish,
      // a bird in flight), otherwise vertical (owl, penguin, pear: fat end down); never sideways (it would bulge left)
      const ax = s[1] >= s[0] && s[1] >= s[2] ? 1 : 2;
      const a = unit(ax), L = s[ax];
      const r1 = r.map((v, i) => (i === ax ? L * 0.34 : v)) as Vec3;
      const r2 = r.map((v, i) => (i === ax ? L * 0.28 : v * 0.62)) as Vec3;
      return hull([ellipsoid(plus(c, times(a, -L * 0.16)), r1, 36), ellipsoid(plus(c, times(a, L * 0.22)), r2, 36)]);
    }
    case 'capsule': {
      const a = unit(long), rs = Math.min(...r.filter((_, i) => i !== long));
      const end = Math.max(0, r[long] - rs);
      const rr = r.map((v, i) => (i === long ? rs : v)) as Vec3;
      return hull([ellipsoid(plus(c, times(a, -end)), rr, 32), ellipsoid(plus(c, times(a, end)), rr, 32)]);
    }
    case 'wedge':
      return hull([box(c[0] - r[0], c[0] + r[0], c[1] - r[1], c[1] - r[1] + 1, c[2] - r[2], c[2] + r[2]),
        box(c[0] - r[0], c[0] + r[0], c[1] + r[1] - 1, c[1] + r[1], c[2] - r[2], c[2] - r[2] + h * 0.25)]);
    case 'prism':
      // A-frame: triangular prism along y, full width on the bottom, a 4 mm ridge on top
      return hull([box(c[0] - r[0], c[0] + r[0], c[1] - r[1], c[1] + r[1], c[2] - r[2], c[2] - r[2] + 0.5),
        box(c[0] - 2, c[0] + 2, c[1] - r[1], c[1] + r[1], c[2] + r[2] - 0.5, c[2] + r[2])]);
    case 'fin': {
      // thin diamond in the plane of the two larger dimensions (fish tails, ears, wings, flags)
      const t = r[thin], [p, q] = [0, 1, 2].filter(i => i !== thin);
      const pt = (dp: number, dq: number) => {
        const o: Vec3 = [...c];
        o[p] += dp; o[q] += dq;
        return aabb(o, unit(thin, t).map((v, i) => (i === thin ? v : 0.5)) as Vec3);
      };
      return hull([pt(-r[p] + 0.5, 0), pt(r[p] - 0.5, 0), pt(0, -r[q] + 0.5), pt(0, r[q] - 0.5)]);
    }
  }
  return aabb(c, r);
}

/**
 * The shape inset by t on every side: the intersection of copies shifted by t along the 6 axes and the 8 diagonals.
 * An even wall on any shape (convex or not), so every shape can be printed as a shell that covers the electronics.
 */
export function erode(m: M, t: number, axesOnly = false): M {
  // axesOnly: the 6 axis shifts only (a thin skin, where ~0.4 t thinner on 45° faces doesn't matter): 2× faster
  const k = t / Math.sqrt(3);
  const dirs: Vec3[] = [[t, 0, 0], [-t, 0, 0], [0, t, 0], [0, -t, 0], [0, 0, t], [0, 0, -t],
    ...(axesOnly ? [] : [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x * k, y * k, z * k] as Vec3))))];
  return dirs.reduce((acc, dv) => acc.intersect(m.translate(dv)), m);
}
