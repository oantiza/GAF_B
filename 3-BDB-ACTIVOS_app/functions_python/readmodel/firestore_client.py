"""
Lector LIVE de Firestore (SOLO LECTURA) de la base de datos maestra (cross-project).

- En Cloud Functions: usa ADC del runtime (el service account del proyecto nuevo debe tener
  rol roles/datastore.viewer SOBRE el proyecto de la maestra, el que diga `master_project`).
- En local: GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_PATH apunta a una key.

NUNCA escribe: solo .get()/.stream(). El proyecto destino se controla con MASTER_PROJECT_ID.
Implementa la interfaz `reader` que espera repository.py.
"""
import os
import re
import threading
import time
from typing import Optional

from google.cloud import firestore as gcf
from google.cloud.firestore_v1.base_query import FieldFilter
from google.api_core.retry import Retry
from quietlog import swallowed

from master_project import master_project_id

_client = None

# Cache en memoria del proceso para list_assets: asset_type -> (expira, limite, docs).
# Cloud Functions reutiliza instancias, asi que tras la 1a busqueda (que barre el universo)
# las siguientes son instantaneas. TTL corto para reflejar ingestas nuevas.
_LIST_CACHE = {}
_LIST_TTL = 300  # 5 min
_SEARCH_INDEX_CACHE = None
_SEARCH_INDEX_TTL = 300  # 5 min
_READ_CACHE_TTL = 600  # 10 min
_READ_CACHE_MAX_ENTRIES = 500
_READ_BATCH_SIZE = 100
_ASSET_CACHE = {}
_METRICS_CACHE = {}
_HOLDINGS_SUMMARY_CACHE = {}
# Holdings completos (payload grande): misma TTL, pero cupo propio y corto
# para no retener cientos de arrays de posiciones en memoria (ola 3b, batch).
_HOLDINGS_FULL_CACHE = {}
_HOLDINGS_FULL_CACHE_MAX_ENTRIES = 100
_READ_CACHE_LOCK = threading.RLock()
_NEGATIVE_CACHE_VALUE = object()
LIST_CARD_FIELD_PATHS = [
    "asset_type",
    "identity.name",
    "identity.currency",
    "identity.region",
    "identifiers.isin",
    "identifiers.ticker",
    "identifiers.openfigi_ticker",
    "classification",
    "fundamentals.profile.sector",
    "fundamentals.sector",
    "quality.review_flags",
    "updated_at",
]
MAX_HOLDINGS_CHUNKS = int(os.environ.get("BDB_HOLDINGS_MAX_CHUNKS", "100"))


def _cache_get(cache: dict, key: str):
    now = time.monotonic()
    with _READ_CACHE_LOCK:
        entry = cache.get(key)
        if not entry:
            return None
        value, loaded_at, _last_used = entry
        if now - loaded_at >= _READ_CACHE_TTL:
            cache.pop(key, None)
            return None
        cache[key] = (value, loaded_at, now)
        return value


def _cache_set(cache: dict, key: str, value, max_entries: int | None = None):
    limit = max_entries or _READ_CACHE_MAX_ENTRIES
    now = time.monotonic()
    with _READ_CACHE_LOCK:
        cache[key] = (_NEGATIVE_CACHE_VALUE if value is None else value, now, now)
        while len(cache) > limit:
            oldest_key = min(cache, key=lambda item: cache[item][2])
            cache.pop(oldest_key, None)


def _clear_read_caches():
    """Seam de tests; las cachés live son de proceso y no persisten fuera de la instancia."""
    with _READ_CACHE_LOCK:
        _ASSET_CACHE.clear()
        _METRICS_CACHE.clear()
        _HOLDINGS_SUMMARY_CACHE.clear()
        _HOLDINGS_FULL_CACHE.clear()


# Ola A2 (A2.1): mismo alfabeto que portfolios.repository.ASSET_ID_RE. Un id
# como «X/holdings/latest» construia rutas de subdocumentos arbitrarias bajo
# assets/; ahora cualquier id fuera del alfabeto se trata como inexistente en
# TODO el read model (una sola puerta para todas las callables de lectura).
_ASSET_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")


def _valid_asset_id(asset_id) -> bool:
    return isinstance(asset_id, str) and bool(_ASSET_ID_RE.fullmatch(asset_id))


def _unique_ids(asset_ids: list[str]) -> list[str]:
    cleaned = (str(asset_id).strip() for asset_id in asset_ids if str(asset_id).strip())
    return list(dict.fromkeys(aid for aid in cleaned if _valid_asset_id(aid)))


def _chunks(items: list, size: int = _READ_BATCH_SIZE):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def _is_orphaned_legacy(doc: dict | None) -> bool:
    quality = (doc or {}).get("quality") or {}
    return isinstance(quality, dict) and quality.get("status") == "ORPHANED_LEGACY"


def _normalize_storage_mode(doc: dict) -> dict:
    out = dict(doc)
    if out.get("storage_mode") == "CHUNKED_DOCUMENTS":
        out["storage_mode"] = "CHUNKED"
    return out


def _safe_int(value, default=0) -> int:
    try:
        return int(value)
    except Exception:
        swallowed("firestore_client.py:126")
        return default


def get_master_db():
    """Cliente Firestore apuntando al proyecto MAESTRO (cross-project, solo lectura)."""
    global _client
    if _client is None:
        _client = gcf.Client(project=master_project_id())
    return _client


class FirestoreReader:
    def __init__(self, db=None, *, read_timeout=None):
        self.db = db or get_master_db()
        self._read_timeout = read_timeout

    def _read_options(self):
        if self._read_timeout is None:
            return {}
        return {'timeout': self._read_timeout, 'retry': Retry(deadline=self._read_timeout)}

    def get_asset(self, asset_id: str) -> Optional[dict]:
        if not _valid_asset_id(asset_id):
            return None
        cached = _cache_get(_ASSET_CACHE, asset_id)
        if cached is _NEGATIVE_CACHE_VALUE:
            return None
        if cached is not None:
            return cached
        snap = self.db.collection("assets").document(asset_id).get(**self._read_options())
        if not snap.exists:
            _cache_set(_ASSET_CACHE, asset_id, None)
            return None
        d = snap.to_dict() or {}
        d.setdefault("asset_id", snap.id)
        _cache_set(_ASSET_CACHE, asset_id, d)
        return d

    def get_assets_many(self, asset_ids: list[str]) -> dict:
        ids = _unique_ids(asset_ids)
        out, missing = {}, []
        for asset_id in ids:
            cached = _cache_get(_ASSET_CACHE, asset_id)
            if cached is _NEGATIVE_CACHE_VALUE:
                continue
            if cached is not None:
                out[asset_id] = cached
            else:
                missing.append(asset_id)
        for batch_ids in _chunks(missing):
            refs = [self.db.collection("assets").document(asset_id) for asset_id in batch_ids]
            try:
                for snap in self.db.get_all(refs, **self._read_options()):
                    if not snap.exists:
                        continue
                    item = snap.to_dict() or {}
                    item.setdefault("asset_id", snap.id)
                    out[snap.id] = item
                    _cache_set(_ASSET_CACHE, snap.id, item)
                for asset_id in batch_ids:
                    if asset_id not in out:
                        _cache_set(_ASSET_CACHE, asset_id, None)
            except Exception:
                if self._read_timeout is not None:
                    # A failed bounded batch must not fan out into N fresh retry budgets.
                    raise
                swallowed("firestore_client.py:183")
                for asset_id in batch_ids:
                    item = self.get_asset(asset_id)
                    if item is not None:
                        out[asset_id] = item
        return {asset_id: out[asset_id] for asset_id in ids if asset_id in out}

    def get_metrics_latest(self, asset_id: str) -> Optional[dict]:
        cached = _cache_get(_METRICS_CACHE, asset_id)
        if cached is _NEGATIVE_CACHE_VALUE:
            return None
        if cached is not None:
            return cached
        try:
            snap = (self.db.collection("assets").document(asset_id)
                    .collection("metrics").document("latest").get())
            item = snap.to_dict() if snap.exists else None
            _cache_set(_METRICS_CACHE, asset_id, item)
            return item
        except Exception:
            swallowed("firestore_client.py:202")
            return None

    def get_metrics_latest_many(self, asset_ids: list[str]) -> dict:
        ids = _unique_ids(asset_ids)
        out, missing = {}, []
        for asset_id in ids:
            cached = _cache_get(_METRICS_CACHE, asset_id)
            if cached is _NEGATIVE_CACHE_VALUE:
                continue
            if cached is not None:
                out[asset_id] = cached
            else:
                missing.append(asset_id)
        for batch_ids in _chunks(missing):
            refs = [
                self.db.collection("assets").document(asset_id)
                .collection("metrics").document("latest")
                for asset_id in batch_ids
            ]
            try:
                for snap in self.db.get_all(refs):
                    if not snap.exists:
                        continue
                    asset_id = snap.reference.parent.parent.id
                    item = snap.to_dict() or {}
                    out[asset_id] = item
                    _cache_set(_METRICS_CACHE, asset_id, item)
                for asset_id in batch_ids:
                    if asset_id not in out:
                        _cache_set(_METRICS_CACHE, asset_id, None)
            except Exception:
                swallowed("firestore_client.py:233")
                for asset_id in batch_ids:
                    item = self.get_metrics_latest(asset_id)
                    if item is not None:
                        out[asset_id] = item
        return {asset_id: out[asset_id] for asset_id in ids if asset_id in out}

    def get_search_index(self) -> Optional[dict]:
        global _SEARCH_INDEX_CACHE
        now = time.time()
        if _SEARCH_INDEX_CACHE and _SEARCH_INDEX_CACHE[0] > now:
            return _SEARCH_INDEX_CACHE[1]
        try:
            snap = self.db.collection("meta").document("search_index").get()
            doc = snap.to_dict() if snap.exists else None
            _SEARCH_INDEX_CACHE = (now + _SEARCH_INDEX_TTL, doc)
            return doc
        except Exception:
            swallowed("firestore_client.py:250")
            _SEARCH_INDEX_CACHE = (now + _SEARCH_INDEX_TTL, None)
            return None

    def get_holdings(self, asset_id: str) -> Optional[dict]:
        cached = _cache_get(_HOLDINGS_FULL_CACHE, asset_id)
        if cached is _NEGATIVE_CACHE_VALUE:
            return None
        if cached is not None:
            return cached
        item = self._load_holdings_uncached(asset_id)
        if item and isinstance(item.get("data", {}).get("holdings"), list):
            from fund_data_quality import normalize_holdings
            item["data"]["holdings"] = normalize_holdings(asset_id, item["data"]["holdings"])
        _cache_set(_HOLDINGS_FULL_CACHE, asset_id, item, _HOLDINGS_FULL_CACHE_MAX_ENTRIES)
        return item

    def _load_holdings_uncached(self, asset_id: str) -> Optional[dict]:
        try:
            snap = (self.db.collection("assets").document(asset_id)
                    .collection("holdings").document("latest").get())
            if snap.exists:
                latest = snap.to_dict() or {}
                if (not _is_orphaned_legacy(latest)
                        and latest.get("storage_mode") not in ("CHUNKED", "CHUNKED_DOCUMENTS")):
                    return {"data": _normalize_storage_mode(latest)}

            manifest_snap = (self.db.collection("assets").document(asset_id)
                             .collection("holdings").document("manifest").get())
            if not manifest_snap.exists:
                return None
            manifest = _normalize_storage_mode(manifest_snap.to_dict() or {})
            if _is_orphaned_legacy(manifest):
                return None
            if manifest.get("storage_mode") not in ("CHUNKED", "CHUNKED_DOCUMENTS"):
                return {"data": manifest}

            chunk_count = _safe_int(manifest.get("chunk_count", manifest.get("chunks_count", 0)) or 0)
            chunk_count = min(max(chunk_count, 0), MAX_HOLDINGS_CHUNKS)
            holdings = []
            for index in range(chunk_count):
                chunk_id = f"chunk_{index:04d}"
                chunk_snap = (self.db.collection("assets").document(asset_id)
                              .collection("holdings").document("manifest")
                              .collection("chunks").document(chunk_id).get())
                if chunk_snap.exists:
                    chunk = chunk_snap.to_dict() or {}
                    if _is_orphaned_legacy(chunk):
                        continue
                    if isinstance(chunk.get("holdings"), list):
                        holdings.extend(chunk["holdings"])
            data = dict(manifest)
            data["holdings"] = holdings
            return {"data": data}
        except Exception:
            swallowed("firestore_client.py:300")
            return None

    def get_holdings_many(self, asset_ids: list[str]) -> dict:
        """Holdings completos de varios activos con 1 round-trip (ola 3b).

        Un solo `get_all` sobre holdings/latest resuelve el caso común; los
        activos sin latest utilizable (chunked o huérfano) caen a la lectura
        individual, que recorre el manifest. Comparte caché —negativos
        incluidos— con la vía unitaria `get_holdings`.
        """
        ids = _unique_ids(asset_ids)
        out, missing = {}, []
        for asset_id in ids:
            cached = _cache_get(_HOLDINGS_FULL_CACHE, asset_id)
            if cached is _NEGATIVE_CACHE_VALUE:
                continue
            if cached is not None:
                out[asset_id] = cached
            else:
                missing.append(asset_id)

        for batch_ids in _chunks(missing):
            unresolved = set(batch_ids)
            latest_refs = [
                self.db.collection("assets").document(asset_id)
                .collection("holdings").document("latest")
                for asset_id in batch_ids
            ]
            try:
                for snap in self.db.get_all(latest_refs):
                    asset_id = snap.reference.parent.parent.id
                    if not snap.exists:
                        continue
                    latest = snap.to_dict() or {}
                    if (_is_orphaned_legacy(latest)
                            or latest.get("storage_mode") in ("CHUNKED", "CHUNKED_DOCUMENTS")):
                        continue
                    item = {"data": _normalize_storage_mode(latest)}
                    if isinstance(item["data"].get("holdings"), list):
                        from fund_data_quality import normalize_holdings
                        item["data"]["holdings"] = normalize_holdings(asset_id, item["data"]["holdings"])
                    out[asset_id] = item
                    unresolved.discard(asset_id)
                    _cache_set(_HOLDINGS_FULL_CACHE, asset_id, item, _HOLDINGS_FULL_CACHE_MAX_ENTRIES)
            except Exception:
                swallowed("firestore_client.py:341")
                # get_all no disponible o fallo del lote: la vía individual
                # (con su propia caché y manejo de errores) resuelve el resto.
                pass
            for asset_id in sorted(unresolved):
                item = self.get_holdings(asset_id)
                if item is not None:
                    out[asset_id] = item

        return {asset_id: out[asset_id] for asset_id in ids if asset_id in out}

    def _load_holdings_summary_uncached(self, asset_id: str) -> Optional[dict]:
        try:
            snap = (self.db.collection("assets").document(asset_id)
                    .collection("holdings").document("latest")
                    .get(field_paths=["holdings_count", "top10_weight", "as_of_date", "storage_mode", "quality.status"]))
            if snap.exists:
                latest = snap.to_dict() or {}
                if not _is_orphaned_legacy(latest):
                    return {"data": _normalize_storage_mode(latest)}
            manifest_snap = (self.db.collection("assets").document(asset_id)
                             .collection("holdings").document("manifest").get())
            if manifest_snap.exists:
                manifest = manifest_snap.to_dict() or {}
                if not _is_orphaned_legacy(manifest):
                    return {"data": _normalize_storage_mode(manifest)}
            return None
        except Exception:
            swallowed("firestore_client.py:368")
            return None

    def get_holdings_summary(self, asset_id: str) -> Optional[dict]:
        # Resumen BARATO de holdings: lee SOLO los campos pequenos (no el array `holdings`,
        # que es lo que pesa). Asi el dato NECESARIO (presencia + count + top10) esta SIEMPRE
        # disponible en vistas multi-activo (cartera, comparar, buscar) sin agotar memoria.
        cached = _cache_get(_HOLDINGS_SUMMARY_CACHE, asset_id)
        if cached is _NEGATIVE_CACHE_VALUE:
            return None
        if cached is not None:
            return cached
        item = self._load_holdings_summary_uncached(asset_id)
        _cache_set(_HOLDINGS_SUMMARY_CACHE, asset_id, item)
        return item

    def get_holdings_summaries_many(self, asset_ids: list[str]) -> dict:
        ids = _unique_ids(asset_ids)
        out, missing = {}, []
        for asset_id in ids:
            cached = _cache_get(_HOLDINGS_SUMMARY_CACHE, asset_id)
            if cached is _NEGATIVE_CACHE_VALUE:
                continue
            if cached is not None:
                out[asset_id] = cached
            else:
                missing.append(asset_id)

        for batch_ids in _chunks(missing):
            unresolved = set(batch_ids)
            latest_refs = [
                self.db.collection("assets").document(asset_id)
                .collection("holdings").document("latest")
                for asset_id in batch_ids
            ]
            try:
                for snap in self.db.get_all(
                    latest_refs,
                    field_paths=["holdings_count", "top10_weight", "as_of_date", "storage_mode", "quality.status"]
                ):
                    asset_id = snap.reference.parent.parent.id
                    if not snap.exists:
                        continue
                    latest = snap.to_dict() or {}
                    if _is_orphaned_legacy(latest):
                        continue
                    item = {"data": _normalize_storage_mode(latest)}
                    if isinstance(item["data"].get("holdings"), list):
                        from fund_data_quality import normalize_holdings
                        item["data"]["holdings"] = normalize_holdings(asset_id, item["data"]["holdings"])
                    out[asset_id] = item
                    unresolved.discard(asset_id)
                    _cache_set(_HOLDINGS_SUMMARY_CACHE, asset_id, item)

                manifest_refs = [
                    self.db.collection("assets").document(asset_id)
                    .collection("holdings").document("manifest")
                    for asset_id in batch_ids if asset_id in unresolved
                ]
                if manifest_refs:
                    for snap in self.db.get_all(manifest_refs):
                        asset_id = snap.reference.parent.parent.id
                        if not snap.exists:
                            continue
                        manifest = snap.to_dict() or {}
                        if _is_orphaned_legacy(manifest):
                            continue
                        item = {"data": _normalize_storage_mode(manifest)}
                        out[asset_id] = item
                        unresolved.discard(asset_id)
                        _cache_set(_HOLDINGS_SUMMARY_CACHE, asset_id, item)
                for asset_id in unresolved:
                    _cache_set(_HOLDINGS_SUMMARY_CACHE, asset_id, None)
            except Exception:
                swallowed("firestore_client.py:438")
                for asset_id in batch_ids:
                    item = self._load_holdings_summary_uncached(asset_id)
                    if item is not None:
                        out[asset_id] = item
                    _cache_set(_HOLDINGS_SUMMARY_CACHE, asset_id, item)

        return {asset_id: out[asset_id] for asset_id in ids if asset_id in out}

    def _list_one_type(self, t: str, limit: int) -> list:
        """Lista un tipo con cache en memoria (TTL). Reutiliza si el cache cubre el limite."""
        now = time.time()
        c = _LIST_CACHE.get(t)
        if c and c[0] > now and c[1] >= limit:
            return c[2][:limit]
        docs = []
        q = (self.db.collection("assets")
             .where(filter=FieldFilter("asset_type", "==", t))
             .select(LIST_CARD_FIELD_PATHS)
             .limit(limit).stream())
        for snap in q:
            d = snap.to_dict() or {}
            d.setdefault("asset_id", snap.id)
            docs.append(d)
        _LIST_CACHE[t] = (now + _LIST_TTL, limit, docs)
        return docs

    def list_assets(self, types, limit: int) -> list:
        out = []
        for t in types:
            out.extend(self._list_one_type(t, limit))
        return out
