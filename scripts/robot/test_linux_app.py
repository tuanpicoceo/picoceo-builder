#!/usr/bin/env python3
"""End-to-end test of the generated PICOCEO robot apps against a fake MCP backbone.

    npx tsx scripts/fwdump.ts <dir>
    py -3 scripts/robot/test_linux_app.py <dir>          (without <dir> it runs fwdump into a temp folder)

For each Linux voice variant (voice_claw, voice_rpi, voice_rpi_bus, voice_jetson) it imports the generated app with
stubbed arecord / aplay / amixer (fake executables run with this Python) and a fake PCA9685 / Feetech driver, then
boots it, holds the talk button, releases it and checks: initialize was called with the Bearer token, converse got
the robot_tools the hardware has, the returned actions ran, and aplay got the reply WAV. It also tests the VAD mode,
"say <text>", text-only replies, a bad token, the XiaoZhi MicroPython MCP client (runs on CPython too), and parses
every generated .py with ast.
"""
import ast
import base64
import io
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import types
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOKEN = "test-robot-token-123"
ROOT = Path(__file__).resolve().parents[2]
APP_MODULES = ("config", "backbone", "audio", "face", "tools", "robot", "board", "pca9685", "feetech", "main", "mcp_client")
failures = []


def check(cond, msg):
    print("%s %s" % ("PASS" if cond else "FAIL", msg))
    if not cond:
        failures.append(msg)


def tiny_wav(seconds=0.1, freq=440):
    n = int(16000 * seconds)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / 16000))) for i in range(n)))
    return buf.getvalue()


REPLY_WAV = tiny_wav()


# ---------------------------------------------------------------- fake backbone

class Backbone:
    def __init__(self):
        self.calls = []                # (method, params, auth header)
        self.lock = threading.Lock()

    def by(self, method, tool=None):
        return [p for m, p, _ in self.calls if m == method and (tool is None or (p or {}).get("name") == tool)]

    def answer(self, msg):
        method, params = msg.get("method"), msg.get("params") or {}
        if method == "initialize":
            return {"protocolVersion": "2025-06-18", "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "picoceo-backbone", "version": "test"}, "instructions": "test"}
        if method == "tools/call" and params.get("name") == "get_profile":
            sc = {"name": "Pip", "greeting": "Hi, I'm Pip!", "language": "en", "voice": "Kore", "wake_word": "hey pip", "persona_summary": ""}
            return {"content": [{"type": "text", "text": json.dumps(sc)}], "structuredContent": sc, "isError": False}
        if method == "tools/call" and params.get("name") == "converse":
            a = params.get("arguments") or {}
            offered = {t["name"]: t for t in a.get("robot_tools") or []}
            actions = []
            if "show_face" in offered:
                actions.append({"tool": "show_face", "arguments": {"expression": "happy"}})
            if "play_behavior" in offered:
                actions.append({"tool": "play_behavior", "arguments": {"name": offered["play_behavior"]["inputSchema"]["properties"]["name"]["enum"][0]}})
            if "move_joint" in offered:
                actions.append({"tool": "move_joint", "arguments": {"joint": offered["move_joint"]["inputSchema"]["properties"]["joint"]["enum"][0], "degrees": 20}})
            if "set_led" in offered:
                actions.append({"tool": "set_led", "arguments": {"color": "#ff0000"}})
            if "drive" in offered:
                actions.append({"tool": "drive", "arguments": {"direction": "forward", "seconds": 0.3}})
            if "set_volume" in offered:
                actions.append({"tool": "set_volume", "arguments": {"level": 55}})
            silent = a.get("text") == "silent"
            sc = {"transcript": "" if a.get("text") else "hello robot", "reply": "Hi! I'm Pip.", "emotion": "happy",
                  "actions": actions, "voice": not silent}
            if a.get("audio_out") and not silent:
                sc["audio"] = {"mime": "audio/wav", "rate": 16000, "data": base64.b64encode(REPLY_WAV).decode()}
            return {"content": [{"type": "text", "text": sc["reply"]}], "structuredContent": sc, "isError": False}
        if method == "ping":
            return {}
        return None


def serve(bb):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, *a):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            auth = self.headers.get("Authorization") or ""
            try:
                msg = json.loads(body)
            except ValueError:
                return self._send(400, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            with bb.lock:
                bb.calls.append((msg.get("method"), msg.get("params"), auth))
            if auth != "Bearer " + TOKEN:
                return self._send(401, {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32001, "message": "bad robot token"}})
            if "id" not in msg:
                self.send_response(202)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            result = bb.answer(msg)
            if result is None:
                return self._send(200, {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "no method"}})
            self._send(200, {"jsonrpc": "2.0", "id": msg["id"], "result": result})

        def _send(self, code, obj):
            data = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d/api/mcp" % srv.server_address[1]


# ---------------------------------------------------------------- fake ALSA tools

FAKE_ARECORD = r'''
import math, os, struct, sys, time
args = sys.argv[1:]
with open(os.path.join(os.environ["FAKE_OUT"], "arecord.log"), "a") as f:
    f.write(" ".join(args) + "\n")
tone = b"".join(struct.pack("<h", int(9000 * math.sin(i / 3.0))) for i in range(16000))
if "raw" in args:                      # VAD mode: speech then silence on stdout
    sys.stdout.buffer.write(tone[:16000] + b"\0" * 64000)
    sys.stdout.buffer.flush()
    time.sleep(5)
    sys.exit(0)
path = args[-1]
with open(path, "wb") as f:            # placeholder sizes, like arecord killed by a signal
    f.write(b"RIFF" + struct.pack("<I", 0x7FFFFFFF) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16)
            + b"data" + struct.pack("<I", 0x7FFFFFFF) + tone)
    f.flush()
time.sleep(float(args[args.index("-d") + 1]) if "-d" in args else 15)
'''

FAKE_APLAY = r'''
import os, shutil, sys
out = os.environ["FAKE_OUT"]
n = len([f for f in os.listdir(out) if f.startswith("aplay_")])
shutil.copy(sys.argv[-1], os.path.join(out, "aplay_%d.wav" % n))
'''

FAKE_AMIXER = r'''
import os, sys
with open(os.path.join(os.environ["FAKE_OUT"], "amixer.log"), "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")
'''


class FakePCA:
    instances = []

    def __init__(self, bus, addr=0x40, freq=50):
        self.bus, self.addr, self.freq, self.pulses, self.released = bus, addr, freq, [], []
        FakePCA.instances.append(self)

    def pulse_us(self, ch, us):
        self.pulses.append((ch, us))

    def release(self, ch):
        self.released.append(ch)


class FakeSTS:
    instances = []

    def __init__(self, port, baud=1000000):
        self.port, self.baud, self.moves, self.speeds, self.torques, self.wheels = port, baud, [], [], [], []
        FakeSTS.instances.append(self)

    def move(self, sid, pos, speed=0):
        self.moves.append((sid, int(pos)))

    def speed(self, sid, v):
        self.speeds.append((sid, v))

    def torque(self, sid, on):
        self.torques.append((sid, on))

    def wheel_mode(self, sid):
        self.wheels.append(sid)


def load_app(d, fakes):
    for m in APP_MODULES:
        sys.modules.pop(m, None)
    sys.path.insert(0, str(d))
    import config
    config.BACKBONE_URL = URL
    config.ROBOT_TOKEN = TOKEN
    config.HTTP_RETRIES = 0
    config.HTTP_TIMEOUT_S = 10
    config.LOCAL_TTS = []
    config.ARECORD = [sys.executable, str(fakes / "arecord.py")]
    config.APLAY = [sys.executable, str(fakes / "aplay.py")]
    config.AMIXER = [sys.executable, str(fakes / "amixer.py")]
    config.RECORD_MAX_S = 5
    pm = types.ModuleType("pca9685")
    pm.PCA9685 = FakePCA
    sys.modules["pca9685"] = pm
    fm = types.ModuleType("feetech")
    fm.STS = FakeSTS
    sys.modules["feetech"] = fm
    import main
    return config, main


def expected_tools(config, behaviors):
    t = []
    if config.HAS_DISPLAY:
        t += ["show_face", "show_text"]
    if behaviors:
        t.append("play_behavior")
    if config.SERVOS:
        t.append("move_joint")
    if config.HAS_LEDS:
        t.append("set_led")
    if getattr(config, "HAS_WHEELS", False):
        t.append("drive")
    return t + ["set_volume"]


def run_until(app, cond, timeout=10.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        app.tick()
        if cond():
            return True
        time.sleep(0.02)
    return False


def test_linux(name, d, fakes, out):
    print("\n== %s (%s)" % (name, d))
    for f in out.iterdir():
        f.unlink()
    FakePCA.instances.clear()
    FakeSTS.instances.clear()
    BB.calls.clear()
    config, main = load_app(d, fakes)
    try:
        from robot import BEHAVIORS
        app = main.App()
        check(app.boot(), "%s: boot (initialize + get_profile) succeeded" % name)
        inits = [a for m, _, a in BB.calls if m == "initialize"]
        check(inits and all(a == "Bearer " + TOKEN for a in inits), "%s: initialize called with the Bearer robot token" % name)
        check(bool(BB.by("tools/call", "get_profile")), "%s: get_profile called" % name)
        check(bool([1 for m, _, _ in BB.calls if m == "notifications/initialized"]), "%s: notifications/initialized sent" % name)

        # push to talk: press, speak, release
        app.inputs.toggle()                       # same path as the button / Enter key
        app.tick()
        check(app.listening and app.audio.recording(), "%s: talk_down starts arecord" % name)
        time.sleep(0.6)
        app.inputs.toggle()
        app.tick()
        check(app.worker is not None, "%s: release starts the voice turn" % name)
        app.worker.join(15)
        run_until(app, lambda: app.ui.empty(), 3)
        run_until(app, lambda: False, 0.4)        # let the servos step toward their targets

        conv = BB.by("tools/call", "converse")
        check(len(conv) == 1, "%s: one converse call" % name)
        args = conv[0]["arguments"] if conv else {}
        names = [t["name"] for t in args.get("robot_tools", [])]
        exp = expected_tools(config, BEHAVIORS)
        check(names == exp, "%s: robot_tools match the hardware: %s" % (name, names))
        for t in args.get("robot_tools", []):
            check(set(t) >= {"name", "description", "inputSchema"}, "%s: tool %s is an MCP tool object" % (name, t.get("name")))
        audio = base64.b64decode(args.get("audio", {}).get("data", ""))
        check(audio[:4] == b"RIFF" and args["audio"].get("mime") == "audio/wav", "%s: converse got the recorded WAV (%d bytes)" % (name, len(audio)))
        hdr = struct.unpack("<I", audio[40:44])[0] if len(audio) > 44 else 0
        check(hdr == len(audio) - 44, "%s: WAV header sizes fixed after arecord was stopped" % name)
        check(args.get("audio_out") == {"format": "wav", "rate": 16000}, "%s: audio_out 16 kHz wav requested" % name)
        check(isinstance(args.get("state"), dict) and "pose" in args["state"], "%s: state sent" % name)
        log = (out / "arecord.log").read_text() if (out / "arecord.log").exists() else ""
        check("-f S16_LE -r 16000 -c 1 -t wav" in log, "%s: arecord -f S16_LE -r 16000 -c 1 -t wav" % name)

        ran = app.tools.ran
        check(len(ran) == len(exp) - (1 if "show_text" in exp else 0) and all(r[2] == "ok" for r in ran),
              "%s: all actions ran ok: %s" % (name, [(r[0], r[2]) for r in ran]))
        check(app.audio.level == 55, "%s: set_volume action applied (level %s)" % (name, app.audio.level))
        amix = (out / "amixer.log").read_text() if (out / "amixer.log").exists() else ""
        check("sset" in amix and "55%" in amix, "%s: amixer got the volume" % name)
        if config.HAS_LEDS:
            check(app.bot.color == (255, 0, 0), "%s: set_led action set the colour" % name)
        if config.SERVOS:
            joint = list(config.SERVOS)[0]
            check(abs(app.bot.target[joint] - 20) < 1e-6, "%s: move_joint set %s to 20 deg" % (name, joint))
            if config.SERVO_DRIVER == "pca9685":
                pca = FakePCA.instances[-1] if FakePCA.instances else None
                ch = config.SERVOS[joint][0]
                check(pca is not None and any(c == ch and p > 1500 for c, p in pca.pulses), "%s: PCA9685 channel %d driven past centre" % (name, ch))
            elif config.SERVO_DRIVER == "feetech":
                sts = FakeSTS.instances[-1] if FakeSTS.instances else None
                sid = config.SERVOS[joint][0] + 1
                check(sts is not None and any(s == sid and p > 2048 for s, p in sts.moves), "%s: Feetech servo id %d moved past centre" % (name, sid))
        if getattr(config, "HAS_WHEELS", False):
            # drive forward: every wheel turned (left ones one way, right ones mirrored), then stopped on its own
            pca = FakePCA.instances[-1] if FakePCA.instances else None
            pulses = pca.pulses if pca else []
            if config.DRIVE_KIND[0] == "hbridge":
                # DRV8833 on the servo board: forward = PWM on IN1 (left) / IN2 (right, mirrored), capped for a 6 V motor
                period = 1000000.0 / config.SERVO_FREQ
                fwd = [ch + (1 if config.DRIVE_SIDE[i] == "R" else 0) for i, ch in enumerate(config.DRIVE_CHANNELS)]
                moved = all(any(c == ch and 0 < p <= config.MOTOR_MAX_DUTY * period * 0.71 + 1 for c, p in pulses) for ch in fwd)
                check(config.MOTOR_DRIVER == "drv8833" and config.MOTOR_MAX_DUTY < 1 and moved,
                      "%s: drive forward ran all %d N20 motors through the DRV8833 (left IN1, right IN2, duty cap %.2f)" % (name, len(fwd), config.MOTOR_MAX_DUTY))
                ins = set(c for ch in config.DRIVE_CHANNELS for c in (ch, ch + 1))
                last = {c: p for c, p in pulses if c in ins}
                check(len(ins) == 4 and all(last.get(c, 1) == 0 for c in ins), "%s: motors coast (all 4 bridge inputs low) after the drive time" % name)
            else:
                moved = all(any(c == ch and (p > 1500 if config.DRIVE_SIDE[i] == "L" else p < 1500) for c, p in pulses)
                            for i, ch in enumerate(config.DRIVE_CHANNELS))
                check(len(config.DRIVE_CHANNELS) in (2, 4) and moved, "%s: drive forward turned all %d wheels (left / right mirrored)" % (name, len(config.DRIVE_CHANNELS)))
                last = {c: p for c, p in pulses if c in config.DRIVE_CHANNELS}
                check(all(abs(last.get(ch, 0) - 1500) < 1e-6 for ch in config.DRIVE_CHANNELS), "%s: wheels stopped after the drive time" % name)
        played = sorted(out.glob("aplay_*.wav"))
        check(len(played) == 1 and played[0].read_bytes() == REPLY_WAV, "%s: aplay got the reply WAV" % name)

        # say <text> over the line-command interface
        r = app.handle("say hello there")
        app.worker.join(15)
        run_until(app, lambda: app.ui.empty(), 3)
        conv = BB.by("tools/call", "converse")
        check(r == "ok, thinking" and conv and conv[-1]["arguments"].get("text") == "hello there", "%s: 'say <text>' sends text to converse" % name)
        check(len(list(out.glob("aplay_*.wav"))) == 2, "%s: the 'say' reply was played" % name)

        # text-only reply (voice false): shown with show_text
        shown = []
        app.display.text = lambda s: shown.append(s)
        app.handle("say silent")
        app.worker.join(15)
        run_until(app, lambda: app.ui.empty(), 3)
        check("Hi! I'm Pip." in shown and len(list(out.glob("aplay_*.wav"))) == 2, "%s: voice=false reply shown as text, not played" % name)

        # hands-free energy VAD
        config.LISTEN_MODE = "vad"
        n = len(BB.by("tools/call", "converse"))
        app.talk_down()
        app.worker.join(15)
        run_until(app, lambda: app.ui.empty(), 3)
        conv = BB.by("tools/call", "converse")
        ok = len(conv) == n + 1 and base64.b64decode(conv[-1]["arguments"].get("audio", {}).get("data", ""))[:4] == b"RIFF"
        check(ok, "%s: VAD mode recorded speech and sent it" % name)
        config.LISTEN_MODE = "ptt"

        # a bad token is reported, and the token is not in the message
        from backbone import Backbone as Client, BackboneError
        try:
            Client(token="nope-secret").initialize()
            check(False, "%s: bad token rejected" % name)
        except BackboneError as e:
            check("401" in str(e) and "nope-secret" not in str(e), "%s: bad token -> clear error without the token (%s)" % (name, e))
        app.bot.relax()
    finally:
        sys.path.remove(str(d))


def test_xiaozhi_client(d):
    print("\n== xiaozhi MCP client on CPython (%s)" % d)
    for m in APP_MODULES:
        sys.modules.pop(m, None)
    sys.path.insert(0, str(d))
    try:
        import config
        config.BACKBONE_URL = URL
        config.ROBOT_TOKEN = TOKEN
        import mcp_client
        BB.calls.clear()
        c = mcp_client.Mcp()
        c.initialize()
        check(any(m == "initialize" and a == "Bearer " + TOKEN for m, _, a in BB.calls), "xiaozhi: initialize with the Bearer token")
        prof = c.get_profile()
        check(prof.get("name") == "Pip", "xiaozhi: get_profile")
        wav = tiny_wav(2.0)
        tools = [{"name": "show_face", "description": "x", "inputSchema": {"type": "object", "properties": {"expression": {"type": "string", "enum": ["happy"]}}}},
                 {"name": "set_volume", "description": "x", "inputSchema": {"type": "object", "properties": {"level": {"type": "integer"}}}}]
        r = c.converse(memoryview(bytearray(wav)), None, tools, {"face": True}, True)
        sent = BB.by("tools/call", "converse")[-1]["arguments"]
        check(base64.b64decode(sent["audio"]["data"]) == wav, "xiaozhi: streamed base64 WAV arrives intact (%d bytes)" % len(wav))
        check(bytes(r.get("wav") or b"") == REPLY_WAV, "xiaozhi: reply WAV decoded out of the body in chunks")
        check([a["tool"] for a in r.get("actions", [])] == ["show_face", "set_volume"], "xiaozhi: actions returned")
        r = c.converse(None, "xin chào", tools, None, False)
        check(r.get("reply") == "Hi! I'm Pip." and "wav" not in r, "xiaozhi: text converse (UTF-8 body length correct)")
        try:
            mcp_client.Mcp(token="bad").initialize()
            check(False, "xiaozhi: bad token rejected")
        except mcp_client.McpError as e:
            check("401" in str(e), "xiaozhi: bad token -> %s" % e)
    finally:
        sys.path.remove(str(d))


def parse_all(dump):
    files = sorted(dump.rglob("*.py"))
    bad = []
    for f in files:
        try:
            ast.parse(f.read_text(encoding="utf-8"), str(f))
        except SyntaxError as e:
            bad.append("%s: %s" % (f, e))
    for b in bad:
        print("  " + b)
    check(not bad and files, "ast.parse of all %d generated .py files (Linux + MicroPython)" % len(files))


if __name__ == "__main__":
    tmp = None
    if len(sys.argv) > 1:
        dump = Path(sys.argv[1]).resolve()
    else:
        tmp = Path(tempfile.mkdtemp(prefix="fwdump_"))
        dump = tmp
        npx = shutil.which("npx") or "npx"
        subprocess.run([npx, "tsx", "scripts/fwdump.ts", str(dump)], cwd=str(ROOT), check=True, shell=os.name == "nt")
    work = Path(tempfile.mkdtemp(prefix="robot_test_"))
    fakes, out = work / "bin", work / "out"
    fakes.mkdir()
    out.mkdir()
    (fakes / "arecord.py").write_text(FAKE_ARECORD)
    (fakes / "aplay.py").write_text(FAKE_APLAY)
    (fakes / "amixer.py").write_text(FAKE_AMIXER)
    os.environ["FAKE_OUT"] = str(out)
    BB = Backbone()
    srv, URL = serve(BB)
    try:
        parse_all(dump)
        for v in ("voice_claw", "voice_claw_roam", "voice_claw_duck", "voice_rpi", "voice_rpi_bus", "voice_rpi_drive", "voice_rpi_n20", "voice_jetson"):
            if (dump / v).is_dir():
                test_linux(v, dump / v, fakes, out)
            else:
                check(False, "%s dumped by fwdump" % v)
        if (dump / "voice_xiaozhi").is_dir():
            test_xiaozhi_client(dump / "voice_xiaozhi")
        # hardware-specific expectations
        cfg = lambda v: (dump / v / "config.py").read_text(encoding="utf-8")
        check('BUTTON = "claw"' in cfg("voice_claw") and "HAS_DISPLAY = True" in cfg("voice_claw"), "claw: PicoClaw keys + LCD face")
        check('BUTTON = "gpiozero"' in cfg("voice_rpi") and "seeed2micvoicec" in cfg("voice_rpi") and "HAS_DISPLAY = True" in cfg("voice_rpi"), "rpi: GPIO17 button, ReSpeaker, LCD")
        check('SERVO_DRIVER = "feetech"' in cfg("voice_rpi_bus") and (dump / "voice_rpi_bus" / "feetech.py").exists(), "rpi bus: Feetech driver")
        duck = cfg("voice_claw_duck")
        check(all(('"%s_%s"' % (j, s)) in duck for j in ("hip", "knee", "ankle") for s in "LR") and '"neck"' in duck and '"head"' in duck,
              "claw duck: 6 leg servos + neck + head in SERVOS")
        rob = (dump / "voice_claw_duck" / "robot.py").read_text(encoding="utf-8")
        check('"walk"' in rob and '"bow"' in rob and '"nod"' in rob, "claw duck: walk / bow / nod behaviours in robot.py")
        check('BUTTON = "jetson"' in cfg("voice_jetson") and "I2C_BUS = None" in cfg("voice_jetson") and "HAS_DISPLAY = False" in cfg("voice_jetson"), "jetson: Jetson.GPIO button, auto I2C bus, no display")
        check((dump / "voice_jetson" / "picoceo-robot.service").exists() and (dump / "voice_claw" / "S99robot").exists(), "systemd unit (Pi / Jetson) and init script (Claw)")
        xz = cfg("voice_xiaozhi")
        check('DISPLAY = "gc9a01"' in xz and "MIC_SCK = 5" in xz and "SPK_BCLK = 15" in xz and 'SERVO_DRIVER = "pca9685"' in xz, "xiaozhi: GC9A01, INMP441, MAX98357A, PCA9685")
        check('DISPLAY = "ssd1306"' in cfg("voice_xiaozhi_oled") and 'SERVO_DRIVER = "pwm"' in cfg("voice_xiaozhi_oled"), "xiaozhi oled: SSD1306, direct PWM")
    finally:
        srv.shutdown()
        shutil.rmtree(work, ignore_errors=True)
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    print("\n%s: %d failure(s)" % ("FAIL" if failures else "OK", len(failures)))
    sys.exit(1 if failures else 0)
