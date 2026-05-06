import { config } from "../config.js";
import { listWorkspaceEventsInRange } from "../db.js";

export type ManagerReportFocus =
  | "all"
  | "comments"
  | "moves"
  | "creates"
  | "reads"
  | "timeline";

type WorkspaceActivityItem = Awaited<
  ReturnType<typeof listWorkspaceEventsInRange>
>[number];

type ParsedActivityItem = {
  kind: "comment" | "move" | "create" | "read" | "other";
  occurredAt: string;
  outcome: "success";
  intent: string | null;
  employeeId: string | null;
  employeeName: string;
  summary: string;
  inboundText: string;
  recordId: string | null;
  recordTitle: string | null;
  targetListTitle: string | null;
  text: string | null;
  listTitle: string | null;
};

export async function buildManagerReport(input: {
  dateStart: string;
  dateEnd: string;
  employeeId?: string;
  clientQuery?: string;
  focus?: ManagerReportFocus;
}) {
  const rows = await listWorkspaceEventsInRange({
    workspaceId: config.BLUE_READ_WORKSPACE_ID,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
    employeeId: input.employeeId,
    limit: 5000,
  });
  const focus = input.focus ?? "all";
  const clientQuery = normalizeValue(input.clientQuery ?? "");
  const parsed = rows
    .map(parseActivityRow)
    .filter((item) => {
      if (!clientQuery) {
        return true;
      }
      const title = normalizeValue(item.recordTitle ?? "");
      const summary = normalizeValue(item.summary);
      return title.includes(clientQuery) || summary.includes(clientQuery);
    });

  const filtered = parsed.filter((item) => matchesFocus(item, focus));
  const employees = summarizeEmployees(filtered);
  const clients = summarizeClients(filtered);
  const totals = {
    totalActions: filtered.length,
    comments: filtered.filter((item) => item.kind === "comment").length,
    moves: filtered.filter((item) => item.kind === "move").length,
    creates: filtered.filter((item) => item.kind === "create").length,
    reads: filtered.filter((item) => item.kind === "read").length,
    employeesActive: employees.length,
    clientsTouched: clients.length,
  };

  return {
    range: {
      dateStart: input.dateStart,
      dateEnd: input.dateEnd,
    },
    focus,
    filters: {
      employeeId: input.employeeId ?? null,
      clientQuery: input.clientQuery?.trim() || null,
    },
    totals,
    employees,
    clients,
    timeline: filtered.slice(0, 250),
  };
}

function parseActivityRow(row: WorkspaceActivityItem): ParsedActivityItem {
  const employeeName = row.employee_name?.trim() || "Unknown employee";
  const recordTitle = row.entity_title?.trim() || null;

  return {
    kind: classifyAction(row.action_type),
    occurredAt: row.occurred_at,
    outcome: "success",
    intent: row.action_type,
    employeeId: row.employee_id ?? null,
    employeeName,
    summary: row.summary,
    inboundText: row.summary,
    recordId: row.entity_id ?? null,
    recordTitle,
    targetListTitle: null,
    text: row.entity_type === "comment" ? row.summary : null,
    listTitle: null,
  };
}

function classifyAction(actionType: string) {
  if (actionType === "CREATE_COMMENT") {
    return "comment";
  }
  if (actionType === "CREATE_TODO") {
    return "create";
  }
  if (
    actionType.includes("MOVE") ||
    actionType.includes("ASSIGNEE") ||
    actionType.includes("TAG_")
  ) {
    return "move";
  }
  if (actionType.includes("DONE") || actionType.includes("DUE_DATE")) {
    return "read";
  }

  return "other";
}

function summarizeEmployees(items: ParsedActivityItem[]) {
  const byEmployee = new Map<
    string,
    {
      employeeId: string | null;
      employeeName: string;
      totalActions: number;
      comments: number;
      moves: number;
      creates: number;
      reads: number;
      lastActionAt: string;
      clientTitles: Set<string>;
    }
  >();

  for (const item of items) {
    const key = item.employeeId ?? item.employeeName;
    const current = byEmployee.get(key) ?? {
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      totalActions: 0,
      comments: 0,
      moves: 0,
      creates: 0,
      reads: 0,
      lastActionAt: item.occurredAt,
      clientTitles: new Set<string>(),
    };

    current.totalActions += 1;
    if (item.kind === "comment") current.comments += 1;
    if (item.kind === "move") current.moves += 1;
    if (item.kind === "create") current.creates += 1;
    if (item.kind === "read") current.reads += 1;
    if (item.recordTitle) current.clientTitles.add(item.recordTitle);
    if (item.occurredAt > current.lastActionAt) current.lastActionAt = item.occurredAt;

    byEmployee.set(key, current);
  }

  return Array.from(byEmployee.values())
    .map((item) => ({
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      totalActions: item.totalActions,
      comments: item.comments,
      moves: item.moves,
      creates: item.creates,
      reads: item.reads,
      lastActionAt: item.lastActionAt,
      clientsTouched: item.clientTitles.size,
      clientTitles: Array.from(item.clientTitles).sort((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .sort(
      (left, right) =>
        right.totalActions - left.totalActions ||
        right.moves - left.moves ||
        right.comments - left.comments ||
        left.employeeName.localeCompare(right.employeeName),
    );
}

function summarizeClients(items: ParsedActivityItem[]) {
  const byClient = new Map<
    string,
    {
      recordId: string | null;
      recordTitle: string;
      totalActions: number;
      comments: number;
      moves: number;
      creates: number;
      reads: number;
      lastActionAt: string;
      employees: Map<string, { employeeName: string; count: number }>;
    }
  >();

  for (const item of items) {
    const recordTitle = item.recordTitle?.trim();
    if (!recordTitle) {
      continue;
    }

    const key = item.recordId ?? recordTitle.toLowerCase();
    const current = byClient.get(key) ?? {
      recordId: item.recordId,
      recordTitle,
      totalActions: 0,
      comments: 0,
      moves: 0,
      creates: 0,
      reads: 0,
      lastActionAt: item.occurredAt,
      employees: new Map<string, { employeeName: string; count: number }>(),
    };

    current.totalActions += 1;
    if (item.kind === "comment") current.comments += 1;
    if (item.kind === "move") current.moves += 1;
    if (item.kind === "create") current.creates += 1;
    if (item.kind === "read") current.reads += 1;
    if (item.occurredAt > current.lastActionAt) current.lastActionAt = item.occurredAt;

    const employeeKey = item.employeeId ?? item.employeeName;
    const employee = current.employees.get(employeeKey) ?? {
      employeeName: item.employeeName,
      count: 0,
    };
    employee.count += 1;
    current.employees.set(employeeKey, employee);

    byClient.set(key, current);
  }

  return Array.from(byClient.values())
    .map((item) => ({
      recordId: item.recordId,
      recordTitle: item.recordTitle,
      totalActions: item.totalActions,
      comments: item.comments,
      moves: item.moves,
      creates: item.creates,
      reads: item.reads,
      lastActionAt: item.lastActionAt,
      employees: Array.from(item.employees.values())
        .sort(
          (left, right) =>
            right.count - left.count ||
            left.employeeName.localeCompare(right.employeeName),
        )
        .slice(0, 6),
    }))
    .sort(
      (left, right) =>
        right.totalActions - left.totalActions ||
        right.lastActionAt.localeCompare(left.lastActionAt) ||
        left.recordTitle.localeCompare(right.recordTitle),
    );
}

function matchesFocus(item: ParsedActivityItem, focus: ManagerReportFocus) {
  if (focus === "all" || focus === "timeline") {
    return true;
  }
  if (focus === "reads") {
    return item.kind === "read";
  }

  return item.kind === focus.slice(0, -1);
}

function normalizeValue(value: string) {
  return value.trim().toLowerCase();
}
