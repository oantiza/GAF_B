# -*- coding: utf-8 -*-
"""Decision 58: la linea de entorno que libera lo reparado vive en un fichero sin versionar, y ya se perdio una vez.

`verified_price_repair_releases.json` es lo que ese fichero tiene que llevar. Lo lee `scripts/desplegarFunciones.mjs`, que no
despliega sin ello, y estas pruebas, que fallan si alguien quita un ISIN de las cuarentenas o de la lista sin tocar la otra.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization import repository  # noqa: E402
from price_history_sync import ADJUSTMENT_QUARANTINE_ASSETS, adjustment_problem  # noqa: E402

RUTA = os.path.join(os.path.dirname(__file__), "..", "verified_price_repair_releases.json")
with open(RUTA, encoding="utf-8") as fichero:
    LISTA = json.load(fichero)
VARIABLE = LISTA["variable"]
ISINS = LISTA["isins"]
RAIZ = {"asset_type": "ETF", "identity": {"currency": "USD"}, "quality": {"status": "ACCEPTED"}}
DE_DIVISA = sorted(repository.FX_QUARANTINE_ASSET_IDS)
DE_AJUSTE = sorted(ADJUSTMENT_QUARANTINE_ASSETS)


def test_la_lista_y_las_cuarentenas_son_lo_mismo():
    """Lo que entra en una cuarentena, o sale de ella, se decide tambien aqui."""
    cuarentenas = set(DE_DIVISA) | set(DE_AJUSTE)
    assert set(ISINS) - cuarentenas == set(), "En la lista y en ninguna cuarentena"
    assert cuarentenas - set(ISINS) == set(), "En una cuarentena y no en la lista"
    assert len(ISINS) == len(set(ISINS))


def test_cada_uno_sale_de_una_sola_cuarentena():
    assert set(DE_DIVISA) & set(DE_AJUSTE) == set()


@pytest.mark.parametrize("isin", DE_DIVISA)
def test_sin_la_variable_siguen_en_cuarentena_de_divisa(monkeypatch, isin):
    monkeypatch.delenv(VARIABLE, raising=False)
    assert repository._root_exclusion_reason(RAIZ, "EUR", isin) == repository.MOTIVO_CUARENTENA_DE_DIVISA


@pytest.mark.parametrize("isin", DE_AJUSTE)
def test_sin_la_variable_siguen_en_cuarentena_de_ajuste(monkeypatch, isin):
    monkeypatch.delenv(VARIABLE, raising=False)
    assert adjustment_problem(isin) == "PRICE_ADJUSTMENT_QUARANTINE"
    assert repository._root_exclusion_reason(RAIZ, "EUR", isin) == "QUALITY_BLOCKED"


@pytest.mark.parametrize("isin", ISINS)
def test_con_la_variable_de_la_lista_sale_cada_uno(monkeypatch, isin):
    """Comprueba de paso que `variable` es la que lee el codigo: con otro nombre seguirian dentro."""
    monkeypatch.setenv(VARIABLE, ",".join(ISINS))
    assert repository._root_exclusion_reason(RAIZ, "EUR", isin) is None
    assert not repository.asset_id_in_quarantine(isin)
    assert adjustment_problem(isin) is None


def test_quitar_uno_de_la_variable_lo_devuelve_a_su_cuarentena(monkeypatch):
    for isin in ISINS:
        monkeypatch.setenv(VARIABLE, ",".join(x for x in ISINS if x != isin))
        assert repository._root_exclusion_reason(RAIZ, "EUR", isin) is not None, isin


def test_la_liberacion_no_toca_lo_que_de_verdad_no_tiene_conversion(monkeypatch):
    """Son dos casos, y la serie en otra divisa sigue fuera con el suyo, tambien para un liberado."""
    monkeypatch.setenv(VARIABLE, ",".join(ISINS))

    class _Lector:
        def get_price_series(self, asset_id):
            return [{"schema_version": "asset-price-series.v1.2", "currency": "USD", "points": [{"date": "2026-01-02", "value": 10.0}]}]

    repository._clear_price_series_cache()
    with pytest.raises(repository.PriceSeriesProblem) as problema:
        repository._load_asset_returns(_Lector(), ISINS[0], {}, "3Y")
    assert problema.value.reason == "FX_SERIES_MISSING"
    repository._clear_price_series_cache()


def test_una_marca_de_reparacion_futura_manda_sobre_la_liberacion(monkeypatch):
    monkeypatch.setenv(VARIABLE, ",".join(ISINS))
    pendiente = {"metadata": {"price_history_sync": {"status": "REPAIR_REQUIRED"}}}
    assert adjustment_problem(DE_AJUSTE[0], [pendiente]) == "PRICE_ADJUSTMENT_QUARANTINE"


def test_el_motivo_de_la_cuarentena_lo_conoce_el_contrato():
    assert repository.MOTIVO_CUARENTENA_DE_DIVISA in repository.EXCLUSION_REASONS
    assert repository.PriceSeriesProblem(repository.MOTIVO_CUARENTENA_DE_DIVISA).reason == repository.MOTIVO_CUARENTENA_DE_DIVISA


def test_el_ejemplo_de_entorno_sigue_en_blanco():
    """Una instalacion nueva nace en cuarentena; lo que libera es una decision de quien despliega."""
    with open(os.path.join(os.path.dirname(__file__), "..", ".env.example"), encoding="utf-8") as fichero:
        lineas = [linea.strip() for linea in fichero if linea.strip().startswith(VARIABLE)]
    assert lineas == [VARIABLE + "="]
