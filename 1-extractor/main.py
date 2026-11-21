"""FondosDB — motor de datos fundamentales de fondos y ETFs (Fase 1).

Uso:
    python main.py update --all              # actualiza todos los de config/fondos.csv
    python main.py update IE00B4L5Y983 ...   # solo esos ISIN
    python main.py update --all --force      # ignora la caché
    python main.py update --all --fuentes justetf
    python main.py add ES0112611001 --nombre "Mi fondo" --tipo fondo
    python main.py report                    # cobertura de datos
    python main.py contraste                 # fase 0: métricas propias frente a Morningstar
    python main.py cobertura                 # fase 0: cuánto viene ya de fuera de Morningstar
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import logging
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

# La consola de Windows es cp1252 y no sabe escribir un nombre japonés.
#
# Medido el 02-11-2026: `add` de las acciones de la base vieja murió con
# UnicodeEncodeError en `print` al llegar a JP3122400009, cuyo nombre trae caracteres
# que cp1252 no representa. No fue un fallo del dato ni de la red: fue la línea de
# progreso. Y es peor de lo que parece, porque mata la pasada entera a mitad —de 92
# altas se hizo una— y porque el dato real nunca estuvo en duda: `config/fondos.csv`
# se escribe en UTF-8 y guarda el nombre bien.
#
# Así que lo que se afloja es solo la SALIDA: los caracteres que la consola no sepa
# poner se sustituyen en lugar de tumbar el proceso. No se fuerza UTF-8 en la consola
# a propósito, que mostraría mojibake en el 99% de los casos que hoy salen bien; se
# conserva su codificación y se cambia únicamente qué hacer con lo que no cabe.
for _flujo in (sys.stdout, sys.stderr):
    try:
        _flujo.reconfigure(errors="replace")
    except (AttributeError, ValueError):  # no es un TextIO reconfigurable (pipe, test)
        pass

from core.familias import FAMILIAS              # noqa: E402
from core.http import Http                      # noqa: E402
from core import calidad, figi, ops  # noqa: E402
from core.schema import cuenta_campos    # noqa: E402
from core.package_integrity import ConfigBloqueada  # noqa: E402
from core.store import Store, _g                # noqa: E402
from core import update as update_pipeline
from core.adquisicion import alcance as alcance_mercados  # noqa: E402
from fetchers import cnmv, eodhd, morningstar_lt  # noqa: E402

log = logging.getLogger("fondosdb")
RE_ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


# ------------------------------------------------------------------- config
def carga_settings() -> dict:
    ruta = BASE / "config" / "settings.json"
    return json.loads(ruta.read_text(encoding="utf-8"))


def carga_fondos() -> list[dict]:
    from core.package_integrity import lee_csv  # de una vez, sin dejarlo abierto (IMP-1)

    ruta = BASE / "config" / "fondos.csv"
    if not ruta.exists():
        return []
    return [r for r in lee_csv(ruta) if (r.get("isin") or "").strip()]


def configura_logging() -> None:
    logs = BASE / "logs"
    logs.mkdir(exist_ok=True)
    fichero = logs / f"fondosdb_{dt.date.today():%Y%m%d}.log"
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=[logging.FileHandler(fichero, encoding="utf-8")],
    )
    consola = logging.StreamHandler()
    consola.setLevel(logging.INFO)
    consola.setFormatter(logging.Formatter("%(levelname)-7s %(message)s"))
    logging.getLogger().addHandler(consola)



def cmd_update(args) -> int:
    settings = carga_settings()
    fondos_cfg = carga_fondos()
    tipos = {f["isin"].strip().upper(): (f.get("tipo") or "").strip()
             for f in fondos_cfg}
    if args.all:
        objetivos = [(isin, tipo) for isin, tipo in tipos.items()]
    else:
        objetivos = [(i.strip().upper(), tipos.get(i.strip().upper(), ""))
                     for i in args.isins]
    if not objetivos:
        log.error("Nada que actualizar: usa --all o indica ISINs "
                  "(añádelos antes con 'add').")
        return 1

    # El alcance de mercados manda desde el 02-11-2026, y manda solo en `--all`: nombrar
    # un ISIN a mano es un acto explícito, y negárselo dejaría sin forma de comprobar uno
    # suelto. Lo que no se hace en ninguno de los dos casos es callarse.
    alcance = alcance_mercados.carga(BASE)
    grupos = alcance.reparte(objetivos)
    fuera = grupos[alcance_mercados.FUERA]
    sin_decidir = grupos[alcance_mercados.SIN_DECIDIR]
    if args.all:
        pedidos = grupos[alcance_mercados.DENTRO]
        porpais: dict[str, int] = {}
        for isin, _ in fuera:
            porpais[isin[:2]] = porpais.get(isin[:2], 0) + 1
        print(f"alcance: se piden {len(pedidos)} de {len(objetivos)}; "
              f"{len(fuera)} acciones fuera por país"
              + (" (" + ", ".join(f"{p} {n}" for p, n in sorted(porpais.items())) + ")"
                 if porpais else ""))
        for isin, tipo in sin_decidir:
            log.warning("%s se queda fuera de la pasada SIN QUE NADIE LO HAYA DECIDIDO: "
                        "%s", isin, alcance.motivo(isin, tipo))
        objetivos = pedidos
    else:
        for isin, tipo in fuera + sin_decidir:
            log.warning("%s está fuera de alcance y se pide igual porque lo has nombrado: "
                        "%s", isin, alcance.motivo(isin, tipo))

    # Decisión 57 (09-11-2026), opción B: sin índice FIRDS, `esma_firds.fetch` devuelve {} y la
    # ficha que ya tenía identidad FIRDS se reescribe sin sus diez campos sin que nadie lo diga.
    # Se para antes de escribir nada, salvo que se pida seguir a sabiendas con --sin-firds.
    # La regla vive en `core.pasada`, que comparten las tres entradas de una pasada (EXT-6).
    from core import pasada
    store = Store(BASE)
    guarda = pasada.guarda_firds(BASE, [i for i, _ in objetivos])
    if guarda.bloquea:
        aviso = guarda.aviso(len(objetivos))
        if not args.sin_firds:
            log.error("%s. No se escribe ninguna. Constrúyelo con: %s "
                      "(o repite con --sin-firds para escribirlas sin ella)", aviso, guarda.arreglo)
            return 1
        log.warning("%s; sigo porque lo pide --sin-firds", aviso)
    for isin in guarda.desaparecidos:
        log.warning("%s", guarda.aviso_de_desaparecido(isin))

    fuentes_activas = [f.strip() for f in
                       (args.fuentes.split(",") if args.fuentes
                        else settings["prioridad_fuentes"])]
    refrescar = None
    if args.familias:
        refrescar = {f.strip() for f in args.familias.split(",") if f.strip()}
        desconocidas = refrescar - set(FAMILIAS)
        if desconocidas:
            log.error("Familias desconocidas: %s (válidas: %s)",
                      ", ".join(sorted(desconocidas)), ", ".join(FAMILIAS))
            return 1
    http = Http(settings, BASE / "cache" / "http",
                sin_caducidad=args.sin_caducidad, sin_red=args.sin_red,
                refrescar=refrescar)
    resumen = []
    # EXT-7: una ficha que falla no tumba la pasada. Se apunta, se sigue con las demás, el índice
    # se regenera y la salida es 1 al final, para que quien encadena pasos no siga como si nada.
    fallos: list[tuple[str, str]] = []

    for n, (isin, tipo) in enumerate(objetivos, 1):
        if not RE_ISIN.match(isin):
            log.warning("ISIN no válido, lo salto: %s", isin)
            continue
        print(f"\n[{n}/{len(objetivos)}] {isin}")
        try:
            res = update_pipeline.ejecuta_pipeline(
                isin, tipo, fuentes_activas, http, settings, args.force, BASE, args.sin_historico,
                print_cb=print, familias=refrescar,
            )
        except Exception as e:  # noqa: BLE001 - se apunta y se sigue; Ctrl-C sí corta
            motivo = pasada.describe_fallo(e)
            fallos.append((isin, motivo))
            log.error("%s: la ficha ha fallado y no se reescribe; la pasada sigue. %s\n%s",
                      isin, motivo, pasada.traza_del_fallo())
            print(f"   ERROR: la ficha ha fallado y no se reescribe: {motivo}")
            resumen.append((isin, 0, f"ERROR: {motivo}"))
            continue
        resumen.append((isin, res["campos"], res["reason"]))

    store.reconstruye_indice()
    print("\n" + "=" * 56)
    for isin, con, nota in resumen:
        print(f"{isin:<15} {con:>5} campos   {nota}")
    # D-9 y D-10: cuántos fondos parados siguen con Morningstar, por qué vía, y cuántos no y por qué.
    from core import serie_de_respaldo
    respaldo = serie_de_respaldo.resumen(http)
    if respaldo:
        log.info(respaldo)
        print(respaldo)
    print(resumen_peticiones(http))
    print("Índice: data/index.json · Log: logs/")
    lineas_de_fallos = pasada.resumen_de_fallos(fallos, len(objetivos))
    if lineas_de_fallos:
        print("\n" + "\n".join(lineas_de_fallos))
        log.error(lineas_de_fallos[0] + " " + ", ".join(isin for isin, _ in fallos))
        return 1
    return 0


def resumen_peticiones(http) -> str:
    """Cuántas peticiones fueron a red y cuántas sirvió la caché, por familia."""
    e = http.estadisticas
    lineas = [f"Peticiones: {e['red']} a red · {e['cache']} de caché"
              + (f" · {e['sin_cache']} sin caché (modo sin red)" if e["sin_cache"] else "")]
    for familia, v in sorted(e["por_familia"].items()):
        lineas.append(f"   {familia:<14} red {v['red']:>5}   caché {v['cache']:>5}")
    log.info("\n".join(lineas))
    return "\n".join(lineas)


# ---------------------------------------------------------------------- add
def cmd_add(args) -> int:
    """Acepta uno o varios ISINs. Si no se da --nombre, resuelve nombre y
    tipo automáticamente vía el screener de Morningstar. La fila se escribe
    con `core.ops.anade_a_universo` (bloqueo y escritura atómica, ALTA-17a)."""
    existentes = {f["isin"].strip().upper() for f in carga_fondos()}
    settings = carga_settings()
    http = Http(settings, BASE / "cache" / "http")
    añadidos = []
    for crudo in args.isins:
        isin = crudo.strip().upper().strip(",;")
        if not RE_ISIN.match(isin):
            print(f"ISIN no válido, lo salto: {isin}")
            continue
        if isin in existentes:
            print(f"{isin} ya estaba en fondos.csv")
            continue
        if len(args.isins) == 1 and args.nombre:
            nombre, tipo = args.nombre, args.tipo
        else:
            info = None
            try:
                info = morningstar_lt.resuelve(isin, http, settings)
            except Exception as e:
                log.debug("resuelve %s: %s", isin, e)
            nombre = (info or {}).get("nombre", args.nombre or "")
            # CONTRASTADOR: EODHD/nombre deciden el tipo (corrige aunque te confundas).
            tipo = eodhd.clasifica_isin(isin, http, settings, BASE, nombre, args.tipo)
            print(f"{isin} -> {nombre or '(sin nombre)'} ({tipo})"
                  + ("" if info else "  [no identificado]"))
        if not ops.anade_a_universo(BASE, isin, nombre, tipo):
            print(f"{isin} ya estaba en fondos.csv")
            continue
        existentes.add(isin)
        añadidos.append(isin)
    if añadidos:
        print(f"\nAñadidos {len(añadidos)}. Ejecuta: "
              f"python main.py update {' '.join(añadidos)}")
    return 0


# ----------------------------------------------------------------- reclasifica
def cmd_reclasifica(args) -> int:
    """Corrige el tipo (accion/etf/fondo) vía EODHD. Solo toca activos de
    mercado (accion/etf/vacío) y los huérfanos (JSON sin entrada en fondos.csv);
    NO toca los 'fondo' para no romper la cartera. Reescribe fondos.csv
    preservando el orden y añadiendo los huérfanos al final."""
    import io

    from core.package_integrity import atomic_write_text, bloqueo_config
    settings = carga_settings()
    http = Http(settings, BASE / "cache" / "http")

    por_isin, orden = {}, []
    for f in carga_fondos():
        isin = f["isin"].strip().upper()
        if isin and isin not in por_isin:
            por_isin[isin] = {"nombre": f.get("nombre", ""), "tipo": (f.get("tipo") or "").strip()}
            orden.append(isin)

    data_dir = BASE / "data" / "funds"
    if data_dir.exists():
        for p in sorted(data_dir.glob("*.json")):
            isin = p.stem.strip().upper()
            if RE_ISIN.match(isin) and isin not in por_isin:
                por_isin[isin] = {"nombre": "", "tipo": ""}
                orden.append(isin)

    cambios: dict[str, str] = {}
    for isin in orden:
        f = por_isin[isin]
        tipo = (f["tipo"] or "").lower()
        nombre = f["nombre"] or ""
        # Fondo real (con nombre y sin 'ETF') -> no tocar. Un 'fondo' SIN nombre
        # es sospechoso (p. ej. ETF mal etiquetado) -> se verifica con el contrastador.
        if tipo == "fondo" and nombre.strip() and "ETF" not in nombre.upper():
            continue
        try:
            nuevo = eodhd.clasifica_isin(isin, http, settings, BASE, nombre, tipo)
        except Exception as e:
            log.debug("reclasifica %s: %s", isin, e)
            nuevo = tipo or "fondo"
        if nuevo and nuevo != tipo:
            print(f"{isin}  {tipo or '(vacio)'} -> {nuevo}   {nombre}")
            cambios[isin] = nuevo

    # Se reescribe sobre lo que tenga fondos.csv ahora, no sobre lo leído al
    # principio: entre medias van las consultas a EODHD, y un alta que entrara
    # entonces se perdía. Bajo el bloqueo de config/, entre hilos y entre
    # procesos (6.7c), y con escritura atómica (auditoría 16-10, ALTA-17a).
    with bloqueo_config(BASE):
        filas: list[list[str]] = []
        vistos: set[str] = set()
        for f in carga_fondos():
            isin = f["isin"].strip().upper()
            if isin and isin not in vistos:
                vistos.add(isin)
                filas.append([isin, f.get("nombre") or "", (f.get("tipo") or "").strip()])
        for isin in orden:  # huérfanos: JSON sin entrada en fondos.csv
            if isin not in vistos:
                vistos.add(isin)
                filas.append([isin, por_isin[isin]["nombre"], por_isin[isin]["tipo"]])
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["isin", "nombre", "tipo"])
        for isin, nombre, tipo in filas:
            w.writerow([isin, nombre, cambios.get(isin, tipo) or "fondo"])
        atomic_write_text(BASE / "config" / "fondos.csv", buf.getvalue())
    print(f"\nReclasificación: {len(cambios)} cambios. fondos.csv reescrito "
          f"({len(filas)} entradas). Ahora: python main.py update --all")
    return 0


# --------------------------------------------------------------------- cnmv
def cmd_cnmv(args) -> int:
    settings = carga_settings()
    http = Http(settings, BASE / "cache" / "http")
    isins = {f["isin"].strip().upper() for f in carga_fondos()
             if f["isin"].strip().upper().startswith("ES")}
    if not isins:
        print("No hay ISINs españoles (ES...) en config/fondos.csv; "
              "añádelos antes con 'add'.")
        return 1
    print(f"Buscando datos CNMV para {len(isins)} fondos españoles...")
    try:
        res = cnmv.descarga_y_procesa(http, BASE, isins,
                                      ano=args.ano, mes=args.mes,
                                      force=args.force)
    except Exception as e:
        log.error("CNMV: %s", e)
        return 1
    print(f"Periodo {res['periodo']}: {res['isins_con_datos']} fondos con "
          f"datos de {res['ficheros_zip']} ficheros del ZIP.")
    print("Ahora ejecuta: python main.py update --all  (o los ISIN ES...)")
    return 0


# ------------------------------------------------------------------ calidad
def cmd_calidad(_args) -> int:
    """Genera reports/calidad_resumen.csv y reports/fondos_problematicos.md
    a partir de los JSON ya guardados (sin red)."""
    funds_dir = BASE / "data" / "funds"
    reports = BASE / "reports"
    reports.mkdir(exist_ok=True)
    filas, problematicos, buckets = [], [], {}
    for ruta in sorted(funds_dir.glob("*.json")):
        try:
            d = json.loads(ruta.read_text(encoding="utf-8"))
        except Exception:
            continue
        calidad.aplica(d)  # recalcula siempre con la lógica vigente (sin red)
        c = d.get("calidad", {})
        bucket = c.get("bucket", "?")
        buckets[bucket] = buckets.get(bucket, 0) + 1
        fila = {
            "isin": _g(d, "meta", "isin") or ruta.stem,
            "nombre": _g(d, "identificacion", "nombre") or "",
            "tipo": _g(d, "identificacion", "tipo") or "",
            "categoria": _g(d, "identificacion", "categoria_morningstar") or "",
            "score": c.get("score"), "bucket": bucket,
            "esenciales": c.get("esenciales"),
            "n_flags": len(c.get("flags") or []),
            "flags": ";".join(c.get("flags") or []),
        }
        filas.append(fila)
        alertas = [f for f in (c.get("flags") or [])
                   if not f.startswith("info_")]
        if bucket in ("BAJO", "BLOQUEADO") or len(alertas) >= 2:
            problematicos.append(fila)

    ruta_csv = reports / "calidad_resumen.csv"
    with ruta_csv.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0].keys()) if filas else [])
        w.writeheader()
        w.writerows(sorted(filas, key=lambda x: (x["score"] or 0)))

    ruta_md = reports / "fondos_problematicos.md"
    lineas = [f"# Fondos problemáticos — {dt.date.today():%d-%m-%Y}",
              "", f"Total analizados: {len(filas)} · " +
              " · ".join(f"{k}: {v}" for k, v in sorted(buckets.items())), ""]
    for f_ in sorted(problematicos, key=lambda x: (x["score"] or 0)):
        lineas.append(f"- **{f_['isin']}** {f_['nombre'][:55]} — "
                      f"{f_['bucket']} ({f_['score']}) · {f_['flags'] or 'pocos esenciales'}")
    ruta_md.write_text("\n".join(lineas), encoding="utf-8")

    print(f"Analizados {len(filas)} fondos: " +
          " | ".join(f"{k} {v}" for k, v in sorted(buckets.items())))
    print(f"Problemáticos: {len(problematicos)} -> {ruta_md}")
    print(f"Resumen CSV   -> {ruta_csv}")
    return 0


# --------------------------------------------------------------------- figi
def cmd_figi(_args) -> int:
    """Resuelve FIGI/mercado para posiciones con ticker sin ISIN y los
    aplica a todos los JSON guardados."""
    funds_dir = BASE / "data" / "funds"
    pendientes, fondos = [], {}
    for ruta in sorted(funds_dir.glob("*.json")):
        try:
            d = json.loads(ruta.read_text(encoding="utf-8"))
        except Exception:
            continue
        fondos[ruta] = d
        pendientes.extend(figi.pendientes_de(d))
    unicos = list(dict.fromkeys(pendientes))
    print(f"Posiciones con ticker sin ISIN/FIGI: {len(pendientes)} "
          f"({len(unicos)} tickers únicos)")
    if not unicos:
        print("Nada que resolver.")
        return 0
    try:
        mapa = figi.resuelve(BASE, unicos)
    except Exception as e:
        log.error("figi: %s", e)
        return 1
    tocados = total_pos = 0
    for ruta, d in fondos.items():
        n = figi.aplica(d, mapa=mapa)
        if n:
            ruta.write_text(json.dumps(d, ensure_ascii=False, indent=2),
                            encoding="utf-8")
            tocados += 1
            total_pos += n
    print(f"Enriquecidas {total_pos} posiciones en {tocados} fondos. "
          f"Mapa: cache/figi/mapa.json (permanente).")
    print("Los próximos update lo re-aplican solos. Regenera el export si "
          "lo usas: python main.py export")
    return 0


# ---------------------------------------------------------------------- bdb
def cmd_series(args) -> int:
    from core import export_series
    try:
        res = export_series.genera(BASE, carga_settings())
    except Exception as e:
        log.error("export de series: %s", e)
        return 1
    print(f"Series: {res['por_estado']} · {res['observaciones']} observaciones")
    print("Carpeta: export_series/  (detalle en _resumen.txt)")
    return 0


def cmd_cambios(args) -> int:
    from core import export_series
    http = Http(carga_settings(), BASE / "cache" / "http")
    try:
        res = export_series.genera_cambios(BASE, http)
        estr = export_series.genera_estr(BASE, http)
    except Exception as e:
        log.error("cambios del BCE: %s", e)
        return 1
    print(f"Cambios del BCE: {res}  (carpeta export_fx/)")
    print(f"ESTR del BCE: {estr} observaciones  (carpeta export_rf/)")
    return 0


def cmd_bdb(args) -> int:
    from core import adaptador_bdb
    try:
        res = adaptador_bdb.genera(BASE, destino=Path(args.destino) if args.destino else None)
    except Exception as e:
        log.error("adaptador BDB: %s", e)
        return 1
    print(f"Canónicos BDB generados: {res['ok']} (errores: {res['errores']})")
    print(f"Carpeta: {res['carpeta']}  (resumen en _resumen.json)")
    print("FondosDB no toca BDB-FONDOS: copia los JSON o cárgalos con tu "
          "flujo habitual cuando quieras.")
    return 0


# ------------------------------------------------------------------- export
def cmd_export(_args) -> int:
    from core import exporta
    try:
        res = exporta.export_all(BASE, BASE / "export")
    except Exception as e:
        log.error("export: %s", e)
        return 1
    print(f"Export generado en {res['carpeta']}")
    print(f"  fondos: {res['n_fondos']} | líneas de posiciones: "
          f"{res['n_lineas_posiciones']} | series: {res['n_series']}")
    if res["avisos_1mib"]:
        print(f"  AVISO: {res['avisos_1mib']} documentos >900KB (ver log)")
    del_emisor = res.get("cartera_emisor") or {}
    if del_emisor.get("exportados") or del_emisor.get("sin_cartera"):
        print(f"  cartera del emisor (B-79, uso interno): {len(del_emisor.get('exportados') or [])} ETF en "
              "posiciones_emisor.ndjson")
        for isin, motivo in sorted((del_emisor.get("sin_cartera") or {}).items()):
            print(f"    sin cartera del emisor: {isin} ({motivo})")
    print("  Cómo cargarlo (Firestore y otros): export/README_EXPORT.md")
    return 0


# -------------------------------------------------------------------- visor
def cmd_visor(_args) -> int:
    from core import visor
    try:
        ruta = visor.genera(BASE)
    except Exception as e:
        log.error("visor: %s", e)
        return 1
    print(f"Visor generado: {ruta}")
    print("Ábrelo con doble clic (funciona sin conexión).")
    return 0


# ---------------------------------------------------------------------- ops
def cmd_ops(args) -> int:
    """Servicio local que la app usa para operar el extractor y la plataforma."""
    import ops_server
    return ops_server.main(["--puerto", str(args.puerto)])


def cmd_ops_token(_args) -> int:
    """Imprime el token del servicio `ops` en una sola línea y nada más en stdout.

    Lo crea si falta (`config/ops_token.txt`, ver `core.ops.token_ops`). La app
    lo lee al arrancar su servidor de desarrollo y lo pasa como
    `VITE_BDB_OPS_TOKEN` (decisión de Óscar, 17-10, 6.7b)."""
    from core import ops
    try:
        settings = carga_settings()
    except (OSError, ValueError):
        settings = {}
    try:
        token = ops.token_ops(BASE, settings)
    except Exception as e:
        log.error("ops-token: %s", e)
        return 1
    aviso = ops.aviso_token(settings)
    if aviso:
        log.warning(aviso)           # a stderr: stdout lleva solo el token
    print(token, flush=True)
    return 0


# -------------------------------------------------------------- corrige
def cmd_corrige(args) -> int:
    """Corrección manual de un campo suelto, en origen (config/correcciones.json).
    Se aplica en la siguiente pasada del extractor y viaja al canónico y a la
    maestra por el camino de siempre."""
    from core import correcciones
    from core.schema import _get_path

    if args.listar:
        filas = correcciones.lista(BASE, args.isin)
        if not filas:
            print("Sin correcciones" + (f" para {args.isin}" if args.isin else "") + ".")
            return 0
        for f in filas:
            print(f"{f['isin']}  {f['ruta']:<45} = {f['valor']!r:<20} {f['autor']} {f['fecha'][:10]}  {f['motivo']}")
        return 0
    if not args.isin or not args.ruta:
        print("Uso: python main.py corrige ISIN ruta valor --motivo '...'  |  --quitar  |  --listar [ISIN]")
        return 2
    isin = args.isin.strip().upper()
    if args.quitar:
        try:
            quitada = correcciones.quita(BASE, isin, args.ruta)
        except (ConfigBloqueada, OSError) as e:
            print(f"ERROR: {e}")
            return 2
        if quitada:
            print(f"Corrección retirada: {isin} {args.ruta}. Ahora: python main.py update {isin} --sin-caducidad")
            return 0
        print(f"No había corrección de {args.ruta} para {isin}.")
        return 1
    if args.valor is None:
        print("Falta el valor (null borra el campo).")
        return 2
    ficha_ruta = BASE / "data" / "funds" / f"{isin}.json"
    actual = None
    if ficha_ruta.exists():
        try:
            actual = _get_path(json.loads(ficha_ruta.read_text(encoding="utf-8")), args.ruta)
        except ValueError:
            actual = None
    try:
        fila = correcciones.pon(BASE, isin, args.ruta, correcciones.interpreta_valor(args.valor),
                                args.motivo or "", args.autor or "", actual=actual, nueva=args.nueva)
    except (correcciones.ErrorCorreccion, ConfigBloqueada, OSError) as e:
        # config/ bloqueada o correcciones.json abierto en otro programa: mensaje,
        # no traceback (revisión de la quinta pasada, MEN-5).
        print(f"ERROR: {e}")
        return 2
    print(f"Corrección guardada: {isin} {fila['ruta']} = {fila['valor']!r} (la fuente trae {actual!r}); "
          f"autor {fila['autor']}.")
    print(f"Ahora: python main.py update {isin} --sin-caducidad && python main.py bdb && python main.py export")
    return 0


# -------------------------------------------------------------- capacidades
def cmd_capacidades(args) -> int:
    """Qué sabe dar cada adaptador y qué queda si cae alguno."""
    from core.adquisicion import capacidades, registro
    from core.adquisicion.adaptador import sin
    from core.familias import DESCRIPCION, ttl_familias

    settings = carga_settings()
    ttl = ttl_familias(settings)
    if args.ruta:
        print(f"Ruta {args.ruta}:")
        for a in registro.ADAPTADORES:
            patron = capacidades.cubre(a.capacidades, args.ruta)
            if patron:
                print(f"  {a.id:<16} {'oficial' if a.oficial else 'comercial':<9} "
                      f"familia {a.capacidades[patron]} (declarada como {patron})")
        return 0
    if args.sin:
        caidos = {x.strip() for x in args.sin.split(",") if x.strip()}
        res = sin(registro.ADAPTADORES, caidos)
        print(f"Si caen {', '.join(sorted(caidos))}:")
        print(f"  {len(res['huerfanas'])} rutas se quedan sin fuente:")
        for r in res["huerfanas"]:
            print(f"    - {r}")
        print(f"  {len(res['respaldadas'])} rutas conservan respaldo:")
        for r, quien in res["respaldadas"].items():
            print(f"    - {r:<45} -> {', '.join(quien)}")
        return 0
    print("Familias de dato y TTL (días):")
    for f, d in ttl.items():
        print(f"  {f:<12} {d:>5.0f}   {DESCRIPCION[f]}")
    print("\nAdaptadores:")
    for a in sorted(registro.ADAPTADORES, key=lambda x: x.orden):
        fams = ", ".join(sorted(a.familias()))
        print(f"  {a.id:<16} {'oficial' if a.oficial else 'comercial':<9} "
              f"{len(a.capacidades):>3} rutas · {len(a.endpoints):>2} endpoints · {fams}")
        print(f"                   {a.descripcion}")
    return 0


# ------------------------------------------------------------------- report
def cmd_report(_args) -> int:
    indice = BASE / "data" / "index.json"
    if not indice.exists():
        print("Aún no hay datos: ejecuta primero 'update'.")
        return 1
    idx = json.loads(indice.read_text(encoding="utf-8"))
    fondos = idx.get("fondos", [])
    print(f"\nFondos en base: {len(fondos)}   "
          f"(actualizado {idx.get('actualizado')})\n")
    print(f"{'ISIN':<14} {'campos':>6}  {'TER':>5}  {'VL':>10}  "
          f"{'*':>2}  fuentes        nombre")
    print("-" * 100)
    for f in fondos:
        print(f"{f['isin']:<14} {f.get('campos_con_dato') or 0:>6}  "
              f"{_fmt(f.get('ter_pct')):>5}  {_fmt(f.get('vl')):>10}  "
              f"{_fmt(f.get('estrellas')):>2}  "
              f"{','.join(f.get('fuentes') or [])[:14]:<14} "
              f"{(f.get('nombre') or '')[:42]}")
    # huecos por bloque
    bloques = {}
    for ruta in (BASE / "data" / "funds").glob("*.json"):
        d = json.loads(ruta.read_text(encoding="utf-8"))
        for bloque in ("identificacion", "valoracion", "costes", "rentabilidad",
                       "riesgo", "rating", "cartera", "esg", "gestion",
                       "distribuciones"):
            con, tot = cuenta_campos(d.get(bloque, {}))
            ok, total = bloques.get(bloque, (0, 0))
            bloques[bloque] = (ok + con, total + max(tot, 1))
    print("\nCobertura por bloque (campos con dato):")
    for bloque, (ok, total) in bloques.items():
        print(f"  {bloque:<16} {ok:>6}")
    return 0


def _fmt(v):
    return "-" if v is None else v


# ------------------------------------------------------- fase 0 (sin red)
def _fichas_fondo():
    for ruta in sorted((BASE / "data" / "funds").glob("*.json")):
        try:
            d = json.loads(ruta.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if str(_g(d, "identificacion", "tipo") or "").lower() == "fondo":
            yield d


def cmd_contraste(_args) -> int:
    """reports/contraste_fase0.{csv,md}: métricas propias frente a Morningstar."""
    from core import fase0

    filas, con_contraste, total = [], 0, 0
    for d in _fichas_fondo():
        total += 1
        f = fase0.contraste_ficha(d)
        con_contraste += bool(_g(d, "meta", "contraste"))
        filas.extend(f)
    reports = BASE / "reports"
    reports.mkdir(exist_ok=True)
    campos = ["isin", "ruta", "grupo", "estado", "propio", "morningstar", "diferencia",
              "unidad", "tolerancia", "fecha_propia", "fecha_morningstar",
              "divisa_propia", "divisa_morningstar"]
    with (reports / "contraste_fase0.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=campos, extrasaction="ignore")
        w.writeheader()
        w.writerows(filas)
    resumen = fase0.resume_contraste(filas)
    lineas = [f"# Contraste fase 0 — {dt.date.today():%d-%m-%Y}", "",
              f"Fondos: {total} · con valores de Morningstar en contraste: {con_contraste}", "",
              "| grupo | comparadas | dentro | % | mediana |dif| | máx |dif| | fecha distinta | "
              "sin fecha | divisa distinta | sin propio |",
              "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for g, r in resumen.items():
        lineas.append(f"| {g} | {r['comparadas']} | {r['ok']} | {_fmt(r['pct_ok'])} | "
                      f"{_fmt(r['mediana_abs'])} | {_fmt(r['max_abs'])} | "
                      f"{r.get('fecha_distinta', 0)} | {r.get('sin_fecha', 0)} | "
                      f"{r.get('divisa_distinta', 0)} | {r.get('sin_propio', 0)} |")
    fuera = sorted((f for f in filas if f["estado"] == "fuera"),
                   key=lambda f: -abs(f["diferencia"]))[:40]
    if fuera:
        lineas += ["", "## Mayores desvíos", ""]
        lineas += [f"- {f['isin']} `{f['ruta']}`: propio {f['propio']} · Morningstar "
                   f"{f['morningstar']} · dif {f['diferencia']} {f['unidad']}" for f in fuera]
    (reports / "contraste_fase0.md").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    for g, r in resumen.items():
        print(f"  {g:<32} {r['ok']:>5}/{r['comparadas']:<5} dentro "
              f"({_fmt(r['pct_ok'])} %) · fecha distinta {r.get('fecha_distinta', 0)}"
              f" · sin fecha {r.get('sin_fecha', 0)}"
              f" · divisa distinta {r.get('divisa_distinta', 0)}")
    print(f"Detalle -> {reports / 'contraste_fase0.csv'}")
    return 0


def cmd_cobertura(_args) -> int:
    """reports/cobertura_fase0.md: hojas fuera de Morningstar y frescura del VL."""
    from core import fase0

    fichas = [fase0.cobertura_ficha(d) for d in _fichas_fondo()]
    r = fase0.resume_cobertura(fichas)
    reports = BASE / "reports"
    reports.mkdir(exist_ok=True)
    n = r["fondos"] or 1
    lineas = [f"# Cobertura fase 0 — {dt.date.today():%d-%m-%Y}", "",
              f"- Fondos: {r['fondos']}",
              f"- VL del día hábil anterior a la pasada: {r['vl_fresco']} "
              f"({100 * r['vl_fresco'] / n:.1f} %) · puerta: 100 %",
              f"- VL con un día hábil de retraso como mucho: {r['vl_al_dia']} "
              f"({100 * r['vl_al_dia'] / n:.1f} %) (lo normal en una pasada nocturna)",
              "- Retraso del VL en días hábiles: "
              + " · ".join(f"{k}: {v}" for k, v in r["retrasos"].items()),
              f"- Series de EODHD paradas (VL de Morningstar de respaldo): {r['series_paradas']}",
              f"- Fichas con solo VL y métricas actualizados (guarda de regresión): {r['parciales']}",
              f"- Fichas que la última pasada no reescribió: {len(r['sin_actualizar'])}"
              + (f" ({', '.join(r['sin_actualizar'][:12])}{'…' if len(r['sin_actualizar']) > 12 else ''})"
                 if r["sin_actualizar"] else ""),
              f"- VL de EODHD: {r['vl_eodhd']} ({100 * r['vl_eodhd'] / n:.1f} %)",
              f"- Métricas propias: {r['metricas_propias']} ({100 * r['metricas_propias'] / n:.1f} %)",
              "", "Sin métricas propias, por motivo:", ""]
    lineas += [f"- {k}: {v}" for k, v in r["avisos_metricas"].items()] or ["- (ninguno)"]
    lineas += ["", "## Por bloque", "", "| bloque | hojas | fuera de Morningstar | % |", "|---|---:|---:|---:|"]
    lineas += [f"| {b} | {x['hojas']} | {x['no_morningstar']} | {_fmt(x['pct'])} |"
               for b, x in r["bloques"].items()]
    lineas += ["", "## Por gestora", "",
               "| gestora | fondos | % hojas fuera de Morningstar | VL fresco | métricas propias |",
               "|---|---:|---:|---:|---:|"]
    lineas += [f"| {g} | {x['fondos']} | {_fmt(x['pct'])} | {x['vl_fresco']} | {x['metricas_propias']} |"
               for g, x in r["gestoras"].items()]
    viejos = sorted((c for c in fichas if not c["vl_fresco"]),
                    key=lambda c: -(c["dias_vl"] if c["dias_vl"] is not None else 10**6))
    if viejos:
        lineas += ["", "## VL no fresco", ""]
        lineas += [f"- {c['isin']} {c['nombre'][:50]}: VL {c['vl_fecha'] or '—'} "
                   f"({_fmt(c['dias_vl'])} d) de {c['vl_fuente'] or '—'}" for c in viejos[:200]]
    (reports / "cobertura_fase0.md").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    print(f"Fondos {r['fondos']} · VL fresco {r['vl_fresco']} · al día (≤1 hábil) {r['vl_al_dia']} · "
          f"VL EODHD {r['vl_eodhd']} · métricas propias {r['metricas_propias']} · "
          f"sin actualizar {len(r['sin_actualizar'])}")
    for b, x in r["bloques"].items():
        print(f"  {b:<16} {_fmt(x['pct']):>6} % fuera de Morningstar ({x['no_morningstar']}/{x['hojas']})")
    print(f"Informe -> {reports / 'cobertura_fase0.md'}")
    return 0


# --------------------------------------------------------------------- FIRDS
def _universo_actual() -> dict[str, str]:
    """ISIN -> tipo del sistema, de `config/fondos.csv` (solo lectura)."""
    ruta = BASE / "config" / "fondos.csv"
    if not ruta.exists():
        return {}
    with ruta.open(encoding="utf-8", newline="") as f:
        return {(r.get("isin") or "").strip().upper(): (r.get("tipo") or "").strip()
                for r in csv.DictReader(f) if r.get("isin")}


def cmd_firds(args) -> int:
    """Construye o actualiza el índice local de ESMA FIRDS (cache/firds/firds.sqlite)."""
    from fetchers import esma_firds
    if args.isin:
        indice = BASE / esma_firds.RUTA_INDICE
        if not indice.exists():
            log.error("sin índice FIRDS: python main.py firds")
            return 1
        con = esma_firds.abre(indice)
        try:
            for isin in args.isin:
                f = esma_firds.ficha(con, isin)
                print(json.dumps({"isin": isin.upper(), "firds": f}, ensure_ascii=False, indent=1))
        finally:
            con.close()
        return 0
    http = Http(carga_settings(), BASE / "cache" / "http")
    hasta = dt.date.fromisoformat(args.fecha) if args.fecha else None
    r = esma_firds.construye(http, BASE, hasta=hasta, force=args.force, deltas=not args.sin_deltas)
    print(f"FIRDS: completo del {r['completo']} · {len(r['ficheros'])} ficheros leídos · "
          f"{len(r['deltas'])} deltas aplicados · {r['instrumentos']} instrumentos · "
          f"{r['mercados']} pares instrumento-centro")
    return 0


def cmd_emisores(args) -> int:
    """Emisores de las acciones por LEI (decisión 8): GLEIF por cada LEI del canónico.

    Va después de `bdb`, porque lee `export_bdb/`. Escribe `export_entidades/emisores.json` y,
    si hay LEI nuevos, les da id en `config/emisores_lei.csv`. No toca ninguna base."""
    from core import emisores
    http = Http(carga_settings(), BASE / "cache" / "http",
                sin_caducidad=args.sin_caducidad or args.sin_red, sin_red=args.sin_red)
    try:
        r = emisores.pasada(BASE, http, force=args.force, hoy=dt.date.today().isoformat())
    except emisores.ErrorRegistro as e:
        log.error("%s", e)
        return 1
    c = r["cuentas"]
    print(f"Acciones en el canónico: {c['acciones']} · con LEI {c['con_lei']} · "
          f"{c['leis_distintos']} LEI distintos")
    print(f"Emisores: {c['emisores']} ({c['ids_nuevos']} ids nuevos) · enlaces EQUITY_ISSUER: "
          f"{c['enlaces']}")
    print(f"Sin LEI: {c['sin_lei']} · LEI que GLEIF no resuelve: {c['lei_sin_gleif']} · "
          f"sin fecha de FIRDS: {c['sin_fecha']}")
    for x in r["sin_lei"]:
        print(f"   sin LEI      {x['isin']}  {x['nombre']}: {x['motivo']}")
    for x in r["lei_sin_gleif"]:
        print(f"   sin GLEIF    {x['isin']}  {x['lei']}  {x['nombre']}: {x['motivo']}")
    for x in r["sin_fecha"]:
        print(f"   sin fecha    {x['isin']}  {x['nombre']}: {x['motivo']}")
    e = http.estadisticas
    print(f"Peticiones: {e['red']} a red · {e['cache']} de caché · {e['sin_cache']} sin caché")
    print(f"Salida: {BASE / emisores.RUTA_SALIDA}")
    return 0


def cmd_planes(args) -> int:
    """Catálogo de planes de pensiones y EPSV (decisión D-11): la lista y la serie de cada uno.

    Es una pasada aparte: no lee ni escribe `data/funds/` ni `export_bdb/`, y no toca ninguna
    base. Escribe `export_planes/planes.json`, que es lo que lee la plataforma."""
    from core import planes
    http = Http(carga_settings(), BASE / "cache" / "http",
                sin_caducidad=args.sin_caducidad or args.sin_red, sin_red=args.sin_red)
    try:
        r = planes.pasada(BASE, http, force=args.force, con_series=not args.sin_series,
                          hoy=dt.date.today().isoformat())
    except ConnectionError as e:
        log.error("No se escribe el catálogo de planes: %s", e)
        return 1
    c = r["cuentas"]
    print(f"La fuente declara {c['declarados_por_la_fuente']} · recibidos {c['recibidos']} · entran {c['planes']}")
    print(f"Planes de pensiones: {c['planes_de_pensiones']} (de empleo simplificados: "
          f"{c['de_empleo_simplificados']}) · EPSV: {c['epsv']}")
    print(f"Con serie: {c['con_serie']} · sin serie: {c['sin_serie']} · sin clasificar: "
          f"{c['sin_clasificar']} · sin identidad: {c['sin_identidad']}")
    for x in r["sin_clasificar"]:
        print(f"   sin clasificar  {x['id']}  {x['nombre']}: {x['motivo']}")
    for x in r["sin_identidad"]:
        print(f"   sin identidad   {x['id']}  {x['nombre']}: {x['motivo']}")
    for x in r["sin_serie"][:20]:
        print(f"   sin serie       {x['id']}  {x['nombre']}: {x['motivo']}")
    e = http.estadisticas
    print(f"Peticiones: {e['red']} a red · {e['cache']} de caché · {e['sin_cache']} sin caché")
    print(f"Salida: {BASE / planes.RUTA_SALIDA}")
    return 0


def cmd_universo(args) -> int:
    """Lista de candidatos de FIRDS por centro y tipo. No da de alta nada."""
    from fetchers import esma_firds
    indice = BASE / esma_firds.RUTA_INDICE
    if not indice.exists():
        log.error("sin índice FIRDS: python main.py firds")
        return 1
    mics = tuple(m.strip().upper() for m in (args.mercados or ",".join(esma_firds.mic_por_defecto())).split(",")
                 if m.strip())
    tipos = tuple(t.strip().upper() for t in args.tipos.split(",") if t.strip())
    malos = [t for t in tipos if t not in esma_firds.TIPOS_CFI]
    if malos:
        log.error("tipos desconocidos %s (son %s)", malos, ", ".join(esma_firds.TIPOS_CFI))
        return 1
    hoy = dt.date.fromisoformat(args.fecha) if args.fecha else dt.date.today()
    universo = _universo_actual()
    con = esma_firds.abre(indice)
    try:
        filas = esma_firds.candidatos(con, mics, tipos, hoy=hoy, incluye_bajas=args.incluir_bajas)
        completo = esma_firds.meta(con, "completo")
    finally:
        con.close()
    reports = BASE / "reports"
    reports.mkdir(exist_ok=True)
    salida = reports / f"universo_firds_{hoy.isoformat()}.csv"
    cabecera = ["isin", "nombre", "cfi", "tipo_cfi", "divisa", "lei_emisor", "mics",
                "mics_en_alcance", "primera_negociacion", "baja_en_todos", "en_universo",
                "tipo_sistema"]
    por_tipo: dict[str, int] = {}
    por_mic: dict[str, int] = {}
    with salida.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(cabecera)
        for x in filas:
            todos = [m["mic"] for m in x["mercados"]]
            dentro = [m for m in todos if m in mics]
            primeras = sorted(m["primera_negociacion"] for m in x["mercados"] if m.get("primera_negociacion"))
            w.writerow([x["isin"], x.get("nombre") or "", x.get("cfi") or "", x.get("tipo") or "",
                        x.get("divisa") or "", x.get("lei") or "", ";".join(todos), ";".join(dentro),
                        primeras[0] if primeras else "",
                        esma_firds.baja_en_todos(x["mercados"], hoy) or "",
                        "si" if x["isin"] in universo else "no", universo.get(x["isin"], "")])
            por_tipo[x.get("tipo") or "?"] = por_tipo.get(x.get("tipo") or "?", 0) + 1
            for m in dentro:
                por_mic[m] = por_mic.get(m, 0) + 1
    ya = sum(1 for x in filas if x["isin"] in universo)
    print(f"Universo FIRDS (completo {completo}): {len(filas)} candidatos en {', '.join(mics)}; "
          f"{ya} ya en el universo. No se ha dado de alta nada.")
    print("  por tipo: " + ", ".join(f"{k} {v}" for k, v in sorted(por_tipo.items())))
    print("  por centro: " + ", ".join(f"{k} {v}" for k, v in sorted(por_mic.items())))
    print(f"Lista -> {salida}")
    return 0


# --------------------------------------------------------------------- main
def main() -> int:
    configura_logging()
    p = argparse.ArgumentParser(prog="fondosdb", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    pu = sub.add_parser("update", help="descarga/actualiza datos")
    pu.add_argument("isins", nargs="*", help="ISINs concretos")
    pu.add_argument("--all", action="store_true", help="todos los de fondos.csv")
    pu.add_argument("--force", action="store_true", help="ignora la caché")
    pu.add_argument("--fuentes", help="lista separada por comas, p.ej. justetf")
    pu.add_argument("--sin-historico", action="store_true",
                    help="no añadir snapshot al histórico")
    pu.add_argument("--familias", help="solo refresca estas familias de dato "
                    "(p.ej. precio,rendimiento); el resto se sirve de caché "
                    f"aunque haya caducado. Familias: {', '.join(FAMILIAS)}")
    pu.add_argument("--sin-caducidad", action="store_true",
                    help="usa la caché aunque haya caducado (regenerar sin gastar red)")
    pu.add_argument("--sin-red", action="store_true",
                    help="no sale a red: lo que no esté en caché se da por ausente. "
                    "justETF (ficha completa) se sirve de cache/justetf_overview/ o, sin copia vigente, "
                    "se retiene la de la ficha anterior; yfinance y mstarpy se omiten. "
                    "Para regenerar algo que se va a publicar, junto con --sin-caducidad")
    pu.add_argument("--sin-firds", action="store_true",
                    help="sigue aunque falte el índice FIRDS (cache/firds/firds.sqlite): "
                    "ESCRIBE LAS FICHAS SIN IDENTIDAD FIRDS (CFI, LEI, mercados UE), también "
                    "las que ya la tenían. Sin ella, update se para (decisión 57)")
    pu.set_defaults(fn=cmd_update)

    pa = sub.add_parser("add", help="añade uno o varios ISINs (resuelve "
                                    "nombre/tipo automáticamente)")
    pa.add_argument("isins", nargs="+", help="ISIN1 ISIN2 ...")
    pa.add_argument("--nombre", default="", help="solo con un único ISIN")
    pa.add_argument("--tipo", default="fondo",
                    choices=["fondo", "etf", "accion", "indice"])
    pa.set_defaults(fn=cmd_add)

    pc = sub.add_parser("cnmv", help="descarga y procesa los XML oficiales "
                                     "CNMV para los fondos ES de fondos.csv")
    pc.add_argument("--ano", type=int, help="ejercicio, p.ej. 2026")
    pc.add_argument("--mes", type=int, choices=range(1, 13), metavar="1-12",
                    help="mes 1-12 (por defecto el último disponible)")
    pc.add_argument("--force", action="store_true", help="re-descarga el ZIP")
    pc.set_defaults(fn=cmd_cnmv)

    pv = sub.add_parser("visor", help="genera data/visor.html (visor local)")
    pv.set_defaults(fn=cmd_visor)

    pq = sub.add_parser("calidad", help="informes de calidad por fondo "
                                        "(reports/, sin red)")
    pq.set_defaults(fn=cmd_calidad)

    pe = sub.add_parser("export", help="export universal para BBDD: NDJSON + "
                                       "CSV plano + manifest (export/)")
    pe.set_defaults(fn=cmd_export)

    pf = sub.add_parser("figi", help="OpenFIGI: identificador global y "
                                     "mercado para posiciones sin ISIN")
    pf.set_defaults(fn=cmd_figi)

    pb = sub.add_parser("bdb", help="genera export_bdb/ con el esquema "
                                    "canónico de BDB-FONDOS (pieza aparte)")
    pb.add_argument("--destino", default="", help="carpeta de salida distinta de "
                    "export_bdb/ (para regenerar y comparar sin pisar el paquete vigente)")
    pb.set_defaults(fn=cmd_bdb)

    pse = sub.add_parser("series", help="exporta desde la caché, sin red, la serie de "
                                         "precios de cada ficha a export_series/")
    pse.set_defaults(fn=cmd_series)
    pfx = sub.add_parser("cambios", help="exporta a export_fx/ los cambios de referencia "
                                          "del BCE que necesitan las series")
    pfx.set_defaults(fn=cmd_cambios)

    pr = sub.add_parser("report", help="resumen de cobertura")
    pr.set_defaults(fn=cmd_report)

    pcn = sub.add_parser("contraste", help="fase 0: métricas propias (serie EODHD) frente a "
                         "las de Morningstar guardadas en meta.contraste (sin red)")
    pcn.set_defaults(fn=cmd_contraste)

    pcb = sub.add_parser("cobertura", help="fase 0: hojas fuera de Morningstar por bloque y "
                         "gestora, y frescura del VL (sin red)")
    pcb.set_defaults(fn=cmd_cobertura)

    pcap = sub.add_parser("capacidades", help="qué sabe dar cada adaptador; "
                          "--sin X responde «si cae X, ¿qué me queda?»")
    pcap.add_argument("--sin", default="", help="adaptadores caídos, separados por coma")
    pcap.add_argument("--ruta", default="", help="quién sabe dar una ruta del esquema")
    pcap.set_defaults(fn=cmd_capacidades)

    prc = sub.add_parser("reclasifica", help="corrige el tipo (accion/etf/fondo) "
                         "de los activos de mercado y huérfanos vía EODHD")
    prc.set_defaults(fn=cmd_reclasifica)

    pco = sub.add_parser("corrige", help="corrección manual de un campo suelto en origen "
                         "(config/correcciones.json): se aplica al extraer y viaja al canónico")
    pco.add_argument("isin", nargs="?", help="ISIN del activo")
    pco.add_argument("ruta", nargs="?", help="ruta del esquema v2, p.ej. riesgo.sri_kid_1a7")
    pco.add_argument("valor", nargs="?", help="valor nuevo (null borra el campo)")
    pco.add_argument("--motivo", default="", help="por qué se corrige y de dónde sale el dato (obligatorio)")
    pco.add_argument("--autor", default="", help="quién corrige (por defecto, el usuario del sistema)")
    pco.add_argument("--nueva", action="store_true", help="la ruta cae bajo un patrón genérico y el "
                     "activo no tiene ese campo: crearlo de verdad (protege de erratas)")
    pco.add_argument("--quitar", action="store_true", help="retira la corrección de esa ruta")
    pco.add_argument("--listar", action="store_true", help="lista las correcciones (de un ISIN si se indica)")
    pco.set_defaults(fn=cmd_corrige)

    pops = sub.add_parser("ops", help="servicio local de operaciones para la app "
                          "BDB-ACTIVOS (alta, extracción, canónico, plataforma)")
    pops.add_argument("--puerto", type=int, default=8766)
    pops.set_defaults(fn=cmd_ops)

    pfi = sub.add_parser("firds", help="construye o actualiza el índice local de ESMA FIRDS "
                         "(completo semanal + deltas diarios) en cache/firds/; --isin consulta sin red")
    pfi.add_argument("--fecha", default="", help="fecha de referencia YYYY-MM-DD (por defecto hoy)")
    pfi.add_argument("--force", action="store_true", help="re-descarga y reconstruye")
    pfi.add_argument("--sin-deltas", action="store_true", help="solo el completo semanal")
    pfi.add_argument("--isin", nargs="*", default=[], help="enseña lo que el índice dice de estos ISIN")
    pfi.set_defaults(fn=cmd_firds)

    pun = sub.add_parser("universo", help="candidatos de FIRDS por centro (MIC) y tipo CFI a "
                         "reports/universo_firds_<fecha>.csv. No da de alta nada")
    pun.add_argument("--mercados", default="", help="MIC separados por coma (por defecto los del "
                     "alcance de acciones que reportan a FIRDS)")
    pun.add_argument("--tipos", default="ACCION,ETF", help="ACCION, ETF, FONDO, DEUDA, OTRO")
    pun.add_argument("--fecha", default="", help="día de referencia de las bajas (por defecto hoy)")
    pun.add_argument("--incluir-bajas", action="store_true", help="también los centros ya dados de baja")
    pun.set_defaults(fn=cmd_universo)

    pem = sub.add_parser("emisores", help="emisores de las acciones por LEI (un LEI, un emisor): "
                         "GLEIF por cada LEI de export_bdb/ a export_entidades/emisores.json; "
                         "ids estables en config/emisores_lei.csv")
    pem.add_argument("--sin-red", action="store_true", help="solo caché HTTP; un LEI sin caché queda sin emisor")
    pem.add_argument("--sin-caducidad", action="store_true", help="la caché vale tenga la edad que tenga")
    pem.add_argument("--force", action="store_true", help="vuelve a preguntar a GLEIF aunque haya caché")
    pem.set_defaults(fn=cmd_emisores)

    ppl = sub.add_parser("planes", help="catálogo aparte de planes de pensiones y EPSV (D-11): la lista del "
                         "buscador de planes del banco y la serie de cada uno, a export_planes/planes.json")
    ppl.add_argument("--sin-red", action="store_true", help="solo caché HTTP; sin la lista en caché no escribe nada")
    ppl.add_argument("--sin-caducidad", action="store_true", help="la caché vale tenga la edad que tenga")
    ppl.add_argument("--sin-series", action="store_true", help="solo la lista, sin la serie de cada producto")
    ppl.add_argument("--force", action="store_true", help="vuelve a preguntar aunque haya caché")
    ppl.set_defaults(fn=cmd_planes)

    ptok = sub.add_parser("ops-token", help="imprime el token del servicio ops (lo crea si falta) "
                          "en una sola línea, para VITE_BDB_OPS_TOKEN de la app")
    ptok.set_defaults(fn=cmd_ops_token)

    args = p.parse_args()
    try:
        return args.fn(args)
    except ConfigBloqueada as e:          # cualquier orden que escriba en config/ (MEN-5)
        log.error("%s", e)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
