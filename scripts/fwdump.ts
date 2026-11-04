// Writes generated firmware for each archetype to <outdir>/<variant>/ so it can be syntax-checked
// (and run by scripts/robot/test_linux_app.py for the voice_* variants).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initKernel } from '../src/cad/kernel';
import { buildAssembly } from '../src/cad/build';
import type { Assembly, BuiltComponent } from '../src/cad/types';
import { normalizeSpec, type RobotSpec } from '../src/design/spec';
import { analyze } from '../src/design/analysis';
import { behaviorsFor } from '../src/design/behaviors';
import { firmwareFiles } from '../src/design/firmware';

/** Stand-in when the CAD for a platform does not build yet: a pan / tilt head on two servos. */
function minimalAssembly(): Assembly {
  const link = (id: string, parent: string | null, port?: string, limit?: [number, number]) => ({
    id, name: id, parent, colliders: [], massG: 10, com: [0, 0, 0] as [number, number, number],
    ...(port ? { joint: { origin: [0, 0, 0] as [number, number, number], axis: [0, 0, 1] as [number, number, number], limit, actuator: { kind: 'servo' as const, catalogId: 'B-PG001', port, label: id } } } : {}),
  });
  return {
    meta: {}, parts: [], components: [], checks: [], fasteners: [], extras: [], assemblySteps: [], dims: { w: 0, d: 0, h: 0 }, buildMs: 0,
    links: [link('base', null), link('pan', 'base', 'S1', [-90, 90]), link('tilt', 'pan', 'S2', [-15, 35])],
  };
}

const comp = (catalogId: string): BuiltComponent => ({
  key: `test_${catalogId}`, catalogId, label: catalogId, link: 'base', color: '#888888', center: [0, 0, 0],
  mesh: { positions: new Float32Array(0), indices: new Uint32Array(0) } as unknown as BuiltComponent['mesh'],
});
const DISPLAYS = ['PICOCLAW-BOARD', 'LCD-GC9A01-128', 'LCD-ST7789-169', 'LCD-ST7789-20', 'OLED-SSD1306'];
const SERVO_BOARDS = ['PCA9685-SERVO-16', 'SHIELD-ESP32-SERVO', 'WAVESHARE-SERVO-HAT', 'ADAFRUIT-SERVO-BONNET', 'BUS-SERVO-ADAPTER'];

type Variant = [string, Record<string, unknown>, { add?: string[]; noDisplay?: boolean; noServoBoard?: boolean }?];

await initKernel();
const out = process.argv[2];
const variants: Variant[] = [
  ['rover', { archetype: 'rover', params: { panTilt: true } }], ['rover_gm', { archetype: 'rover', params: { drive: 'B-GM001' } }],
  ['arm', { archetype: 'arm' }], ['companion', { archetype: 'companion' }],
  ['lift', { archetype: 'lift' }], ['fan', { archetype: 'smart_fan' }], ['gate', { archetype: 'barrier_gate' }], ['scara', { archetype: 'scara_plotter' }],
  ['composed_fish', { archetype: 'robot_fish', composition: { use: true, body: { shape: 'egg', size: [50, 110, 55] }, standH: 30,
    joints: [{ name: 'tail', parent: 'body', face: '+z', at: [0, -38], kind: 'swing', range: [-35, 35], point: 'back', reach: 40, shape: 'fin', size: [4, 40, 44] },
      { name: 'dial', parent: 'body', face: '+x', at: [0, 0], kind: 'spin', range: [0, 0], point: 'axis', reach: 0, shape: 'disc', size: [4, 30, 30] }], features: [] } }],
  // LicheeRV Claw kit: Linux Python app package
  ['claw_companion', { archetype: 'companion', platform: 'licheerv_claw' }], ['claw_lift', { archetype: 'lift', platform: 'licheerv_claw' }],
  ['claw_fan', { archetype: 'smart_fan', platform: 'licheerv_claw' }],
  ['claw_pet', { archetype: 'claw_pet', platform: 'licheerv_claw', composition: { use: true, body: { shape: 'egg', size: [60, 50, 60] }, standH: 10, joints: [], features: [] } }],
  // voice robots (MCP backbone clients). Extra components pin the hardware the test harness expects.
  ['voice_claw', { name: 'Voice Claw', archetype: 'companion', platform: 'licheerv_claw' }],
  ['voice_claw_duck', { name: 'Micro Duck', archetype: 'micro_duck', platform: 'licheerv_claw', behaviors: ['walk', 'bow', 'nod'], composition: { use: true, mobility: 'legs', standH: 5, features: [],
    body: { shape: 'egg', size: [70, 60, 45] }, joints: [
      { name: 'neck', parent: 'body', face: '+x', at: [-5, 8], kind: 'swing', range: [-30, 30], point: 'up', reach: 45, shape: 'capsule', size: [12, 14, 50] },
      { name: 'head', parent: 'neck', face: '+x', at: [0, 18], kind: 'swing', range: [-30, 30], point: 'up', reach: 30, shape: 'rounded_box', size: [60, 72, 46] }] } }],
  ['voice_claw_roam', { name: 'Claw Roamer', archetype: 'claw_roamer', platform: 'licheerv_claw', composition: { use: true, mobility: 'wheels', standH: 10, features: [],
    body: { shape: 'egg', size: [70, 60, 80] }, joints: [{ name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-45, 45], point: 'up', reach: 0, shape: 'sphere', size: [44, 36, 52] }] } }],
  ['voice_rpi', { name: 'Voice Pi', archetype: 'companion', platform: 'rpi' }, { add: ['LCD-ST7789-20', 'RESPEAKER-2MIC-HAT', 'PCA9685-SERVO-16', 'B-KB003'], noDisplay: true, noServoBoard: true }],
  ['voice_rpi_bus', { name: 'Voice Pi Bus', archetype: 'companion', platform: 'rpi' }, { add: ['USB-MIC-MINI', 'BUS-SERVO-ADAPTER'], noDisplay: true, noServoBoard: true }],
  ['voice_rpi_drive', { name: 'Voice Pi Drive', archetype: 'sky_buddy', platform: 'rpi', composition: { use: true, mobility: 'wheels', wheelCount: 4,
    body: { shape: 'rounded_box', size: [110, 110, 80] }, standH: 0, features: [],
    joints: [{ name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-45, 45], point: 'up', reach: 0, shape: 'sphere', size: [40, 36, 36] }] } },
    { add: ['LCD-ST7789-20', 'RESPEAKER-2MIC-HAT', 'PCA9685-SERVO-16'], noDisplay: true, noServoBoard: true }],
  ['voice_rpi_n20', { name: 'Voice Pi N20', archetype: 'sky_buddy', platform: 'rpi', voice: { driveMotor: 'N20-MOTOR', motorDriver: 'DRV8833-DRIVER' },
    composition: { use: true, mobility: 'wheels', wheelCount: 4, body: { shape: 'rounded_box', size: [110, 110, 80] }, standH: 0, features: [],
      joints: [{ name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-45, 45], point: 'up', reach: 0, shape: 'sphere', size: [40, 36, 36] }] } },
    { add: ['LCD-ST7789-20', 'RESPEAKER-2MIC-HAT', 'PCA9685-SERVO-16'], noDisplay: true, noServoBoard: true }],
  ['voice_jetson', { name: 'Voice Jetson', archetype: 'companion', platform: 'jetson' }, { add: ['USB-MIC-MINI', 'PCA9685-SERVO-16'], noDisplay: true, noServoBoard: true }],
  ['voice_xiaozhi', { name: 'Voice XiaoZhi', archetype: 'companion', platform: 'xiaozhi' }, { add: ['LCD-GC9A01-128', 'MIC-INMP441', 'AMP-MAX98357A', 'PCA9685-SERVO-16'], noDisplay: true, noServoBoard: true }],
  ['voice_xiaozhi_oled', { name: 'Voice XiaoZhi OLED', archetype: 'companion', platform: 'xiaozhi' }, { add: ['OLED-SSD1306', 'MIC-INMP441', 'AMP-MAX98357A'], noDisplay: true, noServoBoard: true }],
];

for (const [name, raw, opt] of variants) {
  // the voice parts (spec.voice) ride along past normalizeSpec, as the app's withPlatform sets them
  const spec: RobotSpec = raw.voice ? { ...normalizeSpec(raw).spec, voice: raw.voice } as RobotSpec : normalizeSpec(raw).spec;
  let a: Assembly;
  let fallback = false;
  try {
    a = buildAssembly(spec);
  } catch (e) {
    if (!name.startsWith('voice_')) throw e;
    console.warn(`${name}: buildAssembly failed (${(e as Error).message}), using a minimal pan / tilt assembly`);
    a = minimalAssembly();
    fallback = true;
  }
  if (opt) {
    a = { ...a, components: a.components.filter(c => !(opt.noDisplay && DISPLAYS.includes(c.catalogId)) && !(opt.noServoBoard && SERVO_BOARDS.includes(c.catalogId))) };
    a.components.push(...(opt.add ?? []).map(comp));
  }
  let topSpeed = 0.15;
  try { topSpeed = analyze(spec, a).totals.topSpeed ?? 0.15; } catch { /* minimal assembly */ }
  const fw = firmwareFiles(spec, a, behaviorsFor(spec, { trackMm: a.meta.trackMm ?? 80, topSpeed }));
  mkdirSync(join(out, name), { recursive: true });
  for (const [f, src] of Object.entries(fw)) writeFileSync(join(out, name, f), src);
  if (name.startsWith('voice_')) {
    writeFileSync(join(out, name, '_variant.json'), JSON.stringify({ platform: spec.platform ?? 'cyberbrick', fallback, components: a.components.map(c => c.catalogId) }));
  }
}
