// Headless physics smoke test: rover drives forward and turns; arm reaches and holds; companion looks; humanoid stands and walks.
import { initKernel } from '../src/cad/kernel';
import { buildAssembly } from '../src/cad/build';
import { normalizeSpec } from '../src/design/spec';
import { Sim, initPhysics } from '../src/sim/physics';
import { behaviorsFor, jointLimits, sample } from '../src/design/behaviors';

await initKernel();
await initPhysics();
let bad = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };

for (const drive of ['B-PG002', 'B-GM001']) {
  const a = buildAssembly(normalizeSpec({ archetype: 'rover', params: { drive, panTilt: true } }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 60; i++) { s.command({}, {}); s.step(1 / 60); }
  const settle = s.telemetry();
  ok(Math.hypot(settle.pos[0], settle.pos[1]) < 5 && !settle.tipped, `${drive} rover settles in place (${settle.pos.map(v => v.toFixed(1))})`);
  for (let i = 0; i < 180; i++) { s.command({}, { wheel_L: 1, wheel_R: 1 }); s.step(1 / 60); }
  const t = s.telemetry();
  ok(t.pos[1] > 150 && Math.abs(t.pos[0]) < 60 && !t.tipped, `${drive} forward 3 s: y=${t.pos[1].toFixed(0)} mm x=${t.pos[0].toFixed(0)} speed=${(t.speed * 100).toFixed(1)} cm/s`);
  for (let i = 0; i < 120; i++) { s.command({}, { wheel_L: 0.5, wheel_R: -0.5 }); s.step(1 / 60); }
  const yawRate = s.bodies.get('base')!.angvel().z;
  ok(yawRate < -1, `${drive} spins clockwise (left fwd, right back): ${yawRate.toFixed(2)} rad/s`);
  s.dispose();
}

{
  const a = buildAssembly(normalizeSpec({ archetype: 'arm', params: { payloadG: 20 } }).spec);
  const s = new Sim(a, { clampBase: true, payloadG: 20, obstacles: false, ramp: false });
  for (let i = 0; i < 240; i++) { s.command({ upper: -50, fore: 50, yaw: 30, grip: 20 }, {}); s.step(1 / 60); }
  const t = s.telemetry();
  for (const j of t.joints) console.log(`   ${j.id}: ${j.angle.toFixed(1)}° (target ${j.target.toFixed(0)}) torque ${(j.torque / j.torqueMax * 100).toFixed(0)} %`);
  ok(t.joints.every(j => Math.abs(j.angle - j.target) < 6), 'arm reaches and holds the reach pose with 20 g');
  s.dispose();
  const heavy = buildAssembly(normalizeSpec({ archetype: 'arm', params: { payloadG: 80, upperLen: 100, foreLen: 100 } }).spec);
  const s2 = new Sim(heavy, { clampBase: true, payloadG: 80, obstacles: false, ramp: false });
  for (let i = 0; i < 240; i++) { s2.command({ upper: -50, fore: 50 }, {}); s2.step(1 / 60); }
  const t2 = s2.telemetry();
  for (const j of t2.joints) console.log(`   ${j.id}: ${j.angle.toFixed(1)}° (target ${j.target.toFixed(0)}) torque ${(j.torque / j.torqueMax * 100).toFixed(0)} %${j.stalled ? ' STALL' : ''}`);
  ok(t2.joints.some(j => j.stalled || Math.abs(j.angle - j.target) > 8), 'long arm + 80 g sags/stalls at full reach (expected)');
  s2.dispose();
}
{
  const a = buildAssembly(normalizeSpec({ archetype: 'companion' }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 120; i++) { s.command({ pan: 45, tilt: 20 }, {}); s.step(1 / 60); }
  const t = s.telemetry();
  ok(t.joints.every(j => Math.abs(j.angle - j.target) < 4) && !t.tipped, `companion pan/tilt: ${t.joints.map(j => j.angle.toFixed(1)).join(', ')}`);
  s.dispose();
}
{
  const a = buildAssembly(normalizeSpec({ archetype: 'humanoid' }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 60; i++) { s.command({ hip_L: 0, hip_R: 0, ankle_L: 0, ankle_R: 0 }, {}); s.step(1 / 60); }
  const t = s.telemetry();
  ok(!t.tipped, 'humanoid stands upright without tipping');
  s.dispose();
}
{
  const a = buildAssembly(normalizeSpec({ archetype: 'snake' }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 120; i++) {
    const phi = (i / 60) * 2 * Math.PI;
    s.command({
      segment_1: 25 * Math.sin(phi),
      segment_2: 25 * Math.sin(phi - 1.2),
      segment_3: 25 * Math.sin(phi - 2.4),
      tail: 25 * Math.sin(phi - 3.6),
    }, {});
    s.step(1 / 60);
  }
  const t = s.telemetry();
  ok(t.joints.length === 4 && !t.tipped, `snake slither joints: ${t.joints.length}, tipped: ${t.tipped}`);
  s.dispose();
}
{
  const a = buildAssembly(normalizeSpec({ archetype: 'desk_agent' }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 60; i++) { s.command({ pan: -20, tilt: 15 }, {}); s.step(1 / 60); }
  const t = s.telemetry();
  ok(t.joints.length === 2 && !t.tipped, `desk agent pan/tilt: ${t.joints.map(j => j.angle.toFixed(1)).join(', ')}`);
  s.dispose();
}
{
  const a = buildAssembly(normalizeSpec({ archetype: 'quadruped', theme: 'dog' }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 60; i++) { s.command({ hip_FL: 0, hip_FR: 0, hip_RL: 0, hip_RR: 0 }, {}); s.step(1 / 60); }
  const settle = s.telemetry();
  ok(settle.joints.length === 4 && !settle.tipped, 'quadruped robot dog settles on 4 paws without tipping');
  for (let i = 0; i < 120; i++) {
    const phi = (i / 30) * Math.PI;
    const osc = 18 * Math.sin(phi);
    s.command({ hip_FL: osc, hip_RR: osc, hip_FR: -osc, hip_RL: -osc }, {});
    s.step(1 / 60);
  }
  const t = s.telemetry();
  ok(!t.tipped, `quadruped trot walk: speed ${(t.speed * 100).toFixed(1)} cm/s, tipped: ${t.tipped}`);
  s.dispose();
}
{
  // rack-and-pinion lift: the carriage climbs to +40 mm against gravity and holds
  const a = buildAssembly(normalizeSpec({ archetype: 'lift', params: { stroke: 100 } }).spec);
  const s = new Sim(a, { clampBase: true, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 180; i++) { s.command({ carriage: 40 }, {}); s.step(1 / 60); }
  const j = s.telemetry().joints[0];
  ok(Math.abs(j.angle - 40) < 3, `lift carriage tracks +40 mm: ${j.angle.toFixed(1)} mm, pinion load ${(j.torque / j.torqueMax * 100).toFixed(0)} %`);
  const z = s.poses().get('carriage')!.elements[14];
  ok(Math.abs(z - 40) < 3, `lift carriage moved up in the world: Δz ${z.toFixed(1)} mm`);
  s.dispose();
}
{
  const a = buildAssembly(normalizeSpec({ archetype: 'camera_slider' }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 180; i++) { s.command({ carriage: -30 }, {}); s.step(1 / 60); }
  const t = s.telemetry();
  ok(Math.abs(t.joints[0].angle + 30) < 3 && !t.tipped, `camera slider carriage tracks -30 mm: ${t.joints[0].angle.toFixed(1)} mm`);
  s.dispose();
}
{
  const a = buildAssembly(normalizeSpec({ archetype: 'barrier_gate' }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 120; i++) { s.command({ lever: 85 }, {}); s.step(1 / 60); }
  const t = s.telemetry();
  ok(Math.abs(t.joints[0].angle - 85) < 4 && !t.tipped, `barrier boom raises to 85°: ${t.joints[0].angle.toFixed(1)}°`);
  s.dispose();
}
for (const archetype of ['smart_fan', 'pet_feeder']) {
  const a = buildAssembly(normalizeSpec({ archetype }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 120; i++) { s.command({}, { spin: 1 }); s.step(1 / 60); }
  const t = s.telemetry();
  const rpm = Math.abs(s.bodies.get('rotor')!.angvel()[archetype === 'pet_feeder' ? 'z' : 'x']) * 60 / (2 * Math.PI);
  ok(rpm > 40 && !t.tipped, `${archetype} rotor spins: ${rpm.toFixed(0)} rpm, tipped: ${t.tipped}`);
  s.dispose();
}
{
  const a = buildAssembly(normalizeSpec({ archetype: 'scara_plotter' }).spec);
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 150; i++) { s.command({ link1: 40, link2: -60 }, {}); s.step(1 / 60); }
  const t = s.telemetry();
  ok(t.joints.every(j => Math.abs(j.angle - j.target) < 4) && !t.tipped, `SCARA reaches (40°, -60°): ${t.joints.map(j => j.angle.toFixed(1)).join(', ')}`);
  s.dispose();
}
{
  // free-form composer: a fish whose tail wags on a vertical shaft, and a clock whose hand spins
  const fish = buildAssembly(normalizeSpec({ archetype: 'robot_fish', composition: { use: true, body: { shape: 'egg', size: [50, 110, 55] }, standH: 30,
    joints: [{ name: 'tail', parent: 'body', face: '+z', at: [0, -38], kind: 'swing', range: [-35, 35], point: 'back', reach: 40, shape: 'fin', size: [4, 40, 44] }], features: [] } }).spec);
  const s = new Sim(fish, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 120; i++) { s.command({ tail: 30 }, {}); s.step(1 / 60); }
  const t = s.telemetry();
  ok(Math.abs(t.joints[0].angle - 30) < 4 && !t.tipped, `composed fish tail wags to 30°: ${t.joints[0].angle.toFixed(1)}°`);
  s.dispose();
  const clock = buildAssembly(normalizeSpec({ archetype: 'analog_clock', composition: { use: true, body: { shape: 'disc', size: [110, 12, 110] }, standH: 20,
    joints: [{ name: 'hand', parent: 'body', face: '+y', at: [0, 0], kind: 'spin', range: [0, 0], point: 'up', reach: 24, shape: 'box', size: [5, 3, 44] }], features: [] } }).spec);
  const s2 = new Sim(clock, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 120; i++) { s2.command({}, { spin: 0.5 }); s2.step(1 / 60); }
  const rpm = Math.abs(s2.bodies.get('hand')!.angvel().y) * 60 / (2 * Math.PI);
  ok(rpm > 20 && !s2.telemetry().tipped, `composed clock hand spins: ${rpm.toFixed(0)} rpm`);
  s2.dispose();
}
for (const drive of ['B-PG002', 'B-GM001']) {
  // mobile composition: a ladybug shell on the rover chassis drives straight, turns, and its antennae still move
  const bug = buildAssembly(normalizeSpec({ archetype: 'ladybug_bot', params: { drive }, composition: { use: true, mobility: 'wheels', body: { shape: 'sphere', size: [96, 104, 46] }, standH: 10,
    joints: [{ name: 'antennae', parent: 'body', face: '+y', at: [0, 6], kind: 'swing', range: [-30, 30], point: 'up', reach: 22, shape: 'capsule', size: [30, 5, 5] }], features: [] } }).spec);
  const s = new Sim(bug, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  for (let i = 0; i < 60; i++) { s.command({}, {}); s.step(1 / 60); }
  for (let i = 0; i < 180; i++) { s.command({ antennae: 20 }, { wheel_L: 1, wheel_R: 1 }); s.step(1 / 60); }
  const t = s.telemetry();
  const ant = t.joints.find(j => j.id === 'antennae')!;
  ok(t.pos[1] > 150 && Math.abs(t.pos[0]) < 60 && !t.tipped && Math.abs(ant.angle - 20) < 4,
    `${drive} ladybug drives 3 s: y=${t.pos[1].toFixed(0)} mm x=${t.pos[0].toFixed(0)}, antennae ${ant.angle.toFixed(1)}°, tipped ${t.tipped}`);
  for (let i = 0; i < 120; i++) { s.command({}, { wheel_L: 0.5, wheel_R: -0.5 }); s.step(1 / 60); }
  ok(s.bodies.get('base')!.angvel().z < -1 && !s.telemetry().tipped, `${drive} ladybug spins in place without tipping`);
  s.dispose();
}
{
  // composed walking legs (src/cad/legs.ts): ankle rolls lean the robot onto one foot, the other lifts and steps
  const { spec } = normalizeSpec({ archetype: 'walking_pet', platform: 'licheerv_claw', behaviors: ['walk'],
    composition: { use: true, mobility: 'legs', body: { shape: 'egg', size: [70, 60, 70] }, standH: 10, features: [], joints: [] } });
  const a = buildAssembly(spec);
  const walk = behaviorsFor(spec, { trackMm: 80, topSpeed: 0.1 }, jointLimits(a)).find(b => b.id === 'walk')!;
  const s = new Sim(a, { clampBase: false, payloadG: 0, obstacles: false, ramp: false });
  const z = (id: string) => s.bodies.get(id)!.translation().z * 1000;
  for (let i = 0; i < 60; i++) { s.command(sample(walk, 0).joints, {}); s.step(1 / 60); }
  const z0 = z('roll_L');
  let lift = 0;
  for (let i = 0; i < 60 * 10; i++) { s.command(sample(walk, i / 60).joints, {}); s.step(1 / 60); lift = Math.max(lift, z('roll_L') - z0); }
  const t = s.telemetry();
  ok(!t.tipped && t.pos[1] > 10 && lift > 3, `composed legs walk 10 s: forward ${t.pos[1].toFixed(0)} mm, left foot lifts ${lift.toFixed(1)} mm, tipped ${t.tipped}`);
  s.dispose();
}
process.exit(bad ? 1 : 0);
