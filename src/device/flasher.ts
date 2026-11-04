// Flash generated MicroPython straight to the CyberBrick ESP32-C3 core over USB (Web Serial, Chrome / Edge).
// The core ships with MicroPython, so "flashing" = writing each .py file through the raw REPL, the same
// protocol mpremote uses: Ctrl-C to stop the running program, Ctrl-A for the raw REPL, code + Ctrl-D runs it
// and answers "OK<stdout>\x04<stderr>\x04>". Files are written in hex chunks so any byte survives the trip,
// then Ctrl-B leaves the raw REPL and Ctrl-D soft-resets the board so main.py starts.
// The protocol code only needs a readable/writable byte stream pair, so it is tested against a fake board in Node.

export interface BytePort {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

export type FlashLog = (line: string) => void;

const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const CHUNK = 192;              // file bytes per write() call (384 hex chars per command)

export class RawRepl {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buf = '';
  private pump: Promise<void>;
  private closed = false;
  /** Everything the board prints, for the serial monitor. */
  onData?: (text: string) => void;

  constructor(port: BytePort) {
    const reader = port.readable.getReader();
    this.reader = reader;
    this.writer = port.writable.getWriter();
    this.pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = dec.decode(value, { stream: true });
          this.buf += text;
          this.onData?.(text);
        }
      } catch { /* port closed */ }
      this.closed = true;
    })();
  }

  private async write(s: string) {
    // small slices with a pause: the plain raw REPL has no flow control
    const bytes = enc.encode(s);
    for (let i = 0; i < bytes.length; i += 64) {
      await this.writer.write(bytes.slice(i, i + 64));
      if (bytes.length > 64) await sleep(4);
    }
  }

  /** Wait until the receive buffer contains `marker`; return and consume everything up to and including it. */
  private async until(marker: string, timeoutMs = 4000): Promise<string> {
    const t0 = Date.now();
    for (;;) {
      const i = this.buf.indexOf(marker);
      if (i >= 0) {
        const out = this.buf.slice(0, i + marker.length);
        this.buf = this.buf.slice(i + marker.length);
        return out;
      }
      if (this.closed) throw new Error('The board disconnected.');
      if (Date.now() - t0 > timeoutMs) throw new Error(`No answer from the board (waiting for ${JSON.stringify(marker)}). Is MicroPython running and the right port selected?`);
      await sleep(10);
    }
  }

  /** Stop the running program and enter the raw REPL. */
  async enter() {
    await this.write('\r\x03\x03');
    await sleep(150);
    this.buf = '';
    await this.write('\r\x01');
    await this.until('raw REPL; CTRL-B to exit\r\n>');
  }

  /** Run code in the raw REPL; throws with the board's traceback on error. */
  async exec(code: string, timeoutMs = 6000): Promise<string> {
    await this.write(code);
    await this.write('\x04');
    await this.until('OK', timeoutMs);
    const out = (await this.until('\x04', timeoutMs)).slice(0, -1);
    const err = (await this.until('\x04', timeoutMs)).slice(0, -1);
    await this.until('>', timeoutMs);
    if (err.trim()) throw new Error(err.trim());
    return out;
  }

  /** Write one file (UTF-8) to the board's filesystem. */
  async putFile(name: string, content: string, onChunk?: (sent: number, total: number) => void) {
    const bytes = enc.encode(content);
    await this.exec(`f=open(${JSON.stringify(name)},'wb')\nw=f.write`);
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const hex = Array.from(bytes.slice(i, i + CHUNK), b => b.toString(16).padStart(2, '0')).join('');
      await this.exec(`w(bytes.fromhex('${hex}'))`);
      onChunk?.(Math.min(bytes.length, i + CHUNK), bytes.length);
    }
    await this.exec('f.close()');
    const size = Number((await this.exec(`import os\nprint(os.stat(${JSON.stringify(name)})[6])`)).trim());
    if (size !== bytes.length) throw new Error(`${name}: wrote ${bytes.length} bytes but the board has ${size}.`);
  }

  /** Leave the raw REPL and soft-reset so boot.py / main.py run. */
  async resetAndRun() {
    await this.write('\x02');
    await sleep(50);
    await this.write('\x04');
  }

  async close() {
    try { this.reader.releaseLock(); } catch { /* */ }
    try { this.writer.releaseLock(); } catch { /* */ }
    void this.pump;
  }
}

/** Write every file, verify sizes, then reset the board. `progress` goes 0 → 1. */
export async function flashFiles(repl: RawRepl, files: Record<string, string>, log: FlashLog, progress?: (f: number) => void) {
  const names = Object.keys(files).filter(n => n.endsWith('.py') || n.endsWith('.json'));
  const total = names.reduce((s, n) => s + enc.encode(files[n]).length, 0);
  let done = 0;
  log('Stopping the running program and entering the raw REPL…');
  await repl.enter();
  const info = (await repl.exec("import sys\nprint(sys.implementation.name, '.'.join(str(v) for v in sys.implementation.version), sys.platform)")).trim();
  log(`Board: ${info}`);
  for (const n of names) {
    const start = done;
    log(`Writing ${n} (${enc.encode(files[n]).length} bytes)…`);
    await repl.putFile(n, files[n], sent => progress?.((start + sent) / total));
    done += enc.encode(files[n]).length;
  }
  log(`Wrote ${names.length} files (${total} bytes), sizes verified. Resetting the board to run main.py…`);
  await repl.resetAndRun();
  progress?.(1);
}

// ---------------------------------------------------------------- Web Serial (browser only)

interface SerialPortLike extends BytePort {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
type SerialApi = { requestPort(o?: { filters?: { usbVendorId: number }[] }): Promise<SerialPortLike> };

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

/** Ask the user to pick the board (Espressif USB-serial preferred) and open it at 115200 baud. */
export async function connectBoard(): Promise<{ port: SerialPortLike; repl: RawRepl; label: string }> {
  if (!serialSupported()) throw new Error('This browser has no Web Serial. Use Chrome or Edge on desktop.');
  const serial = (navigator as unknown as { serial: SerialApi }).serial;
  // 0x303A = Espressif (ESP32-C3 built-in USB-serial); CH340 / CP210x bridges are also allowed.
  const port = await serial.requestPort({ filters: [{ usbVendorId: 0x303a }, { usbVendorId: 0x1a86 }, { usbVendorId: 0x10c4 }] });
  await port.open({ baudRate: 115200 });
  const info = port.getInfo?.() ?? {};
  const label = info.usbVendorId === 0x303a ? 'ESP32-C3 (USB)' : `USB serial ${info.usbVendorId?.toString(16) ?? ''}:${info.usbProductId?.toString(16) ?? ''}`;
  return { port, repl: new RawRepl(port), label };
}
