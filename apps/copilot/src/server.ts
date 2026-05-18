import { syncWorkspaceIndex } from "./blue/workspace-index.js";
import { syncWorkspaceEmployees } from "./blue/users-sync.js";
import { config } from "./config.js";
import { buildAyaApp } from "./app/server.js";
import { startBluePoller, stopBluePoller } from "./jobs/blue-poller.js";
import { registerBlueWebhookIfConfigured } from "./modules/blue/webhooks/service.js";
import {
  startBlueDailyReportScheduler,
  stopBlueDailyReportScheduler,
} from "./reports/blue-daily/scheduler.js";

const app = await buildAyaApp();

await app.listen({
  port: config.PORT,
  host: "0.0.0.0",
});

app.log.info(`Aya Copilot listening on :${config.PORT}`);

void syncWorkspaceEmployees().catch((error) => {
  app.log.error({ err: error }, "Initial employee sync failed");
});

void syncWorkspaceIndex().catch((error) => {
  app.log.error({ err: error }, "Initial workspace index sync failed");
});

void registerBlueWebhookIfConfigured().catch((error) => {
  app.log.error({ err: error }, "Webhook registration failed");
});

startBluePoller();
startBlueDailyReportScheduler();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopBluePoller();
    stopBlueDailyReportScheduler();
    void app.close().finally(() => {
      process.exit(0);
    });
  });
}
