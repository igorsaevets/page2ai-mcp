// Node server for the hosted endpoint in a container (Dockerfile): the same handler as the Vercel
// function (api/mcp.ts), plus what Vercel gave for free and what one long-lived process needs.
//   /api/mcp      GET, POST, DELETE, OPTIONS (CORS preflight)
//   /healthz      200 without fetching anything
//   public/       the static pages; /.well-known/openai-apps-challenge as text/plain, no-store
// Limits: a 1 MB request body; per-client and global rate limits, and a cap on conversions running at
// once (lib/limits.mts); a client that goes away stops its page fetch (runWithFetchSignal). On SIGTERM it
// stops accepting, lets running requests finish for up to 25 s, and exits. One log line per request on
// stdout with the target's hostname only: no full URLs, no page content, no client address.
// Node 24 runs this TypeScript as is (type stripping): node server.mts
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWithFetchSignal } from '@page2ai/core';
import { handlePageToMarkdown } from '@page2ai/mcp/dist/tools/page-to-markdown.js';
import { CORS_HEADERS, handleMcp, handleOptions } from './api/mcp.ts';
import { ClientResolver, ConcurrencyGate, RateLimiter, type Client } from './lib/limits.mts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

const intEnv = (name: string, fallback: number, min = 0): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name}: "${raw}" is not an integer >= ${min}`);
  return value;
};

const CONFIG = {
  port: intEnv('PORT', 3000, 1),
  host: process.env.HOST?.trim() || '0.0.0.0',
  maxBody: intEnv('PAGE2AI_MAX_BODY_BYTES', 1024 * 1024, 1024),
  perIp: intEnv('PAGE2AI_RATE_PER_IP', 30, 1),
  perPlatformIp: intEnv('PAGE2AI_RATE_PER_PLATFORM_IP', 120, 1),
  global: intEnv('PAGE2AI_RATE_GLOBAL', 300, 1),
  ipv6Prefix: intEnv('PAGE2AI_RATE_IPV6_PREFIX', 64, 1),
  maxConcurrent: intEnv('PAGE2AI_MAX_CONCURRENT', 4, 1),
  perClient: intEnv('PAGE2AI_MAX_CONCURRENT_PER_CLIENT', 2, 1),
  graceMs: intEnv('PAGE2AI_SHUTDOWN_GRACE_MS', 25_000, 0),
};

const log = (entry: Record<string, unknown>): void => {
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
};

// --- static files: read once at start (about 0.25 MB) ---------------------------------------------
interface StaticFile { body: Buffer; type: string; cache: string }
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};
const staticFiles = new Map<string, StaticFile>();
const loadStatic = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { loadStatic(full); continue; }
    const path = '/' + relative(join(ROOT, 'public'), full).split(sep).join('/');
    const ext = /\.[a-z0-9]+$/i.exec(name)?.[0].toLowerCase() ?? '';
    staticFiles.set(path, {
      body: readFileSync(full),
      type: TYPES[ext] ?? 'application/octet-stream',
      cache: 'public, max-age=0, must-revalidate',
    });
  }
};
loadStatic(join(ROOT, 'public'));
// The OpenAI domain-verification token (was a header rule in vercel.json).
const challenge = staticFiles.get('/.well-known/openai-apps-challenge');
if (challenge) Object.assign(challenge, { type: 'text/plain', cache: 'no-store' });
const index = staticFiles.get('/index.html');
if (index) staticFiles.set('/', index);

// --- limits -----------------------------------------------------------------------------------------
const ranges = JSON.parse(readFileSync(join(ROOT, 'lib', 'platform-ranges.json'), 'utf8')) as {
  openai: string[];
  anthropic: string[];
};
const clients = new ClientResolver({ openai: ranges.openai, anthropic: ranges.anthropic }, CONFIG.ipv6Prefix);
const limiter = new RateLimiter({ perIp: CONFIG.perIp, perPlatformIp: CONFIG.perPlatformIp, global: CONFIG.global });
const gate = new ConcurrencyGate(CONFIG.maxConcurrent, CONFIG.perClient);

// A per-process tag of the client, so one client's requests can be told apart in the log without the
// log holding its address. The key changes on every start.
const TAG_KEY = randomBytes(16);
const tagOf = (client: Client): string => createHmac('sha256', TAG_KEY).update(client.key).digest('hex').slice(0, 8);

// Caddy sets X-Real-IP (and X-Forwarded-For) from Cloudflare's CF-Connecting-IP and Traefik keeps them;
// only Cloudflare can reach the server. The socket address is Traefik's, a last resort for local runs.
const clientIp = (req: IncomingMessage): string =>
  (req.headers['x-real-ip'] as string | undefined)?.trim() ||
  (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
  req.socket.remoteAddress ||
  '';

// --- helpers ------------------------------------------------------------------------------------------
const rpcError = (code: number, message: string): string => JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });

interface RpcInfo { method?: string; id?: unknown; toolCall: boolean; target?: string }
const rpcInfo = (body: Buffer): RpcInfo => {
  try {
    const message = JSON.parse(body.toString('utf8')) as unknown;
    const calls = (Array.isArray(message) ? message : [message]) as {
      method?: unknown; id?: unknown; params?: { arguments?: { url?: unknown } };
    }[];
    const tool = calls.find((c) => c?.method === 'tools/call');
    let target: string | undefined;
    const url = tool?.params?.arguments?.url;
    if (typeof url === 'string') {
      try { target = new URL(url).hostname; } catch { target = 'invalid-url'; }
    }
    const first = calls[0];
    return {
      method: Array.isArray(message) ? 'batch' : typeof first?.method === 'string' ? first.method : undefined,
      id: tool?.id ?? first?.id,
      toolCall: tool !== undefined,
      target,
    };
  } catch {
    return { toolCall: false, method: 'unparsed' };
  }
};

class BodyTooLarge extends Error {}
// Past the cap the rest is read and dropped, so the 413 still reaches the client.
const readBody = (req: IncomingMessage, max: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) {
      reject(new BodyTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= max) chunks.push(chunk);
    });
    req.on('end', () => (size > max ? reject(new BodyTooLarge()) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });

const sendText = (res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
};

// Waits for 'drain', or for the socket to close (then nobody will ever drain it).
const drained = (res: ServerResponse): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => { res.off('drain', done); res.off('close', done); resolve(); };
    res.on('drain', done);
    res.on('close', done);
  });

// Streams the handler's response. After the client has gone the body is still read to its end, so the
// tool call finishes (its fetch was aborted) before its conversion slot is given back.
const pipeResponse = async (response: Response, res: ServerResponse, method: string): Promise<void> => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  res.writeHead(response.status, headers);
  if (!response.body || method === 'HEAD') { res.end(); return; }
  const reader = response.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!res.destroyed && !res.write(value)) await drained(res);
  }
  if (!res.destroyed) res.end();
};

const serveStatic = (req: IncomingMessage, res: ServerResponse, path: string): boolean => {
  const file = staticFiles.get(path);
  if (!file) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed\n', { allow: 'GET, HEAD' });
    return true;
  }
  const headers: Record<string, string> = {
    'content-type': file.type,
    'cache-control': file.cache,
    'accept-ranges': 'bytes',
  };
  // One byte range, enough for a browser playing the demo video.
  const range = /^bytes=(\d*)-(\d*)$/.exec((req.headers.range as string | undefined) ?? '');
  if (range && (range[1] || range[2])) {
    const size = file.body.length;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) });
    res.end(req.method === 'HEAD' ? undefined : file.body.subarray(start, end + 1));
    return true;
  }
  res.writeHead(200, { ...headers, 'content-length': String(file.body.length) });
  res.end(req.method === 'HEAD' ? undefined : file.body);
  return true;
};

// --- the MCP route ------------------------------------------------------------------------------------
const handleApi = async (req: IncomingMessage, res: ServerResponse, entry: Record<string, unknown>): Promise<void> => {
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') {
    await pipeResponse(handleOptions(), res, method);
    return;
  }
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    sendText(res, 405, 'Method not allowed\n', { allow: 'GET, POST, DELETE, OPTIONS', ...CORS_HEADERS });
    return;
  }
  const client = clients.resolve(clientIp(req));
  entry.c = tagOf(client);
  if (client.platform) entry.pf = client.platform;

  let body: Buffer | undefined;
  if (method === 'POST') {
    try {
      body = await readBody(req, CONFIG.maxBody);
    } catch (e) {
      if (!(e instanceof BodyTooLarge)) throw e;
      entry.note = 'body-too-large';
      res.writeHead(413, { 'content-type': 'application/json', connection: 'close', ...CORS_HEADERS });
      res.end(rpcError(-32600, `Request body too large (max ${CONFIG.maxBody} bytes).`));
      req.resume();
      return;
    }
  }
  if (!limiter.take(client)) {
    entry.note = 'rate-limited';
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60', ...CORS_HEADERS });
    res.end(rpcError(-32000, 'Rate limited: try again in a minute.'));
    return;
  }

  const info = body ? rpcInfo(body) : { toolCall: false } as RpcInfo;
  if (info.method) entry.rpc = info.method;
  if (info.target) entry.host = info.target;

  let release: (() => void) | null = null;
  if (info.toolCall) {
    release = gate.acquire(client);
    if (!release) {
      entry.note = 'busy';
      res.writeHead(200, { 'content-type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: info.id ?? null,
        result: {
          isError: true,
          content: [{
            type: 'text',
            text: 'Page2AI is busy: the hosted endpoint is converting as many pages as it allows at once. ' +
              'Retry in a few seconds, or run the local server (npx -y page2ai-mcp), which has no such limit.',
          }],
        },
      }));
      return;
    }
  }

  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) {
      entry.note = entry.note ?? 'client-gone';
      abort.abort();
    }
  });
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  const request = new Request(`http://localhost${req.url ?? '/api/mcp'}`, {
    method,
    headers,
    body: method === 'POST' && body ? new Uint8Array(body) : undefined,
    signal: abort.signal,
  });
  try {
    const response = await runWithFetchSignal(abort.signal, () => handleMcp(request));
    await runWithFetchSignal(abort.signal, () => pipeResponse(response, res, method));
  } finally {
    release?.();
  }
};

// --- server -------------------------------------------------------------------------------------------
let shuttingDown = false;
const inflight = new Set<ServerResponse>();

const server = createServer((req, res) => {
  const started = performance.now();
  const path = (req.url ?? '/').split('?')[0];
  const entry: Record<string, unknown> = { m: req.method, p: path };
  inflight.add(res);
  res.on('close', () => {
    inflight.delete(res);
    if (path === '/healthz') return;
    const ms = Math.round(performance.now() - started);
    // After the route's own 'close' listener, which notes a client that went away.
    setImmediate(() => log({ ...entry, s: res.statusCode, ms }));
  });
  if (shuttingDown) {
    sendText(res, 503, 'Shutting down\n', { connection: 'close', 'retry-after': '5' });
    return;
  }
  if (path === '/healthz') {
    sendText(res, 200, 'ok\n');
    return;
  }
  const work = path === '/api/mcp'
    ? handleApi(req, res, entry)
    : Promise.resolve(serveStatic(req, res, path) || sendText(res, 404, 'Not found\n'));
  work.catch((e: unknown) => {
    entry.err = e instanceof Error ? e.name : 'error';
    process.stderr.write(`[page2ai-remote] ${e instanceof Error ? e.stack : String(e)}\n`);
    if (!res.headersSent) sendText(res, 500, 'Internal error\n');
    else if (!res.destroyed) res.destroy();
  });
});

// Traefik keeps idle upstream connections for 90 s: close ours later than that, so it never reuses a
// socket this side has just closed.
server.keepAliveTimeout = 95_000;
server.headersTimeout = 100_000;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  log({ event: 'shutdown', signal, inflight: inflight.size });
  server.close();
  server.closeIdleConnections();
  const deadline = Date.now() + CONFIG.graceMs;
  const timer = setInterval(() => {
    server.closeIdleConnections();
    if (inflight.size === 0 || Date.now() >= deadline) {
      clearInterval(timer);
      if (inflight.size > 0) log({ event: 'shutdown-cut', inflight: inflight.size });
      server.closeAllConnections();
      process.exit(0);
    }
  }, 250);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[page2ai-remote] unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
});

// --- start-up self-test: the fetch policy must reach the code path real requests use ----------------
// PAGE2AI_ALLOWED_PORTS / PAGE2AI_EXTRA_BLOCKED_IPS are read by @page2ai/core; an older core, or a second
// copy under @page2ai/mcp, would ignore them without a word. Each set rule is proven on the real handler
// (refused before any network use) or the server does not start.
const selfTest = async (): Promise<void> => {
  const textOf = async (url: string): Promise<string> => {
    const result = await handlePageToMarkdown({ url, timeout_ms: 5000, include_images: false, include_frontmatter: false });
    return result.content.map((c) => ('text' in c ? c.text : '')).join(' ');
  };
  if (process.env.PAGE2AI_REQUIRE_BLOCKED_IPS === '1' && !process.env.PAGE2AI_EXTRA_BLOCKED_IPS?.trim()) {
    throw new Error('PAGE2AI_EXTRA_BLOCKED_IPS is empty; this image requires the server\'s own address in it');
  }
  if (process.env.PAGE2AI_ALLOWED_PORTS?.trim()) {
    const text = await textOf('http://page2ai-selftest.invalid:1/');
    if (!/port 1 is not allowed/.test(text)) throw new Error(`port rule not in effect: ${text.slice(0, 200)}`);
  }
  const firstBlocked = process.env.PAGE2AI_EXTRA_BLOCKED_IPS?.split(',')[0]?.trim().split('/')[0];
  if (firstBlocked) {
    const host = firstBlocked.includes(':') ? `[${firstBlocked}]` : firstBlocked;
    const text = await textOf(`http://${host}/`);
    if (!/not allowed on this server/.test(text)) throw new Error('extra blocked addresses not in effect');
  }
  if (existsSync(join(ROOT, 'node_modules', '@page2ai', 'mcp', 'node_modules', '@page2ai', 'core'))) {
    throw new Error('a second @page2ai/core under @page2ai/mcp: the abort signal would not reach its fetches');
  }
};

try {
  await selfTest();
} catch (e) {
  process.stderr.write(`[page2ai-remote] start-up check failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

server.listen(CONFIG.port, CONFIG.host, () => {
  log({
    event: 'listening',
    port: CONFIG.port,
    limits: {
      perIp: CONFIG.perIp, perPlatformIp: CONFIG.perPlatformIp, global: CONFIG.global, ipv6Prefix: CONFIG.ipv6Prefix,
      maxConcurrent: CONFIG.maxConcurrent, perClient: CONFIG.perClient, maxBody: CONFIG.maxBody,
    },
    ports: process.env.PAGE2AI_ALLOWED_PORTS ?? 'any',
    extraBlocked: process.env.PAGE2AI_EXTRA_BLOCKED_IPS?.split(',').filter((s) => s.trim()).length ?? 0,
    maxTimeoutMs: process.env.PAGE2AI_MAX_TIMEOUT_MS ?? '20000 (default)',
    platformRanges: { fetched: (ranges as { fetched?: string }).fetched, openai: ranges.openai.length, anthropic: ranges.anthropic.length },
  });
});
