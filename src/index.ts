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
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Server } from '@modelcontextprotocol/server';
import { handlePageToMarkdown, pageToMarkdownDefinition } from './tools/page-to-markdown.js';

const SERVER_NAME = 'page2ai-mcp';
const SERVER_VERSION = '0.2.0';

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
