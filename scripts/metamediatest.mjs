// Verifies the Meta Model API media calls against a local mock:
//   Muse Voice Transcribe (server/backbone.mjs transcribe): multipart POST /v1/asr/transcribe { request JSON, audio WAV }
//   SAM 3.1 (server/segment.mjs, route /api/segment): streamed POST /v1/responses with input_text + input_image
import { createServer } from 'node:http';

Object.assign(process.env, {
  CYBERBUILD_PROVIDER: 'meta', META_API_KEY: 'test-meta-key', MODEL_API_KEY: '', MUSE_API_KEY: '', AI_API_KEY: '',
  GEMINI_API_KEY: '', GOOGLE_API_KEY: '', META_TRIES: '2', NODE_ENV: 'test',
});
delete process.env.K_SERVICE; delete process.env.FUNCTION_TARGET;

const seen = { asr: [], sam: [] };
let asrFailOnce = true;
const mock = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  if (req.url === '/v1/asr/transcribe') {
    const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: raw }).formData();
    const request = JSON.parse(await form.get('request').text());
    const audio = Buffer.from(await form.get('audio').arrayBuffer());
    seen.asr.push({ auth: req.headers.authorization, request, audio });
    res.setHeader('content-type', 'application/json');
    if (asrFailOnce) { asrFailOnce = false; res.statusCode = 503; return res.end('{"error":"busy"}'); }
    return res.end(JSON.stringify({ sessionId: 's1', transcript: 'flap your wings', audioDurationMs: 500 }));
  }
  if (req.url === '/v1/responses') {
    const body = JSON.parse(raw.toString());
    const concept = body.input[0].content.find(c => c.type === 'input_text').text;
    seen.sam.push({ auth: req.headers.authorization, body, concept });
    const boxes = {
      head: '<0f>0<|box;x1=10;y1=5;x2=49;y2=44;w=200;h=100;c=0.93|><|mask;x=0;y=0;data=2,2,~abc|>',
      body: '<0f>0<|box;x1=40;y1=30;x2=179;y2=89;w=200;h=100|>',
      wing: '<0f>0<|box;x1=80;y1=40;x2=119;y2=69;w=200;h=100|>,1<|box;x1=120;y1=40;x2=149;y2=64;w=200;h=100|>',
    }[concept] ?? '';
    if (concept === 'tail') { res.statusCode = 500; return res.end('{"error":"boom"}'); }
    res.setHeader('content-type', 'text/event-stream');
    const half = Math.ceil(boxes.length / 2);
    for (const piece of [boxes.slice(0, half), boxes.slice(half)]) res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: piece })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { output: [{ content: [{ type: 'output_text', text: boxes }] }] } })}\n\n`);
    return res.end();
  }
  res.statusCode = 404; res.end('{}');
}).listen(0);
await new Promise(r => mock.once('listening', r));
process.env.META_BASE_URL = `http://127.0.0.1:${mock.address().port}/v1`;

const bb = await import('../server/backbone.mjs');
const { handleApi } = await import('../server/design.mjs');
const seg = await import('../server/segment.mjs');

const results = [];
const check = (name, ok, detail) => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` -> ${JSON.stringify(detail)?.slice(0, 400)}`}`); };

// --- Muse Voice Transcribe -------------------------------------------------------------------------------------
const rate = 44100, n = 4410;
const stereo = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) { const v = Math.round(6000 * Math.sin(2 * Math.PI * 300 * i / rate)); stereo.writeInt16LE(v, i * 4); stereo.writeInt16LE(-v, i * 4 + 2); }
const h = Buffer.alloc(44);
h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + stereo.length, 4); h.write('WAVE', 8, 'ascii'); h.write('fmt ', 12, 'ascii');
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28);
h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36, 'ascii'); h.writeUInt32LE(stereo.length, 40);
const wav44 = Buffer.concat([h, stereo]);

const conv = bb.parseWav(bb.toTranscribeWav(wav44));
check('WAV for transcribe: mono 16-bit 16 kHz', conv && conv.channels === 1 && conv.bits === 16 && conv.rate === 16000 && Math.abs(conv.data.length / 2 - 1600) <= 1, conv && { ...conv, data: conv.data.length });
check('non-WAV is not sent to Muse Voice Transcribe', bb.toTranscribeWav(Buffer.from('not audio')) === null);

const text = await bb.transcribe({ mime: 'audio/wav', data: wav44.toString('base64') });
const last = seen.asr.at(-1);
check('transcript returned', text === 'flap your wings', text);
check('retried on the same model after a 503', seen.asr.length === 2 && seen.asr.every(a => a.request.model === 'muse-voice-transcribe-1.0'), seen.asr.map(a => a.request.model));
check('request: Bearer key, PUSH_TO_TALK, audioEncoding WAV', last.auth === 'Bearer test-meta-key' && last.request.mode === 'PUSH_TO_TALK' && last.request.audioEncoding === 'WAV', { auth: last.auth, request: last.request });
check('audio part is 16 kHz mono WAV', bb.parseWav(last.audio)?.rate === 16000 && bb.parseWav(last.audio)?.channels === 1);

// --- SAM 3.1 -----------------------------------------------------------------------------------------------------
check('box tokens parsed (x2/y2 made exclusive, confidence kept)',
  JSON.stringify(seg.parseSamBoxes('<0f>0<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=20;c=0.5|>')) === JSON.stringify([{ x1: 1, y1: 2, x2: 4, y2: 5, w: 10, h: 20, c: 0.5 }]));

const app = createServer((req, res) => handleApi(req, res)).listen(0);
await new Promise(r => app.once('listening', r));
const png = 'data:image/png;base64,' + Buffer.from('fake image bytes').toString('base64');
const post = async body => {
  const r = await fetch(`http://127.0.0.1:${app.address().port}/api/segment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const s = await post({ image: { dataUrl: png, mimeType: 'image/png' }, concepts: ['head', 'body', 'wing', 'tail', 'antenna'] });
const parts = Object.fromEntries((s.json.parts ?? []).map(p => [p.concept, p.boxes.length]));
check('/api/segment: 200 with sam-3.1', s.status === 200 && s.json.model === 'sam-3.1', s);
check('one request per concept, input_text + input_image data URL', seen.sam.length === 5 && seen.sam.every(q => q.body.model === 'sam-3.1' && q.body.stream === true
  && q.body.input[0].content.some(c => c.type === 'input_image' && c.image_url === png) && q.auth === 'Bearer test-meta-key'), seen.sam.map(q => q.concept));
check('parts found: head 1, body 1, wing 2 (antenna none, tail failed)', parts.head === 1 && parts.body === 1 && parts.wing === 2 && !parts.antenna && !parts.tail, parts);
check('failed concept reported, others kept', (s.json.errors ?? []).length === 1 && /tail/.test(s.json.errors[0]), s.json.errors);
check('image size from the box tokens', s.json.width === 200 && s.json.height === 100, s.json);
check('layout text measures each part', /Whole subject/.test(s.json.layout) && /head: 1 found/.test(s.json.layout) && /wing: 2 found/.test(s.json.layout) && /top-left/.test(s.json.layout), s.json.layout);
const bad = await post({ image: { dataUrl: 'data:text/plain;base64,aGk=' } });
check('non-image rejected with 400', bad.status === 400, bad);

app.close(); mock.close();
const failed = results.filter(r => !r[1]);
console.log(`meta media: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
