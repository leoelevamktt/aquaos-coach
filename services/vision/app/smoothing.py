"""Suavização zero-fase para séries temporais offline (Savitzky-Golay).

Análise de vídeo é offline: temos a série completa, então usamos ajuste local
de polinômios (Savitzky-Golay), que remove jitter sem introduzir o atraso de
grupo de um filtro causal. Lacunas longas (atleta fora de quadro) viram NaN em
vez de oscilação inventada.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import savgol_filter

MAX_INTERPOLATION_GAP = 0.6  # s - sem cobertura por mais que isso, a série quebra


def _odd_window(size: int) -> int:
    return size if size % 2 == 1 else size - 1


def _finite_runs(finite: np.ndarray) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, flag in enumerate(finite):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            runs.append((start, index))
            start = None
    if start is not None:
        runs.append((start, len(finite)))
    return runs


def _savgol_segments(values: np.ndarray, window: int, polyorder: int) -> np.ndarray:
    """Aplica Savitzky-Golay por trecho contíguo de valores finitos."""
    out = values.copy()
    for start, end in _finite_runs(np.isfinite(values)):
        segment = values[start:end]
        run_window = _odd_window(min(window, len(segment)))
        if run_window < polyorder + 2:
            continue  # trecho curto demais para ajustar: mantém os valores originais
        out[start:end] = savgol_filter(segment, run_window, polyorder, mode="interp")
    return out


def resample_and_smooth(
    times: np.ndarray,
    values: np.ndarray,
    freq: float,
    window_seconds: float = 0.7,
    polyorder: int = 3,
) -> tuple[np.ndarray, np.ndarray]:
    """Reamostra em grade regular, preenche lacunas curtas e suaviza zero-fase.

    Devolve (grade, valores suavizados); pontos dentro de lacunas longas são
    NaN. Séries muito curtas (< 5 amostras) voltam sem suavização.
    """
    if freq <= 0:
        raise ValueError("A frequência de amostragem deve ser positiva.")
    if times.size < 5 or values.size < 5:
        return times, values
    step = 1.0 / freq
    grid = np.arange(times[0], times[-1] + step / 2, step)
    filled = np.interp(grid, times, values)
    # Lacunas longas entre amostras reais viram NaN: não inventamos movimento.
    long_gap = np.zeros(grid.size, dtype=bool)
    for index in range(times.size - 1):
        if times[index + 1] - times[index] > MAX_INTERPOLATION_GAP:
            long_gap |= (grid > times[index]) & (grid < times[index + 1])
    filled = np.where(long_gap, np.nan, filled)
    window = _odd_window(max(5, int(round(window_seconds * freq))))
    window = min(window, _odd_window(grid.size))
    smoothed = _savgol_segments(filled, window, polyorder)
    return grid, smoothed
