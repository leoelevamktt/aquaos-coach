"""Exceções compartilhadas do pipeline de visão."""


class VisionUnavailable(RuntimeError):
    """O modelo de pose não pode ser carregado (pesos ausentes, backend etc.)."""


class NoPeopleDetected(ValueError):
    """Nenhum atleta rastreável foi encontrado no vídeo."""
