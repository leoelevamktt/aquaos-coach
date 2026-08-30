/**
 * Pipeline de evolução ponta a ponta (manual seção 19).
 * Agrega resultados históricos por chave comparável (8 partes), calcula o
 * score composto por sessão e o delta percentual contra a referência
 * anterior, e classifica com classifyEvolution. Sessão isolada nunca define
 * evolução; menos de 3 comparáveis retornam DADOS_INSUFICIENTES.
 */

import {
  bestTimeSeconds, buildComparableKey, classifyEvolution, comparabilityConfidence, compositeScore,
  EVOLUTION_VERSION, type ComparableKeyParts, type EvolutionAssessment,
} from "@natacao/domain";

export interface EvolutionSetInput {
  /** Identificação do conjunto comparável. */
  label: string;
  /** Readiness mais recente do atleta (classificação de fadiga). */
  readiness?: number;
  /** Sessões comparáveis em ordem cronológica crescente. */
  sessions: EvolutionSessionInput[];
}

export interface EvolutionSessionInput {
  date: string;
  /** Tempos das repetições do conjunto comparável, em segundos. */
  repetitionTimesSeconds: number[];
  /** 0–1: consistência das repetições dentro da sessão. */
  consistencyScore: number;
  /** 0–1: estado de fadiga reportado na sessão. */
  fatigueScore: number;
  /** 0–1: eficiência (percepção de esforço por velocidade, por ex.). */
  efficiencyScore: number;
}

export interface EvolutionSessionScore {
  date: string;
  timeScore: number;
  composite: number;
  bestTimeSeconds: number | null;
}

export interface EvolutionAssessmentResult extends EvolutionAssessment {
  label: string;
  comparables: number;
  scoreDeltaPct: number;
  sessions: EvolutionSessionScore[];
  latest: EvolutionSessionScore | null;
  reference: EvolutionSessionScore | null;
}

/** timeScore normalizado: melhor tempo já registrado como 1,0; pior como 0,0. */
function timeScores(sessions: readonly EvolutionSessionInput[]): number[] {
  const bests = sessions.map((session) => bestTimeSeconds(session.repetitionTimesSeconds));
  const valid = bests.filter((time): time is number => time !== null);
  if (!valid.length) return sessions.map(() => 0);
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min;
  return bests.map((time) => (time === null ? 0 : range === 0 ? 1 : (max - time) / range));
}

/**
 * Avalia um conjunto de sessões comparáveis entre si. O delta é calculado
 * entre o composite da última sessão e a média dos composites das anteriores;
 * positivo significa melhora (tempo menor = score maior).
 */
export function assessEvolutionSet(input: EvolutionSetInput): EvolutionAssessmentResult {
  const comparables = input.sessions.length;
  const scores = timeScores(input.sessions);
  const sessions: EvolutionSessionScore[] = input.sessions.map((session, index) => ({
    date: session.date,
    timeScore: scores[index],
    bestTimeSeconds: bestTimeSeconds(session.repetitionTimesSeconds),
    composite: compositeScore({
      timeScore: scores[index],
      consistencyScore: session.consistencyScore,
      fatigueScore: session.fatigueScore,
      efficiencyScore: session.efficiencyScore,
    }),
  }));

  const latest = sessions.at(-1) ?? null;
  const previous = sessions.slice(0, -1);
  const reference = previous.length
    ? { date: "referência", timeScore: 0, bestTimeSeconds: null, composite: previous.reduce((sum, session) => sum + session.composite, 0) / previous.length }
    : null;
  const scoreDeltaPct = latest && reference && reference.composite !== 0
    ? Math.round(((latest.composite - reference.composite) / reference.composite) * 10000) / 100
    : 0;

  let consecutiveNegativeTrends = 0;
  for (let index = sessions.length - 1; index > 0; index -= 1) {
    if (sessions[index].composite < sessions[index - 1].composite) consecutiveNegativeTrends += 1;
    else break;
  }

  const classification = classifyEvolution({
    comparables,
    scoreDeltaPct,
    readiness: input.readiness,
    consecutiveNegativeTrends,
  });

  return {
    ...classification,
    confidence: Math.round(comparabilityConfidence(comparables) * 100),
    label: input.label,
    comparables,
    scoreDeltaPct,
    sessions,
    latest,
    reference,
    version: EVOLUTION_VERSION,
  };
}

/** Monta a chave comparável de 8 partes; retorna null se incompleta (VAL-018). */
export function comparableKeyFor(parts: ComparableKeyParts): string | null {
  return buildComparableKey(parts);
}
