// Hosted (Streamable HTTP) variant of the Page2AI MCP server, for Vercel.
// Reuses the exact tool implementation shipped in @page2ai/mcp, so the hosted
// endpoint inherits the same SSRF guard, 10MB size cap, timeout enforcement
// and error mapping as the local stdio server — one source of truth.
import { createMcpHandler } from 'mcp-handler';
import {
  pageToMarkdownDefinition,
  pageToMarkdownInputSchema,
  handlePageToMarkdown,
} from '@page2ai/mcp/dist/tools/page-to-markdown.js';

// A public endpoint that fetches arbitrary URLs is an open fetch-proxy by
// definition, so it rate-limits itself even before any platform WAF rules.
// Serverless instances do not share memory: each warm instance keeps its own
// window, which bounds bursts per instance; platform rules bound the rest.
const WINDOW_MS = 60_000;
const MAX_PER_IP = 30;
const MAX_PER_INSTANCE = 300;
const hits = new Map<string, { count: number; resetAt: number }>();
let instanceWindow = { count: 0, resetAt: 0 };

function limited(ip: string): boolean {
  const now = Date.now();
  if (now > instanceWindow.resetAt) {
    instanceWindow = { count: 0, resetAt: now + WINDOW_MS };
  }
  instanceWindow.count += 1;
  if (instanceWindow.count > MAX_PER_INSTANCE) return true;

  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    // Hard memory bound under address-rotation abuse; dropping fresh windows
    // only makes the limiter more permissive for one window, never less safe
    // for the instance thanks to the instance-wide counter above.
    if (hits.size > 10_000) hits.clear();
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_IP;
}

const mcp = createMcpHandler(
  (server) => {
    server.registerTool(
      pageToMarkdownDefinition.name,
      {
        title: pageToMarkdownDefinition.title,
        description: pageToMarkdownDefinition.description,
        inputSchema: pageToMarkdownInputSchema,
        annotations: pageToMarkdownDefinition.annotations,
      },
      async (args) => handlePageToMarkdown(args),
    );
  },
  {
    serverInfo: { name: 'page2ai-mcp-remote', version: '0.1.0' },
  },
);

async function withLimit(req: Request): Promise<Response> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (limited(ip)) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Rate limited: try again in a minute.' },
        id: null,
      }),
      {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '60' },
      },
    );
  }
  return mcp(req);
}

export { withLimit as GET, withLimit as POST, withLimit as DELETE };
