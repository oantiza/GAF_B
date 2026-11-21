# -*- coding: utf-8 -*-
"""ALTA-01 (auditoria 14-10-2026): una serie nueva no se queda sin metrics/latest.

metrics_refresh solo actualiza documentos que existen; antes, un activo cargado por el
backfill quedaba fuera del refresco para siempre. Ahora el backfill crea el documento
(create-only, mismo calculo que la ingesta) si falta, y nunca pisa uno existente.
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import history_backfill as hb  # noqa: E402
import price_refresh  # noqa: E402

ISIN = "LU0000000001"


class _Snap:
    def __init__(self, data):
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data or {})


class _DocRef:
    def __init__(self, store, path):
        self.store, self.path = store, path

    def get(self):
        return _Snap(self.store.get(self.path))

    def create(self, payload):
        if self.path in self.store:
            raise RuntimeError("AlreadyExists: %s" % self.path)
        self.store[self.path] = dict(payload)
        self.store.setdefault("_creates", []).append(self.path)

    def collection(self, name):
        return _Collection(self.store, "%s/%s" % (self.path, name))


class _Query:
    def __init__(self, store, prefix):
        self.store, self.prefix = store, prefix

    def select(self, _fields):
        return self

    def limit(self, _n):
        return self

    def stream(self):
        return [_Snap(v) for k, v in self.store.items()
                if isinstance(k, str) and k.startswith(self.prefix + "/") and k.count("/") == self.prefix.count("/") + 1]


class _Collection(_Query):
    def document(self, doc_id):
        return _DocRef(self.store, "%s/%s" % (self.prefix, doc_id))


class _Batch:
    def __init__(self, store):
        self.store, self.ops = store, []

    def create(self, ref, payload):
        self.ops.append((ref, payload))

    def commit(self):
        for ref, payload in self.ops:
            ref.create(payload)
        self.ops = []


class _Db:
    def __init__(self, store):
        self.store = store

    def collection(self, name):
        return _Collection(self.store, name)

    def batch(self):
        return _Batch(self.store)


def _points(days=900):
    start = date(2023, 1, 2)
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        if d.weekday() < 5:
            out.append({"date": d.isoformat(), "value": round(100.0 * (1.0003 ** i), 6)})
    return out


def _rate(_start, _end):
    return {"rate": 0.02}


def _patch_provider(monkeypatch, points, metrics_gate=True):
    if metrics_gate:
        monkeypatch.setenv("METRICS_WRITE_ENABLED", "true")
    else:
        monkeypatch.delenv("METRICS_WRITE_ENABLED", raising=False)
    monkeypatch.setattr(price_refresh, "fetch_eod", lambda *a, **k: list(points))
    monkeypatch.setattr(price_refresh, "listing_currency", lambda symbol: "EUR")
    monkeypatch.setattr(price_refresh, "_convert_eur", lambda rows, *a, **k: (list(rows), {"source_currency": "EUR"}))
    monkeypatch.setattr(price_refresh, "_now_iso", lambda: "2026-10-14T08:00:00.000Z")
    monkeypatch.setattr(price_refresh, "_today", lambda: "2026-10-14")
    import ingest_asset
    monkeypatch.setattr(ingest_asset, "_estr_window_resolver", _rate)


def _root():
    return {"asset_id": ISIN, "asset_type": "FUND",
            "identifiers": {"isin": ISIN, "eodhd_code": "%s.EUFUND" % ISIN},
            "identity": {"name": "Fondo", "currency": "EUR"}}


def test_backfill_creates_metrics_latest_when_missing(monkeypatch):
    _patch_provider(monkeypatch, _points())
    store = {"assets/%s" % ISIN: _root()}

    preview = hb.backfill_one(_Db(store), ISIN, write=False, fx_cache={})
    assert preview["ok"] is True and preview["applied"] is False
    assert preview["metrics_latest"] == {"status": "WOULD_CREATE", "metrics_writes_enabled": True}
    assert "assets/%s/metrics/latest" % ISIN not in store, "la vista previa no escribe"

    out = hb.backfill_one(_Db(store), ISIN, write=True, fx_cache={})
    assert out["applied"] is True and out["error"] is None
    assert out["metrics_latest"]["status"] == "CREATED"
    doc = store["assets/%s/metrics/latest" % ISIN]
    assert doc["population"] == "fund"
    assert doc["last_date"] == out["last_date"]
    assert set(doc["windows"]) >= {"1y"}
    assert doc["windows"]["1y"]["risk_free_rate"] == 0.02


def test_backfill_never_overwrites_an_existing_metrics_latest(monkeypatch):
    _patch_provider(monkeypatch, _points())
    provider_doc = {"asset_id": ISIN, "source": "FONDOSDB_ROOT_ES", "windows": {}}
    store = {"assets/%s" % ISIN: _root(), "assets/%s/metrics/latest" % ISIN: provider_doc}

    out = hb.backfill_one(_Db(store), ISIN, write=True, fx_cache={})
    assert out["applied"] is True
    assert out["metrics_latest"] == {"status": "EXISTS"}
    assert store["assets/%s/metrics/latest" % ISIN] == provider_doc


def test_metrics_without_rate_are_not_written_and_point_to_the_migration(monkeypatch):
    import ingest_asset
    monkeypatch.setattr(ingest_asset, "_estr_window_resolver", lambda *_a: None)
    monkeypatch.setenv("METRICS_WRITE_ENABLED", "true")
    store = {"assets/%s" % ISIN: _root()}
    ref = _Db(store).collection("assets").document(ISIN)
    result = hb.ensure_metrics_latest(ref, ISIN, "FUND", _points(), "2026-10-14T08:00:00.000Z", True,
                                      risk_free_resolver=lambda *_a: None)
    assert result["status"] == "NO_RATE"
    assert "migrate_metrics_latest.py" in result["next_step"]
    assert "assets/%s/metrics/latest" % ISIN not in store


def test_backfill_needs_the_metrics_gate_to_create_metrics_latest(monkeypatch):
    """Revision 14-10: crear metrics/latest exige METRICS_WRITE_ENABLED, como el refresco."""
    _patch_provider(monkeypatch, _points(), metrics_gate=False)
    store = {"assets/%s" % ISIN: _root()}

    preview = hb.backfill_one(_Db(store), ISIN, write=False, fx_cache={})
    assert preview["metrics_latest"] == {"status": "WOULD_CREATE", "metrics_writes_enabled": False}

    out = hb.backfill_one(_Db(store), ISIN, write=True, fx_cache={})
    assert out["applied"] is True, "la serie se carga con el gate de la maestra"
    assert out["metrics_latest"]["status"] == "METRICS_WRITES_DISABLED"
    assert "METRICS_WRITE_ENABLED" in out["metrics_latest"]["next_step"]
    assert "assets/%s/metrics/latest" % ISIN not in store


def test_backfill_leaves_provider_bridge_funds_to_the_republish(monkeypatch):
    """Revision 14-10: un fondo cuya raiz trae el trailing de Morningstar tiene sus
    metricas en el puente del proveedor (FONDOSDB_ROOT_ES): no se crea el calculo propio."""
    _patch_provider(monkeypatch, _points())
    root = _root()
    root["performance"] = {"returns": {"trailing_pct": {"1a": 7.5, "3a_anualizada": 4.1}}}
    root["risk"] = {"volatilidad_pct": {"1a": 9.2}}
    store = {"assets/%s" % ISIN: root}

    out = hb.backfill_one(_Db(store), ISIN, write=True, fx_cache={})
    assert out["applied"] is True
    assert out["metrics_latest"]["status"] == "PROVIDER_BRIDGE"
    assert "migrate_metrics_latest.py" in out["metrics_latest"]["next_step"]
    assert "assets/%s/metrics/latest" % ISIN not in store
    # Una accion (o un fondo sin trailing) si es de la app.
    stock = dict(_root(), asset_type="STOCK", performance=root["performance"])
    assert hb.provider_bridge_owns_metrics(stock) is False
    assert hb.provider_bridge_owns_metrics(_root()) is False


def test_batch_summary_counts_created_and_pending(monkeypatch):
    _patch_provider(monkeypatch, _points())
    store = {"assets/%s" % ISIN: _root()}
    monkeypatch.setattr(price_refresh, "_master_db", lambda: _Db(store))
    import write_governance
    monkeypatch.setattr(write_governance, "require_master_writes_enabled", lambda *a, **k: None)
    summary = hb.backfill_batch([ISIN], write=True, actor_uid="test")
    assert summary["loaded"] == 1
    assert summary["metrics_latest_created"] == 1
    assert summary["metrics_latest_pending"] == []
