# -*- coding: utf-8 -*-
"""Motor de «Mejorar cartera» (modulo PURO; sin Firebase ni I/O).

Modalidad M1 del plan (docs/PLAN_MEJORA_CARTERA_EQUIVALENTES_2026-10-13.md):
sustituir fondos de una cartera por candidatos equivalentes CONSERVANDO los pesos,
y aceptar la propuesta solo si no empeora ningun criterio obligatorio y mejora al
menos uno de forma relevante. Todo sobre la misma ventana comun, en semanal, con
la misma tasa sin riesgo y midiendo igual que `backtest_portfolio` (serie de
cartera = suma de niveles rebasados por peso, sin rebalanceo; CAGR geometrico con
los anios por fechas, dias / 365,2425; volatilidad MUESTRAL (n-1) de retornos
semanales x raiz(52), como weekly_sampling.sample_volatility; caida maxima sobre
la serie medida).

CRIT-04 / ALTA-01 (auditoria 16-10-2026): un hueco de varias semanas en la ventana
comun ya no cuenta como una semana. Solo hay retorno entre observaciones separadas
como mucho MAX_BRIDGED_WEEK_GAP_DAYS (14 dias, la misma regla que returns_by_week);
el salto sobre un hueco mayor queda fuera de la volatilidad y del tracking error,
pero el CAGR lo recoge entero porque mide nivel final / inicial en tiempo real.

Validacion fuera de muestra: las combinaciones se eligen en la VENTANA DE SELECCION
(los dos primeros tercios) y solo valen si superan las puertas y aportan una mejora
relevante en la VENTANA DE CONFIRMACION (el ultimo tercio), ademas de igualar o
superar a la original en la mayoria de las ventanas moviles de un anio. Sin esto
el motor perseguiria rentabilidades pasadas.

Equivalencia por series (capa 3): correlacion y tracking error semanal entre cada
candidato y el fondo al que sustituye; por debajo del umbral de su clase el candidato
no entra aunque comparta etiquetas.

Un dato que falta (coste de un fondo, etiqueta) deja el criterio como NOT_EVALUABLE:
nunca cuenta como cumplido ni como mejora. El coste se mide por lo que cambia en los fondos
que se sustituyen, asi que solo lo apaga el dato de lo que sale o de lo que entra; el de un
fondo que se queda solo deja sin cifra el coste de la cartera, y sin esa cifra el coste no
cuenta como mejora relevante. Una accion llega con coste cero, por la decision 10.
"""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List, Optional, Sequence, Set, Tuple

from weekly_sampling import DAYS_PER_YEAR, MAX_BRIDGED_WEEK_GAP_DAYS, MIN_ANNUALIZATION_DAYS, ex_post_sharpe

SCHEMA_VERSION = "portfolio-improvement.v1"
WEEKS_PER_YEAR = 52
COST_LABEL = "Coste corriente ponderado"

STATUS_PROPOSAL = "PROPOSAL"
STATUS_NO_IMPROVEMENT = "NO_IMPROVEMENT"
STATUS_INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
STATUS_INFEASIBLE = "INFEASIBLE"
# 15-11-2026: el tramo de seleccion o el de confirmacion no llega a MIN_ANNUALIZATION_DAYS. No se anualiza menos de 330
# dias, la regla del proyecto, y sin rentabilidad anualizada no hay con que comparar: no se calcula una propuesta.
STATUS_WINDOW_TOO_SHORT = "WINDOW_TOO_SHORT"
WINDOW_NAMES = {"selection": "selección", "confirmation": "confirmación"}

DEFAULT_THRESHOLDS: Dict[str, object] = {
    # Puertas: la propuesta no puede empeorar mas que esto (decimales; pp = puntos).
    "max_volatility_increase": 0.003,     # +0,30 pp
    "max_drawdown_worsening": 0.01,       # 1 pp mas de caida
    "max_sharpe_decrease": 0.02,
    "max_return_decrease": 0.0025,        # −0,25 pp anualizados
    "max_cost_increase": 0.0,
    # Mejora relevante: al menos una.
    "min_return_improvement": 0.005,
    "min_sharpe_improvement": 0.10,
    "min_cost_reduction": 0.0015,
    "min_drawdown_improvement": 0.02,
    "min_volatility_reduction": 0.005,
    # Equivalencia por series, por clase economica del fondo original. Calibrado con la
    # pasada en seco sobre la maestra (13-10-2026): dos fondos activos de la misma categoria
    # de RV correlacionan 0,78-0,84 con 5-7 % de tracking error; con 0,85 / 4 % no entraba
    # casi ninguno. En RF a corto plazo la correlacion no mide nada (ver low_volatility_cutoff).
    "min_correlation": {"EQUITY": 0.75, "FIXED_INCOME": 0.60, "MIXED": 0.65, "MONEY_MARKET": 0.0, "DEFAULT": 0.65},
    "max_tracking_error": {"EQUITY": 0.08, "FIXED_INCOME": 0.04, "MIXED": 0.06, "MONEY_MARKET": 0.015, "DEFAULT": 0.08},
    # Por debajo de esta volatilidad anual del fondo original (casi monetario) la correlacion
    # no se exige: solo el tracking error acota la equivalencia.
    "low_volatility_cutoff": 0.02,
    # Desviacion maxima de exposicion por dimension (peso agregado por etiqueta).
    "max_group_deviation": {"asset_class": 0.03, "region": 0.03, "currency": 0.05},
    # Ventanas y consistencia.
    "selection_fraction": 2.0 / 3.0,
    "rolling_weeks": 52,
    "rolling_step_weeks": 4,
    "min_consistency": 0.60,
    # Busqueda.
    "max_substitutions": 3,
    "max_proposals": 3,
    "exhaustive_limit": 5000,
    "min_observations": 144,
}

NUMERIC_THRESHOLD_KEYS = (
    "max_volatility_increase", "max_drawdown_worsening", "max_sharpe_decrease", "max_return_decrease",
    "max_cost_increase", "min_return_improvement", "min_sharpe_improvement", "min_cost_reduction",
    "min_drawdown_improvement", "min_volatility_reduction", "selection_fraction", "min_consistency",
    "low_volatility_cutoff",
)
INTEGER_THRESHOLD_KEYS = ("rolling_weeks", "rolling_step_weeks", "max_substitutions", "max_proposals", "exhaustive_limit", "min_observations")
MAPPING_THRESHOLD_KEYS = ("min_correlation", "max_tracking_error", "max_group_deviation")


class ImprovementInputError(ValueError):
    """La peticion no se puede evaluar tal como viene."""


def merge_thresholds(overrides: Optional[dict]) -> Dict[str, object]:
    """Umbrales por defecto con las claves conocidas sobreescritas; el resto se ignora."""
    out: Dict[str, object] = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_THRESHOLDS.items()}
    if not isinstance(overrides, dict):
        return out
    for key in NUMERIC_THRESHOLD_KEYS:
        value = overrides.get(key)
        if isinstance(value, (int, float)) and math.isfinite(value):
            out[key] = float(value)
    for key in INTEGER_THRESHOLD_KEYS:
        value = overrides.get(key)
        if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0:
            out[key] = int(value)
    for key in MAPPING_THRESHOLD_KEYS:
        value = overrides.get(key)
        if isinstance(value, dict):
            merged = dict(out[key])  # type: ignore[arg-type]
            for sub, number in value.items():
                if isinstance(number, (int, float)) and math.isfinite(number):
                    merged[str(sub)] = float(number)
            out[key] = merged
    if not 0.3 <= float(out["selection_fraction"]) <= 0.9:
        out["selection_fraction"] = DEFAULT_THRESHOLDS["selection_fraction"]
    return out


@dataclass
class ImprovementInput:
    dates: List[str]
    levels: Dict[str, List[float]]
    original_weights: Dict[str, float]
    candidates: Dict[str, List[str]]
    # Candidatos que son otra clase del MISMO fondo (decision 8.3, 13-10-2026): pasan las
    # mismas puertas pero no consumen una de las `max_substitutions`.
    free_candidates: Dict[str, Set[str]] = field(default_factory=dict)
    locked: Set[str] = field(default_factory=set)
    costs: Dict[str, Optional[float]] = field(default_factory=dict)
    labels: Dict[str, Dict[str, Optional[str]]] = field(default_factory=dict)
    names: Dict[str, str] = field(default_factory=dict)
    risk_free_rate: float = 0.0
    thresholds: Dict[str, object] = field(default_factory=lambda: merge_thresholds(None))
    # 15-11-2026 (hallazgo 9): el tipo libre de cada tramo, el medio de SUS fechas («selection», «confirmation», «full»). El que
    # falte toma `risk_free_rate`. Antes los tres tramos usaban el de la ventana entera.
    risk_free_rates: Dict[str, float] = field(default_factory=dict)
    # La serie diaria de la que sale la semanal (la rejilla de Simular, `portfolio_horizon._periodo_comun`). Con ella la
    # caida maxima se mide en diario, como la de Simular; sin ella, en la serie semanal, como antes. Las fechas semanales
    # tienen que estar entre las diarias.
    daily_dates: List[str] = field(default_factory=list)
    daily_levels: Dict[str, List[float]] = field(default_factory=dict)
    # Candidatos que no se han podido medir y por que (motivo y detalle): no son descartes, son no evaluables.
    unavailable: Dict[str, dict] = field(default_factory=dict)


@dataclass
class WindowMetrics:
    cagr: float
    volatility: float
    # None con volatilidad cero: el Sharpe no existe y no es un 0 (hallazgo 11, 15-11-2026).
    sharpe: Optional[float]
    max_drawdown: float
    cumulative: float
    weeks: int

    def as_dict(self) -> dict:
        return {
            "cagr": round(self.cagr, 8), "volatility": round(self.volatility, 8), "sharpe": None if self.sharpe is None else round(self.sharpe, 8),
            "max_drawdown": round(self.max_drawdown, 8), "cumulative_return": round(self.cumulative, 8), "weeks": self.weeks,
        }


# ------------------------------------------------------------------ medicion

def _np():
    import numpy as np
    return np


def portfolio_levels(matrix, weights_vector):
    """Serie de cartera con pesos fijos al inicio (buy-and-hold), como backtest_portfolio."""
    return matrix @ weights_vector


def day_ordinals(dates: Sequence[str]) -> List[int]:
    """Fechas ISO -> ordinales de dia, para medir huecos y anios en tiempo real."""
    return [date.fromisoformat(str(d)[:10]).toordinal() for d in dates]


def _segment_days(ordinals: Optional[Sequence[int]], start: int, end: int):
    """Dias entre observaciones consecutivas de [start, end]. Sin fechas se asumen semanas
    ISO consecutivas (7 dias), que es lo que el motor recibia antes."""
    np = _np()
    if ordinals is None:
        return np.full(max(0, end - start), 7.0)
    return np.diff(np.asarray(ordinals[start:end + 1], dtype=float))


def window_metrics(levels, start: int, end: int, risk_free_rate: float,
                   ordinals: Optional[Sequence[int]] = None, daily_segment=None) -> WindowMetrics:
    """Metricas de una serie semanal en [start, end] (indices inclusivos), rebasada en `start`.

    `ordinals` (day_ordinals de las fechas de la serie): los anios del CAGR se miden por
    fechas y solo cuentan los retornos entre observaciones separadas <= 14 dias.
    `daily_segment`: la serie diaria del mismo tramo, de su primera a su ultima fecha semanal. Con ella la caida maxima es
    la diaria, como en Simular (`portfolio_horizon._backtest`)."""
    np = _np()
    segment = np.asarray(levels[start:end + 1], dtype=float)
    # OPT-6 (auditoria del 16-11-2026): aqui se devolvian ceros —volatilidad 0, caida 0—, y con ceros las puertas de
    # `gates` pasan solas («la volatilidad no sube»). Es lo que el hallazgo 11 quito del Sharpe y de la correlacion, y se
    # quedo en este caso. No se da hoy: `selection_end` deja cada tramo con tres semanas o mas, y el servicio pide la
    # ventana entera. Si se diera, es un fallo de quien llama, y se dice en vez de medir nada.
    if len(segment) < 3 or segment[0] <= 0:
        raise ValueError("window_metrics: el tramo necesita al menos tres observaciones semanales con nivel positivo "
                         f"(tiene {len(segment)}).")
    gaps = _segment_days(ordinals, start, end)
    returns = (segment[1:] / segment[:-1] - 1.0)[gaps <= MAX_BRIDGED_WEEK_GAP_DAYS]
    weeks = len(segment) - 1
    cumulative = float(segment[-1] / segment[0] - 1.0)
    years = float(gaps.sum()) / DAYS_PER_YEAR
    cagr = float((segment[-1] / segment[0]) ** (1.0 / years) - 1.0) if years > 0 else 0.0
    vol = float(returns.std(ddof=1) * math.sqrt(WEEKS_PER_YEAR)) if len(returns) > 1 else 0.0
    sharpe = ex_post_sharpe(cagr, risk_free_rate, vol)  # decision 6.3; None con volatilidad cero
    drawdown_base = segment if daily_segment is None else np.asarray(daily_segment, dtype=float)
    peaks = np.maximum.accumulate(drawdown_base)
    mdd = float((drawdown_base / peaks - 1.0).min())
    return WindowMetrics(cagr, vol, sharpe, mdd, cumulative, weeks)


def selection_end(observations: int, selection_fraction: float) -> int:
    """Indice de la observacion semanal que cierra el tramo de seleccion y abre el de confirmacion.

    Es la division de siempre (dos tercios por defecto), aqui para que el servicio pida el tipo libre de cada tramo con
    las mismas fechas que mide el motor."""
    last = observations - 1
    return max(2, min(last - 2, int(round(last * float(selection_fraction)))))


def window_spans(dates: Sequence[str], selection_fraction: float) -> Dict[str, Tuple[str, str]]:
    """Primera y ultima fecha de cada tramo: seleccion, confirmacion y ventana completa."""
    cut = selection_end(len(dates), selection_fraction)
    return {"selection": (dates[0], dates[cut]), "confirmation": (dates[cut], dates[-1]), "full": (dates[0], dates[-1])}


def _sharpe_delta(trial: Optional[float], base: Optional[float]) -> Optional[float]:
    """La diferencia de dos Sharpe, o None si a alguno le falta (volatilidad cero): un vacio no es un cero."""
    return None if trial is None or base is None else trial - base


SHARPE_SIN_DATO = "Sharpe sin dato (volatilidad cero): no evaluable."


def _round_or_none(value: Optional[float]) -> Optional[float]:
    return None if value is None else round(value, 8)


def pair_statistics(levels_a: Sequence[float], levels_b: Sequence[float],
                    ordinals: Optional[Sequence[int]] = None) -> Tuple[float, float]:
    """(correlacion, tracking error anualizado) de los retornos semanales de dos series.

    Con `ordinals`, los saltos sobre un hueco de mas de 14 dias no cuentan (CRIT-04)."""
    np = _np()
    a = np.asarray(levels_a, dtype=float)
    b = np.asarray(levels_b, dtype=float)
    keep = _segment_days(ordinals, 0, len(a) - 1) <= MAX_BRIDGED_WEEK_GAP_DAYS
    ra = (a[1:] / a[:-1] - 1.0)[keep]
    rb = (b[1:] / b[:-1] - 1.0)[keep]
    # La correlacion que no se puede calcular (menos de tres semanas, o una serie de varianza cero) va None, no 0
    # (hallazgo 11, 15-11-2026); quien la usa la trata como no evaluable.
    if len(ra) < 3:
        return None, float("inf")
    sa = ra.std(ddof=1)
    sb = rb.std(ddof=1)
    cov = float(((ra - ra.mean()) * (rb - rb.mean())).sum() / (len(ra) - 1))
    corr = float(cov / (sa * sb)) if sa > 0 and sb > 0 else None
    tracking = float((rb - ra).std(ddof=1) * math.sqrt(WEEKS_PER_YEAR))
    return corr, tracking


# -------------------------------------------------------------- utilidades

def _class_threshold(table, asset_class: Optional[str]) -> float:
    return float(table.get(asset_class or "DEFAULT", table.get("DEFAULT")))


def _known_rate(rate) -> bool:
    return isinstance(rate, (int, float)) and math.isfinite(rate) and rate >= 0


def _weighted_cost(weights: Dict[str, float], costs: Dict[str, Optional[float]]) -> Optional[float]:
    """Coste ponderado SOLO con cobertura completa; una tasa ausente no es un cero."""
    total = 0.0
    for asset_id, weight in weights.items():
        if weight <= 0:
            continue
        rate = costs.get(asset_id)
        if not _known_rate(rate):
            return None
        total += weight * float(rate)
    return total


def _cost_check(substitutions: Dict[str, str], weights: Dict[str, float], data: "ImprovementInput", max_increase: float) -> dict:
    """El criterio de coste, por lo que cambia en los fondos que se sustituyen (decision 77, 05-11-2026).

    Lo que no se toca pesa lo mismo antes y despues y se cancela, asi que el coste que le falte a un fondo que se queda no dice
    nada de si el cambio encarece la cartera. Antes apagaba el criterio, y un cambio mas caro pasaba como que no empeora nada.
    Solo queda sin evaluar si falta el coste de lo que sale o de lo que entra.
    """
    costs, names = data.costs, data.names
    nombre = lambda asset_id: names.get(asset_id, asset_id)  # noqa: E731
    touched = sorted(set(substitutions) | set(substitutions.values()))
    missing = [asset_id for asset_id in touched if not _known_rate(costs.get(asset_id))]
    if missing:
        return _check("cost", COST_LABEL, None, "Falta el coste de %s, que entra en el cambio: no evaluable." % ", ".join(nombre(a) for a in missing))
    change = sum(weights[position] * (float(costs[candidate]) - float(costs[position])) for position, candidate in substitutions.items())
    detail = _pp(change)
    untouched = sorted(a for a, weight in weights.items() if weight > 0 and a not in substitutions and not _known_rate(costs.get(a)))
    if untouched:
        detail += " en los fondos que se sustituyen. Falta el coste de %s, que no se toca: el de la cartera queda sin dato" % ", ".join(nombre(a) for a in untouched)
    return _check("cost", COST_LABEL, change <= max_increase, detail)


def _group_weights(weights: Dict[str, float], labels: Dict[str, Dict[str, Optional[str]]], dimension: str) -> Optional[Dict[str, float]]:
    out: Dict[str, float] = {}
    for asset_id, weight in weights.items():
        if weight <= 0:
            continue
        value = (labels.get(asset_id) or {}).get(dimension)
        if not value:
            return None
        out[value] = out.get(value, 0.0) + weight
    return out


def _group_deviation(a: Optional[Dict[str, float]], b: Optional[Dict[str, float]]) -> Optional[float]:
    if a is None or b is None:
        return None
    keys = set(a) | set(b)
    return max((abs(a.get(k, 0.0) - b.get(k, 0.0)) for k in keys), default=0.0)


def _sharpe_gate(window_label: str, delta: Optional[float], max_decrease: float) -> dict:
    """La puerta del Sharpe. Sin Sharpe en alguna de las dos carteras queda no evaluable, como un coste que falta."""
    label = "Sharpe (%s)" % window_label
    if delta is None:
        return _check("sharpe_%s" % window_label, label, None, SHARPE_SIN_DATO)
    return _check("sharpe_%s" % window_label, label, delta >= -max_decrease, "%+.2f" % delta)


def _check(key: str, label: str, passed: Optional[bool], detail: str) -> dict:
    status = "NOT_EVALUABLE" if passed is None else ("PASS" if passed else "FAIL")
    return {"key": key, "label": label, "status": status, "detail": detail}


def _pp(value: float) -> str:
    return "%+.2f pp" % (value * 100.0)


# ------------------------------------------------------------- evaluacion

class _Evaluator:
    def __init__(self, data: ImprovementInput):
        np = _np()
        self.data = data
        self.t = data.thresholds
        self.asset_ids = sorted(data.levels)
        self.index = {asset_id: i for i, asset_id in enumerate(self.asset_ids)}
        n = len(data.dates)
        for asset_id in self.asset_ids:
            if len(data.levels[asset_id]) != n:
                raise ImprovementInputError("Las series no comparten las mismas fechas (%s)." % asset_id)
        self.matrix = np.asarray([data.levels[a] for a in self.asset_ids], dtype=float).T  # (n, m)
        try:
            self.ordinals = day_ordinals(data.dates)
        except (TypeError, ValueError) as exc:
            raise ImprovementInputError("Las fechas de la serie no son validas.") from exc
        if any(b <= a for a, b in zip(self.ordinals, self.ordinals[1:])):
            raise ImprovementInputError("Las fechas de la serie no son crecientes.")
        self.n = n
        self.sel_end = selection_end(n, float(self.t["selection_fraction"]))
        self.rf = float(data.risk_free_rate)
        self.rf_by_window = {key: float(data.risk_free_rates.get(key, self.rf)) for key in ("selection", "confirmation", "full")}
        self.daily = None
        self.week_rows: List[int] = []
        if data.daily_dates:
            row = {str(d)[:10]: i for i, d in enumerate(data.daily_dates)}
            try:
                self.week_rows = [row[str(d)[:10]] for d in data.dates]
            except KeyError as exc:
                raise ImprovementInputError("Las fechas semanales no estan en la serie diaria.") from exc
            for asset_id in self.asset_ids:
                if len(data.daily_levels.get(asset_id) or []) != len(data.daily_dates):
                    raise ImprovementInputError("La serie diaria no cubre las mismas fechas (%s)." % asset_id)
            self.daily = np.asarray([data.daily_levels[a] for a in self.asset_ids], dtype=float).T

    def days(self, start: int, end: int) -> int:
        return self.ordinals[end] - self.ordinals[start]

    def weights_vector(self, weights: Dict[str, float]):
        np = _np()
        vector = np.zeros(len(self.asset_ids), dtype=float)
        for asset_id, weight in weights.items():
            vector[self.index[asset_id]] = weight
        return vector

    def levels_for(self, weights: Dict[str, float]):
        return portfolio_levels(self.matrix, self.weights_vector(weights))

    def daily_for(self, weights: Dict[str, float]):
        return None if self.daily is None else portfolio_levels(self.daily, self.weights_vector(weights))

    def _daily_segment(self, daily, start: int, end: int):
        return None if daily is None else daily[self.week_rows[start]:self.week_rows[end] + 1]

    def metrics(self, levels, daily=None) -> Dict[str, WindowMetrics]:
        spans = {"selection": (0, self.sel_end), "confirmation": (self.sel_end, self.n - 1), "full": (0, self.n - 1)}
        return {
            key: window_metrics(levels, start, end, self.rf_by_window[key], self.ordinals, self._daily_segment(daily, start, end))
            for key, (start, end) in spans.items()
        }

    # Puertas duras entre dos conjuntos de metricas de la misma ventana.
    def gates(self, base: WindowMetrics, trial: WindowMetrics, window_label: str) -> List[dict]:
        t = self.t
        return [
            _check("volatility_%s" % window_label, "Volatilidad (%s)" % window_label,
                   trial.volatility <= base.volatility + float(t["max_volatility_increase"]), _pp(trial.volatility - base.volatility)),
            _check("max_drawdown_%s" % window_label, "Máxima caída (%s)" % window_label,
                   trial.max_drawdown >= base.max_drawdown - float(t["max_drawdown_worsening"]), _pp(trial.max_drawdown - base.max_drawdown)),
            _sharpe_gate(window_label, _sharpe_delta(trial.sharpe, base.sharpe), float(t["max_sharpe_decrease"])),
            _check("cagr_%s" % window_label, "Rentabilidad anualizada (%s)" % window_label,
                   trial.cagr >= base.cagr - float(t["max_return_decrease"]), _pp(trial.cagr - base.cagr)),
        ]

    def improvements(self, base: WindowMetrics, trial: WindowMetrics, cost_base: Optional[float], cost_trial: Optional[float]) -> List[dict]:
        t = self.t
        out = []
        if trial.cagr - base.cagr >= float(t["min_return_improvement"]):
            out.append({"key": "cagr", "label": "Rentabilidad anualizada", "delta": round(trial.cagr - base.cagr, 8)})
        sharpe_delta = _sharpe_delta(trial.sharpe, base.sharpe)
        if sharpe_delta is not None and sharpe_delta >= float(t["min_sharpe_improvement"]):
            out.append({"key": "sharpe", "label": "Sharpe", "delta": round(sharpe_delta, 8)})
        if trial.max_drawdown - base.max_drawdown >= float(t["min_drawdown_improvement"]):
            out.append({"key": "max_drawdown", "label": "Máxima caída", "delta": round(trial.max_drawdown - base.max_drawdown, 8)})
        if base.volatility - trial.volatility >= float(t["min_volatility_reduction"]) and trial.cagr >= base.cagr - 1e-12:
            out.append({"key": "volatility", "label": "Volatilidad", "delta": round(trial.volatility - base.volatility, 8)})
        if cost_base is not None and cost_trial is not None and cost_base - cost_trial >= float(t["min_cost_reduction"]):
            out.append({"key": "cost", "label": COST_LABEL, "delta": round(cost_trial - cost_base, 8)})
        return out

    def consistency(self, base_levels, trial_levels) -> Optional[dict]:
        """Cuota de ventanas moviles de `rolling_weeks` en las que la propuesta iguala o supera a la original."""
        rolling = int(self.t["rolling_weeks"])
        step = max(1, int(self.t["rolling_step_weeks"]))
        if self.n - 1 < rolling:
            return None
        wins = total = 0
        for start in range(0, self.n - rolling, step):
            end = start + rolling
            if base_levels[start] <= 0 or trial_levels[start] <= 0:
                continue
            total += 1
            if trial_levels[end] / trial_levels[start] >= base_levels[end] / base_levels[start] - 1e-12:
                wins += 1
        if total == 0:
            return None
        return {"windows": total, "wins": wins, "share": round(wins / total, 6), "rolling_weeks": rolling}


# ------------------------------------------------------------------ motor

def insufficient_data_response(missing_assets: List[str], observations: int, required_observations: int) -> dict:
    """Lo que se devuelve si la cartera no se puede evaluar: quien falta, y cuantas semanas hay y hacen falta."""
    return {
        "schema_version": SCHEMA_VERSION, "status": STATUS_INSUFFICIENT_DATA, "proposals": [],
        "missing_assets": missing_assets, "observations": observations, "required_observations": required_observations,
        "warnings": [], "rejected_candidates": {}, "evaluated_combinations": 0,
    }


def improve_portfolio(data: ImprovementInput) -> dict:
    """Devuelve el contrato portfolio-improvement.v1 (dict). No lanza salvo entrada invalida."""
    t = data.thresholds
    warnings: List[str] = []
    original = {k: float(v) for k, v in data.original_weights.items() if isinstance(v, (int, float)) and v > 0}
    if not original:
        raise ImprovementInputError("La cartera no tiene posiciones con peso positivo.")
    total_weight = sum(original.values())
    original = {k: v / total_weight for k, v in original.items()}

    missing_original = [asset_id for asset_id in original if asset_id not in data.levels]
    if missing_original or len(data.dates) < max(3, int(t["min_observations"])):
        return insufficient_data_response(missing_original, len(data.dates), int(t["min_observations"]))

    ev = _Evaluator(data)
    short = [
        {"window": key, "first_date": data.dates[start], "last_date": data.dates[end], "days": ev.days(start, end)}
        for key, (start, end) in (("selection", (0, ev.sel_end)), ("confirmation", (ev.sel_end, ev.n - 1)))
        if ev.days(start, end) < MIN_ANNUALIZATION_DAYS
    ]
    if short:
        return {
            "schema_version": SCHEMA_VERSION, "status": STATUS_WINDOW_TOO_SHORT, "proposals": [],
            "windows": _windows_payload(ev, data.dates), "short_windows": short, "min_days": MIN_ANNUALIZATION_DAYS,
            "rejected_candidates": {}, "evaluated_combinations": 0, "warnings": warnings,
            "reason": " ".join(
                "El tramo de %s tiene %d días, del %s al %s, y con menos de %d no se anualiza: no se calcula una propuesta."
                % (WINDOW_NAMES[item["window"]], item["days"], _dmy(item["first_date"]), _dmy(item["last_date"]), MIN_ANNUALIZATION_DAYS)
                for item in short),
        }
    base_levels = ev.levels_for(original)
    base_metrics = ev.metrics(base_levels, ev.daily_for(original))
    base_cost = _weighted_cost(original, data.costs)
    base_groups = {dim: _group_weights(original, data.labels, dim) for dim in ("asset_class", "region", "currency")}

    # --- capa 3: candidatos equivalentes por series, por posicion
    screened: Dict[str, List[dict]] = {}
    rejected: Dict[str, List[dict]] = {}
    for position in original:
        if position in data.locked:
            continue
        asset_class = (data.labels.get(position) or {}).get("asset_class")
        min_corr = _class_threshold(t["min_correlation"], asset_class)
        max_te = _class_threshold(t["max_tracking_error"], asset_class)
        position_vol = window_metrics(data.levels[position], 0, ev.n - 1, ev.rf, ev.ordinals).volatility
        if position_vol < float(t["low_volatility_cutoff"]):
            min_corr = 0.0  # casi monetario: la correlacion no discrimina; manda el tracking error
        seen: Set[str] = set()
        for candidate in data.candidates.get(position, []) or []:
            if candidate in seen or candidate == position or candidate in original:
                continue
            seen.add(candidate)
            if candidate not in data.levels:
                # No se ha podido medir: queda como no evaluable con su motivo, igual que un criterio al que le falta el dato.
                motivo = data.unavailable.get(candidate) or {"reason": "INSUFFICIENT_HISTORY", "detail": "Sin serie que cubra la ventana común."}
                rejected.setdefault(position, []).append({"asset_id": candidate, **motivo, "not_evaluable": True})
                continue
            corr, tracking = pair_statistics(data.levels[position], data.levels[candidate], ev.ordinals)
            if corr is None:
                # No se puede decir si se parece: ni pasa ni se descarta por correlacion baja. No evaluable, con su motivo.
                rejected.setdefault(position, []).append({"asset_id": candidate, "reason": "CORRELATION_UNAVAILABLE",
                                                          "detail": "Correlación no calculable (serie sin variación o sin semanas comunes): no evaluable.",
                                                          "not_evaluable": True})
                continue
            if corr < min_corr:
                rejected.setdefault(position, []).append({"asset_id": candidate, "reason": "LOW_CORRELATION",
                                                          "detail": "Correlación %.2f, mínimo %.2f." % (corr, min_corr), "correlation": round(corr, 6)})
                continue
            if tracking > max_te:
                rejected.setdefault(position, []).append({"asset_id": candidate, "reason": "HIGH_TRACKING_ERROR",
                                                          "detail": "Tracking error %.2f %%, máximo %.2f %%." % (tracking * 100, max_te * 100),
                                                          "tracking_error": round(tracking, 6)})
                continue
            screened.setdefault(position, []).append({"asset_id": candidate, "correlation": round(corr, 6), "tracking_error": round(tracking, 6)})

    positions = [p for p in original if screened.get(p)]
    if not positions:
        return {
            "schema_version": SCHEMA_VERSION, "status": STATUS_INFEASIBLE, "proposals": [],
            "original": _original_payload(original, base_metrics, base_cost), "windows": _windows_payload(ev, data.dates),
            "rejected_candidates": rejected, "evaluated_combinations": 0, "warnings": warnings,
            "reason": "Ninguna posición tiene candidatos equivalentes evaluables." if not data.locked or len(data.locked) < len(original)
            else "Todas las posiciones están bloqueadas.",
        }

    # --- busqueda en la ventana de seleccion
    max_subs = max(1, int(t["max_substitutions"]))
    options = {p: [None] + [c["asset_id"] for c in screened[p]] for p in positions}
    combos_total = 1
    for p in positions:
        combos_total *= len(options[p])
    evaluated = 0
    kept: List[dict] = []   # combinaciones que pasan las puertas en seleccion

    def trial_weights(assignment: Dict[str, Optional[str]]) -> Dict[str, float]:
        weights = dict(original)
        for position, replacement in assignment.items():
            if replacement:
                weights[replacement] = weights.pop(position)
        return weights

    def is_free(position: str, candidate: str) -> bool:
        return candidate in (data.free_candidates.get(position) or set())

    def evaluate(assignment: Dict[str, Optional[str]]) -> Optional[dict]:
        nonlocal evaluated
        subs = {p: c for p, c in assignment.items() if c}
        counted = {p: c for p, c in subs.items() if not is_free(p, c)}
        if not subs or len(counted) > max_subs:
            return None
        evaluated += 1
        weights = trial_weights(assignment)
        levels = ev.levels_for(weights)
        metrics = ev.metrics(levels, ev.daily_for(weights))
        gates = ev.gates(base_metrics["selection"], metrics["selection"], "selección")
        if any(g["status"] == "FAIL" for g in gates):
            return None
        # Sin Sharpe no hay objetivo que ordenar: va al final, no como un 0.
        objective = _sharpe_delta(metrics["selection"].sharpe, base_metrics["selection"].sharpe)
        if objective is None:
            objective = -math.inf
        return {"subs": subs, "weights": weights, "levels": levels, "metrics": metrics, "objective": objective, "selection_gates": gates}

    if combos_total <= int(t["exhaustive_limit"]):
        for choice in itertools.product(*(options[p] for p in positions)):
            result = evaluate(dict(zip(positions, choice)))
            if result:
                kept.append(result)
    else:
        warnings.append("GREEDY_SEARCH")
        current: Dict[str, Optional[str]] = {p: None for p in positions}
        while len([c for p, c in current.items() if c and not is_free(p, c)]) < max_subs:
            best = None
            for position in positions:
                if current[position]:
                    continue
                for candidate in options[position][1:]:
                    trial = dict(current)
                    trial[position] = candidate
                    result = evaluate(trial)
                    if result and (best is None or result["objective"] > best[0]["objective"]):
                        best = (result, position, candidate)
            if best is None:
                break
            kept.append(best[0])
            current[best[1]] = best[2]

    # --- confirmacion fuera de muestra
    kept.sort(key=lambda r: (-r["objective"], len(r["subs"]), sorted(r["subs"].items())))
    proposals: List[dict] = []
    best_failure: Optional[dict] = None
    for result in kept[:50]:
        metrics = result["metrics"]
        checks = list(result["selection_gates"])
        checks += ev.gates(base_metrics["confirmation"], metrics["confirmation"], "confirmación")
        cost = _weighted_cost(result["weights"], data.costs)
        checks.append(_cost_check(result["subs"], original, data, float(t["max_cost_increase"])))
        for dim, label in (("asset_class", "Exposición por clase de activo"), ("region", "Exposición por región"), ("currency", "Exposición por divisa")):
            deviation = _group_deviation(base_groups[dim], _group_weights(result["weights"], data.labels, dim))
            limit = float(t["max_group_deviation"].get(dim, 1.0))
            checks.append(_check("group_%s" % dim, label, None if deviation is None else deviation <= limit,
                                 "sin etiqueta en algún fondo" if deviation is None else "desviación máxima %.1f pp" % (deviation * 100)))
        consistency = ev.consistency(base_levels, result["levels"])
        checks.append(_check("consistency", "Consistencia en ventanas móviles de un año",
                             None if consistency is None else consistency["share"] >= float(t["min_consistency"]),
                             "ventana insuficiente" if consistency is None else "%d de %d ventanas" % (consistency["wins"], consistency["windows"])))
        improvements = ev.improvements(base_metrics["confirmation"], metrics["confirmation"], base_cost, cost)
        checks.append(_check("relevant_improvement", "Al menos una mejora relevante (confirmación)", bool(improvements),
                             ", ".join(i["label"] for i in improvements) if improvements else "ninguna supera el mínimo"))
        failed = [c for c in checks if c["status"] == "FAIL"]
        payload = {
            "substitutions": [
                {"from_asset_id": p, "to_asset_id": c, "weight": round(original[p], 8),
                 "from_name": data.names.get(p, p), "to_name": data.names.get(c, c),
                 "same_fund_class": is_free(p, c),
                 **{k: v for k, v in next(s for s in screened[p] if s["asset_id"] == c).items() if k != "asset_id"}}
                for p, c in sorted(result["subs"].items())
            ],
            "weights": {k: round(v, 8) for k, v in result["weights"].items()},
            "metrics": {k: v.as_dict() for k, v in metrics.items()},
            "deltas_confirmation": {
                "cagr": round(metrics["confirmation"].cagr - base_metrics["confirmation"].cagr, 8),
                "volatility": round(metrics["confirmation"].volatility - base_metrics["confirmation"].volatility, 8),
                "sharpe": _round_or_none(_sharpe_delta(metrics["confirmation"].sharpe, base_metrics["confirmation"].sharpe)),
                "max_drawdown": round(metrics["confirmation"].max_drawdown - base_metrics["confirmation"].max_drawdown, 8),
            },
            "weighted_cost": None if cost is None else round(cost, 8),
            "validation": checks,
            "improvements": improvements,
            "consistency": consistency,
            "valid": not failed,
        }
        if failed:
            if best_failure is None:
                best_failure = {"substitutions": payload["substitutions"], "failed": [c["label"] for c in failed]}
            continue
        proposals.append(payload)

    mean_equivalence = lambda p: sum(s["correlation"] for s in p["substitutions"]) / len(p["substitutions"])  # noqa: E731
    counted_subs = lambda p: sum(1 for s in p["substitutions"] if not s.get("same_fund_class"))  # noqa: E731
    # Un Sharpe vacio ordena detras de cualquier numero, no como un 0.
    sharpe_order = lambda p: -p["deltas_confirmation"]["sharpe"] if p["deltas_confirmation"]["sharpe"] is not None else math.inf  # noqa: E731
    proposals.sort(key=lambda p: (counted_subs(p), -mean_equivalence(p), sharpe_order(p)))
    proposals = proposals[:max(1, int(t["max_proposals"]))]

    status = STATUS_PROPOSAL if proposals else STATUS_NO_IMPROVEMENT
    out = {
        "schema_version": SCHEMA_VERSION,
        "status": status,
        "original": _original_payload(original, base_metrics, base_cost),
        "windows": _windows_payload(ev, data.dates),
        "proposals": proposals,
        "rejected_candidates": rejected,
        "evaluated_combinations": evaluated,
        "search": "EXHAUSTIVE" if combos_total <= int(t["exhaustive_limit"]) else "GREEDY",
        "warnings": warnings,
    }
    if status == STATUS_NO_IMPROVEMENT:
        out["reason"] = ("La mejor combinación en selección no supera la confirmación: %s." % ", ".join(best_failure["failed"])
                         if best_failure else "Ninguna sustitución mejora la cartera sin empeorar algún criterio obligatorio.")
        if best_failure:
            out["best_rejected"] = best_failure
    return out


def _original_payload(weights: Dict[str, float], metrics: Dict[str, WindowMetrics], cost: Optional[float]) -> dict:
    return {
        "weights": {k: round(v, 8) for k, v in weights.items()},
        "metrics": {k: v.as_dict() for k, v in metrics.items()},
        "weighted_cost": None if cost is None else round(cost, 8),
    }


def _windows_payload(ev: _Evaluator, dates: List[str]) -> dict:
    last = ev.n - 1
    return {
        "frequency": "WEEKLY",
        "full": {"first_date": dates[0], "last_date": dates[-1], "weeks": last, "days": ev.days(0, last)},
        "selection": {"first_date": dates[0], "last_date": dates[ev.sel_end], "weeks": ev.sel_end, "days": ev.days(0, ev.sel_end)},
        "confirmation": {"first_date": dates[ev.sel_end], "last_date": dates[-1], "weeks": last - ev.sel_end, "days": ev.days(ev.sel_end, last)},
    }


def _dmy(iso: str) -> str:
    """Una fecha ISO como la escribe la pantalla: 27/10/2023."""
    day = date.fromisoformat(str(iso)[:10])
    return "%02d/%02d/%d" % (day.day, day.month, day.year)
