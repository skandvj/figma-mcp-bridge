# End-To-End Guide

This guide takes the repo from clone to an agent consuming Figma design-system data.

## 1. Install And Configure

```bash
npm install
cp .env.example .env
```

Fill in:

```bash
FIGMA_ACCESS_TOKEN=your_figma_token
FIGMA_FILE_KEY=your_file_key
```

Leaving those blank runs against mock data, which is useful for demos and CI.

## 2. Start MCP

For stdio:

```bash
npx tsx src/mcp-server/index.ts
```

For SSE:

```bash
npx tsx src/mcp-server/index.ts --transport sse --port 3100
```

## 3. Read Tokens

Ask the MCP client to read:

```text
figma://design-tokens
```

The response is Style Dictionary JSON:

```json
{
  "color": {
    "primary": { "value": "#2563EB", "type": "color" }
  }
}
```

## 4. Generate Component Code

Call:

```json
{
  "name": "extract_component_code",
  "arguments": {
    "component_name": "Button",
    "framework": "react"
  }
}
```

The output includes scaffold code, dependencies, and token variables used.

## 5. Validate Implementation

Call:

```json
{
  "name": "validate_implementation",
  "arguments": {
    "component_name": "Button",
    "code": "<button aria-label=\"Save\" style={{ padding: \"8px\" }}>Save</button>"
  }
}
```

The result includes a score, issue list, and suggestions.

## 6. Generate Production Token Files

```bash
npx tsx -e 'import { TokenPipeline } from "./src/token-pipeline/pipeline.ts"; await new TokenPipeline().generateOutputs();'
```

Import `generated/tokens/tokens.css` in your app and merge `tailwind.tokens.js` into your Tailwind config.

## 7. Keep Cache Fresh

Install the Figma plugin and set its webhook endpoint to:

```text
http://localhost:3100/webhook/figma
```

When designers export changes, the webhook invalidates the MCP cache.
