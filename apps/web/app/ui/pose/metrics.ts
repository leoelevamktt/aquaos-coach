/**
 * Motor de métricas biomecânicas em tempo real sobre landmarks de pose.
 * Funções puras e determinísticas: nenhuma dependência de DOM aqui.
 * Modelo de referência: BlazePose (33 pontos, MediaPipe Tasks Vision).
 */

export type Landmark = { x: number; y: number; z?: number; visibility?: number };

export type PoseSample = { time: number; landmarks: Landmark[] };

export type AthleteMetrics = {
  /** Braçadas por minuto (média dos dois membros superiores). */
  cadence: number;
  /** Equilíbrio esquerdo/direito em percentual (0-100). */
  symmetry: number;
  /** Regularidade do intervalo entre ciclos, em percentual (0-100). */
  strokeConsistency: number;
  /** Amplitude média do cotovelo no ciclo, em graus. */
  armRom: number;
  /** Amplitude média do joelho no ciclo, em graus. */
  kneeRom: number;
  /** Rotação média do tronco (eixo dos ombros), em graus. */
  trunkRoll: number;
  /** Estabilidade postural do quadril, em percentual (0-100). */
  stability: number;
  /** Confiança média de detecção dos pontos-chave, em percentual (0-100). */
  confidence: number;
};

export const EMPTY_METRICS: AthleteMetrics = {
  cadence: 0, symmetry: 100, strokeConsistency: 100, armRom: 0, kneeRom: 0,
  trunkRoll: 0, stability: 100, confidence: 0,
};

export const POSE = {
  nose: 0,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
} as const;

const KEY_LANDMARKS = [POSE.leftShoulder, POSE.rightShoulder, POSE.leftElbow, POSE.rightElbow, POSE.leftWrist, POSE.rightWrist, POSE.leftHip, POSE.rightHip];

const WINDOW_MS = 8000;
const MIN_CYCLE_INTERVAL = 0.34;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 0) => Number(value.toFixed(digits));

/** Ângulo interno no vértice `b`, em graus. */
export function angleAt(a: Landmark, b: Landmark, c: Landmark): number {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magnitude = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (!magnitude) return 0;
  return Math.acos(clamp(dot / magnitude, -1, 1)) * (180 / Math.PI);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1)];
}

/** Média móvel centrada para reduzir o ruído do sinal sem atrasar os picos. */
export function smooth(series: number[], window = 5): number[] {
  return series.map((_, index) => {
    const slice = series.slice(Math.max(0, index - Math.floor(window / 2)), index + Math.ceil(window / 2));
    return average(slice);
  });
}

/**
 * Detecta tempos de pico de um sinal periódico (ex.: trajetória vertical do punho).
 * Um pico precisa superar média + 0,4 desvios e respeitar a separação mínima;
 * quando dois picos competem pela mesma janela, fica o de maior amplitude.
 */
export function detectCycleTimes(times: number[], values: number[], minInterval = MIN_CYCLE_INTERVAL): number[] {
  if (times.length < 5) return [];
  const smoothed = smooth(values);
  const mean = average(smoothed);
  const std = Math.sqrt(average(smoothed.map((value) => (value - mean) ** 2))) || 1e-6;
  const threshold = mean + std * 0.4;
  const peaks: Array<{ t: number; v: number }> = [];
  for (let index = 1; index < smoothed.length - 1; index += 1) {
    const value = smoothed[index];
    if (value < threshold || value < smoothed[index - 1] || value <= smoothed[index + 1]) continue;
    const candidate = { t: times[index], v: value };
    const previous = peaks[peaks.length - 1];
    if (previous && candidate.t - previous.t < minInterval) {
      if (candidate.v > previous.v) peaks[peaks.length - 1] = candidate;
      continue;
    }
    peaks.push(candidate);
  }
  return peaks.map((peak) => peak.t);
}

function signalRange(values: number[]): number {
  if (values.length < 2) return 0;
  return percentile(values, 0.9) - percentile(values, 0.1);
}

/** Cadência (por minuto) a partir dos tempos de ciclo detectados. */
export function cadencePerMinute(cycleTimes: number[]): number {
  const intervals = cycleTimes.slice(1).map((time, index) => time - cycleTimes[index]).filter((interval) => interval > MIN_CYCLE_INTERVAL * 1000 * 0.5 && interval < 4000);
  if (!intervals.length) return 0;
  return 60_000 / average(intervals);
}

/** Regularidade dos intervalos: 100 - coeficiente de variação, em percentual. */
export function consistencyScore(cycleTimes: number[]): number {
  const intervals = cycleTimes.slice(1).map((time, index) => time - cycleTimes[index]).filter((interval) => interval > 0);
  if (intervals.length < 2) return 100;
  const mean = average(intervals);
  const deviation = Math.sqrt(average(intervals.map((interval) => (interval - mean) ** 2)));
  return clamp(round(100 - (deviation / Math.max(mean, 1e-6)) * 100), 0, 100);
}

/** Equilíbrio entre dois valores (0 = desbalanceado, 100 = idênticos). */
export function balanceScore(left: number, right: number): number {
  const total = left + right;
  if (total <= 0) return 100;
  return clamp(round(100 - (Math.abs(left - right) / total) * 200), 0, 100);
}

/**
 * Estado rolante de um atleta rastreado: acumula amostras de pose de até 8 s
 * e deriva as métricas biomecânicas em cada novo quadro.
 */
export class AthleteTracker {
  private samples: Array<{ time: number; landmarks: Landmark[] }> = [];
  private latest: AthleteMetrics = { ...EMPTY_METRICS };

  push(sample: PoseSample): AthleteMetrics {
    const last = this.samples[this.samples.length - 1];
    if (!last || sample.time > last.time) this.samples.push({ time: sample.time, landmarks: sample.landmarks });
    this.samples = this.samples.filter((entry) => entry.time >= sample.time - WINDOW_MS);
    this.latest = this.compute(sample.time);
    return this.latest;
  }

  get metrics(): AthleteMetrics {
    return this.latest;
  }

  private compute(now: number): AthleteMetrics {
    if (this.samples.length < 6) return { ...EMPTY_METRICS };
    const times = this.samples.map((sample) => sample.time);
    const pick = (index: number) => this.samples.map((sample) => sample.landmarks[index]);
    const leftWrist = pick(POSE.leftWrist);
    const rightWrist = pick(POSE.rightWrist);
    const confidence = round(clamp(average(KEY_LANDMARKS.flatMap((index) => this.samples.map((sample) => sample.landmarks[index]?.visibility ?? 1))) * 100, 0, 100));

    const leftCycles = detectCycleTimes(times, leftWrist.map((point) => point?.y ?? 0));
    const rightCycles = detectCycleTimes(times, rightWrist.map((point) => point?.y ?? 0));
    const leftCadence = cadencePerMinute(leftCycles);
    const rightCadence = cadencePerMinute(rightCycles);
    const cadences = [leftCadence, rightCadence].filter((value) => value > 0);
    const cadence = round(average(cadences), 1);

    const amplitudeBalance = balanceScore(signalRange(leftWrist.map((point) => point?.y ?? 0)), signalRange(rightWrist.map((point) => point?.y ?? 0)));
    const rhythmBalance = balanceScore(leftCadence, rightCadence);
    const symmetry = cadences.length === 2 ? round(amplitudeBalance * 0.4 + rhythmBalance * 0.6) : amplitudeBalance;

    const elbowAngles = (side: { shoulder: number; elbow: number; wrist: number }) =>
      this.samples.map((sample) => angleAt(sample.landmarks[side.shoulder], sample.landmarks[side.elbow], sample.landmarks[side.wrist]));
    const armRom = round((signalRange(elbowAngles({ shoulder: POSE.leftShoulder, elbow: POSE.leftElbow, wrist: POSE.leftWrist })) + signalRange(elbowAngles({ shoulder: POSE.rightShoulder, elbow: POSE.rightElbow, wrist: POSE.rightWrist }))) / 2);

    const kneeAngles = (side: { hip: number; knee: number; ankle: number }) =>
      this.samples.map((sample) => angleAt(sample.landmarks[side.hip], sample.landmarks[side.knee], sample.landmarks[side.ankle]));
    const kneeRom = round((signalRange(kneeAngles({ hip: POSE.leftHip, knee: POSE.leftKnee, ankle: POSE.leftAnkle })) + signalRange(kneeAngles({ hip: POSE.rightHip, knee: POSE.rightKnee, ankle: POSE.rightAnkle }))) / 2);

    const rolls = this.samples.map((sample) => {
      const left = sample.landmarks[POSE.leftShoulder];
      const right = sample.landmarks[POSE.rightShoulder];
      if (!left || !right) return 0;
      return Math.abs(Math.atan2(Math.abs(left.y - right.y), Math.abs(left.x - right.x)) * (180 / Math.PI));
    });
    const trunkRoll = round(average(rolls), 1);

    const hipJitter = this.samples.map((sample) => {
      const leftHip = sample.landmarks[POSE.leftHip];
      const rightHip = sample.landmarks[POSE.rightHip];
      const leftShoulder = sample.landmarks[POSE.leftShoulder];
      const rightShoulder = sample.landmarks[POSE.rightShoulder];
      if (!leftHip || !rightHip || !leftShoulder || !rightShoulder) return 0;
      const torso = Math.hypot((leftShoulder.x + rightShoulder.x) / 2 - (leftHip.x + rightHip.x) / 2, (leftShoulder.y + rightShoulder.y) / 2 - (leftHip.y + rightHip.y) / 2) || 1e-6;
      const previous = this.samples[Math.max(0, this.samples.indexOf(sample) - 1)].landmarks;
      const previousHip = previous[POSE.leftHip];
      const previousRightHip = previous[POSE.rightHip];
      if (!previousHip || !previousRightHip) return 0;
      return Math.hypot((leftHip.x + rightHip.x) / 2 - (previousHip.x + previousRightHip.x) / 2, (leftHip.y + rightHip.y) / 2 - (previousHip.y + previousRightHip.y) / 2) / torso;
    });
    const stability = clamp(round(100 - average(hipJitter) * 2400), 0, 100);

    return {
      cadence,
      symmetry,
      strokeConsistency: consistencyScore([...leftCycles, ...rightCycles].sort((a, b) => a - b)),
      armRom, kneeRom, trunkRoll, stability, confidence,
    };
  }
}

type PoseTrack = { id: number; lastSeen: number; centroid: { x: number; y: number }; tracker: AthleteTracker; results?: TrackedAthlete };

function centroidOf(landmarks: Landmark[]): { x: number; y: number } {
  const shoulders = [landmarks[POSE.leftShoulder], landmarks[POSE.rightShoulder]];
  const hips = [landmarks[POSE.leftHip], landmarks[POSE.rightHip]];
  const anchors = [...shoulders, ...hips].filter(Boolean);
  if (!anchors.length) return { x: landmarks[0]?.x ?? 0, y: landmarks[0]?.y ?? 0 };
  return { x: average(anchors.map((point) => point.x)), y: average(anchors.map((point) => point.y)) };
}

/**
 * Associa detecções a trilhas estáveis ao longo do vídeo: o "Atleta 1" de um
 * quadro continua sendo o Atleta 1 no seguinte, mesmo com oclusões curtas
 * (até 1,5 s) ou entradas e saídas de outros corpos no quadro.
 */
export class PoseTracker {
  private tracks: PoseTrack[] = [];
  private nextId = 0;
  private readonly maxTracks: number;
  private readonly holdMs: number;

  constructor(options: { maxTracks?: number; holdMs?: number } = {}) {
    this.maxTracks = options.maxTracks ?? 4;
    this.holdMs = options.holdMs ?? 1500;
  }

  /** Recebe as poses detectadas no quadro (uma entrada por pessoa). */
  update(time: number, poses: Landmark[][]): TrackedAthlete[] {
    const matched = new Set<PoseTrack>();
    const assigned = new Set<number>();

    const pairs: Array<{ track: PoseTrack; index: number; distance: number }> = [];
    for (const track of this.tracks) {
      poses.forEach((landmarks, index) => {
        if (assigned.has(index)) return;
        const centroid = centroidOf(landmarks);
        const distance = Math.hypot(centroid.x - track.centroid.x, centroid.y - track.centroid.y);
        if (distance < 0.3) pairs.push({ track, index, distance });
      });
    }
    pairs.sort((a, b) => a.distance - b.distance);
    for (const pair of pairs) {
      if (matched.has(pair.track) || assigned.has(pair.index)) continue;
      matched.add(pair.track);
      assigned.add(pair.index);
      const landmarks = poses[pair.index];
      pair.track.centroid = centroidOf(landmarks);
      pair.track.lastSeen = time;
      pair.track.results = { id: pair.track.id, metrics: pair.track.tracker.push({ time, landmarks }), landmarks };
    }
    poses.forEach((landmarks, index) => {
      if (assigned.has(index)) return;
      const active = this.tracks.filter((track) => time - track.lastSeen <= this.holdMs).length;
      if (active >= this.maxTracks) return;
      const track: PoseTrack = { id: this.nextId++, lastSeen: time, centroid: centroidOf(landmarks), tracker: new AthleteTracker() };
      track.results = { id: track.id, metrics: track.tracker.push({ time, landmarks }), landmarks };
      this.tracks.push(track);
    });
    this.tracks = this.tracks.filter((track) => time - track.lastSeen <= this.holdMs * 4);
    return this.tracks
      .filter((track) => time - track.lastSeen <= this.holdMs && track.results)
      .map((track) => track.results!);
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 0;
  }
}

export type TrackedAthlete = { id: number; metrics: AthleteMetrics; landmarks: Landmark[] };
