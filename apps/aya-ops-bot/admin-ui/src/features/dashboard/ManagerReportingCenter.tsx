import type { EmployeeRow, ManagerReportResponse } from "../../lib/api";
import { formatAdminTime } from "../../lib/time";

type ManagerReportingCenterProps = {
  report: ManagerReportResponse | undefined;
  employees: EmployeeRow[];
  filters: {
    dateStart: string;
    dateEnd: string;
    employeeId: string;
    clientQuery: string;
    focus: "all" | "comments" | "moves" | "creates" | "reads" | "timeline";
  };
  onFiltersChange: (
    input: Partial<ManagerReportingCenterProps["filters"]>,
  ) => void;
  isLoading: boolean;
};

const FOCUS_OPTIONS = [
  { value: "all", label: "All activity" },
  { value: "comments", label: "Comments" },
  { value: "moves", label: "Moves" },
  { value: "creates", label: "Creates" },
  { value: "reads", label: "Reads" },
  { value: "timeline", label: "Timeline" },
] as const;

export function ManagerReportingCenter(props: ManagerReportingCenterProps) {
  const report = props.report;

  return (
    <section className="manager-reporting-layout">
      <section className="panel manager-report-hero">
        <div className="panel-head">
          <div>
            <div className="sidebar-label">Manager Reporting</div>
            <h2>Employee and client activity</h2>
            <p className="muted">
              Filter who touched which client, what they did, and when they did it.
            </p>
          </div>
          <span className="status-chip info">
            {props.isLoading ? "refreshing" : `${report?.totals.totalActions ?? 0} actions`}
          </span>
        </div>

        <div className="filter-grid manager-filter-grid">
          <input
            type="date"
            value={props.filters.dateStart}
            onChange={(event) =>
              props.onFiltersChange({ dateStart: event.target.value })
            }
          />
          <input
            type="date"
            value={props.filters.dateEnd}
            onChange={(event) =>
              props.onFiltersChange({ dateEnd: event.target.value })
            }
          />
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
          <select
            value={props.filters.focus}
            onChange={(event) =>
              props.onFiltersChange({
                focus: event.target.value as ManagerReportingCenterProps["filters"]["focus"],
              })
            }
          >
            {FOCUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            value={props.filters.clientQuery}
            onChange={(event) =>
              props.onFiltersChange({ clientQuery: event.target.value })
            }
            placeholder="Filter by client name"
          />
        </div>

        <div className="reporting-metrics">
          <Metric label="Employees Active" value={report?.totals.employeesActive ?? 0} />
          <Metric label="Clients Touched" value={report?.totals.clientsTouched ?? 0} />
          <Metric label="Comments" value={report?.totals.comments ?? 0} />
          <Metric label="Moves" value={report?.totals.moves ?? 0} />
        </div>

        <div className="reporting-callout">
          This view is based on tracked Aya actions. It shows who touched which client and when;
          it is not yet a full live workload board of every assigned file in Blue.
        </div>
      </section>

      <section className="manager-report-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Employees</h2>
              <p className="muted">
                Ranked by tracked activity in the selected range.
              </p>
            </div>
          </div>
          <div className="reporting-stack">
            {(report?.employees ?? []).length === 0 ? (
              <div className="empty-state">No employee activity matched these filters.</div>
            ) : (
              report?.employees.map((employee) => (
                <article key={employee.employeeId ?? employee.employeeName} className="report-card">
                  <div className="report-card-head">
                    <strong>{employee.employeeName}</strong>
                    <span className="status-chip neutral">
                      {employee.totalActions} action{employee.totalActions === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="report-card-meta">
                    <span>
                      {employee.comments} comments · {employee.moves} moves · {employee.creates} creates ·{" "}
                      {employee.reads} reads
                    </span>
                    <span>{formatAdminTime(employee.lastActionAt)}</span>
                  </div>
                  <div className="report-card-meta">
                    <span>{employee.clientsTouched} clients touched</span>
                  </div>
                  {employee.clientTitles.length > 0 ? (
                    <div className="report-chip-row">
                      {employee.clientTitles.slice(0, 6).map((title) => (
                        <span key={title} className="report-chip">
                          {title}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Clients</h2>
              <p className="muted">
                Which files were touched and by whom.
              </p>
            </div>
          </div>
          <div className="reporting-stack">
            {(report?.clients ?? []).length === 0 ? (
              <div className="empty-state">No client activity matched these filters.</div>
            ) : (
              report?.clients.map((client) => (
                <article key={client.recordId ?? client.recordTitle} className="report-card">
                  <div className="report-card-head">
                    <strong>{client.recordTitle}</strong>
                    <span className="status-chip neutral">
                      {client.totalActions} touch{client.totalActions === 1 ? "" : "es"}
                    </span>
                  </div>
                  <div className="report-card-meta">
                    <span>
                      {client.comments} comments · {client.moves} moves · {client.creates} creates ·{" "}
                      {client.reads} reads
                    </span>
                    <span>{formatAdminTime(client.lastActionAt)}</span>
                  </div>
                  <div className="report-chip-row">
                    {client.employees.map((employee) => (
                      <span key={`${client.recordTitle}-${employee.employeeName}`} className="report-chip">
                        {employee.employeeName} ({employee.count})
                      </span>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Timeline</h2>
            <p className="muted">
              Raw tracked actions in time order for manager review.
            </p>
          </div>
        </div>
        <div className="reporting-stack">
          {(report?.timeline ?? []).length === 0 ? (
            <div className="empty-state">No timeline items matched these filters.</div>
          ) : (
            report?.timeline.map((item, index) => (
              <article key={`${item.occurredAt}-${item.employeeName}-${index}`} className="timeline-card">
                <div className="report-card-head">
                  <strong>{item.employeeName}</strong>
                  <span className="status-chip neutral">{item.kind}</span>
                </div>
                <div className="report-card-meta">
                  <span>{item.recordTitle ?? "General activity"}</span>
                  <span>{formatAdminTime(item.occurredAt)}</span>
                </div>
                <p className="muted report-card-copy">{item.summary}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  );
}

function Metric(input: { label: string; value: number }) {
  return (
    <article className="metric-card reporting-metric">
      <div className="metric-label">{input.label}</div>
      <div className="metric-value">{input.value}</div>
    </article>
  );
}
