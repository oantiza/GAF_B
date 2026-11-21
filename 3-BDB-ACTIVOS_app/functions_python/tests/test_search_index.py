import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import search_index  # noqa: E402


class Snap:
    def __init__(self, id_, data=None):
        self.id = id_
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class IndexDoc:
    def __init__(self, db):
        self.db = db

    def get(self):
        return Snap("search_index", self.db.index)

    def set(self, payload):
        self.db.index = payload
        self.db.writes += 1


class Collection:
    def __init__(self, db, name):
        self.db = db
        self.name = name

    def stream(self):
        assert self.name == "assets"
        return [Snap(asset_id, root) for asset_id, root in sorted(self.db.roots.items())]

    def document(self, doc_id):
        assert self.name == "meta" and doc_id == "search_index"
        return IndexDoc(self.db)


class FakeDb:
    def __init__(self, roots, index):
        self.roots = roots
        self.index = index
        self.writes = 0

    def collection(self, name):
        return Collection(self, name)


def _root(name, asset_type="FUND", status="ACCEPTED"):
    return {
        "asset_type": asset_type,
        "identity": {"name": name, "currency": "EUR"},
        "identifiers": {"ticker": "ABC"},
        "classification": {"asset_class": "Renta variable"},
        "quality": {"status": status},
    }


def test_entry_from_root_indexes_mapped_instrument_type():
    # Un ETC de oro: asset_type crudo "OTHER" pero product_type "etc" → ETF.
    root = _root("iShares Physical Gold ETC", asset_type="OTHER")
    root["product"] = {"product_type": "etc"}
    entry = search_index.entry_from_root("IE00B4ND3602", root)
    assert entry is not None
    assert entry["type"] == "ETF"

    # Sin señal de producto, el crudo se conserva (honesto, no inventa tipo).
    entry_raw = search_index.entry_from_root("IE00B4ND3603", _root("Raro", asset_type="OTHER"))
    assert entry_raw is not None
    assert entry_raw["type"] == "OTHER"


def test_build_search_index_excludes_legacy_and_folds_accents():
    payload = search_index.build_search_index_document([
        ("ES0000000001", _root("Gestión Índice")),
        ("EODHD_ABC.US", _root("Legacy")),
        ("FR0000000002", _root("Archivado", status="ARCHIVED_LEGACY")),
    ], updated_at="2026-07-10T00:00:00Z")

    assert payload["count"] == 1
    assert payload["entries"][0]["name_folded"] == "gestion indice"


def test_reconcile_search_index_repairs_missing_and_unknown(monkeypatch):
    roots = {
        "ES0000000001": _root("Activo Uno"),
        "FR0000000002": _root("Activo Dos", asset_type="ETF"),
    }
    current = search_index.build_search_index_document(
        [("ES0000000001", roots["ES0000000001"]), ("DE0000000003", _root("Desconocido"))],
        updated_at="2026-07-09T00:00:00Z",
    )
    db = FakeDb(roots, current)
    monkeypatch.setattr(search_index, "require_master_writes_enabled", lambda _operation: None)
    monkeypatch.setattr(search_index, "require_search_index_writes_enabled", lambda _operation: None)

    result = search_index.reconcile_search_index(write=True, db=db)

    assert result["missing_ids"] == ["FR0000000002"]
    assert result["unknown_ids"] == ["DE0000000003"]
    assert result["applied"] is True
    assert db.writes == 1
    assert db.index["count"] == 2
