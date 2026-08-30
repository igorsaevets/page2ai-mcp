// Cold-start E2E smoke test for the PUBLISHED package (not the local build):
// drives `npx -y page2ai-mcp@latest` over stdio JSON-RPC with a fresh npm cache,
// simulating a machine that has never installed it. Verifies the full new-user
// path: registry install → initialize → tools/list → a real conversion.
//
// Usage: node scripts/smoke-cold-npx.mjs [cache-dir]
//   cache-dir defaults to a fresh directory under the OS temp dir.
// Exit 0 = pass. First response waits up to 5 minutes for the cold install.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cacheDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'page2ai-smoke-'));
console.log('npm cache:', cacheDir);

const t0 = Date.now();
const child = spawn('npx -y page2ai-mcp@latest', {
  shell: true, // resolves npx.cmd on Windows
  env: { ...process.env, npm_config_cache: cacheDir },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const pending = new Map(); // id -> resolve
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
let stderrTail = '';
child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });

function rpc(id, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${timeoutMs}ms waiting for id=${id} (${method}); stderr tail:\n${stderrTail}`));
    }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

try {
  const init = await rpc(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke-cold-npx', version: '0.0.1' },
  }, 300_000);
  console.log(`[+${Date.now() - t0}ms] initialize:`, JSON.stringify(init.result?.serverInfo));

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = await rpc(2, 'tools/list', {}, 30_000);
  const names = tools.result?.tools?.map((t) => t.name) ?? [];
  console.log(`[+${Date.now() - t0}ms] tools:`, names.join(', '));
  if (!names.includes('page_to_markdown')) throw new Error('page_to_markdown missing from tools/list');

  const call = await rpc(3, 'tools/call', {
    name: 'page_to_markdown',
    arguments: { url: 'https://example.com/' },
  }, 120_000);
  const text = call.result?.content?.[0]?.text ?? '';
  const h1s = text.split('\n').filter((l) => /^# /.test(l));
  const ver = text.match(/extractor_version:\s*"([^"]+)"/)?.[1] ?? 'NOT FOUND';
  console.log(`[+${Date.now() - t0}ms] convert: ${text.length} chars, h1_count=${h1s.length}, core=${ver}`);
  if (h1s.length !== 1 || !text.includes('# Example Domain')) {
    throw new Error(`expected exactly one "# Example Domain" heading, got: ${JSON.stringify(h1s)}`);
  }
  console.log('SMOKE PASS');
} catch (e) {
  console.error('SMOKE FAIL:', e.message);
  process.exitCode = 1;
} finally {
  child.kill();
  setTimeout(() => process.exit(), 1500);
}
