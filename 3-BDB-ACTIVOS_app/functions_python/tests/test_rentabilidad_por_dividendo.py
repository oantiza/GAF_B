# -*- coding: utf-8 -*-
"""
La rentabilidad por dividendo de una accion: el dividendo previsto para 12 meses entre nuestro precio (decision A-143).
Datos inventados.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from readmodel import lector_base_nueva as lector  # noqa: E402
from readmodel.mappers import map_asset_detail  # noqa: E402

ACCION = {"instrument_type": "STOCK", "identity": {"name": "Accion", "currency": "EUR"}}
FONDO = {"instrument_type": "FUND", "identity": {"name": "Fondo", "currency": "EUR"}}
SIN = object()


def tarjeta(previsto=1.0, pagado=1.5, rentabilidad_del_proveedor=0.021, moneda_div="EUR", precio=50.0, moneda_precio="EUR"):
    dividendos = {"yield_12m": rentabilidad_del_proveedor, "trailing_amount_per_share": pagado, "currency": moneda_div}
    if previsto is not SIN:
        dividendos["forward_amount_per_share"] = previsto
    return {"dividends": dividendos, "quote": {"price": precio, "currency": moneda_precio, "as_of": "2026-11-11"}}


def rentabilidad(raiz, t):
    detalle = map_asset_detail(lector.raiz_vieja("XX0000000001", raiz, t, {}))
    return ((detalle.get("fundamentals_summary") or {}).get("dividends") or {}).get("yield_ratio")


def test_es_lo_previsto_entre_nuestro_precio_y_no_lo_pagado_ni_la_cifra_copiada():
    # 1 / 50 = 2 %; lo pagado daria 3 % y el proveedor dice 2,1 %.
    assert rentabilidad(ACCION, tarjeta()) == pytest.approx(0.02)


def test_un_pagado_a_cero_no_hace_cero_si_hay_dividendo_previsto():
    # El defecto medido: 45 acciones que reparten dicen 0 pagado.
    assert rentabilidad(ACCION, tarjeta(pagado=0)) == pytest.approx(0.02)


def test_cero_solo_si_las_tres_senales_dicen_que_no_reparte():
    assert rentabilidad(ACCION, tarjeta(previsto=0, pagado=0, rentabilidad_del_proveedor=0)) == 0
    assert rentabilidad(ACCION, tarjeta(previsto=SIN, pagado=0, rentabilidad_del_proveedor=0)) == 0


@pytest.mark.parametrize("cambio", [
    {"previsto": 0, "pagado": 1.5},                         # sin previsto pero con pagado: no se sabe
    {"previsto": SIN, "pagado": 0, "rentabilidad_del_proveedor": 0.03},
    {"moneda_div": "USD"},                                  # importe y precio en monedas distintas
    {"moneda_div": None},                                   # sin moneda del dividendo
    {"precio": 0},                                          # sin precio util
])
def test_lo_que_no_se_sabe_no_se_inventa(cambio):
    assert rentabilidad(ACCION, tarjeta(**cambio)) is None


def test_los_peniques_cuentan_como_libras():
    # 0,30 GBP previsto; precio 1.500 GBX = 15 GBP: 2 %.
    assert rentabilidad(ACCION, tarjeta(previsto=0.30, moneda_div="GBP", precio=1500, moneda_precio="GBX")) == pytest.approx(0.02)


def test_sin_dividendos_en_la_tarjeta_no_hay_fundamentales():
    detalle = map_asset_detail(lector.raiz_vieja("XX0000000001", ACCION, {"quote": {"price": 10, "currency": "EUR"}}, {}))
    assert detalle.get("fundamentals_summary") is None


def test_un_fondo_no_la_recibe():
    assert rentabilidad(FONDO, tarjeta()) is None
