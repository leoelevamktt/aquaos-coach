/**
 * Seeds idempotentes de ingestão por canal (G36) e contratos nomeados dos 8
 * cenários de ingestão (G35), conforme manual §16 e §34.
 *
 * Cada seed é determinística: mesmo canal/entrada produz o mesmo original
 * (portanto o mesmo hash) e a execução repetida não duplica a ingestão.
 */

import { createHash } from "node:crypto";
import type { ManagedStore } from "./managed-store.js";
import { parseTrainingText } from "./rkf-parser.js";

export const INGESTION_SEED_VERSION = "rkf-ingestion-seeds-1.0.0";

export type IngestionSeedChannel = "TEXT" | "PHOTO" | "FILE" | "VOICE" | "API";

export type IngestionSeed = {
  id: string;
  channel: IngestionSeedChannel;
  title: string;
  original: string;
  sourceName: string;
  confidence: number;
  parsedData: Record<string, unknown>;
  expectedState: "REVIEW" | "CONFIRMED";
  expectedRequiresReview: boolean;
  scenario: string;
};

/** Os 8 contratos de ingestão do manual (G35): recebimento → erro. */
export const INGESTION_CONTRACTS = [
  { id: "ING-RECEIVED", scenario: "Recebimento por canal com original preservado e hash", expects: "state=REVIEW, originalHash presente" },
  { id: "ING-STORED", scenario: "Original imutável com hash SHA-256 registrado", expects: "originalHash=sha256(original)" },
  { id: "ING-EXTRACTED", scenario: "Extração de texto para FILE/TEXT com status documentado", expects: "pipeline contém EXTRACTED" },
  { id: "ING-PARSED", scenario: "Parser RKF conservador extrai blocos sem inventar campos", expects: "parsedData.blocks >= 1, zones no vocabulário oficial" },
  { id: "ING-REVIEW", scenario: "Confiança <0.85 exige revisão humana", expects: "requiresHumanReview=true quando confidence<0.85" },
  { id: "ING-CONFIRMED", scenario: "Confirmação de campos críticos por identidade autenticada", expects: "state=CONFIRMED com reviewerId" },
  { id: "ING-COMMITTED", scenario: "Consolidação como treino externo fora da biblioteca", expects: "importedTrainingSessions criada, libraryIsolation=true" },
  { id: "ING-ERROR", scenario: "Falha validada sem commit parcial", expects: "400/415/422 sem registro persistido" },
] as const;

const seedText = "Aquecimento 600 m livre A1\nSérie principal 8x100 A2 com pull\nRegenerativo 200 m";
const seedPhotoText = "Aquecimento 400 m livre\n6x50 valat\nPerna 300 m com prancha";
const seedApiJson = { athleteId: "ana-souza", date: "2026-09-02", kind: "external_training", blocks: [{ volumeM: 600, zone: "A1" }, { volumeM: 800, zone: "A2" }, { volumeM: 200, zone: "A1" }], totalVolumeM: 1600 };

/** Seeds canônicas por canal: determinísticas e idempotentes por hash do original. */
export const INGESTION_SEEDS: IngestionSeed[] = [
  {
    id: "seed-text-treino-mesa", channel: "TEXT", title: "Seed TEXT · treino de mesa", original: seedText, sourceName: "entrada-direta",
    confidence: 0.91, parsedData: { ...parseTrainingText(seedText), kind: "training_session" }, expectedState: "REVIEW", expectedRequiresReview: false, scenario: "ING-RECEIVED+PARSED",
  },
  {
    id: "seed-photo-prancheta", channel: "PHOTO", title: "Seed PHOTO · prancheta fotografada", original: "foto:prancheta-treino-01.jpg", sourceName: "prancheta-treino-01.jpg",
    confidence: 0.42, parsedData: { athleteId: "ana-souza", date: "2026-09-01", kind: "training_session", ocrStatus: "PENDING_REVIEW" }, expectedState: "REVIEW", expectedRequiresReview: true, scenario: "ING-REVIEW",
  },
  {
    id: "seed-file-pdf-treino", channel: "FILE", title: "Seed FILE · PDF exportado", original: "arquivo:treino-semana-34.pdf:20480 bytes", sourceName: "treino-semana-34.pdf",
    confidence: 0.78, parsedData: { ...parseTrainingText(seedText), kind: "external_training", extractionStatus: "text_extracted" }, expectedState: "REVIEW", expectedRequiresReview: true, scenario: "ING-EXTRACTED",
  },
  {
    id: "seed-voice-ditado", channel: "VOICE", title: "Seed VOICE · ditado pós-treino", original: "audio:ditado-pos-treino-01.m4a", sourceName: "ditado-pos-treino-01.m4a",
    confidence: 0.2, parsedData: { athleteId: "ana-souza", date: "2026-09-01", kind: "training_session", sttStatus: "PENDING" }, expectedState: "REVIEW", expectedRequiresReview: true, scenario: "ING-REVIEW",
  },
  {
    id: "seed-api-json", channel: "API", title: "Seed API · JSON de sistema externo", original: JSON.stringify(seedApiJson), sourceName: "sistema-externo.json",
    confidence: 0.95, parsedData: seedApiJson, expectedState: "REVIEW", expectedRequiresReview: false, scenario: "ING-RECEIVED",
  },
  {
    id: "seed-text-erro-volume", channel: "TEXT", title: "Seed TEXT · volume ambíguo para revisão", original: "Série principal volume não especificado", sourceName: "entrada-direta",
    confidence: 0.35, parsedData: { kind: "training_session", incomplete: true, missingFields: ["totalVolumeM"] }, expectedState: "REVIEW", expectedRequiresReview: true, scenario: "ING-ERROR",
  },
];

const seedHash = (seed: IngestionSeed) => createHash("sha256").update(`${seed.id}:${seed.original}`).digest("hex");

export type IngestionSeedExecution = {
  seedId: string;
  channel: IngestionSeedChannel;
  ingestionId: string | null;
  alreadyPresent: boolean;
  state: string;
  requiresHumanReview: boolean;
  scenario: string;
};

/**
 * Aplica as seeds de ingestão de forma idempotente: uma ingestão existente com
 * o mesmo seedHash é reaproveitada; nunca duplica. Retorna o mapa de execução.
 */
export function applyIngestionSeeds(store: ManagedStore, organizationId: string, actorId: string): IngestionSeedExecution[] {
  const existing = store.list("ingestions").filter((item) => item.organizationId === organizationId);
  return INGESTION_SEEDS.map((seed) => {
    const hash = seedHash(seed);
    const present = existing.find((item) => item.seedHash === hash);
    if (present) {
      return { seedId: seed.id, channel: seed.channel, ingestionId: present.id, alreadyPresent: true, state: String(present.state ?? "REVIEW"), requiresHumanReview: Boolean(present.requiresHumanReview), scenario: seed.scenario };
    }
    const created = store.create("ingestions", {
      title: seed.title,
      channel: seed.channel,
      sourceName: seed.sourceName,
      original: seed.original,
      originalHash: createHash("sha256").update(seed.original).digest("hex"),
      seedHash: hash,
      seedVersion: INGESTION_SEED_VERSION,
      parsedData: seed.parsedData,
      confidence: seed.confidence,
      requiresHumanReview: seed.expectedRequiresReview,
      state: seed.expectedState,
      version: 1,
      pipeline: ["RECEIVED", "STORED", ...(seed.channel === "TEXT" || seed.channel === "FILE" ? ["EXTRACTED", "PARSED"] : []), "REVIEW"],
      status: "review",
      organizationId,
      actorId,
    }, "import");
    return { seedId: seed.id, channel: seed.channel, ingestionId: created.id, alreadyPresent: false, state: seed.expectedState, requiresHumanReview: seed.expectedRequiresReview, scenario: seed.scenario };
  });
}

/**
 * Contrato dos quatro planos do produto (G25, manual §22): LOAD_ATHLETE,
 * LOAD_TEAM, FULL_ATHLETE e FULL_TEAM com permissões declaradas.
 */
export const PRODUCT_PLANS = [
  { id: "LOAD_ATHLETE", audience: "atleta", scope: "self", entitlements: ["load:self", "ingest:self", "results:self"], limits: { athletes: 1, channels: ["TEXT", "FILE"], aiAssistant: false } },
  { id: "LOAD_TEAM", audience: "equipe", scope: "team-read", entitlements: ["load:team", "results:team-read"], limits: { athletes: 50, channels: ["TEXT", "FILE", "API"], aiAssistant: false } },
  { id: "FULL_ATHLETE", audience: "atleta", scope: "self-full", entitlements: ["load:self", "ingest:self", "results:self", "prescriptions:self", "ai:chat"], limits: { athletes: 1, channels: ["TEXT", "PHOTO", "FILE", "VOICE", "API"], aiAssistant: true } },
  { id: "FULL_TEAM", audience: "equipe", scope: "team-full", entitlements: ["load:team", "ingest:team", "results:team", "prescriptions:team", "pdf:export", "ai:chat"], limits: { athletes: 200, channels: ["TEXT", "PHOTO", "FILE", "VOICE", "API"], aiAssistant: true } },
] as const;

/** Mapeia papel/capacidade para os planos aplicáveis (manual §22). */
export function plansForRole(role: "athlete" | "coach" | "admin"): string[] {
  if (role === "athlete") return ["LOAD_ATHLETE", "FULL_ATHLETE"];
  return ["LOAD_TEAM", "FULL_TEAM"];
}
