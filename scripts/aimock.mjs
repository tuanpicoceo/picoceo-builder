// Verifies server/design.mjs end-to-end against a local mock of the Messages streaming API:
// request shape (model, beta header, fallbacks, structured output schema, cached system) and response parsing.
import { createServer } from 'node:http';

const design = { name: 'Mock Scout', archetype: 'rover', theme: 'classic', summary: 's', rationale: 'r', params: { theme: 'classic', headFeature: 'none', footStyle: 'standard', hasTail: false, hasWings: false, mountType: 'none', mountAngle: 65, hasMagnetPockets: false, hasCableSlot: true, cradleWidth: 64, cradleHeight: 68, drive: 'B-PG002', wheelDia: 70, wheelWidth: 16, tpuTires: true, bumper: true, panTilt: true, upperLen: 65, foreLen: 70, gripperLen: 28, payloadG: 20, legLen: 46, footLen: 50, footWidth: 28, armLen: 42, hasArms: false, leds: 4, headWidth: 44 }, structural: 'PETG', shell: 'PLA+', primaryColor: '#4f8cff', accentColor: '#ffffff', behaviors: ['patrol', 'look'], assumptions: [], outOfScope: ['camera'], refusalReason: '' };
let seen;
const srv = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  seen = { url: req.url, beta: req.headers['anthropic-beta'], body: JSON.parse(body) };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const text = JSON.stringify(design);
  ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(0, 50) } });
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(50) } });
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 99 } });
  ev('message_stop', {});
  res.end();
}).listen(0);
await new Promise(r => srv.once('listening', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.CYBERBUILD_PROVIDER = 'anthropic';
const { design: run } = await import('../server/design.mjs');
const out = await run({ prompt: 'patrol rover with a camera', current: { name: 'x' }, checks: ['[warn] a: b'], history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: '{}' }] });
const b = seen.body;
const checks = [
  ['path', seen.url.startsWith('/v1/messages')],
  ['beta header', String(seen.beta).includes('server-side-fallback-2026-07-01')],
  ['model', b.model === 'claude-opus-5-5'],
  ['fallbacks', b.fallbacks === 'default'],
  ['stream', b.stream === true],
  ['schema', b.output_config?.format?.type === 'json_schema' && b.output_config.format.schema.required.includes('params')],
  ['effort', b.output_config?.effort === 'medium'],
  ['cached system', b.system?.[0]?.cache_control?.type === 'ephemeral'],
  ['messages alternate', b.messages.every((m, i) => m.role === (i % 2 ? 'assistant' : 'user'))],
  ['parsed', out.design.name === 'Mock Scout' && out.design.params.wheelDia === 70],
];
for (const [n, ok] of checks) console.log(ok ? 'PASS' : 'FAIL', n);
await new Promise(r => srv.close(r));
process.exit(checks.every(c => c[1]) ? 0 : 1);
