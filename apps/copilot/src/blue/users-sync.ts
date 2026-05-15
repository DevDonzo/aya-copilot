import {
  createId,
  deactivateEmployeesExcept,
  ensureEmployee,
  findEmployeeByName,
  reassignEmployeeReferences,
  upsertIdentityLink,
} from "../db.js";
import { logger } from "../lib/logger.js";
import type { BlueUser } from "../types/blue.js";
import {
  fetchCompanyUsers,
  fetchWorkspaceUsers,
} from "../modules/blue/graphql/client.js";
import { config } from "../config.js";
import {
  applyKnownAyaEmployeeEmails,
  canonicalizeBlueEmployee,
  getDuplicateBlueEmployeeMappings,
  getKnownAyaEmployeeSeeds,
  type KnownAyaEmployeeSeed,
} from "./employee-identity.js";

export { applyKnownAyaEmployeeEmails } from "./employee-identity.js";

export async function syncWorkspaceEmployees() {
  const workspaceUsers = await fetchWorkspaceUsers(config.BLUE_READ_WORKSPACE_ID);
  let users = workspaceUsers;

  if (countUsersMissingEmail(workspaceUsers) > 0 && config.BLUE_COMPANY_ID) {
    try {
      const companyUsers = await fetchCompanyUsers(config.BLUE_COMPANY_ID);
      users = enrichWorkspaceUsersWithCompanyDirectory(workspaceUsers, companyUsers);

      const resolvedEmails =
        countUsersWithEmail(users) - countUsersWithEmail(workspaceUsers);
      if (resolvedEmails > 0) {
        logger.info(
          {
            employeeSync: {
              workspaceId: config.BLUE_READ_WORKSPACE_ID,
              companyId: config.BLUE_COMPANY_ID,
              resolvedEmails,
            },
          },
          "enriched workspace employees with company directory emails",
        );
      }
    } catch (error) {
      logger.warn(
        {
          err: error,
          employeeSync: {
            workspaceId: config.BLUE_READ_WORKSPACE_ID,
            companyId: config.BLUE_COMPANY_ID,
          },
        },
        "failed to enrich workspace employees with company directory",
      );
    }
  }

  users = applyKnownAyaEmployeeEmails(users);

  const missingEmailCount = countUsersMissingEmail(users);
  if (missingEmailCount > 0) {
    logger.warn(
      {
        employeeSync: {
          workspaceId: config.BLUE_READ_WORKSPACE_ID,
          missingEmailCount,
          totalUsers: users.length,
        },
      },
      "blue employee sync is missing email visibility; Blue only exposes user emails to OWNER/ADMIN tokens",
    );
  }

  const syncedEmails = new Set<string>();
  const syncedEmployeeIds = new Set<string>();

  for (const user of users) {
    const employee = canonicalizeBlueEmployee(user);
    syncedEmployeeIds.add(employee.employeeId);
    if (employee.email) {
      syncedEmails.add(normalizeEmail(employee.email));
    }

    await ensureEmployee({
      employeeId: employee.employeeId,
      displayName: employee.displayName,
      email: employee.email,
      roleName: employee.roleName,
      timezone: employee.timezone,
    });

    await upsertIdentityLink({
      id: createId("ident"),
      employeeId: employee.employeeId,
      source: "blue",
      externalId: user.id,
      externalLabel: employee.originalDisplayName,
    });

    if (employee.email) {
      await upsertIdentityLink({
        id: createId("ident"),
        employeeId: employee.employeeId,
        source: "email",
        externalId: employee.email,
        externalLabel: employee.displayName,
      });
    }
  }

  await ensureKnownAyaEmployeeSeeds(
    getKnownAyaEmployeeSeeds(),
    syncedEmails,
    syncedEmployeeIds,
  );

  for (const mapping of getDuplicateBlueEmployeeMappings()) {
    await reassignEmployeeReferences(mapping);
  }

  if (users.length > 0) {
    await deactivateEmployeesExcept(Array.from(syncedEmployeeIds));
  }

  return {
    fetched: users.length,
    withEmail: countUsersWithEmail(users),
    missingEmail: missingEmailCount,
  };
}

async function ensureKnownAyaEmployeeSeeds(
  seeds: KnownAyaEmployeeSeed[],
  syncedEmails: Set<string>,
  syncedEmployeeIds: Set<string>,
) {
  for (const seed of seeds) {
    const email = normalizeEmail(seed.email);
    if (syncedEmails.has(email)) {
      continue;
    }

    syncedEmployeeIds.add(seed.employeeId);

    await ensureEmployee({
      employeeId: seed.employeeId,
      displayName: seed.displayName,
      email,
      roleName: seed.roleName,
      timezone: seed.timezone,
    });

    await upsertIdentityLink({
      id: createId("ident"),
      employeeId: seed.employeeId,
      source: "email",
      externalId: email,
      externalLabel: seed.displayName,
    });

    syncedEmails.add(email);
  }
}

export async function resolveEmployeeName(name: string) {
  return await findEmployeeByName(name);
}

export function enrichWorkspaceUsersWithCompanyDirectory(
  workspaceUsers: BlueUser[],
  companyUsers: BlueUser[],
) {
  const companyById = new Map(companyUsers.map((user) => [user.id, user]));
  const companyByUid = new Map(
    companyUsers
      .filter((user) => user.uid)
      .map((user) => [user.uid as string, user]),
  );
  const companyByUniqueName = buildUniqueNameMap(companyUsers);

  return workspaceUsers.map((user) => {
    const directMatch =
      companyById.get(user.id) ??
      (user.uid ? companyByUid.get(user.uid) : undefined) ??
      companyByUniqueName.get(normalizeName(user.fullName));

    if (!directMatch) {
      return user;
    }

    return {
      ...user,
      email: user.email || directMatch.email || "",
      timezone: user.timezone ?? directMatch.timezone ?? null,
      updatedAt: user.updatedAt ?? directMatch.updatedAt,
    };
  });
}

function buildUniqueNameMap(users: BlueUser[]) {
  const counts = new Map<string, number>();
  for (const user of users) {
    const key = normalizeName(user.fullName);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result = new Map<string, BlueUser>();
  for (const user of users) {
    const key = normalizeName(user.fullName);
    if (!key || counts.get(key) !== 1) {
      continue;
    }
    result.set(key, user);
  }

  return result;
}

function normalizeName(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function countUsersMissingEmail(users: BlueUser[]) {
  return users.filter((user) => !user.email?.trim()).length;
}

function countUsersWithEmail(users: BlueUser[]) {
  return users.filter((user) => Boolean(user.email?.trim())).length;
}
