# Changelog

All notable changes to `@page2ai/mcp` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the
major version is `0`, a minor bump may carry breaking changes.

## [0.2.0] - 2026-07-29

Adopts MCP protocol revision **2026-07-28**, published 2026-07-28, one day after the
v2 TypeScript SDK packages landed on npm.

### Breaking

- **Node.js 20 or newer is required** (was 18). `@modelcontextprotocol/core` and
  `@modelcontextprotocol/server` both declare `engines.node: ">=20"`.
- `zod` moved from `^3.24.0` to `^4.2.0`. The v2 SDK's floor is `zod >= 4.2.0`; an
  older range installs cleanly and then fails at type-check or at the first
  `tools/list`, depending on which zod entry point is imported.

### Added

- Serves protocol revision `2026-07-28` alongside `2025-11-25`. A client that opens
  with `server/discover` and a `io.modelcontextprotocol/protocolVersion` claim in
  `_meta` gets the 2026 era; a client that opens with `initialize` gets the 2025 era,
  byte for byte as before. `serveStdio` owns the decision and pins one server
  instance per connection.
- `SIGINT` / `SIGTERM` handlers that close the connection through the
  `StdioServerHandle` returned by `serveStdio`.

### Changed

- Migrated from the monolithic `@modelcontextprotocol/sdk@^1.29.0` to
  `@modelcontextprotocol/server@^2.0.0`. This removes 90 transitive packages:
  117 production dependencies down to 26. The v1 package pulled the HTTP and OAuth
  server stack into every install, including stdio-only servers like this one.
- Server registration moved into a factory (`buildServer`) so the same tool
  registrations serve both eras.

### Fixed

- The version reported over the wire and on stderr was hardcoded to `0.1.0` while
  the package published as `0.1.2`. It now tracks the package version. This was
  visible to any client reading `serverInfo`.
- `server.json` declared `0.1.1` while npm carried `0.1.2`.

### Notes

- Wiring a `Server` directly to a `StdioServerTransport` serves only the 2025 era,
  no matter which SDK version is installed. Upgrading the dependency is not enough;
  the entry point has to change.

## [0.1.2] - 2026-07-27

- Packaging and metadata fixes.

## [0.1.0] - 2026-07-24

- First release: stdio MCP server exposing a single `page_to_markdown` tool backed
  by `@page2ai/core`. SSRF guard, 10 MB size cap, 15 s default timeout.
