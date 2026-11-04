# PICOCEO Builder Hardware Design Standard

How every catalog part is mounted or housed in printed (FDM) CAD. The data lives in
`src/catalog/standard.ts` (`STANDARD`, `standardFor`, `pocketFor`, `standardCoverage`, `DISCREPANCIES`);
fit and hole constants are in `src/catalog/rules.ts` (`FIT`, `HOLES`, `CLEARANCE`, `PROFILES`, `MATERIALS`, `CHECKLIST`).
`npx tsx scripts/standardtest.ts` (part of `npm test`) fails if a catalog id has no entry, a pocket is smaller than its
envelope, or a hole pattern does not fit the part.

**Authority:** *CyberBrick Robotics Hardware and 3D Design Guide* (the guide) for all B-* parts and all fit, hole,
tunnel, slicing, material and battery rules. Non-CyberBrick parts use published datasheet values where known; anything
else is marked `estimated`. Where the architecture doc disagrees with the guide, the guide wins (see Discrepancies).

**Frame:** envelope = catalog `size` [X, Y, Z]. Z is "up" (PCB component side, servo shaft); -z rests on the chassis.
Hole patterns lie on the `-z` face unless stated: a pair `a x b` is a rectangle centred on the face; `(u, v)` lists
are hole centres from the face's min corner. Keep-out depth = free distance (mm) in front of that face.

## 1. Universal rules (guide s.4-12)

### Fits (s.4)

| Fit | Allowance | Formula | Use |
|---|---|---|---|
| Journal (free spin) | +0.20 radial | Bore = Shaft + 0.40 | idler hubs, casters, pivots on plastic |
| Slide (rails, slots) | +0.15-0.25 per wall | Slot = Tongue + 0.40 | battery covers, cartridges, brackets |
| Push (removable) | +0.40 on size | Pocket = Part + 0.40 | servo pockets, PCB locators, battery bays |
| Press (permanent) | 0.00-0.05 interference | Hole = Pin + 0.05 | dowels, bushings, 683/688ZZ bearings |
| Magnet pocket | +0.20 | Ø4 x 2 -> Ø4.2 x 2.2 | N52 discs, CA capillary bond |
| Captive hex nut (DIN 934) | +0.10 AF, +0.20 depth | M3: 5.6 AF x 2.6 | nut stays without a wrench |

### Fastener holes (s.5)

| Thread | Clearance | Self-tap | Counterbore (depth) | Min wall | Driver tunnel |
|---|---|---|---|---|---|
| M2 | Ø2.30 | Ø1.70 | Ø4.2 (2.2) | 1.4 | Ø5.0 |
| M2.5 | Ø2.80 | Ø2.15 | Ø5.2 (2.8) | 1.8 | Ø6.5 |
| M3 | Ø3.40 | Ø2.60 | Ø6.2 (3.4) | 2.2 | Ø6.5 |
| M4 | Ø4.50 | Ø3.40 | Ø8.0 (4.4) | 2.8 | Ø8.0 |
| M1.6 *(not in guide, extrapolated)* | Ø1.9 | Ø1.3 | - | 1.2 | Ø5.0 |

### Tunnels, orientation, clearances

- Every internal fastener has a straight line-of-sight tunnel, **Ø6.5 min**, through all outer walls; the screw head should drop through it (s.6).
- Horizontal-shaft servos: never trap between closed bulkheads; two vertical ear pillars (front/rear), each with an outer Ø6.5 tunnel (s.6).
- Bending-load parts (stems, axles, pedestals, hinge knuckles) print **on their side**; Z layers carry only 40-55 % (s.7).
- Cross-clamp joint for masts / arms on thin roofs: tongue between two cheeks, **+0.30 per side**, M3 through-bolt into a captive nut, flange collar (s.10).
- Packing: **4.0 mm** insulation / cable-routing gap around packed components; rotating platter to lid **2.0 mm** (architecture doc).
- Supports only for overhangs > 50°; bearing bores and screw holes must print support-free (s.12).

### Slicing profiles (s.8)

| Profile key | Part | Layer | Walls | Infill |
|---|---|---|---|---|
| chassis | primary chassis base | 0.20 | 4 (1.6) | 25 % gyroid |
| motorMount | motor & gear mounts | 0.16 | 5 (2.0) | 45 % gyroid |
| cantilever | stems / stands (print on side) | 0.16 | 5 (2.0) | 40 % gyroid |
| wheel | rims & hubs | 0.16 | 4 (1.6) | 35 % gyroid |
| shell | decorative shells | 0.16 | 3 (1.2) | 15-20 % adaptive cubic |
| tire | TPU 95A tyres | 0.20 | 3 (1.2) | 15 % gyroid |

### Materials (s.9)

| Material | Tensile | HDT | Use |
|---|---|---|---|
| PETG | ~50 MPa | ~75 °C | **primary**: chassis, brackets, gears |
| PLA+ | ~58 MPa | ~55 °C | shells / brackets away from heat; **never motor mounts or snap-fits** |
| ABS/ASA | ~44 MPa | ~98 °C | outdoor, hot motors, UV |
| TPU 95A | flexible | ~60 °C | tyres, bumpers, shock mounts |
| PA-CF | ~95 MPa | ~150 °C | combat, high-ratio gears, grippers; conductive, keep off antennas |

Motors run 45-60 °C: motor mounts are PETG or ABS (or PA-CF), never PLA.

### Battery bay (s.11)

- Isolated envelope: no motor, servo ear or bulkhead inside the bay.
- Swell margin **+1.5 length, +1.0 width**; twin half-cylinder troughs **R = R_cell + 0.5** for 14500/18650 pairs.
- Finger lift-out reliefs **Ø18-24** on the left/right walls.
- Rear-wall wire egress slot **10 x 6** toward the switch.
- Rigid **2.8 mm** cross-strap, 2x M2.5 into bosses fully outside the bay: |X| >= half-width + **2.0**.

### Pre-print checklist (s.12)

1. Watertight mesh, no non-manifold edges or self-intersections.
2. Battery cavity and servo bays subtracted after all bosses are unified.
3. Ø6.5 line-of-sight tunnels for internal M2.5/M3 fasteners.
4. +0.20 radial on unpowered hubs over journals.
5. M3 nut pockets 5.60 AF.
6. Magnet pockets Ø4.20 for Ø4.00 magnets.
7. Bending-load parts sliced on their side.
8. Min 4 perimeter walls (1.6 mm) on structural parts.
9. Supports only > 50°; bores and screw holes support-free.
10. PETG or ABS for motor mounts and structural chassis.

## 2. Per-component standard

Every catalog id (47). Pocket = envelope + 0.40 unless the guide sets it (LED 6.6, magnets +0.20, bearings +0.05,
battery bays +1.0 / +1.5 / +0.5). Full rule text per part is in `STANDARD[id].rules`.

### Controllers & SBCs

| ID | Envelope | Pocket | Mount | Holes | Keep-outs | Cable | Profile / material | Src |
|---|---|---|---|---|---|---|---|---|
| B-XA003 | 22 x 27 x 11.2 | 22.4 x 27.4 x 11.6 | stack | - | +z: PCB antenna: no metal, screws or PA-CF (conductive carbon) within 5 mm (5); -y: USB-C: open window ≥12 x 7 for the plug (20) | Plugs onto the B-XA004 female 1.27 mm header; USB-C for flashing only | chassis / PETG, PLA+ | guide |
| RPI-4B | 85.6 x 56.5 x 17 | 86 x 56.9 x 17.4 | screw_bosses | M2.5 tap Ø2.15, (3.5, 3.5) (61.5, 3.5) (3.5, 52.5) (61.5, 52.5), standoff 5 | +x: 2x USB 3.0 + 2x USB 2.0 + RJ45 plugs (25); -y: USB-C power + 2x micro-HDMI (20); -x: microSD (underside, protrudes ~2.5 mm) (5); +z: SoC heat: vent / heatsink / fan; GPIO + HAT stack (12) | USB-C 5 V 3 A; 40-pin GPIO on the +y edge; leave the port edges open | chassis / PETG, ABS/ASA | datasheet |
| RPI-5 | 85.6 x 56.5 x 17.5 | 86 x 56.9 x 17.9 | screw_bosses | M2.5 tap Ø2.15, (3.5, 3.5) (61.5, 3.5) (3.5, 52.5) (61.5, 52.5), standoff 5 | +x: 2x USB 3.0 + 2x USB 2.0 + RJ45 plugs (25); -y: USB-C PD + 2x micro-HDMI + power button (20); -x: microSD (underside) + PCIe FFC (8); +z: Active Cooler fan intake + vents (12) | USB-C PD 5 V 5 A; 40-pin GPIO on the +y edge; PCIe FFC on the -x edge | chassis / PETG, ABS/ASA | datasheet |
| RPI-ZERO-2W | 65 x 30 x 5.2 | 65.4 x 30.4 x 5.6 | screw_bosses | M2.5 tap Ø2.15, (3.5, 3.5) (61.5, 3.5) (3.5, 26.5) (61.5, 26.5), standoff 3 | -y: mini-HDMI + 2x micro-USB (15); -x: microSD (4); +x: CSI camera FFC (8) | Micro-USB power; 40-pin footprint on the +y edge (unpopulated) | chassis / PETG, PLA+ | datasheet |
| ESP32-DEV | 51.5 x 28.3 x 12 | 51.9 x 28.7 x 12.4 | edge_slot | - | +x: PCB antenna: no metal, screws or PA-CF (conductive carbon) within 5 mm (5); -x: USB connector + plug (20); -z: Header pins (2x15, 2.54) (9) | Dupont leads on the header pins; USB for power/flashing | chassis / PETG, PLA+ | estimated |
| XIAO-ESP32-C3 | 21 x 17.5 x 4 | 21.4 x 17.9 x 4.4 | edge_slot | - | +x: USB-C plug (20); -x: U.FL external antenna lead; stick the FPC antenna on a non-metal wall (5); -z: Battery pads (underside) (2) | Castellated / 2x7 2.54 pins; LiPo on the underside pads | shell / PETG, PLA+ | datasheet |
| XIAO-ESP32-S3 | 21 x 17.5 x 4.5 | 21.4 x 17.9 x 4.9 | edge_slot | - | +x: USB-C plug (20); -x: U.FL antenna lead (5); +z: Sense camera / mic expansion board + lens FOV (10) | Castellated / 2x7 2.54 pins; B2B connector for the Sense board | shell / PETG, PLA+ | datasheet |
| ZHAOZHI-AI-CORE | 38 x 38 x 8.5 | 38.4 x 38.4 x 8.9 | screw_bosses | M2.5 tap Ø2.15, 32 x 32 pitch, standoff 4 | +z: Dual MEMS mic ports: Ø1.5 openings, gasketed (2); -x: USB-C plug (20); +x: Speaker JST-ZH + LCD header (8) | USB-C power; 4-pin JST-ZH speaker; SPI LCD header | shell / PETG, PLA+ | estimated |
| JETSON-ORIN-NANO | 100 x 79 x 29 | 100.4 x 79.4 x 29.4 | screw_bosses | M2.5 tap Ø2.15, 86 x 58 pitch, standoff 6 | +z: Heatsink fan intake (15); +x: USB 3.2 x4, RJ45, DisplayPort plugs (25); -y: DC barrel 9-20 V (20) | DC barrel 9-20 V; 40-pin GPIO on the +y edge | chassis / ABS/ASA, PETG, PA-CF | estimated |
| ARDUINO-UNO | 68.6 x 53.4 x 15 | 69 x 53.8 x 15.4 | screw_bosses | M3 tap Ø2.6, (13.97, 2.54) (15.24, 50.8) (66.04, 7.62) (66.04, 35.56), standoff 5 | -x: USB-B / USB-C + DC barrel jack (USB-B overhangs ~6 mm) (20); +z: Shield stack on the headers (15) | USB or DC jack 7-12 V on the -x edge; female headers on top | chassis / PETG, PLA+ | datasheet |
| RPI-PICO-W | 51 x 21 x 4 | 51.4 x 21.4 x 4.4 | screw_bosses | M2 tap Ø1.7, (2, 4.8) (49, 4.8) (2, 16.2) (49, 16.2), standoff 3 | -x: USB plug (20); +x: Pico W antenna end: PCB antenna: no metal, screws or PA-CF (conductive carbon) within 5 mm (5) | 40 castellated / 2.54 pins; or plug into a carrier socket | shell / PETG, PLA+ | datasheet |
| ESP32-S3-DEVKIT | 68 x 28.5 x 11.5 | 68.4 x 28.9 x 11.9 | edge_slot | - | +x: PCB antenna: no metal, screws or PA-CF (conductive carbon) within 5 mm (5); -x: 2x USB-C plugs (20); -z: Header pins (2x22, 2.54) (9) | Dupont leads on the header pins; USB-C for power/flashing | chassis / PETG, PLA+ | estimated |
| MICROBIT-V2 | 51.6 x 42 x 11.7 | 52 x 42.4 x 12.1 | edge_slot | - | -y: Edge connector into its socket (10); +z: LED matrix, buttons A/B, touch logo, mic hole: keep visible / reachable (3); +y: micro-USB + JST-PH battery (20) | Edge connector (socket on the robot board); JST-PH battery | shell / PETG, PLA+ | datasheet |

- **B-XA003**: Never screwed: stacks on B-XA004; reserve 11.2 + 1.0 mm above the shield top. Keep a USB-C access window through any shell on the port side.
- **RPI-4B**: M2.5 on 58 x 49, holes 3.5 mm from the edges (official drawing); self-tap Ø2.15 bosses. Standoffs ≥5 mm (underside parts, airflow); M2.5 x 11 between Pi and HAT. Vent slots over the SoC; no PLA+ near it (SoC runs 60-80 °C).
- **RPI-5**: Same 58 x 49 M2.5 pattern as Pi 4B, 3.5 mm from the edges. Active cooling needed under load: open area above the fan ≥ fan diameter, exhaust vents on the side. Standoffs ≥5 mm; ABS/ASA or PETG near the SoC.
- **RPI-ZERO-2W**: M2.5 on 58 x 23, holes 3.5 mm from the edges; self-tap Ø2.15 bosses, 3 mm standoffs.
- **ESP32-DEV**: Most V1 boards have no holes: slide the PCB into two side grooves (PCB 1.6 + 0.40 slide-fit) or plug into female headers on a carrier. Leave 1.0 mm free around the header rows for the Dupont housings.
- **XIAO-ESP32-C3**: No holes: slide-in slot 21.4 x 17.9 with a 1.0 mm lip over the PCB edge, or solder to a carrier. FPC antenna ≥5 mm from motors, batteries and PA-CF.
- **XIAO-ESP32-S3**: Same slide-in slot as XIAO-ESP32-C3 (21.4 x 17.9, 1.0 mm lip). Sense: open lens window and a Ø1.5 mic port in front of the expansion board.
- **ZHAOZHI-AI-CORE**: Mic ports open to the outside, acoustically sealed from the speaker chamber. Keep the speaker ≥20 mm from the mics or behind a separate wall.
- **JETSON-ORIN-NANO**: Heavy (145 g): mount low on the chassis base, 4+ walls. Fan intake open area ≥ fan diameter + exhaust vents; ABS/ASA preferred (hot).
- **ARDUINO-UNO**: Official Uno hole centres (mm from the -x/-y corner): (13.97, 2.54), (15.24, 50.8), (66.04, 7.62), (66.04, 35.56); Ø3.2 holes. M3 self-tap Ø2.6 bosses Ø7.0, 5 mm high (THT leads underneath).
- **RPI-PICO-W**: 4x Ø2.1 holes on 47 x 11.4: M2 self-tap Ø1.7 bosses, 3 mm high.
- **ESP32-S3-DEVKIT**: No mounting holes: side grooves (1.6 + 0.40) or female headers on a carrier.
- **MICROBIT-V2**: Hold by the edge-connector socket + a rear clip; the shell opens over the front face. Bolting through the 5 ring pads makes electrical contact: only with that intent.

### Shields & HATs

| ID | Envelope | Pocket | Mount | Holes | Keep-outs | Cable | Profile / material | Src |
|---|---|---|---|---|---|---|---|---|
| B-XA004 | 29 x 30 x 12 | 29.4 x 30.4 x 12.4 | screw_bosses | M2.5 tap Ø2.15, 23 x 24 pitch, standoff 4 | +z: B-XA003 core stack (11.2) + header plugs (13) | Servo leads S1-S4 and the XH2.54 battery lead: ≥4.0 mm routing gap around the stack, 10 x 6 deck pass-through | chassis / PETG, ABS/ASA | guide |
| SHIELD-RPI-ROBOT | 65 x 56 x 12 | 65.4 x 56.4 x 12.4 | stack | M2.5 tap Ø2.15, (3.5, 3.5) (61.5, 3.5) (3.5, 52.5) (61.5, 52.5), standoff 11 | +z: Servo headers + motor screw terminals (screwdriver access) (15); -y: Motor / power terminal wires (10) | 8x servo leads, 4x motor pairs, 6-12 V power terminal | chassis / PETG, ABS/ASA | estimated |
| SHIELD-ESP32-SERVO | 54 x 54 x 11 | 54.4 x 54.4 x 11.4 | screw_bosses | M2.5 tap Ø2.15, 48 x 48 pitch, standoff 5 | +z: 16 servo plugs + power terminal screwdriver (15) | 16x 3-pin servo leads; 2-pin screw terminal for servo power | chassis / PETG, ABS/ASA | estimated |
| SHIELD-ARDUINO-MOTOR | 68.6 x 53.4 x 18 | 69 x 53.8 x 18.4 | stack | M3 tap Ø2.6, (13.97, 2.54) (15.24, 50.8) (66.04, 7.62) (66.04, 35.56), standoff 5 | +z: Driver heatsink: vents above (10); -x: Motor screw terminals (10) | 4x motor pairs + external 5-12 V terminal | chassis / PETG, ABS/ASA | datasheet |
| SHIELD-PICO-ROBOT | 65 x 56 x 12 | 65.4 x 56.4 x 12.4 | screw_bosses | M2.5 tap Ø2.15, (3.5, 3.5) (61.5, 3.5) (3.5, 52.5) (61.5, 52.5), standoff 5 | +z: Pico socket + servo headers + on/off switch (15); -y: Motor screw terminals (10) | 8x servo leads, 4x motor pairs, terminal-block power 3-11 V | chassis / PETG, ABS/ASA | estimated |

- **B-XA004**: 4x M2.5 self-tap (Ø2.15) on 23.0 x 24.0 pitch; bosses Ø5.8, 4 mm high so solder joints clear the deck. Input 6.0-9.0 V only: 2S packs (B-PC003, BAT-18650-2S); 1S cells need a boost converter. Any fastener behind a wall gets a Ø6.5 line-of-sight driver tunnel (s.6).
- **SHIELD-RPI-ROBOT**: HAT on the Pi 58 x 49 pattern with M2.5 x 11 standoffs; screws into the Pi bosses below.
- **SHIELD-ESP32-SERVO**: M2.5 self-tap bosses 5 mm high; ≥4.0 mm cable-route gap on the header side.
- **SHIELD-ARDUINO-MOTOR**: Stacks on the Uno headers; shares the Uno hole pattern (screws through both boards). Vent over the driver heatsink.
- **SHIELD-PICO-ROBOT**: M2.5 self-tap bosses 5 mm high. On/off switch reachable from outside the shell.

### LicheeRV Claw kit (Sipeed)

| ID | Envelope | Mount | Keep-outs | Notes | Src |
|---|---|---|---|---|---|
| LICHEERV-NANO-W | 22.86 x 35.56 x 5 | stack (castellated 2 x 14, 2.54 mm, rows 20.32 apart) | -y USB-C (25); -z TF slot (15); +x antenna (5) | SG2002, 256 MB, WiFi 6 + BLE 5.4, mic + < 1 W PA; boots Linux from the TF card | datasheet |
| PICOCLAW-BOARD | 30.5 x 38.5 x 15 (whole module stack 16.4 deep) | cradle, upright | +y LCD 27.7 window (2); -x / +x one side key each (4); -y USB-C, ON/OFF, 2 LEDs (20) | 240x240 ST7789 on SPI1; keys sysfs GPIO 504 / 509, LEDs 495 / 498; built-in 1S battery (charger max 3 W) and speaker | estimated |
| PCA9685-SERVO-16 | 62.5 x 25.4 x 11 | screw_bosses, M2.5 on 55.9 x 19.1 | +z headers + V+ terminal (14); -x I2C header (10) | Added for servos: the Nano's PWM pins are muxed with UARTs and the backlight | datasheet |

**The module carries its own battery and speaker.** In the kit, the Nano + PicoClaw stack has a built-in 1S cell and a
speaker behind the boards. That makes the whole stack about 16.4 mm deep (`CLAW_MOD.depth`, an estimate: measure yours).
So a Claw design adds no separate battery or speaker.
- **Without servos:** the design has no base at all. The body stands on its own flat bottom and holds the module as its
  face.
- **With servos:** a separate pack (the 1S pouch in desk bases, the 1S2P 14500 in twin-cell bays) powers only the servos,
  through a 5 V boost to the PCA9685 V+.

How PICOCEO Builder places it on machines without a head (`clawBase` in `src/cad/machine.ts`):
- **Console:** the module stands upright in a 54 x 31 x 46 mm rear console behind a 27.7 mm LCD window. Each side key is
  pressed through a printed plunger in a Ø8 guide.
- **USB-C:** the plug goes down into a deck well.
- **Servo pouch:** it is strapped in the tub (+1.0 / +1.5 bay, strap never on the pouch).
- **PCA9685:** it hangs under the deck.
- **Clearance:** mechanisms read `coverTop` (46), so rotors, trays and turntables clear the console by the 2 mm
  rotating-part gap.

### Voice-robot hardware (XiaoZhi / Raspberry Pi / Jetson)

`src/cad/voicecore.ts` places these parts in a free-form body's voice core. Kit presets: `xiaozhi_voice`, `rpi_voice`,
`jetson_voice` (POPULAR_KITS + DEFAULT_KIT_DIRECTORY_ITEMS). Each kit has a board, mic, amp / speaker, display, servo
board, 2-4 servos, a battery (+ buck) and 4 cover magnets.

| ID | Envelope | Mount | Keep-outs | Notes | Src |
|---|---|---|---|---|---|
| JETSON-NANO | 100 x 80 x 29 | screw_bosses, M2.5 on 86 x 58, 6 mm standoffs | -y I/O edge (barrel 5 V 4 A, USB, HDMI, DP, RJ45) (25); +z heatsink vents (12) | B01 carrier; I2C bus 1 on pins 3 / 5, I2S on 12 / 35 / 38 / 40 | datasheet |
| MIC-INMP441 | 14.5 x 14.5 x 3.2 | glue_pocket, port side to the wall | -z bottom sound port: Ø1.6 port in the wall on the mic axis | ≥ 20 mm (or a wall) from the speaker | estimated |
| RESPEAKER-2MIC-HAT | 65 x 30 x 10 | stack on the Pi header (58 x 23 holes) | +z a mic at each end: Ø1.6 port above each; -y JST speaker + 3.5 mm jack | WM8960 codec, 1 W speaker out, button GPIO17, Grove I2C | datasheet |
| USB-MIC-MINI | 22 x 18 x 7 | in a USB-A port | plug end open to the room through the port window | UAC, no driver | estimated |
| AMP-MAX98357A | 17.8 x 19.3 x 6 | glue_pocket / rim | +z speaker terminal (8); -y header (10) | 3.2 W / 4 Ω at 5 V, peaks 0.65 A | datasheet |
| LCD-GC9A01-128 | 40.4 x 37.5 x 5 | cradle behind a round Ø33 window, retainer plate | +z active Ø32.4 (no pressure on the glass) | 240x240 SPI; M2 holes 34.4 x 31.5 (Waveshare) | estimated |
| LCD-ST7789-169 | 31 x 41 x 4.5 | cradle behind a 28.5 x 33.2 window | +z active 27.97 x 32.63 | 240x280 SPI | estimated |
| LCD-ST7789-20 | 34.5 x 51 x 4.8 | cradle behind a 31.1 x 41.3 window | +z active 30.6 x 40.8 | 240x320 SPI | estimated |
| WAVESHARE-SERVO-HAT | 65 x 56.5 x 15 | stack, 58 x 49, M2.5 x 11 | +z 16 servo headers + VIN terminal | PCA9685 0x40 on bus 1, 6-12 V in, 3 A regulator | datasheet |
| ADAFRUIT-SERVO-BONNET | 65 x 30.5 x 12 | stack, 58 x 23 | +z headers + power jack | PCA9685 0x40, servo V+ 5 V 4 A unregulated | datasheet |
| BUS-SERVO-ADAPTER | 42 x 32 x 12 | screw_bosses, M2.5 on 36 x 26 | -y USB-C + power; +x bus ports | ST / SC bus servos, 6-12 V | estimated |
| BUCK-5V-5A | 36 x 24 x 12 | screw_bosses, 2x M3 on 30 mm, 3 mm high | +z inductor heat (6) | 6.5-24 V -> 5.1 V 5 A (Pi 5, Jetson Nano) | estimated |
| UPS-HAT-PI | 65 x 56.5 x 24 | stack, 58 x 49 (+1.0 / +1.5 cell swell) | +z cells lift out; -y USB-C charge slot | 2x 18650, 5.1 V 5 A out, I2C fuel gauge | estimated |

**Voice core rules** (`src/cad/voicecore.ts`, checked by every build):
- **Face block:** it holds the display, the mic and the speaker in pockets, open at the back.
  - Front: a 1.5 mm bezel. The display window covers the active area (round for the GC9A01), the mic has a Ø1.6 port,
    the speaker a Ø2 grille on a 3 mm pitch (35 % open).
  - Back: one retainer plate (2 × M2×6) with a cable window per part.
  - The mic and the speaker have their own pockets (their own walls).
- **Sled:** the board stands on standoffs at its STANDARD hole pattern. Under the shelf, on the deck: the battery in a
  cradle rim with a strap, the buck and the servo board on 3 mm bosses, the amp in a rim. The sled is screwed to the
  4 mm body floor from below (2 × M3×10).
- **Openings:** the board's power / USB edge faces a rear wall window (≥ 14 x 9). The Pi / Jetson get vents above the
  board, and the ReSpeaker mics get ports through the top.
- **Power:**
  - Pi 5: 5 V 5 A from BUCK-5V-5A or UPS-HAT-PI. Pi 4B: 5 V 3 A. Jetson Nano: 5 V 4 A on the barrel (J48 jumper).
    Jetson Orin Nano: 9-20 V.
  - XiaoZhi: a 1S cell, charged over USB-C. The DevKitC has no charger, so it needs a 1S charger + 5 V boost. Micro
    servos (4.8 V min) take the 5 V boost output, not the cell.
- **Servos:** the composer housings are micro-class (SG90, SG92R, MG90S, FS90R). MG996R, DS3218 and ST3215 are
  catalogued for the checks, but they need a dedicated mount.

### Servos

| ID | Envelope | Pocket | Mount | Holes | Keep-outs | Cable | Profile / material | Src |
|---|---|---|---|---|---|---|---|---|
| B-PG001 | 22.8 x 12 x 28.5 | 23.2 x 12.4 x 28.9 | ear_screws | M2 tap Ø1.7, 27.8 x 0 pitch, standoff 0; span 32.4 x 12 | +z: 21T Ø4.8 spline + horn; horn arm sweeps R16.2 around the shaft (12); -x: Servo lead exit at the case end (6) | 3-pin lead [GND, 5V, PWM] to S1-S4; 6 x 10 slot down through the deck, no pinch at the pocket edge | motorMount / PETG, ABS/ASA, PA-CF | guide |
| B-PG002 | 22.8 x 12 x 28.5 | 23.2 x 12.4 x 28.9 | ear_screws | M2 tap Ø1.7, 27.8 x 0 pitch, standoff 0; span 32.4 x 12 | +z: 21T Ø4.8 spline + horn; horn arm sweeps R16.2 around the shaft (12); -x: Servo lead exit at the case end (6) | 3-pin lead [GND, 5V, PWM] to S1-S4; 6 x 10 slot down through the deck, no pinch at the pocket edge | motorMount / PETG, ABS/ASA, PA-CF | guide |
| SG90-SERVO | 22.2 x 11.8 x 31 | 22.6 x 12.2 x 31.4 | ear_screws | M2 tap Ø1.7, 27.8 x 0 pitch, standoff 0; span 32.5 x 11.8 | +z: Ø4.8 21T spline + horn sweep (12); -x: Servo lead exit (6) | 3-pin servo lead (brown GND, red V+, orange signal); 6 x 10 deck slot | motorMount / PETG, ABS/ASA, PA-CF | datasheet |
| MG90S-SERVO | 22.8 x 12.2 x 28.5 | 23.2 x 12.6 x 28.9 | ear_screws | M2 tap Ø1.7, 27.8 x 0 pitch, standoff 0; span 32.5 x 12.2 | +z: Ø4.8 21T spline + horn sweep (12); -x: Servo lead exit (6) | 3-pin servo lead (brown GND, red V+, orange signal); 6 x 10 deck slot | motorMount / PETG, ABS/ASA, PA-CF | estimated |
| SG92R-SERVO | 23 x 12.5 x 29 | 23.4 x 12.9 x 29.4 | ear_screws | M2 tap Ø1.7, 27.8 x 0 pitch; span 32.5 x 12.5 | +z: spline + horn sweep (12); -x: lead exit (6) | 3-pin servo lead | motorMount / PETG, ABS/ASA, PA-CF | datasheet |
| FS90R-SERVO | 23.2 x 12.5 x 22 | 23.6 x 12.9 x 22.4 | ear_screws | M2 tap Ø1.7, 27.8 x 0 pitch; span 32.5 x 12.5 | +z: spline + wheel / horn (12); -x: lead exit (6) | 3-pin servo lead; continuous, trim the stop point | motorMount / PETG, ABS/ASA, PA-CF | datasheet |
| MG996R-SERVO | 40.7 x 19.7 x 42.9 | 41.1 x 20.1 x 43.3 | ear_screws | M4 tap Ø3.4, 49.5 x 10 pitch; span 54.5 x 19.7 | +z: 25T spline + horn sweep R25 (14); -x: lead exit (8) | 3-pin lead, 2.5 A stall per servo | motorMount / PETG, ABS/ASA, PA-CF | datasheet |
| DS3218-SERVO | 40 x 20 x 40.5 | 40.4 x 20.4 x 40.9 | ear_screws | M4 tap Ø3.4, 49.5 x 10 pitch; span 54.5 x 20 | +z: 25T spline + horn sweep (14); -x: lead exit (8) | 3-pin lead, ~2.6 A stall | motorMount / PETG, ABS/ASA, PA-CF | datasheet |
| ST3215-SERVO | 45.2 x 24.7 x 35 | 45.6 x 25.1 x 35.4 | screw_bosses | 4x M3 clear through the case (estimated positions) | +z: output disc + horn (14); -x: 2 bus connectors (10) | daisy-chained TTL bus from BUS-SERVO-ADAPTER, 6-12.6 V | motorMount / PETG, ABS/ASA, PA-CF | estimated |

- **B-PG001**: Through-pocket 23.2 x 12.4 (22.8 x 12.0 + 0.40 push-fit); ears rest on the plate. 2x M2 self-tap, Ø1.7 tap holes on 27.8 pitch (ear span 32.4); boss wall ≥1.4 mm. Horn seat: recess for the 21T Ø4.8 spline hub + arm; centre screw through a Ø6.5 tunnel; horn pilots M2 tap. Horizontal shaft: never trap between closed bulkheads; two vertical ear pillars (front/rear) with outer Ø6.5 tunnels (s.6). PETG/ABS mounts only; motorMount profile (0.16 mm, 5 walls, 45 % gyroid). Positional 180°: check the horn arc against the body over the full travel.
- **B-PG002**: Through-pocket 23.2 x 12.4 (22.8 x 12.0 + 0.40 push-fit); ears rest on the plate. 2x M2 self-tap, Ø1.7 tap holes on 27.8 pitch (ear span 32.4); boss wall ≥1.4 mm. Horn seat: recess for the 21T Ø4.8 spline hub + arm; centre screw through a Ø6.5 tunnel; horn pilots M2 tap. Horizontal shaft: never trap between closed bulkheads; two vertical ear pillars (front/rear) with outer Ø6.5 tunnels (s.6). PETG/ABS mounts only; motorMount profile (0.16 mm, 5 walls, 45 % gyroid). Continuous: wheel / platter hubs sit on the horn; idler sides use a journal bore = shaft + 0.40.
- **SG90-SERVO**: Same 9 g footprint as B-PG001: through-pocket body + 0.40, M2 self-tap ears on 27.8 pitch. Ear pitch varies ±0.5 mm between vendors: elongate the ear holes 1.0 mm along X. Ø6.5 driver tunnels to ear and horn screws (s.6).
- **MG90S-SERVO**: Same 9 g footprint as B-PG001: through-pocket body + 0.40, M2 self-tap ears on 27.8 pitch. Ear pitch varies ±0.5 mm between vendors: elongate the ear holes 1.0 mm along X. Ø6.5 driver tunnels to ear and horn screws (s.6).

### Motors

| ID | Envelope | Pocket | Mount | Holes | Keep-outs | Cable | Profile / material | Src |
|---|---|---|---|---|---|---|---|---|
| B-GM001 | 38 x 15.5 x 12 | 38.4 x 15.9 x 12.4 | clamp | - | +x: Ø3.0 D-shaft (flat 2.5) + wheel hub (12); -x: Motor terminals + leads (6) | 2-wire leads to the shield motor port (M1/M2 assumed); ≥4.0 mm routing gap | motorMount / PETG, ABS/ASA, PA-CF | guide |
| N20-MOTOR | 24 x 12 x 10 | 24.4 x 12.4 x 10.4 | clamp | M1.6 clear Ø1.9, 9 x 0 pitch on +x, standoff 0 | +x: Ø3 D-shaft (10 mm) + hub (12); -x: Motor terminals / encoder (8) | 2-wire leads (or 6-pin encoder) from the -x end; ≥4.0 mm routing gap | motorMount / PETG, ABS/ASA, PA-CF | datasheet |
| TT-MOTOR | 70 x 22 x 18 | 70.4 x 22.4 x 18.4 | clamp | M3 clear Ø3.4, 17.5 x 0 pitch on +y, standoff 0 | +y: Output shaft Ø5.4 (flats 3.6) + wheel hub (12); -y: Second output shaft (12) | 2-wire leads from the motor can end | motorMount / PETG, ABS/ASA, PA-CF | estimated |

- **B-GM001**: Push-fit saddle 38.4 x 15.9 (+0.40) around the gearbox, closed by a 2.8 mm strap with 2x M2.5 into bosses. Hub D-bore: Ø3.0 + 0.05 press, or Ø3.0 + 0.40 with an M3 set screw on the flat (captive nut 5.6 AF). PETG/ABS only: motors run 45-60 °C (s.9).
- **N20-MOTOR**: Face plate ≥2 mm with 2x M1.6 clearance holes Ø1.9 on 9 mm pitch beside the shaft; Ø4.5 relief for the shaft boss. Push-fit saddle (+0.40) under the gearbox / can, closed by a strap. PETG/ABS only.
- **TT-MOTOR**: 2x M3 x 30 through-bolts across the gearbox into captive M3 nuts (5.6 AF x 2.6). Pocket for the locating nub beside the shaft; saddle the motor can.

### Batteries

| ID | Envelope | Pocket | Mount | Holes | Keep-outs | Cable | Profile / material | Src |
|---|---|---|---|---|---|---|---|---|
| B-PC003 | 28.4 x 51.2 x 16.3 | 29.4 x 52.7 x 16.8 | cradle | - | -y: Lead / BMS end: 10 x 6 egress slot in the rear wall (4); +z: 2.8 mm cross-strap + lift-out access (3) | Leads exit a 10 x 6 rear-wall slot straight toward the switch, no sharp bends (s.11) | chassis / PETG, ABS/ASA | guide |
| BAT-18650-1S | 18.5 x 67 x 18.5 | 19.5 x 68.5 x 19 | cradle | - | -y: Lead / BMS end: 10 x 6 egress slot in the rear wall (4); +z: 2.8 mm cross-strap + lift-out access (3) | Leads exit a 10 x 6 rear-wall slot straight toward the switch, no sharp bends (s.11) | chassis / PETG, ABS/ASA | datasheet |
| BAT-18650-2S | 37 x 67 x 18.5 | 38 x 68.5 x 19 | cradle | - | -y: Lead / BMS end: 10 x 6 egress slot in the rear wall (4); +z: 2.8 mm cross-strap + lift-out access (3) | Leads exit a 10 x 6 rear-wall slot straight toward the switch, no sharp bends (s.11) | chassis / PETG, ABS/ASA | datasheet |
| BAT-LIPO-1S-1000 | 34 x 50 x 6.2 | 35 x 51.5 x 6.7 | cradle | - | -y: Lead / BMS end: 10 x 6 egress slot in the rear wall (4); +z: 2.8 mm cross-strap + lift-out access (3) | Leads exit a 10 x 6 rear-wall slot straight toward the switch, no sharp bends (s.11) | chassis / PETG, ABS/ASA | datasheet |
| B-BA001 | 30 x 35 x 5.5 | 31 x 36.5 x 6 | cradle | - | -y: Lead / BMS end: 10 x 6 egress slot in the rear wall (4); +z: 2.8 mm cross-strap + lift-out access (3) | Leads exit a 10 x 6 rear-wall slot straight toward the switch, no sharp bends (s.11) | chassis / PETG, ABS/ASA | estimated |

- **B-PC003**: Isolated bay: no motor, servo ear or bulkhead inside the bay volume (s.11). Swell margin +1.5 length, +1.0 width (s.11). Finger reliefs Ø18-24 on the left/right walls. Rigid 2.8 mm cross-strap, 2x M2.5 into bosses fully outside the bay (|X| ≥ bay half-width + 2.0). Subtract the cavity after all bosses are unified (s.12 #2). Cradle space 34.0 x 56.5 (guide s.3) = bay 29.4 x 52.7 + 2.0 walls. Twin half-cylinder troughs R = 7.1 + 0.5 = 7.6 for the two 14500 cells.
- **BAT-18650-1S**: Isolated bay: no motor, servo ear or bulkhead inside the bay volume (s.11). Swell margin +1.5 length, +1.0 width (s.11). Finger reliefs Ø18-24 on the left/right walls. Rigid 2.8 mm cross-strap, 2x M2.5 into bosses fully outside the bay (|X| ≥ bay half-width + 2.0). Subtract the cavity after all bosses are unified (s.12 #2). Protected 18650 cells are up to 69-70 mm long: bay length 70 + 1.5 = 71.5. Single trough R = 9.25 + 0.5 = 9.75.
- **BAT-18650-2S**: Isolated bay: no motor, servo ear or bulkhead inside the bay volume (s.11). Swell margin +1.5 length, +1.0 width (s.11). Finger reliefs Ø18-24 on the left/right walls. Rigid 2.8 mm cross-strap, 2x M2.5 into bosses fully outside the bay (|X| ≥ bay half-width + 2.0). Subtract the cavity after all bosses are unified (s.12 #2). Protected cells up to 69-70 mm: bay length 71.5. Twin troughs R = 9.25 + 0.5 = 9.75.
- **BAT-LIPO-1S-1000**: Isolated bay: no motor, servo ear or bulkhead inside the bay volume (s.11). Swell margin +1.5 length, +1.0 width (s.11). Finger reliefs Ø18-24 on the left/right walls. Rigid 2.8 mm cross-strap, 2x M2.5 into bosses fully outside the bay (|X| ≥ bay half-width + 2.0). Subtract the cavity after all bosses are unified (s.12 #2). Pouch: no screws, sharp edges or point loads; flat floor, strap or slide-in lid. +0.5 mm thickness margin for pouch swell.
- **B-BA001**: Isolated bay: no motor, servo ear or bulkhead inside the bay volume (s.11). Swell margin +1.5 length, +1.0 width (s.11). Finger reliefs Ø18-24 on the left/right walls. Rigid 2.8 mm cross-strap, 2x M2.5 into bosses fully outside the bay (|X| ≥ bay half-width + 2.0). Subtract the cavity after all bosses are unified (s.12 #2). Pouch: no screws, sharp edges or point loads; retain with the strap or a slide-in lid (slot = tongue + 0.40). +0.5 mm thickness margin for pouch swell. 1S 3.7 V cannot feed B-XA004 (6-9 V): add a boost converter, or use in XIAO-class 3.7 V builds.

### Switches, LED hubs & LEDs

| ID | Envelope | Pocket | Mount | Holes | Keep-outs | Cable | Profile / material | Src |
|---|---|---|---|---|---|---|---|---|
| B-XA007 | 20.5 x 14 x 13.5 | 20.9 x 14.4 x 13.9 | ear_screws | M2.5 tap Ø2.15, (2, 7), standoff 0 | +z: Slide actuator, 4.0 mm stroke: open slot = knob + 4.0 + 0.40 (6) | XH2.54 2-pin inline pass-through: battery in, shield out; 10 x 6 deck pass-through | chassis / PETG, ABS/ASA | guide |
| B-XA006 | 28 x 6 x 11 | 28.4 x 6.4 x 11.4 | screw_bosses | M2.5 tap Ø2.15, (14, 3), standoff 3 | +z: 6x JST-SH 1.0 branch headers: plug access (8) | D1 port from the shield in; 6 JST-SH 3-pin branches to the LEDs | chassis / PETG, PLA+ | guide |
| B-KB003 | 6 x 6 x 2.8 | 6.6 x 6.6 x 3 | press_pocket | - | +z: Light window Ø4.5 through a 1.0 mm skin (top-mounted: Ø3.0) (1) | 3-wire daisy-chain ribbon from the back; 3 mm wire channel to the hub | shell / PETG, PLA+ | guide |
| B-XL001 | 5 x 5 x 1.6 | 5.4 x 5.4 x 2 | press_pocket | - | +z: Light window Ø4.0 through a 1.0 mm skin (1) | 4 pads (DIN, 5V, GND, DOUT): 3 mm wire channel behind the pocket | shell / PETG, PLA+ | datasheet |

- **B-XA007**: Push-fit cradle walls (+0.40) around the 20.5 x 14.0 base, 1x M2.5 self-tap through the ear. Actuator reachable from outside the shell without opening it. Rated 0.5 A: put it only on the battery lead. Any fastener behind a wall gets a Ø6.5 line-of-sight driver tunnel (s.6).
- **B-XA006**: Single M2.5 centre boss Ø5.8, 3 mm high (self-tap Ø2.15). Add 1 mm locating ribs on both long sides: one screw does not stop rotation.
- **B-KB003**: Pocket 6.6 x 6.6 (guide s.3) cut from the inside, leaving a 1.0 mm front skin. Retain with CA or hot glue; no screws. Light-coloured PETG / PLA+ diffuses best; avoid PA-CF.
- **B-XL001**: Pocket = 5.0 x 5.0 + 0.40 for the bare 5050 package; for a breakout PCB use breakout size + 0.40. Glue only; never press on the lens.

### Speakers

| ID | Envelope | Pocket | Mount | Holes | Keep-outs | Cable | Profile / material | Src |
|---|---|---|---|---|---|---|---|---|
| ZHAOZHI-SPEAKER-MOD | 36 x 36 x 14 | 36.4 x 36.4 x 14.4 | cradle | - | +z: Speaker front: grille ≥30 % open area over the cone (2); -z: Sealed back chamber: do not vent (0) | JST-PH 2.0 4-pin (I2S + 5 V) | shell / PETG, PLA+ | estimated |
| SPK-8OHM-2W | 31 x 20 x 8.5 | 31.4 x 20.4 x 8.9 | press_pocket | - | +z: Sound port: grille ≥30 % open area (2) | 2-wire JST-1.25 or pads | shell / PETG, PLA+ | estimated |
| SPK-MICRO-1W | 20 x 14 x 4.5 | 20.4 x 14.4 x 4.9 | glue_pocket | - | +z: Sound port: grille ≥30 % open area (2) | 2-pin micro connector | shell / PETG, PLA+ | estimated |

- **ZHAOZHI-SPEAKER-MOD**: Push-fit cradle (+0.40) + strap or glue; 0.5-1 mm gasket lip between cone rim and grille (no rattle). Mic port acoustically separated from the speaker (≥20 mm or own wall).
- **SPK-8OHM-2W**: Push-fit pocket (+0.40), seal the front to the grille, strap or glue at the back.
- **SPK-MICRO-1W**: Push-fit pocket (+0.40), glue the rim to the grille wall.

### Sensors, displays & cameras

| ID | Envelope | Pocket | Mount | Holes | Keep-outs | Cable | Profile / material | Src |
|---|---|---|---|---|---|---|---|---|
| HC-SR04 | 45 x 20 x 15 | 45.4 x 20.4 x 15.4 | press_pocket | M2 tap Ø1.7, 41 x 16 pitch, standoff 0 | +z: Ø16 transducers on 26 mm centres: front holes Ø16.5; 15° beam, no lip in the cone (50); -y: 4-pin header + Dupont plug (12) | 4-pin 2.54 header (VCC, Trig, Echo, GND) | shell / PETG, PLA+ | datasheet |
| OLED-SSD1306 | 27 x 27 x 4 | 27.4 x 27.4 x 4.4 | screw_bosses | M2 tap Ø1.7, 23.5 x 23.8 pitch, standoff 2 | +z: Glass: window ≥ active area 21.7 x 10.9 + 0.5 each side; glass recess (2); +y: 4-pin header + Dupont plug (12) | 4-pin 2.54 header (GND, VCC, SCL, SDA) | shell / PETG, PLA+ | datasheet |
| MPU-6050 | 20.5 x 15.6 x 3 | 20.9 x 16 x 3.4 | screw_bosses | M2.5 tap Ø2.15, (2.8, 2.8) (17.7, 2.8), standoff 3 | +y: 8-pin header + Dupont plug (12) | 8-pin 2.54 header; I2C only needs VCC, GND, SCL, SDA | chassis / PETG, ABS/ASA | datasheet |
| RPI-CAMERA-V2 | 25 x 24 x 9 | 25.4 x 24.4 x 9.4 | screw_bosses | M2 tap Ø1.7, (2, 9.5) (23, 9.5) (2, 22) (23, 22), standoff 2 | +z: Lens FOV 62.2° x 48.8°: window ≥ Ø8 and no lip in the cone (20); -y: 15-pin FFC: exit slot 17 x 2, no sharp fold (10) | 15-pin 1.0 mm FFC to the Pi CSI port | cantilever / PETG, PLA+ | datasheet |
| VL53L0X-TOF | 25 x 13 x 3 | 25.4 x 13.4 x 3.4 | screw_bosses | M2.5 tap Ø2.15, (2.5, 6.5), standoff 2 | +z: 25° FOV cone: open aperture, or IR-clear cover touching the sensor (30) | 6-pin 2.54 header (VIN, GND, SCL, SDA, XSHUT, GPIO1) | shell / PETG, PLA+ | estimated |

- **HC-SR04**: Front plate with 2x Ø16.5 holes on 26 mm centres; transducer faces flush or ≤1 mm recessed. Retain the PCB with a back clip or 4 corner screws.
- **OLED-SSD1306**: Mount from behind a bezel: M2 self-tap Ø1.7 on ~23.5 x 23.8. Glass is fragile: no screw clamping on the glass, 0.2 mm gap around it.
- **MPU-6050**: GY-521: 2x Ø3 holes, M2.5 self-tap Ø2.15; rigid mount, axes aligned with the robot frame. Near the centre of mass / pivot axis; ≥10 mm from motor cans (heat drift).
- **RPI-CAMERA-V2**: M2 on 21 x 12.5, holes 2.0 mm from the side edges; self-tap Ø1.7 bosses 2 mm high. Camera masts: print on the side (cantilever profile, s.7).
- **VL53L0X-TOF**: No printed lip in the FOV cone (cross-talk); dark matte aperture walls.

### Hardware (magnets & bearings)

| ID | Envelope | Pocket | Mount | Holes | Keep-outs | Cable | Profile / material | Src |
|---|---|---|---|---|---|---|---|---|
| MAG-N52-10X2 | 10 x 10 x 2 | 10.2 x 10.2 x 2.2 | glue_pocket | - | +z: Mating magnet / steel face (0) | None | chassis / PETG, PLA+ | guide |
| MAG-MAGSAFE-RING | 54 x 54 x 1.5 | 54.2 x 54.2 x 1.7 | glue_pocket | - | +z: Phone back: flush, ≤0.6 mm skin (0) | None | cantilever / PETG, PLA+ | estimated |
| MAG-N52-4X2 | 4 x 4 x 2 | 4.2 x 4.2 x 2.2 | glue_pocket | - | +z: Mating magnet / steel face (0) | None | chassis / PETG, PLA+ | guide |
| BRG-683ZZ | 7 x 7 x 3 | 7.05 x 7.05 x 3 | press_pocket | - | +z: Inner race: Ø4.5 relief so the housing only touches the outer race (0.5) | None | wheel / PETG, ABS/ASA, PA-CF | guide |
| BRG-688ZZ | 16 x 16 x 5 | 16.05 x 16.05 x 5 | press_pocket | - | +z: Inner race: Ø10 relief so the housing only touches the outer race (0.5) | None | wheel / PETG, ABS/ASA, PA-CF | guide |

- **MAG-N52-10X2**: Pocket Ø = D + 0.20, depth = t + 0.20 (s.4) -> Ø10.2 x 2.2; CA capillary bond. Mark polarity on the part; hidden magnets under a 0.4-0.6 mm skin.
- **MAG-MAGSAFE-RING**: Annular channel OD 54.2 / ID 45.8, depth 1.7 (+0.20 per the magnet rule); glue.
- **MAG-N52-4X2**: Pocket Ø4.2 x 2.2 (guide s.4, checklist #6); CA capillary bond.
- **BRG-683ZZ**: Housing bore Ø7.05 (Hole = OD + 0.05, s.4), 0.5 mm shoulder on the far side. Ø3 steel pin / M3 screw axle; without a bearing use a journal bore Ø3.40. Bore axis vertical (Z) so it prints round and support-free.
- **BRG-688ZZ**: Housing bore Ø16.05 (Hole = OD + 0.05, s.4), 0.5 mm shoulder on the far side. Ø8 shaft; bore axis vertical (Z), support-free.

## 3. Discrepancies between docs

The guide wins in every case. Also exported as `DISCREPANCIES` in `src/catalog/standard.ts`.

| Topic | Architecture doc | Guide (used) |
|---|---|---|
| Push-fit | +0.2 mm | Pocket = Part + 0.40 (the guide's own row also says "+0.10 radial / +0.20 diametrical"; the formula is used) |
| Slide fit | +0.35 mm | +0.15-0.25 per wall, Slot = Tongue + 0.40 |
| Journal | +0.5 mm | +0.20 radial, Bore = Shaft + 0.40 |
| Tap drills | M2 Ø1.8, M2.5 Ø2.2, M3 Ø2.7 | Ø1.70, Ø2.15, Ø2.60 |
| Clearance holes | M2 Ø2.4, M2.5 Ø2.9 | Ø2.30, Ø2.80 (M3 Ø3.4 agrees) |
| B-PG001 torque | 1.8 kg·cm | 1.2 kgf·cm @ 6 V |
| B-XA003 size | 24 x 24 mm | 22.0 x 27.0 x 11.2 mm |
| B-XA004 | 8 servo ports, LiPo charger | 4 headers S1-S4, 6.0-9.0 V in, no charger |
| B-GM001 | N20, 1:50, 150 RPM | 030 geared motor 38.0 x 15.5 x 12.0, 180 RPM @ 6 V, 2.4 kgf·cm (Ø3 D-shaft agrees) |
| B-XA007 | 3-pin slide switch | SPDT, XH2.54 2-pin inline harness |
| Power | runtime budgeted on B-BA001 (1S 3.7 V) | 2S 7.4 V bus (B-PC003); B-XA004 needs 6-9 V |
| LED | B-XL001 WS2812B RGB | B-KB003 WS2812 RGBW 5050 (both catalogued) |
| Print density | 1.24 g/cm³ (PLA) | PETG primary (1.27 g/cm³) |

Fixed in the CAD code while writing this standard: the phone-stand magnet pocket (was Ø10.3, now Ø10.2 = magnet + 0.20),
the Raspberry Pi Pico model's holes (now the 11.4 x 47.0 datasheet pattern) and the SSD1306 model's holes (now 23.5 x 23.8).

## 4. Unverified values

Entries with `source: 'estimated'` or an `unverified` note. Measure the real part before committing a print.

|ID|Source|Unverified|
|---|---|---|
| B-XA003 | guide | USB-C and antenna faces are not given in the guide |
| B-PG001 | guide | Shaft offset 5.9 mm from the case end and the 18.4 / 4.3 mm below / above-ear split are CAD values (src/cad/modules.ts), not in the guide |
| B-PG002 | guide | Shaft offset 5.9 mm from the case end and the 18.4 / 4.3 mm below / above-ear split are CAD values (src/cad/modules.ts), not in the guide |
| B-GM001 | guide | Shaft position and mounting holes are not in the guide (shaft assumed axial, centred on the 15.5 x 12 end face) |
| B-XA007 | guide | Ear position not in the guide (assumed at the -x end, centred) |
| B-XA006 | guide | Header face not given in the guide |
| B-BA001 | estimated | Size 30 x 35 x 5.5 (503035 class) and JST-PH connector are estimates; the arch doc gives only 3.7 V 500 mAh |
| B-XL001 | datasheet | Breakout / matrix form factor not specified by the arch doc |
| ESP32-DEV | estimated | No standard hole pattern; header row spacing varies by vendor (25.4 mm typical) |
| XIAO-ESP32-S3 | datasheet | Sense expansion board height (10 mm keep-out) is an estimate |
| ZHAOZHI-AI-CORE | estimated | Board variant specific; 32 x 32 M2.5 pattern taken from the CAD model |
| JETSON-ORIN-NANO | estimated | Carrier hole pattern (86 x 58, M2.5) is the commonly cited Jetson Nano dev-kit value: verify |
| ESP32-S3-DEVKIT | estimated | Mounting depends on carrier; no official hole pattern |
| SG90-SERVO | datasheet | Ear span / pitch are typical vendor values, measure your batch |
| MG90S-SERVO | estimated | Ear span / pitch are typical vendor values, measure your batch |
| N20-MOTOR | datasheet | M1.6 hole sizes extrapolated (not in guide s.5) |
| TT-MOTOR | estimated | Through-hole pitch (17.5 mm) and nub position vary by vendor |
| ZHAOZHI-SPEAKER-MOD | estimated | Module outline and fixing points not published |
| SPK-8OHM-2W | estimated | Ear / sound-port position varies by vendor |
| SPK-MICRO-1W | estimated | Sound-port position varies by vendor |
| SHIELD-RPI-ROBOT | estimated | Generic HAT; terminal positions vary |
| SHIELD-ESP32-SERVO | estimated | Hole pattern (3 mm inset) taken from the CAD model |
| SHIELD-PICO-ROBOT | estimated | Hole pattern (3.5 mm inset) taken from the CAD model |
| HC-SR04 | datasheet | Corner hole pitch 41 x 16 is typical, not datasheet |
| OLED-SSD1306 | datasheet | Hole pitch and window offset vary by vendor (±0.5 mm) |
| MPU-6050 | datasheet | Hole centres taken from the CAD model |
| RPI-CAMERA-V2 | datasheet | Lens centre offset from the hole pattern: measure before cutting the window |
| VL53L0X-TOF | estimated | Breakout outline / hole positions vary by vendor |
| MAG-MAGSAFE-RING | estimated | Ring OD/ID vary by vendor |
| PICOCLAW-BOARD | estimated | 30.5 x 38.5 outline, LCD centre (module bottom + 21.5) and key heights are read from Sipeed photos: measure the board |
| PCA9685-SERVO-16 | datasheet | Hole pitch 55.9 x 19.1 follows the common Adafruit board; clones vary. The I2C bus number on the Nano depends on the image |
| JETSON-NANO | datasheet | Mass (≈ 140 g with heatsink) is an estimate |
| MIC-INMP441 | estimated | Round Ø14.5 breakout and port position are typical clone values |
| RESPEAKER-2MIC-HAT | datasheet | Mic positions (board ends, centred in Y) are taken from photos |
| USB-MIC-MINI | estimated | Dongle outline varies by vendor |
| LCD-GC9A01-128 | estimated | Module outline 40.4 x 37.5 and the 34.4 x 31.5 hole pitch follow the Waveshare drawing; clones differ |
| LCD-ST7789-169 | estimated | Module outline 31 x 41 and window position are estimates |
| LCD-ST7789-20 | estimated | Module outline 34.5 x 51 and window position are estimates |
| MG996R-SERVO | datasheet | Not used by the composer housings (micro-class only): design a dedicated mount |
| DS3218-SERVO | datasheet | Stall current and ear pitch are typical values |
| ST3215-SERVO | estimated | Case hole positions are estimates from the Feetech drawing; measure before printing |
| WAVESHARE-SERVO-HAT | datasheet | Regulator rating (3 A) is the vendor figure |
| BUS-SERVO-ADAPTER | estimated | Outline and hole pattern are estimates |
| BUCK-5V-5A | estimated | Generic module outline and hole positions |
| UPS-HAT-PI | estimated | Outline, output current and fuel-gauge address depend on the vendor |
