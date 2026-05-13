import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../helpers/test-env.js";

const fixedNowIso = "2026-04-09T12:00:00.000Z";
const actor = {
  employeeId: "admin_1",
  displayName: "Hamza Paracha",
  blueUserId: "admin_1",
  roleName: "admin",
  email: "hamza@ayafinancial.com",
} as const;

describe("LLM intent planner", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses structured LLM output for flexible named-employee phrasing", async () => {
    const env = createTestEnvironment({
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "true",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "assignments.report",
                confidence: 0.93,
                parameters: {
                  employeeName: "Sarah",
                  assignmentStatus: "open",
                },
                requiresClarification: false,
                matchedSignals: ["llm:test"],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { planCopilotIntent } = await import(
        "../../src/modules/copilot/llm-planner.js"
      );

      const result = await planCopilotIntent({
        actor,
        message: "can you pull whatever Sarah is responsible for right now?",
        nowIso: fixedNowIso,
        hasActiveRecordContext: false,
      });

      expect(result).toMatchObject({
        intent: "assignments.report",
        parameters: {
          employeeName: "Sarah",
          assignmentStatus: "open",
        },
        requiresClarification: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      env.cleanup();
    }
  });

  it("forces plain assignment requests to open even if the LLM says all", async () => {
    const env = createTestEnvironment({
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "true",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: "assignments.report",
                  confidence: 0.91,
                  parameters: {
                    employeeName: "Sarah",
                    assignmentStatus: "all",
                  },
                  requiresClarification: false,
                  matchedSignals: ["llm:test"],
                }),
              },
            },
          ],
        }),
      }),
    );

    try {
      const { planCopilotIntent } = await import(
        "../../src/modules/copilot/llm-planner.js"
      );

      const result = await planCopilotIntent({
        actor,
        message: "what are Sarahs assignments?",
        nowIso: fixedNowIso,
        hasActiveRecordContext: false,
      });

      expect(result).toMatchObject({
        intent: "assignments.report",
        parameters: {
          employeeName: "Sarah",
          assignmentStatus: "open",
        },
      });
    } finally {
      env.cleanup();
    }
  });

  it("falls back to the deterministic router when OpenAI is unavailable", async () => {
    const env = createTestEnvironment({
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "true",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }),
    );

    try {
      const { planCopilotIntent } = await import(
        "../../src/modules/copilot/llm-planner.js"
      );

      const result = await planCopilotIntent({
        actor,
        message: "show me Sarah's assignments",
        nowIso: fixedNowIso,
        hasActiveRecordContext: false,
      });

      expect(result).toMatchObject({
        intent: "assignments.report",
        parameters: {
          employeeName: "Sarah",
          assignmentStatus: "open",
        },
      });
    } finally {
      env.cleanup();
    }
  });

  it("does not call OpenAI when the backend planner is disabled", async () => {
    const env = createTestEnvironment({
      OPENAI_API_KEY: "test-openai-key",
      AYA_LLM_PLANNER_ENABLED: "false",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { planCopilotIntent } = await import(
        "../../src/modules/copilot/llm-planner.js"
      );

      const result = await planCopilotIntent({
        actor,
        message: "what are my assignments",
        nowIso: fixedNowIso,
        hasActiveRecordContext: false,
      });

      expect(result).toMatchObject({
        intent: "assignments.report",
        parameters: {
          employeeName: "Hamza Paracha",
        },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      env.cleanup();
    }
  });
});
