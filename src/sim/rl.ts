// Reinforcement Learning (RL) Locomotion & Balance Controller for PICOCEO Builder Physics Simulation.
// Uses Cross-Entropy Method (CEM) Evolution Strategies + Elite Policy Gradient over Rapier 3D rollouts
// to learn a closed-loop Central Pattern Generator (CPG) + IMU Balance Reflex policy.

import { Quaternion, Vector3 } from 'three';
import type { Assembly } from '../cad/types';
import { Sim } from './physics';

export interface RLPolicyParams {
  /** Hip pitch swing amplitude (degrees) */
  strideAmpDeg: number;
  /** Ankle roll lateral weight-shift amplitude (degrees) */
  waddleAmpDeg: number;
  /** Step cycle frequency (Hz) */
  freqHz: number;
  /** Phase offset between ankle weight-shift and hip swing (radians) */
  phaseLeadRad: number;
  /** Static torso pitch trim offset on hips (degrees) */
  pitchTrimDeg: number;
  /** Closed-loop proportional pitch balance gain (deg hip / deg torso pitch) */
  kpPitch: number;
  /** Closed-loop derivative pitch damping gain (deg hip / (rad/s torso pitch rate)) */
  kdPitch: number;
  /** Closed-loop proportional roll balance gain (deg ankle / deg torso roll) */
  kpRoll: number;
  /** Closed-loop derivative roll damping gain (deg ankle / (rad/s torso roll rate)) */
  kdRoll: number;
  /** Counter-balance arm/wing swing ratio */
  armSwingGain: number;
}

export interface RLTrainingConfig {
  generations: number;
  populationSize: number;
  episodeDurationSec: number;
  learningRate: number;
  explorationScale: number;
  startFromScratch: boolean;
  untilSuccess?: boolean;
  successTargetMm?: number;
}

export const DEFAULT_RL_TRAINING_CONFIG: RLTrainingConfig = {
  generations: 12,
  populationSize: 4,
  episodeDurationSec: 2.0,
  learningRate: 0.75,
  explorationScale: 1.0,
  startFromScratch: false,
  untilSuccess: false,
  successTargetMm: 35,
};

export interface RLEpisodeMetric {
  episode: number;
  generation: number;
  reward: number;
  bestReward: number;
  forwardMm: number;
  driftMm: number;
  maxTiltDeg: number;
  survived: boolean;
  isNewBest: boolean;
  policy: RLPolicyParams;
}

/** Untrained initial policy: small out-of-phase movements & weak balance gains so RL visibly learns from scratch. */
export const UNTRAINED_RL_POLICY: RLPolicyParams = {
  strideAmpDeg: 3.5,
  waddleAmpDeg: 3.2,
  freqHz: 0.55,
  phaseLeadRad: 0.12, // Nearly 0 deg phase lead -> ankle & hip out of sync at start
  pitchTrimDeg: 1.5,
  kpPitch: 0.25,
  kdPitch: 1.2,
  kpRoll: 0.22,
  kdRoll: 1.0,
  armSwingGain: 0.3,
};

/** Default pre-trained RL policy for immediate balanced walking. */
export const DEFAULT_RL_POLICY: RLPolicyParams = {
  strideAmpDeg: 8.5,
  waddleAmpDeg: 9.5,
  freqHz: 0.78,
  phaseLeadRad: 1.57,
  pitchTrimDeg: -1.5,
  kpPitch: 0.75,
  kdPitch: 3.4,
  kpRoll: 0.55,
  kdRoll: 2.2,
  armSwingGain: 1.2,
};

export const PARAM_BOUNDS: Record<keyof RLPolicyParams, [number, number]> = {
  strideAmpDeg: [2.0, 14.0],
  waddleAmpDeg: [2.0, 14.0],
  freqHz: [0.4, 1.15],
  phaseLeadRad: [-0.5, 2.4],
  pitchTrimDeg: [-6.0, 6.0],
  kpPitch: [0.15, 1.6],
  kdPitch: [0.5, 6.5],
  kpRoll: [0.15, 1.4],
  kdRoll: [0.5, 5.5],
  armSwingGain: [0.0, 2.0],
};

const PARAM_STD0: Record<keyof RLPolicyParams, number> = {
  strideAmpDeg: 2.8,
  waddleAmpDeg: 2.8,
  freqHz: 0.18,
  phaseLeadRad: 0.65,
  pitchTrimDeg: 1.5,
  kpPitch: 0.32,
  kdPitch: 1.1,
  kpRoll: 0.28,
  kdRoll: 0.9,
  armSwingGain: 0.45,
};

export function clampParam<K extends keyof RLPolicyParams>(k: K, val: number): number {
  const [lo, hi] = PARAM_BOUNDS[k];
  return Math.max(lo, Math.min(hi, val));
}

function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export interface RootImuState {
  pitchDeg: number;
  rollDeg: number;
  yawDeg: number;
  wx: number;
  wy: number;
  wz: number;
  upZ: number;
  posMm: [number, number, number];
}

/** Extract IMU orientation (pitch around X, roll around Y, yaw around Z) & angular velocity from Sim root body. */
export function readRootImu(sim: Sim, asm: Assembly): RootImuState {
  const rootLink = asm.links.find(l => !l.parent);
  if (!rootLink) {
    return { pitchDeg: 0, rollDeg: 0, yawDeg: 0, wx: 0, wy: 0, wz: 0, upZ: 1, posMm: [0, 0, 0] };
  }
  const body = sim.bodies.get(rootLink.id);
  const p0 = sim.body0.get(rootLink.id);
  if (!body || !p0) {
    return { pitchDeg: 0, rollDeg: 0, yawDeg: 0, wx: 0, wy: 0, wz: 0, upZ: 1, posMm: [0, 0, 0] };
  }
  const rot = body.rotation();
  const q = new Quaternion(rot.x, rot.y, rot.z, rot.w);
  const up = new Vector3(0, 0, 1).applyQuaternion(q);
  const fwd = new Vector3(0, 1, 0).applyQuaternion(q);

  const pitchRad = Math.atan2(up.y, Math.max(1e-4, up.z));
  const rollRad = Math.atan2(up.x, Math.max(1e-4, up.z));
  const yawRad = Math.atan2(-fwd.x, fwd.y);

  const w = body.angvel();
  const p = body.translation();

  return {
    pitchDeg: (pitchRad * 180) / Math.PI,
    rollDeg: (rollRad * 180) / Math.PI,
    yawDeg: (yawRad * 180) / Math.PI,
    wx: w.x,
    wy: w.y,
    wz: w.z,
    upZ: up.z,
    posMm: [(p.x - p0.x) * 1000, (p.y - p0.y) * 1000, (p.z - p0.z) * 1000],
  };
}

/**
 * Evaluate the closed-loop RL policy at time `t` given the robot's live IMU state.
 * Works for bipedal walkers/ducks/humanoids, serpentine snakes, and wheeled rovers.
 */
export function evaluateRLPolicy(
  policy: RLPolicyParams,
  t: number,
  imu: RootImuState,
  asm: Assembly,
): { joints: Record<string, number>; drive: [number, number] } {
  const linkIds = new Set(asm.links.map(l => l.id));
  const joints: Record<string, number> = {};
  let drive: [number, number] = [0, 0];

  const hasBipedLegs = linkIds.has('leg_L') && linkIds.has('leg_R');
  const hasQuadLegs =
    linkIds.has('leg_FL') &&
    linkIds.has('leg_FR') &&
    linkIds.has('leg_RL') &&
    linkIds.has('leg_RR');
  const hasSnakeSegments = linkIds.has('segment_1') && linkIds.has('segment_2');
  const hasWheels = linkIds.has('wheel_L') && linkIds.has('wheel_R');

  // Smooth startup envelope over first 0.45s so initial impulse never jerks the robot off balance
  const env = Math.min(1, t / 0.45);
  const omega = 2 * Math.PI * policy.freqHz;
  const phi = omega * t;

  if (hasBipedLegs) {
    // Central Pattern Generator (CPG) + Closed-Loop IMU Balance Reflex
    // When waddleOsc > 0 (left foot loaded as stance, right foot lifted as swing):
    //   d(hipL)/dt < 0 sweeps left stance foot backward to propel duck FORWARD (+Y)
    //   d(hipR)/dt > 0 swings lifted right foot FORWARD (+Y)
    const waddleOsc = env * policy.waddleAmpDeg * Math.sin(phi + policy.phaseLeadRad);
    const strideOsc = env * policy.strideAmpDeg * Math.sin(phi);

    // Closed-loop pitch & roll reflex feedback to keep torso upright (Z-up)
    const pitchFeedback =
      -policy.kpPitch * (imu.pitchDeg - policy.pitchTrimDeg) - policy.kdPitch * imu.wx;
    const rollFeedback = -policy.kpRoll * imu.rollDeg - policy.kdRoll * imu.wy;

    // Yaw heading correction: gently bias left vs right stride amplitude to walk straight along +Y
    const yawSteer = Math.max(-0.25, Math.min(0.25, -0.02 * imu.yawDeg));

    const hipL = policy.pitchTrimDeg - strideOsc * (1 - yawSteer) + pitchFeedback;
    const hipR = policy.pitchTrimDeg + strideOsc * (1 + yawSteer) + pitchFeedback;
    const ankleL = waddleOsc + rollFeedback;
    const ankleR = waddleOsc + rollFeedback;

    joints.leg_L = Math.max(-35, Math.min(35, hipL));
    joints.leg_R = Math.max(-35, Math.min(35, hipR));
    joints.hip_L = joints.leg_L;
    joints.hip_R = joints.leg_R;

    if (linkIds.has('foot_L') && linkIds.has('foot_R')) {
      joints.foot_L = Math.max(-22, Math.min(22, ankleL));
      joints.foot_R = Math.max(-22, Math.min(22, ankleR));
      joints.ankle_L = joints.foot_L;
      joints.ankle_R = joints.foot_R;
    }

    if (linkIds.has('arm_L') && linkIds.has('arm_R')) {
      const armSwing = strideOsc * policy.armSwingGain;
      joints.arm_L = Math.max(-60, Math.min(60, armSwing));
      joints.arm_R = Math.max(-60, Math.min(60, -armSwing));
    }
  } else if (hasQuadLegs) {
    // Quadruped Central Pattern Generator (CPG) Trot:
    // Diagonal pairs: (FL + RR) and (FR + RL) alternate with 180° phase shift
    const strideOsc = env * policy.strideAmpDeg * Math.sin(phi);
    const pitchFeedback =
      -policy.kpPitch * (imu.pitchDeg - policy.pitchTrimDeg) - policy.kdPitch * imu.wx;
    const rollFeedback = -policy.kpRoll * imu.rollDeg - policy.kdRoll * imu.wy;
    const yawSteer = Math.max(-0.25, Math.min(0.25, -0.02 * imu.yawDeg));

    const fl = strideOsc * (1 - yawSteer) + pitchFeedback - rollFeedback;
    const rr = strideOsc * (1 + yawSteer) - pitchFeedback + rollFeedback;
    const fr = -strideOsc * (1 + yawSteer) + pitchFeedback + rollFeedback;
    const rl = -strideOsc * (1 - yawSteer) - pitchFeedback - rollFeedback;

    joints.leg_FL = Math.max(-45, Math.min(45, fl));
    joints.leg_FR = Math.max(-45, Math.min(45, fr));
    joints.leg_RL = Math.max(-45, Math.min(45, rl));
    joints.leg_RR = Math.max(-45, Math.min(45, rr));
    joints.hip_FL = joints.leg_FL;
    joints.hip_FR = joints.leg_FR;
    joints.hip_RL = joints.leg_RL;
    joints.hip_RR = joints.leg_RR;
  } else if (hasSnakeSegments) {
    const amp = Math.min(30, policy.strideAmpDeg * 2.2) * env;
    joints.segment_1 = amp * Math.sin(phi);
    joints.segment_2 = amp * Math.sin(phi - policy.phaseLeadRad);
    if (linkIds.has('segment_3')) joints.segment_3 = amp * Math.sin(phi - 2 * policy.phaseLeadRad);
    if (linkIds.has('tail')) joints.tail = amp * Math.sin(phi - 3 * policy.phaseLeadRad);
  } else if (hasWheels) {
    const steer = Math.max(-0.4, Math.min(0.4, -0.03 * imu.yawDeg - 0.08 * imu.wz));
    const spd = Math.min(1, policy.freqHz / 1.2);
    drive = [Math.max(-1, Math.min(1, spd - steer)), Math.max(-1, Math.min(1, spd + steer))];
  }

  return { joints, drive };
}

/**
 * Apply closed-loop balance reflex stabilization on top of open-loop keyframe targets
 * so standard behaviors (like "Waddle walk") stay upright in physics simulation.
 */
export function stabilizeKeyframeTargets(
  rawTargets: Record<string, number>,
  imu: RootImuState,
  asm: Assembly,
  policy: RLPolicyParams = DEFAULT_RL_POLICY,
): Record<string, number> {
  const linkIds = new Set(asm.links.map(l => l.id));
  const hasQuadLegs =
    linkIds.has('leg_FL') &&
    linkIds.has('leg_FR') &&
    linkIds.has('leg_RL') &&
    linkIds.has('leg_RR');

  if (hasQuadLegs) {
    const out = { ...rawTargets };
    const pitchReflex = -policy.kpPitch * (imu.pitchDeg - policy.pitchTrimDeg) - policy.kdPitch * imu.wx;
    const rollReflex = -policy.kpRoll * imu.rollDeg - policy.kdRoll * imu.wy;
    for (const [k, sPitch, sRoll] of [
      ['FL', 1, -1], ['FR', 1, 1], ['RL', -1, -1], ['RR', -1, 1],
    ] as const) {
      const raw = out[`leg_${k}`] ?? out[`hip_${k}`] ?? 0;
      const safe = Math.max(-45, Math.min(45, raw * 0.85 + sPitch * pitchReflex * 0.4 + sRoll * rollReflex * 0.4));
      out[`leg_${k}`] = safe;
      out[`hip_${k}`] = safe;
    }
    return out;
  }

  if (!linkIds.has('leg_L') || !linkIds.has('leg_R')) {
    return rawTargets;
  }
  const out = { ...rawTargets };
  const pitchReflex = -policy.kpPitch * (imu.pitchDeg - policy.pitchTrimDeg) - policy.kdPitch * imu.wx;
  const rollReflex = -policy.kpRoll * imu.rollDeg - policy.kdRoll * imu.wy;

  const rawHipL = out.leg_L ?? out.hip_L ?? 0;
  const rawHipR = out.leg_R ?? out.hip_R ?? 0;
  const rawAnkleL = out.foot_L ?? out.ankle_L ?? 0;
  const rawAnkleR = out.foot_R ?? out.ankle_R ?? 0;

  const safeHipL = Math.max(-28, Math.min(28, rawHipL * 0.75 + policy.pitchTrimDeg + pitchReflex));
  const safeHipR = Math.max(-28, Math.min(28, rawHipR * 0.75 + policy.pitchTrimDeg + pitchReflex));
  const safeAnkleL = Math.max(-20, Math.min(20, rawAnkleL * 0.85 + rollReflex));
  const safeAnkleR = Math.max(-20, Math.min(20, rawAnkleR * 0.85 + rollReflex));

  out.leg_L = safeHipL;
  out.hip_L = safeHipL;
  out.leg_R = safeHipR;
  out.hip_R = safeHipR;
  out.foot_L = safeAnkleL;
  out.ankle_L = safeAnkleL;
  out.foot_R = safeAnkleR;
  out.ankle_R = safeAnkleR;

  return out;
}

/**
 * Run a single physics rollout episode for `durationSec` to score a candidate RL policy.
 * Always resets `sim` to the original state `[0, 0, 0]` before running the episode.
 */
export async function runRLEpisode(
  asm: Assembly,
  policy: RLPolicyParams,
  durationSec = 3.5,
  liveSim?: Sim | null,
  onVisualStep?: (sim: Sim) => Promise<void> | void,
): Promise<{
  reward: number;
  forwardMm: number;
  driftMm: number;
  maxTiltDeg: number;
  survived: boolean;
}> {
  const ownsSim = !liveSim;
  const sim = liveSim ?? new Sim(asm, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  // Always reset the model to its exact original state [0, 0, 0] before starting the episode
  sim.reset();
  sim.balanceGains = {
    kpPitch: policy.kpPitch,
    kdPitch: policy.kdPitch,
    kpRoll: policy.kpRoll,
    kdRoll: policy.kdRoll,
  };
  if (onVisualStep) {
    await onVisualStep(sim);
  }

  const controlDt = 1 / 60;
  const steps = Math.round(durationSec / controlDt);
  const visualStride = onVisualStep ? 12 : Math.max(25, Math.floor(steps / 4));

  let survived = true;
  let maxTiltDeg = 0;
  let tiltPenaltySum = 0;
  let survivedSteps = 0;

  try {
    for (let s = 0; s < steps; s++) {
      const imu = readRootImu(sim, asm);
      const tiltDeg = Math.hypot(imu.pitchDeg, imu.rollDeg);
      if (tiltDeg > maxTiltDeg) maxTiltDeg = tiltDeg;

      // Tipped check: if upZ drops below 0.65 (~49 deg tilt), terminate episode early with penalty
      if (imu.upZ < 0.65) {
        survived = false;
        break;
      }

      const { joints, drive } = evaluateRLPolicy(policy, sim.t, imu, asm);
      sim.command(joints, { wheel_L: drive[0], wheel_R: drive[1] });
      sim.step(controlDt);

      tiltPenaltySum += (imu.pitchDeg ** 2 + imu.rollDeg ** 2) * controlDt;
      survivedSteps++;

      if (onVisualStep && (s + 1) % visualStride === 0) {
        await onVisualStep(sim);
      }
    }

    const finalImu = readRootImu(sim, asm);
    // Forward progress strictly along +Y axis (beak / front direction). Backward motion (< 0) is penalized!
    const forwardMm = finalImu.posMm[1];
    const driftMm = Math.abs(finalImu.posMm[0]);

    // Phase coordination bonus: rewards proper 90-deg quadrature between ankle weight shift and hip swing
    const phaseAlignment = Math.sin(policy.phaseLeadRad);
    const stabilityBonus =
      policy.kpPitch >= 0.45 && policy.kdPitch >= 2.0 && maxTiltDeg < 12 ? 12 : 0;

    const aliveBonus = (survivedSteps / steps) * 25;
    const tipPenalty = survived ? 0 : -140;
    const backwardPenalty = forwardMm < 0 ? forwardMm * 3.5 - 35 : 0;

    const reward =
      aliveBonus +
      forwardMm * 2.8 +
      phaseAlignment * 15 +
      stabilityBonus -
      driftMm * 0.45 -
      tiltPenaltySum * 0.22 -
      maxTiltDeg * 0.55 +
      backwardPenalty +
      tipPenalty;

    return {
      reward: Math.round(reward * 10) / 10,
      forwardMm: Math.round(forwardMm * 10) / 10,
      driftMm: Math.round(driftMm * 10) / 10,
      maxTiltDeg: Math.round(maxTiltDeg * 10) / 10,
      survived,
    };
  } finally {
    if (ownsSim) {
      sim.dispose();
    } else {
      // Reset live sim back to original state [0, 0, 0] right after the episode finishes
      sim.reset();
      if (onVisualStep) {
        await onVisualStep(sim);
      }
    }
  }
}

/**
 * Train an RL locomotion policy across multiple generations using Cross-Entropy Method (CEM) Evolution Strategies.
 * Resets the model to its original state `[0, 0, 0]` before every episode and after training completes.
 */
export async function trainRLPolicy(
  asm: Assembly,
  options: {
    config?: Partial<RLTrainingConfig>;
    initialPolicy?: RLPolicyParams;
    liveSim?: Sim | null;
    onVisualStep?: (sim: Sim) => Promise<void> | void;
    onEpisode?: (metric: RLEpisodeMetric, bestPolicy: RLPolicyParams, currentMean: RLPolicyParams) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<{ bestPolicy: RLPolicyParams; history: RLEpisodeMetric[] }> {
  const cfg: RLTrainingConfig = { ...DEFAULT_RL_TRAINING_CONFIG, ...options.config };
  const generations = Math.max(2, cfg.generations);
  const popSize = Math.max(4, cfg.populationSize);
  const eliteCount = Math.max(2, Math.floor(popSize * 0.35));
  const lr = Math.max(0.1, Math.min(1.0, cfg.learningRate));
  const explore = Math.max(0.2, Math.min(2.5, cfg.explorationScale));

  let mean: RLPolicyParams = cfg.startFromScratch
    ? { ...UNTRAINED_RL_POLICY }
    : { ...(options.initialPolicy ?? DEFAULT_RL_POLICY) };

  const std: Record<keyof RLPolicyParams, number> = { ...PARAM_STD0 };
  const keys = Object.keys(mean) as (keyof RLPolicyParams)[];
  for (const k of keys) {
    std[k] = PARAM_STD0[k] * explore;
  }

  let bestPolicy: RLPolicyParams = { ...mean };
  let bestReward = -Infinity;
  const history: RLEpisodeMetric[] = [];
  let episodeCounter = 0;

  const targetSuccessMm = cfg.successTargetMm ?? 35;
  const maxGenerations = cfg.untilSuccess ? Math.max(generations, 100) : generations;

  for (let gen = 1; gen <= maxGenerations; gen++) {
    const candidates: { policy: RLPolicyParams; metric: RLEpisodeMetric }[] = [];

    for (let i = 0; i < popSize; i++) {
      if (options.shouldStop?.()) {
        options.liveSim?.reset();
        return { bestPolicy, history };
      }

      const candidate: RLPolicyParams = { ...mean };
      // Episode 1 evaluates initial policy; subsequent episodes sample around current distribution mean
      if (!(gen === 1 && i === 0)) {
        for (const k of keys) {
          candidate[k] = clampParam(k, mean[k] + randn() * std[k]);
        }
      }

      episodeCounter++;
      const res = await runRLEpisode(
        asm,
        candidate,
        cfg.episodeDurationSec,
        options.liveSim,
        options.onVisualStep,
      );
      const isNewBest = res.reward > bestReward;
      if (isNewBest) {
        bestReward = res.reward;
        bestPolicy = { ...candidate };
      }

      const metric: RLEpisodeMetric = {
        episode: episodeCounter,
        generation: gen,
        reward: res.reward,
        bestReward,
        forwardMm: res.forwardMm,
        driftMm: res.driftMm,
        maxTiltDeg: res.maxTiltDeg,
        survived: res.survived,
        isNewBest,
        policy: candidate,
      };
      history.push(metric);
      candidates.push({ policy: candidate, metric });

      options.onEpisode?.(metric, bestPolicy, mean);

      // Check success condition if "run until success" is enabled:
      if (cfg.untilSuccess && res.survived && res.forwardMm >= targetSuccessMm) {
        options.liveSim?.reset();
        return { bestPolicy, history };
      }

      // Visually display the reset state between episodes so the user clearly sees the robot return to origin
      if (options.liveSim && options.onVisualStep) {
        options.liveSim.reset();
        await options.onVisualStep(options.liveSim);
        await new Promise(resolve => setTimeout(resolve, 50));
      } else if (!options.onVisualStep) {
        await new Promise(resolve => setTimeout(resolve, 4));
      }
    }

    // Sort candidates by reward descending and update CEM distribution mean & std from elites
    candidates.sort((a, b) => b.metric.reward - a.metric.reward);
    const elites = candidates.slice(0, eliteCount);

    const nextMean: RLPolicyParams = { ...mean };
    for (const k of keys) {
      const eliteAvg = elites.reduce((s, e) => s + e.policy[k], 0) / elites.length;
      // Blend toward elite mean + best policy with learningRate
      const targetVal = 0.7 * eliteAvg + 0.3 * bestPolicy[k];
      nextMean[k] = clampParam(k, mean[k] * (1 - lr) + targetVal * lr);

      const variance =
        elites.reduce((s, e) => s + (e.policy[k] - eliteAvg) ** 2, 0) / elites.length;
      const decay = Math.max(0.25, 1 - (gen / maxGenerations) * 0.65);
      std[k] = Math.max(
        PARAM_STD0[k] * 0.15,
        0.5 * Math.sqrt(variance) + 0.5 * PARAM_STD0[k] * explore * decay,
      );
    }
    mean = nextMean;
  }

  return { bestPolicy, history };
}
