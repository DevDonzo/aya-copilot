import type { ZodType } from "zod";

import { ValidationError } from "../errors.js";

export function parseWithSchema<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid request payload", parsed.error.flatten());
  }

  return parsed.data;
}
