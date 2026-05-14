import {
  ExternalServiceError,
  ValidationError,
} from "../../app/errors.js";
import { getBlueRecordDetail } from "../../blue/record-detail.js";
import {
  listBotAuditLogsForDay,
  listBotAuditLogsForEmployeeDay,
  listBotAuditLogsInRange,
  listCachedBlueRecordsForInspection,
  listEmployees,
  listEventsForEmployeeInRange,
  listMentionsForUser,
  getEmployeeNotificationState,
  upsertEmployeeNotificationState,
} from "../../db.js";
import {
  getIndexedRecord,
  resolveListQuery,
  resolveRecordQuery,
  searchRecordQuery,
  syncWorkspaceIndex,
} from "../../blue/workspace-index.js";
import { config } from "../../config.js";
import type { BlueRequestAuth, EmployeeIdentity } from "../../domain/types.js";
import type { BlueChecklistItem, BluePageInfo, BlueRecord } from "../../types/blue.js";
import {
  createComment,
  editChecklistItem,
  createLeadRecord,
  fetchRecordDetail,
  listAssignedChecklistItems,
  listAssignedOpenRecords,
  moveRecord,
  setTodoAssignees,
  setChecklistItemAssignees,
  updateChecklistItemDueDate,
  updateTodoFields,
} from "../blue/graphql/client.js";
import { resolveBlueWriteAuth } from "../blue/request-auth.js";
import {
  clearActiveRecordContextForActor,
  getActiveRecordContextForActor,
  rememberActiveRecordContext,
} from "../disambiguation/active-record-context.js";
import {
  clearPendingRecordChoiceForActor,
  rememberPendingRecordChoice,
  resolvePendingRecordChoice,
} from "../disambiguation/record-choices.js";
import { resolveActorIdentity as resolveActorIdentityService } from "../identity/service.js";
import { normalizeCacheQuery } from "../db/repositories/helpers.js";
import { answerReportingQuestion, getReportingOverview } from "../../reporting/service.js";
import { buildEmployeeDaySummary } from "../../summary/daily.js";
import {
  buildNoActivitySummary,
  buildTeamDaySummary,
} from "../../summary/team.js";
import {
  buildClientBriefingInsights,
  buildClientDetailResponseText,
} from "./record-briefing.js";
import {
  buildEmployeeActivityReport,
  type EmployeeActivityFocus,
  buildWorkspaceActivityReport,
  buildRecordActivityReport,
  type RecordActivityFocus,
  type WorkspaceActivityFocus,
} from "./admin-activity-report.js";
import { normalizeActivityDateRange } from "./activity-date-range.js";
import {
  buildWorkspaceExceptionReport,
  type ExceptionReportFocus,
} from "./exception-report.js";
import { getPreAuthSafetyBlock } from "./safety.js";

const BLUE_WRITE_AUTH_REJECTED_MESSAGE =
  "Blue rejected your saved personal Token ID and Secret for this write action. Open the Aya MCP server settings, re-save your Blue Token ID and Secret from Blue > Profile > API, then try again.";

export async function searchClients(
  input: {
    query: string;
    limit?: number;
    actor?: EmployeeIdentity | null;
    transport?: string;
  },
) {
  const items = await searchRecordQuery(input.query, input.limit ?? 8);

  if (input.actor && items.length > 1) {
    await rememberPendingRecordChoice({
      actor: input.actor,
      transport: input.transport ?? "mcp",
      continuationAction: "records.detail",
      originalQuery: input.query,
      candidates: items.map((item) => ({
        id: item.id,
        title: item.title,
        listTitle: item.listTitle,
      })),
    });
  } else if (input.actor && items.length === 1) {
    await clearPendingRecordChoiceForActor(input.actor, input.transport);
    await rememberActiveRecordContext({
      actor: input.actor,
      transport: input.transport ?? "mcp",
      recordId: items[0].id,
      recordTitle: items[0].title,
      listTitle: items[0].listTitle,
    });
  } else if (input.actor) {
    await clearPendingRecordChoiceForActor(input.actor, input.transport);
    await clearActiveRecordContextForActor(input.actor, input.transport);
  }

  return {
    query: input.query,
    items,
  };
}

export async function getClientDetail(input: {
  recordId?: string;
  recordQuery?: string;
  useActiveRecordContext?: boolean;
  detailMode?: "default" | "briefing" | "call_prep";
  briefingFocus?: "general" | "handoff" | "blockers" | "missing_docs";
  actor?: EmployeeIdentity | null;
  transport?: string;
}) {
  const resolved =
    input.recordId && input.recordId.trim()
      ? await resolveDirectRecordReference(
          input.recordId.trim(),
          input.actor ?? null,
          input.transport,
        )
      : await resolveRecordOrThrow({
          query: input.recordQuery,
          fieldName: "recordQuery",
          actor: input.actor ?? null,
          transport: input.transport ?? "mcp",
          continuationAction: "records.detail",
          pendingParameters: {
            detailMode: input.detailMode ?? "default",
            briefingFocus: input.briefingFocus ?? "general",
          },
          useActiveRecordContext: input.useActiveRecordContext,
        });

  const detail = await getBlueRecordDetail(resolved.id);
  if (input.actor) {
    await rememberActiveRecordContext({
      actor: input.actor,
      transport: input.transport ?? "mcp",
      recordId: resolved.id,
      recordTitle: resolved.title ?? detail.title,
      listTitle: detail.list,
    });
  }

  const responseText = buildClientDetailResponseText(
    resolved.title ?? detail.title,
    detail,
    input.detailMode ?? "default",
    input.briefingFocus ?? "general",
  );

  return {
    recordId: resolved.id,
    recordTitle: resolved.title ?? detail.title,
    detail,
    briefing: buildClientBriefingInsights(detail),
    responseText,
  };
}

export async function getClientComments(input: {
  recordId?: string;
  recordQuery?: string;
  useActiveRecordContext?: boolean;
  limit?: number;
  actor?: EmployeeIdentity | null;
  transport?: string;
}) {
  const resolved =
    input.recordId && input.recordId.trim()
      ? await resolveDirectRecordReference(
          input.recordId.trim(),
          input.actor ?? null,
          input.transport,
        )
      : await resolveRecordOrThrow({
          query: input.recordQuery,
          fieldName: "recordQuery",
          actor: input.actor ?? null,
          transport: input.transport ?? "mcp",
          continuationAction: "comments.list_recent",
          useActiveRecordContext: input.useActiveRecordContext,
        });

  const detail = await getBlueRecordDetail(resolved.id);
  const comments = detail.recentActivity
    .filter((item) => item.commentText && item.commentText.trim())
    .slice(0, Math.min(input.limit ?? 8, 20))
    .map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      actor: item.actor,
      text: item.commentText ?? "",
    }));

  if (input.actor) {
    await rememberActiveRecordContext({
      actor: input.actor,
      transport: input.transport ?? "mcp",
      recordId: resolved.id,
      recordTitle: resolved.title ?? detail.title,
      listTitle: detail.list,
    });
  }

  return {
    recordId: resolved.id,
    recordTitle: resolved.title ?? detail.title,
    comments,
    responseText: buildCommentsResponseText(
      resolved.title ?? detail.title,
      comments,
    ),
  };
}

export async function getEmployeeDaySummary(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  date?: string;
  transport?: string;
}) {
  const actor = await resolveActorOrThrow(input);
  const date = normalizeDate(input.date);
  return await buildEmployeeDaySummary(actor.employeeId, date);
}

export async function getEmployeeActivityReport(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  date?: string;
  dateStart?: string;
  dateEnd?: string;
  dateLabel?: string;
  focus?: EmployeeActivityFocus;
  transport?: string;
}) {
  const actor = await resolveActorOrThrow(input);
  const range = normalizeActivityDateRange(input);
  const rows =
    range.dateStart === range.dateEnd
      ? await listBotAuditLogsForEmployeeDay({
          employeeId: actor.employeeId,
          dateIso: range.dateStart,
        })
      : await listBotAuditLogsInRange({
          employeeId: actor.employeeId,
          dateStartIso: range.dateStart,
          dateEndIso: range.dateEnd,
        });

  return buildEmployeeActivityReport({
    employeeName: actor.displayName,
    dateStart: range.dateStart,
    dateEnd: range.dateEnd,
    dateLabel: range.dateLabel,
    rows,
    focus: input.focus,
  });
}

export async function getWorkspaceActivityReport(input: {
  date?: string;
  dateStart?: string;
  dateEnd?: string;
  dateLabel?: string;
  focus?: WorkspaceActivityFocus;
}) {
  const range = normalizeActivityDateRange(input);
  const rows =
    range.dateStart === range.dateEnd
      ? await listBotAuditLogsForDay({
          dateIso: range.dateStart,
        })
      : await listBotAuditLogsInRange({
          dateStartIso: range.dateStart,
          dateEndIso: range.dateEnd,
        });

  return buildWorkspaceActivityReport({
    dateStart: range.dateStart,
    dateEnd: range.dateEnd,
    dateLabel: range.dateLabel,
    rows,
    focus: input.focus,
  });
}

export async function getWorkspaceExceptionReport(input: {
  focus?: ExceptionReportFocus;
  employeeName?: string;
}) {
  const rows = await listCachedBlueRecordsForInspection(config.BLUE_WORKSPACE_ID);

  return buildWorkspaceExceptionReport({
    rows,
    focus: input.focus,
    employeeName: input.employeeName,
  });
}

export async function getRecordActivityReport(input: {
  recordId?: string;
  recordQuery?: string;
  useActiveRecordContext?: boolean;
  date?: string;
  dateStart?: string;
  dateEnd?: string;
  dateLabel?: string;
  focus?: RecordActivityFocus;
  actor?: EmployeeIdentity | null;
  transport?: string;
}) {
  const resolved =
    input.recordId && input.recordId.trim()
      ? await resolveDirectRecordReference(
          input.recordId.trim(),
          input.actor ?? null,
          input.transport,
        )
      : await resolveRecordOrThrow({
          query: input.recordQuery,
          fieldName: "recordQuery",
          actor: input.actor ?? null,
          transport: input.transport ?? "mcp",
          continuationAction: "activity.record_report",
          useActiveRecordContext: input.useActiveRecordContext,
        });

  const range = normalizeActivityDateRange(input);
  const rows =
    range.dateStart === range.dateEnd
      ? await listBotAuditLogsForDay({
          dateIso: range.dateStart,
        })
      : await listBotAuditLogsInRange({
          dateStartIso: range.dateStart,
          dateEndIso: range.dateEnd,
        });

  return buildRecordActivityReport({
    recordId: resolved.id,
    recordTitle: resolved.title,
    dateStart: range.dateStart,
    dateEnd: range.dateEnd,
    dateLabel: range.dateLabel,
    rows,
    focus: input.focus,
  });
}

export async function getTeamDaySummary(input: {
  date?: string;
  inactiveOnly?: boolean;
}) {
  const date = normalizeDate(input.date);
  return input.inactiveOnly
    ? await buildNoActivitySummary(date)
    : await buildTeamDaySummary(date);
}

export async function getTeamFollowUpQueue(input: {
  date?: string;
  limitPerEmployee?: number;
}) {
  const referenceDate = normalizeDate(input.date);
  const limitPerEmployee = Math.max(1, Math.min(input.limitPerEmployee ?? 5, 12));
  const employees = await listEmployees();
  const employeeSummaries = [];

  for (const employee of employees) {
    const { items, pageInfo } = await loadAssignedOpenRecords(employee.id);
    const priorities = buildFollowUpPriorityQueue(items, referenceDate);

    if (priorities.prioritized.length === 0) {
      continue;
    }

    employeeSummaries.push({
      employeeId: employee.id,
      employeeName: employee.display_name,
      overdueCount: priorities.overdue.length,
      dueTodayCount: priorities.dueToday.length,
      staleCount: priorities.stale.length,
      totalPriorityCount: priorities.prioritized.length,
      items: priorities.prioritized.slice(0, limitPerEmployee),
      hasMore: Boolean(
        pageInfo.hasNextPage || priorities.prioritized.length > limitPerEmployee,
      ),
    });
  }

  employeeSummaries.sort(
    (left, right) =>
      right.overdueCount - left.overdueCount ||
      right.dueTodayCount - left.dueTodayCount ||
      right.staleCount - left.staleCount ||
      left.employeeName.localeCompare(right.employeeName),
  );

  const overdueEmployeeCount = employeeSummaries.filter(
    (employee) => employee.overdueCount > 0,
  ).length;
  const responseText =
    employeeSummaries.length === 0
      ? `No employees have overdue, due-today, or stale Blue files on ${referenceDate}.`
      : [
          `Team follow-up queue on ${referenceDate}`,
          `Employees with overdue files: ${overdueEmployeeCount}`,
          ...employeeSummaries.map((employee, index) => {
            const itemLines = employee.items.map(
              (item, itemIndex) =>
                `   ${itemIndex + 1}. ${item.title} (${item.listTitle}) - ${item.reason}`,
            );
            return [
              `${index + 1}. ${employee.employeeName}: ${employee.overdueCount} overdue, ${employee.dueTodayCount} due today, ${employee.staleCount} stale`,
              ...itemLines,
              employee.hasMore ? "   More priority files may be available." : null,
            ]
              .filter(Boolean)
              .join("\n");
          }),
        ].join("\n");

  return {
    date: referenceDate,
    responseText,
    employees: employeeSummaries,
  };
}

export async function getEmployeeWorkload(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  transport?: string;
}) {
  const actor = await resolveActorOrThrow(input);
  const { items, pageInfo } = await loadAssignedOpenRecords(actor.employeeId);
  const totalItems = pageInfo.totalItems ?? items.length;
  const responseText =
    items.length === 0
      ? `${actor.displayName} has no open Blue records right now.`
      : [
          `${actor.displayName} has ${totalItems} open Blue record${
            totalItems === 1 ? "" : "s"
          }.`,
          ...items.slice(0, 12).map(
            (item, index) =>
              `${index + 1}. ${item.title} (${item.listTitle})${
                item.dueAt ? ` due ${item.dueAt.slice(0, 10)}` : ""
              }`,
          ),
          pageInfo.hasNextPage
            ? `Showing the first ${items.length} records. More are available.`
            : null,
        ]
          .filter(Boolean)
          .join("\n");

  return {
    employeeId: actor.employeeId,
    employeeName: actor.displayName,
    responseText,
    items,
    pageInfo,
  };
}

export async function getEmployeeAssignmentReport(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  status?: "open" | "completed" | "all";
  transport?: string;
}) {
  const actor = await resolveActorOrThrow(input);
  const status = input.status ?? "open";
  const { items, pageInfo } = await loadAssignedChecklistItems(
    actor.employeeId,
    status,
  );
  const responseText = buildAssignmentReportResponseText({
    employeeName: actor.displayName,
    status,
    items,
    totalItems: pageInfo.totalItems ?? items.length,
    hasNextPage: pageInfo.hasNextPage,
  });

  return {
    employeeId: actor.employeeId,
    employeeName: actor.displayName,
    status,
    responseText,
    items,
    pageInfo,
  };
}

export async function getEmployeeFollowUpQueue(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  date?: string;
  transport?: string;
}) {
  const actor = await resolveActorOrThrow(input);
  const referenceDate = normalizeDate(input.date);
  const { items, pageInfo } = await loadAssignedOpenRecords(actor.employeeId);
  const priorities = buildFollowUpPriorityQueue(items, referenceDate);
  const responseText = buildFollowUpQueueResponseText(
    actor.displayName,
    referenceDate,
    priorities,
    pageInfo.hasNextPage,
  );

  return {
    employeeId: actor.employeeId,
    employeeName: actor.displayName,
    date: referenceDate,
    responseText,
    ...priorities,
    pageInfo,
  };
}

export async function getEmployeeNotificationFeed(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  date?: string;
  transport?: string;
}) {
  const actor = await resolveActorOrThrow(input);
  const referenceDate = normalizeDate(input.date);
  const mentionWindowStart = shiftIsoDate(referenceDate, -30);
  const [{ items: workload }, { items: assignments }, mentionState, recentMentions] =
    await Promise.all([
      loadAssignedOpenRecords(actor.employeeId),
      loadAssignedChecklistItems(actor.employeeId, "open"),
      getEmployeeNotificationState(actor.employeeId),
      listMentionsForUser({
        employeeName: actor.displayName,
        dateStart: mentionWindowStart,
        dateEnd: referenceDate,
        limit: 25,
      }),
    ]);

  const unreadMentions = recentMentions.filter((row) =>
    mentionState?.mentions_seen_through
      ? row.occurred_at > mentionState.mentions_seen_through
      : true,
  );
  const staleAssignedFiles = workload
    .filter((item) => {
      const updatedDate = isoDay(item.updatedAt);
      return Boolean(updatedDate && updatedDate <= shiftIsoDate(referenceDate, -5));
    })
    .sort((left, right) => sortByDate(left.updatedAt, right.updatedAt))
    .slice(0, 8);
  const overdueChecklistItems = assignments
    .filter(
      (item) =>
        item.type === "checklist" &&
        item.dueAt != null &&
        isoDay(item.dueAt) != null &&
        isoDay(item.dueAt)! < referenceDate &&
        item.done === false,
    )
    .sort((left, right) => sortByDate(left.dueAt, right.dueAt))
    .slice(0, 8);
  const recentlyChangedAssignedFiles = [...workload]
    .filter((item) => Boolean(item.updatedAt))
    .sort((left, right) => sortByDate(right.updatedAt, left.updatedAt))
    .slice(0, 8);

  return {
    employeeId: actor.employeeId,
    employeeName: actor.displayName,
    date: referenceDate,
    lastMentionsReadAt: mentionState?.mentions_seen_through ?? null,
    responseText: [
      `Notifications for ${actor.displayName}:`,
      `- Unread mentions: ${unreadMentions.length}`,
      `- Stale assigned files: ${staleAssignedFiles.length}`,
      `- Overdue checklist items: ${overdueChecklistItems.length}`,
      `- Recently changed assigned files: ${recentlyChangedAssignedFiles.length}`,
    ].join("\n"),
    unreadMentions,
    staleAssignedFiles,
    overdueChecklistItems,
    recentlyChangedAssignedFiles,
  };
}

export async function getEmployeeDailyBrief(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  date?: string;
  mentionLookbackDays?: number;
  transport?: string;
}) {
  const actor = await resolveActorOrThrow(input);
  const date = normalizeDate(input.date);
  const mentionLookbackDays = Math.max(1, Math.min(input.mentionLookbackDays ?? 7, 30));

  const [workload, assignments, followUp, notifications, summary] = await Promise.all([
    loadAssignedOpenRecords(actor.employeeId),
    loadAssignedChecklistItems(actor.employeeId, "open"),
    buildDailyBriefFollowUp(actor.employeeId, date),
    getEmployeeNotificationFeed({
      employeeId: actor.employeeId,
      employeeName: actor.displayName,
      date,
      transport: input.transport,
    }),
    buildEmployeeDaySummary(actor.employeeId, date),
  ]);

  const workloadTotal = workload.pageInfo.totalItems ?? workload.items.length;
  const assignmentTotal = assignments.pageInfo.totalItems ?? assignments.items.length;
  const responseText = buildDailyBriefResponseText({
    employeeName: actor.displayName,
    date,
    mentionLookbackDays,
    workloadTotal,
    assignmentTotal,
    followUp,
    mentions: notifications.unreadMentions,
    summary,
  });

  return {
    employeeId: actor.employeeId,
    employeeName: actor.displayName,
    date,
    mentionLookbackDays,
    responseText,
    snapshot: {
      openRecords: workloadTotal,
      openAssignments: assignmentTotal,
      priorityItems: followUp.prioritized.length,
      mentions: notifications.unreadMentions.length,
      activityEvents: summary.eventCount,
    },
    workload: {
      items: workload.items,
      pageInfo: workload.pageInfo,
    },
    assignments: {
      status: "open" as const,
      items: assignments.items,
      pageInfo: assignments.pageInfo,
    },
    followUp,
    mentions: {
      rows: notifications.unreadMentions,
    },
    notifications,
    summary,
  };
}

export async function moveClientToStage(input: {
  recordId?: string;
  recordQuery?: string;
  targetListQuery: string;
  useActiveRecordContext?: boolean;
  actor?: EmployeeIdentity | null;
  blueAuth?: BlueRequestAuth | null;
  transport?: string;
}) {
  assertNoBulkDestructiveWrite(
    `move ${input.recordQuery ?? input.recordId ?? ""} to ${input.targetListQuery}`,
  );
  const writeAuth = resolveBlueWriteAuth(input.blueAuth);
  const record =
    input.recordId && input.recordId.trim()
      ? await resolveDirectRecordReference(
          input.recordId.trim(),
          input.actor ?? null,
          input.transport,
        )
      : await resolveRecordOrThrow({
          query: input.recordQuery,
          fieldName: "recordQuery",
          actor: input.actor ?? null,
          transport: input.transport ?? "mcp",
          continuationAction: "records.move",
          pendingParameters: {
            targetListQuery: input.targetListQuery,
          },
          useActiveRecordContext: input.useActiveRecordContext,
          requireExactMatch: true,
        });
  const list = await resolveListOrThrow(input.targetListQuery);
  const indexedRecord = await getIndexedRecord(record.id);

  if (indexedRecord?.listId === list.id) {
    return {
      ok: true,
      skipped: true,
      recordId: record.id,
      recordTitle: record.title,
      targetListId: list.id,
      targetListTitle: list.title,
      responseText: `${record.title} is already in ${list.title}.`,
    };
  }

  const result = await executeBlueWrite(() =>
    moveRecord({
      workspaceId: config.BLUE_WORKSPACE_ID,
      recordId: record.id,
      targetListId: list.id,
      auth: writeAuth,
    }),
  );

  if (!result.ok) {
    throw new ValidationError(`Blue could not move ${record.title}.`);
  }

  await syncWorkspaceIndex({ auth: writeAuth });

  if (input.actor) {
    await rememberActiveRecordContext({
      actor: input.actor,
      transport: input.transport ?? "mcp",
      recordId: record.id,
      recordTitle: record.title,
      listTitle: list.title,
    });
  }

  return {
    ok: true,
    recordId: record.id,
    recordTitle: record.title,
    targetListId: list.id,
    targetListTitle: list.title,
    responseText: `Moved ${record.title} to ${list.title}.`,
  };
}

export async function addCommentToClient(input: {
  recordId?: string;
  recordQuery?: string;
  text: string;
  useActiveRecordContext?: boolean;
  actor?: EmployeeIdentity | null;
  blueAuth?: BlueRequestAuth | null;
  transport?: string;
}) {
  const writeAuth = resolveBlueWriteAuth(input.blueAuth);
  const record =
    input.recordId && input.recordId.trim()
      ? await resolveDirectRecordReference(
          input.recordId.trim(),
          input.actor ?? null,
          input.transport,
        )
      : await resolveRecordOrThrow({
          query: input.recordQuery,
          fieldName: "recordQuery",
          actor: input.actor ?? null,
          transport: input.transport ?? "mcp",
          continuationAction: "comments.create",
          pendingParameters: {
            text: input.text.trim(),
          },
          useActiveRecordContext: input.useActiveRecordContext,
          requireExactMatch: true,
        });
  const comment = await executeBlueWrite(() =>
    createComment({
      workspaceId: config.BLUE_WORKSPACE_ID,
      recordId: record.id,
      text: input.text.trim(),
      auth: writeAuth,
    }),
  );

  if (input.actor) {
    await rememberActiveRecordContext({
      actor: input.actor,
      transport: input.transport ?? "mcp",
      recordId: record.id,
      recordTitle: record.title,
      listTitle: record.listTitle,
    });
  }

  return {
    recordId: record.id,
    recordTitle: record.title,
    text: input.text.trim(),
    comment,
    responseText: `Added comment to ${record.title}.`,
  };
}

export async function createClientRecord(input: {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  phone?: string;
  email?: string;
  financeAmount?: number;
  notes?: string;
  targetListQuery?: string;
  actor?: EmployeeIdentity | null;
  blueAuth?: BlueRequestAuth | null;
  transport?: string;
}) {
  const writeAuth = resolveBlueWriteAuth(input.blueAuth);
  const list = await resolveListOrThrow(input.targetListQuery || "🧰 0 - Leads/Tasks");
  const record = await executeBlueWrite(() =>
    createLeadRecord({
      workspaceId: config.BLUE_WORKSPACE_ID,
      listId: list.id,
      firstName: input.firstName?.trim(),
      lastName: input.lastName?.trim(),
      fullName: input.fullName?.trim(),
      phone: input.phone?.trim(),
      email: input.email?.trim(),
      financeAmount: input.financeAmount,
      notes: input.notes?.trim(),
      auth: writeAuth,
    }),
  );
  await syncWorkspaceIndex({ auth: writeAuth });

  if (input.actor) {
    await rememberActiveRecordContext({
      actor: input.actor,
      transport: input.transport ?? "mcp",
      recordId: record.id,
      recordTitle: record.title,
      listTitle: record.todoList.title,
    });
  }

  return {
    recordId: record.id,
    recordTitle: record.title,
    listId: list.id,
    listTitle: list.title,
    responseText: `Created ${record.title} in ${list.title}.`,
  };
}

export async function assignRecord(input: {
  recordId?: string;
  entityQuery?: string;
  assigneeName: string;
  useActiveRecordContext?: boolean;
  actor?: EmployeeIdentity | null;
  blueAuth?: BlueRequestAuth | null;
  transport?: string;
}) {
  assertNoBulkDestructiveWrite(
    `assign ${input.entityQuery ?? input.recordId ?? ""} to ${input.assigneeName}`,
  );
  const writeAuth = resolveBlueWriteAuth(input.blueAuth);
  const record = await resolveRecordOrThrow({
    query: input.entityQuery,
    fieldName: "entityQuery",
    actor: input.actor ?? null,
    transport: input.transport ?? "mcp",
    continuationAction: "records.assign",
    pendingParameters: {
      assigneeName: input.assigneeName,
    },
    useActiveRecordContext: input.useActiveRecordContext,
    requireExactMatch: true,
  });

  const assignee = await resolveActorIdentityService({
    employeeName: input.assigneeName,
    transport: input.transport ?? "mcp",
  });

  await executeBlueWrite(() =>
    setTodoAssignees({
      workspaceId: config.BLUE_WORKSPACE_ID,
      todoId: record.id,
      assigneeIds: [assignee.employeeId],
      auth: writeAuth,
    }),
  );

  return {
    ok: true,
    recordId: record.id,
    recordTitle: record.title,
    assigneeId: assignee.employeeId,
    assigneeName: assignee.displayName,
    responseText: `Assigned ${record.title} to ${assignee.displayName}.`,
  };
}

export async function assignTask(input: {
  recordId?: string;
  entityQuery?: string;
  assigneeName: string;
  useActiveRecordContext?: boolean;
  actor?: EmployeeIdentity | null;
  blueAuth?: BlueRequestAuth | null;
  transport?: string;
}) {
  assertNoBulkDestructiveWrite(
    `assign ${input.entityQuery ?? input.recordId ?? ""} to ${input.assigneeName}`,
  );
  const writeAuth = resolveBlueWriteAuth(input.blueAuth);
  const record = await resolveRecordOrThrow({
    query: input.entityQuery,
    fieldName: "entityQuery",
    actor: input.actor ?? null,
    transport: input.transport ?? "mcp",
    continuationAction: "tasks.assign",
    pendingParameters: {
      assigneeName: input.assigneeName,
    },
    useActiveRecordContext: input.useActiveRecordContext,
    requireExactMatch: true,
  });

  const assignee = await resolveActorIdentityService({
    employeeName: input.assigneeName,
    transport: input.transport ?? "mcp",
  });

  // Load record detail to find the checklist item
  const detail = await fetchRecordDetail(config.BLUE_WORKSPACE_ID, record.id);
  const checklists = detail.record?.checklists ?? [];
  let targetItem: { id: string; title: string } | null = null;

  // Simple heuristic: search for item by name in all checklists
  for (const checklist of checklists) {
    for (const item of checklist.items) {
      if (
        item.title.toLowerCase().includes(input.entityQuery?.toLowerCase() || "")
      ) {
        targetItem = item;
        break;
      }
    }
    if (targetItem) break;
  }

  if (!targetItem) {
    throw new ValidationError(
      `Could not find a task matching "${input.entityQuery}" in ${record.title}.`,
    );
  }

  await executeBlueWrite(() =>
    setChecklistItemAssignees({
      workspaceId: config.BLUE_WORKSPACE_ID,
      todoChecklistItemId: targetItem.id,
      assigneeIds: [assignee.employeeId],
      auth: writeAuth,
    }),
  );

  return {
    ok: true,
    recordId: record.id,
    taskId: targetItem.id,
    taskTitle: targetItem.title,
    assigneeId: assignee.employeeId,
    assigneeName: assignee.displayName,
    responseText: `Assigned task "${targetItem.title}" to ${assignee.displayName}.`,
  };
}

export async function completeRecordAssignment(input: {
  entityQuery?: string;
  useActiveRecordContext?: boolean;
  actor?: EmployeeIdentity | null;
  blueAuth?: BlueRequestAuth | null;
  transport?: string;
}) {
  assertNoBulkDestructiveWrite(`complete ${input.entityQuery ?? ""}`);
  const writeAuth = resolveBlueWriteAuth(input.blueAuth);
  const record = await resolveRecordOrThrow({
    query: input.entityQuery,
    fieldName: "entityQuery",
    actor: input.actor ?? null,
    transport: input.transport ?? "mcp",
    continuationAction: "records.complete",
    useActiveRecordContext: input.useActiveRecordContext,
    requireExactMatch: true,
  });

  await executeBlueWrite(() =>
    updateTodoFields({
      workspaceId: config.BLUE_WORKSPACE_ID,
      todoIds: [record.id],
      done: true,
      auth: writeAuth,
    }),
  );

  return {
    ok: true,
    recordId: record.id,
    recordTitle: record.title,
    responseText: `Marked ${record.title} as done.`,
  };
}

export async function completeTaskAssignment(input: {
  recordQuery?: string;
  taskQuery: string;
  useActiveRecordContext?: boolean;
  actor?: EmployeeIdentity | null;
  blueAuth?: BlueRequestAuth | null;
  transport?: string;
}) {
  assertNoBulkDestructiveWrite(
    `complete ${input.taskQuery} on ${input.recordQuery ?? ""}`,
  );
  const writeAuth = resolveBlueWriteAuth(input.blueAuth);
  const { taskItem, record } = await resolveChecklistItemOrThrow({
    recordQuery: input.recordQuery,
    taskQuery: input.taskQuery,
    actor: input.actor ?? null,
    transport: input.transport ?? "mcp",
    useActiveRecordContext: input.useActiveRecordContext,
    continuationAction: "tasks.complete",
  });

  await executeBlueWrite(() =>
    editChecklistItem({
      workspaceId: config.BLUE_WORKSPACE_ID,
      checklistItemId: taskItem.id,
      done: true,
      auth: writeAuth,
    }),
  );

  return {
    ok: true,
    recordId: record.id,
    recordTitle: record.title,
    taskId: taskItem.id,
    taskTitle: taskItem.title,
    responseText: `Marked task "${taskItem.title}" as done on ${record.title}.`,
  };
}

export async function setRecordDueDate(input: {
  entityQuery?: string;
  dueDate: string;
  useActiveRecordContext?: boolean;
  actor?: EmployeeIdentity | null;
  blueAuth?: BlueRequestAuth | null;
  transport?: string;
}) {
  assertNoBulkDestructiveWrite(
    `set ${input.entityQuery ?? ""} due date to ${input.dueDate}`,
  );
  const writeAuth = resolveBlueWriteAuth(input.blueAuth);
  const record = await resolveRecordOrThrow({
    query: input.entityQuery,
    fieldName: "entityQuery",
    actor: input.actor ?? null,
    transport: input.transport ?? "mcp",
    continuationAction: "records.set_due_date",
    pendingParameters: {
      dueDate: input.dueDate,
    },
    useActiveRecordContext: input.useActiveRecordContext,
    requireExactMatch: true,
  });
  const dueAt = toDueDateIso(input.dueDate);

  await executeBlueWrite(() =>
    updateTodoFields({
      workspaceId: config.BLUE_WORKSPACE_ID,
      todoIds: [record.id],
      duedAt: dueAt,
      auth: writeAuth,
    }),
  );

  return {
    ok: true,
    recordId: record.id,
    recordTitle: record.title,
    dueAt,
    responseText: `Set the due date for ${record.title} to ${dueAt.slice(0, 10)}.`,
  };
}

export async function setTaskDueDate(input: {
  recordQuery?: string;
  taskQuery: string;
  dueDate: string;
  useActiveRecordContext?: boolean;
  actor?: EmployeeIdentity | null;
  blueAuth?: BlueRequestAuth | null;
  transport?: string;
}) {
  assertNoBulkDestructiveWrite(
    `set ${input.taskQuery} on ${input.recordQuery ?? ""} due date to ${input.dueDate}`,
  );
  const writeAuth = resolveBlueWriteAuth(input.blueAuth);
  const { taskItem, record } = await resolveChecklistItemOrThrow({
    recordQuery: input.recordQuery,
    taskQuery: input.taskQuery,
    actor: input.actor ?? null,
    transport: input.transport ?? "mcp",
    useActiveRecordContext: input.useActiveRecordContext,
    continuationAction: "tasks.set_due_date",
    pendingParameters: {
      dueDate: input.dueDate,
    },
  });
  const dueAt = toDueDateIso(input.dueDate);

  await executeBlueWrite(() =>
    updateChecklistItemDueDate({
      workspaceId: config.BLUE_WORKSPACE_ID,
      checklistItemId: taskItem.id,
      duedAt: dueAt,
      auth: writeAuth,
    }),
  );

  return {
    ok: true,
    recordId: record.id,
    recordTitle: record.title,
    taskId: taskItem.id,
    taskTitle: taskItem.title,
    dueAt,
    responseText: `Set the due date for task "${taskItem.title}" on ${record.title} to ${dueAt.slice(0, 10)}.`,
  };
}

export async function resolveActorOrThrow(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  transport?: string;
}) {
  return await resolveActorIdentityService({
    employeeId: input.employeeId,
    employeeEmail: input.employeeEmail,
    employeeName: input.employeeName,
    transport: input.transport ?? "mcp",
    autoLinkByEmail: true,
  });
}

export {
  answerReportingQuestion,
  getReportingOverview,
};

type WorkloadItem = {
  id: string;
  title: string;
  listTitle: string;
  dueAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  commentCount: number;
  done: boolean;
  archived: boolean;
};

type AssignmentItem = {
  id: string;
  type: "checklist" | "record";
  title: string;
  done: boolean;
  dueAt: string | null;
  updatedAt: string | null;
  assigneeNames: string[];
  checklistTitle: string;
  recordId: string;
  recordTitle: string;
  listTitle: string;
};

type FollowUpPriorityItem = WorkloadItem & {
  priority: "overdue" | "due_today" | "stale";
  reason: string;
};

type ResolvedChecklistTask = {
  record: {
    id: string;
    title: string;
    listTitle: string;
  };
  taskItem: {
    id: string;
    title: string;
    checklistId: string;
    checklistTitle: string;
  };
};

interface RecordResolutionInput {
  query?: string;
  fieldName: string;
  actor?: EmployeeIdentity | null;
  transport: string;
  continuationAction: string;
  pendingParameters?: Record<string, unknown>;
  useActiveRecordContext?: boolean;
  requireExactMatch?: boolean;
}

async function resolveRecordOrThrow(input: RecordResolutionInput) {
  if (input.useActiveRecordContext) {
    const active = await resolveActiveRecordContextOrThrow(
      input.actor ?? null,
      input.transport,
      input.fieldName,
    );
    return {
      id: active.recordId,
      title: active.recordTitle,
      listTitle: active.listTitle ?? "",
    };
  }

  if (!input.query || !input.query.trim()) {
    throw new ValidationError(`Missing required parameter: ${input.fieldName}`);
  }

  if (input.actor && !input.requireExactMatch) {
    const pendingSelection = await resolvePendingRecordChoice({
      actor: input.actor,
      transport: input.transport,
      message: input.query.trim(),
    });
    if (pendingSelection) {
      await clearPendingRecordChoiceForActor(input.actor, input.transport);
      await rememberActiveRecordContext({
        actor: input.actor,
        transport: input.transport,
        recordId: pendingSelection.candidate.id,
        recordTitle: pendingSelection.candidate.title,
        listTitle: pendingSelection.candidate.listTitle ?? "",
      });
      return {
        id: pendingSelection.candidate.id,
        title: pendingSelection.candidate.title,
        listTitle: pendingSelection.candidate.listTitle ?? "",
      };
    }
  }

  const originalQuery = input.query.trim();
  const trimmedQuery = normalizeRecordLookupQuery(originalQuery);
  const normalizedQuery = normalizeCacheQuery(trimmedQuery);
  if (input.actor && input.requireExactMatch) {
    const assignedRecords = await loadAssignedOpenRecords(input.actor.employeeId);
    const exactAssignedMatches = assignedRecords.items
      .filter((candidate) => normalizeCacheQuery(candidate.title) === normalizedQuery)
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        listTitle: candidate.listTitle,
      }));

    if (exactAssignedMatches.length === 1) {
      const match = exactAssignedMatches[0];
      await clearPendingRecordChoiceForActor(input.actor, input.transport);
      await rememberActiveRecordContext({
        actor: input.actor,
        transport: input.transport,
        recordId: match.id,
        recordTitle: match.title,
        listTitle: match.listTitle,
      });
      return match;
    }

    if (exactAssignedMatches.length > 1) {
      throw new ValidationError(
        formatCandidates(
          exactAssignedMatches.map((candidate) =>
            candidate.listTitle
              ? `${candidate.title} (${candidate.listTitle})`
              : candidate.title,
          ),
          `Multiple assigned records matched "${originalQuery}". Be more specific.`,
        ),
      );
    }
  }

  let exactMatches = (await searchRecordQuery(trimmedQuery, 20)).filter(
    (candidate) => normalizeCacheQuery(candidate.title) === normalizedQuery,
  );

  if (exactMatches.length === 1) {
    const match = exactMatches[0];

    if (input.actor) {
      await clearPendingRecordChoiceForActor(input.actor, input.transport);
      await rememberActiveRecordContext({
        actor: input.actor,
        transport: input.transport,
        recordId: match.id,
        recordTitle: match.title,
        listTitle: match.listTitle,
      });
    }

    return match;
  }

  if (exactMatches.length > 1) {
    throw new ValidationError(
      formatCandidates(
        exactMatches.map((candidate) =>
          candidate.listTitle
            ? `${candidate.title} (${candidate.listTitle})`
            : candidate.title,
        ),
        `Multiple exact records matched "${originalQuery}". Be more specific.`,
      ),
    );
  }

  if (input.requireExactMatch) {
    await syncWorkspaceIndex();
    exactMatches = (await searchRecordQuery(trimmedQuery, 20)).filter(
      (candidate) => normalizeCacheQuery(candidate.title) === normalizedQuery,
    );

    if (exactMatches.length === 1) {
      const match = exactMatches[0];

      if (input.actor) {
        await clearPendingRecordChoiceForActor(input.actor, input.transport);
        await rememberActiveRecordContext({
          actor: input.actor,
          transport: input.transport,
          recordId: match.id,
          recordTitle: match.title,
          listTitle: match.listTitle,
        });
      }

      return match;
    }

    if (exactMatches.length > 1) {
      throw new ValidationError(
        formatCandidates(
          exactMatches.map((candidate) =>
            candidate.listTitle
              ? `${candidate.title} (${candidate.listTitle})`
              : candidate.title,
          ),
          `Multiple exact records matched "${originalQuery}". Be more specific.`,
        ),
      );
    }

    const nearbyCandidates = await searchRecordQuery(trimmedQuery, 5);
    throw new ValidationError(
      nearbyCandidates.length
        ? formatCandidates(
            nearbyCandidates.map((candidate) =>
              candidate.listTitle
                ? `${candidate.title} (${candidate.listTitle})`
                : candidate.title,
            ),
            `I could not find an exact record title match for "${originalQuery}". Re-run the command with one of these current titles:`,
          )
        : `I could not find an exact record title match for "${originalQuery}". Re-run the command with the full current client title.`,
    );
  }

  let resolution = await resolveRecordQuery(trimmedQuery);
  if (!resolution) {
    await syncWorkspaceIndex();
    exactMatches = (await searchRecordQuery(trimmedQuery, 20)).filter(
      (candidate) => normalizeCacheQuery(candidate.title) === normalizedQuery,
    );

    if (exactMatches.length === 1) {
      const match = exactMatches[0];

      if (input.actor) {
        await clearPendingRecordChoiceForActor(input.actor, input.transport);
        await rememberActiveRecordContext({
          actor: input.actor,
          transport: input.transport,
          recordId: match.id,
          recordTitle: match.title,
          listTitle: match.listTitle,
        });
      }

      return match;
    }

    if (exactMatches.length > 1) {
      throw new ValidationError(
        formatCandidates(
          exactMatches.map((candidate) =>
            candidate.listTitle
              ? `${candidate.title} (${candidate.listTitle})`
              : candidate.title,
          ),
          `Multiple exact records matched "${originalQuery}". Be more specific.`,
        ),
      );
    }

    resolution = await resolveRecordQuery(trimmedQuery);
  }
  if (!resolution) {
    throw new ValidationError(
      `No cached Blue record matched "${originalQuery}". Sync the workspace index and try again.`,
    );
  }

  if (!resolution.match) {
    if (input.actor) {
      await rememberPendingRecordChoice({
        actor: input.actor,
        transport: input.transport,
        continuationAction: input.continuationAction,
        originalQuery,
        pendingParameters: input.pendingParameters,
        candidates: resolution.candidates,
      });
    }
    throw new ValidationError(
      formatCandidates(
        resolution.candidates.map((candidate) =>
          candidate.listTitle
            ? `${candidate.title} (${candidate.listTitle})`
            : candidate.title,
        ),
        `Multiple records matched "${originalQuery}". Be more specific.`,
      ),
    );
  }

  if (input.actor) {
    await clearPendingRecordChoiceForActor(input.actor, input.transport);
    await rememberActiveRecordContext({
      actor: input.actor,
      transport: input.transport,
      recordId: resolution.match.id,
      recordTitle: resolution.match.title,
      listTitle: resolution.match.listTitle,
    });
  }

  return resolution.match;
}

function assertNoBulkDestructiveWrite(message: string) {
  const safetyBlock = getPreAuthSafetyBlock(message);
  if (safetyBlock) {
    throw new ValidationError(safetyBlock.responseText);
  }
}

function normalizeRecordLookupQuery(query: string) {
  const cleaned = query
    .trim()
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\s+(?:client|file|lead|record)$/i, "")
    .trim();
  const normalized = normalizeCacheQuery(cleaned);

  if (
    normalized === "smoke test" ||
    normalized === "aya smoke test" ||
    normalized === "aya smoke" ||
    normalized.endsWith(" smoke test")
  ) {
    return "AYA SMOKE TEST";
  }

  return cleaned || query.trim();
}

async function resolveDirectRecordReference(
  recordId: string,
  actor?: EmployeeIdentity | null,
  transport?: string,
) {
  const cached = await getIndexedRecord(recordId);
  if (cached && actor) {
    await rememberActiveRecordContext({
      actor,
      transport: transport ?? "mcp",
      recordId: cached.id,
      recordTitle: cached.title,
      listTitle: cached.listTitle,
    });
  }

  return {
    id: recordId,
    title: cached?.title ?? recordId,
    listTitle: cached?.listTitle ?? "",
  };
}

async function resolveActiveRecordContextOrThrow(
  actor: EmployeeIdentity | null,
  transport: string,
  fieldName: string,
) {
  if (!actor) {
    throw new ValidationError(`Missing required parameter: ${fieldName}`);
  }

  const active = await getActiveRecordContextForActor(actor, transport);
  if (!active) {
    throw new ValidationError(
      "I need the client name first. Ask me to open or summarize the client, then try again.",
    );
  }

  return active;
}

async function resolveChecklistItemOrThrow(input: {
  recordQuery?: string;
  taskQuery: string;
  actor?: EmployeeIdentity | null;
  transport: string;
  continuationAction: string;
  pendingParameters?: Record<string, unknown>;
  useActiveRecordContext?: boolean;
}): Promise<ResolvedChecklistTask> {
  const record = await resolveRecordOrThrow({
    query: input.recordQuery,
    fieldName: "recordQuery",
    actor: input.actor ?? null,
    transport: input.transport,
    continuationAction: input.continuationAction,
    pendingParameters: {
      taskQuery: input.taskQuery,
      ...(input.pendingParameters ?? {}),
    },
    useActiveRecordContext: input.useActiveRecordContext,
    requireExactMatch: true,
  });

  const detail = await fetchRecordDetail(config.BLUE_WORKSPACE_ID, record.id);
  const normalizedTask = normalizeCacheQuery(input.taskQuery);

  for (const checklist of detail.record?.checklists ?? []) {
    for (const item of checklist.items) {
      const normalizedTitle = normalizeCacheQuery(item.title);
      if (normalizedTitle === normalizedTask || normalizedTitle.includes(normalizedTask)) {
        return {
          record,
          taskItem: {
            id: item.id,
            title: item.title,
            checklistId: checklist.id,
            checklistTitle: checklist.title,
          },
        };
      }
    }
  }

  throw new ValidationError(
    `Could not find a task matching "${input.taskQuery}" in ${record.title}.`,
  );
}

async function resolveListOrThrow(query: string) {
  if (!query.trim()) {
    throw new ValidationError("Missing required parameter: targetListQuery");
  }

  const resolution = await resolveListQuery(query.trim());
  if (!resolution) {
    throw new ValidationError(
      `No cached Blue list matched "${query}". Sync the workspace index and try again.`,
    );
  }

  if (!resolution.match) {
    throw new ValidationError(
      formatCandidates(
        resolution.candidates.map((candidate) => candidate.title),
        `Multiple lists matched "${query}". Be more specific.`,
      ),
    );
  }

  return resolution.match;
}

async function executeBlueWrite<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (isBlueWriteAuthRejected(error)) {
      throw new ValidationError(BLUE_WRITE_AUTH_REJECTED_MESSAGE);
    }
    throw error;
  }
}

function isBlueWriteAuthRejected(error: unknown) {
  if (!(error instanceof ExternalServiceError)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const details = error.details as
    | { message?: string; extensions?: Record<string, unknown> }
    | undefined;
  const code = String(details?.extensions?.code ?? "").toUpperCase();
  const detailMessage = String(details?.message ?? "").toLowerCase();

  return (
    code === "UNAUTHENTICATED" ||
    message.includes("not authenticated") ||
    message.includes("unauthorized") ||
    detailMessage.includes("not authenticated") ||
    detailMessage.includes("unauthorized")
  );
}

function buildCommentsResponseText(
  recordTitle: string,
  comments: Array<{
    occurredAt: string;
    actor: string;
    text: string;
  }>,
) {
  if (comments.length === 0) {
    return `${recordTitle} has no recent comments recorded.`;
  }

  return [
    `Recent comments for ${recordTitle}:`,
    ...comments.map(
      (comment, index) =>
        `${index + 1}. ${comment.actor} (${comment.occurredAt.slice(0, 10)}): ${comment.text}`,
    ),
  ].join("\n");
}

async function loadAssignedOpenRecords(
  assigneeId: string,
): Promise<{ items: WorkloadItem[]; pageInfo: BluePageInfo }> {
  const result = await listAssignedOpenRecords({
    workspaceId: config.BLUE_WORKSPACE_ID,
    companyId: config.BLUE_COMPANY_ID,
    assigneeId,
    limit: 50,
    skip: 0,
  });

  return {
    items: result.items.map(toWorkloadItem),
    pageInfo: {
      hasNextPage: Boolean(result.pageInfo.hasNextPage),
      hasPreviousPage: Boolean(result.pageInfo.hasPreviousPage),
      totalItems: result.pageInfo.totalItems ?? undefined,
      page: result.pageInfo.page ?? undefined,
      perPage: result.pageInfo.perPage ?? undefined,
    },
  };
}

async function loadAssignedChecklistItems(
  assigneeId: string,
  status: "open" | "completed" | "all",
): Promise<{ items: AssignmentItem[]; pageInfo: BluePageInfo }> {
  const [checklistResult, recordsResult] = await Promise.all([
    listAssignedChecklistItems({
      workspaceId: config.BLUE_WORKSPACE_ID,
      assigneeId,
      done:
        status === "open"
          ? false
          : status === "completed"
            ? true
            : undefined,
      todoDone: status === "open" ? false : undefined,
      limit: 50,
      skip: 0,
    }),
    status !== "completed"
      ? listAssignedOpenRecords({
          workspaceId: config.BLUE_WORKSPACE_ID,
          companyId: config.BLUE_COMPANY_ID,
          assigneeId,
          limit: 50,
          skip: 0,
        })
      : Promise.resolve({
          items: [] as BlueRecord[],
          pageInfo: {
            totalItems: 0,
            hasNextPage: false,
            hasPreviousPage: false,
            page: 1,
            perPage: 50,
          },
        }),
  ]);

  const items: AssignmentItem[] = [
    ...checklistResult.items.map(toAssignmentItem),
    ...(recordsResult.items as BlueRecord[]).map(toAssignmentItemFromRecord),
  ];

  // Sort by updatedAt descending
  items.sort((a, b) => {
    const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return db - da;
  });

  const totalItems =
    (checklistResult.pageInfo.totalItems ?? 0) +
    (recordsResult.pageInfo.totalItems ?? 0);

  return {
    items,
    pageInfo: {
      hasNextPage:
        Boolean(checklistResult.pageInfo.hasNextPage) ||
        Boolean(recordsResult.pageInfo.hasNextPage),
      hasPreviousPage:
        Boolean(checklistResult.pageInfo.hasPreviousPage) ||
        Boolean(recordsResult.pageInfo.hasPreviousPage),
      totalItems,
    },
  };
}

function toWorkloadItem(item: BlueRecord): WorkloadItem {
  return {
    id: item.id,
    title: item.title,
    listTitle: item.todoList.title,
    dueAt: item.duedAt ?? null,
    updatedAt: item.updatedAt ?? null,
    startedAt: item.startedAt ?? null,
    commentCount: item.commentCount ?? 0,
    done: item.done,
    archived: item.archived,
  };
}

function toAssignmentItem(item: BlueChecklistItem): AssignmentItem {
  return {
    id: item.id,
    type: "checklist",
    title: item.title,
    done: item.done,
    dueAt: item.duedAt ?? null,
    updatedAt: item.updatedAt ?? null,
    assigneeNames:
      item.users?.map((user) => user.fullName || user.email).filter(Boolean) ??
      [],
    checklistTitle: item.checklist.title,
    recordId: item.checklist.todo.id,
    recordTitle: item.checklist.todo.title,
    listTitle: item.checklist.todo.todoList.title,
  };
}

function toAssignmentItemFromRecord(item: BlueRecord): AssignmentItem {
  return {
    id: item.id,
    type: "record",
    title: item.title,
    done: item.done,
    dueAt: item.duedAt ?? null,
    updatedAt: item.updatedAt ?? null,
    assigneeNames:
      item.users?.map((user) => user.fullName || user.email).filter(Boolean) ??
      [],
    checklistTitle: "Main Record",
    recordId: item.id,
    recordTitle: item.title,
    listTitle: item.todoList.title,
  };
}

function buildAssignmentReportResponseText(input: {
  employeeName: string;
  status: "open" | "completed" | "all";
  items: AssignmentItem[];
  totalItems: number;
  hasNextPage: boolean;
}) {
  const statusLabel =
    input.status === "open"
      ? "open assignment"
      : input.status === "completed"
        ? "completed assignment"
        : "assignment";

  if (input.items.length === 0) {
    return `${input.employeeName} has no ${statusLabel}s in Blue right now.`;
  }

  return [
    `${input.employeeName} has ${input.totalItems} ${statusLabel}${
      input.totalItems === 1 ? "" : "s"
    } in Blue.`,
    ...input.items.slice(0, 15).map((item, index) => {
      const state = item.done ? "completed" : "open";
      const typeLabel = item.type === "record" ? "[Record]" : "[Task]";
      const date =
        item.done && item.updatedAt
          ? `completed/updated ${item.updatedAt.slice(0, 10)}`
          : item.dueAt
            ? `due ${item.dueAt.slice(0, 10)}`
            : "no due date";
      const assignees =
        item.assigneeNames.length > 0
          ? item.assigneeNames.join(", ")
          : "unassigned";

      return `${index + 1}. ${typeLabel} ${item.title} - ${state}, ${date} | Assigned: ${assignees} | ${item.recordTitle} (${item.listTitle}) ${
        item.type === "checklist" ? `| Checklist: ${item.checklistTitle}` : ""
      }`;
    }),
    input.hasNextPage
      ? `Showing the first ${input.items.length} assignments. More are available.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFollowUpPriorityQueue(
  items: WorkloadItem[],
  referenceDate: string,
): {
  overdue: FollowUpPriorityItem[];
  dueToday: FollowUpPriorityItem[];
  stale: FollowUpPriorityItem[];
  prioritized: FollowUpPriorityItem[];
} {
  const staleCutoff = shiftIsoDate(referenceDate, -5);
  const overdue: FollowUpPriorityItem[] = [];
  const dueToday: FollowUpPriorityItem[] = [];
  const stale: FollowUpPriorityItem[] = [];

  for (const item of items) {
    const dueDate = isoDay(item.dueAt);
    const updatedDate = isoDay(item.updatedAt);

    if (dueDate && dueDate < referenceDate) {
      overdue.push({
        ...item,
        priority: "overdue",
        reason: `overdue since ${dueDate}`,
      });
      continue;
    }

    if (dueDate === referenceDate) {
      dueToday.push({
        ...item,
        priority: "due_today",
        reason: `due today (${referenceDate})`,
      });
      continue;
    }

    if (updatedDate && updatedDate <= staleCutoff) {
      stale.push({
        ...item,
        priority: "stale",
        reason: `stale, last updated ${updatedDate}`,
      });
    }
  }

  const byUrgency = (left: FollowUpPriorityItem, right: FollowUpPriorityItem) =>
    sortByDate(left.dueAt, right.dueAt) ||
    sortByDate(left.updatedAt, right.updatedAt) ||
    left.title.localeCompare(right.title);

  overdue.sort(byUrgency);
  dueToday.sort(byUrgency);
  stale.sort(byUrgency);

  return {
    overdue,
    dueToday,
    stale,
    prioritized: [...overdue, ...dueToday, ...stale],
  };
}

async function buildDailyBriefFollowUp(employeeId: string, referenceDate: string) {
  const { items, pageInfo } = await loadAssignedOpenRecords(employeeId);
  return {
    ...buildFollowUpPriorityQueue(items, referenceDate),
    pageInfo,
  };
}

function buildFollowUpQueueResponseText(
  employeeName: string,
  referenceDate: string,
  priorities: {
    overdue: FollowUpPriorityItem[];
    dueToday: FollowUpPriorityItem[];
    stale: FollowUpPriorityItem[];
    prioritized: FollowUpPriorityItem[];
  },
  hasMore: boolean | null | undefined,
) {
  if (priorities.prioritized.length === 0) {
    return `${employeeName} has no overdue, due-today, or stale files on ${referenceDate}.`;
  }

  return [
    `Follow-up queue for ${employeeName} on ${referenceDate}`,
    `Overdue: ${priorities.overdue.length} | Due today: ${priorities.dueToday.length} | Stale: ${priorities.stale.length}`,
    ...priorities.prioritized.slice(0, 10).map(
      (item, index) =>
        `${index + 1}. ${item.title} (${item.listTitle}) - ${item.reason}`,
    ),
    hasMore
      ? "Showing the first priority files only. More open files are available."
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDailyBriefResponseText(input: {
  employeeName: string;
  date: string;
  mentionLookbackDays: number;
  workloadTotal: number;
  assignmentTotal: number;
  followUp: {
    overdue: FollowUpPriorityItem[];
    dueToday: FollowUpPriorityItem[];
    stale: FollowUpPriorityItem[];
    prioritized: FollowUpPriorityItem[];
  };
  mentions: Array<{
    occurred_at: string;
    author_name: string | null;
    entity_title: string | null;
    summary: string;
  }>;
  summary: {
    eventCount: number;
    summaryText: string;
  };
}) {
  const priorityPreview = input.followUp.prioritized
    .slice(0, 3)
    .map(
      (item, index) =>
        `${index + 1}. ${item.title} (${item.listTitle}) - ${item.reason}`,
    );
  const mentionPreview = input.mentions.slice(0, 3).map((row, index) => {
    const date = row.occurred_at.slice(0, 10);
    const author = row.author_name ?? "Someone";
    const entityTitle = row.entity_title ?? "a client file";
    return `${index + 1}. ${author} on ${entityTitle} (${date})`;
  });

  return [
    `Daily brief for ${input.employeeName} on ${input.date}:`,
    `- Open records: ${input.workloadTotal}`,
    `- Open assignments: ${input.assignmentTotal}`,
    `- Priority follow-ups: ${input.followUp.prioritized.length} (${input.followUp.overdue.length} overdue, ${input.followUp.dueToday.length} due today, ${input.followUp.stale.length} stale)`,
    `- Mentions in the last ${input.mentionLookbackDays} day${input.mentionLookbackDays === 1 ? "" : "s"}: ${input.mentions.length}`,
    `- Logged activity today: ${input.summary.eventCount}`,
    input.followUp.prioritized.length > 0 ? "Top follow-up priorities:" : null,
    ...priorityPreview,
    input.mentions.length > 0 ? "Recent mentions:" : null,
    ...mentionPreview,
    `Activity summary: ${input.summary.summaryText}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCandidates(candidates: string[], prefix: string) {
  return `${prefix}\n${candidates.map((candidate) => `- ${candidate}`).join("\n")}`;
}

function normalizeDate(date: string | undefined) {
  if (date && date.trim()) {
    return date.trim();
  }

  return new Date().toISOString().slice(0, 10);
}

function isoDay(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function shiftIsoDate(date: string, days: number) {
  const normalized = new Date(`${date}T00:00:00.000Z`);
  normalized.setUTCDate(normalized.getUTCDate() + days);
  return normalized.toISOString().slice(0, 10);
}

function sortByDate(left: string | null, right: string | null) {
  if (left && right) {
    return left.localeCompare(right);
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}

function toDueDateIso(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T23:59:59.999Z`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Invalid due date: ${value}`);
  }

  return parsed.toISOString();
}

export async function getUserMentionsReport(input: {
  employeeName?: string;
  dateStart?: string;
  dateEnd?: string;
  actor?: EmployeeIdentity | null;
}) {
  const targetName = input.employeeName || input.actor?.displayName;
  if (!targetName) {
    throw new ValidationError("I need to know whose mentions to search for.");
  }

  const rows = await listMentionsForUser({
    employeeName: targetName,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
  });

  if (
    input.actor &&
    targetName.trim().toLowerCase() === input.actor.displayName.trim().toLowerCase()
  ) {
    await upsertEmployeeNotificationState({
      employeeId: input.actor.employeeId,
      mentionsSeenThrough: rows[0]?.occurred_at ?? new Date().toISOString(),
    });
  }

  const responseText =
    rows.length === 0
      ? `No recent mentions found for ${targetName}.`
      : [
          `Recent mentions for ${targetName}:`,
          ...rows.map((row, index) => {
            const date = row.occurred_at.slice(0, 10);
            const time = row.occurred_at.slice(11, 16);
            return `${index + 1}. ${row.author_name} mentioned you on "${
              row.entity_title
            }" (${date} ${time}):\n   > ${row.summary}`;
          }),
        ].join("\n");

  return {
    employeeName: targetName,
    rows,
    responseText,
  };
}

export async function getUserActivityHistory(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  dateStart?: string;
  dateEnd?: string;
  transport?: string;
}) {
  const actor = await resolveActorOrThrow(input);
  const rows = await listEventsForEmployeeInRange({
    employeeId: actor.employeeId,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
  });

  const responseText =
    rows.length === 0
      ? `No activity history found for ${actor.displayName} in this period.`
      : [
          `Activity history for ${actor.displayName}:`,
          ...rows.map((row, index) => {
            const date = row.occurred_at.slice(0, 10);
            const time = row.occurred_at.slice(11, 16);
            const project = row.project_name ? ` [${row.project_name}]` : "";
            return `${index + 1}. ${date} ${time}: ${row.summary}${project}`;
          }),
        ].join("\n");

  return {
    employeeName: actor.displayName,
    rows,
    responseText,
  };
}
