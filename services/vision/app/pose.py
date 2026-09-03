"""Download e carregamento do modelo RTMO (pose + detecção em um estágio).

Os pesos são os ONNX oficiais do OpenMMLab (Apache-2.0), baixados uma única vez
para VISION_MODEL_DIR e reaproveitados pelo volume de cache em produção.
"""

from __future__ import annotations

import shutil
import threading
import urllib.request
import zipfile
from pathlib import Path
from typing import Protocol

from rtmlib import RTMO

from .config import Settings
from .errors import VisionUnavailable

DOWNLOAD_TIMEOUT_SECONDS = 300.0


class PoseModel(Protocol):
    """Contrato de inferência: imagem BGR -> (keypoints (N, 17, 2), scores (N, 17))."""

    def __call__(self, image, score_thr: float | None = None, nms_thr: float | None = None): ...


def _download(url: str, destination: Path) -> None:
    """Baixa com timeout e renomeação atômica: nunca deixa um zip parcial no cache."""
    request = urllib.request.Request(url, headers={"User-Agent": "aquaos-vision/1.0"})
    partial = destination.with_suffix(".part")
    with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response, open(partial, "wb") as target:
        shutil.copyfileobj(response, target)
    partial.replace(destination)


def ensure_model_file(settings: Settings) -> Path:
    """Garante o ONNX do modo configurado em disco e devolve o caminho local."""
    settings.model_dir.mkdir(parents=True, exist_ok=True)
    url = settings.model_url
    archive = settings.model_dir / Path(url).name
    onnx = archive.with_suffix(".onnx")
    if onnx.exists():
        return onnx
    try:
        if not archive.exists():
            _download(url, archive)
        with zipfile.ZipFile(archive) as bundle:
            member = next(name for name in bundle.namelist() if name.endswith(".onnx"))
            with bundle.open(member) as source, open(onnx, "wb") as target:
                shutil.copyfileobj(source, target)
    except zipfile.BadZipFile:
        # Cache corrompido (ex.: download interrompido em versões antigas):
        # remove para o próximo início baixar de novo em vez de ficar degradado.
        archive.unlink(missing_ok=True)
        raise VisionUnavailable("Cache do modelo RTMO corrompido; removido para novo download.")
    except VisionUnavailable:
        raise
    except Exception as error:  # noqa: BLE001 - qualquer falha vira 503 e a API cai no AquaMotion
        raise VisionUnavailable(f"Não foi possível obter o modelo RTMO: {error}") from error
    return onnx


def load_pose_model(settings: Settings) -> PoseModel:
    """Carrega o RTMO no backend ONNX Runtime configurado."""
    onnx = ensure_model_file(settings)
    try:
        return RTMO(
            str(onnx),
            model_input_size=(640, 640),
            backend="onnxruntime",
            device=settings.device,
        )
    except Exception as error:  # noqa: BLE001
        raise VisionUnavailable(f"Não foi possível carregar o modelo RTMO: {error}") from error


class PoseEngine:
    """Carregamento preguiçoso e thread-safe do modelo, com uma única instância."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._model: PoseModel | None = None
        self._lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._model is not None

    def load(self) -> PoseModel:
        with self._lock:
            if self._model is None:
                self._model = load_pose_model(self.settings)
            return self._model

    def get(self) -> PoseModel:
        model = self._model
        if model is None:
            raise VisionUnavailable("Modelo de pose ainda não carregado.")
        return model
