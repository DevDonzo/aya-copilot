import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../helpers/test-env.js";

describe("security-sensitive routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("rejects unauthenticated access to data routes and bootstrap provisioning", async () => {
    const env = createTestEnvironment();

    try {
      const app = await buildSecurityTestApp();

      for (const [method, url, payload] of [
        ["GET", "/records/search", undefined],
        ["GET", "/summary/team", undefined],
        ["POST", "/messages", { message: "show my assignments" }],
      ] as const) {
        const response = await app.inject({
          method,
          url,
          payload,
        });
        expect(response.statusCode).toBe(401);
      }

      const bootstrapResponse = await app.inject({
        method: "POST",
        url: "/auth/provision",
        headers: {
          "x-bootstrap-key": "aya-dev-bootstrap-key",
        },
        payload: {
          employeeName: "Anyone",
          password: "Temp12345!",
          roleName: "admin",
        },
      });

      expect(bootstrapResponse.statusCode).toBe(401);
      await app.close();
    } finally {
      env.cleanup();
    }
  });

  it("forces message actor identity to the authenticated session", async () => {
    const env = createTestEnvironment();

    try {
      const app = await buildSecurityTestApp();
      const { ensureEmployee, createAuthSession, createId } =
        await import("../../src/db.js");

      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await ensureEmployee({
        employeeId: "employee_2",
        displayName: "Sarah Khan",
        email: "sarah@ayafinancial.com",
        roleName: "employee",
      });
      await createAuthSession({
        id: createId("session"),
        employeeId: "employee_1",
        sessionToken: "employee-session-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });

      const response = await app.inject({
        method: "POST",
        url: "/messages",
        headers: {
          cookie: "aya_session=employee-session-token",
        },
        payload: {
          actorEmployeeId: "employee_2",
          actorEmployeeName: "Sarah Khan",
          message: "show my assignments",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        actorEmployeeId: "employee_1",
        actorEmployeeName: "Hamza Paracha",
      });

      await app.close();
    } finally {
      env.cleanup();
    }
  });

  it("requires validated personal Blue credentials on direct record routes", async () => {
    const env = createTestEnvironment();

    try {
      const app = await buildSecurityTestApp();
      const {
        ensureEmployee,
        createAuthSession,
        createId,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");

      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await createAuthSession({
        id: createId("session"),
        employeeId: "employee_1",
        sessionToken: "employee-record-session",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      await upsertBlueRecordsCache({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        items: [
          {
            id: "record_1",
            listId: "list_leads",
            listTitle: "Leads",
            title: "Hamza Client",
            normalizedTitle: "hamza client",
            status: "Active",
            rawJson: "{}",
          },
        ],
      });

      const blocked = await app.inject({
        method: "GET",
        url: "/records/search?q=Hamza",
        headers: {
          cookie: "aya_session=employee-record-session",
        },
      });
      expect(blocked.statusCode).toBe(401);
      expect(blocked.json()).toMatchObject({
        error:
          "Connect your Blue account before using Aya with CRM data. Open the Aya MCP server settings and enter both your Blue Token ID and Blue Token Secret, then try again.",
      });

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              currentUser: {
                id: "employee_1",
                uid: "employee_1",
                email: "hamza@ayafinancial.com",
                fullName: "Hamza Paracha",
                projectUserRole: {
                  id: "role_1",
                  name: "Member",
                  isRecordsEnabled: true,
                },
              },
            },
          }),
        })),
      );

      const allowed = await app.inject({
        method: "GET",
        url: "/records/search?q=Hamza",
        headers: {
          cookie: "aya_session=employee-record-session",
          "x-aya-blue-token-id": "00000000000000000000000000000001",
          "x-aya-blue-token-secret": "test-blue-secret",
        },
      });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({
        items: [
          {
            id: "record_1",
            title: "Hamza Client",
          },
        ],
      });

      await app.close();
    } finally {
      env.cleanup();
    }
  });

  it("enforces employee and admin access on summary routes", async () => {
    const env = createTestEnvironment();

    try {
      const app = await buildSecurityTestApp();
      const { ensureEmployee, createAuthSession, createId } =
        await import("../../src/db.js");

      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await ensureEmployee({
        employeeId: "employee_2",
        displayName: "Sarah Khan",
        email: "sarah@ayafinancial.com",
        roleName: "employee",
      });
      await ensureEmployee({
        employeeId: "admin_1",
        displayName: "Admin User",
        email: "admin@ayafinancial.com",
        roleName: "admin",
      });
      await createAuthSession({
        id: createId("session"),
        employeeId: "employee_1",
        sessionToken: "employee-summary-session",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      await createAuthSession({
        id: createId("session"),
        employeeId: "admin_1",
        sessionToken: "admin-summary-session",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });

      const ownSummary = await app.inject({
        method: "GET",
        url: "/summary/day?date=2026-04-09",
        headers: {
          cookie: "aya_session=employee-summary-session",
        },
      });
      expect(ownSummary.statusCode).toBe(200);
      expect(ownSummary.json()).toMatchObject({
        employeeId: "employee_1",
        employeeName: "Hamza Paracha",
      });

      const otherSummary = await app.inject({
        method: "GET",
        url: "/summary/day?employeeId=employee_2&date=2026-04-09",
        headers: {
          cookie: "aya_session=employee-summary-session",
        },
      });
      expect(otherSummary.statusCode).toBe(403);

      const employeeTeamSummary = await app.inject({
        method: "GET",
        url: "/summary/team?date=2026-04-09",
        headers: {
          cookie: "aya_session=employee-summary-session",
        },
      });
      expect(employeeTeamSummary.statusCode).toBe(403);

      const adminTeamSummary = await app.inject({
        method: "GET",
        url: "/summary/team?date=2026-04-09",
        headers: {
          cookie: "aya_session=admin-summary-session",
        },
      });
      expect(adminTeamSummary.statusCode).toBe(200);
      expect(adminTeamSummary.json()).toMatchObject({
        date: "2026-04-09",
      });

      const adminOtherSummary = await app.inject({
        method: "GET",
        url: "/summary/day?employee=Sarah%20Khan&date=2026-04-09",
        headers: {
          cookie: "aya_session=admin-summary-session",
        },
      });
      expect(adminOtherSummary.statusCode).toBe(200);
      expect(adminOtherSummary.json()).toMatchObject({
        employeeId: "employee_2",
        employeeName: "Sarah Khan",
      });

      await app.close();
    } finally {
      env.cleanup();
    }
  });

  it("locks repeated failed logins and audits the attempts", async () => {
    const env = createTestEnvironment();

    try {
      const app = await buildSecurityTestApp();
      const {
        ensureEmployee,
        listBotAuditLogsForDay,
      } = await import("../../src/db.js");
      const { provisionEmployeeAccess } = await import("../../src/auth/service.js");

      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await provisionEmployeeAccess({
        employeeId: "employee_1",
        password: "Correct123!",
        roleName: "employee",
      });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: {
            employeeName: "Hamza Paracha",
            password: "wrong-password",
          },
        });
        expect(response.statusCode).toBe(401);
      }

      const lockedResponse = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          employeeName: "Hamza Paracha",
          password: "Correct123!",
        },
      });
      expect(lockedResponse.statusCode).toBe(401);
      expect(lockedResponse.json()).toMatchObject({
        error: "Too many failed login attempts. Try again later.",
      });

      const auditRows = await listBotAuditLogsForDay({
        dateIso: new Date().toISOString().slice(0, 10),
      });
      expect(
        auditRows.filter((row) => row.detected_intent === "auth.login").length,
      ).toBeGreaterThanOrEqual(6);

      await app.close();
    } finally {
      env.cleanup();
    }
  });

  it("sets secure auth cookies by default in production", async () => {
    const env = createTestEnvironment({
      NODE_ENV: "production",
      AYA_MCP_API_KEY: "test-mcp-key",
    });

    try {
      const app = await buildSecurityTestApp();
      const { ensureEmployee } = await import("../../src/db.js");
      const { provisionEmployeeAccess } = await import("../../src/auth/service.js");

      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await provisionEmployeeAccess({
        employeeId: "employee_1",
        password: "Correct123!",
        roleName: "employee",
      });

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          employeeName: "Hamza Paracha",
          password: "Correct123!",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["set-cookie"]).toContain("Secure");

      await app.close();
    } finally {
      env.cleanup();
    }
  });

  it("returns generic production 500 errors", async () => {
    const env = createTestEnvironment({
      NODE_ENV: "production",
      AYA_MCP_API_KEY: "test-mcp-key",
    });

    try {
      const { requestContextPlugin } = await import(
        "../../src/app/plugins/request-context.js"
      );
      const { errorHandlerPlugin } = await import(
        "../../src/app/plugins/error-handler.js"
      );
      const app = Fastify({ logger: false });
      await app.register(requestContextPlugin);
      await app.register(errorHandlerPlugin);
      app.get("/boom", async () => {
        throw new Error("sensitive stack detail");
      });

      const response = await app.inject({
        method: "GET",
        url: "/boom",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: "Internal server error",
      });
      expect(response.body).not.toContain("sensitive stack detail");

      await app.close();
    } finally {
      env.cleanup();
    }
  });
});

async function buildSecurityTestApp() {
  vi.doMock("../../src/messages/handle-message.js", () => ({
    handleInboundMessage: vi.fn(async (payload) => ({
      matched: true,
      actorEmployeeId: payload.actorEmployeeId,
      actorEmployeeName: payload.actorEmployeeName,
    })),
    planInboundMessage: vi.fn(async (payload) => ({
      actorEmployeeId: payload.actorEmployeeId,
      actorEmployeeName: payload.actorEmployeeName,
    })),
  }));

  const { initializeDatabase } = await import("../../src/db.js");
  const { requestContextPlugin } = await import("../../src/app/plugins/request-context.js");
  const { authPlugin } = await import("../../src/app/plugins/auth.js");
  const { errorHandlerPlugin } = await import("../../src/app/plugins/error-handler.js");
  const { messageRoutes } = await import("../../src/routes/messages.js");
  const { recordRoutes } = await import("../../src/routes/records.js");
  const { summaryRoutes } = await import("../../src/routes/summaries.js");
  const { authRoutes } = await import("../../src/routes/auth.js");

  await initializeDatabase();

  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(requestContextPlugin);
  await app.register(authPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(messageRoutes);
  await app.register(recordRoutes);
  await app.register(summaryRoutes);
  await app.register(authRoutes);

  return app;
}
