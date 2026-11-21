import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from readmodel import firestore_client as FC
from readmodel.firestore_client import FirestoreReader


@pytest.fixture(autouse=True)
def clear_read_caches():
    FC._clear_read_caches()
    yield
    FC._clear_read_caches()


class Snap:
    def __init__(self, data=None, reference=None):
        self._data = data
        self.exists = data is not None
        self.reference = reference
        self.id = reference.path.rsplit("/", 1)[-1] if reference else ""

    def to_dict(self):
        return self._data


class DocRef:
    def __init__(self, store, path, stats=None):
        self.store = store
        self.path = path
        self.stats = stats

    @property
    def id(self):
        return self.path.rsplit("/", 1)[-1]

    @property
    def parent(self):
        return CollectionRef(self.store, self.path.rsplit("/", 1)[0], self.stats)

    def collection(self, name):
        return CollectionRef(self.store, f"{self.path}/{name}", self.stats)

    def document(self, name):
        return DocRef(self.store, f"{self.path}/{name}", self.stats)

    def get(self, **kwargs):
        if self.stats is not None:
            self.stats["single_get_calls"] += 1
        return Snap(self.store.get(self.path), self)


class CollectionRef:
    def __init__(self, store, path, stats=None):
        self.store = store
        self.path = path
        self.stats = stats

    @property
    def parent(self):
        parent_path = self.path.rsplit("/", 1)[0]
        return DocRef(self.store, parent_path, self.stats)

    def document(self, name):
        return DocRef(self.store, f"{self.path}/{name}", self.stats)


class FakeDb:
    def __init__(self, store):
        self.store = store
        self.stats = {"single_get_calls": 0, "get_all_calls": 0}

    def collection(self, name):
        return CollectionRef(self.store, name, self.stats)

    def get_all(self, refs, field_paths=None):
        self.stats["get_all_calls"] += 1
        return [Snap(self.store.get(ref.path), ref) for ref in refs]


@pytest.mark.parametrize("latest_pointer", [False, True])
@pytest.mark.parametrize("batch", [False, True])
def test_get_holdings_assembles_chunked_manifest(latest_pointer, batch):
    store = {
        "assets/LU0000000001/holdings/manifest": {
            "storage_mode": "CHUNKED",
            "chunk_count": 2,
            "holdings_count": 3,
            "top10_weight": 42.0,
            "as_of_date": "2026-06-30",
        },
        "assets/LU0000000001/holdings/manifest/chunks/chunk_0000": {
            "storage_mode": "CHUNK",
            "chunk_index": 0,
            "holdings": [{"holding_id": "a"}, {"holding_id": "b"}],
        },
        "assets/LU0000000001/holdings/manifest/chunks/chunk_0001": {
            "storage_mode": "CHUNK",
            "chunk_index": 1,
            "holdings": [{"holding_id": "c"}],
        },
    }

    if latest_pointer:
        store["assets/LU0000000001/holdings/latest"] = dict(store["assets/LU0000000001/holdings/manifest"])
    reader = FirestoreReader(FakeDb(store))
    result = (reader.get_holdings_many(["LU0000000001"])["LU0000000001"] if batch
              else reader.get_holdings("LU0000000001"))

    assert result["data"]["storage_mode"] == "CHUNKED"
    assert [h["holding_id"] for h in result["data"]["holdings"]] == ["a", "b", "c"]


def test_get_holdings_summary_uses_manifest_when_latest_missing():
    store = {
        "assets/LU0000000001/holdings/manifest": {
            "storage_mode": "CHUNKED",
            "chunk_count": 1,
            "holdings_count": 10,
            "top10_weight": 42.0,
        }
    }

    result = FirestoreReader(FakeDb(store)).get_holdings_summary("LU0000000001")

    assert result["data"]["storage_mode"] == "CHUNKED"
    assert result["data"]["holdings_count"] == 10


def test_get_holdings_ignores_orphaned_latest_and_reads_manifest():
    store = {
        "assets/LU0000000001/holdings/latest": {
            "storage_mode": "SINGLE_DOCUMENT",
            "quality": {"status": "ORPHANED_LEGACY"},
            "holdings": [{"holding_id": "old"}],
        },
        "assets/LU0000000001/holdings/manifest": {
            "storage_mode": "CHUNKED_DOCUMENTS",
            "chunk_count": 1,
            "holdings_count": 1,
            "top10_weight": 11.0,
            "as_of_date": "2026-06-30",
        },
        "assets/LU0000000001/holdings/manifest/chunks/chunk_0000": {
            "storage_mode": "CHUNK",
            "chunk_index": 0,
            "holdings": [{"holding_id": "new"}],
        },
    }

    result = FirestoreReader(FakeDb(store)).get_holdings("LU0000000001")

    assert result["data"]["storage_mode"] == "CHUNKED"
    assert [h["holding_id"] for h in result["data"]["holdings"]] == ["new"]


def test_get_holdings_skips_orphaned_chunks():
    store = {
        "assets/LU0000000001/holdings/manifest": {
            "storage_mode": "CHUNKED",
            "chunk_count": 2,
            "holdings_count": 2,
            "top10_weight": 22.0,
            "as_of_date": "2026-06-30",
        },
        "assets/LU0000000001/holdings/manifest/chunks/chunk_0000": {
            "storage_mode": "CHUNK",
            "chunk_index": 0,
            "quality": {"status": "ORPHANED_LEGACY"},
            "holdings": [{"holding_id": "old"}],
        },
        "assets/LU0000000001/holdings/manifest/chunks/chunk_0001": {
            "storage_mode": "CHUNK",
            "chunk_index": 1,
            "holdings": [{"holding_id": "new"}],
        },
    }

    result = FirestoreReader(FakeDb(store)).get_holdings("LU0000000001")

    assert [h["holding_id"] for h in result["data"]["holdings"]] == ["new"]


def test_batch_reads_seed_warm_caches_without_repeating_firestore_calls():
    store = {
        "assets/A": {"asset_type": "FUND"},
        "assets/B": {"asset_type": "ETF"},
        "assets/A/metrics/latest": {"volatility_3y": 0.1},
        "assets/B/metrics/latest": {"volatility_3y": 0.2},
        "assets/A/holdings/latest": {"holdings_count": 10, "top10_weight": 50},
        "assets/B/holdings/latest": {"holdings_count": 20, "top10_weight": 40},
    }
    db = FakeDb(store)
    reader = FirestoreReader(db)

    assert list(reader.get_assets_many(["B", "A"])) == ["B", "A"]
    assert list(reader.get_metrics_latest_many(["B", "A"])) == ["B", "A"]
    assert list(reader.get_holdings_summaries_many(["B", "A"])) == ["B", "A"]
    first_batch_calls = db.stats["get_all_calls"]
    assert first_batch_calls == 3

    assert reader.get_asset("A")["asset_id"] == "A"
    assert reader.get_metrics_latest("A")["volatility_3y"] == 0.1
    assert reader.get_holdings_summary("A")["data"]["holdings_count"] == 10
    assert db.stats == {"single_get_calls": 0, "get_all_calls": first_batch_calls}


def test_read_cache_ttl_and_lru(monkeypatch):
    cache = {}
    clock = {"now": 0.0}
    monkeypatch.setattr(FC.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(FC, "_READ_CACHE_TTL", 10)
    monkeypatch.setattr(FC, "_READ_CACHE_MAX_ENTRIES", 2)

    FC._cache_set(cache, "A", {"value": "A"})
    clock["now"] = 1
    FC._cache_set(cache, "B", {"value": "B"})
    clock["now"] = 2
    assert FC._cache_get(cache, "A") == {"value": "A"}
    clock["now"] = 3
    FC._cache_set(cache, "C", {"value": "C"})

    assert set(cache) == {"A", "C"}
    clock["now"] = 13.1
    assert FC._cache_get(cache, "A") is None


def test_missing_documents_are_negatively_cached_for_the_ttl():
    db = FakeDb({})
    reader = FirestoreReader(db)

    assert reader.get_assets_many(["MISSING"]) == {}
    assert reader.get_metrics_latest_many(["MISSING"]) == {}
    assert reader.get_holdings_summaries_many(["MISSING"]) == {}
    first_stats = dict(db.stats)

    assert reader.get_asset("MISSING") is None
    assert reader.get_metrics_latest("MISSING") is None
    assert reader.get_holdings_summary("MISSING") is None
    assert db.stats == first_stats


def test_frequently_read_cache_entry_expires_from_load_time(monkeypatch):
    cache = {}
    clock = {'now': 0.0}
    monkeypatch.setattr(FC.time, 'monotonic', lambda: clock['now'])
    monkeypatch.setattr(FC, '_READ_CACHE_TTL', 10)
    FC._cache_set(cache, 'A', {'version': 1})
    for timestamp in [3, 6, 9]:
        clock['now'] = timestamp
        assert FC._cache_get(cache, 'A') == {'version': 1}
    clock['now'] = 10
    assert FC._cache_get(cache, 'A') is None
    FC._cache_set(cache, 'A', {'version': 2})
    assert FC._cache_get(cache, 'A') == {'version': 2}



def test_get_holdings_many_resolves_latest_in_one_get_all():
    """Ola 3b: el lote de holdings/latest viaja en UN get_all; el chunked cae
    a la via individual y los negativos se cachean."""
    store = {
        "assets/A1/holdings/latest": {"storage_mode": "INLINE", "holdings": [{"holding_id": "x"}]},
        "assets/A2/holdings/latest": {"storage_mode": "INLINE", "holdings": [{"holding_id": "y"}]},
        # A3: chunked (sin latest) -> via individual
        "assets/A3/holdings/manifest": {
            "storage_mode": "CHUNKED",
            "chunk_count": 1,
        },
        "assets/A3/holdings/manifest/chunks/chunk_0000": {
            "storage_mode": "CHUNK",
            "chunk_index": 0,
            "holdings": [{"holding_id": "z"}],
        },
    }
    db = FakeDb(store)
    reader = FirestoreReader(db)

    result = reader.get_holdings_many(["A1", "A2", "A3", "A4"])

    assert db.stats["get_all_calls"] == 1, "el caso comun es un unico round-trip"
    assert [h["holding_id"] for h in result["A1"]["data"]["holdings"]] == ["x"]
    assert [h["holding_id"] for h in result["A2"]["data"]["holdings"]] == ["y"]
    assert [h["holding_id"] for h in result["A3"]["data"]["holdings"]] == ["z"]
    assert "A4" not in result, "sin holdings -> fuera del mapa (negativo cacheado)"

    # Segunda pasada: todo desde cache, cero round-trips nuevos.
    before_get_all = db.stats["get_all_calls"]
    before_single = db.stats["single_get_calls"]
    again = reader.get_holdings_many(["A1", "A2", "A3", "A4"])
    assert db.stats["get_all_calls"] == before_get_all
    assert db.stats["single_get_calls"] == before_single
    assert [h["holding_id"] for h in again["A1"]["data"]["holdings"]] == ["x"]


def test_get_holdings_unitario_comparte_cache_con_el_batch():
    store = {
        "assets/A1/holdings/latest": {"storage_mode": "INLINE", "holdings": [{"holding_id": "x"}]},
    }
    db = FakeDb(store)
    reader = FirestoreReader(db)

    reader.get_holdings_many(["A1"])
    singles_after_batch = db.stats["single_get_calls"]
    result = reader.get_holdings("A1")

    assert db.stats["single_get_calls"] == singles_after_batch, "la via unitaria reutiliza la cache del batch"
    assert [h["holding_id"] for h in result["data"]["holdings"]] == ["x"]
