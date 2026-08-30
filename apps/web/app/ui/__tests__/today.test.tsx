import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { Today } from "../views-primary";
import { apiRequest } from "../api";

vi.mock("../api", () => ({
  API_URL: "http://localhost:4000",
  apiRequest: vi.fn(),
  importFile: vi.fn(),
  mediaUrl: vi.fn(),
}));

const mockedApi = vi.mocked(apiRequest);

function mockAthletes(count: number) {
  return {
    data: Array.from({ length: count }, (_, index) => ({
      id: `live-${index + 1}`,
      name: `Atleta ${index + 1}`,
      group: "Elite · Raia 4",
    })),
  };
}

function renderToday() {
  return render(
    <Today
      onCreate={() => undefined}
      onNavigate={() => undefined}
      onAthlete={() => undefined}
      onNotify={() => undefined}
    />,
  );
}

function apiRoutes(athletesData: { data: Array<Record<string, unknown>> }) {
  mockedApi.mockImplementation((path: string) => {
    if (path === "/api/v1/athletes") return Promise.resolve(athletesData);
    if (path === "/api/v1/manage/meets") return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`rota não mockada: ${path}`));
  });
}

describe("Today", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("contagem no subtítulo 'Na água hoje' igual ao length do array do mock", async () => {
    apiRoutes(mockAthletes(6));
    renderToday();

    const subtitle = await screen.findByText(/atletas · 5\.200 m · AN2/);
    expect(subtitle).toHaveTextContent(/^6 atletas · 5\.200 m · AN2$/);
  });

  it("mostra chip '+2 atletas' quando a lista tem 6 atletas (4 visíveis)", async () => {
    apiRoutes(mockAthletes(6));
    renderToday();

    expect(await screen.findByText("+2 atletas")).toBeInTheDocument();
  });

  it("não mostra chip de overflow com 4 atletas ou menos", async () => {
    apiRoutes(mockAthletes(4));
    renderToday();

    await screen.findByText(/4 atletas · 5\.200 m · AN2/);
    expect(screen.queryByText(/\+\d+ atletas/)).not.toBeInTheDocument();
  });

  it("métrica 'ATLETAS ATIVOS' reflete o total do plantel carregado", async () => {
    apiRoutes(mockAthletes(5));
    renderToday();

    expect(await screen.findByText("5 no plantel")).toBeInTheDocument();
  });

  it("associa métricas ao atleta correto mesmo quando a API usa prefixo ath-", async () => {
    apiRoutes({ data: [{ id: "ath-ana", name: "Ana Souza" }, { id: "ath-caio", name: "Caio Martins" }] });
    renderToday();

    expect(await screen.findByText("28.600 m")).toBeInTheDocument();
    expect(await screen.findByText("27.100 m")).toBeInTheDocument();
  });
});
