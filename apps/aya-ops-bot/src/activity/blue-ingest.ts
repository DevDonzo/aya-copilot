import {
  createId,
  ensureEmployee,
  getBlueSyncState,
  upsertBlueSyncState,
  upsertIdentityLink,
} from "../db.js";
import { fetchWorkspaceActivity } from "../modules/blue/graphql/client.js";
import { insertActivityEvent } from "../store/activity-store.js";
import type { BlueActivityEvent } from "../types/blue.js";
import type { NormalizedActivityEvent } from "../domain/types.js";
import { config } from "../config.js";

function formatUser(user?: {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
} | null) {
  if (!user) {
    return "Unknown";
  }
  return (
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.email ||
    user.id
  );
}

function normalizeBlueActivityItem(item: BlueActivityEvent): NormalizedActivityEvent {
  return {
    id: `blue_${item.id}`,
    employeeId: item.createdBy?.id,
    workspaceId: item.project?.id,
    projectName: item.project?.name,
    source: "blue",
    sourceEventId: item.id,
    actionType: item.category,
    entityType: item.todo ? "record" : item.comment ? "comment" : "activity",
    entityId: item.todo?.id ?? item.comment?.id,
    entityTitle: item.todo?.title ?? item.comment?.text,
    occurredAt: item.createdAt,
    summary:
      item.todo?.title ||
      item.comment?.text ||
      item.html ||
      `${formatUser(item.createdBy)} ${item.category}`,
    rawPayload: item,
  };
}

export async function ingestBlueActivity(limit = 100) {
  const workspaceId = config.BLUE_READ_WORKSPACE_ID;
  const state = await getBlueSyncState(workspaceId, "activity");
  const startDate = state?.last_seen_updated_at
    ? new Date(
        new Date(state.last_seen_updated_at).getTime() - 5 * 60 * 1000,
      ).toISOString()
    : null;
  const items = await fetchWorkspaceActivity({
    workspaceId,
    limit,
    startDate,
  });
  let inserted = 0;

  for (const item of items) {
    if (item.createdBy?.id) {
      await ensureEmployee({
        employeeId: item.createdBy.id,
        displayName: formatUser(item.createdBy),
        email: item.createdBy.email,
        timezone: item.createdBy.timezone ?? "America/Toronto",
      });

      await upsertIdentityLink({
        id: createId("ident"),
        employeeId: item.createdBy.id,
        source: "blue",
        externalId: item.createdBy.id,
        externalLabel: formatUser(item.createdBy),
      });

      if (item.createdBy.email) {
        await upsertIdentityLink({
          id: createId("ident"),
          employeeId: item.createdBy.id,
          source: "email",
          externalId: item.createdBy.email,
          externalLabel: formatUser(item.createdBy),
        });
      }
    }

    if (await insertActivityEvent(normalizeBlueActivityItem(item))) {
      inserted += 1;
    }
  }

  const lastSeenUpdatedAt =
    items
      .map((item) => item.updatedAt || item.createdAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? state?.last_seen_updated_at ?? null;

  await upsertBlueSyncState({
    workspaceId,
    entityType: "activity",
    lastIncrementalSyncAt: new Date().toISOString(),
    lastSeenUpdatedAt,
  });

  return {
    fetched: items.length,
    inserted,
    startDate,
    lastSeenUpdatedAt,
  };
}
