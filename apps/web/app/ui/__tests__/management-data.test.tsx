import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagementCenter, type ManagementKind } from "../management";

const apiRequest = vi.fn();

vi.mock("../api", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  importFile: vi.fn(),
  mediaUrl: (path?: string) => path,
  uploadFile: vi.fn(),
}));

afterEach(() => apiRequest.mockReset());

describe("ManagementCenter", () => {
  it("mostra o total do banco e pagina catálogos RKF extensos", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/manage/audit?limit=25") return Promise.resolve({ data: [] });
      if (path.startsWith("/api/v1/manage/trainingSessions")) {
        const offset = Number(new URL(`http://local${path}`).searchParams.get("offset") ?? 0);
        return Promise.resolve({
          data: Array.from({ length: 2 }, (_, index) => ({ id: `session-${offset + index}`, title: `Sessão ${offset + index + 1}`, status: "ready" })),
          total: 910,
          offset,
          limit: 100,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} initialKind="trainingSessions" />);
    expect(await screen.findByText("910 registros no banco · exibindo 1–2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/v1/manage/trainingSessions?limit=100&offset=100&q="));
    expect(await screen.findByText("910 registros no banco · exibindo 101–102")).toBeVisible();
  });

  it("expõe todos os dicionários e evidências canônicas no Admin", async () => {
    apiRequest.mockImplementation((path: string) => path.includes("/audit") ? Promise.resolve({ data: [] }) : Promise.resolve({ data: [], total: 0, offset: 0, limit: 100 }));
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} />);
    const navigationText = screen.getByText("OBJETOS DO PROGRAMA").parentElement?.textContent ?? "";
    for (const label of ["Unidades de prescrição", "Fontes RKF", "Auditoria de normalização", "Materiais RKF", "Habilidades RKF", "Regras RKF", "Exercícios RKF", "Resumos de blocos", "Ingestões normalizadas", "Extrações estruturadas", "Atribuições de sessões", "Resultados de sessão", "Resultados por série", "Resultados por repetição", "Parciais de prova"]) {
      expect(navigationText).toContain(label);
    }
  });
});

describe("ManagementCenter · Acervo mestre RKF", { timeout: 15_000 }, () => {
  const archiveSheets = [{ name: "ATLETAS", rows: 910 }, { name: "REGRAS", rows: 42 }];
  const catalogPage = (overrides: Record<string, unknown> = {}) => ({
    data: [{ id: "at-1", sheet: "ATLETAS", name: "Ana do acervo", status: "active", payload: { clube: "Auto", marcas: { peso: 72 } } }],
    total: 910,
    offset: 0,
    limit: 100,
    sheets: archiveSheets,
    source: { version: "RKF_V5.1", packageHash: "abc123", importedAt: "2026-01-30T12:00:00Z" },
    ...overrides,
  });
  const mockCatalogApi = (pageFor: (path: string) => unknown) => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/manage/audit?limit=25") return Promise.resolve({ data: [] });
      if (path.startsWith("/api/v1/rkf/catalog")) return Promise.resolve(pageFor(path));
      throw new Error(`Unexpected request: ${path}`);
    });
  };

  it("exibe o módulo único do acervo com rótulo honesto de importação", async () => {
    mockCatalogApi(() => catalogPage());
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} initialKind="rkfCatalog" />);
    expect(await screen.findByRole("button", { name: /Acervo mestre RKF/ })).toBeVisible();
    expect(await screen.findByRole("heading", { name: /Acervo mestre RKF/ })).toBeVisible();
    expect(screen.getByText("Acervo importado · validação conforme registro")).toBeVisible();
    expect(screen.queryByText("Fonte canônica")).not.toBeInTheDocument();
    expect(await screen.findByText("910 registros na aba ATLETAS · exibindo 1–1")).toBeVisible();
  });

  it("lista as abas com contagens e troca de aba server-side", async () => {
    mockCatalogApi((path) => {
      const sheet = new URL(`http://local${path}`).searchParams.get("sheet") ?? "";
      if (sheet === "REGRAS") return catalogPage({ data: [{ id: "rg-1", sheet: "REGRAS", name: "Regra 1", status: "active", payload: {} }], total: 42 });
      return catalogPage();
    });
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} initialKind="rkfCatalog" />);
    const atletas = await screen.findByRole("tab", { name: /ATLETAS/ });
    expect(within(atletas).getByText("910")).toBeVisible();
    const regras = screen.getByRole("tab", { name: /REGRAS/ });
    expect(within(regras).getByText("42")).toBeVisible();
    fireEvent.click(regras);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/v1/rkf/catalog?sheet=REGRAS&q=&offset=0&limit=100"));
    expect(await screen.findByText("42 registros na aba REGRAS · exibindo 1–1")).toBeVisible();
  });

  it("faz busca server-side e diferencia total filtrado do total da aba", async () => {
    mockCatalogApi((path) => {
      const q = new URL(`http://local${path}`).searchParams.get("q") ?? "";
      if (q) return catalogPage({ data: [1, 2, 3].map((index) => ({ id: `f-${index}`, sheet: "ATLETAS", name: `Filtrado ${index}`, status: "active", payload: {} })), total: 3, offset: 0 });
      return catalogPage();
    });
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} initialKind="rkfCatalog" />);
    await screen.findByText(/910 registros na aba ATLETAS/);
    fireEvent.change(screen.getByPlaceholderText("Buscar registros"), { target: { value: "ana" } });
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/v1/rkf/catalog?sheet=ATLETAS&q=ana&offset=0&limit=100"));
    expect(await screen.findByText("3 resultados filtrados de 910 na aba ATLETAS · exibindo 1–3")).toBeVisible();
  });

  it("pagina o acervo em lotes de 100", async () => {
    mockCatalogApi((path) => {
      const offset = Number(new URL(`http://local${path}`).searchParams.get("offset") ?? 0);
      return catalogPage({
        data: Array.from({ length: 2 }, (_, index) => ({ id: `at-${offset + index}`, sheet: "ATLETAS", name: `Registro ${offset + index + 1}`, status: "active", payload: {} })),
        total: 910,
        offset,
      });
    });
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} initialKind="rkfCatalog" />);
    expect(await screen.findByText("Registro 1")).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "Próxima página" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/v1/rkf/catalog?sheet=ATLETAS&q=&offset=100&limit=100"));
    expect(await screen.findByText("Registro 101")).toBeVisible();
    expect(await screen.findByText("910 registros na aba ATLETAS · exibindo 101–102")).toBeVisible();
  });

  it("mantém o acervo somente leitura, sem importar, novo, editar ou excluir", async () => {
    mockCatalogApi(() => catalogPage());
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} initialKind="rkfCatalog" createOnOpen />);
    expect(await screen.findByText("Ana do acervo")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Novo" })).not.toBeInTheDocument();
    expect(screen.queryByText("Importar")).not.toBeInTheDocument();
    expect(screen.queryByText("Upload")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Excluir")).not.toBeInTheDocument();
    expect(screen.queryByText(/Novo em/)).not.toBeInTheDocument();
    expect(screen.queryByText("Salvar registro")).not.toBeInTheDocument();
  });

  it("mostra o payload completo no detalhe do registro", async () => {
    mockCatalogApi(() => catalogPage());
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} initialKind="rkfCatalog" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver Ana do acervo" }));
    expect(await screen.findByText("clube")).toBeVisible();
    expect(screen.getByText("Auto")).toBeVisible();
    expect(screen.getByText('{"peso":72}')).toBeVisible();
    expect(screen.getByText("sheet")).toBeVisible();
  });

  it("ignora resposta antiga ao trocar de módulo", async () => {
    let resolveAthletes: ((value: unknown) => void) | undefined;
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/manage/audit?limit=25") return Promise.resolve({ data: [] });
      if (path.startsWith("/api/v1/manage/athletes")) return new Promise((resolve) => { resolveAthletes = resolve; });
      if (path.startsWith("/api/v1/rkf/catalog")) return Promise.resolve(catalogPage({ total: 1 }));
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: /Acervo mestre RKF/ }));
    expect(await screen.findByText("Ana do acervo")).toBeVisible();
    resolveAthletes?.({ data: [{ id: "a-1", name: "Atleta atrasado", status: "active" }], total: 7, offset: 0, limit: 100 });
    await waitFor(() => expect(screen.queryByText("Atleta atrasado")).not.toBeInTheDocument());
    expect(screen.getByText("Ana do acervo")).toBeVisible();
    expect(screen.getByText(/1 registro na aba ATLETAS/)).toBeVisible();
  });

  it("reflete apenas a última busca e o último estado de loading", async () => {
    let resolveStale: ((value: unknown) => void) | undefined;
    mockCatalogApi((path) => {
      const q = new URL(`http://local${path}`).searchParams.get("q") ?? "";
      if (q === "ana") return new Promise((resolve) => { resolveStale = resolve; });
      return catalogPage({ data: [{ id: "q-1", sheet: "ATLETAS", name: `Busca ${q || "geral"}`, status: "active", payload: {} }], total: 1, offset: 0 });
    });
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} initialKind="rkfCatalog" />);
    expect(await screen.findByText("Busca geral")).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText("Buscar registros"), { target: { value: "ana" } });
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/v1/rkf/catalog?sheet=ATLETAS&q=ana&offset=0&limit=100"));
    fireEvent.change(screen.getByPlaceholderText("Buscar registros"), { target: { value: "anas" } });
    expect(await screen.findByText("Busca anas")).toBeVisible();
    resolveStale?.(catalogPage({ data: [{ id: "old", sheet: "ATLETAS", name: "RESPOSTA ANTIGA", status: "active", payload: {} }], total: 99, offset: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("RESPOSTA ANTIGA")).not.toBeInTheDocument();
    expect(screen.getByText("Busca anas")).toBeVisible();
    expect(screen.getByText("1 resultado filtrado de 910 na aba ATLETAS · exibindo 1–1")).toBeVisible();
    expect(screen.queryByText("Carregando registros…")).not.toBeInTheDocument();
  });

  it("não deixa initialKind inválido herdar campos de Atletas silenciosamente", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/manage/audit?limit=25") return Promise.resolve({ data: [] });
      if (path.startsWith("/api/v1/manage/athletes")) return Promise.resolve({ data: [{ id: "a-1", name: "Ana Atleta", status: "active" }], total: 1, offset: 0, limit: 100 });
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<ManagementCenter onClose={() => undefined} onNotify={() => undefined} initialKind={"tipoFuturo" as ManagementKind} />);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/v1/manage/athletes?limit=100&offset=0&q="));
    expect(await screen.findByRole("heading", { name: "Atletas" })).toBeVisible();
    expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining("tipoFuturo"));
  });
});
