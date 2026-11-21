"""La plataforma de datos (`2-plataforma-datos`) desde el servicio de operaciones.

La plataforma es el único escritor de canónicos en la maestra Firestore y se
maneja por consola: `load:fondosdb` crea activos, `republish:fondosdb` refresca
los existentes, `reclassify:stock` pasa a acción un activo que la maestra tiene
como fondo, `audit:consistency` verifica y `backup:export` copia. Este
módulo los lanza como subprocesos desde el extractor, con la disciplina que
esas escrituras exigen (memoria del 03-09): **copia reciente, pasada en seco
con los números delante, escritura con el gate solo en el entorno de ese
proceso, y postverificación**.

No reimplementa nada de la plataforma: lee sus artefactos (`plan.json`,
`write_summary.json`, `republish_*.json`, `audit_summary.json`) y los resume
para la app. El gate `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` nunca sale de
aquí hacia la app ni hacia el navegador.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable

log = logging.getLogger("fondosdb.ops_plataforma")

Log = Callable[[str], None]

GATE = "BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES"
GATE_VALOR = "YES_I_UNDERSTAND_MASTER_DB_WRITES"
MODOS = ("alta", "republish")
# La alta crea la raíz, la cartera y el metrics/latest puente (ALTA-12, 14-10): sin
# él, el refresco de métricas de la app no calcula nunca el activo (solo actualiza
# documentos que existen) y el republish solo hace de puente si se le pide.
TARGETS_ALTA = "root,holdings,metrics"
SCRIPTS = ("load:fondosdb", "republish:fondosdb", "audit:consistency", "backup:export", "archive:assets",
           "reclassify:stock")
BACKUP_MAX_HORAS = 24.0
CARPETA_CORRIDAS = Path("reports") / "ops_runs"


class ErrorPlataforma(RuntimeError):
    pass


# ------------------------------------------------------------- localización
def localiza(base: Path, settings: dict | None = None) -> Path:
    ruta = (settings or {}).get("plataforma_dir")
    return Path(ruta) if ruta else Path(base).parent / "2-plataforma-datos"


def disponible(plataforma: Path) -> dict:
    """Qué hace falta para poder lanzar la plataforma, y qué falta."""
    pkg = plataforma / "package.json"
    scripts: dict = {}
    if pkg.exists():
        try:
            scripts = json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {})
        except ValueError:
            scripts = {}
    faltan = [s for s in SCRIPTS if s not in scripts]
    env = _lee_env_local(plataforma)
    return {
        "ruta": str(plataforma),
        "existe": plataforma.exists(),
        "scripts_ok": pkg.exists() and not faltan,
        "scripts_faltan": faltan,
        "node_modules": (plataforma / "node_modules").exists(),
        "npm": shutil.which(_npm()) is not None,
        "env_local": (plataforma / ".env.local").exists(),
        "proyecto": env.get("FIREBASE_PROJECT_ID"),
        "credenciales": bool(env.get("GOOGLE_APPLICATION_CREDENTIALS") or env.get("FIREBASE_SERVICE_ACCOUNT_PATH")),
    }


def _npm() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def _lee_env_local(plataforma: Path) -> dict[str, str]:
    """KEY=VALUE del .env.local de la plataforma (los scripts de la plataforma
    no lo cargan todos; el loader espera las variables en el entorno)."""
    out: dict[str, str] = {}
    ruta = plataforma / ".env.local"
    if not ruta.exists():
        return out
    for linea in ruta.read_text(encoding="utf-8-sig").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        k, v = linea.split("=", 1)
        out[k.strip()] = v.strip().strip("'\"")
    return out


def entorno(plataforma: Path, escribir: bool = False) -> dict[str, str]:
    """Entorno del subproceso: el del sistema + .env.local + credenciales
    resueltas. El gate de escritura solo si `escribir`, y nunca se guarda."""
    env = dict(os.environ)
    env.pop(GATE, None)
    env.update(_lee_env_local(plataforma))
    if not env.get("GOOGLE_APPLICATION_CREDENTIALS") and env.get("FIREBASE_SERVICE_ACCOUNT_PATH"):
        cred = Path(env["FIREBASE_SERVICE_ACCOUNT_PATH"])
        if not cred.is_absolute():
            cred = plataforma / cred
        env["GOOGLE_APPLICATION_CREDENTIALS"] = str(cred)
    env.pop("FIRESTORE_LIVE_READONLY", None) if escribir else None
    if escribir:
        env[GATE] = GATE_VALOR
    return env


# -------------------------------------------------------------- subprocesos
# Lo que `cmd.exe` interpreta dentro de un argumento. En Windows `npm` es `npm.cmd`, y un `.cmd`
# lo ejecuta `cmd.exe` aunque se lance sin shell: las comillas cierran el argumento, `&` y `|`
# encadenan otro comando, `%VAR%` se expande y `^` escapa. Auditoría del 16-11-2026 (EXT-4): con
# el motivo `x" & echo INYECTADO & "y`, el archivado ejecutaba el `echo` como comando aparte.
CARACTERES_DE_CMD = '"%&|<>^\r\n'


def argumento_seguro(texto: str) -> bool:
    """Si un argumento puede pasarse a `npm.cmd` sin que `cmd.exe` lo interprete."""
    return not any(c in CARACTERES_DE_CMD for c in texto)


def _mata_arbol(proc: subprocess.Popen) -> None:
    """Para el proceso y a sus hijos. `proc.kill()` solo mata a `npm.cmd`: el `node` que lanzó
    sigue vivo y, con el gate puesto, seguiría escribiendo sin que nadie lo vea (EXT-3)."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=30,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.SubprocessError):
            pass
    if proc.poll() is None:
        proc.kill()


def ejecuta(args: list[str], cwd: Path, env: dict[str, str], log_cb: Log | None = None,
            timeout: float = 3600.0) -> tuple[int, list[str]]:
    """Lanza `npm run <script> -- <args>` y vuelca su salida línea a línea.

    El plazo se cumple aunque el proceso no escriba nada: la salida se lee en un hilo y aquí se
    espera con reloj. Antes el plazo solo se miraba al recibir una línea, y un proceso atascado
    en silencio no se cortaba nunca: bloqueaba la cola, que solo admite una tarea (EXT-3)."""
    emite = log_cb or (lambda _t: None)
    peligroso = next((a for a in args if not argumento_seguro(a)), None)
    if peligroso is not None:
        raise ErrorPlataforma(
            f"argumento no admitido ({peligroso[:40]!r}): no puede llevar comillas, %, &, |, <, >, ^ ni saltos de línea")
    cmd = [_npm(), "run", *args]
    emite(f"$ {' '.join(cmd)}")
    lineas: list[str] = []
    proc = subprocess.Popen(cmd, cwd=str(cwd), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", bufsize=1,
                            shell=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    assert proc.stdout is not None
    salida: queue.Queue[str | None] = queue.Queue()

    def lee(tuberia=proc.stdout) -> None:
        try:
            for linea in tuberia:
                salida.put(linea)
        finally:
            salida.put(None)

    threading.Thread(target=lee, daemon=True).start()
    limite = time.monotonic() + timeout
    try:
        while True:
            resto = limite - time.monotonic()
            if resto <= 0:
                _mata_arbol(proc)
                raise ErrorPlataforma(f"la plataforma tardó más de {timeout:.0f} s; proceso abortado")
            try:
                linea = salida.get(timeout=min(resto, 1.0))
            except queue.Empty:
                continue
            if linea is None:
                break
            linea = linea.rstrip("\r\n")
            lineas.append(linea)
            emite(linea)
        codigo = proc.wait(timeout=60)
    finally:
        _mata_arbol(proc)
    return codigo, lineas


def _ruta_artefactos(lineas: list[str], out: Path, prefijo: str, desde: float) -> Path | None:
    for linea in reversed(lineas):
        if "artefactos en " in linea:
            ruta = Path(linea.split("artefactos en ", 1)[1].strip())
            if ruta.exists():
                return ruta
    candidatas = [p for p in out.glob(f"{prefijo}_*") if p.is_dir() and p.stat().st_mtime >= desde - 5]
    return max(candidatas, key=lambda p: p.stat().st_mtime) if candidatas else None


def _lee_json(ruta: Path):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _ids(isins: list[str]) -> str:
    return ",".join(dict.fromkeys(i.strip().upper() for i in isins if i.strip()))


def paquete_coherente(base: Path) -> dict:
    """export/ y export_bdb/ deben salir del mismo snapshot de data/funds: la
    plataforma lo comprueba por `package_id` y rechaza el paquete si no."""
    resumen = _lee_json(Path(base) / "export_bdb" / "_resumen.json") or {}
    manifest = _lee_json(Path(base) / "export" / "manifest.json") or {}
    a, b = resumen.get("package_id"), manifest.get("package_id")
    return {"coherente": bool(a) and a == b, "export_bdb": a, "export": b}


def _exige_paquete_coherente(base: Path) -> None:
    p = paquete_coherente(base)
    if not p["coherente"]:
        raise ErrorPlataforma(
            "export/ y export_bdb/ no salen del mismo snapshot (la plataforma rechazaría el paquete): "
            "regenera el canónico (paso «Canónico») antes de la pasada en seco.")


# ------------------------------------------------------------------ copia
def ultimo_backup(plataforma: Path) -> dict | None:
    raiz = plataforma / "data" / "backups"
    if not raiz.exists():
        return None
    carpetas = sorted((p for p in raiz.iterdir() if p.is_dir() and (p / "manifest.json").exists()), key=lambda p: p.name)
    if not carpetas:
        return None
    carpeta = carpetas[-1]
    manifest = _lee_json(carpeta / "manifest.json") or {}
    resumen = _lee_json(carpeta / "summary.json") or {}
    exportado = manifest.get("exported_at")
    edad_horas = None
    if exportado:
        try:
            momento = dt.datetime.fromisoformat(str(exportado).replace("Z", "+00:00"))
            if momento.tzinfo is None:
                momento = momento.replace(tzinfo=dt.timezone.utc)
            edad_horas = round((dt.datetime.now(dt.timezone.utc) - momento).total_seconds() / 3600, 1)
        except (ValueError, TypeError):
            edad_horas = None
    # Auditoría del 16-11-2026 (EXT-2). La copia daba permiso de escritura solo por su edad. El
    # manifiesto se escribe antes de verificar, así que una copia a medias, una que falló la
    # verificación, una de otro proyecto o una con fecha futura valían igual. Ahora tiene que
    # estar verificada (`summary.json` con PASS), ser del proyecto contra el que se escribe y
    # tener una fecha que ya haya pasado. `motivo` dice cuál de esas cosas falla.
    verificacion = resumen.get("verification") or manifest.get("verification")
    proyecto = manifest.get("project_id")
    destino = _lee_env_local(plataforma).get("FIREBASE_PROJECT_ID") or os.environ.get("FIREBASE_PROJECT_ID")
    if edad_horas is None:
        motivo = "la copia no dice cuándo se hizo"
    elif edad_horas < 0:
        motivo = "la fecha de la copia es posterior a hoy"
    elif edad_horas > BACKUP_MAX_HORAS:
        motivo = f"la copia tiene {edad_horas} h, más de {BACKUP_MAX_HORAS:.0f}"
    elif resumen.get("verification") != "PASS":
        motivo = "la copia no está verificada: falta summary.json con PASS"
    elif destino and proyecto != destino:
        motivo = f"la copia es del proyecto {proyecto or 'sin declarar'} y se escribe contra {destino}"
    else:
        motivo = None
    return {
        "ruta": str(carpeta), "exportado": exportado, "edad_horas": edad_horas,
        "registros": manifest.get("firestore_records"),
        "verificacion": verificacion,
        "proyecto": proyecto,
        "vigente": motivo is None,
        "motivo": motivo,
    }


def _porque(copia: dict | None) -> str:
    return f" ({copia['motivo']})" if copia and copia.get("motivo") else ""


def backup(plataforma: Path, log_cb: Log | None = None) -> dict:
    codigo, lineas = ejecuta(["backup:export"], plataforma, entorno(plataforma), log_cb)
    if codigo != 0:
        raise ErrorPlataforma(f"backup:export terminó con código {codigo}")
    copia = ultimo_backup(plataforma)
    if not copia:
        raise ErrorPlataforma("backup:export terminó pero no encuentro la copia en data/backups")
    return {"codigo": codigo, "copia": copia}


# --------------------------------------------------------- pasada en seco
def pasada_en_seco(base: Path, plataforma: Path, isins: list[str], modo: str,
                   log_cb: Log | None = None) -> dict:
    if modo not in MODOS:
        raise ErrorPlataforma(f"modo desconocido: {modo}")
    if not isins:
        raise ErrorPlataforma("sin ISIN")
    return _corre_plataforma(base, plataforma, isins, modo, escribir=False, log_cb=log_cb)


def _corre_plataforma(base: Path, plataforma: Path, isins: list[str], modo: str, escribir: bool,
                      log_cb: Log | None) -> dict:
    _exige_paquete_coherente(base)
    out = Path(base) / CARPETA_CORRIDAS
    out.mkdir(parents=True, exist_ok=True)
    ids = _ids(isins)
    if modo == "alta":
        args = ["load:fondosdb", "--", "--input", str(base), "--ids", ids, "--targets", TARGETS_ALTA,
                "--out", str(out), "--write" if escribir else "--dry-run"]
        prefijo = "loader"
    else:
        args = ["republish:fondosdb", "--", "--input", str(base), "--ids", ids, "--out", str(out),
                "--write" if escribir else "--dry-run"]
        prefijo = "republish"
    inicio = time.time()
    codigo, lineas = ejecuta(args, plataforma, entorno(plataforma, escribir=escribir), log_cb)
    carpeta = _ruta_artefactos(lineas, out, prefijo, inicio)
    resultado = {"modo": modo, "escribir": escribir, "codigo": codigo, "isins": ids.split(","),
                 "carpeta": str(carpeta) if carpeta else None, "salida": lineas[-40:]}
    # El resumen que la plataforma deja al terminar de verdad. Si no está, la
    # corrida se cortó antes (p. ej. paquete rechazado): eso es un fallo, no
    # «sin cambios».
    resumen_esperado = ("write_summary.json" if escribir else "plan.json") if modo == "alta" else "republish_summary.json"
    if carpeta is None or not (carpeta / resumen_esperado).exists():
        detalle = " | ".join(x for x in lineas[-6:] if x.strip())
        raise ErrorPlataforma(f"la plataforma terminó con código {codigo} sin dejar {resumen_esperado}: {detalle}")
    if modo == "alta":
        resultado.update(_resume_loader(carpeta, resultado["isins"], escribir))
    else:
        resultado.update(_resume_republish(carpeta, resultado["isins"], escribir))
    if codigo != 0:
        # Con resumen y código distinto de cero (errores o postverify fallido
        # en una escritura): se devuelve todo, marcado como error.
        resultado["error"] = f"la plataforma terminó con código {codigo}: revisa errores y postverificación"
        if not escribir:
            raise ErrorPlataforma(resultado["error"] + " · " + " | ".join(x for x in lineas[-4:] if x.strip()))
    return resultado


def _documentos(item: dict) -> list[str] | None:
    """Documentos que la alta crea para el activo. Los da la plataforma
    (`documents`, desde la pasada en seco que valida todos); con una plataforma
    anterior se deducen del plan: raíz, cartera si la hay y metrics/latest."""
    if isinstance(item.get("documents"), list):
        return [str(d) for d in item["documents"]]
    if item.get("action") != "CREATE":
        return None
    docs = [item.get("root_path") or f"assets/{item.get('asset_id')}"]
    if item.get("holdings_path"):
        docs.append(item["holdings_path"])
    docs.append(f"assets/{item.get('asset_id')}/metrics/latest")
    return docs


def _resume_loader(carpeta: Path, isins: list[str], escribir: bool) -> dict:
    plan = _lee_json(carpeta / "plan.json") or {}
    por_isin = {i.get("asset_id"): i for i in plan.get("items", [])}
    filas = []
    for isin in isins:
        item = por_isin.get(isin)
        if not item:
            filas.append({"isin": isin, "accion": "SIN_PLAN", "motivos": ["no aparece en el plan de la plataforma"]})
            continue
        filas.append({
            "isin": isin, "accion": item.get("action"),
            "motivos": [*item.get("review_reasons", []), *item.get("reject_reasons", []),
                        *[str(e)[:200] for e in item.get("contract_errors", [])]],
            "documentos": _documentos(item) if item.get("action") == "CREATE" else [],
        })
    counts = plan.get("counts") or {}
    crear = [f["isin"] for f in filas if f["accion"] == "CREATE"]
    out = {
        "run_id": plan.get("run_id"),
        "recuento": counts,
        # Se aprueba por activos a crear; cada uno lleva sus documentos (raíz,
        # cartera y metrics/latest puente) en un único batch create-only.
        "escrituras": int(counts.get("CREATE", 0) or 0),
        "crear": crear,
        "documentos": sum(len(f.get("documentos") or []) for f in filas),
        "targets": TARGETS_ALTA,
        "validacion_paquete": (plan.get("package_validation") or {}).get("status"),
        "incidencias_paquete": len((plan.get("package_validation") or {}).get("issues", [])),
        "filas": filas,
    }
    if escribir:
        resumen = _lee_json(carpeta / "write_summary.json") or {}
        out["escritura"] = {
            "escritos": resumen.get("writes_executed"), "ya_existian": resumen.get("skipped_existing"),
            "postverify_ok": resumen.get("postverify_ok"), "postverify_fallidos": resumen.get("postverify_failed"),
            "errores": resumen.get("errors", []),
        }
    return out


def _accion_republish(operaciones: list) -> str:
    """Qué hace el republish con un activo, según las operaciones de su fila.

    No todas las filas de `republish_plan.json` se escriben: la plataforma deja
    ahí también las que aparta, con operaciones `hold:*` (p. ej.
    `hold:stock_not_ready`, una acción que el extractor no da por lista) o
    `review:*` (`review:canonical_invalid`). Hasta el 17-10 todas salían como
    «REPUBLICAR» y el panel engañaba (revisión de la plataforma, H2). Ni las
    retenidas ni las de revisión cuentan en `to_republish`."""
    ops = [str(o) for o in operaciones or []]
    if ops and all(o.startswith(("hold:", "review:")) for o in ops):
        return "REVISION" if any(o.startswith("review:") for o in ops) else "RETENIDA"
    return "REPUBLICAR"


def _resume_republish(carpeta: Path, isins: list[str], escribir: bool) -> dict:
    plan = _lee_json(carpeta / "republish_plan.json") or []
    resumen = _lee_json(carpeta / "republish_summary.json") or {}
    por_isin = {i.get("asset_id"): i for i in plan if isinstance(i, dict)}
    filas = []
    for isin in isins:
        item = por_isin.get(isin)
        if not item:
            filas.append({"isin": isin, "accion": "SIN_CAMBIOS", "operaciones": [], "campos": []})
            continue
        filas.append({"isin": isin, "accion": _accion_republish(item.get("operations")),
                      "operaciones": item.get("operations", []),
                      "campos": item.get("drift_fields", []), "rutas": item.get("drift_paths", [])[:30]})
    otros = [i.get("asset_id") for i in plan if isinstance(i, dict) and i.get("asset_id") not in isins]
    out = {
        "run_id": resumen.get("run_id"),
        "recuento": {k: resumen.get(k) for k in ("checked", "matched", "to_republish", "root_to_republish",
                                                  "metrics_to_set", "holdings_stale", "search_index_to_set",
                                                  "canonical_invalid", "live_missing", "reclassified")},
        # Lo que se aprueba es `to_republish` de la plataforma, que no cuenta ni
        # las retenidas ni las de revisión.
        "escrituras": int(resumen.get("to_republish") or 0),
        "retenidas": [f["isin"] for f in filas if f["accion"] == "RETENIDA"],
        "en_revision": [f["isin"] for f in filas if f["accion"] == "REVISION"],
        "otros_en_plan": otros,   # p. ej. meta/search_index
        "filas": filas,
    }
    if escribir:
        out["escritura"] = {
            "republicados": resumen.get("republished"), "metricas": resumen.get("metrics_set"),
            "holdings": resumen.get("holdings_set"), "search_index": resumen.get("search_index_set"),
            "postverify_ok": resumen.get("postverify_ok"), "postverify_fallidos": resumen.get("postverify_failed"),
            "errores": resumen.get("errors", []),
        }
    return out


# ----------------------------------------------------------------- escribir
def escribir(base: Path, plataforma: Path, isins: list[str], modo: str, esperado: int,
             log_cb: Log | None = None, exigir_backup: bool = True,
             esperados: list[str] | None = None) -> dict:
    """Escribe en la maestra tras comprobar, en el momento, la copia y el recuento.

    Se repite la pasada en seco justo antes: si el número de escrituras ya no
    es el que aprobó quien tecleó el recuento, no se escribe nada.

    En la alta solo se manda a escribir lo que esa pasada da por CREATE (y, si se
    pasa `esperados`, tiene que ser exactamente lo aprobado): los que ya existen
    no se tocan, ni siquiera para completarles un documento que les falte, porque
    eso no lo cuenta el recuento aprobado.
    """
    emite = log_cb or (lambda _t: None)
    if modo not in MODOS:
        raise ErrorPlataforma(f"modo desconocido: {modo}")
    if exigir_backup:
        copia = ultimo_backup(plataforma)
        if not copia or not copia.get("vigente"):
            raise ErrorPlataforma(f"no hay copia de la maestra de las últimas 24 horas{_porque(copia)}: haz la copia antes de escribir")
        emite(f"Copia vigente: {copia['ruta']} ({copia['edad_horas']} h)")
    emite("Repito la pasada en seco antes de escribir…")
    seco = pasada_en_seco(base, plataforma, isins, modo, log_cb)
    if seco["escrituras"] != int(esperado):
        raise ErrorPlataforma(
            f"la pasada en seco de ahora prevé {seco['escrituras']} escrituras y se aprobaron {esperado}: no escribo. "
            "Vuelve a la pasada en seco y aprueba el recuento nuevo.")
    objetivo = isins
    if modo == "alta":
        objetivo = list(seco.get("crear") or [])
        if esperados is not None and sorted(objetivo) != sorted(esperados):
            raise ErrorPlataforma(
                f"la pasada en seco de ahora crearía {', '.join(objetivo) or 'nada'} y se aprobó "
                f"{', '.join(esperados) or 'nada'}: no escribo. Vuelve a la pasada en seco.")
    if seco["escrituras"] == 0:
        return {"seco": seco, "escritura": None, "auditoria": None, "mensaje": "nada que escribir"}
    emite(f"Escribiendo {seco['escrituras']} activo(s) en la maestra (gate solo en este proceso)…")
    resultado = _corre_plataforma(base, plataforma, objetivo, modo, escribir=True, log_cb=log_cb)
    auditoria = None
    try:
        auditoria = auditar(base, plataforma, isins, log_cb)
    except ErrorPlataforma as e:
        emite(f"AVISO: la auditoría posterior falló: {e}")
    return {"seco": seco, "escritura": resultado, "auditoria": auditoria}


# ----------------------------------------------------------------- auditar
def auditar(base: Path, plataforma: Path, isins: list[str], log_cb: Log | None = None) -> dict:
    out = Path(base) / CARPETA_CORRIDAS
    out.mkdir(parents=True, exist_ok=True)
    ids = _ids(isins)
    inicio = time.time()
    codigo, lineas = ejecuta(["audit:consistency", "--", "--input", str(base), "--ids", ids, "--out", str(out)],
                             plataforma, entorno(plataforma), log_cb)
    carpeta = _ruta_artefactos(lineas, out, "audit", inicio)
    if carpeta is None:
        raise ErrorPlataforma(f"audit:consistency terminó con código {codigo} y sin artefactos")
    resumen = _lee_json(carpeta / "audit_summary.json") or {}
    drifts = _lee_json(carpeta / "drifts.json") or []
    holdings = _lee_json(carpeta / "holdings_drifts.json") or []
    pedidos = set(ids.split(","))
    desvios = [d for d in drifts if isinstance(d, dict) and (d.get("asset_id") in pedidos or not pedidos)]
    return {
        "codigo": codigo, "carpeta": str(carpeta), "run_id": resumen.get("run_id"),
        "resumen": {k: v for k, v in resumen.items() if not isinstance(v, (list, dict))},
        "desvios": len(desvios), "detalle": desvios[:50],
        "holdings_desviados": len([h for h in holdings if isinstance(h, dict) and h.get("asset_id") in pedidos]) if pedidos else len(holdings),
        "en_cero": len(desvios) == 0,
        "salida": lineas[-20:],
    }


# ----------------------------------------------------------------- archivar
def archivar(base: Path, plataforma: Path, isins: list[str], escribir: bool = False, motivo: str = "",
             log_cb: Log | None = None, esperado: int | None = None, exigir_backup: bool = True) -> dict:
    """`archive:assets` de la plataforma: pasada en seco (qué hay) o archivo real.

    Archivar es copiar cada activo a `_archived_assets` (y a un fichero local
    restaurable) y retirarlo de `assets` y del índice de búsqueda. Con `escribir`
    se exige copia vigente de la maestra y se repite la pasada en seco antes: si
    el número de activos a archivar no es el aprobado (`esperado`), no se toca nada.
    """
    emite = log_cb or (lambda _t: None)
    ids = _ids(isins)
    if not ids:
        raise ErrorPlataforma("sin ISIN")
    if not argumento_seguro(motivo):
        raise ErrorPlataforma("el motivo no puede llevar comillas, %, &, |, <, >, ^ ni saltos de línea: escríbelo sin ellos")
    if escribir:
        if exigir_backup:
            copia = ultimo_backup(plataforma)
            if not copia or not copia.get("vigente"):
                raise ErrorPlataforma(f"no hay copia de la maestra de las últimas 24 horas{_porque(copia)}: haz la copia antes de archivar")
            emite(f"Copia vigente: {copia['ruta']} ({copia['edad_horas']} h)")
        emite("Repito la pasada en seco antes de archivar…")
        seco = archivar(base, plataforma, isins, escribir=False, motivo=motivo, log_cb=log_cb)
        if esperado is None or seco["archivables"] != int(esperado):
            raise ErrorPlataforma(
                f"la pasada en seco de ahora encuentra {seco['archivables']} activo(s) y se aprobaron {esperado}: no archivo. "
                "Vuelve a la pasada en seco y aprueba el recuento nuevo.")
        if seco["archivables"] == 0:
            return {**seco, "mensaje": "nada que archivar"}
        emite(f"Archivando {seco['archivables']} activo(s) en la maestra (gate solo en este proceso)…")
    out = Path(base) / CARPETA_CORRIDAS
    out.mkdir(parents=True, exist_ok=True)
    args = ["archive:assets", "--", "--ids", ids, "--out", str(out), "--write" if escribir else "--dry-run"]
    if motivo.strip():
        args += ["--reason", " ".join(motivo.split())]
    inicio = time.time()
    codigo, lineas = ejecuta(args, plataforma, entorno(plataforma, escribir=escribir), log_cb)
    carpeta = _ruta_artefactos(lineas, out, "archive", inicio)
    if carpeta is None or not (carpeta / "archive_summary.json").exists():
        detalle = " | ".join(x for x in lineas[-6:] if x.strip())
        raise ErrorPlataforma(f"la plataforma terminó con código {codigo} sin dejar archive_summary.json: {detalle}")
    resumen = _lee_json(carpeta / "archive_summary.json") or {}
    plan = _lee_json(carpeta / "archive_plan.json") or []
    por_isin = {r.get("asset_id"): r for r in plan if isinstance(r, dict)}
    filas = []
    for isin in ids.split(","):
        r = por_isin.get(isin) or {}
        filas.append({
            "isin": isin, "accion": r.get("action") or "SIN_PLAN", "existe": bool(r.get("exists")),
            "nombre": r.get("name"), "tipo": r.get("type"), "subdocs": int(r.get("subdocs") or 0),
            "en_indice": bool(r.get("in_search_index")), "copia_previa": bool(r.get("archived_copy_exists")),
            "postverify": r.get("postverify"),
        })
    resultado = {
        "modo": "archivar", "escribir": escribir, "codigo": codigo, "isins": ids.split(","),
        "carpeta": str(carpeta), "run_id": resumen.get("run_id"), "motivo": resumen.get("reason") or "",
        "recuento": {k: resumen.get(k) for k in ("requested", "found", "subdocs_total", "in_search_index")},
        "no_existen": list(resumen.get("missing") or []),
        "archivables": int(resumen.get("found") or 0),
        "filas": filas, "salida": lineas[-40:],
    }
    if escribir:
        resultado["escritura"] = {
            "archivados": resumen.get("archived"), "subdocs_copiados": resumen.get("subdocs_copied"),
            "borrados": resumen.get("docs_deleted"), "indice_retirados": resumen.get("search_index_removed"),
            "postverify_ok": resumen.get("postverify_ok"), "postverify_fallidos": resumen.get("postverify_failed"),
            "copias": list(resumen.get("backups") or []), "errores": list(resumen.get("errors") or []),
        }
    if codigo != 0:
        resultado["error"] = f"la plataforma terminó con código {codigo}: revisa errores y postverificación"
        if not escribir:
            raise ErrorPlataforma(resultado["error"] + " · " + " | ".join(x for x in lineas[-4:] if x.strip()))
    return resultado


# ------------------------------------------------------------- reclasificar
def reclasificar(base: Path, plataforma: Path, isins: list[str], escribir: bool = False,
                 log_cb: Log | None = None, esperado: int | None = None,
                 esperados: list[str] | None = None, exigir_backup: bool = True) -> dict:
    """`reclassify:stock` de la plataforma: pasa a acción en la maestra lo que el
    canónico ya da por acción y la maestra sigue teniendo como fondo (ALTA-13).

    Cambiar el tipo en fondos.csv no basta: la alta salta el activo porque ya
    existe y el republish lo aparta como reclasificado. La plataforma reescribe la
    raíz como acción (sin los bloques de fondo), invalida metrics/latest para que
    la app lo recalcule como acción y cambia su entrada del buscador.

    Misma disciplina que las demás escrituras: copia de menos de 24 h, pasada en
    seco repetida justo antes con el recuento (y los ISIN) aprobados, gate solo en
    el subproceso que escribe y postverificación de la plataforma más auditoría.
    """
    emite = log_cb or (lambda _t: None)
    ids = _ids(isins)
    if not ids:
        raise ErrorPlataforma("sin ISIN")
    if escribir:
        if exigir_backup:
            copia = ultimo_backup(plataforma)
            if not copia or not copia.get("vigente"):
                raise ErrorPlataforma(f"no hay copia de la maestra de las últimas 24 horas{_porque(copia)}: haz la copia antes de reclasificar")
            emite(f"Copia vigente: {copia['ruta']} ({copia['edad_horas']} h)")
        emite("Repito la pasada en seco antes de reclasificar…")
        seco = reclasificar(base, plataforma, isins, escribir=False, log_cb=log_cb)
        objetivo = [f["isin"] for f in seco["filas"] if f["accion"] in ACCIONES_RECLASIFICACION]
        if esperado is None or seco["reclasificables"] != int(esperado):
            raise ErrorPlataforma(
                f"la pasada en seco de ahora reclasificaría {seco['reclasificables']} activo(s) y se aprobaron {esperado}: "
                "no escribo. Vuelve a la pasada en seco y aprueba el recuento nuevo.")
        if esperados is not None and sorted(objetivo) != sorted(esperados):
            raise ErrorPlataforma(
                f"la pasada en seco de ahora reclasificaría {', '.join(objetivo) or 'nada'} y se aprobó "
                f"{', '.join(esperados) or 'nada'}: no escribo.")
        if not objetivo:
            return {**seco, "mensaje": "nada que reclasificar"}
        emite(f"Reclasificando {len(objetivo)} activo(s) en la maestra (gate solo en este proceso)…")
        ids = _ids(objetivo)
    else:
        _exige_paquete_coherente(base)
    out = Path(base) / CARPETA_CORRIDAS
    out.mkdir(parents=True, exist_ok=True)
    args = ["reclassify:stock", "--", "--input", str(base), "--ids", ids, "--out", str(out),
            "--write" if escribir else "--dry-run"]
    inicio = time.time()
    codigo, lineas = ejecuta(args, plataforma, entorno(plataforma, escribir=escribir), log_cb)
    carpeta = _ruta_artefactos(lineas, out, "reclassify", inicio)
    if carpeta is None or not (carpeta / "reclassify_summary.json").exists():
        detalle = " | ".join(x for x in lineas[-6:] if x.strip())
        raise ErrorPlataforma(f"la plataforma terminó con código {codigo} sin dejar reclassify_summary.json: {detalle}")
    resumen = _lee_json(carpeta / "reclassify_summary.json") or {}
    filas = _filas_reclasificacion(ids.split(","), resumen, _lee_json(carpeta / "reclassify_plan.json"))
    resultado = {
        "modo": "reclasificar", "escribir": escribir, "codigo": codigo, "isins": ids.split(","),
        "carpeta": str(carpeta), "run_id": resumen.get("run_id"),
        "recuento": {"pedidos": len(ids.split(",")),
                     "a_reclasificar": sum(1 for f in filas if f["accion"] == "RECLASSIFY"),
                     "a_reparar": sum(1 for f in filas if f["accion"] == "REPAIR"),
                     "omitidos": sum(1 for f in filas if f["accion"] == "SKIP"),
                     "errores": sum(1 for f in filas if f["accion"] == "ERROR")},
        # Lo que se aprueba: reclasificaciones y reparaciones de lo que ya es acción.
        "reclasificables": sum(1 for f in filas if f["accion"] in ACCIONES_RECLASIFICACION),
        "carteras_colgando": [{"isin": h.get("asset_id"), "rutas": list(h.get("paths") or [])}
                              for h in resumen.get("holdings_left") or []],
        "metricas_de_fondo": list(resumen.get("metrics_fund_left") or []),
        "filas": filas, "salida": lineas[-40:],
    }
    if escribir:
        resultado["escritura"] = {
            "escritos": resumen.get("written"), "reparados": resumen.get("repaired"),
            "metricas_invalidadas": resumen.get("metrics_marked"),
            "indice_escrito": resumen.get("search_index_written"),
            "postverify_ok": resumen.get("postverify_ok"), "postverify_fallidos": resumen.get("postverify_failed"),
            "errores": list(resumen.get("errors") or []),
        }
        try:
            resultado["auditoria"] = auditar(base, plataforma, ids.split(","), log_cb)
        except ErrorPlataforma as e:
            emite(f"AVISO: la auditoría posterior falló: {e}")
            resultado["auditoria"] = None
    if codigo != 0:
        resultado["error"] = f"la plataforma terminó con código {codigo}: revisa errores y postverificación"
        if not escribir:
            raise ErrorPlataforma(resultado["error"] + " · " + " | ".join(x for x in lineas[-4:] if x.strip()))
    return resultado


# Acciones del plan de reclassify:stock que escriben (y cuentan en el recuento aprobado).
ACCIONES_RECLASIFICACION = ("RECLASSIFY", "REPAIR")

_MOTIVOS_RECLASIFICACION = {
    "NO_STOCK_CANONICAL": "el canónico no lo da por acción: extrae y regenera el canónico tras cambiar el tipo",
    "NOT_IN_MASTER": "no está en la maestra: es una alta, no una reclasificación",
    "ALREADY_STOCK": "la maestra ya lo tiene como acción",
    "NOT_READY": "la alta lo bloquearía",
    "REVIEW_HOLD": "retenido para revisión, como en la alta",
}

_REPARACIONES = {"search_index": "el buscador aún lo da por fondo", "metrics_latest": "conserva métricas de fondo"}

# Errores de la plataforma, en el idioma de la pantalla; el texto original va aparte (`error`).
_ERRORES_RECLASIFICACION = (
    ("RECLASSIFY_CONCURRENT_MODIFICATION", "la ficha o sus métricas cambiaron mientras se reclasificaba: no se escribió nada; repite la pasada en seco"),
    ("RECLASSIFY_PRECONDITION_MISSING", "la lectura de la maestra no permite escribir con seguridad: no se escribió nada"),
    ("RECLASSIFY_UNSAFE_FIELD", "la ficha tiene un campo que no se puede reescribir con seguridad"),
    ("no valida master.asset-stock", "la ficha de acción no cumple el contrato de la maestra"),
    ("no valida metrics", "el documento de métricas no cumple el contrato de la maestra"),
    ("postverify", "la comprobación posterior no encontró el activo como acción"),
    ("SEARCH_INDEX_CONCURRENT_MODIFICATION", "el buscador cambió mientras se actualizaba y no se pudo escribir"),
    ("meta/search_index no valida", "el buscador resultante no cumple el contrato de la maestra"),
)


def mensaje_error_reclasificacion(error: str | None) -> str:
    texto = str(error or "")
    for clave, mensaje in _ERRORES_RECLASIFICACION:
        if clave in texto:
            return mensaje
    return "la plataforma no pudo reclasificarlo" if texto else ""


def _filas_reclasificacion(isins: list[str], resumen: dict, plan) -> list[dict]:
    """Una fila por ISIN pedido. Con `reclassify_plan.json` (plataforma desde el
    14-10) sale de ahí; si no, del resumen (lista de reclasificados y errores)."""
    por_isin: dict[str, dict] = {}
    if isinstance(plan, list):
        por_isin = {r.get("asset_id"): r for r in plan if isinstance(r, dict)}
    else:
        for r in resumen.get("reclassified") or []:
            por_isin[r.get("asset_id")] = {**r, "action": "RECLASSIFY"}
        for r in resumen.get("skipped_items") or []:
            por_isin.setdefault(r.get("asset_id"), {"action": "SKIP", "reason": r.get("reason")})
        for r in resumen.get("errors") or []:
            por_isin[r.get("asset_id")] = {"action": "ERROR", "error": r.get("error")}
    filas = []
    for isin in isins:
        r = por_isin.get(isin) or {"action": "SKIP", "reason": None}
        accion = r.get("action") or "SKIP"
        bloqueos = list(r.get("blockers") or [])
        if accion == "ERROR":
            motivo = mensaje_error_reclasificacion(r.get("error"))
        elif accion == "REPAIR":
            motivo = "ya es acción, pero " + " y ".join(_REPARACIONES.get(x, x) for x in r.get("repairs") or [])
        else:
            motivo = _MOTIVOS_RECLASIFICACION.get(r.get("reason") or "", r.get("reason") or "")
            if bloqueos:
                motivo = f"{motivo}: {', '.join(bloqueos)}"
        filas.append({
            "isin": isin, "accion": accion, "razon": r.get("reason"), "motivo": motivo or "",
            "error": r.get("error") if accion == "ERROR" else None,
            "de": r.get("from"), "a": r.get("to"), "quita": list(r.get("dropped") or []),
            "metricas": r.get("metrics_latest"), "indice": r.get("search_index"),
            "reparaciones": list(r.get("repairs") or []), "bloqueos": bloqueos,
            "avisos": list(r.get("warnings") or []), "cartera_colgando": list(r.get("holdings_left") or []),
            "postverify": r.get("postverify"),
        })
    return filas


def corridas(base: Path, limite: int = 20) -> list[dict]:
    """Últimas corridas de plataforma lanzadas desde aquí, con su resumen."""
    out = Path(base) / CARPETA_CORRIDAS
    if not out.exists():
        return []
    filas = []
    for p in sorted((p for p in out.iterdir() if p.is_dir()), key=lambda p: p.name, reverse=True)[:limite]:
        tipo = p.name.split("_", 1)[0]
        resumen = None
        for nombre in ("write_summary.json", "republish_summary.json", "audit_summary.json", "archive_summary.json",
                       "reclassify_summary.json", "plan.json"):
            if (p / nombre).exists():
                datos = _lee_json(p / nombre) or {}
                resumen = {k: v for k, v in datos.items() if not isinstance(v, (list, dict))}
                resumen["_fichero"] = nombre
                break
        filas.append({"carpeta": str(p), "tipo": tipo, "resumen": resumen})
    return filas


if __name__ == "__main__":  # pragma: no cover - diagnóstico manual
    base_ = Path(__file__).resolve().parents[1]
    print(json.dumps(disponible(localiza(base_)), indent=1, ensure_ascii=False))
    print(json.dumps(ultimo_backup(localiza(base_)), indent=1, ensure_ascii=False))
    sys.exit(0)
