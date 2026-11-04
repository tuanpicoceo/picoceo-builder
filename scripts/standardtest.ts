// Hardware design standard checks: every CATALOG id has a STANDARD entry, pockets are never smaller
// than the envelope, hole patterns fit inside the envelope (or the declared ear span).
// Run: npx tsx scripts/standardtest.ts

import { CATALOG } from '../src/catalog/components';
import { STANDARD, faceExtent, holeDia, standardCoverage, standardFor, pocketFor } from '../src/catalog/standard';

const errors: string[] = [];
const fail = (m: string) => errors.push(m);

const { covered, missing } = standardCoverage();
for (const id of missing) fail(`${id}: no STANDARD entry`);
for (const id of Object.keys(STANDARD)) if (!CATALOG[id]) fail(`${id}: STANDARD entry has no CATALOG item`);

for (const s of Object.values(STANDARD)) {
  const size = CATALOG[s.id]?.size;
  if (size && s.envelope.some((v, i) => v !== size[i])) fail(`${s.id}: envelope ${s.envelope} != catalog size ${size}`);
  s.pocket.forEach((p, i) => { if (p < s.envelope[i]) fail(`${s.id}: pocket[${i}] ${p} < envelope ${s.envelope[i]}`); });
  if (!s.rules.length) fail(`${s.id}: no rules`);
  if (!s.material.length) fail(`${s.id}: no material`);
  if (s.holes) {
    const h = s.holes;
    const [eu, ev] = s.span && (h.face ?? '-z')[1] === 'z' ? s.span : faceExtent(s.envelope, h.face);
    if (!(holeDia(h) > 0)) fail(`${s.id}: bad hole size ${h.size}`);
    if (Array.isArray(h.pitch[0])) {
      for (const pt of h.pitch as number[][]) {
        const [u, v] = pt;
        if (u < 0 || v < 0 || u > eu || v > ev) fail(`${s.id}: hole (${u}, ${v}) outside ${eu} x ${ev}`);
      }
    } else {
      const [du, dv] = h.pitch as [number, number];
      if (du > eu || dv > ev) fail(`${s.id}: hole pitch ${du} x ${dv} exceeds ${eu} x ${ev}`);
    }
  }
}

// helpers
if (pocketFor('B-PG001', 'press')[0] !== 22.85) fail('pocketFor press allowance');
if (standardFor('NOT-A-PART').source !== 'estimated') fail('standardFor fallback');

const est = Object.values(STANDARD).filter(s => s.source === 'estimated').length;
if (errors.length) {
  console.error(`standardtest: ${errors.length} error(s)`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`standardtest: OK - ${covered.length}/${Object.keys(CATALOG).length} catalog ids covered (${est} estimated)`);
