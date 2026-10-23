#!/usr/bin/env node
// Asserts that the server exits once its client closes stdin, the MCP spec's first
// shutdown step. Since 0.5.0 the Agent Bridge's listening socket kept the process
// alive after that, holding port 3025 against the client's next instance (0.5.2:
// still running 6 s after stdin closed).
//
// A client is connected when stdin closes, and it never answers the close handshake (a
// hung extension, a program holding the slot): 0.5.3 waited ws's 30 s for it.
//
//   node scripts/stdin-exit.mjs dist/index.js     # exit 1 unless it exits within 5 s
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

const PORT = 13998;

// Upgrades as Page2AI, says hello, then never reads again.
const silentClient = () => new Promise((resolve, reject) => {
  const socket = net.connect(PORT, '127.0.0.1', () => {
    socket.write([
      'GET / HTTP/1.1', `Host: 127.0.0.1:${PORT}`, 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Version: 13',
      'Origin: chrome-extension://dlpaaijcnbbmlfeohlphjpnbbcnomnno', '', '',
    ].join('\r\n'));
  });
  socket.once('data', (head) => {
    if (!String(head).startsWith('HTTP/1.1 101')) {
      reject(new Error(`no upgrade: ${String(head).split('\r\n')[0]}`));
      return;
    }
    const hello = Buffer.from(JSON.stringify({
      type: 'hello', protocol: 'page2ai-bridge/1', extensionId: 'stdin-exit', extensionVersion: '0',
    }));
    const mask = randomBytes(4);
    // One masked text frame (a client must mask); the payload is under 126 bytes.
    socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | hello.length]), mask, hello.map((b, i) => b ^ mask[i % 4])]));
    socket.pause();
    resolve(socket);
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
  env: { ...process.env, PAGE2AI_BRIDGE_PORT: String(PORT) },
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
