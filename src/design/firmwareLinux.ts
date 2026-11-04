// Generates the Linux python3 robot app for the voice platforms that run Linux: the LicheeRV Claw kit (Nano W +
// PicoClaw board), Raspberry Pi and Jetson. Standard library only. The robot is an MCP client of the user's AI
// backbone (docs/BACKBONE_MCP.md): initialize + get_profile at boot, then one `converse` call per utterance carrying
// the WAV, the robot's own tools (only what the hardware has) and its state; it runs the returned actions and plays
// the returned WAV. Servos run keyframe behaviours on a PCA9685 (i2c-dev) or Feetech STS bus servos (serial).
// Also exports the helpers the XiaoZhi MicroPython generator shares (hardware detection, face table, tools.py).

import { CATALOG } from '../catalog/components';
import type { Assembly } from '../cad/types';
import type { Behavior } from './behaviors';
import type { Platform, RobotSpec } from './spec';

export const DEFAULT_BACKBONE_URL = 'https://cyberbuild-ai.web.app/api/mcp';

export const py = (v: unknown): string => {
  if (Array.isArray(v)) return `(${v.map(py).join(', ')}${v.length === 1 ? ',' : ''})`;
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${py(x)}`).join(', ')}}`;
  return 'None';
};

/** Folder / app id on the device, e.g. "app_desk_buddy". */
export const linuxAppId = (spec: RobotSpec) => 'app_' + ((spec.name || 'robot').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'robot');

export const LINUX_PLATFORMS: readonly Platform[] = ['licheerv_claw', 'rpi', 'jetson'];
export const isLinuxPlatform = (p?: Platform) => !!p && LINUX_PLATFORMS.includes(p);

// ---------------------------------------------------------------- hardware from the assembly

export type DisplayKind = 'claw' | 'gc9a01' | 'st7789_169' | 'st7789_20' | 'ssd1306' | null;

export interface RobotHardware {
  platform: Platform;
  display: DisplayKind;
  mic: 'builtin' | 'inmp441' | 'respeaker' | 'usb';
  amp: boolean;
  servoDriver: 'pca9685' | 'feetech' | 'pwm' | null;
  servoBoard: string | null;
  leds: number;
  ledBpp: 3 | 4;
}

const PCA_BOARDS = ['PCA9685-SERVO-16', 'WAVESHARE-SERVO-HAT', 'ADAFRUIT-SERVO-BONNET'];

export function robotHardware(spec: RobotSpec, a: Assembly): RobotHardware {
  const platform = spec.platform ?? 'cyberbrick';
  const ids = a.components.map(c => c.catalogId);
  const has = (id: string) => ids.includes(id);
  const display: DisplayKind = has('PICOCLAW-BOARD') || platform === 'licheerv_claw' ? 'claw'
    : has('LCD-GC9A01-128') ? 'gc9a01' : has('LCD-ST7789-169') ? 'st7789_169' : has('LCD-ST7789-20') ? 'st7789_20'
    : has('OLED-SSD1306') ? 'ssd1306' : null;
  const mic = has('RESPEAKER-2MIC-HAT') ? 'respeaker' : has('USB-MIC-MINI') ? 'usb' : has('MIC-INMP441') ? 'inmp441'
    : platform === 'licheerv_claw' ? 'builtin' : platform === 'xiaozhi' ? 'inmp441' : 'usb';
  const moving = a.links.some(l => l.joint);
  const servoBoard = has('BUS-SERVO-ADAPTER') ? 'BUS-SERVO-ADAPTER' : PCA_BOARDS.find(has) ?? (has('SHIELD-ESP32-SERVO') ? 'SHIELD-ESP32-SERVO' : null);
  const servoDriver = !moving ? null : servoBoard === 'BUS-SERVO-ADAPTER' ? 'feetech' : servoBoard && PCA_BOARDS.includes(servoBoard) ? 'pca9685'
    : platform === 'xiaozhi' ? 'pwm' : 'pca9685';
  const rgbw = ids.filter(i => i === 'B-KB003').length, rgb = ids.filter(i => i === 'B-XL001').length;
  return { platform, display, mic, amp: has('AMP-MAX98357A'), servoDriver, servoBoard, leds: rgbw + rgb, ledBpp: rgbw ? 4 : 3 };
}

/** Which side a continuous actuator drives: wheel_L* / wheel_R*; other spinners keep the old order (2nd = right). */
export const driveSide = (w: { id: string }, i: number): 'L' | 'R' =>
  w.id.startsWith('wheel_R') ? 'R' : w.id.startsWith('wheel_L') ? 'L' : i === 1 ? 'R' : 'L';

/**
 * config.py lines for the wheels: per-wheel kind (continuous servo, or a DC motor on an H-bridge whose inputs sit on
 * the servo board channels from the wheel's port), the bridge type, and the PWM cap that keeps a 6 V gear motor near
 * its rating on a 2S pack.
 */
export function driveConfig(a: Assembly, wheels: { id: string; kind: string; catalogId: string }[]) {
  const ids = a.components.map(c => c.catalogId);
  const motor = wheels.find(w => w.kind === 'motor');
  const bat = ids.find(id => CATALOG[id]?.kind === 'battery');
  const full = (CATALOG[bat ?? '']?.data?.voltage ?? 3.7) * 4.2 / 3.7;           // a charged pack
  const rated = motor ? CATALOG[motor.catalogId]?.data?.vMax ?? 6 : 6;
  return [
    `DRIVE_KIND = ${py(wheels.map(w => (w.kind === 'motor' ? 'hbridge' : 'cservo')))}`,
    `MOTOR_DRIVER = ${py(ids.includes('TB6612-DRIVER') ? 'tb6612' : 'drv8833')}   # H-bridge inputs: drv8833 IN1, IN2 / tb6612 PWM, IN1, IN2 from the wheel's channel`,
    `MOTOR_MAX_DUTY = ${py(Math.round(Math.min(1, rated / full) * 100) / 100)}   # ${rated} V motors on a ${full.toFixed(1)} V (full) pack`,
  ].join('\n');
}

export function actuatorsOf(a: Assembly) {
  const degPerUnit = (l: (typeof a.links)[number]) => (l.joint!.type === 'prismatic' ? 180 / (Math.PI * (l.joint!.pinionR ?? 10)) : 1);
  const acts = a.links.filter(l => l.joint).map(l => ({
    id: l.id, ...l.joint!.actuator, scale: degPerUnit(l), ch: Math.max(0, (Number(l.joint!.actuator.port.replace(/\D/g, '')) || 1) - 1),
    limit: l.joint!.limit && (l.joint!.limit.map(v => Math.round(v * degPerUnit(l))) as [number, number]),
  }));
  const servos = acts.filter(x => x.kind === 'servo');
  return { servos, scaled: servos.filter(s => s.scale !== 1), wheels: acts.filter(x => x.kind !== 'servo') };
}

/** Python dict body for BEHAVIORS: id -> (loop, ((t_ms, {joint: deg}, drive | None, rgb | None), ...)). */
export const behaviorTable = (behaviors: Behavior[]) => behaviors.map(b => `    ${py(b.id)}: (${py(b.loop)}, (\n${b.keys.map(k => `        (${py(Math.round(k.t * 1000))}, ${py(k.joints ?? {})}, ${k.drive ? py(k.drive) : 'None'}, ${k.color ? py(k.color) : 'None'}),`).join('\n')}\n    )),`).join('\n');

/** Write the backbone URL / robot token (and Wi-Fi for XiaoZhi) into config.py of a copy of the files. */
export function withBackbone(files: Record<string, string>, o: { url?: string; token?: string; wifiSsid?: string; wifiPass?: string }): Record<string, string> {
  const cfg = files['config.py'];
  if (cfg === undefined) return files;
  let c = cfg;
  const set = (key: string, v?: string) => { if (v !== undefined && v !== '') c = c.replace(new RegExp(`^${key} = .*$`, 'm'), `${key} = ${JSON.stringify(v)}`); };
  set('BACKBONE_URL', o.url?.trim());
  set('ROBOT_TOKEN', o.token?.trim());
  set('WIFI_SSID', o.wifiSsid);
  set('WIFI_PASS', o.wifiPass);
  return { ...files, 'config.py': c };
}

// ---------------------------------------------------------------- shared Python: face table and robot tools

/** Face geometry shared by the Linux framebuffer renderer and the MicroPython framebuf one. */
export const FACE_CORE_PY = String.raw`# Face expressions (the backbone contract's enum) drawn as two eyes and a mouth on any canvas that has
# fill(rgb) and fill_rect(x, y, w, h, rgb). Sizes are for a 240 px screen and scale with the short side.
EXPRESSIONS = ("neutral", "happy", "sad", "surprised", "thinking", "sleepy", "love", "angry", "listening", "speaking")

# name: (eye shape, eye w, eye h, eye dy, look dx, mouth w, mouth h, mouth dy, colour)
FACES = {
    "neutral": ("rect", 40, 70, 0, 0, 60, 10, 0, (80, 200, 255)),
    "happy": ("arc", 48, 30, -10, 0, 90, 14, 0, (255, 210, 60)),
    "sad": ("sad", 42, 50, 10, 0, 40, 8, 12, (90, 140, 255)),
    "surprised": ("rect", 50, 80, -6, 0, 30, 30, 0, (255, 255, 255)),
    "thinking": ("rect", 36, 50, -14, -18, 30, 8, 0, (180, 120, 255)),
    "sleepy": ("rect", 46, 8, 12, 0, 30, 6, 0, (70, 90, 130)),
    "love": ("heart", 58, 52, 0, 0, 60, 12, 0, (255, 90, 160)),
    "angry": ("angry", 48, 50, 0, 0, 60, 8, 0, (255, 70, 50)),
    "listening": ("rect", 44, 76, 0, 0, 24, 24, 0, (60, 230, 140)),
    "speaking": ("rect", 40, 66, 0, 0, 70, 26, 0, (80, 220, 255)),
}
BG = (8, 8, 16)


def eye_spans(shape, w, h, row, left):
    """Horizontal spans (x0, x1) of one eye on row 0..h-1, relative to the eye box."""
    if shape == "arc":
        t = max(2, h // 3)
        return ((0, w),) if row < t else ((0, t), (w - t, w))
    if shape in ("angry", "sad"):
        reach = min(w, w // 3 + 2 * w * row // max(1, h))
        inner_low = (shape == "angry") == left
        return ((0, reach),) if inner_low else ((w - reach, w),)
    if shape == "heart":
        if row < h * 3 // 10:
            return ((w // 20, w * 12 // 25), (w * 13 // 25, w - w // 20))
        m = (row - h * 3 // 10) * w // 2 // max(1, h * 7 // 10)
        return ((m, w - m),)
    return ((0, w),)


def draw_face(cv, name, W, H):
    shape, ew, eh, edy, ldx, mw, mh, mdy, color = FACES.get(name, FACES["neutral"])
    s = min(W, H) / 240
    ew, eh, mw, mh = max(2, int(ew * s)), max(2, int(eh * s)), max(2, int(mw * s)), max(2, int(mh * s))
    cx, cy = W // 2, H // 2
    cv.fill(BG)
    ey = int(cy - 25 * s + edy * s) - eh // 2
    for i, ecx in enumerate((cx - int(50 * s), cx + int(50 * s))):
        x0 = ecx - ew // 2 + int(ldx * s)
        if shape == "rect":
            cv.fill_rect(x0, ey, ew, eh, color)
            continue
        for r in range(eh):
            for a, b in eye_spans(shape, ew, eh, r, i == 0):
                if b > a:
                    cv.fill_rect(x0 + a, ey + r, b - a, 1, color)
    cv.fill_rect(cx - mw // 2, int(cy + 55 * s + mdy * s) - mh // 2, mw, mh, color)
    return color


def wrap(text, cols, max_lines):
    lines, cur = [], ""
    for w in text.split():
        while len(w) > cols:
            if cur:
                lines.append(cur)
                cur = ""
            lines.append(w[:cols])
            w = w[cols:]
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= cols:
            cur += " " + w
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:max_lines]
`;

/** tools.py, the same on Linux and MicroPython: builds robot_tools from the hardware and runs the actions. */
export const toolsPy = (name: string) => String.raw`# ${name}: the robot's own MCP tools (sent in every converse call) and the code that runs the returned actions.
# Only what the hardware has is offered; the backbone never asks for a tool the robot did not send.
import config
from face import EXPRESSIONS
from robot import BEHAVIORS

# drive tool: direction -> (left, right) wheel speed
DRIVE_MOVES = {"forward": (0.7, 0.7), "backward": (-0.7, -0.7), "left": (-0.6, 0.6), "right": (0.6, -0.6)}


def robot_tools():
    tools = []
    if config.HAS_DISPLAY:
        tools.append({"name": "show_face", "description": "Show a facial expression on the robot's screen.",
                      "inputSchema": {"type": "object", "properties": {"expression": {"type": "string", "enum": list(EXPRESSIONS)}},
                                      "required": ["expression"]}})
        tools.append({"name": "show_text", "description": "Show a short text on the robot's screen.",
                      "inputSchema": {"type": "object", "properties": {"text": {"type": "string", "maxLength": 120}},
                                      "required": ["text"]}})
    if BEHAVIORS:
        tools.append({"name": "play_behavior", "description": "Play one of the robot's movement behaviours.",
                      "inputSchema": {"type": "object", "properties": {"name": {"type": "string", "enum": list(BEHAVIORS)}},
                                      "required": ["name"]}})
    if config.SERVOS:
        tools.append({"name": "move_joint", "description": "Move one joint to an angle in degrees (0 = rest pose).",
                      "inputSchema": {"type": "object", "properties": {"joint": {"type": "string", "enum": list(config.SERVOS)},
                                                                       "degrees": {"type": "number"}},
                                      "required": ["joint", "degrees"]}})
    if config.HAS_LEDS:
        tools.append({"name": "set_led", "description": "Set the robot's LED colour.",
                      "inputSchema": {"type": "object", "properties": {"color": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"}},
                                      "required": ["color"]}})
    if config.HAS_WHEELS:
        tools.append({"name": "drive", "description": "Drive on the wheels for a moment, then stop: forward / backward, or turn left / right on the spot. Only when asked to move or come closer.",
                      "inputSchema": {"type": "object", "properties": {"direction": {"type": "string", "enum": ["forward", "backward", "left", "right"]},
                                                                       "seconds": {"type": "number", "minimum": 0.2, "maximum": 3}},
                                      "required": ["direction", "seconds"]}})
    tools.append({"name": "set_volume", "description": "Set the speaker volume, 0 to 100.",
                  "inputSchema": {"type": "object", "properties": {"level": {"type": "integer", "minimum": 0, "maximum": 100}},
                                  "required": ["level"]}})
    return tools


class Tools:
    def __init__(self, bot, display, audio):
        self.bot, self.display, self.audio = bot, display, audio
        self.list = robot_tools()
        self.names = [t["name"] for t in self.list]
        self.ran = []           # (tool, arguments, result) of every action, newest last
        self.text_shown = False

    def run(self, action):
        name = action.get("tool") or action.get("name")
        args = action.get("arguments") or {}
        if name not in self.names:
            res = "unknown tool %s" % name
        else:
            try:
                res = self._run(name, args)
            except Exception as e:
                res = "error: %s" % e
        self.ran.append((name, args, res))
        self.ran = self.ran[-20:]
        return "%s -> %s" % (name, res)

    def _run(self, name, a):
        if name == "show_face":
            e = a.get("expression")
            if e not in EXPRESSIONS:
                return "bad expression"
            self.display.face(e)
        elif name == "show_text":
            self.display.text(str(a.get("text", ""))[:120])
            self.text_shown = True
        elif name == "play_behavior":
            if not self.bot.play(a.get("name")):
                return "unknown behaviour"
        elif name == "move_joint":
            j = a.get("joint")
            if j not in config.SERVOS:
                return "unknown joint"
            self.bot.stop()
            self.bot.set_joint(j, float(a.get("degrees", 0)))
        elif name == "set_led":
            c = str(a.get("color", "")).lstrip("#")
            if len(c) != 6:
                return "bad colour"
            self.bot.set_color((int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)))
        elif name == "set_volume":
            self.audio.set_volume(max(0, min(100, int(a.get("level", 70)))))
        elif name == "drive":
            lr = DRIVE_MOVES.get(a.get("direction"))
            if not lr:
                return "bad direction"
            self.bot.drive_for(lr[0], lr[1], float(a.get("seconds", 1)))
        return "ok"
`;

// 5x7 ASCII font (0x20..0x7E), 5 column bytes per glyph, bit 0 = top row.
const FONT5X7 = [
  '0000000000', '00005f0000', '0007000700', '147f147f14', '242a7f2a12', '2313086462', '3649552250', '0005030000',
  '001c224100', '0041221c00', '082a1c2a08', '08083e0808', '0050300000', '0808080808', '0060600000', '2010080402',
  '3e5149453e', '00427f4000', '4261514946', '2141454b31', '1814127f10', '2745454539', '3c4a494930', '0171090503',
  '3649494936', '064949291e', '0036360000', '0056360000', '0008142241', '1414141414', '4122140800', '0201510906',
  '324979413e', '7e1111117e', '7f49494936', '3e41414122', '7f4141221c', '7f49494941', '7f09090101', '3e41415132',
  '7f0808087f', '00417f4100', '2040413f01', '7f08142241', '7f40404040', '7f0204027f', '7f0408107f', '3e4141413e',
  '7f09090906', '3e4151215e', '7f09192946', '4649494931', '01017f0101', '3f4040403f', '1f2040201f', '7f2018207f',
  '6314081463', '0304780403', '6151494543', '00007f4141', '0204081020', '41417f0000', '0402010204', '4040404040',
  '0001020400', '2054545478', '7f48444438', '3844444420', '384444487f', '3854545418', '087e090102', '081454543c',
  '7f08040478', '00447d4000', '2040443d00', '007f102844', '00417f4000', '7c04180478', '7c08040478', '3844444438',
  '7c14141408', '081414187c', '7c08040408', '4854545420', '043f444020', '3c4040207c', '1c2040201c', '3c4030403c',
  '4428102844', '0c5050503c', '4464544c44', '0008364100', '00007f0000', '0041360800', '0804081008',
].join('');

// ---------------------------------------------------------------- the Linux app

export function linuxFirmwareFiles(spec: RobotSpec, a: Assembly, behaviors: Behavior[]): Record<string, string> {
  const hw = robotHardware(spec, a);
  const plat = hw.platform === 'licheerv_claw' ? 'claw' : hw.platform === 'jetson' ? 'jetson' : 'rpi';
  const claw = plat === 'claw';
  const { servos, scaled, wheels } = actuatorsOf(a);
  const app = linuxAppId(spec);
  const name = spec.name || 'PICOCEO robot';
  const board = claw ? 'LicheeRV Claw kit' : plat === 'rpi' ? 'Raspberry Pi' : 'Jetson';
  const feetech = hw.servoDriver === 'feetech';
  const pca = hw.servoDriver === 'pca9685';
  const hasDisplay = hw.display !== null;
  const hasLeds = claw || hw.leds > 0;

  const mic = hw.mic === 'respeaker' ? '"plughw:CARD=seeed2micvoicec,DEV=0"' : hw.mic === 'usb' && !claw ? '"plughw:CARD=Device,DEV=0"' : 'None';
  const spk = hw.mic === 'respeaker' ? '"plughw:CARD=seeed2micvoicec,DEV=0"' : hw.amp && plat === 'rpi' ? '"plughw:CARD=MAX98357A,DEV=0"' : 'None';
  const mixer = hw.mic === 'respeaker' ? 'Speaker' : claw ? 'Master' : 'PCM';

  const appYaml = `id: ${app}
name: ${JSON.stringify(name)}
version: 2.0.0
author: PICOCEO Builder
desc: ${JSON.stringify(`${spec.archetype} voice robot for the LicheeRV Claw kit`)}
files:
  - app.yaml
  - main.py
  - config.py
  - backbone.py
  - audio.py
  - face.py
  - tools.py
  - robot.py
  - board.py
${pca ? '  - pca9685.py\n' : ''}${feetech ? '  - feetech.py\n' : ''}`;

  const config = String.raw`# ${name} - generated by PICOCEO Builder. Configuration for the ${board} robot app.
# Everything the app needs to know about this robot lives here; edit and restart the app to apply.
PLATFORM = "${plat}"
ROBOT_NAME = ${py(name)}

# ---------------------------------------------------------------- AI backbone (MCP over HTTPS, docs/BACKBONE_MCP.md)
# The robot token comes from the AI Brain section of PICOCEO Builder ("Pair a robot"). It is a secret: keep this file private.
BACKBONE_URL = ${py(DEFAULT_BACKBONE_URL)}
ROBOT_TOKEN = ""
HTTP_TIMEOUT_S = 45
HTTP_RETRIES = 2
VOICE_OUT = True            # ask the backbone for a spoken WAV reply (False: text only, shown on the screen)
AUDIO_OUT_RATE = 16000
LOCAL_TTS = ["espeak-ng"]   # used only for the boot greeting, and only when installed

# ---------------------------------------------------------------- audio (ALSA tools: arecord / aplay / amixer)
ARECORD = ["arecord"]
APLAY = ["aplay"]
AMIXER = ["amixer"]
# ALSA devices: run "arecord -l" / "aplay -l". None = the ALSA default device.
MIC_DEVICE = ${mic}
SPEAKER_DEVICE = ${spk}
MIXER_CARD = None           # amixer -c <card>; None = default card
MIXER_CONTROL = "${mixer}"     # "amixer scontrols" lists the names; software gain is used when amixer fails
VOLUME = 70
RECORD_MAX_S = 15
LISTEN_MODE = "ptt"         # "ptt": record while the talk button is held; "vad": press once, stops on silence
VAD_THRESHOLD = 600         # RMS of 16-bit samples that counts as speech
VAD_SILENCE_S = 0.9
VAD_WAIT_S = 6

# ---------------------------------------------------------------- talk button
${claw ? `# PicoClaw side keys (sysfs GPIO): left = hold to talk, right = next behaviour, hold right 2 s = quit.
BUTTON = "claw"
KEY_GPIOS = (504, 509)      # (left, right). Swap if your board is reversed
KEY_ACTIVE_LOW = True
# The stock PicoClaw app owns the LCD and keys; this init script is started again when you quit.
PICOCLAW_INIT = "/etc/init.d/S99picoclaw"` : plat === 'rpi' ? `# Push-to-talk button between GPIO17 (BCM, header pin 11) and GND, read with gpiozero (the ReSpeaker 2-mic HAT
# has its button on GPIO17 too). Without gpiozero: press Enter in the terminal to start and again to stop.
BUTTON = "gpiozero"
BUTTON_PIN = 17` : `# Push-to-talk button on header pin 11 (BOARD numbering) to GND with an external 10k pull-up, read with Jetson.GPIO.
# Without Jetson.GPIO: press Enter in the terminal to start and again to stop.
BUTTON = "jetson"
BUTTON_PIN = 11`}
BUTTON_ACTIVE_LOW = True

# ---------------------------------------------------------------- display
HAS_DISPLAY = ${py(hasDisplay)}${hasDisplay ? '' : '         # True to draw the face on /dev/fb0 (HDMI or an SPI LCD with its overlay)'}
FRAMEBUFFER = "/dev/fb0"    # without it the face and texts go to stdout${claw ? '' : '. An SPI LCD next to HDMI is often /dev/fb1'}
LCD_SIZE = (240, 240)       # used when the framebuffer does not report its size

# ---------------------------------------------------------------- LEDs
HAS_LEDS = ${py(hasLeds)}
${claw ? 'LED_GPIOS = (495, 498)      # PicoClaw status LEDs (sysfs GPIO, on / off)' : `LED_SPI = "/dev/spidev0.0"  # WS2812 data on SPI MOSI (${plat === 'rpi' ? 'GPIO10, header pin 19; enable SPI with raspi-config' : 'header pin 19; enable SPI with jetson-io'})
LED_COUNT = ${hw.leds}
LED_BPP = ${hw.ledBpp}                 # 4 = RGBW (B-KB003), 3 = RGB (B-XL001)
LED_BRIGHTNESS = 0.3`}

# ---------------------------------------------------------------- servos
SERVO_DRIVER = ${hw.servoDriver === 'pca9685' || feetech ? `"${hw.servoDriver}"` : 'None'}${hw.servoBoard ? `   # ${hw.servoBoard}` : ''}
# PCA9685 (I2C, 0x40). Channel = servo port - 1 (S1 -> ch0). None = ${plat === 'jetson' ? 'auto: bus 7 on Orin, 1 on Nano' : 'bus 1'}.
I2C_BUS = ${plat === 'jetson' ? 'None' : '1'}
PCA_ADDR = 0x40
SERVO_FREQ = 50
# Feetech STS / ST3215 bus servos: servo id = channel + 1, 1 Mbps on the USB adapter (or /dev/ttyAMA0 on the Pi UART).
BUS_SERVO_PORT = "/dev/ttyUSB0"
BUS_SERVO_BAUD = 1000000
BUS_WHEEL_SPEED = 2000      # steps/s at full drive for continuous (wheel mode) bus servos

# Positional servos: name -> (channel, direction, (min, max) logical degrees)
SERVOS = {
${servos.map(s => `    ${py(s.id)}: (${s.ch}, 1, ${py(s.limit ?? [-90, 90])}),   # ${s.port} ${s.label}`).join('\n')}
}

# Rack-and-pinion joints: behaviours command mm of travel; servo degrees = mm * scale.
JOINT_SCALE = {${scaled.map(s => `${py(s.id)}: ${py(Math.round(s.scale * 1000) / 1000)}`).join(', ')}}

# Continuous-rotation servos (1500 us = stop): channels, direction, trim in us
DRIVE_CHANNELS = ${py(wheels.map(w => w.ch))}
DRIVE_SIDE = ${py(wheels.map(driveSide))}      # L / R wheel (a spin joint follows L)
DRIVE_DIR = ${py(wheels.map((w, i) => (driveSide(w, i) === 'R' ? -1 : 1)))}
DRIVE_TRIM_US = [${wheels.map(() => '0').join(', ')}]
HAS_WHEELS = ${wheels.some(w => w.id.startsWith('wheel_')) ? 'True' : 'False'}
${driveConfig(a, wheels)}

PULSE_MIN_US = 500
PULSE_MAX_US = 2500
SERVO_SPEED_DEG_S = 400

# Trim in degrees per positional servo, set with "t <joint> <deg>" and stored by "save".
TRIM = {${servos.map(s => `${py(s.id)}: 0`).join(', ')}}

CMD_PORT = 8765             # line commands over the network: nc <robot-ip> 8765
FRAME_MS = 20
`;

  const backbone = String.raw`# MCP client of the PICOCEO AI backbone: JSON-RPC 2.0 over HTTPS (urllib), Bearer robot token, timeouts and
# retries. The token is never printed or logged.
import base64
import json
import time
import urllib.error
import urllib.request

import config

PROTOCOL = "2025-06-18"


class BackboneError(Exception):
    pass


class Backbone:
    def __init__(self, url=None, token=None):
        self.url = url or config.BACKBONE_URL
        self.token = config.ROBOT_TOKEN if token is None else token
        self.next_id = 0
        self.info = None

    def rpc(self, method, params=None, notify=False, retries=None, timeout=None):
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        if not notify:
            self.next_id += 1
            msg["id"] = self.next_id
        body = json.dumps(msg).encode("utf-8")
        headers = {
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL,
            "User-Agent": "picoceo-robot/" + config.PLATFORM,
        }
        tries = config.HTTP_RETRIES if retries is None else retries
        last = None
        for attempt in range(tries + 1):
            if attempt:
                time.sleep(min(8.0, 1.5 * 2 ** (attempt - 1)))
            req = urllib.request.Request(self.url, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=timeout or config.HTTP_TIMEOUT_S) as r:
                    raw = r.read()
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    raise BackboneError("the backbone refused the robot token (HTTP %d): check ROBOT_TOKEN in config.py" % e.code)
                if e.code < 500 and e.code != 429:
                    raise BackboneError("HTTP %d: %s" % (e.code, _detail(e)))
                last = "HTTP %d" % e.code
                continue
            except (urllib.error.URLError, OSError) as e:      # includes timeouts
                last = getattr(e, "reason", None) or e
                continue
            if notify or not raw:
                return None
            try:
                resp = json.loads(raw.decode("utf-8"))
            except ValueError:
                last = "bad JSON from the backbone"
                continue
            if resp.get("error"):
                err = resp["error"]
                raise BackboneError("%s (%s)" % (err.get("message"), err.get("code")))
            return resp.get("result") or {}
        raise BackboneError("backbone unreachable: %s" % last)

    def initialize(self):
        self.info = self.rpc("initialize", {
            "protocolVersion": PROTOCOL, "capabilities": {},
            "clientInfo": {"name": "picoceo-robot-" + config.PLATFORM, "version": "2.0.0"},
        })
        try:
            self.rpc("notifications/initialized", notify=True, retries=0)
        except BackboneError:
            pass
        return self.info

    def call_tool(self, name, arguments, retries=None):
        r = self.rpc("tools/call", {"name": name, "arguments": arguments}, retries=retries)
        text = "".join(c.get("text", "") for c in r.get("content") or [] if c.get("type") == "text")
        if r.get("isError"):
            raise BackboneError(text or "%s failed" % name)
        sc = r.get("structuredContent") or {}
        sc.setdefault("text", text)
        return sc

    def get_profile(self):
        return self.call_tool("get_profile", {})

    def converse(self, audio_wav=None, text=None, robot_tools=(), state=None, audio_out=True):
        args = {"robot_tools": list(robot_tools)}
        if text:
            args["text"] = text
        if audio_wav:
            args["audio"] = {"mime": "audio/wav", "data": base64.b64encode(audio_wav).decode("ascii")}
        if state:
            args["state"] = state
        if audio_out:
            args["audio_out"] = {"format": "wav", "rate": config.AUDIO_OUT_RATE}
        sc = self.call_tool("converse", args, retries=1)
        if not sc.get("reply"):
            sc["reply"] = sc.get("text", "")
        audio = sc.get("audio") or {}
        if audio.get("data"):
            sc["wav"] = base64.b64decode(audio["data"])
        return sc


def _detail(e):
    try:
        j = json.loads(e.read().decode("utf-8"))
        return (j.get("error") or {}).get("message") or str(j)[:200]
    except Exception:
        return e.reason
`;

  const audio = String.raw`# Microphone and speaker through the ALSA command line tools: arecord (16 kHz mono 16-bit WAV, from press to
# release, max RECORD_MAX_S, or an energy VAD), aplay, and amixer for the volume (software gain when it fails).
import array
import os
import signal
import struct
import subprocess
import sys
import tempfile
import time

import config

RATE = 16000


def _cmd(base, device, *args):
    c = list(base)
    if device:
        c += ["-D", device]
    return c + [str(a) for a in args]


def pcm_to_wav(pcm, rate=RATE, channels=1, bits=16):
    n = len(pcm)
    return (b"RIFF" + struct.pack("<I", 36 + n) + b"WAVEfmt " +
            struct.pack("<IHHIIHH", 16, 1, channels, rate, rate * channels * bits // 8, channels * bits // 8, bits) +
            b"data" + struct.pack("<I", n) + bytes(pcm))


def wav_parts(data):
    """(rate, channels, bits, data offset, data length) of a PCM WAV, or None."""
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    i, fmt = 12, None
    while i + 8 <= len(data):
        cid, size = data[i:i + 4], struct.unpack("<I", data[i + 4:i + 8])[0]
        if cid == b"fmt ":
            _, ch, rate, _, _, bits = struct.unpack("<HHIIHH", data[i + 8:i + 24])
            fmt = (rate, ch, bits)
        elif cid == b"data" and fmt:
            return fmt + (i + 8, min(size, len(data) - i - 8))
        i += 8 + size + (size & 1)
    return None


def wav_fix(data):
    """arecord stopped by a signal can leave placeholder sizes in the header: rewrite them from the file length."""
    p = wav_parts(data)
    if not p:
        return data
    b = bytearray(data)
    off, n = p[3], len(data) - p[3]
    b[4:8] = struct.pack("<I", len(data) - 8)
    b[off - 4:off] = struct.pack("<I", n)
    return bytes(b)


def _scale(wav, gain):
    p = wav_parts(wav)
    if not p or p[2] != 16:
        return wav
    off, n = p[3], p[4] - p[4] % 2
    s = array.array("h", wav[off:off + n])
    if sys.byteorder != "little":
        s.byteswap()
    for i in range(len(s)):
        s[i] = int(s[i] * gain)
    if sys.byteorder != "little":
        s.byteswap()
    return wav[:off] + s.tobytes() + wav[off + n:]


class Audio:
    def __init__(self):
        self.proc = None
        self.path = None
        self.t0 = 0.0
        self.gain = 1.0
        self.level = config.VOLUME
        self.set_volume(config.VOLUME)

    # ---- push to talk
    def start(self):
        if self.proc:
            return
        fd, self.path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            self.proc = subprocess.Popen(
                _cmd(config.ARECORD, config.MIC_DEVICE, "-q", "-f", "S16_LE", "-r", RATE, "-c", 1, "-t", "wav",
                     "-d", config.RECORD_MAX_S, self.path),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.t0 = time.monotonic()
        except OSError as e:
            print("arecord failed: %s" % e)
            self.proc = None

    def recording(self):
        return self.proc is not None

    def expired(self):
        return bool(self.proc) and (self.proc.poll() is not None or time.monotonic() - self.t0 > config.RECORD_MAX_S + 0.5)

    def stop(self):
        """Stop recording; returns the WAV bytes, or None when nothing (or under 0.3 s) was recorded."""
        proc, self.proc = self.proc, None
        if not proc:
            return None
        if proc.poll() is None:
            try:
                proc.send_signal(signal.SIGINT)      # arecord finishes the WAV header on SIGINT
            except (ValueError, OSError):
                proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        try:
            with open(self.path, "rb") as f:
                data = f.read()
            os.remove(self.path)
        except OSError:
            return None
        data = wav_fix(data)
        p = wav_parts(data)
        return data if p and p[4] >= RATE * 2 * 3 // 10 else None

    # ---- hands-free: energy VAD
    def record_vad(self):
        """Record until VAD_SILENCE_S of silence after speech (max RECORD_MAX_S). None if nobody spoke."""
        try:
            proc = subprocess.Popen(_cmd(config.ARECORD, config.MIC_DEVICE, "-q", "-f", "S16_LE", "-r", RATE, "-c", 1, "-t", "raw"),
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except OSError as e:
            print("arecord failed: %s" % e)
            return None
        chunk = RATE * 2 * 3 // 100           # 30 ms
        pcm, started, quiet, t0 = bytearray(), False, 0.0, time.monotonic()
        try:
            while True:
                buf = proc.stdout.read(chunk)
                if not buf:
                    break
                s = array.array("h", buf[:len(buf) - len(buf) % 2])
                rms = (sum(v * v for v in s) / max(1, len(s))) ** 0.5
                if started:
                    pcm += buf
                    quiet = quiet + 0.03 if rms < config.VAD_THRESHOLD else 0.0
                    if quiet >= config.VAD_SILENCE_S or len(pcm) >= RATE * 2 * config.RECORD_MAX_S:
                        break
                elif rms >= config.VAD_THRESHOLD:
                    started = True
                    pcm += buf
                elif time.monotonic() - t0 > config.VAD_WAIT_S:
                    break
        finally:
            proc.terminate()
            proc.wait()
        return pcm_to_wav(pcm) if started and len(pcm) >= RATE * 2 * 3 // 10 else None

    # ---- speaker
    def play(self, wav):
        if self.level <= 0 or not wav:
            return
        if self.gain < 0.999:
            wav = _scale(wav, self.gain)
        fd, path = tempfile.mkstemp(suffix=".wav")
        with os.fdopen(fd, "wb") as f:
            f.write(wav)
        try:
            subprocess.run(_cmd(config.APLAY, config.SPEAKER_DEVICE, "-q", path), timeout=180,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.TimeoutExpired) as e:
            print("aplay failed: %s" % e)
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    def set_volume(self, level):
        self.level = max(0, min(100, int(level)))
        cmd = list(config.AMIXER) + (["-c", str(config.MIXER_CARD)] if config.MIXER_CARD is not None else [])
        try:
            ok = subprocess.run(cmd + ["-q", "sset", config.MIXER_CONTROL, "%d%%" % self.level], timeout=5,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            ok = False
        self.gain = 1.0 if ok else self.level / 100.0
        return ok
`;

  const face = String.raw`# ${name}: the face on the framebuffer (16 / 24 / 32-bit /dev/fb0), or text on stdout when there is none.
import os
import unicodedata

import config

${FACE_CORE_PY}
FONT = bytes.fromhex("${FONT5X7}")


class Canvas:
    def __init__(self, w, h, bpp):
        self.w, self.h, self.bpp = w, h, bpp
        self.n = bpp // 8
        self.buf = bytearray(w * h * self.n)
        self._cache = {}

    def px(self, rgb):
        p = self._cache.get(rgb)
        if p is None:
            r, g, b = rgb
            if self.bpp == 16:
                v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
                p = bytes((v & 0xFF, v >> 8))
            elif self.bpp == 24:
                p = bytes((b, g, r))
            else:
                p = bytes((b, g, r, 255))
            self._cache[rgb] = p
        return p

    def fill(self, rgb):
        self.buf[:] = self.px(rgb) * (self.w * self.h)

    def fill_rect(self, x, y, w, h, rgb):
        x0, y0 = max(0, int(x)), max(0, int(y))
        x1, y1 = min(self.w, int(x + w)), min(self.h, int(y + h))
        if x1 <= x0 or y1 <= y0:
            return
        row = self.px(rgb) * (x1 - x0)
        for yy in range(y0, y1):
            o = (yy * self.w + x0) * self.n
            self.buf[o:o + len(row)] = row

    def text(self, x, y, s, rgb, scale=1):
        for i, ch in enumerate(s):
            c = ord(ch)
            g = (c - 32 if 32 <= c < 127 else 31) * 5
            for col in range(5):
                bits = FONT[g + col]
                for row in range(7):
                    if bits >> row & 1:
                        self.fill_rect(x + (i * 6 + col) * scale, y + row * scale, scale, scale, rgb)


def ascii_text(s):
    s = s.replace("đ", "d").replace("Đ", "D")
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def _read(path):
    with open(path) as f:
        return f.read().strip()


class Display:
    def __init__(self):
        self.fb = None
        self.current = "neutral"
        self.w, self.h = config.LCD_SIZE
        if not config.HAS_DISPLAY:
            return
        try:
            sysfs = "/sys/class/graphics/" + os.path.basename(config.FRAMEBUFFER)
            bpp = int(_read(sysfs + "/bits_per_pixel"))
            try:
                w, h = _read(sysfs + "/virtual_size").split(",")
                self.w, self.h = int(w), int(h)
            except (OSError, ValueError):
                pass
            try:
                self.stride = int(_read(sysfs + "/stride"))
            except (OSError, ValueError):
                self.stride = self.w * bpp // 8
            if bpp not in (16, 24, 32):
                raise ValueError("%d bits per pixel is not supported" % bpp)
            self.cv = Canvas(self.w, self.h, bpp)
            self.fb = open(config.FRAMEBUFFER, "r+b")
        except (OSError, ValueError) as e:
            print("display: framebuffer unavailable (%s), face and texts go to stdout" % e)
            self.fb = None

    def _flush(self):
        n = self.cv.n
        if self.stride == self.w * n:
            data = self.cv.buf
        else:
            pad = b"\0" * (self.stride - self.w * n)
            data = b"".join(bytes(self.cv.buf[y * self.w * n:(y + 1) * self.w * n]) + pad for y in range(self.h))
        self.fb.seek(0)
        self.fb.write(data)
        self.fb.flush()

    def face(self, name):
        if name not in FACES:
            name = "neutral"
        self.current = name
        if not self.fb:
            print("[face] %s" % name)
            return
        draw_face(self.cv, name, self.w, self.h)
        self._flush()

    def text(self, s):
        s = ascii_text(str(s))[:120]
        if not self.fb:
            print("[%s] %s" % (config.ROBOT_NAME, s))
            return
        draw_face(self.cv, self.current, self.w, self.h)
        k =max(1, min(self.w, self.h) // 240)
        scale = 2 * k if len(s) <= (self.w // (12 * k)) * 3 else k
        cols = self.w // (6 * scale)
        lines = wrap(s, cols, 3 if scale > k else 6)
        top = self.h - len(lines) * 9 * scale - 6 * k
        self.cv.fill_rect(0, top - 4 * k, self.w, self.h - top + 4 * k, BG)
        for i, line in enumerate(lines):
            self.cv.text((self.w - len(line) * 6 * scale) // 2, top + i * 9 * scale, line, (240, 240, 240), scale)
        self._flush()
`;

  const pcaPy = String.raw`# PCA9685 16-channel PWM driver over Linux i2c-dev (no extra Python packages needed).
import fcntl
import os
import time

I2C_SLAVE = 0x0703
MODE1, PRESCALE, LED0 = 0x00, 0xFE, 0x06


class PCA9685:
    def __init__(self, bus, addr=0x40, freq=50):
        self.fd = os.open("/dev/i2c-%d" % bus, os.O_RDWR)
        fcntl.ioctl(self.fd, I2C_SLAVE, addr)
        self.freq = freq
        self._write(MODE1, 0x00)
        self.set_freq(freq)

    def _write(self, reg, *data):
        os.write(self.fd, bytes((reg,) + data))

    def _read(self, reg):
        os.write(self.fd, bytes((reg,)))
        return os.read(self.fd, 1)[0]

    def set_freq(self, hz):
        prescale = int(round(25000000.0 / (4096 * hz))) - 1
        old = self._read(MODE1) & 0x7F
        self._write(MODE1, old | 0x10)          # sleep to change the prescaler
        self._write(PRESCALE, prescale)
        self._write(MODE1, old)
        time.sleep(0.005)
        self._write(MODE1, old | 0xA0)          # restart + register auto-increment
        self.freq = hz

    def pulse_us(self, ch, us):
        ticks = max(0, min(4095, int(us * self.freq * 4096 / 1000000)))
        self._write(LED0 + 4 * ch, 0, 0, ticks & 0xFF, ticks >> 8)

    def release(self, ch):
        self._write(LED0 + 4 * ch, 0, 0, 0, 0x10)   # full off: servo goes limp

    def close(self):
        os.close(self.fd)
`;

  const feetechPy = String.raw`# Minimal Feetech STS / SCS serial bus servo driver (ST3215 and friends), half-duplex at 1 Mbps over the USB
# bus servo adapter (/dev/ttyUSB0) or the Pi UART. Writes only: goal position, wheel speed, torque, mode.
import os
import termios

WRITE = 0x03
TORQUE_ENABLE, GOAL_POSITION, GOAL_SPEED, MODE, LOCK = 40, 42, 46, 33, 55


class STS:
    def __init__(self, port, baud=1000000):
        self.fd = os.open(port, os.O_RDWR | os.O_NOCTTY)
        attrs = termios.tcgetattr(self.fd)
        speed = getattr(termios, "B%d" % baud)
        attrs[0] = 0                                    # iflag
        attrs[1] = 0                                    # oflag
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
        attrs[3] = 0                                    # lflag: raw
        attrs[4] = attrs[5] = speed
        attrs[6][termios.VMIN] = 0
        attrs[6][termios.VTIME] = 0
        termios.tcsetattr(self.fd, termios.TCSANOW, attrs)

    def write(self, sid, addr, data):
        body = bytes((sid, len(data) + 3, WRITE, addr)) + bytes(data)
        os.write(self.fd, b"\xff\xff" + body + bytes(((~sum(body)) & 0xFF,)))
        termios.tcdrain(self.fd)
        termios.tcflush(self.fd, termios.TCIFLUSH)      # drop the status packets we do not read

    def torque(self, sid, on):
        self.write(sid, TORQUE_ENABLE, (1 if on else 0,))

    def wheel_mode(self, sid):
        self.write(sid, LOCK, (0,))
        self.write(sid, MODE, (1,))
        self.write(sid, LOCK, (1,))

    def move(self, sid, pos, speed=0):
        pos = max(0, min(4095, int(pos)))
        self.write(sid, GOAL_POSITION, (pos & 0xFF, pos >> 8, 0, 0, speed & 0xFF, speed >> 8))

    def speed(self, sid, v):
        v = int(v)
        raw = min(32767, abs(v)) | (0x8000 if v < 0 else 0)
        self.write(sid, GOAL_SPEED, (raw & 0xFF, raw >> 8))

    def close(self):
        os.close(self.fd)
`;

  const boardPy = String.raw`# ${board} inputs and LEDs: the talk button (${claw ? 'PicoClaw side keys on sysfs GPIO' : plat === 'rpi' ? 'gpiozero' : 'Jetson.GPIO'}, or Enter on
# the keyboard) and the LEDs (${claw ? 'PicoClaw status LEDs on sysfs GPIO' : 'WS2812 chain on SPI MOSI'}).
import os
import time

import config


def _write(path, value):
    with open(path, "w") as f:
        f.write(str(value))


class Gpio:
    """A sysfs GPIO line."""
    def __init__(self, n, out=False):
        base = "/sys/class/gpio/gpio%d" % n
        if not os.path.exists(base):
            _write("/sys/class/gpio/export", n)
            time.sleep(0.05)
        _write(base + "/direction", "out" if out else "in")
        self.value_path = base + "/value"

    def read(self):
        with open(self.value_path) as f:
            return f.read().strip() == "1"

    def write(self, on):
        _write(self.value_path, 1 if on else 0)


class Inputs:
    """poll() returns events: "talk_down", "talk_up", "next", "quit". Without a button, toggle() (Enter) talks."""
    def __init__(self):
        self.is_down = None
        self.keys = []
        self.down_t = []
        self.talk = False
        self.queue = []
        kind = config.BUTTON
        if kind == "claw":
            for n in config.KEY_GPIOS:
                try:
                    self.keys.append(Gpio(n))
                except OSError as e:
                    print("key gpio %d unavailable: %s" % (n, e))
                    self.keys.append(None)
            self.down_t = [None] * len(self.keys)
            if self.keys and self.keys[0]:
                self.is_down = lambda: self.keys[0].read() != config.KEY_ACTIVE_LOW
        elif kind == "gpiozero":
            try:
                from gpiozero import Button
                self._btn = Button(config.BUTTON_PIN, pull_up=config.BUTTON_ACTIVE_LOW)
                self.is_down = lambda: self._btn.is_pressed
            except Exception as e:
                print("gpiozero button unavailable (%s): press Enter to talk" % e)
        elif kind == "jetson":
            try:
                import Jetson.GPIO as GPIO
                GPIO.setmode(GPIO.BOARD)
                GPIO.setup(config.BUTTON_PIN, GPIO.IN)
                self.is_down = lambda: (GPIO.input(config.BUTTON_PIN) == 0) == config.BUTTON_ACTIVE_LOW
            except Exception as e:
                print("Jetson.GPIO button unavailable (%s): press Enter to talk" % e)
        self.keyboard = self.is_down is None

    def toggle(self):
        self.talk = not self.talk
        self.queue.append("talk_down" if self.talk else "talk_up")

    def poll(self):
        events, self.queue = self.queue, []
        if self.is_down:
            try:
                down = self.is_down()
            except Exception:
                down = self.talk
            if down != self.talk:
                self.talk = down
                events.append("talk_down" if down else "talk_up")
        now = time.monotonic()
        for i, k in enumerate(self.keys[1:], 1):           # extra PicoClaw key: short = next behaviour, 2 s = quit
            if not k:
                continue
            try:
                pressed = k.read() != config.KEY_ACTIVE_LOW
            except OSError:
                continue
            if pressed and self.down_t[i] is None:
                self.down_t[i] = now
            elif not pressed and self.down_t[i] is not None:
                events.append("quit" if now - self.down_t[i] > 2.0 else "next")
                self.down_t[i] = None
        return events


${claw ? String.raw`class Leds:
    def __init__(self):
        self.leds = []
        for n in config.LED_GPIOS:
            try:
                self.leds.append(Gpio(n, out=True))
            except OSError:
                pass

    def fill(self, r, g, b):
        on = max(r, g, b) > 40
        for led in self.leds:
            try:
                led.write(on)
            except OSError:
                pass` : String.raw`class Leds:
    """WS2812 / SK6812 chain driven from SPI MOSI at 6.4 MHz: one SPI byte per LED bit (0 = 0xC0, 1 = 0xF8)."""
    SPI_IOC_WR_MAX_SPEED_HZ = 0x40046B04

    def __init__(self):
        self.fd = None
        if not config.HAS_LEDS or not config.LED_COUNT:
            return
        try:
            import fcntl
            import struct
            self.fd = os.open(config.LED_SPI, os.O_WRONLY)
            fcntl.ioctl(self.fd, self.SPI_IOC_WR_MAX_SPEED_HZ, struct.pack("<I", 6400000))
        except (OSError, ImportError) as e:
            print("LEDs: %s unavailable (%s)" % (config.LED_SPI, e))
            self.fd = None

    def fill(self, r, g, b):
        if self.fd is None:
            return
        k = config.LED_BRIGHTNESS
        px = (int(g * k), int(r * k), int(b * k)) + ((0,) if config.LED_BPP == 4 else ())
        bits = bytearray()
        for v in px:
            for i in range(7, -1, -1):
                bits.append(0xF8 if v >> i & 1 else 0xC0)
        try:
            os.write(self.fd, bytes(bits) * config.LED_COUNT + b"\0" * 64)
        except OSError:
            pass`}
`;

  const robotPy = String.raw`# ${name}: joints, drive and behaviour playback. Keyframes are the same ones the PICOCEO Builder
# simulator runs: (time_ms, {joint: deg}, (left, right) | None, (r, g, b) | None).
import json
import os
import time

import config
from board import Leds

BEHAVIORS = {
${behaviorTable(behaviors)}
}

HERE = os.path.dirname(os.path.abspath(__file__))
TRIM_FILE = os.path.join(HERE, "trim.json")


def i2c_bus():
    if config.I2C_BUS is not None:
        return config.I2C_BUS
    try:
        with open("/proc/device-tree/model") as f:
            model = f.read()
    except OSError:
        model = ""
    return 7 if "Orin" in model else 1


def hbridge(out, ch, s):
    """A DC motor on an H-bridge whose inputs are servo board channels (a full-period pulse = input high).
    DRV8833: PWM on IN1 (forward) or IN2 (reverse), the other low. TB6612: PWM pin, then IN1 / IN2 for direction."""
    period = 1000000.0 / config.SERVO_FREQ
    d = min(1.0, abs(s)) * config.MOTOR_MAX_DUTY * period
    if config.MOTOR_DRIVER == "tb6612":
        out.pulse_us(ch, d)
        out.pulse_us(ch + 1, period if s > 0 else 0)
        out.pulse_us(ch + 2, period if s < 0 else 0)
    else:
        out.pulse_us(ch, d if s > 0 else 0)
        out.pulse_us(ch + 1, d if s < 0 else 0)


class Robot:
    def __init__(self):
        self.pca = None
        self.bus = None
        if config.SERVOS or config.DRIVE_CHANNELS:
            if config.SERVO_DRIVER == "pca9685":
                from pca9685 import PCA9685
                bus = i2c_bus()
                try:
                    self.pca = PCA9685(bus, config.PCA_ADDR, config.SERVO_FREQ)
                except OSError as e:
                    print("PCA9685 not found on /dev/i2c-%d (%s): servos disabled" % (bus, e))
            elif config.SERVO_DRIVER == "feetech":
                from feetech import STS
                try:
                    self.bus = STS(config.BUS_SERVO_PORT, config.BUS_SERVO_BAUD)
                    for ch in config.DRIVE_CHANNELS:
                        self.bus.wheel_mode(ch + 1)
                    for ch, _, _ in config.SERVOS.values():
                        self.bus.torque(ch + 1, True)
                except (OSError, AttributeError) as e:
                    print("bus servos on %s unavailable (%s): servos disabled" % (config.BUS_SERVO_PORT, e))
                    self.bus = None
        self.trim = dict(config.TRIM)
        try:
            with open(TRIM_FILE) as f:
                self.trim.update(json.load(f))
        except (OSError, ValueError):
            pass
        self.pose = {n: 0.0 for n in config.SERVOS}
        self.target = dict(self.pose)
        self.leds = Leds()
        self.color = (80, 200, 255)
        self.play_name, self.play_t0, self.play_i = None, 0.0, 0
        for n in config.SERVOS:
            self._write(n, 0)

    # ---- low level
    def _write(self, name, angle):
        ch, d, (lo, hi) = config.SERVOS[name]
        angle = max(lo, min(hi, angle))
        deg = 90 + d * (angle + self.trim.get(name, 0))
        if self.pca:
            span = config.PULSE_MAX_US - config.PULSE_MIN_US
            self.pca.pulse_us(ch, config.PULSE_MIN_US + span * deg / 180)
        elif self.bus:
            self.bus.move(ch + 1, 2048 + (deg - 90) * 4096 / 360)

    def drive(self, left, right):
        for i, ch in enumerate(config.DRIVE_CHANNELS):
            s = max(-1.0, min(1.0, right if config.DRIVE_SIDE[i] == "R" else left)) * config.DRIVE_DIR[i]
            if config.DRIVE_KIND[i] == "hbridge":
                if self.pca:
                    hbridge(self.pca, ch, s)
            elif self.pca:
                self.pca.pulse_us(ch, 1500 + config.DRIVE_TRIM_US[i] + 500 * s)
            elif self.bus:
                self.bus.speed(ch + 1, s * config.BUS_WHEEL_SPEED)

    def set_joint(self, name, value):
        if name in self.target:
            self.target[name] = value * config.JOINT_SCALE.get(name, 1)

    def set_color(self, rgb):
        self.color = tuple(rgb)
        self.leds.fill(*self.color)

    def step(self, dt_ms):
        max_step = config.SERVO_SPEED_DEG_S * dt_ms / 1000
        for n in self.pose:
            err = max(-max_step, min(max_step, self.target[n] - self.pose[n]))
            if err:
                self.pose[n] += err
                self._write(n, self.pose[n])
        self._play_tick()

    # ---- behaviours
    def play(self, name):
        if name not in BEHAVIORS:
            return False
        self.play_name, self.play_t0, self.play_i = name, time.monotonic(), 0
        return True

    def stop(self):
        self.play_name = None
        self.drive_until = 0
        self.drive(0, 0)

    def drive_for(self, left, right, seconds):
        """A short timed hop (the AI brain's drive tool): the wheels stop on their own after that many seconds."""
        self.play_name = None
        self.drive(left, right)
        self.drive_until = time.monotonic() + max(0.0, min(3.0, seconds))

    def _play_tick(self):
        if getattr(self, "drive_until", 0) and time.monotonic() >= self.drive_until:
            self.drive_until = 0
            self.drive(0, 0)
        if not self.play_name:
            return
        loop, keys = BEHAVIORS[self.play_name]
        t = (time.monotonic() - self.play_t0) * 1000
        while self.play_i < len(keys) and keys[self.play_i][0] <= t:
            _, joints, drive, color = keys[self.play_i]
            for j, v in joints.items():
                self.set_joint(j, v)
            if drive:
                self.drive(drive[0], drive[1])
            if color:
                self.set_color(color)
            self.play_i += 1
        if self.play_i >= len(keys):
            if loop:
                self.play_t0, self.play_i = time.monotonic(), 0
            else:
                self.stop()

    # ---- calibration
    def save_trim(self):
        with open(TRIM_FILE, "w") as f:
            json.dump(self.trim, f)

    def relax(self):
        self.stop()
        if self.pca:
            for ch, _, _ in config.SERVOS.values():
                self.pca.release(ch)
            for ch in config.DRIVE_CHANNELS:
                self.pca.release(ch)
        elif self.bus:
            for ch, _, _ in config.SERVOS.values():
                self.bus.torque(ch + 1, False)
            for ch in config.DRIVE_CHANNELS:
                self.bus.speed(ch + 1, 0)
`;

  const talkHelp = claw ? 'hold the left side key to talk, right key = next behaviour, hold it 2 s to quit'
    : `hold the button on ${plat === 'rpi' ? 'GPIO17' : 'header pin 11'} to talk (or press Enter, talk, press Enter)`;
  const mainPy = String.raw`#!/usr/bin/env python3
# ${name} - voice robot main loop (${board}). It talks through the user's PICOCEO AI backbone over MCP:
# boot = initialize + get_profile (show the name, say the greeting); each utterance = converse(audio, robot_tools,
# state) -> run the actions + play the reply WAV. Talk: ${talkHelp}.
# Line commands on stdin or TCP port 8765 (config.CMD_PORT): nc <robot-ip> 8765
#   say <text>        send text to the backbone (the robot answers out loud)
#   talk              start / stop recording (like the button),  face <expression>,  text <text>,  tools
#   play <${behaviors.map(b => b.id).join('|') || 'behaviour'}>,  list,  stop${wheels.length ? ',  w / s / a / d / x  drive' : ''}
#   j <joint> <deg>   move a joint (${servos.map(s => s.id).join(', ') || 'none'})
#   calib             all joints to 0 (fit horns now),  t <joint> <deg>  set trim,  save,  relax,  quit
import os
import queue
import selectors
import shutil
import socket
import subprocess
import sys
import threading
import time

import config
from audio import Audio
from backbone import Backbone, BackboneError
from board import Inputs
from face import EXPRESSIONS, Display
from robot import BEHAVIORS, Robot
from tools import Tools

DRIVE = {"w": (1, 1), "s": (-1, -1), "a": (-0.5, 0.5), "d": (0.5, -0.5), "x": (0, 0)}


class App:
    def __init__(self, backbone=None):
        self.bot = Robot()
        self.display = Display()
        self.audio = Audio()
        self.tools = Tools(self.bot, self.display, self.audio)
        self.inputs = Inputs()
        self.bb = backbone or Backbone()
        self.ui = queue.Queue()          # work for the main thread, posted by the voice thread
        self.worker = None
        self.listening = False
        self.online = False
        self.profile = {}
        self.last = None                 # the last converse result
        self.names = list(BEHAVIORS)
        self.cursor = -1
        self.running = True
        self.t_last = time.monotonic()

    # ---- backbone
    def boot(self):
        self.display.face("thinking")
        if not self.bb.token:
            self.display.text("Set ROBOT_TOKEN in config.py")
            print("no ROBOT_TOKEN in config.py: pair the robot in PICOCEO Builder (AI Brain) and paste its token")
            return False
        try:
            self.bb.initialize()
            self.profile = self.bb.get_profile() or {}
        except BackboneError as e:
            print("backbone: %s" % e)
            self.display.face("sad")
            self.display.text("Offline: %s" % str(e)[:100])
            return False
        self.online = True
        name = self.profile.get("name") or config.ROBOT_NAME
        greeting = self.profile.get("greeting") or ""
        self.display.face("happy")
        self.display.text(name if not greeting else "%s: %s" % (name, greeting))
        print("%s is online. %s" % (name, greeting))
        if greeting and config.LOCAL_TTS and shutil.which(config.LOCAL_TTS[0]):
            try:
                subprocess.Popen(list(config.LOCAL_TTS) + [greeting], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError:
                pass
        return True

    def state(self):
        return {"face": config.HAS_DISPLAY, "platform": config.PLATFORM, "behavior": self.bot.play_name,
                "pose": {k: round(v, 1) for k, v in self.bot.pose.items()}, "volume": self.audio.level}

    def busy(self):
        return self.worker is not None and self.worker.is_alive()

    def post(self, fn, *args):
        self.ui.put((fn, args))

    def _spawn(self, fn, *args):
        self.worker = threading.Thread(target=fn, args=args, daemon=True)
        self.worker.start()

    # ---- talking
    def talk_down(self):
        if self.busy() or self.listening:
            return
        if config.LISTEN_MODE == "vad":
            self._spawn(self._turn_vad)
            return
        self.listening = True
        self.display.face("listening")
        self.audio.start()

    def talk_up(self):
        if not self.listening:
            return
        self.listening = False
        wav = self.audio.stop()
        if not wav:
            self.display.face("neutral")
            return
        self._spawn(self._turn, wav, None)

    def say(self, text):
        if self.busy() or self.listening:
            return "busy"
        self._spawn(self._turn, None, text)
        return "ok, thinking"

    def _turn_vad(self):
        self.post(self.display.face, "listening")
        wav = self.audio.record_vad()
        if not wav:
            self.post(self.display.face, "neutral")
            return
        self._turn(wav, None)

    def _turn(self, wav, text):
        """Voice thread: one exchange with the backbone. Screen, servos and LEDs are driven from the main thread."""
        self.post(self.display.face, "thinking")
        try:
            if not self.online:
                self.bb.initialize()
                self.online = True
            r = self.bb.converse(audio_wav=wav, text=text, robot_tools=self.tools.list, state=self.state(),
                                 audio_out=config.VOICE_OUT)
        except BackboneError as e:
            print("converse: %s" % e)
            self.post(self.display.face, "sad")
            self.post(self.display.text, str(e)[:120])
            return
        self.last = r
        reply = r.get("reply") or ""
        emotion = r.get("emotion") if r.get("emotion") in EXPRESSIONS else "neutral"
        print("heard: %r -> %s (%s)" % (r.get("transcript", ""), reply, emotion))
        spoken = r.get("wav") if r.get("voice", True) else None
        self.post(self.display.face, "speaking" if spoken else emotion)
        self.post(self._actions, r.get("actions") or [])
        if spoken:
            self.audio.play(spoken)
            self.post(self._settle, emotion)
        elif reply:
            self.post(self.display.text, reply[:120])

    def _actions(self, actions):
        self.tools.text_shown = False
        for a in actions:
            print("action %s" % self.tools.run(a))

    def _settle(self, emotion):
        if not self.tools.text_shown:
            self.display.face(emotion)

    # ---- main thread
    def tick(self):
        while True:
            try:
                fn, args = self.ui.get_nowait()
            except queue.Empty:
                break
            try:
                fn(*args)
            except Exception as e:
                print("ui: %s" % e)
        for ev in self.inputs.poll():
            if ev == "talk_down":
                self.talk_down()
            elif ev == "talk_up":
                self.talk_up()
            elif ev == "next" and self.names:
                self.cursor = (self.cursor + 1) % len(self.names)
                self.bot.play(self.names[self.cursor])
                print("play", self.names[self.cursor])
            elif ev == "quit":
                self.running = False
        if self.listening and self.audio.expired():
            self.talk_up()
        now = time.monotonic()
        self.bot.step((now - self.t_last) * 1000)
        self.t_last = now

    def handle(self, line):
        p = line.split()
        if not p:
            if self.inputs.keyboard:
                self.inputs.toggle()
                return "listening... press Enter to stop" if self.inputs.talk else "sending"
            return ""
        c = p[0]
        if c == "say" and len(p) > 1:
            return self.say(line.split(None, 1)[1])
        if c == "talk":
            self.inputs.toggle()
            return "listening" if self.inputs.talk else "sending"
        if c == "face" and len(p) > 1:
            self.display.face(p[1])
            return "ok"
        if c == "text" and len(p) > 1:
            self.display.text(line.split(None, 1)[1])
            return "ok"
        if c == "tools":
            return " ".join(self.tools.names)
        if c in DRIVE:
            self.bot.stop()
            self.bot.drive(*DRIVE[c])
            return "ok"
        if c == "play" and len(p) > 1:
            return "ok" if self.bot.play(p[1]) else "unknown behaviour"
        if c == "list":
            return " ".join(self.names)
        if c == "stop":
            self.bot.stop()
            return "ok"
        if c == "j" and len(p) == 3:
            self.bot.set_joint(p[1], float(p[2]))
            return "ok"
        if c == "calib":
            self.bot.stop()
            for n in self.bot.pose:
                self.bot.set_joint(n, 0)
            return "all joints at 0"
        if c == "t" and len(p) == 3 and p[1] in self.bot.pose:
            self.bot.trim[p[1]] = float(p[2])
            return "trim %s = %s" % (p[1], p[2])
        if c == "save":
            self.bot.save_trim()
            return "saved trim.json"
        if c == "relax":
            self.bot.relax()
            return "relaxed"
        if c == "quit":
            self.running = False
            return "bye"
        return "?"


def main():
    app = App()
    app.boot()
    sel = selectors.DefaultSelector()
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", config.CMD_PORT))
    server.listen(2)
    server.setblocking(False)
    sel.register(server, selectors.EVENT_READ, "accept")
    if sys.stdin.isatty():
        sel.register(sys.stdin, selectors.EVENT_READ, "stdin")
    buffers = {}
    print("%s ready: port %d, tools: %s" % (config.ROBOT_NAME, config.CMD_PORT, ", ".join(app.tools.names)))
    if app.inputs.keyboard:
        print("no talk button: press Enter to start talking and Enter again to send")
    try:
        while app.running:
            for key, _ in sel.select(timeout=config.FRAME_MS / 1000):
                if key.data == "accept":
                    conn, _ = server.accept()
                    conn.setblocking(False)
                    sel.register(conn, selectors.EVENT_READ, "conn")
                    buffers[conn] = b""
                elif key.data == "stdin":
                    line = sys.stdin.readline()
                    if not line:
                        sel.unregister(sys.stdin)
                        continue
                    r = app.handle(line.strip())
                    if r:
                        print(r)
                else:
                    conn = key.fileobj
                    try:
                        data = conn.recv(512)
                    except OSError:
                        data = b""
                    if not data:
                        sel.unregister(conn)
                        conn.close()
                        buffers.pop(conn, None)
                        continue
                    buffers[conn] += data
                    while b"\n" in buffers[conn]:
                        line, buffers[conn] = buffers[conn].split(b"\n", 1)
                        conn.sendall((app.handle(line.decode(errors="ignore").strip()) + "\n").encode())
            app.tick()
    except KeyboardInterrupt:
        pass
    app.bot.relax()
    server.close()
${claw ? `    if os.path.exists(config.PICOCLAW_INIT):
        os.system(config.PICOCLAW_INIT + " start")` : ''}


if __name__ == "__main__":
    main()
`;

  const files: Record<string, string> = {};
  if (claw) files['app.yaml'] = appYaml;
  Object.assign(files, {
    'config.py': config, 'main.py': mainPy, 'backbone.py': backbone, 'audio.py': audio, 'face.py': face,
    'tools.py': toolsPy(name), 'robot.py': robotPy, 'board.py': boardPy,
  });
  if (pca) files['pca9685.py'] = pcaPy;
  if (feetech) files['feetech.py'] = feetechPy;

  if (claw) {
    files['run.sh'] = `#!/bin/sh
# Stop the PicoClaw app (it owns the LCD and keys), then run this app in the foreground. Ctrl-C to quit.
cd "$(dirname "$0")"
[ -x /etc/init.d/S99picoclaw ] && /etc/init.d/S99picoclaw stop
exec python3 main.py
`;
    files['S99robot'] = `#!/bin/sh
# Autostart for ${name} (copy to /etc/init.d/S99${app} only if you want it instead of the PicoClaw app).
APP=/root/${app}
case "$1" in
  start)
    [ -x /etc/init.d/S99picoclaw ] && /etc/init.d/S99picoclaw stop
    cd $APP && nohup python3 main.py > /tmp/${app}.log 2>&1 &
    ;;
  stop)
    pkill -f "$APP/main.py"
    ;;
  restart)
    $0 stop; sleep 1; $0 start
    ;;
esac
`;
  } else {
    files['run.sh'] = `#!/bin/sh
# ${name} on the ${board}.
#   ./run.sh                 run in the foreground (Ctrl-C to quit)
#   sudo ./run.sh install    install the systemd service ${app}.service, enable it at boot and start it
#   sudo ./run.sh uninstall  stop and remove the service
cd "$(dirname "$0")"
DIR="$(pwd)"
APP=${app}
case "$1" in
  install)
    U="\${SUDO_USER:-$(id -un)}"
    sed -e "s#__DIR__#$DIR#g" -e "s#__USER__#$U#g" picoceo-robot.service > /etc/systemd/system/$APP.service
    for g in audio gpio i2c spi dialout video; do getent group $g >/dev/null && usermod -aG $g "$U"; done
    systemctl daemon-reload
    systemctl enable --now $APP
    echo "Installed. Logs: journalctl -u $APP -f"
    ;;
  uninstall)
    systemctl disable --now $APP
    rm -f /etc/systemd/system/$APP.service
    systemctl daemon-reload
    ;;
  *)
    exec python3 main.py
    ;;
esac
`;
    files['picoceo-robot.service'] = `# systemd unit template for ${name}; "sudo ./run.sh install" fills in __DIR__ / __USER__ and enables it.
[Unit]
Description=${name} (PICOCEO Builder voice robot)
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=__USER__
WorkingDirectory=__DIR__
ExecStart=/usr/bin/python3 __DIR__/main.py
Environment=PYTHONUNBUFFERED=1
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
`;
  }
  files['README.md'] = linuxReadme({ spec, name, app, plat, board, hw, servos, wheels, behaviors, talkHelp });
  return files;
}

function linuxReadme(o: {
  spec: RobotSpec; name: string; app: string; plat: 'claw' | 'rpi' | 'jetson'; board: string; hw: RobotHardware;
  servos: ReturnType<typeof actuatorsOf>['servos']; wheels: ReturnType<typeof actuatorsOf>['wheels']; behaviors: Behavior[]; talkHelp: string;
}) {
  const { name, app, plat, board, hw, servos, wheels, behaviors } = o;
  const host = plat === 'rpi' ? 'pi@raspberrypi.local' : plat === 'jetson' ? 'user@jetson.local' : 'root@10.131.76.1';
  const moving = servos.length + wheels.length > 0;
  const install = plat === 'claw' ? `## Install over the USB network

1. Plug the Claw into your computer with USB-C. It shows up as a USB network adapter; the board is at the
   host address ending in **.1** (for example \`10.131.76.1\`). The default login is \`root\` / \`root\`.
2. Put the backbone URL and robot token into \`config.py\` (the PICOCEO Builder download does this for you), then:

\`\`\`bash
scp -r ${app} root@10.131.76.1:/root/
ssh root@10.131.76.1 "chmod +x /root/${app}/run.sh && /root/${app}/run.sh"
\`\`\`

3. The Claw joins your Wi-Fi with the stock image's Wi-Fi settings (the backbone is on the internet). Then
   ${o.talkHelp}. Line commands: \`nc 10.131.76.1 8765\`, then \`say hello\`, \`list\`, \`play <behaviour>\`.

Autostart (replaces the PicoClaw app at boot): \`cp /root/${app}/S99robot /etc/init.d/S99${app} && chmod +x /etc/init.d/S99${app}\`.
` : `## Install (${board})

1. Flash ${plat === 'rpi' ? 'Raspberry Pi OS (Lite is enough) with Raspberry Pi Imager; set the host name, user and Wi-Fi there' : 'JetPack with NVIDIA SDK Manager or the SD-card image and finish the first-boot setup'}.
   Install the audio tools: \`sudo apt install alsa-utils${plat === 'rpi' ? ' python3-gpiozero' : ''}\`${plat === 'jetson' ? ' (Jetson.GPIO ships with JetPack)' : ''}.
${plat === 'rpi' ? `   Enable I2C (and SPI for LEDs) with \`sudo raspi-config\` > Interface Options.${hw.mic === 'respeaker' ? `
   ReSpeaker 2-mic HAT: install its driver (Seeed's seeed-voicecard, or \`dtoverlay=wm8960-soundcard\` on recent kernels);
   \`arecord -l\` must list it. Set MIC_DEVICE / SPEAKER_DEVICE in config.py to the card name it shows.` : ''}${hw.amp ? `
   MAX98357A amp: add \`dtoverlay=max98357a\` to /boot/firmware/config.txt.` : ''}` : `   Enable I2C / SPI pins with \`sudo /opt/nvidia/jetson-io/jetson-io.py\` if you use the 40-pin header.`}
2. Put the backbone URL and robot token into \`config.py\` (the PICOCEO Builder download does this for you).
3. Copy the app and try it in the foreground:

\`\`\`bash
scp -r ${app} ${host}:~/
ssh -t ${host} "cd ~/${app} && chmod +x run.sh && ./run.sh"
\`\`\`

4. Make it start at boot (systemd):

\`\`\`bash
ssh -t ${host} "cd ~/${app} && sudo ./run.sh install"      # enables + starts ${app}.service
ssh ${host} "journalctl -u ${app} -f"                          # logs
\`\`\`

Talk: ${o.talkHelp}. Line commands: \`nc ${host.split('@')[1]} 8765\`, then \`say hello\`, \`list\`, \`play <behaviour>\`.

Audio under systemd: the service talks to ALSA directly. If the desktop's PipeWire / PulseAudio holds the sound card,
set MIC_DEVICE / SPEAKER_DEVICE to a \`plughw:CARD=...\` device from \`arecord -l\` / \`aplay -l\`, or run Lite.
`;
  return `# ${name} for the ${board}

Generated by PICOCEO Builder. A voice robot app in plain \`python3\` (standard library only). It talks through your
PICOCEO **AI backbone** (persona, voice, memory) over MCP: \`config.py\` holds \`BACKBONE_URL\` and \`ROBOT_TOKEN\`
(pair the robot in the AI Brain section to get a token; keep it secret).

What it does: at boot it calls \`initialize\` and \`get_profile\` and shows the robot's name and greeting. Each time you
talk it records 16 kHz mono WAV (\`arecord\`), sends it with the robot's own tools (${[
    hw.display ? 'show_face, show_text' : '', behaviors.length ? 'play_behavior' : '', servos.length ? 'move_joint' : '',
    wheels.some(w => w.id.startsWith('wheel_')) ? 'drive' : '', plat === 'claw' || hw.leds ? 'set_led' : '', 'set_volume'].filter(Boolean).join(', ')}) to \`converse\`, plays the spoken reply
(\`aplay\`) and runs the actions. Set \`LISTEN_MODE = "vad"\` in config.py to press once and stop on silence.

${install}
## Files

| File | What |
|---|---|
| config.py | backbone URL + token, audio devices, button, display, LEDs, servos |
| main.py | the loop: talk button, voice thread, TCP / stdin line commands |
| backbone.py | MCP client (JSON-RPC 2.0 over HTTPS, timeouts, retries) |
| audio.py | arecord / aplay / amixer, push-to-talk and energy VAD |
| face.py | expressions and texts on /dev/fb0 (stdout without a framebuffer) |
| tools.py | the robot tools sent to the backbone, and the action runner |
| robot.py | joints, drive, keyframe behaviours |
| board.py | talk button and LEDs |
${hw.servoDriver === 'pca9685' ? '| pca9685.py | PCA9685 servo driver over i2c-dev |\n' : ''}${hw.servoDriver === 'feetech' ? '| feetech.py | Feetech STS bus servo driver over the serial adapter |\n' : ''}${moving ? `
## Servos (${hw.servoDriver === 'feetech' ? 'Feetech bus servos' : 'PCA9685'})

${hw.servoDriver === 'feetech' ? `Plug the bus servo adapter into USB (\`/dev/ttyUSB0\`, set BUS_SERVO_PORT otherwise) and give every servo its id
(channel + 1) with Feetech's tool first. Positional joints use position mode, wheels are switched to wheel mode.` : `Wire the PCA9685: VCC to 3V3, GND, SDA / SCL to the ${plat === 'claw' ? "Nano's" : "board's"} I2C pins, and a 5 V supply to V+.
Check the bus: \`ls /dev/i2c-*\` and \`i2cdetect -y ${plat === 'jetson' ? '7' : '1'}\` must show **40**. Set \`I2C_BUS\` in config.py if needed.`}

Send \`calib\` before fitting any horn, then \`t <joint> <deg>\` and \`save\` to trim.

| Joint | Channel | Servo |
|---|---|---|
${[...servos, ...wheels].map(s => `| ${s.id} | ${s.ch} | ${s.label} (${s.kind === 'cservo' ? 'continuous' : 'positional'}) |`).join('\n')}
` : ''}
Behaviours: ${behaviors.map(b => `\`${b.id}\``).join(', ') || 'none'}.

## Check on your hardware

${plat === 'claw' ? `- The key / LED GPIO numbers (504 / 509, 495 / 498) come from Sipeed's PicoClaw page; which key is left or right is assumed.
- The face needs the LCD as \`/dev/fb0\`; otherwise the face and texts are printed to the log.
- \`PICOCLAW_INIT\` in config.py: run \`ls /etc/init.d/\` and fix the name if the PicoClaw script is called differently.
- The mixer control for the volume (\`amixer scontrols\`); software gain is used if it is wrong.` : `- \`arecord -l\` / \`aplay -l\`: set MIC_DEVICE / SPEAKER_DEVICE to your cards, and MIXER_CONTROL to a name from \`amixer scontrols\`.
- The face needs a 16 / 24 / 32-bit framebuffer at FRAMEBUFFER; without it the face and texts are printed to the log.${o.hw.leds ? `
- LEDs: WS2812 data on SPI MOSI through a 3.3 V to 5 V level shifter is the reliable way.` : ''}`}
`;
}
