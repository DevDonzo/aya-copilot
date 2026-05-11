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
    .orderBy("display_name", "asc")
    .execute();
}

export async function findEmployeeByEmailColumn(email: string) {
  return await db
    .selectFrom("employees")
    .select(["id", "display_name", "email", "role_name", "timezone"])
    .where("email", "=", email.trim().toLowerCase())
    .executeTakeFirst();
}
