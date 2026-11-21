"""Emisor Xtrackers (DWS): valor liquidativo y ficha declarados, de su web de producto.

Tercer adaptador de emisor (decisión 51, 08-11-2026), con la forma que fijó `ishares`.

**Tres peticiones por ISIN, sin cookies ni aviso aceptado:** la ficha en JSON, las posiciones en JSON y
el Excel histórico. Un ISIN que el emisor no conoce devuelve la ficha vacía, y el adaptador no aporta
nada: no es un error.

**El VL sale del Excel, no de la serie JSON del gráfico** (`performancechart`), aunque esa fuera la vía
del informe de fuentes. Medido el 08-11-2026: en una clase de reparto, el gráfico es rendimiento con
dividendos reinvertidos (LU0292096186, 100,78 el 05-11-2026 con un VL de 39,8958), y en un fondo
fusionado reescala la historia (IE00BM67HK77, hasta abril de 2016). El Excel trae el VL declarado, y
además el patrimonio con todos sus decimales y en la divisa de la clase. La ficha solo lo da redondeado
a tres cifras y convertido a la divisa del país de la web.

**La región y la clase de activo vienen de las etiquetas de analítica** (`tealium`): es donde la web
las declara para el producto propio. Las tarjetas «Popular products» de la misma respuesta llevan esos
mismos campos con nombre, pero son de otros ETF y no se leen.

**La web tiene aviso de entrada** en algunas fichas (`entryDisclaimer`, por ejemplo en los apalancados).
Las API responden sin contestarlo, y aquí no se contesta.

**Todo se escribe en el bloque `emisor`, y la serie de VL en `series.vl_emisor`**: los motivos están en
`ishares`. **El VL no entra en ninguna métrica** (decisión 52).

**En un ETF por swap las posiciones son la cesta de sustitución** (el emisor la titula «Substitute
basket»), y `emisor.cartera.naturaleza` lo declara; las contrapartes del swap van a su lado.

Nada se deduce del nombre: lo que la respuesta no trae se queda ausente.
"""
from __future__ import annotations

import datetime as dt
import logging
import re
import time
from pathlib import Path
from typing import Any

from core import cartera_emisor
from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.xtrackers")

FUENTE = "xtrackers"
ETAPA_FICHA = "ficha_producto"
ETAPA_POSICIONES = "posiciones"
ETAPA_EXCEL = "excel_historico"

# `en-lu`: etiquetas en inglés y sin el aviso propio del Reino Unido. La respuesta no cambia con el
# país salvo la divisa de presentación (medido contra `en-gb`: serie y pesos idénticos).
URL_FICHA = "https://etf.deutsche-am.com/api/pdp/en-lu/etf/{isin}/pdpMetaTagsTealium"
URL_POSICIONES = "https://etf.deutsche-am.com/api/pdp/en-lu/etf/{isin}/holdings"
# Las fechas fijas dan la historia entera y una URL estable. Medido: el fichero acaba en el último VL.
URL_EXCEL = ("https://etf.deutsche-am.com/etfdata/export/LUX/ENG/excel/product/composite/{isin}/"
             "1990-01-01/2099-12-31?aum=True&estg=False&index=False&interim=False&kstg=False"
             "&nav=True&monthlyperformance=False")

# Vocabulario medido en 14 ETF el 08-11-2026; lo que no esté aquí no se interpreta.
POLITICA = {"capitalizing": "acumulacion", "distributing": "distribucion"}
REPLICA = {"direct replication (physically)": "fisica", "indirect replication (swap)": "sintetica"}
MUESTREO = {"full replication": False, "optimised sampling": True}
# Los valores del filtro `Regions` del buscador del emisor. Las etiquetas traen también otras cosas:
# Capitalizing, Core, ESG, Savings Plan, Investment grade.
REGIONES = {"Developed Markets", "Emerging Markets", "Global", "Europe", "Eurozone", "North America",
            "Sector"}
SIN_DATO = {"", "--", "unknown", "n/a"}
COLUMNAS_POSICION = {"ISIN": "isin", "Name": "nombre", "Country": "pais", "Industry": "sector",
                     "Asset class": "clase_activo"}
COLUMNAS_DIVIDENDO = {"Ex Day": "fecha_ex", "Paydate": "fecha_pago", "Record date": "fecha_registro"}

_NOTA_AL_PIE = re.compile(r"<PageFootnoteReference\b.*?</PageFootnoteReference>", re.S)
_ETIQUETA = re.compile(r"<[^>]+>")
_FECHA = re.compile(r"(\d{2})[./](\d{2})[./](\d{4})")
_ISO = re.compile(r"\d{4}-\d{2}-\d{2}")
_PORCENTAJE = re.compile(r"(\d+(?:\.\d+)?)\s*%")


def fetch(isin: str, http, settings: dict, force: bool = False, previo: dict | None = None) -> dict:
    isin = isin.strip().upper()
    url_ficha = URL_FICHA.format(isin=isin)
    r = http.get(url_ficha, familia="precio", force=force)
    if not r.ok:
        log.warning("xtrackers %s: la ficha responde %s", isin, r.status)
        return {}
    ficha = _ficha(r, isin)
    if ficha is None:
        return {}

    out: dict = {}
    descarga = _iso(r.fetched_at)
    secciones = ficha["pdpResult"]["pageSections"]
    with procedencia.etapa(ETAPA_FICHA, r.fetched_at, url=url_ficha):
        set_path(out, "emisor.fuente", FUENTE)
        set_path(out, "emisor.id_emisor", isin)
        set_path(out, "emisor.fecha_descarga", descarga)
        _escribe_ficha(out, ficha, secciones)
        _escribe_dividendos(out, secciones, descarga)

    avisos: list[dict] = []
    url_excel = URL_EXCEL.format(isin=isin)
    excel = _lee_excel(_descarga_excel(url_excel, isin, http, force), isin)
    if excel:
        with procedencia.etapa(ETAPA_EXCEL, excel["fetched_at"], url=url_excel):
            _escribe_vl(out, excel)

    url_posiciones = URL_POSICIONES.format(isin=isin)
    r_pos = http.get(url_posiciones, familia="cartera", force=force)
    with procedencia.etapa(ETAPA_POSICIONES, r_pos.fetched_at, url=url_posiciones):
        _escribe_cartera(out, r_pos, secciones, settings)

    avisos += _aviso_kid(isin, (_get(out, "emisor", "politica") or {}).get("valor"), previo)
    if avisos:
        set_path(out, "emisor.avisos", avisos)
    log.info("xtrackers %s: VL hasta %s", isin, (_get(out, "emisor", "vl") or {}).get("ultima_fecha") or "?")
    return out


def _ficha(r, isin: str) -> dict | None:
    """La ficha pedida, o None si está vacía o es de otro producto."""
    try:
        datos = r.json()
    except ValueError:
        log.warning("xtrackers %s: la ficha no es JSON", isin)
        return None
    secciones = _get(datos, "pdpResult", "pageSections")
    if not isinstance(secciones, dict) or "keyFacts" not in secciones:
        return None
    if _hechos(secciones).get("isin") != isin:
        log.warning("xtrackers %s: la respuesta es de otro producto; no la uso", isin)
        return None
    return datos


# ------------------------------------------------------------------ lectura de la ficha
def _limpia(v: Any) -> str | None:
    """Texto sin notas al pie ni HTML (el nombre del índice lleva a veces una nota al pie)."""
    if not isinstance(v, str):
        return None
    texto = _ETIQUETA.sub("", _NOTA_AL_PIE.sub("", v)).strip()
    return texto if texto.lower() not in SIN_DATO else None


def _bloques(secciones: dict, seccion: str) -> list[dict]:
    return [a for a in _get(secciones, seccion, "accordionItems") or [] if isinstance(a, dict)]


def _bloque(secciones: dict, seccion: str, sufijo: str) -> dict:
    return next((a for a in _bloques(secciones, seccion) if str(a.get("id", "")).endswith(sufijo)), {})


def _pares(bloque: dict) -> dict[str, Any]:
    """Los pares clave-valor de un bloque de la ficha, con la clave en minúsculas y sin nota al pie."""
    items = list((bloque.get("list") or {}).get("items") or [])
    for grupo in bloque.get("listBundle") or []:
        items += grupo.get("items") or []
    return {(_limpia(i.get("key")) or "").lower(): i.get("value") for i in items if isinstance(i, dict)}


def _hechos(secciones: dict) -> dict[str, Any]:
    hechos: dict[str, Any] = {}
    for bloque in _bloques(secciones, "keyFacts"):
        hechos.update(_pares(bloque))
    return hechos


def _tabla(tabla: dict) -> tuple[dict[str, str], list[dict]]:
    """`{título de columna: clave}` y las filas."""
    columnas = {(c.get("emptyHeaderText") or c.get("value") or "").strip(): c.get("key")
                for c in tabla.get("columns") or [] if isinstance(c, dict)}
    return columnas, [f for f in tabla.get("values") or [] if isinstance(f, dict)]


def _celda(fila: dict, clave: str | None) -> dict:
    celda = fila.get(clave) if clave else None
    return celda if isinstance(celda, dict) and celda.get("type") != "empty" else {}


def _escribe_ficha(out: dict, ficha: dict, secciones: dict) -> None:
    hechos = _hechos(secciones)
    etiquetas = _get(ficha, "tealium", "attributes") or {}
    set_path(out, "emisor.nombre", _limpia(etiquetas.get("product_name")))
    categorias = etiquetas.get("product_category") or []
    if len(categorias) == 1:
        set_path(out, "emisor.clase_activo", _limpia(categorias[0]))
    region = [t for t in etiquetas.get("product_subcategory") or [] if t in REGIONES]
    if region:
        set_path(out, "emisor.region", region)
    set_path(out, "emisor.divisa_clase", _limpia(hechos.get("share class currency")))
    ter = _PORCENTAJE.search(str(hechos.get("fund all-in fee (ter)") or ""))
    if ter:
        set_path(out, "emisor.ter_pct", float(ter.group(1)))

    uso = _limpia(hechos.get("income treatment"))
    politica = _sin_vacios({"valor": POLITICA.get((uso or "").lower()), "texto": uso})
    if politica:
        set_path(out, "emisor.politica", politica)

    estructura = _limpia(hechos.get("investment methodology"))
    metodo = _limpia(hechos.get("portfolio structure"))
    replica = _sin_vacios({"tipo": REPLICA.get((estructura or "").lower()), "estructura": estructura,
                           "muestreo": MUESTREO.get((metodo or "").lower()), "metodo": metodo})
    if replica:
        set_path(out, "emisor.replica", replica)

    del_indice = _pares(_bloque(secciones, "indexKeyFacts", "keyfacts"))
    indice = _sin_vacios({"nombre": _limpia(del_indice.get("index name")),
                          "ticker": _limpia(del_indice.get("bloomberg index ticker"))})
    if indice:
        set_path(out, "emisor.indice", indice)


# ------------------------------------------------------------------ dividendos
def _escribe_dividendos(out: dict, secciones: dict, descarga: str | None) -> None:
    """La tabla solo existe en las clases que reparten. No declara divisa: la de la clase es supuesto."""
    columnas, filas = _tabla(_bloque(secciones, "keyFacts", "dividends").get("table") or {})
    politica = (_get(out, "emisor", "politica") or {}).get("valor")
    if not filas and politica != "distribucion":
        return
    historial = []
    for fila in filas:
        importe = _positivo(_celda(fila, columnas.get("Dividend per Share")).get("sortValue"))
        pago = {destino: _fecha_iso(_celda(fila, columnas.get(origen)).get("sortValue"))
                for origen, destino in COLUMNAS_DIVIDENDO.items()}
        if importe is not None and pago["fecha_ex"]:
            historial.append(_sin_vacios({**pago, "importe": importe}))
    set_path(out, "emisor.distribuciones.historial_consultado", True)
    set_path(out, "emisor.distribuciones.fecha_descarga", descarga)
    if not historial:
        return
    set_path(out, "emisor.distribuciones.divisa", _get(out, "emisor", "divisa_clase"))
    set_path(out, "emisor.distribuciones.divisa_origen", "divisa_de_la_clase")
    set_path(out, "emisor.distribuciones.historial", sorted(historial, key=lambda f: f["fecha_ex"]))


# ------------------------------------------------------------------ Excel histórico
def _descarga_excel(url: str, isin: str, http, force: bool) -> tuple[Path, float] | None:
    """El fichero en disco, con su antigüedad regida por la familia `precio`, como la caché JSON.

    `Http.download` reutiliza sin mirar la edad: aquí se le pide renovar lo caducado.
    """
    destino = Path(http.cache_dir) / "xtrackers_excel" / f"{isin}.xlsx"
    vigente = destino.exists() and (time.time() - destino.stat().st_mtime) / 86400 <= http.ttl_para("precio")
    ruta = http.download(url, destino, force=not vigente or (force and not http.sin_red),
                         opcional=True, familia="precio")
    if ruta is None:
        log.warning("xtrackers %s: el Excel histórico no está disponible", isin)
        return None
    return Path(ruta), Path(ruta).stat().st_mtime


def _lee_excel(fichero: tuple[Path, float] | None, isin: str) -> dict | None:
    """`{divisa, filas: [(fecha, patrimonio, vl)], fetched_at}`, ascendente; None si no es lo esperado."""
    if fichero is None:
        return None
    ruta, fetched_at = fichero
    from openpyxl import load_workbook  # solo este adaptador lo usa
    try:
        libro = load_workbook(ruta, read_only=True, data_only=True)
        crudas = list(libro.worksheets[0].iter_rows(values_only=True))
        libro.close()
    except Exception as e:  # noqa: BLE001  (lo descargado puede ser cualquier cosa, no solo un Excel roto)
        log.warning("xtrackers %s: el Excel histórico no se puede leer (%s)", isin, e)
        return None
    cabecera: dict[str, Any] = {}
    columnas: list | None = None
    filas: dict[str, tuple[float | None, float]] = {}
    for fila in crudas:
        if not fila or fila[0] is None:
            continue
        if columnas is None:
            if fila[0] == "Date":
                columnas = list(fila)
            elif len(fila) > 1:
                cabecera[str(fila[0])] = fila[1]
            continue
        vl = _positivo(_columna(fila, columnas, "NAV"))
        fecha = _fecha_iso(fila[0])
        if vl is not None and fecha:
            filas[fecha] = (_positivo(_columna(fila, columnas, "Asset Under Management")), vl)
    if cabecera.get("ISIN") != isin or not filas:
        log.warning("xtrackers %s: el Excel histórico no trae su serie", isin)
        return None
    return {"divisa": _limpia(cabecera.get("Currency")), "fetched_at": fetched_at,
            "filas": [(f, *filas[f]) for f in sorted(filas)]}


def _columna(fila: tuple, columnas: list, titulo: str) -> Any:
    return fila[columnas.index(titulo)] if titulo in columnas and columnas.index(titulo) < len(fila) else None


def _escribe_vl(out: dict, excel: dict) -> None:
    filas = excel["filas"]
    set_path(out, "emisor.vl", {
        "clase_de_serie": "VL_EMISOR",
        "divisa": excel["divisa"],
        "fuente": procedencia.etiqueta(FUENTE, ETAPA_EXCEL),
        "fecha_descarga": _iso(excel["fetched_at"]),
        "primera_fecha": filas[0][0],
        "ultima_fecha": filas[-1][0],
        "observaciones": len(filas),
    })
    set_path(out, "series.vl_emisor", [{"fecha": f, "vl": vl} for f, _, vl in filas])
    # El patrimonio es el del fondo, no el de la clase: coincide con «Total AUM of fund» de la ficha.
    con_patrimonio = [(f, p) for f, p, _ in filas if p is not None]
    if con_patrimonio:
        fecha, valor = con_patrimonio[-1]
        set_path(out, "emisor.patrimonio.fondo", _sin_vacios({"valor": valor, "divisa": excel["divisa"],
                                                               "fecha": fecha}))


# ------------------------------------------------------------------ posiciones
def _posiciones(r) -> list[dict]:
    try:
        tablas = (r.json() or {}).get("tables") or []  # un ISIN sin posiciones responde 204 y vacío
    except ValueError:
        return []
    if not tablas or not isinstance(tablas[0], dict):
        return []
    columnas, filas = _tabla(tablas[0])
    posiciones = []
    for fila in filas:
        peso = _celda(fila, columnas.get("% Weight")).get("sortValue")
        pos = {destino: _limpia(_celda(fila, columnas.get(origen)).get("value"))
               for origen, destino in COLUMNAS_POSICION.items()}
        # Hay filas con ISIN y peso sin nombre (LU0292096186, 3 de 94 con un 1,4 %): son posiciones.
        if not (pos["nombre"] or pos["isin"]) or not isinstance(peso, (int, float)) or isinstance(peso, bool):
            continue
        posiciones.append(_sin_vacios({**pos, "peso_pct": round(float(peso), 6)}))
    return posiciones


def _contrapartes(secciones: dict) -> list[dict]:
    columnas, filas = _tabla(_bloque(secciones, "keyFacts", "swapcounterparties").get("table") or {})
    salida = []
    for fila in filas:
        nombre = _limpia(_celda(fila, columnas.get("Counterparty")).get("value"))
        peso = _celda(fila, columnas.get("Gross exposure")).get("sortValue")
        if nombre and isinstance(peso, (int, float)) and not isinstance(peso, bool):
            salida.append({"nombre": nombre, "exposicion_bruta_pct": float(peso)})
    return sorted(salida, key=lambda c: -c["exposicion_bruta_pct"])


def _escribe_cartera(out: dict, r, secciones: dict, settings: dict) -> None:
    posiciones = _posiciones(r) if r.ok else []
    cartera = secciones.get("portfolio") or {}
    fecha = _fecha_iso(cartera.get("asOfDate"))
    es_cesta = ((_get(out, "emisor", "replica") or {}).get("tipo") == "sintetica"
                or "substitute" in str(cartera.get("headlineText") or "").lower())
    if posiciones:
        posiciones.sort(key=lambda p: -p["peso_pct"])
        maximo = cartera_emisor.tope(settings)
        set_path(out, "emisor.cartera.fecha", fecha)
        set_path(out, "emisor.cartera.num_posiciones", len(posiciones))
        set_path(out, "emisor.cartera.peso_top10_pct",
                 round(sum(p["peso_pct"] for p in posiciones[:10]), 2))
        if len(posiciones) > maximo:
            set_path(out, "emisor.cartera.posiciones_guardadas", maximo)
        set_path(out, "emisor.cartera.posiciones", posiciones[:maximo])

    exposicion = {}
    for tarjeta in _get(cartera, "charts", "cards") or []:
        titulo = _limpia(tarjeta.get("title")) if isinstance(tarjeta, dict) else None
        pesos = {}
        for dato in (tarjeta.get("data") or []) if titulo else []:
            nombre, peso = _limpia(dato.get("allocationName")), dato.get("weighting")
            if nombre and isinstance(peso, (int, float)) and not isinstance(peso, bool):
                pesos[nombre] = round(float(peso) * 100, 4)  # en tanto por uno; `weightingText` está mal
        if pesos:
            exposicion[titulo] = {"fecha": fecha, "pesos_pct": pesos}
    if exposicion:
        set_path(out, "emisor.cartera.exposicion", exposicion)

    contrapartes = _contrapartes(secciones)
    if contrapartes:
        set_path(out, "emisor.cartera.contrapartes", contrapartes)
    if es_cesta and (posiciones or exposicion or contrapartes):
        set_path(out, "emisor.cartera.naturaleza", "cesta_de_sustitucion")


# ------------------------------------------------------------------ contraste con el KID
def _aviso_kid(isin: str, politica: str | None, previo: dict | None) -> list[dict]:
    """La política del emisor contra la que se leyó del KID: se avisa y el KID no se toca."""
    fichas = [d for d in (previo or {}).values() if isinstance(d, dict)]
    del_kid = next((k for k in (_get(d, "documentos_oficiales", "kid_politica") for d in fichas) if k), None)
    if not politica or not del_kid or del_kid == politica:
        return []
    log.warning("xtrackers %s: el emisor declara %s y el KID %s", isin, politica, del_kid)
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


def _positivo(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def _iso(epoca: float | None) -> str | None:
    if not epoca:
        return None
    return dt.datetime.fromtimestamp(epoca, dt.timezone.utc).isoformat(timespec="seconds")


def _fecha_iso(v: Any) -> str | None:
    """`2026-08-19T00:00:00`, `05.11.2026`, `05/11/2026` o una fecha de Excel, a ISO."""
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    if not isinstance(v, str):
        return None
    if _ISO.match(v):
        return v[:10]
    m = _FECHA.search(v)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
