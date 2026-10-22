import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeServer } from '../src/bridge/server.js';
import { handlePageToMarkdown, setBridge } from '../src/tools/page-to-markdown.js';

// A connected extension that refuses: what Page2AI answers without site access
// (PERMISSION_REQUIRED), for a sensitive URL (RESTRICTED_URL), or when the tab
// fails. The tool must then answer by its own fetch, as with no extension; a
// timeout must not be retried, it would spend the caller's time twice.
const refusingBridge = (message: string): BridgeServer =>
  ({
    isConnected: () => true,
    convert: async () => { throw new Error(message); },
  }) as unknown as BridgeServer;

// 127.0.0.1 is refused by the SSRF guard, so reaching the fetch route is
// visible in the answer without touching the network.
const URL_FETCH_REFUSES = 'http://127.0.0.1/agent/asked';

const textOf = (result: Awaited<ReturnType<typeof handlePageToMarkdown>>): string =>
  result.content.map((c) => ('text' in c ? c.text : '')).join('\n');

describe('page_to_markdown with a refusing bridge', () => {
  afterEach(() => setBridge(null));

  it('falls back to its own fetch on PERMISSION_REQUIRED and says why', async () => {
    setBridge(refusingBridge('PERMISSION_REQUIRED: Page2AI has no access to 127.0.0.1'));
    const result = await handlePageToMarkdown({ url: URL_FETCH_REFUSES });
    const text = textOf(result);
    expect(text).toContain('URL blocked by SSRF guard');
    expect(text).toContain('Fetched without the browser: the Page2AI extension answered PERMISSION_REQUIRED');
    expect(text).not.toContain('Bridge conversion failed');
  });

  it('does not retry by fetch after a bridge timeout', async () => {
    setBridge(refusingBridge('TIMEOUT: Extraction timed out after 15000ms'));
    const result = await handlePageToMarkdown({ url: URL_FETCH_REFUSES });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Bridge conversion failed: TIMEOUT/);
    expect(textOf(result)).not.toContain('SSRF');
  });
});
