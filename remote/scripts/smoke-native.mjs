#!/usr/bin/env node
// Native-era smoke: drives the hosted endpoint with the official MCP SDK v2
// client, which negotiates the modern (2026-07-28+) era via server/discover —
// the path 2026-era clients take. Complements smoke-remote.mjs, whose raw
// `initialize` handshake belongs to the legacy era by definition and can only
// ever exercise the 2025-era stateless fallback.
//
// Usage: node scripts/smoke-native.mjs [endpointUrl]
//   default endpoint: http://localhost:3999/api/mcp
import assert from 'node:assert';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const ENDPOINT = process.argv[2] ?? 'http://localhost:3999/api/mcp';
const t0 = Date.now();
console.log(`smoke-native: endpoint = ${ENDPOINT}`);

// The v2 client's negotiation mode DEFAULTS to 'legacy' — the modern probe is
// opt-in. 'auto' probes server/discover first and falls back to initialize;
// the era assertion below turns a silent fallback into a loud failure.
const client = new Client(
  { name: 'page2ai-smoke-native', version: '1.0.0' },
  { versionNegotiation: { mode: 'auto' } },
);
await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT)));

const era = client.getProtocolEra();
const version = client.getNegotiatedProtocolVersion();
const server = client.getServerVersion();
console.log(`connect ok: server=${server?.name}@${server?.version} era=${era} protocol=${version}`);
assert.strictEqual(era, 'modern', `expected modern era (server/discover), got ${era}`);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
assert.ok(names.includes('page_to_markdown'), `tools/list missing page_to_markdown: ${names}`);
const tool = tools.find((t) => t.name === 'page_to_markdown');
assert.strictEqual(tool.annotations?.readOnlyHint, true, 'annotations.readOnlyHint lost in transit');
console.log(`tools/list ok: ${names.join(', ')} (readOnlyHint intact)`);

const call = await client.callTool({
  name: 'page_to_markdown',
  arguments: { url: 'https://example.com/', include_frontmatter: true },
});
assert.ok(!call.isError, `tools/call returned isError: ${JSON.stringify(call).slice(0, 400)}`);
const markdown = call.content?.find((c) => c.type === 'text')?.text ?? '';
assert.ok(markdown.includes('# Example Domain'), `markdown missing H1: ${markdown.slice(0, 200)}`);
const h1Count = (markdown.match(/^# /gm) ?? []).length;
assert.strictEqual(h1Count, 1, `expected exactly 1 H1, got ${h1Count}`);
console.log(`tools/call ok: ${markdown.length} chars, 1×H1`);

await client.close();
console.log(`SMOKE-NATIVE PASS in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
