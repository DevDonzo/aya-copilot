interface CachedRecordRow {
  id: string;
  title: string;
  list_title: string;
  status: string | null;
  due_at: string | null;
  updated_at: string | null;
  archived: number;
  done: number;
  raw_json: string | null;
}

type ExceptionFieldKey =
  | "assignee"
  | "client_name"
  | "email"
  | "phone"
  | "finance_amount"
  | "due_date"
  | "closing_date";

export type ExceptionReportFocus =
  | "all"
  | ExceptionFieldKey
  | "assignment";

interface ExceptionIssue {
  key: ExceptionFieldKey;
  label: string;
}

interface ExceptionRecordItem {
  recordId: string;
  recordTitle: string;
  listTitle: string;
  ownerNames: string[];
  missingFields: ExceptionIssue[];
  dueAt: string | null;
  updatedAt: string | null;
}

interface EmployeeExceptionStat {
  employeeName: string;
  affectedRecordCount: number;
  missingFieldCount: number;
}

interface StageExceptionStat {
  listTitle: string;
  affectedRecordCount: number;
}

const FIELD_LABELS: Record<ExceptionFieldKey, string> = {
  assignee: "assigned employee",
  client_name: "client name",
  email: "email",
  phone: "phone",
  finance_amount: "finance amount",
  due_date: "due date",
  closing_date: "closing date",
};

const LEAD_STAGE_PATTERN = /\blead\b|\bfu\b|\bfollow[\s-]?up\b/i;
const UNDERWRITING_STAGE_PATTERN =
  /\bunderwriting\b|\bdocs?\b|\bcommitment\b|\bclosing\b/i;

export function buildWorkspaceExceptionReport(input: {
  rows: CachedRecordRow[];
  focus?: ExceptionReportFocus;
  employeeName?: string;
}) {
  const focus = input.focus ?? "all";
  const employeeFilter = input.employeeName?.trim().toLowerCase() ?? null;

  const evaluated = input.rows
    .filter((row) => !row.archived && !row.done)
    .map(evaluateRecordExceptions)
    .filter((item): item is ExceptionRecordItem => Boolean(item))
    .filter((item) =>
      employeeFilter
        ? item.ownerNames.some((name) => name.toLowerCase().includes(employeeFilter))
        : true,
    );

  const filtered =
    focus === "all" || focus === "assignment"
      ? evaluated
      : evaluated.filter((item) =>
          item.missingFields.some((field) => field.key === focus),
        );

  const fieldCounts = summarizeFieldCounts(filtered);
  const employeeStats = summarizeEmployeeStats(filtered);
  const stageStats = summarizeStageStats(filtered);
  const responseText = buildExceptionResponseText({
    focus,
    employeeName: input.employeeName ?? null,
    totalRecords: filtered.length,
    fieldCounts,
    employeeStats,
    stageStats,
    items: filtered.slice(0, 12),
  });

  return {
    focus,
    employeeName: input.employeeName ?? null,
    totalRecords: filtered.length,
    fieldCounts,
    employeeStats,
    stageStats,
    items: filtered,
    responseText,
  };
}

function evaluateRecordExceptions(row: CachedRecordRow): ExceptionRecordItem | null {
  const rawRecord = safeParseJson(row.raw_json);
  const assignees = extractAssignees(rawRecord);
  const fields = extractFieldMap(rawRecord);
  const rules = getRulesForStage(row.list_title);
  const issues: ExceptionIssue[] = [];

  for (const key of rules) {
    if (isFieldMissing(key, row, fields, assignees)) {
      issues.push({
        key,
        label: FIELD_LABELS[key],
      });
    }
  }

  if (issues.length === 0) {
    return null;
  }

  return {
    recordId: row.id,
    recordTitle: row.title,
    listTitle: row.list_title,
    ownerNames: assignees.length > 0 ? assignees : ["Unassigned"],
    missingFields: issues,
    dueAt: row.due_at,
    updatedAt: row.updated_at,
  };
}

function getRulesForStage(listTitle: string): ExceptionFieldKey[] {
  if (UNDERWRITING_STAGE_PATTERN.test(listTitle)) {
    return [
      "assignee",
      "client_name",
      "email",
      "phone",
      "finance_amount",
      "due_date",
      "closing_date",
    ];
  }

  if (LEAD_STAGE_PATTERN.test(listTitle)) {
    return [
      "assignee",
      "client_name",
      "email",
      "phone",
      "finance_amount",
      "due_date",
    ];
  }

  return ["assignee", "due_date"];
}

function isFieldMissing(
  key: ExceptionFieldKey,
  row: CachedRecordRow,
  fields: Map<string, unknown>,
  assignees: string[],
) {
  switch (key) {
    case "assignee":
      return assignees.length === 0;
    case "client_name":
      return !readName(fields);
    case "email":
      return !readStringField(fields, ["email"]);
    case "phone":
      return !readStringField(fields, ["phone"]);
    case "finance_amount":
      return !readPositiveNumberField(fields, ["finance amount", "finance amount 1"]);
    case "due_date":
      return !row.due_at;
    case "closing_date":
      return !readStringField(fields, ["closing date"]);
    default:
      return false;
  }
}

function readName(fields: Map<string, unknown>) {
  const contactName = readStringField(fields, ["contact name"]);
  if (contactName) {
    return contactName;
  }

  const firstName = readStringField(fields, ["first name"]);
  const lastName = readStringField(fields, ["last name"]);
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function readStringField(fields: Map<string, unknown>, labels: string[]) {
  for (const label of labels) {
    const value = normalizeFieldValue(fields.get(label));
    if (value) {
      return value;
    }
  }

  return "";
}

function readPositiveNumberField(fields: Map<string, unknown>, labels: string[]) {
  for (const label of labels) {
    const value = fields.get(label);
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value.replace(/[^0-9.]/g, ""))
          : NaN;
    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }

  return 0;
}

function extractAssignees(rawRecord: unknown) {
  if (!isObject(rawRecord) || !Array.isArray(rawRecord.users)) {
    return [];
  }

  return rawRecord.users
    .map((user) => {
      if (!isObject(user)) {
        return "";
      }

      const fullName =
        typeof user.fullName === "string" && user.fullName.trim()
          ? user.fullName.trim()
          : [user.firstName, user.lastName]
              .filter(
                (value): value is string =>
                  typeof value === "string" && Boolean(value.trim()),
              )
              .join(" ")
              .trim();

      if (fullName) {
        return fullName;
      }

      return typeof user.email === "string" ? user.email.trim() : "";
    })
    .filter(Boolean);
}

function extractFieldMap(rawRecord: unknown) {
  const fieldMap = new Map<string, unknown>();
  if (!isObject(rawRecord) || !Array.isArray(rawRecord.customFields)) {
    return fieldMap;
  }

  for (const field of rawRecord.customFields) {
    if (!isObject(field) || typeof field.name !== "string") {
      continue;
    }
    fieldMap.set(normalizeLabel(field.name), field.value ?? field.number ?? null);
  }

  return fieldMap;
}

function summarizeFieldCounts(items: ExceptionRecordItem[]) {
  const counts = new Map<string, number>();

  for (const item of items) {
    for (const field of item.missingFields) {
      counts.set(field.label, (counts.get(field.label) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([fieldLabel, count]) => ({ fieldLabel, count }))
    .sort(
      (left, right) => right.count - left.count || left.fieldLabel.localeCompare(right.fieldLabel),
    );
}

function summarizeEmployeeStats(items: ExceptionRecordItem[]): EmployeeExceptionStat[] {
  const stats = new Map<string, EmployeeExceptionStat>();

  for (const item of items) {
    for (const owner of item.ownerNames) {
      const current = stats.get(owner) ?? {
        employeeName: owner,
        affectedRecordCount: 0,
        missingFieldCount: 0,
      };
      current.affectedRecordCount += 1;
      current.missingFieldCount += item.missingFields.length;
      stats.set(owner, current);
    }
  }

  return Array.from(stats.values()).sort(
    (left, right) =>
      right.affectedRecordCount - left.affectedRecordCount ||
      right.missingFieldCount - left.missingFieldCount ||
      left.employeeName.localeCompare(right.employeeName),
  );
}

function summarizeStageStats(items: ExceptionRecordItem[]): StageExceptionStat[] {
  const stats = new Map<string, number>();
  for (const item of items) {
    stats.set(item.listTitle, (stats.get(item.listTitle) ?? 0) + 1);
  }

  return Array.from(stats.entries())
    .map(([listTitle, affectedRecordCount]) => ({
      listTitle,
      affectedRecordCount,
    }))
    .sort(
      (left, right) =>
        right.affectedRecordCount - left.affectedRecordCount ||
        left.listTitle.localeCompare(right.listTitle),
    );
}

function buildExceptionResponseText(input: {
  focus: ExceptionReportFocus;
  employeeName: string | null;
  totalRecords: number;
  fieldCounts: Array<{ fieldLabel: string; count: number }>;
  employeeStats: EmployeeExceptionStat[];
  stageStats: StageExceptionStat[];
  items: ExceptionRecordItem[];
}) {
  const scope = input.employeeName
    ? ` for ${input.employeeName}`
    : "";

  if (input.totalRecords === 0) {
    const label =
      input.focus === "all"
        ? "No records with missing required fields"
        : input.focus === "assignment"
          ? "No records missing an assigned employee"
          : `No records missing ${FIELD_LABELS[input.focus]}`;
    return `${label}${scope} in the cached Aya workspace right now.`;
  }

  const headline =
    input.focus === "all"
      ? `Exception report${scope}: ${input.totalRecords} active record${
          input.totalRecords === 1 ? "" : "s"
        } with missing required fields.`
      : input.focus === "assignment"
        ? `Assignment exception report${scope}: ${input.totalRecords} active record${
            input.totalRecords === 1 ? "" : "s"
          } missing an assigned employee.`
        : `Records missing ${FIELD_LABELS[input.focus]}${scope}: ${input.totalRecords}.`;

  return [
    headline,
    input.fieldCounts.length > 0
      ? [
          "Most common gaps:",
          ...input.fieldCounts.slice(0, 5).map((item) => `- ${item.fieldLabel}: ${item.count}`),
        ].join("\n")
      : null,
    input.employeeStats.length > 0
      ? [
          "Assigned employees with records that have missing required fields:",
          ...input.employeeStats
            .slice(0, 5)
            .map(
              (item) =>
                `- ${item.employeeName}: ${item.affectedRecordCount} record${
                  item.affectedRecordCount === 1 ? "" : "s"
                }`,
            ),
        ].join("\n")
      : null,
    input.stageStats.length > 0
      ? [
          "Most affected stages:",
          ...input.stageStats
            .slice(0, 5)
            .map(
              (item) =>
                `- ${item.listTitle}: ${item.affectedRecordCount} record${
                  item.affectedRecordCount === 1 ? "" : "s"
                }`,
            ),
        ].join("\n")
      : null,
    [
      "Priority exception records:",
      ...input.items.map(
        (item) =>
          `- ${item.recordTitle} (${item.listTitle}) | Assigned to: ${item.ownerNames.join(", ")} | Missing: ${item.missingFields
            .map((field) => field.label)
            .join(", ")}`,
      ),
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeFieldValue(value: unknown) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value === "(empty)" ? "" : value.trim();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (isObject(value) && typeof value.startDate === "string") {
    return value.startDate;
  }
  return JSON.stringify(value);
}

function safeParseJson(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
