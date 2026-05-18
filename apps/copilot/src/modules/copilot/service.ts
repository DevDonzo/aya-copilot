import { createId } from "../../db.js";
import { config } from "../../config.js";
import type {
  BlueRequestAuth,
  EmployeeIdentity,
  IntentName,
  IntentPlan,
} from "../../domain/types.js";
import {
  BLUE_AUTH_REQUIRED_MESSAGE,
  normalizeBlueRequestAuth,
  requireValidatedBlueRequestAuth,
} from "../blue/request-auth.js";
import { getActiveRecordContextForActor } from "../disambiguation/active-record-context.js";
import { rememberCopilotTurnMemory } from "./memory.js";
import {
  finalizeAgentResponseWithLlm,
  planCopilotAgent,
  planCopilotIntent,
  repairAgentStepWithLlm,
  type AgentPlan,
  type AgentStepPlan,
  type AgentStepResultSummary,
} from "./llm-planner.js";
import type { IntentPlannerRequest } from "./planner.js";
import {
  clearPendingRecordChoiceForActor,
  resolvePendingRecordChoice,
} from "../disambiguation/record-choices.js";
import { resolveActorIdentity } from "../identity/service.js";
import {
  addCommentToClient,
  answerReportingQuestion,
  assignRecord,
  assignTask,
  completeRecordAssignment,
  completeTaskAssignment,
  createClientRecord,
  getEmployeeDailyBrief,
  getClientComments,
  getClientDetail,
  getEmployeeAssignmentReport,
  getEmployeeActivityReport,
  getEmployeeDaySummary,
  getEmployeeFollowUpQueue,
  getEmployeeNotificationFeed,
  getEmployeeWorkload,
  getUserMentionsReport,
  getUserActivityHistory,
  getRecordActivityReport,
  getWorkspaceExceptionReport,
  getReportingOverview,
  getTeamFollowUpQueue,
  getTeamDaySummary,
  getWorkspaceActivityReport,
  getWorkspaceAttentionReport,
  moveClientToStage,
  setRecordDueDate,
  setTaskDueDate,
  searchClients,
} from "./actions.js";
import { getPreAuthSafetyBlock } from "./safety.js";
import { insertBotAuditLog } from "../../store/audit-store.js";
import {
  AppError,
  ExternalServiceError,
  PermissionError,
} from "../../app/errors.js";
import { runAyaToolAgent } from "./agent/runtime.js";
import type { AyaAgentToolTrace } from "./agent/types.js";

export interface InboundMessagePayload {
  transport?: string;
  conversationKey?: string;
  senderId?: string;
  senderLabel?: string;
  actorEmployeeId?: string;
  actorEmployeeEmail?: string;
  actorEmployeeName?: string;
  actorBlueTokenId?: string;
  actorBlueTokenSecret?: string;
  message: string;
}

export interface MessageResponse {
  matched: boolean;
  intent?: string;
  actor: EmployeeIdentity;
  responseText: string;
  clarificationRequired?: boolean;
  plan?: IntentPlan;
  data?: unknown;
}

interface PendingExecutionResult {
  intent: IntentName;
  responseText: string;
  data?: unknown;
}

export function resolvePayloadBlueAuth(
  payload: InboundMessagePayload,
): BlueRequestAuth | null {
  return normalizeBlueRequestAuth({
    tokenId: payload.actorBlueTokenId,
    tokenSecret: payload.actorBlueTokenSecret,
  });
}

export function redactPayloadForAudit(payload: InboundMessagePayload) {
  return {
    ...payload,
    actorBlueTokenId: payload.actorBlueTokenId ? "[redacted]" : undefined,
    actorBlueTokenSecret: payload.actorBlueTokenSecret
      ? "[redacted]"
      : undefined,
  };
}

export async function resolveActorFromPayload(
  payload: InboundMessagePayload,
): Promise<EmployeeIdentity> {
  const actor = await resolveActorIdentity({
    employeeId: payload.actorEmployeeId,
    employeeEmail: payload.actorEmployeeEmail,
    employeeName: payload.actorEmployeeName,
    transport: payload.transport,
    senderId: payload.senderId,
    autoLinkByEmail: true,
  });

  return {
    ...actor,
    email: actor.email ?? payload.actorEmployeeEmail ?? undefined,
  };
}

export async function planInboundMessage(payload: InboundMessagePayload) {
  const actor = await resolveActorFromPayload(payload);
  const transport = scopedTransport(payload.transport ?? "http", payload.conversationKey);
  const activeRecordContext = await getActiveRecordContextForActor(
    actor,
    transport,
  );

  const plan = await planCopilotIntent({
    actor,
    message: payload.message,
    nowIso: new Date().toISOString(),
    hasActiveRecordContext: Boolean(activeRecordContext),
  });

  return {
    actor,
    transport,
    hasActiveRecordContext: Boolean(activeRecordContext),
    activeRecordContext,
    plan,
  };
}

export async function handleInboundMessage(
  payload: InboundMessagePayload,
): Promise<MessageResponse> {
  const actor = await resolveActorFromPayload(payload);
  const transport = scopedTransport(payload.transport ?? "http", payload.conversationKey);
  const blueAuth = resolvePayloadBlueAuth(payload);
  const auditPayload = redactPayloadForAudit(payload);

  const safetyBlock = getPreAuthSafetyBlock(payload.message);
  if (safetyBlock) {
    await recordAudit({
      actor,
      transport,
      inboundText: payload.message,
      adapter: "pre-auth-safety",
      commandName: "safety.bulk_destructive_refusal",
      outcome: "blocked",
      responseText: safetyBlock.responseText,
      requestJson: {
        payload: auditPayload,
        code: safetyBlock.code,
      },
      responseJson: {
        code: safetyBlock.code,
      },
    });

    return {
      matched: true,
      actor,
      responseText: safetyBlock.responseText,
    };
  }

  const fastPathResponse = await respondToFastPathMessage({
    actor,
    transport,
    payload,
    auditPayload,
  });
  if (fastPathResponse) {
    return fastPathResponse;
  }

  const activeRecordContext = await getActiveRecordContextForActor(
    actor,
    transport,
  );

  const agentRequest = {
    actor,
    message: payload.message,
    nowIso: new Date().toISOString(),
    hasActiveRecordContext: Boolean(activeRecordContext),
  };

  const pending = await continuePendingRecordChoice(
    actor,
    transport,
    payload.message,
    blueAuth,
  );
  if (pending) {
    return await respondToPendingSelection({
      actor,
      transport,
      payload,
      auditPayload,
      pending,
    });
  }

  const agentRuntimeResponse = await executeAyaAgentRuntimeMessage({
    actor,
    transport,
    blueAuth,
    payload,
    auditPayload,
    request: agentRequest,
    activeRecordContext,
  });
  if (agentRuntimeResponse) {
    return agentRuntimeResponse;
  }

  const agentPlan = await planCopilotAgent(agentRequest);
  return await executeAgentMessage({
    actor,
    transport,
    blueAuth,
    payload,
    auditPayload,
    request: agentRequest,
    agentPlan,
  });
}

async function respondToFastPathMessage(input: {
  actor: EmployeeIdentity;
  transport: string;
  payload: InboundMessagePayload;
  auditPayload: ReturnType<typeof redactPayloadForAudit>;
}): Promise<MessageResponse | null> {
  const fastPath = detectFastPathMessage(input.payload.message, input.actor);
  if (!fastPath) {
    return null;
  }

  const plan = {
    intent: fastPath.intent,
    confidence: 1,
    parameters: {},
    requiresClarification: false,
    matchedSignals: ["fast-path"],
  } satisfies IntentPlan;

  await recordAudit({
    actor: input.actor,
    transport: input.transport,
    inboundText: input.payload.message,
    detectedIntent: fastPath.intent,
    adapter: "fast-path",
    outcome: "success",
    responseText: fastPath.responseText,
    commandName: "fast_path.respond",
    requestJson: {
      payload: input.auditPayload,
    },
    responseJson: {
      runtime: "fast-path",
      visibleResponseText: fastPath.responseText,
    },
  });

  await rememberCopilotTurnMemory({
    actor: input.actor,
    transport: input.transport,
    message: input.payload.message,
    responseText: fastPath.responseText,
    intent: fastPath.intent,
  });

  return {
    matched: true,
    intent: fastPath.intent,
    actor: input.actor,
    responseText: fastPath.responseText,
    plan,
  };
}

function detectFastPathMessage(
  message: string,
  actor: EmployeeIdentity,
): { intent: IntentName; responseText: string } | null {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (
    /^(?:hi|hello|hey|yo|good morning|good afternoon|good evening|thanks|thank you|thx)[.!?]*$/.test(
      normalized,
    )
  ) {
    return {
      intent: "help.overview",
      responseText:
        "Hi. I can help with Blue clients, tasks, comments, assignments, follow-ups, and reporting.",
    };
  }

  if (
    /^(?:help|what can you do|what do you do|what can aya do|show help|show me help|how can you help)[?!.]*$/.test(
      normalized,
    )
  ) {
    return {
      intent: "help.overview",
      responseText: [
        "I can help with Aya/Blue work like daily briefs, notifications, client status, comments, assignments, follow-ups, activity, and reporting.",
        "Examples:",
        "- start my day",
        "- show my assignments",
        "- updates on a client",
        "- show recent comments for a client",
        "- move a client to underwriting",
        "- assign a client or task",
        "- what changed today?",
      ].join("\n"),
    };
  }

  if (
    /^(?:who am i|who am i signed in as|what account am i using|what account am i signed in as|which account am i signed in as|show my identity)[?!.]*$/.test(
      normalized,
    )
  ) {
    return {
      intent: "identity.self",
      responseText: [
        `You are signed in as ${actor.displayName}.`,
        actor.email ? `Email: ${actor.email}` : null,
        actor.roleName ? `Role: ${actor.roleName}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (
    /\b(?:connect|set up|setup|save|add|enter|update)\b.*\b(?:blue token|blue tokens|blue credentials|blue credential|mcp settings)\b/.test(
      normalized,
    ) ||
    /\b(?:blue token|blue tokens|blue credentials|blue credential)\b.*\b(?:connect|set up|setup|save|add|enter|update)\b/.test(
      normalized,
    )
  ) {
    return {
      intent: "help.overview",
      responseText: BLUE_AUTH_REQUIRED_MESSAGE,
    };
  }

  return null;
}

interface AgentStepTrace extends AgentStepResultSummary {
  purpose?: string;
  repairedFromStepId?: string;
  data?: unknown;
}

interface AgentRunResult {
  plan: IntentPlan;
  responseText: string;
  data?: unknown;
  step: AgentStepPlan;
}

async function respondToPendingSelection(input: {
  actor: EmployeeIdentity;
  transport: string;
  payload: InboundMessagePayload;
  auditPayload: ReturnType<typeof redactPayloadForAudit>;
  pending: PendingExecutionResult;
}): Promise<MessageResponse> {
  const { actor, transport, payload, auditPayload, pending } = input;
  const selectionPlan: IntentPlan = {
    intent: pending.intent,
    confidence: 1,
    parameters: {
      selection: payload.message.trim(),
    },
    requiresClarification: false,
    matchedSignals: ["pending-record-choice"],
  };

  await recordAudit({
    actor,
    transport,
    inboundText: payload.message,
    detectedIntent: pending.intent,
    adapter: "pending-record-choice",
    outcome: "success",
    responseText: pending.responseText,
    commandName: getAuditCommandName(pending.intent),
    commandArgs: JSON.stringify(selectionPlan.parameters),
    requestJson: {
      payload: auditPayload,
      plan: selectionPlan,
    },
    responseJson: {
      plan: selectionPlan,
      data: pending.data,
    },
  });

  await rememberCopilotTurnMemory({
    actor,
    transport,
    message: payload.message,
    responseText: pending.responseText,
    intent: pending.intent,
  });

  return {
    matched: true,
    intent: pending.intent,
    actor,
    responseText: pending.responseText,
    plan: selectionPlan,
    data: pending.data,
  };
}

async function executeAyaAgentRuntimeMessage(input: {
  actor: EmployeeIdentity;
  transport: string;
  blueAuth: BlueRequestAuth | null;
  payload: InboundMessagePayload;
  auditPayload: ReturnType<typeof redactPayloadForAudit>;
  request: IntentPlannerRequest;
  activeRecordContext?: {
    recordId: string;
    recordTitle: string;
    listTitle?: string | null;
  } | null;
}): Promise<MessageResponse | null> {
  const runtime = config.AYA_CHAT_RUNTIME;
  if (runtime === "planner") {
    return null;
  }

  try {
    const result = await runAyaToolAgent({
      actor: input.actor,
      transport: input.transport,
      blueAuth: input.blueAuth,
      message: input.payload.message,
      nowIso: input.request.nowIso,
      hasActiveRecordContext: Boolean(input.request.hasActiveRecordContext),
      activeRecordContext: input.activeRecordContext,
    });

    if (!result.matched && runtime === "agent_with_planner_fallback") {
      await recordAudit({
        actor: input.actor,
        transport: input.transport,
        inboundText: input.payload.message,
        adapter: "ai-sdk-agent",
        outcome: "fallback",
        responseText:
          "AI SDK agent did not select a supported action; falling back to planner.",
        requestJson: {
          payload: input.auditPayload,
          runtime,
          model: result.model,
        },
        responseJson: {
          runtime: "ai-sdk-agent",
          model: result.model,
          toolCalls: result.toolCalls,
          usage: result.usage,
          recoveredFromError: result.recoveredFromError,
        },
      });
      return null;
    }

    const outcome = !result.matched
      ? "unmatched"
      : result.toolCalls.some((trace) => trace.outcome === "error")
        ? "error"
        : "success";
    const plan = result.intent
      ? {
          intent: result.intent,
          confidence: 0.95,
          parameters: {},
          requiresClarification: false,
          matchedSignals: ["ai-sdk-agent"],
        } satisfies IntentPlan
      : undefined;

    await recordAudit({
      actor: input.actor,
      transport: input.transport,
      inboundText: input.payload.message,
      detectedIntent: result.intent,
      adapter: "ai-sdk-agent",
      outcome,
      responseText: result.responseText,
      commandName: "agent.execute",
      commandArgs: JSON.stringify({
        runtime,
        model: result.model,
        toolCount: result.toolCalls.length,
        intents: result.toolCalls
          .map((trace) => trace.intent)
          .filter(Boolean),
      }),
      requestJson: {
        payload: input.auditPayload,
        runtime,
        model: result.model,
      },
      responseJson: {
        runtime: "ai-sdk-agent",
        model: result.model,
        steps: toAgentRuntimeAuditSteps(result.toolCalls),
        toolCalls: result.toolCalls,
        usage: result.usage,
        visibleResponseText: result.responseText,
      },
    });

    await rememberCopilotTurnMemory({
      actor: input.actor,
      transport: input.transport,
      message: input.payload.message,
      responseText: result.responseText,
      intent: result.intent,
    });

    return {
      matched: result.matched,
      intent: result.intent,
      actor: input.actor,
      responseText: result.responseText,
      plan,
      data: result.data,
    };
  } catch (error) {
    if (runtime === "agent_with_planner_fallback") {
      await recordAudit({
        actor: input.actor,
        transport: input.transport,
        inboundText: input.payload.message,
        adapter: "ai-sdk-agent",
        outcome: "fallback",
        responseText: formatAgentErrorMessage(error),
        requestJson: {
          payload: input.auditPayload,
          runtime,
        },
        responseJson: {
          runtime: "ai-sdk-agent",
          errorMessage: formatAgentErrorMessage(error),
        },
      });
      return null;
    }

    const responseText = formatAgentErrorMessage(error);
    await recordAudit({
      actor: input.actor,
      transport: input.transport,
      inboundText: input.payload.message,
      adapter: "ai-sdk-agent",
      outcome: "error",
      responseText,
      requestJson: {
        payload: input.auditPayload,
        runtime,
      },
      responseJson: {
        runtime: "ai-sdk-agent",
        errorMessage: responseText,
      },
    });

    return {
      matched: true,
      actor: input.actor,
      responseText,
    };
  }
}

function toAgentRuntimeAuditSteps(toolCalls: AyaAgentToolTrace[]) {
  return toolCalls.map((trace, index) => ({
    stepId: `tool_${index + 1}`,
    intent: trace.intent,
    parameters: trace.input,
    outcome: trace.outcome,
    responseText: trace.responseText,
    errorMessage: trace.errorMessage,
    data: trace.resultData ?? trace.resultSummary,
  }));
}

async function executeAgentMessage(input: {
  actor: EmployeeIdentity;
  transport: string;
  blueAuth: BlueRequestAuth | null;
  payload: InboundMessagePayload;
  auditPayload: ReturnType<typeof redactPayloadForAudit>;
  request: IntentPlannerRequest;
  agentPlan: AgentPlan | null;
}): Promise<MessageResponse> {
  const { actor, transport, blueAuth, payload, auditPayload, request, agentPlan } =
    input;

  if (!agentPlan) {
    const responseText =
      "I could not map that request to a supported Aya action yet.";
    await recordAudit({
      actor,
      transport,
      inboundText: payload.message,
      adapter: "aya-agent",
      outcome: "unmatched",
      responseText,
      requestJson: {
        payload: auditPayload,
        agentPlan: null,
      },
    });

    return {
      matched: false,
      actor,
      responseText,
    };
  }

  if (agentPlan.requiresClarification || agentPlan.steps.length === 0) {
    const responseText =
      agentPlan.clarificationQuestion ??
      "What exact record, person, or action should I use?";
    await recordAgentAudit({
      actor,
      transport,
      payload,
      auditPayload,
      agentPlan,
      steps: [],
      outcome: "needs_clarification",
      responseText,
    });
    await rememberCopilotTurnMemory({
      actor,
      transport,
      message: payload.message,
      responseText,
      intent: agentPlan.steps[0]?.intent,
    });

    return {
      matched: true,
      intent: agentPlan.steps[0]?.intent,
      actor,
      responseText,
      clarificationRequired: true,
    };
  }

  const stepTraces: AgentStepTrace[] = [];
  let firstPlan: IntentPlan | undefined;
  let lastSuccess: AgentRunResult | null = null;

  for (const step of agentPlan.steps.slice(0, 3)) {
    const result = await runAgentStep({
      actor,
      transport,
      blueAuth,
      payload,
      step,
    });

    firstPlan ??= result.plan;

    if (result.ok) {
      stepTraces.push(
        toStepTrace(
          step,
          "success",
          result.execution.responseText,
          undefined,
          result.execution.data,
        ),
      );
      lastSuccess = {
        plan: result.plan,
        responseText: result.execution.responseText,
        data: result.execution.data,
        step,
      };
      continue;
    }

    const errorMessage = formatAgentErrorMessage(result.error);
    stepTraces.push(toStepTrace(step, "error", undefined, errorMessage));

    if (isNonRepairableAgentError(result.error)) {
      return await finishAgentError({
        actor,
        transport,
        payload,
        auditPayload,
        agentPlan,
        steps: stepTraces,
        plan: firstPlan,
        responseText: errorMessage,
      });
    }

    const repair = await repairAgentStepWithLlm({
      request,
      agentPlan,
      failedStep: step,
      errorMessage,
      priorResults: stepTraces.map(stripTraceForPlanner),
    });

    if (repair?.action === "retry") {
      const retryResult = await runAgentStep({
        actor,
        transport,
        blueAuth,
        payload,
        step: repair.step,
      });
      firstPlan ??= retryResult.plan;

      if (retryResult.ok) {
        stepTraces.push({
          ...toStepTrace(
            repair.step,
            "success",
            retryResult.execution.responseText,
            undefined,
            retryResult.execution.data,
          ),
          repairedFromStepId: step.id,
        });
        lastSuccess = {
          plan: retryResult.plan,
          responseText: retryResult.execution.responseText,
          data: retryResult.execution.data,
          step: repair.step,
        };
        continue;
      }

      const retryErrorMessage = formatAgentErrorMessage(retryResult.error);
      stepTraces.push({
        ...toStepTrace(repair.step, "error", undefined, retryErrorMessage),
        repairedFromStepId: step.id,
      });

      return await finishAgentError({
        actor,
        transport,
        payload,
        auditPayload,
        agentPlan,
        steps: stepTraces,
        plan: firstPlan,
        responseText: retryErrorMessage,
      });
    }

    if (repair?.action === "clarify") {
      return await finishAgentClarification({
        actor,
        transport,
        payload,
        auditPayload,
        agentPlan,
        steps: stepTraces,
        plan: firstPlan,
        responseText: repair.clarificationQuestion,
      });
    }

    return await finishAgentError({
      actor,
      transport,
      payload,
      auditPayload,
      agentPlan,
      steps: stepTraces,
      plan: firstPlan,
      responseText: `I could not complete that yet: ${errorMessage}`,
    });
  }

  if (!lastSuccess) {
    const responseText = "I could not complete that yet.";
    await recordAgentAudit({
      actor,
      transport,
      payload,
      auditPayload,
      agentPlan,
      steps: stepTraces,
      outcome: "error",
      responseText,
    });
    return {
      matched: true,
      actor,
      responseText,
      plan: firstPlan,
    };
  }

  const successfulTexts = stepTraces
    .filter((step) => step.outcome === "success" && step.responseText)
    .map((step) => step.responseText as string);
  const fallbackResponse =
    successfulTexts.length > 1
      ? successfulTexts.join("\n\n")
      : lastSuccess.responseText;
  const finalResponse =
    (await finalizeAgentResponseWithLlm({
      request,
      agentPlan,
      results: stepTraces.map(stripTraceForPlanner),
    })) ??
    fallbackResponse ??
    "I completed the request, but Aya did not return a readable summary.";

  await recordAgentAudit({
    actor,
    transport,
    payload,
    auditPayload,
    agentPlan,
    steps: stepTraces,
    outcome: "success",
    responseText: finalResponse,
  });

  await rememberCopilotTurnMemory({
    actor,
    transport,
    message: payload.message,
    responseText: finalResponse,
    intent: lastSuccess.plan.intent,
  });

  return {
    matched: true,
    intent: lastSuccess.plan.intent,
    actor,
    responseText: finalResponse,
    plan: firstPlan ?? lastSuccess.plan,
    data: lastSuccess.data,
  };
}

async function runAgentStep(input: {
  actor: EmployeeIdentity;
  transport: string;
  blueAuth: BlueRequestAuth | null;
  payload: InboundMessagePayload;
  step: AgentStepPlan;
}): Promise<
  | {
      ok: true;
      plan: IntentPlan;
      execution: { responseText: string; data?: unknown };
    }
  | {
      ok: false;
      plan: IntentPlan;
      error: unknown;
    }
> {
  const plan = agentStepToIntentPlan(input.step);

  try {
    enforceIntentPermissions(input.actor, plan);
    await enforceBlueCredentialsForIntent(plan.intent, input.blueAuth, input.actor);
    const execution = await executePlan({
      actor: input.actor,
      transport: input.transport,
      blueAuth: input.blueAuth,
      payload: input.payload,
      plan,
    });
    return {
      ok: true,
      plan,
      execution: {
        ...execution,
        responseText: normalizeExecutionResponseText(execution),
      },
    };
  } catch (error) {
    return {
      ok: false,
      plan,
      error,
    };
  }
}

function normalizeExecutionResponseText(execution: {
  responseText?: string;
  data?: unknown;
}) {
  if (typeof execution.responseText === "string" && execution.responseText.trim()) {
    return execution.responseText;
  }

  const dataResponseText = extractDataResponseText(execution.data);
  if (dataResponseText) {
    return dataResponseText;
  }

  return "Aya completed the action, but no readable summary was returned.";
}

function extractDataResponseText(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  for (const key of ["responseText", "summaryText", "answerText"] as const) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function agentStepToIntentPlan(step: AgentStepPlan): IntentPlan {
  return {
    intent: step.intent,
    confidence: 0.95,
    parameters: step.parameters,
    requiresClarification: false,
    matchedSignals: ["aya-agent"],
  };
}

function toStepTrace(
  step: AgentStepPlan,
  outcome: "success" | "error",
  responseText?: string,
  errorMessage?: string,
  data?: unknown,
): AgentStepTrace {
  return {
    stepId: step.id,
    intent: step.intent,
    parameters: step.parameters,
    purpose: step.purpose,
    outcome,
    responseText,
    errorMessage,
    data,
  };
}

function stripTraceForPlanner(trace: AgentStepTrace): AgentStepResultSummary {
  return {
    stepId: trace.stepId,
    intent: trace.intent,
    parameters: trace.parameters,
    outcome: trace.outcome,
    responseText: trace.responseText,
    errorMessage: trace.errorMessage,
  };
}

async function finishAgentClarification(input: {
  actor: EmployeeIdentity;
  transport: string;
  payload: InboundMessagePayload;
  auditPayload: ReturnType<typeof redactPayloadForAudit>;
  agentPlan: AgentPlan;
  steps: AgentStepTrace[];
  plan?: IntentPlan;
  responseText: string;
}): Promise<MessageResponse> {
  await recordAgentAudit({
    actor: input.actor,
    transport: input.transport,
    payload: input.payload,
    auditPayload: input.auditPayload,
    agentPlan: input.agentPlan,
    steps: input.steps,
    outcome: "needs_clarification",
    responseText: input.responseText,
  });

  await rememberCopilotTurnMemory({
    actor: input.actor,
    transport: input.transport,
    message: input.payload.message,
    responseText: input.responseText,
    intent: input.plan?.intent,
  });

  return {
    matched: true,
    intent: input.plan?.intent,
    actor: input.actor,
    responseText: input.responseText,
    clarificationRequired: true,
    plan: input.plan,
  };
}

async function finishAgentError(input: {
  actor: EmployeeIdentity;
  transport: string;
  payload: InboundMessagePayload;
  auditPayload: ReturnType<typeof redactPayloadForAudit>;
  agentPlan: AgentPlan;
  steps: AgentStepTrace[];
  plan?: IntentPlan;
  responseText: string;
}): Promise<MessageResponse> {
  await recordAgentAudit({
    actor: input.actor,
    transport: input.transport,
    payload: input.payload,
    auditPayload: input.auditPayload,
    agentPlan: input.agentPlan,
    steps: input.steps,
    outcome: "error",
    responseText: input.responseText,
  });

  await rememberCopilotTurnMemory({
    actor: input.actor,
    transport: input.transport,
    message: input.payload.message,
    responseText: input.responseText,
    intent: input.plan?.intent,
  });

  return {
    matched: true,
    intent: input.plan?.intent,
    actor: input.actor,
    responseText: input.responseText,
    plan: input.plan,
  };
}

async function recordAgentAudit(input: {
  actor: EmployeeIdentity;
  transport: string;
  payload: InboundMessagePayload;
  auditPayload: ReturnType<typeof redactPayloadForAudit>;
  agentPlan: AgentPlan;
  steps: AgentStepTrace[];
  outcome: string;
  responseText: string;
}) {
  const lastIntent = [...input.steps].reverse().find((step) => step.intent)?.intent;

  await recordAudit({
    actor: input.actor,
    transport: input.transport,
    inboundText: input.payload.message,
    detectedIntent: lastIntent,
    adapter: "aya-agent",
    outcome: input.outcome,
    responseText: input.responseText,
    commandName: "agent.execute",
    commandArgs: JSON.stringify({
      goal: input.agentPlan.goal,
      stepCount: input.agentPlan.steps.length,
      intents: input.agentPlan.steps.map((step) => step.intent),
    }),
    requestJson: {
      payload: input.auditPayload,
      agentPlan: input.agentPlan,
    },
    responseJson: {
      agentPlan: input.agentPlan,
      steps: input.steps,
      visibleResponseText: input.responseText,
    },
  });
}

function formatAgentErrorMessage(error: unknown) {
  if (error instanceof PermissionError) {
    return "You do not have permission to do that.";
  }

  if (error instanceof ExternalServiceError) {
    return "I could not reach Blue right now. Try again in a minute. If this keeps happening, ask an admin to check Aya's Blue connection.";
  }

  if (error instanceof AppError) {
    return error.message;
  }

  return "Aya could not complete that request. Try again in a minute. If it keeps happening, ask an admin to check the Aya logs.";
}

function isNonRepairableAgentError(error: unknown) {
  if (error instanceof PermissionError) {
    return true;
  }

  if (error instanceof AppError) {
    return (
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      error.code === "AUTH_REQUIRED" ||
      error.code === "FORBIDDEN"
    );
  }

  return false;
}

function scopedTransport(transport: string, conversationKey?: string) {
  if (!conversationKey || /^\{\{.+\}\}$/.test(conversationKey.trim())) {
    return transport;
  }

  const normalized = conversationKey
    .trim()
    .replace(/[^\w:.-]+/g, "-")
    .slice(0, 120);

  return normalized ? `${transport}:${normalized}` : transport;
}

function enforceIntentPermissions(actor: EmployeeIdentity, plan: IntentPlan) {
  const role = actor.roleName ?? "employee";

  if (role === "admin") {
    return;
  }

  if (
    plan.intent === "activity.employee_report" ||
    plan.intent === "activity.record_report" ||
    plan.intent === "activity.workspace_report" ||
    plan.intent === "records.exception_report" ||
    plan.intent === "records.team_follow_up" ||
    plan.intent === "operations.attention_report" ||
    plan.intent === "summary.team_day" ||
    plan.intent === "summary.no_activity_day" ||
    plan.intent === "reporting.overview" ||
    plan.intent === "reporting.question" ||
    plan.intent === "activity.list"
  ) {
    throw new PermissionError();
  }

  if (
    plan.intent === "assignments.report" &&
    typeof plan.parameters.employeeName === "string" &&
    plan.parameters.employeeName.trim().toLowerCase() !==
      actor.displayName.trim().toLowerCase()
  ) {
    throw new PermissionError();
  }

  if (
    plan.intent === "notifications.feed" &&
    typeof plan.parameters.employeeName === "string" &&
    plan.parameters.employeeName.trim().toLowerCase() !==
      actor.displayName.trim().toLowerCase()
  ) {
    throw new PermissionError();
  }

  if (
    plan.intent === "records.list_assigned" &&
    typeof plan.parameters.employeeName === "string" &&
    plan.parameters.employeeName.trim().toLowerCase() !==
      actor.displayName.trim().toLowerCase()
  ) {
    throw new PermissionError();
  }

  if (
    plan.intent === "summary.employee_day" &&
    typeof plan.parameters.employeeName === "string" &&
    plan.parameters.employeeName.trim().toLowerCase() !==
      actor.displayName.trim().toLowerCase()
  ) {
    throw new PermissionError();
  }
}

function enforceBlueCredentialsForIntent(
  intent: IntentName,
  blueAuth: BlueRequestAuth | null,
  actor: EmployeeIdentity,
) {
  if (intent === "help.overview" || intent === "identity.self") {
    return;
  }

  return requireValidatedBlueRequestAuth(blueAuth, actor);
}

async function executePlan(input: {
  actor: EmployeeIdentity;
  transport: string;
  blueAuth: BlueRequestAuth | null;
  payload: InboundMessagePayload;
  plan: IntentPlan;
}) {
  const { actor, transport, blueAuth, plan } = input;

  switch (plan.intent) {
    case "help.overview": {
      return {
        responseText: [
          "I can help with Aya/Blue work like daily briefs, notifications, client status, comments, assignments, follow-ups, activity, and reporting.",
          "Examples:",
          "- start my day",
          "- show my notifications",
          "- show my assignments",
          "- show my mentions",
          "- what needs my attention today?",
          "- mark task income docs done",
          "- set due date for John Smith to 2026-05-10",
          "- what assignments does Sarah have?",
          "- who moved clients today?",
          "- updates on Fatima Hammou",
          "- show comments for Fatima Hammou",
          "- which records are missing phone?",
          "- move Fatima Hammou to underwriting",
          "- assign Fatima Hammou to Hamza",
        ].join("\n"),
        data: {
          examples: [
            "start my day",
            "show my notifications",
            "show my assignments",
            "what assignments does Sarah have?",
            "who moved clients today?",
            "updates on Fatima Hammou",
          ],
        },
      };
    }

    case "activity.employee_report": {
      const focus =
        plan.parameters.activityFocus === "comments" ||
        plan.parameters.activityFocus === "moves" ||
        plan.parameters.activityFocus === "creates" ||
        plan.parameters.activityFocus === "timeline"
          ? plan.parameters.activityFocus
          : "all";
      const result = await getEmployeeActivityReport({
        employeeId:
          typeof plan.parameters.employeeId === "string"
            ? plan.parameters.employeeId
            : undefined,
        employeeEmail:
          typeof plan.parameters.employeeEmail === "string"
            ? plan.parameters.employeeEmail
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : undefined,
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        dateLabel:
          typeof plan.parameters.dateLabel === "string"
            ? plan.parameters.dateLabel
            : undefined,
        focus,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.record_report": {
      const focus =
        plan.parameters.activityFocus === "comments" ||
        plan.parameters.activityFocus === "moves" ||
        plan.parameters.activityFocus === "timeline"
          ? plan.parameters.activityFocus
          : "all";
      const result = await getRecordActivityReport({
        recordId:
          typeof plan.parameters.recordId === "string"
            ? plan.parameters.recordId
            : undefined,
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        dateLabel:
          typeof plan.parameters.dateLabel === "string"
            ? plan.parameters.dateLabel
            : undefined,
        focus,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.workspace_report": {
      const focus =
        plan.parameters.activityFocus === "comments" ||
        plan.parameters.activityFocus === "moves" ||
        plan.parameters.activityFocus === "creates" ||
        plan.parameters.activityFocus === "timeline"
          ? plan.parameters.activityFocus
          : "all";
      const result = await getWorkspaceActivityReport({
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        dateLabel:
          typeof plan.parameters.dateLabel === "string"
            ? plan.parameters.dateLabel
            : undefined,
        focus,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.exception_report": {
      const focus =
        plan.parameters.exceptionFocus === "finance_amount" ||
        plan.parameters.exceptionFocus === "due_date" ||
        plan.parameters.exceptionFocus === "closing_date" ||
        plan.parameters.exceptionFocus === "assignee" ||
        plan.parameters.exceptionFocus === "client_name" ||
        plan.parameters.exceptionFocus === "email" ||
        plan.parameters.exceptionFocus === "phone" ||
        plan.parameters.exceptionFocus === "assignment"
          ? plan.parameters.exceptionFocus
          : "all";
      const result = await getWorkspaceExceptionReport({
        focus,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : undefined,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "identity.self": {
      const data = {
        employeeId: actor.employeeId,
        displayName: actor.displayName,
        email: actor.email ?? null,
        roleName: actor.roleName ?? null,
      };
      return {
        responseText: [
          `You are signed in as ${actor.displayName}.`,
          actor.email ? `Email: ${actor.email}` : null,
          actor.roleName ? `Role: ${actor.roleName}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        data,
      };
    }

    case "brief.daily": {
      const result = await getEmployeeDailyBrief({
        employeeId:
          typeof plan.parameters.employeeId === "string"
            ? plan.parameters.employeeId
            : undefined,
        employeeEmail:
          typeof plan.parameters.employeeEmail === "string"
            ? plan.parameters.employeeEmail
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "notifications.feed": {
      const result = await getEmployeeNotificationFeed({
        employeeId:
          typeof plan.parameters.employeeId === "string"
            ? plan.parameters.employeeId
            : undefined,
        employeeEmail:
          typeof plan.parameters.employeeEmail === "string"
            ? plan.parameters.employeeEmail
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.mentions": {
      const result = await getUserMentionsReport({
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        actor,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.user_history": {
      const result = await getUserActivityHistory({
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : undefined,
        dateStart:
          typeof plan.parameters.dateStart === "string"
            ? plan.parameters.dateStart
            : undefined,
        dateEnd:
          typeof plan.parameters.dateEnd === "string"
            ? plan.parameters.dateEnd
            : undefined,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "summary.employee_day": {
      const result = await getEmployeeDaySummary({
        employeeId:
          typeof plan.parameters.employeeId === "string"
            ? plan.parameters.employeeId
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        transport,
      });
      return {
        responseText: result.summaryText,
        data: result,
      };
    }

    case "summary.team_day": {
      const result = await getTeamDaySummary({});
      return {
        responseText: result.summaryText,
        data: result,
      };
    }

    case "summary.no_activity_day": {
      const result = await getTeamDaySummary({ inactiveOnly: true });
      return {
        responseText: result.summaryText,
        data: result,
      };
    }

    case "records.team_follow_up": {
      const result = await getTeamFollowUpQueue({
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "operations.attention_report": {
      const result = await getWorkspaceAttentionReport({
        date:
          typeof plan.parameters.date === "string"
            ? plan.parameters.date
            : undefined,
        limit:
          typeof plan.parameters.limit === "number"
            ? plan.parameters.limit
            : undefined,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.search": {
      const query = String(plan.parameters.query ?? "").trim();
      const result = await searchClients({
        query,
        limit: 5,
        actor,
        blueAuth,
        transport,
      });
      const responseText =
        result.items.length === 0
          ? `No current Blue records matched "${query}".`
          : result.items
              .map(
                (item, index) =>
                  `${index + 1}. ${item.title} (${item.listTitle})`,
              )
              .join("\n");
      return {
        responseText,
        data: result,
      };
    }

    case "records.detail": {
      const result = await getClientDetail({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        detailMode:
          plan.parameters.detailMode === "call_prep"
            ? "call_prep"
            : plan.parameters.detailMode === "briefing"
              ? "briefing"
              : "default",
        briefingFocus:
          plan.parameters.briefingFocus === "handoff" ||
          plan.parameters.briefingFocus === "blockers" ||
          plan.parameters.briefingFocus === "missing_docs" ||
          plan.parameters.briefingFocus === "general"
            ? plan.parameters.briefingFocus
            : undefined,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.list_assigned": {
      const result = await getEmployeeWorkload({
        employeeId:
          typeof plan.parameters.assigneeId === "string"
            ? plan.parameters.assigneeId
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "assignments.report": {
      const status =
        plan.parameters.assignmentStatus === "completed" ||
        plan.parameters.assignmentStatus === "all"
          ? plan.parameters.assignmentStatus
          : "open";
      const result = await getEmployeeAssignmentReport({
        employeeId:
          typeof plan.parameters.assigneeId === "string"
            ? plan.parameters.assigneeId
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        status,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.follow_up": {
      const result = await getEmployeeFollowUpQueue({
        employeeId:
          typeof plan.parameters.assigneeId === "string"
            ? plan.parameters.assigneeId
            : undefined,
        employeeName:
          typeof plan.parameters.employeeName === "string"
            ? plan.parameters.employeeName
            : actor.displayName,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.complete": {
      const result = await completeRecordAssignment({
        entityQuery:
          typeof plan.parameters.entityQuery === "string"
            ? plan.parameters.entityQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "tasks.complete": {
      const result = await completeTaskAssignment({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        taskQuery: String(plan.parameters.taskQuery ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.set_due_date": {
      const result = await setRecordDueDate({
        entityQuery:
          typeof plan.parameters.entityQuery === "string"
            ? plan.parameters.entityQuery
            : undefined,
        dueDate: String(plan.parameters.dueDate ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "tasks.set_due_date": {
      const result = await setTaskDueDate({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        taskQuery: String(plan.parameters.taskQuery ?? ""),
        dueDate: String(plan.parameters.dueDate ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "reporting.overview": {
      const result = await getReportingOverview({ auth: blueAuth });
      return {
        responseText: result.summaryText,
        data: result,
      };
    }

    case "reporting.question": {
      const question = String(plan.parameters.question ?? "").trim();
      const result = await answerReportingQuestion({
        question,
        auth: blueAuth,
      });
      return {
        responseText: result.answerText,
        data: result,
      };
    }

    case "comments.list_recent": {
      const result = await getClientComments({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "comments.create": {
      const result = await addCommentToClient({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        text: String(plan.parameters.text ?? ""),
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.move": {
      const result = await moveClientToStage({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        targetListQuery: String(plan.parameters.targetListQuery ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.assign": {
      const result = await assignRecord({
        entityQuery:
          typeof plan.parameters.entityQuery === "string"
            ? plan.parameters.entityQuery
            : undefined,
        assigneeName: String(plan.parameters.assigneeName ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "tasks.assign": {
      const result = await assignTask({
        recordQuery:
          typeof plan.parameters.recordQuery === "string"
            ? plan.parameters.recordQuery
            : undefined,
        taskQuery: String(
          plan.parameters.taskQuery ?? plan.parameters.entityQuery ?? "",
        ),
        assigneeName: String(plan.parameters.assigneeName ?? ""),
        useActiveRecordContext: plan.parameters.useActiveRecordContext === true,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.create": {
      const financeAmountRaw =
        typeof plan.parameters.financeAmount === "string"
          ? plan.parameters.financeAmount
          : undefined;
      const financeAmount = financeAmountRaw ? Number(financeAmountRaw) : undefined;
      const result = await createClientRecord({
        fullName:
          typeof plan.parameters.fullName === "string"
            ? plan.parameters.fullName
            : undefined,
        firstName:
          typeof plan.parameters.firstName === "string"
            ? plan.parameters.firstName
            : undefined,
        lastName:
          typeof plan.parameters.lastName === "string"
            ? plan.parameters.lastName
            : undefined,
        email:
          typeof plan.parameters.email === "string"
            ? plan.parameters.email
            : undefined,
        phone:
          typeof plan.parameters.phone === "string"
            ? plan.parameters.phone
            : undefined,
        financeAmount,
        notes:
          typeof plan.parameters.notes === "string"
            ? plan.parameters.notes
            : undefined,
        targetListQuery:
          typeof plan.parameters.targetListQuery === "string"
            ? plan.parameters.targetListQuery
            : undefined,
        actor,
        blueAuth,
        transport,
      });
      return {
        responseText: result.responseText,
        data: result,
      };
    }

    case "activity.list":
      return {
        responseText:
          "Aya has not enabled a standalone activity feed here yet. Ask for what changed today or what someone did today.",
        data: null,
      };
  }
}

async function continuePendingRecordChoice(
  actor: EmployeeIdentity,
  transport: string,
  message: string,
  blueAuth: BlueRequestAuth | null,
): Promise<PendingExecutionResult | null> {
  const pendingSelection = await resolvePendingRecordChoice({
    actor,
    transport,
    message,
  });
  if (!pendingSelection) {
    return null;
  }

  await clearPendingRecordChoiceForActor(actor, transport);
  const continuationIntent = getPendingContinuationIntent(
    pendingSelection.context.continuationAction,
  );
  if (continuationIntent) {
    try {
      await enforceBlueCredentialsForIntent(continuationIntent, blueAuth, actor);
    } catch (error) {
      return {
        intent: continuationIntent,
        responseText: formatAgentErrorMessage(error),
      };
    }
  }

  switch (pendingSelection.context.continuationAction) {
    case "get_client_detail":
    case "records.detail": {
      const result = await getClientDetail({
        recordId: pendingSelection.candidate.id,
        detailMode:
          pendingSelection.context.pendingParameters.detailMode === "call_prep"
            ? "call_prep"
            : pendingSelection.context.pendingParameters.detailMode === "briefing"
              ? "briefing"
              : "default",
        briefingFocus:
          pendingSelection.context.pendingParameters.briefingFocus ===
            "handoff" ||
          pendingSelection.context.pendingParameters.briefingFocus ===
            "blockers" ||
          pendingSelection.context.pendingParameters.briefingFocus ===
            "missing_docs" ||
          pendingSelection.context.pendingParameters.briefingFocus === "general"
            ? pendingSelection.context.pendingParameters.briefingFocus
            : undefined,
        actor,
        blueAuth,
        transport,
      });
      return {
        intent: "records.detail",
        responseText: result.responseText,
        data: result,
      };
    }

    case "comments.list_recent": {
      const result = await getClientComments({
        recordId: pendingSelection.candidate.id,
        actor,
        blueAuth,
        transport,
      });
      return {
        intent: "comments.list_recent",
        responseText: result.responseText,
        data: result,
      };
    }

    case "comments.create": {
      const text =
        typeof pendingSelection.context.pendingParameters.text === "string"
          ? pendingSelection.context.pendingParameters.text
          : "";
      const result = await addCommentToClient({
        recordId: pendingSelection.candidate.id,
        text,
        actor,
        blueAuth,
        transport,
      });
      return {
        intent: "comments.create",
        responseText: result.responseText,
        data: result,
      };
    }

    case "records.move": {
      const targetListQuery =
        typeof pendingSelection.context.pendingParameters.targetListQuery ===
        "string"
          ? pendingSelection.context.pendingParameters.targetListQuery
          : "";
      const result = await moveClientToStage({
        recordId: pendingSelection.candidate.id,
        targetListQuery,
        actor,
        blueAuth,
        transport,
      });
      return {
        intent: "records.move",
        responseText: result.responseText,
        data: result,
      };
    }

    default:
      return null;
  }
}

function getPendingContinuationIntent(
  continuationAction: string,
): IntentName | null {
  switch (continuationAction) {
    case "get_client_detail":
    case "records.detail":
      return "records.detail";
    case "comments.list_recent":
      return "comments.list_recent";
    case "comments.create":
      return "comments.create";
    case "records.move":
      return "records.move";
    default:
      return null;
  }
}

async function recordAudit(input: {
  actor: EmployeeIdentity;
  transport: string;
  inboundText: string;
  detectedIntent?: string;
  adapter: string;
  outcome: string;
  responseText: string;
  commandName?: string;
  commandArgs?: string;
  requestJson?: unknown;
  responseJson?: unknown;
}) {
  await insertBotAuditLog({
    id: createId("audit"),
    employeeId: input.actor.blueUserId,
    transport: input.transport,
    inboundText: input.inboundText,
    detectedIntent: input.detectedIntent,
    adapter: input.adapter,
    commandName: input.commandName,
    commandArgs: input.commandArgs,
    outcome: input.outcome,
    responseText: input.responseText,
    requestJson: input.requestJson,
    responseJson: input.responseJson,
  });
}

function getAuditAdapter(intent: IntentName) {
  switch (intent) {
    case "help.overview":
    case "identity.self":
    case "brief.daily":
    case "notifications.feed":
    case "summary.employee_day":
    case "assignments.report":
    case "records.complete":
    case "tasks.complete":
    case "records.set_due_date":
    case "tasks.set_due_date":
    case "activity.employee_report":
    case "activity.record_report":
    case "activity.workspace_report":
    case "records.exception_report":
    case "operations.attention_report":
    case "summary.team_day":
    case "summary.no_activity_day":
      return "local";
    case "records.search":
      return "local-cache";
    case "reporting.overview":
    case "reporting.question":
      return "blue-reporting";
    default:
      return "aya-service";
  }
}

function getAuditCommandName(intent: IntentName) {
  switch (intent) {
    case "help.overview":
      return "helpOverview";
    case "brief.daily":
      return "dailyBrief";
    case "records.move":
      return "moveTodo";
    case "records.create":
      return "createTodo";
    case "comments.create":
      return "createComment";
    case "comments.list_recent":
    case "records.detail":
      return "getBlueRecordDetail";
    case "records.list_assigned":
    case "records.follow_up":
    case "records.team_follow_up":
    case "operations.attention_report":
      return "todoQueries.todos";
    case "records.complete":
      return "updateTodos";
    case "assignments.report":
      return "checklistItems";
    case "tasks.complete":
      return "editChecklistItem";
    case "records.set_due_date":
      return "updateTodos";
    case "tasks.set_due_date":
      return "updateChecklistItemDueDate";
    case "reporting.overview":
      return "getReportingOverview";
    case "reporting.question":
      return "answerReportingQuestion";
    case "activity.employee_report":
      return "employeeActivityReport";
    case "activity.record_report":
      return "recordActivityReport";
    case "activity.workspace_report":
      return "workspaceActivityReport";
    case "records.exception_report":
      return "workspaceExceptionReport";
    default:
      return intent;
  }
}
