# Page2AI MCP Server — Privacy Policy

**Last updated:** 2026-07-23
**Applies to:** `@page2ai/mcp` npm package v0.1.0+

## What data this MCP server collects

**None.**

`@page2ai/mcp` is a stateless local Node.js process. When invoked with a URL:

1. It fetches the URL via Node's built-in `fetch()` API
2. Parses the HTML response via [linkedom](https://github.com/WebReflection/linkedom) (a lightweight in-memory DOM parser)
3. Extracts main content and converts it to Markdown
4. Returns the Markdown to the calling MCP client (Claude Desktop, Cursor, Windsurf, Zed, VS Code, etc.)

The server does not:
- Store any content on disk beyond ephemeral memory during processing
- Send telemetry, analytics, crash reports, or any other data to any third party
- Maintain user accounts, API keys, or authentication state
- Track requests or responses across invocations
- Log requests or responses to any location outside the calling MCP client's own logs

## What data the MCP client may log

The MCP client (Claude Desktop, Cursor, etc.) that invokes `@page2ai/mcp` may log tool invocations and results according to its own privacy policy. Refer to the specific client's privacy policy for details.

## Network communication

`@page2ai/mcp` makes outbound HTTP/HTTPS requests only to the URLs explicitly provided as tool arguments. It makes no other network calls. It does not phone home, does not check for updates over the network, and does not send crash reports.

## Authentication

`@page2ai/mcp` has no authentication mechanism because it has no user accounts or state. It cannot access content behind login walls or authenticated sessions.

## Source code and audit

The full source code is available at:
- https://github.com/igorsaevets/page2ai-extension (in the `packages/mcp/` directory once published)

Users can audit the source code to verify these privacy claims.

## Reporting concerns

If you believe you have found a privacy issue with `@page2ai/mcp`:
- **Email:** igorsaevets@gmail.com
- **Subject line:** `[Page2AI MCP Privacy]`

## Changes to this policy

This policy will be versioned in the same repository as the source code. Material changes will be reflected in a new version of the npm package with an accompanying changelog entry.
