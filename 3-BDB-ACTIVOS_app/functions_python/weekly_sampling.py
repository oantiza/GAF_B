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
biblioteca estandar: lo importan ingest_asset, fund_ingest y el optimizador sin
riesgo de ciclo.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Dict, Iterable, List, Set, Tuple

WEEKS_PER_YEAR = 52
MONTHS_PER_YEAR = 12
# Anios por fechas (dias / 365,2425) en toda rentabilidad anualizada ex post: backtest,
# horizonte, «Mejorar cartera», cartera real, maestra y frontend (portfolioExtendedAnalytics).
# Tambien en la TIR desde la decision 49 (05-11-2026): antes conservaba ACT/365.
DAYS_PER_YEAR = 365.2425

# Hueco maximo (en dias entre inicios de semana ISO) que `weekly_returns` puentea:
# una unica semana sin observacion (14 dias). Huecos mayores cortan la serie.
MAX_BRIDGED_WEEK_GAP_DAYS = 14

# Hueco mediano (dias entre observaciones) hasta el que la serie se remuestrea a
# semanal: cubre el VL diario (1-3) y el semanal (7). Hasta 45 se trata como
# mensual (12/MONTHLY, politica B-06 de fund_ingest); mayor: no se anualiza la
# volatilidad porque no hay frecuencia del contrato que la describa.
MAX_WEEKLY_GAP_DAYS = 10
MAX_MONTHLY_GAP_DAYS = 45

# Retornos minimos para publicar la volatilidad de una ventana (cualquiera que
# sea su etiqueta). Sustituye a las 20 sesiones diarias de antes (que eran
# cuatro semanas): 20 retornos semanales son unos cinco meses. Con menos, la
# ventana no se publica. Para un VL mensual se conservan los 6 de fund_ingest.
MIN_WEEKLY_RETURNS = 20
MIN_MONTHLY_RETURNS = 6

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


def median_gap_days(dates: List[date]) -> int:
    """Hueco mediano en dias entre observaciones consecutivas (31 si no hay dos)."""
    gaps = sorted((current - previous).days for previous, current in zip(dates, dates[1:]) if current > previous)
    return gaps[len(gaps) // 2] if gaps else 31


def annualization_for_gap(median_gap: int) -> Tuple[int | None, str | None]:
    """Factor de anualizacion y frecuencia (metrics.v1.2) segun el hueco mediano.

    A1: un VL diario o semanal se mide en semanal (se remuestrea a la ultima
    observacion de cada semana ISO). Mensual: 12/MONTHLY (B-06). Mayor: None,
    no se anualiza.
    """
    if median_gap <= MAX_WEEKLY_GAP_DAYS:
        return WEEKS_PER_YEAR, "WEEKLY"
    if median_gap <= MAX_MONTHLY_GAP_DAYS:
        return MONTHS_PER_YEAR, "MONTHLY"
    return None, None


def min_weekly_returns(nominal_days: int | None) -> int:
    """Retornos semanales que debe tener una ventana nominal para anualizar."""
    if not nominal_days:
        return MIN_WEEKLY_RETURNS
    return max(MIN_WEEKLY_RETURNS, int(round(MIN_WEEKS_PER_WINDOW_YEAR * nominal_days / 365.0)))


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


def partial_risk_free_warning(resolved, window, first_date, last_date) -> dict | None:
    """Aviso RISK_FREE_RATE_PARTIAL_COVERAGE si la media €STR que devuelve el resolutor
    cubre menos de RISK_FREE_MIN_COVERAGE de la ventana; None si la cubre (o no lo dice).

    La maestra conserva la media parcial, como la simulacion: metrics.v1.3 no admite
    campos nuevos en la ventana, asi que el aviso se registra fuera del documento (resumen
    del refresco y log de la ingesta)."""
    if not isinstance(resolved, dict) or resolved.get("coverage_ratio") is None:
        return None
    try:
        coverage = float(resolved["coverage_ratio"])
    except (TypeError, ValueError):
        return None
    if not math.isfinite(coverage) or coverage >= RISK_FREE_MIN_COVERAGE:
        return None
    return {
        "warning": "RISK_FREE_RATE_PARTIAL_COVERAGE",
        "window": window,
        "coverage_ratio": round(coverage, 6),
        "first_date": str(first_date)[:10],
        "last_date": str(last_date)[:10],
    }


def window_volatility(points: List[Tuple[date, float]]) -> dict | None:
    """Volatilidad anualizada de una ventana, medida en la frecuencia que toca.

    `points`: [(fecha, valor)] ordenados, valores > 0.

    Devuelve None si no hay retornos suficientes para publicar la ventana. Si
    no, un dict con `returns_count` y, cuando el hueco permite anualizar,
    `annualized_volatility` y `frequency`:

    - hueco mediano <= 10 dias (VL diario o semanal): ultima observacion de cada
      semana ISO, retornos semana a semana (huecos de una semana puenteados),
      desviacion muestral x sqrt(52), `frequency: WEEKLY`;
    - hueco <= 45 (VL mensual): retornos consecutivos x sqrt(12), MONTHLY;
    - mayor: sin volatilidad (la rentabilidad geometrica la publica el llamador).
    """
    if len(points) < 2:
        return None
    dates = [point_date for point_date, _value in points]
    annualization, frequency = annualization_for_gap(median_gap_days(dates))
    if frequency == "WEEKLY":
        returns, _dates, _bridged = weekly_returns(weekly_last_observations(points))
        values = list(returns.values())
        if len(values) < MIN_WEEKLY_RETURNS:
            return None
    else:
        values = [current / previous - 1.0 for (_d0, previous), (_d1, current) in zip(points, points[1:])
                  if previous > 0 and current > 0]
        if len(values) < MIN_MONTHLY_RETURNS:
            return None
    out = {"returns_count": len(values)}
    if annualization:
        out["annualized_volatility"] = round(sample_volatility(values, annualization), 8)
        out["frequency"] = frequency
    return out


def window_complete(volatility: dict | None, nominal_days: int | None) -> bool:
    """Si la ventana tiene observaciones bastantes para anualizar rentabilidad y
    Sharpe con su etiqueta. Solo aplica al muestreo semanal: en mensual manda
    unicamente el recorrido en dias (window_span_ok), como hasta ahora."""
    if not volatility:
        return False
    if volatility.get("frequency") != "WEEKLY":
        return True
    return int(volatility.get("returns_count") or 0) >= min_weekly_returns(nominal_days)
