import { describe, expect, it } from "vitest";
import { rankCatalogRows } from "./rkf-catalog-store.js";
import type { CatalogRow } from "./rkf-catalog-store.js";

const rows: CatalogRow[] = [
  { id: "SESSAO-1", sheet: "SESSOES", name: "Aeróbio longo", status: "Validado", payload: { Objetivo: "A2", Volume: "4200 m" } },
  { id: "SESSAO-2", sheet: "SESSOES", name: "Treino limiar", status: "Rascunho", payload: { Objetivo: "A3", Volume: "3000 m" } },
  { id: "DOC-1", sheet: "DOCUMENTOS", name: "Planilha de cargas", status: "Validado", payload: { Conteudo: "cargas semanais" } },
];

describe("retrieval do catálogo mestre para a IA", () => {
  it("ranqueia por relevância: termo no nome vale mais que no payload", () => {
    const ranked = rankCatalogRows(rows, "aeróbio");
    expect(ranked[0]?.row.id).toBe("SESSAO-1");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("não retorna linhas sem nenhum termo casado", () => {
    const ranked = rankCatalogRows(rows, "borboleta");
    expect(ranked).toHaveLength(0);
  });

  it("marca rascunho/pendente como não canônico no contexto", async () => {
    const { buildRkfCatalogContext } = await import("./rkf-catalog-retrieval.js");
    const context = buildRkfCatalogContext(rows, "limiar", { packageHash: "h1", version: 1 });
    expect(context).toContain("NÃO CANÔNICO");
    expect(context).toContain("Rascunho");
    expect(context).toContain("hash da importação: h1");
  });

  it("recupera termos específicos de atleta e objetivo sem exigir palavras genéricas em toda linha", () => {
    const related: CatalogRow[] = [
      { id: "ATL-1", sheet: "ATLETAS", name: "Guilherme Costa", status: "Rascunho", payload: { Perfil: "Fundo" } },
      { id: "SES-1", sheet: "SESSOES", name: "Aeróbio A2", status: "Validado", payload: { Tipo: "A2" } },
    ];
    const ranked = rankCatalogRows(related, "qual treino A2 para Guilherme");
    expect(ranked.map(({ row }) => row.id)).toEqual(expect.arrayContaining(["ATL-1", "SES-1"]));
  });

  it("não apresenta célula-fonte corrompida como evidência canônica", async () => {
    const { buildRkfCatalogContext } = await import("./rkf-catalog-retrieval.js");
    const corrupted: CatalogRow = { id: "CMP-1", sheet: "COMPONENTES", name: "CMP-1", status: "", payload: { Texto_Original_Literal: "#REF!", sourceCellError: true } };
    const context = buildRkfCatalogContext([corrupted], "componente", { packageHash: "h1", version: 1 });
    expect(context).toContain("NÃO CANÔNICO");
    expect(context).not.toContain("Texto_Original_Literal=#REF!");
    expect(context).toContain("célula de origem inválida omitida");
  });

  it("trata registro sem validação explícita como não canônico", async () => {
    const { buildRkfCatalogContext } = await import("./rkf-catalog-retrieval.js");
    const unvalidated: CatalogRow = { id: "CMP-2", sheet: "COMPONENTES", name: "Série técnica", status: "", payload: { Confiança_Classificação: "Alta" } };
    const context = buildRkfCatalogContext([unvalidated], "série", { packageHash: "h1", version: 1 });
    expect(context).toContain("[NÃO CANÔNICO]");
  });

  it("limita o contexto a poucas linhas para não despejar catálogo inteiro no prompt", async () => {
    const { buildRkfCatalogContext } = await import("./rkf-catalog-retrieval.js");
    const many = Array.from({ length: 80 }, (_, index) => ({ id: `X-${index}`, sheet: "SESSOES", name: `Treino aeróbio ${index}`, status: "Validado", payload: {} }));
    const context = buildRkfCatalogContext(many, "aeróbio", { packageHash: "h1", version: 1 });
    expect(context.match(/Treino aeróbio/g)?.length).toBeLessThanOrEqual(12);
  });
});
