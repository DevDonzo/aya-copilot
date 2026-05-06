import type {
  ManagerReportResponse,
  TeamWorkloadEmployee,
} from "../../lib/api";
import { formatAdminTime } from "../../lib/time";

type DirectoryEmployee = {
  employeeId: string;
  displayName: string;
  email: string | null;
  roleName: string | null;
  interactionCount: number;
  successRate: number;
  latestInteractionAt: string | null;
};

type Props = {
  employees: DirectoryEmployee[];
  employeeSearch: string;
  onEmployeeSearchChange: (value: string) => void;
  selectedEmployeeId: string;
  onSelectEmployee: (employeeId: string) => void;
  selectedEmployee: DirectoryEmployee | null;
  selectedEmployeeWorkload: TeamWorkloadEmployee | null;
  selectedEmployeeReport: ManagerReportResponse["employees"][number] | null;
  employeeTimeline: ManagerReportResponse["timeline"];
  totals:
    | {
        employees: number;
        employeesWithOpenWork: number;
        openRecords: number;
        openChecklistItems: number;
        overdue: number;
      }
    | undefined;
};

export function TeamAssignmentDashboard(props: Props) {
  const totalOpenWork =
    (props.selectedEmployeeWorkload?.openRecordCount ?? 0) +
    (props.selectedEmployeeWorkload?.openChecklistCount ?? 0);

  return (
    <section className="team-dashboard-stack">
      <section className="team-dashboard-summary">
        <SummaryCard label="Employees" value={props.totals?.employees ?? 0} />
        <SummaryCard
          label="With open work"
          value={props.totals?.employeesWithOpenWork ?? 0}
        />
        <SummaryCard label="Open records" value={props.totals?.openRecords ?? 0} />
        <SummaryCard
          label="Checklist items"
          value={props.totals?.openChecklistItems ?? 0}
        />
        <SummaryCard label="Overdue" value={props.totals?.overdue ?? 0} tone="warn" />
      </section>

      <section className="detail-layout">
        <section className="panel detail-list-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Employees</div>
              <h2>Assignments by employee</h2>
            </div>
            <input
              value={props.employeeSearch}
              onChange={(event) => props.onEmployeeSearchChange(event.target.value)}
              placeholder="Search employee"
              className="employee-search"
            />
          </div>
          <div className="detail-list">
            {props.employees.map((employee) => {
              const selected = employee.employeeId === props.selectedEmployeeId;
              const workload =
                employee.employeeId === props.selectedEmployeeWorkload?.employeeId
                  ? props.selectedEmployeeWorkload
                  : null;
              const openCount =
                (workload?.openRecordCount ?? 0) + (workload?.openChecklistCount ?? 0);
              return (
                <button
                  key={employee.employeeId}
                  type="button"
                  className={`detail-list-item ${selected ? "selected" : ""}`}
                  onClick={() => props.onSelectEmployee(employee.employeeId)}
                >
                  <div className="detail-list-head">
                    <strong>{employee.displayName}</strong>
                    <span className="status-chip neutral">
                      {employee.roleName ?? "employee"}
                    </span>
                  </div>
                  <div className="detail-list-meta">
                    <span>{openCount} open items</span>
                    <span>{employee.interactionCount} actions</span>
                  </div>
                  <div className="detail-list-foot">
                    Last activity {formatAdminTime(employee.latestInteractionAt)}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="detail-main team-detail-stack">
          <section className="panel detail-hero-panel">
            <div className="detail-hero">
              <div>
                <div className="eyebrow">Selected employee</div>
                <h2>{props.selectedEmployee?.displayName ?? "Select an employee"}</h2>
                <p className="muted">
                  {props.selectedEmployee?.email ?? "No synced email available"}
                </p>
              </div>
              <div className="detail-kpi-grid">
                <SummaryCard label="Open work" value={totalOpenWork} compact />
                <SummaryCard
                  label="Open records"
                  value={props.selectedEmployeeWorkload?.openRecordCount ?? 0}
                  compact
                />
                <SummaryCard
                  label="Checklist items"
                  value={props.selectedEmployeeWorkload?.openChecklistCount ?? 0}
                  compact
                />
                <SummaryCard
                  label="Overdue"
                  value={props.selectedEmployeeWorkload?.overdueCount ?? 0}
                  compact
                  tone="warn"
                />
              </div>
            </div>

            <div className="chip-row">
              <span className="report-chip">
                Actions: {props.selectedEmployeeReport?.totalActions ?? 0}
              </span>
              <span className="report-chip">
                Clients touched: {props.selectedEmployeeReport?.clientsTouched ?? 0}
              </span>
              <span className="report-chip">
                Comments: {props.selectedEmployeeReport?.comments ?? 0}
              </span>
              <span className="report-chip">
                Moves: {props.selectedEmployeeReport?.moves ?? 0}
              </span>
            </div>
          </section>

          <section className="assignment-grid">
            <section className="panel assignment-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">Open records</div>
                  <h2>Current assigned files</h2>
                </div>
              </div>
              <div className="assignment-stack">
                {props.selectedEmployeeWorkload?.openRecords.length ? (
                  props.selectedEmployeeWorkload.openRecords.map((record) => (
                    <article key={record.id} className="assignment-card">
                      <strong>{record.title}</strong>
                      <div className="detail-list-meta">
                        <span>{record.listTitle}</span>
                        <span>
                          {record.dueAt ? `Due ${record.dueAt.slice(0, 10)}` : "No due date"}
                        </span>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No open records assigned.</div>
                )}
              </div>
            </section>

            <section className="panel assignment-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">Checklist work</div>
                  <h2>Assigned tasks</h2>
                </div>
              </div>
              <div className="assignment-stack">
                {props.selectedEmployeeWorkload?.checklistItems.length ? (
                  props.selectedEmployeeWorkload.checklistItems.map((item) => (
                    <article key={item.id} className="assignment-card">
                      <strong>{item.title}</strong>
                      <div className="detail-list-meta">
                        <span>{item.recordTitle}</span>
                        <span>
                          {item.dueAt ? `Due ${item.dueAt.slice(0, 10)}` : "No due date"}
                        </span>
                      </div>
                      <div className="detail-list-foot">
                        {item.listTitle} · {item.checklistTitle}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No open checklist items assigned.</div>
                )}
              </div>
            </section>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Recent work</div>
                <h2>What they did</h2>
                <p className="muted">Latest recorded actions for the selected employee.</p>
              </div>
            </div>
            <div className="assignment-stack">
              {props.employeeTimeline.length ? (
                props.employeeTimeline.map((item, index) => (
                  <article key={`${item.occurredAt}-${index}`} className="assignment-card">
                    <strong>{item.summary}</strong>
                    <div className="detail-list-meta">
                      <span>{item.kind}</span>
                      <span>{formatAdminTime(item.occurredAt)}</span>
                    </div>
                    <div className="detail-list-foot">
                      {item.recordTitle ?? "No record"}
                      {item.text ? ` · ${item.text}` : ""}
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">No recent actions for this employee.</div>
              )}
            </div>
          </section>
        </section>
      </section>
    </section>
  );
}

function SummaryCard(input: {
  label: string;
  value: number;
  compact?: boolean;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={`team-summary-card ${input.compact ? "compact" : ""} ${
        input.tone === "warn" ? "warn" : ""
      }`}
    >
      <span className="metric-label">{input.label}</span>
      <strong>{input.value}</strong>
    </div>
  );
}
