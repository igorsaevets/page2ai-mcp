// Agent Bridge: localhost-only WebSocket server that connects @page2ai/mcp
// to the Page2AI browser extension for extraction through the user's real
// browser (cookies, JS rendering, extension-quality Markdown).
//
// Security model:
//   1. Bind 127.0.0.1 only (never 0.0.0.0)
//   2. Origin, a first filter: Page2AI's Chrome Web Store origin, the exact origins
//      in PAGE2AI_BRIDGE_ORIGINS (an unpacked build), and any moz-extension:// origin
//      (Firefox gives every install a random UUID; the key below tells them apart)
//   3. Host header: must be 127.0.0.1:PORT or localhost:PORT
//   4. page2ai-bridge/2: both ends prove they know a key from PAGE2AI_BRIDGE_KEY
//      (protocol.ts). Without a key nothing converts. A socket holds the single
//      slot only after the proof; at most 4 sockets wait in a handshake, 5 s each.

import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BRIDGE_PROTOCOL,
  BridgeError,
  DEFAULT_BRIDGE_PORT,
  type BridgeConvertOptions,
  type BridgeConvertResult,
  type ChallengeMessage,
  type ConvertRequestMessage,
  type WelcomeMessage,
  type PongMessage,
  type ServerErrorMessage,
} from './protocol.js';
import { BRIDGE_KEY_ENV, clientProof, isHex64, proofMatches, serverProof, type BridgeKey } from './keys.js';

/** Page2AI's Chrome Web Store ID: Chrome, Edge and the other Chromium browsers
 *  that install from the store send this Origin. */
export const PAGE2AI_CHROME_ORIGIN = 'chrome-extension://dlpaaijcnbbmlfeohlphjpnbbcnomnno';

const MAX_HANDSHAKES = 4;
const HANDSHAKE_MS = 5000;
const HOW_TO_ADD_KEY = 'in the Page2AI browser extension 1.6.0 or later, turn on Agent Bridge in its popup ' +
  'and copy the key it shows (Copy key) into ' +
  `${BRIDGE_KEY_ENV} in this server's settings, then restart the MCP client. ` +
  'If the popup has no Agent Bridge section, that install is an older store version (1.5.1 or earlier): update the extension first';

const isWebUrl = (url: string): boolean => {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
};

// The protocol's number, to say which side is older: page2ai-bridge/2 -> 2.
const protocolNumber = (p: string): number => Number(/^page2ai-bridge\/(\d+)$/.exec(p)?.[1] ?? NaN);

/** How long a refused handshake stays in the agent's results (refusalNote). An extension
 *  with the switch on retries at least every 30 s, so a problem that lasts stays fresh. */
export const REFUSAL_NOTE_MS = 5 * 60_000;

type Refusal = { code: 'PROTOCOL_MISMATCH' | 'NO_KEY' | 'UNKNOWN_KEY' | 'AUTH_FAILED'; theirs: number; at: number };

// What a peer says about itself goes into the log: printable and short only.
const printable = (v: unknown, max = 64): string => String(v ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, max);

type PendingRequest = {
  resolve: (result: BridgeConvertResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class BridgeServer {
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private handshakes = new Set<WebSocket>();
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private readonly port: number;
  private readonly serverVersion: string;
  private readonly log: (msg: string) => void;
  private readonly extraOrigins: readonly string[];
  private readonly keys: readonly BridgeKey[];
  private readonly handshakeMs: number;
  private lastRefusal: Refusal | null = null;

  constructor(opts: {
    port?: number;
    serverVersion: string;
    log: (msg: string) => void;
    /** Exact origins accepted beside the store's, e.g. an unpacked build's. */
    extraOrigins?: readonly string[];
    /** From PAGE2AI_BRIDGE_KEY (keys.ts). None: the bridge answers NO_KEY. */
    keys?: readonly BridgeKey[];
    /** How long a socket may take to finish the handshake (tests shorten it). */
    handshakeMs?: number;
  }) {
    this.port = opts.port ?? DEFAULT_BRIDGE_PORT;
    this.serverVersion = opts.serverVersion;
    this.log = opts.log;
    this.extraOrigins = opts.extraOrigins ?? [];
    this.keys = opts.keys ?? [];
    this.handshakeMs = opts.handshakeMs ?? HANDSHAKE_MS;
  }

  /** An extension that passed the handshake holds the connection. */
  isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  /** One line for the agent's result when an extension tried to connect within
   *  REFUSAL_NOTE_MS and this server refused it: the tool then fetches by itself, and
   *  without the line the agent cannot tell that the browser was meant to serve it, nor
   *  what the user must fix. Built from this server's own words and numbers only, never
   *  from the peer's message: any local program can send a hello. */
  refusalNote(now = Date.now()): string | null {
    const r = this.lastRefusal;
    if (!r || this.isConnected() || now - r.at > REFUSAL_NOTE_MS) return null;
    const lead = 'Fetched without the browser: the Page2AI extension tried to connect';
    const restart = 'quit and reopen the MCP client';
    switch (r.code) {
      case 'PROTOCOL_MISMATCH':
        if (Number.isNaN(r.theirs)) {
          return `${lead} with a protocol this server (${this.serverVersion}, ${BRIDGE_PROTOCOL}) does not know.`;
        }
        return r.theirs > protocolNumber(BRIDGE_PROTOCOL)
          ? `${lead} and speaks page2ai-bridge/${r.theirs}, while this server (${this.serverVersion}) speaks ` +
            `${BRIDGE_PROTOCOL}. Ask the user to ${restart}: one that starts npx -y page2ai-mcp then runs the ` +
            'newest server; a version named in its settings must be raised.'
          : `${lead} and speaks page2ai-bridge/${r.theirs}, older than this server's ${BRIDGE_PROTOCOL}. Ask the ` +
            'user to update the Page2AI extension (the browser does it within a day; chrome://extensions with ' +
            'Developer mode on has an Update button).';
      case 'NO_KEY':
        return `${lead}, but this server has no ${BRIDGE_KEY_ENV}. Ask the user to copy the key from the extension 1.6.0+ popup (no Agent Bridge section there means the extension must be updated first) ` +
          `into the MCP server's ${BRIDGE_KEY_ENV} setting, then ${restart}.`;
      case 'UNKNOWN_KEY':
        return `${lead} with a key this server does not hold. Ask the user to copy the key from the extension 1.6.0+ popup (no Agent Bridge section there means the extension must be updated first) ` +
          `into the MCP server's ${BRIDGE_KEY_ENV} setting, then ${restart}.`;
      case 'AUTH_FAILED':
        return `${lead}, but its proof did not match the key this server holds. Ask the user to copy the key from the extension 1.6.0+ popup (no Agent Bridge section there means the extension must be updated first) ` +
          `into the MCP server's ${BRIDGE_KEY_ENV} setting again, then ${restart}.`;
    }
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
        if (!this.verifyUpgrade(info.req)) {
          cb(false, 403, 'Forbidden');
          return;
        }
        // Sockets that never finish the handshake hold no slot, but they are
        // capped: a flood cannot grow memory, only delay the extension.
        if (this.handshakes.size >= MAX_HANDSHAKES) {
          cb(false, 503, 'Busy');
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

    this.wss.on('connection', (ws) => this.handleConnection(ws));

    const keyNote = this.keys.length
      ? `${this.keys.length} key(s): ${this.keys.map((k) => k.id).join(', ')}`
      : `no ${BRIDGE_KEY_ENV}, so no browser can connect yet: ${HOW_TO_ADD_KEY}`;
    this.log(`bridge listening on ws://127.0.0.1:${this.port} (${keyNote})`);
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

    if (this.wss) {
      for (const socket of this.wss.clients) socket.terminate();
      this.wss.close();
      this.wss = null;
    }
    this.handshakes.clear();
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
    // A first filter, not the lock: the key is. Web pages send http(s) origins and
    // other Chrome extensions their own IDs; Firefox gives each install a random
    // moz-extension:// UUID, so any Firefox origin may try the handshake, and only
    // the key admits Page2AI (0.5.3 required that UUID in PAGE2AI_BRIDGE_ORIGINS).
    // Firefox 150 added a stable form, 64 letters a-p, for WebAuthn; it is let in too.
    const origin = req.headers.origin ?? '';
    if (origin !== PAGE2AI_CHROME_ORIGIN && !this.extraOrigins.includes(origin) &&
        !/^moz-extension:\/\/(?:[0-9a-f-]{36}|[a-p]{64})$/i.test(origin)) {
      const hint = origin.startsWith('chrome-extension://')
        ? '; if this is an unpacked Page2AI build, add its origin to PAGE2AI_BRIDGE_ORIGINS'
        : '';
      this.log(`bridge: rejected Origin "${printable(origin, 120)}"${hint}`);
      return false;
    }

    const host = req.headers.host ?? '';
    const allowed = [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
    if (!allowed.includes(host)) {
      this.log(`bridge: rejected Host "${printable(host, 120)}"`);
      return false;
    }

    return true;
  }

  private handleConnection(ws: WebSocket): void {
    this.handshakes.add(ws);
    // 'closed': refused, and nothing it sends is read any more. 0.6.0 read on until the
    // socket closed: every further hello logged another refusal, and a failed proof got
    // a second try.
    let stage: 'hello' | 'auth' | 'open' | 'closed' = 'hello';
    let key: BridgeKey | null = null;
    let nonceE = '';
    let nonceS = '';
    let peer = '';

    const timer = setTimeout(() => {
      if (stage !== 'open') ws.terminate();
    }, this.handshakeMs);

    const drop = (): void => {
      stage = 'closed';
      ws.close();
    };
    const refuse = (code: string, message: string, extra: Partial<ServerErrorMessage> = {}): void => {
      const err: ServerErrorMessage = { type: 'error', code, message, ...extra };
      ws.send(JSON.stringify(err));
      drop();
    };

    ws.on('message', (data) => {
      if (stage === 'closed') return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        drop();
        return;
      }
      if (!msg || typeof msg !== 'object') {
        drop();
        return;
      }

      if (stage === 'hello') {
        if (msg.type !== 'hello') {
          drop();
          return;
        }
        peer = `${printable(msg.extensionId)} v${printable(msg.extensionVersion, 20)}`;
        if (msg.protocol !== BRIDGE_PROTOCOL) {
          const theirs = protocolNumber(String(msg.protocol));
          const update = theirs > protocolNumber(BRIDGE_PROTOCOL) ? 'update @page2ai/mcp' : 'update the Page2AI extension';
          this.log(`bridge: refused ${peer}: it speaks ${printable(msg.protocol)}, this server ${BRIDGE_PROTOCOL}; ${update}`);
          this.lastRefusal = { code: 'PROTOCOL_MISMATCH', theirs, at: Date.now() };
          refuse('PROTOCOL_MISMATCH', `this server speaks ${BRIDGE_PROTOCOL}`, { protocol: BRIDGE_PROTOCOL });
          return;
        }
        const keyId = /^[0-9a-f]{16}$/.test(String(msg.keyId)) ? String(msg.keyId) : '(none)';
        if (this.keys.length === 0) {
          this.log(`bridge: Page2AI ${peer} (key ${keyId}) asked to connect, but this server has no ${BRIDGE_KEY_ENV}: ${HOW_TO_ADD_KEY}`);
          this.lastRefusal = { code: 'NO_KEY', theirs: NaN, at: Date.now() };
          refuse('NO_KEY', `this server has no ${BRIDGE_KEY_ENV}`);
          return;
        }
        key = this.keys.find((k) => k.id === keyId) ?? null;
        if (!key) {
          this.log(`bridge: refused ${peer}: its key ${keyId} is not in ${BRIDGE_KEY_ENV} ` +
            `(${this.keys.map((k) => k.id).join(', ')}); add it, comma-separated, then restart the MCP client`);
          this.lastRefusal = { code: 'UNKNOWN_KEY', theirs: NaN, at: Date.now() };
          refuse('UNKNOWN_KEY', `key ${keyId} is not in this server's ${BRIDGE_KEY_ENV}`);
          return;
        }
        if (!isHex64(msg.nonceE)) {
          drop();
          return;
        }
        nonceE = msg.nonceE;
        nonceS = randomBytes(32).toString('hex');
        stage = 'auth';
        const challenge: ChallengeMessage = {
          type: 'challenge',
          protocol: BRIDGE_PROTOCOL,
          serverVersion: this.serverVersion,
          nonceS,
          proof: serverProof(key.bytes, this.port, nonceE, nonceS),
        };
        ws.send(JSON.stringify(challenge));
        return;
      }

      if (stage === 'auth') {
        if (msg.type !== 'auth' || !proofMatches(clientProof(key!.bytes, this.port, nonceS, nonceE), msg.proof)) {
          this.log(`bridge: refused ${peer}: it named key ${key!.id} but could not prove it`);
          this.lastRefusal = { code: 'AUTH_FAILED', theirs: NaN, at: Date.now() };
          refuse('AUTH_FAILED', 'the proof does not match');
          return;
        }
        clearTimeout(timer);
        this.handshakes.delete(ws);
        if (this.isConnected()) {
          this.log(`bridge: refused ${peer} (key ${key!.id}): another browser holds the connection`);
          refuse('ALREADY_CONNECTED', 'another browser is connected to this server');
          return;
        }
        stage = 'open';
        this.client = ws;
        this.lastRefusal = null;
        const welcome: WelcomeMessage = { type: 'welcome', protocol: BRIDGE_PROTOCOL, serverVersion: this.serverVersion };
        ws.send(JSON.stringify(welcome));
        this.log(`bridge: extension connected (${peer}, key ${key!.id})`);
        return;
      }

      // Only a connection that proved the key gets this far.
      if (stage !== 'open') return;

      if (msg.type === 'ping') {
        const pong: PongMessage = { type: 'pong' };
        ws.send(JSON.stringify(pong));
        return;
      }

      if (msg.type === 'result' && typeof msg.id === 'string') {
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
            url: msg.url,
            charCount: msg.markdown.length,
          });
        }
        return;
      }

      if (msg.type === 'error' && typeof msg.id === 'string' && msg.id) {
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
      clearTimeout(timer);
      this.handshakes.delete(ws);
      if (this.client === ws) {
        this.client = null;
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
