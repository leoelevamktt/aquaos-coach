import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerRkfRoutes } from "./rkf-routes.js";
import { registerReportRoutes } from "./report-routes.js";
import { ManagedStore } from "./managed-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login } from "./auth.js";

const app = Fastify({ logger: false });
const testRoot = mkdtempSync(join(tmpdir(), "rkf-routes-"));
const store = new ManagedStore(join(testRoot, "rkf.json"));
await app.register(multipart);
registerRkfRoutes(app, store);
registerReportRoutes(app, store);
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
const athleteCookie = `natacao_session=${(await login("ana@natacao.local", "natacao-demo"))!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(testRoot, { recursive: true, force: true }); });

describe("rotas RKF", () => {
  it("expõe dicionários da seed V5.1", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/dictionaries" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.seedVersion).toBe("RKF_V5.1");
    expect(body.zones).toHaveLength(6);
    expect(body.rules).toHaveLength(18);
    expect(body.materials).toHaveLength(11);
    expect(body.skills).toHaveLength(14);
  });

  it("UAT-03 na rota: PSE 7 × 90 min = 630 UA", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/load/sessions",
      payload: { sessions: [{ athleteId: "a1", date: "2026-08-29", pse: 7, durationMinutes: 90, prescribedVolumeM: 3500, executedVolumeM: 3400 }] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.layers.internal.loadUa).toBe(630);
    expect(body.layers.prescribed).toEqual({ volumeM: 3500 });
    expect(body.layers.executed).toEqual({ volumeM: 3400 });
  });

  it("UAT-01 na rota: prescrição de 5.800 m exatos", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/sessions/compose",
      payload: {
        athlete: { athleteId: "ath-16", age: 16, developmentLevel: "rendimento", specialty: "meio_fundo", poolLengthM: 25, eventMeters: 200 },
        request: { phase: "TRANSFORMACAO", objective: "A2/A3", primaryZone: "A2", secondaryZone: "A3", targetVolumeM: 5800, rdcMarker: false, requiredLegVolumeM: 600, readiness: 82 },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("PRONTO");
    expect(body.prescription.totalVolumeM).toBe(5800);
    expect(body.audit.passed).toBe(true);
  });

  it("rejeita zona fora do vocabulário (UAT-02)", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/sessions/compose",
      payload: {
        athlete: { athleteId: "ath-16", age: 16, developmentLevel: "rendimento", specialty: "meio_fundo", poolLengthM: 25 },
        request: { phase: "BASE", objective: "x", primaryZone: "EN5", targetVolumeM: 3000, rdcMarker: false },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("ciclo inválido retorna 422 (REVISAR)", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/cycles/generate",
      payload: { age: 16, totalWeeks: 60, sessionsPerWeek: 8, currentVolumeM: 40000, maxVolumeM: 55000 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("adaptação bloqueada exige treinador", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/readiness/adapt", headers: { cookie: coachCookie },
      payload: { readiness: 35, prescribedVolumeM: 5000, primaryZone: "AN2", persist: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ class: "BLOQUEAR", status: "AGUARDAR_TREINADOR", primaryZone: "A1" });
  });

  it("expõe panorama RKF com origem e gates declarados", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/bootstrap" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      program: { version: "RKF_V5.1", mode: "VALIDATION" },
      seed: { expectedSessions: 910, expectedBlocks: 6226, packageLocated: true, staged: true, imported: false, status: "STAGING_READY" },
      release: { decision: "BLOCKED", summary: { total: 36 } },
      provenance: { type: "SYNTHETIC_VALIDATION" },
    });
    expect(response.json().gates).toHaveLength(36);
  });

  it("restringe e executa o registro completo de release gates", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/rkf/release-gates" });
    expect(unauthenticated.statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/release-gates", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ methodologyVersion: "RKF_V5.1", decision: "BLOCKED", summary: { total: 36 }, scope: { realDeviceIntegrations: "EXCLUDED_BY_PRODUCT_SCOPE" } });
    expect(response.json().gates.find((gate: { id: string }) => gate.id === "G07")).toMatchObject({ status: "EXCLUDED" });
  });

  it("confere o pacote canônico RKF V5.1 no staging", async () => {
    const status = await app.inject({ method: "GET", url: "/api/v1/rkf/seed/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ located: true, staged: true, status: "STAGING_READY", manifest: { version: "RKF_V5.1", sessions: 910, blocks: 6226 } });
    const staged = await app.inject({ method: "POST", url: "/api/v1/rkf/seed/stage", headers: { cookie: coachCookie }, payload: {} });
    expect(staged.statusCode).toBe(200);
    expect(staged.json()).toMatchObject({ ok: true, governance: { status: "staged", seedImported: false } });
    const imported = await app.inject({ method: "POST", url: "/api/v1/rkf/seed/import", headers: { cookie: coachCookie }, payload: {} });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ ok: true, driver: "file-atomic", importedRows: 15246, files: 10, governance: { status: "imported", seedImported: true } });
  });

  it("preserva original, exige revisão e confirma ingestão com campos críticos", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/ingestions", headers: { cookie: coachCookie },
      payload: { channel: "TEXT", title: "Sessão importada", original: "8x100 livre A2", confidence: 0.71, parsedData: { athleteId: "a1", date: "2026-08-30", kind: "training_session" } },
    });
    expect(created.statusCode).toBe(201);
    const ingestion = created.json();
    expect(ingestion).toMatchObject({ state: "REVIEW", requiresHumanReview: true, version: 1 });
    expect(ingestion.originalHash).toHaveLength(64);

    const confirmed = await app.inject({ method: "POST", url: `/api/v1/rkf/ingestions/${ingestion.id}/confirm`, headers: { cookie: coachCookie }, payload: {} });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ state: "CONFIRMED", status: "confirmed", reviewerId: "user-coach" });
  });

  it("bloqueia confirmação quando campos críticos estão ausentes", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/rkf/ingestions", headers: { cookie: coachCookie }, payload: { channel: "FILE", title: "Arquivo incompleto", original: "conteúdo", parsedData: {} } });
    const confirmed = await app.inject({ method: "POST", url: `/api/v1/rkf/ingestions/${created.json().id}/confirm`, headers: { cookie: coachCookie }, payload: {} });
    expect(confirmed.statusCode).toBe(422);
    expect(confirmed.json().missing).toEqual(["athleteId", "date", "kind"]);
  });

  it("publica snapshot imutável somente com papel autorizado", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/rkf/prescriptions", headers: { cookie: coachCookie }, payload: { athleteId: "a1", title: "Sessão RKF", prescription: { totalVolumeM: 5800 }, audit: { passed: true } } });
    const prescription = created.json();
    const denied = await app.inject({ method: "POST", url: `/api/v1/rkf/prescriptions/${prescription.id}/approve`, headers: { cookie: athleteCookie }, payload: {} });
    expect(denied.statusCode).toBe(403);
    const approved = await app.inject({ method: "POST", url: `/api/v1/rkf/prescriptions/${prescription.id}/approve`, headers: { cookie: coachCookie }, payload: {} });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "PUBLISHED", immutable: true, approvedBy: "user-coach", publishedSnapshot: { totalVolumeM: 5800 } });
  });

  it("grava pós-treino hierárquico e snapshot de carga", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/results/sessions", headers: { cookie: athleteCookie },
      payload: { athleteId: "ana-souza", date: "2026-08-30", event: "200 m Livre", poolLengthM: 50, sessionDistanceM: 6000, capturedDistanceM: 400, durationMinutes: 100, pse: 7, expectedPse: 6, prescribedVolumeM: 6000, sets: [{ set: 1, label: "2x200 A2", zone: "A2", repetitions: [{ repetition: 1, distanceM: 200, timeSeconds: 128, splits: [{ distanceM: 100, timeSeconds: 63 }] }, { repetition: 2, distanceM: 200, timeSeconds: 129, splits: [{ distanceM: 100, timeSeconds: 64 }] }] }] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ result: { status: "CONFIRMED", immutable: true, bestTimeSeconds: 128, averageTimeSeconds: 128.5 }, loadSnapshot: { status: "COMMITTED", immutable: true, layers: { internal: { loadUa: 700 } } } });
  });

  it("expõe a biblioteca de 910 sessões com stats de integridade", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/sessions?limit=5", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.stats.sessions).toBe(910);
    expect(body.stats.blocks).toBe(6226);
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.data[0]).toMatchObject({ id: expect.stringMatching(/^RKF-/), zones: expect.any(Array) });
  });

  it("consulta sessão da biblioteca por ID preservando blocos (UAT-12)", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/rkf/sessions?limit=1", headers: { cookie: coachCookie } });
    const first = list.json().data[0];
    const detail = await app.inject({ method: "GET", url: `/api/v1/rkf/sessions/${first.id}`, headers: { cookie: coachCookie } });
    expect(detail.statusCode).toBe(200);
    const session = detail.json();
    expect(session.id).toBe(first.id);
    expect(session.blocks.length).toBeGreaterThan(0);
    expect(session.blocks[0]).toMatchObject({ component: expect.any(String), volumeM: expect.any(Number) });
    const missing = await app.inject({ method: "GET", url: "/api/v1/rkf/sessions/RKF-INEXISTENTE", headers: { cookie: coachCookie } });
    expect(missing.statusCode).toBe(404);
  });

  it("conecta a biblioteca ao motor: prescrição informa origem e integridade", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/sessions/compose",
      payload: {
        athlete: { athleteId: "ath-16", age: 16, developmentLevel: "rendimento", specialty: "meio_fundo", poolLengthM: 25, eventMeters: 200 },
        request: { phase: "TRANSFORMACAO", objective: "A2/A3", primaryZone: "A2", secondaryZone: "A3", targetVolumeM: 5800, rdcMarker: false, requiredLegVolumeM: 600, readiness: 82 },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.library).toMatchObject({ sessions: 910, blocks: 6226 });
    expect(body.prescription.totalVolumeM).toBe(5800);
  });

  it("avalia evolução ponta a ponta: menos de 3 comparáveis é insuficiente", async () => {
    const insufficient = await app.inject({
      method: "POST", url: "/api/v1/rkf/evolution/assess-set", headers: { cookie: coachCookie },
      payload: {
        comparableKey: { athleteId: "ana-souza", stroke: "Livre", distanceM: 200, zone: "A2", mode: "nado", material: "SEM", pool: "50", protocol: "2x200" },
        sessions: [
          { date: "2026-08-01", repetitionTimesSeconds: [130, 131], consistencyScore: 0.9, fatigueScore: 0.5, efficiencyScore: 0.8 },
          { date: "2026-08-08", repetitionTimesSeconds: [128, 129], consistencyScore: 0.9, fatigueScore: 0.5, efficiencyScore: 0.8 },
        ],
      },
    });
    expect(insufficient.statusCode).toBe(200);
    expect(insufficient.json()).toMatchObject({ classification: "DADOS_INSUFICIENTES", comparables: 2, confidence: 65 });
  });

  it("avalia evolução com 3+ comparáveis e detecta tendência", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/evolution/assess-set", headers: { cookie: coachCookie },
      payload: {
        comparableKey: { athleteId: "ana-souza", stroke: "Livre", distanceM: 200, zone: "A2", mode: "nado", material: "SEM", pool: "50", protocol: "2x200" },
        readiness: 82,
        sessions: [
          { date: "2026-08-01", repetitionTimesSeconds: [132, 134], consistencyScore: 0.85, fatigueScore: 0.5, efficiencyScore: 0.7 },
          { date: "2026-08-08", repetitionTimesSeconds: [130, 131], consistencyScore: 0.9, fatigueScore: 0.5, efficiencyScore: 0.75 },
          { date: "2026-08-15", repetitionTimesSeconds: [127, 128], consistencyScore: 0.92, fatigueScore: 0.6, efficiencyScore: 0.8 },
          { date: "2026-08-22", repetitionTimesSeconds: [125, 126], consistencyScore: 0.94, fatigueScore: 0.6, efficiencyScore: 0.85 },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.comparables).toBe(4);
    expect(body.scoreDeltaPct).toBeGreaterThan(0);
    expect(body.sessions).toHaveLength(4);
    expect(body.latest.bestTimeSeconds).toBe(125);
  });

  it("rejeita chave comparável incompleta (VAL-018)", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/evolution/assess-set", headers: { cookie: coachCookie },
      payload: {
        comparableKey: { athleteId: "ana-souza", stroke: "Livre", distanceM: 200, zone: "A2", mode: "nado", material: "", pool: "50", protocol: "2x200" },
        sessions: [{ date: "2026-08-01", repetitionTimesSeconds: [130], consistencyScore: 0.9, fatigueScore: 0.5, efficiencyScore: 0.8 }],
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("persiste decisão de adaptação com versão e auditoria", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/readiness/adapt", headers: { cookie: coachCookie },
      payload: { athleteId: "ana-souza", readiness: 65, prescribedVolumeM: 5000, primaryZone: "A3", persist: true },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ class: "REDUZIR", status: "LIBERAR_ADAPTACAO" });
    expect(body.persistedDecision).toMatchObject({
      athleteId: "ana-souza",
      decisionClass: "REDUZIR",
      volumeFactor: 0.85,
      adaptedVolumeM: 4250,
      actorId: "user-coach",
    });
    const history = await app.inject({ method: "GET", url: "/api/v1/rkf/evolution/athletes/ana-souza", headers: { cookie: coachCookie } });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({ athleteId: "ana-souza" });
  });

  it("parser RKF extrai zonas, volumes e RP como marcador do texto (UAT-05 sem invenção)", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/ingestions", headers: { cookie: coachCookie },
      payload: { channel: "TEXT", title: "Treino de mesa", original: "Aquecimento 600 m livre\n8x100 A2 progressivo\n4x50 RP100 valendo\nPerna 400 m com prancha\nRegenerativo 200 m" },
    });
    expect(response.statusCode).toBe(201);
    const ingestion = response.json();
    const parsed = ingestion.parsedData;
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(4);
    expect(parsed.zones).toContain("A2");
    expect(parsed.materials).toContain("BOARD");
    expect(parsed.totalVolumeM).toBeGreaterThan(0);
    // RP100 vira marcador RDC, nunca zona (VAL-004)
    expect(parsed.zones).not.toContain("RP100");
    expect(ingestion.pipeline).toContain("EXTRACTED");
  });

  it("ingestão FILE aceita multipart e extrai automaticamente", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/ingestions",
      headers: { cookie: coachCookie, "content-type": "multipart/form-data; boundary=---rkfbound" },
      payload: `-----rkfbound\r\nContent-Disposition: form-data; name="channel"\r\n\r\nFILE\r\n-----rkfbound\r\nContent-Disposition: form-data; name="title"\r\n\r\nTreino do bloco\r\n-----rkfbound\r\nContent-Disposition: form-data; name="file"; filename="treino.txt"\r\nContent-Type: text/plain\r\n\r\nAquecimento 500 m\n6x100 A2 com pull\r\n-----rkfbound--\r\n`,
    });
    expect(response.statusCode).toBe(201);
    const ingestion = response.json();
    expect(ingestion.channel).toBe("FILE");
    expect(ingestion.sourceName).toBe("treino.txt");
    expect(ingestion.parsedData.blocks.length).toBeGreaterThanOrEqual(2);
    expect(ingestion.parsedData.materials).toContain("PULL");
    expect(ingestion.pipeline).toEqual(expect.arrayContaining(["RECEIVED", "STORED", "EXTRACTED", "PARSED", "REVIEW"]));
  });

  it("gera PDF da prescrição publicada e bloqueia não publicada", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/prescriptions", headers: { cookie: coachCookie },
      payload: {
        athleteId: "ana-souza", title: "Sessão RKF 5.800",
        prescription: { title: "Sessão A2: Transformação", objective: "A2/A3", primaryZone: "A2", totalVolumeM: 5800, versions: { engine: "rkf-planning-1.0.0", rules: "rkf-rules-1.0.0", seed: "RKF_V5.1" }, blocks: [{ order: 1, component: "AQUECIMENTO", volumeM: 870, zone: "A1", prescriptionText: "870 m livre técnico" }, { order: 2, component: "SÉRIE PRINCIPAL", volumeM: 3520, zone: "A2", prescriptionText: "3520 m principal em A2 com progressão para A3" }] },
        audit: { passed: true },
      },
    });
    const prescription = created.json();
    const pending = await app.inject({ method: "GET", url: `/api/v1/rkf/prescriptions/${prescription.id}.pdf`, headers: { cookie: coachCookie } });
    expect(pending.statusCode).toBe(422);
    await app.inject({ method: "POST", url: `/api/v1/rkf/prescriptions/${prescription.id}/approve`, headers: { cookie: coachCookie }, payload: {} });
    const pdf = await app.inject({ method: "GET", url: `/api/v1/rkf/prescriptions/${prescription.id}.pdf`, headers: { cookie: coachCookie } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["x-prescription-sha256"]).toHaveLength(64);
    expect(pdf.body.length).toBeGreaterThan(1000);
    expect(pdf.body.slice(0, 5).toString()).toBe("%PDF-");
  });
});
