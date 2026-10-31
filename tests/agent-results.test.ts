import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeServer } from '../src/bridge/server.js';

// The server's own fetch answers here: a 285,632-character page (T200) and the dead ends an
// agent met on popular sites, without the network.
const ownFetch = vi.hoisted(() => vi.fn());
vi.mock('@page2ai/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@page2ai/core')>()),
  fetchAndConvert: ownFetch,
}));
import { FetchProtectionError, SsrfBlockedError } from '@page2ai/core';
import { DEFAULT_MAX_LENGTH, cutAt, forgetKeptPages, sectionList, sectionsOf } from '../src/tools/paging.js';
import { LOCAL_SERVE, handlePageToMarkdown, setBridge } from '../src/tools/page-to-markdown.js';

type Result = Awaited<ReturnType<typeof handlePageToMarkdown>>;
const texts = (r: Result): string[] => r.content.map((c) => ('text' in c ? c.text : ''));

// A page with everything a cut can break: frontmatter, headings, code blocks, a table, emoji.
const longMarkdown = (sections: number): string => {
  const out = ['---', 'title: "Long page"', 'source: "https://docs.example.invalid/long"', '---', '', '# Long page', ''];
  for (let i = 0; i < sections; i++) {
    out.push(`## Section ${i}`, '', `Text of section ${i} 🙂 `.repeat(40), '');
    out.push('```js', ...Array.from({ length: 12 }, (_, j) => `const v${j} = ${i} * ${j}; // line ${j}`), '```', '');
    if (i % 5 === 0) out.push('| a | b |', '| --- | --- |', ...Array.from({ length: 8 }, (_, j) => `| ${i} | ${j} |`), '');
    if (i % 7 === 0) out.push(`### Detail ${i}`, '', 'Detail text. '.repeat(30), '');
  }
  return out.join('\n');
};

const fences = (part: string): number => part.split('\n').filter((l) => /^```/.test(l)).length;

// Deterministic, so a failure names the case that failed.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const partsOf = (text: string, maxLength: number): string[] => {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    const end = cutAt(text, start, maxLength);
    expect(end, `progress at ${start}`).toBeGreaterThan(start);
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
};

describe('cutting a page into parts', () => {
  it('loses nothing and never passes the size, for any size', () => {
    const text = longMarkdown(60);
    const random = rng(203);
    for (let trial = 0; trial < 60; trial++) {
      const maxLength = 100 + Math.floor(random() * 6000);
      const parts = partsOf(text, maxLength);
      expect(parts.join(''), `max_length ${maxLength}`).toBe(text);
      for (const part of parts) expect(part.length, `max_length ${maxLength}`).toBeLessThanOrEqual(maxLength);
    }
  });

  it('ends a part outside code blocks and the frontmatter when blocks are smaller than a part', () => {
    const text = longMarkdown(60);
    for (const maxLength of [3000, 7000, DEFAULT_MAX_LENGTH]) {
      const parts = partsOf(text, maxLength);
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) expect(fences(part) % 2, `max_length ${maxLength}`).toBe(0);
      expect(parts[0]).toMatch(/^---\n[\s\S]*\n---\n/);
      // Every later part starts at a block, not in the middle of a line.
      for (const part of parts.slice(1)) expect(part).not.toMatch(/^[ \t]/);
    }
  });

  it('cuts inside a code block only when the block is longer than a part, and then at a line start', () => {
    const block = ['```', ...Array.from({ length: 400 }, (_, i) => `line ${i}`), '```'].join('\n');
    const text = `# T\n\nintro\n\n${block}\n\nafter\n`;
    const parts = partsOf(text, 1000);
    expect(parts.join('')).toBe(text);
    // The text before the block ends the first part; the block starts the second whole.
    expect(parts[0]).toBe('# T\n\nintro\n\n');
    expect(parts[1]).toMatch(/^```\nline 0\n/);
    for (const part of parts.slice(2, -1)) expect(part).toMatch(/^line \d+\n/);
    expect(parts.at(-1)).toMatch(/```\n\nafter\n$/);
  });

  it('never ends a part with a heading whose text is in the next part', () => {
    const text = longMarkdown(60);
    // Sizes above the longest paragraph line (about 860 characters); below it a heading may stand alone.
    for (const maxLength of [1500, 4000, 9000]) {
      for (const part of partsOf(text, maxLength).slice(0, -1)) {
        const last = part.trimEnd().split('\n').at(-1)!;
        expect(last, `max_length ${maxLength}`).not.toMatch(/^#{1,6} /);
      }
    }
  });

  it('never splits a surrogate pair on one line longer than a part', () => {
    const text = '🙂'.repeat(5000);
    const parts = partsOf(text, 999);
    expect(parts.join('')).toBe(text);
    for (const part of parts) expect(part).not.toMatch(/[\ud800-\udbff]$|^[\udc00-\udfff]/);
  });
});

describe('the list of sections on the first part', () => {
  it('measures each section up to the next heading at its level or above, and skips headings in code', () => {
    const text = '# A\n\nx\n\n## B\n\ny\n\n```md\n# not a heading\n```\n\n### C\n\nz\n\n## D\n\nw\n';
    const sections = sectionsOf(text);
    expect(sections.map((s) => s.title)).toEqual(['A', 'B', 'C', 'D']);
    for (const s of sections) expect(text.slice(s.at)).toMatch(/^#{1,6} /);
    const [a, b, c, d] = sections;
    expect(a!.length).toBe(text.length);
    expect(b!.at + b!.length).toBe(d!.at);
    expect(c!.at + c!.length).toBe(d!.at);
  });

  it('lists the deepest outline that fits in 40 lines, and says how many more there are', () => {
    const many = ['# Big', '', ...Array.from({ length: 120 }, (_, i) => `## S${i}\n\ntext\n`)].join('\n');
    const list = sectionList(many);
    const entries = list.split('\n').filter((l) => l.startsWith('- '));
    expect(entries).toHaveLength(41);
    expect(list).toContain('- … and 81 more at this level.');
    // 31 second-level lines and 5 third-level fit; with 39 and 6 the third level is left out.
    expect(sectionList(longMarkdown(30))).toContain('### Detail 0');
    const outline = sectionList(longMarkdown(38));
    expect(outline).toContain('## Section 37');
    expect(outline).not.toContain('### Detail');
  });
});

describe('page_to_markdown in parts (local server)', () => {
  const page = longMarkdown(150);
  const url = 'https://docs.example.invalid/long';

  beforeEach(() => {
    ownFetch.mockReset();
    ownFetch.mockImplementation(async () => ({ markdown: page, title: 'Long page', baseUrl: url }));
  });
  afterEach(() => {
    forgetKeptPages();
    vi.useRealTimers();
  });

  it('returns the first part, the next start_index and the sections, then the rest from the kept copy', async () => {
    expect(page.length).toBeGreaterThan(3 * DEFAULT_MAX_LENGTH);
    const first = await handlePageToMarkdown({ url }, LOCAL_SERVE);
    const [part, note] = texts(first);
    expect(first.isError).toBeFalsy();
    expect(part!.length).toBeLessThanOrEqual(DEFAULT_MAX_LENGTH);
    expect(note).toMatch(/^This is the start of a long page: characters 0-(\d+) of (\d+)\./);
    expect(note).toContain('Sections, as start_index (length): heading');
    // Every listed offset points at its heading in the page.
    for (const m of note!.matchAll(/^- (\d+) \((\d+)\): (#+ .+)$/gm)) {
      expect(page.startsWith(m[3]!, Number(m[1]))).toBe(true);
    }
    let text = part!;
    let next = Number(/start_index (\d+)/.exec(note!)![1]);
    let calls = 0;
    while (next) {
      const r = await handlePageToMarkdown({ url, start_index: next }, LOCAL_SERVE);
      const [p, n] = texts(r);
      text += p;
      const more = /Next part: start_index (\d+)/.exec(n!);
      if (!more) expect(n).toMatch(/: the end of the page\.$/);
      next = more ? Number(more[1]) : 0;
      if (++calls > 20) throw new Error('no end');
    }
    expect(text).toBe(page);
    expect(ownFetch).toHaveBeenCalledTimes(1);
  });

  it('reads one section by its start_index and length', async () => {
    const note = texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))[1]!;
    const m = /^- (\d+) \((\d+)\): ## Section 30$/m.exec(note)!;
    const r = await handlePageToMarkdown({ url, start_index: Number(m[1]), max_length: Number(m[2]) }, LOCAL_SERVE);
    expect(texts(r)[0]).toMatch(/^## Section 30\n/);
    expect(texts(r)[0]).not.toContain('## Section 31');
  });

  it('fetches again after the copy expired, and says the part may not line up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const note = texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))[1]!;
    const next = Number(/start_index (\d+)/.exec(note)![1]);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const r = await handlePageToMarkdown({ url, start_index: next }, LOCAL_SERVE);
    expect(ownFetch).toHaveBeenCalledTimes(2);
    expect(texts(r).join('\n')).toContain('no longer kept (10 minutes after the last part read)');
  });

  it('keeps a page that fits in one part exactly as before: one block, no note', async () => {
    ownFetch.mockImplementation(async () => ({ markdown: '# Short\n\nText.\n', title: 'Short', baseUrl: url }));
    const r = await handlePageToMarkdown({ url }, LOCAL_SERVE);
    expect(texts(r)).toEqual(['# Short\n\nText.\n']);
  });

  it('refuses a start_index past the end', async () => {
    const r = await handlePageToMarkdown({ url, start_index: page.length + 5 }, LOCAL_SERVE);
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toContain(`past the end of the page, which has ${page.length} characters`);
  });

  it('serves whole pages to a caller without a page size (the hosted endpoint)', async () => {
    const r = await handlePageToMarkdown({ url });
    expect(texts(r)).toEqual([page]);
  });

  it('continues an html page from the kept copy without the html', async () => {
    const html = `<html><body><h1>Long</h1>${Array.from({ length: 400 }, (_, i) => `<h2>Part ${i}</h2><p>${'word '.repeat(60)}</p>`).join('')}</body></html>`;
    const first = await handlePageToMarkdown({ html, url }, LOCAL_SERVE);
    const note = texts(first)[1]!;
    expect(note).toContain('without html');
    const next = Number(/start_index (\d+)/.exec(note)![1]);
    const second = await handlePageToMarkdown({ url, start_index: next }, LOCAL_SERVE);
    expect(texts(second)[0]).toMatch(/^## Part \d+/);
    expect(ownFetch).not.toHaveBeenCalled();
  });
});

describe('page_to_markdown says what to do next', () => {
  const url = 'https://site.example.invalid/page';
  const failWith = (e: unknown) => ownFetch.mockImplementation(async () => { throw e; });

  // Braces: a function returned from beforeEach is run by Vitest as the test's teardown,
  // and mockReset() returns the mock, which would then throw the test's error after it.
  beforeEach(() => {
    ownFetch.mockReset();
  });
  afterEach(() => setBridge(null));

  it('keeps the status line first and names html and Agent Bridge for a refusal (local)', async () => {
    failWith(new FetchProtectionError('HTTP 403 Forbidden, content-type=text/html; charset=UTF-8', url));
    const r = await handlePageToMarkdown({ url }, LOCAL_SERVE);
    const [line, step] = texts(r)[0]!.split('\n');
    expect(r.isError).toBe(true);
    expect(line).toMatch(/^Fetch failed: fetch-protected: HTTP 403 Forbidden/);
    expect(step).toContain('the same request will be refused again');
    expect(step).toContain('pass its HTML as `html` together with this `url`');
  });

  it('names a browser tool only, on the hosted endpoint', async () => {
    failWith(new FetchProtectionError('HTTP 403 Forbidden, content-type=text/html', url));
    const text = texts(await handlePageToMarkdown({ url }))[0]!;
    expect(text).toContain('Read the page through a browser tool instead.');
    expect(text).not.toMatch(/`html`|Bridge|timeout_ms/);
  });

  it('tells the agent which bridge step applies', async () => {
    failWith(new FetchProtectionError('HTTP 403 Forbidden, content-type=text/html', url));
    setBridge({ isConnected: () => false, hasKey: () => false, refusalNote: () => null } as unknown as BridgeServer);
    expect(texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))[0]).toContain('turn on Agent Bridge in the Page2AI browser extension (1.6.0 or later), with the key its popup shows set as PAGE2AI_BRIDGE_KEY');
    setBridge({ isConnected: () => false, hasKey: () => true, refusalNote: () => null } as unknown as BridgeServer);
    expect(texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))[0]).not.toContain('PAGE2AI_BRIDGE_KEY');
    setBridge(null, 'port 3025 is held by another program, most likely another Page2AI server');
    expect(texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))[0]).toContain('Agent Bridge is not available to this server: port 3025 is held');
  });

  it.each([
    ['HTTP 404 Not Found, content-type=text/html', 'There is no page at this address (HTTP 404)'],
    ['HTTP 401 Unauthorized, content-type=text/html', 'The page needs a sign-in (HTTP 401)'],
    ['HTTP 429 Too Many Requests, content-type=text/html', 'wait before trying again'],
    ['HTTP 502 Bad Gateway, content-type=text/html', 'trying again later may work.'],
    ['content-type "application/pdf; qs=0.001" not in accepted set', 'serves application/pdf, not a web page'],
    ['response body exceeds 10485760 bytes cap', 'larger than the 10 MB'],
    ['blocked by SSRF guard: SSRF guard blocked https://x.invalid/: DNS resolution failed for "x.invalid"', 'does not resolve'],
    ['blocked by SSRF guard: hostname "a" resolves to blocked address 10.0.0.1 (private)', 'never opens private, loopback or cloud metadata addresses'],
  ])('%s', async (reason, step) => {
    failWith(new FetchProtectionError(reason, url));
    const text = texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))[0]!;
    expect(text.split('\n')[0]).toBe(`Fetch failed: fetch-protected: ${reason} (url: ${url})`);
    expect(text.split('\n')[1]).toContain(step);
  });

  it('adds nothing to a redirect without a Location header, and nothing to an unknown error', async () => {
    failWith(new FetchProtectionError('HTTP 302 redirect without a Location header', url));
    expect(texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))[0]!.split('\n')).toHaveLength(1);
    failWith(new Error('socket hang up'));
    expect(texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))[0]).toBe('Unexpected error: socket hang up');
  });

  it('names the address guard for a blocked address and a larger timeout_ms for a slow page', async () => {
    failWith(new SsrfBlockedError('SSRF guard blocked http://169.254.169.254/: metadata', url));
    expect(texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))[0]).toContain('never opens private');
    failWith(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
    const text = texts(await handlePageToMarkdown({ url, timeout_ms: 2000 }, LOCAL_SERVE))[0]!;
    expect(text).toMatch(/^Fetch timed out after 2000ms: /);
    expect(text).toContain('try again with a larger timeout_ms (up to 60000)');
  });

  it('says so when a page has no readable text, without calling it an error', async () => {
    ownFetch.mockImplementation(async () => ({
      markdown: '---\ntitle: "Reddit"\n---\n\n# Reddit\n\n<!-- AI: page has no extractable body content -->\n',
      title: 'Reddit',
      baseUrl: url,
    }));
    const r = await handlePageToMarkdown({ url }, LOCAL_SERVE);
    expect(r.isError).toBeFalsy();
    expect(texts(r)[1]).toMatch(/^No readable text came out of this page: it is probably built by scripts/);
  });

  it('reports a landing on a sign-in page, and not a page that names another base', async () => {
    const landed = (baseUrl: string, title: string) =>
      ownFetch.mockImplementation(async () => ({ markdown: `# ${title}\n\nform\n`, title, baseUrl }));
    landed('https://github.com/login?return_to=%2Fsettings%2Fprofile', 'Sign in to GitHub · GitHub');
    const signin = texts(await handlePageToMarkdown({ url: 'https://github.com/settings/profile' }, LOCAL_SERVE));
    expect(signin[1]).toContain('redirected to https://github.com/login?return_to=%2Fsettings%2Fprofile, which looks like a sign-in page');
    landed('https://cdn.example.invalid/assets/', 'Docs page');
    expect(texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))).toHaveLength(1);
    landed('https://site.example.invalid/page/', 'Sign in');
    expect(texts(await handlePageToMarkdown({ url }, LOCAL_SERVE))).toHaveLength(1);
  });
});
