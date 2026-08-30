import { extname } from "node:path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { parseDelimited } from "./managed-store.js";

export type DocumentExtraction = {
  status: "extracted" | "empty" | "needs_ocr" | "unsupported" | "failed";
  format: string;
  text?: string;
  textLength?: number;
  pageCount?: number;
  sheets?: Array<{ name: string; rows: number; preview: unknown[][] }>;
  rows?: Record<string, unknown>[];
  warnings: string[];
  error?: string;
};

const trimText = (value: string) => value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, 200_000);

export async function extractDocument(buffer: Buffer, filename: string): Promise<DocumentExtraction> {
  const extension = extname(filename).toLowerCase();
  try {
    if ([".txt", ".csv", ".json"].includes(extension)) {
      const text = trimText(buffer.toString("utf8"));
      if (!text) return { status: "empty", format: extension.slice(1), warnings: ["Arquivo sem conteúdo textual."] };
      if (extension === ".csv") {
        const rows = parseDelimited(text);
        return { status: rows.length ? "extracted" : "empty", format: "csv", text, textLength: text.length, rows: rows.slice(0, 5000), warnings: rows.length > 5000 ? ["Prévia limitada às primeiras 5.000 linhas."] : [] };
      }
      if (extension === ".json") {
        const parsed = JSON.parse(text) as unknown;
        return { status: "extracted", format: "json", text: JSON.stringify(parsed, null, 2).slice(0, 200_000), textLength: text.length, warnings: [] };
      }
      return { status: "extracted", format: "txt", text, textLength: text.length, warnings: [] };
    }
    if (extension === ".pdf") {
      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        const text = trimText(parsed.text);
        return { status: text ? "extracted" : "needs_ocr", format: "pdf", text: text || undefined, textLength: text.length, pageCount: parsed.total, warnings: text ? [] : ["PDF sem camada de texto. Encaminhe para OCR antes da confirmação humana."] };
      } finally { await parser.destroy(); }
    }
    if (extension === ".docx") {
      const parsed = await mammoth.extractRawText({ buffer });
      const text = trimText(parsed.value);
      return { status: text ? "extracted" : "empty", format: "docx", text: text || undefined, textLength: text.length, warnings: parsed.messages.map((message) => message.message).slice(0, 20) };
    }
    if ([".xlsx", ".xls"].includes(extension)) {
      if (extension === ".xls") return { status: "unsupported", format: "xls", warnings: ["Formato XLS legado preservado. Converta para XLSX para extração estruturada."] };
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      const sheets = workbook.worksheets.map((sheet) => {
        const preview: unknown[][] = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
          if (preview.length < 100) preview.push((row.values as unknown[]).slice(1).map((value) => value instanceof Date ? value.toISOString() : value));
        });
        return { name: sheet.name, rows: sheet.actualRowCount, preview };
      });
      return { status: sheets.some((sheet) => sheet.rows) ? "extracted" : "empty", format: "xlsx", sheets, warnings: sheets.some((sheet) => sheet.rows > 100) ? ["Prévia limitada às primeiras 100 linhas de cada planilha."] : [] };
    }
    if ([".jpg", ".jpeg", ".png", ".heic"].includes(extension)) return { status: "needs_ocr", format: extension.slice(1), warnings: ["Imagem preservada com hash. OCR local ainda requer o pacote de idioma português homologado."] };
    if (extension === ".doc") return { status: "unsupported", format: "doc", warnings: ["Formato DOC legado preservado. Converta para DOCX para extração segura."] };
    return { status: "unsupported", format: extension.slice(1) || "unknown", warnings: ["O original foi preservado, mas não há extrator textual para este formato."] };
  } catch (error) {
    return { status: "failed", format: extension.slice(1) || "unknown", warnings: [], error: error instanceof Error ? error.message : "Falha na extração" };
  }
}

export function signatureMatches(buffer: Buffer, extension: string) {
  const ext = extension.toLowerCase();
  if (ext === ".pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if ([".docx", ".xlsx"].includes(ext)) return buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (ext === ".png") return buffer.subarray(1, 4).toString() === "PNG";
  if ([".jpg", ".jpeg"].includes(ext)) return buffer[0] === 0xff && buffer[1] === 0xd8;
  if ([".mp4", ".m4v", ".mov"].includes(ext)) return buffer.subarray(4, 12).includes(Buffer.from("ftyp"));
  return true;
}
