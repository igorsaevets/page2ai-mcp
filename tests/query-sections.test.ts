import { describe, expect, it } from 'vitest';
import { querySections } from '../src/tools/paging.js';

const docPage =
  '---\ntitle: "Docs"\n---\n\n' +
  '# API Reference\n\nOverview of the API.\n\n' +
  '## Authentication\n\nUse an API key in the Authorization header.\n\n' +
  '## Rate Limiting\n\nThe API allows 100 requests per minute per key.\n\n' +
  '## Pagination\n\nResults are paginated. Use `page` and `per_page` query parameters.\n\n' +
  '## Error Handling\n\nErrors return a JSON object with `error` and `message` fields.\n\n' +
  '## Webhooks\n\nConfigure webhooks to receive events. POST payloads include a signature header.\n';

describe('querySections', () => {
  it('returns only relevant sections', () => {
    const result = querySections(docPage, 'authentication API key', 100_000);
    expect(result).not.toBeNull();
    expect(result!.sections.length).toBeGreaterThanOrEqual(1);
    const titles = result!.sections.map((s) => s.title);
    expect(titles).toContain('Authentication');
  });

  it('does not return sections with no matching terms', () => {
    const result = querySections(docPage, 'webhooks signature events', 100_000);
    expect(result).not.toBeNull();
    const titles = result!.sections.map((s) => s.title);
    expect(titles).toContain('Webhooks');
    expect(titles).not.toContain('Authentication');
    expect(titles).not.toContain('Rate Limiting');
  });

  it('returns null when query matches nothing', () => {
    const result = querySections(docPage, 'elephant zebra giraffe', 100_000);
    expect(result).toBeNull();
  });

  it('returns null when text has no headings', () => {
    const result = querySections('Just some text without any headings.', 'text', 100_000);
    expect(result).toBeNull();
  });

  it('respects maxLength: omits lower-scoring sections', () => {
    const result = querySections(docPage, 'API key requests', 120);
    expect(result).not.toBeNull();
    // Only the top-scoring section(s) that fit in 120 chars.
    expect(result!.sections.length).toBeLessThanOrEqual(3);
  });

  it('returns sections in page order, not score order', () => {
    const result = querySections(docPage, 'API requests key authorization', 100_000);
    expect(result).not.toBeNull();
    if (result!.sections.length >= 2) {
      for (let i = 1; i < result!.sections.length; i++) {
        expect(result!.sections[i]!.at).toBeGreaterThan(result!.sections[i - 1]!.at);
      }
    }
  });

  it('includes score in each returned section', () => {
    const result = querySections(docPage, 'rate limiting', 100_000);
    expect(result).not.toBeNull();
    for (const s of result!.sections) {
      expect(s.score).toBeGreaterThan(0);
    }
  });

  it('note describes the filtering', () => {
    const result = querySections(docPage, 'webhooks', 100_000);
    expect(result).not.toBeNull();
    expect(result!.note).toContain('sections matching');
    expect(result!.note).toContain('webhooks');
    expect(result!.note).toContain('For the full page');
  });

  it('handles preamble text before any heading', () => {
    const withPreamble = 'This page is about cats.\n\n# Dogs\n\nDogs are loyal.\n\n# Cats\n\nCats are independent.\n';
    const result = querySections(withPreamble, 'cats', 100_000);
    expect(result).not.toBeNull();
    const titles = result!.sections.map((s) => s.title);
    expect(titles).toContain('Cats');
    // The preamble about cats should also be found.
    expect(result!.sections.some((s) => s.title === '(preamble)')).toBe(true);
  });
});
