# Vercel Deployment

This project has two production surfaces:

- Public dashboard: static assets in `public/**` plus `/api/figma`, deployable to Vercel for recruiter and stakeholder walkthroughs. Users connect their own Figma file with a personal access token and file key.
- MCP runtime: the SSE/stdio server in `src/mcp-server/index.ts`, best deployed as a long-running Node container because MCP SSE keeps client sessions open.

Vercel is the right host for the public dashboard. For the live MCP runtime, use the included Dockerfile on a container platform such as Fly.io, Render, Railway, ECS, or Cloud Run, then point the dashboard at that runtime URL.

## Public Dashboard On Vercel

```bash
npm install
npm run typecheck
npm test
npm run build
npx vercel deploy --prod
```

The Vercel app serves:

- `/`: interactive Figma MCP Bridge product dashboard.
- `/styles.css` and `/app.js`: static dashboard assets.
- `/api/figma`: serverless Figma REST proxy for file inspection, variables, component nodes, and exports.

The public dashboard does not store Figma credentials. The token is accepted from the browser for the current request and forwarded to Figma with `X-Figma-Token`.

Optional AI-assisted component ranking:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1
```

Without these variables, the product still discovers components using Figma metadata, component sets, file-tree structure, and design-system naming signals.

## Live MCP Runtime

Required production environment variables:

```bash
FIGMA_MODE=production
FIGMA_ACCESS_TOKEN=figd_...
FIGMA_FILES_CONFIG=/app/figma.files.json
FIGMA_PRODUCT=web-app
MCP_TRANSPORT=sse
MCP_PORT=3100
MCP_API_KEY=replace-with-generated-secret
FIGMA_WEBHOOK_SECRET=replace-with-generated-secret
```

Optional component library rules:

```bash
CODEGEN_CONFIG=/app/codegen.config.json
```

Deploy the runtime with Docker:

```bash
docker build -t figma-mcp-bridge .
docker run --env-file .env -p 3100:3100 figma-mcp-bridge
curl -H "Authorization: Bearer $MCP_API_KEY" https://your-runtime.example.com/ready
```

## Data And Cache

The bridge uses SQLite for local API response caching. No external database is required for normal production use. If you deploy multiple runtime replicas, treat the cache as disposable per replica and rely on Figma webhooks to invalidate stale records.

## Reviewer Product Flow

1. Open the Vercel dashboard link.
2. Paste a real Figma personal access token and file key.
3. Confirm the dashboard loads file name, component count, and local variables.
4. Select a real component from the connected file.
5. Generate React/Vue/Svelte code for that component.
6. Send generated code to the validator and review the quality score.
7. Open "Agent setup" to paste a live MCP runtime URL and API key.
8. Verify `/ready` shows `production`, product files, SSE auth, and webhook secret.
9. Copy the Claude Code config or MCP payload for a coding-agent workflow.

This keeps secrets out of the deployment while still giving reviewers a polished, usable product experience against their own Figma file.
