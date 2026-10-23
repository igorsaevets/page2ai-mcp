import { describe, expect, it, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { BridgeServer, PAGE2AI_CHROME_ORIGIN } from '../src/bridge/server.js';
import { BRIDGE_PROTOCOL } from '../src/bridge/protocol.js';

const TEST_PORT = 13025;
const log = (_msg: string): void => {};

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

describe('BridgeServer', () => {
  let server: BridgeServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('starts and stops cleanly', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();
    expect(server.isConnected()).toBe(false);
    await server.stop();
  });

  it('accepts a connection with valid Origin and hello', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({
      type: 'hello',
      protocol: BRIDGE_PROTOCOL,
      extensionId: 'test',
      extensionVersion: '1.0.0',
    }));
    const msg = await readMsg(ws);
    expect(msg.type).toBe('welcome');
    expect(msg.token).toBeTruthy();
    expect(server.isConnected()).toBe(true);
    ws.close();
  });

  it('rejects another Chrome extension (any installed extension can reach localhost)', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    await expect(connect(TEST_PORT, 'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh')).rejects.toThrow();
    expect(server.isConnected()).toBe(false);
  });

  // Firefox gives each install a random UUID, so any Firefox extension has a
  // moz-extension:// origin: 0.5.0-0.5.2 admitted them all (T169).
  const FIREFOX_PAGE2AI = 'moz-extension://0b7c3f0e-1111-4222-8333-944455556666';
  const FIREFOX_OTHER = 'moz-extension://9f9f9f9f-aaaa-4bbb-8ccc-dddddddddddd';

  it('rejects a Firefox origin that PAGE2AI_BRIDGE_ORIGINS does not list', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    await expect(connect(TEST_PORT, FIREFOX_PAGE2AI)).rejects.toThrow(/403/);
    expect(server.isConnected()).toBe(false);
  });

  it('accepts exactly the listed origins: one Firefox install and an unpacked build, no other Firefox extension', async () => {
    server = new BridgeServer({
      port: TEST_PORT, serverVersion: '0.0.1-test', log,
      extraOrigins: [FIREFOX_PAGE2AI, 'chrome-extension://unpackedbuildid'],
    });
    await server.start();

    await expect(connect(TEST_PORT, FIREFOX_OTHER)).rejects.toThrow(/403/);
    for (const origin of [FIREFOX_PAGE2AI, 'chrome-extension://unpackedbuildid']) {
      const ws = await connect(TEST_PORT, origin);
      ws.send(JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL, extensionId: 'x', extensionVersion: '1' }));
      expect((await readMsg(ws)).type).toBe('welcome');
      const closed = new Promise((r) => ws.once('close', r));
      ws.close();
      await closed;
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('refuses a result without Markdown as BAD_RESULT, and passes an error code through', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL, extensionId: 'x', extensionVersion: '1' }));
    const welcome = await readMsg(ws);
    let n = 0;
    ws.on('message', (data) => {
      const req = JSON.parse(String(data));
      if (req.type !== 'convert') return;
      n += 1;
      ws.send(JSON.stringify(n === 1
        ? { type: 'result', id: req.id, token: welcome.token, title: 'no markdown', url: req.url }
        : { type: 'error', id: req.id, token: welcome.token, code: 'TIMEOUT', message: 'Extraction timed out' }));
    });

    const opts = { url: 'https://example.com/', includeImages: true, includeFrontmatter: true, timeoutMs: 5000 };
    await expect(server.convert(opts)).rejects.toMatchObject({ name: 'BridgeError', code: 'BAD_RESULT' });
    await expect(server.convert(opts)).rejects.toMatchObject({ name: 'BridgeError', code: 'TIMEOUT' });
    ws.close();
  });

  it('refuses blank Markdown and the text of a page that is not a web address as BAD_RESULT (0.5.3 passed "" on as the page)', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL, extensionId: 'x', extensionVersion: '1' }));
    const welcome = await readMsg(ws);
    // Firefox reports the new tab's about:blank complete before the page loads.
    const answers: Record<string, unknown>[] = [
      { markdown: '', url: 'https://example.com/' },
      { markdown: ' \n\t', url: 'https://example.com/' },
      { markdown: '# Page', url: 'about:blank' },
      { markdown: '# Page' },
    ];
    let n = 0;
    ws.on('message', (data) => {
      const req = JSON.parse(String(data));
      if (req.type !== 'convert') return;
      ws.send(JSON.stringify({ type: 'result', id: req.id, token: welcome.token, title: 't', ...answers[n++] }));
    });

    const opts = { url: 'https://example.com/', includeImages: true, includeFrontmatter: true, timeoutMs: 5000 };
    for (const answer of answers) {
      await expect(server.convert(opts), JSON.stringify(answer)).rejects.toMatchObject({ name: 'BridgeError', code: 'BAD_RESULT' });
    }
    ws.close();
  });

  it('stop() does not wait for a client that never answers the close handshake', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL, extensionId: 'x', extensionVersion: '1' }));
    await readMsg(ws);
    // A hung extension: nothing more is read, so the server's close frame is never answered
    // and a close handshake would wait out ws's 30 s timeout (0.5.3 did, after stdin closed).
    (ws as unknown as { _socket: { pause(): void } })._socket.pause();

    const started = Date.now();
    await server.stop();
    expect(Date.now() - started).toBeLessThan(2000);
    ws.terminate();
  }, 10_000);

  it('convert() rejects at once when the extension disconnects, not at its timeout', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL, extensionId: 'x', extensionVersion: '1' }));
    await readMsg(ws);
    ws.once('message', () => ws.close()); // the convert request arrives; the extension goes away

    const started = Date.now();
    await expect(server.convert({
      url: 'https://example.com/', includeImages: true, includeFrontmatter: true, timeoutMs: 30_000,
    })).rejects.toThrow(/EXTENSION_DISCONNECTED/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('rejects http:// Origin', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    await expect(connect(TEST_PORT, 'http://evil.com')).rejects.toThrow();
    expect(server.isConnected()).toBe(false);
  });

  it('rejects empty Origin', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    await expect(connect(TEST_PORT, '')).rejects.toThrow();
    expect(server.isConnected()).toBe(false);
  });

  it('rejects wrong protocol in hello', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({ type: 'hello', protocol: 'wrong/1' }));
    const msg = await readMsg(ws);
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('AUTH_FAILED');
  });

  it('responds to ping with pong after auth', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({
      type: 'hello',
      protocol: BRIDGE_PROTOCOL,
      extensionId: 'test',
      extensionVersion: '1.0.0',
    }));
    const welcome = await readMsg(ws);
    const token = welcome.token as string;

    ws.send(JSON.stringify({ type: 'ping', token }));
    const pong = await readMsg(ws);
    expect(pong.type).toBe('pong');
    ws.close();
  });

  it('rejects a second concurrent connection', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws1 = await connect(TEST_PORT);
    ws1.send(JSON.stringify({
      type: 'hello',
      protocol: BRIDGE_PROTOCOL,
      extensionId: 'test',
      extensionVersion: '1.0.0',
    }));
    await readMsg(ws1);

    const ws2 = await connect(TEST_PORT);
    const result = await Promise.race([
      readMsg(ws2).then((msg) => ({ kind: 'message' as const, msg })),
      new Promise<{ kind: 'closed' }>((resolve) => ws2.on('close', () => resolve({ kind: 'closed' }))),
    ]);
    if (result.kind === 'message') {
      expect(result.msg.type).toBe('error');
      expect(result.msg.code).toBe('ALREADY_CONNECTED');
    }
    ws1.close();
    ws2.close();
  });

  it('convert() resolves when extension sends result', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({
      type: 'hello',
      protocol: BRIDGE_PROTOCOL,
      extensionId: 'test',
      extensionVersion: '1.0.0',
    }));
    const welcome = await readMsg(ws);
    const token = welcome.token as string;

    ws.on('message', (data) => {
      const req = JSON.parse(String(data));
      if (req.type === 'convert') {
        ws.send(JSON.stringify({
          type: 'result',
          id: req.id,
          token,
          markdown: '# Test\n\nHello',
          title: 'Test',
          url: req.url,
          charCount: 14,
          source: 'extension',
        }));
      }
    });

    const result = await server.convert({
      url: 'https://example.com',
      includeImages: true,
      includeFrontmatter: true,
      timeoutMs: 5000,
    });
    expect(result.markdown).toBe('# Test\n\nHello');
    expect(result.title).toBe('Test');
    ws.close();
  });

  it('convert() rejects when extension sends error', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    const ws = await connect(TEST_PORT);
    ws.send(JSON.stringify({
      type: 'hello',
      protocol: BRIDGE_PROTOCOL,
      extensionId: 'test',
      extensionVersion: '1.0.0',
    }));
    const welcome = await readMsg(ws);
    const token = welcome.token as string;

    ws.on('message', (data) => {
      const req = JSON.parse(String(data));
      if (req.type === 'convert') {
        ws.send(JSON.stringify({
          type: 'error',
          id: req.id,
          token,
          code: 'TAB_LOAD_FAILED',
          message: 'HTTP 403',
        }));
      }
    });

    await expect(server.convert({
      url: 'https://example.com/forbidden',
      includeImages: true,
      includeFrontmatter: true,
      timeoutMs: 5000,
    })).rejects.toThrow('TAB_LOAD_FAILED');
    ws.close();
  });

  it('convert() rejects when no extension is connected', async () => {
    server = new BridgeServer({ port: TEST_PORT, serverVersion: '0.0.1-test', log });
    await server.start();

    await expect(server.convert({
      url: 'https://example.com',
      includeImages: true,
      includeFrontmatter: true,
      timeoutMs: 5000,
    })).rejects.toThrow('not connected');
  });

  it('start() rejects cleanly when the port is already in use (regression: 0.5.0 crashed with unhandled EADDRINUSE on a second MCP instance)', async () => {
    const sharedPort = TEST_PORT + 7;
    server = new BridgeServer({ port: sharedPort, serverVersion: '0.0.1-test', log });
    await server.start();

    const second = new BridgeServer({ port: sharedPort, serverVersion: '0.0.1-test', log });
    await expect(second.start()).rejects.toThrow(/EADDRINUSE|address already in use/i);
    // If we got here, the process did not crash. The first server stays usable.
    expect(server.isConnected()).toBe(false);
  });
});
