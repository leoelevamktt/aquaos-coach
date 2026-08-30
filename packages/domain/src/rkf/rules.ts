/**
 * Catálogo oficial de regras RKF (seed rules_rkf.csv / manual seção 15).
 * Severidade HARD elimina candidatos; GUIDE orienta; ARCH é decisão de
 * arquitetura. Score nunca supera HARD.
 */

export type RuleSeverity = "HARD" | "GUIDE" | "ARCH";

export interface RkfRule {
  id: string;
  group: string;
  text: string;
  severity: RuleSeverity;
}

export const RULES_RKF: readonly RkfRule[] = [
  { id: "R001", group: "EXACT_VOLUME", text: "Volume proposto e auditado devem fechar com diferença 0 antes da liberação.", severity: "HARD" },
  { id: "R002", group: "ZONE_VOCAB", text: "Usar VALAT, A1, A2, A3, AN1 e AN2.", severity: "HARD" },
  { id: "R003", group: "ZONE_MAPPING", text: "EN1=A1; EN2=A2; EN3=A3; SP1=AN1; SP2=AN2; SP3=VALAT.", severity: "HARD" },
  { id: "R004", group: "VALAT_QUALITY", text: "VALAT prioriza qualidade neuromuscular curta com recuperação suficiente.", severity: "HARD" },
  { id: "R005", group: "A2_STABILITY", text: "A2 exige estabilidade de ritmo, mecânica, braçadas e PSE.", severity: "HARD" },
  { id: "R006", group: "PROGRESSION_VOLUME", text: "Menor intensidade admite maior volume; maior intensidade exige menor volume e mais qualidade.", severity: "HARD" },
  { id: "R007", group: "AGE_PERIODIZATION", text: "8–13 predominantemente linear/desenvolvimental; 14+ pode usar ATR conforme contexto.", severity: "GUIDE" },
  { id: "R008", group: "TECH_TRANSFER", text: "Educativos devem transferir para nado completo.", severity: "HARD" },
  { id: "R009", group: "MATERIAL_TRANSFER", text: "Resistido com material deve, quando aplicável, transferir para nado limpo.", severity: "GUIDE" },
  { id: "R010", group: "FULL_DESCRIPTION", text: "Nenhum bloco fica implícito; ausência deve ser 0 m com justificativa.", severity: "HARD" },
  { id: "R011", group: "NO_LONG_APNEA", text: "Não prescrever apneia prolongada; priorizar segurança e qualidade.", severity: "HARD" },
  { id: "R012", group: "EYES_CLOSED_SAFE", text: "Olhos fechados somente por poucos ciclos, supervisionado e longe da parede.", severity: "HARD" },
  { id: "R013", group: "MASTER_COST", text: "Master mantém qualidade com custo adaptativo e mecânico inteligente.", severity: "GUIDE" },
  { id: "R014", group: "POST_SESSION_DATA", text: "Tempos, PSE e observações pós-treino devem vincular-se ao session_id.", severity: "GUIDE" },
  { id: "R015", group: "AI_BOUNDARY", text: "IA adapta dentro da intenção; trocar objetivo/zona/fundamento exige nova decisão do Planning Engine.", severity: "HARD" },
  { id: "R016", group: "SOURCE_OF_TRUTH", text: "MASTER é fonte editorial; app consulta banco estruturado, não o XLSX inteiro em tempo real.", severity: "ARCH" },
  { id: "R017", group: "DECISION_SEPARATION", text: "Biblioteca define opções; Planning Engine decide; IA apresenta/adapta dentro das regras.", severity: "ARCH" },
  { id: "R018", group: "BLOCK_RECOMBINATION", text: "Recombinar blocos somente quando machine_status=READY_WHOLE|BLOCKS_EXACT; senão usar sessão inteira.", severity: "HARD" },
] as const;

export const RULES_VERSION = "RKF_V5.1";

export interface RuleCheckResult {
  ruleId: string;
  severity: RuleSeverity;
  passed: boolean;
  detail: string;
}

export interface RuleAudit {
  passed: boolean;
  hardFailures: string[];
  checks: RuleCheckResult[];
  auditedAtUtc: string;
  rulesVersion: string;
}

export function concludeAudit(checks: RuleCheckResult[], now = new Date()): RuleAudit {
  const hardFailures = checks.filter((check) => !check.passed && check.severity === "HARD").map((check) => `${check.ruleId}: ${check.detail}`);
  return {
    passed: hardFailures.length === 0,
    hardFailures,
    checks,
    auditedAtUtc: now.toISOString(),
    rulesVersion: RULES_VERSION,
  };
}
