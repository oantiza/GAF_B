"""El índice de Morningstar contrastado con el KID de la ficha (ver `core/indice_kid.py`).

No sale a red: lee el índice que `morningstar_lt` trae en esta pasada, la huella del KID que
traen las fuentes del KID en esta pasada (o la ficha anterior, si esta vez no lo leyó
ninguna) y el PDF de `cache/kid/` que da esa huella. Escribe solo
`identificacion.indice_benchmark_kid`, y solo si Morningstar atribuye un índice: un fondo sin
índice no lleva el bloque, porque un campo presente donde no aplica es un error (decisión 17).
"""
from __future__ import annotations

from pathlib import Path

from core import indice_kid
from core.adaptador_bdb import _benchmark
from core.adquisicion import procedencia
from core.schema import set_path


def _primero(previo: dict, extrae) -> str | None:
    """Lo que dice esta pasada antes que la ficha anterior."""
    fuentes = [d for k, d in (previo or {}).items() if isinstance(d, dict) and k != "_anterior"]
    anterior = (previo or {}).get("_anterior")
    for d in [*fuentes, *([anterior] if isinstance(anterior, dict) else [])]:
        valor = extrae(d)
        if valor:
            return valor
    return None


def fetch(isin: str, base: Path | None = None, previo: dict | None = None) -> dict:
    if base is None:
        return {}
    nombre = _primero(previo, _benchmark)
    if not nombre:
        return {}
    huella = _primero(previo, lambda d: (d.get("documentos_oficiales") or {}).get("kid_sha256"))
    bloque = indice_kid.comprueba(isin, nombre, huella, Path(base))
    out: dict = {}
    with procedencia.etapa("kid_en_cache"):
        for clave, valor in bloque.items():
            if valor not in (None, "", []):
                set_path(out, f"identificacion.indice_benchmark_kid.{clave}", valor)
    return out
