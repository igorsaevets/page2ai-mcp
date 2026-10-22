import { describe, expect, it, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { BridgeServer } from '../src/bridge/server.js';
import { BRIDGE_PROTOCOL } from '../src/bridge/protocol.js';

const TEST_PORT = 13025;
const log = (_msg: string): void => {};

const connect = (port: number, origin?: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      origin: origin ?? 'chrome-extension://test-extension-id',
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
});
