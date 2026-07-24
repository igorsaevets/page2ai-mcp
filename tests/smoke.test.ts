import { describe, expect, it } from 'vitest';
import {
  handlePageToMarkdown,
  pageToMarkdownDefinition,
  pageToMarkdownInputSchema,
} from '../src/tools/page-to-markdown.js';

describe('page_to_markdown — schema', () => {
  it('accepts a valid URL', () => {
    const parsed = pageToMarkdownInputSchema.parse({ url: 'https://example.com/foo' });
    expect(parsed.url).toBe('https://example.com/foo');
    expect(parsed.include_images).toBe(true);
    expect(parsed.include_frontmatter).toBe(true);
    expect(parsed.timeout_ms).toBe(15000);
  });

  it('rejects non-URL input', () => {
    expect(() => pageToMarkdownInputSchema.parse({ url: 'not-a-url' })).toThrow();
  });

  it('rejects timeout below 1000ms', () => {
    expect(() =>
      pageToMarkdownInputSchema.parse({ url: 'https://example.com', timeout_ms: 500 }),
    ).toThrow();
  });
});

describe('page_to_markdown — definition', () => {
  it('exposes readOnly + openWorld annotations', () => {
    expect(pageToMarkdownDefinition.annotations?.readOnlyHint).toBe(true);
    expect(pageToMarkdownDefinition.annotations?.openWorldHint).toBe(true);
  });

  it('has a descriptive tool name and title', () => {
    expect(pageToMarkdownDefinition.name).toBe('page_to_markdown');
    expect(pageToMarkdownDefinition.title).toBeTruthy();
  });
});

describe('page_to_markdown — handler', () => {
  it('returns isError on invalid input', async () => {
    const r = await handlePageToMarkdown({ url: 'not-a-url' });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text?: string }).text).toMatch(/Invalid input/);
  });

  it('returns isError on SSRF-blocked URL', async () => {
    const r = await handlePageToMarkdown({ url: 'http://127.0.0.1:8080/admin' });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text?: string }).text).toMatch(/SSRF|private|blocked/i);
  });

  it('returns isError on blocked scheme', async () => {
    const r = await handlePageToMarkdown({ url: 'file:///etc/passwd' });
    expect(r.isError).toBe(true);
  });
});
