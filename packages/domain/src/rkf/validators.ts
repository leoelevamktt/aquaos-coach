/**
 * Validações de aplicação VAL-001..VAL-019 e PTR essenciais (manual seção 33).
 * Campo ausente nunca vira zero sem semântica de "zero real" definida.
 */

import { normalizeZoneCode, ZONE_CODES, type MaterialCode, type ProgressionCode, type SkillCode, type ZoneCode, evaluateMaterialPolicy, validateProgression, VALID_PROGRESSIONS } from "./zones.js";

export interface ValidationFinding {
  code: string;
  passed: boolean;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  findings: ValidationFinding[];
}

const ok = (code: string, message = ""): ValidationFinding => ({ code, passed: true, message });
const fail = (code: string, message: string): ValidationFinding => ({ code, passed: false, message });

export const SESSION_COMPONENTS = ["AQUECIMENTO", "PERNA", "BRAÇO", "PRÉ-SÉRIE", "SÉRIE PRINCIPAL", "REGENERATIVO"] as const;
export type SessionComponent = (typeof SESSION_COMPONENTS)[number];

/** Limiares declarados para plausibilidade (decisão de engenharia versionada). */
export const PLAUSIBILITY = {
  maxRepetitionSeconds: 1800,
  splitToleranceRatio: 0.01,
} as const;

export interface RkfSessionBlockLike {
  component: SessionComponent;
  volumeM: number;
  zone?: ZoneCode | string;
  materials?: MaterialCode[];
  skills?: SkillCode[];
  justificationForZero?: string;
  interval?: string;
  progression?: ProgressionCode;
}

export interface RkfSessionLike {
  primaryZone: ZoneCode | string;
  rdcMarker: boolean;
  blocks: readonly RkfSessionBlockLike[];
  ageContext?: { age: number; developmentLevel: "formacao" | "rendimento"; shoulderFatigued?: boolean; painOrInjury?: boolean };
}

/** VAL-001/002/003/004/005 + R002/R006/R010/R011 aplicados à sessão. */
export function validateRkfSession(session: RkfSessionLike): ValidationResult {
  const findings: ValidationFinding[] = [];

  const totalVolume = session.blocks.reduce((sum, block) => sum + block.volumeM, 0);
  findings.push(totalVolume % 10 === 0
    ? ok("VAL-001", `Volume total ${totalVolume} m é múltiplo de 10.`)
    : fail("VAL-001", `Volume total ${totalVolume} m não é múltiplo de 10.`));

  for (const block of session.blocks) {
    if (block.volumeM < 0 || block.volumeM % 10 !== 0) {
      findings.push(fail("VAL-002", `Bloco ${block.component} com volume ${block.volumeM} m inválido (inteiro não negativo, múltiplo de 10).`));
    }
    if (block.volumeM === 0 && !block.justificationForZero) {
      findings.push(fail("R010", `Bloco ${block.component} ausente sem justificativa registrada.`));
    }
  }

  const primary = normalizeZoneCode(String(session.primaryZone ?? ""));
  findings.push(primary.zone !== null
    ? ok("VAL-003", `Zona primária ${session.primaryZone} pertence ao vocabulário oficial${primary.mappedFrom ? ` (mapeada de ${primary.mappedFrom})` : ""}.`)
    : fail("VAL-003", `Zona primária ${String(session.primaryZone)} fora do vocabulário RKF (R002/R003).`));

  findings.push(typeof session.rdcMarker === "boolean"
    ? ok("VAL-004", "rdc_marker é booleano e separado de zone_code.")
    : fail("VAL-004", "rdc_marker deve ser booleano, nunca zone_code."));

  const present = new Set(session.blocks.map((block) => block.component));
  const missing = SESSION_COMPONENTS.filter((component) => !present.has(component));
  findings.push(missing.length === 0
    ? ok("VAL-005", "Sessão completa com os seis componentes RKF.")
    : fail("VAL-005", `Componentes ausentes: ${missing.join(", ")} (ausência exige 0 m com justificativa — R010).`));

  const highStress = session.blocks.filter((block) => {
    const zone = normalizeZoneCode(String(block.zone ?? primary.zone ?? ""));
    return zone.zone === "AN2" || zone.zone === "VALAT";
  });
  const highStressVolume = highStress.reduce((sum, block) => sum + block.volumeM, 0);
  findings.push(totalVolume === 0 || highStressVolume / totalVolume <= 0.15
    ? ok("R006", `Volume AN2+VALAT = ${highStressVolume} m (${totalVolume > 0 ? Math.round((highStressVolume / totalVolume) * 100) : 0}% do total).`)
    : fail("R006", `AN2+VALAT representam mais de 15% do volume; maior intensidade exige menor volume.`));

  for (const block of session.blocks) {
    if (block.zone !== undefined) {
      const zone = normalizeZoneCode(String(block.zone));
      if (zone.zone === null && !zone.rdcMarker) {
        findings.push(fail("R002", `Bloco ${block.component} com zona inválida: ${String(block.zone)}.`));
      }
    }
    if (block.progression !== undefined) {
      if (!(VALID_PROGRESSIONS as readonly string[]).includes(block.progression)) {
        findings.push(fail("R006", `Progressão ${block.progression} não é válida.`));
      } else {
        const zones = session.blocks.map((b) => normalizeZoneCode(String(b.zone ?? "")).zone).filter((z): z is ZoneCode => z !== null);
        const progression = validateProgression(block.progression, zones);
        if (!progression.valid) findings.push(fail("R006", progression.reason ?? `Progressão ${block.progression} inválida.`));
      }
    }
    if (session.ageContext) {
      const zones = session.blocks.map((b) => normalizeZoneCode(String(b.zone ?? "")).zone).filter((z): z is ZoneCode => z !== null);
      for (const material of block.materials ?? []) {
        const policy = evaluateMaterialPolicy(material, {
          age: session.ageContext.age,
          developmentLevel: session.ageContext.developmentLevel,
          zones,
          shoulderFatigued: session.ageContext.shoulderFatigued,
          painOrInjury: session.ageContext.painOrInjury,
        });
        if (!policy.allowed) findings.push(fail("R009", `Material ${material} no bloco ${block.component}: ${policy.violations.join(" ")}`));
      }
    }
  }

  return { valid: findings.every((finding) => finding.passed), findings };
}

/** VAL-006/007/008: ranges de domínio. */
export function validateResponseRanges(input: { readiness?: number; pain?: number; rpe?: number; technique?: number }): ValidationResult {
  const findings: ValidationFinding[] = [];
  if (input.readiness !== undefined) findings.push(input.readiness >= 0 && input.readiness <= 100 ? ok("VAL-006") : fail("VAL-006", "Readiness deve estar entre 0 e 100."));
  if (input.pain !== undefined) findings.push(input.pain >= 0 && input.pain <= 10 ? ok("VAL-007") : fail("VAL-007", "Dor deve estar entre 0 e 10."));
  if (input.rpe !== undefined) findings.push(input.rpe >= 0 && input.rpe <= 10 ? ok("VAL-008") : fail("VAL-008", "PSE deve estar entre 0 e 10."));
  if (input.technique !== undefined) findings.push(input.technique >= 1 && input.technique <= 5 ? ok("VAL-008b", "Técnica 1–5.") : fail("VAL-008b", "Técnica deve estar entre 1 e 5."));
  return { valid: findings.every((finding) => finding.passed), findings };
}

export interface RepetitionResultLike {
  setResultId: string;
  repetitionNumber: number;
  timeSeconds: number;
  splitsSeconds?: readonly number[];
}

/** VAL-015/016/017: tempos positivos e plausíveis, reps únicas, parciais coerentes. */
export function validateSetResults(repetitions: readonly RepetitionResultLike[]): ValidationResult {
  const findings: ValidationFinding[] = [];
  const bySet = new Map<string, RepetitionResultLike[]>();
  for (const repetition of repetitions) {
    const list = bySet.get(repetition.setResultId) ?? [];
    list.push(repetition);
    bySet.set(repetition.setResultId, list);
  }
  for (const [setId, reps] of bySet) {
    const numbers = reps.map((rep) => rep.repetitionNumber);
    const duplicates = numbers.filter((number, index) => numbers.indexOf(number) !== index);
    findings.push(duplicates.length === 0 ? ok("VAL-016", `Série ${setId}: repetições únicas.`) : fail("VAL-016", `Série ${setId}: repetições duplicadas ${[...new Set(duplicates)].join(", ")}.`));
    for (const rep of reps) {
      findings.push(rep.timeSeconds > 0 && rep.timeSeconds <= PLAUSIBILITY.maxRepetitionSeconds
        ? ok("VAL-015", `Série ${setId} rep ${rep.repetitionNumber}: tempo plausível.`)
        : fail("VAL-015", `Série ${setId} rep ${rep.repetitionNumber}: tempo ${rep.timeSeconds}s fora do domínio plausível (0; ${PLAUSIBILITY.maxRepetitionSeconds}].`));
      if (rep.splitsSeconds !== undefined && rep.splitsSeconds.length) {
        const splitSum = rep.splitsSeconds.reduce((sum, split) => sum + split, 0);
        const coherent = rep.splitsSeconds.every((split) => split > 0) && splitSum <= rep.timeSeconds * (1 + PLAUSIBILITY.splitToleranceRatio);
        findings.push(coherent
          ? ok("VAL-017", `Série ${setId} rep ${rep.repetitionNumber}: parciais coerentes.`)
          : fail("VAL-017", `Série ${setId} rep ${rep.repetitionNumber}: soma das parciais (${splitSum}s) incoerente com o tempo final (${rep.timeSeconds}s).`));
      }
    }
  }
  return { valid: findings.every((finding) => finding.passed), findings };
}

/** VAL-018/019: chave comparável completa e mínimo de comparáveis. */
export function validateComparability(comparableKey: string | null, comparables: number): ValidationResult {
  const findings: ValidationFinding[] = [
    comparableKey !== null ? ok("VAL-018", "Chave comparável completa.") : fail("VAL-018", "Chave comparável incompleta: excluir de analytics."),
    comparables >= 3 ? ok("VAL-019", `${comparables} comparáveis.`) : fail("VAL-019", `Evolução exige >= 3 sessões comparáveis (recebeu ${comparables}).`),
  ];
  return { valid: findings.every((finding) => finding.passed), findings };
}

/** VAL-011/012: timestamps UTC e created/updated em mutáveis ficam na camada de persistência. */
export function assertUtcTimestamp(value: string): ValidationFinding {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/.test(value)
    ? ok("VAL-011", "Timestamp UTC.")
    : fail("VAL-011", `Timestamp ${value} não está em UTC ISO-8601 com sufixo Z.`);
}
