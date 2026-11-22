// The tool definition this endpoint lists (api/mcp.ts): the published @page2ai/mcp copy with the two
// changes the Claude directory's connector review asks for (2026-11-22). The result must equal the
// repo's src copy, which tests/hosted-contract.test.ts pins to the same sha.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { pageToMarkdownHostedDefinition as published } from '@page2ai/mcp/dist/tools/page-to-markdown.js';
import { OTHER_TOOL_SENTENCE, pageToMarkdownHostedDefinition, patchHostedDefinition } from '../api/mcp.ts';

const sha12 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

test('the listed description is the src copy (777959437edc, 953 chars) and names no other tool', () => {
  const d = pageToMarkdownHostedDefinition.description;
  assert.deepEqual([sha12(d), d.length], ['777959437edc', 953]);
  assert.doesNotMatch(d, /browser tool/i);
  assert.match(d, /comes back as its login page or with no content\. It requests only the URL given/);
});

test('annotations carry the title beside the published hints', () => {
  assert.equal(pageToMarkdownHostedDefinition.title, 'Convert Page to Markdown');
  assert.deepEqual(pageToMarkdownHostedDefinition.annotations, { title: 'Convert Page to Markdown', ...published.annotations });
  assert.equal(pageToMarkdownHostedDefinition.name, 'page_to_markdown');
});

test('the patch is a no-op on a definition that already has both changes', () => {
  const once = patchHostedDefinition(published);
  assert.deepEqual(patchHostedDefinition(once), once);
});

test('the published copy still holds the sentence (when it does not, delete patchHostedDefinition)', () => {
  assert.ok(published.description.includes(OTHER_TOOL_SENTENCE),
    'the published @page2ai/mcp no longer has the sentence: remove patchHostedDefinition from api/mcp.ts');
});
