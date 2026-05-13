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

  it("formats unmapped LibreChat accounts without asking the user to type identity", async () => {
    const { formatUnmappedEmployeeMessage, resolveActorIdentity } = await import(
      "../../src/modules/identity/service.js"
    );

    expect(
      formatUnmappedEmployeeMessage({
        employeeEmail: "codex.qa.20260513.1827@ayafinancial.com",
      }),
    ).toBe(
      "Your Copilot account is not linked to an Aya employee profile. Ask an admin to link codex.qa.20260513.1827@ayafinancial.com.",
    );
    expect(
      formatUnmappedEmployeeMessage({
        employeeEmail: "{{LIBRECHAT_USER_EMAIL}}",
      }),
    ).toBe(
      "Aya Copilot could not read your signed-in LibreChat employee email. Ask an admin to check the LibreChat-to-Aya identity headers.",
    );

    await expect(
      resolveActorIdentity({
        employeeEmail: "codex.qa.20260513.1827@ayafinancial.com",
      }),
    ).rejects.toThrow(
      "Your Copilot account is not linked to an Aya employee profile. Ask an admin to link codex.qa.20260513.1827@ayafinancial.com.",
    );
  });
});
