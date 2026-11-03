import { describe, expect, it } from 'vitest';
import { bm25, tokenize } from '../src/tools/bm25.js';

describe('tokenize', () => {
  it('lowercases and splits on non-word boundaries', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('handles code identifiers as single tokens', () => {
    expect(tokenize('fetchAndConvert')).toEqual(['fetchandconvert']);
  });

  it('handles Unicode letters', () => {
    expect(tokenize('café résumé')).toEqual(['café', 'résumé']);
  });

  it('returns empty array for empty or whitespace-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('splits numbers from words', () => {
    expect(tokenize('v2.0.0')).toEqual(['v2', '0', '0']);
  });
});

describe('bm25', () => {
  it('returns empty for empty query', () => {
    expect(bm25('', ['hello world'])).toEqual([]);
  });

  it('returns empty for empty documents', () => {
    expect(bm25('hello', [])).toEqual([]);
  });

  it('scores a matching document above zero', () => {
    const result = bm25('hello', ['hello world', 'goodbye moon']);
    expect(result.length).toBe(1);
    expect(result[0]!.index).toBe(0);
    expect(result[0]!.score).toBeGreaterThan(0);
  });

  it('ranks the more relevant document first', () => {
    const docs = [
      'JavaScript is a language for the web',
      'Python async generators yield values lazily',
      'async generators in JavaScript use yield and for-await',
    ];
    const result = bm25('async generators JavaScript', docs);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Doc 2 has all three query terms; doc 1 has two.
    expect(result[0]!.index).toBe(2);
  });

  it('does not return documents with no matching terms', () => {
    const docs = ['the quick brown fox', 'lazy dog sleeps'];
    const result = bm25('elephant', docs);
    expect(result).toEqual([]);
  });

  it('handles duplicate query terms without double-counting IDF', () => {
    const docs = ['cat cat cat', 'dog dog dog'];
    const r1 = bm25('cat', docs);
    const r2 = bm25('cat cat cat', docs);
    // Same documents should match, scores differ due to TF-IDF interaction
    // but the same document should rank first in both.
    expect(r1[0]!.index).toBe(r2[0]!.index);
  });

  it('normalizes for document length (short relevant doc beats long tangential one)', () => {
    const docs = [
      'async generators',
      'a very long document about many things including web development ' +
        'and server-side rendering and database optimization and also async generators ' +
        'plus many other topics like testing deployment monitoring logging and more',
    ];
    const result = bm25('async generators', docs);
    expect(result.length).toBe(2);
    // The short exact-match doc should rank higher.
    expect(result[0]!.index).toBe(0);
  });

  it('handles a single document', () => {
    const result = bm25('hello', ['hello world']);
    expect(result.length).toBe(1);
    expect(result[0]!.score).toBeGreaterThan(0);
  });
});
