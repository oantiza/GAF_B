# -*- coding: utf-8 -*-
"""Tamano de los documentos `meta/*` agregados frente al limite de 1 MiB de Firestore.

Ronda 2 (14-10-2026, ALTA-07): `meta/admin_asset_inventory`, `meta/search_index` y
`meta/fund_data_quality` son un documento cada uno con una fila por activo, sin
troceado ni guarda de tamano. Con ~1.100 activos el limite queda lejos, pero nadie lo
vigilaba. No se cambia la estructura: se avisa (linea WARNING en el log al escribirse
y aviso en el control de integridad) en cuanto uno pasa de 800 KiB, para trocearlo
con tiempo.

El tamano sigue la regla publicada de Firestore (cadena = bytes UTF-8 + 1; numero,
fecha = 8; booleano, nulo = 1; mapa = claves + valores; nombre del documento + 16;
32 bytes de cabecera). Es una estimacion, suficiente para un umbral de aviso.
"""
from __future__ import annotations

import datetime
import json

META_SIZE_WARN_BYTES = 800 * 1024
FIRESTORE_MAX_DOCUMENT_BYTES = 1024 * 1024
WATCHED_META_DOCUMENTS = ("admin_asset_inventory", "search_index", "fund_data_quality")


def _value_size(value) -> int:
    if value is None or isinstance(value, bool):
        return 1
    if isinstance(value, (int, float)):
        return 8
    if isinstance(value, str):
        return len(value.encode("utf-8")) + 1
    if isinstance(value, (bytes, bytearray)):
        return len(value)
    if isinstance(value, (datetime.datetime, datetime.date)):
        return 8
    if isinstance(value, dict):
        return sum(len(str(key).encode("utf-8")) + 1 + _value_size(item) for key, item in value.items())
    if isinstance(value, (list, tuple)):
        return sum(_value_size(item) for item in value)
    return len(str(value).encode("utf-8")) + 1


def document_size(path: str, data) -> int:
    """Bytes estimados del documento `path` con contenido `data`."""
    name = sum(len(segment.encode("utf-8")) + 1 for segment in str(path).split("/")) + 16
    return name + _value_size(data or {}) + 32


def size_warning(document_id: str, data, *, log: bool = True) -> dict | None:
    """Aviso (en la forma de los problemas de integridad) si `meta/<document_id>` pasa
    de 800 KiB; None si no. Con `log`, deja una linea WARNING para las alertas."""
    if not data:
        return None
    size = document_size("meta/%s" % document_id, data)
    if size <= META_SIZE_WARN_BYTES:
        return None
    if log:
        print("WARNING meta_document_size:", json.dumps({
            "document": "meta/%s" % document_id, "bytes": size,
            "warn_bytes": META_SIZE_WARN_BYTES, "limit_bytes": FIRESTORE_MAX_DOCUMENT_BYTES,
        }, ensure_ascii=True))
    return {
        "severity": "WARN",
        "check": "meta_document_size",
        "detail": ("meta/%s ocupa unos %d KiB: el aviso salta a partir de 800 KiB y el limite de "
                   "Firestore es 1 MiB; conviene trocearlo antes de que crezca mas"
                   % (document_id, size // 1024)),
    }
