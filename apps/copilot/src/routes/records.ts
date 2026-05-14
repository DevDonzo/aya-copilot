import type { FastifyPluginAsync } from "fastify";
import type { FastifyRequest } from "fastify";

import { AuthError, NotFoundError } from "../app/errors.js";
import { getBlueRecordDetail } from "../blue/record-detail.js";
import {
  getIndexedRecord,
  listIndexedRecords,
  searchRecordQuery,
} from "../blue/workspace-index.js";
import {
  normalizeBlueRequestAuth,
  requireValidatedBlueRequestAuth,
} from "../modules/blue/request-auth.js";

export const recordRoutes: FastifyPluginAsync = async (app) => {
  const protectedRoute = { preHandler: [app.authenticateRequired] };

  app.get("/records/search", protectedRoute, async (request) => {
    await requireRecordRouteBlueAuth(request);
    const query = ((request.query as { q?: string; limit?: string } | undefined)?.q ?? "").trim();
    const limit = Number(
      (request.query as { q?: string; limit?: string } | undefined)?.limit ?? "12",
    );
    const items = query
      ? await searchRecordQuery(query, limit)
      : await listIndexedRecords(limit);
    return { items, query };
  });

  app.get("/records/:recordId", protectedRoute, async (request) => {
    await requireRecordRouteBlueAuth(request);
    const recordId = decodeURIComponent(
      (request.params as { recordId: string }).recordId,
    );
    const record = await getIndexedRecord(recordId);

    if (!record) {
      throw new NotFoundError("record not found");
    }

    return { item: record };
  });

  app.get("/records/:recordId/detail", protectedRoute, async (request) => {
    const blueAuth = await requireRecordRouteBlueAuth(request);
    const recordId = decodeURIComponent(
      (request.params as { recordId: string }).recordId,
    );
    const record = await getIndexedRecord(recordId);

    if (!record) {
      throw new NotFoundError("record not found");
    }

    return {
      item: {
        ...record,
        ...(await getBlueRecordDetail(recordId, blueAuth)),
      },
    };
  });
};

async function requireRecordRouteBlueAuth(request: FastifyRequest) {
  if (!request.employee) {
    throw new AuthError();
  }

  return await requireValidatedBlueRequestAuth(
    normalizeBlueRequestAuth({
      tokenId:
        readHeader(request.headers, "x-aya-blue-token-id") ??
        readHeader(request.headers, "x-blue-token-id"),
      tokenSecret:
        readHeader(request.headers, "x-aya-blue-token-secret") ??
        readHeader(request.headers, "x-blue-token-secret"),
    }),
    request.employee,
  );
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}
