# Changelog

All notable changes to `@page2ai/mcp` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the
major version is `0`, a minor bump may carry breaking changes.

## 0.5.4 - 2026-10-23

### Security

- **Agent Bridge keeps the SSRF guard.** The tool's description says private ranges, loopback and cloud metadata endpoints are blocked, and the server's own fetch blocks them; 0.5.0 to 0.5.3 sent such a URL to the extension, which opened it in the user's browser (`http://192.168.1.1/`, `http://169.254.169.254/…`, a name resolving to `10.x`). The server now checks the URL with the same guard, DNS included, before the browser opens it, and refuses a result whose page, after a redirect the browser followed, is at a blocked address. A name this server cannot resolve still goes to the browser, which may reach it through a proxy.

### Fixed

- **A blank bridge result, or one from a page that is not a web address, is refused** (`BAD_RESULT`) and answered by the server's fetch. 0.5.3 refused a missing `markdown` but returned `""` as the page, and Firefox reports a new tab's `about:blank` complete before the page loads.
- **The server exits when stdin closes even while a client is connected that never answers.** 0.5.3 waited for the WebSocket close handshake, up to 30 s; `scripts/stdin-exit.mjs` now connects such a client first, and the process ends at most 3 s after stdin closes.
- **No `provenance` line inside the text when frontmatter is off.** HTML that opens with `<hr>` renders as `---`, and 0.5.3 inserted the line into the page's text under `include_frontmatter: false`.

### Changed

- **A redirect on the same host is reported too**: a sign-in page at another path, or another port. An http-to-https upgrade, a trailing slash or a changed query is not.

## 0.5.3 - 2026-10-23

### Security

- **Agent Bridge no longer accepts every Firefox extension.** 0.5.0 to 0.5.2 accepted any `moz-extension://` origin, because Firefox gives each install a random one; any Firefox extension could then hold the bridge, read the URLs the agent asks for and write what the agent reads. A Firefox install is now accepted only by its exact origin listed in `PAGE2AI_BRIDGE_ORIGINS`, and the server's log names the variable when it refuses one.

### Fixed

- **The server exits when its client closes stdin.** Since 0.5.0 the bridge's listening socket kept the process running after that (0.5.2 was still running 6 s later), holding port 3025, so the client's next instance started without the bridge. CI now checks it (`scripts/stdin-exit.mjs`).
- **An empty `html` is an error.** With a `url`, `html: ""` fetched the URL instead and a blank `html` converted to an empty page; both now answer `Invalid input: html: empty`.
- **`url` must be http(s).** zod's `url()` accepted `javascript:`, `file:` and `data:` addresses; the fetch refused them, but as the base of `html` they resolved links and filled `source`.
- **Bridge failures are classified by their protocol code**, not by words in the message: only `TIMEOUT` ends the call without the server's own fetch. 0.5.2 matched "timed out", so a tab that failed to load was not retried by fetch.
- **A bridge result without Markdown** is refused (`BAD_RESULT`) and answered by the server's fetch instead of returning an empty text.

### Changed

- **Markdown made from caller-supplied HTML says so**: its frontmatter adds `provenance: "HTML supplied by the caller; the source URL was not fetched"`, so it does not pass for a fetch of `source`.
- **Through Agent Bridge, a redirect to another host is reported** in a second text block naming the page the browser ended on (a sign-in page, most often).
- PRIVACY.md describes Agent Bridge (pages open in the user's own browser; content stays on the machine and goes to the MCP client); SECURITY.md supports 0.5.x and states what the bridge's origin check does and does not stop.

### Hosted endpoint (remote 0.1.3)

- `html` with a `url` is refused instead of being dropped (the reviewed contract has no `html`, and parsing stripped it, so the caller got a fetch of `url`). The production smoke now also pins the whole `inputSchema` JSON, `title` and `annotations` as served on 2026-10-23.

## 0.5.2 - 2026-10-23

### Changed

- **`url` and `html` together**: the HTML is converted and the URL is its address, never fetched; relative links and image sources resolve against it, and it fills the frontmatter's `source`. Up to 0.5.1 the pair was refused, so links in HTML from a browser tool stayed relative.
- **The tool description is accurate again.** 0.5.0 dropped the sentences saying the server reads only the page (no Markdown copy of a docs page) and why tab groups are split, and said a connected extension converts every page; it now says when Agent Bridge is used and that a page the extension declines is fetched by the server. Through the bridge the extension's own output settings apply, and `include_images` / `include_frontmatter` say so.
- **The hosted endpoint keeps the tool contract reviewed for the ChatGPT plugin**: `pageToMarkdownHostedDefinition` and `pageToMarkdownHostedInputSchema` are the 0.4.1 definition (a URL only, no Agent Bridge, which a hosted server never reaches). 0.5.0 had changed what ChatGPT runs by changing the shared definition; a test now pins the hosted one.

### Fixed

- **A refusing extension no longer breaks `page_to_markdown`.** With the Agent Bridge connected, any extension error was returned as the tool's answer. Now a refusal (no site access, a sign-in page, a non-web URL) or a failed tab falls back to the server's own fetch, as with no extension, and the answer says why; a bridge timeout is still an error, so the caller's time is not spent twice.
- **A request no longer waits for its timeout when the extension disconnects**: it fails at once with `EXTENSION_DISCONNECTED`.

### Security

- **The bridge accepts Page2AI only**: its Chrome Web Store origin, any `moz-extension://` (Firefox gives each install a random UUID), and the exact origins in `PAGE2AI_BRIDGE_ORIGINS` (an unpacked build). Before, any installed extension could open the connection without a permission, read every URL the agent asked for and write what the agent read.

## 0.5.1 - 2026-10-22

### Fixed
- **Agent Bridge no longer crashes on `EADDRINUSE` when another MCP instance holds port 3025.**
  In 0.5.0 the bridge attached a `WebSocketServer` to the HTTP server before `listen()` was called;
  on a second `page2ai-mcp` instance (e.g. a user running the MCP in Claude Desktop and Cursor at
  once) the listen failed with `EADDRINUSE`, `ws` re-emitted the error on the WSS, and the process
  crashed with an unhandled `error` event. The server now binds the HTTP server first, attaches the
  WSS only on success, logs `bridge failed to start: ... (the server continues without it)`, and
  keeps serving stdio (fetch path). Regression test added.

### Changed
- **MCPB bundle excludes non-runtime files** (`src/`, `tests/`, `scripts/`, `remote/`, `wrapper/`,
  `.github/`, docs, config files) via a new `.mcpbignore`. The 0.5.0 bundle was 33.6 MB packed /
  115.8 MB unpacked / 3,874 files, because `remote/node_modules` and dev dependencies leaked in;
  the 0.5.1 bundle targets ~3.7 MB packed / ~13 MB unpacked / ~1,500 files, back in line with
  0.4.x. Build the bundle after `npm run build && npm prune --omit=dev`.

## 0.5.0 - 2026-10-22

### Added
- **Agent Bridge: localhost WebSocket server for the Page2AI browser extension.** When the
  user enables "Agent Bridge" in the extension popup, `page_to_markdown` routes through the
  user's real browser — cookies, JavaScript rendering and extension-quality extraction —
  instead of a cookieless fetch. The bridge binds `127.0.0.1:3025` (override with
  `PAGE2AI_BRIDGE_PORT`), validates the extension's `chrome-extension://` or
  `moz-extension://` Origin, and authenticates with a per-session 32-byte token. Protocol:
  `page2ai-bridge/1`. Skipped on serverless (Vercel, Lambda).
- **`html` input parameter** (closes #1): pass raw HTML directly instead of fetching a URL.
  Use it when you already have the page HTML from a browser tool; the server converts it
  locally via `htmlToMarkdown` from `@page2ai/core`. Provide either `url` or `html`, not
  both; when both are absent the tool returns an error.

### Changed
- **3-path routing for `page_to_markdown`:** (1) `html` parameter → local conversion,
  (2) bridge connected → extension, (3) `url` → fetch. When the extension is connected,
  a `url` request goes through the browser automatically; a `url` + `html` request is
  rejected. The fetch path is unchanged from 0.4.1.
- `ws` added as a production dependency (`^8.22.0`) for the bridge WebSocket server.
- Tool description updated to mention the bridge and the `html` parameter.
- MCPB manifest `long_description` updated to mention the bridge.

## 0.4.1 - 2026-10-20

### Fixed
- **`@page2ai/core` 0.3.1: layout tables convert as blocks, not as one table cell** (P2A-024), and
  the dependency range starts there (`^0.3.1`, was `^0.3.0`). An HTML e-mail or newsletter built
  from nested `<table role="presentation">` came out as one Markdown table cell on one line, its
  heading and paragraphs run together (the IronMemo letter, one 1,415-character cell holding its
  `<h1>` and 14 paragraphs). Such a table now converts as the blocks in its cells, in source order;
  a data table inside it stays a table. Images in a layout table keep the cell rule, so spacers and
  open-tracking pixels (empty alt) add nothing. The range moves for the reason given in 0.3.1: with
  a warm npx cache `page2ai-mcp` 0.4.0 still ran core 0.3.0.
- **`@page2ai/mcp` 0.4.0, P2A-023: the hosted endpoint clamps `timeout_ms`** to 20 s under the
  30 s Vercel function limit. A request with `timeout_ms` above 20 000 previously kept the
  connection alive past the function's hard limit and returned only keepalive comments.
- **SECURITY.md** no longer says the DNS-rebinding window is open (P2A-022). Core 0.3.0 closed it
  with DNS pinning; the published SECURITY.md of 0.4.0 still described it as a known limitation.
  Supported-versions table updated to 0.4.x.

## 0.4.0 - 2026-10-18

### Security
- **`@page2ai/core` 0.3.0: SSRF guard hardening (BL-22).** DNS pinning closes the rebinding
  window where `fetch()` could re-resolve a hostname to an internal address between the guard's
  check and the connect. Extended blocklists cover multicast, broadcast, TEST-NET, NAT64, 6to4,
  Teredo, documentation and discard IPv6 ranges. `undici` added as a transitive dependency through
  core (zero transitive deps of its own). Core engines raised from >=18.0 to >=18.17 (mcp stays
  >=20.0, unaffected).

## 0.3.2 - 2026-10-17

### Fixed
- **`@page2ai/core` 0.2.2: the review fix for 0.2.1's button rule** (P2A-019), and the dependency range starts there
  (`^0.2.2`, was `^0.2.1`). A page with thousands of sibling buttons converts in tens of milliseconds again (core
  0.2.1 took 1.0 to 5.7 s for 3,000 sibling buttons, measured on 2026-10-18), and the page text 0.2.1 left out
  comes back: an accordion's question with neither `aria-expanded` nor a heading (the session titles of a
  W3Schools-style accordion), a definition
  term, a question under `role="heading"`, a link written inside a button, and a command whose button is named «Copy
  command: <command>» (core CHANGELOG, 0.2.2). The range moves for the reason given under 0.3.1: measured again on
  2026-10-18, with core 0.2.2 out, an `npx` cache filled before it still ran `page2ai-mcp` 0.3.1 on core 0.2.1, and an
  empty cache ran core 0.2.2.
- README: the example output stays as captured on core 0.2.1: on 2026-10-18 core 0.2.2 converted that page byte for
  byte as 0.2.1 did, without the front matter.

## 0.3.1 - 2026-10-17

### Fixed
- **`@page2ai/core` 0.2.1: interface buttons no longer print as text** (P2A-019), and the dependency range starts
  there (`^0.2.1`, was `^0.2.0`). The header's «Copy page» with the glyph of its icon and the code-sample switcher
  («cURL …») of Mintlify, Vercel and Claude docs pages are gone from the tool's output; buttons that hold the page's
  own text stay (an accordion's question, a table column's name, a word of a sentence: core CHANGELOG, 0.2.1).
  The range moves because `npx` reuses a cached install while the server's own version stays the same: measured on
  2026-10-18 with an npx cache filled before core 0.2.1 came out, `npx -y page2ai-mcp` (0.3.0) still ran core
  0.2.0 after the release, and a cold cache ran 0.2.1.
- README: the example output is a new capture on core 0.2.1, without the buttons.

## 0.3.0 - 2026-10-17

### Changed (breaking)
- **`@page2ai/core` 0.2.0: the server reads only the page you name** (BL-49), and the dependency
  range starts there (`^0.2.0`, was `^0.1.13`). It no longer asks for `<url>.md` first, and its
  Accept header is the one Firefox sends when it opens a page, so Fumadocs, Mintlify, Vercel,
  Supabase, Cloudflare, Stripe and the Claude docs answer with the HTML page instead of their own
  Markdown copy, which can be older than the page. Measured live on 2026-10-17 with core 0.1.13
  (what 0.2.8 runs) against 0.2.0: on those seven platforms 0.2.8 returned the copy and 0.3.0
  converts the page, 1,301 to 57,887 characters, with every heading and code block of the copy
  except navigation lists and Cloudflare's JSON-LD (core CHANGELOG, 0.2.0). Content that Mintlify
  shows only to agents (`<Visibility for="agents">`) is gone, and what the page shows people is
  there, buttons inside the article included («Copy page», «cURL» on Mintlify, Vercel and the
  Claude docs).
- **Markdown sent for a page address is an error.** The request asks for HTML, so a server that
  still answers `text/markdown` picked its copy by something else (User-Agent, a cache). The tool
  returns `isError` with "Fetch failed: the server answered with Markdown ... for a page address",
  where 0.2.8 returned the copy as the page.
- `extractor_source` in the frontmatter is `markdown-response` for a Markdown or text file;
  `md-suffix` and `content-negotiation` no longer occur.

### Fixed
- **A Markdown or text file comes back as written.** A URL that names a `.md`, `.markdown`,
  `.mdown`, `.mkd`, `.mdx` or `.txt` file is returned as is whether the server sends
  `text/markdown`, `text/x-markdown`, `text/plain` or `application/octet-stream`. In 0.2.8 a
  `README.md` from raw.githubusercontent.com came out as one line from the middle of the file
  (3,468 of 11,408 characters, no heading), and an `llms.txt` lost its line breaks.
- **What the server says about itself matches the page-only fetch.** The tool description no
  longer says it tries `URL.md` first, and the MCPB manifest no longer says it requests a `.md`
  twin. PRIVACY.md said the server requests only the URLs you pass, while up to 0.2.8 it also
  requested `<url>.md`; it now says so, and its source links point at this repository and core
  instead of a directory of the extension's.
- README: the extension converts pages with its own pipeline, not `@page2ai/core` (BACKLOG
  BL-47), and the example output is a new capture on core 0.2.0.
- Lockfile: of what the server runs, only `@page2ai/core` moves (0.1.13 to 0.2.0);
  `@modelcontextprotocol/server` and `/core` stay 2.3.1, `zod` 4.5.4, `linkedom` 0.18.13.

## 0.2.8 - 2026-10-16

### Changed
- **`@page2ai/core` 0.1.13**, and the dependency range starts there (`^0.1.13`, was `^0.1.12`).
  What `page_to_markdown` returns changes on some pages (core CHANGELOG, 0.1.13):
  - a page streamed by React (Next.js App Router, Remix, Mintlify) returns its article instead
    of the `Loading...` fallback (Anthropic's extended-thinking docs gave 212 characters of
    `Loading...` for a 12,270-character article);
  - hidden text no longer reaches the agent through code, link names or a hidden `<main>`;
  - cells that span columns or rows no longer push later cells out from under their headers, a
    `<br>` in code breaks the line (every Docusaurus code block printed as one line), and an
    image in a table cell is written as its alt text;
  - `include_frontmatter: false` is honoured on docs sites that serve a `.md` twin or answer
    `text/markdown`; both paths added the frontmatter whatever the option said.
- Lockfile: of what the server runs, only `@page2ai/core` moves (0.1.12 to 0.1.13);
  `@modelcontextprotocol/server` and `/core` stay 2.3.1, `zod` 4.5.4, `linkedom` 0.18.13. The lock
  decides what the MCPB bundle carries. In the test tooling `source-map-js` moves from 1.2.1 to
  1.2.2 (GHSA-68fv-2mgg-jv7q, a denial of service through indexed source-map offsets; it came in
  through vitest, vite and postcss and was never in the published package).

### Fixed
- **What the server says about itself now matches what it does.** `server.json` (shown by the MCP
  Registry and the directories that copy it), the server's `serverInfo` and the hosted variant's said
  it converts "web pages or HTML": its one tool takes a URL. The tool description and the MCPB
  manifest said it "strips ads ... and cookie banners": it has no ad or cookie-banner filter; it keeps
  the page's main content and drops navigation, headers, footers and sidebars, which they now say. The
  manifest no longer says the server shares the browser extension's extraction core (the extension
  runs its own in-page pipeline), and the tool description now tells the model that a page behind a
  sign-in, or one rendered only by JavaScript, is out of this tool's reach.

## 0.2.7 - 2026-10-16

### Changed
- **`@page2ai/core` 0.1.12**, and the dependency range starts there (`^0.1.12`, was `^0.1.7`),
  so no install of this version resolves an older core. What `page_to_markdown` returns
  changes on most pages (core CHANGELOG, 0.1.12):
  - text sitting directly in a `<div>`, `<section>` or `<span>` is no longer dropped (on a
    server-rendered admin page 25 of 26 labels and values were missing while every heading
    and table survived);
  - code blocks, tables and paragraphs inside a list item stay in the item;
  - table cells keep their links, code and emphasis, and a table nested in a cell stays in
    that cell instead of repeating its rows in the outer table;
  - content under the `hidden` attribute is left out, except tab panels, hidden blocks
    holding code, `hidden="until-found"` sections and React streaming segments. Hidden text
    can carry instructions the person reading the page never sees; ordinary hidden content
    no longer reaches the agent, the kinds kept above still do.
- Lockfile: only `@page2ai/core` moves (0.1.11 to 0.1.12); `@modelcontextprotocol/server`
  and `/core` stay 2.3.1, `zod` 4.5.4. The lock decides what the MCPB bundle carries.

## 0.2.6 - 2026-10-11

### Added
- `serverInfo` carries `title` ("Page2AI"), `description` and `websiteUrl`, so clients that
  render server metadata show a name and a link instead of the bare package name.

### Changed
- **Releases are published through npm trusted publishing (OIDC)**, for `@page2ai/mcp` and
  for the `page2ai-mcp` wrapper alike. The publish workflow holds no npm token; the registry
  records GitHub Actions as the publisher, and the workflow fails when it records anyone else.
- Lockfile refreshed to what a fresh install already resolves: `@page2ai/core` 0.1.11 (was
  0.1.10; the 0.2.5 MCPB bundle carried 0.1.8), `@modelcontextprotocol/server` and
  `@modelcontextprotocol/core` 2.3.1 (was 2.0.0), `zod` 4.5.4. Dependency ranges are
  unchanged, so `npx` users get the same tree as before; the lock decides what the MCPB
  bundle carries, and the 0.2.6 bundle now matches it.
- README header leads with the LLM context use case (ChatGPT, Claude, Gemini); install notes
  added for Antigravity and the Claude Desktop one-click bundle.
- README restyled after a 10-reviewer documentation audit (2026-08-29): badges, quick start
  first, per-client install blocks for Claude Code / Claude Desktop / Cursor (deeplink) /
  VS Code / Codex CLI / Gemini CLI / Windsurf / Zed, and a verbatim output sample. Two
  long-standing README bugs fixed: the Windsurf config path (now
  `~/.codeium/windsurf/mcp_config.json`) and the Zed `context_servers` schema (flat
  `command`/`args`, the nested `command.path` form is legacy). Node.js 20+ requirement now
  stated up front. The "Zero external API calls" phrasing replaced with the accurate "the
  only network requests are to the URLs you pass it".
- MCPB `manifest.json` refreshed: version kept in step with `package.json`, node runtime
  `>=20`, description overclaim fixed, the real tool arguments documented.
- Personal email removed from README, `manifest.json` and `package.json` author metadata —
  same one-policy cleanup as the 0.2.4 Code of Conduct change; contact routes through the
  GitHub handle.

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
