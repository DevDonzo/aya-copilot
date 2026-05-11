import type { NormalizedActivityEvent } from "../domain/types.js";
import {
  countEventsByActionForEmployeeDay as countEventsByActionForEmployeeDayRepo,
  countEventsByEmployeeForDay as countEventsByEmployeeForDayRepo,
  countEventsBySourceForEmployeeDay as countEventsBySourceForEmployeeDayRepo,
  insertActivityEvent as insertActivityEventRepo,
  listEmployeesWithoutActivityForDay as listEmployeesWithoutActivityForDayRepo,
  listEventsForDay as listEventsForDayRepo,
  listEventsForEmployeeDay as listEventsForEmployeeDayRepo,
} from "../db.js";

export async function insertActivityEvent(event: NormalizedActivityEvent) {
  return await insertActivityEventRepo(event);
}

export async function listEventsForEmployeeDay(employeeId: string, date: string) {
  return await listEventsForEmployeeDayRepo(employeeId, date);
}

export async function countEventsBySourceForEmployeeDay(
  employeeId: string,
  date: string,
) {
  return await countEventsBySourceForEmployeeDayRepo(employeeId, date);
}

export async function countEventsByActionForEmployeeDay(
  employeeId: string,
  date: string,
) {
  return await countEventsByActionForEmployeeDayRepo(employeeId, date);
}

export async function listEventsForDay(date: string, limit = 25) {
  return await listEventsForDayRepo(date, limit);
}

export async function countEventsByEmployeeForDay(date: string) {
  return await countEventsByEmployeeForDayRepo(date);
}

export async function listEmployeesWithoutActivityForDay(date: string) {
  return await listEmployeesWithoutActivityForDayRepo(date);
}
