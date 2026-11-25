// Rotary XL Kiosk - local server
// - serves the kiosk UI from ./public
// - stores products + settings in ./data/store.json
// - opens two serial ports (rotary Arduino + Alfie USB-CAN adapter): serial-bridge.ps1 on Windows, serial-bridge-linux.js on Linux
// - pushes received serial lines to the browser over Server-Sent Events
// - "simulation" mode answers like the real hardware so the UI can be tested without it
// No npm packages needed: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORE = path.join(DATA_DIR, 'store.json');
const BRIDGE_PS1 = path.join(ROOT, 'serial-bridge.ps1');
const PORT = parseInt(process.env.PORT, 10) || 8090;

// ------------------------------------------------------------------ store
// 3 Alfie controllers, one per door of the rotary locker
function defaultAlfies() {
  return [1, 2, 3].map(n => ({ alfie: n, name: `Door ${n}`, groupId: 0, localAddress: n }));
}
function cleanProduct(x) {
  return {
    id: String(x.id || ('p' + Date.now() + Math.random().toString(16).slice(2, 6))),
    name: String(x.name || '').slice(0, 80),
    image: String(x.image || '').slice(0, 2000),
    price: Math.max(0, Number(x.price) || 0),
    column: Math.min(12, Math.max(1, parseInt(x.column, 10) || 1)),        // rotary column (Arduino C1-C12)
    alfie: Math.min(3, Math.max(1, parseInt(x.alfie, 10) || 1)),           // which Alfie / door
    compartment: Math.min(17, Math.max(1, parseInt(x.compartment, 10) || 1)), // latch number on that Alfie
    slot: Math.min(10, Math.max(1, parseInt(x.slot, 10) || 1)),            // shelf 1-10 in the column (top = 1), for the Rotary XL display
    category: String(x.category || '').slice(0, 40),
    available: x.available !== false
  };
}

// demo catalogue: 120 products (12 columns x 10 shelves) with images, built by tools/build-catalog.js
function loadDemoProducts() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'demo-products.json'), 'utf8')).map(cleanProduct); }
  catch { return []; }
}

const DEFAULT_STORE = {
  settings: {
    adminPassword: '55885',
    currency: '$',
    simulation: true,              // true = no serial traffic, the server fakes the hardware
    idleSeconds: 90,               // catalog / cart returns to the dashboard after this
    soldOutAfterVend: true,        // a dispensed product is marked sold out until restocked
    rotary: {
      port: '', baud: 9600, lineEnding: 'LF', moveTimeoutSec: 90,
      settleMs: 800,              // pause after the carousel stops, before a door opens
      homeOnConnect: true,        // send the home command every time the port connects
      homeCommand: 'HOME',        // NEMA34_TEST: HOME (or C1) runs homeMotor()
      bootWaitSec: 60,            // the Mega resets when the port opens and homes in setup(): wait for "System Ready."
      autoSpin: true,             // keep the carousel turning while the kiosk is idle
      firmware: 'v05',            // 'v05' = RotaryXL_v05 (GOTO <deg>, angles from Admin > Calibration) | 'legacy' = NEMA34_TEST v04 (C1-C12)
      columnAngles: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],   // degrees of C1..C12 at the door (Calibration page)
      spinRPM: 2,                 // v05: continuous idle spin speed
      spinSequence: '',           // legacy only: order of the idle indexing; empty = C1,C2,...,C12
      spinPauseMs: 0              // legacy only: pause on each column during the idle indexing
    },
    alfie: {
      port: '', baud: 115200, lineEnding: 'CR',
      frameTemplate: 't{ID}{DLC}{DATA}',   // SLCAN (Lawicel) frame
      initCommands: 'C\nS2\nO',            // SLCAN: close, 50 kbit/s, open (same as VendingPoC); one command per line
      openTimeoutSec: 5,                   // wait for "73 6F <pos>" (latch opened)
      closeTimeoutSec: 120                 // wait for "73 63 <pos>" (latch closed) before rotating again
    },
    alfies: defaultAlfies()
  },
  products: loadDemoProducts()
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

function loadStore() {
  try {
    const saved = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    const settings = deepMerge(DEFAULT_STORE.settings, saved.settings || {});
    delete settings.columns; // replaced by "alfies"
    return { settings, products: Array.isArray(saved.products) ? saved.products.map(cleanProduct) : [] };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

let store = loadStore();
function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE);
}
if (!fs.existsSync(STORE)) saveStore();

// ------------------------------------------------------------------ SSE
const clients = new Set();
function sse(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch { } }
}

// ------------------------------------------------------------------ COM port list
const IS_LINUX = process.platform === 'linux';
const PORT_RE = IS_LINUX ? /^\/dev\/(tty(USB|ACM|S)\d+|serial\/by-id\/[\w.:+-]+)$/ : /^COM\d+$/i;
const BRIDGE_LINUX = path.join(ROOT, 'serial-bridge-linux.js');

// Linux: /dev/serial/by-id/... names stay the same after a reboot or re-plug (ttyACM0/ttyUSB0 can swap),
// so they are offered first; plain ttyUSB/ttyACM devices without a by-id link are listed too.
function listLinuxPorts() {
  const out = [], seen = new Set();
  const byId = '/dev/serial/by-id';
  try {
    for (const n of fs.readdirSync(byId).sort()) {
      const link = path.join(byId, n);
      let real = ''; try { real = fs.realpathSync(link); } catch { continue; }
      seen.add(real);
      const label = n.replace(/^usb-/, '').replace(/-if\d+(-port\d+)?$/, '').replace(/_/g, ' ');
      out.push({ path: link, name: `${real.replace('/dev/', '')} – ${label}`, pnp: n });
    }
  } catch { }
  try {
    for (const n of fs.readdirSync('/dev').filter(x => /^tty(USB|ACM)\d+$/.test(x)).sort()) {
      const real = '/dev/' + n;
      if (!seen.has(real)) out.push({ path: real, name: `${n} – USB serial`, pnp: '' });
    }
  } catch { }
  return out;
}

function listComPorts() {
  return new Promise(resolve => {
    if (IS_LINUX) return resolve(listLinuxPorts());
    if (process.platform !== 'win32') return resolve([]);
    // PnP devices give friendly names ("Arduino Mega 2560 (COM5)"); GetPortNames adds virtual ports that have no PnP entry
    const ps = "$n = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | ForEach-Object { $_.Name + '|' + $_.PNPDeviceID }); " +
      "$n; [System.IO.Ports.SerialPort]::GetPortNames() | Where-Object { $p = $_; -not ($n | Where-Object { $_ -match \"\\($p\\)\" }) } | ForEach-Object { $_ + ' (' + $_ + ')|' }";
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 15000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      const ports = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const [name, pnp] = l.split('|');
        const m = name.match(/\((COM\d+)\)/);
        return { path: m ? m[1] : name, name, pnp: pnp || '' };
      }).sort((a, b) => parseInt(a.path.slice(3), 10) - parseInt(b.path.slice(3), 10));
      resolve(ports);
    });
  });
}

// ------------------------------------------------------------------ serial links (one bridge per role)
const ENDINGS = { NONE: '', LF: '\n', CR: '\r', CRLF: '\r\n' };
const links = {
  rotary: { proc: null, port: null, rx: '' },
  alfie: { proc: null, port: null, rx: '' }
};

// rotary machine state: offline -> connecting -> homing -> ready | error
// (spinning / stopping while idle-spinning; column = last column the carousel stopped at, 1 = HOME)
const rotaryState = { state: 'offline', message: 'Not connected', homing: false, column: 1, angle: null, encAngle: null };
function setRotary(state, message) {
  rotaryState.state = state; rotaryState.message = message;
  emitLine('rotary', `[${state}] ${message}`, 'sys');
  sse('status', linkStatus());
}

function linkStatus() {
  return {
    simulation: !!store.settings.simulation,
    rotary: { open: !!links.rotary.port || !!store.settings.simulation, port: links.rotary.port, state: rotaryState.state, message: rotaryState.message, column: rotaryState.column, spinWanted: spin.want, angle: rotaryState.angle, encAngle: rotaryState.encAngle, firmware: store.settings.rotary.firmware || 'v05' },
    alfie: { open: !!links.alfie.port || !!store.settings.simulation, port: links.alfie.port }
  };
}

const lineListeners = new Set();
function emitLine(role, text, dir) {
  sse('line', { role, dir, text, t: Date.now() });
  if (dir === 'rx' && role === 'rotary') {
    const m = text.match(/^POS\s+(-?[\d.]+)\s+(-?[\d.]+)/);   // v05 position report: commanded / encoder angle
    if (m) { rotaryState.angle = +m[1]; rotaryState.encAngle = +m[2]; }
  }
  if (dir === 'rx') for (const fn of [...lineListeners]) fn(role, text);
}

// resolves with the first received line of `role` matching `re`, or null after `ms`
function waitLine(role, re, ms) {
  return new Promise(resolve => {
    const fn = (r, text) => { if (r === role && re.test(text)) { done(text); } };
    const timer = setTimeout(() => done(null), ms);
    function done(v) { clearTimeout(timer); lineListeners.delete(fn); resolve(v); }
    lineListeners.add(fn);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Home the carousel: called every time the rotary port connects (and from Admin).
// 1. opening the port resets the Mega; its setup() homes and prints "System Ready." - wait for that
// 2. send the home command (HOME) and wait for "HOME COMPLETE" / "already at HOME"
// 3. ready: dispense commands are accepted from now on
async function homeRotary(reason) {
  if (rotaryState.homing) return;
  const cfg = store.settings.rotary;
  const sim = store.settings.simulation;
  rotaryState.homing = true;
  try {
    if (!sim && reason === 'connect') {
      setRotary('connecting', 'Waiting for the controller to start…');
      const first = await waitLine('rotary', /./, 5000);                 // nothing at all -> board without auto-reset
      if (first && !/System Ready|System NOT ready|HOME SENSOR ERROR/i.test(first)) {
        await waitLine('rotary', /System Ready|System NOT ready|HOME SENSOR ERROR/i, (cfg.bootWaitSec || 60) * 1000);
      }
      await sleep(300);
    }
    if (!sim && !links.rotary.proc) throw new Error('Rotary port is not open');
    setRotary('homing', 'Homing the carousel…');
    const result = waitLine('rotary', /HOME COMPLETE|already at HOME|HOME SENSOR NOT FOUND|NOT FOUND|ERROR/i, (cfg.moveTimeoutSec || 90) * 1000);
    writeLink('rotary', cfg.homeCommand || 'HOME');
    const line = await result;
    if (!line) throw new Error('No reply to the home command (timeout)');
    if (/NOT FOUND|ERROR/i.test(line)) throw new Error('Home sensor not found');
    await waitLine('rotary', /Command Complete/i, 3000);                    // let the firmware finish its reply
    rotaryState.column = 1;                                                 // home = column 1
    setRotary('ready', 'Ready');
    if (spin.want) spinLoop();                                              // idle spin starts as soon as it is homed
  } catch (e) {
    setRotary('error', e.message);
  } finally {
    rotaryState.homing = false;
  }
}

// ------------------------------------------------------------------ rotary moves, idle spin, go-to-column
// One rotary command at a time (spin steps, checkout moves and admin tests share the motor).
let rotaryQueue = Promise.resolve();
function rotaryJob(fn) { const run = rotaryQueue.then(fn, fn); rotaryQueue = run.catch(() => { }); return run; }

// Send one column command and wait until the firmware has finished it.
// NEMA34_TEST prints "Command Complete." after every command; before that it may print
// "Invalid Command", "aborted", "ERROR" or "stopped by Hall sensor" (a move that crossed HOME stops there).
async function runColumn(cmd) {
  const cfg = store.settings.rotary;
  const done = waitLine('rotary', /Command Complete|aborted|stopped by|ERROR|Invalid/i, (cfg.moveTimeoutSec || 90) * 1000);
  writeLink('rotary', cmd);
  const line = await done;
  if (!line) return { ok: false, error: `No reply to ${cmd} (timeout)` };
  if (!/Command Complete/i.test(line)) await waitLine('rotary', /Command Complete/i, 3000);   // swallow the rest of the reply
  if (/stopped by Hall/i.test(line)) { rotaryState.column = 1; return { ok: false, hall: true, line }; }
  if (!/Command Complete/i.test(line)) return { ok: false, error: line };
  const m = cmd.match(/^C(\d+)$/i);
  if (m) rotaryState.column = +m[1];
  return { ok: true };
}

const isV05 = () => store.settings.rotary.firmware !== 'legacy';
function columnAngle(col) {
  const a = (store.settings.rotary.columnAngles || [])[col - 1];
  return Number.isFinite(+a) ? Math.round(+a * 100) / 100 : (col - 1) * 30;
}
// which column is closest to an angle (after a stop)
function nearestColumn(angle) {
  let best = 1, bestD = 1e9;
  for (let c = 1; c <= 12; c++) {
    const d = Math.abs((((columnAngle(c) - angle) % 360) + 540) % 360 - 180);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
async function moveColumn(col) {
  if (!isV05()) return runColumn('C' + col);
  const r = await runColumn('GOTO ' + columnAngle(col));
  if (r.ok) rotaryState.column = col;
  return r;
}

const spinState = () => ['ready', 'spinning', 'stopping'].includes(rotaryState.state);
const spin = { want: true, running: false, idx: 0, idle: [] };
function spinSequence() {
  const seq = String(store.settings.rotary.spinSequence || '').split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(s => /^C([1-9]|1[0-2])$/.test(s));
  return seq.length >= 2 ? seq : Array.from({ length: 12 }, (_, i) => 'C' + (i + 1));
}

// Idle spin: keep indexing column after column until a stop is requested.
// A stop lets the current move finish, so the carousel always ends exactly on a column ("nearest location").
async function spinLoop() {
  if (spin.running || !spinState() || store.settings.rotary.autoSpin === false) return;
  spin.running = true;
  if (isV05()) {                                   // the firmware turns continuously by itself
    const r = await rotaryJob(() => runColumn('SPIN ' + (+store.settings.rotary.spinRPM || 2))).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) { spin.running = false; setRotary('error', 'Spin failed: ' + r.error); return; }
    if (!spin.want) { spin.running = false; return stopV05(); }   // stop was asked while SPIN was being sent
    setRotary('spinning', 'Spinning');
    return;
  }
  const seq = spinSequence();
  const here = seq.indexOf('C' + (rotaryState.column || 1));
  spin.idx = here >= 0 ? here + 1 : 0;
  setRotary('spinning', 'Spinning');
  try {
    while (spin.want && spinState()) {
      const cmd = seq[spin.idx % seq.length];
      const r = await rotaryJob(() => runColumn(cmd)).catch(e => ({ ok: false, error: e.message }));
      if (!r.ok && !r.hall) { setRotary('error', 'Spin stopped: ' + r.error); break; }
      if (r.ok) spin.idx++;                       // after a Hall stop (passed HOME) the same column is tried again from HOME
      sse('status', linkStatus());
      const pause = +store.settings.rotary.spinPauseMs || 0;
      if (spin.want && pause) await sleep(pause);
    }
  } finally {
    spin.running = false;
    if (rotaryState.state === 'spinning' || rotaryState.state === 'stopping') setRotary('ready', `Stopped at column ${rotaryState.column || 1}`);
    spin.idle.splice(0).forEach(fn => fn());
  }
}
function startSpin() { spin.want = true; spinLoop(); }

// v05: decelerate and stop exactly on the first column angle ahead (firmware STOPNEAR)
let stopping = null;
function stopV05() {
  if (stopping) return stopping;
  if (rotaryState.state === 'spinning') setRotary('stopping', 'Stopping at the nearest column…');
  const angles = Array.from({ length: 12 }, (_, i) => columnAngle(i + 1)).join(' ');
  stopping = rotaryJob(() => runColumn('STOPNEAR ' + angles)).catch(e => ({ ok: false, error: e.message })).then(r => {
    spin.running = false; stopping = null;
    if (!r.ok) { setRotary('error', 'Stop failed: ' + r.error); return; }
    rotaryState.column = rotaryState.angle == null ? rotaryState.column : nearestColumn(rotaryState.angle);
    setRotary('ready', `Stopped at column ${rotaryState.column}`);
  });
  return stopping;
}

// resolves once the carousel is standing still on a column
function stopSpin() {
  spin.want = false;
  if (isV05()) return spin.running ? stopV05() : (stopping || Promise.resolve());
  if (!spin.running) return Promise.resolve();
  if (rotaryState.state === 'spinning') setRotary('stopping', 'Stopping at the nearest column…');
  return new Promise(res => spin.idle.push(res));
}

// Checkout: stop the idle spin, then bring `col` to the door. A move that crosses HOME is stopped there by the
// firmware, so it is sent once more from HOME.
async function gotoColumn(col) {
  if (isV05() && spin.running && !stopping) { spin.want = false; spin.running = false; }   // firmware re-targets the spin
  else await stopSpin();
  if (!spinState()) throw new Error('Rotary is not ready (' + rotaryState.message + ')');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await rotaryJob(() => moveColumn(col));
    if (r.ok) { if (rotaryState.state !== 'ready') setRotary('ready', `At column ${col}`); else sse('status', linkStatus()); return; }
    if (!r.hall) throw new Error('Rotary: ' + r.error);
    emitLine('rotary', `[hall] passed HOME on the way to C${col}, sending it again`, 'sys');
  }
  throw new Error(`Rotary could not reach column ${col} (stopped at HOME twice)`);
}

function handleRx(role, chunk) {
  const l = links[role];
  l.rx += chunk;
  const parts = l.rx.split(/\r\n|\r|\n/);
  l.rx = parts.pop();
  for (const p of parts) if (p.trim()) emitLine(role, p, 'rx');
  if (l.rx.length > 4096) { emitLine(role, l.rx, 'rx'); l.rx = ''; }
}

function closeLink(role, reason) {
  const l = links[role];
  if (l.proc) { try { l.proc.stdin.write('Q\n'); } catch { } const p = l.proc; setTimeout(() => { try { p.kill(); } catch { } }, 800); }
  const was = l.port;
  l.proc = null; l.port = null; l.rx = '';
  if (was && role === 'rotary' && !store.settings.simulation) { rotaryState.state = 'offline'; rotaryState.message = 'Not connected'; }
  if (was) sse('status', linkStatus());
  if (was && reason) emitLine(role, `[closed: ${reason}]`, 'sys');
}

function openLink(role, portName, baud) {
  if (!PORT_RE.test(portName || '')) return Promise.reject(new Error('Pick a serial port first'));
  if (!IS_LINUX) portName = portName.toUpperCase();
  const realOf = n => { try { return IS_LINUX ? fs.realpathSync(n) : n; } catch { return n; } };
  for (const r of Object.keys(links)) if (r !== role && links[r].port && realOf(links[r].port) === realOf(portName)) return Promise.reject(new Error(`${portName} is already used for ${r}`));
  closeLink(role);
  return new Promise((resolve, reject) => {
    const b = String(parseInt(baud, 10) || 9600);
    const p = IS_LINUX
      ? spawn(process.execPath, [BRIDGE_LINUX, portName, b])
      : spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', BRIDGE_PS1, '-Port', portName, '-Baud', b], { windowsHide: true });
    let settled = false, buf = '';
    const timer = setTimeout(() => { if (!settled) { settled = true; try { p.kill(); } catch { } reject(new Error('Timed out opening ' + portName)); } }, 10000);
    p.stdout.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line === 'OPEN') {
          if (!settled) {
            settled = true; clearTimeout(timer);
            links[role].proc = p; links[role].port = portName;
            emitLine(role, `[opened ${portName} @ ${baud}]`, 'sys');
            sse('status', linkStatus());
            resolve();
          }
        } else if (line.startsWith('D ')) {
          if (links[role].proc === p) handleRx(role, Buffer.from(line.slice(2).replace(/-/g, ''), 'hex').toString('latin1'));
        } else if (line.startsWith('ERR ')) {
          const msg = line.slice(4);
          if (!settled) { settled = true; clearTimeout(timer); reject(new Error(/denied/i.test(msg) ? `${portName} is already open in another program` : msg)); }
          else if (links[role].proc === p) { closeLink(role, msg); }
        }
      }
    });
    p.stderr.on('data', d => console.error(`[bridge ${role}]`, String(d).trim()));
    p.on('exit', () => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Serial bridge exited')); }
      if (links[role].proc === p) closeLink(role, 'port lost');
    });
  });
}

function writeLink(role, text) {
  const s = store.settings;
  const cfg = s[role];
  const full = text + (ENDINGS[cfg.lineEnding] ?? '');
  emitLine(role, text, 'tx');
  if (s.simulation) { simulate(role, text); return; }
  const l = links[role];
  if (!l.proc) throw new Error(`${role === 'rotary' ? 'Rotary' : 'Alfie'} port is not open`);
  const hex = Buffer.from(full, 'latin1').toString('hex').match(/../g) || [];
  if (hex.length) l.proc.stdin.write('W ' + hex.join(' ') + '\n');
}

// ------------------------------------------------------------------ simulation (mimics NEMA34 firmware + Alfie)
function simSay(role, text, delay) { setTimeout(() => emitLine(role, text, 'rx'), delay); }

// simulated RotaryXL_v05: a position that moves at 5 rpm (30 deg/s) for GOTO/JOG and spins at SPIN rpm
const simR = { angle: 0, spin: null };
const norm360 = a => ((a % 360) + 360) % 360;
function simNow() {
  if (!simR.spin) return simR.angle;
  return norm360(simR.spin.from + simR.spin.rpm * 6 * (Date.now() - simR.spin.t0) / 1000);
}
function simV05(text) {
  const say = (lines, t) => lines.forEach((l, i) => simSay('rotary', l, t + i * 15));
  const pos = a => `POS ${a.toFixed(2)} ${a.toFixed(2)}`;
  const [cmd, ...rest] = text.trim().toUpperCase().split(/[\s,]+/);
  const nums = rest.map(Number).filter(Number.isFinite);
  const cur = simNow();
  const travel = d => Math.abs(d) / 30 * 1000 + 350;                       // 5 rpm = 30 deg/s
  const shortest = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
  if (cmd === 'GOTO' && nums.length) {
    const d = shortest(cur, nums[0]); simR.spin = null; simR.angle = norm360(nums[0]);
    return say(['Move Complete', pos(simR.angle), 'Command Complete.'], travel(d));
  }
  if (cmd === 'JOG' && nums.length) {
    if (simR.spin) return say(['ERROR: BUSY', 'Command Complete.'], 20);
    simR.angle = norm360(cur + nums[0]);
    return say(['Move Complete', pos(simR.angle), 'Command Complete.'], travel(nums[0]));
  }
  if (cmd === 'SPIN') {
    simR.spin = { t0: Date.now(), from: cur, rpm: nums[0] || 2 };
    return say(['SPINNING', pos(cur), 'Command Complete.'], 30);
  }
  if (cmd === 'STOPNEAR' && nums.length) {
    const ahead = simR.spin ? 3 : -180;                                     // need a few degrees to decelerate
    let best = null, bestD = 1e9;
    for (const a of nums) {
      let d = simR.spin ? norm360(a - cur) : shortest(cur, a);
      if (simR.spin && d < ahead) d += 360;
      if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = a; }
    }
    const rpm = simR.spin ? simR.spin.rpm : 5;
    simR.spin = null; simR.angle = norm360(best);
    return say(['Move Complete', pos(simR.angle), 'Command Complete.'], bestD / (rpm * 6) * 1000 * 1.3 + 300);
  }
  if (cmd === 'STOP') { simR.spin = null; simR.angle = cur; return say(['Stopped', pos(cur), 'Command Complete.'], 600); }
  if (cmd === 'POS?' || cmd === 'POS') return say([pos(cur), 'Command Complete.'], 20);
  if (cmd === 'SPEED') return say(['SPEED ' + (nums[0] || 5), 'Command Complete.'], 20);
  return say(['Invalid Command: ' + cmd, 'Command Complete.'], 20);
}

function simulate(role, text) {
  if (role === 'rotary') {
    if (/^(HOME|C1)$/i.test(text.trim()) && rotaryState.homing) {   // homing sequence (same text in v04 and v05)
      simR.angle = 0; simR.spin = null;
      simSay('rotary', 'HOMING', 200); simSay('rotary', 'Searching for HOME...', 400);
      simSay('rotary', 'Hall sensor detected.', 2600); simSay('rotary', 'HOME COMPLETE', 2700);
      simSay('rotary', 'POS 0.00 0.00', 2800); simSay('rotary', 'Command Complete.', 2900);
      return;
    }
    if (isV05()) return simV05(text);
    const cmds = text.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
    let t = 300;
    for (const c of cmds) {
      if (!/^C([1-9]|1[0-2])$/.test(c)) { simSay('rotary', 'Invalid Command: ' + c, t); simSay('rotary', 'Command sequence aborted.', t + 50); break; }
      simSay('rotary', 'Command: ' + c, t);
      t += 1800;
      simSay('rotary', 'Move Complete', t);
    }
    simSay('rotary', 'Command Complete.', t + 100);
    return;
  }
  // Alfie: decode the frame we just built ("t21F24F05" or any template containing the data hex)
  const hex = text.toUpperCase().replace(/[^0-9A-F]/g, '');
  const m = hex.match(/4F([0-9A-F]{2})$/);
  if (!m) return;
  const idm = text.toUpperCase().match(/^T?([0-9A-F]{3})/);
  const id = idm ? idm[1] : '00F';
  simSay('alfie', `t${id}3736F${m[1]}`, 400);    // 73 6F <pos> -> latch opened
  simSay('alfie', `t${id}37363${m[1]}`, 4500);   // 73 63 <pos> -> latch closed (customer shut the door)
}

// ------------------------------------------------------------------ http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

function publicState() {
  // the admin password is never sent to the browser
  const { adminPassword, ...settings } = store.settings;
  return { settings, products: store.products, status: linkStatus() };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, publicState());

    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      return send(res, 200, { ok: String(b.password || '') === String(store.settings.adminPassword) });
    }

    if (p === '/api/settings' && req.method === 'PUT') {
      const b = await readBody(req);
      const wasSim = store.settings.simulation;
      const keepPw = store.settings.adminPassword;
      store.settings = deepMerge(store.settings, b);
      store.settings.adminPassword = (b.newAdminPassword && /^\d{4,8}$/.test(b.newAdminPassword)) ? b.newAdminPassword : keepPw;
      delete store.settings.newAdminPassword;
      if (Array.isArray(b.alfies)) store.settings.alfies = b.alfies.slice(0, 3).map((a, i) => ({
        alfie: i + 1,
        name: String(a.name || `Door ${i + 1}`).slice(0, 30),
        groupId: Math.min(3, Math.max(0, parseInt(a.groupId, 10) || 0)),
        localAddress: Math.min(15, Math.max(0, parseInt(a.localAddress, 10) || 0))
      }));
      saveStore();
      if (!wasSim && store.settings.simulation) { closeLink('rotary', 'simulation on'); closeLink('alfie', 'simulation on'); homeRotary('connect'); }
      if (wasSim && !store.settings.simulation) { rotaryState.state = 'offline'; rotaryState.message = 'Not connected'; }
      if (store.settings.rotary.autoSpin === false) stopSpin(); else if (spin.want) spinLoop();
      sse('status', linkStatus());
      sse('state', publicState());
      return send(res, 200, publicState());
    }

    if (p === '/api/products' && req.method === 'PUT') {
      const b = await readBody(req);
      if (!Array.isArray(b.products)) return send(res, 400, { error: 'products must be a list' });
      store.products = b.products.map(cleanProduct);
      saveStore();
      sse('state', publicState());
      return send(res, 200, publicState());
    }

    if (p === '/api/ports' && req.method === 'GET') return send(res, 200, { ports: await listComPorts(), status: linkStatus() });

    // idle spin on/off (dashboard = on; Order now / admin = off, stops at the nearest column)
    if (p === '/api/rotary/spin' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.on) { startSpin(); return send(res, 200, { ok: true, status: linkStatus() }); }
      await stopSpin();
      return send(res, 200, { ok: true, column: rotaryState.column, status: linkStatus() });
    }
    // calibration: JOG / GOTO / POS? / SPEED / STOP, waits for "Command Complete." and returns the position
    if (p === '/api/rotary/cmd' && req.method === 'POST') {
      const b = await readBody(req);
      const text = String(b.text || '').trim().toUpperCase();
      if (!/^(JOG\s+-?\d+(\.\d+)?|GOTO\s+-?\d+(\.\d+)?|POS\??|SPEED\s+\d+(\.\d+)?|STOP)$/.test(text)) return send(res, 400, { error: 'Allowed: JOG <deg>, GOTO <deg>, POS?, SPEED <rpm>, STOP' });
      if (!isV05()) return send(res, 409, { error: 'Calibration needs the RotaryXL v05 firmware (Admin > Connection > Firmware)' });
      if (!spinState()) return send(res, 409, { error: 'Rotary is not ready (' + rotaryState.message + ')' });
      await stopSpin();
      const r = await rotaryJob(() => runColumn(text)).catch(e => ({ ok: false, error: e.message }));
      sse('status', linkStatus());
      if (!r.ok) return send(res, 409, { error: r.error });
      return send(res, 200, { ok: true, angle: rotaryState.angle, encAngle: rotaryState.encAngle });
    }

    // checkout: bring a column to the door (stops the spin first)
    if (p === '/api/rotary/goto' && req.method === 'POST') {
      const b = await readBody(req);
      const col = parseInt(b.column, 10);
      if (!(col >= 1 && col <= 12)) return send(res, 400, { error: 'column must be 1-12' });
      try { await gotoColumn(col); return send(res, 200, { ok: true, column: col }); }
      catch (e) { return send(res, 409, { error: e.message }); }
    }

    const sm = p.match(/^\/api\/serial\/(rotary|alfie)\/(open|close|write|home)$/);
    if (sm && req.method === 'POST') {
      const [, role, action] = sm;
      const b = await readBody(req);
      if (action === 'open') {
        if (store.settings.simulation) return send(res, 409, { error: 'Turn off simulation mode to use real COM ports' });
        try {
          store.settings[role].port = b.port || store.settings[role].port;
          if (b.baud) store.settings[role].baud = parseInt(b.baud, 10);
          if (b.lineEnding) store.settings[role].lineEnding = b.lineEnding;
          saveStore();
          await openLink(role, store.settings[role].port, store.settings[role].baud);
          if (role === 'rotary' && store.settings.rotary.homeOnConnect !== false) homeRotary('connect');
          else if (role === 'rotary') setRotary('ready', 'Ready (not homed)');
          if (role === 'alfie') {
            for (const cmd of String(store.settings.alfie.initCommands || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) writeLink('alfie', cmd);
          }
          return send(res, 200, { ok: true, status: linkStatus() });
        } catch (e) { return send(res, 500, { error: e.message }); }
      }
      if (action === 'home') { await stopSpin(); homeRotary('admin'); return send(res, 200, { ok: true }); }
      if (action === 'close') { closeLink(role, 'closed by admin'); return send(res, 200, { ok: true, status: linkStatus() }); }
      if (action === 'write') {
        try { if (role === 'rotary') await stopSpin(); writeLink(role, String(b.text || '')); return send(res, 200, { ok: true }); }
        catch (e) { return send(res, 409, { error: e.message }); }
      }
    }

    if (p === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: status\ndata: ${JSON.stringify(linkStatus())}\n\n`);
      clients.add(res);
      const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch { } }, 15000);
      req.on('close', () => { clearInterval(ka); clients.delete(res); });
      return;
    }

    // static files
    let file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// reopen the saved ports on start-up (real hardware mode)
async function autoOpen() {
  if (store.settings.simulation) { homeRotary('connect'); return; }
  for (const role of ['rotary', 'alfie']) {
    const cfg = store.settings[role];
    if (!cfg.port) continue;
    try {
      await openLink(role, cfg.port, cfg.baud);
      if (role === 'rotary' && cfg.homeOnConnect !== false) homeRotary('connect');
      if (role === 'alfie') for (const cmd of String(cfg.initCommands || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) writeLink('alfie', cmd);
    } catch (e) { console.error(`Could not open ${role} port ${cfg.port}: ${e.message}`); }
  }
}

process.on('exit', () => { closeLink('rotary'); closeLink('alfie'); });
process.on('SIGINT', () => process.exit(0));

server.listen(PORT, () => {
  console.log(`Rotary Kiosk running at http://localhost:${PORT}`);
  autoOpen();
});
