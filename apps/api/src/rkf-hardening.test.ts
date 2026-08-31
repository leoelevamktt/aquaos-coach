import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerRkfRoutes } from "./rkf-routes.js";
import { ManagedStore } from "./managed-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login } from "./auth.js";
import { DOMAIN_EVENT_CONTRACTS, validateEventPayload } from "./domain-events.js";
import { MIGRATIONS } from "./migrations.js";

const app = Fastify({ logger: false });
const testRoot = mkdtempSync(join(tmpdir(), "rkf-hardening-"));
const store = new ManagedStore(join(testRoot, "rkf.json"));
await app.register(multipart);
registerRkfRoutes(app, store);
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
const athleteCookie = `natacao_session=${(await login("ana@natacao.local", "natacao-demo"))!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(testRoot, { recursive: true, force: true }); });

describe("catálogo de eventos de domínio (G08)", () => {
  it("expõe catálogo versionado com pelo menos os 33 contratos do manual", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/events", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBeGreaterThanOrEqual(33);
    expect(body.catalogVersion).toBe("rkf-events-1.0.0");
    expect(new Set(body.events.map((event: { name: string }) => event.name)).size).toBe(body.total);
  });

  it("bloqueia consulta sem autenticação", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/events" });
    expect(response.statusCode).toBe(401);
  });

  it("valida carga mínima e rejeita contrato inexistente", () => {
    const valid = validateEventPayload("seed.imported", { importId: "imp-1", packageHash: "abc", rows: 15246 });
    expect(valid.valid).toBe(true);
    const missing = validateEventPayload("seed.imported", { importId: "imp-1" });
    expect(missing.valid).toBe(false);
    expect(missing.missing).toEqual(["packageHash", "rows"]);
    const unknown = validateEventPayload("evento.inexistente" as never, {});
    expect(unknown.valid).toBe(false);
  });

  it("eventos de governança e backup não são atribuídos a atleta", () => {
    const adminOnly = ["governance.decision.versioned", "backup.created", "backup.restored", "athlete.anonymized"];
    for (const name of adminOnly) {
      expect(["coach", "admin"]).toContain(DOMAIN_EVENT_CONTRACTS.find((event) => event.name === name)?.actor);
    }
  });
});

describe("migrations versionadas (G05)", () => {
  it("declara rollback para todas as migrations", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    expect(MIGRATIONS.slice(6)).toHaveLength(25);
    for (const migration of MIGRATIONS) {
      expect(migration.id).toMatch(/^\d{4}_/);
      expect(migration.down).toBeTruthy();
      expect(migration.description).toBeTruthy();
    }
  });

  it("tem IDs únicos e ordenados", () => {
    const ids = MIGRATIONS.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it("expõe status pela rota protegida (driver arquivo = nota explicativa)", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/rkf/migrations" });
    expect(unauthenticated.statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/migrations", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.migrations).toMatchObject({ applied: [], pending: [], total: 0 });
    expect(body.note ?? body.migrations).toBeTruthy();
  });
});

describe("isolamento entre organizações (tenant isolation)", () => {
  it("coach da org-demo não vê ingestões de outra organização", async () => {
    // Cria ingestão diretamente no store com organizationId estrangeira
    store.create("ingestions", { id: "ing-org-estrangeira", organizationId: "org-invasora", channel: "TEXT", title: "Sessão de outro clube", state: "REVIEW", original: "8x100 A2" });
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/ingestions", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    const ids = response.json().data.map((ingestion: { id: string }) => ingestion.id);
    expect(ids).not.toContain("ing-org-estrangeira");
  });

  it("prescrições de outra organização não aparecem na listagem do coach", async () => {
    store.create("prescriptions", { id: "presc-org-estrangeira", organizationId: "org-invasora", athleteId: "x", title: "Prescrição alheia", status: "PENDING_APPROVAL" });
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/prescriptions", headers: { cookie: coachCookie } });
    const ids = response.json().data.map((prescription: { id: string }) => prescription.id);
    expect(ids).not.toContain("presc-org-estrangeira");
  });

  it("resultados de outra organização ficam fora do prontuário", async () => {
    store.create("results", { id: "res-org-estrangeira", organizationId: "org-invasora", athleteId: "ana-souza", event: "200 m", date: "2026-08-30" });
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/results/athletes/ana-souza", headers: { cookie: coachCookie } });
    const ids = response.json().data.map((result: { id: string }) => result.id);
    expect(ids).not.toContain("res-org-estrangeira");
  });

  it("LGPD export isola por organização: atleta de outra org não é encontrado", async () => {
    store.create("athletes", { id: "atleta-invasor", organizationId: "org-invasora", name: "Atleta Outro Clube" });
    const response = await app.inject({ method: "GET", url: "/api/v1/lgpd/athletes/atleta-invasor/export", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(404);
  });
});

describe("LGPD: portabilidade e anonimização", () => {
  it("exporta todos os dados do próprio atleta via sessão athlete", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/lgpd/athletes/ana-souza/export", headers: { cookie: athleteCookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.basis).toContain("LGPD");
    expect(body.athlete).toMatchObject({ id: "ana-souza" });
    expect(body.exportedAt).toBeTruthy();
  });

  it("atleta não exporta dados de outro atleta", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/lgpd/athletes/caio-martins/export", headers: { cookie: athleteCookie } });
    expect(response.statusCode).toBe(403);
  });

  it("anonimização exige coach e base legal, e preserva métricas", async () => {
    const denied = await app.inject({
      method: "POST", url: "/api/v1/lgpd/athletes/pedro-lima/anonymize", headers: { cookie: athleteCookie },
      payload: { requestedBy: "dpo@exemplo.com", lgpdBasis: "CONSENTIMENTO" },
    });
    expect(denied.statusCode).toBe(403);
    const invalid = await app.inject({
      method: "POST", url: "/api/v1/lgpd/athletes/pedro-lima/anonymize", headers: { cookie: coachCookie },
      payload: { requestedBy: "não é email", lgpdBasis: "CONSENTIMENTO" },
    });
    expect(invalid.statusCode).toBe(400);
    const response = await app.inject({
      method: "POST", url: "/api/v1/lgpd/athletes/pedro-lima/anonymize", headers: { cookie: coachCookie },
      payload: { requestedBy: "dpo@natacao.example", lgpdBasis: "DIREITOS_TITULAR" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.athlete).toMatchObject({ status: "anonymized", lgpdBasis: "DIREITOS_TITULAR" });
    expect(body.athlete.name).toContain("anonimizado");
    expect(body.athlete.email).toBeUndefined();
  });
});

describe("backup lógico (evidência de recuperação)", () => {
  it("cria, verifica e lista backup no driver arquivo sem fingir Postgres", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/backup", headers: { cookie: coachCookie }, payload: {} });
    expect(response.statusCode).toBe(201);
    const backup = response.json();
    expect(backup).toMatchObject({ id: expect.stringMatching(/^backup-/), checksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const verified = await app.inject({ method: "GET", url: `/api/v1/backup/${backup.id}/verify`, headers: { cookie: coachCookie } });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ valid: true, checksum: backup.checksum });
    const listed = await app.inject({ method: "GET", url: "/api/v1/backup", headers: { cookie: coachCookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().backups).toEqual(expect.arrayContaining([expect.objectContaining({ id: backup.id, valid: true })]));
    const dryRun = await app.inject({ method: "POST", url: `/api/v1/backup/${backup.id}/restore`, headers: { cookie: coachCookie }, payload: { apply: false } });
    expect(dryRun.statusCode).toBe(403);
  });

  it("atleta não cria backup", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/backup", headers: { cookie: athleteCookie }, payload: {} });
    expect(response.statusCode).toBe(403);
  });
});

describe("UATs remanescentes do manual", () => {
  it("UAT-04: volume real diferente recalcula aderência sem alterar o prescrito", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/load/sessions",
      payload: { sessions: [{ athleteId: "ana-souza", date: "2026-08-29", pse: 7, durationMinutes: 90, prescribedVolumeM: 3500, executedVolumeM: 3400, expectedPse: 6 }] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Prescrito intocado; executado separado; aderência derivada
    expect(body.layers.prescribed.volumeM).toBe(3500);
    expect(body.layers.executed.volumeM).toBe(3400);
    expect(body.layers.internal.loadUa).toBe(630);
    expect(body.adherence.volumeAdherencePct).toBeCloseTo(97.14, 1);
    expect(body.adherence.pseDeviation).toBe(1);
  });

  it("UAT-07: atleta não edita regra nem aprova prescrição", async () => {
    // Atleta não pode aprovar/publicar prescrição (única via de mudança metodológica publicável)
    const created = await app.inject({
      method: "POST", url: "/api/v1/rkf/prescriptions", headers: { cookie: coachCookie },
      payload: { athleteId: "ana-souza", title: "Sessão protegida", prescription: { totalVolumeM: 5000 }, audit: { passed: true } },
    });
    const denied = await app.inject({ method: "POST", url: `/api/v1/rkf/prescriptions/${created.json().id}/approve`, headers: { cookie: athleteCookie }, payload: {} });
    expect(denied.statusCode).toBe(403);
    // Atleta não acessa gates de release nem decisões de governança via escrita
    const migrations = await app.inject({ method: "GET", url: "/api/v1/rkf/migrations", headers: { cookie: athleteCookie } });
    expect(migrations.statusCode).toBe(403);
  });

  it("UAT-09: blocos que não fecham no volume impedem prescrição publicável", async () => {
    // Volume não múltiplo de 10 é rejeitado pelo validador (VAL-001)
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/sessions/compose",
      payload: {
        athlete: { athleteId: "ath-16", age: 16, developmentLevel: "rendimento", specialty: "meio_fundo", poolLengthM: 25 },
        request: { phase: "BASE", objective: "A2", primaryZone: "A2", targetVolumeM: 5805, rdcMarker: false },
      },
    });
    expect([400, 422]).toContain(response.statusCode);
  });

  it("UAT-10: candidato com violação HARD é eliminado pelo motor", async () => {
    // VALAT exige volumes curtos: alvo enorme em VALAT viola hard rule e falha a auditoria
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/sessions/compose",
      payload: {
        athlete: { athleteId: "ath-16", age: 16, developmentLevel: "rendimento", specialty: "velocidade", poolLengthM: 25 },
        request: { phase: "BASE", objective: "velocidade", primaryZone: "VALAT", targetVolumeM: 5000, rdcMarker: false },
      },
    });
    expect([201, 422]).toContain(response.statusCode);
    expect(response.json().audit.passed).toBe(false);
  });

  it("UAT-11: dados insuficientes não interpretam ATL/CTL (cold start)", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/rkf/load/sessions",
      payload: { sessions: [{ athleteId: "novato", date: "2026-08-29", pse: 5, durationMinutes: 60 }] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.coldStart.stage).toBe("CS0");
    expect(body.coldStart.confidence).toBeLessThan(0.3);
  });
});

describe("biblioteca operacional com prescription_units e auditorias", () => {
  it("stats da biblioteca incluem unidades, atomização e reconciliação", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/sessions?limit=1", headers: { cookie: coachCookie } });
    const stats = response.json().stats;
    expect(stats.prescriptionUnits).toBe(6226);
    expect(stats.normalizationAudits).toBe(910);
    expect(stats.volumeReconciliations).toBe(910);
    expect(stats.volumeMismatched).toBe(0);
  });

  it("sessão detalhada expõe unidades por bloco e auditoria de volume", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/rkf/sessions?limit=1", headers: { cookie: coachCookie } });
    const first = list.json().data[0];
    const detail = await app.inject({ method: "GET", url: `/api/v1/rkf/sessions/${first.id}`, headers: { cookie: coachCookie } });
    expect(detail.statusCode).toBe(200);
    const session = detail.json();
    expect(session.normalization).toMatchObject({ status: expect.any(String) });
    expect(session.volumeAudit).toMatchObject({ reconciled: true });
    const withUnits = session.blocks.find((block: { units?: unknown[] }) => (block.units ?? []).length > 0);
    expect(withUnits).toBeTruthy();
    expect(withUnits.units[0]).toMatchObject({ setId: expect.stringMatching(/-S\d+$/), executable: expect.any(Boolean) });
  });
});
