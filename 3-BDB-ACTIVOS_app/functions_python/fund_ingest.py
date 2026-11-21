# -*- coding: utf-8 -*-
"""Alta controlada de fondos Morningstar desde el panel Admin.

El modulo resuelve un ISIN de fondo, construye la raiz ``master.asset.v1.1``,
cartera, metricas e historico mensual en EUR. El historico solo se publica para
clases de acumulacion: Morningstar entrega un indice de rentabilidad mensual y
el NAV actual; en una clase de acumulacion ambos evolucionan de forma
equivalente y permiten reconstruir el NAV sin inventar observaciones diarias.

La escritura es create-only para la raiz. Cartera, metricas e historico se
refrescan con ``set`` porque son datos fechados y propiedad del pipeline.
"""

from __future__ import annotations

import json
import math
import os
import re
import urllib.parse
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

from contract_validation import validate_contract
from price_refresh import _convert_eur, _group_by_year, fetch_eod
from search_index import upsert_search_index_entry
from quietlog import swallowed_quiet
import logging
from fund_return_basis import reconcile_return
import weekly_sampling

_metrics_logger = logging.getLogger("bdb.metrics")


SCREENER_URL = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener"
SAL_URL = "https://api-global.morningstar.com/sal-service/v1/{asset}/{endpoint}/{sec_id}{suffix}"
# Ola A1 (A1.3): la clave vivia hardcodeada y versionada; ahora llega por entorno
# (Secret Manager en produccion: `firebase functions:secrets:set MORNINGSTAR_API_KEY`).
# La que vivia aqui es la publica que el sitio de Morningstar lleva en sus paginas, la misma que usa el extractor:
# no es de ninguna cuenta y no hay nada que rotar (decision 118, 06-11-2026).
MORNINGSTAR_API_KEY = os.environ.get("MORNINGSTAR_API_KEY", "")
UNIVERSES = ("FOESP$$ALL", "FOEUR$$ALL", "")
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
ROOT_SCHEMA = "master.asset.v1.1"
HOLDINGS_SCHEMA = "master.holdings.v1.1"
PRICE_SERIES_SCHEMA = "asset-price-series.v1.2"
METRICS_SOURCE = "FONDOSDB_FUND_NAV_EUR"
MIN_HISTORY_POINTS = 24


class FundLookupUnavailable(RuntimeError):
    """The provider could not complete the lookup; this is not an unknown ISIN."""


# Dias naturales minimos para anualizar una rentabilidad (330, ~11 meses). La
# definicion y su porque viven en weekly_sampling.MIN_ANNUALIZATION_DAYS, comun con
# la cartera real (sexta pasada, I-7); ingest_asset la importa de aqui.
MIN_ANNUALIZATION_DAYS = weekly_sampling.MIN_ANNUALIZATION_DAYS

# Fraccion minima de la ventana nominal que el recorrido real debe cubrir para
# que la ventana pueda publicarse con esa etiqueta.
#
# MIN_ANNUALIZATION_DAYS impide anualizar tramos absurdos, pero no impide
# MENTIR sobre que ventana es: un fondo con 428 dias de serie pasaba el suelo de
# 330 y su cifra se guardaba como `windows["3y"]`. En la comparacion contra las
# cifras del proveedor al mismo corte (30-06-2026) esos casos eran 8 de las 9
# unicas desviaciones mayores de 1 punto en 596 fondos de acumulacion: no era
# que el calculo fallara, era que se comparaba 1,2 anios contra 3.
#
# 0,85 y no 1,0 porque el recorrido real nunca llega al nominal: la ventana se
# define como last_date - N anios y el primer punto cae en el siguiente dia
# habil. Un fondo que cotiza a diario pierde ahi unos dias; uno con calendario
# irregular, algunas semanas. 0,85 admite eso y descarta un tramo que sea
# claramente mas corto que la ventana que dice ser.
MIN_WINDOW_COVERAGE = 0.85


def window_span_ok(span_days: int, nominal_days: int | None = None) -> bool:
    """Si un recorrido de `span_days` puede anualizarse como ventana nominal.

    Fuente unica para las dos rutas de ingesta y para el recalculo. Sin
    `nominal_days` solo aplica el suelo de anualizacion, que es como se
    comportaba antes de anadir la cobertura.
    """
    if span_days < MIN_ANNUALIZATION_DAYS:
        return False
    if not nominal_days:
        return True
    return span_days >= MIN_WINDOW_COVERAGE * nominal_days

SCREENER_FIELDS = (
    "SecId|Name|LegalName|ISIN|Currency|CategoryName|StarRatingM255|"
    "OngoingCharge|ActualManagementFee|InceptionDate|ClosePrice|ClosePriceDate|"
    "FundId|Universe|EUSFDRType|SFDRType|SFDRFundType"
)

SAL_ENDPOINTS = {
    "quote": ("quote/v7", True),
    "fees": ("price/investmentFee", True),
    "trailing": ("trailingReturn/v3", True),
    "risk": ("performance/riskVolatility", True),
    "allocation": ("process/asset/v3", True),
    "sector": ("portfolio/v2/sector", True),
    "regional": ("portfolio/regionalSectorIncludeCountries", True),
    "market_cap": ("process/marketCap", True),
    "fixed_income": ("process/fixedIncomeStyle", True),
    "holdings": ("portfolio/holding/v2", True),
    "esg": ("esg/v1", True),
    "strategy": ("morningstarTake/investmentStrategy", True),
    # performance/v4 no usa el sufijo /data.
    "performance_graph": ("performance/v4", False),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _iso_date(value) -> str | None:
    if not value:
        return None
    text = str(value)[:10]
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _number(value):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _fraction(value):
    number = _number(value)
    return round(number / 100.0, 8) if number is not None else None


def _omit_none(value):
    if isinstance(value, dict):
        return {key: _omit_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_omit_none(item) for item in value]
    return value


def _get_json(url: str, params: dict | None = None, headers: dict | None = None, *, timeout=45):
    if params:
        url = "%s?%s" % (url, urllib.parse.urlencode(params))
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; BDB-Admin/1.0)",
            **(headers or {}),
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _valid_isin(isin: str) -> bool:
    if not ISIN_RE.match(isin):
        return False
    expanded = "".join(str(ord(char) - 55) if char.isalpha() else char for char in isin)
    total = 0
    double = False
    for char in reversed(expanded):
        number = int(char) * (2 if double else 1)
        total += number - 9 if number > 9 else number
        double = not double
    return total % 10 == 0


def _screener_response(params: dict):
    # One bounded retry for transient lookup errors; never turn an outage into
    # a negative ISIN match or retry an authorization failure.
    for attempt in range(2):
        try:
            return _get_json(SCREENER_URL, params=params,
                             headers={"Referer": "https://www.morningstar.es/"}, timeout=15)
        except urllib.error.HTTPError as exc:
            if attempt or exc.code not in {408, 429, 500, 502, 503, 504}:
                raise
        except (TimeoutError, ConnectionError, urllib.error.URLError):
            if attempt:
                raise


def resolve_fund(isin: str) -> dict | None:
    """Resuelve solo fondos tradicionales; deja ETF/acciones al flujo EODHD."""
    isin = str(isin or "").strip().upper()
    if not _valid_isin(isin):
        return None
    failed = False
    for universe in UNIVERSES:
        params = {
            "page": 1,
            "pageSize": 5,
            "sortOrder": "LegalName asc",
            "outputType": "json",
            "version": 1,
            "languageId": "es-ES",
            "currencyId": "EUR",
            "securityDataPoints": SCREENER_FIELDS,
            "term": isin,
        }
        if universe:
            params["universeIds"] = universe
        try:
            payload = _screener_response(params)
            if (not isinstance(payload, dict) or not isinstance(payload.get("rows"), list)
                    or any(not isinstance(row, dict) for row in payload["rows"])):
                raise ValueError("Invalid screener response")
        except Exception:
            # Do not log URLs, credentials or provider bodies. A failed lookup
            # remains distinct from a completed search with no matching fund.
            failed = True
            continue
        for row in payload["rows"]:
            if str(row.get("ISIN") or "").upper() != isin:
                continue
            detected_universe = str(row.get("Universe") or universe or "").upper()
            if detected_universe and not detected_universe.startswith("FO"):
                return None
            sec_id = str(row.get("SecId") or "").strip()
            if not sec_id or not detected_universe:
                raise FundLookupUnavailable("Morningstar devolvió una ficha de fondo incompleta.")
            return {
                "sec_id": sec_id,
                "universe": detected_universe,
                "row": row,
                "name": row.get("LegalName") or row.get("Name") or isin,
            }
        if not universe:
            # The global search covers the narrower universes, even if one
            # of those earlier requests failed temporarily.
            return None
    if failed:
        raise FundLookupUnavailable("No se pudo consultar Morningstar. Inténtalo de nuevo; el ISIN no se ha descartado.")
    return None


def _sal_get(sec_id: str, endpoint: str, with_data_suffix: bool):
    url = SAL_URL.format(
        asset="fund",
        endpoint=endpoint,
        sec_id=urllib.parse.quote(sec_id),
        suffix="/data" if with_data_suffix else "",
    )
    if not MORNINGSTAR_API_KEY:
        raise RuntimeError(
            "MORNINGSTAR_API_KEY no configurada (Secret Manager / variable de entorno)."
        )
    params = {"clientId": "MDC", "version": "4.71.0"}
    if endpoint == "trailingReturn/v3":
        params["duration"] = "monthly"
    if endpoint == "portfolio/holding/v2":
        params.update({"premiumNum": 10000, "freeNum": 10000})
    return _get_json(
        url,
        params=params,
        headers={
            "apikey": MORNINGSTAR_API_KEY,
            "Referer": "https://global.morningstar.com/",
            "Origin": "https://global.morningstar.com",
        },
    )


def fetch_fund_payload(match: dict) -> tuple[dict, list[str]]:
    sec_id = match["sec_id"]
    blocks: dict = {}
    warnings: list[str] = []
    with ThreadPoolExecutor(max_workers=7) as pool:
        futures = {
            pool.submit(_sal_get, sec_id, endpoint, suffix): name
            for name, (endpoint, suffix) in SAL_ENDPOINTS.items()
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                data = future.result()
                if isinstance(data, (dict, list)):
                    blocks[name] = data
                else:
                    warnings.append("MORNINGSTAR_%s_EMPTY" % name.upper())
            except Exception:
                swallowed_quiet("fund_ingest.py:219")
                warnings.append("MORNINGSTAR_%s_UNAVAILABLE" % name.upper())
    blocks["screener"] = match.get("row") or {}
    return blocks, warnings


def _asset_class(quote: dict, category: str) -> tuple[str, str]:
    asset_type = str(quote.get("assetType") or "").upper()
    low = category.lower()
    if asset_type == "EQUITY" or "equity" in low or "acciones" in low:
        return "RV", "equity"
    if asset_type in {"FIXEDINCOME", "FIXED_INCOME", "BOND"} or "bond" in low or "renta fija" in low:
        return "RF", "fixed_income"
    if asset_type in {"ALLOCATION", "MULTI_ASSET"} or "allocation" in low or "mixto" in low:
        return "Mixto", "mixed"
    if asset_type == "MONEYMARKET" or "money market" in low or "monetario" in low:
        return "Monetario", "money_market"
    if asset_type in {"ALTERNATIVE", "COMMODITY"}:
        return "Alternativos", "alternatives"
    return "Otros", "other"


def _primary_region(category: str) -> str | None:
    low = category.lower()
    for needles, result in (
        (("global", "world"), "global"),
        (("united states", " usa", " u.s."), "united_states"),
        (("europe", "europa"), "europe"),
        (("emerging", "emergente"), "emerging_markets"),
        (("japan", "japón"), "japan"),
        (("asia",), "asia"),
    ):
        if any(needle in low for needle in needles):
            return result
    return None


def _allocation_exposure(block: dict) -> dict | None:
    allocation = block.get("allocationMap") if isinstance(block, dict) else None
    if not isinstance(allocation, dict):
        return None

    def net(key):
        node = allocation.get(key) or {}
        return _number(node.get("netAllocation")) or 0.0

    equity = net("AssetAllocUSEquity") + net("AssetAllocNonUSEquity")
    bond = net("AssetAllocBond")
    cash = net("AssetAllocCash")
    other = net("AssetAllocOther") + net("AssetAllocNotClassified")
    values = {"equity": equity, "bond": bond, "cash": cash, "other": other}
    return {key: round(max(0.0, value) / 100.0, 8) for key, value in values.items()}


def _sector_exposure(block: dict) -> dict:
    node = ((block or {}).get("EQUITY") or {}).get("fundPortfolio") or {}
    ignored = {"portfolioDate"}
    return {
        key: round(value / 100.0, 8)
        for key, raw in node.items()
        if key not in ignored and (value := _number(raw)) is not None and value > 0
    }


def _region_exposure(block: dict) -> dict:
    countries = ((block or {}).get("fundPortfolio") or {}).get("countries") or []
    result = {}
    for row in countries:
        if not isinstance(row, dict):
            continue
        value = _number(row.get("percent"))
        name = str(row.get("name") or "").strip()
        if name and value is not None and value > 0:
            result[name] = round(value / 100.0, 8)
    return result


def _market_caps(block: dict) -> dict:
    node = (block or {}).get("fund") or {}
    return {
        key: round(value / 100.0, 8)
        for key in ("giant", "large", "medium", "small", "micro")
        if (value := _number(node.get(key))) is not None and value > 0
    }


def _trailing_returns(block: dict, graph: dict | None = None, class_start=None) -> dict | None:
    columns = block.get("columnDefs") or []
    fund_values = block.get("totalReturnNAV") or block.get("netReturn") or []
    category_values = block.get("totalReturnCategoryNew") or []
    keys = {
        "1Month": "1m", "3Month": "3m", "YearToDate": "ytd",
        "1Year": "1a", "3Year": "3a_anualizada", "5Year": "5a_anualizada",
        "10Year": "10a_anualizada", "SinceInception": "desde_lanzamiento_anualizada",
    }
    trailing = {}
    reconciliations = {}
    graph = graph or {}
    same_currency = bool(block.get('cur')) and block.get('cur') == graph.get('baseCurrency')
    horizons = {'3Year':36, '5Year':60, '10Year':120}
    for index, column in enumerate(columns):
        key = keys.get(column)
        if not key:
            continue
        row = {}
        if index < len(fund_values) and (value := _number(fund_values[index])) is not None:
            if column in horizons:
                proof = reconcile_return(value, (graph.get('graphData') or {}).get('fund') or [], block.get('fundReturnDate'), horizons[column], class_start=class_start) if same_currency else None
                extended = block.get('extendedPerformanceFlag') or []
                is_extended = index < len(extended) and bool(extended[index])
                if proof and not is_extended:
                    row['fondo'] = proof['annualized_pct']
                    reconciliations[key] = proof
                else:
                    # R-09 (auditoria 29-09): sin prueba no se etiqueta como
                    # anualizada verificada, pero tampoco desaparece. `fondo`
                    # sigue reservado a cifras verificadas (es lo que lee el
                    # read model); la cruda queda aparte, con su motivo.
                    reason = ('EXTENDED_PERFORMANCE' if is_extended
                              else 'CURRENCY_MISMATCH' if not same_currency
                              else 'GRAPH_PROOF_MISSING')
                    row['fondo_sin_verificar'] = value
                    reconciliations[key] = {'basis': 'UNVERIFIED', 'reported_pct': value, 'reason': reason}
            elif column != 'SinceInception':
                row["fondo"] = value
        if index < len(category_values) and (value := _number(category_values[index])) is not None:
            if column in horizons:
                proof = reconcile_return(value, (graph.get('graphData') or {}).get('category') or [], block.get('categoryDate'), horizons[column]) if same_currency else None
                if proof and _iso_date(block.get('categoryDate')) == _iso_date(block.get('fundReturnDate')):
                    row['categoria'] = proof['annualized_pct']
            elif column != 'SinceInception' and _iso_date(block.get('categoryDate')) == _iso_date(block.get('fundReturnDate')):
                row["categoria"] = value
        if row:
            trailing[key] = row
    if not trailing:
        return None
    return {"trailing_pct": trailing, "fecha_dato": _iso_date(block.get("fundReturnDate") or block.get("endDate")),
            "multi_year_reconciliation": reconciliations}


def _risk_snapshot(block: dict, quote: dict) -> dict | None:
    fund = block.get("fundRiskVolatility") or {}
    result = {"volatilidad_pct": {}, "sharpe": {}, "alpha": {}, "beta": {}, "r2": {}}
    for years in (1, 3, 5, 10):
        node = fund.get("for%sYear" % years) or {}
        label = "%sa" % years
        for source_key, target in (
            ("standardDeviation", "volatilidad_pct"),
            ("sharpeRatio", "sharpe"),
            ("alpha", "alpha"),
            ("beta", "beta"),
            ("rSquared", "r2"),
        ):
            value = _number(node.get(source_key))
            if value is not None:
                result[target][label] = {"fondo": value}
    result["fecha_dato"] = _iso_date(fund.get("endDate"))
    srri = _number(quote.get("srri"))
    if srri is not None and srri.is_integer() and 1 <= srri <= 7:
        result["srri_1a7"] = int(srri)
    return result if "srri_1a7" in result or any(result[key] for key in ("volatilidad_pct", "sharpe")) else None


def _fixed_income_profile(block: dict) -> dict | None:
    fund = (block or {}).get("fund") or {}
    mapped = {
        "effective_duration": _number(fund.get("avgEffectiveDuration")),
        "modified_duration": _number(fund.get("modifiedDuration")),
        "effective_maturity": _number(fund.get("avgEffectiveMaturity")),
        "avg_credit_quality": fund.get("avgCreditQualityName") or fund.get("calculatedAverageCreditRating"),
        "yield_to_maturity": _number(fund.get("yieldToMaturity")),
    }
    return _omit_none(mapped) or None


def _holdings(block: dict) -> tuple[list[dict], dict]:
    rows = []
    for page_key, holding_type in (
        ("equityHoldingPage", "Equity"),
        ("bondHoldingPage", "Bond"),
        ("otherHoldingPage", "Other"),
    ):
        page = (block or {}).get(page_key) or {}
        # The provider currently spells the bond page "boldHoldingPage".
        # Accept both wire formats and never count a duplicated alias twice.
        if page_key == "bondHoldingPage" and not page.get("holdingList"):
            page = (block or {}).get("boldHoldingPage") or page
        for item in page.get("holdingList") or []:
            if not isinstance(item, dict):
                continue
            weight = _number(item.get("weighting"))
            name = item.get("securityName") or item.get("name")
            if not name or weight is None:
                continue
            rows.append(_omit_none({
                "name": str(name),
                "weight_pct": weight,
                "holding_type": item.get("holdingType") or holding_type,
                "identifiers": {
                    "isin": item.get("isin"),
                    "ticker": item.get("ticker"),
                    "morningstar_sec_id": item.get("secId"),
                },
                "country": item.get("country"),
                "currency": item.get("currency"),
                "sector": item.get("sector"),
                "maturity": _iso_date(item.get("maturityDate")),
                "coupon": _number(item.get("coupon")),
                "instrument_type": item.get("holdingTypeId"),
            }))
    rows.sort(key=lambda row: -(row.get("weight_pct") or 0))
    summary = (block or {}).get("holdingSummary") or {}
    # The summary can describe a newer portfolio than the published rows.
    # A present but invalid detail date must not inherit that newer date.
    detail_date = _iso_date(block.get("portfolioLastestDateFooter")) \
        if (block or {}).get("portfolioLastestDateFooter") is not None \
        else _iso_date(summary.get("portfolioDate"))
    same_date = detail_date is not None and detail_date == _iso_date(summary.get("portfolioDate"))
    total_count = int(_number(summary.get("numberOfHolding")) or len(rows))
    top10_weight = _number(summary.get("topHoldingWeighting")) if same_date else None
    if top10_weight is None:
        top10_weight = sum(row.get("weight_pct") or 0 for row in rows[:10])
    return rows, {
        "positions_count": total_count if same_date else len(rows),
        "top10_weight": round(top10_weight, 6),
        "as_of_date": detail_date,
    }


def _fees(block: dict, quote: dict, screener: dict) -> dict:
    actual = (block or {}).get("actualInvestmentFees") or {}
    ongoing = _number(actual.get("ongoingCost"))
    if ongoing is None:
        ongoing = _number(actual.get("kiidOngoingCharge"))
    if ongoing is None:
        raw = _number(quote.get("onGoingCharge"))
        ongoing = raw * 100.0 if raw is not None and raw < 0.25 else raw
    if ongoing is None:
        ongoing = _number(screener.get("OngoingCharge"))
    return {
        "management_fee_pct": _number(actual.get("managementFee")) or _number(screener.get("ActualManagementFee")),
        "ter_pct": ongoing,
        "mifid_ongoing_pct": ongoing,
    }


def build_fund_root(isin: str, match: dict, blocks: dict, fetch_warnings: list[str]) -> tuple[dict, list[dict]]:
    quote = blocks.get("quote") or {}
    screener = blocks.get("screener") or {}
    name = quote.get("investmentName") or match.get("name") or screener.get("LegalName") or isin
    currency = quote.get("baseCurrencyId") or quote.get("currency") or screener.get("Currency")
    category = quote.get("categoryName") or screener.get("CategoryName") or ""
    asset_class, fondosdb_type = _asset_class(quote, category)
    holdings, holding_summary = _holdings(blocks.get("holdings") or {})
    asset_mix = _allocation_exposure(blocks.get("allocation") or {})
    sectors = _sector_exposure(blocks.get("sector") or {})
    regions = _region_exposure(blocks.get("regional") or {})
    market_caps = _market_caps(blocks.get("market_cap") or {})
    fees = _fees(blocks.get("fees") or {}, quote, screener)
    rating = _number(quote.get("morningstarRating") or screener.get("StarRatingM255"))
    warnings = list(dict.fromkeys(fetch_warnings))

    missing = []
    for label, value in (("NAME", name), ("CURRENCY", currency), ("CATEGORY", category), ("ASSET_MIX", asset_mix)):
        if not value:
            missing.append(label)
    if fees.get("ter_pct") is None:
        missing.append("COSTS")
    warnings.extend("MISSING_%s" % label for label in missing)
    accepted = not missing
    portfolio_date = holding_summary.get("as_of_date") or _iso_date((blocks.get("allocation") or {}).get("portfolioDate"))
    now = _now()
    root = {
        "asset_id": isin,
        "asset_type": "FUND",
        "schema_version": ROOT_SCHEMA,
        "updated_at": now,
        "identity": {"name": str(name), "currency": currency},
        "identifiers": {"isin": isin, "aliases": [isin, match["sec_id"]]},
        "listings": [],
        "classification": {
            "asset_class": asset_class,
            "fondosdb_asset_class": asset_class,
            "fondosdb_asset_type": fondosdb_type,
            "asset_subtype": None,
            "region_primary": _primary_region(category),
            "strategy_tags": [],
            "confidence": 0.95 if accepted else 0.7,
            "morningstar_rating": int(rating) if rating is not None and 1 <= int(rating) <= 5 else None,
        },
        "product": {
            "product_type": "fund",
            "commercial_type": category or None,
            "vehicle_complexity": "standard",
            "fund_name": str(name),
            "has_listing": False,
        },
        "costs": fees,
        "performance": {"returns": _trailing_returns(blocks.get("trailing") or {}, blocks.get('performance_graph'), screener.get('InceptionDate'))},
        "risk": _risk_snapshot(blocks.get("risk") or {}, quote),
        "sustainability": {
            "morningstar_sustainability_rating": _number(quote.get("sustainabilityRating")),
            "esg": blocks.get("esg") or None,
            "sfdr": screener.get("SFDRType") or screener.get("EUSFDRType"),
        },
        "portfolio_exposure": {
            "asset_mix": asset_mix,
            "sectors": sectors,
            "equity_regions": regions,
            "market_caps": market_caps,
            "exposure_confidence": 0.95 if asset_mix else 0.5,
        },
        "fixed_income_profile": _fixed_income_profile(blocks.get("fixed_income") or {}),
        "holdings_summary": {
            "has_holdings": bool(holdings),
            **holding_summary,
            "full_holdings_loaded": False,
        },
        "quality": {
            "fondosdb_bucket": "ALTO" if accepted else "BAJO",
            "fondosdb_ok": accepted,
            "warnings": warnings,
            "validation_errors": [],
            "review_flags": [] if accepted else missing,
            "status": "ACCEPTED" if accepted else "REVIEW",
        },
        "source_metadata": {
            "source": "FondosDB",
            "source_file": "admin://morningstar/%s" % match["sec_id"],
            "generated_at": now,
            "report_date": portfolio_date or _iso_date(quote.get("latestPriceDate")),
            "universal_export_present": True,
            "firestore_preview_only": False,
        },
    }
    root = _omit_none(root)
    validate_contract(root, "asset.v1.1.schema.json")
    return root, holdings


def _is_accumulation(quote: dict, name: str) -> bool:
    distribution = str(quote.get("inc_Acc") or quote.get("distributionStatus") or "").strip().lower()
    if distribution:
        return distribution in {"acc", "accumulation", "accumulating"}
    low = name.lower()
    return any(token in low for token in (" acc ", "-acc-", "accumulation", "accumulating"))


def _monthly_nav_eur(blocks: dict, root: dict) -> tuple[list[dict], dict]:
    quote = blocks.get("quote") or {}
    graph = blocks.get("performance_graph") or {}
    name = root["identity"]["name"]
    if not _is_accumulation(quote, name):
        return [], {"loaded": False, "reason": "La fuente solo permite reconstruir NAV seguro para clases de acumulacion."}
    latest_nav = _number(quote.get("nav") or quote.get("latestPrice"))
    raw_points = ((graph.get("graphData") or {}).get("fund") or []) if isinstance(graph, dict) else []
    valid_graph = []
    for row in raw_points:
        point_date = _iso_date(row.get("date")) if isinstance(row, dict) else None
        value = _number(row.get("value")) if isinstance(row, dict) else None
        if point_date and value is not None and value > 0:
            valid_graph.append({"date": point_date, "value": value})
    if latest_nav is None or len(valid_graph) < MIN_HISTORY_POINTS:
        return [], {"loaded": False, "reason": "Morningstar no devuelve ancla NAV e historico mensual suficientes."}
    valid_graph.sort(key=lambda row: row["date"])
    anchor = valid_graph[-1]["value"]
    native_rows = [
        {"date": row["date"], "adjusted_close": round(latest_nav * row["value"] / anchor, 8)}
        for row in valid_graph
    ]
    currency = root["identity"].get("currency") or "EUR"
    try:
        points, fx_meta = _convert_eur(
            native_rows,
            currency,
            {},
            native_rows[0]["date"],
            native_rows[-1]["date"],
        )
    except Exception as exc:
        return [], {"loaded": False, "error": "No se pudo convertir el NAV mensual a EUR: %s" % str(exc)[:180]}
    if len(points) < MIN_HISTORY_POINTS:
        return [], {"loaded": False, "reason": "Historico EUR insuficiente tras la conversion de divisa."}
    metadata = {
        "representation": "RECONSTRUCTED_ACCUMULATION_NAV",
        "frequency": "monthly",
        "morningstar_sec_id": (blocks.get("quote") or {}).get("secId"),
        "native_nav_anchor": latest_nav,
        "native_nav_anchor_date": _iso_date(quote.get("latestPriceDate")) or points[-1]["date"],
        **fx_meta,
    }
    return points, metadata


def _daily_nav_eur(price_match: dict, root: dict) -> tuple[list[dict], dict]:
    symbol = str(price_match.get("symbol") or "").strip()
    if not symbol:
        return [], {"loaded": False, "reason": "EODHD no devuelve un simbolo de fondo utilizable."}
    try:
        rows = fetch_eod(symbol, "1990-01-01", date.today().isoformat())
    except Exception as exc:
        return [], {"loaded": False, "error": "No se pudo descargar el NAV diario EODHD: %s" % str(exc)[:180]}
    if len(rows) < MIN_HISTORY_POINTS:
        return [], {"loaded": False, "reason": "EODHD no devuelve historico NAV diario suficiente."}
    currency = price_match.get("currency") or root["identity"].get("currency") or "EUR"
    try:
        points, fx_meta = _convert_eur(rows, currency, {}, rows[0]["date"], rows[-1]["date"])
    except Exception as exc:
        return [], {"loaded": False, "error": "No se pudo convertir el NAV diario a EUR: %s" % str(exc)[:180]}
    if len(points) < MIN_HISTORY_POINTS:
        return [], {"loaded": False, "reason": "Historico NAV diario EUR insuficiente tras convertir divisa."}
    return points, {
        "representation": "OBSERVED_DAILY_NAV",
        "frequency": "daily",
        "source": "EODHD",
        "interval": "1d",
        "source_listing_id": "EODHD:%s" % symbol,
        "source_price_id": "EODHD:%s" % symbol,
        "document_prefix": "EODHD_%s" % symbol.replace(".", "_").replace("/", "_"),
        **fx_meta,
    }


def _returns(points: list[dict]) -> list[float]:
    output = []
    for previous, current in zip(points, points[1:]):
        if previous["value"] > 0 and current["value"] > 0:
            output.append(current["value"] / previous["value"] - 1.0)
    return output


def _window_metrics(points: list[dict], risk_free_rate: float = 0.0,
                    nominal_days: int | None = None) -> dict | None:
    """Metricas de una ventana de NAV.

    La rentabilidad ya se anualizaba en geometrico, pero el Sharpe no restaba la
    tasa libre de riesgo y el documento declaraba "risk_free_rate": 0. Un Sharpe
    sin descontar la tasa no es un Sharpe (auditoria 03-09, hallazgo 02).

    El suelo de `years` estaba en 1/12: una ventana de dos semanas se elevaba
    como si fuera un mes y salia una rentabilidad anualizada disparatada. Ahora
    hace falta un anio natural para anualizar, igual que en ingest_asset y que
    en el calculador de plataforma.

    `nominal_days` es el periodo que la etiqueta promete. Si el recorrido real
    no lo cubre (window_span_ok) no se anualiza: una rentabilidad bien calculada
    sobre 14 meses y publicada como "3y" sigue siendo una cifra equivocada. La
    volatilidad se publica igual, como hasta ahora.

    A1 (auditoria 29-09): la volatilidad se mide en SEMANAL con la regla comun
    de weekly_sampling (ultima observacion de cada semana ISO, x sqrt(52)), la
    misma que el optimizador. Un VL diario ya no sale DAILY/252. Se conserva la
    politica B-06 para huecos mayores: mensual 12/MONTHLY, mayor sin anualizar.
    """
    parsed = [(date.fromisoformat(point["date"]), float(point["value"])) for point in points
              if point["value"] > 0]
    volatility = weekly_sampling.window_volatility(parsed)
    if volatility is None:
        return None
    result = {}
    if volatility.get("annualized_volatility") is not None:
        result["annualized_volatility"] = volatility["annualized_volatility"]
        result["frequency"] = volatility["frequency"]

    span_days = (parsed[-1][0] - parsed[0][0]).days
    if (window_span_ok(span_days, nominal_days) and weekly_sampling.window_complete(volatility, nominal_days)
            and parsed[0][1] > 0):
        # Decision 6.3 (17-10-2026): misma base de anios (365,2425) y mismo Sharpe ex post
        # que el backtest y la cartera real (weekly_sampling).
        years = span_days / weekly_sampling.DAYS_PER_YEAR
        annualized_return = (parsed[-1][1] / parsed[0][1]) ** (1 / years) - 1
        rate = float(risk_free_rate or 0.0)
        result["annualized_return"] = round(annualized_return, 8)
        result["risk_free_rate"] = round(rate, 8)
        result["method"] = "GEOMETRIC_CAGR"
        sharpe = weekly_sampling.ex_post_sharpe(annualized_return, rate, result.get("annualized_volatility"))
        if sharpe is not None:
            result["sharpe_ratio"] = round(sharpe, 8)
    return result


def _annualization_for_gap(median_gap: int) -> tuple[int | None, str | None]:
    """Factor de anualizacion y frecuencia (metrics.v1.2) segun el hueco mediano
    en dias entre observaciones. A1: delega en weekly_sampling (diario y semanal
    se miden en semanal; mensual 12; mayor: None)."""
    return weekly_sampling.annualization_for_gap(median_gap)


def _max_drawdown(points: list[dict]) -> dict:
    peak = 0.0
    worst = 0.0
    worst_date = None
    for point in points:
        peak = max(peak, point["value"])
        drawdown = point["value"] / peak - 1.0 if peak else 0.0
        if drawdown < worst:
            worst = drawdown
            worst_date = point["date"]
    result = {"value": round(worst, 8)}
    if worst_date:
        result["date"] = worst_date
    return result


# Hueco maximo entre el cierre base del YTD y el 31-dic. Una serie mensual
# fechada a primero de mes (`1mo`) deja su ultimo punto del anio el 1-dic, con el
# cierre de diciembre; mas lejos, la serie tiene un hueco y esa base mediria
# varios anios, no el anio en curso.
YTD_BASE_MAX_GAP_DAYS = 45


def ytd_return(points: list[dict]) -> float | None:
    """Rentabilidad en lo que va de anio (fraccion) sobre puntos con `date`
    (date o ISO) y `value`.

    Base: el ultimo cierre con fecha <= 31-dic del anio anterior, como cualquier
    YTD publicado. Hasta el 14-10-2026 la base era el primer punto del anio: se
    perdia la primera sesion y, con historico mensual (`1mo`), todo enero. Si no
    hay cierre del anio anterior (la serie empieza este anio, o la politica de
    historico lo descarta) o queda a mas de YTD_BASE_MAX_GAP_DAYS del 31-dic, la
    base es el primer punto del anio, como antes. Es la unica implementacion: la
    usan las dos rutas de ingesta y, a traves de build_metrics_latest, el
    refresco diario."""
    dated = []
    for point in points or []:
        raw = point.get("date")
        try:
            day = raw if isinstance(raw, date) else date.fromisoformat(str(raw)[:10])
            value = float(point.get("value"))
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and value > 0:
            dated.append((day, value))
    if len(dated) < 2:
        return None
    dated.sort(key=lambda item: item[0])
    last_day, last_value = dated[-1]
    year_end = date(last_day.year - 1, 12, 31)
    prior = [item for item in dated if item[0] <= year_end]
    if prior and (year_end - prior[-1][0]).days <= YTD_BASE_MAX_GAP_DAYS:
        base = prior[-1][1]
    else:
        in_year = [item for item in dated if item[0] > year_end]
        if len(in_year) < 2:
            return None
        base = in_year[0][1]
    return round(last_value / base - 1.0, 8)


def _estr_window_resolver(start_iso: str, end_iso: str) -> dict:
    """Media €STR de la ventana, por la misma via que el optimizador. Import
    perezoso: deja el resolutor sustituible en pruebas sin tocar la red."""
    from ecb_rates import resolve_estr_window_average
    return resolve_estr_window_average(start_iso, end_iso)


def _window_risk_free(points: list[dict], resolver, *, window=None, warnings=None) -> float:
    """Media €STR de la ventana. Misma politica que el optimizador: si no hay
    resolutor o la tasa no es creible, 0 en vez de una tasa inventada. Con la €STR
    parcial (quinta pasada, I-2) se conserva la media y se anota en `warnings`."""
    if resolver is None or not points:
        return 0.0
    try:
        resolved = resolver(points[0]["date"], points[-1]["date"])
        rate = float(resolved["rate"])
        if not math.isfinite(rate) or not -0.20 <= rate <= 0.50:
            return 0.0
        warning = weekly_sampling.partial_risk_free_warning(
            resolved, window, points[0]["date"], points[-1]["date"])
        if warning is not None and warnings is not None:
            warnings.append(warning)
        return rate
    except Exception:
        swallowed_quiet("fund_ingest.py:_window_risk_free")
        return 0.0


def _metrics_doc(isin: str, points: list[dict], quote: dict, now: str,
                 risk_free_resolver=None, risk_free_warnings=None) -> dict:
    # R-04 (auditoria 29-09): los fondos con politica de historico
    # (fund_history_policies.json) se calculan SOLO sobre los puntos utilizables
    # y se firman como FUND_QUALITY_REVIEW_V1, la misma convencion que
    # ingest_asset.build_metrics_latest y metrics_refresh. Asi el mapper
    # (readmodel/mappers.map_quant_metrics) acepta el documento del alta sin
    # relajar su regla; la alternativa —aceptar cualquier `source` propio—
    # obligaba a fiarse de que TODOS los productores aplican la politica.
    # Un fondo bloqueado publica un documento sin ventanas: metricas honestas
    # (ninguna), nunca las del historico rechazado.
    from fund_history_quality import usable_documents, policy_for, METRICS_SOURCE as REVIEW_SOURCE
    source = METRICS_SOURCE
    if policy_for(isin):
        reviewed = usable_documents(isin, [{"points": points}])
        points = reviewed[0]["points"] if reviewed else []
        source = REVIEW_SOURCE
    srri = _number(quote.get("srri"))
    if not points:
        doc = {
            "asset_id": isin, "population": "fund", "source": source, "updated_at": now,
            "windows": {}, "observations_count": 0,
            "srri": int(srri) if srri is not None and 1 <= int(srri) <= 7 else None,
            "risk_score_source": "SRRI" if srri is not None and 1 <= int(srri) <= 7 else "VOL_BUCKET",
        }
        doc = _omit_none(doc)
        validate_contract(doc, "metrics.v1.3.schema.json")
        return doc
    last_date = date.fromisoformat(points[-1]["date"])
    windows = {}
    for label, years in (("1y", 1), ("3y", 3), ("5y", 5), ("10y", 10)):
        nominal_days = round(365.25 * years)
        cutoff = last_date - timedelta(days=nominal_days)
        selected = [point for point in points if date.fromisoformat(point["date"]) >= cutoff]
        rate = _window_risk_free(selected, risk_free_resolver, window=label, warnings=risk_free_warnings)
        metrics = _window_metrics(selected, rate, nominal_days=nominal_days)
        if metrics:
            windows[label] = metrics
    ytd = ytd_return(points)
    doc = {
        "asset_id": isin,
        "population": "fund",
        "source": source,
        "updated_at": now,
        "windows": windows,
        "ytd_return": ytd,
        "max_drawdown_hist": _max_drawdown(points),
        "max_drawdown_5y": _max_drawdown([
            point for point in points
            if date.fromisoformat(point["date"]) >= last_date - timedelta(days=round(365.25 * 5))
        ])["value"],
        "srri": int(srri) if srri is not None and 1 <= int(srri) <= 7 else None,
        "risk_score_source": "SRRI" if srri is not None and 1 <= int(srri) <= 7 else "VOL_BUCKET",
        "observations_count": len(points),
        "first_date": points[0]["date"],
        "last_date": points[-1]["date"],
    }
    doc = _omit_none(doc)
    validate_contract(doc, "metrics.v1.3.schema.json")
    return doc


def _history_documents(isin: str, sec_id: str, points: list[dict], metadata: dict, now: str) -> list[tuple[str, dict]]:
    documents = []
    for year, year_points in _group_by_year(points).items():
        prefix = metadata.get("document_prefix") or "MORNINGSTAR_%s" % sec_id.replace("/", "_")
        doc_id = "%s_%s" % (prefix, year)
        doc = {
            "schema_version": PRICE_SERIES_SCHEMA,
            "asset_id": isin,
            "asset_type": "FUND",
            "series_type": "NAV",
            "source": metadata.get("source") or "MORNINGSTAR",
            "source_price_id": metadata.get("source_price_id") or "MORNINGSTAR:%s:ACCUMULATION_NAV" % sec_id,
            "document_id": doc_id,
            "source_listing_id": metadata.get("source_listing_id"),
            "currency": "EUR",
            "source_currency": metadata.get("source_currency"),
            "fx_pair": metadata.get("fx_pair"),
            "fx_policy": metadata.get("fx_policy"),
            "minor_scale": metadata.get("minor_scale"),
            "instrument_type": "OPEN_END_FUND_ACCUMULATION",
            "metadata": metadata,
            "refresh": False,
            "interval": metadata.get("interval") or "1mo",
            "year": year,
            "points": year_points,
            "first_date": year_points[0]["date"],
            "last_date": year_points[-1]["date"],
            "observations_count": len(year_points),
            "history_quality_status": "COMPLETE"
            if len(points) >= (252 if (metadata.get("interval") or "1mo") == "1d" else 60)
            else "PARTIAL",
            "updated_at": now,
        }
        doc = _omit_none(doc)
        validate_contract(doc, "price-series.v1.2.schema.json")
        documents.append((doc_id, doc))
    return documents


def ingest_fund(
    isin: str,
    match: dict,
    db,
    *,
    with_history: bool,
    write: bool,
    price_match: dict | None = None,
) -> dict:
    ref = db.collection("assets").document(isin)
    snap = ref.get()
    exists = bool(snap.exists)
    if exists:
        current = snap.to_dict() if hasattr(snap, "to_dict") else None
        if isinstance(current, dict) and current.get("asset_type") not in (None, "FUND"):
            return {
                "asset_id": isin,
                "ok": False,
                "resolved": True,
                "error": "El ISIN ya existe con un tipo incompatible: %s" % current.get("asset_type"),
            }
        # Un fondo que ya esta en la maestra no se reingesta (13-10-2026). Esta
        # ruta solo sabe dar de alta: con el activo existente hacia `set` sobre
        # holdings/latest (cartera Morningstar encima de la del extractor, que
        # republish vuelve a poner), sobre los documentos anuales de
        # price_series y sobre metrics/latest, y reescribia su entrada de
        # meta/search_index desde una raiz que no se escribe. Cartera e indice
        # son de la plataforma; la serie se completa con history_backfill
        # (create-only) o se repara con price_history_sync; las metricas las
        # mantiene el refresco diario.
        return {
            "asset_id": isin,
            "ok": False,
            "applied": False,
            "preview": not write,
            "resolved": True,
            "asset_type": "FUND",
            "exists_in_master": True,
            "root_action": "SKIP_EXISTS",
            "error_code": "FUND_EXISTS",
            "error": "El fondo ya existe en la maestra: la ingesta solo da de alta. Su cartera e "
                     "indice los mantiene la plataforma; la serie, history_backfill (create-only); "
                     "las metricas, el refresco diario.",
        }

    blocks, fetch_warnings = fetch_fund_payload(match)
    root, holdings = build_fund_root(isin, match, blocks, fetch_warnings)

    quality = root["quality"]
    accepted = quality["status"] == "ACCEPTED"
    result = {
        "asset_id": isin,
        "ok": accepted,
        "applied": bool(write),
        "preview": not write,
        "resolved": True,
        "symbol": (price_match or {}).get("symbol") or match["sec_id"],
        "name": root["identity"]["name"],
        "asset_type": "FUND",
        "provider": "MORNINGSTAR + EODHD" if price_match else "MORNINGSTAR",
        "quality_status": quality["status"],
        "quality_score": 100 if accepted else 50,
        "quality_warnings": quality["warnings"],
        "exists_in_master": False,
        "root_action": "CREATE",
        "with_history": bool(with_history),
    }
    if not accepted:
        result["error"] = "La ficha no supera el control de calidad: %s" % ", ".join(quality["review_flags"])
        result["root_preview"] = root
        return result

    points = []
    history_meta = None
    metrics_doc = None
    history_docs = []
    if with_history:
        if price_match:
            points, history_meta = _daily_nav_eur(price_match, root)
        else:
            points, history_meta = _monthly_nav_eur(blocks, root)
            if points:
                history_meta.update({
                    "source": "MORNINGSTAR",
                    "interval": "1mo",
                    "source_price_id": "MORNINGSTAR:%s:ACCUMULATION_NAV" % match["sec_id"],
                    "document_prefix": "MORNINGSTAR_%s" % match["sec_id"].replace("/", "_"),
                })
        if points:
            now = _now()
            risk_free_warnings = []
            metrics_doc = _metrics_doc(isin, points, blocks.get("quote") or {}, now,
                                       risk_free_resolver=_estr_window_resolver,
                                       risk_free_warnings=risk_free_warnings)
            if risk_free_warnings:
                _metrics_logger.info("%s: RISK_FREE_RATE_PARTIAL_COVERAGE en %s", isin, ", ".join(
                    f"{w['window']} ({w['coverage_ratio']:.2f})" for w in risk_free_warnings))
            history_docs = _history_documents(isin, match["sec_id"], points, history_meta, now)
            result["history"] = {
                "loaded": True,
                "points": len(points),
                "first_date": points[0]["date"],
                "last_date": points[-1]["date"],
                "years": len(history_docs),
                "applied": bool(write),
                "interval": history_meta.get("interval") or "1mo",
                "representation": history_meta["representation"],
                "metrics": {
                    "available": bool(metrics_doc.get("windows")),
                    "windows": list(metrics_doc.get("windows", {}).keys()),
                    "observations_count": len(points),
                    "last_date": points[-1]["date"],
                    "applied": bool(write),
                },
            }
        else:
            result["history"] = {**(history_meta or {"loaded": False, "reason": "Historico no disponible."}), "applied": False}

    result["root_preview"] = root
    if not write:
        return result
    if with_history and not points:
        result["ok"] = False
        result["applied"] = False
        result["preview"] = True
        result["error"] = result["history"].get("error") or result["history"].get("reason")
        return result

    now = _now()
    batch = db.batch()
    batch.create(ref, root)
    result["root_written"] = True

    if holdings:
        holdings_doc = {
            "storage_mode": "SINGLE_DOCUMENT",
            "holdings_count": len(holdings),
            "top10_weight": root["holdings_summary"].get("top10_weight"),
            "as_of_date": root["holdings_summary"].get("as_of_date"),
            "holdings": holdings,
            "schema_version": HOLDINGS_SCHEMA,
            "updated_at": now,
        }
        validate_contract(holdings_doc, "holdings.v1.1.schema.json")
        batch.set(ref.collection("holdings").document("latest"), holdings_doc)
    for doc_id, doc in history_docs:
        batch.set(ref.collection("price_series").document(doc_id), doc)
    if metrics_doc:
        batch.set(ref.collection("metrics").document("latest"), metrics_doc)
    batch.commit()

    try:
        result["search_index_updated"] = upsert_search_index_entry(db, isin, root)
    except Exception as exc:
        result["search_index_updated"] = False
        result["search_index_warning"] = str(exc)[:200]
    result["metrics"] = result.get("history", {}).get("metrics")
    return result
