"""Calibração da câmera por homografia (DLT normalizado).

Quatro ou mais pares imagem -> mundo permitem converter pixels em metros na
superfície da piscina (linhas de raia), base para velocidade e distância reais.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class CalibrationPoint:
    image: tuple[float, float]  # (x, y) em pixels
    world: tuple[float, float]  # (X, Y) em metros no plano da piscina


def _normalize(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    centroid = points.mean(axis=0)
    scale = np.sqrt(2.0) / np.mean(np.linalg.norm(points - centroid, axis=1))
    transform = np.array([
        [scale, 0.0, -scale * centroid[0]],
        [0.0, scale, -scale * centroid[1]],
        [0.0, 0.0, 1.0],
    ])
    normalized = (transform[:2, :2] @ (points - centroid).T).T
    return normalized, transform


def estimate_homography(points: list[CalibrationPoint]) -> np.ndarray | None:
    """DLT com normalização de Hartley; devolve H (imagem para mundo) ou None se degenerado."""
    if len(points) < 4:
        return None
    image = np.array([point.image for point in points], dtype=np.float64)
    world = np.array([point.world for point in points], dtype=np.float64)
    if np.linalg.matrix_rank(image - image[0], tol=1e-8) < 2:
        return None
    image_n, t_image = _normalize(image)
    world_n, t_world = _normalize(world)
    rows: list[np.ndarray] = []
    for (x, y), (x_world, y_world) in zip(image_n, world_n):
        rows.append(np.array([-x, -y, -1.0, 0.0, 0.0, 0.0, x * x_world, y * x_world, x_world]))
        rows.append(np.array([0.0, 0.0, 0.0, -x, -y, -1.0, x * y_world, y * y_world, y_world]))
    matrix = np.stack(rows)
    try:
        _, _, vectors = np.linalg.svd(matrix)
    except np.linalg.LinAlgError:
        return None
    homography = vectors[-1].reshape(3, 3)
    # Hn mapeia imagem normalizada -> mundo normalizado; volta ao espaço original.
    homography = np.linalg.inv(t_world) @ homography @ t_image
    if abs(homography[2, 2]) < 1e-12:
        return None
    return homography / homography[2, 2]


def apply_homography(homography: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Aplica H a pontos (N, 2) e devolve coordenadas de mundo (N, 2)."""
    if points.size == 0:
        return points
    homogeneous = np.concatenate([points, np.ones((len(points), 1))], axis=1) @ homography.T
    return homogeneous[:, :2] / np.clip(homogeneous[:, 2:3], 1e-12, None)


def reprojection_error(homography: np.ndarray, points: list[CalibrationPoint]) -> float:
    image = np.array([point.image for point in points], dtype=np.float64)
    world = np.array([point.world for point in points], dtype=np.float64)
    projected = apply_homography(homography, image)
    return float(np.mean(np.linalg.norm(projected - world, axis=1)))


@dataclass(frozen=True)
class Calibration:
    homography: np.ndarray
    rmse: float


def build_calibration(points: list[CalibrationPoint], max_error: float = 0.5) -> Calibration | None:
    """Estima e valida a homografia; None quando insuficiente ou imprecisa."""
    homography = estimate_homography(points)
    if homography is None:
        return None
    error = reprojection_error(homography, points)
    if error > max_error:
        return None
    return Calibration(homography=homography, rmse=error)
