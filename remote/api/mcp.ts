// Hosted (Streamable HTTP) variant of the Page2AI MCP server, for Vercel.
// Reuses the exact tool implementation shipped in @page2ai/mcp, so the hosted
// endpoint inherits the same SSRF guard, 10MB size cap, timeout enforcement
// and error mapping as the local stdio server — one source of truth.
import { createMcpHandler } from 'mcp-handler';
// The hosted definition is the contract the ChatGPT plugin was reviewed with (a URL only,
// no Agent Bridge); the local server's own definition also takes `html` and names the bridge.
import {
  pageToMarkdownHostedDefinition,
  pageToMarkdownHostedInputSchema,
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
    // Memory bound under address-rotation abuse: evict only expired windows,
    // never live ones, so a hot IP cannot ride a mass-eviction to a fresh
    // window. The instance-wide counter above caps the blast radius anyway.
    if (hits.size > 10_000) {
      for (const [key, value] of hits) {
        if (now > value.resetAt) hits.delete(key);
      }
    }
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_IP;
}

// vercel.json stops this function at 30 s (maxDuration, cut from 90 on 2026-08-30 as the
// cost cap, commit 31bd82f), while the shared tool schema accepts timeout_ms up to 60 000.
// Unclamped, a slow page fetched with a long timeout outlived the function: the platform
// ended the SSE stream with no JSON-RPC response, so the client got neither a result nor a
// reason (P2A-023, reproduced 2026-10-19). Clamped, the fetch aborts first and the tool
// answers with its own error. 20 s leaves 10 s for start-up and conversion: a 7.6 MB page
// (tc39.es/ecma262) took 6.7 s end to end on this endpoint, and the size cap is 10 MB.
const HOSTED_MAX_TIMEOUT_MS = 20_000;

async function handleHosted(args: unknown) {
  // Parsed against the hosted contract, so nothing outside it (an `html`) reaches the
  // shared handler, which would accept it.
  const parsed = pageToMarkdownHostedInputSchema.safeParse(args);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    return { isError: true, content: [{ type: 'text' as const, text: `Invalid input: ${msg}` }] };
  }
  if (parsed.data.timeout_ms <= HOSTED_MAX_TIMEOUT_MS) {
    return handlePageToMarkdown(parsed.data);
  }
  const requested = parsed.data.timeout_ms;
  const result = await handlePageToMarkdown({ ...parsed.data, timeout_ms: HOSTED_MAX_TIMEOUT_MS });
  const first = result.content[0];
  if (result.isError && first?.type === 'text' && first.text.startsWith('Fetch timed out after')) {
    const note =
      ` This hosted endpoint caps timeout_ms at ${HOSTED_MAX_TIMEOUT_MS} (${requested} was requested)` +
      ' because its platform stops every request at 30 s; the local server' +
      ' (npx -y page2ai-mcp) accepts up to 60000.';
    return { ...result, content: [{ ...first, text: first.text + note }, ...result.content.slice(1)] };
  }
  return result;
}

// mcp-handler v2 declares serverInfo as `{ name; version }` only, but the underlying
// @modelcontextprotocol/server v2 Implementation schema also accepts title, description,
// websiteUrl, and icons. Passing them through populates the `initialize` response that
// directories (LobeHub, Cursor Directory, MCP Registry, mcp.pub) read verbatim to render
// server cards. The assignment goes through a variable so TS excess-property check is
// evaluated at the wider inferred type, and the cast then narrows to the declared shape.
const serverInfoWithMetadata = {
  name: 'page2ai-mcp-remote',
  version: '0.1.2',
  title: 'Page2AI (hosted)',
  description:
    'Convert any webpage URL to clean Markdown for ChatGPT, Claude, and Gemini ' +
    'context. Preserves code blocks with language hints, tables, and reading structure. ' +
    'Zero telemetry, MIT-licensed. Hosted variant of @page2ai/mcp.',
  websiteUrl: 'https://page2ai-mcp-remote.vercel.app',
};

const mcp = createMcpHandler(
  (server) => {
    server.registerTool(
      pageToMarkdownHostedDefinition.name,
      {
        title: pageToMarkdownHostedDefinition.title,
        description: pageToMarkdownHostedDefinition.description,
        inputSchema: pageToMarkdownHostedInputSchema,
        annotations: pageToMarkdownHostedDefinition.annotations,
      },
      async (args) => handleHosted(args),
    );
  },
  {
    serverInfo: serverInfoWithMetadata as { name: string; version: string },
    // Tools-only server: no resources, so no subscription streams to serve.
    maxSubscriptions: 0,
  },
);

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, mcp-session-id, mcp-protocol-version, authorization',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
  // Tool results are conversions of live pages; a cached reply is a stale page.
  'cache-control': 'no-store',
};

function handleOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// The MCP Streamable HTTP spec (2025-11-25 and 2026-07-28 alike) requires
// servers to validate Origin. Non-browser clients send none — allowed; any
// https origin is fine for a public endpoint; http/file/null origins are the
// DNS-rebinding shapes the rule exists to reject.
function originAllowed(origin: string | null): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).protocol === 'https:';
  } catch {
    return false;
  }
}

async function withLimit(req: Request): Promise<Response> {
  if (!originAllowed(req.headers.get('origin'))) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32003, message: 'Forbidden origin.' },
        id: null,
      }),
      { status: 403, headers: { 'content-type': 'application/json', ...CORS_HEADERS } },
    );
  }
  // x-real-ip is set by Vercel from the TCP connection and is not client-
  // spoofable; x-forwarded-for's leftmost entry is the documented fallback.
  // If a proxy ever fronts this deployment, switch to x-vercel-forwarded-for.
  const ip =
    req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  if (limited(ip)) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Rate limited: try again in a minute.' },
        id: null,
      }),
      {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '60', ...CORS_HEADERS },
      },
    );
  }
  const response = await mcp(req);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { withLimit as GET, withLimit as POST, withLimit as DELETE, handleOptions as OPTIONS };
