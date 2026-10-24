#!/usr/bin/env node
// Asserts that the server exits once its client closes stdin, the MCP spec's first
// shutdown step. Since 0.5.0 the Agent Bridge's listening socket kept the process
// alive after that, holding port 3025 against the client's next instance (0.5.2:
// still running 6 s after stdin closed).
//
// A client is connected when stdin closes, and it never answers the close handshake (a
// hung extension, a program holding the slot): 0.5.3 waited ws's 30 s for it. Since
// 0.6.0 the client pairs with the key first (page2ai-bridge/2), so it holds the slot.
//
//   node scripts/stdin-exit.mjs dist/index.js     # exit 1 unless it exits within 5 s
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import net from 'node:net';

const PORT = 13998;
const KEY = randomBytes(32);
const keyId = createHash('sha256').update(KEY).digest('hex').slice(0, 16);
const hmac = (text) => createHmac('sha256', KEY).update(text).digest('hex');

// One masked text frame (a client must mask).
const frame = (obj) => {
  const payload = Buffer.from(JSON.stringify(obj));
  const mask = randomBytes(4);
  const head = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([head, mask, payload.map((b, i) => b ^ mask[i % 4])]);
};

// Server frames are unmasked; the ones here are under 64 KB.
const readFrames = (buf) => {
  const out = [];
  let i = 0;
  while (buf.length - i >= 2) {
    let len = buf[i + 1] & 0x7f;
    let at = i + 2;
    if (len === 126) {
      if (buf.length - i < 4) break;
      len = buf.readUInt16BE(i + 2);
      at = i + 4;
    }
    if (buf.length < at + len) break;
    out.push(JSON.parse(buf.subarray(at, at + len).toString()));
    i = at + len;
  }
  return { messages: out, rest: buf.subarray(i) };
};

// Upgrades as Page2AI, pairs with the key, then never reads again.
const silentClient = () => new Promise((resolve, reject) => {
  const nonceE = randomBytes(32).toString('hex');
  let buf = Buffer.alloc(0);
  let upgraded = false;
  const socket = net.connect(PORT, '127.0.0.1', () => {
    socket.write([
      'GET / HTTP/1.1', `Host: 127.0.0.1:${PORT}`, 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Version: 13',
      'Origin: chrome-extension://dlpaaijcnbbmlfeohlphjpnbbcnomnno', '', '',
    ].join('\r\n'));
  });
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const status = buf.subarray(0, end).toString().split('\r\n')[0];
      if (!status.startsWith('HTTP/1.1 101')) {
        reject(new Error(`no upgrade: ${status}`));
        return;
      }
      upgraded = true;
      buf = buf.subarray(end + 4);
      socket.write(frame({
        type: 'hello', protocol: 'page2ai-bridge/2', extensionId: 'stdin-exit', extensionVersion: '0', keyId, nonceE,
      }));
    }
    const { messages, rest } = readFrames(buf);
    buf = rest;
    for (const msg of messages) {
      if (msg.type === 'challenge') {
        socket.write(frame({ type: 'auth', proof: hmac(`page2ai-bridge/2|client|${PORT}|${msg.nonceS}|${nonceE}`) }));
      } else if (msg.type === 'welcome') {
        socket.pause();
        resolve(socket);
      } else {
        reject(new Error(`unexpected ${JSON.stringify(msg)}`));
      }
    }
  });
  socket.on('error', reject);
});

const entry = process.argv[2];
if (!entry) {
  process.stderr.write('usage: node scripts/stdin-exit.mjs <server entry, e.g. dist/index.js>\n');
  process.exit(2);
}

// A port of its own, so a server already running on this machine cannot mask the result.
const child = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PAGE2AI_BRIDGE_PORT: String(PORT), PAGE2AI_BRIDGE_KEY: KEY.toString('base64url') },
});
let out = '';
let err = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { err += d; });

child.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdin-exit', version: '0' } },
}) + '\n');

let closedAt = 0;
let clientUp = false;
setTimeout(() => {
  silentClient().then(
    () => { clientUp = true; },
    (e) => { console.log(`FAIL: the silent client could not connect: ${e.message}`); child.kill('SIGKILL'); process.exit(1); },
  ).finally(() => setTimeout(() => {
    closedAt = Date.now();
    child.stdin.end();
  }, 300));
}, 1500);

child.on('exit', (code) => {
  const answered = out.includes('"result"');
  const bridgeUp = err.includes('bridge listening');
  clientUp = clientUp && err.includes('bridge: extension connected');
  if (!closedAt || !answered || !bridgeUp || !clientUp) {
    console.log(`FAIL: exited before the check could run (code ${code}, initialize answered ${answered}, bridge up ${bridgeUp}, client connected ${clientUp})`);
    process.exit(1);
  }
  console.log(`OK: exited (code ${code}) ${Date.now() - closedAt} ms after stdin closed, with the bridge listening and a client that never answers`);
  process.exit(0);
});

setTimeout(() => {
  console.log('FAIL: still running 5 s after stdin closed');
  child.kill('SIGKILL');
  process.exit(1);
}, 6500);
