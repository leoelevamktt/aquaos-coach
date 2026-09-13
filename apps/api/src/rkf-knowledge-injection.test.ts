import { describe, expect, it } from "vitest";
import { buildKnowledgeContextFromChunks, chunkKnowledgeText, rankKnowledgeChunks } from "./rkf-knowledge-injection.js";

describe("Base de Conhecimento RKF", () => {
  const text = [
    "REGRAS PRÁTICAS PARA O FUTURO AGENTE\n[REGRA] Não inventar dados ausentes. [REGRA] Conflitos e lacunas exigem revisão humana.",
    "LINGUAGEM DE ZONAS\n[DECISÃO] VALAT, A1, A2, A3, AN1 e AN2 são as zonas canônicas. LT1/LT2 são referências.",
    "ESTRUTURA DAS SESSÕES\n[PRINCÍPIO] Aquecimento e regenerativo são obrigatórios. [PREFERÊNCIA] Informar material em cada série.",
    "[HIPÓTESE / NÃO VALIDADO] Uma proposta histórica sugere uma fórmula ainda não homologada.",
  ].join("\n\n");
  const chunks = chunkKnowledgeText(text, 180);

  it("recupera trechos relevantes sem enviar a base inteira", () => {
    const ranked = rankKnowledgeChunks(chunks, "quais são as zonas canônicas e como tratar LT1?", 2);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].text).toContain("VALAT");
    expect(ranked[0].text).toContain("LT1");
  });

  it("preserva regras de certeza no contexto entregue ao LLM", () => {
    const context = buildKnowledgeContextFromChunks(chunks, "fórmula histórica", 4000);
    expect(context).toContain("HIPÓTESE");
    expect(context).toContain("nunca devem ser promovidos a fato");
    expect(context).toContain("aprovação humana");
  });
});
