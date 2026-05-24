import { describe, expect, it, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FigmaClient } from "../../src/figma-client/client.js";
import { createMcpServer } from "../../src/mcp-server/index.js";
import { generateComponentCode, validateImplementation } from "../../src/mcp-server/tools.js";
import { componentSetToSpec, variablesToStyleDictionary } from "../../src/figma-client/transformers.js";
import { analyzeImplementation } from "../../src/validators/code-analysis.js";

const clients: Array<{ client: Client; server: ReturnType<typeof createMcpServer>; figma: FigmaClient }> = [];

async function connectClient() {
  const figma = new FigmaClient({ useMockData: true, cachePath: ":memory:" });
  const server = createMcpServer(figma);
  const client = new Client({ name: "vitest", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push({ client, server, figma });
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (entry) => {
    await entry.client.close();
    await entry.server.close();
    entry.figma.close();
  }));
});

describe("MCP server resources", () => {
  it("lists and reads all resource families", async () => {
    const client = await connectClient();
    const resources = await client.listResources();

    expect(resources.resources.map((resource) => resource.uri)).toContain("figma://design-tokens");
    expect(resources.resources.some((resource) => resource.uri.includes("figma://components/Button"))).toBe(true);
    expect(resources.resources.some((resource) => resource.uri.includes("figma://pages/Settings/layout"))).toBe(true);
    expect(resources.resources.some((resource) => resource.uri.includes("figma://assets/Button"))).toBe(true);

    const tokens = await client.readResource({ uri: "figma://design-tokens" });
    expect(JSON.parse(resourceText(tokens)).color.primary.value).toBe("#2563EB");

    const component = await client.readResource({ uri: "figma://components/Button" });
    expect(JSON.parse(resourceText(component)).props.state).toContain("Hover");

    const layout = await client.readResource({ uri: "figma://pages/Settings/layout" });
    expect(JSON.parse(resourceText(layout)).componentPlacements).toHaveLength(2);

    const svg = await client.readResource({ uri: "figma://assets/Button" });
    expect(svg.contents[0]?.mimeType).toBe("image/svg+xml");
    expect(resourceText(svg)).toContain("textAnchor");
  });

  it("reports missing components as request failures", async () => {
    const client = await connectClient();
    await expect(client.readResource({ uri: "figma://components/Missing" })).rejects.toThrow();
  });
});

describe("MCP tools", () => {
  it("generates component code, validates it, and searches the design system", async () => {
    const client = await connectClient();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["extract_component_code", "validate_implementation", "search_design_system"])
    );

    const generated = await client.callTool({
      name: "extract_component_code",
      arguments: { component_name: "Button", framework: "react" }
    });
    const generatedBody = JSON.parse(toolText(generated));
    expect(generatedBody.code).toContain("export function Button");
    expect(generatedBody.tokens_used).toContain("--color-primary");

    const validation = await client.callTool({
      name: "validate_implementation",
      arguments: {
        component_name: "Button",
        code: generatedBody.code
      }
    });
    const validationBody = JSON.parse(toolText(validation));
    expect(validationBody.score).toBeGreaterThanOrEqual(70);

    const search = await client.callTool({
      name: "search_design_system",
      arguments: { query: "primary action" }
    });
    const searchBody = JSON.parse(toolText(search));
    expect(searchBody.matches[0].spec.name).toBe("Button");
  });

  it("generates non-React scaffolds and scores weak implementations", async () => {
    const figma = new FigmaClient({ useMockData: true, cachePath: ":memory:" });
    try {
      const spec = componentSetToSpec(await figma.getComponentSet("Button"));
      const tokens = variablesToStyleDictionary(await figma.getVariables());

      expect(generateComponentCode(spec, "vue", tokens).code).toContain("<template>");
      expect(generateComponentCode(spec, "svelte", tokens).code).toContain("<script lang=\"ts\">");

      const validation = validateImplementation("<div style=\"color:#FFFFFF\">Label</div>", spec, tokens);
      expect(validation.score).toBeLessThan(80);
      expect(validation.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["Button.spacing", "Button.accessibility"]));
    } finally {
      figma.close();
    }
  });

  it("extracts implementation values through TSX analysis", () => {
    const analysis = analyzeImplementation('<button aria-label="Save" style={{ color: "#2563EB", padding: "8px" }}>Save</button>');
    expect(analysis.attributes).toContain("aria-label");
    expect(analysis.values).toEqual(expect.arrayContaining(["Save", "#2563EB", "8px"]));
  });
});

function resourceText(result: { contents: Array<{ text?: string; blob?: string }> }): string {
  const content = result.contents[0];
  return content && "text" in content ? content.text ?? "{}" : "{}";
}

function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content?.[0];
  return content?.type === "text" ? content.text ?? "{}" : "{}";
}
