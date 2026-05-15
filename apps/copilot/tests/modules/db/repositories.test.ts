import { describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../../helpers/test-env.js";

describe("db repositories", () => {
  it("persists audit detail JSON and reads it back", async () => {
    const env = createTestEnvironment();
    try {
      vi.resetModules();
      const { initializeDatabase, insertBotAuditLog, getAdminDashboardLogDetail } =
        await import("../../../src/db.js");

      await initializeDatabase();
      await insertBotAuditLog({
        id: "audit_1",
        transport: "web",
        inboundText: "hello",
        adapter: "local",
        outcome: "success",
        responseText: "ok",
        requestJson: { prompt: "hello" },
        responseJson: { message: "ok" },
      });

      const detail = await getAdminDashboardLogDetail("audit_1");

      expect(detail?.request_json).toContain("\"prompt\":\"hello\"");
      expect(detail?.response_json).toContain("\"message\":\"ok\"");
    } finally {
      env.cleanup();
    }
  });

  it("stores and deletes identity links", async () => {
    const env = createTestEnvironment();
    try {
      vi.resetModules();
      const {
        initializeDatabase,
        ensureEmployee,
        upsertIdentityLink,
        listIdentityLinks,
        deleteIdentityLinkById,
      } = await import("../../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "emp_1",
        displayName: "Hamza",
        email: "hamza@example.com",
      });
      await upsertIdentityLink({
        id: "ident_1",
        employeeId: "emp_1",
        source: "manual",
        externalId: "manual-user",
      });

      expect((await listIdentityLinks())).toHaveLength(1);
      await deleteIdentityLinkById("ident_1");
      expect((await listIdentityLinks())).toHaveLength(0);
    } finally {
      env.cleanup();
    }
  });

  it("tracks sync state rows", async () => {
    const env = createTestEnvironment();
    try {
      vi.resetModules();
      const { initializeDatabase, upsertBlueSyncState, listBlueSyncStates } =
        await import("../../../src/db.js");

      await initializeDatabase();
      await upsertBlueSyncState({
        workspaceId: "cmhazc4rl1vkand1eonnmiyjy",
        entityType: "records",
        lastIncrementalSyncAt: "2026-03-25T00:00:00.000Z",
        lastSeenUpdatedAt: "2026-03-25T00:01:00.000Z",
      });

      const states = await listBlueSyncStates("cmhazc4rl1vkand1eonnmiyjy");
      expect(states).toHaveLength(1);
      expect(states[0]?.entity_type).toBe("records");
    } finally {
      env.cleanup();
    }
  });

  it("deduplicates repeated Blue record ids during full cache replacement", async () => {
    const env = createTestEnvironment();
    try {
      vi.resetModules();
      const { initializeDatabase, listCachedBlueRecords, replaceBlueRecordsCache } =
        await import("../../../src/db.js");

      await initializeDatabase();
      await replaceBlueRecordsCache({
        workspaceId: "cmhazc4rl1vkand1eonnmiyjy",
        items: [
          {
            id: "todo_1",
            listId: "list_old",
            listTitle: "Old Stage",
            title: "Repeated Client",
            normalizedTitle: "repeated client",
          },
          {
            id: "todo_1",
            listId: "list_new",
            listTitle: "New Stage",
            title: "Repeated Client",
            normalizedTitle: "repeated client",
          },
        ],
      });

      const records = await listCachedBlueRecords("cmhazc4rl1vkand1eonnmiyjy");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id: "todo_1",
        list_id: "list_new",
        list_title: "New Stage",
      });
    } finally {
      env.cleanup();
    }
  });
});
