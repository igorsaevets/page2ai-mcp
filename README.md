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

## Known advisories

`npm audit` will surface a moderate finding in `@hono/node-server` (a transitive dependency of `@modelcontextprotocol/sdk`). That vulnerability lives in the SDK's HTTP/OAuth server path; `@page2ai/mcp` uses only the stdio transport and never loads that code path, so it is not exploitable through this package. The audit line will clear once the SDK bumps its Hono constraint to `>=2.0.5`.

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

- GitHub issues: https://github.com/igorsaevets/page2ai-mcp/issues
- Author: Igor Saevets (igorsaevets@gmail.com)

## License

MIT — see [LICENSE](./LICENSE). Copyright © 2026 Igor Saevets.

## Related

- **Page2AI Chrome extension** — https://github.com/igorsaevets/page2ai-extension (same extraction core, distributed as a browser extension for humans)
- **@page2ai/core** — https://npmjs.com/package/@page2ai/core (the shared extraction library)
- **page2ai-mcp** (unscoped) — https://npmjs.com/package/page2ai-mcp (thin wrapper around this package, published so `npx -y page2ai-mcp` works without a scope prefix)
- **Software Heritage archive** — SWHID `swh:1:snp:05123c51ef9e7c0aeb06f42b1263c07a8d26999a`
