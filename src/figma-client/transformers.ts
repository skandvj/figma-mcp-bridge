import type {
  ComponentSpec,
  DesignToken,
  FigmaColor,
  FigmaEffect,
  FigmaNode,
  FigmaTypographyStyle,
  FigmaVariable,
  LayoutSpec,
  StyleDictionaryTokens
} from "./types.js";

const TOKEN_UNIT_GROUPS = new Set(["spacing", "radius", "borderWidth"]);

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

export function figmaColorToCSS(color: FigmaColor): string {
  const r = clampChannel(color.r);
  const g = clampChannel(color.g);
  const b = clampChannel(color.b);
  const a = color.a ?? 1;
  if (a < 1) {
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
  }
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function figmaSpacingToCSS(node: Pick<FigmaNode, "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft" | "itemSpacing">): Record<string, string> {
  const css: Record<string, string> = {};
  if (node.paddingTop !== undefined) css.paddingTop = `${node.paddingTop}px`;
  if (node.paddingRight !== undefined) css.paddingRight = `${node.paddingRight}px`;
  if (node.paddingBottom !== undefined) css.paddingBottom = `${node.paddingBottom}px`;
  if (node.paddingLeft !== undefined) css.paddingLeft = `${node.paddingLeft}px`;
  if (node.itemSpacing !== undefined) css.gap = `${node.itemSpacing}px`;
  return css;
}

export function figmaTypographyToCSS(style: FigmaTypographyStyle = {}): Record<string, string> {
  const css: Record<string, string> = {};
  if (style.fontFamily) css.fontFamily = style.fontFamily;
  if (style.fontSize !== undefined) css.fontSize = `${style.fontSize}px`;
  if (style.fontWeight !== undefined) css.fontWeight = String(style.fontWeight);
  if (style.lineHeightPx !== undefined) css.lineHeight = `${style.lineHeightPx}px`;
  if (style.letterSpacing !== undefined) css.letterSpacing = `${style.letterSpacing}px`;
  return css;
}

export function figmaEffectsToCSS(effects: FigmaEffect[] = []): Record<string, string> {
  const shadows = effects
    .filter((effect) => effect.visible !== false && ["DROP_SHADOW", "INNER_SHADOW"].includes(effect.type))
    .map((effect) => {
      const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
      const x = effect.offset?.x ?? 0;
      const y = effect.offset?.y ?? 0;
      const blur = effect.radius ?? 0;
      const color = figmaColorToCSS(effect.color ?? { r: 0, g: 0, b: 0, a: 0.2 });
      return `${inset}${x}px ${y}px ${blur}px ${color}`;
    });
  return shadows.length ? { boxShadow: shadows.join(", ") } : {};
}

export function figmaConstraintsToCSS(constraints: FigmaNode["constraints"] = {}): Record<string, string> {
  const css: Record<string, string> = {};
  if (constraints.horizontal === "STRETCH") css.width = "100%";
  if (constraints.vertical === "STRETCH") css.height = "100%";
  if (constraints.horizontal === "CENTER") css.marginInline = "auto";
  if (constraints.vertical === "CENTER") css.marginBlock = "auto";
  return css;
}

export function figmaLayoutToTailwind(node: FigmaNode): string[] {
  const classes: string[] = [];
  if (node.layoutMode === "HORIZONTAL") classes.push("flex", "flex-row");
  if (node.layoutMode === "VERTICAL") classes.push("flex", "flex-col");
  if (node.itemSpacing !== undefined) classes.push(`gap-[${node.itemSpacing}px]`);
  if (node.paddingTop !== undefined || node.paddingRight !== undefined) {
    classes.push(
      `pt-[${node.paddingTop ?? 0}px]`,
      `pr-[${node.paddingRight ?? 0}px]`,
      `pb-[${node.paddingBottom ?? 0}px]`,
      `pl-[${node.paddingLeft ?? 0}px]`
    );
  }
  return classes;
}

export function variablesToStyleDictionary(variables: FigmaVariable[]): StyleDictionaryTokens {
  const root: StyleDictionaryTokens = {};
  for (const variable of variables) {
    const [group = "misc", ...rest] = variable.name.split("/");
    const tokenName = rest.join("/") || variable.name;
    const rawValue = variable.valuesByMode.default ?? Object.values(variable.valuesByMode)[0];
    const value = transformVariableValue(group, rawValue, variable.resolvedType);
    insertToken(root, [toKebabCase(group), ...tokenName.split("/").map(toKebabCase)], {
      value,
      type: variable.resolvedType.toLowerCase()
    });
  }
  return root;
}

function transformVariableValue(group: string, value: unknown, type: FigmaVariable["resolvedType"]): string | number | boolean {
  if (type === "COLOR" && value && typeof value === "object") return figmaColorToCSS(value as FigmaColor);
  if (type === "FLOAT" && typeof value === "number") return TOKEN_UNIT_GROUPS.has(group) ? `${value}px` : value;
  if (type === "BOOLEAN" && typeof value === "boolean") return value;
  return String(value ?? "");
}

function insertToken(root: StyleDictionaryTokens, path: string[], token: DesignToken): void {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== "object") current[segment] = {};
    current = current[segment] as StyleDictionaryTokens;
  }
  current[path[path.length - 1] ?? "value"] = token;
}

export function componentSetToSpec(node: FigmaNode): ComponentSpec {
  const variants = (node.children ?? [])
    .map((child) => child.variantProperties ?? parseVariantProperties(child.name))
    .filter((variant) => Object.keys(variant).length > 0);
  const props = collectProps(variants);
  const first = node.children?.[0] ?? node;
  const usageNotes = node.description
    ? node.description.split(/[.;]\s*/).map((line) => line.trim()).filter(Boolean)
    : [];
  return {
    name: node.name,
    nodeId: node.id,
    description: node.description ?? "",
    variants,
    props,
    sizing: {
      width: first.absoluteBoundingBox?.width ?? "auto",
      height: first.absoluteBoundingBox?.height ?? "auto",
      layoutMode: first.layoutMode ?? "NONE"
    },
    spacing: figmaSpacingToCSS(first),
    states: props.state ?? [],
    usageNotes,
    previewUrl: `https://www.figma.com/file/mock?node-id=${encodeURIComponent(node.id)}`,
    typescriptInterface: generatePropsInterface(node.name, props)
  };
}

function parseVariantProperties(name: string): Record<string, string> {
  const [, raw = ""] = name.split("/");
  return Object.fromEntries(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key = "variant", value = part] = part.split("=").map((item) => item.trim());
        return [toKebabCase(key), value];
      })
  );
}

function collectProps(variants: Array<Record<string, string>>): Record<string, string[]> {
  const props: Record<string, Set<string>> = {};
  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant)) {
      props[key] ??= new Set<string>();
      props[key].add(value);
    }
  }
  return Object.fromEntries(Object.entries(props).map(([key, values]) => [key, [...values].sort()]));
}

function generatePropsInterface(componentName: string, props: Record<string, string[]>): string {
  const name = `${componentName.replace(/[^a-zA-Z0-9]/g, "")}Props`;
  const lines = [`export interface ${name} {`];
  for (const [prop, values] of Object.entries(props)) {
    const union = values.map((value) => `"${value}"`).join(" | ") || "string";
    lines.push(`  ${prop}?: ${union};`);
  }
  lines.push("  children?: React.ReactNode;");
  lines.push("}");
  return lines.join("\n");
}

export function pageToLayoutSpec(page: FigmaNode): LayoutSpec {
  const children = page.children ?? [];
  const componentPlacements = children
    .flatMap((child) => child.children ?? [])
    .filter((child) => child.type === "INSTANCE" && child.absoluteBoundingBox)
    .map((child) => ({
      component: child.name,
      x: child.absoluteBoundingBox?.x ?? 0,
      y: child.absoluteBoundingBox?.y ?? 0,
      width: child.absoluteBoundingBox?.width ?? 0,
      height: child.absoluteBoundingBox?.height ?? 0
    }));
  const grid: LayoutSpec["grid"] = {
    display: page.layoutMode === "VERTICAL" ? "flex" : "grid",
    gap: `${page.itemSpacing ?? 0}px`
  };
  if (page.layoutMode === "HORIZONTAL") grid.columns = children.length;

  return {
    pageName: page.name,
    grid,
    sections: children.map((child) => ({
      name: child.name,
      css: {
        ...figmaSpacingToCSS(child),
        ...figmaConstraintsToCSS(child.constraints),
        display: child.layoutMode === "NONE" || !child.layoutMode ? "block" : "flex",
        flexDirection: child.layoutMode === "VERTICAL" ? "column" : "row"
      }
    })),
    componentPlacements,
    breakpoints: ["640px", "768px", "1024px", "1280px"]
  };
}

export function optimizeSvgForReact(svg: string): string {
  return svg
    .replace(/class=/g, "className=")
    .replace(/clip-path=/g, "clipPath=")
    .replace(/fill-rule=/g, "fillRule=")
    .replace(/stroke-width=/g, "strokeWidth=")
    .replace(/text-anchor=/g, "textAnchor=")
    .replace(/font-family=/g, "fontFamily=")
    .replace(/font-size=/g, "fontSize=")
    .replace(/font-weight=/g, "fontWeight=");
}
