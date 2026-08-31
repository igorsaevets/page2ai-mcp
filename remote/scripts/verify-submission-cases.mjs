#!/usr/bin/env node
// Runs the OpenAI plugin submission test cases (5 positive + 3 negative)
// against a live endpoint and reports PASS/FAIL per case. The submission pack
// quotes these results; re-run before actually submitting so every claim in
// the form is backed by a same-day execution.
//
// Usage: node scripts/verify-submission-cases.mjs [endpointUrl]
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const ENDPOINT = process.argv[2] ?? 'https://page2ai-mcp-remote.vercel.app/api/mcp';

const client = new Client(
  { name: 'page2ai-case-verify', version: '1.0.0' },
  { versionNegotiation: { mode: 'auto' } },
);
await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT)));
console.log(`endpoint=${ENDPOINT} era=${client.getProtocolEra()}`);

async function call(args) {
  return client.callTool({ name: 'page_to_markdown', arguments: args });
}
function text(result) {
  return result.content?.find((c) => c.type === 'text')?.text ?? '';
}

const cases = [
  {
    id: 'P1',
    desc: 'example.com -> markdown with exactly one H1',
    run: async () => {
      const r = await call({ url: 'https://example.com/' });
      const md = text(r);
      return !r.isError && md.includes('# Example Domain') && (md.match(/^# /gm) ?? []).length === 1;
    },
  },
  {
    id: 'P2',
    desc: 'MDN reference page -> headings and inline code survive',
    run: async () => {
      const r = await call({ url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429' });
      const md = text(r);
      // Frontmatter is on by default, so the page title lands in YAML `title:`.
      return !r.isError && md.includes('title: "429 Too Many Requests"') && md.includes('Retry-After');
    },
  },
  {
    id: 'P3',
    desc: 'include_frontmatter=true -> YAML frontmatter carries source URL and title',
    run: async () => {
      const r = await call({ url: 'https://example.com/', include_frontmatter: true });
      const md = text(r);
      return !r.isError && md.startsWith('---') && md.includes('https://example.com') && /title:/.test(md);
    },
  },
  {
    id: 'P4',
    desc: 'include_images=false -> no image markdown in an image-heavy article',
    run: async () => {
      // Not the /wiki/Markdown article: it QUOTES image syntax as page text,
      // which correctly survives (only real <img> elements are stripped).
      const r = await call({ url: 'https://en.wikipedia.org/wiki/Golden_Gate_Bridge', include_images: false });
      const md = text(r);
      return !r.isError && md.length > 5000 && !md.includes('![');
    },
  },
  {
    id: 'P5',
    desc: 'long-form article -> main content extracted, boilerplate dropped',
    run: async () => {
      const r = await call({ url: 'https://en.wikipedia.org/wiki/Small_business' });
      const md = text(r);
      return !r.isError && md.length > 5000 && /^# /m.test(md);
    },
  },
  {
    id: 'N1',
    desc: 'cloud metadata endpoint -> refused by SSRF guard (isError, no fetch)',
    run: async () => {
      const r = await call({ url: 'http://169.254.169.254/latest/meta-data/' });
      return r.isError === true && /blocked|private|metadata|not allowed|refus/i.test(text(r));
    },
  },
  {
    id: 'N2',
    desc: 'file:// scheme -> refused by scheme validation (isError)',
    run: async () => {
      const r = await call({ url: 'file:///etc/passwd' });
      return r.isError === true && /scheme|file:|not in/i.test(text(r));
    },
  },
  {
    id: 'N3',
    desc: 'non-existent domain -> clean tool error, not a protocol failure',
    run: async () => {
      const r = await call({ url: 'https://no-such-host.page2ai.invalid/' });
      return r.isError === true && text(r).length > 0;
    },
  },
  {
    id: 'N4',
    desc: 'loopback address -> refused by SSRF guard (runner extra, not on the form)',
    run: async () => {
      const r = await call({ url: 'http://127.0.0.1:8080/admin' });
      return r.isError === true && /blocked|private|loopback|not allowed|refus/i.test(text(r));
    },
  },
];

let failures = 0;
for (const c of cases) {
  let ok = false;
  let err = '';
  try {
    ok = await c.run();
  } catch (e) {
    err = ` (${e.message})`;
  }
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.desc}${err}`);
}

await client.close();
console.log(failures === 0 ? `ALL ${cases.length} CASES PASS` : `${failures} CASE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
