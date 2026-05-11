import crypto from "node:crypto";

import { AuthError, NotFoundError, PermissionError } from "../app/errors.js";
import { config } from "../config.js";
import {
  createAuthSession,
  createId,
  deleteAuthSession,
  findEmployeeById,
  findEmployeeByName,
  getAuthSession,
  getEmployeeCredential,
  pruneExpiredAuthSessions,
  updateEmployeeRole,
  upsertEmployeeCredential,
} from "../db.js";

export type EmployeeRole = "employee" | "admin";

export interface AuthenticatedEmployee {
  employeeId: string;
  displayName: string;
  roleName: EmployeeRole;
}

export function normalizeRole(roleName: string | null | undefined): EmployeeRole {
  if (roleName === "admin") {
    return "admin";
  }

  return "employee";
}

export async function provisionEmployeeAccess(input: {
  employeeId?: string;
  employeeName?: string;
  password: string;
  roleName: EmployeeRole;
}) {
  const employee =
    (input.employeeId ? await findEmployeeById(input.employeeId) : undefined) ??
    (input.employeeName ? await findEmployeeByName(input.employeeName) : undefined);

  if (!employee) {
    throw new NotFoundError("Employee not found");
  }

  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(input.password, passwordSalt);

  await upsertEmployeeCredential({
    employeeId: employee.id,
    passwordHash,
    passwordSalt,
  });
  await updateEmployeeRole(employee.id, input.roleName);

  return {
    employeeId: employee.id,
    employeeName: employee.display_name,
    roleName: input.roleName,
  };
}

export async function loginEmployee(employeeName: string, password: string) {
  const employee = await findEmployeeByName(employeeName);
  if (!employee) {
    throw new AuthError("Invalid credentials");
  }

  const credential = await getEmployeeCredential(employee.id);
  if (!credential) {
    throw new AuthError("Invalid credentials");
  }

  const attemptedHash = hashPassword(password, credential.password_salt);
  if (
    !crypto.timingSafeEqual(
      Buffer.from(attemptedHash),
      Buffer.from(credential.password_hash),
    )
  ) {
    throw new AuthError("Invalid credentials");
  }

  await pruneExpiredAuthSessions(new Date().toISOString());

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + config.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();

  await createAuthSession({
    id: createId("session"),
    employeeId: employee.id,
    sessionToken,
    expiresAt,
  });

  const refreshedEmployee = await findEmployeeById(employee.id);

  return {
    sessionToken,
    expiresAt,
    employee: {
      employeeId: employee.id,
      displayName: employee.display_name,
      roleName: normalizeRole(refreshedEmployee?.role_name),
    },
  };
}

export async function getAuthenticatedEmployee(
  sessionToken: string | undefined | null,
) {
  if (!sessionToken) {
    return null;
  }

  await pruneExpiredAuthSessions(new Date().toISOString());
  const session = await getAuthSession(sessionToken);
  if (!session) {
    return null;
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await deleteAuthSession(sessionToken);
    return null;
  }

  return {
    employeeId: session.employee_id,
    displayName: session.display_name,
    roleName: normalizeRole(session.role_name),
  } satisfies AuthenticatedEmployee;
}

export async function logoutEmployee(sessionToken: string | undefined | null) {
  if (!sessionToken) {
    return;
  }

  await deleteAuthSession(sessionToken);
}

export function requireRole(
  actor: AuthenticatedEmployee | null,
  roles: EmployeeRole[],
) {
  if (!actor) {
    throw new AuthError();
  }

  if (!roles.includes(actor.roleName)) {
    throw new PermissionError();
  }
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
