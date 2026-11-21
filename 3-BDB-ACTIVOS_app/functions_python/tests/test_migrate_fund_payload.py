# -*- coding: utf-8 -*-
"""El documento que la migracion escribiria para un fondo.

Es la pieza que toca la maestra, asi que lo que se comprueba aqui no es el
calculo --eso es de ingest_asset-- sino lo que NO se puede perder al reescribir:
el SRRI del KID, las ventanas que el contraste no autoriza, y la declaracion de
procedencia de cada cifra.
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from migrate_metrics_latest import _fund_payload, _stamp_provider_method

CORTE = "2026-06-30"


def _serie(anios=6, desde_valor=100.0, crecimiento=1.05):
    """Serie diaria que crece a `crecimiento` anual compuesto."""
    fin = date.fromisoformat("2026-09-04")
    dias = int(365.25 * anios)
    inicio = fin - timedelta(days=dias)
    puntos = []
    for i in range(dias + 1):
        anios_transcurridos = i / 365.25
        puntos.append({"date": (inicio + timedelta(days=i)).isoformat(),
                       "value": desde_valor * (crecimiento ** anios_transcurridos)})
    return puntos


def _raiz(**trailing):
    return {
        "asset_type": "FUND",
        "identity": {"currency": "EUR", "name": "Fondo de prueba"},
        "performance": {"returns": {"fecha_dato": CORTE,
                                    "trailing_pct": {k: {"fondo": v} for k, v in trailing.items()}}},
    }


def _actual(srri=4, **ventanas):
    return {
        "asset_id": "LU0000000000",
        "population": "fund",
        "source": "FONDOSDB_ROOT_ES",
        "risk_score_source": "SRRI",
        "srri": srri,
        "updated_at": "2026-09-04T00:00:00Z",
        "windows": ventanas,
    }


def test_el_srri_del_kid_sobrevive_al_recalculo():
    # Sin arrastrarlo, el fondo pasaria a VOL_BUCKET y perderia el indicador
    # regulatorio, que no se deduce de la serie.
    payload, _ = _fund_payload(
        "LU0000000000",
        _raiz(**{"1a": 5.0, "3a_anualizada": 5.0, "5a_anualizada": 5.0}),
        _actual(srri=4, **{"3y": {"annualized_return": 0.05, "method": "TRAILING_PROVIDER"}}),
        _serie(), "2026-09-10T00:00:00Z", 1.0)

    assert payload is not None
    assert payload["srri"] == 4
    assert payload["risk_score_source"] == "SRRI"


def test_una_ventana_que_no_cuadra_conserva_la_cifra_del_proveedor():
    payload, detalle = _fund_payload(
        "LU0000000000",
        # 1a y 3a cuadran con el 5% de la serie; 5a no.
        _raiz(**{"1a": 5.0, "3a_anualizada": 5.0, "5a_anualizada": 11.0}),
        _actual(**{"5y": {"annualized_return": 0.11, "method": "TRAILING_PROVIDER",
                          "frequency": "PROVIDER"}}),
        _serie(), "2026-09-10T00:00:00Z", 1.0)

    assert "5y" not in detalle["allowed"]
    assert payload["windows"]["5y"]["annualized_return"] == 0.11
    assert payload["windows"]["5y"]["method"] == "TRAILING_PROVIDER"
    assert payload["windows"]["3y"]["method"] == "GEOMETRIC_CAGR"


def test_si_no_cuadra_ninguna_ventana_el_documento_no_se_toca():
    payload, detalle = _fund_payload(
        "LU0000000000",
        _raiz(**{"1a": 40.0, "3a_anualizada": 40.0, "5a_anualizada": 40.0}),
        _actual(), _serie(), "2026-09-10T00:00:00Z", 1.0)

    assert payload is None
    assert detalle["allowed"] == []


def test_una_clase_en_dolar_no_se_toca():
    raiz = _raiz(**{"1a": 5.0, "3a_anualizada": 5.0})
    raiz["identity"]["currency"] = "USD"

    payload, _ = _fund_payload("LU0000000000", raiz, _actual(), _serie(),
                               "2026-09-10T00:00:00Z", 1.0)

    assert payload is None


def test_una_ventana_del_proveedor_sin_metodo_se_sella_al_conservarla():
    # Si se dejara sin sellar, `_needs_recompute` la leeria como huella de la
    # formula vieja y el fondo volveria a entrar en cada pasada.
    sellado = _stamp_provider_method({"5y": {"annualized_return": 0.11},
                                      "1y": {"annualized_volatility": 0.2}})

    assert sellado["5y"]["method"] == "TRAILING_PROVIDER"
    assert sellado["5y"]["frequency"] == "PROVIDER"
    assert "method" not in sellado["1y"]


def test_el_documento_recalculado_cumple_el_contrato():
    from contract_validation import validate_contract

    payload, _ = _fund_payload(
        "LU0000000000",
        _raiz(**{"1a": 5.0, "3a_anualizada": 5.0, "5a_anualizada": 5.0}),
        _actual(), _serie(), "2026-09-10T00:00:00Z", 1.0)

    validate_contract(payload, "metrics.v1.2.schema.json")


def test_un_etf_con_metricas_del_proveedor_no_se_convierte_en_fondo():
    # 5 ETF y un OTHER tambien llevan FONDOSDB_ROOT_ES. Fijar "FUND" les habria
    # puesto population: fund en la maestra.
    payload, _ = _fund_payload(
        "IE0000000000",
        _raiz(**{"1a": 5.0, "3a_anualizada": 5.0, "5a_anualizada": 5.0}),
        _actual(), _serie(), "2026-09-10T00:00:00Z", 1.0, asset_type="ETF")

    assert payload is not None
    assert payload["population"] == "stock"
