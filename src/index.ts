#!/usr/bin/env node
// @page2ai/mcp — MCP server entry point.
// Runs as a stdio subprocess spawned by Claude Desktop, Cursor, Windsurf, Zed.
// Registers a single tool `page_to_markdown` that converts URLs to Markdown
// via @page2ai/core (SSRF-guarded, 10MB size cap, 15s timeout by default).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { handlePageToMarkdown, pageToMarkdownDefinition } from './tools/page-to-markdown.js';

const SERVER_NAME = 'page2ai-mcp';
const SERVER_VERSION = '0.1.0';

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

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [pageToMarkdownDefinition],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

// Log to stderr — stdio transport uses stdout for JSON-RPC frames, so anything
// written to stderr is safe (Claude Desktop logs it to the debug console).
const log = (msg: string): void => {
  process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
};

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`server ${SERVER_VERSION} ready on stdio (tools: page_to_markdown)`);
};

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
