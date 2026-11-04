// Two assembly checks every build gets (Build.finish). They fail free-form (composer) layouts, which place every part
// themselves, and warn on the archetype builders.
//
//   Electronics can be fitted (id 'access')  every board, module, battery and switch has a way IN: with the parts that
//     come off taken away (covers, retainers, the core sled, straps, decks, ...), the part's own shape (voxelised at
//     ~1 mm) slides out along one axis, or backs out of its pocket and then slides out along another, without
//     crossing a printed part that stays on its link. A 2 mm grille hole is not "an opening": the part has to pass.
//
//   Wiring routes (id 'wiring')  every wired part can be reached from the controller: the free space inside the robot
//     (inside a printed part's hull or a declared cable run, `Build.cableway`, and not filled by a part or a
//     component) is voxelised at cable size (~2.5 mm) and flooded from the controller; each display, mic, speaker,
//     battery, servo board, servo and motor must touch the flood. Cables cross a joint only through declared cable
//     ports (`Build.cablePort`): a service loop from a port in the parent to a port in the moving member.

import { CATALOG } from '../catalog/components';
import type { MeshData, Vec3 } from './types';

type Box3 = { min: Vec3; max: Vec3 };
export interface FitPart { name: string; link: string; mesh: MeshData; hull: MeshData; bbox: Box3; removable: boolean; liftOff?: string[] }
export interface FitComp { key: string; label: string; link: string; catalogId: string; mesh: MeshData; bbox: Box3 }
/** A cable crossing a joint: a service loop from `a` (in the parent) to `b` (in the moving member); each end is the free space within `r` mm. */
export interface CablePort { a: Vec3; b: Vec3; label: string; r?: number }

/** Parts that come off to put the electronics in: an explicit flag, or a name that says so. */
export const REMOVABLE = /cover|retainer|strap|sled|\blid\b|cap\b|cowl|console|plunger|stand\b|tray|deck|member|wheel|tyre|tire|horn|accent|shell|bumper|skid|clamp|plate|thigh|shin|foot|neck|strut/i;
/** Components that need a wire (and, but for servos and motors in open housings, a way in). */
export const WIRED = new Set(['controller', 'shield', 'battery', 'switch', 'ledhub', 'led', 'speaker', 'sensor', 'display', 'camera', 'servo', 'cservo', 'motor']);
export const INSERTED = new Set(['controller', 'shield', 'battery', 'switch', 'ledhub', 'speaker', 'sensor', 'display', 'camera']);

// ---------------------------------------------------------------- voxels
interface Grid { o: Vec3; h: number; n: [number, number, number] }
const EPS = [0.0137, 0.0291];                           // column centres off the grid lines (no double crossings)

/** Mark the voxels whose centres lie inside a closed mesh (z-column crossings, inside between pairs). */
function rasterize(mesh: MeshData, g: Grid, out: Uint8Array) {
  const { o, h, n } = g, P = mesh.positions, I = mesh.indices;
  const cross = new Map<number, number[]>();
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[a], ay = P[a + 1], bx = P[b], by = P[b + 1], cx = P[c], cy = P[c + 1];
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - o[0] - EPS[0]) / h - 0.5)), i1 = Math.min(n[0] - 1, Math.floor((Math.max(ax, bx, cx) - o[0] - EPS[0]) / h - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - o[1] - EPS[1]) / h - 0.5)), j1 = Math.min(n[1] - 1, Math.floor((Math.max(ay, by, cy) - o[1] - EPS[1]) / h - 0.5));
    if (i0 > i1 || j0 > j1) continue;
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = o[0] + (i + 0.5) * h + EPS[0], y = o[1] + (j + 0.5) * h + EPS[1];
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const z = l1 * P[a + 2] + l2 * P[b + 2] + l3 * P[c + 2];
      const col = i + n[0] * j;
      const list = cross.get(col);
      if (list) list.push(z); else cross.set(col, [z]);
    }
  }
  const layer = n[0] * n[1];
  for (const [col, zs] of cross) {
    zs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < zs.length; k += 2) {
      const k0 = Math.max(0, Math.ceil((zs[k] - o[2]) / h - 0.5)), k1 = Math.min(n[2] - 1, Math.floor((zs[k + 1] - o[2]) / h - 0.5));
      for (let z = k0; z <= k1; z++) out[col + layer * z] = 1;
    }
  }
}

/** Voxels within `r` mm of a box, as indices. */
function around(b: Box3, r: number, g: Grid): number[] {
  const { o, h, n } = g, out: number[] = [];
  const lo = [0, 1, 2].map(k => Math.max(0, Math.floor((b.min[k] - r - o[k]) / h))), hi = [0, 1, 2].map(k => Math.min(n[k] - 1, Math.ceil((b.max[k] + r - o[k]) / h)));
  for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) out.push(x + n[0] * (y + n[1] * z));
  return out;
}
const pointBox = (p: Vec3): Box3 => ({ min: p, max: p });

export function wiringCheck(parts: FitPart[], comps: FitComp[], ports: CablePort[], strict: boolean, ways: MeshData[] = []) {
  const kind = (c: FitComp) => CATALOG[c.catalogId]?.kind ?? '';
  const wired = comps.filter(c => WIRED.has(kind(c)));
  const boards = wired.filter(c => kind(c) === 'controller');
  if (!boards.length || wired.length < 2) return null;
  // grid over everything, ~2.5 mm voxels (a cable bundle), never more than ~2.5 M voxels
  const lo: Vec3 = [1e9, 1e9, 1e9], hi: Vec3 = [-1e9, -1e9, -1e9];
  for (const q of [...parts.map(p => p.bbox), ...comps.map(c => c.bbox)]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q.min[k]); hi[k] = Math.max(hi[k], q.max[k]); }
  const ext = [0, 1, 2].map(k => hi[k] - lo[k] + 10);
  const h = Math.max(2.5, Math.cbrt((ext[0] * ext[1] * ext[2]) / 2.5e6));
  const g: Grid = { o: [lo[0] - 5, lo[1] - 5, lo[2] - 5], h, n: ext.map(v => Math.ceil(v / h) + 1) as [number, number, number] };
  const N = g.n[0] * g.n[1] * g.n[2];
  const inside = new Uint8Array(N), solid = new Uint8Array(N);
  for (const p of parts) { rasterize(p.hull, g, inside); rasterize(p.mesh, g, solid); }
  for (const w of ways) rasterize(w, g, inside);           // declared cable runs (on the deck under a body)
  for (const c of comps) rasterize(c.mesh, g, solid);
  const free = (i: number) => inside[i] === 1 && solid[i] === 0;
  // flood from the controller(s); a cable port joins the voxels round its two ends
  const seen = new Uint8Array(N), queue = new Int32Array(N);
  let qh = 0, qt = 0;
  const push = (i: number) => { if (!seen[i] && free(i)) { seen[i] = 1; queue[qt++] = i; } };
  for (const bd of boards) for (const i of around(bd.bbox, 1.6 * h, g)) push(i);
  const ends = ports.map(pt => ({ a: around(pointBox(pt.a), pt.r ?? 1.6 * h, g), b: around(pointBox(pt.b), pt.r ?? 1.6 * h, g), used: false }));
  const nx = g.n[0], nxy = g.n[0] * g.n[1];
  for (;;) {
    while (qh < qt) {
      const i = queue[qh++], x = i % nx, y = Math.floor(i / nx) % g.n[1], z = Math.floor(i / nxy);
      if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1);
      if (y > 0) push(i - nx); if (y < g.n[1] - 1) push(i + nx);
      if (z > 0) push(i - nxy); if (z < g.n[2] - 1) push(i + nxy);
    }
    let more = false;
    for (const e of ends) {
      if (e.used) continue;
      if (e.a.some(i => seen[i]) || e.b.some(i => seen[i])) { e.used = true; more = true; for (const i of [...e.a, ...e.b]) push(i); }
    }
    if (!more) break;
  }
  const cut = wired.filter(c => kind(c) !== 'controller' && !around(c.bbox, 1.6 * h, g).some(i => seen[i]));
  return {
    id: 'wiring', label: 'Wiring routes', status: cut.length ? (strict ? 'fail' as const : 'warn' as const) : 'pass' as const,
    detail: cut.length
      ? `No cable path (≥ ${h.toFixed(1)} mm free, inside the robot or through a joint's cable port) from the ${boards.map(b => b.label).join(' / ')} to: ${cut.map(c => c.label).slice(0, 6).join(', ')}${cut.length > 6 ? ` (+${cut.length - 6} more)` : ''}. ${strict ? 'Add a cable channel or a port.' : 'This layout has no internal channel there: clip those leads along the outside of the arm / leg with a service loop at each joint.'}`
      : `All ${wired.length - boards.length} wired parts reach the ${boards[0].label} through free space inside the robot (≥ ${h.toFixed(1)} mm, the size of a cable bundle)${ports.length ? ` and ${ports.length} joint cable port(s)` : ''}.`,
  };
}

// ---------------------------------------------------------------- insertion
const DIRS: [number, number][] = [[1, 1], [2, 1], [1, -1], [0, 1], [0, -1], [2, -1]];
const AX = ['x', 'y', 'z'];
const dirName = ([axis, s]: [number, number]) => `${s > 0 ? '+' : '-'}${AX[axis]}`;

/**
 * Slide a part (its own shape, voxelised at ~1 mm: round cells in a trough, a board on standoffs) from `shift` along
 * an axis by `dist` (Infinity: out past everything) and return the staying parts it would pass through.
 */
function sweep(c: FitComp, shift: Vec3, [axis, s]: [number, number], dist: number, blockers: FitPart[], far: Box3): string[] & { free?: number } {
  const lo = c.bbox.min.map((v, k) => v + shift[k]) as Vec3, hi = c.bbox.max.map((v, k) => v + shift[k]) as Vec3;
  if (s > 0) hi[axis] = Math.min(far.max[axis] + 2, hi[axis] + dist); else lo[axis] = Math.max(far.min[axis] - 2, lo[axis] - dist);
  const ahead = blockers.filter(p => [0, 1, 2].every(k => p.bbox.min[k] < hi[k] && lo[k] < p.bbox.max[k]));
  if (!ahead.length) return Object.assign([], { free: Infinity });
  const h = Math.max(1, Math.cbrt(((hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2])) / 4e6));
  const g: Grid = { o: [lo[0] - h, lo[1] - h, lo[2] - h], h, n: [0, 1, 2].map(k => Math.ceil((hi[k] - lo[k]) / h) + 2) as [number, number, number] };
  const N = g.n[0] * g.n[1] * g.n[2];
  const me = new Uint8Array(N); rasterize(c.mesh, { ...g, o: g.o.map((v, k) => v - shift[k]) as Vec3 }, me);
  const reach = Number.isFinite(dist) ? Math.ceil(dist / h) : Infinity;
  const st = [1, g.n[0], g.n[0] * g.n[1]], [u, v] = [0, 1, 2].filter(k => k !== axis);
  const out: string[] & { free?: number } = []; out.free = Infinity;
  for (const p of ahead) {
    const m = new Uint8Array(N); rasterize(p.mesh, g, m);
    // walk each column along the axis: a staying voxel within `reach` ahead of one of the part's voxels is in the way
    let count = 0, gap = Infinity;
    for (let a = 0; a < g.n[u]; a++) for (let b2 = 0; b2 < g.n[v]; b2++) {
      let last = -Infinity;
      for (let t = 0; t < g.n[axis]; t++) {
        const i = a * st[u] + b2 * st[v] + (s > 0 ? t : g.n[axis] - 1 - t) * st[axis];
        if (me[i]) last = t;
        else if (m[i] && last >= 0 && t - last <= reach) { count++; gap = Math.min(gap, (t - last - 1) * h); }
      }
    }
    if (count > 3) { out.push(p.name); out.free = Math.min(out.free!, gap); }
  }
  return out;
}

/**
 * The way in for every board, module, battery and switch: with the covers, retainers and sled off (`removable`), the
 * part slides out along one axis, or backs out of its pocket by its own depth and then slides out along another (a
 * module out of the back of its face frame, then out through the open cover). Members on other links come apart at
 * their servo horns, so only the part's own link walls it in; a part that goes on after the base electronics
 * (`liftOff`: a body on its neck) walls in only the components fitted into it.
 */
export function insertionCheck(parts: FitPart[], comps: FitComp[], strict: boolean) {
  const items = comps.filter(c => INSERTED.has(CATALOG[c.catalogId]?.kind ?? ''));
  const far: Box3 = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  for (const q of [...parts.map(p => p.bbox), ...comps.map(c => c.bbox)]) for (let k = 0; k < 3; k++) { far.min[k] = Math.min(far.min[k], q.min[k]); far.max[k] = Math.max(far.max[k], q.max[k]); }
  const stuck: string[] = [], ways = new Map<string, number>();
  for (const c of items) {
    const blockers = parts.filter(p => p.link === c.link && !p.removable && !(p.liftOff && !p.liftOff.includes(c.key)));
    let way: string | null = null; const by = new Set<string>();
    const zero: Vec3 = [0, 0, 0];
    for (const d of DIRS) {
      const hit = sweep(c, zero, d, Infinity, blockers, far);
      if (!hit.length) { way = dirName(d); break; }
      hit.forEach(n => by.add(n));
    }
    // two moves: back out of the pocket as far as it is free (and half way), then out along another axis
    for (const d1 of way ? [] : DIRS) {
      const free = sweep(c, zero, d1, Infinity, blockers, far).free ?? Infinity;
      if (free < 3) continue;
      const span = c.bbox.max[d1[0]] - c.bbox.min[d1[0]];
      for (const go of [...new Set([Math.min(free - 1, 150), Math.min(free / 2, span + 2)])]) {
        const shift = [0, 0, 0] as Vec3; shift[d1[0]] = d1[1] * go;
        const d2 = DIRS.find(d => d[0] !== d1[0] && !sweep(c, shift, d, Infinity, blockers, far).length);
        if (d2) { way = `${dirName(d1)} then ${dirName(d2)}`; break; }
      }
      if (way) break;
    }
    if (way) ways.set(way, (ways.get(way) ?? 0) + 1);
    else stuck.push(`${c.label} (blocked by ${[...by].join(', ')})`);
  }
  return {
    id: 'access', label: 'Electronics can be fitted', status: stuck.length ? (strict ? 'fail' as const : 'warn' as const) : 'pass' as const,
    detail: stuck.length
      ? `No way in for: ${stuck.slice(0, 4).join('; ')}${stuck.length > 4 ? ` (+${stuck.length - 4} more)` : ''}. With the covers, retainers and sled off, the part itself must slide out along an axis: open that side or make the part come off.`
      : `Each of the ${items.length} electronic parts slides into place whole once the covers, retainers and sled are off (${[...ways].map(([w, k]) => `${k} along ${w}`).join(', ') || 'none'}).`,
  };
}
