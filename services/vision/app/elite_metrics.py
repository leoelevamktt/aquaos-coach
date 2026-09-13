"""Métricas biomecânicas avançadas do AquaVision Elite.

Este módulo transforma landmarks 2D, trajetória rastreada e ciclos detectados
em medidas auditáveis. Ele é deliberadamente conservador: uma métrica só
recebe valor quando há observação suficiente; grandezas absolutas em metros
exigem calibração válida; grandezas 3D/hidrodinâmicas impossíveis em vídeo
monocular permanecem explicitamente indisponíveis.

`confidence` é um índice de qualidade da evidência (0-100), não uma
probabilidade estatística de acerto nem uma alegação clínica/laboratorial.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np

from .calibration import Calibration, apply_homography
from .metrics import TrackMetrics, speed_series
from .strokes import StrokeStats, autocorrelation_periodicity, detect_peaks_hysteresis
from .tracker import KEYPOINT_VALID_THRESHOLD, Track, TrackSample

CONTRACT_VERSION = "sports-metrics/v2"
BIOMECHANICS_VERSION = "aquavision-biomechanics/2.0"

# COCO-17
NOSE = 0
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16

STROKE_CONVENTION = {
    "livre": "Um ciclo completo usa duas ações alternadas de braço; a periodicidade de um mesmo punho representa um ciclo.",
    "costas": "Um ciclo completo usa duas ações alternadas de braço; a periodicidade de um mesmo punho representa um ciclo.",
    "borboleta": "Um ciclo corresponde à ação simultânea dos dois braços.",
    "peito": "Um ciclo corresponde à ação simultânea dos dois braços.",
    "medley": "A convenção varia por trecho e exige identificação do estilo do segmento.",
    "unknown": "Ciclo é a periodicidade dominante de um landmark; não é promovido a convenção de estilo sem contexto confirmado.",
}


@dataclass(frozen=True)
class PeriodicSignal:
    rate: float
    period: float
    score: float
    axis: int
    peaks: list[float]


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _percentile(values: Iterable[float], percentile: float) -> float | None:
    array = np.asarray([value for value in values if np.isfinite(value)], dtype=np.float64)
    return float(np.percentile(array, percentile)) if array.size else None


def _mean_confidence(samples: list[TrackSample]) -> float:
    values: list[float] = []
    for sample in samples:
        valid = sample.keypoint_scores[sample.keypoint_scores > KEYPOINT_VALID_THRESHOLD]
        if valid.size:
            values.append(float(valid.mean()))
    return float(np.mean(values)) if values else 0.0


def _quality(track: Track, metrics: TrackMetrics, sample_rate: float, width: int, height: int) -> dict:
    pose_samples = track.pose_samples
    pose_confidence = _mean_confidence(pose_samples)
    coverage = _clamp(metrics.coverage)
    continuity = _clamp(100.0 * metrics.observed_duration_seconds / max(metrics.duration_seconds, 1e-9))
    temporal = _clamp(100.0 * min(1.0, sample_rate / 12.0))
    resolution = _clamp(100.0 * min(1.0, min(width or 0, height or 0) / 720.0)) if width and height else 0.0
    score = _clamp(
        0.34 * coverage
        + 0.30 * pose_confidence * 100.0
        + 0.18 * continuity
        + 0.10 * temporal
        + 0.08 * resolution
    )
    grade = "A" if score >= 88 else "B" if score >= 76 else "C" if score >= 62 else "D"
    return {
        "score": round(score, 1),
        "grade": grade,
        "poseCoverage": round(coverage, 1),
        "meanPoseConfidence": round(pose_confidence * 100.0, 1),
        "trackingContinuity": round(continuity, 1),
        "sampleFps": round(sample_rate, 2),
        "resolution": f"{width}x{height}",
        "confidenceKind": "evidence_quality_index_not_probability",
        "note": "Índice de qualidade da evidência visual; não representa acurácia clínica/laboratorial.",
    }


def _metric(
    metric_id: str,
    label: str,
    group: str,
    unit: str,
    interval: dict,
    coverage: float,
    source: str,
    source_version: str,
    *,
    value: float | int | None = None,
    status: str = "measured",
    confidence: float = 0.0,
    method: str,
    unavailable_reason: str | None = None,
    evidence: dict | None = None,
) -> dict:
    item = {
        "id": metric_id,
        "label": label,
        "group": group,
        "status": status,
        "unit": unit,
        "interval": interval,
        "coverage": round(_clamp(coverage), 1),
        "source": source,
        "sourceVersion": source_version,
        "confidence": round(_clamp(confidence), 1),
        "confidenceKind": "evidence_quality_index_not_probability",
        "method": method,
    }
    if value is not None and np.isfinite(float(value)):
        item["value"] = round(float(value), 3)
    if unavailable_reason:
        item["unavailableReason"] = unavailable_reason
    if evidence:
        item["evidence"] = evidence
    return item


def _unavailable(metric_id: str, label: str, group: str, unit: str, interval: dict, coverage: float, source: str, source_version: str, reason: str, method: str) -> dict:
    return _metric(
        metric_id, label, group, unit, interval, coverage, source, source_version,
        status="not_validated", confidence=0.0, method=method, unavailable_reason=reason,
    )


def _joint_angles(samples: list[TrackSample], a: int, b: int, c: int) -> tuple[list[float], int]:
    values: list[float] = []
    for sample in samples:
        if min(sample.keypoint_scores[a], sample.keypoint_scores[b], sample.keypoint_scores[c]) <= KEYPOINT_VALID_THRESHOLD:
            continue
        va = sample.keypoints[a] - sample.keypoints[b]
        vc = sample.keypoints[c] - sample.keypoints[b]
        denominator = float(np.linalg.norm(va) * np.linalg.norm(vc))
        if denominator <= 1e-9:
            continue
        cosine = float(np.clip(np.dot(va, vc) / denominator, -1.0, 1.0))
        values.append(float(np.degrees(np.arccos(cosine))))
    return values, len(values)


def _line_angle(samples: list[TrackSample], left: int, right: int) -> list[float]:
    values: list[float] = []
    for sample in samples:
        if min(sample.keypoint_scores[left], sample.keypoint_scores[right]) <= KEYPOINT_VALID_THRESHOLD:
            continue
        vector = sample.keypoints[right] - sample.keypoints[left]
        if np.linalg.norm(vector) <= 1e-9:
            continue
        angle = float(np.degrees(np.arctan2(vector[1], vector[0])))
        # Linhas corporais têm orientação axial: +180 e 0 representam o mesmo eixo.
        angle = ((angle + 90.0) % 180.0) - 90.0
        values.append(angle)
    return values


def _trunk_angle(samples: list[TrackSample]) -> list[float]:
    values: list[float] = []
    for sample in samples:
        required = (L_SHOULDER, R_SHOULDER, L_HIP, R_HIP)
        if min(float(sample.keypoint_scores[index]) for index in required) <= KEYPOINT_VALID_THRESHOLD:
            continue
        shoulder = (sample.keypoints[L_SHOULDER] + sample.keypoints[R_SHOULDER]) / 2.0
        hip = (sample.keypoints[L_HIP] + sample.keypoints[R_HIP]) / 2.0
        vector = shoulder - hip
        if np.linalg.norm(vector) <= 1e-9:
            continue
        angle = float(np.degrees(np.arctan2(vector[1], vector[0])))
        angle = ((angle + 90.0) % 180.0) - 90.0
        values.append(angle)
    return values


def _normalized_head_motion(samples: list[TrackSample]) -> list[float]:
    points: list[np.ndarray] = []
    for sample in samples:
        required = (NOSE, L_SHOULDER, R_SHOULDER)
        if min(float(sample.keypoint_scores[index]) for index in required) <= KEYPOINT_VALID_THRESHOLD:
            continue
        left, right = sample.keypoints[L_SHOULDER], sample.keypoints[R_SHOULDER]
        shoulder_width = float(np.linalg.norm(right - left))
        if shoulder_width <= 1e-6:
            continue
        center = (left + right) / 2.0
        points.append((sample.keypoints[NOSE] - center) / shoulder_width)
    if len(points) < 4:
        return []
    array = np.asarray(points)
    center = np.median(array, axis=0)
    return np.linalg.norm(array - center, axis=1).tolist()


def _wrist_path_consistency(samples: list[TrackSample], wrist: int, shoulder: int) -> tuple[float | None, int]:
    radii: list[float] = []
    for sample in samples:
        required = (wrist, shoulder, L_SHOULDER, R_SHOULDER)
        if min(float(sample.keypoint_scores[index]) for index in required) <= KEYPOINT_VALID_THRESHOLD:
            continue
        width = float(np.linalg.norm(sample.keypoints[R_SHOULDER] - sample.keypoints[L_SHOULDER]))
        if width <= 1e-6:
            continue
        radii.append(float(np.linalg.norm(sample.keypoints[wrist] - sample.keypoints[shoulder]) / width))
    if len(radii) < 8:
        return None, len(radii)
    mean = float(np.mean(radii))
    if mean <= 1e-9:
        return None, len(radii)
    cv = float(np.std(radii) / mean)
    return _clamp(100.0 * (1.0 - cv)), len(radii)


def _keypoint_signal(samples: list[TrackSample], keypoint: int) -> PeriodicSignal | None:
    best: PeriodicSignal | None = None
    for axis in (0, 1):
        times: list[float] = []
        values: list[float] = []
        for sample in samples:
            if sample.keypoint_scores[keypoint] > KEYPOINT_VALID_THRESHOLD:
                times.append(float(sample.timestamp))
                values.append(float(sample.keypoints[keypoint, axis]))
        if len(times) < 10:
            continue
        t = np.asarray(times, dtype=np.float64)
        v = np.asarray(values, dtype=np.float64)
        score, period = autocorrelation_periodicity(t, v)
        if score < 0.35 or period <= 0:
            continue
        peaks = detect_peaks_hysteresis(t, v)
        signal = PeriodicSignal(rate=60.0 / period, period=period, score=score, axis=axis, peaks=peaks)
        if best is None or signal.score > best.score:
            best = signal
    return best


def _phase_percent(left: PeriodicSignal | None, right: PeriodicSignal | None) -> float | None:
    if left is None or right is None or not left.peaks or not right.peaks:
        return None
    period = float(np.median([left.period, right.period]))
    if period <= 0:
        return None
    phases: list[float] = []
    right_times = np.asarray(right.peaks, dtype=np.float64)
    for time in left.peaks:
        nearest = float(right_times[np.argmin(np.abs(right_times - time))])
        phases.append(((nearest - time) % period) / period * 100.0)
    return float(np.median(phases)) if phases else None


def _summary_metric(values: list[float]) -> tuple[float | None, float | None, int]:
    if len(values) < 8:
        return None, None, len(values)
    median = float(np.median(values))
    p10 = _percentile(values, 10)
    p90 = _percentile(values, 90)
    rom = (p90 - p10) if p10 is not None and p90 is not None else None
    return median, rom, len(values)


def _symmetry(left: float | None, right: float | None) -> float | None:
    if left is None or right is None:
        return None
    denominator = max((abs(left) + abs(right)) / 2.0, 1e-6)
    return _clamp(100.0 * (1.0 - abs(left - right) / denominator))


def _calibration_gate(calibration: Calibration | None, snapshot: dict | None) -> tuple[bool, str | None]:
    if calibration is None:
        return False, "Calibração métrica imagem→piscina não fornecida."
    if snapshot is None:
        return False, "Calibração sem snapshot auditável de câmera/piscina."
    if snapshot.get("validity") != "valid":
        return False, "Snapshot de calibração expirado."
    if float(snapshot.get("coverage", 0.0)) < 0.8:
        return False, "Cobertura geométrica da calibração abaixo de 80%."
    if calibration.rmse > 0.15:
        return False, f"RMSE de reprojeção {calibration.rmse:.3f} m acima do limite elite de 0,15 m."
    return True, None


def _calibrated_speed_features(times: np.ndarray, points: np.ndarray, calibration: Calibration | None) -> dict:
    if calibration is None or times.size < 5 or points.shape[0] != times.size:
        return {}
    world = apply_homography(calibration.homography, points)
    speed = speed_series(world, times)
    if speed.size < 5:
        return {}
    positive = speed[np.isfinite(speed)]
    if positive.size < 5:
        return {}
    dt = float(np.median(np.diff(times))) if times.size > 1 else 0.0
    acceleration = np.gradient(speed, dt) if dt > 0 else np.zeros_like(speed)
    first = positive[: max(2, positive.size // 3)]
    last = positive[-max(2, positive.size // 3):]
    mean = float(np.mean(positive))
    return {
        "speedCvPct": float(np.std(positive) / mean * 100.0) if mean > 1e-9 else 0.0,
        "accelerationP95": float(np.percentile(acceleration, 95)),
        "decelerationP95": float(abs(np.percentile(acceleration, 5))),
        "speedDriftPct": float((np.mean(last) - np.mean(first)) / max(np.mean(first), 1e-9) * 100.0),
    }


def build_elite_analysis(
    *,
    track: Track,
    metrics: TrackMetrics,
    stats: StrokeStats,
    stroke_times: list[float],
    times: np.ndarray,
    points: np.ndarray,
    calibration: Calibration | None,
    calibration_snapshot: dict | None,
    sample_rate: float,
    width: int,
    height: int,
    source: str,
    source_version: str,
    stroke_style: str | None = None,
    camera_view: str | None = None,
    pool_length_m: float | None = None,
) -> dict:
    """Constrói perfil elite, com métricas + qualidade + findings auditáveis."""
    style = (stroke_style or "unknown").lower()
    if style not in STROKE_CONVENTION:
        style = "unknown"
    view = (camera_view or "unknown").lower()
    samples = track.pose_samples
    quality = _quality(track, metrics, sample_rate, width, height)
    base_conf = quality["score"]
    interval = {
        "startSeconds": round(float(track.history[0].timestamp), 2),
        "endSeconds": round(float(track.history[-1].timestamp), 2),
    }
    coverage = metrics.coverage
    metric_rows: list[dict] = []

    # Qualidade e rastreabilidade da própria medição.
    metric_rows.extend([
        _metric("pose_coverage", "Cobertura de pose", "Qualidade da análise", "%", interval, coverage, source, source_version, value=metrics.coverage, confidence=base_conf, method="frames com pose válida / frames rastreados"),
        _metric("pose_confidence", "Confiança média dos landmarks", "Qualidade da análise", "%", interval, coverage, source, source_version, value=quality["meanPoseConfidence"], confidence=base_conf, method="média das confianças COCO-17 acima do limiar"),
        _metric("tracking_continuity", "Continuidade do rastreio", "Qualidade da análise", "%", interval, coverage, source, source_version, value=quality["trackingContinuity"], confidence=base_conf, method="tempo observado / duração do track"),
    ])

    # Ciclo, cadência e regularidade.
    if stats.count > 0:
        metric_rows.append(_metric("cycles", "Ciclos detectados", "Ciclo e ritmo", "count", interval, coverage, source, source_version, value=stats.count, confidence=base_conf, method="periodicidade dominante de landmark + histerese", evidence={"events": len(stroke_times)}))
    else:
        metric_rows.append(_unavailable("cycles", "Ciclos detectados", "Ciclo e ritmo", "count", interval, coverage, source, source_version, "Periodicidade insuficiente para identificar ciclos com segurança.", "periodicidade dominante de landmark"))
    if stats.rate_per_minute > 0 and len(stats.intervals) >= 2:
        mean_interval = float(np.mean(stats.intervals))
        cv = float(np.std(stats.intervals) / mean_interval * 100.0) if mean_interval > 0 else 0.0
        metric_rows.extend([
            _metric("cadence", "Cadência", "Ciclo e ritmo", "cycles/min", interval, coverage, source, source_version, value=stats.rate_per_minute, confidence=base_conf, method="60 / mediana do intervalo entre ciclos"),
            _metric("cycle_time", "Tempo médio de ciclo", "Ciclo e ritmo", "s", interval, coverage, source, source_version, value=mean_interval, confidence=base_conf, method="média robusta dos intervalos válidos"),
            _metric("cycle_time_cv", "Variabilidade do tempo de ciclo", "Ciclo e ritmo", "%", interval, coverage, source, source_version, value=cv, confidence=base_conf, method="coeficiente de variação dos intervalos de ciclo"),
            _metric("rhythm_consistency", "Consistência rítmica", "Ciclo e ritmo", "%", interval, coverage, source, source_version, value=stats.consistency, confidence=base_conf, method="1 - desvio/intervalo médio, limitado a 0–100"),
        ])
        if len(stats.intervals) >= 6:
            half = len(stats.intervals) // 2
            early = 60.0 / max(float(np.mean(stats.intervals[:half])), 1e-9)
            late = 60.0 / max(float(np.mean(stats.intervals[-half:])), 1e-9)
            drift = (late - early) / max(early, 1e-9) * 100.0
            metric_rows.append(_metric("cadence_drift", "Deriva de cadência", "Fadiga técnica", "%", interval, coverage, source, source_version, value=drift, confidence=base_conf * 0.92, method="comparação da cadência na primeira e segunda metade dos ciclos válidos"))

    left_arm = _keypoint_signal(samples, L_WRIST)
    right_arm = _keypoint_signal(samples, R_WRIST)
    left_kick = _keypoint_signal(samples, L_ANKLE)
    right_kick = _keypoint_signal(samples, R_ANKLE)
    if left_arm is not None:
        metric_rows.append(_metric("left_arm_rate", "Frequência braço esquerdo", "Simetria e coordenação", "cycles/min", interval, coverage, source, source_version, value=left_arm.rate, confidence=base_conf * left_arm.score, method="autocorrelação periódica do punho esquerdo", evidence={"signalScore": round(left_arm.score, 3), "axis": left_arm.axis}))
    if right_arm is not None:
        metric_rows.append(_metric("right_arm_rate", "Frequência braço direito", "Simetria e coordenação", "cycles/min", interval, coverage, source, source_version, value=right_arm.rate, confidence=base_conf * right_arm.score, method="autocorrelação periódica do punho direito", evidence={"signalScore": round(right_arm.score, 3), "axis": right_arm.axis}))
    if left_arm is not None and right_arm is not None:
        asymmetry = abs(left_arm.rate - right_arm.rate) / max((left_arm.rate + right_arm.rate) / 2.0, 1e-9) * 100.0
        metric_rows.append(_metric("arm_rate_asymmetry", "Assimetria bilateral de frequência", "Simetria e coordenação", "%", interval, coverage, source, source_version, value=asymmetry, confidence=base_conf * min(left_arm.score, right_arm.score), method="diferença percentual entre frequências esquerda/direita"))
        phase = _phase_percent(left_arm, right_arm)
        if phase is not None:
            metric_rows.append(_metric("arm_coordination_phase", "Fase de coordenação entre braços", "Simetria e coordenação", "%cycle", interval, coverage, source, source_version, value=phase, confidence=base_conf * min(left_arm.score, right_arm.score), method="defasagem temporal mediana entre picos dos punhos, normalizada pelo período"))
    kick_signals = [signal for signal in (left_kick, right_kick) if signal is not None]
    if kick_signals:
        kick_rate = float(np.median([signal.rate for signal in kick_signals]))
        kick_score = float(np.mean([signal.score for signal in kick_signals]))
        metric_rows.append(_metric("kick_rate_proxy", "Frequência de pernada (proxy)", "Simetria e coordenação", "cycles/min", interval, coverage, source, source_version, value=kick_rate, confidence=base_conf * kick_score, method="periodicidade dominante dos tornozelos; proxy 2D, não contagem hidrodinâmica"))

    # Cinemática articular 2D. Ângulos são projeções no plano da câmera.
    joint_defs = [
        ("elbow", "Cotovelo", L_SHOULDER, L_ELBOW, L_WRIST, R_SHOULDER, R_ELBOW, R_WRIST),
        ("shoulder", "Ombro", L_ELBOW, L_SHOULDER, L_HIP, R_ELBOW, R_SHOULDER, R_HIP),
        ("hip", "Quadril", L_SHOULDER, L_HIP, L_KNEE, R_SHOULDER, R_HIP, R_KNEE),
        ("knee", "Joelho", L_HIP, L_KNEE, L_ANKLE, R_HIP, R_KNEE, R_ANKLE),
    ]
    joint_summary: dict[str, dict] = {}
    for key, label, la, lb, lc, ra, rb, rc in joint_defs:
        left_values, left_count = _joint_angles(samples, la, lb, lc)
        right_values, right_count = _joint_angles(samples, ra, rb, rc)
        left_median, left_rom, _ = _summary_metric(left_values)
        right_median, right_rom, _ = _summary_metric(right_values)
        joint_summary[key] = {"leftMedian": left_median, "rightMedian": right_median, "leftRom": left_rom, "rightRom": right_rom}
        for side, median, rom, count in (("left", left_median, left_rom, left_count), ("right", right_median, right_rom, right_count)):
            side_label = "esquerdo" if side == "left" else "direito"
            metric_coverage = 100.0 * count / max(len(samples), 1)
            confidence = base_conf * min(1.0, metric_coverage / 80.0)
            if median is not None:
                metric_rows.append(_metric(f"{side}_{key}_angle", f"Ângulo mediano do {label.lower()} {side_label}", "Cinemática articular 2D", "deg", interval, metric_coverage, source, source_version, value=median, confidence=confidence, method="ângulo articular COCO-17 projetado no plano da câmera"))
            if rom is not None:
                metric_rows.append(_metric(f"{side}_{key}_rom", f"Amplitude 10–90% do {label.lower()} {side_label}", "Cinemática articular 2D", "deg", interval, metric_coverage, source, source_version, value=rom, confidence=confidence, method="P90-P10 do ângulo articular 2D para reduzir outliers"))
        symmetry = _symmetry(left_rom, right_rom)
        if symmetry is not None:
            metric_rows.append(_metric(f"{key}_rom_symmetry", f"Simetria de amplitude dos {label.lower()}s", "Simetria e coordenação", "%", interval, coverage, source, source_version, value=symmetry, confidence=base_conf * 0.9, method="similaridade bilateral das amplitudes P90-P10; 100 = maior simetria"))

    trunk = _trunk_angle(samples)
    shoulder_line = _line_angle(samples, L_SHOULDER, R_SHOULDER)
    hip_line = _line_angle(samples, L_HIP, R_HIP)
    if len(trunk) >= 8:
        trunk_array = np.asarray(trunk)
        metric_rows.extend([
            _metric("trunk_angle_median", "Ângulo mediano do eixo do tronco", "Alinhamento e estabilidade", "deg", interval, coverage, source, source_version, value=float(np.median(trunk_array)), confidence=base_conf, method="eixo quadril-médio→ombro-médio no plano da câmera"),
            _metric("trunk_angle_variability", "Variabilidade do eixo do tronco", "Alinhamento e estabilidade", "deg", interval, coverage, source, source_version, value=float(np.std(trunk_array)), confidence=base_conf, method="desvio-padrão robusto temporal do eixo do tronco 2D"),
        ])
        third = max(3, len(trunk_array) // 3)
        early_std = float(np.std(trunk_array[:third]))
        late_std = float(np.std(trunk_array[-third:]))
        if early_std > 0.1:
            metric_rows.append(_metric("alignment_variability_drift", "Deriva de estabilidade corporal", "Fadiga técnica", "%", interval, coverage, source, source_version, value=(late_std - early_std) / early_std * 100.0, confidence=base_conf * 0.88, method="mudança da variabilidade do tronco entre primeiro e último terço; não é diagnóstico de fadiga fisiológica"))
    for key, label, values in (("shoulder_roll_proxy", "Oscilação da linha dos ombros", shoulder_line), ("hip_roll_proxy", "Oscilação da linha dos quadris", hip_line)):
        if len(values) >= 8:
            p10, p90 = _percentile(values, 10), _percentile(values, 90)
            if p10 is not None and p90 is not None:
                metric_rows.append(_metric(key, label, "Alinhamento e estabilidade", "deg", interval, coverage, source, source_version, value=p90 - p10, confidence=base_conf * 0.9, method="amplitude P10-P90 da linha corporal projetada; proxy 2D de rotação, não roll 3D"))

    head_motion = _normalized_head_motion(samples)
    if head_motion:
        head_stability = _clamp(100.0 * (1.0 - float(np.std(head_motion)) * 4.0))
        metric_rows.append(_metric("head_stability", "Estabilidade relativa da cabeça", "Alinhamento e estabilidade", "%", interval, coverage, source, source_version, value=head_stability, confidence=base_conf * 0.9, method="variabilidade do nariz relativa ao centro/largura dos ombros"))
    left_path, left_path_count = _wrist_path_consistency(samples, L_WRIST, L_SHOULDER)
    right_path, right_path_count = _wrist_path_consistency(samples, R_WRIST, R_SHOULDER)
    if left_path is not None:
        metric_rows.append(_metric("left_wrist_path_consistency", "Consistência da trajetória do punho esquerdo", "Alinhamento e estabilidade", "%", interval, 100.0 * left_path_count / max(len(samples), 1), source, source_version, value=left_path, confidence=base_conf * 0.82, method="coeficiente de variação do raio punho→ombro normalizado pela largura dos ombros"))
    if right_path is not None:
        metric_rows.append(_metric("right_wrist_path_consistency", "Consistência da trajetória do punho direito", "Alinhamento e estabilidade", "%", interval, 100.0 * right_path_count / max(len(samples), 1), source, source_version, value=right_path, confidence=base_conf * 0.82, method="coeficiente de variação do raio punho→ombro normalizado pela largura dos ombros"))

    # Deslocamento absoluto: somente com calibração auditável de qualidade elite.
    calibrated, calibration_reason = _calibration_gate(calibration, calibration_snapshot)
    if calibrated:
        calibrated_conf = base_conf * _clamp(100.0 - calibration.rmse / 0.15 * 30.0) / 100.0 if calibration is not None else 0.0
        if metrics.avg_speed > 0:
            metric_rows.extend([
                _metric("speed", "Velocidade média rastreada", "Deslocamento calibrado", "m/s", interval, coverage, source, source_version, value=metrics.avg_speed, confidence=calibrated_conf, method="trajetória do quadril projetada por homografia validada / tempo observado", evidence={"calibrationRmseM": round(calibration.rmse, 4)}),
                _metric("max_speed", "Velocidade máxima suavizada", "Deslocamento calibrado", "m/s", interval, coverage, source, source_version, value=metrics.max_speed, confidence=calibrated_conf * 0.9, method="Pico da velocidade após suavização temporal e homografia"),
                _metric("distance", "Distância rastreada", "Deslocamento calibrado", "m", interval, coverage, source, source_version, value=metrics.distance, confidence=calibrated_conf, method="comprimento acumulado da trajetória no plano calibrado"),
                _metric("pace_100m", "Ritmo equivalente por 100 m", "Deslocamento calibrado", "s/100m", interval, coverage, source, source_version, value=100.0 / metrics.avg_speed, confidence=calibrated_conf * 0.9, method="100 / velocidade média rastreada; não substitui parcial cronometrada de parede"),
            ])
        if metrics.distance_per_stroke > 0 and stats.count > 0:
            metric_rows.extend([
                _metric("distance_per_cycle", "Distância por ciclo detectado", "Eficiência de ciclo", "m/cycle", interval, coverage, source, source_version, value=metrics.distance_per_stroke, confidence=calibrated_conf * 0.9, method="distância calibrada nos intervalos entre picos do mesmo sinal periódico"),
                _metric("stroke_index", "Stroke Index", "Eficiência de ciclo", "m2/s/cycle", interval, coverage, source, source_version, value=metrics.avg_speed * metrics.distance_per_stroke, confidence=calibrated_conf * 0.85, method="velocidade média × distância por ciclo; indicador cinemático, não força propulsiva"),
            ])
        speed_features = _calibrated_speed_features(times, points, calibration)
        if speed_features:
            metric_rows.extend([
                _metric("speed_cv", "Variabilidade da velocidade", "Dinâmica intra-ciclo", "%", interval, coverage, source, source_version, value=speed_features["speedCvPct"], confidence=calibrated_conf * 0.85, method="coeficiente de variação da velocidade do quadril no plano calibrado"),
                _metric("acceleration_p95", "Aceleração P95", "Dinâmica intra-ciclo", "m/s2", interval, coverage, source, source_version, value=speed_features["accelerationP95"], confidence=calibrated_conf * 0.78, method="P95 da derivada temporal da velocidade suavizada"),
                _metric("deceleration_p95", "Desaceleração P95", "Dinâmica intra-ciclo", "m/s2", interval, coverage, source, source_version, value=speed_features["decelerationP95"], confidence=calibrated_conf * 0.78, method="magnitude do P5 da derivada temporal da velocidade suavizada"),
                _metric("speed_drift", "Deriva de velocidade", "Fadiga técnica", "%", interval, coverage, source, source_version, value=speed_features["speedDriftPct"], confidence=calibrated_conf * 0.82, method="variação da velocidade média entre primeiro e último terço observado"),
            ])
    else:
        for metric_id, label, unit in (
            ("speed", "Velocidade média rastreada", "m/s"),
            ("max_speed", "Velocidade máxima suavizada", "m/s"),
            ("distance", "Distância rastreada", "m"),
            ("pace_100m", "Ritmo equivalente por 100 m", "s/100m"),
            ("distance_per_cycle", "Distância por ciclo detectado", "m/cycle"),
            ("stroke_index", "Stroke Index", "m2/s/cycle"),
        ):
            metric_rows.append(_metric(metric_id, label, "Deslocamento calibrado", unit, interval, coverage, source, source_version, status="uncalibrated", confidence=0.0, method="requer homografia de câmera/piscina validada", unavailable_reason=calibration_reason))

    # Métricas que uma única câmera 2D não pode sustentar com precisão de laboratório.
    advanced_unavailable = [
        ("laps", "Voltas", "Fases de prova", "count", "Exige detecção validada de parede e direção da raia."),
        ("splits", "Parciais de parede", "Fases de prova", "s", "Exige eventos de parede validados frame a frame."),
        ("swolf", "SWOLF", "Eficiência de ciclo", "score", "Exige tempo de volta e contagem de ciclos validados na mesma extensão."),
        ("start_reaction", "Tempo de reação da saída", "Saída", "s", "Exige sinal de largada sincronizado ou evento externo confiável."),
        ("start_15m", "Tempo de saída até 15 m", "Saída", "s", "Exige linha de partida/15 m calibradas e detecção específica de saída."),
        ("turn_time", "Tempo de virada", "Virada", "s", "Exige detecção validada de aproximação, toque, impulso e saída da parede."),
        ("turn_5m_in_10m_out", "Virada 5 m in / 10 m out", "Virada", "s", "Exige landmarks de piscina calibrados e eventos de parede validados."),
        ("finish_5m", "Últimos 5 m / chegada", "Chegada", "s", "Exige linha de chegada calibrada e toque validado."),
        ("underwater_time", "Tempo submerso", "Submersão", "s", "Vídeo acima d'água não determina profundidade/submersão com confiabilidade."),
        ("underwater_distance", "Distância submersa", "Submersão", "m", "Requer câmera subaquática ou sensor/calibração 3D apropriados."),
        ("breakout_distance", "Distância de breakout", "Submersão", "m", "Exige evento de breakout validado e geometria métrica."),
        ("hand_pitch", "Pitch da mão", "Biomecânica avançada", "deg", "COCO-17 não possui landmarks de mão suficientes para orientação 3D."),
        ("propulsive_force", "Força propulsiva", "Biomecânica avançada", "N", "Força não pode ser inferida de forma validada por pose monocular sem modelo hidrodinâmico e calibração específica."),
        ("hydrodynamic_drag", "Arrasto hidrodinâmico", "Biomecânica avançada", "N", "Arrasto exige parâmetros hidrodinâmicos/3D que o vídeo monocular não observa."),
        ("joint_3d", "Cinemática articular 3D", "Biomecânica avançada", "deg", "Uma câmera 2D não identifica profundidade articular real; requer multiview/3D validado."),
    ]
    for metric_id, label, group, unit, reason in advanced_unavailable:
        metric_rows.append(_unavailable(metric_id, label, group, unit, interval, coverage, source, source_version, reason, "gate científico de disponibilidade"))

    # Findings determinísticos para revisão do treinador, sempre com evidência.
    findings: list[dict] = []
    if quality["score"] < 62:
        findings.append({"id": "capture-quality", "severity": "warning", "label": "Qualidade visual limitada", "evidence": f"Índice {quality['score']}/100", "action": "Repetir filmagem com melhor enquadramento/iluminação antes de decisões técnicas finas."})
    if left_arm is not None and right_arm is not None:
        asymmetry = abs(left_arm.rate - right_arm.rate) / max((left_arm.rate + right_arm.rate) / 2.0, 1e-9) * 100.0
        if asymmetry >= 8.0:
            findings.append({"id": "arm-rate-asymmetry", "severity": "review", "label": "Assimetria temporal entre braços", "evidence": f"{asymmetry:.1f}% de diferença de frequência", "action": "Revisar bilateralidade no trecho sincronizado; confirmar com o treinador antes de interpretar causa."})
    if len(trunk) >= 8 and float(np.std(trunk)) >= 7.0:
        findings.append({"id": "trunk-instability", "severity": "review", "label": "Alta variabilidade do eixo corporal", "evidence": f"σ={float(np.std(trunk)):.1f}° na projeção 2D", "action": "Revisar alinhamento, respiração e rotação no vídeo; a câmera pode contribuir para o efeito observado."})
    if len(stats.intervals) >= 6:
        half = len(stats.intervals) // 2
        early = 60.0 / max(float(np.mean(stats.intervals[:half])), 1e-9)
        late = 60.0 / max(float(np.mean(stats.intervals[-half:])), 1e-9)
        drift = (late - early) / max(early, 1e-9) * 100.0
        if abs(drift) >= 10.0:
            findings.append({"id": "cadence-drift", "severity": "review", "label": "Mudança relevante de cadência ao longo do trecho", "evidence": f"{drift:+.1f}%", "action": "Comparar com velocidade, objetivo da série e percepção de esforço antes de atribuir a fadiga."})

    # Pool length is retained as context but never fabricates laps/SWOLF.
    context = {
        "strokeStyle": style,
        "strokeStyleSource": "provided_context" if style != "unknown" else "unknown",
        "cameraView": view,
        "poolLengthM": pool_length_m,
        "strokeConvention": STROKE_CONVENTION[style],
    }
    return {
        "quality": quality,
        "context": context,
        "sportMetrics": {
            "contractVersion": CONTRACT_VERSION,
            "biomechanicsVersion": BIOMECHANICS_VERSION,
            "strokeConvention": STROKE_CONVENTION,
            "style": {"value": style if style != "unknown" else None, "status": "provided" if style != "unknown" else "unavailable"},
            "analysisQuality": quality,
            "metrics": metric_rows,
        },
        "biomechanics": {
            "contractVersion": BIOMECHANICS_VERSION,
            "projection": "2D_MONOCULAR",
            "context": context,
            "jointSummary": joint_summary,
            "findings": findings,
            "limitations": [
                "Ângulos articulares são projeções 2D e dependem do plano de câmera.",
                "Confidence é qualidade de evidência, não probabilidade de acerto.",
                "Força, arrasto, profundidade e cinemática 3D permanecem UNKNOWN sem sensores/multiview adequados.",
            ],
        },
        "findings": findings,
    }
