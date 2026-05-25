import Database from "better-sqlite3";
import {
  MOCK_COMPONENTS,
  MOCK_FILE,
  MOCK_PAGES,
  MOCK_SVG,
  MOCK_VARIABLES
} from "./mock-data.js";
import { loadFigmaConfig } from "./config.js";
import { optimizeSvgForReact } from "./transformers.js";
import type { FigmaClientOptions, FigmaMode, FigmaNode, FigmaProductFile, FigmaVariable } from "./types.js";

type CacheRow = {
  value: string;
  expires_at: number;
};

type FigmaFile = {
  name?: string;
  document?: FigmaNode;
  components?: Record<string, FigmaComponentMetadata>;
  componentSets?: Record<string, FigmaComponentMetadata>;
};

type FigmaComponentMetadata = {
  key?: string;
  name?: string;
  description?: string;
  componentSetId?: string;
  documentationLinks?: Array<{ uri?: string }>;
};

type FigmaVariableCollection = {
  id?: string;
  name?: string;
  modes?: Array<{ modeId?: string; name?: string }>;
};

export class FigmaClient {
  private readonly accessToken: string | undefined;
  private readonly files: Map<string, FigmaProductFile>;
  private readonly defaultProduct: string;
  private readonly mode: FigmaMode;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly rateLimitPerMinute: number;
  private readonly useMockData: boolean;
  private readonly db: Database.Database;
  private lastRequestAt = 0;

  constructor(options: FigmaClientOptions = {}) {
    this.accessToken = options.accessToken ?? process.env.FIGMA_ACCESS_TOKEN;
    const figmaConfig = loadFigmaConfig({
      accessToken: this.accessToken,
      configPath: options.configPath,
      fileKey: options.fileKey,
      files: options.files,
      mode: options.mode,
      product: options.product,
      useMockData: options.useMockData
    });
    this.files = new Map(figmaConfig.files.map((file) => [file.name, file]));
    this.defaultProduct = figmaConfig.defaultProduct;
    this.mode = figmaConfig.mode;
    this.baseUrl = (options.baseUrl ?? process.env.FIGMA_BASE_URL ?? "https://api.figma.com").replace(/\/$/, "");
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60_000;
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? 30;
    this.useMockData = this.mode === "demo";

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

  get runtimeMode(): FigmaMode {
    return this.mode;
  }

  get defaultProductName(): string {
    return this.defaultProduct;
  }

  listProductNames(): string[] {
    return this.files.size > 0 ? [...this.files.keys()].sort() : ["mock"];
  }

  async getFile(product?: string): Promise<FigmaFile> {
    if (this.useMockData) return MOCK_FILE;
    const fileKey = this.fileKeyForProduct(product);
    this.assertConfigured(fileKey);
    return this.requestJson<FigmaFile>(`/v1/files/${fileKey}`);
  }

  async getVariables(product?: string): Promise<FigmaVariable[]> {
    if (this.useMockData) return MOCK_VARIABLES;
    const fileKey = this.fileKeyForProduct(product);
    this.assertConfigured(fileKey);
    const data = await this.requestJson<{
      meta?: {
        variables?: Record<string, unknown>;
        variableCollections?: Record<string, FigmaVariableCollection>;
      };
    }>(
      `/v1/files/${fileKey}/variables/local`
    );
    return Object.values(data.meta?.variables ?? {}).map((raw) =>
      normalizeVariable(raw, data.meta?.variableCollections ?? {})
    );
  }

  async getComponentSet(name: string, product?: string): Promise<FigmaNode> {
    const normalized = normalizeName(name);
    if (this.useMockData) {
      const match = MOCK_COMPONENTS.find((node) => normalizeName(node.name) === normalized);
      if (!match) throw new Error(`Component not found: ${name}`);
      return match;
    }

    const file = await this.getFile(product);
    const documentMatch = flattenNodes(file.document)
      .filter((node) => node.type === "COMPONENT_SET" || node.type === "COMPONENT")
      .find((node) => normalizeName(node.name) === normalized);
    if (documentMatch) return withComponentMetadata(documentMatch, file);

    const metadata = findComponentMetadata(file, normalized);
    if (metadata) {
      try {
        return withComponentMetadata(await this.getNodeById(metadata.id, product), file);
      } catch {
        // Figma metadata can outlive deleted nodes; fall through to the clear not-found error.
      }
    }
    throw new Error(`Component not found: ${name}`);
  }

  async getNodeById(id: string, product?: string): Promise<FigmaNode> {
    if (this.useMockData) {
      const match = [...MOCK_COMPONENTS.flatMap((node) => flattenNodes(node)), ...MOCK_PAGES.flatMap((node) => flattenNodes(node))]
        .find((node) => node.id === id);
      if (!match) throw new Error(`Node not found: ${id}`);
      return match;
    }

    const fileKey = this.fileKeyForProduct(product);
    this.assertConfigured(fileKey);
    const data = await this.requestJson<{ nodes?: Record<string, { document?: FigmaNode }> }>(
      `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(id)}`
    );
    const node = data.nodes?.[id]?.document;
    if (!node) throw new Error(`Node not found: ${id}`);
    return node;
  }

  async getPageLayout(pageName: string, product?: string): Promise<FigmaNode> {
    const normalized = normalizeName(pageName);
    const file = await this.getFile(product);
    const page = flattenNodes(file.document).find(
      (node) => node.type === "CANVAS" && normalizeName(node.name) === normalized
    );
    if (!page) throw new Error(`Page not found: ${pageName}`);
    return page;
  }

  async listComponentNames(product?: string): Promise<string[]> {
    if (this.useMockData) return MOCK_COMPONENTS.map((node) => node.name);
    const file = await this.getFile(product);
    const documentNames = flattenNodes(file.document)
      .filter((node) => node.type === "COMPONENT_SET" || node.type === "COMPONENT")
      .map((node) => node.name);
    const metadataNames = [
      ...Object.values(file.componentSets ?? {}),
      ...Object.values(file.components ?? {})
    ].flatMap((metadata) => metadata.name ? [metadata.name] : []);
    return [...new Set([...documentNames, ...metadataNames])].sort();
  }

  async listPageNames(product?: string): Promise<string[]> {
    const file = await this.getFile(product);
    return flattenNodes(file.document)
      .filter((node) => node.type === "CANVAS")
      .map((node) => node.name)
      .sort();
  }

  async exportNode(idOrName: string, format: "svg" | "png" = "svg", product?: string): Promise<string> {
    if (this.useMockData) {
      const component = MOCK_COMPONENTS.find(
        (node) => node.id === idOrName || normalizeName(node.name) === normalizeName(idOrName)
      );
      const svg = MOCK_SVG[component?.name ?? idOrName] ?? MOCK_SVG.Button;
      return format === "svg" ? optimizeSvgForReact(svg ?? "") : "data:image/png;base64,mock";
    }

    const fileKey = this.fileKeyForProduct(product);
    this.assertConfigured(fileKey);
    const nodeId = await this.resolveNodeId(idOrName, product);
    const cacheKey = `asset:${fileKey}:${nodeId}:${format}`;
    const cached = this.getCached<string>(cacheKey);
    if (cached) return cached;
    const exportData = await this.requestJson<{ images?: Record<string, string> }>(
      `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=${format}`
    );
    const assetUrl = exportData.images?.[nodeId];
    if (!assetUrl) throw new Error(`Figma export did not include asset for ${idOrName}`);
    if (format === "png") {
      this.setCached(cacheKey, assetUrl);
      return assetUrl;
    }

    const svg = await this.requestText(assetUrl);
    const optimized = optimizeSvgForReact(svg);
    this.setCached(cacheKey, optimized);
    return optimized;
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

  private async resolveNodeId(idOrName: string, product?: string): Promise<string> {
    if (idOrName.includes(":") || idOrName.includes("-")) return idOrName;
    return (await this.getComponentSet(idOrName, product)).id;
  }

  private fileKeyForProduct(product?: string): string | undefined {
    const requested = product ?? this.defaultProduct;
    if (product && !this.files.has(product)) {
      throw new Error(`Figma product not configured: ${product}`);
    }
    return this.files.get(requested)?.fileKey ?? this.files.get(this.defaultProduct)?.fileKey;
  }

  private assertConfigured(fileKey: string | undefined): void {
    if (!this.accessToken || !fileKey) {
      throw new Error("FIGMA_ACCESS_TOKEN and a configured Figma file are required when FIGMA_MODE=production.");
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

function normalizeVariable(
  raw: unknown,
  collections: Record<string, FigmaVariableCollection> = {}
): FigmaVariable {
  const record = raw as Record<string, unknown>;
  const collectionId = String(record.variableCollectionId ?? "");
  const collection = collections[collectionId];
  const variable: FigmaVariable = {
    id: String(record.id ?? record.key ?? record.name ?? "variable"),
    name: String(record.name ?? "variable"),
    resolvedType: normalizeResolvedType(record.resolvedType),
    valuesByMode: normalizeValuesByMode(record.valuesByMode, collection)
  };
  if (typeof record.description === "string" && record.description) variable.description = record.description;
  if (collection?.name) variable.collectionName = collection.name;
  return variable;
}

function normalizeValuesByMode(
  value: unknown,
  collection?: FigmaVariableCollection
): Record<string, unknown> {
  const modeNames = Object.fromEntries(
    (collection?.modes ?? []).flatMap((mode) => {
      if (!mode.modeId) return [];
      return [[mode.modeId, mode.name ?? mode.modeId]];
    })
  );
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) {
      return Object.fromEntries(entries.map(([key, raw]) => [(modeNames[key] ?? key) || "default", raw]));
    }
  }
  return { default: "" };
}

function findComponentMetadata(
  file: FigmaFile,
  normalizedName: string
): (FigmaComponentMetadata & { id: string }) | undefined {
  const entries = [
    ...Object.entries(file.componentSets ?? {}),
    ...Object.entries(file.components ?? {})
  ];
  const match = entries.find(([, metadata]) => normalizeName(metadata.name ?? "") === normalizedName);
  if (!match) return undefined;
  return { id: match[0], ...match[1] };
}

function withComponentMetadata(node: FigmaNode, file: FigmaFile): FigmaNode {
  const metadata = file.componentSets?.[node.id] ?? file.components?.[node.id];
  if (!metadata?.description || node.description) return node;
  return {
    ...node,
    description: metadata.description
  };
}

function normalizeResolvedType(value: unknown): FigmaVariable["resolvedType"] {
  if (value === "COLOR" || value === "FLOAT" || value === "STRING" || value === "BOOLEAN") return value;
  return "STRING";
}
