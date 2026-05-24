# Architecture

Figma MCP Bridge has four layers:

1. `FigmaClient`: talks to Figma REST APIs, caches responses in SQLite, rate-limits requests, and provides mock data for local development.
2. `Transformers`: convert Figma primitives into CSS, Style Dictionary tokens, component specs, layout specs, and React-friendly SVG.
3. `MCP server`: exposes resources and tools over stdio or SSE.
4. `TokenPipeline`: writes production-ready token artifacts for app repositories.

## Runtime Flow

```mermaid
sequenceDiagram
  participant Agent
  participant MCP
  participant Client as FigmaClient
  participant Figma
  participant Cache as SQLite Cache

  Agent->>MCP: read figma://components/Button
  MCP->>Client: getComponentSet("Button")
  Client->>Cache: lookup cached file/component
  alt cache hit
    Cache-->>Client: cached JSON
  else cache miss
    Client->>Figma: GET /v1/files/{fileKey}
    Figma-->>Client: file JSON
    Client->>Cache: store with TTL
  end
  Client-->>MCP: Figma node
  MCP-->>Agent: structured component spec
```

## Cache Strategy

The cache table is intentionally small:

```sql
CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
```

Figma file, variable, node, and asset requests use separate cache keys. The default TTL is five minutes. The plugin webhook calls `invalidateCache()` after a design export.

## Transports

The server supports:

- `stdio`: best for Claude Code and local agent processes.
- `SSE`: best for browser/web agents that need HTTP-based MCP sessions.

SSE exposes:

- `GET /sse`
- `POST /messages?sessionId=...`
- `GET /health`
- `POST /webhook/figma`

## Extension Points

- Add a resource in `src/mcp-server/resources.ts`.
- Add a tool in `src/mcp-server/tools.ts`.
- Add a Figma transformation in `src/figma-client/transformers.ts`.
- Add a token output in `src/token-pipeline/pipeline.ts`.
