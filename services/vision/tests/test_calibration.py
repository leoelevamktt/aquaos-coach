"""Testes da homografia: exatidão, degeneração e rejeição de calibração ruim."""

from __future__ import annotations

import numpy as np
import pytest

from app.calibration import CalibrationPoint, apply_homography, build_calibration, estimate_homography, reprojection_error

SQUARE = [
    CalibrationPoint(image=(0.0, 0.0), world=(0.0, 0.0)),
    CalibrationPoint(image=(400.0, 0.0), world=(25.0, 0.0)),
    CalibrationPoint(image=(400.0, 200.0), world=(25.0, 12.5)),
    CalibrationPoint(image=(0.0, 200.0), world=(0.0, 12.5)),
]


def test_homography_roundtrip_known_points():
    calibration = build_calibration(SQUARE)
    assert calibration is not None
    assert calibration.rmse < 0.01
    image = np.array([[200.0, 100.0]], dtype=np.float64)
    world = apply_homography(calibration.homography, image)
    assert world[0, 0] == pytest.approx(12.5, abs=0.01)
    assert world[0, 1] == pytest.approx(6.25, abs=0.01)


def test_rejects_fewer_than_four_points():
    assert estimate_homography(SQUARE[:3]) is None


def test_rejects_collinear_points():
    collinear = [
        CalibrationPoint(image=(0.0, 0.0), world=(0.0, 0.0)),
        CalibrationPoint(image=(10.0, 0.0), world=(1.0, 0.0)),
        CalibrationPoint(image=(20.0, 0.0), world=(2.0, 0.0)),
        CalibrationPoint(image=(30.0, 0.0), world=(3.0, 0.0)),
    ]
    assert estimate_homography(collinear) is None


def test_noise_tolerant_calibration():
    rng = np.random.default_rng(7)
    homography = estimate_homography(SQUARE)
    assert homography is not None
    noisy = []
    for point in SQUARE + SQUARE:
        jitter = rng.normal(0.0, 0.4, size=2)
        noisy.append(
            CalibrationPoint(
                image=(point.image[0] + jitter[0], point.image[1] + jitter[1]),
                world=point.world,
            )
        )
    calibration = build_calibration(noisy, max_error=0.5)
    assert calibration is not None
    assert calibration.rmse < 0.5


def test_inconsistent_points_are_rejected():
    contradictory = SQUARE + [CalibrationPoint(image=(200.0, 100.0), world=(20.0, 10.0))]
    assert build_calibration(contradictory) is None


def test_reprojection_error_zero_for_exact_fit():
    homography = estimate_homography(SQUARE)
    assert homography is not None
    assert reprojection_error(homography, SQUARE) < 1e-6
