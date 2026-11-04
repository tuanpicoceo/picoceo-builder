// Verifies the Meta Model API (Muse) path of server/design.mjs against a local mock:
// request shape (model, auth header, system prompt, JSON schema, messages) and response/error handling.
import { createServer } from 'node:http';

process.env.META_API_KEY = 'test-meta-key';
process.env.META_MODEL = 'muse-spark-1.3';
process.env.META_FALLBACK_MODELS = 'muse-spark-1.1,muse-spark';
process.env.CYBERBUILD_PROVIDER = 'meta';

const design = {
  name: 'Meta Rover',
  archetype: 'rover',
  theme: 'classic',
  summary: 'A fast patrol rover designed with Meta Muse',
  rationale: 'Balanced wheel diameter for desk navigation with continuous servos.',
  params: { theme: 'classic', headFeature: 'none', footStyle: 'standard', hasTail: false, hasWings: false, mountType: 'none', mountAngle: 65, hasMagnetPockets: false, hasCableSlot: true, cradleWidth: 64, cradleHeight: 68, drive: 'B-PG002', wheelDia: 64, wheelWidth: 14, tpuTires: true, bumper: true, panTilt: true, upperLen: 65, foreLen: 70, gripperLen: 28, payloadG: 20, legLen: 46, footLen: 50, footWidth: 28, armLen: 42, hasArms: false, leds: 4, headWidth: 44 },
  structural: 'PETG',
  shell: 'PLA+',
  primaryColor: '#0084ff',
  accentColor: '#ffffff',
  behaviors: ['patrol', 'look'],
  assumptions: [],
  outOfScope: [],
  refusalReason: '',
};

let mode = 'ok', seen;
const srv = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') };
  res.setHeader('content-type', 'application/json');

  if (mode === 'badkey') {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: { message: 'Invalid API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' } }));
  }
  if (mode === 'overload' && seen.body?.model === 'muse-spark-1.3') {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: { message: 'Model is currently overloaded.', type: 'server_error', code: 'overloaded' } }));
  }
  if (mode === 'overload-all') {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: { message: 'Service unavailable', code: 'service_unavailable' } }));
  }
  if (mode === 'filtered') {
    return res.end(JSON.stringify({
      id: 'chatcmpl-test',
      model: seen.body?.model || 'muse-spark-1.3',
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'content_filter' }],
    }));
  }

  res.end(JSON.stringify({
    id: 'chatcmpl-test',
    model: seen.body?.model || 'muse-spark-1.3',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(design) },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 350, total_tokens: 470 },
  }));
}).listen(0);

await new Promise(r => srv.once('listening', r));
process.env.META_BASE_URL = `http://127.0.0.1:${srv.address().port}/v1`;

const { design: run, provider, modelFor } = await import('../server/design.mjs');
const out = await run({
  prompt: 'patrol rover with head and leds',
  current: { name: 'old' },
  history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: '{}' }],
});

const b = seen.body;
const results = [
  ['provider', provider() === 'meta'],
  ['endpoint', seen.url.endsWith('/chat/completions')],
  ['auth header', seen.auth === 'Bearer test-meta-key'],
  ['model', modelFor('meta') === 'muse-spark-1.3' && b.model === 'muse-spark-1.3'],
  ['system prompt', b.messages[0]?.role === 'system' && b.messages[0]?.content?.includes('CyberBrick')],
  ['json schema', b.response_format?.type === 'json_schema' && !!b.response_format?.json_schema?.schema?.properties?.params],
  ['roles', b.messages.slice(1).map(c => c.role).join(',') === 'user,assistant,user'],
  ['parsed', out.design.name === 'Meta Rover' && out.model === 'muse-spark-1.3'],
];

mode = 'overload';
const fb = await run({ prompt: 'patrol rover' });
results.push(['fallback on 503 -> ' + fb.model, fb.model === 'muse-spark-1.1' && fb.fallbackFrom?.[0] === 'muse-spark-1.3: 503']);

for (const [m, status, auth] of [['badkey', 503, true], ['filtered', 422, false], ['overload-all', 503, false]]) {
  mode = m;
  try {
    await run({ prompt: 'x' });
    results.push([m, false]);
  } catch (e) {
    results.push([`${m} -> ${e.status}${e.auth ? ' auth' : ''}`, e.status === status && !!e.auth === auth]);
  }
}

for (const [n, ok] of results) console.log(ok ? 'PASS' : 'FAIL', n);
if (!results.every(r => r[1])) console.log(JSON.stringify(b).slice(0, 600));

srv.closeAllConnections();
await new Promise(r => srv.close(r));
process.exitCode = results.every(r => r[1]) ? 0 : 1;
