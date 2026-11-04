// SAM 3.1 (Meta Model API) on the reference picture: one short noun phrase per request ("head", "wing", ...), the
// streamed answer read for its box tokens, and the boxes turned into a part layout the design steps can follow.
//
// Request (Responses API, as in Meta's cookbook 07_sam/01_api_basics):
//   POST {META_BASE_URL}/responses  { model: "sam-3.1", stream: true,
//     input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: dataUrl }] }] }
// Answer text: <0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=W;h=H[;c=..]|><|mask;...|>,1<|box;...|>...  (x2/y2 inclusive)

export const SAM_MODEL = () => process.env.META_SAM_MODEL || 'sam-3.1';
export const DEFAULT_CONCEPTS = ['head', 'body', 'wing', 'leg', 'tail', 'arm'];

const baseUrl = () => (process.env.META_BASE_URL || process.env.MUSE_BASE_URL || 'https://api.meta.ai/v1').replace(/\/+$/, '');

/** Box tokens of a SAM answer -> [{ x1, y1, x2, y2, w, h, c }] (pixels, x2/y2 exclusive). */
export function parseSamBoxes(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/<\|box;([^|]*)\|>/g)) {
    const kv = Object.fromEntries(m[1].split(';').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k.trim(), Number(v)]));
    if (![kv.x1, kv.y1, kv.x2, kv.y2].every(Number.isFinite)) continue;
    out.push({ x1: kv.x1, y1: kv.y1, x2: kv.x2 + 1, y2: kv.y2 + 1, w: kv.w, h: kv.h, ...(Number.isFinite(kv.c) ? { c: kv.c } : {}) });
  }
  return out;
}

/** The text of a streamed Responses answer (SSE): output_text deltas, or the completed response's text. */
export async function readResponseText(res) {
  const raw = await res.text();
  let deltas = '', done = '';
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let ev; try { ev = JSON.parse(payload); } catch { continue; }
    if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') deltas += ev.delta;
    if (ev.type === 'response.completed' || ev.type === 'response.output_text.done') {
      const t = ev.text ?? (ev.response?.output ?? []).flatMap(o => o.content ?? []).map(c => c.text ?? '').join('');
      if (t) done = t;
    }
  }
  if (!deltas && !done && raw.trim().startsWith('{')) {   // a non-streamed JSON answer
    try {
      const j = JSON.parse(raw);
      done = j.output_text ?? (j.output ?? []).flatMap(o => o.content ?? []).map(c => c.text ?? '').join('');
    } catch { /* not JSON */ }
  }
  return deltas || done;
}

async function segmentConcept(key, dataUrl, concept) {
  const res = await fetch(`${baseUrl()}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: SAM_MODEL(), stream: true,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: concept }, { type: 'input_image', image_url: dataUrl }] }],
      metadata: { include_confidence: 'true' },
    }),
    signal: AbortSignal.timeout(Number(process.env.META_SAM_TIMEOUT_MS || 30000)),
  });
  if (!res.ok) throw Object.assign(new Error(`${SAM_MODEL()} ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
  return parseSamBoxes(await readResponseText(res));
}

const pct = v => Math.round(v * 100);
const where = (cx, cy) => `${cy < 0.34 ? 'top' : cy > 0.66 ? 'bottom' : 'middle'}-${cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'centre'}`;

/** Boxes per concept -> the subject's measured part layout (fractions of the whole subject's extent) and a prompt text. */
export function describeLayout(parts) {
  const all = parts.flatMap(p => p.boxes);
  if (!all.length) return { layout: '', subject: null };
  const sx1 = Math.min(...all.map(b => b.x1)), sy1 = Math.min(...all.map(b => b.y1));
  const sx2 = Math.max(...all.map(b => b.x2)), sy2 = Math.max(...all.map(b => b.y2));
  const SW = Math.max(1, sx2 - sx1), SH = Math.max(1, sy2 - sy1);
  const lines = [`Whole subject: width : height = ${(SW / SH).toFixed(2)} : 1.`];
  for (const p of parts) {
    if (!p.boxes.length) continue;
    const b = [...p.boxes].sort((a, c) => (c.x2 - c.x1) * (c.y2 - c.y1) - (a.x2 - a.x1) * (a.y2 - a.y1))[0];
    const cx = ((b.x1 + b.x2) / 2 - sx1) / SW, cy = ((b.y1 + b.y2) / 2 - sy1) / SH;
    lines.push(`${p.concept}: ${p.boxes.length} found; the largest is ${pct((b.x2 - b.x1) / SW)}% of the subject's width and ${pct((b.y2 - b.y1) / SH)}% of its height, centred ${where(cx, cy)} (x ${pct(cx)}%, y ${pct(cy)}% from the top-left).`);
  }
  return { layout: lines.join('\n'), subject: { x1: sx1, y1: sy1, x2: sx2, y2: sy2 } };
}

/**
 * Segment the reference picture into named parts with SAM 3.1. Concept requests run in parallel; a concept that fails
 * is reported in `errors` and the rest still count. Throws only when no Meta key is set or every request failed.
 */
export async function segmentReference({ key, image, concepts }) {
  if (!key) throw Object.assign(new Error('No Meta Model API key configured.'), { status: 503 });
  const dataUrl = image?.dataUrl;
  if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(dataUrl)) throw Object.assign(new Error('image must be a PNG, JPEG or WebP data URL'), { status: 400 });
  if (dataUrl.length > 8_000_000) throw Object.assign(new Error('image too large'), { status: 413 });
  const list = [...new Set((Array.isArray(concepts) && concepts.length ? concepts : DEFAULT_CONCEPTS)
    .map(c => String(c ?? '').trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 8);
  const settled = await Promise.allSettled(list.map(c => segmentConcept(key, dataUrl, c)));
  const errors = [];
  const parts = settled.map((s, i) => {
    if (s.status === 'rejected') { errors.push(`${list[i]}: ${s.reason?.message || s.reason}`); return { concept: list[i], boxes: [] }; }
    return { concept: list[i], boxes: s.value };
  });
  if (errors.length === list.length) throw Object.assign(new Error(`SAM 3.1 failed: ${errors[0]}`), { status: settled[0].reason?.status || 502 });
  const first = parts.flatMap(p => p.boxes)[0];
  const { layout, subject } = describeLayout(parts);
  return { model: SAM_MODEL(), width: first?.w ?? null, height: first?.h ?? null, parts: parts.filter(p => p.boxes.length), subject, layout, errors };
}
