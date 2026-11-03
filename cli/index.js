#!/usr/bin/env node
// page2ai CLI — convert a web page or local HTML to clean Markdown.
// Usage: npx page2ai <url>              — fetch and convert
//        npx page2ai --html <file>      — convert a local HTML file
//        cat page.html | npx page2ai -  — read HTML from stdin
import { readFileSync } from 'node:fs';
import { fetchAndConvert, htmlToMarkdown } from '@page2ai/core';

const HELP = `page2ai — convert any web page to clean Markdown

Usage:
  npx page2ai <url>                  Fetch a URL and print Markdown
  npx page2ai --html <file>          Convert a local HTML file
  npx page2ai --html -               Read HTML from stdin
  echo '<h1>Hi</h1>' | npx page2ai - Read HTML from stdin (shorthand)

Options:
  --frontmatter          Include YAML frontmatter (off by default)
  --no-images            Strip image references
  --timeout <ms>         Fetch timeout in milliseconds (default: 15000)
  --max-length <chars>   Truncate output at N characters
  --base-url <url>       Base URL for resolving relative links (with --html)
  --version              Print version and exit
  -h, --help             Show this help

Examples:
  npx page2ai https://example.com
  npx page2ai https://docs.python.org/3/library/stdtypes.html --max-length 5000
  npx page2ai --html page.html --base-url https://example.com
  curl -s https://example.com | npx page2ai -`;

function fatal(msg) {
  process.stderr.write(`page2ai: ${msg}\n`);
  process.exit(1);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
    // Timeout: if stdin has no data after 5s, it's probably not piped
    const timer = setTimeout(() => {
      if (chunks.length === 0) {
        reject(new Error('no input on stdin (pipe HTML or use a URL)'));
      }
    }, 5000);
    process.stdin.on('end', () => clearTimeout(timer));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  let url = null;
  let htmlFile = null;
  let frontmatter = false;
  let images = true;
  let timeout = 15000;
  let maxLength = 0;
  let baseUrl = 'about:blank';
  let stdinMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP + '\n');
      process.exit(0);
    }
    if (arg === '--version') {
      const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
      process.stdout.write(`page2ai ${pkg.version}\n`);
      process.exit(0);
    }
    if (arg === '--frontmatter') { frontmatter = true; continue; }
    if (arg === '--no-images') { images = false; continue; }
    if (arg === '--timeout') { timeout = parseInt(args[++i], 10); continue; }
    if (arg === '--max-length') { maxLength = parseInt(args[++i], 10); continue; }
    if (arg === '--base-url') { baseUrl = args[++i]; continue; }
    if (arg === '--html') {
      htmlFile = args[++i];
      if (!htmlFile) fatal('--html requires a file path (or - for stdin)');
      continue;
    }
    if (arg === '-') { stdinMode = true; continue; }
    if (arg.startsWith('-')) fatal(`unknown option: ${arg}`);
    if (!url) { url = arg; continue; }
    fatal(`unexpected argument: ${arg}`);
  }

  let markdown;

  if (stdinMode || htmlFile === '-') {
    // Read HTML from stdin
    let html;
    try {
      html = await readStdin();
    } catch (e) {
      fatal(e.message);
    }
    if (!html.trim()) fatal('empty input');
    const result = htmlToMarkdown(html, {
      baseUrl: url || baseUrl,
      includeFrontmatter: frontmatter,
      includeImages: images,
    });
    markdown = result.markdown;
  } else if (htmlFile) {
    // Read a local HTML file
    let html;
    try {
      html = readFileSync(htmlFile, 'utf8');
    } catch (e) {
      fatal(`cannot read ${htmlFile}: ${e.message}`);
    }
    const result = htmlToMarkdown(html, {
      baseUrl: url || baseUrl,
      includeFrontmatter: frontmatter,
      includeImages: images,
    });
    markdown = result.markdown;
  } else if (url) {
    // Fetch a URL
    try {
      const result = await fetchAndConvert(url, {
        includeFrontmatter: frontmatter,
        includeImages: images,
        timeoutMs: timeout,
      });
      markdown = result.markdown;
    } catch (e) {
      fatal(e.message);
    }
  } else {
    fatal('provide a URL, --html <file>, or pipe HTML to stdin');
  }

  if (maxLength > 0 && markdown.length > maxLength) {
    markdown = markdown.slice(0, maxLength);
    process.stderr.write(`page2ai: output truncated at ${maxLength} characters\n`);
  }

  process.stdout.write(markdown);
  if (markdown.length > 0 && !markdown.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

main().catch((e) => {
  fatal(e.message || String(e));
});
