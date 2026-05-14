import { ingestBlueActivity } from "../activity/blue-ingest.js";
import { syncWorkspaceIndex } from "../blue/workspace-index.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

let bluePoller: NodeJS.Timeout | null = null;
let inFlight = false;
let lastReconciliationAt: string | null = null;
let lastReconciliationOk: boolean | null = null;
let lastReconciliationError: string | null = null;

export async function runBlueIngestionOnce() {
  if (inFlight) {
    return {
      skipped: true,
      reason: "ingest already running"
    };
  }

  inFlight = true;
  try {
    const [activityResult, indexResult] = await Promise.allSettled([
      ingestBlueActivity(),
      syncWorkspaceIndex(),
    ]);

    if (
      activityResult.status === "rejected" &&
      indexResult.status === "rejected"
    ) {
      lastReconciliationAt = new Date().toISOString();
      lastReconciliationOk = false;
      lastReconciliationError =
        activityResult.reason instanceof Error
          ? activityResult.reason.message
          : "Blue reconciliation failed";
      throw activityResult.reason;
    }

    const result = {
      activity:
        activityResult.status === "fulfilled"
          ? activityResult.value
          : {
              ok: false,
              error:
                activityResult.reason instanceof Error
                  ? activityResult.reason.message
                  : "Blue activity ingest failed",
            },
      index:
        indexResult.status === "fulfilled"
          ? indexResult.value
          : {
              ok: false,
              error:
                indexResult.reason instanceof Error
                  ? indexResult.reason.message
                  : "Workspace index sync failed",
            },
    };
    lastReconciliationAt = new Date().toISOString();
    lastReconciliationOk =
      activityResult.status === "fulfilled" && indexResult.status === "fulfilled";
    lastReconciliationError = lastReconciliationOk
      ? null
      : "One or more Blue reconciliation tasks failed";
    return result;
  } finally {
    inFlight = false;
  }
}

export function startBluePoller() {
  if (!config.ENABLE_BLUE_POLLING || bluePoller) {
    return;
  }

  bluePoller = setInterval(() => {
    void runBlueIngestionOnce().catch((error) => {
      logger.error({ err: error }, "Scheduled Blue ingest failed");
    });
  }, config.BLUE_INGEST_INTERVAL_MS);
}

export function stopBluePoller() {
  if (!bluePoller) {
    return;
  }

  clearInterval(bluePoller);
  bluePoller = null;
}

export function getBluePollerStatus() {
  return {
    enabled: config.ENABLE_BLUE_POLLING,
    intervalMs: config.BLUE_INGEST_INTERVAL_MS,
    inFlight,
    lastReconciliationAt,
    lastReconciliationOk,
    lastReconciliationError,
  };
}
