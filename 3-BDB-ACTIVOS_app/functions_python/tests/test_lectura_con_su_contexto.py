# -*- coding: utf-8 -*-
"""Hallazgos 16, 17, 18 y 20 de la auditoria del backend (15-11-2026): ninguna cifra cambia; cada una viaja con lo que hace falta
para leerla, y lo que falta se dice que falta.

Las tarjetas de ejemplo siguen `instrument-read-card.v2` y `instrument-declared-holdings.v2`. Las del ETF y la del fondo mixto copian
la forma medida el 15-11-2026 en la base nueva local (IE0002PG6CA6: clase en USD, precio en EUR; DE0005318406: 155 bonos, 243 titulos,
30 % del patrimonio).
"""
import copy
import json
import os
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import fund_history_quality  # noqa: E402
from readmodel import lector_base_nueva as lector  # noqa: E402
from readmodel import repository as repo  # noqa: E402
from readmodel.mappers import map_asset_detail  # noqa: E402
from test_lector_base_nueva import _Db  # noqa: E402

ESQUEMA = json.loads((Path(__file__).resolve().parents[1] / "contracts_cache" / "asset-for-bdb.v1.schema.json").read_text(encoding="utf-8"))
NUEVOS_EN_METRICAS = {"as_of", "returns_as_of", "returns_as_of_by_window", "return_basis", "series_class", "distribution_policy",
                      "windows_out_of_range", "provider"}

RAIZ_FONDO = {"instrument_type": "FUND", "identity": {"name": "Fondo mixto", "currency": "EUR"},
              "classification": {"category": "Mixtos", "asset_class": "ALLOCATION"}}
TARJETA_FONDO = {
    "instrument_type": "FUND",
    "identity": {"name": "Fondo mixto", "currency": "EUR"},
    "quote": {"price": 112.4, "as_of": "2026-11-12", "price_class": "NAV", "currency": "EUR"},
    "holdings_summary": {"positions_count": 155, "top10_weight": 0.21, "as_of": "2026-09-30"},
    "metrics": {
        "source": "COMPUTED", "method": "EXTRACTOR_MONTHLY_V2", "frequency": "MONTHLY", "return_basis": "TOTAL_RETURN",
        "as_of": "2026-10-31", "distribution_policy": "ACCUMULATING", "windows_out_of_range": ["annualized_return.10y"],
        "annualized_return": {"1y": 0.051, "3y": 0.043}, "volatility": {"1y": 0.071, "3y": 0.064}, "sharpe": {"3y": 0.31},
        "max_drawdown": {"5y": -0.152}, "ytd_return": 0.038, "risk_score": 3, "risk_score_source": "SRI_KID",
    },
}
RAIZ_ETF = {"instrument_type": "ETF", "identity": {"name": "ETF en dolares", "currency": "USD"},
            "classification": {"category": "RV Global", "asset_class": "EQUITY"}}
TARJETA_ETF = {
    "instrument_type": "ETF",
    "identity": {"name": "ETF en dolares", "currency": "USD"},
    "quote": {"price": 98.4, "as_of": "2026-11-12", "price_class": "MARKET_PRICE", "currency": "EUR"},
    "metrics": {
        "source": "COMPUTED", "method": "EXTRACTOR_MONTHLY_V2", "frequency": "MONTHLY", "return_basis": "TOTAL_RETURN",
        "series_class": "MARKET_PRICE", "as_of": "2026-10-31", "annualized_return": {"1y": 0.12}, "volatility": {"1y": 0.15},
    },
}


def _detalle(asset_id, raiz, tarjeta, resumen=None):
    return map_asset_detail(lector.raiz_vieja(asset_id, raiz, tarjeta), lector.metricas_viejas(tarjeta), resumen)


def test_las_metricas_dicen_de_cuando_son_y_que_miden_con_los_nombres_de_la_tarjeta():
    detalle = _detalle("LU0000000012", RAIZ_FONDO, TARJETA_FONDO)
    metricas = detalle["metrics"]
    assert metricas["as_of"] == "2026-10-31"
    assert metricas["return_basis"] == "TOTAL_RETURN"
    assert metricas["distribution_policy"] == "ACCUMULATING"
    assert metricas["windows_out_of_range"] == ["annualized_return.10y"]
    # Lo que la tarjeta no trae no sale: ni se deduce ni se rellena.
    for ausente in ("returns_as_of", "returns_as_of_by_window", "series_class", "provider"):
        assert ausente not in metricas
    Draft202012Validator(ESQUEMA).validate(detalle)


def test_las_fechas_de_las_rentabilidades_del_proveedor_viajan_tal_cual():
    """Un titular del proveedor con la rentabilidad a fin de trimestre y el riesgo a fin de mes (decision B-74)."""
    tarjeta = {"instrument_type": "FUND", "metrics": {
        "source": "PROVIDER", "method": "TRAILING_PROVIDER", "frequency": "PROVIDER", "return_basis": "TOTAL_RETURN",
        "as_of": "2026-10-31", "returns_as_of": "2026-10-31",
        "returns_as_of_by_window": {"1y": "2026-10-31", "3y": "2026-09-30"},
        "annualized_return": {"1y": 0.04, "3y": 0.03}, "volatility": {"3y": 0.05},
    }}
    metricas = _detalle("LU0000000009", RAIZ_FONDO, tarjeta)["metrics"]
    assert metricas["returns_as_of_by_window"] == {"1y": "2026-10-31", "3y": "2026-09-30"}
    assert metricas["returns_as_of"] == "2026-10-31"


def test_una_ventana_del_proveedor_lleva_las_fechas_de_su_bloque():
    tarjeta = {"instrument_type": "FUND", "metrics": {
        "source": "COMPUTED", "method": "EXTRACTOR_MONTHLY_V2", "frequency": "MONTHLY", "return_basis": "TOTAL_RETURN",
        "as_of": "2026-10-31", "annualized_return": {"1y": 0.05},
        "provider": {"source": "PROVIDER", "method": "TRAILING_PROVIDER", "as_of": "2026-10-31", "returns_as_of": "2026-09-30",
                     "annualized_return": {"3y": 0.02}},
    }}
    detalle = _detalle("LU0000000010", RAIZ_FONDO, tarjeta)
    assert detalle["metrics"]["metrics_method"] == "PROPIA_Y_PROVEEDOR"
    assert detalle["metrics"]["provider"] == {"as_of": "2026-10-31", "returns_as_of": "2026-09-30"}
    Draft202012Validator(ESQUEMA).validate(detalle)


def test_el_ultimo_valor_de_un_etf_en_dolares_lleva_la_divisa_de_su_precio():
    detalle = _detalle("IE0002PG6CA6", RAIZ_ETF, TARJETA_ETF)
    assert detalle["identity"]["currency"] == "USD"
    assert detalle["performance_preview"]["latest_value"] == 98.4
    assert detalle["performance_preview"]["latest_value_currency"] == "EUR"
    assert detalle["metrics"]["series_class"] == "MARKET_PRICE"
    Draft202012Validator(ESQUEMA).validate(detalle)


def test_un_valor_que_no_se_ensena_no_lleva_divisa():
    """El precio que va mas de 7 dias por detras de la serie no se ensena (NUEVO-B1), y con el se va su divisa."""
    tarjeta = copy.deepcopy(TARJETA_ETF)
    tarjeta["quote"]["as_of"] = "2026-06-30"
    vista = _detalle("IE0002PG6CA6", RAIZ_ETF, tarjeta)["performance_preview"]
    assert vista["latest_value"] is None and vista["latest_value_currency"] is None


def test_un_instrumento_sin_metricas_no_se_rotula_como_dato_de_prueba():
    tarjeta = {"instrument_type": "STOCK", "quote": {"price": 3.1, "as_of": "2026-11-12", "price_class": "MARKET_PRICE", "currency": "EUR"}}
    raiz = {"instrument_type": "STOCK", "identity": {"name": "Accion nueva", "currency": "EUR"}, "classification": {}}
    detalle = _detalle("ES0105394003", raiz, tarjeta)
    assert detalle["metrics"] == {"source": None, "metrics_source": None}
    assert detalle["performance_preview"]["source"] is None
    assert detalle["performance_preview"]["data_quality"] == "NOT_AVAILABLE"
    assert "MOCK" not in json.dumps(detalle)
    assert "MISSING_QUANT_METRICS" in detalle["quality_flags"]
    assert detalle["coverage_status"] == "ROOT_ONLY"
    Draft202012Validator(ESQUEMA).validate(detalle)


def test_un_fondo_con_politica_y_sin_cifras_no_sale_completo_ni_con_metodo(monkeypatch):
    """Una politica que no dice desde cuando vale la serie no deja pasar ninguna cifra (decision 73). Antes los rotulos del metodo
    contaban como metricas y el fondo salia con cobertura COMPLETE."""
    monkeypatch.setattr(fund_history_quality, "policies", lambda: {"LU0000000011": {"reason": "Sin fecha y sin marca"}})
    resumen = lector.resumen_de_posiciones(TARJETA_FONDO["holdings_summary"])
    detalle = _detalle("LU0000000011", RAIZ_FONDO, TARJETA_FONDO, resumen)
    assert detalle["metrics"] == {"source": None, "metrics_source": None}
    assert detalle["coverage_status"] == "PARTIAL"
    assert {"MISSING_QUANT_METRICS", "PARTIAL_COVERAGE"} <= set(detalle["quality_flags"])
    assert detalle["data_quality_summary"]["has_metrics"] is False
    Draft202012Validator(ESQUEMA).validate(detalle)


def _db_de_posiciones(con_trozos: bool):
    i = "instruments/DE0005318406"
    datos = {
        i: RAIZ_FONDO,
        f"{i}/read/card": TARJETA_FONDO,
        f"{i}/declared/holdings": {
            "source": "MORNINGSTAR", "as_of": "2026-09-30", "positions_count": 155, "securities_count": 243,
            "top10_weight": 0.21, "coverage": 0.301148,
            "top": [{"name": f"Titulo {n}", "weight": 0.01} for n in range(25)],
        },
    }
    if con_trozos:
        datos[f"{i}/holdings_chunks/000"] = {"positions": [{"name": f"Linea {n}", "weight": 0.004} for n in range(243)]}
    return _Db(datos)


def test_un_fondo_mixto_da_el_total_de_titulos_y_la_cobertura_y_dice_que_la_lista_es_entera():
    datos = lector.LectorBaseNueva(_db_de_posiciones(True)).get_holdings("DE0005318406")["data"]
    assert datos["holdings_count"] == 155, "el recuento de siempre no cambia: lo leen otros"
    assert datos["securities_count"] == 243
    assert datos["coverage"] == 0.301148
    assert datos["list_scope"] == "FULL"
    assert len(datos["holdings"]) == 243


def test_con_solo_las_principales_la_respuesta_dice_que_la_lista_esta_cortada():
    l = lector.LectorBaseNueva(_db_de_posiciones(False))
    datos = l.get_holdings("DE0005318406")["data"]
    assert datos["list_scope"] == "TOP"
    assert len(datos["holdings"]) == 25
    assert datos["securities_count"] == 243
    # Y la funcion de catalogo lo devuelve tal cual, en el detalle y en las posiciones.
    detalle = repo.get_asset_detail(l, "DE0005318406")
    assert detalle["holdings_summary"]["list_scope"] == "TOP"
    assert detalle["holdings_summary"]["securities_count"] == 243
    assert detalle["holdings_summary"]["coverage"] == 0.301148
    assert repo.get_asset_holdings(l, "DE0005318406")["list_scope"] == "TOP"
    Draft202012Validator(ESQUEMA).validate({k: v for k, v in detalle.items() if k not in ("read_warnings",)})


def test_sin_los_campos_en_la_cabecera_no_se_inventan():
    db = _db_de_posiciones(True)
    cabecera = db.datos["instruments/DE0005318406/declared/holdings"]
    del cabecera["securities_count"], cabecera["coverage"]
    datos = lector.LectorBaseNueva(db).get_holdings("DE0005318406")["data"]
    assert "securities_count" not in datos and "coverage" not in datos
    assert datos["list_scope"] == "FULL"


def _sin_lo_nuevo(tarjeta):
    vieja = copy.deepcopy(tarjeta)
    for clave in ("as_of", "returns_as_of", "returns_as_of_by_window", "return_basis", "series_class", "distribution_policy",
                  "windows_out_of_range"):
        vieja["metrics"].pop(clave, None)
    vieja["quote"].pop("currency", None)
    return vieja


@pytest.mark.parametrize("asset_id,raiz,tarjeta", [
    ("LU0000000012", RAIZ_FONDO, TARJETA_FONDO),
    ("IE0002PG6CA6", RAIZ_ETF, TARJETA_ETF),
])
def test_un_instrumento_normal_recibe_lo_de_antes_mas_los_campos_nuevos(asset_id, raiz, tarjeta):
    """Ninguna cifra cambia: con o sin lo nuevo en la tarjeta, la respuesta es la misma clave a clave, salvo los campos nuevos. El `as_of`
    de la tarjeta se deja en las dos, porque ya se leia antes (como `last_date`, para la caducidad del ultimo valor). La comparacion con
    el codigo anterior, instrumento a instrumento sobre la base nueva local, esta en el informe del 15-11-2026."""
    vieja = _sin_lo_nuevo(tarjeta)
    vieja["metrics"]["as_of"] = tarjeta["metrics"]["as_of"]
    antes = _detalle(asset_id, raiz, vieja)
    ahora = _detalle(asset_id, raiz, tarjeta)

    def sin_lo_nuevo(detalle):
        return {**detalle,
                "metrics": {k: v for k, v in detalle["metrics"].items() if k not in NUEVOS_EN_METRICAS},
                "performance_preview": {k: v for k, v in detalle["performance_preview"].items() if k != "latest_value_currency"}}

    assert sin_lo_nuevo(ahora) == sin_lo_nuevo(antes)
    nuevas = set(ahora["metrics"]) - set(antes["metrics"])
    assert nuevas and nuevas <= NUEVOS_EN_METRICAS
    assert ahora["performance_preview"]["latest_value_currency"] == tarjeta["quote"]["currency"]
    # Y las cifras son las de la tarjeta.
    assert ahora["metrics"]["annualized_return_1y"] == tarjeta["metrics"]["annualized_return"]["1y"]
