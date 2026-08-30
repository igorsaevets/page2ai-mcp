# llms-install.md — AI-agent install guide for page2ai-mcp

You are an AI agent installing the **page2ai** MCP server for your user. Everything you
need is below; no account, no API key, no environment variables, no build step.

## What you are installing

- A **stdio MCP server** started with: `npx -y page2ai-mcp`
- Requirement: **Node.js 20+** on the user's machine (`node --version` to check).
- It exposes one read-only tool, `page_to_markdown(url)` — fetches a web page and
  returns clean Markdown with YAML front matter.
- The only network requests it ever makes are to the URLs passed in. No telemetry.
- First run downloads ~30 MB into the npm cache (a few seconds on a normal
  connection); later runs start instantly.

## Install commands per client

Run the ONE command matching the client you are running inside, or edit the config file
where noted. Do not run `npx -y page2ai-mcp` bare in a terminal — it waits silently on
stdin for an MCP client; that is normal, not a hang.

| Client | How |
|---|---|
| Claude Code | `claude mcp add page2ai -- npx -y page2ai-mcp` |
| Codex CLI | `codex mcp add page2ai -- npx -y page2ai-mcp` |
| Gemini CLI | `gemini mcp add page2ai npx -y page2ai-mcp` |
| Antigravity | `agy mcp add page2ai npx -y page2ai-mcp` |
| VS Code (Copilot) | `code --add-mcp '{"name":"page2ai","command":"npx","args":["-y","page2ai-mcp"]}'` |
| Claude Desktop | Easiest: download `page2ai-mcp-<version>.mcpb` from the [latest release](https://github.com/igorsaevets/page2ai-mcp/releases/latest); the user installs it via **Settings → Extensions → Advanced settings → Install Extension…**. Or add the JSON below to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`) and have the user fully restart Claude Desktop. |
| Cursor | Add the JSON below to `~/.cursor/mcp.json` (or `.cursor/mcp.json` per-project) |
| Windsurf | Add the JSON below to `~/.codeium/windsurf/mcp_config.json` |
| Cline / other | Use the client's MCP settings UI or config file with the JSON below |

Generic config block (`mcpServers` key; Zed uses `context_servers`, VS Code's
`.vscode/mcp.json` uses `servers` with `"type": "stdio"`):

```json
{
  "mcpServers": {
    "page2ai": { "command": "npx", "args": ["-y", "page2ai-mcp"] }
  }
}
```

## Verify the install

After the client has loaded the server, call the tool:

```
page_to_markdown(url="https://example.com/")
```

Expected result: Markdown starting with a YAML front matter block (`title: "Example
Domain"`, `source`, `captured_at`, `extractor: "page2ai-core"`), followed by a single
`# Example Domain` heading and one paragraph. If you get that, the install works —
tell the user it is ready.

## Troubleshooting

- **Tool missing after install** — config-file clients need a full app restart
  (quit, not just reload) before the server list refreshes.
- **`npx` serves a stale version** — run `npx -y page2ai-mcp@latest` once, or clear
  with `npm cache clean --force`.
- **Node too old** — `EBADENGINE` or a syntax error on start means Node < 20; ask the
  user to upgrade Node.js, do not try to patch around it.
- **Corporate proxy / offline** — the server itself is local, but it downloads from
  the npm registry on first run and fetches the pages you request; both need network
  access.

## Scope notes for agents

- Install is fully reversible: the mirror command is `claude mcp remove page2ai` /
  `codex mcp remove page2ai` / `agy mcp remove page2ai`, or deleting the JSON entry.
- Never add environment variables or secrets to this server's config — it takes none.
- Source: https://github.com/igorsaevets/page2ai-mcp · npm: `page2ai-mcp` (wrapper)
  around [`@page2ai/mcp`](https://www.npmjs.com/package/@page2ai/mcp). Releases are
  published from GitHub Actions with npm provenance; verify with `npm audit signatures`.
