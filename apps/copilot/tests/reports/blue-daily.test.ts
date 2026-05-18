import fs from "node:fs";

import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../helpers/test-env.js";

const workspaceId = "cmhazc4rl1vkand1eonnmiyjy";
const rehanCanonicalId = "cm2o7pr4f3tlroi9uexnouw44";
const rehanDuplicateId = "cm2or9cai0j7pcacvqx3kgvxz";

describe("Blue daily report", () => {
  it("computes previous-day timezone windows across DST", async () => {
    const { getPreviousCalendarDate, getReportWindow } = await import(
      "../../src/reports/blue-daily/dates.js"
    );

    expect(
      getPreviousCalendarDate(
        new Date("2026-03-09T16:00:00.000Z"),
        "America/Toronto",
      ),
    ).toBe("2026-03-08");
    expect(
      getReportWindow({
        reportDate: "2026-03-08",
        timezone: "America/Toronto",
      }),
    ).toMatchObject({
      startUtc: "2026-03-08T05:00:00.000Z",
      endUtc: "2026-03-09T04:00:00.000Z",
    });
  });

  it("prioritizes Lead Source before fallback source inference", async () => {
    const { detectRecordSource } = await import(
      "../../src/reports/blue-daily/rules.js"
    );

    expect(
      detectRecordSource({
        title: "Hubspot Imported Client",
        text: "",
        html: "",
        tags: [{ id: "tag_1", title: "Hubspot" }],
        customFields: [
          {
            id: "cf_1",
            name: "Lead Source",
            type: "TEXT",
            value: "Referral Partner",
          },
        ],
      }),
    ).toBe("Referral Partner");
    expect(
      detectRecordSource({
        title: "Jotform client",
        text: "",
        html: "",
        tags: [],
        customFields: [],
      }),
    ).toBe("Jotform");
  });

  it("filters overdue/upcoming records using Saim recency windows", async () => {
    const { getReportWindow } = await import(
      "../../src/reports/blue-daily/dates.js"
    );
    const { buildBlueDailyReportData } = await import(
      "../../src/reports/blue-daily/rules.js"
    );
    const window = getReportWindow({
      reportDate: "2026-05-14",
      timezone: "America/Toronto",
    });

    const data = buildBlueDailyReportData({
      window,
      generatedAt: "2026-05-15T16:00:00.000Z",
      records: [
        reportRecord({
          id: "overdue_old",
          dueAt: "2026-05-10T15:00:00.000Z",
        }),
        reportRecord({
          id: "overdue_recent",
          dueAt: "2026-05-10T15:00:00.000Z",
        }),
        reportRecord({
          id: "upcoming_today",
          dueAt: "2026-05-14T05:00:00.000Z",
        }),
        reportRecord({
          id: "upcoming_plus_three",
          dueAt: "2026-05-17T23:00:00.000Z",
        }),
        reportRecord({
          id: "upcoming_outside",
          dueAt: "2026-05-18T05:00:00.000Z",
        }),
        reportRecord({
          id: "upcoming_recent",
          dueAt: "2026-05-15T15:00:00.000Z",
        }),
      ],
      activities: [
        {
          id: "old_overdue_comment",
          actionType: "CREATE_COMMENT",
          recordId: "overdue_old",
          recordTitle: "Overdue old",
          commenterName: "Rehan S",
          commenterEmployeeId: rehanCanonicalId,
          occurredAt: "2026-05-05T15:00:00.000Z",
          text: "old overdue note",
        },
        {
          id: "old_upcoming_comment",
          actionType: "CREATE_COMMENT",
          recordId: "upcoming_today",
          recordTitle: "Upcoming today",
          commenterName: "Rehan S",
          commenterEmployeeId: rehanCanonicalId,
          occurredAt: "2026-05-08T15:00:00.000Z",
          text: "old upcoming note",
        },
        {
          id: "recent_comment",
          actionType: "CREATE_COMMENT",
          recordId: "overdue_recent",
          recordTitle: "Recent",
          commenterName: "Rehan S",
          commenterEmployeeId: rehanCanonicalId,
          occurredAt: "2026-05-13T15:00:00.000Z",
          text: "recent note",
        },
        {
          id: "upcoming_comment",
          actionType: "CREATE_COMMENT",
          recordId: "upcoming_recent",
          recordTitle: "Upcoming recent",
          commenterName: "Rehan S",
          commenterEmployeeId: rehanCanonicalId,
          occurredAt: "2026-05-14T15:00:00.000Z",
          text: "report day note",
        },
      ],
    });

    expect(data.overdueNoRecentComments.map((row) => row.id)).toEqual([
      "overdue_old",
    ]);
    expect(data.overdueNoRecentComments[0]).toMatchObject({
      lastCommentAt: "2026-05-05T15:00:00.000Z",
      daysSinceComment: 9,
    });
    expect(data.overdueWithRecentComments.map((row) => row.id)).toEqual([
      "overdue_recent",
    ]);
    expect(data.overdueWithRecentComments[0]).toMatchObject({
      lastCommentAt: "2026-05-13T15:00:00.000Z",
      daysSinceComment: 1,
    });
    expect(data.upcomingDue.map((row) => row.id)).toEqual([
      "upcoming_today",
      "upcoming_plus_three",
    ]);
    expect(data.upcomingDue[0]).toMatchObject({
      lastCommentAt: "2026-05-08T15:00:00.000Z",
      daysSinceComment: 6,
    });
  });

  it("excludes blank update rows and aggregates Rehan duplicate status totals", async () => {
    const { getReportWindow } = await import(
      "../../src/reports/blue-daily/dates.js"
    );
    const { buildBlueDailyReportData } = await import(
      "../../src/reports/blue-daily/rules.js"
    );
    const window = getReportWindow({
      reportDate: "2026-05-14",
      timezone: "America/Toronto",
    });

    const data = buildBlueDailyReportData({
      window,
      generatedAt: "2026-05-15T16:00:00.000Z",
      records: [
        reportRecord({
          id: "touched_by_comment",
          users: [blueUser(rehanCanonicalId, "Rehan S")],
        }),
        reportRecord({
          id: "untouched",
          users: [blueUser(rehanDuplicateId, "Rehan AYA")],
        }),
        reportRecord({
          id: "updated_record",
          updatedAt: "2026-05-14T15:00:00.000Z",
          users: [blueUser(rehanDuplicateId, "Rehan AYA")],
        }),
      ],
      activities: [
        {
          id: "comment",
          actionType: "COMMENT_CREATED",
          recordId: "touched_by_comment",
          recordTitle: "Touched by comment",
          commenterName: "Rehan AYA",
          commenterEmployeeId: rehanDuplicateId,
          occurredAt: "2026-05-14T15:00:00.000Z",
          text: "Comment body",
        },
        {
          id: "blank_update",
          actionType: "COMMENT_UPDATED",
          recordId: "untouched",
          recordTitle: "Untouched",
          commenterName: "Rehan S",
          commenterEmployeeId: rehanCanonicalId,
          occurredAt: "2026-05-14T16:00:00.000Z",
          text: "   ",
        },
        {
          id: "task_update",
          actionType: "TODO_DUE_DATE_UPDATED",
          recordId: "updated_record",
          recordTitle: "Updated record",
          commenterName: "Sarah Khan",
          commenterEmployeeId: "sarah",
          occurredAt: "2026-05-14T17:00:00.000Z",
          text: "Due date changed to tomorrow",
        },
      ],
    });

    expect(data.commentsLast24Hours.map((row) => row.recordId)).toEqual([
      "touched_by_comment",
      "updated_record",
    ]);
    expect(data.staffStatus).toContainEqual(
      expect.objectContaining({
        staffId: rehanCanonicalId,
        staffName: "Rehan S",
        openAssignedRecords: 3,
        commentsPlacedYesterday: 1,
        untouchedRecords: 1,
      }),
    );
  });

  it("builds Saim-aligned workbook sheets and attachment-only email MIME", async () => {
    const { getReportWindow } = await import(
      "../../src/reports/blue-daily/dates.js"
    );
    const { buildBlueDailyReportData } = await import(
      "../../src/reports/blue-daily/rules.js"
    );
    const { buildBlueDailyWorkbook } = await import(
      "../../src/reports/blue-daily/workbook.js"
    );
    const { buildBlueDailyEmailBody, buildGmailRawMessage } = await import(
      "../../src/reports/blue-daily/gmail.js"
    );
    const data = buildBlueDailyReportData({
      window: getReportWindow({
        reportDate: "2026-05-14",
        timezone: "America/Toronto",
      }),
      generatedAt: "2026-05-15T16:00:00.000Z",
      records: [
        reportRecord({
          id: "new_record",
          title: "Blue Client",
          users: [blueUser(rehanCanonicalId, "Rehan S")],
          customFields: [
            {
              id: "client_name",
              name: "Client Name",
              type: "TEXT",
              value: "Explicit Client",
            },
          ],
        }),
        reportRecord({
          id: "overdue_no_comment",
          dueAt: "2026-05-10T15:00:00.000Z",
        }),
        reportRecord({
          id: "overdue_recent_comment",
          dueAt: "2026-05-10T15:00:00.000Z",
        }),
        reportRecord({
          id: "upcoming_no_comment",
          dueAt: "2026-05-15T15:00:00.000Z",
        }),
      ],
      activities: [
        {
          id: "comment_1",
          actionType: "CREATE_COMMENT",
          recordId: "new_record",
          recordTitle: "Blue Client",
          commenterName: "Rehan S",
          commenterEmployeeId: rehanCanonicalId,
          occurredAt: "2026-05-14T15:00:00.000Z",
          text: "Useful update",
        },
        {
          id: "comment_2",
          actionType: "CREATE_COMMENT",
          recordId: "overdue_recent_comment",
          recordTitle: "Overdue Recent Comment",
          commenterName: "Rehan S",
          commenterEmployeeId: rehanCanonicalId,
          occurredAt: "2026-05-13T15:00:00.000Z",
          text: "Recent overdue update",
        },
      ],
    });
    const workbook = buildBlueDailyWorkbook(data);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "New tasks created yesterday",
      "Overdue tasks",
      "Overdue tasks with comments",
      "Upcoming due",
      "Comments updates last 24 hours",
      "Status Update",
    ]);
    expect(
      workbook.getWorksheet("Comments updates last 24 hours")?.getRow(1).values,
    ).toEqual([
      undefined,
      "Client",
      "Assigned To",
      "Commenter",
      "Timestamp",
      "Comment/Update",
    ]);
    expect(workbook.getWorksheet("Status Update")?.getRow(1).values).toEqual([
      undefined,
      "Responsible Staff",
      "Total Tasks Assigned",
      "Comments Placed On Tasks",
      "Untouched Tasks",
    ]);
    expect(workbook.getWorksheet("Overdue tasks")?.getRow(2).values).toEqual([
      undefined,
      "overdue_no_comment",
      "",
      "May 10, 2026",
      "No comment found",
      "N/A",
    ]);
    expect(
      workbook.getWorksheet("Overdue tasks with comments")?.getRow(1).values,
    ).toEqual([
      undefined,
      "Client",
      "Assigned Person",
      "Due Date",
      "Last Comment At",
      "Days Since Comment",
    ]);
    expect(
      workbook.getWorksheet("Overdue tasks with comments")?.getRow(2).values,
    ).toEqual([
      undefined,
      "overdue_recent_comment",
      "",
      "May 10, 2026",
      "May 13, 2026, 11:00 AM EDT",
      1,
    ]);
    expect(workbook.getWorksheet("Upcoming due")?.getRow(2).values).toEqual([
      undefined,
      "upcoming_no_comment",
      "",
      "May 15, 2026",
      "No comment found",
      "N/A",
    ]);

    const body = buildBlueDailyEmailBody(data);
    expect(body).toBe("");

    const raw = buildGmailRawMessage({
      from: "hamza@ayafinancial.com",
      to: ["rsaeed@ayafinancial.com"],
      cc: ["hamza@ayafinancial.com"],
      subject: "Blue Daily Operations Report - 2026-05-14",
      text: body,
      attachments: [
        {
          filename: "blue-daily-2026-05-14.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          content: Buffer.from("xlsx"),
        },
      ],
    });
    const decoded = Buffer.from(toBase64(raw), "base64").toString("utf8");
    expect(decoded).toContain("To: rsaeed@ayafinancial.com");
    expect(decoded).not.toContain("Content-Type: text/html");
    expect(decoded).not.toContain("Explicit Client");
    expect(decoded).not.toContain("Useful update");
    expect(decoded).toContain("filename=\"blue-daily-2026-05-14.xlsx\"");
  });

  it("manual dry run endpoint creates a workbook without sending", async () => {
    const env = createTestEnvironment();
    try {
      vi.resetModules();
      const app = await buildReportTestApp();
      const {
        createAuthSession,
        createId,
        ensureEmployee,
        insertActivityEvent,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");

      await ensureEmployee({
        employeeId: "admin_1",
        displayName: "Admin User",
        email: "admin@ayafinancial.com",
        roleName: "admin",
      });
      await createAuthSession({
        id: createId("session"),
        employeeId: "admin_1",
        sessionToken: "admin-report-session",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      await upsertBlueRecordsCache({
        workspaceId,
        items: [
          {
            id: "record_1",
            listId: "list_1",
            listTitle: "Leads",
            title: "New Client",
            normalizedTitle: "new client",
            rawJson: JSON.stringify(blueRecord({ id: "record_1" })),
          },
        ],
      });
      await insertActivityEvent({
        id: "activity_1",
        source: "blue",
        sourceEventId: "activity_1",
        workspaceId,
        actionType: "CREATE_COMMENT",
        entityType: "comment",
        entityId: "comment_1",
        occurredAt: "2026-05-14T15:00:00.000Z",
        summary: "Comment body",
        rawPayload: {
          id: "activity_1",
          category: "CREATE_COMMENT",
          createdAt: "2026-05-14T15:00:00.000Z",
          updatedAt: "2026-05-14T15:00:00.000Z",
          todo: { id: "record_1", title: "New Client" },
          comment: { id: "comment_1", text: "Comment body" },
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/reports/blue-daily/run",
        headers: {
          cookie: "aya_session=admin-report-session",
        },
        payload: {
          date: "2026-05-14",
          send: false,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "dry_run",
        sent: false,
        rowCounts: {
          newRecords: 1,
          commentsLast24Hours: 1,
        },
      });

      await app.close();
    } finally {
      env.cleanup();
    }
  });

  it("send mode writes workbook and report-run metadata with consistent counts", async () => {
    const env = createTestEnvironment({
      GOOGLE_GMAIL_CLIENT_ID: "gmail-client",
      GOOGLE_GMAIL_CLIENT_SECRET: "gmail-secret",
      GOOGLE_GMAIL_REFRESH_TOKEN: "gmail-refresh",
    });
    const sendMock = vi.fn().mockResolvedValue({ data: { id: "gmail_msg_1" } });

    try {
      vi.resetModules();
      vi.doMock("googleapis", () => ({
        google: {
          auth: {
            OAuth2: vi.fn().mockImplementation(() => ({
              setCredentials: vi.fn(),
            })),
          },
          gmail: vi.fn(() => ({
            users: {
              messages: {
                send: sendMock,
              },
            },
          })),
        },
      }));

      const {
        initializeDatabase,
        listReportRuns,
        upsertBlueRecordsCache,
      } = await import("../../src/db.js");
      const { runBlueDailyReport } = await import(
        "../../src/reports/blue-daily/service.js"
      );

      await initializeDatabase();
      await upsertBlueRecordsCache({
        workspaceId,
        items: [
          {
            id: "send_record_1",
            listId: "list_1",
            listTitle: "Leads",
            title: "Send Client",
            normalizedTitle: "send client",
            rawJson: JSON.stringify(blueRecord({ id: "send_record_1" })),
          },
        ],
      });

      const result = await runBlueDailyReport({
        date: "2026-05-14",
        send: true,
        force: true,
        refresh: false,
      });
      const runs = await listReportRuns({
        reportType: "blue_daily_operations",
        reportDate: "2026-05-14",
        limit: 1,
      });

      expect(result.status).toBe("sent");
      expect(result.workbookPath && fs.existsSync(result.workbookPath)).toBe(true);
      expect(sendMock).toHaveBeenCalledOnce();
      const raw = sendMock.mock.calls[0]?.[0]?.requestBody?.raw;
      const decoded = Buffer.from(toBase64(raw), "base64").toString("utf8");
      expect(decoded).not.toContain("New tasks created yesterday");
      expect(decoded).not.toContain("Content-Type: text/html");
      expect(decoded).toContain("filename=\"blue-daily-2026-05-14.xlsx\"");
      expect(runs[0]).toMatchObject({
        send_status: "sent",
        generated_filename: result.workbookPath,
      });
      expect(JSON.parse(runs[0]?.row_counts_json ?? "{}")).toEqual(
        result.rowCounts,
      );
    } finally {
      vi.doUnmock("googleapis");
      env.cleanup();
    }
  });

  it("blocks duplicate sends unless forced", async () => {
    const env = createTestEnvironment();
    try {
      vi.resetModules();
      const {
        createId,
        initializeDatabase,
        insertReportRun,
      } = await import("../../src/db.js");
      const { runBlueDailyReport } = await import(
        "../../src/reports/blue-daily/service.js"
      );

      await initializeDatabase();
      await insertReportRun({
        id: createId("report_run"),
        reportType: "blue_daily_operations",
        reportDate: "2026-05-14",
        sendStatus: "sent",
        recipients: ["rsaeed@ayafinancial.com"],
        sentAt: "2026-05-15T16:00:00.000Z",
      });

      await expect(
        runBlueDailyReport({
          date: "2026-05-14",
          send: true,
          force: false,
        }),
      ).resolves.toMatchObject({
        status: "skipped_duplicate",
        duplicateBlocked: true,
      });
    } finally {
      env.cleanup();
    }
  });
});

async function buildReportTestApp() {
  const { initializeDatabase } = await import("../../src/db.js");
  const { requestContextPlugin } = await import(
    "../../src/app/plugins/request-context.js"
  );
  const { authPlugin } = await import("../../src/app/plugins/auth.js");
  const { errorHandlerPlugin } = await import(
    "../../src/app/plugins/error-handler.js"
  );
  const { reportRoutes } = await import("../../src/routes/reports.js");

  await initializeDatabase();

  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(requestContextPlugin);
  await app.register(authPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(reportRoutes);
  return app;
}

function reportRecord(input: {
  id: string;
  title?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  dueAt?: string | null;
  users?: ReturnType<typeof blueUser>[];
  customFields?: Array<{
    id: string;
    name: string;
    type: string;
    value: unknown;
  }>;
  commentCount?: number;
  latestCommentAt?: string | null;
}) {
  return {
    id: input.id,
    title: input.title ?? input.id,
    listTitle: "Leads",
    createdAt: input.createdAt ?? "2026-05-14T15:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-05-13T15:00:00.000Z",
    dueAt: input.dueAt ?? null,
    archived: false,
    done: false,
    commentCount: input.commentCount ?? 0,
    latestCommentAt: input.latestCommentAt ?? null,
    users: input.users ?? [],
    tags: [],
    customFields: input.customFields ?? [],
    text: "",
    html: "",
  };
}

function blueRecord(input: { id: string }) {
  return {
    id: input.id,
    uid: input.id,
    title: "New Client",
    text: "",
    html: "",
    startedAt: null,
    duedAt: null,
    commentCount: 0,
    archived: false,
    done: false,
    createdAt: "2026-05-14T15:00:00.000Z",
    updatedAt: "2026-05-14T15:00:00.000Z",
    users: [],
    tags: [],
    customFields: [],
    todoList: {
      id: "list_1",
      uid: "list_1",
      title: "Leads",
      position: 1,
      updatedAt: "2026-05-14T15:00:00.000Z",
    },
  };
}

function blueUser(id: string, fullName: string) {
  return {
    id,
    uid: id,
    email: "",
    firstName: fullName.split(" ")[0] ?? fullName,
    lastName: fullName.split(" ").slice(1).join(" "),
    fullName,
    timezone: "America/Toronto",
    updatedAt: "2026-05-14T15:00:00.000Z",
  };
}

function toBase64(base64url: string) {
  return base64url.replace(/-/g, "+").replace(/_/g, "/");
}
