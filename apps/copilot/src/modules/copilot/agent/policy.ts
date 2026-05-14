import { AppError, PermissionError } from "../../../app/errors.js";
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
}

export function enforceAyaToolPolicy(
  context: AyaAgentContext,
  input: Record<string, unknown>,
  policy: AyaToolPolicy,
) {
  const role = context.actor.roleName ?? "employee";

  if (policy.adminOnly && role !== "admin") {
    throw new PermissionError();
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

export function formatAyaToolError(error: unknown) {
  if (error instanceof PermissionError) {
    return "You do not have permission to do that.";
  }

  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "The action failed before Aya could complete it.";
}
