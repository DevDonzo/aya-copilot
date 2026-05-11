import { db } from "../kysely.js";

export async function upsertBlueWebhookSubscription(input: {
  id: string;
  workspaceId: string;
  blueWebhookId: string;
  url: string;
  eventsJson: string;
  status?: string | null;
  secretRef?: string | null;
  enabled: boolean;
}) {
  const now = new Date().toISOString();
  await db
    .insertInto("blue_webhook_subscriptions")
    .values({
      id: input.id,
      workspace_id: input.workspaceId,
      blue_webhook_id: input.blueWebhookId,
      url: input.url,
      events_json: input.eventsJson,
      status: input.status ?? null,
      secret_ref: input.secretRef ?? null,
      enabled: input.enabled ? 1 : 0,
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict.column("blue_webhook_id").doUpdateSet({
        url: input.url,
        events_json: input.eventsJson,
        status: input.status ?? null,
        secret_ref: input.secretRef ?? null,
        enabled: input.enabled ? 1 : 0,
        updated_at: now,
      }),
    )
    .execute();
}

export async function listBlueWebhookSubscriptions(workspaceId: string) {
  return await db
    .selectFrom("blue_webhook_subscriptions")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .orderBy("updated_at", "desc")
    .execute();
}
