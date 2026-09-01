import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { login } from "./auth.js";
import { registerCoachAutomationRoutes } from "./coach-automation.js";
import { ManagedStore } from "./managed-store.js";

const root = mkdtempSync(join(tmpdir(), "rkf-automation-"));
const store = new ManagedStore(join(root, "data.json"));
const app = Fastify({ logger: false });
registerCoachAutomationRoutes(app, store);
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
const athleteCookie = `natacao_session=${(await login("ana@natacao.local", "natacao-demo"))!.token}`;

beforeAll(async () => app.ready());
afterAll(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });

describe("motor adaptativo da comissão técnica", () => {
  it("gera uma fila explicável e restrita ao treinador", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/coach/automation", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().proposals).toHaveLength(4);
    expect(response.json().counts.requiringApproval).toBeGreaterThan(0);
    expect(response.json().engineVersion).toMatch(/^rkf-coach-automation-/);

    const denied = await app.inject({ method: "GET", url: "/api/v1/coach/automation", headers: { cookie: athleteCookie } });
    expect(denied.statusCode).toBe(403);
  });

  it("reage ao check-in e substitui a recomendação anterior sem duplicar a fila", async () => {
    store.create("athleteResponses", { athleteId: "ana-souza", date: new Date().toISOString().slice(0, 10), sleepHours: 4.5, fatigue: 9, soreness: 7, pain: 6, organizationId: "org-demo" });
    const response = await app.inject({ method: "GET", url: "/api/v1/coach/automation", headers: { cookie: coachCookie } });
    const proposals = response.json().proposals as Array<{ athleteId: string; priority: string; action: string }>;
    const ana = proposals.filter((item) => item.athleteId === "ana-souza");
    expect(ana).toHaveLength(1);
    expect(ana[0]).toMatchObject({ priority: "CRITICAL", action: "BLOCK_INTENSITY" });
    expect(store.get("athletes", "ana-souza")?.automationState).toBe("RISK");
  });

  it("converte aprovação crítica em rascunho individual, sem publicar silenciosamente", async () => {
    const snapshot = await app.inject({ method: "GET", url: "/api/v1/coach/automation", headers: { cookie: coachCookie } });
    const proposal = (snapshot.json().proposals as Array<{ id: string; athleteId: string }>).find((item) => item.athleteId === "ana-souza")!;
    const response = await app.inject({ method: "POST", url: `/api/v1/coach/automation/proposals/${proposal.id}/approve`, headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().proposal.status).toBe("APPROVED");
    expect(response.json().draft).toMatchObject({ status: "draft", source: "coach-automation", athleteId: "ana-souza", requiresPublication: true });
    expect(store.list("workouts").filter((item) => item.automationProposalId === proposal.id && item.status === "published")).toHaveLength(0);
    const approved = store.get("adaptationDecisions", proposal.id)!;
    store.create("adaptationDecisions", { ...approved, id: "legacy-duplicate", status: "PROPOSED", approvedAt: undefined, approvedBy: undefined });
    await app.inject({ method: "POST", url: "/api/v1/coach/automation/recompute", headers: { cookie: coachCookie } });
    expect(store.list("adaptationDecisions").filter((item) => item.athleteId === "ana-souza" && item.status === "PROPOSED")).toHaveLength(0);
    expect(store.get("adaptationDecisions", "legacy-duplicate")?.supersededReason).toBe("DUPLICATE_AFTER_RESOLUTION");
  });

  it("exige justificativa para manter o plano", async () => {
    const snapshot = await app.inject({ method: "GET", url: "/api/v1/coach/automation", headers: { cookie: coachCookie } });
    const proposal = snapshot.json().proposals[0] as { id: string };
    const response = await app.inject({ method: "POST", url: `/api/v1/coach/automation/proposals/${proposal.id}/dismiss`, headers: { cookie: coachCookie }, payload: {} });
    expect(response.statusCode).toBe(400);
  });
});
