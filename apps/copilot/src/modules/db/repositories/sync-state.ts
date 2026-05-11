import { db } from "../kysely.js";

export async function getBlueSyncState(workspaceId: string, entityType: string) {
  return await db
    .selectFrom("blue_sync_state")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .where("entity_type", "=", entityType)
    .executeTakeFirst();
}

export async function listBlueSyncStates(workspaceId: string) {
  return await db
    .selectFrom("blue_sync_state")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .orderBy("entity_type", "asc")
    .execute();
}

export async function upsertBlueSyncState(input: {
  workspaceId: string;
  entityType: string;
  lastCursor?: string | null;
  lastFullSyncAt?: string | null;
  lastIncrementalSyncAt?: string | null;
  lastSeenUpdatedAt?: string | null;
  lastWebhookEventAt?: string | null;
}) {
  const now = new Date().toISOString();

  await db
    .insertInto("blue_sync_state")
    .values({
      workspace_id: input.workspaceId,
      entity_type: input.entityType,
      last_cursor: input.lastCursor ?? null,
      last_full_sync_at: input.lastFullSyncAt ?? null,
      last_incremental_sync_at: input.lastIncrementalSyncAt ?? null,
      last_seen_updated_at: input.lastSeenUpdatedAt ?? null,
      last_webhook_event_at: input.lastWebhookEventAt ?? null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict.columns(["workspace_id", "entity_type"]).doUpdateSet({
        last_cursor: input.lastCursor ?? null,
        last_full_sync_at: input.lastFullSyncAt ?? null,
        last_incremental_sync_at: input.lastIncrementalSyncAt ?? null,
        last_seen_updated_at: input.lastSeenUpdatedAt ?? null,
        last_webhook_event_at: input.lastWebhookEventAt ?? null,
        updated_at: now,
      }),
    )
    .execute();
}
