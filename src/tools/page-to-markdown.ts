// page_to_markdown tool: fetches a URL and returns clean Markdown for LLM context.
// Uses @page2ai/core under the hood — inherits SSRF protection, 10MB size cap,
// 15s AbortController timeout, the page-only fetch (no `.md` twin, a browser's
// Accept header; core 0.2.0, BL-49), and static tab discovery (emits
// `### Tab: {label}` sections for docs sites).

import { fetchAndConvert, htmlToMarkdown, SsrfBlockedError, FetchProtectionError } from '@page2ai/core';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { BridgeServer } from '../bridge/server.js';

const URL_TEXT =
  'Absolute HTTP or HTTPS URL of the web page to convert. Blocks private ranges, loopback, and cloud metadata endpoints. ' +
  'Given with `html`, it is not fetched: it names the page the HTML came from, and relative links resolve against it.';
const HTML_TEXT =
  'Raw HTML of the page to convert instead of fetching it, e.g. from a browser tool. ' +
  'Pass the page\'s `url` with it so relative links resolve. Either `url` or `html` is required.';
const BRIDGE_SETTINGS_TEXT = ' Through Agent Bridge the extension\'s own output settings apply instead.';

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
}).refine((data) => data.url || data.html, {
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
    'Page2AI browser extension: while it is connected, `url` pages open in the user\'s own ' +
    'browser with its cookies and scripts, and a page the extension declines is fetched by the ' +
    'server, with a note saying why. ' +
    'It requests only the URL given, as a browser opens a page, so docs sites return the page ' +
    'itself, not a Markdown copy of it; a URL that names a Markdown or text file (a raw GitHub ' +
    'README.md, an llms.txt) comes back as written. ' +
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

export const setBridge = (bridge: BridgeServer | null): void => {
  bridgeRef = bridge;
};

export const handlePageToMarkdown = async (
  rawInput: unknown,
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

  // --- Path 1: raw HTML provided → convert locally via htmlToMarkdown (mcp#1) ---
  // A `url` given with it is the page's address, never fetched: relative links resolve
  // against it and it fills the frontmatter's `source`.
  if (input.html) {
    try {
      const result = htmlToMarkdown(input.html, {
        baseUrl: input.url,
        includeImages: input.include_images,
        includeFrontmatter: input.include_frontmatter,
      });
      return {
        content: [{ type: 'text' as const, text: result.markdown }],
      };
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
  // time a second time.
  let bridgeNote: string | null = null;
  if (bridgeRef?.isConnected()) {
    try {
      const result = await bridgeRef.convert({
        url,
        includeImages: input.include_images,
        includeFrontmatter: input.include_frontmatter,
        timeoutMs: input.timeout_ms,
      });
      return {
        content: [{ type: 'text' as const, text: result.markdown }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/TIMEOUT|timed out/i.test(msg)) return errorResult(`Bridge conversion failed: ${msg}`);
      process.stderr.write(`[page2ai-mcp] bridge: ${msg}; fetching without the browser\n`);
      bridgeNote = `Fetched without the browser: the Page2AI extension answered ${msg}`;
    }
  }

  // --- Path 3: fetch + linkedom (current behavior) ---
  try {
    const result = await fetchAndConvert(url, {
      timeoutMs: input.timeout_ms,
      includeImages: input.include_images,
      includeFrontmatter: input.include_frontmatter,
    });
    return {
      content: [
        { type: 'text' as const, text: result.markdown },
        ...(bridgeNote ? [{ type: 'text' as const, text: bridgeNote }] : []),
      ],
    };
  } catch (e: unknown) {
    if (e instanceof SsrfBlockedError) {
      return fetchError(`URL blocked by SSRF guard: ${e.message}`, bridgeNote);
    }
    if (e instanceof FetchProtectionError) {
      return fetchError(`Fetch failed: ${e.message}`, bridgeNote);
    }
    if (e instanceof Error && e.name === 'AbortError') {
      return fetchError(`Fetch timed out after ${input.timeout_ms}ms: ${url}`, bridgeNote);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return fetchError(`Unexpected error: ${msg}`, bridgeNote);
  }
};

// A fetch error after a bridge refusal names both, so the agent can tell the
// user what to change in the extension.
const fetchError = (message: string, bridgeNote: string | null): PageToMarkdownResult =>
  errorResult(bridgeNote ? `${message}\n${bridgeNote}` : message);
