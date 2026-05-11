import { db } from "../kysely.js";
import { normalizeIdentityValue } from "./helpers.js";

export async function upsertIdentityLink(input: {
  id: string;
  employeeId: string;
  source: string;
  externalId: string;
  externalLabel?: string;
}) {
  const normalizedExternalId = normalizeIdentityValue(
    input.source,
    input.externalId,
  );

  await db
    .insertInto("identity_links")
    .values({
      id: input.id,
      employee_id: input.employeeId,
      source: input.source,
      external_id: normalizedExternalId,
      external_label: input.externalLabel ?? null,
    })
    .onConflict((conflict) =>
      conflict.columns(["source", "external_id"]).doUpdateSet({
        employee_id: input.employeeId,
        external_label: input.externalLabel ?? null,
      }),
    )
    .execute();
}

export async function listIdentityLinks() {
  return await db
    .selectFrom("identity_links as il")
    .innerJoin("employees as e", "e.id", "il.employee_id")
    .select([
      "il.id",
      "il.employee_id",
      "e.display_name",
      "il.source",
      "il.external_id",
      "il.external_label",
    ])
    .orderBy("e.display_name", "asc")
    .orderBy("il.source", "asc")
    .orderBy("il.external_id", "asc")
    .execute();
}

export async function getIdentityLinkById(id: string) {
  return await db
    .selectFrom("identity_links as il")
    .innerJoin("employees as e", "e.id", "il.employee_id")
    .select([
      "il.id",
      "il.employee_id",
      "e.display_name",
      "il.source",
      "il.external_id",
      "il.external_label",
    ])
    .where("il.id", "=", id)
    .executeTakeFirst();
}

export async function findEmployeeByIdentity(source: string, externalId: string) {
  const normalizedExternalId = normalizeIdentityValue(source, externalId);

  return await db
    .selectFrom("identity_links as il")
    .innerJoin("employees as e", "e.id", "il.employee_id")
    .select(["e.id", "e.display_name", "e.role_name", "e.timezone"])
    .where("il.source", "=", source)
    .where("il.external_id", "=", normalizedExternalId)
    .executeTakeFirst();
}

export async function findIdentityLink(source: string, externalId: string) {
  const normalizedExternalId = normalizeIdentityValue(source, externalId);

  return await db
    .selectFrom("identity_links")
    .selectAll()
    .where("source", "=", source)
    .where("external_id", "=", normalizedExternalId)
    .executeTakeFirst();
}

export async function deleteIdentityLinksBySources(sources: string[]) {
  if (!sources.length) {
    return;
  }

  await db
    .deleteFrom("identity_links")
    .where("source", "in", sources)
    .execute();
}

export async function deleteIdentityLinkById(id: string) {
  await db
    .deleteFrom("identity_links")
    .where("id", "=", id)
    .execute();
}
