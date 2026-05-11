import type { FastifyPluginAsync } from "fastify";

import { runBlueIngestionOnce } from "../jobs/blue-poller.js";
import { syncWorkspaceEmployees } from "../blue/users-sync.js";
import { syncWorkspaceIndex } from "../blue/workspace-index.js";
import { syncBodySchema } from "../types/api.js";
import { parseWithSchema } from "../app/plugins/zod.js";

export const syncRoutes: FastifyPluginAsync = async (app) => {
  const adminOnly = { preHandler: [app.requireRoles(["admin"])] };

  app.post("/ingest/blue-activity", adminOnly, async () => {
    return await runBlueIngestionOnce();
  });

  app.post("/sync/employees", adminOnly, async () => {
    return await syncWorkspaceEmployees();
  });

  app.post("/sync/workspace-index", adminOnly, async (request) => {
    const payload = parseWithSchema(syncBodySchema, request.body) ?? {};
    return await syncWorkspaceIndex({
      forceFull: payload.forceFull,
    });
  });
};
