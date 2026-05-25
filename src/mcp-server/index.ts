import { pathToFileURL } from "node:url";
import cors from "cors";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FigmaClient } from "../figma-client/client.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";

type CliOptions = {
  transport: "stdio" | "sse";
  port: number;
};

export function createMcpServer(client = new FigmaClient()): McpServer {
  const server = new McpServer(
    {
      name: "figma-design-system",
      version: "0.1.0"
    },
    {
      instructions:
        "Expose Figma design tokens, component specs, page layouts, SVG assets, and implementation validation tools."
    }
  );
  registerResources(server, client);
  registerTools(server, client);
  return server;
}

export async function startStdioServer(client = new FigmaClient()): Promise<void> {
  const server = createMcpServer(client);
  await server.connect(new StdioServerTransport());
}

export async function startSseServer(port = 3100, client = new FigmaClient()): Promise<ReturnType<typeof appListen>> {
  const app = express();
  const transports = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      name: "figma-design-system",
      transport: "sse",
      mode: client.runtimeMode,
      defaultProduct: client.defaultProductName,
      products: client.listProductNames()
    });
  });

  app.post("/webhook/figma", (req, res) => {
    res.json(client.handleWebhook(req.body));
  });

  app.get("/sse", async (_req, res) => {
    const server = createMcpServer(client);
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, { transport, server });
    transport.onclose = () => {
      transports.delete(transport.sessionId);
    };
    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = String(req.query.sessionId ?? req.query.session_id ?? "");
    const entry = transports.get(sessionId);
    if (!entry) {
      res.status(404).json({ error: "Unknown SSE session" });
      return;
    }
    await entry.transport.handlePostMessage(req, res, req.body);
  });

  return appListen(app, port);
}

function appListen(app: express.Express, port: number) {
  return app.listen(port, () => {
    console.error(`figma-design-system MCP SSE server listening on http://localhost:${port}/sse`);
  });
}

function parseCliOptions(argv: string[]): CliOptions {
  const transportArg = readFlag(argv, "--transport") ?? process.env.MCP_TRANSPORT ?? "stdio";
  const portArg = readFlag(argv, "--port") ?? process.env.MCP_PORT ?? "3100";
  return {
    transport: transportArg === "sse" ? "sse" : "stdio",
    port: Number.parseInt(portArg, 10)
  };
}

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  return argv[index + 1];
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.transport === "sse") {
    await startSseServer(options.port);
    return;
  }
  await startStdioServer();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
