import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeServer } from '../src/bridge/server.js';

// The tool resolves a name before handing it to the browser. Here: one public name, one
// that resolves into a private range, and every other name unresolvable (it still goes to
// the browser, which may reach it through a proxy).
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === 'public.example.invalid') return [{ address: '93.184.215.14', family: 4 }];
    if (host === 'intranet.example.invalid') return [{ address: '10.1.2.3', family: 4 }];
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  }),
}));
// The server's own fetch answers here. The real one resolved these .invalid names on the
// machine's network, and a slow resolver failed this file once in five runs (T172).
const ownFetch = vi.hoisted(() => vi.fn(async (url: string) => ({ markdown: `# Fetched by the server: ${url}` })));
vi.mock('@page2ai/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@page2ai/core')>()),
  fetchAndConvert: ownFetch,
}));
import { BridgeError } from '../src/bridge/protocol.js';
import { handlePageToMarkdown, setBridge } from '../src/tools/page-to-markdown.js';

// A connected extension that refuses: what Page2AI answers without site access
// (PERMISSION_REQUIRED), for a sensitive URL (RESTRICTED_URL), or when the tab
// fails. The tool must then answer by its own fetch, as with no extension; a
// timeout must not be retried, it would spend the caller's time twice.
const refusingBridge = (code: string, message: string): BridgeServer =>
  ({
    isConnected: () => true,
    convert: async () => { throw new BridgeError(code, message); },
  }) as unknown as BridgeServer;

// An extension that answers with the page it ended on, counting the requests it got.
const answeringBridge = (landedUrl: string): BridgeServer & { calls: number } => {
  const bridge = {
    calls: 0,
    isConnected: () => true,
    convert: async () => {
      bridge.calls += 1;
      return { markdown: '# Signed in page', title: 'Page', url: landedUrl, charCount: 16 };
    },
  };
  return bridge as unknown as BridgeServer & { calls: number };
};

// Passes the tool's check before the browser.
const URL_FETCH_REFUSES = 'https://public.example.invalid/agent/asked';
const FETCHED = `# Fetched by the server: ${URL_FETCH_REFUSES}`;

const textOf = (result: Awaited<ReturnType<typeof handlePageToMarkdown>>): string =>
  result.content.map((c) => ('text' in c ? c.text : '')).join('\n');

describe('page_to_markdown with a refusing bridge', () => {
  afterEach(() => {
    setBridge(null);
    ownFetch.mockClear();
  });

  it('falls back to its own fetch on PERMISSION_REQUIRED and says why', async () => {
    setBridge(refusingBridge('PERMISSION_REQUIRED', 'Page2AI has no access to 127.0.0.1'));
    const result = await handlePageToMarkdown({ url: URL_FETCH_REFUSES });
    const text = textOf(result);
    expect(ownFetch).toHaveBeenCalledTimes(1);
    expect(text).toContain(FETCHED);
    expect(text).toContain('Fetched without the browser: the Page2AI extension answered PERMISSION_REQUIRED');
    expect(text).not.toContain('Bridge conversion failed');
  });

  it('does not retry by fetch after a bridge timeout', async () => {
    setBridge(refusingBridge('TIMEOUT', 'Extraction timed out after 15000ms'));
    const result = await handlePageToMarkdown({ url: URL_FETCH_REFUSES });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Bridge conversion failed: TIMEOUT/);
    expect(textOf(result)).not.toContain('SSRF');
    expect(ownFetch).not.toHaveBeenCalled();
  });

  it('decides by the code, not the wording: a failed tab load worded «timed out» still falls back', async () => {
    setBridge(refusingBridge('EXTRACTION_FAILED', 'Tab load timed out'));
    const text = textOf(await handlePageToMarkdown({ url: URL_FETCH_REFUSES }));
    expect(ownFetch).toHaveBeenCalledTimes(1);
    expect(text).toContain(FETCHED);
    expect(text).toContain('Fetched without the browser: the Page2AI extension answered EXTRACTION_FAILED: Tab load timed out');
  });
});

describe('page_to_markdown through a bridge that answers', () => {
  afterEach(() => setBridge(null));

  it('says so when the browser ended on another host (a sign-in redirect)', async () => {
    setBridge(answeringBridge('https://accounts.example.invalid/signin?next=%2Fdoc'));
    const result = await handlePageToMarkdown({ url: 'https://docs.example.invalid/doc' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(2);
    expect(textOf(result)).toContain('# Signed in page');
    expect(textOf(result)).toContain('the page redirected to https://accounts.example.invalid/signin?next=%2Fdoc');
  });

  it('says so for a sign-in page on the same host, and for another port', async () => {
    setBridge(answeringBridge('https://docs.example.invalid/login?next=%2Fdoc'));
    const login = await handlePageToMarkdown({ url: 'https://docs.example.invalid/doc' });
    expect(login.content).toHaveLength(2);
    expect(textOf(login)).toContain('the page redirected to https://docs.example.invalid/login?next=%2Fdoc');

    setBridge(answeringBridge('https://docs.example.invalid:8443/doc'));
    const port = await handlePageToMarkdown({ url: 'https://docs.example.invalid/doc' });
    expect(port.content).toHaveLength(2);
  });

  it('adds nothing for a trailing slash, an https upgrade or a changed query', async () => {
    for (const landed of [
      'https://docs.example.invalid/doc/',
      'https://docs.example.invalid/doc',
      'https://docs.example.invalid/doc?ref=nav#top',
    ]) {
      setBridge(answeringBridge(landed));
      const result = await handlePageToMarkdown({ url: 'http://docs.example.invalid/doc' });
      expect(result.content, landed).toHaveLength(1);
    }
  });
});

describe('page_to_markdown keeps the SSRF guard in front of the browser', () => {
  afterEach(() => setBridge(null));

  it('never sends a loopback, private or metadata address to the extension', async () => {
    for (const url of [
      'http://127.0.0.1:6379/',
      'http://localhost:3000/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/',
      'https://intranet.example.invalid/wiki',
    ]) {
      const bridge = answeringBridge(url);
      setBridge(bridge);
      const result = await handlePageToMarkdown({ url });
      expect(result.isError, url).toBe(true);
      expect(textOf(result), url).toContain('URL blocked by SSRF guard');
      expect(bridge.calls, url).toBe(0);
    }
  });

  it('sends a public name, and one this server cannot resolve, to the browser', async () => {
    for (const url of ['https://public.example.invalid/doc', 'https://unresolvable.example.invalid/doc']) {
      const bridge = answeringBridge(url);
      setBridge(bridge);
      const result = await handlePageToMarkdown({ url });
      expect(result.isError, url).toBeFalsy();
      expect(bridge.calls, url).toBe(1);
    }
  });

  it('does not hand the agent a page the browser was redirected to at a blocked address', async () => {
    setBridge(answeringBridge('http://192.168.1.1/admin'));
    const result = await handlePageToMarkdown({ url: 'https://public.example.invalid/go' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('URL blocked by SSRF guard: the page redirected to http://192.168.1.1/admin');
    expect(textOf(result)).not.toContain('# Signed in page');
  });
});

// A handshake the server refused leaves no connection: the tool takes its own fetch, and the
// note the bridge keeps is the agent's only sign that the browser was meant to serve it (T180).
describe('page_to_markdown after a refused handshake', () => {
  afterEach(() => {
    setBridge(null);
    ownFetch.mockClear();
  });
  const NOTE = 'Fetched without the browser: the Page2AI extension tried to connect with a key this server does not hold.';
  const refusedBridge = (note: string | null): BridgeServer =>
    ({
      isConnected: () => false,
      refusalNote: () => note,
      convert: async () => { throw new BridgeError('NOT_CONNECTED', 'the extension is not connected'); },
    }) as unknown as BridgeServer;

  it('fetches by itself and puts the refusal note after the Markdown', async () => {
    setBridge(refusedBridge(NOTE));
    const result = await handlePageToMarkdown({ url: URL_FETCH_REFUSES });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: 'text', text: FETCHED });
    expect(textOf(result)).toContain(NOTE);
  });

  it('adds nothing when no extension was refused', async () => {
    setBridge(refusedBridge(null));
    const result = await handlePageToMarkdown({ url: URL_FETCH_REFUSES });
    expect(result.content).toHaveLength(1);
    expect(textOf(result)).toBe(FETCHED);
  });
});
