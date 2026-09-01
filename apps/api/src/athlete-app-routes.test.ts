import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachAuthStore, login } from "./auth.js";
import { registerAthleteAppRoutes } from "./athlete-app-routes.js";
import { ManagedStore } from "./managed-store.js";
import { DemoStore } from "./store.js";

const root = mkdtempSync(join(tmpdir(), "athlete-app-"));
const store = new ManagedStore(join(root, "store.json"));
attachAuthStore(store);
const app = Fastify({ logger: false });
registerAthleteAppRoutes(app, store, new DemoStore());
const athleteCookie = `natacao_session=${(await login("ana@natacao.local", "natacao-demo"))!.token}`;
const coachCookie = `natacao_session=${(await login("coach@natacao.local", "natacao-demo"))!.token}`;

beforeAll(async () => app.ready());
afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("app do atleta", () => {
  it("agrega apenas o prontuário do atleta autenticado", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/athlete/app?date=2026-09-01", headers: { cookie: athleteCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      athlete: { id: "ana-souza", name: "Ana Souza" },
      date: "2026-09-01",
      phase: {
        totalWeeks: 7,
        endsOn: "2026-09-18",
        targetMeet: "Troféu Brasil - José Finkel",
      },
      today: { status: "check-in-pending" },
    });
    expect(response.json().today.session.blocks.length).toBeGreaterThan(0);
  });

  it("ignora prescrições publicadas para outro atleta", async () => {
    const workout = store.create("workouts", {
      title: "Sessão de outro atleta",
      date: "2026-09-01",
      distanceMeters: 9000,
      zone: "AN1",
      status: "published",
      organizationId: "org-demo",
    });
    store.create("prescriptions", {
      workoutId: workout.id,
      athleteId: "caio-martins",
      targetType: "athlete",
      targetId: "caio-martins",
      status: "PUBLISHED",
      organizationId: "org-demo",
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/athlete/app?date=2026-09-01", headers: { cookie: athleteCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().today.session.title).not.toBe("Sessão de outro atleta");
    expect(response.json().week.sessions).not.toContainEqual(expect.objectContaining({ id: workout.id }));
  });

  it("impede comissão técnica de usar o contexto do atleta", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/athlete/app", headers: { cookie: coachCookie } });
    expect(response.statusCode).toBe(403);
  });

  it("faz upsert do check-in diário", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/athlete/check-in",
      headers: { cookie: athleteCookie },
      payload: { date: "2026-09-01", psr: 8, sleepHours: 7.5, pain: 1, feelings: ["Corpo leve"] },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/athlete/check-in",
      headers: { cookie: athleteCookie },
      payload: { date: "2026-09-01", psr: 6, sleepHours: 6.5, pain: 2, feelings: ["Cansada"] },
    });
    expect(second.statusCode).toBe(200);
    expect(store.list("athleteResponses").filter((item) => item.athleteId === "ana-souza" && item.date === "2026-09-01")).toHaveLength(1);
    expect(second.json()).toMatchObject({ psr: 6, sleepHours: 6.5, pain: 2 });
  });

  it("persiste resultados reais por repetição", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/athlete/results",
      headers: { cookie: athleteCookie },
      payload: {
        date: "2026-09-01",
        event: "200 m Livre",
        sessionDistanceM: 400,
        durationMinutes: 8,
        pse: 7,
        protocol: "2x200 A2",
        sets: [{
          set: 1,
          label: "2x200 A2",
          zone: "A2",
          repetitions: [
            { repetition: 1, distanceM: 200, timeSeconds: 128, stroke: "livre", splits: [] },
            { repetition: 2, distanceM: 200, timeSeconds: 127.5, stroke: "livre", splits: [] },
          ],
        }],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ athleteId: "ana-souza", bestTimeSeconds: 127.5, averageTimeSeconds: 127.75 });
    expect(store.list("repetitionResults").filter((item) => item.resultId === response.json().id)).toHaveLength(2);
  });

  it("conclui uma execução uma única vez", async () => {
    const payload = {
      date: "2026-09-01",
      prescriptionId: "prescription-1",
      distanceMeters: 4200,
      durationMinutes: 60,
      pse: 7,
      pain: 1,
      completedSteps: 4,
      totalSteps: 4,
    };
    const first = await app.inject({ method: "POST", url: "/api/v1/athlete/checkout", headers: { cookie: athleteCookie }, payload });
    const second = await app.inject({ method: "POST", url: "/api/v1/athlete/checkout", headers: { cookie: athleteCookie }, payload: { ...payload, pse: 6 } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(store.list("sessionExecutions").filter((item) => item.athleteId === "ana-souza" && item.date === "2026-09-01")).toHaveLength(1);
    expect(store.list("loadSnapshots").find((item) => item.externalId === "athlete-app:ana-souza:prescription-1")).toMatchObject({ value: 360 });
  });
});
