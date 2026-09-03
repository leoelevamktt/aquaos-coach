"""Testes do gerenciamento de pesos: download atômico e cache corrompido."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

import app.pose as pose_module
from app.config import Settings
from app.errors import VisionUnavailable
from app.pose import ensure_model_file


def make_settings(tmp_path: Path) -> Settings:
    return Settings(
        model_dir=tmp_path / "models",
        media_root=tmp_path / "media",
        device="cpu",
        mode="balanced",
        host="127.0.0.1",
        port=8800,
    )


def write_zip(path: Path, onnx_bytes: bytes = b"model") -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr("weights.onnx", onnx_bytes)
    path.write_bytes(buffer.getvalue())


def test_ensure_model_extracts_onnx_from_downloaded_zip(tmp_path, monkeypatch):
    settings = make_settings(tmp_path)

    def fake_download(url: str, destination: Path) -> None:
        write_zip(destination)

    monkeypatch.setattr(pose_module, "_download", fake_download)
    onnx = ensure_model_file(settings)
    assert onnx.exists()
    assert onnx.read_bytes() == b"model"
    # Segunda chamada usa o cache: não baixa de novo.
    calls = []

    def fail_download(url: str, destination: Path) -> None:
        calls.append(url)

    monkeypatch.setattr(pose_module, "_download", fail_download)
    assert ensure_model_file(settings) == onnx
    assert calls == []


def test_corrupted_cache_is_removed_and_reported(tmp_path, monkeypatch):
    settings = make_settings(tmp_path)

    def fake_download(url: str, destination: Path) -> None:
        destination.write_bytes(b"isto nao e um zip")

    monkeypatch.setattr(pose_module, "_download", fake_download)
    with pytest.raises(VisionUnavailable):
        ensure_model_file(settings)
    archive = settings.model_dir / Path(settings.model_url).name
    assert not archive.exists(), "zip corrompido deve ser removido para o próximo início"


def test_download_failure_becomes_vision_unavailable(tmp_path, monkeypatch):
    settings = make_settings(tmp_path)

    def fake_download(url: str, destination: Path) -> None:
        raise OSError("sem rede")

    monkeypatch.setattr(pose_module, "_download", fake_download)
    with pytest.raises(VisionUnavailable):
        ensure_model_file(settings)
