# Contributing to @page2ai/mcp

Small server, one tool (`page_to_markdown`). The extraction logic lives in [@page2ai/core](https://github.com/igorsaevets/page2ai-core); improvements to extraction quality belong there, not here.

## Ground rules

- Open an issue before adding a second tool or a new transport. Scope creep is the main risk for this repo.
- One change per PR, with a test.
- AI-assisted contributions are welcome and must be declared in the PR template.

## Dev setup

Node 20 or newer.

```bash
npm ci
npm run typecheck
npm test           # vitest
npm run build
npm run probe      # protocol smoke test against dist/
```

To try it against a real client, point Claude Desktop or Claude Code at `node dist/index.js` (stdio), or use `npx page2ai-mcp`.

## Protocol note

The entry point serves the 2026-07-28 MCP protocol revision through `serveStdio` on the 2.x SDK. If you touch `src/index.ts`, run `npm run probe` afterwards.

Diagnostics go to stderr only. stdout belongs to the protocol stream; a stray `console.log` corrupts it.

## Releases

The maintainer publishes to npm; the MCP Registry entry and the MCPB bundle move together with it. Please do not bump versions in a PR.

## Security

Never report vulnerabilities in public issues. See [SECURITY.md](./SECURITY.md).
