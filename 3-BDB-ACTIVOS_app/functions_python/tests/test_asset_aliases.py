"""Alias de identificadores sustituidos (fusiones) resueltos al sucesor — 01-10-2026."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from asset_aliases import alias_for, canonical_asset_id
from readmodel import repository as R
from tests.test_repository import FakeReader
from tests.test_mappers import FUND


def test_hamco_fi_resolves_to_the_sicav_successor():
    assert canonical_asset_id("ES0141116030") == "LU3038481936"
    assert canonical_asset_id(" es0141116030 ") == "LU3038481936"
    assert alias_for("ES0141116030")["effective"] == "2025-11-25"
    assert canonical_asset_id("LU3038481936") == "LU3038481936", "un id canonico no cambia"
    assert canonical_asset_id("") == ""
    assert canonical_asset_id(None) == ""


def test_alias_chain_stops_on_loops():
    import asset_aliases
    original = asset_aliases.aliases
    try:
        asset_aliases.aliases = lambda: {"A": {"successor": "B"}, "B": {"successor": "A"}}
        assert canonical_asset_id("A") in {"A", "B"}
    finally:
        asset_aliases.aliases = original


def _with_alias(monkeypatch, old, new):
    import asset_aliases
    monkeypatch.setattr(asset_aliases, "aliases", lambda: {old: {"successor": new}})


def test_get_asset_detail_returns_the_successor_and_names_the_request(monkeypatch):
    _with_alias(monkeypatch, "OLD-FUND", FUND["asset_id"])
    detail = R.get_asset_detail(FakeReader(), "OLD-FUND", with_holdings=False)
    assert detail["asset_id"] == FUND["asset_id"]
    assert detail["resolved_from"] == "OLD-FUND"
    direct = R.get_asset_detail(FakeReader(), FUND["asset_id"], with_holdings=False)
    assert "resolved_from" not in direct
    assert R.get_asset_detail(FakeReader(), "NOPE", with_holdings=False) is None


def test_resolve_portfolio_keeps_the_requested_id_and_warns(monkeypatch):
    _with_alias(monkeypatch, "OLD-FUND", FUND["asset_id"])
    out = R.resolve_portfolio(FakeReader(), [{"asset_id": "OLD-FUND", "weight": 60}, {"asset_id": "NOPE", "weight": 40}])
    rows = out["rows"] if isinstance(out, dict) else out
    assert len(rows) == 1
    assert rows[0]["asset_id"] == FUND["asset_id"]
    assert rows[0]["requested_asset_id"] == "OLD-FUND"
    assert rows[0]["weight"] == 60
    codes = {(w["code"], w["asset_id"]) for w in (out["warnings"] if isinstance(out, dict) else [])}
    assert ("ALIAS_RESOLVED", "OLD-FUND") in codes
    assert ("MISSING_ASSET", "NOPE") in codes


# ---------------------------------------------------------------------------
# 14-10-2026 (CRIT-02): el resto de entradas resuelve el alias igual que el read model.
# ---------------------------------------------------------------------------

def test_holdings_batch_resolves_the_alias_and_answers_under_the_requested_id(monkeypatch):
    _with_alias(monkeypatch, "OLD-FUND", FUND["asset_id"])

    class BatchReader(FakeReader):
        def __init__(self):
            super().__init__()
            self.asked_roots = []
            self.asked_holdings = []

        def get_assets_many(self, asset_ids):
            self.asked_roots.append(list(asset_ids))
            return {a: self.roots[a] for a in asset_ids if a in self.roots}

        def get_holdings_many(self, asset_ids):
            self.asked_holdings.append(list(asset_ids))
            return {a: self.holdings[a] for a in asset_ids if a in self.holdings}

    reader = BatchReader()
    out = R.get_asset_holdings_many(reader, ["OLD-FUND", FUND["asset_id"], "NOPE"])
    assert set(out) == {"OLD-FUND", FUND["asset_id"], "NOPE"}, "la clave es el id pedido"
    assert out["OLD-FUND"]["asset_id"] == FUND["asset_id"], "el documento lleva el id vigente"
    assert out["OLD-FUND"]["resolved_from"] == "OLD-FUND", "y declara el alias, como la ficha"
    assert "resolved_from" not in out[FUND["asset_id"]]
    assert {k: v for k, v in out["OLD-FUND"].items() if k != "resolved_from"} == out[FUND["asset_id"]]
    assert out["NOPE"] is None
    assert reader.asked_roots == [[FUND["asset_id"], "NOPE"]], "el alias no se lee: se pide el sucesor una vez"
    assert reader.asked_holdings == [[FUND["asset_id"]]]

    single_reads = R.get_asset_holdings_many(FakeReader(), ["OLD-FUND"])
    assert single_reads["OLD-FUND"]["asset_id"] == FUND["asset_id"], "tambien sin lector batch"
    assert single_reads["OLD-FUND"]["resolved_from"] == "OLD-FUND"


def test_single_holdings_declare_the_alias_like_the_asset_detail(monkeypatch):
    """Ronda 2: get_asset_holdings no emitia ninguna senal de alias y el adaptador del
    frontend rechazaba la respuesta por traer otro asset_id."""
    _with_alias(monkeypatch, "OLD-FUND", FUND["asset_id"])
    out = R.get_asset_holdings(FakeReader(), "OLD-FUND")
    assert out["asset_id"] == FUND["asset_id"]
    assert out["resolved_from"] == "OLD-FUND"
    direct = R.get_asset_holdings(FakeReader(), FUND["asset_id"])
    assert "resolved_from" not in direct


# ---------------------------------------------------------------------------
# Motores (revision del 14-10-2026): calculan con el sucesor y responden bajo el id
# que pidio el cliente; nombrar el mismo activo con alias y sucesor es un error claro.
# ---------------------------------------------------------------------------

OLD = "OLD0000000A1"
NEW = "NEW0000000A1"
OTHER = "OTHER000002"


def _opt_request(**extra):
    request = {
        "schema_version": "portfolio-optimization-request.v1",
        "window": "1Y", "base_currency": "EUR", "objective": "MAX_SHARPE",
    }
    request.update(extra)
    return request


def test_optimization_request_resolves_aliases_and_rejects_alias_plus_successor(monkeypatch):
    import pytest
    from optimization.repository import InvalidOptimizationRequest, validate_request
    _with_alias(monkeypatch, OLD, NEW)
    req = validate_request(_opt_request(
        asset_ids=[OLD, "B"],
        current_weights={OLD: 0.5, "B": 0.5},
        locked_weights={OLD: 0.5},
    ))
    assert req.asset_ids == [NEW, "B"]
    assert req.current_weights == {NEW: 0.5, "B": 0.5}
    assert req.locked_weights == {NEW: 0.5}
    assert req.alias_resolutions == {OLD: NEW}

    # [alias, sucesor] no puede fallar tarde con OptimizationError: error claro aqui.
    with pytest.raises(InvalidOptimizationRequest, match="son el mismo activo") as err:
        validate_request(_opt_request(asset_ids=[OLD, NEW]))
    assert "Deja solo %s" % NEW in str(err.value)
    # Pesos fijados con el alias y el sucesor: tampoco un 400 de cotas poco claro.
    with pytest.raises(InvalidOptimizationRequest, match="son el mismo activo"):
        validate_request(_opt_request(asset_ids=[OLD, "B"], locked_weights={OLD: 0.4, NEW: 0.4}))
    # En current_weights el usuario no elige los ids: no se rechaza, se fusiona.
    mixed = validate_request(_opt_request(asset_ids=[OLD, "B"], current_weights={NEW: 0.5, "B": 0.5}))
    assert mixed.current_weights == {NEW: 0.5, "B": 0.5}
    assert mixed.alias_resolutions == {OLD: NEW}

    plain = validate_request(_opt_request(asset_ids=["A", "B"]))
    assert plain.alias_resolutions is None
    assert plain.weight_alias_merges is None


def test_alias_only_in_current_weights_is_merged_into_the_successor_and_reported(monkeypatch):
    """Segunda revision 14-10: si el alias solo aparece en current_weights, el usuario no
    puede resolver un rechazo; su peso se suma al sucesor y se avisa en alias_resolutions,
    sin renombrar las filas (el activo se pidio con el id vigente)."""
    from optimization.repository import _clear_price_series_cache, optimize_portfolio, validate_request
    _with_alias(monkeypatch, OLD, NEW)
    req = validate_request(_opt_request(
        asset_ids=[NEW, OTHER], current_weights={OLD: 0.3, NEW: 0.2, OTHER: 0.5},
    ))
    assert req.current_weights == {NEW: 0.5, OTHER: 0.5}
    assert req.alias_resolutions is None
    assert req.weight_alias_merges == {OLD: NEW}

    _clear_price_series_cache()
    try:
        result = optimize_portfolio(_SeriesReader({NEW, OTHER}), _opt_request(
            asset_ids=[NEW, OTHER], current_weights={OLD: 0.3, NEW: 0.2, OTHER: 0.5},
        ))
    finally:
        _clear_price_series_cache()
    assert set(result["current_portfolio"]["weights"]) == {NEW, OTHER}, "las filas no se renombran"
    assert result["current_portfolio"]["weights"][NEW] > 0
    assert result["alias_resolutions"] == {OLD: NEW}


class _SeriesReader:
    def __init__(self, ids):
        self.ids = set(ids)
        self.asked = []

    def get_asset(self, asset_id):
        self.asked.append(asset_id)
        if asset_id not in self.ids:
            return None
        return {"asset_id": asset_id, "asset_type": "ETF", "currency": "EUR",
                "identity": {"name": asset_id, "currency": "EUR"}}

    def get_price_series(self, asset_id):
        import math
        from datetime import date, timedelta
        start = date(2023, 1, 2)
        points = []
        for week, i in enumerate(range(0, 3 * 365, 7)):
            wobble = math.sin(week / (3.0 if asset_id.endswith("1") else 5.0))
            points.append({"date": (start + timedelta(days=i)).isoformat(),
                           "value": 100.0 + i * (0.01 if asset_id.endswith("1") else 0.02) + wobble})
        return [{"schema_version": "asset-price-series.v1.1", "currency": "EUR", "points": points}]


def test_rebased_series_and_backtest_answer_under_the_requested_id(monkeypatch):
    import pytest
    from optimization.repository import (
        InvalidOptimizationRequest, _clear_price_series_cache, backtest_portfolio, build_rebased_series,
    )
    _with_alias(monkeypatch, OLD, NEW)
    _clear_price_series_cache()
    try:
        reader = _SeriesReader({NEW, OTHER})
        series = build_rebased_series(reader, {"asset_ids": [OLD, OTHER], "window": "1Y"})
        assert OLD not in reader.asked, "se lee el sucesor"
        assert [s["asset_id"] for s in series["series"]] == [OLD, OTHER], "bajo el id pedido"
        assert series["alias_resolutions"] == {OLD: NEW}

        bt = backtest_portfolio(reader, {
            "positions": [{"asset_id": OLD, "weight": 0.5}, {"asset_id": OTHER, "weight": 0.5}],
            "period": "1Y",
        })
        assert bt["asset_ids"] == [OLD, OTHER]
        assert set(bt["weights_normalized"]) == {OLD, OTHER}
        assert NEW not in str({k: v for k, v in bt.items() if k != "alias_resolutions"})
        assert bt["alias_resolutions"] == {OLD: NEW}

        with pytest.raises(InvalidOptimizationRequest, match="son el mismo activo"):
            backtest_portfolio(reader, {"positions": [{"asset_id": OLD, "weight": 0.5},
                                                      {"asset_id": NEW, "weight": 0.5}]})

        plain = build_rebased_series(reader, {"asset_ids": [NEW], "window": "1Y"})
        assert "alias_resolutions" not in plain, "sin alias, el contrato no cambia"
    finally:
        _clear_price_series_cache()


def test_optimize_portfolio_answers_under_the_requested_id(monkeypatch):
    from optimization.repository import _clear_price_series_cache, optimize_portfolio
    _with_alias(monkeypatch, OLD, NEW)
    _clear_price_series_cache()
    try:
        reader = _SeriesReader({NEW, OTHER})
        result = optimize_portfolio(reader, _opt_request(
            asset_ids=[OLD, OTHER], current_weights={OLD: 0.5, OTHER: 0.5},
        ))
    finally:
        _clear_price_series_cache()
    assert OLD not in reader.asked
    assert set(result["max_sharpe_portfolio"]["weights"]) == {OLD, OTHER}
    assert set(result["current_portfolio"]["weights"]) == {OLD, OTHER}
    assert {row["asset_id"] for row in result["risk_contributions"]} == {OLD, OTHER}
    for point in result["frontier"]:
        assert set(point["weights"]) == {OLD, OTHER}
    assert result["alias_resolutions"] == {OLD: NEW}


def test_improvement_and_horizon_parse_aliases_to_the_successor(monkeypatch):
    from optimization.improvement_service import _parse_candidates, _parse_positions, improve_portfolio
    import portfolio_horizon
    import pytest
    from optimization.repository import InvalidOptimizationRequest, OptimizationError

    _with_alias(monkeypatch, OLD, NEW)
    aliases = {}
    positions = _parse_positions([{"asset_id": OLD, "weight": 0.4},
                                  {"asset_id": "B", "weight": 0.6}], aliases)
    assert positions == {NEW: 0.4, "B": 0.6}
    candidates = _parse_candidates({OLD: ["C"], "B": ["D"]}, positions, aliases)
    assert candidates == {NEW: ["C"], "B": ["D"]}
    assert aliases == {OLD: NEW}

    with pytest.raises(InvalidOptimizationRequest, match="son el mismo activo"):
        improve_portfolio(_SeriesReader(set()), {
            "positions": [{"asset_id": OLD, "weight": 0.5}, {"asset_id": "B", "weight": 0.5}],
            "candidates": {"B": [NEW]},
        })

    reader = _SeriesReader(set())
    with pytest.raises(OptimizationError):
        portfolio_horizon.analyze_horizon(reader, {
            "window": "3Y", "positions": [{"asset_id": OLD, "weight": 1.0}],
        })
    assert reader.asked == [NEW], "el horizonte lee el sucesor, no el alias"
    with pytest.raises(InvalidOptimizationRequest, match="son el mismo activo"):
        portfolio_horizon.analyze_horizon(reader, {
            "window": "3Y", "positions": [{"asset_id": OLD, "weight": 0.5}, {"asset_id": NEW, "weight": 0.5}],
        })


def test_restoring_requested_ids_only_touches_exact_ids():
    from asset_aliases import with_alias_resolutions
    result = {"weights": {NEW: 0.5, "B": 0.5}, "rows": [{"asset_id": NEW, "name": "Fondo %s" % NEW}],
              "ids": [NEW, "B"], "value": 1.5}
    restored = with_alias_resolutions(result, {OLD: NEW})
    assert restored["weights"] == {OLD: 0.5, "B": 0.5}
    assert restored["rows"] == [{"asset_id": OLD, "name": "Fondo %s" % NEW}]
    assert restored["ids"] == [OLD, "B"]
    assert restored["value"] == 1.5
    assert restored["alias_resolutions"] == {OLD: NEW}
    assert with_alias_resolutions(result, {}) is result
