// AI design endpoint: natural-language prompt (+ current design + check results) -> RobotSpec JSON.
// Used by the Vite dev server (vite.config.ts) and the production server (server/prod.mjs).
// Three providers, chosen from the environment (the browser never sees a key):
//   Meta Muse META_API_KEY / MODEL_API_KEY / MUSE_API_KEY, model META_MODEL / MUSE_MODEL (default muse-spark-1.3-contributor),
//             retried (META_TRIES, default 3) on overload/quota/timeout; META_FALLBACK_MODELS only if set
//   Gemini    GEMINI_API_KEY (or GOOGLE_API_KEY), model GEMINI_MODEL (default gemini-3.6-flash),
//             falling back to GEMINI_FALLBACK_MODELS (default gemini-3.5-flash-lite) on overload/quota/timeout
//   Anthropic ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login`, model CYBERBUILD_MODEL
// CYBERBUILD_PROVIDER=meta|gemini|anthropic forces one. Keys can also live in .env.local (git-ignored).

import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { ApiError, GoogleGenAI } from '@google/genai';
import { searchDesignReferences, searchVisualReferences } from './search.mjs';

// Re-read .env.local whenever it changes, so a newly pasted key works without restarting the server.
const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
let envStamp = 0;
const shellEnv = new Set(Object.keys(process.env));
export function loadEnv() {
  let t = 0;
  try { t = statSync(envFile).mtimeMs; } catch { return; }
  if (t === envStamp) return;
  envStamp = t;
  // variables set in the real environment win over the file (dotenv convention)
  for (const [k, v] of Object.entries(parseEnv(readFileSync(envFile, 'utf8')))) if (!shellEnv.has(k)) process.env[k] = v;
  anthropic = gemini = undefined;   // rebuild clients with the new keys
}

function detectKeyProvider(key) {
  if (!key) return null;
  const k = key.trim();
  if (k.startsWith('AIzaSy')) return 'gemini';
  if (k.startsWith('sk-ant-')) return 'anthropic';
  return 'meta';
}

const rawAiKey = () => process.env.AI_API_KEY;

export const metaKey = () =>
  process.env.META_API_KEY ||
  process.env.MODEL_API_KEY ||
  process.env.MUSE_API_KEY ||
  (process.env.CYBERBUILD_PROVIDER === 'meta' || detectKeyProvider(rawAiKey()) === 'meta' ? rawAiKey() : undefined);

export const geminiKey = () =>
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  (process.env.CYBERBUILD_PROVIDER === 'gemini' || detectKeyProvider(rawAiKey()) === 'gemini' ? rawAiKey() : undefined);

export function provider() {
  const forced = process.env.CYBERBUILD_PROVIDER;
  if (forced === 'meta' || forced === 'gemini' || forced === 'anthropic') return forced;
  if (metaKey()) return 'meta';
  if (geminiKey()) return 'gemini';
  return 'anthropic';
}

export const modelFor = p => {
  if (p === 'meta') return process.env.META_MODEL || process.env.MUSE_MODEL || 'muse-spark-1.3-contributor';
  if (p === 'gemini') return process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  return process.env.CYBERBUILD_MODEL || 'claude-opus-5-5';
};

export function getInventoryStats(inventory) {
  if (!inventory || typeof inventory !== 'object' || Object.keys(inventory).length === 0) return null;
  let servos = 0, motors = 0, leds = 0, controllers = 0, batteries = 0, speakers = 0, hardware = 0;
  for (const [id, count] of Object.entries(inventory)) {
    const qty = Math.max(0, Math.floor(Number(count) || 0));
    if (qty <= 0) continue;
    if (id.includes('SERVO') || id === 'B-PG001' || id === 'B-PG002') servos += qty;
    else if (id.includes('MOTOR') || id === 'B-GM001') motors += qty;
    else if (id.includes('LED') || id === 'B-KB003') leds += qty;
    else if (id.includes('CORE') || id.includes('RPI') || id.includes('ESP32') || id.includes('JETSON') || id === 'B-XA003') controllers += qty;
    else if (id.includes('BAT') || id === 'B-PC003') batteries += qty;
    else if (id.includes('SPK') || id.includes('SPEAKER') || id === 'ZHAOZHI-SPEAKER-MOD') speakers += qty;
    else if (id.includes('MAG')) hardware += qty;
  }
  return { servos, motors, leds, controllers, batteries, speakers, hardware };
}

// "Use any parts" mode: the user buys what the directory lacks. It rides on the inventory object as __buyMissing (the
// catalog lines the AI may choose from), so every prompt and limit check that gets the inventory sees it.
const BUY = '__buyMissing';
export const buyMode = inv => !!(inv && Array.isArray(inv[BUY]));
export function withBuyMode(inventory, body) {
  if (!body?.buyMissing) return inventory;
  const lines = (Array.isArray(body.buyCatalog) ? body.buyCatalog : []).filter(s => typeof s === 'string').slice(0, 250).map(s => s.slice(0, 160));
  return { ...(inventory ?? {}), [BUY]: lines };
}

export function checkPromptKitLimits(prompt, kitCount = 1, inventory) {
  if (buyMode(inventory)) return null;              // missing parts get bought
  const p = String(prompt || '').toLowerCase();
  const k = Math.max(1, Math.floor(Number(kitCount) || 1));
  const stats = getInventoryStats(inventory);
  const isCustom = stats !== null;

  const maxServos = isCustom ? stats.servos : 4 * k;
  const maxMotors = isCustom ? stats.motors : 2 * k;
  const maxLeds = isCustom ? stats.leds : 6 * k;
  const maxControllers = isCustom ? stats.controllers : 1 * k;
  const maxBatteries = isCustom ? stats.batteries : 1 * k;

  // Check humanoid with arms on insufficient kits
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

export const getSystemPrompt = (kitCount = 1, inventory) => {
  const k = Math.max(1, Math.floor(Number(kitCount) || 1));
  const stats = getInventoryStats(inventory);

  let inventorySection = '';
  if (inventory && typeof inventory === 'object') {
    const items = Object.entries(inventory)
      .filter(([_, qty]) => Number(qty) > 0)
      .map(([id, qty]) => `* ${qty}x ${id}`);
    if (items.length > 0) {
      inventorySection = `\n# User Available Component Directory & Quantities
The user has configured their available component stock:
${items.join('\n')}
(Available Stock Totals: ${stats.servos} servos, ${stats.motors} motors, ${stats.leds} LEDs, ${stats.controllers} controllers/SBCs, ${stats.batteries} batteries, ${stats.speakers} speakers, ${stats.hardware} magnets/hardware)

CRITICAL DIRECTORY FREEDOM & CONSTRAINTS:
1. FREE COMPONENT SELECTION: You are NOT constrained to fixed kits. You have COMPLETE FREEDOM to choose, combine, and configure ANY available components from the user's directory to fulfill their request.
${buyMode(inventory) ? '2. STOCK IS A STARTING POINT: the user buys whatever is missing (see "Use any parts" below).' : '2. STRICT COMPONENT LIMITS: You must ONLY use components that exist in the directory with quantity > 0. Do NOT exceed the available count for any component.'}
3. ADAPTIVE COMPONENT MAPPING:
   - When the user asks for a feature (e.g. phone stand with magnets, voice assistant speaker, custom controller), freely select matching components from their directory.
   - For example, if the directory contains Neodymium disc magnets (MAG-N52-10X2) and the user wants a magnetic phone mount, configure mountType: "phone_stand" and hasMagnetPockets: true.\n`;
    }
    if (Number(inventory['LICHEERV-NANO-W']) > 0 && !(Number(inventory['B-XA003']) > 0)) {
      inventorySection += `
# Platform: Sipeed LicheeRV Claw kit (LicheeRV Nano W + PicoClaw board)
The electronics are NOT CyberBrick. The Claw module (Nano + PicoClaw board with its OWN built-in battery and speaker,
about 36 x 20 x 46 mm in its frame) is the robot's HEAD: its 240x240 LCD is the face, facing forward. It runs a Linux
Python app. Never add a separate battery or speaker for it.
- WITHOUT servos (composition with joints: [], mobility "none") there is NO base at all: the body stands on the desk on its own flat
  bottom and holds the module as its face. Design the body as the whole object (a pet, a statue, a letter, a lamp
  character), at least ~45 x 30 x 55 mm so the module fits inside.
- WITH servos, the base / body also carries the PCA9685 and a separate battery pack that powers only the servos.
- Robots with a head (companion pan-tilt, humanoid, quadruped, snake, rover with pan-tilt) carry the module as the
  face automatically. In a composition, name the head joint "head" (shape at least ~40 x 30 x 50 mm) or the body
  becomes the face; never put a joint on the front (+y) of the part that carries the face.
- Machines without a head (arm, turntable, lever, rotor, linear, scara) get a rear console with the screen instead.
- There are NO DC motors and NO addressable LEDs (set leds: 0, never use B-GM001; rovers use B-PG002).
- Servos exist only if the directory has a PCA9685-SERVO-16 board and servos; use at most that many joints.
  With no servos, design a static desk object whose personality comes from the screen (composition with joints: []).
- It CAN walk: a composition with mobility "legs" puts it on two 4-DOF legs (8 more servos on the PCA9685), with the Claw
  screen as the face of a "head" joint: the way to build MicroDuck / Open Duck / BD-X style bipeds (see "mobility legs").
- It CAN drive around: a composition with mobility "wheels" puts the body (on its neck) over the 2-wheel rover chassis:
  two continuous servos (FS90R / B-PG002) on the PCA9685 drive the wheels (S1/S2, joints from S3), a servo battery
  sits in the chassis bay, a front skid. Needs a PCA9685-SERVO-16 and 2 continuous servos in the directory. Two
  wheels only on this kit (4 wheels asked for: 2 + skid, say so; 4 wheels or N20 motors need a XiaoZhi / Raspberry Pi /
  Jetson board), no DC gear motors here (use continuous servos).\n`;
    }
    const has = id => Number(inventory[id]) > 0;
    const voiceBoard = !has('B-XA003') && !has('LICHEERV-NANO-W') &&
      (['ZHAOZHI-AI-CORE', 'ESP32-S3-DEVKIT', 'XIAO-ESP32-S3'].some(has) ? 'XiaoZhi / ESP32-S3 (MicroPython)'
        : ['JETSON-ORIN-NANO', 'JETSON-NANO'].some(has) ? 'NVIDIA Jetson (Linux)'
        : ['RPI-5', 'RPI-4B', 'RPI-ZERO-2W'].some(has) ? 'Raspberry Pi (Linux)' : '');
    if (voiceBoard) {
      inventorySection += `
# Platform: ${voiceBoard} voice robot
The electronics are NOT CyberBrick: a ${voiceBoard} board with a mic and a speaker (and a display if the directory has
one). PICOCEO Builder places them as a voice core INSIDE the body (always a composition, no CyberBrick base): the body
stands on its own flat bottom, is printed hollow and opens at a magnet seam. The display, if any, is the face on the
front (+y) of the body or of a joint named "head".
- Size the body for the core: an ESP32-S3 core needs about 60 x 45 x 60 mm, a Raspberry Pi about 100 x 75 x 70 mm, a
  Jetson about 120 x 100 x 80 mm. Never put a joint on the front of the part that carries the face.
- Servos only if the directory has servos and a servo board (PCA9685 / Servo HAT / bonnet, or a bus-servo adapter
  for ST3215); use at most that many joints. Set leds: 0 unless the directory has LEDs.
- It can DRIVE around: set composition mobility "wheels" and the body rides a drive plate on continuous servos
  (FS90R-class) on the same servo board. wheelCount 2 = two drive wheels and a front skid (default), 4 = four wheels
  steered like a tank (use it when the user asks for 4 wheels; the body needs a foot at least ~100 mm deep). Each
  wheel takes a servo channel after the joints, so joints + wheels must fit the servos and channels available.
  If the directory has GA12-N20 gear motors (N20-MOTOR), the wheels use them instead: the PCA9685 can't power a motor, so they run
  through an H-bridge module (DRV8833, or TB6612FNG) whose inputs take servo board channels (2 per side on the
  DRV8833, 3 on the TB6612; with 4 wheels each side's pair is wired in parallel). Select the motors AND the driver;
  if the driver is missing, say so in aiReasoning (the design still builds and asks the user to add one).
- The robot talks through the user's AI backbone (its brain); give it behaviours that suit a talking robot
  (nod, look, wave, dance, think, greet) and a personality in the summary.\n`;
    }
  }
  if (buyMode(inventory)) {
    inventorySection += `
# "Use any parts" mode: the user will BUY whatever is missing
The user switched on "use any parts". Fulfil EVERY feature they asked for: pick the components that do it best from
the catalog below, even when the directory above lacks them or has too few (rules above that say "only if the
directory has ..." become "add it to the parts list"). Do not leave features out or shrink the design for stock
reasons and never set refusalReason for missing stock. Keep the user's main board (the platform above) and list it.
Use exact catalog ids and the quantities the design needs; name in aiReasoning which parts are not in stock (they go on
a shopping list). Hardware limits still hold (servo headers, what a board can drive); if a feature needs another
board, say so instead of switching boards.
Catalog (id: name):
${inventory[BUY].map(l => `* ${l}`).join('\n')}\n`;
  }
  return `You are PICOCEO Builder's robot design engineer. You turn a user's request into a buildable robot made
from the user's electronics (Bambu Lab CyberBrick, Sipeed LicheeRV Claw, XiaoZhi ESP32-S3, Raspberry Pi or Jetson)
plus custom 3D-printed parts. PICOCEO Builder focuses on robots that TALK: a mic and a speaker (and a display face when
the idea wants one), driven by the user's AI backbone. Make the design a character people want to talk to.
${inventorySection}
# Hardware Component Reference Library
IMPORTANT: The hardware library provides SPECIFIC COMPONENT DESIGN REFERENCES ONLY (physical bounding envelopes,
mounting holes, interfaces, and electrical limits). The library is NOT a rigid menu of whole robot assemblies.
THE ENTIRE STRUCTURAL DESIGN, FORM FACTOR, BRACKETS, MOUNTS, AND FUNCTIONALITY ARE YOUR RESPONSIBILITY (Muse Spark).
Supported modular components include:
- Microcontrollers & Single Board Computers:
  * ESP32-C3 Core (B-XA003) & B-XA004 Shield
  * ESP32-WROOM-32 DevKit V1 & ESP32-S3
  * Seeed Studio XIAO ESP32-C3 / XIAO ESP32-S3 (Sense)
  * XiaoZhi / ZhaoZhi AI Voice Agent Core (ESP32-S3 + I2S Audio + Dual Mic)
  * Raspberry Pi 4 Model B / Raspberry Pi 5 / Raspberry Pi Zero 2 W
  * NVIDIA Jetson Orin Nano / Jetson Nano Developer Kit
- Actuators & Motors:
  * B-PG001 180° micro servo & B-PG002 continuous 360° servo
  * TowerPro SG90 9g Micro Servo (GS90) & MG90S Metal-Gear Micro Servo
  * B-GM001 030 geared motors & GA12-N20 Micro Metal Gear Motor
- Audio & Speakers:
  * XiaoZhi / ZhaoZhi AI Sound Chamber & Speaker Module
  * Cavity Mini Speaker 8Ω 2W (SPK-8OHM-2W) & Micro Speaker 8Ω 1W
- Power & Batteries:
  * 7.4V 2S Li-ion (B-PC003 & BAT-18650-2S)
  * Single 18650 Li-ion 3.7V 2600mAh & 3.7V 1000mAh LiPo pouch cells
- Reference Hardware & Fasteners:
  * Neodymium N52 Disc Magnets (MAG-N52-10X2 Ø10×2mm) & MagSafe magnetic ring array
  * M2, M2.5, M3 socket head screws and brass heat-set inserts

# 7-Step AI Robot Design Flow
You execute a disciplined 7-Step AI Design Flow for every user request:
- Step 1 (From idea to selection of components): Analyze the user's idea and select the optimal components (controllers, servos, motors, batteries, speakers, LEDs, magnets) strictly within the user's available Component Directory quantities.
- Step 2 (From idea and list of components to 3D layout, connecting components): Arrange the selected components in 3D space with balanced mass distribution, kinematic joint hierarchy, and valid electrical/signal port connections (S1-S6, M1-M2, D1 LED bus, power switch).
- Step 3 (3D printed parts and form the overall design based on idea): Synthesize the custom 3D-printed structural parts, brackets, shell morphology (headFeature, footStyle, hasTail, hasWings, mountType), structural materials (PETG/ABS/PA-CF), and theme colors (#rrggbb) to form a cohesive, smooth, watertight robot.
- Step 4 (Audit the design): Verify servo stall torque margin (≥ 1.5x gravity load), center-of-mass stability over the support footprint, screwdriver access, zero static/ROM collisions, and power rail budgets.
- Step 5 (Develop the simulation): Select and parameterize physical behaviors and gaits (walk, slither, patrol, square, spin, pick, wave, look, nod, listen, talk) for the Rapier3D physics engine.
- Step 6 (Firmware): Ensure actuator port assignments and LED counts align cleanly with embedded firmware generation.
- Step 7 (Overall audit and testing): Summarize the end-to-end engineering rationale, trade-offs, and verification readiness in your response.

# The Whole Design is YOUR Responsibility (Muse Spark)
You design the complete robot structure to fulfill the user's intent. 3D printing enables custom structural shapes,
angled backrests, brackets, recesses, magnet pockets, and cable routing directly into the printable parts.
- When the user asks for a functional robot (e.g. "create 2 wheel robot as phone stand holding by magnet", "desktop AI agent stand", "tablet companion", "inspection crawler", etc.):
  * YOU architect the overall machine (e.g. 2-wheeled mobile platform with integrated phone cradle, desk agent, etc.).
  * Configure params.mountType: "phone_stand" | "magnetic_mount" | "camera_mount" | "pan_tilt_head" | "tablet_stand" | "none".
  * Configure params.mountAngle: viewing angle in degrees (e.g. 60° to 75° from horizontal, default 65°).
  * Configure params.hasMagnetPockets: true (embeds press-fit pockets for standard Neodymium N52 magnets).
  * Configure params.hasCableSlot: true (includes bottom shelf cutout for USB-C / Lightning phone charging cable).
  * Configure params.cradleWidth (40-95 mm, default 56-64 mm) and params.cradleHeight (30-110 mm, default 56-68 mm).
- CRITICAL: DO NOT mark 3D-printable structural features (such as phone cradles, angled backrests, cable slots, or magnet pockets) as "outOfScope"! 3D printing fabricates them directly, and neodymium magnets are standard reference hardware.
- "outOfScope" is strictly for physically impossible requests (e.g. anti-gravity, flying without thrusters, true underwater waterproofing beyond FDM).

# STRICT INVENTORY CONSTRAINTS
- If the user's prompt requires more components than the available inventory for ${k} kit${k > 1 ? 's' : ''} (e.g. more than ${4 * k} servos/axes/degrees of freedom, more than ${2 * k} motors, more than ${6 * k} LEDs, or combining a rover and an arm when only 1 kit is available):
  DO NOT design a totally different robot model or silently drop the core user request!
  Instead, you MUST set "refusalReason" with a clear explanation stating exactly what parts are insufficient and how many kits are needed (e.g. "Insufficient components: A 6-axis arm requires 6 servos, but 1 kit only provides 4 servos. You need at least 2 kits.").

# Open & Unconstrained Design Freedom (Design ANYTHING from User Input)
You are NOT restricted or pigeonholed into fixed robot types (such as only 2-legged bipeds, 4-legged quadrupeds, or desktop robots).
The user can invent, describe, and request ANY machine, automation device, functional mechanism, vehicle, creature, or smart contraption imaginable:
1. Functional automation machines (dedicated mechanism builders; the archetype word picks the builder):
   a. Swing LEVER, 1 servo (archetypes "barrier_gate", "catapult", "flag_waver", "flipper", "drawbridge", "railway_crossing", "wiper", "hammer"):
      boom gates, turnstile arms, catapults/trebuchets, flag/sign wavers, pinball flippers, whack/strike hammers, wipers, metronomes.
      Params: leverTool ("boom" | "cup" for catapults | "flag" | "paddle" for flippers/hammers), leverLen 50-180 mm, pivotH 44-90 mm (pivot height above the deck).
   b. Continuous ROTOR, 1 continuous servo (archetypes "smart_fan", "windmill", "ferris_wheel", "paddle_wheel", "pet_feeder", "candy_dispenser", "sorter", "carousel"):
      fans, windmills/wind turbines, ferris/display wheels, water/paddle wheels, propeller displays; vertical compartment carousels for pet feeders, candy/pill dispensers and sorting trays.
      Params: rotorStyle ("fan" | "windmill" | "wheel" | "paddle" | "carousel"), rotorDia 60-140 mm, bladeCount 2-8 (blades, spokes, paddles or carousel cells).
   c. LINEAR rack-and-pinion axis, 1 servo (archetypes "camera_slider", "linear_actuator", "conveyor", "drawer_opener", "sliding_door", "lift", "elevator", "forklift"):
      camera sliders/dollies, linear actuators, shuttle conveyors, drawer/door/curtain openers (horizontal); lifts, elevators, forklift masts (vertical).
      Params: linearOrient ("horizontal" | "vertical"), linearTool ("table" | "fork" | "camera"), stroke 60-120 mm (rounded to the pinion: stroke ≈ π × pitch radius).
   d. "turntable": 360° rotating turntables / 3D-scanner stands.
   - Also: mountType ("none" | "phone_stand" | "magnetic_mount"), leds 1-6 (status LEDs).
2. Articulated machinery & kinetic mechanisms:
   - Covers: Industrial robot arms, 3-to-6 DOF serial arms, tower cranes, excavators, diggers, backhoes, loaders, grippers, claws, pick-and-place robots, adjustable desk lamp arms.
   - Archetypes: "arm", "crane", "excavator", "kinetic_sculpture"
   - Params: upperLen 45-100, foreLen 45-100, gripperLen 20-40 mm, payloadG 0-80 g.
   - SCARA / drawing robots / plotters / laser-pointer toys: archetype "scara_plotter" (2 servos on vertical axes, Ø10 pen holder); upperLen = link 1, foreLen = link 2 (45-100 mm each).
3. Wheeled platforms, vehicles & mobile machines:
   - Covers: Cars, racecars, sports cars, trucks, semi-trucks, monster trucks, buses, vans, ambulances, fire trucks, tractors, forklifts, bulldozers, tanks, armored vehicles, mars/lunar rovers, go-karts, phone-stand rovers, boats/watercraft.
   - Archetypes: "rover", "car", "boat", "tank", "truck", "forklift"
   - Params: drive ("B-PG002" continuous servos on S1/S2 default, or "B-GM001" motors), wheelDia 44-90 mm, wheelWidth 10-24 mm, tpuTires, bumper, panTilt.
BODY-PLAN RULE (most important for creatures): the legged builders below have FIXED bodies. "quadruped" always builds a
dog-shaped mammal (box torso, dog head, four straight legs with paws); "humanoid"/"duck"/"biped" build an upright two-legged
figure. Use them only when the subject really looks like that (dogs, cats, wolves, horses, robots, people, ducks, chickens).
A creature with a different body plan — frog, toad, turtle, crab, spider, scorpion, insect, beetle, fish, snail, octopus,
lizard, crocodile, whale, bat — must be a FREE-FORM COMPOSITION that reproduces its look (squat wide body, big eyes, legs as
features or joints), with mobility "wheels" when it should move around. When a reference image is attached, compare it with
the builder's fixed body before choosing: if they would not look alike, compose. Read the reference's STRUCTURE first and
match it part for part: how it moves (wheels / legs with knees / none), body proportions, a neck and how long, a separate
head and how big, where the screen or eyes are, then the colours (primary = the main shell colour, accent = the trim).
Then name each visible part's silhouette from the SHAPE LIBRARY (a CRT-TV head on a box body, a cat_head on an egg, a
cloud body, a mushroom lamp, a bell with a face) and copy its proportions as sizes; add ears, antennae, visors, cheeks,
handles and trim as features. Desk robots that talk are the focus: a screen face, a mic and a speaker, standing on
the desk; the screen sits on the front of the part the reference shows the face on.
4. Bipedal walking robots, birds & 2-legged creatures:
   - Covers: Waterfowl & birds (ducks, geese, chickens, penguins, owls, eagles, flamingos), biped animals/dinosaurs (kangaroos, T-Rex), anthropomorphic & fantasy characters (humans, robots, cyborgs, mechs, walkers, aliens, warriors).
   - Archetypes: "humanoid", "duck", "chicken", "biped", "walker"
   - Params: legLen 35-70 mm, footLen 35-65 mm, footWidth 22-38 mm, armLen 30-60 mm, hasArms boolean (true for arms with 2+ kits), headFeature ("beak" | "ears" | "visor" | "dome" | "none"), footStyle ("webbed" | "wide" | "standard"), hasTail boolean, hasWings boolean.
5. Quadruped robots & 4-legged animals / creatures:
   - Covers: Dogs, puppies, hounds, wolves, foxes, cats, lions, tigers, horses, cows, elephants, bears, turtles, lizards, dinosaurs, spiders/hexapods.
   - Archetypes: "quadruped", "dog", "cat", "spider", "hexapod"
   - Params: legLen 35-65 mm, footLen 25-45 mm, footWidth 18-32 mm, headFeature ("ears" | "none"), hasTail true, leds 2.
6. Companions, animatronics, turrets & stationary gadgets:
   - Covers: Smart speakers, desktop AI agents (XiaoZhi / ZhaoZhi), security cameras, CCTV, pan-tilt turrets, laser turrets, radars, desktop companions, animatronic heads, dancing figures, smart flower bots, phone/tablet stands, desktop lamps.
   - Archetypes: "companion", "desk_agent", "stationary"
   - Params: panTilt true, headWidth 36-60 mm, leds 2-6.
7. Serpentine, undulating & multi-segment creatures:
   - Covers: Snakes, serpents, vipers, cobras, pythons, earthworms, caterpillars, centipedes, dragons, eels, segmented trains.
   - Archetypes: "snake", "serpent", "dragon"
   - Params: leds 2, theme ("snake" | "viper" | "cobra" | "python" | "dragon").

# FREE-FORM COMPOSITION (for ideas the archetype builders above do not capture)
Archetype builders produce fixed body plans. When the user's idea has a different look or mechanism (a fish with a wagging
tail, a clock, a plant waterer, a waving hand, a flower that opens, a nodding bird statue, a talking mouth, a mascot, a toy,
an animal that does not walk, a kinetic sculpture), COMPOSE it: set composition.use = true and describe the shapes.
Use use = false only when one of the archetypes above genuinely matches the idea (then give composition any empty values:
mobility "none", body {shape "rounded_box", size [60,50,40]}, standH 20, joints [], features []). A plain rover / car / truck
with no character body is still archetype "rover"; a driving robot that should LOOK like something (animal, vehicle body,
character) is a composition with mobility "wheels".
How the composer builds (world axes at rest: x = right, y = FRONT, z = up, mm):
- mobility "none": a fixed 56 × 73 mm desk base (battery, ESP32 + shield, switch) with a neck of height standH holds the BODY.
- mobility "wheels" (the idea DRIVES around: a ladybug bot, a shark car, a duck on wheels, a robot pet that roams): the body
  rides the 2-wheel rover chassis (≈ 46 × 97 mm, wheels at the sides, skid at the front; set params.drive, wheelDia, wheelWidth,
  tpuTires, bumper as for a rover). The body is centred over the chassis with its centre standH above the deck, and the chassis,
  canopy and wheels are carved out of it, so a body larger than the chassis (e.g. 90-110 wide, 100-140 long, standH 0-15)
  becomes a shell with wheel arches; a small body is lifted on the neck automatically. Joint ports: with drive "B-PG002" the wheels use S1/S2, so at most 2 joints (S3,
  S4); with drive "B-GM001" (motor outputs M1/M2) all 4 joints are free. Behaviours: square, patrol, spin plus wave/look/dance.
- mobility "legs" (LicheeRV Claw kit; the idea WALKS on two legs: a MicroDuck / Open Duck / Disney BD-X style biped, a bird,
  a walking pet): the base becomes a pelvis on two 4-DOF legs (hip, knee and ankle pitch plus an ankle roll that leans the robot onto one foot to step, 8 servos on PCA9685 S1-S8, built for
  you: never compose legs as joints) with wide feet; the BODY sits on its neck above the pelvis and the joints (neck, head,
  wings) use S9+. A walker must not be top-heavy: the ankle micro servos hold the whole robot when it leans to step, so keep the
  head compact (≤ ~60 × 55 × 50) on a short neck and the body low (standH ≤ 10); a big screen head high on a long neck rocks over. For a long-necked duck / BD-X look: a small body (egg / rounded_box ~70 × 60 × 45, standH 0-10), joint
  "neck" (parent "body", face "+x", point "up", reach 40-55, capsule ~[12, 14, 50]) and joint "head" (parent "neck",
  face "+x", point "up", reach 25-35, a big rounded_box / egg head ~[60, 70, 45]); the Claw screen becomes the head's face and
  a nodding neck / head are centred on the body automatically. Add beak / eye-ring / cheek features to the head. Behaviours:
  walk (shuffle), bow, nod. Use legs (not the prebuilt humanoid) whenever the idea or the reference has knees, a neck or a
  separate head.
- Each JOINT is one servo (max 4 → ports S1-S4, in order). Its housing (≈ 34 × 18 × 22 mm) sinks into the parent behind the chosen
  face; the shaft points out of that face, so the joint ROTATES ABOUT THE FACE NORMAL. A Ø38 hub rides the horn 10 mm outside the
  face, and the member shape sits "reach" mm out in the "point" direction (point must be perpendicular to the shaft) or, with
  point "axis", centred on the shaft. A member can carry further joints (chains, e.g. arm → nozzle).
  * Side-to-side wag (tails, heads shaking, fans oscillating, sweeping arms): face "+z" (or "-z"), point back / front / left / right.
    A shape that lies beyond the body is lowered to body height on a strut automatically.
  * Up-down flap / nod / raise (wings, waving arms, jaws, eyelids, nodding heads, flags): face "+x" / "-x" (pitch) or "+y" / "-y" (roll), point up / down / front / back.
  * Spinning (clock hands, wheels, propellers, pinwheels): kind "spin", face toward the viewer (usually "+y"), point "axis" or "up".
- FEATURES are static shapes fused to the body or a member (fins, ears, beak, petals, pot, nozzle tip, hour marks). shape "led" puts an
  RGB LED eye on the parent's front (counts toward leds).
- Size shapes realistically for a desk robot (body 40-140 mm), keep members clear of their parent through their whole range, and
  prefer few joints with clear motions. The CAD checks (collisions through the range of motion, printability) are reported back.
- A member's size is in world axes at rest: make its longest dimension run along its "point" direction (a leg pointing
  "back" from a side face is long in y, e.g. [12, 50, 14], not [95, 40, 22]); a pair of left/right limbs is two joints or
  one member plus mirrored features, never one wide bar.
- Make it look like the idea, not like boxes. The SHAPE LIBRARY (any shape works for the body, a member or a feature;
  each fills the size you give it, so stretch it freely):
  * basics: box, rounded_box, cylinder, sphere, egg, capsule, cone, wedge, disc, fin (thin diamond), prism (A-frame)
  * domes / caps: dome (half sphere, flat bottom), arch (loaf / tunnel), arch_top (tombstone: box with a round top),
    helmet (dome with a brim), bowl (upside-down dome), saucer (UFO)
  * rings: torus (flat donut), hoop (upright ring), tube (open pipe)
  * turned profiles: frustum (lampshade), bell, vase, gumdrop, barrel, pear, teardrop, hourglass, spinning_top, acorn,
    mushroom, puck (rounded cylinder), drum (cylinder facing front), mug (with handle)
  * prisms / polyhedra: pyramid, trapezoid (tapered box), triangle, pent_prism, hex_prism, oct_prism, gem, crystal,
    chamfer_box, soft_cube (rounded on every edge), house (box + roof), lantern
  * desk-robot and character silhouettes: crt (old TV, flat front + tapered back), monitor (screen on a stand), cat_head
    (head with pointed ears), bear_head (round ears), bunny_head (long ears), ghost, cloud, blob (organic), bean, beak
    (points front), horn
  * flat cut-outs (drawn in the plane of the two larger sizes, the smallest size is the thickness): star, heart,
    crescent, cross, leaf, shield, wing, stadium (pill), semicircle, petal, bubble (speech bubble)
  Add the recognisable details as features (several capsule fingers instead of one block, eyes, ears, beak, fins,
  petals, a crossbar across an A) and use the accent colour for trim.
- SHELLS COVER THE ELECTRONICS: every shape is printed as a hollow 2.4 mm shell (an even inset of the shape itself,
  so concave shapes like cat_head, cloud, heart or ghost work too) that opens at a magnet seam. Pick the OUTER
  silhouette from the idea / the reference picture and let the composer put the parts inside: the Claw module, the
  voice core (board, battery, servo board) and the display / mic / speaker block go into the body or the head shell
  behind openings cut through it (screen window, mic hole, speaker grille), and a voice body grows (≤ 1.5×) until they
  fit. So never shrink the look to a plain box to make room: choose the reference's shape at a size that can hold the
  parts (Claw module 36 × 20 × 46 mm; XiaoZhi core ~60 × 45 × 60; Pi ~100 × 75 × 70), and put outer details (ears, visor,
  beak, antenna, cheek pads, a hat) as features on top. Features may overlap the shell and each other; openings for
  the screen, mic and speaker are cut through every feature in front of them, so a visor or frame never covers the screen.
- HOLES: a hole, cable hole, wire pass-through, vent, slot, socket or opening is a feature with "cut": true: its shape is cut OUT of
  the parent where it is (e.g. a cable hole through the top wall: shape "cylinder", size [8,8,20], at on the wall, cut true; a slot:
  "box"). Never model a hole as a ring, tube or pipe added on top: that adds material. Every other feature has "cut": false.
  Every joint already gets its own cable hole beside the servo (head to body wiring), so add holes only where the user asks.
- Every feature must touch its parent: "at" is the offset of the feature's centre from the parent's centre, so keep it within
  the parent's half-size plus half the feature's size (a feature placed in mid-air is pulled onto the parent).
- Electronics (LED eyes, the Claw face) go inside hollow shapes that open at a magnet-held seam: give the part that carries them
  a simple solid shape (box, rounded_box, sphere, egg, capsule, cylinder, prism) at least 40 mm in each direction, and keep
  servo joints off the middle of its sides.
Example — "robot fish that wags its tail": archetype "robot_fish", composition { use: true, mobility: "none", body: { shape: "egg", size: [50,110,55] },
standH 30, joints: [{ name: "tail", parent: "body", face: "+z", at: [0,-38], kind: "swing", range: [-35,35], point: "back", reach: 40,
shape: "fin", size: [4,40,44] }], features: [{ parent: "body", shape: "fin", size: [3,34,22], at: [0,-5,30], color: "accent" },
{ parent: "body", shape: "led", size: [6,6,3], at: [-12,0,8], color: "primary" }, { parent: "body", shape: "led", size: [6,6,3], at: [12,0,8], color: "primary" }] }.

The ONLY constraint is physical feasibility using the available components in the User's Component Directory (microcontrollers, servo motors, geared motors, batteries, power switches, RGB/white LEDs, speakers, and hardware screws/magnets).
As the directory expands in the future with new components, users will be able to create even more diverse mechanisms.
NEVER force or pigeonhole the design into an unrelated category (e.g. never force a turntable or feeder into a rover or humanoid).

# Custom Themes, Morphology & Aesthetics (AI-Controlled)
You have full creative freedom to design and style robots to match any theme, character, animal, or concept requested by the user:
- theme: string identifying the concept (e.g. "duck", "cat", "penguin", "retro", "steampunk", "cyberpunk", "classic").
- params.headFeature:
  * "beak": for birds, ducks, penguins, platypuses.
  * "ears": pointed ear pinnae for cats, foxes, canines.
  * "visor": robotic visor for androids or astronaut aesthetics.
  * "dome": rounded dome top.
  * "none": standard flat head visor.
- params.footStyle:
  * "webbed": tri-lobe webbed flipper sole with scalloped webbing (for ducks, waterfowl, frogs).
  * "wide": wide footprint for maximum balance and stability.
  * "standard": standard rectangular sole.
- params.hasTail: boolean (set true to add a sculpted upturned tail/stabilizer for animals or characters).
- params.hasWings: boolean (set true to add side contour wings/flippers for birds, ducks, penguins).
- primaryColor & accentColor: You must choose hex colors (#rrggbb) that physically reflect the theme (e.g. #ffd23f yellow body and #ff7a1a orange beak/feet for a duck; #202020 black and #ffffff white for a penguin; #ff7a1a ginger and #f4f4f4 white for a cat; #2bb673 green and #ffd23f yellow for a frog).
- Live web search reference insights may be provided in the user prompt: use them to choose morphology, proportions, and colors that accurately capture the requested subject.

Shared: leds 0-${6 * k}, structural material (PETG default; ABS/ASA for heat/outdoor; PA-CF for abuse; never PLA+ or
TPU for structure), shell material, primaryColor/accentColor as #rrggbb, a short name.
Parameters that don't apply to the chosen archetype or accessory are given defaults:
(mountType "none", mountAngle 65, hasMagnetPockets false, hasCableSlot true, cradleWidth 64, cradleHeight 68,
drive "B-PG002", wheelDia 60, wheelWidth 14, tpuTires true, bumper true, panTilt false, upperLen 65, foreLen 70, gripperLen 28,
payloadG 20, legLen 46, footLen 50, footWidth 28, armLen 42, hasArms false, leds 2, headWidth 44, theme "classic",
headFeature "none", footStyle "standard", hasTail false, hasWings false, leverLen 110, leverTool "boom", pivotH 50,
rotorStyle "fan", rotorDia 100, bladeCount 4, stroke 80, linearOrient "horizontal", linearTool "table").

# How to answer
- Pick the archetype and functional accessories that best serve the intent. Size parameters from the user's numbers; otherwise choose
  values that give the checks margin (servo torque ≥ ×1.5, stable centre of mass, current under the switch rating).
- The chat is a conversation about ONE design. When you get the current design, decide the intent: a follow-up such as
  "make it bigger", "change the colour", "add a tail", "fix the collision", "why is it tipping?" is intent "modify"; only a
  request for a different robot ("now design a crane", "start over with a dog") is "new". For "modify", change only what the
  request or a failed/warned check needs, keep name, archetype, composition and every other value identical, and answer
  questions in the rationale (returning the design unchanged if nothing should change).
- When you get the current design and its check results, change only what the request or a failed/warned check
  needs, and keep the rest identical. Checks marked "kit limit" come from the kit's own ratings: mention them,
  don't redesign around them. When a fix trades away something the user asked for (reach, speed, size), say so.
- rationale: 2-4 sentences in plain language explaining the main choices and trade-offs.
- assumptions: short bullet strings for anything you inferred. outOfScope: requested features that are physically impossible.
- refusalReason: if the requested robot cannot be built due to insufficient components in ${k} kit${k > 1 ? 's' : ''}, explain the refusal here; otherwise leave as empty string.`;
};

export const SYSTEM = getSystemPrompt(1);

export function validateKitLimits(design, kitCount = 1, inventory) {
  const k = Math.max(1, Math.floor(Number(kitCount) || 1));
  const stats = getInventoryStats(inventory);
  const maxLeds = stats ? stats.leds : 6 * k;
  if (!buyMode(inventory) && typeof design?.params?.leds === 'number' && design.params.leds > maxLeds) {
    return stats
      ? `Insufficient components: Design uses ${design.params.leds} LEDs, but your component directory only has ${maxLeds} LEDs. Please add more LEDs in the Component Directory.`
      : `Insufficient components: Design uses ${design.params.leds} LEDs, but ${k} kit${k > 1 ? 's only provide' : ' only provides'} ${maxLeds} LEDs. Please select at least ${Math.ceil(design.params.leds / 6)} kits.`;
  }
  if (design?.refusalReason && design.refusalReason.trim()) {
    return design.refusalReason.trim();
  }
  return null;
}

const NUM = { type: 'number' };
// Free-form composition (src/cad/composer.ts). Strict structured output needs every key required.
// the composer's shape library (src/design/spec.ts SHAPES, src/cad/shapes.ts); scripts/shapetest.ts keeps them equal
export const SHAPE_ENUM = [
  'box', 'rounded_box', 'cylinder', 'sphere', 'egg', 'capsule', 'cone', 'wedge', 'disc', 'fin', 'prism',
  'dome', 'arch', 'arch_top', 'helmet', 'bowl', 'saucer',
  'torus', 'hoop', 'tube',
  'frustum', 'bell', 'vase', 'gumdrop', 'barrel', 'pear', 'teardrop', 'hourglass', 'spinning_top', 'acorn', 'mushroom', 'puck', 'drum', 'mug',
  'pyramid', 'trapezoid', 'triangle', 'pent_prism', 'hex_prism', 'oct_prism', 'gem', 'crystal', 'chamfer_box', 'soft_cube', 'house', 'lantern',
  'crt', 'monitor', 'cat_head', 'bear_head', 'bunny_head', 'ghost', 'cloud', 'blob', 'bean', 'beak', 'horn',
  'star', 'heart', 'crescent', 'cross', 'leaf', 'shield', 'wing', 'stadium', 'semicircle', 'petal', 'bubble',
];
const VEC3 = { type: 'array', items: NUM, description: '[x, y, z] mm' };
const COMPOSITION = {
  type: 'object',
  additionalProperties: false,
  required: ['use', 'mobility', 'wheelCount', 'body', 'standH', 'joints', 'features'],
  description: 'Free-form composition. use=true when no dedicated archetype builder matches the idea; the CAD then builds exactly these shapes and joints.',
  properties: {
    use: { type: 'boolean' },
    mobility: { type: 'string', enum: ['none', 'wheels', 'legs'], description: 'wheels = the body rides a 2-wheel differential-drive chassis (params.drive, wheelDia, wheelWidth, tpuTires, bumper apply); on voice platforms a drive plate on continuous servos. legs (LicheeRV Claw) = a pelvis on two 4-DOF walking legs with ankle roll (built for you; joints S9+)' },
    wheelCount: { type: 'integer', enum: [2, 4], description: 'Voice platforms with mobility "wheels": 2 drive wheels + front skid, or 4 wheels steered like a tank. Otherwise 2.' },
    body: {
      type: 'object', additionalProperties: false, required: ['shape', 'size'],
      properties: { shape: { type: 'string', enum: SHAPE_ENUM }, size: { ...VEC3, description: '[width x, depth y, height z] mm, 8-160' } },
    },
    standH: { type: 'number', description: 'Neck height between the electronics deck and the body, 0-80 mm' },
    joints: {
      type: 'array', description: 'At most 4 (servo headers S1-S4), in order; a joint may hang off an earlier joint (chain).',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'parent', 'face', 'at', 'kind', 'range', 'point', 'reach', 'shape', 'size'],
        properties: {
          name: { type: 'string', description: 'snake_case id, e.g. tail, jaw, left_wing' },
          parent: { type: 'string', description: '"body" or the name of an earlier joint' },
          face: { type: 'string', enum: ['+x', '-x', '+y', '-y', '+z', '-z'], description: 'Face of the parent the servo shaft points out of; the joint rotates about this face normal' },
          at: { type: 'array', items: NUM, description: '[u, v] mm offset from that face centre (±x face: y,z; ±y face: x,z; ±z face: x,y)' },
          kind: { type: 'string', enum: ['swing', 'spin'], description: 'swing = positional servo with range; spin = continuous rotation' },
          range: { type: 'array', items: NUM, description: '[min, max] degrees for swing, within -90..90' },
          point: { type: 'string', enum: ['up', 'down', 'front', 'back', 'left', 'right', 'axis'], description: 'Direction the member extends at rest (must be perpendicular to the shaft), or axis = centred on the shaft (dials, wheels, propellers)' },
          reach: { type: 'number', description: 'Shaft to member-shape centre, mm' },
          shape: { type: 'string', enum: SHAPE_ENUM },
          size: { ...VEC3, description: '[x, y, z] mm of the member shape at rest' },
        },
      },
    },
    features: {
      type: 'array', description: 'Static decorations fused to a parent: ears, fins, beaks, eyes, pots, nozzles, hour marks. shape "led" = an RGB eye LED on the parent front. cut true = a HOLE cut out of the parent instead (cable hole, vent, slot, socket).',
      items: {
        type: 'object', additionalProperties: false, required: ['parent', 'shape', 'size', 'at', 'color', 'cut'],
        properties: {
          parent: { type: 'string', description: '"body" or a joint name' },
          shape: { type: 'string', enum: [...SHAPE_ENUM, 'led'] },
          size: VEC3,
          at: { ...VEC3, description: 'centre offset from the parent shape centre, mm' },
          color: { type: 'string', enum: ['primary', 'accent'] },
          cut: { type: 'boolean', description: 'true: a hole (the shape is subtracted from the parent where it is, e.g. a cylinder through the wall for a cable); false: a part added on top' },
        },
      },
    },
  },
};

/** Every behaviour id src/design/behaviors.ts can play (robots and mechanisms). */
const BEHAVIOR_IDS = ['square', 'patrol', 'spin', 'look', 'pick', 'wave', 'reach', 'nod', 'shake', 'walk', 'dance', 'bow',
  'listen', 'talk', 'think', 'greet', 'slither', 'coil', 'raise', 'launch', 'tap', 'pulse', 'index', 'slide', 'lift', 'scan', 'draw', 'sweep'];
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'name', 'archetype', 'theme', 'summary', 'rationale', 'params', 'composition', 'structural', 'shell', 'primaryColor', 'accentColor', 'behaviors', 'assumptions', 'outOfScope', 'refusalReason'],
  properties: {
    intent: { type: 'string', enum: ['modify', 'new'], description: 'With a current design: "modify" = the request changes, fixes, or asks about that design (keep everything not mentioned identical); "new" = the user wants a different robot. Without a current design: "new".' },
    composition: COMPOSITION,
    name: { type: 'string', description: 'Short robot name, max 24 characters' },
    archetype: { type: 'string', description: 'Descriptive open archetype matching user concept (e.g. turntable, pet_feeder, barrier_gate, catapult, smart_fan, windmill, ferris_wheel, camera_slider, lift, forklift, scara_plotter, crane, rover, arm, companion, humanoid, quadruped, snake, custom_machine)' },
    theme: { type: 'string', description: 'Theme or character inspiration (e.g. duck, cat, retro, classic)' },
    summary: { type: 'string', description: 'One sentence describing the robot' },
    rationale: { type: 'string' },
    params: {
      type: 'object',
      additionalProperties: false,
      required: [
        'theme', 'headFeature', 'footStyle', 'hasTail', 'hasWings',
        'mountType', 'mountAngle', 'hasMagnetPockets', 'hasCableSlot', 'cradleWidth', 'cradleHeight',
        'drive', 'wheelDia', 'wheelWidth', 'tpuTires', 'bumper', 'panTilt',
        'upperLen', 'foreLen', 'gripperLen', 'payloadG',
        'legLen', 'footLen', 'footWidth', 'armLen', 'hasArms',
        'leverLen', 'leverTool', 'pivotH', 'rotorStyle', 'rotorDia', 'bladeCount', 'stroke', 'linearOrient', 'linearTool',
        'leds', 'headWidth'
      ],
      properties: {
        theme: { type: 'string', description: 'Theme or character inspiration' },
        headFeature: { type: 'string', enum: ['none', 'beak', 'ears', 'visor', 'dome'], description: 'Aesthetic head morphology feature' },
        footStyle: { type: 'string', enum: ['standard', 'webbed', 'wide'], description: 'Foot morphology style' },
        hasTail: { type: 'boolean', description: 'Whether to add an upturned rear tail or stabilizer' },
        hasWings: { type: 'boolean', description: 'Whether to add side contour wings or flippers' },
        mountType: { type: 'string', enum: ['none', 'phone_stand', 'magnetic_mount', 'camera_mount', 'pan_tilt_head', 'tablet_stand', 'sensor_mount'], description: 'Functional mount or device cradle' },
        mountAngle: NUM,
        hasMagnetPockets: { type: 'boolean', description: 'Whether to embed press-fit neodymium magnet pockets' },
        hasCableSlot: { type: 'boolean', description: 'Whether to include bottom shelf notch for phone charging cable' },
        cradleWidth: NUM,
        cradleHeight: NUM,
        drive: { type: 'string', enum: ['B-PG002', 'B-GM001'] },
        wheelDia: NUM, wheelWidth: NUM, tpuTires: { type: 'boolean' }, bumper: { type: 'boolean' }, panTilt: { type: 'boolean' },
        upperLen: NUM, foreLen: NUM, gripperLen: NUM, payloadG: NUM,
        legLen: NUM, footLen: NUM, footWidth: NUM, armLen: NUM, hasArms: { type: 'boolean' },
        leverLen: NUM, leverTool: { type: 'string', enum: ['boom', 'cup', 'flag', 'paddle'] }, pivotH: NUM,
        rotorStyle: { type: 'string', enum: ['fan', 'windmill', 'wheel', 'paddle', 'carousel'] }, rotorDia: NUM, bladeCount: { type: 'integer' },
        stroke: NUM, linearOrient: { type: 'string', enum: ['horizontal', 'vertical'] }, linearTool: { type: 'string', enum: ['table', 'fork', 'camera'] },
        leds: { type: 'integer' }, headWidth: NUM,
      },
    },
    structural: { type: 'string', enum: ['PETG', 'ABS/ASA', 'PA-CF'] },
    shell: { type: 'string', enum: ['PLA+', 'PETG', 'ABS/ASA'] },
    primaryColor: { type: 'string', description: '#rrggbb' },
    accentColor: { type: 'string', description: '#rrggbb' },
    behaviors: { type: 'array', items: { type: 'string', enum: BEHAVIOR_IDS } },
    assumptions: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
    refusalReason: { type: 'string', description: 'If the request exceeds components in the kit, explain the refusal and required kits. Otherwise empty string.' },
  },
};

let anthropic, gemini;
const anthropicClient = () => (anthropic ??= new Anthropic());
export const geminiClient = () => (gemini ??= new GoogleGenAI({ apiKey: geminiKey(), ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}) }));

export const fail = (message, status, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function aiConfigured() {
  const p = provider();
  if (p === 'meta') return Boolean(metaKey());
  if (p === 'gemini') return Boolean(geminiKey());
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || process.env.CYBERBUILD_ASSUME_AI);
}

/** Build the alternating user/assistant turns sent to either provider. */
function buildMessages(body) {
  const prompt = String(body?.prompt ?? '').slice(0, 4000);
  if (!prompt.trim()) throw fail('empty prompt', 400);
  const history = Array.isArray(body?.history) ? body.history.slice(-8) : [];
  const messages = [];
  for (const h of history) {
    if ((h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim()) {
      if (messages.length && messages[messages.length - 1].role === h.role) messages[messages.length - 1].content += '\n\n' + h.text;
      else messages.push({ role: h.role, content: h.text.slice(0, 6000) });
    }
  }
  if (messages.length && messages[0].role !== 'user') messages.shift();
  let content = '';
  if (body?.current) content += `Current design:\n${JSON.stringify(body.current)}\n\n`;
  if (Array.isArray(body?.checks) && body.checks.length) content += `Check results for the current design:\n${body.checks.slice(0, 40).join('\n')}\n\n`;
  content += `Request: ${prompt}`;
  if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
  messages.push({ role: 'user', content });
  return messages;
}

const parse = text => {
  try { return JSON.parse(text); } catch { throw fail('The model returned invalid JSON.', 502); }
};

async function designAnthropic(messages, kitCount = 1, inventory) {
  const stream = anthropicClient().beta.messages.stream({
    model: modelFor('anthropic'),
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: getSystemPrompt(kitCount, inventory), cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages,
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw fail(`The model declined this request${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : '.'}`, 422);
  if (msg.stop_reason === 'max_tokens') throw fail('The design response was cut off (max_tokens).', 502);
  const design = parse(msg.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  const kitErr = validateKitLimits(design, kitCount, inventory);
  if (kitErr) throw fail(kitErr, 422);
  return { design, model: msg.model, usage: msg.usage };
}

// A model call gets up to 120 s (the primary model can need more than a minute for a design step); the fallbacks share
// what is left of 270 s, inside the function's 300 s limit.
const AI_BUDGET_MS = 270000;
const callTimeout = (deadline, env) => Math.max(5000, Math.min(Number(env || 120000), deadline - Date.now()));

/** Primary model first, then fallbacks for overload / quota / timeout (free-tier keys hit these often). */
export const geminiModels = () => [...new Set([modelFor('gemini'), ...(process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash-lite,gemini-3.8-flash').split(',').map(m => m.trim()).filter(Boolean)])];
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

async function designGemini(messages, kitCount = 1, inventory) {
  const tried = [];
  const deadline = Date.now() + AI_BUDGET_MS;
  for (const model of geminiModels()) {
    let r;
    try {
      r = await geminiClient().models.generateContent({
        model,
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        config: {
          systemInstruction: getSystemPrompt(kitCount, inventory), responseMimeType: 'application/json', responseJsonSchema: SCHEMA, maxOutputTokens: 16000,
          httpOptions: { timeout: callTimeout(deadline, process.env.GEMINI_TIMEOUT_MS) },
        },
      });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      const auth = e.status === 401 || e.status === 403 || /api key/i.test(e.message);
      if (auth) throw fail('Gemini rejected the API key.', 503, { auth });
      tried.push(`${model}: ${e.status}`);
      if (RETRYABLE.has(e.status)) continue;
      throw fail(`Gemini error ${e.status}: ${e.message.slice(0, 300)}`, e.status >= 500 ? 502 : e.status);
    }
    const block = r.promptFeedback?.blockReason;
    if (block) throw fail(`Gemini blocked this prompt (${block}).`, 422);
    const finish = r.candidates?.[0]?.finishReason;
    if (finish === 'MAX_TOKENS') throw fail('The design response was cut off (max tokens).', 502);
    if (finish && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finish)) throw fail(`Gemini stopped early (${finish}).`, 422);
    if (!r.text) throw fail('Gemini returned an empty response.', 502);
    const design = parse(r.text);
    const kitErr = validateKitLimits(design, kitCount, inventory);
    if (kitErr) throw fail(kitErr, 422);
    return { design, model: r.modelVersion || model, usage: r.usageMetadata, fallbackFrom: tried.length ? tried : undefined };
  }
  throw fail(`Gemini is overloaded or out of quota (${tried.join(', ')}). Try again shortly.`, 503);
}

/** Meta Model API (Muse models) via OpenAI-compatible endpoint */
const metaBaseUrl = () => (process.env.META_BASE_URL || process.env.MUSE_BASE_URL || 'https://api.meta.ai/v1').replace(/\/+$/, '');
// The primary model, retried (3 tries in all) on overload / quota / timeout: no quiet switch to a weaker model. Fallback
// models only when META_FALLBACK_MODELS names them.
const metaModels = () => [...Array(Number(process.env.META_TRIES || 3)).fill(modelFor('meta')),
  ...(process.env.META_FALLBACK_MODELS ?? '').split(',').map(m => m.trim()).filter(m => m && m !== modelFor('meta'))];

async function designMeta(messages, kitCount = 1, inventory) {
  const key = metaKey();
  if (!key) throw fail('No Meta Model API key configured.', 503, { auth: true });
  const tried = [];
  const metaMessages = [
    { role: 'system', content: getSystemPrompt(kitCount, inventory) },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];
  const deadline = Date.now() + AI_BUDGET_MS;
  for (const model of metaModels()) {
    let res;
    try {
      res = await fetch(`${metaBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: metaMessages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'robot_design',
              strict: true,
              schema: SCHEMA,
            },
          },
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(callTimeout(deadline, process.env.META_TIMEOUT_MS)),
      });
    } catch (e) {
      tried.push(`${model}: ${e?.name || 'Error'}`);
      continue;
    }

    if (!res.ok) {
      const auth = res.status === 401 || res.status === 403;
      if (auth) throw fail('Meta Model API rejected the API key.', 503, { auth });
      let errText = '';
      try {
        const errJson = await res.json();
        errText = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        errText = await res.text().catch(() => '');
      }
      tried.push(`${model}: ${res.status}`);
      if (RETRYABLE.has(res.status)) continue;
      throw fail(`Meta Model API error ${res.status}: ${errText.slice(0, 300)}`, res.status >= 500 ? 502 : res.status);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw fail('Meta Model API returned invalid response payload.', 502);
    }

    const choice = data.choices?.[0];
    if (!choice) throw fail('Meta Model API returned no choices.', 502);
    if (choice.finish_reason === 'length') throw fail('The design response was cut off (max tokens).', 502);
    if (choice.finish_reason === 'content_filter') throw fail('Meta Model API filtered this prompt.', 422);
    const text = choice.message?.content;
    if (!text) throw fail('Meta Model API returned an empty response.', 502);

    const design = parse(text);
    const kitErr = validateKitLimits(design, kitCount, inventory);
    if (kitErr) throw fail(kitErr, 422);

    return {
      design,
      model: data.model || model,
      usage: data.usage,
      fallbackFrom: tried.length ? tried : undefined,
    };
  }
  throw fail(`Meta Model API is overloaded or out of quota (${tried.join(', ')}). Try again shortly.`, 503);
}

/**
 * body: { prompt: string, current?: RobotSpec, checks?: string[], history?: {role:'user'|'assistant', text:string}[], kitCount?: number, inventory?: Record<string, number> }
 */
export async function design(body) {
  loadEnv();
  const kitCount = Math.max(1, Math.floor(Number(body?.kitCount) || 1));
  const inventory = withBuyMode(body?.inventory && typeof body.inventory === 'object' ? body.inventory : undefined, body);
  const infeasible = checkPromptKitLimits(body?.prompt, kitCount, inventory);
  if (infeasible) throw fail(infeasible, 422);

  const messages = buildMessages(body);

  // Search live web for references if applicable
  let search = null;
  try {
    search = await searchDesignReferences(body?.prompt);
    if (search && search.snippets?.length && messages.length) {
      const searchContent = `\n\n[Live Web Search Reference Insights for "${search.query}"]:\n${search.snippets.map(s => `* ${s}`).join('\n')}\n\nUse these real-world references to select morphology parameters (headFeature, footStyle, hasTail, hasWings) and color palette (#rrggbb) that physically capture the requested theme. Explain your choices in the rationale.`;
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content += searchContent;
      } else {
        messages.push({ role: 'user', content: searchContent.trim() });
      }
    }
  } catch {
    // Continue if search service is unreachable
  }

  const p = provider();
  const result = p === 'meta' ? await designMeta(messages, kitCount, inventory)
    : p === 'gemini' ? await designGemini(messages, kitCount, inventory)
    : await designAnthropic(messages, kitCount, inventory);

  return { ...result, search };
}

// ============================================================================
// 7-STEP AI-DRIVEN DESIGN PIPELINE (/api/design/step)
// Each of the 7 steps calls the AI model directly with a step-specific schema
// and system prompt so the AI model leads the engineering decisions at every stage.
// ============================================================================

const STEP_SCHEMAS = {
  1: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'archetype', 'theme', 'visualSubject', 'summary', 'aiReasoning', 'selectedComponents', 'refusalReason'],
    properties: {
      visualSubject: { type: 'string', description: 'The real-world thing whose LOOK the robot imitates, as a 1-3 word encyclopedia subject for a picture search (e.g. "frog", "ladybird beetle", "great white shark", "ferris wheel", "excavator"). Empty string for a plain functional robot with no look to imitate.' },
      name: { type: 'string', description: 'Short robot name, max 24 chars' },
      archetype: { type: 'string', description: 'Descriptive open archetype matching user concept (e.g. turntable, pet_feeder, barrier_gate, catapult, smart_fan, windmill, ferris_wheel, camera_slider, lift, forklift, scara_plotter, crane, rover, arm, companion, humanoid, quadruped, snake, custom_machine)' },
      theme: { type: 'string', description: 'Theme or character concept' },
      summary: { type: 'string', description: 'One-sentence functional summary of the robot' },
      aiReasoning: { type: 'string', description: 'AI lead engineer reasoning explaining how the user idea maps to these specific components from the Directory' },
      selectedComponents: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'qty', 'role'],
          properties: {
            id: { type: 'string', description: 'Catalog ID from user directory (e.g. B-XA003, B-PG002, SG90-SERVO, MAG-N52-10X2)' },
            name: { type: 'string' },
            qty: { type: 'integer' },
            role: { type: 'string', description: 'Specific mechanical/electrical role in this robot' },
          },
        },
      },
      refusalReason: { type: 'string', description: 'Empty string if everything fits. Otherwise one short line per feature left out of the closest buildable version ("Left out <feature>: <why>; <what to add>"). Refuses the whole design only when selectedComponents is empty.' },
    },
  },
  2: {
    type: 'object',
    additionalProperties: false,
    required: ['aiReasoning', 'overallDimensionsMm', 'envelopeShape', 'silhouetteSummary', 'designStyle', 'features'],
    properties: {
      aiReasoning: { type: 'string', description: 'AI lead engineer explanation of how the overall 3D shape and envelope are conceived directly from the user prompt' },
      overallDimensionsMm: {
        type: 'array',
        items: { type: 'number' },
        description: 'Initial target bounding box [width, depth, height] in mm (e.g. [96, 96, 42] for turntable, [110, 120, 60] for rover)'
      },
      envelopeShape: {
        type: 'string',
        enum: ['cylinder_platter', 'box_chassis', 'aerodynamic_wedge', 'articulated_arm', 'biped_torso', 'quadruped_frame', 'segmented_cylinder', 'custom_organic'],
        description: 'Primary geometric archetype of the overall 3D form'
      },
      silhouetteSummary: { type: 'string', description: 'Concise visual description of the 3D silhouette' },
      designStyle: { type: 'string', description: 'Industrial design language (e.g. Minimalist Studio, Rugged Off-road, Cybernetic)' },
      features: {
        type: 'array',
        items: { type: 'string' },
        description: 'Visual morphology features (e.g. anti-slip concentric grooves, chamfered base, low-profile cowl)'
      },
    },
  },
  3: {
    type: 'object',
    additionalProperties: false,
    required: ['aiReasoning', 'componentsFit', 'fitStatus', 'initialEnvelopeMm', 'adjustedEnvelopeMm', 'expansionDeltaMm', 'fitExplanation', 'spatialPlan', 'kinematicPlan', 'wiringPlan'],
    properties: {
      aiReasoning: { type: 'string', description: 'AI explanation of packaging all selected components into the 3D form, fit evaluation, and dimensional expansion if needed' },
      componentsFit: { type: 'boolean', description: 'True if all components fit inside the 3D envelope with adequate clearance' },
      fitStatus: { type: 'string', enum: ['perfect_fit', 'auto_expanded'], description: 'perfect_fit if fitted within initial Step 2 form; auto_expanded if 3D form was widened/enlarged' },
      initialEnvelopeMm: { type: 'array', items: { type: 'number' }, description: 'Initial [W, D, H] from Step 2' },
      adjustedEnvelopeMm: { type: 'array', items: { type: 'number' }, description: 'Final adjusted [W, D, H] in mm ensuring all components fit comfortably' },
      expansionDeltaMm: { type: 'array', items: { type: 'number' }, description: 'Dimensional expansion added [deltaW, deltaD, deltaH] in mm' },
      fitExplanation: { type: 'string', description: 'Explanation of how components fit, or why/how the 3D form was expanded (e.g. widened +14mm for LiPo battery & Core stack)' },
      spatialPlan: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['componentId', 'link', 'zone', 'coordsMm'],
          properties: {
            componentId: { type: 'string' },
            link: { type: 'string', description: 'Link ID (e.g. base, pan, tilt, leg_L, wheel_L)' },
            zone: { type: 'string', description: 'Placement zone and orientation reason' },
            coordsMm: { type: 'array', items: { type: 'number' }, description: '[X, Y, Z] mm target coordinates' },
          },
        },
      },
      kinematicPlan: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['jointName', 'parentLink', 'childLink', 'actuatorId', 'port', 'axis', 'rangeDeg'],
          properties: {
            jointName: { type: 'string' },
            parentLink: { type: 'string' },
            childLink: { type: 'string' },
            actuatorId: { type: 'string' },
            port: { type: 'string', description: 'Port name (S1..S6, M1..M2)' },
            axis: { type: 'string', description: 'Rotation axis (X-pitch, Y-roll, Z-yaw)' },
            rangeDeg: { type: 'string', description: 'Motion range e.g. -90..+90 deg or 360 continuous' },
          },
        },
      },
      wiringPlan: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to', 'port', 'notes'],
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            port: { type: 'string' },
            notes: { type: 'string' },
          },
        },
      },
    },
  },
  4: SCHEMA,
  5: {
    type: 'object',
    additionalProperties: false,
    required: ['aiReasoning', 'auditVerdict', 'findings', 'needsRefinement', 'refinedDesign'],
    properties: {
      aiReasoning: { type: 'string', description: 'AI lead audit analysis of CoM stability, servo torque margins, clearance, and printability' },
      auditVerdict: { type: 'string', enum: ['PASS', 'OPTIMIZED', 'NEEDS_ATTENTION'] },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['domain', 'status', 'analysis', 'actionTaken'],
          properties: {
            domain: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
            analysis: { type: 'string' },
            actionTaken: { type: 'string' },
          },
        },
      },
      needsRefinement: { type: 'boolean', description: 'True if the AI modified parameters to improve torque, stability, or stock compliance' },
      refinedDesign: SCHEMA,
    },
  },
  6: {
    type: 'object',
    additionalProperties: false,
    required: ['aiReasoning', 'behaviors', 'simulationScenarios', 'physicsNotes'],
    properties: {
      aiReasoning: { type: 'string', description: 'AI simulation architect explanation of control gaits, keyframe timing, and physics solver tuning' },
      behaviors: {
        type: 'array',
        items: { type: 'string', enum: BEHAVIOR_IDS },
      },
      simulationScenarios: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description', 'targetMetric'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            targetMetric: { type: 'string' },
          },
        },
      },
      physicsNotes: { type: 'string' },
    },
  },
  7: {
    type: 'object',
    additionalProperties: false,
    required: ['aiReasoning', 'controllerTarget', 'architectureSummary', 'aiModuleFilename', 'aiModuleCode'],
    properties: {
      aiReasoning: { type: 'string', description: 'AI embedded systems engineer explanation of PWM timers, I2S/GPIO routing, and safety watchdogs' },
      controllerTarget: { type: 'string' },
      architectureSummary: { type: 'string' },
      aiModuleFilename: { type: 'string', description: 'Filename for the AI custom behavior controller, e.g. ai_controller.py' },
      aiModuleCode: { type: 'string', description: 'Complete runnable MicroPython module implementing AI-designed autonomous routines and telemetry' },
    },
  },
  8: {
    type: 'object',
    additionalProperties: false,
    required: ['aiReasoning', 'readinessScore', 'verdict', 'executiveSummary', 'testEvaluations'],
    properties: {
      aiReasoning: { type: 'string', description: 'Final AI Chief Engineer sign-off across hardware, CAD, physics simulation, and firmware' },
      readinessScore: { type: 'integer', description: 'Overall readiness score 0-100' },
      verdict: { type: 'string', enum: ['READY', 'READY_WITH_WARNINGS', 'ACTION_REQUIRED'] },
      executiveSummary: { type: 'string', description: 'Concise 2-4 sentence summary presented to the user in chat' },
      testEvaluations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['suite', 'status', 'assessment'],
          properties: {
            suite: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
            assessment: { type: 'string' },
          },
        },
      },
    },
  },
};

function getStepSystemPrompt(step, inventory) {
  const basePrompt = getSystemPrompt(1, inventory);
  const stepInstructions = {
    1: `\n# CURRENT ACTIVE STAGE: STEP 1 — FROM IDEA TO SELECTION OF COMPONENTS
You are leading Step 1 of the 8-Step AI Design Flow.
Analyze the user's robot idea and select the exact hardware components and quantities from the User's Available Component Directory.
- Choose the optimal controller, servos/motors, battery, switch, LEDs, speakers, and hardware (such as Neodymium magnets if a magnetic mount/stand is requested).
- Name the visualSubject: the real thing whose appearance the robot imitates (a frog robot → "frog"; a ladybug rover → "ladybird beetle"). Reference pictures of it are searched and shown to the later steps.
- Never exceed the quantity available in the user's directory or what the selected electronics platform supports.
- When only PART of the idea is beyond the stock or the platform (wheels with no drive parts in stock, a servo with no servo
  board in the directory, more LEDs than available), DO NOT refuse: select the components for the closest buildable
  version (keep the character, the face, the voice, the colours) and write in refusalReason one short line per dropped
  feature, as "Left out <feature>: <why>; <what to add or switch to get it>". The design goes ahead without them.
  Wheels are buildable on every platform when the directory has the drive parts (CyberBrick motors / servos; on the
  LicheeRV Claw, XiaoZhi, Raspberry Pi or Jetson a servo board with continuous servos, or N20 motors + an H-bridge).
- Leave selectedComponents EMPTY only when nothing meaningful can be built; then refusalReason explains why.
- Provide clear engineering reasoning in aiReasoning explaining why each component was chosen.`,
    2: `\n# CURRENT ACTIVE STAGE: STEP 2 — OVERALL 3D FORM & CONCEPT ENVELOPE
You are leading Step 2 of the 8-Step AI Design Flow.
Based directly on the user's prompt and concept intent, synthesize the overall 3D physical form, industrial silhouette, envelope dimensions [width, depth, height], and styling language.
- Define the primary geometric envelope (e.g. cylinder platter for turntable, low aerodynamic chassis for rover, articulated frame for arm/quadruped/biped).
- Provide initial target envelope dimensions [W, D, H] in mm and signature visual styling features.`,
    3: `\n# CURRENT ACTIVE STAGE: STEP 3 — COMPONENT PACKAGING & 3D FIT OPTIMIZATION
You are leading Step 3 of the 8-Step AI Design Flow.
Take the selected hardware components from Step 1 and fit them into the 3D form conceived in Step 2.
- Perform a rigorous 3D packaging and FIT CHECK: Compare the total volume and envelope required by the internal components (ESP32-C3 Core, Shield, Battery, Servos, Switches, Screws) against the Step 2 3D form envelope.
- CRITICAL: If the components do NOT fit (or require more space for wire routing and screw bosses), YOU MUST ADJUST THE 3D FORM TO FIT (e.g. widen width, increase length, or raise height, setting expansionDeltaMm and adjustedEnvelopeMm).
- If the 3D form is adjusted, set fitStatus="auto_expanded" and explain in fitExplanation exactly how much width/length/height was added and why. If it fit cleanly without modification, set fitStatus="perfect_fit".
- Architect the 3D spatial layout, kinematic joint chain, and electrical/signal wiring connections.`,
    4: `\n# CURRENT ACTIVE STAGE: STEP 4 — 3D PRINTED PARTS & OVERALL DESIGN FORM
You are leading Step 4 of the 8-Step AI Design Flow.
Synthesize the complete 3D-printable robot specification (RobotSpec) that physically houses and connects the components from Step 1 & Step 3 into a cohesive, smooth 3D form matching the fitted envelope.
- MULTI-PART SCREW-TOGETHER ENCLOSURE PRINCIPLE: Never design open-backed heads or monolithic single-piece shells that trap electronics. All heads and electronics enclosures are engineered as multi-part screw-together shells (separate flat Electronics Mounting Deck + Head Front Face Shell + Head Rear Enclosure Shell + Head Top Crown Cover + separate accent Beak/Visor, or Head Front Shell + Head Top/Rear Cap with M2.5/M3 screw bosses). This gives 100% open access when mounting and wiring internal electronics and closes into a smooth, fully enclosed, beautiful 3D silhouette.
- Choose structural & shell materials, hex colors (#rrggbb), morphology features (headFeature, footStyle, hasTail, hasWings), functional mounts (mountType, mountAngle, hasMagnetPockets, hasCableSlot), and exact dimensional parameters.
- In 'rationale', explain how the multi-part 3D printed shells screw together to form a closed, easy-to-assemble design around the internal modules.`,
    5: `\n# CURRENT ACTIVE STAGE: STEP 5 — AUDIT THE DESIGN
You are leading Step 5 of the 8-Step AI Design Flow.
You are given the 3D CAD assembly and engineering check results from Step 4.
- Audit mechanical clearances, watertightness, screwdriver access, center-of-mass stability, servo torque margins (≥1.5x), and power budget.
- If any check warned or failed (and can be fixed by parameter tuning, such as shortening arm links, widening foot/wheel track, or adjusting LEDs), set needsRefinement=true and provide the improved spec in refinedDesign. Otherwise set needsRefinement=false and echo the current design in refinedDesign.`,
    6: `\n# CURRENT ACTIVE STAGE: STEP 6 — DEVELOP THE SIMULATION
You are leading Step 6 of the 8-Step AI Design Flow.
Design the Rapier3D rigid-body physics simulation behaviors and verification test scenarios for this robot.
- Select the active behaviors that best demonstrate the robot's capabilities.
- Define concrete simulation test scenarios (what motion is executed and what stability/speed/torque metric proves success).`,
    7: `\n# CURRENT ACTIVE STAGE: STEP 7 — FIRMWARE GENERATION
You are leading Step 7 of the 8-Step AI Design Flow.
Design and write the custom embedded MicroPython control module (ai_controller.py) for the selected microcontroller and pin map.
- Include port initialization, non-blocking keyframe interpolation or gait state machine, battery current/stall safety checks, and status LED feedback.`,
    8: `\n# CURRENT ACTIVE STAGE: STEP 8 — OVERALL AUDIT & TESTING SIGN-OFF
You are leading Step 8 of the 8-Step AI Design Flow.
Review the complete engineering record from Steps 1 through 7 and perform the final systems sign-off.
- Evaluate all verification suites (Component Stock, 3D Layout & Packaging, 2-Manifold 3D Printability, Engineering Audit, Physics Simulation, and Embedded Firmware).
- Compute the readinessScore (0-100), set the final verdict, and write a concise executiveSummary for the user.`,
  };
  return basePrompt + (stepInstructions[step] || '');
}

function parseImageInput(image) {
  if (!image || typeof image.dataUrl !== 'string' || !image.dataUrl.startsWith('data:')) return null;
  const match = image.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: image.mimeType || match[1] || 'image/png',
    base64: match[2],
    dataUrl: image.dataUrl,
    name: image.name || 'reference_image',
  };
}

export async function callAiWithSchema(systemPrompt, userContent, schema, schemaName, image) {
  const p = provider();
  const parsedImg = parseImageInput(image);

  if (p === 'meta') {
    const key = metaKey();
    if (!key) throw fail('No Meta Model API key configured.', 503, { auth: true });
    const tried = [];
    const userMsgContent = parsedImg
      ? [
          { type: 'text', text: userContent },
          { type: 'image_url', image_url: { url: parsedImg.dataUrl } },
        ]
      : userContent;

    const deadline = Date.now() + AI_BUDGET_MS;
    for (const model of metaModels()) {
      let res;
      try {
        res = await fetch(`${metaBaseUrl()}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMsgContent },
            ],
            response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(callTimeout(deadline, process.env.META_TIMEOUT_MS)),
        });
      } catch (e) {
        tried.push(`${model}: ${e?.name || 'Error'}`);
        continue;
      }
      if (!res.ok) {
        const auth = res.status === 401 || res.status === 403;
        if (auth) throw fail('Meta Model API rejected the API key.', 503, { auth });
        tried.push(`${model}: ${res.status}`);
        if (RETRYABLE.has(res.status)) continue;
        throw fail(`Meta Model API error ${res.status}`, res.status >= 500 ? 502 : res.status);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw fail('Meta Model API returned an empty response.', 502);
      return { data: parse(text), model: data.model || model, provider: 'meta' };
    }
    throw fail(`Meta Model API is overloaded (${tried.join(', ')}).`, 503);
  }

  if (p === 'gemini') {
    const tried = [];
    const parts = [{ text: userContent }];
    if (parsedImg) {
      parts.push({ inlineData: { mimeType: parsedImg.mimeType, data: parsedImg.base64 } });
    }
    const deadline = Date.now() + AI_BUDGET_MS;
    for (const model of geminiModels()) {
      let r;
      try {
        r = await geminiClient().models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            maxOutputTokens: 16000,
            httpOptions: { timeout: callTimeout(deadline, process.env.GEMINI_TIMEOUT_MS) },
          },
        });
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        const auth = e.status === 401 || e.status === 403 || /api key/i.test(e.message);
        if (auth) throw fail('Gemini rejected the API key.', 503, { auth });
        tried.push(`${model}: ${e.status}`);
        if (RETRYABLE.has(e.status)) continue;
        throw fail(`Gemini error ${e.status}`, e.status >= 500 ? 502 : e.status);
      }
      if (!r.text) throw fail('Gemini returned an empty response.', 502);
      return { data: parse(r.text), model: r.modelVersion || model, provider: 'gemini' };
    }
    throw fail(`Gemini is overloaded (${tried.join(', ')}).`, 503);
  }

  // Anthropic
  const anthropicContent = parsedImg
    ? [
        {
          type: 'image',
          source: { type: 'base64', media_type: parsedImg.mimeType, data: parsedImg.base64 },
        },
        { type: 'text', text: userContent },
      ]
    : userContent;

  const stream = anthropicClient().beta.messages.stream({
    model: modelFor('anthropic'),
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: anthropicContent }],
  });
  const msg = await stream.finalMessage();
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { data: parse(text), model: msg.model, provider: 'anthropic' };
}

export async function designStep(body) {
  loadEnv();
  const step = Number(body?.step) || 1;
  if (step < 1 || step > 8) throw fail('Invalid step number (must be 1..8)', 400);
  const prompt = String(body?.prompt ?? '').trim() || (body?.image ? 'Design a robot matching the attached reference design image.' : '');
  if (!prompt) throw fail('empty prompt', 400);
  const inventory = withBuyMode(body?.inventory && typeof body.inventory === 'object' ? body.inventory : undefined, body);
  const image = body?.image && typeof body.image === 'object' ? body.image : undefined;

  if (step === 1) {
    const infeasible = checkPromptKitLimits(prompt, 1, inventory);
    if (infeasible) throw fail(infeasible, 422);
  }

  let search = null;
  if (step === 1 || step === 2 || step === 4) {
    try {
      search = await searchDesignReferences(prompt);
    } catch { /* ignore */ }
  }

  const contextParts = [`User Idea / Request: ${prompt}`];
  if (image?.dataUrl) {
    contextParts.push(
      `[Reference Design Image Attached (${image.name || 'image'})]: Analyze the visual silhouette, proportions, head/limb morphology, functional features, and color palette (#rrggbb) in the attached reference image, and faithfully translate that visual concept into this step's engineering design.`,
    );
  }
  if (search?.snippets?.length) {
    contextParts.push(`Live Web Reference Insights for "${search.query}":\n${search.snippets.map(s => `* ${s}`).join('\n')}`);
  }
  if (body?.currentSpec) {
    contextParts.push(`Current RobotSpec JSON:\n${JSON.stringify(body.currentSpec)}`);
  }
  if (body?.previousSteps && Object.keys(body.previousSteps).length > 0) {
    contextParts.push(`Completed Previous AI Steps Context:\n${JSON.stringify(body.previousSteps)}`);
  }
  if (Array.isArray(body?.checks) && body.checks.length > 0) {
    contextParts.push(`Real CAD & Physics Check Results:\n${body.checks.join('\n')}`);
  }
  if (body?.asmSummary) {
    contextParts.push(`Built 3D CAD Assembly Summary:\n${JSON.stringify(body.asmSummary)}`);
  }

  const sysPrompt = getStepSystemPrompt(step, inventory);
  const schema = STEP_SCHEMAS[step];
  // Pass the reference image directly to vision-capable steps (Steps 1, 2, 3, 4, 8)
  const stepImage = [1, 2, 3, 4, 8].includes(step) ? image : undefined;
  const { data, model, provider: prov } = await callAiWithSchema(
    sysPrompt,
    contextParts.join('\n\n'),
    schema,
    `robot_design_step_${step}`,
    stepImage,
  );

  // A partly buildable idea goes ahead as the closest version: refusalReason then names what was left out and the
  // client shows it next to the design. Only an idea with nothing buildable (no components picked) stops here.
  if (step === 1 && data?.refusalReason && data.refusalReason.trim() && !(data.selectedComponents?.length > 0)) {
    throw fail(data.refusalReason.trim(), 422);
  }
  if (step === 3) {
    const kitErr = validateKitLimits(data, 1, inventory);
    if (kitErr) throw fail(kitErr, 422);
  }

  return { step, result: data, model, provider: prov, search };
}

export async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 15_000_000) throw fail('request too large', 413);
  }
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

/** Minimal JSON request handler shared by dev and prod servers. */
export async function handleApi(req, res) {
  const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
  loadEnv();
  // AI backbone: the robots' MCP endpoint and the browser's /api/backbone* routes (server/backbone.mjs)
  const path = (req.url || '').split('?')[0];
  if (path === '/api/mcp' || path === '/api/backbone' || path.startsWith('/api/backbone/')) {
    const { handleBackbone } = await import('./backbone.mjs');
    return handleBackbone(req, res);
  }
  if (req.url === '/api/health') return send(200, { ai: aiConfigured(), provider: provider(), model: modelFor(provider()) });
  if (req.url === '/api/references' && req.method === 'POST') {
    const body = await parseBody(req).catch(() => ({}));
    const refs = await searchVisualReferences(body?.subject);
    return send(refs ? 200 : 404, refs ?? { error: 'no visual references found' });
  }
  // SAM 3.1 on the reference picture: named parts + their measured layout (server/segment.mjs)
  if (req.url === '/api/segment' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { segmentReference } = await import('./segment.mjs');
      return send(200, await segmentReference({ key: metaKey(), image: body?.image, concepts: body?.concepts }));
    } catch (e) {
      const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 502;
      return send(status, { error: e?.message || String(e) });
    }
  }
  if (req.url === '/api/design/step' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      return send(200, await designStep(body));
    } catch (e) {
      const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 503;
      return send(status, { error: e?.message || String(e), auth: !!e?.auth || e instanceof Anthropic.AuthenticationError || /credential|api key|auth/i.test(String(e?.message)) });
    }
  }
  if (req.url === '/api/design' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      return send(200, await design(body));
    } catch (e) {
      const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 503;
      return send(status, { error: e?.message || String(e), auth: !!e?.auth || e instanceof Anthropic.AuthenticationError || /credential|api key|auth/i.test(String(e?.message)) });
    }
  }
  return send(404, { error: 'not found' });
}