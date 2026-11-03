# page2ai

Convert any web page to clean Markdown — from the terminal.

```bash
npx page2ai https://example.com
```

No configuration, no API keys, no telemetry. Processing is local and SSRF-guarded.

## Install

```bash
# Run directly (no install needed)
npx page2ai https://example.com

# Or install globally
npm install -g page2ai
page2ai https://example.com
```

Requires Node.js 20.18.1 or later.

## Usage

```bash
# Fetch a URL and print Markdown to stdout
npx page2ai https://docs.python.org/3/library/stdtypes.html

# Pipe output to a file
npx page2ai https://example.com > page.md

# Convert a local HTML file
npx page2ai --html page.html --base-url https://example.com

# Read HTML from stdin
curl -s https://example.com | npx page2ai -

# Limit output length
npx page2ai https://example.com --max-length 5000

# Include YAML frontmatter (title, URL, timestamp)
npx page2ai https://example.com --frontmatter
```

## Options

| Option | Description |
|---|---|
| `--frontmatter` | Include a YAML frontmatter block (off by default) |
| `--no-images` | Strip image references from the output |
| `--timeout <ms>` | Fetch timeout in milliseconds (default: 15000) |
| `--max-length <chars>` | Truncate the output at N characters |
| `--base-url <url>` | Base URL for resolving relative links (with `--html`) |
| `--html <file>` | Convert a local HTML file instead of fetching |
| `--version` | Print the version and exit |
| `-h`, `--help` | Show help |

## What it does

- Fetches the page and extracts the content root (`<main>`, `<article>`, or `<body>`)
- Converts HTML to clean Markdown: headings, paragraphs, lists, links, images, code blocks, tables, blockquotes
- Discovers static tab panels (API docs with language tabs) and emits each as a section
- Blocks private IP ranges, loopback, and cloud metadata endpoints (SSRF guard)
- Follows one redirect; refuses sign-in landings

## Part of Page2AI

This CLI is powered by [`@page2ai/core`](https://www.npmjs.com/package/@page2ai/core). See also:

- **[Page2AI MCP Server](https://www.npmjs.com/package/@page2ai/mcp)** — for AI agents via Model Context Protocol
- **[Page2AI Chrome Extension](https://chromewebstore.google.com/detail/dlpaaijcnbbmlfeohlphjpnbbcnomnno)** — full browser pipeline with tab interaction
- **[Documentation](https://igorsaevets.github.io/page2ai-docs/)**

## License

MIT
