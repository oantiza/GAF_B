# -*- coding: utf-8 -*-
"""Ola 1 (1.4): a que documentos alcanza el recalculo de metrics/latest.

Dos criterios, y los dos salieron de la pasada en seco del 03-09 contra la
maestra:

1. v1.2 es un superconjunto de v1.1, asi que todo lo escrito con la formula
   anterior sigue siendo *valido*. Con el criterio original --recalcular solo lo
   invalido o ausente-- el recalculo no habria tocado nada.
2. Pero el criterio no puede ser solo "no declara method": de las 1.011 raices
   activas, 680 tienen metricas copiadas de Morningstar (FONDOSDB_ROOT_ES) que
   nunca pasaron por la formula rota.

Revision del 10-09: esas 680 SI entran, como candidatas. No porque su cifra sea
mala --se ha comprobado que no lo es-- sino porque es trailing del proveedor
mientras la de acciones y ETF es CAGR propio, y el comparador las pone en la
misma columna. La condicion sigue siendo que el calculo propio no empeore el
dato, y eso ya no se supone: se mide fondo a fondo y ventana a ventana contra la
cifra del proveedor a su mismo corte (metrics_reconciliation). La que no cuadra
se queda como esta.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from migrate_metrics_latest import (
    PRODUCED_FREQUENCIES,
    PROVIDER_FALLBACK_FUND_SOURCES,
    PROVIDER_FALLBACK_SOURCES,
    SELF_COMPUTED_SOURCES,
    _needs_recompute,
    _recompute_reason,
)

PROPIA = "FONDOSDB_EODHD_DAILY_HISTORY"
PROVEEDOR = "FONDOSDB_ROOT_ES"


def _doc(source=PROPIA, **ventanas):
    return {"source": source, "windows": ventanas}


def test_una_ventana_propia_que_anualiza_sin_declarar_metodo_es_de_la_formula_vieja():
    assert _needs_recompute(_doc(**{
        "3y": {"annualized_return": 0.11, "annualized_volatility": 0.28, "sharpe_ratio": 0.39}
    })) is True


def test_una_ventana_que_declara_metodo_ya_esta_recalculada():
    assert _needs_recompute(_doc(**{
        "3y": {"annualized_return": 0.08, "annualized_volatility": 0.28,
               "method": "GEOMETRIC_CAGR", "frequency": "WEEKLY"}
    })) is False


def test_las_cifras_del_proveedor_entran_como_candidatas():
    # Las dos entran, pero por motivos distintos y con consecuencias distintas.
    # La propia, porque arrastra la formula vieja: se reescribe siempre. La del
    # proveedor, solo como candidata: si su ventana se sustituye o no lo decide
    # despues la reconciliacion, comparando el calculo con la cifra importada.
    viejo = {"3y": {"annualized_return": 0.11, "annualized_volatility": 0.28}}
    assert _needs_recompute(_doc(source=PROPIA, **viejo)) is True
    assert _needs_recompute(_doc(source=PROVEEDOR, **viejo)) is True


def test_las_dos_rutas_de_ingesta_propia_entran():
    for source in SELF_COMPUTED_SOURCES:
        assert _needs_recompute(_doc(source=source, **{
            "1y": {"annualized_return": 0.09}
        })) is True


def test_un_source_desconocido_no_entra():
    assert _needs_recompute(_doc(source="ALGO_NUEVO", **{
        "1y": {"annualized_return": 0.09}
    })) is False
    assert _needs_recompute({"windows": {"1y": {"annualized_return": 0.09}}}) is False


def test_basta_con_que_una_ventana_venga_de_antes():
    assert _needs_recompute(_doc(**{
        "1y": {"annualized_return": 0.08, "method": "GEOMETRIC_CAGR"},
        "5y": {"annualized_return": 0.06},
    })) is True


def test_una_ventana_que_solo_publica_volatilidad_no_pide_recalculo():
    # Sin rentabilidad anualizada no hay metodo que declarar ni formula vieja
    # que corregir: es una ventana corta. (A1: siempre que su volatilidad
    # declare una frecuencia vigente; sin etiqueta es de antes de v1.2.)
    assert _needs_recompute(_doc(**{"1y": {"annualized_volatility": 0.28, "frequency": "WEEKLY"}})) is False
    assert _recompute_reason(_doc(**{"1y": {"annualized_volatility": 0.28}})) == "FREQUENCY"


def test_documento_ausente_o_sin_ventanas_no_entra_por_este_criterio():
    # Esos ya los recoge el criterio de validez/ausencia, no este.
    assert _needs_recompute(None) is False
    assert _needs_recompute({}) is False
    assert _needs_recompute(_doc()) is False


def test_el_recalculo_es_autolimitante():
    # Al reescribirse, el documento declara method y ya no vuelve a entrar.
    assert _needs_recompute(_doc(**{"3y": {"annualized_return": 0.11}})) is True
    assert _needs_recompute(_doc(**{
        "3y": {"annualized_return": 0.08, "method": "GEOMETRIC_CAGR"}
    })) is False


# ---------------------------------------------------------------------------
# Decision del 04-09: en metricas de accion manda la app.
#
# El cargador de la plataforma sigue siendo una puerta de alta viva --240 de las
# acciones entraron por el panel de la app y 74 por el cargador, que se uso el
# 03-09--, asi que no se le quita la escritura. Lo que escribe son cifras
# trailing del canonico: un puente hasta que haya serie con la que calcular las
# nuestras.
# ---------------------------------------------------------------------------

RELLENO = "FONDOSDB_STOCK_ROOT_ES"


def test_el_relleno_del_proveedor_para_acciones_se_sustituye():
    # Aunque declare metodologia y sea coherente: la app manda.
    assert _needs_recompute({
        "source": RELLENO,
        "windows": {"3y": {"annualized_return": 0.11, "method": "TRAILING_PROVIDER",
                           "frequency": "PROVIDER"}},
    }) is True


def test_las_cifras_de_fondo_del_proveedor_tambien_son_un_puente():
    # Mismo caso, poblacion distinta. Hasta ahora los fondos se quedaban fuera
    # porque la cifra de Morningstar se daba por buena sin mas. Es buena, pero
    # es TRAILING del proveedor, y mientras las acciones lleven CAGR propio el
    # comparador esta poniendo dos medidas distintas en la misma columna. Entran
    # como candidatas; la prueba de que el calculo propio las iguala se hace
    # fondo a fondo en metrics_reconciliation.
    assert _needs_recompute({
        "source": PROVEEDOR,
        "windows": {"3y": {"annualized_return": 0.11, "method": "TRAILING_PROVIDER",
                           "frequency": "PROVIDER"}},
    }) is True


def test_las_familias_de_fuente_no_se_solapan():
    assert not (SELF_COMPUTED_SOURCES & PROVIDER_FALLBACK_SOURCES)
    assert not (SELF_COMPUTED_SOURCES & PROVIDER_FALLBACK_FUND_SOURCES)
    assert not (PROVIDER_FALLBACK_SOURCES & PROVIDER_FALLBACK_FUND_SOURCES)


def test_tras_recalcular_el_relleno_deja_de_entrar():
    # El recalculo reescribe source ademas de las cifras, asi que no vuelve.
    assert _needs_recompute({
        "source": PROPIA,
        "windows": {"3y": {"annualized_return": 0.08, "method": "GEOMETRIC_CAGR",
                           "frequency": "DAILY"}},
    }) is False


# ---------------------------------------------------------------------------
# Pasadas a medias: el €STR no siempre responde.
#
# `_window_risk_free` absorbe el fallo del BCE y devuelve 0, asi que un timeout
# transitorio se convierte en un Sharpe sin descontar escrito en la maestra.
# ES0158300410 se quedo asi el 04-09 y no volvia a entrar: sus ventanas declaran
# method, y el criterio anterior las daba por buenas.
# ---------------------------------------------------------------------------


def _ventana(**extra):
    base = {"annualized_return": 0.08, "annualized_volatility": 0.2,
            "method": "GEOMETRIC_CAGR", "frequency": "WEEKLY"}
    base.update(extra)
    return base


def test_un_sharpe_sin_tasa_delata_una_pasada_fallida():
    assert _needs_recompute(_doc(**{
        "3y": _ventana(sharpe_ratio=0.4, risk_free_rate=0)
    })) is True


def test_lo_mismo_si_la_tasa_falta_del_todo():
    assert _needs_recompute(_doc(**{"3y": _ventana(sharpe_ratio=0.4)})) is True


def test_una_tasa_resuelta_no_pide_recalculo():
    assert _needs_recompute(_doc(**{
        "3y": _ventana(sharpe_ratio=0.4, risk_free_rate=0.02806086)
    })) is False


def test_una_tasa_negativa_es_una_tasa():
    # El €STR estuvo en negativo entre 2015 y 2022: una ventana larga puede
    # promediar por debajo de cero y eso no es que falte el dato.
    assert _needs_recompute(_doc(**{
        "3y": _ventana(sharpe_ratio=0.4, risk_free_rate=-0.005)
    })) is False


def test_una_ventana_sin_sharpe_no_necesita_tasa():
    # Sin Sharpe no hay nada que descontar: no falta ningun dato.
    assert _needs_recompute(_doc(**{"3y": _ventana(risk_free_rate=0)})) is False


def test_las_cifras_del_proveedor_no_entran_por_este_criterio():
    # El trailing del proveedor no declara tasa y nunca la declaro. Entra por
    # ser del proveedor, no por esto, y su ventana no se toca si no cuadra.
    assert _needs_recompute({
        "source": "FONDOSDB_STOCK_ROOT_ES",
        "windows": {"3y": {"annualized_return": 0.11, "sharpe_ratio": 0.4,
                           "method": "TRAILING_PROVIDER", "frequency": "PROVIDER"}},
    }) is True


# ---------------------------------------------------------------------------
# A1 (auditoria 29-09): criterio 4. La maestra media la volatilidad en diario
# (x252) y el resto del programa en semanal (x52). La ingesta ya mide en
# semanal; una ventana propia que declare DAILY viene de antes y se recalcula.
# ---------------------------------------------------------------------------


def test_el_calculo_de_hoy_solo_produce_semanal_o_mensual():
    assert PRODUCED_FREQUENCIES == {"WEEKLY", "MONTHLY"}


def test_una_ventana_propia_en_diario_se_recalcula():
    assert _recompute_reason(_doc(**{
        "3y": _ventana(frequency="DAILY", sharpe_ratio=0.4, risk_free_rate=0.02)
    })) == "FREQUENCY"


def test_una_ventana_propia_en_semanal_o_mensual_ya_esta_al_dia():
    assert _needs_recompute(_doc(**{"3y": _ventana(sharpe_ratio=0.4, risk_free_rate=0.02)})) is False
    assert _needs_recompute(_doc(**{
        "3y": _ventana(frequency="MONTHLY", sharpe_ratio=0.4, risk_free_rate=0.02)
    })) is False


def test_basta_una_ventana_en_diario_entre_varias_al_dia():
    assert _needs_recompute(_doc(**{
        "1y": _ventana(sharpe_ratio=0.4, risk_free_rate=0.02),
        "10y": _ventana(frequency="DAILY", sharpe_ratio=0.4, risk_free_rate=0.02),
    })) is True


def test_la_revision_de_calidad_tambien_es_calculo_propio():
    assert _needs_recompute(_doc(source="FUND_QUALITY_REVIEW_V1", **{
        "3y": _ventana(frequency="DAILY", sharpe_ratio=0.4, risk_free_rate=0.02)
    })) is True


def test_las_cifras_del_proveedor_en_frecuencia_provider_no_entran_por_frecuencia():
    # PROVIDER no es una frecuencia que produzcamos, pero el documento no es
    # nuestro: entra (o no) por su propia familia, nunca por este criterio.
    assert _recompute_reason({
        "source": "ALGO_NUEVO",
        "windows": {"3y": {"annualized_volatility": 0.2, "frequency": "PROVIDER"}},
    }) is None
    assert _recompute_reason({
        "source": PROVEEDOR,
        "windows": {"3y": {"annualized_volatility": 0.2, "frequency": "PROVIDER"}},
    }) == "PROVIDER_FALLBACK"


def test_los_motivos_anteriores_mandan_sobre_la_frecuencia():
    # Un documento con formula vieja Y diario se cuenta por la formula vieja:
    # el resumen de la pasada separa lo que quedaba de antes de lo que es A1.
    assert _recompute_reason(_doc(**{
        "3y": {"annualized_return": 0.11, "annualized_volatility": 0.28, "frequency": "DAILY"}
    })) == "NO_METHOD"
