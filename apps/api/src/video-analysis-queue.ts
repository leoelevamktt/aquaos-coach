import { extname, resolve } from "node:path";
import type { ManagedRecord, ManagedStore } from "./managed-store.js";
import { analyzeVideo } from "./video-analysis.js";

type VideoJob = ManagedRecord & {
  videoId: string;
  organizationId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  stage: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

type VideoRecord = ManagedRecord & {
  filename?: string;
  analysisStatus?: string;
  analysisJobId?: string;
};

const now = () => new Date().toISOString();

/**
 * Fila local, serializada e persistida como recurso gerenciável. O processamento
 * continua fora da requisição HTTP, enquanto o ManagedStore transmite cada
 * estágio por SSE para o treinador.
 */
export class VideoAnalysisQueue {
  private readonly pending: string[] = [];
  private running = false;

  constructor(private readonly store: ManagedStore, private readonly uploadRoot: string) {}

  resume() {
    for (const record of this.store.list("videoAnalysisJobs") as VideoJob[]) {
      if (record.status !== "queued" && record.status !== "running") continue;
      if (record.status === "running") this.store.update("videoAnalysisJobs", record.id, { status: "queued", stage: "Retomando análise após reinício" });
      if (!this.pending.includes(record.id)) this.pending.push(record.id);
    }
    void this.drain();
  }

  enqueue(videoId: string, organizationId: string, force = false) {
    const video = this.store.get("videos", videoId) as VideoRecord | undefined;
    if (!video || video.organizationId !== organizationId || typeof video.filename !== "string") throw new Error("Vídeo não encontrado");

    const current = (this.store.list("videoAnalysisJobs") as VideoJob[]).find((job) => job.videoId === videoId && (job.status === "queued" || job.status === "running"));
    if (current && !force) return { video, job: current };

    const job = this.store.create("videoAnalysisJobs", {
      videoId,
      organizationId,
      status: "queued",
      progress: 0,
      stage: "Aguardando processamento",
      requestedAt: now(),
    }) as VideoJob;
    this.store.update("videos", videoId, {
      status: "processing",
      analysisStatus: "queued",
      analysisProgress: 0,
      analysisStage: "Aguardando processamento",
      analysisJobId: job.id,
      ...(force ? { analysisError: undefined } : {}),
    });
    this.pending.push(job.id);
    void this.drain();
    return { video: this.store.get("videos", videoId) as VideoRecord, job };
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const jobId = this.pending.shift();
        if (jobId) await this.process(jobId);
      }
    } finally {
      this.running = false;
    }
  }

  private async process(jobId: string) {
    const job = this.store.get("videoAnalysisJobs", jobId) as VideoJob | undefined;
    if (!job) return;
    const video = this.store.get("videos", job.videoId) as VideoRecord | undefined;
    if (!video || typeof video.filename !== "string") {
      this.store.update("videoAnalysisJobs", job.id, { status: "failed", progress: 0, stage: "Vídeo não encontrado", error: "Vídeo não encontrado", completedAt: now() });
      return;
    }

    const updateProgress = (progress: number, stage: string) => {
      this.store.update("videoAnalysisJobs", job.id, { status: "running", progress, stage, startedAt: job.startedAt ?? now() });
      this.store.update("videos", video.id, { status: "processing", analysisStatus: "processing", analysisProgress: progress, analysisStage: stage, analysisJobId: job.id });
    };

    try {
      updateProgress(1, "Iniciando análise temporal");
      const thumbnail = `${video.filename.replace(extname(video.filename), "")}-thumb.jpg`;
      const analysis = await analyzeVideo(resolve(this.uploadRoot, video.filename), resolve(this.uploadRoot, thumbnail), updateProgress);
      const updated = this.store.update("videos", video.id, {
        analysisStatus: "ready",
        status: "ready",
        analysisProgress: 100,
        analysisStage: "Análise concluída",
        analysisJobId: job.id,
        analysis,
        thumbnailUrl: `/uploads/${thumbnail}`,
        ...analysis.metadata,
      }, "analyze");
      this.store.update("videoAnalysisJobs", job.id, { status: "completed", progress: 100, stage: "Análise concluída", completedAt: now(), result: { videoId: video.id, analyzedAt: analysis.analyzedAt } });
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida na análise";
      this.store.update("videoAnalysisJobs", job.id, { status: "failed", stage: "Análise interrompida", error: message, completedAt: now() });
      this.store.update("videos", video.id, { analysisStatus: "failed", status: "ready", analysisStage: "Análise interrompida", analysisError: message, analysisJobId: job.id });
      return undefined;
    }
  }
}
