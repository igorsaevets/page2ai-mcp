#!/usr/bin/env node
/**
 * What does an AI agent actually receive from a web page?
 *
 * Three representations of the SAME page, captured in the SAME browser run:
 *
 *   1. accessibility snapshot  - what `@playwright/mcp`'s `browser_snapshot` sends to the model
 *   2. raw HTML                - `page.content()`
 *   3. page2ai Markdown        - `@page2ai/core` htmlToMarkdown() on the same captured HTML
 *
 * It reports two different things, and they do not agree:
 *
 *   SIZE     - tokens per representation (o200k_base, the GPT-4o/5 family encoding)
 *   FIDELITY - of the code blocks and table cells that provably exist in the live DOM,
 *              how many survive into each representation?
 *
 * Size alone is misleading: a representation can be smaller because it dropped the payload.
 * That is why FIDELITY is measured against ground truth pulled from the live DOM, not against
 * either representation.
 *
 * Run:
 *   npm i --no-save playwright gpt-tokenizer @page2ai/core
 *   npx playwright install chromium
 *   node scripts/probe-agent-representations.mjs
 *
 * Optional: pass URLs as arguments to use your own corpus instead of the default six.
 *
 * Honest notes, so nobody has to rediscover them:
 *   - `locator.ariaSnapshot()` is the public API and omits the `[ref=eN]` ids that
 *     @playwright/mcp adds, so the a11y numbers here are a LOWER BOUND on what MCP sends.
 *   - A page is counted only if it passes a liveness check. A page that fails is dropped from
 *     ALL arms, never from one, so every arm is measured over the same n.
 *   - page2ai's Node path uses linkedom, which has no layout engine. It therefore cannot see
 *     `display:none`, so hidden nav and collapsed navboxes CAN end up in the Markdown. The
 *     browser-extension path does not have this problem. This probe exposes that gap rather
 *     than hiding it: watch for pages where the Markdown exceeds `innerText` by a wide margin.
 */

import { writeFileSync } from 'node:fs';

let chromium, encode, htmlToMarkdown;
try {
  ({ chromium } = await import('playwright'));
  ({ encode } = await import('gpt-tokenizer/encoding/o200k_base'));
  ({ htmlToMarkdown } = await import('@page2ai/core'));
} catch (err) {
  console.error('Missing dependency:', err.message);
  console.error('Install them (they are intentionally NOT dependencies of this package):');
  console.error('  npm i --no-save playwright gpt-tokenizer @page2ai/core && npx playwright install chromium');
  process.exit(1);
}

const DEFAULT_PAGES = [
  'https://playwright.dev/docs/chrome-extensions',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
  'https://en.wikipedia.org/wiki/Model_Context_Protocol',
  'https://docs.astro.build/en/getting-started/',
  'https://github.com/microsoft/playwright-mcp',
  'https://nodejs.org/api/fs.html',
];

const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PAGES;
const tok = (s) => (s ? encode(s).length : 0);
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const rows = [];
const excluded = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) page2ai-probe/1 (+https://github.com/igorsaevets/page2ai-mcp)',
});

for (const url of PAGES) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500); // let client-side rendering settle

    const html = await page.content();
    const title = (await page.title()) || '';
    const aria = await page.locator('body').ariaSnapshot();
    const innerText = await page.evaluate(() => document.body?.innerText || '');
    const md = htmlToMarkdown(html, { baseUrl: url }).markdown;

    // Liveness control. If any of this fails the page proves nothing, so it is dropped whole.
    if (!(html.length > 5000 && title.trim() && md.length > 200 && aria.length > 100)) {
      excluded.push({ url, why: `html=${html.length} title="${title}" md=${md.length} aria=${aria.length}` });
      await page.close();
      continue;
    }

    // Ground truth for fidelity, read straight out of the live DOM.
    const probes = await page.evaluate(() => {
      const out = { code: [], cells: [] };
      for (const pre of Array.from(document.querySelectorAll('pre')).slice(0, 40)) {
        const t = (pre.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length > 45) out.code.push(t.slice(0, 70));
        if (out.code.length >= 6) break;
      }
      for (const td of Array.from(document.querySelectorAll('table td, table th')).slice(0, 400)) {
        const t = (td.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length > 18 && t.length < 90) out.cells.push(t);
        if (out.cells.length >= 8) break;
      }
      return out;
    });

    const nAria = norm(aria);
    const nMd = norm(md);
    const survives = (hay, needles) => needles.filter((n) => hay.includes(n)).length;

    rows.push({
      url,
      tokens: { a11y: tok(aria), html: tok(html), innerText: tok(innerText), page2ai_md: tok(md) },
      fidelity: {
        code_total: probes.code.length,
        code_in_a11y: survives(nAria, probes.code),
        code_in_md: survives(nMd, probes.code),
        cells_total: probes.cells.length,
        cells_in_a11y: survives(nAria, probes.cells),
        cells_in_md: survives(nMd, probes.cells),
      },
      // a Markdown much larger than innerText is the linkedom "no layout" symptom
      chars: { innerText: innerText.length, page2ai_md: md.length },
    });
  } catch (e) {
    excluded.push({ url, why: 'ERROR ' + String(e).split('\n')[0].slice(0, 120) });
  }
  await page.close();
}

await browser.close();

if (!rows.length) {
  console.error('No page passed the liveness check. Nothing measured, nothing claimed.');
  process.exit(1);
}

const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
const result = {
  measured_at: new Date().toISOString(),
  tokenizer: 'o200k_base via gpt-tokenizer',
  a11y_api: 'locator.ariaSnapshot() - LOWER BOUND: @playwright/mcp additionally embeds [ref=eN] ids',
  pages_attempted: PAGES.length,
  pages_counted: rows.length,
  excluded,
  per_page: rows,
  totals: {
    a11y: sum((r) => r.tokens.a11y),
    html: sum((r) => r.tokens.html),
    innerText: sum((r) => r.tokens.innerText),
    page2ai_md: sum((r) => r.tokens.page2ai_md),
    code_in_a11y: sum((r) => r.fidelity.code_in_a11y),
    code_in_md: sum((r) => r.fidelity.code_in_md),
    code_total: sum((r) => r.fidelity.code_total),
    cells_in_a11y: sum((r) => r.fidelity.cells_in_a11y),
    cells_in_md: sum((r) => r.fidelity.cells_in_md),
    cells_total: sum((r) => r.fidelity.cells_total),
  },
};

writeFileSync('agent-representations.json', JSON.stringify(result, null, 2));

const t = result.totals;
console.log(`\npages counted: ${rows.length}/${PAGES.length}${excluded.length ? ` (excluded ${excluded.length})` : ''}`);
excluded.forEach((e) => console.log(`  EXCLUDED ${e.url} :: ${e.why}`));

console.log('\nSIZE (tokens)');
console.log(`  a11y snapshot ${t.a11y}   raw HTML ${t.html}   innerText ${t.innerText}   page2ai markdown ${t.page2ai_md}`);
console.log(`  a11y / markdown = ${(t.a11y / t.page2ai_md).toFixed(2)}x   html / markdown = ${(t.html / t.page2ai_md).toFixed(2)}x`);
console.log('  NOTE: the aggregate is dominated by the largest page. Read per_page in the JSON.');

console.log('\nFIDELITY (of content that provably exists in the live DOM)');
console.log(`  code blocks : a11y ${t.code_in_a11y}/${t.code_total}    page2ai markdown ${t.code_in_md}/${t.code_total}`);
console.log(`  table cells : a11y ${t.cells_in_a11y}/${t.cells_total}    page2ai markdown ${t.cells_in_md}/${t.cells_total}`);

console.log('\nper-page ratio and the linkedom hidden-content check:');
for (const r of rows) {
  const ratio = (r.tokens.a11y / r.tokens.page2ai_md).toFixed(2);
  const bloat = (r.chars.page2ai_md / Math.max(1, r.chars.innerText)).toFixed(1);
  const flag = Number(bloat) > 2.5 ? '  <-- markdown >> visible text: linkedom has no layout, check for hidden nav' : '';
  console.log(`  ${r.url.replace(/^https?:\/\//, '').slice(0, 44).padEnd(44)} a11y/md=${ratio.padStart(5)}x  md/innerText=${bloat}x${flag}`);
}
console.log('\nfull results -> agent-representations.json');
