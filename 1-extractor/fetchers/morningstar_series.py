"""La serie diaria de valor liquidativo de Morningstar (`timeseries_price`).

Solo entra cuando la serie de EODHD está parada: para los fondos de
`config/serie_de_respaldo.json` (decisión D-9 de Óscar, 11-11-2026, en
`DECISIONES_ADQUISICION_2026-10-30.md`) y, desde D-10 (el mismo día), para cualquier
fondo de valor liquidativo que cumpla sus salvaguardas. Quien decide cuándo y cómo se
usa es `core/serie_de_respaldo.py`; esto solo la lee.

Es el mismo servidor y la misma clave pública que ya usa `morningstar_lt` para el
buscador y las fichas: una API interna, sin contrato ni documentación, que puede
cambiar sin aviso. D-9 y D-10 lo aceptan como respaldo de una serie parada, no como
fuente general: si deja de contestar, el fondo vuelve a su serie parada y su aviso.

La respuesta es `[[epoch_ms_utc, vl], ...]`: medianoche UTC del día del valor. La
fecha se lee en UTC, que es como cuadra día a día con EODHD en el solape (medido
el 11-11-2026 en los once).

Sin `endDate` a propósito, y no es un descuido: con la fecha de hoy en la petición
la clave de la caché cambiaría cada día, y la regeneración sin red de
`export_series` ya no encontraría la respuesta con la que se calcularon las
métricas. Comprobado el 11-11-2026: sin `endDate` devuelve la serie hasta su
último valor liquidativo.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from core import metricas

log = logging.getLogger("fondosdb.morningstar_series")

URL = "https://lt.morningstar.com/api/rest.svc/timeseries_price/klr5zyak8x"
DESDE = "1900-01-01"
FUENTE = "morningstar"
PREFIJO = "MORNINGSTAR:"


def identificador(sec_id: str) -> str:
    """El nombre de la serie, con la misma forma que `EODHD:<símbolo>`."""
    return f"{PREFIJO}{sec_id}"


def parametros(sec_id: str, divisa: str) -> dict[str, str]:
    return {"id": sec_id, "currencyId": divisa, "idtype": "Morningstar", "frequency": "daily",
            "startDate": DESDE, "outputType": "COMPACTJSON"}


def lee(texto_json) -> metricas.Serie:
    """Los puntos de una respuesta ya decodificada; lo que no tenga forma de punto no entra."""
    puntos = []
    for item in texto_json if isinstance(texto_json, list) else []:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        marca, valor = item[0], item[1]
        if isinstance(marca, bool) or not isinstance(marca, (int, float)):
            continue
        if isinstance(valor, bool) or not isinstance(valor, (int, float)):
            continue
        try:
            dia = datetime.fromtimestamp(marca / 1000, timezone.utc).date()
        except (OverflowError, OSError, ValueError):
            continue
        puntos.append((dia, float(valor)))
    return metricas.normaliza(puntos)


def serie(sec_id: str, divisa: str, http, force: bool = False) -> tuple[metricas.Serie, float | None]:
    """(serie diaria ascendente, fetched_at), o ([], None) si no hay respuesta útil.

    No captura `ConnectionError` (ni `SinCache`, que lo es): quien llama decide qué
    significa que Morningstar no conteste. En una pasada, que el fondo se queda como
    estaba; al exportar, que la serie no se puede reconstruir."""
    r = http.get(URL, params=parametros(sec_id, divisa), force=force, familia="precio")
    if not getattr(r, "ok", False):
        log.info("Morningstar timeseries %s sin serie (status=%s)", sec_id, getattr(r, "status", "?"))
        return [], None
    try:
        crudo = r.json()
    except ValueError:
        log.info("Morningstar timeseries %s: la respuesta no es JSON", sec_id)
        return [], None
    return lee(crudo), getattr(r, "fetched_at", None)
