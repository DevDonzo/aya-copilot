import { db } from "../kysely.js";

export async function upsertEmployeeCredential(input: {
  employeeId: string;
  passwordHash: string;
  passwordSalt: string;
  mustReset?: boolean;
}) {
  await db
    .insertInto("employee_credentials")
    .values({
      employee_id: input.employeeId,
      password_hash: input.passwordHash,
      password_salt: input.passwordSalt,
      must_reset: input.mustReset ? 1 : 0,
      updated_at: new Date().toISOString(),
    })
    .onConflict((conflict) =>
      conflict.column("employee_id").doUpdateSet({
        password_hash: input.passwordHash,
        password_salt: input.passwordSalt,
        must_reset: input.mustReset ? 1 : 0,
        updated_at: new Date().toISOString(),
      }),
    )
    .execute();
}

export async function getEmployeeCredential(employeeId: string) {
  return await db
    .selectFrom("employee_credentials")
    .select([
      "employee_id",
      "password_hash",
      "password_salt",
      "must_reset",
    ])
    .where("employee_id", "=", employeeId)
    .executeTakeFirst();
}

export async function createAuthSession(input: {
  id: string;
  employeeId: string;
  sessionToken: string;
  expiresAt: string;
}) {
  await db
    .insertInto("auth_sessions")
    .values({
      id: input.id,
      employee_id: input.employeeId,
      session_token: input.sessionToken,
      expires_at: input.expiresAt,
    })
    .execute();
}

export async function getAuthSession(sessionToken: string) {
  return await db
    .selectFrom("auth_sessions as s")
    .innerJoin("employees as e", "e.id", "s.employee_id")
    .select([
      "s.id",
      "s.employee_id",
      "s.session_token",
      "s.expires_at",
      "e.display_name",
      "e.role_name",
    ])
    .where("s.session_token", "=", sessionToken)
    .executeTakeFirst();
}

export async function deleteAuthSession(sessionToken: string) {
  await db
    .deleteFrom("auth_sessions")
    .where("session_token", "=", sessionToken)
    .execute();
}

export async function pruneExpiredAuthSessions(nowIso: string) {
  await db
    .deleteFrom("auth_sessions")
    .where("expires_at", "<=", nowIso)
    .execute();
}
