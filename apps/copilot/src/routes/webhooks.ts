import type { FastifyPluginAsync } from "fastify";

import { verifyAndProcessBlueWebhook } from "../modules/blue/webhooks/service.js";

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/webhooks/blue",
    {
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      await verifyAndProcessBlueWebhook({
        rawBody:
          typeof request.rawBody === "string"
            ? request.rawBody
            : request.rawBody
              ? request.rawBody.toString("utf8")
              : JSON.stringify(request.body ?? {}),
        signature: request.headers["x-signature"],
      });
      return reply.code(204).send();
    },
  );
};
