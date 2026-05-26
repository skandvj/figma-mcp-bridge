import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FigmaClient } from "../figma-client/client.js";
import { componentSetToSpec, variablesToStyleDictionary } from "../figma-client/transformers.js";
import type { ComponentSpec, StyleDictionaryTokens, ValidationIssue } from "../figma-client/types.js";
import { analyzeImplementation } from "../validators/code-analysis.js";
import {
  assertFrameworkAllowed,
  FRAMEWORKS,
  loadCodegenConfig,
  type CodegenConfig,
  type Framework
} from "./codegen-config.js";

export function registerTools(server: McpServer, client: FigmaClient): void {
  const codegenConfig = loadCodegenConfig();

  server.registerTool(
    "extract_component_code",
    {
      title: "Extract Component Code",
      description: "Generate framework component scaffold code from a Figma component spec.",
      inputSchema: {
        component_name: z.string().min(1),
        framework: z.enum(FRAMEWORKS).default("react"),
        product: z.string().optional()
      }
    },
    async ({ component_name, framework, product }) => {
      assertFrameworkAllowed(framework, codegenConfig);
      const spec = componentSetToSpec(await client.getComponentSet(component_name, product));
      const tokens = variablesToStyleDictionary(await client.getVariables(product));
      return textResult(generateComponentCode(spec, framework, tokens, codegenConfig));
    }
  );

  server.registerTool(
    "validate_implementation",
    {
      title: "Validate Implementation",
      description: "Compare implementation code against Figma tokens and component spacing.",
      inputSchema: {
        code: z.string().min(1),
        component_name: z.string().min(1),
        product: z.string().optional()
      }
    },
    async ({ code, component_name, product }) => {
      const spec = componentSetToSpec(await client.getComponentSet(component_name, product));
      const tokens = variablesToStyleDictionary(await client.getVariables(product));
      return textResult(validateImplementation(code, spec, tokens));
    }
  );

  server.registerTool(
    "search_design_system",
    {
      title: "Search Design System",
      description: "Search component names, descriptions, and metadata.",
      inputSchema: {
        query: z.string().min(1),
        product: z.string().optional()
      }
    },
    async ({ query, product }) => {
      const names = await client.listComponentNames(product);
      const specs = await Promise.all(
        names.map(async (name) => componentSetToSpec(await client.getComponentSet(name, product)))
      );
      return textResult({
        matches: searchSpecs(specs, query).slice(0, 5)
      });
    }
  );
}

export function generateComponentCode(
  spec: ComponentSpec,
  framework: Framework,
  tokens: StyleDictionaryTokens,
  config: CodegenConfig = loadCodegenConfig()
) {
  assertFrameworkAllowed(framework, config);
  const tokensUsed = inferTokensUsed(spec, tokens, config);
  const dependencies = [
    ...(framework === "react" ? ["react"] : []),
    ...(config.teamPackage ? [config.teamPackage] : [])
  ];
  const code = framework === "react"
    ? generateReactCode(spec, tokensUsed, config)
    : framework === "vue"
      ? generateVueCode(spec, tokensUsed, config)
      : generateSvelteCode(spec, tokensUsed, config);

  return {
    code,
    dependencies,
    tokens_used: tokensUsed
  };
}

export function validateImplementation(
  code: string,
  spec: ComponentSpec,
  tokens: StyleDictionaryTokens
): { score: number; issues: ValidationIssue[]; suggestions: string[] } {
  const issues: ValidationIssue[] = [];
  const flattenedTokens = flattenTokens(tokens);
  const values = flattenTokenValues(tokens);
  const analysis = analyzeImplementation(code);
  const codeValues = new Set(analysis.values);
  const spacingValues = [...new Set(Object.values(spec.spacing).map(String))];
  const colorValues = tokenValuesByType(flattenedTokens, "color");
  const spacingScale = new Set(tokenValuesByType(flattenedTokens, "spacing"));
  const radiusScale = new Set(tokenValuesByType(flattenedTokens, "borderRadius"));
  const typographyScale = new Set(tokenValuesByType(flattenedTokens, "typography"));
  const codeText = code.toLowerCase();

  for (const spacing of spacingValues) {
    if (!code.includes(spacing) && !code.includes(cssVarNameForValue(tokens, spacing))) {
      issues.push({
        severity: "warning",
        path: `${spec.name}.spacing`,
        message: `Expected spacing value ${spacing} from Figma spec was not found in implementation.`,
        expected: spacing
      });
    }
  }

  for (const actual of [...codeValues].filter((value) => /^#[0-9a-fA-F]{3,8}$/.test(value))) {
    issues.push({
      severity: "error",
      path: `${spec.name}.tokens.color`,
      message: `Raw color literal ${actual} should be replaced with a design token reference.`,
      actual
    });
  }

  for (const tokenValue of colorValues.slice(0, 12)) {
    const cssVariable = cssVarNameForValue(tokens, tokenValue);
    if (cssVariable && code.includes(cssVariable)) continue;
    if (code.includes(tokenValue)) continue;
    issues.push({
      severity: "info",
      path: `${spec.name}.tokens.color`,
      message: `Color token ${cssVariable || tokenValue} is available but not referenced.`,
      expected: cssVariable || tokenValue
    });
  }

  for (const pxValue of [...codeValues].filter((value) => /^\d+(?:\.\d+)?px$/.test(value))) {
    const isKnownScaleValue = spacingScale.has(pxValue) || radiusScale.has(pxValue) || typographyScale.has(pxValue);
    if (!isKnownScaleValue) {
      issues.push({
        severity: "warning",
        path: `${spec.name}.tokens.scale`,
        message: `Pixel value ${pxValue} is not part of the configured spacing, radius, or typography scale.`,
        actual: pxValue
      });
    }
  }

  if (typographyScale.size > 0 && /font(size|family|weight)|line-height/.test(codeText)) {
    const referencesTypographyToken = flattenedTokens
      .filter((token) => token.type === "typography")
      .some((token) => code.includes(cssVariableForPath(token.path, { allowedFrameworks: [...FRAMEWORKS], componentStrategy: "scaffold", tokenNaming: "css-var" })));
    if (!referencesTypographyToken) {
      issues.push({
        severity: "warning",
        path: `${spec.name}.tokens.typography`,
        message: "Typography styles should reference typography tokens instead of hard-coded font values."
      });
    }
  }

  if (/border(-radius)?|radius/.test(codeText) && radiusScale.size > 0) {
    const referencesRadiusToken = flattenedTokens
      .filter((token) => token.type === "borderRadius")
      .some((token) => code.includes(cssVariableForPath(token.path, { allowedFrameworks: [...FRAMEWORKS], componentStrategy: "scaffold", tokenNaming: "css-var" })));
    if (!referencesRadiusToken) {
      issues.push({
        severity: "warning",
        path: `${spec.name}.tokens.radius`,
        message: "Border radius should reference radius tokens."
      });
    }
  }

  for (const propName of Object.keys(spec.props)) {
    if (!code.includes(propName) && !analysis.attributes.includes(propName)) {
      issues.push({
        severity: "info",
        path: `${spec.name}.props.${propName}`,
        message: `Figma variant prop '${propName}' is not represented in the implementation.`
      });
    }
  }

  if (!analysis.attributes.some((attribute) => attribute.startsWith("aria-") || attribute === "role") && !/<button/i.test(code)) {
    issues.push({
      severity: "warning",
      path: `${spec.name}.accessibility`,
      message: "Implementation should expose native semantics or ARIA attributes."
    });
  }

  if (!/@media|container|grid|flex|clamp\(|min\(|max\(|sm:|md:|lg:|width:\s*100%|max-width/.test(codeText)) {
    issues.push({
      severity: "info",
      path: `${spec.name}.layout.responsive`,
      message: "Implementation does not expose responsive or layout hints from the Figma spec."
    });
  }

  const penalty = issues.reduce((total, issue) => total + (issue.severity === "error" ? 25 : issue.severity === "warning" ? 12 : 4), 0);
  return {
    score: Math.max(0, Math.min(100, 100 - penalty)),
    issues,
    suggestions: issues.map((issue) => `Address ${issue.path}: ${issue.message}`)
  };
}

function generateReactCode(spec: ComponentSpec, tokensUsed: string[], config: CodegenConfig): string {
  const componentName = pascalCase(spec.name);
  const interfaceSource = spec.typescriptInterface
    .replace("children?: React.ReactNode;", "children?: ReactNode;\n  style?: CSSProperties;");
  const cssVars = tokensUsed.map((token) => `    "${token}": "var(${token})"`).join(",\n");
  const teamImport = config.teamPackage
    ? `import { ${componentName} as Base${componentName} } from "${config.teamPackage}";\n`
    : "";
  const element = config.componentStrategy === "wrap-existing" && config.teamPackage
    ? `Base${componentName}`
    : "button";

  return `import type { CSSProperties, ReactNode } from "react";
${teamImport}

${interfaceSource}

export function ${componentName}({ children, ...props }: ${componentName}Props) {
  const style = {
${cssVars}
  } as CSSProperties;

  return (
    <${element} {...props} className="${kebabCase(spec.name)}" style={{ ...style, ...props.style }} aria-label={typeof children === "string" ? children : undefined} data-figma-component="${spec.nodeId}">
      {children}
    </${element}>
  );
}`;
}

function generateVueCode(spec: ComponentSpec, tokensUsed: string[], config: CodegenConfig): string {
  const componentName = pascalCase(spec.name);
  const teamImport = config.teamPackage
    ? `import { ${componentName} as Base${componentName} } from "${config.teamPackage}";\n`
    : "";
  const element = config.componentStrategy === "wrap-existing" && config.teamPackage ? `Base${componentName}` : "button";
  return `<script setup lang="ts">
${teamImport}const tokenStyle = {
${tokensUsed.map((token) => `  "${token}": "var(${token})"`).join(",\n")}
};

defineProps<{
  ${Object.entries(spec.props).map(([prop, values]) => `${prop}?: ${values.map((value) => `"${value}"`).join(" | ") || "string"}`).join(";\n  ")}
}>();
</script>

<template>
  <${element} class="${kebabCase(spec.name)}" :style="tokenStyle" data-figma-component="${spec.nodeId}">
    <slot />
  </${element}>
</template>

<style scoped>
.${kebabCase(spec.name)} {
${tokensUsed.map((token) => `  ${token}: var(${token});`).join("\n")}
}
</style>`;
}

function generateSvelteCode(spec: ComponentSpec, tokensUsed: string[], config: CodegenConfig): string {
  const componentName = pascalCase(spec.name);
  const teamImport = config.teamPackage
    ? `  import { ${componentName} as Base${componentName} } from "${config.teamPackage}";\n`
    : "";
  const wrapped = config.componentStrategy === "wrap-existing" && config.teamPackage;
  const openTag = wrapped
    ? `<svelte:component this={Base${componentName}} class="${kebabCase(spec.name)}" style={tokenStyle} data-figma-component="${spec.nodeId}">`
    : `<button class="${kebabCase(spec.name)}" style={tokenStyle} data-figma-component="${spec.nodeId}">`;
  const closeTag = wrapped ? "</svelte:component>" : "</button>";
  return `<script lang="ts">
${teamImport}  const tokenStyle = {
${tokensUsed.map((token) => `    "${token}": "var(${token})"`).join(",\n")}
  };

  ${Object.keys(spec.props).map((prop) => `export let ${prop}: string | undefined = undefined;`).join("\n  ")}
</script>

${openTag}
  <slot />
${closeTag}

<style>
  .${kebabCase(spec.name)} {
${tokensUsed.map((token) => `    ${token}: var(${token});`).join("\n")}
  }
</style>`;
}

function searchSpecs(specs: ComponentSpec[], query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return specs
    .map((spec) => {
      const haystack = [spec.name, spec.description, ...spec.usageNotes, ...Object.keys(spec.props)].join(" ").toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { score, spec, preview_url: spec.previewUrl };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.spec.name.localeCompare(b.spec.name));
}

function inferTokensUsed(spec: ComponentSpec, tokens: StyleDictionaryTokens, config: CodegenConfig): string[] {
  const flattened = flattenTokens(tokens);
  const spacing = new Set(Object.values(spec.spacing).map(String));
  const matched = flattened
    .filter((token) => spacing.has(String(token.value)) || token.path.startsWith("color."))
    .map((token) => cssVariableForPath(token.path, config));
  return [...new Set(matched)].slice(0, 8);
}

function flattenTokens(tokens: StyleDictionaryTokens, prefix = ""): Array<{ path: string; value: unknown; type?: string }> {
  const entries: Array<{ path: string; value: unknown; type?: string }> = [];
  for (const [key, value] of Object.entries(tokens)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && "value" in value) {
      const token = value as { value: unknown; type?: unknown; modes?: Record<string, unknown> };
      const type = typeof token.type === "string" ? token.type : undefined;
      entries.push(tokenEntry(path, token.value, type));
      for (const [mode, modeValue] of Object.entries(token.modes ?? {})) {
        entries.push(tokenEntry(`${path}.${mode}`, modeValue, type));
      }
    } else if (value && typeof value === "object") {
      entries.push(...flattenTokens(value as StyleDictionaryTokens, path));
    }
  }
  return entries;
}

function tokenEntry(path: string, value: unknown, type?: string): { path: string; value: unknown; type?: string } {
  const entry: { path: string; value: unknown; type?: string } = { path, value };
  if (type) entry.type = type;
  return entry;
}

function flattenTokenValues(tokens: StyleDictionaryTokens): string[] {
  return flattenTokens(tokens).flatMap((token) => primitiveTokenValues(token.value));
}

function cssVarNameForValue(tokens: StyleDictionaryTokens, value: string): string {
  const token = flattenTokens(tokens).find((candidate) => primitiveTokenValues(candidate.value).includes(value));
  return token ? `--${token.path.replace(/\./g, "-")}` : "";
}

function tokenValuesByType(
  tokens: Array<{ path: string; value: unknown; type?: string }>,
  type: string
): string[] {
  return tokens
    .filter((token) => token.type === type)
    .flatMap((token) => primitiveTokenValues(token.value))
    .map((value) => value.toUpperCase().startsWith("#") ? value.toUpperCase() : value);
}

function primitiveTokenValues(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => primitiveTokenValues(item));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) => primitiveTokenValues(item));
  }
  return [];
}

function cssVariableForPath(path: string, config: CodegenConfig): string {
  const base = path.replace(/\./g, "-");
  if (config.tokenNaming === "prefixed-css-var" && config.tokenPrefix) {
    return `--${config.tokenPrefix}-${base}`;
  }
  return `--${base}`;
}

function pascalCase(value: string): string {
  return value.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_match, _sep, char: string) => char.toUpperCase());
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
