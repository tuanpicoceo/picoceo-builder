// Thin helpers over manifold-3d plus the Build context every generator writes into.
// Manifold objects live in WASM memory: every Manifold/CrossSection created during a build is
// tracked and freed at the end, so repeated rebuilds do not leak.

import Module from 'manifold-3d';
import type { Manifold as TManifold, CrossSection as TCross, ManifoldToplevel } from 'manifold-3d/manifold.d.ts';
import { CATALOG } from '../catalog/components';
import type { Material, ProfileKey } from '../catalog/rules';
import { printedGrams } from './mass';
import { REMOVABLE, insertionCheck, wiringCheck, type CablePort, type FitComp, type FitPart } from './fitcheck';
import type { Assembly, AssemblyMeta, BuiltComponent, BuiltPart, Collider, Fastener, GeoCheck, JointDef, LinkDef, MeshData, Vec3 } from './types';

export type M = TManifold;
export type CS = TCross;

let W: ManifoldToplevel;
const live: { delete(): void }[] = [];
export const SEG = 48;

export async function initKernel(locateFile?: () => string) {
  if (W) return;
  W = await Module(locateFile ? { locateFile } : undefined);
  W.setup();
  track(W.Manifold);
  track(W.CrossSection);
}

function track(cls: any) {
  const wrap = (obj: any, name: string) => {
    const f = obj[name];
    if (typeof f !== 'function' || name === 'delete' || name === 'constructor') return;
    obj[name] = function (this: any, ...args: any[]) {
      const r = f.apply(this, args);
      if (r && typeof r === 'object' && typeof r.delete === 'function') live.push(r);
      else if (Array.isArray(r)) r.forEach(x => x && typeof x.delete === 'function' && live.push(x));
      return r;
    };
  };
  // instance methods live on the embind base classes up the prototype chain (manifold-3d's JS classes add none of their own)
  const seen = new Set<string>();
  for (let p = cls.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p))
    for (const n of Object.getOwnPropertyNames(p)) {
      if (seen.has(n)) continue;
      seen.add(n);
      const d = Object.getOwnPropertyDescriptor(p, n);
      if (d && typeof d.value === 'function') wrap(p, n);
    }
  for (const n of Object.getOwnPropertyNames(cls)) if (!['prototype', 'length', 'name'].includes(n)) wrap(cls, n);
}

/** Track an object made with `new` (constructors are not wrapped). */
const keep = <T extends { delete(): void }>(o: T): T => { live.push(o); return o; };

const freeHooks: (() => void)[] = [];
/** Run after every freeAll (caches of manifolds must drop what was just freed). */
export const onFreeAll = (f: () => void) => { freeHooks.push(f); };

/** Size of the WASM heap in MB (tests watch it for leaks). */
export const wasmHeapMB = () => ((W as unknown as { HEAPU8?: Uint8Array }).HEAPU8?.length ?? 0) / 2 ** 20;

export function freeAll() {
  while (live.length) {
    const o = live.pop()!;
    try { o.delete(); } catch { /* already freed */ }
  }
  for (const f of freeHooks) f();
}

// ---------------------------------------------------------------- primitives
export const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): M =>
  W.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);

export const cboxXY = (cx: number, cy: number, w: number, d: number, z0: number, z1: number) =>
  box(cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, z0, z1);

export const cylZ = (x: number, y: number, r: number, z0: number, z1: number, seg = SEG): M =>
  W.Manifold.cylinder(z1 - z0, r, r, seg).translate([x, y, z0]);

export const cylX = (y: number, z: number, r: number, x0: number, x1: number, seg = SEG): M =>
  W.Manifold.cylinder(x1 - x0, r, r, seg).rotate([0, 90, 0]).translate([x0, y, z]);

export const cylY = (x: number, z: number, r: number, y0: number, y1: number, seg = SEG): M =>
  W.Manifold.cylinder(y1 - y0, r, r, seg).rotate([-90, 0, 0]).translate([x, y0, z]);

export const sphere = (c: Vec3, r: number, seg = SEG): M => W.Manifold.sphere(r, seg).translate(c);

export const union = (ms: (M | null | undefined | false)[]): M => {
  const list = ms.filter(Boolean) as M[];
  return list.length === 1 ? list[0] : W.Manifold.union(list);
};

export const sub = (a: M, ...cuts: (M | null | undefined | false)[]): M => {
  const list = cuts.filter(Boolean) as M[];
  return list.length ? a.subtract(union(list)) : a;
};

/** Rounded rectangle extruded in Z. */
export function rrect(w: number, d: number, r: number, cx: number, cy: number, z0: number, z1: number): M {
  const rr = Math.max(0.01, Math.min(r, w / 2 - 0.01, d / 2 - 0.01));
  const pts: CS[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1])
    pts.push(W.CrossSection.circle(rr, SEG).translate([cx + sx * (w / 2 - rr), cy + sy * (d / 2 - rr)]));
  return W.CrossSection.hull(pts).extrude(z1 - z0).translate([0, 0, z0]);
}

/** Polygon (XY) extruded along Z. */
export const prismXY = (pts: [number, number][], z0: number, z1: number): M =>
  keep(new W.CrossSection([pts])).extrude(z1 - z0).translate([0, 0, z0]);

/** Polygon in the YZ plane (pts are [y, z]) extruded along X. */
export const prismYZ = (pts: [number, number][], x0: number, x1: number): M =>
  keep(new W.CrossSection([pts])).extrude(x1 - x0).rotate([90, 0, 90]).translate([x0, 0, 0]);

/** DIN 934 hex nut pocket (across flats `af`) along Z. */
export const hexZ = (x: number, y: number, af: number, z0: number, z1: number): M =>
  W.Manifold.cylinder(z1 - z0, af / Math.sqrt(3), af / Math.sqrt(3), 6).translate([x, y, z0]);

export const hull = (ms: M[]): M => W.Manifold.hull(ms);

/** A profile of [radius, z] points revolved about the z axis (a bell, a vase, a pear). */
export const revolveZ = (profile: [number, number][], seg = SEG): M => keep(new W.CrossSection([profile])).revolve(seg);

/** Polygon (XY, centred on the origin) extruded along Z, its top scaled by `scaleTop` (0 = a point: pyramids). */
export const taperZ = (pts: [number, number][], z0: number, z1: number, scaleTop: number): M =>
  keep(new W.CrossSection([pts])).extrude(z1 - z0, 0, 0, [scaleTop, scaleTop]).translate([0, 0, z0]);

/** Ellipsoid with semi-axes r centred at c. */
export const ellipsoid = (c: Vec3, r: Vec3, seg = SEG): M => W.Manifold.sphere(1, seg).scale(r).translate(c);

/** Truncated cone along Z, base radius r0 at z0, top radius r1 at z1. */
export const coneZ = (x: number, y: number, r0: number, r1: number, z0: number, z1: number, seg = SEG): M =>
  W.Manifold.cylinder(z1 - z0, r0, Math.max(0.01, r1), seg).translate([x, y, z0]);

/** Rigid transform: world = t + R·p, with R given as its three columns (local x, y, z axes in world). */
export function xform(m: M, R: [Vec3, Vec3, Vec3], t: Vec3): M {
  const [a, b, c] = R;
  return m.transform([a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, c[0], c[1], c[2], 0, t[0], t[1], t[2], 1]);
}

/** Rotate about a principal axis through `o`. */
export function rotAbout(m: M, axis: Vec3, o: Vec3, deg: number): M {
  return m.translate([-o[0], -o[1], -o[2]]).rotate([axis[0] * deg, axis[1] * deg, axis[2] * deg]).translate(o);
}

// ---------------------------------------------------------------- build context
interface PartIn {
  id: string; name: string; link: string; material: Material; profile: ProfileKey; color: string;
  solid: M; printRot: Vec3; printNote: string;
  /** comes off to put the electronics in (else decided from its name: cover, retainer, sled, lid ...) */
  removable?: boolean;
  /** goes on after the base's electronics (a body on its neck): walls in only these components (keys) fitted into it */
  liftOff?: string[];
}
interface CompIn { key: string; catalogId: string; label: string; link: string; solid: M; color?: string }
interface LinkIn { id: string; name: string; parent: string | null; joint?: JointDef; colliders: Collider[] }

export class Build {
  parts: PartIn[] = [];
  comps: CompIn[] = [];
  links: LinkIn[] = [];
  checks: GeoCheck[] = [];
  fasteners = new Map<string, { qty: number; uses: string[] }>();
  extras: { item: string; qty: number }[] = [];
  steps: string[] = [];
  meta: AssemblyMeta = {};

  part(p: PartIn) { this.parts.push(p); }
  comp(c: CompIn) { this.comps.push(c); }
  link(l: LinkIn) { this.links.push(l); }
  check(c: GeoCheck) { this.checks.push(c); }
  screw(size: string, qty: number, use: string) {
    const f = this.fasteners.get(size) ?? { qty: 0, uses: [] };
    f.qty += qty; f.uses.push(`${use} ×${qty}`);
    this.fasteners.set(size, f);
  }
  extra(item: string, qty: number) { this.extras.push({ item, qty }); }
  step(s: string) { this.steps.push(s); }
  /** A cable may cross a joint here: a service loop from point `a` (in the parent) to `b` (in the moving member). */
  cablePorts: CablePort[] = [];
  /** fail (not warn) when a part has no way in or no cable path: set by builders that lay the electronics out themselves */
  strictFit = false;
  cablePort(a: Vec3, b: Vec3, label: string, r?: number) { this.cablePorts.push({ a, b, label, r }); }
  /** Open space a cable may run through outside every part's hull (taped along the deck under a body). */
  cableways: M[] = [];
  cableway(m: M) { this.cableways.push(m); }
  /** Intentional contact between two bodies (by name), e.g. a pinion meshing with its rack. */
  private contacts: [string, string][] = [];
  allowContact(a: string, b: string) { this.contacts.push([a, b]); }
  private allowed(a: string, b: string) { return this.contacts.some(([x, y]) => (x === a && y === b) || (x === b && y === a)); }

  finish(t0: number): Assembly {
    const parts: BuiltPart[] = this.parts.map(p => {
      const st = p.solid.status();
      const vol = p.solid.volume();
      const printed = toPrint(p.solid, p.printRot);
      return {
        id: p.id, name: p.name, link: p.link, material: p.material, profile: p.profile, color: p.color,
        mesh: meshOf(p.solid), printMesh: meshOf(printed), printNote: p.printNote,
        volume: vol, area: p.solid.surfaceArea(),
        watertight: st === 'NoError' && !p.solid.isEmpty(),
        bbox: bb(p.solid), printBBox: bb(printed),
      };
    });
    const comps: BuiltComponent[] = this.comps.map(c => {
      const b = bb(c.solid);
      return {
        key: c.key, catalogId: c.catalogId, label: c.label, link: c.link, mesh: meshOf(c.solid),
        color: c.color ?? '#2a2d34',
        center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
      };
    });

    this.interferenceCheck();
    this.attachmentCheck();
    // every electronic part has a way in and a cable path to the controller (src/cad/fitcheck.ts)
    const fit: FitPart[] = this.parts.map((p, i) => ({ name: p.name, link: p.link, mesh: parts[i].mesh, hull: meshOf(W.Manifold.hull([p.solid])), bbox: parts[i].bbox,
      removable: p.removable ?? REMOVABLE.test(p.name), liftOff: p.liftOff }));
    const fitComps: FitComp[] = this.comps.map((c, i) => ({ key: c.key, label: c.label, link: c.link, catalogId: c.catalogId, mesh: comps[i].mesh, bbox: bb(c.solid) }));
    this.checks.push(insertionCheck(fit, fitComps, this.strictFit));
    const wiring = wiringCheck(fit, fitComps, this.cablePorts, this.strictFit, this.cableways.map(meshOf));
    if (wiring) this.checks.push(wiring);
    this.motionSweep();

    const links: LinkDef[] = this.links.map(l => {
      let m = 0; const c: Vec3 = [0, 0, 0];
      const addMass = (g: number, at: Vec3) => { m += g; for (let i = 0; i < 3; i++) c[i] += g * at[i]; };
      parts.filter(p => p.link === l.id).forEach(p => {
        const src = this.parts.find(x => x.id === p.id)!;
        addMass(printedGrams(p.volume, p.area, p.profile, p.material), centroid(src.solid));
      });
      comps.filter(k => k.link === l.id).forEach(k => addMass(CATALOG[k.catalogId]?.massG ?? 1, k.center));
      return { ...l, massG: m, com: m > 0 ? [c[0] / m, c[1] / m, c[2] / m] as Vec3 : [0, 0, 0] as Vec3 };
    });

    const all = [...parts.map(p => p.bbox), ...comps.map(k => bbMesh(k.mesh))];
    const mn = [0, 1, 2].map(i => Math.min(...all.map(b => b.min[i])));
    const mx = [0, 1, 2].map(i => Math.max(...all.map(b => b.max[i])));

    const fasteners: Fastener[] = [...this.fasteners.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([size, f]) => ({ size, qty: f.qty, use: f.uses.join(', ') }));

    const watertight = parts.filter(p => !p.watertight);
    this.checks.unshift({
      id: 'watertight', label: 'Watertight meshes',
      status: watertight.length ? 'fail' : 'pass',
      detail: watertight.length ? `Not manifold: ${watertight.map(p => p.name).join(', ')}` : `All ${parts.length} parts are closed 2-manifold solids.`,
    });

    return {
      meta: this.meta, parts, components: comps, links, checks: this.checks, fasteners, extras: this.extras,
      assemblySteps: this.steps,
      dims: { w: mx[0] - mn[0], d: mx[1] - mn[1], h: mx[2] - mn[2] },
      buildMs: performance.now() - t0,
    };
  }

  private interferenceCheck() {
    const items = [
      ...this.parts.map(p => ({ name: p.name, solid: p.solid, link: p.link })),
      ...this.comps.map(c => ({ name: c.label, solid: c.solid, link: c.link })),
    ];
    const boxes = items.map(i => bb(i.solid));
    const hits: string[] = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        if (this.allowed(items[i].name, items[j].name) || !overlap(boxes[i], boxes[j])) continue;
        const v = items[i].solid.intersect(items[j].solid).volume();
        if (v > 1.0) hits.push(`${items[i].name} ↔ ${items[j].name} (${v.toFixed(1)} mm³)`);
      }
    this.checks.push({
      id: 'interference', label: 'Static interference (parts, servos, PCBs, battery)',
      status: hits.length ? 'fail' : 'pass',
      detail: hits.length ? hits.slice(0, 6).join('; ') : `${items.length} bodies, no overlaps above 1 mm³.`,
    });
  }

  /**
   * Everything must hold together: every piece of every printed part and every component must be connected to the
   * rest of the robot through contact (gap ≤ 0.8 mm covers push / slide / press fits). A part may be several pieces
   * (glue-on accents) as long as each piece touches something. Joints stay connected because each driven part
   * touches its horn and each horn sits on its servo spline.
   */
  private attachmentCheck() {
    const TOUCH = 0.8;
    const items = [
      ...this.parts.flatMap(p => {
        const pieces = p.solid.decompose();
        return pieces.map((solid, k) => ({ name: pieces.length > 1 ? `${p.name} (piece ${k + 1}/${pieces.length})` : p.name, solid, part: true }));
      }),
      ...this.comps.map(c => ({ name: c.label, solid: c.solid, part: false })),
    ];

    const boxes = items.map(i => bb(i.solid));
    const near = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }) =>
      [0, 1, 2].every(k => a.min[k] - TOUCH < b.max[k] && b.min[k] - TOUCH < a.max[k]);
    const root = items.map((_, i) => i);
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        if (find(i) === find(j) || !near(boxes[i], boxes[j])) continue;
        // minGap caps its answer at the search length, so search a hair further: a gap of exactly TOUCH still counts
        // (and a 0.8 mm fit gap comes back a few µm over 0.8)
        if (items[i].solid.minGap(items[j].solid, TOUCH + 0.05) <= TOUCH + 0.01) root[find(i)] = find(j);
      }
    // the main assembly is the group holding the first printed part (the base / chassis)
    const main = find(0);
    const loose = items.filter((_, i) => find(i) !== main);
    const looseParts = loose.filter(i => i.part), looseComps = loose.filter(i => !i.part);
    const problems = [
      ...looseParts.map(p => `${p.name} is not attached to the robot`),
      ...looseComps.map(c => `${c.name} is not seated against any part`),
    ];
    this.checks.push({
      id: 'attached', label: 'All parts attached',
      status: looseParts.length ? 'fail' : looseComps.length ? 'warn' : 'pass',
      detail: problems.length ? problems.slice(0, 6).join('; ') + (problems.length > 6 ? ` (+${problems.length - 6} more)` : '')
        : `${items.length} bodies and part pieces form one connected assembly.`,
    });
  }

  /**
   * Movement check: every joint moves freely over the range it was given (the moving subtree against everything
   * else, sampled every ≤ 6° / 3 mm and refined to ~1° at the first contact), within its servo's travel, and a
   * continuous joint (wheel, spin servo) all the way round. A swing that hits something part way is narrowed to the
   * range that is free (2° short of the contact), so the simulator, the behaviours and the firmware never drive it
   * into the obstacle; it fails when less than 60 % of the intent (or under 20° / 10 mm) is left, or when a continuous
   * joint is blocked (free-form layouts; the archetype builders warn).
   */
  private motionSweep() {
    const jointLinks = this.links.filter(l => l.joint);
    if (!jointLinks.length) return;
    const children = (id: string): string[] => {
      const out = [id];
      for (let pass = 0; pass < this.links.length; pass++)
        for (const l of this.links) if (l.parent && out.includes(l.parent) && !out.includes(l.id)) out.push(l.id);
      return out;
    };
    const lines: string[] = [];
    let worst: 'pass' | 'warn' | 'fail' = 'pass';
    const bump = (s: 'warn' | 'fail') => { if (s === 'fail' || worst === 'pass') worst = s; };
    for (const l of jointLinks) {
      const j = l.joint!;
      const prism = j.type === 'prismatic';
      const unit = prism ? 'mm' : '°';
      const sub = children(l.id);
      const movingItems = [
        ...this.parts.filter(p => sub.includes(p.link)).map(p => ({ name: p.name, solid: p.solid })),
        ...this.comps.filter(c => sub.includes(c.link)).map(c => ({ name: c.label, solid: c.solid })),
      ];
      if (!movingItems.length) continue;
      const fixed = [
        ...this.parts.filter(p => !sub.includes(p.link)).map(p => ({ name: p.name, solid: p.solid })),
        ...this.comps.filter(c => !sub.includes(c.link)).map(c => ({ name: c.label, solid: c.solid })),
      ].filter(f => !movingItems.some(m => this.allowed(m.name, f.name)));
      const moving = union(movingItems.map(m => m.solid));
      const pose = (a: number) => (prism ? moving.translate([j.axis[0] * a, j.axis[1] * a, j.axis[2] * a]) : rotAbout(moving, j.axis, j.origin, a));
      const hitAt = (a: number): string | null => {
        const r = pose(a), rb = bb(r);
        for (const f of fixed) if (overlap(rb, bb(f.solid)) && r.intersect(f.solid).volume() > 2.0) {
          // name the moving piece too
          const mv = movingItems.find(m => (prism ? m.solid.translate([j.axis[0] * a, j.axis[1] * a, j.axis[2] * a]) : rotAbout(m.solid, j.axis, j.origin, a)).intersect(f.solid).volume() > 0.5);
          return mv ? `${mv.name} ↔ ${f.name}` : f.name;
        }
        return null;
      };
      const name = l.name;
      if (!j.limit) {
        // continuous: all the way round
        const hit = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(a => ({ a, h: hitAt(a) })).find(x => x.h);
        if (hit) { bump(this.strictFit ? 'fail' : 'warn'); lines.push(`${name} (continuous) hits ${hit.h} at ${hit.a}°: it can't turn all the way round`); }
        else lines.push(`${name}: turns freely all the way round`);
        continue;
      }
      // the servo's travel (a 180° servo turns ±90° from centre; through a pinion that is ± r·π/2 mm)
      const range = (CATALOG[j.actuator.catalogId]?.data as { rangeDeg?: number } | undefined)?.rangeDeg;
      const half = j.actuator.kind === 'servo' && range ? (prism ? (j.pinionR ?? 0) * (range / 2) * Math.PI / 180 : range / 2) : Infinity;
      let [lo, hi] = j.limit;
      const notes: string[] = [];
      if (lo < -half - 0.01 || hi > half + 0.01) {
        notes.push(`limited to the servo's travel ±${half.toFixed(0)}${unit} (asked ${lo.toFixed(0)}..${hi.toFixed(0)}${unit})`);
        lo = Math.max(lo, -half); hi = Math.min(hi, half);
        bump('warn');
      }
      const asked = hi - lo;
      // walk out from the zero pose each way; at the first contact, bisect to the free edge
      const step = prism ? 3 : 6, margin = prism ? 1 : 2;
      const freeTo = (end: number): { at: number; by: string | null } => {
        const s = Math.sign(end);
        if (!s) return { at: 0, by: null };
        let prev = 0;
        for (let a = step; ; a += step) {
          const x = s * Math.min(a, Math.abs(end));
          const h = hitAt(x);
          if (h) {
            let ok = prev, bad = x;
            for (let k = 0; k < 4; k++) { const m = (ok + bad) / 2; if (hitAt(m)) bad = m; else ok = m; }
            return { at: ok, by: h };
          }
          prev = x;
          if (Math.abs(x) >= Math.abs(end)) return { at: end, by: null };
        }
      };
      const up = freeTo(hi), down = freeTo(lo);
      if (!up.by && !down.by) {
        lines.push(`${name}: moves freely over ${lo.toFixed(0)}..${hi.toFixed(0)}${unit}${notes.length ? ` (${notes.join('; ')})` : ''}`);
        j.limit = [lo, hi];
        continue;
      }
      const nlo = down.by ? Math.min(0, down.at + margin * Math.sign(-lo)) : lo;
      const nhi = up.by ? Math.max(0, up.at - margin * Math.sign(hi)) : hi;
      const kept = nhi - nlo;
      const enough = kept >= 0.6 * asked && kept >= (prism ? 10 : 20);
      bump(enough || !this.strictFit ? 'warn' : 'fail');
      j.limit = [nlo, nhi];
      const why = [up.by && `${up.by} at ${up.at.toFixed(0)}${unit}`, down.by && `${down.by} at ${down.at.toFixed(0)}${unit}`].filter(Boolean).join(', ');
      lines.push(`${name}: hits ${why}; limited to ${nlo.toFixed(0)}..${nhi.toFixed(0)}${unit} of the intended ${lo.toFixed(0)}..${hi.toFixed(0)}${unit}${enough ? '' : ' (too little of it is left: move the part or the joint, or make the member smaller)'}${notes.length ? `; ${notes.join('; ')}` : ''}`);
    }
    this.checks.push({
      id: 'sweep', label: 'Movement: every joint moves freely within its range',
      status: worst,
      detail: worst === 'pass'
        ? `All ${jointLinks.length} joints move freely over their whole intended range, within servo travel: ${lines.join('; ')}.`
        : lines.filter(s => /hits|limited|can't/.test(s)).join('; ') + '.',
    });
  }
}
// ---------------------------------------------------------------- mesh utils
export function meshOf(m: M): MeshData {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const n = vp.length / np;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = vp[i * np]; positions[i * 3 + 1] = vp[i * np + 1]; positions[i * 3 + 2] = vp[i * np + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

function toPrint(m: M, rot: Vec3): M {
  const r = m.rotate(rot);
  const b = r.boundingBox();
  return r.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
}

export function bb(m: M): { min: Vec3; max: Vec3 } {
  const b = m.boundingBox();
  return { min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]] };
}

function bbMesh(d: MeshData) {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < d.positions.length; i += 3)
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], d.positions[i + k]); max[k] = Math.max(max[k], d.positions[i + k]); }
  return { min, max };
}

const overlap = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }) =>
  a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1] && a.min[2] < b.max[2] && b.min[2] < a.max[2];

function centroid(m: M): Vec3 {
  // Volume-weighted centroid from the triangle mesh (signed tetrahedra).
  const { positions: p, indices: t } = meshOf(m);
  let V = 0; const c: Vec3 = [0, 0, 0];
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, d = t[i + 2] * 3;
    const v = (p[a] * (p[b + 1] * p[d + 2] - p[b + 2] * p[d + 1]) - p[a + 1] * (p[b] * p[d + 2] - p[b + 2] * p[d]) + p[a + 2] * (p[b] * p[d + 1] - p[b + 1] * p[d])) / 6;
    V += v;
    for (let k = 0; k < 3; k++) c[k] += v * (p[a + k] + p[b + k] + p[d + k]) / 4;
  }
  return V ? [c[0] / V, c[1] / V, c[2] / V] : [0, 0, 0];
}
