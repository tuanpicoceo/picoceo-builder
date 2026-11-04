// Generic design patterns (src/design/patterns.ts): every robot family, as a prebuilt-type spec, becomes a composition
// that builds on CyberBrick, the LicheeRV Claw kit and a Raspberry Pi voice core with no failing check.
import { initKernel } from '../src/cad/kernel';
import { buildAssembly } from '../src/cad/build';
import { normalizeSpec, type Platform } from '../src/design/spec';
import { familyOf, withPattern } from '../src/design/patterns';

const ideas: [string, Record<string, unknown>][] = [
  ['humanoid', {}], ['duck', { headFeature: 'beak' }], ['dog', { hasTail: true, headFeature: 'ears' }], ['rover', { panTilt: true }],
  ['snake', {}], ['arm', {}], ['barrier_gate', {}], ['smart_fan', {}], ['turntable', {}], ['companion', { hasArms: true }],
];
const platforms: (Platform | undefined)[] = [undefined, 'licheerv_claw', 'rpi'];

await initKernel();
let fails = 0;
for (const platform of platforms) for (const [archetype, params] of ideas) {
  const { spec: base } = normalizeSpec({ archetype, params });
  const pat = withPattern(base, platform);
  const { spec } = normalizeSpec({ ...pat, platform });
  const tag = `${archetype} [${platform ?? 'cyberbrick'}] ${familyOf(base)}`;
  if (!spec.composition?.use) { fails++; console.log('FAIL', tag, 'not composed'); continue; }
  try {
    const a = buildAssembly(spec);
    const bad = a.checks.filter(c => c.status === 'fail');
    if (bad.length) fails++;
    console.log(bad.length ? 'FAIL' : 'PASS', tag, `${spec.composition.mobility}, ${spec.composition.joints.length} joints, ${a.parts.length} parts`,
      bad.map(c => `${c.label}: ${c.detail.slice(0, 140)}`).join(' | '));
  } catch (e) { fails++; console.log('FAIL', tag, 'threw', (e as Error).message); }
}
console.log(fails ? `patterntest: ${fails} failure(s)` : 'patterntest: OK');
process.exit(fails ? 1 : 0);
