"use client";

import { useEffect, useRef, useState } from "react";
import { createPoseSession, type ModelTier, type PoseSession, type TrackedAthlete } from "./engine";
import { drawPoseOverlay } from "./overlay";

export type PoseStatus = "idle" | "loading" | "running" | "error";

type PoseLoopParams = {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  numPoses: number;
  model: ModelTier;
  labelPrefix?: string;
};

/**
 * Loop de análise em tempo real: cria a sessão MediaPipe quando `enabled`,
 * processa cada quadro novo do vídeo, desenha o esqueleto no canvas e publica
 * as métricas no estado React em ~4 Hz para não storm de re-render.
 */
export function usePoseAnalysis({ enabled, videoRef, canvasRef, numPoses, model, labelPrefix = "Atleta" }: PoseLoopParams) {
  const [status, setStatus] = useState<PoseStatus>("idle");
  const [error, setError] = useState("");
  const [athletes, setAthletes] = useState<TrackedAthlete[]>([]);
  const [fps, setFps] = useState(0);
  const [inferenceMs, setInferenceMs] = useState(0);

  const sessionRef = useRef<PoseSession | null>(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(-1);
  const frameTimesRef = useRef<number[]>([]);
  const uiClockRef = useRef(0);
  const latestRef = useRef<TrackedAthlete[]>([]);
  const processFailuresRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let disposed = false;
    setStatus("loading");
    setError("");

    const tick = () => {
      const session = sessionRef.current;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!session || !video || !canvas || disposed) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }
      if (video.readyState >= 2 && video.currentTime !== lastFrameRef.current) {
        lastFrameRef.current = video.currentTime;
        void session.process(video, performance.now()).then((output) => {
          if (!output || disposed) return;
          processFailuresRef.current = 0;
          latestRef.current = output.athletes;
          frameTimesRef.current = [...frameTimesRef.current.slice(-60), performance.now()];
          drawPoseOverlay(canvas, {
            athletes: output.athletes.map((athlete) => ({
              landmarks: athlete.landmarks,
              label: `${labelPrefix} ${athlete.id + 1} · ${Math.round(athlete.metrics.cadence)}/min`,
            })),
          });
          const now = performance.now();
          if (now - uiClockRef.current > 250) {
            uiClockRef.current = now;
            setAthletes(output.athletes);
            setInferenceMs(output.inferenceMs);
            setFps(frameTimesRef.current.filter((time) => now - time <= 1000).length);
          }
        }).catch((cause) => {
          // Falhas de inferência não podem passar em silêncio: após algumas
          // tentativas consecutivas a UI precisa saber que o motor falhou.
          if (disposed) return;
          processFailuresRef.current += 1;
          if (processFailuresRef.current >= 3) {
            setStatus("error");
            setError(cause instanceof Error ? cause.message : "Falha na inferência de pose.");
          }
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        const session = await createPoseSession({ numPoses, model });
        if (cancelled) { void session.close(); return; }
        sessionRef.current = session;
        lastFrameRef.current = -1;
        setStatus("running");
        rafRef.current = requestAnimationFrame(tick);
      } catch (cause) {
        if (cancelled) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar o motor de análise.");
      }
    })();

    return () => {
      cancelled = true;
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      const session = sessionRef.current;
      sessionRef.current = null;
      latestRef.current = [];
      frameTimesRef.current = [];
      setAthletes([]);
      if (session) void session.close();
      setStatus("idle");
    };
  }, [enabled, numPoses, model, videoRef, canvasRef, labelPrefix]);

  return { status, error, athletes, fps, inferenceMs };
}

export type { TrackedAthlete };
