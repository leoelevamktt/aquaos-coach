import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachAuthStore, login } from "./auth.js";
import { registerAthleteAppRoutes } from "./athlete-app-routes.js";
import { ManagedStore } from "./managed-store.js";
import { registerRkfRoutes } from "./rkf-routes.js";
import { DemoStore } from "./store.js";

const root = mkdtempSync(join(tmpdir(), "athlete-app-"));
const store = new ManagedStore(join(root, "store.json"));
attachAuthStore(store);
const app = Fastify({ logger: false });
registerAthleteAppRoutes(app, store, new DemoStore());
registerRkfRoutes(app, store);
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

  it("rejeita datas de calendário impossíveis", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/athlete/app?date=2026-99-99",
      headers: { cookie: athleteCookie },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Data inválida" });
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

  it("mantém somente a prescrição mais recente e conclui apenas a sessão correspondente", async () => {
    const firstWorkout = store.create("workouts", {
      title: "Primeira sessão",
      date: "2026-09-02",
      distanceMeters: 1000,
      zone: "A2",
      status: "published",
      organizationId: "org-demo",
    });
    const secondWorkout = store.create("workouts", {
      title: "Segunda sessão",
      date: "2026-09-02",
      distanceMeters: 2000,
      zone: "AN1",
      status: "published",
      organizationId: "org-demo",
    });
    const previousPrescription = store.create("prescriptions", {
      workoutId: firstWorkout.id,
      targetType: "athlete",
      targetId: "ana-souza",
      status: "PUBLISHED",
      publishedAt: "2026-09-01T10:00:00.000Z",
      organizationId: "org-demo",
    });
    const activePrescription = store.create("prescriptions", {
      workoutId: firstWorkout.id,
      targetType: "athlete",
      targetId: "ana-souza",
      status: "PUBLISHED",
      publishedAt: "2026-09-01T11:00:00.000Z",
      organizationId: "org-demo",
    });
    store.create("prescriptions", {
      workoutId: secondWorkout.id,
      targetType: "athlete",
      targetId: "ana-souza",
      status: "PUBLISHED",
      publishedAt: "2026-09-01T11:00:00.000Z",
      organizationId: "org-demo",
    });
    store.create("sessionExecutions", {
      athleteId: "ana-souza",
      prescriptionId: previousPrescription.id,
      sessionId: firstWorkout.id,
      date: "2026-09-02",
      distanceMeters: 1000,
      organizationId: "org-demo",
    });

    const beforeCurrentExecution = await app.inject({
      method: "GET",
      url: "/api/v1/athlete/app?date=2026-09-02",
      headers: { cookie: athleteCookie },
    });

    expect(beforeCurrentExecution.statusCode).toBe(200);
    expect(beforeCurrentExecution.json().week.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstWorkout.id, completed: false }),
      ]),
    );

    store.create("sessionExecutions", {
      athleteId: "ana-souza",
      prescriptionId: activePrescription.id,
      sessionId: firstWorkout.id,
      date: "2026-09-02",
      distanceMeters: 1000,
      organizationId: "org-demo",
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/athlete/app?date=2026-09-02",
      headers: { cookie: athleteCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().week).toMatchObject({
      plannedMeters: 3000,
      plannedSessions: 2,
    });
    expect(response.json().week.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstWorkout.id, completed: true }),
      expect.objectContaining({ id: secondWorkout.id, completed: false }),
    ]));
  });

  it("aplica a piscina e a personalização destinadas ao atleta", async () => {
    const workout = store.create("workouts", {
      title: "Sessão-base",
      date: "2026-09-03",
      poolId: "pool-25",
      distanceMeters: 1000,
      zone: "A2",
      blocks: [{
        id: "base-block",
        name: "Série-base",
        order: 1,
        repeatCount: 1,
        steps: [{
          id: "base-step",
          order: 1,
          kind: "main",
          repetitions: 10,
          distanceMeters: 100,
          stroke: "freestyle",
          targetType: "pace",
          targetValue: "ritmo-base",
          equipment: [],
        }],
      }],
      status: "published",
      organizationId: "org-demo",
    });
    store.create("prescriptions", {
      workoutId: workout.id,
      targetType: "team",
      targetId: "org-demo",
      athleteOverrides: [{
        athleteId: "ana-souza",
        changedFields: {
          title: "Sessão personalizada",
          blocks: [{
            id: "personalized-block",
            name: "Série personalizada",
            order: 1,
            repeatCount: 1,
            steps: [{
              id: "personalized-step",
              order: 1,
              kind: "main",
              repetitions: 12,
              distanceMeters: 100,
              stroke: "freestyle",
              targetType: "pace",
              targetValue: "ritmo personalizado",
              equipment: [],
            }],
          }],
        },
      }],
      status: "PUBLISHED",
      publishedAt: "2026-09-01T12:00:00.000Z",
      organizationId: "org-demo",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/athlete/app?date=2026-09-03",
      headers: { cookie: athleteCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().today.session).toMatchObject({
      id: workout.id,
      title: "Sessão personalizada",
      poolLengthM: 25,
      volumeMeters: 1200,
      blocks: [{
        id: "personalized-block",
        steps: [{ target: "ritmo personalizado" }],
      }],
    });
    const session = response.json().today.session;
    const result = await app.inject({
      method: "POST",
      url: "/api/v1/athlete/results",
      headers: { cookie: athleteCookie },
      payload: {
        date: session.date,
        prescriptionId: session.prescriptionId,
        sessionId: session.id,
        kind: "training",
        event: session.title,
        poolLengthM: session.poolLengthM,
        sessionDistanceM: session.volumeMeters,
        durationMinutes: 30,
        pse: 6,
        sets: [{
          set: 1,
          label: "Série personalizada",
          repetitions: [{
            repetition: 1,
            distanceM: 100,
            timeSeconds: 70,
            stroke: "livre",
            splits: [],
          }],
        }],
      },
    });
    expect(result.statusCode).toBe(201);
    expect(result.json()).toMatchObject({ poolLengthM: 25 });
  });

  it("inclui uma prescrição RKF aprovada sem workout vinculado", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/rkf/prescriptions",
      headers: { cookie: coachCookie },
      payload: {
        athleteId: "ana-souza",
        title: "Sessão RKF aprovada",
        prescription: {
          id: "rkf-session-approved",
          title: "Sessão RKF A2",
          objective: "Sustentar ritmo aeróbio",
          date: "2026-09-04",
          poolLengthM: 25,
          primaryZone: "A2",
          totalVolumeM: 1800,
          blocks: [{
            order: 1,
            component: "SÉRIE PRINCIPAL",
            volumeM: 1800,
            zone: "A2",
            prescriptionText: "18x100 m em A2",
            materials: ["PULL"],
          }],
        },
        audit: { passed: true },
      },
    });
    expect(created.statusCode).toBe(201);
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/rkf/prescriptions/${created.json().id}/approve`,
      headers: { cookie: coachCookie },
      payload: {},
    });
    expect(approved.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/athlete/app?date=2026-09-04",
      headers: { cookie: athleteCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().today.session).toMatchObject({
      id: "rkf-session-approved",
      prescriptionId: created.json().id,
      title: "Sessão RKF A2",
      date: "2026-09-04",
      poolLengthM: 25,
      volumeMeters: 1800,
      zone: "A2",
      blocks: [{
        title: "SÉRIE PRINCIPAL",
        volumeMeters: 1800,
        steps: [{
          target: "A2",
          equipment: ["PULL"],
          notes: "18x100 m em A2",
        }],
      }],
    });
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

  it("persiste a data real de um resultado retrospectivo", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/athlete/results",
      headers: { cookie: athleteCookie },
      payload: {
        date: "2026-08-20",
        meetId: "trofeu-brasil",
        kind: "competition",
        event: "100 m Livre",
        poolLengthM: 50,
        sessionDistanceM: 100,
        durationMinutes: 1,
        pse: 8,
        sets: [{
          set: 1,
          label: "Resultado oficial",
          repetitions: [{
            repetition: 1,
            distanceM: 100,
            timeSeconds: 55.2,
            stroke: "livre",
            splits: [],
          }],
        }],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      date: "2026-08-20",
      kind: "competition",
      meetId: "trofeu-brasil",
    });
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

  it("mantém checkout noturno no dia local de São Paulo", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/athlete/checkout",
      headers: { cookie: athleteCookie },
      payload: {
        prescriptionId: "prescription-evening",
        endedAt: "2026-09-02T01:30:00.000Z",
        distanceMeters: 2000,
        durationMinutes: 40,
        pse: 5,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      execution: { date: "2026-09-01" },
    });
  });
});
