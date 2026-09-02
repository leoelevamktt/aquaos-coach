import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { AuthGate, SKIP_DEMO_LOGIN_KEY } from "../auth-gate";
import { apiRequest } from "../api";

vi.mock("../api", () => ({
  apiRequest: vi.fn(),
}));

const mockedApi = vi.mocked(apiRequest);

const coachUser = { id: "u1", name: "Leonardo", email: "coach@rkf.local", role: "coach" };
const athleteUser = { id: "u2", name: "Ana Souza", email: "ana@rkf.local", role: "athlete", athleteId: "ana-souza" };

function meResponse(user: typeof coachUser | typeof athleteUser) {
  return { user };
}

describe("AuthGate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    // Production mode: no dev auto-login fallback.
    vi.stubEnv("NODE_ENV", "production");
  });

  it("mostra tela de login quando não há sessão em produção", async () => {
    mockedApi.mockRejectedValueOnce(new Error("sem sessão"));
    render(
      <AuthGate>
        <div>Painel interno</div>
      </AuthGate>,
    );

    expect(mockedApi).toHaveBeenCalledWith("/api/v1/auth/me");

    const emailInput = await screen.findByPlaceholderText("treinador@elevamkt.digital");
    const passwordInput = screen.getByPlaceholderText("••••••••••");
    expect(emailInput).toBeInTheDocument();
    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute("type", "password");
    // Children ficam protegidos atrás do gate.
    expect(screen.queryByText("Painel interno")).not.toBeInTheDocument();
  });

  it("sessão de atleta mostra interstitial 'Acesso do treinador' com link para o app do atleta", async () => {
    mockedApi.mockResolvedValueOnce(meResponse(athleteUser));
    render(
      <AuthGate>
        <div>Painel interno</div>
      </AuthGate>,
    );

    expect(await screen.findByText("Acesso do treinador")).toBeInTheDocument();
    const athleteLink = screen.getByText("Ir para o app do atleta").closest("a");
    expect(athleteLink).toHaveAttribute("href", "/pt/athlete/welcome");
    // Children não são renderizados para atleta.
    expect(screen.queryByText("Painel interno")).not.toBeInTheDocument();
  });

  it("sessão de coach renderiza children", async () => {
    mockedApi.mockResolvedValueOnce(meResponse(coachUser));
    render(
      <AuthGate>
        <div>Painel interno</div>
      </AuthGate>,
    );

    await waitFor(() => expect(screen.getByText("Painel interno")).toBeInTheDocument());
    expect(screen.queryByText("Acesso do treinador")).not.toBeInTheDocument();
  });

  it("sessão de admin também renderiza children", async () => {
    mockedApi.mockResolvedValueOnce({ user: { ...coachUser, role: "admin" } });
    render(
      <AuthGate>
        <div>Painel interno</div>
      </AuthGate>,
    );

    await waitFor(() => expect(screen.getByText("Painel interno")).toBeInTheDocument());
  });

  it("não refaz o auto-login demo após um logout explícito em desenvolvimento", async () => {
    vi.stubEnv("NODE_ENV", "development");
    window.sessionStorage.setItem(SKIP_DEMO_LOGIN_KEY, "1");
    mockedApi.mockRejectedValueOnce(new Error("sem sessão"));

    render(
      <AuthGate>
        <div>Painel interno</div>
      </AuthGate>,
    );

    expect(await screen.findByPlaceholderText("treinador@elevamkt.digital")).toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledTimes(1);
    expect(mockedApi).toHaveBeenCalledWith("/api/v1/auth/me");
  });
});
