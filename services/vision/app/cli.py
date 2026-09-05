"""CLI de diagnóstico: roda o pipeline localmente e imprime o resumo.

Uso: python -m app.cli <video.mp4> [--calibration calib.json] [--target-fps 10]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import settings_from_env
from .engine import AnalyzeOptions, analyze_video
from .pose import PoseEngine


def _parse_calibration(raw: str | None):
    if not raw:
        return None
    payload = json.loads(Path(raw).read_text(encoding="utf-8"))
    from .calibration import CalibrationPoint

    return [CalibrationPoint(image=tuple(point["image"]), world=tuple(point["world"])) for point in payload["points"]]


def main() -> None:
    parser = argparse.ArgumentParser(description="Análise AquaVision via linha de comando")
    parser.add_argument("video", help="caminho do vídeo")
    parser.add_argument("--calibration", help="JSON com pontos imagem->mundo", default=None)
    parser.add_argument("--target-fps", type=float, default=12.0)
    parser.add_argument("--no-refinement", action="store_true", help="desliga o refinamento top-down")
    parser.add_argument("--json", help="escreve a análise completa neste arquivo", default=None)
    args = parser.parse_args()

    settings = settings_from_env()
    engine = PoseEngine(settings)
    analysis = analyze_video(
        args.video,
        engine.load(),
        _parse_calibration(args.calibration),
        AnalyzeOptions(target_fps=args.target_fps),
        on_progress=lambda value, stage: print(f"[{value:5.1f}%] {stage}"),
        refine=None if args.no_refinement else engine.load_refinement(),
    )
    print(json.dumps({key: analysis[key] for key in ("engine", "metadata", "metrics")}, ensure_ascii=False, indent=2))
    for person in analysis["people"]:
        print(
            f"atleta #{person['id']}: {person['strokes']} braçadas · {person['strokeRate']}/min · "
            f"{person['avgSpeed']} {analysis['metadata']['units']}/s · consistência {person['rhythmConsistency']}%"
        )
    if args.json:
        Path(args.json).write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
