import crypto from "node:crypto";

import { config } from "../../../config.js";
import {
  createId,
  ensureEmployee,
  insertActivityEvent,
  listBlueWebhookSubscriptions,
  softDeleteBlueRecordById,
  upsertBlueListsCache,
  upsertBlueRecordsCache,
  upsertBlueSyncState,
  upsertBlueWebhookSubscription,
  upsertIdentityLink,
} from "../../../db.js";
import { ValidationError, AuthError } from "../../../app/errors.js";
import { webhookEnvelopeSchema } from "../../../types/api.js";
import {
  createOrUpdateWebhook,
  deleteWebhook,
  fetchRecordDetail,
} from "../graphql/client.js";
import type { BlueWebhookEventType } from "../../../types/blue.js";
import { canonicalizeBlueEmployee } from "../../../blue/employee-identity.js";

const supportedEvents: BlueWebhookEventType[] = [
  "TODO_CREATED",
  "TODO_DELETED",
  "TODO_MOVED",
  "TODO_NAME_CHANGED",
  "TODO_DONE_STATUS_UPDATED",
  "TODO_DUE_DATE_ADDED",
  "TODO_DUE_DATE_UPDATED",
  "TODO_DUE_DATE_REMOVED",
  "TODO_ASSIGNEE_ADDED",
  "TODO_ASSIGNEE_REMOVED",
  "TODO_TAG_ADDED",
  "TODO_TAG_REMOVED",
  "TODO_CUSTOM_FIELD_UPDATED",
  "TODO_CHECKLIST_ITEM_CREATED",
  "TODO_CHECKLIST_ITEM_DELETED",
  "TODO_CHECKLIST_ITEM_DUE_DATE_ADDED",
  "TODO_CHECKLIST_ITEM_DUE_DATE_UPDATED",
  "TODO_CHECKLIST_ITEM_DUE_DATE_REMOVED",
  "TODO_CHECKLIST_ITEM_DONE_STATUS_UPDATED",
  "TODO_CHECKLIST_ITEM_ASSIGNEE_ADDED",
  "TODO_CHECKLIST_ITEM_ASSIGNEE_REMOVED",
  "COMMENT_CREATED",
  "COMMENT_UPDATED",
  "COMMENT_DELETED",
];

export async function verifyAndProcessBlueWebhook(input: {
  rawBody: string;
  signature?: string | string[];
}) {
  const payload = JSON.parse(input.rawBody) as Record<string, unknown>;
  const parsedEnvelope = webhookEnvelopeSchema.parse(payload);
  const eventName = parsedEnvelope.event ?? parsedEnvelope.type ?? "UNKNOWN";
  if (eventName === "WEBHOOK_HEALTH_CHECK") {
    return { ok: true, healthCheck: true };
  }

  const signature = Array.isArray(input.signature)
    ? input.signature[0]
    : input.signature;
  const secret = await resolveWebhookSecret();
  if (!secret) {
    throw new AuthError("BLUE_WEBHOOK_SECRET is not configured");
  }

  const hashBuffer = crypto
    .createHmac("sha256", secret)
    .update(input.rawBody)
    .digest();
  const signatureBuffer = parseSignature(signature);
  if (
    !signatureBuffer ||
    signatureBuffer.length !== hashBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, signatureBuffer)
  ) {
    throw new AuthError("Invalid webhook signature");
  }

  const eventData = isRecord(payload.data) ? payload.data : {};
  const eventMeta = extractWebhookMeta(eventName, eventData, payload);
  const actorEmployeeId = await maybeEnsureWebhookActor(eventMeta.actor);

  if (eventName.startsWith("TODO_")) {
    await repairTodoCacheFromWebhook(eventName, eventMeta);
  } else if (eventName.startsWith("COMMENT_")) {
    await repairCommentCacheFromWebhook(eventMeta);
  }

  await insertActivityEvent({
    id: createId("evt"),
    employeeId: actorEmployeeId,
    source: "blue_webhook",
    sourceEventId: eventMeta.eventId ?? undefined,
    actionType: eventName,
    entityType: eventMeta.entityType,
    entityId: eventMeta.entityId ?? undefined,
    entityTitle: eventMeta.entityTitle,
    occurredAt: eventMeta.occurredAt,
    summary: eventMeta.summary,
    rawPayload: payload,
  });

  const syncTimestamp = new Date().toISOString();
  await Promise.all([
    upsertBlueSyncState({
      workspaceId: config.BLUE_WORKSPACE_ID,
      entityType: "activity",
      lastIncrementalSyncAt: syncTimestamp,
      lastWebhookEventAt: eventMeta.occurredAt,
      lastSeenUpdatedAt: eventMeta.occurredAt,
    }),
    upsertBlueSyncState({
      workspaceId: config.BLUE_WORKSPACE_ID,
      entityType: "webhooks",
      lastIncrementalSyncAt: syncTimestamp,
      lastWebhookEventAt: eventMeta.occurredAt,
      lastSeenUpdatedAt: eventMeta.occurredAt,
    }),
  ]);

  return {
    ok: true,
    event: eventName,
    entityId: eventMeta.entityId ?? undefined,
  };
}

export async function registerBlueWebhookIfConfigured() {
  if (!config.BLUE_WEBHOOK_PUBLIC_URL) {
    return null;
  }

  const existing = await listBlueWebhookSubscriptions(config.BLUE_WORKSPACE_ID);
  const existingSubscription =
    existing.find((item) => item.url === config.BLUE_WEBHOOK_PUBLIC_URL) ??
    existing[0];
  let existingWebhookId: string | undefined =
    existingSubscription?.blue_webhook_id ?? undefined;

  if (
    existingWebhookId &&
    !config.BLUE_WEBHOOK_SECRET &&
    !existingSubscription?.secret_ref
  ) {
    await deleteWebhook(existingWebhookId);
    await upsertBlueWebhookSubscription({
      id: existingSubscription.id,
      workspaceId: config.BLUE_WORKSPACE_ID,
      blueWebhookId: existingWebhookId,
      url: existingSubscription.url,
      eventsJson: existingSubscription.events_json,
      status: "DELETED",
      secretRef: null,
      enabled: false,
    });
    existingWebhookId = undefined;
  }

  const { webhook, secret } = await createOrUpdateWebhook({
    workspaceId: config.BLUE_WORKSPACE_ID,
    url: config.BLUE_WEBHOOK_PUBLIC_URL,
    events: supportedEvents,
    existingWebhookId,
  });

  await upsertBlueWebhookSubscription({
    id: createId("whsub"),
    workspaceId: config.BLUE_WORKSPACE_ID,
    blueWebhookId: webhook.id,
    url: webhook.url,
    eventsJson: JSON.stringify(webhook.events),
    status: webhook.status,
    secretRef:
      secret ??
      (config.BLUE_WEBHOOK_SECRET || existingSubscription?.secret_ref || null),
    enabled: webhook.enabled,
  });

  return webhook;
}

async function resolveWebhookSecret() {
  if (config.BLUE_WEBHOOK_SECRET) {
    return config.BLUE_WEBHOOK_SECRET;
  }

  const subscriptions = await listBlueWebhookSubscriptions(config.BLUE_WORKSPACE_ID);
  return (
    subscriptions.find((item) => item.enabled && item.secret_ref)?.secret_ref ??
    subscriptions[0]?.secret_ref ??
    null
  );
}

async function repairTodoCacheFromWebhook(
  eventName: string,
  eventMeta: ReturnType<typeof extractWebhookMeta>,
) {
  if (!eventMeta.todoId) {
    return;
  }

  if (eventName === "TODO_DELETED") {
    await softDeleteBlueRecordById(config.BLUE_WORKSPACE_ID, eventMeta.todoId);
    return;
  }

  await refreshRecordCache(eventMeta.todoId);
}

async function repairCommentCacheFromWebhook(
  eventMeta: ReturnType<typeof extractWebhookMeta>,
) {
  if (!eventMeta.todoId) {
    return;
  }

  await refreshRecordCache(eventMeta.todoId);
}

async function refreshRecordCache(recordId: string) {
  const { record } = await fetchRecordDetail(
    config.BLUE_WORKSPACE_ID,
    recordId,
  );
  if (!record) {
    await softDeleteBlueRecordById(config.BLUE_WORKSPACE_ID, recordId);
    return;
  }

  await upsertBlueListsCache({
    workspaceId: config.BLUE_WORKSPACE_ID,
    items: [
      {
        id: record.todoList.id,
        title: record.todoList.title,
        normalizedTitle: normalizeEntityText(record.todoList.title),
        position: record.todoList.position,
        updatedAt: record.todoList.updatedAt,
      },
    ],
  });

  await upsertBlueRecordsCache({
    workspaceId: config.BLUE_WORKSPACE_ID,
    items: [
      {
        id: record.id,
        listId: record.todoList.id,
        listTitle: record.todoList.title,
        title: record.title,
        normalizedTitle: normalizeEntityText(record.title),
        contactEmail: extractContactEmail(record.customFields ?? []),
        normalizedContactEmail: normalizeEmail(
          extractContactEmail(record.customFields ?? []),
        ),
        contactPhone: extractContactPhone(record.customFields ?? []),
        normalizedContactPhone: normalizePhone(
          extractContactPhone(record.customFields ?? []),
        ),
        status: record.archived
          ? "Archived"
          : record.done
            ? "Completed"
            : "Active",
        dueAt: record.duedAt ?? null,
        updatedAt: record.updatedAt,
        archived: record.archived,
        done: record.done,
        rawJson: JSON.stringify(record),
      },
    ],
  });

  await upsertBlueSyncState({
    workspaceId: config.BLUE_WORKSPACE_ID,
    entityType: "records",
    lastIncrementalSyncAt: new Date().toISOString(),
    lastSeenUpdatedAt: record.updatedAt,
  });
}

async function maybeEnsureWebhookActor(
  actor: {
    id: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    timezone?: string | null;
  } | null,
) {
  if (!actor?.id) {
    return undefined;
  }

  const displayName =
    actor.fullName ||
    [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim() ||
    actor.email ||
    actor.id;
  const employee = canonicalizeBlueEmployee({ ...actor, fullName: displayName });

  await ensureEmployee({
    employeeId: employee.employeeId,
    displayName: employee.displayName,
    email: employee.email,
    timezone: employee.timezone,
  });

  await upsertIdentityLink({
    id: createId("ident"),
    employeeId: employee.employeeId,
    source: "blue",
    externalId: actor.id,
    externalLabel: employee.originalDisplayName,
  });

  if (employee.email) {
    await upsertIdentityLink({
      id: createId("ident"),
      employeeId: employee.employeeId,
      source: "email",
      externalId: employee.email,
      externalLabel: employee.displayName,
    });
  }

  return employee.employeeId;
}

function extractWebhookMeta(
  eventName: string,
  data: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const actor = findNestedUser(data) ?? findNestedUser(payload) ?? null;
  const todo = findNestedTodo(data) ?? findNestedTodo(payload);
  const comment = findNestedComment(data) ?? findNestedComment(payload);
  const occurredAt =
    firstString(
      data.updatedAt,
      data.createdAt,
      payload.updatedAt,
      payload.createdAt,
    ) ?? new Date().toISOString();
  const eventId =
    firstString(data.id, payload.id, comment?.id, todo?.id) ??
    `${eventName}_${occurredAt}`;
  const entityId = comment?.id ?? todo?.id ?? null;
  const entityType = comment?.id ? "comment" : todo?.id ? "record" : "activity";
  const entityTitle =
    firstString(comment?.text, todo?.title, eventName) ?? eventName;
  const summary =
    firstString(data.summary, payload.summary, comment?.text, todo?.title) ??
    `${eventName} in Blue`;

  return {
    eventId,
    occurredAt,
    entityId,
    entityType,
    entityTitle,
    summary,
    actor,
    todoId: todo?.id ?? comment?.todoId ?? null,
  };
}

function extractContactEmail(
  fields: Array<{ name?: string | null; value?: unknown }>,
) {
  return extractContactField(fields, "email");
}

function extractContactPhone(
  fields: Array<{ name?: string | null; value?: unknown }>,
) {
  return extractContactField(fields, "phone");
}

function extractContactField(
  fields: Array<{ name?: string | null; value?: unknown }>,
  targetLabel: string,
) {
  for (const field of fields) {
    const label = String(field.name ?? "")
      .trim()
      .toLowerCase();
    if (label !== targetLabel) {
      continue;
    }

    const value = normalizeFieldValue(field.value);
    if (value) {
      return value;
    }
  }

  return null;
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

function normalizeEmail(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizePhone(value?: string | null) {
  const normalized = value?.replace(/\D+/g, "");
  return normalized || null;
}

function findNestedUser(value: unknown) {
  for (const candidate of findObjectCandidates(value)) {
    const id = firstString(
      candidate.id,
      candidate.userId,
      candidate.createdById,
    );
    const email = firstString(candidate.email);
    const fullName = firstString(candidate.fullName, candidate.name);
    const firstName = firstString(candidate.firstName);
    const lastName = firstString(candidate.lastName);
    if (!id && !email && !fullName) {
      continue;
    }
    return {
      id: id ?? email ?? fullName ?? "unknown",
      email: email ?? undefined,
      fullName: fullName ?? undefined,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      timezone: firstString(candidate.timezone) ?? null,
    };
  }
  return null;
}

function findNestedTodo(value: unknown) {
  for (const candidate of findObjectCandidates(value)) {
    const id = firstString(candidate.todoId, candidate.id, candidate.recordId);
    const title = firstString(candidate.title, candidate.name);
    if (!id) {
      continue;
    }
    return { id, title };
  }
  return null;
}

function findNestedComment(value: unknown) {
  for (const candidate of findObjectCandidates(value)) {
    const id = firstString(candidate.commentId, candidate.id);
    const text = firstString(candidate.text, candidate.body, candidate.comment);
    const todoId = firstString(
      candidate.todoId,
      candidate.categoryId,
      candidate.recordId,
    );
    if (!id && !text) {
      continue;
    }
    return { id: id ?? todoId ?? "unknown", text, todoId };
  }
  return null;
}

function findObjectCandidates(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value)) {
    return [];
  }

  const candidates = [value];
  const nestedKeys = [
    "data",
    "event",
    "payload",
    "todo",
    "record",
    "comment",
    "user",
    "createdBy",
    "actor",
  ];

  for (const key of nestedKeys) {
    const nestedValue = value[key];
    if (isRecord(nestedValue)) {
      candidates.push(nestedValue);
    }
  }

  return candidates;
}

function parseSignature(signature?: string | string[]) {
  const raw = Array.isArray(signature) ? signature[0] : signature;
  if (!raw) {
    return null;
  }

  const normalized = raw.startsWith("sha256=")
    ? raw.slice("sha256=".length)
    : raw;
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new ValidationError("Invalid webhook signature format");
  }

  return Buffer.from(normalized, "hex");
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEntityText(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
