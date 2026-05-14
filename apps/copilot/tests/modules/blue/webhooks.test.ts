import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../../helpers/test-env.js";

describe("blue webhooks", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("allows unsigned Blue webhook health checks without processing data events", async () => {
    const env = createTestEnvironment({
      BLUE_WEBHOOK_SECRET: "",
    });
    try {
      const { verifyAndProcessBlueWebhook } = await import(
        "../../../src/modules/blue/webhooks/service.js"
      );

      await expect(
        verifyAndProcessBlueWebhook({
          rawBody: JSON.stringify({ event: "WEBHOOK_HEALTH_CHECK" }),
        }),
      ).resolves.toEqual({ ok: true, healthCheck: true });
    } finally {
      env.cleanup();
    }
  });

  it("still requires a valid signature for non-health-check events", async () => {
    const env = createTestEnvironment({
      BLUE_WEBHOOK_SECRET: "test-webhook-secret",
    });
    try {
      const { verifyAndProcessBlueWebhook } = await import(
        "../../../src/modules/blue/webhooks/service.js"
      );

      await expect(
        verifyAndProcessBlueWebhook({
          rawBody: JSON.stringify({
            event: "TODO_MOVED",
            data: { todo: { id: "todo_1" } },
          }),
        }),
      ).rejects.toThrow(/Invalid webhook signature/i);
    } finally {
      env.cleanup();
    }
  });
});
