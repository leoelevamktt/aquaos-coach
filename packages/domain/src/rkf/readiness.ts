/**
 * Readiness e adaptação RKF (manual seção 18 e fórmulas 32.6 do workbook).
 * Conflito registrado (não resolvido silenciosamente): o mapeamento de zonas
 * da seção 18 difere do workbook 32.6 para REDUZIR_FORTE — ambos são
 * exportados, versionados e o primário é o da seção 18.
 */

import type { ZoneCode } from "./zones.js";

export const READINESS_VERSION = "rkf-readiness-1.0.0";

export type ReadinessClass = "BLOQUEAR" | "REDUZIR_FORTE" | "REDUZIR" | "MANTER" | "PROGREDIR_CAUTELA";

export interface ReadinessClassRule {
  class: ReadinessClass;
  minScore: number;
  maxScore: number;
  volumeFactor: number;
  action: string;
}

export const READINESS_CLASSES: readonly ReadinessClassRule[] = [
  { class: "BLOQUEAR", minScore: 0, maxScore: 44, volumeFactor: 0.5, action: "A1/TEC; remover RDC/FO/A3/AN1/AN2/VALAT; decisão do treinador." },
  { class: "REDUZIR_FORTE", minScore: 45, maxScore: 59, volumeFactor: 0.7, action: "A1/A2; AN1→A2; AN2/VALAT→A1; remover RDC/FO." },
  { class: "REDUZIR", minScore: 60, maxScore: 74, volumeFactor: 0.85, action: "Preservar dominante; AN2/VALAT→A2; RDC condicional." },
  { class: "MANTER", minScore: 75, maxScore: 90, volumeFactor: 1, action: "Preservar." },
  { class: "PROGREDIR_CAUTELA", minScore: 91, maxScore: 100, volumeFactor: 1.05, action: "Máximo 5%, sem nova intensidade." },
] as const;

export function classifyReadiness(score: number): ReadinessClassRule {
  const rule = READINESS_CLASSES.find((candidate) => score >= candidate.minScore && score <= candidate.maxScore);
  if (!rule) throw new Error("Readiness deve estar entre 0 e 100.");
  return rule;
}

export interface GuardrailInput {
  readiness: number;
  pain?: number;
  sleepMinutes?: number;
  hrvRatioToBaseline?: number;
  actualPse?: number;
  targetPse?: number;
  technique?: number;
}

export interface GuardrailOutcome {
  enforcedClass: ReadinessClass;
  requiresCoach: boolean;
  status: "LIBERAR_ADAPTACAO" | "AGUARDAR_TREINADOR";
  triggered: string[];
}

/** Guardrails: dor >=5 ou readiness <45 bloqueia; PSE >= alvo+2 ou técnica <=2 → no mínimo REDUZIR_FORTE. */
export function applyGuardrails(input: GuardrailInput): GuardrailOutcome {
  const triggered: string[] = [];
  let enforcedClass = classifyReadiness(input.readiness).class;

  const escalate = (target: ReadinessClass, reason: string) => {
    const order: ReadinessClass[] = ["BLOQUEAR", "REDUZIR_FORTE", "REDUZIR", "MANTER", "PROGREDIR_CAUTELA"];
    if (order.indexOf(target) < order.indexOf(enforcedClass)) {
      enforcedClass = target;
      triggered.push(reason);
    } else if (!triggered.includes(reason)) {
      triggered.push(reason);
    }
  };

  if ((input.pain ?? 0) >= 5) escalate("BLOQUEAR", "Dor >= 5 bloqueia a sessão planejada.");
  if (input.readiness < 45) escalate("BLOQUEAR", "Readiness < 45 bloqueia a sessão planejada.");
  if (input.sleepMinutes !== undefined && input.sleepMinutes < 360 && input.hrvRatioToBaseline !== undefined && input.hrvRatioToBaseline < 0.8) {
    escalate("BLOQUEAR", "Sono < 360 min com HRV < 80% da baseline bloqueia.");
  }
  if (input.actualPse !== undefined && input.targetPse !== undefined && input.actualPse >= input.targetPse + 2) {
    escalate("REDUZIR_FORTE", "PSE >= alvo + 2 exige no mínimo reduzir forte.");
  }
  if (input.technique !== undefined && input.technique <= 2) {
    escalate("REDUZIR_FORTE", "Técnica <= 2 exige no mínimo reduzir forte.");
  }

  const requiresCoach = enforcedClass === "BLOQUEAR";
  return {
    enforcedClass,
    requiresCoach,
    status: requiresCoach ? "AGUARDAR_TREINADOR" : "LIBERAR_ADAPTACAO",
    triggered,
  };
}

export interface ResponseIndexInput {
  readiness: number;
  sleepMinutes: number;
  hrv: number;
  hrvBaseline: number;
  pain: number;
  technique: number;
  techniqueTarget: number;
  /** Aderência 0–1. */
  adherence: number;
  qualityScore: number;
}

export interface ResponseIndexResult {
  components: { C: number; D: number; E: number; F: number; G: number; H: number; I: number };
  responseScore: number;
  completeness: number;
  status: "PRONTO" | "REVISAR";
}

/** Índice de resposta individual (seção 18). Exige completude >= 0,85. */
export function computeResponseIndex(input: Partial<ResponseIndexInput>): ResponseIndexResult {
  const fields: Array<keyof ResponseIndexInput> = ["readiness", "sleepMinutes", "hrv", "hrvBaseline", "pain", "technique", "techniqueTarget", "adherence", "qualityScore"];
  const provided = fields.filter((field) => input[field] !== undefined && input[field] !== null && Number.isFinite(input[field]));
  const completeness = Math.round((provided.length / fields.length) * 100) / 100;
  const value = (field: keyof ResponseIndexInput): number => input[field] ?? 0;

  const C = Math.min(value("readiness") / 100, 1) * 25;
  const D = Math.min(value("sleepMinutes") / 480, 1) * 15;
  const E = value("hrvBaseline") > 0 ? Math.min(value("hrv") / value("hrvBaseline"), 1) * 15 : 0;
  const F = Math.max(0, 1 - value("pain") / 10) * 15;
  const G = Math.max(0, 1 - Math.abs(value("technique") - value("techniqueTarget")) / 5) * 10;
  const H = Math.min(Math.max(value("adherence"), 0), 1) * 10;
  const I = Math.min(value("qualityScore") / 5, 1) * 10;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    components: { C: round2(C), D: round2(D), E: round2(E), F: round2(F), G: round2(G), H: round2(H), I: round2(I) },
    responseScore: round2(C + D + E + F + G + H + I),
    completeness,
    status: completeness >= 0.85 ? "PRONTO" : "REVISAR",
  };
}

/** Mapeamento de zona primária por classe — seção 18 (primário, versionado). */
export const ADAPTATION_ZONE_MAPPING_PRIMARY: Readonly<Record<ReadinessClass, (zone: ZoneCode) => ZoneCode>> = {
  BLOQUEAR: () => "A1",
  REDUZIR_FORTE: (zone) => (zone === "AN1" ? "A2" : zone === "AN2" || zone === "VALAT" ? "A1" : zone === "A3" ? "A2" : zone),
  REDUZIR: (zone) => (zone === "AN2" || zone === "VALAT" ? "A2" : zone),
  MANTER: (zone) => zone,
  PROGREDIR_CAUTELA: (zone) => zone,
};

/** Mapeamento alternativo do workbook 32.6 (AN1/AN2/VALAT/A3 → A2 em REDUZIR_FORTE). */
export const ADAPTATION_ZONE_MAPPING_WORKBOOK: Readonly<Record<ReadinessClass, (zone: ZoneCode) => ZoneCode>> = {
  ...ADAPTATION_ZONE_MAPPING_PRIMARY,
  REDUZIR_FORTE: (zone) => (zone === "AN1" || zone === "AN2" || zone === "VALAT" || zone === "A3" ? "A2" : zone),
};

export interface AdaptationDecision {
  class: ReadinessClass;
  volumeFactor: number;
  adaptedVolumeM: number;
  adaptedToMultipleOf10: true;
  primaryZone: ZoneCode;
  zoneMappingApplied: "SECAO_18" | "WORKBOOK_32_6";
  rdcAllowed: boolean;
  removedElements: string[];
  status: "LIBERAR_ADAPTACAO" | "AGUARDAR_TREINADOR";
  triggered: string[];
  version: string;
  decidedAtUtc: string;
}

export function decideAdaptation(input: {
  readiness: number;
  prescribedVolumeM: number;
  primaryZone: ZoneCode;
  guardrails?: GuardrailInput;
  zoneMapping?: "SECAO_18" | "WORKBOOK_32_6";
  coachApproved?: boolean;
  now?: Date;
}): AdaptationDecision {
  const guardrails = input.guardrails ?? { readiness: input.readiness };
  const outcome = applyGuardrails(guardrails);
  const rule = READINESS_CLASSES.find((candidate) => candidate.class === outcome.enforcedClass)!;
  const mapping = input.zoneMapping === "WORKBOOK_32_6" ? ADAPTATION_ZONE_MAPPING_WORKBOOK : ADAPTATION_ZONE_MAPPING_PRIMARY;
  const adapted = Math.round((input.prescribedVolumeM * rule.volumeFactor) / 10) * 10;

  const removedElements: string[] = [];
  let rdcAllowed = true;
  if (rule.class === "BLOQUEAR") {
    removedElements.push("RDC", "FO", "A3", "AN1", "AN2", "VALAT");
    rdcAllowed = false;
  }
  if (rule.class === "REDUZIR_FORTE") {
    removedElements.push("RDC", "FO");
    rdcAllowed = false;
  }
  if (rule.class === "REDUZIR") rdcAllowed = false;
  if (rule.class === "PROGREDIR_CAUTELA" && adapted > Math.round((input.prescribedVolumeM * 1.05) / 10) * 10) {
    throw new Error("Progressão cautelosa não pode exceder 5% nem introduzir nova intensidade.");
  }

  const blockedPendingCoach = rule.class === "BLOQUEAR" && !input.coachApproved;
  return {
    class: rule.class,
    volumeFactor: rule.volumeFactor,
    adaptedVolumeM: adapted,
    adaptedToMultipleOf10: true,
    primaryZone: mapping[rule.class](input.primaryZone),
    zoneMappingApplied: input.zoneMapping === "WORKBOOK_32_6" ? "WORKBOOK_32_6" : "SECAO_18",
    rdcAllowed,
    removedElements,
    status: blockedPendingCoach ? "AGUARDAR_TREINADOR" : "LIBERAR_ADAPTACAO",
    triggered: outcome.triggered,
    version: READINESS_VERSION,
    decidedAtUtc: (input.now ?? new Date()).toISOString(),
  };
}
