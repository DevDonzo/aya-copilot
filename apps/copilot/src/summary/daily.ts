import { NotFoundError } from "../app/errors.js";
import { findEmployeeById } from "../db.js";
import {
  countEventsByActionForEmployeeDay,
  countEventsBySourceForEmployeeDay,
  listEventsForEmployeeDay,
} from "../store/activity-store.js";

export async function buildEmployeeDaySummary(employeeId: string, date: string) {
  const employee = await findEmployeeById(employeeId);

  if (!employee) {
    throw new NotFoundError(`Employee not found: ${employeeId}`);
  }

  const [events, sourceCounts, actionCounts] = await Promise.all([
    listEventsForEmployeeDay(employeeId, date),
    countEventsBySourceForEmployeeDay(employeeId, date),
    countEventsByActionForEmployeeDay(employeeId, date),
  ]);

  const topActions = actionCounts
    .slice(0, 3)
    .map((item) => `${item.action_type} (${item.count})`)
    .join(", ");

  const headline =
    events.length === 0
      ? `${employee.display_name} has no logged activity for ${date}.`
      : `${employee.display_name} has ${events.length} logged events for ${date}. Top actions: ${topActions}.`;

  return {
    employeeId,
    employeeName: employee.display_name,
    date,
    eventCount: events.length,
    sourceCounts,
    actionCounts,
    latestEvents: events.slice(0, 10),
    summaryText: headline,
  };
}
