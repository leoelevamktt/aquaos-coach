import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import type { RkfCatalogStore } from "./rkf-catalog-store.js";

/**
 * GET /api/v1/rkf/catalog?sheet=ATLETAS&q=&offset=0&limit=100
 *
 * Contrato da UI:
 * { data: [{id, sheet, name, status, payload}], total, offset, limit,
 *   sheets: [{name, rows}], source: {version, packageHash, importedAt?} }
 * Somente coach/admin. sheet é validado contra o manifesto.
 */
export function registerRkfCatalogRoutes(app: FastifyInstance, catalogStore: RkfCatalogStore) {
  app.get("/api/v1/rkf/catalog", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Catálogo restrito à comissão técnica" : "Autenticação necessária" });
    const query = z.object({
      sheet: z.string().trim().min(1).max(60),
      q: z.string().trim().max(160).optional(),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).default(100),
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Parâmetros de consulta inválidos", details: query.error.flatten() });
    const organizationId = user!.organizationId;
    try {
      const page = catalogStore.query(organizationId, query.data);
      const errors = catalogStore.sourceCellErrors();
      return {
        data: page.data,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        sheets: page.sheets,
        source: { ...page.source, sourceCellErrors: errors.length },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao consultar o catálogo";
      if (/aba desconhecida/i.test(message)) return reply.code(404).send({ error: "Aba inexistente no catálogo" });
      return reply.code(500).send({ error: message });
    }
  });
}
