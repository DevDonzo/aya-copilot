import {
  deleteCopilotMemory,
  getCopilotMemory,
  upsertCopilotMemory,
} from "../../db.js";
import type { EmployeeIdentity, IntentName } from "../../domain/types.js";

const COPILOT_MEMORY_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_RECENT_RECORDS = 5;
const MAX_TEXT_LENGTH = 1200;

export interface CopilotRecordMemory {
  recordId: string;
  recordTitle: string;
  listTitle?: string | null;
  observedAt: string;
}

export interface CopilotMemorySnapshot {
  transport: string;
  currentRecordId?: string | null;
  currentRecordTitle?: string | null;
  currentListTitle?: string | null;
  recentRecords: CopilotRecordMemory[];
  lastIntent?: string | null;
  lastMessageText?: string | null;
  lastResponseText?: string | null;
  expiresAt?: string | null;
}

export async function getCopilotMemoryForActor(
  actor: EmployeeIdentity,
  transport?: string,
): Promise<CopilotMemorySnapshot | null> {
  if (!actor.employeeId) {
    return null;
  }

  const row = await getCopilotMemory(actor.employeeId, transport);
  if (!row) {
    return null;
  }

  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    await deleteCopilotMemory(actor.employeeId, transport);
    return null;
  }

  if (transport && row.transport !== transport) {
    return null;
  }

  return {
    transport: row.transport,
    currentRecordId: row.current_record_id,
    currentRecordTitle: row.current_record_title,
    currentListTitle: row.current_list_title,
    recentRecords: parseRecentRecords(row.recent_records_json),
    lastIntent: row.last_intent,
    lastMessageText: row.last_message_text,
    lastResponseText: row.last_response_text,
    expiresAt: row.expires_at,
  };
}

export async function rememberCopilotRecordContext(input: {
  actor: EmployeeIdentity;
  transport: string;
  recordId: string;
  recordTitle: string;
  listTitle?: string | null;
}) {
  if (!input.actor.employeeId) {
    return;
  }

  const current = await getCopilotMemoryForActor(input.actor, input.transport);
  const nextRecentRecords = mergeRecentRecords(current?.recentRecords ?? [], {
    recordId: input.recordId,
    recordTitle: input.recordTitle,
    listTitle: input.listTitle ?? null,
    observedAt: new Date().toISOString(),
  });

  await upsertCopilotMemory({
    employeeId: input.actor.employeeId,
    transport: input.transport,
    conversationKey: input.transport,
    currentRecordId: input.recordId,
    currentRecordTitle: input.recordTitle,
    currentListTitle: input.listTitle ?? null,
    recentRecordsJson: JSON.stringify(nextRecentRecords),
    lastIntent: current?.lastIntent ?? null,
    lastMessageText: current?.lastMessageText ?? null,
    lastResponseText: current?.lastResponseText ?? null,
    expiresAt: new Date(Date.now() + COPILOT_MEMORY_TTL_MS).toISOString(),
  });
}

export async function rememberCopilotTurnMemory(input: {
  actor: EmployeeIdentity;
  transport: string;
  intent?: IntentName | string | null;
  message: string;
  responseText: string;
}) {
  if (!input.actor.employeeId) {
    return;
  }

  const current = await getCopilotMemoryForActor(input.actor, input.transport);
  await upsertCopilotMemory({
    employeeId: input.actor.employeeId,
    transport: input.transport,
    conversationKey: input.transport,
    currentRecordId: current?.currentRecordId ?? null,
    currentRecordTitle: current?.currentRecordTitle ?? null,
    currentListTitle: current?.currentListTitle ?? null,
    recentRecordsJson: JSON.stringify(current?.recentRecords ?? []),
    lastIntent: input.intent ?? current?.lastIntent ?? null,
    lastMessageText: truncateText(input.message),
    lastResponseText: truncateText(input.responseText),
    expiresAt: new Date(Date.now() + COPILOT_MEMORY_TTL_MS).toISOString(),
  });
}

function mergeRecentRecords(
  records: CopilotRecordMemory[],
  next: CopilotRecordMemory,
) {
  return [next, ...records.filter((item) => item.recordId !== next.recordId)].slice(
    0,
    MAX_RECENT_RECORDS,
  );
}

function parseRecentRecords(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as CopilotRecordMemory[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            item &&
            typeof item.recordId === "string" &&
            typeof item.recordTitle === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function truncateText(value: string) {
  const normalized = value.trim();
  if (normalized.length <= MAX_TEXT_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}
