# @page2ai/mcp — Web to Markdown for LLM Context

[![npm version](https://img.shields.io/npm/v/%40page2ai%2Fmcp)](https://www.npmjs.com/package/@page2ai/mcp)
[![CI](https://github.com/igorsaevets/page2ai-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/igorsaevets/page2ai-mcp/actions/workflows/ci.yml)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.igorsaevets%2Fpage2ai--mcp-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.igorsaevets/page2ai-mcp)
[![license MIT](https://img.shields.io/npm/l/%40page2ai%2Fmcp)](./LICENSE)

<sub>No downloads badge on purpose: npm download counts are dominated by registry mirrors and
bots, and this README only shows numbers a human can trust.</sub>

> One-click webpage-to-Markdown MCP server for ChatGPT, Claude, and Gemini.
> Preserves code blocks with language hints, tables, and reading structure.
> Fetch, extract, convert — one tool, one command, entirely on your machine.
> No API key, no account, no telemetry; the only network requests are to the URLs you pass it.

Companion to the [Page2AI Chrome & Firefox extensions](https://github.com/igorsaevets/page2ai-extension),
which convert the live page in your own browser with their own pipeline. This server is built on
[`@page2ai/core`](https://npmjs.com/package/@page2ai/core).

## Quick start

```bash
npx -y page2ai-mcp
```

This starts the stdio MCP server — it waits silently for a client, so wire it into one of
the clients below rather than running it bare. Requires **Node.js 20+**. No API key. If
`npx` ever serves you a stale cached version, run `npx -y page2ai-mcp@latest` once.

**Updating.** `npx -y page2ai-mcp` asks npm for the newest version each time the server
starts, but an MCP client keeps the server running until you quit it: quitting and
reopening the client is the update. A version named in the config (`page2ai-mcp@0.6.2`)
stays until you change it. `npx -y page2ai-mcp --version` prints the version npx runs now.

`page2ai-mcp` is a thin unscoped wrapper around [`@page2ai/mcp`](https://www.npmjs.com/package/@page2ai/mcp),
released together with it; its dependency is a `^` range, which on 0.x versions admits
patch releases only.

### Hosted endpoint (beta) — no install at all

For clients that only accept a remote MCP server URL (Streamable HTTP):

```
https://page2ai-mcp-remote.vercel.app/api/mcp
```

Same tool, same code (see [`remote/`](./remote)), rate-limited per IP.
**Privacy trade-off:** URLs sent to the hosted endpoint are fetched *from that
server*, so they transit infrastructure operated by the author (on Vercel).
Running locally via `npx` keeps everything on your machine — prefer it when you
can.

### Claude Code

```bash
claude mcp add page2ai -- npx -y page2ai-mcp
```

Or install the Claude Code plugin, which adds the same server plus a skill that tells the agent when to
use it and what to do with signed-in, blocked and very long pages (Claude Code 2.1.275 or later):

```text
/plugin install page2ai --marketplace igorsaevets/page2ai-mcp
```

It asks for one optional, secret setting, the Agent Bridge key (see below). In `claude -p` runs allow the
tool by name: `--allowedTools "mcp__plugin_page2ai_page2ai__page_to_markdown"`.

### Claude Desktop

One-click bundle: download `page2ai-mcp-<version>.mcpb` from the
[latest release](https://github.com/igorsaevets/page2ai-mcp/releases/latest), then in
Claude Desktop open **Settings → Extensions → Advanced settings → Install Extension…**
and pick the file.

Or add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`), then fully quit and restart Claude Desktop:

```json
{
  "mcpServers": {
    "page2ai": { "command": "npx", "args": ["-y", "page2ai-mcp"] }
  }
}
```

### Cursor

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=page2ai&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBhZ2UyYWktbWNwIl19)

<!-- config = base64 of {"command":"npx","args":["-y","page2ai-mcp"]}
     regenerate: echo -n '{"command":"npx","args":["-y","page2ai-mcp"]}' | base64 -w0 -->

Or add to `~/.cursor/mcp.json` (global) / `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "page2ai": { "command": "npx", "args": ["-y", "page2ai-mcp"] }
  }
}
```

### VS Code (GitHub Copilot)

```bash
code --add-mcp '{"name":"page2ai","command":"npx","args":["-y","page2ai-mcp"]}'
```

Or add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "page2ai": { "type": "stdio", "command": "npx", "args": ["-y", "page2ai-mcp"] }
  }
}
```

### Codex CLI

```bash
codex mcp add page2ai -- npx -y page2ai-mcp
```

### Gemini CLI

```bash
gemini mcp add page2ai npx -y page2ai-mcp
```

### Antigravity

```bash
agy mcp add page2ai npx -y page2ai-mcp
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json` (macOS/Linux) or
`%USERPROFILE%\.codeium\windsurf\mcp_config.json` (Windows):

```json
{
  "mcpServers": {
    "page2ai": { "command": "npx", "args": ["-y", "page2ai-mcp"] }
  }
}
```

### Zed

Add to `settings.json` (`zed: open settings file`):

```json
{
  "context_servers": {
    "page2ai": { "command": "npx", "args": ["-y", "page2ai-mcp"] }
  }
}
```

### Other MCP clients

Any client that speaks MCP over stdio works — Cline, Continue, JetBrains AI Assistant,
LM Studio and others. Point their MCP server settings at the same command:
`npx -y page2ai-mcp`.

### Letting an AI agent install it

If an AI agent (Cline, Claude Code, Codex, …) is doing the setup for you, point it at
[`llms-install.md`](./llms-install.md) — a machine-oriented install guide with the exact
command per client and a verification step.

## Tools

| Tool | Description | Read-only | Example |
|------|-------------|-----------|---------|
| `page_to_markdown` | Fetch a web page URL, or take its HTML, and convert to clean Markdown | ✅ | `page_to_markdown(url="https://docs.anthropic.com/en/api/messages")` |

### Pages behind a sign-in or rendered by JavaScript

The server fetches without cookies and runs no page scripts. For a page that needs either:

- **Pass the HTML you already have** (from Playwright, Chrome DevTools MCP or another browser
  tool) as `html`, with the page's `url`: the HTML is converted, the URL is never fetched, and
  relative links resolve against it. The frontmatter then carries `provenance: "HTML supplied by
  the caller; the source URL was not fetched"`. An empty `html` is an error, not a fetch of `url`.
- **Or turn on Agent Bridge** in the Page2AI extension (1.6.0 or later): popup → *Agent Bridge*
  switch → allow access to websites. While the extension is connected, `url` pages open in a
  background tab of your own browser, with its cookies and scripts, and come back as the
  extension's Markdown (the call's `include_images` and `include_frontmatter` are honoured
  there, not the popup's). The extension refuses sign-in providers' pages and anything that is
  not http(s); a page it refuses is fetched by the server as usual, with a second text block
  saying why; when the browser ends on another page (a sign-in redirect), a second text block
  names the page it got. Private, loopback and cloud metadata addresses are refused before the
  browser opens them, as by the server's own fetch, and so is a page the browser was redirected
  to at one. The bridge listens on `ws://127.0.0.1:3025` only.

  **The key (0.6.0 and later).** The bridge works only with the key the extension shows: popup →
  *Agent Bridge* on → *Copy key*. Give it to this server as `PAGE2AI_BRIDGE_KEY`: in Claude Desktop
  (the `.mcpb` extension) paste it into Page2AI's setting *Agent Bridge key*; in a JSON config add
  `"env": { "PAGE2AI_BRIDGE_KEY": "<key>" }` to the server entry; with Claude Code,
  `claude mcp add page2ai -e PAGE2AI_BRIDGE_KEY=<key> -- npx -y page2ai-mcp`. Restart the MCP
  client after. Several browsers or profiles: put their keys in the one variable, separated by
  commas; the first to connect holds the bridge. Several MCP clients running Page2AI (Claude
  Desktop and Cursor, say): the one started first holds port 3025 and the others run without the
  bridge, so give the key to each of them. Without a key the server never sends a page to a
  browser, and the popup and this server's log say what to paste where. On every connection both
  sides prove they know the key (an HMAC exchange; the key never crosses the socket), the server
  first: a program that took port 3025 while no server ran gets nothing from the extension, and a
  program that connects to the server without the key cannot ask it for pages. Firefox needs no
  extra setting since 0.6.0 (0.5.3 required the install's UUID in `PAGE2AI_BRIDGE_ORIGINS`).
  *New key* in the popup, or reinstalling the extension, makes a new key: replace the old one with it.
  Whoever reads your MCP client's config or the browser profile can read the key: the bridge is
  no stronger than your user account.

## Example prompts

**1. Fetch documentation and answer questions:**
> "Use page_to_markdown to fetch https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking and summarize the three main use cases for extended thinking."

**2. Extract API reference into a code snippet:**
> "Fetch https://ai.google.dev/gemini-api/docs/thinking with page_to_markdown, then generate a Python code sample using the thinking budget parameter."

**3. Compare two documentation pages:**
> "Fetch both https://docs.anthropic.com/en/docs/prompt-engineering and https://platform.openai.com/docs/guides/prompt-engineering with page_to_markdown, then summarize the differences in approach."

## What a call returns

Verbatim output of `page_to_markdown(url="https://docs.anthropic.com/en/api/messages")`,
captured 2026-10-18 with core 0.2.1, truncated:

```markdown
---
title: "Messages"
source: "https://platform.claude.com/docs/en/api/messages"
captured_at: "2026-10-18T04:33:07.670Z"
language: "en"
description: "API reference for Messages endpoints"
canonical: "https://platform.claude.com/docs/en/api/messages"
og_title: "Messages - Claude API Reference"
extractor: "page2ai-core"
extractor_version: "0.2.1"
---

# Messages



A beta version of this API exists and may have additional functionality. [View the beta version](https://platform.claude.com/docs/en/api/http/beta/messages).

1. [API reference](https://platform.claude.com/docs/en/api/http)

##### [Create a Message](https://platform.claude.com/docs/en/api/http/messages/create)

 POST /v1/messages

Send a structured list of input messages with text and/or image content, and the model will generate the next message in the conversation.
```

YAML front matter (title, source, capture timestamp, page metadata, extractor provenance),
then the page as Markdown: headings, tables and fenced code preserved; navigation, header,
footer and sidebars dropped. Interface buttons are left out (core 0.2.1); up to 0.3.0 this page also printed «Copy page»
(with the glyph of its icon) and the «cURL» code-sample switcher, each twice. Up to 0.2.8 this URL returned the site's own
Markdown copy (`extractor_source: "content-negotiation"`); since 0.3.0 the server reads only
the page.

## Configuration

No setup required — every argument has a sensible default. `page_to_markdown` accepts:

| Argument | Type | Default | Effect |
|---|---|---|---|
| `url` | string | — | Absolute http(s) URL to convert. Private ranges, loopback and cloud metadata endpoints are blocked (SSRF guard). With `html`, not fetched: the base for relative links |
| `html` | string (≤ 10 MB) | — | The page's HTML, converted instead of a fetch. `url` or `html` is required |
| `include_images` | boolean | `true` | Keep `![alt](src)` image references in the output |
| `include_frontmatter` | boolean | `true` | Prepend the YAML front matter block |
| `timeout_ms` | integer | `15000` | Abort the fetch after N ms (1000–60000) |

The hosted endpoint takes `url` only (the contract its ChatGPT plugin was reviewed with) and
caps `timeout_ms` at 20000.

Environment variables of the local server, all optional:

| Variable | Default | Effect |
|---|---|---|
| `PAGE2AI_BRIDGE_KEY` | — | The Agent Bridge key(s) from the Page2AI popup, comma-separated. Without one the bridge connects no browser |
| `PAGE2AI_BRIDGE_PORT` | `3025` | Port of the Agent Bridge on 127.0.0.1. The extension connects to 3025 only, so change it for tests, not for a browser. If it is taken (another running instance), the server starts without the bridge |
| `PAGE2AI_BRIDGE_ORIGINS` | — | Exact origins of unpacked or self-built Chrome builds the bridge accepts besides Page2AI's Web Store ID, comma-separated (`chrome-extension://<id>`). Firefox needs none |

Planned: a `profile` argument (`auto | docs | marketing | research | dashboard | wordpress-marketing`).

## Privacy

`@page2ai/mcp` collects no data, sends no telemetry, and makes no external network calls
beyond the URLs you explicitly provide. Note that your AI client (Claude, ChatGPT, …)
still sends the extracted Markdown to its own model provider under that client's privacy
policy — that part is outside this server's control. See [PRIVACY.md](./PRIVACY.md) for details.

With Agent Bridge on, the extension sends this server the URL's Markdown as your browser
renders it, signed-in content included, over a WebSocket on 127.0.0.1; nothing else leaves
the machine, but the Markdown then goes to your AI client like any other result.

The optional **hosted endpoint** is different by nature: URLs you ask it to convert are
fetched from a server operated by the author (deployed on Vercel), and Vercel keeps its
standard operational logs. No accounts, no tracking. If that trade-off matters for your
use case, run the server locally — it is the same code.

## Protocol revisions

Since 0.2.0 this server answers **both** MCP protocol revisions on the same stdio
connection:

| Revision | How a client opens the connection | Served |
|---|---|---|
| `2026-07-28` | `server/discover`, carrying `io.modelcontextprotocol/protocolVersion` in `_meta` | yes |
| `2025-11-25` and earlier | the `initialize` handshake | yes |

`serveStdio` picks the era from the opening message and pins one server instance for
the life of the connection, so clients on older SDKs are unaffected. Note that a
message carrying no version claim is treated by the specification as a 2025-era
opening; `server/discover` without that `_meta` field is therefore answered with
`-32601` rather than being upgraded.

Verify against a build with the raw JSON-RPC frames, without a client library:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}' | node dist/index.js
```

## Known advisories

None. Moving to the v2 SDK removed 90 transitive packages (117 production
dependencies down to 26) and with them the `@hono/node-server` advisory that
0.1.x carried through the monolithic `@modelcontextprotocol/sdk`; that package
pulled the HTTP and OAuth server stack even for a stdio-only server. `npm audit`
is clean as of 0.2.0.

## Development

```bash
git clone https://github.com/igorsaevets/page2ai-mcp
cd page2ai-mcp
npm install
npm run build
node dist/index.js  # runs stdio MCP server
```

Test with MCP Inspector:
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Support

Pick the channel by what you have, not by what is quickest to type:

| You have | Use |
|---|---|
| A bug, a page that extracts badly, a feature idea | [GitHub issues](https://github.com/igorsaevets/page2ai-mcp/issues) — public and searchable, so the fix helps the next person too |
| A security vulnerability | [Private vulnerability reporting](https://github.com/igorsaevets/page2ai-mcp/security/advisories/new), see [SECURITY.md](SECURITY.md). Do not open a public issue |
| A usage question | [Docs](https://igorsaevets.github.io/page2ai-docs/mcp/) first, then an issue |

## About the author

Written and maintained by **Igor Saevets** — AI expert and founder of Page2AI. Full bio:
[igorsaevets.github.io/page2ai-docs/about/](https://igorsaevets.github.io/page2ai-docs/about/).

These are identity and collaboration links, not the support queue. A bug reported in a DM is a bug
nobody else can find later, so anything you want fixed belongs in the table above.

- LinkedIn: [linkedin.com/in/igorsaevets](https://www.linkedin.com/in/igorsaevets/)
- Facebook: [facebook.com/igorsaevets](https://www.facebook.com/igorsaevets/)
- GitHub: [github.com/igorsaevets](https://github.com/igorsaevets)
- ORCID: [0009-0006-8636-1377](https://orcid.org/0009-0006-8636-1377)


## Build provenance

An MCP server runs with the privileges of whatever launched it, so where the tarball came from
is a security question, not a formality. Releases from v0.1.2 onward are published from GitHub
Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements): each
version carries a Sigstore attestation naming the commit and workflow run that produced it,
recorded in the public Rekor transparency ledger and shown as a badge on npmjs.com.

Check it before you trust it:

```bash
npm audit signatures
npm view @page2ai/mcp --json | jq '.dist.attestations'
```

## License

MIT — see [LICENSE](./LICENSE). Copyright © 2026 Igor Saevets.

## Related

- **Page2AI Chrome extension** — https://github.com/igorsaevets/page2ai-extension (a browser extension for humans, with its own extraction pipeline)
- **@page2ai/core** — https://npmjs.com/package/@page2ai/core (the extraction library this server runs)
- **page2ai-mcp** (unscoped) — https://npmjs.com/package/page2ai-mcp (thin wrapper around this package, published so `npx -y page2ai-mcp` works without a scope prefix)
- **Software Heritage archive** — SWHID `swh:1:snp:05123c51ef9e7c0aeb06f42b1263c07a8d26999a`
