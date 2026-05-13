import { z } from "zod";

import { config } from "../../config.js";
import type { IntentName, IntentPlan } from "../../domain/types.js";
import {
  planEmployeeIntent,
  type IntentPlannerRequest,
} from "./planner.js";

const SUPPORTED_INTENTS = [
  "help.overview",
  "identity.self",
  "brief.daily",
  "notifications.feed",
  "activity.employee_report",
  "activity.record_report",
  "activity.workspace_report",
  "assignments.report",
  "records.exception_report",
  "records.list_assigned",
  "records.follow_up",
  "records.team_follow_up",
  "records.complete",
  "records.search",
  "records.detail",
  "records.create",
  "records.move",
  "records.assign",
  "records.set_due_date",
  "tasks.assign",
  "tasks.complete",
  "tasks.set_due_date",
  "comments.list_recent",
  "comments.create",
  "activity.list",
  "activity.mentions",
  "activity.user_history",
  "summary.employee_day",
  "summary.team_day",
  "summary.no_activity_day",
  "reporting.overview",
  "reporting.question",
] as const;

const planSchema = z.object({
  intent: z.enum(SUPPORTED_INTENTS),
  confidence: z.number().min(0).max(1),
  parameters: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
  requiresClarification: z.boolean().default(false),
  clarificationQuestion: z.string().optional(),
  matchedSignals: z.array(z.string()).default(["llm-planner"]),
});

const chatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable(),
      }),
    }),
  ),
});

export async function planCopilotIntent(
  request: IntentPlannerRequest,
): Promise<IntentPlan | null> {
  const llmPlan = await planEmployeeIntentWithLlm(request);
  if (llmPlan) {
    return llmPlan;
  }

  return planEmployeeIntent(request);
}

export async function planEmployeeIntentWithLlm(
  request: IntentPlannerRequest,
): Promise<IntentPlan | null> {
  if (
    !config.AYA_LLM_PLANNER_ENABLED ||
    !config.OPENAI_API_KEY ||
    !request.message.trim()
  ) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.AYA_LLM_PLANNER_TIMEOUT_MS,
  );

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.AYA_LLM_PLANNER_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildPlannerSystemPrompt(),
          },
          {
            role: "user",
            content: JSON.stringify({
              message: request.message,
              actor: {
                displayName: request.actor.displayName,
                roleName: request.actor.roleName ?? "employee",
                email: request.actor.email ?? null,
              },
              nowIso: request.nowIso,
              hasActiveRecordContext: request.hasActiveRecordContext === true,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const parsedResponse = chatCompletionSchema.safeParse(await response.json());
    if (!parsedResponse.success) {
      return null;
    }

    const content = parsedResponse.data.choices[0]?.message.content;
    if (!content) {
      return null;
    }

    return normalizeLlmPlan(content, request);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLlmPlan(
  content: string,
  request: IntentPlannerRequest,
): IntentPlan | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }

  if (
    raw &&
    typeof raw === "object" &&
    "supported" in raw &&
    (raw as { supported?: unknown }).supported === false
  ) {
    return null;
  }

  const parsed = planSchema.safeParse(raw);
  if (!parsed.success || parsed.data.confidence < 0.72) {
    return null;
  }

  const parameters = Object.fromEntries(
    Object.entries(parsed.data.parameters).filter(([, value]) => value !== null),
  ) as Record<string, string | number | boolean | undefined>;

  const plan: IntentPlan = {
    intent: parsed.data.intent as IntentName,
    confidence: parsed.data.confidence,
    parameters,
    requiresClarification: parsed.data.requiresClarification,
    clarificationQuestion: parsed.data.clarificationQuestion,
    matchedSignals: [...parsed.data.matchedSignals, "llm-planner"],
  };

  return applyPlanDefaults(plan, request);
}

function applyPlanDefaults(
  plan: IntentPlan,
  request: IntentPlannerRequest,
): IntentPlan {
  let nextPlan = plan;

  if (
    (plan.intent === "assignments.report" ||
      plan.intent === "records.list_assigned" ||
      plan.intent === "records.follow_up" ||
      plan.intent === "notifications.feed" ||
      plan.intent === "summary.employee_day") &&
    typeof plan.parameters.employeeName !== "string" &&
    typeof plan.parameters.employeeId !== "string" &&
    typeof plan.parameters.employeeEmail !== "string"
  ) {
    nextPlan = {
      ...plan,
      parameters: {
        ...plan.parameters,
        employeeName: request.actor.displayName,
      },
    };
  }

  if (nextPlan.intent === "assignments.report") {
    const message = request.message.toLowerCase();
    const explicitlyCompleted = /\b(completed?|done|finished?|closed)\b/.test(
      message,
    );
    const explicitlyAll =
      /\b(all|everything)\b/.test(message) ||
      /\bopen\s+and\s+(?:completed?|done|closed)\b/.test(message) ||
      /\bincluding\s+(?:completed?|done|closed)\b/.test(message);
    const assignmentStatus = explicitlyCompleted
      ? "completed"
      : explicitlyAll
        ? "all"
        : "open";

    nextPlan = {
      ...nextPlan,
      parameters: {
        ...nextPlan.parameters,
        assignmentStatus,
      },
    };
  }

  return nextPlan;
}

function buildPlannerSystemPrompt() {
  return [
    "You are Aya Copilot's intent planner. Return only JSON.",
    "Do not answer the user. Do not call tools. Only classify the request into one supported intent.",
    "If the request is unsupported or too ambiguous, return {\"supported\":false}.",
    "Treat words like 'show me', 'tell me', 'please', and 'can you' as filler. If another person is named, that person is the target, not the actor.",
    "Use the actor only for clear self requests like 'my assignments', 'what am I working on', 'start my day', or 'show my notifications'.",
    "For admin questions about another employee, set employeeName to the named employee.",
    "For client/file/record questions, set recordQuery or entityQuery to the client/file name, not the employee name unless the user clearly asks for an employee report.",
    "For follow-up questions, use records.follow_up for one employee and records.team_follow_up for the whole team.",
    "For assignment/checklist/task list questions, use assignments.report. Default assignmentStatus to open unless the user explicitly asks for completed/done/all/everything.",
    "For workload/open files/working-on questions, use records.list_assigned.",
    "For mentions/notifications, use activity.mentions or notifications.feed.",
    "For comments, use comments.list_recent to read and comments.create to add a note/comment.",
    "For moves, use records.move with recordQuery and targetListQuery.",
    "For due dates, use records.set_due_date or tasks.set_due_date.",
    "For completing work, use records.complete or tasks.complete.",
    "Return JSON shape: {\"intent\":\"assignments.report\",\"confidence\":0.91,\"parameters\":{\"employeeName\":\"Sarah\",\"assignmentStatus\":\"open\"},\"requiresClarification\":false,\"matchedSignals\":[\"llm\"]}.",
    `Supported intents: ${SUPPORTED_INTENTS.join(", ")}.`,
  ].join("\n");
}
