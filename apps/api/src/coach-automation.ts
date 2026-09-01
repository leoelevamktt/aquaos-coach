import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import type { ManagedRecord, ManagedStore, ResourceKind, StoreEvent } from "./managed-store.js";

const ENGINE_VERSION = "rkf-coach-automation-1.0.0";
const WATCHED_RESOURCES = new Set<ResourceKind>(["athletes", "activities", "results", "loadSnapshots", "readinessScores", "athleteResponses", "workouts", "prescriptions", "sessionExecutions", "evolutionAssessments"]);
const activeRuns = new Set<string>();

type AutomationPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "OPPORTUNITY";
type AutomationAction = "BLOCK_INTENSITY" | "REDUCE_LOAD" | "PROGRESS_LOAD" | "RECOVERY_REVIEW" | "ATTENDANCE_REVIEW" | "TECHNICAL_REVIEW" | "MAINTAIN";

type Candidate = {
  athleteId: string;
  athleteName: string;
  rule: string;
  priority: AutomationPriority;
  action: AutomationAction;
  title: string;
  rationale: string;
  triggers: string[];
  loadFactor: number;
  suggestedZone?: string;
  requiresCoachApproval: boolean;
  autoApplied: string[];
};

const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const round10 = (value: number) => Math.max(0, Math.round(value / 10) * 10);
const dateOf = (record: ManagedRecord) => String(record.date ?? record.occurredOn ?? record.updatedAt).slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

function latestFor(store: ManagedStore, kind: ResourceKind, athleteId: string, organizationId: string) {
  return store.list(kind).filter((item) => item.organizationId === organizationId && item.athleteId === athleteId).sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || b.updatedAt.localeCompare(a.updatedAt))[0];
}

function evolutionSignal(store: ManagedStore, athleteId: string, organizationId: string) {
  const sources = [...store.list("evolutionAssessments"), ...store.list("results")]
    .filter((item) => item.organizationId === organizationId && item.athleteId === athleteId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const source of sources) {
    const assessment = (source.evolutionAssessment ?? source.assessment ?? source) as Record<string, unknown>;
    const classification = String(assessment.classification ?? "");
    if (classification) return { classification, deltaPct: number(assessment.scoreDeltaPct) };
  }
  return undefined;
}

function candidateFor(store: ManagedStore, athlete: ManagedRecord, organizationId: string): Candidate {
  const readinessRecord = latestFor(store, "readinessScores", athlete.id, organizationId);
  const wellnessRecord = latestFor(store, "athleteResponses", athlete.id, organizationId);
  const fatigue = number(wellnessRecord?.fatigue);
  const soreness = number(wellnessRecord?.soreness);
  const pain = number(wellnessRecord?.pain ?? readinessRecord?.pain);
  const derivedReadiness = wellnessRecord
    ? Math.max(0, Math.min(100, Math.round(100 - (fatigue ?? 0) * 5 - (soreness ?? 0) * 3 - (pain ?? 0) * 5)))
    : undefined;
  const readiness = number(readinessRecord?.score ?? readinessRecord?.readiness ?? derivedReadiness ?? athlete.readiness);
  const sleep = number(wellnessRecord?.sleepHours ?? readinessRecord?.sleepHours ?? athlete.sleep);
  const attendance = number(athlete.attendance);
  const currentVolume = number(athlete.weeklyDistance) ?? 0;
  const previousVolume = number(athlete.previousDistance) ?? 0;
  const volumeDelta = previousVolume > 0 ? (currentVolume - previousVolume) / previousVolume : 0;
  const evolution = evolutionSignal(store, athlete.id, organizationId);
  const athleteName = String(athlete.name ?? athlete.id);
  const base = { athleteId: athlete.id, athleteName, requiresCoachApproval: true, autoApplied: ["prioridade", "estado do atleta", "fila de decisão"] };

  if ((pain ?? 0) >= 5 || (readiness ?? 100) < 45) return {
    ...base, rule: "AUTO-R001", priority: "CRITICAL", action: "BLOCK_INTENSITY", title: `Bloquear intensidade de ${athleteName}`,
    rationale: "Dor relevante ou readiness crítico exige retirada de alta intensidade e decisão humana.",
    triggers: [`Readiness ${readiness ?? "sem dado"}/100`, `Dor ${pain ?? "sem dado"}/10`], loadFactor: 0.65, suggestedZone: "A1",
  };
  if ((readiness ?? 100) < 70 || (sleep ?? 8) < 6 || volumeDelta > 0.15 || evolution?.classification === "INVOLUCAO_CONFIRMADA") return {
    ...base, rule: "AUTO-R002", priority: "HIGH", action: "REDUCE_LOAD", title: `Recalibrar próxima sessão de ${athleteName}`,
    rationale: evolution?.classification === "INVOLUCAO_CONFIRMADA" ? "A tendência comparável indica involução confirmada; reduzir estímulo antes de progredir." : "Recuperação, sono ou progressão semanal ultrapassaram o guardrail conservador.",
    triggers: [`Readiness ${readiness ?? "sem dado"}/100`, `Sono ${sleep ?? "sem dado"} h`, `Variação semanal ${(volumeDelta * 100).toFixed(1)}%`], loadFactor: 0.85, suggestedZone: "A2",
  };
  if ((attendance ?? 100) < 85) return {
    ...base, rule: "AUTO-R003", priority: "MEDIUM", action: "ATTENDANCE_REVIEW", title: `Rever aderência de ${athleteName}`,
    rationale: "A presença ficou abaixo do mínimo operacional e pode invalidar a progressão planejada.", triggers: [`Presença ${attendance}%`], loadFactor: 1, requiresCoachApproval: false,
  };
  if (evolution?.classification === "EVOLUCAO_CONFIRMADA" && (readiness ?? 0) >= 75 && volumeDelta < 0.1) return {
    ...base, rule: "AUTO-R004", priority: "OPPORTUNITY", action: "PROGRESS_LOAD", title: `Progressão disponível para ${athleteName}`,
    rationale: "Melhora comparável confirmada com prontidão adequada permite progressão conservadora.",
    triggers: [`Evolução ${evolution.deltaPct ?? "confirmada"}%`, `Readiness ${readiness}/100`], loadFactor: 1.05,
  };
  if (volumeDelta < -0.2) return {
    ...base, rule: "AUTO-R005", priority: "MEDIUM", action: "RECOVERY_REVIEW", title: `Explicar queda de volume de ${athleteName}`,
    rationale: "O volume semanal caiu mais de 20%; confirmar se é recuperação planejada, ausência ou problema de execução.",
    triggers: [`Variação semanal ${(volumeDelta * 100).toFixed(1)}%`], loadFactor: 1, requiresCoachApproval: false,
  };
  return {
    ...base, rule: "AUTO-R006", priority: "MEDIUM", action: "MAINTAIN", title: `Manter progressão de ${athleteName}`,
    rationale: "Carga, aderência e prontidão permanecem dentro dos guardrails atuais.",
    triggers: [`Readiness ${readiness ?? "sem dado"}/100`, `Variação semanal ${(volumeDelta * 100).toFixed(1)}%`], loadFactor: 1, requiresCoachApproval: false,
  };
}

function fingerprint(candidate: Candidate) {
  return createHash("sha256").update(JSON.stringify({ rule: candidate.rule, athleteId: candidate.athleteId, action: candidate.action, triggers: candidate.triggers, factor: candidate.loadFactor, zone: candidate.suggestedZone })).digest("hex");
}

export function recomputeCoachAutomation(store: ManagedStore, organizationId: string, cause = "manual") {
  if (activeRuns.has(organizationId)) return automationSnapshot(store, organizationId);
  activeRuns.add(organizationId);
  try {
    const athletes = store.list("athletes").filter((item) => item.organizationId === organizationId && String(item.status ?? "active") === "active");
    const candidates = athletes.map((athlete) => candidateFor(store, athlete, organizationId));
    for (const candidate of candidates) {
      const signature = fingerprint(candidate);
      const athleteDecisions = store.list("adaptationDecisions").filter((item) => item.organizationId === organizationId && item.automation === true && item.athleteId === candidate.athleteId);
      const latest = athleteDecisions[0];
      const current = athleteDecisions.find((item) => item.status === "PROPOSED");
      const previous = athleteDecisions[1];
      const duplicateOfResolved = latest?.status === "PROPOSED" && latest.signature === signature && previous?.signature === signature && ["APPROVED", "DISMISSED"].includes(String(previous.status));
      if (duplicateOfResolved) {
        store.update("adaptationDecisions", latest.id, { status: "SUPERSEDED", supersededAt: new Date().toISOString(), supersededReason: "DUPLICATE_AFTER_RESOLUTION", supersededByDecisionId: previous.id });
      } else if (latest?.signature !== signature) {
        if (current) store.update("adaptationDecisions", current.id, { status: "SUPERSEDED", supersededAt: new Date().toISOString(), supersededBySignature: signature });
        store.create("adaptationDecisions", { ...candidate, title: candidate.title, status: "PROPOSED", automation: true, engineVersion: ENGINE_VERSION, signature, cause, organizationId, generatedAt: new Date().toISOString() });
      }
      const athlete = store.get("athletes", candidate.athleteId);
      const state = candidate.priority === "CRITICAL" ? "RISK" : candidate.priority === "HIGH" ? "ATTENTION" : candidate.priority === "OPPORTUNITY" ? "PROGRESS" : "STABLE";
      if (athlete && (athlete.automationState !== state || athlete.recommendedLoadFactor !== candidate.loadFactor || athlete.nextBestAction !== candidate.title)) {
        store.update("athletes", athlete.id, { automationState: state, recommendedLoadFactor: candidate.loadFactor, nextBestAction: candidate.title, automationEngineVersion: ENGINE_VERSION, automationUpdatedAt: new Date().toISOString() });
      }
    }
    const runId = `automation-run-${Date.now().toString(36)}`;
    store.create("governance", { id: runId, title: "Recomputação automática do programa", status: "completed", automationRun: true, cause, engineVersion: ENGINE_VERSION, athletesEvaluated: athletes.length, proposalsActive: candidates.length, organizationId });
    return automationSnapshot(store, organizationId);
  } finally { activeRuns.delete(organizationId); }
}

export function automationSnapshot(store: ManagedStore, organizationId: string) {
  const proposals = store.list("adaptationDecisions").filter((item) => item.organizationId === organizationId && item.automation === true && item.status === "PROPOSED");
  const latestRun = store.list("governance").find((item) => item.organizationId === organizationId && item.automationRun === true);
  const counts = { critical: 0, high: 0, medium: 0, opportunity: 0, requiringApproval: 0 };
  for (const item of proposals) {
    const key = String(item.priority ?? "MEDIUM").toLowerCase() as "critical" | "high" | "medium" | "opportunity";
    counts[key] += 1;
    if (item.requiresCoachApproval) counts.requiringApproval += 1;
  }
  return { engineVersion: ENGINE_VERSION, generatedAt: new Date().toISOString(), latestRun, counts, proposals };
}

async function requireCoach(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSession(sessionToken(request));
  if (!roleAllows(user, ["coach", "admin"])) { void reply.code(user ? 403 : 401).send({ error: user ? "Ação exclusiva da comissão técnica" : "Autenticação necessária" }); return undefined; }
  return user;
}

export function registerCoachAutomationRoutes(app: FastifyInstance, store: ManagedStore) {
  const recomputeFromEvent = (event: StoreEvent) => {
    if (!WATCHED_RESOURCES.has(event.resource) || event.resource === "adaptationDecisions") return;
    recomputeCoachAutomation(store, event.organizationId, `${event.resource}:${event.action}`);
  };
  const unsubscribe = store.subscribe(recomputeFromEvent);
  app.addHook("onClose", async () => { unsubscribe(); });
  recomputeCoachAutomation(store, "org-demo", "bootstrap");

  app.get("/api/v1/coach/automation", async (request, reply) => {
    const user = await requireCoach(request, reply); if (!user) return;
    return automationSnapshot(store, user.organizationId);
  });
  app.post("/api/v1/coach/automation/recompute", async (request, reply) => {
    const user = await requireCoach(request, reply); if (!user) return;
    return recomputeCoachAutomation(store, user.organizationId, "coach-request");
  });
  app.post("/api/v1/coach/automation/proposals/:id/approve", async (request, reply) => {
    const user = await requireCoach(request, reply); if (!user) return;
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const proposal = store.get("adaptationDecisions", id);
    if (!proposal || proposal.organizationId !== user.organizationId || proposal.automation !== true || proposal.status !== "PROPOSED") return reply.code(404).send({ error: "Proposta ativa não encontrada" });
    let draft: ManagedRecord | undefined;
    if (proposal.requiresCoachApproval && ["BLOCK_INTENSITY", "REDUCE_LOAD", "PROGRESS_LOAD"].includes(String(proposal.action))) {
      const published = store.list("workouts").filter((item) => item.organizationId === user.organizationId && String(item.status) === "published");
      const base = published.filter((item) => String(item.date ?? "") >= today()).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] ?? published[0];
      const baseDistance = number(base?.distanceMeters) ?? 0;
      draft = store.create("workouts", {
        title: `Ajuste individual · ${String(proposal.athleteName)}`,
        status: "draft", source: "coach-automation", parentWorkoutId: base?.id, athleteId: proposal.athleteId,
        date: String(base?.date ?? "") >= today() ? base?.date : today(), distanceMeters: round10(baseDistance * Number(proposal.loadFactor ?? 1)),
        zone: proposal.suggestedZone ?? base?.zone, objective: proposal.rationale, automationProposalId: proposal.id,
        version: 1, requiresPublication: true, organizationId: user.organizationId, actorId: user.id,
      });
    }
    const approved = store.update("adaptationDecisions", id, { status: "APPROVED", approvedAt: new Date().toISOString(), approvedBy: user.id, appliedDraftId: draft?.id });
    return reply.send({ proposal: approved, draft, message: draft ? "Ajuste convertido em rascunho individual. Revise e publique quando estiver pronto." : "Decisão registrada e removida da fila ativa." });
  });
  app.post("/api/v1/coach/automation/proposals/:id/dismiss", async (request, reply) => {
    const user = await requireCoach(request, reply); if (!user) return;
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().trim().min(3).max(1000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Informe o motivo para preservar a decisão técnica" });
    const proposal = store.get("adaptationDecisions", id);
    if (!proposal || proposal.organizationId !== user.organizationId || proposal.status !== "PROPOSED") return reply.code(404).send({ error: "Proposta ativa não encontrada" });
    return reply.send(store.update("adaptationDecisions", id, { status: "DISMISSED", dismissedAt: new Date().toISOString(), dismissedBy: user.id, dismissalReason: body.data.reason }));
  });
}
