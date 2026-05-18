import { canonicalizeBlueEmployee } from "../../blue/employee-identity.js";
import type { BlueRecord, BlueTodoCustomField, BlueUser } from "../../types/blue.js";
import { addCalendarDays, addUtcDays, getReportWindow, isIsoInRange } from "./dates.js";
import type {
  AttentionRecordRow,
  BlueDailyReportData,
  CommentRow,
  NewRecordRow,
  ReportActivity,
  ReportRecord,
  ReportWindow,
  StaffStatusRow,
} from "./types.js";

export function buildBlueDailyReportData(input: {
  window: ReportWindow;
  records: ReportRecord[];
  activities: ReportActivity[];
  generatedAt?: string;
}): BlueDailyReportData {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const recordsById = new Map(input.records.map((record) => [record.id, record]));
  const reportActivities = input.activities.filter((activity) =>
    isIsoInRange(activity.occurredAt, input.window.startUtc, input.window.endUtc),
  );
  const openRecords = input.records.filter((record) => !record.archived && !record.done);
  const lastCommentByRecordId = getLastCommentByRecordId(input.activities);
  for (const record of input.records) {
    const latestCommentAt = record.latestCommentAt;
    const previous = lastCommentByRecordId.get(record.id);
    if (latestCommentAt && (!previous || latestCommentAt > previous)) {
      lastCommentByRecordId.set(record.id, latestCommentAt);
    }
  }

  const newRecords = input.records
    .filter((record) =>
      isIsoInRange(record.createdAt, input.window.startUtc, input.window.endUtc),
    )
    .map<NewRecordRow>((record) => ({
      id: record.id,
      clientName: getRecordClientName(record),
      list: record.listTitle,
      source: detectRecordSource(record),
      createdAt: record.createdAt,
      assignedTo: formatAssignees(record.users),
      dueAt: record.dueAt,
    }))
    .sort((left, right) =>
      String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")),
    );

  const overdueRecords = openRecords.filter((record) =>
    Boolean(record.dueAt && record.dueAt < input.window.startUtc),
  );

  const overdueNoRecentComments = overdueRecords
    .filter((record) => {
      const lastComment = lastCommentByRecordId.get(record.id);
      return !lastComment || lastComment < addUtcDays(input.window.startUtc, -7);
    })
    .map((record) =>
      toAttentionRow(record, lastCommentByRecordId, input.window.endUtc),
    )
    .sort(sortAttentionRows);

  const overdueWithRecentComments = overdueRecords
    .filter((record) => {
      const lastComment = lastCommentByRecordId.get(record.id);
      return Boolean(lastComment && lastComment >= addUtcDays(input.window.startUtc, -7));
    })
    .map((record) =>
      toAttentionRow(record, lastCommentByRecordId, input.window.endUtc),
    )
    .sort(sortAttentionRows);

  const upcomingEndWindow = getReportWindow({
    reportDate: addCalendarDays(input.window.reportDate, 3),
    timezone: input.window.timezone,
  });
  const upcomingDue = openRecords
    .filter((record) =>
      isIsoInRange(record.dueAt, input.window.startUtc, upcomingEndWindow.endUtc),
    )
    .filter((record) => {
      const lastComment = lastCommentByRecordId.get(record.id);
      return !lastComment || lastComment < addUtcDays(input.window.startUtc, -5);
    })
    .map((record) =>
      toAttentionRow(record, lastCommentByRecordId, input.window.endUtc),
    )
    .sort(sortAttentionRows);

  const commentsLast24Hours = reportActivities
    .map((activity) => {
      const update = normalizeUpdateText(activity.text);
      if (!isReportUpdateActivity(activity.actionType) || !update) {
        return null;
      }
      const record = activity.recordId ? recordsById.get(activity.recordId) : null;
      return {
        recordId: activity.recordId,
        clientName: record ? getRecordClientName(record) : activity.recordTitle ?? "Unknown",
        assignedTo: record ? formatAssignees(record.users) : "",
        commenter: activity.commenterName,
        timestamp: activity.occurredAt,
        update,
        actionType: activity.actionType,
      };
    })
    .filter((row): row is CommentRow => Boolean(row))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  const staffStatus = buildStaffStatus({
    records: openRecords,
    reportActivities,
    window: input.window,
  });

  const rowCounts = {
    newRecords: newRecords.length,
    overdueNoRecentComments: overdueNoRecentComments.length,
    overdueWithRecentComments: overdueWithRecentComments.length,
    upcomingDue: upcomingDue.length,
    commentsLast24Hours: commentsLast24Hours.length,
    staffStatus: staffStatus.length,
  };

  return {
    window: input.window,
    generatedAt,
    rowCounts,
    newRecords,
    overdueNoRecentComments,
    overdueWithRecentComments,
    upcomingDue,
    commentsLast24Hours,
    staffStatus,
  };
}

export function detectRecordSource(record: Pick<ReportRecord, "title" | "text" | "html" | "tags" | "customFields">) {
  const leadSource = getCustomFieldValue(record.customFields ?? [], "Lead Source");
  if (leadSource) {
    return leadSource;
  }

  const haystack = [
    record.title,
    record.text,
    record.html,
    ...record.tags.map((tag) => tag.title),
    ...(record.customFields ?? []).map((field) => stringifyCustomFieldValue(field.value)),
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("hubspot") || haystack.includes("hub spot")) {
    return "Hubspot";
  }
  if (haystack.includes("jotform") || haystack.includes("jot form")) {
    return "Jotform";
  }
  if (haystack.includes("google tasks") || haystack.includes("googletasks")) {
    return "Google Tasks";
  }
  return "Unknown";
}

export function getRecordClientName(
  record: Pick<ReportRecord, "title" | "customFields">,
) {
  const explicitClientName =
    getFirstCustomFieldValue(record.customFields ?? [], [
      "Client Name",
      "Client",
      "Customer Name",
      "Applicant Name",
      "Borrower Name",
    ]) || "";
  return explicitClientName || record.title;
}

export function fromBlueRecord(record: BlueRecord): ReportRecord {
  return {
    id: record.id,
    title: record.title,
    listTitle: record.todoList?.title ?? "",
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    dueAt: record.duedAt ?? null,
    archived: Boolean(record.archived),
    done: Boolean(record.done),
    commentCount: record.commentCount ?? 0,
    latestCommentAt: null,
    users: record.users ?? [],
    tags: record.tags ?? [],
    customFields: record.customFields ?? [],
    text: record.text ?? "",
    html: record.html ?? "",
  };
}

export function canonicalAssignees(users: BlueUser[]) {
  return users.map((user) => canonicalizeBlueEmployee(user));
}

function buildStaffStatus(input: {
  records: ReportRecord[];
  reportActivities: ReportActivity[];
  window: ReportWindow;
}) {
  const rows = new Map<string, StaffStatusRow>();
  const commentsByEmployee = new Map<
    string,
    { count: number; displayName: string }
  >();
  const touchedRecordIds = new Set<string>();

  for (const activity of input.reportActivities) {
    if (
      activity.recordId &&
      isReportUpdateActivity(activity.actionType) &&
      normalizeUpdateText(activity.text)
    ) {
      touchedRecordIds.add(activity.recordId);
    }
    if (isCommentCreatedAction(activity.actionType) && activity.commenterEmployeeId) {
      const commenter = canonicalizeBlueEmployee({
        id: activity.commenterEmployeeId,
        fullName: activity.commenterName,
      });
      const existing = commentsByEmployee.get(commenter.employeeId);
      commentsByEmployee.set(commenter.employeeId, {
        count: (existing?.count ?? 0) + 1,
        displayName: existing?.displayName ?? commenter.displayName,
      });
    }
  }

  for (const record of input.records) {
    const recordUpdatedDuringReport = isIsoInRange(
      record.updatedAt,
      input.window.startUtc,
      input.window.endUtc,
    );
    for (const assignee of canonicalAssignees(record.users)) {
      const row = getOrCreateStaffRow(rows, assignee.employeeId, assignee.displayName);
      row.openAssignedRecords += 1;
      if (!recordUpdatedDuringReport && !touchedRecordIds.has(record.id)) {
        row.untouchedRecords += 1;
      }
    }
  }

  for (const [employeeId, commenter] of commentsByEmployee) {
    const existing = rows.get(employeeId);
    if (existing) {
      existing.commentsPlacedYesterday = commenter.count;
    } else {
      rows.set(employeeId, {
        staffId: employeeId,
        staffName: commenter.displayName,
        openAssignedRecords: 0,
        commentsPlacedYesterday: commenter.count,
        untouchedRecords: 0,
      });
    }
  }

  return Array.from(rows.values()).sort((left, right) =>
    left.staffName.localeCompare(right.staffName),
  );
}

function getOrCreateStaffRow(
  rows: Map<string, StaffStatusRow>,
  staffId: string,
  staffName: string,
) {
  const existing = rows.get(staffId);
  if (existing) {
    return existing;
  }
  const created = {
    staffId,
    staffName,
    openAssignedRecords: 0,
    commentsPlacedYesterday: 0,
    untouchedRecords: 0,
  };
  rows.set(staffId, created);
  return created;
}

function toAttentionRow(
  record: ReportRecord,
  lastCommentByRecordId: Map<string, string>,
  asOfIso: string,
): AttentionRecordRow {
  const lastCommentAt = lastCommentByRecordId.get(record.id) ?? null;
  return {
    id: record.id,
    clientName: getRecordClientName(record),
    list: record.listTitle,
    assignedTo: formatAssignees(record.users),
    dueAt: record.dueAt,
    lastCommentAt,
    daysSinceComment: lastCommentAt
      ? Math.floor(
          (new Date(asOfIso).getTime() - new Date(lastCommentAt).getTime()) /
            86_400_000,
        )
      : null,
    commentCount: record.commentCount,
  };
}

function getLastCommentByRecordId(activities: ReportActivity[]) {
  const result = new Map<string, string>();
  for (const activity of activities) {
    if (!activity.recordId || !isCommentAction(activity.actionType)) {
      continue;
    }
    const previous = result.get(activity.recordId);
    if (!previous || activity.occurredAt > previous) {
      result.set(activity.recordId, activity.occurredAt);
    }
  }
  return result;
}

function getFirstCustomFieldValue(
  fields: BlueTodoCustomField[],
  names: string[],
) {
  for (const name of names) {
    const value = getCustomFieldValue(fields, name);
    if (value) {
      return value;
    }
  }
  return "";
}

function getCustomFieldValue(
  fields: BlueTodoCustomField[],
  name: string,
) {
  const field = fields.find(
    (item) => item.name?.trim().toLowerCase() === name.toLowerCase(),
  );
  return field ? stringifyCustomFieldValue(field.value) : "";
}

function stringifyCustomFieldValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyCustomFieldValue).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const candidate = value as { title?: unknown; name?: unknown; value?: unknown; label?: unknown };
    return (
      stringifyCustomFieldValue(candidate.title) ||
      stringifyCustomFieldValue(candidate.name) ||
      stringifyCustomFieldValue(candidate.label) ||
      stringifyCustomFieldValue(candidate.value) ||
      JSON.stringify(value)
    );
  }
  return "";
}

function formatAssignees(users: BlueUser[]) {
  return canonicalAssignees(users)
    .map((user) => user.displayName)
    .filter(Boolean)
    .sort()
    .join(", ");
}

function isCommentAction(actionType: string) {
  return actionType.toUpperCase().includes("COMMENT");
}

function isCommentCreatedAction(actionType: string) {
  const normalized = actionType.toUpperCase();
  return normalized === "CREATE_COMMENT" || normalized === "COMMENT_CREATED";
}

function isReportUpdateActivity(actionType: string) {
  const normalized = actionType.toUpperCase();
  if (normalized.includes("COMMENT")) {
    return true;
  }
  return (
    normalized.startsWith("TODO_") &&
    !normalized.includes("CREATED") &&
    !normalized.includes("DELETED")
  );
}

function normalizeUpdateText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sortAttentionRows(left: AttentionRecordRow, right: AttentionRecordRow) {
  return String(left.dueAt ?? "").localeCompare(String(right.dueAt ?? ""));
}
