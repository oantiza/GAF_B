# -*- coding: utf-8 -*-
"""Decision 73: un fondo con politica de historico enseña la cifra cuyo periodo no toca lo que la politica recorta.

Las fechas de inicio de cada periodo estan puestas a mano: el 31-10-2026 menos 10 anios es el 31-10-2016.
"""
import datetime
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import fund_history_quality  # noqa: E402
from readmodel import lector_base_nueva as lector  # noqa: E402
from readmodel import mappers  # noqa: E402
from readmodel.mappers import map_asset_detail, map_quant_metrics  # noqa: E402

FONDO = "LU0000000001"
CUATRO_VENTANAS = {
    "1y": {"annualized_return": 0.05, "annualized_volatility": 0.08, "sharpe_ratio": 0.4},
    "3y": {"annualized_return": 0.07, "annualized_volatility": 0.06, "sharpe_ratio": 0.7},
    "5y": {"annualized_return": 0.03, "annualized_volatility": 0.07, "sharpe_ratio": 0.1},
    "10y": {"annualized_return": 0.02, "annualized_volatility": 0.06, "sharpe_ratio": 0.2},
}
SIN_FIRMA = {
    "source": "COMPUTED", "last_date": "2026-10-31", "ytd_return": 0.04, "max_drawdown_5y": -0.13,
    "srri": 3, "risk_score_source": "SRI_KID", "windows": CUATRO_VENTANAS,
}
RAIZ_SIN_CIFRAS = {"asset_id": FONDO, "asset_type": "FUND", "identity": {"name": "Fondo", "currency": "EUR"}}


@pytest.fixture
def con_politica(monkeypatch):
    def poner(**politica):
        monkeypatch.setattr(fund_history_quality, "policies", lambda: {FONDO: politica})
    return poner


def cifras(metricas):
    return {clave: metricas.get(f"annualized_return_{clave}") for clave in ("1y", "3y", "5y", "10y")}


def test_sale_la_cifra_cuyo_periodo_empieza_despues_y_no_la_que_toca_lo_recortado(con_politica):
    con_politica(usable_from="2018-10-26", flags=["HISTORY_CONTINUITY_UNVERIFIED"])
    salida = map_quant_metrics(RAIZ_SIN_CIFRAS, SIN_FIRMA)
    # A 5 anios empieza el 31-10-2021, despues del 26-10-2018. A 10 anios, el 31-10-2016, antes.
    assert cifras(salida) == {"1y": 0.05, "3y": 0.07, "5y": 0.03, "10y": None}
    assert salida["volatility_3y"] == 0.06 and salida["sharpe_3y"] == 0.7
    assert "volatility_10y" not in salida and "sharpe_10y" not in salida
    assert salida["max_drawdown_5y"] == -0.13 and salida["ytd_return"] == 0.04
    assert salida["risk_score"] == 3 and salida["risk_score_source"] == "SRI_KID"
    assert salida["metrics_source"] == "COMPUTED"


@pytest.mark.parametrize("desde,diez_anios", [("2016-10-31", 0.02), ("2016-11-01", None), ("2016-10-30", 0.02)])
def test_el_borde_el_mismo_dia_vale_porque_la_serie_vale_desde_ese_dia(con_politica, desde, diez_anios):
    con_politica(usable_from=desde)
    assert map_quant_metrics(RAIZ_SIN_CIFRAS, SIN_FIRMA).get("annualized_return_10y") == diez_anios


def test_lo_que_mide_un_periodo_se_va_con_su_periodo(con_politica):
    """Serie valida desde el 15-03-2024: a 3 anios (31-10-2023) ya no alcanza, a 1 anio (31-10-2025) si."""
    con_politica(usable_from="2024-03-15")
    salida = map_quant_metrics(RAIZ_SIN_CIFRAS, SIN_FIRMA)
    assert cifras(salida) == {"1y": 0.05, "3y": None, "5y": None, "10y": None}
    assert "max_drawdown_5y" not in salida
    assert salida["ytd_return"] == 0.04, "en lo que va de anio empieza el 31-12-2025"
    assert salida["risk_score"] == 3, "el nivel de riesgo sale del KID: no tiene periodo"


def test_en_lo_que_va_de_anio_tambien_tiene_periodo(con_politica):
    con_politica(usable_from="2026-02-01")
    salida = map_quant_metrics(RAIZ_SIN_CIFRAS, SIN_FIRMA)
    assert "ytd_return" not in salida
    assert cifras(salida) == {"1y": None, "3y": None, "5y": None, "10y": None}


def test_la_caida_historica_mide_desde_el_primer_punto_y_con_recorte_no_sale(con_politica):
    con_politica(usable_from="2018-10-26")
    con_historica = {**SIN_FIRMA, "max_drawdown_hist": {"value": -0.3, "date": "2008-10-10"}}
    salida = map_quant_metrics(RAIZ_SIN_CIFRAS, con_historica)
    assert "max_drawdown_hist" not in salida and "max_drawdown_hist_date" not in salida
    con_politica(flags=["TOTAL_RETURN_RECONCILED"])
    assert map_quant_metrics(RAIZ_SIN_CIFRAS, con_historica)["max_drawdown_hist"] == -0.3


def test_sin_fecha_de_cierre_no_se_sabe_donde_empieza_ningun_periodo(con_politica):
    con_politica(usable_from="2018-10-26")
    salida = map_quant_metrics(RAIZ_SIN_CIFRAS, {**SIN_FIRMA, "last_date": None})
    assert cifras(salida) == {"1y": None, "3y": None, "5y": None, "10y": None}
    assert "ytd_return" not in salida and "max_drawdown_5y" not in salida
    assert salida["risk_score"] == 3


@pytest.mark.parametrize("marca", ["TOTAL_RETURN_RECONCILED", "PREDECESSOR_CONTINUITY_DOCUMENTED"])
def test_una_revision_que_no_recorta_nada_deja_salir_todo_lo_que_hay(con_politica, marca):
    con_politica(flags=[marca], reason="Reconciled")
    assert cifras(map_quant_metrics(RAIZ_SIN_CIFRAS, SIN_FIRMA)) == {"1y": 0.05, "3y": 0.07, "5y": 0.03, "10y": 0.02}


def test_sin_cifra_a_cinco_anios_la_caida_a_cinco_anios_no_sale(con_politica):
    """AB American Growth: un hueco de 1.512 dias en la serie, y su «5 anios» solo mide desde el final del hueco."""
    con_politica(flags=["TOTAL_RETURN_RECONCILED"])
    sin_cinco = {clave: valor for clave, valor in CUATRO_VENTANAS.items() if clave != "5y"}
    salida = map_quant_metrics(RAIZ_SIN_CIFRAS, {**SIN_FIRMA, "windows": sin_cinco})
    assert cifras(salida) == {"1y": 0.05, "3y": 0.07, "5y": None, "10y": 0.02}
    assert "max_drawdown_5y" not in salida


@pytest.mark.parametrize("politica", [
    {"frozen_price": {"from": "2025-09-25", "value": 6.5}, "flags": ["PRICE_FROZEN_DELISTED"]},
    {"flags": ["TOTAL_RETURN_RECONCILED"], "excluded_dates": ["2025-02-04"]},
    {"usable_from": "2015-01-13", "excluded_dates": ["2025-02-04"]},
    {"flags": ["UNA_MARCA_QUE_AUN_NO_EXISTE"]},
    {"reason": "Sin fecha y sin marca"},
])
def test_una_politica_de_otra_forma_no_entra_sola(con_politica, politica):
    con_politica(**politica)
    salida = map_quant_metrics(RAIZ_SIN_CIFRAS, SIN_FIRMA)
    # Sin ninguna cifra no hay origen ni metodo que declarar (hallazgo 18, 15-11-2026); antes decia FUND_ROOT_FALLBACK.
    assert salida["source"] is None and "metrics_method" not in salida
    assert cifras(salida) == {"1y": None, "3y": None, "5y": None, "10y": None}
    assert "risk_score" not in salida


def test_lo_bloqueado_sigue_sin_cifras(con_politica):
    con_politica(blocked=True, usable_from="2015-01-13", flags=["TOTAL_RETURN_UNVERIFIED"])
    salida = map_quant_metrics(RAIZ_SIN_CIFRAS, SIN_FIRMA)
    # Sin ninguna cifra no hay origen ni metodo que declarar (hallazgo 18, 15-11-2026); antes decia FUND_ROOT_FALLBACK.
    assert salida["source"] is None and "metrics_method" not in salida
    assert cifras(salida) == {"1y": None, "3y": None, "5y": None, "10y": None}


def test_donde_la_raiz_trae_cifras_siguen_mandando_ellas(con_politica):
    """Asi no se mueve la base vieja: una lectura sin firma no sustituye a lo que ya se enseña."""
    con_politica(usable_from="2018-10-26")
    raiz = {**RAIZ_SIN_CIFRAS, "performance": {"returns": {"trailing_pct": {"1a": {"fondo": 37.71}}}},
            "risk": {"volatilidad_pct": {"1a": {"fondo": 18.0}}}}
    salida = map_quant_metrics(raiz, SIN_FIRMA)
    assert salida["source"] == "FUND_ROOT_FALLBACK"
    assert salida["annualized_return_1y"] == pytest.approx(0.3771)
    assert salida.get("annualized_return_3y") is None


def test_lo_firmado_por_la_revision_no_pasa_por_la_regla(con_politica):
    con_politica(usable_from="2018-10-26")
    firmado = {**SIN_FIRMA, "source": fund_history_quality.METRICS_SOURCE}
    salida = map_quant_metrics(RAIZ_SIN_CIFRAS, firmado)
    assert salida["annualized_return_10y"] == 0.02, "se calculo sobre la serie ya recortada"
    assert salida["metrics_source"] == fund_history_quality.METRICS_SOURCE


def test_sin_politica_no_cambia_nada(con_politica):
    con_politica()
    fund_history_quality_vacia = map_quant_metrics({**RAIZ_SIN_CIFRAS, "asset_id": "LU0000000002"}, SIN_FIRMA)
    assert fund_history_quality_vacia["annualized_return_10y"] == 0.02


@pytest.mark.parametrize("fecha,anios,esperada", [
    (datetime.date(2026, 10, 31), 10, datetime.date(2016, 10, 31)),
    (datetime.date(2026, 10, 31), 1, datetime.date(2025, 10, 31)),
    (datetime.date(2028, 2, 29), 3, datetime.date(2025, 2, 28)),
    (datetime.date(2028, 2, 29), 4, datetime.date(2024, 2, 29)),
])
def test_la_misma_fecha_tantos_anios_antes(fecha, anios, esperada):
    assert mappers._anios_antes(fecha, anios) == esperada


TARJETA_GOLDMAN = {
    "instrument_type": "FUND",
    "metrics": {
        "source": "COMPUTED", "method": "EXTRACTOR_MONTHLY_V2", "frequency": "MONTHLY", "as_of": "2026-10-31",
        "annualized_return": {"1y": 0.047909, "3y": 0.070366, "5y": 0.025246, "10y": 0.02465},
        "volatility": {"3y": 0.059936}, "sharpe": {"3y": 0.711}, "max_drawdown": {"5y": -0.135009},
        "risk_score": 3, "risk_score_source": "SRI_KID", "ytd_return": 0.046087,
    },
}
RAIZ_FONDO_NUEVA = {"instrument_type": "FUND", "identity": {"name": "Fondo", "currency": "EUR"}, "classification": {}}


def test_por_el_camino_de_la_base_nueva_con_las_politicas_de_verdad():
    """Goldman Absolute Return vale desde el 13-01-2015; M&G Asian, desde el 26-10-2018."""
    assert fund_history_quality.policy_for("LU1103307408")["usable_from"] == "2015-01-13"
    goldman = map_asset_detail(lector.raiz_vieja("LU1103307408", RAIZ_FONDO_NUEVA, TARJETA_GOLDMAN),
                               lector.metricas_viejas(TARJETA_GOLDMAN), None)
    assert goldman["metrics"]["annualized_return_3y"] == 0.070366
    assert goldman["metrics"]["annualized_return_10y"] == 0.02465
    assert goldman["metrics"]["risk_score"] == 3
    assert goldman["performance_preview"]["annualized_return_3y"] == 0.070366
    assert goldman["data_quality_summary"]["has_metrics"] is True

    assert fund_history_quality.policy_for("LU1670618187")["usable_from"] == "2018-10-26"
    mg = map_asset_detail(lector.raiz_vieja("LU1670618187", RAIZ_FONDO_NUEVA, TARJETA_GOLDMAN),
                          lector.metricas_viejas(TARJETA_GOLDMAN), None)
    assert mg["metrics"]["annualized_return_5y"] == 0.025246
    assert mg["metrics"].get("annualized_return_10y") is None


def test_nh_sigue_sin_cifras_por_las_dos_bases():
    """Su politica dice hasta cuando vale la serie. En la nueva no tiene metricas, y en la vieja tiene unas sin firma."""
    assert fund_history_quality.policy_for("ES0161560018").get("frozen_price")
    raiz = {"asset_id": "ES0161560018", "asset_type": "STOCK", "identity": {"name": "NH", "currency": "EUR"}}
    salida = map_quant_metrics(raiz, {**SIN_FIRMA, "source": "FONDOSDB_EODHD_DAILY_HISTORY", "last_date": "2026-09-04"})
    # Sin ninguna cifra no hay origen ni metodo que declarar (hallazgo 18, 15-11-2026); antes decia FUND_ROOT_FALLBACK.
    assert salida["source"] is None and "metrics_method" not in salida
    assert cifras(salida) == {"1y": None, "3y": None, "5y": None, "10y": None}
