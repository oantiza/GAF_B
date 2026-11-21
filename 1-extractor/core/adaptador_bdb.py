"""Adaptador FondosDB -> esquema canónico de BDB-FONDOS.

Pieza INDEPENDIENTE: lee data/funds/ y escribe export_bdb/{ISIN}.json con la
misma estructura que los canónicos de BDB (data/canonical), verificada contra
un canónico real el 11-06-2026. NO toca la carpeta BDB-FONDOS ni Firestore:
los ficheros generados se llevan a BDB con su propio flujo cuando Oscar quiera.

Mejoras respecto al pipeline PDF de BDB:
- ms.fixed_income completo (duración, vencimientos, calidad, y extras: YTM,
  YTW, duración modificada, %IG/%HY, sectores de bono) — antes casi todo null.
- medalist y sostenibilidad rellenos.
- exposiciones v2 coherentes con ms.* (el parser PDF arrastraba descuadres).
- quality.source_system = "fondosdb_api" para distinguir el origen.

Los buckets de classification_v2 (credit/duration) se dejan null a propósito:
son enums del motor de BDB y no se inventan; el dato duro va en ms.fixed_income.

Desde el 04-09 el canónico lleva además `regulatory` (SRI del KID, costes del
KID y ex-ante MiFID, UCITS/SFDR, domicilio, gestora legal, fechas, registros
oficiales, informe periódico) y `provenance` (quién escribió cada campo y
cuándo). Ver `core.canonico_regulatorio`. El contrato admite propiedades
adicionales; `ms.*` no cambia de semántica.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

from . import canonico_regulatorio
from .adquisicion import alcance, retencion
from .contratos import ContratoInvalido, ContratoNoDisponible, valida
from .package_integrity import atomic_write_text, file_record, source_snapshot_id

log = logging.getLogger("fondosdb.adaptador_bdb")

VERSION = "fondosdb_adapter_1.1"

# Campos sin los cuales el paquete no sirve aguas abajo: el cargador de la
# plataforma no puede ni identificar ni nombrar el activo.
ESTRUCTURALES = (("isin", "isin_ausente"), ("name", "nombre_ausente"))


def _sella(canonico: dict, d: dict, warns: list) -> dict:
    """Adjunta quality/validation/routing calculados y devuelve el canonico.

    Aqui va tambien la marca de disponibilidad, que es el segundo eslabon de la decision
    14 (02-11-2026): viaja desde `meta.disponibilidad` de la ficha al canonico, con su
    vocabulario en castellano, y la base la traduce en `traducciones.ts`. Se sella en este
    punto porque es el unico por el que pasan los dos constructores de canonico, el de
    fondos y el de acciones.

    Ausente cuando la pasada no midio nada de la cotizacion -un fondo, por ejemplo-,
    porque un campo que falta no afirma nada y cualquiera de los cinco estados si.
    """
    disponibilidad = ((d.get("meta") or {}).get("disponibilidad")) or None
    if disponibilidad:
        canonico["disponibilidad"] = disponibilidad
    firds = identidad_firds(d)
    if firds:
        canonico["identidad_firds"] = firds
    # Si el KID confirma el índice que Morningstar atribuye (core/indice_kid.py, 07-11-2026).
    # Bloque nuevo y solo añadido: la plataforma no lo lee hasta que tenga contrato, y el
    # índice que sí lee, `classification_v2.official_benchmark`, sigue siendo el de siempre.
    contraste_kid = (d.get("identificacion") or {}).get("indice_benchmark_kid")
    if isinstance(contraste_kid, dict) and contraste_kid.get("estado"):
        canonico["indice_benchmark_kid"] = contraste_kid
    canonico["quality"], canonico["validation"] = _validacion(d, canonico, warns)
    errores = canonico["validation"]["errors"]
    canonico["routing"] = {
        "status": "ok" if canonico["validation"]["ok"] else "blocked",
        "reason": "; ".join(errores) or None,
    }
    return canonico


def identidad_firds(d: dict) -> dict | None:
    """Lo que FIRDS dice del instrumento, tal cual lo dejó en la ficha `fetchers.esma_firds`.

    Encargo «identidad» del 07-11-2026 (paso 3 de `DECISIONES_DATOS_2026-11-07.md`). La
    ficha lo tenía desde el paso 1 y no salía de ella: ningún canónico lo llevaba, así que
    la base no podía tenerlo. Va en su propio bloque y con su vocabulario, como la
    disponibilidad, y es la plataforma la que decide qué guarda y cómo lo llama.

    `cfi_tipo` viaja aunque se deduzca del CFI, para que la base pueda comparar sin repetir
    la regla; la plataforma no lo guarda. `visto` es el día del índice del que se leyó: sin
    él, una admisión o una baja no dice a qué fecha es verdad.

    **Solo lo que escribió FIRDS.** La ficha tiene una sola ruta `identificacion.cfi` y la
    escriben dos fuentes: FIRDS y la ficha de la CNMV, que da el CFI de 96 fondos españoles
    (medido el 07-11-2026). Aquí se mira la procedencia del campo y el CFI entra solo si es
    de FIRDS; el de la CNMV es bueno, pero va con su fuente o no va, y no bajo el nombre de
    otra.

    Ausente si FIRDS no dejó nada: no se pasó por FIRDS, o FIRDS no conoce el ISIN.

    **Una identidad retenida viaja, y dice que lo es** (decisión A-170, 16-11-2026). Si el ISIN ha
    salido del índice, la ficha conserva la última identidad hasta su plazo (`retencion.retiene_firds`):
    el bloque es el mismo, `visto` sigue siendo el día del índice en que era verdad, y `retenida_desde`
    lo repite para que quien lo lea sepa que no es de esta pasada.
    """
    from core.adquisicion import retencion

    ident = d.get("identificacion") or {}
    meta = d.get("meta") or {}
    if not meta.get("firds_visto"):
        return None
    procedencia = meta.get("procedencia") or {}
    # La fuente del CFI, también si la hoja viene retenida (`retenido:esma_firds:fulins@fecha`).
    de_firds = retencion._fuente_original(str(procedencia.get("identificacion.cfi") or "")) == retencion.FUENTE_FIRDS
    mercados = [
        {k: m[k] for k in ("mic", "admision", "primera_negociacion", "baja") if m.get(k)}
        for m in (ident.get("mercados_ue") or []) if isinstance(m, dict) and m.get("mic")
    ]
    bloque = {
        "cfi": ident.get("cfi") if de_firds else None,
        "cfi_tipo": ident.get("cfi_tipo") if de_firds else None,
        "lei_emisor": ident.get("lei_emisor"),
        "autoridad_competente": ident.get("autoridad_competente_firds"),
        "mercados": mercados,
        "baja_en_todos": ident.get("baja_en_todos_firds"),
        "visto": meta.get("firds_visto"),
        "retenida_desde": retencion.firds_retenida_desde(d),
    }
    return {k: v for k, v in bloque.items() if v not in (None, "", [])}


def _validacion(d: dict, canonico: dict, warns: list) -> tuple[dict, dict]:
    """Bloques `quality` y `validation` calculados, no dados por buenos.

    Hasta el 04-09 los dos se escribian con `"ok": True` y `"errors": []`
    literales: nada los calculaba, y la plataforma los persistia en la maestra
    como `fondosdb_ok`. Un semaforo verde por construccion invita a confiar y no
    mide nada (auditoria 03-09, hallazgo 05).

    El material ya existia: `core.calidad` calcula flags y bucket de verdad. De
    ahi salen los errores; las flags `info_*` no cuentan, son informativas.
    """
    calidad = _g(d, "calidad") or {}
    bucket = calidad.get("bucket")
    flags = list(calidad.get("flags") or [])
    alertas = [f for f in flags if not f.startswith("info_")]

    errores: list[str] = []
    for campo, codigo in ESTRUCTURALES:
        if not canonico.get(campo):
            errores.append(codigo)
    if bucket == "BLOQUEADO":
        errores.append(f"calidad_bloqueada(esenciales={calidad.get('esenciales')})")

    ok = not errores
    quality = {
        # Marcas de tiempo en UTC con desfase, como `_resumen.generado` y
        # `meta.actualizado`; antes, hora local sin zona (auditoría 16-10, MEDIA-13).
        "parsed_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "parser_version": VERSION,
        "source_pdf_hash": None,
        "source_system": "fondosdb_api",
        "warnings": list(warns),
        "ok": ok,
    }
    # Los avisos del adaptador mas las flags de calidad, sin repetir: en acciones
    # `warns` YA son las flags, en fondos son dos listas distintas.
    avisos = list(warns)
    avisos += [f for f in flags if f not in avisos]
    validation = {
        "ok": ok,
        "errors": errores,
        "warnings": avisos,
        "diagnostics": {
            "calidad_fondosdb": bucket,
            "calidad_score": calidad.get("score"),
            "calidad_esenciales": calidad.get("esenciales"),
            "calidad_alertas": len(alertas),
        },
    }
    return quality, validation

#: Cuantas posiciones lleva el top del canonico. 25 es el tope que el contrato de
#: `instrument-declared-holdings.v2` declara desde el primer dia: «las 25 primeras por peso.
#: El tope es 25 y no 500: este bloque no es la lista, es el resumen». Guardabamos 10.
POSICIONES_DEL_TOP = 25

#: De que clase es una linea de la cartera, con el vocabulario del contrato. La tabla es
#: exhaustiva y SIN valor por defecto para lo que no conoce: una linea de clase
#: desconocida se queda sin `asset_type` en vez de caer en OTHER, porque OTHER es una
#: afirmacion -ahi viven los derivados y la liquidez- y no un cajon de lo que no sabemos.
TIPO_POSICION_ES2EN = {"rv": "EQUITY", "rf": "FIXED_INCOME",
                       "liquidez": "CASH", "otro": "OTHER"}
SECT_ES2EN = {
    "tecnologia": "technology", "servicios_financieros": "financial_services",
    "industria": "industrials", "salud": "healthcare",
    "consumo_ciclico": "consumer_cyclical",
    "consumo_defensivo": "consumer_defensive",
    "comunicacion": "communication_services", "inmobiliario": "real_estate",
    "materiales_basicos": "basic_materials", "energia": "energy",
    "utilities": "utilities",
}
# región nuestra -> (clave detail BDB, macro BDB)
#
# Cada zona con su nombre (decisión 7 de Óscar, 04-11-2026). Hasta el 05-11-2026 Canadá y África
# iban a `other`, Japón, Australasia y Asia desarrollada a `asia`, y `asia` se sobreescribía con
# el total de Asia, que contaba además la Asia emergente, que seguía aparte: más de la mitad de
# los repartos no sumaban. Lo que no es una de estas zonas no entra en el reparto.
REG_ES2BDB = {
    "estados_unidos": ("united_states", "americas"),
    "canada": ("canada", "americas"),
    "latinoamerica": ("latin_america", "americas"),
    "reino_unido": ("united_kingdom", "europe_me_africa"),
    "eurozona": ("eurozone", "europe_me_africa"),
    "europa_ex_euro": ("europe_ex_euro", "europe_me_africa"),
    "europa_emergente": ("europe_emerging", "europe_me_africa"),
    "oriente_medio": ("middle_east", "europe_me_africa"),
    "africa": ("africa", "europe_me_africa"),
    "japon": ("japan", "asia"),
    "australasia": ("australasia", "asia"),
    "asia_desarrollada": ("asia_developed", "asia"),
    "asia_emergente": ("asia_emerging", "asia"),
}
#: Las nueve celdas de la caja de estilo y tamaño: de cómo las llama la ficha a cómo viajan hasta la
#: aplicación, con las palabras de `equity_styles` y `market_caps`.
CELDAS_DE_ESTILO = {
    "LV": "large_value", "LB": "large_blend", "LG": "large_growth",
    "MV": "mid_value", "MB": "mid_blend", "MG": "mid_growth",
    "SV": "small_value", "SB": "small_blend", "SG": "small_growth",
}
CLASE2BDB = {  # clase_activo Morningstar -> (derived.asset_class, v2.asset_type)
    "equity": ("RV", "equity"), "fixed income": ("RF", "fixed_income"),
    "allocation": ("Mixto", "mixed"), "money market": ("Monetario", "money_market"),
    "alternative": ("Alternativos", "alternatives"),
    "commodities": ("Alternativos", "alternatives"),
    "convertibles": ("RF", "fixed_income"), "property": ("RV", "equity"),
    "miscellaneous": ("Otros", "other"),
}


def _g(d, *ruta):
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _num(v):
    return v if isinstance(v, (int, float)) else None


def _frac(v):  # 0-100 -> 0-1 con 6 decimales
    return round(v / 100.0, 6) if isinstance(v, (int, float)) else None


def _caja_de_estilo(celdas: dict) -> dict | None:
    """Las nueve celdas de la caja, en fracción y tal como las da el proveedor (decisión 51, 05-11-2026).

    Hasta aquí se quedaban en la ficha, y lo único que salía eran sus dos sumas, por columnas y por
    filas. La aplicación multiplicaba esas sumas como si estilo y tamaño fueran independientes.

    Las nueve o ninguna: con ocho, lo que falta parecería un cero. Y una celda negativa se queda
    como está: es lo neto de cortos del fondo, las nueve siguen sumando 100, y quitarla descuadraría
    las demás. De 609 fichas con celdas, 22 traen alguna, de −0,003 a −926 puntos.
    """
    valores = {destino: _num(celdas.get(origen)) for origen, destino in CELDAS_DE_ESTILO.items()}
    if any(valor is None for valor in valores.values()):
        return None
    return {clave: _frac(valor) for clave, valor in valores.items()}


def mifid_ongoing(d: dict, warnings: list[str]) -> float | int | None:
    """Costes corrientes ex-ante: el EMT de Morningstar y, si falta, la cifra
    «gestión y otros costes» del KID oficial (misma definición PRIIPs)."""
    emt = _g(d, "costes", "mifid_emt_exante", "corrientes_pct")
    if isinstance(emt, (int, float)):
        return emt
    kid = _g(d, "costes", "kid", "gestion_y_otros_pct")
    if isinstance(kid, (int, float)):
        warnings.append("mifid_ongoing_from_kid")
        return kid
    return None


def management_fee(d: dict, warnings: list[str]) -> float | int | None:
    """Devuelve solo una comisión de gestión declarada; nunca imputa el TER."""
    applied = _g(d, "costes", "comision_gestion_aplicada_pct")
    maximum = _g(d, "costes", "comision_gestion_max_pct")
    if isinstance(applied, (int, float)):
        return applied
    if isinstance(maximum, (int, float)):
        warnings.append("management_fee_uses_declared_maximum")
        return maximum
    if isinstance(_g(d, "costes", "ter_pct"), (int, float)):
        warnings.append("management_fee_unavailable_not_imputed_from_ter")
    return None


class ExportacionAbortada(ContratoNoDisponible):
    """`exporta_bdb` no escribe nada: la caché de contratos no se puede verificar."""


def verifica_contratos() -> int:
    """Comprueba la caché de contratos antes de escribir nada en `export_bdb/`.

    Falla cerrado (decisión de Óscar, 17-10, 6.7a). Hasta aquí, si la caché no
    cuadraba con su manifiesto, se avisaba en el registro y se seguía sin validar
    el canónico (`contrato_verificado: false`, que nadie leía). Desde CRIT-08 el
    fin de línea ya no cuenta, así que lo que quede es una caché alterada,
    desfasada o ausente: se aborta con un error que se entiende en la CLI, en
    `app.py` y en la tarea de Sistema › Operaciones."""
    from .contratos import verifica_cache

    try:
        return verifica_cache()
    except (ContratoNoDisponible, ValueError, OSError) as e:   # dañada o ilegible: también cerrado (MEN-1)
        raise ExportacionAbortada(
            f"Exportación a BDB abortada: la caché de contratos no se puede verificar ({e}). "
            "No se ha escrito nada en export_bdb/. Si los contratos cambiaron en la plataforma, "
            "ejecuta `python tools/sync_contratos.py`; si no, revisa contracts_cache/ "
            "(`git status contracts_cache`).") from e


def genera(base: Path, destino: Path | None = None) -> dict:
    funds_dir = base / "data" / "funds"
    destino = Path(destino) if destino else base / "export_bdb"
    verifica_contratos()                     # antes de tocar export_bdb/
    destino.mkdir(parents=True, exist_ok=True)
    package_id = source_snapshot_id(funds_dir)
    ok = errores = bloqueados = incumplen_contrato = 0
    resumen = []
    package_files = {}
    # El alcance decide a quien se le piden DATOS, y hasta el 02-11-2026 eso era todo:
    # el canonico salia de quien tuviera ficha, asi que un instrumento excluido seguia
    # viajando a la base desde su ficha vieja. Medido ese dia: el escritor de la base no
    # borra nada a proposito, asi que sin este filtro una exclusion no llega nunca al
    # destino y hay que borrar a mano documentos que la siguiente pasada recrea.
    al = alcance.carga(base)
    excluidos = []
    for ruta in sorted(funds_dir.glob("*.json")):
        try:
            d = json.loads(ruta.read_text(encoding="utf-8"))
            tipo = ((d.get("identificacion") or {}).get("tipo") or "").strip().lower()
            if al.estado(ruta.stem, tipo) != alcance.DENTRO:
                # Y se retira el canonico que quedo de cuando si estaba, que si no el
                # cargador lo seguiria viendo. Solo su fichero, nombrado, nunca un patron.
                viejo = destino / f"{ruta.stem}.json"
                if viejo.exists():
                    viejo.unlink()
                excluidos.append({"isin": ruta.stem, "tipo": tipo,
                                  "motivo": al.motivo(ruta.stem, tipo)})
                log.info("adaptador: %s fuera del alcance, no se exporta", ruta.stem)
                continue
            canonico = convierte(d)
            # El productor comprueba la forma que promete, en vez de descubrirlo
            # tres saltos aguas abajo con el paquete ya entregado (hallazgo 07).
            # La caché de contratos está versionada en este repositorio, así que
            # no hace falta la plataforma delante; y si no cuadra, no se llega
            # aquí (verifica_contratos, 6.7a).
            valida(canonico)
            output_path = destino / f"{canonico['isin']}.json"
            atomic_write_text(output_path, json.dumps(canonico, ensure_ascii=False, indent=1))
            package_files[output_path.name] = file_record(output_path)
            ok += 1
            resumen.append({"isin": canonico["isin"],
                            "asset_class": canonico["derived"]["asset_class"],
                            "ok": canonico["validation"]["ok"],
                            "errors": list(canonico["validation"]["errors"]),
                            "warnings": len(canonico["validation"]["warnings"])})
            if not canonico["validation"]["ok"]:
                bloqueados += 1
        except ContratoInvalido as e:
            # Rompe la forma que promete el canonico: no se escribe. Es un fallo
            # del productor y tiene que verse aqui, no en el cargador.
            errores += 1
            incumplen_contrato += 1
            log.error("adaptador: %s incumple el contrato: %s", ruta.stem, e)
        except Exception as e:
            errores += 1
            log.warning("adaptador: %s falla: %s", ruta.stem, e)
    atomic_write_text(destino / "_resumen.json", json.dumps(
        {"generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
         "version": VERSION, "package_schema_version": 2,
         "package_id": package_id, "ok": ok, "errores": errores,
         "bloqueados": bloqueados, "incumplen_contrato": incumplen_contrato,
         "contrato_verificado": True,
         "fuera_de_alcance": excluidos,
         "files": package_files, "fondos": resumen},
        ensure_ascii=False, indent=1))
    log.info("adaptador BDB: %d generados, %d errores (%d por contrato), "
             "%d bloqueados, %d fuera de alcance -> %s", ok, errores,
             incumplen_contrato, bloqueados, len(excluidos), destino)
    return {"ok": ok, "errores": errores, "package_id": package_id,
            "fuera_de_alcance": [e["isin"] for e in excluidos],
            "carpeta": str(destino)}


# ---------------------------------------------------------------- conversión
def convierte(d: dict) -> dict:
    if (_g(d, "identificacion", "tipo") or "").lower() == "accion":
        return convierte_accion(d)

    isin = _g(d, "meta", "isin")
    # `dato_retenido` y `registro_no_encontrado` salen del paso de retención
    # (meta.retencion); la procedencia `retenido:` de cada hoja ya viaja en
    # provenance.fields.
    warns: list[str] = retencion.avisos(d)

    fecha_cartera = _g(d, "cartera", "fecha")
    report_date = (_g(d, "rentabilidad", "fecha_dato")
                   or (_g(d, "meta", "actualizado") or "")[:10] or None)

    # ----------------------------------------------------------------- ms.*
    sectores = {}
    for k, v in (_g(d, "cartera", "sectores_pct") or {}).items():
        en = SECT_ES2EN.get(k)
        val = _num(v.get("fondo")) if isinstance(v, dict) else _num(v)
        if en and val is not None:
            sectores[en] = val

    detail: dict[str, float] = {}
    macro = {"americas": 0.0, "europe_me_africa": 0.0, "asia": 0.0}
    for k, v in (_g(d, "cartera", "regiones_pct") or {}).items():
        val = _num(v)
        zona = REG_ES2BDB.get(k)
        if val is None or zona is None:
            continue
        destino_k, macro_k = zona
        detail[destino_k] = round(detail.get(destino_k, 0) + val, 4)
        macro[macro_k] = round(macro[macro_k] + val, 4)

    aloc = _g(d, "cartera", "asignacion_activos") or {}

    def neto(clase):
        v = aloc.get(clase)
        return _num(v.get("neto")) if isinstance(v, dict) else None

    asset_allocation = {
        "equity": neto("rv") or 0,
        "bond": neto("rf") or 0,
        "cash": neto("liquidez") or 0,
        "other": round(sum(x for x in (neto("otros"), neto("convertibles"),
                                       neto("preferentes")) if x), 4),
    }
    if not any(asset_allocation.values()):
        warns.append("asset_allocation_unavailable")

    celdas = _g(d, "cartera", "style_box_rv", "celdas_pct") or {}

    def suma(*ks):
        vals = [_num(celdas.get(k)) for k in ks]
        return round(sum(v for v in vals if v is not None), 4) \
            if any(v is not None for v in vals) else 0

    cap = _g(d, "cartera", "capitalizacion_pct") or {}
    rf = _g(d, "cartera", "renta_fija") or {}
    cal = rf.get("calidad_crediticia_pct") or {}
    ven = rf.get("vencimientos_pct") or {}
    over10 = [_num(ven.get(k)) for k in ("10_15", "15_20", "20_30", "mas_30")]
    rf_sect = rf.get("sectores_pct") or {}

    posiciones = _g(d, "cartera", "posiciones") or []
    ordenadas = sorted([p for p in posiciones if isinstance(p, dict)],
                       key=lambda x: -(x.get("peso_pct") or 0))

    def _linea(p: dict) -> dict:
        linea = {"name": p.get("nombre"),
                 "weight": _num(p.get("peso_pct")),
                 "sector": SECT_ES2EN.get(p.get("sector"), p.get("sector"))}
        # El código fino del proveedor: lo único que separa una acción de un derivado
        # (decisión 9 de Óscar, 04-11-2026). Sin él, la línea no lo lleva: una línea de justETF
        # no tiene clase, y eso no es OTHER.
        if p.get("codigo_tipo"):
            linea["holding_type_code"] = p["codigo_tipo"]
        return linea

    top10 = [_linea(p) for p in ordenadas[:10]]
    # El top de 25, que es el que el contrato de la base nueva admite desde el primer dia y
    # que nadie llenaba: guardabamos 10. Medido el 02-11-2026 sobre las 760 fichas con diez
    # posiciones o mas, la mediana de cartera explicada pasa del 40,9 % al 61,4 %, y los
    # fondos explicados al 90 % de 53 a 129.
    #
    # Va en una clave NUEVA y no en `holdings_top10` por una razon tonta y suficiente: un
    # campo que se llama top10 y trae 25 miente, y lo consumen dos mapeadores.
    top25 = [_linea(p) for p in ordenadas[:POSICIONES_DEL_TOP]]
    # Y la cartera COMPLETA, que la plataforma trocea en `holdings_chunks`. Ya se
    # adquiria y se quedaba en el disco del extractor: 156.665 posiciones en 766 fondos
    # medidas el 02-11-2026, con la mayor cartera en 10.000 lineas de las 16.974 que
    # declara el fondo. Lleva `asset_type` porque es lo que permite sumar la cartera por
    # clase sin confundir un derivado con una accion.
    completa = []
    for p in ordenadas:
        linea = _linea(p)
        clase = TIPO_POSICION_ES2EN.get(p.get("tipo"))
        if clase is not None:
            linea["asset_type"] = clase
        isin_linea = p.get("isin")
        if isin_linea:
            linea["isin"] = isin_linea
        completa.append(linea)
    # Que fraccion de la cartera cubren esas 25. El contrato lo pide con una frase que
    # explica por que: «sin esto, una lista parcial parece completa».
    peso_del_top = sum(l["weight"] for l in top25 if isinstance(l.get("weight"), (int, float)))
    # Va en PORCENTAJE, como `peso_top10_pct` y como los pesos de las propias lineas,
    # porque el canonico habla en porcentaje y quien lo lee convierte. Primero se
    # escribio en fraccion, la plataforma volvio a dividir entre cien y la cobertura
    # entraba en la base como 0,006 en vez de 0,61. Las dos mitades eran defendibles
    # por separado; lo que faltaba era que la unidad fuera la misma a los dos lados.
    suma_del_top = round(peso_del_top, 4) if top25 else None

    ms = {
        "report_date": report_date,
        "category_morningstar": _g(d, "identificacion", "categoria_morningstar"),
        "rating_stars": _g(d, "rating", "estrellas", "overall"),
        "medalist_rating": _g(d, "rating", "medalist", "rating"),
        "sustainability_rating": _g(d, "esg", "globos_sostenibilidad"),
        "portfolio": {"as_of": fecha_cartera,
                      "asset_allocation": asset_allocation},
        "sectors": sectores,
        "regions": {"macro": {k: round(v, 2) for k, v in macro.items()},
                    "detail": detail},
        "equity_style": {
            "market_cap": {k_en: _num(cap.get(k_es)) or 0
                           for k_es, k_en in (("gigante", "giant"),
                                              ("grande", "large"),
                                              ("mediana", "mid"),
                                              ("pequeña", "small"),
                                              ("micro", "micro"))},
            "style": {"value": suma("LV", "MV", "SV"),
                      "blend": suma("LB", "MB", "SB"),
                      "growth": suma("LG", "MG", "SG")},
        },
        "fixed_income": {
            "effective_duration": _num(rf.get("duracion_efectiva")),
            "effective_maturity": _num(rf.get("vencimiento_efectivo")),
            "avg_credit_quality": rf.get("calidad_media"),
            "credit_quality": {
                "aaa": _num(cal.get("AAA")) or 0, "aa": _num(cal.get("AA")) or 0,
                "a": _num(cal.get("A")) or 0, "bbb": _num(cal.get("BBB")) or 0,
                "bb": _num(cal.get("BB")) or 0, "b": _num(cal.get("B")) or 0,
                "below_b": _num(cal.get("inferior_B")) or 0,
                "not_rated": _num(cal.get("sin_rating")) or 0,
            },
            "maturity_allocation": {
                "1_3": _num(ven.get("1_3")) or 0,
                "3_5": _num(ven.get("3_5")) or 0,
                "5_7": _num(ven.get("5_7")) or 0,
                "7_10": _num(ven.get("7_10")) or 0,
                "over_10": round(sum(v for v in over10 if v), 4),
            },
            "coupon_allocation": None,
            # extras que el parser PDF nunca tuvo (claves nuevas, no rompen):
            "modified_duration": _num(rf.get("duracion_modificada")),
            "yield_to_maturity": _num(rf.get("ytm_pct")),
            "yield_to_worst": _num(rf.get("ytw_pct")),
            "ytw_distribution": rf.get("ytw_distribucion_pct"),
            "investment_grade_pct": _num(rf.get("pct_investment_grade")),
            "high_yield_pct": _num(rf.get("pct_high_yield")),
            "bond_sectors": {
                "government": _num(rf_sect.get("gobierno")),
                "corporate": _num(rf_sect.get("corporativa")),
                "securitized": _num(rf_sect.get("titulizada")),
                "cash": _num(rf_sect.get("liquidez")),
            },
        },
        "holdings_top10": top10,
        # El top de 25 y cuanto cubre. Lo lee la base nueva; `holdings_top10` se queda
        # para los dos mapeadores que ya lo consumen.
        "holdings_top": top25,
        "holdings_all": completa,
        "holdings_top_weight_sum": suma_del_top,
        "holdings_stats": {
            "holdings_count_equity": _g(d, "cartera", "num_posiciones_rv"),
            "holdings_count_bond": _g(d, "cartera", "num_posiciones_rf"),
            "top10_weight": _g(d, "cartera", "peso_top10_pct"),
        },
        "costs": {
            "management_fee": management_fee(d, warns),
            "ter": _g(d, "costes", "ter_pct"),
            "mifid_ongoing": mifid_ongoing(d, warns),
        },
        "objective": _g(d, "identificacion", "estrategia_inversion_texto"),
    }
    if not any(v for v in ms["fixed_income"]["credit_quality"].values()):
        if asset_allocation["bond"] and asset_allocation["bond"] > 20:
            warns.append("credit_missing")
    if ms["fixed_income"]["effective_duration"] is None \
            and asset_allocation["bond"] and asset_allocation["bond"] > 20:
        warns.append("duration_missing")
    warns.append("coupon_allocation_unavailable")

    # ------------------------------------------------------------- derived
    clase_ms = (_g(d, "identificacion", "clase_activo") or "").lower()
    categoria = (_g(d, "identificacion", "categoria_morningstar") or "")
    asset_class, asset_type = CLASE2BDB.get(clase_ms, (None, None))
    if asset_class is None:
        cl = categoria.lower()
        if "monetario" in cl or "money" in cl:
            asset_class, asset_type = "Monetario", "money_market"
        elif any(p in cl for p in ("mixto", "allocation", "patrimoine",
                                   "flexible", "multiactivo")):
            asset_class, asset_type = "Mixto", "mixed"
        elif any(p in cl for p in ("rf ", "renta fija", "deuda", "bond",
                                   "crédit", "credit", "yield")):
            asset_class, asset_type = "RF", "fixed_income"
        elif "rv" in cl or "equity" in cl or "acciones" in cl:
            asset_class, asset_type = "RV", "equity"
        else:
            asset_class, asset_type = "Otros", "other"
            warns.append("asset_class_inferred_weak")

    top_sector = max(sectores.items(), key=lambda x: x[1]) if sectores else None
    region_primaria, region_confidence, region_reason = _region_primaria(
        categoria, detail
    )
    if region_reason:
        warns.append(region_reason)
    replica = (_g(d, "identificacion", "replicacion") or "").lower()
    nombre = _g(d, "identificacion", "nombre") or ""
    es_indexado = bool(replica) or "index" in nombre.lower() \
        or "indexa" in nombre.lower() or "equiponderado" in nombre.lower()

    derived = {
        "asset_class": asset_class,
        "asset_subtype": None,
        "primary_region": region_primaria,
        "subcategories": [],
        "top_sector": top_sector[0] if top_sector else None,
        "top_sector_weight": top_sector[1] if top_sector else None,
        "is_sector_fund": bool(top_sector and top_sector[1] >= 45),
        "is_thematic": False,
        "is_index_like": es_indexado,
        "confidence": 0.9,
        "ruleset_version": VERSION,
        "reasons": ["fondosdb:morningstar_api"],
        "portfolio_exposure": {
            "asset_allocation_total": asset_allocation,
            "equity_sectors_total": sectores,
            "equity_regions_total": detail,
        },
        "style_bias": {"equity": {
            "weight_total": asset_allocation["equity"],
            "size_bucket": _size_bucket(cap),
            "style": _style_dominante(ms["equity_style"]["style"]),
            "size_weights_total": {"small": suma("SV", "SB", "SG"),
                                   "mid": suma("MV", "MB", "MG"),
                                   "large": suma("LV", "LB", "LG")},
            "style_weights_total": ms["equity_style"]["style"]
            if any(ms["equity_style"]["style"].values()) else None,
        }},
    }

    # ----------------------------------------------------- classification_v2
    fuentes = sorted({f for v in (_g(d, "meta", "fuentes") or {}).values()
                      for f in (v or [])})
    sintetico = bool(_g(d, "identificacion", "sintetico"))
    classification_v2 = {
        "version": "v2",
        "asset_type": asset_type,
        "asset_subtype": None,
        "commercial_type": categoria or None,
        "region_primary": region_primaria,
        "region_secondary": None,
        "market_cap_bias": _size_bucket(cap),
        "fixed_income_type": _fi_type(categoria, asset_type),
        "credit_bucket": None,
        "duration_bucket": None,
        "strategy_tags": [],
        # El índice contra el que se mide el fondo. Estaba en la ficha del
        # extractor (99,7 % de los fondos) y no llegaba al canónico, así que la
        # maestra guardaba el alpha, la volatilidad y el Sharpe DEL índice sin
        # guardar qué índice era: cifras que pueden acabar en un informe de
        # cliente sin poder nombrar su referencia (medido el 30-10-2026).
        # "N/A" y similares se descartan: ausencia es null, no una cadena.
        "official_benchmark": _benchmark(d),
        "vehicle_complexity": ("synthetic" if sintetico
                               else "index" if es_indexado else "standard"),
        "classification_confidence": 0.9,
        "region_primary_confidence": region_confidence,
        "sources_used": [f"fondosdb:{f}" for f in fuentes],
        "warnings": list(warns),
    }

    # --------------------------------------------------- portfolio_exposure_v2
    exposure_v2 = {
        "version": "v2",
        "asset_mix": {k: _frac(v) for k, v in asset_allocation.items()},
        "equity_regions": {k: _frac(v) for k, v in detail.items()} or None,
        "sectors": {k: _frac(v) for k, v in sectores.items()} or None,
        "equity_styles": ({k: _frac(v) for k, v in
                           ms["equity_style"]["style"].items()}
                          if any(ms["equity_style"]["style"].values()) else None),
        "market_caps": ({"small": _frac(suma("SV", "SB", "SG")),
                         "mid": _frac(suma("MV", "MB", "MG")),
                         "large": _frac(suma("LV", "LB", "LG"))}
                        if celdas else None),
        "equity_style_box": _caja_de_estilo(celdas),
        "bond_types": ({k: _frac(v) for k, v in
                        ms["fixed_income"]["bond_sectors"].items()
                        if v is not None} or None),
        "credit": ({k: _frac(v) for k, v in
                    ms["fixed_income"]["credit_quality"].items()}
                   if any(ms["fixed_income"]["credit_quality"].values()) else None),
        "duration": ({k: _frac(v) for k, v in
                      ms["fixed_income"]["maturity_allocation"].items()}
                     if any(ms["fixed_income"]["maturity_allocation"].values())
                     else None),
        "alternatives": None,
        "exposure_confidence": 0.9,
        "warnings": [],
    }
    if sintetico:
        exposure_v2["warnings"].append("synthetic_instrumental_basket")

    ticker = _g(d, "identificacion", "ticker")
    exchange = _g(d, "identificacion", "mercado")
    eodhd_code = _g(d, "identificacion", "simbolo_eodhd")
    if not eodhd_code and ticker and exchange:
        eodhd_code = f"{ticker}.{exchange}"
    canonico = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "isin": isin,
        "name": nombre or None,
        "currency": _g(d, "identificacion", "divisa_base"),
        "fileName": None,
        "stableBaseName": f"{isin}__fondosdb",
        "report_date": report_date,
        "identifiers": {
            "ticker": ticker,
            "exchange": exchange,
            "eodhd_code": eodhd_code,
            "source_listing_id": _g(d, "identificacion", "source_listing_id"),
        },
        "ms": ms,
        "derived": derived,
        "classification_v2": classification_v2,
        "portfolio_exposure_v2": exposure_v2,
        "regulatory": canonico_regulatorio.bloque_regulatorio(d),
    }
    canonico["provenance"] = canonico_regulatorio.bloque_procedencia(d, canonico)
    return _sella(canonico, d, warns)


def convierte_accion(d: dict) -> dict:
    isin = _g(d, "meta", "isin") or _g(d, "identificacion", "isin")
    nombre = _g(d, "identificacion", "nombre") or isin
    pais = _g(d, "identificacion", "pais")
    sector = _g(d, "identificacion", "sector")
    industria = _g(d, "identificacion", "industria")
    report_date = (_g(d, "rentabilidad", "fecha_dato")
                   or _g(d, "valoracion", "vl_fecha")
                   or (_g(d, "meta", "actualizado") or "")[:10] or None)
    fuentes = sorted({f for v in (_g(d, "meta", "fuentes") or {}).values()
                      for f in (v or [])})
    # Con las flags de calidad, el aviso de lo retenido (como en los fondos).
    warns = list(_g(d, "calidad", "flags") or []) + retencion.avisos(d)
    region = _region_accion(pais)
    sector_key = _sector_accion(sector)

    asset_mix = {"equity": 100, "bond": 0, "cash": 0, "other": 0}
    sectors = {sector_key: 100} if sector_key else {}
    regions = {region: 100} if region else {}
    history_trace = _history_trace_accion(d)

    ms = {
        "report_date": report_date,
        "category_morningstar": None,
        "rating_stars": None,
        "medalist_rating": None,
        "sustainability_rating": None,
        "portfolio": {"as_of": report_date, "asset_allocation": asset_mix},
        "sectors": sectors,
        "regions": {"macro": {}, "detail": regions},
        "equity_style": {
            "market_cap": {"giant": 0, "large": 0, "mid": 0, "small": 0, "micro": 0},
            "style": {"value": 0, "blend": 0, "growth": 0},
        },
        "fixed_income": {
            "effective_duration": None,
            "effective_maturity": None,
            "avg_credit_quality": None,
            "credit_quality": {},
            "maturity_allocation": {},
            "coupon_allocation": {},
        },
        "holdings_top10": [],
        "holdings_stats": {"holdings_count_equity": None, "holdings_count_bond": None,
                           "top10_weight": None},
        "costs": {"management_fee": None, "ter": None, "mifid_ongoing": None},
        "objective": _g(d, "identificacion", "descripcion"),
        "stock": {
            "ticker": _g(d, "identificacion", "ticker"),
            "exchange": _g(d, "identificacion", "mercado"),
            "country": pais,
            "sector": sector,
            "industry": industria,
            "fundamentals": d.get("fundamentales"),
            "valuation": d.get("valoracion"),
            "history_trace": history_trace,
        },
    }

    derived = {
        "asset_class": "EQUITY",
        "asset_subtype": "common_stock",
        "primary_region": region,
        "subcategories": [],
        "top_sector": sector_key,
        "top_sector_weight": 100 if sector_key else None,
        "is_sector_fund": False,
        "is_thematic": False,
        "is_index_like": False,
        "confidence": 0.95,
        "ruleset_version": VERSION,
        "reasons": ["fondosdb:eodhd"],
        "portfolio_exposure": {
            "asset_allocation_total": asset_mix,
            "equity_sectors_total": sectors,
            "equity_regions_total": regions,
        },
        "style_bias": {"equity": {
            "weight_total": 100,
            "size_bucket": None,
            "style": None,
            "size_weights_total": None,
            "style_weights_total": None,
        }},
    }

    classification_v2 = {
        "version": "v2",
        "asset_type": "stock",
        "asset_subtype": "common_stock",
        "commercial_type": "accion",
        "region_primary": region,
        "region_secondary": None,
        "market_cap_bias": None,
        "fixed_income_type": None,
        "credit_bucket": None,
        "duration_bucket": None,
        "strategy_tags": [],
        "vehicle_complexity": "standard",
        "classification_confidence": 0.95,
        "sources_used": [f"fondosdb:{f}" for f in fuentes] or ["fondosdb:eodhd"],
        "warnings": list(warns),
    }

    exposure_v2 = {
        "version": "v2",
        "asset_mix": {k: _frac(v) for k, v in asset_mix.items()},
        "equity_regions": {k: _frac(v) for k, v in regions.items()} or None,
        "sectors": {k: _frac(v) for k, v in sectors.items()} or None,
        "equity_styles": None,
        "market_caps": None,
        "bond_types": None,
        "credit": None,
        "duration": None,
        "alternatives": None,
        "exposure_confidence": 0.95,
        "warnings": [],
    }

    canonico = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "isin": isin,
        "name": nombre or None,
        "currency": _g(d, "identificacion", "divisa_base"),
        "fileName": None,
        "stableBaseName": f"{isin}__fondosdb",
        "report_date": report_date,
        "ms": ms,
        "derived": derived,
        "classification_v2": classification_v2,
        "portfolio_exposure_v2": exposure_v2,
    }
    canonico["provenance"] = canonico_regulatorio.bloque_procedencia(
        d, canonico, canonico_regulatorio.MAPA_ACCION)
    return _sella(canonico, d, warns)


def _region_primaria(categoria: str, detail: dict) -> tuple[str | None, str, str | None]:
    c = (categoria or "").lower()
    for patron, region in (("global", "Global"), ("internacional", "Global"),
                           ("mundial", "Global"), ("europa", "Europe"),
                           ("europe", "Europe"), ("eurozona", "Eurozone"),
                           ("españa", "Iberia"), ("iberia", "Iberia"),
                           ("usa", "USA"), ("ee.uu", "USA"),
                           ("norteam", "USA"), ("japón", "Japan"),
                           ("japan", "Japan"), ("emergente", "Emerging"),
                           ("asia", "Asia"), ("latino", "LatAm")):
        if patron in c:
            return region, "HIGH", None
    if detail.get("united_states", 0) > 55:
        return "USA", "HIGH", None
    if (detail.get("eurozone", 0) + detail.get("europe_ex_euro", 0)
            + detail.get("united_kingdom", 0)) > 55:
        return "Europe", "HIGH", None
    if detail:
        return _region_por_mayor_exposicion(detail), "INFERRED", \
            "region_primary_inferred_from_equity_regions"
    cat_region = _region_por_categoria(categoria)
    if cat_region:
        return cat_region, "INFERRED", "region_primary_inferred_from_category"
    return None, "MISSING", None


#: Las zonas de Asia y el Pacífico. Para la región principal cuentan como una: es el total que
#: `detail.asia` traía hasta el 05-11-2026, y el que se compara con Estados Unidos o con Europa.
ZONAS_DE_ASIA = ("japan", "australasia", "asia_developed", "asia_emerging")


def _region_por_mayor_exposicion(detail: dict) -> str:
    candidatas = {k: v for k, v in detail.items()
                  if isinstance(v, (int, float)) and k not in ZONAS_DE_ASIA}
    asia = sum(detail[k] for k in ZONAS_DE_ASIA
               if isinstance(detail.get(k), (int, float)))
    if asia:
        candidatas["asia"] = asia
    orden = sorted(candidatas.items(), key=lambda x: x[1], reverse=True)
    if not orden:
        return "Global"
    top = orden[0][0]
    return {
        "united_states": "USA",
        "latin_america": "LatAm",
        "united_kingdom": "Europe",
        "eurozone": "Eurozone",
        "europe_ex_euro": "Europe",
        "europe_emerging": "Emerging",
        "middle_east": "Emerging",
        "africa": "Emerging",
        "asia": "Asia",
    }.get(top, "Global")


def _region_por_categoria(categoria: str) -> str | None:
    c = (categoria or "").lower()
    if not c:
        return None
    reglas = (
        (("eur ", " euro ", "euro ", "europa", "europe", "eurozone", "euroland",
          "zona euro", "covered bond"), "Europe"),
        (("usa", "us ", "u.s.", "america", "norteam"), "USA"),
        (("global", "internacional", "mundial", "world", "aggregate"), "Global"),
        (("emerging", "emergente", "frontier"), "Emerging"),
        (("asia", "pacific", "apac"), "Asia"),
        (("japan", "japón"), "Japan"),
        (("latin", "latino", "brazil"), "LatAm"),
        (("commodit", "materias primas", "precious metals", "metales preciosos"), "Global"),
        (("money market", "monetario"), "Europe"),
        (("dkk bond", "euro bond"), "Europe"),
        (("bond", "renta fija", "deuda"), "Global"),
    )
    padded = f" {c} "
    for patrones, region in reglas:
        if any(p in padded for p in patrones):
            return region
    # Muchas categorías RF europeas empiezan por "EAA Fund EUR ... Bond".
    if " eaa fund eur " in padded or " eur " in padded and "bond" in padded:
        return "Europe"
    return None


# Lo que las fuentes escriben cuando no hay índice. No son nombres de índice y
# no deben viajar al canónico: un "N/A" en la maestra es peor que un hueco,
# porque parece un dato.
_SIN_INDICE = {"", "-", "--", "n/a", "na", "n.a.", "n.d.", "nd", "none", "null",
               "sin indice", "sin índice", "no disponible", "not available",
               # Morningstar no escribe "N/A" cuando un fondo no se compara con
               # ningún índice: escribe "Not Benchmarked". Sin esta entrada, los
               # 90 fondos que lo traen llegaban a la maestra con el centinela en
               # el campo del índice, y la ficha imprimía «Benchmark oficial ·
               # Not Benchmarked». Medido el 31-10-2026.
               "not benchmarked", "not benchmark",
               "no benchmark", "no benchmarked", "no index"}


def _benchmark(d: dict) -> str | None:
    """El índice oficial del fondo, o None si la fuente no lo dice."""
    v = _g(d, "identificacion", "indice_benchmark_oficial")
    if not isinstance(v, str):
        return None
    v = v.strip()
    return v or None if v.lower() not in _SIN_INDICE else None


def _size_bucket(cap: dict) -> str | None:
    g = (cap.get("gigante") or 0) + (cap.get("grande") or 0)
    m = cap.get("mediana") or 0
    s = (cap.get("pequeña") or 0) + (cap.get("micro") or 0)
    if not (g or m or s):
        return None
    if g >= 50:
        return "large"
    if s >= 40:
        return "small"
    if m >= 40:
        return "mid"
    return "multi"


def _style_dominante(style: dict) -> str | None:
    if not any(style.values()):
        return None
    return max(style.items(), key=lambda x: x[1])[0]


def _fi_type(categoria: str, asset_type: str) -> str:
    if asset_type != "fixed_income":
        return "flexible"
    c = (categoria or "").lower()
    if "high yield" in c:
        return "high_yield"
    if any(p in c for p in ("corporativa", "corporate", "crédit", "credit")):
        return "corporate"
    if any(p in c for p in ("deuda pública", "gobierno", "government", "soberan")):
        return "government"
    if any(p in c for p in ("corto", "short", "ultra")):
        return "short_term"
    return "flexible"


def _region_accion(pais: str | None) -> str | None:
    p = (pais or "").strip().lower()
    if not p:
        return None
    if p in ("usa", "united states", "united states of america"):
        return "USA"
    if p in ("spain", "españa", "portugal"):
        return "Iberia"
    if p in ("germany", "france", "netherlands", "italy", "belgium",
             "austria", "finland", "ireland", "sweden", "denmark"):
        return "Europe"
    if p in ("united kingdom", "uk", "switzerland", "norway"):
        return "Europe"
    if p in ("japan",):
        return "Japan"
    return "Global"


def _history_trace_accion(d: dict) -> dict:
    hp = _g(d, "riesgo", "historial_precios") or {}
    ticker = _g(d, "identificacion", "ticker")
    exchange = _g(d, "identificacion", "mercado")
    eodhd_symbol = _g(d, "identificacion", "simbolo_eodhd")
    yahoo_symbol = _g(d, "identificacion", "simbolo_yahoo")
    source_history = hp.get("source_history")
    source_listing_id = hp.get("source_listing_id") or _g(d, "identificacion", "source_listing_id")
    warnings: list[str] = []

    if not source_history:
        if yahoo_symbol and not eodhd_symbol:
            source_history = "yahoo"
            warnings.append("history_source_inferred_from_yahoo_symbol")
        elif eodhd_symbol:
            source_history = "eodhd"
            warnings.append("history_source_inferred_from_eodhd_symbol")

    if not source_listing_id:
        if source_history == "yahoo" and yahoo_symbol:
            source_listing_id = f"YAHOO:{yahoo_symbol}"
        elif eodhd_symbol:
            source_listing_id = f"EODHD:{eodhd_symbol}"
        elif ticker and exchange:
            source_listing_id = f"EODHD:{ticker}.{exchange}"
            warnings.append("source_listing_id_inferred_from_ticker_exchange")

    first_date = hp.get("first_date") or hp.get("fecha_inicio")
    last_date = hp.get("last_date") or hp.get("fecha_fin") or _g(d, "riesgo", "fecha_dato")
    observations_count = hp.get("observations_count") or hp.get("observaciones")
    status = hp.get("history_quality_status")
    if not status:
        has_metrics = (
            _g(d, "rentabilidad", "trailing_pct", "1a", "fondo") is not None
            and _g(d, "rentabilidad", "trailing_pct", "3a_anualizada", "fondo") is not None
            and _g(d, "rentabilidad", "trailing_pct", "5a_anualizada", "fondo") is not None
            and _g(d, "riesgo", "volatilidad_pct", "3a", "fondo") is not None
            and _g(d, "riesgo", "sharpe", "3a", "fondo") is not None
        )
        status = "COMPLETE" if has_metrics and observations_count else "PARTIAL"
        if has_metrics and not observations_count:
            warnings.append("history_coverage_metadata_missing")

    return {
        "source_history": source_history,
        "source_listing_id": source_listing_id,
        "first_date": first_date,
        "last_date": last_date,
        "observations_count": observations_count,
        "history_quality_status": status,
        "warnings": warnings,
    }


def _sector_accion(sector: str | None) -> str | None:
    s = (sector or "").strip().lower()
    if not s:
        return None
    if "technology" in s:
        return "technology"
    if "financial" in s:
        return "financial_services"
    if "industrial" in s:
        return "industrials"
    if "health" in s:
        return "healthcare"
    if "consumer cyclical" in s:
        return "consumer_cyclical"
    if "consumer defensive" in s:
        return "consumer_defensive"
    if "communication" in s:
        return "communication_services"
    if "real estate" in s:
        return "real_estate"
    if "basic material" in s:
        return "basic_materials"
    if "energy" in s:
        return "energy"
    if "utilit" in s:
        return "utilities"
    return s.replace(" ", "_")
