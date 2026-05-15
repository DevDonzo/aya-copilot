import type { IncomingMessage, ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { AppError } from "../app/errors.js";
import { createId, insertBotAuditLog } from "../db.js";
import {
  addCommentToClient,
  assignRecord,
  assignTask,
  createClientRecord,
  getClientComments,
  getClientDetail,
  getEmployeeAssignmentReport,
  getEmployeeActivityReport,
  getEmployeeDailyBrief,
  getEmployeeDaySummary,
  getEmployeeFollowUpQueue,
  getEmployeeWorkload,
  getUserMentionsReport,
  getRecordActivityReport,
  getTeamFollowUpQueue,
  getTeamDaySummary,
  getWorkspaceActivityReport,
  moveClientToStage,
  resolveActorIdentity,
  runAyaMessageTool,
  searchClients,
} from "./service.js";
import {
  answerReportingQuestion,
  getReportingOverview,
} from "../reporting/service.js";
import type { BlueRequestAuth, EmployeeIdentity, IntentName } from "../domain/types.js";
import {
  normalizeBlueRequestAuth,
  requireValidatedBlueRequestAuth,
} from "../modules/blue/request-auth.js";
import { getPreAuthSafetyBlock } from "../modules/copilot/safety.js";
import { formatUnmappedEmployeeMessage } from "../modules/identity/service.js";

const MIN_REASONABLE_ACTIVITY_DATE = "2025-01-01";

export async function handleAyaMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody?: unknown,
) {
  normalizeMcpRequestHeaders(request);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createAyaMcpServer();
  await server.connect(transport);
  await transport.handleRequest(request, response, parsedBody);
}

function normalizeMcpRequestHeaders(request: IncomingMessage) {
  const method = request.method?.toUpperCase();
  const currentAccept = request.headers.accept ?? "";
  const acceptParts = new Set(
    currentAccept
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );

  if (method === "GET") {
    acceptParts.add("text/event-stream");
  }

  if (method === "POST" || method === "DELETE") {
    acceptParts.add("application/json");
    acceptParts.add("text/event-stream");
    if (!request.headers["content-type"]) {
      request.headers["content-type"] = "application/json";
      setRawHeader(request, "content-type", "application/json");
    }
  }

  if (acceptParts.size > 0) {
    const acceptValue = Array.from(acceptParts).join(", ");
    request.headers.accept = acceptValue;
    setRawHeader(request, "accept", acceptValue);
  }
}

function setRawHeader(request: IncomingMessage, name: string, value: string) {
  const rawHeaders = request.rawHeaders;
  if (!Array.isArray(rawHeaders)) {
    return;
  }

  for (let index = rawHeaders.length - 2; index >= 0; index -= 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      rawHeaders.splice(index, 2);
    }
  }

  rawHeaders.push(name, value);
}

async function getHeaderActor(
  headers: Record<string, string | string[] | undefined> | undefined,
  fallback?: {
    employeeId?: string;
    employeeEmail?: string;
    employeeName?: string;
  },
) {
  const identity = getHeaderActorInput(headers, fallback);

  const actor = await resolveActorIdentity({
    employeeId: identity.employeeId,
    employeeEmail: identity.employeeEmail,
    employeeName: identity.employeeName,
  }).catch((error: unknown) => {
    if (
      error instanceof AppError &&
      (error.code === "AUTH_REQUIRED" || error.code === "NOT_FOUND")
    ) {
      return null;
    }

    throw error;
  });
  if (!actor) {
    return null;
  }

  return {
    ...actor,
    email: actor.email ?? identity.employeeEmail ?? undefined,
  };
}

function getHeaderActorInput(
  headers: Record<string, string | string[] | undefined> | undefined,
  fallback?: {
    employeeId?: string;
    employeeEmail?: string;
    employeeName?: string;
  },
) {
  return {
    employeeId:
      getHeaderValue(headers, "x-aya-employee-id") ??
      fallback?.employeeId ??
      undefined,
    employeeEmail:
      getHeaderValue(headers, "x-aya-employee-email") ??
      fallback?.employeeEmail ??
      undefined,
    employeeName:
      getHeaderValue(headers, "x-aya-employee-name") ??
      fallback?.employeeName ??
      undefined,
  };
}

function getHeaderBlueAuth(
  headers: Record<string, string | string[] | undefined> | undefined,
): BlueRequestAuth | null {
  return normalizeBlueRequestAuth({
    tokenId:
      getHeaderValue(headers, "x-aya-blue-token-id") ??
      getHeaderValue(headers, "x-blue-token-id"),
    tokenSecret:
      getHeaderValue(headers, "x-aya-blue-token-secret") ??
      getHeaderValue(headers, "x-blue-token-secret"),
  });
}

async function requireHeaderBlueAuth(
  headers: Record<string, string | string[] | undefined> | undefined,
  actor?: EmployeeIdentity | null,
): Promise<BlueRequestAuth> {
  return await requireValidatedBlueRequestAuth(getHeaderBlueAuth(headers), actor);
}

function getHeaderConversationKey(
  headers: Record<string, string | string[] | undefined> | undefined,
) {
  return (
    getHeaderValue(headers, "x-aya-conversation-id") ??
    getHeaderValue(headers, "x-librechat-conversation-id") ??
    getHeaderValue(headers, "x-conversation-id") ??
    getHeaderValue(headers, "mcp-session-id") ??
    undefined
  );
}

function resolveRequestedEmployeeName(
  employeeName: string | undefined,
  actor?: EmployeeIdentity | null,
) {
  const trimmed = employeeName?.trim();
  if (
    !trimmed ||
    /^(?:self|me|myself|current user|signed-in user|signed in user|i)$/i.test(
      trimmed,
    )
  ) {
    return actor?.displayName;
  }

  return trimmed;
}

async function requireToolActor(
  headers: Record<string, string | string[] | undefined> | undefined,
  fallback?: {
    employeeId?: string;
    employeeEmail?: string;
    employeeName?: string;
  },
) {
  const actor = await getHeaderActor(headers, fallback);
  if (!actor) {
    throw new Error(
      formatUnmappedEmployeeMessage(getHeaderActorInput(headers, fallback)),
    );
  }

  return actor;
}

async function requireAdminToolActor(
  headers: Record<string, string | string[] | undefined> | undefined,
  fallback?: {
    employeeId?: string;
    employeeEmail?: string;
    employeeName?: string;
  },
) {
  const actor = await requireToolActor(headers, fallback);
  if (actor.roleName !== "admin") {
    throw new Error("This Aya reporting tool requires admin or manager access.");
  }

  return actor;
}

function enforceSelfOrAdminEmployeeScope(
  actor: EmployeeIdentity,
  target: {
    employeeId?: string;
    employeeEmail?: string;
    employeeName?: string;
  },
) {
  if (actor.roleName === "admin") {
    return;
  }

  const targetId = target.employeeId?.trim().toLowerCase();
  if (targetId && targetId !== actor.employeeId.trim().toLowerCase()) {
    throw new AppError("Requests for other employees require admin access.", {
      statusCode: 403,
      code: "PERMISSION_DENIED",
    });
  }

  const targetEmail = target.employeeEmail?.trim().toLowerCase();
  if (targetEmail && targetEmail !== actor.email?.trim().toLowerCase()) {
    throw new AppError("Requests for other employees require admin access.", {
      statusCode: 403,
      code: "PERMISSION_DENIED",
    });
  }

  const targetName = resolveRequestedEmployeeName(target.employeeName, actor);
  if (
    targetName &&
    targetName.trim().toLowerCase() !== actor.displayName.trim().toLowerCase()
  ) {
    throw new AppError("Requests for other employees require admin access.", {
      statusCode: 403,
      code: "PERMISSION_DENIED",
    });
  }
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
) {
  if (!headers) {
    return null;
  }

  const value =
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) {
    return normalizeHeaderValue(value[0]);
  }

  return normalizeHeaderValue(value);
}

function normalizeHeaderValue(value: string | undefined | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (/^\{\{.+\}\}$/.test(normalized) || /^\$\{.+\}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function toStructuredContent(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function recordMcpToolAudit(input: {
  actor: EmployeeIdentity;
  toolName: string;
  intent: IntentName;
  inboundText: string;
  requestJson: Record<string, unknown>;
  outcome: string;
  responseText?: string;
  responseJson?: unknown;
}) {
  await insertBotAuditLog({
    id: createId("audit"),
    employeeId: input.actor.employeeId,
    transport: "mcp",
    inboundText: input.inboundText,
    detectedIntent: input.intent,
    adapter: "mcp_tool",
    commandName: input.toolName,
    commandArgs: JSON.stringify(input.requestJson),
    outcome: input.outcome,
    responseText: input.responseText,
    requestJson: input.requestJson,
    responseJson:
      input.responseJson === undefined
        ? undefined
        : {
            data: input.responseJson,
          },
  });
}

export async function runAuditedMcpTool<T extends { responseText?: string }>(input: {
  actor: EmployeeIdentity;
  toolName: string;
  intent: IntentName;
  inboundText: string;
  requestJson: Record<string, unknown>;
  execute: () => Promise<T>;
}) {
  try {
    const result = await input.execute();
    await recordMcpToolAudit({
      actor: input.actor,
      toolName: input.toolName,
      intent: input.intent,
      inboundText: input.inboundText,
      requestJson: input.requestJson,
      outcome: "success",
      responseText: result.responseText,
      responseJson: result,
    });
    return result;
  } catch (error) {
    await recordMcpToolAudit({
      actor: input.actor,
      toolName: input.toolName,
      intent: input.intent,
      inboundText: input.inboundText,
      requestJson: input.requestJson,
      outcome: "error",
      responseText: error instanceof Error ? error.message : "Unknown error",
      responseJson:
        error instanceof AppError
          ? {
              code: error.code,
              details: error.details ?? null,
            }
          : undefined,
    });
    throw error;
  }
}

function createAyaMcpServer() {
  const server = new McpServer({
    name: "aya-copilot-mcp",
    version: "0.1.0",
    websiteUrl: "https://chat-internal.ayafinancial.com",
  });

  server.registerTool(
    "aya_message",
    {
      title: "Aya Chat Action",
      description:
        "Default Aya entrypoint for natural-language chat. Use this first for ordinary employee or admin requests, especially ambiguous requests like 'show me Hamza', 'what's going on with X', 'comments on this client', 'move this to underwriting', 'what changed today', and similar conversational asks. Aya will apply role-aware planning, clarification, policy checks, and deterministic execution behind the scenes. Only skip this tool when the user is making a very explicit structured request that clearly belongs to one specialist Aya tool and already includes the exact parameters needed.",
      inputSchema: {
        message: z
          .string()
          .min(1)
          .describe("Natural-language employee request"),
      },
    },
    async ({ message }, extra) => {
      const safetyBlock = getPreAuthSafetyBlock(message);
      if (safetyBlock) {
        return {
          content: [{ type: "text", text: safetyBlock.responseText }],
          structuredContent: toStructuredContent({
            matched: true,
            blocked: true,
            code: safetyBlock.code,
            responseText: safetyBlock.responseText,
          }),
        };
      }

      const actorInput = getHeaderActorInput(extra.requestInfo?.headers);
      const actor = await getHeaderActor(extra.requestInfo?.headers);
      if (!actor) {
        const responseText = formatUnmappedEmployeeMessage(actorInput);
        return {
          content: [{ type: "text", text: responseText }],
          structuredContent: toStructuredContent({
            matched: false,
            code: "EMPLOYEE_IDENTITY_NOT_LINKED",
            responseText,
          }),
        };
      }

      const blueAuth = getHeaderBlueAuth(extra.requestInfo?.headers);
      const conversationKey = getHeaderConversationKey(extra.requestInfo?.headers);
      const result = await runAyaMessageTool({
        message,
        actorEmployeeId: actor.employeeId,
        actorEmployeeEmail: actor.email ?? actorInput.employeeEmail,
        actorEmployeeName: actor.displayName,
        blueAuth,
        conversationKey,
      });

      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_current_employee",
    {
      title: "Current Employee Identity",
      description:
        "Confirm who is currently signed into Aya, including the resolved employee name, email, and role. Use this when the user asks who they are, which account is signed in, or what identity the assistant sees.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const actorInput = getHeaderActorInput(extra.requestInfo?.headers);
      const actor = await getHeaderActor(extra.requestInfo?.headers);
      if (!actor) {
        const responseText = formatUnmappedEmployeeMessage(actorInput);
        return {
          content: [{ type: "text", text: responseText }],
          structuredContent: toStructuredContent({
            code: "EMPLOYEE_IDENTITY_NOT_LINKED",
            responseText,
          }),
        };
      }

      const responseText = [
        `You are signed in as ${actor.displayName}.`,
        actor.email ? `Email: ${actor.email}` : null,
        actor.roleName ? `Role: ${actor.roleName}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: toStructuredContent({
          employeeId: actor.employeeId,
          displayName: actor.displayName,
          email: actor.email ?? null,
          roleName: actor.roleName ?? null,
        }),
      };
    },
  );

  if (process.env.AYA_MCP_EXPOSE_SPECIALIST_TOOLS !== "true") {
    return server;
  }

  server.registerTool(
    "aya_get_daily_brief",
    {
      title: "Daily Work Brief",
      description:
        "Generate a personal Aya work brief that bundles open records, open assignments, follow-up priorities, recent mentions, and today's activity into one operational snapshot.",
      inputSchema: {
        employeeId: z.string().optional(),
        employeeEmail: z.string().email().optional(),
        employeeName: z.string().optional(),
        date: z.string().optional().describe("YYYY-MM-DD"),
        mentionLookbackDays: z.number().int().min(1).max(30).optional(),
      },
    },
    async (
      { employeeId, employeeEmail, employeeName, date, mentionLookbackDays },
      extra,
    ) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const targetName = employeeName ?? actor.displayName;
      if (
        actor.roleName !== "admin" &&
        targetName.trim().toLowerCase() !== actor.displayName.trim().toLowerCase()
      ) {
        throw new Error("Daily briefs for other employees require admin access.");
      }

      const result = await getEmployeeDailyBrief({
        employeeId: employeeId ?? actor.employeeId,
        employeeEmail: employeeEmail ?? actor.email,
        employeeName: targetName,
        date,
        mentionLookbackDays,
      });

      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_search_clients",
    {
      title: "Search Clients",
      description:
        "Search cached Blue CRM records in the allowed Aya workspace `00- AYA Sales CRM 3`.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(8),
      },
    },
    async ({ query, limit }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await searchClients({
        query,
        limit,
        actor,
        blueAuth,
        transport: "mcp",
      });
      const responseText =
        result.items.length === 0
          ? `No current Blue clients matched "${query}".`
          : result.items
              .map(
                (item: { title: string; listTitle: string }, index: number) =>
                  `${index + 1}. ${item.title} (${item.listTitle})`,
              )
              .join("\n");

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_client_comments",
    {
      title: "Get Client Comments",
      description:
        "Show recent comments for a Blue CRM record in the allowed Aya workspace `00- AYA Sales CRM 3`. `clientQuery` can be a client name, record title, email, or phone number.",
      inputSchema: {
        recordId: z.string().optional(),
        clientQuery: z
          .string()
          .optional()
          .describe("Client name, record title, email, or phone number"),
        limit: z.number().int().min(1).max(20).default(8),
      },
    },
    async ({ recordId, clientQuery, limit }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await getClientComments({
        recordId,
        recordQuery: clientQuery,
        limit,
        actor,
        blueAuth,
        transport: "mcp",
      });
      return {
        content: [{ type: "text", text: result.responseText ?? "Record assigned." }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_client_detail",
    {
      title: "Get Client Detail",
      description:
        "Load a client's current Blue status, contact fields, and recent activity/comments. Use `clientQuery` for a client name, record title, email, or phone number. Use this only when the request is explicitly about a CRM client/file. Do not use this for employee workload or admin reporting questions.",
      inputSchema: {
        recordId: z.string().optional(),
        clientQuery: z
          .string()
          .optional()
          .describe("Client name, record title, email, or phone number"),
      },
    },
    async ({ recordId, clientQuery }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await getClientDetail({
        recordId,
        recordQuery: clientQuery,
        actor,
        blueAuth,
        transport: "mcp",
      });

      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_employee_activity_report",
    {
      title: "Employee Activity Report",
      description:
        "Admin-only attributed Aya activity report for one internal employee. Use this when an admin explicitly asks exactly what someone did, what comments they made, how many clients they moved, what leads they created, or to see a detailed activity timeline for a day or date range. Never use this for ambiguous requests like 'show me Hamza' or for normal employee client lookups. For relative periods like today, yesterday, this week, last week, this month, or last month, leave date fields omitted unless the user typed an exact YYYY-MM-DD date.",
      inputSchema: {
        employeeId: z.string().optional(),
        employeeEmail: z.string().email().optional(),
        employeeName: z.string().optional(),
        date: z
          .string()
          .optional()
          .describe("Optional single date in YYYY-MM-DD format. Leave omitted for relative periods like today unless the user typed an exact date."),
        dateStart: z
          .string()
          .optional()
          .describe("Optional YYYY-MM-DD range start. Leave omitted for relative periods unless the user typed an exact date range."),
        dateEnd: z
          .string()
          .optional()
          .describe("Optional YYYY-MM-DD range end. Leave omitted for relative periods unless the user typed an exact date range."),
        dateLabel: z.string().optional(),
        focus: z
          .enum(["all", "comments", "moves", "creates", "timeline"])
          .default("all"),
      },
    },
    async (
      { employeeId, employeeEmail, employeeName, date, dateStart, dateEnd, dateLabel, focus },
      extra,
    ) => {
      const actor = await requireAdminToolActor(extra.requestInfo?.headers);
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const safeDateArgs = normalizeActivityReportDateArgs({ date, dateStart, dateEnd });
      const result = await getEmployeeActivityReport({
        employeeId,
        employeeEmail,
        employeeName,
        ...safeDateArgs,
        dateLabel,
        focus,
      });
      return {
        content: [{ type: "text", text: result.responseText ?? "Task assigned." }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_workspace_activity_report",
    {
      title: "Get Workspace Activity Report",
      description:
        "Admin-only audit-backed workspace activity report for the allowed Aya workspace `00- AYA Sales CRM 3`. Use this when admins ask what happened today, who moved clients, who made comments, who created leads, or for a workspace activity timeline. For relative periods like today, yesterday, this week, last week, this month, or last month, leave date fields omitted unless the user typed an exact YYYY-MM-DD date.",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Optional date in YYYY-MM-DD format. Defaults to today. Leave omitted for relative periods like today unless the user typed an exact date."),
        dateStart: z
          .string()
          .optional()
          .describe("Optional YYYY-MM-DD range start. Leave omitted for relative periods unless the user typed an exact date range."),
        dateEnd: z
          .string()
          .optional()
          .describe("Optional YYYY-MM-DD range end. Leave omitted for relative periods unless the user typed an exact date range."),
        dateLabel: z.string().optional(),
        focus: z
          .enum(["all", "comments", "moves", "creates", "timeline"])
          .default("all"),
      },
    },
    async ({ date, dateStart, dateEnd, dateLabel, focus }, extra) => {
      const actor = await requireAdminToolActor(extra.requestInfo?.headers);
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const safeDateArgs = normalizeWorkspaceActivityReportDateArgs({ date, dateStart, dateEnd });
      const result = await getWorkspaceActivityReport({
        ...safeDateArgs,
        dateLabel,
        focus,
      });

      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_record_activity_report",
    {
      title: "Get Client Activity Report",
      description:
        "Admin-only audit-backed client activity report for the allowed Aya workspace `00- AYA Sales CRM 3`. Use this when admins ask who touched a client, who commented on a file, what happened on a client, or for a client activity timeline. For relative periods like today, yesterday, this week, last week, this month, or last month, leave date fields omitted unless the user typed an exact YYYY-MM-DD date.",
      inputSchema: {
        recordId: z.string().optional(),
        clientQuery: z
          .string()
          .optional()
          .describe("Client name, record title, email, or phone number"),
        date: z
          .string()
          .optional()
          .describe("Optional single date in YYYY-MM-DD format. Leave omitted for relative periods like today unless the user typed an exact date."),
        dateStart: z
          .string()
          .optional()
          .describe("Optional YYYY-MM-DD range start. Leave omitted for relative periods unless the user typed an exact date range."),
        dateEnd: z
          .string()
          .optional()
          .describe("Optional YYYY-MM-DD range end. Leave omitted for relative periods unless the user typed an exact date range."),
        dateLabel: z.string().optional(),
        focus: z.enum(["all", "comments", "moves", "timeline"]).default("all"),
      },
    },
    async ({ recordId, clientQuery, date, dateStart, dateEnd, dateLabel, focus }, extra) => {
      const actor = await requireAdminToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const safeDateArgs = normalizeActivityReportDateArgs({ date, dateStart, dateEnd });
      const result = await getRecordActivityReport({
        recordId,
        recordQuery: clientQuery,
        ...safeDateArgs,
        dateLabel,
        focus,
        actor,
        blueAuth,
        transport: "mcp",
      });

      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_employee_day_summary",
    {
      title: "Employee Day Summary",
      description:
        "Summarize one internal Aya employee's logged work for a given day from the local activity store. Do not use this for CRM clients or client emails.",
      inputSchema: {
        employeeId: z.string().optional(),
        employeeEmail: z.string().email().optional(),
        employeeName: z.string().optional(),
        date: z.string().optional(),
      },
    },
    async ({ employeeId, employeeEmail, employeeName, date }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      enforceSelfOrAdminEmployeeScope(actor, { employeeId, employeeEmail, employeeName });
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await getEmployeeDaySummary({
        employeeId: employeeId ?? actor?.employeeId,
        employeeEmail: employeeEmail ?? actor?.email,
        employeeName: employeeName ?? actor?.displayName,
        date,
      });
      return {
        content: [{ type: "text", text: result.summaryText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_team_day_summary",
    {
      title: "Team Day Summary",
      description:
        "Summarize logged team activity or list inactive employees for a given day. Do not use this for overdue files, due dates, assignments, or workload questions; use team follow-up or workload tools instead.",
      inputSchema: {
        date: z.string().optional(),
        inactiveOnly: z.boolean().default(false),
      },
    },
    async ({ date, inactiveOnly }, extra) => {
      const actor = await requireAdminToolActor(extra.requestInfo?.headers);
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await getTeamDaySummary({ date, inactiveOnly });
      return {
        content: [{ type: "text", text: result.summaryText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_team_follow_up_queue",
    {
      title: "Team Follow-Up Queue",
      description:
        "Admin/manager view of who has overdue, due-today, or stale Blue files in the allowed workspace. Use this for questions like 'who is overdue?', 'which employees have overdue files?', 'show team follow-up', or 'what files need attention across the team?'. This is about Blue file due dates, not logged activity inactivity.",
      inputSchema: {
        date: z.string().optional().describe("YYYY-MM-DD reference date"),
        limitPerEmployee: z.number().int().min(1).max(12).optional(),
      },
    },
    async ({ date, limitPerEmployee }, extra) => {
      const actor = await requireAdminToolActor(extra.requestInfo?.headers);
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await getTeamFollowUpQueue({ date, limitPerEmployee });
      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_reporting_overview",
    {
      title: "Reporting Overview",
      description:
        "Admin/manager reporting snapshot from Blue. Use this when a manager asks what dashboards or reports exist, whether enterprise reporting is enabled, or what reporting inventory is available.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const actor = await requireAdminToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await getReportingOverview({
        auth: blueAuth,
      });
      return {
        content: [{ type: "text", text: result.summaryText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_answer_reporting_question",
    {
      title: "Answer Reporting Question",
      description:
        "Admin/manager reporting helper for natural-language questions about Blue dashboards, reports, enterprise reporting availability, latest report activity, and reporting inventory.",
      inputSchema: {
        question: z.string().min(1),
      },
    },
    async ({ question }, extra) => {
      const actor = await requireAdminToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await answerReportingQuestion({
        question,
        auth: blueAuth,
      });
      return {
        content: [{ type: "text", text: result.answerText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_follow_up_queue",
    {
      title: "Follow-Up Queue",
      description:
        "Show which files need follow-up first for one internal employee: overdue files, due-today files, and stale files with no recent movement.",
      inputSchema: {
        employeeId: z.string().optional(),
        employeeEmail: z.string().email().optional(),
        employeeName: z.string().optional(),
        date: z.string().optional(),
      },
    },
    async ({ employeeId, employeeEmail, employeeName, date }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      enforceSelfOrAdminEmployeeScope(actor, { employeeId, employeeEmail, employeeName });
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await getEmployeeFollowUpQueue({
        employeeId: employeeId ?? actor?.employeeId,
        employeeEmail: employeeEmail ?? actor?.email,
        employeeName: employeeName ?? actor?.displayName,
        date,
      });
      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_employee_workload",
    {
      title: "Employee Workload",
      description:
        "Show the current open Blue workload assigned to one internal employee in the allowed workspace. Use this only when the user explicitly asks what someone is working on, asks for open files, or asks for workload. If the user names a person, such as Sarah or Rehan, you must pass that exact name as employeeName on the first call. Only omit employeeName/employeeEmail/employeeId for clear self requests like 'what am I working on' or 'my workload'. Do not narrate failed/retried calls; answer only with the final workload result. Do not use this for CRM clients, client emails, or ambiguous requests like 'show me Hamza' or 'open Hamza'.",
      inputSchema: {
        employeeId: z.string().optional(),
        employeeEmail: z.string().email().optional(),
        employeeName: z
          .string()
          .min(1)
          .describe(
            "Required. Pass the exact named employee, such as Sarah or Rehan. For the signed-in user, pass self.",
          ),
      },
    },
    async ({ employeeId, employeeEmail, employeeName }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      enforceSelfOrAdminEmployeeScope(actor, { employeeId, employeeEmail, employeeName });
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await getEmployeeWorkload({
        employeeId: employeeId ?? actor?.employeeId,
        employeeEmail: employeeEmail ?? actor?.email,
        employeeName: resolveRequestedEmployeeName(employeeName, actor),
      });
      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_employee_assignments",
    {
      title: "Employee Checklist Assignments",
      description:
        "Show Blue checklist assignment items assigned to one internal employee, including open work and completed checklist items. Use this when the user asks about the Assignments tab, assigned tasks, checklist tasks, what someone has to do, or what assignments someone completed.",
      inputSchema: {
        employeeId: z.string().optional(),
        employeeEmail: z.string().email().optional(),
        employeeName: z.string().optional(),
        status: z.enum(["open", "completed", "all"]).optional(),
      },
    },
    async ({ employeeId, employeeEmail, employeeName, status }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      enforceSelfOrAdminEmployeeScope(actor, {
        employeeId,
        employeeEmail,
        employeeName,
      });
      const targetName = employeeName ?? actor?.displayName;
      if (
        actor &&
        actor.roleName !== "admin" &&
        targetName &&
        targetName.trim().toLowerCase() !== actor.displayName.trim().toLowerCase()
      ) {
        throw new AppError(
          "Assignment reports for other employees require admin access.",
          {
            statusCode: 403,
            code: "PERMISSION_DENIED",
          },
        );
      }

      const result = await getEmployeeAssignmentReport({
        employeeId: employeeId ?? actor?.employeeId,
        employeeEmail: employeeEmail ?? actor?.email,
        employeeName: targetName,
        status,
      });
      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_get_user_mentions",
    {
      title: "Get My Mentions",
      description:
        "Show recent comments where you were mentioned using @Name. This helps you track feedback, requests, or questions directed at you by other team members.",
      inputSchema: {
        employeeName: z.string().optional().describe("Optional other employee name to check mentions for (requires admin access)"),
        dateStart: z.string().optional().describe("YYYY-MM-DD"),
        dateEnd: z.string().optional().describe("YYYY-MM-DD"),
      },
    },
    async ({ employeeName, dateStart, dateEnd }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      
      if (employeeName && actor.roleName !== "admin" && employeeName.toLowerCase() !== actor.displayName.toLowerCase()) {
         throw new Error("Checking mentions for other employees requires admin access.");
      }

      const result = await getUserMentionsReport({
        employeeName,
        dateStart,
        dateEnd,
        actor,
      });

      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_create_client_record",
    {
      title: "Create Client Record",
      description:
        "Create a new lead/client record in the allowed Aya workspace `00- AYA Sales CRM 3`. Use targetListQuery if the user names the desired stage or list. Prefer explicit firstName and lastName. Normalize names to normal human casing, keep email lowercase, normalize phone formatting, and ask a short follow-up if the name is ambiguous. Do not invent purchase price or down payment. If this tool succeeds, do not call move, detail, or comments tools unless the user explicitly asks for another action.",
      inputSchema: {
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        fullName: z.string().min(1).optional(),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        financeAmount: z.number().positive().optional(),
        notes: z.string().optional(),
        targetListQuery: z.string().optional(),
      },
    },
    async (
      {
        firstName,
        lastName,
        fullName,
        phone,
        email,
        financeAmount,
        notes,
        targetListQuery,
      },
      extra,
    ) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await runAuditedMcpTool({
        actor,
        toolName: "aya_create_client_record",
        intent: "records.create",
        inboundText: `create lead ${[fullName ?? [firstName, lastName].filter(Boolean).join(" "), phone, email].filter(Boolean).join(" ")}`.trim(),
        requestJson: {
          firstName,
          lastName,
          fullName,
          phone,
          email,
          financeAmount,
          notes,
          targetListQuery,
        },
        execute: () =>
          createClientRecord({
            firstName,
            lastName,
            fullName,
            phone,
            email,
            financeAmount,
            notes,
            targetListQuery,
            actor,
            blueAuth,
          }),
      });
      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_move_client_to_stage",
    {
      title: "Move Client To Stage",
      description:
        "Move an existing Blue CRM record to another list in the allowed Aya workspace `00- AYA Sales CRM 3`. Use this only for an existing record that already exists in Blue. Do not use this immediately after successfully creating a new lead unless the user explicitly asks for a second separate move.",
      inputSchema: {
        recordQuery: z.string().min(1),
        targetListQuery: z.string().min(1),
      },
    },
    async ({ recordQuery, targetListQuery }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await runAuditedMcpTool({
        actor,
        toolName: "aya_move_client_to_stage",
        intent: "records.move",
        inboundText: `move ${recordQuery} to ${targetListQuery}`,
        requestJson: {
          recordQuery,
          targetListQuery,
        },
        execute: () =>
          moveClientToStage({
            recordQuery,
            targetListQuery,
            actor,
            blueAuth,
          }),
      });
      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_add_client_comment",
    {
      title: "Add Client Comment",
      description:
        "Add a comment to a Blue CRM record in the allowed Aya workspace `00- AYA Sales CRM 3`.",
      inputSchema: {
        recordQuery: z.string().min(1),
        text: z.string().min(1),
      },
    },
    async ({ recordQuery, text }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await runAuditedMcpTool({
        actor,
        toolName: "aya_add_client_comment",
        intent: "comments.create",
        inboundText: `add comment to ${recordQuery}: ${text}`,
        requestJson: {
          recordQuery,
          text,
        },
        execute: () =>
          addCommentToClient({
            recordQuery,
            text,
            actor,
            blueAuth,
          }),
      });
      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_assign_record",
    {
      title: "Assign Client Record",
      description:
        "Assign a Blue CRM record to a specific employee. Use this when the user says 'assign X to Y' or 'give X to Y'.",
      inputSchema: {
        entityQuery: z.string().min(1).describe("The record/client name or query"),
        assigneeName: z.string().min(1).describe("The name of the employee to assign it to"),
      },
    },
    async ({ entityQuery, assigneeName }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await runAuditedMcpTool({
        actor,
        toolName: "aya_assign_record",
        intent: "records.assign",
        inboundText: `assign ${entityQuery} to ${assigneeName}`,
        requestJson: { entityQuery, assigneeName },
        execute: () =>
          assignRecord({
            entityQuery,
            assigneeName,
            actor,
            blueAuth,
          }),
      });
      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  server.registerTool(
    "aya_assign_task",
    {
      title: "Assign Checklist Task",
      description:
        "Assign a specific checklist item (task) within a record to an employee. Use this when the user says 'assign task X on client Y to Z'.",
      inputSchema: {
        recordQuery: z.string().optional().describe("The record/client name or query"),
        taskQuery: z.string().min(1).describe("The checklist task name/query"),
        assigneeName: z.string().min(1).describe("The name of the employee to assign it to"),
      },
    },
    async ({ recordQuery, taskQuery, assigneeName }, extra) => {
      const actor = await requireToolActor(extra.requestInfo?.headers);
      const blueAuth = await requireHeaderBlueAuth(extra.requestInfo?.headers, actor);
      const result = await runAuditedMcpTool({
        actor,
        toolName: "aya_assign_task",
        intent: "tasks.assign",
        inboundText: `assign task ${taskQuery}${recordQuery ? ` on ${recordQuery}` : ""} to ${assigneeName}`,
        requestJson: { recordQuery, taskQuery, assigneeName },
        execute: () =>
          assignTask({
            recordQuery,
            taskQuery,
            assigneeName,
            actor,
            blueAuth,
          }),
      });
      return {
        content: [{ type: "text", text: result.responseText }],
        structuredContent: toStructuredContent(result),
      };
    },
  );

  return server;
}

function normalizeActivityReportDateArgs(input: {
  date?: string;
  dateStart?: string;
  dateEnd?: string;
}) {
  return {
    date: normalizeActivityReportDate(input.date),
    dateStart: normalizeActivityReportDate(input.dateStart),
    dateEnd: normalizeActivityReportDate(input.dateEnd),
  };
}

export function normalizeWorkspaceActivityReportDateArgs(input: {
  date?: string;
  dateStart?: string;
  dateEnd?: string;
}) {
  const dateStart = normalizeActivityReportDate(input.dateStart);
  const dateEnd = normalizeActivityReportDate(input.dateEnd);

  if (dateStart || dateEnd) {
    return { date: undefined, dateStart, dateEnd };
  }

  const date = normalizeActivityReportDate(input.date);
  const today = new Date().toISOString().slice(0, 10);

  // For workspace "today" prompts, smaller models sometimes pass a date copied
  // from prior client context. Default mismatched single-date calls to the
  // server's actual current date instead of reporting stale activity as today.
  return { date: date === today ? date : undefined, dateStart: undefined, dateEnd: undefined };
}

function normalizeActivityReportDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  // gpt-4o-mini can invent stale 2023 dates for "today". Aya's reporting is
  // operational/current, so pre-2025 dates are treated as model noise and
  // omitted to let the report service default to the server clock.
  if (normalized < MIN_REASONABLE_ACTIVITY_DATE) {
    return undefined;
  }

  return normalized;
}
