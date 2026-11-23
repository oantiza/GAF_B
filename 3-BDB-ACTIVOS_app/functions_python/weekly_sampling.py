# -*- coding: utf-8 -*-
"""Muestreo semanal comun a la maestra y al optimizador.

A1 (auditoria 29-09): las metricas por activo de la maestra (metrics/latest:
volatilidad y Sharpe por ventana) se calculaban sobre rendimientos DIARIOS
(x sqrt(252)) mientras el resto del programa mide en SEMANAL: el optimizador
(optimization/repository.py), la cartera real (portfolio_real/engine.py, borrado el
17-11-2026) y el horizonte (portfolio_horizon.py). Un mismo fondo de RV daba 12,74 % de
volatilidad en diario y 14,36 % en semanal. Decision de producto: graficos en
diario, MEDIR en semanal (vol, Sharpe, correlaciones, frontera); el drawdown
sigue en diario porque es una propiedad del camino.

Este modulo es la fuente unica de la regla de semana --ultima observacion de
cada semana ISO, retornos semana a semana, factor 52-- para que la maestra y el
optimizador publiquen la misma cifra sobre la misma serie. Solo importa la
biblioteca estandar: lo importan el optimizador y el horizonte sin riesgo de ciclo.

21-11-2026 (decision 37 del censo CENSO_BASE_VIEJA_2026-11-21.md): el estimador semanal
de la maestra vieja (`GEOMETRIC_CAGR` / `WEEKLY` en metrics/latest, que calculaban
`ingest_asset.build_metrics_latest` y `fund_ingest`) se borro con ella, y con el sus
piezas de aqui (`window_volatility`, `window_complete`, `min_weekly_returns`,
`partial_risk_free_warning`, `annualization_for_gap`, `median_gap_days`). La base nueva
mide con el metodo propio (EXTRACTOR_MONTHLY_V1). Lo que queda es lo que usan el
optimizador, el horizonte y «Mejorar cartera». Estan en la etiqueta de Git
`referencia-base-vieja-2026-11-21`.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Dict, Iterable, List, Set, Tuple

WEEKS_PER_YEAR = 52
# Anios por fechas (dias / 365,2425) en toda rentabilidad anualizada ex post: backtest,
# horizonte, «Mejorar cartera», cartera real, maestra y frontend (portfolioExtendedAnalytics).
# Tambien en la TIR desde la decision 49 (05-11-2026): antes conservaba ACT/365.
DAYS_PER_YEAR = 365.2425

# Hueco maximo (en dias entre inicios de semana ISO) que `weekly_returns` puentea:
# una unica semana sin observacion (14 dias). Huecos mayores cortan la serie.
MAX_BRIDGED_WEEK_GAP_DAYS = 14

# Retornos semanales minimos por anio nominal de ventana para anualizar la
# rentabilidad y el Sharpe: 44 = 0,85 x 52, la misma cobertura (MIN_WINDOW_COVERAGE)
# con la que `window_span_ok` ya valida el recorrido en dias. Asi las dos
# comprobaciones dicen lo mismo: una serie diaria sin huecos que cubre el 85 %
# de la ventana siempre pasa las dos, y una con meses sin dato --recorrido
# largo, pocas semanas-- no pasa esta. El optimizador exige 48/anio
# (MIN_COMMON_OBSERVATIONS: 40/144/240/480) porque alli una semana sin dato en
# UN activo se la lleva a toda la frontera; aqui cada activo se mide solo.
MIN_WEEKS_PER_WINDOW_YEAR = 44

# Dias naturales minimos para anualizar una rentabilidad. Fuente unica para la maestra
# (fund_ingest e ingest_asset, que la reexportan), y lo fue para la cartera real
# (portfolio_real/engine.py, sobre sus dias medidos; I-7, sexta pasada; borrado el 17-11-2026). Anualizar una
# ventana de semanas da cifras sin sentido, y en geometrico el disparate es mayor que
# en la extrapolacion lineal que se usaba antes.
#
# 330 y no 365: la ventana "1y" se define como last_date - 365 dias, asi que su
# recorrido real nunca llega a 365 salvo que haya cotizacion justo el dia del
# corte. Con el umbral en 365 la ventana anual se perdia o no segun cayera el
# primer dia habil -- una moneda al aire por activo. Se vio en la pasada en seco
# del 03-09: dos fondos con recorrido de 364 dias se quedaban sin rentabilidad
# anual. En la cartera real pasaba lo mismo con un año natural (01-01 a 31-12 son
# 364 dias medidos). 330 dias (~11 meses) deja pasar cualquier ventana anual con
# calendario normal y sigue descartando un tramo de tres meses.
MIN_ANNUALIZATION_DAYS = 330

# Cobertura minima de la €STR sobre una ventana para tratar su media como completa
# (quinta pasada, I-2). Por debajo, la simulacion avisa con RISK_FREE_RATE_PARTIAL_COVERAGE,
# la maestra lo registra en el resumen del refresco y la cartera real usa su respaldo si lo
# tiene (el €STR capitalizado de la base desde la B-70, que tampoco cubre antes). La €STR
# empieza el 01-10-2019: hoy toda ventana de 10 años la cubre solo en parte.
RISK_FREE_MIN_COVERAGE = 0.95

# Retornos semanales minimos para publicar el Sortino ex post: los mismos 26 que
# `sortinoRatio` (src/core/portfolioExtendedAnalytics.ts) en el informe interno.
SORTINO_MIN_WEEKLY_RETURNS = 26


def week_start(key: Tuple[int, int]) -> date:
    return date.fromisocalendar(key[0], key[1], 1)


def weekly_last_observations(points: Iterable[Tuple[date, float]]) -> List[Tuple[Tuple[int, int], date, float]]:
    """Ultima observacion de cada semana ISO: [(clave (anio, semana), fecha, valor)]."""
    by_week: Dict[Tuple[int, int], Tuple[date, float]] = {}
    for point_date, value in points:
        iso = point_date.isocalendar()
        key = (iso.year, iso.week)
        previous = by_week.get(key)
        if previous is None or point_date > previous[0]:
            by_week[key] = (point_date, value)
    return [(key, item[0], item[1]) for key, item in sorted(by_week.items(), key=lambda x: week_start(x[0]))]


def weekly_returns(weekly: List[Tuple[Tuple[int, int], date, float]]) -> Tuple[Dict[Tuple[int, int], float], Dict[Tuple[int, int], str], Set[Tuple[int, int]]]:
    """Retornos semanales {semana: r} a partir de la ultima observacion de cada semana.

    Devuelve (retornos, fechas, puenteadas). El retorno de una semana se calcula contra
    la semana ISO inmediatamente anterior (7 dias). 29-09-2026 (B-01): si falta UNA
    semana entre dos observadas (14 dias entre inicios de semana) se emite en la semana
    destino el retorno a 14 dias y se marca en `puenteadas`; antes ese hueco borraba dos
    retornos (el de la semana sin dato y el de la siguiente) y una sola semana de
    Navidad sin VL bastaba para bajar del minimo de la ventana. Un unico retorno a dos
    semanas entre ~150 pesa poco en media y covarianza; huecos mayores no se puentean y
    siguen cortando la serie, para que un fondo con meses sin publicar no pase por
    completo.
    """
    returns: Dict[Tuple[int, int], float] = {}
    dates: Dict[Tuple[int, int], str] = {}
    bridged: Set[Tuple[int, int]] = set()
    previous = None
    for item in weekly:
        key, point_date, value = item
        if previous is not None:
            prev_key, _prev_date, prev_value = previous
            gap_days = (week_start(key) - week_start(prev_key)).days
            if 7 <= gap_days <= MAX_BRIDGED_WEEK_GAP_DAYS and prev_value > 0:
                returns[key] = value / prev_value - 1.0
                dates[key] = point_date.isoformat()
                if gap_days > 7:
                    bridged.add(key)
        previous = item
    return returns, dates, bridged


def sample_volatility(values: List[float], annualization: int) -> float:
    """Desviacion tipica muestral (n-1) anualizada; la misma que la diagonal de una
    covarianza muestral anualizada."""
    if len(values) < 2:
        return 0.0
    average = sum(values) / len(values)
    variance = sum((value - average) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(max(0.0, variance)) * math.sqrt(annualization)


def ex_post_sharpe(annualized_return, risk_free_rate, annualized_volatility, default=None):
    """Sharpe ex post unico (decision 6.3 de Oscar, 17-10-2026): (CAGR - rf) / sigma.

    - `annualized_return`: CAGR de la serie en la ventana, por fechas (DAYS_PER_YEAR).
    - `risk_free_rate`: tasa sin riesgo de ESA ventana (media €STR del BCE; en la cartera
      real, el €STR capitalizado de la base si el BCE no responde; decision B-70).
    - `annualized_volatility`: volatilidad anualizada de la misma serie y ventana (semanal,
      muestral n-1, x raiz(52); mensual x raiz(12) en los VL mensuales de la maestra).

    `default` si falta un dato o la volatilidad es 0. Lo usan el backtest, el horizonte,
    «Mejorar cartera», la cartera real y metrics/latest. El Sharpe del optimizador es
    otro: el «Sharpe del modelo», sobre la media aritmetica esperada (robust_engine)."""
    values = (annualized_return, risk_free_rate, annualized_volatility)
    if any(value is None or not math.isfinite(float(value)) for value in values):
        return default
    if float(annualized_volatility) <= 1e-12:
        return default
    return (float(annualized_return) - float(risk_free_rate)) / float(annualized_volatility)


def ex_post_sortino(annualized_return, risk_free_rate, weekly_period_returns, default=None):
    """Sortino ex post (quinta pasada, I-3, 17-10-2026): (CAGR - rf) / desviacion bajista.

    Misma definicion que `sortinoRatio` (src/core/portfolioExtendedAnalytics.ts), con el
    mismo numerador y la misma rf que `ex_post_sharpe`, para que Sharpe y Sortino no
    salgan nunca con signo contrario:

    - rf_s = (1 + rf)^(1/52) - 1, la rf semanal equivalente;
    - DD = raiz(media(min(0, r_s - rf_s)^2)) x raiz(52), con la media sobre TODAS las
      semanas (las que no caen por debajo de rf_s cuentan como 0);
    - al menos SORTINO_MIN_WEEKLY_RETURNS retornos semanales.

    `default` si falta un dato, hay menos semanas de las exigidas o DD es 0 (con la
    misma guarda de 1e-12 que la volatilidad del Sharpe)."""
    values = (annualized_return, risk_free_rate)
    if any(value is None or not math.isfinite(float(value)) for value in values):
        return default
    returns = [float(value) for value in weekly_period_returns or []
               if value is not None and math.isfinite(float(value))]
    if len(returns) < SORTINO_MIN_WEEKLY_RETURNS:
        return default
    rate = float(risk_free_rate)
    if rate <= -1.0:
        return default
    weekly_rate = (1.0 + rate) ** (1.0 / WEEKS_PER_YEAR) - 1.0
    downside = math.sqrt(
        sum(min(0.0, value - weekly_rate) ** 2 for value in returns) / len(returns)
    ) * math.sqrt(WEEKS_PER_YEAR)
    if downside <= 1e-12:
        return default
    return (float(annualized_return) - rate) / downside
