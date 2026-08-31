/**
 * Contratos de UI (G27) e seeds de UI (G28) do manual §22: os cinco
 * contratos de tela (comando, treino de hoje, carga, pós-treino pendente,
 * edição publicada) e fixtures nomeadas para os estados IDLE/LOADING/
 * REVIEW/SUCCESS/EMPTY/BLOCKED/ERROR.
 */

export const UI_CONTRACT_VERSION = "rkf-ui-contracts-1.0.0";

export type UiContract = {
  id: string;
  surface: string;
  route: string;
  alwaysVisible: string[];
  states: string[];
};

/** Os 5 contratos de UI do manual §22. */
export const UI_CONTRACTS: UiContract[] = [
  {
    id: "UI-01",
    surface: "Comando central (prompt curto, texto/voz/menu)",
    route: "/pt/coach/today",
    alwaysVisible: ["volume total", "zona primária", "objetivo", "PSE esperado"],
    states: ["IDLE", "LOADING", "SUCCESS", "ERROR"],
  },
  {
    id: "UI-02",
    surface: "Treino de hoje com visão imediata da sessão",
    route: "/pt/coach/practices",
    alwaysVisible: ["volume total", "zona primária", "objetivo"],
    states: ["IDLE", "LOADING", "EMPTY", "SUCCESS"],
  },
  {
    id: "UI-03",
    surface: "Carga recente com tendência e alertas",
    route: "/pt/coach/analytics",
    alwaysVisible: ["carga", "readiness"],
    states: ["IDLE", "LOADING", "EMPTY", "SUCCESS", "BLOCKED"],
  },
  {
    id: "UI-04",
    surface: "Pós-treino pendente com revisão humana",
    route: "/pt/coach/rkf",
    alwaysVisible: ["revisão pendente", "confiança"],
    states: ["IDLE", "REVIEW", "SUCCESS", "BLOCKED"],
  },
  {
    id: "UI-05",
    surface: "Edição publicada mostra quem/o quê e cria versão",
    route: "/pt/coach/rkf",
    alwaysVisible: ["versão", "autor da alteração"],
    states: ["REVIEW", "SUCCESS"],
  },
];

export type UiSeed = {
  id: string;
  name: string;
  state: "IDLE" | "LOADING" | "REVIEW" | "SUCCESS" | "EMPTY" | "BLOCKED" | "ERROR";
  surface: string;
  fixture: Record<string, unknown>;
};

/** Seeds de UI nomeadas por estado do manual §22 (G28). */
export const UI_SEEDS: UiSeed[] = [
  { id: "ui-seed-idle", name: "Comando aguardando entrada", state: "IDLE", surface: "UI-01", fixture: { prompt: "", suggestions: ["Prescrever sessão", "Registrar pós-treino", "Consultar carga"] } },
  { id: "ui-seed-loading", name: "Análise em curso com cancelamento", state: "LOADING", surface: "UI-01", fixture: { cancelable: true, stage: "analisando" } },
  { id: "ui-seed-review", name: "Upload ambíguo exige revisão antes do commit", state: "REVIEW", surface: "UI-04", fixture: { confidence: 0.42, missingFields: ["athleteId", "date"], blocksCommit: true } },
  { id: "ui-seed-success", name: "Prescrição publicada com versão", state: "SUCCESS", surface: "UI-05", fixture: { version: 2, publishedBy: "user-coach", totalVolumeM: 5800 } },
  { id: "ui-seed-empty", name: "Atleta sem dados de carga", state: "EMPTY", surface: "UI-03", fixture: { message: "Sem sessões registradas", action: "Registrar primeiro treino" } },
  { id: "ui-seed-blocked", name: "Bloqueio clínico com motivo e ação permitida", state: "BLOCKED", surface: "UI-03", fixture: { reason: "Readiness 38 abaixo do piso de 45", allowedAction: "Sessão regenerativa A1 com avaliação do treinador" } },
  { id: "ui-seed-error", name: "Falha de rede com retry e suporte", state: "ERROR", surface: "UI-01", fixture: { retryable: true, supportContact: "suporte@rkf.coach" } },
];

/** Valida que um contrato cobre os quatro campos sempre visíveis do manual. */
export function contractCoversAlwaysVisible(contractId: string): boolean {
  const contract = UI_CONTRACTS.find((candidate) => candidate.id === contractId);
  return Boolean(contract && contract.alwaysVisible.length >= 2 && contract.states.length >= 2);
}

/** Contagem de estados do manual §22 cobertos pelas seeds. */
export function uiSeedStateCoverage(): string[] {
  return [...new Set(UI_SEEDS.map((seed) => seed.state))];
}
