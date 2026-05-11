export function normalizeCacheQuery(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeIdentityValue(source: string, externalId: string) {
  const trimmed = externalId.trim();
  if (source === "email") {
    return trimmed.toLowerCase();
  }

  return trimmed;
}

export function normalizeRoleName(roleName: string | null | undefined) {
  if (roleName === "admin") {
    return "admin";
  }

  return "employee" as const;
}
