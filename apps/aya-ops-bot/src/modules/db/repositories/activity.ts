import { sql } from "kysely";

import { db } from "../kysely.js";
import type { NormalizedActivityEvent } from "../../../domain/types.js";

export async function insertActivityEvent(event: NormalizedActivityEvent) {
  const result = await db
    .insertInto("activity_events")
    .values({
      id: event.id,
      employee_id: event.employeeId ?? null,
      workspace_id: event.workspaceId ?? null,
      project_name: event.projectName ?? null,
      source: event.source,
      source_event_id: event.sourceEventId ?? null,
      action_type: event.actionType,
      entity_type: event.entityType ?? null,
      entity_id: event.entityId ?? null,
      entity_title: event.entityTitle ?? null,
      occurred_at: event.occurredAt,
      summary: event.summary,
      raw_payload: JSON.stringify(event.rawPayload),
    })
    .onConflict((conflict) => conflict.columns(["source", "source_event_id"]).doNothing())
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
}

export async function listEventsForEmployeeDay(employeeId: string, date: string) {
  return await db
    .selectFrom("activity_events as ae")
    .leftJoin("employees as e", "e.id", "ae.employee_id")
    .select([
      "ae.id",
      "ae.source",
      "ae.action_type",
      "ae.entity_type",
      "ae.entity_id",
      "ae.entity_title",
      "ae.occurred_at",
      "ae.summary",
      "e.display_name as employee_name",
    ])
    .where("ae.employee_id", "=", employeeId)
    .where(sql`substr(ae.occurred_at, 1, 10)`, "=", date)
    .orderBy("ae.occurred_at", "desc")
    .execute();
}

export async function listWorkspaceEventsInRange(input: {
  workspaceId: string;
  dateStart?: string;
  dateEnd?: string;
  employeeId?: string;
  limit?: number;
}) {
  let query = db
    .selectFrom("activity_events as ae")
    .leftJoin("employees as e", "e.id", "ae.employee_id")
    .select([
      "ae.id",
      "ae.source",
      "ae.action_type",
      "ae.entity_type",
      "ae.entity_id",
      "ae.entity_title",
      "ae.occurred_at",
      "ae.summary",
      "ae.project_name",
      "e.id as employee_id",
      "e.display_name as employee_name",
    ])
    .where("ae.workspace_id", "=", input.workspaceId);

  if (input.employeeId) {
    query = query.where("ae.employee_id", "=", input.employeeId);
  }
  if (input.dateStart) {
    query = query.where("ae.occurred_at", ">=", `${input.dateStart}T00:00:00Z`);
  }
  if (input.dateEnd) {
    query = query.where("ae.occurred_at", "<=", `${input.dateEnd}T23:59:59Z`);
  }

  return await query
    .orderBy("ae.occurred_at", "desc")
    .limit(input.limit ?? 5000)
    .execute();
}

export async function getWorkspaceActivityOverview(input: {
  workspaceId: string;
  date: string;
}) {
  const counts = await db
    .selectFrom("activity_events as ae")
    .select([
      sql<number>`count(*)`.as("total_interactions"),
      sql<number>`count(distinct ae.employee_id)`.as("active_employees"),
      sql<string | null>`max(ae.occurred_at)`.as("latest_interaction_at"),
    ])
    .where("ae.workspace_id", "=", input.workspaceId)
    .where(sql`substr(ae.occurred_at, 1, 10)`, "=", input.date)
    .executeTakeFirst();

  return {
    date: input.date,
    totalInteractions: counts?.total_interactions ?? 0,
    successCount: counts?.total_interactions ?? 0,
    failureCount: 0,
    activeEmployees: counts?.active_employees ?? 0,
    latestInteractionAt: counts?.latest_interaction_at ?? null,
    planner: {
      plannedCount: 0,
      averageConfidence: 0,
      clarificationCount: 0,
      unmatchedCount: 0,
      lowConfidenceCount: 0,
      activeRecordFollowUps: 0,
      topIntents: [],
    },
  };
}

export async function listWorkspaceEmployeeActivity(input: {
  workspaceId: string;
  dateStart?: string;
  dateEnd?: string;
  limit?: number;
}) {
  let query = db
    .selectFrom("employees as e")
    .leftJoin("activity_events as ae", (join) =>
      join
        .onRef("ae.employee_id", "=", "e.id")
        .on("ae.workspace_id", "=", input.workspaceId),
    )
    .select([
      "e.id as employee_id",
      "e.display_name",
      "e.role_name",
      sql<number>`count(ae.id)`.as("interaction_count"),
      sql<number>`count(ae.id)`.as("success_count"),
      sql<number>`0`.as("failure_count"),
      sql<number>`case when count(ae.id) = 0 then 0 else 100 end`.as(
        "success_rate",
      ),
      sql<string | null>`max(ae.occurred_at)`.as("latest_interaction_at"),
    ])
    .groupBy(["e.id", "e.display_name", "e.role_name"]);

  if (input.dateStart) {
    query = query.where((eb) =>
      eb.or([
        eb("ae.occurred_at", ">=", `${input.dateStart}T00:00:00Z`),
        eb("ae.occurred_at", "is", null),
      ]),
    );
  }
  if (input.dateEnd) {
    query = query.where((eb) =>
      eb.or([
        eb("ae.occurred_at", "<=", `${input.dateEnd}T23:59:59Z`),
        eb("ae.occurred_at", "is", null),
      ]),
    );
  }

  return await query
    .orderBy(sql`case when latest_interaction_at is null then 1 else 0 end`)
    .orderBy("latest_interaction_at", "desc")
    .orderBy("e.display_name", "asc")
    .limit(input.limit ?? 100)
    .execute();
}

export async function listEventsForEmployeeInRange(input: {
  employeeId: string;
  dateStart?: string;
  dateEnd?: string;
  limit?: number;
}) {
  let query = db
    .selectFrom("activity_events as ae")
    .leftJoin("employees as e", "e.id", "ae.employee_id")
    .select([
      "ae.id",
      "ae.source",
      "ae.action_type",
      "ae.entity_type",
      "ae.entity_id",
      "ae.entity_title",
      "ae.occurred_at",
      "ae.summary",
      "ae.project_name",
      "e.display_name as employee_name",
    ])
    .where("ae.employee_id", "=", input.employeeId);

  if (input.dateStart) {
    query = query.where("ae.occurred_at", ">=", `${input.dateStart}T00:00:00Z`);
  }
  if (input.dateEnd) {
    query = query.where("ae.occurred_at", "<=", `${input.dateEnd}T23:59:59Z`);
  }

  return await query
    .orderBy("ae.occurred_at", "desc")
    .limit(input.limit ?? 50)
    .execute();
}

export async function countEventsBySourceForEmployeeDay(
  employeeId: string,
  date: string,
) {
  return await db
    .selectFrom("activity_events")
    .select([
      "source",
      sql<number>`count(*)`.as("count"),
    ])
    .where("employee_id", "=", employeeId)
    .where(sql`substr(occurred_at, 1, 10)`, "=", date)
    .groupBy("source")
    .orderBy("count", "desc")
    .execute();
}

export async function countEventsByActionForEmployeeDay(
  employeeId: string,
  date: string,
) {
  return await db
    .selectFrom("activity_events")
    .select([
      "action_type",
      sql<number>`count(*)`.as("count"),
    ])
    .where("employee_id", "=", employeeId)
    .where(sql`substr(occurred_at, 1, 10)`, "=", date)
    .groupBy("action_type")
    .orderBy("count", "desc")
    .execute();
}

export async function listEventsForDay(date: string, limit = 25) {
  return await db
    .selectFrom("activity_events as ae")
    .leftJoin("employees as e", "e.id", "ae.employee_id")
    .select([
      "ae.id",
      "ae.source",
      "ae.action_type",
      "ae.entity_type",
      "ae.entity_id",
      "ae.entity_title",
      "ae.occurred_at",
      "ae.summary",
      "e.id as employee_id",
      "e.display_name as employee_name",
    ])
    .where(sql`substr(ae.occurred_at, 1, 10)`, "=", date)
    .orderBy("ae.occurred_at", "desc")
    .limit(limit)
    .execute();
}

export async function countEventsByEmployeeForDay(date: string) {
  return await db
    .selectFrom("activity_events as ae")
    .innerJoin("employees as e", "e.id", "ae.employee_id")
    .select([
      "e.id as employee_id",
      "e.display_name as employee_name",
      sql<number>`count(*)`.as("count"),
    ])
    .where(sql`substr(ae.occurred_at, 1, 10)`, "=", date)
    .groupBy(["e.id", "e.display_name"])
    .orderBy("count", "desc")
    .orderBy("e.display_name", "asc")
    .execute();
}

export async function listEmployeesWithoutActivityForDay(date: string) {
  return await db
    .selectFrom("employees as e")
    .select(["e.id", "e.display_name"])
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("activity_events as ae")
            .select("ae.id")
            .whereRef("ae.employee_id", "=", "e.id")
            .where(sql`substr(ae.occurred_at, 1, 10)`, "=", date),
        ),
      ),
    )
    .orderBy("e.display_name", "asc")
    .execute();
}

export async function listMentionsForUser(input: {
  employeeName: string;
  dateStart?: string;
  dateEnd?: string;
  limit?: number;
}) {
  let query = db
    .selectFrom("activity_events as ae")
    .leftJoin("employees as e", "e.id", "ae.employee_id")
    .select([
      "ae.id",
      "ae.action_type",
      "ae.entity_title",
      "ae.occurred_at",
      "ae.summary",
      "e.display_name as author_name",
    ])
    .where("ae.action_type", "=", "CREATE_COMMENT")
    .where("ae.summary", "like", `%@${input.employeeName}%`);

  if (input.dateStart) {
    query = query.where("ae.occurred_at", ">=", `${input.dateStart}T00:00:00Z`);
  }
  if (input.dateEnd) {
    query = query.where("ae.occurred_at", "<=", `${input.dateEnd}T23:59:59Z`);
  }

  return await query
    .orderBy("ae.occurred_at", "desc")
    .limit(input.limit ?? 20)
    .execute();
}
