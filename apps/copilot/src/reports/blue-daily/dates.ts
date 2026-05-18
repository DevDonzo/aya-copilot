import type { ReportWindow } from "./types.js";

export function getPreviousCalendarDate(
  now: Date,
  timezone = "America/Toronto",
) {
  return addCalendarDays(getLocalDateString(now, timezone), -1);
}

export function getReportWindow(input: {
  reportDate: string;
  timezone: string;
}): ReportWindow {
  const startUtcDate = zonedDateTimeToUtc(input.reportDate, input.timezone);
  const endUtcDate = zonedDateTimeToUtc(
    addCalendarDays(input.reportDate, 1),
    input.timezone,
  );

  return {
    reportDate: input.reportDate,
    timezone: input.timezone,
    startUtc: startUtcDate.toISOString(),
    endUtc: endUtcDate.toISOString(),
  };
}

export function addCalendarDays(dateIso: string, days: number) {
  const [year, month, day] = parseDateIso(dateIso);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(iso: string, days: number) {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString();
}

export function isIsoInRange(
  value: string | null | undefined,
  startInclusive: string,
  endExclusive: string,
) {
  return Boolean(
    value && value >= startInclusive && value < endExclusive,
  );
}

export function getLocalDateString(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function zonedDateTimeToUtc(dateIso: string, timezone: string) {
  const [year, month, day] = parseDateIso(dateIso);
  const localAsUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const firstOffset = getTimeZoneOffsetMs(new Date(localAsUtcMs), timezone);
  let utcMs = localAsUtcMs - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(utcMs), timezone);
  if (secondOffset !== firstOffset) {
    utcMs = localAsUtcMs - secondOffset;
  }
  return new Date(utcMs);
}

function getTimeZoneOffsetMs(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone);
  const zonedAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return zonedAsUtcMs - date.getTime();
}

function getZonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(values.get("hour") ?? "0");
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(values.get("minute") ?? "0"),
    second: Number(values.get("second") ?? "0"),
  };
}

function parseDateIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Report date must use YYYY-MM-DD format");
  }
  const [year, month, day] = value.split("-").map(Number);
  return [year!, month!, day!] as const;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
