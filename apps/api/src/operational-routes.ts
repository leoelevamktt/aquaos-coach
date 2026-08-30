import type { FastifyInstance } from "fastify";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { analyzeVideo } from "./video-analysis.js";
import { ManagedStore, parseDelimited, resourceKinds, type ResourceKind } from "./managed-store.js";
import { athleteMayAccess, getSession, roleAllows, sessionToken } from "./auth.js";
import { extractDocument, signatureMatches } from "./document-extraction.js";
import { pipeline } from "node:stream/promises";

export const uploadRoot = process.env.STORAGE_PATH
  ? resolve(process.env.STORAGE_PATH, "uploads")
  : fileURLToPath(new URL("../storage/uploads/", import.meta.url));
mkdirSync(uploadRoot, { recursive: true });

const kindSchema = z.enum(resourceKinds);
const bodySchema = z.record(z.unknown());
const safeName = (name: string) => basename(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").toLowerCase();
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function registerOperationalRoutes(app: FastifyInstance, store: ManagedStore) {
  const protectedKinds = ["ingestions", "prescriptions", "results", "loadSnapshots", "adaptationDecisions", "governance"];
  app.get("/api/v1/manage", async (request, reply) => { const user = getSession(sessionToken(request)); if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" }); return { resources: Object.fromEntries(resourceKinds.map((kind) => [kind, store.list(kind).filter((item) => item.organizationId === user!.organizationId).length])), kinds: resourceKinds, audit: store.audit(15) }; });
  app.get("/api/v1/manage/audit", async (request, reply) => { const user = getSession(sessionToken(request)); if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" }); const query = z.object({ limit: z.coerce.number().min(1).max(500).default(100) }).parse(request.query); return { data: store.audit(500).filter((entry) => (entry.organizationId ?? "org-demo") === user!.organizationId).slice(0, query.limit) }; });

  app.get("/api/v1/manage/:kind", async (request, reply) => {
    const user = getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" });
    const parsed = kindSchema.safeParse((request.params as { kind?: string }).kind);
    if (!parsed.success) return reply.code(404).send({ error: "Módulo não encontrado" });
    return { data: store.list(parsed.data).filter((item) => item.organizationId === user!.organizationId) };
  });
  app.get("/api/v1/manage/:kind/:id", async (request, reply) => {
    const user = getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" });
    const params = z.object({ kind: kindSchema, id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Registro inválido" });
    const record = store.get(params.data.kind, params.data.id);
    return record && record.organizationId === user!.organizationId ? reply.send(record) : reply.code(404).send({ error: "Registro não encontrado" });
  });
  app.post("/api/v1/manage/:kind", async (request, reply) => {
    const kind = kindSchema.safeParse((request.params as { kind?: string }).kind);
    const body = bodySchema.safeParse(request.body);
    if (!kind.success || !body.success) return reply.code(400).send({ error: "Dados inválidos" });
    const user = getSession(sessionToken(request));
    const athleteActivity = kind.data === "activities" && user?.role === "athlete";
    if (!roleAllows(user, ["coach", "admin"]) && !athleteActivity) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" });
    if (protectedKinds.includes(kind.data)) return reply.code(403).send({ error: "Use o fluxo RKF dedicado para preservar auditoria e imutabilidade" });
    const athleteScoped = athleteActivity ? { ...body.data, athleteId: user!.athleteId } : body.data;
    return reply.code(201).send(store.create(kind.data, { ...athleteScoped, organizationId: user!.organizationId, actorId: user!.id }));
  });
  app.patch("/api/v1/manage/:kind/:id", async (request, reply) => {
    const params = z.object({ kind: kindSchema, id: z.string() }).safeParse(request.params);
    const body = bodySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Dados inválidos" });
    const user = getSession(sessionToken(request));
    const athleteSelfEdit = params.data.kind === "athletes" && user?.role === "athlete" && athleteMayAccess(user, params.data.id);
    if (!roleAllows(user, ["coach", "admin"]) && !athleteSelfEdit) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" });
    if (protectedKinds.includes(params.data.kind)) return reply.code(403).send({ error: "Registro RKF protegido contra alteração genérica" });
    const existingRecord = store.get(params.data.kind, params.data.id);
    if (!existingRecord || existingRecord.organizationId !== user!.organizationId) return reply.code(404).send({ error: "Registro não encontrado" });
    const { id: _id, organizationId: _organizationId, actorId: _actorId, createdAt: _createdAt, ...safePatch } = body.data;
    const record = store.update(params.data.kind, params.data.id, { ...safePatch, actorId: user!.id });
    return record ? reply.send(record) : reply.code(404).send({ error: "Registro não encontrado" });
  });
  app.delete("/api/v1/manage/:kind/:id", async (request, reply) => {
    const params = z.object({ kind: kindSchema, id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Registro inválido" });
    const user = getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" });
    if (protectedKinds.includes(params.data.kind)) return reply.code(403).send({ error: "Registro RKF protegido contra exclusão genérica" });
    const scopedRecord = store.get(params.data.kind, params.data.id);
    if (!scopedRecord || scopedRecord.organizationId !== user!.organizationId) return reply.code(404).send({ error: "Registro não encontrado" });
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
    const user = getSession(sessionToken(request));
    if (!user) return reply.code(401).send({ error: "Autenticação necessária" });
    const query = z.object({ kind: kindSchema.default("documents"), athleteId: z.string().optional(), title: z.string().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Parâmetros do upload inválidos" });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Selecione um arquivo" });
    const extension = extname(file.filename).toLowerCase();
    const allowed = [".mp4", ".mov", ".m4v", ".pdf", ".csv", ".json", ".fit", ".txt", ".jpg", ".jpeg", ".png", ".heic", ".doc", ".docx", ".xls", ".xlsx"];
    if (!allowed.includes(extension)) return reply.code(415).send({ error: `Formato ${extension || "desconhecido"} não permitido` });
    const filename = `${Date.now()}-${safeName(file.filename)}`;
    if (user.role === "athlete" && query.data.athleteId && !athleteMayAccess(user, query.data.athleteId)) return reply.code(403).send({ error: "Atleta só pode anexar arquivos ao próprio prontuário" });
    const resource = query.data.kind === "videos" ? "videos" : "documents";
    const target = resolve(uploadRoot, filename);
    let sizeBytes = 0;
    let sha256 = "";
    let extraction: Awaited<ReturnType<typeof extractDocument>> | undefined;
    if (resource === "videos") {
      const temporary = `${target}.uploading`;
      const hash = createHash("sha256");
      file.file.on("data", (chunk: Buffer) => hash.update(chunk));
      try {
        await pipeline(file.file, createWriteStream(temporary, { flags: "wx" }));
        sizeBytes = statSync(temporary).size;
        const descriptor = openSync(temporary, "r");
        const header = Buffer.alloc(16); const bytes = readSync(descriptor, header, 0, header.length, 0); closeSync(descriptor);
        if (!signatureMatches(header.subarray(0, bytes), extension)) { unlinkSync(temporary); return reply.code(415).send({ error: "O conteúdo do vídeo não corresponde à extensão informada" }); }
        sha256 = hash.digest("hex");
        renameSync(temporary, target);
      } catch (error) {
        if (existsSync(temporary)) unlinkSync(temporary);
        throw error;
      }
    } else {
      const buffer = await file.toBuffer();
      if (!signatureMatches(buffer, extension)) return reply.code(415).send({ error: "O conteúdo do arquivo não corresponde à extensão informada" });
      if (buffer.length > 25 * 1024 * 1024) return reply.code(413).send({ error: "Documentos devem ter no máximo 25 MB" });
      sizeBytes = buffer.length; sha256 = createHash("sha256").update(buffer).digest("hex");
      extraction = await extractDocument(buffer, file.filename);
      writeFileSync(target, buffer);
    }
    const duplicate = store.list(resource).find((item) => item.organizationId === user.organizationId && item.sha256 === sha256);
    if (duplicate) { if (existsSync(target)) unlinkSync(target); return reply.code(200).send({ ...duplicate, duplicate: true }); }
    const record = store.create(resource, {
      title: query.data.title ?? file.filename.replace(extension, ""), filename, originalName: file.filename,
      mimeType: file.mimetype, sizeBytes, url: `/uploads/${filename}`, athleteId: query.data.athleteId,
      status: resource === "videos" ? "processing" : "ready", analysisStatus: resource === "videos" ? "pending" : undefined,
      organizationId: user.organizationId, actorId: user.id, sha256,
      extractionStatus: extraction?.status, extraction,
    }, "upload");
    return reply.code(201).send(record);
  });

  app.post("/api/v1/import/:kind", async (request, reply) => {
    const user = getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" });
    const parsedKind = kindSchema.safeParse((request.params as { kind?: string }).kind);
    if (!parsedKind.success) return reply.code(400).send({ error: "Destino de importação inválido" });
    if (protectedKinds.includes(parsedKind.data)) return reply.code(403).send({ error: "Recurso protegido exige fluxo RKF dedicado" });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Selecione CSV, JSON ou FIT" });
    const buffer = await file.toBuffer();
    const extension = extname(file.filename).toLowerCase();
    const sanitize = (row: Record<string, unknown>) => {
      const { id: _id, organizationId: _organizationId, actorId: _actorId, createdAt: _createdAt, updatedAt: _updatedAt, ...safe } = row;
      return { ...safe, organizationId: user!.organizationId, actorId: user!.id, importSource: file.filename };
    };
    if (extension === ".csv") {
      const rows = parseDelimited(buffer.toString("utf8"));
      if (!rows.length) return reply.code(422).send({ error: "O CSV não possui linhas importáveis" });
      return reply.code(201).send(store.importRows(parsedKind.data, rows.map(sanitize)));
    }
    if (extension === ".json") {
      const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return reply.code(201).send(store.importRows(parsedKind.data, rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object").map(sanitize)));
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
        organizationId: user!.organizationId, actorId: user!.id, sha256: createHash("sha256").update(buffer).digest("hex"),
      }, "import");
      const filename = `${Date.now()}-${safeName(file.filename)}`;
      writeFileSync(resolve(uploadRoot, filename), buffer);
      store.update("activities", record.id, { filename, url: `/uploads/${filename}`, sizeBytes: buffer.length });
      return reply.code(201).send({ imported: 1, records: [record] });
    }
    return reply.code(415).send({ error: "Use arquivos CSV, JSON ou FIT" });
  });

  app.post("/api/v1/videos/:id/analyze", async (request, reply) => {
    const user = getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" });
    const params = z.object({ id: z.string() }).parse(request.params);
    const record = store.get("videos", params.id);
    if (!record || record.organizationId !== user!.organizationId || typeof record.filename !== "string") return reply.code(404).send({ error: "Vídeo não encontrado" });
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
    const user = getSession(sessionToken(request));
    if (!roleAllows(user, ["coach", "admin"])) return reply.code(user ? 403 : 401).send({ error: user ? "Ação não autorizada" : "Autenticação necessária" });
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ time: z.number().nonnegative(), category: z.string(), label: z.string().min(1), note: z.string().optional() }).safeParse(request.body);
    const record = store.get("videos", params.id);
    if (!record || record.organizationId !== user!.organizationId) return reply.code(404).send({ error: "Vídeo não encontrado" });
    if (!body.success) return reply.code(400).send({ error: "Marcador inválido" });
    const manualEvents = Array.isArray(record.manualEvents) ? record.manualEvents : [];
    return reply.code(201).send(store.update("videos", params.id, { manualEvents: [...manualEvents, { id: id("event"), ...body.data, createdAt: new Date().toISOString() }] }));
  });
}
