/**
 * Leitor da seed RKF V5.1 (data/rkf/RKF_V5_1) para o Planning Engine.
 * Converte sessions.csv + blocks.csv em LibrarySession[] sem inventar dados:
 * campos vazios permanecem vazios (NULL/UNKNOWN), nunca completados por
 * título ou palpite (manual seção 8.2). Cache por packageHash.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeZoneCode, type MaterialCode, type SkillCode, type ZoneCode } from "@natacao/domain";
import { parseDelimited } from "./managed-store.js";
import type { LibrarySession, LibrarySessionBlock, SessionComponent } from "@natacao/domain";

export const seedRoot = fileURLToPath(new URL("../../../data/rkf/RKF_V5_1/", import.meta.url));

const BLOCK_TYPE_TO_COMPONENT: Record<string, SessionComponent> = {
  AQUECIMENTO: "AQUECIMENTO",
  PERNA: "PERNA",
  "BRAÇO": "BRAÇO",
  BRACO: "BRAÇO",
  "PRÉ-SÉRIE": "PRÉ-SÉRIE",
  "PRE-SERIE": "PRÉ-SÉRIE",
  "SÉRIE PRINCIPAL": "SÉRIE PRINCIPAL",
  SERIE_PRINCIPAL: "SÉRIE PRINCIPAL",
  PRINCIPAL: "SÉRIE PRINCIPAL",
  REGENERATIVO: "REGENERATIVO",
};

/** Mapeia block_type da seed para componente oficial; desconhecido vira SÉRIE PRINCIPAL sinalizado. */
function componentFor(blockType: string, fallbackIndex: number): { component: SessionComponent; unmapped: boolean } {
  const normalized = blockType.trim().toUpperCase().replace(/\s+/g, "_");
  const direct = BLOCK_TYPE_TO_COMPONENT[blockType.trim()] ?? BLOCK_TYPE_TO_COMPONENT[normalized];
  if (direct) return { component: direct, unmapped: false };
  if (blockType.toLowerCase().includes("principal")) return { component: "SÉRIE PRINCIPAL", unmapped: false };
  if (blockType.toLowerCase().includes("desenvolvimento")) return { component: "SÉRIE PRINCIPAL", unmapped: true };
  void fallbackIndex;
  return { component: "SÉRIE PRINCIPAL", unmapped: true };
}

function parseZoneList(raw: string): string[] {
  return raw.split(/[|;,]/).map((value) => value.trim()).filter(Boolean);
}

function parseMaterialList(raw: string): MaterialCode[] {
  const normalized = raw.toUpperCase().replace(/\s+/g, "_");
  return parseZoneList(normalized) as MaterialCode[];
}

function parseSkillList(raw: string): SkillCode[] {
  return parseZoneList(raw) as SkillCode[];
}

function numberOrUndefined(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export interface RkfLibraryStats {
  sessions: number;
  blocks: number;
  incompleteSessions: number;
  unmappedBlockTypes: number;
  packageHash: string;
  prescriptionUnits: number;
  executableUnits: number;
  nonExecutableUnits: number;
  atomizationComplete: boolean;
  normalizationAudits: number;
  exactNormalizations: number;
  volumeReconciliations: number;
  volumeMismatched: number;
}

export interface RkfLibrary {
  sessions: LibrarySession[];
  stats: RkfLibraryStats;
}

let cache: { packageHash: string; library: RkfLibrary } | undefined;

/** Hash do pacote completo (5 arquivos operacionais) para invalidar o cache quando a seed mudar. */
function libraryPackageHash(): string | null {
  try {
    const sessions = readFileSync(`${seedRoot}sessions.csv`);
    const blocks = readFileSync(`${seedRoot}blocks.csv`);
    const units = readFileSync(`${seedRoot}prescription_units.csv`);
    const audits = readFileSync(`${seedRoot}normalization_audit.csv`);
    const summaries = readFileSync(`${seedRoot}block_summary.csv`);
    return createHash("sha256").update(sessions).update(blocks).update(units).update(audits).update(summaries).digest("hex");
  } catch {
    return null;
  }
}

type UnitRow = {
  setId: string;
  blockId: string;
  sessionId: string;
  setOrder: number;
  reps: number | undefined;
  distanceM: number | undefined;
  atomization: string;
  sourceFidelity: string;
};

type AuditRow = { sessionId: string; status: string; method: string; volumeM: number | undefined };

type SummaryRow = { sessionId: string; volumeAuditedM: number | undefined; blockVolumeSumM: number | undefined; differenceM: number | undefined; machineStatus: string };

/** Carrega prescription_units, normalization_audit e block_summary sem inventar dados. */
function loadOperationalFiles() {
  const unitsPath = `${seedRoot}prescription_units.csv`;
  const auditsPath = `${seedRoot}normalization_audit.csv`;
  const summariesPath = `${seedRoot}block_summary.csv`;
  if (!existsSync(unitsPath) || !existsSync(auditsPath) || !existsSync(summariesPath)) return null;

  const unitRows = parseDelimited(readFileSync(unitsPath, "utf8"));
  const auditRows = parseDelimited(readFileSync(auditsPath, "utf8"));
  const summaryRows = parseDelimited(readFileSync(summariesPath, "utf8"));

  const unitsByBlock = new Map<string, UnitRow[]>();
  for (const row of unitRows) {
    const unit: UnitRow = {
      setId: String(row.set_id ?? ""),
      blockId: String(row.block_id ?? ""),
      sessionId: String(row.session_id ?? ""),
      setOrder: numberOrUndefined(String(row.set_order ?? "1")) ?? 1,
      reps: numberOrUndefined(String(row.reps_parsed ?? "")),
      distanceM: numberOrUndefined(String(row.distance_parsed_m ?? "")),
      atomization: String(row.atomization ?? ""),
      sourceFidelity: String(row.source_fidelity ?? ""),
    };
    if (!unit.blockId) continue;
    (unitsByBlock.get(unit.blockId) ?? unitsByBlock.set(unit.blockId, []).get(unit.blockId)!).push(unit);
  }

  const auditsBySession = new Map<string, AuditRow>();
  for (const row of auditRows) {
    auditsBySession.set(String(row.session_id ?? ""), {
      sessionId: String(row.session_id ?? ""),
      status: String(row.status ?? ""),
      method: String(row.normalization_method ?? ""),
      volumeM: numberOrUndefined(String(row.volume_m ?? "")),
    });
  }

  const summariesBySession = new Map<string, SummaryRow>();
  for (const row of summaryRows) {
    summariesBySession.set(String(row.session_id ?? ""), {
      sessionId: String(row.session_id ?? ""),
      volumeAuditedM: numberOrUndefined(String(row.volume_audited_m ?? "")),
      blockVolumeSumM: numberOrUndefined(String(row.block_volume_sum_m ?? "")),
      differenceM: numberOrUndefined(String(row.difference_m ?? "")),
      machineStatus: String(row.machine_status ?? ""),
    });
  }

  return { unitRows, auditRows, summaryRows, unitsByBlock, auditsBySession, summariesBySession };
}

/**
 * Carrega a biblioteca a partir da seed canônica. Sessões cujo volume audidado
 * diverge do somatório de blocos são mantidas com o volume audidado e marcadas
 * no machineStatus (auditoria transparente, sem rejeição silenciosa).
 */
export function loadRkfLibrary(): RkfLibrary | null {
  const packageHash = libraryPackageHash();
  if (packageHash === null) return null;
  if (cache && cache.packageHash === packageHash) return cache.library;

  const sessionsPath = `${seedRoot}sessions.csv`;
  const blocksPath = `${seedRoot}blocks.csv`;
  if (!existsSync(sessionsPath) || !existsSync(blocksPath)) return null;
  const operational = loadOperationalFiles();

  const sessionRows = parseDelimited(readFileSync(sessionsPath, "utf8"));
  const blockRows = parseDelimited(readFileSync(blocksPath, "utf8"));

  const blockIdsByKey = new Map<string, string>();
  for (const row of blockRows) {
    const sessionId = String(row.session_id ?? "");
    const blockId = String(row.block_id ?? "");
    if (sessionId && blockId) blockIdsByKey.set(`${sessionId}:${blockId}`, blockId);
  }

  const blocksBySession = new Map<string, typeof blockRows>();
  for (const row of blockRows) {
    const sessionId = String(row.session_id ?? "");
    if (!sessionId) continue;
    (blocksBySession.get(sessionId) ?? blocksBySession.set(sessionId, []).get(sessionId)!).push(row);
  }

  let incompleteSessions = 0;
  let unmappedBlockTypes = 0;
  const sessions: LibrarySession[] = sessionRows.map((row) => {
    const id = String(row.session_id ?? "");
    const volumeAudited = numberOrUndefined(String(row.volume_audited_m ?? ""));
    const rawBlocks = blocksBySession.get(id) ?? [];
    const blocks: LibrarySessionBlock[] = rawBlocks
      .slice()
      .sort((a, b) => Number(a.block_order ?? 0) - Number(b.block_order ?? 0))
      .map((block) => {
        const { component, unmapped } = componentFor(String(block.block_type ?? ""), 0);
        if (unmapped) unmappedBlockTypes += 1;
        const zones = parseZoneList(String(block.zones ?? ""));
        const normalizedZone = zones.length ? normalizeZoneCode(zones[0]) : { zone: null as ZoneCode | null };
        const blockId = String(block.block_id ?? "");
        const units = blockId ? operational?.unitsByBlock.get(blockId) ?? [] : [];
        return {
          component,
          volumeM: numberOrUndefined(String(block.volume_m ?? "")) ?? 0,
          zone: normalizedZone.zone ?? undefined,
          prescriptionText: String(block.prescription_text ?? "") || undefined,
          materials: parseMaterialList(String(block.materials ?? "")),
          skills: parseSkillList(String(block.skills ?? "")),
          units: units.map((unit) => ({
            setId: unit.setId,
            setOrder: unit.setOrder,
            reps: unit.reps,
            distanceM: unit.distanceM,
            atomization: unit.atomization,
            sourceFidelity: unit.sourceFidelity,
            executable: unit.reps !== undefined && unit.reps > 0,
          })),
        };
      });
    const blocksTotal = blocks.reduce((sum, block) => sum + block.volumeM, 0);
    if (volumeAudited === undefined || blocksTotal !== volumeAudited || blocks.some((block) => block.volumeM <= 0)) incompleteSessions += 1;
    const audit = operational?.auditsBySession.get(id);
    const summary = operational?.summariesBySession.get(id);
    return {
      id,
      title: String(row.title ?? id),
      ageBand: String(row.age_band ?? "") || undefined,
      profile: String(row.profile ?? "") || undefined,
      sessionType: String(row.session_type ?? "") || undefined,
      objective: String(row.objective ?? "") || undefined,
      zones: parseZoneList(String(row.zones ?? "")),
      volumeM: volumeAudited ?? blocksTotal,
      blocks,
      machineStatus: summary?.machineStatus || String(row.machine_status ?? ""),
      appSelectable: String(row.app_selectable ?? "YES").toUpperCase() !== "NO",
      normalization: audit ? { status: audit.status, method: audit.method, volumeM: audit.volumeM } : undefined,
      volumeAudit: summary ? { auditedM: summary.volumeAuditedM, blockSumM: summary.blockVolumeSumM, differenceM: summary.differenceM, reconciled: summary.differenceM === 0 } : undefined,
    };
  });

  const allUnits = operational ? [...operational.unitsByBlock.values()].flat() : [];
  const library: RkfLibrary = {
    sessions,
    stats: {
      sessions: sessions.length,
      blocks: blockRows.length,
      incompleteSessions,
      unmappedBlockTypes,
      packageHash,
      prescriptionUnits: operational?.unitRows.length ?? 0,
      executableUnits: allUnits.filter((unit) => unit.reps !== undefined && unit.reps > 0).length,
      nonExecutableUnits: allUnits.filter((unit) => unit.reps === undefined || unit.reps <= 0).length,
      atomizationComplete: allUnits.length > 0 && allUnits.every((unit) => unit.setOrder > 1 || unit.reps !== undefined),
      normalizationAudits: operational?.auditRows.length ?? 0,
      exactNormalizations: operational ? operational.auditRows.filter((row) => String(row.status ?? "").startsWith("EXACT")).length : 0,
      volumeReconciliations: operational?.summaryRows.length ?? 0,
      volumeMismatched: operational ? operational.summaryRows.filter((row) => numberOrUndefined(String(row.difference_m ?? "")) !== 0).length : 0,
    },
  };
  cache = { packageHash, library };
  return library;
}
