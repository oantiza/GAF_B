"""Exportación universal de la base: lista para poblar cualquier BD.

`python main.py export` genera la carpeta export/ con:

  fondos.ndjson      un fondo por línea, documento LIGERO (sin posiciones ni
                     series largas; cartera resumida a top-10). Pensado para
                     que cada documento quepa de sobra en el límite de 1 MiB
                     de Firestore y cargue rápido en cualquier motor.
  posiciones.ndjson  una línea por fondo (o por parte si es muy grande) con
                     la cartera completa: {"isin", "parte", "total_partes",
                     "posiciones": [...]}.
  series.ndjson      series temporales por fondo (CNMV diaria, etc.).
  fondos_plano.csv   ficha plana (~60 columnas escalares) para SQL/Excel/BI. Cada cifra de
                     rentabilidad y de riesgo lleva al lado quién la calculó, a qué fecha y,
                     la caída máxima, sobre qué ventana: no son comparables de una fila a otra
                     sin mirarlo (ver `_fila_plana`).
  manifest.json      marcador de paquete: snapshot, conteos, SHA-256 por
                     fichero y hash de línea por fondo.
  README_EXPORT.md   cómo cargar en Firestore (estructura sugerida) y otros.

NDJSON = JSON Lines: el formato de carga masiva más universal (Firestore via
script, BigQuery, MongoDB, Postgres jsonb, DuckDB...).
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import logging
from pathlib import Path

from . import cartera_emisor, negociacion
from .adquisicion import alcance, procedencia
from .package_integrity import atomic_write_text, file_record, source_snapshot_id

log = logging.getLogger("fondosdb.exporta")

MAX_POSICIONES_POR_LINEA = 2000  # trocea carteras gigantes (límites de doc)


def _g(d, *ruta):
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


# Endpoints cuya cartera es, por construcción, solo las principales posiciones.
_ENDPOINTS_TOP_N = {"ETFsnapshot", "MFsnapshot"}
_FECHA_DE = {"sal_position": "detalle_posiciones", "ETFsnapshot": "snapshot",
             "MFsnapshot": "snapshot"}


#: Lo que la ficha guarda y el canónico no publica. El documento de `fondos.ndjson` es una copia de
#: la ficha entera, así que lo que no deba viajar se quita aquí con nombre, junto a su procedencia.
#: `costes.mifid_ex_post`: los costes MiFID reales del último periodo (`…Actual` de Morningstar), que
#: se guardan desde la decisión 60 (09-11-2026) y no se publican hasta que haya decisión de enseñarlos.
NO_PUBLICADO = ("costes.mifid_ex_post",)


def _quita_no_publicado(doc: dict) -> None:
    """Quita de la copia del canónico las rutas de `NO_PUBLICADO` y sus entradas de `meta.procedencia`."""
    for ruta in NO_PUBLICADO:
        *padres, hoja = ruta.split(".")
        contenedor = _g(doc, *padres) if padres else doc
        if isinstance(contenedor, dict):
            contenedor.pop(hoja, None)
        proc = _g(doc, "meta", "procedencia")
        if isinstance(proc, dict):
            for clave in [k for k in proc if k == ruta or k.startswith(ruta + ".")]:
                del proc[clave]


def cobertura_sal_position(raw: dict) -> tuple[str, int | None, bool | None]:
    """(cobertura, posiciones declaradas, supresión) de una respuesta `portfolio/holding/v2`.

    Misma regla que la pasada de calidad del 28-09 (`analyze_provider.py`):
    completa si cada página trae todas las filas que declara
    (`numberOfAllHolding`) y el total coincide con `holdingSummary.numberOfHolding`.
    Si no, top_n con 10 filas o menos (Morningstar suprime el resto) y parcial
    en otro caso."""
    paginas = [raw.get("equityHoldingPage") or {},
               raw.get("bondHoldingPage") or raw.get("boldHoldingPage") or {},
               raw.get("otherHoldingPage") or {}]
    listadas = sum(len(p.get("holdingList") or []) for p in paginas)
    declaradas = _g(raw, "holdingSummary", "numberOfHolding")
    try:
        declaradas = int(declaradas) if declaradas is not None else None
    except (TypeError, ValueError):
        declaradas = None
    supresion_raw = raw.get("portfolioSuppression")
    supresion = None if supresion_raw is None else str(supresion_raw) in ("1", "True", "true")
    conocidas = all(p.get("numberOfAllHolding") is not None or not p.get("holdingList")
                    for p in paginas)
    completa = conocidas and all(
        len(p.get("holdingList") or []) == int(p.get("numberOfAllHolding") or 0)
        for p in paginas)
    completa = completa and (declaradas is None or declaradas == listadas)
    if listadas == 0:
        return "desconocida", declaradas, supresion
    if completa:
        return "completa", declaradas, supresion
    return ("top_n" if listadas <= 10 else "parcial"), declaradas, supresion


def procedencia_cartera(base: Path, isin: str, d: dict, n_posiciones: int) -> dict | None:
    """De dónde sale la cartera de un fondo, para cada línea de posiciones.ndjson.

    La plataforma la escribe como `provenance` en holdings (master/holdings.v1.2)
    y la usa para no sustituir una cartera completa por una parcial más nueva.
    Sale de `meta.procedencia` (quién escribió `cartera.posiciones` y
    `cartera.fecha`), del `fetched_at` del endpoint y, para `sal_position`, de
    la respuesta guardada en `cache/raw_morningstar_lt/<ISIN>/` (huella y
    cobertura)."""
    from core.adquisicion.retencion import lee_etiqueta

    proc = _g(d, "meta", "procedencia") or {}
    etiqueta = proc.get("cartera.posiciones")
    if not etiqueta:
        return None
    # Una cartera retenida (`retenido:<etiqueta>@<fecha>`) se describe con su
    # fuente original y la fecha en que esta la sirvió. Antes salía
    # `fuente: "retenido"` y cobertura desconocida, y la plataforma lo grababa
    # así en la maestra (revisión de la rama, IMP-A).
    retenida = lee_etiqueta(str(etiqueta))
    original, fecha_retenida = retenida if retenida else (str(etiqueta), None)
    fuente, _, endpoint = original.partition(":")
    endpoint = endpoint or None
    etiqueta_fecha = str(proc.get("cartera.fecha") or "")
    fecha_ep = (lee_etiqueta(etiqueta_fecha) or (etiqueta_fecha,))[0].partition(":")[2]
    out = {
        "fuente": fuente,
        "endpoint": endpoint,
        "id_fuente": _g(d, "meta", "sec_id_morningstar") if fuente.startswith("morningstar") else None,
        "url": None,
        "obtenido": None if retenida else _g(d, "meta", "adquisicion", "fuentes", fuente, "endpoints",
                                              original, "fetched_at"),
        "sha256_respuesta": None,
        "fecha_de": _FECHA_DE.get(fecha_ep, "desconocida"),
        "cobertura": "desconocida",
        "posiciones_declaradas": None,
        "supresion_proveedor": None,
        "run_id": None,
    }
    if fuente == "morningstar_lt" and endpoint == "sal_position":
        raw_path = base / "cache" / "raw_morningstar_lt" / isin / "sal_position.json"
        try:
            datos = raw_path.read_bytes()
            raw = json.loads(datos.decode("utf-8"))
        except (OSError, ValueError):
            raw = None
        if isinstance(raw, dict):
            out["sha256_respuesta"] = hashlib.sha256(datos).hexdigest()
            (out["cobertura"], out["posiciones_declaradas"],
             out["supresion_proveedor"]) = cobertura_sal_position(raw)
    elif endpoint in _ENDPOINTS_TOP_N or fuente == "justetf":
        out["cobertura"] = "top_n" if n_posiciones <= 10 else "desconocida"
    if fuente == "justetf" and out["obtenido"] is None:
        out["obtenido"] = _obtenido_justetf(base, isin)
    if out["obtenido"] is None and fecha_retenida:
        # La etiqueta solo da el día: se escribe como el resto de `obtenido`
        # (ISO 8601 con hora en UTC), a medianoche (revisión, O-1).
        out["obtenido"] = f"{fecha_retenida}T00:00:00+00:00"
    return out


def _obtenido_justetf(base: Path, isin: str) -> str | None:
    """Cuándo se descargó la ficha completa de justETF: el `fetched_at` de su
    copia en `cache/justetf_overview/` (la ficha no registra ese endpoint)."""
    from core.adquisicion.procedencia import epoca_valida
    from fetchers.justetf import CARPETA_FICHA

    try:
        copia = json.loads((base / "cache" / CARPETA_FICHA / f"{isin}.json").read_text(encoding="utf-8"))
        # NaN, Infinity, 1e20 o futura: como si no hubiera copia (revisión, MEN-G).
        fetched_at = epoca_valida(copia.get("fetched_at"))
        if fetched_at is None:
            return None
        return dt.datetime.fromtimestamp(fetched_at, dt.timezone.utc).isoformat(timespec="seconds")
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return None


def export_all(base: Path, destino: Path) -> dict:
    funds_dir = base / "data" / "funds"
    if not funds_dir.exists():
        return {}
    destino.mkdir(parents=True, exist_ok=True)
    package_id = source_snapshot_id(funds_dir)

    ruta_fondos = destino / "fondos.ndjson"
    ruta_pos = destino / "posiciones.ndjson"
    ruta_series = destino / "series.ndjson"
    ruta_emisor = destino / cartera_emisor.FICHERO
    ruta_manifest = destino / "manifest.json"
    
    tmp_fondos = ruta_fondos.with_suffix(".ndjson.tmp")
    tmp_pos = ruta_pos.with_suffix(".ndjson.tmp")
    tmp_series = ruta_series.with_suffix(".ndjson.tmp")
    tmp_emisor = ruta_emisor.with_suffix(".ndjson.tmp")

    f_fondos = tmp_fondos.open("w", encoding="utf-8")
    f_pos = tmp_pos.open("w", encoding="utf-8")
    f_series = tmp_series.open("w", encoding="utf-8")
    f_emisor = tmp_emisor.open("w", encoding="utf-8")
    
    filas_csv, manifest_fondos = [], []
    n_pos_lineas = n_series = avisos_1mib = n_emisor_lineas = 0
    # La cartera completa del emisor de los ETF de la decisión B-79, aparte de todo lo demás: ver `core.cartera_emisor`.
    lista_emisor = cartera_emisor.carga_lista(base)
    emisor_exportados: list[str] = []
    emisor_sin_cartera: dict[str, str] = {}
    # El mismo filtro que `adaptador_bdb.genera`, por el mismo motivo: un instrumento
    # que el alcance deja fuera no debe seguir viajando desde su ficha vieja. Aqui no
    # decide a quien se escribe en la base -eso lo manda `export_bdb/`- pero si lo que
    # este paquete DESCRIBE, y un export que nombra a quien hemos excluido se acaba
    # leyendo como si contara.
    al = alcance.carga(base)
    excluidos: list[str] = []
    lector = negociacion.LectorDeLaCache(base)

    try:
        for ruta in sorted(funds_dir.glob("*.json")):
            try:
                d = json.loads(ruta.read_text(encoding="utf-8"))
            except Exception as e:
                log.warning("export: no puedo leer %s: %s", ruta.name, e)
                continue
            tipo = (_g(d, "identificacion", "tipo") or "").strip().lower()
            if al.estado(ruta.stem, tipo) != alcance.DENTRO:
                excluidos.append(ruta.stem)
                continue
            isin = _g(d, "meta", "isin") or ruta.stem
    
            # ------------------------- separar lo pesado del documento principal
            doc = json.loads(json.dumps(d, ensure_ascii=False))  # copia
            cartera = doc.get("cartera") or {}
            posiciones = cartera.pop("posiciones", None) or []
            if posiciones:
                orden = sorted(
                    [p for p in posiciones if isinstance(p, dict)],
                    key=lambda p: -(p.get("peso_pct") or 0))
                cartera["top10"] = orden[:10]
                partes = [orden[i:i + MAX_POSICIONES_POR_LINEA]
                          for i in range(0, len(orden), MAX_POSICIONES_POR_LINEA)]
                proc = procedencia_cartera(base, isin, d, len(orden))
                for n, parte in enumerate(partes, 1):
                    f_pos.write(json.dumps(
                        {"isin": isin, "parte": n, "total_partes": len(partes),
                         "fecha": cartera.get("fecha"), "procedencia": proc,
                         "posiciones": parte},
                        ensure_ascii=False) + "\n")
                    n_pos_lineas += 1
            # La cartera del emisor no cabe en el documento ligero (hasta 20.000 filas) y nunca viaja en él: es de uso
            # interno (B-53). Los ETF de la decisión B-79 la exportan aparte, a `posiciones_emisor.ndjson`; lo demás
            # del bloque `emisor` sí viaja.
            if isin in lista_emisor:
                motivo = cartera_emisor.motivo_sin_cartera(d)
                if motivo is not None:
                    emisor_sin_cartera[isin] = motivo
                for linea_emisor in cartera_emisor.lineas(isin, d, MAX_POSICIONES_POR_LINEA):
                    f_emisor.write(json.dumps(linea_emisor, ensure_ascii=False) + "\n")
                    n_emisor_lineas += 1
                if motivo is None:
                    emisor_exportados.append(isin)
            ((doc.get("emisor") or {}).get("cartera") or {}).pop("posiciones", None)
            _quita_no_publicado(doc)
            series = doc.pop("series", None)
            if isinstance(series, dict):
                for nombre, serie in series.items():
                    if isinstance(serie, list) and serie:
                        f_series.write(json.dumps(
                            {"isin": isin, "serie": nombre, "puntos": serie},
                            ensure_ascii=False) + "\n")
                        n_series += 1
    
            doc["_id"] = isin
            # Lo que se negocia sale de la respuesta guardada de su serie: ver `core.negociacion` (decision 108).
            lo_negociado = negociacion.de_ficha(doc, lector)
            if lo_negociado:
                doc["negociacion"] = lo_negociado
            linea = json.dumps(doc, ensure_ascii=False)
            if len(linea.encode("utf-8")) > 900_000:
                avisos_1mib += 1
                log.warning("export: %s supera 900KB tras aligerar (%d KB)",
                            isin, len(linea.encode()) // 1024)
            f_fondos.write(linea + "\n")
            manifest_fondos.append({
                "isin": isin,
                "hash": hashlib.sha1(
                    linea.encode("utf-8"), usedforsecurity=False
                ).hexdigest(),
                "bytes": len(linea.encode("utf-8")),
                "n_posiciones": len(posiciones),
                "actualizado": _g(d, "meta", "actualizado"),
                "calidad": _g(d, "calidad", "bucket"),
            })
            filas_csv.append(_fila_plana(isin, d))

        for f in (f_fondos, f_pos, f_series, f_emisor):
            f.close()
            
        tmp_fondos.replace(ruta_fondos)
        tmp_pos.replace(ruta_pos)
        tmp_series.replace(ruta_series)
        tmp_emisor.replace(ruta_emisor)

    finally:
        for f in (f_fondos, f_pos, f_series, f_emisor):
            if not f.closed:
                f.close()
        for t in (tmp_fondos, tmp_pos, tmp_series, tmp_emisor):
            if t.exists():
                try:
                    t.unlink()
                except Exception:
                    pass

    # ------------------------------------------------------------ CSV plano
    ruta_csv = destino / "fondos_plano.csv"
    if filas_csv:
        tmp_csv = ruta_csv.with_suffix(".csv.tmp")
        with tmp_csv.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(filas_csv[0].keys()))
            w.writeheader()
            w.writerows(filas_csv)
            f.flush()
        tmp_csv.replace(ruta_csv)

    readme_path = destino / "README_EXPORT.md"
    atomic_write_text(readme_path, README_EXPORT)

    package_files = {
        ruta_fondos.name: file_record(ruta_fondos, count_lines=True),
        ruta_pos.name: file_record(ruta_pos, count_lines=True),
        ruta_series.name: file_record(ruta_series, count_lines=True),
        ruta_emisor.name: file_record(ruta_emisor, count_lines=True),
    }
    if ruta_csv.exists():
        package_files[ruta_csv.name] = file_record(ruta_csv)
    package_files[readme_path.name] = file_record(readme_path)

    # ------------------------------------------------------------- manifest
    manifest = {
        "generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "esquema_version": 3,
        "package_id": package_id,
        "n_fondos": len(manifest_fondos),
        "fuera_de_alcance": excluidos,
        "n_lineas_posiciones": n_pos_lineas,
        "n_series": n_series,
        "n_lineas_posiciones_emisor": n_emisor_lineas,
        "cartera_emisor": {"exportados": emisor_exportados, "sin_cartera": emisor_sin_cartera},
        "files": package_files,
        "ficheros": {name: meta["bytes"] for name, meta in package_files.items()},
        "fondos": manifest_fondos,
    }
    # El manifest es el marcador de commit: se publica el ultimo y de forma atomica.
    atomic_write_text(ruta_manifest, json.dumps(manifest, ensure_ascii=False, indent=1))

    return {"n_fondos": len(manifest_fondos), "n_lineas_posiciones": n_pos_lineas,
            "n_series": n_series, "avisos_1mib": avisos_1mib,
            "cartera_emisor": {"exportados": emisor_exportados, "sin_cartera": emisor_sin_cartera},
            "package_id": package_id, "carpeta": str(destino)}


def _fuente_de(d: dict, *rutas: str) -> str | None:
    """El adaptador que puso la primera de `rutas` que tenga procedencia: «vl_eodhd», «morningstar_lt», «eodhd»…"""
    proc = _g(d, "meta", "procedencia") or {}
    for ruta in rutas:
        fuente = procedencia.fuente_de(proc.get(ruta))
        if fuente:
            return fuente
    return None


def _fila_plana(isin: str, d: dict) -> dict:
    """~60 columnas escalares para SQL/Excel/BI.

    MET-8 (auditoría del 16-11-2026): las cifras de rentabilidad y de riesgo de este fichero no salen todas de la
    misma cuenta, y antes nada lo decía. En un fondo, la volatilidad y el Sharpe son nuestros y mensuales; en una
    acción, nuestros y diarios; donde nuestra serie no llega, son los del proveedor; la alfa, la beta y el tracking
    error son siempre del proveedor; y la caída máxima es a tres años en un fondo y a cinco en una acción. Ordenar
    la columna `sharpe_3a` de arriba abajo comparaba estimadores distintos.

    Las cifras no cambian. Cada grupo lleva al lado su fuente y su fecha, la caída máxima su ventana, y
    `metricas_metodo` el sello del método con que se calcularon las propias (vacío si son del proveedor)."""
    return {
        "isin": isin,
        "nombre": _g(d, "identificacion", "nombre"),
        "tipo": _g(d, "identificacion", "tipo"),
        "tipo_producto": _g(d, "identificacion", "tipo_producto"),
        "clase_cubierta": _g(d, "identificacion", "clase_cubierta"),
        "sfdr": _g(d, "esg", "sfdr_articulo"),
        "categoria": _g(d, "identificacion", "categoria_morningstar"),
        "clase_activo": _g(d, "identificacion", "clase_activo"),
        "gestora": _g(d, "identificacion", "gestora"),
        "divisa": _g(d, "identificacion", "divisa_base"),
        "domicilio": _g(d, "identificacion", "domicilio"),
        "indice": _g(d, "identificacion", "indice_benchmark_oficial"),
        "replicacion": _g(d, "identificacion", "replicacion"),
        "distribucion": _g(d, "identificacion", "politica_distribucion"),
        "fecha_lanzamiento": _g(d, "identificacion", "fecha_lanzamiento_fondo"),
        "ter_pct": _g(d, "costes", "ter_pct"),
        "gestion_aplicada_pct": _g(d, "costes", "comision_gestion_aplicada_pct"),
        "mifid_corrientes_pct": _g(d, "costes", "mifid_emt_exante", "corrientes_pct"),
        "vl": _g(d, "valoracion", "vl"),
        "vl_fecha": _g(d, "valoracion", "vl_fecha"),
        "patrimonio_meur": _g(d, "valoracion", "patrimonio_fondo_meur"),
        "estrellas": _g(d, "rating", "estrellas", "overall"),
        "medalist": _g(d, "rating", "medalist", "rating"),
        "rent_ytd": _g(d, "rentabilidad", "trailing_pct", "ytd", "fondo"),
        "rent_1a": _g(d, "rentabilidad", "trailing_pct", "1a", "fondo"),
        "rent_3a": _g(d, "rentabilidad", "trailing_pct", "3a_anualizada", "fondo"),
        "rent_5a": _g(d, "rentabilidad", "trailing_pct", "5a_anualizada", "fondo"),
        "rent_10a": _g(d, "rentabilidad", "trailing_pct", "10a_anualizada", "fondo"),
        "rent_fecha": _g(d, "rentabilidad", "fecha_dato"),
        "rent_fuente": _fuente_de(d, "rentabilidad.trailing_pct.1a.fondo", "rentabilidad.trailing_pct.3a_anualizada.fondo",
                                  "rentabilidad.trailing_pct.ytd.fondo"),
        "rent_1a_indice": _g(d, "rentabilidad", "trailing_pct", "1a", "indice"),
        "vol_1a": _g(d, "riesgo", "volatilidad_pct", "1a", "fondo"),
        "vol_3a": _g(d, "riesgo", "volatilidad_pct", "3a", "fondo"),
        "riesgo_fecha": _g(d, "riesgo", "fecha_dato"),
        "riesgo_fuente": _fuente_de(d, "riesgo.volatilidad_pct.3a.fondo", "riesgo.volatilidad_pct.1a.fondo"),
        "metricas_metodo": _g(d, "riesgo", "historial_precios", "metodo"),
        "sharpe_3a": _g(d, "riesgo", "sharpe", "3a", "fondo"),
        "sharpe_fuente": _fuente_de(d, "riesgo.sharpe.3a.fondo"),
        "alpha_3a": _g(d, "riesgo", "alpha", "3a", "fondo"),
        "beta_3a": _g(d, "riesgo", "beta", "3a", "fondo"),
        "tracking_error_3a": _g(d, "riesgo", "tracking_error_pct", "3a", "fondo"),
        "relativas_fuente": _fuente_de(d, "riesgo.beta.3a.fondo", "riesgo.alpha.3a.fondo",
                                       "riesgo.tracking_error_pct.3a.fondo"),
        "max_drawdown_pct": _g(d, "riesgo", "max_drawdown", "pct"),
        "max_drawdown_periodo": _g(d, "riesgo", "max_drawdown", "periodo"),
        "sri": _g(d, "riesgo", "sri_kid_1a7"),
        "srri": _g(d, "riesgo", "srri_1a7"),
        "rf_duracion": _g(d, "cartera", "renta_fija", "duracion_efectiva"),
        "rf_ytm_pct": _g(d, "cartera", "renta_fija", "ytm_pct"),
        "rf_ytw_pct": _g(d, "cartera", "renta_fija", "ytw_pct"),
        "rf_ig_pct": _g(d, "cartera", "renta_fija", "pct_investment_grade"),
        "rf_hy_pct": _g(d, "cartera", "renta_fija", "pct_high_yield"),
        "rf_gobierno_pct": _g(d, "cartera", "renta_fija", "sectores_pct", "gobierno"),
        "rf_corporativa_pct": _g(d, "cartera", "renta_fija", "sectores_pct", "corporativa"),
        "num_posiciones": _g(d, "cartera", "num_posiciones"),
        "cartera_fecha": _g(d, "cartera", "fecha"),
        "esg_globos": _g(d, "esg", "globos_sostenibilidad"),
        "carbon_risk": _g(d, "esg", "carbono", "carbon_risk_score"),
        "yield_12m_pct": _g(d, "distribuciones", "yield_12m_pct"),
        "calidad_score": _g(d, "calidad", "score"),
        "calidad_bucket": _g(d, "calidad", "bucket"),
        "calidad_flags": ";".join(_g(d, "calidad", "flags") or []),
        "fuentes": ";".join(sorted({f for v in (_g(d, "meta", "fuentes") or {}).values()
                                    for f in (v or [])})),
        "actualizado": _g(d, "meta", "actualizado"),
    }


README_EXPORT = """# Export FondosDB — cómo cargarlo en tu base de datos

Generado por `python main.py export`. Formato NDJSON (una línea = un JSON):
el estándar de carga masiva que aceptan prácticamente todos los motores.

## Ficheros

| Fichero | Contenido | Clave |
|---|---|---|
| fondos.ndjson | Documento por fondo (ligero: cartera resumida a top-10) | `_id` = ISIN |
| posiciones.ndjson | Cartera completa por fondo, troceada si >2000 posiciones; `procedencia`: fuente, fecha de descarga, huella y cobertura (completa / top_n / parcial) | `isin` + `parte` |
| series.ndjson | Series temporales (CNMV diaria...) | `isin` + `serie` |
| posiciones_emisor.ndjson | Cartera completa que publica el emisor de los ETF de `config/cartera_emisor.json` (decisión B-79), troceada si >2000 posiciones. **Uso interno (B-53): solo vistas del asesor, nunca un papel de cliente** | `isin` + `parte` |
| fondos_plano.csv | ~60 columnas escalares para SQL/Excel/BI. Las cifras de rentabilidad y riesgo NO salen todas de la misma cuenta: cada grupo lleva al lado su `_fuente` y su `_fecha`, la caída máxima su `_periodo`, y `metricas_metodo` el método de las propias. No ordenes `sharpe_3a` o `vol_3a` sin filtrar antes por `riesgo_fuente` y `metricas_metodo` | `isin` |
| manifest.json | `package_id`, conteos y hashes SHA-256 por fichero | — |

## Firestore (estructura recomendada)

    fondos/{ISIN}                       <- línea de fondos.ndjson
    fondos/{ISIN}/cartera/parte_{n}     <- líneas de posiciones.ndjson
    fondos/{ISIN}/series/{nombre}       <- líneas de series.ndjson

Así el documento principal queda muy por debajo del límite de 1 MiB y las
carteras grandes (ETFs con ~1.300 posiciones, PIMCO con ~7.700) viven en
subcolecciones. La carga a la maestra de BDB la hace la plataforma de datos
(`2-plataforma-datos`, con su gate y sus contratos), no este proyecto.

## Otros motores

- **BigQuery**: `bq load --source_format=NEWLINE_DELIMITED_JSON ...`
- **MongoDB**: `mongoimport --collection fondos --file fondos.ndjson`
- **Postgres**: `\\copy tabla(doc) from 'fondos.ndjson'` sobre columna jsonb
- **DuckDB/pandas**: `read_json('fondos.ndjson', lines=True)`
- **SQL clásico**: usa `fondos_plano.csv` directamente.

## Cargas incrementales

Guarda el `manifest.json` de tu última carga; en el siguiente export compara
el `hash` por ISIN y sube solo los que cambien. Antes de cargar, valida los
SHA-256 de `files` y que el `package_id` coincida con `export_bdb/_resumen.json`.
"""
