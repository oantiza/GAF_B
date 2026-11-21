# -*- coding: utf-8 -*-
"""Ronda 2 (14-10-2026): scripts/improve_fund_data.py valida cada cartera contra el
contrato que declara (v1.1 o v1.2), no conserva una `provenance` que ya no describe
el contenido y fusiona fund_profile/latest en vez de sobrescribirlo."""
import importlib.util
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from contract_validation import ContractValidationError, validate_contract  # noqa: E402

_PATH = Path(__file__).resolve().parents[1] / "scripts" / "improve_fund_data.py"
_spec = importlib.util.spec_from_file_location("improve_fund_data", _PATH)
improve = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(improve)

PROVENANCE = {"source": "morningstar_lt", "coverage": "COMPLETE", "endpoint": "sal_position",
              "retrieved_at": "2026-10-10T08:00:00Z", "as_of_date_basis": "holdings_detail"}


def _single(**extra):
    doc = {"storage_mode": "SINGLE_DOCUMENT", "holdings_count": 1, "top10_weight": 5.0,
           "as_of_date": "2026-09-30", "holdings": [{"holding_name": "A", "holding_weight": 5.0}],
           "updated_at": "2026-10-14T08:00:00Z"}
    doc.update(extra)
    return doc


def test_a_v12_portfolio_with_provenance_validates_against_its_declared_contract():
    doc = _single(schema_version="master.holdings.v1.2", provenance=PROVENANCE)
    with pytest.raises(ContractValidationError):
        validate_contract(doc, "holdings.v1.1.schema.json")  # lo que hacia el script
    assert improve.holdings_schema_for(doc) == "holdings.v1.2.schema.json"
    validate_contract(doc, improve.holdings_schema_for(doc))


def test_schema_choice_follows_the_declaration():
    assert improve.holdings_schema_for(_single(schema_version="master.holdings.v1.1")) == "holdings.v1.1.schema.json"
    assert improve.holdings_schema_for(_single()) == "holdings.v1.1.schema.json"
    assert improve.holdings_schema_for(_single(provenance=PROVENANCE)) == "holdings.v1.2.schema.json"
    manifest = {"storage_mode": "CHUNKED", "chunk_count": 2, "holdings_count": 300, "top10_weight": 40.0,
                "as_of_date": "2026-09-30", "schema_version": "master.holdings.v1.2", "provenance": PROVENANCE}
    validate_contract(manifest, improve.holdings_schema_for(manifest))


def test_rewritten_portfolio_drops_the_stale_provenance():
    doc = _single(schema_version="master.holdings.v1.2", provenance=PROVENANCE)
    replaced = improve.without_stale_provenance(doc, content_replaced=True)
    assert "provenance" not in replaced
    assert "provenance" in doc, "no muta el original"
    validate_contract(replaced, improve.holdings_schema_for(replaced))
    normalized = improve.without_stale_provenance(doc, content_replaced=False)
    assert normalized["provenance"] == PROVENANCE, "mismas posiciones normalizadas: se conserva"


def test_fund_profile_merge_keeps_other_owners_blocks():
    existing = {
        "schema_version": "fund-profile.v1", "asset_id": "LU0000000001",
        "identity": {"gestora": "Vieja"}, "imported_at": "2026-09-01",
        "documentation_audit": {"status": "OK"},
        "holdings_review": {"review_flags": ["TOP10_ONLY"]},
        "risk_reconciliation": {"srri": 5},
    }
    built = {"schema_version": "fund-profile.v1", "asset_id": "LU0000000001",
             "identity": {"gestora": "Nueva"}, "imported_at": "2026-10-14"}
    merged = improve.merge_fund_profile(existing, built)
    assert merged["identity"] == {"gestora": "Nueva"}
    assert merged["imported_at"] == "2026-10-14"
    assert merged["documentation_audit"] == {"status": "OK"}
    assert merged["holdings_review"] == {"review_flags": ["TOP10_ONLY"]}
    assert merged["risk_reconciliation"] == {"srri": 5}
    assert improve.merge_fund_profile(None, built) == built


# --- ALTA-05 (auditoria 16-10-2026): el Sharpe con su tasa, o nada -------------------

def _daily_points(years=4, last="2026-10-15"):
    import math
    from datetime import date, timedelta
    end = date.fromisoformat(last)
    day, points, i = end - timedelta(days=int(years * 365.25)), [], 0
    while day <= end:
        if day.weekday() < 5:
            points.append({"date": day.isoformat(), "value": round(100 * math.exp(0.0003 * i + 0.02 * math.sin(i / 9)), 6)})
            i += 1
        day += timedelta(days=1)
    return points


def test_rebuilt_metrics_keep_sharpe_and_rate_with_the_estr_resolver():
    calls = []

    def resolver(start, end):
        calls.append((start, end))
        return {"rate": 0.021, "coverage_ratio": 1.0}

    new, reason, cause = improve.rebuilt_fund_metrics("LU0000000001", _daily_points(), {"risk": {"srri_1a7": 4}},
                                                      "2026-10-16T08:00:00+00:00", risk_free_resolver=resolver)
    assert reason is None and cause is None
    own = {w: n for w, n in new["windows"].items() if n.get("method") == "GEOMETRIC_CAGR"}
    assert {"1y", "3y"} <= set(own)
    for node in own.values():
        assert node["risk_free_rate"] == 0.021
        assert node["sharpe_ratio"] == pytest.approx((node["annualized_return"] - 0.021) / node["annualized_volatility"], abs=1e-7)
    assert calls, "el resolutor se consulta por ventana"
    assert new["source"] == "FONDOSDB_EODHD_DAILY_HISTORY"
    validate_contract(new, "metrics.v1.3.schema.json")


def test_without_a_rate_the_metrics_document_stays_out_of_the_plan():
    def ecb_down(start, end):
        raise RuntimeError("BCE caido")

    new, reason, cause = improve.rebuilt_fund_metrics("LU0000000001", _daily_points(), {},
                                                      "2026-10-16T08:00:00+00:00", risk_free_resolver=ecb_down)
    assert reason == "NO_RATE"
    assert cause == "RuntimeError: BCE caido"  # la causa real, no un «BCE caido» supuesto
    assert any(n.get("sharpe_ratio") is not None and not n.get("risk_free_rate") for n in new["windows"].values())


def test_a_series_ending_before_estr_is_a_structural_no_rate():
    # Tercera pasada (17-10-2026): un fondo cuya serie acaba antes del 01-10-2019 no tiene €STR
    # en ninguna ventana; no es un fallo del BCE y no se arregla repitiendo.
    calls = []

    def resolver(start, end):
        calls.append((start, end))
        return {"rate": 0.02, "coverage_ratio": 1.0}

    new, reason, cause = improve.rebuilt_fund_metrics("LU0000000001", _daily_points(last="2019-06-28"), {},
                                                      "2026-10-16T08:00:00+00:00", risk_free_resolver=resolver)
    assert reason == "NO_ESTR"
    assert "2019-10-01" in cause
    assert calls == []  # ni siquiera se consulta al BCE


def test_a_series_reaching_estr_uses_the_resolver():
    calls = []

    def resolver(start, end):
        calls.append((start, end))
        return {"rate": 0.02, "coverage_ratio": 0.5}

    _new, reason, _cause = improve.rebuilt_fund_metrics("LU0000000001", _daily_points(last="2019-10-01"), {},
                                                        "2026-10-16T08:00:00+00:00", risk_free_resolver=resolver)
    assert reason is None and calls


# Segunda pasada (17-10-2026): un fondo SIN metrics/latest y sin tasa no puede quedarse sin
# metricas (el refresco diario no crea el documento): la preparacion no escribe el plan.

def _prepare_with_backup(tmp_path, monkeypatch, *, with_metrics, last="2026-10-15"):
    import functools
    import gzip
    import pickle
    from types import SimpleNamespace

    aid = "LU0000000001"
    source = tmp_path / "source"
    (source / "export").mkdir(parents=True)
    (source / "export" / "fondos.ndjson").write_text("", encoding="utf-8")
    (source / "export" / "posiciones.ndjson").write_text("", encoding="utf-8")
    output = tmp_path / "out"
    output.mkdir()
    points = _daily_points(last=last)
    typed = {
        "assets/" + aid: {"data": {"asset_id": aid, "asset_type": "FUND",
                                   "identity": {"name": "Fondo", "currency": "EUR"}}, "update_time": 1},
        "assets/%s/price_series/EODHD_2026" % aid: {"data": {"asset_id": aid, "points": points}, "update_time": 1},
        "commercial_retro/LU1088703118": {"data": None, "update_time": None},
        "meta/fund_data_quality": {"data": None, "update_time": None},
    }
    if with_metrics:
        typed["assets/%s/metrics/latest" % aid] = {"data": {"asset_id": aid, "windows": {}}, "update_time": 1}
        # Con metrics/latest vivo solo se recalcula si hay politica de historico o series nuevas.
        monkeypatch.setattr(improve, "policies", lambda: {aid: {"flags": []}})
    with gzip.open(output / "firestore-before.pickle.gz", "wb") as stream:
        pickle.dump(typed, stream)

    def ecb_down(start, end):
        raise RuntimeError("BCE caido")

    monkeypatch.setattr(improve, "rebuilt_fund_metrics",
                        functools.partial(improve.rebuilt_fund_metrics, risk_free_resolver=ecb_down))
    monkeypatch.setattr(improve, "validate_contract", lambda *args, **kwargs: None)
    monkeypatch.setattr(improve, "inventory_row", lambda root, *args: {"asset_id": root["asset_id"]})
    monkeypatch.setattr(improve, "summary", lambda rows, stamp: {"rows": rows, "generated_at": stamp})
    db = SimpleNamespace(document=lambda path: SimpleNamespace(path=path))
    improve.prepare(db, source, output, reuse_backup=True)
    return output


def test_no_rate_on_a_fund_without_metrics_aborts_the_plan(tmp_path, monkeypatch, capsys):
    with pytest.raises(improve.MissingMetricsRateError, match="LU0000000001.*Causa: RuntimeError: BCE caido.*--reuse-backup") as err:
        _prepare_with_backup(tmp_path, monkeypatch, with_metrics=False)
    assert "revisa las series" in str(err.value)
    assert not (tmp_path / "out" / "plan.json").exists()


def test_a_pre_estr_fund_without_metrics_is_set_aside_and_the_plan_goes_on(tmp_path, monkeypatch, capsys):
    # Tercera pasada (17-10-2026): el NO_RATE estructural no aborta en bucle; el fondo se aparta
    # con aviso y queda listado en el plan y en preview.json.
    import json
    output = _prepare_with_backup(tmp_path, monkeypatch, with_metrics=False, last="2019-06-28")
    plan = json.loads((output / "plan.json").read_text(encoding="utf-8"))
    preview = json.loads((output / "preview.json").read_text(encoding="utf-8"))
    assert plan["counts"]["metrics_skipped_pre_estr"] == 1
    assert "metrics_skipped_no_rate" not in plan["counts"]
    expected = [{"isin": "LU0000000001", "last_date": "2019-06-28", "had_metrics": False}]
    assert plan["metrics_skipped_pre_estr"] == expected and preview["metrics_skipped_pre_estr"] == expected
    paths = [op["path"] for group in plan["groups"] for op in group["ops"]]
    assert not any(path.endswith("/metrics/latest") for path in paths)
    assert "anterior a la €STR" in capsys.readouterr().err


def test_no_rate_on_a_fund_with_metrics_keeps_the_live_document(tmp_path, monkeypatch, capsys):
    import json
    output = _prepare_with_backup(tmp_path, monkeypatch, with_metrics=True)
    plan = json.loads((output / "plan.json").read_text(encoding="utf-8"))
    assert plan["counts"]["metrics_skipped_no_rate"] == 1
    paths = [op["path"] for group in plan["groups"] for op in group["ops"]]
    assert not any(path.endswith("/metrics/latest") for path in paths)


def test_abort_helper_lists_the_funds_and_the_cause_and_is_quiet_without_them():
    improve.abort_if_metrics_would_stay_missing([])
    missing = [("LU%010d" % i, "URLError: <urlopen error timed out>") for i in range(12)]
    with pytest.raises(improve.MissingMetricsRateError, match="12 fondo.*Causa: URLError"):
        improve.abort_if_metrics_would_stay_missing(missing)


def test_the_script_no_longer_pops_sharpe_or_rate():
    source = _PATH.read_text(encoding="utf-8")
    assert "pop('sharpe_ratio'" not in source and "pop('risk_free_rate'" not in source
    assert "probe = _RateProbe(risk_free_resolver)" in source and "risk_free_resolver=probe" in source
