// Agent Bridge: localhost-only WebSocket server that connects @page2ai/mcp
// to the Page2AI browser extension for extraction through the user's real
// browser (cookies, JS rendering, extension-quality Markdown).
//
// Security model (BrowserTools MCP v2.0, post GHSA-xvrv-w8pg-f25f):
//   1. Bind 127.0.0.1 only (never 0.0.0.0)
//   2. Origin validation: accept chrome-extension:// and moz-extension:// only
//   3. Host header: must be 127.0.0.1:PORT or localhost:PORT
//   4. Per-session token: generated on auth, required on every message

import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BRIDGE_PROTOCOL,
  DEFAULT_BRIDGE_PORT,
  type BridgeConvertOptions,
  type BridgeConvertResult,
  type ConvertRequestMessage,
  type ExtensionMessage,
  type WelcomeMessage,
  type PongMessage,
  type ServerErrorMessage,
} from './protocol.js';

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

  constructor(opts: { port?: number; serverVersion: string; log: (msg: string) => void }) {
    this.port = opts.port ?? DEFAULT_BRIDGE_PORT;
    this.serverVersion = opts.serverVersion;
    this.log = opts.log;
  }

  isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    this.httpServer = createServer((_req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('WebSocket upgrade required');
    });

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

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on('error', reject);
      this.httpServer!.listen(this.port, '127.0.0.1', () => {
        this.log(`bridge listening on ws://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error('Bridge shutting down'));
      this.pending.delete(id);
    }
    this.client?.close();
    this.client = null;
    this.sessionToken = null;

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }
  }

  async convert(opts: BridgeConvertOptions): Promise<BridgeConvertResult> {
    if (!this.isConnected()) {
      throw new Error('Extension not connected');
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
        reject(new Error(`Bridge request timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs + 5000);

      this.pending.set(id, { resolve, reject, timer });
      this.client!.send(JSON.stringify(msg));
    });
  }

  private verifyUpgrade(req: IncomingMessage): boolean {
    const origin = req.headers.origin ?? '';
    if (!origin.startsWith('chrome-extension://') && !origin.startsWith('moz-extension://')) {
      this.log(`bridge: rejected Origin "${origin}"`);
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
          pending.resolve({
            markdown: msg.markdown,
            title: msg.title,
            url: msg.url,
            charCount: msg.charCount,
          });
        }
        return;
      }

      if (msg.type === 'error' && 'id' in msg && msg.id) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);
          pending.reject(new Error(`${msg.code}: ${msg.message}`));
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
      }
    });

    ws.on('error', (err) => {
      this.log(`bridge: ws error: ${err.message}`);
    });
  }
}
