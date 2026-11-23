"""Fetcher de ACCIONES (tipo == "accion"), independiente del extractor de
fondos/ETF (Morningstar/CNMV/justETF).

Datos:
  1) Resuelve ISIN -> símbolo EODHD (/api/search), prefiriendo la bolsa del
     PAÍS del ISIN (p. ej. ES -> Madrid .MC, no Londres). Si el símbolo ya se
     sabe (corrección manual o ficha anterior) se usa ese directamente.
  2) Identidad + precio EOD desde EODHD (/api/eod).
  3) Fundamentales: solo Yahoo Finance vía yfinance (gratis, no oficial). Los de
     EODHD (/api/fundamentals) se dieron de baja el 17-10 y no se piden.

Token EODHD: env EODHD_API_TOKEN o config/secrets.json {"eodhd_api_token": "..."}.
Yahoo no necesita token (requiere: pip install yfinance).
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import csv
import io
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fetchers import cambios_bce, estr_bce
from core.adquisicion import procedencia
from core import indices
from core.metricas import (RF_TOLERANCIA_DIAS_HABILES, cierre_mensual, cobertura_rf, huecos_por_ventana,
                           metricas_diarias, relativas, sello_del_metodo)
from core.schema import set_path

log = logging.getLogger("fondosdb.eodhd")

BASE_URL = "https://eodhd.com/api"
_ESTR_CACHE: list[dict] | None = None
#: Marca en el cliente HTTP de la pasada: el BCE no ha dado el €STR en ella (ver `_serie_estr`).
_ESTR_FALLO = "_estr_eodhd_sin_respuesta"

# Código de bolsa EODHD -> sufijo de símbolo en Yahoo Finance.
_YF_SUFIJO = {
    "US": "", "NYSE": "", "NASDAQ": "", "AMEX": "", "BATS": "",
    "LSE": ".L", "XETRA": ".DE", "F": ".F", "STU": ".SG", "MU": ".MU", "BE": ".BE",
    "MC": ".MC", "PA": ".PA", "AS": ".AS", "BR": ".BR", "MI": ".MI", "LS": ".LS",
    "SW": ".SW", "VX": ".SW", "ST": ".ST", "HE": ".HE", "CO": ".CO", "OL": ".OL",
    "VI": ".VI", "IR": ".IR", "WAR": ".WA", "TO": ".TO", "V": ".V", "AU": ".AX",
    "HK": ".HK", "SHG": ".SS", "SHE": ".SZ", "NSE": ".NS", "BSE": ".BO", "TSE": ".T",
    "KO": ".KS", "KQ": ".KQ", "SA": ".SA", "MX": ".MX", "JSE": ".JO", "LIM": ".LM",
}
# Prefijo ISIN (país) -> nombre de país tal como lo devuelve EODHD.
_ISIN_PAIS = {
    "US": "USA", "ES": "Spain", "DE": "Germany", "FR": "France", "NL": "Netherlands",
    "IT": "Italy", "GB": "UK", "IE": "Ireland", "PT": "Portugal", "BE": "Belgium",
    "CH": "Switzerland", "SE": "Sweden", "FI": "Finland", "DK": "Denmark",
    "NO": "Norway", "AT": "Austria", "CA": "Canada", "AU": "Australia", "JP": "Japan",
}
# Cotizacion principal de una accion (decision 41). Esta tabla es el ULTIMO recurso de
# `mercado_de_origen`: antes van las excepciones con fuente y FIRDS.
# Tabla pequena y explicita a proposito. Solo los paises con bolsa de origen clara; los demas
# prefijos (IE, JE, BM, LU...) son paises de constitucion, no de cotizacion, y siguen el criterio de siempre.
_ORIGEN_POR_PAIS = {
    "US": ("US", "USD"), "GB": ("LSE", "GBX"), "NL": ("AS", "EUR"), "DE": ("XETRA", "EUR"),
    "FR": ("PA", "EUR"), "ES": ("MC", "EUR"), "IT": ("MI", "EUR"), "CH": ("SW", "CHF"),
    "BE": ("BR", "EUR"), "SE": ("ST", "SEK"), "DK": ("CO", "DKK"), "FI": ("HE", "EUR"),
    "AT": ("VI", "EUR"), "CA": ("TO", "CAD"),
}
#: Tabla de excepciones del mercado de origen: gana a FIRDS y al prefijo, y cada fila lleva su fuente.
RUTA_MERCADO_DE_ORIGEN = Path("config") / "mercado_de_origen.csv"
#: MIC del mercado regulado -> (bolsa de EODHD, divisa de esa bolsa).
_BOLSA_DEL_MIC = {
    "XMAD": ("MC", "EUR"), "XPAR": ("PA", "EUR"), "XAMS": ("AS", "EUR"), "XBRU": ("BR", "EUR"),
    "MTAA": ("MI", "EUR"), "XETA": ("XETRA", "EUR"), "FRAA": ("XETRA", "EUR"), "XHEL": ("HE", "EUR"),
    "XSTO": ("ST", "SEK"), "XCSE": ("CO", "DKK"), "XWBO": ("VI", "EUR"), "XLIS": ("LS", "EUR"),
    "XMSM": ("IR", "EUR"), "XOSL": ("OL", "NOK"),
}
#: Prefijos de ISIN en los que FIRDS puede ver el mercado de origen: el EEE y los domicilios de
#: conveniencia, cuya acción puede cotizar en casa en cualquier bolsa europea. Fuera quedan US, GB,
#: CH, CA, AU o JP: su bolsa no reporta a ESMA y lo que FIRDS ve de ellas son cotizaciones
#: secundarias. Medido el 08-11-2026: Shell, Unilever, Relx y Coca-Cola Europacific salen con
#: Ámsterdam, autoridad NL incluida, y su bolsa es Londres. Es lista positiva: lo que no se ha
#: pensado no afirma nada.
_PREFIJOS_QUE_FIRDS_VE = frozenset({
    "ES", "FR", "NL", "BE", "IT", "DE", "FI", "SE", "DK", "AT", "PT", "IE", "NO", "LU", "GR", "PL",
    "JE", "GG", "IM", "BM", "KY",
})
_MISMA_DIVISA = {"GBX": {"GBX", "GBP", "GBp"}}
# Bolsas regionales alemanas: ver `_elige_principal`, que acota cuando compiten.
_BOLSAS_REGIONALES = {"F", "STU", "DU", "HM", "MU", "HA", "BE", "IL"}
AVISO_MERCADO_NO_DISPONIBLE = "mercado_de_origen_no_disponible"
AVISO_DIVISA_NO_DISPONIBLE = "divisa_de_origen_no_disponible"


def _es_divisa_de_origen(divisa, origen: str) -> bool:
    return str(divisa or "") in _MISMA_DIVISA.get(origen, {origen})


def _tabla_de_origen(base: Path | None) -> dict[str, tuple[str, str]]:
    """ISIN -> (bolsa, divisa) de `config/mercado_de_origen.csv`. Sin fichero o sin base, vacia."""
    if base is None:
        return {}
    ruta = Path(base) / RUTA_MERCADO_DE_ORIGEN
    if not ruta.exists():
        return {}
    with ruta.open(encoding="utf-8-sig", newline="") as f:
        return {fila["isin"].strip().upper(): (fila["bolsa"].strip().upper(), fila["divisa"].strip())
                for fila in csv.DictReader(f)}


def mercado_de_origen(isin: str, base: Path | None = None) -> tuple[str, str] | None:
    """(bolsa, divisa) de la cotizacion principal del ISIN, o None si no se puede establecer.

    El prefijo del ISIN dice donde esta constituida la empresa, no donde cotiza: Chubb es CH y
    cotiza en Nueva York; Airbus es NL y cotiza en Paris. Por eso va al final:

    1. `config/mercado_de_origen.csv`, las excepciones conocidas, con fuente y fecha.
    2. FIRDS (`esma_firds.mercado_de_origen`), solo con prefijos que FIRDS puede ver
       (`_PREFIJOS_QUE_FIRDS_VE`).
    3. El prefijo del ISIN (`_ORIGEN_POR_PAIS`).

    Sin `base` no hay ni tabla ni indice: solo el prefijo."""
    isin = str(isin or "").strip().upper()
    origen = _tabla_de_origen(base).get(isin)
    if origen is not None:
        return origen
    if base is not None and isin[:2] in _PREFIJOS_QUE_FIRDS_VE:
        from fetchers import esma_firds
        origen = _BOLSA_DEL_MIC.get(esma_firds.mercado_de_origen(base, isin) or "")
        if origen is not None:
            return origen
    return _ORIGEN_POR_PAIS.get(isin[:2])


def aviso_de_cotizacion(isin: str, bolsa, divisa, base: Path | None = None) -> str | None:
    """Por que esta cotizacion no es la principal del ISIN, o None si lo es o no hay origen definido."""
    origen = mercado_de_origen(isin, base)
    if origen is None:
        return None
    if str(bolsa or "").upper() != origen[0]:
        return AVISO_MERCADO_NO_DISPONIBLE
    return None if _es_divisa_de_origen(divisa, origen[1]) else AVISO_DIVISA_NO_DISPONIBLE


def _sesiones_12m(serie: list[dict]) -> int:
    """Sesiones con negociacion efectiva en los 365 dias que acaban en el ultimo dato: con volumen y
    con un cierre distinto del anterior. Las lineas IOB de Londres traen volumen con el precio parado
    (0ROY.LSE, Campari: 96,8 % de cierres repetidos el 08-11-2026) y contarlas premiaria al eco."""
    if not serie:
        return 0
    desde = serie[-1]["date"] - timedelta(days=365)
    n, previo = 0, None
    for p in serie:
        raw = p.get("raw") or {}
        cierre = raw.get("close")
        if p["date"] >= desde and previo is not None and cierre != previo and (_num(raw.get("volume")) or 0) > 0:
            n += 1
        previo = cierre
    return n


def _elige_principal(isin: str, items: list[dict], http, token: str, force: bool,
                     base: Path | None = None) -> dict | None:
    """Decision 41: origen y divisa; si no, otra linea en esa divisa con mas sesiones a 12 meses (y a
    igualdad, la de historia mas larga); si no, el origen en otra divisa. None si nada de eso aplica.

    Una bolsa regional alemana solo compite si hay otra linea no regional en la divisa de origen o si
    no hay ninguna linea no regional: asi NXP (NASDAQ, con EUR solo en regionales) sigue en su mercado."""
    origen = mercado_de_origen(isin, base)
    if origen is None:
        return None
    del_isin =[it for it in items if str(it.get("ISIN") or "").upper() == isin.upper()] or list(items)
    acciones = [it for it in del_isin if "STOCK" in str(it.get("Type") or "").upper()] or del_isin

    def bolsa(it: dict) -> str:
        return str(it.get("Exchange") or "").upper()

    del_origen = [it for it in acciones if bolsa(it) == origen[0]]
    exactas = [it for it in del_origen if _es_divisa_de_origen(it.get("Currency"), origen[1])]
    if exactas:
        return exactas[0]
    en_divisa = [it for it in acciones if bolsa(it) != origen[0] and _es_divisa_de_origen(it.get("Currency"), origen[1])]
    no_regionales = [it for it in acciones if bolsa(it) not in _BOLSAS_REGIONALES]
    if en_divisa and (any(bolsa(it) not in _BOLSAS_REGIONALES for it in en_divisa) or not no_regionales):
        def rango(it: dict) -> tuple:
            serie = _serie_eod_ajustada(f"{it.get('Code')}.{it.get('Exchange')}", http, token, force)
            return (_sesiones_12m(serie), -serie[0]["date"].toordinal() if serie else float("-inf"))
        mejor = max(en_divisa, key=rango)
        no_reg = [it for it in en_divisa if bolsa(it) not in _BOLSAS_REGIONALES]
        if bolsa(mejor) in _BOLSAS_REGIONALES and no_reg:
            # Una regional solo desplaza a una linea no regional si la supera en un 10 %: entre 251 y 254
            # la diferencia es calendario de festivos, no liquidez; entre 8 y 135 (Campari) si lo es.
            otra = max(no_reg, key=rango)
            if rango(mejor)[0] < 1.1 * rango(otra)[0]:
                return otra
        return mejor
    return del_origen[0] if del_origen else None


_ETF_EXCHANGE_PRIORITY = {
    "XETRA": 90, "LSE": 85, "SW": 80, "VX": 80, "MI": 75, "PA": 70,
    "AS": 70, "MC": 65, "LS": 60, "BR": 55, "US": 40,
}


# --------------------------------------------------------------- token
def _token(base: Path | None) -> str | None:
    tok = os.environ.get("EODHD_API_TOKEN")
    if tok:
        return tok.strip() or None
    if base is not None:
        ruta = base / "config" / "secrets.json"
        if ruta.exists():
            try:
                # utf-8-sig: tolera el BOM que mete el Bloc de notas de Windows.
                return (json.loads(ruta.read_text(encoding="utf-8-sig"))
                        .get("eodhd_api_token") or "").strip() or None
            except Exception:
                pass
    return None


# --------------------------------------------------------------- helpers
def _num(v):
    try:
        if v in (None, "", "NA", "None"):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _texto(v):
    """Un texto de Yahoo o `None`. Yahoo entrega sector e industria como `""` en algunas
    italianas (Snam, Unipol y dos más, medido el 09-11-2026), y `set_path` solo descarta `None`:
    la cadena vacía llegaba a la ficha y la calidad contaba el sector como presente. Una cadena
    vacía, o de solo espacios, no es un sector. El texto que sí trae se deja tal cual, sin
    recortar: lo único que cambia es que el vacío pasa a faltar."""
    if v is None or not str(v).strip():
        return None
    return v


def _pct(v):
    n = _num(v)
    return round(n * 100, 4) if n is not None else None


def _finito(v) -> float | None:
    """`_num` que además rechaza NaN e infinito."""
    n = _num(v)
    return n if n is not None and math.isfinite(n) else None


# Yahoo y EODHD escriben la MISMA divisa de dos formas, y el canonico mezclaba las dos.
#
# Medido el 02-11-2026 en las cinco acciones de Londres del alcance: el canonico traia
# `currency` = "GBX" (de EODHD, la del listado) y `ms.stock.fundamentals.currency` = "GBp"
# (de Yahoo, la de los fundamentales). Dos convenios para el mismo instrumento, y el de
# Yahoo no cumple el patron `^[A-Z]{3}$` del contrato de dividendos, asi que la base nueva
# bloqueaba `declared/dividends` de las cinco: GB0005405286, GB0009895292, GB00B63H8491,
# GB00BDCPN049 y GB00BP6MXD84.
#
# Y el arreglo obvio es el equivocado: poner la divisa en mayusculas convierte "GBp" en
# "GBP", que NO es lo mismo. GBp y GBX son penique -la centesima parte de la libra- y GBP
# es la libra. Mayuscularlo multiplicaria por cien, en silencio y sin romper ningun
# contrato, que es la peor clase de error que puede tener un dato financiero. La misma
# trampa que el comentario de `_referencias_yield_pct` ya avisa para el yield.
#
# Asi que se traduce por tabla explicita y solo lo conocido, y lo que no se reconoce se
# deja tal cual: es mejor que la base lo bloquee a que pase mal.
_DIVISA_CANONICA = {
    "GBP": "GBP",      # libra
    "GBX": "GBX",      # penique, el que usa EODHD
    "GBp": "GBX",      # penique, como lo escribe Yahoo
    "ZAc": "ZAC",      # centimo sudafricano
    "ILA": "ILA",      # agorot
    "ILa": "ILA",
}


def _divisa_canonica(valor) -> str | None:
    """La divisa como la nombra el canonico, sin convertir un submultiplo en su unidad."""
    s = str(valor or "").strip()
    if not s:
        return None
    return _DIVISA_CANONICA.get(s, s)


def _referencias_yield_pct(info: dict) -> list[float]:
    """Estimaciones del yield, en porcentaje, de campos de Yahoo de unidad fija.

    - dividendRate / precio: solo si la divisa del dividendo (`financialCurrency`)
      y la del precio (`currency`) se conocen y coinciden. Una acción que cotiza
      en EUR y reparte en SEK, NOK, JPY, CZK o ZAR da un cociente 10 veces o más
      desviado, y una de Londres (precio en GBp, dividendo en GBP) 100 veces.
    - trailingAnnualDividendYield (fracción): Yahoo lo calcula con el mismo
      cociente, así que se descarta si esas divisas se sabe que no coinciden.
    - fiveYearAvgDividendYield: siempre en porcentaje."""
    refs = []
    div_dividendo = info.get("financialCurrency")
    div_precio = info.get("currency")
    mismas = bool(div_dividendo) and bool(div_precio) and div_dividendo == div_precio
    distintas = bool(div_dividendo) and bool(div_precio) and div_dividendo != div_precio
    precio = (_finito(info.get("currentPrice")) or _finito(info.get("regularMarketPrice"))
              or _finito(info.get("previousClose")))
    tasa = _finito(info.get("dividendRate"))
    if mismas and tasa and precio and tasa > 0 and precio > 0:
        refs.append(tasa / precio * 100)
    trailing = _finito(info.get("trailingAnnualDividendYield"))
    if not distintas and trailing and trailing > 0:
        refs.append(trailing * 100)
    media_5a = _finito(info.get("fiveYearAvgDividendYield"))
    if media_5a and media_5a > 0:
        refs.append(media_5a)
    return refs


def _yield_dividendo_yahoo_pct(info: dict) -> float | None:
    """`fundamentales.dividend_yield_pct` desde el `info` de Yahoo, en PORCENTAJE.

    El canónico lo quiere en porcentaje (2.38 = 2,38 %): EODHD lo da como
    fracción y se pasa con `_pct`, y la app lo divide entre 100
    (`readmodel/mappers.py::_legacy_pct_to_ratio`). Yahoo ha servido
    `dividendYield` como fracción (0.0238) hasta 2025 y como porcentaje (2.38)
    desde yfinance 0.2.54; la versión fijada en requirements.txt da porcentaje.

    Regla: se toma como porcentaje y solo se multiplica por 100 si TODAS las
    referencias disponibles (`_referencias_yield_pct`) están más cerca, en
    escala logarítmica, de la lectura como fracción. Una referencia discordante,
    o ninguna, deja el valor como viene. NaN, infinito y negativos no se publican."""
    v = _finito(info.get("dividendYield"))
    if v is None or v < 0:
        return None
    if v == 0:
        return 0.0
    refs = _referencias_yield_pct(info)

    def es_fraccion(ref: float) -> bool:
        return abs(math.log(ref / (v * 100))) < abs(math.log(ref / v))
    if refs and all(es_fraccion(r) for r in refs):
        return round(v * 100, 4)
    return round(v, 4)


def _redondea(v, ndigits: int = 4):
    if v is None or not math.isfinite(v):
        return None
    return round(v, ndigits)


def _fecha_epoca(v) -> str | None:
    """Época en segundos de Yahoo (`exDividendDate`, `mostRecentQuarter`) -> fecha ISO."""
    n = _finito(v)
    if n is None or n <= 0:
        return None
    try:
        return datetime.fromtimestamp(n, timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _por_cien(v) -> float | None:
    """Fracción de Yahoo -> porcentaje, como lo daba EODHD (`PercentInsiders`)."""
    n = _finito(v)
    return round(n * 100, 4) if n is not None else None


def _entero(v) -> int | None:
    n = _finito(v)
    return int(n) if n is not None else None


ESQUEMA_RESUMEN = "bdb.fundamentals-summary.v1"
# Resumen de fundamentales que leen la app (`readmodel/mappers.py`,
# `map_fundamentals_summary`) y la plataforma, con los nombres y las unidades
# del que daba EODHD en julio: márgenes, rentabilidades, crecimientos y
# `payout_ratio` en fracción; participaciones en porcentaje. Ruta bajo
# `fundamentales` -> (clave del `info` de Yahoo, conversión). Lo que Yahoo no
# tiene (clasificación GICS, estimaciones de BPA por ejercicio) no se inventa.
RESUMEN_YAHOO: tuple[tuple[str, str, object], ...] = (
    ("profile.sector", "sector", str), ("profile.industry", "industry", str),
    ("profile.employees", "fullTimeEmployees", _entero),
    ("valuation.market_cap", "marketCap", _finito),
    ("valuation.enterprise_value", "enterpriseValue", _finito),
    ("valuation.pe_trailing", "trailingPE", _finito), ("valuation.pe_forward", "forwardPE", _finito),
    ("valuation.peg", "trailingPegRatio", _finito),
    ("valuation.price_sales_ttm", "priceToSalesTrailing12Months", _finito),
    ("valuation.price_book_mrq", "priceToBook", _finito),
    ("valuation.ev_revenue", "enterpriseToRevenue", _finito),
    ("valuation.ev_ebitda", "enterpriseToEbitda", _finito),
    ("profitability.profit_margin", "profitMargins", _finito),
    ("profitability.operating_margin_ttm", "operatingMargins", _finito),
    ("profitability.return_on_assets_ttm", "returnOnAssets", _finito),
    ("profitability.return_on_equity_ttm", "returnOnEquity", _finito),
    ("growth.quarterly_revenue_yoy", "revenueGrowth", _finito),
    ("growth.quarterly_earnings_yoy", "earningsQuarterlyGrowth", _finito),
    ("per_share.eps", "trailingEps", _finito), ("per_share.book_value", "bookValue", _finito),
    ("per_share.revenue_ttm", "revenuePerShare", _finito),
    ("per_share.dividend", "trailingAnnualDividendRate", _finito),
    ("capital.shares_outstanding", "sharesOutstanding", _finito),
    ("capital.shares_float", "floatShares", _finito),
    ("capital.insiders_ratio", "heldPercentInsiders", _por_cien),
    ("capital.institutions_ratio", "heldPercentInstitutions", _por_cien),
    ("dividends.forward_annual_rate", "dividendRate", _finito),
    ("dividends.payout_ratio", "payoutRatio", _finito),
    ("dividends.ex_dividend_date", "exDividendDate", _fecha_epoca),
    ("analyst.target_price", "targetMeanPrice", _finito),
    ("technicals.beta", "beta", _finito),
    ("technicals.high_52w", "fiftyTwoWeekHigh", _finito),
    ("technicals.low_52w", "fiftyTwoWeekLow", _finito),
    ("technicals.moving_average_50d", "fiftyDayAverage", _finito),
    ("technicals.moving_average_200d", "twoHundredDayAverage", _finito),
)


def _resumen_fundamentales_yahoo(out: dict, info: dict, sym: str) -> None:
    """El resumen de fundamentales, su origen, su fecha y su cobertura, desde Yahoo.

    Desde el 17-10 los fundamentales de las acciones salen solo de Yahoo: Óscar
    dio de baja los de EODHD, que además respondían 403, y EODHD queda para el
    símbolo y las cotizaciones. Las fichas traen de julio el resumen
    `bdb.fundamentals-summary.v1` de EODHD y nadie lo volvía a escribir: cada
    `update` lo perdía (medido el 17-10), y con él lo que enseña la app.

    Yahoo (yfinance) no es una fuente oficial ni licenciada: se avisa con
    `unofficial_source:yahoo`. La cobertura es la fracción de `RESUMEN_YAHOO`
    con dato (COMPLETE solo si están todos). `as_of_date` es el último
    trimestre publicado, como en EODHD."""
    rellenos = 0
    for ruta, clave, convierte in RESUMEN_YAHOO:
        valor = info.get(clave)
        valor = convierte(valor) if valor not in (None, "") else None
        if valor is not None:
            set_path(out, f"fundamentales.{ruta}", valor)
            rellenos += 1
    pct = _yield_dividendo_yahoo_pct(info)
    set_path(out, "fundamentales.dividends.yield_ratio", round(pct / 100, 6) if pct is not None else None)
    set_path(out, "fundamentales.schema_version", ESQUEMA_RESUMEN)
    set_path(out, "fundamentales.instrument_type", "STOCK")
    set_path(out, "fundamentales.symbol", sym)
    set_path(out, "fundamentales.currency", _divisa_canonica(info.get("currency")))
    set_path(out, "fundamentales.as_of_date", _fecha_epoca(info.get("mostRecentQuarter")))
    set_path(out, "fundamentales.source", "yahoo")
    set_path(out, "fundamentales.fetched_at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    ratio = round(rellenos / len(RESUMEN_YAHOO), 4)
    set_path(out, "fundamentales.quality.coverage_ratio", ratio)
    set_path(out, "fundamentales.quality.coverage_status", "COMPLETE" if ratio == 1 else "PARTIAL")
    set_path(out, "fundamentales.quality.warnings", ["unofficial_source:yahoo"])


def _fecha(v) -> date | None:
    if not v:
        return None
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _serie_eod_ajustada(simbolo: str, http, token: str, force: bool) -> list[dict]:
    """Serie EOD diaria ascendente, usando adjusted_close como precio base."""
    r = http.get(f"{BASE_URL}/eod/{simbolo}",
                 params={"api_token": token, "fmt": "json", "period": "d", "order": "a"},
                 ttl_dias=0.5, force=force)
    if not getattr(r, "ok", False):
        return []
    try:
        raw = r.json() or []
    except Exception:
        return []
    serie = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        f = _fecha(item.get("date"))
        px = _num(item.get("adjusted_close"))
        if px is None:
            px = _num(item.get("close"))
        if f and px and px > 0:
            serie.append({"date": f, "price": px, "raw": item})
    serie.sort(key=lambda x: x["date"])
    return serie


def _serie_estr(http) -> list[dict]:
    """Historico diario €STR del BCE, en porcentaje. Cache en memoria + cache HTTP.

    La petición y su TTL son los de `estr_bce.pide`, los mismos que el export: hasta el
    09-11-2026 aquí se leía con 7 días y la pasada promediaba un €STR más corto que la
    ventana de sus precios."""
    global _ESTR_CACHE
    if _ESTR_CACHE is not None:
        return _ESTR_CACHE
    # EXT-10 (auditoría del 16-11-2026): un fallo del BCE no se recuerda en el módulo. Antes se guardaba la lista
    # vacía y todas las acciones del proceso —la consola puede vivir días— se quedaban sin tipo sin riesgo, y sin
    # Sharpe, hasta reiniciarlo. Ahora el fallo vale para ESTA pasada, que es un cliente HTTP: no se le pregunta
    # al BCE una vez por acción, y la pasada siguiente vuelve a intentarlo.
    if getattr(http, _ESTR_FALLO, False):
        return []
    out = []
    try:
        r = estr_bce.pide(http)
        if not getattr(r, "ok", False):
            log.warning("ECB €STR sin datos (status=%s)", getattr(r, "status", "?"))
        else:
            for row in csv.DictReader(io.StringIO(r.text)):
                f = _fecha(row.get("TIME_PERIOD"))
                v = _num(row.get("OBS_VALUE"))
                if f and v is not None:
                    out.append({"date": f, "value_pct": v})
    except Exception as e:
        log.warning("ECB €STR: %s", e)
        out = []
    if not out:
        try:
            setattr(http, _ESTR_FALLO, True)
        except AttributeError:
            pass
        return []
    out.sort(key=lambda x: x["date"])
    _ESTR_CACHE = out
    return _ESTR_CACHE


def _estado_historial(serie: list[dict], metricas: dict) -> str:
    completas = all(
        metricas.get(plazo)
        and metricas[plazo].get("rent_anualizada") is not None
        and metricas[plazo].get("volatilidad") is not None
        and metricas[plazo].get("sharpe") is not None
        for plazo in ("1a", "3a", "5a")
    )
    if completas:
        return "COMPLETE"
    return "PARTIAL" if serie else "MISSING"


def _aplica_trazabilidad_historico(out: dict, serie: list[dict], metricas: dict,
                                   source_history: str,
                                   source_listing_id: str | None) -> None:
    if not serie:
        set_path(out, "riesgo.historial_precios.history_quality_status", "MISSING")
        return
    set_path(out, "riesgo.historial_precios.source_history", source_history)
    set_path(out, "riesgo.historial_precios.source_listing_id", source_listing_id)
    set_path(out, "riesgo.historial_precios.first_date", serie[0]["date"].isoformat())
    set_path(out, "riesgo.historial_precios.last_date", serie[-1]["date"].isoformat())
    set_path(out, "riesgo.historial_precios.observations_count", len(serie))
    # Compatibilidad con consumidores locales existentes.
    set_path(out, "riesgo.historial_precios.fecha_inicio", serie[0]["date"].isoformat())
    set_path(out, "riesgo.historial_precios.fecha_fin", serie[-1]["date"].isoformat())
    set_path(out, "riesgo.historial_precios.observaciones", len(serie))
    set_path(out, "riesgo.historial_precios.history_quality_status",
             _estado_historial(serie, metricas))


#: Qué se publica de cada ventana de `metricas_diarias`, y en qué ruta del canónico.
#:
#: Es una tabla y no cinco llamadas seguidas porque de aquí salen las métricas del
#: catálogo entero y van a crecer: añadir el Sortino, el Calmar o la captura alcista es
#: añadir una fila, no tocar el bucle ni acordarse de cinco sitios. Lo caro de este
#: fichero nunca fue calcular; fue publicar lo calculado.
#:
#: `max_drawdown` entró el 02-11-2026 y es el caso que lo justifica: se calculaba en las
#: tres ventanas desde el principio y solo se publicaba UNA —la mejor disponible— en
#: `riesgo.max_drawdown.pct`. Medido sobre la base: 915 de 939 instrumentos tenían caída
#: máxima, 625 a tres años y 290 a cinco, y ninguno a uno. El cálculo estaba hecho y se
#: tiraba.
METRICAS_POR_VENTANA = (
    ("rent_anualizada", lambda plazo, rent: f"rentabilidad.trailing_pct.{rent}.fondo"),
    ("volatilidad", lambda plazo, rent: f"riesgo.volatilidad_pct.{plazo}.fondo"),
    ("rf_pct", lambda plazo, rent: f"riesgo.rf_pct.{plazo}.fondo"),
    ("sharpe", lambda plazo, rent: f"riesgo.sharpe.{plazo}.fondo"),
    ("max_drawdown", lambda plazo, rent: f"riesgo.max_drawdown_pct.{plazo}.fondo"),
)


def _aplica_referencia(out: dict, puntos: list, listing: str | None, http,
                       base: Path | None) -> None:
    """Beta y R² de una acción contra la referencia de donde cotiza, a 3 y 5 años.

    Solo esas dos (decisión 24). Solo 4 de 86 acciones americanas tenían un alfa a 3 años
    distinguible de cero, y tracking error e información tienen el problema del Sharpe. A un
    año son 12 observaciones. Es mensual aunque el resto de la acción sea diario: la beta
    con cierres de distinta hora saldría por debajo de la real.
    """
    simbolo = (listing or "").split(":", 1)[-1]
    referencia = indices.referencia_de_accion(simbolo, base)
    if referencia is None:
        # Sin fila en `indices_de_accion.csv` nadie ha decidido su referencia. Decision 40: la ficha
        # lo dice, para que un hueco no parezca una historia corta (13 acciones callaban el 08-11-2026).
        if base is not None and "." in simbolo:
            set_path(out, "riesgo.relativas.aviso",
                     f"sin_relativas_bolsa_sin_referencia({simbolo.rsplit('.', 1)[-1].strip().upper()})")
        return
    if referencia["fila"] is None:
        set_path(out, "riesgo.relativas.aviso", f"sin_referencia_de_mercado({referencia['bolsa']})")
        return
    from fetchers import vl_fondos
    fila = referencia["fila"]
    indice = vl_fondos._serie_del_proxy(fila, http, _token(base), False, base)
    # Versión 4 (MET-6): al último cierre de mes de la acción, como un fondo, y si su referencia
    # no llega a él, no se dan. Sin `fin`, el mes del último dato quedaba fuera aunque estuviera
    # cerrado, y un índice atrasado hacía cerrar la beta un mes antes sin decirlo.
    rel = relativas(puntos, indice, fila["base"], fin=cierre_mensual(puntos)) if indice else {}
    if "sin_cierre_comun" in rel:
        set_path(out, "riesgo.relativas.aviso", f"sin_relativas_indice_sin_cierre({rel['sin_cierre_comun']})")
        return
    ventanas = {v: rel[v] for v in ("3a", "5a") if rel.get(v, {}).get("beta") is not None}
    if not ventanas:
        return
    set_path(out, "riesgo.relativas.indice_nombre", fila["benchmark"])
    set_path(out, "riesgo.relativas.indice_variante", fila["variante"])
    set_path(out, "riesgo.relativas.indice_proxy", fila["proxy"])
    set_path(out, "riesgo.relativas.indice_clase_de_serie", fila["clase_de_serie"])
    set_path(out, "riesgo.relativas.base_indice", rel.get("base_indice"))
    set_path(out, "riesgo.relativas.fecha_dato", rel.get("fecha"))
    set_path(out, "riesgo.relativas.alcance", referencia["alcance"])
    for ventana, datos in ventanas.items():
        set_path(out, f"riesgo.relativas.beta.{ventana}", datos["beta"])
        set_path(out, f"riesgo.relativas.r2.{ventana}", datos.get("r2"))


def _aplica_metricas_historicas(out: dict, serie: list[dict], http,
                                source_history: str,
                                source_listing_id: str | None,
                                divisa: str | None = None,
                                base: Path | None = None) -> None:
    """Métricas de 1, 3 y 5 años sobre la serie del listado, en `divisa`.

    Metodo V2 (decision 10): la serie se lleva a euros antes de calcular, asi que el €STR se
    resta a una rentabilidad en su misma divisa. Sin divisa o sin cambio no se calcula: solo
    queda la traza del historico."""
    if not serie:
        return
    estr = _serie_estr(http)
    # El metodo toma la serie en la forma de `core.metricas` —(fecha, precio)—,
    # que es la unica que ese modulo entiende. Mismos puntos y mismo orden: la
    # serie ya viene ascendente de `_serie_eod_ajustada`.
    puntos = cambios_bce.serie_en_euros([(p["date"], p["price"]) for p in serie], divisa, http)
    estr_puntos = [(p["date"], p["value_pct"]) for p in estr]
    # Divisa de la serie tal como la da la fuente: si no se conoce, no se escribe
    # (nada de suponer EUR).
    set_path(out, "riesgo.historial_precios.divisa", divisa or None)
    if not puntos:
        set_path(out, "riesgo.historial_precios.aviso_metricas", "sin_metricas_sin_cambio")
        _aplica_trazabilidad_historico(out, serie, {}, source_history, source_listing_id)
        return
    set_path(out, "riesgo.historial_precios.divisa_metricas", "EUR")
    # La versión del método con que se calcula (A-158): sin este sello la plataforma no puede
    # distinguir una cifra de la versión 3 de una anterior, y las etiqueta como anteriores.
    set_path(out, "riesgo.historial_precios.metodo", sello_del_metodo(
        "rentabilidades diarias, en euros, volatilidad anualizada con las observaciones de la ventana"))
    if divisa != "EUR":
        set_path(out, "riesgo.historial_precios.divisa_origen", divisa)
        set_path(out, "riesgo.historial_precios.fx_source", cambios_bce.FUENTE)
    fecha_fin = serie[-1]["date"].isoformat()
    set_path(out, "rentabilidad.fecha_dato", fecha_fin)
    set_path(out, "riesgo.fecha_dato", fecha_fin)
    metricas = {}
    for anos, plazo, clave_rent in (
        (1, "1a", "1a"),
        (3, "3a", "3a_anualizada"),
        (5, "5a", "5a_anualizada"),
    ):
        m = metricas_diarias(puntos, anos, estr_puntos)
        metricas[plazo] = m
        if not m:
            continue
        for clave, ruta in METRICAS_POR_VENTANA:
            set_path(out, ruta(plazo, clave_rent), m[clave])
    huecos = huecos_por_ventana(puntos, puntos[-1][0], diario=True)
    if huecos:
        set_path(out, "riesgo.historial_precios.huecos", huecos)
    con_sharpe = any(m and m.get("rf_pct") is not None for m in metricas.values())
    # Hasta qué día llega el €STR de la media (las tres ventanas acaban el mismo día, así
    # que es uno solo): sin él, un re-mapeo no sabe con qué copia del BCE se calculó.
    cobertura = cobertura_rf(estr_puntos, puntos[-1][0]) if any(metricas.values()) else None
    if con_sharpe:
        # Solo si algún Sharpe se calculó de verdad contra el €STR.
        set_path(out, "riesgo.historial_precios.rf_referencia", "ESTR_EUR")
        if cobertura:
            set_path(out, "riesgo.historial_precios.rf_hasta", cobertura["rf_hasta"])
    if cobertura and cobertura["incompleto"] and (con_sharpe or cobertura["sharpe_suprimido"]):
        # Un retraso de hasta 7 días se marca y no se suprime (decisión del 09-11-2026); uno mayor
        # deja la última noche sin tipo y sin Sharpe, como el mensual (C-28, 21-11-2026). En los dos
        # casos se dice, para que un Sharpe que falta no se lea como una serie corta.
        log.warning("€STR hasta %s para una ventana que acaba el %s (%s días hábiles)%s",
                    cobertura["rf_hasta"], cobertura["fin_ventana"],
                    cobertura["dias_habiles_sin_estr"],
                    ": sin Sharpe" if cobertura["sharpe_suprimido"] else "")
        set_path(out, "riesgo.historial_precios.rf_incompleto", {
            "rf_hasta": cobertura["rf_hasta"],
            "fin_ventana": cobertura["fin_ventana"],
            "dias_habiles_sin_estr": cobertura["dias_habiles_sin_estr"],
            "tolerancia_dias_habiles": RF_TOLERANCIA_DIAS_HABILES,
            "sharpe_suprimido": cobertura["sharpe_suprimido"],
        })
    # El escalar de siempre se conserva: lo leen consumidores que no saben de ventanas.
    # Lo nuevo es `riesgo.max_drawdown_pct.{plazo}.fondo`, en paralelo a volatilidad y
    # sharpe, que es la forma que la plataforma ya sabe mapear.
    dd_metric = metricas.get("5a") or metricas.get("3a") or metricas.get("1a")
    if dd_metric:
        set_path(out, "riesgo.max_drawdown.pct", dd_metric["max_drawdown"])
        set_path(out, "riesgo.max_drawdown.periodo", "5a" if metricas.get("5a") else "inferior_5a")
    _aplica_trazabilidad_historico(out, serie, metricas, source_history, source_listing_id)
    _aplica_referencia(out, puntos, source_listing_id, http, base)


def _tipo_desde_eodhd(t: str | None) -> str:
    u = (t or "").upper()
    if "ETF" in u:
        return "etf"
    if "INDEX" in u or "INDX" in u:
        return "indice"
    if "FUND" in u:
        return "fondo"
    return "accion"


def busca_con_motivo(consulta: str, http, token: str, force: bool) -> tuple[list[dict], bool]:
    """Como `_busca`, pero diciendo ADEMAS si el proveedor contesto.

    Existe porque `_busca` funde tres resultados muy distintos en una lista vacia: una
    excepcion de red (o un `SinCache` en modo sin red), un estado que no es 2xx, y una
    respuesta correcta que no trae resultados. **Solo el tercero prueba que el instrumento
    no existe**; los otros dos significan que no se sabe.

    Y la diferencia no es academica: `core.adquisicion.disponibilidad` necesita justo esa
    distincion para no marcar como difunto lo que solo esta incomunicado. Sin ella, una
    tarde sin red marcaria medio catalogo.

    Devuelve `(resultados, proveedor_contesto)`.
    """
    try:
        r = http.get(f"{BASE_URL}/search/{consulta}",
                     params={"api_token": token, "fmt": "json"},
                     ttl_dias=30, force=force)
    except Exception as e:
        log.warning("EODHD search %s: %s", consulta, e)
        procedencia.contesto(False)
        return [], False          # no contesto: no se sabe nada del instrumento
    if not getattr(r, "ok", False):
        log.info("EODHD search %s sin resultado (status=%s)", consulta, getattr(r, "status", "?"))
        procedencia.contesto(False)
        return [], False          # contesto con error: tampoco afirma nada
    try:
        items = r.json() or []
    except Exception:
        procedencia.contesto(False)
        return [], False          # contesto algo que no se puede leer: no afirma nada
    buenos = [it for it in items if isinstance(it, dict)] if isinstance(items, list) else []
    # Aqui si contesto, y una lista vacia es una respuesta: el proveedor no lo tiene.
    procedencia.contesto(True)
    return buenos, True


def _busca(consulta: str, http, token: str, force: bool) -> list[dict]:
    """Resultados de /api/search para un ISIN o un codigo; [] si no hay o falla.

    Se conserva con la misma firma para los llamadores de siempre, a los que no les hace
    falta saber por que viene vacia. Quien lo necesite usa `busca_con_motivo`.
    """
    return busca_con_motivo(consulta, http, token, force)[0]


def _resuelve_simbolo(isin: str, http, token: str, force: bool,
                      tipo_preferido: str = "accion", base: Path | None = None) -> dict | None:
    """Mejor match de /api/search: prefiere la bolsa del país del ISIN."""
    items = _busca(isin, http, token, force)
    if not items:
        return None
    if tipo_preferido != "etf":
        principal = _elige_principal(isin, items, http, token, force, base)
        if principal is not None:
            return principal
    pais_local = _ISIN_PAIS.get(isin[:2].upper())

    def score(it: dict) -> tuple:
        tipo = str(it.get("Type") or "").upper()
        exch = str(it.get("Exchange") or "").upper()
        pais_ok = 1 if pais_local and str(it.get("Country") or "") == pais_local else 0
        isin_ok = 1 if str(it.get("ISIN") or "").upper() == isin.upper() else 0
        if tipo_preferido == "etf":
            tipo_ok = 1 if "ETF" in tipo or "ETC" in tipo else 0
            mercado = _ETF_EXCHANGE_PRIORITY.get(exch, 0)
            # Mejor la cotizacion en euros: convertir otra mete el desfase entre el cambio del
            # BCE y el cierre. Medido el 04-11-2026 en un ETF de Europa con dos cotizaciones:
            # R2 mediano del 85 % contra sus fondos en Paris y del 80 % en Suiza.
            en_euros = 1 if str(it.get("Currency") or "").upper() == "EUR" else 0
            return (isin_ok, tipo_ok, en_euros, mercado, pais_ok)
        stock_ok = 1 if "STOCK" in tipo else 0
        return (pais_ok, isin_ok, stock_ok)

    items.sort(key=score, reverse=True)
    return items[0]


# ------------------------------------------------------ símbolo conocido
RUTA_SIMBOLO = "identificacion.simbolo_eodhd"


def _simbolo_valido(v) -> str | None:
    """`AENA.MC` -> `AENA.MC`; sin código o sin bolsa, None."""
    s = str(v or "").strip()
    code, _, exch = s.rpartition(".")
    return s if code and exch else None


def simbolo_conocido(isin: str, anterior: dict | None, base: Path | None) -> str | None:
    """Símbolo EODHD que ya se sabe del activo, para no depender de /api/search.

    Gana una corrección manual de `identificacion.simbolo_eodhd`
    (config/correcciones.json); si no la hay, el de la ficha anterior. Una
    corrección a null dice que el activo no tiene código EODHD: entonces
    tampoco vale el de la ficha anterior.

    Hace falta porque la búsqueda por ISIN no encuentra algunos valores que
    EODHD sí cotiza: TSK salió a bolsa el 13-05-2026, y AENA (ES0105046009) se
    escribió aquí el 17-10 como si EODHD la tuviera con un ISIN viejo. Era al
    revés: `ES0105046017` es el nuevo, el que FIRDS admite en XMAD el 19-06-2025,
    y el que se quedó atrás es `ES0105046009` (ver `sucesor_de`, 07-11-2026). Sin esto
    caían a Yahoo y la plataforma fabricaba códigos EODHD falsos con la bolsa
    de Yahoo (AENA.MCE; auditoría 16-10, CRIT-10 y decisión 6.4)."""
    if base is not None:
        from core import correcciones
        try:
            rutas = correcciones.carga(base).get(str(isin).strip().upper()) or {}
        except correcciones.ErrorCorreccion:
            rutas = {}  # el núcleo deja el error en meta.errores al aplicarlas
        if RUTA_SIMBOLO in rutas:
            c = rutas[RUTA_SIMBOLO]
            return _simbolo_valido(c.get("valor") if isinstance(c, dict) else None)
    ident = (anterior or {}).get("identificacion") or {}
    return _simbolo_valido(ident.get("simbolo_eodhd") if isinstance(ident, dict) else None)


def _match_simbolo(simbolo: str, isin: str, http, token: str, force: bool) -> dict:
    """Identidad del listado `simbolo` con la forma de un resultado de /api/search.

    Primero la búsqueda por ISIN de siempre, si alguno de sus resultados es ese
    listado (así el nombre y la divisa son los de hasta ahora); si no, la
    búsqueda por código. Sin ninguna de las dos, solo código y bolsa."""
    code, _, exch = simbolo.rpartition(".")

    def es_el(it: dict) -> bool:
        return (str(it.get("Code") or "").upper() == code.upper()
                and str(it.get("Exchange") or "").upper() == exch.upper())

    for consulta in (isin, code):
        candidatos = [it for it in _busca(consulta, http, token, force) if es_el(it)]
        if candidatos:
            candidatos.sort(key=lambda it: str(it.get("ISIN") or "").upper() == isin.upper(),
                            reverse=True)
            elegido = candidatos[0]
            if elegido.get("ISIN") and str(elegido["ISIN"]).upper() != isin.upper():
                log.info("EODHD %s: el listado conocido %s figura con el ISIN %s",
                         isin, simbolo, elegido["ISIN"])
            return {**elegido, "Code": code, "Exchange": exch}
    log.info("EODHD %s: sin identidad para %s en /api/search; solo código y bolsa", isin, simbolo)
    return {"Code": code, "Exchange": exch}


def sucesor_de(isin: str, isin_del_listado: str | None, base: Path | None) -> str | None:
    """El ISIN que ha sustituido a `isin`, si el listado que se le conocía es ya de ese otro.

    Decisión 1 de `DECISIONES_DATOS_2026-11-07.md`. Aena cambió de ISIN, `ES0105046009` →
    `ES0105046017` (FIRDS admite el nuevo en XMAD el 19-06-2025), y el viejo seguía «cotiza»
    porque una corrección le fija `AENA.MC`, que EODHD da con el ISIN nuevo, mientras su
    búsqueda por el viejo contesta `[]`.

    Hacen falta **dos fuentes que coincidan**, porque con una sola esto derribaría acciones
    vivas. Que EODHD dé el listado con otro ISIN no basta: Árima (`ES0105376059`) cotiza como
    `ARM.MC` y EODHD le pone `ES0105376000`, y Prisa (`ES01717430J3`) sale con `ES0171743901`.
    Lo que separa una sustitución de un ISIN mal puesto es FIRDS, la referencia oficial de lo
    que se negocia en la UE: conoce el otro ISIN **y no conoce este**. En Árima y Prisa conoce
    los dos. Medido el 07-11-2026 sobre las siete correcciones de símbolo: solo Aena cumple.

    Sin índice FIRDS, `None`: la ausencia de un índice no prueba nada.
    """
    otro = str(isin_del_listado or "").strip().upper()
    este = str(isin or "").strip().upper()
    if not otro or otro == este:
        return None
    from fetchers import esma_firds
    sabe = esma_firds.conoce(base, [este, otro])
    if not sabe or sabe.get(este) or not sabe.get(otro):
        return None
    return otro


def listado_de_etf(isin: str, http, token: str, force: bool,
                   simbolo: str | None = None) -> dict | None:
    """La cotización de un ETF: la que diga una corrección manual y, si no hay, la del buscador.

    Por la misma razón que en una acción, y hacía falta aparte porque este camino solo sabía buscar
    por ISIN. Medido el 05-11-2026: iShares Energy Storage (`IE000DR59CI3`) cotiza como `STOR.AS`,
    con serie desde 2025-02-10 en dólares, y `/api/search` por ISIN contesta vacío: figura sin ISIN.
    Se le pasa solo la corrección y no la ficha anterior (ver `registro._fetch_eodhd`): en un ETF la
    cotización la elige el buscador, que prefiere la de euros, y la ficha anterior la congelaría."""
    if _simbolo_valido(simbolo):
        return _match_simbolo(simbolo, isin, http, token, force)
    return _resuelve_simbolo(isin, http, token, force, tipo_preferido="etf")


def clasifica_tipo(isin: str, http, settings: dict, base: Path | None = None) -> str | None:
    """Clasifica el ISIN vía EODHD: 'accion' | 'etf' | 'fondo' | 'indice', o None.
    Pensado para el ALTA, para no etiquetar acciones como 'fondo'."""
    token = _token(base)
    if not token:
        return None
    m = _resuelve_simbolo(isin, http, token, force=False, base=base)
    if not m:
        return None
    return _tipo_desde_eodhd(m.get("Type"))


# quoteType de Yahoo Finance -> tipo interno.
_YF_QUOTETYPE = {"EQUITY": "accion", "ETF": "etf", "MUTUALFUND": "fondo", "INDEX": "indice"}


def _quote_del_isin(quotes: list, isin: str) -> dict | None:
    """El resultado de la busqueda de Yahoo que ES el ISIN pedido, o `None`.

    Antes se tomaba el primero que trajera tipo o simbolo, sin comprobar de quien era. La busqueda de Yahoo es de texto:
    si el ISIN no existe puede devolver un valor parecido, y clasificar o fichar un valor con los datos de otro es
    peor que no clasificarlo.

    El resultado de la busqueda NO trae el ISIN (medido el 20-11-2026 sobre las 17 respuestas de `cache/http`: 12
    vacias y 5 con un unico resultado, ninguno con campo `isin`). Asi que: si un resultado lo trae, tiene que coincidir;
    si no lo trae, solo vale cuando es el UNICO resultado, que es lo que devuelve una busqueda exacta por ISIN. Varios
    resultados sin ISIN son una coincidencia aproximada y no se acepta ninguno."""
    candidatos = [q for q in quotes if isinstance(q, dict)]
    con_isin = [q for q in candidatos if q.get("isin") or q.get("ISIN")]
    if con_isin:
        for q in con_isin:
            if str(q.get("isin") or q.get("ISIN")).strip().upper() == (isin or "").strip().upper():
                return q
        return None
    return candidatos[0] if len(candidatos) == 1 else None


def _clasifica_yahoo(isin: str, http) -> str | None:
    """Alternativa a EODHD: clasifica por el buscador de Yahoo Finance (sin token).
    Útil para valores que EODHD aún no lista (p. ej. IPOs recientes)."""
    try:
        r = http.get("https://query1.finance.yahoo.com/v1/finance/search",
                     params={"q": isin, "quotesCount": "5", "newsCount": "0"},
                     ttl_dias=7)
    except Exception:
        return None
    if not getattr(r, "ok", False):
        return None
    try:
        quotes = (r.json() or {}).get("quotes") or []
    except Exception:
        return None
    q = _quote_del_isin(quotes, isin)
    if q is not None:
        t = _YF_QUOTETYPE.get(str(q.get("quoteType") or "").upper())
        if t:
            return t
    return None


def clasifica_isin(isin: str, http=None, settings=None, base=None,
                   nombre: str = "", tipo_indicado: str = "") -> str:
    """CONTRASTADOR único de ISIN: decide accion/etf/fondo/indice ANTES de
    procesar, de forma autoritativa (corrige aunque el usuario se equivoque).
    Cascada: nombre con 'ETF' -> etf; EODHD Type; Yahoo Finance; si no, lo indicado o 'fondo'."""
    # `ETF` como PALABRA, no como subcadena.
    #
    # Medido el 02-11-2026: con `"ETF" in nombre`, Netflix se clasificaba como ETF, porque
    # N-ETF-LIX contiene esas tres letras. Y es peor de lo que parece por donde esta la regla:
    # va PRIMERA en la cascada, asi que cortocircuitaba la consulta a EODHD y Netflix nunca
    # llegaba a preguntarse que era. Una funcion que presume de autoritativa -"corrige aunque
    # el usuario se equivoque"- se equivocaba ella, y en silencio.
    #
    # Caia una de las 312 acciones heredadas, pero el defecto es general: cualquier nombre con
    # esas tres letras seguidas. `\bETFS?\b` sigue reconociendo los de verdad -"... UCITS ETF",
    # "ETFs", "ETF Securities"- porque ahi ETF si es una palabra.
    if re.search(r"\bETFS?\b", (nombre or "").upper()):
        return "etf"
    if http is not None and settings is not None:
        try:
            t = clasifica_tipo(isin, http, settings, base)
        except Exception:
            t = None
        if t:
            return t
    if http is not None:
        t = _clasifica_yahoo(isin, http)
        if t:
            return t
    ti = (tipo_indicado or "").strip().lower()
    return ti if ti in ("accion", "etf", "fondo", "indice") else "fondo"


def _fundamentals_yahoo(out: dict, code: str, exch: str, http=None) -> bool:
    """Fallback GRATIS de fundamentals vía Yahoo Finance (yfinance).
    Devuelve True si obtuvo algo.

    yfinance sale a red por su cuenta, sin pasar por Http ni por su caché: en
    modo sin red se omite (auditoría 16-10, ALTA-17b)."""
    if getattr(http, "sin_red", False):
        log.info("Yahoo fundamentals omitidos para %s: modo sin red", code)
        # No pedirlos no es que Yahoo haya dejado de darlos: el núcleo arrastra los de la ficha
        # anterior tal cual, sin la etiqueta de retenido (`retencion_acciones.arrastra_sin_red`).
        from core.adquisicion import retencion_acciones
        procedencia.no_servido(retencion_acciones.ENDPOINT_SIN_RED)
        return False
    try:
        import yfinance as yf  # type: ignore
    except ImportError:
        log.info("yfinance no instalado: fundamentals gratis omitidos "
                 "(pip install yfinance)")
        return False
    suf = _YF_SUFIJO.get((exch or "").upper())
    if suf is None:
        # Auditoría del 16-11-2026 (EXT-9). Sin sufijo conocido se preguntaba por el ticker a
        # secas, que en Yahoo es el de la bolsa americana: un valor de otra bolsa con las mismas
        # letras habría traído los fundamentales de otra empresa. Sin bolsa conocida, no se piden.
        log.info("Yahoo fundamentals omitidos para %s: la bolsa %r no tiene sufijo de Yahoo conocido",
                 code, exch or "")
        return False
    sym = f"{code}{suf}"
    try:
        info = yf.Ticker(sym).info or {}
    except Exception as e:
        log.warning("Yahoo fundamentals %s: %s", sym, e)
        return False
    if not info or (info.get("marketCap") is None and info.get("trailingPE") is None):
        log.info("Yahoo sin fundamentals para %s", sym)
        return False

    set_path(out, "fundamentales.market_cap", _num(info.get("marketCap")))
    set_path(out, "fundamentales.per", _num(info.get("trailingPE")))
    set_path(out, "fundamentales.per_adelantado", _num(info.get("forwardPE")))
    set_path(out, "fundamentales.eps", _num(info.get("trailingEps")))
    set_path(out, "fundamentales.dividend_yield_pct", _yield_dividendo_yahoo_pct(info))
    set_path(out, "fundamentales.beta", _num(info.get("beta")))
    set_path(out, "fundamentales.max_52s", _num(info.get("fiftyTwoWeekHigh")))
    set_path(out, "fundamentales.min_52s", _num(info.get("fiftyTwoWeekLow")))
    set_path(out, "fundamentales.precio_valor_contable", _num(info.get("priceToBook")))
    set_path(out, "fundamentales.roe_pct", _pct(info.get("returnOnEquity")))
    set_path(out, "fundamentales.profit_margin_pct", _pct(info.get("profitMargins")))
    if not (out.get("identificacion") or {}).get("sector"):
        set_path(out, "identificacion.sector", _texto(info.get("sector")))
        set_path(out, "identificacion.industria", _texto(info.get("industry")))
    if not (out.get("identificacion") or {}).get("descripcion"):
        set_path(out, "identificacion.descripcion", _texto(info.get("longBusinessSummary")))
    # El símbolo con el que se pidieron, como en la vía solo Yahoo.
    set_path(out, "identificacion.simbolo_yahoo", sym)
    set_path(out, "fundamentales.fuente", "yahoo")
    _resumen_fundamentales_yahoo(out, info, sym)
    log.info("Yahoo fundamentals OK para %s", sym)
    return True


# --------------------------------------------------------------- fetch
def _fetch_yahoo(isin: str, http, base: Path | None = None) -> dict:
    """Extracción GRATIS por Yahoo cuando EODHD no tiene el valor (IPOs, etc.).

    Lo que da el dato es yfinance, que sale a red por su cuenta: en modo sin
    red no se intenta (auditoría 16-10, ALTA-17b)."""
    if getattr(http, "sin_red", False):
        log.info("Yahoo (yfinance) omitido para %s: modo sin red", isin)
        # EODHD ha dicho que no la tiene, y quien la tiene no se puede preguntar. Sin esto, cada
        # re-mapeo sin red daba por muertas a las que solo cotizan en Yahoo: el 04-11-2026 fueron
        # Prisa, DIGI, Desa y Árima, con precio de ese mismo día.
        procedencia.respuesta_sin_cerrar()
        return {}
    sym, q0 = None, {}
    try:
        r = http.get("https://query1.finance.yahoo.com/v1/finance/search",
                     params={"q": isin, "quotesCount": "5", "newsCount": "0"}, ttl_dias=2)
        if getattr(r, "ok", False):
            q = _quote_del_isin((r.json() or {}).get("quotes") or [], isin)
            if q is not None and q.get("symbol"):
                sym, q0 = q["symbol"], q
    except Exception as e:
        log.warning("Yahoo search %s: %s", isin, e)
    if not sym:
        log.info("Yahoo tampoco resuelve %s", isin)
        return {}
    try:
        import yfinance as yf  # type: ignore
        ticker = yf.Ticker(sym)
        info = ticker.info or {}
    except ImportError:
        log.info("yfinance no instalado: no puedo usar Yahoo para %s (pip install yfinance)", isin)
        return {}
    except Exception as e:
        log.warning("Yahoo info %s: %s", sym, e)
        return {}
    out: dict = {}
    tipo = _YF_QUOTETYPE.get(str(q0.get("quoteType") or info.get("quoteType") or "").upper(), "accion")
    # EXT-9: si Yahoo no dice la divisa, no se da por hecho que es el euro. La ficha se queda
    # sin ella, que se ve, en lugar de con una que puede ser falsa y convertir mal sus precios.
    divisa = info.get("currency") or None
    set_path(out, "identificacion.nombre", info.get("longName") or info.get("shortName") or q0.get("shortname"))
    set_path(out, "identificacion.tipo", tipo)
    set_path(out, "identificacion.isin", isin)
    set_path(out, "identificacion.ticker", str(info.get("symbol") or sym).split(".")[0])
    set_path(out, "identificacion.mercado", info.get("exchange") or q0.get("exchange"))
    set_path(out, "identificacion.pais", info.get("country"))
    set_path(out, "identificacion.divisa_base", divisa)
    set_path(out, "identificacion.simbolo_yahoo", sym)
    set_path(out, "identificacion.sector", _texto(info.get("sector")))
    set_path(out, "identificacion.industria", _texto(info.get("industry")))
    precio = info.get("currentPrice") or info.get("regularMarketPrice")
    if precio is not None:
        set_path(out, "valoracion.vl", _num(precio))
        set_path(out, "valoracion.vl_divisa", divisa)
    try:
        hist = ticker.history(period="max", auto_adjust=True)
        serie = []
        if hist is not None and not hist.empty:
            for idx, row in hist.iterrows():
                f = idx.date() if hasattr(idx, "date") else _fecha(str(idx)[:10])
                px = _num(row.get("Close"))
                if f and px and px > 0:
                    serie.append({"date": f, "price": px, "raw": {}})
        serie.sort(key=lambda x: x["date"])
        if serie:
            ult = serie[-1]
            set_path(out, "valoracion.vl", _redondea(ult["price"]))
            set_path(out, "valoracion.vl_fecha", ult["date"].isoformat())
            set_path(out, "valoracion.vl_divisa", divisa)
            set_path(out, "identificacion.source_listing_id", f"YAHOO:{sym}")
            _aplica_metricas_historicas(out, serie, http, "yahoo", f"YAHOO:{sym}",
                                        divisa=info.get("currency"), base=base)
    except Exception as e:
        log.warning("Yahoo historico %s: %s", sym, e)
    set_path(out, "fundamentales.market_cap", _num(info.get("marketCap")))
    set_path(out, "fundamentales.per", _num(info.get("trailingPE")))
    set_path(out, "fundamentales.per_adelantado", _num(info.get("forwardPE")))
    set_path(out, "fundamentales.eps", _num(info.get("trailingEps")))
    set_path(out, "fundamentales.dividend_yield_pct", _yield_dividendo_yahoo_pct(info))
    set_path(out, "fundamentales.beta", _num(info.get("beta")))
    set_path(out, "fundamentales.max_52s", _num(info.get("fiftyTwoWeekHigh")))
    set_path(out, "fundamentales.min_52s", _num(info.get("fiftyTwoWeekLow")))
    set_path(out, "fundamentales.precio_valor_contable", _num(info.get("priceToBook")))
    set_path(out, "fundamentales.roe_pct", _pct(info.get("returnOnEquity")))
    set_path(out, "fundamentales.profit_margin_pct", _pct(info.get("profitMargins")))
    set_path(out, "identificacion.descripcion", _texto(info.get("longBusinessSummary")))
    set_path(out, "fundamentales.fuente", "yahoo")
    _resumen_fundamentales_yahoo(out, info, sym)
    log.info("Yahoo OK para %s (%s)", isin, sym)
    return out


def _fetch_etf_listing(isin: str, http, settings: dict, force: bool,
                       base: Path | None, simbolo_eodhd: str | None = None) -> dict:
    token = _token(base)
    if not token:
        log.warning("EODHD omitido para ETF %s: falta eodhd_api_token "
                    "(config/secrets.json o EODHD_API_TOKEN)", isin)
        return {}
    match = listado_de_etf(isin, http, token, force, simbolo_eodhd)
    if not match:
        log.info("EODHD no resuelve listing ETF %s", isin)
        return {}
    code = str(match.get("Code") or "").strip()
    exch = str(match.get("Exchange") or "").strip()
    if not code or not exch:
        return {}
    simbolo = f"{code}.{exch}"
    out: dict = {}
    set_path(out, "identificacion.nombre", match.get("Name"))
    tipo_eodhd = _tipo_desde_eodhd(match.get("Type"))
    set_path(out, "identificacion.tipo",
             tipo_eodhd if tipo_eodhd in ("etf", "indice") else "etf")
    set_path(out, "identificacion.isin", isin)
    set_path(out, "identificacion.ticker", code)
    set_path(out, "identificacion.mercado", exch)
    set_path(out, "identificacion.pais", match.get("Country"))
    set_path(out, "identificacion.divisa_base",
             match.get("Currency") or settings.get("divisa", "EUR"))
    set_path(out, "identificacion.simbolo_eodhd", simbolo)
    set_path(out, "identificacion.source_listing_id", f"EODHD:{simbolo}")

    # Y la SERIE, que hasta el 01-11-2026 no se pedía: a un ETF se le resolvía el
    # símbolo y nada más. Los 11 ETF del universo tenían `simbolo_eodhd` y precio
    # —que les llegaba de Morningstar— y `observations_count` a nulo, así que no
    # se podía calcular nada con ellos. No era una decisión: `tipo == "etf"`
    # salía de `fetch` antes de llegar al tramo que pide el histórico, y el de
    # acciones exige `tipo == "accion"`. Los ETF caían entre los dos adaptadores.
    #
    # Hacía falta para usar un ETF como proxy de un índice (decisión 11), pero no
    # es solo para eso: un ETF es un instrumento con precio y su histórico es
    # tan suyo como el de una acción.
    #
    # Lo que NO se escribe aquí a propósito son las métricas de riesgo. La serie
    # de un ETF es de PRECIO DE MERCADO, y medido el 01-11 sobre el mismo MSCI
    # World eso infla la volatilidad a un año en 1,2 puntos frente al valor
    # liquidativo de un fondo índice, porque XETRA cierra a las 17:30 y el valor
    # liquidativo se calcula tras el cierre de Estados Unidos. Publicar esas
    # métricas como las del producto es una decisión aparte y no se toma aquí.
    try:
        serie = _serie_eod_ajustada(simbolo, http, token, force)
    except Exception as e:
        log.warning("EODHD eod ETF %s (%s): %s", isin, simbolo, e)
        return out
    if not serie:
        log.info("EODHD sin serie para el ETF %s (%s)", isin, simbolo)
        return out
    # `_serie_eod_ajustada` normaliza a {date: date, price: float, raw: {...}},
    # y la fecha es un objeto `date`: va con `.isoformat()` como en el tramo de
    # acciones, porque la ficha se serializa a JSON.
    # El precio que se MUESTRA es el cierre crudo; el ajustado se queda para la
    # serie. El ajustado reparte hacia atrás los splits y las distribuciones, que
    # es lo correcto para calcular rentabilidades y lo incorrecto para enseñar el
    # precio de hoy. En un ETF de acumulación los dos coinciden casi siempre,
    # porque no hay distribuciones que repartir, pero la distinción se respeta
    # igual: el día que haya un split, el ajustado dejaría de ser un precio real.
    #
    # Y un aviso para quien compare: este precio es el de MERCADO y en la divisa
    # de la cotización. Medido el 01-11 en `IE00B4L5Y983`, aquí sale 129,685 EUR
    # (XETRA) y Morningstar da 144,71, que NO es un desajuste: es el valor
    # liquidativo en dólares, y 129,685 x 1,116 son esos 144,7. Dos cifras
    # correctas de cosas distintas, que es justo por lo que la divisa viaja al
    # lado del número.
    ultimo = serie[-1]
    crudo = _num((ultimo.get("raw") or {}).get("close"))
    set_path(out, "valoracion.vl", crudo if crudo is not None else _num(ultimo["price"]))
    set_path(out, "valoracion.vl_fecha", ultimo["date"].isoformat())
    set_path(out, "valoracion.vl_divisa", match.get("Currency"))
    set_path(out, "riesgo.historial_precios.observations_count", len(serie))
    set_path(out, "riesgo.historial_precios.first_date", serie[0]["date"].isoformat())
    set_path(out, "riesgo.historial_precios.last_date", ultimo["date"].isoformat())
    set_path(out, "riesgo.historial_precios.source_history", "eodhd")
    set_path(out, "riesgo.historial_precios.source_listing_id", f"EODHD:{simbolo}")
    # Que la serie es de precio de mercado y no de valor liquidativo tiene que
    # viajar con ella: es lo que decide si se puede comparar con otra.
    set_path(out, "riesgo.historial_precios.clase_de_serie", "PRECIO_DE_MERCADO")
    return out


def fetch(isin: str, http, settings: dict, force: bool = False,
          tipo: str = "", base: Path | None = None,
          simbolo_eodhd: str | None = None) -> dict:
    """`simbolo_eodhd`: el símbolo ya conocido del activo (ver `simbolo_conocido`).
    En una acción, si su serie EOD trae datos se usa tal cual, sin buscar por ISIN;
    si no, aviso y la búsqueda por ISIN de siempre. En un ETF solo llega el de una
    corrección manual, y se usa sin buscar por ISIN (ver `listado_de_etf`)."""
    if tipo == "etf":
        return _fetch_etf_listing(isin, http, settings, force, base, simbolo_eodhd)
    if tipo != "accion":
        return {}

    token = _token(base)
    if not token:
        log.warning("EODHD omitido para %s: falta eodhd_api_token "
                    "(config/secrets.json o EODHD_API_TOKEN)", isin)
        return {}

    out: dict = {}

    match, serie = None, None
    if _simbolo_valido(simbolo_eodhd):
        try:
            serie = _serie_eod_ajustada(simbolo_eodhd, http, token, force)
        except Exception as e:
            log.warning("EODHD eod %s: %s", simbolo_eodhd, e)
            serie = []
        if serie:
            match = _match_simbolo(simbolo_eodhd, isin, http, token, force)
            sucesor = sucesor_de(isin, match.get("ISIN"), base)
            if sucesor:
                # El precio se conserva: es la línea del mismo valor, y quien tuvo el ISIN
                # viejo en cartera la necesita para valorar su posición. Lo que cambia es la
                # marca de disponibilidad, que pone el núcleo con esta señal.
                log.warning("EODHD %s: el listado %s es hoy de %s, que lo ha sustituido "
                            "(FIRDS conoce ese ISIN y no este)", isin, simbolo_eodhd, sucesor)
                procedencia.sustituido_por(sucesor)
        else:
            log.warning("EODHD %s: el símbolo conocido %s no devuelve serie EOD; "
                        "busco por ISIN como siempre", isin, simbolo_eodhd)
            serie = None
    if match is None:
        match = _resuelve_simbolo(isin, http, token, force, base=base)
    if not match:
        log.info("EODHD no resuelve %s; intento Yahoo (gratis)", isin)
        return _fetch_yahoo(isin, http, base)
    code = str(match.get("Code") or "").strip()
    exch = str(match.get("Exchange") or "").strip()
    if not code or not exch:
        return {}
    simbolo = f"{code}.{exch}"

    divisa = match.get("Currency") or settings.get("divisa", "EUR")
    set_path(out, "identificacion.nombre", match.get("Name"))
    set_path(out, "identificacion.tipo", _tipo_desde_eodhd(match.get("Type")))
    set_path(out, "identificacion.isin", isin)
    set_path(out, "identificacion.ticker", code)
    set_path(out, "identificacion.mercado", exch)
    set_path(out, "identificacion.pais", match.get("Country"))
    set_path(out, "identificacion.divisa_base", divisa)
    set_path(out, "identificacion.simbolo_eodhd", simbolo)
    set_path(out, "identificacion.source_listing_id", f"EODHD:{simbolo}")
    set_path(out, "identificacion.cotizacion_aviso", aviso_de_cotizacion(isin, exch, divisa, base))

    # Historico EOD completo: precio ultimo + metricas de riesgo/rentabilidad.
    try:
        if serie is None:  # con el símbolo conocido ya se pidió arriba
            serie = _serie_eod_ajustada(simbolo, http, token, force)
        if serie:
            ult = serie[-1]
            set_path(out, "valoracion.vl", _redondea(ult["price"]))
            set_path(out, "valoracion.vl_fecha", ult["date"].isoformat())
            set_path(out, "valoracion.vl_divisa", divisa)
            _aplica_metricas_historicas(out, serie, http, "eodhd", f"EODHD:{simbolo}",
                                        divisa=match.get("Currency"), base=base)
    except Exception as e:
        log.warning("EODHD eod %s: %s", simbolo, e)

    # Fundamentales: solo Yahoo. EODHD queda para el símbolo y las cotizaciones:
    # Óscar dio de baja sus fundamentales el 17-10 (y respondían 403). No se
    # vuelve a pedir /api/fundamentals (lo vigila tests/test_acciones_simbolo_eodhd.py).
    _fundamentals_yahoo(out, code, exch, http)

    return out
