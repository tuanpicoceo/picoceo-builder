// Verifies the Gemini path of server/design.mjs against a local mock of generateContent:
// request shape (model, key header, system instruction, JSON schema, roles) and response/error handling.
import { createServer } from 'node:http';

const design = { name: 'Gem Arm', archetype: 'arm', theme: 'classic', summary: 's', rationale: 'r', params: { theme: 'classic', headFeature: 'none', footStyle: 'standard', hasTail: false, hasWings: false, mountType: 'none', mountAngle: 65, hasMagnetPockets: false, hasCableSlot: true, cradleWidth: 64, cradleHeight: 68, drive: 'B-PG002', wheelDia: 60, wheelWidth: 14, tpuTires: true, bumper: true, panTilt: false, upperLen: 70, foreLen: 70, gripperLen: 30, payloadG: 30, legLen: 46, footLen: 50, footWidth: 28, armLen: 42, hasArms: false, leds: 2, headWidth: 44 }, structural: 'PETG', shell: 'PLA+', primaryColor: '#e63946', accentColor: '#2a2a2a', behaviors: ['pick'], assumptions: [], outOfScope: [], refusalReason: '' };
let mode = 'ok', seen;
const srv = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  seen = { url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(body) };
  res.setHeader('content-type', 'application/json');
  if (mode === 'badkey') { res.statusCode = 400; return res.end(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })); }
  if (mode === 'overload' && req.url.includes('gemini-3.6-flash:')) { res.statusCode = 503; return res.end(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } })); }
  if (mode === 'overload-all') { res.statusCode = 503; return res.end(JSON.stringify({ error: { code: 503, message: 'high demand', status: 'UNAVAILABLE' } })); }
  if (mode === 'blocked') return res.end(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }));
  res.end(JSON.stringify({ modelVersion: req.url.match(/models\/([^:]+):/)[1], candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(design) }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 123 } }));
}).listen(0);
await new Promise(r => srv.once('listening', r));
Object.assign(process.env, { GEMINI_API_KEY: 'test-gemini-key', GEMINI_BASE_URL: `http://127.0.0.1:${srv.address().port}`, CYBERBUILD_PROVIDER: 'gemini' });
const { design: run, provider } = await import('../server/design.mjs');
const out = await run({ prompt: 'desk arm for 30 g', current: { name: 'x' }, history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: '{}' }] });
const b = seen.body;
const results = [
  ['provider', provider() === 'gemini'],
  ['endpoint', /models\/gemini-3\.6-flash:generateContent/.test(seen.url)],
  ['api key header', seen.key === 'test-gemini-key'],
  ['system instruction', JSON.stringify(b.systemInstruction ?? b.system_instruction ?? '').includes('CyberBrick')],
  ['json schema', (b.generationConfig?.responseMimeType === 'application/json') && !!b.generationConfig?.responseJsonSchema?.properties?.params],
  ['roles', b.contents.map(c => c.role).join(',') === 'user,model,user'],
  ['parsed', out.design.name === 'Gem Arm' && out.model === 'gemini-3.6-flash'],
];
mode = 'overload';
const fb = await run({ prompt: 'x' });
results.push(['fallback on 503 -> ' + fb.model, fb.model === 'gemini-3.5-flash-lite' && fb.fallbackFrom?.[0] === 'gemini-3.6-flash: 503']);
for (const [m, status, auth] of [['badkey', 503, true], ['blocked', 422, false], ['overload-all', 503, false]]) {
  mode = m;
  try { await run({ prompt: 'x' }); results.push([m, false]); }
  catch (e) { results.push([`${m} -> ${e.status}${e.auth ? ' auth' : ''}`, e.status === status && !!e.auth === auth]); }
}
for (const [n, ok] of results) console.log(ok ? 'PASS' : 'FAIL', n);
if (!results.every(r => r[1])) console.log(JSON.stringify(b).slice(0, 600));
srv.closeAllConnections();
await new Promise(r => srv.close(r));
process.exitCode = results.every(r => r[1]) ? 0 : 1;
