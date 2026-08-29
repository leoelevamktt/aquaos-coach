import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const resourceKinds = ["athletes", "groups", "workouts", "seasons", "meets", "videos", "documents", "staff", "zones", "goals", "activities", "settings"] as const;
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

type AuditRecord = {
  id: string;
  action: "create" | "update" | "delete" | "import" | "upload" | "analyze";
  resource: ResourceKind;
  resourceId?: string;
  summary: string;
  createdAt: string;
};

type DatabaseShape = { resources: Record<ResourceKind, ManagedRecord[]>; audit: AuditRecord[] };

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
      workouts: records([{ id: "ritmo-200", title: "Ritmo de prova · 200 Livre", status: "published", date: "2026-08-28", distanceMeters: 5200, zone: "RP" }, { id: "forca-maxima", title: "Força máxima · membros inferiores", status: "published", date: "2026-08-28", durationMinutes: 55 }]),
      seasons: records([{ id: "temporada-2026", name: "Temporada Olímpica 2026/27", status: "active", startsOn: "2026-08-04", endsOn: "2027-07-19" }]),
      meets: records([{ id: "trofeu-brasil", name: "Troféu Brasil - José Finkel", status: "planned", startsOn: "2026-09-18", priority: "A", pool: "50 m" }]),
      videos: records([
        { id: "video-treino-diurno", title: "Técnica de crawl · sessão diurna", athleteId: "ana-souza", athlete: "Ana Souza", event: "Técnica de crawl", status: "ready", filename: "treino-tecnico-diurno-1080p.mp4", url: "/uploads/treino-tecnico-diurno-1080p.mp4", thumbnailUrl: "/uploads/treino-tecnico-diurno-1080p-thumb.jpg", durationSeconds: 16.95, width: 608, height: 1080, fps: 59.94, sizeBytes: 11337382, source: "Arquivo fornecido pelo treinador", analysisStatus: "ready", analysis: precomputedAnalysis("video-treino-diurno") },
        { id: "video-treino-noturno", title: "Ritmo e eficiência · sessão noturna", athleteId: "caio-martins", athlete: "Caio Martins", event: "Ritmo e eficiência", status: "ready", filename: "treino-tecnico-noturno-720p.mp4", url: "/uploads/treino-tecnico-noturno-720p.mp4", thumbnailUrl: "/uploads/treino-tecnico-noturno-720p-thumb.jpg", durationSeconds: 24.875, width: 1280, height: 720, fps: 59.94, sizeBytes: 8464955, source: "Arquivo fornecido pelo treinador", analysisStatus: "ready", analysis: precomputedAnalysis("video-treino-noturno") },
      ]),
      documents: records([]),
      staff: records([{ id: "leonardo-martins", name: "Leonardo Martins", role: "Administrador", access: "full", status: "active" }, { id: "camila-ferreira", name: "Camila Ferreira", role: "Treinadora", access: "full", status: "active" }]),
      zones: records([{ id: "a1", name: "A1 · Regenerativo", code: "A1", color: "#55b6c8", pace: "1:38-1:48", status: "active" }, { id: "a2", name: "A2 · Aeróbio", code: "A2", color: "#2f8bc7", pace: "1:26-1:37", status: "active" }, { id: "an", name: "AN · Anaeróbio", code: "AN", color: "#e97861", pace: "1:10-1:17", status: "active" }, { id: "rp", name: "RP · Ritmo de prova", code: "RP", color: "#efb34b", pace: "Por prova", status: "active" }]),
      goals: records([{ id: "ana-200-livre", name: "Ana · 200 m Livre", athleteId: "ana-souza", event: "200 m Livre", targetTime: "1:58.50", status: "active" }]),
      activities: records([]),
      settings: records([{ id: "program", name: "Configuração do programa", organizationName: "Seleção Nacional de Natação", locale: "pt-BR", measurementSystem: "metric", primaryPool: "50 m", loadEngine: "DemoLoadEngine", status: "active" }]),
    },
    audit: [],
  };
}

export class ManagedStore {
  private readonly filePath: string;
  private data: DatabaseShape;

  constructor(filePath = process.env.STORAGE_PATH
    ? resolve(process.env.STORAGE_PATH, "aquaos-data.json")
    : fileURLToPath(new URL("../storage/aquaos-data.json", import.meta.url))) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    const defaults = seed();
    this.data = existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) as DatabaseShape : defaults;
    for (const kind of resourceKinds) this.data.resources[kind] ??= defaults.resources[kind];
    if (!this.data.resources.settings.length) this.data.resources.settings = defaults.resources.settings;
    // Reparo: vídeos demo sem análise (data file antigo ou análise perdida) recebem a análise pré-computada.
    for (const video of this.data.resources.videos) {
      const fallback = defaults.resources.videos.find((candidate) => candidate.id === video.id);
      if (fallback?.analysis && (!video.analysis || video.analysisStatus !== "ready")) {
        Object.assign(video, { analysis: fallback.analysis, analysisStatus: "ready", status: video.status === "processing" ? "ready" : video.status });
      }
    }
    this.persist();
  }

  list(kind: ResourceKind) { return this.data.resources[kind].slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(kind: ResourceKind, id: string) { return this.data.resources[kind].find((item) => item.id === id); }
  audit(limit = 100) { return this.data.audit.slice(-limit).reverse(); }

  create(kind: ResourceKind, input: Record<string, unknown>, action: AuditRecord["action"] = "create") {
    const timestamp = now();
    const record: ManagedRecord = { ...input, id: String(input.id ?? identifier(kind.slice(0, -1))), createdAt: timestamp, updatedAt: timestamp };
    this.data.resources[kind].push(record);
    this.log(action, kind, record.id, String(record.name ?? record.title ?? record.id));
    this.persist();
    return record;
  }

  update(kind: ResourceKind, id: string, patch: Record<string, unknown>, action: AuditRecord["action"] = "update") {
    const record = this.get(kind, id);
    if (!record) return undefined;
    Object.assign(record, patch, { id, createdAt: record.createdAt, updatedAt: now() });
    this.log(action, kind, id, String(record.name ?? record.title ?? id));
    this.persist();
    return record;
  }

  remove(kind: ResourceKind, id: string) {
    const index = this.data.resources[kind].findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const [removed] = this.data.resources[kind].splice(index, 1);
    this.log("delete", kind, id, String(removed.name ?? removed.title ?? id));
    this.persist();
    return removed;
  }

  importRows(kind: ResourceKind, rows: Record<string, unknown>[]) {
    const created = rows.map((row) => this.create(kind, row, "import"));
    return { imported: created.length, records: created };
  }

  private log(action: AuditRecord["action"], resource: ResourceKind, resourceId: string | undefined, label: string) {
    this.data.audit.push({ id: identifier("audit"), action, resource, resourceId, summary: `${action}: ${label}`, createdAt: now() });
    if (this.data.audit.length > 1000) this.data.audit = this.data.audit.slice(-1000);
  }

  private persist() {
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(temporary, this.filePath);
  }
}

export function parseDelimited(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const separator = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const read = (line: string) => line.split(separator).map((value) => value.trim().replace(/^"|"$/g, ""));
  const headers = read(lines[0]).map((header) => header.toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map((line) => Object.fromEntries(read(line).map((value, index) => [headers[index] ?? `field_${index}`, value])));
}
