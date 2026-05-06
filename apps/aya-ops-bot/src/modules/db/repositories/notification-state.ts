import { db } from "../kysely.js";

export async function getEmployeeNotificationState(employeeId: string) {
  return await db
    .selectFrom("employee_notification_state")
    .select(["employee_id", "mentions_seen_through", "created_at", "updated_at"])
    .where("employee_id", "=", employeeId)
    .executeTakeFirst();
}

export async function upsertEmployeeNotificationState(input: {
  employeeId: string;
  mentionsSeenThrough?: string | null;
}) {
  await db
    .insertInto("employee_notification_state")
    .values({
      employee_id: input.employeeId,
      mentions_seen_through: input.mentionsSeenThrough ?? null,
    })
    .onConflict((conflict) =>
      conflict.column("employee_id").doUpdateSet({
        mentions_seen_through: input.mentionsSeenThrough ?? null,
        updated_at: new Date().toISOString(),
      }),
    )
    .execute();
}
