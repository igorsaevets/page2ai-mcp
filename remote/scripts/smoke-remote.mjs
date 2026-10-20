#!/usr/bin/env node
// Smoke test for the hosted (Streamable HTTP) Page2AI MCP endpoint.
// Speaks raw JSON-RPC over fetch — no SDK dependency — so it verifies the wire
// format an arbitrary client sees, not what our own libraries would negotiate.
//
// Usage: node scripts/smoke-remote.mjs [endpointUrl] [--slow]
//   default endpoint: http://localhost:3999/api/mcp
//   --slow: also check the hosted timeout clamp (about 20 s more, uses httpbin.org)
import assert from 'node:assert';

const cliArgs = process.argv.slice(2);
const SLOW = cliArgs.includes('--slow');
const ENDPOINT = cliArgs.find((a) => !a.startsWith('--')) ?? 'http://localhost:3999/api/mcp';
const CLIENT_PROTOCOL = '2026-07-28';

let sessionId = null;
let protocolVersion = CLIENT_PROTOCOL;
let initialized = false;
let nextId = 1;

function baseHeaders() {
  const h = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  // Per spec the MCP-Protocol-Version header belongs on requests AFTER the
  // handshake; sending it alongside `initialize` is rejected as a mismatch.
  if (initialized) h['mcp-protocol-version'] = protocolVersion;
  if (sessionId) h['mcp-session-id'] = sessionId;
  return h;
}

// Streamable HTTP responds either application/json or a text/event-stream
// whose data: lines carry the JSON-RPC messages. Accept both.
function parseRpcText(text, contentType, expectId) {
  if (contentType.includes('application/json')) {
    return text ? JSON.parse(text) : null;
  }
  if (contentType.includes('text/event-stream')) {
    const messages = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .map((payload) => JSON.parse(payload));
    return messages.find((m) => m.id === expectId) ?? messages.at(-1) ?? null;
  }
  throw new Error(`Unexpected content-type "${contentType}": ${text.slice(0, 300)}`);
}

async function rpc(method, params, { notification = false } = {}) {
  const body = notification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: nextId++, method, params };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify(body),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (notification) {
    // 202 Accepted is the spec answer for notifications; some servers use 200/204.
    assert.ok(res.status < 400, `${method}: HTTP ${res.status}`);
    return null;
  }
  const raw = await res.text();
  if (res.status >= 400) {
    throw new Error(`${method}: HTTP ${res.status} ${raw.slice(0, 300)}`);
  }
  const message = parseRpcText(raw, res.headers.get('content-type') ?? '', body.id);
  assert.ok(message, `${method}: empty response`);
  if (message.error) {
    throw new Error(`${method}: JSON-RPC error ${message.error.code}: ${message.error.message}`);
  }
  return message.result;
}

const t0 = Date.now();
console.log(`smoke-remote: endpoint = ${ENDPOINT}`);

// 1. initialize
const init = await rpc('initialize', {
  protocolVersion: CLIENT_PROTOCOL,
  capabilities: {},
  clientInfo: { name: 'page2ai-smoke-remote', version: '1.0.0' },
});
protocolVersion = init.protocolVersion;
initialized = true;
console.log(
  `initialize ok: server=${init.serverInfo?.name}@${init.serverInfo?.version} protocol=${init.protocolVersion} session=${sessionId ?? '(stateless)'}`,
);

// 2. notifications/initialized
await rpc('notifications/initialized', undefined, { notification: true });

// 3. tools/list
const tools = await rpc('tools/list', {});
const names = (tools.tools ?? []).map((t) => t.name);
assert.ok(names.includes('page_to_markdown'), `tools/list missing page_to_markdown: ${names}`);
console.log(`tools/list ok: ${names.join(', ')}`);

// 4. tools/call on a stable public page
const call = await rpc('tools/call', {
  name: 'page_to_markdown',
  arguments: { url: 'https://example.com/', include_frontmatter: true },
});
assert.ok(!call.isError, `tools/call returned isError: ${JSON.stringify(call).slice(0, 400)}`);
const markdown = call.content?.find((c) => c.type === 'text')?.text ?? '';
assert.ok(markdown.includes('# Example Domain'), `markdown missing H1: ${markdown.slice(0, 200)}`);
const h1Count = (markdown.match(/^# /gm) ?? []).length;
assert.strictEqual(h1Count, 1, `expected exactly 1 H1, got ${h1Count}`);
console.log(`tools/call ok: ${markdown.length} chars, 1×H1`);

// 5. --slow: a page whose headers arrive after 40 s, asked for with the schema's maximum
//    timeout. The hosted variant must answer with its own clamped timeout error before the
//    platform's 30 s stop; without the clamp the stream ended with no response (P2A-023).
if (SLOW) {
  const slowStart = Date.now();
  const slow = await rpc('tools/call', {
    name: 'page_to_markdown',
    arguments: {
      url: 'https://httpbin.org/drip?delay=40&duration=0&numbytes=1&code=200',
      timeout_ms: 60000,
    },
  });
  const slowText = slow.content?.find((c) => c.type === 'text')?.text ?? '';
  const slowSecs = (Date.now() - slowStart) / 1000;
  assert.ok(slow.isError, `slow call: expected isError, got ${slowText.slice(0, 200)}`);
  assert.ok(slowText.startsWith('Fetch timed out after 20000ms'), `slow call: ${slowText.slice(0, 200)}`);
  assert.ok(
    slowText.includes('caps timeout_ms at 20000 (60000 was requested)'),
    `slow call: no cap note: ${slowText.slice(0, 300)}`,
  );
  assert.ok(slowSecs < 28, `slow call took ${slowSecs.toFixed(1)}s, too close to the 30 s stop`);
  console.log(`tools/call --slow ok: clamped timeout answered in ${slowSecs.toFixed(1)}s`);
}

console.log(`SMOKE PASS in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
