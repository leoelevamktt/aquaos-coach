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

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: options?.credentials ?? "include" });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Falha na operação (${response.status})`);
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
