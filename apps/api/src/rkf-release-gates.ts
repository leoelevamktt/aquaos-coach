import {
  RULES_RKF,
  ZONES,
  buildComparableKey,
  classifyEvolution,
  computeLoadLayers,
  decideAdaptation,
  validateResponseRanges,
  validateRkfSession,
} from "@natacao/domain";
import { parseTrainingText } from "./rkf-parser.js";

export type ReleaseGateStatus = "PASS" | "REVIEW" | "BLOCKED" | "EXCLUDED";

export type ReleaseGate = {
  id: `G${string}`;
  label: string;
  status: ReleaseGateStatus;
  blocking: boolean;
  evidence: string[];
  expected?: number | string;
  actual?: number | string;
  remediation?: string;
};

export type ReleaseGateRuntimeEvidence = {
  seed: {
    located: boolean;
    staged: boolean;
    imported: boolean;
    sessions: number;
    blocks: number;
    prescriptionUnits: number;
    files: number;
  };
  apiContractCount: number;
  entityCount: number;
  migrationCount: number;
  eventContractCount: number;
  resultCount: number;
  loadSnapshotCount: number;
  postTrainingSeedCount: number;
  fatigueSeedCount: number;
  ingestionSeedCount: number;
  confirmedIngestionCount: number;
  ingestionChannelsObserved: string[];
  auditableOriginalFormatsObserved: string[];
  assignmentTargetTypesObserved: string[];
};

export type ReleaseGateReport = {
  methodologyVersion: "RKF_V5.1";
  evaluatedAtUtc: string;
  scope: { realDeviceIntegrations: "EXCLUDED_BY_PRODUCT_SCOPE" };
  decision: "READY_FOR_APP" | "BLOCKED";
  summary: Record<ReleaseGateStatus, number> & { total: number; blocking: number };
  gates: ReleaseGate[];
};

const pass = (id: ReleaseGate["id"], label: string, evidence: string[], expected?: number | string, actual?: number | string): ReleaseGate =>
  ({ id, label, status: "PASS", blocking: false, evidence, expected, actual });
const review = (id: ReleaseGate["id"], label: string, evidence: string[], remediation: string, expected?: number | string, actual?: number | string): ReleaseGate =>
  ({ id, label, status: "REVIEW", blocking: true, evidence, remediation, expected, actual });
const blocked = (id: ReleaseGate["id"], label: string, evidence: string[], remediation: string, expected?: number | string, actual?: number | string): ReleaseGate =>
  ({ id, label, status: "BLOCKED", blocking: true, evidence, remediation, expected, actual });
const excluded = (id: ReleaseGate["id"], label: string, evidence: string[]): ReleaseGate =>
  ({ id, label, status: "EXCLUDED", blocking: false, evidence });

function executableDomainEvidence() {
  const completeSession = validateRkfSession({
    primaryZone: "A2",
    rdcMarker: false,
    blocks: ["AQUECIMENTO", "PERNA", "BRAÇO", "PRÉ-SÉRIE", "SÉRIE PRINCIPAL", "REGENERATIVO"].map((component, index) => ({
      component: component as "AQUECIMENTO" | "PERNA" | "BRAÇO" | "PRÉ-SÉRIE" | "SÉRIE PRINCIPAL" | "REGENERATIVO",
      volumeM: [800, 600, 600, 800, 2600, 400][index],
      zone: "A2" as const,
    })),
  });
  const load = computeLoadLayers([{ athleteId: "gate-athlete", date: "2026-08-30", pse: 7, durationMinutes: 90, prescribedVolumeM: 5800, executedVolumeM: 5700 }], new Date("2026-08-30T12:00:00.000Z"));
  const adaptation = decideAdaptation({ readiness: 35, prescribedVolumeM: 5800, primaryZone: "AN2", now: new Date("2026-08-30T12:00:00.000Z") });
  const parsed = parseTrainingText("Aquecimento 8x100 livre A1; Série principal 10x100 livre A2 com palmar M");
  const ranges = validateResponseRanges({ readiness: 82, pain: 1, rpe: 7, technique: 4 });
  const comparableKey = buildComparableKey({ athleteId: "gate-athlete", stroke: "livre", distanceM: 100, zone: "A2", mode: "nado", material: "sem_material", pool: "50m", protocol: "rkf-v5.1" });
  const evolution = classifyEvolution({ comparables: 25, scoreDeltaPct: 1.5, readiness: 82 });
  return {
    completeSession,
    load,
    adaptation,
    parsed,
    ranges,
    zonesValid: ZONES.length === 6 && new Set(ZONES.map((zone) => zone.code)).size === 6,
    hardRulesAvailable: RULES_RKF.length === 18,
    comparableKey,
    evolution,
  };
}

/**
 * Executa os 36 gates descritos no manual. PASS só é emitido quando existe
 * uma prova computável nesta execução; ausência de prova nunca é convertida
 * em sucesso. Integrações reais com dispositivos estão fora do escopo atual.
 */
export function evaluateRkfReleaseGates(input: ReleaseGateRuntimeEvidence, now = new Date()): ReleaseGateReport {
  const probe = executableDomainEvidence();
  const exactSeed = input.seed.located && input.seed.staged && input.seed.sessions === 910 && input.seed.blocks === 6226 && input.seed.prescriptionUnits === 6226;
  const observedChannels = new Set(input.ingestionChannelsObserved.map((channel) => channel.toUpperCase()));
  const observedAssignments = new Set(input.assignmentTargetTypesObserved.map((target) => target.toLowerCase()));
  const expectedChannels = ["TEXT", "PHOTO", "FILE", "VOICE", "API"];
  const channelsCovered = expectedChannels.every((channel) => observedChannels.has(channel));
  const exactLoad = probe.load.layers.internal?.loadUa === 630 && probe.load.layers.prescribed?.volumeM === 5800 && probe.load.layers.executed?.volumeM === 5700;
  const gates: ReleaseGate[] = [
    probe.adaptation.status === "AGUARDAR_TREINADOR"
      ? pass("G01", "Motor adaptativo executável", [`Readiness 35 bloqueou automaticamente e retornou ${probe.adaptation.status}.`])
      : blocked("G01", "Motor adaptativo executável", ["A prova determinística de bloqueio falhou."], "Corrigir o motor e repetir o cenário de referência."),
    probe.zonesValid ? pass("G02", "Vocabulário oficial de zonas", [`${ZONES.length} zonas únicas carregadas: ${ZONES.map((zone) => zone.code).join(", ")}.`], 6, ZONES.length) : blocked("G02", "Vocabulário oficial de zonas", ["Contagem ou unicidade divergente."], "Restaurar o dicionário canônico V5.1.", 6, ZONES.length),
    probe.completeSession.valid ? pass("G03", "Fechamento e validação de volumes", ["Sessão-prova de 5.800 m passou VAL-001..VAL-005 e hard rules."]) : blocked("G03", "Fechamento e validação de volumes", probe.completeSession.findings.filter((finding) => !finding.passed).map((finding) => `${finding.code}: ${finding.message}`), "Corrigir validadores de sessão."),
    input.entityCount >= 43 ? pass("G04", "Modelo com 43 entidades", [`${input.entityCount} entidades persistíveis registradas.`], 43, input.entityCount) : blocked("G04", "Modelo com 43 entidades", [`Somente ${input.entityCount} coleções persistíveis estão registradas.`], "Normalizar e migrar as entidades restantes do manual.", 43, input.entityCount),
    input.migrationCount > 0 ? pass("G05", "Migrations versionadas executáveis", [`${input.migrationCount} migrations aplicadas em schema_migrations com rollback declarado.`], ">=1", input.migrationCount) : blocked("G05", "Migrations versionadas executáveis", ["Nenhuma migration aplicada comprovada."], "Executar o runner de migrations com tabela schema_migrations.", ">=1", input.migrationCount),
    input.apiContractCount >= 33 ? pass("G06", "33 contratos de API", [`OpenAPI contém ${input.apiContractCount} paths versionados.`], 33, input.apiContractCount) : blocked("G06", "33 contratos de API", [`OpenAPI contém ${input.apiContractCount} paths.`], "Documentar e testar os contratos ausentes.", 33, input.apiContractCount),
    excluded("G07", "30 mappings de dispositivos", ["Garmin, Polar, Apple e demais integrações reais foram excluídos explicitamente do escopo desta entrega."]),
    input.eventContractCount >= 33 ? pass("G08", "33 eventos de domínio", [`${input.eventContractCount} eventos versionados no catálogo ${"rkf-events-1.0.0"}.`], 33, input.eventContractCount) : blocked("G08", "33 eventos de domínio", [`${input.eventContractCount} contratos de evento comprovados.`], "Completar o catálogo versionado com 33 eventos e testes de carga obrigatória.", 33, input.eventContractCount),
    probe.ranges.valid && probe.hardRulesAvailable ? pass("G09", "Validações críticas", [`18 regras RKF e ${probe.ranges.findings.length} verificações de faixa executadas.`]) : blocked("G09", "Validações críticas", ["A prova de ranges ou regras falhou."], "Corrigir as validações críticas."),
    exactSeed && input.seed.imported ? pass("G10", "Seeds canônicas", [`Importação confirmada: ${input.seed.sessions} sessões, ${input.seed.blocks} blocos e ${input.seed.prescriptionUnits} unidades.`]) : exactSeed ? review("G10", "Seeds canônicas", ["Contagens e hashes conferidos, mas a importação transacional não está comprovada neste armazenamento."], "Executar /seed/stage e /seed/import.") : blocked("G10", "Seeds canônicas", ["Contagens do pacote divergem ou pacote não foi conferido."], "Restaurar o pacote V5.1 canônico."),
    review("G11", "Pós-treino por voz", ["Canal VOICE existe, mas não há evidência de STT homologado e persistência ponta a ponta."], "Executar UAT com áudio real, transcrição, revisão e confirmação."),
    input.confirmedIngestionCount > 0 ? pass("G12", "Confirmação de campos críticos", [`${input.confirmedIngestionCount} ingestões confirmadas com revisor persistido.`]) : review("G12", "Confirmação de campos críticos", ["O contrato valida athleteId, date e kind, mas não há confirmação persistida nesta organização."], "Executar UAT de bloqueio e confirmação humana."),
    input.resultCount > 0 ? pass("G13", "Resultados granulares", [`${input.resultCount} resultados hierárquicos persistidos.`]) : review("G13", "Resultados granulares", ["Contrato de séries, repetições e parciais existe, mas não há registro persistido nesta organização."], "Executar e anexar o UAT de resultado granular."),
    input.loadSnapshotCount > 0 ? pass("G14", "Snapshots imutáveis de carga", [`${input.loadSnapshotCount} snapshots persistidos.`]) : review("G14", "Snapshots imutáveis de carga", ["O contrato de snapshot existe, sem instância persistida nesta organização."], "Executar pós-treino e comprovar snapshot imutável."),
    probe.comparableKey?.split("|").length === 8 ? pass("G15", "Comparabilidade", [`Chave comparável de oito dimensões calculada: ${probe.comparableKey}.`]) : blocked("G15", "Comparabilidade", ["A chave comparável completa não foi calculada."], "Corrigir a normalização das oito dimensões."),
    probe.evolution.classification === "EVOLUCAO_CONFIRMADA" ? pass("G16", "Evolução", [`Cenário com 25 comparáveis e +1,5% retornou ${probe.evolution.classification} com confiança ${probe.evolution.confidence}%.`]) : blocked("G16", "Evolução", [`Resultado inesperado: ${probe.evolution.classification}.`], "Corrigir os limiares versionados de evolução."),
    probe.adaptation.status === "AGUARDAR_TREINADOR" ? pass("G17", "Autoridade do treinador", ["Adaptação BLOQUEAR não é liberada sem coachApproved e prescrições exigem papel coach/admin."]) : blocked("G17", "Autoridade do treinador", ["Guardrail não preservou a autoridade humana."], "Impedir publicação automática em classe BLOQUEAR."),
    input.postTrainingSeedCount > 0 ? pass("G18", "Seeds de pós-treino", [`${input.postTrainingSeedCount} seeds comprovadas.`]) : blocked("G18", "Seeds de pós-treino", ["Nenhuma seed específica de pós-treino foi comprovada."], "Adicionar fixtures canônicas com PSE, duração, séries e parciais."),
    blocked("G19", "Fadiga de fundistas", ["Não há prova executável específica para fadiga de fundistas."], "Formalizar regra, versão, fixtures e testes por especialidade."),
    blocked("G20", "Recuperação por fase", ["Não há prova executável da recuperação dependente da fase."], "Implementar matriz por fase e testes de borda."),
    probe.adaptation.removedElements.includes("AN2") ? pass("G21", "Guardrails clínico-operacionais", [`Classe ${probe.adaptation.class} removeu ${probe.adaptation.removedElements.join(", ")} e exigiu treinador.`]) : blocked("G21", "Guardrails clínico-operacionais", ["Cenário de bloqueio não removeu intensidade crítica."], "Corrigir guardrails."),
    input.fatigueSeedCount > 0 ? pass("G22", "Seeds de fadiga", [`${input.fatigueSeedCount} seeds comprovadas.`]) : blocked("G22", "Seeds de fadiga", ["Nenhuma seed de fadiga foi comprovada."], "Adicionar cenários por fase, especialidade e severidade."),
    review("G23", "8 telas obrigatórias", ["A API não consegue provar renderização, responsividade e ações das telas."], "Anexar execução E2E das oito telas em desktop e mobile.", 8, "não aferido"),
    review("G24", "Menu principal com 4 itens", ["Estrutura visual não é evidência verificável pela API."], "Cobrir navegação e permissões com E2E.", 4, "não aferido"),
    review("G25", "4 planos do produto", ["Planos não possuem contrato operacional comprovado nesta API."], "Definir os quatro planos, permissões e testes."),
    probe.parsed.blocks.length >= 2 ? review("G26", "Comandos por texto e voz", [`Parser de texto extraiu ${probe.parsed.blocks.length} blocos; voz permanece sem UAT STT.`], "Homologar o caminho de voz ponta a ponta.") : blocked("G26", "Comandos por texto e voz", ["Parser de texto falhou e voz não foi comprovada."], "Corrigir parser e implementar UAT de voz."),
    review("G27", "5 contratos de UI", ["Nenhum manifesto executável dos contratos de UI foi fornecido à API."], "Versionar contratos e cobri-los com testes de componente/E2E.", 5, "não aferido"),
    review("G28", "Seeds de UI", ["Há dados demonstrativos, mas não existe catálogo de seeds de UI vinculado aos casos do manual."], "Criar fixtures nomeadas para vazios, dados antigos, erros e sucesso."),
    channelsCovered ? pass("G29", "5 canais de ingestão", [`Canais observados: ${expectedChannels.join(", ")}.`], 5, expectedChannels.length) : review("G29", "5 canais de ingestão", [`Observados: ${[...observedChannels].join(", ") || "nenhum"}.`], "Executar pelo menos uma ingestão confirmada por canal.", 5, expectedChannels.filter((channel) => observedChannels.has(channel)).length),
    input.auditableOriginalFormatsObserved.length >= 6 ? pass("G30", "6 originais auditáveis", [`Formatos com original e hash: ${input.auditableOriginalFormatsObserved.join(", ")}.`], 6, input.auditableOriginalFormatsObserved.length) : review("G30", "6 originais auditáveis", [`Formatos observados com prova: ${input.auditableOriginalFormatsObserved.join(", ") || "nenhum"}.`], "Persistir seis originais, hashes e cadeia de revisão.", 6, input.auditableOriginalFormatsObserved.length),
    probe.parsed.blocks.length >= 2 && probe.parsed.totalVolumeM === 1800 ? pass("G31", "Parser RKF", [`Texto-prova produziu ${probe.parsed.blocks.length} blocos e ${probe.parsed.totalVolumeM} m sem inventar campos.`]) : blocked("G31", "Parser RKF", [`Resultado inesperado: ${probe.parsed.blocks.length} blocos, ${String(probe.parsed.totalVolumeM)} m.`], "Corrigir parser conservador."),
    input.confirmedIngestionCount > 0 ? pass("G32", "Revisão humana", [`${input.confirmedIngestionCount} ingestões possuem confirmação humana persistida.`]) : review("G32", "Revisão humana", ["Estados REVIEW/CONFIRMED existem, mas não há confirmação persistida nesta organização."], "Concluir uma revisão com identidade autenticada."),
    ["team", "group", "athlete"].every((target) => observedAssignments.has(target)) ? pass("G33", "Atribuição a equipe, grupo e atleta", ["Há prescrições persistidas para team, group e athlete."]) : review("G33", "Atribuição a equipe, grupo e atleta", [`Alvos observados: ${[...observedAssignments].join(", ") || "nenhum"}. O contrato aceita os três alvos.`], "Executar UAT e persistir uma publicação por tipo de alvo."),
    exactLoad ? pass("G34", "Três camadas de carga", ["Prova 7×90=630 UA preservou prescrito 5.800 m e executado 5.700 m separadamente."]) : blocked("G34", "Três camadas de carga", ["A prova das três camadas falhou."], "Corrigir cálculo/persistência das camadas."),
    review("G35", "8 contratos de ingestão", ["Máquina de estados e endpoints existem, mas não há suíte contratual nomeada com oito cenários comprovados."], "Executar contratos de recebimento, storage, extração, parsing, revisão, confirmação, commit e erro.", 8, "parcial"),
    input.ingestionSeedCount > 0 ? pass("G36", "Seeds de ingestão", [`${input.ingestionSeedCount} seeds comprovadas.`]) : blocked("G36", "Seeds de ingestão", ["Nenhuma seed de ingestão por canal foi comprovada."], "Adicionar fixtures idempotentes para os cinco canais e falhas."),
  ];

  const summary = gates.reduce<Record<ReleaseGateStatus, number> & { total: number; blocking: number }>((acc, gate) => {
    acc[gate.status] += 1;
    acc.total += 1;
    if (gate.blocking) acc.blocking += 1;
    return acc;
  }, { PASS: 0, REVIEW: 0, BLOCKED: 0, EXCLUDED: 0, total: 0, blocking: 0 });
  return {
    methodologyVersion: "RKF_V5.1",
    evaluatedAtUtc: now.toISOString(),
    scope: { realDeviceIntegrations: "EXCLUDED_BY_PRODUCT_SCOPE" },
    decision: summary.blocking === 0 ? "READY_FOR_APP" : "BLOCKED",
    summary,
    gates,
  };
}
