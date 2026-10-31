// What an agent can do next when this server cannot read a page (BL-59 c; Anthropic Software
// Directory Policy 5.A: "helpful feedback rather than generic error messages"). Measured T200:
// npm, Stack Overflow, Medium and OpenAI answered HTTP 403 to the server on both the local and
// the hosted path, and the agent got only the status line, with nothing to tell it that the
// same request would be refused again or what else it could do. The status line stays the
// first line, as before (the hosted endpoint matches its start); the next step follows it.

import { FetchProtectionError, SsrfBlockedError } from '@page2ai/core';

export interface StepContext {
  /** How the agent can get the page through a browser on this server: a whole sentence. */
  browserStep: string;
  timeoutMs: number;
  /** The local server takes a longer timeout_ms; the hosted endpoint clamps it. */
  local: boolean;
}

// core's wording: `HTTP 403 Forbidden, content-type=...`; a 3xx without Location is not a status answer.
const statusOf = (message: string): number | null => {
  const m = /\bHTTP (\d{3}) (?!redirect)/.exec(message);
  return m ? Number(m[1]) : null;
};

export const nextStepForError = (e: unknown, ctx: StepContext): string | null => {
  if (e instanceof Error && e.name === 'AbortError') {
    return ctx.local
      ? `The page did not finish loading in ${ctx.timeoutMs} ms: try again with a larger timeout_ms (up to 60000), or later.`
      : 'The page did not finish loading in time; trying again later may work.';
  }
  if (!(e instanceof FetchProtectionError) && !(e instanceof SsrfBlockedError)) return null;
  const msg = e.message;
  // core reports a name that does not resolve through its address guard, which reads like a
  // refusal; the agent is told it is a typo or a dead host, not a policy.
  if (/DNS resolution failed/.test(msg)) {
    return 'The host name does not resolve, so there is no page to fetch: check the URL for a typo. The address guard is not refusing it.';
  }
  if (e instanceof SsrfBlockedError || /blocked by SSRF guard/.test(msg)) {
    return 'This tool never opens private, loopback or cloud metadata addresses, so it cannot read this one.';
  }
  const status = statusOf(msg);
  if (status !== null && status >= 400) {
    if (status === 404 || status === 410) {
      return `There is no page at this address (HTTP ${status}): check the URL; the same request will fail again.`;
    }
    if (status === 401) return `The page needs a sign-in (HTTP 401). ${ctx.browserStep}`;
    if (status === 429) return `The site is limiting requests (HTTP 429): wait before trying again. ${ctx.browserStep}`;
    if (status >= 500) {
      return `The site failed to answer (HTTP ${status}); trying again later may work.${status === 503 ? ` ${ctx.browserStep}` : ''}`;
    }
    return `The site refused the request (HTTP ${status}). Many sites refuse requests that do not come from a browser, ` +
      `so the same request will be refused again. ${ctx.browserStep}`;
  }
  const type = /content-type "([^";]+)/.exec(msg);
  if (type) return `This address serves ${type[1]!.trim()}, not a web page: page_to_markdown reads HTML pages and text files only.`;
  if (/exceeds \d+ bytes cap/.test(msg)) return 'The page is larger than the 10 MB this tool reads.';
  if (/more than \d+ redirects/.test(msg)) return 'The address redirects in a loop.';
  return null;
};

// A landing that looks like a sign-in page: its host or path, or its title. Used only when the
// page that came back is not the page asked for, so a URL that is itself a sign-in page is not
// reported as one the agent was sent to.
const SIGNIN_HOST = /^(login|signin|auth|accounts?|sso|id|identity)\./i;
const SIGNIN_PATH = /(^|\/)(log-?in|sign-?in|sign-?on|sso|auth|oauth2?|authorize|session)(\/|\.|$)/i;
const SIGNIN_TITLE = /\b(sign|log)[ -]?in\b/i;

export const looksLikeSignin = (url: string, title = ''): boolean => {
  if (SIGNIN_TITLE.test(title)) return true;
  try {
    const u = new URL(url);
    return SIGNIN_HOST.test(u.hostname) || SIGNIN_PATH.test(u.pathname);
  } catch {
    return false;
  }
};

/** What core writes when the walk found no text (a page built by scripts, or one it did not understand). */
export const NO_BODY_MARKER = '<!-- AI: page has no extractable body content -->';
