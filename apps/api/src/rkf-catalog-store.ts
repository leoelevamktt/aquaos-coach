import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { PostgresPersistence } from "./postgres-persistence.js";

/**
 * Catálogo Mestre RKF: importação e consulta.
 *
 * Arquitetura (decisão do manual de importação):
 * - O catálogo (~75 mil linhas) NUNCA entra em ManagedStore.resources /
 *   managed_resources: save() regrava snapshots inteiros e o custo por write
 *   seria proibitivo. A importação usa rkf_seed_imports/rkf_seed_rows (já
 *   presentes e idempotentes) e, no modo arquivo, um sidecar comprimido por
 *   organização (rkf-catalog-<org>.json.gz).
 * - O XLSX nunca é parseado em runtime: o artefato pré-processado e comprimido
 *   (data/rkf/catalogo-mestre/v1/catalog-v1.json.gz) é gerado por
 *   scripts/build-rkf-catalog-artifact.mjs e versionado no repositório.
 * - Idempotência por organizationId + version + packageHash.
 * - Linhas com erros de fórmula da planilha de origem (#REF!, #VALUE!...) são
 *   preservadas literalmente no payload e sinalizadas (sourceCellError),
 *   nunca descartadas nem "corrigidas".
 */

export type CatalogManifest = {
  artifact: string;
  version: number;
  sourceFile: string;
  sourceSha256: string;
  sourceBytes: number;
  generatedAt: string;
  headerRow: number;
  sheetCount: number;
  rows: Record<string, number>;
  sheetSha256: Record<string, string>;
  packageHash: string;
  sourceCellErrors: Array<{ sheet: string; cell: string; value: string }>;
};

export type CatalogSheetData = { columns: string[]; rows: string[][]; search: string };
export type RkfCatalogArtifact = { manifest: CatalogManifest; sheets: Record<string, CatalogSheetData> };

export type CatalogRow = {
  id: string;
  sheet: string;
  name: string;
  status: string;
  payload: Record<string, unknown>;
};

export type CatalogQueryResult = {
  data: CatalogRow[];
  total: number;
  offset: number;
  limit: number;
  sheets: Array<{ name: string; rows: number }>;
  source: { version: number; packageHash: string; importedAt: string };
};

/** Metadados de autorização/importação por organização; as linhas do pacote são imutáveis e compartilhadas. */
type OrgCatalog = { importId: string; importedAt: string };

/** Artefato canônico embarcado (data/rkf/catalogo-mestre/v1/catalog-v1.json.gz). */
export function loadBundledArtifact(artifactPath?: string): RkfCatalogArtifact {
  const target = artifactPath
    ?? process.env.RKF_CATALOG_ARTIFACT
    ?? new URL("../../../data/rkf/catalogo-mestre/v1/catalog-v1.json.gz", import.meta.url).pathname
      .replace(/^\/([A-Za-z]:)/, "$1"); // pathname do file URL no Windows: /C:/... -> C:/...
  const raw = gunzipSync(readFileSync(target));
  return JSON.parse(raw.toString("utf8")) as RkfCatalogArtifact;
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type CatalogPersistence = Pick<PostgresPersistence, "getRkfSeedImportStatus" | "importRkfColumnarSeed">;

export class RkfCatalogStore {
  private readonly root: string;
  private readonly artifact: RkfCatalogArtifact;
  private readonly errorCellsByRow = new Map<string, string[]>();
  private readonly catalogs = new Map<string, OrgCatalog>();
  private postgres?: CatalogPersistence;

  constructor(sidecarRoot: string, artifact: RkfCatalogArtifact, options: { postgres?: CatalogPersistence } = {}) {
    this.root = sidecarRoot;
    this.artifact = artifact;
    for (const error of artifact.manifest.sourceCellErrors ?? []) {
      const rowNumber = error.cell.match(/\d+$/)?.[0];
      if (!rowNumber) continue;
      const key = `${error.sheet}:${rowNumber}`;
      this.errorCellsByRow.set(key, [...(this.errorCellsByRow.get(key) ?? []), error.cell]);
    }
    this.postgres = options.postgres;
  }

  static fromBundledArtifact(sidecarRoot: string, artifactPath?: string, options: { postgres?: CatalogPersistence } = {}) {
    return new RkfCatalogStore(sidecarRoot, loadBundledArtifact(artifactPath), options);
  }

  get manifest(): CatalogManifest { return this.artifact.manifest; }

  /**
   * Importação transacional e idempotente. Retorna imported=false quando o
   * mesmo organizationId+version+packageHash já foi importado.
   */
  async import(input: { organizationId: string; actorId: string }): Promise<{ imported: boolean; importId: string; rows: number }> {
    const { organizationId, actorId } = input;
    const { version, packageHash } = this.artifact.manifest;
    // Verificação de integridade: cada aba precisa casar com hash e contagem declarados.
    for (const [sheet, data] of Object.entries(this.artifact.sheets)) {
      const expectedHash = this.artifact.manifest.sheetSha256[sheet];
      const expectedRows = this.artifact.manifest.rows[sheet];
      if (expectedHash && hashValue(data) !== expectedHash) throw new Error(`Falha de integridade do catálogo na aba ${sheet}`);
      if (expectedRows !== undefined && data.rows.length !== expectedRows) throw new Error(`Contagem divergente do catálogo na aba ${sheet}`);
      if (searchRowCount(data.search, data.rows.length) !== data.rows.length) throw new Error(`Índice de busca divergente na aba ${sheet}`);
    }
    const totalRows = Object.values(this.artifact.sheets).reduce((sum, data) => sum + data.rows.length, 0);
    if (this.postgres) {
      const versionKey = `catalogo-mestre-v${version}`;
      const importId = this.importIdFor(organizationId);
      const existing = await this.postgres.getRkfSeedImportStatus(organizationId, versionKey, packageHash);
      if (existing) {
        this.catalogs.set(organizationId, this.buildOrgCatalog(importId, existing.importedAt));
        return { imported: false, importId, rows: totalRows };
      }
      const imported = await this.postgres.importRkfColumnarSeed({
        id: importId,
        version: versionKey,
        packageHash,
        manifest: { ...this.artifact.manifest, importedBy: actorId },
        files: Object.entries(this.artifact.sheets).map(([name, data]) => ({ name, sha256: this.artifact.manifest.sheetSha256[name] ?? hashValue(data), columns: data.columns, rows: data.rows })),
        importedBy: actorId,
        organizationId,
      });
      const status = await this.postgres.getRkfSeedImportStatus(organizationId, versionKey, packageHash);
      const importedAt = status?.importedAt ?? new Date().toISOString();
      this.catalogs.set(organizationId, this.buildOrgCatalog(imported.importId, importedAt));
      return { imported: true, importId: imported.importId, rows: totalRows };
    }
    // Modo arquivo: sidecar comprimido por organização, escrito atomicamente.
    const directory = resolve(this.root, organizationId.replace(/[^a-zA-Z0-9_-]+/g, "_"));
    mkdirSync(directory, { recursive: true });
    const target = join(directory, `catalog-v${version}-${packageHash.slice(0, 12)}.json.gz`);
    const importId = this.importIdFor(organizationId);
    let importedAt = new Date().toISOString();
    let alreadyImported = false;
    if (existsSync(target)) {
      const existing = JSON.parse(gunzipSync(readFileSync(target)).toString("utf8")) as { importId: string; importedAt: string };
      alreadyImported = existing.importId === importId;
      importedAt = existing.importedAt;
    }
    if (!alreadyImported) {
      const payload = {
        organizationId, version, packageHash, importId,
        importedAt, importedBy: actorId,
        rows: this.artifact.manifest.rows,
      };
      const temporary = `${target}.tmp-${process.pid}`;
      writeGzipAtomic(temporary, payload);
      renameSync(temporary, target);
    }
    this.catalogs.set(organizationId, this.buildOrgCatalog(importId, importedAt));
    return { imported: !alreadyImported, importId, rows: totalRows };
  }

  private importIdFor(organizationId: string) {
    return createHash("sha256").update(`${organizationId}|${this.artifact.manifest.version}|${this.artifact.manifest.packageHash}`).digest("hex").slice(0, 32);
  }

  private buildOrgCatalog(importId: string, importedAt: string): OrgCatalog {
    return { importId, importedAt };
  }

  private rowAt(sheet: string, index: number): CatalogRow {
    const data = this.artifact.sheets[sheet];
    const values = data.rows[index] ?? [];
    const entry = Object.fromEntries(data.columns.map((column, columnIndex) => [column, values[columnIndex] ?? ""])) as Record<string, string>;
    const sourceErrorCells = this.errorCellsByRow.get(`${sheet}:${index + this.artifact.manifest.headerRow + 1}`) ?? [];
    return {
      id: identifierFor(sheet, entry),
      sheet,
      name: displayName(sheet, entry),
      status: statusFor(entry),
      payload: sourceErrorCells.length ? { ...entry, sourceCellError: true, sourceErrorCells } : entry,
    };
  }

  private totalRows() {
    return Object.values(this.artifact.sheets).reduce((sum, data) => sum + data.rows.length, 0);
  }

  /** Estado da importação de uma organização (undefined se nunca importado). */
  status(organizationId: string): { version: number; packageHash: string; importedAt: string; rows: number } | undefined {
    const current = this.catalogs.get(organizationId);
    if (current) return { version: this.artifact.manifest.version, packageHash: this.artifact.manifest.packageHash, importedAt: current.importedAt, rows: this.totalRows() };
    // modo arquivo: tenta reler o sidecar existente
    const directory = resolve(this.root, organizationId.replace(/[^a-zA-Z0-9_-]+/g, "_"));
    const target = join(directory, `catalog-v${this.artifact.manifest.version}-${this.artifact.manifest.packageHash.slice(0, 12)}.json.gz`);
    if (!existsSync(target)) return undefined;
    const sidecar = JSON.parse(gunzipSync(readFileSync(target)).toString("utf8")) as { importId: string; importedAt: string };
    const org = this.buildOrgCatalog(sidecar.importId, sidecar.importedAt);
    this.catalogs.set(organizationId, org);
    return { version: this.artifact.manifest.version, packageHash: this.artifact.manifest.packageHash, importedAt: sidecar.importedAt, rows: this.totalRows() };
  }

  ensureImported(organizationId: string) {
    if (!this.catalogs.has(organizationId)) this.status(organizationId);
  }

  query(organizationId: string, params: { sheet: string; q?: string; offset?: number; limit?: number }): CatalogQueryResult {
    this.ensureImported(organizationId);
    const current = this.catalogs.get(organizationId);
    if (!current) throw new Error(`Catálogo ainda não importado para a organização ${organizationId}`);
    const sheetNames = Object.keys(this.artifact.sheets);
    if (!sheetNames.includes(params.sheet)) throw new Error(`Aba desconhecida: ${params.sheet}. Válidas: ${sheetNames.join(", ")}`);
    const limit = Math.max(1, Math.min(500, Math.floor(params.limit ?? 100)));
    const offset = Math.max(0, Math.floor(params.offset ?? 0));
    const sheetData = this.artifact.sheets[params.sheet];
    const terms = tokenizeForSearch(params.q ?? "");
    let total = sheetData.rows.length;
    let indices: number[];
    if (terms.length) {
      const ranked = rankSearchBlob(sheetData.search, sheetData.rows.length, terms);
      total = ranked.length;
      indices = ranked.slice(offset, offset + limit).map(({ index }) => index);
    } else {
      indices = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => offset + index);
    }
    return {
      data: indices.map((index) => this.rowAt(params.sheet, index)),
      total,
      offset,
      limit,
      sheets: sheetNames.map((name) => ({ name, rows: this.artifact.manifest.rows[name] ?? this.artifact.sheets[name].rows.length })),
      source: { version: this.artifact.manifest.version, packageHash: this.artifact.manifest.packageHash, importedAt: current.importedAt },
    };
  }

  /** Busca textual multi-aba para o retrieval da IA (multi-tenant). */
  searchAcrossSheets(organizationId: string, q: string, maxRows: number): CatalogRow[] {
    this.ensureImported(organizationId);
    const current = this.catalogs.get(organizationId);
    if (!current) return [];
    const terms = tokenizeForSearch(q);
    if (!terms.length) return [];
    const ranked: Array<{ sheet: string; index: number; score: number }> = [];
    for (const [sheet, data] of Object.entries(this.artifact.sheets)) {
      for (const { index, score } of rankSearchBlob(data.search, data.rows.length, terms)) ranked.push({ sheet, index, score });
    }
    return ranked.sort((left, right) => right.score - left.score || left.index - right.index).slice(0, Math.max(1, maxRows)).map(({ sheet, index }) => this.rowAt(sheet, index));
  }

  /** IDs de organizações com catálogo carregado (uso interno/testes). */
  loadedOrganizations(): string[] { return [...this.catalogs.keys()]; }

  /** Contagem de células de erro de origem (evidência no /source da UI). */
  sourceCellErrors(): Array<{ sheet: string; cell: string; value: string }> {
    return this.artifact.manifest.sourceCellErrors ?? [];
  }
}

// ---------------------------------------------------------------------------
// Utilidades de identificação e busca
// ---------------------------------------------------------------------------

function identifierFor(sheet: string, entry: Record<string, string>): string {
  const firstKey = Object.keys(entry)[0];
  if (firstKey?.startsWith("ID_") && entry[firstKey]) return String(entry[firstKey]);
  const candidates = ["ID_Prova_Atleta", "ID_Sessão_Atleta", "ID_Indexação", "ID_Transcrição", "ID_Atleta", "ID_Prova", "ID_Documento", "ID_Sessão", "ID_Sessao", "ID_Sessao_Atleta", "ID_Componente", "ID_Entrada", "ID_Perfil", "ID_Referência", "ID_Texto", "ID_Pendência", "ID_Evento", "ID"];
  for (const key of candidates) if (entry[key]) return String(entry[key]);
  return `${sheet}-${hashValue([entry]).slice(0, 12)}`;
}

function displayName(sheet: string, entry: Record<string, string>): string {
  const candidates = ["Nome_Completo", "Nome_Atleta", "Nome_Curto_no_Documento", "Arquivo_Original", "Nome_Referência", "Objetivo_Principal", "Texto_Normalizado", "Texto_Normalizado_Seguro", "Texto_Original_Literal", "Termo", "Valor_Canônico", "Métrica", "Nome_do_Atleta", "Titulo", "Título", "Nome_Sessão", "Nome_Sessao", "Descricao", "Descrição", "Categoria", "Valor", "Conteudo_Resumido", "Conteúdo_Resumido", "Texto_Literal", "Resumo", "Nome_Arquivo", "Nome", "Observacao", "Observação", "Tipo", "Prova", "Perfil", "Regra", "Referencia"];
  for (const key of candidates) if (entry[key]) return String(entry[key]);
  const first = Object.values(entry).find((value) => value && value.length > 2);
  return first ? String(first).slice(0, 120) : sheet;
}

function statusFor(entry: Record<string, string>): string {
  const candidates = ["Status_Validação", "Status_Validacao", "Status_Revisão", "Status_Revisao", "Status_Cadastro", "Status", "Status_Execucao", "Status_Execução", "Status_Consolidacao", "Status_Consolidação", "Status_Auditoria", "Status_da_Pendencia", "Status_da_Pendência", "Status_Conferencia", "Natureza_Registro"];
  for (const key of candidates) if (entry[key]) return String(entry[key]);
  return "";
}

function writeGzipAtomic(target: string, payload: unknown) {
  writeFileSync(target, gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 1 }));
}

/** Tokenização para busca: minúsculas, sem acento, stopwords descartadas. */
export function tokenizeForSearch(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term));
}

const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "a", "o", "e", "em", "no", "na", "com", "para", "por", "que", "um", "uma", "os", "as", "ao", "aos", "se", "ou", "qual", "quais", "quero", "preciso", "recomende", "recomendar", "sugira", "sobre", "treino", "treinos", "sessao", "sessoes", "atleta"]);

function searchRowCount(blob: string, expectedRows: number) {
  if (expectedRows === 0) return blob ? 1 : 0;
  let count = 1;
  for (let index = 0; index < blob.length; index += 1) if (blob.charCodeAt(index) === 0) count += 1;
  return count;
}

function rankSearchBlob(blob: string, rowCount: number, terms: string[]) {
  const ranked: Array<{ index: number; score: number }> = [];
  let start = 0;
  for (let index = 0; index < rowCount; index += 1) {
    const separator = index === rowCount - 1 ? blob.length : blob.indexOf("\u0000", start);
    const end = separator < 0 ? blob.length : separator;
    const score = scoreSearchText(blob.slice(start, end), terms);
    if (score > 0) ranked.push({ index, score });
    start = end + 1;
  }
  return ranked.sort((left, right) => right.score - left.score || left.index - right.index);
}

function scoreSearchText(text: string, terms: string[]) {
  let matched = 0;
  for (const term of terms) if (text.includes(term)) matched += 1;
  return matched ? matched * 2 + (matched === terms.length ? 4 : 0) : 0;
}

/** Ranking de relevância: nome > primeiro campo > demais campos. */
export function rankCatalogRows(rows: CatalogRow[], query: string): Array<{ row: CatalogRow; score: number }> {
  const terms = tokenizeForSearch(query);
  if (!terms.length) return [];
  const ranked: Array<{ row: CatalogRow; score: number }> = [];
  for (const row of rows) {
    const nameLower = normalize(row.name);
    const payloadValues = Object.entries(row.payload).filter(([key]) => !["sourceCellError", "sourceErrorCells"].includes(key));
    let score = 0;
    let matchedTerms = 0;
    for (const term of terms) {
      if (nameLower.includes(term)) { score += 6; matchedTerms += 1; continue; }
      const exactField = payloadValues.find(([key]) => normalize(key).includes(term));
      if (exactField) { score += 2; matchedTerms += 1; continue; }
      const valueHit = payloadValues.some(([, value]) => normalize(String(value ?? "")).includes(term));
      if (valueHit) { score += 1; matchedTerms += 1; }
    }
    if (matchedTerms > 0) ranked.push({ row, score: score + matchedTerms * 2 + (matchedTerms === terms.length ? 4 : 0) });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
