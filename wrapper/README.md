# page2ai-mcp

Unscoped alias for **[`@page2ai/mcp`](https://www.npmjs.com/package/@page2ai/mcp)**, so that the
server can be started without remembering the scope:

```bash
npx -y page2ai-mcp
```

That is all this package is. It contains a two-line entry point that imports the real server, and
it pins the scoped package to an exact version so the two can never drift apart.

Everything — the tools, the configuration, the privacy posture, the security notes — is documented
in the scoped package and at **https://igorsaevets.github.io/page2ai-docs/**.

Prefer `@page2ai/mcp` directly if you are adding a dependency to a project. Use this name when you
want a one-line `npx` command.

## Provenance

Both this package and `@page2ai/mcp` are published from GitHub Actions with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements), so the tarball on the
registry is cryptographically linked to the workflow run and commit that produced it. Verify with:

```bash
npm audit signatures
```

MIT © Igor Saevets
