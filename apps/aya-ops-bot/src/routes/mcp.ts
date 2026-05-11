import type { FastifyPluginAsync } from "fastify";

import { AuthError } from "../app/errors.js";
import { config } from "../config.js";
import { handleAyaMcpRequest } from "../mcp/server.js";
import { handleHostingerMcpRequest } from "../mcp/hostinger.js";

export const mcpRoutes: FastifyPluginAsync = async (app) => {
  const ayaInternalOnly = {
    preHandler: [
      async (request: any) => {
        const expectedKey = config.AYA_MCP_API_KEY;
        if (!expectedKey) {
          throw new AuthError("Aya MCP is not configured");
        }

        const providedKey = getHeaderValue(request.headers, "x-aya-internal-key");
        if (!providedKey || providedKey !== expectedKey) {
          throw new AuthError();
        }
      },
    ],
  };

  const hostingerInternalOnly = {
    preHandler: [
      async (request: any) => {
        const expectedKey = config.AYA_HOSTINGER_MCP_API_KEY;
        if (!expectedKey) {
          throw new AuthError("Aya Hostinger MCP is not configured");
        }

        const providedKey = getHeaderValue(
          request.headers,
          "x-aya-hostinger-internal-key",
        );
        if (!providedKey || providedKey !== expectedKey) {
          throw new AuthError();
        }
      },
    ],
  };

  const handler = async (request: any, reply: any) => {
    const parsedBody =
      request.method === "POST" || request.method === "DELETE"
        ? request.body
        : undefined;
    reply.hijack();
    await handleAyaMcpRequest(request.raw, reply.raw, parsedBody);
  };

  const hostingerHandler = async (request: any, reply: any) => {
    const parsedBody =
      request.method === "POST" || request.method === "DELETE"
        ? request.body
        : undefined;
    reply.hijack();
    await handleHostingerMcpRequest(request.raw, reply.raw, parsedBody);
  };

  app.get("/mcp", ayaInternalOnly, handler);
  app.post("/mcp", ayaInternalOnly, handler);
  app.delete("/mcp", ayaInternalOnly, handler);

  app.get("/mcp/hostinger", hostingerInternalOnly, hostingerHandler);
  app.post("/mcp/hostinger", hostingerInternalOnly, hostingerHandler);
  app.delete("/mcp/hostinger", hostingerInternalOnly, hostingerHandler);
};

function getHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
) {
  if (!headers) {
    return null;
  }

  const value =
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
