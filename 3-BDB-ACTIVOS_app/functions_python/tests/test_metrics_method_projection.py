# -*- coding: utf-8 -*-
"""Ola 1 (1.3): el read model proyecta con que se midio cada activo.

Sin esto, metrics.v1.2 declara la metodologia en la maestra pero la app no la
ve, y el comparador sigue poniendo en la misma columna el Sharpe trailing de un
fondo y el calculado en casa de una accion (auditoria 03-09, hallazgo 02).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from readmodel.mappers import map_quant_metrics


def _metrics(**ventanas):
    return {
        "asset_id": "US0378331005",
        "population": "stock",
        "source": "FONDOSDB_EODHD_DAILY_HISTORY",
        "updated_at": "2026-09-01T00:00:00Z",
        "risk_score_source": "VOL_BUCKET",
        "windows": ventanas,
    }


def test_proyecta_la_etiqueta_cuando_todas_las_ventanas_coinciden():
    out = map_quant_metrics({}, _metrics(
        **{
            "1y": {"annualized_volatility": 0.28, "method": "GEOMETRIC_CAGR", "frequency": "DAILY"},
            "3y": {"annualized_volatility": 0.26, "method": "GEOMETRIC_CAGR", "frequency": "DAILY"},
        }
    ))

    assert out["metrics_method"] == "GEOMETRIC_CAGR"
    assert out["metrics_frequency"] == "DAILY"


def test_no_declara_nada_si_las_ventanas_discrepan():
    # Mejor sin etiqueta que con una que no cubre todas las ventanas.
    out = map_quant_metrics({}, _metrics(
        **{
            "1y": {"annualized_volatility": 0.28, "frequency": "DAILY"},
            "3y": {"annualized_volatility": 0.26, "frequency": "MONTHLY"},
        }
    ))

    assert "metrics_frequency" not in out


def test_missing_frequency_in_one_populated_window_is_not_inferred_from_another():
    out = map_quant_metrics({}, _metrics(**{
        "1y": {"annualized_volatility": 0.28, "frequency": "DAILY"},
        "3y": {"annualized_volatility": 0.26},
    }))
    assert "metrics_frequency" not in out


def test_un_documento_anterior_a_v12_no_declara_metodologia():
    out = map_quant_metrics({}, _metrics(**{"1y": {"annualized_volatility": 0.28}}))

    assert "metrics_method" not in out
    assert "metrics_frequency" not in out
    assert out["metrics_source"] == "FONDOSDB_EODHD_DAILY_HISTORY"


def test_el_fallback_de_fondo_se_declara_como_cifra_del_proveedor():
    root = {"risk": {"volatilidad_pct": {"3a": {"fondo": 13.1}}, "sharpe": {"3a": {"fondo": 0.61}}}}

    out = map_quant_metrics(root, None)

    assert out["source"] == "FUND_ROOT_FALLBACK"
    assert out["metrics_method"] == "TRAILING_PROVIDER"
    assert out["metrics_frequency"] == "PROVIDER"
