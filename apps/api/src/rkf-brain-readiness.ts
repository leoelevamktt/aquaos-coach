import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import type { ManagedStore } from "./managed-store.js";
import {
  RKF_BRAIN_CONSTITUTION_RULES,
  RKF_BRAIN_CONSTITUTION_VERSION,
  RKF_BRAIN_SOURCES,
} from "./rkf-brain-contracts.js";
import { loadRkfLibrary } from "./rkf-library.js";

type CatalogStore = {
  status(organizationId: string): { version: number; packageHash: string; importedAt?: string; rows?: number } | undefined;
  manifest?: { sourceSha256?: string; sheetCount?: number; rows?: Record<string, number>; packageHash?: string };
};

function source(id: string) {
  return RKF_BRAIN_SOURCES.find((item) => item.id === id);
}

function privateKnowledgePath() {
  const configured = process.env.RKF_KNOWLEDGE_PATH?.trim();
  if (configured) return resolve(configured);
  const storageRoot = process.env.STORAGE_PATH?.trim();
  if (storageRoot) return resolve(storageRoot, "knowledge", "rkf-base.docx");
  return fileURLToPath(new URL("../storage/knowledge/rkf-base.docx", import.meta.url));
}

async function privateKnowledgeEvidence() {
  const expected = source("PRIVATE_KNOWLEDGE_BASE_V1")?.sha256 ?? null;
  try {
    const bytes = await readFile(privateKnowledgePath());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { ready: Boolean(expected && sha256 === expected), sha256, expectedSha256: expected, bytes: bytes.byteLength };
  } catch (error) {
    return {
      ready: false,
      sha256: null,
      expectedSha256: expected,
      bytes: 0,
      reason: error instanceof Error ? error.message : "Base privada indisponível",
    };
  }
}

function count(store: ManagedStore, kind: Parameters<ManagedStore["list"]>[0], organizationId: string) {
  return store.list(kind).filter((row) => String(row.organizationId ?? "org-demo") === organizationId).length;
}

export function registerRkfBrainReadinessRoute(app: FastifyInstance, store: ManagedStore, catalogStore?: CatalogStore) {
  app.get("/api/v1/ai/brain-readiness", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) {
      return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    }

    const organizationId = user!.organizationId;
    const library = loadRkfLibrary();
    const knowledge = await privateKnowledgeEvidence();
    const catalog = catalogStore?.status(organizationId);
    const catalogExpected = source("MASTER_CATALOG_V1")?.sha256 ?? null;
    const catalogSourceSha = catalogStore?.manifest?.sourceSha256 ?? null;
    const catalogReady = Boolean(catalog && catalogExpected && catalogSourceSha === catalogExpected);
    const libraryReady = Boolean(
      library
      && library.stats.sessions === 910
      && library.stats.blocks === 6226
      && library.stats.volumeMismatched === 0,
    );
    const constitutionReady = RKF_BRAIN_CONSTITUTION_RULES.length >= 25;

    const decisionMemory = {
      athletes: count(store, "athletes", organizationId),
      profiles: count(store, "athleteProfiles", organizationId),
      goals: count(store, "goals", organizationId),
      prescriptions: count(store, "prescriptions", organizationId),
      executions: count(store, "sessionExecutions", organizationId),
      responses: count(store, "athleteResponses", organizationId),
      readiness: count(store, "readinessScores", organizationId),
      loadSnapshots: count(store, "loadSnapshots", organizationId),
      adaptationDecisions: count(store, "adaptationDecisions", organizationId),
      evolutionAssessments: count(store, "evolutionAssessments", organizationId),
      results: count(store, "results", organizationId),
    };

    const sources = RKF_BRAIN_SOURCES.map((item) => {
      if (item.id === "PRIVATE_KNOWLEDGE_BASE_V1") return { ...item, ready: knowledge.ready, evidence: { sha256: knowledge.sha256, bytes: knowledge.bytes } };
      if (item.id === "MASTER_CATALOG_V1") return { ...item, ready: catalogReady, evidence: { sourceSha256: catalogSourceSha, version: catalog?.version ?? null, rows: catalog?.rows ?? null, packageHash: catalog?.packageHash ?? null } };
      if (item.id === "RKF_V5_1") return { ...item, ready: libraryReady, evidence: library ? { sessions: library.stats.sessions, blocks: library.stats.blocks, exact: library.stats.volumeMismatched === 0, packageHash: library.stats.packageHash } : null };
      if (item.id === "COACH_DECISION_MEMORY") return { ...item, ready: true, evidence: decisionMemory };
      return { ...item, ready: constitutionReady, evidence: { constitutionVersion: RKF_BRAIN_CONSTITUTION_VERSION } };
    });

    const warnings: string[] = [];
    if (!knowledge.ready) warnings.push("A Base de Conhecimento privada em produção não corresponde ao artefato RKF fornecido nesta revisão.");
    if (!catalogReady) warnings.push("O Catálogo Mestre ativo não corresponde ao fingerprint do arquivo fornecido nesta revisão.");
    if (!libraryReady) warnings.push("A biblioteca operacional V5.1 não está íntegra em 910 sessões / 6.226 blocos com volume exato.");
    if (!constitutionReady) warnings.push("A Constituição operacional RKF não está completa.");

    const readyCount = sources.filter((item) => item.ready).length;
    const ready = warnings.length === 0 && readyCount === sources.length;

    return {
      ready,
      status: ready ? "FULLY_OPERATIONAL" : "PARTIAL",
      constitution: {
        version: RKF_BRAIN_CONSTITUTION_VERSION,
        rules: RKF_BRAIN_CONSTITUTION_RULES.length,
        alwaysInjectedBeforeLlm: true,
      },
      sources,
      coverage: {
        sourceLayers: { ready: readyCount, total: sources.length },
        planningEngine: true,
        canonicalLibrary: libraryReady,
        privateKnowledgeRag: knowledge.ready,
        masterCatalogRetrieval: catalogReady,
        athleteLongitudinalMemory: true,
        coachDecisionMemory: true,
        readinessAndLoad: true,
        executionAndResponseLearning: true,
        auditAndVersioning: true,
        voiceAndExternalIngestion: true,
        humanApproval: true,
      },
      decisionMemory,
      safeguards: {
        hardRulesBeforeLlm: true,
        planningEngineBeforeTrainingAnswer: true,
        noFreePrescription: true,
        coachApprovalRequired: true,
        xlsxIsNotRuntimeDb: true,
        certaintyMarkersPreserved: true,
        unknownInsteadOfGuessing: true,
        tenantIsolation: true,
      },
      learningMode: {
        type: "RAG + motores determinísticos + memória decisória validada",
        fineTuningRequired: false,
        note: "A plataforma aprende operacionalmente com fatos executados e decisões humanas confirmadas; histórico não é promovido automaticamente a regra metodológica.",
      },
      warnings,
    };
  });
}
