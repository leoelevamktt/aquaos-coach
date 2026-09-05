"""Configuração do serviço de visão por variáveis de ambiente."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Modelos RTMO oficiais do OpenMMLab (Apache-2.0), publicados como ONNX SDK.
MODEL_URLS = {
    "lightweight": "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-s_8xb32-600e_body7-640x640-dac2bf74_20231211.zip",
    "balanced": "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-m_16xb16-600e_body7-640x640-39e78cc4_20231211.zip",
    "performance": "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-l_16xb16-600e_body7-640x640-b37118ce_20231211.zip",
}
# Refinamento top-down por crop (RTMPose): keypoints de alta resolução na caixa
# de cada atleta rastreado, inclusive quando a detecção one-stage enfraquece.
REFINEMENT_URLS = {
    "lightweight": "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-s_simcc-body7_pt-body7_420e-256x192-acd4a1ef_20230504.zip",
    "balanced": "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip",
    "performance": "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-x_simcc-body7_pt-body7_700e-384x288-71d7b7e9_20230629.zip",
}
REFINEMENT_INPUT_SIZES = {
    "lightweight": (192, 256),
    "balanced": (192, 256),
    "performance": (288, 384),
}
MODEL_INPUT_SIZE = 640


def _default_media_root() -> Path:
    # services/vision/app/config.py -> raiz do repositório.
    return Path(__file__).resolve().parents[3] / "apps" / "api" / "storage" / "uploads"


@dataclass(frozen=True)
class Settings:
    model_dir: Path
    media_root: Path
    device: str
    mode: str
    host: str
    port: int
    refinement: bool

    @property
    def model_url(self) -> str:
        try:
            return MODEL_URLS[self.mode]
        except KeyError as error:
            raise ValueError(f"Modo de modelo desconhecido: {self.mode}. Use {sorted(MODEL_URLS)}.") from error

    @property
    def refinement_url(self) -> str:
        try:
            return REFINEMENT_URLS[self.mode]
        except KeyError as error:
            raise ValueError(f"Modo de modelo desconhecido: {self.mode}. Use {sorted(REFINEMENT_URLS)}.") from error


def settings_from_env() -> Settings:
    return Settings(
        model_dir=Path(os.environ.get("VISION_MODEL_DIR", Path(__file__).resolve().parents[1] / "models")),
        media_root=Path(os.environ.get("VISION_MEDIA_ROOT", _default_media_root())),
        device=os.environ.get("VISION_DEVICE", "cpu"),
        mode=os.environ.get("VISION_MODE", "balanced"),
        host=os.environ.get("VISION_HOST", "0.0.0.0"),
        port=int(os.environ.get("VISION_PORT", "8800")),
        refinement=os.environ.get("VISION_REFINEMENT", "1") not in {"0", "false", "no"},
    )
