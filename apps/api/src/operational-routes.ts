import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { analyzeVideo } from "./video-analysis.js";
import { ManagedStore, parseDelimited, resourceKinds, type ResourceKind } from "./managed-store.js";

export const uploadRoot = process.env.STORAGE_PATH
  ? resolve(process.env.STORAGE_PATH, "uploads")
  : fileURLToPath(new URL("../storage/uploads/", import.meta.url));
mkdirSync(uploadRoot, { recursive: true });

const kindSchema = z.enum(resourceKinds);
const bodySchema = z.record(z.unknown());
const safeName = (name: string) => basename(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").toLowerCase();
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function registerOperationalRoutes(app: FastifyInstance, store: ManagedStore) {
  app.get("/api/v1/manage", async () => ({ resources: Object.fromEntries(resourceKinds.map((kind) => [kind, store.list(kind).length])), kinds: resourceKinds, audit: store.audit(15) }));
  app.get("/api/v1/manage/audit", async (request) => { const query = z.object({ limit: z.coerce.number().min(1).max(500).default(100) }).parse(request.query); return { data: store.audit(query.limit) }; });

  app.get("/api/v1/manage/:kind", async (request, reply) => {
    const parsed = kindSchema.safeParse((request.params as { kind?: string }).kind);
    if (!parsed.success) return reply.code(404).send({ error: "Módulo não encontrado" });
    return { data: store.list(parsed.data) };
  });
  app.get("/api/v1/manage/:kind/:id", async (request, reply) => {
    const params = z.object({ kind: kindSchema, id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Registro inválido" });
    const record = store.get(params.data.kind, params.data.id);
    return record ? reply.send(record) : reply.code(404).send({ error: "Registro não encontrado" });
  });
  app.post("/api/v1/manage/:kind", async (request, reply) => {
    const kind = kindSchema.safeParse((request.params as { kind?: string }).kind);
    const body = bodySchema.safeParse(request.body);
    if (!kind.success || !body.success) return reply.code(400).send({ error: "Dados inválidos" });
    return reply.code(201).send(store.create(kind.data, body.data));
  });
  app.patch("/api/v1/manage/:kind/:id", async (request, reply) => {
    const params = z.object({ kind: kindSchema, id: z.string() }).safeParse(request.params);
    const body = bodySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Dados inválidos" });
    const record = store.update(params.data.kind, params.data.id, body.data);
    return record ? reply.send(record) : reply.code(404).send({ error: "Registro não encontrado" });
  });
  app.delete("/api/v1/manage/:kind/:id", async (request, reply) => {
    const params = z.object({ kind: kindSchema, id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Registro inválido" });
    const existing = store.get(params.data.kind, params.data.id);
    if (existing && (params.data.kind === "videos" || params.data.kind === "documents")) {
      for (const fileName of [existing.filename, typeof existing.thumbnailUrl === "string" ? basename(existing.thumbnailUrl) : undefined]) {
        if (typeof fileName !== "string") continue;
        const target = resolve(uploadRoot, fileName);
        const root = `${resolve(uploadRoot)}${sep}`;
        if (target.startsWith(root) && existsSync(target)) unlinkSync(target);
      }
    }
    const record = store.remove(params.data.kind, params.data.id);
    return record ? reply.send({ ok: true, deleted: record }) : reply.code(404).send({ error: "Registro não encontrado" });
  });

  app.post("/api/v1/uploads", async (request, reply) => {
    const query = z.object({ kind: kindSchema.default("documents"), athleteId: z.string().optional(), title: z.string().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Parâmetros do upload inválidos" });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Selecione um arquivo" });
    const extension = extname(file.filename).toLowerCase();
    const allowed = [".mp4", ".mov", ".m4v", ".pdf", ".csv", ".json", ".fit", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx"];
    if (!allowed.includes(extension)) return reply.code(415).send({ error: `Formato ${extension || "desconhecido"} não permitido` });
    const filename = `${Date.now()}-${safeName(file.filename)}`;
    const buffer = await file.toBuffer();
    writeFileSync(resolve(uploadRoot, filename), buffer);
    const resource = query.data.kind === "videos" ? "videos" : "documents";
    const record = store.create(resource, {
      title: query.data.title ?? file.filename.replace(extension, ""), filename, originalName: file.filename,
      mimeType: file.mimetype, sizeBytes: buffer.length, url: `/uploads/${filename}`, athleteId: query.data.athleteId,
      status: resource === "videos" ? "processing" : "ready", analysisStatus: resource === "videos" ? "pending" : undefined,
    }, "upload");
    return reply.code(201).send(record);
  });

  app.post("/api/v1/import/:kind", async (request, reply) => {
    const parsedKind = kindSchema.safeParse((request.params as { kind?: string }).kind);
    if (!parsedKind.success) return reply.code(400).send({ error: "Destino de importação inválido" });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Selecione CSV, JSON ou FIT" });
    const buffer = await file.toBuffer();
    const extension = extname(file.filename).toLowerCase();
    if (extension === ".csv") {
      const rows = parseDelimited(buffer.toString("utf8"));
      if (!rows.length) return reply.code(422).send({ error: "O CSV não possui linhas importáveis" });
      return reply.code(201).send(store.importRows(parsedKind.data, rows));
    }
    if (extension === ".json") {
      const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return reply.code(201).send(store.importRows(parsedKind.data, rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")));
    }
    if (extension === ".fit") {
      const fitSdk = await import("@garmin/fitsdk") as unknown as {
        Stream: { fromBuffer: (value: Uint8Array) => unknown };
        Decoder: { new(stream: unknown): { read: () => { messages: unknown; profileVersion: unknown; errors: Error[] } }; isFIT: (stream: unknown) => boolean };
      };
      const stream = fitSdk.Stream.fromBuffer(buffer);
      if (!fitSdk.Decoder.isFIT(stream)) return reply.code(422).send({ error: "Arquivo FIT inválido" });
      const decoded = new fitSdk.Decoder(stream).read();
      const messages = decoded.messages as unknown as Record<string, unknown[]>;
      const sessions = (messages.sessionMesgs ?? []) as Record<string, unknown>[];
      const laps = (messages.lapMesgs ?? []) as Record<string, unknown>[];
      const lengths = (messages.lengthMesgs ?? []) as Record<string, unknown>[];
      const record = store.create("activities", {
        title: file.filename.replace(extension, ""), source: "fit", status: decoded.errors.length ? "imported_with_warnings" : "imported",
        profileVersion: decoded.profileVersion, session: sessions[0] ?? null, laps: laps.length, lengths: lengths.length,
        messageCounts: Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])), errors: decoded.errors.map((error: Error) => error.message),
      }, "import");
      const filename = `${Date.now()}-${safeName(file.filename)}`;
      writeFileSync(resolve(uploadRoot, filename), buffer);
      store.update("activities", record.id, { filename, url: `/uploads/${filename}`, sizeBytes: buffer.length });
      return reply.code(201).send({ imported: 1, records: [record] });
    }
    return reply.code(415).send({ error: "Use arquivos CSV, JSON ou FIT" });
  });

  app.post("/api/v1/videos/:id/analyze", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const record = store.get("videos", params.id);
    if (!record || typeof record.filename !== "string") return reply.code(404).send({ error: "Vídeo não encontrado" });
    store.update("videos", params.id, { analysisStatus: "processing", status: "processing" });
    try {
      const thumbnail = `${record.filename.replace(extname(record.filename), "")}-thumb.jpg`;
      const analysis = await analyzeVideo(resolve(uploadRoot, record.filename), resolve(uploadRoot, thumbnail));
      return reply.send(store.update("videos", params.id, { analysisStatus: "ready", status: "ready", analysis, thumbnailUrl: `/uploads/${thumbnail}`, ...analysis.metadata }, "analyze"));
    } catch (error) {
      store.update("videos", params.id, { analysisStatus: "failed", status: "ready", analysisError: error instanceof Error ? error.message : "Falha desconhecida" });
      return reply.code(422).send({ error: error instanceof Error ? error.message : "Não foi possível analisar o vídeo" });
    }
  });

  app.post("/api/v1/videos/:id/events", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ time: z.number().nonnegative(), category: z.string(), label: z.string().min(1), note: z.string().optional() }).safeParse(request.body);
    const record = store.get("videos", params.id);
    if (!record || !body.success) return reply.code(400).send({ error: "Marcador inválido" });
    const manualEvents = Array.isArray(record.manualEvents) ? record.manualEvents : [];
    return reply.code(201).send(store.update("videos", params.id, { manualEvents: [...manualEvents, { id: id("event"), ...body.data, createdAt: new Date().toISOString() }] }));
  });
}
