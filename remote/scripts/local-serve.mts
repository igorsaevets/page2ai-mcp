// Local adapter for the Vercel function: serves api/mcp.ts on http://localhost:3999
// so smoke-remote.mjs can exercise the exact handler code before any deploy.
// Run: npx tsx scripts/local-serve.mts
import { createServer } from 'node:http';
import { GET, POST, DELETE } from '../api/mcp.js';

const PORT = Number(process.env.PORT ?? 3999);

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(', '));
    }

    const url = `http://localhost:${PORT}${req.url ?? '/'}`;
    const request = new Request(url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : body,
    });

    const handler =
      req.method === 'POST' ? POST : req.method === 'DELETE' ? DELETE : GET;
    const response = await handler(request);

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      for await (const chunk of response.body) {
        res.write(chunk);
      }
    }
    res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`local-serve error: ${e instanceof Error ? e.stack : String(e)}`);
  }
});

server.listen(PORT, () => {
  console.log(`local-serve: http://localhost:${PORT}/api/mcp`);
});
