/**
 * Dicionários oficiais RKF V5.1 — zonas, materiais, skills e taxonomia.
 * Fonte: seed 02_RKF_COACH_SEED_V5_1_SUPABASE (zones.csv, materials.csv,
 * skills.csv) e manual técnico seção 9. Códigos devem coincidir exatamente
 * com a seed; nenhuma regra metodológica é alterada aqui.
 */

export const RKF_SEED_VERSION = "RKF_V5.1";

export const ZONE_CODES = ["VALAT", "A1", "A2", "A3", "AN1", "AN2"] as const;
export type ZoneCode = (typeof ZONE_CODES)[number];

export interface RkfZone {
  code: ZoneCode;
  name: string;
  effortDefinition: string;
  primarySystem: string;
  rkfRule: string;
  externalMapping: string;
}

export const ZONES: readonly RkfZone[] = [
  { code: "VALAT", name: "Velocidade alática", effortDefinition: "2,5–25 m de qualidade máxima", primarySystem: "Neuromuscular / potência", rkfRule: "Recuperação ampla; reduzir/parar se cair velocidade ou técnica.", externalMapping: "SP3" },
  { code: "A1", name: "Aeróbio leve", effortDefinition: "Baixa intensidade sustentável", primarySystem: "Base / recuperação ativa", rkfRule: "Técnica estável e baixa deriva.", externalMapping: "EN1" },
  { code: "A2", name: "Aeróbio estável", effortDefinition: "Ritmo aeróbio controlado", primarySystem: "Capacidade aeróbia", rkfRule: "Estabilidade de ritmo, braçadas e PSE; não migrar para A3.", externalMapping: "EN2" },
  { code: "A3", name: "Aeróbio intenso", effortDefinition: "Acima de A2, controlado", primarySystem: "Potência aeróbia", rkfRule: "Qualidade alta com volume menor que A2.", externalMapping: "EN3" },
  { code: "AN1", name: "Anaeróbio 1", effortDefinition: "Produção anaeróbia específica", primarySystem: "Anaeróbio", rkfRule: "Manter velocidade e mecânica.", externalMapping: "SP1" },
  { code: "AN2", name: "Anaeróbio 2", effortDefinition: "Esforço anaeróbio muito elevado", primarySystem: "Potência anaeróbia", rkfRule: "Volume controlado e recuperação ampla.", externalMapping: "SP2" },
] as const;

export const ZONE_BY_CODE: Readonly<Record<ZoneCode, RkfZone>> = Object.fromEntries(ZONES.map((zone) => [zone.code, zone])) as Record<ZoneCode, RkfZone>;

/** R003 — mapeamento de nomenclatura externa para o vocabulário oficial. */
export const EXTERNAL_ZONE_MAP: Readonly<Record<string, ZoneCode>> = {
  EN1: "A1", EN2: "A2", EN3: "A3",
  SP1: "AN1", SP2: "AN2", SP3: "VALAT",
  N1: "AN1", N2: "AN2",
};

/**
 * Marcadores históricos de ritmo de prova (RP50, RP100, ...) não são zonas:
 * viram marcador RDC junto à zona fisiológica (VAL-004).
 */
export const RDC_MARKER_PATTERN = /^RP\d+$/i;

export function normalizeZoneCode(raw: string): { zone: ZoneCode | null; rdcMarker: boolean; mappedFrom?: string } {
  const trimmed = raw.trim().toUpperCase();
  if ((ZONE_CODES as readonly string[]).includes(trimmed)) return { zone: trimmed as ZoneCode, rdcMarker: false };
  const external = EXTERNAL_ZONE_MAP[trimmed];
  if (external) return { zone: external, rdcMarker: false, mappedFrom: trimmed };
  if (RDC_MARKER_PATTERN.test(trimmed) || trimmed === "RDC") return { zone: null, rdcMarker: true, mappedFrom: trimmed };
  return { zone: null, rdcMarker: false };
}

/** Taxonomia não energética usada na composição e leitura de blocos. */
export const NON_ENERGY_TAXONOMY = [
  "BR", "PR", "FO", "SS", "MM", "PROGRESSIVO", "RDC", "NADO", "COMB", "OFF",
] as const;
export type NonEnergyTaxonomy = (typeof NON_ENERGY_TAXONOMY)[number];

export type MaterialCode =
  | "PALMAR_P" | "PALMAR_M" | "PALMAR_G" | "FINS" | "PARA" | "DRAG"
  | "SHIRT" | "SHORT" | "BOARD" | "PULL" | "SNORKEL";

export interface RkfMaterial {
  code: MaterialCode;
  name: string;
  category: string;
  primaryUse: string;
  rkfConstraint: string;
}

export const MATERIALS: readonly RkfMaterial[] = [
  { code: "PALMAR_P", name: "Palmar pequeno", category: "Força/sensibilidade", primaryUse: "Amplificar apoio com baixa sobrecarga", rkfConstraint: "Preservar ombro e trajetória." },
  { code: "PALMAR_M", name: "Palmar médio", category: "Força específica", primaryUse: "Aumentar resistência de apoio", rkfConstraint: "Evitar perda técnica." },
  { code: "PALMAR_G", name: "Palmar grande", category: "Força específica alta", primaryUse: "Maior resistência", rkfConstraint: "Uso criterioso." },
  { code: "FINS", name: "Pé de pato", category: "Técnica/velocidade", primaryUse: "Posição corporal, submerso, velocidade", rkfConstraint: "Não assumir automaticamente carga alta." },
  { code: "PARA", name: "Paraquedas P/M/G", category: "Resistido", primaryUse: "Força específica / contraste", rkfConstraint: "Transferir para nado limpo." },
  { code: "DRAG", name: "Drag socks", category: "Resistido", primaryUse: "Força/contraste", rkfConstraint: "Preservar alinhamento." },
  { code: "SHIRT", name: "Camisa", category: "Resistido", primaryUse: "Arrasto global", rkfConstraint: "Transferência posterior." },
  { code: "SHORT", name: "Short", category: "Resistido", primaryUse: "Arrasto global", rkfConstraint: "Transferência posterior." },
  { code: "BOARD", name: "Prancha", category: "Perna", primaryUse: "Organizar pernas", rkfConstraint: "Alternar posições quando necessário." },
  { code: "PULL", name: "Pull buoy", category: "Braço", primaryUse: "Estabilizar pernas", rkfConstraint: "Não mascarar posição corporal." },
  { code: "SNORKEL", name: "Snorkel", category: "Técnica/aeróbio", primaryUse: "Retirar interferência respiratória", rkfConstraint: "Usar quando coerente." },
] as const;

export type SkillCode =
  | "START_FRONT" | "START_BACK" | "TURN_FREE" | "TURN_OPEN" | "TURN_BACK"
  | "STREAMLINE" | "UNDERWATER" | "BREAKOUT" | "SCULL" | "STROKE_CONTROL"
  | "BREATH" | "KICK" | "COORD" | "PROPRIO";

export interface RkfSkill {
  code: SkillCode;
  name: string;
  category: string;
  technicalSequence: string;
}

export const SKILLS: readonly RkfSkill[] = [
  { code: "START_FRONT", name: "Saída de bloco", category: "Saídas", technicalSequence: "posição→reação→impulsão→voo→entrada→streamline→submerso→breakout" },
  { code: "START_BACK", name: "Saída de costas", category: "Saídas", technicalSequence: "posição→tração→projeção→entrada→streamline→submerso→breakout" },
  { code: "TURN_FREE", name: "Virada de crawl", category: "Viradas", technicalSequence: "aproximação→última braçada→rotação→pés→impulsão→streamline→submerso→breakout" },
  { code: "TURN_OPEN", name: "Virada aberta peito/borboleta", category: "Viradas", technicalSequence: "toque simultâneo→rotação→pés→impulsão→saída específica" },
  { code: "TURN_BACK", name: "Virada de costas", category: "Viradas", technicalSequence: "contagem→rotação ventral→cambalhota→impulsão→submerso→breakout" },
  { code: "STREAMLINE", name: "Streamline", category: "Habilidade aquática", technicalSequence: "alinhamento hidrodinâmico" },
  { code: "UNDERWATER", name: "Submerso", category: "Habilidade aquática", technicalSequence: "preservar velocidade submersa" },
  { code: "BREAKOUT", name: "Breakout", category: "Habilidade aquática", technicalSequence: "transição submerso-superfície" },
  { code: "SCULL", name: "Scull", category: "Sensibilidade", technicalSequence: "pressão mão/antebraço" },
  { code: "STROKE_CONTROL", name: "Controle de braçadas", category: "Eficiência", technicalSequence: "distância por ciclo, ritmo e velocidade" },
  { code: "BREATH", name: "Respiração", category: "Coordenação", technicalSequence: "respirar sem deformar o nado" },
  { code: "KICK", name: "Perna", category: "Propulsão", technicalSequence: "técnica, resistência e potência" },
  { code: "COORD", name: "Coordenação", category: "Técnica", technicalSequence: "integração braço-perna-tronco" },
  { code: "PROPRIO", name: "Propriocepção", category: "Habilidade aquática", technicalSequence: "eixo, rotação e posição corporal" },
] as const;

export const SKILL_BY_CODE: Readonly<Record<SkillCode, RkfSkill>> = Object.fromEntries(SKILLS.map((skill) => [skill.code, skill])) as Record<SkillCode, RkfSkill>;

/**
 * Política de material por idade/zona/estado (manual seção 9 e 14).
 * Material é modificador, nunca zona. Todo material resistido precisa
 * transferir para nado limpo (R009, GUIDE).
 */
export interface MaterialRuleContext {
  age: number;
  developmentLevel: "formacao" | "rendimento";
  zones: readonly ZoneCode[];
  rdc100?: boolean;
  shoulderFatigued?: boolean;
  painOrInjury?: boolean;
}

export interface MaterialPolicyResult {
  allowed: boolean;
  violations: string[];
  notes: string[];
}

const HIGH_STRESS_ZONES: readonly ZoneCode[] = ["AN2", "VALAT"];

export function evaluateMaterialPolicy(material: MaterialCode, context: MaterialRuleContext): MaterialPolicyResult {
  const violations: string[] = [];
  const notes: string[] = [];
  const usesHighStress = context.zones.some((zone) => HIGH_STRESS_ZONES.includes(zone));

  if (context.painOrInjury && ["PALMAR_P", "PALMAR_M", "PALMAR_G", "PARA", "DRAG"].includes(material)) {
    violations.push("Dor/lesão bloqueia material resistido.");
  }

  if (context.age < 11) {
    if (["PALMAR_P", "PALMAR_M", "PALMAR_G", "PARA", "DRAG"].includes(material)) {
      violations.push("8–10 usa apenas camiseta/short leve; sem palmar, paraquedas ou drag socks.");
    }
    notes.push("Faixa 8–10: prioridade em alfabetização aquática; evitar combinações de material.");
  }

  if (material === "PALMAR_P" && context.age < 11) violations.push("Palmar P a partir de 11 anos.");
  if (material === "PALMAR_M") {
    if (context.age < 13) violations.push("Palmar M a partir de 13 anos.");
    if (usesHighStress || context.rdc100) violations.push("Palmar M: evitar AN2/VALAT/RDC100.");
  }
  if (material === "PALMAR_G") {
    if (context.age < 15 || (context.developmentLevel !== "rendimento" && context.age < 18)) {
      violations.push("Palmar G apenas 15+ avançado/adulto.");
    }
    if (usesHighStress || context.rdc100) violations.push("Palmar G proibido em VALAT/AN2/RDC100.");
    if (context.shoulderFatigued) violations.push("Palmar G proibido com ombro fatigado.");
  }
  if ((material === "PARA" || material === "DRAG") && context.age < 15) {
    violations.push("Paraquedas e drag socks somente a partir de 15 anos.");
  }

  if (["PALMAR_P", "PALMAR_M", "PALMAR_G", "PARA", "DRAG", "SHIRT", "SHORT"].includes(material)) {
    notes.push("R009 (GUIDE): material resistido deve transferir para nado limpo na mesma sessão ou em sequência próxima.");
  }

  return { allowed: violations.length === 0, violations, notes };
}

/**
 * Intervalos de execução — distinguir send-off de recuperação real.
 * "@ 1:20" = saída a cada 1:20; "20 sec rest" = recuperação real de 20 s.
 */
export type IntervalKind = "SEND_OFF" | "REST";

export interface ParsedInterval {
  kind: IntervalKind;
  seconds: number;
  raw: string;
}

export function parseInterval(raw: string): ParsedInterval | null {
  const value = raw.trim().toLowerCase();
  const sendOff = value.match(/^@\s*(?:(\d+):(\d{1,2}))$/);
  if (sendOff) return { kind: "SEND_OFF", seconds: Number(sendOff[1]) * 60 + Number(sendOff[2]), raw };
  const rest = value.match(/^(\d+)\s*(?:s|sec|secs|seconds)\s*rest$/);
  if (rest) return { kind: "REST", seconds: Number(rest[1]), raw };
  return null;
}

/** Progressões válidas; preservar ordem, volume e tempo por zona. */
export const VALID_PROGRESSIONS = [
  "PROG_A1_A2", "PROG_A1_A2_A3", "PROG_A2_A3", "PROG_A2_A3_AN1", "PROG_A3_AN1", "PROG_CUSTOM",
] as const;
export type ProgressionCode = (typeof VALID_PROGRESSIONS)[number];

const PROGRESSION_ORDER: Record<Exclude<ProgressionCode, "PROG_CUSTOM">, readonly ZoneCode[]> = {
  PROG_A1_A2: ["A1", "A2"],
  PROG_A1_A2_A3: ["A1", "A2", "A3"],
  PROG_A2_A3: ["A2", "A3"],
  PROG_A2_A3_AN1: ["A2", "A3", "AN1"],
  PROG_A3_AN1: ["A3", "AN1"],
};

export function validateProgression(code: ProgressionCode, observedZones: readonly ZoneCode[]): { valid: boolean; reason?: string } {
  if (code === "PROG_CUSTOM") return { valid: true, reason: "Progressão customizada exige auditoria do treinador." };
  const expected = PROGRESSION_ORDER[code];
  const present = expected.filter((zone) => observedZones.includes(zone));
  if (present.length !== expected.length) return { valid: false, reason: `Progressão ${code} exige as zonas ${expected.join(" → ")} presentes.` };
  const order = observedZones.filter((zone) => expected.includes(zone));
  for (let index = 1; index < order.length; index += 1) {
    if (expected.indexOf(order[index]) < expected.indexOf(order[index - 1])) {
      return { valid: false, reason: `Progressão ${code} deve preservar a ordem ${expected.join(" → ")}.` };
    }
  }
  return { valid: true };
}
