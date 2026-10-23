#!/usr/bin/env node
// Asserts that the server exits once its client closes stdin, the MCP spec's first
// shutdown step. Since 0.5.0 the Agent Bridge's listening socket kept the process
// alive after that, holding port 3025 against the client's next instance (0.5.2:
// still running 6 s after stdin closed).
//
//   node scripts/stdin-exit.mjs dist/index.js     # exit 1 unless it exits within 5 s
import { spawn } from 'node:child_process';

const entry = process.argv[2];
if (!entry) {
  process.stderr.write('usage: node scripts/stdin-exit.mjs <server entry, e.g. dist/index.js>\n');
  process.exit(2);
}

// A port of its own, so a server already running on this machine cannot mask the result.
const child = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PAGE2AI_BRIDGE_PORT: '13998' },
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
setTimeout(() => {
  closedAt = Date.now();
  child.stdin.end();
}, 1500);

child.on('exit', (code) => {
  const answered = out.includes('"result"');
  const bridgeUp = err.includes('bridge listening');
  if (!closedAt || !answered || !bridgeUp) {
    console.log(`FAIL: exited before the check could run (code ${code}, initialize answered ${answered}, bridge up ${bridgeUp})`);
    process.exit(1);
  }
  console.log(`OK: exited (code ${code}) ${Date.now() - closedAt} ms after stdin closed, with the bridge listening`);
  process.exit(0);
});

setTimeout(() => {
  console.log('FAIL: still running 5 s after stdin closed');
  child.kill('SIGKILL');
  process.exit(1);
}, 6500);
