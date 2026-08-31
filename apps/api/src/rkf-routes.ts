import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseDelimited, resourceKinds, type ManagedStore } from "./managed-store.js";
import { athleteMayAccess, getSession, roleAllows, sessionToken } from "./auth.js";
import { loadRkfLibrary } from "./rkf-library.js";
import { assessEvolutionSet, comparableKeyFor, type EvolutionSessionInput } from "./rkf-evolution.js";
import { parseTrainingText } from "./rkf-parser.js";
import { DOCUMENT_UPLOAD_EXTENSIONS, extractDocument, signatureMatches } from "./document-extraction.js";
import { openapi } from "./openapi.js";
import { evaluateRkfReleaseGates } from "./rkf-release-gates.js";
import { DOMAIN_EVENT_CONTRACTS, DOMAIN_EVENT_CATALOG_VERSION } from "./domain-events.js";
import { applyIngestionSeeds, INGESTION_CONTRACTS, INGESTION_SEEDS, INGESTION_SEED_VERSION, PRODUCT_PLANS, plansForRole, type IngestionSeedExecution } from "./rkf-ingestion-seeds.js";
import { UI_CONTRACTS, UI_SEEDS, UI_CONTRACT_VERSION, uiSeedStateCoverage } from "./rkf-ui-contracts.js";
import {
  AGE_BANDS, buildLoadAlerts, classifyEvolution, coldStartFor, computeChronicSeries,
  computeLoadLayers, computeMonotony, computeResponseIndex, decideAdaptation, DISTRIBUTION_MATRICES,
  generateCycle, generatePrescription, MATERIALS, PHASES, RULES_RKF, SESSION_COMPONENTS, SKILLS,
  VALID_PROGRESSIONS, ZONES,
  assessDistanceFatigue, classifyLearningHistory, recoveryForPhase, PHASE_RECOVERY_MATRIX, FATIGUE_ENGINE_VERSION,
  type SkillCode,
} from "@natacao/domain";

const zoneEnum = z.enum(["VALAT", "A1", "A2", "A3", "AN1", "AN2"]);
const phaseEnum = z.enum(["ADAPTACAO", "BASE", "DESENVOLVIMENTO", "ESPECIFICO", "ACUMULACAO", "TRANSFORMACAO", "REALIZACAO", "TAPER", "COMPETICAO"]);

const ingestionChannel = z.enum(["TEXT", "PHOTO", "FILE", "VOICE", "API", "RULE"]);
const ingestionState = z.enum(["RECEIVED", "STORED", "EXTRACTED", "PARSED", "REVIEW", "CONFIRMED", "ASSIGNED", "PLANNED_COMMITTED", "EXECUTED_CONFIRMED", "LOAD_COMMITTED", "ANALYTICS_READY"]);
const ingestionNext: Record<z.infer<typeof ingestionState>, z.infer<typeof ingestionState> | null> = {
  RECEIVED: "STORED", STORED: "EXTRACTED", EXTRACTED: "PARSED", PARSED: "REVIEW", REVIEW: "CONFIRMED",
  CONFIRMED: "ASSIGNED", ASSIGNED: "PLANNED_COMMITTED", PLANNED_COMMITTED: "EXECUTED_CONFIRMED",
  EXECUTED_CONFIRMED: "LOAD_COMMITTED", LOAD_COMMITTED: "ANALYTICS_READY", ANALYTICS_READY: null,
};
const seedRoot = fileURLToPath(new URL("../../../data/rkf/RKF_V5_1/", import.meta.url));
const seedFiles = ["sessions.csv", "blocks.csv", "prescription_units.csv", "normalization_audit.csv", "block_summary.csv", "zones.csv", "materials.csv", "skills.csv", "rules_rkf.csv", "exercises.csv"] as const;

function seedStagingStatus() {
  const manifestPath = `${seedRoot}manifest.json`;
  if (!existsSync(manifestPath)) return { located: false, staged: false, status: "NOT_FOUND", files: [], errors: ["Pacote RKF V5.1 não localizado no projeto."] };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string; sessions: number; blocks: number; prescription_units: number; status: string };
  const files = seedFiles.map((name) => {
    const path = `${seedRoot}${name}`;
    const buffer = readFileSync(path);
    return { name, sizeBytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), rows: buffer.toString("utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).length - 1 };
  });
  const sessions = files.find((file) => file.name === "sessions.csv")?.rows ?? 0;
  const blocks = files.find((file) => file.name === "blocks.csv")?.rows ?? 0;
  const errors = [sessions !== manifest.sessions ? `sessions.csv possui ${sessions} linhas, manifesto exige ${manifest.sessions}.` : "", blocks !== manifest.blocks ? `blocks.csv possui ${blocks} linhas, manifesto exige ${manifest.blocks}.` : ""].filter(Boolean);
  return { located: true, staged: errors.length === 0, status: errors.length ? "REVIEW" : "STAGING_READY", manifest, files, errors, packageHash: createHash("sha256").update(files.map((file) => `${file.name}:${file.sha256}`).join("|")).digest("hex") };
}

async function requireCoach(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSession(sessionToken(request));
  if (!user) { void reply.code(401).send({ error: "Autenticação necessária" }); return undefined; }
  if (!roleAllows(user, ["coach", "admin"])) { void reply.code(403).send({ error: "Ação exclusiva da comissão técnica" }); return undefined; }
  return user;
}

async function requireAuthenticated(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSession(sessionToken(request));
  if (!user) { void reply.code(401).send({ error: "Autenticação necessária" }); return undefined; }
  return user;
}

function validationSessions() {
  const start = Date.UTC(2026, 6, 16);
  return Array.from({ length: 44 }, (_, index) => ({
    athleteId: "ana-souza",
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    pse: [4, 5, 6, 5, 7, 4, 3][index % 7],
    durationMinutes: [70, 80, 90, 75, 95, 65, 55][index % 7],
    prescribedVolumeM: [4200, 4800, 5200, 4600, 5800, 3600, 3000][index % 7],
    executedVolumeM: [4100, 4750, 5080, 4520, 5600, 3500, 2980][index % 7],
    expectedPse: [4, 5, 6, 5, 6, 4, 3][index % 7],
  }));
}

type E2eEvidenceShape = {
  screensPassed: number;
  screensTotal: number;
  navigationPassed: boolean;
  contractsPassed: boolean;
  seedsPassed: boolean;
  desktop: boolean;
  mobile: boolean;
};

function latestE2eEvidence(store: ManagedStore | undefined, organizationId: string): E2eEvidenceShape | null {
  const evidences = (store?.list("governance") ?? [])
    .filter((item) => item.organizationId === organizationId && item.e2eEvidence)
    .map((item) => item.e2eEvidence as unknown as E2eEvidenceShape & { recordedAt: string });
  if (!evidences.length) return null;
  evidences.sort((a, b) => String(b.recordedAt ?? "").localeCompare(String(a.recordedAt ?? "")));
  return evidences[0];
}

export function registerRkfRoutes(app: FastifyInstance, store?: ManagedStore) {
  app.get("/api/v1/rkf/bootstrap", async (request) => {
    const viewer = await getSession(sessionToken(request));
    const staging = seedStagingStatus();
    const governance = store?.get("governance", "rkf-v5-1");
    const imported = Boolean(governance?.seedImported && governance.packageHash === ("packageHash" in staging ? staging.packageHash : undefined));
    const liveSessions = (store?.list("activities") ?? []).filter((item) => item.type === "rkf-load-session" && item.organizationId === (viewer?.organizationId ?? "org-demo")).flatMap((item) => {
      const pse = Number(item.pse); const durationMinutes = Number(item.durationMinutes); const date = String(item.date ?? "");
      return Number.isFinite(pse) && Number.isFinite(durationMinutes) && /^\d{4}-\d{2}-\d{2}$/.test(date) ? [{ athleteId: String(item.athleteId ?? "ana-souza"), date, pse, durationMinutes, prescribedVolumeM: Number(item.prescribedVolumeM) || undefined, executedVolumeM: Number(item.executedVolumeM) || undefined, expectedPse: Number(item.expectedPse) || undefined }] : [];
    });
    const sessions = [...validationSessions(), ...liveSessions];
    const layers = computeLoadLayers([sessions.at(-1)!], new Date("2026-08-28T12:00:00.000Z"));
    const chronic = computeChronicSeries(sessions, "ana-souza");
    const dailyLoads = sessions.slice(-7).map((session) => session.pse * session.durationMinutes);
    const monotony = computeMonotony(dailyLoads);
    const latest = chronic.points.at(-1)!;
    const organizationId = viewer?.organizationId ?? "org-demo";
    const ingestions = (store?.list("ingestions") ?? []).filter((item) => item.organizationId === organizationId);
    const release = evaluateRkfReleaseGates({
      seed: {
        located: staging.located,
        staged: staging.staged,
        imported,
        sessions: "manifest" in staging ? Number(staging.manifest?.sessions ?? 0) : 0,
        blocks: "manifest" in staging ? Number(staging.manifest?.blocks ?? 0) : 0,
        prescriptionUnits: "manifest" in staging ? Number(staging.manifest?.prescription_units ?? 0) : 0,
        files: staging.files.length,
      },
      apiContractCount: Object.keys(openapi.paths).length,
      entityCount: resourceKinds.length,
      migrationCount: await (store?.migrationStatus().then((status) => status.applied.length).catch(() => 0) ?? 0),
      eventContractCount: DOMAIN_EVENT_CONTRACTS.length,
      resultCount: (store?.list("results") ?? []).filter((item) => item.organizationId === organizationId).length,
      loadSnapshotCount: (store?.list("loadSnapshots") ?? []).filter((item) => item.organizationId === organizationId).length,
      postTrainingSeedCount: validationSessions().length,
      fatigueSeedCount: (store?.list("loadSnapshots") ?? []).filter((item) => item.organizationId === organizationId && item.fatigueContext).length + (store?.list("adaptationDecisions") ?? []).filter((item) => item.organizationId === organizationId && item.fatigueContext).length,
      ingestionSeedCount: (store?.list("ingestions") ?? []).filter((item) => item.organizationId === organizationId && item.seedVersion === INGESTION_SEED_VERSION).length,
      ingestionContractCount: INGESTION_CONTRACTS.length,
      planContractCount: PRODUCT_PLANS.length,
      uiContractCount: UI_CONTRACTS.length,
      uiSeedCount: UI_SEEDS.length,
      e2eEvidence: latestE2eEvidence(store, organizationId),
      confirmedIngestionCount: ingestions.filter((item) => item.state === "CONFIRMED").length,
      ingestionChannelsObserved: ingestions.map((item) => String(item.channel ?? "")),
      auditableOriginalFormatsObserved: [...new Set(ingestions.map((item) => extname(String(item.sourceName ?? "")).slice(1).toLowerCase()).filter(Boolean))],
      assignmentTargetTypesObserved: (store?.list("prescriptions") ?? []).filter((item) => item.organizationId === organizationId).map((item) => String(item.targetType ?? "")),
    });
    return {
      program: { name: "RKF Coach", version: "RKF_V5.1", mode: "VALIDATION", locale: "pt-BR", poolLengthM: 50 },
      scope: { athletes: 50, entitlements: ["LOAD_ATHLETE", "LOAD_TEAM", "FULL_ATHLETE", "FULL_TEAM"] },
      athlete: { id: "ana-souza", name: "Ana Souza", age: 16, specialty: "meio_fundo", readiness: 82 },
      load: { layers, latest, monotony, convention: chronic.convention, alerts: buildLoadAlerts({ sessions: sessions.slice(-7), monotony }) },
      adaptation: decideAdaptation({ readiness: 82, prescribedVolumeM: 5800, primaryZone: "A2", guardrails: { readiness: 82, pain: 1, sleepMinutes: 470, hrvRatioToBaseline: 1.02, actualPse: 6, targetPse: 6, technique: 4 } }),
      response: computeResponseIndex({ readiness: 82, sleepMinutes: 470, hrv: 72, hrvBaseline: 70, pain: 1, technique: 4, techniqueTarget: 4, adherence: 0.97, qualityScore: 4.3 }),
      ingestion: { pendingReview: store?.list("ingestions").filter((item) => item.organizationId === (viewer?.organizationId ?? "org-demo") && item.state === "REVIEW").length ?? 0, total: store?.list("ingestions").filter((item) => item.organizationId === (viewer?.organizationId ?? "org-demo")).length ?? 0 },
      prescriptions: { pendingApproval: store?.list("prescriptions").filter((item) => item.organizationId === (viewer?.organizationId ?? "org-demo") && item.status === "PENDING_APPROVAL").length ?? 0, published: store?.list("prescriptions").filter((item) => item.organizationId === (viewer?.organizationId ?? "org-demo") && item.status === "PUBLISHED").length ?? 0 },
      seed: { expectedSessions: 910, expectedBlocks: 6226, packageLocated: staging.located, staged: staging.staged, imported, status: imported ? "IMPORTED" : staging.staged ? "STAGING_READY" : "BLOCKED", packageHash: "packageHash" in staging ? staging.packageHash : null, reason: imported ? `Seed importada por transação ${String(governance?.seedImportId ?? "registrada")}, com ${Number(governance?.seedImportedRows ?? 0).toLocaleString("pt-BR")} linhas preservadas.` : staging.staged ? "Pacote canônico localizado e conferido em staging. Pronto para importação transacional." : staging.errors.join(" ") },
      featureFlags: { voiceIngestion: true, deviceCommands: false, wearableRead: true },
      release: { decision: release.decision, summary: release.summary, evaluatedAtUtc: release.evaluatedAtUtc },
      gates: release.gates,
      provenance: { type: "SYNTHETIC_VALIDATION", label: "Dados sintéticos de validação. Não representam resultados oficiais." },
    };
  });

  app.get("/api/v1/rkf/release-gates", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    const staging = seedStagingStatus();
    const governance = store?.get("governance", "rkf-v5-1");
    const imported = Boolean(governance?.seedImported && governance.packageHash === ("packageHash" in staging ? staging.packageHash : undefined));
    const ingestions = (store?.list("ingestions") ?? []).filter((item) => item.organizationId === coach.organizationId);
    return evaluateRkfReleaseGates({
      seed: {
        located: staging.located,
        staged: staging.staged,
        imported,
        sessions: "manifest" in staging ? Number(staging.manifest?.sessions ?? 0) : 0,
        blocks: "manifest" in staging ? Number(staging.manifest?.blocks ?? 0) : 0,
        prescriptionUnits: "manifest" in staging ? Number(staging.manifest?.prescription_units ?? 0) : 0,
        files: staging.files.length,
      },
      apiContractCount: Object.keys(openapi.paths).length,
      entityCount: resourceKinds.length,
      migrationCount: await (store?.migrationStatus().then((status) => status.applied.length).catch(() => 0) ?? 0),
      eventContractCount: DOMAIN_EVENT_CONTRACTS.length,
      resultCount: (store?.list("results") ?? []).filter((item) => item.organizationId === coach.organizationId).length,
      loadSnapshotCount: (store?.list("loadSnapshots") ?? []).filter((item) => item.organizationId === coach.organizationId).length,
      postTrainingSeedCount: validationSessions().length,
      fatigueSeedCount: (store?.list("loadSnapshots") ?? []).filter((item) => item.organizationId === coach.organizationId && item.fatigueContext).length + (store?.list("adaptationDecisions") ?? []).filter((item) => item.organizationId === coach.organizationId && item.fatigueContext).length,
      ingestionSeedCount: (store?.list("ingestions") ?? []).filter((item) => item.organizationId === coach.organizationId && item.seedVersion === INGESTION_SEED_VERSION).length,
      ingestionContractCount: INGESTION_CONTRACTS.length,
      planContractCount: PRODUCT_PLANS.length,
      uiContractCount: UI_CONTRACTS.length,
      uiSeedCount: UI_SEEDS.length,
      e2eEvidence: latestE2eEvidence(store, coach.organizationId),
      confirmedIngestionCount: ingestions.filter((item) => item.state === "CONFIRMED").length,
      ingestionChannelsObserved: ingestions.map((item) => String(item.channel ?? "")),
      auditableOriginalFormatsObserved: [...new Set(ingestions.map((item) => extname(String(item.sourceName ?? "")).slice(1).toLowerCase()).filter(Boolean))],
      assignmentTargetTypesObserved: (store?.list("prescriptions") ?? []).filter((item) => item.organizationId === coach.organizationId).map((item) => String(item.targetType ?? "")),
    });
  });

  app.get("/api/v1/rkf/seed/status", async () => seedStagingStatus());

  app.get("/api/v1/rkf/migrations", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    const status = await store?.migrationStatus().catch(() => undefined);
    return { migrations: status ?? { applied: [], pending: [], total: 0 }, note: status ? undefined : "Driver PostgreSQL não conectado; migrations aplicam apenas em produção." };
  });

  app.get("/api/v1/rkf/events", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    return { catalogVersion: DOMAIN_EVENT_CATALOG_VERSION, total: DOMAIN_EVENT_CONTRACTS.length, events: DOMAIN_EVENT_CONTRACTS };
  });

  app.post("/api/v1/backup", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(403).send({ error: "Backup é exclusivo da comissão técnica" });
    try {
      const backup = await store?.createBackup();
      if (!backup) return reply.code(503).send({ error: "Backup requer o driver PostgreSQL" });
      return backup;
    } catch (error) {
      return reply.code(500).send({ error: "Falha ao criar backup", detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get("/api/v1/backup/:id/verify", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(403).send({ error: "Verificação é exclusiva da comissão técnica" });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    try {
      const verification = await store?.verifyBackup(id);
      if (!verification) return reply.code(503).send({ error: "Backup requer o driver PostgreSQL" });
      return verification;
    } catch (error) {
      return reply.code(500).send({ error: "Falha ao verificar backup", detail: error instanceof Error ? error.message : undefined });
    }
  });

  /** LGPD: exportação completa dos dados de um atleta da organização. */
  app.get("/api/v1/lgpd/athletes/:athleteId/export", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    if (!roleAllows(user, ["coach", "admin"]) && !athleteMayAccess(user, athleteId)) return reply.code(403).send({ error: "Acesso restrito aos próprios dados" });
    const organizationId = user.organizationId;
    const scoped = (items: Array<Record<string, unknown>> | undefined) => (items ?? []).filter((item) => (String(item.organizationId ?? "org-demo")) === organizationId);
    const athlete = scoped(store?.list("athletes"))?.find((item) => item.id === athleteId);
    if (!athlete) return reply.code(404).send({ error: "Atleta não encontrado nesta organização" });
    const relates = (items: Array<Record<string, unknown>> | undefined) => scoped(items)?.filter((item) => item.athleteId === athleteId) ?? [];
    const payload = {
      exportedAt: new Date().toISOString(),
      basis: "LGPD art. 18, II — portabilidade de dados",
      athlete,
      goals: relates(store?.list("goals")),
      videos: relates(store?.list("videos")),
      activities: relates(store?.list("activities")),
      ingestions: relates(store?.list("ingestions")),
      prescriptions: relates(store?.list("prescriptions")),
      results: relates(store?.list("results")),
      loadSnapshots: relates(store?.list("loadSnapshots")),
      adaptationDecisions: relates(store?.list("adaptationDecisions")),
      audit: scoped(store?.list("governance")),
    };
    return payload;
  });

  /** LGPD: anonimização do atleta — dados metodológicos são preservados, PII removida. */
  app.post("/api/v1/lgpd/athletes/:athleteId/anonymize", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    const body = z.object({ requestedBy: z.string().email(), lgpdBasis: z.enum(["CONSENTIMENTO", "CUMPRIMENTO_LEGAL", "DIREITOS_TITULAR"]) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Requisição de anonimização inválida", details: body.error.flatten() });
    const athlete = (store?.list("athletes") ?? []).find((item) => item.id === athleteId && item.organizationId === coach.organizationId);
    if (!athlete) return reply.code(404).send({ error: "Atleta não encontrado nesta organização" });
    const anonymized = store?.update("athletes", athleteId, {
      name: `Atleta anonimizado ${athleteId}`,
      email: undefined,
      handle: undefined,
      status: "anonymized",
      anonymizedAt: new Date().toISOString(),
      anonymizedBy: coach.id,
      lgpdBasis: body.data.lgpdBasis,
      lgpdRequestedBy: body.data.requestedBy,
    }, "update");
    return { ok: true, athlete: anonymized, note: "Carga, resultados e snapshots preservados sem PII; métricas permanecem auditáveis." };
  });

  app.post("/api/v1/rkf/seed/stage", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const staging = seedStagingStatus();
    if (!staging.staged) return reply.code(422).send({ error: "Falha na conferência do staging", details: staging.errors });
    const current = store.get("governance", "rkf-v5-1");
    const stagedAt = new Date().toISOString();
    const record = current
      ? store.update("governance", current.id, { status: "staged", stagedAt, stagedBy: coach.id, packageHash: staging.packageHash, manifest: staging.manifest, fileChecks: staging.files, seedImported: false })
      : store.create("governance", { id: "rkf-v5-1", name: "Homologação RKF V5.1", status: "staged", stagedAt, stagedBy: coach.id, packageHash: staging.packageHash, manifest: staging.manifest, fileChecks: staging.files, seedImported: false });
    return reply.send({ ok: true, staging, governance: record });
  });

  app.post("/api/v1/rkf/seed/import", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const staging = seedStagingStatus();
    if (!staging.staged || !("packageHash" in staging) || typeof staging.packageHash !== "string" || !("manifest" in staging) || !staging.manifest) return reply.code(422).send({ error: "Staging inválido", details: staging.errors });
    const packageHash = staging.packageHash;
    const manifest = staging.manifest;
    const files = seedFiles.map((name) => {
      const fileStatus = staging.files.find((file) => file.name === name)!;
      return { name, sha256: fileStatus.sha256, rows: parseDelimited(readFileSync(`${seedRoot}${name}`, "utf8")) };
    });
    const expected = new Map<string, number>([["sessions.csv", 910], ["blocks.csv", 6226], ["prescription_units.csv", 6226], ["zones.csv", 6], ["materials.csv", 11], ["skills.csv", 14], ["rules_rkf.csv", 18]]);
    const invalid = files.flatMap((file) => expected.has(file.name) && file.rows.length !== expected.get(file.name) ? [`${file.name}: ${file.rows.length}/${expected.get(file.name)}`] : []);
    if (invalid.length) return reply.code(422).send({ error: "Contagens da seed divergentes", details: invalid });
    const importId = `rkf-seed-${packageHash.slice(0, 20)}`;
    const result = await store.importRkfSeed({
      id: importId,
      version: String(manifest.version),
      packageHash,
      manifest: manifest as unknown as Record<string, unknown>,
      files,
      importedBy: coach.id,
      organizationId: coach.organizationId,
    });
    const importedAt = new Date().toISOString();
    const current = store.get("governance", "rkf-v5-1");
    const governance = current
      ? store.update("governance", current.id, { status: "imported", seedImported: true, seedImportId: result.importId, seedImportedRows: result.importedRows, seedImportDriver: result.driver, importedAt, importedBy: coach.id, packageHash })
      : store.create("governance", { id: "rkf-v5-1", name: "Homologação RKF V5.1", status: "imported", seedImported: true, seedImportId: result.importId, seedImportedRows: result.importedRows, seedImportDriver: result.driver, importedAt, importedBy: coach.id, packageHash, organizationId: coach.organizationId });
    await store.flush();
    return reply.code(201).send({ ok: true, ...result, governance });
  });

  app.get("/api/v1/rkf/results/athletes/:athleteId", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    const isOwn = athleteMayAccess(user, athleteId);
    if (!roleAllows(user, ["coach", "admin"]) && !isOwn) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    return { data: (store?.list("results") ?? []).filter((item) => item.athleteId === athleteId && item.organizationId === user.organizationId) };
  });

  app.post("/api/v1/rkf/results/sessions", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const splitSchema = z.object({ distanceM: z.number().positive(), timeSeconds: z.number().positive() });
    const repetitionSchema = z.object({ repetition: z.number().int().positive(), distanceM: z.number().positive(), timeSeconds: z.number().positive(), stroke: z.string().optional(), note: z.string().optional(), splits: z.array(splitSchema).default([]) });
    const setSchema = z.object({ set: z.number().int().positive(), label: z.string().min(1), zone: zoneEnum.optional(), repetitions: z.array(repetitionSchema).min(1) });
    const parsed = z.object({ athleteId: z.string().min(1), prescriptionId: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), event: z.string().min(1), poolLengthM: z.union([z.literal(25), z.literal(50)]), sessionDistanceM: z.number().positive(), capturedDistanceM: z.number().positive(), durationMinutes: z.number().positive(), pse: z.number().min(1).max(10), expectedPse: z.number().min(1).max(10).optional(), prescribedVolumeM: z.number().positive().optional(), sets: z.array(setSchema).min(1), notes: z.string().max(2000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Resultado pós-treino inválido", details: parsed.error.flatten() });
    const isOwn = athleteMayAccess(user, parsed.data.athleteId);
    if (!roleAllows(user, ["coach", "admin"]) && !isOwn) return reply.code(403).send({ error: "Atleta só pode registrar o próprio resultado" });
    const repetitions = parsed.data.sets.flatMap((set) => set.repetitions);
    const bestTimeSeconds = Math.min(...repetitions.map((repetition) => repetition.timeSeconds));
    const averageTimeSeconds = Math.round((repetitions.reduce((sum, repetition) => sum + repetition.timeSeconds, 0) / repetitions.length) * 100) / 100;
    const normalized = { ...parsed.data, bestTimeSeconds, averageTimeSeconds, comparableKey: `${parsed.data.event}|${parsed.data.poolLengthM}|${repetitions[0].distanceM}|${parsed.data.sets[0].zone ?? "UNSPECIFIED"}` };
    const snapshotHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const result = store.create("results", { title: `${parsed.data.event} · ${parsed.data.date}`, ...normalized, status: "CONFIRMED", immutable: true, snapshotHash, source: user.role === "athlete" ? "ATHLETE_CONFIRMED" : "COACH_CONFIRMED", actorId: user.id, organizationId: user.organizationId });
    const load = computeLoadLayers([{ athleteId: parsed.data.athleteId, date: parsed.data.date, pse: parsed.data.pse, durationMinutes: parsed.data.durationMinutes, prescribedVolumeM: parsed.data.prescribedVolumeM, executedVolumeM: parsed.data.sessionDistanceM, expectedPse: parsed.data.expectedPse }]);
    const loadSnapshot = store.create("loadSnapshots", { title: `Carga · ${parsed.data.event} · ${parsed.data.date}`, athleteId: parsed.data.athleteId, resultId: result.id, status: "COMMITTED", immutable: true, engine: load.engine, engineVersion: load.engineVersion, layers: load.layers, adherence: load.adherence, actorId: user.id, organizationId: user.organizationId });
    return reply.code(201).send({ result, loadSnapshot });
  });

  app.get("/api/v1/rkf/ingestions", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    return { data: (store?.list("ingestions") ?? []).filter((item) => item.organizationId === coach.organizationId) };
  });

  app.post("/api/v1/rkf/ingestions", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });

    let channel: string;
    let title: string;
    let original: string;
    let sourceName: string | undefined;
    let confidenceOverride: number | undefined;
    let originalContentHash: string | undefined;
    let parsedData: Record<string, unknown> = {};
    let extraction: Awaited<ReturnType<typeof extractDocument>> | undefined;
    const pipelineStates = ["RECEIVED", "STORED"];

    const contentType = String(request.headers["content-type"] ?? "");
    if (contentType.includes("multipart/form-data")) {
      // Canais PHOTO/FILE/VOICE: arquivo original + hash + extração automática.
      // O buffer é lido dentro do próprio loop de partes: chamar toBuffer()
      // depois de esgotar o iterator trava o stream no light-my-request.
      const fields: Record<string, string> = {};
      let fileBuffer: Buffer | undefined;
      let fileFilename = "arquivo";
      let fileMimetype = "application/octet-stream";
      for await (const part of request.parts()) {
        if (part.type === "file") {
          fileBuffer = await part.toBuffer();
          fileFilename = part.filename || fileFilename;
          fileMimetype = part.mimetype || fileMimetype;
        } else if (part.type === "field") {
          fields[String(part.fieldname)] = String(part.value);
        }
      }
      if (!fileBuffer) return reply.code(400).send({ error: "Envie o arquivo do treino (foto, documento ou áudio)" });
      const file = { filename: fileFilename, mimetype: fileMimetype };
      channel = fields.channel ?? "FILE";
      title = fields.title ?? fileFilename.replace(/\.[^.]+$/, "");
      sourceName = fileFilename;
      confidenceOverride = fields.confidence !== undefined ? Number(fields.confidence) : undefined;
      if (fields.parsedData) {
        try { parsedData = JSON.parse(fields.parsedData) as Record<string, unknown>; } catch { return reply.code(400).send({ error: "parsedData deve ser JSON válido" }); }
      }
      if (!["PHOTO", "FILE", "VOICE"].includes(channel)) return reply.code(400).send({ error: "Upload multipart exige canal PHOTO, FILE ou VOICE" });
      const buffer = fileBuffer;
      if (buffer.length > 25 * 1024 * 1024) return reply.code(413).send({ error: "Arquivo deve ter no máximo 25 MB" });
      const extension = extname(fileFilename).toLowerCase();
      if (!DOCUMENT_UPLOAD_EXTENSIONS.includes(extension as (typeof DOCUMENT_UPLOAD_EXTENSIONS)[number])) return reply.code(415).send({ error: `Formato ${extension || "desconhecido"} não permitido para ingestão documental` });
      if (!signatureMatches(buffer, extension)) return reply.code(415).send({ error: "O conteúdo do arquivo não corresponde à extensão informada" });
      originalContentHash = createHash("sha256").update(buffer).digest("hex");
      original = `arquivo:${fileFilename}:${buffer.length} bytes`;
      void file;
      if (channel !== "VOICE") {
        extraction = await extractDocument(buffer, fileFilename);
        pipelineStates.push("EXTRACTED");
        if (extraction.text) {
          const parsed = parseTrainingText(extraction.text);
          parsedData = { ...parsedData, ...parsed, kind: "training_session", extractionStatus: extraction.status };
          if (!confidenceOverride) confidenceOverride = parsed.confidence;
        } else {
          parsedData = { ...parsedData, kind: "training_session", extractionStatus: extraction.status };
          confidenceOverride ??= 0.3;
        }
      } else {
        // Voz: transcrição chega como texto ou permanece pendente de STT (feature flag).
        parsedData = { ...parsedData, kind: "training_session", sttStatus: "PENDING" };
        confidenceOverride ??= 0.2;
      }
      pipelineStates.push("PARSED");
    } else {
      const parsed = z.object({
        channel: ingestionChannel,
        title: z.string().min(2),
        original: z.string().min(1),
        sourceName: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        parsedData: z.record(z.unknown()).default({}),
      }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Ingestão inválida", details: parsed.error.flatten() });
      channel = parsed.data.channel;
      title = parsed.data.title;
      original = parsed.data.original;
      sourceName = parsed.data.sourceName;
      confidenceOverride = parsed.data.confidence;
      parsedData = parsed.data.parsedData;
      // Canal TEXT extrai automaticamente com o parser RKF quando não há parsedData.
      if (channel === "TEXT" && Object.keys(parsedData).length === 0) {
        const training = parseTrainingText(original);
        parsedData = { ...training, kind: "training_session" };
        if (!confidenceOverride) confidenceOverride = training.confidence;
        pipelineStates.push("EXTRACTED", "PARSED");
      }
    }

    const confidence = confidenceOverride ?? Math.min(0.96, 0.62 + original.length / 500);
    const record = store.create("ingestions", {
      title,
      channel,
      sourceName: sourceName ?? "entrada-direta",
      original,
      originalHash: originalContentHash ?? createHash("sha256").update(original).digest("hex"),
      parsedData,
      confidence: Math.round(Math.min(Math.max(confidence, 0), 1) * 100) / 100,
      requiresHumanReview: confidence < 0.85,
      state: "REVIEW",
      version: 1,
      pipeline: [...pipelineStates, "REVIEW"],
      extractionStatus: extraction?.status,
      extraction,
      status: "review",
      organizationId: coach.organizationId,
      actorId: coach.id,
    }, "import");
    return reply.code(201).send(record);
  });

  app.patch("/api/v1/rkf/ingestions/:id", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const current = store.get("ingestions", id);
    if (!current || current.organizationId !== coach.organizationId) return reply.code(404).send({ error: "Ingestão não encontrada" });
    if (current.state === "CONFIRMED") return reply.code(409).send({ error: "Registro confirmado é imutável. Crie uma nova versão." });
    const body = z.object({ parsedData: z.record(z.unknown()), note: z.string().max(1000).optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Correção inválida", details: body.error.flatten() });
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshot } = current;
    const revised = store.create("ingestions", { ...snapshot, parsedData: body.data.parsedData, correctionNote: body.data.note, version: Number(current.version ?? 1) + 1, previousVersionId: id, rootVersionId: current.rootVersionId ?? id, state: "REVIEW", status: "review", actorId: coach.id, organizationId: coach.organizationId });
    store.update("ingestions", id, { status: "superseded", supersededBy: revised.id, immutable: true });
    return reply.send(revised);
  });

  app.post("/api/v1/rkf/ingestions/:id/confirm", async (request, reply) => {
    const reviewer = await requireCoach(request, reply);
    if (!reviewer) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const current = store.get("ingestions", id);
    if (!current || current.organizationId !== reviewer.organizationId) return reply.code(404).send({ error: "Ingestão não encontrada" });
    const data = current.parsedData as Record<string, unknown> | undefined;
    const missing = ["athleteId", "date", "kind"].filter((field) => !data?.[field]);
    if (missing.length) return reply.code(422).send({ error: "Campos críticos incompletos", missing });
    return reply.send(store.update("ingestions", id, { state: "CONFIRMED", status: "confirmed", reviewerId: reviewer.id, reviewerRole: reviewer.role, confirmedAt: new Date().toISOString(), pipeline: [...(Array.isArray(current.pipeline) ? current.pipeline : []), "CONFIRMED"] }));
  });

  app.post("/api/v1/rkf/ingestions/:id/transition", async (request, reply) => {
    const actor = await requireCoach(request, reply);
    if (!actor) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ nextState: ingestionState, note: z.string().max(1000).optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Transição inválida", details: body.error.flatten() });
    const current = store.get("ingestions", id);
    if (!current || current.organizationId !== actor.organizationId) return reply.code(404).send({ error: "Ingestão não encontrada" });
    const currentState = ingestionState.safeParse(current.state);
    if (!currentState.success || ingestionNext[currentState.data] !== body.data.nextState) return reply.code(409).send({ error: `Transição ${String(current.state)} â†’ ${body.data.nextState} não permitida` });
    if (currentState.data === "REVIEW") return reply.code(409).send({ error: "Use a confirmação humana para sair de REVIEW" });
    const pipeline = [...(Array.isArray(current.pipeline) ? current.pipeline : []), body.data.nextState];
    return reply.send(store.update("ingestions", id, { state: body.data.nextState, status: body.data.nextState.toLowerCase(), pipeline, lastTransitionAt: new Date().toISOString(), lastTransitionBy: actor.id, transitionNote: body.data.note }));
  });

  app.get("/api/v1/rkf/prescriptions", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    return { data: (store?.list("prescriptions") ?? []).filter((item) => item.organizationId === coach.organizationId) };
  });

  app.post("/api/v1/rkf/prescriptions", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const body = z.object({ prescription: z.record(z.unknown()), audit: z.record(z.unknown()), athleteId: z.string(), title: z.string().min(2), targetType: z.enum(["team", "group", "athlete"]).optional(), targetId: z.string().optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Prescrição inválida", details: body.error.flatten() });
    return reply.code(201).send(store.create("prescriptions", { ...body.data, status: "PENDING_APPROVAL", immutable: false, version: 1, organizationId: coach.organizationId, actorId: coach.id }));
  });

  app.post("/api/v1/rkf/prescriptions/:id/approve", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const current = store.get("prescriptions", id);
    if (!current || current.organizationId !== coach.organizationId) return reply.code(404).send({ error: "Prescrição não encontrada" });
    if (current.status === "PUBLISHED") return reply.send(current);
    const audit = current.audit as { passed?: boolean } | undefined;
    if (!audit?.passed) return reply.code(422).send({ error: "A auditoria obrigatória não foi aprovada" });
    return reply.send(store.update("prescriptions", id, { status: "PUBLISHED", immutable: true, approvedBy: coach.id, approvedByRole: coach.role, approvedAt: new Date().toISOString(), publishedSnapshot: current.prescription }));
  });
  app.get("/api/v1/rkf/dictionaries", async () => ({
    seedVersion: "RKF_V5.1",
    zones: ZONES,
    materials: MATERIALS,
    skills: SKILLS,
    rules: RULES_RKF,
    phases: PHASES,
    ageBands: AGE_BANDS,
    components: SESSION_COMPONENTS,
    progressions: VALID_PROGRESSIONS,
    distribution: DISTRIBUTION_MATRICES,
  }));

  app.post("/api/v1/rkf/cycles/generate", async (request, reply) => {
    const schema = z.object({
      age: z.number().int().min(8).max(120),
      totalWeeks: z.number().int().min(4).max(52),
      sessionsPerWeek: z.number().int().min(2).max(10),
      currentVolumeM: z.number().positive(),
      maxVolumeM: z.number().positive(),
      readiness: z.number().min(0).max(100).optional(),
      model: z.enum(["AUTO", "LINEAR_RKF", "ATR_RKF"]).default("AUTO"),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Requisição de ciclo inválida", details: parsed.error.flatten() });
    try {
      return reply.code(201).send(generateCycle(parsed.data));
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : "Ciclo inválido" });
    }
  });

  app.post("/api/v1/rkf/sessions/compose", async (request, reply) => {
    const schema = z.object({
      athlete: z.object({
        athleteId: z.string().min(1),
        age: z.number().int().min(8).max(120),
        developmentLevel: z.enum(["formacao", "rendimento"]),
        specialty: z.enum(["velocidade", "meio_fundo", "fundo"]),
        poolLengthM: z.union([z.literal(25), z.literal(50)]),
        eventMeters: z.number().positive().optional(),
        restrictions: z.array(z.string()).optional(),
      }),
      request: z.object({
        phase: phaseEnum,
        objective: z.string().min(1),
        primaryZone: zoneEnum,
        secondaryZone: zoneEnum.optional(),
        targetVolumeM: z.number().int().positive().multipleOf(10),
        rdcMarker: z.boolean().default(false),
        requiredLegVolumeM: z.number().int().positive().optional(),
        skillEmphasis: z.array(z.string()).optional(),
        readiness: z.number().min(0).max(100).optional(),
      }),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Requisição de prescrição inválida", details: parsed.error.flatten() });
    const { athlete, request: planning } = parsed.data;
    const library = loadRkfLibrary();
    const result = generatePrescription(athlete, { ...planning, skillEmphasis: planning.skillEmphasis as SkillCode[] | undefined }, library?.sessions ?? []);
    return reply.code(result.status === "PRONTO" ? 201 : 422).send({
      ...result,
      library: library ? { sessions: library.stats.sessions, blocks: library.stats.blocks, packageHash: library.stats.packageHash } : null,
    });
  });

  app.get("/api/v1/rkf/sessions", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    const library = loadRkfLibrary();
    if (!library) return reply.code(503).send({ error: "Biblioteca RKF V5.1 indisponível" });
    const query = z.object({
      zone: z.string().optional(),
      ageBand: z.string().optional(),
      profile: z.string().optional(),
      sessionType: z.string().optional(),
      minVolumeM: z.coerce.number().int().positive().optional(),
      maxVolumeM: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(request.query);
    let sessions = library.sessions;
    if (query.zone) sessions = sessions.filter((session) => session.zones.some((zone) => zone.toUpperCase() === query.zone!.toUpperCase()));
    if (query.ageBand) sessions = sessions.filter((session) => (session.ageBand ?? "").toLowerCase().includes(query.ageBand!.toLowerCase()));
    if (query.profile) sessions = sessions.filter((session) => (session.profile ?? "").toLowerCase().includes(query.profile!.toLowerCase()));
    if (query.sessionType) sessions = sessions.filter((session) => (session.sessionType ?? "").toLowerCase().includes(query.sessionType!.toLowerCase()));
    if (query.minVolumeM) sessions = sessions.filter((session) => session.volumeM >= query.minVolumeM!);
    if (query.maxVolumeM) sessions = sessions.filter((session) => session.volumeM <= query.maxVolumeM!);
    return {
      stats: library.stats,
      total: sessions.length,
      data: sessions.slice(0, query.limit).map((session) => ({
        id: session.id, title: session.title, ageBand: session.ageBand, profile: session.profile,
        sessionType: session.sessionType, objective: session.objective, zones: session.zones,
        volumeM: session.volumeM, blockCount: session.blocks.length, machineStatus: session.machineStatus,
        appSelectable: session.appSelectable,
      })),
    };
  });

  app.get("/api/v1/rkf/sessions/:id", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    const library = loadRkfLibrary();
    if (!library) return reply.code(503).send({ error: "Biblioteca RKF V5.1 indisponível" });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const session = library.sessions.find((candidate) => candidate.id === id);
    if (!session) return reply.code(404).send({ error: "Sessão não encontrada na biblioteca" });
    return session;
  });

  app.post("/api/v1/rkf/load/sessions", async (request, reply) => {
    const sessionSchema = z.object({
      athleteId: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      pse: z.number().min(0).max(10),
      durationMinutes: z.number().positive(),
      prescribedVolumeM: z.number().positive().optional(),
      executedVolumeM: z.number().nonnegative().optional(),
      expectedPse: z.number().min(0).max(10).optional(),
    });
    const parsed = z.object({ sessions: z.array(sessionSchema).min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Sessões de carga inválidas", details: parsed.error.flatten() });
    const layers = computeLoadLayers(parsed.data.sessions);
    const daily = new Map<string, number>();
    for (const session of parsed.data.sessions) {
      daily.set(session.date, (daily.get(session.date) ?? 0) + (session.pse * session.durationMinutes));
    }
    const monotony = computeMonotony([...daily.values()]);
    const alerts = buildLoadAlerts({ sessions: parsed.data.sessions, monotony });
    const chronic = computeChronicSeries(parsed.data.sessions, parsed.data.sessions[0].athleteId);
    return reply.code(200).send({
      ...layers,
      monotony,
      alerts,
      coldStart: chronic.points.length ? chronic.points[chronic.points.length - 1].coldStart : coldStartFor(0),
      chronicPoints: chronic.points,
      chronicConvention: chronic.convention,
    });
  });

  app.post("/api/v1/rkf/readiness/adapt", async (request, reply) => {
    const schema = z.object({
      athleteId: z.string().min(1).optional(),
      readiness: z.number().min(0).max(100),
      prescribedVolumeM: z.number().int().positive().multipleOf(10),
      primaryZone: zoneEnum,
      pain: z.number().min(0).max(10).optional(),
      sleepMinutes: z.number().nonnegative().optional(),
      hrvRatioToBaseline: z.number().positive().optional(),
      actualPse: z.number().min(0).max(10).optional(),
      targetPse: z.number().min(0).max(10).optional(),
      technique: z.number().min(1).max(5).optional(),
      coachApproved: z.boolean().default(false),
      zoneMapping: z.enum(["SECAO_18", "WORKBOOK_32_6"]).default("SECAO_18"),
      persist: z.boolean().default(true),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Requisição de adaptação inválida", details: parsed.error.flatten() });
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const { readiness, prescribedVolumeM, primaryZone, coachApproved, zoneMapping, persist, ...rest } = parsed.data;
    const decision = decideAdaptation({ readiness, prescribedVolumeM, primaryZone, guardrails: { readiness, ...rest }, coachApproved, zoneMapping });
    if (persist && store) {
      const athleteId = parsed.data.athleteId ?? (user.role === "athlete" ? user.athleteId : undefined);
      if (athleteId) {
        const record = store.create("adaptationDecisions", {
          title: `Adaptação ${decision.class} · ${athleteId}`,
          athleteId,
          decisionClass: decision.class,
          volumeFactor: decision.volumeFactor,
          adaptedVolumeM: decision.adaptedVolumeM,
          status: decision.status,
          primaryZone: decision.primaryZone,
          zoneMappingApplied: decision.zoneMappingApplied,
          rdcAllowed: decision.rdcAllowed,
          removedElements: decision.removedElements,
          triggered: decision.triggered,
          guardrails: { readiness, ...rest },
          version: decision.version,
          actorId: user.id,
          organizationId: user.organizationId,
        });
        return reply.code(200).send({ ...decision, persistedDecision: record });
      }
    }
    return reply.code(200).send(decision);
  });

  app.post("/api/v1/rkf/response-index", async (request, reply) => {
    const schema = z.object({
      readiness: z.number().min(0).max(100).optional(),
      sleepMinutes: z.number().nonnegative().optional(),
      hrv: z.number().positive().optional(),
      hrvBaseline: z.number().positive().optional(),
      pain: z.number().min(0).max(10).optional(),
      technique: z.number().min(1).max(5).optional(),
      techniqueTarget: z.number().min(1).max(5).optional(),
      adherence: z.number().min(0).max(1).optional(),
      qualityScore: z.number().min(0).max(5).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Check-in inválido", details: parsed.error.flatten() });
    return reply.code(200).send(computeResponseIndex(parsed.data));
  });

  app.post("/api/v1/rkf/evolution/assess", async (request, reply) => {
    const schema = z.object({
      comparables: z.number().int().nonnegative(),
      scoreDeltaPct: z.number(),
      readiness: z.number().min(0).max(100).optional(),
      consecutiveNegativeTrends: z.number().int().nonnegative().optional(),
      explainedByLoadOrHealth: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Requisição de evolução inválida", details: parsed.error.flatten() });
    return reply.code(200).send(classifyEvolution(parsed.data));
  });

  /**
   * Avaliação de evolução ponta a ponta a partir do histórico de resultados
   * persistidos: agrupa por chave comparável de 8 partes, calcula composite e
   * delta, e classifica. Alternativamente aceita o conjunto diretamente.
   */
  app.post("/api/v1/rkf/evolution/assess-set", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const sessionSchema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      repetitionTimesSeconds: z.array(z.number().positive()).min(1),
      consistencyScore: z.number().min(0).max(1),
      fatigueScore: z.number().min(0).max(1),
      efficiencyScore: z.number().min(0).max(1),
    });
    const schema = z.object({
      athleteId: z.string().min(1).optional(),
      comparableKey: z.object({
        athleteId: z.string().min(1),
        stroke: z.string().min(1),
        distanceM: z.number().int().positive(),
        zone: z.string().min(1),
        mode: z.string().min(1),
        material: z.string(),
        pool: z.string().min(1),
        protocol: z.string().min(1),
      }).optional(),
      readiness: z.number().min(0).max(100).optional(),
      sessions: z.array(sessionSchema).min(1),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Requisição de evolução inválida", details: parsed.error.flatten() });
    const athleteId = parsed.data.athleteId ?? parsed.data.comparableKey?.athleteId ?? user.athleteId ?? "";
    const isOwn = athleteMayAccess(user, athleteId);
    if (!roleAllows(user, ["coach", "admin"]) && !isOwn) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    const key = parsed.data.comparableKey ? comparableKeyFor(parsed.data.comparableKey) : null;
    if (parsed.data.comparableKey && !key) return reply.code(422).send({ error: "Chave comparável incompleta: excluir analytics (VAL-018)" });
    const label = key ?? `atleta:${athleteId}`;
    const ordered = [...parsed.data.sessions].sort((a, b) => a.date.localeCompare(b.date));
    const result = assessEvolutionSet({ label, readiness: parsed.data.readiness, sessions: ordered });
    if (store && key) {
      store.create("results", {
        title: `Avaliação de evolução · ${label} · ${ordered.at(-1)!.date}`,
        athleteId,
        comparableKey: key,
        evolutionAssessment: result,
        immutable: true,
        organizationId: user.organizationId,
        actorId: user.id,
      });
    }
    return reply.code(200).send(result);
  });

  /**
   * Histrico de evolução consolidado do atleta: agrupa resultados persistidos
   * por chave comparável e avalia cada conjunto com dados suficientes.
   */
  app.get("/api/v1/rkf/evolution/athletes/:athleteId", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    const isOwn = athleteMayAccess(user, athleteId);
    if (!roleAllows(user, ["coach", "admin"]) && !isOwn) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    const history = (store?.list("results") ?? []).filter((item) => item.athleteId === athleteId && item.organizationId === user.organizationId && item.comparableKey && item.sets);
    const byKey = new Map<string, EvolutionSessionInput[]>();
    for (const item of history) {
      const key = String(item.comparableKey);
      const sets = item.sets as Array<{ repetitions?: Array<{ timeSeconds?: number }>; set?: number; label?: string }>;
      for (const set of sets) {
        const times = (set.repetitions ?? []).map((repetition) => Number(repetition.timeSeconds)).filter((time) => Number.isFinite(time) && time > 0);
        if (!times.length) continue;
        const average = times.reduce((sum, time) => sum + time, 0) / times.length;
        const spread = Math.max(...times) - Math.min(...times);
        const consistency = average > 0 ? Math.max(0, 1 - spread / average) : 0;
        const entry: EvolutionSessionInput = {
          date: String(item.date ?? item.createdAt.slice(0, 10)),
          repetitionTimesSeconds: times,
          consistencyScore: Math.round(consistency * 100) / 100,
          fatigueScore: 0.5,
          efficiencyScore: 0.5,
        };
        (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(entry);
      }
    }
    const assessments = [...byKey.entries()]
      .filter(([, sessions]) => sessions.length > 0)
      .map(([key, sessions]) => assessEvolutionSet({ label: key, sessions: sessions.sort((a, b) => a.date.localeCompare(b.date)) }));
    return { athleteId, comparableKeys: byKey.size, assessments };
  });

  /**
   * Contratos do manual §20: readiness e carga por atleta derivados dos dados
   * persistidos da organização (fallback para o cenário de validação).
   */
  app.get("/api/v1/rkf/athletes/:athleteId/readiness", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    if (!roleAllows(user, ["coach", "admin"]) && !athleteMayAccess(user, athleteId)) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    const latest = (store?.list("adaptationDecisions") ?? []).filter((item) => item.athleteId === athleteId && item.organizationId === user.organizationId)[0];
    const snapshots = (store?.list("loadSnapshots") ?? []).filter((item) => item.athleteId === athleteId && item.organizationId === user.organizationId);
    return {
      athleteId,
      readiness: latest?.readiness ?? 82,
      class: latest?.decisionClass ?? "MANTER",
      coldStart: snapshots[0]?.coldStart ?? { stage: "CS0", confidence: 0.2, distinctActiveDays: 0 },
      guardrails: { painBlocksAt: 5, readinessBlocksBelow: 45, sleepFloorMinutes: 360 },
      version: latest?.version ?? "rkf-readiness-1.0.0",
      assessedAtUtc: latest?.updatedAt ?? new Date().toISOString(),
    };
  });

  app.get("/api/v1/rkf/athletes/:athleteId/load", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    if (!roleAllows(user, ["coach", "admin"]) && !athleteMayAccess(user, athleteId)) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    const activities = (store?.list("activities") ?? []).filter((item) => item.type === "rkf-load-session" && item.athleteId === athleteId && item.organizationId === user.organizationId);
    const sessions = activities.map((item) => ({
      athleteId, date: String(item.date), pse: Number(item.pse), durationMinutes: Number(item.durationMinutes),
      prescribedVolumeM: Number(item.prescribedVolumeM) || undefined, executedVolumeM: Number(item.executedVolumeM) || undefined,
      expectedPse: Number(item.expectedPse) || undefined,
    })).filter((session) => /^\d{4}-\d{2}-\d{2}$/.test(session.date) && session.pse > 0);
    const chronic = computeChronicSeries(sessions, athleteId);
    return {
      athleteId,
      sessions: sessions.length,
      latest: chronic.points.at(-1) ?? null,
      convention: chronic.convention,
      monotony: computeMonotony(sessions.slice(-7).map((session) => session.pse * session.durationMinutes)),
      alerts: buildLoadAlerts({ sessions: sessions.slice(-7), monotony: computeMonotony(sessions.slice(-7).map((session) => session.pse * session.durationMinutes)) }),
    };
  });

  app.get("/api/v1/rkf/athletes/:athleteId/load-layers", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    if (!roleAllows(user, ["coach", "admin"]) && !athleteMayAccess(user, athleteId)) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    const snapshots = (store?.list("loadSnapshots") ?? []).filter((item) => item.athleteId === athleteId && item.organizationId === user.organizationId);
    return { athleteId, snapshots, layersNeverCollapse: true, convention: "prescrita, executada e interna são persistidas separadamente" };
  });

  app.get("/api/v1/rkf/athletes/:athleteId/next-prescription", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    if (!roleAllows(user, ["coach", "admin"]) && !athleteMayAccess(user, athleteId)) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    const published = (store?.list("prescriptions") ?? []).filter((item) => item.athleteId === athleteId && item.organizationId === user.organizationId && item.status === "PUBLISHED");
    return { athleteId, next: published[0] ?? null, pending: published.length === 0 };
  });

  app.get("/api/v1/rkf/athletes/:athleteId/performance-trend", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const { athleteId } = z.object({ athleteId: z.string() }).parse(request.params);
    if (!roleAllows(user, ["coach", "admin"]) && !athleteMayAccess(user, athleteId)) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    const history = (store?.list("results") ?? []).filter((item) => item.athleteId === athleteId && item.organizationId === user.organizationId);
    const trend = history.map((item) => ({
      date: String(item.date ?? item.createdAt.slice(0, 10)),
      event: String(item.event ?? ""),
      bestTimeSeconds: Number(item.bestTimeSeconds ?? 0) || null,
      averageTimeSeconds: Number(item.averageTimeSeconds ?? 0) || null,
    })).sort((a, b) => a.date.localeCompare(b.date));
    return { athleteId, dataPoints: trend.length, trend };
  });

  app.get("/api/v1/rkf/entitlements", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const isCoach = roleAllows(user, ["coach", "admin"]);
    return {
      entitlements: isCoach ? ["LOAD_ATHLETE", "LOAD_TEAM", "FULL_ATHLETE", "FULL_TEAM"] : [user.role === "athlete" ? "LOAD_ATHLETE" : "LOAD_TEAM"],
      featureFlags: { voiceIngestion: true, deviceCommands: false, wearableRead: true },
      role: user.role,
    };
  });

  /** G25: contrato formal dos quatro planos do produto (manual §22). */
  app.get("/api/v1/rkf/plans", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    return {
      version: INGESTION_SEED_VERSION,
      plans: PRODUCT_PLANS,
      availableToRole: plansForRole(user.role === "athlete" ? "athlete" : "coach"),
    };
  });

  /** G27/G28: contratos e seeds de UI versionados (manual §22). */
  app.get("/api/v1/rkf/ui/contracts", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    return { version: UI_CONTRACT_VERSION, contracts: UI_CONTRACTS, seeds: UI_SEEDS, stateCoverage: uiSeedStateCoverage() };
  });

  /**
   * Evidência E2E (G23/G24/G27/G28): a suíte Playwright publica aqui o
   * resultado da execução; os gates leem a evidência registrada.
   */
  app.post("/api/v1/rkf/ui/e2e-evidence", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const body = z.object({
      suite: z.string().min(2),
      screens: z.array(z.object({ id: z.string(), passed: z.boolean() })).default([]),
      navigationPassed: z.boolean().default(false),
      contractsPassed: z.boolean().default(false),
      seedsPassed: z.boolean().default(false),
      desktop: z.boolean().default(true),
      mobile: z.boolean().default(false),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Evidência E2E inválida", details: body.error.flatten() });
    const evidence = {
      id: `e2e-${Date.now().toString(36)}`,
      suite: body.data.suite,
      screens: body.data.screens,
      screensPassed: body.data.screens.filter((screen) => screen.passed).length,
      screensTotal: body.data.screens.length,
      navigationPassed: body.data.navigationPassed,
      contractsPassed: body.data.contractsPassed,
      seedsPassed: body.data.seedsPassed,
      desktop: body.data.desktop,
      mobile: body.data.mobile,
      recordedAt: new Date().toISOString(),
      recordedBy: coach.id,
    };
    store.create("governance", { id: evidence.id, name: `Evidência E2E · ${body.data.suite}`, status: "e2e", e2eEvidence: evidence, organizationId: coach.organizationId, actorId: coach.id });
    return reply.code(201).send(evidence);
  });

  /** G35: os 8 contratos de ingestão nomeados com o que cada um prova. */
  app.get("/api/v1/rkf/ingestions/contracts", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    return { version: INGESTION_SEED_VERSION, total: INGESTION_CONTRACTS.length, contracts: INGESTION_CONTRACTS };
  });

  /** G36: aplica seeds de ingestão idempotentes por canal na organização. */
  app.post("/api/v1/rkf/ingestions/apply-seeds", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const executions: IngestionSeedExecution[] = applyIngestionSeeds(store, coach.organizationId, coach.id);
    const channels = [...new Set(INGESTION_SEEDS.map((seed) => seed.channel))];
    return reply.code(200).send({
      ok: true,
      version: INGESTION_SEED_VERSION,
      seeds: executions.length,
      channels,
      idempotent: executions.every((execution) => execution.ingestionId !== null),
      executions,
      note: "Seeds idempotentes por hash: reaplicar não duplica ingestões.",
    });
  });

  /** G19/G20: fadiga por distância/especialidade e recuperação por fase. */
  app.post("/api/v1/rkf/fatigue/assess", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const schema = z.object({
      athleteId: z.string().min(1),
      specialty: z.enum(["velocidade", "meio_fundo", "fundo"]).optional(),
      phase: phaseEnum.optional(),
      repetitionTimesSeconds: z.array(z.number().positive()).min(2),
      pain: z.number().min(0).max(10).optional(),
      technique: z.number().min(1).max(5).optional(),
      persist: z.boolean().default(false),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Avaliação de fadiga inválida", details: parsed.error.flatten() });
    if (!roleAllows(user, ["coach", "admin"]) && !athleteMayAccess(user, parsed.data.athleteId)) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    const assessment = assessDistanceFatigue(parsed.data);
    const recovery = parsed.data.phase ? recoveryForPhase(parsed.data.phase, parsed.data.specialty) : null;
    let persisted: unknown;
    if (parsed.data.persist && store) {
      persisted = store.create("adaptationDecisions", {
        title: `Fadiga · ${parsed.data.athleteId} · ${assessment.class}`,
        athleteId: parsed.data.athleteId,
        decisionClass: assessment.class,
        fatigueContext: { specialty: parsed.data.specialty, phase: parsed.data.phase, maxDropPct: assessment.maxDropPct },
        reason: assessment.reason,
        engineVersion: FATIGUE_ENGINE_VERSION,
        organizationId: user.organizationId,
        actorId: user.id,
      });
    }
    return reply.code(200).send({ assessment, recovery, persistedDecision: persisted ?? null });
  });

  app.get("/api/v1/rkf/fatigue/recovery-matrix", async (request) => {
    await getSession(sessionToken(request));
    return { version: FATIGUE_ENGINE_VERSION, matrix: PHASE_RECOVERY_MATRIX };
  });

  /** §32.7: classificação de histórico de aprendizagem (nunca altera zona/modelo). */
  app.post("/api/v1/rkf/learning-history", async (request, reply) => {
    const user = await requireAuthenticated(request, reply);
    if (!user) return;
    const schema = z.object({
      athleteId: z.string().min(1),
      pseDeviation: z.number(),
      volumeAdherencePct: z.number().min(0).max(200),
      readiness: z.number().min(0).max(100),
      sleepHours: z.number().min(0).max(24).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Histórico inválido", details: parsed.error.flatten() });
    if (!roleAllows(user, ["coach", "admin"]) && !athleteMayAccess(user, parsed.data.athleteId)) return reply.code(403).send({ error: "Acesso restrito ao próprio prontuário" });
    return { athleteId: parsed.data.athleteId, ...classifyLearningHistory(parsed.data) };
  });

  /**
   * UAT-06: ingestão confirmada com origem externa é promovida a
   * importedTrainingSessions/importedTrainingBlocks — nunca entra na biblioteca RKF.
   */
  app.post("/api/v1/rkf/ingestions/:id/commit-external", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const ingestion = store.get("ingestions", id);
    if (!ingestion || ingestion.organizationId !== coach.organizationId) return reply.code(404).send({ error: "Ingestão não encontrada" });
    if (ingestion.state !== "CONFIRMED") return reply.code(409).send({ error: "Confirme os campos críticos antes de consolidar o treino externo" });
    const existing = (store.list("importedTrainingSessions") ?? []).some((item) => item.ingestionId === id);
    if (existing) return reply.code(409).send({ error: "Treino externo já consolidado para esta ingestão" });
    const parsedData = (ingestion.parsedData ?? {}) as { blocks?: Array<Record<string, unknown>>; totalVolumeM?: number; athleteId?: string; date?: string };
    const imported = store.create("importedTrainingSessions", {
      title: `Treino externo · ${String(ingestion.title ?? id)}`,
      athleteId: String(parsedData.athleteId ?? "unassigned"),
      date: String(parsedData.date ?? new Date().toISOString().slice(0, 10)),
      totalVolumeM: Number(parsedData.totalVolumeM ?? 0) || null,
      sourceIngestionId: id,
      channel: String(ingestion.channel ?? ""),
      externalTrainerRetained: true,
      status: "IMPORTED",
      organizationId: coach.organizationId,
      actorId: coach.id,
    });
    const blocks = (parsedData.blocks ?? []).map((block, index) => store.create("importedTrainingBlocks", {
      title: `Bloco ${index + 1} · treino externo ${imported.id}`,
      importedSessionId: imported.id,
      blockOrder: index + 1,
      volumeM: Number(block.volumeM ?? 0) || null,
      zone: block.zone ?? null,
      prescriptionText: block.prescriptionText ?? null,
      organizationId: coach.organizationId,
      actorId: coach.id,
    }));
    store.update("ingestions", id, { state: "ASSIGNED", status: "assigned", lastTransitionAt: new Date().toISOString(), lastTransitionBy: coach.id });
    return reply.code(201).send({
      ok: true,
      importedSession: imported,
      blocks: blocks.length,
      note: "Treino externo consolidado em importedTrainingSessions; permanece fora da biblioteca RKF (manual §16).",
      libraryIsolation: true,
    });
  });

  /**
   * UAT-08: revisão de prescrição publicada cria nova versão pendente; o
   * snapshot publicado permanece imutável e a alteração é auditada.
   */
  app.post("/api/v1/rkf/prescriptions/:id/revise", async (request, reply) => {
    const coach = await requireCoach(request, reply);
    if (!coach) return;
    if (!store) return reply.code(503).send({ error: "Persistência RKF indisponível" });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ prescription: z.record(z.unknown()), note: z.string().min(3).optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Revisão inválida", details: body.error.flatten() });
    const current = store.get("prescriptions", id);
    if (!current || current.organizationId !== coach.organizationId) return reply.code(404).send({ error: "Prescrição não encontrada" });
    if (current.status !== "PUBLISHED") return reply.code(409).send({ error: "Somente prescrições publicadas geram revisão versionada" });
    const nextVersion = Number(current.version ?? 1) + 1;
    const revised = store.create("prescriptions", {
      title: `${String(current.title ?? "Prescrição")} · v${nextVersion}`,
      athleteId: current.athleteId,
      status: "PENDING_APPROVAL",
      immutable: false,
      version: nextVersion,
      supersedes: id,
      revisionNote: body.data.note ?? "Revisão após publicação",
      prescription: body.data.prescription,
      audit: current.audit,
      organizationId: coach.organizationId,
      actorId: coach.id,
    });
    return reply.code(201).send({
      ok: true,
      revised,
      publishedRemainsImmutable: true,
      note: `v${nextVersion} criada como PENDING_APPROVAL; o snapshot publicado v${current.version} não foi alterado.`,
    });
  });
}
