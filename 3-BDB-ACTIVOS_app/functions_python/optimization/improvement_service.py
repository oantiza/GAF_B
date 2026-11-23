# -*- coding: utf-8 -*-
"""Servicio de «Mejorar cartera»: lee la maestra (solo lectura) y llama al motor puro.

Desde el 15-11-2026 (decision de Oscar) mide con el periodo de Simular: el mismo `_periodo_comun` de
`portfolio_horizon`, con la misma lectura y el mismo trato a las posiciones. Para una cartera y una ventana, la cartera
actual da en la ventana completa las mismas cuatro cifras y las mismas fechas que `analyze_horizon`.

- Las posiciones se leen como en Simular, tambien lo que ya no se puede comprar, porque describen lo que el cliente
  tiene. La que no cubre la ventana se aparta con su motivo o se completa con su referencia, exactamente como alli, y el
  calculo sigue con el resto. Una posicion apartada no se puede medir: no se le buscan sustitutos. Una completada con su
  referencia se mide, pero tampoco se le buscan (20-11-2026): la comparacion se apoyaria en el tramo estimado.
- Los candidatos pasan la puerta de Optimizar (se van a comprar) y tienen que cubrir la ventana con su propia serie, sin
  completarla con referencias: no se propone un cambio apoyado en una serie estimada. El que no la cubre queda como no
  evaluable, con su motivo, y no hace fallar el calculo.
- El motor mide en semanal sobre las semanas de ese periodo y la caida maxima en diario, como Simular. Cada tramo
  (seleccion, confirmacion, ventana completa) lleva el tipo libre medio de SUS fechas.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

from asset_aliases import alias_conflict_message, alias_conflicts, canonical_noting, with_alias_resolutions
from readmodel.mappers import get_currency, map_costs, map_economic_asset_class, map_region

from .improvement_engine import (
    ImprovementInput, ImprovementInputError, bounded_threshold, improve_portfolio as run_engine, insufficient_data_response, merge_thresholds, window_spans,
)
from .repository import (
    DEFAULT_RISK_FREE_RATE,
    InvalidOptimizationRequest,
    MIN_COMMON_OBSERVATIONS,
    OptimizationError,
    RiskFreeResolver,
    _resolve_risk_free_context,
)

# Lo que cabe en un calculo entre cartera y candidatos. Cada activo son unas pocas lecturas y unos 3 MB de serie en memoria
# (la misma cuenta que MAX_POSICIONES_SIMULACION, 85 en 1 GB). Si no cabe, se recortan los candidatos por posicion, a la par.
MAX_IMPROVEMENT_ASSETS = 80
MAX_CANDIDATES_PER_POSITION = 8
# Motivo de los candidatos de una posicion completada con su referencia: no se evaluan.
MOTIVO_POSICION_COMPLETADA = "POSITION_HISTORY_EXTENDED"
# Las ventanas de Simular: el periodo que se reutiliza solo existe para ellas.
VENTANAS = ("3Y", "5Y")
# La ventana mas corta que ofrece la pantalla: a quien le falta la de 5 anos se le puede aconsejar esta, si la cubre.
VENTANA_MAS_CORTA = "3Y"
MOTIVO_SIN_HISTORIA = "INSUFFICIENT_HISTORY"


def _ongoing_cost(root: dict) -> Optional[float]:
    """Lo que un activo aporta al coste corriente: una accion, cero; un fondo o un ETF sin dato, None.

    Decision 10 (04-11-2026), la misma regla que `assetRateForAverage` en el cuadro de costes: una accion no tiene gestora
    ni coste corriente, y tratarla como un dato que falta es esperar uno que no va a existir. El cero no quiere decir que no
    cueste nada: no incluye custodia ni corretaje, y quien lo ensena lo dice.
    """
    if str(root.get("asset_type") or "").upper() == "STOCK":
        return 0.0
    return (map_costs(root) or {}).get("ongoing_charge")


def _parse_positions(raw, aliases: Optional[Dict[str, str]] = None) -> Dict[str, float]:
    if not isinstance(raw, list) or not raw:
        raise InvalidOptimizationRequest("positions must contain at least one asset_id.")
    aliases = {} if aliases is None else aliases
    weights: Dict[str, float] = {}
    for item in raw:
        asset_id = (item or {}).get("asset_id") if isinstance(item, dict) else None
        if not isinstance(asset_id, str) or not asset_id.strip():
            continue
        raw_weight = item.get("weight")
        if isinstance(raw_weight, bool):
            raise InvalidOptimizationRequest("weight must be a number.")
        try:
            weight = float(raw_weight)
        except (TypeError, ValueError):
            weight = 0.0
        if not math.isfinite(weight):
            raise InvalidOptimizationRequest("weight must be a finite number.")
        if weight > 0:
            # 14-10-2026 (CRIT-02): un ISIN sustituido se evalua con el sucesor vigente.
            asset_id = canonical_noting(asset_id, aliases)
            weights[asset_id] = weights.get(asset_id, 0.0) + weight
    if not weights:
        raise InvalidOptimizationRequest("positions must contain at least one positive weight.")
    return weights


def _parse_candidates(raw, positions: Dict[str, float], aliases: Optional[Dict[str, str]] = None) -> Dict[str, List[str]]:
    if not isinstance(raw, dict):
        raise InvalidOptimizationRequest("candidates must map each position to a list of asset_ids.")
    aliases = {} if aliases is None else aliases
    out: Dict[str, List[str]] = {}
    for position, ids in raw.items():
        position = canonical_noting(position, aliases) if isinstance(position, str) else position
        if position not in positions or not isinstance(ids, list):
            continue
        clean = list(out.get(position, []))
        for asset_id in ids:
            if isinstance(asset_id, str) and asset_id.strip():
                asset_id = canonical_noting(asset_id, aliases)
                if asset_id not in clean and asset_id != position:
                    clean.append(asset_id)
            if len(clean) >= MAX_CANDIDATES_PER_POSITION:
                break
        if clean:
            out[position] = clean
    return out


def _recortar_candidatos(positions: Dict[str, float], candidates: Dict[str, List[str]], tope: int) -> Tuple[Dict[str, List[str]], dict]:
    """Cartera y candidatos dentro del tope: se evaluan los mismos candidatos por posicion para todas, los primeros de cada
    lista, que llegan de mas a menos afines. Antes se rechazaba la peticion entera, y una cartera de 14 posiciones con cinco
    candidatos cada una ya no cabia."""
    pedidos = max((len(ids) for ids in candidates.values()), default=0)

    def cuantos(k: int) -> int:
        activos = set(positions)
        for ids in candidates.values():
            activos.update(ids[:k])
        return len(activos)

    k = pedidos
    while k > 0 and cuantos(k) > tope:
        k -= 1
    recortados = {position: ids[:k] for position, ids in candidates.items() if ids[:k]}
    return recortados, {"requested": pedidos, "evaluated": k, "trimmed": k < pedidos, "max_assets": tope}


def _fecha(iso: str) -> str:
    return "%s/%s/%s" % (iso[8:10], iso[5:7], iso[0:4])


def _sin_historia(values: Dict[str, float], dates: List[str]) -> dict:
    """Por que un candidato no cubre la ventana con su propia serie, dicho con sus fechas."""
    first = min(values)
    if first > dates[0]:
        detail = ("Su serie empieza el %s y la ventana el %s: un candidato tiene que cubrirla entera con su propia serie, "
                  "sin completarla con referencias." % (_fecha(first), _fecha(dates[0])))
    else:
        detail = ("Le faltan precios en la ventana (más de 14 días seguidos sin dato) o al final, último el %s: un candidato "
                  "tiene que cubrirla entera con su propia serie." % _fecha(max(values)))
    return {"reason": MOTIVO_SIN_HISTORIA, "detail": detail, "series_first_date": first, "series_last_date": max(values)}


def _rebasados(periodo) -> Tuple[Dict[str, List[float]], List[str]]:
    """Los niveles del periodo, cada activo en base 100 en su primera fecha, y las fechas de sus semanas."""
    import numpy as np
    matrix = np.asarray(periodo.matrix, dtype=float)
    daily = {aid: (matrix[:, j] / matrix[0, j] * 100.0).tolist() for j, aid in enumerate(periodo.ids)}
    return daily, [periodo.dates[i] for i in periodo.week_indices]


def improve_portfolio(reader, request: dict, *, risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
                      risk_free_resolver: Optional[RiskFreeResolver] = None, today=None, reference_bundle=None) -> dict:
    from portfolio_horizon import _periodo_comun, leer_lo_comprable, periodo_de_la_cartera, serie_propia_en

    if not isinstance(request, dict):
        raise InvalidOptimizationRequest("Request must be an object.")
    aliases: Dict[str, str] = {}
    raw_positions = request.get("positions")
    named = []
    if isinstance(raw_positions, list):
        named = [item.get("asset_id") for item in raw_positions if isinstance(item, dict)]
    raw_candidates = request.get("candidates")
    if isinstance(raw_candidates, dict):
        for ids in raw_candidates.values():
            if isinstance(ids, list):
                named.extend(ids)
    conflicts = alias_conflicts(named)
    if conflicts:
        raise InvalidOptimizationRequest(alias_conflict_message(conflicts))
    positions = _parse_positions(request.get("positions"), aliases)
    candidates = _parse_candidates(request.get("candidates"), positions, aliases)
    window = request.get("window") or "3Y"
    if window not in VENTANAS:
        raise InvalidOptimizationRequest("Unsupported window: se mide con el periodo de Simular, a 3 o 5 años.")
    if len(positions) > MAX_IMPROVEMENT_ASSETS:
        raise InvalidOptimizationRequest(
            "Demasiados activos: la cartera tiene %d posiciones y el cálculo admite %d." % (len(positions), MAX_IMPROVEMENT_ASSETS))
    locked = {canonical_noting(x, aliases) for x in (request.get("locked") or []) if isinstance(x, str)}
    # P1-09 (20-11-2026): los umbrales del cliente, con sus cotas; fuera de rango es entrada invalida con el campo nombrado.
    try:
        thresholds = merge_thresholds(request.get("thresholds"))
        if request.get("max_substitutions") is not None:
            thresholds["max_substitutions"] = bounded_threshold("max_substitutions", request["max_substitutions"])
    except ImprovementInputError as exc:
        raise InvalidOptimizationRequest(str(exc)) from exc
    thresholds["min_observations"] = MIN_COMMON_OBSERVATIONS[window]
    total_weight = sum(positions.values())

    # --- la cartera, con el periodo de Simular
    periodo, excluded, roots, loaded, bundle = periodo_de_la_cartera(reader, positions, window, today=today, reference_bundle=reference_bundle)
    apartadas = _posiciones_apartadas(excluded, positions, total_weight, loaded, window, bundle, today, _periodo_comun)
    if periodo is None:
        # Ninguna posicion se puede medir: Simular falla; aqui es un resultado, que dice quien falta y por que.
        result = insufficient_data_response(sorted(positions), 0, MIN_COMMON_OBSERVATIONS[window] + 1)
        result.update({"window": window, "base_currency": "EUR", "excluded_assets": _compat(apartadas, []), "excluded_positions": apartadas})
        return with_alias_resolutions(result, aliases)
    medidas = {aid: positions[aid] for aid in periodo.ids}

    # --- los candidatos: solo de lo que se mide, dentro del tope, con historia propia
    candidates = {position: ids for position, ids in candidates.items() if position in medidas}
    # Una posicion completada con su referencia se mide como en Simular, pero no recibe sustitutos (pendiente del
    # 19-11-2026, lo que dejo abierto la A-153): la comparacion con un candidato se apoyaria en el tramo estimado, y a los
    # candidatos ya se les exige historia propia por eso mismo. Sus candidatos quedan como no evaluables, con su motivo.
    completadas = {item["asset_id"] for item in (periodo.extensions or [])}
    sin_busqueda = {position: ids for position, ids in candidates.items() if position in completadas}
    candidates = {position: ids for position, ids in candidates.items() if position not in completadas}
    candidates, por_posicion = _recortar_candidatos(positions, candidates, MAX_IMPROVEMENT_ASSETS)
    free_candidates = _misma_clase(request.get("same_fund_class"), candidates, aliases)
    candidate_ids = sorted({c for ids in candidates.values() for c in ids if c not in positions})
    cand_values, cand_excluded, cand_roots = leer_lo_comprable(reader, candidate_ids) if candidate_ids else ({}, [], {})
    unavailable = {item["asset_id"]: {"reason": item["reason"]} for item in cand_excluded}

    daily, weekly_dates = _rebasados(periodo)
    for asset_id in candidate_ids:
        if asset_id in unavailable:
            continue
        propia = serie_propia_en(cand_values[asset_id], periodo.dates)
        if propia is None:
            unavailable[asset_id] = _sin_historia(cand_values[asset_id], periodo.dates)
            continue
        daily[asset_id] = [value / propia[0] * 100.0 for value in propia]
    week_rows = periodo.week_indices
    levels = {asset_id: [serie[i] for i in week_rows] for asset_id, serie in daily.items()}

    # --- cada tramo, con el tipo libre de sus fechas
    spans = window_spans(weekly_dates, float(thresholds["selection_fraction"]))
    rf_by_window, rf_warnings = {}, []
    for key, (first, last) in spans.items():
        context, warns = _resolve_risk_free_context(first, last, risk_free_rate, risk_free_resolver)
        rf_by_window[key] = context
        rf_warnings.extend(w for w in warns if w not in rf_warnings)

    all_roots = {**(roots or {}), **(cand_roots or {})}
    costs, labels, names = {}, {}, {}
    for asset_id, root in all_roots.items():
        if not root:
            continue
        costs[asset_id] = _ongoing_cost(root)
        labels[asset_id] = {
            "asset_class": map_economic_asset_class(root),
            "region": map_region(root),
            "currency": get_currency(root),
        }
        names[asset_id] = str((root.get("identity") or {}).get("name") or asset_id)

    try:
        result = run_engine(ImprovementInput(
            dates=weekly_dates, levels=levels, original_weights=medidas, candidates=candidates, free_candidates=free_candidates,
            locked=locked, costs=costs, labels=labels, names=names, thresholds=thresholds,
            risk_free_rate=float(rf_by_window["full"]["risk_free_rate"]),
            risk_free_rates={key: float(context["risk_free_rate"]) for key, context in rf_by_window.items()},
            daily_dates=periodo.dates, daily_levels=daily, unavailable=unavailable,
        ))
    except ImprovementInputError as exc:
        raise InvalidOptimizationRequest(str(exc)) from exc

    cand_out = [{"asset_id": aid, "reason": unavailable[aid]["reason"]} for aid in sorted(unavailable)]
    if sin_busqueda:
        rechazados = dict(result.get("rejected_candidates") or {})
        for position, ids in sin_busqueda.items():
            rechazados[position] = list(rechazados.get(position, [])) + [
                {"asset_id": candidate, "reason": MOTIVO_POSICION_COMPLETADA, "not_evaluable": True,
                 "detail": "La posición se ha completado con su referencia antes de su inicio: no se le buscan sustitutos "
                           "apoyados en ese tramo estimado."}
                for candidate in dict.fromkeys(ids) if candidate != position and candidate not in positions]
        result["rejected_candidates"] = {position: items for position, items in rechazados.items() if items}
    result.update({
        "window": window,
        "base_currency": "EUR",
        "risk_free": rf_by_window["full"],
        "risk_free_by_window": rf_by_window,
        "excluded_positions": apartadas,
        "excluded_assets": _compat(apartadas, cand_out),
        "extensions": periodo.extensions,
        "coverage_weight_percent": 100.0 * sum(medidas.values()) / total_weight,
        "candidates_per_position": por_posicion,
        "reference_version": bundle["version"],
        "warnings": list(result.get("warnings", [])) + rf_warnings,
        "coverage": {
            "requested_assets": len(positions) + len(candidate_ids),
            "included_assets": len(levels),
            "common_observations": len(weekly_dates),
            "first_date": periodo.dates[0], "last_date": periodo.dates[-1],
            "measurement_frequency": "WEEKLY",
            # El periodo es el de Simular: termina en la ultima semana de mercado completa y retrocede los anos exactos.
            "period_rule": "SIMULATION_HORIZON",
        },
    })
    return with_alias_resolutions(result, aliases)


def _posiciones_apartadas(excluded, positions, total_weight, loaded, window, bundle, today, periodo_comun) -> List[dict]:
    """Las posiciones que Simular deja fuera, con su motivo y su peso en la cartera pedida. De la que no cubre la ventana de
    5 anos se dice ademas si la de 3 la mediria, con la misma regla: aconsejarla a quien tampoco llega seria falso."""
    sin_historia = {item["asset_id"] for item in excluded or [] if item["reason"] == MOTIVO_SIN_HISTORIA and item["asset_id"] in positions}
    medidas_a_3 = set()
    if sin_historia and window != VENTANA_MAS_CORTA and loaded:
        try:
            # Con todas las posiciones leidas, para que el fin del periodo sea el mismo que daria Simular a 3 anos.
            medidas_a_3 = set(periodo_comun(dict(loaded), [], VENTANA_MAS_CORTA, bundle, today).ids)
        except OptimizationError:
            pass
    salida = []
    for item in sorted(excluded or [], key=lambda e: e["asset_id"]):
        asset_id = item["asset_id"]
        if asset_id not in positions:
            continue
        out = {"asset_id": asset_id, "reason": item["reason"], "weight": positions[asset_id] / total_weight}
        if asset_id in sin_historia and asset_id in medidas_a_3:
            out["covers_window"] = VENTANA_MAS_CORTA
        salida.append(out)
    return salida


def _compat(apartadas: List[dict], candidatos: List[dict]) -> List[dict]:
    """`excluded_assets` como lo leia la pantalla de antes: posiciones y candidatos que no se han podido medir."""
    salida = [{k: v for k, v in item.items() if k != "weight"} for item in apartadas]
    return salida + candidatos


def _misma_clase(raw_free, candidates: Dict[str, List[str]], aliases: Dict[str, str]):
    """Decision 8.3: los candidatos que son otra clase del mismo fondo, solo entre los que se evaluan."""
    free = {}
    if not isinstance(raw_free, dict):
        return free
    for position, ids in raw_free.items():
        position = canonical_noting(position, aliases) if isinstance(position, str) else position
        allowed = set(candidates.get(position, []))
        chosen = {
            canonical_noting(x, aliases) for x in ids
            if isinstance(x, str) and canonical_noting(x, aliases) in allowed
        } if isinstance(ids, list) else set()
        if chosen:
            free[position] = free.get(position, set()) | chosen
    return free
