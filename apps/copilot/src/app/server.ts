import cookie from "@fastify/cookie";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";

import { initializeDatabase } from "../db.js";
import { authRoutes } from "../routes/auth.js";
import { healthRoutes } from "../routes/health.js";
import { identityLinkRoutes } from "../routes/identity-links.js";
import { mcpRoutes } from "../routes/mcp.js";
import { messageRoutes } from "../routes/messages.js";
import { recordRoutes } from "../routes/records.js";
import { reportRoutes } from "../routes/reports.js";
import { summaryRoutes } from "../routes/summaries.js";
import { syncRoutes } from "../routes/sync.js";
import { webhookRoutes } from "../routes/webhooks.js";
import { logger } from "../lib/logger.js";
import { authPlugin } from "./plugins/auth.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { requestContextPlugin } from "./plugins/request-context.js";

export async function buildAyaApp() {
  await initializeDatabase();

  const app = Fastify({
    loggerInstance: logger,
  });

  await app.register(cookie);
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
    routes: ["/webhooks/blue"],
  });
  await app.register(requestContextPlugin);
  await app.register(authPlugin);
  await app.register(errorHandlerPlugin);

  app.get("/", async (_request, reply) => {
    return reply.status(404).send({
      error: "Aya is a backend service. Use LibreChat as the employee-facing interface.",
    });
  });
  app.get("/app", async (_request, reply) => {
    return reply.status(404).send({
      error: "Aya is a backend service. Use LibreChat as the employee-facing interface.",
    });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(identityLinkRoutes);
  await app.register(recordRoutes);
  await app.register(reportRoutes);
  await app.register(summaryRoutes);
  await app.register(syncRoutes);
  await app.register(messageRoutes);
  await app.register(mcpRoutes);
  await app.register(webhookRoutes);

  return app;
}
