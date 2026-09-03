"""Fixtures compartilhadas: vídeos sintéticos e um modelo de pose falso."""

from __future__ import annotations

import numpy as np
import pytest
import cv2


def write_video(path, frames: int = 300, fps: float = 30.0, size: tuple[int, int] = (320, 240)) -> str:
    """Vídeo preto: o conteúdo não importa, o pose falso ignora o quadro."""
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    assert writer.isOpened(), "codec mp4v indisponível neste build do OpenCV"
    frame = np.zeros((size[1], size[0], 3), dtype=np.uint8)
    for _ in range(frames):
        writer.write(frame)
    writer.release()
    return str(path)


def skeleton(center: tuple[float, float], wrist_offset: float) -> np.ndarray:
    """Esqueleto COCO-17 plausível com punhos oscilando em y."""
    cx, cy = center
    points = np.zeros((17, 2), dtype=np.float64)
    points[0] = (cx, cy - 60)          # nariz
    points[5] = (cx - 15, cy - 45)     # ombro esq.
    points[6] = (cx + 15, cy - 45)     # ombro dir.
    points[7] = (cx - 30, cy - 25)     # cotovelo esq.
    points[8] = (cx + 30, cy - 25)     # cotovelo dir.
    points[9] = (cx - 45, cy + wrist_offset)   # punho esq.
    points[10] = (cx + 45, cy - wrist_offset)  # punho dir. (fase oposta)
    points[11] = (cx - 12, cy + 10)    # quadril esq.
    points[12] = (cx + 12, cy + 10)    # quadril dir.
    points[13] = (cx - 12, cy + 40)    # joelho esq.
    points[14] = (cx + 12, cy + 40)    # joelho dir.
    points[15] = (cx - 12, cy + 70)    # tornozelo esq.
    points[16] = (cx + 12, cy + 70)    # tornozelo dir.
    return points


class FakePose:
    """Pose determinística: um ou mais atletas com trajetória e braçada senoidais."""

    def __init__(self, swimmers: list[dict], sample_rate: float = 10.0):
        self.swimmers = swimmers
        self.sample_rate = sample_rate
        self.calls = 0

    def _hidden(self, swimmer: dict, time: float) -> bool:
        hidden = swimmer.get("hidden")
        return bool(hidden) and hidden[0] <= time < hidden[1]

    def __call__(self, frame, score_thr: float | None = None, nms_thr: float | None = None):
        time = self.calls / self.sample_rate
        self.calls += 1
        if not self.swimmers:
            return np.zeros((0, 17, 2)), np.zeros((0, 17))
        keypoints: list[np.ndarray] = []
        scores: list[np.ndarray] = []
        for swimmer in self.swimmers:
            confidence = swimmer.get("confidence", 0.8)
            if self._hidden(swimmer, time):
                confidence = 0.0
            cx = swimmer["start_x"] + swimmer.get("speed", 0.0) * time
            wrist = 20.0 * np.sin(2.0 * np.pi * swimmer.get("stroke_hz", 1.0) * time)
            keypoints.append(skeleton((cx, swimmer["start_y"]), wrist))
            scores.append(np.full(17, confidence, dtype=np.float64))
        return np.stack(keypoints), np.stack(scores)


@pytest.fixture
def video_factory(tmp_path):
    def _factory(frames: int = 300, fps: float = 30.0) -> str:
        return write_video(str(tmp_path / f"video-{frames}-{int(fps)}.mp4"), frames, fps)

    return _factory


@pytest.fixture
def fake_pose_factory():
    def _factory(swimmers: list[dict], sample_rate: float = 10.0) -> FakePose:
        return FakePose(swimmers, sample_rate)

    return _factory
