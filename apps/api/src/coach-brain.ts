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
const ZONES = ["VALAT", "A1", "A2", "A3", "AN1", "AN2"] as const;
const PHASES = ["ADAPTACAO", "BASE", "DESENVOLVIMENTO", "ESPECIFICO", "ACUMULACAO", "TRANSFORMACAO", "REALIZACAO", "TAPER", "COMPETICAO"] as const;
const MAX_CONTEXT_CHARS = 46_000;

type CatalogKnowledgeStore = {
  searchAcrossSheets(organizationId: string, q: string, maxRows: number): CatalogRow[];
  status(organizationId: string): { version: number; packageHash: string } | undefined;
};

type PlanningOverrides = Partial<{
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
}>;

export type DerivedPlanningInputs = {
  athlete?: PlanningAthleteContext;
  request?: PlanningRequest;
  missing: string[];
  provenance: string[];
};

const COACH_POLICY = `=== CÉREBRO RKF — MODELO DECISÓRIO DO TREINADOR ===
Versão ${COACH_BRAIN_POLICY_VERSION}.
Fontes: ${COACH_BRAIN_MANUAL_SOURCE}, ${COACH_BRAIN_PACKAGE_SOURCE}, Base RKF privada, Catálogo Mestre, biblioteca estruturada RKF V5.1, banco transacional e decisões humanas aprovadas.
Você não afirma ser nem substituir o treinador. Você aplica o padrão técnico demonstrado pelas fontes para apoiar a próxima decisão humana.
Hierarquia: segurança/restrições e HARD rules > decisão humana/rule set publicado > Planning Engine e DB RKF > fatos confirmados do atleta > histórico decisório do coach > inferência explicitamente marcada.
O XLSX é fonte editorial/contratual, nunca banco de runtime. O runtime consulta a projeção estruturada RKF V5.1.
Planejado, executado e resposta são fatos separados. Não invente fatos, zonas, fases ou dados ausentes.
O Planning Engine é normativo para objetivo, zona, volume e fundamento; a IA explica e individualiza sem alterar esses elementos por texto livre.
Sessão-chave exige objetivo, critério de sucesso, alternativa amarela, alternativa vermelha e critério de parada.
Toda prescrição permanece pendente de aprovação do coach.`;

function norm(value: unknown) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function recent(rows: ManagedRecord[]) {
  return [...rows].sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)));
}

function belongsToOrganization(row: ManagedRecord, organizationId: string) {
  return String(row.organizationId ?? "org-demo") === organizationId;
}

function orgRows(store: ManagedStore, kind: ResourceKind, organizationId: string) {
  return store.list(kind).filter((row) => belongsToOrganization(row, organizationId));
}

function athleteRows(store: ManagedStore, kind: ResourceKind, organizationId: string, athleteId: string) {
  return recent(orgRows(store, kind, organizationId).filter((row) =>
    row.athleteId === athleteId || (row.targetType === "athlete" && row.targetId === athleteId),
  ));
}

function compact(row: ManagedRecord) {
  const omit = new Set(["organizationId", "createdAt", "updatedAt", "passwordHash", "tokenHash", "analysis"]);
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(row)) {
    if (omit.has(key) || value === null || value === undefined || value === "") continue;
    if (typeof value === "string" && value.length > 1000) entries.push([key, `${value.slice(0, 1000)}…`]);
    else if (Array.isArray(value) && value.length > 30) entries.push([key, value.slice(0, 30)]);
    else entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

export function buildAthleteBrainContext(store: ManagedStore, organizationId: string, athleteId: string) {
  const athlete = orgRows(store, "athletes", organizationId).find((row) => row.id === athleteId);
  if (!athlete) return "";

  const parts = ["=== CONTEXTO LONGITUDINAL DO ATLETA ===", `## Cadastro\n${JSON.stringify(compact(athlete))}`];
  const sections: Array<[ResourceKind, string, number]> = [
    ["athleteProfiles", "Perfil", 20],
    ["athleteCalibrations", "Calibrações", 20],
    ["goals", "Metas", 30],
    ["racePlans", "Planos de prova", 30],
    ["readinessScores", "Readiness", 60],
    ["athleteResponses", "Respostas/wellness", 60],
    ["loadSnapshots", "Carga", 60],
    ["loadCalculations", "Cálculos de carga", 60],
    ["adaptationDecisions", "Decisões de adaptação", 60],
    ["prescriptions", "Prescrições/versionamento", 60],
    ["sessionExecutions", "Execuções", 60],
    ["sessionResults", "Resultados de sessão", 60],
    ["results", "Resultados", 60],
    ["performanceBenchmarks", "Benchmarks", 30],
    ["evolutionAssessments", "Evolução", 30],
    ["staffAssessments", "Comissão técnica", 40],
    ["sessionContextSnapshots", "Contextos de sessão", 40],
    ["athleteSessionAssignments", "Atribuições", 40],
    ["importedTrainingSessions", "Treinos externos confirmados", 30],
    ["videos", "Vídeos", 30],
    ["activities", "Atividades", 60],
  ];

  for (const [kind, title, limit] of sections) {
    const rows = athleteRows(store, kind, organizationId, athleteId);
    if (rows.length) parts.push(`## ${title} (${rows.length})\n${JSON.stringify(rows.slice(0, limit).map(compact))}`);
  }

  const audit = store.audit(500)
    .filter((event) => String(event.organizationId ?? "org-demo") === organizationId)
    .filter((event) => event.resourceId === athleteId || norm(event.summary).includes(norm(athleteId)))
    .slice(0, 40);
  if (audit.length) parts.push(`## Auditoria relacionada\n${JSON.stringify(audit)}`);

  const text = parts.join("\n\n");
  return text.length <= MAX_CONTEXT_CHARS
    ? text
    : `${text.slice(0, MAX_CONTEXT_CHARS)}\n[contexto truncado; fonte integral permanece no banco]`;
}

export function buildCoachDecisionEvidence(store: ManagedStore, organizationId: string, athleteId?: string) {
  const prioritize = (rows: ManagedRecord[]) => athleteId
    ? [...rows.filter((row) => row.athleteId === athleteId), ...rows.filter((row) => row.athleteId !== athleteId)]
    : rows;
  const prescriptions = recent(orgRows(store, "prescriptions", organizationId))
    .filter((row) => row.status === "PUBLISHED" || Boolean(row.approvedBy) || Boolean(row.publishedSnapshot));
  const adaptations = recent(orgRows(store, "adaptationDecisions", organizationId));
  const governance = recent(orgRows(store, "governance", organizationId));
  const audit = store.audit(120).filter((event) => String(event.organizationId ?? "org-demo") === organizationId).slice(0, 40);

  return `=== EVIDÊNCIA HISTÓRICA DO PADRÃO DECISÓRIO DO COACH ===\n${JSON.stringify({
    warning: "Não transforme correlação histórica em regra metodológica.",
    approvedPrescriptions: prioritize(prescriptions).slice(0, 30).map(compact),
    adaptationDecisions: prioritize(adaptations).slice(0, 30).map(compact),
    governanceDecisions: governance.slice(0, 20).map(compact),
    recentAudit: audit,
  })}`;
}

function ageOf(row: ManagedRecord) {
  const explicit = Number(row.age);
  if (Number.isFinite(explicit) && explicit >= 8) return Math.floor(explicit);
  if (typeof row.birthDate !== "string") return undefined;
  const birth = new Date(`${row.birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return undefined;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 8 ? age : undefined;
}

function parseEventMeters(value: unknown) {
  const match = String(value ?? "").match(/\b(50|100|200|400|800|1500)\b/);
  return match ? Number(match[1]) : undefined;
}

function specialtyOf(row: ManagedRecord, meters?: number): Specialty | undefined {
  const explicit = norm(row.specialty).replace(/\s+/g, "_");
  if (explicit === "velocidade" || explicit === "meio_fundo" || explicit === "fundo") return explicit;
  if (!meters) return undefined;
  return meters <= 100 ? "velocidade" : meters <= 400 ? "meio_fundo" : "fundo";
}

function latestNumber(rows: ManagedRecord[], keys: string[]) {
  for (const row of rows) {
    for (const key of keys) {
      const value = Number(row[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

export function derivePlanningInputs(
  store: ManagedStore,
  organizationId: string,
  athleteId: string,
  overrides: PlanningOverrides = {},
): DerivedPlanningInputs {
  const athleteRecord = orgRows(store, "athletes", organizationId).find((row) => row.id === athleteId);
  if (!athleteRecord) return { missing: ["athlete"], provenance: [] };

  const provenance: string[] = [];
  const prescriptions = athleteRows(store, "prescriptions", organizationId, athleteId);
  const latest = prescriptions.find((row) => row.status === "PUBLISHED" || Boolean(row.publishedSnapshot)) ?? prescriptions[0];
  const snapshot = (latest?.publishedSnapshot ?? latest?.prescription ?? {}) as Record<string, unknown>;
  const goals = athleteRows(store, "goals", organizationId, athleteId);
  const settings = orgRows(store, "settings", organizationId)[0];

  const age = overrides.age ?? ageOf(athleteRecord);
  if (age !== undefined) provenance.push(overrides.age !== undefined ? "idade: override explícito" : "idade: cadastro");

  const goalEvent = goals[0]?.event ?? athleteRecord.primaryEvent ?? athleteRecord.goalEvent;
  const recordedMeters = Number(athleteRecord.eventMeters);
  const meters = overrides.eventMeters ?? (recordedMeters || parseEventMeters(goalEvent));
  const specialty = overrides.specialty ?? specialtyOf(athleteRecord, meters);
  if (specialty) provenance.push(overrides.specialty ? "especialidade: override explícito" : athleteRecord.specialty ? "especialidade: cadastro" : "especialidade: derivada deterministicamente da prova");

  const level = overrides.developmentLevel ?? (
    norm(athleteRecord.developmentLevel) === "formacao" ? "formacao"
      : norm(athleteRecord.developmentLevel) === "rendimento" ? "rendimento"
        : age !== undefined ? (age <= 13 ? "formacao" : "rendimento") : undefined
  );
  if (level) provenance.push(overrides.developmentLevel ? "estágio: override explícito" : athleteRecord.developmentLevel ? "estágio: cadastro" : "estágio: regra metodológica por faixa etária");

  const configuredPool = String(settings?.primaryPool ?? "");
  const recordedPool = Number(athleteRecord.poolLengthM);
  const fallbackPool = recordedPool || (configuredPool.includes("25") ? 25 : configuredPool.includes("50") ? 50 : 0);
  const poolCandidate = overrides.poolLengthM ?? fallbackPool;
  const poolLengthM = poolCandidate === 25 || poolCandidate === 50 ? poolCandidate : undefined;
  if (poolLengthM) provenance.push(overrides.poolLengthM ? "piscina: override explícito" : "piscina: cadastro/configuração");

  const phaseRaw = overrides.phase ?? snapshot.phase ?? latest?.phase;
  const phase = typeof phaseRaw === "string" && (PHASES as readonly string[]).includes(phaseRaw) ? phaseRaw as RkfPhaseId : undefined;
  if (phase) provenance.push(overrides.phase ? "fase ATR: override explícito" : "fase ATR: última prescrição confirmada");

  const objective = overrides.objective?.trim()
    || (typeof snapshot.objective === "string" ? snapshot.objective : "")
    || (typeof goals[0]?.objective === "string" ? String(goals[0].objective) : "")
    || (goalEvent ? `Preparação para ${String(goalEvent)}` : "");
  if (objective) provenance.push(overrides.objective ? "objetivo: override explícito" : "objetivo: prescrição/meta confirmada");

  const zoneRaw = overrides.primaryZone ?? snapshot.primaryZone ?? latest?.primaryZone;
  const primaryZone = typeof zoneRaw === "string" && (ZONES as readonly string[]).includes(zoneRaw) ? zoneRaw as ZoneCode : undefined;
  if (primaryZone) provenance.push(overrides.primaryZone ? "zona: override explícito" : "zona: última prescrição confirmada");

  const prescribed = Number(snapshot.totalVolumeM ?? latest?.totalVolumeM);
  const volumeRows = [
    ...athleteRows(store, "sessionExecutions", organizationId, athleteId),
    ...athleteRows(store, "activities", organizationId, athleteId),
  ];
  const recentVolumes = volumeRows
    .map((row) => Number(row.prescribedVolumeM ?? row.sessionDistanceM ?? row.executedVolumeM ?? row.distanceMeters))
    .filter((value) => Number.isFinite(value) && value >= 500)
    .slice(0, 6);
  const weekly = Number(athleteRecord.weeklyDistance);
  const historicalVolume = recentVolumes.length
    ? Math.round((recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length) / 10) * 10
    : Number.isFinite(weekly) && weekly > 0 ? Math.round((weekly / 6) / 10) * 10 : undefined;
  const targetVolumeM = overrides.targetVolumeM ?? (Number.isFinite(prescribed) && prescribed > 0 ? prescribed : historicalVolume);
  if (targetVolumeM) provenance.push(overrides.targetVolumeM ? "volume: override explícito" : Number.isFinite(prescribed) && prescribed > 0 ? "volume: última prescrição confirmada" : "volume: média histórica para revisão humana");

  const readiness = latestNumber([
    ...athleteRows(store, "readinessScores", organizationId, athleteId),
    ...athleteRows(store, "athleteResponses", organizationId, athleteId),
    athleteRecord,
  ], ["score", "readiness"]);
  if (readiness !== undefined) provenance.push("readiness: último dado disponível");

  const restrictions = Array.isArray(athleteRecord.restrictions)
    ? athleteRecord.restrictions.map(String)
    : typeof athleteRecord.restrictions === "string" ? [athleteRecord.restrictions] : [];

  const recentSessionIds = prescriptions
    .map((row) => ((row.publishedSnapshot ?? row.prescription ?? {}) as Record<string, unknown>).source)
    .map((source) => typeof source === "object" && source !== null ? String((source as Record<string, unknown>).librarySessionId ?? "") : "")
    .filter(Boolean)
    .slice(0, 12);

  const missing = [
    age === undefined ? "age/birthDate" : "",
    !level ? "developmentLevel" : "",
    !specialty ? "specialty/event" : "",
    !poolLengthM ? "poolLengthM" : "",
    !phase ? "phase" : "",
    !objective ? "objective/goal" : "",
    !primaryZone ? "primaryZone" : "",
    !targetVolumeM ? "targetVolumeM" : "",
  ].filter(Boolean);

  if (missing.length || age === undefined || !level || !specialty || !poolLengthM || !phase || !objective || !primaryZone || !targetVolumeM) {
    return { missing, provenance };
  }

  return {
    athlete: { athleteId, age, developmentLevel: level, specialty, poolLengthM, eventMeters: meters, restrictions },
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

async function callCoachLlm(system: string, prompt: string) {
  if (!LLM_API_KEY) throw new Error("LLM_API_KEY não configurada");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        temperature: 0.25,
        max_tokens: 2200,
        stream: false,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`LLM respondeu ${response.status}`);
    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
    const text = parsed.choices?.[0]?.message?.content?.trim() || parsed.choices?.[0]?.message?.reasoning_content?.trim();
    if (!text) throw new Error("Resposta vazia do modelo");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

const requestSchema = z.object({
  age: z.number().int().min(8).max(120).optional(),
  developmentLevel: z.enum(["formacao", "rendimento"]).optional(),
  specialty: z.enum(["velocidade", "meio_fundo", "fundo"]).optional(),
  poolLengthM: z.union([z.literal(25), z.literal(50)]).optional(),
  eventMeters: z.number().positive().optional(),
  phase: z.enum(PHASES).optional(),
  objective: z.string().trim().min(2).max(400).optional(),
  primaryZone: z.enum(ZONES).optional(),
  secondaryZone: z.enum(ZONES).optional(),
  targetVolumeM: z.number().int().min(500).max(30000).multipleOf(10).optional(),
  rdcMarker: z.boolean().optional(),
  requiredLegVolumeM: z.number().int().positive().multipleOf(10).optional(),
  skillEmphasis: z.array(z.string().trim().min(1)).max(12).optional(),
  focus: z.string().trim().max(1000).optional(),
});

export function registerCoachBrainRoutes(app: FastifyInstance, store: ManagedStore, catalogStore?: CatalogKnowledgeStore) {
  app.get("/api/v1/ai/coach-brain/status", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) {
      return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    }

    const library = loadRkfLibrary();
    const knowledge = await buildRkfKnowledgeContext("governança planejamento ATR carga sessão-chave personalização atleta treinador").catch(() => "");
    const catalog = catalogStore?.status(user!.organizationId);
    const operationalPackageReady = Boolean(
      library && library.stats.sessions === 910 && library.stats.blocks === 6226 && library.stats.volumeMismatched === 0,
    );

    return {
      ready: Boolean(operationalPackageReady && knowledge && catalog),
      policyVersion: COACH_BRAIN_POLICY_VERSION,
      sources: {
        implementationManual: { source: COACH_BRAIN_MANUAL_SOURCE, integratedAs: "governança/política decisória", ready: true },
        officialPackageV4: { source: COACH_BRAIN_PACKAGE_SOURCE, integratedAs: "contrato operacional projetado no DB/biblioteca RKF V5.1", ready: operationalPackageReady },
        privateKnowledgeBase: { ready: Boolean(knowledge), retrieval: "RAG" },
        masterCatalog: { ready: Boolean(catalog), version: catalog?.version ?? null, packageHash: catalog?.packageHash ?? null },
      },
      library: library ? {
        sessions: library.stats.sessions,
        blocks: library.stats.blocks,
        exact: library.stats.volumeMismatched === 0,
        packageHash: library.stats.packageHash,
      } : null,
      decisionMemory: {
        approvedPrescriptions: orgRows(store, "prescriptions", user!.organizationId).filter((row) => row.status === "PUBLISHED" || Boolean(row.approvedBy)).length,
        adaptationDecisions: orgRows(store, "adaptationDecisions", user!.organizationId).length,
        athleteResponses: orgRows(store, "athleteResponses", user!.organizationId).length,
        loadSnapshots: orgRows(store, "loadSnapshots", user!.organizationId).length,
      },
      safeguards: { coachApprovalRequired: true, xlsxIsNotRuntimeDb: true, hardRulesBeforeAi: true, tenantIsolation: true },
    };
  });

  app.post("/api/v1/ai/athletes/:athleteId/personalized-training", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) {
      return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    }

    const params = z.object({ athleteId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Atleta inválido", details: params.error.flatten() });
    const body = requestSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Pedido de treino personalizado inválido", details: body.error.flatten() });

    const athlete = orgRows(store, "athletes", user!.organizationId).find((row) => row.id === params.data.athleteId);
    if (!athlete) return reply.code(404).send({ error: "Atleta não encontrado nesta organização" });

    const derived = derivePlanningInputs(store, user!.organizationId, athlete.id, {
      ...body.data,
      skillEmphasis: body.data.skillEmphasis as SkillCode[] | undefined,
    });
    if (!derived.athlete || !derived.request) {
      return reply.code(422).send({
        error: "Faltam dados confirmados para uma prescrição RKF segura.",
        missing: derived.missing,
        provenance: derived.provenance,
        rule: "A IA não preenche lacunas críticas por palpite.",
      });
    }

    const library = loadRkfLibrary();
    if (!library) return reply.code(503).send({ error: "Biblioteca operacional RKF V5.1 indisponível" });
    const planning = generatePrescription(derived.athlete, derived.request, library.sessions);
    if (!planning.prescription) return reply.code(422).send({ error: "Planning Engine não gerou candidato auditável", planning });

    const query = [body.data.focus, derived.request.objective, derived.request.primaryZone, derived.request.phase, athlete.name]
      .filter(Boolean).join(" ");
    const knowledge = await buildRkfKnowledgeContext(query);
    const catalog = catalogContext(catalogStore, user!.organizationId, query);
    const system = [COACH_POLICY, knowledge, catalog].filter(Boolean).join("\n\n");
    const prompt = [
      `ATLETA: ${String(athlete.name ?? athlete.id)} (${athlete.id})`,
      buildAthleteBrainContext(store, user!.organizationId, athlete.id),
      buildCoachDecisionEvidence(store, user!.organizationId, athlete.id),
      `=== CANDIDATO NORMATIVO DO PLANNING ENGINE ===\n${JSON.stringify(planning)}`,
      `PROVENIÊNCIA: ${derived.provenance.join("; ")}`,
      body.data.focus ? `FOCO DO COACH: ${body.data.focus}` : "",
      "Explique a prescrição de modo personalizado sem alterar volume, zonas ou blocos do Planning Engine. Identifique os fatos do atleta que influenciaram a escolha. Inclua critério de sucesso, alternativa AMARELA, alternativa VERMELHA e critério de parada. Se uma alternativa mudar objetivo, zona ou fundamento, declare que exige nova execução do Planning Engine. Termine com o que o treinador deve confirmar antes de publicar.",
    ].filter(Boolean).join("\n\n");

    let personalizedExplanation: string | null = null;
    let llmError: string | undefined;
    try {
      personalizedExplanation = await callCoachLlm(system, prompt);
    } catch (error) {
      llmError = error instanceof Error ? error.message : "Falha na IA";
    }

    return reply.code(planning.status === "PRONTO" ? 200 : 422).send({
      status: planning.status,
      athlete: { id: athlete.id, name: athlete.name },
      personalizedExplanation,
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
