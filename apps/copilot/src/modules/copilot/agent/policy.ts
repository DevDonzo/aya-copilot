import {
  AppError,
  ExternalServiceError,
  PermissionError,
} from "../../../app/errors.js";
import { requireValidatedBlueRequestAuth } from "../../blue/request-auth.js";
import { getPreAuthSafetyBlock } from "../safety.js";
import type { AyaAgentContext } from "./types.js";

export class AyaAgentRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AyaAgentRuntimeUnavailableError";
  }
}

export interface AyaToolPolicy {
  adminOnly?: boolean;
  write?: boolean;
  employeeNameField?: string;
  blueAuthRequired?: boolean;
}

export async function enforceAyaToolPolicy(
  context: AyaAgentContext,
  intent: string | undefined,
  input: Record<string, unknown>,
  policy: AyaToolPolicy,
) {
  const role = context.actor.roleName ?? "employee";

  if (policy.adminOnly && role !== "admin") {
    throw new PermissionError();
  }

  if (
    policy.blueAuthRequired ||
    policy.write ||
    (intent != null && !canRunWithoutBlueCredentials(intent))
  ) {
    await requireValidatedBlueRequestAuth(context.blueAuth, context.actor);
  }

  if (role !== "admin" && policy.employeeNameField) {
    const target = input[policy.employeeNameField];
    if (
      typeof target === "string" &&
      target.trim() &&
      target.trim().toLowerCase() !== context.actor.displayName.trim().toLowerCase()
    ) {
      throw new PermissionError();
    }
  }

  if (policy.write) {
    const safetyBlock = getPreAuthSafetyBlock(
      Object.values(input)
        .filter((value) => typeof value === "string" || typeof value === "number")
        .join(" "),
    );
    if (safetyBlock) {
      throw new AppError(safetyBlock.responseText, {
        statusCode: 400,
        code: safetyBlock.code,
      });
    }
  }
}

function canRunWithoutBlueCredentials(intent: string) {
  return intent === "identity.self" || intent === "operations.attention_report";
}

export function formatAyaToolError(error: unknown) {
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
