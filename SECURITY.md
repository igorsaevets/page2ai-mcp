# Security Policy

## Reporting a vulnerability

**Use [GitHub private vulnerability reporting](https://github.com/igorsaevets/page2ai-mcp/security/advisories/new).**
It is enabled on this repository. Nothing is public until an advisory is published, you get a
private thread with the maintainer, and no email address has to be guessed or harvested.

Do not open a public issue for a security problem.

Expect a first response within 3 business days. Coordinated disclosure: you are credited in the
advisory and the fix commit unless you ask to stay anonymous.

## Supported versions

Only the latest minor release receives fixes.

| Version | Supported |
|---------|-----------|
| 0.5.x   | yes       |
| < 0.5   | no        |

## What this server does, so you know what counts as a bug

`@page2ai/mcp` runs on the user's machine, started by whatever MCP client launched it. It exposes a
single read-only tool, `page_to_markdown`, which fetches an HTTP(S) URL and converts it to Markdown
locally with `linkedom`. There is no backend, no telemetry, no remote code execution, and no
credential storage.

In scope, and treated as a vulnerability:

- Reaching a private network range, loopback, link-local, or a cloud metadata endpoint through the
  `url` argument, a redirect chain, or DNS. The SSRF guard is meant to block all of these.
- Escaping the fetch budget: unbounded response size, an unbounded redirect chain, or a request
  that ignores `timeout_ms`.
- Reading anything on the filesystem, or writing outside stdout.
- Anything that turns a converted page into code the host process executes.

Guard status (as of `@page2ai/core` 0.3.0, 2026-10-18): the URL string, the hostname's resolved
DNS addresses, and every redirect hop are validated before the request is made, and redirects are
followed manually with a 10-hop cap. Since core 0.3.0 the DNS rebinding window is closed: the
guard resolves DNS once, validates every returned address, and pins the TCP connection to those
addresses via an undici `Agent`, so `fetch()` cannot re-resolve the hostname to a different IP.
Extended blocklists cover multicast, broadcast, TEST-NET, NAT64, 6to4, Teredo, documentation and
discard IPv6 ranges.

## Agent Bridge (since 0.5.0)

The server listens on `ws://127.0.0.1:3025` for the Page2AI browser extension, which can then open
the pages the agent asks for in the user's own browser. It binds loopback only, accepts a `Host` of
`127.0.0.1:<port>` or `localhost:<port>` only (DNS rebinding), and accepts the extension by its
WebSocket `Origin`: Page2AI's Chrome Web Store ID, or an exact origin listed in
`PAGE2AI_BRIDGE_ORIGINS` (0.5.0 to 0.5.2 accepted any `moz-extension://` origin, so any Firefox
extension; fixed in 0.5.3). A web page or another browser extension cannot forge that origin;
another program on the same computer can, so the bridge is no stronger than the local user account.
In scope: a web page, a remote host, or another browser extension reaching the bridge.

## Extraction is not sanitization

🔴 **The Markdown this server returns is untrusted input, exactly as untrusted as the page it came
from.** A web page can contain text designed to be read as instructions by whatever model consumes
the output. Stripping navigation and ads removes clutter, not intent. This tool makes no attempt to
detect or neutralise prompt injection, and a page that carries it is working as designed from the
attacker's point of view.

If you feed the output into an agent that can act, the boundary you need is on your side: treat the
Markdown as data, not as a message from the user, and do not let a fetched page widen what the
agent is allowed to do. A page that successfully instructs the *model* is not a bug in this server.
A page that reaches the *network or filesystem* through this server is.

## Supply chain

Releases from v0.1.2 onward are published from GitHub Actions with npm provenance: each version
carries a Sigstore attestation naming the commit and workflow run that produced it. Verify before
you trust:

```bash
npm audit signatures
npm view @page2ai/mcp dist.attestations
```
