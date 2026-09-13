/** Cliente do microservice AquaVision Elite (pose, tracking e biomecânica). */

const DEFAULT_TIMEOUT_MS = 900_000;

export type VisionCalibrationSnapshot = {
  origin: string;
  version: string;
  cameraId: string;
  poolId: string;
  laneIds: string[];
  coverage: number;
  validity: "valid" | "expired";
  points: Array<{ image: [number, number]; world: [number, number] }>;
};

export type VisionAnalysisContext = {
  strokeStyle?: "livre" | "costas" | "peito" | "borboleta" | "medley" | "unknown";
  cameraView?: "side" | "front" | "rear" | "overhead" | "underwater_side" | "underwater_front" | "unknown";
  poolLengthM?: number;
  targetFps?: number;
};

export type MetricAvailability = { available: boolean; reliable: boolean; reason?: string; confidence?: number; method?: string };

export type VisionSportMetric = {
  id: string;
  label?: string;
  group?: string;
  status: "measured" | "unavailable" | "uncalibrated" | "not_validated";
  unit: string;
  interval: { startSeconds: number; endSeconds: number };
  coverage: number;
  source: string;
  sourceVersion: string;
  unavailableReason?: string;
  value?: number;
  confidence?: number;
  confidenceKind?: string;
  method?: string;
  evidence?: Record<string, unknown>;
};

export type VisionAnalysis = {
  engine: string;
  engineVersion: string;
  modelVersion?: string;
  methodology: string;
  analyzedAt: string;
  modelClass?: string;
  metadata: {
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    sizeBytes: number;
    bitrate: number;
    units?: string;
    calibrated?: boolean;
    calibrationSnapshot?: VisionCalibrationSnapshot;
    metricAvailability?: Record<"avgSpeed" | "maxSpeed" | "distance" | "distancePerStroke", MetricAvailability>;
    persons?: number;
    primaryPersonId?: number;
    sampleFps?: number;
    keyframesTruncatedAt?: number | null;
    strokeStyle?: string;
    cameraView?: string;
    poolLengthM?: number;
    analysisQuality?: Record<string, unknown>;
  };
  metrics: { detectedCycles?: number; estimatedCadence?: number; rhythmConsistency?: number; meanMotion: number; peakMotion: number };
  analysisQuality?: Record<string, unknown>;
  sportMetrics?: { contractVersion: string; metrics: VisionSportMetric[]; [key: string]: unknown };
  biomechanics?: Record<string, unknown>;
  technicalFindings?: Array<Record<string, unknown>>;
  timeline: { time: number; motion: number }[];
  events: { id: string; time: number; category: string; label: string; confidence: number; confidenceKind?: string; note?: string; personId?: number }[];
  people?: Array<Record<string, unknown>>;
  keyframes?: Array<{ t: number; persons: Array<{ id: number; kpts: number[][] }> }>;
  keyframeSegments?: Array<{ from: number; to: number; count: number; keyframes: Array<{ t: number; persons: Array<{ id: number; kpts: number[][] }> }> }>;
};

export type VisionStage = (progress: number, stage: string) => void;

export type VisionFallbackReason = "service_unavailable" | "request_timeout" | "network_error" | "invalid_response" | "no_people_detected" | "request_rejected";

export type VisionResult =
  | { kind: "success"; analysis: VisionAnalysis; durationMs: number }
  | { kind: "fallback"; fallbackReason: VisionFallbackReason; durationMs: number };

function visionUrl() {
  return process.env.VISION_URL ?? "http://localhost:8800";
}

function visionTimeoutMs() {
  const parsed = Number(process.env.VISION_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * Solicita análise ao AquaVision. O contexto esportivo só restringe/interpreta
 * as métricas; ele nunca substitui a evidência do vídeo. Falhas retornam causa
 * segura para o fallback AquaMotion.
 */
export async function analyzeWithVision(
  filePath: string,
  onStage?: VisionStage,
  calibrationSnapshot?: VisionCalibrationSnapshot,
  context: VisionAnalysisContext = {},
): Promise<VisionResult> {
  const startedAt = performance.now();
  const result = (fallbackReason: VisionFallbackReason): VisionResult => ({ kind: "fallback", fallbackReason, durationMs: Math.round(performance.now() - startedAt) });
  onStage?.(6, "AquaVision Elite · detectando atletas e pose");
  try {
    const response = await fetch(`${visionUrl()}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: filePath,
        ...(calibrationSnapshot ? { calibration: calibrationSnapshot } : {}),
        ...(context.strokeStyle ? { strokeStyle: context.strokeStyle } : {}),
        ...(context.cameraView ? { cameraView: context.cameraView } : {}),
        ...(context.poolLengthM ? { poolLengthM: context.poolLengthM } : {}),
        ...(context.targetFps ? { targetFps: context.targetFps } : {}),
      }),
      signal: AbortSignal.timeout(visionTimeoutMs()),
    });
    if (!response.ok) {
      if (response.status === 422) return result("no_people_detected");
      return result(response.status >= 500 ? "service_unavailable" : "request_rejected");
    }
    const payload = await response.json() as Partial<VisionAnalysis>;
    if (!payload.engine?.startsWith("AquaVision") || !payload.metrics || !Array.isArray(payload.timeline) || !Array.isArray(payload.events)) return result("invalid_response");
    onStage?.(88, "AquaVision Elite · compilando biomecânica e confiança");
    return { kind: "success", analysis: payload as VisionAnalysis, durationMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return result(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "request_timeout" : "network_error");
  }
}
