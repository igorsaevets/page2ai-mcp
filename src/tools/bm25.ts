// BM25 scoring for local query mode (BL-59 q). Ranks page sections by
// relevance to a free-text query without any external API call.

/** Split text into lowercase word tokens. Code identifiers like `fetchAndConvert` become
 *  `fetchandconvert` — close enough for BM25, and splitting on camelCase would multiply
 *  tokens for no recall gain on short queries agents write. */
export const tokenize = (text: string): string[] =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

interface ScoredDoc {
  index: number;
  score: number;
}

/**
 * BM25 scoring of `documents` against `query`.
 * Returns every document with a positive score, highest first.
 *
 * Standard parameters: k1 = 1.2 (term-frequency saturation),
 * b = 0.75 (document-length normalization). Both are well-studied
 * defaults from the TREC experiments — no tuning knob exposed.
 */
export const bm25 = (query: string, documents: string[]): ScoredDoc[] => {
  const k1 = 1.2;
  const b = 0.75;
  const N = documents.length;
  if (N === 0) return [];

  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  // Tokenize every document once.
  const docTokens = documents.map(tokenize);
  const docLengths = docTokens.map((t) => t.length);
  const avgdl = docLengths.reduce((a, b) => a + b, 0) / N;

  // Document frequency for each query term (how many documents contain it).
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const tokens of docTokens) {
      if (tokens.includes(term)) count++;
    }
    if (count > 0) df.set(term, count);
  }

  // IDF: log((N - n + 0.5) / (n + 0.5) + 1) — the "+1" variant avoids negative IDF
  // for terms that appear in more than half the documents.
  const idf = new Map<string, number>();
  for (const [term, n] of df) {
    idf.set(term, Math.log((N - n + 0.5) / (n + 0.5) + 1));
  }

  const scored: ScoredDoc[] = [];
  for (let i = 0; i < N; i++) {
    const tokens = docTokens[i]!;
    const dl = docLengths[i]!;
    // Term frequencies for this document.
    const tf = new Map<string, number>();
    for (const token of tokens) {
      if (idf.has(token)) tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const term of queryTerms) {
      const termIdf = idf.get(term);
      if (termIdf === undefined) continue;
      const termTf = tf.get(term) ?? 0;
      if (termTf === 0) continue;
      score += termIdf * (termTf * (k1 + 1)) / (termTf + k1 * (1 - b + b * dl / avgdl));
    }
    if (score > 0) scored.push({ index: i, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
};
