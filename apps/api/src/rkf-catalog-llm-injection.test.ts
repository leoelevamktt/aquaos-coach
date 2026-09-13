import { describe, expect, it } from "vitest";
import { appendCatalogContextToMessages } from "./rkf-catalog-llm-injection.js";
import type { CatalogRow } from "./rkf-catalog-store.js";

const row: CatalogRow = {
  id: "S-1",
  sheet: "SESSOES",
  name: "Aeróbio longo A2",
  status: "Validado",
  payload: { ID_Sessao: "S-1", Nome_Sessao: "Aeróbio longo A2", Zona: "A2" },
};

const store = {
  status: (organizationId: string) => organizationId === "org-demo" ? { version: 1, packageHash: "hash-catalog" } : undefined,
  searchAcrossSheets: (_organizationId: string, _q: string, _maxRows: number) => [row],
};

describe("injeção global do Catálogo Mestre no LLM", () => {
  it("acrescenta o catálogo às rotas que ainda não o receberam", () => {
    const messages = [
      { role: "system", content: "Treinador de vídeo" },
      { role: "user", content: "cadência e trabalho aeróbio A2" },
    ];
    const enriched = appendCatalogContextToMessages(messages, store, "org-demo");
    expect(enriched).not.toBe(messages);
    expect(String(enriched[0]?.content)).toContain("CATÁLOGO MESTRE RKF");
    expect(String(enriched[0]?.content)).toContain("Aeróbio longo A2");
    expect(messages[0]?.content).toBe("Treinador de vídeo");
  });

  it("não duplica o catálogo quando o chat principal já o injetou", () => {
    const messages = [
      { role: "system", content: "=== CATÁLOGO MESTRE RKF (já presente) ===" },
      { role: "user", content: "A2" },
    ];
    expect(appendCatalogContextToMessages(messages, store, "org-demo")).toBe(messages);
  });

  it("não mistura organizações sem catálogo autorizado", () => {
    const messages = [{ role: "user", content: "A2" }];
    expect(appendCatalogContextToMessages(messages, store, "org-outro")).toBe(messages);
  });
});
