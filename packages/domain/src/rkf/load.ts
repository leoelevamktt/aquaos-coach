/**
 * Gestão de carga RKF (manual seção 17 e fórmulas 32.1/32.2 do workbook).
 * Três camadas separadas: prescrita, executada e interna. sRPE = PSE ×
 * duração. EWMA diária com datas distintas; SD zero retorna NULL/INSUFFICIENT_DATA,
 * nunca divisão silenciosa.
 */

export const LOAD_ENGINE_VERSION = "rkf-load-1.0.0";
export const TAU_ACUTE = 7;
export const TAU_CHRONIC = 42;

export interface LoadSessionInput {
  athleteId: string;
  /** Data ISO (YYYY-MM-DD) no timezone da equipe. */
  date: string;
  pse: number;
  durationMinutes: number;
  prescribedVolumeM?: number;
  executedVolumeM?: number;
  expectedPse?: number;
}

/** Carga interna da sessão: session_RPE_load = PSE × duração em minutos. */
export function sessionRpeLoad(pse: number, durationMinutes: number): number | null {
  if (!Number.isFinite(pse) || !Number.isFinite(durationMinutes) || pse <= 0 || durationMinutes <= 0) return null;
  return pse * durationMinutes;
}

export interface SessionLoadBreakdown {
  pse: number;
  durationMinutes: number;
  internalLoadUa: number | null;
}

export interface AdherenceResult {
  volumeAdherencePct: number | null;
  pseDeviation: number | null;
  pseDeviationPct: number | null;
}

/** UAT-04: recalcula aderência sem alterar a prescrição. */
export function computeAdherence(prescribedVolumeM?: number, executedVolumeM?: number, expectedPse?: number, actualPse?: number): AdherenceResult {
  const volumeAdherencePct =
    prescribedVolumeM && prescribedVolumeM > 0 && executedVolumeM !== undefined
      ? Math.round((executedVolumeM / prescribedVolumeM) * 10000) / 100
      : null;
  const pseDeviation = expectedPse !== undefined && actualPse !== undefined ? actualPse - expectedPse : null;
  const pseDeviationPct = expectedPse && expectedPse > 0 && actualPse !== undefined
    ? Math.round(((actualPse - expectedPse) / expectedPse) * 10000) / 100
    : null;
  return { volumeAdherencePct, pseDeviation, pseDeviationPct };
}

export interface DailyLoadEntry {
  athleteId: string;
  date: string;
  internalLoadUa: number;
  sessionCount: number;
}

/** Agrega sessões por atleta/data antes de qualquer EWMA (correção do workbook). */
export function aggregateDailyLoads(sessions: readonly LoadSessionInput[]): DailyLoadEntry[] {
  const byKey = new Map<string, DailyLoadEntry>();
  for (const session of sessions) {
    const load = sessionRpeLoad(session.pse, session.durationMinutes);
    if (load === null) continue;
    const key = `${session.athleteId}|${session.date}`;
    const entry = byKey.get(key) ?? { athleteId: session.athleteId, date: session.date, internalLoadUa: 0, sessionCount: 0 };
    entry.internalLoadUa += load;
    entry.sessionCount += 1;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export type ColdStartStage = "CS0" | "CS1" | "CS2" | "CS3" | "CS4";

export interface ColdStartInfo {
  stage: ColdStartStage;
  /** Pontos médios versionados da aba Carga_Diaria (coluna R). */
  confidence: number;
  distinctActiveDays: number;
}

export function coldStartFor(distinctActiveDays: number): ColdStartInfo {
  if (distinctActiveDays < 7) return { stage: "CS0", confidence: 0.2, distinctActiveDays };
  if (distinctActiveDays < 14) return { stage: "CS1", confidence: 0.35, distinctActiveDays };
  if (distinctActiveDays < 28) return { stage: "CS2", confidence: 0.5, distinctActiveDays };
  if (distinctActiveDays < 42) return { stage: "CS3", confidence: 0.68, distinctActiveDays };
  return { stage: "CS4", confidence: 0.85, distinctActiveDays };
}

export interface ChronicLoadPoint extends DailyLoadEntry {
  coldStart: ColdStartInfo;
  atl: number | null;
  ctl: number | null;
  /** TSB = CTL anterior − ATL atual (convenção declarada, manual seção 17). */
  tsb: number | null;
  /** Convenção do workbook: CTL atual − ATL atual (coluna U). */
  tsbWorkbook: number | null;
}

/**
 * Série crônica por atleta. ATL inicializa no 7º dia ativo com a carga do dia
 * (S = carga quando IFERROR cai no fallback); CTL inicializa no 42º.
 * Personalização de parâmetros somente após 2 ciclos (decisão do treinador).
 */
export function computeChronicSeries(sessions: readonly LoadSessionInput[], athleteId: string): {
  points: ChronicLoadPoint[];
  convention: string;
} {
  const daily = aggregateDailyLoads(sessions.filter((session) => session.athleteId === athleteId));
  let atl: number | null = null;
  let ctl: number | null = null;
  let previousCtl: number | null = null;
  const points = daily.map((entry, index) => {
    const activeDays = index + 1;
    const coldStart = coldStartFor(activeDays);
    if (activeDays >= TAU_ACUTE) atl = atl === null ? entry.internalLoadUa : atl + (entry.internalLoadUa - atl) / TAU_ACUTE;
    if (activeDays >= TAU_CHRONIC) {
      previousCtl = ctl;
      ctl = ctl === null ? entry.internalLoadUa : ctl + (entry.internalLoadUa - ctl) / TAU_CHRONIC;
    }
    const currentAtl = atl !== null ? Math.round(atl * 100) / 100 : null;
    const currentCtl = ctl !== null ? Math.round(ctl * 100) / 100 : null;
    return {
      ...entry,
      coldStart,
      atl: currentAtl,
      ctl: currentCtl,
      tsb: previousCtl !== null && currentAtl !== null ? Math.round((previousCtl - currentAtl) * 100) / 100 : null,
      tsbWorkbook: currentCtl !== null && currentAtl !== null ? Math.round((currentCtl - currentAtl) * 100) / 100 : null,
    };
  });
  return {
    points,
    convention: "TSB = CTL do dia anterior − ATL do dia atual; tsbWorkbook expõe CTL−ATL da mesma linha (aba Carga_Diaria).",
  };
}

export interface MonotonyResult {
  monotony: number | null;
  strain: number | null;
  weeklyLoadUa: number | null;
  mean: number | null;
  standardDeviation: number | null;
  status: "OK" | "INSUFFICIENT_DATA";
}

/**
 * Monotonia = média dos loads diários / desvio padrão; strain = carga semanal
 * × monotonia. Janela declarada: últimos `windowDays` dias com dados.
 * SD zero → INSUFFICIENT_DATA (nunca dividir silenciosamente).
 */
export function computeMonotony(dailyLoads: readonly number[], windowDays = 7): MonotonyResult {
  const window = dailyLoads.slice(-windowDays);
  if (window.length < windowDays) {
    return { monotony: null, strain: null, weeklyLoadUa: null, mean: null, standardDeviation: null, status: "INSUFFICIENT_DATA" };
  }
  const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
  const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length;
  const sd = Math.sqrt(variance);
  const weeklyLoad = window.reduce((sum, value) => sum + value, 0);
  if (sd === 0) {
    return { monotony: null, strain: null, weeklyLoadUa: weeklyLoad, mean: Math.round(mean * 100) / 100, standardDeviation: 0, status: "INSUFFICIENT_DATA" };
  }
  const monotony = Math.round((mean / sd) * 100) / 100;
  return {
    monotony,
    strain: Math.round(weeklyLoad * monotony * 100) / 100,
    weeklyLoadUa: weeklyLoad,
    mean: Math.round(mean * 100) / 100,
    standardDeviation: Math.round(sd * 100) / 100,
    status: "OK",
  };
}

export type LoadAlertCode =
  | "PSE_ACIMA_DO_ESPERADO" | "AUMENTO_ABRUPTO" | "BAIXA_ADERENCIA"
  | "MONOTONIA_ALTA" | "CUSTO_INTERNO_CRESCENTE" | "DADOS_INSUFICIENTES";

export interface LoadAlert {
  code: LoadAlertCode;
  detail: string;
}

/** Alertas são consultivos: nenhum alerta isolado decide sessão. */
export function buildLoadAlerts(input: {
  sessions: readonly LoadSessionInput[];
  monotony: MonotonyResult;
  previousWeeklyLoadUa?: number | null;
  currentWeeklyLoadUa?: number | null;
}): LoadAlert[] {
  const alerts: LoadAlert[] = [];
  for (const session of input.sessions) {
    if (session.expectedPse !== undefined && session.pse >= session.expectedPse + 2) {
      alerts.push({ code: "PSE_ACIMA_DO_ESPERADO", detail: `PSE ${session.pse} ≥ alvo ${session.expectedPse} + 2 em ${session.date}.` });
    }
    const adherence = computeAdherence(session.prescribedVolumeM, session.executedVolumeM);
    if (adherence.volumeAdherencePct !== null && adherence.volumeAdherencePct < 85) {
      alerts.push({ code: "BAIXA_ADERENCIA", detail: `Aderência de volume ${adherence.volumeAdherencePct}% em ${session.date}.` });
    }
  }
  if (input.currentWeeklyLoadUa && input.previousWeeklyLoadUa && input.previousWeeklyLoadUa > 0) {
    const increasePct = ((input.currentWeeklyLoadUa - input.previousWeeklyLoadUa) / input.previousWeeklyLoadUa) * 100;
    if (increasePct > 30) alerts.push({ code: "AUMENTO_ABRUPTO", detail: `Carga semanal +${Math.round(increasePct)}% em relação à semana anterior.` });
  }
  if (input.monotony.monotony !== null && input.monotony.monotony > 2) {
    alerts.push({ code: "MONOTONIA_ALTA", detail: `Monotonia ${input.monotony.monotony} > 2,0 com strain ${input.monotony.strain}.` });
  }
  if (input.monotony.status === "INSUFFICIENT_DATA") {
    alerts.push({ code: "DADOS_INSUFICIENTES", detail: "Janela de monotonia incompleta ou SD zero; não interpretar ATL/CTL/TSB." });
  }
  return alerts;
}

export interface LoadLayersResult {
  engine: string;
  engineVersion: string;
  calculatedAtUtc: string;
  layers: { prescribed: { volumeM?: number } | null; executed: { volumeM?: number } | null; internal: { loadUa: number | null } | null };
  adherence: AdherenceResult;
  sessionLoads: SessionLoadBreakdown[];
}

/** As três camadas jamais colapsam: cada uma é salva separadamente. */
export function computeLoadLayers(sessions: readonly LoadSessionInput[], now = new Date()): LoadLayersResult {
  const sessionLoads = sessions.map((session) => ({ pse: session.pse, durationMinutes: session.durationMinutes, internalLoadUa: sessionRpeLoad(session.pse, session.durationMinutes) }));
  const adherence = sessions.length === 1
    ? computeAdherence(sessions[0].prescribedVolumeM, sessions[0].executedVolumeM, sessions[0].expectedPse, sessions[0].pse)
    : { volumeAdherencePct: null, pseDeviation: null, pseDeviationPct: null };
  return {
    engine: "RkfLoadEngine",
    engineVersion: LOAD_ENGINE_VERSION,
    calculatedAtUtc: now.toISOString(),
    layers: {
      prescribed: sessions[0]?.prescribedVolumeM !== undefined ? { volumeM: sessions[0].prescribedVolumeM } : null,
      executed: sessions[0]?.executedVolumeM !== undefined ? { volumeM: sessions[0].executedVolumeM } : null,
      internal: { loadUa: sessionLoads.reduce((sum, load) => sum + (load.internalLoadUa ?? 0), 0) || null },
    },
    adherence,
    sessionLoads,
  };
}
