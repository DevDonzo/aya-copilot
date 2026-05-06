import type { FastifyPluginAsync } from "fastify";

import { config } from "../config.js";
import { checkBlueApiConnectivity } from "../modules/blue/graphql/client.js";
import { sqlite } from "../modules/db/kysely.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    const timestamp = new Date().toISOString();
    const database = { ok: false };
    const blueApi = { ok: false };

    try {
      sqlite.prepare("select 1 as ok").get();
      database.ok = true;
    } catch {
      database.ok = false;
    }

    try {
      await checkBlueApiConnectivity(config.BLUE_READ_WORKSPACE_ID);
      blueApi.ok = true;
    } catch {
      blueApi.ok = false;
    }

    const ok = database.ok && blueApi.ok;
    return reply.code(ok ? 200 : 503).send({
      ok,
      timestamp,
      database,
      blueApi,
    });
  });
};
