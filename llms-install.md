# llms-install.md — AI-agent install guide for page2ai-mcp

You are an AI agent installing the **page2ai** MCP server for your user. Everything you
need is below; no account, no build step. One optional environment variable matters here — the Agent Bridge pairing key (below); the server works without it.

## What you are installing

- A **stdio MCP server** started with: `npx -y page2ai-mcp`
- Requirement: **Node.js 20+** on the user's machine (`node --version` to check).
- It exposes one read-only tool, `page_to_markdown`: with `url` it fetches a web page;
  with `html` (a page's HTML, with its `url` as the base for links) it converts what you
  hand it and fetches nothing. Either way it returns clean Markdown with YAML front matter.
- The only network requests it ever makes are to the URLs passed in. No telemetry.
- First run downloads ~30 MB into the npm cache (a few seconds on a normal
  connection); later runs start instantly.

## Install commands per client

Run the ONE command matching the client you are running inside, or edit the config file
where noted. Do not run `npx -y page2ai-mcp` bare in a terminal to test it: it prints
`[page2ai-mcp] server <version> ready on stdio` plus two Agent Bridge lines to stderr,
then waits on stdin for an MCP client; that is normal, not a hang.

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

## Optional: Agent Bridge (pages behind a sign-in or rendered by JavaScript)

The server fetches without cookies and runs no page scripts. If the user wants it to read
such a page through their own browser instead, the Page2AI browser extension can serve it —
but only **extension 1.6.0 or later**: the stores currently serve 1.5.1, whose popup has no
Agent Bridge switch. If the popup has no *Agent Bridge* section, do not invent one and do
not tell the user to look for it; say the extension must be updated first (the browser does
it on its own within a day) and use the `html` argument meanwhile.

With 1.6.0 present, ask the user to:

1. Open the Page2AI popup, turn on *Agent Bridge* and allow access to websites.
2. Use *Copy key* in that section and give you the key — or paste it themselves into this
   server's config as the `PAGE2AI_BRIDGE_KEY` environment variable (in Claude Desktop's
   `.mcpb` install, the *Agent Bridge key* setting). That is the only variable you should
   ever set for it; never add any other.
3. Restart the MCP client fully. Afterwards `url` pages open in a background tab of the
   user's browser while the extension is connected; the server falls back to its own
   fetch, with a note, for any page the extension declines.

## Troubleshooting

- **Tool missing after install** — config-file clients need a full app restart
  (quit, not just reload) before the server list refreshes.
- **`npx` serves a stale version** — run `npx -y page2ai-mcp@latest` once, or clear
  with `npm cache clean --force`.
- **Updating** — a running server is never replaced: ask the user to quit and reopen the
  MCP client, which then starts the newest version (`npx -y page2ai-mcp --version` prints
  it). Do not pin a version or write your own wrapper around `@page2ai/core` for a task:
  a pinned version, or a `^0.x` range in a wrapper's package.json, never receives the next
  minor release with its fixes. To convert a local HTML file, pass its text as the tool's
  `html` argument (with `url` as the page's address, if known).
- **Node too old** — `EBADENGINE` or a syntax error on start means Node < 20; ask the
  user to upgrade Node.js, do not try to patch around it.
- **Corporate proxy / offline** — the server itself is local, but it downloads from
  the npm registry on first run and fetches the pages you request; both need network
  access.

## Scope notes for agents

- Install is fully reversible: the mirror command is `claude mcp remove page2ai` /
  `codex mcp remove page2ai` / `agy mcp remove page2ai`, or deleting the JSON entry.
- The only environment variable you should ever set for this server is `PAGE2AI_BRIDGE_KEY` (optional, above). It also honours `PAGE2AI_BRIDGE_PORT` and `PAGE2AI_BRIDGE_ORIGINS` for unpacked builds and tests — never set those for a user, and never add any secret to its config.
- Source: https://github.com/igorsaevets/page2ai-mcp · npm: `page2ai-mcp` (wrapper)
  around [`@page2ai/mcp`](https://www.npmjs.com/package/@page2ai/mcp). Releases are
  published from GitHub Actions with npm provenance; verify with `npm audit signatures`.
