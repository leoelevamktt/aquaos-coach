/**
 * Fadiga por distância/especialidade e recuperação por fase (manual §10, §14, §32.7).
 *
 * G19 — Fadiga de fundistas: perda >3% entre séries com interrupção em queda acentuada.
 * G20 — Recuperação por fase: matriz de recuperação interbloco por fase do ciclo.
 */

import type { RkfPhaseId, Specialty } from "./periodization.js";

export const FATIGUE_ENGINE_VERSION = "rkf-fatigue-1.0.0";

/**
 * Limiares de queda percentual entre séries por especialidade. Fundistas
 * toleram menos queda por acumulação; velocistas têm janela menor de
 * interrupção por ser qualidade neuromuscular.
 */
const FATIGUE_THRESHOLDS: Record<Specialty, { interruptionDropPct: number; criticalDropPct: number }> = {
  velocidade: { interruptionDropPct: 3, criticalDropPct: 5 },
  meio_fundo: { interruptionDropPct: 3, criticalDropPct: 5 },
  fundo: { interruptionDropPct: 3, criticalDropPct: 4 },
};

export type FatigueSeriesInput = {
  specialty?: Specialty;
  phase?: RkfPhaseId;
  /** Tempos (segundos) das repetições equivalentes na ordem executada. */
  repetitionTimesSeconds: number[];
  /** Dor relatada 0–10 no momento (opcional). */
  pain?: number;
  /** Técnica relatada 1–5 (opcional). */
  technique?: number;
};

export type FatigueAssessment = {
  class: "TOLERANCIA_BOA" | "FADIGA_TRANSITORIA" | "INTERROMPER_SERIE" | "DADOS_INSUFICIENTES";
  dropsPct: number[];
  maxDropPct: number | null;
  reason: string;
  version: string;
};

/**
 * Avalia decaimento entre repetições equivalentes: queda >3% adapta/interrompe
 * (manual §14); dor ≥5 ou técnica ≤2 agrava a decisão independentemente da queda.
 */
export function assessDistanceFatigue(input: FatigueSeriesInput): FatigueAssessment {
  const { specialty = "meio_fundo", repetitionTimesSeconds, pain, technique } = input;
  const thresholds = FATIGUE_THRESHOLDS[specialty];
  const times = repetitionTimesSeconds.filter((time) => Number.isFinite(time) && time > 0);
  if (times.length < 2) {
    return { class: "DADOS_INSUFICIENTES", dropsPct: [], maxDropPct: null, reason: "Menos de duas repetições válidas para medir decaimento.", version: FATIGUE_ENGINE_VERSION };
  }
  const dropsPct: number[] = [];
  for (let index = 1; index < times.length; index += 1) {
    dropsPct.push(((times[index] - times[index - 1]) / times[index - 1]) * 100);
  }
  const maxDropPct = Math.max(...dropsPct);
  const painBlocked = pain !== undefined && pain >= 5;
  const techniqueDegraded = technique !== undefined && technique <= 2;
  if (maxDropPct > thresholds.criticalDropPct || painBlocked || techniqueDegraded) {
    return {
      class: "INTERROMPER_SERIE",
      dropsPct,
      maxDropPct,
      reason: painBlocked
        ? `Dor ${pain} ≥ 5 exige interrupção independentemente da queda.`
        : techniqueDegraded
          ? `Técnica ${technique} ≤ 2 degradada exige interrupção.`
          : `Queda de ${maxDropPct.toFixed(2)}% excede o limiar crítico de ${thresholds.criticalDropPct}% para ${specialty}.`,
      version: FATIGUE_ENGINE_VERSION,
    };
  }
  if (maxDropPct > thresholds.interruptionDropPct) {
    return {
      class: "FADIGA_TRANSITORIA",
      dropsPct,
      maxDropPct,
      reason: `Queda de ${maxDropPct.toFixed(2)}% acima de ${thresholds.interruptionDropPct}%: adaptar série (reduzir ou interromper).`,
      version: FATIGUE_ENGINE_VERSION,
    };
  }
  return {
    class: "TOLERANCIA_BOA",
    dropsPct,
    maxDropPct,
    reason: `Queda máxima de ${maxDropPct.toFixed(2)}% dentro da tolerância de ${thresholds.interruptionDropPct}%.`,
    version: FATIGUE_ENGINE_VERSION,
  };
}

/**
 * Matriz de recuperação interbloco por fase (manual §10 variantes de fundo e §14).
 * TAPER/COMPETIÇÃO privilegião recuperação completa; acumulação de fundo não tem
 * A1 automático entre blocos; transformação de fundo permite A1 interbloco só
 * 100–300 m com motivo.
 */
export type PhaseRecoveryMatrix = {
  phase: RkfPhaseId;
  interBlockRecovery: "AUTOMATICA_A1" | "CONDICIONAL_100_300" | "SEM_A1_AUTOMATICO" | "COMPLETA";
  notes: string;
};

export const PHASE_RECOVERY_MATRIX: Record<RkfPhaseId, PhaseRecoveryMatrix> = {
  ADAPTACAO: { phase: "ADAPTACAO", interBlockRecovery: "AUTOMATICA_A1", notes: "Técnica/SS; readiness <60 reduz volume em 20–30%." },
  BASE: { phase: "BASE", interBlockRecovery: "AUTOMATICA_A1", notes: "SS e A1/A2 com recuperação automática entre blocos." },
  DESENVOLVIMENTO: { phase: "DESENVOLVIMENTO", interBlockRecovery: "AUTOMATICA_A1", notes: "Progressivo com A1 interbloco padrão." },
  ESPECIFICO: { phase: "ESPECIFICO", interBlockRecovery: "AUTOMATICA_A1", notes: "Progressivo/MM; manter janelas de recuperação." },
  ACUMULACAO: { phase: "ACUMULACAO", interBlockRecovery: "SEM_A1_AUTOMATICO", notes: "Fundo: sem A1 automático entre blocos (acumulação sustentável)." },
  TRANSFORMACAO: { phase: "TRANSFORMACAO", interBlockRecovery: "CONDICIONAL_100_300", notes: "Fundo: A1 interbloco apenas 100–300 m com justificativa." },
  REALIZACAO: { phase: "REALIZACAO", interBlockRecovery: "COMPLETA", notes: "Recuperação ativa/completa permitida; parar com queda >3%." },
  TAPER: { phase: "TAPER", interBlockRecovery: "COMPLETA", notes: "Qualidade e recuperação completas." },
  COMPETICAO: { phase: "COMPETICAO", interBlockRecovery: "COMPLETA", notes: "RDC com recuperação completa entre estímulos." },
};

/** Recuperação aplicável a uma fase+especialidade (variantes de fundo, manual §10). */
export function recoveryForPhase(phase: RkfPhaseId, specialty?: Specialty): PhaseRecoveryMatrix {
  const base = PHASE_RECOVERY_MATRIX[phase];
  if (specialty !== "fundo") return base;
  if (phase === "TRANSFORMACAO") return { ...base, interBlockRecovery: "CONDICIONAL_100_300", notes: `${base.notes} Fundo: A1 interbloco restrito a 100–300 m.` };
  return base;
}

/**
 * Histórico de aprendizagem (manual §32.7): classifica a resposta do atleta
 * à carga sem alterar constituição, modelo ou zona.
 */
export type LearningHistoryInput = {
  pseDeviation: number;
  volumeAdherencePct: number;
  readiness: number;
  sleepHours?: number;
};

export type LearningHistoryClassification =
  | "CARGA_RITMO_ACIMA_DA_RESPOSTA"
  | "RECUPERACAO_TECNICA_LIMITANTE"
  | "BOA_TOLERANCIA"
  | "DADOS_INSUFICIENTES";

export function classifyLearningHistory(input: LearningHistoryInput): { classification: LearningHistoryClassification; reason: string } {
  const { pseDeviation, volumeAdherencePct, readiness, sleepHours } = input;
  if (!Number.isFinite(pseDeviation) || !Number.isFinite(volumeAdherencePct) || !Number.isFinite(readiness)) {
    return { classification: "DADOS_INSUFICIENTES", reason: "Campos obrigatórios ausentes ou inválidos." };
  }
  const adherenceRatio = volumeAdherencePct / 100;
  if (pseDeviation >= 2 && adherenceRatio > 1.03) {
    return { classification: "CARGA_RITMO_ACIMA_DA_RESPOSTA", reason: `PSE +${pseDeviation} acima do alvo com aderência ${volumeAdherencePct.toFixed(1)}%: carga/ritmo acima da resposta atual.` };
  }
  if (readiness < 70 && (sleepHours === undefined || sleepHours <= 3)) {
    return { classification: "RECUPERACAO_TECNICA_LIMITANTE", reason: `Readiness ${readiness} < 70 com recuperação limitada.` };
  }
  if (adherenceRatio >= 0.95 && Math.abs(pseDeviation) <= 1) {
    return { classification: "BOA_TOLERANCIA", reason: `Aderência ${volumeAdherencePct.toFixed(1)}% com desvio de PSE ≤ 1.` };
  }
  return { classification: "DADOS_INSUFICIENTES", reason: "Padrão não concluso; acumular mais sessões antes de classificar." };
}
