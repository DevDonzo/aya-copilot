import fp from "fastify-plugin";
import { ZodError } from "zod";

import { AppError, ValidationError } from "../errors.js";

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const validationError = new ValidationError(
        "Invalid request payload",
        error.flatten(),
      );
      reply.status(validationError.statusCode).send({
        error: validationError.message,
        code: validationError.code,
        details: validationError.details,
        requestId: request.id,
      });
      return;
    }

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
        requestId: request.id,
      });
      return;
    }

    request.log.error({ err: error }, "Unhandled Aya error");
    reply.status(500).send({
      error: error instanceof Error ? error.message : "unknown error",
      code: "INTERNAL_ERROR",
      requestId: request.id,
    });
  });
});
