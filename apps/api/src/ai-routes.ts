import { registerAiRoutes as registerCoreAiRoutes } from "./ai-routes-core.js";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import { buildRkfKnowledgeContext } from "./rkf-knowledge-injection.js";

export {
  VISION_COACH_PROMPT,
  buildCatalogKnowledgeContext,
  buildLiveWindowContext,
  buildPlatformContext,
  buildVisionCoachContext,
} from "./ai-routes-core.js";
export type { VisionAnalysisRecord } from "./ai-routes-core.js";

export function registerAiRoutes(...args: Parameters<typeof registerCoreAiRoutes>) {
  const [app, , catalogStore] = args;
  registerCoreAiRoutes(...args);

  app.get("/api/v1/ai/knowledge-status", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) {
      return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    }

    let knowledgeLoaded = false;
    let knowledgeReason: string | undefined;
    try {
      const context = await buildRkfKnowledgeContext("regras futuro agente Método RKF zonas canônicas governança aprovação humana");
      knowledgeLoaded = context.includes("BASE DE CONHECIMENTO RKF V1.0") && context.length > 300;
      if (!knowledgeLoaded) knowledgeReason = "Base RKF privada não carregada ou sem trechos recuperáveis";
    } catch (error) {
      knowledgeReason = error instanceof Error ? error.message : "Falha ao carregar Base RKF privada";
    }

    const catalog = catalogStore?.status(user!.organizationId);
    const catalogLoaded = Boolean(catalog);
    const combinedReady = knowledgeLoaded && catalogLoaded;

    return {
      combinedReady,
      knowledgeBase: { loaded: knowledgeLoaded, reason: knowledgeReason, version: knowledgeLoaded ? "1.0" : null },
      masterCatalog: catalogLoaded
        ? { loaded: true, version: catalog!.version, packageHash: catalog!.packageHash }
        : { loaded: false, reason: "Catálogo Mestre RKF ainda não importado para esta organização" },
      policy: {
        usesBothInChat: true,
        preservesCertaintyMarkers: true,
        humanApprovalForCriticalDecisions: true,
      },
    };
  });
}