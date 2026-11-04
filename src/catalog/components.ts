import type { Platform } from '../design/spec';
// CyberBrick component catalog.
// Source: CyberBrick_Robotics_Hardware_and_3D_Design_Guide.pdf (sections 1-3).
// Values marked `estimated: true` are NOT in the guide (typical values for that class of part);
// they only feed mass / balance estimates and are flagged in the UI.

export type ComponentKind =
  | 'controller' | 'shield' | 'servo' | 'cservo' | 'motor' | 'battery' | 'switch' | 'ledhub' | 'led' | 'speaker' | 'hardware' | 'sensor' | 'display' | 'camera';

export interface CatalogItem {
  id: string;
  kind: ComponentKind;
  name: string;
  /** Envelope X x Y x Z in mm, as listed in the guide. */
  size: [number, number, number];
  massG: number;
  massEstimated?: boolean;
  electrical: string;
  mechanical?: string;
  connector?: string;
  notes?: string[];
  /** Numeric data used by the checks and the simulator. */
  data: Record<string, number>;
}

export const CATALOG: Record<string, CatalogItem> = {
  'B-XA003': {
    id: 'B-XA003', kind: 'controller', name: 'ESP32-C3 Core Controller',
    size: [22.0, 27.0, 11.2], massG: 8.5,
    electrical: '32-bit RISC-V @160 MHz, 400 KB SRAM, 4 MB flash, BLE 5.0 (long range) + 2.4 GHz Wi-Fi',
    connector: 'USB-C; female 1.27 mm header bus that stacks on the shield',
    data: { clockMHz: 160 },
  },
  'B-XA004': {
    id: 'B-XA004', kind: 'shield', name: 'Receiver & Power Distribution Shield',
    size: [29.0, 30.0, 12.0], massG: 9, massEstimated: true,
    electrical: '6.0-9.0 V DC in (2S 7.4 V). 4x servo headers S1-S4 [GND, 5V, PWM]. D1 addressable port (5V, GND, Data). I2C/UART expansion.',
    mechanical: '4x M2.5 holes on a 23.0 x 24.0 mm pitch',
    notes: [
      'Motor (H-bridge) outputs are not listed in the guide. PICOCEO Builder assumes 2 motor ports (M1, M2) as on the community wiki; verify before wiring B-GM001 motors.',
      'Servo GPIOs S1-S4 = 3, 2, 1, 0 and D1 = 21 come from the community CyberBrick_ESPNOW wiki, not official docs.',
    ],
    data: { vinMin: 6.0, vinMax: 9.0, servoPorts: 4, motorPorts: 2, holePitchX: 23.0, holePitchY: 24.0, servo5vBudgetA: 3.0 },
  },
  'B-PG001': {
    id: 'B-PG001', kind: 'servo', name: '180° Positional Micro Servo',
    size: [22.8, 12.0, 28.5], massG: 9, massEstimated: true,
    electrical: '4.8-6.0 V DC. Pulse 500 µs (0°) to 2500 µs (180°), 50 Hz',
    mechanical: '1.2 kgf·cm @ 6 V. 60° in 0.12 s. Position-hold feedback. Ear span 32.4, ear pitch 27.8 mm',
    data: { vMin: 4.8, vMax: 6.0, torqueNm: 1.2 * 0.0980665, speedDegS: 500, stallA: 0.8, idleA: 0.02, rangeDeg: 180 },
  },
  'B-PG002': {
    id: 'B-PG002', kind: 'cservo', name: '360° Continuous Micro Servo',
    size: [22.8, 12.0, 28.5], massG: 9, massEstimated: true,
    electrical: '4.8-7.4 V DC, stall 0.8 A, idle 20 mA, PWM 50 Hz',
    mechanical: '120 RPM @ 6 V, 1.6 kgf·cm. 21T micro spline (Ø4.8). Ear span 32.4, ear pitch 27.8 mm',
    data: { vMin: 4.8, vMax: 7.4, torqueNm: 1.6 * 0.0980665, rpm: 120, stallA: 0.8, idleA: 0.02 },
  },
  'B-GM001': {
    id: 'B-GM001', kind: 'motor', name: '030 High-Torque Geared Motor',
    size: [38.0, 15.5, 12.0], massG: 12, massEstimated: true,
    electrical: '3.0-7.4 V DC, stall 1.2 A, nominal 180 mA, PWM H-bridge',
    mechanical: '180 RPM @ 6 V, 2.4 kgf·cm. Ø3.0 mm D-shaft (flat 2.5 mm)',
    notes: ['Shaft position and mounting holes are not in the guide; PICOCEO Builder assumes an axial shaft centred on the 15.5 x 12 end face and clamps the gearbox.'],
    data: { vMin: 3.0, vMax: 7.4, torqueNm: 2.4 * 0.0980665, rpm: 180, stallA: 1.2, nominalA: 0.18, shaftD: 3.0, shaftFlat: 2.5 },
  },
  'B-PC003': {
    id: 'B-PC003', kind: 'battery', name: '7.4 V 800 mAh 2S Li-ion Battery',
    size: [28.4, 51.2, 16.3], massG: 42, massEstimated: true,
    electrical: 'Twin 14500 cells in shrink wrap, integrated BMS',
    mechanical: 'Cradle space 34.0 x 56.5 mm',
    connector: 'XH2.54 2-pin male (red +7.4 V, black GND)',
    data: { voltage: 7.4, capacitymAh: 800, cellD: 14.2 },
  },
  'B-XA007': {
    id: 'B-XA007', kind: 'switch', name: 'Slide Toggle Power Switch',
    size: [20.5, 14.0, 13.5], massG: 3, massEstimated: true,
    electrical: 'Rated 50 V / 0.5 A, SPDT 2-position, 4.0 mm stroke',
    mechanical: 'Mounting ear: 1x M2.5 hole',
    connector: 'XH2.54 2-pin pass-through inline harness',
    notes: ['Rated 0.5 A: high-current builds (several stalled servos/motors) exceed the switch rating. See the power check.'],
    data: { ratedA: 0.5 },
  },
  'B-XA006': {
    id: 'B-XA006', kind: 'ledhub', name: 'LED Distribution Hub PCB',
    size: [28.0, 6.0, 11.0], massG: 2, massEstimated: true,
    electrical: 'Splits the single-wire WS2812 data line into 6 branch headers',
    mechanical: 'M2.5 centre mounting boss',
    connector: 'JST-SH 1.0 mm 3-pin micro headers',
    data: { branches: 6 },
  },
  'B-KB003': {
    id: 'B-KB003', kind: 'led', name: 'WS2812 RGBW LED Module',
    size: [6.0, 6.0, 2.8], massG: 0.5, massEstimated: true,
    electrical: 'Addressable 5050, 24-bit RGB + 3000 K warm white',
    mechanical: 'Mounting pocket 6.6 x 6.6 mm',
    connector: 'Solder pads / 3-wire daisy-chain ribbon',
    data: { pocket: 6.6, maxmA: 60 },
  },

  // ---------------------------------------------------------------- Popular SBCs & Controllers
  'RPI-4B': {
    id: 'RPI-4B', kind: 'controller', name: 'Raspberry Pi 4 Model B (4GB/8GB)',
    size: [85.6, 56.5, 17.0], massG: 46.0,
    electrical: 'Broadcom BCM2711 quad-core Cortex-A72 @ 1.5-1.8 GHz, 40-pin GPIO, Gigabit LAN, dual micro-HDMI',
    connector: 'USB-C (5V/3A), 40-pin 2.54 mm GPIO header',
    notes: ['Standard Linux SBC for AI vision, ROS 2, and high-level autonomous navigation.'],
    data: { clockMHz: 1800, vIn: 5.0, currentNomA: 0.6, currentMaxA: 3.0 },
  },
  'RPI-5': {
    id: 'RPI-5', kind: 'controller', name: 'Raspberry Pi 5 (4GB/8GB/16GB)',
    size: [85.6, 56.5, 17.5], massG: 48.0,
    electrical: 'Broadcom BCM2712 quad-core Cortex-A76 @ 2.4 GHz, 40-pin GPIO, PCIe 2.0, dual 4Kp60 HDMI',
    connector: 'USB-C PD (5V/5A), 40-pin GPIO header',
    notes: ['High-throughput Linux compute engine for SLAM, object detection, and on-device VLM agents.'],
    data: { clockMHz: 2400, vIn: 5.0, currentNomA: 0.8, currentMaxA: 5.0 },
  },
  'RPI-ZERO-2W': {
    id: 'RPI-ZERO-2W', kind: 'controller', name: 'Raspberry Pi Zero 2 W',
    size: [65.0, 30.0, 5.2], massG: 10.0,
    electrical: 'Quad-core 64-bit ARM Cortex-A53 @ 1.0 GHz, 512 MB RAM, 2.4 GHz Wi-Fi + BLE 4.2',
    connector: 'Micro-USB power + OTG; 40-pin unpopulated GPIO',
    notes: ['Ultra-compact Linux SBC for lightweight stationary desk agents and mobile robots.'],
    data: { clockMHz: 1000, vIn: 5.0, currentNomA: 0.18, currentMaxA: 1.2 },
  },
  'ESP32-DEV': {
    id: 'ESP32-DEV', kind: 'controller', name: 'ESP32-WROOM-32 DevKit V1',
    size: [51.5, 28.3, 12.0], massG: 10.5,
    electrical: 'Xtensa dual-core 32-bit LX6 @ 240 MHz, 520 KB SRAM, 4 MB Flash, Wi-Fi 802.11 b/g/n + BLE 4.2',
    connector: 'Micro-USB / Type-C; 2x15-pin 2.54 mm pitch headers',
    notes: ['Ubiquitous maker microcontroller for DIY robotics and IoT desk companions.'],
    data: { clockMHz: 240, vIn: 5.0, currentNomA: 0.08, currentMaxA: 0.5 },
  },
  'XIAO-ESP32-C3': {
    id: 'XIAO-ESP32-C3', kind: 'controller', name: 'Seeed Studio XIAO ESP32-C3',
    size: [21.0, 17.5, 4.0], massG: 2.4,
    electrical: 'RISC-V 32-bit @ 160 MHz, 400 KB SRAM, 4 MB Flash, 2.4 GHz Wi-Fi + BLE 5.0, onboard LiPo charger',
    connector: 'Type-C USB; 2x7-pin 2.54 mm headers; battery solder pads on bottom',
    notes: ['Thumb-sized core for wearable robots, mini desk companions, and compact smart stands.'],
    data: { clockMHz: 160, vIn: 5.0, currentNomA: 0.04, currentMaxA: 0.3 },
  },
  'XIAO-ESP32-S3': {
    id: 'XIAO-ESP32-S3', kind: 'controller', name: 'Seeed Studio XIAO ESP32-S3 (Sense)',
    size: [21.0, 17.5, 4.5], massG: 2.6,
    electrical: 'Xtensa dual-core LX7 @ 240 MHz, 8 MB PSRAM, 8 MB Flash, Wi-Fi + BLE, optional camera & microphone',
    connector: 'Type-C USB; 2x7-pin 2.54 mm headers',
    notes: ['High-speed mini AI controller for tiny voice agents and facial expression trackers.'],
    data: { clockMHz: 240, vIn: 5.0, currentNomA: 0.05, currentMaxA: 0.4 },
  },
  'ZHAOZHI-AI-CORE': {
    id: 'ZHAOZHI-AI-CORE', kind: 'controller', name: 'XiaoZhi / ZhaoZhi AI Voice Agent Core (ESP32-S3)',
    size: [38.0, 38.0, 8.5], massG: 14.0,
    electrical: 'ESP32-S3 dual-core 240 MHz with 16 MB Flash, 8 MB PSRAM, integrated I2S DAC amp, dual MEMS mic array, Wi-Fi/BLE',
    connector: 'Type-C USB power/serial, 4-pin speaker JST-ZH, round/rectangular SPI LCD header',
    notes: ['Specialized hardware core for interactive AI desk assistants, voice chat companions, and desktop robots.'],
    data: { clockMHz: 240, vIn: 5.0, currentNomA: 0.12, currentMaxA: 0.8 },
  },
  'JETSON-ORIN-NANO': {
    id: 'JETSON-ORIN-NANO', kind: 'controller', name: 'NVIDIA Jetson Orin Nano Developer Kit',
    size: [100.0, 79.0, 29.0], massG: 145.0,
    electrical: '6-core Arm Cortex-A78AE, 1024-core Ampere GPU with 32 Tensor Cores (40 TOPS AI), 8 GB 128-bit LPDDR5',
    connector: 'DC barrel 9V-20V, DisplayPort, 4x USB 3.2 Gen2, Gigabit LAN, 40-pin GPIO header',
    notes: ['Edge AI powerhouse for advanced computer vision, autonomous navigation, and LLM edge inference.'],
    data: { clockMHz: 1500, vIn: 12.0, currentNomA: 0.8, currentMaxA: 2.5 },
  },
  'ARDUINO-UNO': {
    id: 'ARDUINO-UNO', kind: 'controller', name: 'Arduino Uno R3 / R4 (Minima / WiFi)',
    size: [68.6, 53.4, 15.0], massG: 25.0,
    electrical: 'ATmega328P @16 MHz (R3) or Renesas RA4M1 32-bit Cortex-M4 @48 MHz (R4), 14 digital I/O, 6 PWM, 6 analog inputs',
    connector: 'USB-B / Type-C (5V), DC barrel jack (7-12V in), female 2.54mm header strips',
    notes: ['The iconic gold-standard educational and maker prototyping board worldwide.'],
    data: { clockMHz: 48, vIn: 5.0, currentNomA: 0.05, currentMaxA: 0.5 },
  },
  'RPI-PICO-W': {
    id: 'RPI-PICO-W', kind: 'controller', name: 'Raspberry Pi Pico W / Pico 2',
    size: [51.0, 21.0, 4.0], massG: 4.0,
    electrical: 'Dual-core ARM Cortex-M0+ (RP2040) / Cortex-M33 (RP2350) @133-150 MHz, 264KB SRAM, 2MB Flash, Infineon CYW43439 2.4GHz Wi-Fi + BLE 5.2',
    connector: 'Micro-USB / Type-C, 40 castellated edge holes (pitch 2.54mm), 3-pin SWD debug header',
    notes: ['Ultra-affordable low-power microcontroller board with dual cores and programmable I/O (PIO).'],
    data: { clockMHz: 133, vIn: 5.0, currentNomA: 0.03, currentMaxA: 0.3 },
  },
  'ESP32-S3-DEVKIT': {
    id: 'ESP32-S3-DEVKIT', kind: 'controller', name: 'ESP32-S3 DevKitC-1 (N8R8 / N16R8)',
    size: [68.0, 28.5, 11.5], massG: 12.0,
    electrical: 'Xtensa 32-bit LX7 dual-core @240 MHz with vector instructions for AI acceleration, 512KB SRAM, 8MB PSRAM, 16MB Flash, Wi-Fi + BLE 5.0',
    connector: 'Dual USB Type-C (USB-to-UART + native USB OTG), dual 22-pin 2.54mm headers',
    notes: ['High-performance AI IoT core capable of real-time tinyML, wake word detection, and voice processing.'],
    data: { clockMHz: 240, vIn: 5.0, currentNomA: 0.09, currentMaxA: 0.5 },
  },
  'MICROBIT-V2': {
    id: 'MICROBIT-V2', kind: 'controller', name: 'BBC micro:bit v2 Robotics Board',
    size: [51.6, 42.0, 11.7], massG: 8.0,
    electrical: 'Nordic nRF52833 64 MHz Cortex-M4F, 128KB RAM, 512KB Flash, 2.4 GHz radio, onboard speaker, MEMS microphone, touch sensor logo, 5x5 red LED display',
    connector: 'Edge connector (5 ring pads + 20 edge pins), micro-USB, JST-PH 2-pin battery connector',
    notes: ['Classroom-favorite programmable board equipped with built-in sensors, LEDs, and microphone.'],
    data: { clockMHz: 64, vIn: 3.3, currentNomA: 0.04, currentMaxA: 0.3 },
  },

  // ---------------------------------------------------------------- Popular Actuators & Motors
  'SG90-SERVO': {
    id: 'SG90-SERVO', kind: 'servo', name: 'TowerPro SG90 9g Micro Servo (GS90)',
    size: [22.2, 11.8, 31.0], massG: 9.0,
    electrical: '4.8-6.0 V DC. Pulse 500-2400 µs (180°), PWM 50 Hz, stall 650 mA @ 5V',
    mechanical: '1.8 kgf·cm @ 4.8V, 0.10 s/60°. Ear span 32.5 mm, pitch 27.8 mm, Ø4.8 mm 21T spline',
    notes: ['The most popular 9g micro servo in maker robotics; drop-in compatible with standard pan-tilt mounts.'],
    data: { vMin: 4.8, vMax: 6.0, torqueNm: 1.8 * 0.0980665, speedDegS: 600, stallA: 0.65, idleA: 0.01, rangeDeg: 180 },
  },
  'MG90S-SERVO': {
    id: 'MG90S-SERVO', kind: 'servo', name: 'TowerPro MG90S Metal-Gear Micro Servo',
    size: [22.8, 12.2, 28.5], massG: 13.4,
    electrical: '4.8-6.6 V DC. PWM 50 Hz, stall 850 mA @ 6V',
    mechanical: '2.2 kgf·cm @ 6V, 0.10 s/60°. Metal gear train, dual ball bearings, 21T spline',
    notes: ['Metal-gear upgrade for high-stress joints: desk robotic arms, pan-tilt bases, and heavy loads.'],
    data: { vMin: 4.8, vMax: 6.6, torqueNm: 2.2 * 0.0980665, speedDegS: 600, stallA: 0.85, idleA: 0.02, rangeDeg: 180 },
  },
  'N20-MOTOR': {
    id: 'N20-MOTOR', kind: 'motor', name: 'GA12-N20 Micro Metal Gear Motor',
    size: [24.0, 12.0, 10.0], massG: 9.5,
    electrical: '3.0-6.0 V DC, nominal 80 mA, stall 0.6 A @ 6V',
    mechanical: '150 RPM @ 6V, 1.2 kgf·cm. Ø3.0 mm D-shaft (flat 2.5 mm, length 10 mm)',
    notes: ['Compact all-metal geared micro DC motor for miniature rovers, sliders, and wheeled desk bots.',
      'Needs an H-bridge (DRV8833 / TB6612FNG): a PCA9685 or GPIO pin can\'t power it. On a voice robot the bridge inputs take servo board channels; from a 2S pack the firmware caps the PWM to ~6 V. Sold in many gear ratios (15-1000 RPM).'],
    data: { vMin: 3.0, vMax: 6.0, torqueNm: 1.2 * 0.0980665, rpm: 150, stallA: 0.6, nominalA: 0.08, shaftD: 3.0, shaftFlat: 2.5 },
  },
  'TT-MOTOR': {
    id: 'TT-MOTOR', kind: 'motor', name: 'TT DC Gearbox Motor (Yellow Dual-Shaft 1:48)',
    size: [70.0, 22.0, 18.0], massG: 28.0,
    electrical: '3.0-6.0 V DC, nominal 150 mA, stall 1.0 A @ 6V',
    mechanical: '200 RPM @ 6V, 0.8 kgf·cm, 1:48 reduction ratio. Dual slotted output shafts (Ø5.4 mm with dual flats 3.6 mm)',
    notes: ['The world standard high-torque low-cost drive motor for maker rovers, 2WD/4WD chassis, and smart cars.'],
    data: { vMin: 3.0, vMax: 6.0, torqueNm: 0.8 * 0.0980665, rpm: 200, stallA: 1.0, nominalA: 0.15, shaftD: 5.4, shaftFlat: 3.6 },
  },

  // ---------------------------------------------------------------- Audio & Voice Components
  'ZHAOZHI-SPEAKER-MOD': {
    id: 'ZHAOZHI-SPEAKER-MOD', kind: 'speaker', name: 'XiaoZhi / ZhaoZhi AI Sound Chamber & Speaker',
    size: [36.0, 36.0, 14.0], massG: 16.0,
    electrical: 'MAX98357A I2S Class D 3.2W Amp + 8Ω 2W cavity speaker, INMP441 MEMS microphone',
    connector: 'JST-PH 2.0 4-pin header (LRC, BCLK, DIN, GND, 5V)',
    notes: ['Acoustic resonance chamber engineered for rich voice response in AI desktop stands.'],
    data: { powerW: 2.0, impedanceOhm: 8, vIn: 5.0, maxmA: 500 },
  },
  'SPK-8OHM-2W': {
    id: 'SPK-8OHM-2W', kind: 'speaker', name: 'Cavity Mini Speaker 8Ω 2W (High-Fidelity Voice)',
    size: [31.0, 20.0, 8.5], massG: 8.5,
    electrical: '8 Ohm impedance, rated 2 Watt (peak 3W), resonant freq 850 Hz, SPL 88 dB',
    connector: '2-wire JST-1.25 connector or solder pads',
    notes: ['Enclosed cavity speaker producing clear natural human voice dialogue.'],
    data: { powerW: 2.0, impedanceOhm: 8, vIn: 5.0, maxmA: 400 },
  },
  'SPK-MICRO-1W': {
    id: 'SPK-MICRO-1W', kind: 'speaker', name: 'Micro Speaker Chamber 8Ω 1W',
    size: [20.0, 14.0, 4.5], massG: 3.2,
    electrical: '8 Ohm, rated 1 Watt, compact sound chamber',
    connector: '2-pin micro connector',
    notes: ['Ultra-slim profile speaker for compact desk mascots and small smart assistants.'],
    data: { powerW: 1.0, impedanceOhm: 8, vIn: 5.0, maxmA: 200 },
  },

  // ---------------------------------------------------------------- Batteries & Power
  'BAT-18650-1S': {
    id: 'BAT-18650-1S', kind: 'battery', name: 'Single 18650 Li-ion 3.7V 2600mAh Cell',
    size: [18.5, 67.0, 18.5], massG: 48.0,
    electrical: '3.7V nominal (4.2V charge), 2600 mAh, integrated PCM overcharge/overdischarge protection',
    connector: 'XH2.54 2-pin lead or spring terminal clips',
    notes: ['Standard rechargeable power source for stationary desk agents and USB-rechargeable devices.'],
    data: { voltage: 3.7, capacitymAh: 2600, cellD: 18.5 },
  },
  'BAT-18650-2S': {
    id: 'BAT-18650-2S', kind: 'battery', name: '2S 18650 7.4V 2600mAh Li-ion Battery Pack',
    size: [37.0, 67.0, 18.5], massG: 96.0,
    electrical: '7.4V nominal (8.4V max), 2600 mAh, 2S BMS protection board with balance circuit',
    connector: 'XH2.54 2-pin male (red +7.4V, black GND)',
    notes: ['High-capacity 2S battery pack delivering sustained current for multi-servo robots and Raspberry Pi.'],
    data: { voltage: 7.4, capacitymAh: 2600, cellD: 18.5 },
  },
  'BAT-1S2P-14500': {
    id: 'BAT-1S2P-14500', kind: 'battery', name: '3.7 V 1600 mAh 1S2P 14500 Li-ion Pack',
    size: [28.4, 51.2, 16.3], massG: 44, massEstimated: true,
    electrical: 'Two 14500 cells in parallel with a protection board (3.0-4.2 V); charged by the PicoClaw board',
    mechanical: 'Same envelope as B-PC003: fits every twin-cell battery bay',
    connector: 'JST-PH 2.0 2-pin',
    notes: ['1S pack for the LicheeRV Claw kit in robot bodies built around the twin-cell CyberBrick bay.'],
    data: { voltage: 3.7, capacitymAh: 1600, cellD: 14.2 },
  },
  'BAT-LIPO-1S-1000': {
    id: 'BAT-LIPO-1S-1000', kind: 'battery', name: '3.7V 1000mAh LiPo Pouch Cell (Compact)',
    size: [34.0, 50.0, 6.2], massG: 20.0,
    electrical: '3.7V nominal, 1000 mAh, lightweight lithium-polymer pouch cell with protection circuit',
    connector: 'JST-PH 2.0 2-pin',
    notes: ['Flat form factor ideal for shallow desk bases, Seeed XIAO stands, and slimline enclosures.'],
    data: { voltage: 3.7, capacitymAh: 1000 },
  },

  // ---------------------------------------------------------------- Expansion Shields
  'SHIELD-RPI-ROBOT': {
    id: 'SHIELD-RPI-ROBOT', kind: 'shield', name: 'Raspberry Pi Robotics HAT (4-ch DC + 8-ch Servo)',
    size: [65.0, 56.0, 12.0], massG: 24.0,
    electrical: 'PCA9685 PWM controller + TB6612FNG dual H-bridge, I2C interface, 6-12V external power in',
    connector: '40-pin female Raspberry Pi header, 8x 3-pin servo headers, 4x motor screw terminals',
    notes: ['Standard robotics expansion HAT for Raspberry Pi 4B / 5 / Zero.'],
    data: { vinMin: 6.0, vinMax: 12.0, servoPorts: 8, motorPorts: 4, servo5vBudgetA: 4.0 },
  },
  'SHIELD-ESP32-SERVO': {
    id: 'SHIELD-ESP32-SERVO', kind: 'shield', name: 'ESP32 / Arduino 16-Channel Servo Shield (PCA9685)',
    size: [54.0, 54.0, 11.0], massG: 18.0,
    electrical: '16-channel 12-bit PWM I2C servo driver with reverse polarity protection',
    connector: '16x 3-pin standard servo headers (GND, V+, Signal), 2-pin screw terminal for servo power',
    notes: ['Allows driving up to 16 servos from a single I2C bus on any microcontroller.'],
    data: { vinMin: 5.0, vinMax: 6.0, servoPorts: 16, motorPorts: 0, servo5vBudgetA: 5.0 },
  },
  'SHIELD-ARDUINO-MOTOR': {
    id: 'SHIELD-ARDUINO-MOTOR', kind: 'shield', name: 'Arduino Motor Shield (L298P / TB6612 Dual H-Bridge)',
    size: [68.6, 53.4, 18.0], massG: 32.0,
    electrical: 'Dual full H-bridge motor driver, drives 2-4 DC motors or 2 stepper motors, up to 2A per channel, external 5-12V power terminal',
    connector: 'Arduino stackable pin headers, 4x motor screw terminals, 2-pin external power terminal',
    notes: ['Standard plug-and-play motor driver shield for Arduino Uno wheeled rovers and robot arms.'],
    data: { vinMin: 6.0, vinMax: 12.0, servoPorts: 2, motorPorts: 4, servo5vBudgetA: 2.0 },
  },
  'SHIELD-PICO-ROBOT': {
    id: 'SHIELD-PICO-ROBOT', kind: 'shield', name: 'Raspberry Pi Pico Robotics Board (8-ch Servo + 4-ch DC)',
    size: [65.0, 56.0, 12.0], massG: 22.0,
    electrical: 'Dual H-bridge DC motor driver + 8x servo PWM outputs, on/off power switch, terminal block power input (3-11V)',
    connector: 'Female header socket for Raspberry Pi Pico, 8x 3-pin servo headers, 4x motor screw terminals',
    notes: ['Compact all-in-one robotics carrier board for Raspberry Pi Pico and Pico W.'],
    data: { vinMin: 4.5, vinMax: 11.0, servoPorts: 8, motorPorts: 4, servo5vBudgetA: 3.5 },
  },

  // ---------------------------------------------------------------- Popular Sensors, Displays & Cameras
  'HC-SR04': {
    id: 'HC-SR04', kind: 'sensor', name: 'HC-SR04 Ultrasonic Distance Sensor',
    size: [45.0, 20.0, 15.0], massG: 8.5,
    electrical: '5.0 V DC, working current 15 mA, ranging distance 2 cm to 400 cm, 15° measuring angle, 40 kHz ultrasonic burst',
    connector: '4-pin 2.54 mm header (VCC, Trig, Echo, GND)',
    notes: ['The universal robotics obstacle avoidance and distance detection sensor.'],
    data: { vMin: 4.5, vMax: 5.5, currentNomA: 0.015, minRangeMm: 20, maxRangeMm: 4000 },
  },
  'OLED-SSD1306': {
    id: 'OLED-SSD1306', kind: 'display', name: 'SSD1306 0.96" I2C Monochrome OLED Display (128×64)',
    size: [27.0, 27.0, 4.0], massG: 4.2,
    electrical: '3.3V-5.0V DC, 128x64 pixels, high-contrast self-illuminating OLED, I2C address 0x3C/0x3D',
    connector: '4-pin 2.54 mm header (GND, VCC, SCL, SDA)',
    notes: ['Classic mini graphic screen for animated robot faces, system status, battery meters, and telemetry.'],
    data: { vMin: 3.3, vMax: 5.0, currentNomA: 0.02, resX: 128, resY: 64 },
  },
  'MPU-6050': {
    id: 'MPU-6050', kind: 'sensor', name: 'MPU-6050 6-DoF Accelerometer & Gyroscope IMU',
    size: [20.5, 15.6, 3.0], massG: 2.1,
    electrical: '3.0-5.0 V DC (onboard LDO), 3-axis gyro ±250/500/1000/2000 °/s, 3-axis accelerometer ±2/4/8/16g, Digital Motion Processor (DMP), I2C',
    connector: '8-pin 2.54 mm pitch header (VCC, GND, SCL, SDA, XDA, XCL, AD0, INT)',
    notes: ['Essential attitude sensor for self-balancing robots, humanoid stabilization, quadrupeds, and gesture detection.'],
    data: { vMin: 3.0, vMax: 5.0, currentNomA: 0.004, dof: 6 },
  },
  'RPI-CAMERA-V2': {
    id: 'RPI-CAMERA-V2', kind: 'camera', name: 'Raspberry Pi Camera Module V2 (8MP IMX219)',
    size: [25.0, 24.0, 9.0], massG: 3.0,
    electrical: 'Sony IMX219 8-megapixel sensor, 1080p30 / 720p60 video, MIPI CSI-2 2-lane bus',
    connector: '15-pin 1.0 mm pitch FFC flexible flat ribbon cable',
    notes: ['Standard visual camera for OpenCV AI vision, AprilTag tracking, face following, and ROS 2 camera nodes.'],
    data: { vMin: 3.3, vMax: 3.3, megapixels: 8, fps: 30 },
  },
  'VL53L0X-TOF': {
    id: 'VL53L0X-TOF', kind: 'sensor', name: 'VL53L0X Time-of-Flight (ToF) Laser Ranging Sensor',
    size: [25.0, 13.0, 3.0], massG: 1.8,
    electrical: '2.6-5.0 V DC, 940 nm VCSEL infrared laser emitter + SPAD receiver array, ranging up to 2.0 m with millimeter precision, I2C interface',
    connector: '6-pin 2.54 mm header (VIN, GND, SCL, SDA, XSHUT, GPIO1)',
    notes: ['Precise laser distance sensor immune to surface color and reflectance; superior to IR triangulation.'],
    data: { vMin: 2.6, vMax: 5.0, currentNomA: 0.01, minRangeMm: 10, maxRangeMm: 2000 },
  },

  // ---------------------------------------------------------------- Reference Hardware & Magnets
  'MAG-N52-10X2': {
    id: 'MAG-N52-10X2', kind: 'hardware', name: 'Neodymium N52 Disc Magnet (Ø10 × 2 mm)',
    size: [10.0, 10.0, 2.0], massG: 1.2,
    electrical: 'Passive permanent magnet (N52 grade, nickel-plated, ~1.8 kg pull force)',
    connector: 'Flush press-fit pocket with CA glue retention',
    notes: ['Standard disc magnet for magnetic phone stands, quick-release tool heads, and accessory docking.'],
    data: { diameter: 10.0, thickness: 2.0, pullKg: 1.8 },
  },
  'MAG-MAGSAFE-RING': {
    id: 'MAG-MAGSAFE-RING', kind: 'hardware', name: 'MagSafe Compatible Magnetic Ring Array',
    size: [54.0, 54.0, 1.5], massG: 6.5,
    electrical: 'Circular array of 38 N52 permanent magnets oriented in MagSafe polarity pattern',
    connector: 'Recessed alignment channel on backplate',
    notes: ['Enables direct magnetic latching for iPhone / MagSafe cases and accessories.'],
    data: { od: 54.0, id: 46.0, thickness: 1.5, pullKg: 4.5 },
  },
  'MAG-N52-4X2': {
    id: 'MAG-N52-4X2', kind: 'hardware', name: 'Neodymium N52 Disc Magnet (Ø4 × 2 mm)',
    size: [4.0, 4.0, 2.0], massG: 0.19,
    electrical: 'Passive permanent magnet (N52 grade, nickel-plated)',
    connector: 'Ø4.2 x 2.2 mm pocket, CA glue (guide s.4)',
    notes: ['Source: guide s.4 magnet row (Ø4.0 x 2.0 -> Ø4.2 x 2.2 pocket). Mass from NdFeB density 7.5 g/cm³.'],
    data: { diameter: 4.0, thickness: 2.0 },
  },

  // ---------------------------------------------------------------- Bearings (guide s.4 press-fit row)
  'BRG-683ZZ': {
    id: 'BRG-683ZZ', kind: 'hardware', name: '683ZZ Miniature Ball Bearing (3 x 7 x 3 mm)',
    size: [7.0, 7.0, 3.0], massG: 0.5, massEstimated: true,
    electrical: 'Passive, shielded deep-groove ball bearing',
    connector: 'Press-fit housing bore Ø7.05 (guide s.4: Hole = Pin + 0.05)',
    notes: ['Source: guide s.4 press-fit row (688/683ZZ). Dimensions per ISO 683 series.'],
    data: { bore: 3.0, od: 7.0, width: 3.0 },
  },
  'BRG-688ZZ': {
    id: 'BRG-688ZZ', kind: 'hardware', name: '688ZZ Miniature Ball Bearing (8 x 16 x 5 mm)',
    size: [16.0, 16.0, 5.0], massG: 4.0, massEstimated: true,
    electrical: 'Passive, shielded deep-groove ball bearing',
    connector: 'Press-fit housing bore Ø16.05 (guide s.4: Hole = Pin + 0.05)',
    notes: ['Source: guide s.4 press-fit row (688/683ZZ). Dimensions per ISO 688 series.'],
    data: { bore: 8.0, od: 16.0, width: 5.0 },
  },

  // ---------------------------------------------------------------- From CyberBuild_Architecture_and_Features s.4.3
  'B-BA001': {
    id: 'B-BA001', kind: 'battery', name: '3.7 V 500 mAh LiPo Battery',
    size: [30.0, 35.0, 5.5], massG: 10, massEstimated: true,
    electrical: '1S 3.7 V nominal (4.2 V full), 500 mAh, integrated over-charge / over-discharge protection',
    connector: 'JST-PH 2.0 2-pin (assumed)',
    notes: [
      'Source: CyberBuild architecture doc s.4.3 directory table. Size (503035-class pouch) and connector are estimates.',
      '1S cannot feed the B-XA004 6-9 V input directly: needs a boost converter, or use it in XIAO-class 3.7 V builds.',
    ],
    data: { voltage: 3.7, capacitymAh: 500 },
  },
  'B-XL001': {
    id: 'B-XL001', kind: 'led', name: 'WS2812B Addressable RGB LED',
    size: [5.0, 5.0, 1.6], massG: 0.1, massEstimated: true,
    electrical: 'WS2812B 5050, 24-bit RGB, single-wire (NeoPixel) data, 5 V, ~60 mA max',
    connector: 'Solder pads (DIN, 5V, GND, DOUT)',
    notes: ['Source: CyberBuild architecture doc s.4.3 directory table. Envelope is the bare 5050 package (datasheet); breakout boards vary.'],
    data: { pocket: 5.4, maxmA: 60 },
  },

  // ---------------------------------------------------------------- Sipeed LicheeRV Claw kit (LicheeRV Nano + PicoClaw board)
  // Sources: wiki.sipeed.com LicheeRV Nano intro + PicoClaw expansion board pages, github.com/sipeed/rvclaw config.py.
  'LICHEERV-NANO-W': {
    id: 'LICHEERV-NANO-W', kind: 'controller', name: 'Sipeed LicheeRV Nano W (SG2002, WiFi 6)',
    size: [22.86, 35.56, 5.0], massG: 5, massEstimated: true,
    electrical: 'SOPHGO SG2002: 1 GHz RISC-V C906 (or A53) + 700 MHz C906 + 8051, 1 TOPS INT8 NPU, 256 MB DDR3, TF-card boot, WiFi 6 + BLE 5.4 (W), onboard mic + <1 W speaker PA, Linux (Buildroot / Debian)',
    connector: 'USB-C OTG (power + RNDIS/NCM USB network), 2 x 14-pin 2.54 mm castellated edges on 20.32 mm row spacing, MIPI CSI 22-pin, MIPI DSI 31-pin',
    notes: [
      'Variants: B (basic), E (+100M Ethernet), W (+WiFi 6/BLE), WE (both). The Claw kit uses the W board.',
      'Runs Linux, not MicroPython: PICOCEO Builder generates a Python app package and installs it over the USB network (no in-browser flashing).',
      'Height (5 mm incl. TF slot) and mass are estimates.',
    ],
    data: { clockMHz: 1000, vIn: 5.0, currentNomA: 0.25, currentMaxA: 0.6, npuTops: 1, ramMB: 256 },
  },
  'PICOCLAW-BOARD': {
    id: 'PICOCLAW-BOARD', kind: 'shield', name: 'Sipeed PicoClaw expansion board (240x240 LCD, keys, built-in battery + speaker)',
    size: [30.5, 38.5, 15.0], massG: 22, massEstimated: true,
    electrical: '240x240 ST7789 SPI LCD (SPI1, 45 MHz; DC A28, RST A27, backlight A19), 2 keys (sysfs GPIO 504 / 509), 2 status LEDs (GPIO 495 / 498), built-in 1S LiPo with charging (max 3 W), built-in speaker',
    connector: 'Stacks on the LicheeRV Nano castellated edges; JST battery + speaker connectors; Nano USB-C exits the bottom edge',
    notes: [
      'One side key on each side edge (left and right); ON/OFF switch and LEDs on the bottom edge. Key height is estimated.',
      'The kit module carries its own 1S battery and speaker behind the boards (whole stack ≈ 16.4 mm deep, estimated): no separate battery or speaker is needed unless servos are added.',
      'Board outline (30.5 x 38.5 mm) and stack thickness are estimated from photos against the 22.86 x 35.56 mm Nano; Sipeed does not publish them. A 3D-printable case is in the Sipeed download share.',
      'No servo or motor outputs: add a PCA9685 servo board on I2C for moving designs.',
    ],
    data: { vinMin: 3.5, vinMax: 5.2, servoPorts: 0, motorPorts: 0, servo5vBudgetA: 0, lcdW: 240, lcdH: 240, chargeW: 3 },
  },
  'PCA9685-SERVO-16': {
    id: 'PCA9685-SERVO-16', kind: 'shield', name: 'PCA9685 16-channel I2C servo driver board',
    size: [62.5, 25.4, 11.0], massG: 6,
    electrical: 'NXP PCA9685 12-bit PWM at 50 Hz over I2C (0x40), 3.3-5 V logic, separate V+ servo supply terminal (≤ 6 V)',
    connector: '16 x 3-pin servo headers (PWM, V+, GND), 6-pin I2C header (GND, OE, SCL, SDA, VCC, V+), 2-pin V+ screw terminal',
    notes: [
      'Adafruit-style 62.5 x 25.4 mm board, 4 x M2.5 holes. Used as the servo add-on for the LicheeRV Claw kit (I2C from the Nano header).',
      'Servo power must come from a 5 V supply that can deliver the stall current; the Claw battery boost is not specified for servos.',
    ],
    data: { vinMin: 4.8, vinMax: 6.0, servoPorts: 16, motorPorts: 0, servo5vBudgetA: 2.0 },
  },

  // ---------------------------------------------------------------- Voice-robot hardware (XiaoZhi / Raspberry Pi / Jetson)
  // Sources: vendor product pages and datasheets (NVIDIA B01 carrier, InvenSense INMP441, Seeed ReSpeaker, Maxim MAX98357A,
  // Waveshare / Adafruit LCD and servo boards, TowerPro / DSSERVO / Feetech servo sheets). `massEstimated` / the standard's
  // `source: 'estimated'` mark values not published by the vendor.
  'JETSON-NANO': {
    id: 'JETSON-NANO', kind: 'controller', name: 'NVIDIA Jetson Nano Developer Kit (B01, 4 GB)',
    size: [100.0, 80.0, 29.0], massG: 140, massEstimated: true,
    electrical: 'Quad-core Cortex-A57 @ 1.43 GHz, 128-core Maxwell GPU (472 GFLOPS), 4 GB LPDDR4; 5 V 4 A on the DC barrel (J48 jumper fitted) or 5 V 2 A on micro-USB; 10 W / 5 W power modes',
    connector: 'DC barrel 5.5 x 2.1 mm (5 V 4 A), micro-USB, 4x USB 3.0, HDMI + DP, Gigabit RJ45, 40-pin header (I2C bus 1 on pins 3/5, I2S on 12/35/38/40)',
    notes: [
      'Carrier 100 x 80 mm, 4x M2.5 holes on 86 x 58 mm; height 29 mm over the heatsink (NVIDIA B01 drawing).',
      'All high-current I/O (barrel, USB, HDMI, RJ45) is on one long edge: put that edge against a wall slot.',
    ],
    data: { clockMHz: 1430, vIn: 5.0, currentNomA: 1.5, currentMaxA: 4.0 },
  },
  'MIC-INMP441': {
    id: 'MIC-INMP441', kind: 'sensor', name: 'INMP441 I2S MEMS microphone breakout',
    size: [14.5, 14.5, 3.2], massG: 1.0, massEstimated: true,
    electrical: 'InvenSense INMP441 omnidirectional MEMS mic, 24-bit I2S out, SNR 61 dBA, -26 dBFS sensitivity, 1.8-3.3 V, 1.4 mA',
    connector: '6-pin 2.54 mm header (VDD, GND, L/R, WS, SCK, SD)',
    notes: ['Bottom-port mic: the sound hole goes through the PCB on the side opposite the chip. Round breakout outline (Ø14.5) is a typical clone value.'],
    data: { vMin: 1.8, vMax: 3.3, currentNomA: 0.0014, mics: 1, snrDb: 61 },
  },
  'RESPEAKER-2MIC-HAT': {
    id: 'RESPEAKER-2MIC-HAT', kind: 'shield', name: 'Seeed ReSpeaker 2-Mics Pi HAT (WM8960)',
    size: [65.0, 30.0, 10.0], massG: 10, massEstimated: true,
    electrical: 'WM8960 stereo codec on I2S + I2C (0x1a), 2 MEMS mics (one at each end), 1 W class-D speaker out, 3 APA102 RGB LEDs (SPI), user button on GPIO17',
    connector: '40-pin female Pi header, JST-PH 2.0 speaker out, 3.5 mm headphone jack, 2 Grove ports (I2C, GPIO12/13)',
    notes: ['pHAT outline 65 x 30 on the Pi 58 x 23 hole pattern. Mics face up (component side): open a sound port above each one.'],
    data: { vMin: 3.3, vMax: 5.0, currentNomA: 0.08, mics: 2, speakerW: 1, servoPorts: 0, servo5vBudgetA: 0 },
  },
  'USB-MIC-MINI': {
    id: 'USB-MIC-MINI', kind: 'sensor', name: 'Mini USB microphone dongle (plug-and-play UAC)',
    size: [22.0, 18.0, 7.0], massG: 3, massEstimated: true,
    electrical: 'USB Audio Class mic, 16-48 kHz, no driver needed on Linux (ALSA card), ~50 mA',
    connector: 'USB-A plug',
    notes: ['Plugs straight into a USB-A port of the Pi / Jetson; the plug end pokes out of the port window. Outline varies by vendor.'],
    data: { vMin: 5.0, vMax: 5.0, currentNomA: 0.05, mics: 1 },
  },
  'AMP-MAX98357A': {
    id: 'AMP-MAX98357A', kind: 'shield', name: 'MAX98357A I2S class-D amplifier breakout (3 W)',
    size: [17.8, 19.3, 6.0], massG: 2, massEstimated: true,
    electrical: 'Maxim MAX98357A I2S DAC + class-D amp: 3.2 W into 4 O at 5 V (1.8 W into 8 O), 2.5-5.5 V, filterless, gain set by the GAIN pin',
    connector: '7-pin 2.54 mm header (LRC, BCLK, DIN, GAIN, SD, GND, Vin), 2-pin 3.5 mm screw terminal for the speaker',
    notes: ['Adafruit 0.7" x 0.75" breakout outline; no mounting holes on most clones (glue or a push-fit pocket).'],
    data: { vMin: 2.5, vMax: 5.5, currentNomA: 0.02, currentMaxA: 0.65, powerW: 3.2, servoPorts: 0, servo5vBudgetA: 0 },
  },
  'LCD-GC9A01-128': {
    id: 'LCD-GC9A01-128', kind: 'display', name: '1.28" round IPS LCD 240x240 (GC9A01, SPI)',
    size: [40.4, 37.5, 5.0], massG: 6, massEstimated: true,
    electrical: 'GC9A01 driver, 240x240 RGB565, 4-wire SPI up to 80 MHz, 3.3 V logic, backlight ~20 mA',
    connector: '8-pin 2.54 mm header (VCC, GND, DIN, CLK, CS, DC, RST, BL)',
    notes: ['Round active area Ø32.4 centred on the module (Waveshare 1.28" outline 40.4 x 37.5). Frame it with a round window.'],
    data: { vMin: 3.3, vMax: 5.0, currentNomA: 0.03, resX: 240, resY: 240, activeD: 32.4, round: 1 },
  },
  'LCD-ST7789-169': {
    id: 'LCD-ST7789-169', kind: 'display', name: '1.69" IPS LCD 240x280 (ST7789V2, SPI)',
    size: [31.0, 41.0, 4.5], massG: 6, massEstimated: true,
    electrical: 'ST7789V2 driver, 240x280 RGB565 with rounded corners, 4-wire SPI, 3.3 V logic, backlight ~25 mA',
    connector: '8-pin 2.54 mm header or GH1.25 cable (VCC, GND, DIN, CLK, CS, DC, RST, BL)',
    notes: ['Active area 27.97 x 32.63 (portrait, long side along Y). Module outline is an estimate from the Waveshare drawing.'],
    data: { vMin: 3.3, vMax: 5.0, currentNomA: 0.035, resX: 240, resY: 280, activeW: 27.97, activeH: 32.63 },
  },
  'LCD-ST7789-20': {
    id: 'LCD-ST7789-20', kind: 'display', name: '2.0" IPS LCD 240x320 (ST7789V, SPI)',
    size: [34.5, 51.0, 4.8], massG: 9, massEstimated: true,
    electrical: 'ST7789V driver, 240x320 RGB565, 4-wire SPI, 3.3 V logic, backlight ~40 mA',
    connector: '8-pin 2.54 mm header or GH1.25 cable (VCC, GND, DIN, CLK, CS, DC, RST, BL)',
    notes: ['Active area 30.6 x 40.8 (portrait). Module outline (34.5 x 51) is an estimate: Waveshare / generic boards differ by ±2 mm.'],
    data: { vMin: 3.3, vMax: 5.0, currentNomA: 0.05, resX: 240, resY: 320, activeW: 30.6, activeH: 40.8 },
  },
  'MG996R-SERVO': {
    id: 'MG996R-SERVO', kind: 'servo', name: 'TowerPro MG996R metal-gear standard servo',
    size: [40.7, 19.7, 42.9], massG: 55,
    electrical: '4.8-7.2 V DC, PWM 50 Hz 500-2500 µs, stall 2.5 A @ 6 V, idle 10 mA',
    mechanical: '9.4 kgf·cm @ 4.8 V, 11 kgf·cm @ 6 V, 0.17 s/60° @ 4.8 V. Ear span 54.5, ear holes 49.5 x 10 (4x M4), 25T spline',
    notes: ['Standard-size servo: needs its own housing (PICOCEO composer housings are micro-class); the 5 V rail must supply 2.5 A per stalled servo.'],
    data: { vMin: 4.8, vMax: 7.2, torqueNm: 11 * 0.0980665, speedDegS: 350, stallA: 2.5, idleA: 0.01, rangeDeg: 180 },
  },
  'DS3218-SERVO': {
    id: 'DS3218-SERVO', kind: 'servo', name: 'DSSERVO DS3218 20 kg digital servo',
    size: [40.0, 20.0, 40.5], massG: 60,
    electrical: '4.8-6.8 V DC, PWM 50-330 Hz 500-2500 µs, stall ~2.6 A @ 6.8 V',
    mechanical: '18 kgf·cm @ 5 V, 21.5 kgf·cm @ 6.8 V, 0.16 s/60° @ 5 V. Standard ear pattern 49.5 x 10, 25T spline',
    notes: ['Standard-size servo; stall current is a typical value (vendor gives none).'],
    data: { vMin: 4.8, vMax: 6.8, torqueNm: 20 * 0.0980665, speedDegS: 375, stallA: 2.6, idleA: 0.01, rangeDeg: 270 },
  },
  'SG92R-SERVO': {
    id: 'SG92R-SERVO', kind: 'servo', name: 'TowerPro SG92R carbon-gear micro servo',
    size: [23.0, 12.5, 29.0], massG: 9,
    electrical: '4.8-6.0 V DC, PWM 50 Hz 500-2400 µs, stall ~0.75 A @ 5 V',
    mechanical: '2.5 kgf·cm @ 4.8 V, 0.10 s/60°. Same 9 g footprint as SG90 (ear pitch 27.8), 21T spline',
    data: { vMin: 4.8, vMax: 6.0, torqueNm: 2.5 * 0.0980665, speedDegS: 600, stallA: 0.75, idleA: 0.01, rangeDeg: 180 },
  },
  'FS90R-SERVO': {
    id: 'FS90R-SERVO', kind: 'cservo', name: 'FeeTech FS90R continuous-rotation micro servo',
    size: [23.2, 12.5, 22.0], massG: 9,
    electrical: '4.8-6.0 V DC, PWM 50 Hz (1500 µs stop, 700-2300 µs full speed), stall ~0.8 A',
    mechanical: '110 RPM @ 4.8 V, 130 RPM @ 6 V, 1.3-1.5 kgf·cm. 9 g footprint, 21T spline',
    notes: ['Trim the stop point with the potentiometer on the case end.'],
    data: { vMin: 4.8, vMax: 6.0, torqueNm: 1.5 * 0.0980665, rpm: 130, stallA: 0.8, idleA: 0.01 },
  },
  // H-bridges for DC gear motors (N20-MOTOR) on robots with a servo board: the PCA9685 only gives a ~25 mA logic
  // signal, so its channels drive the bridge inputs (2 per motor on the DRV8833, 3 on the TB6612), as on the
  // Adafruit / Waveshare motor HATs.
  'DRV8833-DRIVER': {
    id: 'DRV8833-DRIVER', kind: 'shield', name: 'DRV8833 dual H-bridge motor driver module',
    size: [18.5, 16.0, 4.0], massG: 2, massEstimated: true,
    electrical: 'TI DRV8833: 2 DC motors, 2.7-10.8 V motor supply, 1.2 A continuous / 2 A peak per bridge, logic inputs 1.8-7 V (3.3 V PCA9685 / GPIO fine), built-in thermal / over-current shutdown',
    connector: '2.54 mm pins: IN1-IN4 (2 per motor: PWM one, low the other), OUT1-OUT4, VM, GND, EEP / nSLEEP (pulled up on most modules)',
    notes: ['Two PCA9685 channels per motor drive IN1 / IN2 directly; no extra I2C chip. Four N20s: wire each side\'s pair in parallel on one bridge.'],
    data: { vinMin: 2.7, vinMax: 10.8, motorPorts: 2, servoPorts: 0, servo5vBudgetA: 0, contA: 1.2, peakA: 2.0, channelsPerMotor: 2 },
  },
  'TB6612-DRIVER': {
    id: 'TB6612-DRIVER', kind: 'shield', name: 'TB6612FNG dual motor driver module',
    size: [20.3, 20.3, 4.0], massG: 2, massEstimated: true,
    electrical: 'Toshiba TB6612FNG: 2 DC motors, 4.5-13.5 V motor supply, 1.2 A continuous / 3.2 A peak per bridge, 2.7-5.5 V logic',
    connector: '2.54 mm pins: PWMA, AIN1, AIN2, PWMB, BIN1, BIN2, STBY (tie to VCC), VM, VCC, GND, A01/A02/B01/B02',
    notes: ['Three PCA9685 channels per motor (PWM + two direction pins), as on the Adafruit / Waveshare motor HATs. Below 4.5 V (a 1S pack) use the DRV8833.'],
    data: { vinMin: 4.5, vinMax: 13.5, motorPorts: 2, servoPorts: 0, servo5vBudgetA: 0, contA: 1.2, peakA: 3.2, channelsPerMotor: 3 },
  },
  'ST3215-SERVO': {
    id: 'ST3215-SERVO', kind: 'servo', name: 'Feetech ST3215 serial bus servo (19.5 kg, magnetic encoder)',
    size: [45.2, 24.7, 35.0], massG: 55,
    electrical: '6-12.6 V (12 V nominal), half-duplex TTL serial bus 1 Mbps, 12-bit magnetic encoder (360°), stall 2.7 A @ 12 V',
    mechanical: '19.5 kgf·cm @ 7.4 V (30 kgf·cm @ 12 V), 0.222 s/60°. Dual-shaft metal case, M2 / M3 mounting holes',
    notes: ['Bus servo: daisy-chained on one 3-pin bus from a BUS-SERVO-ADAPTER, not PWM. Needs its own 7.4-12 V supply.'],
    data: { vMin: 6.0, vMax: 12.6, torqueNm: 19.5 * 0.0980665, speedDegS: 270, stallA: 2.7, idleA: 0.15, rangeDeg: 360, bus: 1 },
  },
  'WAVESHARE-SERVO-HAT': {
    id: 'WAVESHARE-SERVO-HAT', kind: 'shield', name: 'Waveshare Servo Driver HAT (PCA9685, 16-ch)',
    size: [65.0, 56.5, 15.0], massG: 25, massEstimated: true,
    electrical: 'PCA9685 12-bit PWM over I2C (0x40, bus 1), onboard 5 V regulator for the servos (3 A) from a 6-12 V terminal, which also powers the Pi',
    connector: '40-pin Pi header, 16x 3-pin servo headers, 2-pin VIN screw terminal',
    notes: ['Full HAT on the 58 x 49 hole pattern. Regulator current is the vendor figure; it can back-power the Pi 4 but not a Pi 5 under load.'],
    data: { vinMin: 6.0, vinMax: 12.0, servoPorts: 16, motorPorts: 0, servo5vBudgetA: 3.0 },
  },
  'ADAFRUIT-SERVO-BONNET': {
    id: 'ADAFRUIT-SERVO-BONNET', kind: 'shield', name: 'Adafruit 16-Channel PWM / Servo Bonnet (PCA9685)',
    size: [65.0, 30.5, 12.0], massG: 9,
    electrical: 'PCA9685 12-bit PWM over I2C (0x40), servo V+ from a 5 V 4 A barrel / terminal (not regulated), reverse-polarity protected',
    connector: '40-pin Pi header (bonnet), 16x 3-pin servo headers, DC barrel / 2-pin terminal for servo power',
    notes: ['Pi Zero-size bonnet on the 58 x 23 hole pattern (Adafruit 3416).'],
    data: { vinMin: 5.0, vinMax: 6.0, servoPorts: 16, motorPorts: 0, servo5vBudgetA: 4.0 },
  },
  'BUS-SERVO-ADAPTER': {
    id: 'BUS-SERVO-ADAPTER', kind: 'shield', name: 'Waveshare / Feetech bus servo driver board (USB + UART)',
    size: [42.0, 32.0, 12.0], massG: 10, massEstimated: true,
    electrical: 'Half-duplex TTL bus for ST / SC series servos, CH343 USB-serial or 3.3 V UART in, servo power 6-12 V passed through to the bus',
    connector: 'USB-C, 4-pin UART header, 2x 3-pin servo bus ports, DC 5.5 x 2.1 / screw terminal power in',
    notes: ['Outline and holes are estimates (Waveshare Bus Servo Adapter (A) class board); one port drives a daisy chain of up to 253 IDs.'],
    data: { vinMin: 6.0, vinMax: 12.6, servoPorts: 253, motorPorts: 0, servo5vBudgetA: 0, busServo: 1 },
  },
  'BUCK-5V-5A': {
    id: 'BUCK-5V-5A', kind: 'shield', name: '5 V 5 A step-down converter (2S / 3S in)',
    size: [36.0, 24.0, 12.0], massG: 12, massEstimated: true,
    electrical: '6.5-24 V in -> 5.1 V 5 A continuous (synchronous buck, ~92 %), enough for a Pi 5 (5 A) or Jetson Nano (4 A) from a 2S pack',
    connector: 'Solder pads / screw terminals in and out (or a USB-C PD trigger-free 5 V output on some modules)',
    notes: ['Generic module outline (estimated), 2x M3 holes on 30 mm. Feed the Pi 5 through its USB-C or the GPIO 5 V pins with short thick leads (= 20 AWG).'],
    data: { vinMin: 6.5, vinMax: 24, voutV: 5.1, outA: 5.0, efficiency: 0.92, servoPorts: 0, servo5vBudgetA: 0 },
  },
  'UPS-HAT-PI': {
    id: 'UPS-HAT-PI', kind: 'battery', name: '18650 UPS HAT for Raspberry Pi (2x 18650, 5 V 5 A)',
    size: [65.0, 56.5, 24.0], massG: 110, massEstimated: true,
    electrical: '2x 18650 cells (3.7 V 2x 2600 mAh, 1S2P), boost to 5.1 V 5 A (Pi 5 class), charge over USB-C, I2C fuel gauge (0x36 / 0x42)',
    connector: '40-pin Pi header (pogo or stacking), USB-C charge input',
    notes: ['HAT outline on the 58 x 49 hole pattern with the two cells on top; cells not included on some kits. 5 A output and the I2C address depend on the vendor (Waveshare / Geekworm / SupTronics): verify.'],
    data: { voltage: 3.7, capacitymAh: 5200, cellD: 18.5, outV: 5.1, outA: 5.0 },
  },
};

export const PIN_STANDARD =
  'All CyberBrick 3-pin headers: pin 1 = GND (black/brown), pin 2 = +5 V (red), pin 3 = PWM/data (yellow/orange/white). Keyed headers.';

/** Community-sourced GPIO map (unverified), same as the CyberDuck project. */
export const GPIO = { S1: 3, S2: 2, S3: 1, S4: 0, D1: 21, statusLed: 8, button: 9 } as const;

export interface KitInventory {
  controllers: number;
  shields: number;
  servos: number;
  motors: number;
  batteries: number;
  switches: number;
  ledHubs: number;
  leds: number;
  speakers?: number;
}

export const SINGLE_KIT_INVENTORY: KitInventory = {
  controllers: 1,
  shields: 1,
  servos: 4,
  motors: 2,
  batteries: 1,
  switches: 1,
  ledHubs: 1,
  leds: 6,
  speakers: 0,
};

export const SINGLE_KIT_INVENTORY_BY_ID: Record<string, number> = {
  'B-XA003': 1,
  'B-XA004': 1,
  'B-PG001': 4,
  'B-PG002': 2,
  'B-GM001': 2,
  'B-PC003': 1,
  'B-XA007': 1,
  'B-XA006': 1,
  'B-KB003': 6,
};

export interface PopularKit {
  id: string;
  name: string;
  description: string;
  category: 'cyberbrick' | 'raspberry_pi' | 'esp32' | 'seeed' | 'jetson' | 'ai_agent' | 'arduino' | 'pico' | 'sipeed';
  inventory: KitInventory;
  mainController: string;
  defaultBattery: string;
  servoModel: string;
  hasSpeaker?: boolean;
}

export const POPULAR_KITS: Record<string, PopularKit> = {
  'cyberbrick': {
    id: 'cyberbrick',
    name: 'CyberBrick Robotics Kit',
    description: 'Official CyberBrick ESP32-C3 modular robotics kit with 4 micro servos, 2 geared motors, and 2S battery.',
    category: 'cyberbrick',
    inventory: { controllers: 1, shields: 1, servos: 4, motors: 2, batteries: 1, switches: 1, ledHubs: 1, leds: 6, speakers: 0 },
    mainController: 'B-XA003',
    defaultBattery: 'B-PC003',
    servoModel: 'B-PG001',
  },
  'xiaozhi_ai': {
    id: 'xiaozhi_ai',
    name: 'XiaoZhi / ZhaoZhi AI Desk Agent Kit',
    description: 'Open-source desktop voice AI agent kit with ESP32-S3 AI Core, I2S sound chamber, dual mic, pan-tilt stand, and 18650 battery.',
    category: 'ai_agent',
    inventory: { controllers: 1, shields: 1, servos: 2, motors: 0, batteries: 1, switches: 1, ledHubs: 1, leds: 4, speakers: 1 },
    mainController: 'ZHAOZHI-AI-CORE',
    defaultBattery: 'BAT-18650-1S',
    servoModel: 'SG90-SERVO',
    hasSpeaker: true,
  },
  'raspberry_pi': {
    id: 'raspberry_pi',
    name: 'Raspberry Pi 4/5 AI Robotics Kit',
    description: 'High-performance Linux robotics kit with Raspberry Pi 4B/5, Robot HAT, 4x SG90 servos, 2x DC motors, and high-capacity battery.',
    category: 'raspberry_pi',
    inventory: { controllers: 1, shields: 1, servos: 4, motors: 2, batteries: 1, switches: 1, ledHubs: 1, leds: 4, speakers: 1 },
    mainController: 'RPI-4B',
    defaultBattery: 'BAT-18650-2S',
    servoModel: 'SG90-SERVO',
    hasSpeaker: true,
  },
  'esp32_diy': {
    id: 'esp32_diy',
    name: 'ESP32 Maker Robot Kit',
    description: 'Popular hobbyist DIY robot kit with ESP32-WROOM-32 DevKit, sensor shield, 4x SG90/MG90S servos, 2x N20 motors, and 18650 cells.',
    category: 'esp32',
    inventory: { controllers: 1, shields: 1, servos: 4, motors: 2, batteries: 1, switches: 1, ledHubs: 1, leds: 4, speakers: 0 },
    mainController: 'ESP32-DEV',
    defaultBattery: 'BAT-18650-2S',
    servoModel: 'SG90-SERVO',
  },
  'arduino_maker': {
    id: 'arduino_maker',
    name: 'Arduino Uno R3/R4 Robotics Kit',
    description: 'Classic maker robotics setup with Arduino Uno, L298P motor shield, 4x SG90 micro servos, 2x TT yellow motors, HC-SR04 ultrasonic sensor, and 2S battery pack.',
    category: 'arduino',
    inventory: { controllers: 1, shields: 1, servos: 4, motors: 2, batteries: 1, switches: 1, ledHubs: 0, leds: 2, speakers: 0 },
    mainController: 'ARDUINO-UNO',
    defaultBattery: 'BAT-18650-2S',
    servoModel: 'SG90-SERVO',
  },
  'pico_robot': {
    id: 'pico_robot',
    name: 'Raspberry Pi Pico W Robotics Kit',
    description: 'Affordable, compact robotics kit powered by Raspberry Pi Pico W, Pico robotics board, 4x SG90 servos, 2x N20 motors, and OLED display.',
    category: 'pico',
    inventory: { controllers: 1, shields: 1, servos: 4, motors: 2, batteries: 1, switches: 1, ledHubs: 0, leds: 2, speakers: 0 },
    mainController: 'RPI-PICO-W',
    defaultBattery: 'BAT-18650-1S',
    servoModel: 'SG90-SERVO',
  },
  'seeed_xiao': {
    id: 'seeed_xiao',
    name: 'Seeed Studio XIAO Compact Kit',
    description: 'Thumb-sized micro robot and desk companion kit powered by Seeed XIAO ESP32-C3/S3, 2 micro servos, and LiPo pouch cell.',
    category: 'seeed',
    inventory: { controllers: 1, shields: 1, servos: 2, motors: 0, batteries: 1, switches: 1, ledHubs: 0, leds: 2, speakers: 0 },
    mainController: 'XIAO-ESP32-C3',
    defaultBattery: 'BAT-LIPO-1S-1000',
    servoModel: 'SG90-SERVO',
  },
  'jetson_ai': {
    id: 'jetson_ai',
    name: 'NVIDIA Jetson Edge AI Kit',
    description: 'Heavyweight AI developer kit with NVIDIA Jetson Orin Nano / Nano, high-power carrier shield, metal gear servos, and speaker.',
    category: 'jetson',
    inventory: { controllers: 1, shields: 1, servos: 6, motors: 2, batteries: 1, switches: 1, ledHubs: 1, leds: 6, speakers: 1 },
    mainController: 'JETSON-ORIN-NANO',
    defaultBattery: 'BAT-18650-2S',
    servoModel: 'MG90S-SERVO',
    hasSpeaker: true,
  },
  'licheerv_claw': {
    id: 'licheerv_claw',
    name: 'Sipeed LicheeRV Claw Kit',
    description: 'LicheeRV Nano W (SG2002 RISC-V Linux, 1 TOPS NPU, WiFi 6) on the PicoClaw board: 240x240 LCD, 2 keys, mic, built-in speaker and 1S battery. A PicoClaw AI voice assistant out of the box; without servos a design needs no base, just a body for the module.',
    category: 'sipeed',
    inventory: { controllers: 1, shields: 1, servos: 0, motors: 0, batteries: 0, switches: 0, ledHubs: 0, leds: 0, speakers: 0 },
    mainController: 'LICHEERV-NANO-W',
    defaultBattery: 'built into the Claw module',
    servoModel: 'SG90-SERVO',
    hasSpeaker: true,
  },
  'licheerv_claw_servo': {
    id: 'licheerv_claw_servo',
    name: 'LicheeRV Claw Kit + Servo Add-on',
    description: 'The LicheeRV Claw kit plus a PCA9685 16-channel I2C servo board, 4 SG90 micro servos and a servo battery pack (with a 5 V boost to the PCA9685), so the AI assistant can move (pan-tilt heads, levers, small mechanisms).',
    category: 'sipeed',
    inventory: { controllers: 1, shields: 2, servos: 4, motors: 0, batteries: 2, switches: 0, ledHubs: 0, leds: 0, speakers: 0 },
    mainController: 'LICHEERV-NANO-W',
    defaultBattery: 'BAT-LIPO-1S-1000',
    servoModel: 'SG90-SERVO',
    hasSpeaker: true,
  },
  // Voice robots: the board, mic, amp + speaker and display sit in the voice core of a free-form body (src/cad/voicecore.ts)
  'xiaozhi_voice': {
    id: 'xiaozhi_voice',
    name: 'XiaoZhi ESP32-S3 Voice Robot Kit',
    description: 'XiaoZhi reference build: ESP32-S3 DevKitC, INMP441 I2S mic, MAX98357A I2S amp + 8 O speaker, 1.28" round GC9A01 face, PCA9685 servo board with 2 micro servos, 1S 18650 cell (USB-C charging).',
    category: 'ai_agent',
    inventory: { controllers: 1, shields: 2, servos: 2, motors: 0, batteries: 1, switches: 0, ledHubs: 0, leds: 0, speakers: 1 },
    mainController: 'ESP32-S3-DEVKIT',
    defaultBattery: 'BAT-18650-1S',
    servoModel: 'SG90-SERVO',
    hasSpeaker: true,
  },
  'rpi_voice': {
    id: 'rpi_voice',
    name: 'Raspberry Pi 5 Voice Robot Kit',
    description: 'Raspberry Pi 5 with a ReSpeaker 2-Mics HAT (mics + speaker out), 8 O speaker, 2.0" ST7789 face, PCA9685 servo board with 4 SG92R micro servos, 2S 18650 pack and a 5 V 5 A buck for the Pi 5.',
    category: 'raspberry_pi',
    inventory: { controllers: 1, shields: 3, servos: 4, motors: 0, batteries: 1, switches: 0, ledHubs: 0, leds: 0, speakers: 1 },
    mainController: 'RPI-5',
    defaultBattery: 'BAT-18650-2S',
    servoModel: 'SG92R-SERVO',
    hasSpeaker: true,
  },
  'jetson_voice': {
    id: 'jetson_voice',
    name: 'Jetson Nano Voice Robot Kit',
    description: 'Jetson Nano B01 with a USB mini microphone, MAX98357A I2S amp + 8 O speaker, 1.69" ST7789 face, PCA9685 servo board with 4 MG90S metal-gear micro servos, 2S 18650 pack and a 5 V 5 A buck (Nano barrel input, 5 V 4 A).',
    category: 'jetson',
    inventory: { controllers: 1, shields: 3, servos: 4, motors: 0, batteries: 1, switches: 0, ledHubs: 0, leds: 0, speakers: 1 },
    mainController: 'JETSON-NANO',
    defaultBattery: 'BAT-18650-2S',
    servoModel: 'MG90S-SERVO',
    hasSpeaker: true,
  },
};

export type ComponentDirectory = Record<string, number>;

/** Electronics platform a Directory implies: CyberBrick ESP32-C3 + shield, or the Sipeed LicheeRV Claw kit. */
export type { Platform };
/**
 * The platform a Directory implies, from its main board. The CyberBrick core wins when present (the original kit);
 * otherwise the first voice board found: LicheeRV Claw, XiaoZhi ESP32-S3, Jetson, Raspberry Pi.
 */
export function platformOf(dir?: ComponentDirectory | null): Platform {
  if (!dir) return 'cyberbrick';
  const has = (id: string) => (Number(dir[id]) || 0) > 0;
  if (has('B-XA003')) return 'cyberbrick';
  if (has('LICHEERV-NANO-W')) return 'licheerv_claw';
  if (has('ZHAOZHI-AI-CORE') || has('ESP32-S3-DEVKIT') || has('XIAO-ESP32-S3')) return 'xiaozhi';
  if (has('JETSON-ORIN-NANO') || has('JETSON-NANO')) return 'jetson';
  if (has('RPI-5') || has('RPI-4B') || has('RPI-ZERO-2W')) return 'rpi';
  return 'cyberbrick';
}

export const DEFAULT_KIT_DIRECTORY_ITEMS: Record<string, Record<string, number>> = {
  cyberbrick: {
    'B-XA003': 1,
    'B-XA004': 1,
    'B-PG001': 4,
    'B-PG002': 2,
    'B-GM001': 2,
    'B-PC003': 1,
    'B-XA007': 1,
    'B-XA006': 1,
    'B-KB003': 6,
    'MAG-N52-10X2': 4,
  },
  xiaozhi_ai: {
    'ZHAOZHI-AI-CORE': 1,
    'B-XA004': 1,
    'SG90-SERVO': 2,
    'ZHAOZHI-SPEAKER-MOD': 1,
    'BAT-18650-1S': 1,
    'B-XA007': 1,
    'B-XA006': 1,
    'B-KB003': 4,
    'MAG-N52-10X2': 4,
  },
  raspberry_pi: {
    'RPI-4B': 1,
    'SHIELD-RPI-ROBOT': 1,
    'SG90-SERVO': 4,
    'N20-MOTOR': 2,
    'BAT-18650-2S': 1,
    'SPK-8OHM-2W': 1,
    'B-XA007': 1,
    'B-KB003': 4,
    'MAG-N52-10X2': 4,
  },
  esp32_diy: {
    'ESP32-DEV': 1,
    'SHIELD-ESP32-SERVO': 1,
    'SG90-SERVO': 4,
    'N20-MOTOR': 2,
    'BAT-18650-2S': 1,
    'B-XA007': 1,
    'B-KB003': 4,
    'MAG-N52-10X2': 4,
  },
  arduino_maker: {
    'ARDUINO-UNO': 1,
    'SHIELD-ARDUINO-MOTOR': 1,
    'SG90-SERVO': 4,
    'TT-MOTOR': 2,
    'HC-SR04': 1,
    'BAT-18650-2S': 1,
    'B-XA007': 1,
    'B-KB003': 2,
    'MAG-N52-10X2': 4,
  },
  pico_robot: {
    'RPI-PICO-W': 1,
    'SHIELD-PICO-ROBOT': 1,
    'SG90-SERVO': 4,
    'N20-MOTOR': 2,
    'OLED-SSD1306': 1,
    'BAT-18650-1S': 1,
    'B-XA007': 1,
    'B-KB003': 2,
    'MAG-N52-10X2': 4,
  },
  seeed_xiao: {
    'XIAO-ESP32-C3': 1,
    'SG90-SERVO': 2,
    'BAT-LIPO-1S-1000': 1,
    'SPK-MICRO-1W': 1,
    'B-XA007': 1,
    'B-KB003': 2,
    'MAG-N52-10X2': 4,
  },
  jetson_ai: {
    'JETSON-ORIN-NANO': 1,
    'SHIELD-RPI-ROBOT': 1,
    'MG90S-SERVO': 6,
    'B-GM001': 2,
    'BAT-18650-2S': 2,
    'SPK-8OHM-2W': 1,
    'B-XA007': 1,
    'B-XA006': 1,
    'B-KB003': 6,
    'MAG-N52-10X2': 4,
  },
  licheerv_claw: {
    'LICHEERV-NANO-W': 1,
    'PICOCLAW-BOARD': 1,          // the module brings its own battery and speaker
    'MAG-N52-10X2': 4,
  },
  licheerv_claw_servo: {
    'LICHEERV-NANO-W': 1,
    'PICOCLAW-BOARD': 1,
    'PCA9685-SERVO-16': 1,
    'SG90-SERVO': 4,
    'BAT-LIPO-1S-1000': 1,        // servo power: desk bases (pouch in the tub)
    'BAT-1S2P-14500': 1,          // servo power: robot bodies built around the twin-cell bay (walkers, rovers, snakes)
    'MAG-N52-10X2': 4,
  },
  xiaozhi_voice: {
    'ESP32-S3-DEVKIT': 1,
    'MIC-INMP441': 1,
    'AMP-MAX98357A': 1,
    'SPK-8OHM-2W': 1,
    'LCD-GC9A01-128': 1,
    'PCA9685-SERVO-16': 1,
    'SG90-SERVO': 2,
    'BAT-18650-1S': 1,
    'MAG-N52-10X2': 4,            // cover magnets
  },
  rpi_voice: {
    'RPI-5': 1,
    'RESPEAKER-2MIC-HAT': 1,      // 2 mics + speaker out
    'SPK-8OHM-2W': 1,
    'LCD-ST7789-20': 1,
    'PCA9685-SERVO-16': 1,
    'SG92R-SERVO': 4,
    'BAT-18650-2S': 1,
    'BUCK-5V-5A': 1,              // Pi 5 needs 5 V 5 A
    'MAG-N52-10X2': 4,
  },
  jetson_voice: {
    'JETSON-NANO': 1,
    'USB-MIC-MINI': 1,
    'AMP-MAX98357A': 1,
    'SPK-8OHM-2W': 1,
    'LCD-ST7789-169': 1,
    'PCA9685-SERVO-16': 1,
    'MG90S-SERVO': 4,
    'BAT-18650-2S': 1,
    'BUCK-5V-5A': 1,              // Nano barrel: 5 V 4 A
    'MAG-N52-10X2': 4,
  },
};

export function getDefaultComponentDirectory(kitType = 'cyberbrick', kitCount = 1): ComponentDirectory {
  const k = Math.max(1, Math.floor(Number(kitCount) || 1));
  const base = DEFAULT_KIT_DIRECTORY_ITEMS[kitType] ?? DEFAULT_KIT_DIRECTORY_ITEMS.cyberbrick;
  const dir: ComponentDirectory = {};
  for (const [id, count] of Object.entries(base)) {
    dir[id] = count * k;
  }
  return dir;
}

export interface DirectoryTotals {
  controllers: number;
  shields: number;
  servos: number;
  motors: number;
  batteries: number;
  switches: number;
  ledHubs: number;
  leds: number;
  speakers: number;
  hardware: number;
  totalItems: number;
}

export function getDirectoryTotals(dir: ComponentDirectory): DirectoryTotals {
  const totals: DirectoryTotals = {
    controllers: 0,
    shields: 0,
    servos: 0,
    motors: 0,
    batteries: 0,
    switches: 0,
    ledHubs: 0,
    leds: 0,
    speakers: 0,
    hardware: 0,
    totalItems: 0,
  };
  for (const [id, count] of Object.entries(dir)) {
    const qty = Math.max(0, Math.floor(Number(count) || 0));
    if (qty <= 0) continue;
    totals.totalItems += qty;
    const item = CATALOG[id];
    if (!item) continue;
    switch (item.kind) {
      case 'controller': totals.controllers += qty; break;
      case 'shield': totals.shields += qty; break;
      case 'servo':
      case 'cservo': totals.servos += qty; break;
      case 'motor': totals.motors += qty; break;
      case 'battery': totals.batteries += qty; break;
      case 'switch': totals.switches += qty; break;
      case 'ledhub': totals.ledHubs += qty; break;
      case 'led': totals.leds += qty; break;
      case 'speaker': totals.speakers += qty; break;
      case 'sensor':
      case 'display':
      case 'camera':
      case 'hardware': totals.hardware += qty; break;
    }
  }
  return totals;
}

export function formatDirectorySummary(dir: ComponentDirectory): string {
  const lines: string[] = [];
  for (const [id, count] of Object.entries(dir)) {
    const qty = Math.max(0, Math.floor(Number(count) || 0));
    if (qty <= 0) continue;
    const item = CATALOG[id];
    const name = item ? `${item.name} (${item.kind})` : id;
    lines.push(`- ${qty}x ${id}: ${name}`);
  }
  return lines.length ? lines.join('\n') : '(Inventory empty - 0 components)';
}

export function getKitInventory(kitCount = 1, kitType: string = 'cyberbrick'): KitInventory {
  const k = Math.max(1, Math.floor(Number(kitCount) || 1));
  const base = POPULAR_KITS[kitType]?.inventory ?? SINGLE_KIT_INVENTORY;
  return {
    controllers: base.controllers * k,
    shields: base.shields * k,
    servos: base.servos * k,
    motors: base.motors * k,
    batteries: base.batteries * k,
    switches: base.switches * k,
    ledHubs: base.ledHubs * k,
    leds: base.leds * k,
    speakers: (base.speakers ?? 0) * k,
  };
}

/**
 * Checks whether a natural language prompt explicitly requests components that exceed
 * the inventory available for `kitCount` kits or a custom component directory.
 * Returns an error explanation string if infeasible, or null if feasible.
 */
export function checkPromptKitFeasibility(prompt: string, kitCount = 1, inventory?: ComponentDirectory): string | null {
  const p = prompt.toLowerCase();
  const k = Math.max(1, Math.floor(Number(kitCount) || 1));

  let maxServos: number;
  let maxMotors: number;
  let maxLeds: number;
  let maxControllers: number;
  let maxBatteries: number;
  let isCustom = false;

  if (inventory && Object.keys(inventory).length > 0) {
    const t = getDirectoryTotals(inventory);
    maxServos = t.servos;
    maxMotors = t.motors;
    maxLeds = t.leds;
    maxControllers = t.controllers;
    maxBatteries = t.batteries;
    isCustom = true;
  } else {
    maxServos = 4 * k;
    maxMotors = 2 * k;
    maxLeds = 6 * k;
    maxControllers = 1 * k;
    maxBatteries = 1 * k;
  }

  // Check humanoid with arms on insufficient servos
  if (/\b(?:humanoid.*arm|arm.*humanoid|biped.*arm|arm.*biped)\b/i.test(p) && maxServos < 6) {
    return isCustom
      ? `Insufficient components: A humanoid with articulated arms requires 6 servos (4 for legs, 2 for arms), but your component directory only has ${maxServos} servos. Please add more servos in the Component Directory.`
      : 'Insufficient components: A humanoid with articulated arms requires 6 servos (4 for legs, 2 for arms), but 1 kit only provides 4 servos. You need at least 2 kits.';
  }

  // Check explicit servo / axis / DOF count
  const axisMatch = p.match(/(\d+)\s*(?:-|\s)*(?:axis|dof|degree(?:s)?\s*of\s*freedom|servos?)/i);
  if (axisMatch) {
    const count = parseInt(axisMatch[1], 10);
    if (count > maxServos) {
      if (isCustom) {
        return `Insufficient components: Requested ${count} servos/axes, but your component directory only has ${maxServos} available servos. Please update your Component Directory to add more servos.`;
      }
      const neededKits = Math.ceil(count / 4);
      return `Insufficient components: Requested ${count} servos/axes, but ${k} kit${k > 1 ? 's only provide' : ' only provides'} ${maxServos} servos. You need at least ${neededKits} kits.`;
    }
  }

  // Check explicit motor count
  const motorMatch = p.match(/(\d+)\s*(?:geared\s*)?motors?/i);
  if (motorMatch) {
    const count = parseInt(motorMatch[1], 10);
    if (count > maxMotors) {
      if (isCustom) {
        return `Insufficient components: Requested ${count} motors, but your component directory only has ${maxMotors} available motors. Please update your Component Directory.`;
      }
      const neededKits = Math.ceil(count / 2);
      return `Insufficient components: Requested ${count} motors, but ${k} kit${k > 1 ? 's only provide' : ' only provides'} ${maxMotors} geared motors. You need at least ${neededKits} kits.`;
    }
  }
  if (/\b(?:4wd|4x4|four[\s-]wheel[\s-]drive)\b/i.test(p) && maxMotors < 4) {
    return isCustom
      ? `Insufficient components: A 4-wheel drive (4WD) robot requires 4 motors, but your component directory only has ${maxMotors} available motors. Please add more motors in the Component Directory.`
      : `Insufficient components: A 4-wheel drive (4WD) robot requires 4 motors, but ${k} kit${k > 1 ? 's only provide' : ' only provides'} ${maxMotors} geared motors. You need at least 2 kits.`;
  }

  // Check explicit LED count
  const ledMatch = p.match(/(\d+)\s*(?:leds?|lights?|rgbw?)/i);
  if (ledMatch) {
    const count = parseInt(ledMatch[1], 10);
    if (count > maxLeds) {
      if (isCustom) {
        return `Insufficient components: Requested ${count} LEDs, but your component directory only has ${maxLeds} available LEDs. Please update your Component Directory.`;
      }
      const neededKits = Math.ceil(count / 6);
      return `Insufficient components: Requested ${count} LEDs, but ${k} kit${k > 1 ? 's only provide' : ' only provides'} ${maxLeds} LEDs. You need at least ${neededKits} kits.`;
    }
  }

  // Check mobile manipulator combinations (rover + arm)
  const hasRover = /\b(?:rover|car|vehicle|mobile|drive|tank)\b/i.test(p);
  const hasArm = /\b(?:arm|manipulator|gripper|claw)\b/i.test(p);
  if (hasRover && hasArm) {
    const totalActuators = maxServos + maxMotors;
    if (isCustom) {
      if (totalActuators < 6) {
        return `Insufficient components: A mobile manipulator (rover + arm) requires at least 6 actuators, but your component directory only has ${totalActuators} total actuators (${maxServos} servos, ${maxMotors} motors). Please add more actuators in the Component Directory.`;
      }
    } else if (k < 2) {
      return `Insufficient components: A mobile manipulator (rover + arm) requires at least 6 actuators and 2 shields, but 1 kit only provides 4 servos and 1 shield. You need at least 2 kits.`;
    }
  }

  // Check battery count
  const batMatch = p.match(/(\d+)\s*(?:batter(?:y|ies)|battery\s*packs?)/i);
  if (batMatch) {
    const count = parseInt(batMatch[1], 10);
    if (count > maxBatteries) {
      if (isCustom) {
        return `Insufficient components: Requested ${count} batteries, but your component directory only has ${maxBatteries} battery.`;
      }
      return `Insufficient components: Requested ${count} batteries, but ${k} kit${k > 1 ? 's only provide' : ' only provides'} ${maxBatteries} battery. You need at least ${count} kits.`;
    }
  }

  // Check controller count
  const coreMatch = p.match(/(\d+)\s*(?:controllers?|cores?|esps?|shields?)/i);
  if (coreMatch) {
    const count = parseInt(coreMatch[1], 10);
    if (count > maxControllers) {
      if (isCustom) {
        return `Insufficient components: Requested ${count} controllers/shields, but your component directory only has ${maxControllers}.`;
      }
      return `Insufficient components: Requested ${count} controllers/shields, but ${k} kit${k > 1 ? 's only provide' : ' only provides'} ${maxControllers}. You need at least ${count} kits.`;
    }
  }

  return null;
}
