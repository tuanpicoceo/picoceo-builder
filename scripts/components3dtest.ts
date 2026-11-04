// Verify procedural 3D models for all dev kits, HATs, sensors, displays, and motors.
import { initKernel } from '../src/cad/kernel';
import { CATALOG } from '../src/catalog/components';
import { getComponentSolid, getComponentColor } from '../src/cad/components3d';
import { bb } from '../src/cad/kernel';

await initKernel();

const testIds = [
  'RPI-4B',
  'RPI-5',
  'RPI-ZERO-2W',
  'RPI-PICO-W',
  'ESP32-DEV',
  'ESP32-S3-DEVKIT',
  'MICROBIT-V2',
  'XIAO-ESP32-C3',
  'XIAO-ESP32-S3',
  'ARDUINO-UNO',
  'ZHAOZHI-AI-CORE',
  'JETSON-ORIN-NANO',
  'SHIELD-RPI-ROBOT',
  'SHIELD-ESP32-SERVO',
  'SHIELD-ARDUINO-MOTOR',
  'SHIELD-PICO-ROBOT',
  'HC-SR04',
  'OLED-SSD1306',
  'MPU-6050',
  'RPI-CAMERA-V2',
  'VL53L0X-TOF',
  'N20-MOTOR',
  'TT-MOTOR',
  'BAT-18650-1S',
  'BAT-18650-2S',
];

console.log(`Testing ${testIds.length} component 3D models...`);

let passed = 0;
for (const id of testIds) {
  const item = CATALOG[id];
  if (!item) {
    console.error(`FAIL: Catalog item missing for ${id}`);
    process.exit(1);
  }
  const solid = getComponentSolid(id, 0, 0, 0);
  const color = getComponentColor(id);
  const status = solid.status();
  const empty = solid.isEmpty();
  const volume = solid.volume();
  const bounds = bb(solid);

  if (status !== 'NoError' || empty || volume <= 0) {
    console.error(`FAIL: ${id} 3D model status=${status}, empty=${empty}, volume=${volume}`);
    process.exit(1);
  }

  const [sizeX, sizeY, sizeZ] = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];

  console.log(
    `PASS: [${id}] ${item.name} (${color}) -> volume: ${(volume / 1000).toFixed(1)} cm³, envelope: ${sizeX.toFixed(1)}x${sizeY.toFixed(1)}x${sizeZ.toFixed(1)} mm`
  );
  passed++;
}

console.log(`\nALL ${passed}/${testIds.length} PROCEDURAL 3D COMPONENT MODELS VERIFIED!`);
