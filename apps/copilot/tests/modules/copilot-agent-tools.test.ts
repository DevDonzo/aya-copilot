import { beforeEach, describe, expect, it, vi } from "vitest";

const actor = {
  employeeId: "employee_1",
  displayName: "Hamza Paracha",
  email: "hamza@ayafinancial.com",
  roleName: "employee",
};

describe("Aya AI SDK tool registry", () => {
  beforeEach(() => {
    vi.resetModules();
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

  it("maps task tools with separate record and task queries", async () => {
    const assignTask = vi.fn().mockResolvedValue({
      recordId: "record_1",
      recordTitle: "AYA SMOKE TEST",
      taskTitle: "Income docs",
      responseText: "Assigned task \"Income docs\" on AYA SMOKE TEST to Rehan S.",
    });
    const completeTaskAssignment = vi.fn().mockResolvedValue({
      recordId: "record_1",
      recordTitle: "AYA SMOKE TEST",
      taskTitle: "Income docs",
      responseText: "Marked task \"Income docs\" as done on AYA SMOKE TEST.",
    });
    const setTaskDueDate = vi.fn().mockResolvedValue({
      recordId: "record_1",
      recordTitle: "AYA SMOKE TEST",
      taskTitle: "Income docs",
      dueAt: "2026-05-20T23:59:59.999Z",
      responseText:
        "Set the due date for task \"Income docs\" on AYA SMOKE TEST to 2026-05-20.",
    });

    vi.doMock("../../src/modules/copilot/actions.js", () =>
      mockedActions({ assignTask, completeTaskAssignment, setTaskDueDate }),
    );

    const traces: any[] = [];
    const { createAyaAgentTools } = await import(
      "../../src/modules/copilot/agent/tool-registry.js"
    );
    const tools = createAyaAgentTools(buildContext(), traces);

    await tools.assignTask.execute({
      recordQuery: "AYA SMOKE TEST",
      taskQuery: "Income docs",
      assigneeName: "Rehan S",
    });
    await tools.completeTask.execute({
      recordQuery: "AYA SMOKE TEST",
      taskQuery: "Income docs",
    });
    await tools.setTaskDueDate.execute({
      recordQuery: "AYA SMOKE TEST",
      taskQuery: "Income docs",
      dueDate: "2026-05-20",
    });

    expect(assignTask).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        taskQuery: "Income docs",
        assigneeName: "Rehan S",
      }),
    );
    expect(completeTaskAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        taskQuery: "Income docs",
      }),
    );
    expect(setTaskDueDate).toHaveBeenCalledWith(
      expect.objectContaining({
        recordQuery: "AYA SMOKE TEST",
        taskQuery: "Income docs",
        dueDate: "2026-05-20",
      }),
    );
    expect(traces.map((trace) => trace.intent)).toEqual([
      "tasks.assign",
      "tasks.complete",
      "tasks.set_due_date",
    ]);
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
});

function buildContext() {
  return {
    actor,
    transport: "test",
    blueAuth: null,
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
