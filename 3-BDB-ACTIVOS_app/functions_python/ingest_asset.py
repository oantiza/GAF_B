# -*- coding: utf-8 -*-
"""
Ingesta de un activo NUEVO en la maestra, pensada para dispararse desde el panel
Admin (callable admin_ingest_asset).

Fuentes:
  - IDENTIDAD + LISTING: EODHD /search (resuelve ISIN -> simbolo, nombre, exchange, divisa).
  - HISTORICO: EODHD /eod (reutiliza la maquinaria de price_refresh; normaliza a EUR).
  - FUNDAMENTALES: Finnhub (/stock/profile2 por ISIN + /stock/metric), solo para acciones.
    EODHD no incluye fundamentales en el plan actual (403). Si Finnhub falla o no hay key,
    el root se construye igual (identidad + listing) con fundamentals=None.

Alcance: ACCIONES (asset_type=STOCK) y productos cotizados EODHD simples
(asset_type=ETF/INDEX). Los ETF/indices se crean con una ficha fina; si se pide historico,
se alimentan igual desde EODHD.

Seguridad: dry-run por defecto; con write=True exige el gate (require_master_writes_enabled).
El root es create-only (no sobreescribe un activo ya existente). El historico es aditivo.

Prueba local desde functions_python/ (con ADC + EODHD_API_KEY + FINNHUB_API_KEY):
    python -c "import ingest_asset as i; print(i.ingest_one('US0378331005'))"
"""
import os
import re
import json
import math
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone, timedelta

import fund_ingest
import weekly_sampling

# Reutiliza la maquinaria EODHD/FX ya probada de price_refresh.
from price_refresh import (
    _eodhd_get, fetch_eod, _convert_eur, _fetch_fx, _group_by_year, _major_currency, _master_db,
    listing_currency,
    PRICE_SERIES_SCHEMA,
)
from write_governance import (
    log_master_write_decision, master_writes_enabled, require_master_writes_enabled,
)
from contract_validation import validate_contract
from search_index import upsert_search_index_entry
from quietlog import swallowed, swallowed_quiet
import logging

_metrics_logger = logging.getLogger("bdb.metrics")

STOCK_ROOT_SCHEMA = "master.asset-stock.v1"
MARKET_ROOT_SCHEMA = "master.asset-eodhd-market.v1"
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
STOCK_TYPES = {"common stock", "stock", "preferred stock", "share"}
ETF_TYPES = {"etf", "etn", "etc", "etp", "exchange traded fund"}
INDEX_TYPES = {"index", "indices"}
SUPPORTED_TYPE_CLASSES = {"STOCK", "ETF", "INDEX"}
HISTORY_START = "1990-01-01"  # carga completa; EODHD recorta a lo realmente disponible
FINNHUB_BASE_URL = "https://finnhub.io/api/v1"
# Sesiones minimas para el drawdown a 5 anios. A1 (auditoria 29-09): ya no gobierna
# las ventanas de metricas, que se miden en semanal y tienen su propio minimo en
# weekly_sampling (MIN_WEEKLY_RETURNS).
MIN_METRIC_POINTS = 20
METRIC_WINDOWS = {"1y": 1, "3y": 3, "5y": 5, "10y": 10}
# Dias naturales minimos para poder anualizar una rentabilidad: elevar un mes a
# un anio da cifras absurdas.
# Vive en fund_ingest para que las dos rutas de ingesta compartan el valor, junto
# con la cobertura minima de la ventana nominal (window_span_ok).
MIN_ANNUALIZATION_DAYS = fund_ingest.MIN_ANNUALIZATION_DAYS
window_span_ok = fund_ingest.window_span_ok
METRICS_SOURCE = "FONDOSDB_EODHD_DAILY_HISTORY"


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _today():
    return date.today().isoformat()


def _omit_nulls(value):
    """Omit keys whose value is None, recursively. Empty lists/dicts are kept."""
    if isinstance(value, dict):
        return {k: _omit_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_omit_nulls(v) for v in value]
    return value


# --------------------------------------------------------------------------- EODHD: identidad
def _classify_eodhd_type(type_str) -> str:
    low = str(type_str or "").strip().lower()
    if low in STOCK_TYPES:
        return "STOCK"
    if low in ETF_TYPES or any(token in low for token in ("etf", "etn", "etc", "etp")):
        return "ETF"
    if low in INDEX_TYPES or "index" in low:
        return "INDEX"
    return "OTHER"


def _row_isin(row: dict) -> str:
    return str(row.get("ISIN") or row.get("Isin") or row.get("isin") or "").strip().upper()


def _find_preferred_listing(rows: list, isin: str, preferred_symbol: str):
    code, separator, exchange = preferred_symbol.rpartition(".")
    if not separator or not code or not exchange:
        return None
    for raw in rows:
        if not isinstance(raw, dict) or _row_isin(raw) != isin.upper():
            continue
        row_code = str(raw.get("Code") or "").strip().upper()
        row_exchange = str(raw.get("Exchange") or exchange).strip().upper()
        if row_code == code and row_exchange == exchange:
            return {**raw, "Exchange": row_exchange}
    return None


def resolve_symbol(isin: str, preferred_symbol: str | None = None):
    """ISIN -> mejor match EODHD, con override explícito para un listing conocido."""
    try:
        results = _eodhd_get("search/%s" % urllib.parse.quote(isin))
    except Exception:
        swallowed("ingest_asset.py:110")
        results = []
    if not isinstance(results, list):
        results = []
    exact = [r for r in results if isinstance(r, dict) and _row_isin(r) == isin.upper()] or results
    preferred = str(preferred_symbol or "").strip().upper()
    if preferred:
        preferred_match = _find_preferred_listing(exact, isin, preferred)
        if preferred_match is None:
            _code, separator, exchange = preferred.rpartition(".")
            if separator:
                try:
                    delisted = _eodhd_get(
                        "exchange-symbol-list/%s" % urllib.parse.quote(exchange),
                        delisted=1,
                    )
                except Exception:
                    swallowed_quiet("ingest_asset.py:126")
                    delisted = []
                if isinstance(delisted, list):
                    preferred_match = _find_preferred_listing(delisted, isin, preferred)
        if preferred_match is None:
            return None
        pool = [preferred_match]
    else:
        if not exact:
            return None
        stocks = [r for r in exact if _classify_eodhd_type(r.get("Type")) == "STOCK"]
        supported = [r for r in exact if _classify_eodhd_type(r.get("Type")) in SUPPORTED_TYPE_CLASSES]
        pool = stocks or supported or exact
    # Prefiere el listing primario (EODHD marca isPrimary=true en el principal); si no, el primero.
    chosen = next((r for r in pool if r.get("isPrimary") is True), pool[0])
    code = str(chosen.get("Code") or "").strip()
    exch = str(chosen.get("Exchange") or "").strip()
    if not code or not exch:
        return None
    type_str = str(chosen.get("Type") or "").strip()
    return {
        "symbol": "%s.%s" % (code, exch),
        "ticker": code,
        "exchange": exch,
        "currency": chosen.get("Currency") or None,
        "type": type_str or None,
        "type_class": _classify_eodhd_type(type_str),
        "name": chosen.get("Name") or None,
    }


# --------------------------------------------------------------------------- Finnhub: fundamentales
def _finnhub_key():
    key = os.environ.get("FINNHUB_API_KEY")
    if not key:
        raise RuntimeError("FINNHUB_API_KEY no configurada (secreto de la funcion).")
    return key


def _finnhub_get(path: str, **params):
    params["token"] = _finnhub_key()
    url = "%s/%s?%s" % (FINNHUB_BASE_URL, path, urllib.parse.urlencode(params))
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_fundamentals_finnhub(isin: str) -> dict:
    """Fundamentales de una accion desde Finnhub (perfil por ISIN + metricas). {} si falla/no hay key/sin cobertura."""
    try:
        prof = _finnhub_get("stock/profile2", isin=isin) or {}
    except Exception:
        swallowed("ingest_asset.py:176")
        return {}
    if not isinstance(prof, dict) or not prof.get("ticker"):
        return {}
    metric = {}
    try:
        m = _finnhub_get("stock/metric", symbol=prof.get("ticker"), metric="all") or {}
        metric = (m or {}).get("metric") or {}
    except Exception:
        swallowed_quiet("ingest_asset.py:184")
        metric = {}
    return {
        "sector": prof.get("finnhubIndustry"),
        "industry": prof.get("finnhubIndustry"),
        "country": prof.get("country"),
        "market_cap": (prof.get("marketCapitalization") or 0) * 1_000_000 or None,  # millones -> unidades
        "pe_ratio": metric.get("peTTM") or metric.get("peAnnual"),
        "dividend_yield": metric.get("dividendYieldIndicatedAnnual"),
        "eps": metric.get("epsTTM"),
        "beta": metric.get("beta"),
        "finnhub_ticker": prof.get("ticker"),
        "currency": prof.get("currency"),
        "name": prof.get("name"),
        "source": "finnhub",
    }


# --------------------------------------------------------------------------- Yahoo: fundamentales (backup)
EODHD_TO_YAHOO_SUFFIX = {
    "US": "", "NYSE": "", "NASDAQ": "", "BATS": "", "NMFQS": "",
    "XETRA": ".DE", "F": ".F", "STU": ".SG", "MU": ".MU", "BE": ".BE", "HM": ".HM", "HA": ".HA", "DU": ".DU",
    "LSE": ".L", "IL": ".IL",
    "PA": ".PA", "AS": ".AS", "BR": ".BR", "LS": ".LS",
    "MC": ".MC", "MI": ".MI", "VI": ".VI", "SW": ".SW", "ST": ".ST", "OL": ".OL", "CO": ".CO", "HE": ".HE", "IR": ".IR",
    "TO": ".TO", "V": ".V", "HK": ".HK", "SHG": ".SS", "SHE": ".SZ", "TSE": ".T", "AU": ".AX",
}


def _yahoo_symbol(match: dict) -> str:
    ticker = match["ticker"]
    suffix = EODHD_TO_YAHOO_SUFFIX.get(match["exchange"])
    return ticker + suffix if suffix is not None else ticker


def fetch_fundamentals_yahoo(match: dict) -> dict:
    """Backup de fundamentales vía yfinance (Yahoo). {} si falla/sin datos. Requiere el paquete yfinance."""
    try:
        import yfinance as yf
        info = yf.Ticker(_yahoo_symbol(match)).info or {}
    except Exception:
        swallowed("ingest_asset.py:224")
        return {}
    if not info or not (info.get("sector") or info.get("marketCap")):
        return {}
    return {
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "country": info.get("country"),
        "market_cap": info.get("marketCap"),
        "pe_ratio": info.get("trailingPE"),
        "dividend_yield": info.get("dividendYield"),
        "eps": info.get("trailingEps"),
        "beta": info.get("beta"),
        "currency": info.get("currency"),
        "name": info.get("longName") or info.get("shortName"),
        "source": "yahoo",
    }


def fetch_fundamentals(isin: str, match: dict) -> dict:
    """Fundamentales con prioridad Finnhub (por ISIN) y respaldo Yahoo (por símbolo). {} si ninguna da."""
    fund = fetch_fundamentals_finnhub(isin)
    if fund:
        return fund
    return fetch_fundamentals_yahoo(match)


# --------------------------------------------------------------------------- root
def build_stock_root(isin: str, match: dict, fund: dict) -> dict:
    """Construye el root conforme a master/asset-stock.v1. `fund` = dict de fundamentales (Finnhub) o {}."""
    fund = fund or {}
    ticker = match["ticker"]
    exchange = match["exchange"]
    eodhd_code = "%s.%s" % (ticker, exchange)
    listing_id = "EODHD:%s" % eodhd_code
    currency = match.get("currency") or fund.get("currency")
    name = match.get("name") or fund.get("name") or isin
    now = _now()
    fundamentals = None
    if fund:
        fundamentals = {k: fund.get(k) for k in (
            "sector", "industry", "country", "market_cap",
            "pe_ratio", "dividend_yield", "eps", "beta", "source",
        )}
    return {
        "asset_id": isin,
        "asset_type": "STOCK",
        "schema_version": STOCK_ROOT_SCHEMA,
        "updated_at": now,
        "identity": {"name": name, "currency": currency},
        "identifiers": {
            "isin": isin, "ticker": ticker, "eodhd_code": eodhd_code,
            "aliases": [x for x in [isin, ticker, eodhd_code, listing_id] if x],
        },
        "classification": {
            "asset_class": "EQUITY", "fondosdb_asset_class": "EQUITY",
            "fondosdb_asset_type": "stock", "asset_subtype": "common_stock",
            "region_primary": fund.get("country") or None,
            "strategy_tags": [], "confidence": None,
        },
        "product": {"product_type": "stock", "commercial_type": "accion",
                    "vehicle_complexity": "standard", "has_listing": True},
        "listings": [{
            "listing_id": listing_id, "ticker": ticker, "exchange": exchange,
            "currency": currency, "eodhd_code": eodhd_code,
            "source_listing_id": listing_id, "is_primary": True,
            "data_sources": [x for x in ["eodhd", fund.get("source")] if x],
        }],
        "performance": None,
        "risk": None,
        "fundamentals": fundamentals,
        "portfolio_exposure": None,
        "quality": {
            "fondosdb_bucket": None, "fondosdb_ok": None,
            "status": "PROVISIONAL_ADMIN",
            "warnings": [] if fund else ["NO_FUNDAMENTALS"],
            "validation_errors": [], "review_flags": [],
            "history_trace": {"source_history": "eodhd", "source_listing_id": listing_id},
        },
        "source_metadata": {
            "source": "EODHD", "source_file": None, "generated_at": now,
            "report_date": None, "universal_export_present": False,
            "source_history": "eodhd", "source_listing_id": listing_id,
            "firestore_import_block": "eodhd_panel_ingest",
        },
    }


def build_market_root(isin: str, match: dict) -> dict:
    """Construye una ficha fina para ETF/INDEX cotizados resueltos por EODHD."""
    asset_type = match.get("type_class")
    if asset_type not in {"ETF", "INDEX"}:
        asset_type = "ETF"
    ticker = match["ticker"]
    exchange = match["exchange"]
    eodhd_code = "%s.%s" % (ticker, exchange)
    listing_id = "EODHD:%s" % eodhd_code
    currency = match.get("currency")
    name = match.get("name") or eodhd_code or isin
    now = _now()
    product_type = "ETF" if asset_type == "ETF" else "index"
    commercial_type = match.get("type") or asset_type
    return {
        "asset_id": isin,
        "asset_type": asset_type,
        "schema_version": MARKET_ROOT_SCHEMA,
        "updated_at": now,
        "identity": {"name": name, "currency": currency},
        "identifiers": {
            "isin": isin, "ticker": ticker, "eodhd_code": eodhd_code,
            "aliases": [x for x in [isin, ticker, eodhd_code, listing_id] if x],
        },
        "classification": {
            "asset_class": asset_type, "fondosdb_asset_class": asset_type,
            "fondosdb_asset_type": asset_type.lower(), "asset_subtype": commercial_type,
            "region_primary": None, "strategy_tags": [], "confidence": None,
        },
        "product": {"product_type": product_type, "commercial_type": commercial_type,
                    "vehicle_complexity": "standard", "has_listing": True},
        "listings": [{
            "listing_id": listing_id, "ticker": ticker, "exchange": exchange,
            "currency": currency, "eodhd_code": eodhd_code,
            "source_listing_id": listing_id, "is_primary": True,
            "data_sources": ["eodhd"],
        }],
        "costs": None,
        "performance": None,
        "risk": None,
        "portfolio_exposure": None,
        "holdings_summary": {"has_holdings": False, "full_holdings_loaded": False},
        "quality": {
            "fondosdb_bucket": None, "fondosdb_ok": None,
            "status": "PROVISIONAL_ADMIN",
            "warnings": ["NO_HOLDINGS", "NO_COSTS"],
            "validation_errors": [], "review_flags": [],
            "history_trace": {"source_history": "eodhd", "source_listing_id": listing_id},
        },
        "source_metadata": {
            "source": "EODHD", "source_file": None, "generated_at": now,
            "report_date": None, "universal_export_present": False,
            "source_history": "eodhd", "source_listing_id": listing_id,
            "firestore_import_block": "eodhd_panel_ingest",
        },
    }


# --------------------------------------------------------------------------- historico
def _load_doc_id(symbol, year):
    safe = symbol.replace(":", "_").replace("/", "_").replace(".", "_")
    return "EODHD_%s_%d" % (safe, year)


def _series_type_for(asset_type):
    t = str(asset_type or "").upper()
    if t == "INDEX":
        return "INDEX_LEVEL"
    if t == "FUND":
        return "NAV"
    return "ADJUSTED_CLOSE"


def _parse_iso_date(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except Exception:
        swallowed("ingest_asset.py:388")
        return None


def _valid_metric_points(points):
    valid = []
    for p in points or []:
        if not isinstance(p, dict):
            continue
        dt = _parse_iso_date(p.get("date"))
        try:
            value = float(p.get("value"))
        except Exception:
            swallowed_quiet("ingest_asset.py:400")
            value = None
        if dt is None or value is None or value <= 0:
            continue
        valid.append({"date": dt, "value": value})
    valid.sort(key=lambda p: p["date"])
    dedup = {}
    for point in valid:
        dedup[point["date"]] = point["value"]
    return [{"date": dt, "value": dedup[dt]} for dt in sorted(dedup)]


def _estr_window_resolver(start_iso: str, end_iso: str) -> dict:
    """Media €STR de la ventana, por la misma via que el optimizador
    (main.py inyecta este mismo resolutor en las callables de optimizacion).
    Import perezoso: mantiene barato el import del modulo y deja el resolutor
    sustituible en pruebas sin tocar la red."""
    from ecb_rates import resolve_estr_window_average
    return resolve_estr_window_average(start_iso, end_iso)


def _window_risk_free(points, resolver, *, window=None, warnings=None):
    """Media €STR de la ventana. Misma politica que el optimizador
    (_resolve_risk_free_context en optimization/repository.py): si no hay
    resolutor o la tasa no es creible, se cae a 0 en vez de inventar.

    Quinta pasada, I-2: si la €STR cubre menos del 95 % de la ventana (antes del
    01-10-2019) se conserva la media parcial, como la simulacion, y se anota
    RISK_FREE_RATE_PARTIAL_COVERAGE en `warnings` (lista del llamador)."""
    if resolver is None or not points:
        return 0.0
    try:
        first_iso, last_iso = points[0]["date"].isoformat(), points[-1]["date"].isoformat()
        resolved = resolver(first_iso, last_iso)
        rate = float(resolved["rate"])
        if not math.isfinite(rate) or not -0.20 <= rate <= 0.50:
            return 0.0
        warning = weekly_sampling.partial_risk_free_warning(resolved, window, first_iso, last_iso)
        if warning is not None and warnings is not None:
            warnings.append(warning)
        return rate
    except Exception:
        swallowed("ingest_asset.py:_window_risk_free")
        return 0.0


def _window_metrics(points, risk_free_rate=0.0, nominal_days=None):
    """Metricas de una ventana.

    La rentabilidad se anualiza de forma GEOMETRICA. Antes era `avg * 252`, la
    media aritmetica de los rendimientos diarios, que supera al CAGR en del
    orden de sigma^2/2: para una accion con 30% de volatilidad son unos 4,5
    puntos de rentabilidad de mas, que se colaban enteros en el Sharpe.

    Y el Sharpe resta la tasa libre de riesgo, que es lo que lo hace un Sharpe.
    Antes era `ann_return / vol` con `risk_free_rate: 0` escrito en el documento
    (auditoria 03-09, hallazgo 02).

    A1 (auditoria 29-09): la volatilidad se mide en SEMANAL --ultima observacion
    de cada semana ISO, retornos semana a semana, x sqrt(52)-- con la misma regla
    que el optimizador (weekly_sampling), no sobre rendimientos diarios x sqrt(252):
    el resto del programa mide en semanal y la maestra publicaba otra cifra para
    el mismo activo. Un VL mensual sigue en 12/MONTHLY (politica B-06). La
    rentabilidad geometrica (primer/ultimo valor) no cambia; el drawdown sigue en
    diario fuera de aqui.

    `nominal_days` es el periodo que promete la etiqueta de la ventana. Un
    recorrido que no lo cubre no anualiza (ver `window_span_ok`), y tampoco una
    ventana con menos semanas de las que le tocan (weekly_sampling.window_complete):
    la volatilidad se sigue publicando, como hasta ahora, porque su anualizacion
    aguanta con pocas observaciones y no depende de los extremos del tramo.
    """
    volatility = weekly_sampling.window_volatility([(p["date"], p["value"]) for p in points])
    if volatility is None:
        return None
    vol = volatility.get("annualized_volatility")
    out = {}
    if vol is not None:
        # metrics.v1.2: se declara con que se midio; el metodo solo aplica si
        # hay rentabilidad anualizada que declarar.
        out["annualized_volatility"] = vol
        out["frequency"] = volatility["frequency"]

    first, last = points[0], points[-1]
    span_days = (last["date"] - first["date"]).days
    if (window_span_ok(span_days, nominal_days) and weekly_sampling.window_complete(volatility, nominal_days)
            and first["value"] > 0 and last["value"] > 0):
        # Decision 6.3 (17-10-2026): anios por fechas con la misma base (365,2425) y el
        # mismo Sharpe ex post que el backtest y la cartera real (weekly_sampling).
        years = span_days / weekly_sampling.DAYS_PER_YEAR
        ann_return = (last["value"] / first["value"]) ** (1.0 / years) - 1.0
        rate = float(risk_free_rate or 0.0)
        out["annualized_return"] = round(ann_return, 8)
        out["risk_free_rate"] = round(rate, 8)
        out["method"] = "GEOMETRIC_CAGR"
        sharpe = weekly_sampling.ex_post_sharpe(ann_return, rate, vol)
        if sharpe is not None:
            out["sharpe_ratio"] = round(sharpe, 8)
    return out


def _max_drawdown(points):
    peak = None
    worst = 0.0
    worst_date = None
    for point in points:
        value = point["value"]
        if peak is None or value > peak:
            peak = value
        if peak and peak > 0:
            drawdown = value / peak - 1.0
            if drawdown < worst:
                worst = drawdown
                worst_date = point["date"]
    out = {"value": round(worst, 8)}
    if worst_date is not None:
        out["date"] = worst_date.isoformat()
    return out


def _risk_score_from_vol(vol_dec):
    if vol_dec is None:
        return None
    pct = vol_dec * 100.0
    for high, score in [(2, 1), (5, 2), (10, 3), (15, 4), (25, 5), (35, 6)]:
        if pct <= high:
            return score
    return 7


# Base del YTD = ultimo cierre <= 31-dic del anio anterior (14-10-2026). Vive en
# fund_ingest para que las dos rutas de ingesta y el refresco diario compartan
# una sola implementacion.
_ytd_return = fund_ingest.ytd_return


def build_metrics_latest(asset_id: str, asset_type: str, points, now_iso: str,
                         risk_free_resolver=None, srri=None, risk_free_warnings=None) -> dict:
    """`risk_free_resolver` resuelve la media €STR de cada ventana (firma de
    `ecb_rates.resolve_estr_window_average`). Sin el, la tasa es 0 y el Sharpe
    queda sin descontar: por eso la ingesta real lo inyecta.

    `srri` es el indicador 1-7 del KID, que solo publica el proveedor: no se
    deduce de la serie. Recalcular un fondo sin pasarlo cambiaba su
    `risk_score_source` de SRRI a VOL_BUCKET y le borraba el dato regulatorio,
    que es peor que lo que se venia a arreglar. Quien recalcula lo arrastra.

    `risk_free_warnings`: lista opcional donde se anotan las ventanas cuya media €STR
    es parcial (RISK_FREE_RATE_PARTIAL_COVERAGE; quinta pasada, I-2). El documento no
    cambia: metrics.v1.3 no tiene donde guardarlo."""
    from fund_history_quality import usable_documents, policy_for
    if policy_for(asset_id):
        reviewed = usable_documents(asset_id, [{"points": points}])
        points = reviewed[0]["points"] if reviewed else []
    valid = _valid_metric_points(points)
    windows = {}
    last_date = valid[-1]["date"] if valid else None
    for label, years in METRIC_WINDOWS.items():
        if last_date is None:
            continue
        nominal_days = 365 * years
        cutoff = last_date - timedelta(days=nominal_days)
        window_points = [p for p in valid if p["date"] >= cutoff]
        if policy_for(asset_id) and (not window_points or (last_date-window_points[0]["date"]).days < nominal_days-14):
            continue
        rate = _window_risk_free(window_points, risk_free_resolver, window=label,
                                 warnings=risk_free_warnings)
        metrics = _window_metrics(window_points, rate, nominal_days=nominal_days)
        if metrics:
            windows[label] = metrics

    vol_for_score = None
    for label in ("3y", "5y", "1y", "10y"):
        if label in windows:
            vol_for_score = windows[label].get("annualized_volatility")
            break

    kid_srri = srri if isinstance(srri, int) and 1 <= srri <= 7 else None

    payload = {
        "asset_id": asset_id,
        "population": "fund" if str(asset_type).upper() == "FUND" else "stock",
        "source": "FUND_QUALITY_REVIEW_V1" if policy_for(asset_id) else METRICS_SOURCE,
        "updated_at": now_iso,
        "windows": windows,
        "risk_score_source": "SRRI" if kid_srri is not None else "VOL_BUCKET",
        "observations_count": len(valid),
        "first_date": valid[0]["date"].isoformat() if valid else None,
        "last_date": valid[-1]["date"].isoformat() if valid else None,
        "ytd_return": _ytd_return(valid),
        "max_drawdown_hist": _max_drawdown(valid) if valid else None,
        "srri": kid_srri if kid_srri is not None else _risk_score_from_vol(vol_for_score),
    }

    if last_date is not None:
        cutoff_5y = last_date - timedelta(days=365 * 5)
        window_5y = [p for p in valid if p["date"] >= cutoff_5y]
        if len(window_5y) >= MIN_METRIC_POINTS and (not policy_for(asset_id) or (last_date-window_5y[0]["date"]).days >= 365*5-14):
            payload["max_drawdown_5y"] = _max_drawdown(window_5y)["value"]

    cleaned = _omit_nulls(payload)
    validate_contract(cleaned, "metrics.v1.3.schema.json")
    return cleaned


def _load_full_history(db, isin, match, write):
    """Carga la serie completa de EODHD (normalizada a EUR). Resumen; escribe si write."""
    sym = match["symbol"]
    # Auditoria de divisas (06-09-2026): la divisa la manda el listado del proveedor;
    # el `or "EUR"` de antes convertia en euros cualquier cotizacion sin divisa conocida.
    ccy_meta = (match.get("currency") or "").upper() or None
    ccy = (listing_currency(sym) or ccy_meta or "").upper()
    if not ccy:
        return {"symbol": sym, "loaded": False, "reason": "NO_CURRENCY",
                "note": "el proveedor no declara divisa para el listado: no se escribe serie"}
    asset_type = match.get("type_class") if match.get("type_class") in SUPPORTED_TYPE_CLASSES else "STOCK"
    today = _today()
    # Reingestion may target an existing asset. Do not overwrite annual documents
    # while leaving REFRESH on another adjustment basis or a stale drawdown cache.
    ref = db.collection("assets").document(isin) if db is not None else None
    if ref is not None and list(ref.collection("price_series").limit(1).stream()):
        from price_history_sync import prepare_repair, apply_repair
        try:
            root_snapshot = ref.get()
            plan, snapshots = prepare_repair(db, ref, isin, asset_type, sym, ccy, today, {})
            counts = apply_repair(db, ref, plan, snapshots, root_snapshot.to_dict() or {},
                                  root_snapshot.update_time) if write else {}
            return {"loaded": True, "symbol": sym, "points": len(plan["points"]),
                    "first_date": plan["first_date"], "last_date": plan["last_date"],
                    "history_rebuilt": True, "applied": bool(write), **counts}
        except Exception as exc:
            return {"loaded": False, "reason": "HISTORY_REPAIR_REQUIRED",
                    "error_type": type(exc).__name__, "symbol": sym, "applied": False}
    try:
        rows = fetch_eod(sym, HISTORY_START, today)
        # Para divisas != EUR, recorta a la cobertura del FX: el EUR no existe antes de 1999,
        # asi que las fechas previas a la primera cotizacion EUR/divisa romperian la conversion
        # ("sin FX previo"). Pre-cargamos el FX y filtramos esas fechas.
        fx_cache = {}
        if ccy != "EUR" and rows:
            major_ccy, _minor_scale = _major_currency(ccy)
            fx_dates, fx_rates = _fetch_fx(major_ccy, HISTORY_START, today)
            fx_cache[major_ccy] = (fx_dates, fx_rates)
            rows = [r for r in rows if str(r.get("date")) >= fx_dates[0]]
        conv, fx_meta = _convert_eur(rows, ccy, fx_cache, HISTORY_START, today)
    except Exception as exc:  # FX/EODHD/divisa exotica -> no tumbar la llamada
        return {"loaded": False, "error": str(exc)[:200], "symbol": sym}
    if not conv:
        return {"loaded": False, "reason": "sin datos EODHD o sin cobertura FX", "symbol": sym}
    by_year = _group_by_year(conv)
    now = _now()
    risk_free_warnings = []
    metrics_doc = build_metrics_latest(isin, asset_type, conv, now,
                                       risk_free_resolver=_estr_window_resolver,
                                       risk_free_warnings=risk_free_warnings)
    if risk_free_warnings:
        _metrics_logger.info("%s: RISK_FREE_RATE_PARTIAL_COVERAGE en %s", isin,
                             ", ".join(f"{w['window']} ({w['coverage_ratio']:.2f})" for w in risk_free_warnings))
    summary = {"loaded": True, "symbol": sym, "points": len(conv),
               "first_date": conv[0]["date"], "last_date": conv[-1]["date"],
               "years": len(by_year), "applied": bool(write),
               "metrics": {
                   "available": bool(metrics_doc.get("windows")),
                   "windows": sorted((metrics_doc.get("windows") or {}).keys()),
                   "observations_count": metrics_doc.get("observations_count"),
                   "last_date": metrics_doc.get("last_date"),
                   "applied": bool(write),
                   "risk_free_warnings": risk_free_warnings,
               }}
    if not write:
        return summary
    ref = db.collection("assets").document(isin)
    batch = db.batch()
    pending = 0
    for year, pts in by_year.items():
        doc_id = _load_doc_id(sym, year)
        doc = {
            "asset_id": isin, "asset_type": asset_type, "currency": "EUR",
            "document_id": doc_id, "first_date": pts[0]["date"], "last_date": pts[-1]["date"],
            "history_quality_status": "COMPLETE", "interval": "1d",
            "observations_count": len(pts), "points": pts,
            "schema_version": PRICE_SERIES_SCHEMA, "series_type": _series_type_for(asset_type),
            "source": "EODHD", "source_currency": ccy,
            "source_listing_id": "EODHD:%s" % sym, "source_price_id": "EODHD:%s" % sym,
            "updated_at": now, "year": year,
        }
        doc.update(fx_meta)
        doc = _omit_nulls(doc)
        validate_contract(doc, "price-series.v1.2.schema.json")
        batch.set(ref.collection("price_series").document(doc_id), doc)
        pending += 1
        if pending % 400 == 0:
            batch.commit()
            batch = db.batch()
            pending = 0
    batch.set(ref.collection("metrics").document("latest"), metrics_doc)
    batch.commit()
    return summary


# --------------------------------------------------------------------------- orquestacion
def ingest_one(
    isin: str,
    with_history: bool = False,
    write: bool = False,
    preferred_symbol: str | None = None,
) -> dict:
    """Da de alta un activo EODHD soportado en la maestra. dry-run salvo write=True."""
    operation = "ingest_one"
    if write:
        require_master_writes_enabled(operation)
    else:
        log_master_write_decision(operation, enabled=master_writes_enabled(), dry_run=True, asset_id=isin)

    isin = (isin or "").strip().upper()
    if not ISIN_RE.match(isin):
        return {"asset_id": isin, "ok": False, "error": "ISIN no valido"}

    db = _master_db()
    ref = db.collection("assets").document(isin)
    exists = ref.get().exists

    match = resolve_symbol(isin, preferred_symbol) if preferred_symbol else resolve_symbol(isin)
    if not match:
        try:
            fund_match = fund_ingest.resolve_fund(isin)
        except fund_ingest.FundLookupUnavailable as exc:
            return {"asset_id": isin, "ok": False, "applied": False, "preview": not write,
                    "error_code": "FUND_LOOKUP_UNAVAILABLE", "retryable": True, "error": str(exc)}
        if fund_match:
            return fund_ingest.ingest_fund(
                isin,
                fund_match,
                db,
                with_history=with_history,
                write=write,
            )
        return {"asset_id": isin, "ok": False, "resolved": False,
                "error": "No se pudo resolver el ISIN como fondo Morningstar ni como activo EODHD"
                if not preferred_symbol else
                "EODHD no resuelve el simbolo solicitado y Morningstar no identifica el ISIN como fondo"}
    asset_type = match["type_class"]
    if asset_type not in SUPPORTED_TYPE_CLASSES and "fund" in str(match.get("type") or "").lower():
        try:
            fund_match = fund_ingest.resolve_fund(isin)
        except fund_ingest.FundLookupUnavailable as exc:
            return {"asset_id": isin, "ok": False, "applied": False, "preview": not write,
                    "error_code": "FUND_LOOKUP_UNAVAILABLE", "retryable": True, "error": str(exc)}
        if fund_match:
            return fund_ingest.ingest_fund(
                isin,
                fund_match,
                db,
                with_history=with_history,
                write=write,
                price_match=match,
            )
    if asset_type not in SUPPORTED_TYPE_CLASSES:
        return {"asset_id": isin, "ok": False, "resolved": True, "symbol": match["symbol"],
                "unsupported_type": match.get("type"),
                "note": "La ingesta EODHD cubre acciones, ETF e indices simples; este tipo queda pendiente."}

    fund = fetch_fundamentals(isin, match) if asset_type == "STOCK" else {}
    if asset_type == "STOCK":
        root = _omit_nulls(build_stock_root(isin, match, fund))
        validate_contract(root, "asset-stock.v1.schema.json")
    else:
        root = _omit_nulls(build_market_root(isin, match))
        validate_contract(root, "asset-market.v1.schema.json")

    result = {
        "asset_id": isin, "ok": True, "applied": bool(write), "preview": not write,
        "resolved": True, "symbol": match["symbol"], "name": root["identity"]["name"],
        "asset_type": root["asset_type"],
        "fundamentals_source": fund.get("source") if fund else None,
        "exists_in_master": exists,
        "root_action": "SKIP_EXISTS" if exists else "CREATE",
        "with_history": bool(with_history),
    }

    if not write:
        if with_history:
            result["history"] = _load_full_history(db, isin, match, write=False)
        result["root_preview"] = root
        return result

    # --- escritura ---
    if not exists:
        ref.create(root)  # create-only: falla si ya existe (no sobreescribe)
        result["root_written"] = True
    else:
        result["root_written"] = False  # ya existe: no se toca el root

    # La entrada de meta/search_index sale de la raiz que se escribe. Con el
    # activo ya existente la raiz no se toca, y reescribir su entrada desde la
    # que se acaba de construir la desalineaba de la viva (13-10-2026); de esa
    # coherencia se ocupa el reconciliador programado.
    if exists:
        result["search_index_updated"] = False
    else:
        try:
            result["search_index_updated"] = upsert_search_index_entry(db, isin, root)
        except Exception as exc:  # El reconciliador programado repara un fallo parcial.
            result["search_index_updated"] = False
            result["search_index_warning"] = str(exc)[:200]

    if with_history:
        result["history"] = _load_full_history(db, isin, match, write=True)
        result["metrics"] = (result["history"] or {}).get("metrics")

    return result
