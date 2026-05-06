import fs from "node:fs";
import path from "node:path";

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
  getAdminDashboardLogDetail,
  getAdminDashboardOverview,
  listEmployees,
  listAdminDashboardRecentLogs,
  listWorkspaceEmployeeActivity,
  listBlueSyncStates,
  listBlueWebhookSubscriptions,
} from "../db.js";
import { runBlueIngestionOnce } from "../jobs/blue-poller.js";
import { listRecentLibreChatTranscripts } from "../librechat/transcripts.js";
import { syncWorkspaceEmployees } from "../blue/users-sync.js";
import { syncWorkspaceIndex } from "../blue/workspace-index.js";
import { config } from "../config.js";
import { NotFoundError } from "../app/errors.js";
import { buildManagerReport } from "../admin/manager-report.js";
import { getReportingOverview } from "../reporting/service.js";
import { normalizeBlueRequestAuth } from "../modules/blue/request-auth.js";
import {
  fetchWorkspaceUsers,
  listAssignedChecklistItems,
  listAssignedOpenRecords,
} from "../modules/blue/graphql/client.js";
import {
  adminLogsQuerySchema,
  managerReportQuerySchema,
  adminTranscriptsQuerySchema,
  syncBodySchema,
} from "../types/api.js";
import { parseWithSchema } from "../app/plugins/zod.js";

const adminUiDistDir = path.resolve(import.meta.dirname, "..", "..", "admin-ui", "dist");
const adminUiIndexPath = path.join(adminUiDistDir, "index.html");

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const serveAdminShell = async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!fs.existsSync(adminUiIndexPath)) {
      reply.type("text/html");
      return `
        <!doctype html>
        <html>
          <body style="font-family: sans-serif; padding: 24px;">
            <h1>Aya Admin UI</h1>
            <p>The React admin UI has not been built yet.</p>
            <p>Run <code>npm run build:admin-ui</code> in <code>apps/aya-ops-bot</code>.</p>
          </body>
        </html>
      `;
    }

    reply.type("text/html");
    return fs.readFileSync(adminUiIndexPath, "utf8");
  };

  app.get("/admin", serveAdminShell);
  app.get("/admin/", serveAdminShell);

  app.get("/admin/api/overview", { preHandler: [app.requireRoles(["admin"])] }, async (request) => {
    const date =
      (request.query as { date?: string } | undefined)?.date ?? getIsoDateString();
    const [syncStates, webhookSubscriptions] = await Promise.all([
      listBlueSyncStates(config.BLUE_READ_WORKSPACE_ID),
      listBlueWebhookSubscriptions(config.BLUE_WORKSPACE_ID),
    ]);
    return {
      overview: await getAdminDashboardOverview(date),
      employees: await listWorkspaceEmployeeActivity({
        workspaceId: config.BLUE_READ_WORKSPACE_ID,
        dateStart: date,
        dateEnd: date,
        limit: 50,
      }),
      sync: {
        states: syncStates,
        webhooks: webhookSubscriptions,
      },
    };
  });

  app.get("/admin/api/logs", { preHandler: [app.requireRoles(["admin"])] }, async (request) => {
    const query = parseWithSchema(adminLogsQuerySchema, request.query);
    return {
      items: await listAdminDashboardRecentLogs(query),
    };
  });

  app.get(
    "/admin/api/logs/:id",
    { preHandler: [app.requireRoles(["admin"])] },
    async (request) => {
      const detail = await getAdminDashboardLogDetail(
        (request.params as { id: string }).id,
      );
      if (!detail) {
        throw new NotFoundError("Audit log not found");
      }

      return {
        item: {
          ...detail,
          request_json: safeParseJson(detail.request_json),
          response_json: safeParseJson(detail.response_json),
        },
      };
    },
  );

  app.get(
    "/admin/api/employee-activity",
    { preHandler: [app.requireRoles(["admin"])] },
    async () => ({
      items: await listWorkspaceEmployeeActivity({
        workspaceId: config.BLUE_READ_WORKSPACE_ID,
        limit: 100,
      }),
    }),
  );

  app.get(
    "/admin/api/team-workload",
    { preHandler: [app.requireRoles(["admin"])] },
    async () => await buildTeamWorkloadSnapshot(),
  );

  app.get(
    "/admin/api/reporting",
    { preHandler: [app.requireRoles(["admin"])] },
    async (request) => {
      const overview = await getReportingOverview({
        auth: normalizeBlueRequestAuth({
          tokenId: getHeaderValue(
            request.headers,
            "x-aya-blue-token-id",
          ) ?? getHeaderValue(request.headers, "x-blue-token-id"),
          tokenSecret:
            getHeaderValue(request.headers, "x-aya-blue-token-secret") ??
            getHeaderValue(request.headers, "x-blue-token-secret"),
        }),
      });
      return {
        capability: overview.capability,
        dashboards: overview.dashboards,
        reports: overview.reports,
        errors: {
          dashboards: null,
          reports: null,
        },
      };
    },
  );

  app.get(
    "/admin/api/manager-report",
    { preHandler: [app.requireRoles(["admin"])] },
    async (request) => {
      const query = parseWithSchema(managerReportQuerySchema, request.query);
      return await buildManagerReport({
        dateStart: query.dateStart ?? getIsoDateString(),
        dateEnd: query.dateEnd ?? query.dateStart ?? getIsoDateString(),
        employeeId: query.employeeId,
        clientQuery: query.clientQuery,
        focus: query.focus,
      });
    },
  );

  app.get(
    "/admin/api/transcripts",
    { preHandler: [app.requireRoles(["admin"])] },
    async (request) => {
      const query = parseWithSchema(adminTranscriptsQuerySchema, request.query);
      return {
        items: await listRecentLibreChatTranscripts(query),
      };
    },
  );

  app.post(
    "/admin/api/sync/workspace-index",
    { preHandler: [app.requireRoles(["admin"])] },
    async (request) => {
      const payload = parseWithSchema(syncBodySchema, request.body) ?? {};
      return await syncWorkspaceIndex({
        forceFull: payload.forceFull,
      });
    },
  );

  app.post(
    "/admin/api/sync/employees",
    { preHandler: [app.requireRoles(["admin"])] },
    async () => await syncWorkspaceEmployees(),
  );

  app.post(
    "/admin/api/sync/blue-activity",
    { preHandler: [app.requireRoles(["admin"])] },
    async () => await runBlueIngestionOnce(),
  );
};

function getIsoDateString() {
  return new Date().toISOString().slice(0, 10);
}

async function buildTeamWorkloadSnapshot() {
  const today = getIsoDateString();
  const [workspaceUsers, employees] = await Promise.all([
    fetchWorkspaceUsers(config.BLUE_WORKSPACE_ID),
    listEmployees(),
  ]);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  const items = await Promise.all(
    workspaceUsers.map(async (user) => {
      const [recordsResult, checklistResult] = await Promise.all([
        listAssignedOpenRecords({
          workspaceId: config.BLUE_WORKSPACE_ID,
          companyId: config.BLUE_COMPANY_ID,
          assigneeId: user.id,
          limit: 25,
          skip: 0,
        }),
        listAssignedChecklistItems({
          workspaceId: config.BLUE_WORKSPACE_ID,
          assigneeId: user.id,
          done: false,
          todoDone: false,
          limit: 25,
          skip: 0,
        }),
      ]);

      const records = recordsResult.items.map((record) => ({
        id: record.id,
        title: record.title,
        listTitle: record.todoList.title,
        dueAt: record.duedAt ?? null,
        updatedAt: record.updatedAt ?? null,
        assigneeNames:
          record.users?.map((assignee) => assignee.fullName || assignee.email).filter(Boolean) ??
          [],
      }));

      const checklistItems = checklistResult.items.map((item) => ({
        id: item.id,
        title: item.title,
        checklistTitle: item.checklist.title,
        recordId: item.checklist.todo.id,
        recordTitle: item.checklist.todo.title,
        listTitle: item.checklist.todo.todoList.title,
        dueAt: item.duedAt ?? null,
        updatedAt: item.updatedAt ?? null,
        assigneeNames:
          item.users?.map((assignee) => assignee.fullName || assignee.email).filter(Boolean) ??
          [],
      }));

      const latestAssignedAt = [records, checklistItems]
        .flat()
        .map((item) => item.updatedAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

      const overdueCount = [...records, ...checklistItems].filter((item) => {
        if (!item.dueAt) {
          return false;
        }
        return item.dueAt.slice(0, 10) < today;
      }).length;

      const employee = employeeById.get(user.id);

      return {
        employeeId: user.id,
        displayName: user.fullName || employee?.display_name || user.email,
        email: employee?.email ?? user.email ?? null,
        roleName: employee?.role_name ?? null,
        openRecordCount: recordsResult.pageInfo.totalItems ?? records.length,
        openChecklistCount: checklistResult.pageInfo.totalItems ?? checklistItems.length,
        overdueCount,
        latestAssignedAt,
        openRecords: records,
        checklistItems,
      };
    }),
  );

  items.sort((left, right) => {
    const workDelta =
      right.openRecordCount +
      right.openChecklistCount -
      (left.openRecordCount + left.openChecklistCount);
    if (workDelta !== 0) {
      return workDelta;
    }

    const overdueDelta = right.overdueCount - left.overdueCount;
    if (overdueDelta !== 0) {
      return overdueDelta;
    }

    return left.displayName.localeCompare(right.displayName);
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      employees: items.length,
      employeesWithOpenWork: items.filter(
        (item) => item.openRecordCount > 0 || item.openChecklistCount > 0,
      ).length,
      openRecords: items.reduce((sum, item) => sum + item.openRecordCount, 0),
      openChecklistItems: items.reduce((sum, item) => sum + item.openChecklistCount, 0),
      overdue: items.reduce((sum, item) => sum + item.overdueCount, 0),
    },
    employees: items,
  };
}

function safeParseJson(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
) {
  const value =
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
