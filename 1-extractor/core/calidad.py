"""Bloque `calidad` por fondo: score, bucket y flags de coherencia.

Se aplica tras limpieza y derivados. No corrige datos: solo marca.
Flags inspirados en el informe externo de normalización (11-06-2026),
adaptados al esquema propio.
"""
from __future__ import annotations

import datetime as dt
import functools
import json
from pathlib import Path

PAT_RF = ("rf ", "renta fija", "deuda", "bond", "crédit", "credit",
          "high yield", "monetario", "money", "fixed", "yield",
          "corporate", "convertible")
PAT_MIXTO = ("mixto", "allocation", "patrimoine", "multiactivo", "flexible")
ESENCIALES = (
    ("identificacion", "nombre"), ("identificacion", "categoria_morningstar"),
    ("costes", "ter_pct"), ("valoracion", "vl"),
    ("valoracion", "patrimonio_fondo_meur"),
    ("rentabilidad", "trailing_pct", "1a", "fondo"),
    ("rentabilidad", "trailing_pct", "3a_anualizada", "fondo"),
    ("riesgo", "volatilidad_pct", "3a", "fondo"),
    ("riesgo", "sri_kid_1a7"), ("cartera", "fecha"),
)
# Acciones: la mitad de los esenciales de un fondo no existen en una acción
# (categoría Morningstar, TER, patrimonio, SRI del KID, fecha de cartera), así
# que con la lista de fondos ninguna pasaba de 5/10 y una recién cotizada se
# quedaba en 2/10, BLOQUEADO (TSK, que cotiza desde el 13-05-2026; 17-10).
ESENCIALES_ACCION = (
    ("identificacion", "nombre"), ("identificacion", "ticker"),
    ("identificacion", "mercado"), ("identificacion", "sector"),
    ("valoracion", "vl"), ("valoracion", "vl_fecha"),
    ("riesgo", "historial_precios", "source_listing_id"),
    ("fundamentales", "market_cap"),
)
# Métricas de la serie: solo se exigen si la historia cubre la ventana. Una
# acción con menos historia no puede tenerlas; que le falten no es mala calidad.
ESENCIALES_ACCION_VENTANA = (
    (1, ("rentabilidad", "trailing_pct", "1a", "fondo")),
    (3, ("rentabilidad", "trailing_pct", "3a_anualizada", "fondo")),
    (3, ("riesgo", "volatilidad_pct", "3a", "fondo")),
)


# La tolerancia de la suma del reparto, en puntos porcentuales: la de la
# plataforma (`TOLERANCIA_DEL_REPARTO = 0.01` en
# `2-plataforma-datos/src/config/baseNueva/vocabulario.ts`, en fracción). No
# está en ningún contrato, así que aquí va escrita, y
# `tests/test_calidad_reparto.py` falla si las dos se separan.
TOLERANCIA_DEL_REPARTO_PCT = 1.0

# El contrato que dice qué peso admite cada clase del reparto. Se lee de la
# plataforma, que es quien lo hace cumplir, y no se copia aquí: dos rangos
# son dos verdades. Mismo repositorio desde el 10-11-2026.
CONTRATO_DE_EXPOSICION = (Path(__file__).resolve().parents[2] / "2-plataforma-datos"
                          / "contracts" / "base-nueva"
                          / "instrument-declared-exposure.v2.schema.json")

# Las clases del extractor en las cuatro del canónico, como las agrega
# `adaptador_bdb.convierte` en `portfolio_exposure_v2.asset_mix`: lo que mira
# la plataforma es la clase agregada, no cada una del proveedor.
CLASES_DE_LA_PLATAFORMA = (
    ("rv", ("rv",)),
    ("rf", ("rf",)),
    ("liquidez", ("liquidez",)),
    ("otros", ("otros", "convertibles", "preferentes")),
)


@functools.lru_cache(maxsize=1)
def rango_de_clase_pct() -> tuple[float, float]:
    """Los topes de una clase, en por ciento, del contrato.

    Es `$defs.peso_de_clase` de `instrument-declared-exposure.v2`: desde la
    decisión C-29 (21-11-2026), de -5 a 6 en fracción, que aquí son -500 y
    600. Hasta ese día era -1 a 101 (decisión A-63).
    """
    try:
        esquema = json.loads(CONTRATO_DE_EXPOSICION.read_bytes().decode("utf-8"))
        peso = esquema["$defs"]["peso_de_clase"]
        return float(peso["minimum"]) * 100, float(peso["maximum"]) * 100
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise RuntimeError(
            f"no se puede leer el rango de clase del contrato de la plataforma "
            f"({CONTRATO_DE_EXPOSICION}): {type(e).__name__}: {e}") from e


def pesos_de_la_plataforma(aloc: dict) -> list[tuple[str, float]]:
    """El peso neto de cada clase agregada, en por ciento, como lo verá la
    plataforma. Las clases sin dato no salen."""
    pesos: list[tuple[str, float]] = []
    for clase, del_proveedor in CLASES_DE_LA_PLATAFORMA:
        netos = [v.get("neto") for k, v in aloc.items()
                 if k in del_proveedor and isinstance(v, dict)
                 and isinstance(v.get("neto"), (int, float))]
        if netos:
            pesos.append((clase, round(sum(netos), 4)))
    return pesos


def clases_fuera_de_rango(aloc: dict) -> list[tuple[str, float]]:
    """Las clases agregadas por las que la base nueva no escribirá el reparto.

    Desde la decisión C-29 (21-11-2026) la plataforma acepta el reparto NETO
    del proveedor si suma 100: una clase negativa (un corto, liquidez
    prestada) o por encima de 100 (apalancamiento) no es un error. Lo que se
    avisa es lo que se quedará sin reparto por una clase:

    - una clase fuera de los topes del contrato (-500 a 600), sume lo que
      sume: ya no es un reparto neto sino un error de unidades;
    - una clase fuera de 0-100, más allá de la tolerancia, cuando el reparto
      NO suma 100: no es un reparto neto, porque no cuadra.
    """
    minimo, maximo = rango_de_clase_pct()
    pesos = pesos_de_la_plataforma(aloc)
    suma_cuadra = abs(sum(p for _, p in pesos) - 100) <= TOLERANCIA_DEL_REPARTO_PCT
    fuera: list[tuple[str, float]] = []
    for clase, peso in pesos:
        if not minimo <= peso <= maximo:
            fuera.append((clase, peso))
        elif not suma_cuadra and not (-TOLERANCIA_DEL_REPARTO_PCT <= peso
                                      <= 100 + TOLERANCIA_DEL_REPARTO_PCT):
            fuera.append((clase, peso))
    return fuera


def _g(d, *ruta):
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def aplica(d: dict) -> None:
    flags: list[str] = []
    cat = (_g(d, "identificacion", "categoria_morningstar") or "").lower()
    es_rf = any(p in cat for p in PAT_RF)
    es_mixto = any(p in cat for p in PAT_MIXTO)

    # --- sintéticos: la cesta instrumental no es exposición económica
    replica = (_g(d, "identificacion", "replicacion") or "").lower()
    if any(p in replica for p in ("synthetic", "swap", "trs", "sintet")):
        d.setdefault("identificacion", {})["sintetico"] = True
        flags.append("sintetico_cartera_instrumental")

    # --- asset allocation: la suma neta debe rondar 100
    # Morningstar a veces solo informa algunas clases: exigimos >=3 clases
    # con dato. La banda es la de la plataforma, 100 ± 1 (21-11-2026): con la
    # de antes, 88-112, pasaban aquí repartos que la base nueva no acepta.
    # Medido ese día: el cambio no marca hoy a ningún fondo (el mayor desvío
    # es de 0,17 puntos).
    aloc = _g(d, "cartera", "asignacion_activos") or {}
    netos = [v.get("neto") for v in aloc.values()
             if isinstance(v, dict) and isinstance(v.get("neto"), (int, float))]
    if len(netos) >= 3:
        suma = sum(netos)
        if abs(suma - 100) > TOLERANCIA_DEL_REPARTO_PCT:
            flags.append(f"asignacion_activos_sospechosa({suma:.0f})")

    # --- una clase por la que la plataforma no escribirá el reparto.
    # Desde la decisión C-29 (21-11-2026) un reparto neto que suma 100 no se
    # avisa: ES0116848005 trae renta variable -101 % y liquidez +124 %, suma
    # 100 y la base nueva lo escribe tal cual. Se avisa la clase fuera de los
    # topes del contrato y la que se sale de 0-100 en un reparto que no suma.
    # Es informativa: no saca al fondo de la selección de calidad.
    fuera = clases_fuera_de_rango(aloc)
    if fuera:
        detalle = ",".join(f"{clase}={valor:g}" for clase, valor in fuera)
        flags.append(f"info_clase_fuera_de_rango({detalle})")

    # --- patrimonio fuera de escala (unidades mezcladas)
    # umbral 1e6 MEUR = 1 billón EUR: imposible, delata EUR sin escalar
    pat = _g(d, "valoracion", "patrimonio_fondo_meur")
    if isinstance(pat, (int, float)) and pat > 1e6:
        flags.append("patrimonio_sospechoso")

    # --- renta fija incompleta
    if es_rf or es_mixto:
        rf = _g(d, "cartera", "renta_fija") or {}
        if rf.get("duracion_efectiva") is None and rf.get("duracion_modificada") is None:
            flags.append("rf_sin_duracion")
        if rf.get("ytm_pct") is None:
            flags.append("rf_sin_yield")
        if not rf.get("calidad_crediticia_pct"):
            flags.append("rf_sin_calidad_crediticia")

    # --- posiciones: ISIN ausente, pesos negativos
    posiciones = _g(d, "cartera", "posiciones") or []
    if isinstance(posiciones, list) and posiciones:
        sin_id = sum(1 for p in posiciones
                     if isinstance(p, dict) and not p.get("isin")
                     and not p.get("figi"))
        if sin_id / len(posiciones) > 0.4:
            flags.append("posiciones_sin_identificador_alto")
        if any(isinstance(p, dict) and isinstance(p.get("peso_pct"), (int, float))
               and p["peso_pct"] < 0 for p in posiciones):
            # informativa: normal en fondos con derivados/divisa cubierta
            flags.append("info_pesos_negativos")

    # --- países no normalizados que sobrevivieron a la limpieza
    paises = _g(d, "cartera", "paises_pct") or {}
    raros = [k for k in paises
             if not (len(k) == 3 and k.isupper()) and k not in ("OTROS", "LIQUIDEZ")]
    if raros:
        flags.append("paises_no_iso3")

    # --- cartera vieja
    fecha_cartera = _g(d, "cartera", "fecha")
    actualizado = (_g(d, "meta", "actualizado") or "")[:10]
    if fecha_cartera and actualizado and fecha_cartera < f"{int(actualizado[:4])-2}":
        flags.append("cartera_antigua")

    # --- valor liquidativo viejo (auditoría 28-10, H02): hasta ahora nada
    # miraba su antigüedad, y 821 de 847 fichas llevaban un VL de más de un mes
    # con la calidad en ALTO. Se compara con la fecha de la pasada.
    dias = _dias_vl(d)
    if dias is not None and dias > DIAS_VL_ANTIGUO:
        flags.append(f"vl_antiguo({dias}d)")

    # --- score y bucket (las flags info_* no penalizan como las de alerta)
    esenciales = _esenciales(d, flags)
    alertas = [f for f in flags if not f.startswith("info_")]
    presentes = sum(1 for ruta in esenciales if _g(d, *ruta) is not None)
    score = round(100 * presentes / len(esenciales)
                  - 5 * len(alertas) - 1 * (len(flags) - len(alertas)))
    score = max(0, min(100, score))
    if presentes <= 3:
        bucket = "BLOQUEADO"
    elif score < 50 or len(alertas) >= 4:
        bucket = "BAJO"
    elif score < 80:
        bucket = "MEDIO"
    else:
        bucket = "ALTO"

    d["calidad"] = {"score": score, "bucket": bucket,
                    "esenciales": f"{presentes}/{len(esenciales)}",
                    "flags": flags}


def kid_en_uso_sin_fecha(d: dict) -> dict | None:
    """El KID que la ficha usa pero del que no consta la fecha de elaboración (C-30, 21-11-2026).

    «En uso» es que la ficha lleve el documento (`kid_url` o `kid_sha256`): de ahí salen su
    SRI y sus costes. Sin `kid_fecha` el extractor no puede aplicar la caducidad de
    `KID_MAX_DIAS` y acepta el documento sin mirar de cuándo es. Si una gestora cambia la
    maquetación de su PDF, `RE_FECHA_DOC` deja de leerla y esto es lo que lo caza. Es un
    aviso, no un bloqueo, y no entra en las flags ni en el score. Devuelve None si no
    aplica (no hay KID, o la fecha consta).
    """
    docs = _g(d, "documentos_oficiales") or {}
    if not (docs.get("kid_url") or docs.get("kid_sha256")) or docs.get("kid_fecha"):
        return None
    return {"fuente": docs.get("kid_fuente") or "cnmv/amf", "url": docs.get("kid_url")}


DIAS_VL_ANTIGUO = 7   # días naturales: cubre fines de semana y festivos de un VL diario


def _dias_vl(d: dict) -> int | None:
    """Días entre el VL y la pasada (`meta.actualizado`, o la de la última
    actualización parcial si la hay), o None si falta alguno."""
    try:
        vl = dt.date.fromisoformat(str(_g(d, "valoracion", "vl_fecha") or "")[:10])
        pasada = dt.date.fromisoformat(str(_g(d, "meta", "actualizacion_parcial", "fecha")
                                           or _g(d, "meta", "actualizado") or "")[:10])
    except ValueError:
        return None
    return (pasada - vl).days


def _anos_de_historia(d: dict) -> float | None:
    """Años que cubre la serie de precios (traza del histórico), o None si no consta."""
    hp = _g(d, "riesgo", "historial_precios") or {}
    try:
        inicio = dt.date.fromisoformat(str(hp.get("first_date") or hp.get("fecha_inicio"))[:10])
        fin = dt.date.fromisoformat(str(hp.get("last_date") or hp.get("fecha_fin"))[:10])
    except ValueError:
        return None
    return (fin - inicio).days / 365.25


def _esenciales(d: dict, flags: list[str]) -> tuple[tuple[str, ...], ...]:
    """Los de un fondo o, en una acción, los suyos más las métricas que su
    historia permite (con `info_historia_corta` si alguna no aplica)."""
    if str(_g(d, "identificacion", "tipo") or "").lower() != "accion":
        return ESENCIALES
    anos = _anos_de_historia(d)
    # Sin traza del histórico no se sabe cuánto cubre: se exigen todas.
    aplicables = tuple(ruta for minimo, ruta in ESENCIALES_ACCION_VENTANA
                       if anos is None or anos >= minimo)
    if len(aplicables) < len(ESENCIALES_ACCION_VENTANA):
        flags.append("info_historia_corta")
    return ESENCIALES_ACCION + aplicables
