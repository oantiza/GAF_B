# -*- coding: utf-8 -*-
"""Indice de busqueda derivado de las raices activas de la maestra."""

from __future__ import annotations

import os
import re
import unicodedata
from datetime import datetime, timezone

from google.cloud import firestore as gcf

from contract_validation import validate_contract
from readmodel.mappers import map_instrument_type
from write_governance import require_master_writes_enabled
from quietlog import swallowed

SEARCH_INDEX_WRITE_ENV = "SEARCH_INDEX_WRITE_ENABLED"
SEARCH_INDEX_SCHEMA_VERSION = "master.search-index.v1"
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

# S4 (auditoría 27-07): el reconciliador nocturno solo necesita estos campos
# para construir entradas; select() no abarata la lectura facturada pero evita
# transferir ~5-15 KB de raíz por activo (fund_profile, holdings...). Se excluye
# fund_profile a propósito: solo decidía FUND como último recurso en activos sin
# ningún otro señalizador — esos raros caen al tipo crudo, que es honesto.
RECONCILE_ROOT_FIELDS = [
    "quality.status",
    "identity.name", "identity.currency",
    "name", "type", "asset_type", "currency", "economic_asset_class",
    "identifiers.ticker", "identifiers.eodhd_code", "identifiers.openfigi_ticker",
    "classification.asset_class", "classification.economic_asset_class",
    "classification.fondosdb_asset_type",
    "product.product_type", "product.commercial_type", "product.vehicle_complexity",
]


def _master_db():
    # MEDIA-7 (14-10-2026): un cliente por proceso; escritor (reconcilia con bdb-functions-writer).
    from master_write_client import get_master_write_db
    return get_master_write_db()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def search_index_writes_enabled() -> bool:
    return os.environ.get(SEARCH_INDEX_WRITE_ENV, "").lower() in ("1", "true", "yes", "on")


class SearchIndexWritesDisabledError(RuntimeError):
    """Gate del indice cerrado. Subclase de RuntimeError (compatibilidad); las callables
    la traducen a FAILED_PRECONDITION en vez de dejarla salir como 500 INTERNAL."""


def require_search_index_writes_enabled(operation: str) -> None:
    if not search_index_writes_enabled():
        raise SearchIndexWritesDisabledError(
            f"SEARCH_INDEX_WRITES_DISABLED: set {SEARCH_INDEX_WRITE_ENV}=true for {operation}."
        )


def _first_string(*values) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def fold_for_search(value) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    return "".join(char for char in text if unicodedata.category(char) != "Mn").lower()


def is_active_canonical_root(asset_id: str, root: dict) -> bool:
    if not ISIN_RE.fullmatch(str(asset_id or "").upper()):
        return False
    quality = root.get("quality") if isinstance(root, dict) else None
    return not (isinstance(quality, dict) and quality.get("status") == "ARCHIVED_LEGACY")


def entry_from_root(asset_id: str, root: dict) -> dict | None:
    if not is_active_canonical_root(asset_id, root):
        return None
    identity = root.get("identity") if isinstance(root.get("identity"), dict) else {}
    identifiers = root.get("identifiers") if isinstance(root.get("identifiers"), dict) else {}
    classification = root.get("classification") if isinstance(root.get("classification"), dict) else {}
    name = _first_string(identity.get("name"), root.get("name"), asset_id)
    # Auditoría 27-07 (S4): indexar el tipo INSTRUMENTAL mapeado, no el crudo.
    # Un ETC de oro llega con asset_type="OTHER" pero map_instrument_type lo
    # resuelve a ETF por product_type; si se indexa el crudo, el filtro de tipos
    # del buscador nunca lo devuelve (invisible). Solo si el mapeo no resuelve
    # (UNKNOWN) se conserva el crudo, que es honesto.
    mapped_type = map_instrument_type(root if isinstance(root, dict) else {})
    asset_type = (
        mapped_type
        if mapped_type in {"FUND", "ETF", "STOCK", "INDEX"}
        else _first_string(root.get("asset_type"), root.get("type"))
    )
    if not name or not asset_type:
        return None

    entry = {
        "id": asset_id,
        "name": name,
        "name_folded": fold_for_search(name),
        "type": asset_type,
    }
    ticker = _first_string(
        identifiers.get("ticker"),
        identifiers.get("eodhd_code"),
        identifiers.get("openfigi_ticker"),
    )
    asset_class = _first_string(
        classification.get("asset_class"),
        classification.get("economic_asset_class"),
        classification.get("fondosdb_asset_type"),
        root.get("economic_asset_class"),
    )
    currency = _first_string(identity.get("currency"), root.get("currency"))
    if ticker:
        entry["ticker"] = ticker
    if asset_class:
        entry["class"] = asset_class
    if currency:
        entry["currency"] = currency
    return entry


def build_search_index_document(roots, updated_at: str | None = None) -> dict:
    entries_by_id = {}
    for asset_id, root in roots:
        entry = entry_from_root(str(asset_id), root or {})
        if entry:
            entries_by_id[entry["id"]] = entry
    entries = [entries_by_id[asset_id] for asset_id in sorted(entries_by_id)]
    payload = {
        "schema_version": SEARCH_INDEX_SCHEMA_VERSION,
        "updated_at": updated_at or _now_iso(),
        "count": len(entries),
        "entries": entries,
    }
    validate_contract(payload, "search-index.v1.schema.json")
    return payload


def _entries_by_id(payload: dict | None) -> dict[str, dict]:
    entries = payload.get("entries") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        return {}
    return {
        str(entry.get("id")): entry
        for entry in entries
        if isinstance(entry, dict) and entry.get("id")
    }


def reconcile_search_index(write: bool = False, db=None) -> dict:
    operation = "reconcile_search_index"
    if write:
        require_master_writes_enabled(operation)
        require_search_index_writes_enabled(operation)
    db = db or _master_db()
    roots = []
    reads = 0
    query = db.collection("assets")
    try:
        stream = query.select(RECONCILE_ROOT_FIELDS).stream()
    except Exception:
        swallowed("search_index.py:163")
        stream = query.stream()
    for snap in stream:
        reads += 1
        roots.append((snap.id, snap.to_dict() or {}))

    expected = build_search_index_document(roots)
    index_ref = db.collection("meta").document("search_index")
    current_snap = index_ref.get()
    reads += 1
    current = current_snap.to_dict() if current_snap.exists else {}
    expected_by_id = _entries_by_id(expected)
    current_by_id = _entries_by_id(current)
    missing = sorted(set(expected_by_id) - set(current_by_id))
    unknown = sorted(set(current_by_id) - set(expected_by_id))
    changed = sorted(
        asset_id
        for asset_id in set(expected_by_id) & set(current_by_id)
        if expected_by_id[asset_id] != current_by_id[asset_id]
    )
    needs_write = bool(missing or unknown or changed) or current.get("count") != expected["count"]
    # Ronda 2 (ALTA-07): aviso si el indice pasa de 800 KiB (limite de Firestore 1 MiB).
    from meta_size import size_warning
    size_alert = size_warning("search_index", expected, log=bool(write and needs_write))
    if write and needs_write:
        index_ref.set(expected)

    return {
        "applied": bool(write and needs_write),
        "write_requested": bool(write),
        "reads": reads,
        "expected_count": expected["count"],
        "current_count": len(current_by_id),
        "missing_ids": missing,
        "unknown_ids": unknown,
        "changed_ids": changed,
        "needs_write": needs_write,
        **({"size_warning": size_alert["detail"]} if size_alert else {}),
    }


def search_index_without(current: dict | None, asset_id: str, updated_at: str) -> dict | None:
    """Indice sin la entrada de `asset_id`; None si no estaba (no hay nada que escribir)."""
    entries = _entries_by_id(current)
    if asset_id not in entries:
        return None
    entries.pop(asset_id)
    payload = {
        "schema_version": SEARCH_INDEX_SCHEMA_VERSION,
        "updated_at": updated_at,
        "count": len(entries),
        "entries": [entries[key] for key in sorted(entries)],
    }
    validate_contract(payload, "search-index.v1.schema.json")
    return payload


def remove_search_index_entry(db, asset_id: str) -> bool:
    """Retira la entrada de un activo archivado o borrado, como `archive:assets` en la
    plataforma. Transaccional, como `upsert_search_index_entry`; si falla, el
    reconciliador nocturno la retira igualmente (reconstruye desde las raices).
    Devuelve True si la entrada estaba y se ha quitado."""
    operation = "remove_search_index_entry"
    require_master_writes_enabled(operation)
    require_search_index_writes_enabled(operation)
    index_ref = db.collection("meta").document("search_index")
    transaction = db.transaction()
    removed = {"value": False}

    @gcf.transactional
    def _update(txn):
        snap = index_ref.get(transaction=txn)
        payload = search_index_without(snap.to_dict() if snap.exists else {}, asset_id, _now_iso())
        removed["value"] = payload is not None
        if payload is not None:
            txn.set(index_ref, payload)
            _warn_if_large(payload)

    _update(transaction)
    return removed["value"]


def upsert_search_index_entry(db, asset_id: str, root: dict) -> bool:
    """Actualiza una entrada de forma transaccional; el reconciliador cubre fallos parciales."""
    entry = entry_from_root(asset_id, root)
    if not entry:
        return False
    require_search_index_writes_enabled("upsert_search_index_entry")
    index_ref = db.collection("meta").document("search_index")
    transaction = db.transaction()

    @gcf.transactional
    def _update(txn):
        snap = index_ref.get(transaction=txn)
        current = snap.to_dict() if snap.exists else {}
        entries = _entries_by_id(current)
        entries[asset_id] = entry
        payload = {
            "schema_version": SEARCH_INDEX_SCHEMA_VERSION,
            "updated_at": _now_iso(),
            "count": len(entries),
            "entries": [entries[key] for key in sorted(entries)],
        }
        validate_contract(payload, "search-index.v1.schema.json")
        txn.set(index_ref, payload)
        _warn_if_large(payload)

    _update(transaction)
    return True


def _warn_if_large(payload: dict) -> None:
    """Linea WARNING si meta/search_index pasa de 800 KiB (ronda 2, ALTA-07)."""
    from meta_size import size_warning
    size_warning("search_index", payload)
