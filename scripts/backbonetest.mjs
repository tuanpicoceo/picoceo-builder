// Verifies server/backbone.mjs (docs/BACKBONE_MCP.md) through handleApi on a local HTTP server, with a mock Gemini
// (speech-to-text, structured chat, TTS) and a mock Meta chat endpoint for the no-Gemini-key path. In-memory store.
import { createServer } from 'node:http';

// Every key this test depends on is set before design.mjs loads, so .env.local cannot override them.
Object.assign(process.env, {
  CYBERBUILD_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-gemini-key', GOOGLE_API_KEY: '', AI_API_KEY: '',
  META_API_KEY: '', MODEL_API_KEY: '', MUSE_API_KEY: '', GEMINI_STT_MODEL: 'stt-model', GEMINI_TTS_MODEL: 'tts-model',
  BACKBONE_DAILY_LIMIT: '300', NODE_ENV: 'test',
});
delete process.env.K_SERVICE; delete process.env.FUNCTION_TARGET;

const CHAT = {
  reply: 'Hi! I am Pip.',
  emotion: 'happy',
  actions: [
    { tool: 'show_face', argumentsJson: '{"expression":"happy"}' },   // valid
    { tool: 'show_face', argumentsJson: '{"expression":"furious"}' }, // not in enum
    { tool: 'set_volume', argumentsJson: '{"level":150}' },           // out of range
    { tool: 'move_joint', argumentsJson: '{"degrees":10}' },          // required joint missing
    { tool: 'fly', argumentsJson: '{}' },                             // unknown tool
    { tool: 'show_text', argumentsJson: 'not json' },                 // bad JSON
  ],
};
const PCM_RATE = 24000, PCM_SAMPLES = 2400;
const pcm = Buffer.alloc(PCM_SAMPLES * 2);
for (let i = 0; i < PCM_SAMPLES; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / PCM_RATE)), i * 2);

const calls = { stt: 0, chat: 0, tts: 0, meta: 0, asr: 0 };
let lastChat = null, lastTts = null;
const mock = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  res.setHeader('content-type', 'application/json');
  if (req.url.includes('/asr/transcribe')) { calls.asr++; return res.end(JSON.stringify({ transcript: 'hello duck' })); }   // Muse Voice Transcribe
  const body = JSON.parse(raw || '{}');
  if (req.url.includes('/chat/completions')) {   // Meta (OpenAI-compatible)
    calls.meta++;
    return res.end(JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify({ reply: 'Text only.', emotion: 'neutral', actions: [] }) }, finish_reason: 'stop' }] }));
  }
  const model = req.url.match(/models\/([^:]+):/)?.[1];
  const g = body.generationConfig ?? {};
  const parts = body.contents?.[0]?.parts ?? [];
  const reply = text => res.end(JSON.stringify({ modelVersion: model, candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }));
  if (g.responseModalities?.includes('AUDIO')) {
    calls.tts++; lastTts = { model, body };
    return res.end(JSON.stringify({ modelVersion: model, candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] }, finishReason: 'STOP' }] }));
  }
  if (parts.some(p => p.inlineData?.mimeType?.startsWith('audio/'))) { calls.stt++; return reply('turn on the light'); }
  if (g.responseJsonSchema) { calls.chat++; lastChat = { model, body }; return reply(JSON.stringify(CHAT)); }
  res.statusCode = 400; res.end(JSON.stringify({ error: { code: 400, message: 'unexpected request', status: 'INVALID_ARGUMENT' } }));
}).listen(0);
await new Promise(r => mock.once('listening', r));
process.env.GEMINI_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
process.env.META_BASE_URL = `http://127.0.0.1:${mock.address().port}/v1`;

const { handleApi } = await import('../server/design.mjs');
const bb = await import('../server/backbone.mjs');
const store = bb.createMemoryStore();
bb.setStore(store);

const app = createServer((req, res) => handleApi(req, res)).listen(0);
await new Promise(r => app.once('listening', r));
const base = `http://127.0.0.1:${app.address().port}`;

const DEV = { 'X-Dev-User': 'local-preview' };
async function http(method, path, { body, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: r.status, headers: r.headers, text, json };
}
let rpcId = 0;
const mcp = (token, method, params, extra = {}) => http('POST', '/api/mcp', {
  body: { jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}), ...extra },
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
});

const ROBOT_TOOLS = [
  { name: 'show_face', description: 'face', inputSchema: { type: 'object', properties: { expression: { type: 'string', enum: bb.EMOTIONS } }, required: ['expression'] } },
  { name: 'show_text', description: 'text', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 120 } }, required: ['text'] } },
  { name: 'move_joint', description: 'joint', inputSchema: { type: 'object', properties: { joint: { type: 'string', enum: ['head'] }, degrees: { type: 'number', minimum: -90, maximum: 90 } }, required: ['joint', 'degrees'] } },
  { name: 'set_volume', description: 'volume', inputSchema: { type: 'object', properties: { level: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['level'] } },
];
function wav16k(seconds) {
  const n = Math.round(16000 * seconds);
  const p = Buffer.alloc(n * 2);
  return bb.pcmToWav(p, 16000).toString('base64');
}

const results = [];
const check = (name, ok, info) => { results.push([name, !!ok]); if (!ok && info !== undefined) console.log('   ', name, '->', typeof info === 'string' ? info : JSON.stringify(info).slice(0, 500)); };

// ---- browser API ----
check('browser 401 without auth', (await http('GET', '/api/backbone')).status === 401);
const g0 = await http('GET', '/api/backbone', { headers: { ...DEV, 'x-forwarded-host': 'build.example.com' } });
check('GET creates default config', g0.status === 200 && g0.json.config.name === 'Pip' && g0.json.config.voice === 'Kore' && g0.json.config.language === 'auto', g0.json);
check('GET shape', Array.isArray(g0.json.robots) && g0.json.usage.limit === 300 && g0.json.usage.today === 0 && g0.json.voice === true, g0.json);
check('mcpUrl from x-forwarded-host', g0.json.mcpUrl === 'https://build.example.com/api/mcp', g0.json.mcpUrl);
check('default config stored', store.data.backbones['local-preview']?.config?.name === 'Pip');

const put = await http('PUT', '/api/backbone', { headers: DEV, body: { config: { name: 'x'.repeat(80), maxWords: 5000, memoryTurns: -3, language: 'klingon', voice: 'Puck', style: 'nope', audience: 'kids', persona: 'p'.repeat(5000), greeting: 'Hello there', abilities: { face: true, motion: false, leds: 'yes' } } } });
const pc = put.json?.config;
check('PUT clamps', put.status === 200 && pc.name.length === 40 && pc.maxWords === 200 && pc.memoryTurns === 0 && pc.language === 'auto' && pc.voice === 'Puck' && pc.style === 'friendly' && pc.audience === 'kids' && pc.persona.length === 4000 && pc.abilities.motion === false && pc.abilities.leds === true, pc);
check('PUT bad body -> 400', (await http('PUT', '/api/backbone', { headers: DEV, body: { config: 'nope' } })).status === 400);
await http('PUT', '/api/backbone', { headers: DEV, body: { config: { name: 'Pip', persona: 'A cheerful desk buddy. Loves facts.', memoryTurns: 2, maxWords: 40, audience: 'general', abilities: { face: true, motion: true, leds: true } } } });

const r1 = await http('POST', '/api/backbone/robots', { headers: DEV, body: { name: 'Desk Pip', platform: 'licheerv_claw' } });
const token = r1.json?.token;
check('POST robot -> token', r1.status === 200 && /^pcb_[A-Za-z0-9_-]{43}$/.test(token) && r1.json.robot.id && r1.json.robot.name === 'Desk Pip' && r1.json.robot.platform === 'licheerv_claw', r1.json);
check('bad platform -> 400', (await http('POST', '/api/backbone/robots', { headers: DEV, body: { name: 'x', platform: 'toaster' } })).status === 400);
const dump = JSON.stringify(store.data);
check('store never holds the raw token', !dump.includes(token) && !!store.data.robots[bb.hashToken(token)], Object.keys(store.data.robots));
const r2 = await http('POST', '/api/backbone/robots', { headers: DEV, body: { name: 'Spare', platform: 'xiaozhi' } });
const list = await http('GET', '/api/backbone', { headers: DEV });
check('robots listed', list.json.robots.length === 2 && list.json.robots.every(r => !('memory' in r) && !('uid' in r) && !('hash' in r)), list.json.robots);

// ---- MCP ----
const bad = await mcp('pcb_wrong', 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
check('401 on bad token', bad.status === 401 && bad.json?.error?.code === -32001, bad.json);
const none = await http('POST', '/api/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
check('401 on missing token', none.status === 401 && none.json?.error?.code === -32001);
const init = await mcp(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'robot', version: '1' } });
const ir = init.json?.result;
check('initialize result', init.status === 200 && ir?.protocolVersion === '2025-06-18' && ir.capabilities?.tools?.listChanged === false && ir.serverInfo?.name === 'picoceo-backbone' && typeof ir.serverInfo.version === 'string' && /converse/.test(ir.instructions), init.json);
check('MCP-Protocol-Version echoed', init.headers.get('mcp-protocol-version') === '2025-06-18');
check('lastSeen updated', typeof store.data.robots[bb.hashToken(token)].lastSeen === 'number');
const note = await http('POST', '/api/mcp', { body: { jsonrpc: '2.0', method: 'notifications/initialized' }, headers: { Authorization: `Bearer ${token}` } });
check('notification -> 202 empty', note.status === 202 && note.text === '');
check('ping -> {}', JSON.stringify((await mcp(token, 'ping')).json?.result) === '{}');
const tl = await mcp(token, 'tools/list');
check('tools/list names', tl.json?.result?.tools?.map(t => t.name).join(',') === 'converse,get_profile,reset_memory' && tl.json.result.tools.every(t => t.description && t.inputSchema?.type === 'object'), tl.json);
check('unknown method -> -32601', (await mcp(token, 'resources/list')).json?.error?.code === -32601);
check('unknown tool -> -32602', (await mcp(token, 'tools/call', { name: 'nope', arguments: {} })).json?.error?.code === -32602);
check('converse without text/audio -> -32602', (await mcp(token, 'tools/call', { name: 'converse', arguments: { state: {} } })).json?.error?.code === -32602);
check('bad audio_out rate -> -32602', (await mcp(token, 'tools/call', { name: 'converse', arguments: { text: 'hi', audio_out: { rate: 8000 } } })).json?.error?.code === -32602);
const parseErr = await http('POST', '/api/mcp', { body: '{not json', headers: { Authorization: `Bearer ${token}` } });
check('parse error -> -32700', parseErr.status === 400 && parseErr.json?.error?.code === -32700);
const batch = await http('POST', '/api/mcp', { body: [{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 'b', method: 'tools/list' }], headers: { Authorization: `Bearer ${token}` } });
check('batch handled', batch.status === 200 && Array.isArray(batch.json) && batch.json.length === 2 && batch.json[0].id === 'a' && batch.json[1].result?.tools, batch.json);
const getMcp = await http('GET', '/api/mcp');
check('GET /api/mcp -> 405 Allow: POST', getMcp.status === 405 && getMcp.headers.get('allow') === 'POST');
const prof = await mcp(token, 'tools/call', { name: 'get_profile', arguments: {} });
const ps = prof.json?.result?.structuredContent;
check('get_profile', ps?.name === 'Pip' && ps.greeting && ps.voice === 'Puck' && ps.language === 'auto' && 'wake_word' in ps && ps.persona_summary === 'A cheerful desk buddy.', ps);

// converse (text)
const c1 = await mcp(token, 'tools/call', { name: 'converse', arguments: { text: 'hello', robot_tools: [...ROBOT_TOOLS, { name: 'self_destruct', inputSchema: {} }], state: { battery: 0.8 } } });
const s1 = c1.json?.result?.structuredContent;
check('converse text -> reply', c1.json?.result?.isError === false && s1?.reply === 'Hi! I am Pip.' && c1.json.result.content[0].text === s1.reply && s1.transcript === '' && s1.emotion === 'happy' && s1.voice === true && !s1.audio, c1.json);
check('only the valid action survives', JSON.stringify(s1?.actions) === JSON.stringify([{ tool: 'show_face', arguments: { expression: 'happy' } }]), s1?.actions);
const sys = lastChat?.body?.systemInstruction?.parts?.map(p => p.text).join('') ?? JSON.stringify(lastChat?.body?.systemInstruction ?? '');
check('prompt has persona, state, tools', sys.includes('A cheerful desk buddy') && sys.includes('"battery":0.8') && sys.includes('show_face') && !sys.includes('self_destruct') && sys.includes('40 words'), sys.slice(0, 300));
check('chat tool enum', JSON.stringify(lastChat?.body?.generationConfig?.responseJsonSchema?.properties?.actions?.items?.properties?.tool?.enum) === JSON.stringify(['show_face', 'show_text', 'move_joint', 'set_volume']));
// drive (robots on wheels): a known motion tool, at most 3 s per hop
const DRIVE_TOOL = { name: 'drive', description: 'x', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['forward', 'backward', 'left', 'right'] }, seconds: { type: 'number' } }, required: ['direction', 'seconds'] } };
const drv = bb.validateActions([{ tool: 'drive', argumentsJson: '{"direction":"forward","seconds":1}' }, { tool: 'drive', argumentsJson: '{"direction":"forward","seconds":9}' }, { tool: 'drive', argumentsJson: '{"direction":"up","seconds":1}' }], [DRIVE_TOOL]);
check('drive: valid hop kept, long / bad ones dropped', JSON.stringify(drv) === JSON.stringify([{ tool: 'drive', arguments: { direction: 'forward', seconds: 1 } }]), drv);
check('drive: allowed with motion only', bb.allowedRobotTools([DRIVE_TOOL], { motion: true }).length === 1 && bb.allowedRobotTools([DRIVE_TOOL], { motion: false }).length === 0);
let mem = store.data.robots[bb.hashToken(token)].memory;
check('memory saved', mem?.length === 2 && mem[0].role === 'user' && mem[0].text === 'hello' && mem[1].role === 'assistant' && mem[1].text === 'Hi! I am Pip.', mem);

// converse (audio)
const c2 = await mcp(token, 'tools/call', { name: 'converse', arguments: { audio: { mime: 'audio/wav', data: wav16k(1) }, robot_tools: ROBOT_TOOLS, audio_out: { format: 'wav', rate: 16000 } } });
const s2 = c2.json?.result?.structuredContent;
check('STT transcript', calls.stt === 1 && s2?.transcript === 'turn on the light', s2);
const userText = lastChat?.body?.contents?.[0]?.parts?.[0]?.text ?? '';
check('memory sent to the chat model', userText.includes('User: hello') && userText.includes('Pip: Hi! I am Pip.') && userText.includes('turn on the light'), userText);
const w = Buffer.from(s2?.audio?.data ?? '', 'base64');
const wavOk = w.length > 44 && w.toString('ascii', 0, 4) === 'RIFF' && w.toString('ascii', 8, 12) === 'WAVE' && w.toString('ascii', 12, 16) === 'fmt '
  && w.readUInt16LE(20) === 1 && w.readUInt16LE(22) === 1 && w.readUInt32LE(24) === 16000 && w.readUInt32LE(28) === 32000 && w.readUInt16LE(34) === 16
  && w.toString('ascii', 36, 40) === 'data' && w.readUInt32LE(40) === 1600 * 2 && w.readUInt32LE(4) === 36 + 3200 && w.length === 44 + 3200;
check('WAV audio: RIFF header, 16 kHz, resampled length', wavOk && s2.audio.mime === 'audio/wav' && s2.audio.rate === 16000, { len: w.length, rate: w.length > 28 ? w.readUInt32LE(24) : 0 });
check('TTS request (model, voice, modality)', lastTts?.model === 'tts-model' && JSON.stringify(lastTts.body).includes('"voiceName":"Puck"'), lastTts?.body);
const c3 = await mcp(token, 'tools/call', { name: 'converse', arguments: { text: 'again', audio_out: { rate: 24000 } } });
const w3 = Buffer.from(c3.json?.result?.structuredContent?.audio?.data ?? '', 'base64');
check('24 kHz audio passes through', w3.length === 44 + PCM_SAMPLES * 2 && w3.readUInt32LE(24) === 24000);
mem = store.data.robots[bb.hashToken(token)].memory;
check('memory trimmed to memoryTurns', mem.length === 4 && mem[0].text === 'turn on the light' && mem[2].text === 'again', mem);
const tooLong = await mcp(token, 'tools/call', { name: 'converse', arguments: { audio: { mime: 'audio/wav', data: wav16k(25) } } });
check('audio > 20 s -> -32602', tooLong.json?.error?.code === -32602, tooLong.json);
await mcp(token, 'tools/call', { name: 'reset_memory', arguments: {} });
check('reset_memory', store.data.robots[bb.hashToken(token)].memory.length === 0);

// abilities filter
await http('PUT', '/api/backbone', { headers: DEV, body: { config: { abilities: { face: false, motion: true, leds: true } } } });
await mcp(token, 'tools/call', { name: 'converse', arguments: { text: 'hi', robot_tools: ROBOT_TOOLS } });
check('abilities filter tools', JSON.stringify(lastChat?.body?.generationConfig?.responseJsonSchema?.properties?.actions?.items?.properties?.tool?.enum) === JSON.stringify(['move_joint', 'set_volume']));

// console
const con = await http('POST', '/api/backbone/converse', { headers: DEV, body: { text: 'console hi', robot_tools: ROBOT_TOOLS } });
check('browser console converse', con.status === 200 && con.json.reply === 'Hi! I am Pip.' && store.data.backbones['local-preview'].consoleMemory?.[0]?.text === 'console hi', con.json);

// daily limit
const used = store.data.backbones['local-preview'].usage.count;
const g1 = await http('GET', '/api/backbone', { headers: DEV });
check('usage counted', g1.json.usage.today === used && used === 5, g1.json.usage);
process.env.BACKBONE_DAILY_LIMIT = String(used);
const lim = await mcp(token, 'tools/call', { name: 'converse', arguments: { text: 'one more' } });
check('daily limit reached -> isError', lim.json?.result?.isError === true && /daily limit reached/.test(lim.json.result.content[0].text), lim.json);
check('console daily limit -> 429', (await http('POST', '/api/backbone/converse', { headers: DEV, body: { text: 'x' } })).status === 429);
process.env.BACKBONE_DAILY_LIMIT = '300';

// no Gemini key: text works through the chat provider (Meta mock), audio -> isError, voice false
process.env.GEMINI_API_KEY = ''; process.env.CYBERBUILD_PROVIDER = 'meta'; process.env.META_API_KEY = 'test-meta-key';
const nk = await mcp(token, 'tools/call', { name: 'converse', arguments: { text: 'hi', audio_out: { rate: 16000 } } });
const nks = nk.json?.result?.structuredContent;
check('no key: text works, voice false, no audio', nk.json?.result?.isError === false && nks?.reply === 'Text only.' && nks.voice === false && !nks.audio && calls.meta === 1, nk.json);
const nka = await mcp(token, 'tools/call', { name: 'converse', arguments: { audio: { mime: 'audio/wav', data: wav16k(1) } } });
const nkas = nka.json?.result?.structuredContent;
check('Meta only: audio -> Muse Voice Transcribe, text reply', nka.json?.result?.isError === false && calls.asr === 1 && nkas?.transcript === 'hello duck' && nkas.reply === 'Text only.' && nkas.voice === false, nka.json);
check('no key: GET voice false', (await http('GET', '/api/backbone', { headers: DEV })).json.voice === false);

// delete robot -> token revoked
const del = await http('DELETE', `/api/backbone/robots/${r1.json.robot.id}`, { headers: DEV });
check('DELETE robot', del.status === 200 && JSON.stringify(del.json) === '{}' && !store.data.robots[bb.hashToken(token)]);
check('deleted robot token -> 401', (await mcp(token, 'ping')).status === 401);
check('DELETE unknown -> 404', (await http('DELETE', '/api/backbone/robots/rb_nope', { headers: DEV })).status === 404);
check('remaining robot still listed', (await http('GET', '/api/backbone', { headers: DEV })).json.robots.map(r => r.id).join() === r2.json.robot.id);

// production: X-Dev-User is never accepted
process.env.K_SERVICE = 'api';
check('production rejects X-Dev-User', (await http('GET', '/api/backbone', { headers: DEV })).status === 401);
delete process.env.K_SERVICE;

for (const [n, ok] of results) console.log(ok ? 'PASS' : 'FAIL', n);
const passed = results.filter(r => r[1]).length;
console.log(`backbone: ${passed}/${results.length} passed`);
for (const s of [app, mock]) { s.closeAllConnections(); await new Promise(r => s.close(r)); }
process.exitCode = passed === results.length ? 0 : 1;
