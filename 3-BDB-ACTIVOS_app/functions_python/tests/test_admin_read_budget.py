import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import admin_panel  # noqa: E402


class _Parent:
    def __init__(self, parent=None, doc_id=None):
        self.parent = parent
        self.id = doc_id


class _Reference:
    def __init__(self, asset_id):
        self.parent = _Parent(_Parent(doc_id=asset_id))
        self.path = f"assets/{asset_id}/price_series/2025"


class _Snap:
    def __init__(self, doc_id, data, series=False, ref_asset=None):
        self.id = doc_id
        self._data = data
        self.reference = _Reference(ref_asset or doc_id) if (series or ref_asset) else None
        self.exists = True

    def to_dict(self):
        return self._data


class _Query:
    def __init__(self, snaps):
        self._snaps = snaps

    def select(self, _fields):
        return self

    def stream(self):
        return list(self._snaps)


class _MetaDoc:
    def __init__(self, db, doc_id):
        self._db = db
        self._doc_id = doc_id

    def get(self):
        if self._doc_id == admin_panel.ADMIN_INVENTORY_DOC and self._db.inventory is not None:
            return _Snap(self._doc_id, self._db.inventory)
        return _Snap("price_refresh", {"last_run_date": "2025-12-31"})


class _Assets:
    def __init__(self, db):
        self._db = db

    def stream(self):
        self._db.asset_streams += 1
        return [
            _Snap(f"A{i:04d}", {"display_name": f"Asset {i}", "instrument_type": "FUND"})
            for i in range(self._db.asset_count)
        ]

    def document(self, _doc_id):
        self._db.per_asset_queries += 1
        raise AssertionError("El listado agregado no debe abrir price_series activo a activo")


class _Meta:
    def __init__(self, db):
        self._db = db

    def document(self, doc_id):
        return _MetaDoc(self._db, doc_id)


class _BudgetDb:
    def __init__(self, asset_count=200, inventory=None):
        self.asset_count = asset_count
        self.inventory = inventory
        self.asset_streams = 0
        self.group_queries = 0
        self.per_asset_queries = 0

    def collection(self, name):
        if name == "assets":
            return _Assets(self)
        if name == "meta":
            return _Meta(self)
        raise AssertionError(name)

    def collection_group(self, name):
        assert name in ("price_series", "metrics"), name
        self.group_queries += 1
        if name == "metrics":
            # DV3: metrics/latest de cada activo, en una unica consulta agregada.
            # El doc se llama "latest" pero cuelga de assets/{aid}/metrics/.
            return _Query([
                _Snap(
                    "latest",
                    {
                        "max_drawdown_hist": {"pct": -28.1, "fecha": "2020-03-18"},
                        "last_date": "2025-12-31",
                    },
                    ref_asset=f"A{i:04d}",
                )
                for i in range(self.asset_count)
            ])
        return _Query([
            _Snap(
                f"A{i:04d}",
                {
                    "first_date": "2011-01-03",
                    "last_date": "2025-12-31",
                    "observations_count": 250,
                    "source_currency": "EUR",
                },
                series=True,
            )
            for i in range(self.asset_count)
        ])


def test_db_status_uses_constant_query_count(monkeypatch):
    db = _BudgetDb()
    monkeypatch.setattr(admin_panel, "_db", lambda: db)

    result = admin_panel.db_status()

    assert result["total_assets"] == 200
    assert db.asset_streams == 1
    # 2 consultas agregadas: price_series + metrics/latest (DV3); sigue siendo
    # coste constante, nunca una consulta por activo.
    assert db.group_queries == 2
    assert db.per_asset_queries == 0
    # DV3: la cobertura de maxima caida sale de metrics/latest, no del root legado.
    assert result["metrics_present"]["mdd_hist"] == 200


def test_list_assets_uses_constant_query_count(monkeypatch):
    db = _BudgetDb()
    monkeypatch.setattr(admin_panel, "_db", lambda: db)

    result = admin_panel.list_assets(limit=25)

    assert result["total"] == 200
    assert len(result["items"]) == 25
    assert db.asset_streams == 1
    # price_series + metrics/latest (DV3): coste constante, nunca por activo.
    assert db.group_queries == 2
    assert db.per_asset_queries == 0


def test_list_assets_reads_only_materialized_inventory(monkeypatch):
    rows = [
        {
            "asset_id": f"A{i:04d}",
            "name": f"Asset {i}",
            "type": "FUND",
            "last_date": "2025-12-31",
            "points": 250,
            "has_vol": True,
            "has_sharpe": True,
            "has_srri": True,
            "has_mdd": True,
            "has_mdd_hist": True,
            "first_date": "2011-01-03",
            "flags": [],
        }
        for i in range(200)
    ]
    db = _BudgetDb(inventory={
        "schema_version": "admin-asset-inventory.v1",
        "count": len(rows),
        "rows": rows,
    })
    monkeypatch.setattr(admin_panel, "_db", lambda: db)

    result = admin_panel.list_assets(limit=25, offset=50)

    assert result["total"] == 200
    assert len(result["items"]) == 25
    assert db.asset_streams == 0
    assert db.group_queries == 0
    assert db.per_asset_queries == 0
