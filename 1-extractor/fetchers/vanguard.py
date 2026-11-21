"""Emisor Vanguard: valor liquidativo y ficha declarados, de la API GraphQL de su web.

Cuarto adaptador de emisor (decisión 51, 08-11-2026), con la forma que fijó `ishares`.

**Las consultas son las que la propia web lanza**, copiadas de su código público con los campos que
aquí se usan. La introspección del servicio está cerrada, y el esquema no se adivina.

**El id de producto sale de dos peticiones, sin mantener una lista:** el `sitemap` publicado da los ids
de todas las fichas (520 el 08-11-2026) y una sola consulta los traduce a ISIN (505). Se renueva cada
`DIAS_CATALOGO`. Un ISIN fuera del catálogo no es un error: el adaptador no aporta nada. La consulta de
búsqueda de la web (`SearchFunds`) en este servicio responde 400.

**El historial de VL empieza el 18-11-2014 como mucho**, aunque la clase sea anterior: VUSA y los fondos
índice se lanzaron antes, y pedir fechas previas no da más. `emisor.vl.primera_fecha` es el principio de
la serie disponible, no el lanzamiento, que va en `emisor.fecha_lanzamiento`.

**El patrimonio viene por clave, en doce divisas cada una.** `TNA` es la clase y `AUM` el fondo: la web
los asigna así (`shareClassAssets` y `totalAssets`), y se toma la cifra en la divisa de la clase. Es de
cierre de mes.

**Sirve también para los fondos índice de Vanguard** (medido en IE0032126645 e IE00B18GC888), y `aplica`
los deja pasar. Solo escribe en `emisor` y `series.vl_emisor`: su `riesgo.*` sigue saliendo de donde
salía.

**Todo se escribe en el bloque `emisor`, y la serie de VL en `series.vl_emisor`**: los motivos están en
`ishares`. **El VL no entra en ninguna métrica** (decisión 52).

Sin cookies ni aviso aceptado. Lo que la respuesta no trae se queda ausente: en particular `muestreo`,
porque la API solo dice `Physical` en los 121 ETF del catálogo.
"""
from __future__ import annotations

import datetime as dt
import html
import logging
import re
from typing import Any

from core import cartera_emisor
from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.vanguard")

FUENTE = "vanguard"
ETAPA_FICHA = "ficha_producto"
ETAPA_VL = "vl_historico"
ETAPA_POSICIONES = "posiciones"

URL_GRAPHQL = "https://www.vanguard.co.uk/gpx/graphql"
URL_SITEMAP = "https://www.vanguard.co.uk/professional/sitemap.xml"
# La web lo envía en cada consulta, y aquí se manda igual.
CABECERAS = {"x-consumer-id": "uk0"}
# Un ETF nuevo aparece en el sitemap: un año (la familia `identidad`) sería demasiado para verlo.
DIAS_CATALOGO = 30
TAMANO_PAGINA = 1500

Q_CATALOGO = ('query VanguardCatalogo($portIds: [String!]) { funds(portIds: $portIds) { profile { portId '
              'identifiers(altIds: ["ISIN"]) { altIdCode altIdValue } } } }')
Q_FICHA = """query VanguardFicha($portIds: [String!]!) {
  funds(portIds: $portIds) {
    profile {
      portId fundFullName fundCurrency assetClassificationLevel1 marketRegionFocus fundInceptionDate
      distributionStrategy fundDistributionFrequency etfReplicationMethodology benchMarkNameFromECS
      benchmarkPolarisData { FBPC { benchmarkShortName identifiers { altId altIdValue } } }
      identifiers(altIds: ["ISIN"]) { altIdCode altIdValue }
      feesAndExpenses(getLatest: true) { feesAndExpensesType { expenseType(codes: ["TOTEXPRTPC"]) { code value } } }
    }
    distributionDetails { periodicDistributions(limit: 0) { items {
      exDividendDate recordDate payableDate
      taxDetails { distributionLevelCode distributionAmount distributionType { distCode } currencyCode }
    } } }
  }
  polarisAnalyticsHistory(portIds: $portIds) { monthly { valuation { fund(getLatest: true) { items {
    TNA { fundAssetAmount effectiveDate currency }
    AUM { fundAssetAmount effectiveDate currency }
  } } } } }
}"""
Q_VL = """query VanguardVl($portIds: [String!]!) {
  funds(portIds: $portIds) { pricingDetails { navPrices(limit: -1, sortAsc: true) { items { asOfDate currencyCode price } } } }
}"""
Q_POSICIONES = """query VanguardPosiciones($portIds: [String!], $lastItemKey: String) {
  borHoldings(portIds: $portIds) { holdings(limit: %d, lastItemKey: $lastItemKey) {
    items { issuerName securityLongDescription gicsSectorDescription marketValuePercentage sedol1 ticker
            securityType effectiveDate bloombergIsoCountry }
    totalHoldings lastItemKey
  } }
}""" % TAMANO_PAGINA

# Vocabulario medido en las 505 fichas del catálogo el 08-11-2026; lo que no esté aquí no se interpreta.
POLITICA = {"accumulating income": "acumulacion", "distributing income": "distribucion"}
REPLICA = {"physical": "fisica"}
SIN_DATO = {"", "not applicable", "n/a", "none"}
# Dividendo (`INC`) y plusvalía repartida (`CGCA`): la web los suma para dar el importe del pago.
TIPOS_REPARTO = {"INC", "CGCA"}
# Forwards de divisa, contado y liquidez: pesan en la cartera y no son exposición que ordenar.
TIPOS_SIN_EXPOSICION = ("CT.", "CRNY")

_ID_EN_SITEMAP = re.compile(r"/product/[a-z-]+/[a-z-]+/(\w+)/")
_ISO = re.compile(r"\d{4}-\d{2}-\d{2}")


def fetch(isin: str, http, settings: dict, force: bool = False, previo: dict | None = None) -> dict:
    isin = isin.strip().upper()
    id_emisor = _id_de_producto(isin, http)
    if not id_emisor:
        return {}
    r, datos = _consulta(http, Q_FICHA, {"portIds": [id_emisor]}, "precio", force, isin)
    fondo = _primero(_get(datos, "funds"))
    perfil = _get(fondo, "profile")
    if not isinstance(perfil, dict):
        return {}
    if _isin_del_perfil(perfil) != isin:
        log.warning("vanguard %s: la respuesta es de otro producto; no la uso", isin)
        return {}

    out: dict = {}
    descarga = _iso(r.fetched_at)
    url = f"{URL_GRAPHQL}#{id_emisor}"
    with procedencia.etapa(ETAPA_FICHA, r.fetched_at, url=url):
        set_path(out, "emisor.fuente", FUENTE)
        set_path(out, "emisor.id_emisor", id_emisor)
        set_path(out, "emisor.fecha_descarga", descarga)
        _escribe_ficha(out, perfil)
        _escribe_patrimonio(out, datos, perfil)
        _escribe_dividendos(out, fondo, descarga)

    r_vl, vl = _consulta(http, Q_VL, {"portIds": [id_emisor]}, "precio", force, isin)
    if vl is not None:
        with procedencia.etapa(ETAPA_VL, r_vl.fetched_at, url=url):
            _escribe_vl(out, vl, r_vl.fetched_at, isin)

    _escribe_cartera(out, http, id_emisor, settings, force, isin, url)

    avisos = _aviso_kid(isin, (_get(out, "emisor", "politica") or {}).get("valor"), previo)
    if avisos:
        set_path(out, "emisor.avisos", avisos)
    log.info("vanguard %s: VL hasta %s", isin, (_get(out, "emisor", "vl") or {}).get("ultima_fecha") or "?")
    return out


# ------------------------------------------------------------------ API
def _consulta(http, consulta: str, variables: dict, familia: str, force: bool, isin: str,
              ttl_dias: float | None = None) -> tuple[Any, dict | None]:
    """La respuesta y su `data`, o `data` None si el servicio no la dio: un error de GraphQL llega con 200."""
    r = http.post_json(URL_GRAPHQL, cuerpo={"query": consulta, "variables": variables}, headers=CABECERAS,
                       familia=familia, force=force, ttl_dias=ttl_dias)
    if not r.ok:
        log.warning("vanguard %s: la consulta responde %s", isin, r.status)
        return r, None
    try:
        cuerpo = r.json()
    except ValueError:
        log.warning("vanguard %s: la consulta no devuelve JSON", isin)
        return r, None
    if not isinstance(cuerpo, dict) or cuerpo.get("errors") or not isinstance(cuerpo.get("data"), dict):
        log.warning("vanguard %s: la consulta devuelve errores", isin)
        return r, None
    return r, cuerpo["data"]


def _id_de_producto(isin: str, http) -> str | None:
    r = http.get(URL_SITEMAP, familia="identidad", ttl_dias=DIAS_CATALOGO, headers={"Accept": "*/*"})
    ids = sorted(set(_ID_EN_SITEMAP.findall(r.text))) if r.ok else []
    if not ids:
        log.warning("vanguard %s: el sitemap no da ids (%s)", isin, r.status)
        return None
    _, datos = _consulta(http, Q_CATALOGO, {"portIds": ids}, "identidad", False, isin, DIAS_CATALOGO)
    for fondo in _get(datos, "funds") or []:
        perfil = _get(fondo, "profile")
        if isinstance(perfil, dict) and _isin_del_perfil(perfil) == isin:
            return _texto(perfil.get("portId"))
    return None


def _isin_del_perfil(perfil: dict) -> str | None:
    return next((i.get("altIdValue") for i in perfil.get("identifiers") or []
                 if isinstance(i, dict) and i.get("altIdCode") == "ISIN"), None)


# ------------------------------------------------------------------ ficha
def _escribe_ficha(out: dict, perfil: dict) -> None:
    set_path(out, "emisor.nombre", _texto(perfil.get("fundFullName")))
    set_path(out, "emisor.clase_activo", _texto(perfil.get("assetClassificationLevel1")))
    region = _texto(perfil.get("marketRegionFocus"))
    if region:
        set_path(out, "emisor.region", [region])
    set_path(out, "emisor.divisa_clase", _texto(perfil.get("fundCurrency")))
    set_path(out, "emisor.fecha_lanzamiento", _fecha_iso(perfil.get("fundInceptionDate")))
    ter = _ter(perfil)
    if ter is not None:
        set_path(out, "emisor.ter_pct", ter)

    uso = _texto(perfil.get("distributionStrategy"))
    politica = _sin_vacios({"valor": POLITICA.get((uso or "").lower()), "texto": uso,
                            "frecuencia": _texto(perfil.get("fundDistributionFrequency"))})
    if politica:
        set_path(out, "emisor.politica", politica)

    metodo = _texto(perfil.get("etfReplicationMethodology"))
    replica = _sin_vacios({"tipo": REPLICA.get((metodo or "").lower()), "estructura": metodo})
    if replica:
        set_path(out, "emisor.replica", replica)

    referencia = _primero(_get(perfil, "benchmarkPolarisData", "FBPC")) or {}
    ticker = next((i.get("altIdValue") for i in referencia.get("identifiers") or []
                   if isinstance(i, dict) and i.get("altId") == "Ticker"), None)
    # El nombre largo trae entidades HTML (`S&amp;P`, `Poor&#8217;s`); el corto es la alternativa de la web.
    indice = _sin_vacios({"nombre": _texto(perfil.get("benchMarkNameFromECS"))
                          or _texto(referencia.get("benchmarkShortName")),
                          "ticker": _texto(ticker)})
    if indice:
        set_path(out, "emisor.indice", indice)


def _ter(perfil: dict) -> float | None:
    for tipo in _get(perfil, "feesAndExpenses", "feesAndExpensesType") or []:
        for gasto in _get(tipo, "expenseType") or []:
            if _get(gasto, "code") == "TOTEXPRTPC" and _es_numero(gasto.get("value")):
                return float(gasto["value"])
    return None


def _escribe_patrimonio(out: dict, datos: dict, perfil: dict) -> None:
    items = _get(_primero(_get(datos, "polarisAnalyticsHistory")), "monthly", "valuation", "fund", "items")
    valoracion = _primero(items) or {}
    divisa = perfil.get("fundCurrency")
    for clave, destino in (("TNA", "clase"), ("AUM", "fondo")):
        fila = next((f for f in valoracion.get(clave) or []
                     if isinstance(f, dict) and f.get("currency") == divisa), None)
        valor = _positivo(fila.get("fundAssetAmount")) if fila else None
        if valor is not None:
            set_path(out, f"emisor.patrimonio.{destino}", _sin_vacios({
                "valor": valor, "divisa": divisa, "fecha": _fecha_iso(fila.get("effectiveDate"))}))


# ------------------------------------------------------------------ dividendos
def _importe(pago: dict) -> tuple[float | None, set[str]]:
    filas = [t for t in pago.get("taxDetails") or [] if isinstance(t, dict)
             and t.get("distributionLevelCode") == "ACTL"
             and _get(t, "distributionType", "distCode") in TIPOS_REPARTO
             and _es_numero(t.get("distributionAmount"))]
    divisas = {t["currencyCode"] for t in filas if t.get("currencyCode")}
    importe = sum(float(t["distributionAmount"]) for t in filas)
    return (importe if importe > 0 else None), divisas


def _escribe_dividendos(out: dict, fondo: dict, descarga: str | None) -> None:
    pagos = _get(fondo, "distributionDetails", "periodicDistributions", "items") or []
    politica = (_get(out, "emisor", "politica") or {}).get("valor")
    if not pagos and politica != "distribucion":
        return
    historial, divisas = [], set()
    for pago in pagos:
        if not isinstance(pago, dict):
            continue
        importe, de_pago = _importe(pago)
        fecha_ex = _fecha_iso(pago.get("exDividendDate"))
        if importe is None or not fecha_ex:
            continue
        divisas |= de_pago
        historial.append(_sin_vacios({"fecha_ex": fecha_ex, "fecha_pago": _fecha_iso(pago.get("payableDate")),
                                      "fecha_registro": _fecha_iso(pago.get("recordDate")), "importe": importe}))
    set_path(out, "emisor.distribuciones.historial_consultado", True)
    set_path(out, "emisor.distribuciones.fecha_descarga", descarga)
    if not historial:
        return
    if len(divisas) == 1:
        set_path(out, "emisor.distribuciones.divisa", next(iter(divisas)))
        set_path(out, "emisor.distribuciones.divisa_origen", "declarada")
    set_path(out, "emisor.distribuciones.historial", sorted(historial, key=lambda f: f["fecha_ex"]))


# ------------------------------------------------------------------ VL
def _escribe_vl(out: dict, datos: dict, fetched_at: float | None, isin: str) -> None:
    items = _get(_primero(_get(datos, "funds")), "pricingDetails", "navPrices", "items") or []
    filas: dict[str, float] = {}
    divisas = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        fecha, vl = _fecha_iso(item.get("asOfDate")), _positivo(item.get("price"))
        if fecha and vl is not None:
            filas[fecha] = vl
            divisas.add(item.get("currencyCode"))
    if not filas:
        return
    if len(divisas) != 1:
        log.warning("vanguard %s: la serie de VL mezcla divisas (%s); no la uso", isin, sorted(map(str, divisas)))
        return
    fechas = sorted(filas)
    set_path(out, "emisor.vl", {
        "clase_de_serie": "VL_EMISOR",
        "divisa": next(iter(divisas)),
        "fuente": procedencia.etiqueta(FUENTE, ETAPA_VL),
        "fecha_descarga": _iso(fetched_at),
        "primera_fecha": fechas[0],
        "ultima_fecha": fechas[-1],
        "observaciones": len(fechas),
    })
    set_path(out, "series.vl_emisor", [{"fecha": f, "vl": filas[f]} for f in fechas])


# ------------------------------------------------------------------ posiciones
def _posicion(fila: dict) -> dict | None:
    peso = fila.get("marketValuePercentage")
    pos = {"ticker": _texto(fila.get("ticker")),
           "nombre": _texto(fila.get("issuerName")) or _texto(fila.get("securityLongDescription")),
           "sector": _texto(fila.get("gicsSectorDescription")),
           "clase_activo": _texto(fila.get("securityType")),
           "pais": _texto(fila.get("bloombergIsoCountry")),
           "sedol": _texto(fila.get("sedol1"))}
    if not _es_numero(peso) or not (pos["nombre"] or pos["ticker"] or pos["sedol"]):
        return None
    return _sin_vacios({**pos, "peso_pct": round(float(peso), 6)})


def _escribe_cartera(out: dict, http, id_emisor: str, settings: dict, force: bool, isin: str, url: str) -> None:
    """Pagina hasta acabar o hasta tener las que se guardan: la API las da ordenadas por peso."""
    maximo = cartera_emisor.tope(settings)
    posiciones: list[dict] = []
    fechas: set[str] = set()
    fetched_at, declarado, clave = None, None, None
    for _ in range(maximo // TAMANO_PAGINA + 2):
        r, datos = _consulta(http, Q_POSICIONES, {"portIds": [id_emisor], "lastItemKey": clave}, "cartera", force, isin)
        pagina = _get(_primero(_get(datos, "borHoldings")), "holdings")
        if not isinstance(pagina, dict):
            break
        fetched_at = r.fetched_at
        declarado = pagina.get("totalHoldings") if _es_numero(pagina.get("totalHoldings")) else declarado
        for fila in pagina.get("items") or []:
            pos = _posicion(fila) if isinstance(fila, dict) else None
            if pos:
                posiciones.append(pos)
                fecha = _fecha_iso(fila.get("effectiveDate"))
                if fecha:
                    fechas.add(fecha)
        clave = pagina.get("lastItemKey")
        if not clave or len(posiciones) >= maximo:
            break
    if not posiciones:
        return
    posiciones.sort(key=lambda p: -p["peso_pct"])
    con_exposicion = [p for p in posiciones if not str(p.get("clase_activo", "")).startswith(TIPOS_SIN_EXPOSICION)]
    recortada = bool(clave) or len(posiciones) > maximo
    with procedencia.etapa(ETAPA_POSICIONES, fetched_at, url=url):
        set_path(out, "emisor.cartera.fecha", max(fechas) if fechas else None)
        # Recortada, lo leído no es el total de la cartera: el total es el que declara el emisor.
        set_path(out, "emisor.cartera.num_posiciones",
                 int(declarado) if recortada and declarado is not None else len(posiciones))
        if declarado is not None:
            set_path(out, "emisor.cartera.num_posiciones_declarado", int(declarado))
        set_path(out, "emisor.cartera.peso_top10_pct", round(sum(p["peso_pct"] for p in con_exposicion[:10]), 2))
        if recortada:
            set_path(out, "emisor.cartera.posiciones_guardadas", min(maximo, len(posiciones)))
        set_path(out, "emisor.cartera.posiciones", posiciones[:maximo])


# ------------------------------------------------------------------ contraste con el KID
def _aviso_kid(isin: str, politica: str | None, previo: dict | None) -> list[dict]:
    """La política del emisor contra la que se leyó del KID: se avisa y el KID no se toca."""
    fichas = [d for d in (previo or {}).values() if isinstance(d, dict)]
    del_kid = next((k for k in (_get(d, "documentos_oficiales", "kid_politica") for d in fichas) if k), None)
    if not politica or not del_kid or del_kid == politica:
        return []
    log.warning("vanguard %s: el emisor declara %s y el KID %s", isin, politica, del_kid)
    return [{"codigo": "politica_distinta_del_kid", "emisor": politica, "kid": del_kid}]


# ------------------------------------------------------------------ utilidades
def _get(d: Any, *ruta: str) -> Any:
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _primero(lista: Any) -> Any:
    return lista[0] if isinstance(lista, list) and lista else None


def _sin_vacios(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


def _texto(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    texto = html.unescape(v).strip()
    return texto if texto.lower() not in SIN_DATO else None


def _es_numero(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _positivo(v: Any) -> float | None:
    return float(v) if _es_numero(v) and v > 0 else None


def _iso(epoca: float | None) -> str | None:
    if not epoca:
        return None
    return dt.datetime.fromtimestamp(epoca, dt.timezone.utc).isoformat(timespec="seconds")


def _fecha_iso(v: Any) -> str | None:
    return v[:10] if isinstance(v, str) and _ISO.match(v) else None
