import type { FigmaNode, FigmaVariable } from "./types.js";

export const MOCK_VARIABLES: FigmaVariable[] = [
  {
    id: "var-color-primary",
    name: "color/primary",
    resolvedType: "COLOR",
    valuesByMode: { default: { r: 0.145, g: 0.388, b: 0.921, a: 1 } }
  },
  {
    id: "var-color-primary-hover",
    name: "color/primary-hover",
    resolvedType: "COLOR",
    valuesByMode: { default: { r: 0.118, g: 0.306, b: 0.729, a: 1 } }
  },
  {
    id: "var-color-surface",
    name: "color/surface",
    resolvedType: "COLOR",
    valuesByMode: { default: { r: 1, g: 1, b: 1, a: 1 } }
  },
  {
    id: "var-color-text",
    name: "color/text",
    resolvedType: "COLOR",
    valuesByMode: { default: { r: 0.067, g: 0.094, b: 0.153, a: 1 } }
  },
  {
    id: "var-spacing-sm",
    name: "spacing/sm",
    resolvedType: "FLOAT",
    valuesByMode: { default: 8 }
  },
  {
    id: "var-spacing-md",
    name: "spacing/md",
    resolvedType: "FLOAT",
    valuesByMode: { default: 16 }
  },
  {
    id: "var-radius-sm",
    name: "radius/sm",
    resolvedType: "FLOAT",
    valuesByMode: { default: 6 }
  },
  {
    id: "var-font-body",
    name: "font/body",
    resolvedType: "STRING",
    valuesByMode: { default: "Inter" }
  }
];

export const MOCK_COMPONENTS: FigmaNode[] = [
  {
    id: "button-set",
    name: "Button",
    type: "COMPONENT_SET",
    description: "Primary action button. Use for form submits and high-emphasis actions.",
    children: [
      {
        id: "button-primary-default",
        name: "Button / Variant=Primary, Size=Md, State=Default",
        type: "COMPONENT",
        componentSetId: "button-set",
        variantProperties: { variant: "Primary", size: "Md", state: "Default" },
        layoutMode: "HORIZONTAL",
        primaryAxisSizingMode: "AUTO",
        counterAxisSizingMode: "AUTO",
        itemSpacing: 8,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 10,
        paddingBottom: 10,
        absoluteBoundingBox: { x: 120, y: 160, width: 96, height: 40 },
        fills: [{ type: "SOLID", color: { r: 0.145, g: 0.388, b: 0.921, a: 1 } }],
        effects: [
          {
            type: "DROP_SHADOW",
            color: { r: 0.067, g: 0.094, b: 0.153, a: 0.18 },
            offset: { x: 0, y: 1 },
            radius: 2
          }
        ],
        children: [
          {
            id: "button-label",
            name: "Label",
            type: "TEXT",
            style: { fontFamily: "Inter", fontSize: 14, fontWeight: 600, lineHeightPx: 20 }
          }
        ]
      },
      {
        id: "button-primary-hover",
        name: "Button / Variant=Primary, Size=Md, State=Hover",
        type: "COMPONENT",
        componentSetId: "button-set",
        variantProperties: { variant: "Primary", size: "Md", state: "Hover" },
        layoutMode: "HORIZONTAL",
        itemSpacing: 8,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 10,
        paddingBottom: 10,
        absoluteBoundingBox: { x: 240, y: 160, width: 96, height: 40 },
        fills: [{ type: "SOLID", color: { r: 0.118, g: 0.306, b: 0.729, a: 1 } }]
      }
    ]
  },
  {
    id: "card-set",
    name: "Card",
    type: "COMPONENT_SET",
    description: "Low-emphasis content container with subtle border and compact spacing.",
    children: [
      {
        id: "card-default",
        name: "Card / Elevated=false",
        type: "COMPONENT",
        componentSetId: "card-set",
        variantProperties: { elevated: "false" },
        layoutMode: "VERTICAL",
        itemSpacing: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 16,
        paddingBottom: 16,
        absoluteBoundingBox: { x: 120, y: 240, width: 320, height: 180 },
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }]
      }
    ]
  }
];

export const MOCK_PAGES: FigmaNode[] = [
  {
    id: "page-settings",
    name: "Settings",
    type: "CANVAS",
    layoutMode: "VERTICAL",
    itemSpacing: 24,
    children: [
      {
        id: "settings-header",
        name: "Settings Header",
        type: "FRAME",
        layoutMode: "HORIZONTAL",
        itemSpacing: 16,
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 20,
        paddingBottom: 20,
        absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 80 }
      },
      {
        id: "settings-content",
        name: "Settings Content",
        type: "FRAME",
        layoutMode: "HORIZONTAL",
        itemSpacing: 24,
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 24,
        paddingBottom: 24,
        absoluteBoundingBox: { x: 0, y: 80, width: 1200, height: 720 },
        children: [
          {
            id: "settings-card",
            name: "Card",
            type: "INSTANCE",
            componentId: "card-default",
            absoluteBoundingBox: { x: 24, y: 104, width: 320, height: 180 }
          },
          {
            id: "settings-button",
            name: "Button",
            type: "INSTANCE",
            componentId: "button-primary-default",
            absoluteBoundingBox: { x: 368, y: 104, width: 96, height: 40 }
          }
        ]
      }
    ]
  }
];

export const MOCK_FILE = {
  name: "Mock Product Design System",
  document: {
    id: "root",
    name: "Document",
    type: "DOCUMENT",
    children: MOCK_PAGES
  },
  components: {
    "button-primary-default": { name: "Button" },
    "card-default": { name: "Card" }
  },
  componentSets: {
    "button-set": { name: "Button" },
    "card-set": { name: "Card" }
  }
};

export const MOCK_SVG: Record<string, string> = {
  Button:
    '<svg width="96" height="40" viewBox="0 0 96 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="96" height="40" rx="6" fill="#2563EB"/><text x="48" y="25" text-anchor="middle" fill="white" font-family="Inter" font-size="14" font-weight="600">Button</text></svg>',
  Card:
    '<svg width="320" height="180" viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0.5" y="0.5" width="319" height="179" rx="6" fill="white" stroke="#E5E7EB"/></svg>'
};

