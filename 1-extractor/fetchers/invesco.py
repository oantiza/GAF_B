"""Emisor Invesco: ficha y crecimiento declarados, de su API JSON por ISIN.

Sexto adaptador de emisor (decisión 51, 08-11-2026), con la forma que fijó `ishares`. **Es el único que no
publica el VL histórico**: da el VL del último día y una serie «crecimiento de 10.000» desde el lanzamiento.

**En una clase de acumulación se puede deducir el VL**: `VL(t) = VL(ancla) × G(t) / G(ancla)`, con el ancla
en el día del último VL declarado. El bloque lo dice (`derivado`, `metodo`, `anclaje` y la cota de redondeo).
Medido contra el cierre de mercado a 12 meses: −0,01 % de media en el de bancos (euros) y +0,03 % en el S&P 500.

**En una clase de reparto no se deduce.** Su serie reinvierte: en la fecha ex no hay salto frente al índice
neto (medido en IE00BWTN6Y99 e IE00BGJWWV33), así que escalarla daría un VL pasado que nunca existió, con un
error que crece hacia atrás con cada reparto. Tampoco se deduce si la fecha del VL declarado no está en la
serie (pasa: IE00BGJWWV33 tenía VL del 06-11 y serie hasta el 05-11) o la divisa no coincide. En esos casos
`series.vl_emisor` lleva filas `{fecha, crecimiento}`, sin clave `vl`, para que nadie lea un índice base
10.000 como un precio, y `clase_de_serie` es `RENTABILIDAD_ACUMULADA_EMISOR`. La prima o descuento solo tiene
sentido sobre `VL_EMISOR_DERIVADO`.

**`assetsUnderManagement` es del subfondo, no de la clase**: las clases Acc y Dist del S&P 500 dan la misma
cifra, y las cubiertas, esa misma cifra pasada a su divisa. Va a `patrimonio.fondo`, en la divisa de la clase.

**La comisión de gestión es el TER**: coincide con `07100_Financial_Instrument_Gross_Ongoing_Costs` del EMT en
los 8 ETF comparados. **La comisión de swap va aparte y fuera del TER** (0,0718 % en el S&P 500, más que el
propio TER), en `emisor.comision_swap_pct`, porque el inversor la soporta igual.

**Las posiciones de un sintético son la cesta de sustitución**, y `numberOfHoldings` cuenta las del índice
(503 contra 629 filas): en ese caso no se escribe como número declarado.

**Del reparto solo se publica el último**, y su importe por participación viene en un campo que se llama
`distributionYield`. Se guarda literal, sin renombrarlo a importe: no hay histórico con el que comprobarlo.

**El EMT y el EET son ficheros únicos de toda la gama** y solo se dejan en la caché en bruto, sin mapear a la
ficha, porque no hay contrato para ellos.

**Todo se escribe en el bloque `emisor`, y la serie en `series.vl_emisor`**: los motivos están en `ishares`.
**La serie no entra en ninguna métrica** (decisión 52). Sin aceptar ningún aviso. Lo que no viene se queda
ausente.
"""
from __future__ import annotations

import datetime as dt
import html
import logging
import re
import time
from pathlib import Path
from typing import Any

from core import cartera_emisor
from core.adquisicion import procedencia
from core.http import SinCache
from core.schema import set_path
from fetchers.kid_gestora import UA_HERRAMIENTA

log = logging.getLogger("fondosdb.invesco")

FUENTE = "invesco"
ETAPA_FICHA = "ficha_producto"
ETAPA_VL = "vl_historico"
ETAPA_POSICIONES = "posiciones"
ETAPA_DIVIDENDOS = "dividendos"

URL_BASE = "https://dng-api.invesco.com/cache/v1/accounts/en_GB/shareclasses"
_URL_DOCUMENTOS = "https://www.invesco.com/content/dam/invesco/emea/en/product-documents/etf/umbrella/other"
URLS_REGULATORIOS = {"emt": f"{_URL_DOCUMENTOS}/emt-report_en_invesco-combined.csv",
                     "eet": f"{_URL_DOCUMENTOS}/eet-report_en_non-readable.csv"}
CABECERAS = {"User-Agent": UA_HERRAMIENTA, "Accept": "*/*"}

# Vocabulario medido en 18 ETF el 08-11-2026; lo que no esté aquí se queda literal y sin interpretar.
POLITICA = {"accumulating": "acumulacion", "quarterly": "distribucion"}
REPLICA = {"synthetic": "sintetica", "physical": "fisica"}

BASE_CRECIMIENTO = 10000
SEMI_CENTESIMA = 0.005  # media unidad de la última posición de la serie, que viene a dos decimales
METODO_ANCLADO = "vl_ancla * crecimiento / crecimiento_en_fecha_ancla"
METODO_SIN_ANCLA = "crecimiento de 10.000 con repartos reinvertidos; sin VL deducible"

_FECHA_ISO = re.compile(r"\d{4}-\d{2}-\d{2}$")


def fetch(isin: str, http, settings: dict, force: bool = False, previo: dict | None = None) -> dict:
    isin = isin.strip().upper()
    r = _pide(http, isin, "", "analitica", force)
    datos = _json(r)
    if not datos or _get(datos, "aliases", "isin") != isin:
        return {}
    descarga = _iso(r.fetched_at)

    out: dict = {}
    with procedencia.etapa(ETAPA_FICHA, r.fetched_at, url=f"{URL_BASE}/{isin}"):
        set_path(out, "emisor.fuente", FUENTE)
        set_path(out, "emisor.id_emisor", _texto(_get(datos, "aliases", "ticker")))
        set_path(out, "emisor.fecha_descarga", descarga)
        _escribe_ficha(out, datos)

    politica = (_get(out, "emisor", "politica") or {}).get("valor")
    _escribe_vl(out, http, isin, politica, force)
    _escribe_cartera(out, http, isin, settings, force)
    if politica != "acumulacion":
        _escribe_distribucion(out, http, isin, force)
    _guarda_regulatorios(http, force)

    avisos = _aviso_kid(isin, politica, previo)
    if avisos:
        set_path(out, "emisor.avisos", avisos)
    log.info("invesco %s: serie %s hasta %s", isin, (_get(out, "emisor", "vl") or {}).get("clase_de_serie") or "?",
             (_get(out, "emisor", "vl") or {}).get("ultima_fecha") or "?")
    return out


def _pide(http, isin: str, ruta: str, familia: str, force: bool, params: dict | None = None):
    # Sin `idType` la API responde 400; con `productType` da 500.
    return http.get(f"{URL_BASE}/{isin}{ruta}", params={"idType": "isin", **(params or {})},
                    familia=familia, force=force, headers=CABECERAS)


def _json(r) -> dict | None:
    if not r.ok:
        return None
    try:
        datos = r.json()
    except ValueError:
        return None
    return datos if isinstance(datos, dict) and datos else None


# ------------------------------------------------------------------ ficha
def _escribe_ficha(out: dict, datos: dict) -> None:
    set_path(out, "emisor.nombre", _texto(datos.get("shareClassFullName")))
    set_path(out, "emisor.clase_activo", _texto(_get(datos, "investmentStrategy", "assetType")))
    set_path(out, "emisor.estilo_gestion", _texto(_get(datos, "investmentStrategy", "managementStyle")))
    set_path(out, "emisor.divisa_clase", _texto(datos.get("shareClassCurrency")))
    set_path(out, "emisor.fecha_lanzamiento", _fecha(datos.get("shareClassInceptionDate")))

    cargos = datos.get("shareclassCharges")
    cargos = cargos if isinstance(cargos, dict) else {}
    set_path(out, "emisor.ter_pct", _porcentaje(cargos.get("fundManagementCharge")))
    swap = cargos.get("swapCharge")
    if _es_numero(swap):  # viene en tanto por uno, y a diferencia de la de gestión sin el signo %
        set_path(out, "emisor.comision_swap_pct", round(float(swap) * 100, 6))

    texto = _texto(datos.get("distributionFrequency"))
    valor = POLITICA.get((texto or "").lower())
    politica = _sin_vacios({"valor": valor, "texto": texto, "frecuencia": texto if valor == "distribucion" else None})
    if politica:
        set_path(out, "emisor.politica", politica)

    metodo = _texto(datos.get("replicationMethod"))
    replica = _sin_vacios({"tipo": REPLICA.get((metodo or "").lower()), "metodo": metodo})
    if replica:
        set_path(out, "emisor.replica", replica)

    indices = [i for i in datos.get("benchmarkRelationships") or [] if isinstance(i, dict)]
    if indices:
        indice = _sin_vacios({"nombre": _texto(indices[0].get("benchmarkFullName")),
                              "ticker": _texto(indices[0].get("indexBloombergTicker"))})
        if indice:
            set_path(out, "emisor.indice", indice)


# ------------------------------------------------------------------ serie y VL
def _escribe_vl(out: dict, http, isin: str, politica: str | None, force: bool) -> None:
    ks_r = _pide(http, isin, "/keyStats", "precio", force)
    ks = _json(ks_r)
    if ks and ks.get("isin") != isin:
        ks = None
    estadisticas = _estadisticas(ks)

    ro_r = _pide(http, isin, "/performance/rolling", "precio", force,
                 params={"variationType": "ALL", "baseline": BASE_CRECIMIENTO})
    filas, divisa_serie = _crecimiento(_json(ro_r), isin)

    divisa = _get(out, "emisor", "divisa_clase")
    nav = estadisticas.get("nav")
    with procedencia.etapa(ETAPA_VL, ro_r.fetched_at or ks_r.fetched_at, url=f"{URL_BASE}/{isin}/performance/rolling"):
        aum = estadisticas.get("assetsUnderManagement")
        if aum:
            set_path(out, "emisor.patrimonio.fondo", _sin_vacios({**aum, "divisa": ks.get("currency")}))
        if not filas:
            return
        comun = _sin_vacios({"derivado": True, "base": BASE_CRECIMIENTO, "divisa": divisa_serie or divisa,
                             "fuente": procedencia.etiqueta(FUENTE, ETAPA_VL), "fecha_descarga": _iso(ro_r.fetched_at),
                             "primera_fecha": filas[0][0], "ultima_fecha": filas[-1][0], "observaciones": len(filas)})
        motivo = _motivo_sin_ancla(politica, nav, filas, divisa_serie, (ks or {}).get("currency"))
        if motivo is None:
            serie, bloque = _vl_anclado(filas, nav)
            set_path(out, "emisor.vl", {"clase_de_serie": "VL_EMISOR_DERIVADO", **comun, **bloque})
            set_path(out, "series.vl_emisor", serie)
            return
        log.info("invesco %s: serie sin ancla (%s)", isin, motivo)
        set_path(out, "emisor.vl", _sin_vacios({
            "clase_de_serie": "RENTABILIDAD_ACUMULADA_EMISOR", **comun, "metodo": METODO_SIN_ANCLA,
            "motivo_sin_anclaje": motivo, "ultimo_declarado": nav}))
        set_path(out, "series.vl_emisor", [{"fecha": f, "crecimiento": v} for f, v in filas])


def _estadisticas(ks: dict | None) -> dict[str, dict]:
    """`{nombre: {valor o vl, fecha}}` de `keyStats`, con solo los dos datos que se usan."""
    salida: dict[str, dict] = {}
    for fila in (ks or {}).get("keyStats") or []:
        if not isinstance(fila, dict) or not _es_numero(fila.get("value")) or fila["value"] <= 0:
            continue
        fecha = _fecha(fila.get("asOfDate"))
        if fila.get("name") == "nav" and fecha:
            salida["nav"] = {"vl": float(fila["value"]), "fecha": fecha}
        elif fila.get("name") == "assetsUnderManagement":
            salida["assetsUnderManagement"] = _sin_vacios({"valor": float(fila["value"]), "fecha": fecha})
    return salida


def _crecimiento(rolling: dict | None, isin: str) -> tuple[list[tuple[str, float]], str | None]:
    """Filas `(fecha, valor)` ascendentes de la clase. Una base distinta de la pedida no se interpreta."""
    if not rolling or rolling.get("isin") != isin or rolling.get("baseline") != BASE_CRECIMIENTO:
        return [], None
    bloques = rolling.get("lineChartData")
    bloque = next((b for b in bloques if isinstance(b, dict) and b.get("type") == "Shareclass"), None) \
        if isinstance(bloques, list) else None
    filas: dict[str, float] = {}
    for fila in (bloque or {}).get("data") or []:
        fecha = _fecha(fila.get("date")) if isinstance(fila, dict) else None
        if fecha and _es_numero(fila.get("value")) and fila["value"] > 0:
            filas[fecha] = float(fila["value"])
    return sorted(filas.items()), _texto(rolling.get("currency"))


def _motivo_sin_ancla(politica: str | None, nav: dict | None, filas: list, divisa_serie: str | None,
                      divisa_nav: str | None) -> str | None:
    if politica == "distribucion":
        return "clase_que_reparte"
    if politica != "acumulacion":
        return "politica_no_declarada"
    if not nav:
        return "sin_vl_declarado"
    if divisa_serie != divisa_nav or not divisa_serie:
        return "divisa_distinta"
    if not any(f == nav["fecha"] for f, _ in filas):
        return "fecha_del_vl_fuera_de_la_serie"
    return None


def _vl_anclado(filas: list[tuple[str, float]], nav: dict) -> tuple[list[dict], dict]:
    ancla = nav["vl"]
    g_ancla = next(v for f, v in filas if f == nav["fecha"])
    declarados = len(repr(ancla).split(".")[1])
    decimales = max(declarados, 4)
    serie = [{"fecha": f, "vl": round(ancla * v / g_ancla, decimales)} for f, v in filas]
    # Cota del redondeo: el de G(t), el de G(ancla) y el del propio VL, que es lo que manda.
    cota = SEMI_CENTESIMA / min(v for _, v in filas) + SEMI_CENTESIMA / g_ancla + 0.5 * 10 ** -declarados / ancla
    bloque = {"metodo": METODO_ANCLADO, "anclaje": {"vl": ancla, "fecha": nav["fecha"], "crecimiento": g_ancla},
              "cota_relativa_redondeo": float(f"{cota:.2e}")}
    return serie, bloque


# ------------------------------------------------------------------ posiciones
def _escribe_cartera(out: dict, http, isin: str, settings: dict, force: bool) -> None:
    r = _pide(http, isin, "/holdings/fund", "cartera", force)
    datos = _json(r)
    if not datos or not isinstance(datos.get("holdings"), list):
        return
    posiciones = [p for p in (_posicion(f) for f in datos["holdings"]) if p]
    if not posiciones:
        return
    posiciones.sort(key=lambda p: -p["peso_pct"])
    maximo = cartera_emisor.tope(settings)
    sintetico = (_get(out, "emisor", "replica") or {}).get("tipo") == "sintetica"
    con_exposicion = [p for p in posiciones if p.get("isin")]  # la fila de caja y derivados no lleva ISIN
    with procedencia.etapa(ETAPA_POSICIONES, r.fetched_at, url=f"{URL_BASE}/{isin}/holdings/fund"):
        set_path(out, "emisor.cartera.fecha", _fecha(datos.get("effectiveDate")))
        set_path(out, "emisor.cartera.num_posiciones", len(posiciones))
        if sintetico:
            set_path(out, "emisor.cartera.naturaleza", "cesta_de_sustitucion")
        elif _es_numero(datos.get("numberOfHoldings")):
            set_path(out, "emisor.cartera.num_posiciones_declarado", int(datos["numberOfHoldings"]))
        set_path(out, "emisor.cartera.peso_top10_pct", round(sum(p["peso_pct"] for p in con_exposicion[:10]), 2))
        if len(posiciones) > maximo:
            set_path(out, "emisor.cartera.posiciones_guardadas", maximo)
        set_path(out, "emisor.cartera.posiciones", posiciones[:maximo])


def _posicion(fila: Any) -> dict | None:
    if not isinstance(fila, dict) or not _es_numero(fila.get("weight")):
        return None
    pos = _sin_vacios({"nombre": _texto(fila.get("name")), "isin": _texto(fila.get("isin")),
                       "divisa": _texto(fila.get("currency")), "peso_pct": float(fila["weight"])})
    return pos if pos.get("nombre") or pos.get("isin") else None


# ------------------------------------------------------------------ reparto
def _escribe_distribucion(out: dict, http, isin: str, force: bool) -> None:
    r = _pide(http, isin, "/distribution", "precio", force)
    datos = _json(r)
    fecha_ex = _fecha((datos or {}).get("exDate"))
    if not fecha_ex:
        return
    ultima = _sin_vacios({"fecha_ex": fecha_ex, "fecha_pago": _fecha(datos.get("paymentDate")),
                          "fecha_registro": _fecha(datos.get("recordDate")),
                          "fecha_anuncio": _fecha(datos.get("announcementDate")),
                          "valor_declarado": _numero(datos.get("distributionYield")),
                          "campo_origen": "distributionYield"})
    divisa = _texto(datos.get("currency"))
    with procedencia.etapa(ETAPA_DIVIDENDOS, r.fetched_at, url=f"{URL_BASE}/{isin}/distribution"):
        set_path(out, "emisor.distribuciones.fecha_descarga", _iso(r.fetched_at))
        if divisa:
            set_path(out, "emisor.distribuciones.divisa", divisa)
            set_path(out, "emisor.distribuciones.divisa_origen", "declarada")
        set_path(out, "emisor.distribuciones.ultima", ultima)


# ------------------------------------------------------------------ EMT y EET
def _guarda_regulatorios(http, force: bool) -> None:
    """El EMT y el EET de toda la gama, en bruto en la caché. No se mapea nada y un fallo no afecta a la ficha."""
    for nombre, url in URLS_REGULATORIOS.items():
        destino = Path(http.cache_dir) / "invesco_regulatorio" / f"{nombre}.csv"
        vigente = destino.exists() and (time.time() - destino.stat().st_mtime) / 86400 <= http.ttl_para("costes")
        try:
            http.download(url, destino, force=not vigente or (force and not http.sin_red), opcional=True,
                          familia="costes", headers=CABECERAS)
        except SinCache:
            log.debug("invesco: %s sin caché y sin red", nombre)
        except Exception as e:  # noqa: BLE001  (un fichero accesorio no tumba la ficha)
            log.warning("invesco: %s no se pudo descargar (%s)", nombre, e)


# ------------------------------------------------------------------ contraste con el KID
def _aviso_kid(isin: str, politica: str | None, previo: dict | None) -> list[dict]:
    """La política del emisor contra la que se leyó del KID: se avisa y el KID no se toca."""
    fichas = [d for d in (previo or {}).values() if isinstance(d, dict)]
    del_kid = next((k for k in (_get(d, "documentos_oficiales", "kid_politica") for d in fichas) if k), None)
    if not politica or not del_kid or del_kid == politica:
        return []
    log.warning("invesco %s: el emisor declara %s y el KID %s", isin, politica, del_kid)
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
    return html.unescape(v).strip() or None


def _es_numero(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _numero(v: Any) -> float | None:
    if _es_numero(v):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def _porcentaje(v: Any) -> float | None:
    """`0.05%`; un texto sin signo de porcentaje no se interpreta."""
    if not isinstance(v, str) or not v.strip().endswith("%"):
        return None
    return _numero(v.strip()[:-1])


def _iso(epoca: float | None) -> str | None:
    if not epoca:
        return None
    return dt.datetime.fromtimestamp(epoca, dt.timezone.utc).isoformat(timespec="seconds")


def _fecha(v: Any) -> str | None:
    if not isinstance(v, str) or not _FECHA_ISO.match(v):
        return None
    try:
        return dt.date.fromisoformat(v).isoformat()
    except ValueError:
        return None
