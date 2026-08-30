/**
 * Distribuição de zonas por fase e perfil (manual seção 11).
 * Toda linha soma 1 com tolerância 0,0001 — verificado em teste.
 */

import type { RkfPhaseId } from "./periodization.js";
import type { ZoneCode } from "./zones.js";

export type DistributionProfile = "SPEED" | "MEIO_FUNDO" | "FUNDO";

export const DISTRIBUTION_COLUMNS: readonly ZoneCode[] = ["A1", "A2", "A3", "AN1", "AN2", "VALAT"] as const;
export const DISTRIBUTION_TOLERANCE = 0.0001;
export const TECHNICAL_COLUMN = "TEC" as const;

type PhaseRow = Record<RkfPhaseId, number>;

export const DISTRIBUTION_MATRICES: Readonly<Record<DistributionProfile, PhaseRow>> = {
  SPEED: {
    ADAPTACAO: 0.1, BASE: 0.08, DESENVOLVIMENTO: 0.08, ESPECIFICO: 0.07,
    ACUMULACAO: 0.08, TRANSFORMACAO: 0.07, REALIZACAO: 0.06, TAPER: 0.08, COMPETICAO: 0.1,
  },
  MEIO_FUNDO: {
    ADAPTACAO: 0.1, BASE: 0.08, DESENVOLVIMENTO: 0.08, ESPECIFICO: 0.07,
    ACUMULACAO: 0.08, TRANSFORMACAO: 0.07, REALIZACAO: 0.06, TAPER: 0.08, COMPETICAO: 0.1,
  },
  FUNDO: {
    ADAPTACAO: 0.1, BASE: 0.08, DESENVOLVIMENTO: 0.08, ESPECIFICO: 0.07,
    ACUMULACAO: 0.08, TRANSFORMACAO: 0.07, REALIZACAO: 0.06, TAPER: 0.08, COMPETICAO: 0.1,
  },
} as const;

/** Frações por zona (A1..VALAT) — coluna TEC é técnica, fora das zonas energéticas. */
export const ZONE_DISTRIBUTION: Readonly<Record<DistributionProfile, Record<ZoneCode, PhaseRow>>> = {
  SPEED: {
    A1: { ADAPTACAO: 0.5, BASE: 0.45, DESENVOLVIMENTO: 0.4, ESPECIFICO: 0.35, ACUMULACAO: 0.42, TRANSFORMACAO: 0.32, REALIZACAO: 0.3, TAPER: 0.48, COMPETICAO: 0.55 },
    A2: { ADAPTACAO: 0.25, BASE: 0.3, DESENVOLVIMENTO: 0.27, ESPECIFICO: 0.25, ACUMULACAO: 0.32, TRANSFORMACAO: 0.25, REALIZACAO: 0.2, TAPER: 0.18, COMPETICAO: 0.15 },
    A3: { ADAPTACAO: 0.08, BASE: 0.08, DESENVOLVIMENTO: 0.1, ESPECIFICO: 0.12, ACUMULACAO: 0.08, TRANSFORMACAO: 0.14, REALIZACAO: 0.15, TAPER: 0.08, COMPETICAO: 0.05 },
    AN1: { ADAPTACAO: 0.03, BASE: 0.04, DESENVOLVIMENTO: 0.07, ESPECIFICO: 0.1, ACUMULACAO: 0.05, TRANSFORMACAO: 0.11, REALIZACAO: 0.13, TAPER: 0.07, COMPETICAO: 0.05 },
    AN2: { ADAPTACAO: 0.01, BASE: 0.01, DESENVOLVIMENTO: 0.03, ESPECIFICO: 0.05, ACUMULACAO: 0.01, TRANSFORMACAO: 0.05, REALIZACAO: 0.08, TAPER: 0.04, COMPETICAO: 0.03 },
    VALAT: { ADAPTACAO: 0.03, BASE: 0.04, DESENVOLVIMENTO: 0.05, ESPECIFICO: 0.06, ACUMULACAO: 0.04, TRANSFORMACAO: 0.06, REALIZACAO: 0.08, TAPER: 0.07, COMPETICAO: 0.07 },
  },
  MEIO_FUNDO: {
    A1: { ADAPTACAO: 0.52, BASE: 0.48, DESENVOLVIMENTO: 0.43, ESPECIFICO: 0.38, ACUMULACAO: 0.45, TRANSFORMACAO: 0.37, REALIZACAO: 0.34, TAPER: 0.5, COMPETICAO: 0.58 },
    A2: { ADAPTACAO: 0.27, BASE: 0.32, DESENVOLVIMENTO: 0.32, ESPECIFICO: 0.3, ACUMULACAO: 0.35, TRANSFORMACAO: 0.3, REALIZACAO: 0.27, TAPER: 0.23, COMPETICAO: 0.18 },
    A3: { ADAPTACAO: 0.07, BASE: 0.08, DESENVOLVIMENTO: 0.1, ESPECIFICO: 0.13, ACUMULACAO: 0.07, TRANSFORMACAO: 0.14, REALIZACAO: 0.15, TAPER: 0.08, COMPETICAO: 0.05 },
    AN1: { ADAPTACAO: 0.02, BASE: 0.02, DESENVOLVIMENTO: 0.04, ESPECIFICO: 0.07, ACUMULACAO: 0.03, TRANSFORMACAO: 0.08, REALIZACAO: 0.1, TAPER: 0.05, COMPETICAO: 0.04 },
    AN2: { ADAPTACAO: 0.01, BASE: 0.01, DESENVOLVIMENTO: 0.01, ESPECIFICO: 0.02, ACUMULACAO: 0.01, TRANSFORMACAO: 0.02, REALIZACAO: 0.04, TAPER: 0.02, COMPETICAO: 0.01 },
    VALAT: { ADAPTACAO: 0.01, BASE: 0.01, DESENVOLVIMENTO: 0.02, ESPECIFICO: 0.03, ACUMULACAO: 0.01, TRANSFORMACAO: 0.02, REALIZACAO: 0.04, TAPER: 0.04, COMPETICAO: 0.04 },
  },
  FUNDO: {
    A1: { ADAPTACAO: 0.55, BASE: 0.5, DESENVOLVIMENTO: 0.45, ESPECIFICO: 0.42, ACUMULACAO: 0.46, TRANSFORMACAO: 0.4, REALIZACAO: 0.38, TAPER: 0.52, COMPETICAO: 0.6 },
    A2: { ADAPTACAO: 0.28, BASE: 0.35, DESENVOLVIMENTO: 0.36, ESPECIFICO: 0.34, ACUMULACAO: 0.38, TRANSFORMACAO: 0.35, REALIZACAO: 0.32, TAPER: 0.27, COMPETICAO: 0.2 },
    A3: { ADAPTACAO: 0.05, BASE: 0.05, DESENVOLVIMENTO: 0.07, ESPECIFICO: 0.1, ACUMULACAO: 0.05, TRANSFORMACAO: 0.1, REALIZACAO: 0.12, TAPER: 0.06, COMPETICAO: 0.04 },
    AN1: { ADAPTACAO: 0.01, BASE: 0.01, DESENVOLVIMENTO: 0.02, ESPECIFICO: 0.04, ACUMULACAO: 0.02, TRANSFORMACAO: 0.05, REALIZACAO: 0.07, TAPER: 0.03, COMPETICAO: 0.02 },
    AN2: { ADAPTACAO: 0, BASE: 0, DESENVOLVIMENTO: 0.01, ESPECIFICO: 0.01, ACUMULACAO: 0, TRANSFORMACAO: 0.01, REALIZACAO: 0.02, TAPER: 0.01, COMPETICAO: 0.01 },
    VALAT: { ADAPTACAO: 0.01, BASE: 0.01, DESENVOLVIMENTO: 0.01, ESPECIFICO: 0.02, ACUMULACAO: 0.01, TRANSFORMACAO: 0.02, REALIZACAO: 0.03, TAPER: 0.03, COMPETICAO: 0.03 },
  },
} as const;

export interface DistributionRow {
  profile: DistributionProfile;
  phase: RkfPhaseId;
  tec: number;
  zones: Record<ZoneCode, number>;
  total: number;
  valid: boolean;
}

export function getDistributionRow(profile: DistributionProfile, phase: RkfPhaseId): DistributionRow {
  const tec = DISTRIBUTION_MATRICES[profile][phase];
  const zones = Object.fromEntries(DISTRIBUTION_COLUMNS.map((zone) => [zone, ZONE_DISTRIBUTION[profile][zone][phase]])) as Record<ZoneCode, number>;
  const total = tec + DISTRIBUTION_COLUMNS.reduce((sum, zone) => sum + zones[zone], 0);
  return { profile, phase, tec, zones, total, valid: Math.abs(total - 1) < DISTRIBUTION_TOLERANCE };
}

/** Distribui um volume (m) entre TEC e zonas conforme a matriz da fase/perfil. */
export function allocateVolumeByDistribution(volumeM: number, profile: DistributionProfile, phase: RkfPhaseId): { tec: number; zones: Record<ZoneCode, number>; residualM: number } {
  const row = getDistributionRow(profile, phase);
  const tec = Math.round((volumeM * row.tec) / 10) * 10;
  const zones = Object.fromEntries(DISTRIBUTION_COLUMNS.map((zone) => [zone, Math.round((volumeM * row.zones[zone]) / 10) * 10])) as Record<ZoneCode, number>;
  const allocated = tec + DISTRIBUTION_COLUMNS.reduce((sum, zone) => sum + zones[zone], 0);
  return { tec, zones, residualM: volumeM - allocated };
}
