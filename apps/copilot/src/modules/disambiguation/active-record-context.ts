import {
  deleteActiveRecordContext,
  getActiveRecordContext,
  upsertActiveRecordContext,
} from "../../db.js";
import type { EmployeeIdentity } from "../../domain/types.js";
import { normalizeCacheQuery } from "../db/repositories/helpers.js";
import {
  getCopilotMemoryForActor,
  rememberCopilotRecordContext,
} from "../copilot/memory.js";

const ACTIVE_RECORD_CONTEXT_TTL_MS = 2 * 60 * 60 * 1000;

export interface ActiveRecordContext {
  transport: string;
  recordId: string;
  recordTitle: string;
  listTitle?: string | null;
}

export async function rememberActiveRecordContext(input: {
  actor: EmployeeIdentity;
  transport: string;
  recordId: string;
  recordTitle: string;
  listTitle?: string | null;
}) {
  if (!input.actor.employeeId) {
    return;
  }

  await upsertActiveRecordContext({
    employeeId: input.actor.employeeId,
    transport: input.transport,
    recordId: input.recordId,
    recordTitle: input.recordTitle,
    listTitle: input.listTitle ?? null,
    expiresAt: new Date(Date.now() + ACTIVE_RECORD_CONTEXT_TTL_MS).toISOString(),
  });

  await rememberCopilotRecordContext({
    actor: input.actor,
    transport: input.transport,
    recordId: input.recordId,
    recordTitle: input.recordTitle,
    listTitle: input.listTitle ?? null,
  });
}

export async function clearActiveRecordContextForActor(
  actor: EmployeeIdentity,
  transport?: string,
) {
  if (!actor.employeeId) {
    return;
  }

  await deleteActiveRecordContext(actor.employeeId, transport);
}

export async function getActiveRecordContextForActor(
  actor: EmployeeIdentity,
  transport?: string,
): Promise<ActiveRecordContext | null> {
  if (!actor.employeeId) {
    return null;
  }

  const row = await getActiveRecordContext(actor.employeeId, transport);
  if (!row) {
    return await getMemoryRecordContext(actor, transport);
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await deleteActiveRecordContext(actor.employeeId, row.transport);
    return await getMemoryRecordContext(actor, transport);
  }

  if (transport && row.transport !== transport) {
    return await getMemoryRecordContext(actor, transport);
  }

  return {
    transport: row.transport,
    recordId: row.record_id,
    recordTitle: row.record_title,
    listTitle: row.list_title,
  };
}

async function getMemoryRecordContext(
  actor: EmployeeIdentity,
  transport?: string,
): Promise<ActiveRecordContext | null> {
  const memory = await getCopilotMemoryForActor(actor, transport);
  if (!memory?.currentRecordId || !memory.currentRecordTitle) {
    return null;
  }

  return {
    transport: memory.transport,
    recordId: memory.currentRecordId,
    recordTitle: memory.currentRecordTitle,
    listTitle: memory.currentListTitle ?? null,
  };
}

export function shouldUseActiveRecordContext(message: string) {
  const normalized = normalizeCacheQuery(message);
  return ACTIVE_RECORD_POINTERS.has(normalized);
}

const ACTIVE_RECORD_POINTERS = new Set([
  "this",
  "this client",
  "this file",
  "this lead",
  "this record",
  "it",
  "them",
  "that client",
  "that file",
  "that lead",
  "that record",
  "this one",
  "that one",
  "the client",
  "the file",
  "the lead",
  "the record",
  "current client",
  "current file",
]);
