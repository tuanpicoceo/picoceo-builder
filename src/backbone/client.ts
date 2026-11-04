// Typed browser client for the AI backbone API (docs/BACKBONE_MCP.md, "Browser API"), plus the robot-tool builder
// that turns a design (RobotSpec) into the MCP tools the robot sends in `robot_tools`.
import type { RobotSpec } from '../design/spec';
import { mechanismFamily } from '../design/spec';

// ---------------------------------------------------------------- contract types

export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'thinking', 'sleepy', 'love', 'angry', 'listening', 'speaking'] as const;
export type Expression = typeof EXPRESSIONS[number];

export const VOICES = [
  { id: 'Kore', hint: 'firm, clear' },
  { id: 'Puck', hint: 'upbeat' },
  { id: 'Charon', hint: 'informative, deep' },
  { id: 'Fenrir', hint: 'excitable' },
  { id: 'Aoede', hint: 'breezy' },
  { id: 'Leda', hint: 'youthful' },
  { id: 'Orus', hint: 'firm, warm' },
  { id: 'Zephyr', hint: 'bright' },
] as const;
export type Voice = typeof VOICES[number]['id'];

export const LANGUAGES = [
  { id: 'auto', label: 'Auto-detect' }, { id: 'en', label: 'English' }, { id: 'vi', label: 'Tiếng Việt' },
  { id: 'zh', label: '中文' }, { id: 'ja', label: '日本語' }, { id: 'ko', label: '한국어' },
  { id: 'fr', label: 'Français' }, { id: 'es', label: 'Español' }, { id: 'de', label: 'Deutsch' },
] as const;
export type Language = typeof LANGUAGES[number]['id'];

export const STYLES = ['friendly', 'playful', 'calm', 'teacher', 'concise'] as const;
export type Style = typeof STYLES[number];

/** Platforms a robot can be paired as (voice platforms). */
export const PAIR_PLATFORMS = [
  { id: 'licheerv_claw', label: 'LicheeRV Claw', short: 'claw', icon: '🦀' },
  { id: 'xiaozhi', label: 'XiaoZhi ESP32-S3', short: 'xiaozhi', icon: '🎙' },
  { id: 'rpi', label: 'Raspberry Pi', short: 'rpi', icon: '🍓' },
  { id: 'jetson', label: 'Jetson', short: 'jetson', icon: '🟩' },
] as const;
export type PairPlatform = typeof PAIR_PLATFORMS[number]['id'];

export interface BackboneConfig {
  name: string;
  persona: string;
  greeting: string;
  language: Language;
  voice: Voice;
  style: Style;
  maxWords: number;
  memoryTurns: number;
  audience: 'general' | 'kids';
  abilities: { face: boolean; motion: boolean; leds: boolean };
  wakeWord: string;
}

export const LIMITS = { name: 40, persona: 4000, greeting: 200, maxWords: [10, 200], memoryTurns: [0, 20] } as const;

export const DEFAULT_CONFIG: BackboneConfig = {
  name: 'Pip', persona: 'A cheerful desk buddy who keeps answers short, asks a friendly follow-up question and loves a good pun.',
  greeting: "Hi, I'm Pip!", language: 'auto', voice: 'Kore', style: 'friendly', maxWords: 60, memoryTurns: 8,
  audience: 'general', abilities: { face: true, motion: true, leds: true }, wakeWord: 'hey pip',
};

export interface PairedRobot { id: string; name: string; platform: string; createdAt: number | string; lastSeen: number | string | null }
export interface BackboneState {
  config: BackboneConfig;
  robots: PairedRobot[];
  usage: { today: number; limit: number };
  voice: boolean;
  mcpUrl: string;
}

export interface McpTool { name: string; description: string; inputSchema: Record<string, unknown> }
export interface RobotAction { tool: string; arguments: Record<string, unknown> }
export interface ConverseArgs {
  text?: string;
  audio?: { mime: 'audio/wav'; data: string };
  robot_tools?: McpTool[];
  state?: Record<string, unknown>;
  audio_out?: { format: 'wav'; rate: 16000 | 24000 };
}
export interface ConverseResult {
  transcript: string;
  reply: string;
  emotion: Expression;
  actions: RobotAction[];
  audio?: { mime: string; rate: number; data: string };
  voice: boolean;
}

// ---------------------------------------------------------------- errors

export type BackboneErrorKind =
  | 'signed_out'      // 401 / no token
  | 'not_deployed'    // 404 or an HTML fallback: the backbone routes are not on this server yet
  | 'daily_limit'     // shared key, per-user turn limit
  | 'voice_unavailable'
  | 'validation'      // 400
  | 'network'         // fetch failed / offline
  | 'server';         // anything else

export class BackboneError extends Error {
  constructor(public kind: BackboneErrorKind, message: string, public status = 0) { super(message); this.name = 'BackboneError'; }
}

export const errorText: Record<BackboneErrorKind, string> = {
  signed_out: 'Sign in to use your AI brain. It runs on the PICOCEO server under your account.',
  not_deployed: 'The backbone server is not deployed on this host yet (the /api/backbone routes answered 404).',
  daily_limit: "Today's free turns are used up. The brain wakes up again tomorrow.",
  voice_unavailable: 'Voice is not available on this server, so replies come back as text. Type to talk.',
  validation: 'The server rejected that request.',
  network: "Can't reach the PICOCEO server. Check your connection and try again.",
  server: 'The server hit an error. Try again in a moment.',
};

function classify(status: number, msg: string): BackboneErrorKind {
  const m = msg.toLowerCase();
  if (m.includes('daily limit')) return 'daily_limit';
  if (m.includes('voice not available')) return 'voice_unavailable';
  if (status === 401 || status === 403) return 'signed_out';
  if (status === 404) return 'not_deployed';
  if (status === 429) return 'daily_limit';
  if (status === 400 || status === 413 || status === 422) return 'validation';
  return 'server';
}

// ---------------------------------------------------------------- client

export interface ClientOptions {
  getToken: () => Promise<string | null>;
  localPreview: boolean;
  /** API origin; default: same origin. */
  base?: string;
}

export interface BackboneClient {
  get(): Promise<BackboneState>;
  save(config: BackboneConfig): Promise<BackboneConfig>;
  pair(name: string, platform: PairPlatform): Promise<{ robot: PairedRobot; token: string }>;
  remove(id: string): Promise<void>;
  converse(args: ConverseArgs, signal?: AbortSignal): Promise<ConverseResult>;
  /**
   * Clear the console's conversation memory. The contract has no browser route for this yet, so it calls
   * `DELETE /api/backbone/memory` and resolves `false` (local clear only) when the server doesn't have it.
   */
  resetMemory(): Promise<boolean>;
  /** Whether a request could be authenticated right now (signed in or local preview). */
  canAuth(): Promise<boolean>;
}

export function createBackboneClient(opts: ClientOptions): BackboneClient {
  const base = (opts.base ?? '').replace(/\/$/, '');

  async function headers(json: boolean): Promise<Record<string, string>> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (json) h['Content-Type'] = 'application/json';
    if (import.meta.env.DEV && opts.localPreview) h['X-Dev-User'] = 'local-preview';   // dev server only (stripped from production builds)
    else {
      let token: string | null = null;
      try { token = await opts.getToken(); } catch { token = null; }
      if (!token) throw new BackboneError('signed_out', errorText.signed_out, 401);
      h.Authorization = `Bearer ${token}`;
    }
    return h;
  }

  async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const h = await headers(body !== undefined);
    let res: Response;
    try {
      res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new BackboneError('network', errorText.network);
    }
    const type = res.headers.get('content-type') ?? '';
    // A SPA fallback (index.html) means the route is not there.
    if (!type.includes('json')) {
      if (res.status === 404 || type.includes('html')) throw new BackboneError('not_deployed', errorText.not_deployed, res.status || 404);
      if (res.ok && res.status === 204) return {} as T;
    }
    let data: any = null;
    try { data = await res.json(); } catch { data = null; }
    const msg = typeof data?.error === 'string' ? data.error : typeof data?.error?.message === 'string' ? data.error.message : '';
    // The generic /api 404 is `{ error: 'not found' }`; a specific one ("robot not found") is a real answer.
    if (res.status === 404) {
      if (!msg || msg === 'not found') throw new BackboneError('not_deployed', errorText.not_deployed, 404);
      throw new BackboneError('validation', msg, 404);
    }
    if (!res.ok) {
      const kind = classify(res.status, msg);
      throw new BackboneError(kind, kind === 'validation' || kind === 'server' ? msg || errorText[kind] : errorText[kind], res.status);
    }
    // converse may answer 200 with an MCP-shaped error.
    if (data?.isError) {
      const text = String(data?.content?.[0]?.text ?? msg ?? 'error');
      const kind = classify(200, text);
      throw new BackboneError(kind, kind === 'server' ? text : errorText[kind], 200);
    }
    return data as T;
  }

  return {
    async get() {
      const d = await call<any>('GET', '/api/backbone');
      return {
        config: normalizeConfig(d?.config),
        robots: Array.isArray(d?.robots) ? d.robots : [],
        usage: { today: Number(d?.usage?.today) || 0, limit: Number(d?.usage?.limit) || 300 },
        voice: d?.voice !== false,
        mcpUrl: fixScheme(typeof d?.mcpUrl === 'string' && d.mcpUrl ? d.mcpUrl : `${location.origin}/api/mcp`),
      };
    },
    async save(config) {
      const d = await call<any>('PUT', '/api/backbone', { config });
      return normalizeConfig(d?.config ?? config);
    },
    async pair(name, platform) {
      return call<{ robot: PairedRobot; token: string }>('POST', '/api/backbone/robots', { name, platform });
    },
    async remove(id) {
      await call('DELETE', `/api/backbone/robots/${encodeURIComponent(id)}`);
    },
    async converse(args, signal) {
      const d = await call<any>('POST', '/api/backbone/converse', args, signal);
      const s = d?.structuredContent ?? d;
      return {
        transcript: String(s?.transcript ?? ''),
        reply: String(s?.reply ?? d?.content?.[0]?.text ?? ''),
        emotion: (EXPRESSIONS as readonly string[]).includes(s?.emotion) ? s.emotion : 'neutral',
        actions: Array.isArray(s?.actions) ? s.actions.filter((a: any) => a && typeof a.tool === 'string').map((a: any) => ({ tool: a.tool, arguments: a.arguments ?? {} })) : [],
        audio: s?.audio?.data ? s.audio : undefined,
        voice: s?.voice !== false,
      };
    },
    async resetMemory() {
      try { await call('DELETE', '/api/backbone/memory'); return true; } catch (e) {
        if (e instanceof BackboneError && (e.kind === 'not_deployed' || e.status === 405)) return false;
        throw e;
      }
    },
    async canAuth() {
      try { await headers(false); return true; } catch { return false; }
    },
  };
}

/** The server always answers https://; on a plain-http dev host serving this page, use the page's scheme. */
function fixScheme(url: string): string {
  try {
    const u = new URL(url);
    if (typeof location !== 'undefined' && u.host === location.host && location.protocol === 'http:') u.protocol = 'http:';
    return u.toString();
  } catch { return url; }
}

/** Fill gaps in a config from the server (older store, partial objects). */
export function normalizeConfig(raw: any): BackboneConfig {
  const c = raw && typeof raw === 'object' ? raw : {};
  const pick = <T extends string>(v: unknown, all: readonly T[], d: T) => (all.includes(v as T) ? (v as T) : d);
  const num = (v: unknown, [lo, hi]: readonly [number, number], d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  const str = (v: unknown, max: number, d: string) => (typeof v === 'string' ? v.slice(0, max) : d);
  return {
    name: str(c.name, LIMITS.name, DEFAULT_CONFIG.name),
    persona: str(c.persona, LIMITS.persona, DEFAULT_CONFIG.persona),
    greeting: str(c.greeting, LIMITS.greeting, DEFAULT_CONFIG.greeting),
    language: pick(c.language, LANGUAGES.map(l => l.id), 'auto'),
    voice: pick(c.voice, VOICES.map(v => v.id), 'Kore'),
    style: pick(c.style, STYLES, 'friendly'),
    maxWords: num(c.maxWords, LIMITS.maxWords, DEFAULT_CONFIG.maxWords),
    memoryTurns: num(c.memoryTurns, LIMITS.memoryTurns, DEFAULT_CONFIG.memoryTurns),
    audience: c.audience === 'kids' ? 'kids' : 'general',
    abilities: {
      face: c.abilities?.face !== false, motion: c.abilities?.motion !== false, leds: c.abilities?.leds !== false,
    },
    wakeWord: str(c.wakeWord, 40, DEFAULT_CONFIG.wakeWord),
  };
}

/** Human-readable problems with a config draft (empty = valid). */
export function validateConfig(c: BackboneConfig): Partial<Record<keyof BackboneConfig, string>> {
  const e: Partial<Record<keyof BackboneConfig, string>> = {};
  if (!c.name.trim()) e.name = 'Give your robot a name.';
  else if (c.name.length > LIMITS.name) e.name = `At most ${LIMITS.name} characters.`;
  if (c.greeting.length > LIMITS.greeting) e.greeting = `At most ${LIMITS.greeting} characters.`;
  if (!c.persona.trim()) e.persona = 'Describe who your robot is (or pick a template).';
  else if (c.persona.length > LIMITS.persona) e.persona = `At most ${LIMITS.persona} characters.`;
  if (c.maxWords < LIMITS.maxWords[0] || c.maxWords > LIMITS.maxWords[1]) e.maxWords = `Between ${LIMITS.maxWords[0]} and ${LIMITS.maxWords[1]}.`;
  if (c.wakeWord.length > 40) e.wakeWord = 'At most 40 characters.';
  return e;
}

// ---------------------------------------------------------------- robot tools from the design

export interface DesignAbilities {
  display: boolean;
  /** true when the display is the browser's virtual face rather than hardware the design has. */
  virtualDisplay: boolean;
  behaviors: string[];
  joints: string[];
  leds: boolean;
}

/** Joint (link) ids the CAD builders give each archetype; composition designs use their own joint names. */
function jointsOf(spec: RobotSpec): string[] {
  const c = spec.composition;
  if (c?.use) return [...c.joints.map(j => j.name), ...(c.mobility === 'wheels' ? ['wheel_L', 'wheel_R', ...(c.wheelCount === 4 ? ['wheel_LF', 'wheel_RF'] : [])] : []),
    ...(c.mobility === 'legs' ? ['hip_L', 'hip_R', 'knee_L', 'knee_R', 'ankle_L', 'ankle_R', 'roll_L', 'roll_R'] : [])];
  const p = spec.params;
  const a = spec.archetype.toLowerCase();
  const panTilt = p.panTilt ? ['pan', 'tilt'] : [];
  switch (mechanismFamily(spec.archetype)) {
    case 'scara': return ['link1', 'link2'];
    case 'lever': return ['lever'];
    case 'rotor': return ['rotor'];
    case 'linear': return ['carriage'];
  }
  if (a.includes('arm')) return ['yaw', 'upper', 'fore', 'grip'];
  if (a.includes('rover') || a.includes('car')) return ['wheel_L', 'wheel_R', ...panTilt];
  if (a.includes('humanoid') || a.includes('biped') || a.includes('duck') || a.includes('walker'))
    return ['leg_L', 'leg_R', 'foot_L', 'foot_R', ...(p.hasArms ? ['arm_L', 'arm_R'] : [])];
  if (a.includes('quadruped') || a.includes('dog') || a.includes('cat')) return ['leg_FL', 'leg_FR', 'leg_RL', 'leg_RR'];
  if (a.includes('snake') || a.includes('serpent')) return ['segment_1', 'segment_2', 'segment_3', 'tail'];
  if (a.includes('turntable')) return ['platter'];
  return panTilt.length ? panTilt : ['pan', 'tilt'];
}

const DISPLAY_ARCHETYPES = ['companion', 'desk', 'agent', 'stationary', 'xiaozhi', 'pet', 'buddy'];

export function designAbilities(spec: RobotSpec | null): DesignAbilities {
  if (!spec) return { display: true, virtualDisplay: true, behaviors: [], joints: [], leds: false };
  const a = spec.archetype.toLowerCase();
  const hwDisplay = spec.platform === 'licheerv_claw' || DISPLAY_ARCHETYPES.some(w => a.includes(w));
  const ledFeatures = spec.composition?.use ? spec.composition.features.some(f => f.shape === 'led') : false;
  return {
    display: true, // the console always has the virtual face
    virtualDisplay: !hwDisplay,
    behaviors: [...new Set(spec.behaviors.filter(b => /^[a-z0-9_]+$/i.test(b)))],
    joints: [...new Set(jointsOf(spec))],
    leds: spec.params.leds > 0 || ledFeatures,
  };
}

/** The MCP tools a robot built from this design sends in `robot_tools` (contract table "Robot tools"). */
export function buildRobotTools(spec: RobotSpec | null, abilities: BackboneConfig['abilities'] = DEFAULT_CONFIG.abilities): McpTool[] {
  const d = designAbilities(spec);
  const tools: McpTool[] = [];
  if (d.display && abilities.face) {
    tools.push({
      name: 'show_face', description: 'Show a facial expression on the robot display.',
      inputSchema: { type: 'object', properties: { expression: { type: 'string', enum: [...EXPRESSIONS] } }, required: ['expression'] },
    });
    tools.push({
      name: 'show_text', description: 'Show a short text on the robot display (max 120 characters).',
      inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 120 } }, required: ['text'] },
    });
  }
  if (abilities.motion && d.behaviors.length) {
    tools.push({
      name: 'play_behavior', description: `Play one of the robot's built-in motions${spec ? ` (${spec.name})` : ''}.`,
      inputSchema: { type: 'object', properties: { name: { type: 'string', enum: d.behaviors } }, required: ['name'] },
    });
  }
  if (abilities.motion && d.joints.length) {
    tools.push({
      name: 'move_joint', description: 'Move one servo joint to an angle in degrees (0 = home).',
      inputSchema: { type: 'object', properties: { joint: { type: 'string', enum: d.joints }, degrees: { type: 'number', minimum: -90, maximum: 90 } }, required: ['joint', 'degrees'] },
    });
  }
  if (abilities.leds && d.leds) {
    tools.push({
      name: 'set_led', description: 'Set the LED colour.',
      inputSchema: { type: 'object', properties: { color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } }, required: ['color'] },
    });
  }
  tools.push({
    name: 'set_volume', description: 'Set the speaker volume.',
    inputSchema: { type: 'object', properties: { level: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['level'] },
  });
  return tools;
}

/** localStorage keys the Code editor reads to inject into the robot app's config.py. */
export const LS_URL = 'picoceo.backbone.url';
export const LS_TOKEN = 'picoceo.backbone.token';
export function storeRobotCredentials(url: string, token: string) {
  try { localStorage.setItem(LS_URL, url); localStorage.setItem(LS_TOKEN, token); } catch { /* storage blocked */ }
}

export function configPySnippet(url: string, token: string, name: string) {
  return `# PICOCEO backbone (MCP). Paste into config.py on the robot.
BACKBONE_URL = "${url}"
BACKBONE_TOKEN = "${token}"   # secret: shown once, keep it off git
ROBOT_NAME = "${name.replace(/"/g, "'")}"
MCP_PROTOCOL_VERSION = "2025-06-18"
`;
}

export function curlInitialize(url: string, token = '<robot token>') {
  return `curl -s ${url} \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "MCP-Protocol-Version: 2025-06-18" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-robot","version":"1.0"}}}'`;
}
