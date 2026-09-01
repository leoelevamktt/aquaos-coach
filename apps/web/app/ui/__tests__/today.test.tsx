import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { Today, type Briefing } from "../views-primary";
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

function mockBriefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    date: "2026-08-28",
    nextMeet: null,
    todaySessions: [
      { id: "s1", title: "Ritmo de prova · 200 Livre", date: "2026-08-28", volumeMeters: 5200, zone: "AN2", blocksCount: 3, time: "07:30", targetType: "team", targetId: "org-demo" },
      { id: "s2", title: "Força · membros inferiores", date: "2026-08-28", volumeMeters: 4200, zone: "FORÇA", blocksCount: 2, time: "16:00", targetType: "group", targetId: "elite" },
    ],
    metrics: { activeAthletes: 0, readyAthletes: 0, attentionAthletes: 0, averageReadiness: null, checkinsToday: 3, adherencePercent: 88, pendingVideos: 0, pendingInvitations: 0, expiringInvitations: 0, prescriptionsAwaitingApproval: 0 },
    load: { acute: null, chronic: null, acwr: null, weeklyHistory: [], source: "none" },
    insights: [],
    perAthlete: [],
    ...overrides,
  };
}

function renderToday() {
  return render(
    <Today
      onCreate={() => undefined}
      onAiWorkout={() => undefined}
      onNavigate={() => undefined}
      onAthlete={() => undefined}
      onNotify={() => undefined}
    />,
  );
}

function apiRoutes(athletesData: { data: Array<Record<string, unknown>> }, briefing: Briefing = mockBriefing()) {
  mockedApi.mockImplementation((path: string) => {
    if (path === "/api/v1/athletes") return Promise.resolve(athletesData);
    if (path === "/api/v1/coach/briefing") return Promise.resolve(briefing);
    return Promise.reject(new Error(`rota não mockada: ${path}`));
  });
}

describe("Today", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("subtítulo 'Na água hoje' reflete o length de todaySessions do briefing", async () => {
    apiRoutes(mockAthletes(6));
    renderToday();

    const subtitle = await screen.findByText(/2 sessões · 9\.400 m/);
    expect(subtitle).toHaveTextContent(/^2 sessões · 9\.400 m · AN2$/);
  });

  it("mostra chip '+2 atletas' quando a lista tem 6 atletas (4 visíveis)", async () => {
    apiRoutes(mockAthletes(6));
    renderToday();

    expect(await screen.findByText("+2 atletas")).toBeInTheDocument();
  });

  it("não mostra chip de overflow com 4 atletas ou menos", async () => {
    apiRoutes(mockAthletes(4));
    renderToday();

    await screen.findByText(/2 sessões · 9\.400 m/);
    expect(screen.queryByText(/\+\d+ atletas/)).not.toBeInTheDocument();
  });

  it("métrica 'ATLETAS ATIVOS' reflete briefing.metrics.activeAthletes", async () => {
    apiRoutes(mockAthletes(5), mockBriefing({ metrics: { ...mockBriefing().metrics, activeAthletes: 5 } }));
    renderToday();

    expect(await screen.findByText("5 no plantel")).toBeInTheDocument();
  });

  it("associa métricas ao atleta correto mesmo quando a API usa prefixo ath-", async () => {
    apiRoutes({ data: [{ id: "ath-ana", name: "Ana Souza" }, { id: "ath-caio", name: "Caio Martins" }] });
    renderToday();

    expect(await screen.findByText("28.600 m")).toBeInTheDocument();
    expect(await screen.findByText("27.100 m")).toBeInTheDocument();
  });

  it("sem sessões publicadas mostra estado vazio com botão 'Gerar com IA'", async () => {
    apiRoutes(mockAthletes(4), mockBriefing({ todaySessions: [] }));
    renderToday();

    expect(await screen.findByText("Nenhuma sessão publicada para hoje")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gerar com IA/ })).toBeInTheDocument();
  });

  it("carga sem execuções (source 'none') não inventa números", async () => {
    apiRoutes(mockAthletes(4), mockBriefing({ load: { acute: null, chronic: null, acwr: null, weeklyHistory: [], source: "none" } }));
    renderToday();

    expect(await screen.findByText("Sem execuções registradas ainda")).toBeInTheDocument();
    expect(screen.queryByText("ACWR")).not.toBeInTheDocument();
  });
});
