# -*- coding: utf-8 -*-
"""
Calendario de DIVIDENDOS y RESULTADOS de cotizadas espanolas (.MC).

Fuentes server-side, en orden: EODHD (si el plan incluye "Calendar"), YAHOO
(yfinance, GRATIS y sin clave; la fuente por defecto que funciona) y FMP
(fallback si hay token). Solo lectura. NUNCA lanza: los errores -> `note`.

Yahoo recorre los componentes del IBEX 35 (sufijo .MC) y usa Ticker.calendar
(JSON quoteSummary) para la proxima ex-date / fecha de resultados + estimacion
de BPA. El resultado se cachea en memoria del proceso (TTL) para que solo la
primera carga por instancia sea lenta.

Tokens OPCIONALES (Functions env): EODHD_API_TOKEN y/o FMP_API_TOKEN.
"""
import json
import os
import threading
import time
import urllib.request
from datetime import date, timedelta
from clock import madrid_today
from quietlog import swallowed, swallowed_quiet

_UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
SCHEMA_VERSION = "spanish-calendar.v2"
MAX_DIVIDEND_RANGE_DAYS = 366
MAX_EARNINGS_RANGE_DAYS = 180

# Componentes IBEX 35 (Yahoo/.MC). Espejo de src/core/ibex35.ts.
# Contrastada el 03-11-2026. BME no ha cambiado la composicion en sus revisiones de diciembre de
# 2025 y junio y septiembre de 2026 (avisos 16/2025, 09/2026 y 14/2026); la proxima es el 10 de
# diciembre de 2026. Estaba `CRIN.MC`, que no existe, y faltaba Sacyr. Dos fuentes de prensa citan
# ademas CIE Automotive y suman 36: no entra sin un aviso de BME que lo diga.
IBEX35 = [
    "ACS.MC", "ACX.MC", "AENA.MC", "AMS.MC", "ANA.MC", "ANE.MC", "BBVA.MC", "BKT.MC",
    "CABK.MC", "CLNX.MC", "COL.MC", "ELE.MC", "ENG.MC", "FDR.MC", "FER.MC", "GRF.MC",
    "IAG.MC", "IBE.MC", "IDR.MC", "ITX.MC", "LOG.MC", "MAP.MC", "MRL.MC", "MTS.MC",
    "NTGY.MC", "PUIG.MC", "RED.MC", "REP.MC", "ROVI.MC", "SAB.MC", "SAN.MC", "SLR.MC",
    "TEF.MC", "UNI.MC", "SCYR.MC",
]

# Yahoo no da el nombre. Un valor que no este aqui sale sin nombre: no se deduce del codigo.
NOMBRES_IBEX35 = {
    "ACS.MC": "ACS", "ACX.MC": "Acerinox", "AENA.MC": "Aena", "AMS.MC": "Amadeus",
    "ANA.MC": "Acciona", "ANE.MC": "Acciona Energía", "BBVA.MC": "BBVA", "BKT.MC": "Bankinter",
    "CABK.MC": "CaixaBank", "CLNX.MC": "Cellnex", "COL.MC": "Colonial", "ELE.MC": "Endesa",
    "ENG.MC": "Enagás", "FDR.MC": "Fluidra", "FER.MC": "Ferrovial", "GRF.MC": "Grifols",
    "IAG.MC": "IAG", "IBE.MC": "Iberdrola", "IDR.MC": "Indra", "ITX.MC": "Inditex",
    "LOG.MC": "Logista", "MAP.MC": "Mapfre", "MRL.MC": "Merlin Properties", "MTS.MC": "ArcelorMittal",
    "NTGY.MC": "Naturgy", "PUIG.MC": "Puig", "RED.MC": "Redeia", "REP.MC": "Repsol",
    "ROVI.MC": "Rovi", "SAB.MC": "Banco Sabadell", "SAN.MC": "Banco Santander", "SLR.MC": "Solaria",
    "TEF.MC": "Telefónica", "UNI.MC": "Unicaja", "SCYR.MC": "Sacyr",
}

# Cache en memoria del proceso: key -> (expira_epoch, valor). Cloud Functions
# reutiliza instancias, asi que tras la 1a carga las siguientes son instantaneas.
_CACHE = {}
# Cloud Run v2 atiende varias peticiones a la vez en una instancia: la expulsion de `_cache_put` recorre y modifica el
# diccionario, y sin cerrojo dos hilos podian romperlo ("dictionary changed size during iteration").
_CACHE_LOCK = threading.Lock()
_CACHE_TTL = 6 * 3600           # 6 h para barridos COMPLETOS del IBEX
_CACHE_TTL_PARTIAL = 30 * 60    # Auditoría 11-08 (D14): 30 min para parciales
_CACHE_MAX_ENTRIES = 256        # Auditoría 11-08 (D14): cota de memoria (35 valores x 3 claves cabe de sobra)
_YAHOO_DOWN_TTL = 5 * 60        # un barrido no valido no se repite durante 5 min
_MIN_RESPONDING = 0.5           # fraccion minima de valores que deben contestar con contenido
_YAHOO_BUDGET_S = 35    # presupuesto de tiempo del bucle Yahoo


class _AvisoPublico(RuntimeError):
    """Un fallo cuyo texto esta escrito para quien lee la pantalla. Cualquier otra excepcion va solo al registro."""


def _cache_get(key):
    with _CACHE_LOCK:
        v = _CACHE.get(key)
    if v and v[0] > time.time():
        return v[1]
    return None


def _cache_put(key, value, ttl=_CACHE_TTL):
    # Auditoría 11-08 (D14): evicción simple por orden de inserción para que
    # rangos de fechas arbitrarios no hagan crecer la caché sin límite.
    with _CACHE_LOCK:
        if key not in _CACHE:
            while len(_CACHE) >= _CACHE_MAX_ENTRIES:
                _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = (time.time() + ttl, value)


def _get_json(url):
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _eodhd_token():
    return os.environ.get("EODHD_API_TOKEN") or os.environ.get("EODHD_API_KEY") or ""


def _fmp_token():
    return os.environ.get("FMP_API_TOKEN") or os.environ.get("FMP_API_KEY") or ""


def _eodhd_enabled():
    # EODHD se intenta si hay token; con ES_CALENDAR_EODHD=0 se salta del todo.
    return os.environ.get("ES_CALENDAR_EODHD", "1") != "0"


def _parse_day(value, field, default):
    if value is None or value == "":
        return default
    if not isinstance(value, str):
        raise ValueError("%s debe tener formato AAAA-MM-DD" % field)
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("%s debe tener formato AAAA-MM-DD" % field) from exc


def _range(data, default_days, max_days):
    request = data if isinstance(data, dict) else {}
    today = madrid_today()
    frm = _parse_day(request.get("from"), "from", today)
    to = _parse_day(request.get("to"), "to", frm + timedelta(days=default_days))
    if to < frm:
        raise ValueError("to no puede ser anterior a from")
    if (to - frm).days > max_days:
        raise ValueError("el intervalo maximo es de %s dias" % max_days)
    return frm.isoformat(), to.isoformat()


def _is_mc(code):
    return bool(code) and str(code).upper().endswith(".MC")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _to_iso(x):
    """date/datetime/list/str -> 'YYYY-MM-DD' o None."""
    if isinstance(x, (list, tuple)):
        x = x[0] if x else None
    if hasattr(x, "isoformat"):
        try:
            return x.isoformat()[:10]
        except Exception:
            swallowed_quiet("spanish_calendar.py:121")
            return None
    if isinstance(x, str):
        return x[:10]
    return None


def _in_range(iso, frm, to):
    return bool(iso) and frm <= iso <= to


def _yahoo_ticker(sym):
    import yfinance as yf  # lazy; si falta la libreria el llamador captura ImportError
    return yf.Ticker(sym)


def _collect(sources, sort_key, hint):
    """Prueba fuentes en orden; devuelve la primera con filas; nunca lanza."""
    errors = []
    empty_source = None
    empty_note = None
    for fn, src in sources:
        try:
            outcome = fn()
        except Exception as exc:  # red/plan/parse -> siguiente fuente
            # A quien lee, un texto sin detalles internos (la excepcion de una libreria puede traer rutas, urls con el
            # token en la consulta o trazas); el detalle va al registro. Solo un `_AvisoPublico` lleva su texto.
            swallowed("spanish_calendar._collect:%s" % src)
            errors.append("%s: %s" % (src, exc) if isinstance(exc, _AvisoPublico) else "%s: la fuente no respondió" % src)
            continue
        source_note = None
        if isinstance(outcome, tuple) and len(outcome) == 2:
            items, source_note = outcome
        else:
            items = outcome
        if items is None:  # fuente no disponible (sin token / sin libreria)
            continue
        if items:
            for item in items:
                if not item.get("name"):
                    item["name"] = NOMBRES_IBEX35.get(item.get("code"))
            items.sort(key=sort_key)
            result = {"items": items, "source": src + "_LIVE", "count": len(items), "status": "OK"}
            if source_note:
                result["note"] = source_note
            return result
        empty_source = src
        empty_note = source_note
    if empty_source:
        return {
            "items": [],
            "source": empty_source + "_LIVE",
            "count": 0,
            "note": empty_note or "Sin datos en el rango.",
            "status": "NO_DATA_IN_RANGE",
        }
    note = "; ".join(errors) if errors else hint
    source = "ERROR" if errors else "NOT_CONFIGURED"
    status = "SOURCE_NOT_RESPONDING" if errors else "NOT_CONFIGURED"
    return {"items": [], "source": source, "count": 0, "note": note, "status": status}


def _invalid_result(message):
    today = madrid_today().isoformat()
    return {
        "schema_version": SCHEMA_VERSION,
        "items": [],
        "source": "INVALID_REQUEST",
        "count": 0,
        "from": today,
        "to": today,
        "note": message,
        "status": "INVALID_REQUEST",
    }


# ---------------- DIVIDENDOS ----------------

def _eodhd_dividends(frm, to):
    tok = _eodhd_token()
    if not tok:
        return None
    url = "https://eodhd.com/api/calendar/dividends?api_token=%s&from=%s&to=%s&fmt=json" % (tok, frm, to)
    data = _get_json(url)
    rows = data if isinstance(data, list) else (data.get("dividends") if isinstance(data, dict) else [])
    out = []
    for r in rows or []:
        code = r.get("code") or r.get("symbol")
        if not _is_mc(code):
            continue
        out.append({
            "code": code, "name": r.get("name"),
            "ex_date": r.get("date") or r.get("exDate"),
            "payment_date": r.get("paymentDate") or r.get("payment_date"),
            "amount": _num(r.get("value") if r.get("value") is not None else r.get("dividend")),
            "currency": r.get("currency") or "EUR",
            "period": r.get("period"),
            "yield": _num(r.get("yield")),
        })
    return out


def _fmp_dividends(frm, to):
    tok = _fmp_token()
    if not tok:
        return None
    url = "https://financialmodelingprep.com/stable/dividends-calendar?from=%s&to=%s&apikey=%s" % (frm, to, tok)
    rows = _get_json(url)
    out = []
    for r in (rows if isinstance(rows, list) else []):
        sym = r.get("symbol")
        if not _is_mc(sym):
            continue
        out.append({
            "code": sym, "name": None,
            "ex_date": r.get("date"),
            "payment_date": r.get("paymentDate"),
            "amount": _num(r.get("dividend") if r.get("dividend") is not None else r.get("adjDividend")),
            "currency": "EUR",
            "period": r.get("frequency"),
            "yield": _num(r.get("yield")),
        })
    return out


def _iso_list(x):
    """Fechas de un campo de Yahoo (una, o una ventana de varias) -> lista de 'YYYY-MM-DD'."""
    items = list(x) if isinstance(x, (list, tuple)) else [x]
    return [iso for iso in (_to_iso(i) for i in items) if iso]


def _yahoo_sweep():
    """Barre los 35 valores y devuelve ({simbolo: calendario}, escaneados, truncado).

    Regla de validez (hallazgo 26): un valor RESPONDE solo si Yahoo devuelve un
    calendario con contenido. Un diccionario vacio no cuenta: es lo que devuelve
    Yahoo cuando bloquea, y daba un barrido «completo» sin dividendos. Si responde
    con contenido menos de la mitad de los valores, el barrido no es valido y se
    lanza un error: la pantalla dice que Yahoo no esta contestando, no «sin datos».
    Que un valor concreto no tenga nada anunciado SI es una respuesta (el
    calendario trae otras claves), asi que no penaliza.

    La cache es por valor (6 h) y no por rango: el rango se filtra despues.
    """
    down = _cache_get(("yahoo_down",))
    if down is not None:
        raise _AvisoPublico(down)
    deadline = time.time() + _YAHOO_BUDGET_S
    cals = {}
    truncated = False
    scanned = 0
    for sym in IBEX35:
        cached = _cache_get(("cal", sym))
        if cached is not None:
            cals[sym] = cached
            scanned += 1
            continue
        if time.time() > deadline:
            truncated = True
            break
        scanned += 1
        try:
            t = _yahoo_ticker(sym)
            cal = t.calendar
            if not isinstance(cal, dict) or not cal:
                continue  # vacio: no responde con contenido
            # Solo el calendario: el `Ticker` de yfinance no se retiene (35 a la vez durante 6 h); si hace falta el
            # ultimo dividendo, `_last_paid_dividend` lo vuelve a pedir una vez por valor y lo cachea.
            entry = {"cal": cal}
            cals[sym] = entry
            _cache_put(("cal", sym), entry)
        except Exception:
            swallowed_quiet("spanish_calendar.py:sweep")
            continue
    if len(cals) < max(1, _MIN_RESPONDING * len(IBEX35)):
        msg = (
            "Yahoo no está contestando: solo %s de %s valores devolvieron datos; "
            "no se puede decir si hay anuncios en el rango." % (len(cals), len(IBEX35))
        )
        _cache_put(("yahoo_down",), msg, ttl=_YAHOO_DOWN_TTL)
        raise _AvisoPublico(msg)
    note = None
    if truncated:
        note = "Cobertura parcial de Yahoo: se consultaron %s de %s componentes." % (scanned, len(IBEX35))
    elif len(cals) < len(IBEX35):
        note = "Yahoo respondió para %s de %s componentes; pueden faltar anuncios." % (len(cals), len(IBEX35))
    return cals, note


def _last_paid_dividend(sym, entry):
    """Ultimo pago YA realizado (importe y su fecha). Es lo que Yahoo da, no el de la ex-date anunciada."""
    cached = _cache_get(("lastdiv", sym))
    if cached is not None:
        return cached
    amount = None
    amount_ex_date = None
    try:
        divs = _yahoo_ticker(sym).dividends
        if divs is not None and len(divs):
            amount = float(divs.iloc[-1])
            amount_ex_date = _to_iso(divs.index[-1])
    except Exception:
        swallowed_quiet("spanish_calendar.py:lastdiv")
        return amount, amount_ex_date  # fallo: no se cachea
    _cache_put(("lastdiv", sym), (amount, amount_ex_date))
    return amount, amount_ex_date


def _yahoo_dividends(frm, to):
    try:
        import yfinance  # noqa: F401  (comprobar disponibilidad de la libreria)
    except Exception:
        swallowed_quiet("spanish_calendar.py:240")
        return None
    cals, note = _yahoo_sweep()
    out = []
    for sym in IBEX35:
        entry = cals.get(sym)
        if entry is None:
            continue
        cal = entry["cal"]
        exd = _to_iso(cal.get("Ex-Dividend Date"))
        if not _in_range(exd, frm, to):
            continue
        amount, amount_ex_date = _last_paid_dividend(sym, entry)
        out.append({
            "code": sym, "name": None,
            "ex_date": exd,
            "payment_date": _to_iso(cal.get("Dividend Date")),
            "amount": amount,
            # Yahoo da el ultimo pago ya hecho, no el de `ex_date`: esta es su fecha.
            "amount_ex_date": amount_ex_date,
            "amount_kind": "LAST_PAID",
            "currency": "EUR",
            "period": None,
            "yield": None,
        })
    return out, note


def get_dividends_calendar(data):
    try:
        frm, to = _range(data, 90, MAX_DIVIDEND_RANGE_DAYS)
    except ValueError as exc:
        return _invalid_result(str(exc))
    sources = []
    if _eodhd_enabled():
        sources.append((lambda: _eodhd_dividends(frm, to), "EODHD"))
    sources.append((lambda: _yahoo_dividends(frm, to), "YAHOO"))
    sources.append((lambda: _fmp_dividends(frm, to), "FMP"))
    res = _collect(
        sources,
        sort_key=lambda x: (x.get("payment_date") or x.get("ex_date") or "zzzz", str(x.get("code"))),
        hint="Sin fuente de calendario disponible (Yahoo/EODHD/FMP).",
    )
    res["schema_version"] = SCHEMA_VERSION
    res["from"], res["to"] = frm, to
    return res


# ---------------- RESULTADOS (EARNINGS) ----------------

def _surprise(actual, estimate):
    if actual is None or estimate is None or estimate == 0:
        return None
    return round((actual - estimate) / abs(estimate) * 100.0, 2)


def _eodhd_earnings(frm, to):
    tok = _eodhd_token()
    if not tok:
        return None
    url = "https://eodhd.com/api/calendar/earnings?api_token=%s&from=%s&to=%s&fmt=json" % (tok, frm, to)
    data = _get_json(url)
    rows = data.get("earnings") if isinstance(data, dict) else (data if isinstance(data, list) else [])
    out = []
    for r in rows or []:
        code = r.get("code") or r.get("symbol")
        if not _is_mc(code):
            continue
        actual = _num(r.get("actual"))
        est = _num(r.get("estimate"))
        out.append({
            "code": code, "name": r.get("name"),
            "report_date": r.get("report_date") or r.get("date"),
            "when": r.get("before_after_market"),
            "currency": r.get("currency"),
            "eps_actual": actual, "eps_estimate": est,
            "eps_surprise_pct": _num(r.get("percent")) if r.get("percent") is not None else _surprise(actual, est),
            "revenue_actual": None, "revenue_estimate": None,
        })
    return out


def _fmp_earnings(frm, to):
    tok = _fmp_token()
    if not tok:
        return None
    url = "https://financialmodelingprep.com/stable/earnings-calendar?from=%s&to=%s&apikey=%s" % (frm, to, tok)
    rows = _get_json(url)
    out = []
    for r in (rows if isinstance(rows, list) else []):
        sym = r.get("symbol")
        if not _is_mc(sym):
            continue
        actual = _num(r.get("epsActual"))
        est = _num(r.get("epsEstimated"))
        out.append({
            "code": sym, "name": None,
            "report_date": r.get("date"),
            "when": r.get("time"),
            "currency": "EUR",
            "eps_actual": actual, "eps_estimate": est,
            "eps_surprise_pct": _surprise(actual, est),
            "revenue_actual": _num(r.get("revenueActual")),
            "revenue_estimate": _num(r.get("revenueEstimated")),
        })
    return out


def _yahoo_earnings(frm, to):
    try:
        import yfinance  # noqa: F401
    except Exception:
        swallowed_quiet("spanish_calendar.py:382")
        return None
    cals, note = _yahoo_sweep()
    out = []
    for sym in IBEX35:
        entry = cals.get(sym)
        if entry is None:
            continue
        cal = entry["cal"]
        window = _iso_list(cal.get("Earnings Date"))
        rep = window[0] if window else None
        if not _in_range(rep, frm, to):
            continue
        # Cuando Yahoo da una ventana de fechas, la primera es solo una estimacion.
        estimated = len(set(window)) > 1
        item = {
            "code": sym, "name": None,
            "report_date": rep,
            "date_estimated": estimated,
            "when": None,
            "currency": "EUR",
            "eps_actual": None,
            "eps_estimate": _num(cal.get("Earnings Average")),
            "eps_surprise_pct": None,
            "revenue_actual": None,
            "revenue_estimate": _num(cal.get("Revenue Average")),
        }
        if estimated:
            item["report_date_window_end"] = max(window)
        out.append(item)
    return out, note


def get_earnings_calendar(data):
    try:
        frm, to = _range(data, 45, MAX_EARNINGS_RANGE_DAYS)
    except ValueError as exc:
        return _invalid_result(str(exc))
    sources = []
    if _eodhd_enabled():
        sources.append((lambda: _eodhd_earnings(frm, to), "EODHD"))
    sources.append((lambda: _yahoo_earnings(frm, to), "YAHOO"))
    sources.append((lambda: _fmp_earnings(frm, to), "FMP"))
    res = _collect(
        sources,
        sort_key=lambda x: (x.get("report_date") or "zzzz", str(x.get("code"))),
        hint="Sin fuente de calendario disponible (Yahoo/EODHD/FMP).",
    )
    res["schema_version"] = SCHEMA_VERSION
    res["from"], res["to"] = frm, to
    return res
