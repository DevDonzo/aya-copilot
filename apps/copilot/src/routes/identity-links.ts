import type { FastifyPluginAsync } from "fastify";

import {
  deleteIdentityLinkById,
  getIdentityLinkById,
  listEmployees,
  listIdentityLinks,
} from "../db.js";
import { PermissionError, NotFoundError } from "../app/errors.js";
import { createManualIdentityLink } from "../modules/identity/service.js";
import { identityLinkBodySchema } from "../types/api.js";
import { parseWithSchema } from "../app/plugins/zod.js";

export const identityLinkRoutes: FastifyPluginAsync = async (app) => {
  const adminOnly = { preHandler: [app.requireRoles(["admin"])] };

  app.get("/identity-links", adminOnly, async () => ({
    items: await listIdentityLinks(),
  }));

  app.post(
    "/identity-links",
    adminOnly,
    async (request) => {
      const payload = parseWithSchema(identityLinkBodySchema, request.body);
      return await createManualIdentityLink(payload);
    },
  );

  app.get("/employees", adminOnly, async () => ({ items: await listEmployees() }));

  app.delete("/identity-links/:id", adminOnly, async (request) => {
    const id = (request.params as { id: string }).id;
    const link = await getIdentityLinkById(id);
    if (!link) {
      throw new NotFoundError("Identity link not found");
    }

    if (!["email", "manual"].includes(link.source)) {
      throw new PermissionError(
        "Only email/manual identity links can be deleted from the admin UI",
      );
    }

    await deleteIdentityLinkById(id);
    return { ok: true, deletedId: id };
  });
};
