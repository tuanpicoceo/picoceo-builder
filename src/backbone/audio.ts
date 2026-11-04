// Browser audio for the backbone console: mic capture -> 16 kHz mono 16-bit WAV (base64), and WAV playback with
// level meters (input level drives the "listening" face, output level drives the mouth).
// The encoder helpers at the top are pure (no DOM) so scripts/wavtest.ts can test them in node.

export const TARGET_RATE = 16000;
export const MAX_SECONDS = 20;

// ---------------------------------------------------------------- pure helpers

/** Linear-interpolating / box-averaging resampler from `from` Hz to `to` Hz (mono). */
export function downsample(input: Float32Array, from: number, to: number = TARGET_RATE): Float32Array {
  if (from === to) return input.slice();
  const ratio = from / to;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  if (ratio > 1) {
    // average each source window (cheap anti-alias filter)
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let k = a; k < b; k++) s += input[k];
      out[i] = b > a ? s / (b - a) : input[a] ?? 0;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const x = i * ratio, k = Math.floor(x), f = x - k;
      out[i] = (input[k] ?? 0) * (1 - f) + (input[k + 1] ?? input[k] ?? 0) * f;
    }
  }
  return out;
}

/** Encode mono float samples (-1..1) as a RIFF/WAVE PCM s16le file. */
export function encodeWav(samples: Float32Array, rate: number = TARGET_RATE): Uint8Array {
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return new Uint8Array(buf);
}

export interface WavInfo { rate: number; channels: number; bits: number; dataBytes: number; seconds: number; dataOffset: number }

/** Read the header of a PCM WAV (walks chunks, so LIST/fact chunks before `data` are fine). */
export function parseWav(bytes: Uint8Array): WavInfo {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, rate = 0, channels = 0, bits = 0;
  while (o + 8 <= bytes.length) {
    const id = tag(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') { channels = v.getUint16(o + 10, true); rate = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    if (id === 'data') {
      const dataBytes = Math.min(len, bytes.length - o - 8);
      return { rate, channels, bits, dataBytes, dataOffset: o + 8, seconds: rate && channels && bits ? dataBytes / (rate * channels * (bits / 8)) : 0 };
    }
    o += 8 + len + (len & 1);
  }
  throw new Error('WAV has no data chunk');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}
export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/^data:[^,]*,/, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** RMS of an analyser's time-domain data, scaled to roughly 0..1 for speech. */
function rmsLevel(an: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  an.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.min(1, Math.sqrt(s / buf.length) * 4);
}

// ---------------------------------------------------------------- shared context

let shared: AudioContext | null = null;
function ctx(): AudioContext {
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) throw new Error('This browser has no Web Audio support.');
  if (!shared || shared.state === 'closed') shared = new AC();
  return shared;
}

export const micSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window !== 'undefined' && !!(window.AudioContext ?? (window as any).webkitAudioContext);

// ---------------------------------------------------------------- recorder

export interface Recording { base64: string; seconds: number; bytes: number }

const WORKLET = `class PicoTap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('pico-tap', PicoTap);`;
let workletUrl: string | null = null;

/** Hold-to-talk recorder. `start()` asks for the mic; `stop()` returns the WAV; it auto-stops at MAX_SECONDS. */
export class MicRecorder {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf = new Float32Array(512);
  private chunks: Float32Array[] = [];
  private samples = 0;
  private rate = 48000;
  private timer = 0;
  recording = false;
  /** Called when the 20 s cap stops the recording by itself. */
  onAutoStop: (() => void) | null = null;

  async start(): Promise<void> {
    if (this.recording) return;
    const ac = ctx();
    if (ac.state === 'suspended') await ac.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.rate = ac.sampleRate;
    this.chunks = []; this.samples = 0;
    this.source = ac.createMediaStreamSource(this.stream);
    this.analyser = ac.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    const push = (d: Float32Array) => {
      if (!this.recording) return;
      this.chunks.push(d); this.samples += d.length;
      if (this.samples >= this.rate * MAX_SECONDS) { this.recording = false; this.onAutoStop?.(); }
    };
    let node: AudioNode | null = null;
    if (ac.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        workletUrl ??= URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await ac.audioWorklet.addModule(workletUrl);
        const w = new AudioWorkletNode(ac, 'pico-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
        w.port.onmessage = e => push(e.data as Float32Array);
        node = w;
      } catch { node = null; }
    }
    if (!node) {
      const sp = ac.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = e => push(new Float32Array(e.inputBuffer.getChannelData(0)));
      node = sp;
    }
    this.source.connect(node);
    // a muted sink keeps the graph pulling without echoing the mic
    const mute = ac.createGain(); mute.gain.value = 0;
    node.connect(mute); mute.connect(ac.destination);
    this.node = node;
    this.recording = true;
    this.timer = window.setTimeout(() => { if (this.recording) { this.recording = false; this.onAutoStop?.(); } }, MAX_SECONDS * 1000 + 250);
  }

  /** Mic level 0..1 (0 when idle). */
  level(): number {
    return this.analyser && this.recording ? rmsLevel(this.analyser, this.levelBuf) : 0;
  }

  /** Stop and encode. Resolves null when nothing (or < 0.3 s) was captured. */
  async stop(): Promise<Recording | null> {
    this.recording = false;
    clearTimeout(this.timer);
    const chunks = this.chunks, total = this.samples, rate = this.rate;
    this.teardown();
    if (total < rate * 0.3) return null;
    const all = new Float32Array(Math.min(total, rate * MAX_SECONDS));
    let o = 0;
    for (const c of chunks) { if (o >= all.length) break; all.set(c.subarray(0, all.length - o), o); o += c.length; }
    const pcm = downsample(all, rate, TARGET_RATE);
    const wav = encodeWav(pcm, TARGET_RATE);
    return { base64: bytesToBase64(wav), seconds: pcm.length / TARGET_RATE, bytes: wav.length };
  }

  cancel() { this.recording = false; clearTimeout(this.timer); this.teardown(); }

  private teardown() {
    try { this.source?.disconnect(); } catch { /* */ }
    try { this.node?.disconnect(); } catch { /* */ }
    if (this.node instanceof AudioWorkletNode) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null; this.source = null; this.node = null; this.analyser = null; this.chunks = []; this.samples = 0;
  }
}

// ---------------------------------------------------------------- player

/** Plays base64 WAV replies one at a time and exposes the output level for the mouth. */
export class WavPlayer {
  private src: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private buf = new Float32Array(512);
  private vol = 1;
  playing = false;

  setVolume(level0to100: number) {
    this.vol = Math.max(0, Math.min(1, level0to100 / 100));
    if (this.gain) this.gain.gain.value = this.vol;
  }

  /** Resolves when playback ends (or is stopped). */
  async play(base64: string): Promise<void> {
    this.stop();
    const ac = ctx();
    if (ac.state === 'suspended') await ac.resume();
    const bytes = base64ToBytes(base64);
    const audio = await ac.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const src = ac.createBufferSource();
    src.buffer = audio;
    this.analyser ??= ac.createAnalyser();
    this.analyser.fftSize = 1024;
    if (!this.gain) { this.gain = ac.createGain(); this.gain.connect(ac.destination); this.analyser.connect(this.gain); }
    this.gain.gain.value = this.vol;
    src.connect(this.analyser);
    this.src = src;
    this.playing = true;
    await new Promise<void>(resolve => {
      src.onended = () => { if (this.src === src) { this.playing = false; this.src = null; } resolve(); };
      src.start();
    });
  }

  level(): number { return this.playing && this.analyser ? rmsLevel(this.analyser, this.buf) : 0; }

  stop() {
    const s = this.src;
    this.src = null; this.playing = false;
    if (s) { try { s.stop(); } catch { /* already stopped */ } try { s.disconnect(); } catch { /* */ } }
  }
}
