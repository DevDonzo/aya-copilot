import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { TeamAssignmentDashboard } from "../features/dashboard/TeamAssignmentDashboard";
import { SyncControlCenter } from "../features/sync/SyncControlCenter";
import {
  fetchAuthMe,
  fetchEmployeeActivity,
  fetchEmployees,
  fetchManagerReport,
  fetchOverview,
  fetchTeamWorkload,
  login,
  logout,
  runBlueActivitySync,
  runEmployeeSync,
  runWorkspaceIndexSync,
  type EmployeeActivityRow,
  type EmployeeRow,
  type ManagerReportResponse,
} from "../lib/api";
import { formatAdminTime, timestampMs } from "../lib/time";

type AdminView = "team" | "system";

type TeamDirectoryEmployee = {
  employeeId: string;
  displayName: string;
  email: string | null;
  roleName: string | null;
  interactionCount: number;
  successRate: number;
  latestInteractionAt: string | null;
};

const VIEW_COPY: Record<
  AdminView,
  {
    label: string;
    title: string;
    description: string;
  }
> = {
  team: {
    label: "Team",
    title: "Employee work view",
    description:
      "See each employee, what they are assigned, what is overdue, and what they worked on most recently.",
  },
  system: {
    label: "Sync",
    title: "Read-only sync control",
    description:
      "Refresh local reporting data and inspect sync health without writing back to Blue.",
  },
};

export function App() {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<AdminView>("team");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [dashboardFilters, setDashboardFilters] = useState({
    dateStart: new Date().toISOString().slice(0, 10),
    dateEnd: new Date().toISOString().slice(0, 10),
    employeeId: "",
    clientQuery: "",
    focus: "all" as const,
  });
  const [loginForm, setLoginForm] = useState({
    employeeName: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);

  const authQuery = useQuery({
    queryKey: ["auth"],
    queryFn: fetchAuthMe,
  });

  const isAdmin =
    authQuery.data?.authenticated === true &&
    authQuery.data.employee?.roleName === "admin";

  const overviewQuery = useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    enabled: isAdmin,
  });

  const employeeActivityQuery = useQuery({
    queryKey: ["employee-activity"],
    queryFn: fetchEmployeeActivity,
    enabled: isAdmin,
  });

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: fetchEmployees,
    enabled: isAdmin,
  });

  const managerReportQuery = useQuery({
    queryKey: ["manager-report", dashboardFilters],
    queryFn: () =>
      fetchManagerReport({
        dateStart: dashboardFilters.dateStart,
        dateEnd: dashboardFilters.dateEnd,
        employeeId: dashboardFilters.employeeId || undefined,
        clientQuery: dashboardFilters.clientQuery || undefined,
        focus: dashboardFilters.focus,
      }),
    enabled: isAdmin,
  });

  const teamWorkloadQuery = useQuery({
    queryKey: ["team-workload"],
    queryFn: fetchTeamWorkload,
    enabled: isAdmin,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      setError(null);
      await refreshAll(queryClient);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Login failed");
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      setError(null);
      queryClient.removeQueries();
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: onMutationError,
  });

  const workspaceSyncMutation = useMutation({
    mutationFn: async (forceFull: boolean) => {
      setRunningAction(forceFull ? "workspace-index-full" : "workspace-index");
      return await runWorkspaceIndexSync({ forceFull });
    },
    onSuccess: async () => {
      setError(null);
      setRunningAction(null);
      await refreshAdminData(queryClient);
    },
    onError: (caught) => {
      setRunningAction(null);
      onMutationError(caught);
    },
  });

  const employeeSyncMutation = useMutation({
    mutationFn: async () => {
      setRunningAction("employees");
      return await runEmployeeSync();
    },
    onSuccess: async () => {
      setError(null);
      setRunningAction(null);
      await refreshAdminData(queryClient);
    },
    onError: (caught) => {
      setRunningAction(null);
      onMutationError(caught);
    },
  });

  const activitySyncMutation = useMutation({
    mutationFn: async () => {
      setRunningAction("activity");
      return await runBlueActivitySync();
    },
    onSuccess: async () => {
      setError(null);
      setRunningAction(null);
      await refreshAdminData(queryClient);
    },
    onError: (caught) => {
      setRunningAction(null);
      onMutationError(caught);
    },
  });

  const loading =
    authQuery.isLoading ||
    (isAdmin &&
      (overviewQuery.isLoading ||
        employeeActivityQuery.isLoading ||
        employeesQuery.isLoading ||
        managerReportQuery.isLoading ||
        teamWorkloadQuery.isLoading));

  const directory = useMemo(
    () =>
      buildEmployeeDirectory({
        employees: employeesQuery.data?.items ?? [],
        activity: employeeActivityQuery.data?.items ?? [],
        search: employeeSearch,
      }),
    [employeeActivityQuery.data?.items, employeeSearch, employeesQuery.data?.items],
  );

  const teamWorkloadById = useMemo(
    () =>
      new Map(
        (teamWorkloadQuery.data?.employees ?? []).map((employee) => [
          employee.employeeId,
          employee,
        ]),
      ),
    [teamWorkloadQuery.data?.employees],
  );

  const teamDirectory = useMemo(() => {
    const items = [...directory];
    items.sort((left, right) => {
      const leftWorkload = teamWorkloadById.get(left.employeeId);
      const rightWorkload = teamWorkloadById.get(right.employeeId);
      const leftCount =
        (leftWorkload?.openRecordCount ?? 0) + (leftWorkload?.openChecklistCount ?? 0);
      const rightCount =
        (rightWorkload?.openRecordCount ?? 0) + (rightWorkload?.openChecklistCount ?? 0);
      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }

      const latestDelta =
        timestampMs(right.latestInteractionAt) -
        timestampMs(left.latestInteractionAt);
      if (latestDelta !== 0) {
        return latestDelta;
      }

      return left.displayName.localeCompare(right.displayName);
    });
    return items;
  }, [directory, teamWorkloadById]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    if (
      selectedEmployeeId &&
      teamDirectory.some((employee) => employee.employeeId === selectedEmployeeId)
    ) {
      return;
    }

    setSelectedEmployeeId(teamDirectory[0]?.employeeId ?? "");
  }, [isAdmin, selectedEmployeeId, teamDirectory]);

  const selectedEmployee = teamDirectory.find(
    (employee) => employee.employeeId === selectedEmployeeId,
  );

  const selectedEmployeeWorkload = selectedEmployeeId
    ? teamWorkloadById.get(selectedEmployeeId) ?? null
    : null;

  const selectedEmployeeReport = useMemo(() => {
    if (!selectedEmployeeId) {
      return null;
    }

    return (
      managerReportQuery.data?.employees.find(
        (employee) => employee.employeeId === selectedEmployeeId,
      ) ?? null
    );
  }, [managerReportQuery.data?.employees, selectedEmployeeId]);

  const employeeTimeline = useMemo(() => {
    if (!selectedEmployeeId) {
      return [];
    }

    return (managerReportQuery.data?.timeline ?? []).filter(
      (item) => item.employeeId === selectedEmployeeId,
    );
  }, [managerReportQuery.data?.timeline, selectedEmployeeId]);

  const latestSyncAt = useMemo(() => {
    const states = overviewQuery.data?.sync.states ?? [];
    return states
      .map((state) => state.last_incremental_sync_at ?? state.updated_at)
      .filter(Boolean)
      .sort()
      .at(-1);
  }, [overviewQuery.data?.sync.states]);

  const viewMeta = VIEW_COPY[activeView];

  return (
    <main className="shell dashboard-shell">
      <section className="dashboard-header panel">
        <div className="dashboard-header-copy">
          <div className="eyebrow">Aya Operations</div>
          <h1>Blue operations workspace</h1>
          <p className="lede">
            Open the employee workload dashboard directly. See who has work assigned, what is
            overdue, and what each person has been working on.
          </p>
        </div>

        <div className="dashboard-header-actions">
          <div className="header-stat-card">
            <span className="metric-label">Workspace</span>
            <strong>03 - AYA x Hamza/ AI</strong>
            <span className="muted">read-only reporting</span>
          </div>
          <div className="header-stat-card">
            <span className="metric-label">Last sync</span>
            <strong>{formatAdminTime(latestSyncAt ?? null)}</strong>
            <span className={`status-chip ${loading ? "warn" : "ok"}`}>
              {loading ? "refreshing" : "live"}
            </span>
          </div>
          <div className="header-button-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => void refreshAll(queryClient)}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            {authQuery.data?.authenticated ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => void logoutMutation.mutateAsync()}
                disabled={logoutMutation.isPending}
              >
                {logoutMutation.isPending ? "Logging out..." : "Logout"}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <div className="loading-bar">Loading operations dashboard…</div> : null}

      {!isAdmin ? (
        <section className="panel login-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Private Access</div>
              <h2>Manager sign-in</h2>
              <p className="muted">
                Sign in to open the local operations dashboard for the Aya team.
              </p>
            </div>
          </div>
          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              loginMutation.mutate(loginForm);
            }}
          >
            <input
              value={loginForm.employeeName}
              onChange={(event) =>
                setLoginForm((current) => ({
                  ...current,
                  employeeName: event.target.value,
                }))
              }
              placeholder="Employee name"
            />
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              placeholder="Password"
            />
            <button
              type="submit"
              className="primary-button"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Signing in..." : "Open dashboard"}
            </button>
          </form>
        </section>
      ) : null}

      {isAdmin ? (
        <>
          <section className="workspace-nav panel">
            <div>
              <div className="eyebrow">{viewMeta.label}</div>
              <h2>{viewMeta.title}</h2>
              <p className="muted">{viewMeta.description}</p>
            </div>
            <nav className="view-tabs top-nav-tabs">
              <ViewTab
                label="Team"
                active={activeView === "team"}
                onClick={() => setActiveView("team")}
              />
              <ViewTab
                label="Sync"
                active={activeView === "system"}
                onClick={() => setActiveView("system")}
              />
            </nav>
          </section>

          {activeView === "team" ? (
            <TeamAssignmentDashboard
              employees={teamDirectory}
              employeeSearch={employeeSearch}
              onEmployeeSearchChange={setEmployeeSearch}
              selectedEmployeeId={selectedEmployeeId}
              onSelectEmployee={setSelectedEmployeeId}
              selectedEmployee={selectedEmployee ?? null}
              selectedEmployeeWorkload={selectedEmployeeWorkload}
              selectedEmployeeReport={selectedEmployeeReport}
              employeeTimeline={employeeTimeline}
              totals={teamWorkloadQuery.data?.totals}
            />
          ) : null}

          {activeView === "system" ? (
            <section className="system-layout">
              <section className="summary-strip">
                <MetricCard label="Employees" value={employeesQuery.data?.items.length ?? 0} />
                <MetricCard
                  label="Active today"
                  value={overviewQuery.data?.overview.activeEmployees ?? 0}
                />
                <MetricCard
                  label="Clarifications"
                  value={overviewQuery.data?.overview.planner.clarificationCount ?? 0}
                />
                <MetricCard
                  label="Low confidence"
                  value={overviewQuery.data?.overview.planner.lowConfidenceCount ?? 0}
                />
              </section>

              <SyncControlCenter
                states={overviewQuery.data?.sync.states ?? []}
                webhooks={overviewQuery.data?.sync.webhooks ?? []}
                runningAction={runningAction}
                onWorkspaceIndexSync={(forceFull) => {
                  workspaceSyncMutation.mutate(forceFull);
                }}
                onEmployeeSync={() => {
                  employeeSyncMutation.mutate();
                }}
                onBlueActivitySync={() => {
                  activitySyncMutation.mutate();
                }}
              />
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );

  function onMutationError(caught: unknown) {
    setError(caught instanceof Error ? caught.message : "Request failed");
  }
}

function ViewTab(input: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`view-tab ${input.active ? "active" : ""}`}
      onClick={input.onClick}
    >
      {input.label}
    </button>
  );
}

function MetricCard(input: { label: string; value: number | string }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{input.label}</div>
      <div className="metric-value">{input.value}</div>
    </article>
  );
}

function buildEmployeeDirectory(input: {
  employees: EmployeeRow[];
  activity: EmployeeActivityRow[];
  search: string;
}) {
  const byId = new Map<string, TeamDirectoryEmployee>();

  for (const employee of input.employees) {
    byId.set(employee.id, {
      employeeId: employee.id,
      displayName: employee.display_name,
      email: employee.email,
      roleName: employee.role_name,
      interactionCount: 0,
      successRate: 0,
      latestInteractionAt: null,
    });
  }

  for (const activity of input.activity) {
    const existing = byId.get(activity.employee_id);
    byId.set(activity.employee_id, {
      employeeId: activity.employee_id,
      displayName: activity.display_name,
      email: existing?.email ?? null,
      roleName: activity.role_name ?? existing?.roleName ?? null,
      interactionCount: activity.interaction_count ?? 0,
      successRate: Number(activity.success_rate ?? 0),
      latestInteractionAt: activity.latest_interaction_at,
    });
  }

  const search = input.search.trim().toLowerCase();

  return Array.from(byId.values())
    .filter((employee) => {
      if (!search) {
        return true;
      }

      return `${employee.displayName} ${employee.email ?? ""}`
        .toLowerCase()
        .includes(search);
    })
    .sort((left, right) => {
      const latestDelta =
        timestampMs(right.latestInteractionAt) -
        timestampMs(left.latestInteractionAt);
      if (latestDelta !== 0) {
        return latestDelta;
      }

      return left.displayName.localeCompare(right.displayName);
    });
}

async function refreshAll(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["auth"] }),
    refreshAdminData(queryClient),
  ]);
}

async function refreshAdminData(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["overview"] }),
    queryClient.invalidateQueries({ queryKey: ["employee-activity"] }),
    queryClient.invalidateQueries({ queryKey: ["employees"] }),
    queryClient.invalidateQueries({ queryKey: ["manager-report"] }),
    queryClient.invalidateQueries({ queryKey: ["team-workload"] }),
  ]);
}
