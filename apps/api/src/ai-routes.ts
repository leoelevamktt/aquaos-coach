import { registerAiRoutes as registerCoreAiRoutes } from "./ai-routes-core.js";
import { attachAuthStore, getSession, roleAllows, sessionToken } from "./auth.js";
import { buildRkfKnowledgeContext } from "./rkf-knowledge-injection.js";
import {
  configureRkfCatalogLlmInjection,
  enterRkfAiOrganization,
  installRkfCatalogLlmInjection,
} from "./rkf-catalog-llm-injection.js";
import {
  configureCoachBrainLlmInjection,
  enterCoachBrainOrganization,
  installCoachBrainLlmInjection,
} from "./coach-brain-llm-injection.js";
import { registerCoachBrainRoutes } from "./coach-brain.js";
import { registerAthleteWorkoutAiRoutes } from "./athlete-workout-ai.js";
import { registerAthletePerformanceRoutes } from "./athlete-performance.js";
import { registerRkfBrainReadinessRoute } from "./rkf-brain-readiness.js";
import { reconcileProductionAthleteProfiles } from "./production-reconciliation.js";

export {
  VISION_COACH_PROMPT,
  buildCatalogKnowledgeContext,
  buildLiveWindowContext,
  buildPlatformContext,
  buildVisionCoachContext,
} from "./ai-routes-core.js";
export type { VisionAnalysisRecord } from "./ai-routes-core.js";

export function registerAiRoutes(...args: Parameters<typeof registerCoreAiRoutes>) {
  const [app, managedStore, catalogStore] = args;

  // Snapshots antigos de produção podiam preservar a conta autenticável e
  // perder o prontuário vinculado. Reparamos isso antes de expor qualquer rota
  // de treino/performance e recarregamos as contas persistidas no auth store.
  reconcileProductionAthleteProfiles(managedStore);
  attachAuthStore(managedStore);

  // Toda chamada OpenAI-compatible da área de IA herda a organização autenticada.
  // O Catálogo Mestre e o Cérebro RKF são camadas independentes: catálogo traz
  // conhecimento técnico; cérebro traz metodologia, histórico de decisões,
  // constituição operacional e contexto longitudinal do atleta.
  configureRkfCatalogLlmInjection(catalogStore);
  installRkfCatalogLlmInjection();
  configureCoachBrainLlmInjection(managedStore);
  installCoachBrainLlmInjection();
  app.addHook("preHandler", async (request) => {
    if (!request.url.split("?")[0]?.startsWith("/api/v1/ai/")) return;
    const user = await getSession(sessionToken(request));
    if (user) {
      enterRkfAiOrganization(user.organizationId);
      enterCoachBrainOrganization(user.organizationId);
    }
  });

  // Em produção a Base RKF é requisito, não fallback silencioso: falhar no
  // startup é mais seguro que servir recomendações sem a documentação privada.
  if (/^(1|true|yes)$/i.test(process.env.RKF_KNOWLEDGE_REQUIRED ?? "")) {
    app.addHook("onReady", async () => {
      const context = await buildRkfKnowledgeContext("regras futuro agente Método RKF zonas canônicas governança aprovação humana");
      if (!context.includes("BASE DE CONHECIMENTO RKF V1.0") || context.length <= 300) {
        throw new Error("Base RKF privada obrigatória não foi carregada corretamente");
      }
    });
  }

  registerCoreAiRoutes(...args);
  registerCoachBrainRoutes(app, managedStore, catalogStore);
  registerAthleteWorkoutAiRoutes(app, managedStore, catalogStore);
  registerAthletePerformanceRoutes(app, managedStore);
  registerRkfBrainReadinessRoute(app, managedStore, catalogStore);

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
        usesBothInPlatformAi: true,
        coachBrainAcrossPlatformAi: true,
        athleteLongitudinalContext: true,
        personalizedPlanningUsesHardRulesBeforeLlm: true,
        constitutionalRulesAlwaysInjected: true,
        preventsCatalogDuplication: true,
        preservesCertaintyMarkers: true,
        humanApprovalForCriticalDecisions: true,
      },
    };
  });
}
