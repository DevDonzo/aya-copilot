import {
  createId,
  ensureEmployee,
  findEmployeeByName,
  upsertIdentityLink,
} from "../db.js";
import { logger } from "../lib/logger.js";
import type { BlueUser } from "../types/blue.js";
import {
  fetchCompanyUsers,
  fetchWorkspaceUsers,
} from "../modules/blue/graphql/client.js";
import { config } from "../config.js";

const knownAyaEmployeeEmailsByName = new Map([
  ["rehan s", "rsaeed@ayafinancial.com"],
  ["sarah khan", "skhan@ayafinancial.com"],
]);

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

  for (const user of users) {
    await ensureEmployee({
      employeeId: user.id,
      displayName: user.fullName,
      email: user.email,
      timezone: user.timezone ?? "America/Toronto",
    });

    await upsertIdentityLink({
      id: createId("ident"),
      employeeId: user.id,
      source: "blue",
      externalId: user.id,
      externalLabel: user.fullName,
    });

    if (user.email) {
      await upsertIdentityLink({
        id: createId("ident"),
        employeeId: user.id,
        source: "email",
        externalId: user.email,
        externalLabel: user.fullName,
      });
    }
  }

  return {
    fetched: users.length,
    withEmail: countUsersWithEmail(users),
    missingEmail: missingEmailCount,
  };
}

export async function resolveEmployeeName(name: string) {
  return await findEmployeeByName(name);
}

export function applyKnownAyaEmployeeEmails(users: BlueUser[]) {
  return users.map((user) => {
    if (user.email?.trim()) {
      return user;
    }

    const knownEmail = knownAyaEmployeeEmailsByName.get(normalizeName(user.fullName));
    if (!knownEmail) {
      return user;
    }

    return {
      ...user,
      email: knownEmail,
    };
  });
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
  return value?.trim().toLowerCase() ?? "";
}

function countUsersMissingEmail(users: BlueUser[]) {
  return users.filter((user) => !user.email?.trim()).length;
}

function countUsersWithEmail(users: BlueUser[]) {
  return users.filter((user) => Boolean(user.email?.trim())).length;
}
