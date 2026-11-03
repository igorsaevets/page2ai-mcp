import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CLI = join(import.meta.dirname, '..', 'cli', 'index.js');

const run = (args: string[], input?: string): { stdout: string; stderr: string; code: number } => {
  const r = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    input,
    timeout: 30_000,
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? 1 };
};

describe('page2ai CLI', () => {
  it('shows help with no arguments', () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('page2ai — convert any web page to clean Markdown');
  });

  it('shows help with --help', () => {
    const r = run(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });

  it('shows version with --version', () => {
    const r = run(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^page2ai \d+\.\d+\.\d+/);
  });

  it('rejects unknown flags', () => {
    const r = run(['--not-a-flag']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unknown option');
  });

  it('fetches example.com', () => {
    const r = run(['https://example.com']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Example Domain');
    expect(r.stdout).not.toContain('---'); // no frontmatter by default
  });

  it('includes frontmatter with --frontmatter', () => {
    const r = run(['https://example.com', '--frontmatter']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^---/);
    expect(r.stdout).toContain('title: "Example Domain"');
    expect(r.stdout).toContain('extractor_version:');
  });

  it('truncates with --max-length', () => {
    const r = run(['https://example.com', '--max-length', '30']);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBeLessThanOrEqual(31); // 30 + trailing newline
    expect(r.stderr).toContain('truncated');
  });

  it('reads HTML from stdin', () => {
    const r = run(['-'], '<html><body><h1>Stdin</h1><p>Works</p></body></html>');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('# Stdin');
    expect(r.stdout).toContain('Works');
  });

  it('reads a local HTML file', () => {
    const file = join(tmpdir(), `page2ai-test-${Date.now()}.html`);
    writeFileSync(file, '<html><body><main><h2>Local</h2><p>File test</p></main></body></html>');
    try {
      const r = run(['--html', file]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('## Local');
      expect(r.stdout).toContain('File test');
    } finally {
      unlinkSync(file);
    }
  });

  it('blocks SSRF targets', () => {
    const r = run(['https://169.254.169.254/latest/meta-data/']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('SSRF');
  });

  it('blocks localhost', () => {
    const r = run(['https://127.0.0.1:1234']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('private range');
  });

  it('rejects empty stdin', () => {
    const r = run(['-'], '');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('empty input');
  });

  it('strips images with --no-images', () => {
    const html = '<html><body><h1>Hi</h1><img src="photo.jpg" alt="A photo"><p>Text</p></body></html>';
    const withImages = run(['-'], html);
    const withoutImages = run(['--no-images', '-'], html);
    expect(withImages.stdout).toContain('![');
    expect(withoutImages.stdout).not.toContain('![');
  });
});
