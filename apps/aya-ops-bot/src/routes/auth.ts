import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import {
  getAuthenticatedEmployee,
  loginEmployee,
  logoutEmployee,
  provisionEmployeeAccess,
  requireRole,
} from "../auth/service.js";
import { AuthError } from "../app/errors.js";
import { config } from "../config.js";
import { loginBodySchema, provisionBodySchema } from "../types/api.js";
import { parseWithSchema } from "../app/plugins/zod.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/auth/me", async (request) => {
    const employee =
      request.employee ??
      (await getAuthenticatedEmployee(request.cookies.aya_session ?? null));
    return {
      authenticated: Boolean(employee),
      employee,
    };
  });

  app.post("/auth/login", async (request, reply) => {
    const payload = parseWithSchema(loginBodySchema, request.body);
    const login = await loginEmployee(payload.employeeName, payload.password);
    const secureCookie = shouldUseSecureCookies(request);
    reply.setCookie("aya_session", login.sessionToken, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: secureCookie,
    });
    return {
      authenticated: true,
      employee: login.employee,
      expiresAt: login.expiresAt,
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    await logoutEmployee(request.cookies.aya_session ?? null);
    const secureCookie = shouldUseSecureCookies(request);
    reply.clearCookie("aya_session", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: secureCookie,
    });
    return { ok: true };
  });

  app.post(
    "/auth/provision",
    { preHandler: [app.authenticateOptionalSession] },
    async (request) => {
      const bootstrapKey = request.headers["x-bootstrap-key"];
      const canUseBootstrap =
        config.ALLOW_BOOTSTRAP_PROVISIONING &&
        config.NODE_ENV !== "production" &&
        typeof bootstrapKey === "string" &&
        Boolean(config.AUTH_BOOTSTRAP_KEY) &&
        bootstrapKey === config.AUTH_BOOTSTRAP_KEY;

      if (!canUseBootstrap && bootstrapKey) {
        throw new AuthError();
      }

      if (!canUseBootstrap) {
        requireRole(request.employee, ["admin"]);
      }

      const payload = parseWithSchema(provisionBodySchema, request.body);
      return {
        ok: true,
        provisioned: await provisionEmployeeAccess(payload),
      };
    },
  );
};

function shouldUseSecureCookies(request: FastifyRequest) {
  if (config.NODE_ENV !== "production") {
    return false;
  }

  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string"
      ? forwardedProto.split(",")[0]?.trim()
      : request.protocol;

  if (proto === "https") {
    return true;
  }

  const hostHeader = request.headers.host ?? "";
  const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";

  if (host === "localhost" || host === "127.0.0.1") {
    return false;
  }

  return false;
}
