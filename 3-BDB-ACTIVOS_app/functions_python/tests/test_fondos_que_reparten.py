# -*- coding: utf-8 -*-
"""Decisiones 8, 53, 54, 55, 57, 72 y 96: quien reparte se dibuja rotulado y no se mide, y las excepciones revisadas."""
from datetime import date, timedelta
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fund_distributions import (  # noqa: E402
    MOTIVO_REPARTE, rendimiento_12m_pct, reparte_sin_todos_los_pagos, serie_iguala_al_proveedor,
)
from fund_history_quality import _fichero_de_politicas, policy_for  # noqa: E402
import portfolio_horizon as h  # noqa: E402
import price_series_cache  # noqa: E402
from optimization.improvement_service import improve_portfolio  # noqa: E402
from optimization.repository import (  # noqa: E402
    _clear_price_series_cache, _load_asset_returns, _load_window_values, _root_exclusion_reason, backtest_portfolio,
    build_rebased_series, optimize_portfolio, OptimizationError, PriceSeriesProblem,
)
from readmodel import lector_base_nueva as lector  # noqa: E402

REPARTE = "IE0004868828"  # Barings ASEAN Frontiers, 1,72 %: reparte, sin bloqueo ni revision
NUEVE = ["DE0005318406", "FR0013460961", "IE00BYYPF581", "IE00BZ18VT34", "LU0102219945",
         "LU0162660350", "LU0321373184", "LU0404220724", "LU1095739733"]
BLOQUEADO = "LU0321373184"  # Schroder, 6,77 %: bloqueado, y revisado para dibujarlo (decision 53)
POLAR = "XS0000000001"  # politica sintetica: bloqueo sin revision (IE00BF0GL212 se desbloqueo el 11-11-2026); fixture `bloqueo_sin_revision`
FIDELITY = "LU0857700040"  # reparte; su serie ya es el valor liquidativo (decision 72)
BNY_ACC = "IE00BD5CTX77"  # acumula, y su rendimiento activa la regla (decision 55)
BNY_INFRA = "IE00BZ18VT34"  # uno de los nueve, con un punto quitado (decision 54)
ROBECO = "LU2133220793"  # bloqueo levantado (decision 57)
REPARTIO = "LU0011889846"  # Janus Henderson Euroland A2: el proveedor le registra un pago de 2021, rendimiento 0
SIN_DATO = "DE0008490962"
ETF = "IE00B3XXRP09"  # Vanguard S&P 500, con cierre ajustado y rendimiento positivo
ACUMULA = "IE0031786696"


def raiz(asset_id, tipo="FUND", rendimiento=0):
    documento = {"asset_id": asset_id, "asset_type": tipo, "identity": {"name": asset_id, "currency": "EUR"},
                 "quality": {"status": "OK"}}
    if rendimiento is not None:
        documento["performance"] = {"distributions": {"yield_12m_pct": rendimiento}}
    return documento


class Lector:
    """Diez anios de precios diarios, y una raiz por activo."""

    def __init__(self, raices):
        self.raices = raices
        self.lecturas = 0

    def get_asset(self, asset_id):
        return self.raices.get(asset_id)

    def get_price_series(self, asset_id):
        self.lecturas += 1
        puntos, dia, i = [], date(2016, 1, 4), hash(asset_id) % 7
        while dia <= date(2026, 9, 4):
            if dia.weekday() < 5:
                puntos.append({"date": dia.isoformat(), "value": 100 * math.exp(i * .0002 + .02 * math.sin(i / 13))})
                i += 1
            dia += timedelta(days=1)
        return [{"schema_version": "asset-price-series.v1.2", "currency": "EUR", "points": puntos}]


@pytest.fixture(autouse=True)
def sin_cache(bloqueo_sin_revision):
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


@pytest.fixture
def universo():
    return Lector({
        REPARTE: raiz(REPARTE, rendimiento=1.72),
        BLOQUEADO: raiz(BLOQUEADO, rendimiento=6.77),
        POLAR: raiz(POLAR, rendimiento=0),
        FIDELITY: raiz(FIDELITY, rendimiento=3.05),
        ROBECO: raiz(ROBECO, rendimiento=0),
        BNY_INFRA: raiz(BNY_INFRA, rendimiento=4.39),
        REPARTIO: raiz(REPARTIO, rendimiento=0),
        SIN_DATO: raiz(SIN_DATO, rendimiento=None),
        ETF: raiz(ETF, tipo="ETF", rendimiento=0.88),
        ACUMULA: raiz(ACUMULA, rendimiento=0),
    })


@pytest.mark.parametrize("documento, esperado", [
    (raiz(REPARTE, rendimiento=1.72), True),
    # JPMorgan Taiwan: un 0,05 %. La regla es «positivo», no «mucho».
    (raiz("LU0117843481", rendimiento=0.05), True),
    (raiz(REPARTIO, rendimiento=0), False),
    # Sin dato sigue dentro: no saber si reparte no es saber que reparte.
    (raiz(SIN_DATO, rendimiento=None), False),
    # Un ETF va con cierre ajustado, que ya incluye lo que paga.
    (raiz(ETF, tipo="ETF", rendimiento=0.88), False),
    (raiz("ES0144580Y14", tipo="STOCK", rendimiento=3.08), False),
    # La politica no entra: es lo que sacaria a 35 fondos sin el problema.
    ({**raiz(REPARTIO, rendimiento=0), "fund_profile": {"distribution_policy": "DISTRIBUTING"}}, False),
    (None, False),
    ({}, False),
    ({"asset_type": "FUND", "performance": {"distributions": None}}, False),
    ({"asset_type": "FUND", "performance": {"distributions": {"yield_12m_pct": True}}}, False),
    ({"asset_type": "FUND", "performance": {"distributions": {"yield_12m_pct": float("nan")}}}, False),
])
def test_la_regla_es_el_rendimiento_y_no_la_politica(documento, esperado):
    assert reparte_sin_todos_los_pagos(documento) is esperado


def test_el_rendimiento_se_lee_igual_en_las_dos_bases():
    assert rendimiento_12m_pct(raiz(REPARTE, rendimiento=6.8166)) == 6.8166
    assert rendimiento_12m_pct(raiz(REPARTE, rendimiento=None)) is None


def test_el_motivo_solo_sale_si_se_va_a_medir():
    documento = raiz(REPARTE, rendimiento=1.72)
    assert _root_exclusion_reason(documento, "EUR", REPARTE) == MOTIVO_REPARTE
    assert _root_exclusion_reason(documento, "EUR", REPARTE, solo_dibujo=True) is None
    # Antes que el suyo van los demas: un fondo con la calidad bloqueada en su raiz sigue bloqueado.
    bloqueado = {**documento, "quality": {"status": "BLOCKED"}}
    assert _root_exclusion_reason(bloqueado, "EUR", REPARTE) == "QUALITY_BLOCKED"


@pytest.mark.parametrize("isin", NUEVE)
def test_los_nueve_se_dibujan_y_para_medir_siguen_fuera_con_el_motivo_de_verdad(isin):
    """Decision 53: la revision abre la puerta de dibujar y ninguna otra. Fuera, y por repartir, no por «calidad»."""
    documento = raiz(isin, rendimiento=5.0)
    assert _root_exclusion_reason(documento, "EUR", isin, allow_historical=True) == MOTIVO_REPARTE
    assert _root_exclusion_reason(documento, "EUR", isin, allow_historical=True, solo_dibujo=True) is None
    # Si dejara de repartir, para medir seguiria bloqueado: lo que no sabemos de su serie no cambia por eso.
    assert _root_exclusion_reason(raiz(isin, rendimiento=0), "EUR", isin, allow_historical=True) == "QUALITY_BLOCKED"
    assert _root_exclusion_reason(raiz(isin, rendimiento=0), "EUR", isin, allow_historical=True, solo_dibujo=True) is None
    # Para dibujar, la raiz sigue mandando: una calidad bloqueada en ella no la abre ninguna revision.
    assert _root_exclusion_reason({**documento, "quality": {"status": "BLOCKED"}}, "EUR", isin, allow_historical=True, solo_dibujo=True) == "QUALITY_BLOCKED"


def test_janus_sigue_dentro_porque_su_rendimiento_es_cero():
    assert _root_exclusion_reason(raiz(REPARTIO, rendimiento=0), "EUR", REPARTIO, allow_historical=True) is None


@pytest.mark.parametrize("frecuencia", ["DAILY", "WEEKLY"])
def test_la_grafica_de_uno_bloqueado_sin_revision_no_se_dibuja_y_dice_por_que(universo, frecuencia):
    salida = build_rebased_series(universo, {"asset_ids": [POLAR], "window": "3Y", "frequency": frecuencia})
    assert salida["series"] == []
    assert salida["excluded_assets"] == [{"asset_id": POLAR, "reason": "QUALITY_BLOCKED"}]


@pytest.mark.parametrize("frecuencia", ["DAILY", "WEEKLY"])
def test_uno_de_los_nueve_dibuja_rotulado_y_para_medir_se_queda_fuera(universo, frecuencia):
    salida = build_rebased_series(universo, {"asset_ids": [BLOQUEADO, ACUMULA], "window": "3Y", "frequency": frecuencia})
    por_id = {serie["asset_id"]: serie for serie in salida["series"]}
    assert por_id[BLOQUEADO]["sin_dividendos"] is True
    assert "sin_dividendos" not in por_id[ACUMULA]
    assert salida["excluded_assets"] == []
    medida = build_rebased_series(universo, {"asset_ids": [BLOQUEADO, ACUMULA], "window": "3Y", "frequency": frecuencia, "para_medir": True})
    assert [serie["asset_id"] for serie in medida["series"]] == [ACUMULA]
    assert medida["excluded_assets"] == [{"asset_id": BLOQUEADO, "reason": MOTIVO_REPARTE}]


@pytest.mark.parametrize("frecuencia", ["DAILY", "WEEKLY"])
def test_a_rendimiento_cero_conserva_el_rotulo_y_no_vuelve_al_calculo(frecuencia):
    """Si el dato del rendimiento bajara a cero, la linea seguiria siendo la misma: el rotulo lo fija la revision."""
    lee = Lector({BLOQUEADO: raiz(BLOQUEADO, rendimiento=0)})
    salida = build_rebased_series(lee, {"asset_ids": [BLOQUEADO], "window": "3Y", "frequency": frecuencia})
    assert salida["series"][0]["sin_dividendos"] is True
    medida = build_rebased_series(lee, {"asset_ids": [BLOQUEADO], "window": "3Y", "frequency": frecuencia, "para_medir": True})
    assert medida["series"] == []
    assert medida["excluded_assets"] == [{"asset_id": BLOQUEADO, "reason": "QUALITY_BLOCKED"}]


def _no_se_puede_medir(lee, isin):
    root = lee.get_asset(isin)
    for leer in (_load_asset_returns, _load_window_values):
        with pytest.raises(PriceSeriesProblem) as problema:
            leer(lee, isin, root, "3Y")
        assert problema.value.reason == "PRICE_SERIES_MISSING"
    assert price_series_cache.cached_price_series(lee, isin) == []
    medida = build_rebased_series(lee, {"asset_ids": [isin], "window": "3Y", "frequency": "DAILY", "para_medir": True})
    assert medida["series"] == []
    # Y medir no deja la serie en la cache.
    assert price_series_cache.cached_price_series(lee, isin) == []
    with pytest.raises(PriceSeriesProblem):
        _load_asset_returns(lee, isin, lee.get_asset(isin), "3Y")


def test_dibujar_y_luego_medir_en_el_mismo_proceso_no_filtra_la_cache(universo):
    assert build_rebased_series(universo, {"asset_ids": [BLOQUEADO], "window": "3Y", "frequency": "DAILY"})["series"]
    assert build_rebased_series(universo, {"asset_ids": [BLOQUEADO], "window": "3Y", "frequency": "WEEKLY"})["series"]
    _no_se_puede_medir(universo, BLOQUEADO)


def test_medir_y_luego_dibujar_tampoco_se_pisan(universo):
    _no_se_puede_medir(universo, BLOQUEADO)
    assert build_rebased_series(universo, {"asset_ids": [BLOQUEADO], "window": "3Y", "frequency": "DAILY"})["series"]


def test_una_serie_reparada_se_relee_tambien_para_dibujar(universo):
    build_rebased_series(universo, {"asset_ids": [BLOQUEADO], "window": "3Y", "frequency": "DAILY"})
    universo.lecturas = 0
    build_rebased_series(universo, {"asset_ids": [BLOQUEADO], "window": "3Y", "frequency": "DAILY"})
    assert universo.lecturas == 0
    price_series_cache.invalidate_price_series_cache(BLOQUEADO)
    build_rebased_series(universo, {"asset_ids": [BLOQUEADO], "window": "3Y", "frequency": "DAILY"})
    assert universo.lecturas == 1


@pytest.mark.parametrize("base", ["vieja", "nueva"])
def test_el_punto_de_bny_no_se_ensena_y_sus_vecinos_si(base):
    """Decision 54, con los valores de la base: +5,24 % y al dia siguiente -4,08 %. Sin ese punto, de 0,9893 a 0,9986: +0,94 %."""
    puntos = [{"date": "2025-01-31", "value": 0.9893}, {"date": "2025-02-04", "value": 1.0411}, {"date": "2025-02-05", "value": 0.9986}, {"date": "2025-02-06", "value": 0.9959}]
    documento = {"schema_version": "asset-price-series.v1.2", "currency": "EUR", "points": puntos}

    class Uno(Lector):
        def get_price_series(self, asset_id):
            return [documento] if base == "vieja" else [lector.documento_de_serie_viejo({"instrument_id": asset_id, "currency": "EUR", "price_class": "NAV", "points": puntos})]

    lee = Uno({BNY_INFRA: raiz(BNY_INFRA, rendimiento=4.39)})
    salida = build_rebased_series(lee, {"asset_ids": [BNY_INFRA], "window": "3Y", "frequency": "DAILY"})
    assert salida["dates"] == ["2025-01-31", "2025-02-05", "2025-02-06"]
    assert salida["series"][0]["values"] == pytest.approx([100.0, 100.9401, 100.6671], abs=0.0001)
    # La nota dice por que y que no se ha contrastado, y el documento de origen no se toca.
    assert policy_for(BNY_INFRA)["excluded_dates"] == ["2025-02-04"]
    assert policy_for(BNY_INFRA)["excluded_dates_notes"]["2025-02-04"]["reason"] == "supuesto VL erróneo; sin contraste con la gestora"
    assert len(puntos) == 4


# ------------------------------------------------------------------ Fidelity: como los demas que reparten (decision 72)


@pytest.mark.parametrize("frecuencia", ["DAILY", "WEEKLY"])
def test_fidelity_se_dibuja_rotulado_y_para_medir_se_queda_fuera(universo, frecuencia):
    salida = build_rebased_series(universo, {"asset_ids": [FIDELITY, ACUMULA], "window": "3Y", "frequency": frecuencia})
    por_id = {serie["asset_id"]: serie for serie in salida["series"]}
    assert por_id[FIDELITY]["sin_dividendos"] is True
    assert "sin_dividendos" not in por_id[ACUMULA]
    assert salida["excluded_assets"] == []
    medida = build_rebased_series(universo, {"asset_ids": [FIDELITY, ACUMULA], "window": "3Y", "frequency": frecuencia, "para_medir": True})
    assert [serie["asset_id"] for serie in medida["series"]] == [ACUMULA]
    assert medida["excluded_assets"] == [{"asset_id": FIDELITY, "reason": MOTIVO_REPARTE}]


def test_fidelity_ya_no_tiene_una_revision_que_lo_deje_fuera_de_todo():
    assert FIDELITY not in _fichero_de_politicas()["reviews"]
    documento = raiz(FIDELITY, rendimiento=3.05)
    assert _root_exclusion_reason(documento, "EUR", FIDELITY, allow_historical=True) == MOTIVO_REPARTE
    assert _root_exclusion_reason(documento, "EUR", FIDELITY, allow_historical=True, solo_dibujo=True) is None


def test_fidelity_no_queda_bajo_una_politica(universo):
    """No es un bloqueo: su serie ya es el valor liquidativo, y la ficha de datos no cambia de rebote."""
    assert policy_for(FIDELITY) == {}


def test_una_cartera_con_fidelity_lo_deja_fuera_con_su_motivo(universo):
    resultado = h.analyze_horizon(universo, {"window": "3Y", "positions": [
        {"asset_id": FIDELITY, "weight": 12}, {"asset_id": ACUMULA, "weight": 44}, {"asset_id": REPARTIO, "weight": 44},
    ]}, today=date(2026, 9, 6))
    assert resultado["coverage_weight_percent"] == pytest.approx(88.0)
    assert {"asset_id": FIDELITY, "reason": MOTIVO_REPARTE} in resultado["backtest"]["excluded_assets"]
    assert {"asset_id": FIDELITY, "reason": MOTIVO_REPARTE} in resultado["frontier"]["excluded_assets"]


def test_si_toda_la_cartera_es_fidelity_dice_lo_mismo_que_quien_reparte(universo):
    with pytest.raises(OptimizationError, match="Todas las posiciones reparten"):
        backtest_portfolio(universo, {"positions": [{"asset_id": FIDELITY, "weight": 1}], "period": "3Y", "frequency": "DAILY"})
    with pytest.raises(OptimizationError, match="Todas las posiciones reparten"):
        h.analyze_horizon(universo, {"window": "3Y", "positions": [{"asset_id": FIDELITY, "weight": 1}]}, today=date(2026, 9, 6))


# ------------------------------------------------------------------ Robeco y Polar (decision 57)


def test_robeco_vuelve_a_todo_sin_rotulo_y_con_lo_revisado_anotado(universo):
    assert policy_for(ROBECO) == {}
    assert _fichero_de_politicas()["reviews"][ROBECO]["evidence"].endswith("#lu2133220793")
    assert _root_exclusion_reason(raiz(ROBECO, rendimiento=0), "EUR", ROBECO) is None
    salida = build_rebased_series(universo, {"asset_ids": [ROBECO], "window": "3Y", "frequency": "DAILY", "para_medir": True})
    assert salida["excluded_assets"] == []
    assert "sin_dividendos" not in salida["series"][0]
    resultado = h.analyze_horizon(universo, {"window": "3Y", "positions": [
        {"asset_id": ROBECO, "weight": 30}, {"asset_id": ACUMULA, "weight": 70},
    ]}, today=date(2026, 9, 6))
    assert resultado["coverage_weight_percent"] == pytest.approx(100.0)
    assert sorted(resultado["backtest"]["asset_ids"]) == sorted([ROBECO, ACUMULA])
    assert resultado["frontier"]["excluded_assets"] == []


def test_polar_sigue_bloqueado_para_todo(universo):
    assert policy_for(POLAR)["blocked"] is True
    assert "draw_after_review" not in policy_for(POLAR)
    assert _root_exclusion_reason(raiz(POLAR, rendimiento=0), "EUR", POLAR, allow_historical=True, solo_dibujo=True) == "QUALITY_BLOCKED"
    assert _root_exclusion_reason(raiz(POLAR, rendimiento=0), "EUR", POLAR, allow_historical=True) == "QUALITY_BLOCKED"


# ------------------------------------------------------------------ la clase cuya serie ya iguala al proveedor (decision 55)


def retornos(corte="2026-09-30", tres=10.0, cinco=10.0, diez=None):
    return {"fecha_dato": corte, "trailing_pct": {
        "3a_anualizada": {"fondo": tres}, "5a_anualizada": {"fondo": cinco}, "10a_anualizada": {"fondo": diez},
    }}


def fondo_con_retornos(isin=BNY_ACC, rendimiento=4.97, divisa="EUR", **cifras):
    documento = raiz(isin, rendimiento=rendimiento)
    documento["identity"]["currency"] = divisa
    documento["performance"]["returns"] = retornos(**cifras)
    return documento


# Hecha a mano: 100 x 1,1 elevado a k. De 2023-09-29 a 2026-09-30 sube 1,1^3 y de 2021-09-30 a 2026-09-30, 1,1^5: el 10 % al ano las dos.
# El 30-09-2023 es sabado: vale el ultimo valor liquidativo de antes.
SERIE_AL_DIEZ = [{"date": "2021-09-30", "value": 100 / 1.1}, {"date": "2023-09-29", "value": 110.0}, {"date": "2026-09-30", "value": 146.41}]
DOCUMENTOS_AL_DIEZ = [{"currency": "EUR", "points": SERIE_AL_DIEZ}]


@pytest.mark.parametrize("cifras, esperado", [
    ({}, True),
    # Hasta 0,10 puntos al ano: un dia de desfase en el cierre del mes y el redondeo.
    ({"tres": 10.09, "cinco": 9.91}, True),
    # 0,20 a 3 anios: es lo que le quedaria a quien reparte un 0,2 %, y ya no es la misma serie.
    ({"tres": 10.2}, False),
    ({"cinco": 10.2}, False),
    # Una clase que reparte un 5 % al ano: el proveedor da 5 puntos mas que la serie.
    ({"tres": 15.0, "cinco": 15.0}, False),
    # Una sola ventana no basta: no saber si iguala no es saber que iguala.
    ({"cinco": None}, False),
    ({"tres": None}, False),
    # El proveedor publica 10 anios y la serie no llega: tampoco se puede afirmar.
    ({"diez": 10.0}, False),
    # La serie termina 31 dias antes del corte.
    ({"corte": "2026-10-31"}, False),
    ({"corte": None}, False),
])
def test_la_serie_iguala_al_proveedor_resultado_hecho_a_mano(cifras, esperado):
    assert serie_iguala_al_proveedor(fondo_con_retornos(**cifras), DOCUMENTOS_AL_DIEZ) is esperado


def test_sin_cifras_sin_serie_o_en_otra_divisa_no_se_puede_afirmar():
    assert serie_iguala_al_proveedor(raiz(BNY_ACC, rendimiento=4.97), DOCUMENTOS_AL_DIEZ) is False
    assert serie_iguala_al_proveedor(fondo_con_retornos(), []) is False
    assert serie_iguala_al_proveedor(fondo_con_retornos(), None) is False
    assert serie_iguala_al_proveedor(None, DOCUMENTOS_AL_DIEZ) is False
    # La clase es de otra divisa: la del proveedor no es la de la serie, y un cuadre seria casualidad.
    assert serie_iguala_al_proveedor(fondo_con_retornos(divisa="USD"), DOCUMENTOS_AL_DIEZ) is False
    assert serie_iguala_al_proveedor(fondo_con_retornos(), [{"currency": "USD", "points": SERIE_AL_DIEZ}]) is False
    # Falta el valor liquidativo de hace cinco anios: el mas cercano esta a mas de 10 dias.
    hueco = [SERIE_AL_DIEZ[0] | {"date": "2021-09-10"}, *SERIE_AL_DIEZ[1:]]
    assert serie_iguala_al_proveedor(fondo_con_retornos(), [{"currency": "EUR", "points": hueco}]) is False


class LectorAlCincoPorCiento(Lector):
    """Crece un 5 % al anio natural, dia a dia: quien mida de fin de mes a fin de mes tiene que dar 5,00 %."""

    def get_price_series(self, asset_id):
        self.lecturas += 1
        inicio, puntos, dia = date(2016, 1, 4), [], date(2016, 1, 4)
        while dia <= date(2026, 9, 4):
            if dia.weekday() < 5:
                puntos.append({"date": dia.isoformat(), "value": 100 * 1.05 ** ((dia - inicio).days / 365.2425)})
            dia += timedelta(days=1)
        return [{"schema_version": "asset-price-series.v1.2", "currency": "EUR", "points": puntos}]


@pytest.fixture
def universo_con_acumulacion():
    return LectorAlCincoPorCiento({
        BNY_ACC: fondo_con_retornos(BNY_ACC, corte="2026-08-31", tres=5.0, cinco=5.0),
        REPARTE: fondo_con_retornos(REPARTE, rendimiento=1.72, corte="2026-08-31", tres=6.9, cinco=6.4),
        BLOQUEADO: fondo_con_retornos(BLOQUEADO, rendimiento=6.77, corte="2026-08-31", tres=5.0, cinco=5.0),
        ACUMULA: raiz(ACUMULA, rendimiento=0),
    })


@pytest.mark.parametrize("frecuencia", ["DAILY", "WEEKLY"])
def test_la_clase_que_acumula_se_dibuja_sin_rotulo_y_la_que_reparte_con_el(universo_con_acumulacion, frecuencia):
    salida = build_rebased_series(universo_con_acumulacion, {"asset_ids": [BNY_ACC, REPARTE], "window": "3Y", "frequency": frecuencia})
    por_id = {serie["asset_id"]: serie for serie in salida["series"]}
    assert "sin_dividendos" not in por_id[BNY_ACC]
    assert por_id[REPARTE]["sin_dividendos"] is True


def test_la_clase_que_acumula_entra_y_la_que_reparte_se_queda_fuera_con_su_motivo(universo_con_acumulacion):
    """Lo que Oscar pidio comprobar: en la misma cartera, uno de los nueve fuera con su motivo y BNY H Acc dentro."""
    lee = universo_con_acumulacion
    assert _root_exclusion_reason(lee.get_asset(BNY_ACC), "EUR", BNY_ACC, reader=lee) is None
    # Sin lector no se puede contrastar, y manda el rendimiento.
    assert _root_exclusion_reason(lee.get_asset(BNY_ACC), "EUR", BNY_ACC) == MOTIVO_REPARTE
    salida = backtest_portfolio(lee, {
        "positions": [{"asset_id": BLOQUEADO, "weight": .2}, {"asset_id": BNY_ACC, "weight": .2}, {"asset_id": ACUMULA, "weight": .6}],
        "period": "3Y", "frequency": "DAILY",
    }, risk_free_rate=0.02)
    assert sorted(salida["asset_ids"]) == sorted([BNY_ACC, ACUMULA])
    assert salida["excluded_assets"] == [{"asset_id": BLOQUEADO, "reason": MOTIVO_REPARTE}]
    resultado = h.analyze_horizon(lee, {"window": "3Y", "positions": [
        {"asset_id": BLOQUEADO, "weight": 20}, {"asset_id": BNY_ACC, "weight": 20}, {"asset_id": ACUMULA, "weight": 60},
    ]}, today=date(2026, 9, 6))
    assert resultado["coverage_weight_percent"] == pytest.approx(80.0)
    assert sorted(resultado["backtest"]["asset_ids"]) == sorted([BNY_ACC, ACUMULA])
    assert {"asset_id": BLOQUEADO, "reason": MOTIVO_REPARTE} in resultado["frontier"]["excluded_assets"]
    assert BNY_ACC not in [item["asset_id"] for item in resultado["frontier"]["excluded_assets"]]


def test_la_clase_que_acumula_entra_tambien_en_la_frontera_y_en_mejorar_cartera(universo_con_acumulacion):
    lee = universo_con_acumulacion
    optimizado = optimize_portfolio(lee, {
        "schema_version": "portfolio-optimization-request.v1", "base_currency": "EUR", "window": "3Y",
        "objective": "MAX_SHARPE", "asset_ids": [BNY_ACC, ACUMULA, BLOQUEADO],
    }, risk_free_rate=0.02)
    assert optimizado["excluded_assets"] == [{"asset_id": BLOQUEADO, "reason": MOTIVO_REPARTE}]
    mejora = improve_portfolio(lee, {
        "window": "3Y",
        "positions": [{"asset_id": BNY_ACC, "weight": .5}, {"asset_id": ACUMULA, "weight": .5}],
        "candidates": {ACUMULA: [REPARTE]},
    }, risk_free_rate=0.02)
    assert BNY_ACC not in (mejora.get("missing_assets") or [])
    assert {"asset_id": REPARTE, "reason": MOTIVO_REPARTE} in mejora["excluded_assets"]


def test_lo_bloqueado_no_se_contrasta_aunque_cuadre(universo_con_acumulacion):
    """Schroder con cifras que cuadrarian: sigue fuera, y ni se lee su serie para saberlo."""
    lee = universo_con_acumulacion
    lee.lecturas = 0
    assert _root_exclusion_reason(lee.get_asset(BLOQUEADO), "EUR", BLOQUEADO, reader=lee) == MOTIVO_REPARTE
    assert lee.lecturas == 0
@pytest.mark.parametrize("frecuencia", ["DAILY", "WEEKLY"])
def test_la_grafica_lo_dibuja_y_lo_marca(universo, frecuencia):
    salida = build_rebased_series(universo, {"asset_ids": [REPARTE, REPARTIO, ACUMULA], "window": "3Y", "frequency": frecuencia})
    por_id = {serie["asset_id"]: serie for serie in salida["series"]}
    assert set(por_id) == {REPARTE, REPARTIO, ACUMULA}
    assert por_id[REPARTE]["sin_dividendos"] is True
    assert "sin_dividendos" not in por_id[REPARTIO]
    assert "sin_dividendos" not in por_id[ACUMULA]
    assert salida["excluded_assets"] == []


@pytest.mark.parametrize("frecuencia", ["DAILY", "WEEKLY"])
def test_si_es_para_medir_se_queda_fuera_con_su_motivo(universo, frecuencia):
    salida = build_rebased_series(universo, {"asset_ids": [REPARTE, ACUMULA], "window": "3Y", "frequency": frecuencia, "para_medir": True})
    assert [serie["asset_id"] for serie in salida["series"]] == [ACUMULA]
    assert salida["excluded_assets"] == [{"asset_id": REPARTE, "reason": MOTIVO_REPARTE}]


def test_un_cliente_no_se_salta_la_regla_con_un_valor_raro(universo):
    salida = build_rebased_series(universo, {"asset_ids": [REPARTE], "window": "3Y", "para_medir": "no"})
    assert [serie["asset_id"] for serie in salida["series"]] == [REPARTE]


def test_la_simulacion_lo_deja_fuera_y_normaliza_sobre_lo_demas(universo):
    salida = backtest_portfolio(universo, {
        "positions": [{"asset_id": REPARTE, "weight": .12}, {"asset_id": ACUMULA, "weight": .44}, {"asset_id": REPARTIO, "weight": .44}],
        "period": "3Y", "frequency": "DAILY",
    }, risk_free_rate=0.02)
    assert salida["asset_ids"] == [ACUMULA, REPARTIO]
    assert salida["weights_normalized"] == {ACUMULA: pytest.approx(.5), REPARTIO: pytest.approx(.5)}
    assert salida["excluded_assets"] == [{"asset_id": REPARTE, "reason": MOTIVO_REPARTE}]
    # Y sus crisis tampoco lo cuentan: se dice que esta fuera, y por que.
    for escenario in salida["stress_scenarios"]:
        assert {"asset_id": REPARTE, "reason": MOTIVO_REPARTE} in escenario["excluded_assets"]
        assert REPARTE not in escenario["included_assets"]


def test_si_toda_la_cartera_reparte_lo_dice(universo):
    with pytest.raises(OptimizationError, match="Todas las posiciones reparten"):
        backtest_portfolio(universo, {"positions": [{"asset_id": REPARTE, "weight": 1}], "period": "3Y", "frequency": "DAILY"})
    with pytest.raises(OptimizationError, match="Todas las posiciones reparten"):
        h.analyze_horizon(universo, {"window": "3Y", "positions": [{"asset_id": REPARTE, "weight": 1}]}, today=date(2026, 9, 6))


def test_el_horizonte_baja_la_cobertura_al_peso_que_de_verdad_mide(universo):
    resultado = h.analyze_horizon(universo, {"window": "3Y", "positions": [
        {"asset_id": REPARTE, "weight": 12}, {"asset_id": ACUMULA, "weight": 44}, {"asset_id": REPARTIO, "weight": 44},
    ]}, today=date(2026, 9, 6))
    assert resultado["coverage_weight_percent"] == pytest.approx(88.0)
    assert resultado["backtest"]["asset_ids"] == [ACUMULA, REPARTIO]
    assert {"asset_id": REPARTE, "reason": MOTIVO_REPARTE} in resultado["backtest"]["excluded_assets"]
    assert {"asset_id": REPARTE, "reason": MOTIVO_REPARTE} in resultado["frontier"]["excluded_assets"]


def test_un_fondo_sin_dato_y_un_etf_con_cierre_ajustado_siguen_dentro(universo):
    resultado = h.analyze_horizon(universo, {"window": "3Y", "positions": [
        {"asset_id": SIN_DATO, "weight": 50}, {"asset_id": ETF, "weight": 50},
    ]}, today=date(2026, 9, 6))
    assert resultado["coverage_weight_percent"] == pytest.approx(100.0)
    assert sorted(resultado["backtest"]["asset_ids"]) == sorted([SIN_DATO, ETF])


def test_la_frontera_no_lo_usa(universo):
    resultado = optimize_portfolio(universo, {
        "schema_version": "portfolio-optimization-request.v1", "base_currency": "EUR", "window": "3Y",
        "objective": "MAX_SHARPE", "asset_ids": [REPARTE, ACUMULA, REPARTIO],
    }, risk_free_rate=0.02)
    assert {"asset_id": REPARTE, "reason": MOTIVO_REPARTE} in resultado["excluded_assets"]
    assert REPARTE not in resultado["max_sharpe_portfolio"]["weights"]
    assert resultado["coverage"]["requested_assets"] == 3 and resultado["coverage"]["included_assets"] == 2


def test_mejorar_cartera_no_lo_evalua_con_una_serie_a_la_que_faltan_pagos(universo):
    resultado = improve_portfolio(universo, {
        "window": "3Y",
        "positions": [{"asset_id": ACUMULA, "weight": .5}, {"asset_id": REPARTIO, "weight": .5}],
        "candidates": {ACUMULA: [REPARTE]},
    }, risk_free_rate=0.02)
    assert {"asset_id": REPARTE, "reason": MOTIVO_REPARTE} in resultado["excluded_assets"]


def test_una_posicion_que_reparte_se_aparta_como_en_simular_y_dice_cual(universo):
    # 15-11-2026: «Mejorar» trata las posiciones como Simular. La que reparte sin todos sus pagos se aparta, nombrada, y el
    # resto se evalua; antes dejaba la cartera entera sin evaluar.
    resultado = improve_portfolio(universo, {
        "window": "3Y",
        "positions": [{"asset_id": REPARTE, "weight": .5}, {"asset_id": ACUMULA, "weight": .5}],
        "candidates": {ACUMULA: [REPARTIO]},
    }, risk_free_rate=0.02)
    assert resultado["status"] != "INSUFFICIENT_DATA"
    assert [(e["asset_id"], e["reason"]) for e in resultado["excluded_positions"]] == [(REPARTE, MOTIVO_REPARTE)]
    assert {"asset_id": REPARTE, "reason": MOTIVO_REPARTE} in resultado["excluded_assets"]
    assert list(resultado["original"]["weights"]) == [ACUMULA]


# ------------------------------------------------------------------ la base nueva


class _Snap:
    def __init__(self, ruta, datos):
        self.id = ruta[-1]
        self.exists = datos is not None
        self._datos = datos
        self.reference = _Ref(ruta)

    def to_dict(self):
        return self._datos


class _Ref:
    def __init__(self, ruta):
        self.ruta = tuple(ruta)

    @property
    def parent(self):
        return _Ref(self.ruta[:-1])

    @property
    def id(self):
        return self.ruta[-1]

    def collection(self, nombre):
        return _Ref(self.ruta + (nombre,))

    def document(self, nombre):
        return _Ref(self.ruta + (nombre,))


class _Db:
    def __init__(self, documentos):
        self.documentos = documentos
        self.leidos = []

    def collection(self, nombre):
        return _Ref((nombre,))

    def get_all(self, referencias, **_opciones):
        salida = []
        for referencia in referencias:
            self.leidos.append("/".join(referencia.ruta))
            salida.append(_Snap(referencia.ruta, self.documentos.get("/".join(referencia.ruta))))
        return salida


FONDO_NUEVO = {"instrument_type": "FUND", "identity": {"name": "Schroder", "currency": "EUR"},
               "classification": {"category": "EAA Fund Europe Equity Income", "asset_class": "EQUITY"}}
ACCION_NUEVA = {"instrument_type": "STOCK", "identity": {"name": "Iberdrola", "currency": "EUR"},
                "classification": {"asset_class": "EQUITY"}}


def test_la_base_nueva_lo_lee_de_declared_distributions_solo_para_medir():
    db = _Db({
        f"instruments/{REPARTE}": FONDO_NUEVO,
        f"instruments/{REPARTE}/declared/distributions": {"yield_12m": 0.0677332},
        f"instruments/{REPARTIO}": FONDO_NUEVO,
        f"instruments/{REPARTIO}/declared/distributions": {"yield_12m": 0},
        f"instruments/{SIN_DATO}": FONDO_NUEVO,
        "instruments/ES0144580Y14": ACCION_NUEVA,
    })
    raices = lector.LectorOptimizacionBaseNueva(db).get_assets_many([REPARTE, REPARTIO, SIN_DATO, "ES0144580Y14"])
    assert rendimiento_12m_pct(raices[REPARTE]) == pytest.approx(6.77332)
    assert reparte_sin_todos_los_pagos(raices[REPARTE]) is True
    assert reparte_sin_todos_los_pagos(raices[REPARTIO]) is False
    assert reparte_sin_todos_los_pagos(raices[SIN_DATO]) is False
    # Una accion no pide ese documento: el suyo es declared/dividends y no es un fondo.
    assert "instruments/ES0144580Y14/declared/distributions" not in db.leidos
    # Lo que publica el proveedor solo se lee de quien tiene rendimiento: es para contrastar su serie (decision 55).
    assert f"instruments/{REPARTE}/declared/provider_returns" in db.leidos
    assert f"instruments/{REPARTIO}/declared/provider_returns" not in db.leidos
    assert f"instruments/{SIN_DATO}/declared/provider_returns" not in db.leidos

    # Buscar en el catalogo no paga esa lectura.
    db.leidos.clear()
    lector.LectorBaseNueva(db).get_assets_many([REPARTE])
    assert not [ruta for ruta in db.leidos if ruta.endswith("/distributions")]


def test_la_base_nueva_deja_lo_del_proveedor_donde_lo_lee_la_vieja():
    db = _Db({
        f"instruments/{BNY_ACC}": {"instrument_type": "FUND", "identity": {"name": "BNY", "currency": "EUR"}, "classification": {}},
        f"instruments/{BNY_ACC}/declared/distributions": {"yield_12m": 0.049654},
        f"instruments/{BNY_ACC}/declared/provider_returns": {
            "as_of": "2026-09-30", "return_basis": "TOTAL_RETURN",
            "trailing_return": {"3y": {"fund": 0.1}, "5y": {"fund": 0.1}},
        },
    })
    raiz_nueva = lector.LectorOptimizacionBaseNueva(db).get_asset(BNY_ACC)
    assert serie_iguala_al_proveedor(raiz_nueva, DOCUMENTOS_AL_DIEZ) is True
    # Si no es rentabilidad total, contrastar la serie con ella no diria nada.
    assert lector.retornos_viejos({"as_of": "2026-09-30", "return_basis": "PRICE", "trailing_return": {"3y": {"fund": 0.1}}}) == {}


def test_un_activo_que_no_esta_no_rompe_la_lectura():
    db = _Db({f"instruments/{REPARTE}": FONDO_NUEVO})
    lee = lector.LectorOptimizacionBaseNueva(db)
    assert lee.get_asset("NOESTA") is None
    assert lee.get_asset(REPARTE)["asset_type"] == "FUND"
