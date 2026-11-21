"""FondosDB — interfaz web local.

    python app.py            (se abre sola en el navegador, http://127.0.0.1:8765)
    python app.py --puerto 9000

Funciones: gestionar la lista de fondos, lanzar actualizaciones (todo o un
fondo) y la descarga CNMV con log en vivo, y consultar la ficha completa de
cada fondo. Solo escucha en 127.0.0.1 (tu propio equipo). Sin dependencias.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import threading
import webbrowser
from collections import deque
from html import escape as html_escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from core.http import Http                       # noqa: E402
from core import informe  # noqa: E402
from core import ops, pasada, red_local  # noqa: E402
from core.store import Store                 # noqa: E402
from core.package_integrity import ConfigBloqueada, atomic_write_text  # noqa: E402
from core import update as update_pipeline
from core.adquisicion import alcance as alcance_mercados  # noqa: E402
from main import (RE_ISIN, carga_fondos,  # noqa: E402
                  carga_settings)
from fetchers import cnmv as cnmv_mod            # noqa: E402
from fetchers import eodhd                        # noqa: E402

log = logging.getLogger("fondosdb.app")

RE_ISIN_SUELTO = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b")

# ----------------------------------------------------------- estado del trabajo
ESTADO = {"ocupado": False, "tarea": "", "actual": 0, "total": 0, "isin": ""}
LOG: deque[str] = deque(maxlen=500)
LOCK = threading.Lock()


class CapturaLog(logging.Handler):
    def emit(self, record):
        try:
            linea(self.format(record))
        except Exception:
            pass


def linea(txt: str) -> None:
    with LOCK:
        LOG.append(txt)


def actualiza_estado(**changes) -> None:
    with LOCK:
        ESTADO.update(changes)


def estado_snapshot() -> dict:
    with LOCK:
        return {**ESTADO, "log": list(LOG)[-200:]}


def lanza(tarea: str, fn, *args) -> bool:
    with LOCK:
        if ESTADO["ocupado"]:
            return False
        ESTADO.update(ocupado=True, tarea=tarea, actual=0, total=0, isin="")
        LOG.clear()

    def envoltura():
        h = CapturaLog()
        h.setFormatter(logging.Formatter("%(levelname)-7s %(message)s"))
        h.setLevel(logging.INFO)
        raiz = logging.getLogger()
        nivel_previo = raiz.level
        raiz.addHandler(h)
        if raiz.level > logging.INFO or raiz.level == logging.NOTSET:
            raiz.setLevel(logging.INFO)
        try:
            fn(*args)
        except Exception as e:
            linea(f"ERROR general: {e}")
        finally:
            raiz.removeHandler(h)
            raiz.setLevel(nivel_previo)
            actualiza_estado(ocupado=False, tarea="", isin="")

    threading.Thread(target=envoltura, daemon=True).start()
    return True


def trabajo_update(isins: list[str], force: bool) -> None:
    settings = carga_settings()
    http = Http(settings, BASE / "cache" / "http")
    store = Store(BASE)
    tipos = {f["isin"].strip().upper(): (f.get("tipo") or "").strip()
             for f in carga_fondos()}
    # `FUENTES` vive en core.update, no aqui: sin el prefijo esta linea lanzaba
    # NameError y tumbaba el boton "Actualizar" de la interfaz web, que es el uso
    # diario que documenta el README. Lo cazo ruff al entrar en el CI (F821).
    fuentes = [f for f in settings["prioridad_fuentes"] if f in update_pipeline.FUENTES]
    alc = alcance_mercados.carga(BASE)
    actualiza_estado(total=len(isins))
    # EXT-6: la misma guarda que `main.py update`. Sin índice FIRDS no se escribe ninguna ficha.
    guarda = pasada.guarda_firds(BASE, [i for i in isins if RE_ISIN.match(i)])
    if guarda.bloquea:
        linea(f"PARADO: {guarda.aviso(len(isins))}. No se escribe ninguna.")
        linea(f"   Constrúyelo con: {guarda.arreglo} (o lanza la pasada desde la consola con --sin-firds)")
        return
    for isin in guarda.desaparecidos:
        linea(f"AVISO: {guarda.aviso_de_desaparecido(isin)}")
    fallos: list[tuple[str, str]] = []
    for n, isin in enumerate(isins, 1):
        actualiza_estado(actual=n, isin=isin)
        linea(f"[{n}/{len(isins)}] {isin}")
        if not RE_ISIN.match(isin):
            linea("   ISIN no valido; lo salto")
            continue
        tipo_isin = tipos.get(isin, "")
        # Botón "Actualizar" de la interfaz: los ISIN vienen elegidos a mano, así que el
        # alcance avisa y no corta. El filtro de verdad está en `update --all`.
        if alc.estado(isin, tipo_isin) != alcance_mercados.DENTRO:
            linea("   fuera de alcance, se pide igual porque lo has elegido: "
                  + alc.motivo(isin, tipo_isin))
        try:
            update_pipeline.ejecuta_pipeline(
                isin, tipo_isin, fuentes, http, settings, force, BASE, False, print_cb=linea
            )
        except Exception as e:  # noqa: BLE001 - EXT-7: se apunta y se sigue con las demás
            motivo = pasada.describe_fallo(e)
            fallos.append((isin, motivo))
            log.error("%s: la ficha ha fallado y no se reescribe; la pasada sigue. %s\n%s",
                      isin, motivo, pasada.traza_del_fallo())
            linea(f"   ERROR: la ficha ha fallado y no se reescribe: {motivo}")
    store.reconstruye_indice()
    linea("Hecho: indice regenerado.")
    for linea_de_fallo in pasada.resumen_de_fallos(fallos, len(isins)):
        linea(linea_de_fallo)


def trabajo_add_lote(isins: list[str], actualizar: bool, tipo_forzado: str = "") -> None:
    """Alta masiva: resuelve nombre/tipo de cada ISIN vía screener y los
    añade a fondos.csv; opcionalmente los actualiza después. La misma
    implementación que sirve el servicio `ops` a la app (core.ops.alta)."""
    filas = ops.alta(BASE, isins, tipo_forzado, linea, actualiza_estado)
    nuevos = [f["isin"] for f in filas if f.get("situacion") == "nuevo"]
    if actualizar and nuevos:
        actualiza_estado(tarea="Actualizando nuevos")
        linea("")
        trabajo_update(nuevos, False)


def trabajo_bdb() -> None:
    from core import adaptador_bdb
    linea("Generando canónicos con el esquema de BDB-FONDOS...")
    try:
        res = adaptador_bdb.genera(BASE)
        linea(f"Hecho: {res['ok']} canónicos en export_bdb/ "
              f"(errores: {res['errores']}).")
        linea("FondosDB no toca BDB-FONDOS: copia los JSON o cárgalos con tu "
              "flujo habitual.")
    except Exception as e:
        linea(f"ERROR adaptador BDB: {e}")


def trabajo_cnmv(force: bool) -> None:
    settings = carga_settings()
    http = Http(settings, BASE / "cache" / "http")
    isins = {f["isin"].strip().upper() for f in carga_fondos()
             if f["isin"].strip().upper().startswith("ES")}
    if not isins:
        linea("CNMV: no hay fondos ES en la lista.")
        return
    linea(f"CNMV: buscando datos para {len(isins)} fondos ES...")
    try:
        res = cnmv_mod.descarga_y_procesa(http, BASE, isins, force=force)
        linea(f"CNMV {res['periodo']}: {res['isins_con_datos']} fondos con datos.")
        linea("Lanza 'Actualizar todo' para fusionarlos en los JSON.")
    except Exception as e:
        linea(f"CNMV ERROR: {e}")


def _secrets():
    ruta = BASE / "config" / "secrets.json"
    if ruta.exists():
        try:
            # utf-8-sig: tolera el BOM del Bloc de notas (igual que eodhd/figi).
            # Si la lectura falla NO devolver {}: _guarda_cred reescribiría el
            # archivo solo con la credencial y destruiría las API keys (A4).
            return json.loads(ruta.read_text(encoding="utf-8-sig"))
        except Exception:
            raise RuntimeError(
                "config/secrets.json existe pero no se puede leer; "
                "no se sobreescribe para no perder las API keys")
    return {}


def _guarda_cred(cred: str) -> None:
    ruta = BASE / "config" / "secrets.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    s = _secrets()
    s["firestore_credenciales"] = cred
    atomic_write_text(ruta, json.dumps(s, ensure_ascii=False, indent=2))


def trabajo_sync_historicos(cred: str, coleccion: str, todos: bool,
                            inspeccionar: bool) -> None:
    """Vuelca historico_vl_v2 (Firestore) al cache local data/history_vl/.
    Captura los print() del script de sync hacia el log en vivo de la UI."""
    import importlib.util

    try:
        ruta = BASE / "tools" / "sync_historicos.py"
        spec = importlib.util.spec_from_file_location("sync_historicos", ruta)
        sh = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sh)
        # Redirige solo los print del modulo importado; no altera stdout global
        # mientras el servidor atiende otras peticiones.
        sh.print = lambda *values, **_kwargs: linea(" ".join(str(v) for v in values))
    except Exception as e:
        linea(f"No pude cargar tools/sync_historicos.py: {e}")
        return
    try:
        db = sh._conecta(cred)
    except SystemExit:
        linea("Falta firebase-admin:  pip install firebase-admin")
        return
    except Exception as e:
        linea(f"Error conectando a Firestore: {e}")
        return
    isins = sorted(p.stem.upper()
                   for p in (BASE / "data" / "funds").glob("*.json"))
    try:
        if inspeccionar:
            sh.inspecciona(db, coleccion, isins)
        else:
            if todos:
                linea(f"Recorriendo toda la colección '{coleccion}'...")
                isins = sorted({d.id.upper()
                                for d in db.collection(coleccion).stream()
                                if RE_ISIN.match(d.id.upper())})
            if not isins:
                linea("No hay ISINs objetivo (¿tienes fondos en data/funds?).")
                return
            linea(f"Sincronizando {len(isins)} fondos desde '{coleccion}'...")
            sh.sincroniza(db, coleccion, isins, 5)
    except Exception as e:
        linea(f"ERROR durante la sincronización: {e}")


# ------------------------------------------------------------------ ficheros
def lista_fondos() -> list[dict]:
    """Combina fondos.csv con index.json (los aun no actualizados salen
    como pendientes). Misma lista que sirve el servicio `ops`."""
    return ops.lista_universo(BASE)


def añade_fondo(isin: str, nombre: str, tipo: str) -> str | None:
    """Alta de un ISIN desde el formulario. Las escrituras de `config/` van por
    `core.ops`, con `bloqueo_config` y escritura atómica: «Alta masiva» corre en
    segundo plano mientras esto atiende peticiones síncronas, y sin bloqueo una
    podía pisar a la otra (auditoría 16-10, ALTA-17a)."""
    isin = isin.strip().upper()
    if not RE_ISIN.match(isin):
        return f"ISIN no valido: {isin}"
    if any(f["isin"].strip().upper() == isin for f in ops.carga_fondos(BASE)):
        return f"{isin} ya estaba en la lista"
    # CONTRASTADOR: EODHD/nombre deciden el tipo antes de guardar (corrige errores).
    try:
        _set = carga_settings()
        tipo = eodhd.clasifica_isin(isin, Http(_set, BASE / "cache" / "http"),
                                    _set, BASE, nombre, tipo)
    except Exception:
        pass
    if not ops.anade_a_universo(BASE, isin, nombre.strip(), tipo):
        return f"{isin} ya estaba en la lista"
    return None


def quita_fondo(isin: str) -> str | None:
    """Saca un ISIN del universo con `core.ops.baja`, lo mismo que hace el
    servicio `ops`: fondos.csv bajo bloqueo y con escritura atómica, y la ficha,
    los históricos y el canónico a `data/_papelera/` con su estructura de
    carpetas, así que se puede restaurar.

    Antes se movía todo `data/**/<ISIN>.*` a una papelera plana: el
    `history/<ISIN>.jsonl` y el `history_vl/<ISIN>.jsonl` se llaman igual y uno
    se borraba para siempre; y sin validar el ISIN, `isin: "index"` se llevaba
    `data/index.json` (auditoría 16-10, NUEVO-1). Devuelve un error o None."""
    isin = (isin or "").strip().upper()
    if not RE_ISIN.match(isin):
        return f"ISIN no valido: {isin}"
    try:
        ops.baja(BASE, [isin], linea)
    except Exception as e:
        return f"No se pudo quitar {isin}: {e}"
    return None


# ------------------------------------------------------------------ servidor
class Manejador(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silencia el log por peticion
        pass

    def _json(self, obj, codigo=200):
        cuerpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _cuerpo(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length") or 0)
            datos = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        except Exception:
            return {}
        return datos if isinstance(datos, dict) else {}

    def _prohibe(self, motivo: str) -> None:
        # Antes de contestar se lee y se descarta el cuerpo: si el servidor
        # cierra con datos sin leer, Windows corta la conexión con un RST y el
        # cliente puede no llegar a ver el 403.
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if 0 < n <= 1_000_000:
            self.rfile.read(n)
        self._json({"ok": False, "error": motivo}, 403)

    def _rechazo(self, post: bool) -> str | None:
        """Por qué no se atiende la petición, o None si viene de este equipo.

        Escuchar solo en 127.0.0.1 no basta (auditoría 16-10, CRIT-07):
        - cualquier página abierta en el navegador podía hacer un POST
          «simple» (`text/plain`, sin preflight) y quitar, dar de alta o
          lanzar trabajos;
        - con DNS rebinding, una página ajena leía las respuestas de la API.
        Se exige el Host de este servidor, un Origin (si lo hay) de este mismo
        servidor y, en los POST, `application/json`: eso obliga al navegador a
        un preflight que este servidor no contesta (no hay `do_OPTIONS`).
        """
        puerto = self.server.server_address[1]
        host = self.headers.get("Host")
        if not red_local.host_local(host, puerto):
            return f"Host no permitido: {(host or '').strip() or '(vacío)'}"
        origen = self.headers.get("Origin")
        if origen is not None and not red_local.origen_local(origen, puerto):
            return f"origen no permitido: {origen}"
        if post:
            tipo = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            if tipo != "application/json":
                return "se exige Content-Type: application/json"
        return None

    def do_GET(self):
        motivo = self._rechazo(post=False)
        if motivo:
            self._prohibe(motivo)
            return
        ruta = self.path.split("?")[0]
        if ruta == "/":
            cuerpo = PLANTILLA.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
        elif ruta == "/api/fondos":
            self._json(lista_fondos())
        elif ruta == "/api/estado":
            self._json(estado_snapshot())
        elif ruta == "/api/sync_config":
            self._json({"credenciales": _secrets().get("firestore_credenciales", "")})
        elif ruta.startswith("/api/fondo/"):
            isin = ruta.rsplit("/", 1)[-1].upper()
            f = BASE / "data" / "funds" / f"{isin}.json"
            if RE_ISIN.match(isin) and f.exists():
                self._json(json.loads(f.read_text(encoding="utf-8")))
            else:
                self._json({"error": "sin datos"}, 404)
        elif ruta.startswith("/informe/"):
            isin = ruta.rsplit("/", 1)[-1].upper()
            f = BASE / "data" / "funds" / f"{isin}.json"
            if RE_ISIN.match(isin) and f.exists():
                try:
                    datos = json.loads(f.read_text(encoding="utf-8"))
                    html = informe.genera_html(datos, isin, base=BASE)
                    cuerpo = html.encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(cuerpo)))
                    self.end_headers()
                    self.wfile.write(cuerpo)
                except Exception as e:
                    msg = f"<h1>Error generando el informe</h1><pre>{html_escape(str(e))}</pre>".encode("utf-8")
                    self.send_response(500)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(msg)))
                    self.end_headers()
                    self.wfile.write(msg)
            else:
                cuerpo = b"<h1>404</h1><p>No hay datos para ese fondo todavia.</p>"
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(cuerpo)))
                self.end_headers()
                self.wfile.write(cuerpo)
        else:
            self._json({"error": "no existe"}, 404)

    def do_POST(self):
        motivo = self._rechazo(post=True)
        if motivo:
            self._prohibe(motivo)
            return
        ruta = self.path.split("?")[0]
        datos = self._cuerpo()
        if ruta == "/api/add":
            try:
                error = añade_fondo(datos.get("isin", ""), datos.get("nombre", ""),
                                    datos.get("tipo", "fondo"))
            except (ConfigBloqueada, OSError) as e:
                # config/ bloqueada por otro proceso o fondos.csv abierto en otro
                # programa: un error que se lee, no la conexión cortada (MEN-5).
                self._json({"ok": False, "error": f"No se ha dado de alta: {e}"}, 503)
                return
            self._json({"ok": error is None, "error": error})
        elif ruta == "/api/quitar":
            error = quita_fondo(str(datos.get("isin") or ""))
            self._json({"ok": error is None, "error": error})
        elif ruta == "/api/add_lote":
            texto = (datos.get("texto") or "").upper()
            isins = list(dict.fromkeys(RE_ISIN_SUELTO.findall(texto)))
            if not isins:
                self._json({"ok": False, "error": "No encuentro ningún ISIN "
                            "en el texto", "encontrados": 0})
                return
            ok = lanza("Alta masiva", trabajo_add_lote, isins,
                       bool(datos.get("actualizar", True)),
                       (datos.get("tipo") or "").strip())
            self._json({"ok": ok, "encontrados": len(isins),
                        "error": None if ok else "ya hay una tarea en marcha"})
        elif ruta == "/api/update":
            isins = datos.get("isins")
            if not isins:
                isins = [f["isin"].strip().upper() for f in carga_fondos()]
            ok = lanza("Actualizando", trabajo_update, isins,
                       bool(datos.get("force")))
            self._json({"ok": ok, "error": None if ok else "ya hay una tarea en marcha"})
        elif ruta == "/api/cnmv":
            ok = lanza("CNMV", trabajo_cnmv, bool(datos.get("force")))
            self._json({"ok": ok, "error": None if ok else "ya hay una tarea en marcha"})
        elif ruta == "/api/bdb":
            ok = lanza("Export BDB", trabajo_bdb)
            self._json({"ok": ok, "error": None if ok else "ya hay una tarea en marcha"})
        elif ruta == "/api/sync_historicos":
            cred = (datos.get("credenciales") or "").strip()
            if not cred:
                self._json({"ok": False, "error": "Falta la ruta al serviceAccount.json"})
                return
            _guarda_cred(cred)
            tarea = "Inspección históricos" if datos.get("inspeccionar") else "Sync históricos"
            ok = lanza(tarea, trabajo_sync_historicos, cred,
                       (datos.get("coleccion") or "historico_vl_v2").strip(),
                       bool(datos.get("todos")), bool(datos.get("inspeccionar")))
            self._json({"ok": ok, "error": None if ok else "ya hay una tarea en marcha"})
        else:
            self._json({"error": "no existe"}, 404)


# ------------------------------------------------------------------ plantilla
PLANTILLA = r"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>FondosDB</title>
<style>
  :root { --bg:#f7f7f5; --panel:#fff; --tinta:#1c1c1c; --suave:#6b6b6b;
          --linea:#e3e3df; --acento:#0b6e4f; --rojo:#a33; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif;
         background:var(--bg); color:var(--tinta); }
  header { padding:12px 22px; background:var(--panel); border-bottom:1px solid var(--linea);
           display:flex; gap:10px; align-items:center; flex-wrap:wrap; position:sticky; top:0; z-index:5;}
  header h1 { font-size:18px; margin:0 12px 0 0; }
  button { padding:7px 14px; border:1px solid var(--linea); border-radius:8px;
           background:var(--panel); cursor:pointer; font-size:13px; }
  button.primario { background:var(--acento); color:#fff; border-color:var(--acento); }
  button:disabled { opacity:.45; cursor:default; }
  #spin { color:var(--acento); font-weight:600; display:none; }
  main { padding:16px 22px; display:grid; gap:16px; }
  section { background:var(--panel); border:1px solid var(--linea); border-radius:10px; padding:14px 16px; }
  h2 { margin:0 0 10px; font-size:15px; color:var(--acento); }
  table { border-collapse:collapse; width:100%; }
  th,td { padding:6px 9px; border-bottom:1px solid var(--linea); text-align:right; white-space:nowrap; font-size:13px;}
  th:nth-child(-n+3), td:nth-child(-n+3) { text-align:left; }
  td.nombre { max-width:360px; overflow:hidden; text-overflow:ellipsis; }
  tbody tr:hover { background:#f0f6f3; }
  .pendiente { color:#b58a00; font-weight:600; }
  .mini { padding:3px 9px; font-size:12px; }
  .mini.rojo { color:var(--rojo); }
  form#alta { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  input,select { padding:7px 10px; border:1px solid var(--linea); border-radius:8px; font-size:13px; }
  #log { background:#101311; color:#cde8d8; border-radius:8px; padding:10px 12px;
         font:12px/1.5 Consolas,monospace; max-height:300px; overflow:auto;
         white-space:pre-wrap; display:none; }
  #velo { position:fixed; inset:0; background:rgba(0,0,0,.45); display:none; z-index:10; }
  #ficha { position:fixed; top:4vh; left:50%; transform:translateX(-50%);
           width:min(880px,94vw); max-height:90vh; overflow:auto; background:var(--panel);
           border-radius:12px; padding:18px 22px; display:none; z-index:11; }
  #ficha h2 { font-size:17px; color:var(--tinta); }
  #ficha .sub { color:var(--suave); margin-bottom:10px; }
  #cerrar { float:right; }
  details { margin:6px 0; border:1px solid var(--linea); border-radius:8px; padding:6px 10px; }
  summary { cursor:pointer; font-weight:600; color:var(--acento); }
  .kv { display:grid; grid-template-columns:minmax(150px,46%) 1fr; gap:2px 10px; margin:6px 0; }
  .kv .k { color:var(--suave); } .kv .v { text-align:right; font-variant-numeric:tabular-nums; }
  .vacio { color:#bbb; } .chip { display:inline-block; background:#eef2ee; border-radius:10px;
           padding:1px 8px; margin:1px; font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>FondosDB</h1>
  <button class="primario" onclick="actualizar(null,false)">Actualizar todo</button>
  <button onclick="actualizar(null,true)">Forzar (sin caché)</button>
  <button onclick="cnmv()">Descargar CNMV</button>
  <button onclick="bdb()">Exportar a BDB</button>
  <span id="spin">⟳ <span id="spintxt"></span></span>
</header>
<main>
  <section>
    <h2>Añadir fondo</h2>
    <form id="alta" onsubmit="return alta(event)">
      <input id="a_isin" placeholder="ISIN (p.ej. ES0114673033)" required size="22">
      <input id="a_nombre" placeholder="Nombre (opcional)" size="34">
      <select id="a_tipo"><option value="fondo">fondo</option><option value="etf">etf</option><option value="accion">acción</option><option value="indice">índice</option></select>
      <button class="primario">Añadir y actualizar</button>
    </form>
  </section>
  <section>
    <h2>Añadir en lote (pega una lista de ISINs)</h2>
    <form onsubmit="return altaLote(event)">
      <textarea id="l_texto" rows="4" style="width:100%;padding:8px 10px;border:1px solid var(--linea);border-radius:8px;font:13px/1.4 Consolas,monospace"
        placeholder="Pega aquí cualquier texto con ISINs: una lista de Excel, un email, líneas separadas por comas… Los detecto, averiguo nombre y tipo, y los doy de alta."></textarea>
      <div style="margin-top:8px;display:flex;gap:14px;align-items:center">
        <label>tipo: <select id="l_tipo"><option value="">auto (detectar)</option><option value="accion">acción</option><option value="etf">etf</option><option value="fondo">fondo</option><option value="indice">índice</option></select></label>
        <label><input type="checkbox" id="l_actualizar" checked> actualizar al terminar</label>
        <button class="primario">Añadir lote</button>
        <span id="l_aviso" class="vacio"></span>
      </div>
    </form>
  </section>
  <section>
    <h2>Históricos para el gráfico de 5 años</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="sh_cred" placeholder="Ruta a serviceAccount.json (Firebase)" size="46">
      <input id="sh_col" value="historico_vl_v2" size="18" title="colección Firestore">
      <label><input type="checkbox" id="sh_todos"> todo el universo de la colección</label>
      <button onclick="inspecciona()">Inspeccionar</button>
      <button class="primario" onclick="sincroniza()">Sincronizar históricos</button>
    </div>
    <div class="vacio" style="margin-top:6px">Vuelca tu Firestore <code>historico_vl_v2</code>
      a un cache local (<code>data/history_vl/</code>) que alimenta el gráfico del informe.
      Requiere <code>pip install firebase-admin</code>. La ruta se guarda para la próxima vez.
      Usa <b>Inspeccionar</b> la primera vez para comprobar el esquema (no escribe nada).</div>
  </section>
  <section>
    <h2>Fondos (<span id="nfondos">0</span>)</h2>
    <table><thead><tr>
      <th>ISIN</th><th>Nombre</th><th>Tipo</th><th>Categoría</th><th>TER%</th>
      <th>VL</th><th>★</th><th>Campos</th><th>Actualizado</th><th></th>
    </tr></thead><tbody id="cuerpo"></tbody></table>
  </section>
  <section>
    <h2>Actividad</h2>
    <div id="log"></div>
    <div id="sinlog" class="vacio">Sin actividad. Lanza una actualización.</div>
  </section>
</main>
<div id="velo" onclick="cierra()"></div>
<div id="ficha"></div>
<script>
const $ = id => document.getElementById(id);
// Todo lo que entra en innerHTML pasa por esc(): nombres, claves y valores
// vienen de fuentes raspadas (Morningstar, justETF, CNMV) o del alta a mano
// (auditoría 16-10, CRIT-07).
const esc = v => String(v ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const f2 = v => (v===null||v===undefined)?'·':(typeof v==='number'?v.toLocaleString('es-ES',{maximumFractionDigits:2}):v);
const e2 = v => esc(f2(v));
let ocupadoPrevio = false;

async function api(ruta, datos) {
  const r = await fetch(ruta, datos ? {method:'POST', headers:{'Content-Type':'application/json'},
                                       body: JSON.stringify(datos)} : undefined);
  return r.json();
}

function filaFondo(f) {
  const isin = esc(f.isin);
  const sinFicha = f.pendiente ? 'disabled' : '';
  return `<tr>
    <td>${isin}${f.fuera_de_lista?' <span class="vacio">(fuera de lista)</span>':''}</td>
    <td class="nombre" title="${esc(f.nombre||'')}">${esc(f.nombre||'')}</td>
    <td>${esc(f.tipo||'')}</td><td>${esc(f.categoria||'')}</td>
    <td>${e2(f.ter_pct)}</td><td>${e2(f.vl)}</td><td>${esc(f.estrellas??'·')}</td>
    <td>${f.pendiente?'<span class="pendiente">pendiente</span>':esc(f.campos??'·')}</td>
    <td>${esc(f.actualizado||'')}</td>
    <td>
      <button class="mini" data-accion="ficha" data-isin="${isin}" ${sinFicha}>Ficha</button>
      <button class="mini" data-accion="informe" data-isin="${isin}" ${sinFicha}>Informe</button>
      <button class="mini" data-accion="actualizar" data-isin="${isin}">Actualizar</button>
      <button class="mini rojo" data-accion="quitar" data-isin="${isin}">Quitar</button>
    </td></tr>`;
}

async function cargarFondos() {
  const fondos = await api('/api/fondos');
  $('nfondos').textContent = fondos.length;
  $('cuerpo').innerHTML = fondos.map(filaFondo).join('');
}

// Los botones de cada fila llevan el ISIN en data-isin, no dentro de un
// onclick: así no hay que escapar para JS dentro de un atributo HTML.
$('cuerpo').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-accion]');
  if (!b || b.disabled) return;
  const isin = b.dataset.isin;
  if (b.dataset.accion === 'ficha') ficha(isin);
  else if (b.dataset.accion === 'informe') informe(isin);
  else if (b.dataset.accion === 'actualizar') actualizar([isin], false);
  else if (b.dataset.accion === 'quitar') quitar(isin);
});

async function alta(ev) {
  ev.preventDefault();
  const isin = $('a_isin').value.trim().toUpperCase();
  const r = await api('/api/add', {isin, nombre: $('a_nombre').value,
                                   tipo: $('a_tipo').value});
  if (!r.ok) { alert(r.error); return false; }
  $('a_isin').value = $('a_nombre').value = '';
  await cargarFondos();
  actualizar([isin], false);
  return false;
}

async function altaLote(ev) {
  ev.preventDefault();
  const texto = $('l_texto').value;
  if (!texto.trim()) return false;
  const r = await api('/api/add_lote', {texto, actualizar: $('l_actualizar').checked, tipo: $('l_tipo').value});
  if (!r.ok) { alert(r.error); return false; }
  $('l_aviso').textContent = `${r.encontrados} ISINs detectados; procesando…`;
  $('l_texto').value = '';
  setTimeout(()=>{ $('l_aviso').textContent=''; }, 6000);
  return false;
}

async function quitar(isin) {
  if (!confirm(`¿Quitar ${isin} de la lista? (se moverá a la papelera)`)) return;
  const r = await api('/api/quitar', {isin});
  if (!r.ok) alert(r.error);
  cargarFondos();
}

async function actualizar(isins, force) {
  const r = await api('/api/update', {isins, force});
  if (!r.ok) alert(r.error);
}

async function cnmv() {
  const r = await api('/api/cnmv', {});
  if (!r.ok) alert(r.error);
}

async function bdb() {
  const r = await api('/api/bdb', {});
  if (!r.ok) alert(r.error);
}

async function cargarSyncCfg() {
  try { const c = await api('/api/sync_config');
        if (c && c.credenciales) $('sh_cred').value = c.credenciales; } catch(e){}
}

async function sincroniza() {
  const credenciales = $('sh_cred').value.trim();
  if (!credenciales) { alert('Indica la ruta al serviceAccount.json'); return; }
  const r = await api('/api/sync_historicos', {credenciales,
    coleccion: $('sh_col').value.trim() || 'historico_vl_v2',
    todos: $('sh_todos').checked, inspeccionar: false});
  if (!r.ok) alert(r.error);
}

async function inspecciona() {
  const credenciales = $('sh_cred').value.trim();
  if (!credenciales) { alert('Indica la ruta al serviceAccount.json'); return; }
  const r = await api('/api/sync_historicos', {credenciales,
    coleccion: $('sh_col').value.trim() || 'historico_vl_v2',
    todos: false, inspeccionar: true});
  if (!r.ok) alert(r.error);
}

async function ficha(isin) {
  const d = await api('/api/fondo/' + encodeURIComponent(isin));
  if (d.error) { alert('Sin datos todavía'); return; }
  const nombre = g(d,'identificacion.nombre')||isin;
  let h = `<button id="cerrar" onclick="cierra()">Cerrar ✕</button>
    <h2>${esc(nombre)}</h2><div class="sub">${esc(isin)} · ${esc(g(d,'identificacion.gestora')||'')} · ${esc(g(d,'identificacion.categoria_morningstar')||'')}</div>`;
  const NOMBRES = {identificacion:'Identificación', valoracion:'Valoración y patrimonio',
    costes:'Costes', rentabilidad:'Rentabilidad', riesgo:'Riesgo', rating:'Rating',
    cartera:'Cartera', esg:'ESG / Sostenibilidad', gestion:'Gestión y gestora',
    distribuciones:'Distribuciones', documentos:'Documentos', series:'Series', meta:'Metadatos'};
  for (const b of ['identificacion','valoracion','costes','rentabilidad','riesgo','rating',
                   'cartera','esg','gestion','distribuciones','documentos','series','meta']) {
    if (!(b in d)) continue;
    h += `<details ${['identificacion','costes','rentabilidad'].includes(b)?'open':''}>
          <summary>${esc(NOMBRES[b]||b)}</summary>${render(d[b],0)}</details>`;
  }
  $('ficha').innerHTML = h;
  $('velo').style.display = 'block';
  $('ficha').style.display = 'block';
}

function informe(isin){ window.open('/informe/' + encodeURIComponent(isin), '_blank'); }

function cierra(){ $('velo').style.display='none'; $('ficha').style.display='none'; }
const g = (o, ruta) => ruta.split('.').reduce((a,k)=> (a&&typeof a==='object')?a[k]:undefined, o);

function render(v, nivel) {
  if (v === null || v === undefined) return '<span class="vacio">·</span>';
  if (Array.isArray(v)) {
    if (!v.length) return '<span class="vacio">—</span>';
    if (typeof v[0] === 'object') {
      const fs = v.slice(0, 80);
      const cols = [...new Set(fs.flatMap(o=>Object.keys(o||{})))];
      return `<div style="overflow:auto"><table style="font-size:12px">${'<tr>'+cols.map(c=>`<th>${esc(c)}</th>`).join('')+'</tr>'}
        ${fs.map(o=>'<tr>'+cols.map(c=>`<td>${o&&o[c]!==null&&o[c]!==undefined?e2(o[c]):'·'}</td>`).join('')+'</tr>').join('')}</table></div>
        ${v.length>80?`<div class="vacio">… y ${v.length-80} más</div>`:''}`;
    }
    return v.map(x=>`<span class="chip">${esc(x)}</span>`).join('');
  }
  if (typeof v === 'object') {
    const entradas = Object.entries(v).filter(([,x]) => x!==null && x!==undefined);
    if (!entradas.length) return '<span class="vacio">—</span>';
    const simples = entradas.filter(([,x]) => typeof x !== 'object');
    const complejas = entradas.filter(([,x]) => typeof x === 'object');
    let h = '';
    if (simples.length) h += '<div class="kv">' + simples.map(([k,x]) =>
      `<span class="k">${esc(k)}</span><span class="v">${e2(x)}</span>`).join('') + '</div>';
    for (const [k,x] of complejas) {
      h += nivel < 2 ? `<details><summary>${esc(k)}</summary>${render(x, nivel+1)}</details>`
                     : `<div class="kv"><span class="k">${esc(k)}</span><span class="v"></span></div>` + render(x, nivel+1);
    }
    return h;
  }
  return esc(v);
}

async function tic() {
  const e = await api('/api/estado');
  const ocupado = e.ocupado;
  $('spin').style.display = ocupado ? 'inline' : 'none';
  $('spintxt').textContent = ocupado
    ? `${e.tarea} ${e.total?`${e.actual}/${e.total}`:''} ${e.isin||''}` : '';
  document.querySelectorAll('button').forEach(b => {
    if (b.id !== 'cerrar' && !b.classList.contains('mini')) b.disabled = ocupado;
  });
  if (e.log && e.log.length) {
    $('sinlog').style.display = 'none';
    $('log').style.display = 'block';
    const alFinal = $('log').scrollTop + $('log').clientHeight >= $('log').scrollHeight - 30;
    $('log').textContent = e.log.join('\n');
    if (alFinal) $('log').scrollTop = $('log').scrollHeight;
  }
  if (ocupadoPrevio && !ocupado) cargarFondos();  // tarea recien terminada
  ocupadoPrevio = ocupado;
}

cargarFondos();
cargarSyncCfg();
setInterval(tic, 1000);
</script>
</body>
</html>
"""


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--puerto", type=int, default=8765)
    p.add_argument("--sin-navegador", action="store_true")
    args = p.parse_args()

    servidor = ThreadingHTTPServer(("127.0.0.1", args.puerto), Manejador)
    url = f"http://127.0.0.1:{args.puerto}"
    print(f"FondosDB en {url}  (Ctrl+C para parar)")
    if not args.sin_navegador:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nParando.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
