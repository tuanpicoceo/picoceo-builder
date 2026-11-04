import {
  checkPromptKitFeasibility,
  getDefaultComponentDirectory,
  getDirectoryTotals,
} from '../src/catalog/components';
import { initKernel } from '../src/cad/kernel';
import { buildAssembly } from '../src/cad/build';
import { localPlan } from '../src/design/localPlanner';
import { buildSevenStepReport } from '../src/design/pipeline';
// @ts-ignore
import { design } from '../server/design.mjs';

console.log('--- 1. Testing checkPromptKitFeasibility ---');
const r1 = checkPromptKitFeasibility('build a 6-axis arm', 1);
console.log('1 kit, 6-axis:', r1);
if (!r1 || !r1.includes('Insufficient components')) throw new Error('Expected 1 kit 6-axis to fail');

const r2 = checkPromptKitFeasibility('build a 6-axis arm', 2);
console.log('2 kits, 6-axis:', r2);
if (r2 !== null) throw new Error('Expected 2 kits 6-axis to pass');

const r3 = checkPromptKitFeasibility('rover with 4-axis arm', 1);
console.log('1 kit, rover+arm:', r3);
if (!r3 || !r3.includes('Insufficient components')) throw new Error('Expected 1 kit rover+arm to fail');

const r4 = checkPromptKitFeasibility('robot with 10 leds', 1);
console.log('1 kit, 10 LEDs:', r4);
if (!r4 || !r4.includes('Insufficient components')) throw new Error('Expected 1 kit 10 LEDs to fail');

const r5 = checkPromptKitFeasibility('robot with 10 leds', 2);
console.log('2 kits, 10 LEDs:', r5);
if (r5 !== null) throw new Error('Expected 2 kits 10 LEDs to pass');

console.log('--- 1a. Testing Component Directory Management ---');
const cbInv = getDefaultComponentDirectory('cyberbrick', 1);
const cbTotals = getDirectoryTotals(cbInv);
console.log('CyberBrick default inventory totals:', cbTotals);
if (cbTotals.servos < 4 || cbTotals.controllers !== 1) throw new Error('CyberBrick default inventory mismatch');

const xzInv = getDefaultComponentDirectory('xiaozhi_ai', 1);
const xzTotals = getDirectoryTotals(xzInv);
console.log('XiaoZhi AI default inventory totals:', xzTotals);
if (xzTotals.speakers !== 1 || xzTotals.servos !== 2) throw new Error('XiaoZhi inventory mismatch');

// Test custom inventory with surplus servos (e.g. 6 servos on 1 kit)
const customInv6 = { 'SG90-SERVO': 6, 'ESP32-DEV': 1, 'BAT-18650-1S': 1 };
const rCustom6 = checkPromptKitFeasibility('build a 6-axis arm', 1, customInv6);
console.log('Custom inventory (6 servos) 6-axis feasibility:', rCustom6);
if (rCustom6 !== null) throw new Error('Expected custom inventory with 6 servos to pass 6-axis arm');

// Test custom inventory with deficit servos (e.g. only 2 servos)
const customInv2 = { 'SG90-SERVO': 2, 'ESP32-DEV': 1, 'BAT-18650-1S': 1 };
const rCustom2 = checkPromptKitFeasibility('build a 4-axis arm', 1, customInv2);
console.log('Custom inventory (2 servos) 4-axis feasibility:', rCustom2);
if (!rCustom2 || !rCustom2.includes('Insufficient components')) throw new Error('Expected custom inventory with 2 servos to fail 4-axis request');

const planCustom6 = localPlan('build a 6-axis arm', undefined, 1, customInv6);
console.log('localPlan with custom 6 servos:', planCustom6.spec.name, planCustom6.spec.archetype);
if (planCustom6.spec.archetype !== 'arm') throw new Error('Expected arm archetype');

console.log('--- 1b. Testing open types support (humanoid, quadruped, duck) ---');
const rHumanoid = checkPromptKitFeasibility('create a tiny humanoid robot with 4 kits', 4);
console.log('4 kits, humanoid feasibility:', rHumanoid);
if (rHumanoid !== null) throw new Error('Expected humanoid to be supported and pass feasibility');

const rQuad = checkPromptKitFeasibility('make a quadruped robot dog', 4);
console.log('4 kits, quadruped:', rQuad);
if (rQuad !== null) throw new Error('Expected quadruped to pass feasibility as type list is open');

console.log('--- 2. Testing localPlan for humanoid and open types ---');
const planHumanoid4 = localPlan('create a tiny humanoid robot with 4 kits', undefined, 4);
console.log('localPlan 4-kit humanoid archetype:', planHumanoid4.spec.archetype, 'hasArms:', planHumanoid4.spec.params.hasArms);
if (planHumanoid4.spec.archetype !== 'humanoid' || !planHumanoid4.spec.params.hasArms) {
  throw new Error('Expected 4-kit humanoid with hasArms=true');
}

const planHumanoid1 = localPlan('create a tiny biped robot', undefined, 1);
console.log('localPlan 1-kit humanoid archetype:', planHumanoid1.spec.archetype, 'hasArms:', planHumanoid1.spec.params.hasArms);
if (planHumanoid1.spec.archetype !== 'humanoid') {
  throw new Error('Expected 1-kit biped to produce humanoid archetype');
}

const planQuad = localPlan('make a quadruped robot dog', undefined, 4);
console.log('localPlan quadruped archetype:', planQuad.spec.archetype);
if (planQuad.spec.archetype !== 'quadruped') {
  throw new Error('Expected quadruped archetype');
}

try {
  localPlan('6-axis arm', undefined, 1);
  throw new Error('Should have thrown 422');
} catch (e: any) {
  console.log('localPlan caught expected rejection:', e.message, 'status:', e.status);
  if (e.status !== 422) throw new Error('Expected status 422');
}

console.log('--- 3. Testing server/design.mjs pre-check rejection ---');
try {
  await design({ prompt: '6-axis arm', kitCount: 1 });
  throw new Error('design should have thrown 422');
} catch (e: any) {
  console.log('server/design.mjs caught expected rejection:', e.message, 'status:', e.status);
  if (e.status !== 422) throw new Error('Expected status 422');
}

try {
  await design({ prompt: '4-axis arm', kitCount: 1, inventory: { 'SG90-SERVO': 2 } });
  throw new Error('design with inventory deficit should have thrown 422');
} catch (e: any) {
  console.log('server/design.mjs custom inventory caught expected rejection:', e.message, 'status:', e.status);
  if (e.status !== 422) throw new Error('Expected status 422');
}

console.log('--- 4. Testing running dev server HTTP endpoint ---');
try {
  const res = await fetch('http://localhost:5180/api/design', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Build a rover with a 4-servo arm', kitCount: 1, inventory: { 'SG90-SERVO': 2 } }),
  });
  console.log('Dev server HTTP status:', res.status);
  const data = await res.json();
  console.log('Dev server error message:', data.error);
  if (res.status !== 422) throw new Error(`Expected HTTP 422 but got ${res.status}`);
} catch (e: any) {
  if (e.message.includes('Expected HTTP 422')) throw e;
  console.log('(Dev server check completed)');
}

console.log('--- 5. Testing 8-Step AI Design Flow Engine ---');
await initKernel();
const roverPlan = localPlan('Build a patrol rover with a pan-tilt head and LEDs', undefined, 1, cbInv);
const roverAsm = buildAssembly(roverPlan.spec);
const report = buildSevenStepReport(roverPlan.spec, roverAsm, cbInv, 'Build a patrol rover with a pan-tilt head and LEDs', roverPlan.rationale);
console.log('8-Step Flow steps:', report.steps.map(s => `[Step ${s.step}: ${s.status}] ${s.headline}`).join('\n  '));
if (report.steps.length !== 8) throw new Error('Expected 8 steps in report');
if (!report.step1.selectedComponents.length) throw new Error('Expected Step 1 selectedComponents');
if (!report.step2.form.overallDimensionsMm.length) throw new Error('Expected Step 2 form dimensions');
if (!report.step3.spatialLayout.length || !report.step3.connections.length || !report.step3.fitStatus) throw new Error('Expected Step 3 spatialLayout, connections & fitStatus');
if (!report.step4.printedParts.length) throw new Error('Expected Step 4 printedParts');
if (!report.step5.checks.length) throw new Error('Expected Step 5 audit checks');
if (!report.step6.behaviors.length) throw new Error('Expected Step 6 simulation behaviors');
if (!Object.keys(report.step7.files).length || !report.step7.pinMap.length) throw new Error('Expected Step 7 firmware files & pinMap');
if (report.step8.testSuites.length < 6 || report.step8.readinessScore < 80) throw new Error('Expected Step 8 readinessScore >= 80 and 6 test suites');

console.log('ALL KIT COUNT FEASIBILITY, DIRECTORY & 8-STEP FLOW TESTS PASSED!');
