# syntax=docker/dockerfile:1
# The hosted Page2AI MCP endpoint as one long-lived Node process (server.mts), for a container host.
# Build context: this folder as git has it (git archive <sha>:remote), never a working copy: a local
# .env file or .vercel/ folder must not reach a build.
# Node 24, the major the Vercel project runs; pinned by the index digest of node:24-alpine.
ARG NODE_IMAGE=node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM ${NODE_IMAGE}
WORKDIR /app
# Container defaults (non-secret): fetch only the web ports; no 30 s platform stop, so the schema's own
# 60 s maximum applies (the ceiling in front is Cloudflare's 125 s); refuse to start without the
# server's own address in PAGE2AI_EXTRA_BLOCKED_IPS, which the deployment sets (never in code or git).
ENV NODE_ENV=production \
    PORT=3000 \
    PAGE2AI_ALLOWED_PORTS=80,443 \
    PAGE2AI_MAX_TIMEOUT_MS=60000 \
    PAGE2AI_REQUIRE_BLOCKED_IPS=1
# Code and dependencies stay root-owned: the process can read them, not change them.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.mts ./
COPY api ./api
COPY lib ./lib
COPY public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.mts"]
