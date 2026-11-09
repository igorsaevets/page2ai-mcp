# page2ai-mcp-remote — hosted variant (Vercel function and container)

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
author (on Vercel, and on a container host behind Cloudflare). The local variant never does that.

## Layout

- `api/mcp.ts` — the Vercel function: `createMcpHandler` (mcp-handler 2.x,
  stateless Streamable HTTP, no Redis) + in-code per-IP rate limiter.
- `server.mts` — the same handler as one long-lived Node process for a container (`Dockerfile`):
  `/api/mcp`, the static pages, `/healthz`; a 1 MB body cap; per-client and global rate limits and a
  cap on conversions running at once (`lib/limits.mts`, `tests/limits.test.mts`); a client that goes
  away aborts its page fetch; graceful shutdown on SIGTERM; one log line per request with the
  target's hostname only. Node 24 runs the TypeScript as is (`node server.mts`).
- `lib/platform-ranges.json` — the published egress ranges of OpenAI (ChatGPT connectors) and
  Anthropic (outbound, MCP tool calls), which get a larger per-IP bucket because many users share
  them; refresh with `node scripts/update-platform-ranges.mjs` before a deploy.
- `public/index.html` — human-readable landing + privacy note; full pages at
  `/privacy.html`, `/terms.html`, `/support.html`.
- `scripts/local-serve.mts` — runs the exact function on `localhost:3999`.
- `scripts/smoke-remote.mjs` — raw JSON-RPC smoke of the LEGACY era
  (`initialize`, negotiates 2025-11-25): tools/list → tools/call → asserts
  `# Example Domain`, exactly one H1.
- `scripts/smoke-native.mjs` — official SDK v2 client, MODERN era
  (`server/discover`, negotiates 2026-07-28; the client defaults to legacy —
  `versionNegotiation: { mode: 'auto' }` is what opts in).
- `scripts/verify-submission-cases.mjs` — the 5 positive + 3 negative
  directory-submission test cases, executed against a live endpoint.
- `SUBMISSION_OPENAI.md` — the OpenAI Plugins Directory submission pack.

## Develop / verify

```bash
cd remote
npm install
npm run typecheck
npx tsx scripts/local-serve.mts &   # terminal 1
node scripts/smoke-remote.mjs       # terminal 2, defaults to localhost
node scripts/smoke-remote.mjs https://page2ai.igorsaevets.com/api/mcp
```

Production endpoint: **https://page2ai.igorsaevets.com/api/mcp** (the container,
since 2026-11-09). The Vercel deployment, **https://page2ai-mcp-remote.vercel.app/api/mcp**
(since 2026-08-30), keeps answering while clients move: the ChatGPT plugin approved on
that origin cannot change its host, so it stays there until a plugin on the new host is
approved.

## Container

```bash
git archive --format=zip -o remote.zip <sha>:remote   # build from git, never from a working copy
docker build -t page2ai-remote .                      # in the unpacked folder
docker run --rm -p 3999:3000 -e PAGE2AI_EXTRA_BLOCKED_IPS=<host's public IP> page2ai-remote
node scripts/smoke-remote.mjs http://localhost:3999/api/mcp --slow-container
```

The image sets `PAGE2AI_ALLOWED_PORTS=80,443` (pages are fetched on the web ports only, every redirect
hop included), `PAGE2AI_MAX_TIMEOUT_MS=60000` (no 30 s platform stop here; the proxy in front reads
for 125 s) and `PAGE2AI_REQUIRE_BLOCKED_IPS=1`: the deployment must set `PAGE2AI_EXTRA_BLOCKED_IPS` to
the host's own public address (IPs or CIDR ranges, comma-separated; never in code or git), and the
server refuses to start until each rule is shown to be in effect on the real handler. Tunables, with
defaults: `PAGE2AI_RATE_PER_IP` 30, `PAGE2AI_RATE_PER_PLATFORM_IP` 120, `PAGE2AI_RATE_GLOBAL` 300 (per
minute), `PAGE2AI_RATE_IPV6_PREFIX` 64, `PAGE2AI_MAX_CONCURRENT` 4, `PAGE2AI_MAX_CONCURRENT_PER_CLIENT`
2, `PAGE2AI_MAX_BODY_BYTES` 1048576, `PAGE2AI_SHUTDOWN_GRACE_MS` 25000. The client address is read
from `X-Real-IP`, which the proxy in front sets; the Vercel function keeps its own limiter.

## Deploy (Vercel)

Deployed as a separate Vercel project (`page2ai-mcp-remote`) with root
directory `remote/`. `vercel.json` sets `maxDuration: 30` — the hosted variant
deliberately caps wall-clock below the tool's `timeout_ms` maximum (60 s). To
answer inside that window, `api/mcp.ts` clamps `timeout_ms` to 20 s, and a
clamped timeout says so in its error text; before that, a longer fetch was cut
by the platform mid-stream with no result at all. The default 15 s is
unaffected. `node scripts/smoke-remote.mjs <url> --slow` checks the clamp (about
20 s, uses httpbin.org). Abuse posture: platform WAF rate-limit rule (60 req/60 s per IP
→ deny on `/api/mcp`) + per-IP and per-instance limits in code (x-real-ip
keyed), private-range/metadata fetches blocked by the core SSRF guard, 10 MB
response cap, `cache-control: no-store` on API responses.
