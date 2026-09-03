"""Testes do pipeline completo com pose falsa e vídeo sintético."""

from __future__ import annotations

import pytest

from app.calibration import CalibrationPoint
from app.engine import AnalyzeOptions, analyze_video
from app.errors import NoPeopleDetected

SQUARE = [
    CalibrationPoint(image=(0.0, 0.0), world=(0.0, 0.0)),
    CalibrationPoint(image=(400.0, 0.0), world=(25.0, 0.0)),
    CalibrationPoint(image=(400.0, 200.0), world=(25.0, 12.5)),
    CalibrationPoint(image=(0.0, 200.0), world=(0.0, 12.5)),
]


def test_single_swimmer_full_contract(video_factory, fake_pose_factory):
    video = video_factory(frames=300, fps=30.0)
    pose = fake_pose_factory([{"start_x": 120.0, "start_y": 120.0, "speed": 20.0, "stroke_hz": 1.0}])
    analysis = analyze_video(video, pose)

    assert analysis["engine"] == "AquaVision"
    assert analysis["metadata"]["durationSeconds"] == pytest.approx(10.0, abs=0.2)
    assert analysis["metadata"]["persons"] == 1
    assert analysis["metadata"]["units"] == "px"
    assert len(analysis["people"]) == 1

    metrics = analysis["metrics"]
    assert 8 <= metrics["detectedCycles"] <= 12
    assert metrics["estimatedCadence"] == pytest.approx(60, abs=6)
    assert metrics["rhythmConsistency"] > 80
    assert 0 <= metrics["technicalIndex"] <= 100

    assert analysis["timeline"], "timeline não pode ser vazia"
    assert all(0 <= sample["motion"] <= 100 for sample in analysis["timeline"])
    categories = {event["category"] for event in analysis["events"]}
    assert "stroke" in categories
    assert {"entry", "finish"} <= categories
    assert analysis["events"] == sorted(analysis["events"], key=lambda event: event["time"])


def test_hidden_swimmer_keeps_single_track(video_factory, fake_pose_factory):
    video = video_factory(frames=300, fps=30.0)
    pose = fake_pose_factory([{"start_x": 120.0, "start_y": 120.0, "speed": 20.0, "stroke_hz": 1.0, "hidden": (4.0, 5.0)}])
    analysis = analyze_video(video, pose)
    assert len(analysis["people"]) == 1
    assert analysis["people"][0]["coverage"] < 100.0
    assert analysis["people"][0]["durationSeconds"] == pytest.approx(10.0, abs=0.3)


def test_two_swimmers_produce_two_entries(video_factory, fake_pose_factory):
    video = video_factory(frames=300, fps=30.0)
    pose = fake_pose_factory(
        [
            {"start_x": 80.0, "start_y": 120.0, "speed": 30.0, "stroke_hz": 1.0},
            {"start_x": 320.0, "start_y": 160.0, "speed": 10.0, "stroke_hz": 0.8},
        ]
    )
    analysis = analyze_video(video, pose)
    assert analysis["metadata"]["persons"] == 2
    ids = [person["id"] for person in analysis["people"]]
    assert len(set(ids)) == 2


def test_no_person_raises(video_factory, fake_pose_factory):
    video = video_factory(frames=120, fps=30.0)
    pose = fake_pose_factory([])
    with pytest.raises(NoPeopleDetected):
        analyze_video(video, pose)


def test_calibration_outputs_meters(video_factory, fake_pose_factory):
    video = video_factory(frames=300, fps=30.0)
    pose = fake_pose_factory([{"start_x": 60.0, "start_y": 100.0, "speed": 100.0, "stroke_hz": 1.0}])
    analysis = analyze_video(video, pose, SQUARE)
    assert analysis["metadata"]["calibrated"] is True
    assert analysis["metadata"]["units"] == "m"
    person = analysis["people"][0]
    # 100 px/s * 0.0625 m/px = 6.25 m/s
    assert person["avgSpeed"] == pytest.approx(6.25, abs=0.8)
    assert person["distance"] == pytest.approx(62.5, abs=3.0)


def test_progress_callback_reports_stages(video_factory, fake_pose_factory):
    video = video_factory(frames=300, fps=30.0)
    pose = fake_pose_factory([{"start_x": 120.0, "start_y": 120.0, "speed": 20.0, "stroke_hz": 1.0}])
    reports: list[tuple[float, str]] = []
    analyze_video(video, pose, None, AnalyzeOptions(), on_progress=lambda value, stage: reports.append((value, stage)))
    assert reports, "nenhum estágio reportado"
    assert reports[-1][0] == 100.0
    assert all(0 <= value <= 100 for value, _ in reports)
