# -*- coding: utf-8 -*-
"""Decision 40 (05-11-2026): «Maximo Sharpe» es una sola cartera, la del motor regularizado.

Optimizar (`optimize_portfolio`) y Simular (`analyze_horizon`) daban dos propuestas para la misma cartera: rejilla con
la media y la covarianza de la serie en uno, motor regularizado en el otro, y ademas sobre matrices distintas. Aqui se
llama a los dos caminos y se comparan los pesos.

Los activos son inventados. Las cifras esperadas se calculan aparte, a mano, en este fichero: Ledoit-Wolf con su
formula, la cartera de tangencia de dos activos con la suya, y una busqueda exhaustiva cuando no hay formula.
"""
from datetime import date, timedelta
import os
import random
import sys
import threading

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import portfolio_horizon as h  # noqa: E402
from optimization import repository as repo  # noqa: E402
from optimization import robust_engine as motor  # noqa: E402

HOY = date(2026, 10, 30)
TIPO_LIBRE = 0.021

# Medida el 05-11-2026 aparte, con carteras inventadas: 80 calculos con entre 2 y 24 activos, a 3 y 5 anios, con Python
# 3.12 (el del despliegue) y 3.14, en los pesos de Maximo Sharpe, minima volatilidad, nivel de riesgo 5 y todos los
# puntos de la frontera. La mayor diferencia fue 0,0: es el mismo calculo con la misma entrada.
# La tolerancia solo deja sitio al redondeo, y es mil veces menor que la centesima de punto con la que se aplica un peso.
TOLERANCIA_PESOS = 1e-9
# El solver no es exacto. Medido contra la formula en estos mismos casos: 2,6e-5 con dos activos.
TOLERANCIA_FRENTE_A_LA_FORMULA = 1e-3


@pytest.fixture(autouse=True)
def cache_limpia():
    repo._clear_price_series_cache()
    yield
    repo._clear_price_series_cache()


class Lector:
    def __init__(self, series, raices=None):
        self.series = series
        self.raices = raices or {}

    def get_asset(self, aid):
        if aid in self.raices:
            return self.raices[aid]
        return {"asset_id": aid, "asset_type": "ETF", "quality": {"status": "OK"}, "identity": {"name": aid}}

    def get_price_series(self, aid):
        return [{"schema_version": "asset-price-series.v1.2", "currency": "EUR", "interval": "1d",
                 "points": self.series.get(aid, [])}]


def laborables(desde, hasta=HOY):
    dias, dia = [], desde
    while dia <= hasta:
        if dia.weekday() < 5:
            dias.append(dia)
        dia += timedelta(days=1)
    return dias


def universo(n=6, semilla=7, desde=date(2019, 1, 1)):
    """Series diarias con un factor comun y su ruido: unas mas rentables y otras mas tranquilas."""
    rng = np.random.default_rng(semilla)
    dias = laborables(desde)
    mercado = rng.normal(0.0003, 0.007, len(dias))
    series = {}
    for i in range(n):
        beta = 0.2 + 1.1 * i / max(1, n - 1)
        ruido = rng.normal(0.00025 - 0.00002 * i, 0.002 + 0.0012 * i, len(dias))
        niveles = 100 * np.cumprod(1 + beta * mercado + ruido)
        series[f"ACTIVO{i:02d}"] = [{"date": d.isoformat(), "value": float(v)} for d, v in zip(dias, niveles)]
    return Lector(series)


def semanal(retornos, hasta=date(2026, 10, 30)):
    """Una serie de viernes con exactamente estos retornos: lo que entra en el motor se puede calcular aparte."""
    assert hasta.weekday() == 4
    niveles = [100.0]
    for r in retornos:
        niveles.append(niveles[-1] * (1 + r))
    fechas = [hasta - timedelta(days=7 * k) for k in range(len(niveles) - 1, -1, -1)]
    return [{"date": f.isoformat(), "value": v} for f, v in zip(fechas, niveles)]


def tipo_libre(inicio, fin):
    return {"rate": TIPO_LIBRE, "coverage_ratio": 1.0, "first_date": inicio, "last_date": fin, "observations": 750}


def peticion(ids, objetivo="MAX_SHARPE", ventana="3Y", **extra):
    base = {
        "schema_version": "portfolio-optimization-request.v1",
        "asset_ids": list(ids), "window": ventana, "base_currency": "EUR", "frequency": "WEEKLY", "objective": objetivo,
        "current_weights": {a: 1 / len(ids) for a in ids},
        "expected_return_model": "HISTORICAL_SHRINKAGE",
        # Lo que manda hoy la pantalla: 12 puntos y sin topes propios.
        "frontier_points": 12,
        "constraints": {"long_only": True, "fully_invested": True, "min_weight": 0, "max_weight": 1},
    }
    base.update(extra)
    return base


def optimizar(lector, ids, objetivo="MAX_SHARPE", ventana="3Y", **extra):
    return repo.optimize_portfolio(lector, peticion(ids, objetivo, ventana, **extra), today=HOY, risk_free_resolver=tipo_libre)


def simular(lector, ids, ventana="3Y"):
    return h.analyze_horizon(
        lector, {"window": ventana, "positions": [{"asset_id": a, "weight": 1 / len(ids)} for a in ids]},
        today=HOY, risk_free_resolver=tipo_libre)


def mayor_diferencia(a, b):
    assert set(a) == set(b)
    return max(abs(a[k] - b[k]) for k in a)


# --- Los dos caminos ----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("ventana", ["3Y", "5Y"])
def test_optimizar_y_simular_dan_los_mismos_pesos_de_maximo_sharpe(ventana):
    lector = universo()
    ids = sorted(lector.series)
    propuesta = optimizar(lector, ids, ventana=ventana)
    simulacion = simular(lector, ids, ventana)
    de_simular = simulacion["frontier"]["max_sharpe_portfolio"]
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], de_simular["weights"]) <= TOLERANCIA_PESOS
    # Y los pesos con los que Simular mide su Maximo Sharpe son esos.
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], simulacion["max_sharpe"]["weights_normalized"]) <= TOLERANCIA_PESOS
    # Mismas cifras del modelo, mismas fechas, mismo tipo sin riesgo, mismo tope y mismo estimador.
    for campo in ("expected_return", "volatility", "sharpe_ratio"):
        assert propuesta["max_sharpe_portfolio"][campo] == pytest.approx(de_simular[campo], abs=1e-9)
    for campo in ("first_date", "last_date", "common_observations", "included_assets"):
        assert propuesta["coverage"][campo] == simulacion["frontier"]["coverage"][campo]
    for campo in ("risk_free_rate", "weight_bounds", "covariance_estimator", "return_estimator", "optimizer"):
        assert propuesta["methodology"][campo] == simulacion["frontier"]["methodology"][campo]
    assert propuesta["as_of_date"] == simulacion["frontier"]["as_of_date"]


def test_el_orden_y_los_pesos_de_la_peticion_no_cambian_la_propuesta():
    lector = universo()
    ids = sorted(lector.series)
    base = optimizar(lector, ids)
    revueltos = list(ids)
    random.Random(3).shuffle(revueltos)
    otra = optimizar(lector, revueltos, current_weights={a: (i + 1) / 21 for i, a in enumerate(ids)}, frontier_points=5)
    assert mayor_diferencia(base["max_sharpe_portfolio"]["weights"], otra["max_sharpe_portfolio"]["weights"]) == 0
    assert len(otra["frontier"]) == len(base["frontier"])


@pytest.mark.parametrize("objetivo, clave, extra", [
    ("MIN_VOLATILITY", "min_volatility_portfolio", {}),
    ("TARGET_RISK", "target_portfolio", {"risk_slider": 5, "risk_target_mode": "FRONTIER_PERCENTILE"}),
])
def test_lo_que_se_llama_igual_en_los_dos_sitios_sigue_la_misma_regla(objetivo, clave, extra):
    lector = universo()
    ids = sorted(lector.series)
    propuesta = optimizar(lector, ids, objetivo, **extra)
    simulacion = simular(lector, ids)["frontier"]
    assert mayor_diferencia(propuesta[clave]["weights"], simulacion[clave]["weights"]) <= TOLERANCIA_PESOS
    # El Maximo Sharpe que acompana a cualquier objetivo es el mismo.
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], simulacion["max_sharpe_portfolio"]["weights"]) <= TOLERANCIA_PESOS
    assert propuesta["risk_contributions_meta"]["cov_model"] in {"LEDOIT_WOLF", "OAS"}


def test_con_lo_que_se_queda_fuera_tambien_coinciden():
    lector = universo(n=7)
    ids = sorted(lector.series)
    # Bloqueado, corto, parado y con un hueco de tres semanas: fuera en los dos. Con una semana sin dato: dentro.
    # El parado tiene su propio motivo desde la decision A-161: tiene historia, lo que le faltan son precios recientes.
    lector.raices["ACTIVO00"] = {"asset_id": "ACTIVO00", "asset_type": "ETF", "quality": {"status": "BLOCKED"}}
    lector.series["ACTIVO01"] = [p for p in lector.series["ACTIVO01"] if p["date"] > "2025-06-01"]
    lector.series["ACTIVO02"] = [p for p in lector.series["ACTIVO02"] if p["date"] < "2026-06-01"]
    lector.series["ACTIVO03"] = [p for p in lector.series["ACTIVO03"] if not "2025-03-03" <= p["date"] <= "2025-03-21"]
    lector.series["ACTIVO04"] = [p for p in lector.series["ACTIVO04"] if not "2025-03-03" <= p["date"] <= "2025-03-07"]
    propuesta = optimizar(lector, ids)
    simulacion = simular(lector, ids)
    fuera = {item["asset_id"]: item["reason"] for item in propuesta["excluded_assets"]}
    assert fuera == {"ACTIVO00": "QUALITY_BLOCKED", "ACTIVO01": "INSUFFICIENT_HISTORY",
                     "ACTIVO02": "SERIES_ENDS_EARLY", "ACTIVO03": "INSUFFICIENT_HISTORY"}
    assert fuera == {item["asset_id"]: item["reason"] for item in simulacion["backtest"]["excluded_assets"]}
    assert set(propuesta["max_sharpe_portfolio"]["weights"]) == {"ACTIVO04", "ACTIVO05", "ACTIVO06"}
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], simulacion["frontier"]["max_sharpe_portfolio"]["weights"]) <= TOLERANCIA_PESOS


def test_un_tramo_estimado_entra_en_los_dos_y_la_respuesta_lo_dice(monkeypatch):
    monkeypatch.setenv("BDB_VERIFIED_PRICE_REPAIR_RELEASES", "IE000DR59CI3")
    referencia = "IE000DR59CI3"
    lector = universo(n=3)
    rng = np.random.default_rng(1)
    dias = laborables(date(2025, 2, 10))
    niveles = 100 * np.cumprod(1 + rng.normal(0.0004, 0.01, len(dias)))
    lector.series[referencia] = [{"date": d.isoformat(), "value": float(v)} for d, v in zip(dias, niveles)]
    ids = sorted(lector.series)
    propuesta = optimizar(lector, ids)
    simulacion = simular(lector, ids)
    assert [e["asset_id"] for e in propuesta["extensions"]] == [referencia]
    assert propuesta["extensions"] == simulacion["extensions"]
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], simulacion["frontier"]["max_sharpe_portfolio"]["weights"]) <= TOLERANCIA_PESOS
    # Sin tramo estimado la respuesta lo dice igual: una lista vacia, no un campo que falta.
    assert optimizar(universo(n=3), sorted(universo(n=3).series))["extensions"] == []


def test_lo_que_ya_no_se_puede_comprar_no_se_propone_aunque_se_pueda_simular():
    lector = universo(n=4)
    ids = sorted(lector.series)
    lector.raices["ACTIVO00"] = {"asset_id": "ACTIVO00", "asset_type": "ETF",
                                 "quality": {"status": "OK", "review_flags": ["DEREGISTERED_MERGER_VERIFIED"]}}
    propuesta = optimizar(lector, ids)
    # El motivo es uno de los del contrato: uno que no conozca tiraria la respuesta entera en el cliente.
    assert propuesta["excluded_assets"] == [{"asset_id": "ACTIVO00", "reason": "NON_INVESTABLE"}]
    # Simular lo mide en la cartera, pero desde el 15-11-2026 (decision de Oscar) tampoco lo propone: su frontera es la de
    # Optimizar.
    simulacion = simular(lector, ids)
    assert "ACTIVO00" in simulacion["backtest"]["asset_ids"]
    assert "ACTIVO00" not in simulacion["frontier"]["max_sharpe_portfolio"]["weights"]
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], simulacion["frontier"]["max_sharpe_portfolio"]["weights"]) <= TOLERANCIA_PESOS


@pytest.mark.parametrize("ventana", ["3Y", "5Y"])
def test_con_un_precio_congelado_en_la_cartera_simular_y_optimizar_dan_el_mismo_maximo_sharpe(ventana, monkeypatch):
    """Una baja valorada a su ultimo precio, como NH Hotel Group: serie plana desde la congelacion y la marca en su politica.

    Simular la mide en la cartera; la frontera de los dos caminos se resuelve sin ella, y sale la misma.
    """
    import fund_history_quality
    lector = universo()
    ids = sorted(lector.series)
    congelado = "ACTIVO01"
    precio = [p["value"] for p in lector.series[congelado] if p["date"] < "2025-09-15"][-1]
    lector.series[congelado] = [p if p["date"] < "2025-09-15" else {"date": p["date"], "value": precio}
                                for p in lector.series[congelado]]
    reales = fund_history_quality.policies()
    monkeypatch.setattr(fund_history_quality, "policies", lambda: {
        **reales, congelado: {"flags": ["PRICE_FROZEN_DELISTED"], "frozen_price": {"from": "2025-09-15", "value": precio}}})
    propuesta = optimizar(lector, ids, ventana=ventana)
    simulacion = simular(lector, ids, ventana)
    assert propuesta["excluded_assets"] == [{"asset_id": congelado, "reason": "NON_INVESTABLE"}]
    assert congelado in simulacion["backtest"]["asset_ids"]
    assert simulacion["frontier_excluded_assets"] == [{"asset_id": congelado, "reason": "FROZEN_PRICE", "weight": pytest.approx(1 / 6)}]
    de_simular = simulacion["frontier"]
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], de_simular["max_sharpe_portfolio"]["weights"]) <= TOLERANCIA_PESOS
    # La simulacion del Maximo Sharpe lleva las columnas de la cartera, con cero en lo que no se puede comprar.
    simulada = simulacion["max_sharpe"]["weights_normalized"]
    assert simulada[congelado] == 0.0
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], {a: w for a, w in simulada.items() if a != congelado}) <= TOLERANCIA_PESOS
    assert mayor_diferencia(propuesta["min_volatility_portfolio"]["weights"], de_simular["min_volatility_portfolio"]["weights"]) <= TOLERANCIA_PESOS
    for campo in ("expected_return", "volatility", "sharpe_ratio"):
        assert propuesta["max_sharpe_portfolio"][campo] == pytest.approx(de_simular["max_sharpe_portfolio"][campo], abs=1e-9)
    for campo in ("first_date", "last_date", "common_observations", "included_assets"):
        assert propuesta["coverage"][campo] == de_simular["coverage"][campo]
    for campo in ("risk_free_rate", "weight_bounds", "covariance_estimator", "return_estimator", "optimizer"):
        assert propuesta["methodology"][campo] == de_simular["methodology"][campo]
    # Ningun punto de la curva de Simular lleva el congelado.
    assert all(congelado not in punto["weights"] for punto in de_simular["frontier"])


def test_a_diez_anos_la_ventana_no_se_queda_corta_por_un_activo_con_datos_mas_recientes():
    lector = universo(n=3, desde=date(2015, 1, 1))
    # Dos acaban el martes 20-10-2026 y el tercero llega al viernes 30. Desde la decision A-161 el fin lo pone el dato
    # mas reciente —antes, la mediana, que lo dejaba en el viernes 16—, y los otros dos entran: del 20 al 30 van diez
    # dias, dentro de los catorce que se puentean con su ultimo precio.
    for aid in ("ACTIVO00", "ACTIVO01"):
        lector.series[aid] = [p for p in lector.series[aid] if p["date"] <= "2026-10-20"]
    propuesta = optimizar(lector, sorted(lector.series), ventana="10Y")
    assert propuesta["excluded_assets"] == []
    assert propuesta["coverage"]["last_date"] == "2026-10-30"
    assert propuesta["methodology"]["window"] == "10Y"


def test_a_diez_anos_no_se_estima_ningun_tramo(monkeypatch):
    monkeypatch.setenv("BDB_VERIFIED_PRICE_REPAIR_RELEASES", "IE000DR59CI3")
    referencia = "IE000DR59CI3"
    lector = universo(n=3, desde=date(2015, 1, 1))
    rng = np.random.default_rng(1)
    dias = laborables(date(2025, 2, 10))
    niveles = 100 * np.cumprod(1 + rng.normal(0.0004, 0.01, len(dias)))
    lector.series[referencia] = [{"date": d.isoformat(), "value": float(v)} for d, v in zip(dias, niveles)]
    ids = sorted(lector.series)
    # A 3 anios entra con su tramo estimado, como en la simulacion. A 10 no: casi toda su serie seria estimada.
    assert [e["asset_id"] for e in optimizar(lector, ids)["extensions"]] == [referencia]
    a_diez = optimizar(lector, ids, ventana="10Y")
    assert a_diez["extensions"] == []
    assert a_diez["excluded_assets"] == [{"asset_id": referencia, "reason": "INSUFFICIENT_HISTORY"}]


# --- Resultados conocidos, calculados aparte ----------------------------------------------------------------------

def ledoit_wolf_a_mano(retornos):
    """Ledoit-Wolf (2004), objetivo identidad escalada, con su formula. Solo numpy: ni sklearn ni el motor."""
    X = np.asarray(retornos, dtype=float)
    T, N = X.shape
    X = X - X.mean(axis=0)
    empirica = X.T @ X / T
    media = np.trace(empirica) / N
    delta = np.sum((empirica - media * np.eye(N)) ** 2) / N
    beta = sum(np.sum((np.outer(x, x) - empirica) ** 2) for x in X) / (N * T * T)
    encogimiento = 0.0 if delta == 0 else min(beta, delta) / delta
    return (1 - encogimiento) * empirica + encogimiento * media * np.eye(N)


def momentos_a_mano(retornos):
    """Con menos de cuatro activos James-Stein no encoge: la media es la de la serie, anualizada."""
    X = np.asarray(retornos, dtype=float)
    return X.mean(axis=0) * 52, ledoit_wolf_a_mano(X) * 52


def tangencia_de_dos(mu, covarianza, rf=TIPO_LIBRE):
    x = np.linalg.solve(covarianza, mu - rf)
    return x / x.sum()


def retornos_de(lector, ids, inicio, fin):
    filas = []
    for aid in ids:
        puntos = [p["value"] for p in lector.series[aid] if inicio <= p["date"] <= fin]
        filas.append(np.array(puntos[1:]) / np.array(puntos[:-1]) - 1)
    return np.column_stack(filas)


def retornos_inventados(semilla, medias, vols, semanas=200, correlacion=0.3):
    rng = np.random.default_rng(semilla)
    comun = rng.normal(0, 1, semanas)
    return [[m + v * (correlacion ** 0.5 * c + (1 - correlacion) ** 0.5 * e)
             for m, v, c, e in zip(medias, vols, [comun[t]] * len(medias), rng.normal(0, 1, len(medias)))]
            for t in range(semanas)]


def lector_semanal(filas):
    ids = [f"ACTIVO{i:02d}" for i in range(len(filas[0]))]
    return Lector({aid: semanal([fila[i] for fila in filas]) for i, aid in enumerate(ids)}), ids


def test_la_formula_de_ledoit_wolf_de_esta_prueba_es_la_del_motor():
    """Si esto falla, lo que falla es la cuenta aparte, no el motor."""
    filas = retornos_inventados(5, [0.002, 0.001, 0.0015], [0.02, 0.012, 0.03])
    ids = ["A", "B", "C"]
    S, meta = motor.estimate_covariance(filas, ids)
    assert meta["covariance_estimator"] == "LEDOIT_WOLF"
    assert np.asarray(S) == pytest.approx(ledoit_wolf_a_mano(filas) * 52, abs=1e-12)


def test_dos_activos_con_la_solucion_calculada_aparte():
    filas = retornos_inventados(11, [0.0019, 0.0012], [0.021, 0.013])
    lector, ids = lector_semanal(filas)
    resultado = optimizar(lector, ids)
    observados = retornos_de(lector, ids, resultado["coverage"]["first_date"], resultado["coverage"]["last_date"])
    mu, S = momentos_a_mano(observados)
    esperado = tangencia_de_dos(mu, S)
    assert 0.4 < esperado[0] < 0.6, "para que el tope no intervenga"
    pesos = resultado["max_sharpe_portfolio"]["weights"]
    assert pesos[ids[0]] == pytest.approx(esperado[0], abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert pesos[ids[1]] == pytest.approx(esperado[1], abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert sum(pesos.values()) == pytest.approx(1, abs=1e-12)
    # Y las cifras del modelo son las de esos pesos con esos momentos.
    w = np.array([pesos[ids[0]], pesos[ids[1]]])
    assert resultado["max_sharpe_portfolio"]["expected_return"] == pytest.approx(w @ mu, abs=1e-9)
    assert resultado["max_sharpe_portfolio"]["volatility"] == pytest.approx((w @ S @ w) ** 0.5, abs=1e-9)


def test_dos_activos_si_la_solucion_pasa_del_tope_manda_el_tope():
    filas = retornos_inventados(11, [0.0035, 0.0006], [0.015, 0.015])
    lector, ids = lector_semanal(filas)
    resultado = optimizar(lector, ids)
    observados = retornos_de(lector, ids, resultado["coverage"]["first_date"], resultado["coverage"]["last_date"])
    mu, S = momentos_a_mano(observados)
    assert tangencia_de_dos(mu, S)[0] > 0.6, "sin tope pondria mas"
    # El Sharpe sube sin parar hasta la tangencia, asi que dentro de [40 %, 60 %] el mejor es el 60 %.
    pesos = resultado["max_sharpe_portfolio"]["weights"]
    assert pesos[ids[0]] == pytest.approx(0.60, abs=1e-6)
    assert pesos[ids[1]] == pytest.approx(0.40, abs=1e-6)
    assert resultado["methodology"]["weight_bounds"] == [0.0, 0.6]


@pytest.mark.parametrize("n, tope", [(2, .60), (4, .60), (5, .35), (10, .35), (11, .25), (15, .25), (16, .20), (40, .20)])
def test_el_tope_depende_del_numero_de_activos_y_nadie_lo_pasa(n, tope):
    # El tope de robust_engine.py:51-60, escrito aqui a mano. Un activo mucho mejor que el resto lo hace valer.
    medias = [0.004] + [0.0008] * (n - 1)
    filas = retornos_inventados(n, medias, [0.015] * n, semanas=170)
    lector, ids = lector_semanal(filas)
    resultado = optimizar(lector, ids)
    assert resultado["methodology"]["weight_bounds"] == [0.0, tope]
    pesos = resultado["max_sharpe_portfolio"]["weights"]
    assert pesos[ids[0]] == pytest.approx(tope, abs=1e-4)
    assert max(pesos.values()) <= tope + 1e-6
    assert min(pesos.values()) >= -1e-9
    assert sum(pesos.values()) == pytest.approx(1, abs=1e-9)


def _lo_mejor_con_un_candado(mu, S, candado, tope, paso=0.0005):
    """Tres activos, el tercero fijado: se prueba todo el reparto de los otros dos y se queda el de mayor Sharpe."""
    libre = 1 - candado
    mejor, mejor_sharpe = None, -1e9
    for primero in np.arange(max(0.0, libre - tope), min(tope, libre) + paso / 2, paso):
        w = np.array([primero, libre - primero, candado])
        sharpe = (w @ mu - TIPO_LIBRE) / (w @ S @ w) ** 0.5
        if sharpe > mejor_sharpe:
            mejor, mejor_sharpe = w, sharpe
    return mejor, mejor_sharpe


def test_un_candado_se_respeta_y_el_resto_es_el_mejor_reparto_posible():
    filas = retornos_inventados(23, [0.0017, 0.0012, 0.0006], [0.02, 0.014, 0.01])
    lector, ids = lector_semanal(filas)
    resultado = optimizar(lector, ids, locked_weights={ids[2]: 0.2})
    observados = retornos_de(lector, ids, resultado["coverage"]["first_date"], resultado["coverage"]["last_date"])
    mu, S = momentos_a_mano(observados)
    esperado, sharpe = _lo_mejor_con_un_candado(mu, S, 0.2, 0.6)
    pesos = resultado["max_sharpe_portfolio"]["weights"]
    assert pesos[ids[2]] == pytest.approx(0.2, abs=1e-12)
    assert sum(pesos.values()) == pytest.approx(1, abs=1e-12)
    assert pesos[ids[0]] == pytest.approx(esperado[0], abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert resultado["max_sharpe_portfolio"]["sharpe_ratio"] >= sharpe - 1e-5


@pytest.mark.parametrize("objetivo, clave, extra", [
    ("MAX_SHARPE", "max_sharpe_portfolio", {}),
    ("MIN_VOLATILITY", "min_volatility_portfolio", {}),
    ("TARGET_RISK", "target_portfolio", {"risk_slider": 7}),
])
def test_un_candado_por_encima_del_tope_manda_y_el_resto_se_reparte_con_su_tope(objetivo, clave, extra):
    medias = [0.0005, 0.003, 0.0028, 0.0026, 0.0024]  # lo libre quiere concentrarse: el tope lo frena
    filas = retornos_inventados(31, medias, [0.012, 0.015, 0.016, 0.017, 0.018], semanas=170)
    lector, ids = lector_semanal(filas)
    resultado = optimizar(lector, ids, objetivo, locked_weights={ids[0]: 0.5}, **extra)
    assert resultado["methodology"]["weight_bounds"] == [0.0, 0.35]
    for punto in [resultado[clave], resultado["max_sharpe_portfolio"], resultado["min_volatility_portfolio"], *resultado["frontier"]]:
        assert punto["weights"][ids[0]] == pytest.approx(0.5, abs=1e-12)
        assert max(w for a, w in punto["weights"].items() if a != ids[0]) <= 0.35 + 1e-6
        assert sum(punto["weights"].values()) == pytest.approx(1, abs=1e-9)


def test_varios_candados_con_una_sola_cartera_posible():
    filas = retornos_inventados(41, [0.002, 0.001, 0.0015], [0.02, 0.012, 0.03])
    lector, ids = lector_semanal(filas)
    resultado = optimizar(lector, ids, locked_weights={ids[0]: 0.5, ids[1]: 0.1})
    pesos = resultado["max_sharpe_portfolio"]["weights"]
    assert pesos == {ids[0]: 0.5, ids[1]: 0.1, ids[2]: pytest.approx(0.4, abs=1e-12)}


@pytest.mark.parametrize("n, candados, frases", [
    # 30 % fijado y 70 % para un activo cuyo tope es el 60 %.
    (2, [0.3], ["los candados suman 30,0 %", "1 posición libre", "tope del 60,0 %", "solo llega al 90,0 %"]),
    # Cuatro al 5 % y el que queda, con su tope del 35 %.
    (5, [0.05, 0.05, 0.05, 0.05], ["los candados suman 20,0 %", "1 posición libre", "tope del 35,0 %", "solo llega al 55,0 %"]),
    # Cinco al 2 % y dos libres al 35 %: 80 %.
    (7, [0.02] * 5, ["los candados suman 10,0 %", "2 posiciones libres", "solo llegan al 80,0 %"]),
    # Todo fijado y no llega.
    (3, [0.2, 0.2, 0.2], ["todas las posiciones tienen candado", "60,0 %"]),
    # Se pasa.
    (3, [0.7, 0.7], ["los candados suman 140,0 %"]),
])
def test_si_no_hay_solucion_se_dice_con_sus_cifras_y_no_se_devuelve_otra_cosa(n, candados, frases):
    filas = retornos_inventados(n + 50, [0.002] * n, [0.02] * n, semanas=170)
    lector, ids = lector_semanal(filas)
    with pytest.raises(repo.InvalidOptimizationRequest) as error:
        optimizar(lector, ids, locked_weights=dict(zip(ids, candados)))
    assert str(error.value).startswith("Sin solución:")
    for frase in frases:
        assert frase in str(error.value)


def test_una_rotacion_que_no_alcanza_lo_dice_con_su_cifra():
    # Un 50 % con un tope del 35 % tiene que soltar 15 puntos, y solo se dejan mover 5 (10 en la suma de diferencias).
    filas = retornos_inventados(66, [0.002] * 5, [0.02] * 5, semanas=170)
    lector, ids = lector_semanal(filas)
    actuales = {ids[0]: 0.5, **{a: 0.125 for a in ids[1:]}}
    with pytest.raises(repo.InvalidOptimizationRequest, match="Sin solución: una rotación máxima del 5,0 % del patrimonio no alcanza"):
        optimizar(lector, ids, "TARGET_RISK", risk_slider=5, current_weights=actuales, constraints={"max_turnover": 0.1})
    # Con 15 puntos, justo lo que hace falta, sí.
    resultado = optimizar(lector, ids, "TARGET_RISK", risk_slider=5, current_weights=actuales, constraints={"max_turnover": 0.3002})
    assert resultado["target_portfolio"]["weights"][ids[0]] == pytest.approx(0.35, abs=1e-4)


@pytest.mark.parametrize("objetivo, extra", [
    ("MAX_SHARPE", {"constraints": {"max_weight": 0.2}}),
    ("TARGET_RETURN", {"target_return": 5.0}),
])
def test_lo_que_no_tiene_solucion_empieza_igual_en_todos_los_objetivos(objetivo, extra):
    # Ese comienzo es lo que hace que la pantalla lo enseñe tal cual (PREFIJO_SIN_SOLUCION, src/types/portfolioFrontier.ts).
    lector = universo(n=3)
    with pytest.raises(repo.InvalidOptimizationRequest) as error:
        optimizar(lector, sorted(lector.series), objetivo, **extra)
    assert str(error.value).startswith("Sin solución:")


def test_un_maximo_escrito_por_el_asesor_manda_sobre_el_tope_del_modelo():
    medias = [0.004, 0.0009, 0.0009, 0.0009, 0.0009]
    filas = retornos_inventados(61, medias, [0.015] * 5, semanas=170)
    lector, ids = lector_semanal(filas)
    # Por debajo y por encima del 35 % que pondria el modelo con cinco activos.
    for maximo in (0.25, 0.5):
        resultado = optimizar(lector, ids, constraints={"max_weight": maximo})
        assert resultado["methodology"]["weight_bounds"] == [0.0, maximo]
        pesos = resultado["max_sharpe_portfolio"]["weights"]
        assert pesos[ids[0]] == pytest.approx(maximo, abs=1e-4)
        assert sum(pesos.values()) == pytest.approx(1, abs=1e-9)


@pytest.mark.parametrize("maximo, candado", [(0.3, 0.4)])
def test_un_candado_por_encima_del_maximo_que_escribio_el_asesor_se_dice(maximo, candado):
    filas = retornos_inventados(62, [0.002] * 5, [0.02] * 5, semanas=170)
    lector, ids = lector_semanal(filas)
    with pytest.raises(repo.InvalidOptimizationRequest, match="Sin solución: el candado de ACTIVO00 .40,0 %. supera el máximo por activo que has escrito .30,0 %."):
        optimizar(lector, ids, locked_weights={ids[0]: candado}, constraints={"max_weight": maximo})


def test_un_candado_sin_historico_no_se_quita_en_silencio():
    filas = retornos_inventados(63, [0.002] * 4, [0.02] * 4, semanas=170)
    lector, ids = lector_semanal(filas)
    lector.series[ids[0]] = []
    with pytest.raises(repo.InvalidOptimizationRequest, match="Sin solución: ACTIVO00 tiene candado y se queda fuera"):
        optimizar(lector, ids, locked_weights={ids[0]: 0.2})


def test_un_candado_en_lo_bloqueado_por_calidad_tampoco_se_quita_en_silencio():
    filas = retornos_inventados(63, [0.002] * 4, [0.02] * 4, semanas=170)
    lector, ids = lector_semanal(filas)
    lector.raices[ids[0]] = {"asset_id": ids[0], "asset_type": "ETF", "quality": {"status": "BLOCKED"}}
    with pytest.raises(repo.InvalidOptimizationRequest, match="Sin solución: ACTIVO00 tiene candado y se queda fuera"):
        optimizar(lector, ids, locked_weights={ids[0]: 0.2})


@pytest.mark.parametrize("objetivo, extra", [("MAX_SHARPE", {}), ("TARGET_RETURN", {"target_return": 0.05})])
def test_un_candado_que_no_entra_en_la_peticion_lo_dice(objetivo, extra):
    # La pantalla manda todos los candados, y en el calculo entran 40 activos.
    filas = retornos_inventados(63, [0.002] * 4, [0.02] * 4, semanas=170)
    lector, ids = lector_semanal(filas)
    with pytest.raises(repo.InvalidOptimizationRequest, match="Sin solución: OTRO tiene candado y no entra en el cálculo"):
        optimizar(lector, ids, objetivo, locked_weights={"OTRO": 0.2}, **extra)


def test_el_limite_por_grupo_y_la_rotacion_siguen_respetandose():
    filas = retornos_inventados(64, [0.003, 0.0028, 0.0026, 0.001, 0.0008, 0.0007], [0.015] * 6, semanas=170)
    lector, ids = lector_semanal(filas)
    for i, aid in enumerate(ids):
        lector.raices[aid] = {"asset_id": aid, "asset_type": "ETF", "quality": {"status": "OK"},
                              "classification": {"asset_class": "RV" if i < 3 else "RF"}}
    con_grupo = optimizar(lector, ids, group_constraints=[{"dimension": "asset_class", "upper": {"RV": 0.5}}])
    assert sum(w for a, w in con_grupo["max_sharpe_portfolio"]["weights"].items() if a in ids[:3]) <= 0.5 + 1e-4
    actuales = {a: 1 / 6 for a in ids}
    con_rotacion = optimizar(lector, ids, "TARGET_RISK", risk_slider=8, current_weights=actuales,
                             constraints={"max_turnover": 0.2})
    for clave in ("target_portfolio", "max_sharpe_portfolio", "min_volatility_portfolio"):
        pesos = con_rotacion[clave]["weights"]
        # Una centesima de punto de holgura: lo que se puede pasar el solver, medido en 5e-6.
        assert sum(abs(pesos[a] - actuales[a]) for a in ids) <= 0.2 + 1e-4, clave


def test_si_ninguna_cartera_supera_el_tipo_sin_riesgo_lo_avisa_y_los_dos_caminos_dicen_lo_mismo():
    # Rentabilidades por debajo del tipo: maximizar un Sharpe negativo premiaria el riesgo.
    filas = retornos_inventados(65, [-0.004, -0.003, -0.005], [0.01, 0.012, 0.015], semanas=170)
    lector, ids = lector_semanal(filas)
    propuesta = optimizar(lector, ids)
    simulacion = simular(lector, ids)["frontier"]
    assert "MAX_SHARPE_UNDEFINED_FALLBACK" in propuesta["warnings"]
    assert propuesta["max_sharpe_portfolio"]["sharpe_ratio"] <= 0
    assert propuesta["max_sharpe_portfolio"]["weights"] == propuesta["min_volatility_portfolio"]["weights"]
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], simulacion["max_sharpe_portfolio"]["weights"]) <= TOLERANCIA_PESOS


def _antes_de_que_pasen(segundos, calculo):
    """Si el calculo se queda colgado, la prueba falla en vez de colgarse con el."""
    resultado = {}
    hilo = threading.Thread(target=lambda: resultado.update(valor=calculo()), daemon=True)
    hilo.start()
    hilo.join(segundos)
    assert not hilo.is_alive(), f"No ha terminado en {segundos} s"
    assert "valor" in resultado, "Ha fallado"
    return resultado["valor"]


def filas_que_dejan_al_cla_en_un_ciclo():
    # Con estas, el CLA de PyPortfolioOpt 1.6.0 no sale de su `while True`.
    rng = np.random.default_rng(0)
    comun, comun2 = rng.normal(0.001, 0.015, 262), rng.normal(0.0002, 0.006, 262)
    columnas = [rng.uniform(0, 1) * comun + rng.uniform(0, 1) * comun2 + rng.normal(rng.uniform(-0.0003, 0.001), rng.uniform(0.0005, 0.006), 262) for _ in range(24)]
    return np.column_stack(columnas).tolist()


def test_si_el_cla_no_termina_el_motor_sale_por_qp():
    filas = filas_que_dejan_al_cla_en_un_ciclo()
    ids = [f"ACTIVO{i:02d}" for i in range(24)]
    resultado = _antes_de_que_pasen(120, lambda: motor.solve(ids, filas, objective="MAX_SHARPE", frontier_points=40, risk_free_rate=TIPO_LIBRE))
    assert resultado["methodology_extra"]["optimizer"] == "QP"
    assert resultado["methodology_extra"]["weight_bounds"] == [0.0, 0.2]
    assert len(resultado["frontier"]) >= 3
    pesos = resultado["max_sharpe_portfolio"]["weights"]
    assert sum(pesos.values()) == pytest.approx(1, abs=1e-9)
    assert max(pesos.values()) <= 0.2 + 1e-6
    # El Maximo Sharpe no sale del CLA, asi que abandonarlo no lo pierde.
    assert "MAX_SHARPE_UNDEFINED_FALLBACK" not in resultado["warnings"]


def test_el_tope_del_cla_no_molesta_a_quien_termina():
    filas = retornos_inventados(5, [0.002, 0.001, 0.0015, 0.0012, 0.0008], [0.02, 0.012, 0.03, 0.018, 0.01], semanas=170)
    ids = [f"ACTIVO{i:02d}" for i in range(5)]
    cla = motor.solve(ids, filas, objective="MAX_SHARPE", frontier_points=40, risk_free_rate=TIPO_LIBRE)
    assert cla["methodology_extra"]["optimizer"] == "CLA"


def test_quien_pasa_el_tope_del_cla_da_el_mismo_maximo_sharpe_por_qp(monkeypatch):
    filas = retornos_inventados(5, [0.002, 0.001, 0.0015, 0.0012, 0.0008], [0.02, 0.012, 0.03, 0.018, 0.01], semanas=170)
    ids = [f"ACTIVO{i:02d}" for i in range(5)]
    cla = motor.solve(ids, filas, objective="MAX_SHARPE", frontier_points=40, risk_free_rate=TIPO_LIBRE)
    monkeypatch.setattr(motor, "CLA_LLAMADAS_POR_ACTIVO", 0)
    qp = motor.solve(ids, filas, objective="MAX_SHARPE", frontier_points=40, risk_free_rate=TIPO_LIBRE)
    assert qp["methodology_extra"]["optimizer"] == "QP"
    assert mayor_diferencia(cla["max_sharpe_portfolio"]["weights"], qp["max_sharpe_portfolio"]["weights"]) == 0
    assert mayor_diferencia(cla["min_volatility_portfolio"]["weights"], qp["min_volatility_portfolio"]["weights"]) == 0


def test_una_cartera_que_deja_al_cla_en_un_ciclo_da_lo_mismo_por_los_dos_caminos():
    filas = filas_que_dejan_al_cla_en_un_ciclo()
    lector, ids = lector_semanal(filas)
    propuesta, simulacion = _antes_de_que_pasen(240, lambda: (optimizar(lector, ids), simular(lector, ids)))
    assert propuesta["methodology"]["weight_bounds"] == [0.0, 0.2]
    de_simular = simulacion["frontier"]
    assert mayor_diferencia(propuesta["max_sharpe_portfolio"]["weights"], de_simular["max_sharpe_portfolio"]["weights"]) <= TOLERANCIA_PESOS
    assert propuesta["methodology"]["optimizer"] == de_simular["methodology"]["optimizer"]
