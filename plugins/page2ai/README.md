# Page2AI for Claude

Page2AI converts a web page to clean Markdown for Claude. Code blocks keep their language, tables stay tables, tab panels come out as separate sections, and navigation menus are dropped. Give it a URL and Claude gets the page's full text instead of a summary; add a query and only the sections that match come back.

The plugin adds one tool, `page_to_markdown`, served by the hosted Page2AI MCP server, and a skill that tells Claude when to use it, what to do when a site refuses the request, and how to read only the part of a long page it needs.

## Where it works

| App | What loads |
|---|---|
| Claude Code | the tool and the skill |
| Cowork | the skill; connect the server once from the plugin's Connectors tab to get the tool |
| claude.ai chat (web, desktop, mobile) | the skill; connect the server once from the plugin's Connectors tab to get the tool |

Nothing is installed on your computer: the plugin points Claude at `https://page2ai.igorsaevets.com/api/mcp`. The server needs no account and no key.

## Examples

- "Read https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/flatMap with Page2AI and show me its code examples."
- "Convert https://docs.python.org/3/library/json.html to Markdown with Page2AI and list the functions it documents, with their signatures."
- "Use Page2AI with the query 'removeprefix' on https://docs.python.org/3/library/stdtypes.html and tell me what that method does."
- "Save https://en.wikipedia.org/wiki/Markdown as Markdown in markdown-article.md, using Page2AI."

## What it sends, fetches and keeps

- **Sends** each URL Claude asks for, with the call's options, to the hosted Page2AI server at page2ai.igorsaevets.com, run by the plugin's author. Requests pass through Cloudflare.
- **Fetches** the page from that server with a plain HTTP request: no cookies, no page scripts, the standard web ports only. Private, loopback and cloud-metadata addresses are refused, so pages on your own network are out of reach.
- **Keeps** nothing after the answer. The server logs one line per request: the time, the status, how long it took, the page's hostname (never the full URL or the page) and a pseudonymous client tag that changes on every restart. The proxies in front of it keep standard access logs (client IP address, user agent, timing) until they rotate. The [privacy policy](https://page2ai.igorsaevets.com/privacy.html) has the details.
- **Limits** each client to about 30 calls a minute and converts a few pages at once; past that it answers "Rate limited" or "busy", and Claude waits and retries.

Do not ask it to open links that carry a password, a token or a signed download parameter: the link goes to the hosted server and to the site.

## What it cannot do

- Pages behind a sign-in, or rendered only by JavaScript, come back as their login page or with little content. Read those with a browser tool.
- Pages on localhost or an intranet, and HTML you already have, are not inputs this server takes.

Page2AI's open-source local server and browser extension do these on your own computer; the repository's README explains them: https://github.com/igorsaevets/page2ai-mcp

## Links

- Documentation: https://igorsaevets.github.io/page2ai-docs/mcp/
- Privacy policy of the hosted server: https://page2ai.igorsaevets.com/privacy.html
- Terms: https://page2ai.igorsaevets.com/terms.html
- Source and issues: https://github.com/igorsaevets/page2ai-mcp
- License: MIT
