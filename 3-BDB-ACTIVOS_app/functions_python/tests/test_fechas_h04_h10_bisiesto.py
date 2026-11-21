# -*- coding: utf-8 -*-
"""Auditoria 14-10-2026: H04 (created_at del cliente), H10 (fecha del inventario del
panel) y BAJA (29-feb en el horizonte)."""
import math
import os
import sys
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import admin_panel  # noqa: E402
import portfolio_horizon as h  # noqa: E402
from optimization.repository import _clear_price_series_cache  # noqa: E402
from portfolios import repository as P  # noqa: E402
from tests.test_admin_read_budget import _BudgetDb  # noqa: E402

NOW = "2026-10-14T08:00:00+00:00"


# --------------------------------------------------------------------------- H04

@pytest.mark.parametrize("created_at", [
    "2026-01-02T10:00:00+00:00",
    "2026-01-02T10:00:00.123Z",
    "2026-01-02",
])
def test_created_at_iso_8601_is_kept(created_at):
    doc = P.sanitize_portfolio({"created_at": created_at, "positions": []}, "u1", now=NOW)
    assert doc["created_at"] == created_at


@pytest.mark.parametrize("created_at", [
    "ayer por la tarde",
    "<script>alert(1)</script>",
    "2026-13-45",
    "2026-01-02T10:00:00+00:00" + "x" * 30,
    12345,
    {"seconds": 1},
    "",
    None,
])
def test_created_at_that_is_not_iso_8601_falls_back_to_server_time(created_at):
    doc = P.sanitize_portfolio({"created_at": created_at, "positions": []}, "u1", now=NOW)
    assert doc["created_at"] == NOW


class _Store:
    def __init__(self, docs=None):
        self.docs = dict(docs or {})

    def save(self, uid, pid, doc):
        self.docs[pid] = doc

    def get(self, uid, pid):
        return self.docs.get(pid)

    def count(self, uid):
        return len(self.docs)


def test_update_keeps_the_stored_created_at_even_if_it_is_not_iso():
    """Revision 14-10: al actualizar se conserva el created_at guardado (aunque sea
    legado y no ISO); solo se valida el que llega con una cartera nueva."""
    store = _Store({"p1": {"portfolio_id": "p1", "created_at": "01/02/2025 legado"}})
    out = P.save_portfolio(store, "u1", {"portfolio_id": "p1", "created_at": "2026-01-02T10:00:00Z",
                                         "positions": []}, now=NOW)
    assert out["portfolio"]["created_at"] == "01/02/2025 legado"
    out = P.save_portfolio(store, "u1", {"portfolio_id": "p1", "positions": []}, now=NOW)
    assert out["portfolio"]["created_at"] == "01/02/2025 legado"
    nueva = P.save_portfolio(store, "u1", {"portfolio_id": "p2", "created_at": "basura",
                                           "positions": []}, now=NOW)
    assert nueva["portfolio"]["created_at"] == NOW
    nueva_iso = P.save_portfolio(store, "u1", {"portfolio_id": "p3", "created_at": "2026-01-02",
                                               "positions": []}, now=NOW)
    assert nueva_iso["portfolio"]["created_at"] == "2026-01-02"


# --------------------------------------------------------------------------- H10

def test_db_status_returns_the_stored_inventory_date(monkeypatch):
    rows = [{
        "asset_id": "A0001", "name": "Asset", "type": "FUND", "last_date": "2025-12-31",
        "points": 250, "has_vol": True, "has_sharpe": True, "has_srri": True,
        "has_mdd": True, "has_mdd_hist": True, "first_date": "2011-01-03", "flags": [],
    }]
    db = _BudgetDb(inventory={
        "schema_version": "admin-asset-inventory.v1",
        "generated_at": "2026-10-07T10:30:00+00:00",
        "count": 1,
        "rows": rows,
    })
    monkeypatch.setattr(admin_panel, "_db", lambda: db)
    status = admin_panel.db_status()
    assert status["inventory_generated_at"] == "2026-10-07T10:30:00+00:00"
    assert status["inventory_source"] == "STORED"
    assert status["generated_at"] != status["inventory_generated_at"], "la consulta tiene su propia hora"
    assert status["total_assets"] == 1


def test_db_status_without_stored_inventory_says_it_is_live(monkeypatch):
    db = _BudgetDb()
    monkeypatch.setattr(admin_panel, "_db", lambda: db)
    status = admin_panel.db_status()
    assert status["inventory_source"] == "LIVE"
    assert isinstance(status["inventory_generated_at"], str) and status["inventory_generated_at"]


# --------------------------------------------------------------------------- BAJA 29-feb

def test_years_before_handles_leap_day():
    assert h._years_before(date(2036, 2, 29), 3) == date(2033, 2, 28)
    assert h._years_before(date(2036, 2, 29), 4) == date(2032, 2, 29)
    assert h._years_before(date(2026, 9, 4), 5) == date(2021, 9, 4)


class _LeapReader:
    """Series hasta el viernes 29-02-2036: la ultima semana cerrada cae en 29-feb."""

    def __init__(self):
        assert date(2036, 2, 29).weekday() == 4
        self.points = {}
        for aid, drift in (("LEAP_A", 0.0002), ("LEAP_B", 0.0001)):
            d, values, i = date(2031, 1, 1), {}, 0
            while d <= date(2036, 2, 29):
                if d.weekday() < 5:
                    values[d.isoformat()] = 100 * math.exp(i * drift + .02 * math.sin(i / (7 if aid == "LEAP_A" else 11)))
                    i += 1
                d += timedelta(days=1)
            self.points[aid] = values

    def get_asset(self, aid):
        return {"asset_id": aid, "asset_type": "ETF", "quality": {"status": "OK"}}

    def get_price_series(self, aid):
        return [{"schema_version": "asset-price-series.v1.2", "currency": "EUR", "interval": "1d",
                 "points": [{"date": d, "value": v} for d, v in self.points[aid].items()]}]


def test_horizon_does_not_crash_when_the_last_week_closes_on_leap_day():
    _clear_price_series_cache()
    try:
        result = h.analyze_horizon(_LeapReader(), {
            "window": "3Y",
            "positions": [{"asset_id": "LEAP_A", "weight": 0.6}, {"asset_id": "LEAP_B", "weight": 0.4}],
        }, today=date(2036, 3, 2), reference_bundle={"version": "test", "assets": {}})
    finally:
        _clear_price_series_cache()
    coverage = result["backtest"]["coverage"]
    assert coverage["last_date"] == "2036-02-29"
    assert coverage["first_date"] <= "2033-02-28"
