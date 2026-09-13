"""AquaVision Elite 2.0.

Mantém a detecção/rastreio robustos do AquaVision 1.x e adiciona uma camada
biomecânica auditável, qualidade por métrica, contexto de estilo e gates de
calibração. O contrato antigo continua compatível para player/timeline.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Callable

import cv2
import numpy as np

from .calibration import CalibrationPoint, build_calibration
from .elite_metrics import build_elite_analysis
from .engine import (
    AnalyzeOptions,
    _analyze_track,
    _collect_keyframes,
    _metric_availability,
    _metric_validity,
    _refine_frame,
    _report,
    _segment_keyframes,
    _track_gaps,
    _video_metadata,
)
from .errors import NoPeopleDetected
from .metrics import TrackMetrics, motion_timeline
from .tracker import KEYPOINT_VALID_THRESHOLD, ByteTracker, Detection, Track, bbox_from_keypoints, person_score, stitch_tracks

ProgressCallback = Callable[[float, str], None]
PoseCallable = Callable[..., tuple[np.ndarray, np.ndarray]]

ENGINE_NAME = "AquaVision Elite"
ENGINE_VERSION = "2.0"
METHODOLOGY = (
    "RTMO + refinamento RTMPose por atleta, rastreio BYTE/Kalman e costura de oclusões; "
    "sinais de ciclo por periodicidade robusta; cinemática articular 2D, simetria, coordenação, "
    "estabilidade corporal e deriva técnica por landmarks; deslocamento em m/s somente quando a "
    "homografia câmera→piscina passa gates de validade/cobertura/RMSE. Cada métrica carrega método, "
    "cobertura e índice de qualidade da evidência. Grandezas 3D, força/arrasto e eventos de parede "
    "permanecem indisponíveis quando a câmera não fornece evidência suficiente."
)
KEYFRAME_OUTPUT_HZ = 6.0


def _absolute_metric_state(elite: dict, metric_id: str) -> tuple[str, dict]:
    metric = next((item for item in elite["sportMetrics"]["metrics"] if item["id"] == metric_id), None)
    if metric is None:
        return "unavailable", {"available": False, "reliable": False, "reason": "Métrica não produzida"}
    status = str(metric.get("status", "unavailable"))
    if status == "measured" and "value" in metric:
        return "measured", {
            "available": True,
            "reliable": True,
            "confidence": metric.get("confidence"),
            "method": metric.get("method"),
        }
    return status, {
        "available": False,
        "reliable": False,
        "reason": metric.get("unavailableReason", "Evidência insuficiente"),
        "confidence": metric.get("confidence", 0),
        "method": metric.get("method"),
    }


def _person_contract(item: dict, elite: dict, sample_rate: float, calibration, calibration_snapshot: dict | None) -> dict:
    track: Track = item["track"]
    metrics: TrackMetrics = item["metrics"]
    stats = item["stats"]
    base_validity = _metric_validity(metrics, stats, calibration is not None)
    base_availability = _metric_availability(metrics, stats, calibration, calibration_snapshot)
    mappings = {
        "avgSpeed": "speed",
        "maxSpeed": "max_speed",
        "distance": "distance",
        "distancePerStroke": "distance_per_cycle",
    }
    for local, elite_id in mappings.items():
        state, availability = _absolute_metric_state(elite, elite_id)
        base_validity[local] = state
        base_availability[local] = availability
    return {
        "id": track.track_id,
        "idAliases": sorted(track.merged_ids),
        "firstSeen": round(track.history[0].timestamp, 2),
        "lastSeen": round(track.history[-1].timestamp, 2),
        "durationSeconds": metrics.duration_seconds,
        "observedDurationSeconds": metrics.observed_duration_seconds,
        "observedSegments": metrics.observed_segments,
        "gaps": _track_gaps(track, sample_rate),
        "metricAvailability": base_availability,
        "validity": base_validity,
        "meanConfidence": round(track.mean_confidence, 3),
        "coverage": metrics.coverage,
        "strokes": stats.count,
        "strokeRate": round(stats.rate_per_minute, 1) if stats.rate_per_minute > 0 else None,
        "rhythmConsistency": round(stats.consistency, 1) if len(stats.intervals) >= 3 else None,
        "avgSpeed": metrics.avg_speed if base_validity["avgSpeed"] == "measured" else None,
        "maxSpeed": metrics.max_speed if base_validity["maxSpeed"] == "measured" else None,
        "distance": metrics.distance if base_validity["distance"] == "measured" else None,
        "distancePerStroke": metrics.distance_per_stroke if base_validity["distancePerStroke"] == "measured" else None,
        "steadiness": metrics.steadiness,
        "strokeSignal": item.get("signal"),
        "strokeTimes": item.get("strokeTimes", []),
        "analysisQuality": elite["quality"],
        "biomechanics": elite["biomechanics"],
    }


def _cycle_events(item: dict, elite: dict) -> list[dict]:
    track: Track = item["track"]
    signal_quality = float(item.get("signalQuality", 0.0))
    evidence_quality = float(elite["quality"].get("score", 0.0)) / 100.0
    confidence = int(round(100.0 * max(0.0, min(1.0, 0.55 * evidence_quality + 0.45 * signal_quality))))
    style = elite["context"].get("strokeStyle", "unknown")
    return [
        {
            "id": f"cycle-{track.track_id}-{index + 1}",
            "time": float(time),
            "category": "stroke-cycle",
            "label": f"Ciclo {index + 1} · Atleta #{track.track_id}",
            "confidence": confidence,
            "confidenceKind": "evidence_quality_index_not_probability",
            "note": f"Evento periódico 2D · estilo={style}; confirmar visualmente em decisões críticas.",
            "personId": track.track_id,
        }
        for index, time in enumerate(item.get("strokeTimes", []))
    ]


def analyze_video(
    path: str,
    pose: PoseCallable,
    calibration_points: list[CalibrationPoint] | None = None,
    options: AnalyzeOptions | None = None,
    on_progress: ProgressCallback | None = None,
    refine: PoseCallable | None = None,
    calibration_snapshot: dict | None = None,
    stroke_style: str | None = None,
    camera_view: str | None = None,
    pool_length_m: float | None = None,
) -> dict:
    """Executa rastreio + biomecânica Elite sem fabricar métricas indisponíveis."""
    options = options or AnalyzeOptions()
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        raise ValueError(f"Não foi possível abrir o vídeo: {path}")
    try:
        fps, width, height, duration, size = _video_metadata(capture, path)
        step = max(1, int(round(fps / options.target_fps)))
        sample_rate = fps / step
        calibration = build_calibration(calibration_points) if calibration_points else None
        scale = min(1.0, options.max_frame_width / width) if width else 1.0

        tracker = ByteTracker()
        frame_index = 0
        next_sample = 0
        raw_keyframes: list[dict] = []
        _report(on_progress, 3.0, "AquaVision Elite · preparando vídeo")

        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index >= next_sample:
                next_sample += step
                timestamp = frame_index / fps
                if scale < 1.0:
                    frame = cv2.resize(frame, None, fx=scale, fy=scale)
                keypoints, scores = pose(frame, score_thr=options.rtmo_score_thr)
                detections: list[Detection] = []
                for person_keypoints, person_scores in zip(keypoints, scores):
                    person_keypoints = np.asarray(person_keypoints, dtype=np.float64).reshape(-1, 2)
                    person_scores = np.asarray(person_scores, dtype=np.float64).reshape(-1)
                    if person_keypoints.shape[0] < 17 or not np.any(person_scores > KEYPOINT_VALID_THRESHOLD):
                        continue
                    detections.append(
                        Detection(
                            bbox=bbox_from_keypoints(person_keypoints, person_scores) / scale,
                            score=person_score(person_scores),
                            keypoints=person_keypoints / scale,
                            keypoint_scores=person_scores,
                        )
                    )
                tracker.update(detections, frame_index, timestamp)
                if refine is not None:
                    _refine_frame(frame, tracker, scale, timestamp, frame_index, refine)
                persons = _collect_keyframes(tracker, frame_index, timestamp)
                if persons:
                    raw_keyframes.append({"t": round(timestamp, 2), "persons": persons})
                if duration > 0 and frame_index % (step * 10) == 0:
                    _report(on_progress, min(84.0, 4.0 + 80.0 * timestamp / duration), "AquaVision Elite · rastreio e pose de alta precisão")
            frame_index += 1

        if duration <= 0 and frame_index:
            duration = frame_index / fps

        candidates = [track for track in tracker.tracks if track.confirmed] + tracker.finished
        stitched = stitch_tracks(candidates)
        qualified = [track for track in stitched if track.duration >= options.min_track_seconds and len(track.pose_samples) >= options.min_pose_frames]
        if not qualified:
            raise NoPeopleDetected("Nenhum atleta rastreável foi identificado no vídeo.")

        _report(on_progress, 86.0, "AquaVision Elite · extraindo ciclos e cinemática")
        analyzed = [_analyze_track(track, calibration, sample_rate) for track in qualified]
        analyzed.sort(key=lambda item: item["metrics"].duration_seconds * (item["track"].mean_confidence or 0.01), reverse=True)

        elite_profiles: list[dict] = []
        for item in analyzed:
            elite_profiles.append(build_elite_analysis(
                track=item["track"],
                metrics=item["metrics"],
                stats=item["stats"],
                stroke_times=item["strokeTimes"],
                times=item["times"],
                points=item["points"],
                calibration=calibration,
                calibration_snapshot=calibration_snapshot,
                sample_rate=sample_rate,
                width=width,
                height=height,
                source=ENGINE_NAME,
                source_version=ENGINE_VERSION,
                stroke_style=stroke_style,
                camera_view=camera_view,
                pool_length_m=pool_length_m,
            ))

        _report(on_progress, 95.0, "AquaVision Elite · validando qualidade e confiança")
        primary = analyzed[0]
        primary_elite = elite_profiles[0]
        primary_metrics: TrackMetrics = primary["metrics"]

        alias_to_person: dict[int, int] = {}
        people: list[dict] = []
        events: list[dict] = []
        for item, elite in zip(analyzed, elite_profiles):
            track: Track = item["track"]
            for alias in track.merged_ids:
                alias_to_person[alias] = track.track_id
            people.append(_person_contract(item, elite, sample_rate, calibration, calibration_snapshot))
            events.extend(_cycle_events(item, elite))

        stride = max(1, int(np.ceil(sample_rate / KEYFRAME_OUTPUT_HZ)))
        keyframes = raw_keyframes[::stride]
        if alias_to_person:
            for frame in keyframes:
                for person in frame["persons"]:
                    person["id"] = alias_to_person.get(person["id"], person["id"])
        keyframe_segments = _segment_keyframes(keyframes)

        bitrate = int(size * 8 / duration) if duration > 0 and size else 0
        primary_stats = primary["stats"]
        metadata_availability = _person_contract(primary, primary_elite, sample_rate, calibration, calibration_snapshot)["metricAvailability"]
        _report(on_progress, 100.0, "AquaVision Elite · análise biomecânica concluída")
        return {
            "engine": ENGINE_NAME,
            "engineVersion": ENGINE_VERSION,
            "methodology": METHODOLOGY,
            "analyzedAt": datetime.now(timezone.utc).isoformat(),
            "modelClass": "monocular-2d-pose-plus-calibrated-pool-plane",
            "metadata": {
                "durationSeconds": round(duration, 2),
                "width": width,
                "height": height,
                "fps": round(fps, 2),
                "sizeBytes": size,
                "bitrate": bitrate,
                "units": primary_metrics.units,
                "calibrated": calibration is not None,
                "calibrationRmse": round(calibration.rmse, 4) if calibration else None,
                "calibrationSnapshot": calibration_snapshot,
                "metricAvailability": metadata_availability,
                "persons": len(analyzed),
                "primaryPersonId": primary["track"].track_id,
                "sampleFps": round(sample_rate, 2),
                "keyframesTruncatedAt": None,
                "strokeStyle": primary_elite["context"].get("strokeStyle"),
                "cameraView": primary_elite["context"].get("cameraView"),
                "poolLengthM": pool_length_m,
                "analysisQuality": primary_elite["quality"],
            },
            "metrics": {
                "detectedCycles": primary_stats.count,
                "estimatedCadence": round(primary_stats.rate_per_minute, 1) if primary_stats.rate_per_minute > 0 else 0,
                "rhythmConsistency": round(primary_stats.consistency, 1),
                "meanMotion": int(round(primary_metrics.mean_motion)),
                "peakMotion": int(round(primary_metrics.peak_motion)),
            },
            "analysisQuality": primary_elite["quality"],
            "sportMetrics": primary_elite["sportMetrics"],
            "biomechanics": primary_elite["biomechanics"],
            "technicalFindings": primary_elite["findings"],
            "timeline": motion_timeline(primary["times"], primary["points"], calibration),
            "events": sorted(events, key=lambda event: event["time"]),
            "people": people,
            "keyframeSegments": keyframe_segments,
        }
    finally:
        capture.release()
