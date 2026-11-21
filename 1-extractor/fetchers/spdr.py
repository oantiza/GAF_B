"""Emisor SPDR (State Street): valor liquidativo y ficha declarados, de su catálogo y sus Excel.

Quinto adaptador de emisor (decisión 51, 08-11-2026), con la forma que fijó `ishares`.

**Una sola petición resuelve el ISIN para todo el catálogo.** `fundfinder` lista los ETF de SPDR, con
un ISIN por entrada en `keywords` (179 UCITS y 30 estadounidenses, los 209 con exactamente uno), y da
TER, categorías y la ruta de cada fichero. Un ISIN fuera del catálogo no es un error: no aporta nada.

**El VL y las posiciones salen de los XLSX de cada ETF.** El VL es el declarado, sin ajustar por
dividendos. Una clase de reparto lo lleva cayendo en cada fecha ex: quien pinte la prima lo ajusta,
como en `ishares`. **En IE00BKWQ0M75 la serie empieza en 2005 y el fondo irlandés se lanzó el 05-12-2014**:
lo anterior es de su predecesor, sin participaciones en esas filas. Se guarda tal cual y
`emisor.fecha_lanzamiento` dice la fecha real. El catálogo da la del historial de rentabilidad, y por
eso esa fecha se toma de la ficha.

**Los dividendos están en un Excel común a todos los ETF**, enlazado desde «Dividend Distributions» del
mismo dominio: el informe de fuentes no lo encontró. El VL de la fecha ex del fichero coincide con la
serie. Trae divisa, así que `divisa_origen` es `declarada`.

**La ficha HTML solo se usa para lo que no está en otro sitio:** índice, réplica, frecuencia, divisa y
fecha de lanzamiento. Un ETF estadounidense no declara réplica ni tratamiento de rentas: se quedan
ausentes, aunque SPY reparta. Su `ger` es gasto bruto, no un TER, y tampoco se escribe como tal.

**Las posiciones son del fondo, no de la clase**: las de las clases cubiertas son idénticas y no llevan
los forwards de cobertura. Los futuros y saldos en divisa vienen sin peso y no se guardan.

**Todo se escribe en el bloque `emisor`, y la serie de VL en `series.vl_emisor`**: los motivos están en
`ishares`. **El VL no entra en ninguna métrica** (decisión 52).

Sin aceptar ningún aviso. Lo que no viene se queda ausente.
"""
from __future__ import annotations

import datetime as dt
import functools
import html
import logging
import re
import time
import warnings
from pathlib import Path
from typing import Any

from core import cartera_emisor
from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.spdr")

FUENTE = "spdr"
ETAPA_FICHA = "ficha_producto"
ETAPA_VL = "vl_historico"
ETAPA_POSICIONES = "posiciones"
ETAPA_DIVIDENDOS = "dividendos"

URL_BASE = "https://www.ssga.com"
URL_CATALOGO = (f"{URL_BASE}/bin/v1/ssmp/fund/fundfinder?country=uk&language=en_gb"
                "&role=intermediary&product=etfs&ui=fund-finder")
URL_DIVIDENDOS = f"{URL_BASE}/library-content/products/fund-data/etfs/emea/spdr-etf-historical-distributions-uk-en.xlsx"

# Vocabulario medido en 15 ETF el 08-11-2026; lo que no esté aquí no se interpreta.
POLITICA = {"accumulation": "acumulacion", "distribution": "distribucion"}
# Los tres métodos son físicos. No hay sintéticos en la medida, y otro literal no se clasifica.
REPLICA = {"stratified sampling": "fisica", "optimised": "fisica", "replicated": "fisica"}
MUESTREO = {"stratified sampling": True, "optimised": True, "replicated": False}
SIN_DATO = {"", "-", "n/a", "unassigned"}

COLUMNAS_POSICION = {"ISIN": "isin", "SEDOL": "sedol", "Security Name": "nombre", "Name": "nombre",
                     "Ticker": "ticker", "Currency": "divisa", "Currency Local": "divisa",
                     "Local Currency": "divisa", "Sector Classification": "sector", "Sector": "sector",
                     "Trade Country Name": "pais", "Country of Issue": "pais"}
COLUMNAS_PESO = ("Percent of Fund", "Weight")
# `Total Net Assets` lo llevan los fondos de una clase; los de varias separan clase y fondo.
COLUMNAS_PATRIMONIO = {"Share Class Assets": "clase", "Total Net Assets": "fondo", "Total Fund Assets": "fondo"}

_MESES = {m: i for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}
_ISIN = re.compile(r"\b[A-Z]{2}[A-Z0-9]{9}\d\b")
_FECHA_MES = re.compile(r"(\d{1,2})-([A-Za-z]{3})-(\d{4})")
_FECHA_BARRAS = re.compile(r"(\d{2})/(\d{2})/(\d{4})$")
_FILA_FICHA = re.compile(r'<th class="label" scope="row">\s*([^<]+?)\s*</th>\s*<td class="data">\s*([^<]*?)\s*</td>')
_DIVISA_COLUMNA = re.compile(r"\(([A-Z]{3})\)")


def fetch(isin: str, http, settings: dict, force: bool = False, previo: dict | None = None) -> dict:
    isin = isin.strip().upper()
    r, entrada, categorias = _busca_en_catalogo(isin, http, force)
    if entrada is None:
        return {}
    descarga = _iso(r.fetched_at)
    id_emisor = _texto(entrada.get("fundFilter"))
    url_ficha = f"{URL_BASE}{entrada.get('fundUri', '')}"
    documentos = _documentos(entrada)

    ficha = _lee_ficha(http, url_ficha, isin, force)
    nav = _lee_nav(http, documentos.get("Navhist"), isin, entrada, force)

    out: dict = {}
    with procedencia.etapa(ETAPA_FICHA, r.fetched_at, url=URL_CATALOGO):
        set_path(out, "emisor.fuente", FUENTE)
        set_path(out, "emisor.id_emisor", id_emisor)
        set_path(out, "emisor.fecha_descarga", descarga)
        _escribe_ficha(out, entrada, categorias, ficha, nav)

    if nav is not None:
        with procedencia.etapa(ETAPA_VL, nav["fetched_at"], url=nav["url"]):
            _escribe_vl(out, nav)

    _escribe_cartera(out, http, documentos.get("Holdings-daily"), isin, entrada, settings, force)
    _escribe_dividendos(out, http, isin, force)

    avisos = _aviso_kid(isin, (_get(out, "emisor", "politica") or {}).get("valor"), previo)
    if avisos:
        set_path(out, "emisor.avisos", avisos)
    log.info("spdr %s: VL hasta %s", isin, (_get(out, "emisor", "vl") or {}).get("ultima_fecha") or "?")
    return out


# ------------------------------------------------------------------ catálogo
def _busca_en_catalogo(isin: str, http, force: bool) -> tuple[Any, dict | None, dict]:
    """La respuesta, la entrada del ISIN y `{categoría: subcategoría}` de esa entrada."""
    r = http.get(URL_CATALOGO, familia="precio", force=force, headers={"Accept": "*/*"})
    if not r.ok:
        log.warning("spdr %s: el catálogo responde %s", isin, r.status)
        return r, None, {}
    try:
        grupos = r.json()["data"]["funds"]
    except (ValueError, KeyError, TypeError):
        log.warning("spdr %s: el catálogo no trae la forma esperada", isin)
        return r, None, {}
    if not isinstance(grupos, dict):
        return r, None, {}
    for grupo in grupos.values():
        if not isinstance(grupo, dict):
            continue
        for entrada in grupo.get("datas") or []:
            if isinstance(entrada, dict) and isin in _ISIN.findall(str(entrada.get("keywords", ""))):
                return r, entrada, _categorias(grupo, entrada)
    return r, None, {}


def _categorias(grupo: dict, entrada: dict) -> dict:
    filtro = entrada.get("fundFilter")
    salida: dict[str, str] = {}
    for categoria in grupo.get("categories") or []:
        if not isinstance(categoria, dict):
            continue
        for sub in categoria.get("subCategories") or []:
            if isinstance(sub, dict) and filtro in str(sub.get("funds", "")).split("|"):
                salida[categoria.get("key")] = sub.get("name")
                break
    return salida


def _documentos(entrada: dict) -> dict[str, str]:
    salida: dict[str, str] = {}
    for grupo in entrada.get("documentPdf") or []:
        docs = grupo.get("docs") if isinstance(grupo, dict) else None
        if isinstance(docs, list) and docs and isinstance(docs[0], dict) and docs[0].get("path"):
            salida[grupo.get("docType")] = docs[0]["path"]
    return salida


# ------------------------------------------------------------------ ficha
def _lee_ficha(http, url: str, isin: str, force: bool) -> dict[str, str]:
    """Las filas `etiqueta: valor` de la ficha; {} si la página no es la de este ISIN."""
    r = http.get(url, familia="analitica", force=force, headers={"Accept": "*/*"})
    if not r.ok or isin not in r.text:
        log.warning("spdr %s: la ficha no está disponible (%s)", isin, r.status)
        return {}
    return {html.unescape(a): html.unescape(b) for a, b in _FILA_FICHA.findall(r.text)}


def _escribe_ficha(out: dict, entrada: dict, categorias: dict, ficha: dict, nav: dict | None) -> None:
    set_path(out, "emisor.nombre", _texto(entrada.get("fundName")))
    set_path(out, "emisor.clase_activo", _texto(categorias.get("assetclass")))
    if not (nav or {}).get("divisa"):
        set_path(out, "emisor.divisa_clase", _divisa_de_ficha(ficha))
    set_path(out, "emisor.fecha_lanzamiento", _fecha(ficha.get("Inception Date")))
    ter = entrada.get("ter")
    if isinstance(ter, list) and len(ter) > 1 and _es_numero(ter[1]):
        set_path(out, "emisor.ter_pct", float(ter[1]))

    tratamiento = _texto(categorias.get("fund-income-treatment"))
    politica = _sin_vacios({"valor": POLITICA.get((tratamiento or "").lower()), "texto": tratamiento,
                            "frecuencia": _texto(ficha.get("Distribution Frequency"))})
    if politica:
        set_path(out, "emisor.politica", politica)

    metodo = _texto(ficha.get("Replication Method"))
    clave = (metodo or "").lower()
    replica = _sin_vacios({"tipo": REPLICA.get(clave), "muestreo": MUESTREO.get(clave), "metodo": metodo})
    if replica:
        set_path(out, "emisor.replica", replica)

    indice = _texto(ficha.get("Benchmark"))
    if indice:
        set_path(out, "emisor.indice", {"nombre": indice})


def _divisa_de_ficha(ficha: dict) -> str | None:
    return next((v for v in (_texto(ficha.get(k)) for k in
                             ("Share Class Currency", "Base Fund Currency", "Base Currency")) if v), None)


# ------------------------------------------------------------------ Excel
def _descarga(http, url: str, nombre: str, familia: str, force: bool) -> tuple[Path, float] | None:
    """El fichero en disco, con su antigüedad regida por la familia, como la caché JSON."""
    destino = Path(http.cache_dir) / "spdr_excel" / f"{nombre}.xlsx"
    vigente = destino.exists() and (time.time() - destino.stat().st_mtime) / 86400 <= http.ttl_para(familia)
    ruta = http.download(url, destino, force=not vigente or (force and not http.sin_red),
                         opcional=True, familia=familia)
    if ruta is None:
        return None
    return Path(ruta), Path(ruta).stat().st_mtime


def _hojas(ruta: Path, etiqueta: str) -> list[list[tuple]] | None:
    from openpyxl import load_workbook  # solo los adaptadores que leen Excel lo usan
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # «Workbook contains no default style»: los ficheros vienen así
            libro = load_workbook(ruta, read_only=True, data_only=True)
            hojas = [list(h.iter_rows(values_only=True)) for h in libro.worksheets]
            libro.close()
        return hojas
    except Exception as e:  # noqa: BLE001  (lo descargado puede ser cualquier cosa, no solo un Excel roto)
        log.warning("spdr %s: el Excel no se puede leer (%s)", etiqueta, e)
        return None


def _separa(filas: list[tuple], primera: str) -> tuple[dict, list | None, list[tuple]]:
    """Cabecera `etiqueta: valor`, títulos de columna (la fila que empieza por `primera`) y datos."""
    cabecera: dict[str, Any] = {}
    for i, fila in enumerate(filas):
        if fila and fila[0] == primera:
            return cabecera, list(fila), filas[i + 1:]
        if fila and isinstance(fila[0], str) and fila[0].endswith(":") and len(fila) > 1:
            cabecera[fila[0][:-1]] = fila[1]
    return cabecera, None, []


def _es_del_etf(cabecera: dict, isin: str, entrada: dict) -> bool:
    """El ISIN de la cabecera; los ETF estadounidenses no lo llevan y se reconocen por el nombre."""
    if "ISIN" in cabecera:
        return cabecera["ISIN"] == isin
    return cabecera.get("Fund Name") == entrada.get("fundName")


def _lee_nav(http, ruta_doc: str | None, isin: str, entrada: dict, force: bool) -> dict | None:
    if not ruta_doc:
        return None
    url = f"{URL_BASE}{ruta_doc}"
    fichero = _descarga(http, url, f"nav_{isin}", "precio", force)
    hojas = _hojas(fichero[0], isin) if fichero else None
    if not hojas:
        return None
    cabecera, columnas, datos = _separa(hojas[0], "Date")
    if columnas is None or not _es_del_etf(cabecera, isin, entrada):
        log.warning("spdr %s: el Excel de VL no trae su serie", isin)
        return None
    filas: dict[str, tuple] = {}
    for fila in datos:
        fecha = _fecha(fila[0] if fila else None)
        vl = _positivo(fila[1]) if fecha and len(fila) > 1 else None
        if vl is not None:
            filas[fecha] = fila
    if not filas:
        log.warning("spdr %s: el Excel de VL no trae valores", isin)
        return None
    divisa = _texto(cabecera.get("NAV Currency"))
    fechas = sorted(filas)
    return {"divisa": divisa, "fetched_at": fichero[1], "url": url,
            "serie": [{"fecha": f, "vl": _positivo(filas[f][1])} for f in fechas],
            "patrimonio": _patrimonio(columnas, filas, fechas, divisa)}


def _patrimonio(columnas: list, filas: dict, fechas: list[str], divisa: str | None) -> dict:
    """Lo más reciente de cada columna, en la divisa que indica su título o en la del VL."""
    salida: dict[str, dict] = {}
    for indice, titulo in enumerate(columnas):
        destino = next((d for t, d in COLUMNAS_PATRIMONIO.items() if str(titulo).startswith(t)), None)
        if destino is None:
            continue
        for fecha in reversed(fechas):
            fila = filas[fecha]
            valor = _positivo(fila[indice]) if indice < len(fila) else None
            if valor is not None:
                en_titulo = _DIVISA_COLUMNA.search(str(titulo))
                salida[destino] = _sin_vacios({"valor": valor, "divisa": en_titulo.group(1) if en_titulo else divisa,
                                               "fecha": fecha})
                break
    return salida


def _escribe_vl(out: dict, nav: dict) -> None:
    serie = nav["serie"]
    if nav["divisa"]:
        set_path(out, "emisor.divisa_clase", nav["divisa"])
    divisa = _get(out, "emisor", "divisa_clase")
    for destino, dato in nav["patrimonio"].items():
        set_path(out, f"emisor.patrimonio.{destino}", _sin_vacios({**dato, "divisa": dato.get("divisa") or divisa}))
    set_path(out, "emisor.vl", _sin_vacios({
        "clase_de_serie": "VL_EMISOR",
        "divisa": divisa,
        "fuente": procedencia.etiqueta(FUENTE, ETAPA_VL),
        "fecha_descarga": _iso(nav["fetched_at"]),
        "primera_fecha": serie[0]["fecha"],
        "ultima_fecha": serie[-1]["fecha"],
        "observaciones": len(serie),
    }))
    set_path(out, "series.vl_emisor", serie)


# ------------------------------------------------------------------ posiciones
def _posicion(fila: tuple, columnas: list, indice_peso: int) -> dict | None:
    peso = _numero(fila[indice_peso]) if indice_peso < len(fila) else None
    if peso is None:
        return None
    pos: dict[str, Any] = {}
    for i, titulo in enumerate(columnas):
        clave = COLUMNAS_POSICION.get(titulo)
        if clave and i < len(fila):
            pos[clave] = _texto(fila[i])
    if not (pos.get("nombre") or pos.get("isin")):
        return None
    return _sin_vacios({**pos, "peso_pct": round(peso, 6)})


def _escribe_cartera(out: dict, http, ruta_doc: str | None, isin: str, entrada: dict,
                     settings: dict, force: bool) -> None:
    if not ruta_doc:
        return
    url = f"{URL_BASE}{ruta_doc}"
    fichero = _descarga(http, url, f"pos_{isin}", "cartera", force)
    hojas = _hojas(fichero[0], isin) if fichero else None
    if not hojas:
        return
    columna = "ISIN" if any(f and f[0] == "ISIN" for f in hojas[0][:12]) else "Name"
    cabecera, columnas, datos = _separa(hojas[0], columna)
    if columnas is None or not _es_del_etf(cabecera, isin, entrada):
        log.warning("spdr %s: el Excel de posiciones no es el suyo", isin)
        return
    indice_peso = next((columnas.index(c) for c in COLUMNAS_PESO if c in columnas), None)
    if indice_peso is None:
        return
    posiciones = [p for p in (_posicion(f, columnas, indice_peso) for f in datos if f) if p]
    if not posiciones:
        return
    posiciones.sort(key=lambda p: -p["peso_pct"])
    maximo = cartera_emisor.tope(settings)
    con_exposicion = [p for p in posiciones if not str(p.get("nombre", "")).startswith("Cash_")]
    with procedencia.etapa(ETAPA_POSICIONES, fichero[1], url=url):
        set_path(out, "emisor.cartera.fecha", _fecha(cabecera.get("Holdings As Of") or cabecera.get("Holdings")))
        set_path(out, "emisor.cartera.num_posiciones", len(posiciones))
        set_path(out, "emisor.cartera.peso_top10_pct", round(sum(p["peso_pct"] for p in con_exposicion[:10]), 2))
        if len(posiciones) > maximo:
            set_path(out, "emisor.cartera.posiciones_guardadas", maximo)
        set_path(out, "emisor.cartera.posiciones", posiciones[:maximo])


# ------------------------------------------------------------------ dividendos
@functools.lru_cache(maxsize=1)
def _distribuciones(ruta: str, _mtime: float) -> dict[str, list[dict]] | None:
    """`{ISIN: filas}` de todo el fichero, que es común: se lee una vez aunque se pidan muchos ETF."""
    hojas = _hojas(Path(ruta), "dividendos")
    if hojas is None:
        return None
    por_isin: dict[str, list[dict]] = {}
    for filas in hojas:
        _, columnas, datos = _separa(filas, "FUND UMBRELLA")
        if columnas is None:
            continue
        for fila in datos:
            registro = dict(zip(columnas, fila))
            if registro.get("ISIN"):
                por_isin.setdefault(str(registro["ISIN"]).strip(), []).append(registro)
    return por_isin


def _escribe_dividendos(out: dict, http, isin: str, force: bool) -> None:
    fichero = _descarga(http, URL_DIVIDENDOS, "distribuciones", "precio", force)
    tabla = _distribuciones(str(fichero[0]), fichero[1]) if fichero else None
    if tabla is None:
        return
    filas = tabla.get(isin) or []
    politica = (_get(out, "emisor", "politica") or {}).get("valor")
    if not filas and politica != "distribucion":
        return
    historial, divisas = [], set()
    for fila in filas:
        importe, fecha_ex = _positivo(fila.get("DISTRIBUTION")), _fecha(fila.get("EX-DATE"))
        if importe is None or not fecha_ex:
            continue
        if _texto(fila.get("CURRENCY")):
            divisas.add(fila["CURRENCY"])
        historial.append(_sin_vacios({"fecha_ex": fecha_ex, "fecha_pago": _fecha(fila.get("PAYMENT DATE")),
                                      "fecha_registro": _fecha(fila.get("RECORD DATE")), "importe": importe}))
    with procedencia.etapa(ETAPA_DIVIDENDOS, fichero[1], url=URL_DIVIDENDOS):
        set_path(out, "emisor.distribuciones.historial_consultado", True)
        set_path(out, "emisor.distribuciones.fecha_descarga", _iso(fichero[1]))
        if not historial:
            return
        if len(divisas) == 1:
            set_path(out, "emisor.distribuciones.divisa", next(iter(divisas)))
            set_path(out, "emisor.distribuciones.divisa_origen", "declarada")
        set_path(out, "emisor.distribuciones.historial", sorted(historial, key=lambda f: f["fecha_ex"]))


# ------------------------------------------------------------------ contraste con el KID
def _aviso_kid(isin: str, politica: str | None, previo: dict | None) -> list[dict]:
    """La política del emisor contra la que se leyó del KID: se avisa y el KID no se toca."""
    fichas = [d for d in (previo or {}).values() if isinstance(d, dict)]
    del_kid = next((k for k in (_get(d, "documentos_oficiales", "kid_politica") for d in fichas) if k), None)
    if not politica or not del_kid or del_kid == politica:
        return []
    log.warning("spdr %s: el emisor declara %s y el KID %s", isin, politica, del_kid)
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


def _texto(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    texto = html.unescape(v).strip()
    return texto if texto.lower() not in SIN_DATO else None


def _es_numero(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _numero(v: Any) -> float | None:
    """Número o texto numérico: el Excel de los ETF estadounidenses guarda las cifras como texto."""
    if _es_numero(v):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def _positivo(v: Any) -> float | None:
    numero = _numero(v)
    return numero if numero is not None and numero > 0 else None


def _iso(epoca: float | None) -> str | None:
    if not epoca:
        return None
    return dt.datetime.fromtimestamp(epoca, dt.timezone.utc).isoformat(timespec="seconds")


def _fecha(v: Any) -> str | None:
    """`06-Nov-2026`, `06 Nov 2026`, `As of 05-Nov-2026` o `dd/mm/aaaa`, sin depender del idioma del sistema."""
    if not isinstance(v, str):
        return None
    texto = v.replace(" ", "-") if re.fullmatch(r"\d{1,2} [A-Za-z]{3} \d{4}", v.strip()) else v
    m = _FECHA_MES.search(texto)
    if m:
        mes = _MESES.get(m.group(2).lower())
        return _construye(int(m.group(3)), mes, int(m.group(1))) if mes else None
    m = _FECHA_BARRAS.match(texto.strip())
    return _construye(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def _construye(anio: int, mes: int, dia: int) -> str | None:
    try:
        return dt.date(anio, mes, dia).isoformat()
    except ValueError:
        return None
