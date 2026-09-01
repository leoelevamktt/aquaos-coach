import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession, roleAllows, sessionToken } from "./auth.js";
import type { ManagedRecord, ManagedStore } from "./managed-store.js";

/**
 * Briefing diário do coach (tela Hoje/Inbox). Tudo é derivado do ManagedStore
 * real; quando não há dado, devolve null/0 + source "none" — nenhum número é
 * inventado (mesma política do snapshot do assistente e dos relatórios).
 */

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type BriefingInsightView = "athletes" | "videos" | "inbox" | "practices" | "rkf" | "seasons";

export type BriefingInsight = {
  id: string;
  severity: "attention" | "info" | "success";
  title: string;
  detail: string;
  view?: BriefingInsightView;
  athleteId?: string;
};

export type BriefingMetrics = {
  activeAthletes: number;
  readyAthletes: number;
  attentionAthletes: number;
  averageReadiness: number | null;
  checkinsToday: number;
  adherencePercent: number | null;
  pendingVideos: number;
  pendingInvitations: number;
  expiringInvitations: number;
  prescriptionsAwaitingApproval: number;
};

export type BriefingLoad = {
  acute: number | null;
  chronic: number | null;
  acwr: number | null;
  weeklyHistory: Array<{ label: string; volumeMeters: number }>;
  source: "activities" | "none";
};

export type BriefingPerAthlete = {
  athleteId: string;
  name: string;
  readiness: number | null;
  weekVolumeMeters: number | null;
  previousWeekVolumeMeters: number | null;
  acuteLoadUA: number | null;
  acwr: number | null;
  checkinsThisWeek: number;
  pendingInvite: boolean;
};

export type CoachBriefing = {
  date: string;
  nextMeet: { id: string; name: string; priority: string; startsOn: string; daysUntil: number; pool: string } | null;
  todaySessions: Array<{
    id: string;
    title: string;
    date: string;
    volumeMeters: number;
    zone: string;
    blocksCount: number;
    time: string;
    targetType: "team" | "group" | "athlete";
    targetId: string;
    prescriptionId?: string;
  }>;
  metrics: BriefingMetrics;
  load: BriefingLoad;
  insights: BriefingInsight[];
  perAthlete: BriefingPerAthlete[];
};

export function coachLocalDate(value = new Date()) {
  return dateFormatter.format(value);
}

function dateOf(record: ManagedRecord) {
  return String(record.date ?? record.scheduledDate ?? record.startedAt ?? record.createdAt ?? "").slice(0, 10);
}

export function dayDiff(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function weekRange(date: string) {
  const current = new Date(`${date}T12:00:00Z`);
  const weekday = current.getUTCDay();
  const monday = new Date(current);
  monday.setUTCDate(current.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** Carga UA de uma atividade: campo load quando numérico, senão PSE × duração; null quando não há fonte. */
function activityLoadUa(activity: ManagedRecord): number | null {
  const direct = Number(activity.load);
  if (Number.isFinite(direct)) return direct;
  const pse = Number(activity.pse);
  const duration = Number(activity.durationMinutes);
  if (Number.isFinite(pse) && Number.isFinite(duration)) return Math.round(pse * duration);
  return null;
}

function activityVolumeM(activity: ManagedRecord): number {
  const value = Number(activity.executedVolumeM ?? activity.distanceMeters ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Readiness real: campo do atleta, senão decisão de adaptação mais recente; null quando nada existe. */
export function athleteReadiness(store: ManagedStore, athlete: ManagedRecord): number | null {
  const direct = Number(athlete.readiness);
  if (Number.isFinite(direct) && direct >= 0 && direct <= 100) return direct;
  const decisions = store.list("adaptationDecisions")
    .filter((item) => item.athleteId === athlete.id)
    .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
  for (const decision of decisions) {
    const guardrails = decision.guardrails as { readiness?: unknown } | undefined;
    const value = Number(decision.readiness ?? guardrails?.readiness);
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
  }
  for (const score of store.list("readinessScores").filter((item) => item.athleteId === athlete.id)) {
    const value = Number(score.value ?? score.readiness);
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
  }
  return null;
}

function embeddedSnapshot(prescription: ManagedRecord): Record<string, unknown> | undefined {
  const snapshot = prescription.publishedSnapshot ?? prescription.prescription;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : undefined;
}

function blocksVolume(blocks: Array<Record<string, unknown>>): number {
  return blocks.reduce((total, block) => {
    if (!block || typeof block !== "object") return total;
    const repeatCount = Math.max(1, Number(block.repeatCount ?? 1) || 1);
    const steps = Array.isArray((block as { steps?: unknown }).steps)
      ? (block as { steps: unknown[] }).steps as Array<Record<string, unknown>>
      : [];
    const stepsVolume = steps.reduce(
      (sum, step) => sum + Math.max(0, Number(step?.distanceMeters ?? 0) || 0) * Math.max(1, Number(step?.repetitions ?? 1) || 1),
      0,
    );
    if (steps.length) return total + stepsVolume * repeatCount;
    const volume = Number((block as { volumeM?: unknown }).volumeM ?? (block as { volumeMeters?: unknown }).volumeMeters ?? 0);
    return total + (Number.isFinite(volume) && volume > 0 ? volume : 0) * repeatCount;
  }, 0);
}

export function buildCoachBriefing(store: ManagedStore, organizationId: string, today = coachLocalDate()): CoachBriefing {
  const inOrg = (record: ManagedRecord) => String(record.organizationId ?? "org-demo") === organizationId;
  const athletes = store.list("athletes").filter(inOrg);
  const activeAthletes = athletes.filter((record) => String(record.status ?? "active") === "active");
  const activities = store.list("activities").filter(inOrg);
  const loadActivities = activities.filter((item) => item.type === "rkf-load-session");
  const prescriptions = store.list("prescriptions").filter(inOrg);
  const invitations = store.list("invitations").filter(inOrg);
  const videos = store.list("videos").filter(inOrg);
  const meets = store.list("meets").filter(inOrg);
  const workouts = store.list("workouts").filter(inOrg);
  const settings = store.list("settings").find((item) => item.id === "program") ?? undefined;

  // --- Próxima competição (menor startsOn futuro) ---
  const upcomingMeets = meets
    .filter((meet) => /^\d{4}-\d{2}-\d{2}$/.test(String(meet.startsOn ?? "")) && String(meet.startsOn) >= today)
    .sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn)));
  const nextMeetRecord = upcomingMeets[0];
  const nextMeet = nextMeetRecord ? {
    id: String(nextMeetRecord.id),
    name: String(nextMeetRecord.name ?? nextMeetRecord.title ?? nextMeetRecord.id),
    priority: String(nextMeetRecord.priority ?? "—"),
    startsOn: String(nextMeetRecord.startsOn),
    daysUntil: Math.max(0, dayDiff(today, String(nextMeetRecord.startsOn))),
    pool: String(nextMeetRecord.pool ?? settings?.primaryPool ?? "—"),
  } : null;

  // --- Sessões de hoje: prescrições PUBLISHED + treinos publicados de hoje (sem duplicar sessão) ---
  const todaySessions: CoachBriefing["todaySessions"] = [];
  const seenSessionIds = new Set<string>();
  const pushSession = (session: CoachBriefing["todaySessions"][number], dedupeKey: string) => {
    if (session.date !== today || seenSessionIds.has(dedupeKey)) return;
    seenSessionIds.add(dedupeKey);
    todaySessions.push(session);
  };
  for (const prescription of prescriptions.filter((item) => item.status === "PUBLISHED")) {
    const workout = workouts.find((item) => item.id === String(prescription.workoutId ?? prescription.workoutTemplateId ?? ""));
    const embedded = embeddedSnapshot(prescription);
    const date = (workout ? dateOf(workout) : "") || String(embedded?.date ?? embedded?.scheduledDate ?? prescription.date ?? "").slice(0, 10);
    if (!date) continue;
    const rawBlocks = Array.isArray(workout?.blocks)
      ? workout!.blocks as Array<Record<string, unknown>>
      : Array.isArray(embedded?.blocks)
        ? embedded!.blocks as Array<Record<string, unknown>>
        : [];
    // Contrato: quando prescription.prescription?.blocks existe, blocksCount = blocks.length.
    const embeddedBlocks = Array.isArray(embedded?.blocks) ? embedded!.blocks as unknown[] : undefined;
    const zone = String(
      workout?.zone
      ?? (embedded as { primaryZone?: unknown } | undefined)?.primaryZone
      ?? "",
    ) || "—";
    pushSession({
      id: String(workout?.id ?? embedded?.id ?? prescription.id),
      title: String(workout?.title ?? embedded?.title ?? prescription.title ?? "Sessão publicada"),
      date,
      volumeMeters: rawBlocks.length
        ? Math.round(blocksVolume(rawBlocks))
        : Number(workout?.distanceMeters ?? (embedded as { totalVolumeM?: unknown } | undefined)?.totalVolumeM ?? 0) || 0,
      zone,
      blocksCount: embeddedBlocks?.length ?? rawBlocks.length,
      time: String(workout?.scheduledAt ?? embedded?.scheduledAt ?? "").slice(11, 16) || "—",
      targetType: ["team", "group", "athlete"].includes(String(prescription.targetType))
        ? String(prescription.targetType) as "team" | "group" | "athlete"
        : "athlete",
      targetId: String(prescription.targetId ?? prescription.athleteId ?? organizationId),
      prescriptionId: prescription.id,
    }, String(workout?.id ?? prescription.workoutId ?? prescription.workoutTemplateId ?? embedded?.id ?? prescription.id));
  }
  for (const workout of workouts.filter((item) => String(item.status ?? "") === "published" && dateOf(item) === today)) {
    const rawBlocks = Array.isArray(workout.blocks) ? workout.blocks as Array<Record<string, unknown>> : [];
    pushSession({
      id: workout.id,
      title: String(workout.title ?? "Sessão publicada"),
      date: today,
      volumeMeters: Number(workout.distanceMeters ?? 0) || Math.round(blocksVolume(rawBlocks)),
      zone: String(workout.zone ?? "—"),
      blocksCount: rawBlocks.length,
      time: String(workout.scheduledAt ?? "").slice(11, 16) || "—",
      targetType: ["team", "group", "athlete"].includes(String(workout.targetType))
        ? String(workout.targetType) as "team" | "group" | "athlete"
        : "team",
      targetId: String(workout.targetId ?? organizationId),
    }, workout.id);
  }
  todaySessions.sort((a, b) => (a.time === "—" ? 1 : b.time === "—" ? -1 : a.time.localeCompare(b.time)));

  // --- Métricas ---
  const weekAgo = new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const recentExecutions = store.list("sessionExecutions").filter(inOrg).filter((item) => {
    const date = dateOf(item);
    return date >= weekAgo && date <= today;
  });
  const completeExecutions = recentExecutions.filter((item) => {
    const status = String(item.status ?? "");
    if (["confirmed", "completed"].includes(status)) return true;
    const completedSteps = Number(item.completedSteps);
    const totalSteps = Number(item.totalSteps);
    return Number.isFinite(completedSteps) && Number.isFinite(totalSteps) && totalSteps > 0 && completedSteps >= totalSteps;
  }).length;
  const pendingInvitations = invitations.filter((item) => item.status === "pending");
  const isExpiring = (record: ManagedRecord) => {
    if (record.status !== "pending") return false;
    const expiresAt = Date.parse(String(record.expiresAt ?? ""));
    return Number.isFinite(expiresAt) && expiresAt < Date.now() + 48 * 3_600_000;
  };

  const metrics: BriefingMetrics = {
    activeAthletes: activeAthletes.length,
    readyAthletes: activeAthletes.filter((athlete) => {
      const readiness = Number(athlete.readiness);
      return Number.isFinite(readiness) && readiness >= 70;
    }).length,
    attentionAthletes: activeAthletes.filter((athlete) => {
      const readiness = Number(athlete.readiness);
      return Number.isFinite(readiness) && readiness < 55;
    }).length,
    averageReadiness: (() => {
      const values = activeAthletes.map((athlete) => Number(athlete.readiness)).filter((value) => Number.isFinite(value));
      return values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    })(),
    checkinsToday: store.list("athleteResponses").filter(inOrg).filter((item) => item.date === today).length
      + store.list("adaptationDecisions").filter(inOrg).filter((item) => dateOf(item) === today).length,
    adherencePercent: recentExecutions.length
      ? Math.round(completeExecutions / recentExecutions.length * 100)
      : null,
    pendingVideos: videos.filter((video) => String(video.analysisStatus ?? "") !== "ready" || String(video.status ?? "") === "review").length,
    pendingInvitations: pendingInvitations.length,
    expiringInvitations: invitations.filter(isExpiring).length,
    prescriptionsAwaitingApproval: prescriptions.filter((item) => {
      const status = String(item.status ?? "").toLowerCase();
      return status !== "published" && !["cancelled", "rejected", "completed"].includes(status);
    }).length,
  };

  // --- Carga (aguda/crônica/ACWR) e histórico semanal de volume executado ---
  const weekBuckets = Array.from({ length: 8 }, () => ({ volumeMeters: 0, loadUa: 0, loadSamples: 0 }));
  for (const activity of activities) {
    const daysAgo = dayDiff(dateOf(activity), today);
    if (!Number.isFinite(daysAgo) || daysAgo < 0 || daysAgo > 55) continue;
    const bucket = 7 - Math.floor(daysAgo / 7); // 0 = semana mais antiga, 7 = últimos 7 dias
    if (bucket < 0 || bucket > 7) continue;
    if (activity.type === "rkf-load-session") {
      const load = activityLoadUa(activity);
      if (load !== null) {
        weekBuckets[bucket]!.loadUa += load;
        weekBuckets[bucket]!.loadSamples += 1;
      }
    }
    weekBuckets[bucket]!.volumeMeters += activityVolumeM(activity);
  }
  const acute = weekBuckets[7]!.loadSamples > 0 ? Math.round(weekBuckets[7]!.loadUa) : null;
  const chronic = weekBuckets.slice(4).some((bucket) => bucket.loadSamples > 0)
    ? Math.round(weekBuckets.slice(4).reduce((sum, bucket) => sum + bucket.loadUa, 0) / 4)
    : null;
  const acwr = acute !== null && chronic !== null && chronic > 0 ? round2(acute / chronic) : null;
  const weeklyHistory = weekBuckets.map((bucket, index) => ({ label: `S${index + 1}`, volumeMeters: bucket.volumeMeters }));

  // --- Insights derivados de dados reais (0-8, mais relevantes primeiro) ---
  const pendingVideosList = videos.filter((video) => String(video.analysisStatus ?? "") !== "ready" || String(video.status ?? "") === "review");
  const failedSyncs = store.list("syncJobs").filter(inOrg).filter((item) => item.status === "failed");
  const pendingIngestions = store.list("ingestions").filter(inOrg).filter((item) => {
    const state = String(item.state ?? item.status ?? "").toLowerCase();
    return !["analytics_ready", "executed", "committed", "confirmed", "ready", "completed"].includes(state);
  });
  const insights: CoachBriefing["insights"] = [];
  const lowReadiness = activeAthletes
    .filter((athlete) => Number.isFinite(Number(athlete.readiness)) && Number(athlete.readiness) < 70)
    .sort((a, b) => Number(a.readiness) - Number(b.readiness));
  for (const athlete of lowReadiness) {
    const readiness = Number(athlete.readiness);
    const weekly = Number(athlete.weeklyDistance);
    const previous = Number(athlete.previousDistance);
    const volumeDetail = Number.isFinite(weekly) && Number.isFinite(previous)
      ? ` Volume semanal: ${weekly} m vs ${previous} m na semana anterior.`
      : "";
    insights.push({
      id: `insight-readiness-${athlete.id}`,
      severity: readiness < 55 ? "attention" : "info",
      title: `${String(athlete.name ?? athlete.id)} está abaixo do ideal (${readiness})`,
      detail: `Prontidão abaixo do patamar de 70.${volumeDetail}`,
      view: "athletes",
      athleteId: String(athlete.id),
    });
  }
  if (failedSyncs.length) {
    insights.push({ id: "insight-sync-failed", severity: "attention", title: "Sincronizações com falha", detail: `${failedSyncs.length} job(s) de sincronização com status "failed".`, view: "inbox" });
  }
  if (pendingVideosList.length) {
    const names = [...new Set(pendingVideosList.map((video) => String(video.athlete ?? video.athleteId ?? "")))].filter(Boolean).slice(0, 4);
    insights.push({ id: "insight-videos-review", severity: "attention", title: "Fila de revisão de vídeos", detail: `${pendingVideosList.length} vídeo(s) sem análise concluída${names.length ? `: ${names.join(", ")}` : ""}.`, view: "videos" });
  }
  for (const athlete of activeAthletes) {
    const weekly = Number(athlete.weeklyDistance);
    const previous = Number(athlete.previousDistance);
    if (!Number.isFinite(weekly) || !Number.isFinite(previous) || previous <= 0 || weekly >= previous) continue;
    const drop = Math.round((1 - weekly / previous) * 100);
    if (drop > 15) {
      insights.push({ id: `insight-volume-${athlete.id}`, severity: "attention", title: `${String(athlete.name ?? athlete.id)}: volume caiu ${drop}%`, detail: `Semana atual ${weekly} m vs ${previous} m da semana anterior.`, view: "practices", athleteId: athlete.id });
    }
  }
  if (pendingInvitations.length) {
    const expiringCount = pendingInvitations.filter(isExpiring).length;
    insights.push({ id: "insight-invitations", severity: "info", title: "Convites pendentes", detail: `${pendingInvitations.length} convite(s) aguardando aceite${expiringCount ? ` · ${expiringCount} expira(m) em até 48 h` : ""}.`, view: "inbox" });
  }
  if (nextMeet && nextMeet.daysUntil < 21) {
    insights.push({ id: `insight-meet-${nextMeet.id}`, severity: "info", title: `${nextMeet.name} em ${nextMeet.daysUntil} dias`, detail: `Prioridade ${nextMeet.priority} · piscina ${nextMeet.pool}.`, view: "seasons" });
  }
  if (pendingIngestions.length) {
    insights.push({ id: "insight-ingestions", severity: "info", title: "Ingestões em andamento", detail: `${pendingIngestions.length} ingestão(ões) fora do estado final do pipeline RKF.`, view: "rkf" });
  }
  const severityRank = { attention: 0, info: 1, success: 2 } as const;
  const finalInsights: CoachBriefing["insights"] = insights.length
    ? insights.slice().sort((a, b) => severityRank[a.severity] - severityRank[b.severity]).slice(0, 8)
    : [{ id: "insight-all-clear", severity: "success", title: "Tudo em dia", detail: "Sem pendências de prontidão, vídeos, convites ou sincronizações para hoje." }];

  // --- Por atleta ---
  const week = weekRange(today);
  const perAthlete: CoachBriefing["perAthlete"] = activeAthletes.map((athlete) => {
    const athleteActivities = loadActivities.filter((item) => item.athleteId === athlete.id);
    const loads = athleteActivities
      .filter((item) => {
        const daysAgo = dayDiff(dateOf(item), today);
        return daysAgo >= 0 && daysAgo <= 27 && activityLoadUa(item) !== null;
      })
      .map((item) => ({ daysAgo: dayDiff(dateOf(item), today), load: activityLoadUa(item) as number }));
    const athleteAcute = loads.filter((item) => item.daysAgo <= 6).reduce((sum, item) => sum + item.load, 0);
    const athleteChronic = loads.length ? loads.reduce((sum, item) => sum + item.load, 0) / 4 : null;
    const weekly = Number(athlete.weeklyDistance);
    const previous = Number(athlete.previousDistance);
    return {
      athleteId: String(athlete.id),
      name: String(athlete.name ?? athlete.id),
      readiness: Number.isFinite(Number(athlete.readiness)) ? Number(athlete.readiness) : athleteReadiness(store, athlete),
      weekVolumeMeters: Number.isFinite(weekly) ? weekly : null,
      previousWeekVolumeMeters: Number.isFinite(previous) ? previous : null,
      acuteLoadUA: loads.some((item) => item.daysAgo <= 6) ? Math.round(athleteAcute) : null,
      acwr: athleteChronic && athleteChronic > 0 ? round2(athleteAcute / athleteChronic) : null,
      checkinsThisWeek: store.list("athleteResponses")
        .filter(inOrg)
        .filter((item) => item.athleteId === athlete.id && String(item.date ?? "") >= week.start && String(item.date ?? "") <= week.end).length,
      pendingInvite: invitations.some((item) => item.athleteId === athlete.id && item.status === "pending"),
    };
  });

  return {
    date: today,
    nextMeet: nextMeet ? { ...nextMeet } : null,
    todaySessions,
    metrics,
    load: { acute, chronic, acwr, weeklyHistory, source: loadActivities.length ? "activities" : "none" },
    insights: finalInsights,
    perAthlete,
  };
}

async function requireCoach(request: FastifyRequest, reply: FastifyReply) {
  const user = await getSession(sessionToken(request));
  if (!user) {
    void reply.code(401).send({ error: "Autenticação necessária" });
    return undefined;
  }
  if (!roleAllows(user, ["coach", "admin"])) {
    void reply.code(403).send({ error: "Ação exclusiva da comissão técnica" });
    return undefined;
  }
  return user;
}

export function registerCoachBriefingRoutes(app: FastifyInstance, store: ManagedStore) {
  app.get("/api/v1/coach/briefing", async (request, reply) => {
    const user = await requireCoach(request, reply);
    if (!user) return;
    return reply.send(buildCoachBriefing(store, user.organizationId));
  });
}
