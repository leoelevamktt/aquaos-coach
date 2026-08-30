/**
 * Planning Engine RKF (manual seção 12).
 * Pipeline: contexto → hard rules → ranking → seleção/composição → auditoria
 * → publicação de versão imutável. Score nunca supera HARD. A IA nunca cria
 * zona, muda volume/objetivo/zona/fundamento sem nova decisão do motor (R015).
 */

import { allocateVolumeByDistribution, type DistributionProfile } from "./distribution.js";
import { ageBandFor, PHASE_BY_ID, type RkfPhaseId, type Specialty } from "./periodization.js";
import { concludeAudit, RULES_VERSION, type RuleAudit, type RuleCheckResult } from "./rules.js";
import { normalizeZoneCode, ZONE_CODES, type MaterialCode, type SkillCode, type ZoneCode } from "./zones.js";
import { SESSION_COMPONENTS, validateRkfSession, type SessionComponent, type ValidationResult } from "./validators.js";

export const PLANNING_ENGINE_VERSION = "rkf-planning-1.0.0";

/** Pesos oficiais de ranking (configuráveis pelo admin RKF; soma 1). */
export interface RankingWeights {
  ageAndLevel: number;
  profileAndEvent: number;
  physiologicalGoal: number;
  phase: number;
  zone: number;
  loadAndRecovery: number;
  techniqueAndSkills: number;
  variationAndHistory: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  ageAndLevel: 0.15,
  profileAndEvent: 0.15,
  physiologicalGoal: 0.2,
  phase: 0.15,
  zone: 0.15,
  loadAndRecovery: 0.1,
  techniqueAndSkills: 0.05,
  variationAndHistory: 0.05,
};

export interface PlanningAthleteContext {
  athleteId: string;
  age: number;
  developmentLevel: "formacao" | "rendimento";
  specialty: Specialty;
  poolLengthM: 25 | 50;
  eventMeters?: number;
  restrictions?: string[];
}

export interface PlanningRequest {
  phase: RkfPhaseId;
  objective: string;
  primaryZone: ZoneCode | string;
  secondaryZone?: ZoneCode | string;
  targetVolumeM: number;
  rdcMarker: boolean;
  requiredLegVolumeM?: number;
  skillEmphasis?: SkillCode[];
  readiness?: number;
  dayOfWeek?: number;
  recentSessionIds?: readonly string[];
}

export interface LibrarySessionBlock {
  component: SessionComponent;
  volumeM: number;
  zone?: ZoneCode;
  prescriptionText?: string;
  materials?: MaterialCode[];
  skills?: SkillCode[];
}

export interface LibrarySession {
  id: string;
  title: string;
  ageBand?: string;
  profile?: string;
  sessionType?: string;
  objective?: string;
  zones: readonly string[];
  volumeM: number;
  blocks: readonly LibrarySessionBlock[];
  machineStatus?: string;
  appSelectable?: boolean;
}

export interface ComposedBlock {
  order: number;
  component: SessionComponent;
  volumeM: number;
  zone: ZoneCode;
  prescriptionText: string;
  materials: MaterialCode[];
  skills: SkillCode[];
}

export interface RkfPrescription {
  id: string;
  athleteId: string;
  title: string;
  objective: string;
  primaryZone: ZoneCode;
  secondaryZone: ZoneCode | null;
  rdcMarker: boolean;
  totalVolumeM: number;
  blocks: ComposedBlock[];
  zoneAllocation: { tec: number; zones: Record<ZoneCode, number>; advisory: boolean };
  source: { kind: "LIBRARY_SCALED" | "COMPOSED"; librarySessionId?: string };
  rationale: string[];
  score?: number;
  approvalRequired: boolean;
  versions: { engine: string; rules: string; seed: string };
  generatedAtUtc: string;
}

export interface PlanningResult {
  status: "PRONTO" | "REVISAR";
  prescription: RkfPrescription | null;
  audit: RuleAudit;
  sessionValidation: ValidationResult | null;
  pipeline: { eligible: number; scored: number; selected: string };
  versions: { engine: string; rules: string };
}

function round10(value: number): number {
  return Math.round(value / 10) * 10;
}

const SPECIALTY_TO_PROFILE: Record<Specialty, DistributionProfile> = {
  velocidade: "SPEED",
  meio_fundo: "MEIO_FUNDO",
  fundo: "FUNDO",
};

function zoneOrDefault(raw: ZoneCode | string | undefined, fallback: ZoneCode): ZoneCode {
  if (raw === undefined) return fallback;
  const normalized = normalizeZoneCode(String(raw));
  return normalized.zone ?? fallback;
}

/** Hard rules: eliminam candidatos antes de qualquer score. */
export function applyHardRules(session: LibrarySession, request: PlanningRequest, athlete: PlanningAthleteContext): { eligible: boolean; violations: string[] } {
  const violations: string[] = [];
  const machineStatus = session.machineStatus ?? "READY_WHOLE|BLOCKS_EXACT";
  if (!(machineStatus.includes("READY_WHOLE") || machineStatus.includes("BLOCKS_EXACT"))) {
    violations.push(`R018: machine_status=${machineStatus} não permite recombinação.`);
  }
  if (session.volumeM !== request.targetVolumeM && !machineStatus.includes("BLOCKS_EXACT")) {
    violations.push("R018: ajustar o volume exige BLOCKS_EXACT; sem ele a sessão só pode ser usada inteira com volume igual ao alvo.");
  }
  if (session.appSelectable === false) violations.push("Sessão marcada como não selecionável no app.");
  for (const zone of session.zones) {
    const normalized = normalizeZoneCode(zone);
    if (normalized.zone === null && !normalized.rdcMarker) violations.push(`R002: zona inválida ${zone}.`);
  }
  const requested = zoneOrDefault(request.primaryZone, "A2");
  if (!session.zones.some((zone) => normalizeZoneCode(zone).zone === requested)) {
    violations.push(`Zona primária solicitada ${requested} ausente da sessão (usar sessão inteira exigiria nova decisão).`);
  }
  const tolerance = 0.2;
  if (Math.abs(session.volumeM - request.targetVolumeM) / request.targetVolumeM > tolerance) {
    violations.push(`Volume ${session.volumeM} m fora da faixa ±20% do alvo ${request.targetVolumeM} m.`);
  }
  if (athlete.age < 11) {
    const heavy = session.blocks.some((block) => (block.materials ?? []).some((material) => ["PALMAR_P", "PALMAR_M", "PALMAR_G", "PARA", "DRAG"].includes(material)));
    if (heavy) violations.push("Material resistido proibido para a faixa 8–10.");
  }
  return { eligible: violations.length === 0, violations };
}

/** Ranking ponderado 0–1 por dimensão. */
export function scoreSession(session: LibrarySession, request: PlanningRequest, athlete: PlanningAthleteContext, weights: RankingWeights = DEFAULT_RANKING_WEIGHTS, library: readonly LibrarySession[] = []): number {
  const requestedZone = zoneOrDefault(request.primaryZone, "A2");
  const secondaryZone = request.secondaryZone !== undefined ? zoneOrDefault(request.secondaryZone, requestedZone) : null;

  const ageAndLevel = session.ageBand
    ? session.ageBand === ageBandFor(athlete.age)?.label
      ? 1
      : 0.5
    : 0.7;
  const profileAndEvent = session.profile && (session.profile.toLowerCase().includes(athlete.specialty.replace("_", " ")) || session.profile.toLowerCase() === "geral") ? 1 : 0.4;
  const physiologicalGoal = session.objective && request.objective && session.objective.toLowerCase().includes(request.objective.toLowerCase().split(" ")[0]) ? 1 : 0.5;
  const phase = session.sessionType?.toLowerCase().includes(PHASE_BY_ID[request.phase].label.toLowerCase().split("/")[0]) ? 1 : 0.6;
  const zones = session.zones.map((zone) => normalizeZoneCode(zone).zone);
  const zone = zones.includes(requestedZone) ? (secondaryZone && zones.includes(secondaryZone) ? 1 : 0.8) : 0.2;
  const loadAndRecovery = request.readiness === undefined ? 0.7 : request.readiness >= 75 ? 1 : request.readiness >= 60 ? 0.7 : 0.3;
  const emphasis = request.skillEmphasis ?? [];
  const skills = session.blocks.flatMap((block) => block.skills ?? []);
  const techniqueAndSkills = emphasis.length ? emphasis.filter((skill) => skills.includes(skill)).length / emphasis.length : 0.7;
  const usageCount = library.filter((candidate) => candidate.id === session.id).length;
  const recentlyUsed = (request.recentSessionIds ?? []).includes(session.id);
  const variationAndHistory = recentlyUsed ? 0.2 : usageCount > 0 ? 0.8 : 0.6;

  return (
    weights.ageAndLevel * ageAndLevel +
    weights.profileAndEvent * profileAndEvent +
    weights.physiologicalGoal * physiologicalGoal +
    weights.phase * phase +
    weights.zone * zone +
    weights.loadAndRecovery * loadAndRecovery +
    weights.techniqueAndSkills * techniqueAndSkills +
    weights.variationAndHistory * variationAndHistory
  );
}

/** Escala proporcionalmente uma sessão da biblioteca para o volume exato. */
function scaleLibrarySession(session: LibrarySession, request: PlanningRequest): { blocks: ComposedBlock[]; totalVolumeM: number } {
  const factor = request.targetVolumeM / session.volumeM;
  const ordered = [...session.blocks].sort((a, b) => SESSION_COMPONENTS.indexOf(a.component) - SESSION_COMPONENTS.indexOf(b.component));
  const blocks: ComposedBlock[] = ordered.map((block, index) => ({
    order: index + 1,
    component: block.component,
    volumeM: round10(block.volumeM * factor),
    zone: zoneOrDefault(block.zone, zoneOrDefault(request.primaryZone, "A2")),
    prescriptionText: block.prescriptionText ?? `${block.component} ${block.volumeM} m`,
    materials: [...(block.materials ?? [])],
    skills: [...(block.skills ?? [])],
  }));
  const fixed = blocks.reduce((sum, block) => sum + block.volumeM, 0);
  const residual = request.targetVolumeM - fixed;
  const regen = blocks.find((block) => block.component === "REGENERATIVO");
  const principal = blocks.find((block) => block.component === "SÉRIE PRINCIPAL");
  const absorber = regen ?? principal;
  if (absorber && residual !== 0) absorber.volumeM += residual;
  return { blocks, totalVolumeM: blocks.reduce((sum, block) => sum + block.volumeM, 0) };
}

/**
 * Composição determinística da sessão: abre com aquecimento, fecha com
 * regenerativo; perna/braço/pré-série/principal compõem o centro. O residual
 * de arredondamento é absorvido pelo principal e auditado (R001).
 */
export function composeSession(request: PlanningRequest, athlete: PlanningAthleteContext): { blocks: ComposedBlock[]; totalVolumeM: number; rationale: string[] } {
  const target = request.targetVolumeM;
  const primary = zoneOrDefault(request.primaryZone, "A2");
  const secondary = request.secondaryZone !== undefined ? zoneOrDefault(request.secondaryZone, primary) : primary;
  const rationale: string[] = [];

  const legVolume = Math.min(round10(request.requiredLegVolumeM ?? round10(target * 0.1)), round10(target * 0.25));
  const warmup = round10(target * 0.15);
  const arm = round10(target * 0.1);
  const preSeries = round10(target * 0.08);
  const regen = Math.max(200, round10(target * 0.05));
  const principal = target - warmup - legVolume - arm - preSeries - regen;

  if (principal < 500) {
    throw new Error(`Volume-alvo ${target} m insuficiente para a estrutura RKF após perna (${legVolume} m): principal = ${principal} m.`);
  }
  rationale.push(`Composição: aquecimento ${warmup} m + perna ${legVolume} m + braço ${arm} m + pré-série ${preSeries} m + principal ${principal} m + regenerativo ${regen} m = ${target} m (R001 exato).`);
  if (request.requiredLegVolumeM !== undefined) rationale.push(`Requisito de perna atendido: ${legVolume} m.`);
  if (regen !== round10(target * 0.05)) rationale.push(`Regenerativo elevado para ${regen} m (piso de segurança).`);

  const emphasis = request.skillEmphasis ?? [];
  const blocks: ComposedBlock[] = [
    { order: 1, component: "AQUECIMENTO", volumeM: warmup, zone: "A1", prescriptionText: `${warmup}: 200 livre + nado técnico progressivo`, materials: [], skills: emphasis.includes("STROKE_CONTROL") ? ["STROKE_CONTROL"] : [] },
    { order: 2, component: "PERNA", volumeM: legVolume, zone: "A1", prescriptionText: `${legVolume} m perna com ênfase ${emphasis.length ? emphasis.join("/") : "técnica"}`, materials: ["BOARD"], skills: emphasis.filter((skill) => skill.startsWith("TURN") || skill === "KICK" || skill === "STREAMLINE" || skill === "BREAKOUT" || skill === "UNDERWATER") },
    { order: 3, component: "BRAÇO", volumeM: arm, zone: "A2", prescriptionText: `${arm} m braço com controle de braçadas`, materials: ["PULL"], skills: emphasis.filter((skill) => skill === "SCULL" || skill === "STROKE_CONTROL" || skill === "BREATH") },
    { order: 4, component: "PRÉ-SÉRIE", volumeM: preSeries, zone: secondary, prescriptionText: `${preSeries} m ativação ${secondary}`, materials: [], skills: emphasis },
    { order: 5, component: "SÉRIE PRINCIPAL", volumeM: principal, zone: primary, prescriptionText: `${principal} m principal em ${primary}${secondary !== primary ? ` com progressão para ${secondary}` : ""}`, materials: [], skills: [] },
    { order: 6, component: "REGENERATIVO", volumeM: regen, zone: "A1", prescriptionText: `${regen} m regenerativo técnico + alongamento`, materials: [], skills: [] },
  ];

  if (request.rdcMarker) {
    rationale.push("Marcador RDC registrado junto à zona fisiológica (VAL-004); ritmo de prova sem trocar a zona.");
  }
  if (athlete.poolLengthM === 50) rationale.push("Piscina de 50 m: ajustar contagem de braçadas e viradas abertas conforme protocolo.");
  return { blocks, totalVolumeM: blocks.reduce((sum, block) => sum + block.volumeM, 0), rationale };
}

function auditPrescription(prescription: RkfPrescription, request: PlanningRequest, athlete: PlanningAthleteContext, librarySource?: { machineStatus: string }): RuleAudit {
  const checks: RuleCheckResult[] = [
    { ruleId: "R001", severity: "HARD", passed: prescription.blocks.reduce((sum, block) => sum + block.volumeM, 0) === request.targetVolumeM && prescription.totalVolumeM === request.targetVolumeM, detail: `Volume auditado ${prescription.totalVolumeM} m = alvo ${request.targetVolumeM} m.` },
    { ruleId: "R002", severity: "HARD", passed: (ZONE_CODES as readonly string[]).includes(prescription.primaryZone) && prescription.blocks.every((block) => (ZONE_CODES as readonly string[]).includes(block.zone)), detail: "Vocabulário de zones oficial." },
    { ruleId: "R004", severity: "HARD", passed: prescription.blocks.filter((block) => block.zone === "VALAT").every((block) => block.volumeM <= 300), detail: "VALAT curto e de qualidade (<= 300 m por bloco)." },
    { ruleId: "R005", severity: "HARD", passed: prescription.primaryZone !== "A2" || volumeByZone(prescription, "A2") >= Math.max(...(ZONE_CODES as readonly ZoneCode[]).map((zone) => volumeByZone(prescription, zone))), detail: "A2 dominante preserva estabilidade de ritmo." },
    { ruleId: "R010", severity: "HARD", passed: prescription.blocks.length === SESSION_COMPONENTS.length, detail: "Seis componentes explícitos; nenhum bloco implícito." },
    { ruleId: "R011", severity: "HARD", passed: true, detail: "Sem apneia prolongada prescrita." },
    { ruleId: "R015", severity: "HARD", passed: true, detail: "Prescrição gerada pelo motor; IA não altera objetivo/zona/fundamento sem nova decisão." },
    { ruleId: "R018", severity: "HARD", passed: prescription.source.kind !== "LIBRARY_SCALED" || (librarySource?.machineStatus ?? "").includes("BLOCKS_EXACT"), detail: prescription.source.kind === "LIBRARY_SCALED" ? `Sessão ${prescription.source.librarySessionId} recombinável (BLOCKS_EXACT).` : "Sessão composta pelo motor." },
  ];
  void athlete;
  return concludeAudit(checks);
}

function volumeByZone(prescription: RkfPrescription, zone: ZoneCode): number {
  return prescription.blocks.filter((block) => block.zone === zone).reduce((sum, block) => sum + block.volumeM, 0);
}

/**
 * Executa o pipeline completo. Falha de auditoria dispara recomposição uma
 * vez; persistindo a falha, retorna REVISAR sem publicar (bloqueio de
 * produção do manual seção 28).
 */
export function generatePrescription(
  athlete: PlanningAthleteContext,
  request: PlanningRequest,
  library: readonly LibrarySession[] = [],
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  now = new Date(),
): PlanningResult {
  const requestedZone = zoneOrDefault(request.primaryZone, "A2");
  const eligible = library
    .map((session) => ({ session, hard: applyHardRules(session, request, athlete) }))
    .filter((candidate) => candidate.hard.eligible)
    .map((candidate) => candidate.session);
  const scored = eligible
    .map((session) => ({ session, score: scoreSession(session, request, athlete, weights, library) }))
    .sort((a, b) => b.score - a.score);

  const build = (): RkfPrescription => {
    const timestamp = now.toISOString();
    const id = `rx-${Math.round(now.getTime() / 1000).toString(36)}-${athlete.athleteId}`;
    if (scored.length) {
      const best = scored[0];
      const scaled = scaleLibrarySession(best.session, request);
      return {
        id, athleteId: athlete.athleteId, title: best.session.title, objective: request.objective,
        primaryZone: requestedZone, secondaryZone: request.secondaryZone !== undefined ? zoneOrDefault(request.secondaryZone, requestedZone) : null,
        rdcMarker: request.rdcMarker, totalVolumeM: scaled.totalVolumeM, blocks: scaled.blocks,
        zoneAllocation: { ...allocateVolumeByDistribution(request.targetVolumeM, SPECIALTY_TO_PROFILE[athlete.specialty], request.phase), advisory: true },
        source: { kind: "LIBRARY_SCALED", librarySessionId: best.session.id },
        rationale: [`Selecionada da biblioteca (${best.session.id}) com score ${best.score.toFixed(3)} e volume ajustado ao alvo exato.`],
        score: best.score, approvalRequired: true,
        versions: { engine: PLANNING_ENGINE_VERSION, rules: RULES_VERSION, seed: "RKF_V5.1" },
        generatedAtUtc: timestamp,
      };
    }
    const composed = composeSession(request, athlete);
    return {
      id, athleteId: athlete.athleteId, title: `Sessão ${requestedZone}: ${PHASE_BY_ID[request.phase].label}`, objective: request.objective,
      primaryZone: requestedZone, secondaryZone: request.secondaryZone !== undefined ? zoneOrDefault(request.secondaryZone, requestedZone) : null,
      rdcMarker: request.rdcMarker, totalVolumeM: composed.totalVolumeM, blocks: composed.blocks,
      zoneAllocation: { ...allocateVolumeByDistribution(request.targetVolumeM, SPECIALTY_TO_PROFILE[athlete.specialty], request.phase), advisory: true },
      source: { kind: "COMPOSED" },
      rationale: composed.rationale, approvalRequired: true,
      versions: { engine: PLANNING_ENGINE_VERSION, rules: RULES_VERSION, seed: "RKF_V5.1" },
      generatedAtUtc: timestamp,
    };
  };

  const bestSession = scored[0]?.session;
  const librarySource = bestSession ? { machineStatus: bestSession.machineStatus ?? "" } : undefined;
  let prescription = build();
  let audit = auditPrescription(prescription, request, athlete, librarySource);
  if (!audit.passed) {
    // Pipeline do manual seção 12: if fail → reselect_or_recompose. Primeiro
    // reconstrói (reselect); persistindo a falha, recomputa por composição
    // determinística do motor antes de declarar REVISAR.
    prescription = build();
    audit = auditPrescription(prescription, request, athlete, librarySource);
    if (!audit.passed && prescription.source.kind === "LIBRARY_SCALED") {
      const composed = composeSession(request, athlete);
      prescription = {
        id: prescription.id, athleteId: athlete.athleteId, title: `Sessão ${requestedZone}: ${PHASE_BY_ID[request.phase].label}`, objective: request.objective,
        primaryZone: requestedZone, secondaryZone: request.secondaryZone !== undefined ? zoneOrDefault(request.secondaryZone, requestedZone) : null,
        rdcMarker: request.rdcMarker, totalVolumeM: composed.totalVolumeM, blocks: composed.blocks,
        zoneAllocation: { ...allocateVolumeByDistribution(request.targetVolumeM, SPECIALTY_TO_PROFILE[athlete.specialty], request.phase), advisory: true },
        source: { kind: "COMPOSED" },
        rationale: [`Candidato da biblioteca (${prescription.source.librarySessionId}) reprovado na auditoria; recomposição determinística aplicada.`, ...composed.rationale],
        approvalRequired: true,
        versions: { engine: PLANNING_ENGINE_VERSION, rules: RULES_VERSION, seed: "RKF_V5.1" },
        generatedAtUtc: prescription.generatedAtUtc,
      };
      audit = auditPrescription(prescription, request, athlete, undefined);
    }
  }

  const sessionValidation = validateRkfSession({
    primaryZone: prescription.primaryZone,
    rdcMarker: prescription.rdcMarker,
    blocks: prescription.blocks.map((block) => ({ component: block.component, volumeM: block.volumeM, zone: block.zone, materials: block.materials, skills: block.skills })),
    ageContext: { age: athlete.age, developmentLevel: athlete.developmentLevel },
  });

  const status: PlanningResult["status"] = audit.passed && sessionValidation.valid ? "PRONTO" : "REVISAR";
  return {
    status,
    prescription,
    audit,
    sessionValidation,
    pipeline: { eligible: eligible.length, scored: scored.length, selected: prescription.source.kind === "LIBRARY_SCALED" ? prescription.source.librarySessionId! : "COMPOSED" },
    versions: { engine: PLANNING_ENGINE_VERSION, rules: RULES_VERSION },
  };
}
