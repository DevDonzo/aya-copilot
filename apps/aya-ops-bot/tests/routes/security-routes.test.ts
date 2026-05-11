import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../helpers/test-env.js";

describe("security-sensitive routes", () => {
  beforeEach(() => {
    vi.resetModules();
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
