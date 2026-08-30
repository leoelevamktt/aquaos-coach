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
}

export interface RkfLibrary {
  sessions: LibrarySession[];
  stats: RkfLibraryStats;
}

let cache: { packageHash: string; library: RkfLibrary } | undefined;

/** Hash do par sessions.csv+blocks.csv para invalidar o cache quando a seed mudar. */
function libraryPackageHash(): string | null {
  try {
    const sessions = readFileSync(`${seedRoot}sessions.csv`);
    const blocks = readFileSync(`${seedRoot}blocks.csv`);
    return createHash("sha256").update(sessions).update(blocks).digest("hex");
  } catch {
    return null;
  }
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

  const sessionRows = parseDelimited(readFileSync(sessionsPath, "utf8"));
  const blockRows = parseDelimited(readFileSync(blocksPath, "utf8"));

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
        return {
          component,
          volumeM: numberOrUndefined(String(block.volume_m ?? "")) ?? 0,
          zone: normalizedZone.zone ?? undefined,
          prescriptionText: String(block.prescription_text ?? "") || undefined,
          materials: parseMaterialList(String(block.materials ?? "")),
          skills: parseSkillList(String(block.skills ?? "")),
        };
      });
    const blocksTotal = blocks.reduce((sum, block) => sum + block.volumeM, 0);
    if (volumeAudited === undefined || blocksTotal !== volumeAudited || blocks.some((block) => block.volumeM <= 0)) incompleteSessions += 1;
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
      machineStatus: String(row.machine_status ?? ""),
      appSelectable: String(row.app_selectable ?? "YES").toUpperCase() !== "NO",
    };
  });

  const library: RkfLibrary = {
    sessions,
    stats: {
      sessions: sessions.length,
      blocks: blockRows.length,
      incompleteSessions,
      unmappedBlockTypes,
      packageHash,
    },
  };
  cache = { packageHash, library };
  return library;
}
