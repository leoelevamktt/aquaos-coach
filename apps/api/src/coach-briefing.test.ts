import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachAuthStore, login } from "./auth.js";
import { registerAiRoutes } from "./ai-routes.js";
import { registerCoachBriefingRoutes } from "./coach-briefing-routes.js";
import { ManagedStore } from "./managed-store.js";

const root = mkdtempSync(join(tmpdir(), "coach-briefing-"));
const store = new ManagedStore(join(root, "store.json"));
attachAuthStore(store);
delete process.env.LLM_API_KEY; // garante llmUsed false / narrative = rationale no teste
const app = Fastify({ logger: false });
registerAiRoutes(app, store);
registerCoachBriefingRoutes(app, store);
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;
const athleteCookie = `natacao_session=${(await login("ana@natacao.local", "natacao-demo"))!.token}`;

beforeAll(async () => app.ready());
afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("briefing do coach", () => {
  it("exige papel da comissão técnica", async () => {
    const denied = await app.inject({ method: "GET", url: "/api/v1/coach/briefing", headers: { cookie: athleteCookie } });
    expect(denied.statusCode).toBe(403);
  });

  it("agrega o dia com dados reais do store", async () => {
    const workout = store.create("workouts", {
      title: "Sessão de qualidade",
      date: coachToday(),
      scheduledAt: `${coachToday()}T08:00`,
      distanceMeters: 3400,
      zone: "A2",
      status: "published",
      organizationId: "org-demo",
    });
    store.create("prescriptions", {
      workoutId: workout.id,
      athleteId: "ana-souza",
      title: "Sessão do briefing",
      targetType: "athlete",
      targetId: "ana-souza",
      status: "PUBLISHED",
      organizationId: "org-demo",
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/coach/briefing", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(200);
    const briefing = response.json();
    expect(briefing.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(briefing.date).toBe(coachToday());
    // métricas derivam do seed: 4 atletas ativos, média de readiness real
    expect(briefing.metrics.activeAthletes).toBe(activeAthletesCount());
    expect(briefing.metrics.averageReadiness).toBeGreaterThan(0);
    expect(briefing.todaySessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Sessão de qualidade",
        volumeMeters: 3400,
        zone: "A2",
        targetType: "athlete",
        targetId: "ana-souza",
        time: "08:00",
        prescriptionId: expect.any(String),
      }),
    ]));
    // Luiza tem readiness 58 no seed (< 60) → insight derivado de dado real
    const lowReadiness = briefing.insights.find((insight: { id: string }) => insight.id === "insight-readiness-luiza-costa");
    expect(lowReadiness).toBeTruthy();
    expect(lowReadiness.title).toContain("Luiza Costa");
    expect(lowReadiness.title).toContain("58");
    // load sem activities reais → fonte "none" e números nulos (nada inventado)
    expect(briefing.load.acute).toBeNull();
    expect(briefing.load.chronic).toBeNull();
    expect(briefing.load.acwr).toBeNull();
    expect(briefing.load.source).toBe("none");
    expect(briefing.load.weeklyHistory).toHaveLength(8);
    expect(briefing.load.weeklyHistory.every((week: { volumeMeters: number }) => week.volumeMeters === 0)).toBe(true);
  });
});

describe("geração de treinos por IA", () => {
  it("compõe prescrição determinística com blocos RKF e narrativa do engine sem LLM", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ai/generate-workout",
      headers: { cookie: coachCookie },
      payload: { athleteIds: ["ana-souza"], primaryZone: "A2", targetVolumeM: 3000 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBeDefined();
    expect(body.suggestions).toHaveLength(1);
    const suggestion = body.suggestions[0];
    expect(suggestion.athleteId).toBe("ana-souza");
    expect(suggestion.workout.sportContext).toBe("pool");
    // Estrutura RKF: seis componentes explícitos (R010)
    expect(suggestion.workout.blocks).toHaveLength(6);
    const total = suggestion.workout.blocks.reduce((sum: number, block: { steps: Array<{ distanceMeters?: number; repetitions: number }>; repeatCount: number }) => sum + block.steps.reduce((sum, step) => sum + (step.distanceMeters ?? 0) * step.repetitions, 0) * block.repeatCount, 0);
    expect(total).toBeGreaterThanOrEqual(2700);
    expect(total).toBeLessThanOrEqual(3300);
    expect(suggestion.engine.audit).toBeTruthy();
    expect(suggestion.llmUsed).toBe(false);
    expect(suggestion.narrative).toBe(suggestion.engine.rationale.join(" "));
    expect(suggestion.publish).toEqual({ targetType: "athlete", targetId: "ana-souza" });
  });

  it("gera para a equipe inteira com prescrições auditáveis", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ai/generate-workout",
      headers: { cookie: coachCookie },
      payload: { targetVolumeM: 3000, useNarrativeLlm: false },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.suggestions.length).toBeGreaterThanOrEqual(1);
    const covered = new Set(body.suggestions.flatMap((suggestion: { athleteIds?: string[]; athleteId: string }) => suggestion.athleteIds ?? [suggestion.athleteId]));
    expect(covered.size).toBe(activeAthletesCount());
    for (const suggestion of body.suggestions) {
      expect(suggestion.workout.blocks.length).toBeGreaterThan(0);
    }
  });

  it("rejeita atleta inexistente e acesso de atleta comum", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/ai/generate-workout",
      headers: { cookie: coachCookie },
      payload: { athleteIds: ["atleta-fantasma"] },
    });
    expect(missing.statusCode).toBe(404);

    const forbidden = await app.inject({ method: "POST", url: "/api/v1/ai/generate-workout", headers: { cookie: athleteCookie }, payload: {} });
    expect(forbidden.statusCode).toBe(403);
    const briefingForbidden = await app.inject({ method: "GET", url: "/api/v1/coach/briefing", headers: { cookie: athleteCookie } });
    expect(briefingForbidden.statusCode).toBe(403);
  });
});

function activeAthletesCount() {
  return store.list("athletes").filter((athlete) => athlete.status === "active").length;
}

function coachToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
