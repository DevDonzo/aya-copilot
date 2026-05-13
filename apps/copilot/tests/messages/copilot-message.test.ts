import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../helpers/test-env.js";

describe("Aya copilot message flow", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps active client context across detail and comment follow-ups", async () => {
    const env = createTestEnvironment();

    try {
      vi.doMock("../../src/modules/blue/graphql/client.js", async () => {
        const actual =
          await vi.importActual<
            typeof import("../../src/modules/blue/graphql/client.js")
          >("../../src/modules/blue/graphql/client.js");

        return {
          ...actual,
          fetchRecordDetail: vi.fn().mockResolvedValue({
            record: {
              id: "record_1",
              title: "Hamza Client",
              archived: false,
              done: false,
              text: "",
              startedAt: null,
              duedAt: null,
              commentCount: 2,
              createdAt: "2026-04-01T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              customFields: [],
              users: [],
              tags: [],
              todoList: {
                id: "list_leads",
                title: "Leads",
                position: 1,
                updatedAt: "2026-04-02T00:00:00.000Z",
              },
            },
            comments: [
              {
                id: "comment_2",
                text: "Docs received and ready for underwriting.",
                createdAt: "2026-04-02T10:00:00.000Z",
                updatedAt: "2026-04-02T10:00:00.000Z",
                user: { fullName: "Aya Copilot" },
              },
              {
                id: "comment_1",
                text: "Client called to confirm income details.",
                createdAt: "2026-04-01T09:00:00.000Z",
                updatedAt: "2026-04-01T09:00:00.000Z",
                user: { fullName: "Aya Copilot" },
              },
            ],
          }),
        };
      });

      const {
        ensureEmployee,
        initializeDatabase,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
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
            contactEmail: "hamza.client@example.com",
            normalizedContactEmail: "hamza.client@example.com",
            contactPhone: "4165550123",
            normalizedContactPhone: "4165550123",
            status: "Active",
            rawJson: "{}",
          },
        ],
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const detailResponse = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        message: "show me Hamza",
      });

      expect(detailResponse).toMatchObject({
        matched: true,
        intent: "records.detail",
      });
      expect(detailResponse.responseText).toContain(
        "Hamza Client is in Leads. Status: Active.",
      );

      const commentsResponse = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        message: "comments on this client",
      });

      expect(commentsResponse).toMatchObject({
        matched: true,
        intent: "comments.list_recent",
      });
      expect(commentsResponse.responseText).toContain(
        "Recent comments for Hamza Client:",
      );
      expect(commentsResponse.responseText).toContain(
        "Docs received and ready for underwriting.",
      );
    } finally {
      env.cleanup();
    }
  });

  it("returns a call-prep style client briefing", async () => {
    const env = createTestEnvironment();

    try {
      vi.doMock("../../src/modules/blue/graphql/client.js", async () => {
        const actual =
          await vi.importActual<
            typeof import("../../src/modules/blue/graphql/client.js")
          >("../../src/modules/blue/graphql/client.js");

        return {
          ...actual,
          fetchRecordDetail: vi.fn().mockResolvedValue({
            record: {
              id: "record_1",
              title: "Hamza Client",
              archived: false,
              done: false,
              text: "",
              startedAt: null,
              duedAt: null,
              commentCount: 2,
              createdAt: "2026-04-01T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              customFields: [],
              users: [
                {
                  id: "employee_1",
                  fullName: "Hamza Paracha",
                  email: "hamza@ayafinancial.com",
                  firstName: "Hamza",
                  lastName: "Paracha",
                },
              ],
              tags: [{ id: "tag_1", title: "Priority" }],
              todoList: {
                id: "list_underwriting",
                title: "Underwriting",
                position: 2,
                updatedAt: "2026-04-02T00:00:00.000Z",
              },
            },
            comments: [
              {
                id: "comment_2",
                text: "Client confirmed employment letter is ready.",
                createdAt: "2026-04-02T10:00:00.000Z",
                updatedAt: "2026-04-02T10:00:00.000Z",
                user: { fullName: "Aya Copilot" },
              },
              {
                id: "comment_1",
                text: "Waiting on updated bank statements.",
                createdAt: "2026-04-01T09:00:00.000Z",
                updatedAt: "2026-04-01T09:00:00.000Z",
                user: { fullName: "Aya Copilot" },
              },
            ],
          }),
        };
      });

      const {
        ensureEmployee,
        initializeDatabase,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await upsertBlueRecordsCache({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        items: [
          {
            id: "record_1",
            listId: "list_underwriting",
            listTitle: "Underwriting",
            title: "Hamza Client",
            normalizedTitle: "hamza client",
            contactEmail: "hamza.client@example.com",
            normalizedContactEmail: "hamza.client@example.com",
            contactPhone: "4165550123",
            normalizedContactPhone: "4165550123",
            status: "Active",
            rawJson: "{}",
          },
        ],
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        message: "prep me for a call with Hamza",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "records.detail",
      });
      expect(response.responseText).toContain("Call prep for Hamza Client");
      expect(response.responseText).toContain(
        "Latest note: Aya Copilot (2026-04-02): Client confirmed employment letter is ready.",
      );
      expect(response.responseText).toContain("Recent thread:");
      expect(response.responseText).toContain("Owner: Hamza Paracha");
    } finally {
      env.cleanup();
    }
  });

  it("returns a general file briefing with blockers and missing docs", async () => {
    const env = createTestEnvironment();

    try {
      vi.doMock("../../src/modules/blue/graphql/client.js", async () => {
        const actual =
          await vi.importActual<
            typeof import("../../src/modules/blue/graphql/client.js")
          >("../../src/modules/blue/graphql/client.js");

        return {
          ...actual,
          fetchRecordDetail: vi.fn().mockResolvedValue({
            record: {
              id: "record_1",
              title: "Hamza Client",
              archived: false,
              done: false,
              text: "Awaiting updated bank statements and employment letter from client.",
              startedAt: null,
              duedAt: "2026-04-10T00:00:00.000Z",
              commentCount: 2,
              createdAt: "2026-04-01T00:00:00.000Z",
              updatedAt: "2026-04-09T10:00:00.000Z",
              customFields: [
                {
                  id: "field_1",
                  name: "Employment letter",
                  type: "text",
                  value: "pending",
                },
                {
                  id: "field_2",
                  name: "Bank statements",
                  type: "text",
                  value: "missing",
                },
              ],
              users: [
                {
                  id: "employee_1",
                  fullName: "Hamza Paracha",
                  email: "hamza@ayafinancial.com",
                  firstName: "Hamza",
                  lastName: "Paracha",
                },
              ],
              tags: [{ id: "tag_1", title: "Urgent" }],
              todoList: {
                id: "list_underwriting",
                title: "Underwriting",
                position: 2,
                updatedAt: "2026-04-09T10:00:00.000Z",
              },
            },
            comments: [
              {
                id: "comment_2",
                text: "Waiting on updated bank statements from client.",
                createdAt: "2026-04-09T10:00:00.000Z",
                updatedAt: "2026-04-09T10:00:00.000Z",
                user: { fullName: "Aya Copilot" },
              },
              {
                id: "comment_1",
                text: "Employment letter still needed before we can proceed.",
                createdAt: "2026-04-08T09:00:00.000Z",
                updatedAt: "2026-04-08T09:00:00.000Z",
                user: { fullName: "Aya Copilot" },
              },
            ],
          }),
        };
      });

      const {
        ensureEmployee,
        initializeDatabase,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await upsertBlueRecordsCache({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        items: [
          {
            id: "record_1",
            listId: "list_underwriting",
            listTitle: "Underwriting",
            title: "Hamza Client",
            normalizedTitle: "hamza client",
            contactEmail: "hamza.client@example.com",
            normalizedContactEmail: "hamza.client@example.com",
            contactPhone: "4165550123",
            normalizedContactPhone: "4165550123",
            status: "Active",
            rawJson: "{}",
          },
        ],
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        message: "what's going on with Hamza",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "records.detail",
      });
      expect(response.responseText).toContain("Briefing for Hamza Client");
      expect(response.responseText).toContain(
        "Stage: Underwriting | Status: Active | Due: 2026-04-10 | Updated: 2026-04-09",
      );
      expect(response.responseText).toContain("Owner: Hamza Paracha");
      expect(response.responseText).toContain("Current blockers:");
      expect(response.responseText).toContain(
        "- Waiting on updated bank statements from client.",
      );
      expect(response.responseText).toContain("Still needed from client:");
      expect(response.responseText).toContain("- Employment Letter");
      expect(response.responseText).toContain("- Bank Statements");
      expect(response.responseText).toContain("Next best action:");
    } finally {
      env.cleanup();
    }
  });

  it("returns a prioritized follow-up queue for the signed-in employee", async () => {
    const env = createTestEnvironment();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00.000Z"));

    try {
      vi.doMock("../../src/modules/blue/graphql/client.js", async () => {
        const actual =
          await vi.importActual<
            typeof import("../../src/modules/blue/graphql/client.js")
          >("../../src/modules/blue/graphql/client.js");

        return {
          ...actual,
          listAssignedOpenRecords: vi.fn().mockResolvedValue({
            items: [
              {
                id: "record_overdue",
                title: "Hamza overdue file",
                text: "",
                html: "",
                createdAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-01T00:00:00.000Z",
                startedAt: null,
                duedAt: "2026-04-08T23:59:59.999Z",
                archived: false,
                done: false,
                commentCount: 0,
                todoList: {
                  id: "list_1",
                  title: "Leads",
                  position: 1,
                  updatedAt: "2026-04-01T00:00:00.000Z",
                },
              },
              {
                id: "record_today",
                title: "Hamza due today",
                text: "",
                html: "",
                createdAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-08T00:00:00.000Z",
                startedAt: null,
                duedAt: "2026-04-09T23:59:59.999Z",
                archived: false,
                done: false,
                commentCount: 0,
                todoList: {
                  id: "list_2",
                  title: "Underwriting",
                  position: 2,
                  updatedAt: "2026-04-08T00:00:00.000Z",
                },
              },
              {
                id: "record_stale",
                title: "Hamza stale file",
                text: "",
                html: "",
                createdAt: "2026-03-28T00:00:00.000Z",
                updatedAt: "2026-04-02T00:00:00.000Z",
                startedAt: null,
                duedAt: null,
                archived: false,
                done: false,
                commentCount: 0,
                todoList: {
                  id: "list_3",
                  title: "Docs",
                  position: 3,
                  updatedAt: "2026-04-02T00:00:00.000Z",
                },
              },
            ],
            pageInfo: {
              totalItems: 3,
              hasNextPage: false,
              hasPreviousPage: false,
              page: 1,
              perPage: 50,
            },
          }),
        };
      });

      const { ensureEmployee, initializeDatabase } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        message: "what needs follow up today",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "records.follow_up",
      });
      expect(response.responseText).toContain(
        "Follow-up queue for Hamza Paracha on 2026-04-09",
      );
      expect(response.responseText).toContain("Overdue: 1 | Due today: 1 | Stale: 1");
      expect(response.responseText).toContain(
        "Hamza overdue file (Leads) - overdue since 2026-04-08",
      );
      expect(response.responseText).toContain(
        "Hamza due today (Underwriting) - due today (2026-04-09)",
      );
      expect(response.responseText).toContain(
        "Hamza stale file (Docs) - stale, last updated 2026-04-02",
      );
    } finally {
      vi.useRealTimers();
      env.cleanup();
    }
  });

  it("returns checklist assignments for an admin asking about another employee", async () => {
    const env = createTestEnvironment();

    try {
      vi.doMock("../../src/modules/blue/graphql/client.js", async () => {
        const actual =
          await vi.importActual<
            typeof import("../../src/modules/blue/graphql/client.js")
          >("../../src/modules/blue/graphql/client.js");

        return {
          ...actual,
          listAssignedChecklistItems: vi.fn().mockResolvedValue({
            items: [
              {
                id: "assignment_1",
                uid: "assignment_uid_1",
                title: "Employment Letter, Paystubs",
                done: false,
                duedAt: "2026-04-11T23:59:59.999Z",
                updatedAt: "2026-04-09T10:00:00.000Z",
                users: [
                  {
                    id: "employee_2",
                    uid: "employee_2",
                    email: "sarah@ayafinancial.com",
                    firstName: "Sarah",
                    lastName: "Khan",
                    fullName: "Sarah Khan",
                    timezone: "America/Toronto",
                    updatedAt: "2026-04-01T00:00:00.000Z",
                  },
                ],
                checklist: {
                  id: "checklist_1",
                  title: "AYA Checklist V1",
                  todo: {
                    id: "record_1",
                    uid: "record_uid_1",
                    title: "Sarah Client",
                    todoList: {
                      id: "list_1",
                      uid: "list_uid_1",
                      title: "Underwriting",
                      position: 1,
                      updatedAt: "2026-04-01T00:00:00.000Z",
                    },
                  },
                },
              },
            ],
            pageInfo: {
              totalItems: 1,
              hasNextPage: false,
              hasPreviousPage: false,
              page: 1,
              perPage: 50,
            },
          }),
          listAssignedOpenRecords: vi.fn().mockResolvedValue({
            items: [],
            pageInfo: {
              totalItems: 0,
              hasNextPage: false,
              hasPreviousPage: false,
              page: 1,
              perPage: 50,
            },
          }),
        };
      });

      const { ensureEmployee, initializeDatabase } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "admin_1",
        displayName: "Admin User",
        email: "admin@ayafinancial.com",
        roleName: "admin",
      });
      await ensureEmployee({
        employeeId: "employee_2",
        displayName: "Sarah Khan",
        email: "sarah@ayafinancial.com",
        roleName: "admin",
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        message: "what assignments does Sarah have",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "assignments.report",
      });
      expect(response.responseText).toContain(
        "Sarah Khan has 1 open assignment in Blue.",
      );
      expect(response.responseText).toContain(
        "[Task] Employment Letter, Paystubs - open, due 2026-04-11 | Assigned: Sarah Khan | Sarah Client (Underwriting) | Checklist: AYA Checklist V1",
      );
    } finally {
      env.cleanup();
    }
  });

  it("runs LLM agent steps without exposing the internal trace", async () => {
    const env = createTestEnvironment({
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "true",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  goal: "Show Sarah's open assignments.",
                  confidence: 0.96,
                  requiresClarification: false,
                  steps: [
                    {
                      id: "step_1",
                      intent: "assignments.report",
                      parameters: {
                        employeeName: "Sarah",
                        assignmentStatus: "open",
                      },
                      purpose: "Read Sarah's open Blue assignments.",
                    },
                  ],
                  finalResponseInstructions:
                    "Answer like an operations assistant.",
                  matchedSignals: ["test-agent-plan"],
                }),
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  responseText:
                    "Sarah Khan has 1 open assignment: Employment Letter, Paystubs for Sarah Client.",
                }),
              },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    try {
      vi.doMock("../../src/modules/blue/graphql/client.js", async () => {
        const actual =
          await vi.importActual<
            typeof import("../../src/modules/blue/graphql/client.js")
          >("../../src/modules/blue/graphql/client.js");

        return {
          ...actual,
          listAssignedChecklistItems: vi.fn().mockResolvedValue({
            items: [
              {
                id: "assignment_1",
                uid: "assignment_uid_1",
                title: "Employment Letter, Paystubs",
                done: false,
                duedAt: "2026-04-11T23:59:59.999Z",
                updatedAt: "2026-04-09T10:00:00.000Z",
                users: [
                  {
                    id: "employee_2",
                    uid: "employee_2",
                    email: "sarah@ayafinancial.com",
                    firstName: "Sarah",
                    lastName: "Khan",
                    fullName: "Sarah Khan",
                    timezone: "America/Toronto",
                    updatedAt: "2026-04-01T00:00:00.000Z",
                  },
                ],
                checklist: {
                  id: "checklist_1",
                  title: "AYA Checklist V1",
                  todo: {
                    id: "record_1",
                    uid: "record_uid_1",
                    title: "Sarah Client",
                    todoList: {
                      id: "list_1",
                      uid: "list_uid_1",
                      title: "Underwriting",
                      position: 1,
                      updatedAt: "2026-04-01T00:00:00.000Z",
                    },
                  },
                },
              },
            ],
            pageInfo: {
              totalItems: 1,
              hasNextPage: false,
              hasPreviousPage: false,
              page: 1,
              perPage: 50,
            },
          }),
          listAssignedOpenRecords: vi.fn().mockResolvedValue({
            items: [],
            pageInfo: {
              totalItems: 0,
              hasNextPage: false,
              hasPreviousPage: false,
              page: 1,
              perPage: 50,
            },
          }),
        };
      });

      const { ensureEmployee, initializeDatabase } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "admin_1",
        displayName: "Admin User",
        email: "admin@ayafinancial.com",
        roleName: "admin",
      });
      await ensureEmployee({
        employeeId: "employee_2",
        displayName: "Sarah Khan",
        email: "sarah@ayafinancial.com",
        roleName: "admin",
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        message: "find Sarah's open assignments and summarize them",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "assignments.report",
      });
      expect(response.responseText).toBe(
        "Sarah Khan has 1 open assignment: Employment Letter, Paystubs for Sarah Client.",
      );
      expect(response.responseText).not.toContain("step_1");
      expect(response.responseText).not.toContain("assignments.report");
      expect(response.responseText).not.toContain("tool");
      expect(JSON.stringify(response.data)).not.toContain("step_1");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      env.cleanup();
    }
  });

  it("returns an admin activity report with exact comments, moves, and created leads", async () => {
    const env = createTestEnvironment();

    try {
      const {
        createId,
        ensureEmployee,
        initializeDatabase,
        insertBotAuditLog,
      } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "admin_1",
        displayName: "Admin User",
        email: "admin@example.com",
        roleName: "admin",
      });
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });

      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_1",
        transport: "web",
        inboundText: "add a note to this client: Docs requested from client",
        detectedIntent: "comments.create",
        adapter: "aya-service",
        commandName: "createComment",
        outcome: "success",
        responseText: "Added comment to Hamza Client.",
        responseJson: {
          data: {
            recordTitle: "Hamza Client",
            text: "Docs requested from client",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_1",
        transport: "web",
        inboundText: "move this to underwriting",
        detectedIntent: "records.move",
        adapter: "aya-service",
        commandName: "moveTodo",
        outcome: "success",
        responseText: "Moved Hamza Client to Underwriting.",
        responseJson: {
          data: {
            recordTitle: "Hamza Client",
            targetListTitle: "Underwriting",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_1",
        transport: "web",
        inboundText: "create a new lead named Aya QA Local",
        detectedIntent: "records.create",
        adapter: "aya-service",
        commandName: "createTodo",
        outcome: "success",
        responseText: "Created Aya QA Local in Leads.",
        responseJson: {
          data: {
            recordTitle: "Aya QA Local",
            listTitle: "Leads",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_1",
        transport: "web",
        inboundText: "show me Hamza",
        detectedIntent: "records.detail",
        adapter: "aya-service",
        commandName: "getBlueRecordDetail",
        outcome: "success",
        responseText: "Hamza Client is in Leads. Status: Active.",
        responseJson: {
          data: {
            recordTitle: "Hamza Client",
          },
        },
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        message: "show me everything Hamza did today",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "activity.employee_report",
      });
      expect(response.responseText).toContain("Hamza Paracha had 4 Aya interactions");
      expect(response.responseText).toContain(
        "Writes: 3 | Reads: 1 | Comments: 1 | Moves: 1 | Leads created: 1",
      );
      expect(response.responseText).toContain("Exact comments:");
      expect(response.responseText).toContain(
        "commented on Hamza Client: Docs requested from client",
      );
      expect(response.responseText).toContain("Client moves:");
      expect(response.responseText).toContain(
        "moved Hamza Client to Underwriting",
      );
      expect(response.responseText).toContain("Leads created:");
      expect(response.responseText).toContain("created Aya QA Local in Leads");
    } finally {
      env.cleanup();
    }
  });

  it("returns an admin workspace report with employee leaders and exact moves", async () => {
    const env = createTestEnvironment();

    try {
      const { ensureEmployee, initializeDatabase, insertBotAuditLog, createId } =
        await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "admin_1",
        displayName: "Admin User",
        email: "admin@ayafinancial.com",
        roleName: "admin",
      });
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await ensureEmployee({
        employeeId: "employee_2",
        displayName: "Sheraz Khan",
        email: "sheraz@ayafinancial.com",
        roleName: "employee",
      });

      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_1",
        transport: "web",
        inboundText: "move this to underwriting",
        detectedIntent: "records.move",
        adapter: "aya-service",
        commandName: "moveTodo",
        outcome: "success",
        responseText: "Moved Hamza Client to Underwriting.",
        responseJson: {
          data: {
            recordTitle: "Hamza Client",
            targetListTitle: "Underwriting",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_1",
        transport: "web",
        inboundText: "add note to this client: Docs requested",
        detectedIntent: "comments.create",
        adapter: "aya-service",
        commandName: "createComment",
        outcome: "success",
        responseText: "Added comment to Hamza Client.",
        responseJson: {
          data: {
            recordTitle: "Hamza Client",
            text: "Docs requested",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_2",
        transport: "web",
        inboundText: "move this to docs received",
        detectedIntent: "records.move",
        adapter: "aya-service",
        commandName: "moveTodo",
        outcome: "success",
        responseText: "Moved Sheraz Client to Docs Received.",
        responseJson: {
          data: {
            recordTitle: "Sheraz Client",
            targetListTitle: "Docs Received",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_2",
        transport: "web",
        inboundText: "create a new lead named Aya Workspace Test",
        detectedIntent: "records.create",
        adapter: "aya-service",
        commandName: "createTodo",
        outcome: "success",
        responseText: "Created Aya Workspace Test in Leads.",
        responseJson: {
          data: {
            recordTitle: "Aya Workspace Test",
            listTitle: "Leads",
          },
        },
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        message: "who moved clients today",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "activity.workspace_report",
      });
      expect(response.responseText).toContain("Workspace moves for");
      expect(response.responseText).toContain("Top movers:");
      expect(response.responseText).toContain("Hamza Paracha (1)");
      expect(response.responseText).toContain("Sheraz Khan (1)");
      expect(response.responseText).toContain("Exact client moves:");
      expect(response.responseText).toContain(
        "Hamza Paracha: moved Hamza Client to Underwriting",
      );
      expect(response.responseText).toContain(
        "Sheraz Khan: moved Sheraz Client to Docs Received",
      );
    } finally {
      env.cleanup();
    }
  });

  it("returns an admin exception report with missing fields by employee", async () => {
    const env = createTestEnvironment();

    try {
      const {
        ensureEmployee,
        initializeDatabase,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "admin_1",
        displayName: "Admin User",
        email: "admin@ayafinancial.com",
        roleName: "admin",
      });

      await upsertBlueRecordsCache({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        items: [
          {
            id: "record_sarah",
            title: "Sarah Exception File",
            normalizedTitle: "sarah exception file",
            listId: "list_leads_03",
            listTitle: "0.3 Leads (3rd FU)",
            dueAt: null,
            updatedAt: "2026-04-09T12:00:00.000Z",
            archived: false,
            done: false,
            rawJson: JSON.stringify({
              users: [{ fullName: "Sarah Khan", email: "sarah@ayafinancial.com" }],
              customFields: [
                { name: "First Name", value: "Sarah" },
                { name: "Last Name", value: "Client" },
                { name: "Email", value: "sarah.client@example.com" },
                { name: "Phone", value: "4165550199" },
                { name: "Finance Amount 1", value: "" },
              ],
            }),
          },
          {
            id: "record_rehan",
            title: "Rehan Underwriting File",
            normalizedTitle: "rehan underwriting file",
            listId: "list_underwriting",
            listTitle: "Underwriting",
            dueAt: "2026-04-12T23:59:59.999Z",
            updatedAt: "2026-04-09T12:30:00.000Z",
            archived: false,
            done: false,
            rawJson: JSON.stringify({
              users: [{ fullName: "Rehan S", email: "rehan@ayafinancial.com" }],
              customFields: [
                { name: "Contact Name", value: "Rehan Client" },
                { name: "Email", value: "rehan.client@example.com" },
                { name: "Phone", value: "6475550123" },
                { name: "Finance Amount 1", value: 450000 },
                { name: "Closing Date", value: "" },
              ],
            }),
          },
          {
            id: "record_unassigned",
            title: "Unassigned Lead File",
            normalizedTitle: "unassigned lead file",
            listId: "list_leads_02",
            listTitle: "0.2 Leads (2nd FU)",
            dueAt: "2026-04-11T23:59:59.999Z",
            updatedAt: "2026-04-09T13:00:00.000Z",
            archived: false,
            done: false,
            rawJson: JSON.stringify({
              users: [],
              customFields: [
                { name: "Contact Name", value: "Unassigned Client" },
                { name: "Email", value: "unassigned@example.com" },
                { name: "Phone", value: "" },
                { name: "Finance Amount 1", value: 275000 },
              ],
            }),
          },
        ],
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        message: "show me exception reports",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "records.exception_report",
      });
      expect(response.responseText).toContain(
        "Exception report: 3 active records with missing required fields.",
      );
      expect(response.responseText).toContain("Most common gaps:");
      expect(response.responseText).toContain("finance amount: 1");
      expect(response.responseText).toContain("due date: 1");
      expect(response.responseText).toContain("closing date: 1");
      expect(response.responseText).toContain("assigned employee: 1");
      expect(response.responseText).toContain(
        "Assigned employees with records that have missing required fields:",
      );
      expect(response.responseText).toContain("Sarah Khan: 1 record");
      expect(response.responseText).toContain("Rehan S: 1 record");
      expect(response.responseText).toContain("Unassigned: 1 record");
      expect(response.responseText).toContain(
        "Sarah Exception File (0.3 Leads (3rd FU)) | Assigned to: Sarah Khan | Missing: finance amount, due date",
      );
      expect(response.responseText).toContain(
        "Rehan Underwriting File (Underwriting) | Assigned to: Rehan S | Missing: closing date",
      );
      expect(response.responseText).toContain(
        "Unassigned Lead File (0.2 Leads (2nd FU)) | Assigned to: Unassigned | Missing: assigned employee, phone",
      );
    } finally {
      env.cleanup();
    }
  });

  it("returns an admin client activity report with exact people who touched the file", async () => {
    const env = createTestEnvironment();

    try {
      const {
        ensureEmployee,
        initializeDatabase,
        insertBotAuditLog,
        createId,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "admin_1",
        displayName: "Admin User",
        email: "admin@ayafinancial.com",
        roleName: "admin",
      });
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await ensureEmployee({
        employeeId: "employee_2",
        displayName: "Sheraz Khan",
        email: "sheraz@ayafinancial.com",
        roleName: "employee",
      });
      await upsertBlueRecordsCache({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        items: [
          {
            id: "record_hamza",
            title: "Hamza Client",
            normalizedTitle: "hamza client",
            listId: "list_leads",
            listTitle: "Leads",
            updatedAt: "2026-04-09T12:00:00.000Z",
            assigneeIdsJson: "[]",
            searchText: "Hamza Client",
          },
        ],
      });

      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_1",
        transport: "web",
        inboundText: "show me Hamza Client",
        detectedIntent: "records.detail",
        adapter: "aya-service",
        commandName: "getBlueRecordDetail",
        outcome: "success",
        responseText: "Hamza Client is in Leads.",
        responseJson: {
          data: {
            recordId: "record_hamza",
            recordTitle: "Hamza Client",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_2",
        transport: "web",
        inboundText: "add note to Hamza Client: sent docs",
        detectedIntent: "comments.create",
        adapter: "aya-service",
        commandName: "createComment",
        outcome: "success",
        responseText: "Added comment to Hamza Client.",
        responseJson: {
          data: {
            recordId: "record_hamza",
            recordTitle: "Hamza Client",
            text: "sent docs",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_2",
        transport: "web",
        inboundText: "move Hamza Client to Underwriting",
        detectedIntent: "records.move",
        adapter: "aya-service",
        commandName: "moveTodo",
        outcome: "success",
        responseText: "Moved Hamza Client to Underwriting.",
        responseJson: {
          data: {
            recordId: "record_hamza",
            recordTitle: "Hamza Client",
            targetListTitle: "Underwriting",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        employeeId: "employee_1",
        transport: "web",
        inboundText: "show me Another Client",
        detectedIntent: "records.detail",
        adapter: "aya-service",
        commandName: "getBlueRecordDetail",
        outcome: "success",
        responseText: "Another Client is in Leads.",
        responseJson: {
          data: {
            recordId: "record_other",
            recordTitle: "Another Client",
          },
        },
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        message: "who touched Hamza Client today",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "activity.record_report",
      });
      expect(response.responseText).toContain(
        "Activity on Hamza Client in today",
      );
      expect(response.responseText).toContain("Employees who touched this file:");
      expect(response.responseText).toContain("Sheraz Khan (2 total");
      expect(response.responseText).toContain("Hamza Paracha (1 total");
      expect(response.responseText).toContain(
        "Hamza Paracha: reviewed Hamza Client",
      );
      expect(response.responseText).toContain(
        "Sheraz Khan: commented on Hamza Client: sent docs",
      );
      expect(response.responseText).toContain(
        "Sheraz Khan: moved Hamza Client to Underwriting",
      );
      expect(response.responseText).not.toContain("Another Client");
    } finally {
      env.cleanup();
    }
  });

  it("returns an admin client timeline report for an explicit date range", async () => {
    const env = createTestEnvironment();

    try {
      const {
        ensureEmployee,
        initializeDatabase,
        insertBotAuditLog,
        createId,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "admin_1",
        displayName: "Admin User",
        email: "admin@ayafinancial.com",
        roleName: "admin",
      });
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await ensureEmployee({
        employeeId: "employee_2",
        displayName: "Sheraz Khan",
        email: "sheraz@ayafinancial.com",
        roleName: "employee",
      });
      await upsertBlueRecordsCache({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        items: [
          {
            id: "record_hamza",
            title: "Hamza Client",
            normalizedTitle: "hamza client",
            listId: "list_leads",
            listTitle: "Leads",
            updatedAt: "2026-04-09T12:00:00.000Z",
            assigneeIdsJson: "[]",
            searchText: "Hamza Client",
          },
        ],
      });

      await insertBotAuditLog({
        id: createId("audit"),
        createdAt: "2026-04-07T09:10:00.000Z",
        employeeId: "employee_1",
        transport: "web",
        inboundText: "show me Hamza Client",
        detectedIntent: "records.detail",
        adapter: "aya-service",
        commandName: "getBlueRecordDetail",
        outcome: "success",
        responseText: "Hamza Client is in Leads.",
        responseJson: {
          data: {
            recordId: "record_hamza",
            recordTitle: "Hamza Client",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        createdAt: "2026-04-08T14:15:00.000Z",
        employeeId: "employee_2",
        transport: "web",
        inboundText: "add note to Hamza Client: sent docs",
        detectedIntent: "comments.create",
        adapter: "aya-service",
        commandName: "createComment",
        outcome: "success",
        responseText: "Added comment to Hamza Client.",
        responseJson: {
          data: {
            recordId: "record_hamza",
            recordTitle: "Hamza Client",
            text: "sent docs",
          },
        },
      });
      await insertBotAuditLog({
        id: createId("audit"),
        createdAt: "2026-04-09T16:45:00.000Z",
        employeeId: "employee_1",
        transport: "web",
        inboundText: "move Hamza Client to Underwriting",
        detectedIntent: "records.move",
        adapter: "aya-service",
        commandName: "moveTodo",
        outcome: "success",
        responseText: "Moved Hamza Client to Underwriting.",
        responseJson: {
          data: {
            recordId: "record_hamza",
            recordTitle: "Hamza Client",
            targetListTitle: "Underwriting",
          },
        },
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        message:
          "show me the timeline for Hamza Client from 2026-04-08 to 2026-04-09",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "activity.record_report",
      });
      expect(response.responseText).toContain(
        "Activity on Hamza Client in 2026-04-08 to 2026-04-09: 2 successful interactions.",
      );
      expect(response.responseText).toContain("Timeline:");
      expect(response.responseText).toContain(
        "2026-04-09 16:45 Hamza Paracha: moved Hamza Client to Underwriting",
      );
      expect(response.responseText).toContain(
        "2026-04-08 14:15 Sheraz Khan: commented on Hamza Client: sent docs",
      );
      expect(response.responseText).not.toContain("2026-04-07 09:10");
    } finally {
      env.cleanup();
    }
  });

  it("moves the active client context through the shared execution service", async () => {
    const env = createTestEnvironment({
      ALLOW_SYSTEM_BLUE_WRITE_FALLBACK: "true",
    });

    try {
      vi.doMock("../../src/modules/blue/graphql/client.js", async () => {
        const actual =
          await vi.importActual<
            typeof import("../../src/modules/blue/graphql/client.js")
          >("../../src/modules/blue/graphql/client.js");

        return {
          ...actual,
          fetchRecordDetail: vi.fn().mockResolvedValue({
            record: {
              id: "record_1",
              title: "Hamza Client",
              archived: false,
              done: false,
              text: "",
              startedAt: null,
              duedAt: null,
              commentCount: 0,
              createdAt: "2026-04-01T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              customFields: [],
              users: [],
              tags: [],
              todoList: {
                id: "list_leads",
                title: "Leads",
                position: 1,
                updatedAt: "2026-04-02T00:00:00.000Z",
              },
            },
            comments: [],
          }),
          moveRecord: vi.fn().mockResolvedValue({ ok: true }),
        };
      });

      vi.doMock("../../src/blue/workspace-index.js", async () => {
        const actual =
          await vi.importActual<typeof import("../../src/blue/workspace-index.js")>(
            "../../src/blue/workspace-index.js",
          );

        return {
          ...actual,
          syncWorkspaceIndex: vi.fn().mockResolvedValue({
            workspaceId: "cmn524yr800e101mh7kn44mhf",
            mode: "incremental",
            listsSynced: 1,
            recordsSynced: 1,
            lastSeenUpdatedAt: "2026-04-02T00:00:00.000Z",
          }),
        };
      });
      const {
        ensureEmployee,
        initializeDatabase,
        upsertBlueListsCache,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await upsertBlueListsCache({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        items: [
          {
            id: "list_leads",
            title: "Leads",
            normalizedTitle: "leads",
            position: 1,
          },
          {
            id: "list_underwriting",
            title: "Underwriting",
            normalizedTitle: "underwriting",
            position: 2,
          },
        ],
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

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      await handleInboundMessage({
        actorEmployeeId: "employee_1",
        message: "show me Hamza",
      });

      const moveResponse = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        message: "move this to underwriting",
      });

      expect(moveResponse).toMatchObject({
        matched: true,
        intent: "records.move",
      });
      expect(moveResponse.responseText).toBe(
        "Moved Hamza Client to Underwriting.",
      );
    } finally {
      env.cleanup();
    }
  });
});
