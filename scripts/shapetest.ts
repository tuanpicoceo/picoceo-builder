// The composer's shape library (src/cad/shapes.ts): every shape fills the size it is given (bounding box within 2 %),
// is one closed solid, and insets into an even shell (`erode`) with room inside. Then every shape is built as the body
// of a desk robot that talks (screen + mic + speaker): on the LicheeRV Claw kit (the module is the body's face) and
// on a XiaoZhi voice core (sled, battery, face block inside the shell), and as a Claw head on a turning neck.
// Usage: tsx scripts/shapetest.ts [unit]   ("unit" = only the per-shape geometry checks)
import { initKernel } from '../src/cad/kernel';
import { buildAssembly } from '../src/cad/build';
import { erode, shapeSolid } from '../src/cad/shapes';
import { normalizeSpec, SHAPES, type ShapeKind } from '../src/design/spec';
// @ts-expect-error plain ESM server module
import { SHAPE_ENUM } from '../server/design.mjs';

await initKernel();
let fails = 0;
const fail = (m: string) => { fails++; console.log('FAIL', m); };

if (SHAPES.length < 50) fail(`only ${SHAPES.length} shapes`);
const enumOk = JSON.stringify([...SHAPE_ENUM]) === JSON.stringify([...SHAPES]);
if (!enumOk) fail('server SHAPE_ENUM differs from spec SHAPES');

// ---- geometry of each shape
const size: [number, number, number] = [80, 60, 90];
for (const k of SHAPES) {
  const m = shapeSolid(k, [5, -3, 50], size);
  const q = m.boundingBox();
  const got = [0, 1, 2].map(i => q.max[i] - q.min[i]);
  const off = got.map((g, i) => Math.abs(g - size[i]) / size[i]);
  const pieces = m.decompose().length;
  const inner = erode(m, 2.4);
  const ratio = inner.volume() / m.volume();
  const bad = [off.some(o => o > 0.02) ? `size ${got.map(v => v.toFixed(0)).join('×')}` : '', pieces !== 1 ? `${pieces} pieces` : '',
    m.volume() <= 0 ? 'no volume' : '', ratio < 0.3 ? `inset keeps ${(ratio * 100).toFixed(0)} %` : ''].filter(Boolean);
  if (bad.length) fail(`${k}: ${bad.join(', ')}`); else console.log('PASS', k, `inset ${(ratio * 100).toFixed(0)} %`);
}

// ---- desk robots
if (process.argv[2] !== 'unit') {
  const fat = (k: ShapeKind): [number, number, number] => (['star', 'heart', 'crescent', 'cross', 'leaf', 'shield', 'wing', 'stadium', 'semicircle', 'petal', 'bubble'].includes(k) ? [100, 70, 100] : [80, 70, 90]);
  const run = (tag: string, raw: Record<string, unknown>, voice?: Record<string, unknown>) => {
    const { spec: s0 } = normalizeSpec(raw);
    const spec = voice ? { ...s0, voice } as typeof s0 : s0;
    try {
      const a = buildAssembly(spec);
      const bad = a.checks.filter(c => c.status === 'fail');
      if (bad.length) fail(`${tag}: ${bad.map(c => `${c.label}: ${c.detail.slice(0, 120)}`).join(' | ')}`);
      else console.log('PASS', tag, `${a.parts.length} parts ${a.dims.w.toFixed(0)}×${a.dims.d.toFixed(0)}×${a.dims.h.toFixed(0)}`);
    } catch (e) { fail(`${tag}: threw ${(e as Error).message}`); }
  };
  // `tsx scripts/shapetest.ts bowl,saucer` builds only those shapes
  const only = process.argv[2]?.split(',');
  for (const k of SHAPES.filter(s => !only || only.includes(s))) {
    const body = { shape: k, size: fat(k) };
    run(`${k} [claw body face]`, { archetype: `${k}_buddy`, platform: 'licheerv_claw', composition: { use: true, body, standH: 10, joints: [], features: [] } });
    run(`${k} [xiaozhi voice body]`, { archetype: `${k}_buddy`, platform: 'xiaozhi', composition: { use: true, body, standH: 0, joints: [], features: [] } }, {});
    run(`${k} [claw head]`, { archetype: `${k}_head_bot`, platform: 'licheerv_claw', composition: { use: true, body: { shape: 'rounded_box', size: [70, 60, 40] }, standH: 10, features: [],
      joints: [{ name: 'head', parent: 'body', face: '+z', at: [0, 0], kind: 'swing', range: [-45, 45], point: 'axis', reach: 0, shape: k, size: fat(k).map(v => v * 0.8) }] } });
  }
}
console.log(fails ? `shapetest: ${fails} failure(s) over ${SHAPES.length} shapes` : `shapetest: OK - ${SHAPES.length} shapes`);
process.exit(fails ? 1 : 0);
