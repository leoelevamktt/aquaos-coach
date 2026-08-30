import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { openapi } from "./openapi.js";
import { DemoStore } from "./store.js";
import { athleteMayAccess, attachAuthStore, getSession, login, logout, roleAllows, sessionToken } from "./auth.js";
import { ManagedStore } from "./managed-store.js";
import { registerOperationalRoutes, uploadRoot } from "./operational-routes.js";
import { registerAiRoutes } from "./ai-routes.js";
import { registerRkfRoutes } from "./rkf-routes.js";
import { registerReportRoutes } from "./report-routes.js";
import { basename } from "node:path";

const app = Fastify({ logger: true });
const store = new DemoStore();
const managedStore = new ManagedStore();
const persistence = await managedStore.initialize();
attachAuthStore(managedStore);
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean);
await app.register(cors, { origin: allowedOrigins, credentials: true });
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 1 } });
const publicApiPaths = new Set(["/api/v1/health", "/api/v1/openapi.json", "/api/v1/auth/login", "/api/v1/auth/demo-accounts"]);
app.addHook("onRequest", async (request, reply) => {
  const path = request.url.split("?")[0];
  const origin = request.headers.origin;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && origin && !allowedOrigins.includes(origin)) return reply.code(403).send({ error: "Origem não autorizada" });
  const user = await getSession(sessionToken(request));
  if (path.startsWith("/api/v1/") && !publicApiPaths.has(path) && !user) return reply.code(401).send({ error: "Autenticação necessária" });
  if (path.startsWith("/uploads/")) {
    if (!user) return reply.code(401).send({ error: "Autenticação necessária" });
    const filename = basename(decodeURIComponent(path));
    const record = [...managedStore.list("videos"), ...managedStore.list("documents")].find((item) => (item.filename === filename || (typeof item.thumbnailUrl === "string" && basename(item.thumbnailUrl) === filename)) && item.organizationId === user.organizationId);
    const ownFile = user.role !== "athlete" || athleteMayAccess(user, String(record?.athleteId ?? ""));
    if (!record || !ownFile) return reply.code(404).send({ error: "Arquivo não encontrado" });
  }
});
await app.register(fastifyStatic, { root: uploadRoot, prefix: "/uploads/", decorateReply: false });
registerOperationalRoutes(app, managedStore);
registerAiRoutes(app, managedStore);
registerRkfRoutes(app, managedStore);
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
async function requireRoles(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { send: (value: unknown) => unknown } }, roles: Array<"admin" | "coach" | "athlete">) {
  const user = await getSession(sessionToken(request));
  if (!user || !roleAllows(user, roles)) { reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" }); return undefined; }
  return user;
}
app.get("/api/v1/dashboard", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? store.dashboard() : undefined);
app.get("/api/v1/athletes", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? ({ data: store.athletes }) : undefined);
app.get("/api/v1/groups", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? ({ data: store.groups }) : undefined);
app.get("/api/v1/pools", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? ({ data: store.pools }) : undefined);
app.get("/api/v1/workouts", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? ({ data: store.workouts, prescriptions: store.prescriptions }) : undefined);
app.get("/api/v1/completed-workouts", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? ({ data: store.completed }) : undefined);
app.get("/api/v1/wellness", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? ({ data: store.wellness }) : undefined);
app.get("/api/v1/integrations", async (request, reply) => await requireRoles(request, reply, ["coach", "admin"]) ? ({ data: store.connections, syncJobs: store.syncJobs }) : undefined);

const workoutSchema = z.object({
  title: z.string().min(2), scheduledDate: z.string(), objective: z.string().default(""), sportContext: z.enum(["pool", "open_water"]), poolId: z.string().optional(), blocks: z.array(z.object({ id: z.string(), name: z.string(), order: z.number(), repeatCount: z.number().positive(), steps: z.array(z.object({ id: z.string(), order: z.number(), kind: z.enum(["warmup", "main", "recovery", "cooldown", "technical"]), repetitions: z.number().positive(), distanceMeters: z.number().nonnegative().optional(), durationSeconds: z.number().nonnegative().optional(), stroke: z.enum(["freestyle", "backstroke", "breaststroke", "butterfly", "individual_medley", "mixed", "drill"]), targetType: z.enum(["pace", "heart_rate", "rpe", "technique", "free"]), targetValue: z.string().optional(), intervalSeconds: z.number().nonnegative().optional(), equipment: z.array(z.string()), notes: z.string().optional() })) })),
});

app.post("/api/v1/workouts", async (request, reply) => {
  if (!await requireRoles(request, reply, ["coach", "admin"])) return;
  const parsed = workoutSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Treino inválido", details: parsed.error.flatten() });
  return reply.code(201).send(store.createWorkout(parsed.data));
});

app.post("/api/v1/workouts/:id/publish", async (request, reply) => {
  if (!await requireRoles(request, reply, ["coach", "admin"])) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ targetType: z.enum(["team", "group", "athlete"]), targetId: z.string(), athleteOverrides: z.array(z.object({ athleteId: z.string(), changedFields: z.record(z.unknown()), note: z.string().optional() })).default([]) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Publicação inválida", details: body.error.flatten() });
  try { return reply.send(store.publishWorkout(params.id, body.data.targetType, body.data.targetId, body.data.athleteOverrides)); } catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : "Treino não encontrado" }); }
});

const completedSchema = z.object({ prescriptionId: z.string().optional(), athleteId: z.string(), startedAt: z.string(), endedAt: z.string(), distanceMeters: z.number().positive(), durationSeconds: z.number().positive(), completedSteps: z.number().nonnegative(), totalSteps: z.number().positive(), averageHeartRate: z.number().positive().optional(), averagePaceSecondsPer100m: z.number().positive().optional(), rpe: z.number().min(0).max(10).optional(), source: z.enum(["manual", "garmin", "polar", "apple", "synthetic"]), externalId: z.string().optional(), rawPayload: z.unknown().optional() });
app.post("/api/v1/completed-workouts", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin", "athlete"]);
  if (!user) return;
  const parsed = completedSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Execução inválida", details: parsed.error.flatten() });
  if (user.role === "athlete" && !athleteMayAccess(user, parsed.data.athleteId)) return reply.code(403).send({ error: "Atleta só pode registrar a própria execução" });
  return reply.code(201).send(store.recordCompleted(parsed.data));
});

const wellnessSchema = z.object({ athleteId: z.string(), date: z.string(), sleepHours: z.number().min(0).max(24).optional(), fatigue: z.number().min(0).max(10).optional(), soreness: z.number().min(0).max(10).optional(), pain: z.number().min(0).max(10).optional(), note: z.string().max(2000).optional() });
app.post("/api/v1/wellness", async (request, reply) => {
  const user = await requireRoles(request, reply, ["coach", "admin", "athlete"]);
  if (!user) return;
  const parsed = wellnessSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Check-in inválido", details: parsed.error.flatten() });
  if (user.role === "athlete" && !athleteMayAccess(user, parsed.data.athleteId)) return reply.code(403).send({ error: "Atleta só pode registrar o próprio check-in" });
  return reply.code(201).send(store.addWellness(parsed.data));
});

app.post("/api/v1/sync/:provider", async (request, reply) => {
  if (!await requireRoles(request, reply, ["coach", "admin"])) return;
  const params = z.object({ provider: z.enum(["garmin", "polar", "apple"]) }).parse(request.params);
  const body = z.object({ athleteId: z.string(), direction: z.enum(["push", "pull"]) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Sincronização inválida", details: body.error.flatten() });
  try { return reply.send(await store.sync(params.provider, body.data.athleteId, body.data.direction)); } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : "Falha de sincronização" }); }
});

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
