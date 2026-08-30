import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresPersistence, type PersistenceHealth, type RkfSeedImport } from "./postgres-persistence.js";

export const resourceKinds = [
  "athletes", "groups", "workouts", "seasons", "meets", "videos", "documents", "staff", "zones", "goals",
  "activities", "ingestions", "prescriptions", "results", "loadSnapshots", "adaptationDecisions", "governance", "settings", "users", "authSessions",
  // Entidades normalizadas do manual §7.1 (persistíveis; seeds vazias até migração de dados)
  "teams", "athleteProfiles", "athleteCalibrations", "trainingZones", "macrocycles", "mesocycles", "microcycles",
  "trainingSessions", "sessionBlocks", "sessionPrescriptions", "prescriptionBlocks", "sessionExecutions",
  "athleteResponses", "deviceSamples", "readinessScores", "syncJobs", "auditEvents", "sessionContextSnapshots",
  "performanceBenchmarks", "evolutionAssessments", "distanceFatigueRules", "trainingSourceAssets",
  "trainingExtractions", "trainingReviewItems", "importedTrainingSessions", "importedTrainingBlocks",
  "athleteSessionAssignments", "loadCalculations",
] as const;
export type ResourceKind = typeof resourceKinds[number];

export type ManagedRecord = {
  id: string;
  name?: string;
  title?: string;
  status?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type AuditRecord = {
  id: string;
  action: "create" | "update" | "delete" | "import" | "upload" | "analyze";
  resource: ResourceKind;
  resourceId?: string;
  summary: string;
  createdAt: string;
  organizationId?: string;
};

export type DatabaseShape = { resources: Record<ResourceKind, ManagedRecord[]>; audit: AuditRecord[] };

const now = () => new Date().toISOString();
const identifier = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const analysesRoot = fileURLToPath(new URL("../storage/analyses/", import.meta.url));

function precomputedAnalysis(videoId: string) {
  try {
    return JSON.parse(readFileSync(resolve(analysesRoot, `${videoId}.json`), "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function seed(): DatabaseShape {
  const timestamp = now();
  const records = (rows: Array<Record<string, unknown> & { id: string }>): ManagedRecord[] => rows.map((row) => ({ ...row, createdAt: timestamp, updatedAt: timestamp }));
  return {
    resources: {
      athletes: records([
        { id: "ana-souza", name: "Ana Souza", handle: "@anaswim", group: "Elite · Raia 4", stroke: "Livre", status: "active", email: "ana@aquaos.app" },
        { id: "caio-martins", name: "Caio Martins", handle: "@caiobfly", group: "Elite · Raia 4", stroke: "Borboleta", status: "active", email: "caio@aquaos.app" },
        { id: "luiza-costa", name: "Luiza Costa", handle: "@luizaback", group: "Desenvolvimento · Raia 3", stroke: "Costas", status: "active", email: "luiza@aquaos.app" },
        { id: "pedro-lima", name: "Pedro Lima", handle: "@pedrobreast", group: "Desenvolvimento · Raia 3", stroke: "Peito", status: "active", email: "pedro@aquaos.app" },
      ]),
      groups: records([{ id: "elite", name: "Elite · Raia 4", color: "#0c8f7c", members: 2, status: "active" }, { id: "desenvolvimento", name: "Desenvolvimento · Raia 3", color: "#7357ef", members: 2, status: "active" }]),
      workouts: records([{ id: "ritmo-200", title: "Ritmo de prova · 200 Livre", status: "published", date: "2026-08-28", distanceMeters: 5200, zone: "AN2" }, { id: "forca-maxima", title: "Força máxima · membros inferiores", status: "published", date: "2026-08-28", durationMinutes: 55 }]),
      seasons: records([{ id: "temporada-2026", name: "Temporada Olímpica 2026/27", status: "active", startsOn: "2026-08-04", endsOn: "2027-07-19" }]),
      meets: records([{ id: "trofeu-brasil", name: "Troféu Brasil - José Finkel", status: "planned", startsOn: "2026-09-18", priority: "A", pool: "50 m" }]),
      videos: records([
        { id: "video-treino-diurno", title: "Técnica de crawl · sessão diurna", athleteId: "ana-souza", athlete: "Ana Souza", event: "Técnica de crawl", status: "ready", filename: "treino-tecnico-diurno-1080p.mp4", url: "/uploads/treino-tecnico-diurno-1080p.mp4", thumbnailUrl: "/uploads/treino-tecnico-diurno-1080p-thumb.jpg", durationSeconds: 16.95, width: 608, height: 1080, fps: 59.94, sizeBytes: 11337382, source: "Arquivo fornecido pelo treinador", analysisStatus: "ready", analysis: precomputedAnalysis("video-treino-diurno") },
        { id: "video-treino-noturno", title: "Ritmo e eficiência · sessão noturna", athleteId: "caio-martins", athlete: "Caio Martins", event: "Ritmo e eficiência", status: "ready", filename: "treino-tecnico-noturno-720p.mp4", url: "/uploads/treino-tecnico-noturno-720p.mp4", thumbnailUrl: "/uploads/treino-tecnico-noturno-720p-thumb.jpg", durationSeconds: 24.875, width: 1280, height: 720, fps: 59.94, sizeBytes: 8464955, source: "Arquivo fornecido pelo treinador", analysisStatus: "ready", analysis: precomputedAnalysis("video-treino-noturno") },
      ]),
      documents: records([]),
      staff: records([{ id: "leonardo-martins", name: "Leonardo Martins", role: "Administrador", access: "full", status: "active" }, { id: "camila-ferreira", name: "Camila Ferreira", role: "Treinadora", access: "full", status: "active" }]),
      zones: records([
        { id: "valat", name: "VALAT · Velocidade alática", code: "VALAT", color: "#8f3db5", pace: "Individual", status: "active", order: 1 },
        { id: "a1", name: "A1 · Regenerativo", code: "A1", color: "#2da7c7", pace: "1:38-1:48", status: "active", order: 2 },
        { id: "a2", name: "A2 · Aeróbio", code: "A2", color: "#174a8c", pace: "1:26-1:37", status: "active", order: 3 },
        { id: "a3", name: "A3 · Limiar", code: "A3", color: "#5572c8", pace: "1:18-1:25", status: "active", order: 4 },
        { id: "an1", name: "AN1 · Tolerância anaeróbia", code: "AN1", color: "#df6b45", pace: "Individual", status: "active", order: 5 },
        { id: "an2", name: "AN2 · Potência anaeróbia", code: "AN2", color: "#c13d4d", pace: "Individual", status: "active", order: 6 },
      ]),
      goals: records([{ id: "ana-200-livre", name: "Ana · 200 m Livre", athleteId: "ana-souza", event: "200 m Livre", targetTime: "1:58.50", status: "active" }]),
      activities: records([]),
      ingestions: records([]),
      prescriptions: records([]),
      results: records([]),
      loadSnapshots: records([]),
      adaptationDecisions: records([]),
      users: records([]),
      authSessions: records([]),
      governance: records([
        { id: "rkf-v5-1", name: "Homologação RKF V5.1", status: "validation", seedExpectedSessions: 910, seedExpectedBlocks: 6226, seedImported: false, decisionRegisterOpen: true },
      ]),
      settings: records([{ id: "program", name: "Configuração do programa", organizationName: "Seleção Nacional de Natação", locale: "pt-BR", measurementSystem: "metric", primaryPool: "50 m", loadEngine: "RkfLoadEngine", rkfVersion: "RKF_V5.1", rkfStatus: "validation", status: "active" }]),
      // Entidades normalizadas do manual §7.1: persistíveis, seeds vazias
      teams: records([]),
      athleteProfiles: records([]),
      athleteCalibrations: records([]),
      trainingZones: records([]),
      macrocycles: records([]),
      mesocycles: records([]),
      microcycles: records([]),
      trainingSessions: records([]),
      sessionBlocks: records([]),
      sessionPrescriptions: records([]),
      prescriptionBlocks: records([]),
      sessionExecutions: records([]),
      athleteResponses: records([]),
      deviceSamples: records([]),
      readinessScores: records([]),
      syncJobs: records([]),
      auditEvents: records([]),
      sessionContextSnapshots: records([]),
      performanceBenchmarks: records([]),
      evolutionAssessments: records([]),
      distanceFatigueRules: records([]),
      trainingSourceAssets: records([]),
      trainingExtractions: records([]),
      trainingReviewItems: records([]),
      importedTrainingSessions: records([]),
      importedTrainingBlocks: records([]),
      athleteSessionAssignments: records([]),
      loadCalculations: records([]),
    },
    audit: [],
  };
}

export class ManagedStore {
  private readonly filePath: string;
  private data: DatabaseShape;
  private postgres?: PostgresPersistence;
  private writeQueue: Promise<void> = Promise.resolve();
  private persistenceError?: string;

  constructor(filePath = process.env.STORAGE_PATH
    ? resolve(process.env.STORAGE_PATH, "aquaos-data.json")
    : fileURLToPath(new URL("../storage/aquaos-data.json", import.meta.url))) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    const defaults = seed();
    this.data = existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) as DatabaseShape : defaults;
    for (const kind of resourceKinds) this.data.resources[kind] ??= defaults.resources[kind];
    for (const collection of Object.values(this.data.resources)) {
      for (const record of collection) record.organizationId ??= "org-demo";
    }
    if (!this.data.resources.settings.length) this.data.resources.settings = defaults.resources.settings;
    for (const zone of defaults.resources.zones) {
      if (!this.data.resources.zones.some((current) => current.code === zone.code)) this.data.resources.zones.push(zone);
    }
    for (const zone of this.data.resources.zones) {
      if (zone.code === "AN" || zone.code === "RP") Object.assign(zone, { status: "retired", retiredAt: zone.retiredAt ?? now(), migrationNote: "Vocabulário anterior preservado apenas para histórico RKF V5.1." });
    }
    for (const workout of this.data.resources.workouts) {
      if (workout.zone === "RP") workout.zone = "AN2";
      if (workout.zone === "AN") workout.zone = "AN1";
    }
    const program = this.data.resources.settings.find((setting) => setting.id === "program");
    if (program) Object.assign(program, { loadEngine: "RkfLoadEngine", rkfVersion: "RKF_V5.1", rkfStatus: "validation" });
    // Reparo: vídeos demo sem análise (data file antigo ou análise perdida) recebem a análise pré-computada.
    for (const video of this.data.resources.videos) {
      const fallback = defaults.resources.videos.find((candidate) => candidate.id === video.id);
      if (fallback?.analysis && (!video.analysis || video.analysisStatus !== "ready")) {
        Object.assign(video, { analysis: fallback.analysis, analysisStatus: "ready", status: video.status === "processing" ? "ready" : video.status });
      }
    }
    this.persist();
  }

  async initialize(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) return this.persistenceHealth();
    try {
      this.postgres = new PostgresPersistence(databaseUrl);
      await this.postgres.initialize();
      const persisted = await this.postgres.load();
      if (persisted) {
        const defaults = seed();
        this.data = persisted;
        for (const kind of resourceKinds) this.data.resources[kind] ??= defaults.resources[kind];
        this.data.audit ??= [];
      } else {
        await this.postgres.save(structuredClone(this.data));
      }
      this.persistenceError = undefined;
      return this.persistenceHealth();
    } catch (error) {
      this.postgres = undefined;
      this.persistenceError = error instanceof Error ? error.message : "Falha ao inicializar PostgreSQL";
      if (process.env.PERSISTENCE_REQUIRED === "true") throw error;
      return this.persistenceHealth();
    }
  }

  persistenceHealth(): PersistenceHealth {
    if (this.postgres) return this.postgres.health();
    return { driver: "file", connected: true, error: this.persistenceError };
  }

  async flush() {
    await this.writeQueue;
    if (this.persistenceError) throw new Error(this.persistenceError);
  }

  async close() {
    await this.flush();
    await this.postgres?.close();
  }

  async importRkfSeed(input: RkfSeedImport) {
    if (this.postgres) return this.postgres.importRkfSeed(input);
    const target = resolve(dirname(this.filePath), `rkf-seed-${input.version.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`);
    const temporary = `${target}.tmp`;
    const payload = { ...input, importedAt: now(), driver: "file-atomic" };
    writeFileSync(temporary, JSON.stringify(payload), "utf8");
    renameSync(temporary, target);
    return { driver: "file-atomic" as const, importId: input.id, importedRows: input.files.reduce((sum, file) => sum + file.rows.length, 0), files: input.files.length };
  }

  async saveAuthSession(tokenHash: string, user: Record<string, unknown>, expiresAt: number) {
    if (this.postgres) return this.postgres.saveAuthSession(tokenHash, user, expiresAt);
    const current = this.get("authSessions", tokenHash);
    if (current) this.update("authSessions", tokenHash, { user, expiresAt });
    else this.create("authSessions", { id: tokenHash, title: "sessão autenticada", user, expiresAt });
  }

  async getAuthSession(tokenHash: string) {
    if (this.postgres) return this.postgres.getAuthSession(tokenHash);
    const record = this.get("authSessions", tokenHash);
    if (!record || Number(record.expiresAt) <= Date.now()) return undefined;
    return { user: record.user as Record<string, unknown>, expiresAt: Number(record.expiresAt) };
  }

  async deleteAuthSession(tokenHash: string) {
    if (this.postgres) return this.postgres.deleteAuthSession(tokenHash);
    this.remove("authSessions", tokenHash);
  }

  async migrationStatus(): Promise<{ applied: string[]; pending: string[]; total: number; lastAppliedAt?: string }> {
    if (this.postgres) return this.postgres.migrationStatus();
    return { applied: [], pending: [], total: 0, lastAppliedAt: undefined };
  }

  async createBackup() {
    if (this.postgres) return this.postgres.createBackup();
    throw new Error("Backup requer o driver PostgreSQL");
  }

  async verifyBackup(backupId: string) {
    if (this.postgres) return this.postgres.verifyBackup(backupId);
    throw new Error("Backup requer o driver PostgreSQL");
  }

  list(kind: ResourceKind) { return this.data.resources[kind].slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(kind: ResourceKind, id: string) { return this.data.resources[kind].find((item) => item.id === id); }
  audit(limit = 100) { return this.data.audit.slice(-limit).reverse(); }

  create(kind: ResourceKind, input: Record<string, unknown>, action: AuditRecord["action"] = "create") {
    const timestamp = now();
    const record: ManagedRecord = { ...input, id: String(input.id ?? identifier(kind.slice(0, -1))), createdAt: timestamp, updatedAt: timestamp };
    this.data.resources[kind].push(record);
    this.log(action, kind, record.id, String(record.name ?? record.title ?? record.id), String(record.organizationId ?? "org-demo"));
    this.persist();
    return record;
  }

  update(kind: ResourceKind, id: string, patch: Record<string, unknown>, action: AuditRecord["action"] = "update") {
    const record = this.get(kind, id);
    if (!record) return undefined;
    Object.assign(record, patch, { id, createdAt: record.createdAt, updatedAt: now() });
    this.log(action, kind, id, String(record.name ?? record.title ?? id), String(record.organizationId ?? "org-demo"));
    this.persist();
    return record;
  }

  remove(kind: ResourceKind, id: string) {
    const index = this.data.resources[kind].findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const [removed] = this.data.resources[kind].splice(index, 1);
    this.log("delete", kind, id, String(removed.name ?? removed.title ?? id), String(removed.organizationId ?? "org-demo"));
    this.persist();
    return removed;
  }

  importRows(kind: ResourceKind, rows: Record<string, unknown>[]) {
    const timestamp = now();
    const created = rows.map((row) => ({ ...row, id: String(row.id ?? identifier(kind.slice(0, -1))), createdAt: timestamp, updatedAt: timestamp } as ManagedRecord));
    this.data.resources[kind].push(...created);
    for (const record of created) this.log("import", kind, record.id, String(record.name ?? record.title ?? record.id), String(record.organizationId ?? "org-demo"));
    this.persist();
    return { imported: created.length, records: created };
  }

  private log(action: AuditRecord["action"], resource: ResourceKind, resourceId: string | undefined, label: string, organizationId = "org-demo") {
    this.data.audit.push({ id: identifier("audit"), action, resource, resourceId, summary: `${action}: ${label}`, createdAt: now(), organizationId });
    if (this.data.audit.length > 1000) this.data.audit = this.data.audit.slice(-1000);
  }

  private persist() {
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(temporary, this.filePath);
    if (this.postgres) {
      const snapshot = structuredClone(this.data);
      this.writeQueue = this.writeQueue.then(() => this.postgres!.save(snapshot)).catch((error: unknown) => {
        this.persistenceError = error instanceof Error ? error.message : "Falha ao persistir no PostgreSQL";
      });
    }
  }
}

export function parseDelimited(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === separator && !quoted) {
      row.push(field.trim()); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field.trim()); field = "";
      if (row.some((value) => value.length)) table.push(row);
      row = [];
    } else field += character;
  }
  row.push(field.trim());
  if (row.some((value) => value.length)) table.push(row);
  if (table.length < 2) return [];
  const headers = table[0].map((header) => header.toLowerCase().replace(/[^a-z0-9À-ÿ]+/gi, "_").replace(/^_|_$/g, ""));
  return table.slice(1).map((values) => Object.fromEntries(values.map((value, index) => [headers[index] || `field_${index}`, value])));
}
