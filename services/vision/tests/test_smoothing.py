"""Testes da suavização zero-fase (Savitzky-Golay) usada no pipeline offline."""

from __future__ import annotations

import numpy as np
import pytest

from app.smoothing import resample_and_smooth


def rmse(actual: np.ndarray, expected: np.ndarray) -> float:
    return float(np.sqrt(np.mean((actual - expected) ** 2)))


def test_removes_noise_without_losing_the_oscillation():
    times = np.arange(0.0, 10.0, 0.1)
    clean = 20.0 * np.sin(2.0 * np.pi * times)
    rng = np.random.default_rng(21)
    noisy = clean + rng.normal(0.0, 5.0, size=times.size)
    _, filtered = resample_and_smooth(times, noisy, freq=10.0)
    assert rmse(filtered, clean) < 0.7 * rmse(noisy, clean)
    # zero-fase: a oscilação sobrevive com a mesma amplitude (inclinação ~ 1).
    slope = float(np.dot(filtered, clean) / np.dot(clean, clean))
    assert slope == pytest.approx(1.0, abs=0.07)


def test_ramp_is_reproduced_without_lag():
    times = np.arange(0.0, 6.0, 0.1)
    ramp = 10.0 * times
    _, filtered = resample_and_smooth(times, ramp, freq=10.0)
    assert np.abs(filtered - ramp).max() < 1.0
    assert filtered[-1] == pytest.approx(ramp[-1], abs=0.5)


def test_long_gaps_become_nan_instead_of_invented_motion():
    times = np.arange(0.0, 6.0, 0.1)
    values = 20.0 * np.sin(2.0 * np.pi * times)
    times = np.delete(times, np.arange(30, 36))  # lacuna de 0.6 s
    values = np.delete(values, np.arange(30, 36))
    grid, smoothed = resample_and_smooth(times, values, freq=10.0)
    assert np.isnan(smoothed).any()
    assert np.isfinite(smoothed).sum() >= 40
    assert grid.size == smoothed.size


def test_short_series_passes_through_untouched():
    times = np.array([0.0, 0.1, 0.2])
    values = np.array([1.0, 5.0, 1.0])
    out_times, out_values = resample_and_smooth(times, values, freq=10.0)
    assert out_times.tolist() == times.tolist()
    assert out_values.tolist() == values.tolist()


def test_rejects_invalid_frequency():
    times = np.arange(0.0, 1.0, 0.1)
    with pytest.raises(ValueError):
        resample_and_smooth(times, times * 2.0, freq=0.0)
