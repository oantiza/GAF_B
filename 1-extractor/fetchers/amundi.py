"""Emisor Amundi (incluye lo que fue Lyxor): valor liquidativo y ficha declarados, de su API de producto.

Segundo adaptador de emisor (decisión 51, 08-11-2026), con la forma que fijó `ishares`.

**Una sola petición por ISIN**: POST JSON a `getProductsData`, sin cookies ni aviso aceptado. Trae VL
diario, patrimonio, dividendos, ficha y composición. Un ISIN que el emisor no conoce devuelve
`products: []`, y el adaptador no aporta nada: no es un error. Lyxor ya no existe como marca: sus ETF
están en el mismo catálogo con nombre Amundi.

**El cuerpo no lleva `context` a propósito.** La web pregunta si se aceptan sus condiciones con dos
botones, INSTIT y RETAIL, y `context.userProfileName` admite esos mismos valores: enviarlo sería
contestar el aviso por programa. Medido el 08-11-2026: sin `context` la API responde lo mismo.

**Todo se escribe en el bloque `emisor`, y la serie de VL en `series.vl_emisor`**: los motivos están en
`ishares`. **El VL no entra en ninguna métrica** (decisión 52).

**En un ETF por swap la composición es la cesta de sustitución**, no el índice (el Japan Topix lleva
Apple primero). Se guarda porque dice qué garantía hay, y `emisor.cartera.naturaleza` lo declara para
que nadie la lea como lo que el fondo sigue.

Nada se deduce del nombre: lo que la respuesta no trae se queda ausente.
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from core import cartera_emisor
from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.amundi")

FUENTE = "amundi"
ETAPA = "api_producto"
URL_API = "https://www.amundietf.fr/mapi/ProductAPI/getProductsData"

# Nombres medidos en la API y en el script público de la ficha el 08-11-2026.
CARACTERISTICAS = ("ISIN", "SHARE_MARKETING_NAME", "ASSET_CLASS", "TER", "REPLICATION_METHODOLOGY",
                   "BENCHMARK_NAME", "BENCHMARK_TICKER", "DISTRIBUTION_POLICY", "DISTRIBUTION_FREQUENCY",
                   "POSITION_AS_OF_DATE")
HISTORICOS = ("officialNav", "navCurrency", "shareAumInMCcy", "fundAumInMCcy", "dividendAmount",
              "dividendCurrency")
CAMPOS_COMPOSICION = ("date", "type", "bbg", "isin", "name", "weight", "currency", "sector", "countryOfRisk")

# Vocabulario medido en los 686 productos del catálogo; lo que no esté aquí no se interpreta. El mixto
# `Capitalisation and/or distribution` (29 productos) no se traduce: el emisor no dice cuál de las dos.
POLITICA = {"capitalisation": "acumulacion", "distribution": "distribucion"}
REPLICA = {"direct (physical)": "fisica", "indirect (unfunded swap)": "sintetica"}
COLUMNAS_POSICION = {"bbg": "ticker", "name": "nombre", "isin": "isin", "sector": "sector",
                     "type": "clase_activo", "currency": "divisa", "countryOfRisk": "pais"}


def cuerpo(isin: str) -> dict:
    return {"productIds": [isin], "productType": "PRODUCT",
            "characteristics": list(CARACTERISTICAS),
            "historics": [{"indicator": i} for i in HISTORICOS],
            "composition": {"compositionFields": list(CAMPOS_COMPOSICION)}}


def fetch(isin: str, http, settings: dict, force: bool = False, previo: dict | None = None) -> dict:
    isin = isin.strip().upper()
    r = http.post_json(URL_API, cuerpo=cuerpo(isin), familia="precio", force=force)
    if not r.ok:
        log.warning("amundi %s: la API responde %s", isin, r.status)
        return {}
    producto = _producto(r, isin)
    if producto is None:
        return {}

    car = producto.get("characteristics") or {}
    historicos = {h.get("indicator"): h.get("historicalData") or []
                  for h in producto.get("historics") or [] if isinstance(h, dict)}
    divisa = (producto.get("currencies") or {}).get("CURRENCY")

    out: dict = {}
    descarga = _iso(r.fetched_at)
    with procedencia.etapa(ETAPA, r.fetched_at, url=URL_API):
        set_path(out, "emisor.fuente", FUENTE)
        set_path(out, "emisor.id_emisor", isin)
        set_path(out, "emisor.fecha_descarga", descarga)
        avisos = _escribe_vl(out, historicos, divisa, descarga)
        _escribe_ficha(out, car, historicos, divisa)
        _escribe_cartera(out, car, producto.get("composition"), settings)
        _escribe_dividendos(out, historicos, descarga)

    avisos += _aviso_kid(isin, (_get(out, "emisor", "politica") or {}).get("valor"), previo)
    if avisos:
        set_path(out, "emisor.avisos", avisos)
    log.info("amundi %s: VL hasta %s", isin, (_get(out, "emisor", "vl") or {}).get("ultima_fecha") or "?")
    return out


def _producto(r, isin: str) -> dict | None:
    """El producto pedido, o None si no está o lo recibido no es lo esperado."""
    try:
        productos = r.json().get("products") or []
    except (ValueError, AttributeError):
        log.warning("amundi %s: la API no devuelve JSON", isin)
        return None
    if not productos:
        return None
    producto = productos[0]
    if not isinstance(producto, dict) or producto.get("productId") != isin:
        log.warning("amundi %s: la respuesta es de otro producto; no la uso", isin)
        return None
    return producto


# ------------------------------------------------------------------ VL
def _puntos(historico: list, conversion=None) -> list[tuple[str, Any]]:
    """`(fecha, dato)` ascendente. La API manda `"NaN"` como texto en huecos: es ausencia."""
    salida: dict[str, Any] = {}
    for p in historico:
        fecha = _fecha_ms(p.get("date")) if isinstance(p, dict) else None
        dato = p.get("data") if isinstance(p, dict) else None
        if conversion:
            dato = conversion(dato)
        if fecha and dato is not None:
            salida[fecha] = dato
    return sorted(salida.items())


def _positivo(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def _texto(v: Any) -> str | None:
    return v.strip() or None if isinstance(v, str) and v.strip() != "None" else None


def _escribe_vl(out: dict, historicos: dict, divisa: str | None, descarga: str | None) -> list[dict]:
    serie = _puntos(historicos.get("officialNav") or [], _positivo)
    if not serie:
        return []
    divisas = _puntos(historicos.get("navCurrency") or [], _texto)
    distintas = sorted({d for _, d in divisas})
    avisos: list[dict] = []
    if divisas:
        divisa = divisas[-1][1]
    if len(distintas) > 1:
        # Medido: ningún ETF de la muestra cambia de divisa. Si alguno lo hace, no se mezclan.
        de_la_ultima = {f for f, d in divisas if d == divisa}
        serie = [p for p in serie if p[0] in de_la_ultima]
        avisos.append({"codigo": "divisa_de_vl_cambia", "divisas": distintas, "se_conserva": divisa})
    filas = [{"fecha": f, "vl": v} for f, v in serie]
    set_path(out, "emisor.vl", {
        "clase_de_serie": "VL_EMISOR",
        "divisa": divisa,
        "fuente": procedencia.etiqueta(FUENTE, ETAPA),
        "fecha_descarga": descarga,
        "primera_fecha": filas[0]["fecha"],
        "ultima_fecha": filas[-1]["fecha"],
        "observaciones": len(filas),
    })
    set_path(out, "series.vl_emisor", filas)
    return avisos


# ------------------------------------------------------------------ ficha
def _escribe_ficha(out: dict, car: dict, historicos: dict, divisa: str | None) -> None:
    set_path(out, "emisor.nombre", _texto(car.get("SHARE_MARKETING_NAME")))
    set_path(out, "emisor.clase_activo", _texto(car.get("ASSET_CLASS")))
    set_path(out, "emisor.divisa_clase", divisa)
    ter = car.get("TER")
    if isinstance(ter, (int, float)) and not isinstance(ter, bool):
        set_path(out, "emisor.ter_pct", float(ter))

    uso = _texto(car.get("DISTRIBUTION_POLICY"))
    politica = _sin_vacios({"valor": POLITICA.get((uso or "").lower()), "texto": uso,
                            "frecuencia": _texto(car.get("DISTRIBUTION_FREQUENCY"))})
    if politica:
        set_path(out, "emisor.politica", politica)

    estructura = _texto(car.get("REPLICATION_METHODOLOGY"))
    replica = _sin_vacios({"tipo": REPLICA.get((estructura or "").lower()), "estructura": estructura})
    if replica:
        set_path(out, "emisor.replica", replica)

    indice = _sin_vacios({"nombre": _texto(car.get("BENCHMARK_NAME")),
                          "ticker": _texto(car.get("BENCHMARK_TICKER"))})
    if indice:
        set_path(out, "emisor.indice", indice)

    for destino, indicador in (("clase", "shareAumInMCcy"), ("fondo", "fundAumInMCcy")):
        # Pese al nombre del indicador, va en unidades: coincide con `AUM` y `FUND_AUM` de la ficha.
        puntos = _puntos(historicos.get(indicador) or [], _positivo)
        if puntos:
            set_path(out, f"emisor.patrimonio.{destino}",
                     _sin_vacios({"valor": puntos[-1][1], "divisa": divisa, "fecha": puntos[-1][0]}))


# ------------------------------------------------------------------ composición
def _posiciones(composicion: dict) -> list[dict]:
    """Filas con nombre y peso. La de efectivo viene sin nombre (0,38 % en LU0908500753) y no entra:
    por eso `num_posiciones` puede ser una menos que `num_posiciones_declarado`."""
    posiciones = []
    for fila in composicion.get("compositionData") or []:
        datos = (fila or {}).get("compositionCharacteristics") or {}
        peso = datos.get("weight")
        if not datos.get("name") or not isinstance(peso, (int, float)) or isinstance(peso, bool):
            continue
        pos = {destino: _texto(datos.get(origen)) for origen, destino in COLUMNAS_POSICION.items()}
        pos["peso_pct"] = round(float(peso) * 100, 6)  # la API lo da en tanto por uno
        pos["_fecha"] = _texto(datos.get("date"))
        posiciones.append(_sin_vacios(pos))
    return posiciones


def _escribe_cartera(out: dict, car: dict, composicion: Any, settings: dict) -> None:
    if not isinstance(composicion, dict):
        return
    posiciones = _posiciones(composicion)
    fecha = _texto(car.get("POSITION_AS_OF_DATE"))
    if posiciones:
        if fecha is None:
            fecha = max((p["_fecha"] for p in posiciones if p.get("_fecha")), default=None)
        for p in posiciones:
            p.pop("_fecha", None)
        posiciones.sort(key=lambda p: -p["peso_pct"])
        maximo = cartera_emisor.tope(settings)
        set_path(out, "emisor.cartera.fecha", fecha)
        set_path(out, "emisor.cartera.num_posiciones", len(posiciones))
        set_path(out, "emisor.cartera.peso_top10_pct",
                 round(sum(p["peso_pct"] for p in posiciones[:10]), 2))
        if len(posiciones) > maximo:
            set_path(out, "emisor.cartera.posiciones_guardadas", maximo)
        set_path(out, "emisor.cartera.posiciones", posiciones[:maximo])
        if (_get(out, "emisor", "replica") or {}).get("tipo") == "sintetica":
            set_path(out, "emisor.cartera.naturaleza", "cesta_de_sustitucion")
    total = composicion.get("totalNumberOfInstruments")
    if isinstance(total, int) and not isinstance(total, bool):
        set_path(out, "emisor.cartera.num_posiciones_declarado", total)


# ------------------------------------------------------------------ dividendos
def _escribe_dividendos(out: dict, historicos: dict, descarga: str | None) -> None:
    """La fecha de `dividendAmount` es la ex: coincide con el salto del VL ajustado (FR0007052782)."""
    importes = _puntos(historicos.get("dividendAmount") or [], _positivo)
    politica = (_get(out, "emisor", "politica") or {}).get("valor")
    if not importes and politica == "acumulacion":
        return
    set_path(out, "emisor.distribuciones.historial_consultado", True)
    set_path(out, "emisor.distribuciones.fecha_descarga", descarga)
    if not importes:
        return
    divisas = dict(_puntos(historicos.get("dividendCurrency") or [], _texto))
    distintas = {divisas.get(f) for f, _ in importes}
    historial = [{"fecha_ex": f, "importe": v} for f, v in importes]
    if len(distintas) == 1 and None not in distintas:
        set_path(out, "emisor.distribuciones.divisa", distintas.pop())
        set_path(out, "emisor.distribuciones.divisa_origen", "declarada")
    else:
        for fila in historial:
            if divisas.get(fila["fecha_ex"]):
                fila["divisa"] = divisas[fila["fecha_ex"]]
    set_path(out, "emisor.distribuciones.historial", historial)


# ------------------------------------------------------------------ contraste con el KID
def _aviso_kid(isin: str, politica: str | None, previo: dict | None) -> list[dict]:
    """La política del emisor contra la que se leyó del KID: se avisa y el KID no se toca."""
    fichas = [d for d in (previo or {}).values() if isinstance(d, dict)]
    del_kid = next((k for k in (_get(d, "documentos_oficiales", "kid_politica") for d in fichas) if k), None)
    if not politica or not del_kid or del_kid == politica:
        return []
    log.warning("amundi %s: el emisor declara %s y el KID %s", isin, politica, del_kid)
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


def _fecha_ms(v: Any) -> str | None:
    """Milisegundos desde 1970 en UTC. Medido: siempre medianoche UTC."""
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        return None
    return dt.datetime.fromtimestamp(v / 1000, dt.timezone.utc).date().isoformat()
