# Vercel Deployment

This project has two production surfaces:

- Public wizard: static assets in `public/**`, deployable to Vercel for recruiter and stakeholder walkthroughs.
- MCP runtime: the SSE/stdio server in `src/mcp-server/index.ts`, best deployed as a long-running Node container because MCP SSE keeps client sessions open.

Vercel is the right host for the public wizard. For the live MCP runtime, use the included Dockerfile on a container platform such as Fly.io, Render, Railway, ECS, or Cloud Run, then point the wizard at that runtime URL.

## Public Wizard On Vercel

```bash
npm install
npm run typecheck
npm test
npm run build
npx vercel deploy --prod
```

The Vercel app serves:

- `/`: guided Figma MCP Bridge walkthrough.
- `/styles.css` and `/app.js`: static wizard assets.

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

## Reviewer Demo Flow

1. Open the Vercel wizard link.
2. Paste the live MCP runtime URL and API key.
3. Verify `/ready` shows `production`, product files, SSE auth, and webhook secret.
4. Copy a resource payload such as `figma://products/web-app/design-tokens`.
5. Copy a codegen payload for `extract_component_code`.
6. Copy a validation payload for `validate_implementation`.

This keeps secrets out of the public Vercel site while still giving reviewers a polished, guided product experience.
