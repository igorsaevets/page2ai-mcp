# AGENTS.md

Instructions for AI coding agents working in this repository. Humans: see [CONTRIBUTING.md](./CONTRIBUTING.md).

## What this is

`@page2ai/mcp`: MCP server exposing one tool, `page_to_markdown` (URL in, Markdown out). Extraction is delegated to `@page2ai/core`; this repo owns fetching, safety limits and the MCP wiring. `wrapper/` holds the unscoped `page2ai-mcp` npm wrapper.

## Commands

- Install: `npm ci`
- Typecheck: `npm run typecheck`
- Test: `npm test`
- Build: `npm run build`
- Protocol smoke test: `npm run probe` (build first)

## Constraints

- stdout is the MCP protocol stream. Never write diagnostics to stdout; use stderr.
- Extraction-quality problems are fixed in `@page2ai/core`, not patched here.
- The server serves the 2026-07-28 MCP protocol revision via `serveStdio`. Run `npm run probe` after touching `src/index.ts`.
- Do not weaken fetch safety (SSRF guard, timeouts, size caps). If a fetch fails for a user, the answer may be configuration, not removing the guard.
- Do not bump versions; npm, the MCP Registry entry and the MCPB bundle move together, released by the maintainer.
