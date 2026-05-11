import type { FastifyPluginAsync } from "fastify";

import { NotFoundError } from "../app/errors.js";
import { getBlueRecordDetail } from "../blue/record-detail.js";
import {
  getIndexedRecord,
  listIndexedRecords,
  searchRecordQuery,
} from "../blue/workspace-index.js";

export const recordRoutes: FastifyPluginAsync = async (app) => {
  const protectedRoute = { preHandler: [app.authenticateRequired] };

  app.get("/records/search", protectedRoute, async (request) => {
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
        ...(await getBlueRecordDetail(recordId)),
      },
    };
  });
};
