import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { openapi } from "./openapi.js";
import { DemoStore } from "./store.js";
import { getSession, login, logout, roleAllows, sessionToken } from "./auth.js";
import { ManagedStore } from "./managed-store.js";
import { registerOperationalRoutes, uploadRoot } from "./operational-routes.js";

const app = Fastify({ logger: true });
const store = new DemoStore();
const managedStore = new ManagedStore();

await app.register(cors, { origin: true, credentials: true });
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 1 } });
await app.register(fastifyStatic, { root: uploadRoot, prefix: "/uploads/", decorateReply: false });
registerOperationalRoutes(app, managedStore);

app.get("/api/v1/health", async () => ({ ok: true, service: "natacao-api", mode: "demo", timestamp: new Date().toISOString() }));
app.get("/api/v1/openapi.json", async () => openapi);
app.post("/api/v1/auth/login", async (request, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Credenciais inválidas", details: body.error.flatten() });
  const result = login(body.data.email, body.data.password);
  if (!result) return reply.code(401).send({ error: "E-mail ou senha incorretos" });
  reply.header("Set-Cookie", `natacao_session=${result.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`);
  return reply.send({ user: result.user });
});
app.post("/api/v1/auth/logout", async (request, reply) => { logout(sessionToken(request)); reply.header("Set-Cookie", "natacao_session=; HttpOnly; Path=/; Max-Age=0"); return reply.send({ ok: true }); });
app.get("/api/v1/auth/me", async (request, reply) => { const user = getSession(sessionToken(request)); if (!user) return reply.code(401).send({ error: "Sessão não encontrada" }); return reply.send({ user }); });
app.get("/api/v1/auth/demo-accounts", async () => ({ mode: "demo", accounts: [{ email: "coach@natacao.local", password: "natacao-demo", role: "coach" }, { email: "ana@natacao.local", password: "natacao-demo", role: "athlete" }] }));
app.get("/api/v1/dashboard", async () => store.dashboard());
app.get("/api/v1/athletes", async () => ({ data: store.athletes }));
app.get("/api/v1/groups", async () => ({ data: store.groups }));
app.get("/api/v1/pools", async () => ({ data: store.pools }));
app.get("/api/v1/workouts", async () => ({ data: store.workouts, prescriptions: store.prescriptions }));
app.get("/api/v1/completed-workouts", async () => ({ data: store.completed }));
app.get("/api/v1/wellness", async () => ({ data: store.wellness }));
app.get("/api/v1/integrations", async () => ({ data: store.connections, syncJobs: store.syncJobs }));

const workoutSchema = z.object({
  title: z.string().min(2), scheduledDate: z.string(), objective: z.string().default(""), sportContext: z.enum(["pool", "open_water"]), poolId: z.string().optional(), blocks: z.array(z.object({ id: z.string(), name: z.string(), order: z.number(), repeatCount: z.number().positive(), steps: z.array(z.object({ id: z.string(), order: z.number(), kind: z.enum(["warmup", "main", "recovery", "cooldown", "technical"]), repetitions: z.number().positive(), distanceMeters: z.number().nonnegative().optional(), durationSeconds: z.number().nonnegative().optional(), stroke: z.enum(["freestyle", "backstroke", "breaststroke", "butterfly", "individual_medley", "mixed", "drill"]), targetType: z.enum(["pace", "heart_rate", "rpe", "technique", "free"]), targetValue: z.string().optional(), intervalSeconds: z.number().nonnegative().optional(), equipment: z.array(z.string()), notes: z.string().optional() })) })),
});

app.post("/api/v1/workouts", async (request, reply) => {
  const parsed = workoutSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Treino inválido", details: parsed.error.flatten() });
  return reply.code(201).send(store.createWorkout(parsed.data));
});

app.post("/api/v1/workouts/:id/publish", async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ targetType: z.enum(["team", "group", "athlete"]), targetId: z.string(), athleteOverrides: z.array(z.object({ athleteId: z.string(), changedFields: z.record(z.unknown()), note: z.string().optional() })).default([]) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Publicação inválida", details: body.error.flatten() });
  try { return reply.send(store.publishWorkout(params.id, body.data.targetType, body.data.targetId, body.data.athleteOverrides)); } catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : "Treino não encontrado" }); }
});

const completedSchema = z.object({ prescriptionId: z.string().optional(), athleteId: z.string(), startedAt: z.string(), endedAt: z.string(), distanceMeters: z.number().positive(), durationSeconds: z.number().positive(), completedSteps: z.number().nonnegative(), totalSteps: z.number().positive(), averageHeartRate: z.number().positive().optional(), averagePaceSecondsPer100m: z.number().positive().optional(), rpe: z.number().min(0).max(10).optional(), source: z.enum(["manual", "garmin", "polar", "apple", "synthetic"]), externalId: z.string().optional(), rawPayload: z.unknown().optional() });
app.post("/api/v1/completed-workouts", async (request, reply) => {
  const parsed = completedSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Execução inválida", details: parsed.error.flatten() });
  return reply.code(201).send(store.recordCompleted(parsed.data));
});

const wellnessSchema = z.object({ athleteId: z.string(), date: z.string(), sleepHours: z.number().min(0).max(24).optional(), fatigue: z.number().min(0).max(10).optional(), soreness: z.number().min(0).max(10).optional(), pain: z.number().min(0).max(10).optional(), note: z.string().max(2000).optional() });
app.post("/api/v1/wellness", async (request, reply) => {
  const parsed = wellnessSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Check-in inválido", details: parsed.error.flatten() });
  return reply.code(201).send(store.addWellness(parsed.data));
});

app.post("/api/v1/sync/:provider", async (request, reply) => {
  const params = z.object({ provider: z.enum(["garmin", "polar", "apple"]) }).parse(request.params);
  const body = z.object({ athleteId: z.string(), direction: z.enum(["push", "pull"]) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "Sincronização inválida", details: body.error.flatten() });
  try { return reply.send(await store.sync(params.provider, body.data.athleteId, body.data.direction)); } catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : "Falha de sincronização" }); }
});

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
