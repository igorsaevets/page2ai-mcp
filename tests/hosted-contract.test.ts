import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  pageToMarkdownDefinition,
  pageToMarkdownHostedDefinition,
  pageToMarkdownHostedInputSchema,
} from '../src/tools/page-to-markdown.js';

// The hosted endpoint is what the ChatGPT plugin runs, and OpenAI replaces its reviewed
// tool definition with whatever the live server lists. 0.5.0 changed it by changing the
// shared definition (an Agent Bridge sentence ChatGPT can never use, and `html`); these
// tests make such a change fail here instead of on the live plugin.
const sha12 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

describe('hosted page_to_markdown = the contract reviewed for the ChatGPT plugin', () => {
  it('keeps the reviewed description byte for byte', () => {
    const d = pageToMarkdownHostedDefinition.description;
    expect([sha12(d), d.length]).toEqual(['783d1e41f68e', 898]);
  });

  it('takes a url and the three options, and nothing else', () => {
    expect(Object.keys(pageToMarkdownHostedInputSchema.shape)).toEqual([
      'url', 'include_images', 'include_frontmatter', 'timeout_ms',
    ]);
    expect(pageToMarkdownHostedInputSchema.safeParse({}).success).toBe(false);
    expect(pageToMarkdownHostedInputSchema.safeParse({ html: '<p>x</p>' }).success).toBe(false);
    const parsed = pageToMarkdownHostedInputSchema.parse({ url: 'https://example.com', html: '<p>x</p>' });
    expect(parsed).not.toHaveProperty('html');
    expect(pageToMarkdownHostedInputSchema.safeParse({ url: 'https://example.com', timeout_ms: 60001 }).success).toBe(false);
  });

  it('keeps name, title and annotations', () => {
    expect(pageToMarkdownHostedDefinition.name).toBe('page_to_markdown');
    expect(pageToMarkdownHostedDefinition.title).toBe('Convert Page to Markdown');
    expect(pageToMarkdownHostedDefinition.annotations).toEqual({
      readOnlyHint: true, openWorldHint: true, idempotentHint: false, destructiveHint: false,
    });
  });

  it('local description names html and Agent Bridge and keeps the page-only sentence', () => {
    const d = pageToMarkdownDefinition.description;
    expect(d).toContain('`html`');
    expect(d).toContain('Agent Bridge');
    expect(d).toContain('not a Markdown copy of it');
    expect(pageToMarkdownHostedDefinition.description).not.toMatch(/bridge|extension|`html`/i);
  });
});
