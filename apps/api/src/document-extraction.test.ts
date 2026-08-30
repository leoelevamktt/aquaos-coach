import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { extractDocument, signatureMatches } from "./document-extraction.js";

describe("extração documental", () => {
  it("extrai texto e CSV com campos entre aspas", async () => {
    const text = await extractDocument(Buffer.from("Sessão A2\n8x100 livre"), "sessao.txt");
    expect(text).toMatchObject({ status: "extracted", format: "txt", textLength: 21 });
    const csv = await extractDocument(Buffer.from('atleta,nota\nAna,"ritmo, virada"'), "resultados.csv");
    expect(csv).toMatchObject({ status: "extracted", rows: [{ atleta: "Ana", nota: "ritmo, virada" }] });
  });

  it("extrai planilha XLSX e valida assinatura de PDF", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Carga");
    sheet.addRow(["Atleta", "Volume"]); sheet.addRow(["Ana", 6000]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const extracted = await extractDocument(buffer, "carga.xlsx");
    expect(extracted).toMatchObject({ status: "extracted", format: "xlsx", sheets: [{ name: "Carga", rows: 2 }] });
    expect(signatureMatches(Buffer.from("%PDF-1.7"), ".pdf")).toBe(true);
    expect(signatureMatches(Buffer.from("arquivo falso"), ".pdf")).toBe(false);
  });

  it("não promete OCR quando o pacote de idioma não está homologado", async () => {
    expect(await extractDocument(Buffer.from([0xff, 0xd8, 0xff]), "foto.jpg")).toMatchObject({ status: "needs_ocr", format: "jpg" });
  });
});
