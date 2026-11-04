// Builds every archetype (and a few parameter variants) in Node and prints the geometric checks.
import { readFileSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { buildAssembly } from '../src/cad/build';
import { normalizeSpec, type Archetype } from '../src/design/spec';

// Optional argument: a JSON variant list, or a path to a .json file holding one (easier to quote on Windows).
const arg = process.argv[2];
// Free-form compositions (src/cad/composer.ts) for ideas no dedicated builder matches.
const C = {
  fish: { composition: { use: true, body: { shape: 'egg', size: [50, 110, 55] }, standH: 30,
    joints: [{ name: 'tail', parent: 'body', face: '+z', at: [0, -38], kind: 'swing', range: [-35, 35], point: 'back', reach: 40, shape: 'fin', size: [4, 40, 44] }],
    features: [{ parent: 'body', shape: 'fin', size: [3, 34, 22], at: [0, -5, 30], color: 'accent' },
      { parent: 'body', shape: 'fin', size: [22, 16, 3], at: [-28, 12, -6], color: 'accent' }, { parent: 'body', shape: 'fin', size: [22, 16, 3], at: [28, 12, -6], color: 'accent' },
      { parent: 'body', shape: 'led', size: [6, 6, 3], at: [-12, 0, 8], color: 'primary' }, { parent: 'body', shape: 'led', size: [6, 6, 3], at: [12, 0, 8], color: 'primary' }] } },
  clock: { composition: { use: true, body: { shape: 'disc', size: [110, 12, 110] }, standH: 20,
    joints: [{ name: 'hand', parent: 'body', face: '+y', at: [0, 0], kind: 'spin', range: [0, 0], point: 'up', reach: 24, shape: 'box', size: [5, 3, 44] }],
    features: [[0, 45], [45, 0], [0, -45], [-45, 0]].map(([x, z]) => ({ parent: 'body', shape: 'box', size: [4, 2, 8], at: [x, 6.5, z], color: 'accent' })) } },
  waterer: { composition: { use: true, body: { shape: 'cylinder', size: [60, 60, 70] }, standH: 10,
    joints: [
      { name: 'arm', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-60, 60], point: 'front', reach: 50, shape: 'capsule', size: [10, 44, 10] },
      { name: 'nozzle', parent: 'arm', face: '+y', at: [0, 0], kind: 'swing', range: [-40, 40], point: 'down', reach: 22, shape: 'cone', size: [10, 10, 22] },
    ],
    features: [{ parent: 'body', shape: 'cylinder', size: [40, 40, 6], at: [0, 0, 38], color: 'accent' }] } },
  hand: { composition: { use: true, body: { shape: 'rounded_box', size: [50, 40, 60] }, standH: 20,
    joints: [{ name: 'shoulder', parent: 'body', face: '+x', at: [0, 10], kind: 'swing', range: [-30, 80], point: 'up', reach: 45, shape: 'rounded_box', size: [8, 32, 40] }],
    features: [0, 1, 2, 3].map(i => ({ parent: 'shoulder', shape: 'capsule', size: [7, 7, 24], at: [0, -12 + i * 8, 30], color: 'primary' })) } },
  // mobile compositions: the body rides the rover chassis
  ladybug: { composition: { use: true, mobility: 'wheels', body: { shape: 'sphere', size: [96, 104, 46] }, standH: 10,
    joints: [{ name: 'antennae', parent: 'body', face: '+y', at: [0, 6], kind: 'swing', range: [-30, 30], point: 'up', reach: 22, shape: 'capsule', size: [30, 5, 5] }],
    features: [[-22, 10], [22, 10], [-18, -22], [18, -22], [0, -40]].map(([x, y]) => ({ parent: 'body', shape: 'sphere', size: [14, 14, 6], at: [x, y, 21], color: 'accent' }))
      .concat([{ parent: 'body', shape: 'led', size: [6, 6, 3], at: [-14, 0, 4], color: 'primary' }, { parent: 'body', shape: 'led', size: [6, 6, 3], at: [14, 0, 4], color: 'primary' }]) } },
  sharkcar: { composition: { use: true, mobility: 'wheels', body: { shape: 'capsule', size: [44, 120, 40] }, standH: 6,
    joints: [
      { name: 'tail', parent: 'body', face: '+z', at: [0, -45], kind: 'swing', range: [-30, 30], point: 'back', reach: 38, shape: 'fin', size: [4, 34, 40] },
      { name: 'jaw', parent: 'body', face: '+x', at: [40, -8], kind: 'swing', range: [-25, 5], point: 'front', reach: 18, shape: 'wedge', size: [6, 26, 10] },
    ],
    features: [{ parent: 'body', shape: 'fin', size: [4, 34, 30], at: [0, 0, 30], color: 'accent' },
      { parent: 'body', shape: 'fin', size: [30, 20, 4], at: [-26, 10, -6], color: 'accent' }, { parent: 'body', shape: 'fin', size: [30, 20, 4], at: [26, 10, -6], color: 'accent' }] } },
};

/** Voice-robot joints: a head on top, two arms, and an antenna spinning on the head. */
const VJ = [
  { name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-45, 45], point: 'up', reach: 0, shape: 'sphere', size: [40, 36, 36] },
  { name: 'arm_l', parent: 'body', face: '-x', at: [0, 10], kind: 'swing', range: [-40, 40], point: 'down', reach: 20, shape: 'capsule', size: [8, 10, 34] },
  { name: 'arm_r', parent: 'body', face: '+x', at: [0, 10], kind: 'swing', range: [-40, 40], point: 'down', reach: 20, shape: 'capsule', size: [8, 10, 34] },
  { name: 'antenna', parent: 'head', face: '+z', at: [0, 0], kind: 'spin', range: [0, 0], point: 'axis', reach: 0, shape: 'disc', size: [24, 24, 4] },
];

const variants: [Archetype, Record<string, unknown>, Record<string, unknown>?][] = (arg ? JSON.parse((arg.endsWith('.json') ? readFileSync(arg, 'utf8') : arg).replace(/^﻿/, '')) : [
  ['rover', {}],
  ['rover', { panTilt: true, leds: 6 }],
  ['rover', { drive: 'B-GM001', wheelDia: 44, bumper: false, tpuTires: false }],
  ['rover', { wheelDia: 90, wheelWidth: 24, panTilt: true }],
  ['arm', {}],
  ['arm', { upperLen: 100, foreLen: 100, payloadG: 80 }],
  ['companion', {}],
  ['humanoid', {}],
  ['humanoid', { hasArms: true, leds: 4 }],
  ['humanoid', { theme: 'duck', headFeature: 'beak', footStyle: 'webbed', hasTail: true, hasWings: true, leds: 2 }],
  ['chicken', { theme: 'chicken', headFeature: 'beak', footStyle: 'wide', hasTail: true, hasWings: true, leds: 2 }],
  ['humanoid', { theme: 'cat', headFeature: 'ears', hasTail: true, leds: 2 }],
  ['quadruped', { theme: 'dog', headFeature: 'ears', hasTail: true, leds: 2 }],
  ['snake', {}],
  ['desk_agent', {}],
  ['turntable', {}],
  ['rover', { mountType: 'phone_stand', hasMagnetPockets: true, mountAngle: 65 }],
  ['barrier_gate', {}],
  ['barrier_gate', { leverLen: 180, pivotH: 44 }],
  ['catapult', { leverLen: 50, leds: 4 }],
  ['flag_waver', { leverTool: 'flag', leverLen: 120, pivotH: 90 }],
  ['pinball_flipper', { leverTool: 'paddle', leverLen: 70 }],
  ['smart_fan', {}],
  ['smart_fan', { rotorDia: 140, bladeCount: 8 }],
  ['windmill', { rotorDia: 60, bladeCount: 3 }],
  ['ferris_wheel', { rotorDia: 140, bladeCount: 8 }],
  ['paddle_wheel', { bladeCount: 2 }],
  ['pet_feeder', {}],
  ['candy_dispenser', { rotorDia: 140, bladeCount: 3 }],
  ['camera_slider', {}],
  ['linear_actuator', { stroke: 120, linearTool: 'table' }],
  ['lift', { stroke: 60 }],
  ['forklift', { stroke: 120 }],
  ['scara_plotter', {}],
  ['drawing_robot', { upperLen: 100, foreLen: 45 }],
  ['scara', { upperLen: 45, foreLen: 100 }],
  ['robot_fish', { leds: 2 }, C.fish],
  ['analog_clock', {}, C.clock],
  ['plant_waterer', {}, C.waterer],
  ['waving_hand', {}, C.hand],
  ['ladybug_bot', { leds: 4 }, C.ladybug],
  ['shark_car', { drive: 'B-GM001', wheelDia: 60 }, C.sharkcar],
  ['shark_car', { drive: 'B-PG002', wheelDia: 90, wheelWidth: 20 }, C.sharkcar],
  // LicheeRV Claw kit: Nano + PicoClaw console, servos on a PCA9685
  ...([
    ['companion', {}], ['desk_agent', {}], ['turntable', {}], ['arm', {}], ['barrier_gate', {}], ['smart_fan', {}],
    ['ferris_wheel', { rotorDia: 140, bladeCount: 8 }], ['pet_feeder', {}], ['camera_slider', {}], ['scara_plotter', {}],
    ['robot_fish', {}, C.fish], ['analog_clock', {}, C.clock], ['ladybug_bot', {}, C.ladybug],
    ['claw_pet', {}, { composition: { use: true, body: { shape: 'egg', size: [60, 50, 60] }, standH: 10, joints: [], features: [] } }],
    ['owl', {}, { composition: { use: true, body: { shape: 'egg', size: [56, 50, 70] }, standH: 10, features: [],
      joints: [{ name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-60, 60], point: 'up', reach: 0, shape: 'sphere', size: [50, 46, 46] }] } }],
    // a real AI design (Meta Muse, story-telling owl on the Pi voice kit): squat egg, low rear wings, head on top;
    // the core must fit by moving the wings up, the screen goes on the (grown) head, the speaker on the chest
    ...([['owl', { leds: 0 }, { platform: 'rpi', composition: { use: true, mobility: 'none', body: { shape: 'egg', size: [124, 112, 95] }, standH: 5,
      joints: [
        { name: 'wing_l', parent: 'body', face: '-x', at: [-58, -10], kind: 'swing', range: [-15, 45], point: 'back', reach: 35, shape: 'fin', size: [6, 70, 50] },
        { name: 'wing_r', parent: 'body', face: '+x', at: [58, -10], kind: 'swing', range: [-15, 45], point: 'back', reach: 35, shape: 'fin', size: [6, 70, 50] },
        { name: 'head', parent: 'body', face: '+z', at: [0, 10], kind: 'swing', range: [-90, 90], point: 'front', reach: 18, shape: 'sphere', size: [88, 78, 60] }],
      features: [{ parent: 'body', shape: 'rounded_box', size: [72, 18, 70], at: [0, 48, -5], color: 'accent' }, { parent: 'body', shape: 'disc', size: [30, 5, 30], at: [0, 52, -18], color: 'primary' },
        { parent: 'head', shape: 'disc', size: [70, 10, 52], at: [0, 30, 2], color: 'accent' }, { parent: 'head', shape: 'cone', size: [10, 14, 16], at: [0, 38, 0], color: 'primary' },
        { parent: 'head', shape: 'cone', size: [12, 12, 18], at: [-28, 5, 22], color: 'primary' }, { parent: 'head', shape: 'cone', size: [12, 12, 18], at: [28, 5, 22], color: 'primary' }] } }]] as [Archetype, Record<string, unknown>, Record<string, unknown>][]),
    // a hollow body that opens at a magnet seam; three bars placed in mid-air are pulled onto the body
    ['a_bot', {}, { composition: { use: true, body: { shape: 'egg', size: [70, 55, 90] }, standH: 10, joints: [], features: [
      { parent: 'body', shape: 'sphere', size: [22, 22, 22], at: [0, 0, 52], color: 'primary' },
      ...[[32, 12], [40, 0], [26, -12]].map(([w, z]) => ({ parent: 'body', shape: 'box', size: [w, 8, 8], at: [60, 0, z], color: 'primary' }))] } }],
    ['letter_a_bot', {}, { composition: { use: true, body: { shape: 'prism', size: [90, 50, 100] }, standH: 10, joints: [],
      features: [{ parent: 'body', shape: 'box', size: [60, 52, 8], at: [0, 0, -12], color: 'accent' }] } }],
    // the Claw module is the face of every head
    ['rover', {}], ['rover', { panTilt: true }], ['rover', { drive: 'B-GM001', wheelDia: 44 }], ['rover', { mountType: 'phone_stand', hasMagnetPockets: true, mountAngle: 65 }],
    ['humanoid', {}], ['humanoid', { hasArms: true }], ['chicken', { theme: 'chicken', headFeature: 'beak', footStyle: 'wide', hasTail: true, hasWings: true }],
    ['quadruped', { theme: 'dog', headFeature: 'ears', hasTail: true }], ['snake', {}],
  ] as [Archetype, Record<string, unknown>, Record<string, unknown>?][]).map(([a, p, e]) => [a, p, { ...e, platform: 'licheerv_claw' }]),
  // Voice robots (src/cad/voicecore.ts): XiaoZhi / Raspberry Pi / Jetson core in a standalone hollow body, with and
  // without a display face, 0 or 2-4 servo joints, three body shapes. `voice` overrides the kit-preset parts.
  ...(['xiaozhi', 'rpi', 'jetson'] as const).flatMap(platform => {
    const size = { xiaozhi: { rounded_box: [80, 70, 70], egg: [100, 90, 110], prism: [110, 80, 100] },
      rpi: { rounded_box: [110, 100, 80], egg: [120, 110, 140], prism: [140, 110, 120] },
      jetson: { rounded_box: [125, 120, 90], egg: [140, 130, 150], prism: [160, 130, 130] } }[platform];
    const v = (shape: keyof typeof size, joints: number, display: boolean, voice: Record<string, unknown> = {}) =>
      [`voice_${shape}_${joints}j${display ? '' : '_noface'}`, {}, { platform, voice: { ...voice, ...(display ? {} : { display: null }) },
        composition: { use: true, body: { shape, size: size[shape] }, standH: 0, features: [], joints: VJ.slice(0, joints) } }] as [Archetype, Record<string, unknown>, Record<string, unknown>];
    return [v('rounded_box', 0, true), v('rounded_box', 3, false), v('egg', 2, true), v('egg', 0, false), v('prism', 4, true), v('prism', 0, false)];
  }),
  // other boards / HAT stacks
  ['voice_zhaozhi', {}, { platform: 'xiaozhi', voice: { board: 'ZHAOZHI-AI-CORE', display: 'LCD-ST7789-169' }, composition: { use: true, body: { shape: 'rounded_box', size: [80, 70, 70] }, standH: 0, features: [], joints: VJ.slice(0, 2) } }],
  // LicheeRV Claw robots that drive: the body on its neck over the rover chassis (PCA9685 + continuous servos), the Claw the face of the body or head
  ['claw_roamer', {}, { platform: 'licheerv_claw', composition: { use: true, mobility: 'wheels', body: { shape: 'rounded_box', size: [80, 70, 50] }, standH: 10, features: [], joints: [] } }],
  ['claw_roamer', {}, { platform: 'licheerv_claw', composition: { use: true, mobility: 'wheels', wheelCount: 4, body: { shape: 'egg', size: [70, 60, 80] }, standH: 10, features: [],
    joints: [{ name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-45, 45], point: 'up', reach: 0, shape: 'sphere', size: [44, 36, 52] }] } }],
  // walking legs (Claw): a MicroDuck-style biped with a nodding neck and a head carrying the Claw screen, and a legged pet with no joints
  ['micro_duck', {}, { platform: 'licheerv_claw', composition: { use: true, mobility: 'legs', body: { shape: 'egg', size: [70, 60, 45] }, standH: 5, features: [],
    joints: [{ name: 'neck', parent: 'body', face: '+x', at: [-5, 8], kind: 'swing', range: [-30, 30], point: 'up', reach: 45, shape: 'capsule', size: [12, 14, 50] },
      { name: 'head', parent: 'neck', face: '+x', at: [0, 18], kind: 'swing', range: [-30, 30], point: 'up', reach: 30, shape: 'rounded_box', size: [60, 72, 46] }] } }],
  // what the AI made from the MicroDuck reference picture: a yaw neck and a big head on its side face (centred automatically)
  ['duck_from_reference', { leds: 0 }, { platform: 'licheerv_claw', composition: { use: true, mobility: 'legs', body: { shape: 'rounded_box', size: [72, 62, 48] }, standH: 28,
    joints: [{ name: 'neck', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-90, 90], point: 'front', reach: 12, shape: 'capsule', size: [14, 14, 55] },
      { name: 'head', parent: 'neck', face: '+x', at: [0, 0], kind: 'swing', range: [-35, 35], point: 'up', reach: 30, shape: 'rounded_box', size: [85, 75, 62] }],
    features: [{ parent: 'head', shape: 'prism', size: [68, 28, 20], at: [0, 38, -6], color: 'accent' }, { parent: 'head', shape: 'cylinder', size: [28, 28, 5], at: [-32, 18, 8], color: 'primary' },
      { parent: 'head', shape: 'cylinder', size: [28, 28, 5], at: [32, 18, 8], color: 'primary' }, { parent: 'body', shape: 'rounded_box', size: [22, 32, 38], at: [-30, -12, -22], color: 'primary' },
      { parent: 'body', shape: 'rounded_box', size: [22, 32, 38], at: [30, -12, -22], color: 'primary' }, { parent: 'body', shape: 'rounded_box', size: [50, 12, 28], at: [0, -28, 0], color: 'primary' }] } }],
  ['walking_pet', {}, { platform: 'licheerv_claw', composition: { use: true, mobility: 'legs', body: { shape: 'egg', size: [70, 60, 70] }, standH: 10, features: [], joints: [] } }],
  ['duck_cyberbrick', {}, { composition: { use: true, mobility: 'legs', body: { shape: 'egg', size: [60, 50, 50] }, standH: 10, features: [], joints: [] } }],
  // a head nodding on a pan block ("head" on "head_pan"): the face goes on the head at the end of the chain
  ['claw_pan_nod_rover', { leds: 2 }, { platform: 'licheerv_claw', composition: { use: true, mobility: 'wheels', body: { shape: 'rounded_box', size: [110, 130, 70] }, standH: 15,
    joints: [{ name: 'head_pan', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-90, 90], point: 'up', reach: 28, shape: 'rounded_box', size: [52, 52, 40] },
      { name: 'head', parent: 'head_pan', face: '+x', at: [0, 0], kind: 'swing', range: [-35, 35], point: 'up', reach: 62, shape: 'egg', size: [70, 66, 78] }],
    features: [{ parent: 'head', shape: 'led', size: [6, 6, 3], at: [-18, 28, 10], color: 'primary' }, { parent: 'head', shape: 'led', size: [6, 6, 3], at: [18, 28, 10], color: 'primary' }] } }],
  // voice robots that drive: a drive plate on continuous servos (2 wheels + skid, or 4 wheels)
  ['voice_drive2', {}, { platform: 'xiaozhi', voice: {}, composition: { use: true, mobility: 'wheels', wheelCount: 2, body: { shape: 'egg', size: [100, 90, 110] }, standH: 0, features: [], joints: VJ.slice(0, 1) } }],
  ['voice_drive4', {}, { platform: 'rpi', voice: {}, composition: { use: true, mobility: 'wheels', wheelCount: 4, body: { shape: 'rounded_box', size: [110, 110, 80] }, standH: 0, features: [], joints: VJ.slice(0, 3) } }],
  ['voice_drive2', {}, { platform: 'jetson', voice: {}, composition: { use: true, mobility: 'wheels', wheelCount: 2, body: { shape: 'rounded_box', size: [125, 120, 90] }, standH: 0, features: [], joints: VJ.slice(0, 1) } }],
  // GA12-N20 gear motors through an H-bridge on the servo board (DRV8833, TB6612FNG, and a missing driver)
  ['voice_n20_drive2', {}, { platform: 'xiaozhi', voice: { driveMotor: 'N20-MOTOR', motorDriver: 'DRV8833-DRIVER' }, composition: { use: true, mobility: 'wheels', wheelCount: 2, body: { shape: 'egg', size: [100, 90, 110] }, standH: 0, features: [], joints: VJ.slice(0, 1) } }],
  ['voice_n20_drive4', {}, { platform: 'rpi', voice: { driveMotor: 'N20-MOTOR', motorDriver: 'TB6612-DRIVER' }, composition: { use: true, mobility: 'wheels', wheelCount: 4, body: { shape: 'rounded_box', size: [110, 110, 80] }, standH: 0, features: [], joints: VJ.slice(0, 3) } }],
  ['voice_n20_nodriver', {}, { platform: 'jetson', voice: { driveMotor: 'N20-MOTOR' }, composition: { use: true, mobility: 'wheels', wheelCount: 2, body: { shape: 'rounded_box', size: [125, 120, 90] }, standH: 0, features: [], joints: VJ.slice(0, 1) } }],
  ['voice_pi4_ups', {}, { platform: 'rpi', voice: { board: 'RPI-4B', battery: 'UPS-HAT-PI', buck: null, servoBoard: 'WAVESHARE-SERVO-HAT', display: 'LCD-GC9A01-128' }, composition: { use: true, body: { shape: 'rounded_box', size: [110, 100, 90] }, standH: 0, features: [], joints: VJ.slice(0, 2) } }],
]);

await initKernel();
let failed = 0;
for (const [archetype, params, extra] of variants) {
  const { spec: base } = normalizeSpec({ archetype, params: { ...params }, ...extra });
  const spec = extra?.voice ? { ...base, voice: extra.voice } as typeof base : base;
  const voiceBuild = ['xiaozhi', 'rpi', 'jetson'].includes(spec.platform ?? '');
  try {
    const a = buildAssembly(spec);
    console.log(`\n== ${archetype}${spec.platform ? ` [${spec.platform}]` : ''} ${JSON.stringify(params)}  ${a.parts.length} parts, ${a.components.length} comps, ${a.buildMs.toFixed(0)} ms, ${a.dims.w.toFixed(0)}x${a.dims.d.toFixed(0)}x${a.dims.h.toFixed(0)} mm`);
    for (const c of a.checks) {
      console.log(`  [${c.status}] ${c.label}: ${c.detail}`);
      // voice builds must pass the geometric checks outright (a sweep or attachment warning counts as a failure)
      if (c.status === 'fail' || (voiceBuild && c.status !== 'pass' && ['watertight', 'interference', 'attached', 'access', 'sweep'].includes(c.id))) failed++;
    }
    console.log('  links: ' + a.links.map(l => `${l.id} ${l.massG.toFixed(0)}g`).join(', '));
  } catch (e) {
    failed++;
    console.log(`\n== ${archetype} ${JSON.stringify(params)} THREW`, e);
  }
}
console.log(failed ? `\n${failed} failure(s)` : '\nall builds pass');
process.exit(failed ? 1 : 0);
