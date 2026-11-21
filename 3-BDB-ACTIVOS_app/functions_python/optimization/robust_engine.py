# -*- coding: utf-8 -*-
"""
Robust Frontier Engine v2 (modulo PURO; sin Firebase ni I/O).

Estimadores robustos + solver convexo para la frontera historica real:
  - Retornos: media aritmetica anualizada con shrinkage James-Stein hacia la media
    global (HISTORICAL_SHRINKAGE, default). Modos alternativos RISK_ONLY / EQUAL_RETURN
    (mu igualada -> optimizacion casi solo por riesgo).
  - Covarianza: Ledoit-Wolf por defecto; OAS segun regla T/N.
  - Solver: CLA (curva con caja) con fallback a EfficientFrontier (QP) para puntos y
    casos degenerados.
  - Objetivo TARGET_RISK: mayor retorno esperado sin superar el target de volatilidad
    (mapeado desde el slider 1-10), con clipping + warnings.
  - Objetivo TARGET_RETURN: la de menor riesgo que llega a esa MEDIA DE LA SERIE, la de sin encoger.
    El encogimiento es afin y con la suma al 100 % no mueve la curva, asi que la cartera sigue sobre
    ella: solo cambia que punto le toca a la cifra escrita (decision 94). Lo que se escribe no es la
    rentabilidad del modelo, ni lo que luego mide la serie: la respuesta trae las tres (repository).
  - Diagnosticos: condition_number, min_eigenvalue, T/N, shrinkage, effective number of
    bets, HHI, concentracion.

Devuelve puntos con la forma del contrato portfolio-frontier.v1, para que el orquestador lo
ensamble sin cambios.
"""
from __future__ import annotations
import math
from typing import Dict, List, Optional
from quietlog import swallowed, swallowed_quiet

ANNUALIZATION_FACTOR = 52

# Slider de riesgo 1-10 -> objetivo de volatilidad anualizada. Tabla CONFIGURABLE
# (no debe estar hardcodeada en el solver; se pasa/parametriza desde arriba).
RISK_SLIDER_TO_VOL = {1: 0.020, 2: 0.040, 3: 0.060, 4: 0.080, 5: 0.100,
                      6: 0.125, 7: 0.150, 8: 0.180, 9: 0.220, 10: 0.280}
RETURN_MODES = ("HISTORICAL_SHRINKAGE", "RISK_ONLY", "EQUAL_RETURN")
# Cap del shrinkage de retornos: James-Stein puro puede colapsar mu a la media (delta=1)
# y dejar la frontera en un punto. Capamos para conservar una curva riesgo-retorno util.
MAX_RETURN_SHRINKAGE = 0.5
# 05-11-2026 (decision 40): `CLA._solve` es un `while True`, y con datos reales puede entrar en ciclo y no salir. Medido con
# la matriz de la simulacion y 240 carteras al azar de la base nueva, de 8 a 40 instrumentos: 6 no terminaban, y la simulacion
# entera se quedaba colgada hasta el limite de la Function. Las que terminan piden como mucho 79 llamadas por activo.
# Es un tope de llamadas y no de tiempo: la misma entrada sigue el mismo camino en cualquier maquina, y por eso Optimizar y
# Simular no se pueden separar. Quien lo pasa va a la frontera por QP, como cualquier otro fallo del CLA.
CLA_LLAMADAS_POR_ACTIVO = 300


class WeightConstraintError(ValueError):
    """The requested portfolio cannot satisfy its weight constraints."""


def slider_to_target_vol(slider, table: Optional[dict] = None) -> float:
    table = table or RISK_SLIDER_TO_VOL
    try:
        s = int(round(float(slider)))
    except (TypeError, ValueError):
        s = 5
    s = max(1, min(10, s))
    return float(table[s])


def _en_pct(value: float) -> str:
    return f"{value * 100:.1f}".replace(".", ",") + " %"


def dynamic_bounds(n: int, user_min=None, user_max=None):
    """min 0 por defecto; max escalado por nº de activos. Respeta overrides del usuario."""
    if n <= 4:
        mx = 0.60
    elif n <= 10:
        mx = 0.35
    elif n <= 15:
        mx = 0.25
    else:
        mx = 0.20
    mn = 0.0
    if user_min is not None:
        mn = float(user_min)
    if user_max is not None:
        mx = float(user_max)
    if not (math.isfinite(mn) and math.isfinite(mx) and 0 <= mn <= mx <= 1):
        raise WeightConstraintError("Invalid min_weight/max_weight constraints.")
    if n < 1 or mn * n > 1.0 + 1e-9 or mx * n < 1.0 - 1e-9:
        raise WeightConstraintError(
            f"Sin solución: {n} activos, con un mínimo del {_en_pct(mn)} y un máximo del {_en_pct(mx)} por activo, no pueden sumar el 100 %.")
    return mn, mx


def _en_pct_2(value: float) -> str:
    return f"{value * 100:.2f}".replace(".", ",").replace("-", "\u2212") + " %"


def _sin_solucion_por_rentabilidad(objetivo, maximo, mx, con_candados, con_rotacion, con_grupos) -> str:
    """Hasta donde se llega, redondeado hacia abajo: quien escriba esa cifra tiene cartera. Es la media de la serie, la
    misma medida que se pide, y no la rentabilidad del modelo: por eso se dice de cual es."""
    limites = [f"un tope del {_en_pct(mx)} por posición"]
    if con_candados:
        limites.append("los candados")
    if con_rotacion:
        limites.append("la rotación máxima")
    if con_grupos:
        limites.append("los límites por grupo")
    escritos = limites[0] if len(limites) == 1 else ", ".join(limites[:-1]) + " y " + limites[-1]
    if len(limites) > 1:
        consejo = "Baja el objetivo o suelta alguno de esos límites."
    else:
        # Un 99 % ya no es un tope que se pueda subir.
        consejo = "Baja el objetivo o sube el máximo por activo." if mx < 0.99 else "Baja el objetivo."
    return (f"Sin solución: con {escritos}, la media de la serie llega como mucho a un {_en_pct_2(math.floor(maximo * 10000) / 10000)}, "
            f"y has pedido un {_en_pct_2(objetivo)}. {consejo}")


def _sin_solucion_con_candados(lower, upper, fijado, n_libres, mx) -> str:
    """Lo que hay que decir si los candados no dejan repartir el resto: con sus cifras, para que se pueda corregir."""
    if float(lower.sum()) > 1 + 1e-9:
        return f"Sin solución: los candados y los mínimos suman {_en_pct(float(lower.sum()))}, más del 100 %."
    if n_libres == 0:
        return f"Sin solución: todas las posiciones tienen candado y suman {_en_pct(fijado)}, no el 100 %."
    posiciones = "1 posición libre" if n_libres == 1 else f"{n_libres} posiciones libres"
    return (f"Sin solución: los candados suman {_en_pct(fijado)} y {posiciones}, con su tope del {_en_pct(mx)}, "
            f"solo llega{'' if n_libres == 1 else 'n'} al {_en_pct(float(upper.sum()))} de la cartera. "
            "Suelta un candado o cambia el máximo por activo.")


_DIMENSION_EN_PALABRAS = {
    "asset_class": "clase de activo",
    "currency": "divisa",
    "region": "región",
    "subtype": "subtipo",
    "vehicle": "producto",
}


# Las clases de la base nueva, con las palabras de la decision 13. La base vieja ya escribe RV, RF o Mixto, y una divisa o una region
# se dicen como vienen.
_ETIQUETA_EN_PALABRAS = {
    "UNKNOWN": "sin clasificar",
    "EQUITY": "Renta variable",
    "FIXED_INCOME": "Renta fija",
    "ALLOCATION": "Mixto",
    "HYBRID": "Mixto",
    "CAPITAL_PRESERVATION": "Monetario",
    "ALTERNATIVE": "Alternativo",
    "REAL_ASSETS": "Materias primas",
    "OTHER": "Otros",
}


def _etiqueta_de_grupo(etiqueta) -> str:
    return _ETIQUETA_EN_PALABRAS.get(etiqueta, str(etiqueta))


def _sin_solucion_por_grupos(gcs, asset_ids, lower, upper) -> str:
    """Lo que hay que decir si los limites por grupo no caben: con sus cifras, como los demas «Sin solucion».

    Se mira primero cada dimension por su cuenta, que es donde se puede decir que grupo falla y por cuanto, y con los
    topes y candados de cada posicion ya aplicados (`lower`, `upper`). Si cada una cabe sola y el resolutor no encuentra
    cartera, lo que se puede afirmar es eso, sin decir cual de ellas sobra.
    """
    for gc in gcs:
        dimension = _DIMENSION_EN_PALABRAS.get(gc["dimension"], gc["dimension"])
        minimos, maximos = gc.get("lower") or {}, gc.get("upper") or {}
        suelos, techos = {}, {}
        for i, aid in enumerate(asset_ids):
            etiqueta = gc["mapper"].get(aid, "UNKNOWN")
            suelos[etiqueta] = suelos.get(etiqueta, 0.0) + float(lower[i])
            techos[etiqueta] = techos.get(etiqueta, 0.0) + float(upper[i])
        for etiqueta in sorted(set(minimos) | set(maximos), key=str):
            minimo, maximo = minimos.get(etiqueta), maximos.get(etiqueta)
            grupo = f"{_etiqueta_de_grupo(etiqueta)} ({dimension})"
            if minimo is not None and maximo is not None and minimo > maximo + 1e-9:
                return f"Sin solución: {grupo} pide un mínimo del {_en_pct(minimo)} y un máximo del {_en_pct(maximo)}."
            if maximo is not None and suelos.get(etiqueta, 0.0) > maximo + 1e-9:
                return (f"Sin solución: en {grupo}, los candados y los mínimos suman {_en_pct(suelos[etiqueta])}, "
                        f"más que su máximo del {_en_pct(maximo)}. Suelta un candado o sube ese máximo.")
            if minimo is not None and techos.get(etiqueta, 0.0) < minimo - 1e-9:
                return (f"Sin solución: {grupo} pide un mínimo del {_en_pct(minimo)}, y sus posiciones, con su tope, "
                        f"solo llegan al {_en_pct(techos.get(etiqueta, 0.0))}.")
        alcanzable = sum(min(techo, maximos.get(etiqueta, 1.0)) for etiqueta, techo in techos.items())
        if alcanzable < 1 - 1e-9:
            topes = ", ".join(f"{_etiqueta_de_grupo(e)} {_en_pct(v)}" for e, v in sorted(maximos.items(), key=lambda par: str(par[0])))
            return (f"Sin solución: con los máximos por {dimension} ({topes}) y el tope de cada posición, "
                    f"la cartera solo llega al {_en_pct(alcanzable)}. Sube alguno de esos máximos.")
        obligado = sum(max(suelo, minimos.get(etiqueta, 0.0)) for etiqueta, suelo in suelos.items())
        if obligado > 1 + 1e-9:
            return f"Sin solución: los mínimos por {dimension}, con los candados, suman {_en_pct(obligado)}, más del 100 %."
    limites = "; ".join(
        f"{_DIMENSION_EN_PALABRAS.get(gc['dimension'], gc['dimension'])}: " + ", ".join(
            [f"{_etiqueta_de_grupo(e)} mínimo {_en_pct(v)}" for e, v in sorted((gc.get("lower") or {}).items(), key=lambda par: str(par[0]))]
            + [f"{_etiqueta_de_grupo(e)} máximo {_en_pct(v)}" for e, v in sorted((gc.get("upper") or {}).items(), key=lambda par: str(par[0]))]
        )
        for gc in gcs
    )
    return f"Sin solución: ninguna cartera cumple a la vez estos límites por grupo ({limites}), los topes y los candados. Quita o suaviza alguno."


def _np():
    import numpy as np
    return np


def _cla_con_tope(mu, S, bounds):
    """El CLA de siempre, que abandona si no termina (ver CLA_LLAMADAS_POR_ACTIVO). `_compute_lambda` es privado en
    PyPortfolioOpt 1.6.0, fijado en requirements.txt, y `_solve` lo llama una vez por activo en cada punto de giro."""
    from pypfopt.cla import CLA
    tope = CLA_LLAMADAS_POR_ACTIVO * len(mu)

    class ClaConTope(CLA):
        llamadas = 0

        def _compute_lambda(self, *args, **kwargs):
            self.llamadas += 1
            if self.llamadas > tope:
                raise RuntimeError(f"El CLA no ha terminado en {tope} llamadas.")
            return super()._compute_lambda(*args, **kwargs)

    return ClaConTope(mu, S, weight_bounds=bounds)


def estimate_returns(matrix, mode: str = "HISTORICAL_SHRINKAGE", factor: int = ANNUALIZATION_FACTOR):
    np = _np()
    R = np.asarray(matrix, dtype=float)          # (T, N) retornos semanales
    T, N = R.shape
    raw = R.mean(axis=0) * factor                # media aritmetica anualizada
    grand = float(raw.mean())
    if mode in ("RISK_ONLY", "EQUAL_RETURN"):
        return np.full(N, grand), {"return_estimator": mode, "return_shrinkage_intensity": 1.0}
    # James-Stein hacia la media global
    var_week = R.var(axis=0, ddof=1)
    var_mean = var_week / max(1, T) * (factor ** 2)   # var del estimador de la media anualizada
    disp = float(((raw - grand) ** 2).sum())
    delta = 0.0
    if disp > 1e-18 and N > 3:
        delta = (N - 3) * float(var_mean.mean()) / disp
        delta = max(0.0, min(MAX_RETURN_SHRINKAGE, delta))
    mu = (1.0 - delta) * raw + delta * grand
    return mu, {"return_estimator": "JAMES_STEIN_GLOBAL", "return_shrinkage_intensity": round(delta, 4)}


def _cond(S):
    np = _np()
    ev = np.linalg.eigvalsh(np.asarray(S, dtype=float))
    mineig = float(ev.min())
    pos = ev[ev > 0]
    cnum = float(pos.max() / pos.min()) if len(pos) else float("inf")
    return cnum, mineig


def estimate_covariance(matrix, asset_ids, factor: int = ANNUALIZATION_FACTOR):
    np = _np()
    import pandas as pd
    from pypfopt import risk_models
    R = pd.DataFrame(np.asarray(matrix, dtype=float), columns=list(asset_ids))
    T, N = R.shape
    tn = T / max(1, N)
    cs = risk_models.CovarianceShrinkage(R, returns_data=True, frequency=factor)
    S_lw = cs.ledoit_wolf()
    d_lw = float(getattr(cs, "delta", float("nan")))
    est, S, delta, warn = "LEDOIT_WOLF", S_lw, d_lw, None
    if tn < 8:
        cs2 = risk_models.CovarianceShrinkage(R, returns_data=True, frequency=factor)
        S_oas = cs2.oracle_approximating()
        d_oas = float(getattr(cs2, "delta", float("nan")))
        c_lw, _ = _cond(S_lw)
        c_oas, _ = _cond(S_oas)
        if tn < 4:
            est, S, delta, warn = "OAS", S_oas, d_oas, "LOW_TN_OAS"
        elif c_oas < c_lw:
            est, S, delta = "OAS", S_oas, d_oas
    cnum, mineig = _cond(S)
    meta = {"covariance_estimator": est, "cov_shrinkage_intensity": round(delta, 4) if delta == delta else None,
            "T": int(T), "N": int(N), "T_over_N": round(tn, 2),
            "condition_number": round(cnum, 1), "min_eigenvalue": round(mineig, 8), "cov_warning": warn}
    return S, meta


def _make_point(asset_ids, w, mu, S, rf):
    np = _np()
    w = np.asarray(w, dtype=float).reshape(-1)
    mu_v = np.asarray(mu, dtype=float)
    S_v = np.asarray(S, dtype=float)
    er = float(w @ mu_v)
    var = float(w @ S_v @ w)
    vol = math.sqrt(max(0.0, var))
    # Con volatilidad cero el Sharpe no existe: vacio, nunca 0 (hallazgo 11, 15-11-2026).
    sh = (er - rf) / vol if vol > 0 else None
    weights = {aid: (0.0 if abs(x) < 1e-12 else float(x)) for aid, x in zip(asset_ids, w)}
    return {"expected_return": er, "volatility": vol, "sharpe_ratio": sh, "weights": weights}


def concentration(weights: Dict[str, float]):
    np = _np()
    w = np.asarray(list(weights.values()), dtype=float)
    hhi = float((w ** 2).sum())
    enb = (1.0 / hhi) if hhi > 0 else 0.0
    top = sorted(w, reverse=True)
    return {"effective_number_of_assets": round(enb, 2), "concentration_hhi": round(hhi, 4),
            "max_weight": round(float(w.max()) if len(w) else 0.0, 4),
            "top_3_weight": round(float(sum(top[:3])), 4)}


def _hhi(weights):
    return float(sum(w * w for w in weights.values()))


def _select_percentile_point(frontier, percentile, signal_weak):
    """Elige el punto no dominado cuya volatilidad esta mas cerca del percentil del rango factible."""
    vol_min = frontier[0]["volatility"]
    vol_max = frontier[-1]["volatility"]
    target_vol = vol_min + percentile * (vol_max - vol_min)
    best = min(frontier, key=lambda p: abs(p["volatility"] - target_vol))
    near = [p for p in frontier if abs(p["volatility"] - best["volatility"]) <= 0.002]
    if len(near) > 1:  # desempate: senal debil -> diversificar; si no -> mayor retorno
        if signal_weak:
            best = min(near, key=lambda p: (_hhi(p["weights"]), -p["expected_return"]))
        else:
            best = max(near, key=lambda p: (p["expected_return"], -_hhi(p["weights"])))
    return best, target_vol, vol_min, vol_max


def _normalize_group_constraints(group_constraints, asset_ids):
    """Normaliza constraints de grupo (resueltas por el caller) a estructura interna con mapper
    COMPLETO sobre asset_ids (pypfopt lo exige; sin etiqueta -> 'UNKNOWN'). Descarta dimensiones
    sin lower ni upper efectivos."""
    out = []
    for gc in (group_constraints or []):
        if not isinstance(gc, dict):
            continue
        lower = {str(k): float(v) for k, v in (gc.get("lower") or {}).items() if v is not None}
        upper = {str(k): float(v) for k, v in (gc.get("upper") or {}).items() if v is not None}
        if not lower and not upper:
            continue
        raw = gc.get("mapper") or {}
        mapper = {aid: str(raw.get(aid, "UNKNOWN")) for aid in asset_ids}
        out.append({"dimension": str(gc.get("dimension", "group")),
                    "mapper": mapper, "lower": lower, "upper": upper})
    return out


def _group_exposures(weights, gcs):
    """Suma de pesos por etiqueta para cada dimension de constraint (diagnostico/UI)."""
    exp = {}
    for gc in gcs:
        d = {}
        for aid, w in weights.items():
            lab = gc["mapper"].get(aid, "UNKNOWN")
            d[lab] = round(d.get(lab, 0.0) + float(w), 4)
        exp[gc["dimension"]] = d
    return exp


def solve(asset_ids, matrix, *, objective="TARGET_RISK", risk_target_mode="FRONTIER_PERCENTILE",
          risk_slider=5, target_return=None, target_volatility=None, current_weights=None,
          min_weight=None, max_weight=None, frontier_points=15, risk_free_rate=0.0193,
          return_mode="HISTORICAL_SHRINKAGE", group_constraints=None, locked_weights=None,
          max_turnover=None):
    """`max_turnover` (M2 de «Mejorar cartera», 13-10-2026): rotacion maxima respecto a
    `current_weights`, sum|w - w0| <= max_turnover (0..2; 0,30 = 15 % de la cartera cambia de
    sitio). Exige current_weights y fuerza el camino QP: CLA no admite la restriccion."""
    np = _np()
    import pandas as pd
    from pypfopt import EfficientFrontier
    asset_ids = list(asset_ids)
    n = len(asset_ids)
    mu_arr, ret_meta = estimate_returns(matrix, return_mode)
    S_df, cov_meta = estimate_covariance(matrix, asset_ids)
    mu = pd.Series(mu_arr, index=asset_ids)
    S = pd.DataFrame(np.asarray(S_df, dtype=float), index=asset_ids, columns=asset_ids)
    mn, mx = dynamic_bounds(n, min_weight, max_weight)
    # R-02 (auditoria 29-09-2026): el tope dinamico es un valor por defecto para los
    # activos libres; un candado es una decision explicita del usuario y solo choca con
    # un tope que el usuario tambien haya fijado (validate_request ya lo comprueba).
    lock_cap = mx if max_weight is not None else 1.0
    locked = dict(locked_weights or {})
    for aid, value in locked.items():
        if aid not in asset_ids or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise WeightConstraintError("Invalid locked weights.")
        if value < mn - 1e-9 or value > lock_cap + 1e-9:
            raise WeightConstraintError(
                f"Sin solución: el candado de {aid} ({_en_pct(value)}) no cabe entre el mínimo ({_en_pct(mn)}) y el máximo ({_en_pct(lock_cap)}) por activo.")
    bounds = [(locked[a], locked[a]) if a in locked else (mn, mx) for a in asset_ids]
    lower = np.array([b[0] for b in bounds])
    upper = np.array([b[1] for b in bounds])
    if lower.sum() > 1 + 1e-9 or upper.sum() < 1 - 1e-9:
        raise WeightConstraintError(_sin_solucion_con_candados(lower, upper, float(sum(locked.values())), n - len(locked), mx))

    def bounded_weights(values):
        # Preserve fixed weights exactly; repair only solver round-off inside the box.
        w = np.asarray(values, dtype=float).reshape(-1)
        if len(w) != n or not np.isfinite(w).all() or abs(w.sum() - 1) > 1e-5:
            raise RuntimeError("Optimizer returned invalid portfolio weights.")
        if (w < lower - 1e-5).any() or (w > upper + 1e-5).any():
            raise RuntimeError("Optimizer violated the requested weight bounds.")
        w = np.clip(w, lower, upper)
        residual = 1.0 - float(w.sum())
        for i in np.argsort(-(upper - lower)):
            delta = min(residual, upper[i] - w[i]) if residual >= 0 else max(residual, lower[i] - w[i])
            w[i] += delta
            residual -= delta
        if abs(residual) > 1e-9:
            raise RuntimeError("Optimizer could not preserve the portfolio total.")
        return w
    warnings = []

    turnover_vec = None
    turnover_cap = None
    if max_turnover is not None:
        if not isinstance(max_turnover, (int, float)) or not math.isfinite(max_turnover) or not 0.0 <= max_turnover <= 2.0:
            raise WeightConstraintError("Invalid max_turnover: expected a decimal between 0 and 2.")
        base = [max(0.0, float((current_weights or {}).get(a, 0.0))) for a in asset_ids]
        base_total = sum(base)
        if base_total <= 0:
            raise WeightConstraintError("max_turnover requires current_weights.")
        turnover_vec = np.asarray([b / base_total for b in base], dtype=float)
        turnover_cap = float(max_turnover)
        if (turnover_vec < lower - 1e-9).any() or (turnover_vec > upper + 1e-9).any():
            warnings.append("TURNOVER_BASE_OUTSIDE_BOUNDS")

    gcs = _normalize_group_constraints(group_constraints, asset_ids)
    apply_gc = bool(gcs)
    if apply_gc:
        try:
            _probe = EfficientFrontier(mu, S, weight_bounds=bounds)
            for gc in gcs:
                _probe.add_sector_constraints(gc["mapper"], gc.get("lower", {}), gc.get("upper", {}))
            _probe.min_volatility()
        except Exception as exc:
            raise WeightConstraintError(_sin_solucion_por_grupos(gcs, asset_ids, lower, upper)) from exc

    def ef(solver=None, medias=None):
        # `medias`: las de la serie, solo para buscar el punto de «Rentabilidad objetivo». Las cifras de cada punto salen siempre de `mu`.
        e = EfficientFrontier(mu if medias is None else medias, S, weight_bounds=bounds, solver=solver)
        for gc in gcs:
            e.add_sector_constraints(gc["mapper"], gc.get("lower", {}), gc.get("upper", {}))
        if turnover_vec is not None:
            import cvxpy as cp
            e.add_constraint(lambda w: cp.norm1(w - turnover_vec) <= turnover_cap)
        return e

    if turnover_vec is not None:
        try:
            ef().min_volatility()
        except Exception as exc:
            # La pantalla cuenta la rotacion como lo que cambia de sitio, la mitad de sum|w - w0|.
            raise WeightConstraintError(
                f"Sin solución: una rotación máxima del {_en_pct(turnover_cap / 2)} del patrimonio no alcanza para cumplir los topes y los candados.") from exc

    def point_of(e):
        return _make_point(asset_ids, bounded_weights(e.weights), mu, S, risk_free_rate)

    # Tercera pasada (17-10-2026): con un candado, OSQP puede salirse de las cotas en mas de
    # 1e-5, bounded_weights lanza RuntimeError y el cliente recibia INTERNAL (2 de 54
    # optimizaciones con un candado del 5-15 %, tambien en master). Mismo reintento con un
    # solver de punto interior (CLARABEL) que en _qp_frontier.
    min_vol = None
    for solver in (None, "CLARABEL"):
        try:
            e = ef(solver); e.min_volatility(); min_vol = point_of(e)
            break
        except Exception:
            if solver is not None:
                raise
            swallowed_quiet("robust_engine.py:min_volatility")
    # CRIT-02 (auditoria 16-10-2026): el antiguo fallback efficient_return(mu.max()*0.999) no
    # era alcanzable con topes < 1 (y con mu.max() < 0 quedaba por encima de mu.max()), asi
    # que siempre caia a la cartera de minima volatilidad. Ahora se decide sobre la frontera
    # ya construida (ver abajo): solo si su mejor punto tiene Sharpe positivo se toma como
    # Max. Sharpe; si no, ninguna cartera FACTIBLE (con topes, candados, grupos y rotacion)
    # bate al tipo sin riesgo, maximizar un Sharpe negativo premiaria el punto de mas
    # volatilidad y la referencia sigue siendo la minima volatilidad (lo que ya se ensenaba).
    # 05-11-2026 (decision 40): con un candado, OSQP tambien se sale aqui de las cotas, y perder el punto daba el aviso
    # de que ningun activo bate al tipo sin riesgo sin ser cierto. Mismo reintento que la minima volatilidad.
    # 16-11-2026 (auditoria, OPT-1): con rotacion maxima NO se llama a `max_sharpe`. Su cambio de variable (y = k·w)
    # reescribe toda desigualdad `expr(w) <= c` como `expr(y) <= c·k`, y eso solo vale si `expr` es homogenea: la de la
    # rotacion, `norm1(w - w0)`, no lo es y queda `norm1(w - w0/k) <= c`, otra restriccion. Con poco exceso de rentabilidad
    # salia infactible y se caia al mejor punto de la frontera, que si la cumple; con mas exceso se RESOLVIA, sin aviso,
    # una cartera que movia mas de lo pedido (tope del 45 %, movido el 72 %). Ahora va siempre por la frontera, que es lo
    # que la decision 61 daba por hecho.
    max_sharpe = None
    for solver in ((None, "CLARABEL") if turnover_vec is None else ()):
        try:
            e = ef(solver); e.max_sharpe(risk_free_rate=risk_free_rate); max_sharpe = point_of(e)
            break
        except Exception:
            if solver is None:
                swallowed_quiet("robust_engine.py:max_sharpe")
            else:
                swallowed("robust_engine.py:max_sharpe")

    def _max_return_factible():
        # _max_return es privado en PyPortfolioOpt 1.6.0 (fijado en requirements.txt);
        # es el mismo LP que efficient_return usa para validar el objetivo.
        return float(ef()._max_return())

    def _feasible_return_range():
        """Rango de retornos alcanzables con TODAS las restricciones activas (cotas, candados,
        grupos y rotacion): desde el de la cartera de minima volatilidad (por debajo,
        efficient_return devuelve esa misma cartera) hasta el maximo factible."""
        lo = float(min_vol["expected_return"])
        try:
            hi = _max_return_factible()
        except Exception:
            swallowed("robust_engine.py:_feasible_return_range")
            return lo, lo
        return lo, hi

    def _qp_frontier():
        lo, hi = _feasible_return_range()
        # Margen para que el ultimo objetivo no caiga por encima del maximo por redondeo.
        hi -= 1e-9 + 1e-6 * abs(hi)
        pts_qp = []
        if hi > lo + 1e-9:
            for tr in np.linspace(lo, hi, max(6, frontier_points)):
                # El solver por defecto (OSQP) puede salirse de las cotas en ~1e-5 cerca de
                # un candado o del maximo, y bounded_weights lo rechaza: se reintenta con un
                # solver de punto interior (CLARABEL) antes de perder el punto.
                for solver in (None, "CLARABEL"):
                    try:
                        e = ef(solver); e.efficient_return(float(tr)); pts_qp.append(point_of(e))
                        break
                    except Exception:
                        swallowed_quiet("robust_engine.py:_qp_frontier")
        return pts_qp

    optimizer = "CLA"
    frontier = []
    if apply_gc or locked or turnover_vec is not None:
        optimizer = "QP"
        frontier = _qp_frontier() or [dict(min_vol)]
    else:
        try:
            cla = _cla_con_tope(mu, S, bounds)
            rets, vols, ws = cla.efficient_frontier(points=max(10, frontier_points))
            pts = []
            for r, v, w in zip(rets, vols, ws):
                v = float(v)
                if v <= 0 or math.isnan(v):
                    continue
                pts.append(_make_point(asset_ids, bounded_weights(w), mu, S, risk_free_rate))
            if len(pts) < 3:
                raise ValueError("CLA degenerada")
            frontier = pts
        except Exception:
            swallowed("robust_engine.py:283")
            optimizer = "QP"
            frontier = _qp_frontier() or [dict(min_vol)]

    # dedup + envolvente superior no dominada, ordenada por volatilidad ascendente.
    # CRIT-02: los puntos que coinciden con el anterior (mismo riesgo y retorno salvo el
    # redondeo del solver) se descartan; antes pasaban todos y la frontera repetia la
    # cartera de minima volatilidad.
    frontier = sorted(frontier, key=lambda p: (p["volatility"], p["expected_return"]))
    eff, best_r = [], -1e18
    for p in frontier:
        if eff and abs(p["volatility"] - eff[-1]["volatility"]) <= 1e-7 \
                and abs(p["expected_return"] - eff[-1]["expected_return"]) <= 1e-7:
            continue
        if p["expected_return"] >= best_r - 1e-12:
            eff.append(p); best_r = max(best_r, p["expected_return"])
    frontier = eff or [dict(min_vol)]
    if max_sharpe is None:
        # Segunda pasada (17-10-2026): la guarda sobre mu.max() no veia el caso en que algun
        # activo supera rf pero el retorno maximo factible no (tope dinamico o candado).
        # 05-11-2026 (decision 61): con rotacion maxima `max_sharpe` no se llama (ver arriba: su cambio de variable no
        # admite esa restriccion). Decir entonces que ningun activo bate al tipo sin riesgo era falso: solo se dice si es asi.
        best = max(frontier, key=lambda p: p["sharpe_ratio"] if p["sharpe_ratio"] is not None else -math.inf)
        if best["sharpe_ratio"] is not None and best["sharpe_ratio"] > 0:
            max_sharpe = dict(best); warnings.append("MAX_SHARPE_FROM_FRONTIER")
        else:
            max_sharpe = dict(min_vol); warnings.append("MAX_SHARPE_UNDEFINED_FALLBACK")

    vol_min = frontier[0]["volatility"]
    vol_max = frontier[-1]["volatility"]
    vol_range = vol_max - vol_min
    ers = [p["expected_return"] for p in frontier]
    return_spread = max(ers) - min(ers)
    signal_weak = return_spread < 0.0025
    if signal_weak:
        warnings.append("RETURN_SIGNAL_WEAK")
    if vol_range < 0.005 or (vol_min > 0 and vol_range / vol_min < 0.10):
        warnings.append("FRONTIER_RISK_RANGE_NARROW")

    target_point = None
    frontier_percentile = None
    target_vol_val = None
    if objective == "TARGET_RISK":
        if risk_target_mode == "ABSOLUTE_VOL":
            tv = float(target_volatility) if target_volatility is not None else slider_to_target_vol(risk_slider)
            target_vol_val = tv
            if tv < vol_min - 1e-9:
                target_point = dict(min_vol); warnings.append("TARGET_ABSOLUTE_VOL_CLIPPED_LOW")
            else:
                try:
                    e = ef(); e.efficient_risk(min(tv, vol_max)); target_point = point_of(e)
                    if tv > vol_max + 1e-9:
                        warnings.append("TARGET_ABSOLUTE_VOL_CLIPPED_HIGH")
                except Exception:
                    swallowed("robust_engine.py:320")
                    target_point = max(frontier, key=lambda p: p["expected_return"])
                    warnings.append("TARGET_ABSOLUTE_VOL_CLIPPED_HIGH")
        else:  # FRONTIER_PERCENTILE (default)
            sl = max(1, min(10, int(round(risk_slider or 5))))
            frontier_percentile = (sl - 1) / 9.0
            target_point, target_vol_val, _, _ = _select_percentile_point(frontier, frontier_percentile, signal_weak)
    elif objective == "TARGET_RETURN" and target_return is not None:
        objetivo = float(target_return)
        # 05-11-2026 (decision 94): lo que se escribe es la media de la serie, sin encoger. El encogimiento es (1-d)*media + d*comun: con la suma
        # de pesos al 100 %, la rentabilidad del modelo de una cartera es (1-d)*la suya en la serie + d*comun, asi que las dos ordenan igual las
        # carteras y la curva es la misma. Solo cambia que punto le corresponde a la cifra, y el punto se sigue contando con `mu`: es lo que dice
        # la tarjeta. Con el 8 % sobre el modelo, la muestra pedia en realidad un 4,9 % de la serie a 3 anos y un 9,8 % a 5.
        serie = pd.Series(np.asarray(matrix, dtype=float).mean(axis=0) * ANNUALIZATION_FACTOR, index=asset_ids)

        def en_la_serie(pesos):
            return float(sum(pesos[a] * serie[a] for a in asset_ids))

        objetivo_suelo = en_la_serie(min_vol["weights"])
        if objetivo <= objetivo_suelo:
            # 05-11-2026 (decision 61): la de menor riesgo ya llega. Cualquier otra con menos rentabilidad tendria mas riesgo
            # y sobra buscarla: es esa cartera, la misma que sale como minima volatilidad, y no la que deja el redondeo del solver.
            target_point = dict(min_vol)
        else:
            maximo = float(ef(medias=serie)._max_return())
            if objetivo > maximo:
                raise WeightConstraintError(_sin_solucion_por_rentabilidad(objetivo, maximo, mx, bool(locked), turnover_vec is not None, apply_gc))
            # Aqui hay solucion: que un solver falle no es que no la haya. Cerca del maximo OSQP se sale de las cotas
            # (medido en 1,7e-5 con carteras reales de 2 a 36 activos), bounded_weights lo rechaza y CLARABEL lo resuelve.
            # Lo mismo si da por buena una cartera que no llega: una milesima de punto es lo que se ve con dos decimales.
            for solver in (None, "CLARABEL"):
                try:
                    e = ef(solver, serie); e.efficient_return(objetivo); punto = point_of(e)
                    if en_la_serie(punto["weights"]) < objetivo - 1e-5:
                        raise RuntimeError(f"El solver no llega a {objetivo}: {en_la_serie(punto['weights'])}.")
                    target_point = punto
                    break
                except Exception:
                    if solver is not None:
                        raise
                    swallowed_quiet("robust_engine.py:efficient_return")

    current_point = None
    if current_weights:
        w = [max(0.0, float(current_weights.get(a, 0.0))) for a in asset_ids]
        tot = sum(w)
        if tot > 0:
            if abs(tot - 1.0) > 1e-6:
                warnings.append("CURRENT_WEIGHTS_NORMALIZED_TO_INCLUDED_ASSETS")
            current_point = _make_point(asset_ids, [x / tot for x in w], mu, S, risk_free_rate)

    diagnostics = dict(cov_meta)
    diagnostics.update(ret_meta)
    diagnostics.update({
        "frontier_min_volatility": round(vol_min, 6), "frontier_max_volatility": round(vol_max, 6),
        "frontier_volatility_range": round(vol_range, 6), "return_spread": round(return_spread, 6),
        "return_signal_status": ("WEAK" if signal_weak else "OK"),
    })
    if target_point:
        conc = concentration(target_point["weights"])
        diagnostics.update({
            "frontier_percentile_selected": (round(frontier_percentile, 4) if frontier_percentile is not None else None),
            "realized_volatility": round(target_point["volatility"], 6),
            "effective_number_of_positions": conc["effective_number_of_assets"],
            "hhi": conc["concentration_hhi"], "target_max_weight": conc["max_weight"],
            "target_top_3_weight": conc["top_3_weight"],
        })
        if gcs:
            diagnostics["group_exposures"] = _group_exposures(target_point["weights"], gcs)
        if turnover_vec is not None:
            realized = float(sum(abs(float(target_point["weights"].get(a, 0.0)) - float(b)) for a, b in zip(asset_ids, turnover_vec)))
            diagnostics["realized_turnover"] = round(realized, 6)
    methodology = {
        "optimizer": optimizer, "covariance_estimator": cov_meta["covariance_estimator"],
        "expected_return_model": ("HISTORICAL_SHRINKAGE" if return_mode == "HISTORICAL_SHRINKAGE" else return_mode),
        "return_estimator": ret_meta["return_estimator"], "return_units": "annualized_arithmetic_mean",
        "weight_bounds": [round(mn, 4), round(mx, 4)], "objective": objective,
        "target_risk_mode": risk_target_mode, "risk_slider_value": risk_slider,
        "frontier_min_volatility": round(vol_min, 6), "frontier_max_volatility": round(vol_max, 6),
    }
    if frontier_percentile is not None:
        methodology["frontier_percentile"] = round(frontier_percentile, 4)
    if target_vol_val is not None:
        methodology["target_volatility"] = round(target_vol_val, 6)
    if objective == "TARGET_RETURN" and target_return is not None:
        methodology["target_return"] = float(target_return)
        # Sobre que se pide, y la media de la serie de la cartera de menor riesgo: por debajo de esa cifra, la propuesta es esa cartera.
        methodology["target_return_basis"] = "SERIES_MEAN"
        methodology["target_return_floor"] = objetivo_suelo
    if target_point is not None:
        methodology["achieved_volatility"] = round(target_point["volatility"], 6)
    if turnover_cap is not None:
        methodology["max_turnover"] = round(turnover_cap, 6)
    if gcs:
        methodology["group_constraints_applied"] = [
            {"dimension": gc["dimension"], "lower": gc["lower"], "upper": gc["upper"]} for gc in gcs
        ]
    return {"frontier": frontier, "min_volatility_portfolio": min_vol, "max_sharpe_portfolio": max_sharpe,
            "target_portfolio": target_point, "current_portfolio": current_point,
            "methodology_extra": methodology, "diagnostics": diagnostics, "warnings": warnings,
            # Internal additive fields: repository reuses the exact shrunk covariance
            # used by this solve; they are not copied into the public payload directly.
            "covariance_matrix": S.to_numpy(dtype=float).tolist(),
            "covariance_asset_ids": list(asset_ids), "covariance_meta": dict(cov_meta)}
