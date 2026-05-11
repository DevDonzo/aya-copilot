import type { FastifyPluginAsync } from "fastify";

import { resolveEmployeeName } from "../blue/users-sync.js";
import { ValidationError } from "../app/errors.js";
import {
  employeeSummaryQuerySchema,
  teamSummaryQuerySchema,
} from "../types/api.js";
import { parseWithSchema } from "../app/plugins/zod.js";
import { buildEmployeeDaySummary } from "../summary/daily.js";
import { buildNoActivitySummary, buildTeamDaySummary } from "../summary/team.js";

export const summaryRoutes: FastifyPluginAsync = async (app) => {
  const protectedRoute = { preHandler: [app.authenticateRequired] };

  app.get("/summary/day", protectedRoute, async (request) => {
    const query = parseWithSchema(employeeSummaryQuerySchema, request.query);
    let employeeId = query.employeeId;

    if (!employeeId && query.employee) {
      employeeId = (await resolveEmployeeName(query.employee))?.id;
    }

    if (!employeeId) {
      throw new ValidationError("employeeId or employee is required");
    }

    return await buildEmployeeDaySummary(
      employeeId,
      query.date ?? getTorontoDateString(),
    );
  });

  app.get("/summary/team", protectedRoute, async (request) => {
    const query = parseWithSchema(teamSummaryQuerySchema, request.query);
    const date = query.date ?? getTorontoDateString();
    if (query.inactiveOnly) {
      return await buildNoActivitySummary(date);
    }
    return await buildTeamDaySummary(date);
  });
};

function getTorontoDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
