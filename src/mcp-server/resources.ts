import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { FigmaClient } from "../figma-client/client.js";
import {
  componentSetToSpec,
  pageToLayoutSpec,
  variablesToStyleDictionary
} from "../figma-client/transformers.js";

export function registerResources(server: McpServer, client: FigmaClient): void {
  server.registerResource(
    "design-tokens",
    "figma://design-tokens",
    {
      title: "Design Tokens",
      description: "Figma local variables transformed into Style Dictionary token JSON.",
      mimeType: "application/json"
    },
    async (uri) => jsonResource(uri.href, variablesToStyleDictionary(await client.getVariables()))
  );

  server.registerResource(
    "component-spec",
    new ResourceTemplate("figma://components/{component-name}", {
      list: async () => ({
        resources: (await client.listComponentNames()).map((name) => ({
          uri: `figma://components/${encodeURIComponent(name)}`,
          name,
          mimeType: "application/json"
        }))
      }),
      complete: {
        "component-name": async (value) => filterCompletions(await client.listComponentNames(), value)
      }
    }),
    {
      title: "Component Spec",
      description: "Component variants, props, sizing, spacing, states, and generated TypeScript props.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const name = getVariable(variables, "component-name");
      return jsonResource(uri.href, componentSetToSpec(await client.getComponentSet(name)));
    }
  );

  server.registerResource(
    "page-layout",
    new ResourceTemplate("figma://pages/{page-name}/layout", {
      list: async () => ({
        resources: (await client.listPageNames()).map((name) => ({
          uri: `figma://pages/${encodeURIComponent(name)}/layout`,
          name: `${name} layout`,
          mimeType: "application/json"
        }))
      }),
      complete: {
        "page-name": async (value) => filterCompletions(await client.listPageNames(), value)
      }
    }),
    {
      title: "Page Layout",
      description: "Auto-layout structure translated into CSS flex/grid guidance.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const pageName = getVariable(variables, "page-name");
      return jsonResource(uri.href, pageToLayoutSpec(await client.getPageLayout(pageName)));
    }
  );

  server.registerResource(
    "asset-svg",
    new ResourceTemplate("figma://assets/{asset-name}", {
      list: async () => ({
        resources: (await client.listComponentNames()).map((name) => ({
          uri: `figma://assets/${encodeURIComponent(name)}`,
          name: `${name} SVG`,
          mimeType: "image/svg+xml"
        }))
      }),
      complete: {
        "asset-name": async (value) => filterCompletions(await client.listComponentNames(), value)
      }
    }),
    {
      title: "Asset SVG",
      description: "Optimized inline SVG export for a named Figma component or icon.",
      mimeType: "image/svg+xml"
    },
    async (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "image/svg+xml",
          text: await client.exportNode(getVariable(variables, "asset-name"), "svg")
        }
      ]
    })
  );
}

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function getVariable(variables: Variables, name: string): string {
  const value = variables[name];
  return decodeURIComponent(Array.isArray(value) ? value[0] ?? "" : value ?? "");
}

function filterCompletions(values: string[], query: string): string[] {
  const normalized = query.toLowerCase();
  return values.filter((value) => value.toLowerCase().includes(normalized)).slice(0, 10);
}
