import {
  countEventsByEmployeeForDay,
  listEmployeesWithoutActivityForDay,
  listEventsForDay,
} from "../store/activity-store.js";

export async function buildTeamDaySummary(date: string) {
  const [counts, latestEvents] = await Promise.all([
    countEventsByEmployeeForDay(date),
    listEventsForDay(date, 10),
  ]);

  const topPeople = counts
    .slice(0, 5)
    .map((item) => `${item.employee_name} (${item.count})`)
    .join(", ");

  const summaryText =
    counts.length === 0
      ? `No logged team activity for ${date}.`
      : `Team activity for ${date}: ${counts.length} active employees. Top activity: ${topPeople}.`;

  return {
    date,
    activeEmployees: counts.length,
    employeeCounts: counts,
    latestEvents,
    summaryText,
  };
}

export async function buildNoActivitySummary(date: string) {
  const inactiveEmployees = await listEmployeesWithoutActivityForDay(date);
  const summaryText =
    inactiveEmployees.length === 0
      ? `Everyone has logged activity for ${date}.`
      : `${inactiveEmployees.length} employees have no logged activity for ${date}: ${inactiveEmployees
          .map((item) => item.display_name)
          .join(", ")}.`;

  return {
    date,
    inactiveCount: inactiveEmployees.length,
    inactiveEmployees,
    summaryText,
  };
}
