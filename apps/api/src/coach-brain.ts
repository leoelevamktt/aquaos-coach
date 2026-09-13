import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generatePrescription,
  type PlanningAthleteContext,
  type PlanningRequest,
  type RkfPhaseId,
  type SkillCode,
  type Specialty,
  type ZoneCode,
} from "@natacao/domain";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import type { ManagedRecord, ManagedStore, ResourceKind } from "./managed-store.js";
import { loadRkfLibrary } from "./rkf-library.js";
import { buildRkfKnowledgeContext } from "./rkf-knowledge-injection.js";
import { buildRkfCatalogContext } from "./rkf-catalog-retrieval.js";
import type { CatalogRow } from "./rkf-catalog-store.js";

export const COACH_BRAIN_POLICY_VERSION = "rkf-coach-brain-v4.1";
export const COACH_BRAIN_MANUAL_SOURCE = "RKF_COACH_IMPLEMENTATION_MANUAL_V1";
export const COACH_BRAIN_PACKAGE_SOURCE = "RKF_COACH_OFFICIAL_IMPLEMENTATION_PACKAGE_V4";

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://anymodel.org/v1";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_MODEL = process.env.LLM_MODEL ?? "ag/gemini-3.7-flash-high";
const MAX_BRAIN_CONTEXT_CHARS = 46_000;
const zones = ["VALAT", "A1", "A2", "A3", "AN1", "AN2"] as const;
const phases = ["ADAPTACAO", "BASE", "DESENVOLVIMENTO", "ESPECIFICO", "ACUMULACAO", "TRANSFORMACAO", "REALIZACAO", "TAPER", "COMPETICAO"] as const;

type CatalogKnowledgeStore = {
  searchAcrossSheets(organizationId: string, q: string, maxRows: number): CatalogRow[];
  status(organizationId: string): { version: number; packageHash: string } | undefined;
};

const COACH_BRAIN_POLICY = `=== CÉREBRO RKF — MODELO DECISÓRIO DO TREINADOR ===
Versão: ${COACH_BRAIN_POLICY_VERSION}
Fontes de contrato: ${COACH_BRAIN_MANUAL_SOURCE} + ${COACH_BRAIN_PACKAGE_SOURCE} + Base RKF privada + Catálogo Mestre RKF + histórico confirmado da plataforma.

PAPEL
Você NÃO afirma ser, personificar ou substituir o treinador. Você reproduz o padrão decisório técnico RKF demonstrado nas fontes e nas decisões confirmadas do treinador para apoiar a próxima decisão humana.

ORDEM DE AUTORIDADE
1. Segurança, restrições clínicas registradas e bloqueios HARD.
2. Decisão humana documentada e rule set publicado/versionado.
3. Planning Engine e biblioteca estruturada RKF V5.1.
4. Fatos confirmados do atleta: planejado, executado e resposta, sempre separados.
5. Histórico de decisões aprovadas/adaptações do treinador.
6. Inferência da IA, sempre identificada como inferência e nunca promovida a fato.

REGRAS INEGOCIÁVEIS
- O XLSX é fonte editorial/contratual, não banco de runtime. O runtime usa a projeção estruturada RKF V5.1 e registros transacionais.
- O Planning Engine decide elegibilidade, volume, objetivo, zona e fundamento. A IA explica, compara e personaliza dentro dessa decisão; para mudar fundamento, rode o motor novamente.
- Zonas canônicas: VALAT, A1, A2, A3, AN1, AN2. Não invente zonas.
- Volume prescrito deve reconciliar exatamente com os blocos. Planejado, executado e resposta nunca se sobrescrevem.
- Sessão-chave exige objetivo, critério de sucesso, alternativa amarela, alternativa vermelha e critério de parada.
- Readiness/carga são multissinais. Carga isolada não é diagnóstico. Em retorno, restrição e liberação clínica prevalecem.
- Quando o dado necessário não existir, escreva UNKNOWN/LACUNA e peça confirmação; não complete por palpite.
- Toda prescrição gerada permanece PENDING_APPROVAL até aprovação do coach.

PERSONALIZAÇÃO
Ao recomendar para um atleta, combine: objetivo/prova, idade e estágio, fase ATR, especialidade, piscina, prontidão, dor/sono quando disponíveis, carga aguda/crônica quando disponíveis, aderência, resultados comparáveis, tendências, vídeos, avaliações da comissão, histórico de sessões, materiais/habilidades, restrições e decisões anteriores do treinador. Explique quais desses sinais mudaram a escolha.`;

function normalized(value: unknown) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function sortByRecency(records: ManagedRecord[]) {
  return [...records].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
}

function organizationRows(store: ManagedStore, kind: ResourceKind, organizationId: string) {
  return store.list(kind).filter((record) => record.organizationId === organizationId);
}

function athleteRows(store: ManagedStore, kind: ResourceKind, organizationId: string, athleteId: string) {
  return sortByRecency(organizationRows(store, kind, organizationId).filter((record) => {
    if (record.athleteId === athleteId) return true;
    if (record.targetType === "athlete" && record.targetId === athleteId) return true;
    if (kind === "athleteSessionAssignments" && record.athleteId === athleteId) return true;
    return false;
  }));
}

function compactRecord(record: ManagedRecord) {
  const omitted = new Set(["organizationId", "createdAt", "updatedAt", "analysis", "passwordHash", "tokenHash"]);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (omitted.has(key) || value === undefined || value === null || value === "") continue;
    if (typeof value === "string" && value.length > 1200) output[key] = `${value.slice(0, 1200)}…`;
    else if (Array.isArray(value) && value.length > 30) output[key] = value.slice(0, 30);
    else output[key] = value;
  }
  return output;
}

function appendSection(parts: string[], title: string, rows: ManagedRecord[], limit = 30) {
  if (!rows.length) return;
  const selected = rows.slice(0, limit).map(compactRecord);
  parts.push(`## ${title} (${rows.length} registro(s); ${selected.length} mais recentes no contexto)\n${JSON.stringify(selected)}`);
}

/**
 * Snapshot profundo por atleta. A consulta lê todas as entidades relevantes do
 * banco da organização e limita apenas o payload enviado ao LLM; a fonte de
 * verdade permanece no DB. Nenhum dado de outra organização entra no contexto.
 */
export function buildAthleteBrainContext(store: ManagedStore, organizationId: string, athleteId: string) {
  const athlete = organizationRows(store, "athletes", organizationId).find((record) => record.id === athleteId);
  if (!athlete) return "";

  const parts = [
    "=== CONTEXTO LONGITUDINAL DO ATLETA ===",
    `## Cadastro\n${JSON.stringify(compactRecord(athlete))}`,
  ];

  const sections: Array<[ResourceKind, string, number]> = [
    ["athleteProfiles", "Perfil esportivo", 20],
    ["athleteCalibrations", "Calibrações", 20],
    ["goals", "Metas", 30],
    ["racePlans", "Planos de prova", 30],
    ["readinessScores", "Prontidão", 60],
    ["athleteResponses", "Respostas e wellness", 60],
    ["loadSnapshots", "Snapshots de carga", 60],
    ["loadCalculations", "Cálculos de carga", 60],
    ["adaptationDecisions", "Decisões de adaptação", 60],
    ["prescriptions", "Prescrições e versões", 60],
    ["sessionExecutions", "Sessões executadas", 60],
    ["sessionResults", "Resultados de sessão", 60],
    ["results", "Resultados e séries", 60],
    ["performanceBenchmarks", "Benchmarks de performance", 30],
    ["evolutionAssessments", "Avaliações de evolução", 30],
    ["staffAssessments", "Avaliações da comissão", 40],
    ["sessionContextSnapshots", "Contextos de sessão", 40],
    ["athleteSessionAssignments", "Atribuições de sessão", 40],
    ["importedTrainingSessions", "Treinos externos confirmados", 30],
    ["videos", "Vídeos e análises disponíveis", 30],
    ["activities", "Atividades registradas", 60],
  ];

  for (const [kind, label, limit] of sections) appendSection(parts, label, athleteRows(store, kind, organizationId, athleteId), limit);

  const relatedAudit = store.audit(500)
    .filter((entry) => (entry.organizationId ?? "org-demo") === organizationId)
    .filter((entry) => normalized(entry.summary).includes(normalized(athleteId)) || entry.resourceId === athleteId)
    .slice(0, 40);
  if (relatedAudit.length) parts.push(`## Auditoria relacionada\n${JSON.stringify(relatedAudit)}`);

  const joined = parts.join("\n\n");
  return joined.length <= MAX_BRAIN_CONTEXT_CHARS ? joined : `${joined.slice(0, MAX_BRAIN_CONTEXT_CHARS)}\n\n[CONTEXTO TRUNCADO POR LIMITE DE SEGURANÇA; dados completos permanecem no banco]`;
}

/** Evidência do padrão decisório do coach, separada dos fatos do atleta. */
export function buildCoachDecisionEvidence(store: ManagedStore, organizationId: string, athleteId?: string) {
  const allPrescriptions = sortByRecency(organizationRows(store, "prescriptions", organizationId));
  const published = allPrescriptions.filter((record) => record.status === "PUBLISHED" || record.approvedBy || record.publishedSnapshot);
  const adaptations = sortByRecency(organizationRows(store, "adaptationDecisions", organizationId));
  const governance = sortByRecency(organizationRows(store, "governance", organizationId));
  const scoped = (rows: ManagedRecord[]) => athleteId
    ? [...rows.filter((record) => record.athleteId === athleteId), ...rows.filter((record) => record.athleteId !== athleteId)]
    : rows;
  const evidence = {
    warning: "Use apenas como evidência de padrão decisório. Não transforme correlação histórica em regra metodológica.",
    approvedPrescriptions: scoped(published).slice(0, 30).map(compactRecord),
    adaptationDecisions: scoped(adaptations).slice(0, 30).map(compactRecord),
    governanceDecisions: governance.slice(0, 20).map(compactRecord),
    recentAudit: store.audit(120).filter((entry) => (entry.organizationId ?? "org-demo") === organizationId).slice(0, 40),
  };
  return `=== EVIDÊNCIA HISTÓRICA DO PADRÃO DECISÓRIO DO COACH ===\n${JSON.stringify(evidence)}`;
}

function ageFromRecord(athlete: ManagedRecord) {
  const explicit = Number(athlete.age);
  if (Number.isFinite(explicit) && explicit >= 8) return Math.floor(explicit);
  const birth = typeof athlete.birthDate === "string" ? new Date(`${athlete.birthDate}T00:00:00Z`) : null;
  if (!birth || Number.isNaN(birth.getTime())) return undefined;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 8 ? age : undefined;
}

function metersFromEvent(value: unknown) {
  const match = String(value ?? "").match(/\b(50|100|200|400|800|1500)\b/);
  return match ? Number(match[1]) : undefined;
}

function specialtyFrom(athlete: ManagedRecord, eventMeters?: number): Specialty | undefined {
  const explicit = normalized(athlete.specialty).replace(/\s+/g, "_");
  if (["velocidade", "meio_fundo", "fundo"].includes(explicit)) return explicit as Specialty;
  if (!eventMeters) return undefined;
  if (eventMeters <= 100) return "velocidade";
  if (eventMeters <= 400) return "meio_fundo";
  return "fundo";
}

function latestNumeric(rows: ManagedRecord[], keys: string[]) {
  for (const row of rows) {
    for (const key of keys) {
      const value = Number(row[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

function latestPublishedPrescription(store: ManagedStore, organizationId: string, athleteId: string) {
  return athleteRows(store, "prescriptions", organizationId, athleteId)
    .find((record) => record.status === "PUBLISHED" || record.publishedSnapshot) ?? athleteRows(store, "prescriptions", organizationId, athleteId)[0];
}

export type DerivedPlanningInputs = {
  athlete?: PlanningAthleteContext;
  request?: PlanningRequest;
  missing: string[];
  provenance: string[];
};

export function derivePlanningInputs(
  store: ManagedStore,
  organizationId: string,
  athleteId: string,
  overrides: Partial<{
    age: number;
    developmentLevel: "formacao" | "rendimento";
    specialty: Specialty;
    poolLengthM: 25 | 50;
    eventMeters: number;
    phase: RkfPhaseId;
    objective: string;
    primaryZone: ZoneCode;
    secondaryZone: ZoneCode;
    targetVolumeM: number;
    rdcMarker: boolean;
    requiredLegVolumeM: number;
    skillEmphasis: SkillCode[];
  }> = {},
): DerivedPlanningInputs {
  const athleteRecord = organizationRows(store, "athletes", organizationId).find((record) => record.id === athleteId);
  if (!athleteRecord) return { missing: ["athlete"], provenance: [] };
  const provenance: string[] = [];
  const latestPrescription = latestPublishedPrescription(store, organizationId, athleteId);
  const prescription = (latestPrescription?.publishedSnapshot ?? latestPrescription?.prescription ?? {}) as Record<string, unknown>;
  const goals = athleteRows(store, "goals", organizationId, athleteId);
  const readinessRows = athleteRows(store, "readinessScores", organizationId, athleteId);
  const responses = athleteRows(store, "athleteResponses", organizationId, athleteId);
  const executions = athleteRows(store, "sessionExecutions", organizationId, athleteId);
  const activities = athleteRows(store, "activities", organizationId, athleteId);
  const settings = organizationRows(store, "settings", organizationId)[0];

  const age = overrides.age ?? ageFromRecord(athleteRecord);
  if (overrides.age !== undefined) provenance.push("idade: override explícito"); else if (age !== undefined) provenance.push("idade: cadastro do atleta");

  const goalEvent = goals[0]?.event ?? athleteRecord.primaryEvent ?? athleteRecord.goalEvent;
  const eventMeters = overrides.eventMeters ?? Number(athleteRecord.eventMeters || 0) || metersFromEvent(goalEvent);
  if (overrides.eventMeters !== undefined) provenance.push("prova: override explícito"); else if (eventMeters) provenance.push("prova: meta/cadastro");

  const specialty = overrides.specialty ?? specialtyFrom(athleteRecord, eventMeters);
  if (overrides.specialty) provenance.push("especialidade: override explícito"); else if (athleteRecord.specialty) provenance.push("especialidade: cadastro"); else if (specialty) provenance.push("especialidade: derivada deterministicamente da distância da prova");

  const developmentLevel = overrides.developmentLevel
    ?? (normalized(athleteRecord.developmentLevel) === "formacao" ? "formacao" : normalized(athleteRecord.developmentLevel) === "rendimento" ? "rendimento" : age !== undefined ? (age <= 13 ? "formacao" : "rendimento") : undefined);
  if (overrides.developmentLevel) provenance.push("estágio: override explícito"); else if (athleteRecord.developmentLevel) provenance.push("estágio: cadastro"); else if (developmentLevel) provenance.push("estágio: regra metodológica por faixa etária");

  const poolRaw = overrides.poolLengthM ?? Number(athleteRecord.poolLengthM) || (String(settings?.primaryPool ?? "").includes("25") ? 25 : String(settings?.primaryPool ?? "").includes("50") ? 50 : undefined);
  const poolLengthM = poolRaw === 25 || poolRaw === 50 ? poolRaw : undefined;
  if (overrides.poolLengthM) provenance.push("piscina: override explícito"); else if (poolLengthM) provenance.push("piscina: cadastro/configuração da organização");

  const phaseRaw = overrides.phase ?? prescription.phase ?? latestPrescription?.phase;
  const phase = typeof phaseRaw === "string" && (phases as readonly string[]).includes(phaseRaw) ? phaseRaw as RkfPhaseId : undefined;
  if (overrides.phase) provenance.push("fase ATR: override explícito"); else if (phase) provenance.push("fase ATR: última prescrição confirmada");

  const objective = overrides.objective?.trim()
    || (typeof prescription.objective === "string" ? prescription.objective : "")
    || (typeof goals[0]?.objective === "string" ? String(goals[0].objective) : "")
    || (goalEvent ? `Preparação para ${String(goalEvent)}` : "");
  if (overrides.objective) provenance.push("objetivo: override explícito"); else if (objective) provenance.push("objetivo: prescrição/meta confirmada");

  const zoneRaw = overrides.primaryZone ?? prescription.primaryZone ?? latestPrescription?.primaryZone;
  const primaryZone = typeof zoneRaw === "string" && (zones as readonly string[]).includes(zoneRaw) ? zoneRaw as ZoneCode : undefined;
  if (overrides.primaryZone) provenance.push("zona primária: override explícito"); else if (primaryZone) provenance.push("zona primária: última prescrição confirmada");

  const targetOverride = overrides.targetVolumeM;
  const prescriptionVolume = Number(prescription.totalVolumeM ?? latestPrescription?.totalVolumeM);
  const recentVolumes = [...executions, ...activities]
    .map((row) => Number(row.prescribedVolumeM ?? row.sessionDistanceM ?? row.executedVolumeM ?? row.distanceMeters))
    .filter((value) => Number.isFinite(value) && value >= 500)
    .slice(0, 6);
  const weeklyDistance = Number(athleteRecord.weeklyDistance);
  const derivedVolume = recentVolumes.length
    ? Math.round((recentVolumes.reduce((sum, value) => sum + value, 0) / recentVolumes.length) / 10) * 10
    : Number.isFinite(weeklyDistance) && weeklyDistance > 0 ? Math.round((weeklyDistance / 6) / 10) * 10 : undefined;
  const targetVolumeM = targetOverride ?? (Number.isFinite(prescriptionVolume) && prescriptionVolume > 0 ? prescriptionVolume : derivedVolume);
  if (targetOverride) provenance.push("volume: override explícito"); else if (Number.isFinite(prescriptionVolume) && prescriptionVolume > 0) provenance.push("volume: última prescrição confirmada"); else if (targetVolumeM) provenance.push("volume: média recente/volume semanal, para revisão humana");

  const readiness = latestNumeric([...readinessRows, ...responses, athleteRecord ? [athleteRecord] : []], ["score", "readiness"]);
  if (readiness !== undefined) provenance.push("readiness: último dado disponível");

  const restrictions = [
    ...(Array.isArray(athleteRecord.restrictions) ? athleteRecord.restrictions.map(String) : []),
    ...(typeof athleteRecord.restrictions === "string" ? [athleteRecord.restrictions] : []),
  ];

  const recentSessionIds = athleteRows(store, "prescriptions", organizationId, athleteId)
    .map((record) => ((record.publishedSnapshot ?? record.prescription ?? {}) as Record<string, unknown>).source)
    .map((source) => typeof source === "object" && source !== null ? String((source as Record<string, unknown>).librarySessionId ?? "") : "")
    .filter(Boolean)
    .slice(0, 12);

  const missing = [
    age === undefined ? "age/birthDate" : "",
    !developmentLevel ? "developmentLevel" : "",
    !specialty ? "specialty/event" : "",
    !poolLengthM ? "poolLengthM/configuração da piscina" : "",
    !phase ? "phase" : "",
    !objective ? "objective/goal" : "",
    !primaryZone ? "primaryZone" : "",
    !targetVolumeM ? "targetVolumeM/histórico de volume" : "",
  ].filter(Boolean);
  if (missing.length || age === undefined || !developmentLevel || !specialty || !poolLengthM || !phase || !objective || !primaryZone || !targetVolumeM) return { missing, provenance };

  return {
    athlete: { athleteId, age, developmentLevel, specialty, poolLengthM, eventMeters, restrictions },
    request: {
      phase,
      objective,
      primaryZone,
      secondaryZone: overrides.secondaryZone,
      targetVolumeM: Math.round(targetVolumeM / 10) * 10,
      rdcMarker: overrides.rdcMarker ?? false,
      requiredLegVolumeM: overrides.requiredLegVolumeM,
      skillEmphasis: overrides.skillEmphasis,
      readiness,
      recentSessionIds,
    },
    missing: [],
    provenance,
  };
}

function catalogContext(store: CatalogKnowledgeStore | undefined, organizationId: string, query: string) {
  if (!store) return "";
  const source = store.status(organizationId);
  if (!source) return "";
  const rows = store.searchAcrossSheets(organizationId, query, 16);
  return rows.length ? buildRkfCatalogContext(rows, query, source) : "";
}

async function coachBrainLlm(system: string, user: string) {
  if (!LLM_API_KEY) throw new Error("LLM_API_KEY não configurada");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.25,
        max_tokens: 2200,
        stream: false,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`LLM respondeu ${response.status}`);
    if (raw.startsWith("data:") || (response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      let assembled = "";
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
        try {
          const parsed = JSON.parse(line.slice(5).trim()) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
          assembled += parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? "";
        } catch { /* keep-alive */ }
      }
      if (assembled.trim()) return assembled.trim();
      throw new Error("Stream sem conteúdo");
    }
    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
    const content = parsed.choices?.[0]?.message?.content?.trim() || parsed.choices?.[0]?.message?.reasoning_content?.trim();
    if (!content) throw new Error("Resposta vazia do modelo");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

const recommendationSchema = z.object({
  age: z.number().int().min(8).max(120).optional(),
  developmentLevel: z.enum(["formacao", "rendimento"]).optional(),
  specialty: z.enum(["velocidade", "meio_fundo", "fundo"]).optional(),
  poolLengthM: z.union([z.literal(25), z.literal(50)]).optional(),
  eventMeters: z.number().positive().optional(),
  phase: z.enum(phases).optional(),
  objective: z.string().trim().min(2).max(400).optional(),
  primaryZone: z.enum(zones).optional(),
  secondaryZone: z.enum(zones).optional(),
  targetVolumeM: z.number().int().min(500).max(30000).multipleOf(10).optional(),
  rdcMarker: z.boolean().optional(),
  requiredLegVolumeM: z.number().int().positive().multipleOf(10).optional(),
  skillEmphasis: z.array(z.string().trim().min(1)).max(12).optional(),
  focus: z.string().trim().max(1000).optional(),
});

export function registerCoachBrainRoutes(app: FastifyInstance, store: ManagedStore, catalogStore?: CatalogKnowledgeStore) {
  app.get("/api/v1/ai/coach-brain/status", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    const library = loadRkfLibrary();
    const knowledge = await buildRkfKnowledgeContext("governança planejamento ATR carga sessão-chave personalização atleta treinador").catch(() => "");
    const catalog = catalogStore?.status(user!.organizationId);
    const operationalPackageReady = Boolean(library && library.stats.sessions === 910 && library.stats.blocks === 6226 && library.stats.volumeMismatched === 0);
    return {
      ready: Boolean(operationalPackageReady && knowledge && catalog),
      policyVersion: COACH_BRAIN_POLICY_VERSION,
      sources: {
        implementationManual: { source: COACH_BRAIN_MANUAL_SOURCE, integratedAs: "governança e política decisória versionada", ready: true },
        officialPackageV4: { source: COACH_BRAIN_PACKAGE_SOURCE, integratedAs: "contrato operacional projetado na biblioteca/DB RKF V5.1", ready: operationalPackageReady },
        privateKnowledgeBase: { ready: Boolean(knowledge), retrieval: "RAG" },
        masterCatalog: { ready: Boolean(catalog), version: catalog?.version ?? null, packageHash: catalog?.packageHash ?? null },
      },
      library: library ? { sessions: library.stats.sessions, blocks: library.stats.blocks, exact: library.stats.volumeMismatched === 0, packageHash: library.stats.packageHash } : null,
      decisionMemory: {
        approvedPrescriptions: organizationRows(store, "prescriptions", user!.organizationId).filter((row) => row.status === "PUBLISHED" || row.approvedBy).length,
        adaptationDecisions: organizationRows(store, "adaptationDecisions", user!.organizationId).length,
        athleteResponses: organizationRows(store, "athleteResponses", user!.organizationId).length,
        loadSnapshots: organizationRows(store, "loadSnapshots", user!.organizationId).length,
      },
      safeguards: { coachApprovalRequired: true, xlsxIsNotRuntimeDb: true, hardRulesBeforeAi: true, tenantIsolation: true },
    };
  });

  app.post("/api/v1/ai/athletes/:athleteId/personalized-training", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    const params = z.object({ athleteId: z.string().min(1) }).safeParse(request.params);
    const body = recommendationSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: "Pedido de treino personalizado inválido", details: body.success ? params.error.flatten() : body.error.flatten() });
    const athleteId = params.data.athleteId;
    const athleteRecord = organizationRows(store, "athletes", user!.organizationId).find((record) => record.id === athleteId);
    if (!athleteRecord) return reply.code(404).send({ error: "Atleta não encontrado nesta organização" });

    const derived = derivePlanningInputs(store, user!.organizationId, athleteId, {
      ...body.data,
      skillEmphasis: body.data.skillEmphasis as SkillCode[] | undefined,
    });
    if (!derived.athlete || !derived.request) {
      return reply.code(422).send({
        error: "Faltam dados confirmados para uma prescrição RKF segura.",
        missing: derived.missing,
        provenance: derived.provenance,
        rule: "A IA não preenche lacunas críticas por palpite. Informe os campos ausentes ou registre-os no atleta/plano.",
      });
    }

    const library = loadRkfLibrary();
    if (!library) return reply.code(503).send({ error: "Biblioteca operacional RKF V5.1 indisponível" });
    const planning = generatePrescription(derived.athlete, derived.request, library.sessions);
    if (!planning.prescription) return reply.code(422).send({ error: "Planning Engine não conseguiu gerar candidato auditável", planning });

    const athleteContext = buildAthleteBrainContext(store, user!.organizationId, athleteId);
    const coachEvidence = buildCoachDecisionEvidence(store, user!.organizationId, athleteId);
    const query = [body.data.focus, derived.request.objective, derived.request.primaryZone, derived.request.phase, String(athleteRecord.name ?? athleteId)].filter(Boolean).join(" ");
    const knowledge = await buildRkfKnowledgeContext(query);
    const catalog = catalogContext(catalogStore, user!.organizationId, query);
    const engineCandidate = `=== CANDIDATO NORMATIVO DO PLANNING ENGINE ===\n${JSON.stringify(planning)}`;
    const system = [COACH_BRAIN_POLICY, knowledge, catalog].filter(Boolean).join("\n\n");
    const prompt = [
      `ATLETA SOLICITADO: ${String(athleteRecord.name ?? athleteId)} (${athleteId})`,
      athleteContext,
      coachEvidence,
      engineCandidate,
      `PROVENIÊNCIA DOS INPUTS: ${derived.provenance.join("; ")}`,
      body.data.focus ? `FOCO ADICIONAL DO COACH: ${body.data.focus}` : "",
      "TAREFA: explique a prescrição de forma personalizada. Comece por uma leitura do estado do atleta baseada apenas em fatos. Depois apresente o treino exatamente conforme o Planning Engine, sem alterar volume, zonas ou blocos. Explique por que esta sessão é adequada agora, quais sinais do histórico do atleta e do padrão decisório do coach influenciaram a recomendação. Inclua critério de sucesso, alternativa AMARELA, alternativa VERMELHA e critério de parada. Se uma alternativa exigir mudança de zona/objetivo/fundamento, diga explicitamente que exige nova execução do Planning Engine e aprovação humana. Termine com os pontos que o treinador deve confirmar antes de publicar.",
    ].filter(Boolean).join("\n\n");

    let narrative: string | null = null;
    let llmError: string | undefined;
    try {
      narrative = await coachBrainLlm(system, prompt);
    } catch (error) {
      llmError = error instanceof Error ? error.message : "Falha ao consultar a IA";
    }

    return reply.code(planning.status === "PRONTO" ? 200 : 422).send({
      status: planning.status,
      athlete: { id: athleteId, name: athleteRecord.name },
      personalizedExplanation: narrative,
      llmError,
      planning,
      provenance: derived.provenance,
      sources: {
        manual: COACH_BRAIN_MANUAL_SOURCE,
        operationalPackage: COACH_BRAIN_PACKAGE_SOURCE,
        libraryVersion: planning.prescription.versions.seed,
        libraryPackageHash: library.stats.packageHash,
        catalogVersion: catalogStore?.status(user!.organizationId)?.version ?? null,
        knowledgeRag: Boolean(knowledge),
      },
      approval: { required: true, status: "PENDING_APPROVAL", authority: "coach" },
    });
  });
}
