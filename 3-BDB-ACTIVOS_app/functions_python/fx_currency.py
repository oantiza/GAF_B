# -*- coding: utf-8 -*-
"""Regla UNICA de resolucion de divisa de un listado.

Auditoria de divisas (06-09-2026). La divisa la decidia el METADATO —el
`source_currency` del documento anterior, o el `vl_divisa` de la ficha— y no la
cotizacion. Con eso, cinco ETF de Xetra que ya cotizan en euros se dividian otra vez
por EUR/USD (precios un 14 % bajos desde 2023) y un ETF de Amsterdam que cotiza en
dolares se guardaba sin convertir (un 15 % altos).

La correccion se escribio primero solo en el productor, y el VERIFICADOR se quedo con
la consulta antigua: aceptaba «NA» como divisa, la cacheaba, y presentaba el fallo
como «no hay precios con los que contrastar» —culpando al proveedor de un fallo
propio—. Este modulo existe para que no vuelva a pasar: la regla vive en un sitio y
la usan el productor y el verificador.

Sin dependencias de Firebase ni de red: quien llama inyecta su propio lector HTTP
(`get_json(path, params) -> objeto | None`), asi que se puede probar sin proveedor.
"""
import re
import urllib.error

# Codigos que el proveedor devuelve cuando NO sabe la divisa. No son divisas.
DIVISAS_NO_VALIDAS = frozenset({"NA", "N/A", "NONE", "NULL", "UNKNOWN", "-", "?", ""})

# Subunidades: el listado cotiza en centesimas de la divisa mayor.
SUBUNIDADES = {
    "GBX": ("GBP", 0.01),
    "GBP_PENCE": ("GBP", 0.01),
    "ILA": ("ILS", 0.01),
    "ZAC": ("ZAR", 0.01),
}

# Motivos por los que una resolucion falla. Se registran separados porque «sin divisa»
# no es lo mismo que «sin cotizacion»: confundirlos fue el error del verificador.
SIN_DIVISA = "SIN_DIVISA"
DIVISA_NO_VALIDA = "DIVISA_NO_VALIDA"
# 14-10-2026 (ALTA-03): el proveedor no respondio (red, 5xx o cuota agotados los
# reintentos). NO es una respuesta: quien cachee no debe guardarla como definitiva.
PROVEEDOR_NO_DISPONIBLE = "PROVEEDOR_NO_DISPONIBLE"


def _http_status(exc):
    """Codigo HTTP de la excepcion o de su causa (los lectores envuelven el HTTPError)."""
    for candidate in (exc, getattr(exc, "__cause__", None)):
        if isinstance(candidate, urllib.error.HTTPError):
            return candidate.code
        status = getattr(candidate, "status_code", None)
        if isinstance(status, int):
            return status
    return None


def es_rechazo_definitivo(exc) -> bool:
    """Revision del 14-10-2026: un 4xx del proveedor (403 sin permiso, 404 simbolo
    inexistente...) es una RESPUESTA definitiva y se puede cachear. Salvo el 429, que es
    cuota. Red, 5xx, 429 o cualquier error que no se reconozca: fallo transitorio."""
    status = _http_status(exc)
    return isinstance(status, int) and 400 <= status < 500 and status != 429


def es_divisa_valida(codigo):
    """Un codigo ISO-4217 de tres letras (GBX/ILA/ZAC incluidas, son subunidades)."""
    if not codigo:
        return False
    codigo = str(codigo).strip().upper()
    if codigo in DIVISAS_NO_VALIDAS:
        return False
    return bool(re.fullmatch(r"[A-Z]{3}", codigo))


def divisa_mayor(codigo):
    """(divisa mayor, escala) del codigo: GBX -> ('GBP', 0.01); EUR -> ('EUR', 1.0)."""
    codigo = (codigo or "").strip().upper()
    return SUBUNIDADES.get(codigo, (codigo, 1.0))


def divisa_de_fundamentales(payload):
    """Divisa declarada en `fundamentals/{symbol}?filter=General::CurrencyCode`."""
    if isinstance(payload, str):
        return payload.strip().upper() or None
    if isinstance(payload, dict):
        general = payload.get("General") or payload
        if isinstance(general, dict):
            return str(general.get("CurrencyCode") or "").strip().upper() or None
    return None


def divisa_de_busqueda(symbol, get_json):
    """Divisa segun la busqueda EXACTA del proveedor: mismo Code y misma bolsa.

    Es el respaldo de los fundamentales, que devuelven «NA» en muchos fondos. La
    coincidencia tiene que ser exacta: aceptar el primer resultado traeria la divisa
    de OTRO listado del mismo valor (el mismo ETF en Xetra y en Milan no cotizan en
    la misma divisa).
    """
    if not symbol:
        return None
    texto = str(symbol)
    code = texto.split(".")[0]
    exchange = texto.split(".")[1].upper() if "." in texto else ""
    filas = get_json("search/%s" % texto, None)
    if not isinstance(filas, list) or not filas:
        filas = get_json("search/%s" % code, None)
    if not isinstance(filas, list):
        return None
    for fila in filas:
        if not isinstance(fila, dict):
            continue
        if str(fila.get("Code") or "").upper() != code.upper():
            continue
        if exchange and str(fila.get("Exchange") or "").upper() != exchange:
            continue
        candidata = str(fila.get("Currency") or "").strip().upper()
        if es_divisa_valida(candidata):
            return candidata
    return None


def resolve_listing_currency(symbol, get_json, on_note=None):
    """Divisa del listado: fundamentales y, si no sirven, busqueda exacta.

    Devuelve (divisa, motivo). `divisa` es None si no se resuelve, y entonces el
    motivo dice por que: SIN_DIVISA (el proveedor no la publica), DIVISA_NO_VALIDA
    (la publica pero no es una divisa, tipicamente «NA») o PROVEEDOR_NO_DISPONIBLE
    (alguna consulta fallo de forma transitoria —red, 5xx, 429—, asi que la respuesta
    no es definitiva y no se debe cachear como tal). Un 4xx distinto de 429 si es una
    respuesta definitiva (`es_rechazo_definitivo`). Con divisa, motivo es None.

    Nunca inventa un valor por defecto: escribir precios «asumiendo EUR» es
    exactamente el fallo que esta auditoria persigue.
    """
    if not symbol:
        return None, SIN_DIVISA
    cruda = None
    fallo = False
    try:
        cruda = divisa_de_fundamentales(get_json("fundamentals/%s" % symbol, {"filter": "General::CurrencyCode"}))
    except Exception as exc:  # noqa: BLE001 - sin divisa no se escribe; el motivo se devuelve
        cruda = None
        fallo = fallo or not es_rechazo_definitivo(exc)
        if on_note:
            on_note("fundamentales de %s no disponibles: %s" % (symbol, exc))
    if es_divisa_valida(cruda):
        return cruda.strip().upper(), None
    if cruda and on_note:
        on_note("fundamentales sin divisa util para %s (%r)" % (symbol, cruda))
    try:
        de_busqueda = divisa_de_busqueda(symbol, get_json)
    except Exception as exc:  # noqa: BLE001
        de_busqueda = None
        fallo = fallo or not es_rechazo_definitivo(exc)
        if on_note:
            on_note("busqueda de %s no disponible: %s" % (symbol, exc))
    if es_divisa_valida(de_busqueda):
        if on_note:
            on_note("divisa de %s resuelta por busqueda: %s" % (symbol, de_busqueda))
        return de_busqueda, None
    if fallo:
        return None, PROVEEDOR_NO_DISPONIBLE
    return None, (DIVISA_NO_VALIDA if cruda else SIN_DIVISA)
