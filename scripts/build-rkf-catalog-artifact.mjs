import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { resolve } from "node:path";

/**
 * Pré-processa o XLSX "Catálogo Mestre de Treinos — RKF v1" no artefato comprimido
 * versionado consumido pela API (data/rkf/catalogo-mestre/v1/catalog-v1.json.gz).
 *
 * - Header de dados na linha 5 das abas de tabela (validado contra tmp/incoming).
 * - Converte cada aba em array de objetos (header -> valor de texto preservado).
 * - Valida contagens esperadas por aba e preserva/sinaliza células de erro (#REF!, #VALUE!, ...).
 * - Grava manifest.json (com hashes por aba + packageHash) e o artefato gzipado.
 *
 * Uso: node scripts/build-rkf-catalog-artifact.mjs
 */
const sourcePath = process.argv[2] ?? resolve("data/rkf/catalogo-mestre/v1/catalogo-mestre-rkf-v1.xlsx");
const outDir = resolve("data/rkf/catalogo-mestre/v1");
const version = Number(process.argv[3] ?? 1);

const SHEETS = [
  "ATLETAS", "PROVAS_ATLETA", "DOCUMENTOS", "SESSOES", "SESSAO_ATLETAS", "COMPONENTES",
  "INDICE_CONSULTA", "DICIONARIOS", "TRANSCRICAO_PERFIS", "REFERENCIAS_ACERVO",
  "TRANSCRICAO_TREINOS", "PENDENCIAS_AUDITORIA", "AUDITORIA_IMPORTACAO",
];
const HEADER_ROW = 5;
const EXPECTED_ROWS = {
  ATLETAS: 39, PROVAS_ATLETA: 74, DOCUMENTOS: 1364, SESSOES: 4171, SESSAO_ATLETAS: 3102,
  COMPONENTES: 49835, INDICE_CONSULTA: 4810, DICIONARIOS: 165, TRANSCRICAO_PERFIS: 49,
  REFERENCIAS_ACERVO: 13, TRANSCRICAO_TREINOS: 17478, PENDENCIAS_AUDITORIA: 222,
  AUDITORIA_IMPORTACAO: 11,
};
const ERROR_CELL = /^#(REF|VALUE|DIV\/0|N\/A|NAME\?|NULL|NUM)([!?])?$/i;
const sourceCellErrors = [];

function recordError(sheet, cell, value) {
  sourceCellErrors.push({ sheet, cell, value });
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result); // fórmula
    if (typeof value.richText === "object" && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if (typeof value.text === "string") return value.text; // hyperlink
    if (typeof value.error === "string") return `#${value.error}`;
    return String(value);
  }
  return String(value);
}

function normalizeSearch(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const sourceBuffer = readFileSync(resolve(sourcePath));
const sourceSha256 = createHash("sha256").update(sourceBuffer).digest("hex");
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(sourceBuffer);

const sheets = {};
for (const name of SHEETS) {
  const worksheet = workbook.getWorksheet(name);
  if (!worksheet) throw new Error(`Aba ausente: ${name}`);
  const usedDataColumns = new Set();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= HEADER_ROW) return;
    row.eachCell((cell, colNumber) => {
      if (cellText(cell.value).trim()) usedDataColumns.add(colNumber);
    });
  });
  const headerRow = worksheet.getRow(HEADER_ROW);
  const headerOccurrences = new Map();
  const columns = [...usedDataColumns].sort((left, right) => left - right).map((colNumber) => {
    const base = String(headerRow.getCell(colNumber).value ?? "").trim() || `COL_${colNumber}`;
    const occurrence = (headerOccurrences.get(base) ?? 0) + 1;
    headerOccurrences.set(base, occurrence);
    return { colNumber, key: occurrence === 1 ? base : `${base}__${occurrence}` };
  });
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= HEADER_ROW) return;
    const record = {};
    let populated = false;
    for (const { colNumber, key } of columns) {
      const text = cellText(row.getCell(colNumber).value).trim();
      if (ERROR_CELL.test(text)) recordError(name, `${row.getCell(colNumber).address}`, text);
      if (text) populated = true;
      record[key] = text;
    }
    if (populated) rows.push(record);
  });
  if (rows.length !== EXPECTED_ROWS[name]) throw new Error(`Contagem divergente em ${name}: ${rows.length} != ${EXPECTED_ROWS[name]}`);
  const columnNames = columns.map(({ key }) => key);
  const rowValues = rows.map((record) => columnNames.map((key) => record[key] ?? ""));
  sheets[name] = {
    columns: columnNames,
    rows: rowValues,
    search: rowValues.map((values) => normalizeSearch(values.join(" "))).join("\u0000"),
  };
  console.log(`${name}: ${rows.length} linhas · ${columns.length} colunas`);
}

const sheetSha256 = Object.fromEntries(Object.entries(sheets).map(([name, sheet]) => [name, createHash("sha256").update(JSON.stringify(sheet)).digest("hex")]));
const packageHash = createHash("sha256").update(Object.entries(sheetSha256).map(([name, hash]) => `${name}:${hash}`).join("\n")).digest("hex");
const manifest = {
  artifact: "catalogo-mestre-rkf",
  version,
  sourceFile: "data/rkf/catalogo-mestre/v1/catalogo-mestre-rkf-v1.xlsx",
  sourceSha256,
  sourceBytes: sourceBuffer.length,
  generatedAt: new Date().toISOString(),
  headerRow: HEADER_ROW,
  sheetCount: SHEETS.length,
  rows: Object.fromEntries(Object.entries(sheets).map(([name, sheet]) => [name, sheet.rows.length])),
  sheetSha256,
  packageHash,
  // Erros de fórmula do XLSX de origem: preservados literalmente no payload e
  // sinalizados aqui; a importação NÃO deve reprovar o pacote por causa deles,
  // mas a consulta marca as linhas afetadas para revisão humana.
  sourceCellErrors,
};

mkdirSync(outDir, { recursive: true });
const buffer = gzipSync(Buffer.from(JSON.stringify({ manifest, sheets }), "utf8"), { level: 9 });
const artifactSha256 = createHash("sha256").update(buffer).digest("hex");
writeFileSync(resolve(outDir, `catalog-v${version}.json.gz`), buffer);
writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify({ ...manifest, artifact: `catalog-v${version}.json.gz`, artifactSha256, artifactBytes: buffer.length }, null, 2));
console.log(`packageHash: ${packageHash}`);
console.log(`sourceCellErrors: ${sourceCellErrors.length}${sourceCellErrors.length ? ` -> ${sourceCellErrors.map((error) => `${error.sheet}!${error.cell}=${error.value}`).join(", ")}` : ""}`);
console.log(`artefato: data/rkf/catalogo-mestre/v1/catalog-v${version}.json.gz (${buffer.length} bytes, sha256 ${artifactSha256.slice(0, 16)}…)`);
