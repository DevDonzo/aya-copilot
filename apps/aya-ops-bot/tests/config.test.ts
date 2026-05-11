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
});
