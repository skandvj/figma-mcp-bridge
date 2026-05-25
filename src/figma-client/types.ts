export type FigmaColor = {
  r: number;
  g: number;
  b: number;
  a?: number;
};

export type FigmaEffect = {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
  visible?: boolean;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  radius?: number;
};

export type FigmaNode = {
  id: string;
  name: string;
  type: string;
  description?: string;
  children?: FigmaNode[];
  componentId?: string;
  componentSetId?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  constraints?: { horizontal?: string; vertical?: string };
  fills?: Array<{ type: string; color?: FigmaColor; visible?: boolean }>;
  strokes?: Array<{ type: string; color?: FigmaColor; visible?: boolean }>;
  effects?: FigmaEffect[];
  style?: FigmaTypographyStyle;
  variantProperties?: Record<string, string>;
};

export type FigmaTypographyStyle = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
};

export type FigmaVariable = {
  id: string;
  name: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  valuesByMode: Record<string, unknown>;
};

export type DesignToken = {
  value: string | number | boolean;
  type?: string;
  description?: string;
};

export type StyleDictionaryTokens = Record<string, unknown>;

export type ComponentSpec = {
  name: string;
  nodeId: string;
  description: string;
  variants: Array<Record<string, string>>;
  props: Record<string, string[]>;
  sizing: Record<string, string | number>;
  spacing: Record<string, string | number>;
  states: string[];
  usageNotes: string[];
  previewUrl?: string;
  typescriptInterface: string;
};

export type LayoutSpec = {
  pageName: string;
  grid: {
    display: "grid" | "flex";
    columns?: number;
    gap: string;
  };
  sections: Array<{
    name: string;
    css: Record<string, string>;
  }>;
  componentPlacements: Array<{
    component: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  breakpoints: string[];
};

export type ValidationIssue = {
  severity: "error" | "warning" | "info";
  path: string;
  message: string;
  expected?: string;
  actual?: string;
};

export type FigmaClientOptions = {
  accessToken?: string;
  fileKey?: string;
  files?: FigmaProductFile[];
  product?: string;
  mode?: FigmaMode;
  configPath?: string;
  baseUrl?: string;
  cachePath?: string;
  cacheTtlMs?: number;
  rateLimitPerMinute?: number;
  useMockData?: boolean;
};

export type FigmaMode = "demo" | "production";

export type FigmaProductFile = {
  name: string;
  fileKey: string;
  description?: string;
};

export type FigmaFilesConfig = {
  defaultProduct?: string;
  files?: FigmaProductFile[];
  products?: Record<string, { fileKey?: string; description?: string }>;
};
