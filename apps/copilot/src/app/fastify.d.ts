import "fastify";

import type { AuthenticatedEmployee, EmployeeRole } from "../auth/service.js";

declare module "fastify" {
  interface FastifyRequest {
    employee: AuthenticatedEmployee | null;
    rawBody?: string;
    ctx: {
      startedAt: number;
      requestId: string;
    };
  }

  interface FastifyInstance {
    authenticateOptionalSession: (
      request: FastifyRequest,
      reply?: FastifyReply,
    ) => Promise<void>;
    authenticateRequired: (
      request: FastifyRequest,
      reply?: FastifyReply,
    ) => Promise<void>;
    requireRoles: (
      roles: EmployeeRole[],
    ) => (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
  }
}
