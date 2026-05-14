import type { FastifyPluginAsync } from "fastify";

import { config } from "../config.js";
import { listBlueSyncStates, listBlueWebhookSubscriptions } from "../db.js";
import { getBluePollerStatus } from "../jobs/blue-poller.js";
import { checkBlueApiConnectivity } from "../modules/blue/graphql/client.js";
import { sqlite } from "../modules/db/kysely.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    const timestamp = new Date().toISOString();
    const database = { ok: false };
    const blueApi = { ok: false };
    const freshness = await getFreshnessStatus();

    try {
      sqlite.prepare("select 1 as ok").get();
      database.ok = true;
    } catch {
      database.ok = false;
    }

    try {
      await checkBlueApiConnectivity(config.BLUE_READ_WORKSPACE_ID);
      blueApi.ok = true;
    } catch {
      blueApi.ok = false;
    }

    const ok = database.ok && blueApi.ok;
    return reply.code(ok ? 200 : 503).send({
      ok,
      timestamp,
      database,
      blueApi,
      freshness,
    });
  });
};

async function getFreshnessStatus() {
  const [syncStates, webhookSubscriptions] = await Promise.all([
    listBlueSyncStates(config.BLUE_WORKSPACE_ID).catch(() => []),
    listBlueWebhookSubscriptions(config.BLUE_WORKSPACE_ID).catch(() => []),
  ]);
  const webhookState = syncStates.find((state) => state.entity_type === "webhooks");
  const activityState = syncStates.find((state) => state.entity_type === "activity");
  const recordsState = syncStates.find((state) => state.entity_type === "records");
  const enabledWebhook = webhookSubscriptions.find((subscription) => subscription.enabled);

  return {
    webhooksPrimary: Boolean(config.BLUE_WEBHOOK_PUBLIC_URL),
    lastWebhookReceivedAt:
      webhookState?.last_webhook_event_at ??
      activityState?.last_webhook_event_at ??
      null,
    lastReconciliationAt:
      getBluePollerStatus().lastReconciliationAt ??
      recordsState?.last_incremental_sync_at ??
      activityState?.last_incremental_sync_at ??
      null,
    poller: getBluePollerStatus(),
    webhookRegistration: {
      configured: Boolean(config.BLUE_WEBHOOK_PUBLIC_URL),
      registered: Boolean(enabledWebhook),
      status: enabledWebhook?.status ?? null,
      enabled: Boolean(enabledWebhook?.enabled),
      updatedAt: enabledWebhook?.updated_at ?? null,
    },
  };
}
