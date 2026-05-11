import { db } from "../kysely.js";

export async function upsertPendingRecordChoice(input: {
  employeeId: string;
  transport: string;
  continuationAction: string;
  originalQuery?: string | null;
  pendingParametersJson?: string | null;
  candidatesJson: string;
  expiresAt: string;
}) {
  const nowIso = new Date().toISOString();
  await db
    .insertInto("pending_record_choices")
    .values({
      employee_id: input.employeeId,
      transport: input.transport,
      continuation_action: input.continuationAction,
      original_query: input.originalQuery ?? null,
      pending_parameters_json: input.pendingParametersJson ?? null,
      candidates_json: input.candidatesJson,
      expires_at: input.expiresAt,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .onConflict((oc) =>
      oc.columns(["employee_id", "transport"]).doUpdateSet({
        transport: input.transport,
        continuation_action: input.continuationAction,
        original_query: input.originalQuery ?? null,
        pending_parameters_json: input.pendingParametersJson ?? null,
        candidates_json: input.candidatesJson,
        expires_at: input.expiresAt,
        updated_at: nowIso,
      }),
    )
    .execute();
}

export async function getPendingRecordChoice(employeeId: string, transport?: string) {
  let query = db
    .selectFrom("pending_record_choices")
    .selectAll()
    .where("employee_id", "=", employeeId);

  if (transport) {
    query = query.where("transport", "=", transport);
  }

  return await query
    .orderBy("updated_at", "desc")
    .executeTakeFirst();
}

export async function deletePendingRecordChoice(employeeId: string, transport?: string) {
  let query = db
    .deleteFrom("pending_record_choices")
    .where("employee_id", "=", employeeId);

  if (transport) {
    query = query.where("transport", "=", transport);
  }

  await query.execute();
}
