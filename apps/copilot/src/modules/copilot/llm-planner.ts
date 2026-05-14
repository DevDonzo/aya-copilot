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

const agentStepSchema = z.object({
  id: z.string().optional(),
  intent: z.enum(SUPPORTED_INTENTS),
  parameters: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
  purpose: z.string().optional(),
});

const agentPlanSchema = z.object({
  goal: z.string().default("Complete the user's Aya/Blue request."),
  confidence: z.number().min(0).max(1).default(0.8),
  requiresClarification: z.boolean().default(false),
  clarificationQuestion: z.string().optional(),
  steps: z.array(agentStepSchema).max(3).default([]),
  finalResponseInstructions: z.string().optional(),
  matchedSignals: z.array(z.string()).default(["llm-agent-planner"]),
});

const repairSchema = z.object({
  action: z.enum(["retry", "clarify", "stop"]),
  clarificationQuestion: z.string().optional(),
  step: agentStepSchema.optional(),
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

export interface AgentStepPlan {
  id: string;
  intent: IntentName;
  parameters: Record<string, string | number | boolean | undefined>;
  purpose?: string;
}

export interface AgentPlan {
  goal: string;
  confidence: number;
  requiresClarification: boolean;
  clarificationQuestion?: string;
  steps: AgentStepPlan[];
  finalResponseInstructions?: string;
  matchedSignals: string[];
}

export interface AgentStepResultSummary {
  stepId: string;
  intent: IntentName;
  parameters: Record<string, string | number | boolean | undefined>;
  outcome: "success" | "error";
  responseText?: string;
  errorMessage?: string;
}

export async function planCopilotIntent(
  request: IntentPlannerRequest,
): Promise<IntentPlan | null> {
  const deterministicPlan = planEmployeeIntent(request);
  if (deterministicPlan && shouldUseDeterministicAgentPlan(deterministicPlan)) {
    return {
      ...deterministicPlan,
      matchedSignals: [
        ...deterministicPlan.matchedSignals,
        "deterministic-priority",
      ],
    };
  }

  const llmPlan = await planEmployeeIntentWithLlm(request);
  if (llmPlan) {
    return llmPlan;
  }

  return deterministicPlan;
}

export async function planCopilotAgent(
  request: IntentPlannerRequest,
): Promise<AgentPlan | null> {
  const compoundPlan = buildDeterministicCompoundAgentPlan(request);
  if (compoundPlan) {
    return compoundPlan;
  }

  const deterministicPlan = planEmployeeIntent(request);
  if (deterministicPlan && shouldUseDeterministicAgentPlan(deterministicPlan)) {
    return toSingleStepAgentPlan(
      deterministicPlan,
      "deterministic-priority",
    );
  }

  const llmPlan = await planAgentWithLlm(request);
  if (llmPlan) {
    return llmPlan;
  }

  if (!deterministicPlan) {
    return null;
  }

  return toSingleStepAgentPlan(deterministicPlan, "deterministic-fallback");
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

async function planAgentWithLlm(
  request: IntentPlannerRequest,
): Promise<AgentPlan | null> {
  const content = await callPlannerLlm(
    buildAgentPlannerSystemPrompt(),
    {
      message: request.message,
      actor: {
        displayName: request.actor.displayName,
        roleName: request.actor.roleName ?? "employee",
        email: request.actor.email ?? null,
      },
      nowIso: request.nowIso,
      hasActiveRecordContext: request.hasActiveRecordContext === true,
      maxSteps: 3,
    },
  );
  if (!content) {
    return null;
  }

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

  const parsed = agentPlanSchema.safeParse(raw);
  if (!parsed.success || parsed.data.confidence < 0.72) {
    return null;
  }

  return {
    goal: parsed.data.goal,
    confidence: parsed.data.confidence,
    requiresClarification: parsed.data.requiresClarification,
    clarificationQuestion: parsed.data.clarificationQuestion,
    finalResponseInstructions: parsed.data.finalResponseInstructions,
    matchedSignals: [...parsed.data.matchedSignals, "llm-agent-planner"],
    steps: parsed.data.steps.slice(0, 3).map((step, index) => ({
      id: step.id?.trim() || `step_${index + 1}`,
      intent: step.intent as IntentName,
      parameters: cleanParameters(step.parameters),
      purpose: step.purpose,
    })),
  };
}

export async function repairAgentStepWithLlm(input: {
  request: IntentPlannerRequest;
  agentPlan: AgentPlan;
  failedStep: AgentStepPlan;
  errorMessage: string;
  priorResults: AgentStepResultSummary[];
}): Promise<
  | { action: "retry"; step: AgentStepPlan }
  | { action: "clarify"; clarificationQuestion: string }
  | { action: "stop" }
  | null
> {
  const content = await callPlannerLlm(buildAgentRepairSystemPrompt(), {
    message: input.request.message,
    actor: {
      displayName: input.request.actor.displayName,
      roleName: input.request.actor.roleName ?? "employee",
      email: input.request.actor.email ?? null,
    },
    agentGoal: input.agentPlan.goal,
    failedStep: input.failedStep,
    errorMessage: input.errorMessage,
    priorResults: input.priorResults,
  });
  if (!content) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }

  const parsed = repairSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.action === "retry" && parsed.data.step) {
    return {
      action: "retry",
      step: {
        id: parsed.data.step.id?.trim() || `${input.failedStep.id}_repair`,
        intent: parsed.data.step.intent as IntentName,
        parameters: cleanParameters(parsed.data.step.parameters),
        purpose: parsed.data.step.purpose,
      },
    };
  }

  if (parsed.data.action === "clarify") {
    return {
      action: "clarify",
      clarificationQuestion:
        parsed.data.clarificationQuestion ??
        "Which exact record or action should I use?",
    };
  }

  return { action: "stop" };
}

export async function finalizeAgentResponseWithLlm(input: {
  request: IntentPlannerRequest;
  agentPlan: AgentPlan;
  results: AgentStepResultSummary[];
}): Promise<string | null> {
  const content = await callPlannerLlm(buildAgentFinalizerSystemPrompt(), {
    message: input.request.message,
    actor: {
      displayName: input.request.actor.displayName,
      roleName: input.request.actor.roleName ?? "employee",
      email: input.request.actor.email ?? null,
    },
    goal: input.agentPlan.goal,
    finalResponseInstructions: input.agentPlan.finalResponseInstructions ?? null,
    results: input.results.map((result) => ({
      intent: result.intent,
      outcome: result.outcome,
      responseText: result.responseText,
      errorMessage: result.errorMessage,
    })),
  });
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as { responseText?: unknown };
    return typeof parsed.responseText === "string"
      ? parsed.responseText.trim()
      : null;
  } catch {
    return null;
  }
}

function cleanParameters(
  value: Record<string, string | number | boolean | null>,
) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null),
  ) as Record<string, string | number | boolean | undefined>;
}

function shouldUseDeterministicAgentPlan(plan: IntentPlan) {
  if (plan.requiresClarification) {
    return true;
  }

  return (
    plan.intent === "notifications.feed" ||
    plan.intent === "records.team_follow_up" ||
    plan.intent === "summary.team_day" ||
    plan.intent === "summary.no_activity_day" ||
    plan.intent === "activity.workspace_report" ||
    plan.intent === "activity.record_report" ||
    plan.intent === "records.exception_report" ||
    plan.intent === "comments.list_recent" ||
    plan.intent === "records.detail" ||
    plan.intent === "records.move" ||
    plan.intent === "records.assign" ||
    plan.intent === "records.complete" ||
    plan.intent === "records.set_due_date" ||
    plan.intent === "comments.create"
  );
}

function toSingleStepAgentPlan(plan: IntentPlan, signal: string): AgentPlan {
  return {
    goal: "Complete the user's Aya/Blue request.",
    confidence: plan.confidence,
    requiresClarification: plan.requiresClarification,
    clarificationQuestion: plan.clarificationQuestion,
    steps: plan.requiresClarification
      ? []
      : [
          {
            id: "step_1",
            intent: plan.intent,
            parameters: plan.parameters,
            purpose: "Run the supported Aya action.",
          },
        ],
    matchedSignals: [...plan.matchedSignals, signal],
  };
}

function buildDeterministicCompoundAgentPlan(
  request: IntentPlannerRequest,
): AgentPlan | null {
  const message = request.message.trim();
  const commentsAndFollowUp = message.match(
    /^(?:find|search(?: for)?|look up)\s+(.+?),?\s+summarize\s+(?:recent\s+)?comments?,?\s+(?:then\s+)?(?:tell me\s+)?(?:the\s+)?next follow[- ]?up[.?!]?$/i,
  );
  if (commentsAndFollowUp?.[1]) {
    const recordQuery = commentsAndFollowUp[1].trim();
    return {
      goal: "Find the record, summarize recent comments, and identify a practical next follow-up.",
      confidence: 0.94,
      requiresClarification: false,
      steps: [
        {
          id: "step_1",
          intent: "comments.list_recent",
          parameters: { recordQuery },
          purpose: "Summarize recent comments for the exact record.",
        },
        {
          id: "step_2",
          intent: "records.detail",
          parameters: {
            recordQuery,
            detailMode: "briefing",
            briefingFocus: "general",
          },
          purpose: "Use record details to identify likely next follow-up context.",
        },
      ],
      finalResponseInstructions:
        "Summarize the comments and state the most practical next follow-up from the returned record details. If no explicit next follow-up exists, say that clearly.",
      matchedSignals: ["deterministic-compound:comments-follow-up"],
    };
  }

  const searchAndCallPrep = message.match(
    /^(?:search(?: for)?|find|look up)\s+(.+?)\s+and\s+(?:prep|prepare|brief)\s+me\s+(?:for\s+)?(?:a\s+)?call[.?!]?$/i,
  );
  if (searchAndCallPrep?.[1]) {
    return {
      goal: "Find the record and prepare a concise call brief.",
      confidence: 0.94,
      requiresClarification: false,
      steps: [
        {
          id: "step_1",
          intent: "records.detail",
          parameters: {
            recordQuery: searchAndCallPrep[1].trim(),
            detailMode: "call_prep",
          },
          purpose: "Load the record through the direct record detail path for call prep.",
        },
      ],
      finalResponseInstructions:
        "Return the call prep from the record detail. Do not mention internal search or cache behavior.",
      matchedSignals: ["deterministic-compound:search-call-prep"],
    };
  }

  return null;
}

async function callPlannerLlm(
  systemPrompt: string,
  payload: unknown,
): Promise<string | null> {
  if (!config.AYA_LLM_PLANNER_ENABLED || !config.OPENAI_API_KEY) {
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
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
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

    return parsedResponse.data.choices[0]?.message.content ?? null;
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

function buildAgentPlannerSystemPrompt() {
  return [
    "You are Aya Copilot's bounded agent planner. Return only JSON.",
    "Do not answer the user. Do not call tools. Create up to 3 safe Aya action steps.",
    "If unsupported or unsafe, return {\"supported\":false}. Bulk destructive requests are unsafe, including moving, deleting, completing, assigning, or updating all/every records, clients, files, leads, tasks, or assignments.",
    "If one missing detail blocks safe execution, set requiresClarification true and ask one concise question.",
    "Use filler words like 'show me' and 'please' only as conversational filler.",
    "For named employees, set employeeName to the named employee. For clear self requests, use the actor.",
    "For record/client/file follow-ups like 'this client' or 'it', set useActiveRecordContext true.",
    "Use assignments.report for assigned checklist/task lists. Default assignmentStatus to open unless the user explicitly asks for all/completed/done.",
    "Use records.list_assigned for workload/open files/what someone is working on.",
    "Use records.follow_up for overdue, stale, due-today, or priority follow-up queues.",
    "Use comments.create, records.move, records.assign, records.set_due_date, tasks.complete, and records.complete for writes only when the user clearly asks.",
    "For compound requests, sequence read steps before write or final summary steps. Do not include a separate final-answer step.",
    "Return JSON shape: {\"goal\":\"Find Sarah overdue work and draft follow-up\",\"confidence\":0.91,\"requiresClarification\":false,\"steps\":[{\"id\":\"step_1\",\"intent\":\"records.follow_up\",\"parameters\":{\"employeeName\":\"Sarah\"},\"purpose\":\"Find overdue work\"}],\"finalResponseInstructions\":\"Prioritize overdue work and draft a short follow-up.\"}.",
    `Supported intents: ${SUPPORTED_INTENTS.join(", ")}.`,
  ].join("\n");
}

function buildAgentRepairSystemPrompt() {
  return [
    "You repair one failed Aya agent step. Return only JSON.",
    "Choose action retry, clarify, or stop.",
    "Retry only if the error can be fixed by changing the intent parameters using the original user request or prior results.",
    "Clarify if the error is ambiguity, missing record/client/task/list, or missing user choice.",
    "Stop if the request is unsupported or unsafe.",
    "Return JSON shape for retry: {\"action\":\"retry\",\"step\":{\"intent\":\"records.detail\",\"parameters\":{\"recordQuery\":\"Exact Client\"}}}.",
    "Return JSON shape for clarify: {\"action\":\"clarify\",\"clarificationQuestion\":\"Which John Smith file should I use?\"}.",
  ].join("\n");
}

function buildAgentFinalizerSystemPrompt() {
  return [
    "You write Aya Copilot's final user-facing response. Return only JSON.",
    "Do not reveal internal plan, tool names, retries, hidden reasoning, JSON, or audit trace.",
    "Be concise, operational, and specific. Use the action results as ground truth.",
    "If a write succeeded, clearly confirm what changed.",
    "If the user asked for a draft, include the draft.",
    "Return JSON shape: {\"responseText\":\"...\"}.",
  ].join("\n");
}
