import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FigmaClient } from "../../src/figma-client/client.js";
import { loadFigmaConfig } from "../../src/figma-client/config.js";
import {
  componentSetToSpec,
  figmaColorToCSS,
  figmaConstraintsToCSS,
  figmaEffectsToCSS,
  figmaLayoutToTailwind,
  figmaSpacingToCSS,
  figmaTypographyToCSS,
  optimizeSvgForReact,
  pageToLayoutSpec,
  variablesToStyleDictionary
} from "../../src/figma-client/transformers.js";

const openClients: FigmaClient[] = [];

afterEach(async () => {
  openClients.splice(0).forEach((client) => client.close());
  vi.restoreAllMocks();
});

describe("FigmaClient mock mode", () => {
  it("returns mock file, variables, components, nodes, pages, and assets", async () => {
    const client = new FigmaClient({ useMockData: true, cachePath: ":memory:" });
    openClients.push(client);

    expect((await client.getFile()).name).toContain("Mock Product");
    expect(await client.listComponentNames()).toEqual(["Button", "Card"]);
    expect(await client.listPageNames()).toEqual(["Settings"]);
    expect((await client.getVariables())[0]?.name).toBe("color/primary");
    expect((await client.getComponentSet("button")).name).toBe("Button");
    expect((await client.getNodeById("settings-card")).name).toBe("Card");
    expect((await client.getPageLayout("Settings")).type).toBe("CANVAS");
    expect(await client.exportNode("Button", "svg")).toContain("textAnchor");
    expect(await client.exportNode("Button", "png")).toContain("data:image/png");
    expect(client.handleWebhook({ event: "FILE_UPDATE" }).invalidated).toBeGreaterThanOrEqual(0);
    await expect(client.getComponentSet("Missing")).rejects.toThrow("Component not found");
    await expect(client.getNodeById("missing")).rejects.toThrow("Node not found");
  });
});

describe("FigmaClient REST mode", () => {
  it("calls the Figma API, maps variables, exports SVGs, caches, expires, and invalidates", async () => {
    let fileHits = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://figma.test/v1/files/file") {
        fileHits += 1;
        return jsonResponse({ document: { id: "root", name: "Doc", type: "DOCUMENT", children: [{ id: "node:1", name: "Button", type: "COMPONENT_SET" }] } });
      }
      if (url === "https://figma.test/v1/files/file/variables/local") {
        return jsonResponse({
          meta: {
            variableCollections: {
              c: {
                name: "Theme",
                modes: [
                  { modeId: "light", name: "Light" },
                  { modeId: "dark", name: "Dark" }
                ]
              }
            },
            variables: {
              a: {
                id: "a",
                name: "color/accent",
                resolvedType: "COLOR",
                variableCollectionId: "c",
                description: "Accent color",
                valuesByMode: {
                  light: { r: 1, g: 0, b: 0, a: 1 },
                  dark: { r: 0, g: 0, b: 0, a: 1 }
                }
              }
            }
          }
        });
      }
      if (url.startsWith("https://figma.test/v1/files/file/nodes")) {
        return jsonResponse({ nodes: { "node:1": { document: { id: "node:1", name: "Button", type: "COMPONENT_SET" } } } });
      }
      if (url.startsWith("https://figma.test/v1/images/file")) {
        return jsonResponse({ images: { "node:1": "https://assets.test/asset.svg" } });
      }
      if (url === "https://assets.test/asset.svg") {
        return new Response('<svg><path stroke-width="2" /></svg>', { status: 200 });
      }
      return jsonResponse({ error: "not found" }, 404);
    });
    const client = new FigmaClient({
      accessToken: "token",
      fileKey: "file",
      baseUrl: "https://figma.test",
      cachePath: ":memory:",
      cacheTtlMs: 3,
      rateLimitPerMinute: 60_000,
      useMockData: false
    });
    openClients.push(client);

    expect((await client.getFile()).document?.name).toBe("Doc");
    expect((await client.getFile()).document?.name).toBe("Doc");
    expect(fileHits).toBe(1);
    const variables = await client.getVariables();
    expect(variables[0]?.name).toBe("color/accent");
    expect(variables[0]?.collectionName).toBe("Theme");
    expect(variables[0]?.valuesByMode.Dark).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    const tokens = variablesToStyleDictionary(variables);
    expect(JSON.stringify(tokens)).toContain("\"modes\"");
    expect(JSON.stringify(tokens)).toContain("#000000");
    expect((await client.getNodeById("node:1")).name).toBe("Button");
    expect(await client.exportNode("node:1", "svg")).toContain("strokeWidth");
    expect(client.invalidateCache()).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await client.getFile()).document?.name).toBe("Doc");
    expect(fileHits).toBe(2);
  });

  it("handles REST errors, cache expiry, PNG exports, and missing real components", async () => {
    let fileHits = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://figma.test/v1/files/bad") return jsonResponse({ error: "bad" }, 500);
      if (url === "https://figma.test/v1/files/file") {
        fileHits += 1;
        return jsonResponse({
          document: {
            id: "root",
            name: "Doc",
            type: "DOCUMENT",
            children: [{ id: "button-set", name: "Button", type: "COMPONENT_SET" }]
          }
        });
      }
      if (url === "https://figma.test/v1/files/file/variables/local") {
        return jsonResponse({ meta: { variables: { weird: { id: "weird", name: "misc/weird", resolvedType: "UNKNOWN" } } } });
      }
      if (url.startsWith("https://figma.test/v1/images/file")) {
        return jsonResponse({ images: { "button-set": "https://assets.test/button.png" } });
      }
      return jsonResponse({ error: "not found" }, 404);
    });

    const client = new FigmaClient({
      accessToken: "token",
      fileKey: "file",
      baseUrl: "https://figma.test",
      cachePath: ":memory:",
      cacheTtlMs: 1,
      rateLimitPerMinute: 60_000,
      useMockData: false
    });
    const badClient = new FigmaClient({
      accessToken: "token",
      fileKey: "bad",
      baseUrl: "https://figma.test",
      cachePath: ":memory:",
      rateLimitPerMinute: 60_000,
      useMockData: false
    });
    openClients.push(client, badClient);

    expect((await client.getVariables())[0]?.resolvedType).toBe("STRING");
    expect(await client.exportNode("Button", "png")).toBe("https://assets.test/button.png");
    await expect(client.getComponentSet("Missing")).rejects.toThrow("Component not found");
    await expect(badClient.getFile()).rejects.toThrow("Figma API request failed");
    await client.getFile();
    await new Promise((resolve) => setTimeout(resolve, 3));
    await client.getFile();
    expect(fileHits).toBeGreaterThanOrEqual(2);
  });

  it("requires credentials when production mode is enabled", () => {
    expect(() => new FigmaClient({ mode: "production", cachePath: ":memory:" })).toThrow("FIGMA_MODE=production");
  });

  it("loads multiple product files from config and routes requests by product", async () => {
    const directory = mkdtempSync(join(tmpdir(), "figma-config-"));
    const configPath = join(directory, "figma.files.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        defaultProduct: "web",
        files: [
          { name: "web", fileKey: "web-file" },
          { name: "marketing", fileKey: "marketing-file" }
        ]
      })
    );
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://figma.test/v1/files/marketing-file") {
        return jsonResponse({ document: { id: "root", name: "Marketing", type: "DOCUMENT", children: [] } });
      }
      if (url === "https://figma.test/v1/files/web-file") {
        return jsonResponse({ document: { id: "root", name: "Web", type: "DOCUMENT", children: [] } });
      }
      return jsonResponse({ error: "not found" }, 404);
    });
    const client = new FigmaClient({
      accessToken: "token",
      mode: "production",
      configPath,
      baseUrl: "https://figma.test",
      cachePath: ":memory:",
      rateLimitPerMinute: 60_000
    });
    openClients.push(client);

    expect(client.runtimeMode).toBe("production");
    expect(client.defaultProductName).toBe("web");
    expect(client.listProductNames()).toEqual(["marketing", "web"]);
    expect((await client.getFile("marketing")).document?.name).toBe("Marketing");
    expect((await client.getFile()).document?.name).toBe("Web");
    expect(urls).toEqual(expect.arrayContaining(["https://figma.test/v1/files/marketing-file", "https://figma.test/v1/files/web-file"]));
    await expect(client.getFile("mobile")).rejects.toThrow("Figma product not configured");
  });

  it("loads config from env-compatible inputs", () => {
    const config = loadFigmaConfig({
      env: {
        FIGMA_MODE: "production",
        FIGMA_ACCESS_TOKEN: "token",
        FIGMA_FILE_KEY: "legacy-file",
        FIGMA_PRODUCT: "legacy"
      }
    });

    expect(config.mode).toBe("production");
    expect(config.defaultProduct).toBe("legacy");
    expect(config.files).toEqual([{ name: "legacy", fileKey: "legacy-file" }]);
  });

  it("uses component metadata for lookup and caches exported assets by file and node", async () => {
    let imageHits = 0;
    let assetHits = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://figma.test/v1/files/file") {
        return jsonResponse({
          document: { id: "root", name: "Doc", type: "DOCUMENT", children: [] },
          componentSets: {
            "component:1": { name: "Button", description: "Metadata button" }
          }
        });
      }
      if (url.startsWith("https://figma.test/v1/files/file/nodes")) {
        return jsonResponse({
          nodes: {
            "component:1": {
              document: { id: "component:1", name: "Button", type: "COMPONENT_SET" }
            }
          }
        });
      }
      if (url.startsWith("https://figma.test/v1/images/file")) {
        imageHits += 1;
        return jsonResponse({ images: { "component:1": "https://assets.test/button.svg" } });
      }
      if (url === "https://assets.test/button.svg") {
        assetHits += 1;
        return new Response('<svg><path stroke-width="2" /></svg>', { status: 200 });
      }
      return jsonResponse({ error: "not found" }, 404);
    });
    const client = new FigmaClient({
      accessToken: "token",
      fileKey: "file",
      baseUrl: "https://figma.test",
      cachePath: ":memory:",
      rateLimitPerMinute: 60_000,
      useMockData: false
    });
    openClients.push(client);

    expect(await client.listComponentNames()).toEqual(["Button"]);
    expect((await client.getComponentSet("Button")).description).toBe("Metadata button");
    expect(await client.exportNode("Button", "svg")).toContain("strokeWidth");
    expect(await client.exportNode("Button", "svg")).toContain("strokeWidth");
    expect(imageHits).toBe(1);
    expect(assetHits).toBe(1);
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("transformers", () => {
  it("converts Figma primitives into CSS, tokens, specs, layouts, and React SVG", () => {
    expect(figmaColorToCSS({ r: 0.145, g: 0.388, b: 0.921, a: 1 })).toBe("#2563EB");
    expect(figmaColorToCSS({ r: 1, g: 0, b: 0, a: 0.5 })).toBe("rgba(255, 0, 0, 0.5)");
    expect(figmaSpacingToCSS({ paddingTop: 8, paddingRight: 10, paddingBottom: 12, paddingLeft: 14, itemSpacing: 16 })).toEqual({
      paddingTop: "8px",
      paddingRight: "10px",
      paddingBottom: "12px",
      paddingLeft: "14px",
      gap: "16px"
    });
    expect(figmaTypographyToCSS({ fontFamily: "Inter", fontSize: 14, fontWeight: 600, lineHeightPx: 20 })).toMatchObject({
      fontFamily: "Inter",
      fontSize: "14px"
    });
    expect(figmaEffectsToCSS([{ type: "INNER_SHADOW", offset: { x: 1, y: 2 }, radius: 3, color: { r: 0, g: 0, b: 0, a: 0.2 } }]).boxShadow).toContain("inset");
    expect(figmaConstraintsToCSS({ horizontal: "STRETCH", vertical: "CENTER" })).toMatchObject({ width: "100%", marginBlock: "auto" });
    expect(figmaLayoutToTailwind({ id: "a", name: "Frame", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 12, paddingTop: 4 })).toContain("flex-col");
    expect(optimizeSvgForReact('<svg class="x" fill-rule="evenodd" clip-path="url(#a)" stroke-width="2" />')).toContain("className");

    const tokens = variablesToStyleDictionary([
      { id: "a", name: "spacing/sm", resolvedType: "FLOAT", valuesByMode: { default: 8 } },
      { id: "b", name: "enabled", resolvedType: "BOOLEAN", valuesByMode: { default: true } },
      { id: "c", name: "radius/sm", resolvedType: "FLOAT", valuesByMode: { default: 6 } },
      {
        id: "d",
        name: "typography/body",
        resolvedType: "STRING",
        valuesByMode: { default: { fontFamily: "Inter", fontSize: 16, lineHeightPx: 24 } }
      },
      {
        id: "e",
        name: "shadow/card",
        resolvedType: "STRING",
        valuesByMode: {
          default: [{ type: "DROP_SHADOW", offset: { x: 0, y: 4 }, radius: 12, color: { r: 0, g: 0, b: 0, a: 0.2 } }]
        }
      }
    ]);
    expect(JSON.stringify(tokens)).toContain("8px");
    expect(JSON.stringify(tokens)).toContain("6px");
    expect(JSON.stringify(tokens)).toContain("Inter");
    expect(JSON.stringify(tokens)).toContain("boxShadow");

    const spec = componentSetToSpec({
      id: "tabs",
      name: "Tabs",
      type: "COMPONENT_SET",
      description: "Navigation tabs. Use inside settings pages.",
      children: [{ id: "tab", name: "Tabs / State=Active", type: "COMPONENT", absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 32 } }]
    });
    expect(spec.props.state).toContain("Active");

    const layout = pageToLayoutSpec({
      id: "page",
      name: "Home",
      type: "CANVAS",
      layoutMode: "HORIZONTAL",
      itemSpacing: 20,
      children: [{ id: "section", name: "Section", type: "FRAME", layoutMode: "NONE", children: [{ id: "button", name: "Button", type: "INSTANCE", absoluteBoundingBox: { x: 1, y: 2, width: 3, height: 4 } }] }]
    });
    expect(layout.grid.columns).toBe(1);
    expect(layout.componentPlacements[0]?.component).toBe("Button");
  });
});
