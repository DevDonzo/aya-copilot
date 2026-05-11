import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../helpers/test-env.js";

describe("MCP tool audit logging", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("records direct MCP move and comment tools in audit-backed workspace reports", async () => {
    const env = createTestEnvironment();

    try {
      const { ensureEmployee, initializeDatabase } = await import("../../src/db.js");
      await initializeDatabase();

      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza.local@ayafinancial.com",
        roleName: "admin",
      });

      const { runAuditedMcpTool } = await import("../../src/mcp/server.js");
      const { getWorkspaceActivityReport } = await import(
        "../../src/modules/copilot/actions.js"
      );

      const actor = {
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        roleName: "admin",
        email: "hamza.local@ayafinancial.com",
      } as const;

      await runAuditedMcpTool({
        actor,
        toolName: "aya_move_client_to_stage",
        intent: "records.move",
        inboundText: "move aya demo borrower to 0.3 leads",
        requestJson: {
          recordQuery: "Aya Demo Borrower",
          targetListQuery: "0.3 Leads",
        },
        execute: async () => ({
          ok: true,
          recordId: "record_1",
          recordTitle: "Aya Demo Borrower",
          targetListId: "list_03",
          targetListTitle: "0.3 Leads",
          responseText: "Moved Aya Demo Borrower to 0.3 Leads.",
        }),
      });

      await runAuditedMcpTool({
        actor,
        toolName: "aya_add_client_comment",
        intent: "comments.create",
        inboundText: "add comment to aya demo borrower: testing demo",
        requestJson: {
          recordQuery: "Aya Demo Borrower",
          text: "testing demo",
        },
        execute: async () => ({
          recordId: "record_1",
          recordTitle: "Aya Demo Borrower",
          text: "testing demo",
          responseText: "Added comment to Aya Demo Borrower.",
        }),
      });

      const report = await getWorkspaceActivityReport({
        date: new Date().toISOString().slice(0, 10),
      });

      expect(report.moves).toHaveLength(1);
      expect(report.comments).toHaveLength(1);
      expect(report.moves[0]).toMatchObject({
        employeeName: "Hamza Paracha",
        recordTitle: "Aya Demo Borrower",
        targetListTitle: "0.3 Leads",
      });
      expect(report.comments[0]).toMatchObject({
        employeeName: "Hamza Paracha",
        recordTitle: "Aya Demo Borrower",
        text: "testing demo",
      });
    } finally {
      env.cleanup();
    }
  });
});
