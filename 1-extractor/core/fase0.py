"""Informes de la fase 0 del plan «fondos sin Morningstar» (28-10-2026), sin red.

Dos preguntas, sobre las fichas v2 ya guardadas (`data/funds/*.json`):

- `contraste`: ¿las métricas propias (serie de EODHD, `core.metricas`) cuadran
  con las de Morningstar? Morningstar ya no entra en la ficha en esas rutas,
  pero su valor queda en `meta.contraste` (`nucleo.aplica_contraste`); aquí se
  compara con el de la ficha cuando los dos están fechados el mismo día.
  Si las fechas no coinciden (Morningstar aún no ha publicado el cierre de mes,
  o su VL lleva semanas parado) no se compara: se cuenta aparte. Tampoco si
  las divisas no coinciden: Morningstar da en la divisa de la clase lo que sale
  de sal-service (`sal_*`) y en EUR lo del screener y las vistas «snapshot»
  (`currencyId=EUR`), mientras que lo propio va siempre en la divisa de la clase.
- `cobertura`: ¿cuánto de cada ficha viene ya de fuera de Morningstar, por
  bloque y por gestora, y cuántos fondos tienen el VL del día hábil anterior?

La puerta de la fase 0 es: VL del día hábil anterior en el 100 % de los fondos
y las métricas propias dentro de tolerancia frente a Morningstar.
"""
from __future__ import annotations

import datetime as dt
import statistics
from typing import Any, Iterable

from core.adquisicion import procedencia

# Tolerancias del contraste: VL en % relativo; lo demás en puntos (pp) o en
# unidades de Sharpe.
TOLERANCIAS = {
    "valoracion.vl": ("rel_pct", 0.5),
    "rentabilidad.trailing_pct": ("abs", 0.5),
    "rentabilidad.por_año_natural": ("abs", 0.5),
    "riesgo.volatilidad_pct": ("abs", 0.5),
    "riesgo.sharpe": ("abs", 0.10),
    "riesgo.rf_pct": ("abs", 0.25),
    "riesgo.max_drawdown.pct": ("abs", 1.0),
}
# Ruta -> la fecha que la acompaña. Sin la misma fecha en las dos fuentes, no
# se compara (`fecha_distinta`).
FECHA_DE = {
    "valoracion.vl": "valoracion.vl_fecha",
    "rentabilidad.trailing_pct": "rentabilidad.fecha_dato",
    "riesgo.volatilidad_pct": "riesgo.fecha_dato",
    "riesgo.sharpe": "riesgo.fecha_dato",
    "riesgo.rf_pct": "riesgo.fecha_dato",
    "riesgo.max_drawdown.pct": "rentabilidad.fecha_dato",
}
# Rutas de fecha o de texto: viajan en `meta.contraste` pero no se comparan.
NO_COMPARABLES = ("valoracion.vl_fecha", "valoracion.vl_divisa", "rentabilidad.fecha_dato",
                  "riesgo.fecha_dato", "riesgo.max_drawdown.periodo",
                  "riesgo.max_drawdown.meses_caida")

BLOQUES = ("identificacion", "valoracion", "costes", "rentabilidad", "riesgo", "rating",
           "cartera", "esg", "gestion", "distribuciones", "documentos")
MORNINGSTAR = ("morningstar_lt", "morningstar")


def _g(d: Any, ruta: str) -> Any:
    for k in ruta.split("."):
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _regla(ruta: str) -> tuple[str, tuple[str, float]] | None:
    """(grupo, tolerancia) de una ruta comparable, por el prefijo más largo."""
    for prefijo in sorted(TOLERANCIAS, key=len, reverse=True):
        if ruta == prefijo or ruta.startswith(prefijo + "."):
            return prefijo, TOLERANCIAS[prefijo]
    return None


def divisa_morningstar(etiqueta: str | None, divisa_clase: str | None) -> str | None:
    """Divisa en la que viene un dato de Morningstar según su endpoint."""
    endpoint = str(etiqueta or "").split(procedencia.SEPARADOR, 1)[-1]
    return divisa_clase if endpoint.startswith("sal_") else "EUR"


def _fecha_ref(grupo: str, ruta: str) -> str | None:
    if grupo == "rentabilidad.por_año_natural":
        return None          # el año va en la propia ruta
    return FECHA_DE.get(grupo)


# ---------------------------------------------------------------- contraste
def contraste_ficha(d: dict) -> list[dict]:
    """Filas del contraste de una ficha: una por ruta desplazada comparable."""
    isin = _g(d, "meta.isin") or _g(d, "identificacion.isin") or ""
    con = _g(d, "meta.contraste") or {}
    filas = []
    for ruta, ref in sorted(con.items()):
        if ruta in NO_COMPARABLES or not isinstance(ref, dict):
            continue
        regla = _regla(ruta)
        if not regla:
            continue
        grupo, (modo, tol) = regla
        ms, propio = _num(ref.get("valor")), _num(_g(d, ruta))
        fila = {"isin": isin, "ruta": ruta, "grupo": grupo, "morningstar": ms, "propio": propio,
                "fecha_morningstar": None, "fecha_propia": None, "diferencia": None,
                "tolerancia": tol, "unidad": "%" if modo == "rel_pct" else "pp",
                "estado": None}
        clase = _g(d, "valoracion.vl_divisa")
        propia = clase if grupo == "valoracion.vl" else (
            _g(d, "riesgo.historial_precios.divisa_metricas") or clase)
        fila["divisa_propia"] = propia
        fila["divisa_morningstar"] = divisa_morningstar(ref.get("fuente"), clase)
        campo_fecha = _fecha_ref(grupo, ruta)
        if campo_fecha:
            fila["fecha_morningstar"] = (con.get(campo_fecha) or {}).get("valor")
            fila["fecha_propia"] = _g(d, campo_fecha)
        if ms is None or propio is None:
            fila["estado"] = "sin_propio" if propio is None else "sin_morningstar"
        elif propia and fila["divisa_morningstar"] and propia != fila["divisa_morningstar"]:
            fila["estado"] = "divisa_distinta"
        elif campo_fecha and (not fila["fecha_morningstar"] or not fila["fecha_propia"]):
            # EXT-13 (auditoría del 16-11-2026): sin la fecha de una de las dos no se sabe si miden lo mismo.
            # Antes, con las dos ausentes, «None» era igual a «None» y la cifra se comparaba y salía «ok».
            fila["estado"] = "sin_fecha"
        elif campo_fecha and str(fila["fecha_morningstar"])[:10] != str(fila["fecha_propia"])[:10]:
            fila["estado"] = "fecha_distinta"
        else:
            if modo == "rel_pct":
                dif = (propio / ms - 1) * 100 if ms else None
            else:
                dif = propio - ms
            fila["diferencia"] = None if dif is None else round(dif, 4)
            fila["estado"] = "ok" if dif is not None and abs(dif) <= tol else "fuera"
        filas.append(fila)
    return filas


def resume_contraste(filas: Iterable[dict]) -> dict[str, dict]:
    """Por grupo: comparadas, dentro de tolerancia, mediana y máximo de |dif|."""
    por: dict[str, dict] = {}
    for f in filas:
        g = por.setdefault(f["grupo"], {"comparadas": 0, "ok": 0, "fuera": 0, "fecha_distinta": 0,
                                       "sin_fecha": 0, "divisa_distinta": 0, "sin_propio": 0,
                                       "sin_morningstar": 0, "_difs": []})
        g[f["estado"]] = g.get(f["estado"], 0) + 1
        if f["estado"] in ("ok", "fuera"):
            g["comparadas"] += 1
            g["_difs"].append(abs(f["diferencia"]))
    for g in por.values():
        difs = g.pop("_difs")
        g["pct_ok"] = round(100 * g["ok"] / g["comparadas"], 1) if g["comparadas"] else None
        g["mediana_abs"] = round(statistics.median(difs), 4) if difs else None
        g["max_abs"] = round(max(difs), 4) if difs else None
    return dict(sorted(por.items()))


# ---------------------------------------------------------------- cobertura
def dia_habil_anterior(d: dt.date) -> dt.date:
    """Día laborable (lunes a viernes) anterior a `d`. Sin calendario de festivos:
    un festivo nacional se ve como VL «de ayer» que falta."""
    d -= dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


def retraso_habiles(vl_fecha: dt.date, actualizado: dt.date) -> int:
    """Días hábiles que lleva el VL por detrás del día hábil anterior a la pasada
    (0 = VL de ese día). Una pasada nocturna ve casi siempre 1: la mayoría de
    las gestoras publica el VL de un día al final del siguiente."""
    objetivo, n, d = dia_habil_anterior(actualizado), 0, vl_fecha
    while d < objetivo:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def _fecha(v: Any) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def _es_morningstar(etiqueta: str) -> bool:
    e = etiqueta
    if e.startswith(procedencia.RETENIDO + ":"):
        e = e.split(":", 1)[1]
    return procedencia.fuente_de(e) in MORNINGSTAR


def cobertura_ficha(d: dict) -> dict:
    """Hojas por bloque (total y no Morningstar), frescura y fuente del VL."""
    proc: dict[str, str] = _g(d, "meta.procedencia") or {}
    bloques: dict[str, list[int]] = {}
    for ruta, etiqueta in proc.items():
        bloque = ruta.split(".", 1)[0]
        if bloque == "meta" or bloque == "calidad":
            continue
        tot = bloques.setdefault(bloque, [0, 0])
        tot[0] += 1
        if not _es_morningstar(str(etiqueta)):
            tot[1] += 1
    actualizado = _fecha(_g(d, "meta.actualizacion_parcial.fecha") or _g(d, "meta.actualizado"))
    vl_fecha = _fecha(_g(d, "valoracion.vl_fecha"))
    fresco = (actualizado is not None and vl_fecha is not None
              and vl_fecha >= dia_habil_anterior(actualizado))
    hp = _g(d, "riesgo.historial_precios") or {}
    return {
        "isin": _g(d, "meta.isin") or "",
        "nombre": _g(d, "identificacion.nombre") or "",
        "gestora": (_g(d, "identificacion.gestora_legal") or _g(d, "identificacion.gestora")
                    or "(sin gestora)"),
        "bloques": bloques,
        "vl_fuente": procedencia.fuente_de(str(proc.get("valoracion.vl") or "")) or "",
        "vl_fecha": vl_fecha.isoformat() if vl_fecha else None,
        "dias_vl": (actualizado - vl_fecha).days if actualizado and vl_fecha else None,
        "vl_fresco": fresco,
        "retraso_habiles": retraso_habiles(vl_fecha, actualizado) if actualizado and vl_fecha else None,
        "actualizado": actualizado.isoformat() if actualizado else None,
        "aviso_vl": hp.get("aviso_vl"),
        "parcial": bool(_g(d, "meta.actualizacion_parcial")),
        "metricas_propias": procedencia.fuente_de(str(proc.get("rentabilidad.fecha_dato") or ""))
        == "vl_eodhd",
        "aviso_metricas": hp.get("aviso_metricas") if hp.get("source_history") == "eodhd" else None,
    }


def resume_cobertura(fichas: list[dict]) -> dict:
    total = len(fichas)
    bloques: dict[str, list[int]] = {}
    gestoras: dict[str, dict] = {}
    for c in fichas:
        g = gestoras.setdefault(c["gestora"], {"fondos": 0, "hojas": 0, "propias": 0,
                                              "vl_fresco": 0, "metricas_propias": 0})
        g["fondos"] += 1
        g["vl_fresco"] += bool(c["vl_fresco"])
        g["metricas_propias"] += bool(c["metricas_propias"])
        for b, (t, p) in c["bloques"].items():
            acc = bloques.setdefault(b, [0, 0])
            acc[0] += t
            acc[1] += p
            g["hojas"] += t
            g["propias"] += p
    avisos: dict[str, int] = {}
    for c in fichas:
        if c["aviso_metricas"]:
            avisos[c["aviso_metricas"]] = avisos.get(c["aviso_metricas"], 0) + 1
    pct = (lambda a, b: round(100 * a / b, 1) if b else None)
    retrasos: dict[str, int] = {}
    for c in fichas:
        r = c["retraso_habiles"]
        k = "sin VL" if r is None else str(r) if r <= 3 else "4-20" if r <= 20 else "más de 20"
        retrasos[k] = retrasos.get(k, 0) + 1
    # Fichas que no se reescribieron en la última pasada (el guarda de
    # regresión de `core.update` las bloqueó, o el fondo no estaba en ella).
    ultima = max((c["actualizado"] for c in fichas if c["actualizado"]), default=None)
    sin_actualizar = [c["isin"] for c in fichas if ultima and c["actualizado"]
                      and (dt.date.fromisoformat(ultima) - dt.date.fromisoformat(c["actualizado"])).days > 1]
    return {
        "fondos": total,
        "vl_fresco": sum(1 for c in fichas if c["vl_fresco"]),
        "vl_al_dia": sum(1 for c in fichas if c["retraso_habiles"] is not None
                         and c["retraso_habiles"] <= 1),
        "retrasos": dict(sorted(retrasos.items(), key=lambda x: (len(x[0]), x[0]))),
        "series_paradas": sum(1 for c in fichas if c["aviso_vl"]),
        "sin_actualizar": sin_actualizar,
        "parciales": sum(1 for c in fichas if c.get("parcial")),
        "vl_eodhd": sum(1 for c in fichas if c["vl_fuente"] == "vl_eodhd"),
        "metricas_propias": sum(1 for c in fichas if c["metricas_propias"]),
        "avisos_metricas": dict(sorted(avisos.items(), key=lambda x: -x[1])),
        "bloques": {b: {"hojas": t, "no_morningstar": p, "pct": pct(p, t)}
                    for b, (t, p) in sorted(bloques.items(), key=lambda x: BLOQUES.index(x[0])
                                            if x[0] in BLOQUES else 99)},
        "gestoras": {k: {**v, "pct": pct(v["propias"], v["hojas"])}
                     for k, v in sorted(gestoras.items(), key=lambda x: -x[1]["fondos"])},
    }
