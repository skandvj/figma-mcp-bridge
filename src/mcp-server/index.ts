import { pathToFileURL } from "node:url";
import { createHmac, timingSafeEqual } from "node:crypto";
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

type RawBodyRequest = express.Request & {
  rawBody?: Buffer;
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
  app.use(express.json({
    limit: "2mb",
    verify: (req: RawBodyRequest, _res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    }
  }));

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

  app.get("/ready", (_req, res) => {
    const readiness = readinessStatus(client);
    res.status(readiness.ok ? 200 : 503).json(readiness);
  });

  app.post("/webhook/figma", verifyWebhook, (req, res) => {
    res.json(client.handleWebhook(req.body));
  });

  app.get("/sse", verifyHttpAuth, async (_req, res) => {
    const server = createMcpServer(client);
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, { transport, server });
    transport.onclose = () => {
      transports.delete(transport.sessionId);
    };
    await server.connect(transport);
  });

  app.post("/messages", verifyHttpAuth, async (req, res) => {
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

function hasSseAuthConfigured(): boolean {
  return Boolean(process.env.MCP_API_KEY || (process.env.MCP_BASIC_AUTH_USERNAME && process.env.MCP_BASIC_AUTH_PASSWORD));
}

function hasWebhookSecret(): boolean {
  return Boolean(process.env.FIGMA_WEBHOOK_SECRET);
}

export function readinessStatus(client: FigmaClient) {
  return {
    ok: client.runtimeMode === "demo" || (client.listProductNames().length > 0 && hasSseAuthConfigured()),
    mode: client.runtimeMode,
    products: client.listProductNames(),
    sseAuthConfigured: hasSseAuthConfigured(),
    webhookSecretConfigured: hasWebhookSecret()
  };
}

export function httpRequestAuthorized(headers: express.Request["headers"]): boolean {
  if (!hasSseAuthConfigured()) return true;

  const expectedApiKey = process.env.MCP_API_KEY;
  const providedApiKey = bearerToken(headers.authorization) ?? stringHeader(headers["x-api-key"]);
  if (expectedApiKey && providedApiKey && timingSafeStringEqual(providedApiKey, expectedApiKey)) {
    return true;
  }

  const expectedUser = process.env.MCP_BASIC_AUTH_USERNAME;
  const expectedPassword = process.env.MCP_BASIC_AUTH_PASSWORD;
  const basic = basicAuth(headers.authorization);
  return Boolean(
    expectedUser
      && expectedPassword
      && basic
      && timingSafeStringEqual(basic.username, expectedUser)
      && timingSafeStringEqual(basic.password, expectedPassword)
  );
}

export function webhookRequestAuthorized(
  headers: express.Request["headers"],
  rawBody: Buffer | undefined,
  body: unknown
): boolean {
  const secret = process.env.FIGMA_WEBHOOK_SECRET;
  if (!secret) return true;

  const sharedSecret = stringHeader(headers["x-webhook-secret"])
    ?? stringHeader(headers["x-figma-webhook-secret"]);
  if (sharedSecret && timingSafeStringEqual(sharedSecret, secret)) return true;

  const signature = stringHeader(headers["x-figma-signature"])
    ?? stringHeader(headers["x-hub-signature-256"]);
  return Boolean(signature && verifyHmacSignature(rawBody ?? Buffer.from(JSON.stringify(body)), secret, signature));
}

function verifyHttpAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (httpRequestAuthorized(req.headers)) {
    next();
    return;
  }

  res.setHeader("WWW-Authenticate", "Bearer, Basic");
  res.status(401).json({ error: "Unauthorized" });
}

function verifyWebhook(req: RawBodyRequest, res: express.Response, next: express.NextFunction): void {
  if (webhookRequestAuthorized(req.headers, req.rawBody, req.body)) {
    next();
    return;
  }

  res.status(401).json({ error: "Invalid webhook signature" });
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function basicAuth(authorization: string | undefined): { username: string; password: string } | undefined {
  const match = authorization?.match(/^Basic\s+(.+)$/i);
  if (!match) return undefined;
  const decoded = Buffer.from(match[1] ?? "", "base64").toString("utf-8");
  const [username = "", ...passwordParts] = decoded.split(":");
  return { username, password: passwordParts.join(":") };
}

function verifyHmacSignature(body: Buffer, secret: string, signature: string): boolean {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  const normalized = signature.replace(/^sha256=/, "");
  return timingSafeStringEqual(normalized, digest);
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function stringHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
