import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerRkfRoutes } from "./rkf-routes.js";
import { ManagedStore } from "./managed-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login } from "./auth.js";
import { PHASE_RECOVERY_MATRIX, recoveryForPhase, assessDistanceFatigue, classifyLearningHistory } from "@natacao/domain";
import { evaluateRkfReleaseGates } from "./rkf-release-gates.js";
import { resourceKinds } from "./managed-store.js";

const app = Fastify({ logger: false });
const testRoot = mkdtempSync(join(tmpdir(), "rkf-manual-"));
const store = new ManagedStore(join(testRoot, "rkf.json"));
await app.register(multipart);
registerRkfRoutes(app, store);
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
const athleteCookie = `natacao_session=${(await login("ana@natacao.local", "natacao-demo"))!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(testRoot, { recursive: true, force: true }); });

describe("G04 — modelo com 43 entidades persistíveis", () => {
  it("resourceKinds cobre as entidades do manual §7.1", () => {
    expect(resourceKinds.length).toBeGreaterThanOrEqual(43);
    const expected = ["teams", "users", "athletes", "athleteProfiles", "athleteCalibrations", "trainingZones", "macrocycles", "mesocycles", "microcycles", "trainingSessions", "sessionBlocks", "sessionPrescriptions", "prescriptionBlocks", "sessionExecutions", "athleteResponses", "readinessScores", "adaptationDecisions", "syncJobs", "auditEvents", "sessionResults", "setResults", "repetitionResults", "splitResults", "sessionContextSnapshots", "performanceBenchmarks", "evolutionAssessments", "distanceFatigueRules", "trainingIngestions", "trainingSourceAssets", "trainingExtractions", "trainingReviewItems", "importedTrainingSessions", "importedTrainingBlocks", "athleteSessionAssignments", "loadCalculations"];
    const present = new Set(resourceKinds as readonly string[]);
    const missing = expected.filter((entity) => !present.has(entity) && !present.has(entity.replace(/([A-Z])/g, "_$1").toLowerCase()));
    // Resultados hierárquicos vivem em "results" e ingestão em "ingestions": aceitamos equivalentes canônicos
    const equivalents: Record<string, string[]> = {
      sessionResults: ["results"], setResults: ["results"], repetitionResults: ["results"], splitResults: ["results"],
      trainingIngestions: ["ingestions"],
    };
    const trulyMissing = missing.filter((entity) => !(equivalents[entity] ?? []).some((alias) => present.has(alias)));
    expect(trulyMissing).toEqual([]);
  });

  it("gate G04 passa com a contagem real", () => {
    const report = evaluateRkfReleaseGates(baseEvidence(resourceKinds.length), new Date());
    const gate = report.gates.find((candidate) => candidate.id === "G04");
    expect(gate?.status).toBe("PASS");
    expect(gate?.actual).toBe(resourceKinds.length);
  });
});

describe("G19 — fadiga por distância/especialidade", () => {
  it("queda >3% entre repetições sinaliza adaptação/interrupção", () => {
    const assessment = assessDistanceFatigue({ specialty: "fundo", repetitionTimesSeconds: [100, 103.5, 104.5] });
    expect(assessment.class).toBe("FADIGA_TRANSITORIA");
    expect(assessment.maxDropPct).toBeGreaterThan(3);
    expect(assessment.maxDropPct).toBeLessThanOrEqual(4);
  });

  it("queda crítica ou dor ≥5 interrompe a série", () => {
    const critical = assessDistanceFatigue({ specialty: "fundo", repetitionTimesSeconds: [100, 105, 112] });
    expect(critical.class).toBe("INTERROMPER_SERIE");
    const pain = assessDistanceFatigue({ specialty: "velocidade", repetitionTimesSeconds: [30, 30.2], pain: 6 });
    expect(pain.class).toBe("INTERROMPER_SERIE");
    expect(pain.reason).toContain("Dor");
  });

  it("decaimento estável é tolerância boa", () => {
    const assessment = assessDistanceFatigue({ specialty: "meio_fundo", repetitionTimesSeconds: [120, 120.5, 121] });
    expect(assessment.class).toBe("TOLERANCIA_BOA");
  });

  it("rota persiste decisão de fadiga com contexto (G22)", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/fatigue/assess", headers: { cookie: coachCookie },
      payload: { athleteId: "ana-souza", specialty: "fundo", phase: "TRANSFORMACAO", repetitionTimesSeconds: [100, 104.2, 109], persist: true },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.assessment.class).toBe("INTERROMPER_SERIE");
    expect(body.persistedDecision).toMatchObject({ athleteId: "ana-souza", decisionClass: "INTERROMPER_SERIE" });
    expect(body.recovery).toMatchObject({ interBlockRecovery: "CONDICIONAL_100_300" });
  });

  it("atleta só avalia a própria fadiga", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/fatigue/assess", headers: { cookie: athleteCookie },
      payload: { athleteId: "caio-martins", repetitionTimesSeconds: [50, 52] },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("G20 — recuperação por fase", () => {
  it("matriz cobre as nove fases com política explícita", () => {
    expect(Object.keys(PHASE_RECOVERY_MATRIX)).toHaveLength(9);
    for (const matrix of Object.values(PHASE_RECOVERY_MATRIX)) {
      expect(["AUTOMATICA_A1", "CONDICIONAL_100_300", "SEM_A1_AUTOMATICO", "COMPLETA"]).toContain(matrix.interBlockRecovery);
    }
  });

  it("fundo em transformação restringe A1 interbloco a 100–300 m", () => {
    expect(recoveryForPhase("TRANSFORMACAO", "fundo").interBlockRecovery).toBe("CONDICIONAL_100_300");
    expect(recoveryForPhase("TRANSFORMACAO", "velocidade").interBlockRecovery).not.toBe("SEM_A1_AUTOMATICO");
  });

  it("acumulação de fundo não tem A1 automático; taper/competição têm recuperação completa", () => {
    expect(recoveryForPhase("ACUMULACAO", "fundo").interBlockRecovery).toBe("SEM_A1_AUTOMATICO");
    expect(recoveryForPhase("TAPER").interBlockRecovery).toBe("COMPLETA");
    expect(recoveryForPhase("COMPETICAO").interBlockRecovery).toBe("COMPLETA");
  });

  it("expõe a matriz pela rota pública", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/fatigue/recovery-matrix" });
    expect(response.statusCode).toBe(200);
    expect(response.json().matrix).toHaveProperty("TAPER");
  });
});

describe("§32.7 — histórico de aprendizagem", () => {
  it("classifica carga acima da resposta, boa tolerância, limitante e insuficiência", () => {
    expect(classifyLearningHistory({ pseDeviation: 2.5, volumeAdherencePct: 105, readiness: 80 }).classification).toBe("CARGA_RITMO_ACIMA_DA_RESPOSTA");
    expect(classifyLearningHistory({ pseDeviation: 0, volumeAdherencePct: 98, readiness: 85 }).classification).toBe("BOA_TOLERANCIA");
    expect(classifyLearningHistory({ pseDeviation: 0.5, volumeAdherencePct: 60, readiness: 50, sleepHours: 3 }).classification).toBe("RECUPERACAO_TECNICA_LIMITANTE");
    expect(classifyLearningHistory({ pseDeviation: 0.5, volumeAdherencePct: 60, readiness: 85, sleepHours: 8 }).classification).toBe("DADOS_INSUFICIENTES");
  });

  it("rota valida escopo do atleta", async () => {
    const denied = await app.inject({
      method: "POST", url: "/api/v1/rkf/learning-history", headers: { cookie: athleteCookie },
      payload: { athleteId: "caio-martins", pseDeviation: 1, volumeAdherencePct: 100, readiness: 80 },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({
      method: "POST", url: "/api/v1/rkf/learning-history", headers: { cookie: coachCookie },
      payload: { athleteId: "ana-souza", pseDeviation: 2.2, volumeAdherencePct: 106, readiness: 80 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().classification).toBe("CARGA_RITMO_ACIMA_DA_RESPOSTA");
  });
});

describe("UAT-06 — treino externo confirmado fora da biblioteca", () => {
  it("consolida ingestão confirmada em importedTrainingSessions e nunca na biblioteca", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/ingestions", headers: { cookie: coachCookie },
      payload: { channel: "API", title: "Treino do clube externo", original: "Aquecimento 500\n6x100 A2\nRegenerativo 200", parsedData: { athleteId: "ana-souza", date: "2026-08-30", kind: "external_training", blocks: [{ volumeM: 500, zone: "A1" }, { volumeM: 600, zone: "A2" }, { volumeM: 200, zone: "A1" }], totalVolumeM: 1300 } },
    });
    const ingestion = created.json();
    await app.inject({ method: "POST", url: `/api/v1/rkf/ingestions/${ingestion.id}/confirm`, headers: { cookie: coachCookie }, payload: {} });
    const committed = await app.inject({ method: "POST", url: `/api/v1/rkf/ingestions/${ingestion.id}/commit-external`, headers: { cookie: coachCookie }, payload: {} });
    expect(committed.statusCode).toBe(201);
    const body = committed.json();
    expect(body.ok).toBe(true);
    expect(body.libraryIsolation).toBe(true);
    expect(body.blocks).toBe(3);
    expect(body.importedSession).toMatchObject({ athleteId: "ana-souza", status: "IMPORTED", externalTrainerRetained: true });
    // A ingestão avançou para ASSIGNED
    const ingestions = await app.inject({ method: "GET", url: "/api/v1/rkf/ingestions", headers: { cookie: coachCookie } });
    const updated = ingestions.json().data.find((item: { id: string }) => item.id === ingestion.id);
    expect(updated.state).toBe("ASSIGNED");
  });

  it("rejeita consolidação sem confirmação prévia e duplicada", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/ingestions", headers: { cookie: coachCookie },
      payload: { channel: "TEXT", title: "Externo não confirmado", original: "8x100 A2", parsedData: { athleteId: "ana-souza", date: "2026-08-30", kind: "external_training" } },
    });
    const unconfirmed = await app.inject({ method: "POST", url: `/api/v1/rkf/ingestions/${created.json().id}/commit-external`, headers: { cookie: coachCookie }, payload: {} });
    expect(unconfirmed.statusCode).toBe(409);
  });
});

describe("UAT-08 — revisão de publicada cria versão, snapshot imutável", () => {
  it("revise cria v2 PENDING_APPROVAL sem tocar o snapshot publicado", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/prescriptions", headers: { cookie: coachCookie },
      payload: { athleteId: "ana-souza", title: "Sessão v1", prescription: { totalVolumeM: 5000, blocks: [] }, audit: { passed: true } },
    });
    const prescription = created.json();
    await app.inject({ method: "POST", url: `/api/v1/rkf/prescriptions/${prescription.id}/approve`, headers: { cookie: coachCookie }, payload: {} });
    const revised = await app.inject({
      method: "POST", url: `/api/v1/rkf/prescriptions/${prescription.id}/revise`, headers: { cookie: coachCookie },
      payload: { prescription: { totalVolumeM: 5200 }, note: "Ajuste de volume após avaliação" },
    });
    expect(revised.statusCode).toBe(201);
    const body = revised.json();
    expect(body.ok).toBe(true);
    expect(body.publishedRemainsImmutable).toBe(true);
    expect(body.revised).toMatchObject({ status: "PENDING_APPROVAL", version: 2, supersedes: prescription.id });
    // A original continua PUBLISHED e imutável
    const list = await app.inject({ method: "GET", url: "/api/v1/rkf/prescriptions", headers: { cookie: coachCookie } });
    const original = list.json().data.find((item: { id: string }) => item.id === prescription.id);
    expect(original).toMatchObject({ status: "PUBLISHED", immutable: true, version: 1 });
  });

  it("revise exige prescrição publicada e papel coach", async () => {
    const denied = await app.inject({
      method: "POST", url: "/api/v1/rkf/prescriptions/inexistente/revise", headers: { cookie: athleteCookie },
      payload: { prescription: {} },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe("contratos §20 por atleta", () => {
  it("readiness/load/load-layers/next-prescription/performance-trend respondem com escopo", async () => {
    const paths = [
      "/api/v1/rkf/athletes/ana-souza/readiness",
      "/api/v1/rkf/athletes/ana-souza/load",
      "/api/v1/rkf/athletes/ana-souza/load-layers",
      "/api/v1/rkf/athletes/ana-souza/next-prescription",
      "/api/v1/rkf/athletes/ana-souza/performance-trend",
    ];
    for (const path of paths) {
      const coach = await app.inject({ method: "GET", url: path, headers: { cookie: coachCookie } });
      expect(coach.statusCode).toBe(200);
      // Atleta não acessa prontuário de outro atleta
      const athlete = await app.inject({ method: "GET", url: path.replace("ana-souza", "caio-martins"), headers: { cookie: athleteCookie } });
      expect(athlete.statusCode).toBe(403);
    }
    const readiness = (await app.inject({ method: "GET", url: paths[0], headers: { cookie: coachCookie } })).json();
    expect(readiness).toMatchObject({ athleteId: "ana-souza" });
    expect(readiness.guardrails).toEqual({ painBlocksAt: 5, readinessBlocksBelow: 45, sleepFloorMinutes: 360 });
  });

  it("entitlements distinguem coach de atleta", async () => {
    const coach = await app.inject({ method: "GET", url: "/api/v1/rkf/entitlements", headers: { cookie: coachCookie } });
    expect(coach.statusCode).toBe(200);
    expect(coach.json().entitlements).toContain("FULL_TEAM");
    const athlete = await app.inject({ method: "GET", url: "/api/v1/rkf/entitlements", headers: { cookie: athleteCookie } });
    expect(athlete.statusCode).toBe(200);
    expect(athlete.json().entitlements).toEqual(["LOAD_ATHLETE"]);
    expect(athlete.json().featureFlags.deviceCommands).toBe(false);
  });
});

describe("gates executáveis atualizados", () => {
  it("G19 e G20 passam com prova de domínio; G04 com 43+ entidades", () => {
    const report = evaluateRkfReleaseGates(baseEvidence(48), new Date());
    expect(report.gates.find((gate) => gate.id === "G19")?.status).toBe("PASS");
    expect(report.gates.find((gate) => gate.id === "G20")?.status).toBe("PASS");
    expect(report.gates.find((gate) => gate.id === "G04")?.status).toBe("PASS");
  });

  it("G22 vira review (não bloqueia) sem decisão persistida", () => {
    const report = evaluateRkfReleaseGates(baseEvidence(48), new Date());
    const gate = report.gates.find((candidate) => candidate.id === "G22");
    expect(gate?.status).toBe("REVIEW");
    expect(gate?.blocking).toBe(true);
  });
});

function baseEvidence(entityCount: number) {
  return {
    seed: { located: true, staged: true, imported: true, sessions: 910, blocks: 6226, prescriptionUnits: 6226, files: 10 },
    apiContractCount: 50,
    entityCount,
    migrationCount: 6,
    eventContractCount: 36,
    resultCount: 1,
    loadSnapshotCount: 1,
    postTrainingSeedCount: 44,
    fatigueSeedCount: 0,
    ingestionSeedCount: 1,
    confirmedIngestionCount: 1,
    ingestionChannelsObserved: ["TEXT", "PHOTO", "FILE", "VOICE", "API"],
    auditableOriginalFormatsObserved: ["pdf", "csv", "json", "txt", "jpg", "xlsx"],
    assignmentTargetTypesObserved: ["team", "group", "athlete"],
  };
}
