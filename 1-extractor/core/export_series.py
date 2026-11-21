"""Exporta a `export_series/` la serie con la que se calcularon las métricas de cada ficha.

Sale de la caché HTTP y sin red: el identificador lo da
`riesgo.historial_precios.source_listing_id` y el parser es el mismo que usa el cálculo. Así la
serie exportada es la que produjo la cifra, no otra parecida.

Yahoo no pasa por la caché HTTP (lo sirve `yfinance`), de modo que esas fichas se declaran como
no exportadas en vez de reconstruirlas. Si la traza no coincide con la serie, se anota: una
serie más nueva que la ficha significa que la ficha viene de una pasada anterior.

Una serie compuesta (D-9: EODHD parada y Morningstar después) se reconstruye desde los `tramos` de
su traza, tramo a tramo y con la respuesta de cada fuente que hay en la caché. Sale con `segments`,
que dice qué fechas son de cada fuente: es lo que lee la plataforma para que cada año de
`price_series` diga de dónde salen sus puntos. Una serie de una sola fuente no lleva `segments`,
y sale byte a byte como antes.
"""
from __future__ import annotations

import csv
import io
import json
import logging
from pathlib import Path

from core import serie_de_respaldo
from core.http import Http, SinCache
from fetchers import cambios_bce, eodhd, estr_bce, vl_fondos

log = logging.getLogger(__name__)

FUENTE_EODHD = "EODHD:"


def _divisa(fila: dict) -> str | None:
    # Un ETF cotiza en la divisa de su mercado, no en la de su clase: `vl_divisa` dice USD en
    # clases que en XETRA cotizan en euros, y convertirlas otra vez falsearia la serie.
    historial = (fila.get("riesgo") or {}).get("historial_precios") or {}
    if historial.get("clase_de_serie") == "PRECIO_DE_MERCADO" and historial.get("divisa_metricas") == "EUR":
        return historial.get("divisa_origen") or "EUR"
    valoracion = fila.get("valoracion") or {}
    identificacion = fila.get("identificacion") or {}
    return valoracion.get("vl_divisa") or identificacion.get("divisa_base") or identificacion.get("divisa")


def clase_de_precio(simbolo: str) -> str:
    """`.EUFUND` es el valor liquidativo de una clase; lo demás cotiza en un mercado."""
    return "NAV" if simbolo.endswith(".EUFUND") else "MARKET_PRICE"


def es_compuesta(traza: dict) -> bool:
    """La serie de la ficha es la de D-9: lleva tramos, y su identidad no es un solo símbolo."""
    return isinstance(traza.get("tramos"), list) and bool(traza.get("tramos"))


def exporta_compuesta(fila: dict, traza: dict, http, token: str, destino: Path) -> dict:
    """Una serie de D-9, reconstruida desde sus tramos. Las dos fuentes son valor liquidativo."""
    isin = str(fila.get("_id") or "")
    listado = str(traza.get("source_listing_id") or "")
    tramos = traza["tramos"]
    divisa_pedida = (traza.get("respaldo") or {}).get("divisa")
    try:
        serie, descargada = serie_de_respaldo.reconstruye(tramos, divisa_pedida, http, token)
    except SinCache:
        return {"isin": isin, "estado": "sin_cache", "serie": listado}
    if not serie:
        return {"isin": isin, "estado": "serie_vacia", "serie": listado}
    segmentos = []
    for tramo in tramos:
        desde, hasta = str(tramo.get("desde")), str(tramo.get("hasta"))
        puntos = sum(1 for f, _p in serie if desde <= f.isoformat() <= hasta)
        segmentos.append({"source": tramo.get("fuente"), "series_id": tramo.get("serie"),
                          "first_date": desde, "last_date": hasta, "observations": puntos})
    documento = {
        "instrument_id": isin,
        "series_id": listado,
        "source": traza.get("source_history") or "+".join(str(t.get("fuente")) for t in tramos),
        "price_class": "NAV",
        "currency": _divisa(fila),
        "fetched_at": descargada,
        "segments": segmentos,
        "points": [[fecha.isoformat(), precio] for fecha, precio in serie],
    }
    (destino / f"{isin}.json").write_text(
        json.dumps(documento, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    diferencias = compara_traza(traza, serie)
    for tramo, segmento in zip(tramos, segmentos):
        if tramo.get("puntos") != segmento["observations"]:
            diferencias.append(f"tramo {tramo.get('serie')}: ficha {tramo.get('puntos')}, serie {segmento['observations']}")
    return {"isin": isin, "estado": "exportada", "observaciones": len(serie), "diferencias": diferencias}


def compara_traza(traza: dict, serie: list) -> list[str]:
    """Diferencias entre lo que la ficha dice de su serie y la serie exportada."""
    diferencias = []
    esperadas = {
        "observations_count": len(serie),
        "first_date": serie[0][0].isoformat(),
        "last_date": serie[-1][0].isoformat(),
    }
    for campo, valor in esperadas.items():
        declarado = traza.get(campo)
        if declarado is not None and declarado != valor:
            diferencias.append(f"{campo}: ficha {declarado}, serie {valor}")
    return diferencias


def exporta_fila(fila: dict, http, token: str, destino: Path) -> dict:
    """Exporta una ficha y devuelve qué ha pasado con ella."""
    isin = str(fila.get("_id") or "")
    traza = (fila.get("riesgo") or {}).get("historial_precios") or {}
    listado = traza.get("source_listing_id")
    if not listado:
        return {"isin": isin, "estado": "sin_traza"}
    if es_compuesta(traza):
        return exporta_compuesta(fila, traza, http, token, destino)
    if not str(listado).startswith(FUENTE_EODHD):
        return {"isin": isin, "estado": "fuente_no_exportable", "serie": listado}
    simbolo = str(listado)[len(FUENTE_EODHD):]
    try:
        serie, descargada = vl_fondos.serie_de_simbolo(simbolo, http, token)
    except SinCache:
        return {"isin": isin, "estado": "sin_cache", "serie": listado}
    if not serie:
        return {"isin": isin, "estado": "serie_vacia", "serie": listado}
    documento = {
        "instrument_id": isin,
        "series_id": listado,
        "source": "eodhd",
        "price_class": clase_de_precio(simbolo),
        "currency": _divisa(fila),
        "fetched_at": descargada,
        "points": [[fecha.isoformat(), precio] for fecha, precio in serie],
    }
    (destino / f"{isin}.json").write_text(
        json.dumps(documento, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    return {
        "isin": isin,
        "estado": "exportada",
        "observaciones": len(serie),
        "diferencias": compara_traza(traza, serie),
    }


def genera(base: Path, settings: dict) -> dict:
    token = eodhd._token(base)
    if not token:
        raise RuntimeError("falta el token de EODHD: sin él no se localiza la caché")
    destino = base / "export_series"
    destino.mkdir(exist_ok=True)
    for antiguo in destino.glob("*.json"):
        antiguo.unlink()
    http = Http(settings, base / "cache" / "http", sin_caducidad=True, sin_red=True)
    resultados = []
    with open(base / "export" / "fondos.ndjson", encoding="utf-8") as origen:
        for linea in origen:
            if linea.strip():
                resultados.append(exporta_fila(json.loads(linea), http, token, destino))
    resumen = {"total": len(resultados), "por_estado": {}, "observaciones": 0, "resultados": resultados}
    for resultado in resultados:
        estado = resultado["estado"]
        resumen["por_estado"][estado] = resumen["por_estado"].get(estado, 0) + 1
        resumen["observaciones"] += resultado.get("observaciones", 0)
    (destino / "_resumen.txt").write_text(
        json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return resumen




# La petición del €STR es la de `estr_bce`, la misma que el Sharpe de acciones y fondos.
URL_ESTR = estr_bce.URL
INICIO_ESTR = estr_bce.DESDE


def lee_cambios_bce(texto: str) -> list[list]:
    """[[fecha, unidades por 1 EUR], ...] ascendente, desde el CSV del BCE."""
    puntos = {}
    for fila in csv.DictReader(io.StringIO(texto)):
        fecha, valor = fila.get("TIME_PERIOD"), fila.get("OBS_VALUE")
        try:
            numero = float(valor)
        except (TypeError, ValueError):
            continue
        if fecha and numero > 0:
            puntos[fecha] = numero
    return [[fecha, puntos[fecha]] for fecha in sorted(puntos)]


def monedas_necesarias(carpeta_series: Path) -> set[str]:
    monedas = set()
    for ruta in carpeta_series.glob("*.json"):
        divisa = json.loads(ruta.read_text(encoding="utf-8")).get("currency")
        if divisa and divisa != "EUR":
            monedas.add(cambios_bce.moneda_mayor(divisa))
    return monedas


def lee_estr_bce(texto: str) -> list[list]:
    """[[fecha, fraccion], ...] ascendente. El BCE publica en por ciento, y puede ser negativo."""
    puntos = {}
    for fila in csv.DictReader(io.StringIO(texto)):
        fecha, valor = fila.get("TIME_PERIOD"), fila.get("OBS_VALUE")
        try:
            numero = float(valor)
        except (TypeError, ValueError):
            continue
        if fecha and numero == numero and -20 <= numero <= 50:
            puntos[fecha] = round(numero / 100, 8)
    return [[fecha, puntos[fecha]] for fecha in sorted(puntos)]


def genera_estr(base: Path, http) -> int:
    """Exporta a `export_rf/` la ESTR del BCE, el tipo libre de riesgo del Sharpe de cartera."""
    respuesta = estr_bce.pide(http)
    puntos = lee_estr_bce(respuesta.text) if getattr(respuesta, "ok", False) else []
    if not puntos:
        raise RuntimeError(f"el BCE no ha entregado la ESTR (status {respuesta.status})")
    destino = base / "export_rf"
    destino.mkdir(exist_ok=True)
    (destino / "ESTR.json").write_text(json.dumps({
        "rate": "ESTR",
        "series_key": "EST/B.EU000A2X2A25.WT",
        "source": "ECB",
        "points": puntos,
    }, separators=(",", ":")), encoding="utf-8")
    return len(puntos)


def genera_cambios(base: Path, http) -> dict:
    """Exporta a `export_fx/` los cambios de referencia del BCE que necesitan las series."""
    destino = base / "export_fx"
    destino.mkdir(exist_ok=True)
    resultado = {}
    for moneda in sorted(monedas_necesarias(base / "export_series")):
        url = cambios_bce.URL.format(moneda=moneda)
        respuesta = http.get(url, params={"format": "csvdata", "startPeriod": cambios_bce.INICIO}, ttl_dias=1)
        puntos = lee_cambios_bce(respuesta.text) if getattr(respuesta, "ok", False) else []
        if not puntos:
            raise RuntimeError(f"el BCE no ha entregado cambios de {moneda} (status {respuesta.status})")
        (destino / f"{moneda}.json").write_text(json.dumps({
            "currency": moneda,
            "series_key": f"EXR/D.{moneda}.EUR.SP00.A",
            "source": "ECB",
            "points": puntos,
        }, separators=(",", ":")), encoding="utf-8")
        resultado[moneda] = len(puntos)
    return resultado
