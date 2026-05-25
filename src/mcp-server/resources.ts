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
    "product-design-tokens",
    new ResourceTemplate("figma://products/{product}/design-tokens", {
      list: async () => ({
        resources: client.listProductNames().map((product) => ({
          uri: `figma://products/${encodeURIComponent(product)}/design-tokens`,
          name: `${product} design tokens`,
          mimeType: "application/json"
        }))
      }),
      complete: {
        product: async (value) => filterCompletions(client.listProductNames(), value)
      }
    }),
    {
      title: "Product Design Tokens",
      description: "Product-scoped Figma variables transformed into Style Dictionary token JSON.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const product = getVariable(variables, "product");
      return jsonResource(uri.href, variablesToStyleDictionary(await client.getVariables(product)));
    }
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
    "product-component-spec",
    new ResourceTemplate("figma://products/{product}/components/{component-name}", {
      list: async () => ({
        resources: (
          await Promise.all(
            client.listProductNames().map(async (product) =>
              (await client.listComponentNames(product)).map((name) => ({
                uri: `figma://products/${encodeURIComponent(product)}/components/${encodeURIComponent(name)}`,
                name: `${product} / ${name}`,
                mimeType: "application/json"
              }))
            )
          )
        ).flat()
      }),
      complete: {
        product: async (value) => filterCompletions(client.listProductNames(), value),
        "component-name": async (value) => filterCompletions(await client.listComponentNames(), value)
      }
    }),
    {
      title: "Product Component Spec",
      description: "Product-scoped component variants, props, sizing, spacing, states, and TypeScript props.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const product = getVariable(variables, "product");
      const name = getVariable(variables, "component-name");
      return jsonResource(uri.href, componentSetToSpec(await client.getComponentSet(name, product)));
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
    "product-page-layout",
    new ResourceTemplate("figma://products/{product}/pages/{page-name}/layout", {
      list: async () => ({
        resources: (
          await Promise.all(
            client.listProductNames().map(async (product) =>
              (await client.listPageNames(product)).map((name) => ({
                uri: `figma://products/${encodeURIComponent(product)}/pages/${encodeURIComponent(name)}/layout`,
                name: `${product} / ${name} layout`,
                mimeType: "application/json"
              }))
            )
          )
        ).flat()
      }),
      complete: {
        product: async (value) => filterCompletions(client.listProductNames(), value),
        "page-name": async (value) => filterCompletions(await client.listPageNames(), value)
      }
    }),
    {
      title: "Product Page Layout",
      description: "Product-scoped auto-layout structure translated into CSS flex/grid guidance.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const product = getVariable(variables, "product");
      const pageName = getVariable(variables, "page-name");
      return jsonResource(uri.href, pageToLayoutSpec(await client.getPageLayout(pageName, product)));
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

  server.registerResource(
    "product-asset-svg",
    new ResourceTemplate("figma://products/{product}/assets/{asset-name}", {
      list: async () => ({
        resources: (
          await Promise.all(
            client.listProductNames().map(async (product) =>
              (await client.listComponentNames(product)).map((name) => ({
                uri: `figma://products/${encodeURIComponent(product)}/assets/${encodeURIComponent(name)}`,
                name: `${product} / ${name} SVG`,
                mimeType: "image/svg+xml"
              }))
            )
          )
        ).flat()
      }),
      complete: {
        product: async (value) => filterCompletions(client.listProductNames(), value),
        "asset-name": async (value) => filterCompletions(await client.listComponentNames(), value)
      }
    }),
    {
      title: "Product Asset SVG",
      description: "Product-scoped optimized inline SVG export for a named Figma component or icon.",
      mimeType: "image/svg+xml"
    },
    async (uri, variables) => {
      const product = getVariable(variables, "product");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "image/svg+xml",
            text: await client.exportNode(getVariable(variables, "asset-name"), "svg", product)
          }
        ]
      };
    }
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
