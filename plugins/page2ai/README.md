# Page2AI for Claude

Page2AI converts a web page to clean Markdown for Claude. Code blocks keep their language, tables stay tables, tab panels come out as separate sections, and navigation menus are dropped. Give it a URL, or the HTML of a page that a browser tool already has open, and Claude gets the page's full text instead of a summary.

The plugin adds one tool, `page_to_markdown`, and a skill that tells Claude when to use it, what to do when a site refuses the request, and how to handle very long pages.

## Where it works

| Surface | What loads |
|---|---|
| Claude Code | the tool and the skill |
| Cowork, in a session that runs on your computer | the tool and the skill, without the Agent Bridge (Cowork does not ask for plugin options) |
| claude.ai chat | the skill only: chat does not start local MCP servers, so the tool is not there |

The server needs Node.js 20 or later on your computer, for `npx`.

To install it in Claude Code from this repository's own marketplace:

```
/plugin install page2ai --marketplace igorsaevets/page2ai-mcp
```

## What it runs, fetches and sends

- **Runs** the open-source page2ai-mcp server on your computer through `npx`, pinned to one release in the plugin's manifest. When that release is not in npm's cache yet, npx downloads it and its dependencies from the npm registry.
- **Fetches** each page Claude asks for, directly from your computer, with a plain HTTP request: no cookies, no page scripts. Private, loopback and cloud-metadata addresses are refused.
- **Listens** on 127.0.0.1, port 3025, reachable from your computer only, for the Page2AI browser extension's Agent Bridge. Without a bridge key it refuses every connection.
- **Sends** nothing anywhere else: no telemetry, no analytics, no account. The Markdown goes only to the Claude session that called the tool.

## Optional: open pages in your own browser (Agent Bridge)

Pages behind a sign-in, or rendered by JavaScript, come back empty or refused when the server fetches them. With the Agent Bridge, the server asks the Page2AI Chrome extension to open the page in a background tab of your browser, with your cookies, and returns that page's Markdown.

1. Install the Page2AI extension 1.6.0 or later from the Chrome Web Store (extension ID dlpaaijcnbbmlfeohlphjpnbbcnomnno).
2. In its popup, turn on Agent Bridge, allow site access, and press Copy key.
3. In Claude Code, paste the key into this plugin's `bridge_key` option, then restart Claude Code so the server starts with it.

Leave `bridge_key` empty to use the plugin without the extension.

## Links

- Documentation: https://igorsaevets.github.io/page2ai-docs/mcp/
- Privacy policy: https://igorsaevets.github.io/page2ai-docs/privacy/
- Source and issues: https://github.com/igorsaevets/page2ai-mcp
- License: MIT
