// Builds the demo catalogue for the Rotary XL: 12 columns x 10 shelves = 120 products,
// each with a reference image (flat SVG illustration in Signifi colours) in public/img/products/.
// Output: public/img/products/*.svg and demo-products.json (loaded when data/store.json does not exist).
// Run:  node tools/build-catalog.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'public', 'img', 'products');
fs.mkdirSync(IMG_DIR, { recursive: true });

// ---------------------------------------------------------------- palette
const S = '#243037', R = '#e32d49', G = '#d3ddde', W = '#ffffff', M = '#8a9aa1', D = '#3a4a54';
const COLORS = {
  black: ['#1f2328', '#3a4048'], slate: ['#243037', '#3a4a54'], red: ['#e32d49', '#b81c36'],
  white: ['#eef1f2', '#c9d2d5'], silver: ['#b9c3c7', '#8f9ca1'], blue: ['#2f6fb0', '#1f4f82'], grey: ['#8a9aa1', '#5d6f78']
};

// every drawing is a 200x200 scene; c = main colour, d = darker shade of it
const shadow = (w = 120, y = 178) => `<ellipse cx="100" cy="${y}" rx="${w / 2}" ry="7" fill="#243037" opacity=".12"/>`;
const coil = (col) => `<path d="M60 120c0-22 80-22 80 0s-80 22-80 0 80-44 80-22-80 22-80 0" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round"/>`;

const DRAW = {
  mouse: (c, d) => `${shadow(80)}<rect x="62" y="30" width="76" height="140" rx="38" fill="${c}"/><path d="M100 30v52M62 82h76" stroke="${d}" stroke-width="3"/><rect x="95" y="46" width="10" height="22" rx="5" fill="${R}"/>`,
  ergomouse: (c, d) => `${shadow(90)}<path d="M58 150c-8-50 8-112 52-118 34-4 44 40 38 78-6 40-20 60-50 62-22 1-37-6-40-22z" fill="${c}"/><path d="M96 34l6 54" stroke="${d}" stroke-width="3"/><rect x="92" y="52" width="9" height="20" rx="4.5" fill="${R}" transform="rotate(-6 96 62)"/><path d="M58 128c18 6 34 6 50 0" stroke="${d}" stroke-width="3" fill="none"/>`,
  keyboard: (c, d) => { let k = ''; for (let r = 0; r < 4; r++) for (let i = 0; i < 10; i++) k += `<rect x="${24 + i * 15.5}" y="${78 + r * 15}" width="12" height="11" rx="2" fill="${d}"/>`; return `${shadow(170)}<rect x="16" y="68" width="168" height="80" rx="10" fill="${c}"/>${k}<rect x="55" y="138" width="90" height="6" rx="3" fill="${R}"/>`; },
  keypad: (c, d) => { let k = ''; for (let r = 0; r < 5; r++) for (let i = 0; i < 4; i++) k += `<rect x="${62 + i * 20}" y="${40 + r * 24}" width="16" height="19" rx="3" fill="${i === 3 && r > 2 ? R : d}"/>`; return `${shadow(100)}<rect x="54" y="30" width="92" height="138" rx="12" fill="${c}"/>${k}`; },
  headset: (c, d) => `${shadow(130)}<path d="M50 112V96a50 50 0 0 1 100 0v16" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round"/><rect x="34" y="100" width="34" height="56" rx="14" fill="${c}"/><rect x="132" y="100" width="34" height="56" rx="14" fill="${c}"/><rect x="40" y="108" width="22" height="40" rx="9" fill="${d}"/><rect x="138" y="108" width="22" height="40" rx="9" fill="${d}"/><path d="M50 150c0 20 20 26 40 26" fill="none" stroke="${M}" stroke-width="5" stroke-linecap="round"/><circle cx="94" cy="176" r="7" fill="${R}"/>`,
  earbuds: (c, d) => `${shadow(110)}<rect x="48" y="70" width="104" height="96" rx="40" fill="${c}"/><path d="M48 104h104" stroke="${d}" stroke-width="3"/><circle cx="100" cy="134" r="5" fill="${R}"/><g fill="${c}" stroke="${d}" stroke-width="3"><circle cx="72" cy="46" r="17"/><circle cx="128" cy="46" r="17"/></g><rect x="68" y="56" width="9" height="22" rx="4" fill="${d}"/><rect x="123" y="56" width="9" height="22" rx="4" fill="${d}"/>`,
  speaker: (c, d) => `${shadow(110)}<rect x="52" y="30" width="96" height="140" rx="26" fill="${c}"/><circle cx="100" cy="112" r="34" fill="${d}"/><circle cx="100" cy="112" r="14" fill="${c}"/><circle cx="100" cy="56" r="10" fill="${d}"/><rect x="88" y="152" width="24" height="5" rx="2.5" fill="${R}"/>`,
  microphone: (c, d) => `${shadow(90)}<rect x="76" y="22" width="48" height="84" rx="24" fill="${c}"/><g stroke="${d}" stroke-width="3"><path d="M78 50h44M78 64h44M78 78h44"/></g><path d="M64 84c0 24 16 38 36 38s36-14 36-38" fill="none" stroke="${M}" stroke-width="6" stroke-linecap="round"/><path d="M100 122v36" stroke="${M}" stroke-width="7"/><rect x="66" y="156" width="68" height="12" rx="6" fill="${S}"/><circle cx="100" cy="96" r="4" fill="${R}"/>`,
  charger: (c, d) => `${shadow(100)}<rect x="56" y="56" width="88" height="108" rx="16" fill="${c}"/><rect x="74" y="28" width="10" height="32" rx="3" fill="${M}"/><rect x="116" y="28" width="10" height="32" rx="3" fill="${M}"/><rect x="84" y="128" width="32" height="10" rx="5" fill="${d}"/><rect x="88" y="92" width="24" height="6" rx="3" fill="${R}"/>`,
  travel: (c, d) => `${shadow(110)}<rect x="50" y="50" width="100" height="100" rx="16" fill="${c}"/><rect x="62" y="150" width="8" height="24" rx="2" fill="${M}"/><rect x="130" y="150" width="8" height="24" rx="2" fill="${M}"/><rect x="62" y="70" width="76" height="40" rx="8" fill="${d}"/><circle cx="82" cy="90" r="6" fill="${c}"/><circle cx="118" cy="90" r="6" fill="${c}"/><rect x="70" y="124" width="24" height="8" rx="4" fill="${R}"/><rect x="106" y="124" width="24" height="8" rx="4" fill="${S}"/>`,
  powerbank: (c, d) => `${shadow(100)}<rect x="60" y="22" width="80" height="150" rx="16" fill="${c}"/><g fill="${R}"><circle cx="82" cy="150" r="4"/><circle cx="94" cy="150" r="4"/><circle cx="106" cy="150" r="4"/></g><circle cx="118" cy="150" r="4" fill="${d}"/><rect x="88" y="30" width="24" height="6" rx="3" fill="${d}"/><path d="M104 76l-14 24h12l-6 22 16-28h-12l6-18z" fill="${d}"/>`,
  powerstrip: (c, d) => { let o = ''; for (let i = 0; i < 4; i++) o += `<g transform="translate(${44 + i * 30} 100)"><circle r="11" fill="${d}"/><rect x="-5" y="-5" width="3" height="8" fill="${c}"/><rect x="2" y="-5" width="3" height="8" fill="${c}"/></g>`; return `${shadow(170)}<rect x="18" y="80" width="164" height="40" rx="12" fill="${c}"/>${o}<rect x="160" y="92" width="14" height="16" rx="3" fill="${R}"/><path d="M18 100c-10 0-12 30 10 40" fill="none" stroke="${M}" stroke-width="5"/>`; },
  batteries: (c, d) => `${shadow(110)}<g><rect x="56" y="44" width="38" height="120" rx="8" fill="${c}"/><rect x="66" y="36" width="18" height="10" rx="2" fill="${M}"/><rect x="56" y="64" width="38" height="20" fill="${R}"/></g><g><rect x="106" y="44" width="38" height="120" rx="8" fill="${c}"/><rect x="116" y="36" width="18" height="10" rx="2" fill="${M}"/><rect x="106" y="64" width="38" height="20" fill="${R}"/></g>`,
  usbc: (c, d) => `${shadow(130)}${coil(c)}<rect x="34" y="40" width="20" height="44" rx="6" fill="${S}"/><rect x="38" y="26" width="12" height="16" rx="4" fill="${M}"/><rect x="146" y="40" width="20" height="44" rx="6" fill="${S}"/><rect x="150" y="26" width="12" height="16" rx="4" fill="${M}"/><path d="M44 84v20M156 84v20" stroke="${c}" stroke-width="7"/><rect x="40" y="70" width="8" height="5" rx="2" fill="${R}"/>`,
  usba: (c, d) => `${shadow(130)}${coil(c)}<rect x="34" y="44" width="22" height="40" rx="5" fill="${S}"/><rect x="36" y="22" width="18" height="24" fill="${M}"/><rect x="146" y="44" width="20" height="40" rx="6" fill="${S}"/><rect x="150" y="30" width="12" height="16" rx="4" fill="${M}"/><path d="M45 84v20M156 84v20" stroke="${c}" stroke-width="7"/><rect x="41" y="70" width="8" height="5" rx="2" fill="${R}"/>`,
  lightning: (c, d) => `${shadow(130)}${coil(c)}<rect x="34" y="44" width="22" height="40" rx="5" fill="${S}"/><rect x="36" y="22" width="18" height="24" fill="${M}"/><rect x="146" y="44" width="20" height="40" rx="6" fill="${W}" stroke="${G}" stroke-width="2"/><rect x="151" y="28" width="10" height="18" rx="3" fill="${M}"/><path d="M45 84v20M156 84v20" stroke="${c}" stroke-width="7"/>`,
  hdmi: (c, d) => `${shadow(130)}${coil(c)}<rect x="30" y="44" width="30" height="40" rx="5" fill="${S}"/><path d="M32 24h26v16l-4 6H36l-4-6z" fill="${M}"/><rect x="140" y="44" width="30" height="40" rx="5" fill="${S}"/><path d="M142 24h26v16l-4 6h-18l-4-6z" fill="${M}"/><path d="M45 84v20M155 84v20" stroke="${c}" stroke-width="7"/><rect x="40" y="70" width="10" height="5" rx="2" fill="${R}"/>`,
  ethernet: (c, d) => `${shadow(130)}${coil(c)}<rect x="30" y="34" width="30" height="50" rx="5" fill="${d}" opacity=".9"/><rect x="34" y="22" width="22" height="16" rx="2" fill="${G}"/><rect x="140" y="34" width="30" height="50" rx="5" fill="${d}" opacity=".9"/><rect x="144" y="22" width="22" height="16" rx="2" fill="${G}"/><path d="M45 84v20M155 84v20" stroke="${c}" stroke-width="7"/>`,
  displayport: (c, d) => `${shadow(130)}${coil(c)}<rect x="30" y="44" width="30" height="40" rx="5" fill="${S}"/><path d="M32 22h26v20H38l-6-6z" fill="${M}"/><rect x="140" y="44" width="30" height="40" rx="5" fill="${S}"/><path d="M142 22h26v20h-20l-6-6z" fill="${M}"/><path d="M45 84v20M155 84v20" stroke="${c}" stroke-width="7"/>`,
  flash: (c, d) => `${shadow(70)}<rect x="74" y="58" width="52" height="110" rx="10" fill="${c}"/><rect x="82" y="22" width="36" height="40" rx="3" fill="${M}"/><rect x="90" y="32" width="8" height="8" fill="${S}"/><rect x="102" y="32" width="8" height="8" fill="${S}"/><circle cx="100" cy="150" r="8" fill="none" stroke="${d}" stroke-width="4"/><rect x="84" y="92" width="32" height="6" rx="3" fill="${R}"/>`,
  ssd: (c, d) => `${shadow(120)}<rect x="44" y="44" width="112" height="124" rx="18" fill="${c}"/><rect x="44" y="132" width="112" height="14" fill="${d}"/><rect x="60" y="62" width="34" height="8" rx="4" fill="${R}"/><circle cx="138" cy="66" r="5" fill="${R}"/><rect x="88" y="156" width="24" height="7" rx="3" fill="${S}"/>`,
  sdcard: (c, d) => { let p = ''; for (let i = 0; i < 6; i++) p += `<rect x="${72 + i * 11}" y="38" width="7" height="22" rx="1.5" fill="#d9b44a"/>`; return `${shadow(100)}<path d="M58 30h66l24 24v110a8 8 0 0 1-8 8H58a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z" fill="${c}"/>${p}<rect x="62" y="104" width="76" height="40" rx="6" fill="${d}"/><rect x="72" y="118" width="40" height="8" rx="4" fill="${R}"/>`; },
  hub: (c, d) => `${shadow(150)}<rect x="28" y="84" width="144" height="44" rx="14" fill="${c}"/><g fill="${d}"><rect x="44" y="99" width="20" height="12" rx="2"/><rect x="72" y="99" width="20" height="12" rx="2"/><rect x="100" y="99" width="20" height="12" rx="2"/><rect x="128" y="101" width="14" height="8" rx="4"/></g><circle cx="156" cy="105" r="4" fill="${R}"/><path d="M28 106c-14 0-16-40 6-50" fill="none" stroke="${M}" stroke-width="6" stroke-linecap="round"/>`,
  dock: (c, d) => `${shadow(170)}<rect x="20" y="70" width="160" height="80" rx="12" fill="${c}"/><rect x="20" y="70" width="160" height="16" rx="8" fill="${d}"/><g fill="${d}"><rect x="34" y="104" width="18" height="12" rx="2"/><rect x="58" y="104" width="18" height="12" rx="2"/><rect x="84" y="102" width="22" height="16" rx="2"/><rect x="114" y="104" width="22" height="12" rx="2"/><rect x="144" y="106" width="14" height="8" rx="4"/></g><rect x="34" y="132" width="40" height="6" rx="3" fill="${R}"/>`,
  dongle: (c, d) => `${shadow(110)}<rect x="62" y="74" width="76" height="52" rx="14" fill="${c}"/><rect x="138" y="88" width="30" height="24" fill="${M}"/><rect x="144" y="94" width="18" height="12" fill="${S}"/><path d="M62 100H40" stroke="${c}" stroke-width="10" stroke-linecap="round"/><rect x="20" y="92" width="22" height="16" rx="5" fill="${S}"/><circle cx="100" cy="100" r="5" fill="${R}"/>`,
  wifi: (c, d) => `${shadow(80)}<rect x="80" y="96" width="40" height="70" rx="8" fill="${c}"/><rect x="86" y="160" width="28" height="18" fill="${M}"/><g fill="none" stroke="${R}" stroke-width="6" stroke-linecap="round"><path d="M80 70a28 28 0 0 1 40 0"/><path d="M66 54a48 48 0 0 1 68 0"/></g><circle cx="100" cy="84" r="6" fill="${R}"/>`,
  laptopstand: (c, d) => `${shadow(150)}<path d="M36 150l110-70" stroke="${c}" stroke-width="12" stroke-linecap="round"/><path d="M146 80l8 72" stroke="${d}" stroke-width="10" stroke-linecap="round"/><path d="M60 150h100" stroke="${d}" stroke-width="10" stroke-linecap="round"/><path d="M40 146l-6-14" stroke="${R}" stroke-width="8" stroke-linecap="round"/>`,
  sleeve: (c, d) => `${shadow(170)}<rect x="22" y="52" width="156" height="110" rx="16" fill="${c}"/><path d="M22 72h156" stroke="${d}" stroke-width="4" stroke-dasharray="6 5"/><rect x="150" y="64" width="16" height="10" rx="3" fill="${R}"/><rect x="40" y="100" width="40" height="6" rx="3" fill="${d}"/>`,
  backpack: (c, d) => `${shadow(120)}<path d="M80 40a20 20 0 0 1 40 0" fill="none" stroke="${d}" stroke-width="8"/><rect x="48" y="40" width="104" height="132" rx="30" fill="${c}"/><rect x="62" y="104" width="76" height="56" rx="14" fill="${d}"/><path d="M62 124h76" stroke="${c}" stroke-width="3"/><rect x="92" y="114" width="16" height="6" rx="3" fill="${R}"/>`,
  monitor: (c, d) => `${shadow(130)}<rect x="22" y="34" width="156" height="100" rx="8" fill="${c}"/><rect x="30" y="42" width="140" height="80" rx="3" fill="#dfe8ea"/><path d="M30 104l42-30 30 22 22-14 46 30v10H30z" fill="${G}"/><circle cx="140" cy="62" r="8" fill="${R}"/><path d="M100 134v28" stroke="${d}" stroke-width="10"/><rect x="66" y="160" width="68" height="10" rx="5" fill="${d}"/>`,
  privacy: (c, d) => `${shadow(150)}<rect x="28" y="40" width="144" height="100" rx="8" fill="${S}"/><rect x="36" y="48" width="128" height="84" rx="3" fill="${c}"/><g stroke="${d}" stroke-width="2" opacity=".6">${Array.from({ length: 16 }, (_, i) => `<path d="M${40 + i * 8} 50v80"/>`).join('')}</g><rect x="150" y="34" width="14" height="10" rx="2" fill="${R}"/>`,
  phonestand: (c, d) => `${shadow(110)}<rect x="68" y="30" width="56" height="110" rx="10" fill="${S}" transform="rotate(-12 96 85)"/><rect x="74" y="38" width="44" height="90" rx="5" fill="#dfe8ea" transform="rotate(-12 96 85)"/><path d="M58 166l60-30 20 30z" fill="${c}"/><path d="M76 146h62" stroke="${d}" stroke-width="8" stroke-linecap="round"/>`,
  phonecase: (c, d) => `${shadow(80)}<rect x="62" y="22" width="76" height="152" rx="16" fill="${c}"/><rect x="72" y="32" width="30" height="34" rx="9" fill="${d}"/><circle cx="82" cy="44" r="5" fill="${S}"/><circle cx="92" cy="56" r="5" fill="${S}"/><rect x="88" y="140" width="24" height="5" rx="2.5" fill="${R}"/>`,
  protector: (c, d) => `${shadow(90)}<rect x="56" y="22" width="76" height="152" rx="16" fill="${S}"/><rect x="72" y="30" width="76" height="152" rx="16" fill="#e8f1f4" stroke="${M}" stroke-width="2" opacity=".9"/><path d="M84 60l40-24M84 90l50-30" stroke="${W}" stroke-width="6" stroke-linecap="round"/><rect x="100" y="166" width="20" height="4" rx="2" fill="${R}"/>`,
  tablet: (c, d) => `${shadow(150)}<rect x="30" y="30" width="140" height="140" rx="14" fill="${c}"/><rect x="40" y="40" width="120" height="120" rx="6" fill="#dfe8ea"/><path d="M40 136l40-30 26 20 20-12 34 24v22H40z" fill="${G}"/><circle cx="132" cy="66" r="9" fill="${R}"/>`,
  stylus: (c, d) => `${shadow(100)}<path d="M54 160l90-110" stroke="${c}" stroke-width="16" stroke-linecap="round"/><path d="M54 160l-10 14" stroke="${M}" stroke-width="6" stroke-linecap="round"/><path d="M128 70l12-14" stroke="${R}" stroke-width="16" stroke-linecap="round"/>`,
  watch: (c, d) => `${shadow(70)}<rect x="78" y="14" width="44" height="172" rx="16" fill="${c}"/><rect x="66" y="62" width="68" height="76" rx="18" fill="${S}"/><rect x="72" y="68" width="56" height="64" rx="13" fill="#1f2328"/><path d="M100 82v18l12 8" stroke="${R}" stroke-width="5" stroke-linecap="round" fill="none"/><rect x="134" y="88" width="6" height="16" rx="3" fill="${M}"/>`,
  webcam: (c, d) => `${shadow(110)}<rect x="40" y="48" width="120" height="72" rx="36" fill="${c}"/><circle cx="100" cy="84" r="26" fill="${S}"/><circle cx="100" cy="84" r="14" fill="#2f6fb0"/><circle cx="94" cy="78" r="4" fill="${W}" opacity=".8"/><circle cx="140" cy="70" r="4" fill="${R}"/><path d="M100 120v26" stroke="${d}" stroke-width="10"/><path d="M70 160h60l-8-14H78z" fill="${d}"/>`,
  clicker: (c, d) => `${shadow(80)}<rect x="74" y="20" width="52" height="156" rx="26" fill="${c}"/><circle cx="100" cy="62" r="14" fill="${R}"/><rect x="88" y="92" width="24" height="18" rx="6" fill="${d}"/><rect x="88" y="118" width="24" height="18" rx="6" fill="${d}"/><circle cx="100" cy="28" r="3" fill="${R}"/>`,
  lamp: (c, d) => `${shadow(110)}<path d="M70 166l26-70 44-30" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M128 44l40 28-14 16-40-26z" fill="${c}"/><path d="M146 86l-12 22" stroke="#ffd36a" stroke-width="16" opacity=".5" stroke-linecap="round"/><rect x="46" y="160" width="60" height="12" rx="6" fill="${d}"/><circle cx="96" cy="96" r="6" fill="${R}"/>`,
  mousepad: (c, d) => `${shadow(170)}<rect x="18" y="62" width="164" height="100" rx="14" fill="${c}"/><rect x="18" y="62" width="164" height="100" rx="14" fill="none" stroke="${d}" stroke-width="4"/><rect x="118" y="86" width="34" height="56" rx="17" fill="${S}"/><path d="M135 86v20" stroke="${M}" stroke-width="2"/><rect x="30" y="144" width="30" height="6" rx="3" fill="${R}"/>`,
  cleaning: (c, d) => `${shadow(140)}<rect x="44" y="70" width="48" height="100" rx="12" fill="${c}"/><rect x="54" y="48" width="28" height="24" rx="4" fill="${d}"/><path d="M82 52h22v10H82z" fill="${d}"/><rect x="52" y="104" width="32" height="28" rx="4" fill="${W}"/><rect x="58" y="114" width="20" height="6" rx="3" fill="${R}"/><path d="M104 116c16-8 40-8 56 0v50c-16-8-40-8-56 0z" fill="#9fd3e6"/><path d="M104 132c16-8 40-8 56 0" stroke="${W}" stroke-width="3" fill="none" opacity=".7"/>`,
  organizer: (c, d) => `${shadow(150)}<rect x="30" y="90" width="140" height="70" rx="14" fill="${c}"/><path d="M60 90c0-30 80-30 80 0" fill="none" stroke="${M}" stroke-width="7"/><g fill="${d}"><rect x="48" y="112" width="28" height="10" rx="5"/><rect x="86" y="112" width="28" height="10" rx="5"/><rect x="124" y="112" width="28" height="10" rx="5"/></g><rect x="84" y="140" width="32" height="6" rx="3" fill="${R}"/>`,
  lock: (c, d) => `${shadow(130)}<path d="M50 140c-30-20-20-90 30-90s70 60 40 86" fill="none" stroke="${M}" stroke-width="7"/><rect x="104" y="112" width="56" height="52" rx="10" fill="${c}"/><path d="M116 112v-14a16 16 0 0 1 32 0v14" fill="none" stroke="${d}" stroke-width="7"/><circle cx="132" cy="136" r="7" fill="${R}"/><rect x="129" y="138" width="6" height="14" rx="2" fill="${R}"/>`,
  notebook: (c, d) => `${shadow(120)}<rect x="52" y="28" width="100" height="144" rx="8" fill="${c}"/><g fill="${M}">${Array.from({ length: 7 }, (_, i) => `<rect x="44" y="${40 + i * 18}" width="16" height="6" rx="3"/>`).join('')}</g><rect x="70" y="56" width="66" height="22" rx="4" fill="${W}" opacity=".9"/><rect x="78" y="64" width="40" height="6" rx="3" fill="${R}"/>`
};

function svg(type, color) {
  const [c, d] = COLORS[color] || COLORS.slate;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="400" height="400">` +
    `<rect width="200" height="200" rx="18" fill="#f5f7f7"/><circle cx="100" cy="96" r="84" fill="#ffffff"/>` +
    DRAW[type](c, d) + `</svg>\n`;
}

// ---------------------------------------------------------------- catalogue: one theme per column
// [name, drawing, colour, price]
const COLUMNS = [
  ['Mice & keyboards', [
    ['Wireless Mouse', 'mouse', 'black', 24.99], ['Ergonomic Vertical Mouse', 'ergomouse', 'slate', 42.00], ['Bluetooth Mouse – Silver', 'mouse', 'silver', 29.99],
    ['Compact Travel Mouse', 'mouse', 'red', 19.99], ['Wireless Keyboard', 'keyboard', 'slate', 49.00], ['Slim Bluetooth Keyboard', 'keyboard', 'white', 59.00],
    ['Keyboard & Mouse Combo', 'keyboard', 'black', 69.00], ['USB Numeric Keypad', 'keypad', 'black', 22.50], ['Gaming Mouse RGB', 'ergomouse', 'red', 54.00], ['Wired Optical Mouse', 'mouse', 'grey', 12.99]]],
  ['Audio', [
    ['Noise-Cancel Headset', 'headset', 'black', 89.00], ['USB Office Headset', 'headset', 'slate', 45.00], ['Bluetooth Earbuds', 'earbuds', 'white', 69.00],
    ['Sport Earbuds', 'earbuds', 'red', 49.00], ['Wireless Over-Ear Headphones', 'headset', 'silver', 119.00], ['Portable Bluetooth Speaker', 'speaker', 'red', 59.00],
    ['Mini Speaker', 'speaker', 'slate', 29.00], ['USB Conference Mic', 'microphone', 'black', 79.00], ['Clip-on Lavalier Mic', 'microphone', 'grey', 24.00], ['Kids Safe Headphones', 'headset', 'blue', 34.00]]],
  ['Charging', [
    ['USB-C Charger 65W', 'charger', 'white', 39.00], ['USB-C Charger 30W', 'charger', 'black', 25.00], ['Phone Charger 20W', 'charger', 'white', 22.00],
    ['GaN Charger 100W', 'charger', 'slate', 69.00], ['Dual-Port Car Charger', 'dongle', 'black', 18.00], ['Universal Travel Adapter', 'travel', 'slate', 34.00],
    ['Wireless Charging Pad', 'mousepad', 'black', 29.00], ['Laptop Charger 90W', 'charger', 'black', 59.00], ['Travel Adapter EU/UK', 'travel', 'white', 24.00], ['Multi-Port Charger', 'charger', 'red', 49.00]]],
  ['Cables', [
    ['USB-C to USB-C Cable 1m', 'usbc', 'white', 14.99], ['USB-C to USB-C Cable 2m', 'usbc', 'black', 17.99], ['USB-A to USB-C Cable', 'usba', 'slate', 12.99],
    ['Lightning Cable', 'lightning', 'white', 14.99], ['HDMI Cable 2m', 'hdmi', 'black', 12.99], ['HDMI Cable 5m', 'hdmi', 'slate', 19.99],
    ['DisplayPort Cable', 'displayport', 'black', 16.50], ['Ethernet Cable Cat6 3m', 'ethernet', 'blue', 9.99], ['Ethernet Cable Cat6 10m', 'ethernet', 'grey', 15.99], ['Braided USB-C Cable', 'usbc', 'red', 19.99]]],
  ['Storage', [
    ['USB Flash 32GB', 'flash', 'slate', 9.99], ['USB Flash 64GB', 'flash', 'red', 13.99], ['USB Flash 128GB', 'flash', 'black', 18.00],
    ['USB-C Flash 256GB', 'flash', 'silver', 34.00], ['Portable SSD 500GB', 'ssd', 'slate', 69.00], ['Portable SSD 1TB', 'ssd', 'black', 109.00],
    ['Portable SSD 2TB', 'ssd', 'red', 179.00], ['microSD Card 128GB', 'sdcard', 'black', 21.00], ['SD Card 64GB', 'sdcard', 'blue', 16.00], ['SD Card Reader', 'dongle', 'slate', 14.00]]],
  ['Hubs & adapters', [
    ['USB-C Hub 7-in-1', 'hub', 'silver', 54.00], ['USB 3.0 Hub 4-Port', 'hub', 'black', 24.00], ['Docking Station', 'dock', 'black', 149.00],
    ['Dual Monitor Dock', 'dock', 'slate', 199.00], ['USB-C to HDMI Adapter', 'dongle', 'silver', 22.00], ['USB-C to USB-A Adapter', 'dongle', 'slate', 9.99],
    ['Ethernet Adapter', 'dongle', 'black', 19.99], ['USB Wi-Fi Adapter', 'wifi', 'black', 24.00], ['USB-C to DisplayPort Adapter', 'dongle', 'grey', 24.00], ['Travel Hub 5-in-1', 'hub', 'red', 39.00]]],
  ['Laptop accessories', [
    ['Laptop Stand', 'laptopstand', 'silver', 34.50], ['Adjustable Laptop Stand', 'laptopstand', 'slate', 44.00], ['Laptop Sleeve 13"', 'sleeve', 'slate', 25.00],
    ['Laptop Sleeve 15"', 'sleeve', 'grey', 29.00], ['Privacy Screen 14"', 'privacy', 'slate', 39.99], ['Privacy Screen 15.6"', 'privacy', 'grey', 44.99],
    ['Laptop Cable Lock', 'lock', 'black', 29.00], ['Laptop Cooling Pad', 'mousepad', 'slate', 32.00], ['Keyboard Cover', 'keyboard', 'grey', 12.00], ['Laptop Sleeve 14" Red', 'sleeve', 'red', 27.00]]],
  ['Phone & tablet', [
    ['Smartphone Mount', 'phonestand', 'black', 17.99], ['Adjustable Phone Stand', 'phonestand', 'silver', 19.99], ['Phone Case – Clear', 'phonecase', 'white', 15.00],
    ['Phone Case – Red', 'phonecase', 'red', 15.00], ['Screen Protector 2-Pack', 'protector', 'white', 12.00], ['Tablet Stand', 'phonestand', 'slate', 24.00],
    ['Tablet Case 11"', 'tablet', 'slate', 34.00], ['Active Stylus Pen', 'stylus', 'white', 29.00], ['Smartwatch Band', 'watch', 'red', 19.00], ['Phone Grip Ring', 'phonecase', 'slate', 9.00]]],
  ['Video & presenting', [
    ['Webcam 1080p', 'webcam', 'black', 59.00], ['Webcam 4K', 'webcam', 'slate', 129.00], ['Webcam Privacy Cover', 'webcam', 'grey', 6.99],
    ['Presentation Clicker', 'clicker', 'black', 27.50], ['Laser Presenter', 'clicker', 'red', 34.00], ['Portable Monitor 15.6"', 'monitor', 'slate', 189.00],
    ['Ring Light Clip', 'lamp', 'white', 22.00], ['Monitor Cable Kit', 'hdmi', 'grey', 21.00], ['Conference Speakerphone', 'speaker', 'black', 99.00], ['Monitor Light Bar', 'lamp', 'black', 49.00]]],
  ['Power', [
    ['Power Bank 10000mAh', 'powerbank', 'black', 29.00], ['Power Bank 20000mAh', 'powerbank', 'slate', 44.00], ['Slim Power Bank', 'powerbank', 'white', 24.00],
    ['Laptop Power Bank 100W', 'powerbank', 'red', 99.00], ['Power Strip 4-Outlet', 'powerstrip', 'white', 24.00], ['Surge Protector 6-Outlet', 'powerstrip', 'black', 34.00],
    ['AA Batteries 8-Pack', 'batteries', 'slate', 9.99], ['AAA Batteries 8-Pack', 'batteries', 'black', 9.99], ['USB Rechargeable Batteries', 'batteries', 'blue', 19.99], ['Desk Power Strip USB', 'powerstrip', 'slate', 39.00]]],
  ['Desk & bags', [
    ['Laptop Backpack', 'backpack', 'slate', 69.00], ['Commuter Backpack', 'backpack', 'black', 59.00], ['Mouse Pad', 'mousepad', 'slate', 9.99],
    ['Desk Mat XL', 'mousepad', 'black', 24.00], ['Desk Lamp USB', 'lamp', 'slate', 32.00], ['Cable Organizer Box', 'organizer', 'white', 19.00],
    ['Cable Ties 10-Pack', 'organizer', 'black', 7.99], ['Notebook A5', 'notebook', 'slate', 8.50], ['Notebook A5 – Red', 'notebook', 'red', 8.50], ['Backpack – Red', 'backpack', 'red', 64.00]]],
  ['Care & extras', [
    ['Screen Cleaning Kit', 'cleaning', 'white', 8.99], ['Screen Wipes 50-Pack', 'cleaning', 'blue', 6.99], ['Keyboard Cleaning Gel', 'cleaning', 'red', 7.99],
    ['Microfiber Cloth 3-Pack', 'cleaning', 'grey', 5.99], ['Stylus 3-Pack', 'stylus', 'slate', 9.99], ['Wrist Rest', 'mousepad', 'grey', 14.00],
    ['Earbud Tips Kit', 'earbuds', 'grey', 6.00], ['Cable Clips', 'organizer', 'slate', 6.50], ['Travel Pouch', 'sleeve', 'black', 14.00], ['Smartwatch Charger', 'watch', 'slate', 19.00]]]
];

const products = [];
let n = 0;
COLUMNS.forEach(([theme, items], ci) => {
  if (items.length !== 10) throw new Error(`Column ${ci + 1} (${theme}) has ${items.length} products, needs 10`);
  items.forEach(([name, type, color, price], si) => {
    if (!DRAW[type]) throw new Error('No drawing for ' + type);
    const file = `${type}-${color}.svg`;
    fs.writeFileSync(path.join(IMG_DIR, file), svg(type, color));
    n++;
    products.push({
      id: 'p' + n, name, image: 'img/products/' + file, price,
      column: ci + 1, slot: si + 1,
      alfie: (ci % 3) + 1,          // door / Alfie that serves this column (edit in Admin if your wiring differs)
      compartment: si + 1,          // latch number = shelf number
      category: theme, available: true
    });
  });
});

fs.writeFileSync(path.join(ROOT, 'demo-products.json'), JSON.stringify(products, null, 2) + '\n');
console.log(`${products.length} products, ${fs.readdirSync(IMG_DIR).length} images in public/img/products`);
