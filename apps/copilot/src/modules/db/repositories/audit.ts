import { sql } from "kysely";

import { resolvedAuditStdoutMode } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { db } from "../kysely.js";

export async function insertBotAuditLog(input: {
  id: string;
  createdAt?: string;
  employeeId?: string;
  transport: string;
  inboundText: string;
  detectedIntent?: string;
  adapter: string;
  commandName?: string;
  commandArgs?: string;
  outcome: string;
  responseText?: string;
  requestJson?: unknown;
  responseJson?: unknown;
}) {
  await db
    .insertInto("bot_audit_logs")
    .values({
      id: input.id,
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
      employee_id: input.employeeId ?? null,
      transport: input.transport,
      inbound_text: input.inboundText,
      detected_intent: input.detectedIntent ?? null,
      adapter: input.adapter,
      command_name: input.commandName ?? null,
      command_args: input.commandArgs ?? null,
      outcome: input.outcome,
      response_text: input.responseText ?? null,
      request_json:
        input.requestJson === undefined ? null : JSON.stringify(input.requestJson),
      response_json:
        input.responseJson === undefined ? null : JSON.stringify(input.responseJson),
    })
    .execute();

  logger.info(
    {
      audit: {
        id: input.id,
        employeeId: input.employeeId ?? null,
        transport: input.transport,
        detectedIntent: input.detectedIntent ?? null,
        adapter: input.adapter,
        commandName: input.commandName ?? null,
        outcome: input.outcome,
        ...(resolvedAuditStdoutMode === "full"
          ? {
              inboundText: input.inboundText,
              responseText: input.responseText ?? null,
              requestJson: input.requestJson ?? null,
              responseJson: input.responseJson ?? null,
            }
          : {}),
      },
    },
    "audit event",
  );
}

export async function getAdminDashboardOverview(dateIso: string) {
  const counts = await db
    .selectFrom("bot_audit_logs")
    .select([
      sql<number>`count(*)`.as("total_interactions"),
      sql<number>`sum(case when outcome = 'success' then 1 else 0 end)`.as(
        "success_count",
      ),
      sql<number>`sum(case when outcome != 'success' then 1 else 0 end)`.as(
        "failure_count",
      ),
      sql<number>`count(distinct employee_id)`.as("active_employees"),
    ])
    .where(sql`substr(created_at, 1, 10)`, "=", dateIso)
    .executeTakeFirst();

  const latest = await db
    .selectFrom("bot_audit_logs")
    .select("created_at")
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();

  const plannerRows = await db
    .selectFrom("bot_audit_logs")
    .select(["detected_intent", "outcome", "request_json"])
    .where(sql`substr(created_at, 1, 10)`, "=", dateIso)
    .execute();

  const planner = summarizePlannerOverview(plannerRows);

  return {
    date: dateIso,
    totalInteractions: counts?.total_interactions ?? 0,
    successCount: counts?.success_count ?? 0,
    failureCount: counts?.failure_count ?? 0,
    activeEmployees: counts?.active_employees ?? 0,
    latestInteractionAt: latest?.created_at ?? null,
    planner,
  };
}

export async function listAdminDashboardEmployeeActivity(limit = 25) {
  return await db
    .selectFrom("employees as e")
    .leftJoin("bot_audit_logs as l", "l.employee_id", "e.id")
    .select([
      "e.id as employee_id",
      "e.display_name",
      "e.role_name",
      sql<number>`count(l.id)`.as("interaction_count"),
      sql<number>`sum(case when l.outcome = 'success' then 1 else 0 end)`.as(
        "success_count",
      ),
      sql<number>`sum(case when l.outcome != 'success' and l.id is not null then 1 else 0 end)`.as(
        "failure_count",
      ),
      sql<number>`round(
        case
          when count(l.id) = 0 then 0
          else (sum(case when l.outcome = 'success' then 1 else 0 end) * 100.0) / count(l.id)
        end,
        2
      )`.as("success_rate"),
      sql<string | null>`max(l.created_at)`.as("latest_interaction_at"),
    ])
    .groupBy(["e.id", "e.display_name", "e.role_name"])
    .orderBy(sql`case when latest_interaction_at is null then 1 else 0 end`)
    .orderBy("latest_interaction_at", "desc")
    .orderBy("e.display_name", "asc")
    .limit(limit)
    .execute();
}

export async function listAdminDashboardRecentLogs(input?: {
  employeeId?: string;
  limit?: number;
}) {
  let query = db
    .selectFrom("bot_audit_logs as l")
    .leftJoin("employees as e", "e.id", "l.employee_id")
    .select([
      "l.id",
      "l.created_at",
      "l.employee_id",
      "e.display_name",
      "e.role_name",
      "l.transport",
      "l.detected_intent",
      "l.adapter",
      "l.command_name",
      "l.outcome",
      "l.inbound_text",
      "l.response_text",
    ]);

  if (input?.employeeId) {
    query = query.where("l.employee_id", "=", input.employeeId);
  }

  return await query
    .orderBy("l.created_at", "desc")
    .limit(input?.limit ?? 50)
    .execute();
}

export async function getAdminDashboardLogDetail(id: string) {
  return await db
    .selectFrom("bot_audit_logs as l")
    .leftJoin("employees as e", "e.id", "l.employee_id")
    .select([
      "l.id",
      "l.created_at",
      "l.employee_id",
      "e.display_name",
      "e.role_name",
      "l.transport",
      "l.detected_intent",
      "l.adapter",
      "l.command_name",
      "l.command_args",
      "l.outcome",
      "l.inbound_text",
      "l.response_text",
      "l.request_json",
      "l.response_json",
    ])
    .where("l.id", "=", id)
    .executeTakeFirst();
}

export async function listBotAuditLogsForEmployeeDay(input: {
  employeeId: string;
  dateIso: string;
  limit?: number;
}) {
  return await db
    .selectFrom("bot_audit_logs as l")
    .leftJoin("employees as e", "e.id", "l.employee_id")
    .select([
      "l.id",
      "l.created_at",
      "l.employee_id",
      "e.display_name",
      "e.role_name",
      "l.transport",
      "l.detected_intent",
      "l.adapter",
      "l.command_name",
      "l.command_args",
      "l.outcome",
      "l.inbound_text",
      "l.response_text",
      "l.request_json",
      "l.response_json",
    ])
    .where("l.employee_id", "=", input.employeeId)
    .where(sql`substr(l.created_at, 1, 10)`, "=", input.dateIso)
    .orderBy("l.created_at", "desc")
    .limit(input.limit ?? 250)
    .execute();
}

export async function listBotAuditLogsForDay(input: {
  dateIso: string;
  limit?: number;
}) {
  return await db
    .selectFrom("bot_audit_logs as l")
    .leftJoin("employees as e", "e.id", "l.employee_id")
    .select([
      "l.id",
      "l.created_at",
      "l.employee_id",
      "e.display_name",
      "e.role_name",
      "l.transport",
      "l.detected_intent",
      "l.adapter",
      "l.command_name",
      "l.command_args",
      "l.outcome",
      "l.inbound_text",
      "l.response_text",
      "l.request_json",
      "l.response_json",
    ])
    .where(sql`substr(l.created_at, 1, 10)`, "=", input.dateIso)
    .orderBy("l.created_at", "desc")
    .limit(input.limit ?? 1000)
    .execute();
}

export async function listBotAuditLogsInRange(input: {
  dateStartIso: string;
  dateEndIso: string;
  employeeId?: string;
  limit?: number;
}) {
  let query = db
    .selectFrom("bot_audit_logs as l")
    .leftJoin("employees as e", "e.id", "l.employee_id")
    .select([
      "l.id",
      "l.created_at",
      "l.employee_id",
      "e.display_name",
      "e.role_name",
      "l.transport",
      "l.detected_intent",
      "l.adapter",
      "l.command_name",
      "l.command_args",
      "l.outcome",
      "l.inbound_text",
      "l.response_text",
      "l.request_json",
      "l.response_json",
    ])
    .where(sql`substr(l.created_at, 1, 10)`, ">=", input.dateStartIso)
    .where(sql`substr(l.created_at, 1, 10)`, "<=", input.dateEndIso);

  if (input.employeeId) {
    query = query.where("l.employee_id", "=", input.employeeId);
  }

  return await query
    .orderBy("l.created_at", "desc")
    .limit(input.limit ?? 2000)
    .execute();
}

function summarizePlannerOverview(
  rows: Array<{
    detected_intent: string | null;
    outcome: string;
    request_json: string | null;
  }>,
) {
  let plannedCount = 0;
  let confidenceTotal = 0;
  let confidenceSamples = 0;
  let clarificationCount = 0;
  let unmatchedCount = 0;
  let lowConfidenceCount = 0;
  let activeRecordFollowUps = 0;
  const intentCounts = new Map<string, number>();

  for (const row of rows) {
    if (row.outcome === "needs_clarification") {
      clarificationCount += 1;
    }
    if (row.outcome === "unmatched") {
      unmatchedCount += 1;
    }

    const requestJson = safeParseJson(row.request_json);
    const plan = isObject(requestJson) && isObject(requestJson.plan)
      ? requestJson.plan
      : null;

    const intent =
      typeof plan?.intent === "string"
        ? plan.intent
        : row.detected_intent ?? null;
    if (intent) {
      intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
    }

    if (!plan) {
      continue;
    }

    plannedCount += 1;

    if (typeof plan.confidence === "number") {
      confidenceTotal += plan.confidence;
      confidenceSamples += 1;
      if (plan.confidence < 0.75) {
        lowConfidenceCount += 1;
      }
    }

    if (
      Array.isArray(plan.matchedSignals) &&
      plan.matchedSignals.some(
        (signal) =>
          typeof signal === "string" &&
          (signal.includes(":context") || signal === "pending-choice"),
      )
    ) {
      activeRecordFollowUps += 1;
    }
  }

  return {
    plannedCount,
    averageConfidence:
      confidenceSamples > 0
        ? Number((confidenceTotal / confidenceSamples).toFixed(2))
        : 0,
    clarificationCount,
    unmatchedCount,
    lowConfidenceCount,
    activeRecordFollowUps,
    topIntents: [...intentCounts.entries()]
      .map(([intent, count]) => ({ intent, count }))
      .sort((left, right) => right.count - left.count || left.intent.localeCompare(right.intent))
      .slice(0, 6),
  };
}

function safeParseJson(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
