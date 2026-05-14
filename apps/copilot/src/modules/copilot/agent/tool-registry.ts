import { tool } from "ai";
import { z } from "zod";

import type { IntentName } from "../../../domain/types.js";
import {
  addCommentToClient,
  assignRecord,
  answerReportingQuestion,
  completeRecordAssignment,
  getClientComments,
  getClientDetail,
  getEmployeeAssignmentReport,
  getEmployeeNotificationFeed,
  getReportingOverview,
  getRecordActivityReport,
  getTeamDaySummary,
  getTeamFollowUpQueue,
  getWorkspaceActivityReport,
  getWorkspaceExceptionReport,
  moveClientToStage,
  searchClients,
  setRecordDueDate,
} from "../actions.js";
import {
  enforceAyaToolPolicy,
  formatAyaToolError,
  type AyaToolPolicy,
} from "./policy.js";
import {
  compactToolResult,
  extractResponseText,
  summarizeToolResult,
} from "./tool-results.js";
import type { AyaAgentContext, AyaAgentToolTrace } from "./types.js";

export function createAyaAgentTools(
  context: AyaAgentContext,
  traces: AyaAgentToolTrace[],
) {
  return {
    getSignedInUser: tool({
      description:
        "Return the signed-in Aya user identity. Use for 'who am I signed in as' and account questions.",
      inputSchema: z.object({}),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getSignedInUser",
          intent: "identity.self",
          input,
          execute: async () => ({
            employeeId: context.actor.employeeId,
            displayName: context.actor.displayName,
            email: context.actor.email ?? null,
            roleName: context.actor.roleName ?? null,
            responseText: [
              `You are signed in as ${context.actor.displayName}.`,
              context.actor.email ? `Email: ${context.actor.email}` : null,
              context.actor.roleName ? `Role: ${context.actor.roleName}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          }),
        }),
    }),

    searchClients: tool({
      description:
        "Search Blue client/file records by name, title, email, or phone. Use before asking clarification when a user gives a fuzzy client reference.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Client name, file title, email, or phone."),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "searchClients",
          intent: "records.search",
          input,
          execute: async () =>
            searchClients({
              query: input.query,
              limit: input.limit,
              actor: context.actor,
              transport: context.transport,
            }),
        }),
    }),

    getClientDetail: tool({
      description:
        "Read a Blue client/file and return status, owners, notes, missing docs, blockers, or call prep. Use for status, briefing, prep, and next-follow-up questions.",
      inputSchema: z.object({
        recordId: z.string().optional(),
        recordQuery: z.string().optional(),
        useActiveRecordContext: z.boolean().optional(),
        detailMode: z.enum(["default", "briefing", "call_prep"]).optional(),
        briefingFocus: z
          .enum(["general", "handoff", "blockers", "missing_docs"])
          .optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getClientDetail",
          intent: "records.detail",
          input,
          execute: async () =>
            getClientDetail({
              ...input,
              actor: context.actor,
              transport: context.transport,
            }),
        }),
    }),

    getClientComments: tool({
      description:
        "Read recent comments for one Blue client/file. Use for comments, notes, or recent discussion on a client.",
      inputSchema: z.object({
        recordId: z.string().optional(),
        recordQuery: z.string().optional(),
        useActiveRecordContext: z.boolean().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getClientComments",
          intent: "comments.list_recent",
          input,
          execute: async () =>
            getClientComments({
              ...input,
              actor: context.actor,
              transport: context.transport,
            }),
        }),
    }),

    addClientComment: tool({
      description:
        "Add a note/comment to exactly one Blue client/file. Use when the user says add a note, add a comment, write a note, or says to note something on a client.",
      inputSchema: z.object({
        recordId: z.string().optional(),
        recordQuery: z.string().optional(),
        useActiveRecordContext: z.boolean().optional(),
        text: z.string().min(1).max(2000).describe("The exact comment text to add."),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "addClientComment",
          intent: "comments.create",
          input,
          policy: { write: true },
          execute: async () =>
            addCommentToClient({
              ...input,
              actor: context.actor,
              blueAuth: context.blueAuth,
              transport: context.transport,
            }),
        }),
    }),

    moveClientToStage: tool({
      description:
        "Move exactly one Blue client/file to a different pipeline stage/list. Never use for all/every records.",
      inputSchema: z.object({
        recordId: z.string().optional(),
        recordQuery: z.string().optional(),
        useActiveRecordContext: z.boolean().optional(),
        targetListQuery: z.string().min(1),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "moveClientToStage",
          intent: "records.move",
          input,
          policy: { write: true },
          execute: async () =>
            moveClientToStage({
              ...input,
              actor: context.actor,
              blueAuth: context.blueAuth,
              transport: context.transport,
            }),
        }),
    }),

    assignClient: tool({
      description:
        "Assign exactly one Blue client/file to one Aya employee. Never use for all/every records.",
      inputSchema: z.object({
        recordQuery: z.string().optional(),
        useActiveRecordContext: z.boolean().optional(),
        assigneeName: z.string().min(1),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "assignClient",
          intent: "records.assign",
          input,
          policy: { write: true },
          execute: async () =>
            assignRecord({
              entityQuery: input.recordQuery,
              useActiveRecordContext: input.useActiveRecordContext,
              assigneeName: input.assigneeName,
              actor: context.actor,
              blueAuth: context.blueAuth,
              transport: context.transport,
            }),
        }),
    }),

    setClientDueDate: tool({
      description: "Set a due date on exactly one Blue client/file.",
      inputSchema: z.object({
        recordQuery: z.string().optional(),
        useActiveRecordContext: z.boolean().optional(),
        dueDate: z.string().min(1),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "setClientDueDate",
          intent: "records.set_due_date",
          input,
          policy: { write: true },
          execute: async () =>
            setRecordDueDate({
              entityQuery: input.recordQuery,
              useActiveRecordContext: input.useActiveRecordContext,
              dueDate: input.dueDate,
              actor: context.actor,
              blueAuth: context.blueAuth,
              transport: context.transport,
            }),
        }),
    }),

    completeClientRecord: tool({
      description:
        "Mark exactly one Blue client/file complete/done. Never use for all/every records.",
      inputSchema: z.object({
        recordQuery: z.string().optional(),
        useActiveRecordContext: z.boolean().optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "completeClientRecord",
          intent: "records.complete",
          input,
          policy: { write: true },
          execute: async () =>
            completeRecordAssignment({
              entityQuery: input.recordQuery,
              useActiveRecordContext: input.useActiveRecordContext,
              actor: context.actor,
              blueAuth: context.blueAuth,
              transport: context.transport,
            }),
        }),
    }),

    getEmployeeAssignments: tool({
      description:
        "Show checklist assignments/tasks for the signed-in employee or a named employee. Employees may only read their own assignments.",
      inputSchema: z.object({
        employeeName: z.string().optional(),
        status: z.enum(["open", "completed", "all"]).optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getEmployeeAssignments",
          intent: "assignments.report",
          input,
          policy: { employeeNameField: "employeeName" },
          execute: async () =>
            getEmployeeAssignmentReport({
              employeeName: input.employeeName ?? context.actor.displayName,
              status: input.status,
              transport: context.transport,
            }),
        }),
    }),

    getEmployeeNotifications: tool({
      description:
        "Show notifications for the signed-in employee or a named employee. Employees may only read their own notifications.",
      inputSchema: z.object({
        employeeName: z.string().optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getEmployeeNotifications",
          intent: "notifications.feed",
          input,
          policy: { employeeNameField: "employeeName" },
          execute: async () =>
            getEmployeeNotificationFeed({
              employeeName: input.employeeName ?? context.actor.displayName,
              transport: context.transport,
            }),
        }),
    }),

    getTeamFollowUpQueue: tool({
      description:
        "Admin-only team overdue/follow-up queue across employees. Use for who is overdue or who has overdue assignments.",
      inputSchema: z.object({
        date: z.string().optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getTeamFollowUpQueue",
          intent: "records.team_follow_up",
          input,
          policy: { adminOnly: true },
          execute: async () => getTeamFollowUpQueue(input),
        }),
    }),

    getTeamDaySummary: tool({
      description: "Admin-only team activity summary for today or a date.",
      inputSchema: z.object({
        date: z.string().optional(),
        inactiveOnly: z.boolean().optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getTeamDaySummary",
          intent: input.inactiveOnly ? "summary.no_activity_day" : "summary.team_day",
          input,
          policy: { adminOnly: true },
          execute: async () => getTeamDaySummary(input),
        }),
    }),

    getWorkspaceActivity: tool({
      description:
        "Admin-only workspace activity report. Use for who commented, who moved clients, who created leads, or what changed.",
      inputSchema: z.object({
        focus: z.enum(["all", "comments", "moves", "creates", "timeline"]).optional(),
        date: z.string().optional(),
        dateStart: z.string().optional(),
        dateEnd: z.string().optional(),
        dateLabel: z.string().optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getWorkspaceActivity",
          intent: "activity.workspace_report",
          input,
          policy: { adminOnly: true },
          execute: async () => getWorkspaceActivityReport(input),
        }),
    }),

    getRecordActivity: tool({
      description:
        "Admin-only activity report for one Blue client/file. Use for who touched, who commented on, or timeline for a specific record.",
      inputSchema: z.object({
        recordId: z.string().optional(),
        recordQuery: z.string().optional(),
        useActiveRecordContext: z.boolean().optional(),
        focus: z.enum(["all", "comments", "moves", "timeline"]).optional(),
        date: z.string().optional(),
        dateStart: z.string().optional(),
        dateEnd: z.string().optional(),
        dateLabel: z.string().optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getRecordActivity",
          intent: "activity.record_report",
          input,
          policy: { adminOnly: true },
          execute: async () =>
            getRecordActivityReport({
              ...input,
              actor: context.actor,
              transport: context.transport,
            }),
        }),
    }),

    getExceptionReport: tool({
      description:
        "Admin-only report for unassigned records or records missing required client fields such as phone, email, finance amount, due date, or closing date.",
      inputSchema: z.object({
        focus: z
          .enum([
            "all",
            "assignment",
            "assignee",
            "client_name",
            "email",
            "phone",
            "finance_amount",
            "due_date",
            "closing_date",
          ])
          .optional(),
        employeeName: z.string().optional(),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getExceptionReport",
          intent: "records.exception_report",
          input,
          policy: { adminOnly: true },
          execute: async () =>
            getWorkspaceExceptionReport({
              focus: input.focus,
              employeeName: input.employeeName,
            }),
        }),
    }),

    getReportingOverview: tool({
      description: "Return the available reporting dashboards and reporting capabilities.",
      inputSchema: z.object({}),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "getReportingOverview",
          intent: "reporting.overview",
          input,
          policy: { adminOnly: true },
          execute: async () => getReportingOverview(),
        }),
    }),

    answerReportingQuestion: tool({
      description:
        "Answer an admin question about existing reporting dashboards, metrics, or reporting configuration.",
      inputSchema: z.object({
        question: z.string().min(1),
      }),
      execute: async (input) =>
        runTool(context, traces, {
          toolName: "answerReportingQuestion",
          intent: "reporting.question",
          input,
          policy: { adminOnly: true },
          execute: async () =>
            answerReportingQuestion({
              question: input.question,
              auth: context.blueAuth,
            }),
        }),
    }),
  };
}

async function runTool<TInput extends Record<string, unknown>>(context: AyaAgentContext, traces: AyaAgentToolTrace[], input: {
  toolName: string;
  intent: IntentName;
  input: TInput;
  policy?: AyaToolPolicy;
  execute: () => Promise<unknown>;
}) {
  try {
    enforceAyaToolPolicy(context, input.input, input.policy ?? {});
    const data = await input.execute();
    const responseText = extractResponseText(data);
    const resultSummary = summarizeToolResult(data);
    traces.push({
      toolName: input.toolName,
      intent: input.intent,
      input: input.input,
      outcome: "success",
      responseText,
      resultSummary,
      resultData: compactToolResult(data),
    });
    return {
      ok: true,
      responseText,
      data: compactToolResult(data),
    };
  } catch (error) {
    const errorMessage = formatAyaToolError(error);
    traces.push({
      toolName: input.toolName,
      intent: input.intent,
      input: input.input,
      outcome: "error",
      errorMessage,
    });
    return {
      ok: false,
      errorMessage,
    };
  }
}
