import { config } from "../../config.js";
import {
  createId,
  hasSentReportRun,
  insertReportRun,
} from "../../db.js";
import { runBlueIngestionOnce } from "../../jobs/blue-poller.js";
import { collectBlueDailyReportInputs } from "./collect.js";
import { getPreviousCalendarDate, getReportWindow } from "./dates.js";
import { sendBlueDailyReportEmail } from "./gmail.js";
import { buildBlueDailyReportData } from "./rules.js";
import { BLUE_DAILY_REPORT_TYPE } from "./types.js";
import { writeBlueDailyWorkbook } from "./workbook.js";

const allowedWorkspaceId = "cmhazc4rl1vkand1eonnmiyjy";

export async function runBlueDailyReport(input: {
  date?: string;
  send?: boolean;
  force?: boolean;
  refresh?: boolean;
  now?: Date;
  outputDir?: string;
} = {}) {
  assertAllowedWorkspace();
  const reportDate =
    input.date ??
    getPreviousCalendarDate(
      input.now ?? new Date(),
      config.BLUE_DAILY_REPORT_TIMEZONE,
    );
  const shouldSend = Boolean(input.send);
  const recipients = [
    ...config.BLUE_DAILY_REPORT_RECIPIENTS,
    ...config.BLUE_DAILY_REPORT_CC,
  ];

  if (shouldSend && !input.force) {
    const alreadySent = await hasSentReportRun({
      reportType: BLUE_DAILY_REPORT_TYPE,
      reportDate,
    });
    if (alreadySent) {
      await insertReportRun({
        id: createId("report_run"),
        reportType: BLUE_DAILY_REPORT_TYPE,
        reportDate,
        sendStatus: "skipped_duplicate",
        recipients,
      });
      return {
        status: "skipped_duplicate" as const,
        reportDate,
        sent: false,
        duplicateBlocked: true,
      };
    }
  }

  try {
    if (input.refresh) {
      await runBlueIngestionOnce();
    }

    const window = getReportWindow({
      reportDate,
      timezone: config.BLUE_DAILY_REPORT_TIMEZONE,
    });
    const collected = await collectBlueDailyReportInputs({
      workspaceId: config.BLUE_READ_WORKSPACE_ID,
      window,
    });
    const data = buildBlueDailyReportData({
      window,
      records: collected.records,
      activities: collected.activities,
    });
    const workbookPath = await writeBlueDailyWorkbook({
      data,
      outputDir: input.outputDir,
    });

    if (shouldSend) {
      await sendBlueDailyReportEmail({
        reportDate,
        workbookPath,
        data,
      });
    }

    await insertReportRun({
      id: createId("report_run"),
      reportType: BLUE_DAILY_REPORT_TYPE,
      reportDate,
      sendStatus: shouldSend ? "sent" : "dry_run",
      recipients,
      generatedFilename: workbookPath,
      rowCounts: data.rowCounts,
      sentAt: shouldSend ? new Date().toISOString() : null,
    });

    return {
      status: shouldSend ? "sent" as const : "dry_run" as const,
      reportDate,
      sent: shouldSend,
      duplicateBlocked: false,
      workbookPath,
      rowCounts: data.rowCounts,
    };
  } catch (error) {
    await insertReportRun({
      id: createId("report_run"),
      reportType: BLUE_DAILY_REPORT_TYPE,
      reportDate,
      sendStatus: "failed",
      recipients,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function assertAllowedWorkspace() {
  if (
    config.BLUE_WORKSPACE_ID !== allowedWorkspaceId ||
    config.BLUE_READ_WORKSPACE_ID !== allowedWorkspaceId
  ) {
    throw new Error(
      `Blue daily reports can only run against workspace ${allowedWorkspaceId}`,
    );
  }
}
