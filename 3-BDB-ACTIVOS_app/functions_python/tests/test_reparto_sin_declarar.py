# -*- coding: utf-8 -*-
"""A-203 (Oscar, 21-11-2026): un fondo que no declara su reparto de activos no tiene reparto.

Hasta ese dia `map_pms_exposure` le ponia el tipico de su clase, marcado `CLASSIFICATION_FALLBACK` (un fondo de renta fija, 100 %
renta fija; un mixto, 100 % «otros»), y la exposicion de la cartera lo sumaba como si fuera suyo. Ahora va solo la marca
`NOT_AVAILABLE` (con las seis clases a cero, porque el contrato las pide como numero). La inversion directa (una accion, el ETC de oro) sigue contando por su clase, porque su clase es lo
que es. Y una posicion sin clase conocida tampoco cae en «otros» (A-202): «Sin clasificar» no es «Otros».
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from readmodel.mappers import SIN_REPARTO, map_asset_detail, map_pms_exposure  # noqa: E402

# El contrato de lectura pide las seis clases como numero: van a cero, y lo que dice que no son un reparto es `source`.
CEROS_SIN_REPARTO = {"equity": 0.0, "fixed_income": 0.0, "cash": 0.0, "alternative": 0.0, "real_asset": 0.0, "other": 0.0,
                     "source": "NOT_AVAILABLE"}


def raiz(asset_type, clase, mezcla=None, product=None):
    return {"asset_id": "X", "asset_type": asset_type, "identity": {"name": "X"},
            "classification": {"fondosdb_asset_type": clase},
            "product": product or {},
            "portfolio_exposure": {"asset_mix": mezcla} if mezcla is not None else {}}


@pytest.mark.parametrize("asset_type,clase", [
    ("FUND", "FIXED_INCOME"),
    ("FUND", "EQUITY"),
    ("FUND", "MIXED"),
    ("FUND", "ALTERNATIVE"),
    ("ETF", "EQUITY"),
])
def test_un_fondo_o_un_etf_sin_mezcla_lleva_la_marca_y_no_el_reparto_de_su_clase(asset_type, clase):
    assert map_pms_exposure(raiz(asset_type, clase), clase) == CEROS_SIN_REPARTO
    assert SIN_REPARTO == "NOT_AVAILABLE"


def test_con_mezcla_declarada_nada_cambia():
    reparto = map_pms_exposure(raiz("FUND", "MIXED", {"equity": 0.6, "bond": 0.35, "cash": 0.05}), "MIXED")
    assert reparto == {"equity": 0.6, "fixed_income": 0.35, "cash": 0.05, "alternative": 0.0, "real_asset": 0.0,
                       "other": 0.0, "source": "PORTFOLIO_EXPOSURE"}


def test_la_inversion_directa_sin_mezcla_cuenta_por_su_clase():
    accion = map_pms_exposure(raiz("STOCK", "EQUITY"), "EQUITY")
    assert accion["equity"] == 1.0 and accion["source"] == "CLASSIFICATION_FALLBACK"
    # Un ETC lo tipifica el lector como ETF por su producto; no es un fondo, y su clase es la suya.
    etc = map_pms_exposure(raiz("ETF", "COMMODITIES", product={"product_type": "ETC"}), "COMMODITIES")
    assert etc["other"] == 1.0 and etc["source"] == "CLASSIFICATION_FALLBACK"


def test_sin_clase_conocida_tampoco_cae_en_otros():
    assert map_pms_exposure(raiz("STOCK", "UNKNOWN"), "UNKNOWN") == CEROS_SIN_REPARTO


def test_la_ficha_dice_que_no_tiene_reparto():
    detalle = map_asset_detail(raiz("FUND", "fixed income"))
    assert detalle["pms_exposure"] == CEROS_SIN_REPARTO
    assert detalle["data_quality_summary"]["has_pms_exposure"] is False
    con_mezcla = map_asset_detail(raiz("FUND", "fixed income", {"bond": 1.0}))
    assert con_mezcla["data_quality_summary"]["has_pms_exposure"] is True
