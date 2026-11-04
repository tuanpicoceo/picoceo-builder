// Flasher protocol test: flashFiles() against a simulated MicroPython board speaking the raw REPL.
import { RawRepl, flashFiles } from '../src/device/flasher';
import { initKernel } from '../src/cad/kernel';
import { buildAssembly } from '../src/cad/build';
import { normalizeSpec } from '../src/design/spec';
import { behaviorsFor } from '../src/design/behaviors';
import { firmwareFiles } from '../src/design/firmware';

/** A fake ESP32-C3 running MicroPython: raw REPL, a filesystem, and the handful of statements the flasher sends. */
function fakeBoard() {
  const fs = new Map<string, Uint8Array>();
  let open: { name: string; chunks: Uint8Array[] } | null = null;
  let raw = false, resets = 0, line = '';
  const toHost = new TransformStream<Uint8Array, Uint8Array>();
  const out = toHost.writable.getWriter();
  const say = (s: string) => out.write(new TextEncoder().encode(s));
  const run = (code: string): [string, string] => {
    let stdout = '';
    for (const stmt of code.split('\n')) {
      let m: RegExpMatchArray | null;
      if ((m = stmt.match(/^f=open\("(.+)",'wb'\)$/))) open = { name: m[1], chunks: [] };
      else if (stmt === 'w=f.write' || stmt === 'import os' || stmt === 'import sys') { /* bindings */ }
      else if ((m = stmt.match(/^w\(bytes\.fromhex\('([0-9a-f]*)'\)\)$/))) {
        if (!open) return ['', 'NameError: w'];
        open.chunks.push(Uint8Array.from(m[1].match(/../g) ?? [], h => parseInt(h, 16)));
      } else if (stmt === 'f.close()') {
        if (!open) return ['', 'NameError: f'];
        const all = new Uint8Array(open.chunks.reduce((s, c) => s + c.length, 0));
        let o = 0; for (const c of open.chunks) { all.set(c, o); o += c.length; }
        fs.set(open.name, all); open = null;
      } else if ((m = stmt.match(/^print\(os\.stat\("(.+)"\)\[6\]\)$/))) {
        if (!fs.has(m[1])) return ['', `OSError: [Errno 2] ENOENT ${m[1]}`];
        stdout += `${fs.get(m[1])!.length}\r\n`;
      } else if (stmt.startsWith('print(sys.implementation.name')) stdout += 'micropython 1.22.0 esp32\r\n';
      else if (stmt.trim()) return [stdout, `SyntaxError: unexpected ${stmt.slice(0, 40)}`];
    }
    return [stdout, ''];
  };
  const fromHost = new WritableStream<Uint8Array>({
    async write(chunk) {
      for (const ch of new TextDecoder().decode(chunk)) {
        if (ch === '\x03') { line = ''; if (!raw) await say('\r\nKeyboardInterrupt\r\n>>> '); }
        else if (ch === '\x01') { raw = true; line = ''; await say('raw REPL; CTRL-B to exit\r\n>'); }
        else if (ch === '\x02') { raw = false; await say('\r\n>>> '); }
        else if (ch === '\x04') {
          if (raw) { const [o, e] = run(line); line = ''; await say(`OK${o}\x04${e}\x04>`); }
          else { resets++; await say('MPY: soft reboot\r\nrunning main.py\r\n'); }
        } else if (raw) line += ch;
      }
    },
  });
  return { port: { readable: toHost.readable, writable: fromHost }, fs, resets: () => resets };
}

let bad = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };

await initKernel();
const { spec } = normalizeSpec({ archetype: 'rover', params: { panTilt: true } });
const asm = buildAssembly(spec);
const files = firmwareFiles(spec, asm, behaviorsFor(spec));
files['main.py'] += '\n# unicode check: góc 90° ✓\n';

const board = fakeBoard();
const repl = new RawRepl(board.port);
const log: string[] = [];
let last = 0;
await flashFiles(repl, files, l => log.push(l), f => { last = f; });
await new Promise(r => setTimeout(r, 50));

const py = Object.keys(files).filter(n => n.endsWith('.py'));
ok(py.every(n => board.fs.has(n)), `all ${py.length} .py files on the board: ${[...board.fs.keys()].join(', ')}`);
ok(py.every(n => new TextDecoder().decode(board.fs.get(n)!) === files[n]), 'every file is byte-identical (incl. UTF-8 in main.py)');
ok(board.resets() === 1 && last === 1, `board soft-reset once to run main.py, progress reached 100 % (${(last * 100).toFixed(0)} %)`);
ok(log.some(l => l.includes('micropython 1.22.0')), `board identified: ${log.find(l => l.startsWith('Board'))}`);

// a board that answers with an error must surface the traceback
const broken = fakeBoard();
const repl2 = new RawRepl(broken.port);
await repl2.enter();
let msg = '';
try { await repl2.exec('this is not python'); } catch (e) { msg = (e as Error).message; }
ok(msg.includes('SyntaxError'), `errors from the board are reported: "${msg}"`);

process.exit(bad ? 1 : 0);
