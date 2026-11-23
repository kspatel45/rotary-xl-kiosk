// Linux serial bridge for the Rotary Kiosk server (one process per port).
// Same line protocol as serial-bridge.ps1 on Windows, so server.js treats both alike:
//   stdout:  OPEN | D <hex-hex-…> | S <bytes written> | ERR <message> | CLOSED
//   stdin :  W <hex-hex-…>  (write)   |   Q  (close and exit)
// Usage: node serial-bridge-linux.js <device> <baud>
// The user running the kiosk must be in the "dialout" group (see linux/install-lubuntu.sh).
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

const [dev, baud = '9600'] = process.argv.slice(2);
const say = s => { try { process.stdout.write(s + '\n'); } catch { } };
const hex = b => Array.from(b, x => x.toString(16).toUpperCase().padStart(2, '0')).join('-');

let fd;
try {
  if (!/^\/dev\/(tty(USB|ACM|S)\d+|serial\/by-id\/[\w.:+-]+)$/.test(dev || '')) throw new Error('Invalid serial device ' + dev);
  if (!fs.existsSync(dev)) throw Object.assign(new Error(dev + ' does not exist'), { code: 'ENOENT' });
  fd = fs.openSync(dev, fs.constants.O_RDWR | fs.constants.O_NOCTTY);
  // raw 8N1, no flow control; opening the port raises DTR, which resets the Arduino Mega (same as on Windows)
  execFileSync('stty', ['-F', dev, String(parseInt(baud, 10) || 9600), 'raw', '-echo', '-echoe', '-echok', '-ixon', '-ixoff', '-crtscts',
    'clocal', 'cread', 'cs8', '-cstopb', '-parenb', 'min', '1', 'time', '0'], { timeout: 5000 });
} catch (e) {
  const msg = e.code === 'EACCES' ? `Access denied to ${dev}: add this user to the "dialout" group and log in again`
    : e.code === 'EBUSY' ? `${dev} is already open in another program`
      : e.code === 'ENOENT' ? `${dev} does not exist (not plugged in?)` : String(e.message || e).split('\n')[0];
  say('ERR ' + msg); process.exit(1);
}
say('OPEN');

// reader: blocking reads on the tty run in libuv's thread pool
const buf = Buffer.alloc(4096);
let closing = false;
(function readLoop() {
  fs.read(fd, buf, 0, buf.length, null, (err, n) => {
    if (closing) return;
    if (err) { if (err.code === 'EAGAIN') return setTimeout(readLoop, 5); say('ERR ' + err.message); return quit(); }
    if (n > 0) say('D ' + hex(buf.subarray(0, n)));
    else return setTimeout(readLoop, 5);
    readLoop();
  });
})();

let inBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  inBuf += d; let i;
  while ((i = inBuf.indexOf('\n')) >= 0) {
    const line = inBuf.slice(0, i).trim(); inBuf = inBuf.slice(i + 1);
    if (line === 'Q') return quit();
    if (line.startsWith('W ')) {
      const bytes = Buffer.from(line.slice(2).trim().split(/[- ]/).filter(Boolean).map(h => parseInt(h, 16)));
      try { fs.writeSync(fd, bytes); say('S ' + bytes.length); } catch (e) { say('ERR ' + e.message); quit(); }
    }
  }
});
process.stdin.on('end', quit);
// USB unplugged
setInterval(() => { if (!fs.existsSync(dev)) { say(`ERR ${dev} was disconnected`); quit(); } }, 1000);

function quit() {
  if (closing) return; closing = true;
  try { fs.closeSync(fd); } catch { }
  say('CLOSED');
  setTimeout(() => process.exit(0), 50);
}
