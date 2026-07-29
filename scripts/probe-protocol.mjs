// Raw JSON-RPC stdio probe. Deliberately does NOT use the MCP client SDK, so the
// evidence is independent of the library under test: it writes bytes, reads bytes.
//
//   node probe.mjs <command> [args...]
//
// The era is pinned per CONNECTION by the opening message, so each arm gets its
// own process:
//   ARM 1  server/discover WITH the 2026-07-28 version claim in _meta
//   ARM 2  server/discover WITHOUT a claim  (spec: a claim-less message is a 2025 opening)
//   ARM 3  initialize      — the 2025-11-25 handshake, proving the legacy era still serves
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const [cmd, ...args] = argv;

if (!cmd) {
  console.error(
    'usage: node scripts/probe-protocol.mjs <command> [args...]\n\n' +
      'examples:\n' +
      '  node scripts/probe-protocol.mjs node dist/index.js\n' +
      '  node scripts/probe-protocol.mjs npx -y page2ai-mcp@0.1.2   # control arm: the previous release\n',
  );
  process.exit(2);
}

const PV = 'io.modelcontextprotocol/protocolVersion';
const CC = 'io.modelcontextprotocol/clientCapabilities';
const CI = 'io.modelcontextprotocol/clientInfo';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// On Windows npx/npm/pnpm/yarn are .cmd shims. spawn() cannot exec them directly (ENOENT),
// and since the CVE-2024-27980 mitigation Node refuses `.cmd` outright (EINVAL) -- so the
// shell is genuinely required there. Without this every arm dies before the server starts
// and reports "NO RESPONSE", which is indistinguishable from a server that ran and stayed
// silent. That false negative reads exactly like a finding; it is the control arm measuring
// nothing at all.
//
// The command goes through as ONE string with no separate args array, because passing args
// *alongside* shell:true is what triggers DEP0190.
const WIN = process.platform === 'win32';
const spawnProbe = () =>
  WIN
    ? spawn([cmd, ...args].join(' '), { stdio: ['pipe', 'pipe', 'pipe'], shell: true })
    : spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

async function ask(request, label) {
  const child = spawnProbe();
  const seen = [];
  const stderr = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) {
        try {
          seen.push(JSON.parse(line));
        } catch {
          /* non-JSON line on stdout is itself a finding; ignored here */
        }
      }
    }
  });
  child.stderr.on('data', (d) => stderr.push(d.toString()));
  child.on('error', (e) => stderr.push(`spawn error: ${e.message}`));

  // Wait for the server to actually be listening rather than for a fixed delay. A cold
  // `npx` downloads the package first, which blew past a flat 1200ms and made every arm
  // report NO RESPONSE -- a timing artifact that reads as "the old version ignores the
  // request". Poll for the readiness banner on stderr, with a generous ceiling.
  const READY_MS = 30_000;
  for (let waited = 0; waited < READY_MS; waited += 100) {
    if (stderr.join('').includes('ready on stdio')) break;
    await wait(100);
  }
  await wait(300);

  child.stdin.write(JSON.stringify(request) + '\n');
  await wait(2500);
  child.kill();
  await wait(120);

  const r = seen.find((m) => m.id === request.id);
  let verdict;
  if (!r) verdict = 'NO RESPONSE';
  else if (r.error) verdict = `ERROR ${r.error.code} ${r.error.message}`;
  else verdict = 'OK';

  console.log(`\n### ${label}`);
  console.log(`    verdict: ${verdict}`);
  if (r?.result) {
    const keys = Object.keys(r.result);
    console.log(`    result keys: ${keys.join(', ')}`);
    for (const k of ['protocolVersions', 'protocolVersion', 'serverInfo', 'capabilities', 'resultType']) {
      if (r.result[k] !== undefined) console.log(`    ${k}: ${JSON.stringify(r.result[k])}`);
    }
    if (r.result._meta) console.log(`    _meta: ${JSON.stringify(r.result._meta)}`);
  }
  const err = stderr.join('').trim();
  if (err) console.log(`    stderr: ${err.split('\n')[0]}`);
  return verdict;
}

const modern = {
  jsonrpc: '2.0',
  id: 1,
  method: 'server/discover',
  params: {
    _meta: {
      [PV]: '2026-07-28',
      [CC]: {},
      [CI]: { name: 'raw-probe', version: '0.0.0' },
    },
  },
};

const claimless = { jsonrpc: '2.0', id: 2, method: 'server/discover', params: {} };

const legacy = {
  jsonrpc: '2.0',
  id: 3,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'raw-probe', version: '0.0.0' },
  },
};

console.log(`=== probing: ${argv.join(' ')} ===`);
const a = await ask(modern, 'ARM 1  server/discover WITH 2026-07-28 claim');
const b = await ask(claimless, 'ARM 2  server/discover, claim-less');
const c = await ask(legacy, 'ARM 3  initialize (2025-11-25)');
console.log(`\nSUMMARY  modern=${a}  claimless=${b}  legacy=${c}`);
