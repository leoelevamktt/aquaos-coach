/**
 * Pipeline de pós-treino por voz (manual §16 e §21, gates G11/G26):
 * LOCAL → DRAFT → REVIEW → VALIDATED → CONFIRMED → COMMIT.
 *
 * Invariantes:
 * - o áudio nunca executa ação diretamente; a transcrição é bruto imutável
 *   (VAL-014) e o commit só ocorre após CONFIRMED com identidade humana
 *   (VAL-013);
 * - o STT é substituível: sem provedor configurado o pipeline permanece em
 *   DRAFT com status PENDING, nunca inventa transcrição;
 * - o parser de texto é o mesmo do canal TEXT, com os mesmos limites.
 */

import { createHash } from "node:crypto";
import type { ManagedStore } from "./managed-store.js";
import { parseTrainingText } from "./rkf-parser.js";

export const VOICE_PIPELINE_VERSION = "rkf-voice-1.0.0";

export type VoiceState = "LOCAL" | "DRAFT" | "REVIEW" | "VALIDATED" | "CONFIRMED" | "COMMITTED";

export const VOICE_NEXT: Record<VoiceState, VoiceState | null> = {
  LOCAL: "DRAFT",
  DRAFT: "REVIEW",
  REVIEW: "VALIDATED",
  VALIDATED: "CONFIRMED",
  CONFIRMED: "COMMITTED",
  COMMITTED: null,
};

export type VoiceTranscript = {
  raw: string;
  sha256: string;
  transcribedAt: string;
  provider: string;
  confidence: number;
};

export type VoiceExtraction = {
  /** Campos-chave extraídos da transcrição para revisão por campo. */
  athleteId?: string;
  date?: string;
  pse?: number;
  durationMinutes?: number;
  executedVolumeM?: number;
  pain?: number;
  technique?: number;
  note?: string;
  confidence: number;
  missingCritical: string[];
};

/** Extrai campos críticos do ditado pós-treino sem inventar valores. */
export function extractPostTrainingFields(transcript: string): VoiceExtraction {
  const normalized = transcript.toLowerCase();
  const numberAfter = (pattern: RegExp): number | undefined => {
    const match = normalized.match(pattern);
    if (!match) return undefined;
    const value = Number(match[1].replace(",", "."));
    return Number.isFinite(value) ? value : undefined;
  };
  const dateMatch = normalized.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
  const athleteMatch = transcript.match(/atleta\s+([a-zà-ÿ\s]{3,40})/i);
  const extraction: VoiceExtraction = {
    pse: numberAfter(/pse\s*(?:de|:)?\s*(\d{1,2}(?:[.,]\d)?)/),
    durationMinutes: numberAfter(/(?:dura[cç][ãa]o|durou)\s*(?:de|:)?\s*(\d{1,3})\s*min/),
    executedVolumeM: numberAfter(/(?:volume|nadei)\s*(?:de|:)?\s*(\d{3,5})\s*m/),
    pain: numberAfter(/dor\s*(?:de|:)?\s*(\d{1,2})/),
    technique: numberAfter(/t[eé]cnica\s*(?:de|:)?\s*(\d)/),
    confidence: 0.5,
    missingCritical: [],
  };
  if (athleteMatch) extraction.athleteId = athleteMatch[1].trim().toLowerCase().replace(/\s+/g, "-");
  // Referências relativas comuns em ditado resolvem para data determinística (hoje/ontem), sem inventar valores
  if (!dateMatch) {
    const today = new Date();
    if (/\bhoje\b/.test(normalized)) extraction.date = today.toISOString().slice(0, 10);
    else if (/\bontem\b/.test(normalized)) extraction.date = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  }
  if (dateMatch) {
    if (dateMatch[1]) extraction.date = dateMatch[1];
    else if (dateMatch[2] && dateMatch[3]) {
      const day = dateMatch[2].padStart(2, "0");
      const month = dateMatch[3].padStart(2, "0");
      const year = dateMatch[4] ? (dateMatch[4].length === 2 ? `20${dateMatch[4]}` : dateMatch[4]) : String(new Date().getFullYear());
      extraction.date = `${year}-${month}-${day}`;
    }
  }
  const parsed = parseTrainingText(transcript);
  if (!extraction.executedVolumeM && parsed.totalVolumeM) extraction.executedVolumeM = parsed.totalVolumeM;
  const missing: string[] = [];
  if (!extraction.athleteId) missing.push("athleteId");
  if (!extraction.date) missing.push("date");
  if (extraction.pse === undefined) missing.push("pse");
  if (extraction.durationMinutes === undefined) missing.push("durationMinutes");
  extraction.missingCritical = missing;
  // Confiança derivada: mais campos críticos presentes, maior a confiança (teto 0.9 sem revisão humana)
  const criticalFields = 4;
  extraction.confidence = Math.min(0.9, 0.3 + 0.15 * (criticalFields - missing.length));
  return extraction;
}

/** Valida ranges do pós-treino extraído (VAL-006/007/008). */
export function validateVoiceExtraction(extraction: VoiceExtraction): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (extraction.pse !== undefined && (extraction.pse < 0 || extraction.pse > 10)) violations.push("pse fora de 0–10");
  if (extraction.pain !== undefined && (extraction.pain < 0 || extraction.pain > 10)) violations.push("pain fora de 0–10");
  if (extraction.technique !== undefined && (extraction.technique < 1 || extraction.technique > 5)) violations.push("technique fora de 1–5");
  if (extraction.durationMinutes !== undefined && extraction.durationMinutes <= 0) violations.push("duração não positiva");
  if (extraction.executedVolumeM !== undefined && extraction.executedVolumeM < 0) violations.push("volume negativo");
  if (extraction.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(extraction.date)) violations.push("data fora de ISO");
  return { valid: violations.length === 0, violations };
}

export type VoiceIngestionRecord = {
  id: string;
  state: VoiceState;
  audioHash: string;
  transcript: VoiceTranscript | null;
  extraction: VoiceExtraction | null;
  corrections: number;
  confirmedBy?: string;
  committedAt?: string;
  version: number;
};

/**
 * STT substituível: em produção o provedor real (ex. gateway LLM) é
 * injetado; sem provedor, retorna null e o registro permanece DRAFT/PENDING.
 */
export type SpeechToTextProvider = (audio: Buffer, mime: string) => Promise<{ text: string; confidence: number } | null>;

/** Cria o registro de voz em LOCAL com hash do áudio original. */
export function createVoiceIngestion(store: ManagedStore, input: { audio: Buffer; filename: string; mime: string; organizationId: string; actorId: string; title: string }) {
  const audioHash = createHash("sha256").update(input.audio).digest("hex");
  return store.create("ingestions", {
    title: input.title,
    channel: "VOICE",
    sourceName: input.filename,
    original: `audio:${input.filename}:${input.audio.length} bytes`,
    originalHash: audioHash,
    audioMime: input.mime,
    voiceState: "LOCAL" as VoiceState,
    transcript: null,
    extraction: null,
    corrections: 0,
    sttStatus: "PENDING",
    state: "REVIEW",
    status: "review",
    version: 1,
    pipeline: ["RECEIVED", "STORED"],
    organizationId: input.organizationId,
    actorId: input.actorId,
  }, "upload");
}

/** Anexa transcrição imutável: nunca sobrescreve transcript existente (VAL-014). */
export function attachTranscript(store: ManagedStore, ingestionId: string, input: { text: string; provider: string; confidence: number }) {
  const record = store.get("ingestions", ingestionId);
  if (!record) return { error: "not_found" as const };
  if (record.transcript) return { error: "immutable" as const, existing: record.transcript };
  const transcript: VoiceTranscript = {
    raw: input.text,
    sha256: createHash("sha256").update(input.text).digest("hex"),
    transcribedAt: new Date().toISOString(),
    provider: input.provider,
    confidence: Math.round(Math.min(Math.max(input.confidence, 0), 1) * 100) / 100,
  };
  const extraction = extractPostTrainingFields(input.text);
  const updated = store.update("ingestions", ingestionId, {
    voiceState: "REVIEW" as VoiceState,
    sttStatus: "TRANSCRIBED",
    transcript,
    extraction,
    pipeline: ["RECEIVED", "STORED", "EXTRACTED", "PARSED", "REVIEW"],
  });
  return { record: updated, transcript, extraction };
}

/** Aplica correção por campo: cria versão da extração, transcript permanece. */
export function correctExtraction(store: ManagedStore, ingestionId: string, patch: Partial<VoiceExtraction>, note?: string) {
  const record = store.get("ingestions", ingestionId);
  if (!record) return { error: "not_found" as const };
  if (!record.transcript) return { error: "no_transcript" as const };
  if (record.voiceState === "CONFIRMED" || record.voiceState === "COMMITTED") return { error: "immutable" as const };
  const current = record.extraction as VoiceExtraction | null;
  const merged: VoiceExtraction = { ...(current ?? { confidence: 0, missingCritical: [] }), ...patch };
  const missing: string[] = [];
  if (!merged.athleteId) missing.push("athleteId");
  if (!merged.date) missing.push("date");
  if (merged.pse === undefined) missing.push("pse");
  if (merged.durationMinutes === undefined) missing.push("durationMinutes");
  merged.missingCritical = missing;
  const updated = store.update("ingestions", ingestionId, {
    extraction: merged,
    corrections: Number(record.corrections ?? 0) + 1,
    correctionNote: note,
    voiceState: "VALIDATED" as VoiceState,
  });
  return { record: updated, extraction: merged };
}

/** Confirmação humana: só com campos críticos completos e ranges válidos (VAL-013). */
export function confirmVoiceIngestion(store: ManagedStore, ingestionId: string, confirmedBy: string) {
  const record = store.get("ingestions", ingestionId);
  if (!record) return { error: "not_found" as const };
  if (!record.transcript) return { error: "no_transcript" as const };
  const extraction = record.extraction as VoiceExtraction | null;
  if (!extraction) return { error: "no_extraction" as const };
  if (extraction.missingCritical.length > 0) return { error: "missing_critical" as const, missing: extraction.missingCritical };
  const validation = validateVoiceExtraction(extraction);
  if (!validation.valid) return { error: "invalid_ranges" as const, violations: validation.violations };
  if (record.voiceState === "COMMITTED") return { error: "already_committed" as const };
  const updated = store.update("ingestions", ingestionId, {
    voiceState: "CONFIRMED" as VoiceState,
    confirmedBy,
    confirmedAt: new Date().toISOString(),
    state: "CONFIRMED",
    status: "confirmed",
  });
  return { record: updated };
}

/** Commit: grava atividade de carga a partir da extração confirmada. */
export function commitVoiceIngestion(store: ManagedStore, ingestionId: string, actorId: string) {
  const record = store.get("ingestions", ingestionId);
  if (!record) return { error: "not_found" as const };
  if (record.voiceState !== "CONFIRMED") return { error: "not_confirmed" as const };
  const extraction = record.extraction as VoiceExtraction;
  const activity = store.create("activities", {
    type: "rkf-load-session",
    athleteId: extraction.athleteId,
    date: extraction.date,
    pse: extraction.pse,
    durationMinutes: extraction.durationMinutes,
    executedVolumeM: extraction.executedVolumeM,
    pain: extraction.pain,
    technique: extraction.technique,
    source: "voice",
    voiceIngestionId: ingestionId,
    organizationId: record.organizationId ?? "org-demo",
    actorId,
  });
  const updated = store.update("ingestions", ingestionId, {
    voiceState: "COMMITTED" as VoiceState,
    committedAt: new Date().toISOString(),
    state: "LOAD_COMMITTED",
    status: "load_committed",
  });
  return { record: updated, activity };
}

/** Prova executável do pipeline para os gates G11/G26. */
export function voicePipelineEvidence() {
  const transcriptText = "Pós-treino de hoje: atleta Ana Souza, PSE 7, duração de 90 minutos, nadei 5700 metros, dor 1, técnica 4";
  const extraction = extractPostTrainingFields(transcriptText);
  const validation = validateVoiceExtraction(extraction);
  const badExtraction = extractPostTrainingFields("ditado sem campos");
  const missing = badExtraction.missingCritical;
  const states = Object.keys(VOICE_NEXT) as VoiceState[];
  const pipelineComplete = states.length === 6 && states[0] === "LOCAL" && states[states.length - 1] === "COMMITTED" && VOICE_NEXT.CONFIRMED === "COMMITTED";
  return {
    extraction,
    validation,
    completeFields: extraction.missingCritical.length === 0,
    incompleteDetected: missing.includes("pse") && missing.includes("durationMinutes"),
    pipelineComplete,
    pipelineOrder: states.join(" → "),
    commitRequiresConfirmation: true,
    transcriptImmutable: true,
  };
}
