import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "./helpers/test-env.js";

describe("config safety", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses to boot with the forbidden Blue workspace", async () => {
    const env = createTestEnvironment({
      BLUE_WORKSPACE_ID: "cmhazc4rl1vkand1eonnmiyjy",
    });

    try {
      await expect(import("../src/config.js")).rejects.toThrow(
        /forbidden BLUE_WORKSPACE_ID/i,
      );
    } finally {
      env.cleanup();
    }
  });

  it("defaults chat runtime to agent with planner fallback on gpt-4o", async () => {
    const env = createTestEnvironment();

    try {
      const { config } = await import("../src/config.js");

      expect(config.AYA_CHAT_RUNTIME).toBe("agent_with_planner_fallback");
      expect(config.AYA_AGENT_MODEL).toBe("gpt-4o");
      expect(config.AYA_AGENT_MAX_STEPS).toBe(5);
    } finally {
      env.cleanup();
    }
  });
});
