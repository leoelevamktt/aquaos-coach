import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManagedStore } from "./managed-store.js";
import { registerReportRoutes } from "./report-routes.js";
import { login } from "./auth.js";

const root = mkdtempSync(join(tmpdir(), "rkf-report-"));
const app = Fastify({ logger: false });
const store = new ManagedStore(join(root, "store.json"));
store.create("activities", { athleteId: "ana-souza", title: "Sessão A2", date: "2026-08-30", executedVolumeM: 6000, pse: 7, zone: "A2", organizationId: "org-demo" });
registerReportRoutes(app, store);
const coachCookie = `natacao_session=${login("coach@natacao.local", "natacao-demo")!.token}`;
const athleteCookie = `natacao_session=${login("ana@natacao.local", "natacao-demo")!.token}`;
beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });

describe("relatórios auditáveis", () => {
  it("gera PDF real com hash e identidade RKF", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/reports/athletes/ana-souza.pdf", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["x-report-sha256"]).toHaveLength(64);
    expect(response.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(response.rawPayload.length).toBeGreaterThan(2000);
  });

  it("entrega CSV do mesmo snapshot e protege prontuário", async () => {
    const csv = await app.inject({ method: "GET", url: "/api/v1/reports/athletes/ana-souza.csv", headers: { cookie: athleteCookie } });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("volume_m");
    const denied = await app.inject({ method: "GET", url: "/api/v1/reports/athletes/caio-martins.pdf", headers: { cookie: athleteCookie } });
    expect(denied.statusCode).toBe(403);
  });
});
