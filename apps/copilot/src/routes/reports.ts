import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { parseWithSchema } from "../app/plugins/zod.js";
import { runBlueDailyReport } from "../reports/blue-daily/service.js";

const blueDailyRunSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  send: z.boolean().optional().default(false),
  force: z.boolean().optional().default(false),
});

export const reportRoutes: FastifyPluginAsync = async (app) => {
  const adminOnly = { preHandler: [app.requireRoles(["admin"])] };

  app.post("/reports/blue-daily/run", adminOnly, async (request) => {
    const payload = parseWithSchema(blueDailyRunSchema, request.body) ?? {};
    return await runBlueDailyReport({
      date: payload.date,
      send: payload.send,
      force: payload.force,
      refresh: false,
    });
  });
};
