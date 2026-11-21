"""Esquema v2: helpers para construir, escribir rutas y fusionar fuentes.

Cada fetcher devuelve un dict parcial con la MISMA forma que esquema_fondo.json.
merge() combina los parciales según la prioridad de fuentes: el primer valor
no nulo gana; los huecos se rellenan con las fuentes siguientes.

Desde el 04-09 la fusión trabaja hoja a hoja y deja en `meta.procedencia`
quién escribió cada ruta (`fuente:endpoint`), además del `meta.fuentes` por
bloque de siempre. Y aplica una regla de frescura: el valor liquidativo lo
pone la fuente con la fecha más reciente, no la primera de la lista (la CNMV
publica el VL de fin de mes con retraso y pisaba el diario de Morningstar).
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from core.adquisicion import procedencia


def ahora_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def set_path(d: dict, ruta: str, valor: Any) -> None:
    """set_path(d, 'cartera.renta_fija.ytm_pct', 3.2)"""
    if valor is None:
        return
    partes = ruta.split(".")
    for p in partes[:-1]:
        d = d.setdefault(p, {})
    d[partes[-1]] = valor
    procedencia.anota(ruta)


def _es_vacio(v: Any) -> bool:
    return v is None or v == {} or v == []


def _get_path(d: dict, ruta: str, default: Any = None) -> Any:
    for k in ruta.split("."):
        if not isinstance(d, dict) or k not in d:
            return default
        d = d[k]
    return d


def _pisa_ancestro(resultado: dict, partes: list[str]) -> bool:
    """True si algún ancestro de la ruta ya es una hoja (escalar/lista)."""
    nodo = resultado
    for p in partes[:-1]:
        if p not in nodo:
            return False
        nodo = nodo[p]
        if not isinstance(nodo, dict):
            return True
    return False


def _fija(resultado: dict, partes: list[str], valor: Any) -> None:
    nodo = resultado
    for p in partes[:-1]:
        nodo = nodo.setdefault(p, {})
    nodo[partes[-1]] = valor


def _quita(resultado: dict, partes: list[str]) -> None:
    """Quita la hoja y, si se quedan vacíos, los dicts que la contenían."""
    camino = [resultado]
    for p in partes[:-1]:
        siguiente = camino[-1].get(p) if isinstance(camino[-1], dict) else None
        if not isinstance(siguiente, dict):
            return
        camino.append(siguiente)
    camino[-1].pop(partes[-1], None)
    for nivel in range(len(camino) - 1, 0, -1):
        if camino[nivel]:
            break
        camino[nivel - 1].pop(partes[nivel - 1], None)


# Reglas de frescura: (ruta con fecha ISO, rutas sin las que una fuente no
# compite, rutas que viajan juntas). Gana la fuente con la fecha más reciente;
# a igual fecha, la prioridad de siempre. La tupla entera sale de la ganadora.
REGLAS_FRESCURA = (
    ("valoracion.vl_fecha", ("valoracion.vl",),
     ("valoracion.vl", "valoracion.vl_fecha", "valoracion.vl_divisa")),
)


def merge(parciales: list[tuple[str, dict]], prioridad: list[str],
          isin: str, procedencias: dict[str, dict[str, str]] | None = None,
          prioridad_por_ruta: dict[str, list[str]] | None = None,
          desempate_frescura: tuple[str, ...] | list[str] = ()) -> dict:
    """Combina dicts parciales [(fuente, datos), ...] según prioridad.

    Registra en meta.fuentes qué fuentes aportaron cada bloque de primer nivel
    y en meta.procedencia quién escribió cada hoja (`procedencias` opcional:
    fuente -> {ruta: etiqueta}; sin él, la etiqueta es la fuente).
    `prioridad_por_ruta` permite otro orden para rutas concretas (p.ej. el
    dato oficial antes que el comercial para el SRI del KID).
    `desempate_frescura`: fuentes que, a igual fecha, ganan la regla de frescura
    antes que el orden de `prioridad` (p.ej. en un ETF, la plaza de su serie).
    """
    orden = sorted(
        [p for p in parciales if p[1]],
        key=lambda x: prioridad.index(x[0]) if x[0] in prioridad else 99,
    )
    procedencias = procedencias or {}
    resultado: dict = {}
    escrito_por: dict[str, str] = {}
    fuentes_por_bloque: dict[str, list[str]] = {}
    hojas_por_fuente: dict[str, dict[str, Any]] = {}
    especiales = {ruta: [f for f in orden_ruta if any(f == p[0] for p in orden)]
                  for ruta, orden_ruta in (prioridad_por_ruta or {}).items()}

    for fuente, datos in orden:
        etiquetas = procedencias.get(fuente) or {}
        hojas_por_fuente[fuente] = {}
        for bloque, contenido in datos.items():
            if _es_vacio(contenido):
                continue
            fuentes_por_bloque.setdefault(bloque, [])
            if fuente not in fuentes_por_bloque[bloque]:
                fuentes_por_bloque[bloque].append(fuente)
        for ruta, valor in procedencia.hojas(datos):
            if _es_vacio(valor):
                continue
            hojas_por_fuente[fuente][ruta] = valor
            if ruta in especiales:
                continue  # se resuelve después con su propio orden
            if ruta in escrito_por:
                continue
            partes = ruta.split(".")
            if _pisa_ancestro(resultado, partes):
                continue
            if isinstance(_get_path(resultado, ruta), dict):
                continue  # ya hay un subárbol con más detalle
            _fija(resultado, partes, valor)
            escrito_por[ruta] = etiquetas.get(ruta) or fuente

    for ruta, orden_ruta in especiales.items():
        for fuente in orden_ruta + [f for f, _d in orden if f not in orden_ruta]:
            valor = hojas_por_fuente.get(fuente, {}).get(ruta)
            if _es_vacio(valor):
                continue
            partes = ruta.split(".")
            if _pisa_ancestro(resultado, partes) or isinstance(_get_path(resultado, ruta), dict):
                break
            _fija(resultado, partes, valor)
            escrito_por[ruta] = (procedencias.get(fuente) or {}).get(ruta) or fuente
            break

    _aplica_frescura(resultado, escrito_por, orden, hojas_por_fuente, procedencias,
                     desempate_frescura)

    meta = resultado.setdefault("meta", {})
    meta["isin"] = isin
    meta["actualizado"] = ahora_iso()
    meta["version_esquema"] = 2
    meta["fuentes"] = fuentes_por_bloque
    meta.setdefault("errores", [])
    meta["procedencia"] = dict(sorted(escrito_por.items()))
    return resultado


def _aplica_frescura(resultado, escrito_por, orden, hojas_por_fuente, procedencias,
                     desempate=()) -> None:
    """La tupla (vl, fecha, divisa) sale entera de la fuente con la fecha más reciente.

    Hasta el 16-10 competían las fuentes con fecha aunque no trajeran `vl`, y lo
    que le faltaba a la ganadora se quedaba el de otra fuente: con una fecha
    del 15-10 sin precio, el `vl` del 10-10 salía etiquetado con fecha del
    15-10, y el bueno del 14-10 se perdía (auditoría 16-10, ALTA-16a). Ahora
    solo compiten las fuentes con `vl` y fecha, y lo que no traiga la ganadora
    se queda vacío en lugar de heredarse de otra fuente. Con una sola
    candidata también se aplica: la fusión por hoja podía haberla mezclado.

    Sin ninguna candidata (nadie trae `vl` y fecha a la vez), la tupla es la de
    la fuente que pone el `vl` por prioridad: una fecha o una divisa de otra
    fuente no se le pegan. Y sin `vl` no hay tupla: una fecha o una divisa
    sueltas se quitan (revisión de la rama, MEN-2).

    A igual fecha, las fuentes de `desempate` van primero y, entre las demás,
    la prioridad. Sin desempate, en un ETF ganaba justETF a EODHD (justETF está
    en `prioridad_fuentes` desde el 11-06, cuando aún no había EODHD; este
    entró después como implícito y quedó detrás de toda la lista), y el 09-11
    justETF daba el valor liquidativo convertido a EUR en el mismo día que el
    cierre de la plaza de la serie.
    """
    desempate = list(desempate or ())
    posicion = {fuente: (desempate.index(fuente) if fuente in desempate else len(desempate) + i)
                for i, (fuente, _d) in enumerate(orden)}
    for ruta_fecha, obligatorias, rutas in REGLAS_FRESCURA:
        candidatas = [(h[ruta_fecha], fuente)
                      for fuente, h in hojas_por_fuente.items()
                      if isinstance(h.get(ruta_fecha), str) and h[ruta_fecha]
                      and not any(_es_vacio(h.get(r)) for r in obligatorias)]
        if candidatas:
            # la más reciente; a igual fecha, la del desempate y luego la primera en prioridad
            candidatas.sort(key=lambda x: (x[0], -posicion[x[1]]), reverse=True)
            _fecha, ganadora = candidatas[0]
        else:
            ganadora = next((fuente for fuente, _d in orden
                             if not any(_es_vacio(hojas_por_fuente.get(fuente, {}).get(r))
                                        for r in obligatorias)), None)
        hojas = hojas_por_fuente.get(ganadora, {}) if ganadora else {}
        etiquetas = procedencias.get(ganadora) or {}
        for ruta in rutas:
            valor = hojas.get(ruta)
            if _es_vacio(valor):
                _quita(resultado, ruta.split("."))
                escrito_por.pop(ruta, None)
                continue
            _fija(resultado, ruta.split("."), valor)
            escrito_por[ruta] = etiquetas.get(ruta) or ganadora


def cuenta_campos(d: Any) -> tuple[int, int]:
    """(campos_con_dato, campos_totales) contando hojas escalares."""
    if isinstance(d, dict):
        con, tot = 0, 0
        for v in d.values():
            c, t = cuenta_campos(v)
            con, tot = con + c, tot + t
        return con, tot
    if isinstance(d, list):
        con, tot = 0, 0
        for v in d:
            c, t = cuenta_campos(v)
            con, tot = con + c, tot + t
        return con, tot
    return (0, 1) if d is None else (1, 1)
