"""Retención: lo que la fuente deja de servir no se pierde sin más.

El 14-10-2026, tras refrescar las carteras de Morningstar, el canónico perdió
111 hojas en 24 fondos porque la fuente ya no las traía: `sal_fixedIncomeStyle`
a null (LU0077500055 se quedó sin vencimiento, TIR ni duración modificada),
`sal_creditQuality.fund` todo null (LU1670722161), `allocationMap` todo null
(LU1832969650) o la gestora fuera del snapshot (LU0995386439). La fusión solo
ve lo que traen las fuentes de esta pasada, así que el hueco pisaba la ficha
buena de la anterior.

Este paso compara la ficha fusionada con la `anterior` (la v2 ya guardada) y,
cuando la fuente deja de traer un bloque, conserva el valor anterior con estas
reglas:

- Métricas de renta fija (vencimiento, TIR, TIR a peor, duraciones, calidad
  media y los bloques de calidad crediticia y tramos de vencimiento): solo si la
  renta fija sigue pesando al menos un 5 % en la cartera nueva y el dato
  retenido tiene como mucho 180 días desde su fecha de cartera.
- Asignación de activos: solo si la fuente sirvió una cartera nueva (con fecha)
  y el dato retenido tiene como mucho 180 días desde su fecha de cartera. Aquí
  la condición de la clase no aplica: lo que falta es la propia asignación.
- Gestora: hasta 365 días desde que la fuente la sirvió por última vez.
- Bloque `emisor` y su serie `series.vl_emisor` (lo declarado por el emisor del ETF): hasta 180 días desde su última
  descarga. Sin esto, una pasada en la que el emisor no conteste, o sin su adaptador en
  las fuentes, borraría de la ficha toda la serie de VL.
- Bloque `mercado_objetivo` (el EMT del emisor, decisión 58): lo mismo, hasta 180 días desde la
  última descarga del fichero, para que una pasada con `--fuentes` sin `emt` no lo borre. Es casi
  todo texto, así que cuenta como vacío solo si no le queda ninguna hoja, no si no trae números.
- Identidad FIRDS (CFI, LEI del emisor, centros de negociación y los demás campos que deja
  `esma_firds`, con `meta.firds_visto`): hasta 180 días desde el día del índice en que se vio por
  última vez (decisión A-170 de Óscar, 16-11-2026). Si un ISIN sale del índice, la ficha conserva la
  última identidad conocida, marcada como retenida y desde cuándo, en vez de reescribirse sin ella.
  Vale para fondos, ETF y acciones (`retiene_firds`).
- Ratings (Medalist, estrellas): nunca. Un rating retirado debe desaparecer.
- Registros oficiales (CSSF, ESMA, CNMV, AMF): nunca. Si un registro que
  estaba deja de aparecer, aviso `registro_no_encontrado` para verificar una
  posible baja.
- Modo sin red (desde el 17-10): lo que dan solo las fuentes que no pasan por
  `core.http` (`SIN_RED`: la ficha completa de justETF), cuando el adaptador
  avisa de que en esta pasada no pudo servirlo (sin copia vigente), hasta 180
  días desde que la fuente lo sirvió.

Solo se retiene lo que puso una fuente. Lo corregido a mano (`manual:`) lo
vuelve a poner `core.correcciones` en esta misma pasada, y lo derivado
(`derivado:`) se recalcula: retenerlo haría pasar una corrección por
«redundante» y le quitaría su procedencia.

Cada hoja retenida lleva en `meta.procedencia` la etiqueta
`retenido:<etiqueta original>@<fecha de cartera>` y la ficha resume lo hecho en
`meta.retencion`; el canónico lo traduce en el aviso `dato_retenido`. Una hoja
que ya venía retenida conserva su etiqueta y su fecha originales: la antigüedad
se cuenta desde la última vez que la fuente la sirvió, no desde la última
pasada, así que la retención caduca sola.
"""
from __future__ import annotations

import dataclasses
import datetime as dt
import re
from typing import Any

from core.adquisicion import procedencia
from core.correcciones import FUENTE as FUENTE_MANUAL

UMBRAL_CLASE_PCT = 5.0
MAX_DIAS_CARTERA = 180
MAX_DIAS_GESTORA = 365
MAX_DIAS_EMISOR = 180
# Decisión 58, completada el 09-11-2026: el mismo plazo que el bloque `emisor` y por la misma razón.
MAX_DIAS_MERCADO_OBJETIVO = MAX_DIAS_EMISOR

# Decisión A-170 (16-11-2026, EXT-6, la opción C de la decisión 57): la identidad FIRDS de un ISIN que
# sale del índice. El plazo NO lo fija la decisión: son los 180 días de la cartera y del emisor y no los
# 365 de la gestora, porque salir de un registro oficial puede ser una baja de verdad y una identidad
# vieja no debe sobrevivirle un año. Confirmado por Óscar el 17-11-2026 (A-183).
MAX_DIAS_FIRDS = 180
FUENTE_FIRDS = "esma_firds"
RUTA_FIRDS_VISTO = "meta.firds_visto"
#: Los diez campos que escribe `fetchers.esma_firds.fetch`. `identificacion.cfi` lo escriben dos fuentes
#: (FIRDS y la ficha de la CNMV): solo se retiene el que puso FIRDS, y solo si la otra no lo trae ahora.
RUTAS_FIRDS = (
    "identificacion.nombre_oficial_firds", "identificacion.nombre_corto_firds", "identificacion.cfi",
    "identificacion.cfi_tipo", "identificacion.divisa_nominal_firds", "identificacion.lei_emisor",
    "identificacion.autoridad_competente_firds", "identificacion.mercados_ue",
    "identificacion.baja_en_todos_firds", RUTA_FIRDS_VISTO,
)
#: Con qué nombre sale la identidad FIRDS en `meta.retencion`: es un bloque de la ficha repartido en
#: diez rutas, y se retiene o se descarta entero.
BLOQUE_FIRDS = "identidad_firds"

AVISO_RETENIDO = "dato_retenido"
# Fuentes que no se retienen: las correcciones se reaplican y lo derivado se recalcula.
NO_RETENIBLES = frozenset({FUENTE_MANUAL, procedencia.DERIVADO})
AVISO_REGISTRO = "registro_no_encontrado"


@dataclasses.dataclass(frozen=True)
class Regla:
    ruta: str        # ruta v2 (hoja escalar o bloque de números)
    familia: str     # "renta_fija" | "asignacion" | "gestora" | "emisor" | "mercado_objetivo"
    max_dias: int
    bloque: bool = False
    # Un bloque de números sin ningún valor distinto de cero cuenta como vacío (Morningstar manda la
    # estructura a null o a 0). Un bloque de texto no: con `False`, vacío es no tener ninguna hoja.
    solo_numeros: bool = True

    def vacio(self, v: Any) -> bool:
        if self.bloque and not self.solo_numeros:
            return vacio(v) or not any(not vacio(h) for _r, h in procedencia.hojas(v))
        return vacio(v, self.bloque)


REGLAS: tuple[Regla, ...] = (
    # La asignación va primero: de ella sale el peso de la renta fija.
    Regla("cartera.asignacion_activos", "asignacion", MAX_DIAS_CARTERA, bloque=True),
    Regla("cartera.renta_fija.vencimiento_efectivo", "renta_fija", MAX_DIAS_CARTERA),
    Regla("cartera.renta_fija.ytm_pct", "renta_fija", MAX_DIAS_CARTERA),
    Regla("cartera.renta_fija.ytw_pct", "renta_fija", MAX_DIAS_CARTERA),
    Regla("cartera.renta_fija.duracion_efectiva", "renta_fija", MAX_DIAS_CARTERA),
    Regla("cartera.renta_fija.duracion_modificada", "renta_fija", MAX_DIAS_CARTERA),
    Regla("cartera.renta_fija.calidad_media", "renta_fija", MAX_DIAS_CARTERA),
    Regla("cartera.renta_fija.calidad_crediticia_pct", "renta_fija", MAX_DIAS_CARTERA, bloque=True),
    Regla("cartera.renta_fija.vencimientos_pct", "renta_fija", MAX_DIAS_CARTERA, bloque=True),
    Regla("identificacion.gestora", "gestora", MAX_DIAS_GESTORA),
    Regla("emisor", "emisor", MAX_DIAS_EMISOR, bloque=True),
    Regla("series.vl_emisor", "emisor", MAX_DIAS_EMISOR),
    Regla("mercado_objetivo", "mercado_objetivo", MAX_DIAS_MERCADO_OBJETIVO, bloque=True, solo_numeros=False),
)

# Modo sin red: fuentes que no pasan por `core.http` (bibliotecas de terceros
# con su propia red) y las rutas que solo ellas dan. Si en una pasada sin red
# no tienen copia vigente que servir, lo que la ficha anterior tenía de ellas se
# retiene, con el mismo límite que la cartera, en vez de perderse: el 16-10, con
# `--sin-red`, 12 ETF perdían la descripción, las posiciones top-10 y los países
# de justETF (revisión de la rama, IMP-1).
# Solo actúa si el adaptador avisó en esta pasada de que no pudo servir su ficha
# (`procedencia.no_servido`, que llega aquí como `sin_servir`): no con red, no si
# la fuente no estaba en el plan del ISIN, y no si la copia vigente se sirvió y
# ya no trae un campo, que entonces no se resucita (tercera pasada, MEN-A).
SIN_RED: dict[str, tuple[str, ...]] = {
    "justetf": (
        "identificacion.nombre", "identificacion.descripcion",
        "identificacion.indice_benchmark_oficial", "identificacion.replicacion",
        "identificacion.divisa_base", "identificacion.politica_distribucion",
        "identificacion.fecha_lanzamiento_fondo", "identificacion.domicilio",
        "costes.ter_pct", "valoracion.patrimonio_fondo_meur",
        "cartera.paises_pct", "cartera.sectores_pct", "cartera.posiciones", "cartera.peso_top10_pct",
    ),
}
MAX_DIAS_SIN_RED = MAX_DIAS_CARTERA

# Registros oficiales: la ruta que delata que el registro estaba. No se retienen.
REGISTROS: dict[str, tuple[str, ...]] = {
    "cssf": ("identificacion.paraguas_legal",),
    "esma": ("identificacion.nombre_legal_esma", "identificacion.estado_registro_esma"),
    "cnmv": ("identificacion.registro_cnmv",),
    "amf": ("identificacion.numero_autorizacion_amf",),
}

_FECHA = re.compile(r"^(\d{4}-\d{2}-\d{2})")


# ------------------------------------------------------------------ etiquetas
def etiqueta(original: str, fecha: str) -> str:
    """`retenido:morningstar_lt:sal_fixedIncomeStyle@2026-04-30`."""
    return f"{procedencia.RETENIDO}{procedencia.SEPARADOR}{original}@{fecha}"


def lee_etiqueta(etiqueta_: str | None) -> tuple[str, str] | None:
    """(etiqueta original, fecha) si la hoja ya venía retenida; si no, None."""
    prefijo = procedencia.RETENIDO + procedencia.SEPARADOR
    if not etiqueta_ or not etiqueta_.startswith(prefijo) or "@" not in etiqueta_:
        return None
    original, fecha = etiqueta_[len(prefijo):].rsplit("@", 1)
    return original, fecha


# ------------------------------------------------------------------ utilidades
def _get(d: Any, ruta: str) -> Any:
    for k in ruta.split("."):
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _fija(d: dict, ruta: str, valor: Any) -> None:
    partes = ruta.split(".")
    for p in partes[:-1]:
        siguiente = d.get(p)
        if not isinstance(siguiente, dict):
            siguiente = d[p] = {}
        d = siguiente
    d[partes[-1]] = valor


def _numeros(v: Any) -> list[float]:
    if isinstance(v, bool):
        return []
    if isinstance(v, (int, float)):
        return [v]
    if isinstance(v, dict):
        return [x for valor in v.values() for x in _numeros(valor)]
    return []


def vacio(v: Any, bloque: bool = False) -> bool:
    """Sin dato. Un bloque de números sin ningún valor distinto de cero cuenta
    como vacío: Morningstar devuelve la estructura con todo a null (o a 0)."""
    if v is None or v == {} or v == [] or v == "":
        return True
    if bloque and isinstance(v, dict):
        return not any(x != 0 for x in _numeros(v))
    return False


def _fecha(v: Any) -> dt.date | None:
    if isinstance(v, dt.date):
        return v
    m = _FECHA.match(str(v or ""))
    if not m:
        return None
    try:
        return dt.date.fromisoformat(m.group(1))
    except ValueError:
        return None


def _resuelve(proc: dict[str, str], ruta: str) -> str | None:
    """Etiqueta de la hoja o de su ancestro más cercano."""
    partes = ruta.split(".")
    for n in range(len(partes), 0, -1):
        candidata = ".".join(partes[:n])
        if candidata in proc:
            return proc[candidata]
    return None


def _hoja_rutas(ruta: str, valor: Any) -> list[str]:
    return [r for r, _v in procedencia.hojas(valor, ruta)] if isinstance(valor, dict) else [ruta]


def _original(proc_anterior: dict[str, str], ruta: str) -> str:
    """Etiqueta de la hoja en la ficha anterior (la de retención, si ya venía retenida)."""
    return _resuelve(proc_anterior, ruta) or "desconocida"


def _fuente_original(etiqueta_: str) -> str | None:
    retenida = lee_etiqueta(etiqueta_)
    return procedencia.fuente_de(retenida[0] if retenida else etiqueta_)


def _hoy() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date()


# ------------------------------------------------------------------ fechas
def _fecha_base(regla: Regla, anterior: dict) -> dt.date | None:
    """Fecha del dato en la ficha anterior cuando la fuente lo sirvió (no retenido)."""
    if regla.familia == "renta_fija":
        return (_fecha(_get(anterior, "cartera.renta_fija.fecha"))
                or _fecha(_get(anterior, "cartera.fecha")))
    if regla.familia == "asignacion":
        return _fecha(_get(anterior, "cartera.fecha"))
    if regla.familia == "emisor":
        return _fecha(_get(anterior, "emisor.fecha_descarga"))
    if regla.familia == "mercado_objetivo":
        # El bloque no lleva fecha de descarga: es la del fichero del emisor, que la pasada que lo
        # sirvió dejó en `meta.adquisicion`. Sin ella, la de generación del fichero (`00005`), que no es
        # posterior a la descarga y por eso no alarga el plazo.
        endpoints = _get(anterior, "meta.adquisicion.fuentes.emt.endpoints") or {}
        descargas = [f for f in (_fecha((e or {}).get("fetched_at")) for e in endpoints.values()
                                 if isinstance(e, dict)) if f]
        return max(descargas) if descargas else _fecha(_get(anterior, "mercado_objetivo.fichero_generado"))
    return _fecha(_get(anterior, "meta.actualizado"))


def _fecha_dato(regla: Regla, anterior: dict, rutas: list[str],
                proc_anterior: dict[str, str]) -> dt.date | None:
    """Si alguna hoja ya venía retenida manda la fecha más antigua de esas."""
    retenidas = [lee_etiqueta(_resuelve(proc_anterior, r)) for r in rutas]
    fechas = [_fecha(x[1]) for x in retenidas if x]
    fechas = [f for f in fechas if f]
    if fechas:
        return min(fechas)
    return _fecha_base(regla, anterior)


# ------------------------------------------------------------------ identidad FIRDS
def firds_retenida_desde(d: dict) -> str | None:
    """El día del índice FIRDS del que viene una identidad RETENIDA, o `None` si es de esta pasada."""
    retenida = lee_etiqueta(_resuelve(_get(d, "meta.procedencia") or {}, RUTA_FIRDS_VISTO))
    return retenida[1] if retenida and procedencia.fuente_de(retenida[0]) == FUENTE_FIRDS else None


def retiene_firds(final: dict, anterior: dict, proc: dict[str, str], proc_anterior: dict[str, str],
                  hoy: dt.date, retenidos: list[dict], descartados: list[dict]) -> None:
    """Conserva la identidad FIRDS de la ficha anterior cuando esta pasada no la trae.

    Decisión A-170 de Óscar (16-11-2026), ante EXT-6. Si un ISIN sale del índice, `esma_firds.fetch`
    devuelve {} y la ficha se reescribía sin sus diez campos, con solo un aviso en el registro de la
    pasada. Ahora se quedan los de la ficha anterior, cada hoja con `retenido:esma_firds:fulins@<día del
    índice en que se vio>`, y `meta.firds_visto` sigue diciendo ese mismo día: es la fecha a la que la
    identidad era verdad, no la de hoy.

    Se cuenta desde ese día, no desde la última pasada, así que caduca sola a los `MAX_DIAS_FIRDS`; al
    caducar, la ficha se queda sin identidad FIRDS y `meta.retencion.descartados` lo dice.

    No actúa si esta pasada trae FIRDS, ni sobre una hoja que no puso FIRDS, ni sobre una que ahora da
    otra fuente (el CFI de la ficha de la CNMV). Sin índice en disco la pasada ni empieza (decisión 57,
    `core.pasada.guarda_firds`); con `--sin-firds`, que la fuerza, también retiene."""
    visto = _get(anterior, RUTA_FIRDS_VISTO)
    if vacio(visto) or not vacio(_get(final, RUTA_FIRDS_VISTO)):
        return
    rutas = [r for r in RUTAS_FIRDS
             if not vacio(_get(anterior, r)) and vacio(_get(final, r))
             and _fuente_original(_original(proc_anterior, r)) == FUENTE_FIRDS]
    if RUTA_FIRDS_VISTO not in rutas:
        return  # sin el día del índice puesto por FIRDS no hay a qué fecha retener
    ya = lee_etiqueta(_resuelve(proc_anterior, RUTA_FIRDS_VISTO))
    fecha = _fecha(ya[1]) if ya else _fecha(visto)
    dias = (hoy - fecha).days if fecha else None
    if fecha is None or dias > MAX_DIAS_FIRDS:
        descartados.append({"ruta": BLOQUE_FIRDS, "fecha": fecha.isoformat() if fecha else None,
                            "motivo": "sin_fecha" if fecha is None
                            else f"antiguedad_{dias}d_supera_{MAX_DIAS_FIRDS}d"})
        return
    for r in rutas:
        _fija(final, r, _copia(_get(anterior, r)))
        original = _original(proc_anterior, r)
        proc[r] = original if lee_etiqueta(original) else etiqueta(original, fecha.isoformat())
    retenidos.append({"ruta": BLOQUE_FIRDS, "fecha": fecha.isoformat(), "dias": dias,
                      "caduca": (fecha + dt.timedelta(days=MAX_DIAS_FIRDS)).isoformat(),
                      "fuente": sorted({lee_etiqueta(proc[r])[0] for r in rutas})})


# ------------------------------------------------------------------ paso
def aplica(final: dict, anterior: dict | None, hoy: dt.date | None = None,
           sin_servir: dict[str, dict[str, float | None]] | None = None) -> dict:
    """Retiene en `final` (in situ) lo que la fuente dejó de traer.

    `sin_servir`: fuente -> {endpoint: fetched_at de su copia caducada o None},
    lo que cada adaptador avisó de que no pudo servir en esta pasada sin red. De
    las fuentes de `SIN_RED` que estén ahí se retiene además lo suyo.
    Devuelve el resumen que deja en `meta.retencion` (vacío si no hizo nada)."""
    if not anterior or not isinstance(final, dict):
        return {}
    tipo = str(_get(final, "identificacion.tipo") or _get(anterior, "identificacion.tipo") or "").lower()
    if tipo == "accion":
        # Las acciones tienen sus propias reglas (fundamentales e identidad de Yahoo).
        from core.adquisicion import retencion_acciones
        return retencion_acciones.aplica(final, anterior, hoy, sin_servir=sin_servir)
    hoy = hoy or _hoy()
    meta = final.setdefault("meta", {})
    proc: dict[str, str] = meta.setdefault("procedencia", {})
    proc_anterior: dict[str, str] = _get(anterior, "meta.procedencia") or {}

    retenidos: list[dict] = []
    descartados: list[dict] = []
    hay_cartera_nueva = _fecha(_get(final, "cartera.fecha")) is not None

    for regla in REGLAS:
        nuevo = _get(final, regla.ruta)
        previo = _get(anterior, regla.ruta)
        if not regla.vacio(nuevo) or regla.vacio(previo):
            continue
        motivo = None
        if regla.familia in ("renta_fija", "asignacion") and not hay_cartera_nueva:
            motivo = "sin_cartera_nueva"
        elif regla.familia == "renta_fija":
            peso = _get(final, "cartera.asignacion_activos.rf.neto")
            if not isinstance(peso, (int, float)) or isinstance(peso, bool):
                motivo = "sin_peso_renta_fija"
            elif peso < UMBRAL_CLASE_PCT:
                motivo = f"renta_fija_{peso:g}pct_bajo_umbral"
        rutas = [r for r in _hoja_rutas(regla.ruta, previo)
                 if _fuente_original(_original(proc_anterior, r)) not in NO_RETENIBLES]
        if not rutas:
            continue  # todo es corrección o derivado: se reaplica o recalcula en el saneado
        fecha = _fecha_dato(regla, anterior, rutas, proc_anterior)
        dias = (hoy - fecha).days if fecha else None
        if motivo is None and fecha is None:
            motivo = "sin_fecha"
        if motivo is None and dias > regla.max_dias:
            motivo = f"antiguedad_{dias}d_supera_{regla.max_dias}d"
        if motivo:
            descartados.append({"ruta": regla.ruta, "motivo": motivo,
                                "fecha": fecha.isoformat() if fecha else None})
            continue

        # Fuera lo que hubiera vacío (nulos o ceros) y dentro lo anterior que puso una fuente.
        if regla.bloque:
            bloque: dict = {}
            for r in rutas:
                _fija(bloque, r[len(regla.ruta) + 1:], _copia(_get(previo, r[len(regla.ruta) + 1:])))
            _fija(final, regla.ruta, bloque)
        else:
            _fija(final, regla.ruta, _copia(previo))
        for r in list(proc):
            if r == regla.ruta or r.startswith(regla.ruta + "."):
                del proc[r]
        for r in rutas:
            original = _original(proc_anterior, r)
            proc[r] = original if lee_etiqueta(original) else etiqueta(original, fecha.isoformat())
        retenidos.append({"ruta": regla.ruta, "fecha": fecha.isoformat(), "dias": dias,
                          "fuente": sorted({lee_etiqueta(proc[r])[0] for r in rutas})})

    if sin_servir:
        _retiene_sin_red(final, anterior, proc, proc_anterior, hoy, retenidos, descartados, sin_servir)
    retiene_firds(final, anterior, proc, proc_anterior, hoy, retenidos, descartados)

    registros = [nombre for nombre, rutas_reg in REGISTROS.items()
                 if any(not vacio(_get(anterior, r)) for r in rutas_reg)
                 and all(vacio(_get(final, r)) for r in rutas_reg)]

    resumen: dict = {}
    if retenidos or descartados or registros:
        resumen = {"fecha_referencia": hoy.isoformat()}
        if retenidos:
            resumen["retenidos"] = retenidos
        if descartados:
            resumen["descartados"] = descartados
        if registros:
            resumen["registros_no_encontrados"] = registros
        meta["retencion"] = resumen
    else:
        meta.pop("retencion", None)
    meta["procedencia"] = dict(sorted(proc.items()))
    return resumen


def _retiene_sin_red(final: dict, anterior: dict, proc: dict[str, str], proc_anterior: dict[str, str],
                     hoy: dt.date, retenidos: list[dict], descartados: list[dict],
                     sin_servir: dict[str, dict[str, float | None]]) -> None:
    """Modo sin red: conserva de la ficha anterior lo que puso una fuente de
    `SIN_RED` que avisó de que no pudo servirlo. Solo rutas vacías en `final`:
    si otra fuente ya lo dio, no se toca. Las hojas llevan
    `retenido:<etiqueta>@<fecha en que la fuente lo sirvió>`.

    Esa fecha (tercera pasada, MEN-B) es, por orden: la de la etiqueta si la
    hoja ya venía retenida; la de descarga de la copia caducada que la fuente
    no pudo servir; y solo sin copia, la de la ficha anterior. Así el tope de
    180 días cuenta desde que justETF dio el dato y no se alarga con cada
    regeneración desde la copia."""
    for fuente, rutas_fuente in SIN_RED.items():
        if fuente not in sin_servir:
            continue
        # Solo marcas de tiempo válidas: una copia corrupta no tumba la pasada (MEN-G).
        descargas = [x for x in (procedencia.epoca_valida(v) for v in sin_servir[fuente].values()) if x]
        try:
            fecha_copia = (dt.datetime.fromtimestamp(min(descargas), dt.timezone.utc).date()
                           if descargas else None)
        except (OverflowError, OSError, ValueError):
            fecha_copia = None
        for ruta in rutas_fuente:
            previo = _get(anterior, ruta)
            bloque = isinstance(previo, dict)
            if not vacio(_get(final, ruta), bloque) or vacio(previo, bloque):
                continue
            rutas = [r for r in _hoja_rutas(ruta, previo)
                     if _fuente_original(_original(proc_anterior, r)) == fuente]
            if not rutas:
                continue
            ya_retenidas = [lee_etiqueta(_resuelve(proc_anterior, r)) for r in rutas]
            fechas = [f for f in (_fecha(x[1]) for x in ya_retenidas if x) if f]
            fecha = min(fechas) if fechas else (fecha_copia or _fecha(_get(anterior, "meta.actualizado")))
            dias = (hoy - fecha).days if fecha else None
            if fecha is None or dias > MAX_DIAS_SIN_RED:
                descartados.append({"ruta": ruta, "fecha": fecha.isoformat() if fecha else None,
                                    "motivo": "sin_fecha" if fecha is None
                                    else f"sin_red_antiguedad_{dias}d_supera_{MAX_DIAS_SIN_RED}d"})
                continue
            if bloque:
                nuevo: dict = {}
                for r in rutas:
                    _fija(nuevo, r[len(ruta) + 1:], _copia(_get(previo, r[len(ruta) + 1:])))
                _fija(final, ruta, nuevo)
            else:
                _fija(final, ruta, _copia(previo))
            for r in list(proc):
                if r == ruta or r.startswith(ruta + "."):
                    del proc[r]
            for r in rutas:
                original = _original(proc_anterior, r)
                proc[r] = original if lee_etiqueta(original) else etiqueta(original, fecha.isoformat())
            retenidos.append({"ruta": ruta, "fecha": fecha.isoformat(), "dias": dias,
                              "fuente": sorted({lee_etiqueta(proc[r])[0] for r in rutas}),
                              "motivo": "sin_red"})


def avisos(d: dict) -> list[str]:
    """Avisos del canónico que salen de `meta.retencion` de una ficha v2."""
    ret = _get(d, "meta.retencion") or {}
    out = []
    if ret.get("retenidos"):
        out.append(AVISO_RETENIDO)
    if ret.get("registros_no_encontrados"):
        out.append(AVISO_REGISTRO)
    return out


def _copia(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: _copia(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_copia(x) for x in v]
    return v
