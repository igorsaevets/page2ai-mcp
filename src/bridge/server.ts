// Agent Bridge: localhost-only WebSocket server that connects @page2ai/mcp
// to the Page2AI browser extension for extraction through the user's real
// browser (cookies, JS rendering, extension-quality Markdown).
//
// Security model (BrowserTools MCP v2.0, post GHSA-xvrv-w8pg-f25f):
//   1. Bind 127.0.0.1 only (never 0.0.0.0)
//   2. Origin validation: Page2AI's Chrome Web Store origin, and the exact origins
//      in PAGE2AI_BRIDGE_ORIGINS (a Firefox install, an unpacked build)
//   3. Host header: must be 127.0.0.1:PORT or localhost:PORT
//   4. Per-session token: generated on auth, required on every message

import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BRIDGE_PROTOCOL,
  BridgeError,
  DEFAULT_BRIDGE_PORT,
  type BridgeConvertOptions,
  type BridgeConvertResult,
  type ConvertRequestMessage,
  type ExtensionMessage,
  type WelcomeMessage,
  type PongMessage,
  type ServerErrorMessage,
} from './protocol.js';

/** Page2AI's Chrome Web Store ID: Chrome, Edge and the other Chromium browsers
 *  that install from the store send this Origin. */
export const PAGE2AI_CHROME_ORIGIN = 'chrome-extension://dlpaaijcnbbmlfeohlphjpnbbcnomnno';

const isWebUrl = (url: string): boolean => {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
};

type PendingRequest = {
  resolve: (result: BridgeConvertResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class BridgeServer {
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private sessionToken: string | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private readonly port: number;
  private readonly serverVersion: string;
  private readonly log: (msg: string) => void;
  private readonly extraOrigins: readonly string[];

  constructor(opts: {
    port?: number;
    serverVersion: string;
    log: (msg: string) => void;
    /** Exact origins accepted beside the store's, e.g. an unpacked build's. */
    extraOrigins?: readonly string[];
  }) {
    this.port = opts.port ?? DEFAULT_BRIDGE_PORT;
    this.serverVersion = opts.serverVersion;
    this.log = opts.log;
    this.extraOrigins = opts.extraOrigins ?? [];
  }

  isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    this.httpServer = createServer((_req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('WebSocket upgrade required');
    });

    // Phase 1: bind the HTTP server. The WSS is attached only AFTER a
    // successful listen so a listen error (EADDRINUSE when another MCP
    // instance already runs on this host, same port) rejects cleanly.
    // Attaching the WSS to a server that then fails to listen leaks the
    // error through ws's internal `this._server.on('error', this.emit...)`,
    // and nothing listens on wss.on('error') → the process crashes.
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => {
          this.httpServer!.off('error', onError);
          reject(err);
        };
        this.httpServer!.once('error', onError);
        this.httpServer!.listen(this.port, '127.0.0.1', () => {
          this.httpServer!.off('error', onError);
          resolve();
        });
      });
    } catch (err) {
      this.httpServer = null;
      throw err;
    }

    this.wss = new WebSocketServer({
      server: this.httpServer,
      verifyClient: (info, cb) => {
        const allowed = this.verifyUpgrade(info.req);
        if (!allowed) {
          cb(false, 403, 'Forbidden');
          return;
        }
        cb(true);
      },
    });

    // Catch any wss-level error after startup (uncommon, but ws re-emits
    // any underlying server error here). Individual connection errors are
    // caught in handleConnection via ws.on('error').
    this.wss.on('error', (err: Error) => {
      this.log(`bridge wss error: ${err.message}`);
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    this.log(`bridge listening on ws://127.0.0.1:${this.port}`);
  }

  async stop(): Promise<void> {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new BridgeError('SHUTTING_DOWN', 'the bridge is shutting down'));
      this.pending.delete(id);
    }
    // terminate(), not close(): a close handshake waits up to 30 s for a client that
    // never answers (a hung extension, a program holding the slot), and the server
    // waited with it after its client had closed stdin (0.5.3).
    this.client?.terminate();
    this.client = null;
    this.sessionToken = null;

    if (this.wss) {
      for (const socket of this.wss.clients) socket.terminate();
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }
  }

  async convert(opts: BridgeConvertOptions): Promise<BridgeConvertResult> {
    if (!this.isConnected()) {
      throw new BridgeError('NOT_CONNECTED', 'the extension is not connected');
    }

    const id = `req_${Date.now()}_${++this.requestCounter}`;
    const msg: ConvertRequestMessage = {
      type: 'convert',
      id,
      url: opts.url,
      options: {
        includeImages: opts.includeImages,
        includeFrontmatter: opts.includeFrontmatter,
        timeoutMs: opts.timeoutMs,
      },
    };

    return new Promise<BridgeConvertResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError('TIMEOUT', `Bridge request timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs + 5000);

      this.pending.set(id, { resolve, reject, timer });
      this.client!.send(JSON.stringify(msg));
    });
  }

  private verifyUpgrade(req: IncomingMessage): boolean {
    // Page2AI only. Any installed extension may open a WebSocket to localhost
    // without a permission, and the one holding this single connection reads
    // every URL the agent asks for and writes what the agent then reads.
    // Firefox gives each install a random moz-extension:// UUID, so a scheme
    // check would admit every Firefox extension (0.5.0-0.5.2 did): a Firefox
    // install is admitted only by its exact origin in PAGE2AI_BRIDGE_ORIGINS (its
    // Internal UUID in about:debugging; the log line below names a refused one).
    const origin = req.headers.origin ?? '';
    if (origin !== PAGE2AI_CHROME_ORIGIN && !this.extraOrigins.includes(origin)) {
      const hint = origin.startsWith('moz-extension://')
        ? `; if this is Page2AI in Firefox, add PAGE2AI_BRIDGE_ORIGINS=${origin} to this server's environment`
        : '';
      this.log(`bridge: rejected Origin "${origin}"${hint}`);
      return false;
    }

    const host = req.headers.host ?? '';
    const allowed = [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
    if (!allowed.includes(host)) {
      this.log(`bridge: rejected Host "${host}"`);
      return false;
    }

    return true;
  }

  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      const err: ServerErrorMessage = {
        type: 'error',
        code: 'ALREADY_CONNECTED',
        message: 'Another extension is already connected',
      };
      ws.send(JSON.stringify(err));
      ws.close();
      return;
    }

    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close();
      }
    }, 5000);

    ws.on('message', (data) => {
      let msg: ExtensionMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        ws.close();
        return;
      }

      if (!authenticated) {
        if (msg.type === 'hello' && msg.protocol === BRIDGE_PROTOCOL) {
          clearTimeout(authTimeout);
          authenticated = true;
          this.sessionToken = randomBytes(32).toString('hex');
          this.client = ws;

          const welcome: WelcomeMessage = {
            type: 'welcome',
            protocol: BRIDGE_PROTOCOL,
            serverVersion: this.serverVersion,
            token: this.sessionToken,
          };
          ws.send(JSON.stringify(welcome));
          this.log(`bridge: extension connected (${msg.extensionId} v${msg.extensionVersion})`);
        } else {
          const err: ServerErrorMessage = {
            type: 'error',
            code: 'AUTH_FAILED',
            message: `Expected hello with protocol ${BRIDGE_PROTOCOL}`,
          };
          ws.send(JSON.stringify(err));
          ws.close();
        }
        return;
      }

      if (!('token' in msg) || (msg as { token?: string }).token !== this.sessionToken) {
        ws.close();
        return;
      }

      if (msg.type === 'ping') {
        const pong: PongMessage = { type: 'pong' };
        ws.send(JSON.stringify(pong));
        return;
      }

      if (msg.type === 'result' && 'id' in msg) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);
          // The agent gets this text as the page: a result without it, or from a page
          // that is not a web address (Firefox reports an early about:blank complete),
          // is an extension fault, answered like any other refusal. 0.5.3 passed "" on.
          if (typeof msg.markdown !== 'string' || msg.markdown.trim() === '') {
            pending.reject(new BridgeError('BAD_RESULT', 'the extension sent a result without Markdown'));
            return;
          }
          if (typeof msg.url !== 'string' || !isWebUrl(msg.url)) {
            pending.reject(new BridgeError('BAD_RESULT', `the extension sent the text of ${JSON.stringify(msg.url ?? null)}, not of a web page`));
            return;
          }
          pending.resolve({
            markdown: msg.markdown,
            title: typeof msg.title === 'string' ? msg.title : '',
            url: typeof msg.url === 'string' ? msg.url : '',
            charCount: msg.markdown.length,
          });
        }
        return;
      }

      if (msg.type === 'error' && 'id' in msg && msg.id) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);
          pending.reject(new BridgeError(String(msg.code), String(msg.message)));
        }
        return;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (this.client === ws) {
        this.client = null;
        this.sessionToken = null;
        this.log('bridge: extension disconnected');
        // Its requests can no longer be answered: fail them now, not at their timeout.
        for (const [id, req] of this.pending) {
          clearTimeout(req.timer);
          req.reject(new BridgeError('EXTENSION_DISCONNECTED', 'the extension closed the connection'));
          this.pending.delete(id);
        }
      }
    });

    ws.on('error', (err) => {
      this.log(`bridge: ws error: ${err.message}`);
    });
  }
}
