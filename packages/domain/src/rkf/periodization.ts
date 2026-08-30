/**
 * Periodização por idade, fases e modelos de ciclo (manual seções 10 e 13).
 * 8–13 usa LINEAR_RKF; 14+ pode usar ATR conforme contexto (R007, GUIDE).
 */

export type DevelopmentLevel = "formacao" | "rendimento";
export type Specialty = "velocidade" | "meio_fundo" | "fundo";
export type CycleModel = "LINEAR_RKF" | "ATR_RKF";

export interface AgeBandRule {
  label: string;
  minAge: number;
  maxAge: number;
  sessionsPerWeek: { min: number; max: number };
  weeklyKm: Record<Specialty, { min: number; max: number }>;
  taperDays: { min: number; max: number };
  priority: string;
}

export const AGE_BANDS: readonly AgeBandRule[] = [
  { label: "8–10", minAge: 8, maxAge: 10, sessionsPerWeek: { min: 3, max: 5 }, weeklyKm: { velocidade: { min: 6, max: 12 }, meio_fundo: { min: 7, max: 14 }, fundo: { min: 8, max: 16 } }, taperDays: { min: 3, max: 5 }, priority: "Alfabetização aquática e qualidade, sem especialização." },
  { label: "11–12", minAge: 11, maxAge: 12, sessionsPerWeek: { min: 4, max: 6 }, weeklyKm: { velocidade: { min: 12, max: 22 }, meio_fundo: { min: 14, max: 25 }, fundo: { min: 16, max: 28 } }, taperDays: { min: 5, max: 7 }, priority: "Técnica de baixa fadiga e aeróbio geral." },
  { label: "13–14", minAge: 13, maxAge: 14, sessionsPerWeek: { min: 6, max: 9 }, weeklyKm: { velocidade: { min: 24, max: 38 }, meio_fundo: { min: 30, max: 44 }, fundo: { min: 35, max: 50 } }, taperDays: { min: 7, max: 10 }, priority: "Técnica, base, força e velocidade com maturação." },
  { label: "15–17", minAge: 15, maxAge: 17, sessionsPerWeek: { min: 8, max: 11 }, weeklyKm: { velocidade: { min: 35, max: 55 }, meio_fundo: { min: 45, max: 65 }, fundo: { min: 55, max: 75 } }, taperDays: { min: 10, max: 14 }, priority: "Prova, energia, força e potência." },
  { label: "Adulto", minAge: 18, maxAge: 120, sessionsPerWeek: { min: 6, max: 12 }, weeklyKm: { velocidade: { min: 30, max: 55 }, meio_fundo: { min: 45, max: 75 }, fundo: { min: 60, max: 90 } }, taperDays: { min: 10, max: 21 }, priority: "PB/SB, disponibilidade, lesões e histórico." },
] as const;

export function ageBandFor(age: number): AgeBandRule | null {
  return AGE_BANDS.find((band) => age >= band.minAge && age <= band.maxAge) ?? null;
}

export type RkfPhaseId =
  | "ADAPTACAO" | "BASE" | "DESENVOLVIMENTO" | "ESPECIFICO"
  | "ACUMULACAO" | "TRANSFORMACAO" | "REALIZACAO" | "TAPER" | "COMPETICAO";

export interface RkfPhase {
  id: RkfPhaseId;
  label: string;
  volumeFactor: number;
  pseRange: { min: number; max: number };
  maxStrength: number;
  emphasis: string;
  note?: string;
}

export const PHASES: readonly RkfPhase[] = [
  { id: "ADAPTACAO", label: "Adaptação", volumeFactor: 0.9, pseRange: { min: 4, max: 6 }, maxStrength: 1, emphasis: "Técnica/SS", note: "Readiness <60 reduz 20–30%." },
  { id: "BASE", label: "Base", volumeFactor: 0.95, pseRange: { min: 5, max: 7 }, maxStrength: 2, emphasis: "SS, A1/A2" },
  { id: "DESENVOLVIMENTO", label: "Desenvolvimento", volumeFactor: 1.0, pseRange: { min: 6, max: 8 }, maxStrength: 2, emphasis: "Progressivo" },
  { id: "ESPECIFICO", label: "Específico", volumeFactor: 0.92, pseRange: { min: 7, max: 9 }, maxStrength: 2, emphasis: "Progressivo/MM" },
  { id: "ACUMULACAO", label: "Acumulação", volumeFactor: 1.0, pseRange: { min: 6, max: 8 }, maxStrength: 2, emphasis: "SS/FO sustentável" },
  { id: "TRANSFORMACAO", label: "Transformação", volumeFactor: 0.92, pseRange: { min: 7, max: 9 }, maxStrength: 2, emphasis: "MM/Progressivo" },
  { id: "REALIZACAO", label: "Realização/RDC", volumeFactor: 0.82, pseRange: { min: 8, max: 9 }, maxStrength: 1, emphasis: "RDC/MM", note: "Parar com queda de velocidade >3%." },
  { id: "TAPER", label: "Taper", volumeFactor: 0.58, pseRange: { min: 5, max: 7 }, maxStrength: 1, emphasis: "Qualidade e recuperação" },
  { id: "COMPETICAO", label: "Competição", volumeFactor: 0.42, pseRange: { min: 6, max: 9 }, maxStrength: 0, emphasis: "RDC" },
] as const;

export const PHASE_BY_ID: Readonly<Record<RkfPhaseId, RkfPhase>> = Object.fromEntries(PHASES.map((phase) => [phase.id, phase])) as Record<RkfPhaseId, RkfPhase>;

/** Variantes de fundo (manual seção 10). */
export const LONG_DISTANCE_VARIANTS = {
  ACUMULACAO: "Sem A1 automático entre blocos.",
  TRANSFORMACAO: "A1 interbloco apenas 100–300 m e com motivo registrado.",
  REALIZACAO: "Recuperação ativa/completa permitida.",
} as const;

/** Modelo AUTO: idade <= 13 → LINEAR_RKF; senão ATR_RKF. */
export function resolveCycleModel(age: number, requested?: CycleModel | "AUTO"): CycleModel {
  if (requested && requested !== "AUTO") return requested;
  return age <= 13 ? "LINEAR_RKF" : "ATR_RKF";
}

export interface PhaseWeek {
  week: number;
  phase: RkfPhaseId;
  phaseLabel: string;
}

/**
 * Alocação de fases (manual seção 13):
 * LINEAR — competição na última semana; adaptação até MAX(1, ROUND(total*.15));
 * base até .40; desenvolvimento até .65; específico até .85; restante taper.
 * ATR — competição na última; adaptação .10; acumulação .40; transformação .65;
 * realização .85; restante taper.
 */
export function allocatePhases(totalWeeks: number, model: CycleModel): PhaseWeek[] {
  const boundaries: Array<{ upTo: number; phase: RkfPhaseId }> = [];
  const push = (fraction: number, phase: RkfPhaseId, minWeeks = 0) => {
    const previous = boundaries.length ? boundaries[boundaries.length - 1].upTo : 0;
    const upTo = Math.max(previous + minWeeks, Math.min(Math.round(totalWeeks * fraction), totalWeeks - 1));
    if (upTo > previous) boundaries.push({ upTo, phase });
  };

  if (model === "LINEAR_RKF") {
    const adaptation = Math.max(1, Math.round(totalWeeks * 0.15));
    const previous = 0;
    const upTo = Math.min(Math.max(previous + 1, adaptation), totalWeeks - 1);
    boundaries.push({ upTo, phase: "ADAPTACAO" });
    push(0.4, "BASE");
    push(0.65, "DESENVOLVIMENTO");
    push(0.85, "ESPECIFICO");
  } else {
    push(0.1, "ADAPTACAO", 1);
    push(0.4, "ACUMULACAO");
    push(0.65, "TRANSFORMACAO");
    push(0.85, "REALIZACAO");
  }

  const weeks: PhaseWeek[] = [];
  for (let week = 1; week <= totalWeeks; week += 1) {
    let phase: RkfPhaseId = "TAPER";
    for (const boundary of boundaries) {
      if (week <= boundary.upTo) {
        phase = boundary.phase;
        break;
      }
    }
    if (week === totalWeeks) phase = "COMPETICAO";
    weeks.push({ week, phase, phaseLabel: PHASE_BY_ID[phase].label });
  }
  return weeks;
}
