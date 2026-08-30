/**
 * Motor de ciclos RKF — validação de entrada, alocação de fases e progressão
 * de volume com onda (manual seções 12 e 13). Todo volume é arredondado a
 * múltiplo de 10 em ponto controlado; o residual é auditado e destinado ao
 * bloco regenerativo ou permitido.
 */

import { allocatePhases, PHASE_BY_ID, resolveCycleModel, type CycleModel, type PhaseWeek, type RkfPhaseId } from "./periodization.js";
import { concludeAudit, type RuleAudit, type RuleCheckResult } from "./rules.js";

export interface CycleRequest {
  age: number;
  totalWeeks: number;
  sessionsPerWeek: number;
  currentVolumeM: number;
  maxVolumeM: number;
  competitionWeeks?: number;
  taperWeeks?: number;
  readiness?: number;
  model?: CycleModel | "AUTO";
}

export type CycleValidationStatus = "PRONTO" | "REVISAR";

export interface CycleValidation {
  status: CycleValidationStatus;
  reasons: string[];
}

/** Espelha a fórmula de validação do workbook (manual seção 13). */
export function validateCycleRequest(request: CycleRequest): CycleValidation {
  const reasons: string[] = [];
  if (request.age < 8) reasons.push("Idade mínima é 8 anos.");
  if (request.totalWeeks < 4 || request.totalWeeks > 52) reasons.push("Total de semanas deve estar entre 4 e 52.");
  if (request.sessionsPerWeek < 2 || request.sessionsPerWeek > 10) reasons.push("Sessões por semana devem estar entre 2 e 10.");
  if (!(request.currentVolumeM > 0)) reasons.push("Volume atual deve ser maior que zero.");
  if (request.maxVolumeM < request.currentVolumeM) reasons.push("Volume máximo não pode ser menor que o atual.");
  if ((request.competitionWeeks ?? 1) > request.totalWeeks) reasons.push("Semanas de competição excedem o total.");
  if ((request.taperWeeks ?? 0) > request.totalWeeks) reasons.push("Semanas de taper excedem o total.");
  if (request.readiness !== undefined && (request.readiness < 0 || request.readiness > 100)) reasons.push("Readiness deve estar entre 0 e 100.");
  return { status: reasons.length ? "REVISAR" : "PRONTO", reasons };
}

export function roundToMultipleOf10(value: number): number {
  return Math.round(value / 10) * 10;
}

/** Onda do ciclo: semana múltipla de 4 é semana leve (0,82). */
export function cycleWave(week: number): number {
  if (week % 4 === 0) return 0.82;
  return 0.92 + 0.04 * ((week - 1) % 4);
}

export interface CycleWeekPlan {
  week: number;
  phase: RkfPhaseId;
  phaseLabel: string;
  rawVolumeM: number;
  plannedVolumeM: number;
  roundedToMultipleOf10: true;
  waveFactor: number;
  phaseFactor: number;
  progressiveBaseM: number;
}

export interface CyclePlan {
  model: CycleModel;
  weeks: CycleWeekPlan[];
  totalPlannedVolumeM: number;
  roundingResidualM: number;
  residualDestination: "REGENERATIVO";
  audit: RuleAudit;
  generatedAtUtc: string;
}

export function generateCycle(request: CycleRequest, now = new Date()): CyclePlan {
  const validation = validateCycleRequest(request);
  if (validation.status !== "PRONTO") {
    throw new Error(`Ciclo inválido (REVISAR): ${validation.reasons.join(" ")}`);
  }

  const model = resolveCycleModel(request.age, request.model);
  const phaseWeeks: PhaseWeek[] = allocatePhases(request.totalWeeks, model);
  const weeks: CycleWeekPlan[] = phaseWeeks.map((phaseWeek) => {
    const phase = PHASE_BY_ID[phaseWeek.phase];
    const progressiveBase =
      request.currentVolumeM +
      (request.maxVolumeM - request.currentVolumeM) * Math.min(phaseWeek.week / (request.totalWeeks * 0.7), 1);
    const wave = cycleWave(phaseWeek.week);
    const raw = Math.min(request.maxVolumeM, progressiveBase * phase.volumeFactor * wave);
    return {
      week: phaseWeek.week,
      phase: phaseWeek.phase,
      phaseLabel: phaseWeek.phaseLabel,
      rawVolumeM: Math.round(raw * 100) / 100,
      plannedVolumeM: roundToMultipleOf10(raw),
      roundedToMultipleOf10: true,
      waveFactor: wave,
      phaseFactor: phase.volumeFactor,
      progressiveBaseM: Math.round(progressiveBase * 100) / 100,
    };
  });

  const totalPlanned = weeks.reduce((sum, week) => sum + week.plannedVolumeM, 0);
  const totalRaw = weeks.reduce((sum, week) => sum + week.rawVolumeM, 0);
  const checks: RuleCheckResult[] = [
    { ruleId: "R001", severity: "HARD", passed: weeks.every((week) => week.plannedVolumeM % 10 === 0), detail: "Volume semanal arredondado a múltiplo de 10." },
    { ruleId: "R006", severity: "HARD", passed: weeks.every((week) => week.plannedVolumeM >= 0 && week.plannedVolumeM <= request.maxVolumeM), detail: "Volume semanal não excede o máximo." },
    { ruleId: "R007", severity: "GUIDE", passed: model === resolveCycleModel(request.age), detail: `Modelo ${model} coerente com a idade ${request.age}.` },
  ];

  return {
    model,
    weeks,
    totalPlannedVolumeM: totalPlanned,
    roundingResidualM: Math.round((totalPlanned - totalRaw) * 100) / 100,
    residualDestination: "REGENERATIVO",
    audit: concludeAudit(checks, now),
    generatedAtUtc: now.toISOString(),
  };
}
