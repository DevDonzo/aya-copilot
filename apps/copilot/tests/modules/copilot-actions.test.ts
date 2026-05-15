import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../helpers/test-env.js";

describe("copilot actions", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("searches the local client cache before refreshing Blue", async () => {
    const env = createTestEnvironment();
    const syncWorkspaceIndex = vi.fn();
    const searchRecordQuery = vi.fn().mockResolvedValue([
      {
        id: "record_hassan",
        title: "Hassan Khan",
        listTitle: "Soft Approved",
      },
    ]);

    mockWorkspaceIndex({ searchRecordQuery, syncWorkspaceIndex });

    const { searchClients } = await import(
      "../../src/modules/copilot/actions.js"
    );
    try {
      const result = await searchClients({ query: "Hassan Khan" });

      expect(result.items).toHaveLength(1);
      expect(searchRecordQuery).toHaveBeenCalledOnce();
      expect(syncWorkspaceIndex).not.toHaveBeenCalled();
    } finally {
      env.cleanup();
    }
  });

  it("refreshes Blue and retries when the client cache has no match", async () => {
    const env = createTestEnvironment();
    const syncWorkspaceIndex = vi.fn().mockResolvedValue(undefined);
    const searchRecordQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "record_hassan",
          title: "Hassan Khan",
          listTitle: "Soft Approved",
        },
      ]);

    mockWorkspaceIndex({ searchRecordQuery, syncWorkspaceIndex });

    const { searchClients } = await import(
      "../../src/modules/copilot/actions.js"
    );
    try {
      const result = await searchClients({ query: "Hassan Khan" });

      expect(result.items).toHaveLength(1);
      expect(searchRecordQuery).toHaveBeenCalledTimes(2);
      expect(syncWorkspaceIndex).toHaveBeenCalledOnce();
    } finally {
      env.cleanup();
    }
  });

  it("resolves client details from cache before refreshing Blue", async () => {
    const env = createTestEnvironment();
    const syncWorkspaceIndex = vi.fn();
    const searchRecordQuery = vi.fn().mockResolvedValue([]);
    const resolveRecordQuery = vi.fn().mockResolvedValue({
      match: {
        id: "record_hassan",
        title: "Hassan Khan - New - Port and Increase - $80,000 - TBD",
        listId: "list_soft_approved",
        listTitle: "2- Soft Approved",
      },
      candidates: [],
    });
    const getBlueRecordDetail = vi.fn().mockResolvedValue({
      id: "record_hassan",
      title: "Hassan Khan - New - Port and Increase - $80,000 - TBD",
      list: "2- Soft Approved",
      status: "Active",
      description: "",
      startedAt: null,
      dueAt: "2026-05-25T23:59:00.285Z",
      commentsCount: 0,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      customFields: [],
      contact: {
        firstName: "Hassan",
        lastName: "Khan",
        phone: "",
        email: "",
        uniqueId: "",
      },
      assignees: [{ id: "employee_arslan", name: "Arslan Shahid", email: "" }],
      tags: [],
      recentActivity: [],
    });

    mockWorkspaceIndex({ searchRecordQuery, syncWorkspaceIndex, resolveRecordQuery });
    vi.doMock("../../src/blue/record-detail.js", () => ({
      getBlueRecordDetail,
    }));

    const { getClientDetail } = await import(
      "../../src/modules/copilot/actions.js"
    );
    try {
      const result = await getClientDetail({ recordQuery: "Hassan Khan" });

      expect(result.recordId).toBe("record_hassan");
      expect(resolveRecordQuery).toHaveBeenCalledWith("Hassan Khan");
      expect(getBlueRecordDetail).toHaveBeenCalledWith("record_hassan", undefined);
      expect(syncWorkspaceIndex).not.toHaveBeenCalled();
    } finally {
      env.cleanup();
    }
  });
});

function mockWorkspaceIndex(input: {
  searchRecordQuery: ReturnType<typeof vi.fn>;
  syncWorkspaceIndex: ReturnType<typeof vi.fn>;
  resolveRecordQuery?: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("../../src/blue/workspace-index.js", () => ({
    getIndexedRecord: vi.fn(),
    resolveListQuery: vi.fn(),
    resolveRecordQuery: input.resolveRecordQuery ?? vi.fn(),
    searchRecordQuery: input.searchRecordQuery,
    syncWorkspaceIndex: input.syncWorkspaceIndex,
  }));
}
