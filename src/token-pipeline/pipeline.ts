import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { FigmaClient } from "../figma-client/client.js";
import { variablesToStyleDictionary } from "../figma-client/transformers.js";
import type { FigmaVariable, StyleDictionaryTokens } from "../figma-client/types.js";
import { generateTailwindConfig } from "./tailwind-generator.js";

export type TokenPipelineOptions = {
  client?: FigmaClient;
  outputDir?: string;
  watchPaths?: string[];
};

export type GeneratedOutputs = {
  css: string;
  tailwind: string;
  typescript: string;
  scss: string;
  json: string;
};

export class TokenPipeline {
  private readonly client: FigmaClient;
  private readonly outputDir: string;
  private readonly watchPaths: string[];

  constructor(options: TokenPipelineOptions = {}) {
    this.client = options.client ?? new FigmaClient();
    this.outputDir = options.outputDir ?? "generated/tokens";
    this.watchPaths = options.watchPaths ?? [];
  }

  async extractFromFigma(): Promise<FigmaVariable[]> {
    return this.client.getVariables();
  }

  async transformToStyleDictionary(variables?: FigmaVariable[]): Promise<StyleDictionaryTokens> {
    return variablesToStyleDictionary(variables ?? (await this.extractFromFigma()));
  }

  async generateOutputs(tokens?: StyleDictionaryTokens): Promise<GeneratedOutputs> {
    const resolved = tokens ?? (await this.transformToStyleDictionary());
    const outputs = renderOutputs(resolved);
    await mkdir(this.outputDir, { recursive: true });
    await Promise.all([
      writeFile(path.join(this.outputDir, "tokens.css"), outputs.css),
      writeFile(path.join(this.outputDir, "tailwind.tokens.js"), outputs.tailwind),
      writeFile(path.join(this.outputDir, "tokens.ts"), outputs.typescript),
      writeFile(path.join(this.outputDir, "tokens.scss"), outputs.scss),
      writeFile(path.join(this.outputDir, "tokens.json"), outputs.json)
    ]);
    return outputs;
  }

  watch(): FSWatcher {
    const watcher = chokidar.watch(this.watchPaths, { ignoreInitial: true });
    watcher.on("all", () => {
      this.client.invalidateCache();
      void this.generateOutputs();
    });
    return watcher;
  }
}

export function renderOutputs(tokens: StyleDictionaryTokens): GeneratedOutputs {
  const flat = flattenTokens(tokens);
  const cssVariables = Object.fromEntries(flat.map((token) => [`--${token.path.replace(/\./g, "-")}`, token.value]));
  return {
    css: `:root {\n${Object.entries(cssVariables).map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}\n`,
    tailwind: generateTailwindConfig(tokens),
    typescript: `export const tokens = ${JSON.stringify(tokens, null, 2)} as const;\n\nexport const cssVariables = ${JSON.stringify(cssVariables, null, 2)} as const;\n`,
    scss: `${Object.entries(cssVariables).map(([name, value]) => `$${name.slice(2)}: ${value};`).join("\n")}\n`,
    json: `${JSON.stringify(tokens, null, 2)}\n`
  };
}

function flattenTokens(tokens: StyleDictionaryTokens, prefix = ""): Array<{ path: string; value: string }> {
  const result: Array<{ path: string; value: string }> = [];
  for (const [key, value] of Object.entries(tokens)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && "value" in value) {
      result.push({ path: nextPath, value: String((value as { value: unknown }).value) });
    } else if (value && typeof value === "object") {
      result.push(...flattenTokens(value as StyleDictionaryTokens, nextPath));
    }
  }
  return result;
}
