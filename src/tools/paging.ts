// Long pages in parts (BL-59 b). One result for Python's built-in types page was 285,632
// characters (T200), and a client may cut, refuse or spill such a result: Claude Code saves
// one over 50,000 characters to a file and warns over 10,000 tokens; others were not
// measured. A part ends where the Markdown can be cut cleanly, and the first part of a long
// page lists its sections with their offsets, so an agent can read the one it needs instead
// of the whole page (Anthropic Software Directory Policy 5.B: tokens commensurate with the task).

/** About 8,000 tokens: under Claude Code's fixed 10,000-token warning (code.claude.com/docs/en/mcp, read 2026-10-31). */
export const DEFAULT_MAX_LENGTH = 30_000;
export const MIN_MAX_LENGTH = 100;
export const MAX_MAX_LENGTH = 1_000_000;

/** How long the text of a page read in parts stays after its last part was read. */
export const KEEP_MINUTES = 10;
const KEEP_MS = KEEP_MINUTES * 60_000;
const KEEP_PAGES = 8;
const KEEP_CHARS = 16_000_000;
const SECTIONS_LISTED = 40;
const TITLE_CHARS = 80;

interface Line {
  at: number;
  text: string;
  /** A part may start here: not inside the frontmatter or a fenced code block. */
  free: boolean;
  /** The line before this one is blank. */
  afterBlank: boolean;
  /** The last non-blank line before this one is a heading: a part ending here would leave a heading without its text. */
  afterHeading: boolean;
}

// Every line start up to `until`. Fences follow CommonMark: ``` or ~~~, and the closing
// fence is the same character, at least as long, with nothing after it, so no part opens a
// code block that the next part closes.
function* linesOf(text: string, until = text.length): Generator<Line> {
  let fence: { ch: string; len: number } | null = null;
  let front = text.startsWith('---\n');
  let afterBlank = false;
  let afterHeading = false;
  let at = 0;
  while (at <= until && at < text.length) {
    const nl = text.indexOf('\n', at);
    const line = text.slice(at, nl < 0 ? text.length : nl);
    const free = !fence && !(front && at > 0);
    yield { at, text: line, free, afterBlank, afterHeading };
    if (line.trim() !== '') afterHeading = free && /^#{1,6}[ \t]/.test(line);
    if (front) {
      if (at > 0 && line === '---') front = false;
    } else if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len) fence = null;
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) fence = { ch: open[1]![0]!, len: open[1]!.length };
    }
    afterBlank = line.trim() === '';
    if (nl < 0) break;
    at = nl + 1;
  }
}

/**
 * Where the part that starts at `start` ends: the last block boundary (a line after a blank
 * line) in its second half; else the last line start outside a code block, even an early one,
 * so a block that fits into the next part is not split; else the last line start of any kind
 * (a code block longer than a part); else the limit itself (one line longer than a part).
 * The first two never leave a heading at the end of a part, apart from its text.
 */
export const cutAt = (text: string, start: number, maxLength: number): number => {
  const limit = start + maxLength;
  if (limit >= text.length) return text.length;
  const half = start + Math.ceil(maxLength / 2);
  let block = -1;
  let free = -1;
  let any = -1;
  for (const line of linesOf(text, limit)) {
    if (line.at <= start) continue;
    any = line.at;
    if (!line.free || line.afterHeading) continue;
    free = line.at;
    if (line.afterBlank && line.at >= half) block = line.at;
  }
  if (block > 0) return block;
  if (free > 0) return free;
  if (any > 0) return any;
  // Half of a surrogate pair is not text.
  const code = text.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff && limit - 1 > start ? limit - 1 : limit;
};

export interface Section {
  level: number;
  title: string;
  at: number;
  length: number;
}

/** The headings outside code blocks, each with the length of its section (up to the next heading at its level or above). */
export const sectionsOf = (text: string): Section[] => {
  const found: { level: number; title: string; at: number }[] = [];
  for (const line of linesOf(text)) {
    if (!line.free) continue;
    const m = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line.text);
    if (m) found.push({ level: m[1]!.length, title: m[2]!, at: line.at });
  }
  const nextAt = Array<number>(7).fill(text.length);
  const sections: Section[] = Array(found.length);
  for (let i = found.length - 1; i >= 0; i--) {
    const h = found[i]!;
    const end = Math.min(...nextAt.slice(1, h.level + 1));
    sections[i] = { ...h, length: end - h.at };
    nextAt[h.level] = h.at;
  }
  return sections;
};

/** The deepest outline that fits in SECTIONS_LISTED lines; a page whose second level alone is longer gets its first entries. */
const outline = (sections: Section[]): { listed: Section[]; more: number } => {
  const levels = [...new Set(sections.map((s) => s.level))].sort((a, b) => a - b);
  if (levels.length === 0) return { listed: [], more: 0 };
  let listed = sections.filter((s) => s.level <= levels[0]!);
  for (const depth of levels) {
    const upTo = sections.filter((s) => s.level <= depth);
    if (upTo.length > SECTIONS_LISTED) break;
    listed = upTo;
  }
  if (listed.length <= 1 && levels.length > 1) listed = sections.filter((s) => s.level <= levels[1]!);
  return { listed: listed.slice(0, SECTIONS_LISTED), more: Math.max(0, listed.length - SECTIONS_LISTED) };
};

// A heading's links are read as their text, and a permalink mark at its end (Sphinx's
// `[¶](…#id)`, measured on Python's docs T203) is dropped: in a list of sections it is noise.
const shortTitle = (heading: string): string => {
  const title = heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s*[¶#]+$/, '').trim() || heading;
  return title.length > TITLE_CHARS ? `${title.slice(0, TITLE_CHARS - 1)}…` : title;
};

/** The list of sections that goes with the first part of a long page. */
export const sectionList = (text: string): string => {
  const { listed, more } = outline(sectionsOf(text));
  if (listed.length === 0) return 'The page has no headings to jump to.';
  const lines = listed.map((s) => `- ${s.at} (${s.length}): ${'#'.repeat(s.level)} ${shortTitle(s.title)}`);
  if (more > 0) lines.push(`- … and ${more} more at this level.`);
  return ['Sections, as start_index (length): heading', ...lines].join('\n');
};

// Pages read in parts, so that a later part is cut from the same text as the first: fetching
// again would cost the site a request, would open the page in the user's browser again
// through Agent Bridge, and would shift every offset if the page changed in between. Kept in
// this process's memory only, for KEEP_MINUTES after the last part was read; no timer, since
// a timer would hold a stdio server open after its client leaves (E-500).
const kept = new Map<string, { text: string; at: number }>();

const dropExpired = (now: number): void => {
  for (const [key, page] of kept) if (now - page.at > KEEP_MS) kept.delete(key);
};

export const keepPage = (key: string, text: string, now = Date.now()): void => {
  dropExpired(now);
  kept.delete(key);
  kept.set(key, { text, at: now });
  let chars = 0;
  for (const page of kept.values()) chars += page.text.length;
  for (const [oldest, page] of kept) {
    if (kept.size <= 1 || (kept.size <= KEEP_PAGES && chars <= KEEP_CHARS)) break;
    kept.delete(oldest);
    chars -= page.text.length;
  }
};

export const keptPage = (key: string, now = Date.now()): string | undefined => {
  dropExpired(now);
  const page = kept.get(key);
  if (!page) return undefined;
  // Reading a part keeps the page for another KEEP_MINUTES.
  kept.delete(key);
  kept.set(key, { text: page.text, at: now });
  return page.text;
};

export const forgetKeptPages = (): void => {
  kept.clear();
};
