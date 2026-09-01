import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { WorkoutBlock, WorkoutTemplate } from "@natacao/domain";
import { getSession, sessionToken } from "./auth.js";
import type { ManagedRecord, ManagedStore } from "./managed-store.js";
import type { DemoStore } from "./store.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

async function requireAthlete(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSession(sessionToken(request));
  if (!user) {
    void reply.code(401).send({ error: "Autenticação necessária" });
    return undefined;
  }
  if (user.role !== "athlete") {
    void reply.code(403).send({ error: "Área exclusiva do atleta" });
    return undefined;
  }
  if (!user.athleteId) {
    void reply.code(409).send({ error: "A conta não possui atleta vinculado" });
    return undefined;
  }
  return user;
}

function localDate(value = new Date()) {
  return dateFormatter.format(value);
}

function dateRange(date: string) {
  const current = new Date(`${date}T12:00:00Z`);
  const day = current.getUTCDay();
  const monday = new Date(current);
  monday.setUTCDate(current.getUTCDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

function dateOf(record: ManagedRecord) {
  return String(record.date ?? record.scheduledDate ?? record.startedAt ?? record.createdAt).slice(0, 10);
}

function workoutDistance(blocks: WorkoutBlock[]) {
  return blocks.reduce(
    (total, block) => total + block.steps.reduce(
      (blockTotal, step) => blockTotal + (step.distanceMeters ?? 0) * step.repetitions,
      0,
    ) * block.repeatCount,
    0,
  );
}

function durationLabel(seconds?: number) {
  if (!seconds) return undefined;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function mapWorkout(workout: WorkoutTemplate, prescriptionId?: string, scheduledDate = workout.scheduledDate) {
  const blocks = workout.blocks.map((block) => ({
    id: block.id,
    title: block.name,
    repeatCount: block.repeatCount,
    volumeMeters: workoutDistance([block]),
    steps: block.steps.map((step) => ({
      id: step.id,
      repetitions: step.repetitions,
      distanceMeters: step.distanceMeters,
      durationSeconds: step.durationSeconds,
      stroke: step.stroke,
      target: step.targetValue,
      interval: durationLabel(step.intervalSeconds),
      equipment: step.equipment,
      notes: step.notes,
      kind: step.kind,
    })),
  }));
  const mainStep = workout.blocks.flatMap((block) => block.steps).find((step) => step.kind === "main");
  const expectedPse = Number(String(mainStep?.targetValue ?? "").match(/(?:RPE|PSE)\s*(\d+)/i)?.[1] ?? 6);
  return {
    id: workout.id,
    prescriptionId,
    title: workout.title.replace(/\s*-\s*[\d.]+\s*m$/i, ""),
    objective: workout.objective,
    date: scheduledDate,
    poolLengthM: 50,
    volumeMeters: workoutDistance(workout.blocks),
    zone: mainStep?.targetType === "pace" ? "A2" : "Técnica",
    expectedPse,
    blocks,
  };
}

function mapManagedWorkout(workout: ManagedRecord, prescriptionId?: string) {
  const rawBlocks = Array.isArray(workout.blocks) ? workout.blocks as WorkoutBlock[] : [];
  if (rawBlocks.length) {
    return mapWorkout({
      id: workout.id,
      organizationId: String(workout.organizationId),
      title: String(workout.title ?? "Sessão de treino"),
      sportContext: "pool",
      scheduledDate: dateOf(workout),
      objective: String(workout.objective ?? ""),
      blocks: rawBlocks,
      status: "published",
      version: Number(workout.version ?? 1),
      createdBy: String(workout.actorId ?? "coach"),
      createdAt: workout.createdAt,
      updatedAt: workout.updatedAt,
    }, prescriptionId);
  }
  const volumeMeters = Number(workout.distanceMeters ?? 0);
  return {
    id: workout.id,
    prescriptionId,
    title: String(workout.title ?? "Sessão de treino"),
    objective: String(workout.objective ?? "Sessão prescrita pela comissão técnica."),
    date: dateOf(workout),
    poolLengthM: 50,
    volumeMeters,
    zone: String(workout.zone ?? "A2"),
    expectedPse: Number(workout.expectedPse ?? 6),
    blocks: [{
      id: `${workout.id}-main`,
      title: "Série prescrita",
      repeatCount: 1,
      volumeMeters,
      steps: [{
        id: `${workout.id}-step`,
        repetitions: 1,
        distanceMeters: volumeMeters,
        stroke: "mixed",
        target: String(workout.zone ?? "A2"),
        equipment: [],
        kind: "main",
      }],
    }],
  };
}

function prescriptionTargetsAthlete(store: ManagedStore, prescription: ManagedRecord, athlete: ManagedRecord) {
  if (prescription.athleteId === athlete.id || (prescription.targetType === "athlete" && prescription.targetId === athlete.id)) return true;
  if (prescription.targetType === "team") return true;
  if (prescription.targetType !== "group") return false;
  const groupIds = Array.isArray(athlete.groupIds) ? athlete.groupIds.map(String) : [];
  if (typeof athlete.groupId === "string") groupIds.push(athlete.groupId);
  for (const group of store.list("groups").filter((item) => item.organizationId === athlete.organizationId)) {
    const athleteIds = Array.isArray(group.athleteIds) ? group.athleteIds.map(String) : [];
    if (athleteIds.includes(athlete.id) || group.name === athlete.group) groupIds.push(group.id);
  }
  return groupIds.includes(String(prescription.targetId));
}

function demoPrescriptionForAthlete(demo: DemoStore, athlete: ManagedRecord, date: string) {
  const demoAthlete = demo.athletes.find((item) =>
    item.email?.toLowerCase() === String(athlete.email ?? "").toLowerCase()
    || item.name === athlete.name);
  if (!demoAthlete) return undefined;
  const prescription = demo.prescriptions.find((item) =>
    item.organizationId === athlete.organizationId
    && !["cancelled", "completed"].includes(item.status)
    && (
      (item.targetType === "athlete" && item.targetId === demoAthlete.id)
      || (item.targetType === "group" && demoAthlete.groupIds.includes(item.targetId))
      || item.targetType === "team"
    ));
  if (!prescription) return undefined;
  const workout = demo.workouts.find((item) =>
    item.id === prescription.workoutTemplateId
    && item.status === "published"
    && (item.scheduledDate === date || item.scheduledDate === new Date().toISOString().slice(0, 10)));
  return workout ? { prescription, workout } : undefined;
}

function aggregate(store: ManagedStore, demo: DemoStore, athleteId: string, organizationId: string, date: string) {
  const athlete = store.get("athletes", athleteId);
  if (!athlete || athlete.organizationId !== organizationId) return undefined;
  const range = dateRange(date);
  const own = (record: ManagedRecord) => record.organizationId === organizationId && record.athleteId === athleteId;
  const inWeek = (record: ManagedRecord) => {
    const value = dateOf(record);
    return value >= range.start && value <= range.end;
  };
  const checkIn = store.list("athleteResponses").find((item) => own(item) && item.date === date) ?? null;
  const executions = store.list("sessionExecutions").filter(own);
  const weekExecutions = executions.filter(inWeek);
  const prescribedWorkouts = store.list("prescriptions")
    .filter((item) =>
      item.organizationId === organizationId
      && item.status === "PUBLISHED"
      && prescriptionTargetsAthlete(store, item, athlete))
    .map((prescription) => ({
      prescription,
      workout: store.get("workouts", String(prescription.workoutId ?? prescription.workoutTemplateId ?? "")),
    }))
    .filter((assignment): assignment is { prescription: ManagedRecord; workout: ManagedRecord } =>
      Boolean(assignment.workout?.status === "published"));
  const weekAssignments = prescribedWorkouts.filter(({ workout }) => inWeek(workout));
  const todayAssignment = prescribedWorkouts.find(({ workout }) => dateOf(workout) === date);
  const demoAssignment = todayAssignment ? undefined : demoPrescriptionForAthlete(demo, athlete, date);
  const session = todayAssignment
    ? mapManagedWorkout(todayAssignment.workout, todayAssignment.prescription.id)
    : demoAssignment
      ? mapWorkout(demoAssignment.workout, demoAssignment.prescription.id, date)
      : null;
  const completedToday = executions.find((item) => item.date === date || String(item.startedAt ?? "").startsWith(date));
  const plannedMeters = weekAssignments.reduce((sum, { workout }) => sum + Number(workout.distanceMeters ?? 0), 0)
    || (session ? session.volumeMeters * Math.max(1, Number((athlete.availability as { sessionsPerWeek?: number } | undefined)?.sessionsPerWeek ?? 1)) : 0);
  const completedMeters = weekExecutions.reduce((sum, item) => sum + Number(item.distanceMeters ?? 0), 0);
  const load = store.list("loadSnapshots").filter(own);
  const activities = store.list("activities").filter(own);
  const results = store.list("results").filter(own);
  const athleteTargetMeet = String(athlete.targetMeet ?? "").trim();
  const meetRecords = store.list("meets")
    .filter((item) => item.organizationId === organizationId);
  const targetMeet = meetRecords.find((meet) =>
    meet.id === athleteTargetMeet || meet.name === athleteTargetMeet)
    ?? (!athleteTargetMeet
      ? meetRecords
        .filter((meet) => datePattern.test(String(meet.startsOn ?? "")) && String(meet.startsOn) >= date)
        .sort((left, right) => String(left.startsOn).localeCompare(String(right.startsOn)))[0]
      : undefined);
  const targetDate = datePattern.test(String(athlete.meetDate ?? ""))
    ? String(athlete.meetDate)
    : datePattern.test(String(targetMeet?.startsOn ?? ""))
      ? String(targetMeet?.startsOn)
      : undefined;
  const season = store.list("seasons").find((item) => item.organizationId === organizationId && item.status === "active");
  const phaseStart = datePattern.test(String(season?.startsOn ?? "")) ? String(season?.startsOn) : range.start;
  const phaseEnd = targetDate ?? (datePattern.test(String(season?.endsOn ?? "")) ? String(season?.endsOn) : range.end);
  const elapsedWeeks = Math.max(0, Math.floor((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${phaseStart}T12:00:00Z`).getTime()) / 604_800_000));
  const totalWeeks = Math.max(1, Math.ceil((new Date(`${phaseEnd}T12:00:00Z`).getTime() - new Date(`${phaseStart}T12:00:00Z`).getTime()) / 604_800_000));
  const meets = meetRecords.map((meet) => ({
    id: meet.id,
    name: meet.name ?? meet.title,
    startsOn: meet.startsOn,
    endsOn: meet.endsOn,
    priority: meet.priority,
    pool: meet.pool,
    status: meet.status,
    target: meet.id === targetMeet?.id,
  }));
  const weekSessions = weekAssignments.map(({ prescription, workout }) => ({
    id: workout.id,
    date: dateOf(workout),
    title: workout.title,
    volumeMeters: Number(workout.distanceMeters ?? 0),
    zone: String(workout.zone ?? "A2"),
    completed: weekExecutions.some((execution) =>
      execution.prescriptionId === prescription.id
      || execution.sessionId === workout.id
      || execution.date === dateOf(workout)),
  }));
  if (weekSessions.length === 0 && session && session.date >= range.start && session.date <= range.end) {
    weekSessions.push({
      id: session.id,
      date: session.date,
      title: session.title,
      volumeMeters: session.volumeMeters,
      zone: session.zone,
      completed: Boolean(completedToday),
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    date,
    athlete: {
      id: athlete.id,
      name: athlete.name,
      email: athlete.email,
      group: athlete.group,
      category: athlete.category,
      club: athlete.club,
      level: athlete.level,
      events: athlete.events ?? [],
      primaryEvent: athlete.primaryEvent ?? athlete.goalEvent,
      secondaryEvent: athlete.secondaryEvent,
      objective: athlete.objective,
      targetMeet: athlete.targetMeet,
      meetDate: athlete.meetDate,
      availability: athlete.availability,
      onboardingStatus: athlete.onboardingStatus,
    },
    checkIn,
    readiness: {
      score: Number(athlete.readiness ?? (checkIn ? Math.max(0, 100 - Number(checkIn.fatigue ?? 0) * 8 - Number(checkIn.pain ?? 0) * 6) : 0)),
      psr: checkIn?.psr ?? null,
      sleepHours: checkIn?.sleepHours ?? athlete.sleep ?? null,
      status: checkIn ? "updated" : "pending",
    },
    phase: {
      name: String(athlete.phase ?? "Preparação específica"),
      objective: String(athlete.objective ?? "Evoluir com consistência até a competição-alvo."),
      currentWeek: Math.min(totalWeeks, elapsedWeeks + 1),
      totalWeeks,
      startsOn: phaseStart,
      endsOn: phaseEnd,
      targetMeet: athleteTargetMeet || targetMeet?.name || null,
    },
    today: {
      status: completedToday ? "completed" : checkIn ? "ready" : "check-in-pending",
      session,
      execution: completedToday ?? null,
    },
    week: {
      startsOn: range.start,
      endsOn: range.end,
      plannedMeters,
      completedMeters,
      plannedSessions: Math.max(weekAssignments.length, Number((athlete.availability as { sessionsPerWeek?: number } | undefined)?.sessionsPerWeek ?? (session ? 1 : 0))),
      completedSessions: weekExecutions.length,
      load: Math.round(load.filter(inWeek).reduce((sum, item) => sum + Number(item.value ?? (item.layers as { internal?: { loadUa?: number } } | undefined)?.internal?.loadUa ?? 0), 0)),
      sessions: weekSessions,
    },
    competitions: meets,
    recentResults: results.slice(0, 8),
    recentWorkouts: activities.filter((item) => item.type === "rkf-load-session").slice(0, 8),
    load: load.slice(0, 12),
  };
}

export function registerAthleteAppRoutes(app: FastifyInstance, store: ManagedStore, demo: DemoStore) {
  app.get("/api/v1/athlete/app", async (request, reply) => {
    const user = await requireAthlete(request, reply);
    if (!user) return;
    const query = z.object({ date: z.string().regex(datePattern).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Data inválida" });
    const data = aggregate(store, demo, user.athleteId!, user.organizationId, query.data.date ?? localDate());
    if (!data) return reply.code(404).send({ error: "Perfil do atleta não encontrado" });
    return reply.send(data);
  });

  app.post("/api/v1/athlete/check-in", async (request, reply) => {
    const user = await requireAthlete(request, reply);
    if (!user) return;
    const parsed = z.object({
      date: z.string().regex(datePattern).optional(),
      psr: z.number().min(1).max(10),
      sleepHours: z.number().min(0).max(24).optional(),
      fatigue: z.number().min(0).max(10).optional(),
      soreness: z.number().min(0).max(10).optional(),
      pain: z.number().min(0).max(10).optional(),
      feelings: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
      notes: z.string().trim().max(2000).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Check-in inválido", details: parsed.error.flatten() });
    const date = parsed.data.date ?? localDate();
    const existing = store.list("athleteResponses").find((item) =>
      item.organizationId === user.organizationId && item.athleteId === user.athleteId && item.date === date);
    const payload = {
      athleteId: user.athleteId,
      date,
      ...parsed.data,
      fatigue: parsed.data.fatigue ?? Math.max(0, 10 - parsed.data.psr),
      source: "athlete-app",
      status: "confirmed",
      actorId: user.id,
      organizationId: user.organizationId,
    };
    const checkIn = existing
      ? store.update("athleteResponses", existing.id, payload, "update")
      : store.create("athleteResponses", payload, "create");
    return reply.code(existing ? 200 : 201).send(checkIn);
  });

  app.post("/api/v1/athlete/results", async (request, reply) => {
    const user = await requireAthlete(request, reply);
    if (!user) return;
    const repetition = z.object({
      repetition: z.number().int().positive(),
      distanceM: z.number().positive(),
      timeSeconds: z.number().positive(),
      stroke: z.string().trim().min(1).max(40).default("livre"),
      note: z.string().trim().max(300).optional(),
      splits: z.array(z.object({ distanceM: z.number().positive(), timeSeconds: z.number().positive() })).max(20).default([]),
    });
    const parsed = z.object({
      date: z.string().regex(datePattern).optional(),
      prescriptionId: z.string().trim().min(1).optional(),
      sessionId: z.string().trim().min(1).optional(),
      meetId: z.string().trim().min(1).optional(),
      kind: z.enum(["training", "competition"]).default("training"),
      event: z.string().trim().min(2).max(120),
      poolLengthM: z.union([z.literal(25), z.literal(50)]).default(50),
      sessionDistanceM: z.number().positive(),
      durationMinutes: z.number().positive(),
      pse: z.number().min(1).max(10),
      expectedPse: z.number().min(1).max(10).optional(),
      protocol: z.string().trim().min(1).max(160).optional(),
      placement: z.string().trim().max(30).optional(),
      markKind: z.string().trim().max(30).optional(),
      notes: z.string().trim().max(2000).optional(),
      sets: z.array(z.object({
        set: z.number().int().positive(),
        label: z.string().trim().min(1).max(160),
        zone: z.string().trim().max(20).optional(),
        repetitions: z.array(repetition).min(1).max(100),
      })).min(1).max(30),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Resultado inválido", details: parsed.error.flatten() });
    const date = parsed.data.date ?? localDate();
    const repetitions = parsed.data.sets.flatMap((set) => set.repetitions);
    const bestTimeSeconds = Math.min(...repetitions.map((item) => item.timeSeconds));
    const averageTimeSeconds = Math.round(repetitions.reduce((sum, item) => sum + item.timeSeconds, 0) / repetitions.length * 100) / 100;
    const normalized = {
      ...parsed.data,
      date,
      athleteId: user.athleteId,
      bestTimeSeconds,
      averageTimeSeconds,
    };
    const snapshotHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const result = store.create("results", {
      title: `${parsed.data.event} · ${date}`,
      ...normalized,
      status: "CONFIRMED",
      immutable: true,
      snapshotHash,
      source: "ATHLETE_CONFIRMED",
      actorId: user.id,
      organizationId: user.organizationId,
    });
    for (const set of parsed.data.sets) {
      const setResult = store.create("setResults", {
        resultId: result.id,
        athleteId: user.athleteId,
        set: set.set,
        label: set.label,
        zone: set.zone,
        organizationId: user.organizationId,
        actorId: user.id,
      });
      for (const item of set.repetitions) {
        const repetitionResult = store.create("repetitionResults", {
          resultId: result.id,
          setResultId: setResult.id,
          athleteId: user.athleteId,
          ...item,
          organizationId: user.organizationId,
          actorId: user.id,
        });
        for (const split of item.splits) {
          store.create("splitResults", {
            resultId: result.id,
            repetitionResultId: repetitionResult.id,
            athleteId: user.athleteId,
            ...split,
            organizationId: user.organizationId,
            actorId: user.id,
          });
        }
      }
    }
    return reply.code(201).send(result);
  });

  app.post("/api/v1/athlete/checkout", async (request, reply) => {
    const user = await requireAthlete(request, reply);
    if (!user) return;
    const parsed = z.object({
      date: z.string().regex(datePattern).optional(),
      prescriptionId: z.string().trim().min(1).optional(),
      sessionId: z.string().trim().min(1).optional(),
      startedAt: z.string().datetime().optional(),
      endedAt: z.string().datetime().optional(),
      distanceMeters: z.number().positive(),
      durationMinutes: z.number().positive(),
      pse: z.number().min(1).max(10),
      pain: z.number().min(0).max(10).default(0),
      completedSteps: z.number().int().nonnegative().default(1),
      totalSteps: z.number().int().positive().default(1),
      notes: z.string().trim().max(2000).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Checkout inválido", details: parsed.error.flatten() });
    const endedAt = parsed.data.endedAt ?? new Date().toISOString();
    const date = parsed.data.date ?? endedAt.slice(0, 10);
    const startedAt = parsed.data.startedAt ?? new Date(new Date(endedAt).getTime() - parsed.data.durationMinutes * 60_000).toISOString();
    const externalId = `athlete-app:${user.athleteId}:${parsed.data.prescriptionId ?? parsed.data.sessionId ?? date}`;
    const existing = store.list("sessionExecutions").find((item) =>
      item.organizationId === user.organizationId
      && item.athleteId === user.athleteId
      && item.externalId === externalId);
    const executionPayload = {
      athleteId: user.athleteId,
      prescriptionId: parsed.data.prescriptionId,
      sessionId: parsed.data.sessionId,
      date,
      startedAt,
      endedAt,
      distanceMeters: parsed.data.distanceMeters,
      durationSeconds: parsed.data.durationMinutes * 60,
      rpe: parsed.data.pse,
      pain: parsed.data.pain,
      completedSteps: parsed.data.completedSteps,
      totalSteps: parsed.data.totalSteps,
      notes: parsed.data.notes,
      source: "manual",
      externalId,
      status: "confirmed",
      organizationId: user.organizationId,
      actorId: user.id,
    };
    const execution = existing
      ? store.update("sessionExecutions", existing.id, executionPayload, "update")
      : store.create("sessionExecutions", executionPayload, "create");
    const existingActivity = store.list("activities").find((item) =>
      item.organizationId === user.organizationId && item.externalId === externalId);
    const loadUa = Math.round(parsed.data.pse * parsed.data.durationMinutes);
    const activityPayload = {
      type: "rkf-load-session",
      title: "Execução confirmada pelo atleta",
      athleteId: user.athleteId,
      date,
      startedAt,
      endedAt,
      distanceMeters: parsed.data.distanceMeters,
      executedVolumeM: parsed.data.distanceMeters,
      durationMinutes: parsed.data.durationMinutes,
      pse: parsed.data.pse,
      pain: parsed.data.pain,
      load: loadUa,
      prescriptionId: parsed.data.prescriptionId,
      notes: parsed.data.notes,
      source: "manual",
      externalId,
      status: "confirmed",
      organizationId: user.organizationId,
      actorId: user.id,
    };
    if (existingActivity) store.update("activities", existingActivity.id, activityPayload, "update");
    else store.create("activities", activityPayload, "create");
    const existingLoad = store.list("loadSnapshots").find((item) =>
      item.organizationId === user.organizationId && item.athleteId === user.athleteId && item.externalId === externalId);
    const loadPayload = {
      title: `Carga · ${date}`,
      athleteId: user.athleteId,
      executionId: execution?.id,
      date,
      value: loadUa,
      externalId,
      layers: {
        prescribed: { volumeM: parsed.data.distanceMeters },
        executed: { volumeM: parsed.data.distanceMeters },
        internal: { loadUa, pse: parsed.data.pse, durationMinutes: parsed.data.durationMinutes },
      },
      status: "COMMITTED",
      immutable: false,
      organizationId: user.organizationId,
      actorId: user.id,
    };
    if (existingLoad) store.update("loadSnapshots", existingLoad.id, loadPayload, "update");
    else store.create("loadSnapshots", loadPayload, "create");
    return reply.code(existing ? 200 : 201).send({ execution, loadUa });
  });
}
