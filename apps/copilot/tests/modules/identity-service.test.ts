import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../helpers/test-env.js";

describe("identity service", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("falls back from an unknown email header to the matching employee name", async () => {
    const env = createTestEnvironment();

    try {
      const { ensureEmployee, initializeDatabase } = await import("../../src/db.js");
      await initializeDatabase();
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "admin",
      });

      const { resolveActorIdentity } = await import(
        "../../src/modules/identity/service.js"
      );

      const actor = await resolveActorIdentity({
        employeeEmail: "hamza.test@ayafinancial.com",
        employeeName: "Hamza Paracha",
        autoLinkByEmail: true,
      });

      expect(actor).toMatchObject({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        roleName: "admin",
      });
    } finally {
      env.cleanup();
    }
  });
});
