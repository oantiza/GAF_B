"""Retención de acciones: lo que el respaldo de Yahoo deja de traer.

Hasta el 17-10 la retención (`core.adquisicion.retencion`) no tocaba las
acciones, y un `update` perdía lo que la fuente no volvía a dar. Medido ese día
con `update <ISIN> --sin-red --sin-caducidad --sin-historico` sobre AENA y TSK:
se perdían `fundamentales.source`, `fundamentales.fetched_at` y
`fundamentales.quality` (que traen de la integración de julio y nada volvía a
escribir) y, en TSK, `fundamentales.roe_pct` (Yahoo ya no lo da). Los
fundamentales de una acción salen de Yahoo, que va por su cuenta (yfinance, sin
la caché de `core.http`), así que basta con que no responda para quedarse sin
ellos.

Reglas:

- Fundamentales, hasta 120 días desde su descarga (`fundamentales.fetched_at`
  de la ficha anterior o, sin ella, `meta.actualizado`): un ciclo de
  resultados trimestrales con margen para su publicación. Si la fuente no trae
  ningún valor, se conserva el bloque entero, con su origen, su fecha y su
  cobertura, que siguen describiendo esos valores. Si trae algunos, solo los
  valores que falten, nunca los metadatos (`source`, `fuente`, `fetched_at`,
  `quality`): los nuevos describen el bloque nuevo.
- Identidad que da el respaldo (sector, industria, descripción y símbolo de
  Yahoo), hasta 365 días, como la gestora de un fondo.
- Identidad FIRDS, hasta 180 días desde el día del índice en que se vio: la misma regla que en los
  fondos (`retencion.retiene_firds`, decisión A-170).

Como en los fondos, solo se retiene lo que puso una fuente (no lo corregido a
mano ni lo derivado), cada hoja lleva `retenido:<etiqueta original>@<fecha>` y
una hoja que ya venía retenida conserva su etiqueta y su fecha, así que la
retención caduca sola. El resumen va a `meta.retencion` y el canónico lo
traduce en el aviso `dato_retenido`.

**Sin red no hay retención de fundamentales, hay arrastre** (09-11-2026). En modo
sin red yfinance no se llama, porque sale a red por su cuenta, y `eodhd` lo avisa
con `procedencia.no_servido(ENDPOINT_SIN_RED)`, el mismo canal por el que justETF
avisa de lo que no pudo servir. No pedir un dato no es que la fuente haya dejado
de darlo: antes, un re-mapeo sin red marcaba «retenido» a 494 acciones, con la
fecha de ese día y sin `meta.fuentes.fundamentales`. Ahora el bloque de la ficha
anterior y la identidad de la misma llamada pasan **tal cual**: mismos valores,
misma procedencia, mismo `fetched_at` y mismo `meta.fuentes`. Lo único que sigue
por la retención es lo que ya venía retenido, que conserva su etiqueta y su fecha
y caduca a su plazo, igual que en una pasada con red en la que Yahoo no lo trae.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from core.adquisicion import procedencia, retencion as r

MAX_DIAS_FUNDAMENTALES = 120
MAX_DIAS_IDENTIDAD = 365

BLOQUE = "fundamentales"
# Describen el bloque, no son datos: con valores nuevos no se retienen. Los
# últimos son del resumen de EODHD de julio (versión del endpoint, huella de la
# respuesta, fecha de la fuente): con un bloque nuevo de Yahoo dirían otra cosa.
METADATOS = ("fundamentales.source", "fundamentales.fuente",
             "fundamentales.fetched_at", "fundamentales.quality",
             "fundamentales.schema_version", "fundamentales.instrument_type",
             "fundamentales.symbol", "fundamentales.currency", "fundamentales.as_of_date",
             "fundamentales.endpoint_version", "fundamentales.source_updated_at",
             "fundamentales.raw_payload_sha256")
IDENTIDAD = ("identificacion.sector", "identificacion.industria",
             "identificacion.descripcion", "identificacion.simbolo_yahoo")

#: El aviso con que el adaptador de acciones dice que, sin red, no pidió los fundamentales a
#: Yahoo (ver `fetchers.eodhd._fundamentals_yahoo`). Llega aquí en `sin_servir`.
FUENTE_SIN_RED = "eodhd"
ENDPOINT_SIN_RED = "yahoo_fundamentales"


def _es_metadato(ruta: str) -> bool:
    return any(ruta == m or ruta.startswith(m + ".") for m in METADATOS)


def _original(anterior: dict, proc_anterior: dict[str, str], ruta: str) -> str:
    """Etiqueta de la hoja en la ficha anterior. Las fichas de julio no tienen
    `meta.procedencia`: entonces la fuente única que `meta.fuentes` da al bloque."""
    etiqueta_ = r._resuelve(proc_anterior, ruta)
    if etiqueta_:
        return etiqueta_
    fuentes = r._get(anterior, f"meta.fuentes.{ruta.split('.', 1)[0]}") or []
    return fuentes[0] if isinstance(fuentes, list) and len(fuentes) == 1 else "desconocida"


def _retiene(final: dict, anterior: dict, proc: dict[str, str], proc_anterior: dict[str, str],
             rutas: list[str], fecha_base: dt.date | None, max_dias: int, hoy: dt.date,
             retenidos: list[dict], descartados: list[dict]) -> None:
    for ruta in rutas:
        original = _original(anterior, proc_anterior, ruta)
        if r._fuente_original(original) in r.NO_RETENIBLES:
            continue  # se reaplica (corrección) o se recalcula (derivado)
        ya = r.lee_etiqueta(original)
        fecha = r._fecha(ya[1]) if ya else fecha_base
        dias = (hoy - fecha).days if fecha else None
        if fecha is None or dias > max_dias:
            descartados.append({"ruta": ruta, "fecha": fecha.isoformat() if fecha else None,
                                "motivo": "sin_fecha" if fecha is None
                                else f"antiguedad_{dias}d_supera_{max_dias}d"})
            continue
        r._fija(final, ruta, r._copia(r._get(anterior, ruta)))
        proc[ruta] = original if ya else r.etiqueta(original, fecha.isoformat())
        retenidos.append({"ruta": ruta, "fecha": fecha.isoformat(), "dias": dias,
                          "fuente": [r.lee_etiqueta(proc[ruta])[0]]})


def no_se_pidio(sin_servir: dict[str, dict] | None) -> bool:
    """True si esta pasada no pidió los fundamentales de Yahoo (modo sin red)."""
    return ENDPOINT_SIN_RED in ((sin_servir or {}).get(FUENTE_SIN_RED) or {})


def arrastra_sin_red(final: dict, anterior: dict, proc: dict[str, str],
                     proc_anterior: dict[str, str]) -> list[str]:
    """Copia de `anterior` a `final`, tal cual, lo que da la llamada a Yahoo que no se hizo.

    Solo hojas vacías en `final` y con valor en `anterior`. Deja fuera lo que ya venía retenido
    (lo trata la retención, con su fecha y su plazo) y lo que es corrección o derivado (se
    reaplica o se recalcula en esta misma pasada). Cada hoja conserva su etiqueta de
    `meta.procedencia`, y el bloque, su entrada de `meta.fuentes`. Devuelve las rutas copiadas."""
    previo = r._get(anterior, BLOQUE)
    candidatas = list(procedencia.hojas(previo, BLOQUE)) if isinstance(previo, dict) else []
    candidatas += [(ruta, r._get(anterior, ruta)) for ruta in IDENTIDAD]
    copiadas: list[str] = []
    for ruta, valor in candidatas:
        if r.vacio(valor) or not r.vacio(r._get(final, ruta)):
            continue
        original = _original(anterior, proc_anterior, ruta)
        if r.lee_etiqueta(original) or r._fuente_original(original) in r.NO_RETENIBLES:
            continue
        r._fija(final, ruta, r._copia(valor))
        proc[ruta] = original
        copiadas.append(ruta)
    fuentes = final.setdefault("meta", {}).setdefault("fuentes", {})
    fuentes_anteriores = r._get(anterior, "meta.fuentes") or {}
    for ruta in copiadas:
        bloque = ruta.split(".", 1)[0]
        if bloque not in fuentes and isinstance(fuentes_anteriores.get(bloque), list):
            fuentes[bloque] = list(fuentes_anteriores[bloque])
        fuente = procedencia.fuente_de(proc[ruta])
        if fuente and fuente != "desconocida" and fuente not in fuentes.setdefault(bloque, []):
            fuentes[bloque].append(fuente)
    return copiadas


def aplica(final: dict, anterior: dict, hoy: dt.date | None = None,
           sin_servir: dict[str, dict] | None = None) -> dict:
    """Como `retencion.aplica`, para una acción. Devuelve `meta.retencion`.

    Con el aviso de que sin red no se pidieron los fundamentales (`no_se_pidio`), primero se
    arrastra la ficha anterior (`arrastra_sin_red`) y lo demás sigue por la retención."""
    hoy = hoy or r._hoy()
    meta = final.setdefault("meta", {})
    proc: dict[str, str] = meta.setdefault("procedencia", {})
    proc_anterior: dict[str, str] = r._get(anterior, "meta.procedencia") or {}
    retenidos: list[dict] = []
    descartados: list[dict] = []
    if no_se_pidio(sin_servir):
        arrastra_sin_red(final, anterior, proc, proc_anterior)

    previo = r._get(anterior, BLOQUE)
    if isinstance(previo, dict):
        nuevo = r._get(final, BLOQUE)
        con_valores = any(not _es_metadato(ruta) and not r.vacio(v)
                          for ruta, v in procedencia.hojas(nuevo if isinstance(nuevo, dict) else {}, BLOQUE))
        faltan = [ruta for ruta, v in procedencia.hojas(previo, BLOQUE)
                  if not r.vacio(v) and r.vacio(r._get(final, ruta))
                  and not (con_valores and _es_metadato(ruta))]
        fecha = (r._fecha(r._get(anterior, "fundamentales.fetched_at"))
                 or r._fecha(r._get(anterior, "meta.actualizado")))
        _retiene(final, anterior, proc, proc_anterior, faltan, fecha,
                 MAX_DIAS_FUNDAMENTALES, hoy, retenidos, descartados)

    faltan = [ruta for ruta in IDENTIDAD
              if not r.vacio(r._get(anterior, ruta)) and r.vacio(r._get(final, ruta))]
    _retiene(final, anterior, proc, proc_anterior, faltan,
             r._fecha(r._get(anterior, "meta.actualizado")), MAX_DIAS_IDENTIDAD, hoy,
             retenidos, descartados)
    r.retiene_firds(final, anterior, proc, proc_anterior, hoy, retenidos, descartados)

    resumen: dict[str, Any] = {}
    if retenidos or descartados:
        resumen = {"fecha_referencia": hoy.isoformat()}
        if retenidos:
            resumen["retenidos"] = retenidos
        if descartados:
            resumen["descartados"] = descartados
        meta["retencion"] = resumen
    else:
        meta.pop("retencion", None)
    meta["procedencia"] = dict(sorted(proc.items()))
    return resumen
