const MAX_ARRAY_ITEMS = 12;
const MAX_TEXT_LENGTH = 1800;

export function extractResponseText(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }

  for (const key of ["responseText", "summaryText", "answerText"] as const) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

export function compactToolResult(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(compactToolResult);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !DROP_KEYS.has(key))
        .map(([key, item]) => [key, compactToolResult(item)]),
    );
  }

  return String(value);
}

export function summarizeToolResult(data: unknown) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const record = data as Record<string, unknown>;
  return Object.fromEntries(
    [
      "ok",
      "recordId",
      "recordTitle",
      "employeeId",
      "employeeName",
      "date",
      "status",
      "totalRecords",
      "responseText",
    ]
      .filter((key) => key in record)
      .map((key) => [key, compactToolResult(record[key])]),
  );
}

function truncate(value: string) {
  return value.length <= MAX_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_TEXT_LENGTH - 1)}...`;
}

const DROP_KEYS = new Set([
  "rawJson",
  "raw_json",
  "html",
  "request",
  "response",
  "blueAuth",
  "actorBlueTokenId",
  "actorBlueTokenSecret",
]);
