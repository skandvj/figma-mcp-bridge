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

EXPOSE 3100

CMD ["node", "dist/mcp-server/index.js", "--transport", "sse", "--port", "3100"]
