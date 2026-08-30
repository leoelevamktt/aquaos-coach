import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { renderContent } from "../ai-assistant";

function renderToContainer(content: string) {
  return render(<div>{renderContent(content)}</div>).container;
}

describe("renderContent", () => {
  it("remove cabeçalhos '##' do texto", () => {
    const container = renderToContainer("## Resumo da semana\nEquipe estável.");
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.textContent).toContain("Resumo da semana");
    expect(container.textContent).not.toContain("##");
  });

  it("agrupa linhas com '- ' em uma única ul com li's", () => {
    const container = renderToContainer("Pontos de atenção:\n- Sono abaixo da meta\n- Volume acima do planejado\n- Prontidão em queda");
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    const items = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["Sono abaixo da meta", "Volume acima do planejado", "Prontidão em queda"]);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe("Pontos de atenção:");
  });

  it("interrompe a lista quando uma linha não-bullet aparece entre bullets", () => {
    const container = renderToContainer("- primeiro\nTexto solto\n- segundo");
    expect(container.querySelectorAll("ul")).toHaveLength(2);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("higieniza marcadores ** em texto plano (comportamento atual do sanitizeLine)", () => {
    // Nota: sanitizeLine aplica /[*_]{2,}/g -> " " antes do split de **negrito**,
    // portanto o ramo <strong> de renderContent não é alcançável hoje; o marcador
    // é removido e o texto permanece. Teste documenta o comportamento real.
    const container = renderToContainer("**Atenção:** carga elevada");
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("Atenção: carga elevada");
    expect(container.textContent).not.toContain("**");
  });
});
