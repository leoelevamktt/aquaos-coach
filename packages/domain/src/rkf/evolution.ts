/**
 * Pós-treino e evolução RKF (manual seção 19).
 * Hierarquia: session_result → set_result → repetition_result → split_result.
 * Comparar somente chave 100% igual; sessão isolada nunca define evolução.
 */

export const EVOLUTION_VERSION = "rkf-evolution-1.0.0";

export interface ComparableKeyParts {
  athleteId: string;
  stroke: string;
  distanceM: number;
  zone: string;
  mode: string;
  material: string;
  pool: string;
  protocol: string;
}

/** Chave comparável: athlete | stroke | distance | zone | mode | material | pool | protocol. */
export function buildComparableKey(parts: ComparableKeyParts): string | null {
  const values: Array<string | number> = [
    parts.athleteId, parts.stroke, parts.distanceM, parts.zone,
    parts.mode, parts.material, parts.pool, parts.protocol,
  ];
  if (values.some((value) => value === undefined || value === null || value === "")) return null;
  return values.join("|");
}

/** Confiança de comparabilidade: MIN(0,95; 0,35 + 0,15 × comparáveis). */
export function comparabilityConfidence(comparables: number): number {
  return Math.min(0.95, 0.35 + 0.15 * comparables);
}

/**
 * Melhor tempo da série — substitui o MINIFS #NUM! do workbook por backend:
 * MIN(time_seconds) WHERE time_seconds > 0.
 */
export function bestTimeSeconds(repetitionTimesSeconds: readonly number[]): number | null {
  const valid = repetitionTimesSeconds.filter((time) => Number.isFinite(time) && time > 0);
  return valid.length ? Math.min(...valid) : null;
}

export interface CompositeScoreInput {
  /** 0–1 por dimensão, normalizados antes da chamada. */
  timeScore: number;
  consistencyScore: number;
  fatigueScore: number;
  efficiencyScore: number;
}

/** composite = 0,45×tempo + 0,20×consistência + 0,15×fadiga + 0,20×eficiência */
export function compositeScore(input: CompositeScoreInput): number {
  return Math.round((0.45 * input.timeScore + 0.2 * input.consistencyScore + 0.15 * input.fatigueScore + 0.2 * input.efficiencyScore) * 10000) / 10000;
}

export type EvolutionClassification =
  | "DADOS_INSUFICIENTES" | "EVOLUCAO_CONFIRMADA" | "PROVAVEL_EVOLUCAO"
  | "ESTAVEL" | "PROVAVEL_INVOLUCAO" | "FADIGA_TRANSITORIA"
  | "INVOLUCAO_CONFIRMADA" | "MONITORAR";

export interface EvolutionAssessmentInput {
  comparables: number;
  /** Variação percentual do score composto (positivo = melhora). */
  scoreDeltaPct: number;
  readiness?: number;
  /** Tendências negativas consecutivas. */
  consecutiveNegativeTrends?: number;
  /** Se há explicação de carga/saúde para a queda. */
  explainedByLoadOrHealth?: boolean;
}

export interface EvolutionAssessment {
  classification: EvolutionClassification;
  confidence: number;
  requiresCoach: boolean;
  rationale: string;
  version: string;
}

/**
 * Interpretação declarada: os intervalos ">=25" e "10–24,99" contam sessões
 * comparáveis (coerente com "menos de 3 dados: insuficiente"); "melhora
 * >= 1,5%" refere-se ao delta do score composto. Confiança usa a fórmula
 * MIN(0,95; 0,35 + 0,15 × comparáveis).
 */
export function classifyEvolution(input: EvolutionAssessmentInput): EvolutionAssessment {
  const confidencePct = Math.round(comparabilityConfidence(input.comparables) * 100);

  if (input.comparables < 3) {
    return { classification: "DADOS_INSUFICIENTES", confidence: confidencePct, requiresCoach: false, rationale: "Menos de 3 sessões comparáveis: nenhuma conclusão.", version: EVOLUTION_VERSION };
  }
  if (input.consecutiveNegativeTrends !== undefined && input.consecutiveNegativeTrends >= 3 && input.comparables >= 5 && !input.explainedByLoadOrHealth) {
    return { classification: "INVOLUCAO_CONFIRMADA", confidence: confidencePct, requiresCoach: true, rationale: "Três tendências negativas consecutivas com 5+ comparáveis sem explicação de carga/saúde: investigar.", version: EVOLUTION_VERSION };
  }
  if (input.scoreDeltaPct >= 1.5) {
    if (input.comparables >= 25) {
      return { classification: "EVOLUCAO_CONFIRMADA", confidence: confidencePct, requiresCoach: false, rationale: `${input.comparables} comparáveis (>= 25) com melhora de ${input.scoreDeltaPct}% >= 1,5%.`, version: EVOLUTION_VERSION };
    }
    return { classification: "PROVAVEL_EVOLUCAO", confidence: confidencePct, requiresCoach: true, rationale: `${input.comparables} comparáveis com melhora >= 1,5%: provável evolução.`, version: EVOLUTION_VERSION };
  }
  if (input.scoreDeltaPct >= -9.99 && input.scoreDeltaPct <= 9.99) {
    return { classification: "ESTAVEL", confidence: confidencePct, requiresCoach: false, rationale: `Delta ${input.scoreDeltaPct}% dentro de −9,99 a 9,99.`, version: EVOLUTION_VERSION };
  }
  if (input.scoreDeltaPct <= -25 && (input.readiness ?? 0) >= 70) {
    return { classification: "PROVAVEL_INVOLUCAO", confidence: confidencePct, requiresCoach: true, rationale: "Queda >= 25% com readiness >= 70: provável involução, avaliar com o treinador.", version: EVOLUTION_VERSION };
  }
  if (input.scoreDeltaPct < 0 && (input.readiness ?? 0) < 70) {
    return { classification: "FADIGA_TRANSITORIA", confidence: confidencePct, requiresCoach: false, rationale: "Score negativo com readiness < 70: fadiga transitória.", version: EVOLUTION_VERSION };
  }
  return { classification: "MONITORAR", confidence: confidencePct, requiresCoach: true, rationale: "Delta fora dos limiares principais: manter monitoramento.", version: EVOLUTION_VERSION };
}
