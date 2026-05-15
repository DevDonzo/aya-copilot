import { db } from "../kysely.js";

export async function ensureEmployee(input: {
  employeeId: string;
  displayName: string;
  email?: string;
  roleName?: string;
  timezone?: string;
}) {
  const normalizedEmail = input.email?.trim().toLowerCase() || undefined;
  const values = {
    id: input.employeeId,
    display_name: input.displayName,
    email: normalizedEmail ?? null,
    role_name: input.roleName ?? null,
    timezone: input.timezone ?? "America/Toronto",
    active: 1 as const,
  };

  const updateValues = {
    display_name: input.displayName,
    timezone: input.timezone ?? "America/Toronto",
    active: 1 as const,
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    ...(input.roleName != null ? { role_name: input.roleName } : {}),
  };

  await db
    .insertInto("employees")
    .values(values)
    .onConflict((conflict) =>
      conflict.column("id").doUpdateSet(updateValues),
    )
    .execute();
}

export async function updateEmployeeRole(employeeId: string, roleName: string) {
  await db
    .updateTable("employees")
    .set({
      role_name: roleName,
    })
    .where("id", "=", employeeId)
    .execute();
}

export async function findEmployeeById(employeeId: string) {
  return await db
    .selectFrom("employees")
    .select(["id", "display_name", "email", "role_name", "timezone"])
    .where("id", "=", employeeId)
    .executeTakeFirst();
}

export async function findEmployeeByName(name: string) {
  const exact = name.trim().toLowerCase();
  return await db
    .selectFrom("employees")
    .select(["id", "display_name", "email", "role_name", "timezone"])
    .where("active", "=", 1)
    .where(({ eb, fn }) =>
      eb.or([
        eb(fn("lower", ["display_name"]), "=", exact),
        eb(fn("lower", ["display_name"]), "like", `%${exact}%`),
      ]),
    )
    .orderBy(({ case: caseBuilder, fn }) =>
      caseBuilder()
        .when(fn("lower", ["display_name"]), "=", exact)
        .then(0)
        .else(1)
        .end(),
    )
    .orderBy("display_name", "asc")
    .limit(1)
    .executeTakeFirst();
}

export async function listEmployees() {
  return await db
    .selectFrom("employees")
    .select(["id", "display_name", "email", "role_name"])
    .where("active", "=", 1)
    .orderBy("display_name", "asc")
    .execute();
}

export async function findEmployeeByEmailColumn(email: string) {
  return await db
    .selectFrom("employees")
    .select(["id", "display_name", "email", "role_name", "timezone"])
    .where("active", "=", 1)
    .where("email", "=", email.trim().toLowerCase())
    .executeTakeFirst();
}

export async function reassignEmployeeReferences(input: {
  duplicateEmployeeId: string;
  canonicalEmployeeId: string;
}) {
  if (input.duplicateEmployeeId === input.canonicalEmployeeId) {
    return;
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("activity_events")
      .set({ employee_id: input.canonicalEmployeeId })
      .where("employee_id", "=", input.duplicateEmployeeId)
      .execute();

    await trx
      .updateTable("bot_audit_logs")
      .set({ employee_id: input.canonicalEmployeeId })
      .where("employee_id", "=", input.duplicateEmployeeId)
      .execute();

    await trx
      .updateTable("auth_sessions")
      .set({ employee_id: input.canonicalEmployeeId })
      .where("employee_id", "=", input.duplicateEmployeeId)
      .execute();

    await trx
      .updateTable("identity_links")
      .set({ employee_id: input.canonicalEmployeeId })
      .where("employee_id", "=", input.duplicateEmployeeId)
      .execute();

    await trx
      .updateTable("employees")
      .set({ active: 0 })
      .where("id", "=", input.duplicateEmployeeId)
      .execute();
  });
}
