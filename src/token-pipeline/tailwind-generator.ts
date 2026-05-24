import type { StyleDictionaryTokens } from "../figma-client/types.js";

export function generateTailwindConfig(tokens: StyleDictionaryTokens): string {
  const theme = buildTailwindTheme(tokens);
  return `/** Generated from Figma design tokens. */
export default {
  theme: {
    extend: ${JSON.stringify(theme, null, 6)}
  }
};
`;
}

export function buildTailwindTheme(tokens: StyleDictionaryTokens): Record<string, unknown> {
  return {
    colors: buildSection(tokens.color as StyleDictionaryTokens | undefined, "color"),
    spacing: buildSection(tokens.spacing as StyleDictionaryTokens | undefined, "spacing"),
    borderRadius: buildSection(tokens.radius as StyleDictionaryTokens | undefined, "radius"),
    fontFamily: buildSection(tokens.font as StyleDictionaryTokens | undefined, "font")
  };
}

function buildSection(section: StyleDictionaryTokens | undefined, group: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!section) return result;
  for (const [key, value] of Object.entries(section)) {
    if (value && typeof value === "object" && "value" in value) {
      result[key] = `var(--${group}-${key})`;
    } else if (value && typeof value === "object") {
      for (const [nestedKey] of Object.entries(value as StyleDictionaryTokens)) {
        result[`${key}-${nestedKey}`] = `var(--${group}-${key}-${nestedKey})`;
      }
    }
  }
  return result;
}
