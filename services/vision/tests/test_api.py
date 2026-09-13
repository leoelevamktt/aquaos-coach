"""Testes da API HTTP AquaVision Elite com pose injetada (sem modelo real)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import write_video


def make_client(media_root: Path, pose) -> TestClient:
    settings = Settings(
        model_dir=media_root / "models",
        media_root=media_root,
        device="cpu",
        mode="balanced",
        host="127.0.0.1",
        port=8800,
        refinement=False,
    )
    return TestClient(create_app(settings, pose))


class FakePose:
    def __init__(self, swimmers: list[dict]):
        self.swimmers = swimmers
        self.calls = 0

    def __call__(self, frame, score_thr=None, nms_thr=None):
        import numpy as np

        from tests.conftest import skeleton

        time = self.calls / 10.0
        self.calls += 1
        if not self.swimmers:
            return np.zeros((0, 17, 2)), np.zeros((0, 17))
        keypoints, scores = [], []
        for swimmer in self.swimmers:
            cx = swimmer["start_x"] + swimmer.get("speed", 0.0) * time
            wrist = 20.0 * np.sin(2.0 * np.pi * swimmer.get("stroke_hz", 1.0) * time)
            keypoints.append(skeleton((cx, swimmer["start_y"]), wrist))
            scores.append(np.full(17, 0.8))
        return np.stack(keypoints), np.stack(scores)


def test_health_reports_injected_model(tmp_path):
    with make_client(tmp_path, FakePose([{"start_x": 100.0, "start_y": 100.0}])) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert response.json()["engine"] == "AquaVision Elite 2.0"


def test_analyze_returns_elite_contract(tmp_path):
    write_video(str(tmp_path / "treino.mp4"), frames=300)
    with make_client(tmp_path, FakePose([{"start_x": 120.0, "start_y": 120.0, "speed": 20.0, "stroke_hz": 1.0}])) as client:
        response = client.post("/analyze", json={"path": "treino.mp4", "targetFps": 10, "strokeStyle": "livre", "poolLengthM": 50})
        assert response.status_code == 200
        payload = response.json()
        # Mantém a família AquaVision para compatibilidade de overlays/clientes,
        # enquanto a edição/versionamento deixam explícito o motor Elite.
        assert payload["engine"] == "AquaVision"
        assert payload["engineEdition"] == "AquaVision Elite"
        assert payload["engineVersion"] == "2.0"
        assert payload["metadata"]["persons"] == 1
        assert payload["metadata"]["strokeStyle"] == "livre"
        assert payload["metadata"]["poolLengthM"] == 50
        assert payload["analysisQuality"]["score"] > 0
        assert payload["sportMetrics"]["contractVersion"] == "sports-metrics/v2"
        assert payload["biomechanics"]["projection"] == "2D_MONOCULAR"
        assert len(payload["sportMetrics"]["metrics"]) >= 20
        cadence = next(metric for metric in payload["sportMetrics"]["metrics"] if metric["id"] == "cadence")
        assert cadence["status"] == "measured"
        assert cadence["value"] > 0
        assert cadence["confidence"] > 0
        assert cadence["method"]
        # Força/arrasto/3D jamais são inventados por câmera monocular.
        unavailable = {item["id"]: item for item in payload["sportMetrics"]["metrics"] if item["id"] in {"propulsive_force", "hydrodynamic_drag", "joint_3d"}}
        assert set(unavailable) == {"propulsive_force", "hydrodynamic_drag", "joint_3d"}
        assert all(item["status"] == "not_validated" and "value" not in item for item in unavailable.values())
        person = payload["people"][0]
        assert person["strokes"] >= 1
        assert person["analysisQuality"]["score"] > 0
        assert "biomechanics" in person


def test_analyze_missing_video_returns_404(tmp_path):
    with make_client(tmp_path, FakePose([])) as client:
        response = client.post("/analyze", json={"path": "sumiu.mp4"})
        assert response.status_code == 404


def test_analyze_without_persons_returns_422(tmp_path):
    write_video(str(tmp_path / "vazio.mp4"), frames=120)
    with make_client(tmp_path, FakePose([])) as client:
        response = client.post("/analyze", json={"path": "vazio.mp4"})
        assert response.status_code == 422


def test_analyze_rejects_collinear_calibration(tmp_path):
    write_video(str(tmp_path / "treino.mp4"), frames=300)
    calibration = {
        "origin": "teste", "version": "1", "cameraId": "c1", "poolId": "p1", "laneIds": ["4"], "coverage": 1.0, "validity": "valid",
        "points": [
            {"image": [0.0, 0.0], "world": [0.0, 0.0]},
            {"image": [100.0, 0.0], "world": [10.0, 0.0]},
            {"image": [200.0, 0.0], "world": [20.0, 0.0]},
            {"image": [300.0, 0.0], "world": [30.0, 0.0]},
        ]
    }
    with make_client(tmp_path, FakePose([{"start_x": 120.0, "start_y": 120.0}])) as client:
        response = client.post("/analyze", json={"path": "treino.mp4", "targetFps": 10, "calibration": calibration})
        assert response.status_code == 422


def test_analyze_publishes_absolute_metrics_only_with_auditable_elite_calibration(tmp_path):
    write_video(str(tmp_path / "treino.mp4"), frames=300)
    calibration = {
        "origin": "calibração técnica", "version": "2026.09.1", "cameraId": "camera-fixa-1", "poolId": "piscina-olimpica", "laneIds": ["4"], "coverage": 0.9, "validity": "valid",
        "points": [
            {"image": [0.0, 0.0], "world": [0.0, 0.0]},
            {"image": [400.0, 0.0], "world": [25.0, 0.0]},
            {"image": [400.0, 200.0], "world": [25.0, 12.5]},
            {"image": [0.0, 200.0], "world": [0.0, 12.5]},
        ]
    }
    with make_client(tmp_path, FakePose([{"start_x": 60.0, "start_y": 100.0, "speed": 100.0, "stroke_hz": 1.0}])) as client:
        response = client.post("/analyze", json={"path": "treino.mp4", "targetFps": 10, "calibration": calibration, "strokeStyle": "livre"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["metadata"]["calibrated"] is True
        assert payload["metadata"]["calibrationSnapshot"]["version"] == "2026.09.1"
        availability = payload["metadata"]["metricAvailability"]["avgSpeed"]
        assert availability["available"] is True
        assert availability["reliable"] is True
        assert availability["confidence"] > 0
        speed = next(metric for metric in payload["sportMetrics"]["metrics"] if metric["id"] == "speed")
        assert speed["status"] == "measured"
        assert speed["value"] > 0
        assert speed["evidence"]["calibrationRmseM"] <= 0.15


def test_analyze_blocks_absolute_metrics_when_calibration_coverage_is_insufficient(tmp_path):
    write_video(str(tmp_path / "treino.mp4"), frames=300)
    calibration = {
        "origin": "calibração técnica", "version": "2026.09.1", "cameraId": "camera-fixa-1", "poolId": "piscina-olimpica", "laneIds": ["4"], "coverage": 0.5, "validity": "valid",
        "points": [{"image": [0.0, 0.0], "world": [0.0, 0.0]}, {"image": [400.0, 0.0], "world": [25.0, 0.0]}, {"image": [400.0, 200.0], "world": [25.0, 12.5]}, {"image": [0.0, 200.0], "world": [0.0, 12.5]}],
    }
    with make_client(tmp_path, FakePose([{"start_x": 60.0, "start_y": 100.0, "speed": 100.0, "stroke_hz": 1.0}])) as client:
        response = client.post("/analyze", json={"path": "treino.mp4", "targetFps": 10, "calibration": calibration})
        assert response.status_code == 200
        payload = response.json()
        availability = payload["metadata"]["metricAvailability"]["avgSpeed"]
        assert availability["available"] is False
        assert availability["reliable"] is False
        assert "80%" in availability["reason"]
        speed = next(metric for metric in payload["sportMetrics"]["metrics"] if metric["id"] == "speed")
        assert speed["status"] == "uncalibrated"
        assert "value" not in speed
