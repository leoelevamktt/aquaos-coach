export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type LiveEvent = {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  organizationId?: string;
  summary?: string;
  createdAt?: string;
  record?: Record<string, unknown>;
};

const prerequisiteLabels: Record<string, string> = {
  "age/birthDate": "data de nascimento/idade",
  developmentLevel: "nível de desenvolvimento",
  "specialty/event": "prova/especialidade",
  poolLengthM: "tamanho da piscina",
  phase: "fase do planejamento",
  "objective/goal": "objetivo",
  primaryZone: "zona principal",
  targetVolumeM: "volume-alvo",
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: options?.credentials ?? "include" });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; missing?: unknown };
  if (!response.ok) {
    const missing = Array.isArray(payload.missing)
      ? payload.missing.filter((item): item is string => typeof item === "string").map((item) => prerequisiteLabels[item] ?? item)
      : [];
    const base = payload.error ?? `Falha na operação (${response.status})`;
    const message = missing.length ? `${base} Pendências: ${missing.join(", ")}.` : base;
    throw new ApiRequestError(message, response.status, payload as Record<string, unknown>);
  }
  return payload;
}

export async function uploadFile(file: File, kind: "videos" | "documents", options?: { athleteId?: string; title?: string; referenceType?: string; referenceId?: string }) {
  const params = new URLSearchParams({ kind });
  if (options?.athleteId) params.set("athleteId", options.athleteId);
  if (options?.title) params.set("title", options.title);
  if (options?.referenceType) params.set("referenceType", options.referenceType);
  if (options?.referenceId) params.set("referenceId", options.referenceId);
  const body = new FormData();
  body.append("file", file);
  return apiRequest<Record<string, unknown>>(`/api/v1/uploads?${params}`, { method: "POST", body });
}

export async function importFile(file: File, kind: string) {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<{ imported: number }>(`/api/v1/import/${kind}`, { method: "POST", body });
}

export function mediaUrl(path?: string) {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${API_URL}${path}`;
}

export function subscribeToLiveEvents(onEvent: (event: LiveEvent) => void, onStatus?: (status: "connecting" | "open" | "error") => void) {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return () => undefined;
  onStatus?.("connecting");
  const source = new EventSource(`${API_URL}/api/v1/events`, { withCredentials: true });
  source.onopen = () => onStatus?.("open");
  source.onerror = () => onStatus?.("error");
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as LiveEvent;
      onEvent(event);
    } catch {
      // Um evento malformado não deve derrubar o stream do aplicativo.
    }
  };
  return () => source.close();
}
