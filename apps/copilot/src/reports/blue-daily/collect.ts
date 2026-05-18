import { db } from "../../modules/db/kysely.js";
import { canonicalizeBlueEmployee, formatBlueActorName } from "../../blue/employee-identity.js";
import { fetchRecordLatestComment } from "../../modules/blue/graphql/client.js";
import type { BlueActivityEvent, BlueRecord } from "../../types/blue.js";
import { addCalendarDays, getReportWindow, isIsoInRange } from "./dates.js";
import { fromBlueRecord } from "./rules.js";
import type { ReportActivity, ReportRecord, ReportWindow } from "./types.js";

const allCachedActivityStartUtc = "1970-01-01T00:00:00.000Z";

export async function collectBlueDailyReportInputs(input: {
  workspaceId: string;
  window: ReportWindow;
}) {
  const [rawRecords, activities] = await Promise.all([
    listReportRecords(input.workspaceId),
    listReportActivities({
      workspaceId: input.workspaceId,
      startUtc: allCachedActivityStartUtc,
      endUtc: input.window.endUtc,
    }),
  ]);
  const records = await enrichLatestCommentDates({
    workspaceId: input.workspaceId,
    records: rawRecords,
    window: input.window,
  });

  return { records, activities };
}

async function enrichLatestCommentDates(input: {
  workspaceId: string;
  records: ReportRecord[];
  window: ReportWindow;
}) {
  const upcomingEndWindow = getReportWindow({
    reportDate: addCalendarDays(input.window.reportDate, 3),
    timezone: input.window.timezone,
  });
  const candidates = input.records.filter((record) => {
    if (
      record.archived ||
      record.done ||
      !record.dueAt ||
      record.commentCount <= 0
    ) {
      return false;
    }
    return (
      record.dueAt < input.window.startUtc ||
      isIsoInRange(record.dueAt, input.window.startUtc, upcomingEndWindow.endUtc)
    );
  });

  if (!candidates.length) {
    return input.records;
  }

  const latestCommentByRecordId = new Map<string, string | null>();
  await Promise.all(
    candidates.map(async (record) => {
      const latestComment = await fetchRecordLatestComment({
        workspaceId: input.workspaceId,
        recordId: record.id,
      });
      latestCommentByRecordId.set(record.id, latestComment?.createdAt ?? null);
    }),
  );

  return input.records.map((record) =>
    latestCommentByRecordId.has(record.id)
      ? {
          ...record,
          latestCommentAt: latestCommentByRecordId.get(record.id) ?? null,
        }
      : record,
  );
}

async function listReportRecords(workspaceId: string): Promise<ReportRecord[]> {
  const rows = await db
    .selectFrom("blue_records_cache")
    .select([
      "id",
      "list_title",
      "title",
      "due_at",
      "updated_at",
      "archived",
      "done",
      "raw_json",
    ])
    .where("workspace_id", "=", workspaceId)
    .where("deleted_at", "is", null)
    .orderBy("title", "asc")
    .execute();

  return rows.map((row) => {
    const parsed = parseRecord(row.raw_json);
    if (parsed) {
      return fromBlueRecord(parsed);
    }

    return {
      id: row.id,
      title: row.title,
      listTitle: row.list_title,
      createdAt: null,
      updatedAt: row.updated_at,
      dueAt: row.due_at,
      archived: Boolean(row.archived),
      done: Boolean(row.done),
      commentCount: 0,
      latestCommentAt: null,
      users: [],
      tags: [],
      customFields: [],
      text: "",
      html: "",
    };
  });
}

async function listReportActivities(input: {
  workspaceId: string;
  startUtc: string;
  endUtc: string;
}): Promise<ReportActivity[]> {
  const rows = await db
    .selectFrom("activity_events as ae")
    .leftJoin("employees as e", "e.id", "ae.employee_id")
    .select([
      "ae.id",
      "ae.action_type",
      "ae.entity_type",
      "ae.entity_id",
      "ae.entity_title",
      "ae.occurred_at",
      "ae.summary",
      "ae.raw_payload",
      "e.id as employee_id",
      "e.display_name as employee_name",
    ])
    .where("ae.workspace_id", "=", input.workspaceId)
    .where("ae.occurred_at", ">=", input.startUtc)
    .where("ae.occurred_at", "<", input.endUtc)
    .orderBy("ae.occurred_at", "asc")
    .execute();

  return rows.map((row) => {
    const payload = parseActivity(row.raw_payload);
    const actor = payload?.createdBy
      ? canonicalizeBlueEmployee(payload.createdBy)
      : null;
    const recordId =
      payload?.todo?.id ?? (row.entity_type === "record" ? row.entity_id : null);
    const commentText =
      payload?.comment?.text ??
      payload?.comment?.html ??
      row.summary ??
      payload?.html ??
      "";

    return {
      id: row.id,
      actionType: row.action_type,
      recordId,
      recordTitle: payload?.todo?.title ?? row.entity_title,
      commenterName:
        row.employee_name ?? actor?.displayName ?? formatBlueActorName(payload?.createdBy),
      commenterEmployeeId: row.employee_id ?? actor?.employeeId ?? null,
      occurredAt: row.occurred_at,
      text: stripHtml(commentText),
    };
  });
}

function parseRecord(rawJson: string | null): BlueRecord | null {
  if (!rawJson) {
    return null;
  }
  try {
    return JSON.parse(rawJson) as BlueRecord;
  } catch {
    return null;
  }
}

function parseActivity(rawJson: string | null): BlueActivityEvent | null {
  if (!rawJson) {
    return null;
  }
  try {
    return JSON.parse(rawJson) as BlueActivityEvent;
  } catch {
    return null;
  }
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
