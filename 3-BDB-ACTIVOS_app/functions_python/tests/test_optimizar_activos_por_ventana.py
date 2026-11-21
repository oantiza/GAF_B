# -*- coding: utf-8 -*-
"""Hallazgo 12 (15-11-2026): cuantos activos caben en Optimizar depende de los datos de la ventana.

La regla, decidida por Oscar: el maximo de una ventana guarda la proporcion entre retornos semanales y activos que el
proyecto acepto a 3 anos (40 activos con los retornos de 3 anos, MAX_ACTIVOS_FRONTERA). Las cifras esperadas se escriben
aqui a mano, con su cuenta:

- Retornos de una ventana. El fin es un viernes y el inicio, la misma fecha `n` anos antes llevada al viernes anterior o
  igual, asi que de inicio a fin hay un numero entero de semanas. `n` anos son 365n dias mas los 29 de febrero que caen
  dentro; al bajar al viernes se anaden de 0 a 6 dias. Solo un multiplo de 7 cabe en ese tramo de 7 dias:
    1 ano:  365-366 dias, mas 0-6 -> 371 = 53 semanas -> 53 retornos.
    3 anos: 1.095-1.096, mas 0-6 -> 1.099 = 157 semanas -> 157 retornos.
    5 anos: 1.826-1.827, mas 0-6 -> 1.827 = 261 semanas -> 261 retornos.
    10 anos: 3.652-3.653, mas 0-6 -> 3.654 = 522 semanas -> 522 retornos.
  No depende del dia: cada ventana tiene siempre esos retornos.
- Maximo = 40 x retornos / 157, a la baja y sin pasar de 40:
    1 ano:  40 x 53 / 157 = 13,50 -> 13. Con 13 son 4,08 retornos por activo; con 14 serian 3,79, menos que los 3,93
            (157 / 40) aceptados a 3 anos.
    3 anos: 40 x 157 / 157 = 40.
    5 anos: 40 x 261 / 157 = 66,5 -> 40, porque el tope no se sube.
    10 anos: 40 x 522 / 157 = 133,0 -> 40.
"""
from datetime import date, timedelta
import os
from pathlib import Path
import re
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import portfolio_horizon as h  # noqa: E402
from optimization import repository as repo  # noqa: E402

HOY = date(2026, 10, 30)

RETORNOS_ESPERADOS = {"1Y": 53, "3Y": 157, "5Y": 261, "10Y": 522}
MAXIMO_ESPERADO = {"1Y": 13, "3Y": 40, "5Y": 40, "10Y": 40}

# El principio del texto con el que la pantalla reconoce un limite del calculo (src/core/appError.ts: LIMITE_PROPIO).
LIMITE_PROPIO = re.compile(r"^El cálculo admite \d+ \S+ como máximo y ")


@pytest.fixture(autouse=True)
def cache_limpia():
    repo._clear_price_series_cache()
    yield
    repo._clear_price_series_cache()


class Lector:
    def __init__(self, series):
        self.series = series

    def get_asset(self, aid):
        return {"asset_id": aid, "asset_type": "ETF", "quality": {"status": "OK"}, "identity": {"name": aid}}

    def get_price_series(self, aid):
        return [{"schema_version": "asset-price-series.v1.2", "currency": "EUR", "interval": "1d",
                 "points": self.series.get(aid, [])}]


def universo(n, *, recientes=0, desde=date(2019, 1, 1), semilla=11):
    """`n` activos con historia desde 2019 y `recientes` que solo cotizan desde marzo de 2026 (sin el ano entero)."""
    rng = np.random.default_rng(semilla)
    dias = []
    dia = desde
    while dia <= HOY:
        if dia.weekday() < 5:
            dias.append(dia)
        dia += timedelta(days=1)
    mercado = rng.normal(0.0003, 0.007, len(dias))
    series = {}
    for i in range(n + recientes):
        beta = 0.2 + 1.1 * (i % 9) / 8
        ruido = rng.normal(0.00025 - 0.00001 * (i % 13), 0.002 + 0.0004 * (i % 17), len(dias))
        niveles = 100 * np.cumprod(1 + beta * mercado + ruido)
        puntos = [{"date": d.isoformat(), "value": float(v)} for d, v in zip(dias, niveles)]
        if i >= n:
            puntos = [p for p in puntos if p["date"] >= "2026-03-02"]
        series[f"ACTIVO{i:02d}"] = puntos
    return Lector(series)


def tipo_libre(inicio, fin):
    return {"rate": 0.021, "coverage_ratio": 1.0, "first_date": inicio, "last_date": fin, "observations": 750}


def optimizar(lector, ventana, objetivo="MAX_SHARPE"):
    ids = sorted(lector.series)
    peticion = {
        "schema_version": "portfolio-optimization-request.v1",
        "asset_ids": ids, "window": ventana, "base_currency": "EUR", "frequency": "WEEKLY", "objective": objetivo,
        "current_weights": {a: 1 / len(ids) for a in ids},
        "expected_return_model": "HISTORICAL_SHRINKAGE",
        "frontier_points": 12,
        "constraints": {"long_only": True, "fully_invested": True, "min_weight": 0, "max_weight": 1},
    }
    return repo.optimize_portfolio(lector, peticion, today=HOY, risk_free_resolver=tipo_libre)


def viernes(desde, hasta):
    dia = desde + timedelta(days=(4 - desde.weekday()) % 7)
    while dia <= hasta:
        yield dia
        dia += timedelta(days=7)


# --------------------------------------------------------------------------- la cuenta


def test_cada_ventana_tiene_siempre_los_mismos_retornos_semanales():
    # Todos los viernes de 2024 a 2033: ventanas con ninguno, uno, dos y tres 29 de febrero dentro.
    for fin in viernes(date(2024, 1, 1), date(2033, 12, 31)):
        for ventana, esperados in RETORNOS_ESPERADOS.items():
            assert repo.retornos_semanales_de_la_ventana(ventana, fin) == esperados, (ventana, fin)


def test_el_maximo_de_cada_ventana_sale_de_la_cuenta():
    for fin in viernes(date(2024, 1, 1), date(2033, 12, 31)):
        for ventana, retornos in RETORNOS_ESPERADOS.items():
            limite = repo.maximo_de_activos_de_la_ventana(ventana, retornos, fin)
            assert limite["max_assets"] == MAXIMO_ESPERADO[ventana], (ventana, fin)
            assert limite["reference_window"] == "3Y" and limite["reference_weekly_returns"] == 157
            assert limite["reference_max_assets"] == h.MAX_ACTIVOS_FRONTERA == 40


def test_el_calendario_de_la_cuenta_es_el_del_periodo_de_verdad():
    """La cuenta no lee datos: aqui se compara con el periodo que Optimizar resuelve de verdad."""
    lector = universo(3)
    for ventana in ("1Y", "3Y", "5Y"):
        periodo, _fuera, _raices = h.periodo_para_optimizar(lector, sorted(lector.series), ventana, today=HOY)
        fin = date.fromisoformat(periodo.dates[-1])
        assert len(periodo.week_indices) - 1 == RETORNOS_ESPERADOS[ventana]
        assert repo.retornos_semanales_de_la_ventana(ventana, fin) == RETORNOS_ESPERADOS[ventana]


# --------------------------------------------------------------------------- un ano


def test_a_un_ano_el_maximo_se_optimiza_y_dice_su_limite():
    r = optimizar(universo(13), "1Y")
    assert r["coverage"]["included_assets"] == 13
    assert r["max_sharpe_portfolio"] is not None and len(r["frontier"]) > 0
    assert r["asset_limit"] == {"window": "1Y", "weekly_returns": 53, "max_assets": 13,
                                "reference_window": "3Y", "reference_weekly_returns": 157, "reference_max_assets": 40}


def test_a_un_ano_el_maximo_mas_uno_no_se_optimiza_y_dice_por_que():
    with pytest.raises(repo.OptimizationError) as fallo:
        optimizar(universo(14), "1Y")
    texto = str(fallo.value)
    assert LIMITE_PROPIO.match(texto)
    assert texto.startswith("El cálculo admite 13 activos como máximo y esta cartera tiene 14 con el periodo de 1 año:")
    assert "53 semanas de datos" in texto and "cómo se mueven juntos" in texto
    assert "Pasa a 3 años, que admite 40, o quita activos hasta dejar 13." in texto
    assert "se quedan fuera" not in texto


def test_el_limite_cuenta_los_que_entran_en_la_frontera_y_no_los_pedidos():
    # 16 pedidos, 3 sin el ano de serie: entran 13, que caben.
    r = optimizar(universo(13, recientes=3), "1Y")
    assert r["coverage"]["requested_assets"] == 16 and r["coverage"]["included_assets"] == 13
    assert {e["reason"] for e in r["excluded_assets"]} == {"INSUFFICIENT_HISTORY"}
    assert r["max_sharpe_portfolio"] is not None
    # 16 pedidos, 2 fuera: entran 14, que no caben, y el texto cuenta los 14 y dice que hay apartados. La cache de
    # series va por identificador, y ACTIVO13 cambia de serie entre los dos universos.
    repo._clear_price_series_cache()
    with pytest.raises(repo.OptimizationError) as fallo:
        optimizar(universo(14, recientes=2), "1Y")
    texto = str(fallo.value)
    assert "esta cartera tiene 14 con el periodo de 1 año (de los pedidos, 2 se quedan fuera" in texto


# --------------------------------------------------------------------------- 3 y 5 anos no cambian


def test_a_tres_anos_cuarenta_activos_se_siguen_optimizando():
    r = optimizar(universo(40), "3Y")
    assert r["coverage"]["included_assets"] == 40
    assert r["max_sharpe_portfolio"] is not None and len(r["frontier"]) > 0
    assert r["asset_limit"]["max_assets"] == 40 and r["asset_limit"]["weekly_returns"] == 157


@pytest.mark.parametrize("ventana", ["3Y", "5Y"])
@pytest.mark.parametrize("n", [2, 40])
def test_a_tres_y_cinco_anos_ninguna_cifra_cambia(monkeypatch, ventana, n):
    """La misma cartera con el limite y sin el: solo se anade `asset_limit`.

    Con el maximo en 40 a 3 y 5 anos en cualquier fecha (prueba de arriba) y 40 como tope de la peticion
    (CAP_OPTIMIZE_ASSETS), el limite no puede rechazar nada en esas ventanas; aqui se ve ademas que no toca una cifra.
    """
    con_limite = optimizar(universo(n), ventana)
    repo._clear_price_series_cache()
    original = repo.maximo_de_activos_de_la_ventana
    monkeypatch.setattr(repo, "maximo_de_activos_de_la_ventana",
                        lambda *args: {**original(*args), "max_assets": 10 ** 6})
    sin_limite = optimizar(universo(n), ventana)
    assert con_limite.pop("asset_limit")["max_assets"] == 40
    sin_limite.pop("asset_limit")
    assert con_limite == sin_limite


# --------------------------------------------------------------------------- la pantalla dice lo mismo


def test_la_pantalla_tiene_las_mismas_cifras_que_el_servidor():
    """La nota previa de Optimizar lee su tabla (src/core/historicalFrontierRequest.ts); tiene que ser esta cuenta."""
    fuente = (Path(__file__).resolve().parents[2] / "src" / "core" / "historicalFrontierRequest.ts").read_text(encoding="utf-8")
    tabla = {v: (int(s), int(m)) for v, s, m in
             re.findall(r'"(1Y|3Y|5Y|10Y)": \{ semanas: (\d+), maximo: (\d+) \}', fuente)}
    assert set(tabla) == set(repo.SUPPORTED_WINDOWS)
    for ventana, (semanas, maximo) in tabla.items():
        assert semanas == repo.retornos_semanales_de_la_ventana(ventana, HOY)
        assert maximo == repo.maximo_de_activos_de_la_ventana(ventana, semanas, HOY)["max_assets"]
