/**
 * Renderização do esqueleto rastreado sobre um canvas 2D.
 * Funções puras: recebem o contexto e desenham, sem tocar em estado global.
 */

export type PosePoint = { x: number; y: number };

/** Conexões do esqueleto BlazePose (índices de landmarks do MediaPipe). */
export const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

const PALETTE = ["#22d3ee", "#34d399", "#fbbf24", "#f472b6"];

export function drawPoseOverlay(
  canvas: HTMLCanvasElement,
  options: {
    athletes: Array<{ landmarks: Array<{ x: number; y: number; visibility?: number }>; label?: string; color?: string }>;
    scale?: { width: number; height: number };
  },
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  options.athletes.forEach((athlete, index) => {
    const color = athlete.color ?? PALETTE[index % PALETTE.length];
    const points = athlete.landmarks.map((landmark) => ({ x: landmark.x * width, y: landmark.y * height }));
    context.lineWidth = 3;
    context.strokeStyle = color;
    context.lineCap = "round";
    context.beginPath();
    for (const [from, to] of POSE_CONNECTIONS) {
      const fromPoint = points[from];
      const toPoint = points[to];
      if (!fromPoint || !toPoint) continue;
      context.moveTo(fromPoint.x, fromPoint.y);
      context.lineTo(toPoint.x, toPoint.y);
    }
    context.stroke();
    for (const point of points) {
      context.beginPath();
      context.arc(point.x, point.y, 4, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    }
    const label = athlete.label;
    if (label) {
      const head = points[0];
      if (head) {
        context.font = "600 13px system-ui, sans-serif";
        context.fillStyle = color;
        context.fillText(label, head.x + 8, head.y - 8);
      }
    }
  });
}
