import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pageToMarkdownHostedInputSchema } from '../src/tools/page-to-markdown.js';

// Two Claude Code plugins live in this repository, both named `page2ai`:
// - plugins/page2ai-local starts this server on the user's computer through npx pinned to one
//   release, with the optional Agent Bridge. Our own marketplace (.claude-plugin/marketplace.json)
//   installs it. The pin is one more place the version lives, next to package.json, server.json
//   and the wrapper: a release that leaves it behind keeps every plugin user on the old server.
// - plugins/page2ai points at the hosted endpoint. Anthropic's plugin directory reads this path
//   (it cannot be changed without a new submission) and refuses a plugin that starts a local
//   MCP server unless the submitting organization is Verified (finding LOCAL_CODE_MCP_SERVER,
//   2026-11-03). A hosted URL is accepted.
// The marketplace must keep pointing at the local plugin: pointed at plugins/page2ai, an update
// would move every local user's URLs to the author's server without asking them.
const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const readJson = (path: string) => JSON.parse(read(path));
const HOSTED_URL = 'https://page2ai.igorsaevets.com/api/mcp';

describe('local plugin (our marketplace)', () => {
  const plugin = readJson('plugins/page2ai-local/.claude-plugin/plugin.json');
  const pkg = readJson('package.json');

  it('runs exactly this release of the server', () => {
    expect(plugin.mcpServers.page2ai.command).toBe('npx');
    expect(plugin.mcpServers.page2ai.args).toEqual(['-y', `page2ai-mcp@${pkg.version}`]);
  });

  it('gives the optional bridge key an empty default, so Cowork still starts the server', () => {
    // Cowork skips an MCP server whose ${user_config.*} option has no default, and it never
    // prompts for one; an empty key means "no bridge" to the server (src/bridge/keys.ts).
    expect(plugin.mcpServers.page2ai.env.PAGE2AI_BRIDGE_KEY).toBe('${user_config.bridge_key}');
    expect(plugin.userConfig.bridge_key).toMatchObject({ sensitive: true, required: false, default: '' });
  });

  it('points at files and pages that exist', () => {
    expect(existsSync(new URL(`plugins/page2ai-local/${plugin.icon.replace(/^\.\//, '')}`, root))).toBe(true);
    expect(existsSync(new URL('plugins/page2ai-local/README.md', root))).toBe(true);
    for (const key of ['documentationUrl', 'supportUrl', 'privacyPolicyUrl']) {
      expect(plugin[key]).toMatch(/^https:\/\//);
    }
  });
});

describe('our marketplace', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json');

  it('installs `page2ai` from the local plugin, never from the hosted one', () => {
    expect(marketplace.plugins).toHaveLength(1);
    const [entry] = marketplace.plugins;
    expect(entry.name).toBe('page2ai');
    expect(entry.source).toBe('./plugins/page2ai-local');
    expect(readJson('plugins/page2ai-local/.claude-plugin/plugin.json').name).toBe(entry.name);
  });
});

describe('hosted plugin (the Claude directory reads plugins/page2ai)', () => {
  const plugin = readJson('plugins/page2ai/.claude-plugin/plugin.json');
  const skill = read('plugins/page2ai/skills/page2ai/SKILL.md');
  const readme = read('plugins/page2ai/README.md');

  it('keeps the name the directory submission was made under, with a semver version', () => {
    expect(plugin.name).toBe('page2ai');
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares only remote MCP servers, at the published hosted endpoint', () => {
    const servers = Object.values(plugin.mcpServers) as Record<string, unknown>[];
    expect(servers).toHaveLength(1);
    for (const server of servers) {
      expect(server).toEqual({ type: 'http', url: HOSTED_URL });
    }
    // Nothing runs on the user's computer: no launcher, no headers helper, no options that
    // Cowork would skip the server for.
    expect(read('plugins/page2ai/.claude-plugin/plugin.json')).not.toMatch(/"command"|headersHelper|user_config/);
    expect(plugin.userConfig).toBeUndefined();
    expect(existsSync(new URL('plugins/page2ai/.mcp.json', root))).toBe(false);
  });

  it('links the hosted server privacy policy and files that exist', () => {
    expect(plugin.privacyPolicyUrl).toBe('https://page2ai.igorsaevets.com/privacy.html');
    expect(existsSync(new URL(`plugins/page2ai/${plugin.icon.replace(/^\.\//, '')}`, root))).toBe(true);
    for (const key of ['documentationUrl', 'supportUrl']) {
      expect(plugin[key]).toMatch(/^https:\/\//);
    }
  });

  it('documents exactly the arguments the hosted endpoint accepts', () => {
    const rows = [...skill.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).sort();
    expect(rows).toEqual(Object.keys(pageToMarkdownHostedInputSchema.shape).sort());
  });

  it('promises nothing only the local server does, and names no local launcher', () => {
    for (const text of [skill, readme]) {
      expect(text).not.toMatch(/npx|Agent Bridge|bridge_key|`html`|`start_index`|`max_length`/);
    }
    expect(skill).toContain('mcp__plugin_page2ai_page2ai-hosted__page_to_markdown');
    expect(Object.keys(plugin.mcpServers)).toEqual(['page2ai-hosted']);
  });
});
