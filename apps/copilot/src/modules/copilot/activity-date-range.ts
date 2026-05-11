export interface ActivityDateRange {
  dateStart: string;
  dateEnd: string;
  dateLabel: string;
}

export const ACTIVITY_DATE_MESSAGE_PATTERN = String.raw`(?:today|yesterday|this week|last week|this month|last month|last \d+ days|on \d{4}-\d{2}-\d{2}|from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}|between \d{4}-\d{2}-\d{2} and \d{4}-\d{2}-\d{2})`;

export const OPTIONAL_ACTIVITY_DATE_SUFFIX_PATTERN = String.raw`(?: ${ACTIVITY_DATE_MESSAGE_PATTERN})?`;

export function resolveActivityDateRangeFromMessage(
  message: string,
  nowIso: string,
): ActivityDateRange {
  const normalized = message.trim().toLowerCase();
  const today = getIsoDate(nowIso);

  const explicitRange = extractExplicitIsoRange(normalized);
  if (explicitRange) {
    return {
      dateStart: explicitRange.dateStart,
      dateEnd: explicitRange.dateEnd,
      dateLabel: `${explicitRange.dateStart} to ${explicitRange.dateEnd}`,
    };
  }

  const trailingDays = extractTrailingDays(normalized);
  if (trailingDays) {
    return {
      dateStart: shiftIsoDate(today, -(trailingDays - 1)),
      dateEnd: today,
      dateLabel: `last ${trailingDays} days`,
    };
  }

  if (normalized.includes("yesterday")) {
    const date = shiftIsoDate(today, -1);
    return {
      dateStart: date,
      dateEnd: date,
      dateLabel: "yesterday",
    };
  }

  if (normalized.includes("this week")) {
    return {
      dateStart: startOfIsoWeek(today),
      dateEnd: today,
      dateLabel: "this week",
    };
  }

  if (normalized.includes("last week")) {
    const lastWeekEnd = shiftIsoDate(startOfIsoWeek(today), -1);
    return {
      dateStart: startOfIsoWeek(lastWeekEnd),
      dateEnd: lastWeekEnd,
      dateLabel: "last week",
    };
  }

  if (normalized.includes("this month")) {
    return {
      dateStart: startOfIsoMonth(today),
      dateEnd: today,
      dateLabel: "this month",
    };
  }

  if (normalized.includes("last month")) {
    const lastMonthEnd = shiftIsoDate(startOfIsoMonth(today), -1);
    return {
      dateStart: startOfIsoMonth(lastMonthEnd),
      dateEnd: endOfIsoMonth(lastMonthEnd),
      dateLabel: "last month",
    };
  }

  const explicitDate = extractExplicitIsoDate(normalized);
  if (explicitDate) {
    return {
      dateStart: explicitDate,
      dateEnd: explicitDate,
      dateLabel: explicitDate,
    };
  }

  return {
    dateStart: today,
    dateEnd: today,
    dateLabel: "today",
  };
}

export function normalizeActivityDateRange(input: {
  date?: string;
  dateStart?: string;
  dateEnd?: string;
  dateLabel?: string;
  nowIso?: string;
}): ActivityDateRange {
  if (input.dateStart?.trim() && input.dateEnd?.trim()) {
    const normalizedRange = sortIsoRange(
      input.dateStart.trim(),
      input.dateEnd.trim(),
    );
    return {
      dateStart: normalizedRange.dateStart,
      dateEnd: normalizedRange.dateEnd,
      dateLabel:
        input.dateLabel?.trim() ||
        formatExplicitRangeLabel(
          normalizedRange.dateStart,
          normalizedRange.dateEnd,
        ),
    };
  }

  if (input.date?.trim()) {
    const date = input.date.trim();
    return {
      dateStart: date,
      dateEnd: date,
      dateLabel: input.dateLabel?.trim() || date,
    };
  }

  const nowIso = input.nowIso ?? new Date().toISOString();
  return resolveActivityDateRangeFromMessage("", nowIso);
}

function extractExplicitIsoDate(value: string) {
  return value.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? null;
}

function extractExplicitIsoRange(value: string) {
  const matched =
    value.match(
      /\bfrom\s+(20\d{2}-\d{2}-\d{2})\s+to\s+(20\d{2}-\d{2}-\d{2})\b/,
    ) ??
    value.match(
      /\bbetween\s+(20\d{2}-\d{2}-\d{2})\s+and\s+(20\d{2}-\d{2}-\d{2})\b/,
    );

  if (!matched) {
    return null;
  }

  return sortIsoRange(matched[1], matched[2]);
}

function extractTrailingDays(value: string) {
  const days = Number(value.match(/\blast\s+(\d+)\s+days?\b/)?.[1] ?? "");
  if (!Number.isInteger(days) || days < 1) {
    return null;
  }

  return Math.min(days, 90);
}

function getIsoDate(nowIso: string) {
  return new Date(nowIso).toISOString().slice(0, 10);
}

function shiftIsoDate(date: string, days: number) {
  const normalized = new Date(`${date}T00:00:00.000Z`);
  normalized.setUTCDate(normalized.getUTCDate() + days);
  return normalized.toISOString().slice(0, 10);
}

function startOfIsoWeek(date: string) {
  const normalized = new Date(`${date}T00:00:00.000Z`);
  const day = normalized.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  normalized.setUTCDate(normalized.getUTCDate() + offset);
  return normalized.toISOString().slice(0, 10);
}

function startOfIsoMonth(date: string) {
  return `${date.slice(0, 8)}01`;
}

function endOfIsoMonth(date: string) {
  const normalized = new Date(`${startOfIsoMonth(date)}T00:00:00.000Z`);
  normalized.setUTCMonth(normalized.getUTCMonth() + 1);
  normalized.setUTCDate(0);
  return normalized.toISOString().slice(0, 10);
}

function formatExplicitRangeLabel(dateStart: string, dateEnd: string) {
  return dateStart === dateEnd ? dateStart : `${dateStart} to ${dateEnd}`;
}

function sortIsoRange(dateStart: string, dateEnd: string) {
  return dateStart <= dateEnd
    ? { dateStart, dateEnd }
    : { dateStart: dateEnd, dateEnd: dateStart };
}
