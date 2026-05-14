import type { AyaAgentContext } from "./types.js";

export function buildAyaAgentSystemPrompt(context: AyaAgentContext) {
  return [
    "You are Aya, an operations assistant for Aya Financial.",
    "Use tools whenever you need Blue CRM data or need to perform an action. Do not invent Blue data.",
    "Never claim a write succeeded unless a tool result says it succeeded.",
    "If a tool reports missing Blue write credentials, explain that personal Blue credentials are required.",
    "Ask one short clarification question when a record, employee, or action is ambiguous.",
    "Use active record context for phrases like this client, this file, this record, it, or that one.",
    "Never perform or assist bulk destructive actions such as moving, assigning, completing, deleting, or updating every record.",
    "Keep answers concise, operational, and user-facing. Do not mention tool names, schemas, or internal traces unless explicitly asked.",
    `Signed-in user: ${context.actor.displayName} (${context.actor.roleName ?? "employee"}${context.actor.email ? `, ${context.actor.email}` : ""}).`,
    `Current date/time: ${context.nowIso}.`,
    context.activeRecordContext
      ? `Active record context: ${context.activeRecordContext.recordTitle} (${context.activeRecordContext.listTitle ?? "unknown list"}), id ${context.activeRecordContext.recordId}.`
      : "No active record context is available.",
  ].join("\n");
}

export function buildAyaAgentPrompt(context: AyaAgentContext) {
  return [
    "User request:",
    context.message,
    "",
    "Operational context:",
    JSON.stringify(
      {
        actor: {
          displayName: context.actor.displayName,
          email: context.actor.email ?? null,
          roleName: context.actor.roleName ?? "employee",
        },
        activeRecord: context.activeRecordContext ?? null,
        hasActiveRecordContext: context.hasActiveRecordContext,
      },
      null,
      2,
    ),
  ].join("\n");
}
