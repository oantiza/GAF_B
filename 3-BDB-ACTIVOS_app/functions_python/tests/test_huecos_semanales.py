"""
Huecos de una semana en las series (auditoria 29-09-2026, B-01 y B-04).

B-01: la ventana `latest - anos*366 dias` sobre una serie diaria completa producia 156
retornos semanales justos a 3A (minimo 156) y 261 a 5A (minimo 260); como el retorno
exigia semanas ISO consecutivas, UNA sola semana sin VL (Navidad) borraba dos retornos
y el fondo salia con INSUFFICIENT_HISTORY aunque tuviera el historico entero. Ahora
`_weekly_returns` puentea huecos de una semana (retorno a 14 dias en la semana destino)
y el minimo exige 48 semanas por ano de ventana (~92 %). Huecos mayores siguen cortando.

B-04: la serie rebasada SEMANAL encadenaba `nivel *= 1 + r` solo sobre las semanas
comunes: si a un activo le faltaba una semana, el movimiento de esa semana desaparecia
de TODAS las series. Ahora se rebasa sobre niveles semanales, como en la rama diaria.

Ejecuta: pytest functions_python/tests/test_huecos_semanales.py
"""
from datetime import date, timedelta
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.repository import (  # noqa: E402
    MIN_COMMON_OBSERVATIONS,
    MIN_WEEKS_PER_WINDOW_YEAR,
    _clear_price_series_cache,
    _load_asset_returns,
    _weekly_returns,
    backtest_portfolio,
    build_rebased_series,
    optimize_portfolio,
)

FIN = date(2026, 9, 25)  # viernes
NAVIDAD_2024 = (2024, 52)  # semana ISO del 23 al 29 de diciembre de 2024
NAVIDAD_2023 = (2023, 52)


@pytest.fixture(autouse=True)
def limpia_cache():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


def semana_iso(dia: date):
    iso = dia.isocalendar()
    return (iso.year, iso.week)


def serie_diaria(anios, semanas_sin_dato=(), salto=None, factor_salto=1.20, ultimo=FIN):
    """Dias habiles de `anios` anos (con sobra: la ventana la corta el motor), deriva
    suave y determinista. `semanas_sin_dato`: semanas ISO sin ningun punto (el VL no se
    publico). `salto`: semana ISO en cuyo lunes el valor se multiplica por `factor_salto`
    (el activo VIVE el movimiento, tenga o no dato esa semana)."""
    primero = ultimo - timedelta(days=365 * anios + 60)
    puntos = []
    dia = primero
    valor = 100.0
    i = 0
    while dia <= ultimo:
        semana = semana_iso(dia)
        if salto and semana == salto and dia.weekday() == 0:
            valor *= factor_salto
        if dia.weekday() < 5 and semana not in semanas_sin_dato:
            puntos.append({"date": dia.isoformat(), "value": round(valor, 6)})
        valor *= 1.0 + 0.0002 + ((i % 7) - 3) * 0.00004
        i += 1
        dia += timedelta(days=1)
    return puntos


def raiz(asset_id):
    return {
        "asset_id": asset_id,
        "asset_type": "FUND",
        "identity": {"name": asset_id, "currency": "EUR"},
        "quality": {"status": "OK"},
    }


class LectorFalso:
    def __init__(self, series):
        self.series = series

    def get_asset(self, asset_id):
        return raiz(asset_id) if asset_id in self.series else None

    def get_price_series(self, asset_id):
        return [{
            "schema_version": "asset-price-series.v1.2",
            "asset_id": asset_id,
            "currency": "EUR",
            "interval": "1d",
            "points": self.series[asset_id],
            "history_quality_status": "COMPLETE",
        }]

    def set(self, *_a, **_k):  # pragma: no cover
        raise AssertionError("El motor no debe escribir.")


def peticion_frontera(asset_ids, window):
    return {
        "schema_version": "portfolio-optimization-request.v1",
        "asset_ids": asset_ids,
        "window": window,
        "base_currency": "EUR",
        "frequency": "WEEKLY",
        "objective": "MIN_VOLATILITY",
        "frontier_points": 5,
    }


@pytest.mark.parametrize("objetivo, extra", [
    ("MAX_SHARPE", {}), ("MIN_VOLATILITY", {}), ("TARGET_RISK", {}), ("TARGET_RETURN", {"target_return": -1.0}),
])
def test_el_motor_regularizado_trata_los_huecos_como_la_simulacion(objetivo, extra):
    # Decision 40: una semana sin dato se arrastra y el activo sigue dentro; con tres semanas, fuera. Es lo que hace
    # la simulacion (`portfolio_horizon._aligned`). Si cada camino decidiera por su cuenta, no serian los mismos activos.
    lector = LectorFalso({
        "COMPLETO": serie_diaria(3),
        "OTRO": serie_diaria(3),
        "NAVIDAD": serie_diaria(3, semanas_sin_dato=(NAVIDAD_2024,)),
        "HUECO": serie_diaria(3, semanas_sin_dato=((2025, 10), (2025, 11), (2025, 12))),
    })
    _clear_price_series_cache()
    res = optimize_portfolio(lector, {**peticion_frontera(sorted(lector.series), "3Y"), "objective": objetivo, **extra})
    assert res["excluded_assets"] == [{"asset_id": "HUECO", "reason": "INSUFFICIENT_HISTORY"}]
    assert res["coverage"]["included_assets"] == 3


def retornos(lector, asset_id, window):
    _clear_price_series_cache()
    return _load_asset_returns(lector, asset_id, lector.get_asset(asset_id), window)


# --- B-01: el minimo deja margen y un hueco de una semana se puentea -----------------

def test_el_minimo_exige_48_semanas_por_ano_de_ventana():
    assert MIN_WEEKS_PER_WINDOW_YEAR == 48
    assert MIN_COMMON_OBSERVATIONS == {"1Y": 40, "3Y": 144, "5Y": 240, "10Y": 480}
    # ~92 % de las 52 semanas del ano: tolera hasta cuatro semanas sin dato por ano.
    assert 0.90 < MIN_WEEKS_PER_WINDOW_YEAR / 52 < 0.95
    # Y sigue siendo estrictamente mas exigente a mas anos (5A no es 3A).
    assert MIN_COMMON_OBSERVATIONS["3Y"] < MIN_COMMON_OBSERVATIONS["5Y"] < MIN_COMMON_OBSERVATIONS["10Y"]


def test_un_hueco_de_una_semana_emite_el_retorno_a_catorce_dias_y_lo_marca():
    semanal = [
        ((2026, 1), date(2026, 1, 2), 100.0),
        ((2026, 2), date(2026, 1, 9), 101.0),
        # la semana 3 no tiene dato
        ((2026, 4), date(2026, 1, 23), 103.0),
    ]
    rets, fechas, puenteadas = _weekly_returns(semanal)
    assert rets[(2026, 2)] == pytest.approx(0.01)
    assert rets[(2026, 4)] == pytest.approx(103.0 / 101.0 - 1.0)  # retorno a 14 dias
    assert (2026, 3) not in rets
    assert fechas[(2026, 4)] == "2026-01-23"
    assert puenteadas == {(2026, 4)}


def test_un_hueco_de_tres_semanas_sigue_cortando_la_serie():
    semanal = [
        ((2026, 1), date(2026, 1, 2), 100.0),
        ((2026, 2), date(2026, 1, 9), 101.0),
        # semanas 3, 4 y 5 sin dato
        ((2026, 6), date(2026, 2, 6), 105.0),
        ((2026, 7), date(2026, 2, 13), 106.0),
    ]
    rets, _fechas, puenteadas = _weekly_returns(semanal)
    assert set(rets) == {(2026, 2), (2026, 7)}  # la semana destino del hueco NO se emite
    assert puenteadas == set()


@pytest.mark.parametrize("window,anios", [("3Y", 3), ("5Y", 5)])
def test_una_semana_de_navidad_sin_vl_no_excluye_un_fondo_con_historico_completo(window, anios):
    lector = LectorFalso({
        "COMPLETO": serie_diaria(anios),
        "NAVIDAD": serie_diaria(anios, semanas_sin_dato=(NAVIDAD_2024,)),
    })
    completo = retornos(lector, "COMPLETO", window)
    navidad = retornos(lector, "NAVIDAD", window)

    # Solo se pierde el retorno de la propia semana sin dato: la siguiente se puentea.
    assert len(navidad.returns_by_week) == len(completo.returns_by_week) - 1
    assert NAVIDAD_2024 not in navidad.returns_by_week
    siguiente = (2025, 1)
    assert siguiente in navidad.returns_by_week
    assert navidad.bridged_weeks == frozenset({siguiente})
    assert len(navidad.returns_by_week) >= MIN_COMMON_OBSERVATIONS[window]

    _clear_price_series_cache()
    res = optimize_portfolio(lector, peticion_frontera(["COMPLETO", "NAVIDAD"], window))
    assert res["excluded_assets"] == []
    assert res["coverage"]["included_assets"] == 2


def test_dos_navidades_sin_vl_a_cinco_anos_tampoco_excluyen():
    lector = LectorFalso({
        "COMPLETO": serie_diaria(5),
        "NAVIDADES": serie_diaria(5, semanas_sin_dato=(NAVIDAD_2023, NAVIDAD_2024)),
    })
    _clear_price_series_cache()
    res = optimize_portfolio(lector, peticion_frontera(["COMPLETO", "NAVIDADES"], "5Y"))
    assert res["excluded_assets"] == []
    assert res["coverage"]["included_assets"] == 2


def test_un_hueco_de_tres_semanas_pierde_cuatro_retornos_y_no_se_puentea():
    hueco = ((2025, 10), (2025, 11), (2025, 12))
    lector = LectorFalso({
        "COMPLETO": serie_diaria(3),
        "HUECO": serie_diaria(3, semanas_sin_dato=hueco),
    })
    completo = retornos(lector, "COMPLETO", "3Y")
    con_hueco = retornos(lector, "HUECO", "3Y")

    # Tres semanas sin dato + la semana destino, que no se puentea: cuatro retornos menos.
    assert len(con_hueco.returns_by_week) == len(completo.returns_by_week) - 4
    assert (2025, 13) not in con_hueco.returns_by_week
    assert con_hueco.bridged_weeks == frozenset()


def test_un_fondo_con_meses_sin_publicar_sigue_saliendo_por_historico_insuficiente():
    # 16 semanas seguidas sin VL a 3A: 156 - 16 - 1 = 139 retornos < 144.
    hueco = tuple((2025, semana) for semana in range(10, 26))
    lector = LectorFalso({
        "COMPLETO": serie_diaria(3),
        "OTRO": serie_diaria(3),
        "AGUJERO": serie_diaria(3, semanas_sin_dato=hueco),
    })
    assert len(retornos(lector, "AGUJERO", "3Y").returns_by_week) < MIN_COMMON_OBSERVATIONS["3Y"]
    _clear_price_series_cache()
    res = optimize_portfolio(lector, peticion_frontera(["COMPLETO", "OTRO", "AGUJERO"], "3Y"))
    assert res["excluded_assets"] == [{"asset_id": "AGUJERO", "reason": "INSUFFICIENT_HISTORY"}]
    assert res["coverage"]["included_assets"] == 2


def test_el_backtest_semanal_no_avisa_de_ventana_colapsada_por_una_navidad():
    lector = LectorFalso({
        "COMPLETO": serie_diaria(3),
        "NAVIDAD": serie_diaria(3, semanas_sin_dato=(NAVIDAD_2024,)),
    })
    res = backtest_portfolio(lector, {
        "positions": [{"asset_id": "COMPLETO", "weight": 0.5}, {"asset_id": "NAVIDAD", "weight": 0.5}],
        "window": "3Y", "frequency": "WEEKLY",
    })
    cobertura = res["coverage"]
    assert cobertura["required_observations"] == MIN_COMMON_OBSERVATIONS["3Y"]
    assert cobertura["common_observations"] >= cobertura["required_observations"]
    assert "WINDOW_COLLAPSED" not in res["warnings"]


# --- B-04: la serie rebasada semanal no pierde el movimiento de la semana con hueco ---

def test_la_serie_rebasada_semanal_conserva_el_salto_de_la_semana_sin_dato():
    """Caso del repro: +20 % en una semana que a B le falta. Antes ambos acababan en 100."""
    semana = (2026, 20)
    lector = LectorFalso({
        "A": serie_diaria(1, salto=semana),
        "B": serie_diaria(1, salto=semana, semanas_sin_dato=(semana,)),
    })
    # Sin deriva, para que el nivel final sea exactamente el salto.
    for aid in ("A", "B"):
        lector.series[aid] = [
            {"date": p["date"], "value": 120.0 if semana_iso(date.fromisoformat(p["date"])) >= semana else 100.0}
            for p in lector.series[aid]
        ]
    res = build_rebased_series(lector, {"asset_ids": ["A", "B"], "window": "1Y", "frequency": "WEEKLY"})

    a = next(s for s in res["series"] if s["asset_id"] == "A")["values"]
    b = next(s for s in res["series"] if s["asset_id"] == "B")["values"]
    assert a[0] == b[0] == 100.0
    assert a[-1] == pytest.approx(120.0, abs=1e-6)
    assert b[-1] == pytest.approx(120.0, abs=1e-6)
    # La semana sin dato de B sale de las fechas comunes, pero su movimiento no se pierde.
    assert date.fromisocalendar(*semana, 1).isoformat() not in res["dates"]


def test_la_serie_rebasada_semanal_coincide_con_el_nivel_real_aunque_haya_hueco():
    semana = (2026, 10)  # dentro de la ventana 1A
    lector = LectorFalso({
        "A": serie_diaria(2),
        "B": serie_diaria(2, semanas_sin_dato=(semana,)),
    })
    res = build_rebased_series(lector, {"asset_ids": ["A", "B"], "window": "1Y", "frequency": "WEEKLY"})
    valores = {p["date"]: p["value"] for p in lector.series["A"]}
    a = next(s for s in res["series"] if s["asset_id"] == "A")["values"]
    fechas = res["dates"]

    def ultimo_valor_de_la_semana(lunes_iso):
        lunes = date.fromisoformat(lunes_iso)
        dias = [lunes + timedelta(days=k) for k in range(7)]
        return [valores[d.isoformat()] for d in dias if d.isoformat() in valores][-1]

    base = ultimo_valor_de_la_semana(fechas[0])
    for lunes, nivel in zip(fechas, a):
        assert nivel == pytest.approx(ultimo_valor_de_la_semana(lunes) / base * 100.0, abs=1e-3)


def test_cagr_y_maxima_caida_del_backtest_semanal_coinciden_con_el_diario_sin_huecos():
    """Serie sintetica sin huecos con una caida de varias semanas: dibujar en diario o en
    semanal no puede cambiar la rentabilidad anualizada ni el suelo del camino."""
    puntos = serie_diaria(3)
    # Caida del 15 % repartida en seis semanas y recuperacion lenta, a mitad de la ventana.
    inicio_caida = date(2025, 3, 3)
    fin_caida = inicio_caida + timedelta(weeks=6)
    fin_recuperacion = fin_caida + timedelta(weeks=20)
    ajustados = []
    for p in puntos:
        dia = date.fromisoformat(p["date"])
        factor = 1.0
        if inicio_caida <= dia < fin_caida:
            factor = 1.0 - 0.15 * (dia - inicio_caida).days / (fin_caida - inicio_caida).days
        elif fin_caida <= dia < fin_recuperacion:
            factor = 0.85 + 0.15 * (dia - fin_caida).days / (fin_recuperacion - fin_caida).days
        ajustados.append({"date": p["date"], "value": round(p["value"] * factor, 6)})
    lector = LectorFalso({"A": ajustados, "B": puntos})
    posiciones = [{"asset_id": "A", "weight": 0.6}, {"asset_id": "B", "weight": 0.4}]

    semanal = backtest_portfolio(lector, {"positions": posiciones, "window": "3Y", "frequency": "WEEKLY"})
    _clear_price_series_cache()
    diario = backtest_portfolio(lector, {"positions": posiciones, "window": "3Y", "frequency": "DAILY"})

    assert semanal["metrics"]["max_drawdown"] < -0.07  # la caida se ve en ambos
    assert abs(semanal["metrics"]["cagr"] - diario["metrics"]["cagr"]) < 0.005
    assert abs(semanal["metrics"]["max_drawdown"] - diario["metrics"]["max_drawdown"]) < 0.01
    assert abs(semanal["metrics"]["volatility"] - diario["metrics"]["volatility"]) < 0.005
