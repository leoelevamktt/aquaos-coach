import { describe, expect, it } from "vitest";
import { tokenizeForSearch, catalogSearchConfig } from "./rkf-catalog-retrieval.js";

describe("config de busca do catálogo", () => {
  it("tokeniza minúsculas, sem acento e descarta stopwords/muito curtos", () => {
    expect(tokenizeForSearch("Treino AERÓBIO de fundo")).toEqual(["aerobio", "fundo"]);
    expect(tokenizeForSearch("de da do a")).toEqual([]);
  });

  it("expõe config estática (limites de página e de contexto)", () => {
    expect(catalogSearchConfig.maxLimit).toBe(500);
    expect(catalogSearchConfig.maxContextRows).toBeLessThanOrEqual(12);
  });
});
