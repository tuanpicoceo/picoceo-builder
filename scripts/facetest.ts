// LicheeRV Claw: every robot with a head carries the Claw module as its face. Checks the LCD (central 24 x 24 mm of
// the window) is unobstructed from the front at the zero pose by sampling every triangle of every other mesh.
import { initKernel } from '../src/cad/kernel';
import { buildAssembly } from '../src/cad/build';
import { normalizeSpec } from '../src/design/spec';

await initKernel();
const comp = (o: object) => ({ composition: { use: true, standH: 10, features: [], ...o } });
const cases: [string, object, object?][] = [
  ['companion', {}], ['desk_agent', { headFeature: 'ears' }], ['rover', {}], ['rover', { panTilt: true }], ['rover', { mountType: 'phone_stand', hasMagnetPockets: true, mountAngle: 65 }],
  ['humanoid', {}], ['humanoid', { headFeature: 'visor', hasArms: true }], ['chicken', { theme: 'chicken', headFeature: 'beak', hasWings: true }],
  ['quadruped', { theme: 'dog', headFeature: 'ears', hasTail: true }], ['snake', {}],
  ['claw_pet', {}, comp({ body: { shape: 'egg', size: [60, 50, 60] }, joints: [] })],
  ['owl', {}, comp({ body: { shape: 'egg', size: [56, 50, 70] }, joints: [{ name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-60, 60], point: 'up', reach: 0, shape: 'sphere', size: [50, 46, 46] }] })],
  ['analog_clock', {}, comp({ body: { shape: 'disc', size: [110, 12, 110] }, standH: 20, joints: [{ name: 'hand', parent: 'body', face: '+y', at: [0, 0], kind: 'spin', range: [0, 0], point: 'up', reach: 24, shape: 'box', size: [5, 3, 44] }] })],
];
// Voice robots (XiaoZhi / Pi / Jetson): the display in the face block of the front cover, with and without servos
const VHEAD = { name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-45, 45], point: 'up', reach: 0, shape: 'sphere', size: [40, 36, 36] };
const VARMS = [
  { name: 'arm_l', parent: 'body', face: '-x', at: [0, 10], kind: 'swing', range: [-40, 40], point: 'down', reach: 20, shape: 'capsule', size: [8, 10, 34] },
  { name: 'arm_r', parent: 'body', face: '+x', at: [0, 10], kind: 'swing', range: [-40, 40], point: 'down', reach: 20, shape: 'capsule', size: [8, 10, 34] },
];
const voice = (platform: string, shape: string, size: number[], joints: object[], display?: string) =>
  ['voice_bot', {}, { platform, ...(display ? { voice: { display } } : {}), composition: { use: true, standH: 0, features: [], body: { shape, size }, joints } }] as [string, object, object];
// covers in front of a face (a visor on the body, a plate on the body rising in front of the head's screen, a shield
// on a voice body): features are cut back so the screen stays clear
cases.push(
  ['visor_bot', {}, comp({ body: { shape: 'cat_head', size: [80, 60, 80] }, joints: [], features: [{ parent: 'body', shape: 'box', size: [70, 10, 70], at: [0, 34, 0], color: 'accent' }] })],
  ['tall_plate_bot', {}, comp({ body: { shape: 'rounded_box', size: [70, 60, 40] }, joints: [{ name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-45, 45], point: 'axis', reach: 0, shape: 'crt', size: [64, 56, 60] }],
    features: [{ parent: 'body', shape: 'shield', size: [60, 6, 120], at: [0, 34, 40], color: 'accent' }] })],
  ['voice_bot', {}, { platform: 'xiaozhi', composition: { use: true, standH: 0, body: { shape: 'cloud', size: [100, 80, 90] }, joints: [], features: [{ parent: 'body', shape: 'shield', size: [70, 8, 70], at: [0, 44, 0], color: 'accent' }] } }],
);
cases.push(
  voice('xiaozhi', 'rounded_box', [80, 70, 70], []), voice('xiaozhi', 'egg', [100, 90, 110], [VHEAD, VARMS[0]]),
  voice('xiaozhi', 'rounded_box', [80, 70, 70], [VHEAD], 'LCD-ST7789-169'), voice('xiaozhi', 'rounded_box', [80, 70, 70], [], 'OLED-SSD1306'),
  voice('rpi', 'rounded_box', [110, 100, 80], []), voice('rpi', 'prism', [140, 110, 120], [VHEAD, ...VARMS]),
  voice('rpi', 'egg', [120, 110, 140], [VHEAD], 'LCD-GC9A01-128'),
  voice('jetson', 'rounded_box', [125, 120, 90], [VHEAD, ...VARMS]), voice('jetson', 'egg', [140, 130, 150], [], 'LCD-ST7789-20'),
);
let blocked = 0;
type Mesh = { positions: ArrayLike<number>; indices: ArrayLike<number> };
for (const [a, p, e] of cases) {
  const ex = (e ?? {}) as { platform?: string; voice?: object };
  const { spec: s0 } = normalizeSpec({ archetype: a, params: p, platform: 'licheerv_claw', ...e });
  const spec = ex.voice ? { ...s0, voice: ex.voice } as typeof s0 : s0;
  const asm = buildAssembly(spec);
  const lcd = asm.components.find(c => c.catalogId === 'PICOCLAW-BOARD' || c.key === 'voice_display');
  if (!lcd) { console.log(`NO FACE ${a} [${spec.platform}]`); blocked++; continue; }
  const P = lcd.mesh.positions; let maxY = -1e9;
  for (let i = 1; i < P.length; i += 3) maxY = Math.max(maxY, P[i]);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < P.length; i += 3) if (P[i + 1] > maxY - 0.3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // Claw: central 24 x 24 of the 27.7 mm window; voice displays: the central 70 % of the glass (inside a round one too)
  const hx = lcd.catalogId === 'PICOCLAW-BOARD' ? 12 : 0.35 * (x1 - x0), hz = lcd.catalogId === 'PICOCLAW-BOARD' ? 12 : 0.35 * (z1 - z0);
  x0 = cx - hx; x1 = cx + hx; z0 = cz - hz; z1 = cz + hz;
  const hits = new Map<string, number>();
  const test = (name: string, m: Mesh) => {
    const q = m.positions, I = m.indices; let n = 0;
    for (let t = 0; t < I.length; t += 3) {
      const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
      for (let u = 0; u <= 6; u++) for (let v = 0; v <= 6 - u; v++) {
        const w = 6 - u - v;
        const x = (q[A] * u + q[B] * v + q[C] * w) / 6, y = (q[A + 1] * u + q[B + 1] * v + q[C + 1] * w) / 6, z = (q[A + 2] * u + q[B + 2] * v + q[C + 2] * w) / 6;
        if (y > maxY + 0.05 && x > x0 && x < x1 && z > z0 && z < z1) n++;
      }
    }
    if (n) hits.set(name, n);
  };
  for (const pt of asm.parts) test(pt.name, pt.mesh);
  for (const c of asm.components) if (c !== lcd) test(c.label, c.mesh);
  if (hits.size) blocked++;
  console.log(`${hits.size ? 'BLOCKED' : 'clear  '} ${a} [${spec.platform}${ex.voice ? ' ' + lcd.catalogId : ''}] ${JSON.stringify(p)}  LCD at y ${maxY.toFixed(1)}${hits.size ? ' by ' + [...hits.keys()].join(', ') : ''}`);
}
console.log(blocked ? `facetest: ${blocked} face(s) blocked` : `facetest: OK - all ${cases.length} faces (Claw + voice displays) are clear`);
process.exit(blocked ? 1 : 0);
