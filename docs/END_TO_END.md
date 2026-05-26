# End-To-End Guide

This guide takes the repo from clone to an agent consuming a real Figma design system. Production mode is the primary user path.

## 1. Install And Configure

```bash
npm install
cp figma.files.example.json figma.files.json
cp codegen.config.example.json codegen.config.json
```

Fill in:

```bash
FIGMA_MODE=production
FIGMA_ACCESS_TOKEN=figd_...
FIGMA_FILES_CONFIG=figma.files.json
FIGMA_PRODUCT=web-app
MCP_API_KEY=replace-with-random-api-key
```

The public Vercel dashboard also supports this live path: open the deployed app, paste the same Figma token and file key, then inspect components, generate code, and run validation from the browser.

## 2. Start MCP

For stdio:

```bash
npx tsx src/mcp-server/index.ts
```

For SSE:

```bash
MCP_API_KEY=replace-with-random-api-key npx tsx src/mcp-server/index.ts --transport sse --port 3100
curl -H "Authorization: Bearer replace-with-random-api-key" http://localhost:3100/ready
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

## 4a. Build A Profile Card From Real Figma

Ask your coding agent:

```text
Read figma://products/web-app/design-tokens and figma://products/web-app/components/Profile%20Card.
Generate a React ProfileCard implementation using extract_component_code.
Use @company/ui from codegen.config.json and do not use raw hex, arbitrary px values, or unapproved props.
Then run validate_implementation against the generated code and fix issues until the score is at least 90.
```

If your design system names the component differently, first call:

```json
{
  "name": "search_design_system",
  "arguments": {
    "product": "web-app",
    "query": "profile card user avatar account summary"
  }
}
```

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

Passing response shape:

```json
{
  "score": 96,
  "issues": [],
  "suggestions": []
}
```

Failing response shape:

```json
{
  "score": 11,
  "issues": [
    {
      "severity": "error",
      "path": "Profile Card.tokens.color",
      "message": "Raw color literal #FFFFFF should be replaced with a design token reference."
    }
  ],
  "suggestions": ["Address Profile Card.tokens.color: Raw color literal #FFFFFF should be replaced with a design token reference."]
}
```

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
