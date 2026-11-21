import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import admin_panel  # noqa: E402
import main  # noqa: E402
import price_refresh  # noqa: E402


class FakeAssetSnap:
    def __init__(self, asset_id: str, data: dict | None = None):
        self.id = asset_id
        self._data = data

    def to_dict(self):
        return self._data if self._data is not None else {"asset_id": self.id}


class FakeMetaSnap:
    exists = True

    def to_dict(self):
        return {"last_run_date": "2024-03-02"}


class FakeMetaDoc:
    def get(self):
        return FakeMetaSnap()


class FakeCollection:
    def __init__(self, name: str):
        self.name = name

    def stream(self):
        if self.name == "assets":
            return [FakeAssetSnap("a"), FakeAssetSnap("b"), FakeAssetSnap("c"), FakeAssetSnap("d")]
        return []

    def document(self, doc_id: str):
        if self.name == "meta" and doc_id == "price_refresh":
            return FakeMetaDoc()
        raise AssertionError(f"document inesperado: {self.name}/{doc_id}")


class FakeDb:
    def collection(self, name: str):
        return FakeCollection(name)


class FakeLatestSnap:
    def __init__(self, data):
        self._data = data

    def to_dict(self):
        return self._data


class FakeLatestQuery:
    def __init__(self, data):
        self._data = data

    def order_by(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def stream(self):
        return [FakeLatestSnap(self._data)] if self._data is not None else []


class FakePriceAssetRef:
    def __init__(self, latest):
        self._latest = latest

    def collection(self, name: str):
        if name != "price_series":
            raise AssertionError(f"collection inesperada: {name}")
        return FakeLatestQuery(self._latest)


class FakePriceAssetsCollection:
    def __init__(self, latest_by_asset, extra_snaps=None):
        self._latest_by_asset = latest_by_asset
        self._extra_snaps = extra_snaps or []
        self._limit = None
        self._offset = 0
        self._start_after = None

    def order_by(self, *_args, **_kwargs):
        return self

    def select(self, *_args, **_kwargs):
        return self

    def limit(self, value):
        self._limit = value
        return self

    def offset(self, value):
        self._offset = value
        return self

    def start_after(self, cursor):
        self._start_after = next(iter(cursor.values()))
        return self

    def stream(self):
        snaps = [FakeAssetSnap(asset_id) for asset_id in self._latest_by_asset.keys()]
        snaps += list(self._extra_snaps)
        snaps.sort(key=lambda snap: snap.id)
        if self._start_after:
            snaps = [snap for snap in snaps if snap.id > self._start_after]
        snaps = snaps[self._offset:]
        return snaps[:self._limit] if self._limit is not None else snaps

    def document(self, asset_id: str):
        # Solo los canonicos activos deben llegar aqui; un KeyError delataria un filtro roto.
        return FakePriceAssetRef(self._latest_by_asset[asset_id])


class FakePriceDb:
    def __init__(self, latest_by_asset, extra_snaps=None):
        self._latest_by_asset = latest_by_asset
        self._extra_snaps = extra_snaps or []

    def collection(self, name: str):
        if name != "assets":
            raise AssertionError(f"collection inesperada: {name}")
        return FakePriceAssetsCollection(self._latest_by_asset, self._extra_snaps)


def test_db_status_exposes_real_data_dates(monkeypatch):
    rows = {
        "a": _row("a", "Alpha Fund", "FUND", "2024-01-05"),
        "b": _row("b", "Beta ETF", "ETF", "2024-03-01"),
        "c": _row("c", "Cartera Fund", "FUND", "2023-12-30"),
        "d": _row("d", "Delta Stock", "STOCK", None, points=0, flags=["SIN_HISTORICO"]),
    }

    monkeypatch.setattr(admin_panel, "_db", lambda: FakeDb())
    monkeypatch.setattr(admin_panel, "_series_meta_index", lambda _db, hit=None: {})
    monkeypatch.setattr(admin_panel, "_metrics_latest_index", lambda _db, hit=None: {})
    monkeypatch.setattr(
        admin_panel, "_row",
        lambda _db, aid, _d, _today, _meta=None, metrics_latest=None: rows[aid],
    )

    status = admin_panel.db_status()

    assert status["latest_data_date"] == "2024-03-01"
    assert status["latest_by_type"] == {"ETF": "2024-03-01", "FUND": "2024-01-05"}
    assert status["most_lagged"][:2] == [
        {"asset_id": "c", "name": "Cartera Fund", "type": "FUND", "last_date": "2023-12-30"},
        {"asset_id": "a", "name": "Alpha Fund", "type": "FUND", "last_date": "2024-01-05"},
    ]
    assert status["last_refresh_date"] == "2024-03-02"


def test_admin_metrics_present_accepts_fund_period_risk_maps(monkeypatch):
    monkeypatch.setattr(
        admin_panel,
        "_series_meta",
        lambda _ref: ("2011-01-01", "2024-03-01", 1, 120, "FUND.EU", "EUR"),
    )

    class FakeAssets:
        def document(self, _asset_id):
            return object()

    class FakeDbForRow:
        def collection(self, name: str):
            if name != "assets":
                raise AssertionError(f"collection inesperada: {name}")
            return FakeAssets()

    row = admin_panel._row(
        FakeDbForRow(),
        "LU0000000001",
        {
            "instrument_type": "FUND",
            "display_name": "Fondo con metricas por periodo",
            "risk": {
                "volatilidad_pct": {"3a": {"fondo": 12.3}},
                "sharpe": {"3a": {"fondo": 0.82}},
            },
        },
        admin_panel.datetime.date(2024, 3, 10),
    )

    assert row["has_vol"] is True
    assert row["has_sharpe"] is True


def test_admin_metrics_present_keeps_scalar_stock_risk(monkeypatch):
    monkeypatch.setattr(
        admin_panel,
        "_series_meta",
        lambda _ref: ("2011-01-01", "2024-03-01", 1, 120, "STOCK.US", "USD"),
    )

    class FakeAssets:
        def document(self, _asset_id):
            return object()

    class FakeDbForRow:
        def collection(self, name: str):
            if name != "assets":
                raise AssertionError(f"collection inesperada: {name}")
            return FakeAssets()

    row = admin_panel._row(
        FakeDbForRow(),
        "US0000000001",
        {
            "instrument_type": "STOCK",
            "display_name": "Stock con volatilidad escalar",
            "risk": {
                "volatility_3y": 18.5,
                "sharpe": 0.64,
            },
        },
        admin_panel.datetime.date(2024, 3, 10),
    )

    assert row["has_vol"] is True
    assert row["has_sharpe"] is True


def test_refresh_all_stale_preview_does_not_call_eodhd(monkeypatch):
    # Ids con forma de ISIN: refresh_stale_prices solo procesa activos canonicos activos
    # (_is_active_canonical_asset descarta ids no-ISIN y ARCHIVED_LEGACY).
    latest_by_asset = {
        "ES0000000001": {  # stale -> candidato
            "last_date": "2024-03-01",
            "source_listing_id": "EODHD:STALE.US",
            "asset_type": "ETF",
        },
        "ES0000000012": {  # fresco -> skip
            "last_date": "2024-03-10",
            "source_listing_id": "EODHD:FRESH.US",
            "asset_type": "ETF",
        },
        "ES0000000023": {  # sin last_date -> skip
            "source_listing_id": "EODHD:MISSING.US",
            "asset_type": "ETF",
        },
        "ES0000000034": None,  # sin serie -> skip
    }
    excluded = [
        FakeAssetSnap("SYNTHETIC_MIX_1"),  # id no-ISIN: fuera antes de tocar price_series
        FakeAssetSnap("LU0000000045", {"quality": {"status": "ARCHIVED_LEGACY"}}),  # legacy archivado
    ]

    def fail_fetch(*_args, **_kwargs):
        raise AssertionError("El preview no debe llamar a EODHD")

    monkeypatch.setattr(price_refresh, "_master_db", lambda: FakePriceDb(latest_by_asset, excluded))
    monkeypatch.setattr(price_refresh, "_today", lambda: "2024-03-10")
    monkeypatch.setattr(price_refresh, "fetch_eod", fail_fetch)

    result = price_refresh.refresh_stale_prices(write=False)

    assert result["processed"] == 4  # los 2 excluidos no cuentan
    assert result["would_update"] == 1
    assert result["updated"] == 0
    assert result["applied"] is False
    assert result["skipped"] == 3
    assert result["sample"] == [
        {"asset_id": "ES0000000001", "last_date": "2024-03-01", "new_last": None}
    ]
    assert result["ran_date"] == "2024-03-10"


def test_refresh_reports_sources_without_an_updater_instead_of_silent_skips(monkeypatch):
    latest = {f"LU00000000{i:02d}": {"last_date": "2026-09-28", "asset_type": "FUND",
               "source_listing_id": f"CAPITALGROUP:LU00000000{i:02d}"} for i in range(1, 13)}
    monkeypatch.setattr(price_refresh, "_master_db", lambda: FakePriceDb(latest))
    monkeypatch.setattr(price_refresh, "_today", lambda: "2026-10-18")
    monkeypatch.setattr(price_refresh, "fetch_eod", lambda *_a, **_kw: (_ for _ in ()).throw(AssertionError("No provider call")))
    result = price_refresh.refresh_stale_prices(write=False)
    assert result["unsupported_source"] == 12
    assert len(result["unsupported_source_sample"]) == 10
    assert result["unsupported_source_sample"][0]["source_price_id"].startswith("CAPITALGROUP:")
    assert result["skipped"] == 12
    assert result["would_update"] == result["write_count"] == result["errors"] == 0


def test_refresh_preview_uses_cursor_without_rereading_previous_page(monkeypatch):
    latest = {
        f"ES00000000{i:02d}": {"last_date": "2024-03-10", "source_listing_id": f"EODHD:A{i}.US"}
        for i in range(1, 7)
    }
    monkeypatch.setattr(price_refresh, "_master_db", lambda: FakePriceDb(latest))
    monkeypatch.setattr(price_refresh, "_today", lambda: "2024-03-10")

    first = price_refresh.refresh_stale_prices(write=False, limit=2)
    second = price_refresh.refresh_stale_prices(
        write=False, limit=2, start_after_asset_id=first["next_cursor"])

    assert first["processed"] == 2
    assert first["cycle_completed"] is False
    assert second["processed"] == 2
    assert second["next_cursor"] != first["next_cursor"]
    # Cada pagina: limit+1 roots para detectar continuidad + 2 latest.
    assert first["read_budget_used"] == 5
    assert second["read_budget_used"] == 5


def test_read_budget_never_reports_more_than_configured():
    budget = price_refresh.ReadBudget(2)
    budget.add(2, "ok")
    try:
        budget.add(1, "blocked")
    except price_refresh.ReadBudgetExceeded:
        pass
    else:
        raise AssertionError("el presupuesto debio bloquear la lectura")
    assert budget.reads == 2


def test_admin_refresh_all_stale_write_blocks_when_gate_is_off(monkeypatch):
    def block(operation, actor_uid=None):
        raise main.MasterWritesDisabledError(operation=operation, actor_uid=actor_uid)

    monkeypatch.setattr(main, "require_master_writes_enabled", block)

    try:
        main._run_admin_refresh_all_stale("uid-1", {"write": True})
    except main.MasterWritesDisabledError as exc:
        assert exc.operation == "admin_refresh_all_stale"
        assert exc.actor_uid == "uid-1"
    else:
        raise AssertionError("write=True debe bloquear si master writes esta off")


def test_admin_refresh_all_stale_write_uses_existing_refresh_when_gate_is_on(monkeypatch):
    calls = {}

    def allow(operation, actor_uid=None):
        calls["gate"] = {"operation": operation, "actor_uid": actor_uid}

    def fake_refresh_stale_prices(limit=0, offset=0, sleep=0.0, write=False,
                                  max_reads=None, scheduler_price_gate=False,
                                  start_after_asset_id=None, resume_from_watermark=False):
        calls["refresh"] = {
            "limit": limit,
            "offset": offset,
            "sleep": sleep,
            "write": write,
            "max_reads": max_reads,
            "scheduler_price_gate": scheduler_price_gate,
            "start_after_asset_id": start_after_asset_id,
            "resume_from_watermark": resume_from_watermark,
        }
        return {
            "processed": 3,
            "updated": 2,
            "would_update": 0,
            "applied": write,
            "skipped": 1,
            "errors": 0,
            "sample": [{"asset_id": "a", "last_date": "2024-01-05", "new_last": "2024-03-01"}],
            "ran_date": "2024-03-01",
        }

    monkeypatch.setattr(main, "require_master_writes_enabled", allow)
    monkeypatch.setattr(price_refresh, "refresh_stale_prices", fake_refresh_stale_prices)

    result = main._run_admin_refresh_all_stale("uid-2", {"write": True, "limit": 7, "offset": 4})

    assert calls["gate"] == {"operation": "admin_refresh_all_stale", "actor_uid": "uid-2"}
    assert calls["refresh"] == {
        "limit": 7,
        "offset": 4,
        "sleep": 0.0,
        "write": True,
        # S4: presupuesto 3600 ≈ ciclo completo (~1150 activos × 3 lecturas).
        "max_reads": 3600,
        "scheduler_price_gate": False,
        "start_after_asset_id": None,
        "resume_from_watermark": False,
    }
    assert result["updated"] == 2
    assert result["applied"] is True


def _row(asset_id, name, asset_type, last_date, points=100, flags=None):
    return {
        "asset_id": asset_id,
        "name": name,
        "type": asset_type,
        "symbol": None,
        "currency": "EUR",
        "first_date": "2011-01-01" if last_date else None,
        "last_date": last_date,
        "points": points,
        "year_docs": 1,
        "years": 13 if last_date else None,
        "has_vol": True,
        "has_sharpe": True,
        "has_srri": False,
        "has_mdd": True,
        "has_mdd_hist": True,
        "flags": flags or [],
    }
