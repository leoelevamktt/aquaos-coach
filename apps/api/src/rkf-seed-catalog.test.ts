import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { login } from "./auth.js";
import { registerRkfSeedCatalogRoutes, seedCatalogSummary } from "./rkf-seed-catalog.js";

const app = Fastify({ logger: false });
registerRkfSeedCatalogRoutes(app);
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
const athleteCookie = `natacao_session=${(await login("ana@natacao.local", "natacao-demo"))!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe("catálogo auditável da seed RKF", () => {
  it("reconcilia os dez arquivos e as 15.246 linhas", () => {
    const summary = seedCatalogSummary();
    expect(summary).toMatchObject({ version: "RKF_V5.1", status: "INTEGRITY_PASS", totalRows: 15246, operationalFiles: 9, reviewFiles: 1 });
    expect(summary.files).toHaveLength(10);
    expect(summary.files.every((file) => file.integrity === "PASS" && file.sha256.length === 64)).toBe(true);
  });

  it("permite à comissão consultar e buscar qualquer linha preservada", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/rkf/seed/files/prescription_units.csv?limit=2&search=RKF-10-12-01", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ file: { name: "prescription_units.csv", rows: 6226, operational: false }, page: { limit: 2, returned: 2, total: 6226 } });
  });

  it("nega o catálogo metodológico ao perfil atleta e nomes fora da allowlist", async () => {
    const denied = await app.inject({ method: "GET", url: "/api/v1/rkf/seed/files", headers: { cookie: athleteCookie } });
    expect(denied.statusCode).toBe(403);
    const traversal = await app.inject({ method: "GET", url: "/api/v1/rkf/seed/files/..%2Fmanifest.json", headers: { cookie: coachCookie } });
    expect(traversal.statusCode).toBe(404);
  });
});
