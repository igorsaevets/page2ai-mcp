#!/usr/bin/env node
// Refreshes lib/platform-ranges.json: the published egress ranges of the AI platforms whose servers
// call this endpoint for many users at once (ChatGPT, Claude). The Node server (server.mts) gives
// those addresses a larger rate-limit bucket. Run before a deploy: node scripts/update-platform-ranges.mjs
//
// Sources (official):
// - OpenAI, "IP egress ranges": ChatGPT integrations (plugins, connectors, GPT Actions) call from the
//   ranges in https://openai.com/chatgpt-connectors.json, which "can change as OpenAI infrastructure
//   changes" (https://developers.openai.com/api/docs/guides/ip-addresses).
// - Anthropic, "IP addresses", section "Outbound IP addresses" ("when making MCP tool calls to
//   external servers"): https://platform.claude.com/docs/en/api/ip-addresses
import { writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';

const OPENAI_URL = 'https://openai.com/chatgpt-connectors.json';
const ANTHROPIC_URL = 'https://platform.claude.com/docs/en/api/ip-addresses.md';
const OUT = new URL('../lib/platform-ranges.json', import.meta.url);

const get = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'page2ai-mcp-remote (+https://github.com/igorsaevets/page2ai-mcp)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
};

const cidrOk = (cidr) => {
  const [addr, bits] = cidr.split('/');
  const family = isIP(addr);
  return family !== 0 && /^\d{1,3}$/.test(bits ?? '') && Number(bits) <= (family === 4 ? 32 : 128);
};

const openai = JSON.parse(await get(OPENAI_URL));
const openaiRanges = openai.prefixes.map((p) => p.ipv4Prefix ?? p.ipv6Prefix).filter(Boolean);

const anthropicPage = await get(ANTHROPIC_URL);
const outbound = anthropicPage.split(/^## Outbound IP addresses/m)[1]?.split(/^### Phased out/m)[0] ?? '';
const anthropicRanges = [...outbound.matchAll(/`([0-9a-f.:]+\/\d{1,3})`/gi)].map((m) => m[1]);

for (const [name, list] of [['openai', openaiRanges], ['anthropic', anthropicRanges]]) {
  if (list.length === 0) throw new Error(`${name}: no ranges found; the source changed its shape`);
  const bad = list.filter((c) => !cidrOk(c));
  if (bad.length) throw new Error(`${name}: not CIDR: ${bad.join(', ')}`);
}

const data = {
  fetched: new Date().toISOString().slice(0, 10),
  sources: {
    openai: { url: OPENAI_URL, creationTime: openai.creationTime, doc: 'https://developers.openai.com/api/docs/guides/ip-addresses' },
    anthropic: { url: 'https://platform.claude.com/docs/en/api/ip-addresses', section: 'Outbound IP addresses' },
  },
  openai: openaiRanges,
  anthropic: anthropicRanges,
};
await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');
console.log(`openai ${openaiRanges.length} ranges (creationTime ${openai.creationTime}), anthropic ${anthropicRanges.length}: ${anthropicRanges.join(' ')}`);
