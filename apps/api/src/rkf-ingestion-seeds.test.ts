import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerRkfRoutes } from "./rkf-routes.js";
import { ManagedStore } from "./managed-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login } from "./auth.js";
import { applyIngestionSeeds, INGESTION_CONTRACTS, INGESTION_SEEDS, PRODUCT_PLANS, plansForRole } from "./rkf-ingestion-seeds.js";

const app = Fastify({ logger: false });
const testRoot = mkdtempSync(join(tmpdir(), "rkf-seeds-"));
const store = new ManagedStore(join(testRoot, "rkf.json"));
await app.register(multipart);
registerRkfRoutes(app, store);
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
const athleteCookie = `natacao_session=${(await login("ana@natacao.local", "natacao-demo"))!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(testRoot, { recursive: true, force: true }); });

describe("G36 — seeds de ingestão idempotentes", () => {
  it("aplica as 6 seeds cobrindo 5 canais + cenário de erro", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/rkf/ingestions/apply-seeds", headers: { cookie: coachCookie }, payload: {} });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.seeds).toBe(6);
    expect(body.channels).toEqual(["TEXT", "PHOTO", "FILE", "VOICE", "API"]);
    expect(body.idempotent).toBe(true);
    // TEXT e FILE extraem; confiança baixa exige revisão
    const review = body.executions.find((execution: { seedId: string }) => execution.seedId === "seed-photo-prancheta");
    expect(review.requiresHumanReview).toBe(true);
  });

  it("reaplicar não duplica ingestões", async () => {
    const first = (await app.inject({ method: "POST", url: "/api/v1/rkf/ingestions/apply-seeds", headers: { cookie: coachCookie }, payload: {} })).json();
    const second = (await app.inject({ method: "POST", url: "/api/v1/rkf/ingestions/apply-seeds", headers: { cookie: coachCookie }, payload: {} })).json();
    expect(second.executions.every((execution: { alreadyPresent: boolean }) => execution.alreadyPresent)).toBe(true);
    for (let index = 0; index < first.executions.length; index += 1) {
      expect(second.executions[index].ingestionId).toBe(first.executions[index].ingestionId);
    }
  });

  it("seed com campos críticos pode ser confirmada (fluxo completo)", async () => {
    const applied = (await app.inject({ method: "POST", url: "/api/v1/rkf/ingestions/apply-seeds", headers: { cookie: coachCookie }, payload: {} })).json();
    const apiSeed = applied.executions.find((execution: { seedId: string }) => execution.seedId === "seed-api-json");
    const confirmed = await app.inject({ method: "POST", url: `/api/v1/rkf/ingestions/${apiSeed.ingestionId}/confirm`, headers: { cookie: coachCookie }, payload: {} });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ state: "CONFIRMED", reviewerId: "user-coach" });
  });

  it("atleta não aplica seeds", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/rkf/ingestions/apply-seeds", headers: { cookie: athleteCookie }, payload: {} });
    expect(response.statusCode).toBe(403);
  });

  it("applyIngestionSeeds isola por organização", () => {
    const executions = applyIngestionSeeds(store, "org-outra", "user-externo");
    expect(executions).toHaveLength(6);
    const orgDemo = store.list("ingestions").filter((item) => item.organizationId === "org-demo").length;
    const orgOutra = store.list("ingestions").filter((item) => item.organizationId === "org-outra").length;
    expect(orgDemo).toBeGreaterThan(0);
    expect(orgOutra).toBe(6);
  });
});

describe("G35 — contratos de ingestão nomeados", () => {
  it("expõe os 8 contratos com cenário e expectativa", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/rkf/ingestions/contracts" });
    expect(unauthenticated.statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/ingestions/contracts", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(8);
    const ids = body.contracts.map((contract: { id: string }) => contract.id);
    expect(ids).toEqual(["ING-RECEIVED", "ING-STORED", "ING-EXTRACTED", "ING-PARSED", "ING-REVIEW", "ING-CONFIRMED", "ING-COMMITTED", "ING-ERROR"]);
    expect(INGESTION_CONTRACTS.every((contract) => contract.scenario.length > 10 && contract.expects.length > 5)).toBe(true);
  });

  it("contratos mapeiam para cenários executáveis das seeds", () => {
    const scenarios = new Set(INGESTION_SEEDS.map((seed) => seed.scenario.split("+")).flat());
    for (const contractId of ["ING-RECEIVED", "ING-REVIEW", "ING-EXTRACTED", "ING-ERROR"]) {
      expect(scenarios.has(contractId)).toBe(true);
    }
  });
});

describe("G25 — quatro planos do produto", () => {
  it("expõe LOAD_ATHLETE, LOAD_TEAM, FULL_ATHLETE e FULL_TEAM com limites", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/plans", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.plans.map((plan: { id: string }) => plan.id)).toEqual(["LOAD_ATHLETE", "LOAD_TEAM", "FULL_ATHLETE", "FULL_TEAM"]);
    expect(body.availableToRole).toEqual(["LOAD_TEAM", "FULL_TEAM"]);
    const fullTeam = body.plans.find((plan: { id: string }) => plan.id === "FULL_TEAM");
    expect(fullTeam.limits.athletes).toBe(200);
    expect(fullTeam.limits.channels).toContain("VOICE");
    expect(fullTeam.entitlements).toContain("pdf:export");
  });

  it("atleta vê apenas planos de atleta", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/plans", headers: { cookie: athleteCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().availableToRole).toEqual(["LOAD_ATHLETE", "FULL_ATHLETE"]);
  });

  it("plansForRole separa audiências", () => {
    expect(plansForRole("athlete")).toEqual(["LOAD_ATHLETE", "FULL_ATHLETE"]);
    expect(plansForRole("coach")).toEqual(["LOAD_TEAM", "FULL_TEAM"]);
    expect(PRODUCT_PLANS).toHaveLength(4);
  });
});

describe("gates com nova evidência", () => {
  it("G25, G35 e G36 passam após aplicar seeds", async () => {
    await app.inject({ method: "POST", url: "/api/v1/rkf/ingestions/apply-seeds", headers: { cookie: coachCookie }, payload: {} });
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/release-gates", headers: { cookie: coachCookie } });
    const gates = response.json().gates;
    expect(gates.find((gate: { id: string }) => gate.id === "G25").status).toBe("PASS");
    expect(gates.find((gate: { id: string }) => gate.id === "G35").status).toBe("PASS");
    expect(gates.find((gate: { id: string }) => gate.id === "G36").status).toBe("PASS");
  });
});
