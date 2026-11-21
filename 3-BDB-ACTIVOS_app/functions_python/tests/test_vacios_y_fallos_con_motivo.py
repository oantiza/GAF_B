# -*- coding: utf-8 -*-
"""Hallazgos 11 y 15 de la auditoria del backend (15-11-2026).

11 · Lo que no se puede calcular sale vacio (None), nunca como un cero. Una correlacion con una serie plana -un precio
congelado- no existe: la formula divide por una desviacion cero. Un Sharpe con volatilidad cero, tampoco. Un 0 seria una
cifra real («sin correlacion», «no compensa el riesgo») y no lo es.

15 · Los fallos del calculo llegan con su motivo. Si la historia de UN activo no se puede completar con su referencia, ese
activo se aparta (REFERENCE_LINK_FAILED) y la cartera se mide con el resto. Si el optimizador falla por dentro, el asesor
recibe el error con mensaje (OptimizationError, que main.py convierte en FAILED_PRECONDITION), no un error interno.

Y para una cartera normal ninguna cifra cambia: se comprueba contra la cuenta de antes escrita aqui.

Las series son inventadas, con las de `test_maximo_sharpe_una_sola_cartera`. Cada cifra fijada sale de una cuenta escrita en
la propia prueba.

Ejecuta: pytest functions_python/tests/test_vacios_y_fallos_con_motivo.py
"""
from datetime import date
import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import portfolio_horizon as h  # noqa: E402
from optimization import repository as repo  # noqa: E402
from optimization import robust_engine as motor  # noqa: E402
from optimization import improvement_engine as mejora  # noqa: E402
import test_maximo_sharpe_una_sola_cartera as base  # noqa: E402
import test_improvement_engine as base_mejora  # noqa: E402

HOY = base.HOY
REFERENCIA = "IE000DR59CI3"  # un activo con referencia validada en analytical_references.json


@pytest.fixture(autouse=True)
def cache_limpia():
    repo._clear_price_series_cache()
    yield
    repo._clear_price_series_cache()


def aplanar(lector, aid, valor=100.0):
    """La serie entera a un mismo precio: varianza cero."""
    lector.series[aid] = [{"date": p["date"], "value": valor} for p in lector.series[aid]]


def simular(lector, pesos, ventana="3Y"):
    return h.analyze_horizon(
        lector, {"window": ventana, "positions": [{"asset_id": a, "weight": w} for a, w in pesos.items()]},
        today=HOY, risk_free_resolver=base.tipo_libre)


def simulacion_suelta(lector, pesos, period="3Y"):
    return repo.backtest_portfolio(
        lector, {"positions": [{"asset_id": a, "weight": w} for a, w in pesos.items()], "period": period, "frequency": "WEEKLY"},
        risk_free_resolver=lambda inicio, fin: {"rate": base.TIPO_LIBRE, "coverage_ratio": 1.0})


# --- 11 · correlaciones ------------------------------------------------------------------------------------------

def test_simulacion_suelta_la_correlacion_con_una_serie_plana_sale_vacia_y_la_diagonal_es_uno():
    lector = base.universo(n=3)
    aplanar(lector, "ACTIVO01")
    salida = simulacion_suelta(lector, {"ACTIVO00": 0.4, "ACTIVO01": 0.3, "ACTIVO02": 0.3})
    ids = salida["asset_ids"]
    corr = salida["correlation_matrix"]
    plano = ids.index("ACTIVO01")
    for i in range(len(ids)):
        assert corr[i][i] == 1.0
        if i != plano:
            assert corr[i][plano] is None and corr[plano][i] is None
    # Entre los otros dos sigue habiendo una correlacion de verdad, un numero.
    a, b = [i for i in range(len(ids)) if i != plano]
    assert isinstance(corr[a][b], float) and -1.0 <= corr[a][b] <= 1.0


def test_simular_la_correlacion_con_una_serie_plana_sale_vacia_y_la_diagonal_es_uno():
    lector = base.universo(n=3)
    aplanar(lector, "ACTIVO02")
    corr = simular(lector, {"ACTIVO00": 0.4, "ACTIVO01": 0.3, "ACTIVO02": 0.3})["backtest"]["correlation_matrix"]
    assert [corr[i][i] for i in range(3)] == [1.0, 1.0, 1.0]
    assert corr[0][2] is None and corr[2][0] is None and corr[1][2] is None and corr[2][1] is None
    assert isinstance(corr[0][1], float)


def test_mejorar_la_correlacion_con_una_serie_plana_sale_vacia():
    plana = [100.0] * 20
    corr, _tracking = mejora.pair_statistics(base_mejora.levels(0.001, 1, n=20), plana)
    assert corr is None
    # Menos de tres semanas: tampoco se puede calcular.
    assert mejora.pair_statistics([100.0, 101.0, 100.5], [100.0, 99.0, 99.5])[0] is None


def test_mejorar_un_candidato_sin_correlacion_calculable_queda_no_evaluable_con_su_motivo():
    plana = [100.0] * (base_mejora.WEEKS + 1)
    data = base_mejora.build({"A": base_mejora.levels(0.0010, 1), "B": base_mejora.levels(0.0008, 2), "A2": plana},
                             base_mejora.ORIGINAL, {"A": ["A2"]}, labels=base_mejora.LABELS)
    salida = mejora.improve_portfolio(data)
    rechazado = salida["rejected_candidates"]["A"][0]
    assert rechazado["asset_id"] == "A2"
    assert rechazado["reason"] == "CORRELATION_UNAVAILABLE"
    assert rechazado["not_evaluable"] is True
    assert "correlation" not in rechazado  # ni un 0 ni otra cifra


# --- 11 · Sharpe con volatilidad cero ----------------------------------------------------------------------------

def test_simulacion_suelta_con_volatilidad_cero_el_sharpe_sale_vacio_y_no_se_confunde_con_el_tramo_corto():
    lector = base.universo(n=1)
    aplanar(lector, "ACTIVO00")
    metricas = simulacion_suelta(lector, {"ACTIVO00": 1.0})["metrics"]
    # Cuenta a mano: precio constante -> rentabilidad 0, volatilidad 0; (0 - rf) / 0 no existe.
    assert metricas["volatility"] == 0.0
    assert metricas["cagr"] == pytest.approx(0.0, abs=1e-15)
    assert metricas["sharpe"] is None
    # El tramo es de 3 anos: esta anualizado. Lo que falta es el Sharpe, no la anualizacion (A-150).
    assert metricas["annualized"] is True


def test_simular_con_volatilidad_cero_el_sharpe_sale_vacio_en_la_cartera_y_en_sus_comparaciones():
    lector = base.universo(n=2)
    aplanar(lector, "ACTIVO00")
    aplanar(lector, "ACTIVO01", 50.0)
    salida = simular(lector, {"ACTIVO00": 0.5, "ACTIVO01": 0.5})
    for clave in ("backtest", "equal_weight"):
        metricas = salida[clave]["metrics"]
        assert metricas["volatility"] == 0.0
        assert metricas["sharpe"] is None
        assert metricas["cagr"] == pytest.approx(0.0, abs=1e-15)


def test_simular_una_cartera_sin_volatilidad_no_tiene_las_cuatro_cifras_de_la_comparativa():
    """`medir_con_la_serie` (Rentabilidad objetivo de Optimizar): si una cifra falta, no se manda ninguna, como antes."""
    lector = base.universo(n=2)
    aplanar(lector, "ACTIVO00")
    aplanar(lector, "ACTIVO01", 50.0)
    cargados, fuera, _ = h._leer_precios_y_raices(lector, ["ACTIVO00", "ACTIVO01"])
    periodo = h._periodo_comun(cargados, fuera, "3Y", {**h.references(), "assets": {}}, HOY)
    contexto = {"risk_free_rate": base.TIPO_LIBRE}
    assert h.medir_con_la_serie(periodo, {"ACTIVO00": 0.5, "ACTIVO01": 0.5}, "3Y", contexto) is None


def test_mejorar_con_volatilidad_cero_el_sharpe_de_la_ventana_sale_vacio():
    metricas = mejora.window_metrics([100.0] * 10, 0, 9, risk_free_rate=0.02)
    assert metricas.volatility == 0.0 and metricas.sharpe is None
    assert metricas.as_dict()["sharpe"] is None


def test_mejorar_la_comprobacion_del_sharpe_sin_dato_queda_no_evaluable_y_no_cuenta_como_mejora():
    ev = mejora._Evaluator(base_mejora.build(
        {"A": base_mejora.levels(0.0010, 1), "B": base_mejora.levels(0.0008, 2)}, base_mejora.ORIGINAL, {}, labels=base_mejora.LABELS))
    sin_sharpe = mejora.WindowMetrics(cagr=0.0, volatility=0.0, sharpe=None, max_drawdown=0.0, cumulative=0.0, weeks=100)
    con_sharpe = mejora.WindowMetrics(cagr=0.05, volatility=0.10, sharpe=0.30, max_drawdown=-0.1, cumulative=0.1, weeks=100)
    puerta = next(g for g in ev.gates(sin_sharpe, con_sharpe, "selección") if g["key"] == "sharpe_selección")
    assert puerta["status"] == "NOT_EVALUABLE"
    assert "no evaluable" in puerta["detail"]
    # Ninguna mejora de Sharpe sale de un vacio, ni en un sentido ni en el otro.
    assert all(m["key"] != "sharpe" for m in ev.improvements(sin_sharpe, con_sharpe, None, None))
    assert all(m["key"] != "sharpe" for m in ev.improvements(con_sharpe, sin_sharpe, None, None))
    # Con los dos Sharpe la puerta es la de siempre: 0,30 - 0,31 = -0,01, dentro del maximo de -0,02.
    otra = mejora.WindowMetrics(cagr=0.05, volatility=0.10, sharpe=0.31, max_drawdown=-0.1, cumulative=0.1, weeks=100)
    puerta = next(g for g in ev.gates(otra, con_sharpe, "selección") if g["key"] == "sharpe_selección")
    assert puerta["status"] == "PASS" and puerta["detail"] == "-0.01"


def test_motor_de_frontera_el_punto_con_volatilidad_cero_no_tiene_sharpe():
    punto = motor._make_point(["A", "B"], [0.5, 0.5], [0.03, 0.01], [[0.0, 0.0], [0.0, 0.0]], 0.02)
    assert punto["volatility"] == 0.0 and punto["sharpe_ratio"] is None
    # Con riesgo, la cuenta de siempre: media 0,02, varianza 0,25*0,04 + 0,25*0,09 = 0,0325.
    punto = motor._make_point(["A", "B"], [0.5, 0.5], [0.03, 0.01], [[0.04, 0.0], [0.0, 0.09]], 0.0)
    assert punto["sharpe_ratio"] == pytest.approx(0.02 / math.sqrt(0.0325))


# --- 15 · fallos con su motivo -----------------------------------------------------------------------------------

def lector_con_referencia_que_no_enlaza(monkeypatch, n=3):
    """Un activo con referencia validada cuya serie empieza meses despues de su lanzamiento: falta el inicio real y la
    referencia no se puede enlazar (`extend_history` lanza OptimizationError)."""
    monkeypatch.setenv("BDB_VERIFIED_PRICE_REPAIR_RELEASES", REFERENCIA)
    lector = base.universo(n=n)
    rng = np.random.default_rng(1)
    dias = base.laborables(date(2025, 9, 1))  # el lanzamiento de la referencia es febrero de 2025
    niveles = 100 * np.cumprod(1 + rng.normal(0.0004, 0.01, len(dias)))
    lector.series[REFERENCIA] = [{"date": d.isoformat(), "value": float(v)} for d, v in zip(dias, niveles)]
    with pytest.raises(repo.OptimizationError, match="inicio real"):
        h.extend_history(REFERENCIA, {p["date"]: p["value"] for p in lector.series[REFERENCIA]},
                         h.references()["assets"][REFERENCIA], "prueba")
    return lector


def test_simular_aparta_el_activo_cuya_referencia_no_enlaza_y_mide_el_resto(monkeypatch):
    lector = lector_con_referencia_que_no_enlaza(monkeypatch)
    pesos = {"ACTIVO00": 0.3, "ACTIVO01": 0.3, "ACTIVO02": 0.2, REFERENCIA: 0.2}
    salida = simular(lector, pesos)
    assert salida["backtest"]["excluded_assets"] == [{"asset_id": REFERENCIA, "reason": "REFERENCE_LINK_FAILED"}]
    assert salida["backtest"]["asset_ids"] == ["ACTIVO00", "ACTIVO01", "ACTIVO02"]
    # Cuenta a mano: queda medido el 80 % del peso.
    assert salida["coverage_weight_percent"] == pytest.approx(80.0)
    assert salida["extensions"] == []
    # Y las cifras son las de la cartera sin ese activo.
    sin_el = simular(base.universo(n=3), {"ACTIVO00": 0.3, "ACTIVO01": 0.3, "ACTIVO02": 0.2})
    assert salida["backtest"]["metrics"] == sin_el["backtest"]["metrics"]


def test_optimizar_aparta_el_activo_cuya_referencia_no_enlaza_y_lo_lista(monkeypatch):
    lector = lector_con_referencia_que_no_enlaza(monkeypatch)
    ids = ["ACTIVO00", "ACTIVO01", "ACTIVO02", REFERENCIA]
    salida = base.optimizar(lector, ids)
    assert {"asset_id": REFERENCIA, "reason": "REFERENCE_LINK_FAILED"} in salida["excluded_assets"]
    assert REFERENCIA not in salida["max_sharpe_portfolio"]["weights"]
    assert sum(salida["max_sharpe_portfolio"]["weights"].values()) == pytest.approx(1.0)


def test_mejorar_usa_la_misma_regla_y_lista_el_activo_apartado(monkeypatch):
    lector = lector_con_referencia_que_no_enlaza(monkeypatch)
    pesos = {"ACTIVO00": 0.3, "ACTIVO01": 0.3, "ACTIVO02": 0.2, REFERENCIA: 0.2}
    periodo, fuera, _roots, _cargados, _bundle = h.periodo_de_la_cartera(lector, pesos, "3Y", today=HOY)
    assert periodo is not None and periodo.ids == ["ACTIVO00", "ACTIVO01", "ACTIVO02"]
    assert fuera == [{"asset_id": REFERENCIA, "reason": "REFERENCE_LINK_FAILED"}]


def test_optimizar_un_fallo_del_motor_llega_como_error_con_mensaje(monkeypatch):
    lector = base.universo(n=3)
    ids = sorted(lector.series)

    def falla(*_a, **_k):
        raise RuntimeError("Optimizer violated the requested weight bounds.")

    monkeypatch.setattr(motor, "solve", falla)
    with pytest.raises(repo.OptimizationError) as error:
        base.optimizar(lector, ids)
    assert "El optimizador no ha conseguido una solución" in str(error.value)
    assert "weight bounds" not in str(error.value)  # la cocina va al registro, no al asesor
    with pytest.raises(repo.OptimizationError) as error:
        base.optimizar(lector, ids, objetivo="TARGET_RETURN", target_return=0.05)
    assert "rentabilidad objetivo" in str(error.value)


def test_optimizar_el_segundo_intento_que_tambien_falla_llega_con_mensaje(monkeypatch):
    """El caso real: los dos solvers fallan en la minima volatilidad y el motor relanza el segundo error."""
    lector = base.universo(n=3)
    import pypfopt
    clase = pypfopt.EfficientFrontier

    def min_volatility_que_falla(self, *a, **k):
        raise ValueError("solver fallido")

    monkeypatch.setattr(clase, "min_volatility", min_volatility_que_falla)
    with pytest.raises(repo.OptimizationError, match="El optimizador no ha conseguido"):
        base.optimizar(lector, sorted(lector.series))


def test_las_restricciones_imposibles_siguen_con_su_mensaje_de_siempre():
    lector = base.universo(n=3)
    ids = sorted(lector.series)
    with pytest.raises(repo.InvalidOptimizationRequest, match="candados"):
        base.optimizar(lector, ids, locked_weights={ids[0]: 0.7, ids[1]: 0.7})


# --- Una cartera normal: ninguna cifra cambia --------------------------------------------------------------------

def test_cartera_normal_las_cifras_son_las_de_la_cuenta_de_antes():
    lector = base.universo(n=4)
    pesos = {"ACTIVO00": 0.4, "ACTIVO01": 0.3, "ACTIVO02": 0.2, "ACTIVO03": 0.1}
    salida = simular(lector, pesos)
    bt = salida["backtest"]
    ids = bt["asset_ids"]
    # La correlacion de antes: np.corrcoef de los retornos semanales con los NaN a 0 (aqui no hay ninguno).
    cargados, fuera, _ = h._leer_precios_y_raices(lector, ids)
    periodo = h._periodo_comun(cargados, fuera, "3Y", {**h.references(), "assets": {}}, HOY)
    antes = np.nan_to_num(np.corrcoef(h.retornos_semanales(periodo.matrix, periodo.week_indices).T), nan=0).tolist()
    assert bt["correlation_matrix"] == antes
    # El Sharpe de antes: (CAGR - rf) / volatilidad, con default 0 que aqui no entra.
    m = bt["metrics"]
    assert m["sharpe"] == (m["cagr"] - m["rf_rate"]) / m["volatility"]
    punto = salida["frontier"]["current_portfolio"]
    assert punto["sharpe_ratio"] == (punto["expected_return"] - base.TIPO_LIBRE) / punto["volatility"]
    # La simulacion suelta: el Pearson de antes, a mano, sobre los retornos semanales que mide.
    suelta = simulacion_suelta(lector, pesos)
    sm = suelta["metrics"]
    assert sm["sharpe"] == (sm["cagr"] - sm["rf_rate"]) / sm["volatility"]
    assert all(isinstance(c, float) for fila in suelta["correlation_matrix"] for c in fila)
    # «Mejorar»: la correlacion de una pareja normal es la muestral de siempre.
    a, b = base_mejora.levels(0.001, 1), base_mejora.levels(0.0008, 2)
    ra, rb = np.diff(a) / np.asarray(a[:-1]), np.diff(b) / np.asarray(b[:-1])
    assert mejora.pair_statistics(a, b)[0] == pytest.approx(float(np.corrcoef(ra, rb)[0, 1]), abs=1e-12)
