# -*- coding: utf-8 -*-
"""Dibujar en diario, medir en semanal (backtest_portfolio).

El grafico de la cartera se pinta en diario, pero el VL de los fondos se publica
con retraso: la serie diaria esta autocorrelacionada y anualizarla con 252 infla
la volatilidad y sesga la correlacion a la baja. Por eso CAGR, volatilidad,
Sharpe y correlacion se miden SIEMPRE sobre el remuestreo semanal.

La maxima caida es la excepcion, y a proposito: no se anualiza, es el suelo real
del camino. Se mide sobre la serie que se dibuja para que el numero impreso
coincida con lo que el cliente ve en el grafico. Decision de Oscar, 03-09-2026.

Ejecuta: pytest functions_python/tests/test_backtest_measurement_frequency.py
"""
from datetime import date, timedelta
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.repository import (  # noqa: E402
    _clear_price_series_cache,
    backtest_portfolio,
)

UNO = "LU0000000UNO"
DOS = "LU0000000DOS"
INICIO = date(2024, 1, 1)
FIN = date(2026, 9, 1)


def _miercoles_antes(dia):
    while dia.weekday() != 2:
        dia -= timedelta(days=1)
    return dia


# Miercoles dentro de la ventana de un anio: el desplome ocurre y se recupera en
# la misma semana, asi que el remuestreo semanal (viernes) no lo ve y el diario si.
DIA_DEL_DESPLOME = _miercoles_antes(FIN - timedelta(days=90))


@pytest.fixture(autouse=True)
def limpia_cache():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


def dias_habiles(desde, hasta):
    dia = desde
    while dia <= hasta:
        if dia.weekday() < 5:
            yield dia
        dia += timedelta(days=1)


def raiz(asset_id, nombre):
    return {
        "asset_id": asset_id,
        "asset_type": "FUND",
        "identity": {"name": nombre, "currency": "EUR"},
        "quality": {"status": "OK"},
    }


def serie(asset_id, con_desplome):
    """Subida suave y determinista; opcionalmente un hoyo intrasemana."""
    por_anio = {}
    valor = 100.0
    for dia in dias_habiles(INICIO, FIN):
        valor *= 1.0002
        publicado = valor
        if con_desplome and dia == DIA_DEL_DESPLOME:
            publicado = valor * 0.90  # -10% el miercoles, recuperado el jueves
        por_anio.setdefault(dia.year, []).append(
            {"date": dia.isoformat(), "value": round(publicado, 6)}
        )
    docs = []
    for anio, puntos in sorted(por_anio.items()):
        docs.append({
            "schema_version": "asset-price-series.v1.2",
            "asset_id": asset_id,
            "asset_type": "FUND",
            "series_type": "NAV",
            "source": "EODHD",
            "source_price_id": "EODHD:%s" % asset_id,
            "source_listing_id": "EODHD:%s" % asset_id,
            "document_id": "EODHD_%s_%d" % (asset_id, anio),
            "currency": "EUR",
            "interval": "1d",
            "year": anio,
            "points": puntos,
            "first_date": puntos[0]["date"],
            "last_date": puntos[-1]["date"],
            "observations_count": len(puntos),
            "history_quality_status": "COMPLETE",
            "updated_at": "2026-09-03T00:00:00Z",
        })
    return docs


class LectorFalso:
    def __init__(self):
        self.roots = {UNO: raiz(UNO, "Fondo uno"), DOS: raiz(DOS, "Fondo dos")}
        self.series = {UNO: serie(UNO, True), DOS: serie(DOS, False)}

    def get_asset(self, asset_id):
        return self.roots.get(asset_id)

    def get_price_series(self, asset_id):
        return self.series.get(asset_id, [])

    def set(self, *_a, **_k):  # pragma: no cover
        raise AssertionError("El backtest no debe escribir.")


def corre(frequency):
    posiciones = [{"asset_id": UNO, "weight": 0.5}, {"asset_id": DOS, "weight": 0.5}]
    return backtest_portfolio(
        LectorFalso(),
        {"positions": posiciones, "period": "1Y", "frequency": frequency},
        risk_free_rate=0.02,
    )


def test_el_contrato_declara_como_se_ha_medido_cada_cosa():
    diario = corre("DAILY")
    semanal = corre("WEEKLY")

    assert diario["frequency"] == "DAILY"
    assert diario["metrics_frequency"] == "WEEKLY"
    assert diario["max_drawdown_frequency"] == "DAILY"

    assert semanal["frequency"] == "WEEKLY"
    assert semanal["metrics_frequency"] == "WEEKLY"
    assert semanal["max_drawdown_frequency"] == "WEEKLY"


def test_la_serie_dibujada_es_diaria_pero_las_metricas_no_cambian():
    diario = corre("DAILY")
    semanal = corre("WEEKLY")

    # Se dibuja mucho mas fino...
    assert len(diario["portfolio_series"]) > 3 * len(semanal["portfolio_series"])

    # ...y aun asi la volatilidad y el CAGR salen practicamente iguales, porque
    # ambos se miden en semanal. Anualizando el diario con 252 se irian a >2x.
    assert abs(diario["metrics"]["volatility"] - semanal["metrics"]["volatility"]) < 0.01
    assert abs(diario["metrics"]["cagr"] - semanal["metrics"]["cagr"]) < 0.01


def test_la_maxima_caida_diaria_ve_el_suelo_que_la_semanal_se_salta():
    diario = corre("DAILY")
    semanal = corre("WEEKLY")

    # El hoyo del miercoles pesa el 50% de la cartera: ~-5% en diario.
    assert diario["metrics"]["max_drawdown"] < -0.04
    # El viernes ya estaba recuperado: la serie semanal ni se entera.
    assert semanal["metrics"]["max_drawdown"] > -0.005
    assert diario["metrics"]["max_drawdown"] < semanal["metrics"]["max_drawdown"]


def test_la_correlacion_se_mide_en_semanal_se_dibuje_como_se_dibuje():
    diario = corre("DAILY")
    semanal = corre("WEEKLY")

    assert len(diario["correlation_matrix"]) == 2
    assert abs(diario["correlation_matrix"][0][1] - semanal["correlation_matrix"][0][1]) < 0.05


# --- CRIT-04 + ALTA-01 (auditoria 16-10-2026) -------------------------------------------
# Un hueco de cuatro semanas en UN activo deja un salto en la ventana comun. El CAGR se
# anualiza por fechas (dias / 365,2425) y la volatilidad es la muestral de los retornos
# entre semanas separadas como mucho 14 dias: el salto no cuenta como una semana.

HUECO_DESDE = FIN - timedelta(days=200)
HUECO_HASTA = HUECO_DESDE + timedelta(days=28)


class LectorConHueco(LectorFalso):
    def __init__(self):
        super().__init__()
        for doc in self.series[DOS]:
            doc["points"] = [p for p in doc["points"]
                             if not (HUECO_DESDE <= date.fromisoformat(p["date"]) < HUECO_HASTA)]


def corre_con_hueco(frequency):
    posiciones = [{"asset_id": UNO, "weight": 0.5}, {"asset_id": DOS, "weight": 0.5}]
    return backtest_portfolio(
        LectorConHueco(),
        {"positions": posiciones, "period": "1Y", "frequency": frequency},
        risk_free_rate=0.02,
    )


def _medida_semanal(resultado):
    """Ultima observacion de cada semana ISO de la serie dibujada: [(fecha, valor)]."""
    from weekly_sampling import weekly_last_observations
    puntos = [(date.fromisoformat(p["date"]), p["value"]) for p in resultado["portfolio_series"]]
    return [(fecha, valor) for _clave, fecha, valor in weekly_last_observations(puntos)]


def _cagr_del_frontend(resultado):
    """annualizeByElapsedTime de portfolioExtendedAnalytics.ts sobre la serie dibujada:
    primera y ultima observacion, dias / 365,2425."""
    serie = resultado["portfolio_series"]
    dias = (date.fromisoformat(serie[-1]["date"]) - date.fromisoformat(serie[0]["date"])).days
    return (serie[-1]["value"] / serie[0]["value"]) ** (365.2425 / dias) - 1


@pytest.mark.parametrize("frequency", ["WEEKLY", "DAILY"])
def test_un_hueco_no_cuenta_como_una_semana_en_cagr_ni_volatilidad(frequency):
    from weekly_sampling import sample_volatility
    resultado = corre_con_hueco(frequency)
    medida = _medida_semanal(resultado)
    # El CAGR va de la primera a la ultima fecha de la serie dibujada (en WEEKLY coincide
    # con la medida); la volatilidad, en semanal.
    assert resultado["metrics"]["cagr"] == pytest.approx(_cagr_del_frontend(resultado), abs=1e-12)

    saltos = [(b[0] - a[0]).days for a, b in zip(medida, medida[1:])]
    assert max(saltos) > 14  # el hueco esta en la ventana comun
    validos = [b[1] / a[1] - 1 for a, b in zip(medida, medida[1:]) if (b[0] - a[0]).days <= 14]
    assert len(validos) < len(medida) - 1
    assert resultado["metrics"]["volatility"] == pytest.approx(sample_volatility(validos, 52), abs=1e-12)
    assert resultado["metrics"]["sharpe"] == pytest.approx(
        (resultado["metrics"]["cagr"] - resultado["metrics"]["rf_rate"]) / resultado["metrics"]["volatility"])


def test_el_cagr_diario_se_ancla_en_la_primera_fecha_como_el_frontend():
    # Segunda pasada (17-10-2026): con la serie empezando en lunes, el cierre de la primera
    # semana ISO es el viernes; anclar ahi el CAGR no coincidia con portfolio_horizon ni con
    # portfolioExtendedAnalytics, que miden de la primera a la ultima observacion.
    posiciones = [{"asset_id": UNO, "weight": 0.5}, {"asset_id": DOS, "weight": 0.5}]
    resultado = backtest_portfolio(LectorFalso(), {"positions": posiciones, "period": "3Y", "frequency": "DAILY"},
                                   risk_free_rate=0.02)
    serie = resultado["portfolio_series"]
    assert date.fromisoformat(serie[0]["date"]).weekday() == 0  # lunes
    assert resultado["metrics"]["cagr"] == pytest.approx(_cagr_del_frontend(resultado), abs=1e-12)
    medida = _medida_semanal(resultado)
    anclado_en_semana = (medida[-1][1] / medida[0][1]) ** (365.2425 / (medida[-1][0] - medida[0][0]).days) - 1
    assert abs(resultado["metrics"]["cagr"] - anclado_en_semana) > 1e-9  # el anclaje antiguo era otro
    semanal = backtest_portfolio(LectorFalso(), {"positions": posiciones, "period": "3Y", "frequency": "WEEKLY"},
                                 risk_free_rate=0.02)
    assert semanal["metrics"]["cagr"] == pytest.approx(_cagr_del_frontend(semanal), abs=1e-12)


def test_sin_huecos_la_volatilidad_es_la_muestral_de_weekly_sampling():
    from weekly_sampling import sample_volatility
    resultado = corre("WEEKLY")
    medida = _medida_semanal(resultado)
    retornos = [b[1] / a[1] - 1 for a, b in zip(medida, medida[1:])]
    assert resultado["metrics"]["volatility"] == pytest.approx(sample_volatility(retornos, 52), abs=1e-12)
