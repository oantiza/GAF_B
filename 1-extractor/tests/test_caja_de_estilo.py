# -*- coding: utf-8 -*-
"""Las nueve celdas de la caja de estilo y tamaño llegan al canónico (decisión 51 de Óscar, 05-11-2026).

Los números de `CELDAS_ISHARES` son los de `cartera.style_box_rv.celdas_pct` de IE00B4L5Y983 en su ficha
del 05-11-2026, y sus marginales están sumados a mano en las pruebas, no copiados del código.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import adaptador_bdb as a  # noqa: E402
from core.contratos import valida  # noqa: E402

CELDAS_ISHARES = {"LV": 24.256945, "LB": 34.079276, "LG": 22.759818,
                  "MV": 5.501637, "MB": 8.54213, "MG": 4.271679,
                  "SV": 0.186287, "SB": 0.361082, "SG": 0.041146}


def _ficha(celdas: dict | None) -> dict:
    cartera = {"asignacion_activos": {"rv": {"neto": 99.0}, "liquidez": {"neto": 1.0}}}
    if celdas is not None:
        cartera["style_box_rv"] = {"celdas_pct": celdas}
    return {"meta": {"isin": "LU0000000001"},
            "identificacion": {"nombre": "Fondo", "tipo": "fondo", "divisa_base": "EUR"},
            "cartera": cartera}


def _exposicion(celdas: dict | None) -> dict:
    return a.convierte(_ficha(celdas))["portfolio_exposure_v2"]


def test_las_nueve_celdas_viajan_en_fraccion_y_con_su_nombre():
    caja = _exposicion(CELDAS_ISHARES)["equity_style_box"]
    assert caja == {"large_value": 0.242569, "large_blend": 0.340793, "large_growth": 0.227598,
                    "mid_value": 0.055016, "mid_blend": 0.085421, "mid_growth": 0.042717,
                    "small_value": 0.001863, "small_blend": 0.003611, "small_growth": 0.000411}
    assert sum(caja.values()) == pytest.approx(1.0, abs=5e-6)


def test_sus_marginales_son_los_repartos_que_ya_se_publican():
    exposicion = _exposicion(CELDAS_ISHARES)
    # Grande 24,256945 + 34,079276 + 22,759818 = 81,096039; mediana 18,315446; pequeña 0,588515.
    assert exposicion["market_caps"] == {"large": 0.81096, "mid": 0.183154, "small": 0.005885}
    # Valor 24,256945 + 5,501637 + 0,186287 = 29,944869; mixto 42,982488; crecimiento 27,072643.
    assert exposicion["equity_styles"] == {"value": 0.299449, "blend": 0.429825, "growth": 0.270726}


def test_una_celda_negativa_se_queda_como_esta_porque_es_lo_neto_de_cortos():
    celdas = {**CELDAS_ISHARES, "LV": 25.056945, "SG": -0.758854}
    caja = _exposicion(celdas)["equity_style_box"]
    assert caja["small_growth"] == -0.007589
    assert sum(caja.values()) == pytest.approx(1.0, abs=5e-6)


@pytest.mark.parametrize("celdas", [None, {}, {k: v for k, v in CELDAS_ISHARES.items() if k != "MB"},
                                    {**CELDAS_ISHARES, "MB": None}])
def test_las_nueve_o_ninguna_porque_con_ocho_lo_que_falta_pareceria_un_cero(celdas):
    assert _exposicion(celdas)["equity_style_box"] is None


def test_una_accion_no_lleva_caja():
    ficha = {"meta": {"isin": "ES0144580Y14"},
             "identificacion": {"nombre": "Iberdrola", "tipo": "accion", "divisa_base": "EUR"}}
    assert "equity_style_box" not in a.convierte(ficha)["portfolio_exposure_v2"]


def test_el_canonico_con_la_caja_cumple_su_contrato():
    valida(a.convierte(_ficha(CELDAS_ISHARES)))
