import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FigmaClient } from "../../src/figma-client/client.js";
import { TokenPipeline, renderOutputs } from "../../src/token-pipeline/pipeline.js";
import { buildTailwindTheme, generateTailwindConfig } from "../../src/token-pipeline/tailwind-generator.js";

const tempDirs: string[] = [];
const clients: FigmaClient[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("TokenPipeline", () => {
  it("generates CSS, Tailwind, TypeScript, SCSS, and JSON outputs", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "figma-tokens-"));
    tempDirs.push(outputDir);
    const client = new FigmaClient({ useMockData: true, cachePath: ":memory:" });
    clients.push(client);
    const pipeline = new TokenPipeline({ client, outputDir });

    const variables = await pipeline.extractFromFigma();
    const tokens = await pipeline.transformToStyleDictionary(variables);
    const outputs = await pipeline.generateOutputs(tokens);

    expect(outputs.css).toContain("--color-primary: #2563EB");
    expect(outputs.tailwind).toContain("var(--color-primary)");
    expect(outputs.typescript).toContain("export const tokens");
    expect(outputs.scss).toContain("$color-primary");
    expect(JSON.parse(outputs.json).color.primary.value).toBe("#2563EB");
    expect(await readFile(path.join(outputDir, "tokens.css"), "utf8")).toBe(outputs.css);
    expect(await readFile(path.join(outputDir, "tailwind.tokens.js"), "utf8")).toContain("theme");
  });

  it("renders token outputs and Tailwind theme without writing files", () => {
    const tokens = {
      color: { primary: { value: "#2563EB" }, brand: { accent: { value: "#1E4EBA" } } },
      spacing: { sm: { value: "8px" } },
      radius: { sm: { value: "6px" } },
      font: { body: { value: "Inter" } }
    };
    const outputs = renderOutputs(tokens);
    expect(outputs.css).toContain("--spacing-sm: 8px");
    expect(generateTailwindConfig(tokens)).toContain("borderRadius");
    expect(buildTailwindTheme(tokens).fontFamily).toMatchObject({ body: "var(--font-body)" });
  });

  it("sets up a watcher for configured paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "figma-watch-"));
    tempDirs.push(dir);
    const client = new FigmaClient({ useMockData: true, cachePath: ":memory:" });
    clients.push(client);
    const watcher = new TokenPipeline({ client, outputDir: dir, watchPaths: [dir] }).watch();
    expect(watcher.getWatched()).toBeDefined();
    await watcher.close();
  });
});
