import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actor = {
  employeeId: "employee_1",
  displayName: "Hamza Paracha",
  email: "hamza@ayafinancial.com",
  roleName: "employee",
};

describe("Aya AI SDK tool registry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            currentUser: {
              id: "employee_1",
              uid: "employee_1",
              email: "hamza@ayafinancial.com",
              fullName: "Hamza Paracha",
              projectUserRole: {
                id: "role_member",
                name: "Member",
                isRecordsEnabled: true,
              },
            },
          },
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps core client read tools to trusted actions", async () => {
    const searchClients = vi.fn().mockResolvedValue({
      responseText: "1. AYA SMOKE TEST (Leads)",
    });
    const getClientDetail = vi.fn().mockResolvedValue({
      responseText: "AYA SMOKE TEST is in Leads.",
    });
    const getClientComments = vi.fn().mockResolvedValue({
      responseText: "Recent comments for AYA SMOKE TEST:",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({ searchClients, getClientDetail, getClientComments }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext(), traces);

    await tools.searchClients.execute({ query: "AYA SMOKE TEST" });
    await tools.getClientDetail.execute({ recordQuery: "AYA SMOKE TEST" });
    await tools.getClientComments.execute({ recordQuery: "AYA SMOKE TEST" });

    expect(searchClients).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "AYA SMOKE TEST",
        actor,
        transport: "test",
      }),
    );
    expect(getClientDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        actor,
        transport: "test",
      }),
    );
    expect(getClientComments).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        actor,
        transport: "test",
      }),
    );
    expect(traces.map((trace) => trace.intent)).toEqual([
      "records.search",
      "records.detail",
      "comments.list_recent",
    ]);
  });

  it("maps core client write tools to trusted actions", async () => {
    const addCommentToClient = vi.fn().mockResolvedValue({
      responseText: "Added comment to AYA SMOKE TEST.",
    });
    const moveClientToStage = vi.fn().mockResolvedValue({
      responseText: "Moved AYA SMOKE TEST to Done.",
    });
    const assignRecord = vi.fn().mockResolvedValue({
      responseText: "Assigned AYA SMOKE TEST to Rehan S.",
    });
    const completeRecordAssignment = vi.fn().mockResolvedValue({
      responseText: "Marked AYA SMOKE TEST as done.",
    });
    const setRecordDueDate = vi.fn().mockResolvedValue({
      responseText: "Set the due date for AYA SMOKE TEST to 2026-05-20.",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({
        addCommentToClient,
        moveClientToStage,
        assignRecord,
        completeRecordAssignment,
        setRecordDueDate,
      }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext(), traces);

    await tools.addClientComment.execute({
      recordQuery: "AYA SMOKE TEST",
      text: "followed up",
    });
    await tools.moveClientToStage.execute({
      recordQuery: "AYA SMOKE TEST",
      targetListQuery: "Done",
    });
    await tools.assignClient.execute({
      recordQuery: "AYA SMOKE TEST",
      assigneeName: "Rehan S",
    });
    await tools.completeClientRecord.execute({
      recordQuery: "AYA SMOKE TEST",
    });
    await tools.setClientDueDate.execute({
      recordQuery: "AYA SMOKE TEST",
      dueDate: "2026-05-20",
    });

    expect(addCommentToClient).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        text: "followed up",
      }),
    );
    expect(moveClientToStage).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        targetListQuery: "Done",
      }),
    );
    expect(assignRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        entityQuery: "AYA SMOKE TEST",
        assigneeName: "Rehan S",
      }),
    );
    expect(completeRecordAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        entityQuery: "AYA SMOKE TEST",
      }),
    );
    expect(setRecordDueDate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityQuery: "AYA SMOKE TEST",
        dueDate: "2026-05-20",
      }),
    );
    expect(traces.map((trace) => trace.intent)).toEqual([
      "comments.create",
      "records.move",
      "records.assign",
      "records.complete",
      "records.set_due_date",
    ]);
  });

  it("maps create-record tool calls to the trusted create action without invented fields", async () => {
    const createClientRecord = vi.fn().mockResolvedValue({
      recordId: "record_new",
      recordTitle: "New Client",
      responseText: "Created New Client in Leads.",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({ createClientRecord }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext(), traces);

    const output = await tools.createClientRecord.execute({
      fullName: "New Client",
      targetListQuery: "Leads",
    });

    expect(output).toMatchObject({
      ok: true,
      responseText: "Created New Client in Leads.",
    });
    expect(createClientRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "New Client",
        targetListQuery: "Leads",
        actor,
        transport: "test",
      }),
    );
    expect(createClientRecord.mock.calls[0][0]).not.toHaveProperty("email");
    expect(createClientRecord.mock.calls[0][0]).not.toHaveProperty("phone");
    expect(traces[0]).toMatchObject({
      toolName: "createClientRecord",
      intent: "records.create",
      outcome: "success",
    });
  });

  it("maps employee-scoped read tools and defaults to the signed-in employee", async () => {
    const getEmployeeDailyBrief = vi.fn().mockResolvedValue({
      responseText: "Daily brief for Hamza Paracha.",
    });
    const getEmployeeDaySummary = vi.fn().mockResolvedValue({
      summaryText: "Hamza Paracha had 2 events today.",
    });
    const getEmployeeWorkload = vi.fn().mockResolvedValue({
      responseText: "Hamza Paracha has 3 open Blue records.",
    });
    const getEmployeeFollowUpQueue = vi.fn().mockResolvedValue({
      responseText: "Follow-up queue for Hamza Paracha.",
    });
    const getEmployeeAssignmentReport = vi.fn().mockResolvedValue({
      responseText: "Hamza Paracha has 1 open assignment.",
    });
    const getEmployeeNotificationFeed = vi.fn().mockResolvedValue({
      responseText: "Notifications for Hamza Paracha:",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({
        getEmployeeDailyBrief,
        getEmployeeDaySummary,
        getEmployeeWorkload,
        getEmployeeFollowUpQueue,
        getEmployeeAssignmentReport,
        getEmployeeNotificationFeed,
      }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext(), traces);

    await tools.getEmployeeDailyBrief.execute({});
    await tools.getEmployeeDaySummary.execute({});
    await tools.getEmployeeWorkload.execute({});
    await tools.getEmployeeFollowUpQueue.execute({});
    await tools.getEmployeeAssignments.execute({});
    await tools.getEmployeeNotifications.execute({});

    for (const mockedAction of [
      getEmployeeDailyBrief,
      getEmployeeDaySummary,
      getEmployeeWorkload,
      getEmployeeFollowUpQueue,
      getEmployeeAssignmentReport,
      getEmployeeNotificationFeed,
    ]) {
      expect(mockedAction).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeName: "Hamza Paracha",
          transport: "test",
        }),
      );
    }
    expect(traces.map((trace) => trace.intent)).toEqual([
      "brief.daily",
      "summary.employee_day",
      "records.list_assigned",
      "records.follow_up",
      "assignments.report",
      "notifications.feed",
    ]);
  });

  it("maps assign-task tool calls with separate record and task queries", async () => {
    const assignTask = vi.fn().mockResolvedValue({
      recordId: "record_1",
      recordTitle: "AYA SMOKE TEST",
      taskTitle: "Income docs",
      responseText: "Assigned task \"Income docs\" on AYA SMOKE TEST to Rehan S.",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({ assignTask }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext(), traces);

    const output = await tools.assignTask.execute({
      recordQuery: "AYA SMOKE TEST",
      taskQuery: "Income docs",
      assigneeName: "Rehan S",
    });

    expect(output).toMatchObject({
      ok: true,
      responseText: "Assigned task \"Income docs\" on AYA SMOKE TEST to Rehan S.",
    });
    expect(assignTask).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        taskQuery: "Income docs",
        assigneeName: "Rehan S",
      }),
    );
    expect(traces[0]).toMatchObject({
      toolName: "assignTask",
      intent: "tasks.assign",
      outcome: "success",
    });
  });

  it("maps complete-task tool calls with separate record and task queries", async () => {
    const completeTaskAssignment = vi.fn().mockResolvedValue({
      recordId: "record_1",
      recordTitle: "AYA SMOKE TEST",
      taskTitle: "Income docs",
      responseText: "Marked task \"Income docs\" as done on AYA SMOKE TEST.",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({ completeTaskAssignment }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext(), traces);

    const output = await tools.completeTask.execute({
      recordQuery: "AYA SMOKE TEST",
      taskQuery: "Income docs",
    });

    expect(output).toMatchObject({
      ok: true,
      responseText: "Marked task \"Income docs\" as done on AYA SMOKE TEST.",
    });
    expect(completeTaskAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        taskQuery: "Income docs",
      }),
    );
    expect(traces[0]).toMatchObject({
      toolName: "completeTask",
      intent: "tasks.complete",
      outcome: "success",
    });
  });

  it("maps task due-date tool calls with separate record and task queries", async () => {
    const setTaskDueDate = vi.fn().mockResolvedValue({
      recordId: "record_1",
      recordTitle: "AYA SMOKE TEST",
      taskTitle: "Income docs",
      dueAt: "2026-05-20T23:59:59.999Z",
      responseText:
        "Set the due date for task \"Income docs\" on AYA SMOKE TEST to 2026-05-20.",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({ setTaskDueDate }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext(), traces);

    const output = await tools.setTaskDueDate.execute({
      recordQuery: "AYA SMOKE TEST",
      taskQuery: "Income docs",
      dueDate: "2026-05-20",
    });

    expect(output).toMatchObject({
      ok: true,
      responseText:
        "Set the due date for task \"Income docs\" on AYA SMOKE TEST to 2026-05-20.",
    });
    expect(setTaskDueDate).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        taskQuery: "Income docs",
        dueDate: "2026-05-20",
      }),
    );
    expect(traces[0]).toMatchObject({
      toolName: "setTaskDueDate",
      intent: "tasks.set_due_date",
      outcome: "success",
    });
  });

  it("blocks CRM read tools without personal Blue credentials", async () => {
    const searchClients = vi.fn().mockResolvedValue({
      responseText: "1. AYA SMOKE TEST (Leads)",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({ searchClients }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext({ blueAuth: null }), traces);

    const output = await tools.searchClients.execute({
      query: "AYA SMOKE TEST",
    });

    expect(output).toMatchObject({
      ok: false,
    });
    expect(output.errorMessage).toContain(
      "Connect your Blue account before using Aya with CRM data.",
    );
    expect(searchClients).not.toHaveBeenCalled();
    expect(traces[0]).toMatchObject({
      toolName: "searchClients",
      intent: "records.search",
      outcome: "error",
    });
  });

  it("blocks employee-scoped read tools for other employees", async () => {
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const traces: any[] = [];
    const tools = createAyaAgentTools(buildContext(), traces);

    const output = await tools.getEmployeeDaySummary.execute({
      employeeName: "Rehan S",
    });

    expect(output).toMatchObject({
      ok: false,
      errorMessage: "You do not have permission to do that.",
    });
    expect(traces[0]).toMatchObject({
      toolName: "getEmployeeDaySummary",
      intent: "summary.employee_day",
      outcome: "error",
    });
  });

  it("blocks bulk destructive write requests before action execution", async () => {
    const moveClientToStage = vi.fn().mockResolvedValue({
      responseText: "Moved every record to Done.",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({ moveClientToStage }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext(), traces);

    const output = await tools.moveClientToStage.execute({
      recordQuery: "every record",
      targetListQuery: "Done",
    });

    expect(output).toMatchObject({
      ok: false,
    });
    expect(output.errorMessage).toContain(
      "I cannot perform bulk destructive actions like moving, deleting, completing, assigning, or updating every record at once.",
    );
    expect(moveClientToStage).not.toHaveBeenCalled();
    expect(traces[0]).toMatchObject({
      toolName: "moveClientToStage",
      intent: "records.move",
      outcome: "error",
    });
  });
});

function buildContext(
  overrides: Partial<ReturnType<typeof buildDefaultContext>> = {},
) {
  return {
    ...buildDefaultContext(),
    ...overrides,
  };
}

function buildDefaultContext() {
  return {
    actor,
    transport: "test",
    blueAuth: {
      tokenId: "1234567890abcdef1234567890abcdef",
      tokenSecret: "test-blue-secret",
    },
    message: "test message",
    nowIso: "2026-05-14T00:00:00.000Z",
    hasActiveRecordContext: false,
    activeRecordContext: null,
  };
}

function mockedActions(overrides: Record<string, unknown>) {
  const defaultResult = async () => ({
    responseText: "ok",
  });

  return {
    addCommentToClient: defaultResult,
    assignRecord: defaultResult,
    assignTask: defaultResult,
    answerReportingQuestion: defaultResult,
    completeRecordAssignment: defaultResult,
    completeTaskAssignment: defaultResult,
    createClientRecord: defaultResult,
    getClientComments: defaultResult,
    getClientDetail: defaultResult,
    getEmployeeAssignmentReport: defaultResult,
    getEmployeeDailyBrief: defaultResult,
    getEmployeeDaySummary: defaultResult,
    getEmployeeFollowUpQueue: defaultResult,
    getEmployeeNotificationFeed: defaultResult,
    getEmployeeWorkload: defaultResult,
    getReportingOverview: defaultResult,
    getRecordActivityReport: defaultResult,
    getTeamDaySummary: defaultResult,
    getTeamFollowUpQueue: defaultResult,
    getWorkspaceActivityReport: defaultResult,
    getWorkspaceExceptionReport: defaultResult,
    moveClientToStage: defaultResult,
    searchClients: defaultResult,
    setRecordDueDate: defaultResult,
    setTaskDueDate: defaultResult,
    ...overrides,
  };
}
