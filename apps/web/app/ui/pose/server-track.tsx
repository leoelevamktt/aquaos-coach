"use client";

/**
 * Rastreamento do servidor (AquaVision) desenhado em tempo real sobre o player.
 * Os keyframes vêm da análise persistida (pose RTMO refinada por RTMPose) e o
 * canvas interpola entre amostras sincronizado com o currentTime do vídeo -
 * não há inferência no navegador, só renderização.
 */

import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";

export type TrackedKeyframe = { t: number; persons: Array<{ id: number; kpts: Array<[number, number, number]> }> };
export type PoseAtTime = Array<{ id: number; kpts: Array<[number, number, number]> }>;

/** Conexões do esqueleto COCO-17 (índices do RTMO/RTMPose). */
export const COCO_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 4],
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
];

export const TRACK_COLORS = ["#22d3ee", "#34d399", "#fbbf24", "#f472b6"];
const KEYPOINT_VISIBLE = 0.3;

/** Estado da pose no instante t: interpola linearmente entre keyframes por atleta. */
export function poseAtTime(keyframes: TrackedKeyframe[], t: number): PoseAtTime {
  if (!keyframes.length) return [];
  let previous = keyframes[0];
  let next = keyframes[keyframes.length - 1];
  if (t <= previous.t) return previous.persons;
  if (t >= next.t) return next.persons;
  for (let index = 1; index < keyframes.length; index += 1) {
    if (keyframes[index].t >= t) {
      next = keyframes[index];
      previous = keyframes[index - 1];
      break;
    }
  }
  const span = next.t - previous.t;
  if (span <= 0) return previous.persons;
  const ratio = (t - previous.t) / span;
  const nextById = new Map(next.persons.map((person) => [person.id, person]));
  return previous.persons.map((person) => {
    const match = nextById.get(person.id);
    if (!match) return person;
    return {
      id: person.id,
      kpts: person.kpts.map((point, keypoint) => {
        const target = match.kpts[keypoint];
        if (!target) return point;
        return [
          point[0] + (target[0] - point[0]) * ratio,
          point[1] + (target[1] - point[1]) * ratio,
          Math.min(point[2], target[2]),
        ] as [number, number, number];
      }),
    };
  });
}

/** Desenha os esqueletos rastreados; coordenadas em pixels do vídeo original. */
export function drawTrackedSkeleton(
  context: CanvasRenderingContext2D,
  options: { persons: PoseAtTime; width: number; height: number; videoWidth: number; videoHeight: number },
): void {
  const { persons, width, height, videoWidth, videoHeight } = options;
  context.clearRect(0, 0, width, height);
  if (!videoWidth || !videoHeight) return;
  const scaleX = width / videoWidth;
  const scaleY = height / videoHeight;
  persons.forEach((person, index) => {
    const color = TRACK_COLORS[index % TRACK_COLORS.length];
    const points = person.kpts.map(([x, y]) => ({ x: x * scaleX, y: y * scaleY }));
    const visible = person.kpts.map(([, , score]) => score >= KEYPOINT_VISIBLE);
    context.lineWidth = 3;
    context.strokeStyle = color;
    context.lineCap = "round";
    context.beginPath();
    for (const [from, to] of COCO_CONNECTIONS) {
      if (!visible[from] || !visible[to]) continue;
      context.moveTo(points[from].x, points[from].y);
      context.lineTo(points[to].x, points[to].y);
    }
    context.stroke();
    person.kpts.forEach(([, , score], keypoint) => {
      if (score < KEYPOINT_VISIBLE) return;
      context.beginPath();
      context.arc(points[keypoint].x, points[keypoint].y, 4, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    });
    const nose = points[0];
    if (nose && visible[0]) {
      context.font = "600 13px system-ui, sans-serif";
      context.fillStyle = color;
      context.fillText(`A#${person.id}`, nose.x + 8, nose.y - 8);
    }
  });
}

export function ServerTrackingLayer({
  videoRef,
  active,
  keyframes,
  peopleCount = 0,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active: boolean;
  keyframes: TrackedKeyframe[];
  peopleCount?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const render = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
          canvas.width = canvas.clientWidth;
          canvas.height = canvas.clientHeight;
        }
        const context = canvas.getContext("2d");
        if (context) {
          drawTrackedSkeleton(context, {
            persons: poseAtTime(keyframes, video.currentTime),
            width: canvas.width,
            height: canvas.height,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
          });
        }
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, keyframes, videoRef]);

  if (!active) return null;
  return <>
    <canvas ref={canvasRef} className="pose-tracking-canvas" />
    <span className="pose-tracking-chip"><Sparkles size={12} />AquaVision · {peopleCount} {peopleCount === 1 ? "atleta rastreado" : "atletas rastreados"} · servidor</span>
  </>;
}
