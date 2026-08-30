import { describe, expect, it } from "vitest";
import {
  AGE_BANDS, PHASES, PHASE_BY_ID, allocatePhases, resolveCycleModel,
} from "./periodization.js";
import { DISTRIBUTION_COLUMNS, getDistributionRow, ZONE_DISTRIBUTION, type DistributionProfile } from "./distribution.js";
import { RULES_RKF } from "./rules.js";
import { generateCycle, roundToMultipleOf10, validateCycleRequest, cycleWave } from "./cycle-engine.js";
import {
  aggregateDailyLoads, buildLoadAlerts, coldStartFor, computeAdherence, computeChronicSeries,
  computeLoadLayers, computeMonotony, sessionRpeLoad, type LoadSessionInput,
} from "./load.js";
import {
  applyGuardrails, classifyReadiness, computeResponseIndex, decideAdaptation, READINESS_CLASSES,
} from "./readiness.js";
import { bestTimeSeconds, buildComparableKey, classifyEvolution, comparabilityConfidence, compositeScore } from "./evolution.js";
import { normalizeZoneCode, parseInterval, validateProgression, evaluateMaterialPolicy } from "./zones.js";
import { assertUtcTimestamp, validateComparability, validateRkfSession, validateResponseRanges, validateSetResults } from "./validators.js";
import { DEFAULT_RANKING_WEIGHTS, generatePrescription, type LibrarySession, type PlanningAthleteContext, type PlanningRequest } from "./planning-engine.js";

const athlete16: PlanningAthleteContext = {
  athleteId: "ath-16", age: 16, developmentLevel: "rendimento",
  specialty: "meio_fundo", poolLengthM: 25, eventMeters: 200,
};

const uat01Request: PlanningRequest = {
  phase: "TRANSFORMACAO", objective: "A2/A3 com ênfase de virada", primaryZone: "A2", secondaryZone: "A3",
  targetVolumeM: 5800, rdcMarker: false, requiredLegVolumeM: 600, skillEmphasis: ["TURN_FREE", "STREAMLINE"],
  readiness: 82, dayOfWeek: 3,
};

describe("zonas e dicionários (seção 9)", () => {
  it("expõe as seis zonas oficiais com mapeamento externo (R002/R003)", () => {
    expect(normalizeZoneCode("EN2").zone).toBe("A2");
    expect(normalizeZoneCode("SP3").zone).toBe("VALAT");
    expect(normalizeZoneCode("N1").zone).toBe("AN1");
    expect(normalizeZoneCode("RP100")).toEqual({ zone: null, rdcMarker: true, mappedFrom: "RP100" });
    expect(normalizeZoneCode("ZONA_X")).toEqual({ zone: null, rdcMarker: false });
  });

  it("distingue send-off de recuperação real", () => {
    expect(parseInterval("@ 1:20")).toEqual({ kind: "SEND_OFF", seconds: 80, raw: "@ 1:20" });
    expect(parseInterval("20 sec rest")).toEqual({ kind: "REST", seconds: 20, raw: "20 sec rest" });
    expect(parseInterval("livre")).toBeNull();
  });

  it("valida progressões e ordem das zonas", () => {
    expect(validateProgression("PROG_A2_A3", ["A2", "A3"]).valid).toBe(true);
    expect(validateProgression("PROG_A2_A3", ["A3", "A2"]).valid).toBe(false);
    expect(validateProgression("PROG_A2_A3", ["A2"]).valid).toBe(false);
  });

  it("aplica política de material por idade e estado (UAT-02 análogo)", () => {
    expect(evaluateMaterialPolicy("PALMAR_G", { age: 14, developmentLevel: "rendimento", zones: ["A2"] }).allowed).toBe(false);
    expect(evaluateMaterialPolicy("PALMAR_G", { age: 16, developmentLevel: "rendimento", zones: ["A2"] }).allowed).toBe(true);
    expect(evaluateMaterialPolicy("PALMAR_G", { age: 16, developmentLevel: "rendimento", zones: ["VALAT"] }).allowed).toBe(false);
    expect(evaluateMaterialPolicy("PALMAR_P", { age: 9, developmentLevel: "formacao", zones: ["A1"] }).allowed).toBe(false);
    expect(evaluateMaterialPolicy("PALMAR_P", { age: 12, developmentLevel: "formacao", zones: ["A2"] }).allowed).toBe(true);
    expect(evaluateMaterialPolicy("PALMAR_M", { age: 14, developmentLevel: "formacao", zones: ["VALAT"] }).allowed).toBe(false);
    expect(evaluateMaterialPolicy("BOARD", { age: 9, developmentLevel: "formacao", zones: ["A1"], painOrInjury: true }).allowed).toBe(true);
  });
});

describe("periodização (seção 10)", () => {
  it("resolve modelo LINEAR até 13 anos e ATR a partir de 14 (AUTO)", () => {
    expect(resolveCycleModel(12)).toBe("LINEAR_RKF");
    expect(resolveCycleModel(13)).toBe("LINEAR_RKF");
    expect(resolveCycleModel(14)).toBe("ATR_RKF");
    expect(resolveCycleModel(30, "LINEAR_RKF")).toBe("LINEAR_RKF");
  });

  it("aloca fases LINEAR e ATR com competição na última semana", () => {
    const linear = allocatePhases(16, "LINEAR_RKF");
    expect(linear[0].phase).toBe("ADAPTACAO");
    expect(linear[15].phase).toBe("COMPETICAO");
    expect(linear[14].phase).toBe("TAPER");
    const atr = allocatePhases(16, "ATR_RKF");
    expect(atr[0].phase).toBe("ADAPTACAO");
    expect(atr[2].phase).toBe("ACUMULACAO");
    expect(atr.some((week) => week.phase === "TRANSFORMACAO")).toBe(true);
    expect(atr.some((week) => week.phase === "REALIZACAO")).toBe(true);
    expect(atr[15].phase).toBe("COMPETICAO");
  });

  it("mantém fatores de fase do manual", () => {
    expect(PHASE_BY_ID.REALIZACAO.volumeFactor).toBe(0.82);
    expect(PHASE_BY_ID.TAPER.volumeFactor).toBe(0.58);
    expect(PHASE_BY_ID.COMPETICAO.volumeFactor).toBe(0.42);
    expect(PHASE_BY_ID.COMPETICAO.maxStrength).toBe(0);
    expect(PHASES).toHaveLength(9);
    expect(AGE_BANDS.find((band) => band.label === "15–17")?.taperDays).toEqual({ min: 10, max: 14 });
  });
});

describe("distribuição de zonas (seção 11)", () => {
  const profiles: DistributionProfile[] = ["SPEED", "MEIO_FUNDO", "FUNDO"];
  it("toda linha soma 1 com tolerância 0,0001", () => {
    for (const profile of profiles) {
      for (const phase of Object.keys(ZONE_DISTRIBUTION[profile].A1) as Array<keyof typeof ZONE_DISTRIBUTION[profile]["A1"]>) {
        const row = getDistributionRow(profile, phase);
        expect(row.total).toBeCloseTo(1, 4);
        expect(row.valid).toBe(true);
      }
    }
  });

  it("MEIO_FUNDO TRANSFORMACAO reproduz a linha do manual", () => {
    const row = getDistributionRow("MEIO_FUNDO", "TRANSFORMACAO");
    expect(row.tec).toBe(0.07);
    expect(row.zones.A2).toBe(0.3);
    expect(row.zones.A3).toBe(0.14);
    expect(DISTRIBUTION_COLUMNS).toHaveLength(6);
  });
});

describe("regras RKF (seção 15)", () => {
  it("catálogo completo com severidades", () => {
    expect(RULES_RKF).toHaveLength(18);
    expect(RULES_RKF.find((rule) => rule.id === "R001")?.severity).toBe("HARD");
    expect(RULES_RKF.find((rule) => rule.id === "R007")?.severity).toBe("GUIDE");
    expect(RULES_RKF.find((rule) => rule.id === "R016")?.severity).toBe("ARCH");
  });
});

describe("motor de ciclos (seção 13)", () => {
  it("valida entrada como o workbook (PRONTO/REVISAR)", () => {
    expect(validateCycleRequest({ age: 16, totalWeeks: 16, sessionsPerWeek: 8, currentVolumeM: 40000, maxVolumeM: 55000 }).status).toBe("PRONTO");
    expect(validateCycleRequest({ age: 7, totalWeeks: 16, sessionsPerWeek: 8, currentVolumeM: 40000, maxVolumeM: 55000 }).reasons[0]).toContain("Idade mínima");
    expect(validateCycleRequest({ age: 16, totalWeeks: 3, sessionsPerWeek: 8, currentVolumeM: 40000, maxVolumeM: 55000 }).status).toBe("REVISAR");
    expect(validateCycleRequest({ age: 16, totalWeeks: 16, sessionsPerWeek: 8, currentVolumeM: 60000, maxVolumeM: 55000 }).status).toBe("REVISAR");
  });

  it("onda do ciclo: semanas 0,92/0,96/1,00 e leve 0,82", () => {
    expect(cycleWave(1)).toBeCloseTo(0.92);
    expect(cycleWave(2)).toBeCloseTo(0.96);
    expect(cycleWave(3)).toBeCloseTo(1.0);
    expect(cycleWave(4)).toBeCloseTo(0.82);
    expect(cycleWave(5)).toBeCloseTo(0.92);
  });

  it("gera volumes múltiplos de 10 sem exceder o máximo (R001/R006)", () => {
    const plan = generateCycle({ age: 16, totalWeeks: 16, sessionsPerWeek: 8, currentVolumeM: 40000, maxVolumeM: 55000 });
    expect(plan.model).toBe("ATR_RKF");
    expect(plan.weeks).toHaveLength(16);
    for (const week of plan.weeks) {
      expect(week.plannedVolumeM % 10).toBe(0);
      expect(week.plannedVolumeM).toBeLessThanOrEqual(55000);
      expect(week.plannedVolumeM).toBeGreaterThan(0);
    }
    expect(plan.audit.passed).toBe(true);
    expect(plan.residualDestination).toBe("REGENERATIVO");
    expect(roundToMultipleOf10(5805)).toBe(5810);
  });
});

describe("carga (seção 17 e 32.1)", () => {
  it("UAT-03: sRPE PSE 7 × 90 min = 630 UA com campos salvos separadamente", () => {
    const result = computeLoadLayers([{ athleteId: "a1", date: "2026-08-29", pse: 7, durationMinutes: 90 }]);
    expect(sessionRpeLoad(7, 90)).toBe(630);
    expect(result.layers.internal?.loadUa).toBe(630);
    expect(result.sessionLoads[0]).toEqual({ pse: 7, durationMinutes: 90, internalLoadUa: 630 });
  });

  it("UAT-04: recalcula aderência sem alterar a prescrição", () => {
    const adherence = computeAdherence(3500, 3400, 7, 7);
    expect(adherence.volumeAdherencePct).toBeCloseTo(97.14, 1);
    expect(adherence.pseDeviation).toBe(0);
    const layers = computeLoadLayers([{ athleteId: "a1", date: "2026-08-29", pse: 7, durationMinutes: 90, prescribedVolumeM: 3500, executedVolumeM: 3400 }]);
    expect(layers.layers.prescribed).toEqual({ volumeM: 3500 });
    expect(layers.layers.executed).toEqual({ volumeM: 3400 });
  });

  it("agrega múltiplas sessões do mesmo dia em uma única linha diária", () => {
    const sessions: LoadSessionInput[] = [
      { athleteId: "a1", date: "2026-08-28", pse: 5, durationMinutes: 60 },
      { athleteId: "a1", date: "2026-08-28", pse: 4, durationMinutes: 45 },
      { athleteId: "a1", date: "2026-08-29", pse: 6, durationMinutes: 75 },
    ];
    const daily = aggregateDailyLoads(sessions);
    expect(daily).toHaveLength(2);
    expect(daily[0]).toEqual({ athleteId: "a1", date: "2026-08-28", internalLoadUa: 480, sessionCount: 2 });
  });

  it("EWMA reproduz o workbook: ATL inicia no 7º dia ativo, CTL no 42º", () => {
    const sessions: LoadSessionInput[] = Array.from({ length: 50 }, (_, index) => ({
      athleteId: "a1", date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10), pse: 5, durationMinutes: 100,
    }));
    const { points } = computeChronicSeries(sessions, "a1");
    expect(points[6].atl).toBe(500);
    expect(points[5].atl).toBeNull();
    const day8 = points[7];
    expect(day8.atl).toBeCloseTo(500 + (500 - 500) / 7, 5);
    expect(points[40].ctl).toBeNull();
    expect(points[41].ctl).toBe(500);
    expect(points[41].coldStart.stage).toBe("CS4");
    expect(points[0].coldStart.stage).toBe("CS0");
    expect(points[2].coldStart.confidence).toBeCloseTo(0.2);
  });

  it("cold start CS0–CS4 com pontos médios versionados", () => {
    expect(coldStartFor(1).stage).toBe("CS0");
    expect(coldStartFor(7).stage).toBe("CS1");
    expect(coldStartFor(14).stage).toBe("CS2");
    expect(coldStartFor(28).stage).toBe("CS3");
    expect(coldStartFor(42).stage).toBe("CS4");
    expect(coldStartFor(42).confidence).toBeCloseTo(0.85);
  });

  it("SD zero retorna INSUFFICIENT_DATA e nunca divide silenciosamente", () => {
    const result = computeMonotony([500, 500, 500, 500, 500, 500, 500]);
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.monotony).toBeNull();
    expect(result.standardDeviation).toBe(0);
  });

  it("calcula monotonia e strain com janela de 7 dias", () => {
    const result = computeMonotony([400, 600, 500, 700, 500, 600, 400]);
    expect(result.mean).toBeCloseTo(528.57, 1);
    expect(result.monotony).toBeGreaterThan(0);
    expect(result.strain).toBeCloseTo(Math.round(result.weeklyLoadUa! * result.monotony! * 100) / 100);
  });

  it("gera alertas consultivos sem decidir sessão isoladamente", () => {
    const alerts = buildLoadAlerts({
      sessions: [{ athleteId: "a1", date: "2026-08-29", pse: 9, durationMinutes: 90, expectedPse: 6, prescribedVolumeM: 3500, executedVolumeM: 2000 }],
      monotony: computeMonotony([100, 100, 100, 100, 100, 100, 100]),
    });
    const codes = alerts.map((alert) => alert.code);
    expect(codes).toContain("PSE_ACIMA_DO_ESPERADO");
    expect(codes).toContain("BAIXA_ADERENCIA");
    expect(codes).toContain("DADOS_INSUFICIENTES");
  });
});

describe("readiness e adaptação (seção 18)", () => {
  it("classifica as cinco faixas com fatores oficiais", () => {
    expect(classifyReadiness(30).class).toBe("BLOQUEAR");
    expect(classifyReadiness(50)).toMatchObject({ class: "REDUZIR_FORTE", volumeFactor: 0.7 });
    expect(classifyReadiness(70).volumeFactor).toBe(0.85);
    expect(classifyReadiness(82)).toMatchObject({ class: "MANTER", volumeFactor: 1 });
    expect(classifyReadiness(95).class).toBe("PROGREDIR_CAUTELA");
    expect(READINESS_CLASSES).toHaveLength(5);
  });

  it("guardrails escalam para BLOQUEAR/REDUZIR_FORTE conforme o manual", () => {
    const blocked = applyGuardrails({ readiness: 80, pain: 6 });
    expect(blocked.enforcedClass).toBe("BLOQUEAR");
    expect(blocked.status).toBe("AGUARDAR_TREINADOR");
    const sleepBlocked = applyGuardrails({ readiness: 80, sleepMinutes: 300, hrvRatioToBaseline: 0.7 });
    expect(sleepBlocked.enforcedClass).toBe("BLOQUEAR");
    const reduced = applyGuardrails({ readiness: 80, actualPse: 9, targetPse: 6 });
    expect(reduced.enforcedClass).toBe("REDUZIR_FORTE");
    const technique = applyGuardrails({ readiness: 80, technique: 2 });
    expect(technique.enforcedClass).toBe("REDUZIR_FORTE");
  });

  it("índice de resposta soma componentes e exige completude >= 0,85", () => {
    const complete = computeResponseIndex({ readiness: 80, sleepMinutes: 420, hrv: 72, hrvBaseline: 75, pain: 1, technique: 4, techniqueTarget: 4, adherence: 0.95, qualityScore: 4 });
    expect(complete.status).toBe("PRONTO");
    expect(complete.completeness).toBe(1);
    expect(complete.responseScore).toBeCloseTo(complete.components.C + complete.components.D + complete.components.E + complete.components.F + complete.components.G + complete.components.H + complete.components.I, 2);
    expect(complete.components.C).toBeCloseTo(20);
    const partial = computeResponseIndex({ readiness: 80 });
    expect(partial.status).toBe("REVISAR");
    expect(partial.completeness).toBeCloseTo(0.11, 2);
  });

  it("decide adaptação com volume múltiplo de 10 e mapeamento de zona (32.6: K = ROUND(I×J,−1))", () => {
    const decision = decideAdaptation({ readiness: 50, prescribedVolumeM: 5800, primaryZone: "A3" });
    expect(decision.class).toBe("REDUZIR_FORTE");
    expect(decision.adaptedVolumeM).toBe(4060);
    expect(decision.adaptedVolumeM % 10).toBe(0);
    expect(decision.primaryZone).toBe("A2");
    expect(decision.status).toBe("LIBERAR_ADAPTACAO");
    const blocked = decideAdaptation({ readiness: 40, prescribedVolumeM: 5800, primaryZone: "AN2" });
    expect(blocked.class).toBe("BLOQUEAR");
    expect(blocked.primaryZone).toBe("A1");
    expect(blocked.status).toBe("AGUARDAR_TREINADOR");
    const released = decideAdaptation({ readiness: 40, prescribedVolumeM: 5800, primaryZone: "AN2", coachApproved: true });
    expect(released.status).toBe("LIBERAR_ADAPTACAO");
    const workbook = decideAdaptation({ readiness: 50, prescribedVolumeM: 5800, primaryZone: "AN1", zoneMapping: "WORKBOOK_32_6" });
    expect(workbook.primaryZone).toBe("A2");
  });
});

describe("evolução e pós-treino (seção 19)", () => {
  it("chave comparável exige 100% dos campos (VAL-018)", () => {
    expect(buildComparableKey({ athleteId: "a1", stroke: "Livre", distanceM: 200, zone: "A2", mode: "pool", material: "", pool: "25", protocol: "time-trial" })).toBeNull();
    expect(buildComparableKey({ athleteId: "a1", stroke: "Livre", distanceM: 200, zone: "A2", mode: "pool", material: "NONE", pool: "25", protocol: "time-trial" })).toBe("a1|Livre|200|A2|pool|NONE|25|time-trial");
    const validation = validateComparability("a1|Livre|200|A2|pool|NONE|25|time-trial", 4);
    expect(validation.valid).toBe(true);
  });

  it("confiança MIN(0,95; 0,35+0,15×n) e mínimo de 3 comparáveis", () => {
    expect(comparabilityConfidence(1)).toBeCloseTo(0.5);
    expect(comparabilityConfidence(4)).toBeCloseTo(0.95);
    expect(comparabilityConfidence(10)).toBeCloseTo(0.95);
    expect(classifyEvolution({ comparables: 2, scoreDeltaPct: 5 }).classification).toBe("DADOS_INSUFICIENTES");
    expect(validateComparability(null, 2).valid).toBe(false);
  });

  it("melhor tempo ignora zeros/inválidos (corrige #NUM! do MINIFS)", () => {
    expect(bestTimeSeconds([30.2, 29.8, 0, 31.0])).toBeCloseTo(29.8);
    expect(bestTimeSeconds([0, -5])).toBeNull();
  });

  it("score composto com pesos oficiais", () => {
    expect(compositeScore({ timeScore: 1, consistencyScore: 1, fatigueScore: 1, efficiencyScore: 1 })).toBeCloseTo(1);
    expect(compositeScore({ timeScore: 0.8, consistencyScore: 0.6, fatigueScore: 0.7, efficiencyScore: 0.9 })).toBeCloseTo(0.45 * 0.8 + 0.2 * 0.6 + 0.15 * 0.7 + 0.2 * 0.9, 4);
  });

  it("classifica evolução conforme limiares", () => {
    expect(classifyEvolution({ comparables: 30, scoreDeltaPct: 2 }).classification).toBe("EVOLUCAO_CONFIRMADA");
    expect(classifyEvolution({ comparables: 10, scoreDeltaPct: 2 }).classification).toBe("PROVAVEL_EVOLUCAO");
    expect(classifyEvolution({ comparables: 3, scoreDeltaPct: 2 }).classification).toBe("PROVAVEL_EVOLUCAO");
    expect(classifyEvolution({ comparables: 10, scoreDeltaPct: 3 }).classification).toBe("PROVAVEL_EVOLUCAO");
    expect(classifyEvolution({ comparables: 10, scoreDeltaPct: 1 }).classification).toBe("ESTAVEL");
    expect(classifyEvolution({ comparables: 10, scoreDeltaPct: -30, readiness: 80 }).classification).toBe("PROVAVEL_INVOLUCAO");
    expect(classifyEvolution({ comparables: 10, scoreDeltaPct: -12, readiness: 50 }).classification).toBe("FADIGA_TRANSITORIA");
    expect(classifyEvolution({ comparables: 6, scoreDeltaPct: 1, consecutiveNegativeTrends: 3 }).classification).toBe("INVOLUCAO_CONFIRMADA");
  });

  it("valida tempos, repetições únicas e parciais (VAL-015/016/017)", () => {
    const result = validateSetResults([
      { setResultId: "s1", repetitionNumber: 1, timeSeconds: 30.2, splitsSeconds: [15.1, 15.0] },
      { setResultId: "s1", repetitionNumber: 2, timeSeconds: 29.8 },
      { setResultId: "s1", repetitionNumber: 2, timeSeconds: 30.0, splitsSeconds: [20, 15] },
      { setResultId: "s2", repetitionNumber: 1, timeSeconds: 0 },
    ]);
    const failures = result.findings.filter((finding) => !finding.passed).map((finding) => finding.code);
    expect(failures).toContain("VAL-016");
    expect(failures).toContain("VAL-017");
    expect(failures).toContain("VAL-015");
    expect(result.valid).toBe(false);
  });
});

describe("validadores de sessão (seção 33)", () => {
  const validSession = {
    primaryZone: "A2",
    rdcMarker: false,
    blocks: [
      { component: "AQUECIMENTO" as const, volumeM: 800 },
      { component: "PERNA" as const, volumeM: 600 },
      { component: "BRAÇO" as const, volumeM: 500 },
      { component: "PRÉ-SÉRIE" as const, volumeM: 400 },
      { component: "SÉRIE PRINCIPAL" as const, volumeM: 3200 },
      { component: "REGENERATIVO" as const, volumeM: 300 },
    ],
  };

  it("UAT-09: blocos que não fecham impedem publicação (VAL-001)", () => {
    const result = validateRkfSession({ ...validSession, blocks: validSession.blocks.map((block, index) => index === 4 ? { ...block, volumeM: 3205 } : block) });
    expect(result.valid).toBe(false);
    expect(result.findings.some((finding) => finding.code === "VAL-001")).toBe(true);
  });

  it("UAT-02: zona inexistente é rejeitada ou mapeada explicitamente", () => {
    const result = validateRkfSession({ ...validSession, primaryZone: "ZONA_X" });
    expect(result.valid).toBe(false);
    expect(result.findings.some((finding) => finding.code === "VAL-003")).toBe(true);
  });

  it("UAT-10: violação HARD elimina candidato", () => {
    expect(validateRkfSession({ ...validSession, rdcMarker: "A2" as unknown as boolean }).valid).toBe(false);
  });

  it("componente ausente exige 0 m com justificativa (R010/VAL-005)", () => {
    const withoutArm = validSession.blocks.filter((block) => block.component !== "BRAÇO");
    expect(validateRkfSession({ ...validSession, blocks: withoutArm }).valid).toBe(false);
    const withJustifiedZero = [...withoutArm, { component: "BRAÇO" as const, volumeM: 0, justificationForZero: "Ombro em recuperação" }];
    const result = validateRkfSession({ ...validSession, blocks: withJustifiedZero });
    expect(result.findings.some((finding) => finding.code === "VAL-005" && finding.passed)).toBe(true);
  });

  it("ranges de resposta e timestamps UTC", () => {
    expect(validateResponseRanges({ readiness: 120 }).valid).toBe(false);
    expect(validateResponseRanges({ pain: 11 }).valid).toBe(false);
    expect(validateResponseRanges({ rpe: 7, technique: 3 }).valid).toBe(true);
    expect(assertUtcTimestamp("2026-08-29T20:00:00Z").passed).toBe(true);
    expect(assertUtcTimestamp("2026-08-29T20:00:00-03:00").passed).toBe(false);
  });
});

describe("Planning Engine (seção 12)", () => {
  it("UAT-01: gera 5.800 m exatos com 600 m de perna, ênfase de virada e auditoria aprovada", () => {
    const result = generatePrescription(athlete16, uat01Request);
    expect(result.status).toBe("PRONTO");
    const prescription = result.prescription!;
    expect(prescription.totalVolumeM).toBe(5800);
    expect(prescription.blocks.reduce((sum, block) => sum + block.volumeM, 0)).toBe(5800);
    expect(prescription.blocks.every((block) => block.volumeM % 10 === 0)).toBe(true);
    const leg = prescription.blocks.find((block) => block.component === "PERNA");
    expect(leg?.volumeM).toBe(600);
    expect(leg?.skills).toContain("TURN_FREE");
    expect(prescription.blocks[0].component).toBe("AQUECIMENTO");
    expect(prescription.blocks[prescription.blocks.length - 1].component).toBe("REGENERATIVO");
    expect(result.audit.passed).toBe(true);
    expect(result.audit.hardFailures).toHaveLength(0);
    expect(result.sessionValidation?.valid).toBe(true);
    expect(prescription.approvalRequired).toBe(true);
    expect(prescription.versions.rules).toBe("RKF_V5.1");
    expect(prescription.rationale.join(" ")).toContain("5800 m (R001 exato)");
  });

  it("rejeita volume-alvo que não permite estrutura RKF", () => {
    expect(() => generatePrescription(athlete16, { ...uat01Request, targetVolumeM: 1200, requiredLegVolumeM: 600 })).toThrow(/insuficiente/);
  });

  it("UAT-10: candidato com violação HARD é eliminado antes do score", () => {
    const library: LibrarySession[] = [
      {
        id: "bad-zone", title: "Sessão inválida", zones: ["ZONA_X"], volumeM: 5800, machineStatus: "READY_WHOLE|BLOCKS_EXACT", appSelectable: true,
        blocks: [{ component: "AQUECIMENTO", volumeM: 5800 }],
      },
      {
        id: "not-recombinable", title: "Sessão inteira", zones: ["A2", "A3"], volumeM: 5600, machineStatus: "READY_WHOLE", appSelectable: true,
        blocks: [
          { component: "AQUECIMENTO", volumeM: 800 },
          { component: "PERNA", volumeM: 600 },
          { component: "BRAÇO", volumeM: 500 },
          { component: "PRÉ-SÉRIE", volumeM: 400 },
          { component: "SÉRIE PRINCIPAL", volumeM: 3100 },
          { component: "REGENERATIVO", volumeM: 200 },
        ],
      },
    ];
    const result = generatePrescription(athlete16, uat01Request, library);
    expect(result.pipeline.eligible).toBe(0);
    expect(result.prescription?.source.kind).toBe("COMPOSED");
  });

  it("seleciona e escala sessão da biblioteca quando elegível", () => {
    const library: LibrarySession[] = [
      {
        id: "rkf-15-17-01", title: "Aeróbio + progressão", ageBand: "15–17", profile: "Geral", sessionType: "Aeróbio",
        objective: "Aeróbio + progressão", zones: ["A2", "A1"], volumeM: 5600, machineStatus: "READY_WHOLE|BLOCKS_EXACT", appSelectable: true,
        blocks: [
          { component: "AQUECIMENTO", volumeM: 800, zone: "A1" as const },
          { component: "PERNA", volumeM: 600, zone: "A1" as const },
          { component: "BRAÇO", volumeM: 500, zone: "A2" as const },
          { component: "PRÉ-SÉRIE", volumeM: 400, zone: "A2" as const },
          { component: "SÉRIE PRINCIPAL", volumeM: 3100, zone: "A2" as const },
          { component: "REGENERATIVO", volumeM: 200, zone: "A1" as const },
        ],
      },
    ];
    const result = generatePrescription(athlete16, { ...uat01Request, secondaryZone: undefined, requiredLegVolumeM: undefined }, library, DEFAULT_RANKING_WEIGHTS);
    expect(result.prescription?.source).toMatchObject({ kind: "LIBRARY_SCALED", librarySessionId: "rkf-15-17-01" });
    expect(result.prescription?.totalVolumeM).toBe(5800);
    expect(result.prescription?.blocks.every((block) => block.volumeM % 10 === 0)).toBe(true);
  });
});
