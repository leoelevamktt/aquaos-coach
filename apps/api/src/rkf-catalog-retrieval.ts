import { rankCatalogRows, tokenizeForSearch } from "./rkf-catalog-store.js";
import type { CatalogRow } from "./rkf-catalog-store.js";

/**
 * Retrieval do Catálogo Mestre RKF para o POST /api/v1/ai/chat.
 *
 * Princípios:
 * - Contexto LIMITADO: no máximo `maxContextRows` linhas relevantes entram no
 *   prompt (nunca o catálogo inteiro).
 * - Apenas registros explicitamente Confirmados/Validados/Concluídos são
 *   descritos como canônicos; ausência de validação também é não canônica.
 * - Apenas coach/admin chegam aqui (a rota de chat já filtra).
 */

export const catalogSearchConfig = {
  maxLimit: 500,
  /** Máximo de linhas do catálogo injetadas no contexto do LLM. */
  maxContextRows: 12,
  /** Tamanho máximo, em caracteres, do resumo de cada linha no prompt. */
  maxRowChars: 480,
  /** Termos de status que marcam a linha como não canônica. */
  nonCanonicalTokens: ["rascunho", "pendente", "pendência", "duvida", "dúvida", "revisar", "revisão", "nao validado", "não validado"],
};

export function isNonCanonical(row: CatalogRow): boolean {
  if (row.payload.sourceCellError === true) return true;
  const status = normalize(row.status);
  if (catalogSearchConfig.nonCanonicalTokens.some((token) => status.includes(normalize(token)))) return true;
  return !/(^|\s)(validado|confirmado|concluido)(\s|$)/.test(status);
}

/**
 * Ranking de relevância multi-aba: termos específicos podem casar em linhas
 * diferentes; linhas que casam mais termos recebem prioridade.
 */
export function rankCatalogRowsForRetrieval(rows: CatalogRow[], query: string): Array<{ row: CatalogRow; score: number }> {
  return rankCatalogRows(rows, query);
}

export function searchCatalogForQuestion(store: { searchAcrossSheets(organizationId: string, q: string, maxRows: number): CatalogRow[] }, organizationId: string, question: string, maxRows = catalogSearchConfig.maxContextRows): CatalogRow[] {
  const trimmed = question.trim();
  if (trimmed.length < 2) return [];
  return store.searchAcrossSheets(organizationId, trimmed, maxRows);
}

/** Contexto textual do catálogo para o prompt do LLM. */
export function buildRkfCatalogContext(rows: CatalogRow[], question: string, source: { version: number; packageHash: string }): string {
  if (!rows.length) return "";
  const lines = [
    `=== CATÁLOGO MESTRE RKF (trechos relevantes para a pergunta: "${question.slice(0, 160)}") ===`,
    `Origem: importação versão ${source.version} · hash da importação: ${source.packageHash}. Dados de acervo/histórico; somente registros explicitamente validados, confirmados ou concluídos podem ser tratados como canônicos.`,
  ];
  let used = 0;
  for (const row of rows) {
    if (used >= catalogSearchConfig.maxContextRows) break;
    const nonCanonical = isNonCanonical(row);
    const sourceCellError = row.payload.sourceCellError === true;
    const payloadSummary = Object.entries(row.payload)
      .filter(([key, value]) => !["sourceCellError", "sourceErrorCells"].includes(key) && String(value ?? "").trim() && !/^#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NULL!|NUM!)$/i.test(String(value).trim()))
      .slice(0, 8)
      .map(([key, value]) => `${key}=${String(value).slice(0, 80)}`)
      .join(" | ")
      .slice(0, catalogSearchConfig.maxRowChars);
    const evidence = sourceCellError ? `${payloadSummary}${payloadSummary ? " | " : ""}[célula de origem inválida omitida]` : payloadSummary;
    lines.push(`[${nonCanonical ? "NÃO CANÔNICO" : "CANÔNICO"}] ${row.sheet} · ${row.id} · ${row.name}${row.status ? ` (status: ${row.status})` : ""}\n  ${evidence}`);
    used += 1;
  }
  if (rows.length > used) lines.push(`(+${rows.length - used} linhas relevantes omitidas por limite de contexto)`);
  return lines.join("\n");
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export { tokenizeForSearch };
