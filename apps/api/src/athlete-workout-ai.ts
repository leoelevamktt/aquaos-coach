import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generatePrescription,
  type RkfPhaseId,
  type ZoneCode,
} from "@natacao/domain";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import type { ManagedRecord, ManagedStore } from "./managed-store.js";
import {
  buildAthleteBrainContext,
  buildCoachDecisionEvidence,
  derivePlanningInputs,
  COACH_BRAIN_POLICY_VERSION,
} from "./coach-brain.js";
import { loadRkfLibrary } from "./rkf-library.js";
import { buildRkfKnowledgeContext } from "./rkf-knowledge-injection.js";
import { buildRkfCatalogContext } from "./rkf-catalog-retrieval.js";
import type { CatalogRow } from "./rkf-catalog-store.js";

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://anymodel.org/v1";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_MODEL = process.env.LLM_MODEL ?? "ag/gemini-3.7-flash-high";

const PHASES = ["ADAPTACAO", "BASE", "DESENVOLVIMENTO", "ESPECIFICO", "ACUMULACAO", "TRANSFORMACAO", "REALIZACAO", "TAPER", "COMPETICAO"] as const;
const ZONES = ["VALAT", "A1", "A2", "A3", "AN1", "AN2"] as const;
const EQUIPMENT = ["BOARD", "PULL", "FINS", "SNORKEL", "PALMAR_P", "PALMAR_M", "PALMAR_G", "PARA", "DRAG"] as const;

const athleteRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  focus: z.string().trim().max(600).optional(),
  note: z.string().trim().max(800).optional(),
  timeAvailableMinutes: z.number().int().min(20).max(240).optional(),
  poolLengthM: z.union([z.literal(25), z.literal(50)]).optional(),
  availableEquipment: z.array(z.enum(EQUIPMENT)).max(12).optional(),
});

const explanationSchema = z.object({
  summary: z.string().min(1).max(1800),
  why: z.array(z.object({ fact: z.string().min(1).max(300), influence: z.string().min(1).max(500) })).max(8).default([]),
  successCriteria: z.array(z.string().min(1).max(400)).max(6).default([]),
  yellowAlternative: z.string().min(1).max(900),
  redAlternative: z.string().min(1).max(900),
  stopCriteria: z.array(z.string().min(1).max(400)).max(6).default([]),
  warnings: z.array(z.string().min(1).max(400)).max(6).default([]),
});

type CatalogKnowledgeStore = {
  searchAcrossSheets(organizationId: string, q: string, maxRows: number): CatalogRow[];
  status(organizationId: string): { version: number; packageHash: string } | undefined;
};

type WorkoutRequest = z.infer<typeof athleteRequestSchema>;
type Explanation = z.infer<typeof explanationSchema>;

type SafetyState = {
  readiness: number | null;
  pain: number | null;
  soreness: number | null;
  fatigue: number | null;
  reductionPct: number;
  zoneDowngrade: ZoneCode | null;
  blocked: boolean;
  reasons: string[];
  warnings: string[];
};

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function organizationRows(store: ManagedStore, kind: Parameters<ManagedStore["list"]>[0], organizationId: string) {
  return store.list(kind).filter((row) => String(row.organizationId ?? "org-demo") === organizationId);
}

function athleteRows(store: ManagedStore, kind: Parameters<ManagedStore["list"]>[0], organizationId: string, athleteId: string) {
  return organizationRows(store, kind, organizationId).filter((row) => row.athleteId === athleteId || (row.targetType === "athlete" && row.targetId === athleteId));
}

function rowDate(row: ManagedRecord) {
  const snapshot = recordObject(row.publishedSnapshot ?? row.prescription);
  return String(row.date ?? row.scheduledDate ?? snapshot.date ?? snapshot.scheduledDate ?? "").slice(0, 10);
}

function normalizeZone(value: unknown): ZoneCode | undefined {
  const zone = String(value ?? "").toUpperCase();
  return (ZONES as readonly string[]).includes(zone) ? zone as ZoneCode : undefined;
}

function normalizePhase(value: unknown): RkfPhaseId | undefined {
  const phase = String(value ?? "").toUpperCase();
  return (PHASES as readonly string[]).includes(phase) ? phase as RkfPhaseId : undefined;
}

function applicableCoachPlan(store: ManagedStore, organizationId: string, athlete: ManagedRecord, targetDate: string) {
  const groupNames = new Set<string>([String(athlete.group ?? ""), String(athlete.groupId ?? "")].filter(Boolean));
  for (const group of organizationRows(store, "groups", organizationId)) {
    if (group.id === athlete.groupId || group.name === athlete.group) {
      groupNames.add(group.id);
      if (group.name) groupNames.add(String(group.name));
    }
  }
  const teamNames = new Set<string>([String(athlete.teamId ?? ""), String(athlete.team ?? "")].filter(Boolean));
  const plans = organizationRows(store, "prescriptions", organizationId)
    .filter((row) => row.status === "PUBLISHED" || Boolean(row.approvedBy) || Boolean(row.publishedSnapshot))
    .filter((row) => {
      if (row.athleteId === athlete.id || (row.targetType === "athlete" && row.targetId === athlete.id)) return true;
      if (row.targetType === "group" && groupNames.has(String(row.targetId ?? ""))) return true;
      if (row.targetType === "team" && teamNames.has(String(row.targetId ?? ""))) return true;
      return false;
    })
    .sort((a, b) => {
      const aToday = rowDate(a) === targetDate ? 1 : 0;
      const bToday = rowDate(b) === targetDate ? 1 : 0;
      if (aToday !== bToday) return bToday - aToday;
      return String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt));
    });
  return plans[0];
}

function planSnapshot(plan: ManagedRecord | undefined) {
  if (!plan) return {};
  return recordObject(plan.publishedSnapshot ?? plan.prescription ?? plan);
}

function latestNumeric(rows: ManagedRecord[], keys: string[]) {
  for (const row of rows) {
    for (const key of keys) {
      const value = numberOrNull(row[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

export function deriveAthleteWorkoutSafety(store: ManagedStore, organizationId: string, athleteId: string): SafetyState {
  const athlete = organizationRows(store, "athletes", organizationId).find((row) => row.id === athleteId);
  const responses = athleteRows(store, "athleteResponses", organizationId, athleteId);
  const readinessRows = athleteRows(store, "readinessScores", organizationId, athleteId);
  const readiness = latestNumeric([...readinessRows, ...responses, ...(athlete ? [athlete] : [])], ["score", "readiness"]);
  const pain = latestNumeric(responses, ["pain"]);
  const soreness = latestNumeric(responses, ["soreness"]);
  const fatigue = latestNumeric(responses, ["fatigue"]);

  const reasons: string[] = [];
  const warnings: string[] = [];
  let reductionPct = 0;
  let zoneDowngrade: ZoneCode | null = null;
  let blocked = false;

  if (pain !== null && pain >= 3) {
    blocked = true;
    reasons.push("Dor registrada em nível limitante: a criação automática é interrompida até revisão da comissão técnica.");
  } else if (pain !== null && pain >= 2) {
    reductionPct = Math.max(reductionPct, 25);
    zoneDowngrade = "A2";
    reasons.push("Dor em nível de atenção: política de segurança aplica redução de 25% e remove AN1/AN2 do candidato.");
  }

  if (readiness !== null && readiness < 60) {
    reductionPct = Math.max(reductionPct, 20);
    zoneDowngrade ??= "A2";
    reasons.push("Readiness abaixo de 60: política RKF considera redução de carga e retirada de zonas anaeróbias altas.");
  }

  if (readiness === null) warnings.push("Readiness atual não confirmado; o treino permanece sujeito à aprovação do treinador.");
  if (pain === null) warnings.push("Dor atual não informada; nenhum valor foi presumido.");

  return { readiness, pain, soreness, fatigue, reductionPct, zoneDowngrade, blocked, reasons, warnings };
}

function recentThroughputMPerMinute(store: ManagedStore, organizationId: string, athleteId: string) {
  const rows = [
    ...athleteRows(store, "sessionExecutions", organizationId, athleteId),
    ...athleteRows(store, "activities", organizationId, athleteId),
  ];
  const samples = rows.flatMap((row) => {
    const distance = numberOrNull(row.distanceMeters ?? row.executedVolumeM ?? row.sessionDistanceM);
    const seconds = numberOrNull(row.durationSeconds);
    const minutes = seconds !== null ? seconds / 60 : numberOrNull(row.durationMinutes);
    return distance !== null && minutes !== null && distance >= 500 && minutes >= 10 ? [distance / minutes] : [];
  }).slice(0, 8).sort((a, b) => a - b);
  if (samples.length < 2) return null;
  const middle = Math.floor(samples.length / 2);
  return samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2;
}

function videoEvidence(store: ManagedStore, organizationId: string, athleteId: string) {
  return athleteRows(store, "videos", organizationId, athleteId).slice(0, 5).map((video) => {
    const analysis = recordObject(video.analysis);
    const sport = recordObject(analysis.sportMetrics);
    const biomechanics = recordObject(analysis.biomechanics);
    const quality = recordObject(analysis.quality ?? sport.analysisQuality);
    const metrics = Array.isArray(sport.metrics) ? sport.metrics as Array<Record<string, unknown>> : [];
    const findings = Array.isArray(biomechanics.findings) ? biomechanics.findings as Array<Record<string, unknown>> : [];
    return {
      videoId: video.id,
      title: video.title,
      analyzedAt: video.analysisCompletedAt ?? video.updatedAt,
      quality: { score: quality.score ?? null, grade: quality.grade ?? null },
      metrics: metrics
        .filter((metric) => metric.status === "measured" && numberOrNull(metric.value) !== null)
        .sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
        .slice(0, 12)
        .map((metric) => ({ id: metric.id, label: metric.label, value: metric.value, unit: metric.unit, confidence: metric.confidence })),
      findings: findings.slice(0, 6).map((finding) => ({ label: finding.label, evidence: finding.evidence, severity: finding.severity })),
    };
  });
}

function compactEvidence(store: ManagedStore, organizationId: string, athlete: ManagedRecord, plan: ManagedRecord | undefined, safety: SafetyState) {
  const target = planSnapshot(plan);
  const results = athleteRows(store, "results", organizationId, athlete.id).slice(0, 5);
  const sessionResults = athleteRows(store, "sessionResults", organizationId, athlete.id).slice(0, 5);
  const loads = athleteRows(store, "loadCalculations", organizationId, athlete.id).slice(0, 5);
  const goals = athleteRows(store, "goals", organizationId, athlete.id).slice(0, 3);
  const evolution = athleteRows(store, "evolutionAssessments", organizationId, athlete.id).slice(0, 3);
  const videos = videoEvidence(store, organizationId, athlete.id);

  const signals = [
    { label: "Perfil", value: [athlete.category, athlete.level, athlete.stroke, athlete.primaryEvent ?? athlete.goalEvent].filter(Boolean).join(" · ") || "Perfil cadastrado", source: "cadastro" },
    { label: "Objetivo do treinador", value: String(target.objective ?? goals[0]?.objective ?? goals[0]?.event ?? athlete.objective ?? "UNKNOWN"), source: plan ? "prescrição aprovada" : "meta/cadastro" },
    { label: "Zona planejada", value: String(target.primaryZone ?? plan?.primaryZone ?? "UNKNOWN"), source: plan ? "prescrição aprovada" : "UNKNOWN" },
    { label: "Volume planejado", value: numberOrNull(target.totalVolumeM ?? plan?.totalVolumeM) !== null ? `${Number(target.totalVolumeM ?? plan?.totalVolumeM)} m` : "UNKNOWN", source: plan ? "prescrição aprovada" : "UNKNOWN" },
    { label: "Readiness", value: safety.readiness === null ? "UNKNOWN" : `${safety.readiness}/100`, source: "último dado confirmado" },
    { label: "Dor", value: safety.pain === null ? "UNKNOWN" : `${safety.pain}/10`, source: "último check-in" },
    { label: "Carga recente", value: loads[0] ? String(loads[0].value ?? loads[0].load ?? "registrada") : "UNKNOWN", source: loads[0] ? "loadCalculations" : "UNKNOWN" },
    { label: "Resultados recentes", value: String(sessionResults[0]?.event ?? results[0]?.event ?? sessionResults[0]?.title ?? results[0]?.title ?? "UNKNOWN"), source: sessionResults[0] || results[0] ? "resultados" : "UNKNOWN" },
    { label: "Evolução", value: String(evolution[0]?.summary ?? evolution[0]?.status ?? "UNKNOWN"), source: evolution[0] ? "evolutionAssessments" : "UNKNOWN" },
    { label: "AquaVision", value: videos.length ? `${videos.length} análise(s); última qualidade ${videos[0].quality.grade ?? "UNKNOWN"}` : "UNKNOWN", source: videos.length ? "videoAnalysis" : "UNKNOWN" },
  ];
  return { signals, videos };
}

function requestedPlanOverrides(plan: ManagedRecord | undefined, request: WorkoutRequest, safety: SafetyState, store: ManagedStore, organizationId: string, athleteId: string) {
  const snapshot = planSnapshot(plan);
  const phase = normalizePhase(snapshot.phase ?? plan?.phase);
  const primaryZone = normalizeZone(snapshot.primaryZone ?? plan?.primaryZone);
  const secondaryZone = normalizeZone(snapshot.secondaryZone ?? plan?.secondaryZone);
  const objective = typeof snapshot.objective === "string" ? snapshot.objective : typeof plan?.objective === "string" ? plan.objective : undefined;
  let targetVolumeM = numberOrNull(snapshot.totalVolumeM ?? plan?.totalVolumeM);
  const provenance: string[] = [];

  if (targetVolumeM !== null && safety.reductionPct > 0) {
    targetVolumeM = Math.max(500, Math.round((targetVolumeM * (1 - safety.reductionPct / 100)) / 10) * 10);
    provenance.push(`volume reduzido deterministicamente em ${safety.reductionPct}% por segurança/readiness`);
  }

  let zone = primaryZone;
  if (safety.zoneDowngrade && (zone === "AN1" || zone === "AN2")) {
    zone = safety.zoneDowngrade;
    provenance.push(`zona ${primaryZone} removida por safety gate; candidato reexecutado em ${zone}`);
  }

  if (request.timeAvailableMinutes && targetVolumeM !== null) {
    const throughput = recentThroughputMPerMinute(store, organizationId, athleteId);
    if (throughput !== null) {
      const capacity = Math.max(500, Math.floor((throughput * request.timeAvailableMinutes) / 10) * 10);
      if (capacity < targetVolumeM) {
        const reduction = 1 - capacity / targetVolumeM;
        if (reduction <= 0.30) {
          targetVolumeM = capacity;
          provenance.push(`volume limitado pelo tempo disponível usando ritmo de execução confirmado (${throughput.toFixed(1)} m/min)`);
        } else {
          provenance.push(`tempo disponível exigiria redução superior a 30%; não aplicado automaticamente`);
        }
      }
    } else {
      provenance.push("tempo disponível informado, mas sem histórico suficiente para converter tempo em metragem sem adivinhação");
    }
  }

  return {
    overrides: {
      poolLengthM: request.poolLengthM,
      phase,
      objective,
      primaryZone: zone,
      secondaryZone,
      targetVolumeM: targetVolumeM === null ? undefined : targetVolumeM,
    },
    provenance,
  };
}

function equipmentWarnings(prescription: { blocks: Array<{ materials: string[] }> }, available: WorkoutRequest["availableEquipment"]) {
  if (available === undefined) return [];
  const required = [...new Set(prescription.blocks.flatMap((block) => block.materials ?? []))];
  const missing = required.filter((material) => !available.includes(material as typeof EQUIPMENT[number]));
  return missing.length ? [`Equipamentos do candidato que não foram declarados como disponíveis: ${missing.join(", ")}. O treinador deve confirmar substituição ou disponibilidade.`] : [];
}

function plannedLoad(snapshot: Record<string, unknown>, request: WorkoutRequest) {
  const pse = numberOrNull(snapshot.expectedPse ?? snapshot.pse ?? snapshot.rpeTarget);
  const duration = numberOrNull(snapshot.durationMinutes) ?? request.timeAvailableMinutes ?? null;
  if (pse === null || duration === null) return { status: "UNKNOWN", value: null, method: "duration_min × sRPE", reason: "Duração e/ou PSE alvo não confirmados." };
  return { status: "estimated", value: Math.round(duration * pse), durationMinutes: duration, targetRpe: pse, method: "duration_min × sRPE" };
}

function catalogContext(store: CatalogKnowledgeStore | undefined, organizationId: string, query: string) {
  const source = store?.status(organizationId);
  if (!store || !source) return "";
  const rows = store.searchAcrossSheets(organizationId, query, 16);
  return rows.length ? buildRkfCatalogContext(rows, query, source) : "";
}

async function callAthleteLlm(system: string, prompt: string): Promise<Explanation> {
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
        temperature: 0.2,
        max_tokens: 1800,
        stream: false,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`LLM respondeu ${response.status}`);
    const envelope = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
    const text = envelope.choices?.[0]?.message?.content?.trim() || envelope.choices?.[0]?.message?.reasoning_content?.trim();
    if (!text) throw new Error("Resposta vazia do modelo");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Modelo não retornou JSON estruturado");
    const parsed = explanationSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) throw new Error("Resposta estruturada da IA inválida");
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackExplanation(planning: ReturnType<typeof generatePrescription>, evidence: ReturnType<typeof compactEvidence>, safety: SafetyState, warnings: string[]): Explanation {
  const prescription = planning.prescription!;
  return {
    summary: `Sessão RKF de ${prescription.totalVolumeM} m em ${prescription.primaryZone}, construída pelo Planning Engine e mantida pendente de aprovação do treinador.`,
    why: evidence.signals.filter((signal) => signal.value !== "UNKNOWN").slice(0, 6).map((signal) => ({ fact: `${signal.label}: ${signal.value}`, influence: `Dado confirmado considerado no contexto de personalização (${signal.source}).` })),
    successCriteria: [`Cumprir o objetivo técnico/fisiológico sem ultrapassar os critérios de segurança definidos pelo treinador.`, `Manter a execução dentro da zona ${prescription.primaryZone} e registrar PSE/feedback ao final.`],
    yellowAlternative: "Se a prontidão cair ou a técnica perder qualidade, reduzir a exigência e solicitar revisão do treinador antes de aumentar carga.",
    redAlternative: "Se houver dor relevante, piora de sintomas ou perda clara de controle técnico, interromper a sessão e avisar a comissão técnica.",
    stopCriteria: ["Dor limitante", "Perda persistente de qualidade técnica", "Sinal de segurança definido pelo treinador"],
    warnings: [...safety.warnings, ...warnings],
  };
}

export function buildAthleteWorkoutContextSummary(store: ManagedStore, organizationId: string, athleteId: string, targetDate = localDate()) {
  const athlete = organizationRows(store, "athletes", organizationId).find((row) => row.id === athleteId);
  if (!athlete) return undefined;
  const plan = applicableCoachPlan(store, organizationId, athlete, targetDate);
  const safety = deriveAthleteWorkoutSafety(store, organizationId, athleteId);
  const evidence = compactEvidence(store, organizationId, athlete, plan, safety);
  const completedToday = athleteRows(store, "sessionExecutions", organizationId, athleteId).some((row) => rowDate(row) === targetDate)
    || athleteRows(store, "activities", organizationId, athleteId).some((row) => rowDate(row) === targetDate && String(row.status ?? "").toLowerCase() === "confirmed");
  return {
    athlete: { id: athlete.id, name: athlete.name },
    targetDate,
    coachPlan: plan ? { id: plan.id, title: plan.title, status: plan.status, date: rowDate(plan) || null } : null,
    safety,
    evidence,
    completedToday,
  };
}

export function registerAthleteWorkoutAiRoutes(app: FastifyInstance, store: ManagedStore, catalogStore?: CatalogKnowledgeStore) {
  app.get("/api/v1/ai/athlete/workout-context", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["athlete"])) return reply.code(user ? 403 : 401).send({ error: user ? "Acesso exclusivo do atleta" : "Autenticação necessária" });
    if (!user!.athleteId) return reply.code(409).send({ error: "Conta sem atleta vinculado" });
    const query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: "Data inválida" });
    const context = buildAthleteWorkoutContextSummary(store, user!.organizationId, user!.athleteId, query.data.date ?? localDate());
    if (!context) return reply.code(404).send({ error: "Perfil do atleta não encontrado" });
    return reply.send(context);
  });

  app.get("/api/v1/ai/athlete/workouts", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["athlete"])) return reply.code(user ? 403 : 401).send({ error: user ? "Acesso exclusivo do atleta" : "Autenticação necessária" });
    if (!user!.athleteId) return reply.code(409).send({ error: "Conta sem atleta vinculado" });
    const rows = organizationRows(store, "prescriptions", user!.organizationId)
      .filter((row) => row.athleteId === user!.athleteId && row.source === "ATHLETE_AI")
      .slice(0, 20)
      .map((row) => ({ id: row.id, title: row.title, status: row.status, scheduledDate: row.scheduledDate, totalVolumeM: row.totalVolumeM, primaryZone: row.primaryZone, generatedAt: row.generatedAt, submittedAt: row.submittedAt, approvedAt: row.approvedAt, rejectedAt: row.rejectedAt }));
    return reply.send({ data: rows });
  });

  app.post("/api/v1/ai/athlete/workouts/generate", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["athlete"])) return reply.code(user ? 403 : 401).send({ error: user ? "Acesso exclusivo do atleta" : "Autenticação necessária" });
    const athleteId = user!.athleteId;
    if (!athleteId) return reply.code(409).send({ error: "Conta sem atleta vinculado" });
    const body = athleteRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Pedido de treino inválido", details: body.error.flatten() });
    const targetDate = body.data.date ?? localDate();
    const context = buildAthleteWorkoutContextSummary(store, user!.organizationId, athleteId, targetDate);
    if (!context) return reply.code(404).send({ error: "Perfil do atleta não encontrado" });
    if (context.safety.blocked) return reply.code(422).send({ error: "Treino automático bloqueado por segurança.", safety: context.safety, approval: { required: true, authority: "coach" } });
    if (context.completedToday) return reply.code(409).send({ error: "Já existe uma execução confirmada para esta data. Uma sessão adicional precisa ser definida pelo treinador.", targetDate, approval: { required: true, authority: "coach" } });

    const athlete = organizationRows(store, "athletes", user!.organizationId).find((row) => row.id === athleteId)!;
    const plan = applicableCoachPlan(store, user!.organizationId, athlete, targetDate);
    const planData = requestedPlanOverrides(plan, body.data, context.safety, store, user!.organizationId, athleteId);
    const derived = derivePlanningInputs(store, user!.organizationId, athleteId, planData.overrides);
    if (!derived.athlete || !derived.request) {
      return reply.code(422).send({ error: "Faltam dados confirmados para gerar um treino RKF seguro.", missing: derived.missing, provenance: derived.provenance, rule: "UNKNOWN em vez de adivinhar." });
    }

    const library = loadRkfLibrary();
    if (!library) return reply.code(503).send({ error: "Biblioteca operacional RKF V5.1 indisponível" });
    const planning = generatePrescription(derived.athlete, derived.request, library.sessions);
    if (!planning.prescription) return reply.code(422).send({ error: "Planning Engine não gerou candidato auditável", planning });

    const equipment = equipmentWarnings(planning.prescription, body.data.availableEquipment);
    const targetVolume = planning.prescription.totalVolumeM;
    const originalVolume = numberOrNull(planSnapshot(plan).totalVolumeM ?? plan?.totalVolumeM);
    const timeConstraintWarning = body.data.timeAvailableMinutes && originalVolume && targetVolume === originalVolume && recentThroughputMPerMinute(store, user!.organizationId, athleteId)
      ? []
      : body.data.timeAvailableMinutes && planData.provenance.some((item) => item.includes("superior a 30%"))
        ? ["O tempo disponível exigiria desvio de carga superior ao limite automático de 30%; o treinador deve revisar a duração."]
        : [];
    const warnings = [...equipment, ...timeConstraintWarning];
    const evidence = compactEvidence(store, user!.organizationId, athlete, plan, context.safety);
    const video = evidence.videos;

    const query = [body.data.focus, planning.prescription.objective, planning.prescription.primaryZone, athlete.name, "treino atleta personalizado readiness carga vídeo biomecânica"].filter(Boolean).join(" ");
    const knowledge = await buildRkfKnowledgeContext(query).catch(() => "");
    const catalog = catalogContext(catalogStore, user!.organizationId, query);
    const system = [
      `=== ASSISTENTE DE TREINO DO ATLETA · ${COACH_BRAIN_POLICY_VERSION} ===`,
      "Você personaliza a explicação de um candidato já gerado pelo Planning Engine RKF. Não altere volume, zona, blocos, objetivo nem fundamento. Não invente dados ausentes. Planned ≠ performed. UNKNOWN permanece UNKNOWN. Toda prescrição criada pelo atleta exige aprovação do treinador antes de se tornar oficial.",
      "Responda SOMENTE JSON com: summary, why[{fact,influence}], successCriteria[], yellowAlternative, redAlternative, stopCriteria[], warnings[].",
      knowledge,
      catalog,
    ].filter(Boolean).join("\n\n");
    const prompt = [
      `ATLETA: ${String(athlete.name ?? athlete.id)} (${athlete.id})`,
      buildAthleteBrainContext(store, user!.organizationId, athleteId),
      `=== AQUAVISION / MÉTRICAS DE VÍDEO CONFIRMADAS ===\n${JSON.stringify(video)}`,
      buildCoachDecisionEvidence(store, user!.organizationId, athleteId),
      `=== PLANO/ÂNCORA DO TREINADOR ===\n${JSON.stringify(plan ? { id: plan.id, title: plan.title, snapshot: planSnapshot(plan) } : { status: "UNKNOWN" })}`,
      `=== CANDIDATO NORMATIVO DO PLANNING ENGINE ===\n${JSON.stringify(planning)}`,
      `=== SAFETY GATE ===\n${JSON.stringify(context.safety)}`,
      `=== CONTEXTO INFORMADO PELO ATLETA ===\n${JSON.stringify(body.data)}`,
      `PROVENIÊNCIA: ${[...derived.provenance, ...planData.provenance].join("; ")}`,
      warnings.length ? `PENDÊNCIAS: ${warnings.join(" | ")}` : "",
      "Explique por que este treino faz sentido para este atleta citando apenas fatos presentes no contexto. Critérios amarelo/vermelho devem ser conservadores e nunca diagnosticar clinicamente.",
    ].filter(Boolean).join("\n\n");

    let explanation: Explanation;
    let llmError: string | undefined;
    try {
      explanation = await callAthleteLlm(system, prompt);
    } catch (error) {
      llmError = error instanceof Error ? error.message : "Falha na IA";
      explanation = fallbackExplanation(planning, evidence, context.safety, warnings);
    }

    const status = planning.status === "PRONTO" && warnings.length === 0 ? "DRAFT_ATHLETE_AI" : "DRAFT_REQUIRES_REVIEW";
    const loadEstimate = plannedLoad(planSnapshot(plan), body.data);
    const record = store.create("prescriptions", {
      athleteId,
      title: planning.prescription.title,
      scheduledDate: targetDate,
      objective: planning.prescription.objective,
      primaryZone: planning.prescription.primaryZone,
      secondaryZone: planning.prescription.secondaryZone,
      totalVolumeM: planning.prescription.totalVolumeM,
      status,
      source: "ATHLETE_AI",
      approvalRequired: true,
      authority: "coach",
      generatedAt: new Date().toISOString(),
      generatedBy: user!.id,
      requestContext: body.data,
      safety: context.safety,
      evidence,
      provenance: [...derived.provenance, ...planData.provenance],
      warnings,
      loadEstimate,
      planning,
      prescription: planning.prescription,
      personalizedExplanation: explanation,
      llmError,
      coachPlanId: plan?.id,
      organizationId: user!.organizationId,
      actorId: user!.id,
    }, "create");

    store.create("activities", {
      type: "athlete-ai-workout-generated",
      athleteId,
      title: planning.prescription.title,
      prescriptionId: record.id,
      date: targetDate,
      status: "draft",
      organizationId: user!.organizationId,
      actorId: user!.id,
    }, "create");

    return reply.code(201).send({
      proposalId: record.id,
      status,
      athlete: context.athlete,
      targetDate,
      workout: planning.prescription,
      explanation,
      evidence: evidence.signals,
      videoEvidence: video,
      safety: context.safety,
      warnings,
      loadEstimate,
      provenance: [...derived.provenance, ...planData.provenance],
      llmError,
      approval: { required: true, status: "DRAFT", authority: "coach" },
    });
  });

  app.post("/api/v1/ai/athlete/workouts/:proposalId/submit", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["athlete"])) return reply.code(user ? 403 : 401).send({ error: user ? "Acesso exclusivo do atleta" : "Autenticação necessária" });
    if (!user!.athleteId) return reply.code(409).send({ error: "Conta sem atleta vinculado" });
    const params = z.object({ proposalId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Proposta inválida" });
    const proposal = store.get("prescriptions", params.data.proposalId);
    if (!proposal || proposal.organizationId !== user!.organizationId || proposal.athleteId !== user!.athleteId || proposal.source !== "ATHLETE_AI") return reply.code(404).send({ error: "Proposta não encontrada" });
    if (!["DRAFT_ATHLETE_AI", "DRAFT_REQUIRES_REVIEW"].includes(String(proposal.status))) return reply.code(409).send({ error: "Esta proposta não está disponível para envio", status: proposal.status });
    const updated = store.update("prescriptions", proposal.id, { status: "PENDING_COACH_APPROVAL", submittedAt: new Date().toISOString(), actorId: user!.id }, "update");
    store.create("activities", { type: "athlete-ai-workout-submitted", athleteId: user!.athleteId, prescriptionId: proposal.id, title: proposal.title, date: proposal.scheduledDate, status: "pending_coach_approval", organizationId: user!.organizationId, actorId: user!.id }, "create");
    return reply.send({ proposal: updated, approval: { required: true, status: "PENDING_COACH_APPROVAL", authority: "coach" } });
  });

  app.post("/api/v1/ai/athlete/workouts/:proposalId/review", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" });
    const params = z.object({ proposalId: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1200).optional() }).safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: "Revisão inválida" });
    const proposal = store.get("prescriptions", params.data.proposalId);
    if (!proposal || proposal.organizationId !== user!.organizationId || proposal.source !== "ATHLETE_AI") return reply.code(404).send({ error: "Proposta não encontrada" });
    if (proposal.status !== "PENDING_COACH_APPROVAL") return reply.code(409).send({ error: "Proposta não está pendente de aprovação", status: proposal.status });

    if (body.data.decision === "reject") {
      const rejected = store.update("prescriptions", proposal.id, { status: "REJECTED", rejectedAt: new Date().toISOString(), rejectedBy: user!.id, reviewNote: body.data.note, actorId: user!.id }, "update");
      store.create("activities", { type: "athlete-ai-workout-rejected", athleteId: proposal.athleteId, prescriptionId: proposal.id, title: proposal.title, date: proposal.scheduledDate, status: "rejected", note: body.data.note, organizationId: user!.organizationId, actorId: user!.id }, "create");
      return reply.send({ proposal: rejected });
    }

    const rx = recordObject(proposal.prescription);
    const approvedAt = new Date().toISOString();
    const approved = store.update("prescriptions", proposal.id, {
      status: "PUBLISHED",
      immutable: true,
      approvedBy: user!.id,
      approvedAt,
      reviewNote: body.data.note,
      publishedSnapshot: structuredClone(rx),
      actorId: user!.id,
    }, "update");
    const existingWorkout = organizationRows(store, "workouts", user!.organizationId).find((row) => row.prescriptionId === proposal.id);
    const workout = existingWorkout ?? store.create("workouts", {
      title: proposal.title,
      date: proposal.scheduledDate,
      scheduledDate: proposal.scheduledDate,
      objective: proposal.objective,
      distanceMeters: proposal.totalVolumeM,
      zone: proposal.primaryZone,
      blocks: rx.blocks ?? [],
      targetType: "athlete",
      targetId: proposal.athleteId,
      athleteId: proposal.athleteId,
      prescriptionId: proposal.id,
      status: "published",
      source: "ATHLETE_AI_APPROVED",
      approvedBy: user!.id,
      approvedAt,
      organizationId: user!.organizationId,
      actorId: user!.id,
    }, "create");
    store.create("activities", { type: "athlete-ai-workout-approved", athleteId: proposal.athleteId, prescriptionId: proposal.id, workoutId: workout.id, title: proposal.title, date: proposal.scheduledDate, status: "approved", note: body.data.note, organizationId: user!.organizationId, actorId: user!.id }, "create");
    return reply.send({ proposal: approved, workout, approval: { required: false, status: "APPROVED", authority: "coach" } });
  });
}
