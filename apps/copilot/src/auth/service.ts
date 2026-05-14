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
  insertBotAuditLog,
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

const loginFailures = new Map<
  string,
  {
    count: number;
    firstFailedAtMs: number;
    lockedUntilMs?: number;
  }
>();
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

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

export async function loginEmployee(
  employeeName: string,
  password: string,
  options: { sourceKey?: string } = {},
) {
  const loginKey = getLoginFailureKey(employeeName, options.sourceKey);
  const lockout = getActiveLoginLockout(loginKey);
  if (lockout) {
    await recordLoginAudit({
      employeeName,
      outcome: "blocked",
      responseText: "Too many failed login attempts. Try again later.",
      sourceKey: options.sourceKey,
    });
    throw new AuthError("Too many failed login attempts. Try again later.");
  }

  const employee = await findEmployeeByName(employeeName);
  if (!employee) {
    await recordFailedLogin(loginKey, employeeName, options.sourceKey);
    throw new AuthError("Invalid credentials");
  }

  const credential = await getEmployeeCredential(employee.id);
  if (!credential) {
    await recordFailedLogin(loginKey, employeeName, options.sourceKey, employee.id);
    throw new AuthError("Invalid credentials");
  }

  const attemptedHash = hashPassword(password, credential.password_salt);
  if (
    !crypto.timingSafeEqual(
      Buffer.from(attemptedHash),
      Buffer.from(credential.password_hash),
    )
  ) {
    await recordFailedLogin(loginKey, employeeName, options.sourceKey, employee.id);
    throw new AuthError("Invalid credentials");
  }

  loginFailures.delete(loginKey);
  await recordLoginAudit({
    employeeId: employee.id,
    employeeName,
    outcome: "success",
    responseText: "Login succeeded.",
    sourceKey: options.sourceKey,
  });

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

async function recordFailedLogin(
  loginKey: string,
  employeeName: string,
  sourceKey?: string,
  employeeId?: string,
) {
  const now = Date.now();
  const current = loginFailures.get(loginKey);
  const next =
    current && now - current.firstFailedAtMs <= LOGIN_FAILURE_WINDOW_MS
      ? {
          ...current,
          count: current.count + 1,
        }
      : {
          count: 1,
          firstFailedAtMs: now,
        };

  if (next.count >= LOGIN_MAX_FAILURES) {
    next.lockedUntilMs = now + LOGIN_LOCKOUT_MS;
  }

  loginFailures.set(loginKey, next);

  await recordLoginAudit({
    employeeId,
    employeeName,
    outcome: next.lockedUntilMs ? "blocked" : "error",
    responseText: next.lockedUntilMs
      ? "Too many failed login attempts. Try again later."
      : "Invalid credentials",
    sourceKey,
    failureCount: next.count,
  });
}

function getActiveLoginLockout(loginKey: string) {
  const current = loginFailures.get(loginKey);
  if (!current?.lockedUntilMs) {
    return null;
  }

  if (current.lockedUntilMs <= Date.now()) {
    loginFailures.delete(loginKey);
    return null;
  }

  return current;
}

function getLoginFailureKey(employeeName: string, sourceKey?: string) {
  return `${normalizeLoginValue(sourceKey) ?? "unknown"}:${normalizeLoginValue(employeeName) ?? "unknown"}`;
}

function normalizeLoginValue(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

async function recordLoginAudit(input: {
  employeeId?: string;
  employeeName: string;
  outcome: "success" | "error" | "blocked";
  responseText: string;
  sourceKey?: string;
  failureCount?: number;
}) {
  await insertBotAuditLog({
    id: createId("audit"),
    employeeId: input.employeeId,
    transport: "auth",
    inboundText: `login:${normalizeLoginValue(input.employeeName) ?? "unknown"}`,
    detectedIntent: "auth.login",
    adapter: "auth",
    commandName: "auth.login",
    commandArgs: JSON.stringify({
      employeeName: normalizeLoginValue(input.employeeName),
      sourceKey: normalizeLoginValue(input.sourceKey),
    }),
    outcome: input.outcome,
    responseText: input.responseText,
    requestJson: {
      employeeName: normalizeLoginValue(input.employeeName),
      sourceKey: normalizeLoginValue(input.sourceKey),
      failureCount: input.failureCount ?? null,
    },
  });
}
