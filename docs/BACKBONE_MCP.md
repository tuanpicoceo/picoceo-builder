# AI backbone and the robot MCP link

PICOCEO Builder voice robots have a mic and a speaker, and a display when the design wants a face. They talk through the
user's **AI backbone**: a per-user brain (persona, voice, language, memory, which robot abilities it may use) that runs
on the PICOCEO server with the server's one shared AI key. Users never paste a key.

Each robot is paired with the backbone and gets a robot token. The robot connects over **MCP** (Model Context
Protocol, Streamable HTTP transport, stateless JSON responses):
- The backbone is the MCP server.
- The robot is the MCP client. It works behind home Wi-Fi / NAT with no open port.

```
robot (MCP client)                         PICOCEO backbone (MCP server, /api/mcp)
  mic --record WAV 16 kHz--> tools/call converse {audio, robot_tools, state}
                                             1. speech-to-text (Gemini, shared key)
                                             2. LLM with the user's persona + memory + the robot's tools
                                             3. text-to-speech (Gemini TTS, user's voice)
  speaker <--WAV-- display <--face/text--  <- {transcript, reply, emotion, actions[], audio}
  servos/LEDs <- runs each action (its own tools)
```

## Platforms (`spec.platform`, `PLATFORMS` in `src/design/spec.ts`)

`platformOf(directory)` in `src/catalog/components.ts` picks the platform from the directory's main board.

| id | Board | Robot app | Audio | Display | Servos |
|---|---|---|---|---|---|
| `licheerv_claw` | LicheeRV Nano W + PicoClaw | Linux python3 | built-in mic + speaker (ALSA) | built-in 240x240 LCD (/dev/fb0) | PCA9685 on I2C |
| `xiaozhi` | XiaoZhi AI core / ESP32-S3 | MicroPython | I2S mic (INMP441) + I2S amp (MAX98357A) | optional SPI LCD (GC9A01 / ST7789) or I2C OLED | PCA9685 on I2C, or direct PWM |
| `rpi` | Raspberry Pi 5 / 4B / Zero 2 W | Linux python3 | ReSpeaker 2-mic HAT, or USB mic + speaker (ALSA) | optional SPI LCD or HDMI | PCA9685 / Servo HAT on I2C bus 1 |
| `jetson` | Jetson Orin Nano / Jetson Nano | Linux python3 | USB mic + speaker (ALSA) | optional HDMI / SPI LCD | PCA9685 on I2C (bus 7 on Orin, 1 on Nano) |
| `cyberbrick` | CyberBrick ESP32-C3 | MicroPython (BLE) | none | none | shield headers |

## MCP endpoint

`POST {base}/api/mcp`. The headers are:
- `Authorization: Bearer <robot token>`
- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`
- `MCP-Protocol-Version: 2025-06-18`

The body is one JSON-RPC 2.0 message. The server answers `application/json` (no SSE stream); a notification gets
`202` with an empty body. A bad or missing token gets HTTP `401` with JSON-RPC error `-32001`. Bodies may be up to
8 MB.

| method | params | result |
|---|---|---|
| `initialize` | `{ protocolVersion, capabilities: {}, clientInfo: { name, version } }` | `{ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "picoceo-backbone", version }, instructions }` |
| `notifications/initialized` | none | `202` |
| `ping` | none | `{}` |
| `tools/list` | none | `{ tools: [converse, get_profile, reset_memory] }`, each with `name`, `description`, `inputSchema` |
| `tools/call` | `{ name, arguments }` | `{ content: [{ type: "text", text }], structuredContent, isError }` |

### Tool `converse`

```jsonc
arguments: {
  "text": "hello",                                // or audio
  "audio": { "mime": "audio/wav", "data": "<base64>" },   // 16 kHz mono 16-bit WAV, <= 20 s
  "robot_tools": [ /* the robot's own MCP tools, see below */ ],
  "state": { "battery": 0.8, "pose": {}, "face": true },  // free-form, shown to the LLM
  "audio_out": { "format": "wav", "rate": 16000 }   // omit for text only; rate 16000 or 24000
}
structuredContent: {
  "transcript": "hello",                          // what the robot heard ("" for text input)
  "reply": "Hi! I'm Pip.",                        // what it says (also in content[0].text)
  "emotion": "happy",                             // one of the face expressions below
  "actions": [ { "tool": "show_face", "arguments": { "expression": "happy" } } ],
  "audio": { "mime": "audio/wav", "rate": 16000, "data": "<base64>" },   // only when audio_out was asked and TTS is available
  "voice": true                                   // false: the server has no speech key, show the reply as text
}
```

Without a Gemini key on the server, `converse` with audio returns `isError: true` and the text "voice not available";
text input still works with the server's chat model.

### Tool `get_profile`

It returns `structuredContent: { name, greeting, language, voice, wake_word, persona_summary }`. The robot shows the
name and says the greeting at boot.

### Tool `reset_memory`

It clears this robot's conversation memory.

### Robot tools (what the robot sends in `robot_tools`, then runs from `actions`)

These are standard MCP tool objects (`name`, `description`, `inputSchema`). A robot sends only what its hardware has.

| name | inputSchema | when |
|---|---|---|
| `show_face` | `{ expression: enum ["neutral","happy","sad","surprised","thinking","sleepy","love","angry","listening","speaking"] }` | has a display |
| `show_text` | `{ text: string }` (<= 120 chars) | has a display |
| `play_behavior` | `{ name: enum [<behaviour ids>] }` | has servos |
| `move_joint` | `{ joint: enum [<joint ids>], degrees: number }` | has servos |
| `set_led` | `{ color: string "#rrggbb" }` | has LEDs |
| `drive` | `{ direction: enum ["forward","backward","left","right"], seconds: number 0.2..3 }` (the backbone caps it at 3 s; the robot stops by itself) | drives on wheels |
| `set_volume` | `{ level: integer 0..100 }` | always |

The backbone passes these tools to the LLM and returns its tool calls as `actions`. It never invents a tool the robot
did not send, and drops any action whose arguments don't match the schema.

## Browser API (the app's AI Backbone section)

These calls authenticate with `Authorization: Bearer <Firebase ID token>`. In the dev preview (`/?preview`, server not in
production) they use `X-Dev-User: local-preview` instead.

| route | body | answer |
|---|---|---|
| `GET /api/backbone` | none | `{ config, robots: [{ id, name, platform, createdAt, lastSeen }], usage: { today, limit }, voice: bool, mcpUrl }` |
| `PUT /api/backbone` | `{ config }` | `{ config }` (validated and clamped) |
| `POST /api/backbone/robots` | `{ name, platform }` | `{ robot, token }`. The token is shown once and only its SHA-256 is stored |
| `DELETE /api/backbone/robots/{id}` | none | `{}` |
| `DELETE /api/backbone/memory` | none | `{}` (clears the test console's memory) |
| `POST /api/backbone/converse` | same arguments as the `converse` tool | same `structuredContent` (test console, memory id `console`) |

### Backbone config

```jsonc
{
  "name": "Pip",                          // robot name, <= 40
  "persona": "A cheerful desk buddy who ...",   // system prompt, <= 4000
  "greeting": "Hi, I'm Pip!",             // <= 200
  "language": "auto",                     // auto | en | vi | zh | ja | ko | fr | es | de
  "voice": "Kore",                        // Gemini prebuilt voice: Kore, Puck, Charon, Fenrir, Aoede, Leda, Orus, Zephyr
  "style": "friendly",                    // friendly | playful | calm | teacher | concise
  "maxWords": 60,                         // reply length cap, 10..200
  "memoryTurns": 8,                       // remembered exchanges per robot, 0..20
  "audience": "general",                  // general | kids (kids: extra safety rules)
  "abilities": { "face": true, "motion": true, "leds": true },   // which robot tools the LLM may use
  "wakeWord": "hey pip"                   // shown in the robot app; push-to-talk always works
}
```

## Storage and limits

- **Production:** Firestore through `firebase-admin`.
  - `backbones/{uid}` holds `{ config, usage: { day, count } }`.
  - `robots/{sha256(token)}` holds `{ uid, id, name, platform, createdAt, lastSeen, memory: [{ role, text }] }`.
  - Browser clients can't read either: the existing rules deny everything outside `users/`.
- **Dev:** the same data in `.backbone-store.json` at the repo root (git-ignored).
- **Shared key:** every user shares the server key, with a daily per-user turn limit, `BACKBONE_DAILY_LIMIT` (default
  300). Over the limit, `converse` returns `isError` with "daily limit reached".
