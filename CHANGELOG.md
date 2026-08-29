# Changelog

All notable changes to `@page2ai/mcp` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the
major version is `0`, a minor bump may carry breaking changes.

## 0.2.5 - 2026-08-29

### Fixed
- **The npx wrapper always ran the previous release.** `page2ai-mcp`'s dependency on
  `@page2ai/mcp` was exact-pinned during each release to the version published *before* it —
  wrapper 0.2.3 served 0.2.2, wrapper 0.2.4 served 0.2.3 — so `npx -y page2ai-mcp` reported
  and ran one version behind `npx -y @page2ai/mcp`. The pin is now a caret range, and the
  publish workflow fails when the wrapper's dependency is not `^<release version>`. Practical
  impact was small (0.2.3's own `@page2ai/core: ^0.1.4` resolved to 0.1.7 on fresh installs),
  but `serverInfo.version` over the wire was wrong for every wrapper user.

### Changed
- Releases now push `server.json` to the **MCP Registry** via `mcp-publisher` (GitHub OIDC),
  with a guard that `server.json` matches `package.json`. The registry had been stale at 0.1.1
  since July while npm moved to 0.2.4; 0.2.4 was published to it manually on 2026-08-29.
- npm descriptions (scoped and wrapper) no longer say "100% local" — the server fetches
  exactly the URLs you pass it. Now: processing is local and SSRF-guarded; no external APIs,
  no telemetry.

## 0.2.4 - 2026-08-17 *(entry backfilled 2026-08-29)*

### Changed
- `@page2ai/core` raised to `^0.1.7`; lockfile regenerated to match.
- Repository hygiene batch: full Contributor Covenant v2.1 (previous copy was truncated),
  CONTRIBUTING.md, SUPPORT.md, AGENTS.md, PR template with AI disclosure, CODEOWNERS, bug
  report form, .editorconfig, Dependabot version updates; SECURITY.md states the actual
  SSRF-guard coverage after core 0.1.6; Code of Conduct enforcement contact routed through
  the GitHub handle instead of a personal email.
- CI actions checkout/setup-node 5 → 7; dev deps vitest 3.2.7 → 4.1.10, @types/node 22 → 26.

## 0.2.3 - 2026-08-02 *(entry backfilled 2026-08-29)*

### Fixed
- MCPB manifest `author.url` now points at the GitHub profile — a stated requirement of the
  Anthropic desktop-extension submission form the manifest did not meet.

## 0.2.2 - 2026-08-02

### Fixed
- Requires `@page2ai/core` 0.1.4, which closes three holes an external review panel found in the
  0.1.2 content-root fix. None was found by testing; all three were predicted from the diff and
  then reproduced. The worst: pages with no `<main>` at all still hit the original bug, so a card
  grid inside `<div class="sl-main">` returned 32 characters for the whole page. Also: a page
  whose content is a form lost its article to an unrelated sidebar card, and a real post under a
  large related-posts rail was demoted in favour of the rail.

## 0.2.1 - 2026-08-02

### Fixed
- Pages built with a card grid lost almost all of their content. `@page2ai/core` chose the
  conversion root with the FIRST `<article>` in document order, and HTML5 allows that tag on any
  self-contained component, so a decorative card outranked the page. `docs.astro.build` returned
  208 characters of body where it now returns 3,494; `blog.cloudflare.com` returned 927 where it
  now returns 15,068. An `<article>` is now used only when it carries at least half its
  container's content text. Requires `@page2ai/core` 0.1.2.
- The server reported the wrong version over the wire. `SERVER_VERSION` was a hardcoded constant
  beside `package.json` and `manifest.json`, and it drifted on the first release after it was
  written. It is now read from `package.json`, with a fallback so a missing file can never stop
  the server from starting.

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
