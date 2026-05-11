import { config } from "../../config.js";
import { AuthError, NotFoundError } from "../../app/errors.js";
import {
  createId,
  findEmployeeByEmailColumn,
  findEmployeeById,
  findEmployeeByIdentity,
  findEmployeeByName,
  findIdentityLink,
  upsertIdentityLink,
} from "../../db.js";
import type { EmployeeIdentity } from "../../domain/types.js";

const defaultActor: EmployeeIdentity = {
  employeeId: "cmn4zii0g007p01nueg7v24k8",
  displayName: "Hamza Paracha",
  roleName: "admin",
  blueUserId: "cmn4zii0g007p01nueg7v24k8",
};

export async function createManualIdentityLink(input: {
  employeeId?: string;
  employeeName?: string;
  source: string;
  externalId: string;
  externalLabel?: string;
}) {
  const employee =
    (input.employeeId ? await findEmployeeById(input.employeeId) : undefined) ??
    (input.employeeName ? await findEmployeeByName(input.employeeName) : undefined);

  if (!employee) {
    throw new NotFoundError(
      "employeeId or employeeName must resolve to a synced employee",
    );
  }

  await upsertIdentityLink({
    id: createId("ident"),
    employeeId: employee.id,
    source: input.source,
    externalId: input.externalId,
    externalLabel: input.externalLabel ?? employee.display_name,
  });

  return {
    ok: true,
    employeeId: employee.id,
    employeeName: employee.display_name,
    source: input.source,
    externalId: input.externalId,
  };
}

export async function resolveActorIdentity(input: {
  employeeId?: string;
  employeeEmail?: string;
  employeeName?: string;
  transport?: string;
  senderId?: string;
  autoLinkByEmail?: boolean;
}) {
  let firstLookupError: Error | null = null;

  if (input.employeeId) {
    const employee = await findEmployeeById(input.employeeId);
    if (employee) {
      return toEmployeeIdentity(employee);
    }

    firstLookupError ??= new NotFoundError(`Unknown employeeId: ${input.employeeId}`);
  }

  if (input.employeeEmail) {
    const employee = await resolveEmployeeByEmail(
      input.employeeEmail,
      Boolean(input.autoLinkByEmail),
    );
    if (employee) {
      return toEmployeeIdentity(employee);
    }

    firstLookupError ??= new NotFoundError(
      `Unknown employee email: ${input.employeeEmail}`,
    );
  }

  if (input.employeeName) {
    const employee = await findEmployeeByName(input.employeeName);
    if (employee) {
      return toEmployeeIdentity(employee);
    }

    firstLookupError ??= new NotFoundError(`Unknown employee: ${input.employeeName}`);
  }

  if (input.transport && input.senderId) {
    const employee = await findEmployeeByIdentity(input.transport, input.senderId);
    if (employee) {
      return toEmployeeIdentity(employee);
    }
  }

  if (input.transport && input.transport !== "http") {
    throw new AuthError(
      `No employee mapping found for ${input.transport} sender ${input.senderId ?? "unknown"}`,
    );
  }

  if (config.ALLOW_DEV_DEFAULT_ACTOR && config.NODE_ENV !== "production") {
    return defaultActor;
  }

  if (firstLookupError) {
    throw firstLookupError;
  }

  throw new AuthError();
}

async function resolveEmployeeByEmail(email: string, autoLinkByEmail: boolean) {
  const linked = await findEmployeeByIdentity("email", email);
  if (linked) {
    return linked;
  }

  if (!autoLinkByEmail) {
    return null;
  }

  const employee = await findEmployeeByEmailColumn(email);
  if (!employee) {
    return null;
  }

  const existingLink = await findIdentityLink("email", email);
  if (!existingLink) {
    await upsertIdentityLink({
      id: createId("ident"),
      employeeId: employee.id,
      source: "email",
      externalId: email,
      externalLabel: employee.display_name,
    });
  }

  return employee;
}

function toEmployeeIdentity(employee: {
  id: string;
  display_name: string;
  role_name: string | null;
  email?: string | null;
}) {
  return {
    employeeId: employee.id,
    displayName: employee.display_name,
    roleName: employee.role_name === "admin" ? "admin" : "employee",
    blueUserId: employee.id,
    email: employee.email ?? undefined,
  } satisfies EmployeeIdentity;
}
