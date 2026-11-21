"""Server-side portfolio frontier calculation.

The public entry point is ``optimize_portfolio(reader, request)``.  The reader is
duck-typed and must expose only read methods:

  reader.get_asset(asset_id) -> dict | None
  reader.get_price_series(asset_id) -> list[dict]

No Firestore writes, external APIs, FX conversion, holdings, recommendations, or
frontend concerns live in this module.
"""
from __future__ import annotations

from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
import math
import os
import time
from quietlog import swallowed
from firebase_functions import logger as LOGGER
from .runtime import prepare_solver_during_reads
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from asset_aliases import alias_conflict_message, alias_conflicts, canonical_noting, with_alias_resolutions
from fund_distributions import (
    MOTIVO_REPARTE,
    reparte_sin_todos_los_pagos,
    serie_iguala_al_proveedor,
)
from .risk_analytics import risk_contributions
from .stress_analytics import stress_windows
from price_history_sync import adjustment_problem
# A1 (auditoria 29-09): la regla de semana (ultima observacion de cada semana ISO,
# retornos semana a semana, huecos puenteados) vive en weekly_sampling, comun con la
# maestra (ingest_asset / fund_ingest): asi metrics/latest y la frontera publican la
# misma volatilidad para la misma serie. Los nombres de aqui se conservan como alias.
from weekly_sampling import (
    DAYS_PER_YEAR,
    MAX_BRIDGED_WEEK_GAP_DAYS,
    MIN_ANNUALIZATION_DAYS,
    RISK_FREE_MIN_COVERAGE,
    WEEKS_PER_YEAR as ANNUALIZATION_FACTOR,
    ex_post_sharpe as _ex_post_sharpe,
    sample_volatility as _sample_volatility,
    week_start as _week_start,
    weekly_last_observations as _weekly_last_observations,
    weekly_returns as _weekly_returns,
)
# Anios por fechas (DAYS_PER_YEAR = 365,2425) en el CAGR medido: el mismo criterio que
# portfolio_horizon y la analitica del frontend (CRIT-04, 16-10-2026).
DEFAULT_RISK_FREE_RATE = 0.0193
RiskFreeResolver = Callable[[str, str], dict]
SCHEMA_REQUEST = "portfolio-optimization-request.v1"
SCHEMA_RESPONSE = "portfolio-frontier.v1"
SUPPORTED_WINDOWS = {"1Y": 1, "3Y": 3, "5Y": 5, "10Y": 10}
# Minimo de observaciones SEMANALES por ventana. 06-09-2026: "5Y" valia 156 —el mismo
# numero que 3Y, es decir tres anos de semanas—, asi que una ventana de cinco anos se
# daba por buena con tres.
#
# 29-09-2026 (B-01): el minimo exacto (52 semanas x anos: 156/260/520) no dejaba margen.
# La ventana es `latest - anos*366 dias`, que sobre una serie diaria completa produce
# 156 retornos justos a 3A y 261 a 5A; y como el retorno semanal exige semanas
# consecutivas, UNA sola semana sin VL (Navidad, festivo local, alta tardia) borraba
# dos retornos y expulsaba con INSUFFICIENT_HISTORY a un fondo con el historico entero.
# Criterio: se exigen 48 semanas por ano de ventana (~92 % de 52), es decir, se toleran
# hasta cuatro semanas sin dato por ano. 1Y conserva su holgura historica (40).
MIN_WEEKS_PER_WINDOW_YEAR = 48
MIN_COMMON_OBSERVATIONS = {
    "1Y": 40,
    "3Y": MIN_WEEKS_PER_WINDOW_YEAR * 3,    # 144
    "5Y": MIN_WEEKS_PER_WINDOW_YEAR * 5,    # 240
    "10Y": MIN_WEEKS_PER_WINDOW_YEAR * 10,  # 480
}
# Hueco maximo (en dias entre inicios de semana ISO) que `_weekly_returns` puentea: una
# unica semana sin observacion (14 dias). Huecos mayores siguen cortando la serie.
# (Valor en weekly_sampling.MAX_BRIDGED_WEEK_GAP_DAYS; importado arriba.)
SUPPORTED_OBJECTIVES = {"MAX_SHARPE", "MIN_VOLATILITY", "TARGET_RETURN", "TARGET_RISK"}
# Decisiones 40 y 61 (05-11-2026): todos los objetivos se resuelven con el motor regularizado y sobre la matriz de la
# simulacion. Lo que existe en Optimizar y en Simular con el mismo nombre es la misma cartera, y «Rentabilidad objetivo»,
# que solo existe en Optimizar, sale del mismo calculo.
# Los puntos de la frontera deciden el Maximo Sharpe cuando el solver no lo resuelve y el objetivo de «Nivel de
# riesgo»: si fueran distintos en los dos caminos, la misma cartera podria dar dos respuestas.
PUNTOS_DE_LA_FRONTERA = 40
# 04-09-2026: 25 -> 40. Es el de get_price_series y del backtest sin `analysis_bundle`, como CAP_SERIES_ASSETS en
# main.py. La simulacion de 3 y 5 anos no pasa por aqui: su tope es MAX_POSICIONES_SIMULACION (portfolio_horizon.py).
MAX_REBASED_SERIES_ASSETS = 40

# Ola 3b (T6g): la caché de series vive en un módulo propio, que compartía con
# portfolio_real hasta que se borró (17-11-2026); estos alias conservan la API histórica de este módulo
# (tests y llamadas internas incluidos).
from price_series_cache import (  # noqa: E402
    PRICE_SERIES_CACHE_MAX_ASSETS,
    PRICE_SERIES_CACHE_TTL_SECONDS,
    cached_price_series as _cached_price_series,
    clear_price_series_cache as _clear_price_series_cache,
)


def _resolve_risk_free_context(first_date: str, last_date: str, fallback_rate: float,
                               resolver: Optional[RiskFreeResolver]) -> tuple[dict, list[str]]:
    # OPT-3 (auditoria del 16-11-2026): `risk_free_source` sigue diciendo ECB_ESTR aunque el tipo sea el fijo de
    # respaldo, porque es un literal del contrato y la aplicacion publicada rechaza cualquier otro valor. Lo que dice
    # que NO es el €STR es la politica, STATIC_FALLBACK, y el aviso RISK_FREE_RATE_STATIC_FALLBACK: quien rotule el
    # tipo tiene que mirar una de las dos, nunca este campo.
    fallback = {
        "risk_free_source": "ECB_ESTR",
        "risk_free_rate": round(float(fallback_rate), 8),
        "risk_free_rate_policy": "STATIC_FALLBACK",
    }
    if resolver is None:
        return fallback, []
    try:
        resolved = resolver(first_date, last_date)
        rate = float(resolved["rate"])
        if not math.isfinite(rate) or not -0.20 <= rate <= 0.50:
            raise ValueError("tasa fuera de rango")
        coverage = float(resolved.get("coverage_ratio", 0.0))
        if not math.isfinite(coverage) or not 0.0 < coverage <= 1.0:
            raise ValueError("cobertura invalida")
        context = {
            "risk_free_source": "ECB_ESTR",
            "risk_free_rate": round(rate, 8),
            "risk_free_rate_policy": "WINDOW_AVERAGE",
            "risk_free_first_date": str(resolved.get("first_date") or first_date),
            "risk_free_last_date": str(resolved.get("last_date") or last_date),
            "risk_free_observations": int(resolved.get("observations") or 0),
            "risk_free_coverage_ratio": round(coverage, 6),
        }
        warnings = ["RISK_FREE_RATE_PARTIAL_COVERAGE"] if coverage < RISK_FREE_MIN_COVERAGE else []
        return context, warnings
    except Exception:
        swallowed("repository.py:72")
        return fallback, ["RISK_FREE_RATE_STATIC_FALLBACK"]
# Son dos casos distintos, y decian lo mismo. FX_SERIES_MISSING: la serie no esta en euros y no hay con que
# convertirla. Cuarentena: la serie esta en euros y hay cambio, y lo que no es fiable es la conversion hasta verificarla.
MOTIVO_CUARENTENA_DE_DIVISA = "FX_QUARANTINE"
# Hallazgo 15 (15-11-2026): la historia de un activo se iba a completar con su referencia validada y el enlace no se pudo
# hacer (falta el inicio real, la referencia no llega o no pasa la validacion). Se aparta ese activo y no la cartera.
MOTIVO_REFERENCIA_SIN_ENLACE = "REFERENCE_LINK_FAILED"
# Decision A-161 (16-11-2026): la serie de un activo acaba antes del final del periodo, y el periodo ya no se recorta
# para esperarla. Tiene historia; lo que no tiene es precios recientes. No es INSUFFICIENT_HISTORY.
MOTIVO_SERIE_PARADA = "SERIES_ENDS_EARLY"

EXCLUSION_REASONS = {
    MOTIVO_REFERENCIA_SIN_ENLACE,
    MOTIVO_SERIE_PARADA,
    "PRICE_SERIES_MISSING",
    "INSUFFICIENT_HISTORY",
    "FX_SERIES_MISSING",
    MOTIVO_CUARENTENA_DE_DIVISA,
    "NON_INVESTABLE",
    "QUALITY_BLOCKED",
    MOTIVO_REPARTE,
}


class InvalidOptimizationRequest(ValueError):
    pass


class OptimizationError(RuntimeError):
    pass


@dataclass(frozen=True)
class NormalizedRequest:
    asset_ids: List[str]
    current_weights: Optional[Dict[str, float]]
    window: str
    base_currency: str
    frequency: str
    objective: str
    target_return: Optional[float]
    min_weight: float
    max_weight: float
    locked_weights: Optional[Dict[str, float]] = None
    risk_slider: Optional[int] = None
    risk_target_mode: str = "FRONTIER_PERCENTILE"
    target_volatility: Optional[float] = None
    return_mode: str = "HISTORICAL_SHRINKAGE"
    group_constraints: Optional[List[dict]] = None
    # M2 «Mejorar cartera»: rotacion maxima sum|w - w0| respecto a current_weights (solo v2).
    max_turnover: Optional[float] = None
    # 14-10-2026 (CRIT-02): {id pedido: id vigente} de los ISIN sustituidos (fusiones).
    alias_resolutions: Optional[Dict[str, str]] = None
    # Alias que solo venian en current_weights: su peso se suma al sucesor. Se avisan en
    # `alias_resolutions` de la respuesta, pero las filas no se renombran por ellos.
    weight_alias_merges: Optional[Dict[str, str]] = None


@dataclass
class AssetReturns:
    asset_id: str
    root: dict
    returns_by_week: Dict[Tuple[int, int], float]
    weekly_dates: Dict[Tuple[int, int], str]
    # 29-09-2026 (B-04): nivel (ultima observacion) de CADA semana ISO con dato dentro de
    # la ventana, incluida la semana base sin retorno. La serie rebasada semanal se
    # construye sobre estos niveles, no encadenando retornos, para que un hueco en un
    # activo no borre el movimiento de esa semana en todos los demas.
    levels_by_week: Optional[Dict[Tuple[int, int], float]] = None
    # 29-09-2026 (B-01): semanas cuyo retorno es a 14 dias porque la anterior no tenia
    # observacion (ver `_weekly_returns`). Informativo: viaja en coverage.
    bridged_weeks: frozenset = frozenset()


# Dimensiones de agrupacion -> ruta en el root maestro (contrato master asset.v1).
_GROUP_FIELD = {
    "currency": ("identity", "currency"),
    "asset_class": ("classification", "asset_class"),
    "region": ("classification", "region_primary"),
    "subtype": ("classification", "asset_subtype"),
    "vehicle": ("product", "vehicle_complexity"),
}


def _sanitize_group_bounds(b):
    if not isinstance(b, dict):
        return {}
    out = {}
    for k, v in list(b.items())[:20]:
        if _finite_number(v):
            out[str(k)] = min(1.0, max(0.0, float(v)))
    return out


def _group_label(root, dimension):
    path = _GROUP_FIELD.get(dimension)
    if not path:
        return "UNKNOWN"
    obj = (root or {}).get(path[0])
    val = obj.get(path[1]) if isinstance(obj, dict) else None
    return str(val) if val not in (None, "") else "UNKNOWN"


def _resolve_group_constraints(raw, assets):
    """Convierte las constraints crudas (por etiqueta) en estructura con mapper por asset_id,
    leyendo la etiqueta de cada activo del root ya cargado (sin lecturas extra a Firestore)."""
    if not raw:
        return None
    roots = {a.asset_id: (a.root or {}) for a in assets}
    out = []
    for gc in raw:
        dim = gc.get("dimension")
        lower = gc.get("lower") or {}
        upper = gc.get("upper") or {}
        if not dim or (not lower and not upper):
            continue
        mapper = {aid: _group_label(root, dim) for aid, root in roots.items()}
        out.append({"dimension": dim, "mapper": mapper, "lower": lower, "upper": upper})
    return out or None


def _target_group_exposures(weights, group_labels, threshold=0.005):
    """Exposicion (suma de pesos) del objetivo por etiqueta, para TODAS las dimensiones (UI)."""
    exp = {}
    for dim, labels in (group_labels or {}).items():
        d = {}
        for aid, wt in (weights or {}).items():
            lab = labels.get(aid, "UNKNOWN")
            d[lab] = round(d.get(lab, 0.0) + float(wt), 4)
        exp[dim] = {k: v for k, v in d.items() if v >= threshold}
    return exp


def optimize_portfolio(reader, request: dict, *, as_of_date: Optional[str] = None,
                       risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
                       risk_free_resolver: Optional[RiskFreeResolver] = None,
                       today: Optional[date] = None, reference_bundle: Optional[dict] = None) -> dict:
    """`today` y `reference_bundle` son los mismos de `portfolio_horizon.analyze_horizon`: fijan el mismo periodo."""
    req = validate_request(request)
    return _optimize_regularizado(reader, req, as_of_date, risk_free_rate, risk_free_resolver, today, reference_bundle)


def validate_request(request: dict) -> NormalizedRequest:
    if not isinstance(request, dict):
        raise InvalidOptimizationRequest("Request must be an object.")
    if request.get("schema_version") != SCHEMA_REQUEST:
        raise InvalidOptimizationRequest("Invalid schema_version.")
    asset_ids = request.get("asset_ids")
    if not isinstance(asset_ids, list) or len(asset_ids) < 2:
        raise InvalidOptimizationRequest("asset_ids must contain at least two assets.")
    unique_ids = []
    for asset_id in asset_ids:
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise InvalidOptimizationRequest("asset_ids must be non-empty strings.")
    # 14-10-2026 (CRIT-02): un ISIN sustituido se calcula con el sucesor (como el read
    # model) y la respuesta vuelve bajo el id pedido. Nombrar el mismo activo con el
    # alias y con el sucesor en activos o pesos fijados es un error claro aqui, no un
    # fallo tardio de historico o de cotas. En current_weights no: el usuario no los
    # elige, asi que el peso de un alias se suma al sucesor (segunda revision).
    named_ids = list(asset_ids)
    if isinstance(request.get("locked_weights"), dict):
        named_ids.extend(str(key) for key in request["locked_weights"])
    conflicts = alias_conflicts(named_ids)
    if conflicts:
        raise InvalidOptimizationRequest(alias_conflict_message(conflicts))
    alias_resolutions: Dict[str, str] = {}
    for asset_id in asset_ids:
        asset_id = canonical_noting(asset_id, alias_resolutions)
        if asset_id not in unique_ids:
            unique_ids.append(asset_id)

    window = request.get("window")
    if window not in SUPPORTED_WINDOWS:
        raise InvalidOptimizationRequest("Unsupported window.")
    base_currency = request.get("base_currency")
    if base_currency != "EUR":
        raise InvalidOptimizationRequest("Only EUR base_currency is supported in X2.")
    frequency = request.get("frequency", "WEEKLY")
    if frequency != "WEEKLY":
        raise InvalidOptimizationRequest("Only WEEKLY frequency is supported.")
    objective = request.get("objective")
    if objective not in SUPPORTED_OBJECTIVES:
        raise InvalidOptimizationRequest("Unsupported objective.")

    target_return = request.get("target_return")
    if target_return is not None and not _finite_number(target_return):
        raise InvalidOptimizationRequest("target_return must be a finite decimal.")
    if objective == "TARGET_RETURN" and target_return is None:
        raise InvalidOptimizationRequest("target_return is required for TARGET_RETURN.")

    constraints = request.get("constraints") or {}
    if not isinstance(constraints, dict):
        raise InvalidOptimizationRequest("constraints must be an object.")
    if constraints.get("long_only", True) is not True:
        raise InvalidOptimizationRequest("Only long_only constraints are supported.")
    if constraints.get("fully_invested", True) is not True:
        raise InvalidOptimizationRequest("Only fully_invested portfolios are supported.")
    # SEG-4 (auditoria del 16-11-2026): `float("abc")` o `float(None)` salian como error interno, y lo que hay es una
    # peticion mal escrita. Un booleano tampoco es un peso, aunque Python lo cuente como entero.
    min_weight = constraints.get("min_weight", 0.0)
    max_weight = constraints.get("max_weight", 1.0)
    for nombre, valor in (("min_weight", min_weight), ("max_weight", max_weight)):
        if isinstance(valor, bool) or not _finite_number(valor):
            raise InvalidOptimizationRequest(f"{nombre} must be a finite decimal.")
    min_weight, max_weight = float(min_weight), float(max_weight)
    if not (0.0 <= min_weight <= max_weight <= 1.0):
        raise InvalidOptimizationRequest("Invalid min_weight/max_weight constraints.")
    if min_weight * len(unique_ids) > 1.0000001:
        raise InvalidOptimizationRequest(
            f"Sin solución: {len(unique_ids)} activos, con un mínimo del {_en_pct(min_weight)} por activo, pasan del 100 %.")
    if max_weight * len(unique_ids) < 1.0 - 1e-9:
        raise InvalidOptimizationRequest(
            f"Sin solución: {len(unique_ids)} activos, con un máximo del {_en_pct(max_weight)} por activo, no llegan al 100 %.")
    raw_turnover = constraints.get("max_turnover")
    max_turnover = None
    if raw_turnover is not None:
        if not _finite_number(raw_turnover) or not 0.0 <= float(raw_turnover) <= 2.0:
            raise InvalidOptimizationRequest("max_turnover must be a decimal between 0 and 2.")
        max_turnover = float(raw_turnover)

    current_weights = request.get("current_weights")
    weight_alias_merges: Dict[str, str] = {}
    if current_weights is not None:
        if not isinstance(current_weights, dict):
            raise InvalidOptimizationRequest("current_weights must be an object.")
        current_weights = _canonical_weights(current_weights, weight_alias_merges)
        weight_alias_merges = {
            requested: canonical for requested, canonical in weight_alias_merges.items()
            if requested not in alias_resolutions
        }
    if max_turnover is not None and not current_weights:
        raise InvalidOptimizationRequest("max_turnover requires current_weights.")

    locked_weights = request.get("locked_weights")
    if locked_weights is not None:
        if not isinstance(locked_weights, dict):
            raise InvalidOptimizationRequest("locked_weights must be an object.")
        if any(not _finite_number(v) for v in locked_weights.values()):
            raise InvalidOptimizationRequest("Invalid locked weights or conflict with weight bounds.")
        locked_weights = _canonical_weights(locked_weights, alias_resolutions)
        # Pasa con mas de 40 posiciones: un candado en la 41 no entra en la peticion.
        fuera_de_la_peticion = [k for k in locked_weights if k not in unique_ids]
        if fuera_de_la_peticion:
            raise InvalidOptimizationRequest(
                f"Sin solución: {', '.join(fuera_de_la_peticion)} tiene candado y no entra en el cálculo, así que su peso no se puede conservar.")
        if any(v < min_weight for v in locked_weights.values()):
            raise InvalidOptimizationRequest("Invalid locked weights or conflict with weight bounds.")
        # El tope del modelo es para lo que se reparte; un maximo escrito a mano por debajo de un candado es otra cosa:
        # las dos son decisiones del asesor, se contradicen, y no se elige por el.
        for asset_id, value in locked_weights.items():
            if value > max_weight:
                raise InvalidOptimizationRequest(
                    f"Sin solución: el candado de {asset_id} ({_en_pct(value)}) supera el máximo por activo que has escrito ({_en_pct(max_weight)}).")

    rs = request.get("risk_slider")
    risk_slider = int(round(float(rs))) if _finite_number(rs) else None
    risk_target_mode = request.get("risk_target_mode", "FRONTIER_PERCENTILE")
    if risk_target_mode not in ("FRONTIER_PERCENTILE", "ABSOLUTE_VOL"):
        risk_target_mode = "FRONTIER_PERCENTILE"
    tvol = request.get("target_volatility")
    target_volatility = float(tvol) if _finite_number(tvol) else None
    return_mode = request.get("expected_return_model", "HISTORICAL_SHRINKAGE")
    if return_mode not in ("HISTORICAL_SHRINKAGE", "RISK_ONLY", "EQUAL_RETURN"):
        return_mode = "HISTORICAL_SHRINKAGE"

    raw_gc = request.get("group_constraints")
    group_constraints = None
    if raw_gc is not None:
        if not isinstance(raw_gc, list):
            raise InvalidOptimizationRequest("group_constraints must be a list.")
        parsed = []
        for gc in raw_gc[:6]:
            if not isinstance(gc, dict):
                continue
            dim = str(gc.get("dimension") or "")
            if dim not in _GROUP_FIELD:
                continue
            lower = _sanitize_group_bounds(gc.get("lower"))
            upper = _sanitize_group_bounds(gc.get("upper"))
            if lower or upper:
                parsed.append({"dimension": dim, "lower": lower, "upper": upper})
        group_constraints = parsed or None

    return NormalizedRequest(
        asset_ids=unique_ids,
        current_weights=current_weights,
        window=window,
        base_currency=base_currency,
        frequency=frequency,
        objective=objective,
        target_return=float(target_return) if target_return is not None else None,
        min_weight=min_weight,
        max_weight=max_weight,
        locked_weights=locked_weights,
        risk_slider=risk_slider,
        risk_target_mode=risk_target_mode,
        target_volatility=target_volatility,
        return_mode=return_mode,
        group_constraints=group_constraints,
        max_turnover=max_turnover,
        alias_resolutions=alias_resolutions or None,
        weight_alias_merges=weight_alias_merges or None,
    )


def _en_pct(value: float) -> str:
    return f"{value * 100:.1f}".replace(".", ",") + " %"


def _sin_candados_fuera(locked_weights: Optional[dict], asset_ids: List[str]) -> None:
    """Un candado sobre lo que se queda fuera no se quita en silencio. No siempre es por el historico: tambien sale asi lo
    bloqueado por calidad o lo que ya no se puede comprar."""
    fuera = [aid for aid, weight in (locked_weights or {}).items() if weight > 0 and aid not in asset_ids]
    if fuera:
        raise InvalidOptimizationRequest(
            f"Sin solución: {', '.join(fuera)} tiene candado y se queda fuera del cálculo en esta ventana, así que su peso no se puede conservar.")


def _canonical_weights(weights: dict, resolutions: Dict[str, str]) -> Dict[str, float]:
    """Pesos {id: peso} con las claves resueltas al id vigente; un alias y su sucesor suman."""
    out: Dict[str, float] = {}
    for key, value in weights.items():
        if not _finite_number(value):
            continue
        canonical = canonical_noting(str(key), resolutions) or str(key)
        out[canonical] = out.get(canonical, 0.0) + float(value)
    return out


class PriceSeriesProblem(Exception):
    def __init__(self, reason: str):
        if reason not in EXCLUSION_REASONS:
            reason = "PRICE_SERIES_MISSING"
        self.reason = reason
        super().__init__(reason)


def _le_faltan_los_pagos(root: Optional[dict], asset_id: str, reader) -> bool:
    """Si a la serie de este fondo le faltan los pagos: reparte y no iguala al proveedor (decisiones 8 y 55).

    Sin `reader` no se puede contrastar, y entonces manda el rendimiento: quien no pase el lector no mide con una serie
    a la que pueden faltar pagos. Lo bloqueado no se lee: no se mide con ello, iguale o no.
    """
    if not reparte_sin_todos_los_pagos(root):
        return False
    from fund_history_quality import policy_for
    if reader is None or policy_for(asset_id).get("blocked"):
        return True
    return not serie_iguala_al_proveedor(root, _cached_price_series(reader, asset_id))


def _se_dibuja_sin_dividendos(root: Optional[dict], asset_id: str, reader) -> bool:
    """El rotulo de la grafica. La revision lo fija: aunque el rendimiento bajara a cero, la linea sigue sin sus pagos."""
    from fund_history_quality import se_dibuja_tras_revision
    return se_dibuja_tras_revision(asset_id) or _le_faltan_los_pagos(root, asset_id, reader)


def _root_exclusion_reason(root: Optional[dict], base_currency: str, asset_id: str = "", *, allow_historical: bool = False, solo_dibujo: bool = False, reader=None) -> Optional[str]:
    """Motivo por el que un activo no entra, mirando su ficha, y su serie si reparte y hay `reader` con que leerla.

    `solo_dibujo` es para quien va a pintar la serie y no a medir con ella: un fondo que reparte se
    puede dibujar, rotulado, pero no entra en simulacion, frontera ni mejora (decision 8). Por eso el
    defecto es dejarlo fuera: quien se olvide de pensarlo no mide con una serie a la que faltan pagos.

    9 de los 14 estan bloqueados por `fund_history_policies.json`, y el suyo es este motivo: se dice antes
    que «calidad», que no explica nada. El bloqueo sigue en pie (`metrics_refresh` para
    con el, y si el rendimiento bajara a cero no volverian a medir), y una revision por escrito,
    `draw_after_review`, solo abre la puerta de dibujar (decision 53).

    Auditoria de divisas (06-09-2026): aqui se excluia por la divisa de la FICHA —la de
    la clase del fondo, «USD Acc»— aunque la serie estuviera ya normalizada a euros. Eran
    135 de 1.012 activos fuera de frontera y backtest con un motivo falso. La comprobacion
    valida es la de la serie, documento a documento, en `_load_asset_returns`.

    Lo que si se mantiene fuera es lo que tiene un error de divisa CONOCIDO y aun sin
    reparar: esas series estan etiquetadas «EUR» y pasarian la comprobacion del documento.
    """
    if not root:
        return "PRICE_SERIES_MISSING"
    from asset_eligibility import corporate_action_blocks_selection
    if not allow_historical and corporate_action_blocks_selection(root):
        return "NON_INVESTABLE_CORPORATE_ACTION"
    quality = root.get("quality") or {}
    status = str(quality.get("status") or "").upper()
    bucket = str(quality.get("fondosdb_bucket") or quality.get("bucket") or "").upper()
    if status == "BLOCKED" or bucket == "BLOQUEADO":
        return "QUALITY_BLOCKED"
    asset_type = _root_instrument_type(root)
    if asset_type not in {"FUND", "ETF", "STOCK"}:
        return "NON_INVESTABLE"
    from asset_eligibility import bloqueado_por_calidad_del_dato, operator_blocks_selection, valorado_a_precio_congelado
    # La baja con precio congelado (NH Hotel Group, 12-11-2026) se mide en la simulacion, plana desde que se congelo. Pero no se
    # compra: a quien propone pesos (Optimizar, el generador) no le llega, porque una serie plana es un activo sin riesgo que
    # una frontera cargaria de peso.
    if not allow_historical and valorado_a_precio_congelado(root):
        return "NON_INVESTABLE"
    if operator_blocks_selection(root, allow_historical=allow_historical):
        # Decision 75: Deoleo cotiza. Lo que tiene es una serie con saltos sin resolver, y eso es lo que se dice.
        return "QUALITY_BLOCKED" if bloqueado_por_calidad_del_dato(root) else "NON_INVESTABLE"
    # 30-09-2026: un bloqueo por politica de calidad (fund_history_policies.json,
    # `blocked`) no es un problema de divisa; antes se etiquetaba FX_SERIES_MISSING
    # y el informe decia «sin serie de cambio de su divisa» a un fondo en EUR.
    from fund_history_quality import policy_for
    identificador = asset_id or str(root.get("asset_id") or "")
    politica = policy_for(identificador)
    if solo_dibujo and politica.get("draw_after_review"):
        if _cuarentena_de_divisa(identificador):
            return MOTIVO_CUARENTENA_DE_DIVISA
    else:
        bloqueado_por_politica = politica.get("blocked")
        if (bloqueado_por_politica or not solo_dibujo) and _le_faltan_los_pagos(root, identificador, reader):
            return MOTIVO_REPARTE
        if bloqueado_por_politica:
            return "QUALITY_BLOCKED"
        if asset_id_in_quarantine(asset_id or root):
            return MOTIVO_CUARENTENA_DE_DIVISA
    if adjustment_problem(asset_id or root.get("asset_id", "")):
        return "QUALITY_BLOCKED"
    return None


# Cuarentena de divisa: activos cuyas series se sabe mal convertidas (verificador
# `scripts/verify_price_currency.py`). Se retiran de aqui cuando la reparacion pase la
# verificacion, no antes: admitir una serie mal convertida es peor que excluirla.
FX_QUARANTINE_ASSET_IDS = frozenset(
    filter(None, (os.environ.get("BDB_FX_QUARANTINE_ASSET_IDS") or "").split(","))
) or frozenset({
    "IE000M7V94E1",  # VanEck Uranium (NUKL.XETRA) — cotiza en EUR y se convertia
    "IE00B5BMR087",  # iShares Core S&P 500 (SXR8.XETRA) — idem
    "IE00B3YCGJ38",  # Invesco S&P 500 (P500.XETRA) — idem
    "IE0002PG6CA6",  # VanEck Rare Earth (VVMX.XETRA) — idem
    "IE000X59ZHE2",  # iShares AI Infrastructure (AIFS.XETRA) — idem
    "IE000DR59CI3",  # iShares Energy Storage (STOR.AS) — cotiza en USD y no se convertia
    "GB0005405286",  # HSBC (HSBA.LSE) — cotiza en PENIQUES y se trato como libras: x100
})


def _cuarentena_de_divisa(asset_id: str) -> bool:
    from price_repair_release import repair_released
    return bool(asset_id) and asset_id in FX_QUARANTINE_ASSET_IDS and not repair_released(asset_id)


def asset_id_in_quarantine(asset_or_root) -> bool:
    """¿Este activo esta en cuarentena por divisa mientras se repara su serie?"""
    if isinstance(asset_or_root, str):
        asset_id = asset_or_root.strip()
    elif isinstance(asset_or_root, dict):
        asset_id = str(
            asset_or_root.get("asset_id") or asset_or_root.get("id") or asset_or_root.get("isin") or ""
        ).strip()
    else:
        asset_id = ""
    from fund_history_quality import policy_for
    return bool(policy_for(asset_id).get("blocked")) or _cuarentena_de_divisa(asset_id)


def _root_instrument_type(root: dict) -> str:
    asset_type = str(root.get("asset_type") or "").strip().upper()
    if asset_type in {"FUND", "ETF", "STOCK", "INDEX"}:
        return asset_type
    product = root.get("product") or {}
    text = " ".join([
        asset_type.lower(),
        str(product.get("product_type") or "").lower(),
        str(product.get("commercial_type") or "").lower(),
        str(product.get("vehicle_complexity") or "").lower(),
    ])
    if any(token in text for token in ("etf", "etc", "etn", "etp", "exchange traded")):
        return "ETF"
    return asset_type or "UNKNOWN"


def _asset_currency(root: dict) -> Optional[str]:
    return (
        root.get("currency")
        or (root.get("identity") or {}).get("currency")
        or root.get("base_currency")
    )


def _load_asset_returns(reader, asset_id: str, root: dict, window: str, *, para_dibujar: bool = False) -> AssetReturns:
    docs = _cached_price_series(reader, asset_id, para_dibujar=para_dibujar)
    if adjustment_problem(asset_id, docs):
        raise PriceSeriesProblem("QUALITY_BLOCKED")
    if not docs:
        raise PriceSeriesProblem("PRICE_SERIES_MISSING")
    points = []
    for doc in docs:
        if doc.get("schema_version") not in (
            "asset-price-series.v1",
            "asset-price-series.v1.1",
            "asset-price-series.v1.2",
        ):
            continue
        if doc.get("currency") != "EUR":
            raise PriceSeriesProblem("FX_SERIES_MISSING")
        if doc.get("history_quality_status") == "BLOCKED":
            raise PriceSeriesProblem("QUALITY_BLOCKED")
        doc_points = doc.get("points")
        if not isinstance(doc_points, list):
            continue
        for point in doc_points:
            try:
                point_date = _parse_date(point.get("date"))
                value = float(point.get("value"))
            except Exception:
                raise PriceSeriesProblem("PRICE_SERIES_MISSING")
            if value <= 0:
                raise PriceSeriesProblem("PRICE_SERIES_MISSING")
            points.append((point_date, value))
    if not points:
        raise PriceSeriesProblem("PRICE_SERIES_MISSING")
    points = sorted(dict(points).items())
    latest = points[-1][0]
    cutoff = latest - timedelta(days=SUPPORTED_WINDOWS[window] * 366)
    window_points = [(d, v) for d, v in points if d >= cutoff]
    weekly = _weekly_last_observations(window_points)
    returns, weekly_dates, bridged = _weekly_returns(weekly)
    if not returns:
        raise PriceSeriesProblem("INSUFFICIENT_HISTORY")
    levels = {key: value for key, _point_date, value in weekly}
    return AssetReturns(
        asset_id=asset_id, root=root, returns_by_week=returns, weekly_dates=weekly_dates,
        levels_by_week=levels, bridged_weeks=frozenset(bridged),
    )


def _common_weeks(assets: List[AssetReturns]) -> List[Tuple[int, int]]:
    if not assets:
        return []
    common = set(assets[0].returns_by_week)
    for asset in assets[1:]:
        common &= set(asset.returns_by_week)
    return sorted(common, key=_week_start)


def _load_window_values(reader, asset_id: str, root: dict, window: str, margen_dias: int = 0, *, para_dibujar: bool = False) -> Dict[date, float]:
    """Cierres nativos (p.ej. diarios) dentro de la ventana, como {fecha: valor}."""
    # Ola 3b (T6g): pasa por la caché de series — antes leía la subcolección
    # documento a documento en cada backtest/serie rebasada.
    docs = _cached_price_series(reader, asset_id, para_dibujar=para_dibujar)
    if adjustment_problem(asset_id, docs):
        raise PriceSeriesProblem("QUALITY_BLOCKED")
    if not docs:
        raise PriceSeriesProblem("PRICE_SERIES_MISSING")
    points = []
    for doc in docs:
        if doc.get("schema_version") not in (
            "asset-price-series.v1",
            "asset-price-series.v1.1",
            "asset-price-series.v1.2",
        ):
            continue
        if doc.get("currency") != "EUR":
            raise PriceSeriesProblem("FX_SERIES_MISSING")
        if doc.get("history_quality_status") == "BLOCKED":
            raise PriceSeriesProblem("QUALITY_BLOCKED")
        doc_points = doc.get("points")
        if not isinstance(doc_points, list):
            continue
        for point in doc_points:
            try:
                point_date = _parse_date(point.get("date"))
                value = float(point.get("value"))
            except Exception:
                raise PriceSeriesProblem("PRICE_SERIES_MISSING")
            if value <= 0:
                raise PriceSeriesProblem("PRICE_SERIES_MISSING")
            points.append((point_date, value))
    if not points:
        raise PriceSeriesProblem("PRICE_SERIES_MISSING")
    by_date = dict(sorted(points))
    latest = max(by_date)
    cutoff = latest - timedelta(days=SUPPORTED_WINDOWS[window] * 366 + margen_dias)
    return {d: v for d, v in by_date.items() if d >= cutoff}


MIN_HISTORY_POLICIES = ("NONE", "ENFORCE")


def _min_history_days(window: str) -> int:
    """Umbral en dias de calendario equivalente al de la frontera (semanas * 7)."""
    return MIN_COMMON_OBSERVATIONS[window] * 7


def _short_history_exclusion(asset_id, observations, required, window):
    """Entrada de excluded_assets para un activo que no llega al minimo del motor."""
    return {
        "asset_id": asset_id,
        "reason": "INSUFFICIENT_HISTORY",
        "observations": int(observations),
        "required": int(required),
        "window": window,
    }


def _window_limits(loaded, common) -> dict:
    """Que activo recorta la ventana comun: el que entra mas tarde y el que se va
    antes. Con un solo activo no hay nada que atribuir. Sirve para que la pantalla
    y el informe puedan nombrar al causante en vez de ensenar una ventana corta
    sin explicacion (auditoria 06-09-2026, A3)."""
    if len(loaded) < 2 or not common:
        return {"start": None, "end": None}
    inicio = _week_start(common[0])
    fin = _week_start(common[-1])
    empieza_tarde = None
    acaba_pronto = None
    for ar in loaded:
        semanas = list(ar.returns_by_week.keys())
        if not semanas:
            continue
        primera = min(_week_start(w) for w in semanas)
        ultima = max(_week_start(w) for w in semanas)
        if primera >= inicio and (empieza_tarde is None or primera > empieza_tarde[1]):
            empieza_tarde = (ar.asset_id, primera)
        if ultima <= fin and (acaba_pronto is None or ultima < acaba_pronto[1]):
            acaba_pronto = (ar.asset_id, ultima)
    return {
        "start": empieza_tarde[0] if empieza_tarde else None,
        "end": acaba_pronto[0] if acaba_pronto else None,
    }


def _window_limits_daily(loaded, common_dates) -> dict:
    """Igual que `_window_limits`, para la rama DIARIA.

    06-09-2026: la rama diaria no calculaba limites, asi que el aviso de ventana corta
    salia sin decir QUIEN la recorta —justo el dato que permite arreglarlo—. `loaded`
    son tripletas (asset_id, nombre, {fecha: valor}).
    """
    if len(loaded) < 2 or not common_dates:
        return {"start": None, "end": None}
    inicio = common_dates[0]
    fin = common_dates[-1]
    empieza_tarde = None
    acaba_pronto = None
    for aid, _nombre, vals in loaded:
        fechas = list(vals.keys())
        if not fechas:
            continue
        primera = min(fechas)
        ultima = max(fechas)
        if primera >= inicio and (empieza_tarde is None or primera > empieza_tarde[1]):
            empieza_tarde = (aid, primera)
        if ultima <= fin and (acaba_pronto is None or ultima < acaba_pronto[1]):
            acaba_pronto = (aid, ultima)
    return {
        "start": empieza_tarde[0] if empieza_tarde else None,
        "end": acaba_pronto[0] if acaba_pronto else None,
    }


def _rebase_payload(base_currency, window, frequency, dates, series, requested, excluded,
                    limits=None) -> dict:
    limites = limits or {}
    return {
        "schema_version": "price-series.v1",
        "base_currency": base_currency,
        "window": window,
        "frequency": frequency,
        "rebased_to": 100,
        "dates": dates,
        "series": series,
        "coverage": {
            "requested_assets": requested,
            "included_assets": len(series),
            "common_observations": len(dates),
            "required_observations": MIN_COMMON_OBSERVATIONS.get(window),
            "first_date": dates[0] if dates else None,
            "last_date": dates[-1] if dates else None,
            "window_start_limited_by": limites.get("start"),
            "window_end_limited_by": limites.get("end"),
        },
        "excluded_assets": excluded,
    }


def build_rebased_series(reader, request: dict) -> dict:
    """Series de precio alineadas y rebasadas a 100 (para comparador). Solo lectura."""
    if not isinstance(request, dict):
        raise InvalidOptimizationRequest("Request must be an object.")
    raw_ids = request.get("asset_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise InvalidOptimizationRequest("asset_ids must contain at least one asset.")
    ids = []
    alias_resolutions: Dict[str, str] = {}
    conflicts = alias_conflicts(raw_ids)
    if conflicts:
        raise InvalidOptimizationRequest(alias_conflict_message(conflicts))
    for aid in raw_ids:
        if isinstance(aid, str) and aid.strip():
            aid = canonical_noting(aid, alias_resolutions)
            if aid not in ids:
                ids.append(aid)
        if len(ids) >= MAX_REBASED_SERIES_ASSETS:
            break
    window = request.get("window")
    if window not in SUPPORTED_WINDOWS:
        window = "3Y"
    base_currency = request.get("base_currency", "EUR")
    if base_currency != "EUR":
        raise InvalidOptimizationRequest("Only EUR base_currency is supported.")
    frequency = request.get("frequency", "WEEKLY")
    if frequency not in ("WEEKLY", "DAILY"):
        frequency = "WEEKLY"
    # Politica de historico minimo. Por defecto NONE: el comparador y la ficha de
    # activo deben poder pintar un fondo joven junto a uno viejo. El X-Ray pide
    # ENFORCE para que el grafico y la frontera analicen la MISMA cartera.
    min_history = request.get("min_history", "NONE")
    if min_history not in MIN_HISTORY_POLICIES:
        min_history = "NONE"
    # La ficha y el comparador dibujan la serie de un fondo que reparte, y la marcan para rotularla.
    # La simulacion mide con ella, asi que la pide `para_medir` y ese fondo se queda fuera (decision 8).
    solo_dibujo = request.get("para_medir") is not True
    sin_dividendos = set()

    excluded = []

    if frequency == "DAILY":
        loaded = []
        for aid in ids:
            root = reader.get_asset(aid)
            reason = _root_exclusion_reason(root, base_currency, aid, allow_historical=True, solo_dibujo=solo_dibujo, reader=reader)
            if reason:
                excluded.append({"asset_id": aid, "reason": reason})
                continue
            try:
                vals = _load_window_values(reader, aid, root, window, para_dibujar=solo_dibujo)
            except PriceSeriesProblem as problem:
                excluded.append({"asset_id": aid, "reason": problem.reason})
                continue
            if not vals:
                excluded.append({"asset_id": aid, "reason": "INSUFFICIENT_HISTORY"})
                continue
            if min_history == "ENFORCE":
                dias = (max(vals) - min(vals)).days
                minimo = _min_history_days(window)
                if dias < minimo:
                    excluded.append(_short_history_exclusion(aid, dias, minimo, window))
                    continue
            name = (root.get("identity") or {}).get("name") or aid
            if _se_dibuja_sin_dividendos(root, aid, reader):
                sin_dividendos.add(aid)
            loaded.append((aid, name, vals))

        if len(loaded) >= 2:
            common = set(loaded[0][2].keys())
            for _aid, _name, vals in loaded[1:]:
                common &= set(vals.keys())
            common_dates = sorted(common)
        elif loaded:
            common_dates = sorted(loaded[0][2].keys())
        else:
            common_dates = []

        dates = [d.isoformat() for d in common_dates]
        series = []
        for aid, name, vals in loaded:
            if not common_dates:
                break
            base = vals[common_dates[0]]
            series.append({
                "asset_id": aid,
                "display_name": name,
                "values": [round(vals[d] / base * 100.0, 4) for d in common_dates],
                **({"sin_dividendos": True} if aid in sin_dividendos else {}),
            })
        return with_alias_resolutions(
            _rebase_payload(base_currency, window, "DAILY", dates, series, len(ids), excluded,
                            _window_limits_daily(loaded, common_dates)),
            alias_resolutions,
        )

    loaded = []
    for aid in ids:
        root = reader.get_asset(aid)
        reason = _root_exclusion_reason(root, base_currency, aid, allow_historical=True, solo_dibujo=solo_dibujo, reader=reader)
        if reason:
            excluded.append({"asset_id": aid, "reason": reason})
            continue
        try:
            ar = _load_asset_returns(reader, aid, root, window, para_dibujar=solo_dibujo)
        except PriceSeriesProblem as problem:
            excluded.append({"asset_id": aid, "reason": problem.reason})
            continue
        if min_history == "ENFORCE":
            semanas = len(ar.returns_by_week)
            minimo = MIN_COMMON_OBSERVATIONS[window]
            if semanas < minimo:
                excluded.append(_short_history_exclusion(aid, semanas, minimo, window))
                continue
        if _se_dibuja_sin_dividendos(root, aid, reader):
            sin_dividendos.add(aid)
        loaded.append(ar)

    if len(loaded) >= 2:
        common = _common_weeks(loaded)
    elif loaded:
        common = sorted(loaded[0].returns_by_week.keys(), key=_week_start)
    else:
        common = []

    dates = [_week_start(w).isoformat() for w in common]
    series = []
    for ar in loaded:
        if not common:
            break
        # 29-09-2026 (B-04): se rebasa sobre NIVELES semanales (valor / valor base), igual
        # que la rama DIARIA. Antes se encadenaba `nivel *= 1 + r` solo sobre las semanas
        # comunes: si a un activo le faltaba una semana, esa semana salia de `common` y
        # su movimiento desaparecia de TODAS las series (un +20 % en la semana sin dato
        # dejaba a los dos activos en 100,00). Con niveles, el tramo entre dos semanas
        # comunes consecutivas recoge todo lo ocurrido entre ellas, haya hueco o no.
        levels = ar.levels_by_week
        base = levels[common[0]]
        values = [round(levels[w] / base * 100.0, 4) for w in common]
        series.append({
            "asset_id": ar.asset_id,
            "display_name": (ar.root.get("identity") or {}).get("name") or ar.asset_id,
            "values": values,
            **({"sin_dividendos": True} if ar.asset_id in sin_dividendos else {}),
        })
    return with_alias_resolutions(
        _rebase_payload(base_currency, window, "WEEKLY", dates, series, len(ids), excluded,
                        _window_limits(loaded, common)),
        alias_resolutions,
    )


def _normalize_locked_weights(asset_ids: List[str], locked_weights: Optional[Dict[str, float]]) -> Dict[str, float]:
    if not locked_weights:
        return {}
    included = set(asset_ids)
    out = {}
    for aid, w in locked_weights.items():
        if aid in included and _finite_number(w):
            out[aid] = max(0.0, float(w))
    suma = sum(out.values())
    if suma > 1.0 + 1e-9:
        raise InvalidOptimizationRequest(f"Sin solución: los candados suman {_en_pct(suma)}, más del 100 %.")
    return out




def _risk_contribution_contract(asset_ids: List[str], weights: List[float], covariance: List[List[float]],
                                cov_model: str) -> tuple[Optional[List[dict]], dict]:
    """Materialize F5a without estimating or changing the supplied covariance."""
    percentages = risk_contributions(weights, covariance)
    meta = {"cov_model": cov_model}
    if percentages is None:
        meta["reason"] = "ZERO_VOLATILITY"
        return None, meta
    return [
        {
            "asset_id": asset_id,
            "weight_pct": weight * 100.0,
            "risk_pct": risk_pct,
        }
        for asset_id, weight, risk_pct in zip(asset_ids, weights, percentages)
    ], meta


def _finite_number(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def _parse_date(value: str) -> date:
    # Histories use ISO dates. The C parser avoids strptime's process-wide
    # regex lock, which otherwise serializes the parallel historical readers.
    # Preserve the previous parser for legacy inputs and its exact error path.
    if isinstance(value, str) and len(value) == 10 and value[4] == "-" and value[7] == "-":
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    return datetime.strptime(value, "%Y-%m-%d").date()


def _weekly_measurement_points(dates_iso: List[str], levels: List[float]):
    """Remuestrea a semanal (ultima observacion de cada semana ISO) una serie.

    Las metricas anualizadas (CAGR, volatilidad, Sharpe) y la correlacion se miden
    SIEMPRE en semanal, se dibuje en diario o en semanal: en fondos el dato diario
    infla la volatilidad y sesga la correlacion a la baja. La maxima caida no pasa
    por aqui: es una propiedad del camino y se mide sobre la serie que se dibuja.

    Devuelve [(clave ISO, fecha, valor)]; sobre una serie ya semanal es la identidad.
    """
    points = [(_parse_date(d), float(v)) for d, v in zip(dates_iso, levels)]
    return _weekly_last_observations(points)


def _measured_weekly_returns(weekly) -> Dict[Tuple[int, int], float]:
    """CRIT-04 (auditoria 16-10-2026): retornos solo entre semanas ISO separadas como
    mucho MAX_BRIDGED_WEEK_GAP_DAYS, la misma regla que returns_by_week. Antes se
    encadenaban los niveles medidos uno tras otro y un hueco de varias semanas en la
    ventana comun contaba como una sola semana (inflaba volatilidad y CAGR)."""
    returns, _dates, _bridged = _weekly_returns(weekly)
    return returns


def backtest_portfolio(reader, request: dict, *, risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
                       risk_free_resolver: Optional[RiskFreeResolver] = None) -> dict:
    """Backtest de una cartera (pesos sobre series ya alineadas). Solo lectura.

    Reutiliza build_rebased_series (alinea divisa/frecuencia/fechas comunes y rebasa a 100)
    y aplica los pesos para obtener la serie de la cartera, sus metricas y la matriz de
    correlacion entre activos.
    """
    import math

    if not isinstance(request, dict):
        raise InvalidOptimizationRequest("Request must be an object.")
    positions = request.get("positions") or []
    weights: Dict[str, float] = {}
    ids: List[str] = []
    recortados: List[str] = []
    alias_resolutions: Dict[str, str] = {}
    conflicts = alias_conflicts([(p or {}).get("asset_id") for p in positions if isinstance(p, dict)])
    if conflicts:
        raise InvalidOptimizationRequest(alias_conflict_message(conflicts))
    for p in positions:
        aid = (p or {}).get("asset_id")
        if isinstance(aid, str) and aid.strip():
            aid = canonical_noting(aid, alias_resolutions)
            w = p.get("weight")
            try:
                w = float(w)
            except (TypeError, ValueError):
                w = 0.0
            if aid not in weights:
                if len(ids) >= MAX_REBASED_SERIES_ASSETS:
                    # El tope recortaba en silencio: ahora sale en excluded_assets.
                    if aid not in recortados:
                        recortados.append(aid)
                    continue
                ids.append(aid)
            weights[aid] = weights.get(aid, 0.0) + max(0.0, w)
    if not ids:
        raise InvalidOptimizationRequest("positions must contain at least one asset_id.")

    window = request.get("period") or request.get("window") or "3Y"
    if window not in SUPPORTED_WINDOWS:
        window = "3Y"
    frequency = request.get("frequency", "WEEKLY")
    if frequency not in ("WEEKLY", "DAILY"):
        frequency = "WEEKLY"
    # 06-09-2026: la ventana comun es la INTERSECCION de todos los activos, asi que un
    # solo historico corto la colapsa (un ETF de 2025 dejaba una cartera de 38 activos
    # en ano y medio). Con "ENFORCE" se apartan los activos que no cubren la ventana y
    # se dicen en `excluded_assets`, en vez de encoger la de todos en silencio.
    min_history = request.get("min_history", "NONE")
    if min_history not in MIN_HISTORY_POLICIES:
        min_history = "NONE"

    payload = build_rebased_series(reader, {
        "asset_ids": ids,
        "window": window,
        "frequency": frequency,
        "base_currency": "EUR",
        "min_history": min_history,
        "para_medir": True,
    })
    dates = payload.get("dates") or []
    series = payload.get("series") or []
    if len(series) < 1 or len(dates) < 3:
        excluidos = payload.get("excluded_assets") or []
        if excluidos and all(item.get("reason") == MOTIVO_REPARTE for item in excluidos):
            raise OptimizationError("Todas las posiciones reparten y no tenemos todos sus pagos: no se puede simular esta cartera.")
        raise OptimizationError("Las posiciones no comparten histórico suficiente para simular esta cartera. Prueba con un periodo más corto o quita los activos con menos historia.")

    included_ids = [s["asset_id"] for s in series]
    wsum = sum(weights.get(aid, 0.0) for aid in included_ids)
    if wsum <= 0:
        norm = {aid: 1.0 / len(included_ids) for aid in included_ids}
    else:
        norm = {aid: weights.get(aid, 0.0) / wsum for aid in included_ids}

    n = len(dates)
    port = []
    for t in range(n):
        v = 0.0
        for s in series:
            v += norm[s["asset_id"]] * s["values"][t]
        port.append(v)

    # Dibujar en diario, medir en semanal: `port` es la serie que se pinta y
    # `measure_port` la que se mide. En WEEKLY la serie ya es semanal y el
    # remuestreo es la identidad.
    measure_weekly = _weekly_measurement_points(dates, port)
    measure_port = [value for _key, _point_date, value in measure_weekly]
    measure_assets = [_weekly_measurement_points(dates, s["values"]) for s in series]
    if len(measure_port) < 3:
        raise OptimizationError("Las posiciones no comparten histórico suficiente para simular esta cartera. Prueba con un periodo más corto o quita los activos con menos historia.")

    # CRIT-04 + ALTA-01 (auditoria 16-10-2026): los anios del CAGR salen de las fechas
    # (dias / 365,2425), no del numero de puntos, y la volatilidad es la muestral (n-1) de
    # weekly_sampling sobre retornos entre semanas separadas <= 14 dias. Antes (len-1)/52 y
    # pstdev: un hueco de 12 semanas a 3 anios subia el CAGR de 9,07 % a 9,83 % y la
    # volatilidad, ~0,6 pp. Segunda pasada (17-10-2026): el CAGR va de la primera a la
    # ultima fecha de la serie DIBUJADA, como portfolio_horizon._backtest (que alimenta el
    # informe interno); en DAILY antes se anclaba al cierre de la primera semana ISO. Lo que
    # cambia es el titular «Rentabilidad 3A» y el Sharpe 3A del informe de cliente
    # (portfolioReportAnalytics pide este backtest 3Y en DAILY y reportPipeline.
    # buildReportHeadlineMetrics usa metrics.cagr/sharpe). En WEEKLY no cambia nada.
    port_ret = list(_measured_weekly_returns(measure_weekly).values())
    ppy = ANNUALIZATION_FACTOR
    first, last = port[0], port[-1]
    # 15-11-2026 (decision de Oscar): un tramo de menos de MIN_ANNUALIZATION_DAYS no se
    # anualiza, la convencion del sector y la de la maestra y la cartera real. Antes, con la
    # ventana colapsada por un activo reciente, un +6 % en 119 dias salia como un 19,5 % anual.
    # Ahora `cagr` y `sharpe` van vacios (None, nunca 0) y la cifra que se ensena es la
    # rentabilidad acumulada del tramo, que viaja SIEMPRE junto a sus dias y a la marca de si
    # esta anualizada. Con 330 dias o mas, cagr y sharpe son exactamente los de antes.
    period_days = (_parse_date(dates[-1]) - _parse_date(dates[0])).days
    years = max(1e-9, period_days / DAYS_PER_YEAR)
    cumulative_return = (last / first) - 1.0 if first > 0 else None
    annualized = period_days >= MIN_ANNUALIZATION_DAYS
    if annualized:
        cagr = (last / first) ** (1.0 / years) - 1.0 if first > 0 else 0.0
    else:
        cagr = None
    vol = _sample_volatility(port_ret, ppy) if len(port_ret) > 1 else 0.0
    risk_free_context, risk_free_warnings = _resolve_risk_free_context(
        dates[0], dates[-1], risk_free_rate, risk_free_resolver
    )
    rf = risk_free_context["risk_free_rate"]
    # Decision 6.3 (17-10-2026): el Sharpe ex post unico de weekly_sampling. Sin CAGR no hay
    # Sharpe. Con volatilidad cero tampoco (hallazgo 11, 15-11-2026): va vacio, nunca 0, y se
    # distingue del tramo corto porque `annualized` es True y `cagr` es un numero.
    sharpe = _ex_post_sharpe(cagr, rf, vol) if annualized else None

    # La maxima caida se mide sobre la serie DIBUJADA (la mas fina disponible):
    # no se anualiza, es el suelo real del camino, y asi el numero coincide con
    # lo que se ve en el grafico. Decision de Oscar, 03-09-2026.
    peak = port[0]
    mdd = 0.0
    for v in port:
        if v > peak:
            peak = v
        dd = (v / peak - 1.0) if peak > 0 else 0.0
        if dd < mdd:
            mdd = dd

    asset_rets = [_measured_weekly_returns(weekly) for weekly in measure_assets]

    def _pearson(ra, rb):
        # Mismas semanas en los dos activos (comparten fechas; se cruza por si acaso).
        keys = [key for key in ra if key in rb]
        m = len(keys)
        # Hallazgo 11 (15-11-2026): lo que no se puede calcular (menos de tres semanas comunes, o
        # varianza cero, como un precio congelado) va vacio, nunca 0, que es una correlacion real.
        if m < 3:
            return None
        a = [ra[key] for key in keys]
        b = [rb[key] for key in keys]
        ma = sum(a) / m
        mb = sum(b) / m
        cov = sum((a[i] - ma) * (b[i] - mb) for i in range(m))
        va = sum((x - ma) ** 2 for x in a)
        vb = sum((x - mb) ** 2 for x in b)
        d = math.sqrt(va * vb)
        return cov / d if d > 0 else None

    k = len(asset_rets)
    corr = [[1.0 if i == j else _pearson(asset_rets[i], asset_rets[j]) for j in range(k)] for i in range(k)]

    # F5a uses an independent 10Y EUR load so the selected backtest period remains
    # unchanged while COVID, 2022 and the oldest common history stay available.
    stress_series = {}
    stress_exclusion_reasons = {}
    for asset_id in ids:
        root = reader.get_asset(asset_id)
        exclusion_reason = _root_exclusion_reason(root, "EUR", asset_id, allow_historical=True, reader=reader)
        if exclusion_reason:
            stress_exclusion_reasons[asset_id] = exclusion_reason
            continue
        try:
            values = _load_window_values(reader, asset_id, root, "10Y")
        except PriceSeriesProblem as problem:
            stress_exclusion_reasons[asset_id] = problem.reason
            continue
        stress_series[asset_id] = [
            {"date": point_date.isoformat(), "value": value}
            for point_date, value in values.items()
        ]
    stress_scenarios = stress_windows(
        stress_series,
        weights,
        exclusion_reasons=stress_exclusion_reasons,
    )

    # Auditoria 06-09-2026 (A3): la ventana comun se cruza entre todos los activos,
    # asi que un solo historico corto la colapsa. Antes se devolvia sin un aviso y la
    # pantalla presentaba nueve meses como si fueran tres anos. El codigo viaja en
    # `warnings` (mismo estilo que los del tipo sin riesgo) y las cifras exactas, en
    # `coverage`; el tope de activos deja de recortar en silencio.
    warnings = list(risk_free_warnings)
    excluded_assets = list(payload.get("excluded_assets", []))
    for aid in recortados:
        excluded_assets.append({"asset_id": aid, "reason": "ASSET_CAP_EXCEEDED"})
    # 06-09-2026: `MIN_COMMON_OBSERVATIONS` esta en SEMANAS, y aqui se comparaba contra
    # `len(dates)`, que en modo diario son DIAS. Con 320 dias (ano y medio) frente a un
    # minimo de 156 semanas, el aviso no saltaba nunca: la ventana colapsada solo se veia
    # porque la pantalla miraba el calendario por su cuenta. Se compara ya en semanas.
    medidas = len(measure_port)
    minimo_ventana = MIN_COMMON_OBSERVATIONS.get(window)
    if minimo_ventana and medidas < minimo_ventana:
        warnings.append("WINDOW_COLLAPSED")
    if not annualized:
        warnings.append("PERIOD_TOO_SHORT_TO_ANNUALIZE")

    cobertura = dict(payload.get("coverage") or {})
    # `common_observations` sigue contando la serie DIBUJADA; las medidas van aparte y
    # con su frecuencia dicha, para que nadie vuelva a rotular dias como semanas.
    cobertura["measured_observations"] = medidas
    cobertura["measurement_frequency"] = "WEEKLY"
    cobertura["series_frequency"] = frequency

    return with_alias_resolutions({
        "schema_version": "backtest.v1",
        "base_currency": "EUR",
        "window": window,
        "frequency": frequency,
        "metrics_frequency": "WEEKLY",
        "max_drawdown_frequency": frequency,
        "units": "decimal",
        "metrics": {
            "cagr": cagr,
            "volatility": vol,
            "sharpe": sharpe,
            "max_drawdown": mdd,
            "rf_rate": rf,
            # Aditivos (15-11-2026), siempre presentes: la rentabilidad del tramo entero, sin
            # anualizar; sus dias y fechas (las de la serie dibujada, las mismas del CAGR); y si
            # `cagr`/`sharpe` estan anualizados (False: van a None, aviso PERIOD_TOO_SHORT_TO_ANNUALIZE).
            "cumulative_return": cumulative_return,
            "period_start": dates[0],
            "period_end": dates[-1],
            "period_days": period_days,
            "annualized": annualized,
        },
        "risk_free": risk_free_context,
        "portfolio_series": [{"date": dates[t], "value": port[t]} for t in range(n)],
        "asset_ids": included_ids,
        "weights_normalized": norm,
        "stress_scenarios": stress_scenarios,
        "correlation_matrix": corr,
        "benchmark_series": {},
        "synthetics": [],
        "coverage": cobertura,
        "excluded_assets": excluded_assets,
        "warnings": warnings,
    }, alias_resolutions)


# ---------------------------------------------------------------------------
# Robust Frontier Engine v2. No altera el contrato: solo anade campos aditivos
# (methodology.*, diagnostics, target_portfolio). Ver robust_engine.py.
# ---------------------------------------------------------------------------

def _optimize_regularizado(reader, req, as_of_date, risk_free_rate, risk_free_resolver, today, reference_bundle) -> dict:
    """Todos los objetivos: el motor y la matriz de la simulacion.

    Con los mismos activos, la misma ventana y sin restricciones que Simular no tiene, los pesos son los de
    `portfolio_horizon.analyze_horizon`, porque son el mismo calculo con la misma entrada. Lo comprueba
    `tests/test_maximo_sharpe_una_sola_cartera.py`. El tope, los candados y el resto de restricciones los lleva
    el motor.

    «Rentabilidad objetivo» no tiene Comparativa en Simular, y la cifra que se pide es la media aritmetica de la serie (decision 94):
    con pesos fijos y anualizada por 52, no la rentabilidad anualizada que luego rinde la cartera, con sus pesos derivando. Asi que aqui
    se manda tambien lo que mide la serie, con la cuenta de Simular y frente a la cartera actual: `target_return_measured`.
    """
    # Aqui dentro porque `portfolio_horizon` importa este modulo.
    from portfolio_horizon import avisos_del_periodo, medir_con_la_serie, periodo_para_optimizar, retornos_semanales
    started = time.monotonic()
    with prepare_solver_during_reads(True):
        periodo, fuera, roots = periodo_para_optimizar(reader, req.asset_ids, req.window, today=today, reference_bundle=reference_bundle)
        read_seconds = time.monotonic() - started
    asset_ids = periodo.ids
    # Un motivo que el contrato no conoce tiraria la respuesta entera en el cliente.
    excluded = [{**item, "reason": item["reason"] if item["reason"] in EXCLUSION_REASONS else "NON_INVESTABLE"} for item in fuera]
    LOGGER.info("portfolio_optimization_phase", phase="read", assets=len(req.asset_ids), included=len(asset_ids), seconds=round(read_seconds, 3))
    if len(asset_ids) < 2:
        raise OptimizationError("Hacen falta al menos dos activos con precios en euros y suficiente histórico en este periodo. Prueba con otro periodo o con otros activos.")
    # Hallazgo 12 (15-11-2026): cuantos activos caben depende de los datos de la ventana. Se cuentan los que entran en la
    # frontera, ya apartados los que no se pueden medir o comprar, como el tope de 40 de Simular.
    limite = maximo_de_activos_de_la_ventana(
        req.window, len(periodo.week_indices) - 1, date.fromisoformat(periodo.dates[-1]))
    if len(asset_ids) > limite["max_assets"]:
        LOGGER.info("portfolio_optimization_asset_limit", window=req.window, included=len(asset_ids), max_assets=limite["max_assets"])
        raise OptimizationError(_mensaje_de_pocos_datos_por_activo(limite, len(asset_ids), len(excluded)))
    _sin_candados_fuera(req.locked_weights, asset_ids)
    dates = periodo.dates
    risk_free_context, warnings = _resolve_risk_free_context(dates[0], dates[-1], risk_free_rate, risk_free_resolver)
    # OPT-2: si la mayoria de las series esta parada, el periodo acaba donde acaban ellas, y se dice.
    warnings = list(warnings) + avisos_del_periodo(dates, today)
    solve_started = time.monotonic()
    activos = [AssetReturns(asset_id=aid, root=roots.get(aid) or {}, returns_by_week={}, weekly_dates={}) for aid in asset_ids]
    result = _optimize_v2(
        req, asset_ids, retornos_semanales(periodo.matrix, periodo.week_indices).tolist(),
        {"first_date": dates[0], "last_date": dates[-1], "observations": len(periodo.week_indices)},
        excluded, warnings, as_of_date, risk_free_context["risk_free_rate"], risk_free_context,
        group_constraints=_resolve_group_constraints(req.group_constraints, activos),
        group_labels={dim: {a.asset_id: _group_label(a.root, dim) for a in activos} for dim in _GROUP_FIELD},
    )
    # Los tramos estimados entran en el calculo, igual que en la simulacion, y se dice cuales son.
    result["extensions"] = periodo.extensions
    # Aditivo: cuantos retornos tiene la ventana y cuantos activos admitia, para que la pantalla lo pueda decir.
    result["asset_limit"] = limite
    if req.objective == "TARGET_RETURN":
        actual = result["current_portfolio"]
        result["target_return_measured"] = {
            "portfolio": medir_con_la_serie(periodo, result["target_return_portfolio"]["weights"], req.window, risk_free_context),
            "current": medir_con_la_serie(periodo, actual["weights"], req.window, risk_free_context) if actual else None,
        }
    LOGGER.info("portfolio_optimization_phase", phase="solve", assets=len(asset_ids), seconds=round(time.monotonic()-solve_started, 3), total_seconds=round(time.monotonic()-started, 3))
    return with_alias_resolutions(result, req.alias_resolutions, req.weight_alias_merges)


_PERIODO_EN_PALABRAS = {"1Y": "1 año", "3Y": "3 años", "5Y": "5 años", "10Y": "10 años"}


def retornos_semanales_de_la_ventana(window: str, fin: date) -> int:
    """Cuantos retornos semanales tiene la ventana que acaba en `fin` (un viernes), con el calendario de `_periodo_comun`.

    No depende de los datos: es la rejilla de dias laborables de la ventana, con su inicio llevado al viernes anterior,
    y una semana ISO por punto. Lo comprueba `tests/test_optimizar_activos_por_ventana.py` contra el periodo de verdad.
    """
    from portfolio_horizon import _week_indices, _years_before
    inicio = _years_before(fin, SUPPORTED_WINDOWS[window])
    inicio -= timedelta(days=(inicio.weekday() - 4) % 7)
    dias, dia = [], inicio
    while dia <= fin:
        if dia.weekday() < 5:
            dias.append(dia.isoformat())
        dia += timedelta(days=1)
    return len(_week_indices(dias)) - 1


def maximo_de_activos_de_la_ventana(window: str, retornos: int, fin: date) -> dict:
    """El maximo de activos de la frontera en esta ventana: la proporcion entre datos y activos aceptada a 3 anos.

    `retornos` son los retornos semanales del periodo que se va a optimizar. El maximo es
    MAX_ACTIVOS_FRONTERA x retornos / retornos de la ventana de referencia con el mismo fin, a la baja, y nunca por encima
    de MAX_ACTIVOS_FRONTERA (hallazgo 12, 15-11-2026). Viaja en la respuesta como `asset_limit`.
    """
    from portfolio_horizon import MAX_ACTIVOS_FRONTERA, VENTANA_DEL_TOPE_DE_LA_FRONTERA
    referencia = retornos_semanales_de_la_ventana(VENTANA_DEL_TOPE_DE_LA_FRONTERA, fin)
    maximo = min(MAX_ACTIVOS_FRONTERA, (MAX_ACTIVOS_FRONTERA * retornos) // referencia)
    return {
        "window": window, "weekly_returns": retornos, "max_assets": maximo,
        "reference_window": VENTANA_DEL_TOPE_DE_LA_FRONTERA, "reference_weekly_returns": referencia,
        "reference_max_assets": MAX_ACTIVOS_FRONTERA,
    }


def _mensaje_de_pocos_datos_por_activo(limite: dict, activos: int, apartados: int) -> str:
    """El texto para el asesor. Empieza como los demas limites del calculo: la pantalla lo lee asi (src/core/appError.ts)."""
    fuera = "" if not apartados else (
        f" (de los pedidos, {apartados} se quedan fuera por no tener la serie del periodo o no poderse comprar)")
    return (
        f"El cálculo admite {limite['max_assets']} activos como máximo y esta cartera tiene {activos} "
        f"con el periodo de {_PERIODO_EN_PALABRAS[limite['window']]}{fuera}: con {limite['weekly_returns']} semanas de datos "
        f"son pocos datos por activo para estimar cómo se mueven juntos, y la propuesta sería sobre todo error de estimación. "
        f"Pasa a {_PERIODO_EN_PALABRAS[limite['reference_window']]}, que admite {limite['reference_max_assets']}, "
        f"o quita activos hasta dejar {limite['max_assets']}."
    )


def _mensaje_de_fallo_del_optimizador(objective: str) -> str:
    """El texto para el asesor cuando el motor no encuentra solucion por un fallo numerico, no por las restricciones."""
    if objective == "TARGET_RETURN":
        return ("El optimizador no ha conseguido construir una cartera con la rentabilidad objetivo pedida con estos activos y "
                "restricciones. Prueba con una rentabilidad algo menor, con menos restricciones o con otro periodo.")
    return ("El optimizador no ha conseguido una solución con estos activos y restricciones. Prueba con menos restricciones, "
            "con otro periodo o quitando algún activo.")


def _optimize_v2(req, asset_ids, matrix, periodo, excluded, warnings, as_of_date,
                 risk_free_rate, risk_free_context, group_constraints=None, group_labels=None) -> dict:
    from . import robust_engine
    try:
        eng = robust_engine.solve(
            asset_ids, matrix,
            objective=req.objective,
            risk_target_mode=getattr(req, "risk_target_mode", "FRONTIER_PERCENTILE"),
            risk_slider=(getattr(req, "risk_slider", None) or 5),
            target_return=req.target_return,
            target_volatility=getattr(req, "target_volatility", None),
            current_weights=req.current_weights,
            min_weight=req.min_weight,
            # R-02 (auditoria 29-09-2026): sin tope explicito del usuario (1.0 es el relleno
            # de validate_request) el motor robusto aplica su tope dinamico por numero de
            # activos (0,60/0,35/0,25/0,20); pasar 1.0 lo anulaba y un MAX_SHARPE de 20
            # activos concentraba el 33 % en uno.
            max_weight=(req.max_weight if req.max_weight < 1.0 else None),
            locked_weights=_normalize_locked_weights(asset_ids, req.locked_weights),
            frontier_points=PUNTOS_DE_LA_FRONTERA,
            risk_free_rate=risk_free_rate,
            return_mode=getattr(req, "return_mode", "HISTORICAL_SHRINKAGE"),
            group_constraints=group_constraints,
            max_turnover=getattr(req, "max_turnover", None),
        )
    except robust_engine.WeightConstraintError as exc:
        raise InvalidOptimizationRequest(str(exc)) from exc
    except (InvalidOptimizationRequest, OptimizationError):
        raise  # ya llevan su mensaje
    except Exception as exc:
        # Hallazgo 15 (15-11-2026): cualquier otro fallo del motor (el segundo intento del solver que tambien falla en la
        # minima volatilidad, la «Rentabilidad objetivo» a la que no llega) sale como error con mensaje y no como INTERNAL.
        LOGGER.warn("portfolio_optimization_solver_failed", error=type(exc).__name__, detail=str(exc)[:300], objective=req.objective)
        raise OptimizationError(_mensaje_de_fallo_del_optimizador(req.objective)) from exc
    all_warnings = list(warnings) + list(eng.get("warnings", []))
    diagnostics = dict(eng.get("diagnostics", {}))
    _tp = eng.get("target_portfolio")
    if group_labels and _tp and _tp.get("weights"):
        diagnostics["group_exposures"] = _target_group_exposures(_tp["weights"], group_labels)
    if req.current_weights:
        excl_ids = [e["asset_id"] for e in excluded]
        cov_loss = sum(max(0.0, float(req.current_weights.get(a, 0.0))) for a in excl_ids)
        diagnostics["coverage_loss_weight"] = round(cov_loss, 6)
        diagnostics["excluded_positions"] = [
            {"asset_id": e["asset_id"], "reason": e["reason"],
             "original_weight": round(max(0.0, float(req.current_weights.get(e["asset_id"], 0.0))), 6)}
            for e in excluded
        ]
        if cov_loss > 0.10:
            all_warnings.append("COVERAGE_LOSS_ABOVE_10PCT")
    methodology = {
        "window": req.window, "frequency": "WEEKLY", "annualization_factor": ANNUALIZATION_FACTOR,
        "alignment_policy": "COMMON_WEEKLY_DATES", **risk_free_context,
    }
    methodology.update(eng.get("methodology_extra", {}))
    covariance_asset_ids = list(eng.get("covariance_asset_ids") or asset_ids)
    covariance_matrix = eng.get("covariance_matrix") or []
    covariance_meta = eng.get("covariance_meta") or {}
    current_point = eng.get("current_portfolio")
    current_weight_map = current_point.get("weights", {}) if current_point else {}
    contribution_rows, contribution_meta = _risk_contribution_contract(
        covariance_asset_ids,
        [float(current_weight_map.get(asset_id, 0.0)) for asset_id in covariance_asset_ids],
        covariance_matrix,
        covariance_meta.get("covariance_estimator", methodology.get("covariance_estimator")),
    )
    return {
        "schema_version": SCHEMA_RESPONSE,
        "as_of_date": as_of_date or periodo["last_date"],
        "units": "decimal", "base_currency": req.base_currency,
        "methodology": methodology,
        "coverage": {"requested_assets": len(req.asset_ids), "included_assets": len(asset_ids),
                     "common_observations": periodo["observations"],
                     "first_date": periodo["first_date"], "last_date": periodo["last_date"]},
        "current_portfolio": current_point,
        "risk_contributions": contribution_rows,
        "risk_contributions_meta": contribution_meta,
        "min_volatility_portfolio": eng.get("min_volatility_portfolio"),
        "max_sharpe_portfolio": eng.get("max_sharpe_portfolio"),
        # Cada objetivo, en su campo: con los dos llenos, la pantalla enseñaria dos veces la misma cartera con dos nombres.
        "target_portfolio": (None if req.objective == "TARGET_RETURN" else eng.get("target_portfolio")),
        "target_return_portfolio": (eng.get("target_portfolio") if req.objective == "TARGET_RETURN" else None),
        "frontier": eng.get("frontier", []),
        "diagnostics": diagnostics,
        "excluded_assets": excluded,
        "warnings": all_warnings,
    }
