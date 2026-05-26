import { describe, expect, it } from "vitest";
import { FigmaClient } from "../../src/figma-client/client.js";
import { variablesToStyleDictionary } from "../../src/figma-client/transformers.js";

const runLive = process.env.RUN_LIVE_FIGMA_TESTS === "true";
const describeLive = runLive ? describe : describe.skip;

describeLive("live Figma production verification", () => {
  it("loads a configured real Figma file, variables, and discoverable metadata", async () => {
    assertLiveConfiguration();
    const client = new FigmaClient({
      mode: "production",
      cachePath: ":memory:",
      rateLimitPerMinute: 30
    });

    try {
      const file = await client.getFile();
      expect(file.document?.id).toBeTruthy();

      const variables = await client.getVariables();
      expect(Array.isArray(variables)).toBe(true);
      const tokens = variablesToStyleDictionary(variables);
      expect(tokens).toBeTruthy();

      await expect(client.listComponentNames()).resolves.toEqual(expect.any(Array));
      await expect(client.listPageNames()).resolves.toEqual(expect.any(Array));
    } finally {
      client.close();
    }
  }, 30_000);
});

function assertLiveConfiguration(): void {
  const hasToken = Boolean(process.env.FIGMA_ACCESS_TOKEN);
  const hasSingleFile = Boolean(process.env.FIGMA_FILE_KEY);
  const hasFileConfig = Boolean(process.env.FIGMA_FILES_CONFIG);
  if (!hasToken || (!hasSingleFile && !hasFileConfig)) {
    throw new Error(
      "RUN_LIVE_FIGMA_TESTS=true requires FIGMA_ACCESS_TOKEN and either FIGMA_FILE_KEY or FIGMA_FILES_CONFIG."
    );
  }
}
