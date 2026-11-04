// Unit test for the backbone WAV encoder (src/backbone/audio.ts): header fields, lengths, sample rate, resampling,
// clipping and base64 round trip. Run: npx tsx scripts/wavtest.ts
import { base64ToBytes, bytesToBase64, downsample, encodeWav, parseWav, TARGET_RATE, MAX_SECONDS } from '../src/backbone/audio';

let fails = 0, passes = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) passes++; else { fails++; console.error(`FAIL ${name} ${detail}`); }
};

// 1 s of a 440 Hz tone at 48 kHz -> 16 kHz
const src = new Float32Array(48000);
for (let i = 0; i < src.length; i++) src[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
const pcm = downsample(src, 48000, TARGET_RATE);
check('downsample length', pcm.length === 16000, `got ${pcm.length}`);
const wav = encodeWav(pcm, TARGET_RATE);
const v = new DataView(wav.buffer);
const tag = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4));

check('total bytes', wav.length === 44 + 16000 * 2, `got ${wav.length}`);
check('RIFF', tag(0) === 'RIFF');
check('RIFF size', v.getUint32(4, true) === wav.length - 8, `got ${v.getUint32(4, true)}`);
check('WAVE', tag(8) === 'WAVE');
check('fmt ', tag(12) === 'fmt ');
check('fmt size 16', v.getUint32(16, true) === 16);
check('PCM format 1', v.getUint16(20, true) === 1);
check('mono', v.getUint16(22, true) === 1);
check('sample rate 16000', v.getUint32(24, true) === 16000, `got ${v.getUint32(24, true)}`);
check('byte rate 32000', v.getUint32(28, true) === 32000);
check('block align 2', v.getUint16(32, true) === 2);
check('16 bits', v.getUint16(34, true) === 16);
check('data tag', tag(36) === 'data');
check('data size', v.getUint32(40, true) === 32000);

const info = parseWav(wav);
check('parse rate', info.rate === 16000);
check('parse seconds', Math.abs(info.seconds - 1) < 1e-9, `got ${info.seconds}`);
check('parse bits/channels', info.bits === 16 && info.channels === 1);

// amplitude survives (peak ~0.5 * 32767; box averaging over 3 samples only slightly attenuates 440 Hz)
let peak = 0;
for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(v.getInt16(44 + i * 2, true)));
check('peak amplitude', peak > 15500 && peak <= 16384, `got ${peak}`);

// clipping and extremes
const edge = encodeWav(new Float32Array([2, -2, 1, -1, 0]), 16000);
const e = new DataView(edge.buffer);
check('clip +', e.getInt16(44, true) === 32767);
check('clip -', e.getInt16(46, true) === -32768);
check('+1', e.getInt16(48, true) === 32767);
check('-1', e.getInt16(50, true) === -32768);
check('0', e.getInt16(52, true) === 0);

// other source rates
check('44.1k -> 16k length', downsample(new Float32Array(44100), 44100).length === 16000);
check('same rate copy', downsample(new Float32Array(160), 16000).length === 160);
check('upsample 8k -> 16k', downsample(new Float32Array(8000), 8000, 16000).length === 16000);

// base64 round trip, and the 20 s cap fits the 8 MB body limit
const b64 = bytesToBase64(wav);
const back = base64ToBytes(b64);
check('base64 round trip', back.length === wav.length && back.every((x, i) => x === wav[i]));
check('data: URL prefix accepted', base64ToBytes('data:audio/wav;base64,' + b64).length === wav.length);
const maxBytes = 44 + MAX_SECONDS * TARGET_RATE * 2;
check('20 s base64 < 8 MB', Math.ceil(maxBytes / 3) * 4 < 8 * 1024 * 1024, `${maxBytes} bytes`);

// parseWav walks extra chunks (LIST before data, like many TTS encoders)
const list = new Uint8Array(wav.length + 12);
list.set(wav.subarray(0, 36));
list.set([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 0x49, 0x4e, 0x46, 0x4f], 36);
list.set(wav.subarray(36), 48);
check('parse with LIST chunk', parseWav(list).dataBytes === 32000);

console.log(`wavtest: ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
