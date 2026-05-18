import { CronJob } from "cron";

import { config } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { runBlueDailyReport } from "./service.js";

let blueDailyReportJob: CronJob | null = null;

export function startBlueDailyReportScheduler() {
  if (!config.BLUE_DAILY_REPORT_ENABLED || blueDailyReportJob) {
    return;
  }

  blueDailyReportJob = new CronJob(
    toCronExpression(config.BLUE_DAILY_REPORT_TIME),
    () => {
      void runBlueDailyReport({
        send: true,
        refresh: true,
      }).catch((error) => {
        logger.error({ err: error }, "Scheduled Blue daily report failed");
      });
    },
    null,
    true,
    config.BLUE_DAILY_REPORT_TIMEZONE,
  );

  logger.info(
    {
      report: {
        time: config.BLUE_DAILY_REPORT_TIME,
        timezone: config.BLUE_DAILY_REPORT_TIMEZONE,
      },
    },
    "Blue daily report scheduler started",
  );
}

export function stopBlueDailyReportScheduler() {
  blueDailyReportJob?.stop();
  blueDailyReportJob = null;
}

export function getBlueDailyReportSchedulerStatus() {
  return {
    enabled: config.BLUE_DAILY_REPORT_ENABLED,
    time: config.BLUE_DAILY_REPORT_TIME,
    timezone: config.BLUE_DAILY_REPORT_TIMEZONE,
    running: Boolean(blueDailyReportJob),
  };
}

function toCronExpression(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return `0 ${minute} ${hour} * * *`;
}
