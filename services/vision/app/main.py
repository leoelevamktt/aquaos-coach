"""API HTTP do serviço de visão AquaVision.

Endpoint interno consumido pela API Node (`POST /analyze`) com o caminho do
vídeo no volume compartilhado de uploads. Erros retornam códigos claros para a
API cair no AquaMotion (fallback) sem duplicar lógica.
"""

from __future__ import annotations

import asyncio
import functools
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from .config import Settings, settings_from_env
from .engine import AnalyzeOptions, analyze_video
from .errors import NoPeopleDetected, VisionUnavailable
from .pose import PoseEngine

ANALYZE_LOCK_TIMEOUT_SECONDS = 30.0


class CalibrationPair(BaseModel):
    image: tuple[float, float]
    world: tuple[float, float]


class CalibrationSpec(BaseModel):
    points: list[CalibrationPair] = Field(min_length=4)

    @field_validator("points")
    @classmethod
    def _not_degenerate(cls, points: list[CalibrationPair]) -> list[CalibrationPair]:
        world = np.array([pair.world for pair in points], dtype=np.float64)
        if np.linalg.matrix_rank(world - world[0], tol=1e-8) < 2:
            raise ValueError("Pontos de calibração colineares não definem o plano da piscina.")
        return points


class AnalyzeRequest(BaseModel):
    path: str = Field(min_length=1)
    calibration: CalibrationSpec | None = None
    targetFps: float | None = Field(None, ge=4, le=30)
    minTrackSeconds: float | None = Field(None, ge=0.5, le=60)


class HealthResponse(BaseModel):
    status: str
    model: str | None
    device: str
    mode: str


def resolve_media_path(path: str, media_root: Path) -> Path:
    """Caminhos absolutos são aceitos como estão; relativos resolvem na raiz de mídia."""
    candidate = Path(path)
    resolved = candidate if candidate.is_absolute() else media_root / candidate
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail=f"Vídeo não encontrado: {path}")
    return resolved


def create_app(settings: Settings | None = None, pose: object | None = None) -> FastAPI:
    """`pose` injetável para testes; em produção o modelo real é carregado no startup."""
    settings = settings or settings_from_env()
    pose_engine = None if pose is not None else PoseEngine(settings)
    analysis_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if pose_engine is not None:
            try:
                pose_engine.load()
            except VisionUnavailable:
                # Serviço sobe degradado: /analyze responde 503 e a API usa o fallback.
                pass
        yield

    app = FastAPI(title="AquaVision", version="1.0", lifespan=lifespan)

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        if pose_engine is None:
            return HealthResponse(status="ok", model="injected", device="test", mode=settings.mode)
        if not pose_engine.ready:
            return HealthResponse(status="loading", model=None, device=settings.device, mode=settings.mode)
        return HealthResponse(status="ok", model=settings.mode, device=settings.device, mode=settings.mode)

    @app.post("/analyze")
    async def analyze(request: AnalyzeRequest):
        if pose_engine is None:
            model = pose
        else:
            try:
                model = pose_engine.get()
            except VisionUnavailable as error:
                raise HTTPException(status_code=503, detail=str(error)) from error

        video_path = resolve_media_path(request.path, settings.media_root)
        calibration_points = None
        if request.calibration is not None:
            from .calibration import CalibrationPoint

            calibration_points = [CalibrationPoint(image=pair.image, world=pair.world) for pair in request.calibration.points]
            from .calibration import build_calibration

            if build_calibration(calibration_points) is None:
                raise HTTPException(status_code=422, detail="Calibração inválida: homografia imprecisa ou degenerada.")

        options = AnalyzeOptions(
            target_fps=request.targetFps or 10.0,
            min_track_seconds=request.minTrackSeconds or 1.5,
        )
        loop = asyncio.get_running_loop()
        try:
            # Inference libera o GIL; o lock serializa análises simultâneas.
            if not analysis_lock.acquire(timeout=ANALYZE_LOCK_TIMEOUT_SECONDS):
                raise HTTPException(status_code=503, detail="Serviço ocupado com outra análise.")
            try:
                return await loop.run_in_executor(
                    None,
                    functools.partial(analyze_video, str(video_path), model, calibration_points, options),
                )
            finally:
                analysis_lock.release()
        except NoPeopleDetected as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    return app


app = create_app()
