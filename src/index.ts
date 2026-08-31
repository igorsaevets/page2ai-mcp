#!/usr/bin/env node
// @page2ai/mcp — MCP server entry point.
// Runs as a stdio subprocess spawned by Claude Desktop, Cursor, Windsurf, Zed.
// Registers a single tool `page_to_markdown` that converts URLs to Markdown
// via @page2ai/core (SSRF-guarded, 10MB size cap, 15s timeout by default).
//
// Protocol: serves BOTH the 2025-11-25 and 2026-07-28 revisions. `serveStdio`
// owns the era decision per connection: the opening exchange selects it, one
// instance from the factory is pinned for the connection's lifetime. Clients on
// older SDKs still send `initialize` and are served exactly as before; clients
// that probe with `server/discover` get the 2026-07-28 era. Wiring a `Server`
// straight to a `StdioServerTransport` — as this file did through v0.1.2 —
// serves only the 2025 era no matter which SDK version is installed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Server } from '@modelcontextprotocol/server';
import { handlePageToMarkdown, pageToMarkdownDefinition } from './tools/page-to-markdown.js';

const SERVER_NAME = 'page2ai-mcp';

// Read the version from package.json instead of restating it here.
//
// This used to be `const SERVER_VERSION = '0.2.0'`, a third source of truth beside
// package.json and manifest.json, kept in sync by remembering to. It drifted on the very next
// release: 0.2.1 shipped while the running server still introduced itself over the wire as
// 0.2.0, so a client asking what it was talking to got the wrong answer and nothing failed.
//
// Wrapped because a version string is not worth crashing a server over: if the layout ever
// changes and the file is not where dist/index.js expects it, an unknown version is a far
// better outcome than a server that will not start.
const SERVER_VERSION = ((): string => {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version || '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
})();

// Log to stderr — stdio transport uses stdout for JSON-RPC frames, so anything
// written to stderr is safe (Claude Desktop logs it to the debug console).
const log = (msg: string): void => {
  process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
};

// Called once per connection by serveStdio, after the era is known. Registration
// is identical for both eras — the SDK adapts the wire format underneath.
const buildServer = (): Server => {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      title: 'Page2AI',
      description:
        'Convert any webpage or HTML to clean Markdown for ChatGPT, Claude, and Gemini ' +
        'context. Preserves code blocks with language hints, tables, and reading structure. ' +
        'Zero telemetry, MIT-licensed.',
      websiteUrl: 'https://github.com/igorsaevets/page2ai-mcp',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler('tools/list', async () => ({
    tools: [pageToMarkdownDefinition],
  }));

  server.setRequestHandler('tools/call', async (request) => {
    const toolName = request.params.name;
    const toolArgs = request.params.arguments ?? {};
    if (toolName === 'page_to_markdown') {
      return handlePageToMarkdown(toolArgs);
    }
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${toolName}` }],
    };
  });

  return server;
};

const handle = serveStdio(buildServer, {
  // 'serve' is the default and is stated here on purpose: rejecting the 2025
  // era would break every client still on an older SDK, which is most of them.
  legacy: 'serve',
  onerror: (err) => log(`transport error: ${err.message}`),
});

log(`server ${SERVER_VERSION} ready on stdio (tools: page_to_markdown)`);

const shutdown = (signal: string): void => {
  log(`${signal} received, closing`);
  handle.close().then(
    () => process.exit(0),
    (err: unknown) => {
      log(`close failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
