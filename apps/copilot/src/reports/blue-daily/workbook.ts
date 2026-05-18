import fs from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

import { config } from "../../config.js";
import type { BlueDailyReportData } from "./types.js";

const appRoot = path.resolve(import.meta.dirname, "..", "..", "..");

export async function writeBlueDailyWorkbook(input: {
  data: BlueDailyReportData;
  outputDir?: string;
}) {
  const outputDir =
    input.outputDir ??
    path.join(config.AYA_DATA_DIR ? path.resolve(config.AYA_DATA_DIR) : path.join(appRoot, "data"), "reports", "blue-daily");
  await fs.mkdir(outputDir, { recursive: true });

  const workbook = buildBlueDailyWorkbook(input.data);
  const filename = path.join(
    outputDir,
    `blue-daily-${input.data.window.reportDate}.xlsx`,
  );
  await workbook.xlsx.writeFile(filename);
  return filename;
}

export function buildBlueDailyWorkbook(data: BlueDailyReportData) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Aya Copilot";
  workbook.created = new Date(data.generatedAt);

  addSummarySheet(workbook, data);
  addRowsSheet(workbook, "New tasks created yesterday", [
    "Client",
    "Source",
    "Created At",
    "Assigned Person",
    "Due Date",
  ], data.newRecords.map((row) => [
    row.clientName,
    row.source,
    formatDateTime(row.createdAt, data.window.timezone),
    row.assignedTo,
    formatDate(row.dueAt, data.window.timezone),
  ]));
  addRowsSheet(workbook, "Overdue tasks", [
    "Client",
    "Assigned Person",
    "Due Date",
    "Last Comment At",
    "Days Since Comment",
  ], data.overdueNoRecentComments.map((row) => [
    row.clientName,
    row.assignedTo,
    formatDate(row.dueAt, data.window.timezone),
    formatLastCommentAt(row.lastCommentAt, row.commentCount, data.window.timezone),
    formatDaysSinceComment(row.daysSinceComment, row.commentCount),
  ]));
  addRowsSheet(workbook, "Overdue tasks with comments", [
    "Client",
    "Assigned Person",
    "Due Date",
    "Last Comment At",
    "Days Since Comment",
  ], data.overdueWithRecentComments.map((row) => [
    row.clientName,
    row.assignedTo,
    formatDate(row.dueAt, data.window.timezone),
    formatLastCommentAt(row.lastCommentAt, row.commentCount, data.window.timezone),
    formatDaysSinceComment(row.daysSinceComment, row.commentCount),
  ]));
  addRowsSheet(workbook, "Upcoming due", [
    "Client",
    "Assigned Person",
    "Due Date",
    "Last Comment At",
    "Days Since Comment",
  ], data.upcomingDue.map((row) => [
    row.clientName,
    row.assignedTo,
    formatDate(row.dueAt, data.window.timezone),
    formatLastCommentAt(row.lastCommentAt, row.commentCount, data.window.timezone),
    formatDaysSinceComment(row.daysSinceComment, row.commentCount),
  ]));
  addRowsSheet(workbook, "Comments updates last 24 hours", [
    "Client",
    "Assigned To",
    "Commenter",
    "Timestamp",
    "Comment/Update",
  ], data.commentsLast24Hours.map((row) => [
    row.clientName,
    row.assignedTo,
    row.commenter,
    formatDateTime(row.timestamp, data.window.timezone),
    row.update,
  ]));
  addRowsSheet(workbook, "Status Update", [
    "Responsible Staff",
    "Total Tasks Assigned",
    "Comments Placed On Tasks",
    "Untouched Tasks",
  ], data.staffStatus.map((row) => [
    row.staffName,
    row.openAssignedRecords,
    row.commentsPlacedYesterday,
    row.untouchedRecords,
  ]));

  return workbook;
}

function addSummarySheet(workbook: ExcelJS.Workbook, data: BlueDailyReportData) {
  const sheet = workbook.addWorksheet("Summary");
  addHeader(sheet, ["Metric", "Value"]);
  sheet.addRows([
    ["Report Date", data.window.reportDate],
    ["Timezone", data.window.timezone],
    ["Window Start", formatDateTime(data.window.startUtc, data.window.timezone)],
    ["Window End", formatDateTime(data.window.endUtc, data.window.timezone)],
    ["Generated At", formatDateTime(data.generatedAt, data.window.timezone)],
    ["New tasks created yesterday", data.rowCounts.newRecords],
    ["Overdue tasks", data.rowCounts.overdueNoRecentComments],
    ["Overdue tasks with comments", data.rowCounts.overdueWithRecentComments],
    ["Upcoming due", data.rowCounts.upcomingDue],
    ["Comments/updates from last 24 hours", data.rowCounts.commentsLast24Hours],
    ["Status Update rows", data.rowCounts.staffStatus],
  ]);
  formatSheet(sheet);
}

function addRowsSheet(
  workbook: ExcelJS.Workbook,
  title: string,
  headers: string[],
  rows: unknown[][],
) {
  const sheet = workbook.addWorksheet(title);
  addHeader(sheet, headers);
  sheet.addRows(rows);
  formatSheet(sheet);
}

function addHeader(sheet: ExcelJS.Worksheet, headers: string[]) {
  sheet.addRow(headers);
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };
}

function formatSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((column) => {
    let maxLength = 12;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      maxLength = Math.max(maxLength, String(cell.value ?? "").length);
    });
    column.width = Math.min(Math.max(maxLength + 2, 14), 48);
  });
}

function formatLastCommentAt(
  value: string | null,
  commentCount: number,
  timezone: string,
) {
  if (value) {
    return formatDateTime(value, timezone);
  }
  return commentCount > 0 ? "Comment exists; date unavailable" : "No comment found";
}

function formatDaysSinceComment(value: number | null, commentCount: number) {
  if (value != null) {
    return value;
  }
  return commentCount > 0 ? "Unknown" : "N/A";
}

function formatDate(value: string | null | undefined, timezone: string) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined, timezone: string) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
