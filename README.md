# @page2ai/mcp — Web to Markdown for LLM Context

[![npm version](https://img.shields.io/npm/v/%40page2ai%2Fmcp)](https://www.npmjs.com/package/@page2ai/mcp)
[![CI](https://github.com/igorsaevets/page2ai-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/igorsaevets/page2ai-mcp/actions/workflows/ci.yml)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.igorsaevets%2Fpage2ai--mcp-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.igorsaevets/page2ai-mcp)
[![license MIT](https://img.shields.io/npm/l/%40page2ai%2Fmcp)](./LICENSE)

<sub>No downloads badge on purpose: npm download counts are dominated by registry mirrors and
bots, and this README only shows numbers a human can trust.</sub>

Turn any web page into clean Markdown for Claude, ChatGPT, or your own LLM.

Fetch, extract, convert — one tool, one command, entirely on your machine. No API key,
no account, no telemetry; the only network requests are to the URLs you pass it.
Companion to the [Page2AI Chrome extension](https://github.com/igorsaevets/page2ai-extension);
both share the same [`@page2ai/core`](https://npmjs.com/package/@page2ai/core) extraction library.

## Quick start

```bash
npx -y page2ai-mcp
```

This starts the stdio MCP server — it waits silently for a client, so wire it into one of
the clients below rather than running it bare. Requires **Node.js 20+**. No API key. If
`npx` ever serves you a stale cached version, run `npx -y page2ai-mcp@latest` once.

`page2ai-mcp` is a thin unscoped wrapper around [`@page2ai/mcp`](https://www.npmjs.com/package/@page2ai/mcp);
since 0.2.5 it follows the latest server automatically via a `^` range.

### Claude Code

```bash
claude mcp add page2ai -- npx -y page2ai-mcp
```

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
| `page_to_markdown` | Fetch a web page URL and convert to clean Markdown | ✅ | `page_to_markdown(url="https://docs.anthropic.com/en/api/messages")` |

## Example prompts

**1. Fetch documentation and answer questions:**
> "Use page_to_markdown to fetch https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking and summarize the three main use cases for extended thinking."

**2. Extract API reference into a code snippet:**
> "Fetch https://ai.google.dev/gemini-api/docs/thinking with page_to_markdown, then generate a Python code sample using the thinking budget parameter."

**3. Compare two documentation pages:**
> "Fetch both https://docs.anthropic.com/en/docs/prompt-engineering and https://platform.openai.com/docs/guides/prompt-engineering with page_to_markdown, then summarize the differences in approach."

## What a call returns

Verbatim output of `page_to_markdown(url="https://docs.anthropic.com/en/api/messages")`,
captured 2026-08-29 on core 0.1.7, truncated:

```markdown
---
title: "Messages"
source: "https://platform.claude.com/docs/en/api/messages"
captured_at: "2026-08-29T09:01:05.806Z"
extractor: "page2ai-core"
extractor_version: "0.1.7"
extractor_source: "content-negotiation"
---
# Messages

## Create a Message

**POST** `/v1/messages`

Send a structured list of input messages with text and/or image content, and the
model will generate the next message in the conversation.
```

YAML front matter (title, source, capture timestamp, extractor provenance), then the
article as clean Markdown — headings, tables and fenced code preserved, navigation and
chrome dropped.

## Configuration

No setup required — every argument has a sensible default. `page_to_markdown` accepts:

| Argument | Type | Default | Effect |
|---|---|---|---|
| `url` | string, **required** | — | Absolute http(s) URL to convert. Private ranges, loopback and cloud metadata endpoints are blocked (SSRF guard) |
| `include_images` | boolean | `true` | Keep `![alt](src)` image references in the output |
| `include_frontmatter` | boolean | `true` | Prepend the YAML front matter block |
| `timeout_ms` | integer | `15000` | Abort the fetch after N ms (1000–60000) |

Planned: a `profile` argument (`auto | docs | marketing | research | dashboard | wordpress-marketing`).

## Privacy

`@page2ai/mcp` collects no data, sends no telemetry, and makes no external network calls
beyond the URLs you explicitly provide. Note that your AI client (Claude, ChatGPT, …)
still sends the extracted Markdown to its own model provider under that client's privacy
policy — that part is outside this server's control. See [PRIVACY.md](./PRIVACY.md) for details.

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

- **Page2AI Chrome extension** — https://github.com/igorsaevets/page2ai-extension (same extraction core, distributed as a browser extension for humans)
- **@page2ai/core** — https://npmjs.com/package/@page2ai/core (the shared extraction library)
- **page2ai-mcp** (unscoped) — https://npmjs.com/package/page2ai-mcp (thin wrapper around this package, published so `npx -y page2ai-mcp` works without a scope prefix)
- **Software Heritage archive** — SWHID `swh:1:snp:05123c51ef9e7c0aeb06f42b1263c07a8d26999a`
