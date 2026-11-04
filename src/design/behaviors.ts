// Behaviour scripts as keyframes. The same keyframes drive the simulator and are written into the
// generated firmware, so what you see in the sim is what the robot runs.

import { hasWord, linearTravel, mechanismFamily, type RobotSpec } from './spec';

export interface Key {
  t: number;                              // seconds from the start
  joints?: Record<string, number>;        // positional servo targets, degrees
  drive?: [number, number];               // left/right wheel command, -1..1
  color?: [number, number, number];       // LED colour 0..255
}

export interface Behavior { id: string; label: string; keys: Key[]; loop: boolean }

const seq = (steps: { dt: number; k: Omit<Key, 't'> }[]): Key[] => {
  let t = 0;
  return steps.map(s => { t += s.dt; return { t, ...s.k }; });
};

/** Every behaviour id this module can generate. */
const ALL_BEHAVIOR_IDS = ['square', 'patrol', 'spin', 'look', 'pick', 'wave', 'reach', 'nod', 'shake', 'walk', 'dance', 'bow',
  'listen', 'talk', 'think', 'greet', 'slither', 'coil', 'raise', 'launch', 'tap', 'pulse', 'index', 'slide', 'lift', 'scan', 'draw', 'sweep'];

/**
 * Wheel speed and track are needed to time turns; pass the rover's real numbers. If none of the spec's
 * behaviour ids fit the builder that made the robot (the AI picked ids for another archetype), every
 * behaviour that builder supports is returned instead, so the robot is never left without motions.
 */
/** Each joint's movement range in an assembly (link id -> [lo, hi]), for ehaviorsFor. */
export const jointLimits = (asm: { links: { id: string; joint?: { limit?: [number, number] } }[] }) =>
  Object.fromEntries(asm.links.filter(l => l.joint?.limit).map(l => [l.id, l.joint!.limit!])) as Record<string, [number, number]>;

export function behaviorsFor(spec: RobotSpec, rover?: { trackMm: number; topSpeed: number }, limits?: Record<string, [number, number] | undefined>): Behavior[] {
  const found = behaviorsForIds(spec, rover);
  const out = found.length ? found : behaviorsForIds({ ...spec, behaviors: ALL_BEHAVIOR_IDS }, rover);
  // every keyframe stays inside the range each joint can really move (the movement check narrows a blocked joint)
  if (limits) for (const b of out) for (const key of b.keys) {
    const js = (key as { joints?: Record<string, number> }).joints;
    if (js) for (const [id, v] of Object.entries(js)) { const lim = limits[id]; if (lim) js[id] = Math.max(lim[0], Math.min(lim[1], v)); }
  }
  return out;
}

function behaviorsForIds(spec: RobotSpec, rover?: { trackMm: number; topSpeed: number }): Behavior[] {
  const out: Behavior[] = [];
  const has = (id: string) => spec.behaviors.includes(id);
  const t = (spec.archetype || '').toLowerCase();
  if (spec.composition?.use) {
    if (spec.composition.mobility === 'legs') { const legs = legBehaviors(spec, has); return [...legs, ...composerBehaviors(spec).filter(b => !legs.some(l => l.id === b.id))]; }
    if (spec.composition.mobility !== 'wheels') return composerBehaviors(spec);
    // mobile composition: drive behaviours from the chassis, joint behaviours from the composition ('spin' = spin in place)
    return [...driveBehaviors(spec, rover, has), ...composerBehaviors(spec).filter(b => b.id !== 'spin')];
  }
  const family = t.includes('turntable') ? null : mechanismFamily(t);
  if (family) return mechanismBehaviors(spec, family);
  const isSnake = t.includes('snake') || t.includes('serpent') || t.includes('rắn') || hasWord(t, 'ran') || t.includes('worm');
  const isQuadruped = t.includes('quadruped') || t.includes('dog') || t.includes('chó') || t.includes('puppy') || t.includes('hound') || hasWord(t, 'cat');
  const isBiped = !isQuadruped && (t.includes('humanoid') || t.includes('duck') || t.includes('walker') || t.includes('biped') || t.includes('chicken') || t.includes('bird'));
  const isDeskAgent = t.includes('agent') || t.includes('desk') || t.includes('stationary') || t.includes('stand') || t.includes('xiaozhi') || t.includes('zhaozhi');
  const isTurntable = t.includes('turntable') || t.includes('bàn xoay') || t.includes('platter') || t.includes('rotary_table');

  if (isTurntable) {
    out.push({
      id: 'spin',
      label: 'Continuous 360° Studio Spin',
      loop: true,
      keys: seq([
        { dt: 0, k: { joints: { platter: 0 }, color: [56, 189, 248] } },
        { dt: 1.0, k: { joints: { platter: 90 }, color: [52, 211, 153] } },
        { dt: 1.0, k: { joints: { platter: 180 }, color: [52, 211, 153] } },
        { dt: 1.0, k: { joints: { platter: 270 }, color: [52, 211, 153] } },
        { dt: 1.0, k: { joints: { platter: 360 }, color: [56, 189, 248] } },
      ]),
    });
    out.push({
      id: 'step_scan',
      label: '8-Angle Step & Pause (Photography)',
      loop: true,
      keys: seq([
        { dt: 0, k: { joints: { platter: 0 }, color: [56, 189, 248] as [number, number, number] } },
        ...[45, 90, 135, 180, 225, 270, 315, 360].flatMap(deg => [
          { dt: 0.4, k: { joints: { platter: deg }, color: [245, 158, 11] as [number, number, number] } },
          { dt: 0.8, k: { joints: { platter: deg }, color: [52, 211, 153] as [number, number, number] } },
        ]),
      ]),
    });
    return out;
  }

  if (spec.archetype === 'rover') {
    out.push(...driveBehaviors(spec, rover, has));
    if (has('look') && spec.params.panTilt) out.push(lookAround());
  } else if (spec.archetype === 'companion' || isDeskAgent) {
    if (has('look')) out.push(lookAround());
    if (has('nod')) out.push({ id: 'nod', label: 'Nod yes', loop: false, keys: seq([
      { dt: 0, k: { joints: { pan: 0, tilt: 0 }, color: [0, 255, 80] } },
      ...[0, 1, 2].flatMap(() => [{ dt: 0.25, k: { joints: { tilt: -20 } } }, { dt: 0.25, k: { joints: { tilt: 15 } } }]),
      { dt: 0.3, k: { joints: { tilt: 0 } } },
    ]) });
    if (has('shake')) out.push({ id: 'shake', label: 'Shake no', loop: false, keys: seq([
      { dt: 0, k: { joints: { pan: 0, tilt: 0 }, color: [255, 40, 0] } },
      ...[0, 1, 2].flatMap(() => [{ dt: 0.2, k: { joints: { pan: -30 } } }, { dt: 0.2, k: { joints: { pan: 30 } } }]),
      { dt: 0.3, k: { joints: { pan: 0 } } },
    ]) });
    if (has('listen')) out.push({ id: 'listen', label: 'Listen & attentive nod', loop: true, keys: seq([
      { dt: 0, k: { joints: { pan: 0, tilt: -8 }, color: [0, 210, 255] } },
      { dt: 1.0, k: { joints: { pan: 0, tilt: 6 } } },
      { dt: 0.8, k: { joints: { pan: 0, tilt: -8 }, color: [0, 240, 255] } },
      { dt: 1.2, k: { joints: { pan: 0, tilt: -8 } } },
    ]) });
    if (has('talk')) out.push({ id: 'talk', label: 'Speak with expression', loop: true, keys: seq([
      { dt: 0, k: { joints: { pan: 0, tilt: 0 }, color: [0, 255, 120] } },
      { dt: 0.35, k: { joints: { pan: -12, tilt: -10 } } },
      { dt: 0.4, k: { joints: { pan: 10, tilt: 8 } } },
      { dt: 0.35, k: { joints: { pan: -6, tilt: -6 } } },
      { dt: 0.4, k: { joints: { pan: 8, tilt: 6 } } },
      { dt: 0.35, k: { joints: { pan: 0, tilt: 0 }, color: [0, 255, 120] } },
    ]) });
    if (has('think')) out.push({ id: 'think', label: 'Contemplative head tilt', loop: true, keys: seq([
      { dt: 0, k: { joints: { pan: 0, tilt: 0 }, color: [255, 180, 0] } },
      { dt: 0.8, k: { joints: { pan: 25, tilt: -18 } } },
      { dt: 1.8, k: { joints: { pan: 25, tilt: -18 } } },
      { dt: 0.8, k: { joints: { pan: 0, tilt: 0 }, color: [255, 180, 0] } },
    ]) });
    if (has('greet')) out.push({ id: 'greet', label: 'Greeting scan & chime', loop: false, keys: seq([
      { dt: 0, k: { joints: { pan: 0, tilt: 0 }, color: [255, 80, 200] } },
      { dt: 0.3, k: { joints: { pan: 0, tilt: -20 } } },
      { dt: 0.3, k: { joints: { pan: 0, tilt: 15 } } },
      { dt: 0.4, k: { joints: { pan: -25, tilt: 0 } } },
      { dt: 0.4, k: { joints: { pan: 25, tilt: 0 } } },
      { dt: 0.4, k: { joints: { pan: 0, tilt: 0 }, color: [0, 255, 200] } },
    ]) });
  } else if (isSnake) {
    if (has('slither')) {
      const N = 16;
      const period = 2.0;
      const steps: { dt: number; k: Omit<Key, 't'> }[] = [
        { dt: 0, k: { joints: { segment_1: 0, segment_2: 0, segment_3: 0, tail: 0 }, color: [43, 182, 115] } },
      ];
      for (let s = 1; s <= N; s++) {
        const phi = (s / N) * 2 * Math.PI;
        steps.push({
          dt: period / N,
          k: {
            joints: {
              segment_1: Math.round(26 * Math.sin(phi)),
              segment_2: Math.round(26 * Math.sin(phi - 1.2)),
              segment_3: Math.round(26 * Math.sin(phi - 2.4)),
              tail: Math.round(26 * Math.sin(phi - 3.6)),
            },
            color: [43, 182, 115],
          },
        });
      }
      out.push({ id: 'slither', label: 'Serpentine slither', loop: true, keys: seq(steps) });
    }
    if (has('wave')) out.push({
      id: 'wave', label: 'Lateral wave', loop: true, keys: seq([
        { dt: 0, k: { joints: { segment_1: 0, segment_2: 0, segment_3: 0, tail: 0 }, color: [0, 220, 255] } },
        { dt: 0.4, k: { joints: { segment_1: 28, segment_2: -28, segment_3: 28, tail: -28 } } },
        { dt: 0.4, k: { joints: { segment_1: 0, segment_2: 0, segment_3: 0, tail: 0 } } },
        { dt: 0.4, k: { joints: { segment_1: -28, segment_2: 28, segment_3: -28, tail: 28 } } },
        { dt: 0.4, k: { joints: { segment_1: 0, segment_2: 0, segment_3: 0, tail: 0 } } },
      ]),
    });
    if (has('coil')) out.push({
      id: 'coil', label: 'Coil strike pose', loop: false, keys: seq([
        { dt: 0, k: { joints: { segment_1: 0, segment_2: 0, segment_3: 0, tail: 0 }, color: [43, 182, 115] } },
        { dt: 0.6, k: { joints: { segment_1: -30, segment_2: 30, segment_3: -30, tail: 30 }, color: [255, 180, 0] } },
        { dt: 1.0, k: { joints: { segment_1: -30, segment_2: 30, segment_3: -30, tail: 30 } } },
        { dt: 0.25, k: { joints: { segment_1: 28, segment_2: 0, segment_3: 0, tail: 0 }, color: [255, 40, 40] } },
        { dt: 0.8, k: { joints: { segment_1: 0, segment_2: 0, segment_3: 0, tail: 0 }, color: [43, 182, 115] } },
      ]),
    });
    if (has('look')) out.push({
      id: 'look', label: 'Look around', loop: true, keys: seq([
        { dt: 0, k: { joints: { segment_1: 0, segment_2: 0, segment_3: 0, tail: 0 }, color: [0, 200, 255] } },
        { dt: 0.8, k: { joints: { segment_1: -30, segment_2: -15, segment_3: 0, tail: 0 } } },
        { dt: 1.2, k: { joints: { segment_1: 30, segment_2: 15, segment_3: 0, tail: 0 } } },
        { dt: 0.8, k: { joints: { segment_1: 0, segment_2: 0, segment_3: 0, tail: 0 }, color: [0, 200, 255] } },
      ]),
    });
  } else if (isQuadruped) {
    const mkLegs = (fl: number, fr: number, rl: number, rr: number) => ({
      leg_FL: fl, hip_FL: fl,
      leg_FR: fr, hip_FR: fr,
      leg_RL: rl, hip_RL: rl,
      leg_RR: rr, hip_RR: rr,
    });
    const home = mkLegs(0, 0, 0, 0);
    if (has('walk')) {
      // Quadruped trot walk: diagonal pairs (FL + RR) and (FR + RL) alternate
      out.push({
        id: 'walk',
        label: 'Canine trot walk',
        loop: true,
        keys: seq([
          { dt: 0, k: { joints: home, color: [245, 158, 11] } },
          { dt: 0.35, k: { joints: mkLegs(22, -22, -22, 22) } },
          { dt: 0.35, k: { joints: home } },
          { dt: 0.35, k: { joints: mkLegs(-22, 22, 22, -22) } },
          { dt: 0.35, k: { joints: home } },
        ]),
      });
    }
    if (has('patrol')) {
      out.push({
        id: 'patrol',
        label: 'Patrol terrain',
        loop: true,
        keys: seq([
          { dt: 0, k: { joints: home, color: [59, 130, 246] } },
          { dt: 0.4, k: { joints: mkLegs(16, -16, -16, 16) } },
          { dt: 0.4, k: { joints: mkLegs(-16, 16, 16, -16) } },
          { dt: 0.4, k: { joints: home } },
          { dt: 0.5, k: { joints: mkLegs(24, 24, -12, -12), color: [16, 185, 129] } },
          { dt: 0.5, k: { joints: home } },
        ]),
      });
    }
    if (has('bow')) {
      // Canine play bow: front legs crouch, rear stays high
      out.push({
        id: 'bow',
        label: 'Play bow',
        loop: false,
        keys: seq([
          { dt: 0, k: { joints: home, color: [245, 158, 11] } },
          { dt: 0.5, k: { joints: mkLegs(30, 30, -14, -14), color: [236, 72, 153] } },
          { dt: 1.2, k: { joints: mkLegs(30, 30, -14, -14) } },
          { dt: 0.6, k: { joints: home, color: [16, 185, 129] } },
        ]),
      });
    }
    if (has('look')) {
      out.push({
        id: 'look',
        label: 'Alert look & scan',
        loop: true,
        keys: seq([
          { dt: 0, k: { joints: home, color: [0, 200, 255] } },
          { dt: 0.6, k: { joints: mkLegs(-12, 12, -12, 12) } },
          { dt: 1.0, k: { joints: mkLegs(12, -12, 12, -12) } },
          { dt: 0.6, k: { joints: home, color: [0, 200, 255] } },
        ]),
      });
    }
  } else if (isBiped) {
    const home = { hip_L: 0, hip_R: 0, ankle_L: 0, ankle_R: 0, arm_L: 0, arm_R: 0 };
    if (has('walk')) out.push({ id: 'walk', label: t.includes('duck') ? 'Waddle walk' : 'Bipedal walk', loop: true, keys: seq([
      { dt: 0, k: { joints: home, color: [0, 255, 120] } },
      // 1. Shift weight onto left foot (ankle +8) while holding hips
      { dt: 0.38, k: { joints: { ankle_L: 8, ankle_R: 8, hip_L: 7, hip_R: -7, arm_L: -12, arm_R: 12 } } },
      // 2. Left stance sweeps backward (hip_L: +7 -> -7) while lifted right foot swings forward (hip_R: -7 -> +7)
      { dt: 0.55, k: { joints: { ankle_L: 8, ankle_R: 8, hip_L: -7, hip_R: 7, arm_L: 12, arm_R: -12 } } },
      // 3. Shift weight onto right foot (ankle -8) while holding hips at (-7, +7)
      { dt: 0.38, k: { joints: { ankle_L: -8, ankle_R: -8, hip_L: -7, hip_R: 7, arm_L: 12, arm_R: -12 } } },
      // 4. Right stance sweeps backward (hip_R: +7 -> -7) while lifted left foot swings forward (hip_L: -7 -> +7)
      { dt: 0.55, k: { joints: { ankle_L: -8, ankle_R: -8, hip_L: 7, hip_R: -7, arm_L: -12, arm_R: 12 } } },
    ]) });
    if (has('wave')) out.push({ id: 'wave', label: 'Wave arm', loop: false, keys: seq([
      { dt: 0, k: { joints: home, color: [0, 180, 255] } },
      { dt: 0.65, k: { joints: { arm_R: 60 } } },
      { dt: 0.45, k: { joints: { arm_R: 30 } } },
      { dt: 0.45, k: { joints: { arm_R: 65 } } },
      { dt: 0.45, k: { joints: { arm_R: 30 } } },
      { dt: 0.65, k: { joints: home } },
    ]) });
    if (has('dance')) out.push({ id: 'dance', label: t.includes('duck') ? 'Waddle dance' : 'Shuffle dance', loop: true, keys: seq([
      { dt: 0, k: { joints: home, color: [255, 60, 180] } },
      ...[0, 1, 2].flatMap(() => [
        { dt: 0.55, k: { joints: { ankle_L: -7, ankle_R: -7, hip_L: 3, hip_R: -3, arm_L: 20, arm_R: -20 }, color: [255, 60, 180] as [number, number, number] } },
        { dt: 0.55, k: { joints: { ankle_L: 7, ankle_R: 7, hip_L: -3, hip_R: 3, arm_L: -20, arm_R: 20 }, color: [40, 220, 255] as [number, number, number] } },
      ]),
      { dt: 0.55, k: { joints: home } },
    ]) });
    if (has('bow')) out.push({ id: 'bow', label: t.includes('duck') ? 'Dip beak' : 'Bow', loop: false, keys: seq([
      { dt: 0, k: { joints: home, color: [255, 255, 255] } },
      { dt: 0.6, k: { joints: { hip_L: 12, hip_R: 12, arm_L: -20, arm_R: -20 }, color: [255, 200, 50] } },
      { dt: 0.8, k: { joints: { hip_L: 12, hip_R: 12, arm_L: -20, arm_R: -20 } } },
      { dt: 0.6, k: { joints: home, color: [0, 255, 120] } },
    ]) });
    if (has('look')) out.push({ id: 'look', label: 'Look around', loop: true, keys: seq([
      { dt: 0, k: { joints: home, color: [0, 200, 255] } },
      { dt: 0.8, k: { joints: { hip_L: -8, hip_R: 8, arm_L: 15, arm_R: -15 } } },
      { dt: 1.2, k: { joints: { hip_L: 8, hip_R: -8, arm_L: -15, arm_R: 15 } } },
      { dt: 0.8, k: { joints: home, color: [0, 200, 255] } },
    ]) });
  } else {
    const home = { yaw: 0, upper: 0, fore: 0, grip: 0 };
    if (has('pick')) out.push({ id: 'pick', label: 'Pick and place', loop: true, keys: seq([
      { dt: 0, k: { joints: home, color: [0, 255, 80] } },
      { dt: 0.8, k: { joints: { yaw: -45, grip: 40 } } },
      { dt: 0.8, k: { joints: { upper: -40, fore: -40 }, color: [255, 160, 0] } },
      { dt: 0.9, k: { joints: { grip: 5 }, color: [255, 0, 0] } },
      { dt: 0.6, k: { joints: { upper: -10, fore: 10 } } },
      { dt: 0.8, k: { joints: { yaw: 45 } } },
      { dt: 1.0, k: { joints: { upper: -40, fore: -40 } } },
      { dt: 0.8, k: { joints: { grip: 40 }, color: [0, 255, 80] } },
      { dt: 0.6, k: { joints: { ...home, grip: 40 } } },
      { dt: 0.9, k: { joints: home } },
    ]) });
    if (has('wave')) out.push({ id: 'wave', label: 'Wave', loop: false, keys: seq([
      { dt: 0, k: { joints: home, color: [0, 160, 255] } },
      { dt: 0.6, k: { joints: { upper: 10, fore: 80 } } },
      ...[0, 1, 2].flatMap(() => [{ dt: 0.35, k: { joints: { yaw: -25, grip: 40 } } }, { dt: 0.35, k: { joints: { yaw: 25, grip: 0 } } }]),
      { dt: 0.6, k: { joints: home } },
    ]) });
    if (has('reach')) out.push({ id: 'reach', label: 'Reach test (max torque)', loop: false, keys: seq([
      { dt: 0, k: { joints: home, color: [255, 255, 255] } },
      { dt: 1.0, k: { joints: { upper: -50, fore: 50 }, color: [255, 0, 0] } },
      { dt: 3.0, k: { joints: home, color: [0, 255, 80] } },
    ]) });
  }
  return out;
}

type RGB = [number, number, number];

/** Differential-drive keyframes (rover, mobile compositions); turns are timed from the real track and top speed. */
function driveBehaviors(spec: RobotSpec, rover: { trackMm: number; topSpeed: number } | undefined, has: (id: string) => boolean): Behavior[] {
  const out: Behavior[] = [];
  const v = rover?.topSpeed ?? 0.15, track = (rover?.trackMm ?? 80) / 1000;
  const turn90 = (Math.PI / 2) * (track / 2) / (v * 0.5);   // spin at half speed
  const head = spec.params.panTilt && !spec.composition?.use ? { pan: 0, tilt: 0 } : undefined;
  if (has('square')) out.push({ id: 'square', label: 'Drive a square', loop: false, keys: seq([
    { dt: 0, k: { drive: [0, 0], joints: head, color: [0, 255, 80] } },
    ...[0, 1, 2, 3].flatMap(() => [
      { dt: 0.01, k: { drive: [1, 1] as [number, number] } },
      { dt: 1.6, k: { drive: [0.5, -0.5] as [number, number], color: [255, 160, 0] as RGB } },
      { dt: turn90, k: { drive: [0, 0] as [number, number], color: [0, 255, 80] as RGB } },
      { dt: 0.3, k: {} },
    ]),
  ]) });
  if (has('patrol')) out.push({ id: 'patrol', label: 'Patrol', loop: true, keys: seq([
    { dt: 0, k: { drive: [1, 1], color: [0, 120, 255] } },
    { dt: 2.0, k: { drive: [0.5, -0.5], color: [255, 0, 0] } },
    { dt: turn90 * 2, k: { drive: [1, 1], color: [0, 120, 255] } },
    { dt: 2.0, k: { drive: [-0.5, 0.5], color: [255, 0, 0] } },
    { dt: turn90 * 2, k: { drive: [0, 0] } },
  ]) });
  if (has('spin')) out.push({ id: 'spin', label: 'Spin in place', loop: false, keys: seq([
    { dt: 0, k: { drive: [-1, 1], color: [180, 0, 255] } },
    { dt: 3, k: { drive: [1, -1] } },
    { dt: 3, k: { drive: [0, 0], color: [0, 255, 80] } },
  ]) });
  return out;
}

/** Generic keyframes for a composed robot: joint names are its link ids, ranges come from the composition. */
/**
 * Walking legs (src/cad/legs.ts, links hip / knee / ankle / roll _L / _R). Angles are given per side in body terms:
 * f = thigh forward, b = knee bend (shin back), a = toe up; the left servos are mirrored, so their values flip.
 * The foot stays flat when a = b - f. `tilt` leans the whole robot to the right (negative: left) on its ankle rolls,
 * feet flat on the floor: leaning onto one foot unloads the other, which then swings forward (pitch) and is set down
 * ahead; the robot leans the other way and steps with the other leg. Pitch and roll together make the walk.
 */
function legBehaviors(spec: RobotSpec, has: (id: string) => boolean): Behavior[] {
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
  const pose = (l: [number, number], r: [number, number], tilt = 0) => {
    const side = ([f, b]: [number, number], k: number) => ({ hip: clamp(k * f, -35, 35), knee: clamp(k * b, -60, 60), ankle: clamp(k * (b - f), -25, 25) });
    const L = side(l, -1), R = side(r, 1);
    // the right roll servo turns about +y, the left (mirrored) about -y: a lean to the right is -tilt / +tilt
    const roll = clamp(tilt, -20, 20);
    return { hip_L: L.hip, knee_L: L.knee, ankle_L: L.ankle, roll_L: roll, hip_R: R.hip, knee_R: R.knee, ankle_R: R.ankle, roll_R: -roll };
  };
  const neck = spec.composition!.joints.filter(j => j.kind === 'swing' && /neck|head/i.test(j.name));
  const nodTo = (deg: number) => Object.fromEntries(neck.map(j => [j.name, clamp(deg, j.range[0], j.range[1])]));
  const stand = pose([0, 0], [0, 0]), crouch = pose([5, 10], [5, 10]);   // (the walk crouches by CR)
  const LEAN = 12;
  const out: Behavior[] = [];
  // one step: lean onto the stance foot, lift and swing the other leg forward, set it down, come back to the middle
  const G = globalThis as { WALK_T?: number; WALK_SW?: number; WALK_CR?: number };
  const T = Number(G.WALK_T ?? 0.5), SW = Number(G.WALK_SW ?? 10), CR = Number(G.WALK_CR ?? 5);
  const step = (side: 1 | -1) => {
    const swing: [number, number] = [CR + SW, 2 * CR + 2 * SW + 4], stance: [number, number] = [CR - SW / 3, 2 * CR], plant: [number, number] = [CR + SW * 0.6, 2 * CR + SW * 0.6];
    const lr = (sw: [number, number], st: [number, number]) => (side > 0 ? [sw, st] : [st, sw]) as [[number, number], [number, number]];
    return [
      { dt: T, k: { joints: pose(...lr([CR, 2 * CR], [CR, 2 * CR]), side * LEAN) } },   // head held still: a nodding head rocks a tall walker
      { dt: T, k: { joints: pose(...lr(swing, stance), side * LEAN) } },
      { dt: T, k: { joints: pose(...lr(plant, stance), side * LEAN * 0.5) } },
      { dt: T, k: { joints: pose(...lr(plant, stance), 0) } },
    ];
  };
  if (has('walk') || !spec.behaviors.length) out.push({ id: 'walk', label: 'Walk (lean and step)', loop: true, keys: seq([
    { dt: 0, k: { joints: { ...pose([CR, 2 * CR], [CR, 2 * CR]), ...nodTo(0) }, color: [0, 200, 255] } },
    ...step(1),       // lean right, the left leg steps
    ...step(-1),      // lean left, the right leg steps
    { dt: T, k: { joints: pose([CR, 2 * CR], [CR, 2 * CR]) } },
  ]) });  if (has('dance') || !spec.behaviors.length) out.push({ id: 'dance', label: 'Sway (side to side on the ankles)', loop: true, keys: seq([
    { dt: 0, k: { joints: { ...crouch, ...nodTo(0) }, color: [255, 60, 180] } },
    ...[1, -1, 1, -1].map(s => ({ dt: 0.5, k: { joints: { ...pose([5, 10], [5, 10], 14 * s), ...nodTo(8 * s) } } })),
    { dt: 0.5, k: { joints: crouch } },
  ]) });  if (has('bow') || !spec.behaviors.length) out.push({ id: 'bow', label: 'Bow (knees and neck)', loop: false, keys: seq([
    { dt: 0, k: { joints: { ...stand, ...nodTo(0) }, color: [255, 200, 0] } },
    { dt: 0.8, k: { joints: { ...pose([20, 40], [20, 40]), ...nodTo(25) } } },
    { dt: 1.0, k: { joints: { ...pose([20, 40], [20, 40]), ...nodTo(25) } } },
    { dt: 0.8, k: { joints: { ...stand, ...nodTo(0) } } },
  ]) });
  if (neck.length && (has('nod') || !spec.behaviors.length)) out.push({ id: 'nod', label: 'Nod', loop: false, keys: seq([
    { dt: 0, k: { joints: { ...stand, ...nodTo(0) }, color: [0, 255, 120] } },
    ...[18, -8, 18, 0].map(d => ({ dt: 0.35, k: { joints: nodTo(d) } })),
  ]) });
  return out;
}

function composerBehaviors(spec: RobotSpec): Behavior[] {
  const joints = spec.composition!.joints;
  const swings = joints.filter(j => j.kind === 'swing');
  const spins = joints.some(j => j.kind === 'spin');
  const has = (id: string) => spec.behaviors.includes(id);
  const at = (f: (j: (typeof swings)[number], i: number) => number) =>
    Object.fromEntries(swings.map((j, i) => [j.name, Math.round(Math.max(j.range[0], Math.min(j.range[1], f(j, i))))]));
  const home = at(() => 0);
  const amp = (j: (typeof swings)[number]) => Math.min(Math.abs(j.range[0]), Math.abs(j.range[1]), 40) || Math.max(...j.range.map(Math.abs)) * 0.5;
  const out: Behavior[] = [];
  if (has('wave') && swings.length) {
    const steps = Array.from({ length: 8 }, (_, k) => ({ dt: 0.2, k: { joints: at((j, i) => amp(j) * Math.sin((k + 1) * Math.PI / 4 - i * 0.9)) } }));
    out.push({ id: 'wave', label: 'Wave all joints', loop: true, keys: seq([{ dt: 0, k: { joints: home, color: [0, 200, 255] } }, ...steps]) });
  }
  if (has('look') && swings.length) out.push({ id: 'look', label: 'Exercise each joint', loop: false, keys: seq([
    { dt: 0, k: { joints: home, color: [255, 255, 255] } },
    ...swings.flatMap(j => [
      { dt: 0.7, k: { joints: { [j.name]: j.range[1] }, color: [0, 255, 120] as RGB } },
      { dt: 0.9, k: { joints: { [j.name]: j.range[0] }, color: [255, 160, 0] as RGB } },
      { dt: 0.7, k: { joints: { [j.name]: 0 } } },
    ]),
  ]) });
  if (has('dance')) out.push({ id: 'dance', label: 'Dance', loop: true, keys: seq([
    { dt: 0, k: { joints: home, color: [255, 60, 180], drive: spins ? [0.6, 0.6] : undefined } },
    ...[0, 1, 2].flatMap(() => [
      { dt: 0.4, k: { joints: at((j, i) => (i % 2 ? -0.6 : 0.6) * amp(j)), color: [255, 60, 180] as RGB } },
      { dt: 0.4, k: { joints: at((j, i) => (i % 2 ? 0.6 : -0.6) * amp(j)), color: [40, 220, 255] as RGB } },
    ]),
    { dt: 0.4, k: { joints: home, drive: spins ? [0, 0] as [number, number] : undefined } },
  ]) });
  if (has('spin') && spins) out.push({ id: 'spin', label: 'Spin rotors', loop: true, keys: seq([
    { dt: 0, k: { drive: [1, 1], joints: home, color: [0, 200, 255] } },
    { dt: 4, k: {} },
  ]) });
  return out;
}

/** Keyframes for the stationary mechanisms; joint names are the link ids their builders create. */
function mechanismBehaviors(spec: RobotSpec, family: NonNullable<ReturnType<typeof mechanismFamily>>): Behavior[] {
  const P = spec.params;
  const has = (id: string) => spec.behaviors.includes(id);
  const out: Behavior[] = [];
  if (family === 'lever') {
    const j = (lever: number, color?: RGB) => ({ joints: { lever }, ...(color ? { color } : {}) });
    if (has('raise')) out.push({ id: 'raise', label: 'Raise / lower', loop: true, keys: seq([
      { dt: 0, k: j(0, [255, 40, 40]) },
      { dt: 1.0, k: j(85, [0, 255, 80]) },
      { dt: 2.5, k: j(85, [255, 160, 0]) },
      { dt: 1.0, k: j(0, [255, 40, 40]) },
      { dt: 1.5, k: j(0) },
    ]) });
    if (has('launch')) out.push({ id: 'launch', label: 'Launch swing', loop: false, keys: seq([
      { dt: 0, k: j(-15, [255, 160, 0]) },
      { dt: 1.2, k: j(-15, [255, 0, 0]) },
      { dt: 0.25, k: j(80, [255, 255, 255]) },
      { dt: 1.0, k: j(80) },
      { dt: 1.0, k: j(0, [0, 255, 80]) },
    ]) });
    if (has('wave')) out.push({ id: 'wave', label: 'Wave', loop: true, keys: seq([
      { dt: 0, k: j(30, [0, 160, 255]) },
      { dt: 0.45, k: j(70) },
      { dt: 0.45, k: j(30) },
    ]) });
    if (has('tap')) out.push({ id: 'tap', label: 'Tap / strike', loop: true, keys: seq([
      { dt: 0, k: j(45, [255, 200, 0]) },
      { dt: 0.3, k: j(-10, [255, 60, 0]) },
      { dt: 0.4, k: j(45) },
    ]) });
  } else if (family === 'rotor') {
    const carousel = P.rotorStyle === 'carousel';
    if (has('spin')) out.push({ id: 'spin', label: carousel ? 'Slow rotate' : 'Spin', loop: true, keys: seq([
      { dt: 0, k: { drive: carousel ? [0.3, 0.3] : [1, 1], color: [0, 200, 255] } },
      { dt: 4, k: {} },
    ]) });
    if (has('pulse')) out.push({ id: 'pulse', label: 'Speed ramp', loop: true, keys: seq([
      { dt: 0, k: { drive: [0.3, 0.3], color: [0, 120, 255] } },
      { dt: 1.5, k: { drive: [0.65, 0.65], color: [0, 255, 160] } },
      { dt: 1.5, k: { drive: [1, 1], color: [255, 255, 255] } },
      { dt: 1.5, k: { drive: [0.65, 0.65], color: [0, 255, 160] } },
      { dt: 1.5, k: {} },
    ]) });
    if (has('index')) {
      // open-loop step: one cell (or one blade) per burst at 40 % speed (B-PG002 120 rpm @ 6 V, derated)
      const step = 1 / Math.max(2, Math.round(P.bladeCount)) / ((120 * 0.83 * 0.4) / 60);
      out.push({ id: 'index', label: 'Index one step', loop: true, keys: seq([
        { dt: 0, k: { drive: [0.4, 0.4], color: [255, 160, 0] } },
        { dt: step, k: { drive: [0, 0], color: [0, 255, 80] } },
        { dt: 1.5, k: {} },
      ]) });
    }
  } else if (family === 'linear') {
    const s = linearTravel(P.stroke).half - 1;
    const j = (carriage: number, color?: RGB) => ({ joints: { carriage }, ...(color ? { color } : {}) });
    if (has('slide')) out.push({ id: 'slide', label: 'Slide end to end', loop: true, keys: seq([
      { dt: 0, k: j(-s, [0, 160, 255]) },
      { dt: 2.5, k: j(s, [0, 255, 160]) },
      { dt: 0.5, k: j(s) },
      { dt: 2.5, k: j(-s, [0, 160, 255]) },
      { dt: 0.5, k: j(-s) },
    ]) });
    if (has('lift')) out.push({ id: 'lift', label: 'Lift & hold', loop: true, keys: seq([
      { dt: 0, k: j(-s, [255, 160, 0]) },
      { dt: 2.0, k: j(s, [0, 255, 80]) },
      { dt: 2.0, k: j(s) },
      { dt: 2.0, k: j(-s, [255, 160, 0]) },
      { dt: 1.0, k: j(-s) },
    ]) });
    if (has('scan')) out.push({ id: 'scan', label: 'Step & pause scan', loop: true, keys: seq([
      { dt: 0, k: j(-s, [0, 200, 255]) },
      ...[-0.5, 0, 0.5, 1].flatMap(f => [
        { dt: 0.6, k: j(Math.round(s * f), [255, 160, 0]) },
        { dt: 0.8, k: j(Math.round(s * f), [0, 255, 80]) },
      ]),
      { dt: 1.5, k: j(-s, [0, 200, 255]) },
    ]) });
  } else {
    const L1 = P.upperLen, L2 = P.foreLen;
    /** Planar IK, angles from +Y counter-clockwise, elbow-left solution. */
    const ik = (x: number, y: number) => {
      const r2 = x * x + y * y;
      const c2 = Math.max(-1, Math.min(1, (r2 - L1 * L1 - L2 * L2) / (2 * L1 * L2)));
      const q2 = Math.acos(c2);
      const q1 = Math.atan2(-x, y) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * c2);
      return { link1: Math.round((q1 * 180) / Math.PI), link2: Math.round((q2 * 180) / Math.PI) };
    };
    if (has('draw')) {
      const cy = (L1 + L2) * 0.72, r = Math.min(18, (L1 + L2) * 0.12);
      const steps = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * 2 * Math.PI;
        return { dt: 0.25, k: { joints: ik(r * Math.sin(a), cy + r * Math.cos(a)) } };
      });
      out.push({ id: 'draw', label: 'Draw a circle', loop: true, keys: seq([
        { dt: 0, k: { joints: ik(0, cy + r), color: [0, 200, 255] } },
        ...steps,
        { dt: 0.25, k: { joints: ik(0, cy + r) } },
      ]) });
    }
    if (has('sweep')) out.push({ id: 'sweep', label: 'Sweep the workspace', loop: true, keys: seq([
      { dt: 0, k: { joints: { link1: -60, link2: 30 }, color: [255, 160, 0] } },
      { dt: 2.0, k: { joints: { link1: 60, link2: -30 } } },
      { dt: 2.0, k: { joints: { link1: -60, link2: 30 } } },
    ]) });
    if (has('wave')) out.push({ id: 'wave', label: 'Wave', loop: false, keys: seq([
      { dt: 0, k: { joints: { link1: 0, link2: 0 }, color: [0, 160, 255] } },
      ...[0, 1, 2].flatMap(() => [{ dt: 0.4, k: { joints: { link2: 45 } } }, { dt: 0.4, k: { joints: { link2: -45 } } }]),
      { dt: 0.5, k: { joints: { link1: 0, link2: 0 } } },
    ]) });
  }
  return out;
}

function lookAround(): Behavior {
  return { id: 'look', label: 'Look around', loop: true, keys: seq([
    { dt: 0, k: { joints: { pan: 0, tilt: 0 }, color: [0, 200, 255] } },
    { dt: 0.8, k: { joints: { pan: -60, tilt: 10 } } },
    { dt: 1.2, k: { joints: { pan: 60, tilt: 10 } } },
    { dt: 1.2, k: { joints: { pan: 0, tilt: -20 }, color: [255, 200, 0] } },
    { dt: 0.8, k: { joints: { pan: 0, tilt: 25 } } },
    { dt: 0.8, k: { joints: { pan: 0, tilt: 0 }, color: [0, 200, 255] } },
  ]) };
}

/** Sample a behaviour at time t (held keys, joints linearly interpolated toward the next key). */
export function sample(b: Behavior, tRaw: number) {
  const end = b.keys[b.keys.length - 1].t;
  const t = b.loop && end > 0 ? tRaw % end : Math.min(tRaw, end);
  const joints: Record<string, number> = {};
  let drive: [number, number] = [0, 0];
  let color: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < b.keys.length; i++) {
    const k = b.keys[i];
    if (k.t > t) {
      // ease toward the upcoming key's joint targets
      const prev = b.keys[i - 1];
      if (prev && k.joints) {
        const fRaw = (t - prev.t) / Math.max(1e-6, k.t - prev.t);
        const f = 0.5 * (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, fRaw))));
        for (const [j, v] of Object.entries(k.joints)) joints[j] = (joints[j] ?? 0) + (v - (joints[j] ?? 0)) * f;
      }
      break;
    }
    if (k.joints) Object.assign(joints, k.joints);
    if (k.drive) drive = k.drive;
    if (k.color) color = k.color;
  }
  return { joints, drive, color, done: !b.loop && tRaw >= end };
}
