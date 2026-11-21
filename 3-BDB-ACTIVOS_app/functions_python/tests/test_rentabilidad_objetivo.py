# -*- coding: utf-8 -*-
"""Decisiones 61 y 94 (05-11-2026): «Rentabilidad objetivo» sale del motor regularizado, y dice lo que mide la serie.

Era el ultimo objetivo con otro calculo. La cifra que se pide es la MEDIA DE LA SERIE, sin encoger, con la misma covarianza y sobre
la misma curva. La tarjeta sigue dando la rentabilidad del modelo, y lo que luego mide la serie es una rentabilidad anualizada con los
pesos derivando: son tres cifras, y la respuesta trae las tres. Maximo Sharpe y Minima volatilidad no se mueven.

Los activos son inventados y las cifras esperadas se calculan aparte, a mano, en este fichero: con dos activos, de una ecuacion
lineal; con tres o mas, con los multiplicadores de Lagrange; la del modelo, con el encogimiento de James-Stein escrito con su formula.
La medida con la serie se rehace desde los niveles.
"""
from datetime import date
import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import portfolio_horizon as h  # noqa: E402
from optimization import repository as repo  # noqa: E402
from optimization import robust_engine as motor  # noqa: E402
from test_maximo_sharpe_una_sola_cartera import (  # noqa: E402
    HOY, TIPO_LIBRE, ledoit_wolf_a_mano, lector_semanal, mayor_diferencia, momentos_a_mano, optimizar, retornos_de,
    retornos_inventados, simular, universo,
)

# El solver no es exacto. Medido contra la formula en estos mismos casos, por debajo de 1e-6.
TOLERANCIA_FRENTE_A_LA_FORMULA = 1e-5


@pytest.fixture(autouse=True)
def cache_limpia():
    repo._clear_price_series_cache()
    yield
    repo._clear_price_series_cache()


def niveles_de(lector, aid, inicio, fin):
    return np.array([p["value"] for p in lector.series[aid] if inicio <= p["date"] <= fin], dtype=float)


def medida_a_mano(lector, pesos, cobertura):
    """La cartera con los pesos fijos desde el primer dia y sin reequilibrar, en viernes: las series de la prueba son semanales."""
    inicio, fin = cobertura["first_date"], cobertura["last_date"]
    serie = sum(w * niveles_de(lector, aid, inicio, fin) / niveles_de(lector, aid, inicio, fin)[0] for aid, w in pesos.items())
    anios = (date.fromisoformat(fin) - date.fromisoformat(inicio)).days / 365.2425
    rentabilidad = (serie[-1] / serie[0]) ** (1 / anios) - 1
    volatilidad = float(np.std(serie[1:] / serie[:-1] - 1, ddof=1)) * math.sqrt(52)
    return {
        "cagr": rentabilidad,
        "volatility": volatilidad,
        "sharpe": (rentabilidad - TIPO_LIBRE) / volatilidad,
        "max_drawdown": float(np.min(serie / np.maximum.accumulate(serie) - 1)),
    }


def james_stein_a_mano(retornos):
    """El encogimiento hacia la media de todos, con su formula. Con menos de cuatro activos no encoge."""
    X = np.asarray(retornos, dtype=float)
    T, N = X.shape
    bruta = X.mean(axis=0) * 52
    comun = bruta.mean()
    varianza_de_la_media = X.var(axis=0, ddof=1) / T * 52 ** 2
    dispersion = ((bruta - comun) ** 2).sum()
    delta = max(0.0, min(0.5, (N - 3) * varianza_de_la_media.mean() / dispersion))
    return (1 - delta) * bruta + delta * comun, bruta, delta


def medias_de_la_serie(lector, ids, ventana="3Y"):
    """Lo que se pide con este objetivo: la media de las rentabilidades semanales de cada activo, por 52, sin encoger, sobre las semanas de la
    simulacion. Con series semanales, se comprueba contra la cuenta a mano en `test_la_media_de_la_serie_de_esta_prueba_es_la_de_a_mano`."""
    periodo, _, _ = h.periodo_para_optimizar(lector, ids, ventana, today=HOY)
    return dict(zip(periodo.ids, np.asarray(h.retornos_semanales(periodo.matrix, periodo.week_indices)).mean(axis=0) * 52))


def en_la_serie(lector, ids, punto, ventana="3Y"):
    medias = medias_de_la_serie(lector, ids, ventana)
    return float(sum(peso * medias[a] for a, peso in punto["weights"].items()))


def lagrange_a_mano(medias, covarianza, objetivo):
    """min w'Sw con w'medias = objetivo y w'1 = 1, sin mas limites."""
    A = np.vstack([medias, np.ones(len(medias))])
    inversa = np.linalg.inv(covarianza)
    return inversa @ A.T @ np.linalg.solve(A @ inversa @ A.T, np.array([objetivo, 1.0]))


def maximo_a_mano(mu, tope):
    """Sin mas limites que el tope por posicion, se llena por orden de rentabilidad."""
    resto, total = 1.0, 0.0
    for m in sorted(mu, reverse=True):
        peso = min(tope, resto)
        total += peso * m
        resto -= peso
    return total


def en_pct_2(valor):
    return f"{valor * 100:.2f}".replace(".", ",").replace("-", "−") + " %"


def pesos_de(punto):
    return {a: w for a, w in punto["weights"].items()}


# --- Resultados conocidos, calculados aparte --------------------------------------------------------------------------

def test_dos_activos_la_cartera_sale_de_una_ecuacion_y_se_mide_con_la_serie():
    filas = retornos_inventados(11, [0.0019, 0.0012], [0.021, 0.013])
    lector, ids = lector_semanal(filas)
    # Una primera llamada para saber las fechas: el objetivo se escribe con la media a mano de esa ventana.
    cobertura = optimizar(lector, ids, "TARGET_RETURN", target_return=-1.0)["coverage"]
    mu, S = momentos_a_mano(retornos_de(lector, ids, cobertura["first_date"], cobertura["last_date"]))
    objetivo = 0.55 * mu[0] + 0.45 * mu[1]
    assert mu[0] > mu[1], "el primero rinde mas"

    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)

    # Con dos activos, una sola cartera da esa rentabilidad: la covarianza no interviene.
    punto = resultado["target_return_portfolio"]
    assert punto["weights"][ids[0]] == pytest.approx(0.55, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert punto["weights"][ids[1]] == pytest.approx(0.45, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert sum(punto["weights"].values()) == pytest.approx(1, abs=1e-12)
    w = np.array([punto["weights"][ids[0]], punto["weights"][ids[1]]])
    assert punto["expected_return"] == pytest.approx(objetivo, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert punto["expected_return"] == pytest.approx(w @ mu, abs=1e-9)
    assert punto["volatility"] == pytest.approx((w @ S @ w) ** 0.5, abs=1e-9)
    assert resultado["methodology"]["target_return"] == objetivo

    # Lo que mide la serie, rehecho desde los niveles.
    medida = resultado["target_return_measured"]
    for campo, esperado in medida_a_mano(lector, pesos_de(punto), resultado["coverage"]).items():
        assert medida["portfolio"][campo] == pytest.approx(esperado, abs=1e-9), campo
    for campo, esperado in medida_a_mano(lector, {a: 0.5 for a in ids}, resultado["coverage"]).items():
        assert medida["current"][campo] == pytest.approx(esperado, abs=1e-9), campo


def test_tres_activos_con_la_solucion_de_lagrange():
    filas = retornos_inventados(5, [0.002, 0.0015, 0.001], [0.018, 0.015, 0.012])
    lector, ids = lector_semanal(filas)
    cobertura = optimizar(lector, ids, "TARGET_RETURN", target_return=-1.0)["coverage"]
    mu, S = momentos_a_mano(retornos_de(lector, ids, cobertura["first_date"], cobertura["last_date"]))
    uno = np.ones(3)
    objetivo = float(mu @ np.array([0.40, 0.35, 0.25]))

    # min w'Sw con w'mu = objetivo y w'1 = 1.
    A = np.vstack([mu, uno])
    inversa = np.linalg.inv(S)
    esperado = inversa @ A.T @ np.linalg.solve(A @ inversa @ A.T, np.array([objetivo, 1.0]))
    assert 0 < esperado.min() and esperado.max() < 0.6, "para que el tope no intervenga"

    punto = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)["target_return_portfolio"]
    for aid, w in zip(ids, esperado):
        assert punto["weights"][aid] == pytest.approx(float(w), abs=1e-4)
    assert punto["expected_return"] == pytest.approx(objetivo, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    # Es la de menor riesgo que llega: otra con la misma rentabilidad tiene mas.
    desplazada = esperado + 0.03 * np.linalg.svd(A)[2][-1]
    assert float(mu @ desplazada) == pytest.approx(objetivo, abs=1e-9)
    assert punto["volatility"] < (desplazada @ S @ desplazada) ** 0.5


def test_con_cuatro_activos_o_mas_lo_pedido_es_la_media_de_la_serie_y_la_tarjeta_la_del_modelo():
    # Unos rinden mucho y otros poco: el encogimiento sube a los que rinden poco.
    filas = retornos_inventados(31, [0.0045, 0.0040, 0.0008, 0.0006, 0.0005], [0.02, 0.019, 0.006, 0.005, 0.004], semanas=170)
    lector, ids = lector_semanal(filas)
    cobertura = optimizar(lector, ids, "TARGET_RETURN", target_return=-1.0)["coverage"]
    mu, bruta, delta = james_stein_a_mano(retornos_de(lector, ids, cobertura["first_date"], cobertura["last_date"]))
    assert delta > 0.05, "para que se note"
    objetivo = float(bruta @ np.array([0.2, 0.1, 0.3, 0.2, 0.2]))

    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)

    punto = resultado["target_return_portfolio"]
    w = np.array([punto["weights"][a] for a in ids])
    # Lo que se escribe es la media de la serie de esa cartera.
    assert w @ bruta == pytest.approx(objetivo, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert resultado["methodology"]["target_return"] == objetivo
    assert resultado["methodology"]["target_return_basis"] == "SERIES_MEAN"
    # La tarjeta sigue con la del modelo, y sabemos cual es sin mirar al motor: (1 - d) x lo pedido + d x la media de todos.
    assert punto["expected_return"] == pytest.approx(w @ mu, abs=1e-9)
    assert punto["expected_return"] == pytest.approx((1 - delta) * objetivo + delta * bruta.mean(), abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert abs(punto["expected_return"] - objetivo) > 0.001, "para que se note que son dos cifras"
    # Y lo medido es la tercera, rehecha desde los niveles.
    for campo, esperado in medida_a_mano(lector, pesos_de(punto), resultado["coverage"]).items():
        assert resultado["target_return_measured"]["portfolio"][campo] == pytest.approx(esperado, abs=1e-9), campo


def test_es_la_misma_curva_pedir_en_la_serie_o_su_equivalente_en_el_modelo_dan_la_misma_cartera():
    """Decision 94: encoger es afin y con la suma al 100 % no mueve la frontera. Solo cambia que punto le toca a la cifra escrita.
    Con Lagrange, y sin el motor: la cartera de un objetivo sobre la serie es la del objetivo equivalente sobre las medias encogidas."""
    filas = retornos_inventados(23, [0.0030, 0.0027, 0.0024, 0.0021, 0.0018], [0.016, 0.015, 0.014, 0.013, 0.012], semanas=170)
    lector, ids = lector_semanal(filas)
    cobertura = optimizar(lector, ids, "TARGET_RETURN", target_return=-1.0)["coverage"]
    retornos = retornos_de(lector, ids, cobertura["first_date"], cobertura["last_date"])
    mu, bruta, delta = james_stein_a_mano(retornos)
    assert delta > 0.05, "para que se note"
    S = ledoit_wolf_a_mano(retornos) * 52
    objetivo = float(bruta @ np.array([0.2, 0.2, 0.2, 0.2, 0.2]))
    sobre_la_serie = lagrange_a_mano(bruta, S, objetivo)
    sobre_el_modelo = lagrange_a_mano(mu, S, (1 - delta) * objetivo + delta * bruta.mean())
    assert sobre_la_serie == pytest.approx(sobre_el_modelo, abs=1e-9)
    assert 0 < sobre_la_serie.min() and sobre_la_serie.max() < 0.35, "para que el tope no intervenga"
    punto = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)["target_return_portfolio"]
    for aid, w in zip(ids, sobre_la_serie):
        assert punto["weights"][aid] == pytest.approx(float(w), abs=1e-4)


# --- Hasta donde se llega, y por debajo de donde no hay nada que buscar ----------------------------------------------------

@pytest.mark.parametrize("n, tope", [(2, 0.60), (5, 0.35), (12, 0.25)])
def test_un_objetivo_inalcanzable_dice_hasta_donde_se_llega_y_esa_cifra_tiene_solucion(n, tope):
    medias = [0.0035 - 0.0002 * i for i in range(n)]
    filas = retornos_inventados(n + 70, medias, [0.015] * n, semanas=170)
    lector, ids = lector_semanal(filas)
    cobertura = optimizar(lector, ids, "TARGET_RETURN", target_return=-1.0)["coverage"]
    _, bruta, _ = james_stein_a_mano(retornos_de(lector, ids, cobertura["first_date"], cobertura["last_date"]))
    maximo = maximo_a_mano(bruta, tope)
    escrita = math.floor(maximo * 10000) / 10000

    with pytest.raises(repo.InvalidOptimizationRequest) as error:
        optimizar(lector, ids, "TARGET_RETURN", target_return=0.5)
    tope_escrito = f"{tope * 100:.1f}".replace(".", ",")
    assert str(error.value) == (
        f"Sin solución: con un tope del {tope_escrito} % por posición, la media de la serie llega como mucho a un {en_pct_2(escrita)}, "
        "y has pedido un 50,00 %. Baja el objetivo o sube el máximo por activo."
    )

    # Quien escribe esa cifra tiene cartera, con los topes llenos y sin salirse de ellos.
    punto = optimizar(lector, ids, "TARGET_RETURN", target_return=escrita)["target_return_portfolio"]
    assert en_la_serie(lector, ids, punto) == pytest.approx(escrita, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert max(punto["weights"].values()) <= tope + 1e-6
    assert sum(punto["weights"].values()) == pytest.approx(1, abs=1e-9)
    # Y una centesima mas ya no.
    with pytest.raises(repo.InvalidOptimizationRequest, match="Sin solución:"):
        optimizar(lector, ids, "TARGET_RETURN", target_return=escrita + 0.0001)


@pytest.mark.parametrize("objetivo", [-1.0, -0.05, 0.0, 0.001])
def test_un_objetivo_por_debajo_de_la_minima_volatilidad_da_esa_cartera_y_no_un_error(objetivo):
    lector = universo()
    ids = sorted(lector.series)
    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)
    punto = resultado["target_return_portfolio"]
    # Exactamente esa: otra con menos rentabilidad tendria mas riesgo, y seria una cartera absurda.
    assert punto["weights"] == resultado["min_volatility_portfolio"]["weights"]
    assert punto["expected_return"] > objetivo
    assert resultado["methodology"]["target_return"] == objetivo
    assert resultado["target_return_measured"]["portfolio"] is not None
    # El suelo es la media de la serie de esa cartera, a mano, y es lo que se compara con lo pedido.
    suelo = resultado["methodology"]["target_return_floor"]
    assert suelo == pytest.approx(en_la_serie(lector, ids, punto), abs=1e-12)
    assert suelo > objetivo


def test_el_suelo_es_exacto_en_el_esa_cartera_y_una_decima_por_encima_otra():
    lector = universo()
    ids = sorted(lector.series)
    suelo = optimizar(lector, ids, "TARGET_RETURN", target_return=-1.0)["methodology"]["target_return_floor"]
    justo = optimizar(lector, ids, "TARGET_RETURN", target_return=suelo)
    assert justo["target_return_portfolio"]["weights"] == justo["min_volatility_portfolio"]["weights"]
    encima = optimizar(lector, ids, "TARGET_RETURN", target_return=suelo + 0.001)
    assert encima["target_return_portfolio"]["weights"] != encima["min_volatility_portfolio"]["weights"]
    assert en_la_serie(lector, ids, encima["target_return_portfolio"]) == pytest.approx(suelo + 0.001, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)


def test_sin_objetivo_no_hay_peticion():
    lector = universo(n=3)
    with pytest.raises(repo.InvalidOptimizationRequest, match="target_return is required") as error:
        optimizar(lector, sorted(lector.series), "TARGET_RETURN")
    assert not str(error.value).startswith("Sin solución:")


def test_que_el_solver_falle_no_es_que_no_haya_solucion(monkeypatch):
    from pypfopt import EfficientFrontier
    lector = universo()
    ids = sorted(lector.series)
    objetivo = _objetivo_en_medio(lector, ids)

    def falla(self, *_a, **_k):
        raise RuntimeError("el solver")

    monkeypatch.setattr(EfficientFrontier, "efficient_return", falla)
    # Hallazgo 15 (15-11-2026): no es «sin solucion» (InvalidOptimizationRequest), pero tampoco un error interno: llega como
    # OptimizationError con un texto para el asesor, y la causa queda encadenada para el registro.
    from optimization.repository import InvalidOptimizationRequest, OptimizationError
    with pytest.raises(OptimizationError, match="rentabilidad objetivo") as error:
        optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)
    assert not isinstance(error.value, InvalidOptimizationRequest)
    assert isinstance(error.value.__cause__, RuntimeError) and "el solver" in str(error.value.__cause__)


def test_si_el_primer_solver_se_sale_de_las_cotas_se_reintenta_con_el_otro(monkeypatch):
    from pypfopt import EfficientFrontier
    lector = universo()
    ids = sorted(lector.series)
    objetivo = _objetivo_en_medio(lector, ids)
    bueno = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)["target_return_portfolio"]
    original = EfficientFrontier.efficient_return
    llamadas = []

    def solo_con_clarabel(self, *a, **k):
        llamadas.append(self._solver)
        if self._solver is None:
            raise RuntimeError("OSQP fuera de las cotas")
        return original(self, *a, **k)

    monkeypatch.setattr(EfficientFrontier, "efficient_return", solo_con_clarabel)
    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)
    punto = resultado["target_return_portfolio"]
    assert llamadas == [None, "CLARABEL"]
    assert mayor_diferencia(punto["weights"], bueno["weights"]) <= 1e-4
    assert en_la_serie(lector, ids, punto) == pytest.approx(objetivo, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)


def _objetivo_en_medio(lector, ids, ventana="3Y", **extra):
    """Entre la de menor riesgo y Maximo Sharpe, en la medida que se pide: la media de la serie."""
    referencia = optimizar(lector, ids, "MAX_SHARPE", ventana=ventana, **extra)
    return sum(en_la_serie(lector, ids, referencia[clave], ventana) for clave in ("min_volatility_portfolio", "max_sharpe_portfolio")) / 2


# --- Un solo calculo --------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("ventana", ["3Y", "5Y"])
def test_las_otras_carteras_son_las_de_los_demas_objetivos_y_las_de_simular(ventana):
    lector = universo()
    ids = sorted(lector.series)
    objetivo = _objetivo_en_medio(lector, ids, ventana)
    resultado = optimizar(lector, ids, "TARGET_RETURN", ventana=ventana, target_return=objetivo)
    de_simular = simular(lector, ids, ventana)["frontier"]
    for clave in ("max_sharpe_portfolio", "min_volatility_portfolio"):
        assert mayor_diferencia(resultado[clave]["weights"], de_simular[clave]["weights"]) <= 1e-9
    for campo in ("first_date", "last_date", "common_observations", "included_assets"):
        assert resultado["coverage"][campo] == de_simular["coverage"][campo]
    for campo in ("risk_free_rate", "weight_bounds", "covariance_estimator", "return_estimator", "optimizer"):
        assert resultado["methodology"][campo] == de_simular["methodology"][campo]
    assert resultado["risk_contributions_meta"]["cov_model"] in {"LEDOIT_WOLF", "OAS"}
    # La cartera del objetivo esta entre las dos y sobre la misma curva: entre su riesgo y su rentabilidad.
    punto = resultado["target_return_portfolio"]
    assert resultado["min_volatility_portfolio"]["volatility"] <= punto["volatility"] <= resultado["max_sharpe_portfolio"]["volatility"]


@pytest.mark.parametrize("ventana", ["3Y", "5Y"])
def test_maximo_sharpe_y_minima_volatilidad_no_se_mueven_diferencia_cero(ventana):
    """Decision 94: lo unico que cambia es que punto le toca a la cifra escrita. Con el objetivo sobre la serie, las otras dos carteras y la curva
    siguen saliendo de las medias encogidas: se calculan a mano con ellas, y entre objetivos no difieren en nada, sin tolerancia."""
    filas = retornos_inventados(77, [0.0035, 0.0031, 0.0027, 0.0012, 0.0010, 0.0008], [0.018, 0.017, 0.016, 0.007, 0.006, 0.005], semanas=270)
    lector, ids = lector_semanal(filas)
    actuales = {a: 1 / len(ids) for a in ids}
    objetivo = _objetivo_en_medio(lector, ids, ventana)
    con_objetivo = [optimizar(lector, ids, "TARGET_RETURN", ventana=ventana, target_return=x, current_weights=actuales) for x in (objetivo, -1.0, objetivo + 0.01)]
    otros = [optimizar(lector, ids, otro, ventana=ventana, current_weights=actuales, **extra)
             for otro, extra in (("MAX_SHARPE", {}), ("MIN_VOLATILITY", {}), ("TARGET_RISK", {"risk_slider": 5}))]
    base = otros[0]
    for resultado in con_objetivo + otros[1:]:
        for clave in ("max_sharpe_portfolio", "min_volatility_portfolio", "current_portfolio", "frontier"):
            assert resultado[clave] == base[clave], clave

    # Y son las del modelo: si la media de la serie se colara en ellas, esto fallaria.
    from pypfopt import EfficientFrontier
    import pandas as pd
    retornos = retornos_de(lector, ids, base["coverage"]["first_date"], base["coverage"]["last_date"])
    mu, bruta, delta = james_stein_a_mano(retornos)
    assert delta > 0, "para que el modelo y la serie sean cosas distintas"
    S = pd.DataFrame(ledoit_wolf_a_mano(retornos) * 52, index=ids, columns=ids)
    tope = base["methodology"]["weight_bounds"][1]
    a_mano = EfficientFrontier(pd.Series(mu, index=ids), S, weight_bounds=(0.0, tope))
    a_mano.max_sharpe(risk_free_rate=TIPO_LIBRE)
    assert mayor_diferencia(base["max_sharpe_portfolio"]["weights"], dict(zip(ids, a_mano.weights))) <= 1e-3
    for clave in ("max_sharpe_portfolio", "min_volatility_portfolio"):
        w = np.array([base[clave]["weights"][a] for a in ids])
        assert base[clave]["expected_return"] == pytest.approx(float(w @ mu), abs=1e-9), clave


def test_la_medida_es_la_de_simular_para_esos_mismos_pesos():
    lector = universo()
    ids = sorted(lector.series)
    objetivo = _objetivo_en_medio(lector, ids)
    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)
    medida = resultado["target_return_measured"]
    # La cartera actual, igual que la tira de Simular.
    actual = simular(lector, ids)["backtest"]["metrics"]
    for campo in ("cagr", "volatility", "sharpe", "max_drawdown"):
        assert medida["current"][campo] == pytest.approx(actual[campo], abs=1e-12), campo
    # Y la propuesta, si se aplica y se simula.
    posiciones = [{"asset_id": a, "weight": w} for a, w in resultado["target_return_portfolio"]["weights"].items()]
    simulada = repo_simular_con_pesos(lector, posiciones)
    for campo in ("cagr", "volatility", "sharpe", "max_drawdown"):
        assert medida["portfolio"][campo] == pytest.approx(simulada[campo], abs=1e-9), campo


def repo_simular_con_pesos(lector, posiciones):
    import portfolio_horizon as h
    return h.analyze_horizon(lector, {"window": "3Y", "positions": posiciones}, today=HOY,
                             risk_free_resolver=lambda inicio, fin: {"rate": TIPO_LIBRE, "coverage_ratio": 1.0, "first_date": inicio, "last_date": fin, "observations": 750})["backtest"]["metrics"]


def test_cada_objetivo_en_su_campo_y_lo_medido_solo_donde_aplica():
    lector = universo()
    ids = sorted(lector.series)
    objetivo = _objetivo_en_medio(lector, ids)
    con_objetivo = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)
    # Con los dos llenos, la pantalla enseñaria la misma cartera dos veces con dos nombres.
    assert con_objetivo["target_portfolio"] is None
    assert con_objetivo["target_return_portfolio"] is not None
    for otro, extra in (("MAX_SHARPE", {}), ("MIN_VOLATILITY", {}), ("TARGET_RISK", {"risk_slider": 5})):
        resultado = optimizar(lector, ids, otro, **extra)
        assert resultado["target_return_portfolio"] is None
        assert "target_return_measured" not in resultado, "un campo presente donde no aplica es un error (decision 17)"
        for campo in ("target_return", "target_return_basis", "target_return_floor"):
            assert campo not in resultado["methodology"], campo


# --- Los limites, como en los otros tres ------------------------------------------------------------------------------

@pytest.mark.parametrize("n, tope", [(8, 0.35), (15, 0.25), (16, 0.20), (40, 0.20)])
def test_entran_hasta_cuarenta_activos_con_el_tope_del_modelo(n, tope):
    medias = [0.0012 + 0.00006 * i for i in range(n)]
    filas = retornos_inventados(n, medias, [0.012 + 0.0002 * i for i in range(n)], semanas=170)
    lector, ids = lector_semanal(filas)
    objetivo = _objetivo_en_medio(lector, ids)
    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)
    assert resultado["coverage"]["included_assets"] == n
    assert resultado["methodology"]["weight_bounds"] == [0.0, tope]
    punto = resultado["target_return_portfolio"]
    assert set(punto["weights"]) == set(ids)
    assert max(punto["weights"].values()) <= tope + 1e-6
    assert min(punto["weights"].values()) >= -1e-9
    assert sum(punto["weights"].values()) == pytest.approx(1, abs=1e-9)
    assert en_la_serie(lector, ids, punto) == pytest.approx(objetivo, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)


def test_un_maximo_escrito_manda_sobre_el_tope_por_arriba_y_por_abajo():
    medias = [0.004, 0.0009, 0.0008, 0.0007, 0.0006]
    filas = retornos_inventados(61, medias, [0.015] * 5, semanas=170)
    lector, ids = lector_semanal(filas)
    cobertura = optimizar(lector, ids, "TARGET_RETURN", target_return=-1.0)["coverage"]
    _, bruta, _ = james_stein_a_mano(retornos_de(lector, ids, cobertura["first_date"], cobertura["last_date"]))
    # Por encima de lo que da el tope del modelo y por debajo de lo que da un 50 %.
    objetivo = (maximo_a_mano(bruta, 0.35) + maximo_a_mano(bruta, 0.5)) / 2
    with pytest.raises(repo.InvalidOptimizationRequest, match="Sin solución: con un tope del 35,0 % por posición"):
        optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo)
    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo, constraints={"max_weight": 0.5})
    assert resultado["methodology"]["weight_bounds"] == [0.0, 0.5]
    assert max(resultado["target_return_portfolio"]["weights"].values()) <= 0.5 + 1e-6
    assert en_la_serie(lector, ids, resultado["target_return_portfolio"]) == pytest.approx(objetivo, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    # Y por abajo, con un 25 % ya no llega.
    with pytest.raises(repo.InvalidOptimizationRequest, match="Sin solución: con un tope del 25,0 % por posición"):
        optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo, constraints={"max_weight": 0.25})


def test_un_candado_se_respeta_y_entra_en_la_cuenta_de_hasta_donde_se_llega():
    medias = [0.0005, 0.003, 0.0028, 0.0026, 0.0024]
    filas = retornos_inventados(31, medias, [0.012, 0.015, 0.016, 0.017, 0.018], semanas=170)
    lector, ids = lector_semanal(filas)
    # Por encima del tope del 35 % que pondria el modelo: un candado manda.
    candados = {ids[0]: 0.5}
    objetivo = _objetivo_en_medio(lector, ids, locked_weights=candados)
    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo, locked_weights=candados)
    punto = resultado["target_return_portfolio"]
    assert punto["weights"][ids[0]] == pytest.approx(0.5, abs=1e-12)
    assert max(w for a, w in punto["weights"].items() if a != ids[0]) <= 0.35 + 1e-6
    assert sum(punto["weights"].values()) == pytest.approx(1, abs=1e-9)
    assert en_la_serie(lector, ids, punto) == pytest.approx(objetivo, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    with pytest.raises(repo.InvalidOptimizationRequest, match="con un tope del 35,0 % por posición y los candados, la media de la serie llega como mucho a un"):
        optimizar(lector, ids, "TARGET_RETURN", target_return=0.5, locked_weights=candados)
    # Un candado que no se puede cumplir se dice antes de hablar de rentabilidad.
    with pytest.raises(repo.InvalidOptimizationRequest, match="Sin solución: los candados suman"):
        optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo, locked_weights={ids[0]: 0.7, ids[1]: 0.7})


def test_la_rotacion_se_cumple_y_no_dice_que_ningun_activo_bata_al_tipo_sin_riesgo():
    filas = retornos_inventados(64, [0.003, 0.0028, 0.0026, 0.001, 0.0008, 0.0007], [0.015, 0.015, 0.015, 0.006, 0.006, 0.006], semanas=170)
    lector, ids = lector_semanal(filas)
    actuales = {a: 1 / 6 for a in ids}
    sin_rotacion = optimizar(lector, ids, "TARGET_RETURN", target_return=-1.0, current_weights=actuales)
    objetivo = en_la_serie(lector, ids, sin_rotacion["current_portfolio"]) + 0.002
    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo, current_weights=actuales, constraints={"max_turnover": 0.3})
    punto = resultado["target_return_portfolio"]
    # Una centesima de punto de holgura: lo que se puede pasar el solver, medido en 5e-6.
    assert sum(abs(punto["weights"][a] - actuales[a]) for a in ids) <= 0.3 + 1e-4
    assert en_la_serie(lector, ids, punto) == pytest.approx(objetivo, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    assert resultado["methodology"]["max_turnover"] == 0.3
    # Con rotacion, max_sharpe no se puede resolver: hay activos por encima del tipo, y el aviso no puede decir lo contrario.
    assert "MAX_SHARPE_UNDEFINED_FALLBACK" not in resultado["warnings"]
    assert "MAX_SHARPE_FROM_FRONTIER" in resultado["warnings"]
    with pytest.raises(repo.InvalidOptimizationRequest, match="y la rotación máxima, la media de la serie llega como mucho a un"):
        optimizar(lector, ids, "TARGET_RETURN", target_return=0.5, current_weights=actuales, constraints={"max_turnover": 0.3})


def test_el_limite_por_grupo_se_respeta():
    filas = retornos_inventados(64, [0.003, 0.0028, 0.0026, 0.001, 0.0008, 0.0007], [0.015] * 6, semanas=170)
    lector, ids = lector_semanal(filas)
    for i, aid in enumerate(ids):
        lector.raices[aid] = {"asset_id": aid, "asset_type": "ETF", "quality": {"status": "OK"},
                              "classification": {"asset_class": "RV" if i < 3 else "RF"}}
    grupos = [{"dimension": "asset_class", "upper": {"RV": 0.5}}]
    objetivo = _objetivo_en_medio(lector, ids, group_constraints=grupos)
    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo, group_constraints=grupos)
    punto = resultado["target_return_portfolio"]
    assert sum(w for a, w in punto["weights"].items() if a in ids[:3]) <= 0.5 + 1e-4
    assert en_la_serie(lector, ids, punto) == pytest.approx(objetivo, abs=TOLERANCIA_FRENTE_A_LA_FORMULA)
    with pytest.raises(repo.InvalidOptimizationRequest, match="y los límites por grupo, la media de la serie llega como mucho a un"):
        optimizar(lector, ids, "TARGET_RETURN", target_return=0.5, group_constraints=grupos)


def test_lo_que_se_queda_fuera_no_entra_en_la_medida_y_lo_actual_se_mide_sobre_lo_incluido():
    lector = universo(n=5)
    ids = sorted(lector.series)
    lector.raices["ACTIVO00"] = {"asset_id": "ACTIVO00", "asset_type": "ETF", "quality": {"status": "BLOCKED"}}
    objetivo = _objetivo_en_medio(lector, ids)
    actuales = {"ACTIVO00": 0.4, "ACTIVO01": 0.3, "ACTIVO02": 0.3}
    resultado = optimizar(lector, ids, "TARGET_RETURN", target_return=objetivo, current_weights=actuales)
    assert resultado["excluded_assets"] == [{"asset_id": "ACTIVO00", "reason": "QUALITY_BLOCKED"}]
    assert "ACTIVO00" not in resultado["target_return_portfolio"]["weights"]
    assert resultado["current_portfolio"]["weights"]["ACTIVO01"] == pytest.approx(0.5, abs=1e-12)
    # La misma medida que simular solo lo incluido, con sus pesos renormalizados.
    solo_incluido = repo_simular_con_pesos(lector, [{"asset_id": "ACTIVO01", "weight": 0.5}, {"asset_id": "ACTIVO02", "weight": 0.5}])
    for campo in ("cagr", "volatility", "sharpe", "max_drawdown"):
        assert resultado["target_return_measured"]["current"][campo] == pytest.approx(solo_incluido[campo], abs=1e-9), campo


# --- Lo que dice «Sin solucion» -----------------------------------------------------------------------------------------

@pytest.mark.parametrize("candados, rotacion, grupos, escrito", [
    (False, False, False, "con un tope del 35,0 % por posición,"),
    (True, False, False, "con un tope del 35,0 % por posición y los candados,"),
    (False, True, False, "con un tope del 35,0 % por posición y la rotación máxima,"),
    (False, False, True, "con un tope del 35,0 % por posición y los límites por grupo,"),
    (True, True, True, "con un tope del 35,0 % por posición, los candados, la rotación máxima y los límites por grupo,"),
])
def test_dice_cuales_son_los_limites(candados, rotacion, grupos, escrito):
    texto = motor._sin_solucion_por_rentabilidad(0.5, 0.123456, 0.35, candados, rotacion, grupos)
    assert escrito in texto
    # Hacia abajo, y no redondeado: quien escriba 12,34 % tiene cartera, y con 12,35 % no la tendria.
    assert "llega como mucho a un 12,34 %, y has pedido un 50,00 %." in texto
    assert texto.startswith("Sin solución:")
    assert texto.endswith("Baja el objetivo o sube el máximo por activo." if not (candados or rotacion or grupos) else "Baja el objetivo o suelta alguno de esos límites.")


def test_un_maximo_que_ya_no_se_puede_subir_no_se_aconseja():
    assert motor._sin_solucion_por_rentabilidad(0.5, 0.2, 0.99, False, False, False).endswith("y has pedido un 50,00 %. Baja el objetivo.")


def test_una_rentabilidad_negativa_lleva_su_signo():
    texto = motor._sin_solucion_por_rentabilidad(-0.01, -0.0234, 0.35, False, False, False)
    assert "llega como mucho a un −2,34 %" in texto
    assert "has pedido un −1,00 %" in texto


def test_la_media_de_la_serie_de_esta_prueba_es_la_de_a_mano():
    """Con series semanales no hay que elegir viernes: las rentabilidades de la serie, a mano, y la media por 52."""
    filas = retornos_inventados(31, [0.0045, 0.0040, 0.0008, 0.0006, 0.0005], [0.02, 0.019, 0.006, 0.005, 0.004], semanas=170)
    lector, ids = lector_semanal(filas)
    cobertura = optimizar(lector, ids, "TARGET_RETURN", target_return=-1.0)["coverage"]
    a_mano = np.asarray(retornos_de(lector, ids, cobertura["first_date"], cobertura["last_date"])).mean(axis=0) * 52
    medias = medias_de_la_serie(lector, ids)
    assert [medias[a] for a in ids] == pytest.approx(list(a_mano), abs=1e-12)


def test_la_formula_de_james_stein_de_esta_prueba_es_la_del_motor():
    """Si esto falla, lo que falla es la cuenta aparte, no el motor."""
    filas = retornos_inventados(31, [0.0045, 0.0040, 0.0008, 0.0006, 0.0005], [0.02, 0.019, 0.006, 0.005, 0.004], semanas=170)
    mu, _, delta = james_stein_a_mano(filas)
    del_motor, meta = motor.estimate_returns(filas)
    assert np.asarray(del_motor) == pytest.approx(mu, abs=1e-12)
    assert meta["return_shrinkage_intensity"] == pytest.approx(delta, abs=1e-4)
    S, _ = motor.estimate_covariance(filas, list("ABCDE"))
    assert np.asarray(S) == pytest.approx(ledoit_wolf_a_mano(filas) * 52, abs=1e-12)
