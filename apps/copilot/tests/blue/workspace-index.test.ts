import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

import { createTestEnvironment } from "../helpers/test-env.js";

let phase: "full" | "incremental" | "retry" = "full";
let retryAttempt = 0;

const server = setupServer(
  http.post("https://blue.test/graphql", async ({ request }) => {
    const body = (await request.json()) as {
      query: string;
      variables: Record<string, unknown>;
    };

    if (body.query.includes("query WorkspaceLists")) {
      if (phase === "retry" && retryAttempt++ === 0) {
        return HttpResponse.json(
          { errors: [{ message: "temporary unavailable" }] },
          { status: 429 },
        );
      }

      return HttpResponse.json({
        data: {
          todoLists: [
            {
              id: "list_1",
              uid: "list_uid_1",
              title: "Leads",
              position: 1,
              createdAt: "2026-03-25T00:00:00.000Z",
              updatedAt: "2026-03-25T00:00:00.000Z",
              todosCount: 1,
            },
          ],
        },
      });
    }

    if (body.query.includes("query WorkspaceListRecords")) {
      if (phase === "incremental") {
        return HttpResponse.json({
          data: {
            todoList: {
              id: "list_1",
              title: "Leads",
              todos: [
                {
                  id: "todo_1",
                  uid: "todo_uid_1",
                  title: "Sheraz moved forward",
                  text: "",
                  html: "",
                  startedAt: null,
                  duedAt: null,
                  commentCount: 0,
                  archived: false,
                  done: false,
                  createdAt: "2026-03-25T00:00:00.000Z",
                  updatedAt: "2026-03-25T01:00:00.000Z",
                  users: [],
                  tags: [],
                  customFields: [
                    {
                      id: "cf_email",
                      name: "Email",
                      type: "TEXT",
                      value: "hamza@ayafinancial.com",
                    },
                    {
                      id: "cf_phone",
                      name: "Phone",
                      type: "TEXT",
                      value: "6475683720",
                    },
                  ],
                  todoList: {
                    id: "list_1",
                    uid: "list_uid_1",
                    title: "Leads",
                    position: 1,
                    updatedAt: "2026-03-25T01:00:00.000Z",
                  },
                },
              ],
            },
          },
        });
      }

      return HttpResponse.json({
        data: {
          todoList: {
            id: "list_1",
            title: "Leads",
            todos: [
              {
                id: "todo_1",
                uid: "todo_uid_1",
                title: "Sheraz initial",
                text: "",
                html: "",
                startedAt: null,
                duedAt: null,
                commentCount: 0,
                archived: false,
                done: false,
                createdAt: "2026-03-25T00:00:00.000Z",
                updatedAt: "2026-03-25T00:00:00.000Z",
                users: [],
                tags: [],
                customFields: [
                  {
                    id: "cf_email",
                    name: "Email",
                    type: "TEXT",
                    value: "hamza@ayafinancial.com",
                  },
                  {
                    id: "cf_phone",
                    name: "Phone",
                    type: "TEXT",
                    value: "6475683720",
                  },
                ],
                todoList: {
                  id: "list_1",
                  uid: "list_uid_1",
                  title: "Leads",
                  position: 1,
                  updatedAt: "2026-03-25T00:00:00.000Z",
                },
              },
            ],
          },
        },
      });
    }

    return HttpResponse.json({ data: {} });
  }),
);

describe("syncWorkspaceIndex", () => {
  beforeAll(() => server.listen());
  afterEach(() => {
    server.resetHandlers();
    phase = "full";
    retryAttempt = 0;
  });
  afterAll(() => server.close());

  it("performs the initial full sync and stores cached records", async () => {
    const env = createTestEnvironment();
    try {
      vi.resetModules();
      const { syncWorkspaceIndex, getIndexedRecord, resolveRecordQuery } =
        await import("../../src/blue/workspace-index.js");

      const result = await syncWorkspaceIndex();
      const cached = await getIndexedRecord("todo_1");
      const byEmail = await resolveRecordQuery("hamza@ayafinancial.com");
      const byPhone = await resolveRecordQuery("6475683720");

      expect(result.mode).toBe("full");
      expect(result.recordsSynced).toBe(1);
      expect(cached?.title).toBe("Sheraz initial");
      expect(byEmail?.match?.id).toBe("todo_1");
      expect(byPhone?.match?.id).toBe("todo_1");
    } finally {
      env.cleanup();
    }
  });

  it("updates only changed records during incremental sync", async () => {
    const env = createTestEnvironment();
    try {
      vi.resetModules();
      const { syncWorkspaceIndex, getIndexedRecord } =
        await import("../../src/blue/workspace-index.js");

      await syncWorkspaceIndex();
      phase = "incremental";
      const result = await syncWorkspaceIndex();
      const cached = await getIndexedRecord("todo_1");

      expect(result.mode).toBe("incremental");
      expect(cached?.title).toBe("Sheraz moved forward");
    } finally {
      env.cleanup();
    }
  });

  it("retries on rate limiting and still succeeds", async () => {
    const env = createTestEnvironment();
    try {
      phase = "retry";
      vi.resetModules();
      const { syncWorkspaceIndex } =
        await import("../../src/blue/workspace-index.js");

      const result = await syncWorkspaceIndex();

      expect(result.recordsSynced).toBe(1);
      expect(retryAttempt).toBeGreaterThan(0);
    } finally {
      env.cleanup();
    }
  });
});
