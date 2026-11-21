"""Comparación de rutas declaradas (con comodines) contra rutas reales.

Las capacidades se declaran con `*` en un segmento (`riesgo.sharpe.*.fondo`)
o como prefijo de subárbol (`cartera.renta_fija.*`). `cubre()` dice si una
ruta concreta del esquema está amparada por alguna declaración.
"""
from __future__ import annotations


def _casa(patron: str, ruta: str) -> bool:
    p, r = patron.split("."), ruta.split(".")
    for i, seg in enumerate(p):
        if seg == "*":
            if i == len(p) - 1:      # comodín final: ampara todo el subárbol
                return len(r) >= i + 1
            if i >= len(r):
                return False
            continue
        if i >= len(r) or r[i] != seg:
            return False
    return len(r) == len(p)


def cubre(declaradas, ruta: str) -> str | None:
    """Devuelve el patrón declarado que ampara la ruta (el más específico), o None."""
    if ruta in declaradas:
        return ruta
    candidatos = [p for p in declaradas if "*" in p and _casa(p, ruta)]
    if not candidatos:
        return None
    # menos comodines primero; a igualdad, el más largo (más literal)
    return min(candidatos, key=lambda p: (p.count("*"), -len(p)))


def familia_de(declaradas: dict[str, str], ruta: str) -> str | None:
    patron = cubre(declaradas, ruta)
    return declaradas.get(patron) if patron else None
