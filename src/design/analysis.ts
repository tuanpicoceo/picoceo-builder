// Design-rule checks (electrical, power, torque, stability, printability) and the bill of materials.

import { CATALOG, type ComponentDirectory, getDirectoryTotals, getKitInventory, SINGLE_KIT_INVENTORY } from '../catalog/components';
import { MATERIALS, PROFILES, type Material } from '../catalog/rules';
import { printedGrams } from '../cad/mass';
import type { Assembly, GeoCheck, JointDef, LinkDef, Vec3 } from '../cad/types';
import { apply, fk, gravityTorque, type Angles } from './kinematics';
import type { RobotSpec } from './spec';

export interface Check extends GeoCheck { group: 'Electrical' | 'Power' | 'Motion' | 'Stability' | 'Mechanical' | 'Print' }

/** Warnings that come from the kit's own hardware ratings; no design change can clear them. */
export const KIT_LIMITS = new Set(['switch', 'current', 'motorports', 'i2c', 'i2s', 'servo_rail', 'xz_charge', 'jetson_vin']);

export const SERVO_RAIL_V = 5.0;     // shield servo header VCC (guide: pin 2 = +5 V)
export const BATTERY_V = 7.4;

/** Speed/torque of an actuator at its supply voltage (ratings in the guide are @ 6 V). */
export function actuatorRating(catalogId: string) {
  const d = CATALOG[catalogId].data;
  const v = catalogId === 'B-GM001' ? Math.min(BATTERY_V, d.vMax) : SERVO_RAIL_V;
  const k = v / 6;
  return {
    volts: v,
    torqueNm: d.torqueNm * k,                      // stall torque scales ~linearly with voltage
    omega: d.rpm ? (d.rpm * k * 2 * Math.PI) / 60 : (d.speedDegS * k * Math.PI) / 180,
    stallA: d.stallA, idleA: d.idleA ?? d.nominalA ?? 0.02,
  };
}

export interface PartStat { id: string; name: string; material: Material; grams: number; hours: number; profile: string; fits: 'A1 mini' | 'X1/P1/A1' | 'too big' }

export function partStats(a: Assembly): PartStat[] {
  return a.parts.map(p => {
    const g = printedGrams(p.volume, p.area, p.profile, p.material);
    const rate = p.material === 'TPU 95A' ? 7 : PROFILES[p.profile].layer >= 0.2 ? 18 : 13;   // g/h, Bambu-class printer
    const s = [0, 1, 2].map(i => p.printBBox.max[i] - p.printBBox.min[i]);
    const m = Math.max(...s);
    return { id: p.id, name: p.name, material: p.material, grams: g, hours: g / rate + 0.1, profile: PROFILES[p.profile].label, fits: m <= 175 ? 'A1 mini' : m <= 250 ? 'X1/P1/A1' : 'too big' };
  });
}

export function analyze(spec: RobotSpec, a: Assembly, inventoryOrKitCount: ComponentDirectory | number = 1): { checks: Check[]; totals: { massG: number; printG: number; printH: number; avgA: number; peakA: number; runtimeMin: number; topSpeed?: number; maxSlopeDeg?: number } } {
  const checks: Check[] = a.checks.map(c => ({ ...c, group: c.id === 'watertight' || c.id === 'orientation' ? 'Print' as const : 'Mechanical' as const }));
  const joints = a.links.filter(l => l.joint);
  const acts = joints.map(l => ({ link: l, ...l.joint!.actuator }));

  // ---------------------------------------------------------------- electrical
  let invServos: number, invMotors: number, invLeds: number, invControllers: number;
  let isCustomDir = false;
  let kitCount = 1;
  if (typeof inventoryOrKitCount === 'object' && inventoryOrKitCount !== null) {
    const t = getDirectoryTotals(inventoryOrKitCount);
    invServos = t.servos;
    invMotors = t.motors;
    invLeds = t.leds;
    invControllers = t.controllers;
    isCustomDir = true;
  } else {
    kitCount = Math.max(1, Math.floor(Number(inventoryOrKitCount) || 1));
    const inv = getKitInventory(kitCount);
    invServos = inv.servos;
    invMotors = inv.motors;
    invLeds = inv.leds;
    invControllers = inv.controllers;
  }
  const servoPorts = acts.filter(x => x.port.startsWith('S'));
  const motorPorts = acts.filter(x => x.port.startsWith('M'));
  const dup = acts.map(x => x.port).filter((p, i, arr) => arr.indexOf(p) !== i);
  if (spec.platform === 'licheerv_claw') return analyzeRest(spec, a, checks, joints, acts, clawElectrical(a, checks, acts, servoPorts, motorPorts, dup, invServos));
  if (spec.platform === 'xiaozhi' || spec.platform === 'rpi' || spec.platform === 'jetson')
    return analyzeRest(spec, a, checks, joints, acts, voiceElectrical(spec.platform, a, checks, acts, servoPorts, motorPorts, dup, invServos, isCustomDir ? inventoryOrKitCount as ComponentDirectory : null));
  checks.push({ group: 'Electrical', id: 'ports', label: 'Shield ports', status: servoPorts.length > invServos || motorPorts.length > invMotors || dup.length ? 'fail' : 'pass',
    detail: `${servoPorts.length}/${invServos} servo headers (${servoPorts.map(x => `${x.port} ${x.label}`).join(', ') || 'none'})` + (motorPorts.length ? `; ${motorPorts.length}/${invMotors} motor outputs (${motorPorts.map(x => x.port).join(', ')})` : '') + (dup.length ? `; duplicate ${dup.join(', ')}` : '') });
  if (motorPorts.length) checks.push({ group: 'Electrical', id: 'motorports', label: 'Motor outputs (unverified)', status: 'warn', detail: 'The guide lists B-GM001 as "PWM H-bridge" but no motor outputs on the B-XA004. PICOCEO Builder assumes M1/M2 as on the community wiki. Confirm the pins before wiring; the firmware refuses to drive motors until MOTOR_PINS is set.' });
  const ledCount = a.components.filter(c => c.catalogId === 'B-KB003').length;
  checks.push({ group: 'Electrical', id: 'leds', label: 'LED chain', status: ledCount <= invLeds ? 'pass' : 'fail', detail: `${ledCount}/${invLeds} × B-KB003 on the D1 port via the 6-branch hub B-XA006.` });
  const totalServos = acts.filter(x => x.kind === 'servo' || x.kind === 'cservo').length;
  const totalMotors = acts.filter(x => x.kind === 'motor').length;
  const totalControllers = a.components.filter(c => c.catalogId === 'B-XA003').length;
  const exceeds = totalServos > invServos || totalMotors > invMotors || ledCount > invLeds || (totalControllers > 0 && invControllers > 0 && totalControllers > invControllers);
  const requiredKits = Math.max(
    Math.ceil(totalServos / SINGLE_KIT_INVENTORY.servos),
    Math.ceil(totalMotors / (SINGLE_KIT_INVENTORY.motors || 1)),
    Math.ceil(ledCount / SINGLE_KIT_INVENTORY.leds),
    Math.ceil(totalControllers / SINGLE_KIT_INVENTORY.controllers) || 1,
    1
  );
  checks.push({
    group: 'Electrical',
    id: 'kit_inventory',
    label: isCustomDir ? 'Directory stock' : 'Kit inventory',
    status: exceeds ? 'fail' : 'pass',
    detail: exceeds
      ? (isCustomDir
        ? `Exceeds available parts in your component directory: uses ${totalServos}/${invServos} servos, ${totalMotors}/${invMotors} motors, ${ledCount}/${invLeds} LEDs. Please add components in the Directory.`
        : `Exceeds available parts in ${kitCount} kit(s): uses ${totalServos}/${invServos} servos, ${totalMotors}/${invMotors} motors, ${ledCount}/${invLeds} LEDs. Requires ${requiredKits} kit(s).`)
      : (isCustomDir
        ? `Within component directory stock: ${totalServos}/${invServos} servos, ${totalMotors}/${invMotors} motors, ${ledCount}/${invLeds} LEDs.`
        : `Within ${kitCount} kit allowance: ${totalServos}/${invServos} servos, ${totalMotors}/${invMotors} motors, ${ledCount}/${invLeds} LEDs (${requiredKits}/${kitCount} kit${kitCount > 1 ? 's' : ''} utilized).`),
  });
  const servoV = acts.filter(x => x.kind !== 'motor').every(x => CATALOG[x.catalogId].data.vMin <= SERVO_RAIL_V && SERVO_RAIL_V <= CATALOG[x.catalogId].data.vMax);
  checks.push({ group: 'Electrical', id: 'voltage', label: 'Voltages', status: servoV ? 'pass' : 'fail', detail: `Battery ${BATTERY_V} V within the shield's 6.0-9.0 V input; servos on the ${SERVO_RAIL_V} V header rail (B-PG001 4.8-6.0 V, B-PG002 4.8-7.4 V).` + (motorPorts.length ? ` Motors driven from the battery (B-GM001 3.0-7.4 V).` : '') });

  // ---------------------------------------------------------------- power
  const coreA = 0.09, ledA = 0.02;
  let avg5 = coreA + ledCount * ledA, peak5 = coreA + ledCount * 0.06, avgBat = 0, peakBat = 0;
  for (const x of acts) {
    const r = actuatorRating(x.catalogId);
    if (x.kind === 'motor') { avgBat += CATALOG[x.catalogId].data.nominalA * 1.5; peakBat += r.stallA; }
    else { avg5 += x.kind === 'cservo' ? 0.22 : 0.12; peak5 += r.stallA; }
  }
  const toBat = (i5: number) => (i5 * SERVO_RAIL_V) / (BATTERY_V * 0.85);
  const avgA = toBat(avg5) + avgBat, peakA = toBat(peak5) + peakBat;
  const runtimeMin = (0.8 * 0.85 / avgA) * 60;
  checks.push({ group: 'Power', id: 'current', label: 'Current budget', status: peak5 > CATALOG['B-XA004'].data.servo5vBudgetA ? 'warn' : 'pass',
    detail: `Typical ${avgA.toFixed(2)} A from the battery, all-stalled peak ${peakA.toFixed(2)} A (5 V rail ${peak5.toFixed(1)} A; shield regulator rating is not in the guide, ${CATALOG['B-XA004'].data.servo5vBudgetA} A assumed).` });
  checks.push({ group: 'Power', id: 'switch', label: 'Power switch rating', status: avgA > 1.0 ? 'fail' : avgA > 0.5 || peakA > 0.5 ? 'warn' : 'pass',
    detail: `B-XA007 is rated 0.5 A. Typical draw ${avgA.toFixed(2)} A${peakA > 0.5 ? `; stall peaks (${peakA.toFixed(1)} A) exceed the rating briefly. Avoid holding servos stalled, or switch the battery with a higher-rated part.` : '.'}` });
  checks.push({ group: 'Power', id: 'runtime', label: 'Estimated runtime', status: runtimeMin < 20 ? 'warn' : 'pass', detail: `≈ ${runtimeMin.toFixed(0)} min of typical activity on 800 mAh (85 % usable).` });
  return analyzeRest(spec, a, checks, joints, acts, { avgA, peakA, runtimeMin });
}

type Act = JointDef['actuator'] & { link: LinkDef };

// LicheeRV Claw kit: the Nano + PicoClaw module runs on its own built-in 1S cell (capacity not published: assumed) and has
// its own speaker. Servos (if any) are on a PCA9685 over I2C, powered by the separate pack in the base / body (5 V boost to V+).
export const CLAW_BATTERY_V = 3.7, CLAW_BATTERY_MAH = 1000, CLAW_BUILTIN_MAH = 500, CLAW_SERVO_5V_A = 1.0;

function clawElectrical(a: Assembly, checks: Check[], acts: Act[], servoPorts: Act[], motorPorts: Act[], dup: string[], invServos: number) {
  const pca = a.components.some(c => c.catalogId === 'PCA9685-SERVO-16');
  const channels = pca ? CATALOG['PCA9685-SERVO-16'].data.servoPorts : 0;
  checks.push({ group: 'Electrical', id: 'ports', label: 'Servo channels (PCA9685)',
    status: servoPorts.length > channels || servoPorts.length > invServos || motorPorts.length || dup.length ? 'fail' : 'pass',
    detail: servoPorts.length
      ? `${servoPorts.length}/${channels} PCA9685 channels (${servoPorts.map(x => `ch${Number(x.port.slice(1)) - 1} ${x.label}`).join(', ')}), ${invServos} servo(s) in the directory.` + (dup.length ? ` Duplicate ${dup.join(', ')}.` : '')
      : 'No servos: the Claw module runs the screen, keys, LEDs and its built-in speaker on its own battery.' });
  if (motorPorts.length) checks.push({ group: 'Electrical', id: 'motorports', label: 'Motor outputs', status: 'fail',
    detail: 'The PicoClaw board has no motor driver. Use continuous-rotation servos on the PCA9685, or the CyberBrick kit for DC motors.' });
  checks.push({ group: 'Electrical', id: 'kit_inventory', label: 'Directory stock', status: servoPorts.length > invServos ? 'fail' : 'pass',
    detail: `${servoPorts.length}/${invServos} servos used${servoPorts.length && !pca ? '; add a PCA9685 servo board to the directory' : ''}.` });
  checks.push({ group: 'Electrical', id: 'voltage', label: 'Voltages', status: 'pass',
    detail: `The module's built-in 1S cell (${CLAW_BATTERY_V} V, charged over USB-C, max 3 W) feeds the Nano, screen and speaker${servoPorts.length ? '; the servo pack feeds the PCA9685 V+ rail through a 5 V boost (I2C logic at 3.3 V)' : ''}.` });
  if (servoPorts.length) checks.push({ group: 'Electrical', id: 'i2c', label: 'PCA9685 bus (verify)', status: 'warn',
    detail: 'The I2C bus number and pins of the Nano header must be checked on your image (`ls /dev/i2c-*`, `i2cdetect -y <bus>` shows 0x40); set I2C_BUS in config.py.' });

  // power: the module (Nano ≈ 0.25 A + LCD backlight / speaker 0.1 A at 5 V) on its built-in cell; servos on their own pack
  const moduleA = (0.35 * SERVO_RAIL_V) / (CLAW_BATTERY_V * 0.85);
  let servoAvg5 = 0, servo5 = 0;
  for (const x of acts.filter(x => x.kind !== 'motor')) {
    servoAvg5 += x.kind === 'cservo' ? 0.22 : 0.12;
    servo5 += actuatorRating(x.catalogId).stallA;
  }
  const toBat = (i5: number) => (i5 * SERVO_RAIL_V) / (CLAW_BATTERY_V * 0.85);
  const pack = a.components.find(c => CATALOG[c.catalogId]?.kind === 'battery');
  const packMAh = (pack && CATALOG[pack.catalogId].data.capacitymAh) || CLAW_BATTERY_MAH;
  const moduleMin = (CLAW_BUILTIN_MAH / 1000) * 0.85 / moduleA * 60;
  const servoMin = servoAvg5 ? (packMAh / 1000) * 0.85 / toBat(servoAvg5) * 60 : Infinity;
  const runtimeMin = Math.min(moduleMin, servoMin);
  const avgA = moduleA + toBat(servoAvg5), peakA = toBat(0.6) + toBat(servo5);
  checks.push({ group: 'Power', id: 'current', label: 'Current budget', status: servo5 > CLAW_SERVO_5V_A * 2 ? 'warn' : 'pass',
    detail: `Module ${moduleA.toFixed(2)} A from its built-in cell` + (servo5
      ? `; servos typical ${toBat(servoAvg5).toFixed(2)} A from the ${pack ? CATALOG[pack.catalogId].name : 'servo pack'}, ${servo5.toFixed(1)} A at 5 V when all stall. Size the 5 V boost for it.`
      : '.') });
  checks.push({ group: 'Power', id: 'runtime', label: 'Estimated runtime', status: runtimeMin < 20 ? 'warn' : 'pass',
    detail: `≈ ${moduleMin.toFixed(0)} min for the module on its built-in cell (${CLAW_BUILTIN_MAH} mAh assumed, not published)` +
      (servoAvg5 ? `; ≈ ${servoMin.toFixed(0)} min of servo activity on ${packMAh} mAh` : '') + ' (85 % usable).' });
  return { avgA, peakA, runtimeMin };
}

// ---------------------------------------------------------------- XiaoZhi / Raspberry Pi / Jetson voice robots
// The voice core (src/cad/voicecore.ts) carries the board, mic, amp + speaker, display, battery (+ buck) and servo board.
const MICS = ['MIC-INMP441', 'RESPEAKER-2MIC-HAT', 'USB-MIC-MINI'];
const AMPS = ['AMP-MAX98357A', 'RESPEAKER-2MIC-HAT'];                 // the ReSpeaker HAT drives a speaker itself
const PCA_BOARDS = ['PCA9685-SERVO-16', 'WAVESHARE-SERVO-HAT', 'ADAFRUIT-SERVO-BONNET'];
const BOARD_POWER: Record<string, { v: number; a: number; how: string }> = {
  'RPI-5': { v: 5, a: 5, how: 'USB-C / GPIO 5 V, 5 A (27 W) for full USB current' },
  'RPI-4B': { v: 5, a: 3, how: 'USB-C 5 V 3 A' },
  'RPI-ZERO-2W': { v: 5, a: 1.2, how: 'micro-USB / GPIO 5 V 1.2 A' },
  'JETSON-NANO': { v: 5, a: 4, how: 'DC barrel 5 V 4 A (J48 jumper fitted)' },
  'JETSON-ORIN-NANO': { v: 12, a: 2.5, how: 'DC barrel 9-20 V (19 V adapter), ~25 W' },
};

function voiceElectrical(platform: 'xiaozhi' | 'rpi' | 'jetson', a: Assembly, checks: Check[], acts: Act[], servoPorts: Act[], motorPorts: Act[], dup: string[], invServos: number, dir: ComponentDirectory | null) {
  const ids = a.components.map(c => c.catalogId);
  const has = (id: string) => ids.includes(id);
  const board = a.components.find(c => c.key === 'voice_board')?.catalogId ?? ids.find(id => CATALOG[id]?.kind === 'controller') ?? '';
  const builtIn = board === 'ZHAOZHI-AI-CORE';
  const name = (id?: string) => (id && CATALOG[id]?.name) || id || 'none';

  // ---- voice: mic, speaker + amp, display (optional)
  const mic = MICS.find(has), amp = AMPS.find(has), spk = ids.find(id => CATALOG[id]?.kind === 'speaker');
  const display = ids.find(id => CATALOG[id]?.kind === 'display');
  const micOk = !!mic || builtIn, spkOk = !!spk && (!!amp || builtIn);
  checks.push({ group: 'Electrical', id: 'voice', label: 'Voice hardware', status: micOk && spkOk ? 'pass' : 'fail',
    detail: [
      micOk ? `mic ✓ (${builtIn && !mic ? 'dual MEMS on the XiaoZhi core' : name(mic)})` : 'mic ✗: add an INMP441 (I2S), a ReSpeaker 2-Mics HAT (Pi) or a USB mic',
      spkOk ? `speaker ✓ (${name(spk)} on ${builtIn && !amp ? 'the core I2S amp' : name(amp)})` : !spk ? 'speaker ✗: add an 8 Ω speaker' : 'amp ✗: add a MAX98357A I2S amp (or a ReSpeaker HAT on a Pi)',
      display ? `display ✓ (${name(display)}, the face)` : 'no face: voice only (the backbone gets no show_face tool)',
    ].join('; ') + '.' });

  // ---- servo channels vs the servo board and the directory stock
  const sb = ids.find(id => PCA_BOARDS.includes(id)) ?? (has('BUS-SERVO-ADAPTER') ? 'BUS-SERVO-ADAPTER' : undefined);
  const channels = sb ? CATALOG[sb].data.servoPorts : 0;
  checks.push({ group: 'Electrical', id: 'ports', label: `Servo channels${sb ? ` (${sb === 'BUS-SERVO-ADAPTER' ? 'bus' : 'PCA9685'})` : ''}`,
    status: servoPorts.length > channels || servoPorts.length > invServos || motorPorts.length || dup.length ? 'fail' : 'pass',
    detail: servoPorts.length
      ? `${servoPorts.length}/${channels} channels on the ${name(sb)} (${servoPorts.map(x => `ch${Number(x.port.slice(1)) - 1} ${x.label}`).join(', ')}), ${invServos} servo(s) in stock.` + (!sb ? ' Add a PCA9685 servo board.' : '') + (dup.length ? ` Duplicate ${dup.join(', ')}.` : '')
      : 'No servos: a talking robot without motion.' });
  if (motorPorts.length) checks.push({ group: 'Electrical', id: 'motorports', label: 'Motor outputs', status: 'fail',
    detail: 'The voice core has no DC motor driver: use continuous-rotation servos (FS90R) on the servo board.' });
  const missing = dir ? [...new Set(ids)].filter(id => CATALOG[id] && CATALOG[id].kind !== 'hardware' && CATALOG[id].kind !== 'servo' && CATALOG[id].kind !== 'cservo'
    && ids.filter(x => x === id).length > (Number(dir[id]) || 0)) : [];
  checks.push({ group: 'Electrical', id: 'kit_inventory', label: 'Directory stock', status: servoPorts.length > invServos || missing.length ? 'fail' : 'pass',
    detail: `${servoPorts.length}/${invServos} servos used` + (missing.length ? `; not in the directory: ${missing.map(name).join(', ')}` : dir ? '; every voice-core part is in stock' : '') + '.' });

  // ---- power source
  const bat = ids.find(id => CATALOG[id]?.kind === 'battery');
  const batV = bat ? CATALOG[bat].data.voltage : 0, batMAh = bat ? CATALOG[bat].data.capacitymAh : 0;
  const buck = has('BUCK-5V-5A'), ups = has('UPS-HAT-PI');
  const supplyA = ups ? CATALOG['UPS-HAT-PI'].data.outA : buck ? CATALOG['BUCK-5V-5A'].data.outA : 0;
  const need = BOARD_POWER[board];
  const servoMin = Math.min(...acts.filter(x => x.kind !== 'motor').map(x => CATALOG[x.catalogId]?.data.vMin ?? 4.8), 99);
  if (platform === 'xiaozhi') {
    const oneS = !!bat && batV < 4.5;
    checks.push({ group: 'Power', id: 'voltage', label: 'Power (1S + USB-C)', status: !bat ? 'fail' : oneS ? 'pass' : 'fail',
      detail: !bat ? 'No battery: add a 1S cell (18650 or LiPo).' : oneS
        ? `${name(bat)} (1S ${batV} V) on the board's 5 V / battery input; charge it over USB-C.`
        : `${name(bat)} is ${batV} V: XiaoZhi boards take a 1S cell (3.7 V) or 5 V USB-C. Use a 1S cell, or add a 5 V buck.` });
    if (board === 'ESP32-S3-DEVKIT') checks.push({ group: 'Power', id: 'xz_charge', label: 'Charging (DevKitC)', status: 'warn',
      detail: 'The ESP32-S3 DevKitC has no LiPo charger and its LDO needs ≥ 3.6 V: put a 1S USB-C charge + 5 V boost module (TP4056 + MT3608 class) between the cell and the 5V pin. XiaoZhi cores and the XIAO ESP32-S3 charge on board.' });
    if (servoPorts.length && oneS && servoMin > 4.2) checks.push({ group: 'Power', id: 'servo_rail', label: 'Servo rail', status: 'warn',
      detail: `A 1S cell (${batV} V nominal, 4.2 V full) is under the servos' ${servoMin} V minimum: feed the PCA9685 V+ from the 5 V boost, not the cell.` });
  } else if (need) {
    const ok = need.v === 5 ? supplyA >= need.a : batV >= 9;
    checks.push({ group: 'Power', id: need.v === 5 ? 'voltage' : 'jetson_vin', label: `Power (${name(board).split(' (')[0]})`, status: ok ? 'pass' : need.v === 5 ? 'fail' : 'warn',
      detail: need.v === 5
        ? (ok ? `${need.how} from the ${ups ? 'UPS HAT' : '5 V 5 A buck'} (${supplyA} A) on the ${ups ? 'two 18650 cells' : name(bat)}.`
          : `${name(board)} needs ${need.how}: add a BUCK-5V-5A on a 2S pack${platform === 'rpi' ? ' or a UPS-HAT-PI' : ''} (the ${bat ? name(bat) : 'battery'} can't feed it directly).`)
        : (ok ? `${need.how} from the ${batV} V pack.` : `${need.how}: a ${batV || '?'} V pack is below 9 V. Use a 3S / 4S pack or a 12 V boost.`) });
  }

  // ---- current on the 5 V rail and runtime
  const d = (id: string, k: string, dv = 0) => CATALOG[id]?.data[k] ?? dv;
  const parts5 = ids.filter(id => ['display', 'sensor', 'shield'].includes(CATALOG[id]?.kind ?? '') && id !== 'BUCK-5V-5A');
  let avg5 = d(board, 'currentNomA', 0.3) + parts5.reduce((s, id) => s + d(id, 'currentNomA', 0.01), 0) + (amp ? 0.12 : 0);
  let peak5 = d(board, 'currentMaxA', 1) + parts5.reduce((s, id) => s + d(id, 'currentMaxA', d(id, 'currentNomA', 0.01)), 0);
  for (const x of acts.filter(x => x.kind !== 'motor')) {
    avg5 += x.kind === 'cservo' ? 0.22 : 0.12;
    peak5 += actuatorRating(x.catalogId).stallA;
  }
  const vBat = batV || (need?.v ?? 5), eff = 0.88;
  const toBat = (i5: number) => (i5 * SERVO_RAIL_V) / (vBat * eff);
  const avgA = toBat(avg5), peakA = toBat(peak5);
  const runtimeMin = batMAh ? (batMAh / 1000) * 0.85 / avgA * 60 : 0;
  const limit = supplyA || (platform === 'xiaozhi' ? 2.0 : 0);
  checks.push({ group: 'Power', id: 'current', label: 'Current budget (5 V rail)', status: limit && peak5 > limit ? 'warn' : 'pass',
    detail: `Typical ${avg5.toFixed(2)} A at 5 V (${avgA.toFixed(2)} A from the battery), peak ${peak5.toFixed(1)} A with every servo stalled` +
      (limit ? ` vs ${limit} A from the ${supplyA ? (ups ? 'UPS HAT' : 'buck') : '1S boost (assumed 2 A)'}${peak5 > limit ? ': give the servo board V+ its own 5 V supply, or avoid stalls' : ''}.` : '.') });
  checks.push({ group: 'Power', id: 'runtime', label: 'Estimated runtime', status: !batMAh ? 'warn' : runtimeMin < 30 ? 'warn' : 'pass',
    detail: batMAh ? `≈ ${runtimeMin.toFixed(0)} min of typical talking${servoPorts.length ? ' and motion' : ''} on ${name(bat)} (${batMAh} mAh, 85 % usable, ${Math.round(eff * 100)} % conversion).` : 'No battery: runs on its USB-C / barrel supply only.' });

  // ---- buses to verify on the real board
  if (servoPorts.length && sb && sb !== 'BUS-SERVO-ADAPTER') checks.push({ group: 'Electrical', id: 'i2c', label: 'PCA9685 bus (verify)', status: 'warn',
    detail: platform === 'xiaozhi' ? 'PCA9685 on I2C SDA GPIO41 / SCL GPIO42 (I2C_SDA / I2C_SCL in config.py), address 0x40.'
      : platform === 'rpi' ? 'PCA9685 on I2C bus 1 (header pins 3 / 5, 0x40): enable I2C in raspi-config, `i2cdetect -y 1` shows 40.'
      : 'PCA9685 on header pins 3 / 5: i2c bus 1 on the Jetson Nano, bus 7 on the Orin Nano (`i2cdetect -y -r <bus>` shows 40).' });
  if (platform === 'jetson' && amp === 'AMP-MAX98357A') checks.push({ group: 'Electrical', id: 'i2s', label: 'I2S amp on Jetson (verify)', status: 'warn',
    detail: 'The MAX98357A needs the header I2S pins (12 BCLK, 35 LRCK, 40 DOUT) enabled with jetson-io and an ALSA card for them; a USB speaker / sound card is the driver-free alternative.' });
  return { avgA, peakA, runtimeMin };
}

/** Wiring rows [from, to, pin, note] for the voice core (null when the assembly has none). Shared by the pipeline and the Inspector. */
export function voiceWiring(a: Assembly): [string, string, string, string][] | null {
  const board = a.components.find(c => c.key === 'voice_board')?.catalogId;
  if (!board) return null;
  const ids = a.components.map(c => c.catalogId), has = (id: string) => ids.includes(id);
  const nm = (id: string) => CATALOG[id]?.name.split(' (')[0] ?? id;
  const esp = !board.startsWith('RPI-') && !board.startsWith('JETSON'), pi = board.startsWith('RPI-'), orin = board === 'JETSON-ORIN-NANO';
  const acts = a.links.filter(l => l.joint).map(l => l.joint!.actuator);
  const display = ids.find(id => CATALOG[id]?.kind === 'display');
  const bat = ids.find(id => CATALOG[id]?.kind === 'battery');
  const sb = ids.find(id => PCA_BOARDS.includes(id)) ?? (has('BUS-SERVO-ADAPTER') ? 'BUS-SERVO-ADAPTER' : undefined);
  const hats = a.components.filter(c => c.key.startsWith('voice_hat_')).map(c => c.catalogId);
  const rows: [string, string, string, string][] = [];
  // power
  if (has('UPS-HAT-PI')) rows.push(['UPS HAT (2x 18650)', `${nm(board)} 5 V (header pins 2 / 4)`, '—', '5.1 V 5 A through the 40-pin header; charge on the HAT USB-C']);
  else if (has('BUCK-5V-5A') && bat) rows.push([`${nm(bat)}`, '5 V 5 A buck IN', '—', 'red + / black GND, ≥ 20 AWG'],
    ['5 V buck OUT', pi ? `${nm(board)} USB-C (or 5 V pins 2 / 4)` : `${nm(board)} DC barrel`, '—', board === 'JETSON-NANO' ? '5 V 4 A barrel; fit the J48 jumper' : '5.1 V, short thick leads']);
  else if (bat) rows.push([`${nm(bat)}`, esp ? `${nm(board)} 5V / BAT (via 1S charger + boost)` : `${nm(board)} power input`, '—', esp ? 'charge over USB-C' : 'check the input voltage']);
  // HAT stack
  hats.forEach((h, i) => rows.push([nm(h), i ? `stacked on ${nm(hats[i - 1])}` : `${nm(board)} 40-pin header`, 'HAT stack', i ? '2x20 stacking header, M2.5 x 11 standoffs' : 'M2.5 x 11 standoffs']));
  // audio
  if (has('MIC-INMP441')) rows.push(...(esp
    ? [['INMP441 SCK · WS · SD', 'ESP32-S3 GPIO5 · GPIO4 · GPIO6', 'I2S0 RX', 'L/R to GND (left), VDD 3.3 V']]
    : [['INMP441 SCK · WS · SD', pi ? 'Pi GPIO18 · GPIO19 · GPIO20 (pins 12 / 35 / 38)' : 'Jetson pins 12 / 35 / 38', 'I2S RX', 'L/R to GND, VDD 3.3 V; needs the I2S overlay']]) as [string, string, string, string][]);
  if (has('AMP-MAX98357A')) rows.push(esp
    ? ['MAX98357A BCLK · LRC · DIN', 'ESP32-S3 GPIO15 · GPIO16 · GPIO7', 'I2S1 TX', 'Vin 5 V, GND; GAIN open = 9 dB']
    : ['MAX98357A BCLK · LRC · DIN', pi ? 'Pi GPIO18 · GPIO19 · GPIO21 (pins 12 / 35 / 40)' : 'Jetson pins 12 / 35 / 40 (enable with jetson-io)', 'I2S TX', 'Vin 5 V, GND; ALSA card via the I2S overlay']);
  if (has('RESPEAKER-2MIC-HAT')) rows.push(['ReSpeaker 2-mic HAT (WM8960)', 'Pi I2S + I2C 0x1a (on the header)', 'I2S / I2C', 'seeed-voicecard overlay; button GPIO17'],
    ['Speaker', 'ReSpeaker JST-PH speaker out', '—', '8 Ω, 1 W max']);
  else if (has('AMP-MAX98357A')) rows.push(['Speaker', 'MAX98357A screw terminal', '—', '8 Ω (4 Ω for 3 W)']);
  if (has('USB-MIC-MINI')) rows.push(['USB microphone', `${nm(board)} USB-A port`, 'USB', 'plug-and-play ALSA card']);
  if (board === 'ZHAOZHI-AI-CORE') rows.push(['Speaker', 'XiaoZhi core JST-ZH speaker', '—', 'dual mics and the I2S amp are on the core']);
  // display
  if (display === 'OLED-SSD1306') rows.push(['SSD1306 OLED SDA · SCL', esp ? 'ESP32-S3 GPIO41 · GPIO42' : pi ? 'Pi I2C bus 1 (pins 3 / 5)' : `Jetson I2C bus ${orin ? 7 : 1} (pins 3 / 5)`, 'I2C 0x3C', 'VCC 3.3 V']);
  else if (display) rows.push([`${nm(display)} SCK · MOSI · CS · DC · RST · BL`, esp ? 'ESP32-S3 GPIO21 · 47 · 39 · 40 · 45 · 38' : pi ? 'Pi SPI0 (pins 23 / 19 / 24), DC GPIO25, RST GPIO27, BL GPIO24' : 'Jetson SPI1 (pins 23 / 19 / 24), DC pin 22, RST pin 13, BL pin 18',
    'SPI', esp ? 'VCC 3.3 V' : 'fbtft / panel overlay -> /dev/fb1']);
  // servos
  if (acts.length && sb === 'BUS-SERVO-ADAPTER') {
    rows.push(['Bus servo adapter', `${nm(board)} USB`, '/dev/ttyUSB0', 'servo power 6-12 V on the adapter jack']);
    acts.forEach(x => rows.push([`${x.label} (${x.catalogId})`, 'servo bus (daisy chain)', `id ${Number(x.port.slice(1))}`, '3-pin GND · V+ · DATA']));
  } else if (acts.length && sb) {
    const hatSb = hats.includes(sb);
    rows.push([`${nm(sb)} SDA · SCL · VCC · GND`, hatSb ? 'on the header (I2C bus 1)' : esp ? 'ESP32-S3 GPIO41 · GPIO42 · 3V3 · GND' : pi ? (has('RESPEAKER-2MIC-HAT') ? 'ReSpeaker Grove I2C (bus 1)' : 'Pi pins 3 · 5 · 1 · 6 (bus 1)') : `Jetson pins 3 · 5 · 1 · 6 (bus ${orin ? 7 : 1})`, 'I2C 0x40', '4-wire'],
      [has('UPS-HAT-PI') ? 'UPS HAT 5 V' : has('BUCK-5V-5A') ? '5 V buck OUT' : '5 V supply (boost)', `${nm(sb)} V+`, '—', 'servo power, not the logic 3.3 V']);
    acts.forEach(x => rows.push([`${x.label} (${x.catalogId})`, `${nm(sb)} channel ${Number(x.port.slice(1)) - 1}`, `PWM ch${Number(x.port.slice(1)) - 1}`, 'brown GND · red V+ · orange signal']));
  }
  return rows;
}

function analyzeRest(spec: RobotSpec, a: Assembly, checks: Check[], joints: Assembly['links'], acts: Act[], power: { avgA: number; peakA: number; runtimeMin: number }) {
  const { avgA, peakA, runtimeMin } = power;

  // ---------------------------------------------------------------- motion: servo torque margins
  const payloadG = spec.archetype === 'arm' ? spec.params.payloadG : 0;
  for (const x of acts.filter(x => x.kind === 'servo')) {
    const id = x.link.id;
    // only the joints of this servo's own chain move its load (its ancestors tilt it, its descendants hang off it);
    // another branch (the other leg, an arm) never does, and every pose of every servo would be 6^n poses
    const parentOf = new Map(a.links.map(l => [l.id, l.parent]));
    const ancestors = new Set<string>();
    for (let p = parentOf.get(id); p; p = parentOf.get(p) ?? null) ancestors.add(p);
    const below = (l: string) => { for (let p = parentOf.get(l); p; p = parentOf.get(p) ?? null) if (p === id) return true; return false; };
    const others = joints.filter(j => j.joint!.actuator.kind === 'servo' && j.id !== id && (ancestors.has(j.id) || below(j.id)));
    const grid = (l: typeof joints[number]) => { const [lo, hi] = l.joint!.limit ?? [0, 0]; return [lo, (lo + hi) / 2, hi, lo / 2, hi / 2, 0]; };
    let worst = 0; let worstPose: Angles = {};
    const combos = (i: number, acc: Angles) => {
      if (i === others.length) {
        for (const v of grid(x.link)) {
          const pose = { ...acc, [id]: v };
          const t = Math.abs(gravityTorque(a.links, id, pose, a.meta.payload && payloadG ? { ...a.meta.payload, g: payloadG } : undefined));
          if (t > worst) { worst = t; worstPose = pose; }
        }
        return;
      }
      for (const v of grid(others[i])) combos(i + 1, { ...acc, [others[i].id]: v });
    };
    combos(0, {});
    const r = actuatorRating(x.catalogId);
    const margin = worst > 1e-6 ? r.torqueNm / worst : Infinity;
    const kg = (n: number) => (n / 0.0980665).toFixed(2);
    checks.push({ group: 'Motion', id: `torque_${id}`, label: `Torque: ${x.label} (${x.port})`, status: margin < 1 ? 'fail' : margin < 1.5 ? 'warn' : 'pass',
      detail: `Worst static load ${kg(worst)} kgf·cm vs ${kg(r.torqueNm)} kgf·cm available at ${r.volts} V → margin ×${Number.isFinite(margin) ? margin.toFixed(1) : '∞'}` +
        (Object.keys(worstPose).length > 1 ? ` (pose ${Object.entries(worstPose).map(([k, v]) => `${k} ${v.toFixed(0)}°`).join(', ')})` : '') + (payloadG ? `, payload ${payloadG} g.` : '.') });
  }

  // ---------------------------------------------------------------- walking legs: the standing load
  // The check above holds the base still, so a leg servo only lifts its own leg. Standing, each leg carries half the
  // robot: in the walk's deepest crouch (knee bent ~30°, foot flat) the knee and ankle see half the weight on a
  // thigh / shin's lever.
  const knee = a.links.find(l => l.id === 'knee_R'), ankle = a.links.find(l => l.id === 'ankle_R'), hip = a.links.find(l => l.id === 'hip_R');
  if (knee?.joint && ankle?.joint && hip?.joint) {
    const totalG = a.links.reduce((s, l) => s + l.massG, 0);
    const legL = Math.abs(hip.joint.origin[2] - knee.joint.origin[2]) / 1000;          // thigh = shin, m
    const load = (totalG / 2) / 1000 * 9.81 * legL * Math.sin(30 * Math.PI / 180);       // N·m at the knee and the ankle
    const r = actuatorRating(knee.joint.actuator.catalogId);
    const margin = r.torqueNm / load;
    checks.push({ group: 'Motion', id: 'leg_load', label: 'Standing load on the legs', status: margin < 1 ? 'fail' : margin < 1.5 ? 'warn' : 'pass',
      detail: `${(totalG / 2).toFixed(0)} g per leg on a ${(legL * 1000).toFixed(0)} mm thigh / shin: ${(load / 0.0980665).toFixed(2)} kgf·cm at the knee and the ankle in a 30° crouch vs ${(r.torqueNm / 0.0980665).toFixed(2)} kgf·cm → margin ×${margin.toFixed(1)}${margin < 1.5 ? '; use metal-gear servos (MG90S) or a lighter head / body' : ''}.` });
  }

  // ---------------------------------------------------------------- stability
  const massG = a.links.reduce((s, l) => s + l.massG, 0) + payloadG;
  const comAt = (pose: Angles): Vec3 => {
    const T = fk(a.links, pose);
    const c: Vec3 = [0, 0, 0];
    let m = 0;
    for (const l of a.links) { const p = apply(T.get(l.id)!, l.com); for (let i = 0; i < 3; i++) c[i] += p[i] * l.massG; m += l.massG; }
    if (payloadG && a.meta.payload) { const p = apply(T.get(a.meta.payload.link)!, a.meta.payload.at); for (let i = 0; i < 3; i++) c[i] += p[i] * payloadG; m += payloadG; }
    return [c[0] / m, c[1] / m, c[2] / m];
  };
  const poly = a.meta.support;
  if (poly) {
    const margin = (p: Vec3) => {
      let best = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
        const ex = x2 - x1, ey = y2 - y1, len = Math.hypot(ex, ey);
        const d = ((p[0] - x1) * ey - (p[1] - y1) * ex) / len;    // >0 inside for clockwise / <0 ccw
        best = Math.min(best, d);
      }
      return best;
    };
    const area = poly.reduce((s, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return s + x * y2 - x2 * y; }, 0);
    const sgn = area > 0 ? -1 : 1;
    if (spec.archetype === 'arm') {
      let worst = Infinity; let pose: Angles = {};
      for (const yaw of [-90, -45, 0, 45, 90]) for (const up of [-50, -25, 0]) for (const fo of [-45, 0, 45, 90]) {
        const p = { yaw, upper: up, fore: fo }; const m = sgn * margin(comAt(p));
        if (m < worst) { worst = m; pose = p; }
      }
      checks.push({ group: 'Stability', id: 'tip', label: 'Tip-over (unclamped base)', status: worst > 5 ? 'pass' : 'warn',
        detail: worst > 5 ? `Combined COM stays ${worst.toFixed(0)} mm inside the base footprint in every pose.` : `At yaw ${pose.yaw}°, shoulder ${pose.upper}°, elbow ${pose.fore}° the COM is ${(-worst).toFixed(0)} mm ${worst < 0 ? 'outside' : 'from the edge of'} the footprint. Screw or clamp the base tabs down (the simulator can show both).` });
    } else {
      const c = comAt({});
      const m = sgn * margin(c);
      checks.push({ group: 'Stability', id: 'tip', label: 'Static stability', status: m > 8 ? 'pass' : m > 0 ? 'warn' : 'fail',
        detail: `Centre of mass at (${c[0].toFixed(0)}, ${c[1].toFixed(0)}, ${c[2].toFixed(0)}) mm, ${m.toFixed(0)} mm inside the ${spec.archetype === 'rover' ? 'wheel-skid triangle' : 'footprint'}.` });
    }
  }

  // ---------------------------------------------------------------- rover performance
  let topSpeed: number | undefined, maxSlopeDeg: number | undefined;
  const wheel = acts.find(x => x.kind !== 'servo');
  if (wheel && a.meta.wheelR) {    // rovers and mobile compositions (rover chassis)
    const r = actuatorRating(wheel.catalogId);
    const R = a.meta.wheelR / 1000;
    topSpeed = r.omega * R;
    const F = (2 * r.torqueNm * 0.5) / R;                   // two wheels at half stall torque
    const mu = spec.params.tpuTires ? 1.0 : 0.5;
    const W = (massG / 1000) * 9.81;
    const tractionDeg = (Math.atan(mu) * 180) / Math.PI;
    maxSlopeDeg = Math.min(tractionDeg, (Math.asin(Math.min(1, F / W)) * 180) / Math.PI);
    checks.push({ group: 'Motion', id: 'speed', label: 'Drive performance', status: topSpeed < 0.08 ? 'warn' : 'pass',
      detail: `Top speed ≈ ${(topSpeed * 100).toFixed(0)} cm/s (${(r.omega * 60 / (2 * Math.PI)).toFixed(0)} rpm at ${r.volts} V on Ø${spec.params.wheelDia} wheels); climbs ≈ ${maxSlopeDeg.toFixed(0)}° at half torque (${tractionDeg < maxSlopeDeg + 0.1 ? 'traction' : 'torque'}-limited).` });
  }

  // ---------------------------------------------------------------- printability
  const stats = partStats(a);
  const big = stats.filter(s => s.fits === 'too big');
  checks.push({ group: 'Print', id: 'bed', label: 'Build volume', status: big.length ? 'fail' : stats.some(s => s.fits !== 'A1 mini') ? 'warn' : 'pass',
    detail: big.length ? `Too big for a 256 mm bed: ${big.map(s => s.name).join(', ')}` : stats.some(s => s.fits !== 'A1 mini') ? `Fits a 256 mm bed; ${stats.filter(s => s.fits !== 'A1 mini').map(s => s.name).join(', ')} won't fit an A1 mini.` : 'Every part fits a 180 mm bed (A1 mini).' });
  const structural = a.parts.filter(p => ['chassis', 'motorMount', 'cantilever', 'wheel'].includes(p.profile));
  const weak = structural.filter(p => !MATERIALS[p.material].motorSafe);
  checks.push({ group: 'Print', id: 'material', label: 'Material rule (motor mounts)', status: weak.length ? 'fail' : 'pass',
    detail: weak.length ? `PLA in load/motor parts: ${weak.map(p => p.name).join(', ')}. Use PETG or ABS (PLA creeps at motor temperatures).` : `Structural parts in ${[...new Set(structural.map(p => p.material))].join(', ')}.` });
  const tpu = a.parts.filter(p => p.material === 'TPU 95A');
  if (tpu.length) checks.push({ group: 'Print', id: 'tpu', label: 'Flexible parts', status: 'pass', detail: `${tpu.map(p => p.name).join(', ')} in TPU 95A: direct-drive extruder, slow (≈ 3-5 mm³/s), 15 % gyroid.` });
  checks.push({ group: 'Print', id: 'tolerances', label: 'Fits & holes (guide s.4-5)', status: 'pass', detail: 'Push-fit pockets +0.40, sliding +0.20/wall, journals +0.40, press +0.05, LED pockets 6.6, taps M2 Ø1.7 / M2.5 Ø2.15 / M3 Ø2.6, clearances Ø2.3 / Ø2.8 / Ø3.4.' });

  return {
    checks,
    totals: {
      massG, printG: stats.reduce((s, p) => s + p.grams, 0), printH: stats.reduce((s, p) => s + p.hours, 0),
      avgA, peakA, runtimeMin, topSpeed, maxSlopeDeg,
    },
  };
}

export interface BomLine { id: string; name: string; qty: number; note?: string; kind: 'module' | 'fastener' | 'print' | 'other' }

export function bom(a: Assembly): BomLine[] {
  const out: BomLine[] = [];
  const counts = new Map<string, number>();
  for (const c of a.components) if (CATALOG[c.catalogId]) counts.set(c.catalogId, (counts.get(c.catalogId) ?? 0) + 1);
  for (const [id, n] of counts) out.push({ id, name: CATALOG[id].name, qty: n, kind: 'module', note: CATALOG[id].massEstimated ? `${CATALOG[id].massG} g (est.)` : `${CATALOG[id].massG} g` });
  const horns = a.components.filter(c => c.catalogId === 'horn').length;
  if (horns) out.push({ id: 'horn', name: 'Single-arm servo horn (in the servo bag)', qty: horns, kind: 'other' });
  for (const f of a.fasteners) out.push({ id: f.size, name: `Screw ${f.size}`, qty: f.qty, note: f.use, kind: 'fastener' });
  for (const e of a.extras) out.push({ id: e.item, name: e.item, qty: e.qty, kind: 'other' });
  const byMat = new Map<string, number>();
  for (const s of partStats(a)) byMat.set(s.material, (byMat.get(s.material) ?? 0) + s.grams);
  for (const [m, g] of byMat) out.push({ id: m, name: `${m} filament`, qty: Math.ceil(g), note: 'grams incl. infill, no supports', kind: 'print' });
  return out;
}
