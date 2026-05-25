import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const FRAMEWORKS = ["react", "vue", "svelte"] as const;

export type Framework = (typeof FRAMEWORKS)[number];

export type CodegenConfig = {
  teamPackage?: string;
  allowedFrameworks: Framework[];
  componentStrategy: "scaffold" | "wrap-existing";
  tokenNaming: "css-var" | "prefixed-css-var";
  tokenPrefix?: string;
};

type RawCodegenConfig = Partial<CodegenConfig> & {
  allowedFrameworks?: string[];
};

export function loadCodegenConfig(configPath = process.env.CODEGEN_CONFIG_PATH ?? "codegen.config.json"): CodegenConfig {
  const raw = readCodegenConfig(configPath);
  const envFrameworks = process.env.CODEGEN_ALLOWED_FRAMEWORKS?.split(",").map((item) => item.trim());
  const allowedFrameworks = normalizeFrameworks(envFrameworks ?? raw.allowedFrameworks ?? [...FRAMEWORKS]);
  const config: CodegenConfig = {
    allowedFrameworks,
    componentStrategy: normalizeStrategy(process.env.CODEGEN_COMPONENT_STRATEGY ?? raw.componentStrategy),
    tokenNaming: normalizeTokenNaming(process.env.CODEGEN_TOKEN_NAMING ?? raw.tokenNaming)
  };
  const teamPackage = process.env.CODEGEN_TEAM_PACKAGE ?? raw.teamPackage;
  const tokenPrefix = process.env.CODEGEN_TOKEN_PREFIX ?? raw.tokenPrefix;
  if (teamPackage) config.teamPackage = teamPackage;
  if (tokenPrefix) config.tokenPrefix = tokenPrefix;
  return config;
}

export function assertFrameworkAllowed(framework: Framework, config: CodegenConfig): void {
  if (!config.allowedFrameworks.includes(framework)) {
    throw new Error(`Framework '${framework}' is not enabled by codegen configuration.`);
  }
}

function readCodegenConfig(configPath: string): RawCodegenConfig {
  const path = resolve(configPath);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8")) as RawCodegenConfig;
}

function normalizeFrameworks(values: string[]): Framework[] {
  const frameworks = values.filter((value): value is Framework =>
    FRAMEWORKS.includes(value as Framework)
  );
  return frameworks.length > 0 ? [...new Set(frameworks)] : [...FRAMEWORKS];
}

function normalizeStrategy(value: unknown): CodegenConfig["componentStrategy"] {
  return value === "wrap-existing" ? "wrap-existing" : "scaffold";
}

function normalizeTokenNaming(value: unknown): CodegenConfig["tokenNaming"] {
  return value === "prefixed-css-var" ? "prefixed-css-var" : "css-var";
}
