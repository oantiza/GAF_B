"""Operaciones del extractor como servicio: alta, extracción y canónico.

Hasta el 05-09 dar de alta un activo y llevarlo a la maestra pasaba por tres
programas (la web del extractor, la consola de la plataforma y la app). Este
módulo reúne los trabajos que la interfaz web (`app.py`) ya sabía hacer y los
expone para que el servicio `python main.py ops` los sirva a la app
(`3-BDB-ACTIVOS_app`, Sistema › Operaciones). Una sola implementación para las
dos interfaces: lo que hace `app.py` y lo que hace la app es lo mismo.

Trabajos (en segundo plano, uno a la vez, con registro en vivo):

- `alta`: resuelve nombre y tipo de cada ISIN y lo añade al universo
  (`config/fondos.csv`). No descarga nada más.
- `extrae`: pasada del extractor solo para esos ISIN (`core.update.ejecuta_pipeline`,
  la única vía de recolección) y reconstrucción del índice.
- `canonico`: regenera `export_bdb/` y `export/` completos. Los dos paquetes
  comparten el `package_id` derivado de `data/funds/`; regenerar solo una parte
  dejaría el manifiesto fuerte que exige la plataforma desincronizado.

Consultas (inmediatas): `estado`, `lista_universo`, `ficha_resumen`,
`canonico_resumen`.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import logging
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Callable

from core.package_integrity import BLOQUEO_CONFIG, bloqueo_config  # noqa: F401 (BLOQUEO_CONFIG: tests)

log = logging.getLogger("fondosdb.ops")

RE_ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
RE_ISIN_SUELTO = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b")
TIPOS = ("fondo", "etf", "accion", "indice")
MAX_TAREAS = 30
MAX_LOG = 2000

Log = Callable[[str], None]


def extrae_isins(texto: str | None, isins: list | None = None) -> list[str]:
    """ISIN únicos, en mayúsculas y en orden de aparición, de un texto libre o de una lista."""
    vistos: dict[str, None] = {}
    for candidato in list(isins or []) + RE_ISIN_SUELTO.findall((texto or "").upper()):
        isin = str(candidato).strip().upper()
        if RE_ISIN.match(isin):
            vistos.setdefault(isin, None)
    return list(vistos)


# ------------------------------------------------------------------ tareas
class Tarea:
    """Un trabajo en segundo plano con su registro, su progreso y su resultado."""

    def __init__(self, nombre: str, parametros: dict | None = None):
        self.id = f"{dt.datetime.now():%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:6]}"
        self.nombre = nombre
        self.parametros = parametros or {}
        self.estado = "en_curso"
        self.inicio = time.time()
        self.fin: float | None = None
        self.log: list[str] = []
        self.progreso: dict = {"actual": 0, "total": 0, "isin": ""}
        self.resultado: dict | list | None = None
        self.error: str | None = None
        self._lock = threading.Lock()

    def linea(self, txt: str) -> None:
        with self._lock:
            if len(self.log) < MAX_LOG:
                self.log.append(str(txt))
            elif len(self.log) == MAX_LOG:
                self.log.append("… (registro truncado)")

    def avanza(self, actual: int | None = None, total: int | None = None, isin: str | None = None) -> None:
        with self._lock:
            if actual is not None:
                self.progreso["actual"] = actual
            if total is not None:
                self.progreso["total"] = total
            if isin is not None:
                self.progreso["isin"] = isin

    def snapshot(self, desde: int = 0) -> dict:
        with self._lock:
            return {
                "id": self.id, "nombre": self.nombre, "parametros": self.parametros,
                "estado": self.estado, "inicio": _iso(self.inicio), "fin": _iso(self.fin),
                "segundos": round((self.fin or time.time()) - self.inicio, 1),
                "progreso": dict(self.progreso),
                "log_total": len(self.log), "log": self.log[max(desde, 0):],
                "resultado": self.resultado, "error": self.error,
            }


class Cola:
    """Una tarea a la vez: el extractor comparte caché y ritmo por dominio, y la
    maestra no admite dos escrituras solapadas."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.tareas: dict[str, Tarea] = {}
        self.en_curso: Tarea | None = None

    def lanza(self, nombre: str, fn: Callable[[Tarea], dict | list | None],
              parametros: dict | None = None) -> Tarea | None:
        with self._lock:
            if self.en_curso is not None and self.en_curso.estado == "en_curso":
                return None
            tarea = Tarea(nombre, parametros)
            self.en_curso = tarea
            self.tareas[tarea.id] = tarea
            while len(self.tareas) > MAX_TAREAS:
                del self.tareas[next(iter(self.tareas))]

        def envoltura() -> None:
            manejador = _CapturaLog(tarea)
            raiz = logging.getLogger()
            nivel_previo = raiz.level
            raiz.addHandler(manejador)
            if raiz.level > logging.INFO or raiz.level == logging.NOTSET:
                raiz.setLevel(logging.INFO)
            try:
                tarea.resultado = fn(tarea)
                tarea.estado = "hecha"
            except Exception as e:  # noqa: BLE001 - la tarea informa, no tumba el servicio
                tarea.error = str(e)
                tarea.estado = "error"
                tarea.linea(f"ERROR: {e}")
                log.exception("ops %s (%s)", nombre, tarea.id)
            finally:
                tarea.fin = time.time()
                raiz.removeHandler(manejador)
                raiz.setLevel(nivel_previo)

        threading.Thread(target=envoltura, name=f"ops-{tarea.id}", daemon=True).start()
        return tarea

    def obtiene(self, id_: str) -> Tarea | None:
        return self.tareas.get(id_)

    def lista(self) -> list[dict]:
        return [t.snapshot(desde=len(t.log)) for t in reversed(list(self.tareas.values()))]


class _CapturaLog(logging.Handler):
    def __init__(self, tarea: Tarea):
        super().__init__(level=logging.INFO)
        self.tarea = tarea
        self.setFormatter(logging.Formatter("%(levelname)-7s %(message)s"))

    def emit(self, record):
        try:
            self.tarea.linea(self.format(record))
        except Exception:  # noqa: BLE001
            pass


def _iso(t: float | None) -> str | None:
    return dt.datetime.fromtimestamp(t).isoformat(timespec="seconds") if t else None


# ------------------------------------------------------------ configuración
def carga_settings(base: Path) -> dict:
    return json.loads((base / "config" / "settings.json").read_text(encoding="utf-8"))


FICHERO_TOKEN = "ops_token.txt"
LONGITUD_MINIMA_TOKEN = 32
_RE_TOKEN = re.compile(r"[A-Za-z0-9_\-]{%d,}" % LONGITUD_MINIMA_TOKEN)


class TokenOpsInvalido(ValueError):
    """El `ops_token` de settings.json no sirve (demasiado corto)."""


def token_ops(base: Path, settings: dict | None = None) -> str:
    """El token que el servicio `ops` exige en `X-Ops-Token` (decisión de Óscar, 17-10, 6.7b).

    `ops_token` de `settings.json`, si lo hay, con al menos 32 caracteres
    (revisión, MEN-2; ese fichero está en git: ver `aviso_token`). Si no, el de
    `config/ops_token.txt` (fuera de git), que se crea la primera vez con
    `secrets.token_urlsafe(32)`, con escritura atómica y bajo el bloqueo de
    `config/`: el servicio y `python main.py ops-token` pueden arrancar a la
    vez y no generan dos distintos. Un fichero vacío o estropeado se regenera;
    uno que no se puede leer es un error, no un motivo para pisarlo."""
    import secrets

    from core.package_integrity import atomic_write_text

    explicito = str((settings or {}).get("ops_token") or "").strip()
    if explicito:
        if len(explicito) < LONGITUD_MINIMA_TOKEN:
            raise TokenOpsInvalido(
                f"el ops_token de config/settings.json tiene {len(explicito)} caracteres y hacen falta al "
                f"menos {LONGITUD_MINIMA_TOKEN}. Mejor quítalo (settings.json está en git) y deja que el "
                f"servicio use config/ops_token.txt, que se crea solo.")
        return explicito
    ruta = base / "config" / FICHERO_TOKEN
    token = _lee_token(ruta)
    if token:
        return token
    with bloqueo_config(base):
        token = _lee_token(ruta)      # otro proceso pudo crearlo mientras se esperaba
        if not token:
            token = secrets.token_urlsafe(32)
            atomic_write_text(ruta, token + "\n")
    return token


def origen_token(settings: dict | None) -> str:
    """De dónde sale el token: lo que se enseña al arrancar el servicio."""
    if str((settings or {}).get("ops_token") or "").strip():
        return "el ops_token de config/settings.json"
    return f"config/{FICHERO_TOKEN} (python main.py ops-token lo imprime)"


def aviso_token(settings: dict | None) -> str | None:
    """Aviso si el token está en settings.json, que se versiona (revisión, MEN-2)."""
    if not str((settings or {}).get("ops_token") or "").strip():
        return None
    return ("AVISO: el ops_token está en config/settings.json, que está en git: acabará en el "
            "repositorio. Quítalo de ahí y el servicio usará config/ops_token.txt, que está fuera de git.")


def _lee_token(ruta: Path) -> str | None:
    from core.package_integrity import lee_bytes

    try:
        token = lee_bytes(ruta).decode("utf-8").strip()
    except FileNotFoundError:
        return None
    except UnicodeDecodeError:
        return None                    # estropeado: se regenera
    return token if _RE_TOKEN.fullmatch(token) else None


def carga_fondos(base: Path) -> list[dict]:
    """Filas de `config/fondos.csv`, leído de una vez y sin dejarlo abierto (IMP-1)."""
    from core.package_integrity import lee_csv

    ruta = base / "config" / "fondos.csv"
    if not ruta.exists():
        return []
    return [r for r in lee_csv(ruta) if (r.get("isin") or "").strip()]


def anade_a_universo(base: Path, isin: str, nombre: str, tipo: str) -> bool:
    """Añade una fila a `config/fondos.csv`; False si el ISIN ya estaba.

    Mismo bloqueo que reclasifica y baja: no añadir a mitad de una reescritura.
    Y escritura atómica: el fichero se reescribe entero en un temporal que
    sustituye al original, en vez de añadir al final del abierto, para que un
    corte no deje una fila partida. Lo que ya había se conserva byte a byte.
    `app.py` y `main.py add` pasan por aquí (auditoría 16-10, ALTA-17a).
    """
    import io

    from core.package_integrity import atomic_write_text

    isin = str(isin or "").strip().upper()
    ruta = base / "config" / "fondos.csv"
    with bloqueo_config(base):
        if any(f["isin"].strip().upper() == isin for f in carga_fondos(base)):
            return False
        previo = ruta.read_bytes().decode("utf-8") if ruta.exists() else ""
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        if not previo.strip():
            previo = ""
            w.writerow(["isin", "nombre", "tipo"])
        elif not previo.endswith("\n"):
            previo += "\n"
        w.writerow([isin, nombre, tipo if tipo in TIPOS else "fondo"])
        atomic_write_text(ruta, previo + buf.getvalue())
    return True


_anade_a_universo = anade_a_universo  # nombre anterior


def baja(base: Path, isins: list[str], log_cb: Log | None = None) -> list[dict]:
    """Retira activos del universo del extractor: fuera de `config/fondos.csv`, y su
    ficha, históricos y canónico a `data/_papelera/` (misma estructura de carpetas).
    No toca la maestra: eso es archivar, y lo hace la plataforma."""
    import io

    from core.package_integrity import atomic_write_text
    from core.store import Store

    emite = log_cb or (lambda _t: None)
    pedidos = list(dict.fromkeys(str(i or "").strip().upper() for i in isins if str(i or "").strip()))
    with bloqueo_config(base):  # leer y reescribir fondos.csv sin que otra operación se cuele
        filas = carga_fondos(base)
        estaban = {f["isin"].strip().upper() for f in filas} & set(pedidos)
        quedan = [f for f in filas if f["isin"].strip().upper() not in pedidos]
        if estaban:
            buf = io.StringIO()
            w = csv.writer(buf, lineterminator="\n")
            w.writerow(["isin", "nombre", "tipo"])
            for f in quedan:
                w.writerow([f["isin"].strip().upper(), f.get("nombre") or "", (f.get("tipo") or "fondo").strip()])
            atomic_write_text(base / "config" / "fondos.csv", buf.getvalue())
    papelera = base / "data" / "_papelera"
    carpetas = [(base / "data", papelera), (base / "export_bdb", papelera / "export_bdb")]
    salida = []
    for isin in pedidos:
        movidos: list[str] = []
        for origen, destino_raiz in carpetas:
            if not origen.exists():
                continue
            for p in list(origen.rglob("*")):
                if not p.is_file() or p.stem.strip().upper() != isin or "_papelera" in p.parts:
                    continue
                destino = destino_raiz / p.relative_to(origen)
                destino.parent.mkdir(parents=True, exist_ok=True)
                if destino.exists():
                    destino.unlink()
                p.rename(destino)
                movidos.append(p.relative_to(base).as_posix())
        salida.append({"isin": isin, "estaba": isin in estaban, "ficheros_movidos": movidos})
        emite(f"{isin}: {'retirado del universo' if isin in estaban else 'no estaba en el universo'}"
              + (f" · {len(movidos)} fichero(s) a la papelera" if movidos else ""))
    Store(base).reconstruye_indice()
    emite(f"Baja terminada: {len(estaban)} de {len(pedidos)} estaban en el universo. Índice regenerado.")
    return salida


def reclasifica(base: Path, isin: str, tipo: str) -> dict:
    """Cambia el tipo de un activo del universo (fondos.csv), conservando el orden.
    No extrae ni regenera nada: eso es el paso siguiente.

    Lee, modifica y reescribe fondos.csv bajo `bloqueo_config`: el servicio la
    sirve como petición síncrona mientras un alta puede estar añadiendo filas
    en la cola, y sin el bloqueo esa fila se perdía al reescribir (MEDIA-8)."""
    isin = str(isin or "").strip().upper()
    tipo = str(tipo or "").strip().lower()
    if not RE_ISIN.match(isin):
        raise ValueError(f"ISIN no válido: {isin}")
    if tipo not in TIPOS:
        raise ValueError(f"tipo desconocido: {tipo} ({' | '.join(TIPOS)})")
    ruta = base / "config" / "fondos.csv"
    from core.package_integrity import atomic_write_text
    import io
    with bloqueo_config(base):
        filas = carga_fondos(base)
        anterior = None
        for f in filas:
            if f["isin"].strip().upper() == isin:
                anterior = (f.get("tipo") or "").strip()
                f["tipo"] = tipo
        if anterior is None:
            raise ValueError(f"{isin} no está en el universo: dalo de alta antes")
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["isin", "nombre", "tipo"])
        for f in filas:
            w.writerow([f["isin"].strip().upper(), f.get("nombre") or "", (f.get("tipo") or "fondo").strip()])
        atomic_write_text(ruta, buf.getvalue())
    return {"isin": isin, "tipo_anterior": anterior, "tipo": tipo,
            "nombre": next((f.get("nombre") or "" for f in filas if f["isin"].strip().upper() == isin), "")}


# ---------------------------------------------------------------- consultas
def _g(d, *ruta, default=None):
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return default
        d = d[k]
    return d


def _lee_json(ruta: Path) -> dict | None:
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def lista_universo(base: Path) -> list[dict]:
    """fondos.csv combinado con index.json: los aún no extraídos salen como pendientes."""
    indice: dict[str, dict] = {}
    idx = _lee_json(base / "data" / "index.json") or {}
    for f in idx.get("fondos", []):
        indice[str(f.get("isin", "")).upper()] = f
    salida = []
    en_csv = set()
    for fila in carga_fondos(base):
        isin = fila["isin"].strip().upper()
        en_csv.add(isin)
        b = indice.get(isin, {})
        salida.append({
            "isin": isin,
            "nombre": b.get("nombre") or fila.get("nombre") or "",
            "tipo": (fila.get("tipo") or b.get("tipo") or "").strip(),
            "categoria": b.get("categoria"),
            "ter_pct": b.get("ter_pct"),
            "vl": b.get("vl"),
            "vl_fecha": b.get("vl_fecha"),
            "estrellas": b.get("estrellas"),
            "campos": b.get("campos_con_dato"),
            "fuentes": b.get("fuentes") or [],
            "actualizado": (b.get("actualizado") or "")[:16].replace("T", " "),
            "pendiente": isin not in indice,
        })
    for isin, b in indice.items():
        if isin not in en_csv:
            salida.append({"isin": isin, "nombre": b.get("nombre") or "",
                           "tipo": b.get("tipo") or "", "categoria": b.get("categoria"),
                           "ter_pct": b.get("ter_pct"), "vl": b.get("vl"),
                           "vl_fecha": b.get("vl_fecha"), "estrellas": b.get("estrellas"),
                           "campos": b.get("campos_con_dato"), "fuentes": b.get("fuentes") or [],
                           "actualizado": (b.get("actualizado") or "")[:16].replace("T", " "),
                           "pendiente": False, "fuera_de_lista": True})
    return salida


def ficha_resumen(base: Path, isin: str) -> dict | None:
    """Lo que hay que ver de una ficha v2 tras extraerla: calidad, fuentes, el
    regulatorio oficial y los avisos. None si el fondo no se ha extraído."""
    d = _lee_json(base / "data" / "funds" / f"{isin}.json")
    if not d:
        return None
    from core.schema import cuenta_campos
    con, total = cuenta_campos(d)
    proc = _g(d, "meta", "procedencia", default={}) or {}
    fuentes = _g(d, "meta", "adquisicion", "fuentes", default={}) or {}
    calidad = d.get("calidad") or {}
    sri_fuente = proc.get("riesgo.sri_kid_1a7")
    return {
        "isin": isin,
        "nombre": _g(d, "identificacion", "nombre"),
        "tipo": _g(d, "identificacion", "tipo"),
        "gestora": _g(d, "identificacion", "gestora"),
        "gestora_legal": _g(d, "identificacion", "gestora_legal"),
        "ucits": _g(d, "identificacion", "ucits"),
        "domicilio": _g(d, "identificacion", "domicilio"),
        "actualizado": _g(d, "meta", "actualizado"),
        "campos_con_dato": con,
        "campos_total": total,
        "calidad": {"score": calidad.get("score"), "bucket": calidad.get("bucket"),
                    "flags": list(calidad.get("flags") or [])},
        "fuentes": sorted(fuentes.keys()),
        "plan": _g(d, "meta", "adquisicion", "plan"),
        "sri": {"valor": _g(d, "riesgo", "sri_kid_1a7"), "fuente": sri_fuente,
                "oficial": bool(sri_fuente) and not str(sri_fuente).startswith("morningstar")},
        "kid": {"fuente": _g(d, "documentos_oficiales", "kid_fuente")
                or (str(proc.get("costes.kid.fecha") or "").split(":")[0] or None),
                "fecha": _g(d, "documentos_oficiales", "kid_fecha")},
        "vl": _g(d, "valoracion", "vl"),
        "vl_fecha": _g(d, "valoracion", "vl_fecha"),
        "errores": list(_g(d, "meta", "errores", default=[]) or []),
        "correcciones": _resume_correcciones(d),
    }


def _resume_correcciones(d: dict) -> dict:
    aplicadas = _g(d, "meta", "correcciones", default={}) or {}
    return {"aplicadas": len(aplicadas),
            "redundantes": sorted(r for r, c in aplicadas.items() if (c or {}).get("redundante"))}


def canonico_resumen(base: Path, isin: str) -> dict | None:
    c = _lee_json(base / "export_bdb" / f"{isin}.json")
    if not c:
        return None
    validation = c.get("validation") or {}
    return {
        "isin": isin,
        "schema": c.get("schema"),
        "generated_at": c.get("generated_at"),
        "validation_ok": validation.get("ok"),
        "errors": list(validation.get("errors") or []),
        "warnings": len(validation.get("warnings") or []),
        "quality_bucket": _g(c, "quality", "bucket"),
        "sri": _g(c, "regulatory", "sri"),
        "kid_source": _g(c, "regulatory", "kid", "source"),
        "regulatory_from_official_sources": _g(c, "provenance", "dependency", "regulatory_from_official_sources"),
    }


def estado(base: Path, cola: Cola | None = None) -> dict:
    fondos = carga_fondos(base)
    resumen = _lee_json(base / "export_bdb" / "_resumen.json") or {}
    manifest = _lee_json(base / "export" / "manifest.json") or {}
    idx = _lee_json(base / "data" / "index.json") or {}
    return {
        "servicio": "fondosdb-ops",
        "version": 1,
        "base": str(base),
        "universo": {"total": len(fondos),
                     "por_tipo": _cuenta(f.get("tipo") for f in fondos)},
        "fichas": len(list((base / "data" / "funds").glob("*.json"))) if (base / "data" / "funds").exists() else 0,
        "indice_actualizado": idx.get("actualizado") or idx.get("generado"),
        "canonicos": {"generado": resumen.get("generado"), "ok": resumen.get("ok"),
                      "errores": resumen.get("errores"), "bloqueados": resumen.get("bloqueados"),
                      "package_id": resumen.get("package_id")},
        "export": {"generado": manifest.get("generado") or manifest.get("generated_at"),
                   "package_id": manifest.get("package_id")},
        "paquete_coherente": bool(resumen.get("package_id")) and resumen.get("package_id") == manifest.get("package_id"),
        "tarea_en_curso": cola.en_curso.snapshot(desde=10 ** 9) if cola and cola.en_curso and cola.en_curso.estado == "en_curso" else None,
    }


def _cuenta(valores) -> dict:
    out: dict[str, int] = {}
    for v in valores:
        k = (v or "").strip() or "(sin tipo)"
        out[k] = out.get(k, 0) + 1
    return dict(sorted(out.items()))


# ----------------------------------------------------------------- trabajos
def alta(base: Path, isins: list[str], tipo_forzado: str = "", log_cb: Log | None = None,
         avanza: Callable[..., None] | None = None) -> list[dict]:
    """Resuelve nombre y tipo y añade al universo lo que no estaba. No extrae."""
    from core.http import Http
    from fetchers import eodhd
    from fetchers import morningstar_lt as mlt

    emite = log_cb or (lambda _t: None)
    settings = carga_settings(base)
    http = Http(settings, base / "cache" / "http")
    existentes = {f["isin"].strip().upper(): f for f in carga_fondos(base)}
    filas: list[dict] = []
    total = len(isins)
    if avanza:
        avanza(total=total)
    for n, isin in enumerate(isins, 1):
        if avanza:
            avanza(actual=n, isin=isin)
        if not RE_ISIN.match(isin):
            emite(f"[{n}/{total}] {isin}  ISIN no válido; lo salto")
            filas.append({"isin": isin, "situacion": "invalido"})
            continue
        if isin in existentes:
            f = existentes[isin]
            emite(f"[{n}/{total}] {isin}  ya estaba en el universo ({f.get('nombre') or 'sin nombre'})")
            filas.append({"isin": isin, "situacion": "ya_estaba", "nombre": f.get("nombre") or "",
                          "tipo": (f.get("tipo") or "").strip()})
            continue
        try:
            info = mlt.resuelve(isin, http, settings)
        except Exception as e:  # noqa: BLE001
            info = None
            emite(f"[{n}/{total}] {isin}  error al resolver: {e}")
        nombre = (info or {}).get("nombre", "")
        try:
            tipo = eodhd.clasifica_isin(isin, http, settings, base, nombre, tipo_forzado)
        except Exception:  # noqa: BLE001
            tipo = tipo_forzado if tipo_forzado in TIPOS else "fondo"
        if not tipo:
            tipo = tipo_forzado if tipo_forzado in TIPOS else "fondo"
        if not anade_a_universo(base, isin, nombre, tipo):
            # otra operación lo añadió mientras se resolvía
            emite(f"[{n}/{total}] {isin}  ya estaba en el universo")
            filas.append({"isin": isin, "situacion": "ya_estaba", "nombre": nombre, "tipo": tipo})
            continue
        existentes[isin] = {"isin": isin, "nombre": nombre, "tipo": tipo}
        emite(f"[{n}/{total}] {isin}  -> {nombre or '(sin nombre)'} ({tipo})"
              + ("" if info else "  [no identificado en el screener]"))
        filas.append({"isin": isin, "situacion": "nuevo", "nombre": nombre, "tipo": tipo,
                      "identificado": bool(info)})
    emite(f"Alta terminada: {sum(1 for f in filas if f['situacion'] == 'nuevo')} nuevos de {total}.")
    return filas


def extrae(base: Path, isins: list[str], force: bool = False, sin_historico: bool = False,
           log_cb: Log | None = None, avanza: Callable[..., None] | None = None) -> list[dict]:
    """Pasada del extractor para esos ISIN, por la única vía de recolección."""
    from core import pasada
    from core import update as update_pipeline
    from core.adquisicion import alcance as alcance_mercados
    from core.http import Http
    from core.store import Store

    emite = log_cb or (lambda _t: None)
    alc = alcance_mercados.carga(base)
    settings = carga_settings(base)
    http = Http(settings, base / "cache" / "http")
    tipos = {f["isin"].strip().upper(): (f.get("tipo") or "").strip() for f in carga_fondos(base)}
    fuentes = [f for f in settings["prioridad_fuentes"] if f in update_pipeline.FUENTES]
    total = len(isins)
    # EXT-6: la misma guarda que `main.py update`. Aquí no hay `--sin-firds`: quien quiera
    # escribirlas sin su identidad lo hace desde la consola, a sabiendas.
    pedibles = [i for i in isins if RE_ISIN.match(i) and i in tipos]
    guarda = pasada.guarda_firds(base, pedibles)
    if guarda.bloquea:
        raise ValueError(f"{guarda.aviso(len(pedibles))}. No se escribe ninguna. Constrúyelo con: {guarda.arreglo} "
                         "(o lanza la pasada desde la consola con --sin-firds para escribirlas sin ella)")
    for isin in guarda.desaparecidos:
        emite(f"AVISO: {guarda.aviso_de_desaparecido(isin)}")
    fallos: list[tuple[str, str]] = []
    if avanza:
        avanza(total=total)
    for n, isin in enumerate(isins, 1):
        if avanza:
            avanza(actual=n, isin=isin)
        emite(f"[{n}/{total}] {isin}")
        if not RE_ISIN.match(isin):
            emite("   ISIN no válido; lo salto")
            continue
        if isin not in tipos:
            emite("   no está en el universo (config/fondos.csv): dalo de alta antes")
            continue
        # Aquí los ISIN vienen nombrados uno a uno, así que el alcance avisa y no corta,
        # igual que en `main.py update <ISIN>`. Lo que filtra es la pasada masiva.
        if alc.estado(isin, tipos[isin]) != alcance_mercados.DENTRO:
            emite("   fuera de alcance, se pide igual porque lo has nombrado: "
                  + alc.motivo(isin, tipos[isin]))
        try:
            update_pipeline.ejecuta_pipeline(isin, tipos[isin], fuentes, http, settings, force, base,
                                             sin_historico, print_cb=emite)
        except Exception as e:  # noqa: BLE001 - EXT-7: se apunta y se sigue con las demás
            motivo = pasada.describe_fallo(e)
            fallos.append((isin, motivo))
            log.error("%s: la ficha ha fallado y no se reescribe; la pasada sigue. %s\n%s",
                      isin, motivo, pasada.traza_del_fallo())
            emite(f"   ERROR: la ficha ha fallado y no se reescribe: {motivo}")
    Store(base).reconstruye_indice()
    emite("Índice regenerado.")
    for linea_de_fallo in pasada.resumen_de_fallos(fallos, total):
        emite(linea_de_fallo)
    e = http.estadisticas
    emite(f"Peticiones: {e['red']} a red · {e['cache']} de caché")
    return [ficha_resumen(base, isin) or {"isin": isin, "sin_ficha": True} for isin in isins]


def canonico(base: Path, isins: list[str] | None = None, log_cb: Log | None = None) -> dict:
    """Regenera los dos paquetes completos (export_bdb y export) y devuelve el
    estado de los ISIN pedidos. Completo a propósito: comparten `package_id`."""
    from core import adaptador_bdb, exporta

    emite = log_cb or (lambda _t: None)
    emite("Generando canónicos (export_bdb/)…")
    res = adaptador_bdb.genera(base)
    emite(f"Canónicos: {res['ok']} generados, {res['errores']} errores.")
    emite("Generando export universal (export/)…")
    exp = exporta.export_all(base, base / "export")
    emite(f"Export: {exp['n_fondos']} fondos, {exp['n_lineas_posiciones']} líneas de posiciones.")
    resumen = _lee_json(base / "export_bdb" / "_resumen.json") or {}
    por_isin = {f.get("isin"): f for f in resumen.get("fondos", [])}
    manifest = _lee_json(base / "export" / "manifest.json") or {}
    fondos = []
    for isin in isins or []:
        f = por_isin.get(isin)
        c = canonico_resumen(base, isin)
        fondos.append({"isin": isin, "generado": f is not None,
                       "validation_ok": (f or {}).get("ok"), "errors": (f or {}).get("errors", []),
                       **({k: v for k, v in (c or {}).items() if k not in ("isin", "errors", "validation_ok")})})
    return {"package_id": res.get("package_id"), "ok": res["ok"], "errores": res["errores"],
            "export_package_id": manifest.get("package_id"),
            "paquete_coherente": res.get("package_id") == manifest.get("package_id"),
            "fondos": fondos}
