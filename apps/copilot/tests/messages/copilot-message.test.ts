import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../helpers/test-env.js";

const BLUE_AUTH_REQUIRED_MESSAGE =
  "Connect your Blue account before using Aya with CRM data. Open the Aya MCP server settings and enter both your Blue Token ID and Blue Token Secret, then try again.";
const HAMZA_BLUE_AUTH = {
  actorBlueTokenId: "00000000000000000000000000000001",
  actorBlueTokenSecret: "test-blue-secret-hamza",
};
const ADMIN_BLUE_AUTH = {
  actorBlueTokenId: "00000000000000000000000000000002",
  actorBlueTokenSecret: "test-blue-secret-admin",
};

function installDefaultBlueFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = parseJsonBody(init?.body);
      const query = typeof body.query === "string" ? body.query : "";

      if (query.includes("AyaValidateBlueCredentials")) {
        return jsonResponse({
          data: {
            currentUser: blueUserForToken(getHeader(init?.headers, "x-bloo-token-id")),
          },
        });
      }

      if (query.includes("WorkspaceLists")) {
        return jsonResponse({
          data: {
            todoLists: [
              {
                id: "list_leads",
                uid: "list_leads_uid",
                title: "Leads",
                position: 1,
                createdAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-02T00:00:00.000Z",
                todosCount: 1,
              },
              {
                id: "list_underwriting",
                uid: "list_underwriting_uid",
                title: "Underwriting",
                position: 2,
                createdAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-02T00:00:00.000Z",
                todosCount: 1,
              },
            ],
          },
        });
      }

      if (query.includes("WorkspaceListRecords")) {
        return jsonResponse({
          data: {
            todoList: {
              id: body.variables?.listId ?? "list_leads",
              title:
                body.variables?.listId === "list_underwriting"
                  ? "Underwriting"
                  : "Leads",
              todos:
                body.variables?.listId === "list_underwriting"
                  ? []
                  : [
                      {
                        id: "record_1",
                        uid: "record_1_uid",
                        title: "Hamza Client",
                        text: "",
                        html: "",
                        startedAt: null,
                        duedAt: null,
                        commentCount: 0,
                        archived: false,
                        done: false,
                        createdAt: "2026-04-01T00:00:00.000Z",
                        updatedAt: "2026-04-02T00:00:00.000Z",
                        users: [],
                        tags: [],
                        customFields: [],
                        todoList: {
                          id: "list_leads",
                          uid: "list_leads_uid",
                          title: "Leads",
                          position: 1,
                          updatedAt: "2026-04-02T00:00:00.000Z",
                        },
                      },
                    ],
            },
          },
        });
      }

      return jsonResponse({ data: {} });
    }),
  );
}

function blueUserForToken(tokenId: string | null) {
  const baseRole = {
    id: "role_1",
    name: "Member",
    isRecordsEnabled: true,
  };
  if (tokenId === ADMIN_BLUE_AUTH.actorBlueTokenId) {
    return {
      id: "admin_1",
      uid: "admin_1",
      email: "admin@ayafinancial.com",
      fullName: "Admin User",
      projectUserRole: baseRole,
    };
  }

  return {
    id: "employee_1",
    uid: "employee_1",
    email: "hamza@ayafinancial.com",
    fullName: "Hamza Paracha",
    projectUserRole: baseRole,
  };
}

function parseJsonBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") {
    return {} as { query?: unknown; variables?: Record<string, unknown> };
  }

  try {
    return JSON.parse(body) as {
      query?: unknown;
      variables?: Record<string, unknown>;
    };
  } catch {
    return {} as { query?: unknown; variables?: Record<string, unknown> };
  }
}

function getHeader(headers: HeadersInit | undefined, name: string) {
  if (!headers) {
    return null;
  }
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry?.[1] ?? null;
  }

  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe("Aya copilot message flow", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    installDefaultBlueFetchMock();
  });

  it("uses the AI SDK agent tools for write intents and returns credential guidance", async () => {
    const env = createTestEnvironment({
      AYA_CHAT_RUNTIME: "agent",
      OPENAI_API_KEY: "test-openai-key",
    });

    try {
      vi.doMock("ai", async () => {
        const actual = await vi.importActual<typeof import("ai")>("ai");

        return {
          ...actual,
          generateText: vi.fn(
            async (options: {
              tools: Record<
                string,
                { execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }
              >;
            }) => {
              const toolOutput = await options.tools.addClientComment.execute({
                recordQuery: "AYA SMOKE TEST",
                text: "QA local retest write check 2026-05-14",
              });

              return {
                text:
                  typeof toolOutput.errorMessage === "string"
                    ? toolOutput.errorMessage
                    : String(toolOutput.responseText ?? ""),
                totalUsage: {
                  inputTokens: 10,
                  outputTokens: 6,
                  totalTokens: 16,
                },
              };
            },
          ),
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
        message:
          "add a note to AYA SMOKE TEST saying QA local retest write check 2026-05-14",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "comments.create",
      });
      expect(response.responseText).toContain(BLUE_AUTH_REQUIRED_MESSAGE);
    } finally {
      vi.doUnmock("ai");
      env.cleanup();
    }
  });

  it("returns a trusted tool result when final AI wording times out", async () => {
    const env = createTestEnvironment({
      AYA_CHAT_RUNTIME: "agent",
      OPENAI_API_KEY: "test-openai-key",
    });

    try {
      vi.doMock("ai", async () => {
        const actual = await vi.importActual<typeof import("ai")>("ai");

        return {
          ...actual,
          generateText: vi.fn(
            async (options: {
              tools: Record<
                string,
                { execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }
              >;
            }) => {
              await options.tools.getSignedInUser.execute({});
              const error = new Error("The operation was aborted due to timeout");
              error.name = "TimeoutError";
              throw error;
            },
          ),
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
        message: "who am I signed in as?",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "identity.self",
      });
      expect(response.responseText).toContain(
        "You are signed in as Hamza Paracha.",
      );
    } finally {
      vi.doUnmock("ai");
      env.cleanup();
    }
  });

  it("falls back to the planner when the AI SDK agent does not call a tool", async () => {
    const env = createTestEnvironment({
      AYA_CHAT_RUNTIME: "agent_with_planner_fallback",
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "false",
    });

    try {
      vi.doMock("ai", async () => {
        const actual = await vi.importActual<typeof import("ai")>("ai");

        return {
          ...actual,
          generateText: vi.fn(async () => ({
            text: "I need more details.",
            totalUsage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
            },
          })),
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
        message: "who am I signed in as?",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "identity.self",
      });
      expect(response.responseText).toContain(
        "You are signed in as Hamza Paracha.",
      );
    } finally {
      vi.doUnmock("ai");
      env.cleanup();
    }
  });

  it("does not fall back when the agent responds directly", async () => {
    const env = createTestEnvironment({
      AYA_CHAT_RUNTIME: "agent_with_planner_fallback",
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "false",
    });

    try {
      vi.doMock("ai", async () => {
        const actual = await vi.importActual<typeof import("ai")>("ai");

        return {
          ...actual,
          generateText: vi.fn(
            async (options: {
              tools: Record<
                string,
                { execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }
              >;
            }) => {
              const toolOutput = await options.tools.respondDirectly.execute({
                responseText: "You do not have permission to do that.",
              });

              return {
                text: String(toolOutput.responseText ?? ""),
                totalUsage: {
                  inputTokens: 10,
                  outputTokens: 5,
                  totalTokens: 15,
                },
              };
            },
          ),
        };
      });

      const { ensureEmployee, initializeDatabase } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Rehan AYA",
        email: null,
        roleName: "employee",
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );
      const { listBotAuditLogsForDay } = await import("../../src/db.js");

      const marker = `local direct response ${Date.now()}`;
      const response = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        message: `show the full team day summary report for all employees today ${marker}`,
      });

      expect(response).toMatchObject({
        matched: true,
      });
      expect(response.intent).toBeUndefined();
      expect(response.responseText).toBe("You do not have permission to do that.");

      const auditRows = await listBotAuditLogsForDay({
        dateIso: new Date().toISOString().slice(0, 10),
      });
      const matchingRows = auditRows.filter((row) =>
        row.inbound_text.includes(marker),
      );

      expect(matchingRows).toHaveLength(1);
      expect(matchingRows[0]).toMatchObject({
        adapter: "ai-sdk-agent",
        outcome: "success",
      });
    } finally {
      vi.doUnmock("ai");
      env.cleanup();
    }
  });

  it("returns deterministic permission text when an agent tool is denied", async () => {
    const env = createTestEnvironment({
      AYA_CHAT_RUNTIME: "agent_with_planner_fallback",
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "false",
    });

    try {
      vi.doMock("ai", async () => {
        const actual = await vi.importActual<typeof import("ai")>("ai");

        return {
          ...actual,
          generateText: vi.fn(
            async (options: {
              tools: Record<
                string,
                { execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }
              >;
            }) => {
              await options.tools.getTeamDaySummary.execute({});

              return {
                text: "I'm unable to access the team's activity summary for today.",
                totalUsage: {
                  inputTokens: 10,
                  outputTokens: 8,
                  totalTokens: 18,
                },
              };
            },
          ),
        };
      });

      const { ensureEmployee, initializeDatabase } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Rehan AYA",
        email: null,
        roleName: "employee",
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );
      const { listBotAuditLogsForDay } = await import("../../src/db.js");

      const marker = `local denied agent tool ${Date.now()}`;
      const response = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        message: `what did the team do today ${marker}`,
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "summary.team_day",
        responseText: "You do not have permission to do that.",
      });

      const auditRows = await listBotAuditLogsForDay({
        dateIso: new Date().toISOString().slice(0, 10),
      });
      const matchingRows = auditRows.filter((row) =>
        row.inbound_text.includes(marker),
      );

      expect(matchingRows).toHaveLength(1);
      expect(matchingRows[0]).toMatchObject({
        adapter: "ai-sdk-agent",
        outcome: "error",
        detected_intent: "summary.team_day",
      });
    } finally {
      vi.doUnmock("ai");
      env.cleanup();
    }
  });

  it("does not let planner fallback bypass the Blue credential gate", async () => {
    const env = createTestEnvironment({
      AYA_CHAT_RUNTIME: "agent_with_planner_fallback",
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "false",
    });

    try {
      vi.doMock("ai", async () => {
        const actual = await vi.importActual<typeof import("ai")>("ai");

        return {
          ...actual,
          generateText: vi.fn(async () => ({
            text: "I need more details.",
            totalUsage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
            },
          })),
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
        message: "show me Hamza Client",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "records.detail",
      });
      expect(response.responseText).toContain(BLUE_AUTH_REQUIRED_MESSAGE);
    } finally {
      vi.doUnmock("ai");
      env.cleanup();
    }
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
        ...HAMZA_BLUE_AUTH,
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
        ...HAMZA_BLUE_AUTH,
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
        ...HAMZA_BLUE_AUTH,
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
        ...HAMZA_BLUE_AUTH,
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
        ...HAMZA_BLUE_AUTH,
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
        ...ADMIN_BLUE_AUTH,
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
      AYA_CHAT_RUNTIME: "planner",
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "true",
    });
    const openAiFetchMock = vi
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
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = parseJsonBody(init?.body);
      if (typeof body.query === "string" && body.query.includes("AyaValidateBlueCredentials")) {
        return jsonResponse({
          data: {
            currentUser: blueUserForToken(getHeader(init?.headers, "x-bloo-token-id")),
          },
        });
      }

      return openAiFetchMock(url, init);
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
        ...ADMIN_BLUE_AUTH,
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
      expect(openAiFetchMock).toHaveBeenCalledTimes(2);
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
        ...ADMIN_BLUE_AUTH,
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
        ...ADMIN_BLUE_AUTH,
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
        ...ADMIN_BLUE_AUTH,
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

  it("does not include records with structured phone or email values in missing-contact reports", async () => {
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
            id: "record_structured_contact",
            title: "Structured Contact File",
            normalizedTitle: "structured contact file",
            listId: "list_leads",
            listTitle: "0.3 Leads (3rd FU)",
            dueAt: "2026-04-12T23:59:59.999Z",
            updatedAt: "2026-04-09T12:00:00.000Z",
            archived: false,
            done: false,
            rawJson: JSON.stringify({
              users: [{ fullName: "Sarah Khan", email: "sarah@ayafinancial.com" }],
              customFields: [
                { name: "Contact Name", value: { text: "Structured Client" } },
                { name: "Email", value: { email: "structured@example.com" } },
                { name: "Phone", value: { phone: "+1 (416) 555-0100" } },
                { name: "Finance Amount 1", value: { number: 325000 } },
              ],
            }),
          },
          {
            id: "record_missing_phone",
            title: "Missing Phone File",
            normalizedTitle: "missing phone file",
            listId: "list_leads",
            listTitle: "0.3 Leads (3rd FU)",
            dueAt: "2026-04-12T23:59:59.999Z",
            updatedAt: "2026-04-09T12:30:00.000Z",
            archived: false,
            done: false,
            rawJson: JSON.stringify({
              users: [{ fullName: "Rehan S", email: "rehan@ayafinancial.com" }],
              customFields: [
                { name: "Contact Name", value: "Phone Missing Client" },
                { name: "Email", value: "phone.missing@example.com" },
                { name: "Phone", value: "" },
                { name: "Finance Amount 1", value: 400000 },
              ],
            }),
          },
          {
            id: "record_missing_email",
            title: "Missing Email File",
            normalizedTitle: "missing email file",
            listId: "list_leads",
            listTitle: "0.3 Leads (3rd FU)",
            dueAt: "2026-04-12T23:59:59.999Z",
            updatedAt: "2026-04-09T13:00:00.000Z",
            archived: false,
            done: false,
            rawJson: JSON.stringify({
              users: [{ fullName: "Hamza Paracha", email: "hamza@ayafinancial.com" }],
              customFields: [
                { name: "Contact Name", value: "Email Missing Client" },
                { name: "Email", value: "" },
                { name: "Phone", value: "+1 647 555 0101" },
                { name: "Finance Amount 1", value: 410000 },
              ],
            }),
          },
          {
            id: "record_visible_phone",
            title: "Visible Phone File",
            normalizedTitle: "visible phone file",
            listId: "list_leads",
            listTitle: "0.3 Leads (3rd FU)",
            dueAt: "2026-04-12T23:59:59.999Z",
            updatedAt: "2026-04-09T13:30:00.000Z",
            archived: false,
            done: false,
            rawJson: JSON.stringify({
              text: "Client phone is 905-869-3458.",
              users: [{ fullName: "Sarah Khan", email: "sarah@ayafinancial.com" }],
              customFields: [
                { name: "Contact Name", value: "Visible Phone Client" },
                { name: "Email", value: "visible.phone@example.com" },
                { name: "Phone", value: "" },
                { name: "Finance Amount 1", value: 420000 },
              ],
            }),
          },
          {
            id: "record_visible_email",
            title: "Visible Email File",
            normalizedTitle: "visible email file",
            listId: "list_leads",
            listTitle: "0.3 Leads (3rd FU)",
            dueAt: "2026-04-12T23:59:59.999Z",
            updatedAt: "2026-04-09T14:00:00.000Z",
            archived: false,
            done: false,
            rawJson: JSON.stringify({
              text: "Client email is khalilPhysio@gmail.com.",
              users: [{ fullName: "Hamza Paracha", email: "hamza@ayafinancial.com" }],
              customFields: [
                { name: "Contact Name", value: "Visible Email Client" },
                { name: "Email", value: "" },
                { name: "Phone", value: "+1 647 555 0102" },
                { name: "Finance Amount 1", value: 430000 },
              ],
            }),
          },
        ],
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const phoneResponse = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        ...ADMIN_BLUE_AUTH,
        message: "which records are missing phone?",
      });
      expect(phoneResponse).toMatchObject({
        matched: true,
        intent: "records.exception_report",
      });
      expect(phoneResponse.responseText).toContain("Records missing phone: 1.");
      expect(phoneResponse.responseText).toContain("Missing Phone File");
      expect(phoneResponse.responseText).not.toContain("Structured Contact File");
      expect(phoneResponse.responseText).not.toContain("Visible Phone File");

      const emailResponse = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        ...ADMIN_BLUE_AUTH,
        message: "which records are missing email?",
      });
      expect(emailResponse).toMatchObject({
        matched: true,
        intent: "records.exception_report",
      });
      expect(emailResponse.responseText).toContain("Records missing email: 1.");
      expect(emailResponse.responseText).toContain("Missing Email File");
      expect(emailResponse.responseText).not.toContain("Structured Contact File");
      expect(emailResponse.responseText).not.toContain("Visible Email File");
    } finally {
      env.cleanup();
    }
  });

  it("denies employees reading another employee's notifications", async () => {
    const env = createTestEnvironment();

    try {
      const { ensureEmployee, initializeDatabase } = await import("../../src/db.js");

      await initializeDatabase();
      await ensureEmployee({
        employeeId: "employee_1",
        displayName: "Hamza Paracha",
        email: "hamza@ayafinancial.com",
        roleName: "employee",
      });
      await ensureEmployee({
        employeeId: "employee_2",
        displayName: "Rehan S",
        email: "rehan@ayafinancial.com",
        roleName: "employee",
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        ...HAMZA_BLUE_AUTH,
        message: "show Rehan's notifications",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "notifications.feed",
        responseText: "You do not have permission to do that.",
      });
    } finally {
      env.cleanup();
    }
  });

  it("counts agent-audited comments in workspace comment reporting", async () => {
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
        email: "admin@ayafinancial.com",
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
        inboundText: "add note to AYA SMOKE TEST: smoke note",
        detectedIntent: "comments.create",
        adapter: "aya-agent",
        commandName: "agent.execute",
        outcome: "success",
        responseText: "Added comment to AYA SMOKE TEST.",
        responseJson: {
          steps: [
            {
              stepId: "step_1",
              intent: "comments.create",
              outcome: "success",
              data: {
                recordId: "record_smoke",
                recordTitle: "AYA SMOKE TEST",
                text: "smoke note",
              },
            },
          ],
        },
      });

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      const response = await handleInboundMessage({
        actorEmployeeId: "admin_1",
        ...ADMIN_BLUE_AUTH,
        message: "who commented today?",
      });

      expect(response).toMatchObject({
        matched: true,
        intent: "activity.workspace_report",
      });
      expect(response.responseText).toContain("Workspace comments for");
      expect(response.responseText).toContain("Hamza Paracha (1)");
      expect(response.responseText).toContain(
        "Hamza Paracha: commented on AYA SMOKE TEST: smoke note",
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
        ...ADMIN_BLUE_AUTH,
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
        ...ADMIN_BLUE_AUTH,
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
        ...HAMZA_BLUE_AUTH,
        message: "show me Hamza",
      });

      const moveResponse = await handleInboundMessage({
        actorEmployeeId: "employee_1",
        ...HAMZA_BLUE_AUTH,
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

  it("refuses broad destructive bulk actions before planning execution", async () => {
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

      const { handleInboundMessage } = await import(
        "../../src/messages/handle-message.js"
      );

      for (const message of [
        "move every record to Done",
        "delete all records",
        "mark all clients complete",
        "move all leads to Done",
        "assign every file to Hamza",
        "close all records",
      ]) {
        const response = await handleInboundMessage({
          actorEmployeeId: "employee_1",
          message,
        });

        expect(response).toMatchObject({
          matched: true,
          responseText:
            "I cannot perform bulk destructive actions like moving, deleting, completing, assigning, or updating every record at once. Pick one specific client/file or a clearly bounded QA record in the allowed workspace.",
        });
      }
    } finally {
      env.cleanup();
    }
  });

  it("refuses direct write-action bulk moves before checking Blue write credentials", async () => {
    const env = createTestEnvironment();

    try {
      const { moveClientToStage } = await import(
        "../../src/modules/copilot/actions.js"
      );

      await expect(
        moveClientToStage({
          recordQuery: "every record",
          targetListQuery: "Done",
        }),
      ).rejects.toThrow(
        "I cannot perform bulk destructive actions like moving, deleting, completing, assigning, or updating every record at once.",
      );
    } finally {
      env.cleanup();
    }
  });
});
