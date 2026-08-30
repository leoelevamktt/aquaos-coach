import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login } from "./auth.js";
import { ManagedStore } from "./managed-store.js";
import { decisionRegister, registerRkfDecisionRoutes } from "./rkf-decisions.js";

const root = mkdtempSync(join(tmpdir(), "rkf-decisions-"));
const store = new ManagedStore(join(root, "data.json"));
const app = Fastify({ logger: false });
registerRkfDecisionRoutes(app, store);
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });

describe("registro formal de decisões", () => {
  it("mantém as doze decisões e bloqueia produção enquanto houver decisão crítica", () => {
    expect(decisionRegister(store)).toMatchObject({ revision: 1, status: "BLOCKED", summary: { total: 12, pass: 5, review: 5, blocked: 1, deferred: 1 } });
  });

  it("versiona uma decisão, exige evidência e rejeita revisão obsoleta", async () => {
    const changed = await app.inject({ method: "PATCH", url: "/api/v1/rkf/governance/decisions/DEC-11", headers: { cookie: coachCookie }, payload: { revision: 1, status: "REVIEW", decision: "Política submetida ao DPO para aprovação.", evidence: ["Documento de retenção versão 1 anexado à governança."] } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ revision: 2, status: "REVIEW", summary: { blocked: 0, review: 6 } });
    const stale = await app.inject({ method: "PATCH", url: "/api/v1/rkf/governance/decisions/DEC-10", headers: { cookie: coachCookie }, payload: { revision: 1, status: "PASS", decision: "Curadoria concluída e assinada.", evidence: ["Ata de homologação da comissão técnica."] } });
    expect(stale.statusCode).toBe(409);
  });
});
