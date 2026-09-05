import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { VisionCoachPanel } from "../vision-coach";

const apiRequest = vi.fn();

vi.mock("../api", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));

describe("VisionCoachPanel", () => {
  beforeEach(() => { apiRequest.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it("pede o relatório completo e renderiza a resposta do treinador", async () => {
    apiRequest.mockResolvedValueOnce({ reply: "Relatório: atleta #7 com cadência estável." });
    render(<VisionCoachPanel videoId="video-1" hasAnalysis playing={false} currentTime={0} seek={() => undefined} engine="AquaVision" />);
    fireEvent.click(screen.getByRole("button", { name: /Relatório do treinador/ }));
    await waitFor(() => expect(screen.getByText(/cadência estável/)).toBeInTheDocument());
    expect(apiRequest).toHaveBeenCalledOnce();
    const [url, init] = apiRequest.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/ai/vision-coach/report");
    expect(JSON.parse(String(init.body))).toEqual({ videoId: "video-1" });
  });

  it("mostra o erro do servidor sem quebrar o painel", async () => {
    apiRequest.mockRejectedValueOnce(new Error("Assistente indisponível: configure LLM_API_KEY no ambiente da API."));
    render(<VisionCoachPanel videoId="video-1" hasAnalysis playing={false} currentTime={0} seek={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Relatório do treinador/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("LLM_API_KEY"));
  });

  it("desativa botões quando o vídeo não tem análise", () => {
    render(<VisionCoachPanel videoId="video-1" hasAnalysis={false} playing={false} currentTime={0} seek={() => undefined} />);
    expect(screen.getByRole("button", { name: /Relatório do treinador/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Análise ao vivo/ })).toBeDisabled();
  });

  it("liga a análise ao vivo e publica a primeira observação", async () => {
    apiRequest.mockResolvedValue({ reply: "Agora: braçada longa com boa amplitude." });
    render(<VisionCoachPanel videoId="video-1" hasAnalysis playing currentTime={4.2} seek={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Análise ao vivo/ }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
    const [url, init] = apiRequest.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/ai/vision-coach/live");
    expect(JSON.parse(String(init.body))).toEqual({ videoId: "video-1", currentTime: 4.2, windowSeconds: 4 });
    await waitFor(() => expect(screen.getByText(/boa amplitude/)).toBeInTheDocument());
    expect(screen.getByText("4.2s")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ao vivo · comentando/ })).toBeInTheDocument();
  });
});
