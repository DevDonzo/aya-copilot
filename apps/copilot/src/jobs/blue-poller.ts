import { ingestBlueActivity } from "../activity/blue-ingest.js";
import { syncWorkspaceIndex } from "../blue/workspace-index.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

let bluePoller: NodeJS.Timeout | null = null;
let inFlight = false;

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
      throw activityResult.reason;
    }

    return {
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
