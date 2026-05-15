import type { BlueUser } from "../types/blue.js";

export interface BlueEmployeeActor {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  timezone?: string | null;
}

export interface KnownAyaEmployeeSeed {
  employeeId: string;
  displayName: string;
  email: string;
  roleName?: string;
  timezone?: string;
}

const ayaAdminEmployeeEmails = new Set([
  "rsaeed@ayafinancial.com",
  "skhan@ayafinancial.com",
]);

const knownAyaEmployeeEmailsByName = new Map([
  ["abdullah albiz", "abdullaha@ayafinancial.com"],
  ["ajlan bilwani", "abilwani@ayafinancial.com"],
  ["arslan shahid", "ashahid@ayafinancial.com"],
  ["asiyah azmi", "support@ayafinancial.com"],
  ["hamza paracha", "hamza@ayafinancial.com"],
  ["haya h", "hayah@ayafinancial.com"],
  ["hayah hussain", "hayah@ayafinancial.com"],
  ["muhammad arslan shahid", "ashahid@ayafinancial.com"],
  ["nauman nazir", "nnazir@ayafinancial.com"],
  ["naved hussain", "nh@ayafinancial.com"],
  ["rehan aya", "rsaeed@ayafinancial.com"],
  ["rehan s", "rsaeed@ayafinancial.com"],
  ["sarah khan", "skhan@ayafinancial.com"],
  ["tahmyna qazi", "tqazi@ayafinancial.com"],
]);

const canonicalBlueEmployeesByDuplicateId = new Map([
  [
    "cm2or9cai0j7pcacvqx3kgvxz",
    {
      employeeId: "cm2o7pr4f3tlroi9uexnouw44",
      displayName: "Rehan S",
      email: "rsaeed@ayafinancial.com",
    },
  ],
]);

const knownAyaEmployeeSeeds: KnownAyaEmployeeSeed[] = [
  {
    employeeId: "aya_tahmyna_qazi",
    displayName: "Tahmyna Qazi",
    email: "tqazi@ayafinancial.com",
    timezone: "America/Toronto",
  },
];

export function applyKnownAyaEmployeeEmails(users: BlueUser[]) {
  return users.map((user) => {
    if (user.email?.trim()) {
      return user;
    }

    const knownEmail = getKnownAyaEmployeeEmail(formatBlueActorName(user));
    if (!knownEmail) {
      return user;
    }

    return {
      ...user,
      email: knownEmail,
    };
  });
}

export function canonicalizeBlueEmployee(actor: BlueEmployeeActor) {
  const originalDisplayName = formatBlueActorName(actor);
  const canonical = canonicalBlueEmployeesByDuplicateId.get(actor.id);
  const displayName = canonical?.displayName ?? originalDisplayName;
  const email =
    canonical?.email ??
    actor.email?.trim() ??
    getKnownAyaEmployeeEmail(originalDisplayName);
  const roleName =
    email && ayaAdminEmployeeEmails.has(email.toLowerCase()) ? "admin" : undefined;

  return {
    employeeId: canonical?.employeeId ?? actor.id,
    displayName,
    email,
    roleName,
    originalBlueUserId: actor.id,
    originalDisplayName,
    timezone: actor.timezone ?? "America/Toronto",
  };
}

export function getDuplicateBlueEmployeeMappings() {
  return Array.from(canonicalBlueEmployeesByDuplicateId.entries()).map(
    ([duplicateEmployeeId, canonical]) => ({
      duplicateEmployeeId,
      canonicalEmployeeId: canonical.employeeId,
    }),
  );
}

export function getKnownAyaEmployeeSeeds() {
  return knownAyaEmployeeSeeds;
}

export function formatBlueActorName(actor?: BlueEmployeeActor | null) {
  if (!actor) {
    return "Unknown";
  }

  return (
    actor.fullName?.trim() ||
    [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim() ||
    actor.email?.trim() ||
    actor.id
  );
}

function getKnownAyaEmployeeEmail(name: string) {
  return knownAyaEmployeeEmailsByName.get(normalizeName(name));
}

function normalizeName(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}
