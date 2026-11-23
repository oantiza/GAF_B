# -*- coding: utf-8 -*-
"""Latest euro money-market and policy rates from the ECB Data Portal."""

import csv
import io
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from quietlog import swallowed


SCHEMA_VERSION = "ecb-rates.v1"
YIELD_CURVE_SCHEMA_VERSION = "ecb-yield-curve.v1"
ECB_API = "https://data-api.ecb.europa.eu/service/data"
RATE_SERIES = (
    {"id": "estr", "flow": "EST", "key": "B.EU000A2X2A25.WT"},
    {"id": "dfr", "flow": "FM", "key": "D.U2.EUR.4F.KR.DFR.LEV"},
    {"id": "mro", "flow": "FM", "key": "D.U2.EUR.4F.KR.MRR_FR.LEV"},
    {"id": "mlf", "flow": "FM", "key": "D.U2.EUR.4F.KR.MLFR.LEV"},
)
YIELD_CURVE_MATURITIES = (
    ("3M", 0.25), ("6M", 0.5), ("9M", 0.75), ("1Y", 1.0),
    ("2Y", 2.0), ("3Y", 3.0), ("4Y", 4.0), ("5Y", 5.0),
    ("6Y", 6.0), ("7Y", 7.0), ("8Y", 8.0), ("9Y", 9.0),
    ("10Y", 10.0), ("12Y", 12.0), ("15Y", 15.0), ("20Y", 20.0),
    ("25Y", 25.0), ("30Y", 30.0),
)
YIELD_CURVES = (
    {"id": "aaa", "instrument": "G_N_A", "label": "AAA"},
    {"id": "all_bonds", "instrument": "G_N_C", "label": "todos los bonos"},
)
_YIELD_MATURITY_YEARS = {"SR_%s" % code: years for code, years in YIELD_CURVE_MATURITIES}
_SDMX_JSON_ACCEPT = "application/vnd.sdmx.data+json;version=1.0.0-wd"
_HEADERS = {
    "Accept": "text/csv",
    "User-Agent": "BDB-ACTIVOS/1.0 (+https://bdb-gestor-de-activos.web.app)",
}
_ESTR_CACHE_TTL_SECONDS = 6 * 60 * 60
_estr_average_cache = {}
_ESTR_CACHE_MAX_ENTRIES = 64  # tope: ventanas de fechas arbitrarias no hacen crecer la memoria
_estr_cache_lock = threading.Lock()
# M-1 (quinta pasada, 17-10-2026): cache NEGATIVA. Tras un fallo de red o un 5xx del BCE,
# durante unos minutos no se reintenta y el llamador cae a su respaldo al momento en vez
# de pagar otra vez el tiempo de espera. Un 4xx o una ventana sin datos no la activan.
# I-6 (sexta pasada): es OPCIONAL y solo la pedia la cartera real (`negative_cache=True`
# desde main.real_portfolio_estr_resolver), que tenia de respaldo el €STR capitalizado de
# la base (decision B-70; antes, el ETF XEON). Esa ruta se borro el 17-11-2026 (decision
# A-188): hoy nadie la pide, y queda por si otra ruta con respaldo la necesita. La maestra, la
# simulacion y el alta no la leen ni la activan: para ellas un fallo transitorio es solo
# de esa ventana (la maestra la deja en NO_RATE) y la siguiente vuelve a preguntar, como
# en master. Global, un unico fallo dejaba sin rf toda la maestra durante 5 minutos.
_ESTR_NEGATIVE_TTL_SECONDS = 5 * 60
_estr_unavailable_until = [0.0]


class EstrUnavailable(RuntimeError):
    """El BCE fallo hace poco: no se reintenta hasta que pase la cache negativa."""


def _is_outage(exc: BaseException) -> bool:
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code >= 500
    return isinstance(exc, (urllib.error.URLError, TimeoutError, ConnectionError, OSError))

# Auditoría 11-08 (P9): caché en memoria de 6 h también para las respuestas
# "últimos datos" (tipos oficiales y curva de tipos). El BCE publica una vez al
# día, así que repetir las llamadas SDMX por cada usuario era puro desperdicio.
# Mismo patrón que _estr_average_cache, con cota de tamaño pequeña por si las
# claves dejaran de ser constantes en el futuro.
_SHARED_CACHE_TTL_SECONDS = 6 * 60 * 60
_SHARED_CACHE_MAX_ENTRIES = 8
_shared_cache = {}
_shared_cache_lock = threading.Lock()


def _shared_cache_get(key):
    now = time.monotonic()
    with _shared_cache_lock:
        cached = _shared_cache.get(key)
        if cached and now - cached[0] < _SHARED_CACHE_TTL_SECONDS:
            return dict(cached[1])
    return None


def _shared_cache_put(key, value):
    with _shared_cache_lock:
        if key not in _shared_cache:
            # Evicción simple por orden de inserción para acotar la memoria.
            while len(_shared_cache) >= _SHARED_CACHE_MAX_ENTRIES:
                _shared_cache.pop(next(iter(_shared_cache)))
        _shared_cache[key] = (time.monotonic(), dict(value))


def _series_url(series: dict) -> str:
    path = "%s/%s/%s" % (ECB_API, series["flow"], series["key"])
    query = urllib.parse.urlencode({
        "lastNObservations": 1,
        "detail": "dataonly",
        "format": "csvdata",
    })
    return "%s?%s" % (path, query)


def _http_text(url: str, timeout: int = 10, headers: dict | None = None) -> str:
    request_headers = dict(_HEADERS)
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, headers=request_headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8-sig", errors="replace")


def _parse_observations_csv(text: str) -> list[tuple[date, float]]:
    rows = csv.DictReader(io.StringIO(text))
    observations = {}
    for row in rows:
        raw_date = (row.get("TIME_PERIOD") or "").strip()
        raw_value = (row.get("OBS_VALUE") or "").strip()
        if not raw_date or not raw_value:
            continue
        try:
            observed_on = date.fromisoformat(raw_date)
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        if not -20.0 <= value <= 50.0:
            continue
        observations[observed_on] = value
    return sorted(observations.items(), key=lambda item: item[0])


def _parse_latest_csv(text: str) -> dict:
    observations = _parse_observations_csv(text)
    if not observations:
        raise ValueError("respuesta sin observaciones validas")
    observed_on, value = observations[-1]
    return {"date": observed_on.isoformat(), "value": round(value, 6)}


def _parse_iso_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError("%s invalida" % field) from exc


def _weighted_average_percent(observations: list[tuple[date, float]], start: date, end: date) -> dict:
    if end < start:
        raise ValueError("end_date anterior a start_date")
    observations = [(observed_on, value) for observed_on, value in observations if observed_on <= end]
    if not observations:
        raise ValueError("€STR sin observaciones en la ventana")

    before_or_on = [item for item in observations if item[0] <= start]
    if before_or_on:
        first_source_date, first_value = before_or_on[-1]
        events = [(start, first_value, first_source_date)]
        events.extend((observed_on, value, observed_on) for observed_on, value in observations if observed_on > start)
    else:
        first_source_date, first_value = observations[0]
        events = [(first_source_date, first_value, first_source_date)]
        events.extend((observed_on, value, observed_on) for observed_on, value in observations[1:])

    period_end = end + timedelta(days=1)
    weighted_sum = 0.0
    covered_days = 0
    for index, (segment_start, value, _source_date) in enumerate(events):
        next_start = events[index + 1][0] if index + 1 < len(events) else period_end
        segment_end = min(next_start, period_end)
        days = max(0, (segment_end - max(segment_start, start)).days)
        weighted_sum += value * days
        covered_days += days

    if covered_days <= 0:
        raise ValueError("€STR sin cobertura temporal util")
    total_days = (period_end - start).days
    source_dates = [source_date for _, _, source_date in events]
    return {
        "rate": round((weighted_sum / covered_days) / 100.0, 8),
        "source": "ECB_ESTR",
        "policy": "WINDOW_AVERAGE",
        "first_date": max(start, events[0][0]).isoformat(),
        "last_date": end.isoformat(),
        "first_observation_date": min(source_dates).isoformat(),
        "last_observation_date": max(source_dates).isoformat(),
        "observations": len(events),
        "coverage_ratio": round(covered_days / total_days, 6),
    }


def resolve_estr_window_average(start_date: str, end_date: str, timeout: int = 12,
                                negative_cache: bool = False) -> dict:
    """Resolve a calendar-day weighted €STR average for a historical window.

    `timeout`: segundos por operacion de socket (la cartera real pide 5; ver main.py).
    `negative_cache`: si True, respeta y activa la cache negativa (solo la cartera real;
    ver _ESTR_NEGATIVE_TTL_SECONDS)."""
    start = _parse_iso_date(start_date, "start_date")
    end = _parse_iso_date(end_date, "end_date")
    if end < start:
        raise ValueError("end_date anterior a start_date")
    cache_key = (start.isoformat(), end.isoformat())
    now = time.monotonic()
    with _estr_cache_lock:
        cached = _estr_average_cache.get(cache_key)
        if cached and now - cached[0] < _ESTR_CACHE_TTL_SECONDS:
            return dict(cached[1])
        if negative_cache and now < _estr_unavailable_until[0]:
            raise EstrUnavailable("BCE no disponible: fallo reciente, sin reintento durante unos minutos")

    series = RATE_SERIES[0]
    query_start = start - timedelta(days=14)
    query = urllib.parse.urlencode({
        "startPeriod": query_start.isoformat(),
        "endPeriod": end.isoformat(),
        "detail": "dataonly",
        "format": "csvdata",
    })
    url = "%s/%s/%s?%s" % (ECB_API, series["flow"], series["key"], query)
    try:
        text = _http_text(url, timeout=timeout)
    except Exception as exc:
        if negative_cache and _is_outage(exc):
            with _estr_cache_lock:
                _estr_unavailable_until[0] = time.monotonic() + _ESTR_NEGATIVE_TTL_SECONDS
        raise
    result = _weighted_average_percent(_parse_observations_csv(text), start, end)
    with _estr_cache_lock:
        # Purga: primero lo caducado y, si sigue lleno, lo mas antiguo (como _shared_cache).
        if cache_key not in _estr_average_cache:
            for key in [k for k, (t, _) in _estr_average_cache.items() if now - t >= _ESTR_CACHE_TTL_SECONDS]:
                _estr_average_cache.pop(key, None)
            while len(_estr_average_cache) >= _ESTR_CACHE_MAX_ENTRIES:
                _estr_average_cache.pop(next(iter(_estr_average_cache)))
        _estr_average_cache[cache_key] = (now, dict(result))
    return result


def clear_estr_cache() -> None:
    """Vacia las caches positiva y negativa (pruebas)."""
    with _estr_cache_lock:
        _estr_average_cache.clear()
        _estr_unavailable_until[0] = 0.0


def _fetch_rate(series: dict) -> dict:
    observation = _parse_latest_csv(_http_text(_series_url(series)))
    return {
        "id": series["id"],
        "date": observation["date"],
        "value": observation["value"],
    }


def _yield_curve_url(curve: dict) -> str:
    data_types = "+".join("SR_%s" % code for code, _years in YIELD_CURVE_MATURITIES)
    key = "B.U2.EUR.4F.%s.SV_C_YM.%s" % (curve["instrument"], data_types)
    query = urllib.parse.urlencode({"lastNObservations": 1, "detail": "dataonly"})
    return "%s/YC/%s?%s" % (ECB_API, key, query)


def parse_yield_curve_payload(payload: dict | str) -> dict:
    """Parsea SDMX-JSON y conserva solo observaciones de la fecha más reciente.

    Es una función pura: una serie ausente, sin valor o desfasada respecto a la
    fecha más reciente queda como hueco; nunca se interpola ni se rellena.
    """
    try:
        data = json.loads(payload) if isinstance(payload, str) else payload
        dataset = data["dataSets"][0]
        dimensions = data["structure"]["dimensions"]
        series_dimensions = dimensions["series"]
        observation_dimensions = dimensions["observation"]
        data_type_index = next(index for index, item in enumerate(series_dimensions) if item["id"] == "DATA_TYPE_FM")
        data_type_values = series_dimensions[data_type_index]["values"]
        time_dimension = next(item for item in observation_dimensions if item["id"] == "TIME_PERIOD")
        time_values = time_dimension["values"]
        raw_series = dataset.get("series") or {}
    except (KeyError, IndexError, StopIteration, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("respuesta YC SDMX-JSON invalida") from exc

    latest_by_maturity = {}
    for series_key, series in raw_series.items():
        try:
            indexes = [int(value) for value in str(series_key).split(":")]
            data_type = str(data_type_values[indexes[data_type_index]]["id"])
        except (IndexError, TypeError, ValueError, KeyError):
            continue
        if data_type not in _YIELD_MATURITY_YEARS:
            continue
        for observation_index, raw_observation in (series.get("observations") or {}).items():
            try:
                observed_on = date.fromisoformat(str(time_values[int(observation_index)]["id"]))
                value = float(raw_observation[0])
            except (IndexError, TypeError, ValueError, KeyError):
                continue
            if not -20.0 <= value <= 50.0:
                continue
            previous = latest_by_maturity.get(data_type)
            if previous is None or observed_on > previous[0]:
                latest_by_maturity[data_type] = (observed_on, value)

    if not latest_by_maturity:
        raise ValueError("respuesta YC sin observaciones validas")
    as_of = max(observed_on for observed_on, _value in latest_by_maturity.values())
    points = [
        {"maturity_years": years, "yield_pct": round(latest_by_maturity[data_type][1], 8)}
        for data_type, years in _YIELD_MATURITY_YEARS.items()
        if data_type in latest_by_maturity and latest_by_maturity[data_type][0] == as_of
    ]
    return {"as_of_date": as_of.isoformat(), "points": points}


def _fetch_yield_curve(curve: dict) -> dict:
    parsed = parse_yield_curve_payload(_http_text(
        _yield_curve_url(curve),
        timeout=12,
        headers={"Accept": _SDMX_JSON_ACCEPT},
    ))
    return {"id": curve["id"], **parsed}


def build_euro_yield_curve(curves_by_id: dict, errors: list[str] | None = None) -> dict:
    """Compone el contrato público sin inventar puntos ante fallos parciales."""
    available = [curve for curve in YIELD_CURVES if curve["id"] in curves_by_id]
    notes = list(errors or [])
    if not available:
        # Igual que get_ecb_rates: la respuesta vacia lleva sus notas, no un error interno.
        notes.append("No se pudo obtener ninguna curva de tipos del BCE")
        return {
            "schema_version": YIELD_CURVE_SCHEMA_VERSION,
            "as_of_date": None,
            "aaa": [],
            "all_bonds": [],
            "source": "ECB_DATA_PORTAL",
            "notes": " | ".join(notes),
        }
    dates = {curves_by_id[curve["id"]]["as_of_date"] for curve in available}
    as_of_date = max(dates)
    for curve in available:
        curve_result = curves_by_id[curve["id"]]
        if curve_result["as_of_date"] != as_of_date:
            notes.append("%s: omitida por fecha antigua %s" % (curve["label"], curve_result["as_of_date"]))
            continue
        count = len(curves_by_id[curve["id"]]["points"])
        if count < len(YIELD_CURVE_MATURITIES):
            notes.append("%s: %d/%d vencimientos disponibles" % (curve["label"], count, len(YIELD_CURVE_MATURITIES)))
    return {
        "schema_version": YIELD_CURVE_SCHEMA_VERSION,
        "as_of_date": as_of_date,
        "aaa": curves_by_id.get("aaa", {}).get("points", []) if curves_by_id.get("aaa", {}).get("as_of_date") == as_of_date else [],
        "all_bonds": curves_by_id.get("all_bonds", {}).get("points", []) if curves_by_id.get("all_bonds", {}).get("as_of_date") == as_of_date else [],
        "source": "ECB_DATA_PORTAL",
        "notes": " | ".join(notes),
    }


def get_euro_yield_curve(_request: dict | None = None) -> dict:
    """Return latest AAA and all-government-bond euro spot yield curves."""
    # Auditoría 11-08 (P9): caché de 6 h; solo se cachean respuestas sin fallos
    # de red para no fijar una curva incompleta durante horas.
    cached = _shared_cache_get("yield_curve")
    if cached is not None:
        return cached
    curves_by_id = {}
    errors = []
    with ThreadPoolExecutor(max_workers=len(YIELD_CURVES)) as executor:
        futures = {executor.submit(_fetch_yield_curve, curve): curve for curve in YIELD_CURVES}
        for future in as_completed(futures):
            curve = futures[future]
            try:
                curves_by_id[curve["id"]] = future.result()
            except Exception as exc:  # a partial ECB outage must not hide the other curve
                # A la pantalla, sin el texto de la excepcion (urls, trazas de la libreria): el detalle va al registro.
                swallowed("ecb_rates.get_euro_yield_curve:%s" % curve["id"])
                errors.append("%s: no disponible" % curve["label"])
    result = build_euro_yield_curve(curves_by_id, errors)
    if not errors:
        _shared_cache_put("yield_curve", result)
    return result


def get_ecb_rates(_request: dict | None = None) -> dict:
    """Return the latest available observation for every configured ECB series."""
    # Auditoría 11-08 (P9): caché de 6 h; una respuesta parcial (serie caída)
    # no se cachea para reintentar en la siguiente petición.
    cached = _shared_cache_get("rates")
    if cached is not None:
        return cached
    by_id = {}
    errors = []
    with ThreadPoolExecutor(max_workers=len(RATE_SERIES)) as executor:
        futures = {executor.submit(_fetch_rate, series): series for series in RATE_SERIES}
        for future in as_completed(futures):
            series = futures[future]
            try:
                by_id[series["id"]] = future.result()
            except Exception as exc:  # a partial ECB outage must not hide healthy series
                swallowed("ecb_rates.get_ecb_rates:%s" % series["id"])
                errors.append("%s: no disponible" % series["id"])

    rates = [by_id[series["id"]] for series in RATE_SERIES if series["id"] in by_id]
    result = {
        "schema_version": SCHEMA_VERSION,
        "rates": rates,
        "requested_count": len(RATE_SERIES),
        "live_count": len(rates),
        "source": "ECB_DATA_PORTAL",
        "retrieved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "notes": " | ".join(errors),
    }
    if not errors:
        _shared_cache_put("rates", result)
    return result
