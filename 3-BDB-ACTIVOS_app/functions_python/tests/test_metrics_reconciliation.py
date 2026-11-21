# -*- coding: utf-8 -*-
"""Cuando el calculo propio puede sustituir a la cifra del proveedor.

La norma es calcular sobre la serie propia siempre que el calculo supere en
calidad al importado. En fondos esa condicion no se cumple sola: la serie de la
maestra es NAV bruto de EODHD, asi que en una clase de reparto el calculo pierde
el dividendo y sale entre 3 y 6 puntos por debajo. Como `yield_12m_pct` esta a
cero en 660 de 677 fondos y no sirve para separarlas, la condicion se mide: se
recalcula al mismo corte que publico el proveedor y se compara.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from metrics_reconciliation import (
    MATCH,
    MISMATCH,
    NO_BASIS,
    NO_PROVIDER,
    NO_WINDOW,
    STALE_SERIES,
    computable_labels,
    merge_windows,
    provider_cut_date,
    reconcile_windows,
    summarize,
)

CORTE = "2026-06-30"


def _raiz(divisa="EUR", **trailing):
    return {
        "identity": {"currency": divisa},
        "performance": {
            "returns": {
                "fecha_dato": CORTE,
                "trailing_pct": {clave: {"fondo": valor} for clave, valor in trailing.items()},
            }
        },
    }


def _serie(hasta=CORTE, dias=1200):
    from datetime import date, timedelta
    fin = date.fromisoformat(hasta)
    return [{"date": (fin - timedelta(days=d)).isoformat(), "value": 100.0}
            for d in range(dias, -1, -1)]


def _constructor(devuelve):
    """window_builder de mentira: devuelve la rentabilidad que se le diga."""
    def builder(points, label):
        valor = devuelve.get(label)
        return None if valor is None else {"annualized_return": valor}
    return builder


def test_un_calculo_que_reproduce_al_proveedor_es_sustituible():
    veredictos = reconcile_windows(
        _raiz(**{"3a_anualizada": 5.0}), _serie(),
        _constructor({"3y": 0.0503}), labels=("3y",))

    assert veredictos["3y"]["verdict"] == MATCH
    assert veredictos["3y"]["diff_pp"] == 0.03
    assert computable_labels(veredictos) == {"3y"}


def test_el_dividendo_perdido_de_una_clase_de_reparto_se_detecta():
    # Caso real medido: las clases con yield > 4% salen ~5,65 pp por debajo
    # porque el NAV bruto no reinvierte la distribucion.
    veredictos = reconcile_windows(
        _raiz(**{"3a_anualizada": 9.85}), _serie(),
        _constructor({"3y": 0.0392}), labels=("3y",))

    assert veredictos["3y"]["verdict"] == MISMATCH
    assert computable_labels(veredictos) == set()


def test_la_tolerancia_absorbe_el_redondeo_del_proveedor():
    veredictos = reconcile_windows(
        _raiz(**{"1a": 1.50785}), _serie(),
        _constructor({"1y": 0.0158}), labels=("1y",), tolerance_pp=1.0)

    assert veredictos["1y"]["verdict"] == MATCH


def test_sin_cifra_del_proveedor_no_hay_prueba_y_no_se_sustituye():
    # No es que el calculo este mal: es que no hay contra que contrastarlo, y
    # publicarlo seria suponer que la serie es total-return.
    veredictos = reconcile_windows(
        _raiz(), _serie(), _constructor({"5y": 0.07}), labels=("5y",))

    assert veredictos["5y"]["verdict"] == NO_PROVIDER
    assert computable_labels(veredictos) == set()


def test_una_ventana_que_el_guard_descarta_no_se_sustituye():
    veredictos = reconcile_windows(
        _raiz(**{"10a_anualizada": 4.0}), _serie(),
        _constructor({"10y": None}), labels=("10y",))

    assert veredictos["10y"]["verdict"] == NO_WINDOW
    assert computable_labels(veredictos) == set()


def test_una_clase_en_dolar_no_se_contrasta_contra_una_serie_en_euros():
    # La diferencia seria el tipo de cambio del periodo, no la calidad de la
    # serie, y un cuadre seria casualidad. Son 24 fondos en USD y uno sin divisa.
    veredictos = reconcile_windows(
        _raiz(divisa="USD", **{"1a": 107.16}), _serie(),
        _constructor({"1y": 1.1424}), labels=("1y",))

    assert veredictos["1y"]["verdict"] == NO_BASIS
    assert computable_labels(veredictos) == set()


def test_una_clase_sin_divisa_declarada_tampoco():
    veredictos = reconcile_windows(
        {"performance": {"returns": {"fecha_dato": CORTE,
                                     "trailing_pct": {"1a": {"fondo": 5.0}}}}},
        _serie(), _constructor({"1y": 0.05}), labels=("1y",))

    assert veredictos["1y"]["verdict"] == NO_BASIS


def test_una_serie_que_no_llega_al_corte_no_es_una_discrepancia():
    # El Polar Capital Healthcare acaba el 08-06 y el proveedor mide el 30-06:
    # la ventana anual quedaria desplazada tres semanas. La serie esta vieja,
    # que es un problema distinto de que este mal.
    veredictos = reconcile_windows(
        _raiz(**{"1a": 32.94}), _serie(hasta="2026-06-08"),
        _constructor({"1y": 0.1551}), labels=("1y",))

    assert veredictos["1y"]["verdict"] == STALE_SERIES
    assert computable_labels(veredictos) == set()


def test_un_retraso_de_pocos_dias_si_se_contrasta():
    # Un puente de festivos o el retraso normal del ultimo NAV no invalidan nada.
    veredictos = reconcile_windows(
        _raiz(**{"1a": 5.0}), _serie(hasta="2026-06-26"),
        _constructor({"1y": 0.0503}), labels=("1y",))

    assert veredictos["1y"]["verdict"] == MATCH


def test_sin_fecha_de_corte_del_proveedor_no_se_compara():
    raiz = {"identity": {"currency": "EUR"},
            "performance": {"returns": {"trailing_pct": {"3a_anualizada": {"fondo": 5.0}}}}}

    assert provider_cut_date(raiz) is None
    veredictos = reconcile_windows(raiz, _serie(), _constructor({"3y": 0.05}), labels=("3y",))
    assert veredictos["3y"]["verdict"] == NO_PROVIDER


def test_la_serie_se_trunca_al_corte_del_proveedor():
    # Sin truncar se compararia una ventana que llega a septiembre contra una
    # cifra del proveedor medida a 30 de junio.
    vistos = {}

    def builder(points, label):
        vistos[label] = points[-1]["date"]
        return {"annualized_return": 0.05}

    reconcile_windows(_raiz(**{"3a_anualizada": 5.0}),
                      _serie(hasta="2026-09-04", dias=1200), builder, labels=("3y",))

    assert vistos["3y"] <= CORTE


def test_el_documento_puede_quedar_mixto_y_cada_ventana_dice_de_donde_sale():
    calculadas = {"1y": {"annualized_return": 0.05, "method": "GEOMETRIC_CAGR"},
                  "3y": {"annualized_return": 0.04, "method": "GEOMETRIC_CAGR"}}
    proveedor = {"1y": {"annualized_return": 0.051, "method": "TRAILING_PROVIDER"},
                 "3y": {"annualized_return": 0.09, "method": "TRAILING_PROVIDER"},
                 "5y": {"annualized_return": 0.03, "method": "TRAILING_PROVIDER"}}

    mezcla = merge_windows(calculadas, proveedor, allowed={"1y"})

    assert mezcla["1y"]["method"] == "GEOMETRIC_CAGR"
    assert mezcla["3y"]["method"] == "TRAILING_PROVIDER"
    assert mezcla["5y"]["method"] == "TRAILING_PROVIDER"


def test_una_ventana_sin_calculo_conserva_la_del_proveedor_aunque_este_permitida():
    mezcla = merge_windows({}, {"3y": {"annualized_return": 0.09}}, allowed={"3y"})

    assert mezcla["3y"]["annualized_return"] == 0.09


def test_el_recuento_alimenta_la_pasada_en_seco():
    veredictos = reconcile_windows(
        _raiz(**{"1a": 5.0, "3a_anualizada": 9.85}), _serie(),
        _constructor({"1y": 0.0503, "3y": 0.0392}), labels=("1y", "3y", "5y"))

    assert summarize(veredictos) == {MATCH: 1, MISMATCH: 1, NO_PROVIDER: 1,
                                     NO_WINDOW: 0, NO_BASIS: 0, STALE_SERIES: 0}
