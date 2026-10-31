import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// plugins/page2ai is the Claude Code plugin. It starts this server through npx pinned to one
// release, because Anthropic's plugin directory refuses an unpinned launcher; that pin is one
// more place the version lives, next to package.json, server.json and the wrapper. A release
// that leaves it behind keeps every plugin user, and the directory listing, on the old server.
const root = new URL('../', import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

describe('Claude Code plugin manifest', () => {
  const plugin = readJson('plugins/page2ai/.claude-plugin/plugin.json');
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

  it('points the directory listing at files and pages that exist', () => {
    expect(existsSync(new URL(`plugins/page2ai/${plugin.icon.replace(/^\.\//, '')}`, root))).toBe(true);
    expect(existsSync(new URL('plugins/page2ai/README.md', root))).toBe(true);
    for (const key of ['documentationUrl', 'supportUrl', 'privacyPolicyUrl']) {
      expect(plugin[key]).toMatch(/^https:\/\//);
    }
  });
});
