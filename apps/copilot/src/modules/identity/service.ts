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

export function formatUnmappedEmployeeMessage(input: {
  employeeEmail?: string;
  employeeName?: string;
  senderId?: string;
  transport?: string;
}) {
  const email = normalizeHeaderIdentityValue(input.employeeEmail);
  if (email) {
    return `Your Copilot account is not linked to an Aya employee profile. Ask an admin to link ${email}.`;
  }

  const name = normalizeHeaderIdentityValue(input.employeeName);
  if (name) {
    return `Your Copilot account is not linked to an Aya employee profile. Ask an admin to link ${name}.`;
  }

  return "Aya Copilot could not read your signed-in LibreChat employee email. Ask an admin to check the LibreChat-to-Aya identity headers.";
}

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
  const employeeId = normalizeHeaderIdentityValue(input.employeeId);
  const employeeEmail = normalizeHeaderIdentityValue(input.employeeEmail);
  const employeeName = normalizeHeaderIdentityValue(input.employeeName);
  const senderId = normalizeHeaderIdentityValue(input.senderId);

  if (employeeId) {
    const employee = await findEmployeeById(employeeId);
    if (employee) {
      return toEmployeeIdentity(employee);
    }

    firstLookupError ??= new NotFoundError(`Unknown employeeId: ${employeeId}`);
  }

  if (employeeEmail) {
    const employee = await resolveEmployeeByEmail(
      employeeEmail,
      Boolean(input.autoLinkByEmail),
    );
    if (employee) {
      return toEmployeeIdentity(employee);
    }

    firstLookupError ??= new NotFoundError(
      formatUnmappedEmployeeMessage({ employeeEmail }),
    );
  }

  if (employeeName) {
    const employee = await findEmployeeByName(
      normalizeEmployeeLookupName(employeeName),
    );
    if (employee) {
      return toEmployeeIdentity(employee);
    }

    firstLookupError ??= new NotFoundError(
      formatUnmappedEmployeeMessage({ employeeName }),
    );
  }

  if (input.transport && senderId) {
    const employee = await findEmployeeByIdentity(input.transport, senderId);
    if (employee) {
      return toEmployeeIdentity(employee);
    }
  }

  if (input.transport && input.transport !== "http") {
    throw new AuthError(formatUnmappedEmployeeMessage(input));
  }

  if (config.ALLOW_DEV_DEFAULT_ACTOR && config.NODE_ENV !== "production") {
    return defaultActor;
  }

  if (firstLookupError) {
    throw firstLookupError;
  }

  throw new AuthError();
}

function normalizeHeaderIdentityValue(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  if (/^\{\{.+\}\}$/.test(normalized) || /^\$\{.+\}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function normalizeEmployeeLookupName(value: string) {
  return EMPLOYEE_NAME_ALIASES.get(value.trim().toLowerCase()) ?? value;
}

const EMPLOYEE_NAME_ALIASES = new Map([
  ["rehann", "Rehan S"],
  ["rehanns", "Rehan S"],
  ["rehan saeed", "Rehan S"],
]);

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
