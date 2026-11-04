// Generic design patterns: any robot idea as a free-form composition (src/cad/composer.ts) instead of a prebuilt CAD
// builder. When "Free-form design only" is on and a design still arrives as a prebuilt type (the AI answered with one
// twice, an edit did, or the AI failed and the offline planner stepped in), its family is mapped to a composition:
//   biped      humanoid, duck, bird, penguin, walker   Claw: walking legs + nodding neck + head (the face)
//                                                     else: body + turning head + wings / arms
//   animal     dog, cat, dinosaur, quadruped ...      body + turning head + wagging tail, static legs and ears
//   vehicle    rover, car, truck, tank ...             body on wheels (+ a turning head with a pan-tilt)
//   snake      snake, worm, serpent                   body + two wagging segments
//   arm        arm, crane, excavator, gripper         base + turning base + shoulder + elbow + gripper
//   lever / rotor / turntable                          box + boom / spinning rotor / spinning platter
//   companion  everything else (desk buddy, agent)    body + turning head (the face) + arms when asked
// The sizes are starting points: the composer grows voice bodies for their core, and every check still applies.

import { hasWord, mechanismFamily, normalizeComposition, type CompFeature, type CompJoint, type Composition, type Platform, type RobotSpec } from './spec';

type Family = 'biped' | 'animal' | 'vehicle' | 'snake' | 'arm' | 'lever' | 'rotor' | 'turntable' | 'companion';

const WORDS: [Family, string[]][] = [
  ['snake', ['snake', 'serpent', 'worm', 'eel', 'rắn']],
  ['biped', ['humanoid', 'biped', 'walker', 'duck', 'duckling', 'chicken', 'rooster', 'hen', 'bird', 'penguin', 'owl', 'eagle', 'parrot',
    'ostrich', 'flamingo', 'kangaroo', 'trex', 't-rex', 'person', 'warrior', 'android', 'bdx', 'goose']],
  ['animal', ['quadruped', 'dog', 'puppy', 'cat', 'kitten', 'fox', 'wolf', 'lion', 'tiger', 'bear', 'horse', 'pony', 'cow', 'pig', 'sheep',
    'deer', 'elephant', 'rabbit', 'bunny', 'turtle', 'tortoise', 'lizard', 'dinosaur', 'dino', 'frog', 'mouse', 'hamster', 'chó', 'mèo']],
  ['vehicle', ['rover', 'car', 'truck', 'tank', 'vehicle', 'buggy', 'racer', 'kart', 'bus', 'tractor', 'jeep', 'van', 'xe']],
  ['arm', ['arm', 'manipulator', 'gripper', 'crane', 'excavator', 'digger', 'claw machine', 'robot arm']],
];

export function familyOf(spec: RobotSpec): Family {
  const text = `${spec.archetype} ${spec.theme ?? ''} ${spec.name ?? ''}`.toLowerCase().replace(/[_-]+/g, ' ');
  const mech = mechanismFamily(spec.archetype || '');
  if (mech === 'lever') return 'lever';
  if (mech === 'rotor') return 'rotor';
  if (/turntable|platter|rotary table|bàn xoay/.test(text)) return 'turntable';
  for (const [fam, ws] of WORDS) if (hasWord(text, ...ws)) return fam;
  if (spec.params.headFeature === 'beak' || spec.params.footStyle === 'webbed' || spec.params.hasWings) return 'biped';
  if (spec.params.hasTail && spec.params.headFeature === 'ears') return 'animal';
  return 'companion';
}

const J = (j: Partial<CompJoint> & Pick<CompJoint, 'name' | 'face' | 'point' | 'reach' | 'shape' | 'size'>): CompJoint =>
  ({ parent: 'body', at: [0, 0], kind: 'swing', range: [-35, 35], ...j });
const F = (parent: string, shape: CompFeature['shape'], size: [number, number, number], at: [number, number, number], color: CompFeature['color'] = 'accent'): CompFeature =>
  ({ parent, shape, size, at, color });

/** Voice bodies that hold each core (board, battery, servo board) with the face block in front. */
const VOICE_BODY: Partial<Record<Platform, [number, number, number]>> = { xiaozhi: [80, 70, 70], rpi: [120, 110, 90], jetson: [130, 125, 100] };

/** The composition for a spec's family (raw: `normalizeComposition` clamps it). */
export function patternComposition(spec: RobotSpec, platform?: Platform): Composition {
  const P = spec.params;
  const claw = platform === 'licheerv_claw';
  const voiceBody = platform ? VOICE_BODY[platform] : undefined;
  const faced = claw || !!voiceBody;                 // the front of the body / head carries a screen
  const eyes = (parent: string, y: number, z: number): CompFeature[] => (P.leds >= 2 && !faced
    ? [F(parent, 'led', [6, 6, 3], [-12, y, z], 'primary'), F(parent, 'led', [6, 6, 3], [12, y, z], 'primary')] : []);
  // a voice core needs a boxy body of its size; a Claw head holds the 36 × 20 × 46 mm module behind its screen
  const body = (shape: Composition['body']['shape'], size: [number, number, number]): Composition['body'] =>
    voiceBody ? { shape: 'rounded_box', size: voiceBody } : { shape, size };
  const head = (shape: CompJoint['shape'], size: [number, number, number]) => (claw ? { shape: 'rounded_box' as const, size: [56, 48, 62] as [number, number, number] } : { shape, size });
  const fam = familyOf(spec);
  let c: Omit<Composition, 'use'>;
  switch (fam) {
    case 'biped': {
      const duck = /duck|goose|bird|penguin|chicken|hen|owl|bdx/.test(`${spec.archetype} ${spec.theme}`.toLowerCase()) || P.headFeature === 'beak';
      const beak = duck ? [F('head', 'wedge', [34, 24, 12], [0, 34, -8])] : [];
      if (claw) {
        // walking legs (src/cad/legs.ts) under a small body, a nodding neck and a big head that carries the Claw face
        c = { mobility: 'legs', body: { shape: 'egg', size: [70, 60, 48] }, standH: 8, joints: [
          J({ name: 'neck', face: '+x', at: [-4, 8], point: 'up', reach: 42, shape: 'capsule', size: [12, 14, 46], range: [-30, 30] }),
          J({ name: 'head', parent: 'neck', face: '+x', at: [0, 16], point: 'up', reach: 30, shape: duck ? 'rounded_box' : 'egg', size: [62, 64, 48], range: [-30, 30] }),
        ], features: beak };
      } else {
        // side joints sit below the middle, clear of the head servo hanging from the top
        const arms = P.hasArms || P.hasWings || duck;
        c = { mobility: 'none', body: body('egg', [62, 54, 60]), standH: 18, joints: [
          J({ name: 'head', face: '+z', point: 'axis', reach: 0, ...head('sphere', [46, 42, 42]), range: [-45, 45] }),
          ...(arms ? [-1, 1].map(s => J({ name: s < 0 ? 'wing_l' : 'wing_r', face: s < 0 ? '-x' : '+x', at: [0, -10], point: 'down', reach: 16,
            shape: duck ? 'fin' : 'capsule', size: duck ? [4, 30, 34] : [10, 10, 34], range: [-40, 40] })) : []),
        ], features: [...beak, ...eyes('head', 21, 6)] };
      }
      break;
    }
    case 'animal':
      c = { mobility: 'none', body: body('egg', [60, 110, 56]), standH: 24, joints: [
        J({ name: 'head', face: '+z', at: [0, 42], point: 'front', reach: 34, ...head('sphere', [44, 42, 40]), range: [-40, 40] }),
        J({ name: 'tail', face: '+z', at: [0, -44], point: 'back', reach: 30, shape: 'fin', size: [4, 34, 28], range: [-35, 35] }),
      // ears fused into the head (primary): glued-on accents would straddle the head's opening seam. They start well
      // above the head and are pulled in until they touch it, so they land on its top however much it grew for a face.
      ], features: [F('head', 'fin', [4, 12, 16], [-14, -2, 70], 'primary'), F('head', 'fin', [4, 12, 16], [14, -2, 70], 'primary'), ...eyes('head', 21, 6)] };
      break;
    case 'vehicle':
      c = { mobility: 'wheels', body: { shape: 'rounded_box', size: [92, 120, 44] }, standH: 4, joints: P.panTilt || claw
        ? [J({ name: 'head', face: '+z', at: [0, 20], point: 'axis', reach: 0, ...head('sphere', [44, 40, 40]), range: [-60, 60] })] : [],
      features: eyes('body', 62, 4) };
      break;
    case 'snake':
      c = { mobility: 'none', body: body('egg', claw ? [56, 76, 60] : [46, 70, 42]), standH: 10, joints: [
        J({ name: 'segment_1', face: '+z', at: [0, -30], point: 'back', reach: 36, shape: 'capsule', size: [28, 44, 24] }),
        // (a second segment's servo would cut the first one apart under the Claw body's taller strut)
        ...(claw ? [] : [J({ name: 'segment_2', parent: 'segment_1', face: '+z', at: [0, -14], point: 'back', reach: 34, shape: 'capsule', size: [22, 40, 18] })]),
      ], features: [] };
      break;
    case 'arm':
      // a tall turning base, so the shoulder servo sits in it above the base servo's horn
      c = { mobility: 'none', body: body('cylinder', [56, 56, 36]), standH: 10, joints: [
        // (the shoulder sits a little below the base's middle, so its servo's long side runs up, away from the base servo)
        // ('base' is the robot's base link: the turning joint needs another name)
        J({ name: 'turret', face: '+z', point: 'axis', reach: 0, shape: 'cylinder', size: [52, 52, 40], range: [-90, 90] }),
        J({ name: 'shoulder', parent: 'turret', face: '+x', at: [0, -6], point: 'up', reach: 46, shape: 'capsule', size: [12, 14, 56], range: [-60, 60] }),
        J({ name: 'elbow', parent: 'shoulder', face: '+x', at: [0, 22], point: 'up', reach: 38, shape: 'capsule', size: [10, 12, 44], range: [-70, 70] }),
        J({ name: 'gripper', parent: 'elbow', face: '+x', at: [0, 18], point: 'front', reach: 14, shape: 'wedge', size: [8, 26, 12], range: [-30, 30] }),
      ], features: [] };
      break;
    case 'lever':
      c = { mobility: 'none', body: { shape: 'rounded_box', size: [50, 44, 44] }, standH: 10, joints: [
        J({ name: 'lever', face: '+x', at: [0, 8], point: 'front', reach: 56, shape: 'box', size: [6, 90, 8], range: [0, 85] }),
      ], features: [] };
      break;
    case 'rotor':
      // with a screen on the front the rotor turns on the side, so it never covers the face
      c = faced
        ? { mobility: 'none', body: body('rounded_box', [64, 56, 72]), standH: 16, joints: [
            J({ name: 'rotor', face: '+x', at: [0, 8], kind: 'spin', range: [0, 0], point: 'axis', reach: 0, shape: 'disc', size: [6, 80, 80] }),
          ], features: [] }
        : { mobility: 'none', body: { shape: 'rounded_box', size: [50, 40, 56] }, standH: 16, joints: [
            J({ name: 'rotor', face: '+y', at: [0, 6], kind: 'spin', range: [0, 0], point: 'axis', reach: 0, shape: 'disc', size: [96, 6, 96] }),
          ], features: [] };
      break;
    case 'turntable':
      c = { mobility: 'none', body: body('cylinder', claw ? [84, 84, 64] : [80, 80, 20]), standH: 4, joints: [
        J({ name: 'platter', face: '+z', kind: 'spin', range: [0, 0], point: 'axis', reach: 0, shape: 'disc', size: [96, 96, 6] }),
      ], features: [] };
      break;
    default:
      c = { mobility: 'none', body: body('rounded_box', [64, 56, 52]), standH: 18, joints: [
        J({ name: 'head', face: '+z', point: 'axis', reach: 0, ...head('sphere', [48, 44, 44]), range: [-60, 60] }),
        ...(P.hasArms ? [-1, 1].map(s => J({ name: s < 0 ? 'arm_l' : 'arm_r', face: s < 0 ? '-x' : '+x', at: [0, -10], point: 'down', reach: 18, shape: 'capsule', size: [10, 10, 34], range: [-60, 60] })) : []),
      ], features: eyes('head', 22, 6) };
  }
  return normalizeComposition({ use: true, ...c });
}

/** The spec as a generic composition (family pattern), keeping its name, colours, theme and params. */
export function withPattern(spec: RobotSpec, platform?: Platform): RobotSpec {
  if (spec.composition?.use) return spec;
  return { ...spec, composition: patternComposition(spec, platform) };
}
