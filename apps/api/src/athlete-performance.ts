import type { FastifyInstance } from "fastify";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import type { ManagedRecord, ManagedStore } from "./managed-store.js";

function organizationRows(store: ManagedStore, kind: Parameters<ManagedStore["list"]>[0], organizationId: string) {
  return store.list(kind).filter((row) => String(row.organizationId ?? "org-demo") === organizationId);
}

function athleteRows(store: ManagedStore, kind: Parameters<ManagedStore["list"]>[0], organizationId: string, athleteId: string) {
  return organizationRows(store, kind, organizationId).filter((row) => row.athleteId === athleteId || (row.targetType === "athlete" && row.targetId === athleteId));
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowDate(row: ManagedRecord) {
  return String(row.date ?? row.scheduledDate ?? row.completedAt ?? row.endedAt ?? row.updatedAt ?? row.createdAt ?? "").slice(0, 10);
}

function recent<T extends ManagedRecord>(rows: T[]) {
  return [...rows].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? rowDate(b)).localeCompare(String(a.updatedAt ?? a.createdAt ?? rowDate(a))));
}

function parseClockSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(",", ".");
  if (!raw) return null;
  const parts = raw.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts.length === 1 && parts[0] > 0 ? parts[0] : null;
}

function bestRecordedSeconds(row: ManagedRecord) {
  const direct = parseClockSeconds(row.timeSeconds ?? row.time ?? row.result ?? row.bestTime ?? row.best);
  if (direct !== null) return direct;
  const sets = Array.isArray(row.sets) ? row.sets as Array<Record<string, unknown>> : [];
  const candidates = sets.flatMap((set) => {
    const repetitions = Array.isArray(set.repetitions) ? set.repetitions as Array<Record<string, unknown>> : [];
    return repetitions.map((rep) => parseClockSeconds(rep.timeSeconds ?? rep.time)).filter((value): value is number => value !== null);
  });
  return candidates.length ? Math.min(...candidates) : null;
}

function formatClock(seconds: number | null) {
  if (seconds === null) return null;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(2).padStart(5, "0")}`;
}

export function registerAthletePerformanceRoutes(app: FastifyInstance, store: ManagedStore) {
  app.get("/api/v1/ai/athlete/performance", async (request, reply) => {
    const user = await getSession(sessionToken(request));
    if (!roleAllows(user, ["athlete"])) return reply.code(user ? 403 : 401).send({ error: user ? "Acesso exclusivo do atleta" : "Autenticação necessária" });
    const athleteId = user!.athleteId;
    if (!athleteId) return reply.code(409).send({ error: "Conta sem atleta vinculado" });

    const athlete = organizationRows(store, "athletes", user!.organizationId).find((row) => row.id === athleteId);
    if (!athlete) return reply.code(404).send({ error: "Perfil do atleta não encontrado" });

    const executions = recent(athleteRows(store, "sessionExecutions", user!.organizationId, athleteId));
    const sessionResults = recent(athleteRows(store, "sessionResults", user!.organizationId, athleteId));
    const officialResults = recent(athleteRows(store, "results", user!.organizationId, athleteId));
    const loads = recent(athleteRows(store, "loadCalculations", user!.organizationId, athleteId));
    const evolution = recent(athleteRows(store, "evolutionAssessments", user!.organizationId, athleteId));
    const videos = recent(athleteRows(store, "videos", user!.organizationId, athleteId));

    const totalDistanceM = executions.reduce((sum, row) => sum + (numberOrNull(row.distanceMeters ?? row.executedVolumeM ?? row.sessionDistanceM) ?? 0), 0);
    const rpes = executions.map((row) => numberOrNull(row.rpe ?? row.pse)).filter((value): value is number => value !== null);
    const averageRpe = rpes.length ? Math.round((rpes.reduce((sum, value) => sum + value, 0) / rpes.length) * 10) / 10 : null;

    const resultRows = [...sessionResults, ...officialResults];
    const bestByEvent = new Map<string, { event: string; seconds: number; date: string; source: string }>();
    for (const row of resultRows) {
      const event = String(row.event ?? row.title ?? row.protocol ?? "Resultado").trim();
      const seconds = bestRecordedSeconds(row);
      if (seconds === null) continue;
      const current = bestByEvent.get(event);
      if (!current || seconds < current.seconds) bestByEvent.set(event, { event, seconds, date: rowDate(row), source: officialResults.includes(row) ? "resultado oficial" : "resultado de treino" });
    }

    const latestLoad = loads[0];
    const latestEvolution = evolution[0];

    return reply.send({
      athlete: {
        id: athlete.id,
        name: athlete.name,
        category: athlete.category ?? null,
        level: athlete.level ?? null,
        primaryEvent: athlete.primaryEvent ?? athlete.goalEvent ?? null,
        objective: athlete.objective ?? null,
      },
      summary: {
        completedSessions: executions.length,
        totalDistanceM,
        averageRpe,
        recordedResults: resultRows.length,
        videoAnalyses: videos.filter((video) => Boolean(video.analysisCompletedAt ?? video.analysis)).length,
      },
      personalBests: [...bestByEvent.values()]
        .sort((a, b) => a.event.localeCompare(b.event))
        .slice(0, 12)
        .map((item) => ({ ...item, time: formatClock(item.seconds) })),
      recentSessions: executions.slice(0, 12).map((row) => ({
        id: row.id,
        date: rowDate(row),
        title: row.title ?? row.sessionTitle ?? "Treino concluído",
        distanceM: numberOrNull(row.distanceMeters ?? row.executedVolumeM ?? row.sessionDistanceM),
        durationMinutes: numberOrNull(row.durationMinutes) ?? (numberOrNull(row.durationSeconds) !== null ? Math.round(Number(row.durationSeconds) / 60) : null),
        rpe: numberOrNull(row.rpe ?? row.pse),
        status: row.status ?? "completed",
      })),
      recentResults: resultRows.slice(0, 12).map((row) => ({
        id: row.id,
        date: rowDate(row),
        event: row.event ?? row.title ?? row.protocol ?? "Resultado",
        time: formatClock(bestRecordedSeconds(row)) ?? String(row.time ?? row.result ?? "UNKNOWN"),
        poolLengthM: numberOrNull(row.poolLengthM),
        meet: row.meet ?? row.competition ?? row.meetName ?? null,
      })),
      load: latestLoad ? {
        value: numberOrNull(latestLoad.value ?? latestLoad.load),
        atl: numberOrNull(latestLoad.atl ?? latestLoad.ATL),
        ctl: numberOrNull(latestLoad.ctl ?? latestLoad.CTL),
        tsb: numberOrNull(latestLoad.tsb ?? latestLoad.TSB),
        date: rowDate(latestLoad),
      } : null,
      evolution: latestEvolution ? {
        date: rowDate(latestEvolution),
        summary: latestEvolution.summary ?? latestEvolution.status ?? latestEvolution.note ?? "Avaliação registrada",
        score: numberOrNull(latestEvolution.score),
      } : null,
      aquaVision: videos.slice(0, 5).map((video) => {
        const analysis = video.analysis && typeof video.analysis === "object" ? video.analysis as Record<string, unknown> : {};
        const quality = analysis.quality && typeof analysis.quality === "object" ? analysis.quality as Record<string, unknown> : {};
        return {
          id: video.id,
          title: video.title ?? "Análise de vídeo",
          date: rowDate(video),
          qualityGrade: quality.grade ?? null,
          analyzed: Boolean(video.analysisCompletedAt ?? video.analysis),
        };
      }),
      privacy: { athleteScoped: true, organizationScoped: true },
    });
  });
}
