# -*- coding: utf-8 -*-
"""Lo que se negocia de lo que cotiza: la plaza, la mediana negociada al día y las sesiones sin volumen de los últimos 12 meses.

Decisión 108 de Óscar, 05-11-2026. Sale de la respuesta de EODHD que ya está en la caché, la misma de la que sale la serie, y no pide
nada a nadie: por eso se calcula al exportar y no en la ficha, y no obliga a re-mapear ningún instrumento. Sin umbral y sin adjetivo, igual
para todos: el dato es para que juzgue el asesor. Es el volumen de UNA plaza, y por eso la plaza viaja con él: en Fráncfort, Inmocemento
cambia de precio en 245 de las 246 sesiones sin volumen, porque su mercado principal es otro. Los fondos no llevan nada de esto: se suscriben al
valor liquidativo y no se negocian en una plaza.

Tres cosas que se midieron antes de escribirlo, sobre las 330 respuestas de la caché, y que cambian la cifra:

- **El importe es volumen por cierre, en la moneda de cotización.** En Londres el cierre va en peniques (`GBX`), y aquí sale en libras.
- **Un salto del cierre rompe el producto.** EODHD da el cierre sin ajustar y, en casi todos, el volumen ya ajustado: el cierre de KLA pasa el
  12-06-2026 de 2.411 a 254 $, con el ajustado subiendo un 5,5 %, y sin filtrar salía con 10.606 M$ al día, y son 1.941 M$. Solo cuentan las
  sesiones posteriores al último salto de la ventana, y `sesiones_de_la_mediana` dice cuántas son. Medido el 05-11-2026: le pasa a 10 de 330. Casi todos tienen
  forma de desdoblamiento o de agrupación; en Árima (de 8,6 a 10,8 con el ajustado casi quieto) no consta qué fue, y por eso aquí se llama salto.
- **Sin volumen no siempre es sin negociar.** ACCION IBEX 35 trae 261 de 261 sesiones a cero con el precio moviéndose en 255: es un hueco del
  proveedor, y no se dice nada de lo negociado. Urbas e Innovative Solutions traen 255 de 255 con el cierre moviéndose en una sola sesión: ahí no consta negociación, y la línea lo dice tal cual.
"""
from __future__ import annotations

import json
import logging
import statistics
from datetime import date
from pathlib import Path

from core import metricas
from fetchers.cambios_bce import MENORES

log = logging.getLogger("fondosdb.negociacion")

#: Cuánto puede separarse el cierre del ajustado de un día a otro sin que sea un desdoblamiento. Un dividendo los separa lo que paga: el
#: 15 % no lo alcanza casi ninguno, y si lo alcanza, solo se calcula la mediana con menos sesiones.
SEPARACION_DE_UN_DESDOBLAMIENTO = 0.15


def _numero(valor) -> float | None:
    return float(valor) if isinstance(valor, (int, float)) and not isinstance(valor, bool) and valor == valor else None


def de_filas(filas: list, divisa: str | None, plaza: str) -> dict | None:
    """El dato, de las filas crudas de `/eod/{simbolo}`. `None` si no hay ni una sesión con fecha y cierre."""
    sesiones: list[tuple[date, float, float, float | None]] = []
    for fila in filas if isinstance(filas, list) else []:
        if not isinstance(fila, dict):
            continue
        try:
            dia = date.fromisoformat(str(fila.get("date"))[:10])
        except ValueError:
            continue
        cierre = _numero(fila.get("close"))
        if cierre is not None and cierre > 0:
            ajustado = _numero(fila.get("adjusted_close"))
            sesiones.append((dia, cierre, _numero(fila.get("volume")) or 0.0, ajustado if ajustado and ajustado > 0 else None))
    if not sesiones:
        return None
    sesiones.sort(key=lambda s: s[0])
    fin = sesiones[-1][0]
    inicio = metricas.resta_anos(fin, 1)
    primera = next(i for i, s in enumerate(sesiones) if s[0] > inicio)
    ventana = sesiones[primera:]

    moneda, escala = MENORES.get(divisa or "", (divisa, 1.0))
    dato = {"plaza": plaza, "divisa": moneda, "fecha_corte": fin.isoformat(), "sesiones": len(ventana)}

    sin_volumen = [i for i, s in enumerate(ventana) if s[2] <= 0]
    anteriores = [sesiones[primera - 1][1] if primera > 0 else None] + [s[1] for s in ventana]
    con_el_precio_movido = sum(1 for i in sin_volumen if anteriores[i] is not None and ventana[i][1] != anteriores[i])
    if len(sin_volumen) == len(ventana) and con_el_precio_movido * 2 > len(ventana):
        return {**dato, "volumen": "NO_LO_DA_EL_PROVEEDOR"}

    dato["sesiones_sin_volumen"] = len(sin_volumen)
    desde = 0
    for i in range(1, len(ventana)):
        a, b = ventana[i - 1], ventana[i]
        if a[3] and b[3] and abs((b[1] / a[1]) / (b[3] / a[3]) - 1) > SEPARACION_DE_UN_DESDOBLAMIENTO:
            desde = i
    importes = [s[1] * s[2] * escala for s in ventana[desde:] if s[2] > 0]
    if importes:
        dato["mediana_negociada"] = round(statistics.median(importes), 2)
        dato["sesiones_de_la_mediana"] = len(importes)
    return dato


class LectorDeLaCache:
    """Lee `/eod/{simbolo}` de la caché, sin red. Si no se puede armar —sin ajustes o sin token—, no hay dato y se dice en el log."""

    def __init__(self, base: Path):
        from core.http import Http
        from fetchers import eodhd

        self._eodhd = eodhd
        self._token = eodhd._token(base)
        try:
            ajustes = json.loads((base / "config" / "settings.json").read_text(encoding="utf-8"))
            self._http = Http(ajustes, base / "cache" / "http", sin_caducidad=True, sin_red=True)
        except (OSError, ValueError) as e:
            log.info("negociacion: sin leer la cache: %s", e)
            self._http = None

    def filas(self, simbolo: str) -> list:
        from core.http import SinCache

        if self._http is None or not self._token:
            return []
        try:
            r = self._http.get(f"{self._eodhd.BASE_URL}/eod/{simbolo}",
                               params={"api_token": self._token, "fmt": "json", "period": "d", "order": "a"},
                               familia="precio")
            return (r.json() or []) if getattr(r, "ok", False) else []
        except (SinCache, ValueError) as e:
            log.info("negociacion: %s sin respuesta guardada: %s", simbolo, e)
            return []


def de_ficha(ficha: dict, lector: LectorDeLaCache) -> dict | None:
    """El dato de una ficha que cotiza. `None` para un fondo, o si su serie no es de EODHD: de Yahoo no se guarda nada que leer."""
    from core.export_series import FUENTE_EODHD, _divisa, clase_de_precio, es_compuesta

    traza = (ficha.get("riesgo") or {}).get("historial_precios") or {}
    listado = str(traza.get("source_listing_id") or "")
    # Una serie compuesta (D-9) empieza por `EODHD:` y es valor liquidativo: no se negocia.
    if not listado.startswith(FUENTE_EODHD) or es_compuesta(traza):
        return None
    simbolo = listado[len(FUENTE_EODHD):]
    if clase_de_precio(simbolo) != "MARKET_PRICE" or "." not in simbolo:
        return None
    return de_filas(lector.filas(simbolo), _divisa(ficha), simbolo.rsplit(".", 1)[1])
