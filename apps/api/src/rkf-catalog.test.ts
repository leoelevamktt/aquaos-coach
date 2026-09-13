import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RkfCatalogStore } from "./rkf-catalog-store.js";
import type { RkfCatalogArtifact } from "./rkf-catalog-store.js";

function columnar(rows: Array<Record<string, string>>) {
  const columns = Object.keys(rows[0] ?? {});
  const values = rows.map((row) => columns.map((column) => row[column] ?? ""));
  return { columns, rows: values, search: values.map((row) => row.join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")).join("\u0000") };
}

function records(data: { columns: string[]; rows: string[][] }) {
  return data.rows.map((values) => Object.fromEntries(data.columns.map((column, index) => [column, values[index] ?? ""])) as Record<string, string>);
}

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

let real: RkfCatalogArtifact;

beforeAll(async () => {
  const { gunzipSync } = await import("node:zlib");
  const artifactPath = new URL("../../../data/rkf/catalogo-mestre/v1/catalog-v1.json.gz", import.meta.url);
  real = JSON.parse(gunzipSync(readFileSync(artifactPath)).toString("utf8")) as RkfCatalogArtifact;
});

function fixture(overrides: Partial<RkfCatalogArtifact> = {}): RkfCatalogArtifact {
  const base: RkfCatalogArtifact = {
    manifest: {
      artifact: "catalogo-mestre-rkf",
      version: 1,
      sourceFile: "fixture.xlsx",
      sourceSha256: "f".repeat(64),
      sourceBytes: 1,
      generatedAt: "2026-09-01T00:00:00.000Z",
      headerRow: 5,
      sheetCount: 2,
      rows: { ATLETAS: 2, DICIONARIOS: 1 },
      sheetSha256: {},
      packageHash: "hash-fixture",
      sourceCellErrors: [{ sheet: "ATLETAS", cell: "F7", value: "#REF!" }],
    },
    sheets: {
      ATLETAS: columnar([
        { ID_Atleta: "ATL-001", Nome_Completo: "Ana Souza", Status_Cadastro: "Validado" },
        { ID_Atleta: "ATL-002", Nome_Completo: "Bruno Lima", Status_Cadastro: "Rascunho" },
      ]),
      DICIONARIOS: columnar([{ Categoria: "Zonas", Valor: "A2", Significado: "Aeróbio" }]),
    },
  };
  return structuredClone(base);
}

describe("RkfCatalogStore — integridade do artefato real", () => {
  it("usa representação colunar compacta com texto de busca pré-normalizado", () => {
    const sheet = real.sheets.ATLETAS;
    expect(sheet.columns).toContain("ID_Atleta");
    expect(sheet.rows).toHaveLength(39);
    expect(sheet.search.split("\u0000")).toHaveLength(39);
    expect(real.manifest.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(real.manifest.sourceBytes).toBeGreaterThan(7_000_000);
  });

  it("casa as contagens do catálogo mestre validado (13 abas)", () => {
    expect(real.manifest.rows).toEqual({
      ATLETAS: 39, PROVAS_ATLETA: 74, DOCUMENTOS: 1364, SESSOES: 4171, SESSAO_ATLETAS: 3102,
      COMPONENTES: 49835, INDICE_CONSULTA: 4810, DICIONARIOS: 165, TRANSCRICAO_PERFIS: 49,
      REFERENCIAS_ACERVO: 13, TRANSCRICAO_TREINOS: 17478, PENDENCIAS_AUDITORIA: 222,
      AUDITORIA_IMPORTACAO: 11,
    });
  });

  it("preserva colunas populadas quando a planilha contém cabeçalhos duplicados vazios à direita", () => {
    const components = records(real.sheets.COMPONENTES);
    expect(components.filter((row) => row.Material).length).toBe(11967);
    expect(components.filter((row) => row["Método_Organização"]).length).toBe(1015);
    expect(components.filter((row) => row["Objetivo_Energético"]).length).toBe(7179);
    expect(components.filter((row) => row["Objetivo_Técnico"]).length).toBe(6154);
    expect(components.filter((row) => row["Confiança_Classificação"]).length).toBe(49835);
    expect(components.filter((row) => row["Observações"]).length).toBe(49835);
    expect(Object.keys(records(real.sheets.DICIONARIOS)[0])).not.toContain("COL_4");
  });

  it("usa os IDs e nomes reais das abas com cabeçalhos acentuados", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-real-labels-"));
    directories.push(directory);
    const store = new RkfCatalogStore(join(directory, "sidecar"), real);
    await store.import({ organizationId: "org-a", actorId: "test" });
    expect(store.query("org-a", { sheet: "PROVAS_ATLETA", limit: 1 }).data[0]).toMatchObject({ id: "PRV-R001", name: "Guilherme Costa" });
    expect(store.query("org-a", { sheet: "SESSAO_ATLETAS", limit: 1 }).data[0]).toMatchObject({ id: "SA-000001", name: "Bruce", status: "Pendente" });
    expect(store.query("org-a", { sheet: "INDICE_CONSULTA", limit: 1 }).data[0]?.id).toBe("IDX-000001");
    expect(store.query("org-a", { sheet: "TRANSCRICAO_PERFIS", limit: 1 }).data[0]?.id).toBe("TR-001");
    expect(store.query("org-a", { sheet: "SESSOES", limit: 1 }).data[0]?.name).toContain("Submerso");
    const sourceError = store.query("org-a", { sheet: "COMPONENTES", q: "CMP-0045184", limit: 1 }).data[0];
    expect(sourceError?.payload).toMatchObject({ sourceCellError: true, sourceErrorCells: ["F45189", "G45189"] });
  }, 15_000);

  it("declara as 98 células de erro do XLSX de origem e preserva o valor literal #REF! no payload", () => {
    const errors = real.manifest.sourceCellErrors ?? [];
    expect(errors.length).toBe(98);
    expect(errors).toContainEqual({ sheet: "COMPONENTES", cell: "F45189", value: "#REF!" });
    const flagged = records(real.sheets.COMPONENTES).find((row) => Object.values(row).includes("#REF!"));
    expect(flagged).toBeDefined();
  });
});

describe("RkfCatalogStore — importação", () => {
  it("não regrava as linhas no PostgreSQL quando versão e hash já existem", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-pg-idempotent-"));
    directories.push(directory);
    const importedAt = "2026-09-12T12:00:00.000Z";
    const postgres = {
      getRkfSeedImportStatus: vi.fn().mockResolvedValue({ importedAt }),
      importRkfColumnarSeed: vi.fn(),
    };
    const store = new RkfCatalogStore(join(directory, "sidecar"), fixture(), { postgres });

    const result = await store.import({ organizationId: "org-a", actorId: "user-1" });

    expect(result).toMatchObject({ imported: false, rows: 3 });
    expect(postgres.importRkfColumnarSeed).not.toHaveBeenCalled();
    expect(store.status("org-a")?.importedAt).toBe(importedAt);
  });

  it("envia lotes colunares ao PostgreSQL sem expandir o catálogo inteiro em objetos", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-pg-columnar-"));
    directories.push(directory);
    const postgres = {
      getRkfSeedImportStatus: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ importedAt: "2026-09-12T12:00:00.000Z" }),
      importRkfColumnarSeed: vi.fn().mockResolvedValue({ importId: "import-1", importedRows: 3, files: 2, driver: "postgres" }),
    };
    const store = new RkfCatalogStore(join(directory, "sidecar"), fixture(), { postgres });
    await store.import({ organizationId: "org-a", actorId: "user-1" });
    expect(postgres.importRkfColumnarSeed).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a",
      files: expect.arrayContaining([expect.objectContaining({ name: "ATLETAS", columns: ["ID_Atleta", "Nome_Completo", "Status_Cadastro"], rows: expect.any(Array) })]),
    }));
  });

  it("importa transacionalmente e é idempotente por organizationId+version+packageHash", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-"));
    directories.push(directory);
    const store = new RkfCatalogStore(join(directory, "sidecar"), fixture());
    const first = await store.import({ organizationId: "org-a", actorId: "user-1" });
    expect(first.imported).toBe(true);
    expect(first.rows).toBe(3);

    const again = await store.import({ organizationId: "org-a", actorId: "user-2" });
    expect(again.imported).toBe(false);
    expect(again.importId).toBe(first.importId);

    const status = store.status("org-a");
    expect(status?.packageHash).toBe("hash-fixture");
    expect(status?.version).toBe(1);
    expect(status?.rows).toBe(3);
    expect(status?.importedAt).toBeTruthy();
    // hash diferente -> nova importação
    const other = structuredClone(fixture());
    other.manifest.packageHash = "hash-novo";
    const store2 = new RkfCatalogStore(join(directory, "sidecar-2"), other);
    const second = await store2.import({ organizationId: "org-a", actorId: "user-1" });
    expect(second.imported).toBe(true);
  });

  it("grava sidecar comprimido no modo arquivo e relê com o mesmo packageHash", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-file-"));
    directories.push(directory);
    const store = new RkfCatalogStore(join(directory, "sidecar"), fixture());
    await store.import({ organizationId: "org-a", actorId: "user-1" });
    const sidecar = join(directory, "sidecar", "org-a", "catalog-v1-hash-fixture.json.gz");
    expect(readFileSync(sidecar)).toBeTruthy();
    const reopened = new RkfCatalogStore(join(directory, "sidecar"), fixture());
    expect(reopened.status("org-a")?.packageHash).toBe("hash-fixture");
  });
});

describe("RkfCatalogStore — consulta", () => {
  it("pagina multi-tenant sem vazar linhas de outra organização", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-tenant-"));
    directories.push(directory);
    const store = new RkfCatalogStore(join(directory, "sidecar"), fixture());
    await store.import({ organizationId: "org-a", actorId: "user-1" });
    await store.import({ organizationId: "org-b", actorId: "user-1" });
    const page = store.query("org-a", { sheet: "ATLETAS", offset: 0, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({ id: "ATL-001", sheet: "ATLETAS", name: "Ana Souza", status: "Validado" });
    expect(page.sheets.map((sheet) => sheet.name)).toContain("ATLETAS");
    expect(page.source).toMatchObject({ version: 1, packageHash: "hash-fixture" });
    // org-b consulta o mesmo catálogo global sem cross-tenant (sidecars separados)
    const pageB = store.query("org-b", { sheet: "ATLETAS", offset: 1, limit: 1 });
    expect(pageB.total).toBe(2);
    expect(pageB.data[0]?.id).toBe("ATL-002");
  });

  it("nega consulta a organização sem importação própria", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-tenant-deny-"));
    directories.push(directory);
    const store = new RkfCatalogStore(join(directory, "sidecar"), fixture());
    await store.import({ organizationId: "org-a", actorId: "user-1" });
    expect(() => store.query("org-b", { sheet: "ATLETAS" })).toThrow(/ainda não importado/i);
    expect(store.searchAcrossSheets("org-b", "Ana", 10)).toEqual([]);
  });

  it("busca textual com ranking de relevância e paginação sobre o resultado", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-search-"));
    directories.push(directory);
    const store = new RkfCatalogStore(join(directory, "sidecar"), fixture());
    await store.import({ organizationId: "org-a", actorId: "user-1" });
    const page = store.query("org-a", { sheet: "ATLETAS", q: "Ana", offset: 0, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.data[0]?.id).toBe("ATL-001");
    const prefix = store.query("org-a", { sheet: "ATLETAS", q: "sou", offset: 0, limit: 10 });
    expect(prefix.total).toBe(1);
    const dictionary = store.query("org-a", { sheet: "DICIONARIOS", q: "aeróbio", offset: 0, limit: 10 });
    expect(dictionary.total).toBe(1);
  });

  it("valida a aba contra o manifesto e limita o tamanho de página", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-validate-"));
    directories.push(directory);
    const store = new RkfCatalogStore(join(directory, "sidecar"), fixture());
    await store.import({ organizationId: "org-a", actorId: "user-1" });
    expect(() => store.query("org-a", { sheet: "ABA_INEXISTENTE", offset: 0, limit: 10 })).toThrow(/aba/i);
    const overLimit = store.query("org-a", { sheet: "ATLETAS", offset: 0, limit: 501 });
    expect(overLimit.limit).toBe(500);
  });

  it("não importa quando o pacote não confere com o manifesto (integridade)", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-catalog-integrity-"));
    directories.push(directory);
    const tampered = fixture();
    // hash declarado NÃO corresponde ao conteúdo real da aba -> reprova
    tampered.manifest.sheetSha256 = { ...tampered.manifest.sheetSha256, ATLETAS: "0".repeat(64) };
    const store = new RkfCatalogStore(join(directory, "sidecar"), tampered);
    await expect(store.import({ organizationId: "org-a", actorId: "user-1" })).rejects.toThrow(/integridade/i);
  });
});
