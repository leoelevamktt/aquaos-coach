/**
 * Parser RKF de treinos em texto livre (manual seção 16).
 * Extrai blocos, zonas, volumes, materiais e repetições do texto original
 * sem inventar dados: tudo que não é extraído com confiança fica ausente e a
 * ingestão segue para revisão humana. Zonas externas são mapeadas via R003;
 * RPxx vira marcador RDC, nunca zona (VAL-004).
 */

import { normalizeZoneCode, RDC_MARKER_PATTERN } from "@natacao/domain";

export interface ParsedTrainingLine {
  component: string | null;
  volumeM: number | null;
  zones: string[];
  rdcMarkers: string[];
  materials: string[];
  repetitions: number | null;
  distanceM: number | null;
  text: string;
}

export interface ParsedTraining {
  blocks: ParsedTrainingLine[];
  totalVolumeM: number | null;
  zones: string[];
  rdcMarkers: string[];
  materials: string[];
  confidence: number;
  warnings: string[];
}

const MATERIAL_WORDS: Array<[RegExp, string]> = [
  [/palmar(?:es)?\s*p(?:eq(?:ueno)?)?|palmar\s*p\b/i, "PALMAR_P"],
  [/palmar(?:es)?\s*m(?:[ée]dio)?|palmar\s*m\b/i, "PALMAR_M"],
  [/palmar(?:es)?\s*g(?:rande)?|palmar\s*g\b/i, "PALMAR_G"],
  [/pé[s]?\s*de\s*pat[oa]|chinel[ao]s?\b/i, "FINS"],
  [/paraquedas\b/i, "PARA"],
  [/drag\s*socks?|meia[s]?\s*de\s*arrasto/i, "DRAG"],
  [/camis[ae]ta?\b/i, "SHIRT"],
  [/shorts?\b/i, "SHORT"],
  [/prancha(?:s)?\b/i, "BOARD"],
  [/pull\s*buoy|pullbuoy|pull\b/i, "PULL"],
  [/snorkel\b/i, "SNORKEL"],
];

const COMPONENT_WORDS: Array<[RegExp, string]> = [
  [/aquec(?:ecimento|e)/i, "AQUECIMENTO"],
  [/regenerativo|volta\s*à\s*calma|desaquecimento/i, "REGENERATIVO"],
  [/perna[s]?\b/i, "PERNA"],
  [/bra[çc]o[s]?\b/i, "BRAÇO"],
  [/pr[ée][- ]?s[ée]rie/i, "PRÉ-SÉRIE"],
  [/principal|s[ée]rie\s*principal|desenvolvimento/i, "SÉRIE PRINCIPAL"],
];

/** Extrai volume total declarado (ex.: "sessão de 4000 m" / "total: 4.000m"). */
function declaredTotal(text: string): number | null {
  const match = text.match(/(?:total|sess[ãa]o\s*de|volume)\D{0,12}(\d{1,2}[.,]\d{3}|\d{3,5})\s*m/i);
  if (!match) return null;
  return Number(match[1].replace(/\./g, "").replace(",", "."));
}

export function parseTrainingText(text: string): ParsedTraining {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n|(?<=[a-z0-9)])\s*[;]\s*(?=\d)/i)
    .map((line) => line.trim())
    .filter((line) => line.length > 1 && /[\dx]/i.test(line));

  const blocks: ParsedTrainingLine[] = [];
  const allZones = new Set<string>();
  const allRdc = new Set<string>();
  const allMaterials = new Set<string>();
  let parsedVolumeLines = 0;

  for (const line of lines) {
    const zones: string[] = [];
    const rdcMarkers: string[] = [];
    for (const token of line.toUpperCase().match(/\b[A-Z]{1,4}\d{0,3}\b/g) ?? []) {
      const normalized = normalizeZoneCode(token);
      if (normalized.zone) zones.push(normalized.zone);
      if (normalized.rdcMarker) rdcMarkers.push(token);
    }
    const materials = MATERIAL_WORDS.filter(([pattern]) => pattern.test(line)).map(([, code]) => code);
    const component = COMPONENT_WORDS.find(([pattern]) => pattern.test(line))?.[1] ?? null;

    const repetitionMatch = line.match(/(\d{1,2})\s*[x×]\s*(\d{2,4})\s*m?/i);
    const repetitions = repetitionMatch ? Number(repetitionMatch[1]) : null;
    const distanceM = repetitionMatch ? Number(repetitionMatch[2]) : null;
    const volumeMatch = line.match(/(?:^|[\s:=])(\d{1,2}[.,]\d{3}|\d{3,5})\s*m\b/i);
    let volumeM: number | null = volumeMatch ? Number(volumeMatch[1].replace(/\./g, "").replace(",", ".")) : null;
    if (volumeM === null && repetitions !== null && distanceM !== null) volumeM = repetitions * distanceM;

    if (volumeM !== null) parsedVolumeLines += 1;
    for (const zone of zones) allZones.add(zone);
    for (const marker of rdcMarkers) allRdc.add(marker);
    for (const material of materials) allMaterials.add(material);
    if (RDC_MARKER_PATTERN.test(line)) warnings.push(`Marcador de ritmo detectado em "${line.slice(0, 40)}": RDC junto à zona fisiológica.`);

    blocks.push({ component, volumeM, zones, rdcMarkers: rdcMarkers.filter((marker) => /RP\d+/i.test(marker)), materials, repetitions, distanceM, text: line.slice(0, 300) });
  }

  const computedTotal = blocks.reduce((sum, block) => sum + (block.volumeM ?? 0), 0);
  const declared = declaredTotal(text);
  let totalVolumeM = computedTotal || declared;
  if (declared !== null && computedTotal !== declared && computedTotal > 0) {
    warnings.push(`Volume declarado (${declared} m) difere do somatório extraído (${computedTotal} m): manter ambos e exigir revisão humana.`);
  }
  if (!blocks.length) warnings.push("Nenhum bloco extraído: revisão humana obrigatória.");

  const lineCoverage = lines.length ? parsedVolumeLines / lines.length : 0;
  const zoneCoverage = blocks.filter((block) => block.zones.length).length / Math.max(blocks.length, 1);
  // Confiança conservadora: cobertura de volume e de zona; nunca acima de 0,90
  // sem revisão — o limiar de 0,85 exige humana (manual seção 16).
  const confidence = Math.min(0.9, 0.45 + 0.3 * lineCoverage + 0.15 * zoneCoverage);

  return {
    blocks,
    totalVolumeM,
    zones: [...allZones],
    rdcMarkers: [...allRdc],
    materials: [...allMaterials],
    confidence: Math.round(confidence * 100) / 100,
    warnings,
  };
}
