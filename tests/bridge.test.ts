import { describe, expect, it, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createHmac, randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';
import { BridgeServer, PAGE2AI_CHROME_ORIGIN } from '../src/bridge/server.js';
import { BRIDGE_PROTOCOL } from '../src/bridge/protocol.js';
import { keyIdOf, parseBridgeKeys, type BridgeKey } from '../src/bridge/keys.js';

const TEST_PORT = 13025;
const log = (_msg: string): void => {};

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const asKeys = (...keys: Buffer[]): BridgeKey[] => keys.map((bytes) => ({ id: keyIdOf(bytes), bytes }));

// The extension's side of the wire, written out here rather than imported from
// keys.ts, so a change to the server's proof format fails these tests.
const hmac = (key: Buffer, text: string): string => createHmac('sha256', key).update(text).digest('hex');
const serverProofFor = (key: Buffer, port: number, nonceE: string, nonceS: string): string =>
  hmac(key, `${BRIDGE_PROTOCOL}|server|${port}|${nonceE}|${nonceS}`);
const clientProofFor = (key: Buffer, port: number, nonceS: string, nonceE: string): string =>
  hmac(key, `${BRIDGE_PROTOCOL}|client|${port}|${nonceS}|${nonceE}`);

const connect = (port: number, origin?: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      origin: origin ?? PAGE2AI_CHROME_ORIGIN,
      headers: { host: `127.0.0.1:${port}` },
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });

const readMsg = (ws: WebSocket): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(String(data))));
  });

const closed = (ws: WebSocket): Promise<void> =>
  ws.readyState === WebSocket.CLOSED ? Promise.resolve() : new Promise((r) => ws.once('close', () => r()));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const hello = (ws: WebSocket, key: Buffer, extra: Record<string, unknown> = {}): string => {
  const nonceE = randomBytes(32).toString('hex');
  ws.send(JSON.stringify({
    type: 'hello', protocol: BRIDGE_PROTOCOL, extensionId: 'test', extensionVersion: '1.0.0',
    keyId: keyIdOf(key), nonceE, ...extra,
  }));
  return nonceE;
};

/** Runs the extension's half of page2ai-bridge/2 and returns what the server said. */
const handshake = async (ws: WebSocket, key: Buffer = KEY, opts: { badProof?: boolean } = {}) => {
  const nonceE = hello(ws, key);
  const challenge = await readMsg(ws);
  if (challenge.type !== 'challenge') return { challenge, serverProofOk: false, reply: null };
  const nonceS = String(challenge.nonceS);
  const serverProofOk = challenge.proof === serverProofFor(key, TEST_PORT, nonceE, nonceS);
  const proof = opts.badProof ? randomBytes(32).toString('hex') : clientProofFor(key, TEST_PORT, nonceS, nonceE);
  ws.send(JSON.stringify({ type: 'auth', proof }));
  return { challenge, serverProofOk, reply: await readMsg(ws) };
};

/** A connected, authenticated extension. */
const pair = async (): Promise<WebSocket> => {
  const ws = await connect(TEST_PORT);
  const { reply } = await handshake(ws);
  expect(reply?.type).toBe('welcome');
  return ws;
};

describe('BridgeServer, page2ai-bridge/2', () => {
  let server: BridgeServer;
  const start = async (opts: Partial<ConstructorParameters<typeof BridgeServer>[0]> = {}): Promise<void> => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log, keys: asKeys(KEY), ...opts });
    await server.start();
  };

  afterEach(async () => {
    await server?.stop();
  });

  it('starts and stops cleanly', async () => {
    await start();
    expect(server.isConnected()).toBe(false);
  });

  it('pairs with the key: the server proves it first, then welcomes, and no session token travels', async () => {
    await start();
    const ws = await connect(TEST_PORT);
    const { challenge, serverProofOk, reply } = await handshake(ws);
    expect(challenge).toMatchObject({ type: 'challenge', protocol: BRIDGE_PROTOCOL, serverVersion: '0.0.1-test' });
    expect(serverProofOk).toBe(true);
    expect(reply).toEqual({ type: 'welcome', protocol: BRIDGE_PROTOCOL, serverVersion: '0.0.1-test' });
    expect(server.isConnected()).toBe(true);
    ws.close();
  });

  it('binds its proof to its own port: computed for any other port it does not match, so a relay through another port fails', async () => {
    await start();
    const ws = await connect(TEST_PORT);
    const nonceE = hello(ws, KEY);
    const challenge = await readMsg(ws);
    const nonceS = String(challenge.nonceS);
    expect(challenge.proof).toBe(serverProofFor(KEY, TEST_PORT, nonceE, nonceS));
    expect(challenge.proof).not.toBe(serverProofFor(KEY, 3025, nonceE, nonceS));
    // The client's proof for the other port is refused the same way.
    ws.send(JSON.stringify({ type: 'auth', proof: clientProofFor(KEY, 3025, nonceS, nonceE) }));
    expect(await readMsg(ws)).toMatchObject({ type: 'error', code: 'AUTH_FAILED' });
    expect(server.isConnected()).toBe(false);
  });

  it('without a key answers NO_KEY, says what to paste where in its log, and converts nothing', async () => {
    const lines: string[] = [];
    await start({ keys: [], log: (m) => lines.push(m) });
    expect(lines.join('\n')).toMatch(/no PAGE2AI_BRIDGE_KEY.*Copy key/);
    const ws = await connect(TEST_PORT);
    hello(ws, KEY);
    expect(await readMsg(ws)).toMatchObject({ type: 'error', code: 'NO_KEY' });
    await closed(ws);
    expect(server.isConnected()).toBe(false);
    await expect(server.convert({ url: 'https://example.com/', includeImages: true, includeFrontmatter: true, timeoutMs: 1000 }))
      .rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(lines.some((l) => l.includes(`key ${keyIdOf(KEY)}`) && l.includes('PAGE2AI_BRIDGE_KEY'))).toBe(true);
  });

  it('refuses a key it does not hold with UNKNOWN_KEY and names both key ids in its log, never a key', async () => {
    const lines: string[] = [];
    await start({ log: (m) => lines.push(m) });
    const ws = await connect(TEST_PORT);
    hello(ws, OTHER_KEY);
    expect(await readMsg(ws)).toMatchObject({ type: 'error', code: 'UNKNOWN_KEY' });
    await closed(ws);
    const log = lines.join('\n');
    expect(log).toContain(keyIdOf(OTHER_KEY));
    expect(log).toContain(keyIdOf(KEY));
    expect(log).not.toContain(KEY.toString('base64url'));
    expect(server.isConnected()).toBe(false);
  });

  it('refuses a client that names the key but cannot prove it (AUTH_FAILED), and it holds no slot', async () => {
    await start();
    const ws = await connect(TEST_PORT);
    const { serverProofOk, reply } = await handshake(ws, KEY, { badProof: true });
    expect(serverProofOk).toBe(true);
    expect(reply).toMatchObject({ type: 'error', code: 'AUTH_FAILED' });
    await closed(ws);
    expect(server.isConnected()).toBe(false);
  });

  it('refuses anything but auth after the challenge: a result sent in its place converts nothing', async () => {
    await start();
    const ws = await connect(TEST_PORT);
    hello(ws, KEY);
    await readMsg(ws);
    ws.send(JSON.stringify({ type: 'result', id: 'x', markdown: '# hi', url: 'https://example.com/' }));
    expect(await readMsg(ws)).toMatchObject({ type: 'error', code: 'AUTH_FAILED' });
    expect(server.isConnected()).toBe(false);
  });

  it('closes a socket whose first message is not hello', async () => {
    await start();
    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({ type: 'ping' }));
    await closed(ws);
    expect(server.isConnected()).toBe(false);
  });

  it('answers a page2ai-bridge/1 extension with PROTOCOL_MISMATCH and its own protocol', async () => {
    const lines: string[] = [];
    await start({ log: (m) => lines.push(m) });
    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({ type: 'hello', protocol: 'page2ai-bridge/1', extensionId: 'old', extensionVersion: '1.5.9' }));
    expect(await readMsg(ws)).toEqual({
      type: 'error', code: 'PROTOCOL_MISMATCH', message: `this server speaks ${BRIDGE_PROTOCOL}`, protocol: BRIDGE_PROTOCOL,
    });
    expect(lines.join('\n')).toContain('update the Page2AI extension');
  });

  it('gives the slot only after the proof: a socket waiting in the handshake does not block the browser', async () => {
    await start();
    const squatter = await connect(TEST_PORT);
    hello(squatter, KEY);
    await readMsg(squatter); // a challenge it cannot answer
    const ws = await pair();
    expect(server.isConnected()).toBe(true);
    ws.close();
    squatter.close();
  });

  it('lets at most 4 sockets wait in the handshake; the next is refused (503) until one ends', async () => {
    await start();
    const waiting = await Promise.all([1, 2, 3, 4].map(() => connect(TEST_PORT)));
    await expect(connect(TEST_PORT)).rejects.toThrow(/503/);
    waiting[0].close();
    await closed(waiting[0]);
    await sleep(20);
    const ws = await pair();
    ws.close();
    for (const w of waiting) w.close();
  });

  it('cuts a socket that does not finish the handshake in time', async () => {
    await start({ handshakeMs: 150 });
    const ws = await connect(TEST_PORT);
    const t0 = Date.now();
    await closed(ws);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('refuses a second authenticated browser with ALREADY_CONNECTED; the first keeps the connection', async () => {
    await start({ keys: asKeys(KEY, OTHER_KEY) });
    const first = await pair();
    const second = await connect(TEST_PORT);
    const { reply } = await handshake(second, OTHER_KEY);
    expect(reply).toMatchObject({ type: 'error', code: 'ALREADY_CONNECTED' });
    await closed(second);
    expect(server.isConnected()).toBe(true);
    first.close();
  });

  it('accepts a browser holding any of several keys', async () => {
    await start({ keys: asKeys(OTHER_KEY, KEY) });
    const ws = await connect(TEST_PORT);
    expect((await handshake(ws, KEY)).reply?.type).toBe('welcome');
    ws.close();
  });

  it('rejects another Chrome extension at the upgrade (any installed extension can reach localhost)', async () => {
    await start();
    await expect(connect(TEST_PORT, 'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh')).rejects.toThrow(/403/);
    expect(server.isConnected()).toBe(false);
  });

  // Firefox gives each install a random UUID, so the origin cannot name Page2AI
  // there: any moz-extension:// origin may try, and the key decides (0.5.3 needed
  // the UUID in PAGE2AI_BRIDGE_ORIGINS).
  const FIREFOX_PAGE2AI = 'moz-extension://0b7c3f0e-1111-4222-8333-944455556666';
  const FIREFOX_OTHER = 'moz-extension://9f9f9f9f-aaaa-4bbb-8ccc-dddddddddddd';

  it('lets any Firefox install try, and admits only the one holding the key', async () => {
    await start();
    const other = await connect(TEST_PORT, FIREFOX_OTHER);
    hello(other, OTHER_KEY);
    expect(await readMsg(other)).toMatchObject({ type: 'error', code: 'UNKNOWN_KEY' });
    await closed(other);
    const ws = await connect(TEST_PORT, FIREFOX_PAGE2AI);
    expect((await handshake(ws)).reply?.type).toBe('welcome');
    ws.close();
  });

  it('accepts an unpacked Chrome build listed in PAGE2AI_BRIDGE_ORIGINS, still only with the key', async () => {
    await start({ extraOrigins: ['chrome-extension://unpackedbuildid'] });
    const ws = await connect(TEST_PORT, 'chrome-extension://unpackedbuildid');
    expect((await handshake(ws)).reply?.type).toBe('welcome');
    ws.close();
  });

  it('rejects web origins, an empty Origin, and a Host that is not this loopback port', async () => {
    await start();
    await expect(connect(TEST_PORT, 'http://evil.example')).rejects.toThrow(/403/);
    await expect(connect(TEST_PORT, '')).rejects.toThrow(/403/);
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, {
        origin: PAGE2AI_CHROME_ORIGIN, headers: { host: `rebind.example:${TEST_PORT}` },
      });
      ws.on('open', resolve);
      ws.on('error', reject);
    })).rejects.toThrow(/403/);
  });

  it('answers ping with pong once paired', async () => {
    await start();
    const ws = await pair();
    ws.send(JSON.stringify({ type: 'ping' }));
    expect(await readMsg(ws)).toEqual({ type: 'pong' });
    ws.close();
  });

  it('convert() sends the request without a token and resolves with the result', async () => {
    await start();
    const ws = await pair();
    const asked = readMsg(ws);
    const done = server.convert({ url: 'https://example.com/doc', includeImages: false, includeFrontmatter: true, timeoutMs: 5000 });
    const req = await asked;
    expect(req).toEqual({
      type: 'convert', id: req.id, url: 'https://example.com/doc',
      options: { includeImages: false, includeFrontmatter: true, timeoutMs: 5000 },
    });
    ws.send(JSON.stringify({ type: 'result', id: req.id, markdown: '# Doc', title: 'Doc', url: 'https://example.com/doc', charCount: 5, source: 'extension' }));
    expect(await done).toEqual({ markdown: '# Doc', title: 'Doc', url: 'https://example.com/doc', charCount: 5 });
    ws.close();
  });

  it('convert() rejects with the extension\'s error code', async () => {
    await start();
    const ws = await pair();
    const asked = readMsg(ws);
    const done = server.convert({ url: 'https://example.com/', includeImages: true, includeFrontmatter: true, timeoutMs: 5000 });
    const req = await asked;
    ws.send(JSON.stringify({ type: 'error', id: req.id, code: 'PERMISSION_REQUIRED', message: 'no access' }));
    await expect(done).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
    ws.close();
  });

  it('refuses a result without Markdown, blank Markdown, or the text of a page that is not a web address (BAD_RESULT)', async () => {
    await start();
    const ws = await pair();
    const bad = [
      { url: 'https://example.com/' },
      { markdown: ' \n\t', url: 'https://example.com/' },
      { markdown: '# x', url: 'about:blank' },
      { markdown: '# x' },
    ];
    for (const fields of bad) {
      const asked = readMsg(ws);
      const done = server.convert({ url: 'https://example.com/', includeImages: true, includeFrontmatter: true, timeoutMs: 5000 });
      const req = await asked;
      ws.send(JSON.stringify({ type: 'result', id: req.id, title: '', source: 'extension', ...fields }));
      await expect(done).rejects.toMatchObject({ code: 'BAD_RESULT' });
    }
    ws.close();
  });

  it('convert() rejects at once when the extension disconnects, not at its timeout', async () => {
    await start();
    const ws = await pair();
    const asked = readMsg(ws);
    const done = server.convert({ url: 'https://example.com/', includeImages: true, includeFrontmatter: true, timeoutMs: 60000 });
    await asked;
    const t0 = Date.now();
    ws.close();
    await expect(done).rejects.toMatchObject({ code: 'EXTENSION_DISCONNECTED' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('stop() does not wait for a client that never answers the close handshake', async () => {
    await start();
    const ws = await pair();
    (ws as unknown as { _socket: Socket })._socket.pause();
    const t0 = Date.now();
    await server.stop();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('start() rejects cleanly when the port is already in use (regression: 0.5.0 crashed with unhandled EADDRINUSE on a second MCP instance)', async () => {
    await start();
    const second = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log, keys: asKeys(KEY) });
    await expect(second.start()).rejects.toThrow(/EADDRINUSE/);
  });
});

describe('parseBridgeKeys', () => {
  const a = KEY.toString('base64url');
  const b = OTHER_KEY.toString('base64url');

  it('reads several keys and tolerates what a copy-paste brings along', () => {
    const { keys, problems } = parseBridgeKeys(` PAGE2AI_BRIDGE_KEY=${a} , "${b}=", ${a}`);
    expect(keys.map((k) => k.id)).toEqual([keyIdOf(KEY), keyIdOf(OTHER_KEY)]);
    expect(problems).toEqual([]);
  });

  it('treats an empty or unexpanded MCPB field as no key', () => {
    expect(parseBridgeKeys(undefined).keys).toEqual([]);
    expect(parseBridgeKeys('').keys).toEqual([]);
    expect(parseBridgeKeys('${user_config.bridge_key}')).toEqual({ keys: [], problems: [] });
  });

  it('reports a bad entry by its position and length, never by its value', () => {
    const secretish = 'not-a-key-but-maybe-a-password';
    const { keys, problems } = parseBridgeKeys(`${a},${secretish}`);
    expect(keys).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^entry 2 of 2 is not a Page2AI key/);
    expect(problems[0]).not.toContain(secretish);
  });
});
