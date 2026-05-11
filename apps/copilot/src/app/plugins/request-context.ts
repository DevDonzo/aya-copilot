import fp from "fastify-plugin";

export const requestContextPlugin = fp(async (app) => {
  app.addHook("onRequest", async (request) => {
    request.ctx = {
      startedAt: Date.now(),
      requestId: request.id,
    };
  });
});
