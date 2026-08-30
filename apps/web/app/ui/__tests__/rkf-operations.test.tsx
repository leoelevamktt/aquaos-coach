import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { RkfOperations } from "../rkf-operations";
import { apiRequest } from "../api";

vi.mock("../api", () => ({
  apiRequest: vi.fn(),
  uploadFile: vi.fn(),
}));

const mockedApi = vi.mocked(apiRequest);

const bootstrap = {
  program: { name: "RKF", version: "5.1", mode: "validation" },
  athlete: { id: "ana-souza", name: "Ana Souza", age: 22, specialty: "200_LIVRE", readiness: 82 },
  load: {
    layers: { layers: { prescribed: { volumeM: 6000 }, executed: { volumeM: 5800 }, internal: { loadUa: 430 } }, adherence: { volumeAdherencePct: 96.7 } },
    latest: { atl: 51, ctl: 48, tsb: -3, coldStart: { stage: "READY", confidence: .92, distinctActiveDays: 48 } },
    monotony: { monotony: 1.3, strain: 520, status: "OK" }, alerts: [], convention: "CTL menos ATL",
  },
  adaptation: { class: "MANTER", adaptedVolumeM: 5800, primaryZone: "A2", status: "PRONTO", version: "1" },
  response: { responseScore: 84, completeness: .9, status: "OK" },
  ingestion: { pendingReview: 0, total: 0 }, prescriptions: { pendingApproval: 0, published: 0 },
  seed: { expectedSessions: 910, expectedBlocks: 6226, packageLocated: true, staged: true, imported: true, status: "IMPORTED", packageHash: "abc123", reason: "Seed importada por transação registrada." },
  featureFlags: {},
  gates: [
    { id: "G01", label: "Motor determinístico", status: "PASS", evidence: "Testes unitários executados." },
    { id: "G02", label: "Política de retenção", status: "BLOCKED", detail: "Aguardando aprovação formal." },
  ],
  provenance: { label: "Dados sintéticos de validação. Não representam resultados oficiais." },
};

const seedCoverage = {
  version: "RKF_V5.1", status: "INTEGRITY_PASS", totalRows: 15246, operationalFiles: 9, reviewFiles: 1,
  files: [
    { name: "sessions.csv", label: "Sessões", rows: 910, columns: ["id", "title"], integrity: "PASS", activation: "OPERATIONAL", use: "Biblioteca e seleção de candidatos" },
    { name: "prescription_units.csv", label: "Unidades de prescrição", rows: 6226, columns: ["id"], integrity: "PASS", activation: "PRESERVED_REVIEW", use: "Rastreabilidade da atomização" },
  ],
};

const decisions = {
  revision: 1, status: "BLOCKED", summary: { total: 2, pass: 0, review: 1, blocked: 1, deferred: 0 },
  decisions: [
    { id: "DEC-01", title: "Versão canônica RKF", status: "REVIEW", evidence: ["Manifesto usa V5.1."], owner: "Metodologia" },
    { id: "DEC-11", title: "Retenção LGPD", status: "BLOCKED", evidence: ["Política formal ainda não aprovada."], owner: "DPO/Operação" },
  ],
};

describe("RkfOperations material coverage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/me") return Promise.resolve({});
      if (path === "/api/v1/rkf/bootstrap") return Promise.resolve(bootstrap);
      if (path === "/api/v1/rkf/ingestions") return Promise.resolve({ data: [] });
      if (path === "/api/v1/rkf/prescriptions") return Promise.resolve({ data: [] });
      if (path === "/api/v1/rkf/seed/files") return Promise.resolve(seedCoverage);
      if (path === "/api/v1/rkf/governance/decisions") return Promise.resolve(decisions);
      return Promise.reject(new Error(`rota não mockada: ${path}`));
    });
  });

  it("separa integridade, ativação e bloqueios reais dos materiais", async () => {
    render(<RkfOperations onNotify={() => undefined} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Cobertura" }));

    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Cobertura");
    expect(screen.getByText("15.246")).toBeInTheDocument();
    expect(screen.getByText("ARQUIVOS OPERACIONAIS")).toBeInTheDocument();
    expect(screen.getByText("9", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("/10")).toBeInTheDocument();
    expect(screen.getByText("Unidades de prescrição")).toBeInTheDocument();
    expect(screen.getByText("Retenção LGPD")).toBeInTheDocument();
    expect(screen.getByText("PDF escaneado / imagem")).toBeInTheDocument();
    expect(screen.getAllByText("BLOCKED").length).toBeGreaterThan(0);
  });

  it("exibe as evidências retornadas pela API", async () => {
    render(<RkfOperations onNotify={() => undefined} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Cobertura" }));

    expect(screen.getByText("Testes unitários executados.")).toBeInTheDocument();
    expect(screen.getByText("Aguardando aprovação formal.")).toBeInTheDocument();
  });
});
