# -*- coding: utf-8 -*-
"""La frontera de Simular, solo con lo que se puede comprar (decision de Oscar, 15-11-2026).

La simulacion mira atras y mide tambien lo que ya no se puede comprar: es lo que el cliente tiene. Pero la frontera, la
cartera de minima volatilidad, la de Maximo Sharpe, la del nivel de riesgo y la simulacion del Maximo Sharpe proponen pesos,
y ahi solo entra lo que pasa la puerta de Optimizar (`_root_exclusion_reason(..., allow_historical=False)`). Una serie plana
-un precio congelado- es un activo casi sin riesgo y sin correlacion que la frontera cargaria de peso.

Los activos son inventados, con las series de `test_maximo_sharpe_una_sola_cartera`. Las cifras que se fijan salen de una
cuenta escrita aqui: el peso de cada posicion en la cartera, la rentabilidad de la cartera con sus series, o la cuenta de
antes -el motor con todos los activos-, que es lo que no tiene que cambiar.
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
from weekly_sampling import DAYS_PER_YEAR  # noqa: E402
import test_maximo_sharpe_una_sola_cartera as base  # noqa: E402

HOY = base.HOY
DESDE_CONGELADO = "2025-09-15"


@pytest.fixture(autouse=True)
def cache_limpia():
    repo._clear_price_series_cache()
    yield
    repo._clear_price_series_cache()


def congelar(monkeypatch, lector, aid, desde=DESDE_CONGELADO):
    """Como NH Hotel Group: la serie se queda plana en su ultimo precio y la politica lo marca, con su precio."""
    puntos = lector.series[aid]
    precio = [p["value"] for p in puntos if p["date"] < desde][-1]
    lector.series[aid] = [p if p["date"] < desde else {"date": p["date"], "value": precio} for p in puntos]
    import fund_history_quality
    reales = fund_history_quality.policies()
    anteriores = dict(getattr(congelar, "_marcados", {}))
    anteriores[aid] = {"flags": ["PRICE_FROZEN_DELISTED"], "frozen_price": {"from": desde, "value": precio}}
    congelar._marcados = anteriores
    monkeypatch.setattr(fund_history_quality, "policies", lambda: {**reales, **anteriores})
    return precio


@pytest.fixture(autouse=True)
def sin_marcas_de_otra_prueba():
    congelar._marcados = {}
    yield
    congelar._marcados = {}


def simular(lector, pesos, ventana="3Y"):
    return h.analyze_horizon(
        lector, {"window": ventana, "positions": [{"asset_id": a, "weight": w} for a, w in pesos.items()]},
        today=HOY, risk_free_resolver=base.tipo_libre)


def retornos_del_periodo(lector, ids, ventana="3Y"):
    """La matriz con la que se mide la cartera, para hacer aparte la cuenta de antes."""
    cargados, fuera, _ = h._leer_precios_y_raices(lector, ids)
    periodo = h._periodo_comun(cargados, fuera, ventana, {**h.references(), "assets": {}}, HOY)
    return periodo.ids, h.retornos_semanales(periodo.matrix, periodo.week_indices)


def la_cuenta_de_antes(lector, pesos):
    """Lo que daba Simular antes del cambio para la cartera: el motor con todos los activos medidos y sus pesos."""
    ids, retornos = retornos_del_periodo(lector, sorted(pesos))
    total = sum(pesos[a] for a in ids)
    norm = {a: pesos[a] / total for a in ids}
    motor_entero = motor.solve(ids, retornos.tolist(), current_weights=norm, frontier_points=repo.PUNTOS_DE_LA_FRONTERA,
                               risk_free_rate=base.TIPO_LIBRE)
    aportaciones, _meta = repo._risk_contribution_contract(
        ids, [norm[a] for a in ids], motor_entero["covariance_matrix"], motor_entero["covariance_meta"]["covariance_estimator"])
    return motor_entero, aportaciones


PESOS = {"ACTIVO00": 0.25, "ACTIVO01": 0.20, "ACTIVO02": 0.10, "ACTIVO03": 0.20, "ACTIVO04": 0.15, "ACTIVO05": 0.10}


# --- (a) Sin nada que no se pueda comprar, la respuesta es la de antes ------------------------------------------------

def test_sin_nada_apartado_la_frontera_es_la_de_antes_y_no_hay_campo_nuevo(monkeypatch):
    lector = base.universo()
    llamadas = []
    original = motor.solve

    def espia(ids, matriz, **opciones):
        llamadas.append((list(ids), opciones.get("current_weights")))
        return original(ids, matriz, **opciones)

    monkeypatch.setattr(motor, "solve", espia)
    respuesta = simular(lector, PESOS)
    monkeypatch.setattr(motor, "solve", original)
    antes, aportaciones = la_cuenta_de_antes(lector, PESOS)
    assert "frontier_excluded_assets" not in respuesta
    # Un solo calculo, con todos los activos y los pesos de la cartera: el de antes.
    assert llamadas == [(sorted(PESOS), {a: PESOS[a] for a in sorted(PESOS)})]
    frontera = respuesta["frontier"]
    for clave in ("current_portfolio", "min_volatility_portfolio", "max_sharpe_portfolio", "target_portfolio", "frontier"):
        assert frontera[clave] == antes[clave]
    assert frontera["risk_contributions"] == aportaciones
    assert frontera["coverage"]["included_assets"] == 6
    assert respuesta["max_sharpe"]["asset_ids"] == sorted(PESOS)


# --- (b) Con un precio congelado: la cartera igual, la frontera sin el --------------------------------------------------

def test_un_precio_congelado_se_mide_en_la_cartera_y_no_recibe_peso_en_la_frontera(monkeypatch):
    sin_marca = base.universo()
    congelar(monkeypatch, sin_marca, "ACTIVO02")
    # La misma serie plana, sin la marca: el activo se puede comprar y la frontera le da peso. Es el problema que se arregla.
    import fund_history_quality
    monkeypatch.setattr(fund_history_quality, "policies", lambda: {})
    repo._clear_price_series_cache()
    antes = simular(sin_marca, PESOS)
    assert antes["frontier"]["max_sharpe_portfolio"]["weights"]["ACTIVO02"] > 0.05

    lector = base.universo()
    precio = congelar(monkeypatch, lector, "ACTIVO02")
    repo._clear_price_series_cache()
    respuesta = simular(lector, PESOS)

    # Las cifras de la cartera no cambian: las mismas que con el activo comprable.
    simulacion, simulacion_antes = respuesta["backtest"], antes["backtest"]
    assert simulacion["metrics"] == simulacion_antes["metrics"]
    assert simulacion["portfolio_series"] == simulacion_antes["portfolio_series"]
    assert simulacion["coverage"] == simulacion_antes["coverage"]
    assert simulacion["asset_ids"] == sorted(PESOS)
    assert respuesta["coverage_weight_percent"] == pytest.approx(100)
    # Y la rentabilidad de la cartera, a mano con sus series: cada posicion por lo que ha crecido, el congelado incluido.
    primero, ultimo = simulacion["coverage"]["first_date"], simulacion["coverage"]["last_date"]

    def nivel(aid, dia):
        return [p["value"] for p in lector.series[aid] if p["date"] <= dia][-1]

    crecimiento = sum(w * nivel(a, ultimo) / nivel(a, primero) for a, w in PESOS.items())
    anios = (date.fromisoformat(ultimo) - date.fromisoformat(primero)).days / DAYS_PER_YEAR
    assert simulacion["metrics"]["cagr"] == pytest.approx(crecimiento ** (1 / anios) - 1, abs=1e-12)
    assert nivel("ACTIVO02", ultimo) == precio

    # El punto de la cartera es el de antes: la cartera real, con el congelado y su 10 %.
    frontera = respuesta["frontier"]
    motor_entero, aportaciones = la_cuenta_de_antes(lector, PESOS)
    for campo in ("expected_return", "volatility", "sharpe_ratio"):
        assert frontera["current_portfolio"][campo] == pytest.approx(motor_entero["current_portfolio"][campo], abs=1e-12)
    assert frontera["current_portfolio"]["weights"]["ACTIVO02"] == pytest.approx(0.10, abs=1e-15)
    for mia, suya in zip(frontera["risk_contributions"], aportaciones):
        assert mia["asset_id"] == suya["asset_id"]
        assert mia["weight_pct"] == pytest.approx(suya["weight_pct"], abs=1e-12)
        assert mia["risk_pct"] == pytest.approx(suya["risk_pct"], abs=1e-9)

    # Ninguna cartera propuesta lo lleva.
    for clave in ("min_volatility_portfolio", "max_sharpe_portfolio", "target_portfolio"):
        assert "ACTIVO02" not in frontera[clave]["weights"]
    assert all("ACTIVO02" not in punto["weights"] for punto in frontera["frontier"])
    # Su simulacion va sobre las mismas columnas que la cartera, que es lo que compara la pantalla, con cero en el congelado.
    assert respuesta["max_sharpe"]["asset_ids"] == sorted(PESOS)
    assert respuesta["max_sharpe"]["weights_normalized"]["ACTIVO02"] == 0.0
    assert respuesta["max_sharpe"]["coverage"] == simulacion["coverage"]
    assert frontera["coverage"]["included_assets"] == 5

    # Y la respuesta lo dice, aparte de lo que no se ha podido medir: con su motivo y su 10 % de la cartera.
    assert respuesta["frontier_excluded_assets"] == [{"asset_id": "ACTIVO02", "reason": "FROZEN_PRICE", "weight": pytest.approx(0.10, abs=1e-15)}]
    assert simulacion["excluded_assets"] == []
    assert frontera["excluded_assets"] == []
    assert respuesta["frontier_unavailable_reason"] is None


def test_el_peso_que_se_lista_es_el_de_la_cartera_medida():
    """Con una posicion sin historico, los pesos se reparten entre lo medido: 10 / (100 - 20) = 12,5 %."""
    lector = base.universo()
    lector.series["ACTIVO05"] = [p for p in lector.series["ACTIVO05"] if p["date"] > "2025-06-01"]
    lector.raices["ACTIVO02"] = {"asset_id": "ACTIVO02", "asset_type": "ETF",
                                 "quality": {"status": "OK", "review_flags": ["DEREGISTERED_MERGER_VERIFIED"]}}
    pesos = {**PESOS, "ACTIVO05": 0.20, "ACTIVO04": 0.05}
    respuesta = simular(lector, pesos)
    assert respuesta["backtest"]["excluded_assets"] == [{"asset_id": "ACTIVO05", "reason": "INSUFFICIENT_HISTORY"}]
    assert respuesta["frontier_excluded_assets"] == [
        {"asset_id": "ACTIVO02", "reason": "CORPORATE_ACTION", "weight": pytest.approx(0.10 / 0.80, abs=1e-15)}]
    assert respuesta["frontier"]["current_portfolio"]["weights"]["ACTIVO02"] == pytest.approx(0.125, abs=1e-15)


@pytest.mark.parametrize("raiz, motivo", [
    ({"quality": {"status": "OK", "review_flags": ["DEREGISTERED_MERGER_VERIFIED"]}}, "CORPORATE_ACTION"),
    # Decision 44: nunca se resolvio su simbolo. En lo historico no se bloquea; para elegir, si.
    ({"quality": {"status": "OK"}, "availability": {"state": "NEVER_RESOLVED"}}, "SELECTION_BLOCKED"),
])
def test_cada_motivo_se_nombra_por_lo_que_es(raiz, motivo):
    lector = base.universo(n=4)
    lector.raices["ACTIVO01"] = {"asset_id": "ACTIVO01", "asset_type": "ETF", **raiz}
    respuesta = simular(lector, {a: 0.25 for a in sorted(lector.series)})
    assert [(f["asset_id"], f["reason"]) for f in respuesta["frontier_excluded_assets"]] == [("ACTIVO01", motivo)]
    assert "ACTIVO01" in respuesta["backtest"]["asset_ids"]
    assert "ACTIVO01" not in respuesta["frontier"]["max_sharpe_portfolio"]["weights"]


# --- (d) Menos de dos que se puedan comprar ----------------------------------------------------------------------------

def test_si_solo_queda_uno_que_se_pueda_comprar_no_hay_frontera_y_se_dice_por_que(monkeypatch):
    lector = base.universo(n=2)
    congelar(monkeypatch, lector, "ACTIVO01")
    respuesta = simular(lector, {"ACTIVO00": 0.7, "ACTIVO01": 0.3})
    assert respuesta["frontier"] is None
    assert respuesta["max_sharpe"] is None
    assert respuesta["frontier_unavailable_reason"] == (
        "La frontera solo usa activos que se pueden comprar y necesita al menos dos: en esta cartera solo queda uno "
        "después de apartar el que no se puede comprar. Las cifras de la cartera sí lo incluyen.")
    assert respuesta["frontier_excluded_assets"] == [{"asset_id": "ACTIVO01", "reason": "FROZEN_PRICE", "weight": pytest.approx(0.3)}]
    # La cartera se sigue midiendo con los dos, y la aportacion al riesgo, tambien: es de la cartera, no de la frontera.
    assert respuesta["backtest"]["asset_ids"] == ["ACTIVO00", "ACTIVO01"]
    assert [a["asset_id"] for a in respuesta["risk_contributions"]] == ["ACTIVO00", "ACTIVO01"]
    assert sum(a["risk_pct"] for a in respuesta["risk_contributions"]) == pytest.approx(100)


def test_si_no_queda_ninguno_que_se_pueda_comprar_tampoco_hay_error(monkeypatch):
    lector = base.universo(n=2)
    congelar(monkeypatch, lector, "ACTIVO01")
    lector.raices["ACTIVO00"] = {"asset_id": "ACTIVO00", "asset_type": "ETF",
                                 "quality": {"status": "OK", "review_flags": ["DEREGISTERED_MERGER_VERIFIED"]}}
    respuesta = simular(lector, {"ACTIVO00": 0.5, "ACTIVO01": 0.5})
    assert respuesta["frontier"] is None
    assert respuesta["frontier_unavailable_reason"] == (
        "La frontera solo usa activos que se pueden comprar y necesita al menos dos: en esta cartera no queda ninguno "
        "después de apartar los 2 que no se pueden comprar. Las cifras de la cartera sí los incluyen.")
    assert {f["asset_id"]: f["reason"] for f in respuesta["frontier_excluded_assets"]} == {
        "ACTIVO00": "CORPORATE_ACTION", "ACTIVO01": "FROZEN_PRICE"}
    assert math.isfinite(respuesta["backtest"]["metrics"]["volatility"])


def test_una_sola_posicion_que_no_se_puede_comprar_tambien_se_mide(monkeypatch):
    lector = base.universo(n=1)
    congelar(monkeypatch, lector, "ACTIVO00")
    respuesta = simular(lector, {"ACTIVO00": 1.0})
    assert respuesta["frontier"] is None
    assert "risk_contributions" not in respuesta
    assert respuesta["frontier_excluded_assets"][0]["reason"] == "FROZEN_PRICE"
    assert respuesta["backtest"]["asset_ids"] == ["ACTIVO00"]


# --- El tope de la frontera se cuenta sobre los que entran ------------------------------------------------------------

def test_el_tope_de_cuarenta_se_cuenta_sobre_lo_que_entra_en_la_frontera(monkeypatch):
    n = h.MAX_ACTIVOS_FRONTERA + 1
    lector = base.universo(n=n)
    ids = sorted(lector.series)
    pesos = {a: 1 / n for a in ids}
    # 41 medidos y ninguno apartado: sin frontera, como siempre.
    sin_frontera = simular(lector, pesos)
    assert sin_frontera["frontier"] is None
    assert "41 medidos:" in sin_frontera["frontier_unavailable_reason"]
    # Con uno apartado entran 40, y hay frontera.
    congelar(monkeypatch, lector, ids[0])
    repo._clear_price_series_cache()
    respuesta = simular(lector, pesos)
    assert respuesta["frontier"] is not None
    assert respuesta["frontier"]["coverage"]["included_assets"] == h.MAX_ACTIVOS_FRONTERA
    assert ids[0] not in respuesta["frontier"]["max_sharpe_portfolio"]["weights"]
    assert len(respuesta["frontier"]["current_portfolio"]["weights"]) == n
    assert len(respuesta["frontier"]["risk_contributions"]) == n


def test_por_encima_del_tope_aun_sin_lo_apartado_el_mensaje_cuenta_lo_que_entraria(monkeypatch):
    n = h.MAX_ACTIVOS_FRONTERA + 2
    lector = base.universo(n=n)
    ids = sorted(lector.series)
    congelar(monkeypatch, lector, ids[0])
    respuesta = simular(lector, {a: 1 / n for a in ids})
    assert respuesta["frontier"] is None
    assert "esta cartera tiene 41 medidos que se pueden comprar:" in respuesta["frontier_unavailable_reason"]
    assert len(respuesta["risk_contributions"]) == n
    assert respuesta["frontier_excluded_assets"][0]["asset_id"] == ids[0]
