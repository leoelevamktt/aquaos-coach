import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { VideoReview } from "../modals";

const apiRequest = vi.fn();

vi.mock("../api", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  mediaUrl: (path?: string) => path,
  subscribeToLiveEvents: () => () => undefined,
  uploadFile: vi.fn(),
}));

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterAll(() => vi.restoreAllMocks());
afterEach(() => apiRequest.mockReset());

describe("VideoReview", () => {
  it("busca somente a janela temporal de poses do AquaVision", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/videos/video-janela/track-assignments") {
        return Promise.resolve({ assignments: [], currentByTrack: {}, athletes: [] });
      }
      if (path.includes("/keyframes?")) return Promise.resolve({ keyframes: [{ t: 0, persons: [{ id: 1, kpts: [[1, 2, .9]] }] }] });
      if (path.startsWith("/api/v1/manage/videos?")) return Promise.resolve({data:[]});
      if (path !== "/api/v1/manage/videos/video-janela") throw new Error(`Unexpected request: ${path}`);
      return Promise.resolve({
        id: "video-janela",
        analysisStatus: "ready",
        analysis: {
          engine: "AquaVision",
          metadata: { durationSeconds: 60, width: 1080, height: 608, fps: 30, sizeBytes: 1, bitrate: 1 },
          metrics: { detectedCycles: 0, estimatedCadence: 0, rhythmConsistency: 0, meanMotion: 0, peakMotion: 0 },
          timeline: [], events: [], people: [{ id: 1, strokes: 0, strokeRate: 0, rhythmConsistency: 0, avgSpeed: 0, maxSpeed: 0, distance: 0, distancePerStroke: 0, meanConfidence: .9, coverage: 100, firstSeen: 0, lastSeen: 60, durationSeconds: 60 }],
          keyframeSegments: [{ from: 0, to: 10, count: 60 }],
        },
      });
    });
    render(<VideoReview videoId="video-janela" onClose={() => undefined} onSave={() => undefined} />);
    fireEvent.click(await screen.findByRole("tab", {name:"Medições"}));
    fireEvent.click(await screen.findByLabelText("Exibir rastreamento disponível"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/api/v1/videos/video-janela/keyframes?from=0&to=5"));
  });

  it("mantém o vídeo comparativo sem áudio para reprodução sincronizada", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/manage/videos/video-principal") {
        return Promise.resolve({ id: "video-principal", title: "Principal", url: "/principal.mp4", durationSeconds: 20 });
      }
      if (path.startsWith("/api/v1/manage/videos?")) {
        return Promise.resolve({ data: [
          { id: "video-principal", title: "Principal", url: "/principal.mp4" },
          { id: "video-comparativo", title: "Comparativo", url: "/comparativo.mp4" },
        ] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const { container } = render(<VideoReview videoId="video-principal" onClose={() => undefined} onSave={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Comparar com"), { target: { value: "video-comparativo" } });
    await waitFor(() => expect(container.querySelectorAll("video")).toHaveLength(2));
    expect((container.querySelectorAll("video")[1] as HTMLVideoElement).muted).toBe(true);
  });

  it("inicia os dois players na mesma ação do treinador", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/manage/videos/video-principal") {
        return Promise.resolve({ id: "video-principal", title: "Principal", url: "/principal.mp4", durationSeconds: 20 });
      }
      if (path.startsWith("/api/v1/manage/videos?")) {
        return Promise.resolve({ data: [
          { id: "video-principal", title: "Principal", url: "/principal.mp4" },
          { id: "video-comparativo", title: "Comparativo", url: "/comparativo.mp4" },
        ] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const { container } = render(<VideoReview videoId="video-principal" onClose={() => undefined} onSave={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Comparar com"), { target: { value: "video-comparativo" } });
    await waitFor(() => expect(container.querySelectorAll("video")).toHaveLength(2));
    const [primary] = [...container.querySelectorAll("video")];
    let releasePrimary: () => void = () => undefined;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      if (this === primary) return new Promise<void>((resolve) => { releasePrimary = resolve; });
      return Promise.resolve();
    });

    fireEvent.click(container.querySelector(".studio-play") as HTMLButtonElement);
    expect(play).toHaveBeenCalledTimes(2);
    releasePrimary();
    play.mockRestore();
  });

  it("trata a rejeição do vídeo comparativo sem promise não observada", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/manage/videos/video-principal") return Promise.resolve({ id: "video-principal", title: "Principal", url: "/principal.mp4", durationSeconds: 20 });
      if (path.startsWith("/api/v1/manage/videos?")) return Promise.resolve({ data: [
        { id: "video-principal", title: "Principal", url: "/principal.mp4" },
        { id: "video-comparativo", title: "Comparativo", url: "/comparativo.mp4" },
      ] });
      throw new Error(`Unexpected request: ${path}`);
    });

    const { container } = render(<VideoReview videoId="video-principal" onClose={() => undefined} onSave={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Comparar com"), { target: { value: "video-comparativo" } });
    await waitFor(() => expect(container.querySelectorAll("video")).toHaveLength(2));
    const [primary] = [...container.querySelectorAll("video")];
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      return this === primary ? Promise.resolve() : Promise.reject(new Error("play blocked"));
    });

    fireEvent.click(container.querySelector(".studio-play") as HTMLButtonElement);
    expect(await screen.findByText("Não foi possível reproduzir o vídeo comparativo.")).toBeVisible();
    play.mockRestore();
  });

  it("expõe diagnóstico técnico, métricas validadas e cobertura por track", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/manage/videos?")) return Promise.resolve({ data: [] });
      if (path === "/api/v1/manage/videos/video-diagnostico") {
        return Promise.resolve({
          id: "video-diagnostico", title: "Diagnóstico", url: "/diagnostico.mp4", durationSeconds: 30,
          analysisStatus: "ready",
          analysis: {
            engine: "AquaVision", engineVersion: "2.0", methodology: "Pose e rastreamento sincronizados.", analyzedAt: "2026-09-10T10:00:00.000Z",
            metadata: { durationSeconds: 30, width: 1280, height: 720, fps: 60, sizeBytes: 1000, bitrate: 2000, calibrated: true, sampleFps: 12, persons: 1 },
            metrics: { detectedCycles: 12, estimatedCadence: 36, rhythmConsistency: 88, meanMotion: 52, peakMotion: 94 },
            sportMetrics: { contractVersion: "1", metrics: [{ id: "avgSpeed", status: "measured", unit: "m/s", interval: { startSeconds: 0, endSeconds: 30 }, coverage: .92, source: "pose", sourceVersion: "2", value: 1.72 }] },
            timeline: [{time:0,motion:20},{time:15,motion:80},{time:30,motion:45}], events: [],
            people: [{ id: 7, strokes: 18, strokeRate: 36, rhythmConsistency: 88, avgSpeed: 1.72, maxSpeed: 2.1, distance: 50, distancePerStroke: 2.78, meanConfidence: .91, coverage: 92, firstSeen: 0, lastSeen: 30, durationSeconds: 30 }],
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<VideoReview videoId="video-diagnostico" onClose={() => undefined} onSave={() => undefined} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Diagnóstico" }));
    expect(screen.getByText("Pose e rastreamento sincronizados.")).toBeVisible();
    expect(screen.getAllByText("1,72 m/s").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2,78 m/ciclo")).toBeVisible();
    expect(screen.getByText("92% cobertura")).toBeVisible();
  });

  it("não apresenta pixels ou ausência de cobertura como métricas aquáticas", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/manage/videos?")) return Promise.resolve({ data: [] });
      if (path === "/api/v1/manage/videos/video-sem-calibracao") return Promise.resolve({
        id: "video-sem-calibracao", title: "Sem calibração", url: "/raw.mp4", analysisStatus: "ready",
        analysis: {
          engine: "AquaVision", engineVersion: "2.0", methodology: "Pose em pixels.",
          metadata: { durationSeconds: 10, width: 640, height: 360, fps: 30, sizeBytes: 1, bitrate: 1, calibrated: false, persons: 1 },
          metrics: { meanMotion: 20, peakMotion: 50 }, timeline: [], events: [],
          people: [{ id: 3, firstSeen: 0, lastSeen: 10, durationSeconds: 10, avgSpeed: 1.72, maxSpeed: 2.1, distance: 50, distancePerStroke: 2.78, meanConfidence: .8, validity: { avgSpeed: "uncalibrated", maxSpeed: "uncalibrated", distance: "uncalibrated", distancePerStroke: "uncalibrated" } }],
        },
      });
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<VideoReview videoId="video-sem-calibracao" onClose={() => undefined} onSave={() => undefined} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Diagnóstico" }));
    expect(screen.queryByText("1,72 m/s")).not.toBeInTheDocument();
    expect(screen.queryByText("0% cobertura")).not.toBeInTheDocument();
    expect(screen.getAllByText("Sem calibração").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("— cobertura")).toBeVisible();
  });
});
