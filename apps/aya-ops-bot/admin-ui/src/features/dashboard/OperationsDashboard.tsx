import type {
  EmployeeActivityRow,
  EmployeeRow,
  ManagerReportResponse,
  OverviewResponse,
  SyncStateRow,
} from "../../lib/api";
import { formatAdminTime } from "../../lib/time";

type OperationsDashboardProps = {
  overview: OverviewResponse["overview"] | undefined;
  employees: EmployeeRow[];
  employeeActivity: EmployeeActivityRow[];
  managerReport: ManagerReportResponse | undefined;
  syncStates: SyncStateRow[];
  filters: {
    dateStart: string;
    dateEnd: string;
    employeeId: string;
    clientQuery: string;
    focus: "all" | "comments" | "moves" | "creates" | "reads" | "timeline";
  };
  onFiltersChange: (
    input: Partial<OperationsDashboardProps["filters"]>,
  ) => void;
  isLoading: boolean;
};

const FOCUS_OPTIONS = [
  { value: "all", label: "All activity" },
  { value: "comments", label: "Comments only" },
  { value: "moves", label: "Moves only" },
  { value: "creates", label: "Creates only" },
  { value: "reads", label: "Reads only" },
  { value: "timeline", label: "Timeline" },
] as const;

export function OperationsDashboard(props: OperationsDashboardProps) {
  const report = props.managerReport;
  const syncState = props.syncStates[0];
  const topEmployees = (report?.employees ?? []).slice(0, 5);
  const topClients = (report?.clients ?? []).slice(0, 5);
  const recentComments = (report?.timeline ?? [])
    .filter((item) => item.kind === "comment" || Boolean(item.text?.trim()))
    .slice(0, 6);
  const liveFeed = (report?.timeline ?? []).slice(0, 8);

  return (
    <section className="ops-dashboard">
      <section className="panel ops-hero-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Live filter</div>
            <h2>Filter the entire operation</h2>
            <p className="muted">
              Narrow the board by date, employee, client, or action type without switching
              screens.
            </p>
          </div>
          <span className={`status-chip ${props.isLoading ? "warn" : "ok"}`}>
            {props.isLoading ? "refreshing" : "live"}
          </span>
        </div>

        <div className="filter-grid dashboard-filter-grid">
          <label className="field-block">
            <span>Date start</span>
            <input
              type="date"
              value={props.filters.dateStart}
              onChange={(event) =>
                props.onFiltersChange({ dateStart: event.target.value })
              }
            />
          </label>
          <label className="field-block">
            <span>Date end</span>
            <input
              type="date"
              value={props.filters.dateEnd}
              onChange={(event) =>
                props.onFiltersChange({ dateEnd: event.target.value })
              }
            />
          </label>
          <label className="field-block">
            <span>Employee</span>
            <select
              value={props.filters.employeeId}
              onChange={(event) =>
                props.onFiltersChange({ employeeId: event.target.value })
              }
            >
              <option value="">All employees</option>
              {props.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-block">
            <span>Action type</span>
            <select
              value={props.filters.focus}
              onChange={(event) =>
                props.onFiltersChange({
                  focus: event.target.value as OperationsDashboardProps["filters"]["focus"],
                })
              }
            >
              {FOCUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-block field-block-wide">
            <span>Client search</span>
            <input
              value={props.filters.clientQuery}
              onChange={(event) =>
                props.onFiltersChange({ clientQuery: event.target.value })
              }
              placeholder="Search client title"
            />
          </label>
        </div>
      </section>

      <section className="ops-overview-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">People</div>
              <h2>Who is doing the work</h2>
            </div>
          </div>
          <div className="ops-stack">
            {topEmployees.map((employee) => (
              <article
                key={employee.employeeId ?? employee.employeeName}
                className="insight-card"
              >
                <div className="insight-card-head">
                  <strong>{employee.employeeName}</strong>
                  <span className="status-chip neutral">{employee.totalActions} actions</span>
                </div>
                <div className="insight-detail-row">
                  <span>
                    {employee.comments} comments · {employee.moves} moves · {employee.reads} reads
                  </span>
                  <span>{formatAdminTime(employee.lastActionAt)}</span>
                </div>
                <div className="chip-row">
                  {employee.clientTitles.slice(0, 4).map((title) => (
                    <span key={title} className="report-chip">
                      {formatRecordLabel(title, 42)}
                    </span>
                  ))}
                </div>
              </article>
            ))}
            {topEmployees.length === 0 ? (
              <div className="empty-state">No employee activity matched the current filters.</div>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Clients</div>
              <h2>Which files are moving</h2>
            </div>
          </div>
          <div className="ops-stack">
            {topClients.map((client) => (
              <article key={client.recordId ?? client.recordTitle} className="insight-card">
                <div className="insight-card-head">
                  <strong>{formatRecordLabel(client.recordTitle, 84)}</strong>
                  <span className="status-chip neutral">{client.totalActions} touches</span>
                </div>
                <div className="insight-detail-row">
                  <span>
                    {client.comments} comments · {client.moves} moves · {client.reads} reads
                  </span>
                  <span>{formatAdminTime(client.lastActionAt)}</span>
                </div>
                <div className="chip-row">
                  {client.employees.map((employee) => (
                    <span
                      key={`${client.recordTitle}-${employee.employeeName}`}
                      className="report-chip"
                    >
                      {employee.employeeName} ({employee.count})
                    </span>
                  ))}
                </div>
              </article>
            ))}
            {topClients.length === 0 ? (
              <div className="empty-state">No client activity matched the current filters.</div>
            ) : null}
          </div>
        </section>
      </section>

      <section className="ops-secondary-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Comments</div>
              <h2>What people actually wrote</h2>
              <p className="muted">
                Comment text is surfaced directly so the dashboard answers the manager question
                without digging.
              </p>
            </div>
          </div>
          <div className="ops-stack">
            {recentComments.map((item, index) => (
              <article
                key={`${item.occurredAt}-${item.employeeName}-${index}`}
                className="comment-card"
              >
                <div className="insight-card-head">
                  <strong>{item.employeeName}</strong>
                  <span className="status-chip kind-comment">Comment</span>
                </div>
                <div className="insight-detail-row">
                  <span>
                    {item.recordTitle ? formatRecordLabel(item.recordTitle, 92) : "General activity"}
                  </span>
                  <span>{formatAdminTime(item.occurredAt)}</span>
                </div>
                <p className="action-summary">{item.text?.trim() || item.summary}</p>
              </article>
            ))}
            {recentComments.length === 0 ? (
              <div className="empty-state">No comment activity matched the current filters.</div>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Status</div>
              <h2>System and team snapshot</h2>
            </div>
          </div>
          <div className="status-list">
            <div className="status-row">
              <span>Workspace</span>
              <strong>AYA sales CRM 3</strong>
            </div>
            <div className="status-row">
              <span>Last activity seen</span>
              <strong>{formatAdminTime(props.overview?.latestInteractionAt ?? null)}</strong>
            </div>
            <div className="status-row">
              <span>Last Blue sync</span>
              <strong>
                {formatAdminTime(syncState?.last_incremental_sync_at ?? syncState?.updated_at ?? null)}
              </strong>
            </div>
            <div className="status-row">
              <span>Planner low confidence</span>
              <strong>{props.overview?.planner.lowConfidenceCount ?? 0}</strong>
            </div>
            <div className="status-row">
              <span>Clarifications today</span>
              <strong>{props.overview?.planner.clarificationCount ?? 0}</strong>
            </div>
          </div>

          <div className="mini-metric-grid">
            <MiniMetric
              label="Success rate"
              value={`${Math.round(
                props.employeeActivity.reduce(
                  (sum, item) => sum + Number(item.success_rate ?? 0),
                  0,
                ) / Math.max(props.employeeActivity.length, 1),
              )}%`}
            />
            <MiniMetric
              label="Creates"
              value={report?.totals.creates ?? 0}
            />
            <MiniMetric
              label="Moves"
              value={report?.totals.moves ?? 0}
            />
            <MiniMetric
              label="Reads"
              value={report?.totals.reads ?? 0}
            />
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Live feed</div>
            <h2>Latest tracked work</h2>
            <p className="muted">
              Clear action cards showing who did what, on which client, and the captured text.
            </p>
          </div>
        </div>
        <div className="action-feed">
          {liveFeed.map((item, index) => (
            <article key={`${item.occurredAt}-${item.employeeName}-${index}`} className="action-card">
              <div className="action-card-head">
                <div>
                  <div className="action-title-row">
                    <strong>{item.employeeName}</strong>
                    <span className={`status-chip kind-${item.kind}`}>{formatKind(item.kind)}</span>
                  </div>
                  <div className="report-card-meta">
                    <span>{item.recordTitle ?? "General activity"}</span>
                    <span>{formatAdminTime(item.occurredAt)}</span>
                  </div>
                </div>
              </div>
              <p className="action-summary">{item.summary}</p>
              {item.text?.trim() ? (
                <div className="message-block">
                  <div className="message-sender">Comment made</div>
                  <p>{item.text}</p>
                </div>
              ) : null}
            </article>
          ))}
          {liveFeed.length === 0 ? (
            <div className="empty-state">No recent activity matched the current filters.</div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function MiniMetric(input: { label: string; value: number | string }) {
  return (
    <article className="mini-metric-card">
      <div className="metric-label">{input.label}</div>
      <div className="mini-metric-value">{input.value}</div>
    </article>
  );
}

function formatKind(kind: ManagerReportResponse["timeline"][number]["kind"]) {
  switch (kind) {
    case "comment":
      return "Comment";
    case "move":
      return "Move";
    case "create":
      return "Create";
    case "read":
      return "Read";
    default:
      return "Activity";
  }
}

function formatRecordLabel(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
