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

  it("recreates an existing webhook when the signing secret is missing", async () => {
    const env = createTestEnvironment({
      BLUE_WEBHOOK_SECRET: "",
    });
    const createOrUpdateWebhook = vi.fn().mockResolvedValue({
      webhook: {
        id: "webhook_new",
        name: "AyaFinancial FinOps Bot",
        url: "https://copilot.test/webhooks/blue",
        events: ["TODO_MOVED"],
        projectIds: ["cmhazc4rl1vkand1eonnmiyjy"],
        enabled: true,
        status: "HEALTHY",
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        secret: "new-secret",
      },
      secret: "new-secret",
    });
    const deleteWebhook = vi.fn().mockResolvedValue(true);
    vi.doMock("../../../src/modules/blue/graphql/client.js", () => ({
      createOrUpdateWebhook,
      deleteWebhook,
      fetchRecordDetail: vi.fn(),
    }));

    try {
      const {
        initializeDatabase,
        listBlueWebhookSubscriptions,
        upsertBlueWebhookSubscription,
      } = await import("../../../src/db.js");
      await initializeDatabase();
      await upsertBlueWebhookSubscription({
        id: "subscription_old",
        workspaceId: "cmhazc4rl1vkand1eonnmiyjy",
        blueWebhookId: "webhook_old",
        url: "https://copilot.test/webhooks/blue",
        eventsJson: JSON.stringify(["TODO_MOVED"]),
        status: "HEALTHY",
        secretRef: null,
        enabled: true,
      });

      const { registerBlueWebhookIfConfigured } = await import(
        "../../../src/modules/blue/webhooks/service.js"
      );

      await expect(registerBlueWebhookIfConfigured()).resolves.toMatchObject({
        id: "webhook_new",
        enabled: true,
        status: "HEALTHY",
      });

      expect(deleteWebhook).toHaveBeenCalledWith("webhook_old");
      expect(createOrUpdateWebhook).toHaveBeenCalledWith(
        expect.not.objectContaining({ existingWebhookId: expect.any(String) }),
      );

      const subscriptions = await listBlueWebhookSubscriptions(
        "cmhazc4rl1vkand1eonnmiyjy",
      );
      expect(
        subscriptions.find((item) => item.blue_webhook_id === "webhook_old"),
      ).toMatchObject({ enabled: 0, status: "DELETED" });
      expect(
        subscriptions.find((item) => item.blue_webhook_id === "webhook_new"),
      ).toMatchObject({ enabled: 1, status: "HEALTHY", secret_ref: "new-secret" });
    } finally {
      vi.doUnmock("../../../src/modules/blue/graphql/client.js");
      env.cleanup();
    }
  });

  it("preserves the stored signing secret when updating an existing webhook", async () => {
    const env = createTestEnvironment({
      BLUE_WEBHOOK_SECRET: "",
    });
    const createOrUpdateWebhook = vi.fn().mockResolvedValue({
      webhook: {
        id: "webhook_existing",
        name: "AyaFinancial FinOps Bot",
        url: "https://copilot.test/webhooks/blue",
        events: ["TODO_MOVED"],
        projectIds: ["cmhazc4rl1vkand1eonnmiyjy"],
        enabled: true,
        status: "HEALTHY",
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        secret: null,
      },
      secret: null,
    });
    const deleteWebhook = vi.fn();
    vi.doMock("../../../src/modules/blue/graphql/client.js", () => ({
      createOrUpdateWebhook,
      deleteWebhook,
      fetchRecordDetail: vi.fn(),
    }));

    try {
      const {
        initializeDatabase,
        listBlueWebhookSubscriptions,
        upsertBlueWebhookSubscription,
      } = await import("../../../src/db.js");
      await initializeDatabase();
      await upsertBlueWebhookSubscription({
        id: "subscription_existing",
        workspaceId: "cmhazc4rl1vkand1eonnmiyjy",
        blueWebhookId: "webhook_existing",
        url: "https://copilot.test/webhooks/blue",
        eventsJson: JSON.stringify(["TODO_MOVED"]),
        status: "HEALTHY",
        secretRef: "stored-secret",
        enabled: true,
      });

      const { registerBlueWebhookIfConfigured } = await import(
        "../../../src/modules/blue/webhooks/service.js"
      );
      await registerBlueWebhookIfConfigured();

      expect(deleteWebhook).not.toHaveBeenCalled();
      expect(createOrUpdateWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ existingWebhookId: "webhook_existing" }),
      );

      const subscriptions = await listBlueWebhookSubscriptions(
        "cmhazc4rl1vkand1eonnmiyjy",
      );
      expect(subscriptions[0]).toMatchObject({
        blue_webhook_id: "webhook_existing",
        enabled: 1,
        status: "HEALTHY",
        secret_ref: "stored-secret",
      });
    } finally {
      vi.doUnmock("../../../src/modules/blue/graphql/client.js");
      env.cleanup();
    }
  });
});
