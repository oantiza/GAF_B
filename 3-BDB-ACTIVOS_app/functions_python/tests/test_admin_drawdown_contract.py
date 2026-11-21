# -*- coding: utf-8 -*-
"""Ronda 2 (14-10-2026): la maxima caida del panel de administracion sigue el contrato
de metricas (metrics.v1.2/1.3): `max_drawdown_hist = {value, date}` y
`max_drawdown_5y` numerico. Antes `asset_detail` devolvia `{value, date}` tal cual y el
frontend leia `{pct, periodo, fecha}`, y `_row` buscaba `max_drawdown_hist.fecha`."""
import datetime
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import admin_panel  # noqa: E402


class _Snap:
    def __init__(self, data, doc_id="x"):
        self._data = data
        self.id = doc_id

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data or {})


class _Query:
    def __init__(self, docs):
        self.docs = docs

    def select(self, _fields):
        return self

    def stream(self):
        return [_Snap(d) for d in self.docs]


class _Doc:
    def __init__(self, data, children=None):
        self.data = data
        self.children = children or {}
        self.path = "assets/X"

    def get(self):
        return _Snap(self.data)

    def collection(self, name):
        child = self.children.get(name, {})
        if name == "price_series":
            return _Query(child)
        return _Col(child)


class _Col:
    def __init__(self, docs):
        self.docs = docs

    def document(self, doc_id):
        return _Doc(self.docs.get(doc_id))


class _Db:
    def __init__(self, asset):
        self.asset = asset

    def collection(self, _name):
        return _Col({"ES0000000001": None}) if self.asset is None else self

    def document(self, _doc_id):
        return self.asset


def _detail(monkeypatch, root, latest):
    series = [{"first_date": "2011-01-03", "last_date": "2026-10-09", "observations_count": 30,
               "points": [{"date": "2026-10-0%d" % i, "value": 100.0 + i} for i in range(1, 10)]}]
    asset = _Doc(root, {"metrics": {"latest": latest}, "price_series": series})
    monkeypatch.setattr(admin_panel, "_db", lambda: _Db(asset))
    monkeypatch.setattr(admin_panel, "_today", lambda: datetime.date(2026, 10, 14))
    return admin_panel.asset_detail("ES0000000001")


def test_asset_detail_returns_metrics_latest_drawdowns_in_contract_shape(monkeypatch):
    latest = {"max_drawdown_hist": {"value": -0.284, "date": "2026-10-05"}, "max_drawdown_5y": -0.153,
              "last_date": "2026-10-09"}
    detail = _detail(monkeypatch, {"asset_type": "FUND"}, latest)
    assert detail["max_drawdown_hist"] == {"value": -0.284, "date": "2026-10-05"}
    assert detail["max_drawdown_5y"] == {"value": -0.153}
    # Transitorio (14-10-2026): la clave antigua con la forma vieja, para el frontend
    # publicado que la exige (requireObject sobre max_drawdown).
    assert detail["max_drawdown"] == {"pct": -15.3, "periodo": "5a"}
    # _row lee la fecha del contrato (`date`): valle a 4 dias del ultimo dato.
    assert "VALLE_RECIENTE" in detail["meta"]["flags"]
    assert detail["meta"]["has_mdd_hist"] is True
    assert detail["meta"]["has_mdd"] is True


def test_asset_detail_converts_the_legacy_root_to_the_contract(monkeypatch):
    root = {"asset_type": "FUND", "risk": {
        "max_drawdown": {"pct": -18.2, "periodo": "5a"},
        "max_drawdown_hist": {"pct": -31.4, "fecha": "2020-03-16"},
    }}
    detail = _detail(monkeypatch, root, None)
    assert detail["max_drawdown_5y"] == {"value": -0.182}
    assert detail["max_drawdown_hist"] == {"value": -0.314, "date": "2020-03-16"}
    assert "VALLE_RECIENTE" not in detail["meta"]["flags"]


def test_asset_detail_without_drawdown_says_none(monkeypatch):
    root = {"asset_type": "FUND", "risk": {"max_drawdown": {"pct": -9.0, "periodo": "3a"}}}
    detail = _detail(monkeypatch, root, {"last_date": "2026-10-09"})
    assert detail["max_drawdown_5y"] is None, "una caida a 3a no se presenta como 5a"
    assert "max_drawdown" in detail and detail["max_drawdown"] is None, "presente aunque vacia"
    assert detail["max_drawdown_hist"] is None
    assert detail["meta"]["has_mdd_hist"] is False


def test_inventory_builder_version_changes_with_the_rows():
    assert admin_panel.ADMIN_INVENTORY_BUILDER_VERSION >= 3
