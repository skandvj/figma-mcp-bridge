FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV MCP_TRANSPORT=sse
ENV MCP_PORT=3100
ENV FIGMA_MODE=demo

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.MCP_PORT || 3100) + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/mcp-server/index.js", "--transport", "sse", "--port", "3100"]
