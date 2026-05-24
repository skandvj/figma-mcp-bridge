import Database from "better-sqlite3";
import {
  MOCK_COMPONENTS,
  MOCK_FILE,
  MOCK_PAGES,
  MOCK_SVG,
  MOCK_VARIABLES
} from "./mock-data.js";
import { optimizeSvgForReact } from "./transformers.js";
import type { FigmaClientOptions, FigmaNode, FigmaVariable } from "./types.js";

type CacheRow = {
  value: string;
  expires_at: number;
};

type FigmaFile = {
  name?: string;
  document?: FigmaNode;
  components?: Record<string, { name?: string }>;
  componentSets?: Record<string, { name?: string }>;
};

export class FigmaClient {
  private readonly accessToken: string | undefined;
  private readonly fileKey: string | undefined;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly rateLimitPerMinute: number;
  private readonly useMockData: boolean;
  private readonly db: Database.Database;
  private lastRequestAt = 0;

  constructor(options: FigmaClientOptions = {}) {
    this.accessToken = options.accessToken ?? process.env.FIGMA_ACCESS_TOKEN;
    this.fileKey = options.fileKey ?? process.env.FIGMA_FILE_KEY;
    this.baseUrl = (options.baseUrl ?? process.env.FIGMA_BASE_URL ?? "https://api.figma.com").replace(/\/$/, "");
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60_000;
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? 30;
    this.useMockData = options.useMockData ?? (process.env.FIGMA_MOCK_DATA ? process.env.FIGMA_MOCK_DATA === "true" : (!this.accessToken || !this.fileKey));

    const cachePath = options.cachePath ?? process.env.FIGMA_CACHE_PATH ?? "figma-cache.sqlite";
    this.db = new Database(cachePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  async getFile(): Promise<FigmaFile> {
    if (this.useMockData) return MOCK_FILE;
    this.assertConfigured();
    return this.requestJson<FigmaFile>(`/v1/files/${this.fileKey}`);
  }

  async getVariables(): Promise<FigmaVariable[]> {
    if (this.useMockData) return MOCK_VARIABLES;
    this.assertConfigured();
    const data = await this.requestJson<{ meta?: { variables?: Record<string, unknown> } }>(
      `/v1/files/${this.fileKey}/variables/local`
    );
    return Object.values(data.meta?.variables ?? {}).map((raw) => normalizeVariable(raw));
  }

  async getComponentSet(name: string): Promise<FigmaNode> {
    const normalized = normalizeName(name);
    if (this.useMockData) {
      const match = MOCK_COMPONENTS.find((node) => normalizeName(node.name) === normalized);
      if (!match) throw new Error(`Component not found: ${name}`);
      return match;
    }

    const file = await this.getFile();
    const match = flattenNodes(file.document)
      .filter((node) => node.type === "COMPONENT_SET" || node.type === "COMPONENT")
      .find((node) => normalizeName(node.name) === normalized);
    if (!match) throw new Error(`Component not found: ${name}`);
    return match;
  }

  async getNodeById(id: string): Promise<FigmaNode> {
    if (this.useMockData) {
      const match = [...MOCK_COMPONENTS.flatMap((node) => flattenNodes(node)), ...MOCK_PAGES.flatMap((node) => flattenNodes(node))]
        .find((node) => node.id === id);
      if (!match) throw new Error(`Node not found: ${id}`);
      return match;
    }

    this.assertConfigured();
    const data = await this.requestJson<{ nodes?: Record<string, { document?: FigmaNode }> }>(
      `/v1/files/${this.fileKey}/nodes?ids=${encodeURIComponent(id)}`
    );
    const node = data.nodes?.[id]?.document;
    if (!node) throw new Error(`Node not found: ${id}`);
    return node;
  }

  async getPageLayout(pageName: string): Promise<FigmaNode> {
    const normalized = normalizeName(pageName);
    const file = await this.getFile();
    const page = flattenNodes(file.document).find(
      (node) => node.type === "CANVAS" && normalizeName(node.name) === normalized
    );
    if (!page) throw new Error(`Page not found: ${pageName}`);
    return page;
  }

  async listComponentNames(): Promise<string[]> {
    if (this.useMockData) return MOCK_COMPONENTS.map((node) => node.name);
    const file = await this.getFile();
    return flattenNodes(file.document)
      .filter((node) => node.type === "COMPONENT_SET" || node.type === "COMPONENT")
      .map((node) => node.name)
      .sort();
  }

  async listPageNames(): Promise<string[]> {
    const file = await this.getFile();
    return flattenNodes(file.document)
      .filter((node) => node.type === "CANVAS")
      .map((node) => node.name)
      .sort();
  }

  async exportNode(idOrName: string, format: "svg" | "png" = "svg"): Promise<string> {
    if (this.useMockData) {
      const component = MOCK_COMPONENTS.find(
        (node) => node.id === idOrName || normalizeName(node.name) === normalizeName(idOrName)
      );
      const svg = MOCK_SVG[component?.name ?? idOrName] ?? MOCK_SVG.Button;
      return format === "svg" ? optimizeSvgForReact(svg ?? "") : "data:image/png;base64,mock";
    }

    this.assertConfigured();
    const nodeId = await this.resolveNodeId(idOrName);
    const exportData = await this.requestJson<{ images?: Record<string, string> }>(
      `/v1/images/${this.fileKey}?ids=${encodeURIComponent(nodeId)}&format=${format}`
    );
    const assetUrl = exportData.images?.[nodeId];
    if (!assetUrl) throw new Error(`Figma export did not include asset for ${idOrName}`);
    if (format === "png") return assetUrl;

    const svg = await this.requestText(assetUrl);
    return optimizeSvgForReact(svg);
  }

  invalidateCache(prefix?: string): number {
    if (prefix) {
      return this.db.prepare("DELETE FROM cache WHERE key LIKE ?").run(`${prefix}%`).changes;
    }
    return this.db.prepare("DELETE FROM cache").run().changes;
  }

  handleWebhook(payload: unknown): { invalidated: number; payload: unknown } {
    return { invalidated: this.invalidateCache(), payload };
  }

  close(): void {
    this.db.close();
  }

  private async resolveNodeId(idOrName: string): Promise<string> {
    if (idOrName.includes(":") || idOrName.includes("-")) return idOrName;
    return (await this.getComponentSet(idOrName)).id;
  }

  private assertConfigured(): void {
    if (!this.accessToken || !this.fileKey) {
      throw new Error("FIGMA_ACCESS_TOKEN and FIGMA_FILE_KEY are required when mock data is disabled.");
    }
  }

  private async requestJson<T>(pathOrUrl: string): Promise<T> {
    const key = `json:${pathOrUrl}`;
    const cached = this.getCached<T>(key);
    if (cached) return cached;

    await this.waitForRateLimit();
    const response = await fetch(pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`, {
      headers: this.authHeaders()
    });
    if (!response.ok) {
      throw new Error(`Figma API request failed (${response.status}): ${await response.text()}`);
    }
    const data = (await response.json()) as T;
    this.setCached(key, data);
    return data;
  }

  private async requestText(url: string): Promise<string> {
    const key = `text:${url}`;
    const cached = this.getCached<string>(key);
    if (cached) return cached;

    await this.waitForRateLimit();
    const response = await fetch(url, { headers: this.authHeaders(false) });
    if (!response.ok) throw new Error(`Asset fetch failed (${response.status}): ${await response.text()}`);
    const text = await response.text();
    this.setCached(key, text);
    return text;
  }

  private authHeaders(includeFigmaToken = true): Record<string, string> {
    if (!includeFigmaToken || !this.accessToken) return {};
    return { "X-Figma-Token": this.accessToken };
  }

  private getCached<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value, expires_at FROM cache WHERE key = ?").get(key) as CacheRow | undefined;
    if (!row) return undefined;
    if (row.expires_at <= Date.now()) {
      this.db.prepare("DELETE FROM cache WHERE key = ?").run(key);
      return undefined;
    }
    return JSON.parse(row.value) as T;
  }

  private setCached(key: string, value: unknown): void {
    this.db
      .prepare("INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(value), Date.now() + this.cacheTtlMs);
  }

  private async waitForRateLimit(): Promise<void> {
    const spacingMs = Math.ceil(60_000 / Math.max(1, this.rateLimitPerMinute));
    const elapsed = Date.now() - this.lastRequestAt;
    if (this.lastRequestAt > 0 && elapsed < spacingMs) {
      await new Promise((resolve) => setTimeout(resolve, spacingMs - elapsed));
    }
    this.lastRequestAt = Date.now();
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function flattenNodes(root: FigmaNode | undefined): FigmaNode[] {
  if (!root) return [];
  return [root, ...(root.children ?? []).flatMap((child) => flattenNodes(child))];
}

function normalizeVariable(raw: unknown): FigmaVariable {
  const record = raw as Record<string, unknown>;
  return {
    id: String(record.id ?? record.key ?? record.name ?? "variable"),
    name: String(record.name ?? "variable"),
    resolvedType: normalizeResolvedType(record.resolvedType),
    valuesByMode: normalizeValuesByMode(record.valuesByMode)
  };
}

function normalizeResolvedType(value: unknown): FigmaVariable["resolvedType"] {
  if (value === "COLOR" || value === "FLOAT" || value === "STRING" || value === "BOOLEAN") return value;
  return "STRING";
}

function normalizeValuesByMode(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) return Object.fromEntries(entries.map(([key, raw]) => [key || "default", raw]));
  }
  return { default: "" };
}
