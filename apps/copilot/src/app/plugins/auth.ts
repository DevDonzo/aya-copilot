import fp from "fastify-plugin";

import {
  getAuthenticatedEmployee,
  requireRole,
  type EmployeeRole,
} from "../../auth/service.js";

export const authPlugin = fp(async (app) => {
  app.decorateRequest("employee", null);

  app.decorate(
    "authenticateOptionalSession",
    async (request, _reply?) => {
      const sessionToken = request.cookies.aya_session ?? null;
      request.employee = await getAuthenticatedEmployee(sessionToken);
    },
  );

  app.decorate(
    "authenticateRequired",
    async (request, _reply?) => {
      await app.authenticateOptionalSession(request);
      requireRole(request.employee, ["employee", "admin"]);
    },
  );

  app.decorate("requireRoles", (roles: EmployeeRole[]) => {
    return async (request, _reply?) => {
      await app.authenticateOptionalSession(request);
      requireRole(request.employee, roles);
    };
  });
});
