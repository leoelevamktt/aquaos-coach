import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { extractDocument, extractSpreadsheetRows, readSafeArchiveEntries, signatureMatches } from "./document-extraction.js";

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

  it("converte todas as linhas de abas XLSX em registros auditáveis", async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet("Sessões");
    first.addRow(["Título", "Volume (m)", "Volume (m)"]); first.addRow(["Base A2", 5800, 5800]);
    const second = workbook.addWorksheet("Metadados");
    second.addRow(["Chave", "Valor"]); second.addRow(["versão", "V5.1"]);
    const rows = await extractSpreadsheetRows(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ __sheet: "Sessões", titulo: "Base A2", volume_m: 5800, volume_m_2: 5800 }),
      expect.objectContaining({ __sheet: "Metadados", chave: "versão", valor: "V5.1" }),
    ]));
  });

  it("não promete OCR quando o pacote de idioma não está homologado", async () => {
    expect(await extractDocument(Buffer.from([0xff, 0xd8, 0xff]), "foto.jpg")).toMatchObject({ status: "needs_ocr", format: "jpg" });
  });

  it("inspeciona ZIP, extrai formatos suportados e relata os demais", async () => {
    const zip = new JSZip();
    zip.file("rkf/sessoes.csv", "nome,zona\nLimiar,A3");
    zip.file("rkf/metodo.txt", "4x200 livre A2");
    zip.file("rkf/binario.exe", Buffer.from([1, 2, 3]));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const extracted = await extractDocument(buffer, "rkf.zip");
    expect(extracted).toMatchObject({
      status: "extracted",
      format: "zip",
      archive: { totalEntries: 3, extractedEntries: 2, skippedEntries: 1 },
    });
    expect(extracted.text).toContain("4x200 livre A2");
    expect(extracted.archive?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "rkf/binario.exe", status: "skipped" }),
    ]));
  });

  it("bloqueia path traversal e expansão suspeita em ZIP", async () => {
    const traversal = new JSZip();
    traversal.file("../fora.txt", "não deve sair do arquivo");
    const traversalBuffer = await traversal.generateAsync({ type: "nodebuffer" });
    // JSZip mantém o nome original inseguro para que a nossa inspeção possa rejeitá-lo.
    expect(await extractDocument(traversalBuffer, "travessia.zip")).toMatchObject({ status: "failed", format: "zip" });

    const bomb = new JSZip();
    bomb.file("repetido.txt", "A".repeat(2 * 1024 * 1024));
    const bombBuffer = await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const result = await extractDocument(bombBuffer, "suspeito.zip");
    expect(result).toMatchObject({ status: "failed", format: "zip" });
    expect(result.error).toContain("razão de compressão");
  });

  it("expõe apenas entradas seguras para o importador genérico", async () => {
    const zip = new JSZip();
    zip.file("sessions.csv", "title,volume\nA2,5800");
    const entries = await readSafeArchiveEntries(await zip.generateAsync({ type: "nodebuffer" }));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: "sessions.csv", extension: ".csv", sizeBytes: expect.any(Number) });
    expect(entries[0].content.toString()).toContain("A2");
  });
});
