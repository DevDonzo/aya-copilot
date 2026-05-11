import { sql } from "kysely";
import { db } from "../kysely.js";
import { normalizeCacheQuery } from "./helpers.js";

export async function replaceBlueListsCache(input: {
  workspaceId: string;
  items: Array<{
    id: string;
    title: string;
    normalizedTitle: string;
    stageKey?: string;
    stageLabel?: string;
    taskCount?: number;
    position?: number;
    updatedAt?: string | null;
  }>;
}) {
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("blue_lists_cache")
      .where("workspace_id", "=", input.workspaceId)
      .execute();

    for (const item of input.items) {
      await trx
        .insertInto("blue_lists_cache")
        .values({
          id: item.id,
          workspace_id: input.workspaceId,
          title: item.title,
          normalized_title: item.normalizedTitle,
          stage_key: item.stageKey ?? null,
          stage_label: item.stageLabel ?? null,
          task_count: item.taskCount ?? null,
          position: item.position ?? null,
          updated_at: item.updatedAt ?? null,
          deleted_at: null,
          synced_at: new Date().toISOString(),
        })
        .execute();
    }
  });
}

export async function replaceBlueRecordsCache(input: {
  workspaceId: string;
  items: Array<{
    id: string;
    listId: string;
    listTitle: string;
    title: string;
    normalizedTitle: string;
    contactEmail?: string | null;
    normalizedContactEmail?: string | null;
    contactPhone?: string | null;
    normalizedContactPhone?: string | null;
    status?: string;
    dueAt?: string;
    updatedAt?: string | null;
    archived?: boolean;
    done?: boolean;
    rawJson?: string | null;
  }>;
}) {
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("blue_records_cache")
      .where("workspace_id", "=", input.workspaceId)
      .execute();

    for (const item of input.items) {
      await trx
        .insertInto("blue_records_cache")
        .values({
          id: item.id,
          workspace_id: input.workspaceId,
          list_id: item.listId,
          list_title: item.listTitle,
          title: item.title,
          normalized_title: item.normalizedTitle,
          contact_email: item.contactEmail ?? null,
          normalized_contact_email: item.normalizedContactEmail ?? null,
          contact_phone: item.contactPhone ?? null,
          normalized_contact_phone: item.normalizedContactPhone ?? null,
          status: item.status ?? null,
          due_at: item.dueAt ?? null,
          updated_at: item.updatedAt ?? null,
          archived: item.archived ? 1 : 0,
          done: item.done ? 1 : 0,
          raw_json: item.rawJson ?? null,
          deleted_at: null,
          synced_at: new Date().toISOString(),
        })
        .execute();
    }
  });
}

export async function upsertBlueListsCache(input: {
  workspaceId: string;
  items: Array<{
    id: string;
    title: string;
    normalizedTitle: string;
    position?: number;
    updatedAt?: string | null;
  }>;
}) {
  for (const item of input.items) {
    await db
      .insertInto("blue_lists_cache")
      .values({
        id: item.id,
        workspace_id: input.workspaceId,
        title: item.title,
        normalized_title: item.normalizedTitle,
        position: item.position ?? null,
        updated_at: item.updatedAt ?? null,
        deleted_at: null,
        synced_at: new Date().toISOString(),
      })
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          title: item.title,
          normalized_title: item.normalizedTitle,
          position: item.position ?? null,
          updated_at: item.updatedAt ?? null,
          deleted_at: null,
          synced_at: new Date().toISOString(),
        }),
      )
      .execute();
  }
}

export async function upsertBlueRecordsCache(input: {
  workspaceId: string;
  items: Array<{
    id: string;
    listId: string;
    listTitle: string;
    title: string;
    normalizedTitle: string;
    contactEmail?: string | null;
    normalizedContactEmail?: string | null;
    contactPhone?: string | null;
    normalizedContactPhone?: string | null;
    status?: string | null;
    dueAt?: string | null;
    updatedAt?: string | null;
    archived?: boolean;
    done?: boolean;
    rawJson?: string | null;
  }>;
}) {
  for (const item of input.items) {
    await db
      .insertInto("blue_records_cache")
      .values({
        id: item.id,
        workspace_id: input.workspaceId,
        list_id: item.listId,
        list_title: item.listTitle,
        title: item.title,
        normalized_title: item.normalizedTitle,
        contact_email: item.contactEmail ?? null,
        normalized_contact_email: item.normalizedContactEmail ?? null,
        contact_phone: item.contactPhone ?? null,
        normalized_contact_phone: item.normalizedContactPhone ?? null,
        status: item.status ?? null,
        due_at: item.dueAt ?? null,
        updated_at: item.updatedAt ?? null,
        archived: item.archived ? 1 : 0,
        done: item.done ? 1 : 0,
        raw_json: item.rawJson ?? null,
        deleted_at: null,
        synced_at: new Date().toISOString(),
      })
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          list_id: item.listId,
          list_title: item.listTitle,
          title: item.title,
          normalized_title: item.normalizedTitle,
          contact_email: item.contactEmail ?? null,
          normalized_contact_email: item.normalizedContactEmail ?? null,
          contact_phone: item.contactPhone ?? null,
          normalized_contact_phone: item.normalizedContactPhone ?? null,
          status: item.status ?? null,
          due_at: item.dueAt ?? null,
          updated_at: item.updatedAt ?? null,
          archived: item.archived ? 1 : 0,
          done: item.done ? 1 : 0,
          raw_json: item.rawJson ?? null,
          deleted_at: null,
          synced_at: new Date().toISOString(),
        }),
      )
      .execute();
  }
}

export async function softDeleteMissingBlueRecords(
  workspaceId: string,
  keepIds: string[],
) {
  let query = db
    .updateTable("blue_records_cache")
    .set({
      deleted_at: new Date().toISOString(),
    })
    .where("workspace_id", "=", workspaceId)
    .where("deleted_at", "is", null);

  if (keepIds.length > 0) {
    query = query.where("id", "not in", keepIds);
  }

  await query.execute();
}

export async function softDeleteBlueRecordById(
  workspaceId: string,
  recordId: string,
) {
  await db
    .updateTable("blue_records_cache")
    .set({
      deleted_at: new Date().toISOString(),
    })
    .where("workspace_id", "=", workspaceId)
    .where("id", "=", recordId)
    .execute();
}

export async function listCachedBlueLists(workspaceId: string) {
  return await db
    .selectFrom("blue_lists_cache")
    .select([
      "id",
      "title",
      "normalized_title",
      "stage_key",
      "stage_label",
      "task_count",
      "position",
    ])
    .where("workspace_id", "=", workspaceId)
    .where("deleted_at", "is", null)
    .orderBy("position", "asc")
    .orderBy("title", "asc")
    .execute();
}

export async function searchCachedBlueRecords(
  workspaceId: string,
  query: string,
  limit = 5,
) {
  const normalized = normalizeCacheQuery(query);
  const exact = query.trim().toLowerCase();
  const compactDigits = query.replace(/\D+/g, "");
  const displayTitleSql = sql<string>`lower(title || ' (' || list_title || ')')`;
  return await db
    .selectFrom("blue_records_cache")
    .select([
      "id",
      "title",
      "list_id",
      "list_title",
      "normalized_title",
      "contact_email",
      "normalized_contact_email",
      "contact_phone",
      "normalized_contact_phone",
      "status",
      "due_at",
      "updated_at",
      "archived",
      "done",
    ])
    .where("workspace_id", "=", workspaceId)
    .where("deleted_at", "is", null)
    .where(({ eb, fn }) =>
      eb.or([
        eb(fn("lower", ["title"]), "=", exact),
        eb(fn("lower", ["title"]), "like", `%${exact}%`),
        eb(fn("lower", ["list_title"]), "=", exact),
        eb(fn("lower", ["list_title"]), "like", `%${exact}%`),
        eb(displayTitleSql, "=", exact),
        eb(displayTitleSql, "like", `%${exact}%`),
        eb("normalized_title", "like", `%${normalized}%`),
        eb("normalized_contact_email", "=", exact),
        eb("normalized_contact_email", "like", `%${exact}%`),
        ...(compactDigits
          ? [eb("normalized_contact_phone", "like", `%${compactDigits}%`)]
          : []),
      ]),
    )
    .orderBy(({ case: caseBuilder, fn }) =>
      caseBuilder()
        .when(fn("lower", ["title"]), "=", exact)
        .then(0)
        .when(displayTitleSql, "=", exact)
        .then(1)
        .when("normalized_contact_email", "=", exact)
        .then(2)
        .when("normalized_contact_phone", "=", compactDigits)
        .then(3)
        .when("normalized_title", "=", normalized)
        .then(4)
        .else(5)
        .end(),
    )
    .orderBy("title", "asc")
    .limit(limit)
    .execute();
}

export async function listCachedBlueRecords(workspaceId: string, limit = 25) {
  return await db
    .selectFrom("blue_records_cache")
    .select(["id", "title", "list_id", "list_title", "status", "due_at"])
    .where("workspace_id", "=", workspaceId)
    .where("deleted_at", "is", null)
    .orderBy("title", "asc")
    .limit(limit)
    .execute();
}

export async function listCachedBlueRecordsForInspection(workspaceId: string) {
  return await db
    .selectFrom("blue_records_cache")
    .select([
      "id",
      "title",
      "list_id",
      "list_title",
      "status",
      "due_at",
      "updated_at",
      "archived",
      "done",
      "raw_json",
    ])
    .where("workspace_id", "=", workspaceId)
    .where("deleted_at", "is", null)
    .orderBy("list_title", "asc")
    .orderBy("title", "asc")
    .execute();
}

export async function getCachedBlueRecordById(
  workspaceId: string,
  recordId: string,
) {
  return await db
    .selectFrom("blue_records_cache")
    .select([
      "id",
      "title",
      "list_id",
      "list_title",
      "status",
      "due_at",
      "updated_at",
      "archived",
      "done",
      "raw_json",
    ])
    .where("workspace_id", "=", workspaceId)
    .where("id", "=", recordId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
}
