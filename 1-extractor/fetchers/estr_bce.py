"""El €STR del BCE: una sola petición para todos los que lo leen.

Lo leen tres sitios —el Sharpe diario de acciones y ETF (`eodhd`), el mensual de los fondos
(`vl_fondos`) y el export del tipo libre de riesgo para las carteras (`export_series`)—, y los tres
piden **la misma clave** de la caché HTTP: misma URL y mismos parámetros. Lo que decide qué serie
recibe cada uno es el TTL con que la lee, y por eso vive aquí y solo aquí.

Medido el 09-11-2026, es lo que pasa cuando se separan: `eodhd` la leía con 7 días y el export
con 1. La pasada con red de las 08:05 UTC aceptó una copia que acababa el 05-11, y el export de las
08:08 la refrescó al 06-11. Las 504 acciones con precio del 06-11 publicaron `rf_pct` a un año de
2,0696 en vez de 2,0711, y el canónico y el export de carteras quedaron con dos €STR distintos del
mismo día.

Un día es el ritmo de la serie: el BCE publica el €STR de cada día hábil a la mañana siguiente.
Con más, una pasada promedia una ventana que acaba antes que la de sus precios; con menos se
repetiría la descarga dentro de la misma mañana sin ganar nada.
"""
from __future__ import annotations

URL = "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT"
DESDE = "2019-10-01"
#: Ver el docstring: si alguien necesita otro plazo, se cambia aquí para los tres lectores.
TTL_DIAS = 1


def parametros() -> dict[str, str]:
    return {"startPeriod": DESDE, "format": "csvdata"}


def pide(http, force: bool = False):
    """La respuesta del BCE (o de la caché) con el TTL común. Sin `familia` a propósito: con
    `--familias` sin `rendimiento` la familia la dejaría sin caducidad, y los precios de las
    acciones se refrescan igual, así que el €STR se quedaría corto de la ventana."""
    return http.get(URL, params=parametros(), ttl_dias=TTL_DIAS, force=force)
