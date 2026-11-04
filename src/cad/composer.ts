// Free-form composer: builds whatever the AI composes when no dedicated builder fits the idea.
// Layout: the standard desk base (battery bay, electronics deck, rear cover) carries a neck with a screw
// flange; the body shape sits on the neck. Each joint puts a servo in a printed housing on one face of its
// parent's bounding box (body or another member): push-fit pocket, M2 ear taps, a cleared horn zone and a
// lead channel back to the neck. The member rides the horn on a Ø38 hub with the Ø6.5 centre-screw tunnel
// and carries its shape `reach` mm out in the `point` direction. Everything is axis-aligned at the zero
// pose, so faces, bars and colliders stay boxes; the watertight / interference / sweep checks judge the result.

import { FIT, HOLES } from '../catalog/rules';
import type { CompJoint, Composition, Face, RobotSpec, ShapeKind } from '../design/spec';
import { Build, bb, box, cylX, cylY, cylZ, hull, rotAbout, rrect, sphere, sub, union, xform, type M } from './kernel';
import { EAR_HOLES, EAR_X0, EAR_X1, HORN_SEAT, SV, SV_X0, SV_X1, hornSeatCuts, hornSolid, ledPocketCuts, ledSolid, servoSolid } from './modules';
import { machineBase } from './machine';
import { CLAW_MOD, clawFace, clawFaceBox } from './claw';
import { BASE } from './companion';
import { CLAW_ROVER_NECK, ROVER_NECK, buildRover } from './rover';
import { buildVoiceDrive } from './voicedrive';
import { buildLegs, type Legs } from './legs';
import { erode, shapeSolid } from './shapes';
import { INSERTED, WIRED } from './fitcheck';
import { CATALOG } from '../catalog/components';
import { FLOOR, buildVoiceCore, coreEnvelope, coreLayout, faceBox, faceLayouts, isVoiceCore, microServo, voiceFace, voiceParts, type FaceLayout } from './voicecore';
import type { Collider, Vec3 } from './types';

type Box3 = { min: Vec3; max: Vec3 };
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (i: number, s = 1): Vec3 => [i === 0 ? s : 0, i === 1 ? s : 0, i === 2 ? s : 0];
const centre = (b: Box3): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
/** Axis-aligned box from a centre and half extents. */
const aabb = (c: Vec3, h: Vec3) => box(c[0] - h[0], c[0] + h[0], c[1] - h[1], c[1] + h[1], c[2] - h[2], c[2] + h[2]);

/** The shell wall: every shape is printed hollow by insetting it this much (`erode`, src/cad/shapes.ts). */
const WALL = 2.4;
const CORE_SKIN = 0.8;          // a voice core may sink into the shell wall down to this skin

const POINT: Record<string, Vec3> = { up: [0, 0, 1], down: [0, 0, -1], front: [0, 1, 0], back: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] };

// the shape library (src/cad/shapes.ts): re-exported for the modules that import it from here
export { shapeSolid };

/** Mount point on a face of a bounding box: outward normal n and point p (offset in-plane, clamped inside the face). */
function facePoint(b: Box3, face: Face, at: [number, number]) {
  const i = 'xyz'.indexOf(face[1]), s = face[0] === '+' ? 1 : -1;
  const [ua, va] = [0, 1, 2].filter(k => k !== i);
  const p = centre(b);
  p[i] = s > 0 ? b.max[i] : b.min[i];
  const clampIn = (k: number, v: number) => Math.min(b.max[k] - 6, Math.max(b.min[k] + 6, p[k] + v));
  p[ua] = clampIn(ua, at[0]); p[va] = clampIn(va, at[1]);
  return { n: unit(i, s), p, ua, va };
}

/** Servo frame on a face: shaft = n, case length along the in-plane axis pointing most toward the parent's centre (ties: down). */
function servoAxes(n: Vec3, p: Vec3, c: Vec3, ua: number, va: number): [Vec3, Vec3, Vec3] {
  const toC: Vec3 = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
  const cands = [unit(ua), unit(ua, -1), unit(va), unit(va, -1)];
  const sx = cands.reduce((best, v) => (dot(v, toC) - 0.01 * v[2] > dot(best, toC) - 0.01 * best[2] ? v : best));
  return [sx, cross(n, sx), n];
}

/**
 * Where a joint's servo sits on its parent: face point, servo axes and the housing block (3 mm walls round the case).
 * With the parent's `shape`, the point moves in along the face normal onto the real surface (a prism's sloped side, a
 * sphere away from its pole), so the housing is seated in the wall instead of hanging at the bounding box.
 */
function mountOn(parentBox: Box3, j: CompJoint, shape?: M) {
  const pc = centre(parentBox);
  const { n, p, ua, va } = facePoint(parentBox, j.face, j.at);
  const place = () => {
    const R = servoAxes(n, p, pc, ua, va);
    return { R, housing: xform(box(EAR_X0 - 3, EAR_X1 + 3, -SV.W / 2 - 3, SV.W / 2 + 3, -(SV.below + 3), 0), R, p) };
  };
  let { R, housing } = place();
  // Only when the housing would float: a seated housing on a round body is already right where it is.
  if (shape && housing.minGap(shape, 0.55) > 0.5) {
    const i = n.findIndex(v => v !== 0), s = n[i];
    const lo = [p[0] - 2, p[1] - 2, p[2] - 2], hi = [p[0] + 2, p[1] + 2, p[2] + 2];
    lo[i] = parentBox.min[i] - 1; hi[i] = parentBox.max[i] + 1;
    const hit = shape.intersect(box(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]));
    if (!hit.isEmpty()) { const q = bb(hit); p[i] = s > 0 ? q.max[i] : q.min[i]; ({ R, housing } = place()); }
  }
  return { pc, n, p, R, housing };
}

/**
 * A printed body or member. `gen` (shape kind, centre, size) lets it be rebuilt as a hollow shell; `anchor` is where it
 * hangs on its parent (neck or horn); `seam` (y), set when it holds electronics, splits it into a part that stays on the
 * anchor and a cover that comes off.
 */
interface Owner {
  name: string; link: string; adds: M[]; cuts: M[]; accents: M[]; shape: M; shapeBox: Box3;
  gen?: { kind: ShapeKind; c: Vec3; size: Vec3; solid?: M }; anchor: Vec3; anchorAxis: Vec3; seam?: number;   // solid: shape + core chamber
  /** Other printed parts inside the shape (the voice core sled) that the cover magnets must avoid. */
  keep?: M[];
}

/**
 * Face block spot on the front (+y) of `shape`: the first (x, z) near the centre where the block's back (retainer)
 * sits inside the shape, clear of the floor, of `blocked` and at least 7 mm in front of `minY` (the voice core).
 */
function findVoiceFace(shape: M, layouts: FaceLayout[], blocked: M | null, minY: number) {
  const sb = bb(shape), c = centre(sb);
  const steps = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8];
  const spots = steps.flatMap(sz => [0, -1, 1, -2, 2].map(sx => [sx, sz] as [number, number]))
    .sort((p, q) => Math.hypot(p[0] * 8, p[1] * 5) - Math.hypot(q[0] * 8, q[1] * 5) || q[1] - p[1]);
  for (const L of layouts) for (const [sx, sz] of spots) {
    const x = c[0] + sx * 8, z = c[2] + sz * 5;
    const probe = shape.intersect(cylY(x, z, 3, sb.min[1] - 1, sb.max[1] + 1, 16));
    if (probe.isEmpty()) continue;
    // 1 mm proud of the surface; on a curved front the block sinks in (≤ 30 mm) until its retainer is inside the shape
    for (let sink = 0; sink <= 30; sink += 2) {
      const yF = bb(probe).max[1] + 1 - sink;
      const f = faceBox(L, x, yF, z);
      if (f.z0 < FLOOR + 1 || f.y0 - 7 < minY) break;
      if (box(f.x0, f.x1, f.y0, f.yBack, f.z0, f.z1).subtract(shape).volume() > 2) continue;   // retainer inside the shape
      if (blocked && !box(f.x0 - 2, f.x1 + 2, f.y0 - 2, f.y1 + 40, f.z0 - 2, f.z1 + 2).intersect(blocked).isEmpty()) break;   // block + view corridor
      return { L, x, yF, z, f };
    }
  }
  return null;
}

/**
 * The joint whose member is the robot's head (it carries the face): of the joints named like a head, the one at the
 * end of the chain, so a "head" nodding on a "head_pan" / "neck" gets the face, not the small pan block under it.
 */
function headOf(joints: CompJoint[], name: RegExp): CompJoint | null {
  const named = joints.filter(j => name.test(j.name));
  return named.find(j => !named.some(k => k.parent === j.name)) ?? named[0] ?? null;
}

const boxCollider = (bx: Box3, friction?: number): Collider =>
  ({ shape: 'box', center: centre(bx), half: [0, 1, 2].map(k => Math.max(1, (bx.max[k] - bx.min[k]) / 2)) as Vec3, friction });

export function buildComposer(b: Build, spec: RobotSpec) {
  // a working copy: the voice-core fit may move body side joints (never mutate the caller's spec)
  const comp: Composition = { ...(spec.composition as Composition), joints: (spec.composition as Composition).joints.map(j => ({ ...j })) };
  const P = spec.params;
  let [bw, bd, bh] = comp.body.size;
  const claw = spec.platform === 'licheerv_claw';
  // XiaoZhi / Raspberry Pi / Jetson: a voice core (board, mic, speaker, display, battery) inside a standalone hollow body
  const voice = isVoiceCore(spec.platform);
  const vparts = voice ? voiceParts(spec) : null;
  // the body rides the rover chassis: CyberBrick (B-XA003 + shield), or the LicheeRV Claw kit (PCA9685 + continuous
  // servos in the chassis, the Claw module the face of the head or body)
  const wheels = comp.mobility === 'wheels' && !voice;
  // a voice robot that drives: its body rides a drive plate with continuous servos on the core's servo board
  const voiceDrive = voice && comp.mobility === 'wheels';
  let drive: ReturnType<typeof buildVoiceDrive> | null = null;
  // a robot that walks: the Claw base tub becomes the pelvis on two 4-DOF legs (8 servos on the PCA9685)
  const legs = comp.mobility === 'legs' && claw;
  let legsOut: Legs | null = null;
  if (comp.mobility === 'legs' && !claw)
    b.check({ id: 'mobility', label: 'Walking legs', status: 'warn',
      detail: voice ? `Walking legs are built on the LicheeRV Claw kit (PCA9685 base); the ${spec.platform} voice body stands on its own flat bottom instead.`
        : 'Walking legs need 8 leg servos on a PCA9685 (the LicheeRV Claw kit); the CyberBrick kit has 4 servo headers, so the body stands on the desk base. The prebuilt humanoid / quadruped builders walk on CyberBrick.' });
  // servo ids: CyberBrick B-PG001 / B-PG002; voice platforms use the directory's micro servos (the housings are micro-class)
  let servoId = 'B-PG001', spinId = 'B-PG002';
  if (vparts) {
    servoId = microServo(vparts.servo) ? vparts.servo : 'SG90-SERVO';
    spinId = microServo(vparts.spinServo) ? vparts.spinServo : 'FS90R-SERVO';
    if (comp.joints.length && (servoId !== vparts.servo || spinId !== vparts.spinServo))
      b.check({ id: 'servo_class', label: 'Servo size', status: 'warn',
        detail: `${[vparts.servo, vparts.spinServo].filter(id => !microServo(id)).join(', ')} is a standard-size / bus servo: the composer only builds 9 g micro-servo housings, so the joints use ${servoId} / ${spinId}. Design a dedicated mount for the bigger servo.` });
  }

  // ---------------------------------------------------------------- base: desk base, or the rover chassis (mobile)
  // The neck sits in free deck space; its flange holes stay out of the battery-strap band (M3 nuts go under the deck).
  let deckTop: number, nx: number, ny: number, flangeHoles: [number, number][];
  let portOffset = 0, ledsUsed = 0;
  let finishBase: (eyes: number, body: Box3) => void;
  let bodyShape: M;
  let bodyAt: Vec3 | null = null;                   // desk body: where its shape was built (for the hollow shell)
  let keepout: M | null = null;                     // mobile: chassis envelope that static body features must avoid
  // LicheeRV Claw with no servos: the module brings its own battery and speaker, so there is no base at all. The body
  // stands on the desk on a flat bottom (round shapes lose their lowest 12 %) and carries the face.
  const standalone = (claw && comp.joints.length === 0 && !wheels && !legs) || voice;
  // voice core: layout, and where it and the face block went in the grown body
  const coreL = vparts ? coreLayout(vparts, comp.joints.length > 0) : null;
  // the joint whose member is the robot's head (it carries the face on voice robots and the Claw kit)
  const headJoint = headOf(comp.joints.slice(0, 4), /head|face/i);
  // with a head, the face block splits: display (+ an I2S mic) on the head, the speaker (+ mic) on the body front
  const headL = vparts && headJoint && vparts.display ? [...faceLayouts({ ...vparts, speaker: null }), ...faceLayouts({ ...vparts, speaker: null, mic: null })] : [];
  const restL = vparts && headL.length ? faceLayouts({ ...vparts, display: null }) : [];
  if (headJoint && headL.length) {
    // the head must hold its screen: grow it (never shrink) to the smallest display block + margin for the curve
    const L = headL.reduce((a, c) => (c.w * c.h < a.w * a.h ? c : a));
    const [hx, hy, hz] = headJoint.size;
    // A round head (sphere, egg, capsule) must hold the block's flat retainer plate inside its curve: its corners need
    // about 1.45x the block (an ellipse round a rectangle). Depth too: a shallow head can't frame it.
    // A head that carries a servo of its own (an antenna, ears) holds it behind the block: deeper, and on a round head
    // wider too, so the plate's corners sit further forward in the curve, in front of that servo.
    const roundHead = ['sphere', 'egg', 'capsule', 'disc'].includes(headJoint.shape);
    const carries = comp.joints.slice(0, 4).some(j => j.parent === headJoint.name);
    const grow = (v: number, need: number) => Math.max(v, roundHead ? (carries ? 1.6 : 1.45) * need : need + 16);
    headJoint.size = [grow(hx, L.w), Math.max(hy, L.t + 28 + (carries ? SV.W + 12 : 0), 0.8 * Math.max(L.w, L.h)), grow(hz, L.h)];
  }
  const faceL = vparts ? faceLayouts(vparts) : [];
  let corePlan: { y0: number; grown: number } | null = null;
  // the body's outer solid when the cover rule added a core chamber (null: the plain shape)
  let outerOf: () => M | null = () => null;
  let placeCore: (shape: M, inner: M, at: Vec3, blocked: M | null, f: ReturnType<typeof faceBox> | null) => number | null = () => null;
  if (standalone) {
    deckTop = 0; nx = 0; ny = 0; flangeHoles = [];
    const s = comp.body.size, thin = s.indexOf(Math.min(...s));
    const round = ['sphere', 'egg', 'capsule'].includes(comp.body.shape) || (comp.body.shape === 'disc' && thin !== 2);
    // round bodies stand on a flat cut: 12 % for the small Claw module, 20 % for a voice core sled (wider, stable floor)
    const cut = round ? (coreL ? 0.2 : 0.12) : 0;
    // COVER RULE: when the custom shape can't hold the voice core even grown (a cloud's round lumps, a star's points),
    // it is unioned with a core chamber, a rounded box just big enough for the sled and the face block, standing on the
    // floor at the shape's centre. The shape covers the chamber, so the silhouette stays the reference's shape.
    let chamber: ((sz: Vec3, at: Vec3) => M) | null = null;
    const outer = (sz: Vec3, at: Vec3) => (chamber ? union([shapeSolid(comp.body.shape, at, sz), chamber(sz, at)]) : shapeSolid(comp.body.shape, at, sz));
    outerOf = () => (chamber && bodyAt ? outer([bw, bd, bh], bodyAt) : null);
    const make = (sz: Vec3) => {
      const at: Vec3 = [0, 0, sz[2] / 2 - cut * sz[2]];
      return { at, shape: sub(outer(sz, at), box(-500, 500, -500, 500, -500, 0)) };
    };
    bodyAt = make([bw, bd, bh]).at;
    bodyShape = make([bw, bd, bh]).shape;
    if (coreL) {
      // Grow the body (uniformly, keeping the user's proportions) until the core fits in the hollow, clear of the
      // body servo housings, with a face block spot in front of it.
      ledsUsed = P.leds;                                   // no LED hub on the voice platforms
      // the core sits as far forward as it fits (behind the face block, or under it when the block is higher), so it
      // comes out with the cover off
      placeCore = (shape, inner, at, blocked, f) => {
        const sb = bb(shape);
        const under = f && f.z0 - 3 > FLOOR + coreL.H + 2;
        const fb = f ? box(f.x0 - 3, f.x1 + 3, f.y0 - 8, f.y1 + 50, f.z0 - 3, f.z1 + 3) : null;
        for (let y0 = Math.floor((f && !under ? f.y0 - 8 : sb.max[1]) - coreL.D); y0 > sb.min[1]; y0 -= 2) {
          const E = coreEnvelope(coreL, [at[0], y0, FLOOR]);
          if (E.subtract(inner).volume() > 0.5) continue;
          if (blocked && !E.intersect(blocked).isEmpty()) continue;
          if (fb && !E.intersect(fb).isEmpty()) continue;
          return y0;
        }
        return null;
      };
      const faceD = faceL.length ? Math.max(...faceL.map(L => faceBox(L, 0, 0, 0).y1 - faceBox(L, 0, 0, 0).y0)) : 0;
      const need = [coreL.sledW + 4 + 2 * WALL, coreL.D + faceD + 12 + 2 * WALL, FLOOR + coreL.H + 4 + WALL];
      // each axis first grows to the core's bounding need, then all three grow together in 5 % steps
      const base = comp.body.size.map((v, i) => Math.max(v, need[i])) as Vec3;
      let k = 1;
      const fit = (sz: Vec3): { at: Vec3; shape: M; y0: number } | null => {
        if (moveSides) shoulders(sz);
        const { at, shape } = make(sz);
        // the core may sink into the 2.4 mm wall down to a 0.8 mm skin (its pocket is carved from the shell)
        const inner = erode(outer(sz, at), CORE_SKIN, true);
        const sb = bb(shape);
        const hs = comp.joints.slice(0, 4).filter(j => j.parent === 'body').map(j => mountOn(sb, j, shape).housing);
        const blocked = hs.length ? union(hs) : null;
        // a design with a head carries the display face on the head (placed after the joints): the body front only
        // needs the speaker block
        const bodyL = headL.length ? restL : faceL;
        // cheap first: the core must fit somewhere at all (no face yet) before the face search tries its spots
        if (placeCore(shape, inner, at, blocked, null) === null) return null;
        const face = bodyL.length ? findVoiceFace(shape, bodyL, blocked, -Infinity) : null;
        if (bodyL.length && !face) return null;
        const y0 = placeCore(shape, inner, at, blocked, face?.f ?? null);
        return y0 === null ? null : { at, shape, y0 };
      };
      // Side joints the AI put low or at the back (wings, arms) collide with the core zone (rear, bottom); before
      // growing, try them as shoulders: upper body, toward the front, where the core never is. Growth is capped at
      // 1.5x and the 250 mm print bed, so a design never balloons; past that the fit fails with a clear check.
      const MAX_GROW = 1.5, BED = 250;
      const original = comp.joints.map(j => ({ ...j, at: [...j.at] as [number, number] }));
      let moveSides = false;
      // a side servo's housing hangs ~30 mm below its pivot (toward the body centre): put the pivot that far above the
      // sled, at mid-depth (clear of the face block in front), inside the top of the body
      const shoulders = (sz: Vec3) => comp.joints.forEach(j => {
        if (j.parent !== 'body' || (j.face[1] !== 'x' && j.face[1] !== 'y')) return;
        const zc = sz[2] / 2 - cut * sz[2], top = sz[2] * (1 - cut);
        const dz = Math.min(FLOOR + coreL.H + 34, top - 14) - zc;   // facePoint offsets are from the face centre
        // on ±x faces at = [y, z]; on ±y faces at = [x, z] (clamped to the face later)
        j.at = j.face[1] === 'x' ? [-0.05 * sz[1], dz] : [j.at[0], dz];
      });
      let got = null as ReturnType<typeof fit>, sz: Vec3 = [bw, bd, bh];
      const grow = () => {
        for (k = 1, got = null; k <= MAX_GROW + 1e-9 && !got; k *= 1.05) {
          sz = base.map(v => Math.ceil(v * k)) as Vec3;
          if (sz.some(v => v > BED)) break;
          got = fit(sz);
        }
      };
      grow();
      let moved = false;
      if (!got && comp.joints.some(j => j.parent === 'body' && (j.face[1] === 'x' || j.face[1] === 'y'))) {
        moveSides = true; grow(); moved = !!got;
        if (!got) comp.joints.forEach((j, i) => { j.at = original[i].at; });
      }
      // still no fit: the shape covers a core chamber (see the cover rule above), then the same growth again
      let covered = false;
      if (!got) {
        // (wide and tall enough for the narrowest face block too, so the block stands on the chamber's flat front)
        const blocks = (headL.length ? restL : faceL).map(L => faceBox(L, 0, 0, 0));
        // the lowest block (a row: mic | screen | speaker), so the chamber stays low inside the shape
        const fb = blocks.length ? blocks.reduce((a, f) => (f.z1 - f.z0 < a.z1 - a.z0 ? f : a)) : null;
        const chW = Math.max(need[0], fb ? fb.x1 - fb.x0 + 2 * WALL + 4 : 0);
        const chH = Math.max(need[2], fb ? fb.z1 - fb.z0 + FLOOR + 2 * WALL + 2 : 0);
        chamber = (sz2, at) => rrect(Math.min(chW, sz2[0] + 2 * WALL), Math.min(need[1], sz2[1] + 2 * WALL), 6, at[0], at[1], 0, Math.min(chH, sz2[2] * (1 - cut)));
        // grow to the size where the shape hides the chamber best (≤ 12 % showing ends the search early)
        const shownAt = (s2: Vec3, at: Vec3) => { const c = chamber!(s2, at); return c.subtract(shapeSolid(comp.body.shape, at, s2)).volume() / c.volume(); };
        let best: { g: NonNullable<ReturnType<typeof fit>>; sz: Vec3; k: number; shown: number } | null = null;
        for (k = 1; k <= MAX_GROW + 1e-9; k *= 1.05) {
          const s2 = base.map(v => Math.ceil(v * k)) as Vec3;
          if (s2.some(v => v > BED)) break;
          const g = fit(s2);
          if (!g) continue;
          const shown = shownAt(s2, g.at);
          if (!best || shown < best.shown) best = { g, sz: s2, k, shown };
          if (shown <= 0.12) break;
        }
        if (best) { got = best.g; sz = best.sz; k = best.k * 1.05; }
        covered = !!got;
        if (!got) chamber = null;
      }
      if (got) {
        // the body's details move out with its surface: offsets of features on the body scale with the growth
        // (a bezel, a visor or cheeks at the old front would otherwise end up buried inside the grown shell)
        const ratio = sz.map((v, i) => v / comp.body.size[i]);
        if (ratio.some(r => r > 1.001)) comp.features = comp.features.map(f => (f.parent === 'body' ? { ...f, at: f.at.map((v, i) => v * ratio[i]) as Vec3 } : f));
        [bw, bd, bh] = sz; bodyAt = got.at; bodyShape = got.shape; corePlan = { y0: got.y0, grown: k / 1.05 };
      }
      else {
        sz = base.map(v => Math.min(BED, Math.ceil(v))) as Vec3;
        [bw, bd, bh] = sz;
        ({ at: bodyAt, shape: bodyShape } = make(sz));
        b.check({ id: 'voice_core', label: 'Voice core fit', status: 'fail',
          detail: `The ${spec.platform} voice core (${coreL.sledW.toFixed(0)} × ${coreL.D.toFixed(0)} × ${coreL.H.toFixed(0)} mm plus the face) does not fit this ${comp.body.shape} body within a printable size (≤ ${MAX_GROW}× and ≤ ${BED} mm): use a fuller shape (rounded_box, egg, sphere), fewer joints on the body's sides, or a smaller board.` });
      }
      if (covered && got) {
        // how much of the chamber shows outside the custom shape (the rest is covered by it)
        const cham = chamber!(sz, got.at), shown = cham.subtract(shapeSolid(comp.body.shape, got.at, sz)).volume() / cham.volume();
        b.check({ id: 'core_chamber', label: 'Core chamber', status: shown > 0.35 ? 'warn' : 'pass',
          detail: `The ${comp.body.shape} body can't hold the ${spec.platform} core on its own, so it covers a ${need.map(v => v.toFixed(0)).join(' × ')} mm core chamber (sled, battery, face block) at its centre; ${(shown * 100).toFixed(0)} % of the chamber shows outside the ${comp.body.shape}${shown > 0.35 ? ': make the shape larger or fuller at the bottom to hide it' : ''}.` });
      }
      if (moved) b.check({ id: 'joint_move', label: 'Joints moved for the core', status: 'pass',
        detail: `Moved ${comp.joints.filter((j, i) => j.at.join() !== original[i].at.join()).map(j => j.name).join(', ')} up to the shoulders so the ${spec.platform} core fits without growing the body.` });
    }
    finishBase = (_eyes, body) => {
      const foot = bb(bodyShape.intersect(box(-500, 500, -500, 500, 0, 1)));
      b.link({ id: 'base', name: 'Body', parent: null, colliders: [boxCollider(body, 0.7)] });
      b.meta = { support: [[foot.min[0], foot.min[1]], [foot.max[0], foot.min[1]], [foot.max[0], foot.max[1]], [foot.min[0], foot.max[1]]] };
    };
    b.check({ id: 'platform', label: 'Electronics platform', status: 'pass',
      detail: vparts
        ? `${spec.platform} voice robot, no base: ${CATALOG[vparts.board].name} on a core sled inside the hollow body${corePlan && [bw, bd, bh].some((v, i) => v > comp.body.size[i]) ? ` (grown from ${comp.body.size.join(' × ')} to ${bw} × ${bd} × ${bh} mm to fit the core)` : ''}; ${[vparts.display ? 'display face' : 'no face', vparts.mic ? 'mic' : null, vparts.speaker ? 'speaker' : null].filter(Boolean).join(', ')} in the front cover. It stands on its own flat bottom.`
        : 'LicheeRV Claw kit, no servos: no base. The Nano W + PicoClaw module (built-in battery and speaker) is the face of the body, which stands on its own flat bottom.' });
  } else if (wheels) {
    if (comp.wheelCount === 4) b.check({ id: 'drive_4wd', label: 'Four wheels', status: 'warn',
      detail: 'The rover chassis drives on 2 wheels and a front skid; four wheels are built on the XiaoZhi / Raspberry Pi / Jetson drive plate.' });
    const neck = claw ? CLAW_ROVER_NECK : ROVER_NECK;
    nx = neck.x; ny = neck.y; flangeHoles = neck.holes;
    const rover = buildRover(b, spec, {
      deckCuts: [cylZ(nx, ny, 4, -10, 300, 24), ...flangeHoles.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, -10, 300, 16))],
      leds: P.leds,
    });
    deckTop = rover.deckTop; ledsUsed = rover.ledsUsed;
    portOffset = rover.servoDrive ? 2 : 0;           // B-PG002 drive takes S1/S2; B-GM001 drive uses M1/M2
    // The body is centred over the chassis with its centre standH above the deck, then the chassis keep-out is
    // carved from it: a large body becomes a shell with wheel arches. A body that would lose more than 65 % of
    // its volume or fall apart into pieces (too small to wrap the chassis) is raised in 4 mm steps until it does not.
    // Servo housings of body-mounted joints must clear the keep-out too, so they are part of the raise test.
    // (on the Claw deck the neck sits ahead of the PCA9685: the body moves forward until the neck is ≥ 12 mm inside it)
    const cx = rover.centre[0], cy = claw ? Math.max(rover.centre[1], ny - bd / 2 + 12) : rover.centre[1];
    const full = shapeSolid(comp.body.shape, [cx, cy, 0], [bw, bd, bh]).volume();
    const onBody = comp.joints.slice(0, 4 - portOffset).filter(j => j.parent === 'body');
    const carve = (zc: number) => sub(shapeSolid(comp.body.shape, [cx, cy, zc], [bw, bd, bh]), rover.keepout);
    const fits = (shape: M) => shape.volume() >= 0.35 * full && shape.decompose().length === 1 &&
      onBody.every(j => mountOn(bb(shape), j, shape).housing.intersect(rover.keepout).volume() < 1);
    let zc = deckTop + comp.standH;
    bodyShape = carve(zc);
    for (let i = 0; i < 40 && !fits(bodyShape); i++) bodyShape = carve(zc += 4);
    bodyAt = [cx, cy, zc];
    keepout = rover.keepout;
    finishBase = (_eyes, body) => b.links.find(l => l.id === 'base')!.colliders.push(boxCollider(body, 0.5));
  } else {
    const base = machineBase(b, spec, { servoDriver: comp.joints.length > 0 || legs, face: true });
    deckTop = base.deckTop;
    if (legs) { legsOut = buildLegs(b, spec, servoId); portOffset = legsOut.ports; }
    ledsUsed = P.leds - base.ledBudget;             // Claw kit: no LED hub, so no LED eyes
    nx = -5; ny = 14;                               // between the LED hub (x ≤ -19) and the switch cradle (x ≥ 9)
    flangeHoles = [[nx - 7, ny - 11], [nx + 7, ny - 11], [nx, ny + 11]];
    const overCover = ny - bd / 2 < -5;             // body reaches over the rear electronics cover / console
    const z0 = Math.max(deckTop + 3 + comp.standH, deckTop + (overCover ? base.coverTop + 2 : 16));
    bodyAt = [nx, ny, z0 + bh / 2];
    bodyShape = shapeSolid(comp.body.shape, bodyAt, [bw, bd, bh]);
    base.deckCuts.push(cylZ(nx, ny, 4, deckTop - 4, deckTop + 1, 24), ...flangeHoles.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, deckTop - 4, deckTop + 1, 16)));
    finishBase = (eyes, body) => {
      base.finishDeck(base.statusLeds(Math.max(0, P.leds - eyes)));
      b.link({ id: 'base', name: 'Base', parent: null, colliders: [...base.colliders, boxCollider(body, 0.7)] });
      b.meta = { support: [[-28, -37], [28, -37], [28, 36], [-28, 36]] };
    };
  }
  // CyberBrick: 4 servo headers; the Claw / voice PCA9685 has 16 channels (the composition still caps joints at 4)
  const maxJoints = Math.min(4, (claw || voice ? 16 : 4) - portOffset);

  // the base builder's electronics go in before the body: the body (on its neck) walls in only what is fitted into it
  const baseComps = b.comps.length;
  // ---------------------------------------------------------------- body on a neck
  const bodyBox = bb(bodyShape);
  const bc = centre(bodyBox);
  // the neck runs up into the first body material above the flange
  const overNeck = bodyShape.intersect(cylZ(nx, ny, 8, deckTop, bodyBox.max[2] + 1, 24));
  const neckBase = overNeck.isEmpty() ? bodyBox.min[2] : bb(overNeck).min[2];
  const neckTop = neckBase + Math.min(8, (bodyBox.max[2] - neckBase) / 2);
  if (overNeck.isEmpty() && !standalone)
    b.check({ id: 'neck', label: 'Body support', status: 'fail', detail: 'No body material above the neck: move or enlarge the body so it covers the deck centre.' });
  const body: Owner = {
    name: 'Body', link: 'base', shape: bodyShape, shapeBox: bodyBox, accents: [], anchorAxis: [0, 0, 1],
    // standalone: no neck; the rear half stays and the front (face) half is the cover
    anchor: standalone ? [bc[0], bodyBox.min[1], 0] : [nx, ny, deckTop],
    gen: bodyAt ? { kind: comp.body.shape, c: bodyAt, size: [bw, bd, bh], solid: outerOf() ?? undefined } : undefined,   // a rover body: before its chassis carve
    adds: standalone
      ? [bodyShape, bodyShape.intersect(box(-500, 500, -500, 500, 0, voice ? FLOOR : WALL))]          // shell + a solid floor on the flat bottom
      : [bodyShape, cylZ(nx, ny, 9, deckTop + 2.99, neckTop, 40), rrect(24, 32, 4, nx, ny, deckTop, deckTop + 3)],
    cuts: voice ? []
      : standalone
      ? [box(bc[0] - 6, bc[0] + 6, bodyBox.min[1] - 1, bc[1], WALL + 1, WALL + 9)]              // USB-C charging cable out of the back
      : [cylZ(nx, ny, 4, deckTop - 1, bc[2], 24), ...flangeHoles.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, deckTop - 1, deckTop + 4, 16))],
  };
  const owners = new Map<string, Owner>([['body', body]]);

  // ---------------------------------------------------------------- joints
  const links: { j: CompJoint; owner: Owner; origin: Vec3; axis: Vec3; R: Vec3[]; parent: Owner; lead: Vec3 }[] = [];
  const joints = comp.joints.slice(0, maxJoints);
  if (comp.joints.length > maxJoints)
    b.check({ id: 'ports', label: 'Servo headers', status: 'warn',
      detail: `The drive servos use S1/S2, so only ${maxJoints} composed joint(s) fit; dropped: ${comp.joints.slice(maxJoints).map(j => j.name).join(', ')}. Use B-GM001 motor drive to free all four headers.` });
  joints.forEach((j, idx) => {
    const parent = owners.get(j.parent) ?? body;
    const { pc, n, p, R, housing } = mountOn(parent.shapeBox, j, parent.shape);
    const S = (m: M) => xform(m, R, p);
    const toW = (l: Vec3): Vec3 => plus(p, plus(plus(times(R[0], l[0]), times(R[1], l[1])), times(R[2], l[2])));
    const spin = j.kind === 'spin';
    const label = `${j.name} servo (S${idx + 1 + portOffset})`;

    // housing on the parent: 3 mm walls round the case, horn zone cleared, pocket + ear taps, lead channel to the parent centre
    parent.adds.push(housing);
    parent.cuts.push(
      S(cylZ(0, 0, 23, 0, HORN_SEAT + 6.5, 48)),
      S(union([
        box(SV_X0 - FIT.push / 2, SV_X1 + FIT.push / 2, -SV.W / 2 - FIT.push / 2, SV.W / 2 + FIT.push / 2, -SV.below - 0.6, 0.5),
        ...EAR_HOLES.map(ex => cylZ(ex, 0, HOLES.M2.tap / 2, -8, 0.5, 16)),
      ])),
      hull([sphere(toW([(SV_X0 + SV_X1) / 2, 0, -SV.below]), 3.5, 16), sphere(pc, 3.5, 16)]),
    );
    b.comp({ key: `servo_${j.name}`, catalogId: spin ? spinId : servoId, label, link: parent.link, solid: S(servoSolid()) });
    b.comp({ key: `horn_${j.name}`, catalogId: 'horn', label: `${j.name} horn`, link: j.name, solid: S(hornSolid()), color: '#f0f0f0' });

    // member: hub on the horn, bar out to the shape, Ø6.5 tunnel along the shaft
    const ni = n.findIndex(v => v !== 0);
    const extN = j.size[ni] / 2;
    const dir = POINT[j.point];
    const axial = !dir || Math.abs(dot(dir, n)) > 0.5;
    const seatMid = plus(p, times(n, HORN_SEAT + 2.5));
    const adds: M[] = [S(cylZ(0, 0, 19, HORN_SEAT, HORN_SEAT + 5, 48))];
    let shapeC: Vec3;
    if (axial) {
      shapeC = plus(p, times(n, HORN_SEAT + 5 + extN - 0.5));
    } else {
      shapeC = plus(plus(p, times(n, HORN_SEAT + Math.max(2.5, extN))), times(dir, j.reach));
      const w = cross(n, dir).map(Math.abs) as Vec3;
      const nAbs = n.map(Math.abs) as Vec3, dAbs = dir.map(Math.abs) as Vec3;
      const half = plus(plus(times(dAbs, j.reach / 2), times(nAbs, 2.5)), times(w, 4));
      // On a wall that slopes out along the pointing direction (a prism's side), the shape stands off along the normal
      // until it clears the parent, and the bar slants out to it.
      let off = 0;
      // (and, for a swing, at both of its limits: a wagging segment rides high enough to clear its parent's edge)
      const hits = (o: number) => { const s0 = shapeSolid(j.shape, plus(shapeC, times(n, o)), plus(j.size, [2, 2, 2]));
        return s0.intersect(parent.shape).volume() > 0.5 || (j.kind !== 'spin' && j.range.some(a => Math.abs(a) >= 1 && rotAbout(s0, n, p, a).intersect(parent.shape).volume() > 0.5)); };
      while (off < 30 && hits(off)) off += 2;
      if (off >= 30) off = 0;
      shapeC = plus(shapeC, times(n, off));
      if (off > 0) {
        const post = plus(times(nAbs, 2.5), times(w, 4));
        adds.push(hull([aabb(seatMid, plus(post, times(dAbs, 1))), aabb(plus(plus(seatMid, times(dir, j.reach)), times(n, off)), plus(post, times(dAbs, 1)))]));
      } else if (j.reach > 0) adds.push(aabb(plus(seatMid, times(dir, j.reach / 2)), half));
      // On a vertical shaft, a shape that lies wholly beyond the parent (in the pointing direction) drops to the
      // parent's centre height on a strut, e.g. a tail fin behind a body instead of a flag above it. The swing
      // stays horizontal, so the drop cannot swing it into the parent.
      // A neck or head on a side shaft (a nodding pitch joint) likewise moves back onto the parent's centre line,
      // so the head sits over the neck instead of beside it; the swing is about the shaft, which the move keeps.
      let dropped: Vec3 = [...shapeC];
      dropped[ni] = pc[ni];
      const sideCentre = ni !== 2 && /head|face|neck/i.test(j.name);
      const beyond = (ni === 2 || sideCentre) && dot(plus(dropped, times(pc, -1)), dir) > 0;
      const post = plus(times(dAbs, 4), times(w, 4));
      // A centred neck / head is joined at its near end (toward the hub) and the side bar stops there, so the strut
      // stays clear of the next joint on the shape's far end (a head's horn zone on top of a neck). When it would
      // just touch its parent on the centre line, it slides further out along its pointing direction (≤ 60 mm).
      const along = dot(dAbs, j.size) / 2;
      // everything already on the parent (its shape, servo housings, struts) and this joint's own servo
      const obstacles = sideCentre ? union([...parent.adds, S(servoSolid())]) : parent.shape;
      // swinging, the member must miss everything on the parent (its housings and struts too) and this joint's servo
      let swingAll: M | null = null;
      const swingObs = () => (swingAll ??= union([...parent.adds, S(servoSolid())]));
      const pieces = (extra: number) => {
        const c = plus(dropped, times(dir, extra)), reach = j.reach + extra;
        const tJoin = sideCentre ? Math.max(4, reach - along + 4) : reach;
        const strut = hull([aabb(plus(seatMid, times(dir, tJoin)), plus(post, times(nAbs, 2.5))), aabb(plus(c, times(dir, tJoin - reach)), plus(post, times(nAbs, 1)))]);
        const ok = union([shapeSolid(j.shape, c, plus(j.size, [4, 4, 4])), strut]).intersect(obstacles).volume() < 1
          // and stays clear while it swings to its limits (a head nods over its parent, a tail wags behind it, not into it)
          && (j.kind === 'spin' || j.range.every(a => Math.abs(a) < 1 || rotAbout(union([shapeSolid(j.shape, c, plus(j.size, [2, 2, 2])), strut]), n, p, a).intersect(swingObs()).volume() < 1));
        return { c, tJoin, strut, ok };
      };
      let fit = pieces(0);
      for (let extra = 3; beyond && sideCentre && !fit.ok && extra <= 60; extra += 3) { const t = pieces(extra); if (t.ok) fit = t; }
      const { strut, tJoin } = fit;
      dropped = fit.c;
      const clear = beyond && fit.ok;
      if (clear && Math.abs(dropped[ni] - shapeC[ni]) > 2) {
        if (sideCentre && off === 0 && j.reach > 0) {
          adds.pop();                                  // the full-reach side bar: a short one up to the strut instead
          adds.push(aabb(plus(seatMid, times(dir, tJoin / 2)), plus(plus(times(dAbs, tJoin / 2), times(nAbs, 2.5)), times(w, 4))));
        }
        adds.push(strut);
        shapeC = dropped;
      }
    }
    const shape = shapeSolid(j.shape, shapeC, j.size);
    // A shape that doesn't meet the hub (a ring or tube over it, a top on its point) is joined to it by a web: the hull of
    // the hub and the shape's first few mm along the shaft.
    if (axial) {
      const q = bb(shape), near = n[ni] > 0 ? q.min[ni] : q.max[ni];
      // deep enough that the slice is ≥ 18 mm across (the Ø6.5 screw tunnel and the cable channel then leave it whole)
      const sliceAt = (d: number) => {
        const lo = q.min.map(v => v - 1) as Vec3, hi = q.max.map(v => v + 1) as Vec3;
        [lo[ni], hi[ni]] = n[ni] > 0 ? [near - 1, near + d] : [near - d, near + 1];
        return shape.intersect(box(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]));
      };
      const wide = (m: M) => { const r = bb(m); return [0, 1, 2].filter(k => k !== ni).every(k => r.max[k] - r.min[k] >= 18); };
      let slice = sliceAt(6);
      const meets = !slice.isEmpty() && wide(slice) && !union([adds[0], shape]).decompose().slice(1).length;
      for (let d = 10; d <= 40 && !slice.isEmpty() && !wide(slice); d += 5) slice = sliceAt(d);
      if (!meets && !slice.isEmpty()) adds.push(hull([adds[0], slice]));
    }
    adds.push(shape);
    const owner: Owner = {
      name: `${j.name} member`, link: j.name, adds, accents: [], shape, shapeBox: bb(shape), anchor: p, anchorAxis: n,
      gen: { kind: j.shape, c: shapeC, size: j.size },
      cuts: [S(hornSeatCuts(5)), S(cylZ(0, 0, FIT.tunnel / 2, HORN_SEAT - 1, HORN_SEAT + 6 + 2 * extN + (axial ? 0 : 200), 24))],
    };
    owners.set(j.name, owner);
    links.push({ j, owner, origin: p, axis: n, R, parent, lead: toW([(SV_X0 + SV_X1) / 2, 0, -SV.below]) });
  });

  // the openings of each face (screen window, mic, speaker grille, Claw keys), 120 mm out: features on any part may frame them, never fill them
  const views: M[] = [];

  // ---------------------------------------------------------------- Claw face: the module is the face of the head joint, or of the body
  // The face sits on the front (+y) of that shape, at the first spot clear of the servos mounted on it.
  if (claw) {
    const hj = headOf(links.map(l => l.j), /head|face|neck|eye/i);
    const head = (hj && links.find(l => l.j === hj)?.owner) ?? body;
    const sb = head.shapeBox, c = centre(sb);
    // keep clear of the servos mounted on it and of their members (a spinning member: its whole swept disc)
    const mounted = links.filter(l => (owners.get(l.j.parent) ?? body) === head);
    const swept = (l: (typeof links)[number]) => {
      const mb = l.owner.shapeBox, o = l.origin;
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => [0, 1, 2].map(a => ((i >> a) & 1 ? mb.max : mb.min)[a] - o[a]));
      const R = Math.max(...corners.map(d => Math.hypot(...d.map((v, a) => v * (1 - Math.abs(l.axis[a])))))) + 3;   // farthest corner off the axis
      const lo = [0, 1, 2].map(a => Math.min(mb.min[a], o[a])), hi = [0, 1, 2].map(a => Math.max(mb.max[a], o[a]));
      return Math.abs(l.axis[1]) > 0.5 ? cylY(o[0], o[2], R, lo[1], hi[1], 48) : Math.abs(l.axis[0]) > 0.5 ? cylX(o[1], o[2], R, lo[0], hi[0], 48) : cylZ(o[0], o[1], R, lo[2], hi[2], 48);
    };
    const keepOut = mounted.flatMap(l => [b.comps.find(k => k.key === `servo_${l.j.name}`)!.solid, l.j.kind === 'spin' ? swept(l) : l.owner.shape]);
    const blocked = keepOut.length ? union(keepOut) : null;
    const steps = [0, -1, 1, -2, 2, -3, 3, -4, 4];
    const spots = steps.flatMap(sz => steps.map(sx => [sx, sz] as [number, number])).sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
    // Each key plunger runs out to the shape's real surface beside the frame (≤ 12 mm, or the key can't be pressed).
    const MAXP = 15;
    const cands = spots.map(([sx, sz]) => {
      const p = { x: c[0] + sx * 12, yF: sb.max[1] + 2, z: c[2] + sz * 15 };
      const f = clawFaceBox(p.x, p.yF, p.z), ky = p.yF - 5.3, kz = p.z - CLAW_MOD.lcdUp + CLAW_MOD.keyUp;
      const side = (x0: number, x1: number, s: number) => {
        const hit = head.shape.intersect(box(x0, x1, ky - 3.6, ky + 3.6, kz - 3.6, kz + 3.6));      // as wide as the plunger cap
        if (hit.isEmpty()) return s > 0 ? f.x1 : f.x0;
        const h = bb(hit);
        return s > 0 ? (h.max[0] > x1 - 0.1 ? NaN : Math.max(h.max[0], f.x1)) : (h.min[0] < x0 + 0.1 ? NaN : Math.min(h.min[0], f.x0));
      };
      return { ...p, keyReach: [side(f.x0 - MAXP, f.x0, -1), side(f.x1, f.x1 + MAXP, 1)] as [number, number] };
    });
    // the module goes in from behind: prefer a spot whose way back (25 mm behind the frame) is clear of the neck and the servos
    const neckZone = head === body && !standalone ? cylZ(nx, ny, 10, deckTop, neckTop + 1, 32) : null;
    const wayBack = (p: (typeof cands)[number]) => {
      const f = clawFaceBox(p.x, p.yF, p.z), lane = box(f.x0, f.x1, f.y0 - 25, f.y0, f.z0 - 1, f.z1);
      return [neckZone, blocked].every(m => !m || lane.intersect(m).isEmpty());
    };
    const fits = (p: (typeof cands)[number]) => {
        const f = clawFaceBox(p.x, p.yF, p.z), ky = p.yF - 5.3, kz = p.z - CLAW_MOD.lcdUp + CLAW_MOD.keyUp;
        if (f.z0 < deckTop + 1 || p.keyReach.some(Number.isNaN)) return false;                // never into the deck; keys reachable
        if (head.shape.intersect(box(f.x0, f.x1, f.y0, f.y1, f.z0, f.z1)).volume() < 400) return false;   // must sit on the shape
        // a face on a member keeps clear of the body under it (frame, retainer and module)
        if (head !== body && !body.shape.intersect(box(f.x0 - 1, f.x1 + 1, f.y0 - 1, f.y1 + 1, f.z0 - 1, f.z1 + 1)).isEmpty()) return false;
        // and stay one piece with it once the pocket is cut (a frame over a ring's hole or a thin rim would fall off)
        const zb = p.z - CLAW_MOD.lcdUp, pocket = box(p.x - CLAW_MOD.w / 2 - 0.2, p.x + CLAW_MOD.w / 2 + 0.2, f.y0 - 1, f.y1 + 1, zb - 0.2, zb + CLAW_MOD.h + 0.2);
        if (sub(union([head.shape, box(f.x0, f.x1, f.y0 + CLAW_MOD.retainer, f.y1, f.z0, f.z1)]), pocket).decompose().length > 1) return false;
        const path = (x0: number, x1: number) => box(x0, x1, ky - 4, ky + 4, kz - 4, kz + 4);
        return !blocked || union([box(f.x0 - 2, f.x1 + 2, f.y0 - 2, f.y1, f.z0 - 2, f.z1 + 2),   // frame + the two plunger paths
          path(Math.min(p.keyReach[0], f.x0) - 4, f.x0), path(f.x1, Math.max(p.keyReach[1], f.x1) + 4)]).intersect(blocked).isEmpty();
      };
    const best = cands.find(p => fits(p) && wayBack(p));
    // no room on the shape (e.g. a clock hand sweeping the whole dial): the face stands in front of the base on two legs
    // down to the desk (glued to the base's front face), chin 12 mm over the deck for the USB-C plug
    const frontOf = Math.max(BASE.y1, bodyBox.max[1], blocked ? bb(blocked).max[1] : -1e9);   // in front of the body and anything moving on it
    const stand = { x: 0, yF: frontOf + 2 + (CLAW_MOD.depth + 1.5 + 0.2 + CLAW_MOD.retainer) + 2, z: deckTop + 12 + CLAW_MOD.end + CLAW_MOD.lcdUp };
    const sf = clawFaceBox(stand.x, stand.yF, stand.z);
    const legs = [box(sf.x0, sf.x0 + 5, BASE.y1 + 0.2, sf.y1, 0, sf.z0 + 0.01), box(sf.x1 - 5, sf.x1, BASE.y1 + 0.2, sf.y1, 0, sf.z0 + 0.01)];
    const standClear = !best && !wheels && !standalone && union([...legs, box(sf.x0 - 2, sf.x1 + 4, sf.y0 - 2, sf.y1, sf.z0, sf.z1 + 2)]).intersect(union([bodyShape, ...(blocked ? [blocked] : [])])).isEmpty();
    // a spot whose module could not be slid out past the neck: the stand in front of the base when it fits, else that spot
    const at = best ?? (standClear ? undefined : cands.find(fits));
    if (!at && standClear) {
      const cf = clawFace(b, spec, 'base', stand);
      views.push(cf.openings);
      b.part({ id: 'claw_stand', name: 'Claw face stand', link: 'base', material: spec.structural, profile: 'shell', color: spec.accentColor,
        solid: sub(union([cf.add, ...legs]), cf.cut), printRot: [-90, 0, 0], printNote: 'Face down; the legs print upright. Glue the legs to the front face of the base (CA or 2-part epoxy).' });
    } else if (!at) b.check({ id: 'claw_face', label: 'Claw face', status: 'fail', detail: `No room on the front of the ${head.name.toLowerCase()} clear of its servos and moving parts, nor at the front of the base: make it larger or move a joint off its front face.` });
    else {
      const cf = clawFace(b, spec, head.link, at);
      views.push(cf.openings);
      head.adds.push(cf.add);
      head.cuts.push(cf.cut);
      // opens just behind the retainer: module in, retainer screwed, closed. Where the shape is open behind the frame
      // (a ring, a tube), the module goes in from there and the shape stays whole.
      const behind = box(cf.box.x0, cf.box.x1, cf.box.y0 - 25, cf.box.y0, cf.box.z0, cf.box.z1);
      // (a body carved round the rover chassis is open only toward the chassis: it always opens)
      if ((head === body && wheels) || head.shape.intersect(behind).volume() > 0.15 * behind.volume()) head.seam = cf.box.y0 - 1;
    }
  }

  // ---------------------------------------------------------------- voice core: sled at the rear of the hollow body, face block in front
  if (coreL && vparts) {
    const sb = body.shapeBox;
    const y0 = corePlan?.y0 ?? sb.min[1] + WALL + 1;
    const mounted = links.filter(l => (owners.get(l.j.parent) ?? body) === body);
    const housings = mounted.map(l => mountOn(sb, l.j, body.shape).housing);
    const sweptOf = (l: (typeof links)[number]) => {
      const mb = l.owner.shapeBox, o = l.origin;
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => [0, 1, 2].map(a => ((i >> a) & 1 ? mb.max : mb.min)[a] - o[a]));
      const R = Math.max(...corners.map(d => Math.hypot(...d.map((v, a) => v * (1 - Math.abs(l.axis[a])))))) + 3;
      const lo = [0, 1, 2].map(a => Math.min(mb.min[a], o[a])), hi = [0, 1, 2].map(a => Math.max(mb.max[a], o[a]));
      return Math.abs(l.axis[1]) > 0.5 ? cylY(o[0], o[2], R, lo[1], hi[1], 48) : Math.abs(l.axis[0]) > 0.5 ? cylX(o[1], o[2], R, lo[0], hi[0], 48) : cylZ(o[0], o[1], R, lo[2], hi[2], 48);
    };
    const keepOut = [...housings, ...mounted.flatMap(l => [b.comps.find(k => k.key === `servo_${l.j.name}`)!.solid, l.j.kind === 'spin' ? sweptOf(l) : l.owner.shape])];
    const blocked = keepOut.length ? union(keepOut) : null;
    // With a head, the display face (+ an I2S mic) goes on the head member (clear of servos / members mounted on it)
    // and the speaker block on the body front; if the head can't take it, the whole block goes on the body.
    const headOwner = headJoint ? owners.get(headJoint.name) ?? null : null;
    let headFace: ReturnType<typeof findVoiceFace> = null;
    if (headOwner && headL.length) {
      const onHead = links.filter(l => (owners.get(l.j.parent) ?? body) === headOwner);
      const headBlocked = onHead.length ? union(onHead.flatMap(l => [b.comps.find(k => k.key === `servo_${l.j.name}`)!.solid, l.owner.shape])) : null;
      headFace = findVoiceFace(headOwner.shape, headL, headBlocked, -Infinity);    }
    const onHeadIds = new Set(headFace ? headFace.L.items.map(i => i.id) : []);
    const bodyL = headFace
      ? faceLayouts({ ...vparts, display: null, mic: onHeadIds.has(vparts.mic ?? '') ? null : vparts.mic })
      : faceL;
    const face = bodyL.length ? findVoiceFace(body.shape, bodyL, blocked, -Infinity) : null;
    const inner = erode(outerOf() ?? shapeSolid(comp.body.shape, bodyAt!, [bw, bd, bh]), CORE_SKIN, true);
    const yC = placeCore(body.shape, inner, bodyAt!, housings.length ? union(housings) : null, face?.f ?? null) ?? y0;
    const core = buildVoiceCore(b, spec, 'base', coreL, [bodyAt![0], yC, FLOOR]);
    // where the core sinks into the shell wall, carve its pocket (the 0.8 mm skin outside stays)
    body.cuts.push(...core.bodyCuts, coreEnvelope(coreL, [bodyAt![0], yC, FLOOR]).intersect(inner));
    body.keep = [core.sled];
    if (voiceDrive) {
      // wheel leads come up through the floor just ahead of the sled (or beside it, when the sled fills the floor)
      // (over the tray lip's height: a rounded body widens just above its flat bottom)
      const foot = bb(bodyShape.intersect(box(-500, 500, -500, 500, 0, 4)));
      const ahead = yC + coreL.D + 7;
      const lead: [number, number] | null = ahead < foot.max[1] - 10 ? [bodyAt![0], ahead] : null;
      // GA12-N20 gear motors when the directory has them (through a DRV8833 / TB6612 on the servo board), else FS90R servos
      const motor = vparts.driveMotor ? { id: vparts.driveMotor, driver: vparts.motorDriver ?? 'DRV8833-DRIVER', stocked: !!vparts.motorDriver } : null;
      drive = buildVoiceDrive(b, spec, { foot, servoId: spinId, motor, count: comp.wheelCount === 4 ? 4 : 2, firstPort: joints.length, screws: core.screws, lead, battery: vparts.battery });
      body.cuts.push(...drive.bodyCuts);
    }
    let faceBoxY0 = yC + coreL.D + 9;
    if (headFace && headOwner) {
      // on the head: the head member opens at its own seam just behind the face retainer
      const vf = voiceFace(b, spec, headOwner.link, headFace.L, headFace, 'head');
      views.push(vf.openings);
      headOwner.adds.push(vf.add);
      headOwner.cuts.push(vf.cut);
      headOwner.seam = vf.box.y0 - 1;
    }
    if (face) {
      const vf = voiceFace(b, spec, 'base', face.L, face, headFace ? 'body' : '');
      views.push(vf.openings);
      body.adds.push(vf.add);
      body.cuts.push(vf.cut);
      faceBoxY0 = vf.box.y0;
    } else if (bodyL.length)
      b.check({ id: 'voice_face', label: 'Voice face', status: 'fail', detail: 'No room on the front of the body for the display / mic / speaker block clear of the servos and moving parts: make the body larger or move a joint off its front face.' });
    // HAT mic ports and vents through the top, clear of the servo housings, horn zones and the face block
    if (core.topCuts.length) {
      const avoid = union([...housings.map(h => { const q = bb(h); return box(q.min[0] - 2, q.max[0] + 2, q.min[1] - 2, q.max[1] + 2, q.min[2] - 2, q.max[2] + 30); }),
        box(-500, 500, faceBoxY0 - 3, 500, -500, 500)]);
      body.cuts.push(sub(union(core.topCuts), avoid));
    }
    body.seam = faceBoxY0 - 1;                     // opens just behind the face retainer: the front half is the cover
    const voiceBits = [vparts.display ? `${CATALOG[vparts.display].name} face` : 'no face (voice only)', vparts.mic ? CATALOG[vparts.mic].name : 'no mic', vparts.speaker ? 'speaker' : 'no speaker'];
    b.check({ id: 'voice_core', label: 'Voice core', status: face || !bodyL.length ? 'pass' : 'fail',
      detail: `Sled ${coreL.sledW.toFixed(0)} × ${coreL.D.toFixed(0)} mm, ${coreL.H.toFixed(0)} mm tall at the rear of the body: ${CATALOG[vparts.board].name}${coreL.hats.length ? ` + ${coreL.hats.map(h => CATALOG[h.id].name).join(' + ')}` : ''} on the shelf, ${coreL.l0.map(i => CATALOG[i.id].name).join(', ') || 'nothing'} on the deck; rear I/O window ${(core.window.x1 - core.window.x0).toFixed(0)} × ${(core.window.z1 - core.window.z0).toFixed(0)} mm. Front block: ${voiceBits.join(', ')}.` });
  }

  // ---------------------------------------------------------------- features and LED eyes
  let eyes = 0;
  comp.features.forEach(f => {
    const owner = owners.get(f.parent) ?? body;
    const c = plus(centre(owner.shapeBox), f.at);
    if (f.shape === 'led') {
      if (eyes >= Math.min(6, P.leds - ledsUsed)) return;
      // seat the eye on the real front surface (eye domes included), not on the bounding box: probe along y
      const probe = union(owner.adds).intersect(cylY(c[0], c[2], 3, owner.shapeBox.min[1] - 1, owner.shapeBox.max[1] + 60, 16));
      const front = probe.isEmpty() ? owner.shapeBox.max[1] : bb(probe).max[1];
      const e: Vec3 = [c[0], front + 0.5, c[2]];
      owner.adds.push(cylY(e[0], e[2], 5.5, e[1] - 9, e[1], 24));
      owner.cuts.push(ledPocketCuts(e, 'y', 4));
      b.comp({ key: `led_eye${eyes}`, catalogId: 'B-KB003', label: `Eye LED ${eyes + 1}`, link: owner.link, solid: ledSolid(e, 'y'), color: '#f6f6f6' });
      owner.seam = Math.min(owner.seam ?? Infinity, e[1] - 12);   // the LED goes in from behind: open the shape there
      eyes++;
      return;
    }
    // a hole: the shape is cut out of the parent where it is (a cable hole, vent, slot), never added
    if (f.cut) { owner.cuts.push(shapeSolid(f.shape, c, f.size)); return; }
    // a feature placed clear of its parent is pulled in along its offset until it touches (≥ 20 mm³ overlap)
    const kind = f.shape;
    const at = (t: number) => plus(centre(owner.shapeBox), times(f.at, t));
    const touches = (t: number) => shapeSolid(kind, at(t), f.size).intersect(owner.shape).volume() >= 20;
    let t = 1;
    if (!touches(1)) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (touches(m)) lo = m; else hi = m; }
      t = lo;
    }
    // features clear the face's key plungers and retainers on their link (e.g. ear cones beside a head screen)
    const faceParts = b.parts.filter(p => p.link === owner.link && /^(key_plunger|claw_retainer|face_retainer)/.test(p.id)).map(p => p.solid);
    // (a visor, frame or hat brim in front of a screen, mic or speaker is cut back to leave them clear)
    const solid = sub(shapeSolid(f.shape, at(t), f.size), ...faceParts, ...views, ...(keepout && owner === body ? [keepout] : []));
    (f.color === 'accent' ? owner.accents : owner.adds).push(solid);
  });

  // ---------------------------------------------------------------- open shells for electronics
  // A shape that holds electronics (the Claw face, LED eyes) is printed as a 2.4 mm shell split at its seam (y): the
  // half on the neck / horn stays, the other half is a cover held by two Ø10×2 magnet pairs, so parts go in from inside.
  const comps = (o: Owner) => links.filter(l => (owners.get(l.j.parent) ?? body) === o).map(l => b.comps.find(k => k.key === `servo_${l.j.name}`)!.solid);
  const openShell = (o: Owner, servos: M[]) => {
    const fail = (why: string) => {
      b.check({ id: `open_${o.link}_${o.name}`, label: `Access: ${o.name.toLowerCase()}`, status: 'fail', detail: `The electronics in the ${o.name.toLowerCase()} can't be fitted: ${why}. Make the shape a simple solid (box, sphere, egg, capsule, cylinder) at least 30 mm in every direction, or move joints away from its middle.` });
      return null;
    };
    const g = o.gen;
    if (!g) return fail('a free shape can\'t be hollowed');
    if (g.size.some(v => v < 2 * WALL + 16)) return fail('it is too small to hollow');
    // any shape: inset by the wall (an even shell on convex and concave shapes alike, never through the wall)
    const outer = g.solid ?? shapeSolid(g.kind, g.c, g.size);
    const inner = erode(outer, WALL);
    if (inner.volume() < 0.12 * outer.volume()) return fail(`a ${g.kind} this size is mostly wall (thin points or edges) and leaves no room inside`);
    const sb = o.shapeBox;
    // the neck stub / horn hub always stays with the fixed half (the cover gets a notch round it and still lifts off along y)
    const a = o.anchor, ax = o.anchorAxis, len = o === body ? neckTop - deckTop + 2 : HORN_SEAT + 7;
    const hubZone = o === body && standalone ? null : o === body ? union([cylZ(a[0], a[1], 11, a[2] - 2, a[2] + len, 40), box(a[0] - 13, a[0] + 13, a[1] - 17, a[1] + 17, a[2] - 1, a[2] + 4)])   // neck + flange
      : ax[2] ? cylZ(a[0], a[1], 21, ...[a[2] - 2 * ax[2], a[2] + ax[2] * len].sort((p, q) => p - q) as [number, number], 40)
      : ax[0] ? cylX(a[1], a[2], 21, ...[a[0] - 2 * ax[0], a[0] + ax[0] * len].sort((p, q) => p - q) as [number, number], 40) : null;
    const blocks = (y: number) => (!hubZone && !(o === body && standalone) && Math.abs(y - a[1]) < 21) || servos.some(m => { const q = bb(m); return q.min[1] - 1 < y && q.max[1] + 1 > y; });
    // hollow the shape itself (housings, neck stub, features and the face frame stay solid)
    const shell = sub(o.shape, inner);
    // the way in and out of the sled and of each board, battery and module: their footprint swept along y through the
    // shape, so no magnet boss sits in the path of a part being slid in or out (src/cad/fitcheck.ts checks it)
    const onLink = b.comps.filter(k => k.link === o.link && INSERTED.has(CATALOG[k.catalogId]?.kind ?? '')).map(k => bb(k.solid));
    const lanes = (o.keep ?? []).map(m => {
      const q = bb(m);
      // with the boards and HATs that ride on it (they stand taller than the sled)
      for (const c of onLink) if ([0, 1].every(k => c.min[k] < q.max[k] && q.min[k] < c.max[k]))
        for (let k = 0; k < 3; k++) { q.min[k] = Math.min(q.min[k], c.min[k]); q.max[k] = Math.max(q.max[k], c.max[k]); }
      return box(q.min[0] - 0.6, q.max[0] + 0.6, sb.min[1] - 1, sb.max[1] + 1, q.min[2] - 0.6, q.max[2] + 0.6);
    });
    const keepOut = union([...o.cuts, ...servos, ...(hubZone ? [hubZone] : []), ...(o.keep ?? []), ...lanes, ...b.comps.filter(k => k.link === o.link && !k.key.startsWith('horn')).map(k => k.solid)]);
    // two magnet bosses on the inner wall at the seam, clear of every cut, servo, the hub and the module; the seam steps
    // back (away from the face) until they fit
    // the Ø13 boss; set further in (second pass) it gets a rib out to the wall at the band's edge
    const ribs = new Map<string, [number, number]>();
    const magnetBoss = (x: number, z: number, s: number, edge: [number, number] | null) => {
      const boss = cylY(x, z, 6.5, s - 4, s + 4, 24);
      if (!edge) return boss.intersect(o.shape);
      const left = x - edge[0] < edge[1] - x;
      ribs.set(`${x.toFixed(2)}_${z.toFixed(2)}`, edge);
      return union([boss, left ? box(edge[0] - 1, x, s - 4, s + 4, z - 3, z + 3) : box(x, edge[1] + 1, s - 4, s + 4, z - 3, z + 3)]).intersect(o.shape);
    };
    const magnetsAt = (s: number, insets = [8.5]) => {
      const slab = shell.intersect(box(sb.min[0] - 1, sb.max[0] + 1, s - 0.5, s + 0.5, sb.min[2] - 1, sb.max[2] + 1));
      const spots: Vec3[] = [];
      for (const dz of [0, 0.15, -0.15, 0.3, -0.3, 0.4, -0.4]) {
        const z = g.c[2] + dz * g.size[2];
        const band = slab.intersect(box(sb.min[0] - 1, sb.max[0] + 1, s - 1, s + 1, z - 3, z + 3));
        if (band.isEmpty()) continue;
        const q = bb(band);
        for (const x of insets.flatMap(i => [q.min[0] + i, q.max[0] - i])) {          // in from the band's widest point; the Ø13 boss still reaches the wall
          const boss = magnetBoss(x, z, s, insets.length > 1 ? [q.min[0], q.max[0]] : null);
          const buried = cylY(x, z, 5.8, s - 3, s + 3, 24).subtract(o.shape).volume() < 0.05;   // magnet + 0.8 mm skin inside the shape
          if (buried && boss.intersect(keepOut).isEmpty() && spots.every(p => Math.hypot(p[0] - x, p[2] - z) > 16)) spots.push([x, s, z]);
        }
        if (spots.length >= 2) return spots;
      }
      return null;
    };
    let s = o.seam!, spots: Vec3[] | null = null;
    for (; s > sb.min[1] + 6; s -= 2) if (!blocks(s) && (spots = magnetsAt(s))) break;
    // steep side walls (prisms, wide bodies): a second pass sets the magnets further in from the wall
    if (!spots) for (s = o.seam!; s > sb.min[1] + 6; s -= 2) if (!blocks(s) && (spots = magnetsAt(s, [8.5, 11, 14, 18]))) break;
    if (!spots) return fail('no seam plane clear of its servos and neck / hub with room for the two magnets');
    // Each board, module and battery on the fixed half slides out toward the cover: where the shell's own wall stands
    // in its path (a Claw module whose frame stands taller than the body), a slot opens in the wall up to the seam.
    const coverFwd = o.anchor[1] < s;
    const slots = b.comps.filter(k => k.link === o.link && INSERTED.has(CATALOG[k.catalogId]?.kind ?? '')).map(k => bb(k.solid))
      .filter(q => (coverFwd ? q.max[1] < s + 1 : q.min[1] > s - 1))
      .map(q => box(q.min[0] - 0.6, q.max[0] + 0.6, coverFwd ? q.max[1] - 0.3 : s - 1, coverFwd ? s + 1 : q.min[1] + 0.3, q.min[2] - 0.6, q.max[2] + 0.6));
    const slotted = slots.length ? sub(shell, ...slots) : shell;
    o.adds = o.adds.map(m => (m === o.shape ? slotted : m));
    for (const [x, , z] of spots.slice(0, 2)) {
      o.adds.push(magnetBoss(x, z, s, ribs.get(`${x.toFixed(2)}_${z.toFixed(2)}`) ?? null));
      o.cuts.push(cylY(x, z, 5.1, s - 2.2, s + 2.2, 24));
      for (const d of [-1, 1]) b.comp({ key: `magnet_${o.link}_${x.toFixed(0)}_${d}`, catalogId: 'MAG-N52-10X2', label: 'Cover magnet Ø10×2', link: o.link,
        solid: cylY(x, z, 5, d > 0 ? s + 0.1 : s - 2.1, d > 0 ? s + 2.1 : s - 0.1, 24), color: '#9ca3af' });
    }
    let front = box(sb.min[0] - 50, sb.max[0] + 50, s, sb.max[1] + 60, sb.min[2] - 50, sb.max[2] + 50);
    let back = box(sb.min[0] - 50, sb.max[0] + 50, sb.min[1] - 60, s, sb.min[2] - 50, sb.max[2] + 50);
    const coverFront = o.anchor[1] < s;
    if (hubZone) { if (coverFront) { back = union([back, hubZone]); front = sub(front, hubZone); } else { front = union([front, hubZone]); back = sub(back, hubZone); } }
    b.step(`Open the ${o.name.toLowerCase()}: pull the ${coverFront ? 'front' : 'rear'} cover off the seam (two magnet pairs; glue the four Ø10×2 magnets into their pockets first, poles attracting). Fit the electronics from inside, run their leads ${o === body && voice ? 'to the core sled' : `down ${o === body ? 'the neck' : 'the hub'}`}, and press the cover back on.`);
    b.check({ id: `open_${o.link}_${o.name}`, label: `Access: ${o.name.toLowerCase()}`, status: 'pass',
      detail: `Hollow 2.4 mm shell split at y = ${s.toFixed(0)} mm; the ${coverFront ? 'front' : 'rear'} half is a magnet-held cover, so the electronics go in from inside.` });
    return { keepSide: coverFront ? back : front, coverSide: coverFront ? front : back, coverFront, seam: s };
  };

  // ---------------------------------------------------------------- cable ports across the joints
  // A member that carries anything wired (a face display, LED eyes, the next joint's servo) gets its cable across the
  // joint: a Ø7 channel from inside the parent out through its wall beside the servo housing, a service loop round the
  // horn, and a Ø7 channel in through the member's hub to the member's middle (where its servo leads already run).
  const wiredOn = (link: string): boolean => b.comps.some(k => k.link === link && WIRED.has(CATALOG[k.catalogId]?.kind ?? ''))
    || links.some(l => l.j.parent === link && wiredOn(l.j.name));
  // beside the housing, just outside the member's Ø38 hub and the cleared horn zone, so the hole is open and in sight
  const lat = 26;
  // the parent side of a joint's cable: the wall point beside the housing and a point inside, below the housing (at
  // most half way through a slim parent, so the channel stays inside it)
  // Beside the housing on the first side where that point lies within the parent (a slim member has no room
  // beside its housing's width, only beyond its ends).
  const hulls = new Map<Owner, M>();
  const within = (o: Owner, q: Vec3) => {
    if (!hulls.has(o)) hulls.set(o, hull([o.shape]));
    return hulls.get(o)!.intersect(box(q[0] - 1, q[0] + 1, q[1] - 1, q[1] + 1, q[2] - 1, q[2] + 1)).volume() > 1;
  };
  const sides = new Map<(typeof links)[number], { pp: Vec3; depth: number; pDeep: Vec3; inside: boolean }>();
  const sideOf = (l: (typeof links)[number], from?: Vec3) => {
    if (sides.has(l)) return sides.get(l)!;
    const { R, origin: p, axis: n, parent } = l;
    const i = n.findIndex(v => v !== 0), sb = parent.shapeBox;
    const at = (off: Vec3) => {
      const pp = plus(p, off);
      const avail = n[i] > 0 ? pp[i] - sb.min[i] : sb.max[i] - pp[i];
      const depth = Math.min(SV.below + 6, Math.max(3, avail / 2));
      return { pp, depth, pDeep: plus(pp, times(n, -depth)), inside: true };
    };
    const tries = [times(R[1], lat), times(R[1], -lat), times(R[0], EAR_X1 + 7.5), times(R[0], EAR_X0 - 7.5)].map(at);
    // coming from the parent member's hub (`from`): a channel that misses this joint's own servo
    const servo = b.comps.find(k => k.key === `servo_${l.j.name}`)?.solid;
    const clear = (c: (typeof tries)[number]) => !from || !servo || hull([sphere(from, 3.5, 12), sphere(c.pDeep, 3.5, 12)]).intersect(servo).isEmpty();
    // no channel past the servo (a slim member mostly servo): the lead is clipped along the outside instead
    const s = tries.find(c => within(parent, c.pDeep) && clear(c)) ?? { ...(tries.find(c => within(parent, c.pDeep)) ?? tries[0]), inside: !from };
    sides.set(l, s);
    return s;
  };
  const outside = new Map<(typeof links)[number], Vec3>();
  for (const l of links) {
    // anything wired on the member (or beyond it); a head, face or neck always (its screen / eyes / sensors come later)
    if (!wiredOn(l.j.name) && !/head|face|eye|neck/i.test(l.j.name)) continue;
    const { origin: p, axis: n, parent, owner } = l;
    const pc = centre(parent.shapeBox), mc = centre(owner.shapeBox);
    const { pp, pDeep, depth } = sideOf(l);
    const off = plus(pp, times(p, -1)), offLen = Math.hypot(...off);
    const mp = plus(plus(p, times(n, HORN_SEAT - 0.5)), times(off, Math.min(15, offLen) / offLen));
    parent.cuts.push(hull([sphere(plus(pp, times(n, 1.5)), 3.5, 16), sphere(pDeep, 3.5, 16)]), hull([sphere(pDeep, 3.5, 16), sphere(pc, 3.5, 16)]));
    // in the member: to its middle, or straight to the leads of the servos mounted on it (they can fill a slim member's middle)
    const kids = links.filter(k => k.parent === owner);
    const ends = kids.length ? kids.flatMap(k => { const s = sideOf(k, mp); if (!s.inside) outside.set(k, mp); return s.inside ? [k.lead, s.pDeep] : [k.lead]; }) : [mc];
    owner.cuts.push(...ends.map(e => hull([sphere(mp, 3.5, 16), sphere(e, 3.5, 16)])));
    // the port end in the parent: where the channel enters its wall (the face point can lie off a round shape)
    let pa = pp;
    for (let t = 0; t <= depth; t += 1) {
      const q = plus(pp, times(n, -t));
      if (parent.shape.intersect(box(q[0] - 1, q[0] + 1, q[1] - 1, q[1] + 1, q[2] - 1, q[2] + 1)).volume() > 1) { pa = q; break; }
    }
    b.cablePort(pa, mp, `${l.j.name} joint`);
    const hub = outside.get(l);
    if (hub) {
      b.cablePort(hub, pa, `${l.j.name} lead clipped along the ${parent.name.toLowerCase()}`);
      b.step(`Clip the ${l.j.name} servo lead (and anything wired beyond it) along the outside of the ${parent.name.toLowerCase()} with a service loop at each joint: the ${parent.name.toLowerCase()} is too slim for an inner channel.`);
    }
  }

  // Cable windows out of the neck just above the flange (on a base): the body's leads cross the deck to the board
  // instead of dropping onto the battery strap / servo board under the neck hole. Both sides along x or y, whichever
  // the body's features (hips, a back pack) leave open; one side if only one is.
  if (!standalone) {
    const wz = deckTop + 6.5, feats = body.adds.slice(3).concat(body.accents), stuff = feats.length ? union(feats) : null;
    const open = (dx: number, dy: number) => !stuff || stuff.intersect(box(nx + dx * 15 - 5, nx + dx * 15 + 5, ny + dy * 15 - 5, ny + dy * 15 + 5, wz - 5, wz + 5)).isEmpty();
    const ends = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => open(dx, dy));
    const pick = (ends.some(e => e[0] === 1) && ends.some(e => e[0] === -1)) ? ends.filter(e => e[0] !== 0)
      : (ends.some(e => e[1] === 1) && ends.some(e => e[1] === -1)) ? ends.filter(e => e[1] !== 0) : ends.slice(0, 1);
    for (const [dx, dy] of pick.length ? pick : [[1, 0], [-1, 0]])
      body.cuts.push(dx ? cylX(ny, wz, 3.5, ...(dx > 0 ? [nx, nx + 15] : [nx - 15, nx]) as [number, number], 20)
        : cylY(nx, wz, 3.5, ...(dy > 0 ? [ny, ny + 15] : [ny - 15, ny]) as [number, number], 20));
  }

  // ---------------------------------------------------------------- parts
  for (const o of owners.values()) {
    const isBody = o === body;
    const opened = o.seam !== undefined ? openShell(o, comps(o)) : null;
    const solid = sub(union(o.adds), ...o.cuts);
    const id = isBody ? 'body' : `member_${o.link}`;
    // a body on a neck over a base tub lifts off with the deck it is screwed to: it only walls in what is inside it
    const liftOff = isBody && !standalone ? b.comps.slice(baseComps).filter(k => k.link === o.link).map(k => k.key) : undefined;
    const printNote = isBody ? 'Flange down; enable supports under the body and the servo housings.' : 'Hub face down; supports under overhanging shapes.';
    if (opened) {
      // the half on the neck / horn stays; the other half is a cover held by two magnet pairs
      // Slivers the seam cuts off (a feature's tip; < 1.5 % of the cover) that rest on the fixed half join it, so the
      // cover prints as one piece. Bigger detached bits (a feature cut free by an opening) stay with the cover: merged
      // into the fixed half they could wall in the electronics behind them.
      // Every stray piece of either half joins the half whose main piece it touches.
      // (zero-volume crumbs a wavy shell leaves at the seam are dropped: merged back, hundreds of them blow the mesh up)
      const byVol = (ms: M[]) => ms.filter(p => p.volume() > 0.5).sort((p, q) => q.volume() - p.volume());
      const kp = byVol(solid.intersect(opened.keepSide).decompose()), cp = byVol(solid.intersect(opened.coverSide).decompose());
      const mainK = kp[0], mainC = cp[0];
      const toKeep: M[] = [mainK], toCover: M[] = [mainC];
      // minGap caps its answer at the search length: search a hair further, then compare (≤ 0.8 mm touches)
      for (const p of [...kp.slice(1), ...cp.slice(1)]) {
        const touchK = p.minGap(mainK, 0.85) <= 0.8, touchC = p.minGap(mainC, 0.85) <= 0.8;
        const sliver = p.volume() < 0.015 * mainC.volume();
        if (!touchK && !touchC && p.volume() < 150) continue;    // a crumb of a feature an opening cut free (e.g. a beak tip in front of a screen)
        (touchK && (sliver || !touchC) ? toKeep : touchC ? toCover : kp.includes(p) ? toKeep : toCover).push(p);
      }
      const cover = union(toCover), keep = union(toKeep);
      b.part({ id, name: o.name, link: o.link, material: spec.structural, profile: isBody ? 'chassis' : 'cantilever',
        color: isBody ? spec.primaryColor : spec.accentColor, solid: keep, printRot: [0, 0, 0], printNote, liftOff });
      b.part({ id: `${id}_cover`, name: `${o.name} cover`, link: o.link, material: spec.shell, profile: 'shell',
        color: isBody ? spec.primaryColor : spec.accentColor, solid: cover, printRot: opened.coverFront ? [90, 0, 0] : [-90, 0, 0],   // seam (its -y / +y face) on the bed
        printNote: 'Seam face down on the bed; supports inside the dome. Two magnets hold it on.' });
      b.allowContact(o.name, `${o.name} cover`);
    } else b.part({
      id, name: o.name, link: o.link, material: spec.structural,
      profile: isBody ? 'chassis' : 'cantilever', color: isBody ? spec.primaryColor : spec.accentColor, solid,
      printRot: [0, 0, 0], printNote, liftOff,
    });
    // decorative accents also clear the face's key plungers and retainers on this link (a face disc over the screen)
    const faceParts = b.parts.filter(p => p.link === o.link && /^(key_plunger|claw_retainer|face_retainer)/.test(p.id)).map(p => p.solid);
    const accent = o.accents.length ? sub(union(o.accents), ...o.cuts, ...faceParts) : null;
    // on an opening shape the accents split at the same seam, so none glues the cover shut
    const pieces = !accent ? [] : opened
      ? [{ solid: accent.intersect(opened.keepSide), on: o.name, tag: '' }, { solid: accent.intersect(opened.coverSide), on: `${o.name} cover`, tag: ' (cover)' }]
      : [{ solid: accent, on: o.name, tag: '' }];
    pieces.filter(p => p.solid.volume() > 1).forEach((p, k) => {    // a feature the horn clearance removed completely is dropped
      const accentName = `${o.name} accents${p.tag}`;
      b.part({ id: `${id}_accent${k ? '_cover' : ''}`, name: accentName, link: o.link, material: spec.shell, profile: 'shell',
        color: isBody ? spec.accentColor : spec.primaryColor, solid: p.solid, printRot: [0, 0, 0],
        printNote: 'Glue onto its parent (CA), or print in place with a filament change.' });
      b.allowContact(p.on, accentName);
    });
  }

  // ---------------------------------------------------------------- links
  finishBase(eyes, bodyBox);
  links.forEach(({ j, owner, origin, axis }, idx) => {
    const memberBox = bb(union(owner.adds));
    b.link({
      id: j.name, name: j.name.replace(/_/g, ' '), parent: j.parent === 'body' ? 'base' : j.parent,
      joint: {
        origin, axis, ...(j.kind === 'swing' ? { limit: j.range } : {}),
        // continuous joints answer the shared `spin` drive channel (viewer, simulator and firmware drive[0])
        actuator: j.kind === 'spin'
          ? { kind: 'cservo', catalogId: spinId, port: `S${idx + 1 + portOffset}`, label: 'spin' }
          : { kind: 'servo', catalogId: servoId, port: `S${idx + 1 + portOffset}`, label: j.name },
      },
      colliders: [boxCollider(memberBox, 0.8)],
    });
  });
  if (drive) {
    // the drive plate and skid belong to the base; then the whole robot goes up onto its wheels (ground at z = 0)
    b.links.find(l => l.id === 'base')?.colliders.push(...drive.colliders);
    b.meta = { ...b.meta, wheelR: drive.wheelR, trackMm: drive.track, support: drive.support };
  }
  if (legsOut) {
    // the feet reach under the whole robot's centre of mass (printed parts at ~0.6 g/cm³ as printed, components at their mass)
    let m = 0, my = 0, mz = 0;
    const add = (g: number, q: Box3) => { m += g; my += g * (q.min[1] + q.max[1]) / 2; mz += g * (q.min[2] + q.max[2]) / 2; };
    for (const p of b.parts) add(p.solid.volume() * 0.0006, bb(p.solid));
    for (const c of b.comps) add(CATALOG[c.catalogId]?.massG ?? 1, bb(c.solid));
    if (m > 0) legsOut.fitFeet(my / m, mz / m);
    // Walking balance: leaning 15° on its ankles, each ankle servo holds half the robot's weight times the height of its
    // centre of mass. A top-heavy robot (a big head high on a neck) saturates micro servos and rocks over.
    const h = mz / m + legsOut.lift, tq = (CATALOG[servoId]?.data as { torqueNm?: number } | undefined)?.torqueNm ?? 0.12;
    const need = (m / 1000) * 9.81 * (h / 1000) * Math.sin((15 * Math.PI) / 180) / 2, share = need / tq;
    b.check({ id: 'walk_balance', label: 'Walking balance', status: share > 0.45 ? 'warn' : 'pass',
      detail: `${m.toFixed(0)} g with its centre of mass ${h.toFixed(0)} mm above the floor: a 15° lean puts ${(need * 1000 / 9.81 * 100).toFixed(0)} g·cm on each ankle, ${(share * 100).toFixed(0)} % of the ${servoId} servo's ${(tq * 1000 / 9.81 * 100).toFixed(0)} g·cm.${share > 0.45 ? ' Too top-heavy for micro servos to walk steadily (it rocks and tips): make the head smaller or lower (shorter neck, lower standH), or put the screen on the body.' : ''}` });
    legsOut.addLinks();
    b.meta = { ...b.meta, support: legsOut.support };
  }
  const lift = drive?.lift ?? legsOut?.lift ?? 0;
  if (lift) {
    // the whole robot goes up onto its wheels / feet (ground at z = 0)
    const up = (v: Vec3): Vec3 => [v[0], v[1], v[2] + lift];
    for (const p of b.parts) p.solid = p.solid.translate([0, 0, lift]);
    for (const c of b.comps) c.solid = c.solid.translate([0, 0, lift]);
    for (const p of b.cablePorts) { p.a = up(p.a); p.b = up(p.b); }
    b.cableways = b.cableways.map(m => m.translate([0, 0, lift]));
    for (const l of b.links) {
      if (l.joint) l.joint.origin = up(l.joint.origin);
      l.colliders = l.colliders.map(c => ({ ...c, center: up(c.center) }));
    }
  }

  b.check({ id: 'composition', label: 'Free-form composition', status: 'pass',
    detail: `${comp.body.shape} body ${bw}×${bd}×${bh} mm ${standalone ? 'standing on its own flat bottom (no base)' : `on a ${Math.max(0, neckBase - deckTop - 3).toFixed(0)} mm neck`}${wheels ? ' on the rover chassis (body carved around the chassis and wheels)' : ''}; ${joints.length} joint(s): ${joints.map((j, i) => `${j.name} (${j.kind}, S${i + 1 + portOffset}, ${j.face} of ${j.parent})`).join(', ') || 'none'}; ${comp.features.length} feature(s).` });
  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass',
    detail: 'Every servo sits in an open housing with its ears on the outer face; each horn centre screw is driven through a Ø6.5 tunnel along the shaft.' });
  if (vparts) {
    b.extra('Rubber feet Ø8 (optional)', 4);
    if (vparts.battery && CATALOG[vparts.battery]?.kind === 'battery' && vparts.battery !== 'UPS-HAT-PI') b.extra('Hook-and-loop battery strap 10 mm', 1);
    if (joints.length) {
      b.screw('M2×8 self-tap', 2 * joints.length, 'servo ears to their housings');
      b.screw('M2×6 self-tap', 2 * joints.length, 'horn arms to the member hubs');
    }
    b.step(`1. Core sled: screw the ${CATALOG[vparts.board].name} to the shelf standoffs${coreL!.hats.length ? `, stack ${coreL!.hats.map(h => CATALOG[h.id].name).join(' then ')} on the 40-pin header` : ''}, and fit ${coreL!.l0.map(i => CATALOG[i.id].name).join(', ') || 'nothing'} on the deck (strap the battery). Route the leads through the shelf pass-through.`);
    b.step('2. Face: push the display, mic and speaker into their pockets in the front cover from behind and screw the face retainer on (2 × M2×6); their cables leave through the retainer windows.');
    b.step('3. Slide the sled into the body from the front (ports into the rear I/O window) and screw it from below (2 × M3×10).');
    joints.forEach((j, i) => b.step(`${4 + i}. ${j.name}: push the ${j.kind === 'spin' ? spinId : servoId} servo into its housing on the ${j.face} face of the ${j.parent}, screw the ears, run the lead inside to servo channel ${i} on the ${vparts.servoBoard ? CATALOG[vparts.servoBoard].name : 'servo board'}, centre it (\`calib\`), then fit the horn into the member hub and drive the centre screw through the Ø6.5 tunnel.`));
    b.step(`${4 + joints.length}. Plug the face cables into the board, press the front cover onto its magnets.`);
    if (drive) b.step(`${5 + joints.length}. ${drive.step}`);
    return;
  }
  if (standalone) {
    b.extra('Rubber feet Ø8 (optional)', 3);
    b.step('1. Charge the Claw module (USB-C), fit it in the face and close the cover. The charging cable can stay plugged in through the slot at the back.');
    return;
  }
  b.screw('M3×10 + nut', 3, 'neck flange to the deck');
  b.screw('M2×8 self-tap', 2 * joints.length, 'servo ears to their housings');
  b.screw('M2×6 self-tap', 2 * joints.length, 'horn arms to the member hubs');
  const s0 = wheels ? 8 : 3;
  b.step(`${s0}. Bolt the body flange to the deck (3 × M3×10, nuts under the deck) and feed the servo leads down the neck.`);
  joints.forEach((j, i) => b.step(`${s0 + 1 + i}. ${j.name}: push the ${j.kind === 'spin' ? 'continuous B-PG002' : 'B-PG001'} servo into its housing on the ${j.face} face of the ${j.parent}, screw the ears, centre it (\`calib\`), then fit the horn into the member hub and drive the centre screw through the Ø6.5 tunnel.`));
}
