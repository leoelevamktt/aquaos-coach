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
import { derivePlanningInputs, registerCoachBrainRoutes } from "./coach-brain.js";
import { registerAthleteWorkoutAiRoutes } from "./athlete-workout-ai.js";
import { registerAthletePerformanceRoutes } from "./athlete-performance.js";
import { registerRkfBrainReadinessRoute } from "./rkf-brain-readiness.js";
import { reconcileProductionAthleteProfiles } from "./production-reconciliation.js";
import { ensureProductionDemoAthletePlanning } from "./production-demo-athlete.js";

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
    const path = request.url.split("?")[0] ?? "";
    if (!path.startsWith("/api/v1/ai/")) return;
    const user = await getSession(sessionToken(request));
    if (user) {
      // Última barreira contra snapshots legados: uma sessão de atleta nunca
      // entra nas rotas personalizadas sem um prontuário com o MESMO athleteId.
      // Não preenchemos nenhuma métrica esportiva para atletas reais; campos
      // desconhecidos continuam ausentes/UNKNOWN até confirmação humana.
      if (user.role === "athlete" && user.athleteId && path.startsWith("/api/v1/ai/athlete/")) {
        const current = managedStore.get("athletes", user.athleteId);
        if (!current) {
          managedStore.create("athletes", {
            id: user.athleteId,
            organizationId: user.organizationId,
            name: user.name,
            email: user.email,
            status: "active",
            onboardingStatus: "profile_pending",
            profileCompleteness: "INCOMPLETE",
            dataQuality: "UNKNOWN_FIELDS_PRESERVED",
            source: "authenticated-athlete-runtime-repair",
          }, "create");
        }

        // A conta AUTH_ATHLETE_* é o usuário demonstrativo de produção usado
        // pelos smoke tests. Somente ela recebe a fixture explícita abaixo;
        // atletas convidados/reais permanecem sob a política UNKNOWN.
        ensureProductionDemoAthletePlanning(managedStore, user);
      }
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

  // Diagnóstico não mutável para o app e para o gate de produção. Ele mostra
  // exatamente quais pré-requisitos o Planning Engine ainda considera UNKNOWN,
  // sem tentar inventar fase, zona, volume ou perfil esportivo.
  app.get("/api/v1/ai/athlete/generation-readiness", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["athlete"])) {
      return reply.code(user ? 403 : 401).send({ error: user ? "Acesso exclusivo do atleta" : "Autenticação necessária" });
    }
    if (!user!.athleteId) return reply.code(409).send({ error: "Conta sem atleta vinculado" });

    const rawPool = Number((request.query as { poolLengthM?: string | number } | undefined)?.poolLengthM);
    const poolLengthM = rawPool === 25 || rawPool === 50 ? rawPool as 25 | 50 : undefined;
    const derived = derivePlanningInputs(
      managedStore,
      user!.organizationId,
      user!.athleteId,
      poolLengthM ? { poolLengthM } : {},
    );

    return reply.send({
      ready: Boolean(derived.athlete && derived.request && derived.missing.length === 0),
      missing: derived.missing,
      provenance: derived.provenance,
      policy: "UNKNOWN em vez de adivinhar; publicação continua dependente de aprovação do treinador.",
    });
  });

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
