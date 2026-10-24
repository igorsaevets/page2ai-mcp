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

## Agent Bridge (since 0.5.0; paired by a key since 0.6.0)

The server listens on `ws://127.0.0.1:3025` for the Page2AI browser extension, which can then open
the pages the agent asks for in the user's own browser. It binds loopback only and accepts a `Host`
of `127.0.0.1:<port>` or `localhost:<port>` only (DNS rebinding). The WebSocket `Origin` is a first
filter: Page2AI's Chrome Web Store ID, an exact origin listed in `PAGE2AI_BRIDGE_ORIGINS`, or any
`moz-extension://` origin (Firefox gives every install a random one).

**Pairing (page2ai-bridge/2, since 0.6.0).** The extension makes a 32-byte random key; the user
pastes it into this server's `PAGE2AI_BRIDGE_KEY`. On every connection the extension names the key
by the first 16 hex digits of its SHA-256 and sends a nonce; the server answers with its own nonce
and an HMAC-SHA256 over both nonces and its port; only if that checks out does the extension send
its HMAC, and only then does the server give the connection its single slot. Without a key the
server refuses every browser. This stops a program that listens on the port while no server runs
(0.5.0 to 0.5.4: the extension obeyed it, opened the pages in the signed-in browser and sent their
text back), a program that connects to the server without the key, other
browser extensions, web pages, and a relay through another port. At most 4 connections may wait in
the handshake, 5 s each. **Out of scope:** malware running as the same OS user, which can read the
key from the MCP client's config or the browser profile.
In scope: a web page, a remote host, another browser extension, another OS user, or a local program
without the key reaching the bridge or posing as it.

The SSRF guard applies through the bridge too (0.5.4; 0.5.0 to 0.5.3 sent private, loopback and
metadata URLs to the extension): the URL is checked, DNS included, before the browser opens it, and
a result whose final page is at a blocked address is refused. Two gaps remain, both in the browser's
hands: it follows redirects itself, so a public page that redirects to a private address is requested
before the server can refuse its text, and it resolves names itself, so a name this server cannot
resolve is passed to it (it may reach the name through a proxy).

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
