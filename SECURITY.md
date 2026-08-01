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
| 0.2.x   | yes       |
| < 0.2   | no        |

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
