// page_to_markdown tool: fetches a URL and returns clean Markdown for LLM context.
// Uses @page2ai/core under the hood — inherits SSRF protection, 10MB size cap,
// 15s AbortController timeout, `.md`-first attempt (Mintlify convention), and
// static tab discovery (emits `### Tab: {label}` sections for docs sites).

import { fetchAndConvert, SsrfBlockedError, FetchProtectionError } from '@page2ai/core';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';

export const pageToMarkdownInputSchema = z.object({
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

export type PageToMarkdownInput = z.infer<typeof pageToMarkdownInputSchema>;

// Alias to the MCP SDK type so the shape stays in sync with protocol changes.
export type PageToMarkdownResult = CallToolResult;

export const pageToMarkdownDefinition = {
  name: 'page_to_markdown',
  title: 'Convert Page to Markdown',
  description:
    'Fetch a web page URL and convert it to clean Markdown optimized for LLM context. ' +
    'Preserves headings, code blocks (with language hints), links, and tables; strips ads, ' +
    'navigation, and cookie banners. For Mintlify docs (docs.anthropic.com, OpenAI platform, ' +
    'Vercel, Stripe, etc.) tries the `URL.md` convention first for cleanest output. ' +
    'Discovers tab groups statically and emits each panel as a `### Tab: {label}` section ' +
    'instead of concatenating (prevents Python+TypeScript examples merging into one broken block). ' +
    'Zero external API calls — parses locally via linkedom.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string' as const,
        format: 'uri',
        description:
          'Absolute HTTP or HTTPS URL of the web page to convert. Blocks private ranges, loopback, and cloud metadata endpoints.',
      },
      include_images: {
        type: 'boolean' as const,
        default: true,
        description: 'Include image references (![alt](src)) in the output.',
      },
      include_frontmatter: {
        type: 'boolean' as const,
        default: true,
        description:
          'Prepend a YAML frontmatter block with title, source URL, capture timestamp, language, description, and canonical URL.',
      },
      timeout_ms: {
        type: 'integer' as const,
        minimum: 1000,
        maximum: 60000,
        default: 15000,
        description: 'Abort the fetch after N milliseconds. Range: 1000-60000.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    idempotentHint: false,   // the fetched page may change between calls
    destructiveHint: false,
  },
};

// Wraps a plain-text error into an MCP tool result with isError:true so the
// LLM sees the error message instead of a JSON-RPC failure.
const errorResult = (message: string): PageToMarkdownResult => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});

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

  try {
    const result = await fetchAndConvert(input.url, {
      timeoutMs: input.timeout_ms,
      includeImages: input.include_images,
      includeFrontmatter: input.include_frontmatter,
    });
    return {
      content: [{ type: 'text' as const, text: result.markdown }],
    };
  } catch (e: unknown) {
    if (e instanceof SsrfBlockedError) {
      return errorResult(`URL blocked by SSRF guard: ${e.message}`);
    }
    if (e instanceof FetchProtectionError) {
      return errorResult(`Fetch failed: ${e.message}`);
    }
    if (e instanceof Error && e.name === 'AbortError') {
      return errorResult(`Fetch timed out after ${input.timeout_ms}ms: ${input.url}`);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return errorResult(`Unexpected error: ${msg}`);
  }
};
