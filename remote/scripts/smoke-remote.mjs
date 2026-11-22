#!/usr/bin/env node
// Smoke test for the hosted (Streamable HTTP) Page2AI MCP endpoint.
// Speaks raw JSON-RPC over fetch — no SDK dependency — so it verifies the wire
// format an arbitrary client sees, not what our own libraries would negotiate.
//
// Usage: node scripts/smoke-remote.mjs [endpointUrl] [--slow | --slow-container=<url of a page answering after 40-55 s>]
//   default endpoint: http://localhost:3999/api/mcp
//   --slow: also check the hosted timeout clamp (about 20 s more, uses httpbin.org)
import assert from 'node:assert';

const cliArgs = process.argv.slice(2);
const SLOW = cliArgs.includes('--slow');
const SLOW_CONTAINER = cliArgs.some((a) => a === '--slow-container' || a.startsWith('--slow-container='));
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

// 3b. the ChatGPT plugin runs whatever this endpoint lists: it must stay the reviewed
// contract plus `query` (mcp 0.10.1, 2026-11-03: description sha256 2b2d5ad05e9e, 996 chars;
// url, query and three options; was 783d1e41f68e / 898 without query), minus the sentence naming
// a browser tool and plus `annotations.title` (2026-11-22, the Claude directory's connector
// review: 777959437edc, 953 chars; api/mcp.ts). An endpoint built from a tree before that change
// (Vercel while main is frozen) still lists 2b2d5ad05e9e: --reviewed-2026-11-03 accepts that copy.
const ptm = tools.tools.find((t) => t.name === 'page_to_markdown');
const { createHash } = await import('node:crypto');
const descSha = createHash('sha256').update(ptm.description, 'utf8').digest('hex').slice(0, 12);
const OLD_COPY = cliArgs.includes('--reviewed-2026-11-03');
assert.deepStrictEqual([descSha, ptm.description.length], OLD_COPY ? ['2b2d5ad05e9e', 996] : ['777959437edc', 953],
  'description differs from the reviewed copy');
assert.deepStrictEqual(Object.keys(ptm.inputSchema.properties ?? {}),
  ['url', 'query', 'include_images', 'include_frontmatter', 'timeout_ms'], 'input properties differ from the reviewed contract');
assert.deepStrictEqual(ptm.inputSchema.required, ['url'], 'url must stay required');
// The whole emitted schema too: a zod or SDK update in this lock can change it ($schema,
// formats, defaults) with the keys intact. Pinned from production on 2026-11-09 (mcp 0.10.1 + query;
// 72f90bf32a4d from 2026-10-23 before it).
const schemaSha = createHash('sha256').update(JSON.stringify(ptm.inputSchema), 'utf8').digest('hex').slice(0, 12);
assert.strictEqual(schemaSha, 'c8edc8eb6b04', 'inputSchema JSON differs from the copy pinned on 2026-11-09');
assert.strictEqual(ptm.title, 'Convert Page to Markdown', 'title differs');
assert.deepStrictEqual(ptm.annotations,
  { ...(OLD_COPY ? {} : { title: 'Convert Page to Markdown' }), readOnlyHint: true, openWorldHint: true, idempotentHint: false, destructiveHint: false },
  'annotations differ');
console.log(`tools/list contract ok: description ${descSha}, inputSchema ${schemaSha}, properties ${Object.keys(ptm.inputSchema.properties).join(', ')}`);
// 3c. the site icon: Claude shows the favicon of the connector's URL as its icon (2026-11-22).
const iconOrigin = new URL(ENDPOINT).origin;
const localNoStatic = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(ENDPOINT).hostname)
  && (await fetch(iconOrigin + '/').catch(() => ({ status: 0 }))).status !== 200;
if (localNoStatic) console.log('site icon skipped: this local server has no static files (scripts/local-serve.mts)');
if (!OLD_COPY && !localNoStatic) {
  const origin = iconOrigin;
  for (const [path, type] of [['/favicon.ico', /^image\/(x-icon|vnd\.microsoft\.icon)/], ['/favicon.svg', /^image\/svg\+xml/],
    ['/icon-192.png', /^image\/png/], ['/apple-touch-icon.png', /^image\/png/]]) {
    const r = await fetch(origin + path);
    const body = Buffer.from(await r.arrayBuffer());
    assert.ok(r.status === 200 && type.test(r.headers.get('content-type') ?? '') && body.length > 300,
      `${path}: ${r.status} ${r.headers.get('content-type')} ${body.length} B`);
  }
  const home = await (await fetch(origin + '/')).text();
  assert.ok(home.includes('<link rel="icon" href="/favicon.ico"'), 'the home page does not link the favicon');
  console.log('site icon ok: favicon.ico, favicon.svg, icon-192.png, apple-touch-icon.png, linked from /');
}
const htmlOnly = await rpc('tools/call', { name: 'page_to_markdown', arguments: { html: '<p>x</p>' } }).catch((e) => ({ thrown: String(e) }));
assert.ok(htmlOnly.thrown || htmlOnly.isError === true, `html without url must be refused here: ${JSON.stringify(htmlOnly).slice(0, 200)}`);
console.log('html without url refused ok');
// With a url, 0.1.2 stripped the html and fetched the url: a silent swap of the content.
const htmlAndUrl = await rpc('tools/call', { name: 'page_to_markdown', arguments: { url: 'https://example.com/', html: '<p>x</p>' } }).catch((e) => ({ thrown: String(e) }));
assert.ok(htmlAndUrl.thrown || (htmlAndUrl.isError === true && JSON.stringify(htmlAndUrl).includes('takes `url` only')),
  `html with url must be refused here, not dropped: ${JSON.stringify(htmlAndUrl).slice(0, 200)}`);
console.log('html with url refused ok');

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

// 5b. --slow-container=<url>: the container has no 30 s stop and no clamp. A page that answers
//     after 40-55 s must come back as a whole JSON-RPC result (the page, or an error from the tool
//     itself), never a stream cut by a proxy in front (Cloudflare reads for 125 s). Give the URL of
//     such a page: httpbin.org answers 400 above 10 s since 2026-11, while https://httpbin.dev/delay/50
//     and https://httpbun.com/delay/50 held 50 s on 2026-11-09 (JSON, so the result is the tool's own
//     content-type error, which still proves the stream was not cut); a slow HTML page of your own
//     behind a temporary tunnel also proves the content arrives whole.
if (SLOW_CONTAINER) {
  const slowUrl = cliArgs.find((a) => a.startsWith('--slow-container='))?.slice('--slow-container='.length);
  if (!slowUrl) {
    console.log('tools/call --slow-container skipped: pass --slow-container=<url of a page that answers after 40-55 s>');
  } else {
    const slowStart = Date.now();
    const slow = await rpc('tools/call', {
      name: 'page_to_markdown',
      arguments: { url: slowUrl, timeout_ms: 60000 },
    });
    const slowText = slow.content?.find((c) => c.type === 'text')?.text ?? '';
    const slowSecs = (Date.now() - slowStart) / 1000;
    assert.ok(!slowText.includes('caps timeout_ms'), `slow call was clamped: ${slowText.slice(0, 300)}`);
    assert.ok(slowSecs > 35, `slow call answered in ${slowSecs.toFixed(1)}s: the page was not waited for`);
    console.log(`tools/call --slow-container ok: unclamped, whole result after ${slowSecs.toFixed(1)}s (isError=${slow.isError === true}): ${slowText.slice(0, 90)}`);
  }
}

console.log(`SMOKE PASS in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
