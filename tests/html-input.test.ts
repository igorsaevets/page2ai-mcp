import { describe, expect, it } from 'vitest';
import { handlePageToMarkdown, pageToMarkdownInputSchema } from '../src/tools/page-to-markdown.js';

describe('page_to_markdown — html input (mcp#1)', () => {
  it('accepts html without url', () => {
    const parsed = pageToMarkdownInputSchema.parse({
      html: '<html><body><h1>Hello</h1><p>World</p></body></html>',
    });
    expect(parsed.html).toContain('<h1>Hello</h1>');
    expect(parsed.url).toBeUndefined();
  });

  it('accepts url without html', () => {
    const parsed = pageToMarkdownInputSchema.parse({ url: 'https://example.com' });
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.html).toBeUndefined();
  });

  it('accepts url and html together', () => {
    const parsed = pageToMarkdownInputSchema.parse({
      url: 'https://example.com',
      html: '<html><body>test</body></html>',
    });
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.html).toContain('test');
  });

  it('rejects when neither url nor html is provided', () => {
    expect(() => pageToMarkdownInputSchema.parse({})).toThrow();
  });

  it('converts raw HTML to Markdown via the handler', async () => {
    const result = await handlePageToMarkdown({
      html: '<html><head><title>Test Page</title></head><body><h1>Hello World</h1><p>This is a <strong>test</strong>.</p></body></html>',
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Hello World');
    expect(text).toContain('**test**');
  });

  it('resolves relative links against the url given with html, and never fetches it', async () => {
    // .invalid never resolves (RFC 2606): a fetch would answer an error, not this page.
    const result = await handlePageToMarkdown({
      html: '<html><head><title>Guide</title></head><body><main><h1>Guide</h1>' +
        '<p>Read <a href="/about">About</a> and <a href="next">Next</a>.</p>' +
        '<img src="img/a.png" alt="diagram"></main></body></html>',
      url: 'https://docs.example.invalid/guide/start',
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[About](https://docs.example.invalid/about)');
    expect(text).toContain('[Next](https://docs.example.invalid/guide/next)');
    expect(text).toContain('![diagram](https://docs.example.invalid/guide/img/a.png)');
    expect(text).toContain('source: "https://docs.example.invalid/guide/start"');
  });

  it('includes frontmatter by default on html input', async () => {
    const result = await handlePageToMarkdown({
      html: '<html><head><title>My Page</title></head><body><p>Content</p></body></html>',
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('---');
    expect(text).toContain('My Page');
  });

  it('omits frontmatter when include_frontmatter is false', async () => {
    const result = await handlePageToMarkdown({
      html: '<html><head><title>My Page</title></head><body><p>Content</p></body></html>',
      include_frontmatter: false,
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain('---');
    expect(text).toContain('Content');
  });

  it('enforces 10MB limit on html input', () => {
    const big = 'x'.repeat(10_000_001);
    expect(() => pageToMarkdownInputSchema.parse({ html: big })).toThrow();
  });

  it('returns isError for invalid html input via handler', async () => {
    const result = await handlePageToMarkdown({});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/url.*html|Provide/i);
  });

  // 0.5.2: "" was falsy and the url was fetched instead, " " was converted as a page.
  // 127.0.0.1 is refused by the SSRF guard, so a fetch attempt would show in the text.
  it('refuses an empty or blank html instead of fetching the url', async () => {
    for (const html of ['', ' \n\t ']) {
      const result = await handlePageToMarkdown({ url: 'http://127.0.0.1/never-fetched', html });
      const text = (result.content[0] as { text: string }).text;
      expect(result.isError).toBe(true);
      expect(text).toContain('html: empty');
      expect(text).not.toMatch(/SSRF/);
    }
  });

  it('refuses a url that is not http(s), with html or without', async () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'ftp://example.invalid/a']) {
      expect(pageToMarkdownInputSchema.safeParse({ url }).success).toBe(true); // zod's url() takes them
      for (const input of [{ url, html: '<p>x</p>' }, { url }]) {
        const result = await handlePageToMarkdown(input);
        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toContain('only http:// and https://');
      }
    }
  });

  it('says in the frontmatter that the HTML came from the caller and the url was not fetched', async () => {
    const html = '<html><head><title>Press</title></head><body><main><h1>Press</h1><p>Text</p></main></body></html>';
    const result = await handlePageToMarkdown({ url: 'https://docs.example.invalid/press', html });
    const text = (result.content[0] as { text: string }).text;
    const frontmatter = text.slice(0, text.indexOf('\n---', 4));
    expect(frontmatter).toContain('source: "https://docs.example.invalid/press"');
    expect(frontmatter).toContain('provenance: "HTML supplied by the caller; the source URL was not fetched"');
    expect(text.indexOf('provenance:')).toBeLessThan(text.indexOf('\n---', 4));

    const bare = await handlePageToMarkdown({ url: 'https://docs.example.invalid/press', html, include_frontmatter: false });
    expect((bare.content[0] as { text: string }).text).not.toContain('provenance');
  });

  it('leaves the text alone without frontmatter when the page opens with <hr> (rendered as ---)', async () => {
    const html = '<html><body><hr><h2>Part one</h2><p>a</p><hr><h2>Part two</h2><p>b</p></body></html>';
    const result = await handlePageToMarkdown({ url: 'https://docs.example.invalid/parts', html, include_frontmatter: false });
    const text = (result.content[0] as { text: string }).text;
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).not.toContain('provenance');
  });
});
