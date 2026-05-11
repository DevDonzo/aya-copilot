import { describe, expect, it } from "vitest";

import { detectIntent, planEmployeeIntent } from "../../src/router/intents.js";

const fixedNowIso = "2026-04-09T12:00:00.000Z";

const actor = {
  employeeId: "emp_1",
  displayName: "Hamza Paracha",
  blueUserId: "emp_1",
};

const adminActor = {
  employeeId: "admin_1",
  displayName: "Admin User",
  blueUserId: "admin_1",
  roleName: "admin",
} as const;

describe("detectIntent", () => {
  it("matches workload requests", () => {
    const result = detectIntent({
      actor,
      message: "what am i working on",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.list_assigned",
      parameters: {
        employeeName: "Hamza Paracha",
      },
    });
  });

  it("maps another employee working-on requests to open-record workload", () => {
    const result = detectIntent({
      actor: adminActor,
      message: "what is Sarah working on?",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.list_assigned",
      parameters: {
        employeeName: "sarah",
      },
    });
  });

  it("matches follow-up queue requests", () => {
    const result = detectIntent({
      actor,
      message: "what needs follow up today",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.follow_up",
      parameters: {
        employeeName: "Hamza Paracha",
      },
    });
  });

  it("maps self assignment requests to checklist assignment reporting", () => {
    const result = planEmployeeIntent({
      actor,
      message: "what are my assignments",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "assignments.report",
      parameters: {
        assignmentStatus: "open",
        employeeName: "Hamza Paracha",
      },
      requiresClarification: false,
    });
  });

  it("maps assignment tab/tool phrasing to checklist assignment reporting", () => {
    const result = planEmployeeIntent({
      actor,
      message: "is there an assignments tab or tool to see my assignments",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "assignments.report",
      parameters: {
        assignmentStatus: "open",
        employeeName: "Hamza Paracha",
      },
      requiresClarification: false,
    });
  });

  it("maps admin completed assignment requests to another employee", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "what assignments did Sarah complete",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "assignments.report",
      parameters: {
        assignmentStatus: "completed",
        employeeName: "Sarah",
      },
      requiresClarification: false,
    });
  });

  it("matches move commands", () => {
    const result = detectIntent({
      actor,
      message: "move sheraz to 0.2",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.move",
      parameters: {
        recordQuery: "sheraz",
        targetListQuery: "0.2",
      },
    });
  });

  it("normalizes assignment entity phrasing with generic client words", () => {
    const result = planEmployeeIntent({
      actor,
      message: "assign the client aya qa lead to sarah",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "records.assign",
      parameters: {
        entityQuery: "aya qa",
        assigneeName: "sarah",
      },
      requiresClarification: false,
    });
  });

  it("handles polite assignment phrasing without losing intent", () => {
    const result = planEmployeeIntent({
      actor,
      message: "hey aya, can you please assign the client aya qa lead to sarah?",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "records.assign",
      parameters: {
        entityQuery: "aya qa",
        assigneeName: "sarah",
      },
      requiresClarification: false,
    });
  });

  it("handles polite mention requests", () => {
    const result = planEmployeeIntent({
      actor,
      message: "please can you show my mentions from today?",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "activity.mentions",
      parameters: {
        dateStart: "2026-04-09",
        dateEnd: "2026-04-09",
        dateLabel: "today",
      },
      requiresClarification: false,
    });
  });

  it("handles polite workload phrasing", () => {
    const result = planEmployeeIntent({
      actor,
      message: "could you tell me what am i working on?",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "records.list_assigned",
      parameters: {
        employeeName: "Hamza Paracha",
      },
      requiresClarification: false,
    });
  });

  it("matches comment creation commands", () => {
    const result = detectIntent({
      actor,
      message: "add note to sheraz: Client sent docs",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "comments.create",
      parameters: {
        recordQuery: "sheraz",
        text: "Client sent docs",
      },
    });
  });

  it("matches recent comment lookup commands", () => {
    const result = detectIntent({
      actor,
      message: "show comments for sheraz",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "comments.list_recent",
      parameters: {
        recordQuery: "sheraz",
      },
    });
  });

  it("maps natural client detail requests to the detail intent", () => {
    const result = planEmployeeIntent({
      actor,
      message: "show me Hamza",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.detail",
      parameters: {
        recordQuery: "Hamza",
      },
      requiresClarification: false,
    });
  });

  it("asks admins to clarify when a bare self-name could mean workload or client", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "show me Admin",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.detail",
      parameters: {
        recordQuery: "Admin",
        detailMode: "default",
      },
      requiresClarification: true,
      clarificationQuestion: "Do you want your workload or the client Admin?",
    });
  });

  it("maps status-style requests to the detail intent", () => {
    const result = planEmployeeIntent({
      actor,
      message: "what's going on with Sheraz",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.detail",
      parameters: {
        recordQuery: "Sheraz",
        detailMode: "briefing",
        briefingFocus: "general",
      },
    });
  });

  it("maps blocker requests to a focused client briefing", () => {
    const result = planEmployeeIntent({
      actor,
      message: "what is blocking Sheraz",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.detail",
      parameters: {
        recordQuery: "Sheraz",
        detailMode: "briefing",
        briefingFocus: "blockers",
      },
      requiresClarification: false,
    });
  });

  it("maps missing-doc requests to a focused client briefing", () => {
    const result = planEmployeeIntent({
      actor,
      message: "what docs are still missing from Sheraz",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.detail",
      parameters: {
        recordQuery: "Sheraz",
        detailMode: "briefing",
        briefingFocus: "missing_docs",
      },
      requiresClarification: false,
    });
  });

  it("maps handoff requests to a focused client briefing", () => {
    const result = planEmployeeIntent({
      actor,
      message: "give me a handoff summary for Sheraz",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.detail",
      parameters: {
        recordQuery: "Sheraz",
        detailMode: "briefing",
        briefingFocus: "handoff",
      },
      requiresClarification: false,
    });
  });

  it("maps admin exact-activity requests to the employee activity report", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "what did Sheraz do today",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "activity.employee_report",
      parameters: {
        employeeName: "Sheraz",
        activityFocus: "all",
      },
      requiresClarification: false,
    });
  });

  it("maps admin comment-activity requests to the employee activity report", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "what comments did Sheraz make today",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "activity.employee_report",
      parameters: {
        employeeName: "Sheraz",
        activityFocus: "comments",
      },
      requiresClarification: false,
    });
  });

  it("maps admin workspace move-activity requests to the workspace activity report", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "who moved clients today",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "activity.workspace_report",
      parameters: {
        activityFocus: "moves",
      },
      requiresClarification: false,
    });
  });

  it("maps admin weekly employee activity requests to the employee activity report", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "what did Sheraz do this week",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "activity.employee_report",
      parameters: {
        employeeName: "Sheraz",
        activityFocus: "all",
        dateStart: "2026-04-06",
        dateEnd: "2026-04-09",
        dateLabel: "this week",
      },
      requiresClarification: false,
    });
  });

  it("maps admin last-week employee activity requests to the employee activity report", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "what did Sheraz do last week",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "activity.employee_report",
      parameters: {
        employeeName: "Sheraz",
        activityFocus: "all",
        dateStart: "2026-03-30",
        dateEnd: "2026-04-05",
        dateLabel: "last week",
      },
      requiresClarification: false,
    });
  });

  it("maps admin rolling-range workspace activity requests to the workspace activity report", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "who created leads last 7 days",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "activity.workspace_report",
      parameters: {
        activityFocus: "creates",
        dateStart: "2026-04-03",
        dateEnd: "2026-04-09",
        dateLabel: "last 7 days",
      },
      requiresClarification: false,
    });
  });

  it("maps admin client activity questions to the record activity report", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "who touched Hamza Client today",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "activity.record_report",
      parameters: {
        recordQuery: "Hamza Client",
        activityFocus: "all",
        dateStart: "2026-04-09",
        dateEnd: "2026-04-09",
        dateLabel: "today",
      },
      requiresClarification: false,
    });
  });

  it("maps admin range-based client timeline questions to the record activity report", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message:
        "show me the timeline for Hamza Client from 2026-04-08 to 2026-04-09",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "activity.record_report",
      parameters: {
        recordQuery: "Hamza Client",
        activityFocus: "timeline",
        dateStart: "2026-04-08",
        dateEnd: "2026-04-09",
        dateLabel: "2026-04-08 to 2026-04-09",
      },
      requiresClarification: false,
    });
  });

  it("maps admin exception-report requests to the exception report intent", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "show me exception reports",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "records.exception_report",
      parameters: {
        exceptionFocus: "all",
      },
      requiresClarification: false,
    });
  });

  it("maps admin missing-finance requests to a focused exception report", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "which records are missing finance amount",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "records.exception_report",
      parameters: {
        exceptionFocus: "finance_amount",
      },
      requiresClarification: false,
    });
  });

  it("maps admin employee-filtered exception requests", () => {
    const result = planEmployeeIntent({
      actor: adminActor,
      message: "show me records assigned to Sarah with missing required fields",
      nowIso: fixedNowIso,
    });

    expect(result).toMatchObject({
      intent: "records.exception_report",
      parameters: {
        exceptionFocus: "all",
        employeeName: "Sarah",
      },
      requiresClarification: false,
    });
  });

  it("maps call-prep phrasing to the detail planner with call prep mode", () => {
    const result = planEmployeeIntent({
      actor,
      message: "prep me for a call with Sheraz",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.detail",
      parameters: {
        recordQuery: "Sheraz",
        detailMode: "call_prep",
      },
      requiresClarification: false,
    });
  });

  it("uses active record context for comment follow-ups", () => {
    const result = planEmployeeIntent({
      actor,
      message: "comments on this client",
      nowIso: new Date().toISOString(),
      hasActiveRecordContext: true,
    });

    expect(result).toMatchObject({
      intent: "comments.list_recent",
      parameters: {
        useActiveRecordContext: true,
      },
      requiresClarification: false,
    });
  });

  it("asks for clarification when a contextual move has no active record", () => {
    const result = planEmployeeIntent({
      actor,
      message: "move this to underwriting",
      nowIso: new Date().toISOString(),
      hasActiveRecordContext: false,
    });

    expect(result).toMatchObject({
      intent: "records.move",
      parameters: {
        targetListQuery: "underwriting",
        useActiveRecordContext: true,
      },
      requiresClarification: true,
      clarificationQuestion: "Which client should I move?",
    });
  });

  it("uses active record context for contextual moves", () => {
    const result = planEmployeeIntent({
      actor,
      message: "move this to underwriting",
      nowIso: new Date().toISOString(),
      hasActiveRecordContext: true,
    });

    expect(result).toMatchObject({
      intent: "records.move",
      parameters: {
        targetListQuery: "underwriting",
        useActiveRecordContext: true,
      },
      requiresClarification: false,
    });
  });

  it("matches email-based comment lookup commands", () => {
    const result = detectIntent({
      actor,
      message: "comments on hamza@ayafinancial.com ?",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "comments.list_recent",
      parameters: {
        recordQuery: "hamza@ayafinancial.com",
      },
    });
  });

  it("matches lead creation commands", () => {
    const result = detectIntent({
      actor,
      message:
        "create a new lead named test lead with phone +14165550100 email testlead@example.com amount 250000",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.create",
      parameters: {
        fullName: "test lead",
        phone: "+14165550100",
        email: "testlead@example.com",
        financeAmount: "250000",
      },
    });
  });

  it("normalizes obvious amount shorthand in lead creation plans", () => {
    const result = planEmployeeIntent({
      actor,
      message:
        "create a new lead named test lead phone +14165550100 email testlead@example.com amount 275k",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "records.create",
      parameters: {
        fullName: "test lead",
        financeAmount: "275000",
      },
      requiresClarification: false,
    });
  });

  it("matches reporting overview requests", () => {
    const result = detectIntent({
      actor,
      message: "show me dashboards",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "reporting.overview",
    });
  });

  it("matches reporting questions", () => {
    const result = detectIntent({
      actor,
      message: "how many reports do we have and is enterprise reporting enabled?",
      nowIso: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      intent: "reporting.question",
      parameters: {
        question: "how many reports do we have and is enterprise reporting enabled?",
      },
    });
  });

  it("returns null for unsupported phrases", () => {
    const result = detectIntent({
      actor,
      message: "please brainstorm improvements for next quarter",
      nowIso: new Date().toISOString(),
    });

    expect(result).toBeNull();
  });
});
