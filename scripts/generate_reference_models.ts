// Generates watertight 3D STL models and an archive for all CyberBrick hardware components
// and the official Reference Under-Hood Horizontal Cross-Clamping Mechanism (Guide Section 10).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { initKernel, box, cylX, cylY, cylZ, rrect, sub, union, hexZ, meshOf, type M } from '../src/cad/kernel';
import { stlBinary } from '../src/export/files';
import { HOLES } from '../src/catalog/rules';
import { SV, SV_X0, SV_X1, SV_CX, EAR_HOLES, EAR_X0, EAR_X1, BAT, SHIELD, CORE, SWITCH, HUB } from '../src/cad/modules';

await initKernel();

const publicRefDir = fileURLToPath(new URL('../public/reference', import.meta.url));
mkdirSync(publicRefDir, { recursive: true });

console.log('Generating CyberBrick Reference 3D Models...');

// 1. B-XA003: ESP32-C3 Core Controller (22.0 x 27.0 x 11.2 mm)
function buildB_XA003(): M {
  const pcb = rrect(CORE.x, CORE.y, 1.5, 0, 0, 0, 1.6);
  const shieldCan = rrect(16, 18, 1.0, 0, -1, 1.6, 5.0);
  const usbc = box(-4.5, 4.5, -CORE.y / 2 - 1.0, -CORE.y / 2 + 6.0, 1.6, 4.8);
  const headers = union([
    box(-CORE.x / 2 + 1, -CORE.x / 2 + 3.5, -CORE.y / 2 + 2, CORE.y / 2 - 2, 5.0, 11.2),
    box(CORE.x / 2 - 3.5, CORE.x / 2 - 1, -CORE.y / 2 + 2, CORE.y / 2 - 2, 5.0, 11.2),
  ]);
  return union([pcb, shieldCan, usbc, headers]);
}

// 2. B-XA004: Receiver & Power Distribution Shield (29.0 x 30.0 x 12.0 mm, 4x M2.5 at 23x24mm)
function buildB_XA004(): M {
  const pcb = sub(
    rrect(SHIELD.x, SHIELD.y, 2.0, 0, 0, 0, 1.6),
    ...[-1, 1].flatMap(i => [-1, 1].map(j => cylZ(i * 23.0 / 2, j * 24.0 / 2, HOLES.M2_5.clear / 2, -1, 3, 24)))
  );
  // Stacking headers + 4 servo headers S1-S4 + D1 port
  const stackingBus = union([
    box(-CORE.x / 2 + 1, -CORE.x / 2 + 3.5, -CORE.y / 2 + 2, CORE.y / 2 - 2, 1.6, 5.0),
    box(CORE.x / 2 - 3.5, CORE.x / 2 - 1, -CORE.y / 2 + 2, CORE.y / 2 - 2, 1.6, 5.0),
  ]);
  const servoHeaders = box(-11, 11, SHIELD.y / 2 - 7, SHIELD.y / 2 - 1, 1.6, 10.5);
  const powerJack = box(-5, 5, -SHIELD.y / 2 + 1, -SHIELD.y / 2 + 8, 1.6, 8.0);
  const d1Port = box(-12, -7, 0, 6, 1.6, 6.0);
  return union([pcb, stackingBus, servoHeaders, powerJack, d1Port]);
}

// 3. B-PG001 / B-PG002: 9g Micro Servo (22.8 x 12.0 x 28.5 mm, Ear span 32.4 mm, Ear pitch 27.8 mm)
function buildServo(isContinuous = false): M {
  const body = box(SV_X0, SV_X1, -SV.W / 2, SV.W / 2, -SV.below, SV.above);
  const ears = sub(
    box(EAR_X0, EAR_X1, -SV.W / 2, SV.W / 2, 0, SV.earT),
    ...EAR_HOLES.map(x => cylZ(x, 0, HOLES.M2.clear / 2, -1, SV.earT + 1, 20))
  );
  const spline = cylZ(0, 0, SV.splineR, SV.above, SV.splineTop, 24);
  const secondaryShaft = cylZ(SV_CX + 2.5, 0, 2.5, SV.above, SV.above + 2.0, 20);
  return union([body, ears, spline, secondaryShaft]);
}

// 4. B-GM001: 030 Geared Motor (38.0 x 15.5 x 12.0 mm, D-shaft Ø3.0 mm flat 2.5 mm)
function buildB_GM001(): M {
  const motor = box(-38.0, 0, -15.5 / 2, 15.5 / 2, -6.0, 6.0);
  const dShaft = sub(
    cylX(0, 0, 1.5, 0, 10.0, 24),
    box(-1, 11, -2.0, 2.0, 1.0, 3.0) // Flat at 2.5 mm thickness
  );
  const terminals = union([
    box(-40.0, -38.0, -4.0, -2.0, -1.0, 1.0),
    box(-40.0, -38.0, 2.0, 4.0, -1.0, 1.0),
  ]);
  return union([motor, dShaft, terminals]);
}

// 5. B-PC003: 7.4V 800mAh 2S Li-ion Battery (51.2 x 28.4 x 16.3 mm)
function buildB_PC003(): M {
  const z0 = 0;
  const zc = z0 + BAT.cellR;
  const cells = union([
    cylY(-BAT.cellR, zc, BAT.cellR, -BAT.y / 2, BAT.y / 2, 32),
    cylY(BAT.cellR, zc, BAT.cellR, -BAT.y / 2, BAT.y / 2, 32),
    box(-BAT.x / 2, BAT.x / 2, -BAT.y / 2, BAT.y / 2, zc, z0 + BAT.z - 2),
  ]);
  const bms = box(-BAT.x / 2 + 1, BAT.x / 2 - 1, -BAT.y / 2, BAT.y / 2, z0 + BAT.z - 2, z0 + BAT.z);
  const plug = box(-3.0, 3.0, -BAT.y / 2 - 6.0, -BAT.y / 2, zc - 2.5, zc + 2.5);
  return union([cells, bms, plug]);
}

// 6. B-XA007: Slide Toggle Power Switch (20.5 x 14.0 x 13.5 mm)
function buildB_XA007(): M {
  const body = box(-SWITCH.x / 2, SWITCH.x / 2, -SWITCH.y / 2, SWITCH.y / 2, 0, 8.5);
  const ear = sub(
    box(-SWITCH.x / 2 - 5.0, SWITCH.x / 2 + 5.0, -4.0, 4.0, 0, 1.5),
    cylZ(-SWITCH.x / 2 - 2.5, 0, HOLES.M2_5.clear / 2, -1, 3, 16),
    cylZ(SWITCH.x / 2 + 2.5, 0, HOLES.M2_5.clear / 2, -1, 3, 16)
  );
  const knob = box(-2.5, 2.5, -2.0, 2.0, 8.5, SWITCH.z);
  return union([body, ear, knob]);
}

// 7. B-XA006: LED Distribution Hub PCB (28.0 x 6.0 x 11.0 mm)
function buildB_XA006(): M {
  const pcb = sub(
    rrect(HUB.x, HUB.y, 1.5, 0, 0, 0, 1.6),
    cylZ(0, 0, HOLES.M2_5.clear / 2, -1, 3, 16)
  );
  const headers = union([
    box(-HUB.x / 2 + 0.5, HUB.x / 2 - 0.5, -HUB.y / 2 + 2, -2.0, 1.6, HUB.z),
    box(-HUB.x / 2 + 0.5, HUB.x / 2 - 0.5, 2.0, HUB.y / 2 - 2, 1.6, HUB.z),
  ]);
  return union([pcb, headers]);
}

// 8. B-KB003: WS2812 RGBW LED Module (6.0 x 6.0 x 2.8 mm)
function buildB_KB003(): M {
  const pcb = box(-3.0, 3.0, -3.0, 3.0, 0, 1.2);
  const dome = cylZ(0, 0, 2.4, 1.2, 2.8, 24);
  return union([pcb, dome]);
}

// 9. 21T Micro Spline Horn (21T micro spline Ø4.8mm)
function buildHorn(): M {
  const hub = cylZ(0, 0, 3.5, 0, 4.0, 24);
  const arm = box(-2.5, 16.0, -2.5, 2.5, 2.0, 4.0);
  const splineHole = cylZ(0, 0, 2.4, -1, 5.0, 24);
  const pilots = union([
    cylZ(10.0, 0, HOLES.M2.tap / 2, -1, 5.0, 16),
    cylZ(13.5, 0, HOLES.M2.tap / 2, -1, 5.0, 16),
  ]);
  return sub(union([hub, arm]), splineHole, pilots);
}

// 10. Reference Under-Hood Horizontal Cross-Clamping Mechanism (Guide Section 10, Figure 4.1)
function buildCrossClampReference(): M {
  const width = 36.0, depth = 28.0, height = 24.0;
  const tongueW = 14.0;
  // Left and Right Cheek base with tongue slot
  const block = box(-width / 2, width / 2, -depth / 2, depth / 2, 0, height);
  const tongueSlot = box(-tongueW / 2 - 0.3, tongueW / 2 + 0.3, -depth / 2 - 1, depth / 2 + 1, 6.0, height + 1);
  const boltHole = cylX(0, 15.0, HOLES.M3.clear / 2, -width / 2 - 1, width / 2 + 1, 24);
  const captiveNut = hexZ(width / 2 - 3.5, 0, 5.6, 15.0 - 2.8, 15.0 + 2.8).rotate([0, 90, 0]);
  const flangeCollar = box(-width / 2 - 3.0, width / 2 + 3.0, -depth / 2 - 3.0, depth / 2 + 3.0, 0, 3.0);
  return sub(union([block, flangeCollar]), tongueSlot, boltHole, captiveNut);
}

const models = [
  { id: 'B-XA003', name: 'ESP32-C3 Core Controller', file: 'B-XA003_ESP32_Core.stl', solid: buildB_XA003(), desc: '32-bit RISC-V @160MHz controller with USB-C and stacking bus' },
  { id: 'B-XA004', name: 'Receiver & Power Shield', file: 'B-XA004_Power_Shield.stl', solid: buildB_XA004(), desc: '4x Servo headers S1-S4, D1 addressable LED port, M2.5 23x24mm pitch' },
  { id: 'B-PG001', name: '180° Positional Micro Servo', file: 'B-PG001_180_Servo.stl', solid: buildServo(false), desc: '1.2 kgf·cm @ 6V, 21T spline Ø4.8mm, ear span 32.4mm, ear pitch 27.8mm' },
  { id: 'B-PG002', name: '360° Continuous Micro Servo', file: 'B-PG002_Continuous_Servo.stl', solid: buildServo(true), desc: '120 RPM @ 6V, 1.6 kgf·cm, 21T micro spline' },
  { id: 'B-GM001', name: '030 High-Torque Geared Motor', file: 'B-GM001_Geared_Motor.stl', solid: buildB_GM001(), desc: '180 RPM @ 6V, 2.4 kgf·cm, Ø3.0mm D-shaft with 2.5mm flat' },
  { id: 'B-PC003', name: '7.4V 800mAh 2S Li-ion Battery', file: 'B-PC003_2S_Battery.stl', solid: buildB_PC003(), desc: 'Twin 14500 Li-ion cells, integrated BMS, XH2.54 2-pin connector' },
  { id: 'B-XA007', name: 'Slide Toggle Power Switch', file: 'B-XA007_Toggle_Switch.stl', solid: buildB_XA007(), desc: 'Rated 50V/0.5A, SPDT toggle, 1x M2.5 ear mounting hole' },
  { id: 'B-XA006', name: 'LED Distribution Hub PCB', file: 'B-XA006_LED_Hub.stl', solid: buildB_XA006(), desc: '6-branch WS2812 splitter with M2.5 center mounting boss' },
  { id: 'B-KB003', name: 'WS2812 RGBW LED Module', file: 'B-KB003_RGBW_LED.stl', solid: buildB_KB003(), desc: 'Addressable 5050 package, 6.0 x 6.0 x 2.8 mm' },
  { id: 'Horn-21T', name: '21T Micro Spline Single-Arm Horn', file: 'Horn_21T_Micro_Spline.stl', solid: buildHorn(), desc: 'Standard CyberBrick 21T horn with pilot holes at 10.0 and 13.5 mm' },
  { id: 'Ref-Clamp', name: 'Under-Hood Cross-Clamp Joint', file: 'Reference_Under_Hood_Tongue_Cheek_Clamp.stl', solid: buildCrossClampReference(), desc: 'Guide s.10 Figure 4.1 Tongue & Cheek Cross-Lock joint with captive M3 nut' },
];

const zipEntries: Record<string, Uint8Array> = {};
const manifest: any[] = [];

for (const m of models) {
  const mesh = meshOf(m.solid);
  const stl = stlBinary(mesh, m.name);
  const filePath = join(publicRefDir, m.file);
  writeFileSync(filePath, stl);
  zipEntries[m.file] = stl;

  manifest.push({
    id: m.id,
    name: m.name,
    file: m.file,
    url: `/reference/${m.file}`,
    description: m.desc,
    triangles: mesh.indices.length / 3,
    sizeKb: Math.round(stl.byteLength / 1024),
  });
  console.log(`✓ Generated ${m.file} (${mesh.indices.length / 3} tris, ${Math.round(stl.byteLength / 1024)} KB)`);
}

// Add README in ZIP
const zipReadme = `# Bambu Lab CyberBrick Hardware 3D Models & Reference Designs
Generated according to CyberBrick_Robotics_Hardware_and_3D_Design_Guide.pdf.

## Included Components
${models.map(m => `- ${m.file}: ${m.name} (${m.desc})`).join('\n')}

All files are binary STLs ready for import into Bambu Studio, OrcaSlicer, CAD, or 3D visualizers.
`;
zipEntries['README.md'] = strToU8(zipReadme);

// Save ZIP archive
const zipBuf = zipSync(zipEntries, { level: 6 });
const zipPath = join(publicRefDir, 'CyberBrick_Reference_3D_Models.zip');
writeFileSync(zipPath, zipBuf);
console.log(`✓ Generated ${zipPath} (${Math.round(zipBuf.byteLength / 1024)} KB)`);

// Save JSON manifest
writeFileSync(join(publicRefDir, 'components.json'), JSON.stringify(manifest, null, 2));
console.log('✓ Generated components.json manifest');
