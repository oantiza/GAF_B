"""Pipeline de actualización de un activo: adquiere, guarda y protege.

Desde el 04-09 la recolección vive en `core.adquisicion.nucleo` (una sola vía
para CLI, interfaz web y cualquier otro cliente); aquí quedan la escritura
atómica, el snapshot histórico y la guarda de calidad que impide que una
pasada peor pise una ficha mejor.
"""
import json
import logging
from pathlib import Path

# `calidad`, `derivados`, `figi` y `limpieza` se exponen aquí a propósito: las
# pruebas del pipeline los parchean por este módulo.
from core import calidad, derivados, figi, limpieza  # noqa: F401
from core.adquisicion import nucleo, procedencia, registro
from core.adquisicion.adaptador import Adaptador, Contexto, Endpoint
from core.schema import cuenta_campos
from core.store import Store, _g

log = logging.getLogger("fondosdb")

# Ids de fuente aceptados en `prioridad_fuentes` / `--fuentes` (compatibilidad
# con app.py, que filtra la prioridad contra este mapa). Admite también la
# forma antigua, un callable `fn(isin, http, settings, force, base, tipo)`.
FUENTES = {a.id: a for a in registro.ADAPTADORES}


def _adaptadores_activos() -> list[Adaptador]:
    out = []
    for n, (id_, obj) in enumerate(FUENTES.items()):
        if isinstance(obj, Adaptador):
            out.append(obj)
            continue
        fn = obj

        def fetch(isin, ctx, fn=fn):
            return fn(isin, ctx.http, ctx.settings, ctx.force, ctx.base, ctx.tipo)
        out.append(Adaptador(id=id_, descripcion="fuente legada", oficial=False,
                             capacidades={}, endpoints=(Endpoint(id_, "identidad"),),
                             fetch=fetch, orden=100 + n))
    return out


def _tiene_metricas_accion(d: dict) -> bool:
    return all(_g(d, *ruta) is not None for ruta in (
        ("rentabilidad", "trailing_pct", "1a", "fondo"),
        ("rentabilidad", "trailing_pct", "3a_anualizada", "fondo"),
        ("rentabilidad", "trailing_pct", "5a_anualizada", "fondo"),
        ("riesgo", "volatilidad_pct", "3a", "fondo"),
        ("riesgo", "sharpe", "3a", "fondo"),
    ))


def _historial_status(d: dict) -> str:
    return (_g(d, "riesgo", "historial_precios", "history_quality_status")
            or ("COMPLETE" if _tiene_metricas_accion(d) else "PARTIAL"))


def _esenciales_presentes(d: dict) -> int:
    con = 0
    for block in ["riesgo", "rentabilidad", "cartera"]:
        if block in d and isinstance(d[block], dict):
            c, _ = cuenta_campos(d[block])
            con += c
    return con


def quality_regression_reason(previo: dict | None, nuevo: dict) -> str | None:
    if not previo:
        return None

    tipo_prev = (_g(previo, "identificacion", "tipo") or "").lower()
    tipo_new = (_g(nuevo, "identificacion", "tipo") or "").lower()
    # La serie ha llegado y dice que un hueco le cuesta esa ventana (decision 111): no se ha perdido nada
    # que se pudiera medir. Sin esto, la guarda conservaba la cifra que la regla acaba de quitar.
    por_hueco = bool(_g(nuevo, "riesgo", "historial_precios", "huecos"))

    if tipo_prev == "accion" and tipo_new == "accion" and not por_hueco:
        if _tiene_metricas_accion(previo) and not _tiene_metricas_accion(nuevo):
            return "QUALITY_REGRESSION_BLOCKED: metrics_lost"

    bucket_prev = _g(previo, "calidad", "bucket")
    bucket_new = _g(nuevo, "calidad", "bucket")
    if bucket_prev != "BLOQUEADO" and bucket_new == "BLOQUEADO":
        return "QUALITY_REGRESSION_BLOCKED: quality_bucket_regressed"

    if tipo_prev == "accion" and tipo_new == "accion" and not por_hueco:
        status_prev = _historial_status(previo)
        status_new = _historial_status(nuevo)
        if status_prev == "COMPLETE" and status_new != "COMPLETE":
            return "QUALITY_REGRESSION_BLOCKED: history_status_regressed"

    criticos = (
        ("identificacion", "nombre"),
        ("identificacion", "ticker"),
        ("identificacion", "mercado"),
        ("identificacion", "isin"),
        ("valoracion", "vl"),
    )
    for ruta in criticos:
        if _g(previo, *ruta) is not None and _g(nuevo, *ruta) is None:
            return "QUALITY_REGRESSION_BLOCKED: critical_field_lost:" + ".".join(ruta)

    esenciales_prev = _esenciales_presentes(previo)
    esenciales_new = _esenciales_presentes(nuevo)
    if esenciales_prev > 0 and esenciales_new < (esenciales_prev * 0.5):
        return f"QUALITY_REGRESSION_BLOCKED: esenciales cayeron {esenciales_new}/{esenciales_prev}"

    return None


def _rutas_serie(final: dict) -> dict[str, str]:
    """Patrones de las rutas que la serie de VL sirvió en `final`: las de cada
    regla de `registro.CONTRASTE` cuyo `si_trae` puso el adaptador que manda,
    más la traza del histórico. Vacío si la serie no sirvió nada."""
    proc = _g(final, "meta", "procedencia") or {}
    patrones: dict[str, str] = {}
    for regla in registro.CONTRASTE:
        if procedencia.fuente_de(proc.get(regla["si_trae"])) == regla["manda"]:
            patrones.update(dict.fromkeys(regla["rutas"], regla["manda"]))
    if patrones:
        patrones["riesgo.historial_precios.*"] = "historial"
        # Lo medido contra su indice sale de la misma serie, y se queda sin esto: tres fondos con
        # metricas propias y referencia aprobada no tenian alfa (04-11-2026).
        patrones["riesgo.relativas.*"] = "metricas"
        # Y la evidencia sobre la que se calculó, o la plataforma rechaza la cifra. La marca
        # de consultado no pasa sola si esta pasada trajo pagos: sin la lista diría que
        # el proveedor no tiene ninguno.
        if not _g(final, "distribuciones", "historial"):
            patrones["distribuciones.historial_consultado"] = "evidencia"
        patrones["documentos_oficiales.kid_politica"] = "evidencia"
        patrones["documentos_oficiales.kid_politica_cita"] = "evidencia"
    return patrones


def parche_serie(previo: dict | None, final: dict, motivo: str) -> dict | None:
    """La ficha anterior con el VL, las métricas de la serie y su contraste de
    `final`. None si no hay ficha anterior o la serie no sirvió nada.

    Se sustituye bloque por bloque, como en el contraste: lo que la ficha
    anterior tuviera en esas rutas sale entero (la rentabilidad a 10 años vieja
    no convive con la de 1 año nueva) y entra lo de `final` con su procedencia.
    `meta.actualizado` sigue siendo el de la ficha anterior, que es de cuando
    es el resto; la fecha de lo nuevo va en `meta.actualizacion_parcial`.
    (24 fichas llevaban desde el 05-09 o el 14-10 con el VL de julio porque
    Morningstar dejó de dar su cartera y la guarda descartaba la ficha entera.)"""
    import copy

    from core.adquisicion import capacidades
    from core.schema import _quita, set_path

    patrones = _rutas_serie(final)
    if not previo or not patrones:
        return None
    out = copy.deepcopy(previo)
    proc = out.setdefault("meta", {}).setdefault("procedencia", {})
    for ruta, _v in list(procedencia.hojas(out)):
        if not ruta.startswith(("meta.", "calidad.")) and capacidades.cubre(patrones, ruta):
            _quita(out, ruta.split("."))
            proc.pop(ruta, None)
    proc_final = _g(final, "meta", "procedencia") or {}
    n = 0
    with procedencia.activa("parche"):
        for ruta, valor in procedencia.hojas(final):
            if not ruta.startswith(("meta.", "calidad.")) and capacidades.cubre(patrones, ruta):
                set_path(out, ruta, valor)
                if ruta in proc_final:
                    proc[ruta] = proc_final[ruta]
                n += 1
    out["meta"]["procedencia"] = dict(sorted(proc.items()))
    if _g(final, "meta", "contraste"):
        out["meta"]["contraste"] = final["meta"]["contraste"]
    out["meta"]["actualizacion_parcial"] = {
        "fecha": _g(final, "meta", "actualizado"), "motivo": motivo, "hojas": n}
    calidad.aplica(out)
    return out


def _marca_decidida(final: dict) -> dict | None:
    """La marca de `final` si es una baja decidida (`core/bajas_decididas.py`), o `None`."""
    from core import bajas_decididas
    marca = ((final.get("meta") or {}).get("disponibilidad")) or None
    return marca if bajas_decididas.es_decidida(marca) else None


def ejecuta_pipeline(isin: str, tipo: str, fuentes_activas: list[str], http, settings,
                     force: bool, base, sin_historico: bool, print_cb=None,
                     familias: set[str] | None = None):
    if not print_cb:
        print_cb = print
    base = Path(base)
    ruta_existente = base / "data" / "funds" / f"{isin}.json"
    previo = None
    if ruta_existente.exists():
        try:
            previo = json.loads(ruta_existente.read_text(encoding="utf-8"))
        except Exception as e:
            log.warning("quality guard: no puedo leer %s: %s", ruta_existente.name, e)

    ctx = Contexto(http=http, settings=settings, base=base, force=force, tipo=tipo)
    resultado = nucleo.adquiere(isin, tipo, ctx, _adaptadores_activos(),
                                fuentes_activas=fuentes_activas, familias=familias,
                                print_cb=print_cb, anterior=previo)
    final = resultado.datos
    con, _ = cuenta_campos(final)

    # Sin ninguna fuente real (solo el tipo de fondos.csv y lo derivado de él) no hay ficha
    # nueva que escribir: un ISIN del que nadie sabe nada no debe generar canónico. Lo que
    # sí se escribe desde el 02-11-2026, si hay ficha anterior y la pasada supo decir por
    # qué no hay datos, es la marca de disponibilidad sobre ella (ver dentro).
    fuentes_reales = [f for f, _d in resultado.parciales if f != "config_csv"]
    if con <= 5 or not fuentes_reales:
        # Decisión 14 de Óscar (02-11-2026): un instrumento que deja de cotizar se marca,
        # no desaparece. Hasta hoy esta rama se iba sin escribir nada, así que una acción
        # que muriera se quedaba en la base con su último precio y sin decir en ningún
        # sitio que ya no cotiza: congelada y muda, que es peor que faltar.
        #
        # Lo que se escribe es la ficha ANTERIOR con la marca nueva, no una ficha vacía:
        # sus datos siguen siendo los últimos buenos que hubo, y perderlos no mejora nada.
        # Es la misma forma del parche de serie de unas líneas más abajo, que conserva la
        # ficha y actualiza solo una parte (decisión de Óscar del 29-10).
        marca = ((final.get("meta") or {}).get("disponibilidad")) or None
        if marca and previo:
            previo.setdefault("meta", {})["disponibilidad"] = marca
            Store(base).escribe_fondo(isin, previo)
            print_cb(f"   [x] ninguna fuente devolvio datos; marco la ficha anterior como "
                     f"'{marca['estado']}' y conservo sus datos")
            return {"ok": True, "reason": f"solo marca: {marca['estado']}", "campos": con}
        print_cb("   [x] ninguna fuente devolvio datos; no escribo JSON")
        return {"ok": False, "reason": "sin datos", "campos": con}

    store = Store(base)

    if not force:
        regresion = quality_regression_reason(previo, final)
        if regresion:
            final.setdefault("meta", {}).setdefault("errores", []).append(regresion)
            log.warning("%s %s", isin, regresion)
            parcheada = parche_serie(previo, final, regresion)
            # Una baja decidida no la para la guarda (decisión 7 del 07-11-2026): la guarda
            # protege los DATOS de la ficha anterior, y la decisión no toca ninguno.
            decidida = _marca_decidida(final)
            if parcheada is None:
                if decidida and previo:
                    previo.setdefault("meta", {})["disponibilidad"] = decidida
                    store.escribe_fondo(isin, previo)
                    print_cb(f"   [x] {regresion}; conservo la ficha y aplico la baja decidida")
                    return {"ok": True, "reason": f"solo marca decidida: {regresion}", "campos": con}
                print_cb(f"   [x] {regresion}; no sobrescribo JSON")
                return {"ok": False, "reason": regresion, "campos": con}
            if decidida:
                parcheada["meta"]["disponibilidad"] = decidida
            # La guarda protege la ficha anterior, pero el VL y las métricas de
            # la serie no dependen de lo que se perdió (cartera, ficha de
            # Morningstar): esos sí se actualizan (decisión de Óscar, 29-10).
            n = parcheada["meta"]["actualizacion_parcial"]["hojas"]
            ruta = store.escribe_fondo(isin, parcheada)
            if not sin_historico:
                store.snapshot(isin, parcheada)
            print_cb(f"   [x] {regresion}; conservo la ficha y actualizo solo VL y métricas ({n} hojas)")
            return {"ok": True, "reason": f"parcial: {regresion}", "campos": con}

    ruta = store.escribe_fondo(isin, final)
    if not sin_historico:
        store.snapshot(isin, final)

    print_cb(f"   -> {ruta.name}: {con} campos con dato")
    return {"ok": True, "reason": ruta.name, "campos": con}
