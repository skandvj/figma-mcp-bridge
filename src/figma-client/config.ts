import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FigmaFilesConfig, FigmaMode, FigmaProductFile } from "./types.js";

export type LoadedFigmaConfig = {
  mode: FigmaMode;
  defaultProduct: string;
  files: FigmaProductFile[];
};

type LoadConfigOptions = {
  env?: NodeJS.ProcessEnv;
  mode?: FigmaMode | undefined;
  useMockData?: boolean | undefined;
  fileKey?: string | undefined;
  files?: FigmaProductFile[] | undefined;
  product?: string | undefined;
  configPath?: string | undefined;
  accessToken?: string | undefined;
};

export function loadFigmaConfig(options: LoadConfigOptions = {}): LoadedFigmaConfig {
  const env = options.env ?? process.env;
  const fileConfig = readFilesConfig(options.configPath ?? env.FIGMA_FILES_CONFIG);
  const files = dedupeFiles([
    ...normalizeConfigFiles(fileConfig),
    ...(options.files ?? []),
    ...fileFromEnvOrOption(options.fileKey ?? env.FIGMA_FILE_KEY, options.product ?? env.FIGMA_PRODUCT)
  ]);
  const mode = resolveMode(options, env, files);
  const defaultProduct = options.product
    ?? env.FIGMA_PRODUCT
    ?? fileConfig.defaultProduct
    ?? files[0]?.name
    ?? "mock";

  if (mode === "production") {
    const missing: string[] = [];
    if (!(options.accessToken ?? env.FIGMA_ACCESS_TOKEN)) missing.push("FIGMA_ACCESS_TOKEN");
    if (files.length === 0) missing.push("figma.files.json or FIGMA_FILE_KEY");
    if (options.useMockData === true) missing.push("FIGMA_MOCK_DATA=false");
    if (missing.length > 0) {
      throw new Error(
        `FIGMA_MODE=production requires live configuration for: ${missing.join(", ")}. ` +
          "Use FIGMA_MODE=demo for offline mock data."
      );
    }
  }

  return { mode, defaultProduct, files };
}

export function readFilesConfig(configPath: string | undefined): FigmaFilesConfig {
  const path = resolve(configPath ?? "figma.files.json");
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf-8")) as FigmaFilesConfig;
  return raw && typeof raw === "object" ? raw : {};
}

function resolveMode(
  options: LoadConfigOptions,
  env: NodeJS.ProcessEnv,
  files: FigmaProductFile[]
): FigmaMode {
  const explicit = options.mode ?? normalizeMode(env.FIGMA_MODE);
  if (explicit) return explicit;
  if (options.useMockData === true) return "demo";
  if (options.useMockData === false) return "production";
  if ((options.accessToken ?? env.FIGMA_ACCESS_TOKEN) && files.length > 0) return "production";
  return "demo";
}

function normalizeMode(value: string | undefined): FigmaMode | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "demo" || normalized === "production") return normalized;
  throw new Error("FIGMA_MODE must be either 'demo' or 'production'.");
}

function normalizeConfigFiles(config: FigmaFilesConfig): FigmaProductFile[] {
  const arrayFiles = config.files ?? [];
  const productFiles = Object.entries(config.products ?? {}).flatMap(([name, value]) => {
    if (!value.fileKey) return [];
    const file: FigmaProductFile = { name, fileKey: value.fileKey };
    if (value.description) file.description = value.description;
    return [file];
  });
  return [...arrayFiles, ...productFiles].filter((file) => Boolean(file.name && file.fileKey));
}

function fileFromEnvOrOption(fileKey: string | undefined, product: string | undefined): FigmaProductFile[] {
  if (!fileKey) return [];
  return [{ name: product || "default", fileKey }];
}

function dedupeFiles(files: FigmaProductFile[]): FigmaProductFile[] {
  const byName = new Map<string, FigmaProductFile>();
  for (const file of files) {
    byName.set(file.name, file);
  }
  return [...byName.values()];
}
