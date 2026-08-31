# page2ai-mcp-remote — hosted variant (Vercel)

Hosted (Streamable HTTP) deployment of the Page2AI MCP server. Same tool
implementation as the local stdio server — `api/mcp.ts` imports
`handlePageToMarkdown` from the published `@page2ai/mcp` package, so the hosted
endpoint inherits the SSRF guard, the 10 MB size cap, timeout enforcement and
error mapping from one source of truth.

## Why a hosted variant exists

Some directories (OpenAI Plugins Directory, Smithery remote listings) only
accept MCP servers reachable at a public HTTPS URL. Local-first remains the
recommended way to run Page2AI: `npx -y page2ai-mcp` keeps everything on your
machine with zero egress to any third party.

**Privacy difference, stated plainly:** URLs sent to the hosted endpoint are
fetched *from this server*, so they transit infrastructure operated by the
author (on Vercel). The local variant never does that.

## Layout

- `api/mcp.ts` — the Vercel function: `createMcpHandler` (mcp-handler 2.x,
  stateless Streamable HTTP, no Redis) + in-code per-IP rate limiter.
- `public/index.html` — human-readable landing + privacy note.
- `scripts/local-serve.mts` — runs the exact function on `localhost:3999`.
- `scripts/smoke-remote.mjs` — raw JSON-RPC smoke: initialize → tools/list →
  tools/call → asserts `# Example Domain`, exactly one H1.

## Develop / verify

```bash
cd remote
npm install
npm run typecheck
npx tsx scripts/local-serve.mts &   # terminal 1
node scripts/smoke-remote.mjs       # terminal 2, defaults to localhost
node scripts/smoke-remote.mjs https://page2ai-mcp-remote.vercel.app/api/mcp
```

Production endpoint: **https://page2ai-mcp-remote.vercel.app/api/mcp**
(deployed 2026-08-30; smoke passes in ~1 s).

## Deploy

Deployed as a separate Vercel project (`page2ai-mcp-remote`) with root
directory `remote/`. `vercel.json` sets `maxDuration: 30` — the hosted variant
deliberately caps wall-clock below the tool's `timeout_ms` maximum (60 s), so
requests asking for >25 s fetches may be cut by the platform; the default 15 s
is unaffected. Abuse posture: platform WAF rate-limit rule (60 req/60 s per IP
→ deny on `/api/mcp`) + per-IP and per-instance limits in code (x-real-ip
keyed), private-range/metadata fetches blocked by the core SSRF guard, 10 MB
response cap, `cache-control: no-store` on API responses.
