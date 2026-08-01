# @page2ai/mcp — Web to Markdown for LLM Context

Turn any web page into clean Markdown for Claude, ChatGPT, or your own LLM.

Companion to the [Page2AI Chrome extension](https://github.com/igorsaevets/page2ai-extension). Shares the same `@page2ai/core` extraction library. Zero external API calls — runs entirely on your machine using [linkedom](https://github.com/WebReflection/linkedom).

## Install

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%/Claude/claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "page2ai": {
      "command": "npx",
      "args": ["-y", "@page2ai/mcp"]
    }
  }
}
```

Restart Claude Desktop.

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "page2ai": {
      "command": "npx",
      "args": ["-y", "@page2ai/mcp"]
    }
  }
}
```

### Windsurf

Add to `~/.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "page2ai": {
      "command": "npx",
      "args": ["-y", "@page2ai/mcp"]
    }
  }
}
```

### Zed

Add to `settings.json`:

```json
{
  "context_servers": {
    "page2ai": {
      "command": {
        "path": "npx",
        "args": ["-y", "@page2ai/mcp"]
      }
    }
  }
}
```

### VS Code (with Continue or GitHub Copilot Chat)

Refer to your MCP-compatible extension's documentation. The command is `npx -y @page2ai/mcp`.

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

## Configuration

None required in v0.1. All extraction options use sensible defaults.

Future versions will support options via tool arguments:
- `include_images` (boolean, default `false`)
- `include_frontmatter` (boolean, default `true`)
- `profile` (string, one of `auto | docs | marketing | research | dashboard | wordpress-marketing`, default `auto`)

## Privacy

`@page2ai/mcp` collects no data, sends no telemetry, and makes no external network calls beyond the URLs you explicitly provide. See [PRIVACY.md](./PRIVACY.md) for details.

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
- Email: igorsaevets@gmail.com


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
