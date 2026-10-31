// page_to_markdown tool: fetches a URL and returns clean Markdown for LLM context.
// Uses @page2ai/core under the hood — inherits SSRF protection, 10MB size cap,
// 15s AbortController timeout, the page-only fetch (no `.md` twin, a browser's
// Accept header; core 0.2.0, BL-49), and static tab discovery (emits
// `### Tab: {label}` sections for docs sites).

import { lookup } from 'node:dns/promises';
import {
  fetchAndConvert,
  htmlToMarkdown,
  assertSafeUrl,
  findIpBlockReason,
  SsrfBlockedError,
  FetchProtectionError,
} from '@page2ai/core';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { BridgeServer } from '../bridge/server.js';
import { BridgeError } from '../bridge/protocol.js';
import {
  DEFAULT_MAX_LENGTH,
  KEEP_MINUTES,
  MAX_MAX_LENGTH,
  MIN_MAX_LENGTH,
  cutAt,
  keepPage,
  keptPage,
  sectionList,
} from './paging.js';
import { NO_BODY_MARKER, looksLikeSignin, nextStepForError } from './next-steps.js';

const URL_TEXT =
  'Absolute HTTP or HTTPS URL of the web page to convert. Blocks private ranges, loopback, and cloud metadata endpoints. ' +
  'Given with `html`, it is not fetched: it names the page the HTML came from, and relative links resolve against it.';
const HTML_TEXT =
  'Raw HTML of the page to convert instead of fetching it, e.g. from a browser tool. ' +
  'Pass the page\'s `url` with it so relative links resolve. Either `url` or `html` is required.';
const BRIDGE_SETTINGS_TEXT = ' Applies on every path, including through Agent Bridge.';
const MAX_LENGTH_TEXT =
  'Return at most this many characters of the page\'s Markdown. A longer page comes back in parts: each part ' +
  'names the start_index of the next one, and the first part lists the page\'s sections with their start_index. ' +
  `Range: ${MIN_MAX_LENGTH}-${MAX_MAX_LENGTH}.`;
const START_INDEX_TEXT =
  'Character offset to read from: the start_index a part named for the next one, or a section\'s from the list ' +
  `on the first part. Later parts come from the text the first part was cut from, kept for ${KEEP_MINUTES} minutes.`;

export const pageToMarkdownInputSchema = z.object({
  url: z.string().url().optional().describe(URL_TEXT),
  html: z.string().max(10_000_000).optional().describe(HTML_TEXT),
  include_images: z.boolean().optional().default(true).describe(
    'Include image references (![alt](src)) in the output. Default: true.' + BRIDGE_SETTINGS_TEXT,
  ),
  include_frontmatter: z.boolean().optional().default(true).describe(
    'Prepend a YAML frontmatter block with title, source URL, capture timestamp, language, description, and canonical URL. Default: true.' + BRIDGE_SETTINGS_TEXT,
  ),
  timeout_ms: z.number().int().min(1000).max(60000).optional().default(15000).describe(
    'Abort the fetch after N milliseconds. Range: 1000-60000. Default: 15000.',
  ),
  // No zod default: the page size comes from the server that serves the tool (ServeOptions).
  max_length: z.number().int().min(MIN_MAX_LENGTH).max(MAX_MAX_LENGTH).optional().describe(
    `${MAX_LENGTH_TEXT} Default: ${DEFAULT_MAX_LENGTH}.`,
  ),
  start_index: z.number().int().min(0).optional().default(0).describe(`${START_INDEX_TEXT} Default: 0.`),
}).refine((data) => data.url !== undefined || data.html !== undefined, {
  message: 'Provide `url`, `html`, or both.',
});

export type PageToMarkdownInput = z.infer<typeof pageToMarkdownInputSchema>;

// Alias to the MCP SDK type so the shape stays in sync with protocol changes.
export type PageToMarkdownResult = CallToolResult;

export const pageToMarkdownDefinition = {
  name: 'page_to_markdown',
  title: 'Convert Page to Markdown',
  description:
    'Fetch a web page URL and convert it to clean Markdown optimized for LLM context. ' +
    'Preserves headings, code blocks (with language hints), links, and tables; keeps the ' +
    'main content and drops navigation, headers, footers, and sidebars. ' +
    'It fetches without cookies and runs no page scripts, so a page behind a sign-in or one ' +
    'rendered only by JavaScript comes back as its login page or with no content. For those, ' +
    'pass the page HTML you already have from a browser tool as `html` (with its `url`, relative ' +
    'links resolve and nothing is fetched), or ask the user to turn on Agent Bridge in the ' +
    'Page2AI browser extension 1.6.0 or later (if its popup has no Agent Bridge switch, ' +
    'that install is an older store version and the extension must be updated first): ' +
    'while it is connected, `url` pages open in the user\'s own ' +
    'browser with its cookies and scripts, and a page the extension declines is fetched by the ' +
    'server, with a note saying why. ' +
    'It requests only the URL given, as a browser opens a page, so docs sites return the page ' +
    'itself, not a Markdown copy of it; a URL that names a Markdown or text file (a raw GitHub ' +
    'README.md, an llms.txt) comes back as written. ' +
    'A long page comes back in parts (`max_length`, `start_index`), the first part listing the page\'s ' +
    'sections, and a page the server cannot read comes back with the next step to take. ' +
    'Discovers tab groups statically and emits each panel as a `### Tab: {label}` section ' +
    'instead of concatenating (prevents Python+TypeScript examples merging into one broken block). ' +
    'Zero external API calls: pages are parsed locally (linkedom) or in the user\'s browser.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string' as const,
        format: 'uri',
        description: URL_TEXT,
      },
      html: {
        type: 'string' as const,
        maxLength: 10_000_000,
        description: HTML_TEXT,
      },
      include_images: {
        type: 'boolean' as const,
        default: true,
        description: 'Include image references (![alt](src)) in the output.' + BRIDGE_SETTINGS_TEXT,
      },
      include_frontmatter: {
        type: 'boolean' as const,
        default: true,
        description:
          'Prepend a YAML frontmatter block with title, source URL, capture timestamp, language, description, and canonical URL.' +
          BRIDGE_SETTINGS_TEXT,
      },
      timeout_ms: {
        type: 'integer' as const,
        minimum: 1000,
        maximum: 60000,
        default: 15000,
        description: 'Abort the fetch after N milliseconds. Range: 1000-60000.',
      },
      max_length: {
        type: 'integer' as const,
        minimum: MIN_MAX_LENGTH,
        maximum: MAX_MAX_LENGTH,
        default: DEFAULT_MAX_LENGTH,
        description: MAX_LENGTH_TEXT,
      },
      start_index: {
        type: 'integer' as const,
        minimum: 0,
        default: 0,
        description: START_INDEX_TEXT,
      },
    },
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    idempotentHint: false,   // the fetched page may change between calls
    destructiveHint: false,
  },
};

// The hosted endpoint (remote/) serves the contract OpenAI reviewed for the ChatGPT plugin
// (approved 2026-09-11). OpenAI rescans the live server and, after its automated checks,
// replaces a reviewed tool definition with the changed one, so editing these strings changes
// what ChatGPT runs. They stay the 0.4.1 definition: a URL only (no `html`) and no Agent
// Bridge, which a hosted server can never reach. tests/hosted-contract.test.ts pins them.
export const pageToMarkdownHostedInputSchema = z.object({
  url: z.string().url().describe(
    'Absolute HTTP or HTTPS URL of the web page to convert. Blocks private ranges, loopback, and cloud metadata endpoints.',
  ),
  include_images: z.boolean().optional().default(true).describe(
    'Include image references (![alt](src)) in the output. Default: true.',
  ),
  include_frontmatter: z.boolean().optional().default(true).describe(
    'Prepend a YAML frontmatter block with title, source URL, capture timestamp, language, description, and canonical URL. Default: true.',
  ),
  timeout_ms: z.number().int().min(1000).max(60000).optional().default(15000).describe(
    'Abort the fetch after N milliseconds. Range: 1000-60000. Default: 15000.',
  ),
});

export const pageToMarkdownHostedDefinition = {
  name: pageToMarkdownDefinition.name,
  title: pageToMarkdownDefinition.title,
  description:
    'Fetch a web page URL and convert it to clean Markdown optimized for LLM context. ' +
    'Preserves headings, code blocks (with language hints), links, and tables; keeps the ' +
    'main content and drops navigation, headers, footers, and sidebars. ' +
    'It fetches without cookies and runs no page scripts, so a page behind a sign-in or one ' +
    'rendered only by JavaScript comes back as its login page or with no content; read those ' +
    'through a browser tool instead. ' +
    'It requests only the URL given, as a browser opens a page, so docs sites return the page ' +
    'itself, not a Markdown copy of it; a URL that names a Markdown or text file (a raw GitHub ' +
    'README.md, an llms.txt) comes back as written. ' +
    'Discovers tab groups statically and emits each panel as a `### Tab: {label}` section ' +
    'instead of concatenating (prevents Python+TypeScript examples merging into one broken block). ' +
    'Zero external API calls — parses locally via linkedom.',
  annotations: pageToMarkdownDefinition.annotations,
};

// Wraps a plain-text error into an MCP tool result with isError:true so the
// LLM sees the error message instead of a JSON-RPC failure.
const errorResult = (message: string): PageToMarkdownResult => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});

let bridgeRef: BridgeServer | null = null;
// Why a local server has no bridge (another server holds its port): the agent is told that,
// instead of being sent to a switch that cannot help this server.
let bridgeUnavailable: string | null = null;

export const setBridge = (bridge: BridgeServer | null, unavailable: string | null = null): void => {
  bridgeRef = bridge;
  bridgeUnavailable = bridge ? null : unavailable;
};

// What the local stdio server adds to the shared handler (src/index.ts passes it): a page size
// for a call that names none, and next steps that name `html` and Agent Bridge. The hosted
// endpoint (remote/) calls the handler without it: its reviewed contract has no `max_length`,
// `start_index` or `html` and no bridge, so an agent there could never ask for a next part;
// it keeps whole pages, and next steps it can follow.
export interface ServeOptions {
  defaultMaxLength?: number;
  local?: boolean;
}

export const LOCAL_SERVE: ServeOptions = { defaultMaxLength: DEFAULT_MAX_LENGTH, local: true };

export const handlePageToMarkdown = async (
  rawInput: unknown,
  serve: ServeOptions = {},
): Promise<PageToMarkdownResult> => {
  let input: PageToMarkdownInput;
  try {
    input = pageToMarkdownInputSchema.parse(rawInput);
  } catch (e) {
    // zod 4 renamed ZodError.errors to .issues; v2 of the MCP SDK requires zod >= 4.2.
    const msg = e instanceof z.ZodError
      ? e.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      : String(e);
    return errorResult(`Invalid input: ${msg}`);
  }

  // zod's url() takes any scheme (javascript:, file:, data:). The fetch would refuse
  // them, but as the base of `html` one would resolve links and fill `source` unchecked.
  if (input.url !== undefined && !/^https?:$/.test(new URL(input.url).protocol)) {
    return errorResult('Invalid input: url: only http:// and https:// addresses are accepted');
  }

  const parts: Parts = {
    maxLength: input.max_length ?? serve.defaultMaxLength,
    start: input.start_index,
    key: input.url === undefined ? null : JSON.stringify([input.url, input.include_images, input.include_frontmatter]),
    again: input.url === undefined ? 'html' : input.html === undefined ? 'url' : 'url+html',
  };

  // A later part of a long page comes from the text its first part was cut from (paging.ts).
  if (parts.start > 0 && parts.key) {
    const kept = keptPage(parts.key);
    if (kept !== undefined) return partOf(kept, [], parts);
  }

  // --- Path 1: raw HTML provided → convert locally via htmlToMarkdown (mcp#1) ---
  // A `url` given with it is the page's address, never fetched: relative links resolve
  // against it and it fills the frontmatter's `source`. An empty `html` is an error, not
  // a reason to fetch `url` instead: the caller chose the HTML route (0.5.2 fetched on "").
  if (input.html !== undefined) {
    if (input.html.trim() === '') {
      return errorResult('Invalid input: html: empty. Send the page\'s HTML, or leave html out to fetch url.');
    }
    try {
      const result = htmlToMarkdown(input.html, {
        baseUrl: input.url,
        includeImages: input.include_images,
        includeFrontmatter: input.include_frontmatter,
      });
      // Only a frontmatter block can carry the line: without one, a page that opens
      // with <hr> starts with `---` too, and 0.5.3 put the line into its text.
      const markdown = input.include_frontmatter ? markSuppliedHtml(result.markdown) : result.markdown;
      // HTML with no text in it is most often a page's source before its scripts ran.
      const notes = markdown.includes(NO_BODY_MARKER)
        ? ['No readable text came out of this HTML: it may be the page\'s source before its scripts filled it in. ' +
            'Pass the HTML of the rendered page instead (its DOM, e.g. document.documentElement.outerHTML).']
        : [];
      return partOf(markdown, notes, parts);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(`HTML conversion failed: ${msg}`);
    }
  }

  // url is guaranteed present here by the schema refinement (url || html required).
  const url = input.url!;

  // --- Path 2: extension bridge connected → route through the user's browser ---
  // A refusal (no site access, a sensitive or non-web URL) or a failed tab falls
  // through to the server's own fetch, as if no extension were connected, with a
  // note saying why; a timeout does not, since the fetch would spend the caller's
  // time a second time. The protocol's code decides, never the message's wording
  // (0.5.2 matched /timed out/, so a tab-load failure worded so was not retried).
  let bridgeNote: string | null = null;
  if (bridgeRef?.isConnected()) {
    const blocked = await bridgeBlock(url);
    if (blocked) return errorResult(`URL blocked by SSRF guard: ${blocked.message}`);
    try {
      const result = await bridgeRef.convert({
        url,
        includeImages: input.include_images,
        includeFrontmatter: input.include_frontmatter,
        timeoutMs: input.timeout_ms,
      });
      // The browser follows redirects before anyone sees them: a page it ended on at a
      // blocked address is not handed to the agent.
      const landedBlock = await bridgeBlock(result.url);
      if (landedBlock) {
        return errorResult(`URL blocked by SSRF guard: the page redirected to ${result.url}. ${landedBlock.message}`);
      }
      // A redirect (a sign-in page, most often) is still a success for the browser;
      // the agent is told which page it got.
      const notes = pageOf(result.url) !== pageOf(url)
        ? [`Opened in the browser, the page redirected to ${result.url}; the Markdown is of that page.` +
            (looksLikeSignin(result.url, result.title)
              ? ' It looks like a sign-in page: ask the user to sign in to the site in their browser, then try again.'
              : '')]
        : [];
      if (parts.start > 0) notes.push(REFETCHED);
      return partOf(result.markdown, notes, parts);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof BridgeError && e.code === 'TIMEOUT') return errorResult(`Bridge conversion failed: ${msg}`);
      process.stderr.write(`[page2ai-mcp] bridge: ${msg}; fetching without the browser\n`);
      bridgeNote = `Fetched without the browser: the Page2AI extension answered ${msg}`;
    }
  } else {
    // A handshake this server refused leaves no connection: the note is the agent's only
    // sign that the browser was meant to serve this page, and of what the user must fix.
    bridgeNote = bridgeRef?.refusalNote() ?? null;
  }

  // --- Path 3: fetch + linkedom (current behavior) ---
  try {
    const result = await fetchAndConvert(url, {
      timeoutMs: input.timeout_ms,
      includeImages: input.include_images,
      includeFrontmatter: input.include_frontmatter,
    });
    const notes: string[] = [];
    // core's baseUrl is the address the fetch ended on, or a <base href> the page names, so
    // only a landing that looks like a sign-in page is reported; a moved page keeps its new
    // address in the frontmatter's `source`.
    if (pageOf(result.baseUrl) !== pageOf(url) && looksLikeSignin(result.baseUrl, result.title)) {
      notes.push(`The request was redirected to ${result.baseUrl}, which looks like a sign-in page: ` +
        `the page needs the user's session. ${browserStep(serve)}`);
    }
    if (result.markdown.includes(NO_BODY_MARKER)) {
      notes.push('No readable text came out of this page: it is probably built by scripts in the browser, ' +
        `or it needs a sign-in. ${browserStep(serve)}`);
    }
    if (bridgeNote) notes.push(bridgeNote);
    if (parts.start > 0) notes.push(REFETCHED);
    return partOf(result.markdown, notes, parts);
  } catch (e: unknown) {
    const step = nextStepForError(e, {
      browserStep: browserStep(serve),
      timeoutMs: input.timeout_ms,
      local: serve.local === true,
    });
    if (e instanceof SsrfBlockedError) {
      return fetchError(`URL blocked by SSRF guard: ${e.message}`, step, bridgeNote);
    }
    if (e instanceof FetchProtectionError) {
      return fetchError(`Fetch failed: ${e.message}`, step, bridgeNote);
    }
    if (e instanceof Error && e.name === 'AbortError') {
      return fetchError(`Fetch timed out after ${input.timeout_ms}ms: ${url}`, step, bridgeNote);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return fetchError(`Unexpected error: ${msg}`, step, bridgeNote);
  }
};

// A fetch error names its next step and, after a bridge refusal, the refusal too, so the
// agent can tell the user what to change in the extension.
const fetchError = (message: string, step: string | null, bridgeNote: string | null): PageToMarkdownResult =>
  errorResult([message, step, bridgeNote].filter((line) => line).join('\n'));

// How the agent can still get the page through a browser, on this server.
const browserStep = (serve: ServeOptions): string => {
  if (!serve.local) return 'Read the page through a browser tool instead.';
  const html = 'If you can open the page in a browser tool, pass its HTML as `html` together with this `url`';
  if (!bridgeRef) {
    return `${html}.${bridgeUnavailable ? ` Agent Bridge is not available to this server: ${bridgeUnavailable}.` : ''}`;
  }
  // A connected extension has already declined this page; the note after this one says why.
  if (bridgeRef.isConnected()) return `${html}.`;
  const key = bridgeRef.hasKey() ? '' : ', with the key its popup shows set as PAGE2AI_BRIDGE_KEY for this server';
  return `${html}, or ask the user to turn on Agent Bridge in the Page2AI browser extension (1.6.0 or later)${key}, ` +
    'so pages open in their own browser.';
};

const REFETCHED =
  `The earlier parts' text was no longer kept (${KEEP_MINUTES} minutes after the last part read), so this part comes ` +
  'from a new copy of the page: if the page changed, it may not continue the previous part exactly.';

interface Parts {
  /** None: the whole page (the hosted endpoint). */
  maxLength: number | undefined;
  start: number;
  /** Where the page's text is kept between parts: the url and the options that shape the text. */
  key: string | null;
  /** What the next call must carry. */
  again: 'url' | 'url+html' | 'html';
}

const withNotes = (text: string, notes: string[]): PageToMarkdownResult => ({
  content: [text, ...notes].map((t) => ({ type: 'text' as const, text: t })),
});

// One part of the page and its notes. A page that fits in one part comes back as before 0.7.0,
// with no word about parts.
const partOf = (text: string, notes: string[], parts: Parts): PageToMarkdownResult => {
  const { maxLength, start } = parts;
  if (start > 0 && start >= text.length) {
    return errorResult(`Invalid input: start_index: ${start} is past the end of the page, which has ${text.length} characters.`);
  }
  const end = maxLength === undefined ? text.length : cutAt(text, start, maxLength);
  if (start === 0 && end === text.length) return withNotes(text, notes);
  if (parts.key && end < text.length) keepPage(parts.key, text);
  return withNotes(text.slice(start, end), [...notes, partNote(text, start, end, parts.again)]);
};

const partNote = (text: string, start: number, end: number, again: Parts['again']): string => {
  const total = text.length;
  if (end >= total) return `Characters ${start}-${total} of ${total}: the end of the page.`;
  if (start > 0) return `Characters ${start}-${end} of ${total}. Next part: start_index ${end}.`;
  const how = again === 'html'
    ? `call page_to_markdown again with the same html and options and start_index ${end}`
    : `call page_to_markdown again with the same url and options and start_index ${end}` +
      (again === 'url+html'
        ? `, without html: the text is kept for ${KEEP_MINUTES} minutes (after that, send the html again)`
        : `; the text is kept for ${KEEP_MINUTES} minutes, so every part comes from this same copy`);
  return `This is the start of a long page: characters 0-${end} of ${total}. For the next part, ${how}. ` +
    'To read one section only, pass its start_index, and its length as max_length.\n' + sectionList(text);
};

// The page a URL names, to tell a redirect from the same page: host, port and path,
// without an http-to-https upgrade, a trailing slash, the query or the fragment. 0.5.3
// compared hosts only, so a same-host sign-in page (`/doc` to `/login`) went unnoted.
const pageOf = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/\.$/, '').toLowerCase()}:${u.port}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
};

// The tool promises to block private, loopback and metadata addresses, and the server's
// own fetch does; through the bridge the browser must not open them for the agent either
// (0.5.0-0.5.3 sent them to the extension). A name this server cannot resolve still goes
// to the browser, which may reach it through a proxy: only an address the guard names is
// refused. A browser resolving a name differently (DNS rebinding) is not covered.
const bridgeBlock = async (url: string): Promise<SsrfBlockedError | null> => {
  let host: string;
  try {
    host = assertSafeUrl(url).hostname;
  } catch (e) {
    return e instanceof SsrfBlockedError ? e : new SsrfBlockedError(String(e), url);
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return null;
  }
  for (const { address } of addresses) {
    const reason = findIpBlockReason(address);
    if (reason) return new SsrfBlockedError(`hostname "${host}" resolves to blocked address ${address} (${reason})`, url);
  }
  return null;
};

// Markdown made from the caller's HTML names `url` as its source without having fetched
// it, so the frontmatter says where the content came from: a copy saved beside fetched
// pages must not pass for one (any caller can pair any HTML with any URL).
const PROVENANCE_LINE = 'provenance: "HTML supplied by the caller; the source URL was not fetched"';

export const markSuppliedHtml = (markdown: string): string => {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---', 4);
  if (end < 0) return markdown;
  return `${markdown.slice(0, end)}\n${PROVENANCE_LINE}${markdown.slice(end)}`;
};
