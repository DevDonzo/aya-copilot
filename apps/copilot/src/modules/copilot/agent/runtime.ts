import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, type LanguageModelUsage } from "ai";

import { config } from "../../../config.js";
import { buildAyaAgentPrompt, buildAyaAgentSystemPrompt } from "./system-prompt.js";
import { createAyaAgentTools } from "./tool-registry.js";
import { AyaAgentRuntimeUnavailableError } from "./policy.js";
import type {
  AyaAgentContext,
  AyaAgentResult,
  AyaAgentToolTrace,
} from "./types.js";

export async function runAyaToolAgent(
  context: AyaAgentContext,
): Promise<AyaAgentResult> {
  if (!config.OPENAI_API_KEY) {
    throw new AyaAgentRuntimeUnavailableError(
      "AYA_CHAT_RUNTIME is set to agent mode, but OPENAI_API_KEY is not configured.",
    );
  }

  const toolCalls: AyaAgentToolTrace[] = [];
  let result: {
    text: string;
    totalUsage?: LanguageModelUsage;
  };
  try {
    result = await generateText({
      model: openai(config.AYA_AGENT_MODEL),
      system: buildAyaAgentSystemPrompt(context),
      prompt: buildAyaAgentPrompt(context),
      tools: createAyaAgentTools(context, toolCalls),
      prepareStep: ({ stepNumber }) => ({
        toolChoice: stepNumber === 0 ? "required" : "auto",
      }),
      stopWhen: stepCountIs(config.AYA_AGENT_MAX_STEPS),
      maxRetries: 0,
      temperature: 0,
      timeout: config.AYA_AGENT_TIMEOUT_MS,
      experimental_include: {
        requestBody: false,
        responseBody: false,
      },
    });
  } catch (error) {
    const recovered = buildRecoveredAgentResult(toolCalls, error);
    if (recovered) {
      return recovered;
    }

    throw error;
  }

  const lastToolCall = [...toolCalls].reverse().find((trace) => trace.intent);
  const fallbackResponseText = getFallbackResponseText(toolCalls);
  const responseText =
    result.text.trim() ||
    fallbackResponseText ||
    "I completed the request, but Aya did not return a readable summary.";

  return {
    matched: toolCalls.some((trace) => Boolean(trace.intent)),
    intent: lastToolCall?.intent,
    responseText,
    data: lastToolCall?.resultSummary,
    model: config.AYA_AGENT_MODEL,
    toolCalls,
    usage: toAgentUsage(result.totalUsage),
  };
}

export function isAyaAgentRuntimeUnavailable(error: unknown) {
  return error instanceof AyaAgentRuntimeUnavailableError;
}

function getFallbackResponseText(toolCalls: AyaAgentToolTrace[]) {
  const latestReadableTrace = [...toolCalls]
    .reverse()
    .find((trace) => trace.responseText || trace.errorMessage);

  return (
    latestReadableTrace?.responseText ??
    latestReadableTrace?.errorMessage ??
    null
  );
}

function buildRecoveredAgentResult(
  toolCalls: AyaAgentToolTrace[],
  error: unknown,
): AyaAgentResult | null {
  const lastToolCall = [...toolCalls].reverse().find((trace) => trace.intent);
  const responseText = getFallbackResponseText(toolCalls);

  if (!lastToolCall || !responseText) {
    return null;
  }

  return {
    matched: true,
    intent: lastToolCall.intent,
    responseText,
    data: lastToolCall.resultSummary,
    model: config.AYA_AGENT_MODEL,
    toolCalls,
    recoveredFromError: formatRecoveredError(error),
  };
}

function formatRecoveredError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function toAgentUsage(
  usage: LanguageModelUsage | undefined,
): AyaAgentResult["usage"] {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}
