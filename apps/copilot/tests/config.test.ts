import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "./helpers/test-env.js";

describe("config safety", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses to boot with the forbidden Blue workspace", async () => {
    const env = createTestEnvironment({
      BLUE_WORKSPACE_ID: "cmn524yr800e101mh7kn44mhf",
    });

    try {
      await expect(import("../src/config.js")).rejects.toThrow(
        /forbidden BLUE_WORKSPACE_ID/i,
      );
    } finally {
      env.cleanup();
    }
  });

  it("defaults chat runtime to the fast agent profile", async () => {
    const env = createTestEnvironment({
      AYA_CHAT_RUNTIME: undefined,
      AYA_AGENT_MODEL: undefined,
      AYA_AGENT_MAX_STEPS: undefined,
      AYA_BLUE_AUTH_CACHE_TTL_MS: undefined,
    });

    try {
      const { config } = await import("../src/config.js");

      expect(config.AYA_CHAT_RUNTIME).toBe("agent");
      expect(config.AYA_AGENT_MODEL).toBe("gpt-4o-mini");
      expect(config.AYA_AGENT_MAX_STEPS).toBe(3);
      expect(config.AYA_BLUE_AUTH_CACHE_TTL_MS).toBe(43_200_000);
    } finally {
      env.cleanup();
    }
  });
});
