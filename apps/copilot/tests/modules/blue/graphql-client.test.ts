import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

import { createTestEnvironment } from "../../helpers/test-env.js";

const requests: Array<{
  query: string;
  variables: Record<string, unknown>;
  headers: {
    tokenId: string | null;
    tokenSecret: string | null;
    companyId: string | null;
    projectId: string | null;
  };
}> = [];
const server = setupServer(
  http.post("https://blue.test/graphql", async ({ request }) => {
    const body = (await request.json()) as {
      query: string;
      variables: Record<string, unknown>;
    };
    requests.push({
      ...body,
      headers: {
        tokenId: request.headers.get("x-bloo-token-id"),
        tokenSecret: request.headers.get("x-bloo-token-secret"),
        companyId: request.headers.get("x-bloo-company-id"),
        projectId: request.headers.get("x-bloo-project-id"),
      },
    });

    if (body.query.includes("mutation MoveTodo")) {
      return HttpResponse.json({ data: { moveTodo: true } });
    }

    if (body.query.includes("mutation CreateComment")) {
      return HttpResponse.json({
        data: {
          createComment: {
            id: "comment_1",
            uid: "comment_uid_1",
            text: body.variables.input && (body.variables.input as { text: string }).text,
          html: "<p>Hello</p>",
            createdAt: "2026-03-25T00:00:00.000Z",
            updatedAt: "2026-03-25T00:00:00.000Z",
            deletedAt: null,
            user: null,
          },
        },
      });
    }

    if (body.query.includes("query WorkspaceUsers")) {
      return HttpResponse.json({
        data: {
          projectUserList: {
            users: [
              {
                id: "emp_sarah",
                uid: "emp_uid_sarah",
                email: "sarah.khan@ayafinancial.com",
                firstName: "Sarah",
                lastName: "Khan",
                fullName: "Sarah Khan",
                timezone: "America/Toronto",
                updatedAt: "2026-03-25T00:00:00.000Z",
              },
            ],
            totalCount: 1,
            pageInfo: {
              hasNextPage: false,
            },
          },
        },
      });
    }

    if (body.query.includes("query CompanyUsers")) {
      return HttpResponse.json({
        data: {
          companyUserList: {
            users: [
              {
                id: "emp_sarah",
                uid: "emp_uid_sarah",
                email: "sarah.khan@ayafinancial.com",
                firstName: "Sarah",
                lastName: "Khan",
                fullName: "Sarah Khan",
                timezone: "America/Toronto",
                updatedAt: "2026-03-25T00:00:00.000Z",
              },
            ],
            totalCount: 1,
            pageInfo: {
              hasNextPage: false,
            },
          },
        },
      });
    }

    if (body.query.includes("query AssignedOpenRecords")) {
      return HttpResponse.json({
        data: {
          todoQueries: {
            todos: {
              items: [
                {
                  id: "todo_1",
                  uid: "todo_uid_1",
                  title: "Follow up with Sheraz",
                  text: "",
                  html: "",
                  startedAt: null,
                  duedAt: "2026-03-26T00:00:00.000Z",
                  commentCount: 0,
                  archived: false,
                  done: false,
                  createdAt: "2026-03-25T00:00:00.000Z",
                  updatedAt: "2026-03-25T00:00:00.000Z",
                  users: [],
                  tags: [],
                  customFields: [],
                  todoList: {
                    id: "list_1",
                    uid: "list_uid_1",
                    title: "Leads",
                    position: 1,
                    updatedAt: "2026-03-25T00:00:00.000Z",
                  },
                },
              ],
              pageInfo: {
                totalItems: 101,
                hasNextPage: true,
                hasPreviousPage: false,
                page: 1,
                perPage: 50,
              },
            },
          },
        },
      });
    }

    if (body.query.includes("query AssignedChecklistItems")) {
      return HttpResponse.json({
        data: {
          checklistItems: {
            items: [
              {
                id: "checklist_item_1",
                uid: "checklist_item_uid_1",
                title: "Employment Letter",
                done: false,
                duedAt: "2026-03-26T00:00:00.000Z",
                updatedAt: "2026-03-25T00:00:00.000Z",
                users: [
                  {
                    id: "user_1",
                    uid: "user_uid_1",
                    email: "sarah@ayafinancial.com",
                    firstName: "Sarah",
                    lastName: "Khan",
                    fullName: "Sarah Khan",
                    timezone: "America/Toronto",
                    updatedAt: "2026-03-25T00:00:00.000Z",
                  },
                ],
                checklist: {
                  id: "checklist_1",
                  title: "AYA Checklist V1",
                  todo: {
                    id: "todo_1",
                    uid: "todo_uid_1",
                    title: "Sheraz File",
                    todoList: {
                      id: "list_1",
                      uid: "list_uid_1",
                      title: "Underwriting",
                      position: 1,
                      updatedAt: "2026-03-25T00:00:00.000Z",
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
          },
        },
      });
    }

    if (body.query.includes("query RecordDetail")) {
      return HttpResponse.json({
        data: {
          todo: {
            id: "todo_1",
            uid: "todo_uid_1",
            title: "Fatima Hammou",
            text: "",
            html: "",
            startedAt: null,
            duedAt: null,
            commentCount: 1,
            archived: false,
            done: false,
            createdAt: "2026-03-25T00:00:00.000Z",
            updatedAt: "2026-03-26T00:00:00.000Z",
            users: [],
            tags: [],
            customFields: [],
            todoList: {
              id: "list_1",
              uid: "list_uid_1",
              title: "Leads",
              updatedAt: "2026-03-25T00:00:00.000Z",
            },
            checklists: [],
          },
          commentList: {
            comments: [
              {
                id: "comment_1",
                uid: "comment_uid_1",
                text: "Latest update",
                html: "<p>Latest update</p>",
                createdAt: "2026-03-25T00:00:00.000Z",
                updatedAt: "2026-03-25T00:00:00.000Z",
                deletedAt: null,
                user: null,
              },
            ],
          },
        },
      });
    }

    if (body.query.includes("query ReportingCapability")) {
      return HttpResponse.json({
        data: {
          company: {
            id: "test-company",
            name: "Test Company",
            slug: "test-company",
            subscriptionStatus: "active",
            subscriptionActive: true,
            subscriptionTrialing: false,
            isEnterprise: true,
            subscriptionPlan: {
              planId: "enterprise",
              planName: "Enterprise",
              status: "active",
              isPaid: true,
              currentPeriodEnd: "2026-12-31T00:00:00.000Z",
              trialEnd: null,
            },
          },
        },
      });
    }

    if (body.query.includes("query ReportingDashboards")) {
      return HttpResponse.json({
        data: {
          dashboards: {
            items: [
              {
                id: "dashboard_1",
                title: "Revenue Dashboard",
                createdAt: "2026-03-25T00:00:00.000Z",
                updatedAt: "2026-03-26T00:00:00.000Z",
                createdBy: {
                  id: "user_1",
                  email: "owner@example.com",
                  fullName: "Owner",
                },
                dashboardUsers: [],
              },
            ],
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              startCursor: null,
              endCursor: null,
            },
          },
        },
      });
    }

    if (body.query.includes("query ReportingReportById")) {
      const reportId = String(body.variables.id ?? "report_fallback");
      return HttpResponse.json({
        data: {
          report: {
            id: reportId,
            title: reportId.endsWith("_1")
              ? "AYA x Hamza Workspace Overview"
              : "AYA x Hamza Employee Workload Tracker",
            description: "Fallback report",
            createdAt: "2026-03-25T00:00:00.000Z",
            updatedAt: "2026-03-26T00:00:00.000Z",
            lastGeneratedAt: "2026-03-27T00:00:00.000Z",
            projectIds: ["cmn524yr800e101mh7kn44mhf"],
            createdBy: {
              id: "user_1",
              email: "owner@example.com",
              fullName: "Owner",
            },
            reportUsers: [],
            dataSources: [
              {
                id: "source_fallback_1",
                name: "Leads",
                sourceType: "TODOS",
                projectIds: ["cmn524yr800e101mh7kn44mhf"],
                order: 1,
              },
            ],
          },
        },
      });
    }

    if (body.query.includes("query ReportingReports")) {
      return HttpResponse.json({
        data: {
          reports: {
            items: [
              {
                id: "report_1",
                title: "Weekly Funnel",
                description: "Tracks weekly conversion flow",
                createdAt: "2026-03-25T00:00:00.000Z",
                updatedAt: "2026-03-26T00:00:00.000Z",
                lastGeneratedAt: "2026-03-27T00:00:00.000Z",
                createdBy: {
                  id: "user_1",
                  email: "owner@example.com",
                  fullName: "Owner",
                },
                reportUsers: [],
                dataSources: [
                  {
                    id: "source_1",
                    name: "Leads",
                    sourceType: "TODOS",
                    projectIds: ["cmn524yr800e101mh7kn44mhf"],
                    order: 1,
                  },
                ],
              },
            ],
            totalCount: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      });
    }

    return HttpResponse.json({ data: {} });
  }),
);

describe("blue graphql client mutations and workload query", () => {
  beforeAll(() => server.listen());
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    server.resetHandlers();
    requests.length = 0;
  });
  afterAll(() => server.close());

  it("moves a record through moveTodo", async () => {
    const env = createTestEnvironment();
    try {
      const { moveRecord } = await import("../../../src/modules/blue/graphql/client.js");
      const result = await moveRecord({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        recordId: "todo_123",
        targetListId: "list_456",
      });

      expect(result).toEqual({ ok: true });
      expect(requests[0]?.variables).toEqual({
        input: {
          todoId: "todo_123",
          todoListId: "list_456",
        },
      });
      expect(requests[0]?.headers).toEqual({
        tokenId: "test-client",
        tokenSecret: "test-secret",
        companyId: "test-company",
        projectId: "cmn524yr800e101mh7kn44mhf",
      });
    } finally {
      env.cleanup();
    }
  });

  it("uses request-scoped Blue credentials when provided", async () => {
    const env = createTestEnvironment();
    try {
      const { moveRecord } = await import("../../../src/modules/blue/graphql/client.js");
      await moveRecord({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        recordId: "todo_123",
        targetListId: "list_456",
        auth: {
          tokenId: "user-token-id",
          tokenSecret: "user-token-secret",
        },
      });

      expect(requests[0]?.headers).toEqual({
        tokenId: "user-token-id",
        tokenSecret: "user-token-secret",
        companyId: "test-company",
        projectId: "cmn524yr800e101mh7kn44mhf",
      });
    } finally {
      env.cleanup();
    }
  });

  it("uses request-scoped Blue credentials for workspace reads", async () => {
    const env = createTestEnvironment();
    try {
      const { fetchWorkspaceLists } = await import(
        "../../../src/modules/blue/graphql/client.js"
      );
      await fetchWorkspaceLists({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        auth: {
          tokenId: "user-token-id",
          tokenSecret: "user-token-secret",
        },
      });

      expect(requests[0]?.headers).toEqual({
        tokenId: "user-token-id",
        tokenSecret: "user-token-secret",
        companyId: "test-company",
        projectId: "cmn524yr800e101mh7kn44mhf",
      });
    } finally {
      env.cleanup();
    }
  });

  it("lists company users without a project header", async () => {
    const env = createTestEnvironment();
    try {
      const { fetchCompanyUsers } = await import("../../../src/modules/blue/graphql/client.js");
      const result = await fetchCompanyUsers("test-company");

      expect(result[0]?.email).toBe("sarah.khan@ayafinancial.com");
      expect(requests[0]?.headers).toEqual({
        tokenId: "test-client",
        tokenSecret: "test-secret",
        companyId: "test-company",
        projectId: null,
      });
    } finally {
      env.cleanup();
    }
  });

  it("creates a comment through createComment", async () => {
    const env = createTestEnvironment();
    try {
      const { createComment } = await import("../../../src/modules/blue/graphql/client.js");
      const result = await createComment({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        recordId: "todo_123",
        text: "@Sarah Khan follow up",
      });

      expect(result.id).toBe("comment_1");
      expect(requests[1]?.variables).toEqual({
        input: {
          html:
          '<p><span class="mention" data-type="mention" contenteditable="false" data-mention="emp_sarah" data-id="emp_sarah" data-label="Sarah Khan">@Sarah Khan</span> follow up</p>',
          text: "@Sarah Khan follow up",
          category: "TODO",
          categoryId: "todo_123",
          tiptap: true,
        },
      });
    } finally {
      env.cleanup();
    }
  });

  it("queries assigned open records with a default limit of 50", async () => {
    const env = createTestEnvironment();
    try {
      const { listAssignedOpenRecords } = await import(
        "../../../src/modules/blue/graphql/client.js"
      );
      const result = await listAssignedOpenRecords({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        companyId: "test-company",
        assigneeId: "user_1",
      });

      expect(result.items).toHaveLength(1);
      expect(result.pageInfo.totalItems).toBe(101);
      expect((requests[0]?.variables.limit as number) ?? 0).toBe(50);
    } finally {
      env.cleanup();
    }
  });

  it("queries checklist assignments by assignee and done status", async () => {
    const env = createTestEnvironment();
    try {
      const { listAssignedChecklistItems } = await import(
        "../../../src/modules/blue/graphql/client.js"
      );
      const result = await listAssignedChecklistItems({
        workspaceId: "cmn524yr800e101mh7kn44mhf",
        assigneeId: "user_1",
        done: false,
        todoDone: false,
      });

      expect(result.items[0]?.title).toBe("Employment Letter");
      expect(result.items[0]?.checklist.todo.title).toBe("Sheraz File");
      expect(requests[0]?.variables.filter).toEqual({
        assigneeIds: ["user_1"],
        done: false,
        excludeArchivedProjects: true,
        todoDone: false,
      });
      expect((requests[0]?.variables.take as number) ?? 0).toBe(50);
    } finally {
      env.cleanup();
    }
  });

  it("fetches record detail with commentList as a top-level query field", async () => {
    const env = createTestEnvironment();
    try {
      const { fetchRecordDetail } = await import(
        "../../../src/modules/blue/graphql/client.js"
      );
      const result = await fetchRecordDetail("cmn524yr800e101mh7kn44mhf", "todo_1");

      expect(result.record?.title).toBe("Fatima Hammou");
      expect(result.comments[0]?.text).toBe("Latest update");
      expect(requests[0]?.query).toContain("query RecordDetail");
      expect(requests[0]?.query).toMatch(/}\s+commentList\(/);
      expect(requests[0]?.query).toContain("items: checklistItems");
      expect(requests[0]?.variables).toEqual({ recordId: "todo_1" });
    } finally {
      env.cleanup();
    }
  });

  it("reads reporting capability, dashboards, and reports", async () => {
    const env = createTestEnvironment();
    try {
      const {
        fetchBlueDashboards,
        fetchBlueReportingCapability,
        fetchBlueReports,
      } = await import("../../../src/modules/blue/graphql/client.js");

      const capability = await fetchBlueReportingCapability("test-company");
      const dashboards = await fetchBlueDashboards({ companyId: "test-company" });
      const reports = await fetchBlueReports({ companyId: "test-company" });

      expect(capability.supportsReports).toBe(true);
      expect(capability.plan?.planName).toBe("Enterprise");
      expect(dashboards.items[0]?.title).toBe("Revenue Dashboard");
      expect(reports.items[0]?.title).toBe("Weekly Funnel");
    } finally {
      env.cleanup();
    }
  });

  it("merges fallback report ids when the company report list is empty", async () => {
    const env = createTestEnvironment({
      BLUE_REPORT_FALLBACK_IDS: "report_fallback_1,report_fallback_2",
    });

    server.use(
      http.post("https://blue.test/graphql", async ({ request }) => {
        const body = (await request.json()) as {
          query: string;
          variables: Record<string, unknown>;
        };
        requests.push(body);

        if (body.query.includes("query ReportingReports")) {
          return HttpResponse.json({
            data: {
              reports: {
                items: [],
                totalCount: 0,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            },
          });
        }

        if (body.query.includes("query ReportingReportById")) {
          const reportId = String(body.variables.id ?? "report_fallback_1");
          return HttpResponse.json({
            data: {
              report: {
                id: reportId,
                title: reportId.endsWith("_1")
                  ? "AYA x Hamza Workspace Overview"
                  : "AYA x Hamza Employee Workload Tracker",
                description: "Fallback report",
                createdAt: "2026-03-25T00:00:00.000Z",
                updatedAt: "2026-03-26T00:00:00.000Z",
                lastGeneratedAt: "2026-03-27T00:00:00.000Z",
                projectIds: ["cmn524yr800e101mh7kn44mhf"],
                createdBy: {
                  id: "user_1",
                  email: "owner@example.com",
                  fullName: "Owner",
                },
                reportUsers: [],
                dataSources: [
                  {
                    id: `source_${reportId}`,
                    name: "Leads",
                    sourceType: "TODOS",
                    projectIds: ["cmn524yr800e101mh7kn44mhf"],
                    order: 1,
                  },
                ],
              },
            },
          });
        }

        return HttpResponse.json({ data: {} });
      }),
    );

    try {
      const { fetchBlueReports } = await import(
        "../../../src/modules/blue/graphql/client.js"
      );

      const reports = await fetchBlueReports({ companyId: "test-company", take: 12 });

      expect(reports.items.map((item) => item.title)).toEqual([
        "AYA x Hamza Workspace Overview",
        "AYA x Hamza Employee Workload Tracker",
      ]);
      expect(
        requests.filter((request) => request.query.includes("query ReportingReportById")),
      ).toHaveLength(2);
    } finally {
      env.cleanup();
    }
  });
});
