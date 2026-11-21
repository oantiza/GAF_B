"""Identificadores sustituidos (fusiones, cambios de ISIN) que resuelven al activo sucesor.

Un extracto puede traer el ISIN de un fondo absorbido (p. ej. el FI de Hamco, fusionado
en su SICAV el 25/11/2025). No se da de alta un activo muerto: la capa de lectura
resuelve el alias al sucesor, que ya lleva el historico empalmado, y la cartera queda
guardada con el identificador vigente. Solo lectura; la maestra no cambia.
"""
from functools import lru_cache
import json
from pathlib import Path


@lru_cache(maxsize=1)
def aliases() -> dict:
    return json.loads(Path(__file__).with_name("asset_aliases.json").read_text(encoding="utf-8"))["aliases"]


def alias_for(asset_id) -> dict:
    """Ficha del alias ({successor, effective, reason}) o {} si el id es canonico."""
    key = str(asset_id or "").strip().upper()
    return aliases().get(key, {}) if key else {}


def canonical_asset_id(asset_id):
    """El identificador vigente: el sucesor si hay alias, el mismo id si no.

    Sigue cadenas (A -> B -> C) con tope para no entrar en bucle por un JSON mal escrito.
    """
    current = str(asset_id or "").strip()
    seen = set()
    while current and current.upper() not in seen:
        seen.add(current.upper())
        successor = alias_for(current).get("successor")
        if not successor or str(successor).strip().upper() in seen:
            break
        current = str(successor).strip()
    return current


def canonical_noting(asset_id, resolutions: dict) -> str:
    """`canonical_asset_id` que ademas anota {id pedido: id vigente} si era un alias.

    14-10-2026 (CRIT-02): los motores (optimizar, backtest, mejorar, horizonte) resuelven
    sus ids de entrada con esto, sin lecturas extra, y calculan con el id vigente (las
    politicas de calidad y las cuarentenas van por ese id). `with_alias_resolutions`
    devuelve despues cada fila bajo el id que pidio el cliente.
    """
    original = str(asset_id or "").strip()
    canonical = canonical_asset_id(original)
    if original and canonical != original:
        resolutions[original] = canonical
    return canonical


def alias_conflicts(asset_ids) -> list:
    """Pares de ids pedidos que nombran el mismo activo vigente (un alias y su sucesor,
    o dos alias del mismo). Los repetidos exactos no cuentan: ya se deduplican."""
    first_by_canonical: dict = {}
    conflicts: list = []
    for raw in asset_ids or []:
        if not isinstance(raw, str) or not raw.strip():
            continue
        text = raw.strip()
        first = first_by_canonical.setdefault(canonical_asset_id(text), text)
        if first != text and (first, text) not in conflicts:
            conflicts.append((first, text))
    return conflicts


def alias_conflict_message(conflicts) -> str:
    """Mensaje para el usuario cuando la peticion nombra dos veces el mismo activo."""
    first, second = conflicts[0]
    successor = canonical_asset_id(first)
    return ("%s y %s son el mismo activo: uno es un ISIN sustituido por fusion y el activo "
            "vigente es %s. Deja solo %s." % (first, second, successor, successor))


def _restore_ids(value, back: dict):
    if isinstance(value, dict):
        return {(back.get(key, key) if isinstance(key, str) else key): _restore_ids(item, back)
                for key, item in value.items()}
    if isinstance(value, list):
        return [_restore_ids(item, back) for item in value]
    if isinstance(value, tuple):
        return tuple(_restore_ids(item, back) for item in value)
    if isinstance(value, str):
        return back.get(value, value)
    return value


def with_alias_resolutions(result: dict, resolutions: dict, merged: dict | None = None) -> dict:
    """Devuelve la respuesta bajo los ids que pidio el cliente.

    Revision del 14-10-2026: el frontend casa las filas por el id que envio y no lee
    `alias_resolutions`. Si hubo algun alias, cada aparicion exacta del id vigente
    (claves de pesos, `asset_id` de filas y excluidos, listas de ids) vuelve a ser el id
    pedido; `alias_resolutions` queda como dato informativo. Sin alias no se toca nada.
    Requiere que la peticion no nombre el mismo activo con dos ids (`alias_conflicts`).

    `merged`: alias que solo venian en pesos auxiliares (current_weights) y cuyo peso
    se sumo al sucesor. Se avisan en `alias_resolutions`, pero no renombran filas: el
    activo se pidio con el id vigente.
    """
    if not isinstance(result, dict) or not (resolutions or merged):
        return result
    if resolutions:
        back = {canonical: requested for requested, canonical in resolutions.items()}
        restored = _restore_ids(result, back)
    else:
        restored = dict(result)
    restored["alias_resolutions"] = {**dict(merged or {}), **dict(resolutions or {})}
    return restored
