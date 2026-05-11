import { db } from "../kysely.js";

export async function getCopilotMemory(employeeId: string, transport?: string) {
  let query = db
    .selectFrom("copilot_memory")
    .selectAll()
    .where("employee_id", "=", employeeId);

  if (transport) {
    query = query.where("transport", "=", transport);
  }

  return await query
    .orderBy("updated_at", "desc")
    .executeTakeFirst();
}

export async function upsertCopilotMemory(input: {
  employeeId: string;
  transport: string;
  conversationKey?: string | null;
  currentRecordId?: string | null;
  currentRecordTitle?: string | null;
  currentListTitle?: string | null;
  recentRecordsJson: string;
  lastIntent?: string | null;
  lastMessageText?: string | null;
  lastResponseText?: string | null;
  expiresAt?: string | null;
}) {
  const nowIso = new Date().toISOString();

  await db
    .insertInto("copilot_memory")
    .values({
      employee_id: input.employeeId,
      transport: input.transport,
      conversation_key: input.conversationKey ?? null,
      current_record_id: input.currentRecordId ?? null,
      current_record_title: input.currentRecordTitle ?? null,
      current_list_title: input.currentListTitle ?? null,
      recent_records_json: input.recentRecordsJson,
      last_intent: input.lastIntent ?? null,
      last_message_text: input.lastMessageText ?? null,
      last_response_text: input.lastResponseText ?? null,
      expires_at: input.expiresAt ?? null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .onConflict((oc) =>
      oc.columns(["employee_id", "transport"]).doUpdateSet({
        transport: input.transport,
        conversation_key: input.conversationKey ?? null,
        current_record_id: input.currentRecordId ?? null,
        current_record_title: input.currentRecordTitle ?? null,
        current_list_title: input.currentListTitle ?? null,
        recent_records_json: input.recentRecordsJson,
        last_intent: input.lastIntent ?? null,
        last_message_text: input.lastMessageText ?? null,
        last_response_text: input.lastResponseText ?? null,
        expires_at: input.expiresAt ?? null,
        updated_at: nowIso,
      }),
    )
    .execute();
}

export async function deleteCopilotMemory(employeeId: string, transport?: string) {
  let query = db
    .deleteFrom("copilot_memory")
    .where("employee_id", "=", employeeId);

  if (transport) {
    query = query.where("transport", "=", transport);
  }

  await query.execute();
}
