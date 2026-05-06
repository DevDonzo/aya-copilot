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
  teamWorkloadById: Map<string, TeamWorkloadEmployee>;
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
  const workload = props.selectedEmployeeWorkload;
  const totalOpenWork = (workload?.openRecordCount ?? 0) + (workload?.openChecklistCount ?? 0);
  const nextDueRecord = [...(workload?.openRecords ?? [])]
    .filter((record) => record.dueAt)
    .sort((left, right) => left.dueAt!.localeCompare(right.dueAt!))[0];
  const nextDueTask = [...(workload?.checklistItems ?? [])]
    .filter((item) => item.dueAt)
    .sort((left, right) => left.dueAt!.localeCompare(right.dueAt!))[0];
  const nextDueLabel = nextDueTask?.dueAt ?? nextDueRecord?.dueAt;

  return (
    <section className="team-dashboard-stack">
      <section className="team-dashboard-summary">
        <SummaryCard label="Team members" value={props.totals?.employees ?? 0} />
        <SummaryCard label="People with work" value={props.totals?.employeesWithOpenWork ?? 0} />
        <SummaryCard label="Open files" value={props.totals?.openRecords ?? 0} />
        <SummaryCard label="Open tasks" value={props.totals?.openChecklistItems ?? 0} />
        <SummaryCard label="Overdue items" value={props.totals?.overdue ?? 0} tone="warn" />
      </section>

      <section className="detail-layout">
        <section className="panel detail-list-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <div className="eyebrow">Team</div>
              <h2>Workload by employee</h2>
            </div>
            <input
              value={props.employeeSearch}
              onChange={(event) => props.onEmployeeSearchChange(event.target.value)}
              placeholder="Search employee"
              className="employee-search"
            />
          </div>

          <div className="employee-roster-head">
            <span>Employee</span>
            <span>Open work</span>
            <span>Overdue</span>
          </div>

          <div className="detail-list employee-roster">
            {props.employees.map((employee) => {
              const selected = employee.employeeId === props.selectedEmployeeId;
              const employeeWorkload = props.teamWorkloadById.get(employee.employeeId) ?? null;
              const openCount =
                (employeeWorkload?.openRecordCount ?? 0) +
                (employeeWorkload?.openChecklistCount ?? 0);
              const overdue = employeeWorkload?.overdueCount ?? 0;
              const loadPercent = Math.min(100, openCount * 10 + overdue * 18);

              return (
                <button
                  key={employee.employeeId}
                  type="button"
                  className={`detail-list-item employee-row ${selected ? "selected" : ""}`}
                  onClick={() => props.onSelectEmployee(employee.employeeId)}
                >
                  <div className="employee-main">
                    <strong>{employee.displayName}</strong>
                    <div className="employee-subline">
                      {employee.roleName ?? "employee"} · last worked {formatAdminTime(employee.latestInteractionAt)}
                    </div>
                  </div>
                  <div className="employee-load-cell">
                    <span className="metric-inline">{openCount}</span>
                    <div className="load-meter" aria-hidden="true">
                      <span style={{ width: `${loadPercent}%` }} />
                    </div>
                  </div>
                  <div className={`employee-overdue-cell ${overdue > 0 ? "warn" : "ok"}`}>{overdue}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="detail-main team-detail-stack">
          <section className="panel detail-hero-panel">
            <div className="selected-employee-bar">
              <div>
                <div className="eyebrow">Selected employee</div>
                <h2>{props.selectedEmployee?.displayName ?? "Select an employee"}</h2>
                <p className="muted">{props.selectedEmployee?.email ?? "No synced email available"}</p>
              </div>
              <div className="detail-kpi-grid">
                <SummaryCard label="Assigned now" value={totalOpenWork} compact />
                <SummaryCard label="Files" value={workload?.openRecordCount ?? 0} compact />
                <SummaryCard label="Tasks" value={workload?.openChecklistCount ?? 0} compact />
                <SummaryCard label="Overdue" value={workload?.overdueCount ?? 0} compact tone="warn" />
              </div>
            </div>

            <div className="detail-summary-bar">
              <SummaryLine label="Actions" value={props.selectedEmployeeReport?.totalActions ?? 0} />
              <SummaryLine label="Files touched" value={props.selectedEmployeeReport?.clientsTouched ?? 0} />
              <SummaryLine label="Notes added" value={props.selectedEmployeeReport?.comments ?? 0} />
              <SummaryLine label="Moved" value={props.selectedEmployeeReport?.moves ?? 0} />
              <SummaryLine label="Next due" value={nextDueLabel ? nextDueLabel.slice(0, 10) : "Nothing due"} />
            </div>
          </section>

          <section className="assignment-grid">
            <section className="panel assignment-panel">
              <div className="panel-head compact-panel-head">
                <div>
                  <div className="eyebrow">Files</div>
                  <h2>Assigned files</h2>
                </div>
              </div>
              <div className="worksheet-head worksheet-three-col">
                <span>File</span>
                <span>Stage</span>
                <span>Due date</span>
              </div>
              <div className="assignment-stack">
                {workload?.openRecords.length ? (
                  workload.openRecords.map((record) => (
                    <article key={record.id} className="worksheet-row worksheet-three-col">
                      <div className="worksheet-primary">
                        <strong>{record.title}</strong>
                      </div>
                      <div className="worksheet-muted">{record.listTitle}</div>
                      <div className="worksheet-muted">
                        {record.dueAt ? record.dueAt.slice(0, 10) : "No due date"}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No files are assigned right now.</div>
                )}
              </div>
            </section>

            <section className="panel assignment-panel">
              <div className="panel-head compact-panel-head">
                <div>
                  <div className="eyebrow">Tasks</div>
                  <h2>Assigned checklist tasks</h2>
                </div>
              </div>
              <div className="worksheet-head worksheet-three-col">
                <span>Task</span>
                <span>Source</span>
                <span>Due date</span>
              </div>
              <div className="assignment-stack">
                {workload?.checklistItems.length ? (
                  workload.checklistItems.map((item) => (
                    <article key={item.id} className="worksheet-row worksheet-three-col">
                      <div className="worksheet-primary">
                        <strong>{item.title}</strong>
                        <div className="worksheet-subcopy">{item.listTitle} · {item.checklistTitle}</div>
                      </div>
                      <div className="worksheet-muted">{item.recordTitle}</div>
                      <div className="worksheet-muted">
                        {item.dueAt ? item.dueAt.slice(0, 10) : "No due date"}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No checklist tasks are assigned right now.</div>
                )}
              </div>
            </section>
          </section>

          <section className="panel assignment-panel">
            <div className="panel-head compact-panel-head">
              <div>
                <div className="eyebrow">Recent activity</div>
                <h2>Latest work log</h2>
              </div>
            </div>
            <div className="worksheet-head worksheet-activity-col">
              <span>Activity</span>
              <span>Record</span>
              <span>When</span>
            </div>
            <div className="assignment-stack">
              {props.employeeTimeline.length ? (
                props.employeeTimeline.map((item, index) => (
                  <article key={`${item.occurredAt}-${index}`} className="worksheet-row worksheet-activity-col">
                    <div className="worksheet-primary">
                      <strong>{item.summary}</strong>
                      {item.text ? <div className="worksheet-subcopy">{item.text}</div> : null}
                    </div>
                    <div className="worksheet-muted">{item.recordTitle ?? "No record"}</div>
                    <div className="worksheet-muted activity-meta">
                      <span>{item.kind}</span>
                      <span>{formatAdminTime(item.occurredAt)}</span>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">No recent activity has been recorded for this employee.</div>
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
    <div className={`team-summary-card ${input.compact ? "compact" : ""} ${input.tone === "warn" ? "warn" : ""}`}>
      <span className="metric-label">{input.label}</span>
      <strong>{input.value}</strong>
    </div>
  );
}

function SummaryLine(input: { label: string; value: number | string }) {
  return (
    <div className="summary-inline-block">
      <span className="summary-inline-label">{input.label}</span>
      <strong>{input.value}</strong>
    </div>
  );
}
