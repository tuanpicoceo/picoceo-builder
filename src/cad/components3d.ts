// Procedural 3D solid models for the most popular maker robotics dev kits, expansion HATs,
// sensors, motors, and electronic components. Built with watertight Manifold 3D CSG primitives.

import { CATALOG } from '../catalog/components';
import { box, cylX, cylY, cylZ, rrect, sub, union, type M } from './kernel';

// -----------------------------------------------------------------------------------------
// 1. Single Board Computers & Dev Kits
// -----------------------------------------------------------------------------------------

/**
 * Raspberry Pi 4 Model B / Raspberry Pi 5 (85.6 x 56.5 x 17.0 mm)
 * Features: Green PCB with 4x M2.5 mounting holes, dual USB 3.0 (blue) + dual USB 2.0 (black),
 * RJ45 Gigabit Ethernet port with metal shield, dual micro-HDMI ports, USB-C power receptacle,
 * 40-pin GPIO pin header block (2x20), Broadcom BCM SoC package, DSI/CSI camera slots.
 */
export function raspberryPiSolid(cx = 0, cy = 0, z0 = 0, isPi5 = false): M {
  const pcbW = 85.6, pcbD = 56.5, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  // PCB with 3.0 mm rounded corners and 4x M2.5 mounting holes (pitch: 58.0 x 49.0 mm)
  const holeX0 = x0 + 3.5, holeX1 = holeX0 + 58.0;
  const holeY0 = y0 + 3.5, holeY1 = holeY0 + 49.0;
  const pcb = sub(
    rrect(pcbW, pcbD, 3.0, cx, cy, z0, z0 + pcbT),
    cylZ(holeX0, holeY0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(holeX1, holeY0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(holeX0, holeY1, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(holeX1, holeY1, 1.35, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // Ports along the right edge (+X):
  // RJ45 Gigabit Ethernet port with metal shield (top-right or bottom-right depending on 4 vs 5)
  const ethY = isPi5 ? cy - 14.0 : cy + 14.0;
  const ethPort = box(x1 - 21.0, x1 + 2.0, ethY - 8.0, ethY + 8.0, topZ, topZ + 13.5);

  // Dual stacked USB 3.0 ports (blue accents) & dual USB 2.0 ports (black)
  const usb1Y = isPi5 ? cy + 14.0 : cy - 2.0;
  const usb2Y = isPi5 ? cy - 0.5 : cy - 18.0;
  const usbPort1 = box(x1 - 17.0, x1 + 2.5, usb1Y - 7.0, usb1Y + 7.0, topZ, topZ + 15.5);
  const usbPort2 = box(x1 - 17.0, x1 + 2.5, usb2Y - 7.0, usb2Y + 7.0, topZ, topZ + 15.5);

  // Ports along the bottom edge (-Y):
  // USB-C power receptacle
  const usbcPort = box(x0 + 7.5, x0 + 16.5, y0 - 1.5, y0 + 7.5, topZ, topZ + 3.2);
  // Dual micro-HDMI metal ports
  const hdmi1 = box(x0 + 24.0, x0 + 31.5, y0 - 1.2, y0 + 6.5, topZ, topZ + 3.0);
  const hdmi2 = box(x0 + 39.0, x0 + 46.5, y0 - 1.2, y0 + 6.5, topZ, topZ + 3.0);

  // 40-pin GPIO pin header block (2 x 20) along the top edge (+Y)
  const gpioHeader = box(x0 + 29.0, x0 + 80.0, y1 - 5.5, y1 - 0.5, topZ, topZ + 8.5);

  // Central Broadcom SoC heat spreader chip (silver/dark metallic)
  const socChip = box(cx - 10.0, cx + 5.0, cy - 7.0, cy + 8.0, topZ, topZ + 2.5);

  // Camera CSI and Display DSI connector slots
  const dsiSlot = box(x0 + 2.0, x0 + 5.5, cy - 11.0, cy + 11.0, topZ, topZ + 2.8);

  return union([pcb, ethPort, usbPort1, usbPort2, usbcPort, hdmi1, hdmi2, gpioHeader, socChip, dsiSlot]);
}

/**
 * Raspberry Pi Zero 2 W (65.0 x 30.0 x 5.2 mm)
 * Features: Slim green PCB with 4x M2.5 mounting holes (pitch 58.0 x 23.0 mm), dual micro-USB ports,
 * mini-HDMI, RP3A0 SiP chip, microSD card slot, 40-pin GPIO footprint.
 */
export function raspberryPiZeroSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 65.0, pcbD = 30.0, pcbT = 1.4;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const holeX0 = x0 + 3.5, holeX1 = holeX0 + 58.0;
  const holeY0 = y0 + 3.5, holeY1 = holeY0 + 23.0;
  const pcb = sub(
    rrect(pcbW, pcbD, 3.0, cx, cy, z0, z0 + pcbT),
    cylZ(holeX0, holeY0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(holeX1, holeY0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(holeX0, holeY1, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(holeX1, holeY1, 1.35, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // Dual micro-USB metal receptacles along the bottom edge (-Y)
  const usbPower = box(x1 - 15.0, x1 - 7.0, y0 - 1.2, y0 + 6.0, topZ, topZ + 2.8);
  const usbOtg = box(x1 - 28.0, x1 - 20.0, y0 - 1.2, y0 + 6.0, topZ, topZ + 2.8);
  // Mini-HDMI connector
  const miniHdmi = box(x0 + 8.0, x0 + 19.5, y0 - 1.2, y0 + 7.5, topZ, topZ + 3.2);

  // RP3A0 SiP quad-core CPU chip in center
  const sipChip = box(cx - 7.0, cx + 7.0, cy - 7.0, cy + 7.0, topZ, topZ + 1.8);

  // 40-pin GPIO pin header block along the top edge (+Y)
  const gpioPins = box(x0 + 7.0, x1 - 7.0, y1 - 5.5, y1 - 0.5, topZ, topZ + 4.5);

  return union([pcb, usbPower, usbOtg, miniHdmi, sipChip, gpioPins]);
}

/**
 * Raspberry Pi Pico / Pico W / Pico 2 (51.0 x 21.0 x 4.0 mm)
 * Features: Slim green PCB with 40 castellated edge pads, micro-USB / Type-C port on top edge,
 * RP2040 chip, BOOTSEL push button, metal Wi-Fi shield can.
 */
export function raspberryPiPicoSolid(cx = 0, cy = 0, z0 = 0, hasWifi = true): M {
  const pcbW = 21.0, pcbD = 51.0, pcbT = 1.2;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  // 4x Ø2.1 mounting holes on the datasheet 11.4 x 47.0 pattern
  const pcb = sub(
    rrect(pcbW, pcbD, 1.5, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 4.8, y0 + 2.0, 1.05, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 4.8, y0 + 2.0, 1.05, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 4.8, y1 - 2.0, 1.05, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 4.8, y1 - 2.0, 1.05, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // Micro-USB / Type-C connector centered on top edge (+Y)
  const usbPort = box(cx - 4.0, cx + 4.0, y1 - 5.5, y1 + 1.8, topZ, topZ + 3.0);
  // RP2040 chip in center
  const rpChip = box(cx - 3.5, cx + 3.5, cy - 3.5, cy + 3.5, topZ, topZ + 1.2);
  // BOOTSEL tactile push button
  const bootsel = box(cx - 2.0, cx + 2.0, cy + 10.0, cy + 14.0, topZ, topZ + 1.5);
  // Wi-Fi metal shield can (for Pico W)
  const wifiCan = hasWifi ? box(cx - 5.5, cx + 5.5, cy - 18.0, cy - 8.0, topZ, topZ + 2.2) : null;

  return union([pcb, usbPort, rpChip, bootsel, wifiCan]);
}

/**
 * ESP32-WROOM-32 DevKit V1 (51.5 x 28.3 x 12.0 mm)
 * Features: Matte-black PCB, dual 15-pin 2.54mm header strips, ESP32 metal RF shield can,
 * micro-USB port, EN/BOOT buttons, AMS1117 regulator.
 */
export function esp32DevKitSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 28.3, pcbD = 51.5, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const pcb = rrect(pcbW, pcbD, 1.5, cx, cy, z0, z0 + pcbT);
  const topZ = z0 + pcbT;

  // Dual 15-pin 2.54mm header blocks along left and right edges
  const headerL = box(x0 + 0.5, x0 + 3.0, y0 + 6.0, y1 - 6.0, topZ, topZ + 8.5);
  const headerR = box(x1 - 3.0, x1 - 0.5, y0 + 6.0, y1 - 6.0, topZ, topZ + 8.5);

  // ESP32-WROOM-32 metal RF shield can + PCB antenna section
  const wroomMetal = box(cx - 9.0, cx + 9.0, cy - 4.0, y1 - 8.0, topZ, topZ + 3.2);
  const antenna = box(cx - 9.0, cx + 9.0, y1 - 8.0, y1 - 1.0, topZ, topZ + 1.2);

  // Micro-USB / Type-C port on bottom edge (-Y)
  const usbPort = box(cx - 4.0, cx + 4.0, y0 - 1.5, y0 + 6.0, topZ, topZ + 3.0);
  // EN & BOOT tactile push buttons
  const btnEN = box(x0 + 4.0, x0 + 8.0, y0 + 3.0, y0 + 7.0, topZ, topZ + 2.5);
  const btnBOOT = box(x1 - 8.0, x1 - 4.0, y0 + 3.0, y0 + 7.0, topZ, topZ + 2.5);

  return union([pcb, headerL, headerR, wroomMetal, antenna, usbPort, btnEN, btnBOOT]);
}

/**
 * Seeed Studio XIAO ESP32-C3 / S3 (21.0 x 17.5 x 4.5 mm)
 * Features: Ultra-compact thumb PCB, Type-C metal receptacle, castellated pads, RF shield.
 */
export function seeedXiaoSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 17.5, pcbD = 21.0, pcbT = 1.2;
  const x0 = cx - pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const pcb = rrect(pcbW, pcbD, 1.2, cx, cy, z0, z0 + pcbT);
  const topZ = z0 + pcbT;

  // Type-C metal receptacle centered on top edge (+Y) with overhang
  const typeCPort = box(cx - 4.5, cx + 4.5, y1 - 6.0, y1 + 1.8, topZ, topZ + 3.2);
  // Metal RF shield box
  const shieldCan = box(cx - 6.5, cx + 6.5, y0 + 2.5, y1 - 7.0, topZ, topZ + 2.2);
  // Reset button
  const resetBtn = box(x0 + 1.5, x0 + 4.5, y0 + 3.0, y0 + 6.0, topZ, topZ + 1.8);

  return union([pcb, typeCPort, shieldCan, resetBtn]);
}

/**
 * Arduino Uno R3 / R4 Minima & WiFi (68.6 x 53.4 x 15.0 mm)
 * Features: Classic teal/blue PCB with mounting holes, USB Type-B / Type-C port, DC barrel power jack,
 * 4 female header socket strips (1x10, 2x8, 1x6), ATmega328P / RA4M1 MCU chip, reset push button.
 */
export function arduinoUnoSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 68.6, pcbD = 53.4, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  // PCB with classic Arduino Uno asymmetric shape and 4 mounting holes
  const pcb = sub(
    rrect(pcbW, pcbD, 2.5, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 14.0, y0 + 2.5, 1.6, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 15.3, y1 - 2.5, 1.6, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 2.5, y0 + 7.6, 1.6, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 2.5, y1 - 15.2, 1.6, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // USB Type-B receptacle on left edge (-X)
  const usbB = box(x0 - 2.5, x0 + 14.0, y1 - 18.0, y1 - 2.0, topZ, topZ + 11.0);
  // DC barrel jack on left edge (-X)
  const dcJack = box(x0 - 2.5, x0 + 13.5, y0 + 3.0, y0 + 12.0, topZ, topZ + 11.0);

  // Female header socket strips on top and bottom edges
  const headerTop = box(x0 + 23.0, x1 - 3.0, y1 - 3.5, y1 - 1.0, topZ, topZ + 8.5);
  const headerBot = box(x0 + 25.0, x1 - 5.0, y0 + 1.0, y0 + 3.5, topZ, topZ + 8.5);

  // ATmega328P DIP-28 or RA4M1 QFP microcontroller chip in center
  const mcuChip = box(cx - 3.0, cx + 22.0, cy - 5.0, cy + 3.0, topZ, topZ + 4.5);
  // Reset push button
  const resetBtn = box(x0 + 4.0, x0 + 9.0, y1 - 25.0, y1 - 20.0, topZ, topZ + 3.5);

  return union([pcb, usbB, dcJack, headerTop, headerBot, mcuChip, resetBtn]);
}

/**
 * XiaoZhi / ZhaoZhi AI Voice Agent Core (38.0 x 38.0 x 8.5 mm)
 * Features: Square black PCB with 4x M2.5 corner holes (pitch 32.0 x 32.0 mm), ESP32-S3 module,
 * dual MEMS microphones, Type-C USB, I2S DAC amp, speaker & display connectors.
 */
export function zhaozhiAiCoreSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 38.0, pcbD = 38.0, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  // PCB with 4x M2.5 mounting holes
  const pcb = sub(
    rrect(pcbW, pcbD, 2.5, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 3.0, y0 + 3.0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 3.0, y0 + 3.0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 3.0, y1 - 3.0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 3.0, y1 - 3.0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // ESP32-S3 module in center
  const s3Module = box(cx - 9.0, cx + 9.0, cy - 11.0, cy + 11.0, topZ, topZ + 3.2);
  // Dual MEMS microphone acoustic ports (left & right front edge)
  const micL = cylZ(x0 + 5.0, y1 - 5.0, 1.2, topZ, topZ + 1.2, 16);
  const micR = cylZ(x1 - 5.0, y1 - 5.0, 1.2, topZ, topZ + 1.2, 16);
  // Type-C USB connector on side
  const typeC = box(x0 - 1.5, x0 + 7.5, cy - 4.5, cy + 4.5, topZ, topZ + 3.2);
  // JST speaker connector
  const spkConn = box(x1 - 8.0, x1 - 1.0, cy - 3.5, cy + 3.5, topZ, topZ + 5.5);

  return union([pcb, s3Module, micL, micR, typeC, spkConn]);
}

/**
 * ESP32-S3 DevKitC-1 (68.0 x 28.5 x 11.5 mm)
 * Features: Matte black PCB, dual 22-pin header strips, ESP32-S3-WROOM-1 module,
 * dual Type-C ports (UART and USB-OTG), Reset/Boot buttons, WS2812 RGB LED.
 */
export function esp32S3DevKitSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 28.5, pcbD = 68.0, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const pcb = rrect(pcbW, pcbD, 1.5, cx, cy, z0, z0 + pcbT);
  const topZ = z0 + pcbT;

  // Dual 22-pin 2.54mm header blocks along left and right edges
  const headerL = box(x0 + 0.5, x0 + 3.0, y0 + 6.0, y1 - 6.0, topZ, topZ + 8.5);
  const headerR = box(x1 - 3.0, x1 - 0.5, y0 + 6.0, y1 - 6.0, topZ, topZ + 8.5);

  // ESP32-S3-WROOM module metal can + antenna
  const wroomMetal = box(cx - 9.0, cx + 9.0, cy - 4.0, y1 - 12.0, topZ, topZ + 3.2);
  const antenna = box(cx - 9.0, cx + 9.0, y1 - 12.0, y1 - 1.0, topZ, topZ + 1.2);

  // Dual Type-C ports along bottom edge (-Y)
  const usbc1 = box(x0 + 2.5, x0 + 11.5, y0 - 1.5, y0 + 6.5, topZ, topZ + 3.2);
  const usbc2 = box(x1 - 11.5, x1 - 2.5, y0 - 1.5, y0 + 6.5, topZ, topZ + 3.2);

  // Buttons & RGB LED
  const btn1 = box(x0 + 4.0, x0 + 8.0, y0 + 8.0, y0 + 12.0, topZ, topZ + 2.2);
  const btn2 = box(x1 - 8.0, x1 - 4.0, y0 + 8.0, y0 + 12.0, topZ, topZ + 2.2);
  const rgbLed = box(cx - 1.5, cx + 1.5, cy - 10.0, cy - 7.0, topZ, topZ + 1.2);

  return union([pcb, headerL, headerR, wroomMetal, antenna, usbc1, usbc2, btn1, btn2, rgbLed]);
}

/**
 * BBC micro:bit v2 (51.6 x 42.0 x 11.7 mm)
 * Features: Edge connector ring pads, 5x5 red LED matrix display, 2 tactile buttons (A & B),
 * touch sensor logo, nRF52833 processor, micro-USB and JST battery connector.
 */
export function microbitSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 51.6, pcbD = 42.0, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  // PCB with 5 large ring connector holes along bottom edge
  const pcb = sub(
    rrect(pcbW, pcbD, 3.0, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 5.0, y0 + 5.0, 2.0, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 15.0, y0 + 5.0, 2.0, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(cx, y0 + 5.0, 2.0, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 15.0, y0 + 5.0, 2.0, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 5.0, y0 + 5.0, 2.0, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // 5x5 LED matrix in center
  const matrix = box(cx - 8.0, cx + 8.0, cy - 8.0, cy + 8.0, topZ, topZ + 1.2);
  // Push buttons A and B
  const btnA = box(x0 + 4.5, x0 + 10.5, cy - 3.0, cy + 3.0, topZ, topZ + 3.5);
  const btnB = box(x1 - 10.5, x1 - 4.5, cy - 3.0, cy + 3.0, topZ, topZ + 3.5);
  // Micro-USB connector and JST battery socket on top edge
  const usbPort = box(cx - 4.0, cx + 4.0, y1 - 4.5, y1 + 1.8, topZ, topZ + 3.0);
  const jstPort = box(x1 - 14.0, x1 - 4.0, y1 - 6.5, y1 - 0.5, topZ, topZ + 6.0);

  return union([pcb, matrix, btnA, btnB, usbPort, jstPort]);
}

/**
 * NVIDIA Jetson Orin Nano / Nano (100.0 x 79.0 x 29.0 mm)
 * Features: Heavy carrier board, extruded aluminum heatsink with cooling fan shroud,
 * 4x USB 3.2 Gen2, DisplayPort, Gigabit RJ45, DC barrel jack, 40-pin GPIO.
 */
export function jetsonOrinNanoSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 100.0, pcbD = 79.0, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const pcb = sub(
    rrect(pcbW, pcbD, 3.5, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 4.0, y0 + 4.0, 1.6, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 4.0, y0 + 4.0, 1.6, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 4.0, y1 - 4.0, 1.6, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 4.0, y1 - 4.0, 1.6, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // Large aluminum cooling heatsink & fan shroud in center
  const heatsink = box(cx - 24.0, cx + 24.0, cy - 22.0, cy + 22.0, topZ, topZ + 24.0);
  // 4x USB 3.2 stacked jacks on edge
  const usbPorts = box(x1 - 18.0, x1 + 2.0, cy - 18.0, cy + 8.0, topZ, topZ + 16.0);
  // RJ45 Ethernet jack
  const ethPort = box(x1 - 21.0, x1 + 1.5, cy + 12.0, cy + 28.0, topZ, topZ + 14.0);
  // DisplayPort and DC barrel jack
  const dpPort = box(x1 - 16.0, x1 + 1.0, y0 + 6.0, y0 + 17.0, topZ, topZ + 7.5);
  const dcJack = box(x0 + 2.0, x0 + 15.0, y0 - 1.5, y0 + 9.0, topZ, topZ + 11.0);
  // 40-pin GPIO header
  const gpio = box(x0 + 15.0, x0 + 68.0, y1 - 5.5, y1 - 0.5, topZ, topZ + 8.5);

  return union([pcb, heatsink, usbPorts, ethPort, dpPort, dcJack, gpio]);
}

// -----------------------------------------------------------------------------------------
// 2. Expansion HATs & Shields
// -----------------------------------------------------------------------------------------

/**
 * Raspberry Pi Robotics HAT (65.0 x 56.0 x 12.0 mm)
 * Features: Matches Pi mounting holes, 8x 3-pin standard servo headers (GND, 5V, Signal),
 * 4x dual screw terminal blocks for DC motors, 2-pin power terminal, driver chips.
 */
export function rpiRoboticsHatSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 65.0, pcbD = 56.0, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const pcb = sub(
    rrect(pcbW, pcbD, 3.0, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 3.5, y0 + 3.5, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 61.5, y0 + 3.5, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 3.5, y0 + 52.5, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 61.5, y0 + 52.5, 1.35, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // 8x 3-pin servo headers in 2 rows of 4 along top edge
  const servoHeaders = box(x0 + 12.0, x1 - 12.0, y1 - 10.0, y1 - 2.0, topZ, topZ + 8.5);
  // 4x dual motor screw terminal blocks (green) along bottom & left edges
  const term1 = box(x0 + 8.0, x0 + 26.0, y0 + 1.0, y0 + 9.0, topZ, topZ + 9.5);
  const term2 = box(x0 + 30.0, x0 + 48.0, y0 + 1.0, y0 + 9.0, topZ, topZ + 9.5);
  const pwrTerm = box(x1 - 14.0, x1 - 2.0, y0 + 1.0, y0 + 9.0, topZ, topZ + 9.5);

  // Driver ICs (TB6612FNG and PCA9685)
  const ic1 = box(cx - 10.0, cx - 2.0, cy - 4.0, cy + 6.0, topZ, topZ + 1.8);
  const ic2 = box(cx + 2.0, cx + 10.0, cy - 4.0, cy + 6.0, topZ, topZ + 1.8);

  return union([pcb, servoHeaders, term1, term2, pwrTerm, ic1, ic2]);
}

/**
 * 16-Channel PWM Servo Shield (PCA9685) (54.0 x 54.0 x 11.0 mm)
 * Features: 16x 3-pin servo headers in color-coded rows, large electrolytic capacitor,
 * 2-pin screw terminal block for external servo power.
 */
export function servo16ShieldSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 54.0, pcbD = 54.0, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const pcb = sub(
    rrect(pcbW, pcbD, 2.5, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 3.0, y0 + 3.0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 3.0, y0 + 3.0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 3.0, y1 - 3.0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 3.0, y1 - 3.0, 1.35, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // 16x 3-pin servo headers (4 banks of 4)
  const headers = box(x0 + 6.0, x1 - 6.0, cy - 8.0, y1 - 6.0, topZ, topZ + 8.5);
  // Large cylindrical capacitor
  const cap = cylZ(x0 + 10.0, y0 + 12.0, 4.0, topZ, topZ + 11.5, 20);
  // Power terminal block (2-pin green)
  const pwrBlock = box(x1 - 16.0, x1 - 5.0, y0 + 4.0, y0 + 14.0, topZ, topZ + 9.5);
  // PCA9685 chip
  const chip = box(cx - 7.0, cx + 7.0, y0 + 8.0, y0 + 20.0, topZ, topZ + 1.8);

  return union([pcb, headers, cap, pwrBlock, chip]);
}

/**
 * Arduino Motor Shield L298P / Adafruit Motor Shield V2 (68.6 x 53.4 x 18.0 mm)
 * Features: Stacks directly on Arduino Uno, dual L298P / TB6612 H-bridge motor driver,
 * 4x DC motor screw terminals, external power terminal, buzzer, prototyping area.
 */
export function arduinoMotorShieldSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 68.6, pcbD = 53.4, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const pcb = sub(
    rrect(pcbW, pcbD, 2.5, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 14.0, y0 + 2.5, 1.6, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 15.3, y1 - 2.5, 1.6, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 2.5, y0 + 7.6, 1.6, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 2.5, y1 - 15.2, 1.6, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // Driver IC heat sink in center
  const heatsink = box(cx - 10.0, cx + 10.0, cy - 8.0, cy + 8.0, topZ, topZ + 12.0);

  // Motor screw terminal blocks (blue / green) on left edge (-X) and right edge (+X)
  const termL = box(x0 + 2.0, x0 + 11.0, cy - 14.0, cy + 14.0, topZ, topZ + 9.5);
  const termR = box(x1 - 11.0, x1 - 2.0, cy - 14.0, cy + 14.0, topZ, topZ + 9.5);
  // External power terminal block
  const pwrTerm = box(x0 + 2.0, x0 + 11.0, y0 + 4.0, y0 + 13.0, topZ, topZ + 9.5);

  // Stacking header socket strips along top and bottom edges
  const headerTop = box(x0 + 23.0, x1 - 3.0, y1 - 3.5, y1 - 1.0, topZ, topZ + 8.5);
  const headerBot = box(x0 + 25.0, x1 - 5.0, y0 + 1.0, y0 + 3.5, topZ, topZ + 8.5);

  return union([pcb, heatsink, termL, termR, pwrTerm, headerTop, headerBot]);
}

/**
 * Raspberry Pi Pico Robotics Board / Shield (65.0 x 56.0 x 12.0 mm)
 * Features: Central dual socket for Raspberry Pi Pico, 4x DC motor screw terminals,
 * 8x 3-pin servo headers, on/off slide switch, power terminal.
 */
export function picoRobotShieldSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 65.0, pcbD = 56.0, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const pcb = sub(
    rrect(pcbW, pcbD, 3.0, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 3.5, y0 + 3.5, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 3.5, y0 + 3.5, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + 3.5, y1 - 3.5, 1.35, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 3.5, y1 - 3.5, 1.35, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // Pico header socket pair in center
  const picoSocketL = box(cx - 10.0, cx - 7.5, cy - 24.0, cy + 24.0, topZ, topZ + 6.0);
  const picoSocketR = box(cx + 7.5, cx + 10.0, cy - 24.0, cy + 24.0, topZ, topZ + 6.0);

  // 8x 3-pin servo headers along top edge (+Y)
  const servoHeaders = box(x0 + 8.0, x1 - 8.0, y1 - 9.0, y1 - 2.0, topZ, topZ + 8.5);
  // 4x motor screw terminals along bottom edge (-Y)
  const motorTerms = box(x0 + 8.0, x1 - 8.0, y0 + 2.0, y0 + 9.5, topZ, topZ + 9.5);
  // Power switch
  const sw = box(x1 - 12.0, x1 - 3.0, cy - 4.0, cy + 6.0, topZ, topZ + 4.5);

  return union([pcb, picoSocketL, picoSocketR, servoHeaders, motorTerms, sw]);
}

// -----------------------------------------------------------------------------------------
// 3. Sensors, Displays & Motors
// -----------------------------------------------------------------------------------------

/**
 * HC-SR04 Ultrasonic Distance Sensor (45.0 x 20.0 x 15.0 mm)
 * Features: Blue PCB, dual aluminum ultrasonic transducer cylinders (T and R) with front grilles,
 * 4-pin header (VCC, Trig, Echo, GND), crystal oscillator.
 */
export function hcSr04Solid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 45.0, pcbD = 20.0, pcbT = 1.6;
  const pcb = rrect(pcbW, pcbD, 1.5, cx, cy, z0, z0 + pcbT);
  const topZ = z0 + pcbT;

  // Dual cylindrical ultrasonic transducers (Ø16.0 x 12.0 mm) spaced 26.0 mm apart
  const transL = cylZ(cx - 13.0, cy, 8.0, topZ, topZ + 12.0, 24);
  const transR = cylZ(cx + 13.0, cy, 8.0, topZ, topZ + 12.0, 24);

  // 4-pin right-angle header on bottom edge
  const header = box(cx - 5.0, cx + 5.0, cy - 10.0 - 4.0, cy - 10.0, topZ - 2.5, topZ + 2.5);
  // Metal crystal oscillator
  const crystal = box(cx - 1.5, cx + 1.5, cy - 3.0, cy + 3.0, topZ, topZ + 3.5);

  return union([pcb, transL, transR, header, crystal]);
}

/**
 * MPU-6050 6-DoF Gyro + Accelerometer IMU Module (20.5 x 15.6 x 3.0 mm)
 * Features: Blue PCB, 8-pin 2.54mm pitch header strip, 2x M3 mounting holes, QFN sensor chip.
 */
export function mpu6050Solid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 20.5, pcbD = 15.6, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  const pcb = sub(
    rrect(pcbW, pcbD, 1.2, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 2.8, y0 + 2.8, 1.5, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - 2.8, y0 + 2.8, 1.5, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // 8-pin header along top edge (+Y)
  const header = box(x0 + 1.0, x1 - 1.0, y1 - 3.0, y1 - 0.5, topZ, topZ + 8.5);
  // MPU-6050 4x4mm QFN sensor IC
  const sensorChip = box(cx - 2.0, cx + 2.0, cy - 2.0, cy + 2.0, topZ, topZ + 1.0);

  return union([pcb, header, sensorChip]);
}

/**
 * Raspberry Pi Camera Module V2 / V3 (25.0 x 24.0 x 9.0 mm)
 * Features: Green square PCB, Sony IMX219 image sensor, cylindrical lens barrel, 15-pin FFC ribbon socket,
 * 4x corner M2 mounting holes (pitch 21.0 x 12.5 mm).
 */
export function rpiCameraSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 25.0, pcbD = 24.0, pcbT = 1.2;
  const y0 = cy - pcbD / 2;

  // 4x corner M2 mounting holes
  const pcb = sub(
    rrect(pcbW, pcbD, 1.5, cx, cy, z0, z0 + pcbT),
    cylZ(cx - 10.5, cy - 6.25, 1.1, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(cx + 10.5, cy - 6.25, 1.1, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(cx - 10.5, cy + 6.25, 1.1, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(cx + 10.5, cy + 6.25, 1.1, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // Square camera module housing
  const camHousing = box(cx - 4.5, cx + 4.5, cy - 4.5, cy + 4.5, topZ, topZ + 3.0);
  // Cylindrical optical lens barrel
  const lens = cylZ(cx, cy, 3.5, topZ + 3.0, topZ + 7.5, 24);
  // 15-pin FFC ribbon connector socket on bottom edge (-Y)
  const ffcSocket = box(cx - 8.0, cx + 8.0, y0 + 1.0, y0 + 4.5, topZ, topZ + 2.5);

  return union([pcb, camHousing, lens, ffcSocket]);
}

/**
 * VL53L0X Time-of-Flight (ToF) Laser Distance Sensor (25.0 x 13.0 x 3.0 mm)
 * Features: Purple/blue PCB, miniature optical sensor package with emitter and receiver apertures, 6-pin header.
 */
export function vl53l0xSolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 25.0, pcbD = 13.0, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2;

  // PCB with 1x M3 mounting hole
  const pcb = sub(
    rrect(pcbW, pcbD, 1.2, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + 2.5, cy, 1.5, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // 6-pin 2.54mm header
  const header = box(x0 + 6.0, x1 - 1.5, y0 + 1.0, y0 + 3.5, topZ, topZ + 8.5);
  // Optical sensor package in center with twin apertures
  const sensor = box(cx - 2.5, cx + 2.5, cy - 2.0, cy + 2.0, topZ, topZ + 1.2);

  return union([pcb, header, sensor]);
}

/**
 * SSD1306 0.96" I2C OLED Display (27.0 x 27.0 x 4.0 mm)
 * Features: Square PCB with 4x M2 corner holes, dark glass OLED screen, 4-pin header.
 */
export function oledDisplaySolid(cx = 0, cy = 0, z0 = 0): M {
  const pcbW = 27.0, pcbD = 27.0, pcbT = 1.6;
  const x0 = cx - pcbW / 2, x1 = cx + pcbW / 2;
  const y0 = cy - pcbD / 2, y1 = cy + pcbD / 2;

  // 4x M2 holes on the common 23.5 x 23.8 pattern (see src/catalog/standard.ts)
  const hx = (pcbW - 23.5) / 2, hy = (pcbD - 23.8) / 2;
  const pcb = sub(
    rrect(pcbW, pcbD, 1.5, cx, cy, z0, z0 + pcbT),
    cylZ(x0 + hx, y0 + hy, 1.1, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - hx, y0 + hy, 1.1, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x0 + hx, y1 - hy, 1.1, z0 - 1, z0 + pcbT + 1, 16),
    cylZ(x1 - hx, y1 - hy, 1.1, z0 - 1, z0 + pcbT + 1, 16),
  );

  const topZ = z0 + pcbT;

  // Dark glossy OLED glass panel (25.0 x 14.0 x 1.8 mm)
  const glass = box(cx - 12.5, cx + 12.5, cy - 9.0, cy + 5.0, topZ, topZ + 1.8);
  // 4-pin header on top edge
  const header = box(cx - 5.0, cx + 5.0, y1 - 4.0, y1 - 1.0, topZ, topZ + 8.5);

  return union([pcb, glass, header]);
}

/**
 * GA12-N20 Micro Metal Gear Motor (24.0 x 12.0 x 10.0 mm)
 * Features: Brass rectangular spur gearbox, cylindrical DC motor canister, Ø3mm D-shaft.
 */
export function n20MotorSolid(cx = 0, cy = 0, z0 = 0): M {
  // Gearbox (12.0 x 10.0 x 9.0 mm)
  const gearbox = box(cx - 6.0, cx + 6.0, cy - 4.5, cy + 4.5, z0, z0 + 10.0);
  // DC motor cylindrical body behind gearbox (Ø12.0 x 15.0 mm)
  const motorBody = cylY(cx, z0 + 5.0, 6.0, cy - 19.5, cy - 4.5, 24);
  // D-shaft protruding forward (Ø3.0 x 10.0 mm with flat)
  const shaft = sub(
    cylY(cx, z0 + 5.0, 1.5, cy + 4.5, cy + 14.5, 20),
    box(cx - 2.0, cx + 2.0, cy + 4.5, cy + 15.0, z0 + 5.0 + 1.0, z0 + 8.0),
  );

  return union([gearbox, motorBody, shaft]);
}

/**
 * TT Yellow DC Gearbox Motor (70.0 x 22.0 x 18.0 mm)
 * Features: Signature yellow plastic gearbox housing, dual output slotted axles, motor canister.
 */
export function ttMotorSolid(cx = 0, cy = 0, z0 = 0): M {
  const gbW = 22.0, gbD = 40.0, gbH = 18.0;
  // Main yellow gearbox body
  const body = rrect(gbW, gbD, 3.0, cx, cy, z0, z0 + gbH);
  // Motor canister clamped to rear
  const motorCan = cylY(cx, z0 + gbH / 2, 10.0, cy - 30.0, cy - 10.0, 24);
  // Dual output slotted axles extending from left and right sides (Ø5.4 x 9.0 mm with flats)
  const axleL = cylX(cy + 8.0, z0 + gbH / 2, 2.7, cx - gbW / 2 - 9.0, cx - gbW / 2, 20);
  const axleR = cylX(cy + 8.0, z0 + gbH / 2, 2.7, cx + gbW / 2, cx + gbW / 2 + 9.0, 20);

  return union([body, motorCan, axleL, axleR]);
}

/**
 * 18650 Li-ion Battery (Single cell or 2S pack)
 */
export function bat18650Solid(cx = 0, cy = 0, z0 = 0, count: 1 | 2 = 1): M {
  const r = 9.25, len = 67.0;
  if (count === 1) {
    const cell = cylY(cx, z0 + r, r, cy - len / 2, cy + len / 2, 24);
    const button = cylY(cx, z0 + r, 3.0, cy + len / 2, cy + len / 2 + 1.5, 16);
    return union([cell, button]);
  } else {
    // 2S pack: 2 side-by-side cells
    const cell1 = cylY(cx - r, z0 + r, r, cy - len / 2, cy + len / 2, 24);
    const cell2 = cylY(cx + r, z0 + r, r, cy - len / 2, cy + len / 2, 24);
    const wrap = box(cx - 2 * r, cx + 2 * r, cy - len / 2 - 1.0, cy + len / 2 + 1.0, z0, z0 + 2 * r);
    return union([cell1, cell2, wrap]);
  }
}

// -----------------------------------------------------------------------------------------
// 3b. Voice-robot hardware (src/cad/voicecore.ts). All lie component side up (+z) inside [z0, z0 + catalog height].
// -----------------------------------------------------------------------------------------

/**
 * NVIDIA Jetson Nano B01 developer kit (100 x 80 x 29 mm): carrier with 4x M2.5 holes on 86 x 58, module + heatsink,
 * the whole I/O row (barrel, micro-USB, HDMI, DP, 2 USB 3.0 stacks, RJ45) along the -y edge, 40-pin header on +y.
 */
export function jetsonNanoSolid(cx = 0, cy = 0, z0 = 0): M {
  const w = 100, d = 80, t = 1.6;
  const x0 = cx - w / 2, y0 = cy - d / 2, y1 = cy + d / 2, top = z0 + t;
  const pcb = sub(rrect(w, d, 3, cx, cy, z0, top),
    ...[-1, 1].flatMap(sx => [-1, 1].map(sy => cylZ(cx + sx * 43, cy + sy * 29, 1.35, z0 - 1, top + 1, 16))));
  const module = box(cx - 35, cx + 35, cy - 12, cy + 23, top, top + 6.5);
  const heatsink = box(cx - 30, cx + 30, cy - 9, cy + 21, top + 6.5, z0 + 29);
  const io = [
    box(x0 + 4, x0 + 14, y0 - 2, y0 + 12, top, top + 11),       // DC barrel
    box(x0 + 17, x0 + 25, y0 - 1.5, y0 + 5, top, top + 3),       // micro-USB
    box(x0 + 28, x0 + 44, y0 - 1.5, y0 + 11, top, top + 6.5),    // HDMI + DP
    box(x0 + 47, x0 + 62, y0 - 2, y0 + 16, top, top + 16),       // USB 3.0 stack 1
    box(x0 + 64, x0 + 79, y0 - 2, y0 + 16, top, top + 16),       // USB 3.0 stack 2
    box(x0 + 81, x0 + 97, y0 - 2, y0 + 21, top, top + 13.5),     // RJ45
  ];
  const gpio = box(x0 + 20, x0 + 71, y1 - 6, y1 - 1, top, top + 8.5);
  return union([pcb, module, heatsink, ...io, gpio]);
}

/** SPI LCD module face up: back components, PCB, then the glass (round for the GC9A01). */
export function lcdSolid(catalogId: string, cx = 0, cy = 0, z0 = 0): M {
  const [w, d, h] = CATALOG[catalogId]?.size ?? [34, 50, 5];
  const round = !!CATALOG[catalogId]?.data.round;
  const pcb = rrect(w, d, 2, cx, cy, z0 + 1.2, z0 + 2.8);
  const back = box(cx - w / 2 + 4, cx + w / 2 - 4, cy - d / 2 + 3, cy - d / 2 + 9, z0, z0 + 1.21);   // header / driver parts
  const glass = round
    ? cylZ(cx, cy, (CATALOG[catalogId].data.activeD ?? Math.min(w, d) - 4) / 2 + 0.3, z0 + 2.79, z0 + h, 64)   // round glass = active area
    : box(cx - w / 2 + 0.5, cx + w / 2 - 0.5, cy - d / 2 + 2.5, cy + d / 2 - 0.5, z0 + 2.79, z0 + h);
  return union([pcb, back, glass]);
}

/** INMP441 breakout: round PCB with the bottom sound port (faces -z), chip and header pads on top. */
export function inmp441Solid(cx = 0, cy = 0, z0 = 0): M {
  const pcb = sub(cylZ(cx, cy, 7.25, z0, z0 + 1.2, 32), cylZ(cx, cy, 0.5, z0 - 1, z0 + 2, 12));
  const chip = box(cx - 2.1, cx + 2.1, cy - 1.9, cy + 1.9, z0 + 1.19, z0 + 2.2);
  const pads = box(cx - 7.6 / 2, cx + 7.6 / 2, cy + 3.2, cy + 5.6, z0 + 1.19, z0 + 3.2);
  return union([pcb, chip, pads]);
}

/** ReSpeaker 2-Mics Pi HAT: pHAT PCB, a mic at each end (facing up), 3.5 mm jack, JST speaker socket, button. */
export function respeakerSolid(cx = 0, cy = 0, z0 = 0): M {
  const w = 65, d = 30, t = 1.6, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, top = z0 + t;
  const pcb = sub(rrect(w, d, 3, cx, cy, z0, top),
    ...[[3.5, 3.5], [61.5, 3.5], [3.5, 26.5], [61.5, 26.5]].map(([u, v]) => cylZ(x0 + u, y0 + v, 1.35, z0 - 1, top + 1, 16)));
  const mics = [x0 + 5, x1 - 5].map(x => box(x - 1.75, x + 1.75, cy - 1.35, cy + 1.35, top, top + 1.1));
  const jack = box(x1 - 20, x1 - 8, y0 - 0.5, y0 + 6, top, top + 6);
  const jst = box(x0 + 12, x0 + 20, y0 + 0.5, y0 + 6.5, top, top + 6);
  const codec = box(cx - 3, cx + 3, cy - 3, cy + 3, top, top + 1);
  return union([pcb, ...mics, jack, jst, codec]);
}

/** MAX98357A breakout: purple PCB, the amp chip, header pads and the speaker screw terminal. */
export function max98357Solid(cx = 0, cy = 0, z0 = 0): M {
  const w = 17.8, d = 19.3;
  const pcb = rrect(w, d, 1, cx, cy, z0, z0 + 1.6);
  const chip = box(cx - 1.5, cx + 1.5, cy - 1.5, cy + 1.5, z0 + 1.6, z0 + 2.4);
  const terminal = box(cx - 4, cx + 4, cy + d / 2 - 7.5, cy + d / 2, z0 + 1.6, z0 + 6);
  return union([pcb, chip, terminal]);
}

// -----------------------------------------------------------------------------------------
// 4. Master 3D Component Solid & Color Dispatcher
// -----------------------------------------------------------------------------------------

/**
 * Procedural fallback for any component based on its catalog size and kind.
 * Accurately models the PCB, chip packages, and connector blocks.
 */
export function genericPcbSolid(size: [number, number, number], cx = 0, cy = 0, z0 = 0): M {
  const [w, d, h] = size;
  const pcbT = Math.min(1.6, h * 0.25);
  const pcb = rrect(w, d, Math.min(2.5, w * 0.1), cx, cy, z0, z0 + pcbT);
  const topZ = z0 + pcbT;

  // Central IC package
  const icW = Math.max(4.0, w * 0.35), icD = Math.max(4.0, d * 0.35);
  const ic = box(cx - icW / 2, cx + icW / 2, cy - icD / 2, cy + icD / 2, topZ, topZ + (h - pcbT) * 0.5);

  // Edge connector block
  const connW = Math.max(6.0, w * 0.45), connD = Math.max(4.0, d * 0.2);
  const conn = box(cx - connW / 2, cx + connW / 2, cy + d / 2 - connD, cy + d / 2, topZ, z0 + h);

  return union([pcb, ic, conn]);
}

/**
 * Returns an accurate procedural 3D solid model for ANY catalog component ID.
 */
export function getComponentSolid(catalogId: string, cx = 0, cy = 0, z0 = 0): M {
  const item = CATALOG[catalogId];
  const size = item?.size ?? [30, 30, 10];

  switch (catalogId) {
    case 'RPI-4B':
      return raspberryPiSolid(cx, cy, z0, false);
    case 'RPI-5':
      return raspberryPiSolid(cx, cy, z0, true);
    case 'RPI-ZERO-2W':
      return raspberryPiZeroSolid(cx, cy, z0);
    case 'RPI-PICO-W':
    case 'RPI-PICO':
      return raspberryPiPicoSolid(cx, cy, z0, true);
    case 'ESP32-DEV':
    case 'ESP32-WROOM':
      return esp32DevKitSolid(cx, cy, z0);
    case 'ESP32-S3-DEVKIT':
      return esp32S3DevKitSolid(cx, cy, z0);
    case 'MICROBIT-V2':
    case 'MICROBIT':
      return microbitSolid(cx, cy, z0);
    case 'XIAO-ESP32-C3':
    case 'XIAO-ESP32-S3':
      return seeedXiaoSolid(cx, cy, z0);
    case 'ARDUINO-UNO':
      return arduinoUnoSolid(cx, cy, z0);
    case 'ZHAOZHI-AI-CORE':
      return zhaozhiAiCoreSolid(cx, cy, z0);
    case 'JETSON-ORIN-NANO':
      return jetsonOrinNanoSolid(cx, cy, z0);
    case 'SHIELD-RPI-ROBOT':
      return rpiRoboticsHatSolid(cx, cy, z0);
    case 'SHIELD-ESP32-SERVO':
      return servo16ShieldSolid(cx, cy, z0);
    case 'SHIELD-ARDUINO-MOTOR':
      return arduinoMotorShieldSolid(cx, cy, z0);
    case 'SHIELD-PICO-ROBOT':
      return picoRobotShieldSolid(cx, cy, z0);
    case 'HC-SR04':
      return hcSr04Solid(cx, cy, z0);
    case 'OLED-SSD1306':
      return oledDisplaySolid(cx, cy, z0);
    case 'MPU-6050':
      return mpu6050Solid(cx, cy, z0);
    case 'RPI-CAMERA-V2':
    case 'RPI-CAMERA-V3':
      return rpiCameraSolid(cx, cy, z0);
    case 'VL53L0X-TOF':
      return vl53l0xSolid(cx, cy, z0);
    case 'N20-MOTOR':
      return n20MotorSolid(cx, cy, z0);
    case 'TT-MOTOR':
      return ttMotorSolid(cx, cy, z0);
    case 'BAT-18650-1S':
      return bat18650Solid(cx, cy, z0, 1);
    case 'BAT-18650-2S':
      return bat18650Solid(cx, cy, z0, 2);
    case 'JETSON-NANO':
      return jetsonNanoSolid(cx, cy, z0);
    case 'LCD-GC9A01-128':
    case 'LCD-ST7789-169':
    case 'LCD-ST7789-20':
      return lcdSolid(catalogId, cx, cy, z0);
    case 'MIC-INMP441':
      return inmp441Solid(cx, cy, z0);
    case 'RESPEAKER-2MIC-HAT':
      return respeakerSolid(cx, cy, z0);
    case 'AMP-MAX98357A':
      return max98357Solid(cx, cy, z0);
    case 'PCA9685-SERVO-16':
    case 'WAVESHARE-SERVO-HAT':
    case 'ADAFRUIT-SERVO-BONNET':
      return genericPcbSolid([size[0], size[1], Math.min(size[2], 11)], cx, cy, z0);
    default:
      return genericPcbSolid(size, cx, cy, z0);
  }
}

/**
 * Returns authentic realistic colors for each dev kit, shield, and component.
 */
export function getComponentColor(catalogId: string): string {
  switch (catalogId) {
    case 'RPI-4B':
    case 'RPI-5':
    case 'RPI-ZERO-2W':
    case 'RPI-PICO-W':
    case 'RPI-CAMERA-V2':
    case 'RPI-CAMERA-V3':
      return '#2e7d32'; // Signature Raspberry Pi green
    case 'ARDUINO-UNO':
      return '#00979c'; // Signature Arduino teal
    case 'ESP32-DEV':
    case 'ESP32-S3-DEVKIT':
    case 'MICROBIT-V2':
    case 'MICROBIT':
    case 'ZHAOZHI-AI-CORE':
    case 'XIAO-ESP32-S3':
    case 'JETSON-ORIN-NANO':
    case 'JETSON-NANO':
      return '#1c1917'; // Matte black
    case 'LCD-GC9A01-128':
    case 'LCD-ST7789-169':
    case 'LCD-ST7789-20':
      return '#0b1220'; // Display glass
    case 'AMP-MAX98357A':
      return '#6d28d9'; // Adafruit purple
    case 'MIC-INMP441':
    case 'RESPEAKER-2MIC-HAT':
    case 'WAVESHARE-SERVO-HAT':
    case 'ADAFRUIT-SERVO-BONNET':
    case 'BUS-SERVO-ADAPTER':
    case 'PCA9685-SERVO-16':
      return '#1565c0';
    case 'BUCK-5V-5A':
    case 'UPS-HAT-PI':
      return '#14532d';
    case 'HC-SR04':
    case 'OLED-SSD1306':
    case 'MPU-6050':
    case 'SHIELD-RPI-ROBOT':
    case 'SHIELD-ESP32-SERVO':
    case 'SHIELD-ARDUINO-MOTOR':
    case 'SHIELD-PICO-ROBOT':
      return '#1565c0'; // Sensor / shield blue
    case 'VL53L0X-TOF':
      return '#6d28d9'; // Pololu / ST purple
    case 'TT-MOTOR':
      return '#fbc02d'; // Signature TT motor yellow
    case 'N20-MOTOR':
      return '#d97706'; // N20 brass gearbox
    case 'BAT-18650-1S':
    case 'BAT-18650-2S':
      return '#0284c7'; // 18650 blue shrink wrap
    default:
      return '#334155';
  }
}
