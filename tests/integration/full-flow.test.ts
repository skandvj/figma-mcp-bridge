import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FigmaClient } from "../../src/figma-client/client.js";
import { createMcpServer } from "../../src/mcp-server/index.js";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

describe("full MCP design-system flow", () => {
  it("gets tokens, extracts code, validates implementation, and searches components", async () => {
    const figma = new FigmaClient({ useMockData: true, cachePath: ":memory:" });
    const server = createMcpServer(figma);
    const mcpClient = new Client({ name: "integration", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);
    cleanup.push(async () => mcpClient.close());
    cleanup.push(async () => server.close());
    cleanup.push(() => figma.close());

    const resourceList = await mcpClient.listResources();
    expect(resourceList.resources.length).toBeGreaterThanOrEqual(4);

    const tokenResource = await mcpClient.readResource({ uri: "figma://design-tokens" });
    const tokens = JSON.parse(resourceText(tokenResource));
    expect(tokens.spacing.md.value).toBe("16px");

    const codeResult = await mcpClient.callTool({
      name: "extract_component_code",
      arguments: { component_name: "Button", framework: "react" }
    });
    const codePayload = JSON.parse(toolText(codeResult));
    expect(codePayload.code).toContain("data-figma-component");

    const validation = await mcpClient.callTool({
      name: "validate_implementation",
      arguments: { component_name: "Button", code: codePayload.code }
    });
    const validationPayload = JSON.parse(toolText(validation));
    expect(validationPayload.issues.length).toBeLessThan(3);

    const search = await mcpClient.callTool({
      name: "search_design_system",
      arguments: { query: "content container" }
    });
    const searchPayload = JSON.parse(toolText(search));
    expect(searchPayload.matches[0].spec.name).toBe("Card");
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
