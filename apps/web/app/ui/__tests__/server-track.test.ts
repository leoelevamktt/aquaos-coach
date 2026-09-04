import { describe, expect, it, vi } from "vitest";
import { COCO_CONNECTIONS, TRACK_COLORS, drawTrackedSkeleton, poseAtTime, type TrackedKeyframe } from "../pose/server-track";
import { buildVisionSummaryPrompt } from "../modals";

const keyframes: TrackedKeyframe[] = [
  { t: 0, persons: [{ id: 7, kpts: Array.from({ length: 17 }, () => [100, 50, 0.9] as [number, number, number]) }] },
  { t: 1, persons: [{ id: 7, kpts: Array.from({ length: 17 }, () => [200, 90, 0.8] as [number, number, number]) }] },
];

describe("poseAtTime", () => {
  it("interpola linearmente entre keyframes do mesmo atleta", () => {
    const persons = poseAtTime(keyframes, 0.5);
    expect(persons).toHaveLength(1);
    expect(persons[0].id).toBe(7);
    expect(persons[0].kpts[0][0]).toBe(150);
    expect(persons[0].kpts[0][1]).toBe(70);
    expect(persons[0].kpts[0][2]).toBeCloseTo(0.8, 5);
  });

  it("ancora nos extremos antes do primeiro e depois do último keyframe", () => {
    expect(poseAtTime(keyframes, -1)[0].kpts[0][0]).toBe(100);
    expect(poseAtTime(keyframes, 99)[0].kpts[0][0]).toBe(200);
  });

  it("mantém o atleta presente em um só lado da interpolação", () => {
    const staggered: TrackedKeyframe[] = [
      { t: 0, persons: [{ id: 1, kpts: Array.from({ length: 17 }, () => [10, 10, 0.9] as [number, number, number]) }] },
      { t: 1, persons: [
        { id: 1, kpts: Array.from({ length: 17 }, () => [20, 10, 0.9] as [number, number, number]) },
        { id: 2, kpts: Array.from({ length: 17 }, () => [30, 10, 0.9] as [number, number, number]) },
      ] },
    ];
    const persons = poseAtTime(staggered, 0.5);
    expect(persons.map((person) => person.id)).toEqual([1]);
  });

  it("retorna vazio sem keyframes", () => {
    expect(poseAtTime([], 1)).toEqual([]);
  });
});

describe("drawTrackedSkeleton", () => {
  const makeContext = () => {
    const moveTo = vi.fn<(x: number, y: number) => void>();
    const fillText = vi.fn<(text: string, x: number, y: number) => void>();
    const arc = vi.fn<(x: number, y: number, r: number, start: number, end: number) => void>();
    const state = { strokeStyles: [] as string[] };
    const context = {
      clearRect: vi.fn(), beginPath: vi.fn(), moveTo, lineTo: vi.fn(), stroke: vi.fn(),
      arc, fill: vi.fn(), fillText,
      set lineWidth(value: number) { /* registado só quando relevante */ },
      set strokeStyle(value: string) { state.strokeStyles.push(value); },
      set lineCap(value: string) { /* idem */ },
      set fillStyle(value: string) { /* idem */ },
      set font(value: string) { /* idem */ },
    } as unknown as CanvasRenderingContext2D;
    return { context, moveTo, fillText, arc, strokeStyles: state.strokeStyles };
  };

  it("escala coordenadas do vídeo original para o canvas e ignora keypoints fracos", () => {
    const { context, moveTo, fillText, arc } = makeContext();
    const kpts = Array.from({ length: 17 }, () => [100, 50, 0.9] as [number, number, number]);
    kpts[9] = [120, 60, 0.1]; // punho fraco: não desenha
    drawTrackedSkeleton(context, {
      persons: [{ id: 7, kpts }],
      width: 500,
      height: 250,
      videoWidth: 1000,
      videoHeight: 500,
    });
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 500, 250);
    // Primeira conexão COCO (nariz-olho) usa o keypoint 0 escalado por 0.5.
    expect(moveTo).toHaveBeenCalledWith(50, 25);
    expect(fillText).toHaveBeenCalledWith("A#7", 58, 17);
    // 17 conexões COCO menos as que tocam o punho fraco (índice 9): [7, 9].
    expect(moveTo.mock.calls.length).toBe(COCO_CONNECTIONS.length - 1);
    // Nenhum arco para o keypoint fraco: 16 pontos desenhados.
    expect(arc).toHaveBeenCalledTimes(16);
  });

  it("não desenha sem dimensões de vídeo", () => {
    const { context, moveTo } = makeContext();
    drawTrackedSkeleton(context, { persons: [{ id: 1, kpts: [[1, 1, 1]] }], width: 10, height: 10, videoWidth: 0, videoHeight: 0 });
    expect(moveTo).not.toHaveBeenCalled();
  });

  it("usa a paleta compartilhada por ordem de aparição", () => {
    const { context, strokeStyles } = makeContext();
    const kpts = Array.from({ length: 17 }, () => [10, 10, 0.9] as [number, number, number]);
    drawTrackedSkeleton(context, {
      persons: [{ id: 1, kpts }, { id: 2, kpts }],
      width: 100, height: 100, videoWidth: 100, videoHeight: 100,
    });
    expect(strokeStyles).toEqual([TRACK_COLORS[0], TRACK_COLORS[1]]);
  });
});

describe("buildVisionSummaryPrompt", () => {
  const analysis = {
    engine: "AquaVision",
    engineVersion: "1.0",
    methodology: "pose",
    metadata: { durationSeconds: 17, width: 608, height: 1080, fps: 59.94, sizeBytes: 1, bitrate: 1, units: "px", calibrated: false, persons: 2 },
    metrics: { detectedCycles: 9, estimatedCadence: 58, rhythmConsistency: 91, meanMotion: 40, peakMotion: 100, technicalIndex: 84 },
    timeline: [{ time: 0, motion: 10 }],
    events: [],
    people: [
      { id: 7, firstSeen: 0, lastSeen: 17, durationSeconds: 17, strokes: 9, strokeRate: 58, rhythmConsistency: 91, avgSpeed: 1.2, maxSpeed: 2.1, distance: 20.4, distancePerStroke: 2.3, technicalIndex: 84, meanConfidence: 0.81, coverage: 87.5, strokeSignal: "punho esq. (y)" },
    ],
    keyframes: [{ t: 0, persons: [{ id: 7, kpts: [[1, 2, 0.9]] }] }],
  } as Parameters<typeof buildVisionSummaryPrompt>[0];

  it("serializa motor, métricas e atletas com os números da análise", () => {
    const prompt = buildVisionSummaryPrompt(analysis);
    expect(prompt).toContain("AquaVision 1.0");
    expect(prompt).toContain("9 braçadas em 17 s (58/min");
    expect(prompt).toContain("1.2 px/s");
    expect(prompt).toContain("sem calibração (unidades em pixels)");
    expect(prompt).toContain("cobertura 87.5%");
    expect(prompt).toContain("punho esq. (y)");
  });

  it("degrada sem pessoas rastreadas", () => {
    const prompt = buildVisionSummaryPrompt({ ...analysis, people: [] });
    expect(prompt).toContain("Nenhum atleta rastreado individualmente");
  });
});
