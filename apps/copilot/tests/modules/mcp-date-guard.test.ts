import { describe, expect, it, vi } from "vitest";

describe("MCP workspace activity date guard", () => {
  it("ignores stale single-date arguments so today uses the server clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00.000Z"));

    try {
      const { normalizeWorkspaceActivityReportDateArgs } = await import(
        "../../src/mcp/server.js"
      );

      expect(
        normalizeWorkspaceActivityReportDateArgs({
          date: "2026-03-03",
        }),
      ).toEqual({
        date: undefined,
        dateStart: undefined,
        dateEnd: undefined,
      });
      expect(
        normalizeWorkspaceActivityReportDateArgs({
          date: "2026-04-22",
        }),
      ).toEqual({
        date: "2026-04-22",
        dateStart: undefined,
        dateEnd: undefined,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves explicit date ranges", async () => {
    const { normalizeWorkspaceActivityReportDateArgs } = await import(
      "../../src/mcp/server.js"
    );

    expect(
      normalizeWorkspaceActivityReportDateArgs({
        dateStart: "2026-03-01",
        dateEnd: "2026-03-03",
      }),
    ).toEqual({
      date: undefined,
      dateStart: "2026-03-01",
      dateEnd: "2026-03-03",
    });
  });
});
