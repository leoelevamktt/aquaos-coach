import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { openapi } from "./openapi.js";
import { DemoStore } from "./store.js";
import { athleteMayAccess, attachAuthStore, getSession, login, logout, provisionInvitedAthlete, roleAllows, sessionToken } from "./auth.js";
import { ManagedStore } from "./managed-store.js";
import { registerOperationalRoutes, uploadRoot } from "./operational-routes.js";
import { registerAiRoutes } from "./ai-routes.js";
import { registerAthleteAppRoutes } from "./athlete-app-routes.js";
import { registerRkfRoutes } from "./rkf-routes.js";
import { registerRkfSeedCatalogRoutes } from "./rkf-seed-catalog.js";
import { registerRkfDecisionRoutes } from "./rkf-decisions.js";
import { registerReportRoutes } from "./report-routes.js";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { VideoAnalysisQueue } from "./video-analysis-queue.js";

const app = Fastify({ logger: true });
const store = new DemoStore();
const managedStore = new ManagedStore();
const persistence = await managedStore.initialize();
attachAuthStore(managedStore);
const videoQueue = new VideoAnalysisQueue(managedStore, uploadRoot);
videoQueue.resume();
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean);
await app.register(cors, { origin: allowedOrigins, credentials: true });
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 1 } });
const publicApiPaths = new Set(["/api/v1/health", "/api/v1/openapi.json", "/api/v1/auth/login", "/api/v1/auth/demo-accounts"]);
const publicApiPrefixes = ["/api/v1/invitations/"];
const invitationProfileSchema = z.object({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sex: z.string().trim().max(40).optional(),
  category: z.string().trim().max(80).optional(),
  events: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
  otherEvent: z.string().trim().max(80).optional(),
  level: z.string().trim().max(80).optional(),
  club: z.string().trim().max(160).optional(),
  targetMeet: z.string().trim().max(160).optional(),
  meetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  primaryEvent: z.string().trim().max(80).optional(),
  secondaryEvent: z.string().trim().max(80).optional(),
  objective: z.string().trim().max(160).optional(),
  availability: z.object({
    sessionsPerWeek: z.number().int().min(3).max(12),
    days: z.array(z.string()).max(7),
    periods: z.array(z.string()).max(3),
  }).optional(),
  consents: z.object({
    medical: z.object({
      acceptedAt: z.string().datetime(),
      version: z.string().trim().min(1).max(40),
      origin: z.string().trim().min(1).max(80),
    }),
    responsibility: z.object({
      acceptedAt: z.string().datetime(),
      version: z.string().trim().min(1).max(40),
      origin: z.string().trim().min(1).max(80),
    }),
  }).optional(),
});
app.addHook("onRequest", async (request, reply) => {
  const path = request.url.split("?")[0];
  const origin = request.headers.origin;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && origin && !allowedOrigins.includes(origin)) return reply.code(403).send({ error: "Origem não autorizada" });
  const user = await getSession(sessionToken(request));
  if (path.startsWith("/api/v1/") && !publicApiPaths.has(path) && !publicApiPrefixes.some((prefix) => path.startsWith(prefix)) && !user) return reply.code(401).send({ error: "Autenticação necessária" });
  if (path.startsWith("/uploads/")) {
    if (!user) return reply.code(401).send({ error: "Autenticação necessária" });
    const filename = basename(decodeURIComponent(path));
    const record = [...managedStore.list("videos"), ...managedStore.list("documents"), ...managedStore.list("ingestions")].find((item) => (item.filename === filename || item.audioFilename === filename || (typeof item.thumbnailUrl === "string" && basename(item.thumbnailUrl) === filename)) && item.organizationId === user.organizationId);
    const ownFile = user.role !== "athlete" || athleteMayAccess(user, String(record?.athleteId ?? ""));
    if (!record || !ownFile) return reply.code(404).send({ error: "Arquivo não encontrado" });
  }
});
await app.register(fastifyStatic, { root: uploadRoot, prefix: "/uploads/", decorateReply: false });
registerOperationalRoutes(app, managedStore, videoQueue);
registerAiRoutes(app, managedStore);
registerAthleteAppRoutes(app, managedStore, store);
registerRkfRoutes(app, managedStore);
registerRkfSeedCatalogRoutes(app);
registerRkfDecisionRoutes(app, managedStore);
registerReportRoutes(app, managedStore);
app.addHook("onClose", async () => { await managedStore.close(); });

app.get("/api/v1/health", async () => ({ ok: true, service: "natacao-api", mode: process.env.NODE_ENV === "production" ? "production" : "validation", persistence, timestamp: new Date().toISOString() }));
app.get("/api/v1/openapi.json", async () => openapi);
app.post("/api/v1/auth/login", async (request, reply) => {
  const body = z.object({ email: z.string().trim().min(3), password: z.string().min(1) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Credenciais inválidas", details: body.error.flatten() });
  if (process.env.NODE_ENV === "production" && body.data.email.toLowerCase().endsWith("@natacao.local")) return reply.code(403).send({ error: "Contas demonstrativas estão desativadas em produção" });
  const key = body.data.email.trim().toLowerCase();
  const currentAttempt = loginAttempts.get(key);
  if (currentAttempt && currentAttempt.blockedUntil > Date.now()) return reply.code(429).send({ error: "Muitas tentativas. Aguarde alguns minutos." });
  const result = await login(body.data.email, body.data.password);
  if (!result) {
    const failures = (currentAttempt?.failures ?? 0) + 1;
    loginAttempts.set(key, { failures, blockedUntil: failures >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
    return reply.code(401).send({ error: "E-mail, CPF ou senha incorretos" });
  }
  loginAttempts.delete(key);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookieName = process.env.NODE_ENV === "production" ? "__Host-natacao_session" : "natacao_session";
  reply.header("Set-Cookie", `${cookieName}=${result.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure}`);
  return reply.send({ user: result.user });
});
app.post("/api/v1/auth/logout", async (request, reply) => { await logout(sessionToken(request)); const cookieName = process.env.NODE_ENV === "production" ? "__Host-natacao_session" : "natacao_session"; reply.header("Set-Cookie", `${cookieName}=; HttpOnly; Path=/; Max-Age=0`); return reply.send({ ok: true }); });
app.get("/api/v1/auth/me", async (request, reply) => { const user = await getSession(sessionToken(request)); if (!user) return reply.code(401).send({ error: "Sessão não encontrada" }); return reply.send({ user }); });
app.get("/api/v1/auth/demo-accounts", async (_request, reply) => process.env.NODE_ENV === "production" ? reply.code(404).send({ error: "Rota indisponível" }) : ({ mode: "demo", accounts: [{ email: "coach@natacao.local", password: "natacao-demo", role: "coach" }, { email: "ana@natacao.local", cpf: "123.456.789-00", password: "natacao-demo", role: "athlete" }] }));
app.get("/api/v1/invitations/:token", async (request, reply) => {
  const params = z.object({ token: z.string().min(20).max(160) }).safeParse(request.params);
  if (!params.success) return reply.code(404).send({ error: "Convite inexistente, expirado ou já utilizado" });
  const { token } = params.data;
  const invitation = managedStore.list("invitations").find((item) => item.tokenHash === createHash("sha256").update(token).digest("hex"));
  if (!invitation || invitation.status !== "pending" || String(invitation.expiresAt ?? "") <= new Date().toISOString()) return reply.code(404).send({ error: "Convite inexistente, expirado ou já utilizado" });
  const athlete = managedStore.get("athletes", String(invitation.athleteId));
  return { valid: true, athlete: athlete ? { id: athlete.id, name: athlete.name, group: athlete.group } : undefined, email: invitation.email, expiresAt: invitation.expiresAt };
});
app.post("/api/v1/invitations/:token/accept", async (request, reply) => {
  const params = z.object({ token: z.string().min(20).max(160) }).safeParse(request.params);
  if (!params.success) return reply.code(404).send({ error: "Convite inexistente, expirado ou já utilizado" });
  const { token } = params.data;
  const body = z.object({ password: z.string().min(8).max(200), name: z.string().trim().min(2).max(160).optional(), profile: invitationProfileSchema.optional() }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Aceite de convite inválido", details: body.error.flatten() });
  const invitation = managedStore.list("invitations").find((item) => item.tokenHash === createHash("sha256").update(token).digest("hex"));
  if (!invitation || invitation.status !== "pending" || String(invitation.expiresAt ?? "") <= new Date().toISOString()) return reply.code(404).send({ error: "Convite inexistente, expirado ou já utilizado" });
  const athlete = managedStore.get("athletes", String(invitation.athleteId));
  if (!athlete || typeof invitation.email !== "string") return reply.code(404).send({ error: "Atleta do convite não encontrado" });
  const provisioned = provisionInvitedAthlete({ athleteId: athlete.id, organizationId: String(invitation.organizationId ?? "org-demo"), name: body.data.name ?? String(athlete.name ?? "Atleta"), email: invitation.email, password: body.data.password });
  if ("error" in provisioned) return reply.code(provisioned.error === "email_in_use" ? 409 : 400).send({ error: provisioned.error === "email_in_use" ? "E-mail já possui uma conta" : "A senha deve ter ao menos 8 caracteres" });
  managedStore.update("athletes", athlete.id, { name: body.data.name ?? athlete.name, email: invitation.email, status: "active", onboardingStatus: "completed", ...(body.data.profile ?? {}) }, "update");
  managedStore.update("invitations", invitation.id, { status: "accepted", acceptedAt: new Date().toISOString(), acceptedBy: provisioned.user.id }, "update");
  const session = await login(invitation.email, body.data.password);
  if (!session) return reply.code(500).send({ error: "Conta criada, mas não foi possível iniciar a sessão" });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookieName = process.env.NODE_ENV === "production" ? "__Host-natacao_session" : "natacao_session";
  reply.header("Set-Cookie", `${cookieName}=${session.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure}`);
  return reply.code(201).send({ ok: true, user: session.user, athlete: managedStore.get("athletes", athlete.id) });
});
async function requireRoles(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { send: (value: unknown) => unknown } }, roles: Array<"admin" | "coach" | "athlete">) {
  const user = await getSession(sessionToken(request));
  if (!user || !roleAllows(user, roles)) { reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" }); return undefined; }
  return user;
}
app.get("/api/v1/dashboard", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin"]);
  if (!user) return;
  const overview = managedStore.analytics(8, user.organizationId);
  return { organization: { id: user.organizationId, name: "RKF Coach" }, kpis: overview.metrics, agenda: managedStore.list("workouts").filter((item) => item.organizationId === user.organizationId), load: managedStore.list("loadCalculations").filter((item) => item.organizationId === user.organizationId).slice(0, 10), connections: managedStore.list("syncJobs").filter((item) => item.organizationId === user.organizationId) };
});
app.get("/api/v1/athletes", async (request, reply) => { const user = await requireRoles(request, reply, ["coach", "admin"]); return user ? ({ data: managedStore.list("athletes").filter((item) => item.organizationId === user.organizationId) }) : undefined; });
app.get("/api/v1/groups", async (request, reply) => { const user = await requireRoles(request, reply, ["coach", "admin"]); return user ? ({ data: managedStore.list("groups").filter((item) => item.organizationId === user.organizationId) }) : undefined; });
app.get("/api/v1/pools", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? ({ data: store.pools }) : undefined);
app.get("/api/v1/workouts", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin"]);
  return user ? ({ data: managedStore.list("workouts").filter((item) => item.organizationId === user.organizationId), prescriptions: managedStore.list("prescriptions").filter((item) => item.organizationId === user.organizationId) }) : undefined;
});
app.get("/api/v1/completed-workouts", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin"]);
  return user ? ({ data: managedStore.list("sessionExecutions").filter((item) => item.organizationId === user.organizationId) }) : undefined;
});
app.get("/api/v1/wellness", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin"]);
  return user ? ({ data: managedStore.list("athleteResponses").filter((item) => item.organizationId === user.organizationId) }) : undefined;
});
app.patch("/api/v1/athlete/profile", async (request, reply) => {
  const user = await requireRoles(request, reply, ["athlete"]);
  if (!user) return;
  const body = z.object({
    name: z.string().trim().min(2).max(160).optional(),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sex: z.string().trim().max(40).optional(),
    category: z.string().trim().max(80).optional(),
    events: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
    otherEvent: z.string().trim().max(80).optional(),
    level: z.string().trim().max(80).optional(),
    club: z.string().trim().max(160).optional(),
    targetMeet: z.string().trim().max(160).optional(),
    meetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    primaryEvent: z.string().trim().max(80).optional(),
    secondaryEvent: z.string().trim().max(80).optional(),
    objective: z.string().trim().max(160).optional(),
    availability: z.object({ sessionsPerWeek: z.number().int().min(3).max(12), days: z.array(z.string()).max(7), periods: z.array(z.string()).max(3) }).optional(),
    consents: z.object({
      medical: z.object({ acceptedAt: z.string().datetime(), version: z.string().trim().min(1).max(40), origin: z.string().trim().min(1).max(80) }),
      responsibility: z.object({ acceptedAt: z.string().datetime(), version: z.string().trim().min(1).max(40), origin: z.string().trim().min(1).max(80) }),
    }).optional(),
    onboardingStatus: z.literal("completed").optional(),
  }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Perfil de atleta inválido", details: body.error.flatten() });
  const athleteId = user.athleteId;
  if (!athleteId) return reply.code(409).send({ error: "A conta não possui atleta vinculado" });
  const current = managedStore.get("athletes", athleteId);
  if (!current || current.organizationId !== user.organizationId) return reply.code(404).send({ error: "Perfil do atleta não encontrado" });
  const updated = managedStore.update("athletes", athleteId, { ...body.data, actorId: user.id, profileUpdatedAt: new Date().toISOString() }, "update");
  return reply.send(updated);
});
app.get("/api/v1/integrations", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? ({ data: store.connections, syncJobs: store.syncJobs }) : undefined);

const workoutSchema = z.object({
  title: z.string().min(2), scheduledDate: z.string(), objective: z.string().default(""), sportContext: z.enum(["pool", "open_water"]), poolId: z.string().optional(), blocks: z.array(z.object({ id: z.string(), name: z.string(), order: z.number(), repeatCount: z.number().positive(), steps: z.array(z.object({ id: z.string(), order: z.number(), kind: z.enum(["warmup", "main", "recovery", "cooldown", "technical"]), repetitions: z.number().positive(), distanceMeters: z.number().nonnegative().optional(), durationSeconds: z.number().nonnegative().optional(), stroke: z.enum(["freestyle", "backstroke", "breaststroke", "butterfly", "individual_medley", "mixed", "drill"]), targetType: z.enum(["pace", "heart_rate", "rpe", "technique", "free"]), targetValue: z.string().optional(), intervalSeconds: z.number().nonnegative().optional(), equipment: z.array(z.string()), notes: z.string().optional() })) })),
});

app.post("/api/v1/workouts", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin"]);
  if (!user) return;
  const parsed = workoutSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Treino inválido", details: parsed.error.flatten() });
  const distanceMeters = parsed.data.blocks.reduce((total, block) => total + block.steps.reduce((blockTotal, step) => blockTotal + (step.distanceMeters ?? 0) * step.repetitions, 0) * block.repeatCount, 0);
  return reply.code(201).send(managedStore.create("workouts", { ...parsed.data, date: parsed.data.scheduledDate, distanceMeters, status: "draft", source: "canonical-api", organizationId: user.organizationId, actorId: user.id }));
});

app.post("/api/v1/workouts/:id/publish", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin"]);
  if (!user) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ targetType: z.enum(["team", "group", "athlete"]), targetId: z.string(), athleteOverrides: z.array(z.object({ athleteId: z.string(), changedFields: z.record(z.unknown()), note: z.string().optional() })).default([]) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Publicação inválida", details: body.error.flatten() });
  const managedWorkout = managedStore.get("workouts", params.id);
  if (managedWorkout && managedWorkout.organizationId === user.organizationId) {
    const published = managedStore.update("workouts", params.id, { status: "published", version: Number(managedWorkout.version ?? 1) + 1, targetType: body.data.targetType, targetId: body.data.targetId, athleteOverrides: body.data.athleteOverrides, publishedAt: new Date().toISOString(), actorId: user.id }, "update");
    const prescription = managedStore.create("prescriptions", { workoutId: params.id, athleteId: body.data.targetType === "athlete" ? body.data.targetId : `target:${body.data.targetType}:${body.data.targetId}`, title: String(managedWorkout.title ?? "Treino"), targetType: body.data.targetType, targetId: body.data.targetId, athleteOverrides: body.data.athleteOverrides, prescription: published, status: "PUBLISHED", immutable: true, approvedBy: user.id, approvedAt: new Date().toISOString(), organizationId: user.organizationId, actorId: user.id }, "create");
    return reply.send({ workout: published, prescription });
  }
  try { return reply.send(store.publishWorkout(params.id, body.data.targetType, body.data.targetId, body.data.athleteOverrides)); } catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : "Treino não encontrado" }); }
});

const completedSchema = z.object({ prescriptionId: z.string().optional(), athleteId: z.string(), startedAt: z.string(), endedAt: z.string(), distanceMeters: z.number().positive(), durationSeconds: z.number().positive(), completedSteps: z.number().nonnegative(), totalSteps: z.number().positive(), averageHeartRate: z.number().positive().optional(), averagePaceSecondsPer100m: z.number().positive().optional(), rpe: z.number().min(0).max(10).optional(), source: z.enum(["manual", "garmin", "polar", "apple", "synthetic"]), externalId: z.string().optional(), rawPayload: z.unknown().optional() });
app.post("/api/v1/completed-workouts", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin", "athlete"]);
  if (!user) return;
  const parsed = completedSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Execução inválida", details: parsed.error.flatten() });
  if (user.role === "athlete" && !athleteMayAccess(user, parsed.data.athleteId)) return reply.code(403).send({ error: "Atleta só pode registrar a própria execução" });
  const completed = store.recordCompleted(parsed.data);
  const internalLoad = parsed.data.rpe === undefined ? undefined : parsed.data.rpe * (parsed.data.durationSeconds / 60);
  const existingActivity = parsed.data.externalId
    ? managedStore.list("activities").find((item) => item.externalId === parsed.data.externalId && item.organizationId === user.organizationId)
    : undefined;
  const snapshot = store.loadSnapshots.slice().reverse().find((item) => item.athleteId === parsed.data.athleteId && item.date === parsed.data.startedAt.slice(0, 10));
  if (!existingActivity) {
    managedStore.create("activities", {
      type: "rkf-load-session",
      title: "Execução confirmada",
      athleteId: parsed.data.athleteId,
      date: parsed.data.startedAt.slice(0, 10),
      startedAt: parsed.data.startedAt,
      endedAt: parsed.data.endedAt,
      distanceMeters: parsed.data.distanceMeters,
      executedVolumeM: parsed.data.distanceMeters,
      durationMinutes: parsed.data.durationSeconds / 60,
      pse: parsed.data.rpe,
      load: internalLoad,
      prescribedVolumeM: parsed.data.distanceMeters,
      source: parsed.data.source,
      externalId: parsed.data.externalId,
      rawPayload: parsed.data.rawPayload,
      status: "confirmed",
      organizationId: user.organizationId,
      actorId: user.id,
    }, "create");
    managedStore.create("sessionExecutions", {
      completedWorkoutId: completed.id,
      athleteId: parsed.data.athleteId,
      date: parsed.data.startedAt.slice(0, 10),
      distanceMeters: parsed.data.distanceMeters,
      durationSeconds: parsed.data.durationSeconds,
      rpe: parsed.data.rpe,
      source: parsed.data.source,
      externalId: parsed.data.externalId,
      status: "confirmed",
      organizationId: user.organizationId,
      actorId: user.id,
    }, "create");
    if (snapshot) managedStore.create("loadCalculations", {
      athleteId: parsed.data.athleteId,
      date: snapshot.date,
      value: internalLoad,
      acute: snapshot.acute,
      chronic: snapshot.chronic,
      components: snapshot.components,
      engine: snapshot.engine,
      engineVersion: snapshot.engineVersion,
      source: snapshot.source,
      organizationId: user.organizationId,
      actorId: user.id,
    }, "create");
  }
  return reply.code(201).send(completed);
});

const wellnessSchema = z.object({ athleteId: z.string(), date: z.string(), sleepHours: z.number().min(0).max(24).optional(), fatigue: z.number().min(0).max(10).optional(), soreness: z.number().min(0).max(10).optional(), pain: z.number().min(0).max(10).optional(), note: z.string().max(2000).optional() });
app.post("/api/v1/wellness", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin", "athlete"]);
  if (!user) return;
  const parsed = wellnessSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Check-in inválido", details: parsed.error.flatten() });
  if (user.role === "athlete" && !athleteMayAccess(user, parsed.data.athleteId)) return reply.code(403).send({ error: "Atleta só pode registrar o próprio check-in" });
  const checkin = store.addWellness(parsed.data);
  managedStore.create("athleteResponses", {
    id: checkin.id,
    athleteId: parsed.data.athleteId,
    date: parsed.data.date,
    sleepHours: parsed.data.sleepHours,
    fatigue: parsed.data.fatigue,
    soreness: parsed.data.soreness,
    pain: parsed.data.pain,
    note: parsed.data.note,
    source: "manual",
    organizationId: user.organizationId,
    actorId: user.id,
  }, "create");
  return reply.code(201).send(checkin);
});

app.post("/api/v1/sync/:provider", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin"]);
  if (!user) return;
  const params = z.object({ provider: z.enum(["garmin", "polar", "apple"]) }).parse(request.params);
  const body = z.object({ athleteId: z.string(), direction: z.enum(["push", "pull"]) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Sincronização inválida", details: body.error.flatten() });
  const scopedAthlete = managedStore.get("athletes", body.data.athleteId);
  if (!scopedAthlete || scopedAthlete.organizationId !== user.organizationId) return reply.code(404).send({ error: "Atleta não encontrado nesta organização" });
  try {
    const result = await store.sync(params.provider, body.data.athleteId, body.data.direction);
    managedStore.create("syncJobs", { id: result.job.id, connectionId: result.job.connectionId, provider: result.job.provider, direction: result.job.direction, status: result.job.status, idempotencyKey: result.job.idempotencyKey, externalId: result.job.externalId, createdAtSource: result.job.createdAt, completedAt: result.job.completedAt, athleteId: body.data.athleteId, source: "simulator", organizationId: user!.organizationId, actorId: user!.id });
    if ("imported" in result && Array.isArray(result.imported)) {
      for (const activity of result.imported) {
        if (!managedStore.list("activities").some((item) => item.externalId && item.externalId === activity.externalId && item.organizationId === user.organizationId)) managedStore.create("activities", { ...activity, source: params.provider, importJobId: result.job.id, organizationId: user.organizationId, actorId: user.id });
      }
    }
    return reply.send(result);
  } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : "Falha de sincronização" }); }
});

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
