// Forward kinematics over the link tree (joint angles in degrees, positions in mm, world frame).

import { Matrix4, Vector3 } from 'three';
import type { LinkDef, Vec3 } from '../cad/types';

export type Angles = Record<string, number>;

/** Links sorted parent-first. */
export function ordered(links: LinkDef[]): LinkDef[] {
  const out: LinkDef[] = [];
  const left = [...links];
  while (left.length) {
    const i = left.findIndex(l => !l.parent || out.some(o => o.id === l.parent));
    if (i < 0) throw new Error('link tree has a cycle or a missing parent');
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

/** World transform of every link relative to its zero pose. Continuous joints (wheels) are included. */
export function fk(links: LinkDef[], angles: Angles, rootPose = new Matrix4()): Map<string, Matrix4> {
  const T = new Map<string, Matrix4>();
  for (const l of ordered(links)) {
    const parent = l.parent ? T.get(l.parent)! : rootPose;
    if (!l.joint) { T.set(l.id, parent.clone()); continue; }
    const v = angles[l.id] ?? 0;
    const ax = new Vector3(...l.joint.axis).normalize();
    if (l.joint.type === 'prismatic') {
      // value is travel in mm along the axis
      T.set(l.id, parent.clone().multiply(new Matrix4().makeTranslation(ax.x * v, ax.y * v, ax.z * v)));
      continue;
    }
    const a = (v * Math.PI) / 180;
    const o = new Vector3(...l.joint.origin);
    const local = new Matrix4().makeTranslation(o.x, o.y, o.z)
      .multiply(new Matrix4().makeRotationAxis(ax, a))
      .multiply(new Matrix4().makeTranslation(-o.x, -o.y, -o.z));
    T.set(l.id, parent.clone().multiply(local));
  }
  return T;
}

export const apply = (m: Matrix4, p: Vec3): Vec3 => {
  const v = new Vector3(...p).applyMatrix4(m);
  return [v.x, v.y, v.z];
};

/** Descendants of a link, including itself. */
export function subtree(links: LinkDef[], id: string): string[] {
  const out = [id];
  for (const l of ordered(links)) if (l.parent && out.includes(l.parent) && !out.includes(l.id)) out.push(l.id);
  return out;
}

/**
 * Gravity torque (N·m) about a joint's axis for the given pose, with an optional payload (g) at `tip`.
 * For a prismatic joint this is the torque on the driving pinion: axial gravity force × pinion radius.
 */
export function gravityTorque(links: LinkDef[], jointLink: string, angles: Angles, payload?: { link: string; at: Vec3; g: number }): number {
  const T = fk(links, angles);
  const l = links.find(x => x.id === jointLink)!;
  const j = l.joint!;
  const o = new Vector3(...apply(T.get(l.parent!)!, j.origin));
  const axis = new Vector3(...j.axis).transformDirection(T.get(l.parent!)!);
  const ids = subtree(links, jointLink);
  if (j.type === 'prismatic') {
    let g = ids.reduce((s, id) => s + links.find(x => x.id === id)!.massG, 0);
    if (payload && ids.includes(payload.link)) g += payload.g;
    return -9.81 * (g / 1000) * axis.z * ((j.pinionR ?? 10) / 1000);
  }
  const tau = new Vector3();
  const add = (gram: number, p: Vec3) => {
    const r = new Vector3(...p).sub(o).multiplyScalar(0.001);
    tau.add(r.cross(new Vector3(0, 0, -9.81 * gram / 1000)));
  };
  for (const id of ids) {
    const li = links.find(x => x.id === id)!;
    add(li.massG, apply(T.get(id)!, li.com));
  }
  if (payload && ids.includes(payload.link)) add(payload.g, apply(T.get(payload.link)!, payload.at));
  return tau.dot(axis);
}
