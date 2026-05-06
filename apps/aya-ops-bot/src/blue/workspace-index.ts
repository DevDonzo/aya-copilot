import { config } from "../config.js";
import {
  getBlueSyncState,
  getCachedBlueRecordById,
  listCachedBlueLists,
  listCachedBlueRecords,
  replaceBlueListsCache,
  replaceBlueRecordsCache,
  searchCachedBlueRecords,
  softDeleteMissingBlueRecords,
  upsertBlueListsCache,
  upsertBlueRecordsCache,
  upsertBlueSyncState,
} from "../db.js";
import {
  fetchWorkspaceListRecords,
  fetchWorkspaceLists,
} from "../modules/blue/graphql/client.js";
import type { BlueRequestAuth } from "../domain/types.js";

interface ParsedBlueList {
  id: string;
  title: string;
  normalizedTitle: string;
  stageKey?: string;
  stageLabel?: string;
  taskCount?: number;
  position?: number;
  updatedAt?: string | null;
}

interface ParsedBlueRecord {
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
}

export async function syncWorkspaceIndex(input?: {
  forceFull?: boolean;
  auth?: BlueRequestAuth | null;
}) {
  const workspaceId = config.BLUE_READ_WORKSPACE_ID;
  const state = await getBlueSyncState(workspaceId, "records");
  const nowIso = new Date().toISOString();
  const fullReconcileMs =
    config.WORKSPACE_FULL_RECONCILE_HOURS * 60 * 60 * 1000;
  const shouldFullSync =
    Boolean(input?.forceFull) ||
    !state?.last_full_sync_at ||
    Date.now() - new Date(state.last_full_sync_at).getTime() >= fullReconcileMs;
  const safetyWindowIso = state?.last_seen_updated_at
    ? new Date(
        new Date(state.last_seen_updated_at).getTime() - 5 * 60 * 1000,
      ).toISOString()
    : null;

  const lists = await fetchWorkspaceLists({
    workspaceId,
    updatedAfter: shouldFullSync ? null : safetyWindowIso,
    auth: input?.auth,
  });
  const parsedLists = lists.map<ParsedBlueList>((list) => ({
    id: list.id,
    title: list.title,
    normalizedTitle: normalizeEntityText(list.title),
    position: list.position,
    updatedAt: list.updatedAt,
  }));

  const changedRecords: ParsedBlueRecord[] = [];
  const fullRecordIds: string[] = [];

  for (const list of lists) {
    const records = await fetchWorkspaceListRecords({
      workspaceId,
      listId: list.id,
      updatedAfter: shouldFullSync ? null : safetyWindowIso,
      auth: input?.auth,
    });

    for (const record of records) {
      const contact = extractRecordContact(record.customFields ?? []);
      changedRecords.push({
        id: record.id,
        listId: record.todoList.id,
        listTitle: record.todoList.title,
        title: record.title,
        normalizedTitle: normalizeEntityText(record.title),
        contactEmail: contact.email,
        normalizedContactEmail: normalizeEmail(contact.email),
        contactPhone: contact.phone,
        normalizedContactPhone: normalizePhone(contact.phone),
        status: record.archived
          ? "Archived"
          : record.done
            ? "Completed"
            : "Active",
        dueAt: record.duedAt ?? undefined,
        updatedAt: record.updatedAt,
        archived: record.archived,
        done: record.done,
        rawJson: JSON.stringify(record),
      });
      fullRecordIds.push(record.id);
    }
  }

  if (shouldFullSync) {
    await replaceBlueListsCache({
      workspaceId,
      items: parsedLists,
    });
    await replaceBlueRecordsCache({
      workspaceId,
      items: changedRecords,
    });
    await softDeleteMissingBlueRecords(workspaceId, fullRecordIds);
  } else {
    await upsertBlueListsCache({
      workspaceId,
      items: parsedLists,
    });
    await upsertBlueRecordsCache({
      workspaceId,
      items: changedRecords,
    });
  }

  const lastSeenUpdatedAt =
    [
      ...lists.map((item) => item.updatedAt),
      ...changedRecords.map((item) => item.updatedAt ?? null),
    ]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ??
    state?.last_seen_updated_at ??
    null;

  await upsertBlueSyncState({
    workspaceId,
    entityType: "records",
    lastFullSyncAt: shouldFullSync
      ? nowIso
      : (state?.last_full_sync_at ?? null),
    lastIncrementalSyncAt: nowIso,
    lastSeenUpdatedAt,
  });

  return {
    workspaceId,
    mode: shouldFullSync ? "full" : "incremental",
    listsSynced: parsedLists.length,
    recordsSynced: changedRecords.length,
    lastSeenUpdatedAt,
  };
}

export async function resolveListQuery(query: string) {
  const normalizedQuery = normalizeEntityText(query);
  const lists = await listCachedBlueLists(config.BLUE_READ_WORKSPACE_ID);

  const scored = lists
    .map((list) => ({
      ...list,
      score: scoreListMatch(list, normalizedQuery),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title),
    );

  if (scored.length === 0) {
    return null;
  }

  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return {
      match: null,
      candidates: scored.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
      })),
    };
  }

  return {
    match: {
      id: scored[0].id,
      title: scored[0].title,
    },
    candidates: [],
  };
}

export async function resolveRecordQuery(query: string) {
  const matches = (
    await searchCachedBlueRecords(config.BLUE_READ_WORKSPACE_ID, query, 5)
  ).map((record) => ({
    ...record,
    score: scoreRecordMatch(
      record.title,
      record.list_title,
      record.normalized_title,
      record.normalized_contact_email,
      record.normalized_contact_phone,
      query,
    ),
  }));

  const filtered = matches
    .filter((record) => record.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title),
    );

  if (filtered.length === 0) {
    return null;
  }

  if (filtered.length > 1 && filtered[0].score === filtered[1].score) {
    return {
      match: null,
      candidates: filtered.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        listTitle: item.list_title,
      })),
    };
  }

  return {
    match: {
      id: filtered[0].id,
      title: filtered[0].title,
      listId: filtered[0].list_id,
      listTitle: filtered[0].list_title,
    },
    candidates: [],
  };
}

export async function searchRecordQuery(query: string, limit = 5) {
  return (
    await searchCachedBlueRecords(config.BLUE_READ_WORKSPACE_ID, query, limit)
  ).map((record) => ({
    id: record.id,
    title: record.title,
    listTitle: record.list_title,
    status: record.status,
    dueAt: record.due_at,
  }));
}

export async function listIndexedRecords(limit = 25) {
  return (await listCachedBlueRecords(config.BLUE_READ_WORKSPACE_ID, limit)).map(
    (record) => ({
      id: record.id,
      title: record.title,
      listTitle: record.list_title,
      status: record.status,
      dueAt: record.due_at,
    }),
  );
}

export async function getIndexedRecord(recordId: string) {
  const record = await getCachedBlueRecordById(
    config.BLUE_READ_WORKSPACE_ID,
    recordId,
  );
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    title: record.title,
    listId: record.list_id,
    listTitle: record.list_title,
    status: record.status,
    dueAt: record.due_at,
  };
}

function normalizeEntityText(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmail(input?: string | null) {
  const value = input?.trim().toLowerCase();
  return value || null;
}

function normalizePhone(input?: string | null) {
  const digits = input?.replace(/\D+/g, "");
  return digits || null;
}

function extractRecordContact(
  fields: Array<{ name?: string | null; value?: unknown }>,
) {
  let email: string | null = null;
  let phone: string | null = null;

  for (const field of fields) {
    const label = String(field.name ?? "")
      .trim()
      .toLowerCase();
    const value = normalizeFieldValue(field.value);
    if (!value) {
      continue;
    }

    if (label === "email") {
      email = value;
    } else if (label === "phone") {
      phone = value;
    }
  }

  return { email, phone };
}

function normalizeFieldValue(value: unknown) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value === "(empty)" ? "" : value.trim();
  }
  return JSON.stringify(value);
}

function scoreListMatch(
  list: { title: string; normalized_title: string | null },
  normalizedQuery: string,
) {
  if (list.normalized_title === normalizedQuery) {
    return 100;
  }
  if (list.title.toLowerCase() === normalizedQuery) {
    return 95;
  }
  if (list.normalized_title?.includes(normalizedQuery)) {
    return 80;
  }
  if (list.title.toLowerCase().includes(normalizedQuery)) {
    return 70;
  }
  return 0;
}

function scoreRecordMatch(
  title: string,
  listTitle: string,
  normalizedTitle: string,
  normalizedContactEmail: string | null,
  normalizedContactPhone: string | null,
  rawQuery: string,
) {
  const normalizedQuery = normalizeEntityText(rawQuery);
  const normalizedPhoneQuery = rawQuery.replace(/\D+/g, "");
  const displayTitle = `${title} (${listTitle})`;
  const normalizedDisplayTitle = normalizeEntityText(displayTitle);
  if (
    normalizedContactEmail &&
    normalizedContactEmail === rawQuery.trim().toLowerCase()
  ) {
    return 98;
  }
  if (
    normalizedContactPhone &&
    normalizedPhoneQuery &&
    normalizedContactPhone === normalizedPhoneQuery
  ) {
    return 97;
  }
  if (normalizedTitle === normalizedQuery) {
    return 100;
  }
  if (normalizedDisplayTitle === normalizedQuery) {
    return 99;
  }
  if (title.toLowerCase() === rawQuery.trim().toLowerCase()) {
    return 95;
  }
  if (displayTitle.toLowerCase() === rawQuery.trim().toLowerCase()) {
    return 94;
  }
  if (normalizedTitle.includes(normalizedQuery)) {
    return 80;
  }
  if (normalizedDisplayTitle.includes(normalizedQuery)) {
    return 79;
  }
  if (
    normalizedContactEmail &&
    normalizedContactEmail.includes(rawQuery.trim().toLowerCase())
  ) {
    return 78;
  }
  if (
    normalizedContactPhone &&
    normalizedPhoneQuery &&
    normalizedContactPhone.includes(normalizedPhoneQuery)
  ) {
    return 77;
  }
  if (title.toLowerCase().includes(rawQuery.trim().toLowerCase())) {
    return 70;
  }
  if (displayTitle.toLowerCase().includes(rawQuery.trim().toLowerCase())) {
    return 69;
  }
  return 0;
}
