// Phase 2 code editor: the generated firmware (editable, edits kept per project), the optional AI controller
// module, ZIP download, and "Flash to board" over Web Serial with a live serial monitor.
// Per platform (spec.platform):
// - CyberBrick: MicroPython over Web Serial (unchanged).
// - XiaoZhi / ESP32-S3: flash MicroPython once, then the same Web Serial flow copies the voice robot app.
// - LicheeRV Claw / Raspberry Pi / Jetson: a Linux Python app package copied with scp (USB network or <host>.local).
// Voice robots get the AI backbone URL and robot token (and Wi-Fi for XiaoZhi) written into config.py of the files
// that are downloaded or flashed; the editor tabs keep the placeholders. The token is never logged.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Assembly } from '../cad/types';
import type { Behavior } from '../design/behaviors';
import { firmwareFiles } from '../design/firmware';
import { DEFAULT_BACKBONE_URL, isLinuxPlatform, linuxAppId, withBackbone } from '../design/firmwareLinux';
import type { RobotSpec } from '../design/spec';
import type { RLPolicyParams } from '../sim/rl';
import { connectBoard, flashFiles, serialSupported, type RawRepl } from '../device/flasher';
import { download, firmwareZip, slug } from '../export/files';

const editsKey = (projectId: string) => `cyberbuild.fw_edits.v1.${projectId}`;
const URL_KEY = 'picoceo.backbone.url';
const TOKEN_KEY = 'picoceo.backbone.token';
const readLs = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const writeLs = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* blocked */ } };

export function CodeEditor(props: {
  projectId: string;
  spec: RobotSpec;
  asm: Assembly;
  behaviors: Behavior[];
  rlPolicy?: RLPolicyParams;
  aiModule?: { filename: string; code: string } | null;
  onGenerateAi: () => void;
  generatingAi: boolean;
}) {
  const platform = props.spec.platform ?? 'cyberbrick';
  const linux = isLinuxPlatform(platform);
  const xiaozhi = platform === 'xiaozhi';
  const voice = linux || xiaozhi;
  const cyberbrick = !voice;
  const generated = useMemo(() => {
    const files = firmwareFiles(props.spec, props.asm, props.behaviors, props.rlPolicy);
    // the AI controller module is written for the CyberBrick MicroPython build
    if (props.aiModule?.code && cyberbrick) files[props.aiModule.filename || 'ai_controller.py'] = props.aiModule.code;
    return files;
  }, [props.spec, props.asm, props.behaviors, props.rlPolicy, props.aiModule, cyberbrick]);

  const [edits, setEdits] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(editsKey(props.projectId)) ?? '{}'); } catch { return {}; }
  });
  useEffect(() => {
    try { setEdits(JSON.parse(localStorage.getItem(editsKey(props.projectId)) ?? '{}')); } catch { setEdits({}); }
  }, [props.projectId]);
  useEffect(() => {
    try { localStorage.setItem(editsKey(props.projectId), JSON.stringify(edits)); } catch { /* storage full or blocked */ }
  }, [edits, props.projectId]);

  const names = Object.keys(generated);
  const [file, setFile] = useState('main.py');
  const current = names.includes(file) ? file : names[0];
  const files = useMemo(() => Object.fromEntries(names.map(n => [n, edits[n] ?? generated[n]])), [generated, edits]);
  const edited = (n: string) => edits[n] !== undefined && edits[n] !== generated[n];

  // ---------------------------------------------------------------- AI backbone link (voice robots)
  const [bbUrl, setBbUrl] = useState(() => readLs(URL_KEY) || DEFAULT_BACKBONE_URL);
  const [bbToken, setBbToken] = useState(() => readLs(TOKEN_KEY));
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  useEffect(() => {
    // the AI Brain section may write new values while this panel is open
    const on = (e: StorageEvent) => {
      if (e.key === URL_KEY && e.newValue) setBbUrl(e.newValue);
      if (e.key === TOKEN_KEY) setBbToken(e.newValue ?? '');
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  const deliver = useMemo(
    () => (voice ? withBackbone(files, { url: bbUrl, token: bbToken, ...(xiaozhi ? { wifiSsid, wifiPass } : {}) }) : files),
    [files, voice, xiaozhi, bbUrl, bbToken, wifiSsid, wifiPass],
  );

  // ---------------------------------------------------------------- board connection
  const [conn, setConn] = useState<{ repl: RawRepl; close: () => Promise<void>; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [monitor, setMonitor] = useState('');
  const monRef = useRef<HTMLPreElement>(null);
  const add = (l: string) => setLog(x => [...x.slice(-40), l]);
  useEffect(() => { monRef.current?.scrollTo(0, monRef.current.scrollHeight); }, [monitor]);
  useEffect(() => () => { void conn?.close(); }, [conn]);

  const connect = async () => {
    try {
      const { port, repl, label } = await connectBoard();
      repl.onData = t => setMonitor(m => (m + t.replace(/[\x00-\x08\x0e-\x1f]/g, '')).slice(-6000));
      setConn({ repl, label, close: async () => { await repl.close(); try { await port.close(); } catch { /* already closed */ } } });
      add(`Connected to ${label}.`);
    } catch (e) {
      if ((e as Error).name !== 'NotFoundError') add(`Could not connect: ${(e as Error).message}`);
    }
  };
  const flash = async () => {
    if (!conn) return;
    if (xiaozhi && !bbToken) add('Note: no robot token set; the robot will ask for one on its screen.');
    setBusy(true); setProgress(0);
    try {
      await flashFiles(conn.repl, deliver, add, setProgress);
      add('✓ Flashed. The robot is starting; its output appears in the serial monitor below.');
    } catch (e) {
      add(`✕ Flash failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => { await conn?.close(); setConn(null); add('Disconnected.'); };
  const zipName = `${slug(props.spec.name)}_${linux ? `${platform === 'licheerv_claw' ? 'claw' : platform}_app` : xiaozhi ? 'xiaozhi_app' : 'firmware'}.zip`;
  const downloadZip = () => download(zipName, firmwareZip(props.spec, deliver), 'application/zip');

  const backbone = voice && (
    <BackboneFields
      url={bbUrl} token={bbToken} xiaozhi={xiaozhi} ssid={wifiSsid} pass={wifiPass}
      onUrl={v => { setBbUrl(v); writeLs(URL_KEY, v.trim()); }}
      onToken={v => { setBbToken(v); writeLs(TOKEN_KEY, v.trim()); }}
      onSsid={setWifiSsid} onPass={setWifiPass}
    />
  );

  return (
    <div className="code-editor">
      <div className="code-files">
        {names.map(n => (
          <button key={n} className={n === current ? 'on' : ''} onClick={() => setFile(n)} title={edited(n) ? 'Edited' : 'Generated'}>
            {n}{edited(n) ? ' ●' : ''}
          </button>
        ))}
        <span className="spacer" />
        {edited(current) && <button onClick={() => setEdits(({ [current]: _, ...rest }) => rest)} title="Discard your edits to this file">Revert file</button>}
        {cyberbrick && <button onClick={props.onGenerateAi} disabled={props.generatingAi} title="Ask the AI to write a custom controller module (design step 7)">
          {props.generatingAi ? 'Writing…' : props.aiModule ? '✨ Regenerate AI controller' : '✨ AI controller'}
        </button>}
        <button onClick={downloadZip} title={voice ? 'Backbone URL and robot token are written into config.py of the download' : undefined}>Download ZIP</button>
      </div>
      <textarea
        className="code-area"
        spellCheck={false}
        value={files[current] ?? ''}
        onChange={e => { const v = e.target.value; setEdits(x => ({ ...x, [current]: v })); }}
        onKeyDown={e => {
          if (e.key !== 'Tab') return;
          e.preventDefault();
          const t = e.currentTarget, s = t.selectionStart, v = t.value;
          setEdits(x => ({ ...x, [current]: v.slice(0, s) + '    ' + v.slice(t.selectionEnd) }));
          requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4; });
        }}
        aria-label={`Edit ${current}`}
      />
      {linux ? (
        <>
          {backbone}
          {platform === 'licheerv_claw'
            ? <ClawInstall app={linuxAppId(props.spec)} onDownload={downloadZip} />
            : <LinuxInstall app={linuxAppId(props.spec)} platform={platform as 'rpi' | 'jetson'} onDownload={downloadZip} />}
        </>
      ) : (
        <>
          {backbone}
          <div className="flash-panel">
            <div className="flash-head">
              <b>Flash to board</b>
              <span className="mute">{conn ? `● ${conn.label}` : xiaozhi ? 'USB · XiaoZhi / ESP32-S3 with MicroPython' : 'USB · CyberBrick ESP32-C3 core with MicroPython'}</span>
              <span className="spacer" />
              {!serialSupported() ? <span className="warn-text">Web Serial needs Chrome or Edge on desktop.</span>
                : !conn ? <button className="primary" onClick={connect}>Connect board</button>
                : <>
                    <button className="primary" onClick={flash} disabled={busy}>{busy ? `Flashing ${Math.round(progress * 100)} %` : `⚡ Flash ${names.filter(n => n.endsWith('.py') || n.endsWith('.json')).length} files`}</button>
                    <button onClick={disconnect} disabled={busy}>Disconnect</button>
                  </>}
            </div>
            {xiaozhi && !conn && (
              <div className="flash-log claw-install">
                <div>1. Once per board, flash MicroPython: download <b>ESP32_GENERIC_S3</b> with SPIRAM (SPIRAM_OCT for N16R8 / N8R8 modules) from micropython.org, then
                  {' '}<code>esptool.py --chip esp32s3 --port COM5 erase_flash</code> and <code>esptool.py --chip esp32s3 --port COM5 write_flash -z 0 &lt;firmware&gt;.bin</code>
                  {' '}(hold BOOT while plugging in if no port shows up).</div>
                <div>2. Fill in Wi-Fi, backbone URL and robot token above, then <b>Connect board</b> and <b>Flash</b>: the app files are copied over USB and the board restarts.</div>
                <div>3. Hold the BOOT button to talk, release to send. README.md lists the pins to check.</div>
              </div>
            )}
            {busy && <div className="flash-bar"><i style={{ width: `${progress * 100}%` }} /></div>}
            {log.length > 0 && <div className="flash-log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
            {conn && <pre className="serial-monitor" ref={monRef}>{monitor || 'Serial monitor: board output appears here.'}</pre>}
          </div>
        </>
      )}
    </div>
  );
}

/** Backbone URL + robot token (prefilled from the AI Brain section's localStorage keys), Wi-Fi for XiaoZhi. */
function BackboneFields(p: {
  url: string; token: string; xiaozhi: boolean; ssid: string; pass: string;
  onUrl: (v: string) => void; onToken: (v: string) => void; onSsid: (v: string) => void; onPass: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flash-panel">
      <div className="flash-head">
        <b>AI backbone link</b>
        <span className="mute">written into config.py of the {p.xiaozhi ? 'flashed and downloaded' : 'downloaded'} files</span>
        <span className="spacer" />
        {!p.token && <span className="warn-text">No robot token: pair the robot in the AI Brain section, or paste its token.</span>}
      </div>
      <div className="flash-log claw-install">
        <div>Backbone URL <input value={p.url} onChange={e => p.onUrl(e.target.value)} size={44} aria-label="Backbone URL" spellCheck={false} /></div>
        <div>Robot token <input type={show ? 'text' : 'password'} value={p.token} onChange={e => p.onToken(e.target.value)} size={36}
          aria-label="Robot token" autoComplete="off" spellCheck={false} />
          {' '}<button className="mini-btn" onClick={() => setShow(s => !s)}>{show ? 'Hide' : 'Show'}</button>
          <span className="mute"> keep it secret: anyone with it can talk as this robot</span></div>
        {p.xiaozhi && <div>Wi-Fi <input value={p.ssid} onChange={e => p.onSsid(e.target.value)} size={18} placeholder="network name" aria-label="Wi-Fi network name" />
          {' '}<input type="password" value={p.pass} onChange={e => p.onPass(e.target.value)} size={18} placeholder="password" aria-label="Wi-Fi password" autoComplete="off" />
          <span className="mute"> (not stored by PICOCEO Builder)</span></div>}
      </div>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState('');
  const copy = (c: string) => { void navigator.clipboard?.writeText(c); setCopied(c); setTimeout(() => setCopied(''), 1500); };
  return { copied, copy };
}

function CmdRows(p: { cmds: { c: string; note?: string }[] }) {
  const { copied, copy } = useCopy();
  return <>{p.cmds.map(({ c, note }) => (
    <div key={c} className="cmd-row">
      <code>{c}</code>
      <button className="mini-btn" onClick={() => copy(c)}>{copied === c ? 'Copied' : 'Copy'}</button>
      {note && <span className="mute"> {note}</span>}
    </div>
  ))}</>;
}

/** LicheeRV Claw: no serial flashing; the app is copied to the Nano over the USB network (RNDIS, board at .1). */
function ClawInstall(props: { app: string; onDownload: () => void }) {
  const [ip, setIp] = useState('10.131.76.1');
  return (
    <div className="flash-panel">
      <div className="flash-head">
        <b>Install on the LicheeRV Claw</b>
        <span className="mute">Linux Python app · copy over the USB network</span>
        <span className="spacer" />
        <button className="primary" onClick={props.onDownload}>⬇ Download app package</button>
      </div>
      <div className="flash-log claw-install">
        <div>1. Plug the Claw in with USB-C. It appears as a network adapter; the board is the address ending in <b>.1</b>.
          Board IP <input value={ip} onChange={e => setIp(e.target.value.trim())} size={14} aria-label="Board IP address" /> (login root / root)</div>
        <div>2. Unzip the package, then from that folder run:</div>
        <CmdRows cmds={[
          { c: `scp -r ${props.app} root@${ip}:/root/` },
          { c: `ssh root@${ip} "chmod +x /root/${props.app}/run.sh && /root/${props.app}/run.sh"` },
          { c: `nc ${ip} 8765`, note: 'then type say hello, list, play <behaviour>, stop' },
        ]} />
        <div>On the board: hold the left side key to talk, the right one plays the next behaviour, hold it 2 s to quit back to PicoClaw. The Claw needs Wi-Fi to reach the backbone. README.md lists what to check on your image (I2C bus, LCD framebuffer, mixer).</div>
      </div>
    </div>
  );
}

/** Raspberry Pi / Jetson: scp to <host>.local, try run.sh, then run.sh install (systemctl enable). */
function LinuxInstall(props: { app: string; platform: 'rpi' | 'jetson'; onDownload: () => void }) {
  const pi = props.platform === 'rpi';
  const [host, setHost] = useState(pi ? 'raspberrypi.local' : 'jetson.local');
  const [user, setUser] = useState(pi ? 'pi' : 'user');
  const at = `${user}@${host}`;
  return (
    <div className="flash-panel">
      <div className="flash-head">
        <b>Install on the {pi ? 'Raspberry Pi' : 'Jetson'}</b>
        <span className="mute">Linux Python app · scp over your network · systemd service</span>
        <span className="spacer" />
        <button className="primary" onClick={props.onDownload}>⬇ Download app package</button>
      </div>
      <div className="flash-log claw-install">
        <div>1. {pi ? 'Raspberry Pi OS with SSH on (set host name, user and Wi-Fi in Raspberry Pi Imager)' : 'JetPack with SSH, on the same network'};
          {' '}<code>sudo apt install alsa-utils{pi ? ' python3-gpiozero' : ''}</code>.
          Host <input value={host} onChange={e => setHost(e.target.value.trim())} size={18} aria-label="Host name" />
          {' '}user <input value={user} onChange={e => setUser(e.target.value.trim())} size={8} aria-label="User name" /></div>
        <div>2. Unzip the package, then from that folder: copy it, try it in the foreground, then make it start at boot:</div>
        <CmdRows cmds={[
          { c: `scp -r ${props.app} ${at}:~/` },
          { c: `ssh -t ${at} "cd ~/${props.app} && chmod +x run.sh && ./run.sh"`, note: 'Ctrl-C to stop' },
          { c: `ssh -t ${at} "cd ~/${props.app} && sudo ./run.sh install"`, note: `systemctl enable --now ${props.app}` },
          { c: `ssh ${at} "journalctl -u ${props.app} -f"`, note: 'logs' },
        ]} />
        <div>Talk: hold the button on {pi ? 'GPIO17 (the ReSpeaker HAT button)' : 'header pin 11'}, or press Enter in the terminal. Line commands: <code>nc {host} 8765</code>, then <code>say hello</code>. README.md lists the audio devices and buses to check.</div>
      </div>
    </div>
  );
}
