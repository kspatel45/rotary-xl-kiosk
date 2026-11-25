/* Rotary XL Kiosk - front end */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 2000000];
const ENDINGS = [['NONE', 'No line ending'], ['LF', 'Newline (LF \\n)'], ['CR', 'Carriage return (CR \\r)'], ['CRLF', 'Both NL & CR (\\r\\n)']];
const PALETTE = [['#243037', '#3a4a54'], ['#e32d49', '#b81c36'], ['#5d6f78', '#3a4a54'], ['#8a9aa1', '#5d6f78'], ['#3a4a54', '#e32d49']];  // Signifi slate / red

let state = { settings: null, products: [], status: {} };
let cart = new Set();          // product ids (each product is one compartment)
let vending = false;

// ================================================================ API
async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

const money = v => (state.settings?.currency ?? '$') + Number(v || 0).toFixed(2);
const available = () => state.products.filter(p => p.available);

// ================================================================ views
function show(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.body.dataset.view = name;
  if (name === 'dashboard') {
    dashRotary.build(state.products);
    dashRotary.mode = '';
    requestAnimationFrame(() => { dashRotary.layout(); syncDashRotary(); });
    $('#stat-products').textContent = available().length;
    setSpin(true);                       // idle: the real carousel keeps spinning
  } else { dashRotary.stop(); dashRotary.mode = ''; }
  if (name === 'admin') setSpin(false);  // admin tests need the motor
  if (name !== 'vend') vendRotary.stop();
  if (name === 'catalog') { $('#search').value = ''; catFilter = ''; renderChips(); renderCatalog(); renderCart(); }
  if (name === 'admin') renderAdmin();
  renderMachine();
  bumpIdle();
}

// ================================================================ thumbnails
function thumbHTML(p) {
  const [a, b] = PALETTE[Math.abs(hash(p.name || '')) % PALETTE.length];
  const initial = esc((p.name || '?').trim().charAt(0).toUpperCase());
  const img = p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
  return `<div class="thumb" style="background:linear-gradient(135deg, ${a}, ${b})"><span class="initial">${initial}</span>${img}</div>`;
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

function tickClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '  ·  ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ================================================================ Rotary XL 3D carousel
// 12 columns (faces of a cylinder) x 10 shelves. Face i sits at rotateY(i*30deg); the drum is turned by
// -angle, so the face whose i*30 equals the angle is in front (= at the door).
const COLS = 12, SHELVES = 10, STEP = 360 / COLS;
const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class Rotary {
  constructor(scene) {
    this.scene = scene;
    this.wrap = scene.parentElement;
    this.drum = document.createElement('div');
    this.drum.className = 'rotary-drum';
    scene.appendChild(this.drum);
    this.angle = 0; this.r = 200; this.timer = null; this.anim = null; this.faces = [];
  }
  build(products) {
    let html = '';
    for (let c = 1; c <= COLS; c++) {
      const bySlot = new Map();
      for (const p of products.filter(p => +p.column === c)) if (!bySlot.has(+p.slot || 1)) bySlot.set(+p.slot || 1, p);
      let cells = '';
      for (let s = 1; s <= SHELVES; s++) {
        const p = bySlot.get(s);
        cells += p
          ? `<div class="r-cell ${p.available ? '' : 'sold'}" data-slot="${s}" data-id="${esc(p.id)}">${thumbHTML(p)}<div class="rc-txt"><span class="rc-name">${esc(p.name)}</span><span class="rc-price">${money(p.price)}</span></div></div>`
          : `<div class="r-cell r-empty" data-slot="${s}">${s}</div>`;
      }
      html += `<div class="r-face" data-col="${c}"><div class="r-head">C${c}</div>${cells}</div>`;
    }
    this.drum.innerHTML = html;
    this.faces = $$('.r-face', this.drum);
    this.layout();
  }
  layout() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w || !h) return;
    const H = Math.max(260, Math.min(h - 50, 1150));
    const faceW = Math.max(70, Math.min(w / 3.95, H * 0.34));
    this.r = faceW / 2 / Math.tan(Math.PI / COLS) - 1;
    Object.assign(this.scene.style, { width: faceW + 'px', height: H + 'px' });
    this.faces.forEach((f, i) => { f.style.transform = `rotateY(${i * STEP}deg) translateZ(${this.r}px)`; });
    const door = this.wrap.querySelector('.door-frame');
    if (door) Object.assign(door.style, { left: (this.scene.offsetLeft - 7) + 'px', top: (this.scene.offsetTop - 7) + 'px', width: (faceW + 14) + 'px', height: (H + 14) + 'px' });
    this.render();
  }
  render() {
    this.drum.style.transform = `translateZ(${-this.r}px) rotateX(-4deg) rotateY(${-this.angle}deg)`;
    const front = ((Math.round(this.angle / STEP) % COLS) + COLS) % COLS;
    this.faces.forEach((f, i) => f.classList.toggle('front', i === front));
  }
  // animate to an absolute angle
  turnTo(target, ms) {
    cancelAnimationFrame(this.anim);
    const from = this.angle, t0 = performance.now();
    return new Promise(resolve => {
      const tick = now => {
        const k = Math.min(1, (now - t0) / ms);
        this.angle = from + (target - from) * easeInOut(k);
        this.render();
        if (k < 1) this.anim = requestAnimationFrame(tick); else resolve();
      };
      this.anim = requestAnimationFrame(tick);
    });
  }
  // bring column `col` to the front (door) the shortest way round
  goTo(col) {
    this.stop();
    const want = (col - 1) * STEP;
    const d = ((want - this.angle) % 360 + 540) % 360 - 180;
    return this.turnTo(this.angle + d, Math.max(900, Math.abs(d) / STEP * 450));
  }
  // dashboard idle: turn continuously (degrees per second), like the carousel spinning
  spinForever(speed = 16) {
    this.stop();
    let last = performance.now();
    const tick = now => { this.angle += speed * Math.min(100, now - last) / 1000; last = now; this.render(); this.anim = requestAnimationFrame(tick); };
    this.anim = requestAnimationFrame(tick);
  }
  stop() { clearTimeout(this.timer); this.timer = null; cancelAnimationFrame(this.anim); }
  highlight(col, slot) {
    $$('.r-cell.target', this.drum).forEach(c => c.classList.remove('target'));
    if (col) $(`.r-face[data-col="${col}"] .r-cell[data-slot="${slot}"]`, this.drum)?.classList.add('target');
  }
}
let dashRotary, vendRotary;

// ================================================================ machine status (homing / ready)
const ORDERABLE = ['ready', 'spinning', 'stopping'];
function machineReady() { return ORDERABLE.includes(state.status?.rotary?.state); }

// idle spin of the real carousel (server side); off = stop at the nearest column
function setSpin(on, force) {
  if (setSpin.last === on && !force) return;
  setSpin.last = on;
  api('/api/rotary/spin', 'POST', { on }).catch(() => { setSpin.last = undefined; });
}

// dashboard picture follows the machine: spinning (or not connected yet) = turning, stopped = standing at its column
function syncDashRotary() {
  if (document.body.dataset.view !== 'dashboard') return;
  const r = state.status?.rotary || {};
  const turning = true;                  // the home page always shows the carousel turning
  const want = turning ? 'spin' : 'at' + (r.column || 1);
  if (dashRotary.mode === want) return;
  dashRotary.mode = want;
  if (turning) dashRotary.spinForever(); else dashRotary.goTo(r.column || 1);
}
function renderMachine() {
  const r = state.status?.rotary || {};
  const st = r.state || 'offline';
  const pill = $('#machine-pill');
  const ok = ORDERABLE.includes(st);
  pill.className = 'machine-pill ' + (ok ? 'ready' : st === 'error' ? 'error' : st === 'offline' ? '' : 'busy');
  pill.title = r.message || '';
  $('#machine-text').textContent = ok ? (state.status.simulation ? 'Ready · demo mode' : 'Ready')
    : st === 'homing' ? 'Homing…' : st === 'connecting' ? 'Starting…' : st === 'error' ? 'Out of service' : 'Offline';
  const b = $('#btn-order');
  b.disabled = !ok;
  b.firstChild.textContent = ok ? 'Order now ' : (st === 'homing' || st === 'connecting') ? 'Please wait ' : 'Unavailable ';
  syncDashRotary();
  if (document.body.dataset.view === 'dashboard' && !vending && st === 'ready' && !r.spinWanted
      && Date.now() - (renderMachine.kick || 0) > 3000) { renderMachine.kick = Date.now(); setSpin(true, true); }
  const tag = $('#rotary-state');
  if (tag) { tag.className = 'state-tag ' + st; tag.textContent = st === 'error' ? 'Error: ' + (r.message || '') : st; }
}

// ================================================================ numpad
let pin = '';
function buildNumpad() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
  $('#np-keys').innerHTML = keys.map(k => `<button data-k="${k}" class="${/\d/.test(k) ? '' : 'np-fn'}">${k}</button>`).join('') + `<button data-k="E" class="np-enter">Enter</button>`;
  $('#np-keys').addEventListener('click', e => { const b = e.target.closest('button'); if (b) npKey(b.dataset.k); });
  $$('[data-np-close]').forEach(b => b.addEventListener('click', closeNumpad));
  $('#numpad-modal').addEventListener('click', e => { if (e.target.id === 'numpad-modal') closeNumpad(); });
  document.addEventListener('keydown', e => {
    if (!$('#numpad-modal').classList.contains('open')) return;
    if (/^\d$/.test(e.key)) npKey(e.key);
    else if (e.key === 'Backspace') npKey('⌫');
    else if (e.key === 'Enter') npKey('E');
    else if (e.key === 'Escape') closeNumpad();
  });
}
function renderDots(err) {
  const n = Math.max(5, pin.length);
  $('#np-dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('');
  $('#np-dots').classList.toggle('err', !!err);
}
function openNumpad() { pin = ''; renderDots(); $('#numpad-modal').classList.add('open'); }
function closeNumpad() { $('#numpad-modal').classList.remove('open'); pin = ''; }
async function npKey(k) {
  bumpIdle();
  if (k === 'C') pin = '';
  else if (k === '⌫') pin = pin.slice(0, -1);
  else if (k === 'E') {
    const r = await api('/api/login', 'POST', { password: pin }).catch(() => ({ ok: false }));
    if (r.ok) { closeNumpad(); show('admin'); return; }
    renderDots(true);
    const np = $('.numpad'); np.classList.remove('shake'); void np.offsetWidth; np.classList.add('shake');
    setTimeout(() => { pin = ''; renderDots(); }, 600);
    return;
  } else if (pin.length < 8) pin += k;
  renderDots();
}

// ================================================================ catalog + cart
let catFilter = '';   // selected category chip ('' = all)
function renderChips() {
  const cats = [...new Set(state.products.filter(p => p.available && p.category).map(p => p.category))];
  $('#cat-chips').classList.toggle('hidden', cats.length < 2);
  $('#cat-chips').innerHTML = [['', 'All']].concat(cats.map(c => [c, c]))
    .map(([v, t]) => `<button data-cat="${esc(v)}" class="${v === catFilter ? 'on' : ''}">${esc(t)}</button>`).join('');
}
function renderCatalog() {
  const q = $('#search').value.trim().toLowerCase();
  const list = state.products.filter(p => p.available && (!catFilter || p.category === catFilter) && (!q || p.name.toLowerCase().includes(q)));
  const grid = $('#product-grid');
  if (!list.length) { grid.innerHTML = `<div class="empty">${q ? 'No products match your search.' : 'No products available right now.'}</div>`; return; }
  grid.innerHTML = list.map((p, i) => {
    const on = cart.has(p.id);
    return `<div class="p-card ${on ? 'in-cart' : ''}" data-id="${esc(p.id)}" style="animation-delay:${Math.min(i, 12) * 40}ms">
      ${thumbHTML(p)}
      <h4>${esc(p.name)}</h4>
      <div class="loc-line">Column ${p.column} · Shelf ${p.slot || 1}</div>
      <div class="price">${money(p.price)}</div>
      <button class="add ${on ? 'on' : ''}" data-toggle="${esc(p.id)}">${on ? '✓ In cart' : '+ Add to cart'}</button>
    </div>`;
  }).join('');
}

function renderCart() {
  const items = [...cart].map(id => state.products.find(p => p.id === id)).filter(Boolean);
  // drop items that were removed/sold out by admin
  cart = new Set(items.filter(p => p.available).map(p => p.id));
  const live = items.filter(p => cart.has(p.id));
  const total = live.reduce((s, p) => s + Number(p.price || 0), 0);
  $('#cart-items').innerHTML = live.length
    ? live.map(p => `<div class="c-item">${thumbHTML(p)}<div class="ci-name"><div>${esc(p.name)}</div><small>${money(p.price)}</small></div><button data-remove="${esc(p.id)}" aria-label="Remove">✕</button></div>`).join('')
    : `<div class="cart-empty">Your cart is empty.<br>Tap <b>+ Add to cart</b> on a product.</div>`;
  const c = $('#cart-count');
  if (c.textContent !== String(live.length)) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  c.textContent = live.length;
  $('#cart-total').textContent = money(total);
  $('#btn-checkout').disabled = !live.length;
  $('#cart-bar-text').textContent = `View cart · ${live.length} item${live.length === 1 ? '' : 's'}`;
  $('#cart-bar-total').textContent = money(total);
}

function toggleCart(id) {
  if (cart.has(id)) cart.delete(id); else cart.add(id);
  renderCatalog(); renderCart();
}

// ================================================================ idle timer
let idleTimer = null;
function bumpIdle() {
  clearTimeout(idleTimer);
  const view = document.body.dataset.view;
  const secs = state.settings?.idleSeconds || 90;
  if (view === 'catalog') idleTimer = setTimeout(() => { cart.clear(); $('#cart').classList.remove('open'); show('dashboard'); }, secs * 1000);
  if (view === 'admin') idleTimer = setTimeout(() => show('dashboard'), Math.max(secs * 4, 300) * 1000);
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, bumpIdle, { passive: true }));

// ================================================================ serial lines (SSE)
const waiters = [];
function waitFor(role, test, ms) {
  return new Promise(resolve => {
    const w = { role, test, resolve };
    w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); resolve(null); }, ms);
    waiters.push(w);
  });
}
function onLine(msg) {
  logLine(msg);
  if (msg.dir !== 'rx') return;
  for (const w of waiters.slice()) {
    if (w.role === msg.role && w.test(msg.text)) {
      clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.resolve(msg.text);
    }
  }
}
function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('line', e => onLine(JSON.parse(e.data)));
  es.addEventListener('status', e => { state.status = JSON.parse(e.data); renderStatus(); renderMachine(); if (document.body.dataset.view === 'admin') renderCalPos(); });
  es.addEventListener('state', e => {
    const s = JSON.parse(e.data);
    state.settings = s.settings; state.products = s.products; state.status = s.status;
    if (document.body.dataset.view === 'dashboard') { dashRotary.build(state.products); $('#stat-products').textContent = available().length; }
    renderMachine();
  });
  es.onerror = () => { /* EventSource reconnects by itself */ };
}

const LOG_MAX = 600;
function logLine(m) {
  const log = $('#log');
  const t = new Date(m.t || Date.now()).toLocaleTimeString();
  const arrow = m.dir === 'tx' ? '→' : m.dir === 'rx' ? '←' : '·';
  const div = document.createElement('div');
  div.className = m.dir;
  div.textContent = `${t}  ${m.role.padEnd(6)} ${arrow} ${m.text}`;
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  log.appendChild(div);
  while (log.childNodes.length > LOG_MAX) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// ================================================================ protocol helpers
const hex2 = n => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');

// Alfie n (1-3) = one door of the rotary locker
function alfieCfg(n) {
  return (state.settings.alfies || []).find(a => +a.alfie === +n) || { alfie: n, name: `Door ${n}`, groupId: 0, localAddress: n };
}
const alfieName = n => alfieCfg(n).name || `Door ${n}`;
function canId(n) {
  const c = alfieCfg(n);
  const id = ((c.groupId & 3) << 9) | ((c.localAddress & 15) << 4) | 0xF;
  return id.toString(16).toUpperCase().padStart(3, '0');
}
function buildFrame(n, bytes, template) {
  const t = template ?? state.settings.alfie.frameTemplate;
  return t.replace(/\{ID\}/g, canId(n)).replace(/\{DLC\}/g, String(bytes.length))
    .replace(/\{DATA_SP\}/g, bytes.map(hex2).join(' ')).replace(/\{DATA\}/g, bytes.map(hex2).join(''));
}
// true when an adapter line carries report <code> (e.g. "736F") for latch <pos> from Alfie n
function isReport(line, n, code, pos) {
  const h = line.toUpperCase().replace(/[^0-9A-F]/g, '');
  return h.includes(canId(n)) && h.includes(code + hex2(pos));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function send(role, text) { return api(`/api/serial/${role}/write`, 'POST', { text }); }

async function rotateTo(col, home) {
  await api('/api/rotary/goto', 'POST', { column: col, home: !!home });   // stops the idle spin first, re-sends once if it stopped at HOME
  // "Command Complete." is printed after the stepper reached its target; give the carousel a moment to settle
  await sleep(state.settings.rotary.settleMs ?? 800);
}

// wait until the rotary state passes a test (SSE keeps state.status up to date)
async function waitMachine(test, ms) {
  const end = Date.now() + ms;
  await sleep(300);
  while (Date.now() < end && !test(state.status?.rotary?.state)) await sleep(200);
}

async function openLatch(n, pos) {
  const a = state.settings.alfie;
  const opened = waitFor('alfie', l => isReport(l, n, '736F', pos) || isReport(l, n, '7733', pos), (a.openTimeoutSec || 5) * 1000);
  await send('alfie', buildFrame(n, [0x4F, pos]));
  const line = await opened;
  if (line && isReport(line, n, '7733', pos)) throw new Error(`${alfieName(n)} latch ${pos} short-circuit`);
  return !!line; // false = no confirmation received
}

function waitClosed(n, pos) {
  return waitFor('alfie', l => isReport(l, n, '7363', pos), (state.settings.alfie.closeTimeoutSec || 120) * 1000);
}

// ================================================================ checkout / vending
async function checkout() {
  if (vending) return;
  const items = [...cart].map(id => state.products.find(p => p.id === id)).filter(p => p && p.available);
  if (!items.length) return;
  const st = state.status;
  if (!st.simulation && (!st.rotary?.open || !st.alfie?.open)) { toast('Machine is offline. Please ask staff for help.', true); return; }
  if (!machineReady()) { toast(st.rotary?.state === 'homing' ? 'The machine is homing, please try again in a moment.' : 'Machine is not ready. Please ask staff for help.', true); return; }

  vending = true;
  $('#cart').classList.remove('open');
  show('vend');
  vendRotary.build(state.products);
  setSpin.last = false;                  // the server stops the idle spin itself before the first move
  vendRotary.angle = ((state.status?.rotary?.column || 1) - 1) * STEP;   // start where the real carousel stands
  requestAnimationFrame(() => vendRotary.layout());
  const door = $('#door-frame');
  door.classList.remove('open'); door.firstElementChild.textContent = 'DOOR';

  // group by column (one rotation per column)
  const byCol = new Map();
  for (const p of items.sort((a, b) => a.column - b.column || a.alfie - b.alfie || a.compartment - b.compartment)) {
    if (!byCol.has(p.column)) byCol.set(p.column, []);
    byCol.get(p.column).push(p);
  }

  // step list
  const steps = [];
  const homeFirst = state.settings.rotary.homeBeforeDispense !== false;
  if (homeFirst) steps.push({ kind: 'home', label: 'Homing the carousel' });
  for (const [col, list] of byCol) {
    steps.push({ kind: 'rotate', col, label: `Rotating to column ${col}` });
    steps[steps.length - 1].label = `Turning column ${col} to the door`;
    for (const p of list) steps.push({ kind: 'door', col, p, label: `${alfieName(p.alfie)} · latch ${p.compartment} · ${p.name}` });
  }
  const ol = $('#vend-steps');
  ol.innerHTML = steps.map((s, i) => `<li data-i="${i}"><span class="ic"></span><span>${esc(s.label)}</span><small></small></li>`).join('');
  const li = i => ol.children[i];
  const mark = (i, cls, note) => { const el = li(i); el.className = cls; if (cls === 'ok') el.querySelector('.ic').textContent = '✓'; if (cls === 'bad') el.querySelector('.ic').textContent = '!'; if (note !== undefined) el.querySelector('small').textContent = note; el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };

  const status = $('#vend-status');
  const setStatus = (cls, html) => { status.className = 'vend-status ' + (cls || ''); status.innerHTML = html; };
  const setText = (title, sub) => { $('#vend-title').textContent = title; $('#vend-sub').textContent = sub; };
  $('#btn-vend-done').classList.add('hidden');
  setStatus('', '<span class="spinner"></span>');

  const vended = [];
  let error = null;
  try {
    let i = 0;
    let home = homeFirst;
    for (const [col, list] of byCol) {
      // 1. dispense command: turn the column to the door and wait until the carousel has stopped
      setStatus('', '<span class="spinner"></span>');
      setText('Getting your order…', `Bringing column ${col} to the door`);
      door.classList.remove('open'); door.firstElementChild.textContent = 'DOOR';
      vendRotary.highlight(col, list[0].slot);
      if (home) {                                                // 0. home first, then the column (one request)
        setText('Getting your order…', 'Homing the carousel');
        mark(i, 'active');
        const move = rotateTo(col, true);
        await vendRotary.goTo(1);
        await waitMachine(s => s !== 'homing', 120000);
        mark(i, 'ok', 'home'); i++;
        setText('Getting your order…', `Bringing column ${col} to the door`);
        mark(i, 'active');
        await Promise.all([move, vendRotary.goTo(col)]);
        home = false;
      } else {
        mark(i, 'active');
        await Promise.all([rotateTo(col), vendRotary.goTo(col)]);
      }
      mark(i, 'ok', 'stopped'); i++;

      // 2. carousel stopped at the door: pop the door open on the product's Alfie
      const closes = [];
      for (const p of list) {
        mark(i, 'active');
        vendRotary.highlight(col, p.slot);
        setText(`Opening ${alfieName(p.alfie)}`, p.name);
        const closed = waitClosed(p.alfie, p.compartment);       // listen before opening
        const confirmed = await openLatch(p.alfie, p.compartment);
        mark(i, 'ok', confirmed ? 'open' : 'sent');
        vended.push(p);
        closes.push({ p, closed, idx: i });
        i++;
      }

      // 3. door open: wait for the door-closed report
      door.classList.add('open'); door.firstElementChild.textContent = 'OPEN';
      setStatus('door', '↑');
      const doors = [...new Set(list.map(p => alfieName(p.alfie)))];
      setText(doors.length > 1 ? `${doors.join(' & ')} are open` : `${doors[0]} is open`, 'Take your item and close the door');
      for (const c of closes) {
        const line = await c.closed;
        mark(c.idx, 'ok', line ? 'collected' : 'closed?');
      }
      door.classList.remove('open'); door.firstElementChild.textContent = 'CLOSED';
    }
  } catch (e) {
    error = e;
    const active = ol.querySelector('li.active');
    if (active) mark(+active.dataset.i, 'bad', 'failed');
    console.error(e);
  }

  // mark vended products sold out
  if (vended.length && state.settings.soldOutAfterVend !== false) {
    const ids = new Set(vended.map(p => p.id));
    const products = state.products.map(p => ids.has(p.id) ? { ...p, available: false } : p);
    try { const s = await api('/api/products', 'PUT', { products }); state.products = s.products; } catch { }
  }
  cart.clear();

  vendRotary.highlight(null);
  vending = false;
  clearTimeout(checkout._back);
  if (error) {
    setStatus('err', '!');
    setText('Sorry, something went wrong', vended.length ? 'Some items were dispensed. Please contact staff for the rest.' : 'Please contact staff for help.');
    $('#btn-vend-done').classList.remove('hidden');
    checkout._back = setTimeout(() => { if (document.body.dataset.view === 'vend') show('dashboard'); }, 30000);
  } else {
    // door closed -> back to the home page (short thank-you first)
    setStatus('done', '✓');
    setText('Thank you!', 'Door closed. Enjoy your purchase.');
    dashRotary.angle = vendRotary.angle;
    checkout._back = setTimeout(() => { if (document.body.dataset.view === 'vend') show('dashboard'); }, 2500);
  }
}

// ================================================================ admin
function opts(list, sel) { return list.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`).join(''); }
const colOpts = sel => opts(Array.from({ length: 12 }, (_, i) => [i + 1, `Column ${i + 1}`]), sel);
const compOpts = sel => opts(Array.from({ length: 17 }, (_, i) => [i + 1, `Latch ${i + 1}`]), sel);
const alfieOpts = sel => opts([1, 2, 3].map(n => [n, `Alfie ${n} · ${alfieName(n)}`]), sel);
const slotOpts = sel => opts(Array.from({ length: 10 }, (_, i) => [i + 1, `Shelf ${i + 1}${i === 0 ? ' (top)' : i === 9 ? ' (bottom)' : ''}`]), sel);
function freeSlot(col) { const used = new Set(state.products.filter(p => +p.column === +col).map(p => +p.slot || 1)); for (let s = 1; s <= 10; s++) if (!used.has(s)) return s; return 1; }
const locKey = p => `${p.column}-${p.alfie || 1}-${p.compartment}`;

// ================================================================ rotary calibration (Admin > Calibration)
let calStep = 1;
let calAngles = null;          // working copy of the 12 column angles (saved with "Save calibration")
let calSaved = '';
const fmtDeg = a => (a == null || !Number.isFinite(+a)) ? '–' : (+a).toFixed(2);

function renderCalibration() {
  const s = state.settings.rotary;
  if (!calAngles) { calAngles = (s.columnAngles || []).slice(0, 12).map(Number); while (calAngles.length < 12) calAngles.push(calAngles.length * 30); calSaved = JSON.stringify(calAngles); }
  $('#cal-rows').innerHTML = calAngles.map((a, i) => `<tr data-col="${i + 1}">
      <td><b>C${i + 1}</b></td>
      <td><input type="number" step="0.1" min="0" max="360" value="${(+a).toFixed(2)}" data-cal-angle="${i}"></td>
      <td class="actions"><button class="btn-secondary" data-cal-go="${i}">Go</button><button class="btn-primary" data-cal-set="${i}">Set</button></td>
    </tr>`).join('');
  renderCalPos();
  calDirty();
  renderMotion();
}
function renderMotion() {
  const r = state.settings.rotary;
  $('#mo-move').value = r.moveRPM ?? 5;
  $('#mo-run').value = r.spinRPM ?? 2;
  $('#mo-up').value = r.rampUpSec ?? 3;
  $('#mo-down').value = r.rampDownSec ?? 3;
  $('#mo-dir').value = String(+r.cwDir === -1 ? -1 : 1);
  motionInfo();
}
// show what the values mean: degrees per second and how far the ramps take
function motionInfo() {
  const mv = +$('#mo-move').value || 5, up = +$('#mo-up').value || 3, dn = +$('#mo-down').value || 3;
  const dps = mv * 6;
  $('#mo-info').textContent = `Move: ${dps.toFixed(0)}°/s. Ramp up takes ${(dps * up / 2).toFixed(0)}° and ramp down ${(dps * dn / 2).toFixed(0)}° at full speed; one column (30°) ≈ ${(30 / dps + (up + dn) / 2).toFixed(1)} s.`;
}
function renderCalPos() {
  const r = state.status?.rotary || {};
  if (!$('#cal-angle')) return;
  $('#cal-angle').textContent = fmtDeg(r.angle);
  $('#cal-enc').textContent = fmtDeg(r.encAngle);
  $('#cal-near').textContent = r.angle == null || !calAngles ? '–' : 'C' + nearestCal(r.angle);
  const st = $('#cal-state'); st.className = 'state-tag ' + (r.state || ''); st.textContent = r.state || 'offline';
  const w = $('#cal-warn');
  const msg = state.settings.rotary.firmware === 'legacy' ? 'Firmware is set to NEMA34_TEST v04: flash RotaryXL_v06 and choose it in Admin > Connection > Firmware to calibrate.'
    : !ORDERABLE.includes(r.state) ? `Rotary is ${r.state || 'offline'} (${r.message || ''}). Connect it and wait for homing to finish.` : '';
  w.textContent = msg; w.classList.toggle('hidden', !msg);
  $$('[data-cal-row-at]').forEach(e => e.removeAttribute('data-cal-row-at'));
  if (r.angle != null && calAngles) $$('#cal-rows tr').forEach(tr => tr.classList.toggle('here', Math.abs(((calAngles[tr.dataset.col - 1] - r.angle) % 360 + 540) % 360 - 180) < 0.05));
}
function nearestCal(angle) {
  let best = 1, bd = 1e9;
  calAngles.forEach((a, i) => { const d = Math.abs(((a - angle) % 360 + 540) % 360 - 180); if (d < bd) { bd = d; best = i + 1; } });
  return best;
}
function calDirty() {
  const dirty = JSON.stringify(calAngles) !== calSaved;
  $('#cal-dirty').textContent = dirty ? 'Unsaved changes' : 'Saved';
  $('#cal-dirty').style.color = dirty ? 'var(--red)' : '';
}
let calBusy = false;
async function calCmd(text) {
  if (calBusy) return false;
  calBusy = true;
  try { await api('/api/rotary/cmd', 'POST', { text }); return true; }
  catch (e) { toast(e.message, true); return false; }
  finally { calBusy = false; renderCalPos(); }
}
// hold-to-repeat jog: one JOG per completed move while the button is held
function calJogButton(btn, sign) {
  let held = false;
  const go = async () => { while (held) { const ok = await calCmd(`JOG ${(sign * calStep).toFixed(2)}`); if (!ok) break; } };
  const down = e => { e.preventDefault(); if (held) return; held = true; go(); setTimeout(() => { if (!btn.matches(':active')) held = false; }, 250); };
  const up = () => { held = false; };
  btn.addEventListener('pointerdown', down);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, up));
}

function renderAdmin() {
  renderProductRows();
  renderConnection();
  renderColumns();
  renderTest();
  calAngles = null; renderCalibration();
  renderStatus();
}

function dupLocations() {
  const seen = new Map(), dup = new Set();
  for (const p of state.products) {
    const k = locKey(p);
    if (seen.has(k)) { dup.add(k); } else seen.set(k, p.id);
  }
  return dup;
}

let prodView = (() => { try { return localStorage.getItem('prodView') || 'category'; } catch { return 'category'; } })();
function setProdView(v) {
  prodView = v;
  try { localStorage.setItem('prodView', v); } catch { }
  renderProductRows();
}

function productRow(p, dup) {
  const k = locKey(p);
  return `<tr>
      <td>${thumbHTML(p)}</td>
      <td><div class="p-name">${esc(p.name)}</div>${prodView === 'column' && p.category ? `<small class="muted">${esc(p.category)}</small>` : ''}</td>
      <td>${money(p.price)}</td>
      <td><span class="tag loc">C${p.column}</span></td>
      <td><span class="tag loc">Shelf ${p.slot || 1}</span></td>
      <td><span class="tag loc">Alfie ${p.alfie || 1}</span> <small class="muted">${esc(alfieName(p.alfie || 1))}</small></td>
      <td><span class="tag loc">#${p.compartment}</span>${dup.has(k) ? '<span class="dup">Shared location</span>' : ''}</td>
      <td>${p.available ? '<span class="tag ok">In stock</span>' : '<span class="tag no">Sold out</span>'}</td>
      <td class="actions">
        <button class="btn-secondary" data-stock="${esc(p.id)}">${p.available ? 'Mark sold out' : 'Restock'}</button>
        <button class="btn-primary" data-edit="${esc(p.id)}">Edit</button>
      </td></tr>`;
}

function renderProductRows() {
  $$('#prod-view button').forEach(b => b.classList.toggle('on', b.dataset.view === prodView));
  const dup = dupLocations();
  const out = [];
  if (!state.products.length) {
    out.push(`<tr><td colspan="9" class="muted" style="padding:30px;text-align:center">No products yet. Press <b>+ Add product</b>.</td></tr>`);
  } else if (prodView === 'column') {
    // every column C1-C12 with its 10 shelves, empty shelves included (tap "+ Add" to fill one)
    for (let c = 1; c <= 12; c++) {
      const list = state.products.filter(p => +p.column === c).sort((a, b) => (a.slot || 1) - (b.slot || 1));
      const inStock = list.filter(p => p.available).length;
      out.push(`<tr class="grp"><td colspan="9"><b>Column ${c}</b><span>${list.length}/10 shelves filled · ${inStock} in stock${list[0] ? ' · ' + esc(alfieName(list[0].alfie || 1)) : ''}</span></td></tr>`);
      for (let sl = 1; sl <= 10; sl++) {
        const here = list.filter(p => (+p.slot || 1) === sl);
        if (here.length) here.forEach(p => out.push(productRow(p, dup)));
        else out.push(`<tr class="empty-row"><td></td><td colspan="3" class="muted">Shelf ${sl} is empty</td><td><span class="tag loc">Shelf ${sl}</span></td><td colspan="3"></td><td class="actions"><button class="btn-secondary" data-add-at="${c}-${sl}">+ Add here</button></td></tr>`);
      }
    }
  } else {
    // grouped by category, in the order the categories first appear; inside a group by column and shelf
    const groups = new Map();
    for (const p of state.products) {
      const k = p.category || 'Other';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    for (const [cat, list] of groups) {
      list.sort((a, b) => a.column - b.column || (a.slot || 1) - (b.slot || 1));
      const cols = [...new Set(list.map(p => 'C' + p.column))].join(', ');
      out.push(`<tr class="grp"><td colspan="9"><b>${esc(cat)}</b><span>${list.length} products · ${cols}</span></td></tr>`);
      list.forEach(p => out.push(productRow(p, dup)));
    }
  }
  $('#product-rows').innerHTML = out.join('');
}

// ---------- product editor
let editingId = null;
function openEditor(id, preset = {}) {
  editingId = id;
  const col0 = preset.column || 1;
  const p = state.products.find(x => x.id === id) || {
    name: '', image: '', price: '', column: col0, slot: preset.slot || freeSlot(col0), alfie: ((col0 - 1) % 3) + 1,
    compartment: preset.slot || freeSlot(col0), available: true,
    category: state.products.find(x => +x.column === col0)?.category || ''
  };
  const f = $('#product-form');
  $('#editor-title').textContent = id ? 'Edit product' : 'New product';
  f.name.value = p.name; f.image.value = p.image; f.price.value = p.price;
  f.column.innerHTML = colOpts(p.column); f.slot.innerHTML = slotOpts(p.slot || 1); f.alfie.innerHTML = alfieOpts(p.alfie || 1); f.compartment.innerHTML = compOpts(p.compartment);
  f.available.checked = p.available !== false;
  f.category.value = p.category || '';
  $('#category-list').innerHTML = [...new Set(state.products.map(x => x.category).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('');
  $('#btn-delete-product').classList.toggle('hidden', !id);
  updateEditorPreview();
  $('#product-modal').classList.add('open');
  setTimeout(() => f.name.focus(), 50);
}
function updateEditorPreview() {
  const f = $('#product-form');
  $('#editor-thumb').outerHTML = thumbHTML({ name: f.name.value || '?', image: f.image.value }).replace('class="thumb"', 'class="thumb big" id="editor-thumb"');
  const here = { column: +f.column.value, alfie: +f.alfie.value, compartment: +f.compartment.value };
  const other = state.products.find(p => p.id !== editingId && locKey(p) === locKey(here));
  const w = $('#editor-warn');
  w.classList.toggle('hidden', !other);
  const shelfTaken = state.products.find(p => p.id !== editingId && +p.column === here.column && +(p.slot || 1) === +f.slot.value);
  if (other) w.textContent = `"${other.name}" is already at column ${here.column}, Alfie ${here.alfie}, latch ${here.compartment}.`;
  else if (shelfTaken) { w.classList.remove('hidden'); w.textContent = `"${shelfTaken.name}" is already shown on shelf ${f.slot.value} of column ${here.column}.`; }
}
async function saveProduct(e) {
  e.preventDefault();
  const f = $('#product-form');
  const item = {
    id: editingId || ('p' + Date.now().toString(36)),
    name: f.name.value.trim(), image: f.image.value.trim(), price: parseFloat(f.price.value) || 0,
    category: f.category.value.trim(), column: +f.column.value, slot: +f.slot.value, alfie: +f.alfie.value, compartment: +f.compartment.value, available: f.available.checked
  };
  if (!item.name) return toast('Enter a product name', true);
  const products = editingId ? state.products.map(p => p.id === editingId ? item : p) : [...state.products, item];
  try {
    const s = await api('/api/products', 'PUT', { products });
    state.products = s.products;
    $('#product-modal').classList.remove('open');
    renderProductRows();
    toast(editingId ? 'Product updated' : 'Product added');
  } catch (err) { toast(err.message, true); }
}
async function deleteProduct() {
  const p = state.products.find(x => x.id === editingId);
  if (!p || !confirm(`Delete "${p.name}"?`)) return;
  const s = await api('/api/products', 'PUT', { products: state.products.filter(x => x.id !== editingId) });
  state.products = s.products;
  $('#product-modal').classList.remove('open');
  renderProductRows();
  toast('Product deleted');
}
async function toggleStock(id) {
  const products = state.products.map(p => p.id === id ? { ...p, available: !p.available } : p);
  const s = await api('/api/products', 'PUT', { products });
  state.products = s.products;
  renderProductRows();
}

// ---------- connection
let portList = [];
async function refreshPorts() {
  $$('[data-refresh]').forEach(b => b.disabled = true);
  try { const r = await api('/api/ports'); portList = r.ports; } catch { portList = []; }
  $$('[data-refresh]').forEach(b => b.disabled = false);
  fillPortSelects();
}
function fillPortSelects() {
  for (const role of ['rotary', 'alfie']) {
    const cur = state.settings[role].port;
    const list = portList.map(p => [p.path, p.name]);
    if (cur && !list.some(([v]) => v === cur)) list.unshift([cur, `${cur} (not found)`]);
    $(`#${role}-port`).innerHTML = `<option value="">— Select serial port —</option>` + opts(list, cur);
  }
}
function renderConnection() {
  const s = state.settings;
  $('#sim-toggle').checked = !!s.simulation;
  $('#sim-banner').classList.toggle('hidden', !s.simulation);
  for (const role of ['rotary', 'alfie']) {
    $(`#${role}-baud`).innerHTML = opts(BAUDS.map(b => [b, b]), s[role].baud);
    $(`#${role}-le`).innerHTML = opts(ENDINGS, s[role].lineEnding);
  }
  fillPortSelects();
  $('#rotary-timeout').value = s.rotary.moveTimeoutSec;
  $('#rotary-settle').value = s.rotary.settleMs ?? 800;
  $('#rotary-home-cmd').value = s.rotary.homeCommand || 'HOME';
  $('#rotary-home-on-connect').checked = s.rotary.homeOnConnect !== false;
  $('#rotary-home-dispense').checked = s.rotary.homeBeforeDispense !== false;
  $('#rotary-spin-seq').value = s.rotary.spinSequence || '';
  $('#rotary-spin-pause').value = s.rotary.spinPauseMs || 0;
  $('#rotary-firmware').value = s.rotary.firmware || 'v05';

  const tpl = s.alfie.frameTemplate;
  const preset = $('#alfie-preset');
  preset.value = [...preset.options].some(o => o.value === tpl) ? tpl : 'custom';
  $('#alfie-template').value = tpl;
  $('#alfie-init').value = s.alfie.initCommands || '';
  $('#alfie-open-timeout').value = s.alfie.openTimeoutSec;
  $('#alfie-close-timeout').value = s.alfie.closeTimeoutSec;
  $('#set-currency').value = s.currency;
  $('#set-idle').value = s.idleSeconds;
  $('#set-soldout').checked = s.soldOutAfterVend !== false;
  $('#set-password').value = '';
  updatePreview();
  if (!portList.length) refreshPorts();
}
function updatePreview() {
  $('#alfie-preview').textContent = buildFrame(1, [0x4F, 5], $('#alfie-template').value || '');
}
function collectConnection() {
  return {
    simulation: $('#sim-toggle').checked,
    currency: $('#set-currency').value || '$',
    idleSeconds: +$('#set-idle').value || 90,
    soldOutAfterVend: $('#set-soldout').checked,
    newAdminPassword: $('#set-password').value.trim() || undefined,
    rotary: { port: $('#rotary-port').value, baud: +$('#rotary-baud').value, lineEnding: $('#rotary-le').value, moveTimeoutSec: +$('#rotary-timeout').value || 90, settleMs: Math.max(0, +$('#rotary-settle').value || 0), homeCommand: $('#rotary-home-cmd').value.trim() || 'HOME', homeOnConnect: $('#rotary-home-on-connect').checked,
      homeBeforeDispense: $('#rotary-home-dispense').checked, spinSequence: $('#rotary-spin-seq').value.trim(), spinPauseMs: Math.max(0, +$('#rotary-spin-pause').value || 0),
      firmware: $('#rotary-firmware').value },
    alfie: {
      port: $('#alfie-port').value, baud: +$('#alfie-baud').value, lineEnding: $('#alfie-le').value,
      frameTemplate: $('#alfie-template').value.trim() || 't{ID}{DLC}{DATA}', initCommands: $('#alfie-init').value,
      openTimeoutSec: +$('#alfie-open-timeout').value || 5, closeTimeoutSec: +$('#alfie-close-timeout').value || 120
    }
  };
}
async function saveConnection(silent) {
  const pw = $('#set-password').value.trim();
  if (pw && !/^\d{4,8}$/.test(pw)) { toast('Password must be 4–8 digits', true); return false; }
  try {
    const s = await api('/api/settings', 'PUT', collectConnection());
    state.settings = s.settings; state.status = s.status;
    renderConnection(); renderStatus();
    if (!silent) toast(pw ? 'Settings saved · password changed' : 'Settings saved');
    return true;
  } catch (e) { toast(e.message, true); return false; }
}
async function openPort(role) {
  if (!(await saveConnection(true))) return;
  if (state.settings.simulation) return toast('Turn off simulation mode first', true);
  if (!state.settings[role].port) return toast('Select a serial port first', true);
  try { const r = await api(`/api/serial/${role}/open`, 'POST', {}); state.status = r.status; renderStatus(); toast(`${role === 'rotary' ? 'Rotary' : 'Alfie'} connected on ${state.settings[role].port}`); }
  catch (e) { toast(e.message, true); }
}
async function closePort(role) {
  try { const r = await api(`/api/serial/${role}/close`, 'POST', {}); state.status = r.status; renderStatus(); } catch (e) { toast(e.message, true); }
}
function renderStatus() {
  const st = state.status || {};
  for (const role of ['rotary', 'alfie']) {
    const d = $('#dot-' + role);
    if (!d) continue;
    d.className = 'status-dot ' + (st.simulation ? 'sim' : st[role]?.port ? 'on' : '');
    d.title = st.simulation ? 'Simulation' : st[role]?.port ? 'Connected ' + st[role].port : 'Not connected';
  }
}

// ---------- Alfie doors
function renderColumns() {
  $('#column-rows').innerHTML = [1, 2, 3].map(n => alfieCfg(n)).map(a => `<tr data-alfie="${a.alfie}">
    <td><b>Alfie ${a.alfie}</b></td>
    <td><input value="${esc(a.name)}" maxlength="30" data-f="name"></td>
    <td><input type="number" min="0" max="3" value="${a.groupId}" data-f="groupId"></td>
    <td><input type="number" min="0" max="15" value="${a.localAddress}" data-f="localAddress"></td>
    <td><code data-canid>0x${canId(a.alfie)}</code></td>
    <td class="actions"><button class="btn-secondary" data-test-alfie="${a.alfie}">Query latch 1</button></td>
  </tr>`).join('');
}
function collectColumns() {
  return $$('#column-rows tr').map(tr => ({
    alfie: +tr.dataset.alfie,
    name: $('[data-f=name]', tr).value.trim() || `Door ${tr.dataset.alfie}`,
    groupId: Math.min(3, Math.max(0, parseInt($('[data-f=groupId]', tr).value, 10) || 0)),
    localAddress: Math.min(15, Math.max(0, parseInt($('[data-f=localAddress]', tr).value, 10) || 0))
  }));
}

// ---------- test
function renderTest() {
  $('#test-cols').innerHTML = Array.from({ length: 12 }, (_, i) => `<button data-rot="${i + 1}">C${i + 1}</button>`).join('');
  const sel = $('#test-latch-col').value || 1;
  $('#test-latch-col').innerHTML = alfieOpts(sel);
  if (!$('#test-latch-num').options.length) $('#test-latch-num').innerHTML = compOpts(1);
}
async function safeSend(role, text) { try { await send(role, text); } catch (e) { toast(e.message, true); } }

// ================================================================ wire up
function wire() {
  // dashboard
  $('#btn-order').addEventListener('click', () => { setSpin(false); cart.clear(); show('catalog'); });
  $('#btn-gear').addEventListener('click', openNumpad);

  // catalog
  $('#btn-cat-back').addEventListener('click', () => show('dashboard'));
  $('#search').addEventListener('input', renderCatalog);
  $('#cat-chips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; catFilter = b.dataset.cat; renderChips(); renderCatalog(); $('#product-grid').scrollTop = 0; });
  $('#product-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-toggle]') || e.target.closest('.p-card');
    if (b) toggleCart(b.dataset.toggle || b.dataset.id);
  });
  $('#cart-items').addEventListener('click', e => { const b = e.target.closest('[data-remove]'); if (b) toggleCart(b.dataset.remove); });
  $('#btn-clear-cart').addEventListener('click', () => { cart.clear(); renderCatalog(); renderCart(); });
  $('#btn-checkout').addEventListener('click', checkout);
  $('#cart-bar').addEventListener('click', () => $('#cart').classList.add('open'));
  document.addEventListener('pointerdown', e => {
    const c = $('#cart');
    if (c.classList.contains('open') && !c.contains(e.target) && !e.target.closest('#cart-bar')) c.classList.remove('open');
  });

  // vend
  $('#btn-vend-done').addEventListener('click', () => show('dashboard'));

  // admin
  $('#btn-admin-exit').addEventListener('click', () => show('dashboard'));
  $('#admin-tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    $$('#admin-tabs button').forEach(x => x.classList.toggle('active', x === b));
    $$('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
  });
  $('#btn-add-product').addEventListener('click', () => openEditor(null));
  $('#prod-view').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setProdView(b.dataset.view); });
  $('#product-rows').addEventListener('click', e => {
    const add = e.target.closest('[data-add-at]');
    if (add) { const [c, sl] = add.dataset.addAt.split('-').map(Number); return openEditor(null, { column: c, slot: sl }); }
    const ed = e.target.closest('[data-edit]'); if (ed) return openEditor(ed.dataset.edit);
    const st = e.target.closest('[data-stock]'); if (st) return toggleStock(st.dataset.stock);
  });
  const f = $('#product-form');
  f.addEventListener('submit', saveProduct);
  f.addEventListener('input', updateEditorPreview);
  $('#btn-cancel-product').addEventListener('click', () => $('#product-modal').classList.remove('open'));
  $('#btn-delete-product').addEventListener('click', deleteProduct);

  $$('[data-refresh]').forEach(b => b.addEventListener('click', refreshPorts));
  $$('[data-open]').forEach(b => b.addEventListener('click', () => openPort(b.dataset.open)));
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closePort(b.dataset.close)));
  $('#sim-toggle').addEventListener('change', async () => { await saveConnection(true); toast(state.settings.simulation ? 'Simulation mode ON' : 'Simulation mode OFF: connect the serial ports'); });
  $('#btn-save-conn').addEventListener('click', () => saveConnection());
  $('#alfie-preset').addEventListener('change', e => { if (e.target.value !== 'custom') $('#alfie-template').value = e.target.value; updatePreview(); });
  $('#alfie-template').addEventListener('input', () => { $('#alfie-preset').value = [...$('#alfie-preset').options].some(o => o.value === $('#alfie-template').value) ? $('#alfie-template').value : 'custom'; updatePreview(); });

  $('#column-rows').addEventListener('input', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const g = (+$('[data-f=groupId]', tr).value) & 3, l = (+$('[data-f=localAddress]', tr).value) & 15;
    $('[data-canid]', tr).textContent = '0x' + ((g << 9) | (l << 4) | 0xF).toString(16).toUpperCase().padStart(3, '0');
  });
  $('#column-rows').addEventListener('click', e => { const b = e.target.closest('[data-test-alfie]'); if (b) safeSend('alfie', buildFrame(+b.dataset.testAlfie, [0x51, 1])); });
  $('#btn-save-cols').addEventListener('click', async () => {
    try { const s = await api('/api/settings', 'PUT', { alfies: collectColumns() }); state.settings = s.settings; renderAdmin(); toast('Alfie doors saved'); } catch (e) { toast(e.message, true); }
  });

  $('#test-cols').addEventListener('click', async e => {
    const b = e.target.closest('[data-rot]'); if (!b) return;
    try { await api('/api/rotary/goto', 'POST', { column: +b.dataset.rot }); } catch (err) { toast(err.message, true); }
  });

  // calibration page
  $('#cal-steps').addEventListener('click', e => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    calStep = +b.dataset.step;
    $$('#cal-steps button').forEach(x => x.classList.toggle('on', x === b));
    $('#cal-left-lbl').textContent = `−${calStep}° back`; $('#cal-right-lbl').textContent = `+${calStep}° CW`;
  });
  calJogButton($('#cal-left'), -1);
  calJogButton($('#cal-right'), +1);
  $('#cal-goto-btn').addEventListener('click', () => { const v = parseFloat($('#cal-goto').value); if (Number.isFinite(v)) calCmd(`GOTO ${((v % 360) + 360) % 360}`); });
  $('#cal-read').addEventListener('click', () => calCmd('POS?'));
  $('#cal-home').addEventListener('click', async () => { try { await api('/api/serial/rotary/home', 'POST', {}); toast('Homing started'); } catch (e) { toast(e.message, true); } });
  $('#cal-rows').addEventListener('click', e => {
    const go = e.target.closest('[data-cal-go]');
    if (go) return calCmd(`GOTO ${calAngles[+go.dataset.calGo]}`);
    const set = e.target.closest('[data-cal-set]');
    if (set) {
      const a = state.status?.rotary?.angle;
      if (a == null) return toast('Position unknown: press Read first', true);
      calAngles[+set.dataset.calSet] = Math.round(a * 100) / 100;
      renderCalibration();
      toast(`C${+set.dataset.calSet + 1} = ${fmtDeg(a)}° (press Save calibration to keep it)`);
    }
  });
  $('#cal-rows').addEventListener('change', e => {
    const i = e.target.dataset.calAngle; if (i == null) return;
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) calAngles[+i] = Math.round((((v % 360) + 360) % 360) * 100) / 100;
    renderCalibration();
  });
  ['mo-move', 'mo-up', 'mo-down'].forEach(id => $('#' + id).addEventListener('input', motionInfo));
  $('#mo-dir').addEventListener('change', () => toast('After changing the direction, re-check the column angles (they are counted the other way)'));
  $('#mo-test').addEventListener('click', () => calCmd('JOG 30'));
  $('#mo-save').addEventListener('click', async () => {
    const lim = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const rotary = {
      moveRPM: lim($('#mo-move').value, 0.2, 30, 5), spinRPM: lim($('#mo-run').value, 0.2, 30, 2),
      rampUpSec: lim($('#mo-up').value, 0.05, 30, 3), rampDownSec: lim($('#mo-down').value, 0.05, 30, 3),
      cwDir: $('#mo-dir').value === '-1' ? -1 : 1
    };
    try { const s = await api('/api/settings', 'PUT', { rotary }); state.settings = s.settings; renderMotion(); toast('Motion saved and sent to the rotary'); }
    catch (e) { toast(e.message, true); }
  });
  $('#cal-even').addEventListener('click', () => { calAngles = calAngles.map((_, i) => i * 30); renderCalibration(); });
  $('#cal-save').addEventListener('click', async () => {
    try {
      const s = await api('/api/settings', 'PUT', { rotary: { columnAngles: calAngles } });
      state.settings = s.settings; calSaved = JSON.stringify(calAngles); calDirty();
      toast('Calibration saved');
    } catch (e) { toast(e.message, true); }
  });
  $('#btn-rotary-raw').addEventListener('click', () => { const v = $('#rotary-raw').value.trim(); if (v) safeSend('rotary', v); });
  $('#btn-test-open').addEventListener('click', () => safeSend('alfie', buildFrame(+$('#test-latch-col').value, [0x4F, +$('#test-latch-num').value])));
  $('#btn-test-query').addEventListener('click', () => safeSend('alfie', buildFrame(+$('#test-latch-col').value, [0x51, +$('#test-latch-num').value])));
  $('#btn-alfie-raw').addEventListener('click', () => { const v = $('#alfie-raw').value.trim(); if (v) safeSend('alfie', v); });
  $('#btn-clear-log').addEventListener('click', () => { $('#log').innerHTML = ''; });

  window.addEventListener('resize', () => { dashRotary.layout(); vendRotary.layout(); });
  $('#btn-home-now').addEventListener('click', async () => {
    try { await api('/api/serial/rotary/home', 'POST', {}); toast('Homing started'); } catch (e) { toast(e.message, true); }
  });
  $('#product-form').slot && $('#product-form').column.addEventListener('change', e => { if (!editingId) $('#product-form').slot.innerHTML = slotOpts(freeSlot(e.target.value)); updateEditorPreview(); });
}

async function init() {
  dashRotary = new Rotary($('#dash-rotary'));
  vendRotary = new Rotary($('#vend-rotary'));
  buildNumpad();
  wire();
  tickClock(); setInterval(tickClock, 15000);
  try { state = await api('/api/state'); }
  catch { toast('Cannot reach the kiosk server', true); }
  connectStream();
  show('dashboard');
}
init();
