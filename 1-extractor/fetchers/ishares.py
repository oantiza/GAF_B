"""Emisor iShares (BlackRock): valor liquidativo y ficha declarados, de su fichero de producto.

Primer adaptador de emisor (decisión 51, 08-11-2026). Sustituye al lector de posiciones
`gestoras`, cuya ruta `.ajax` dejó de existir al cambiar la web de plataforma.

Tres peticiones, sin cookies ni aviso de inversor aceptado:

1. **Id propio**, por ISIN: la búsqueda de productos del sitio. Un ISIN que el emisor no conoce
   devuelve la lista vacía, y el adaptador no aporta nada: no es un error.
2. **Excel de producto** (`get-fund-document`), XML SpreadsheetML: VL histórico, hoja de datos clave
   y posiciones. Antes de escribir se comprueba que su ISIN es el pedido.
3. **Página de producto**, solo si la clase no acumula: los dividendos no van en el Excel.

**Todo se escribe en el bloque `emisor`, y la serie de VL en `series.vl_emisor`.** La fusión trabaja hoja a hoja y Morningstar y justETF van delante: en `cartera.*` el emisor solo rellenaría
huecos, y una fecha de una fuente acabaría junto a las posiciones de otra. Es la regla de
`esma_firds`: lo suyo al lado, sin pisar lo del sistema. Y fuera de `riesgo` y `cartera` a propósito:
`update.quality_regression_reason` cuenta las hojas de esos dos bloques, y miles de filas de serie o
posiciones harían saltar la guarda el día que el emisor no contestara. La serie va a `series` porque
ese bloque es el que `core.exporta` saca aparte, a `series.ndjson`: el documento ligero no la lleva.

**El VL no entra en ninguna métrica** (decisión 52): `riesgo.historial_precios` sigue siendo el
cierre ajustado de mercado (§11 del método).

Nada se deduce del nombre: lo que el fichero no trae se queda ausente.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import logging
import re
import xml.etree.ElementTree as ET
from typing import Any

from core import cartera_emisor
from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.ishares")

FUENTE = "ishares"

URL_BUSQUEDA = "https://www.ishares.com/varnish-api/core-search/search/products"
URL_EXCEL = ("https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v1/"
             "get-fund-document?appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=ishares-uk"
             "&locale=en_GB&portfolioId={id}&component=fundDownloadV2")
# El último segmento (el nombre del fondo en la web) no se comprueba, pero tiene que haberlo: sin él
# la web responde 403. Medido el 08-11-2026 con tres valores distintos: mismo contenido.
URL_PAGINA = "https://www.ishares.com/uk/individual/en/products/{id}/fund"

_NS = "{urn:schemas-microsoft-com:office:spreadsheet}"
# El fichero no es XML válido: «S&P» va sin escapar (medido en IE00B5BMR087 e IE00BDBRDM35).
_AMP_SUELTO = re.compile(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_FECHA = re.compile(r"(\d{1,2})[/ -]([A-Za-z]{3,9})[/ -](\d{4})")
_MESES = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
          "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
_IMPORTE = re.compile(r"^([A-Z]{3})\s+(.+)$")

POLITICA = {"accumulating": "acumulacion", "distributing": "distribucion"}
# Vocabulario medido en el fichero el 08-11-2026; lo que no esté aquí no se interpreta.
MUESTREO = {"optimised": True, "sampled": True, "replicated": False, "physical replication": False}
COLUMNAS_POSICION = {"issuer ticker": "ticker", "ticker": "ticker", "name": "nombre",
                     "isin": "isin", "sector": "sector", "asset class": "clase_activo",
                     "weight (%)": "peso_pct", "location": "pais", "market currency": "divisa",
                     "market value": "valor_mercado"}


def fetch(isin: str, http, settings: dict, force: bool = False, previo: dict | None = None) -> dict:
    isin = isin.strip().upper()
    id_propio = _resuelve_id(isin, http, force)
    if not id_propio:
        return {}

    url = URL_EXCEL.format(id=id_propio)
    r = http.get(url, familia="precio", force=force)
    if not r.ok:
        log.warning("ishares %s: el Excel de %s responde %s", isin, id_propio, r.status)
        return {}
    libro = _libro(r.text, isin)
    if libro is None:
        return {}
    datos = _datos_clave(libro)
    if (datos.get("isin") or {}).get("valor", "").strip().upper() != isin:
        log.warning("ishares %s: el Excel del id %s es de otro ISIN (%s); no lo uso", isin, id_propio,
                    (datos.get("isin") or {}).get("valor"))
        return {}

    out: dict = {}
    descarga = _iso(r.fetched_at)
    with procedencia.etapa("excel_producto", r.fetched_at, url=url):
        set_path(out, "emisor.fuente", FUENTE)
        set_path(out, "emisor.id_emisor", id_propio)
        set_path(out, "emisor.fecha_descarga", descarga)
        _escribe_vl(out, libro, datos, descarga)
        _escribe_ficha(out, libro, datos)
        _escribe_cartera(out, libro, settings)

    politica = (_get(out, "emisor", "politica") or {}).get("valor")
    if politica != "acumulacion":
        _escribe_dividendos(out, isin, id_propio, http, force, _divisa_clase(datos))

    avisos = _avisos(isin, politica, previo)
    if avisos:
        set_path(out, "emisor.avisos", avisos)
    log.info("ishares %s: id %s, VL hasta %s", isin, id_propio,
             (_get(out, "emisor", "vl") or {}).get("ultima_fecha") or "?")
    return out


# ------------------------------------------------------------------ id propio
def _resuelve_id(isin: str, http, force: bool) -> str | None:
    r = http.get(URL_BUSQUEDA, params={"site": "ishares-uk", "locale": "en-gb", "rows": "5",
                                       "start": "0", "query": isin},
                 familia="identidad", force=force)
    if not r.ok:
        log.warning("ishares %s: la búsqueda responde %s", isin, r.status)
        return None
    try:
        resultados = r.json().get("results") or []
    except (ValueError, AttributeError):
        log.warning("ishares %s: la búsqueda no devuelve JSON", isin)
        return None
    ids = {str(x.get("portfolioId")) for x in resultados
           if x.get("targetSite") == "ishares-uk" and x.get("portfolioId")}
    if len(ids) > 1:
        log.warning("ishares %s: la búsqueda da varios ids (%s); no elijo", isin, sorted(ids))
        return None
    return next(iter(ids), None)


# ------------------------------------------------------------------ Excel
def _libro(texto: str, isin: str) -> dict[str, list[list[str]]] | None:
    """Hoja -> filas de texto, o None si lo recibido no es el libro esperado."""
    texto = texto.lstrip("﻿ \r\n")
    if not texto.startswith("<?xml") or "<!DOCTYPE" in texto[:2000] or "<!ENTITY" in texto[:2000]:
        log.warning("ishares %s: lo recibido no es el Excel esperado", isin)
        return None
    try:
        raiz = ET.fromstring(_CONTROL.sub("", _AMP_SUELTO.sub("&amp;", texto)))
    except ET.ParseError as e:
        log.warning("ishares %s: Excel ilegible (%s)", isin, e)
        return None
    return {h.get(_NS + "Name"): [_fila(f) for f in h.iter(_NS + "Row")]
            for h in raiz.findall(_NS + "Worksheet")}


def _fila(fila: ET.Element) -> list[str]:
    celdas: list[str] = []
    for c in fila.findall(_NS + "Cell"):
        indice = c.get(_NS + "Index")
        if indice:  # `ss:Index` salta columnas vacías
            celdas.extend([""] * (int(indice) - 1 - len(celdas)))
        dato = c.find(_NS + "Data")
        celdas.append((dato.text or "").strip() if dato is not None else "")
    return celdas


def _datos_clave(libro: dict) -> dict[str, dict]:
    """Etiqueta en minúsculas -> {valor, fecha}, de `Key Facts` y `Portfolio Characteristics`."""
    salida: dict[str, dict] = {}
    for hoja in ("Key Facts", "Portfolio Characteristics"):
        for fila in libro.get(hoja) or []:
            if len(fila) >= 2 and fila[0]:
                fecha = _fecha_iso(fila[2]) if len(fila) > 2 else None
                salida[fila[0].lower()] = {"valor": fila[1], "fecha": fecha}
    return salida


def _valor(datos: dict, *etiquetas: str) -> str | None:
    for e in etiquetas:
        v = (datos.get(e) or {}).get("valor")
        if v not in (None, "", "-", "--"):
            return v
    return None


def _divisa_clase(datos: dict) -> str | None:
    return _valor(datos, "share class currency", "base currency", "fund base currency")


def _escribe_vl(out: dict, libro: dict, datos: dict, descarga: str | None) -> None:
    """`series.vl_emisor` y `emisor.vl` son la forma que repiten los demás adaptadores de emisor."""
    serie = {}
    for fila in libro.get("Historical NAVs") or []:
        fecha = _fecha_iso(fila[0]) if fila else None
        vl = _numero(fila[1]) if len(fila) > 1 else None
        if fecha and vl is not None and vl > 0:
            serie[fecha] = vl
    if not serie:
        return
    filas = [{"fecha": f, "vl": serie[f]} for f in sorted(serie)]
    set_path(out, "emisor.vl", {
        "clase_de_serie": "VL_EMISOR",
        "divisa": _divisa_de_cabecera(libro) or _divisa_clase(datos),
        "fuente": procedencia.etiqueta(FUENTE, "excel_producto"),
        "fecha_descarga": descarga,
        "primera_fecha": filas[0]["fecha"],
        "ultima_fecha": filas[-1]["fecha"],
        "observaciones": len(filas),
    })
    set_path(out, "series.vl_emisor", filas)


def _divisa_de_cabecera(libro: dict) -> str | None:
    """`USD 140.99`, la fila que sigue a `NAV as of ...`: es la divisa pegada a la cifra."""
    filas = libro.get("Fund Header") or []
    for i, fila in enumerate(filas[:-1]):
        if fila and fila[0].lower().startswith("nav as of"):
            m = _IMPORTE.match(filas[i + 1][0]) if filas[i + 1] else None
            return m.group(1) if m else None
    return None


def _escribe_ficha(out: dict, libro: dict, datos: dict) -> None:
    cabecera = libro.get("Fund Header") or []
    if cabecera and cabecera[0] and cabecera[0][0]:
        set_path(out, "emisor.nombre", cabecera[0][0])
    set_path(out, "emisor.clase_activo", _valor(datos, "asset class"))
    set_path(out, "emisor.divisa_clase", _divisa_clase(datos))
    set_path(out, "emisor.ter_pct", _numero(_valor(datos, "total expense ratio")))

    uso = _valor(datos, "use of income")
    politica = _sin_vacios({"valor": POLITICA.get((uso or "").lower()), "texto": uso,
                            "frecuencia": _valor(datos, "distribution frequency")})
    if politica:
        set_path(out, "emisor.politica", politica)

    estructura, metodo = _valor(datos, "product structure"), _valor(datos, "methodology")
    replica = _sin_vacios({"tipo": _tipo_replica(estructura), "estructura": estructura,
                           "muestreo": MUESTREO.get((metodo or "").lower()), "metodo": metodo})
    if replica:
        set_path(out, "emisor.replica", replica)

    indice = _sin_vacios({"nombre": _valor(datos, "benchmark index", "index"),
                          "ticker": _valor(datos, "benchmark ticker")})
    if indice:
        set_path(out, "emisor.indice", indice)

    # `Net Assets` a secas es la de la clase: el fichero las llama de dos formas según el fondo.
    for destino, etiquetas in (("clase", ("net assets of share class", "net assets")),
                               ("fondo", ("net assets of fund",))):
        patrimonio = _patrimonio(datos, etiquetas)
        if patrimonio:
            set_path(out, f"emisor.patrimonio.{destino}", patrimonio)


def _tipo_replica(estructura: str | None) -> str | None:
    e = (estructura or "").lower()
    if e.startswith("physical"):
        return "fisica"
    if "synthetic" in e or "swap" in e:
        return "sintetica"
    return None


def _patrimonio(datos: dict, etiquetas: tuple[str, ...]) -> dict | None:
    for e in etiquetas:
        crudo = (datos.get(e) or {}).get("valor") or ""
        m = _IMPORTE.match(crudo)
        valor = _numero(m.group(2)) if m else None
        if valor is not None:
            return _sin_vacios({"valor": valor, "divisa": m.group(1), "fecha": datos[e].get("fecha")})
    return None


def _secciones(filas: list[list[str]]) -> dict[str, dict]:
    """Título -> {fecha, cabecera, filas}: una hoja son bloques `título` / `as of` / cabecera."""
    salida: dict[str, dict] = {}
    i = 0
    while i < len(filas) - 2:
        fila = [c for c in filas[i] if c]
        if len(fila) == 1 and filas[i + 1][:1] == ["as of"]:
            datos, j = [], i + 3
            while j < len(filas) and any(filas[j]):
                datos.append(filas[j])
                j += 1
            salida[fila[0]] = {"fecha": _fecha_iso(filas[i + 1][1]) if len(filas[i + 1]) > 1 else None,
                               "cabecera": [c.lower() for c in filas[i + 2]], "filas": datos}
            i = j
        else:
            i += 1
    return salida


def _posiciones(seccion: dict) -> list[dict]:
    indices = {COLUMNAS_POSICION[c]: j for j, c in enumerate(seccion["cabecera"])
               if c in COLUMNAS_POSICION}
    if "peso_pct" not in indices or "nombre" not in indices:
        return []
    posiciones = []
    for fila in seccion["filas"]:
        pos: dict[str, Any] = {}
        for destino, j in indices.items():
            v = fila[j] if j < len(fila) else ""
            if destino == "valor_mercado":
                # `USD 12,044,965,532.32`: la divisa va pegada a la cifra, y es la de la cartera, no la de la línea.
                # El peso del fichero es este valor sobre la suma de la cartera, redondeado a dos decimales
                # (medido el 11-11-2026 en cinco ETF: nunca más de 0,005 puntos de diferencia). Con unas
                # 20.000 líneas de 0,00 a 0,01 % el redondeo se come un cuarto de la cartera, y este valor no.
                m = _IMPORTE.match(v)
                importe = _numero(m.group(2)) if m else None
                if importe is not None:
                    pos["valor_mercado"], pos["divisa_valor_mercado"] = importe, m.group(1)
                continue
            pos[destino] = _numero(v) if destino == "peso_pct" else (v if v not in ("", "-") else None)
        if pos.get("nombre") and pos.get("peso_pct") is not None:
            posiciones.append(_sin_vacios(pos))
    return posiciones


def _escribe_cartera(out: dict, libro: dict, settings: dict) -> None:
    secciones = _secciones(libro.get("Holdings") or [])
    # `All` es la lista completa; antes puede venir un resumen (`Top Issuers`).
    candidatas = [secciones["All"]] if "All" in secciones else list(secciones.values())
    posiciones = next((p for p in map(_posiciones, candidatas) if p), [])
    if posiciones:
        fecha = next(s["fecha"] for s in candidatas if _posiciones(s))
        posiciones.sort(key=lambda p: -p["peso_pct"])
        maximo = cartera_emisor.tope(settings)
        set_path(out, "emisor.cartera.fecha", fecha)
        set_path(out, "emisor.cartera.num_posiciones", len(posiciones))
        set_path(out, "emisor.cartera.peso_top10_pct",
                 round(sum(p["peso_pct"] for p in posiciones[:10]), 2))
        if len(posiciones) > maximo:
            set_path(out, "emisor.cartera.posiciones_guardadas", maximo)
        set_path(out, "emisor.cartera.posiciones", posiciones[:maximo])
    set_path(out, "emisor.cartera.num_posiciones_declarado",
             _entero(_valor(_datos_clave(libro), "number of holdings")))

    exposicion = {}
    for titulo, s in _secciones(libro.get("Exposure Breakdowns") or []).items():
        if "fund" not in s["cabecera"]:
            continue
        j = s["cabecera"].index("fund")
        pesos = {f[0]: _numero(f[j]) for f in s["filas"] if len(f) > j and f[0]}
        pesos = {k: v for k, v in pesos.items() if v is not None}
        if pesos:
            exposicion[titulo] = {"fecha": s["fecha"], "pesos_pct": pesos}
    if exposicion:
        set_path(out, "emisor.cartera.exposicion", exposicion)


# ------------------------------------------------------------------ dividendos
def _escribe_dividendos(out: dict, isin: str, id_propio: str, http, force: bool,
                        divisa: str | None) -> None:
    url = URL_PAGINA.format(id=id_propio)
    r = http.get(url, familia="analitica", force=force)
    if not r.ok:
        log.warning("ishares %s: la página de producto responde %s; sin dividendos", isin, r.status)
        return
    historial = _dividendos(r.text)
    if historial is None:
        log.info("ishares %s: la página no trae la tabla de dividendos", isin)
        return
    with procedencia.etapa("pagina_producto", r.fetched_at, url=url):
        set_path(out, "emisor.distribuciones.historial_consultado", True)
        set_path(out, "emisor.distribuciones.fecha_descarga", _iso(r.fetched_at))
        if historial:
            # La tabla no declara divisa: se anota que es la de la clase y que eso es un supuesto.
            set_path(out, "emisor.distribuciones.divisa", divisa)
            set_path(out, "emisor.distribuciones.divisa_origen", "divisa_de_la_clase")
            set_path(out, "emisor.distribuciones.historial", historial)


def _dividendos(texto: str) -> list[dict] | None:
    """Filas de `performance.distributions.table`, o None si no está la tabla o no cuadra."""
    t = html.unescape(texto)
    marca = t.find('"fullName":"performance.distributions.table"')
    inicio = t.find('"dataPointsByNameMap":', marca) if marca >= 0 else -1
    if inicio < 0:
        return None
    try:
        puntos, _ = json.JSONDecoder().raw_decode(t, t.index("{", inicio))
    except ValueError:
        return None
    columnas = {k: (puntos.get(k) or {}).get("value") or []
                for k in ("exDate", "payableDate", "recordDate", "totalDistribution")}
    if len({len(v) for v in columnas.values()}) != 1:
        return None
    filas = []
    for ex, pago, registro, importe in zip(*columnas.values()):
        fila = _sin_vacios({"fecha_ex": _fecha_entera(ex), "fecha_pago": _fecha_entera(pago),
                            "fecha_registro": _fecha_entera(registro), "importe": _numero(str(importe))})
        if fila.get("fecha_ex") and fila.get("importe") is not None:
            filas.append(fila)
    return sorted(filas, key=lambda f: f["fecha_ex"])


# ------------------------------------------------------------------ contraste con el KID
def _avisos(isin: str, politica: str | None, previo: dict | None) -> list[dict]:
    """La política del emisor contra la que se leyó del KID: se avisa y el KID no se toca."""
    fichas = [d for d in (previo or {}).values() if isinstance(d, dict)]
    del_kid = next((k for k in (_get(d, "documentos_oficiales", "kid_politica") for d in fichas) if k), None)
    if not politica or not del_kid or del_kid == politica:
        return []
    log.warning("ishares %s: el emisor declara %s y el KID %s", isin, politica, del_kid)
    return [{"codigo": "politica_distinta_del_kid", "emisor": politica, "kid": del_kid}]


# ------------------------------------------------------------------ utilidades
def _get(d: Any, *ruta: str) -> Any:
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _sin_vacios(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


def _iso(epoca: float | None) -> str | None:
    if not epoca:
        return None
    return dt.datetime.fromtimestamp(epoca, dt.timezone.utc).isoformat(timespec="seconds")


def _fecha_iso(v: str) -> str | None:
    """`06/Nov/2026`, `30/Sept/2026` o `as of 06/Nov/2026`."""
    m = _FECHA.search(v or "")
    mes = _MESES.get(m.group(2)[:3].lower()) if m else None
    if not mes:
        return None
    try:
        return dt.date(int(m.group(3)), mes, int(m.group(1))).isoformat()
    except ValueError:
        return None


def _fecha_entera(v: Any) -> str | None:
    """`20260917` -> `2026-09-17`; el 0 o un valor vacío son ausencia."""
    t = str(v or "")
    return f"{t[:4]}-{t[4:6]}-{t[6:8]}" if re.fullmatch(r"\d{8}", t) else None


def _numero(v: str | None) -> float | None:
    """Formato inglés, como el del fichero: `1,234.56`, `0.20%`."""
    if not v:
        return None
    try:
        return float(v.replace(",", "").replace("%", "").strip())
    except ValueError:
        return None


def _entero(v: str | None) -> int | None:
    n = _numero(v)
    return int(n) if n is not None else None
