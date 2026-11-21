"""FondosDB — servicio local de operaciones para la app BDB-ACTIVOS.

    python main.py ops                 (http://127.0.0.1:8766, solo este equipo)
    python main.py ops --puerto 9000

La app (Sistema › Operaciones) habla con este servicio para dar de alta
activos, extraerlos, generar los canónicos y llevarlos a la maestra sin abrir
tres programas. Solo escucha en 127.0.0.1, solo atiende peticiones con el Host
de este servidor (127.0.0.1 o localhost y su puerto) y solo responde a los
orígenes de la app en desarrollo (`ops_origenes` en settings.json). Cada petición
(salvo el preflight OPTIONS) debe traer el token en la cabecera `X-Ops-Token`: el de
`config/ops_token.txt`, que se crea solo la primera vez, o el `ops_token` de
settings.json si se pone ahí (no conviene: está en git; al menos 32 caracteres). Se
lee en cada petición. `python main.py ops-token` lo imprime (lo usa la app al
arrancar su servidor de desarrollo como `VITE_BDB_OPS_TOKEN`).

Los trabajos van en segundo plano, uno a la vez, con registro en vivo:

    GET  /api/ops/estado                estado del extractor y del paquete
    GET  /api/ops/universo?q=texto      fondos.csv + índice
    GET  /api/ops/ficha/{ISIN}          resumen de la ficha v2 y del canónico
    POST /api/ops/alta                  {texto|isins, tipo?}         -> tarea
    POST /api/ops/extraer               {isins, force?}              -> tarea
    POST /api/ops/canonico              {isins?}                     -> tarea
    POST /api/ops/reclasificar          {isin, tipo}                 cambia el tipo en fondos.csv (solo el
                                        universo del extractor: a la maestra llega con
                                        plataforma/reclasificar-seco y plataforma/reclasificar)
    GET  /api/ops/tareas                últimas tareas
    GET  /api/ops/tareas/{id}?desde=N   estado y registro de una tarea

Plataforma de datos (`core.ops_plataforma`, subprocesos de `2-plataforma-datos`):

    GET  /api/ops/plataforma/estado     disponibilidad, última copia, corridas
    POST /api/ops/plataforma/backup     copia de la maestra           -> tarea
    POST /api/ops/plataforma/seco       {isins, modo: alta|republish} -> tarea
                                        la alta crea raíz, cartera y metrics/latest puente
    POST /api/ops/plataforma/escribir   {isins, modo, aprobacion}     -> tarea
                                        exige pasada en seco previa de esos ISIN,
                                        aprobación = su recuento y copia < 24 h; en la
                                        alta solo se escriben los CREATE aprobados
    POST /api/ops/plataforma/reclasificar-seco {isins, preparar?}    -> tarea
                                        ISIN que fondos.csv ya da por acción: pasada en
                                        seco de reclassify:stock; con preparar (por
                                        defecto) extrae y regenera el canónico solo de
                                        los que aún no tienen canónico de acción
    POST /api/ops/plataforma/reclasificar {isins, aprobacion}        -> tarea
                                        exige esa pasada en seco, aprobación = su
                                        recuento y copia < 24 h; reescribe la raíz
                                        como acción, invalida metrics/latest y cambia
                                        el buscador; después, auditoría
    POST /api/ops/plataforma/auditar    {isins}                       -> tarea
    POST /api/ops/plataforma/archivar-seco {isins, motivo?}           -> tarea (qué hay, sin tocar nada)
    POST /api/ops/plataforma/archivar   {isins, aprobacion, motivo?}  -> tarea
                                        exige pasada en seco previa de esos ISIN, aprobación =
                                        su recuento y copia < 24 h; copia local + _archived_assets,
                                        retirada de assets y del índice; después baja del universo
                                        del extractor y canónico regenerado
    GET  /api/ops/plataforma/corridas   artefactos de las corridas

Correcciones manuales en origen (`core.correcciones`, config/correcciones.json):

    GET    /api/ops/correcciones                 todas, y las rutas que se pueden corregir
    GET    /api/ops/correcciones/{ISIN}          las del activo y sus campos corregibles
    POST   /api/ops/correcciones                 {isin, ruta, valor, motivo, autor?}
    DELETE /api/ops/correcciones/{ISIN}/{ruta}   retira una corrección
    Después hay que extraer y regenerar el canónico para que llegue a la maestra.
"""
from __future__ import annotations

import argparse
import hmac
import json
import logging
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from core import correcciones, ops, red_local  # noqa: E402
from core.package_integrity import ConfigBloqueada  # noqa: E402
from core import ops_plataforma  # noqa: E402

log = logging.getLogger("fondosdb.ops_server")

ORIGENES_POR_DEFECTO = ("http://localhost:5173", "http://127.0.0.1:5173",
                        "http://localhost:5178", "http://127.0.0.1:5178",
                        "http://localhost:4173", "http://127.0.0.1:4173")


class Servicio:
    """Estado compartido entre peticiones: la cola de tareas y la configuración."""

    def __init__(self, base: Path):
        self.base = Path(base)
        self.cola = ops.Cola()
        try:
            settings = ops.carga_settings(self.base)
        except (OSError, ValueError):
            settings = {}
        self.origenes = set(settings.get("ops_origenes") or ORIGENES_POR_DEFECTO)
        # Obligatorio desde el 17-10 (decisión de Óscar, 6.7b): sin `ops_token` en
        # settings.json se usa o se crea config/ops_token.txt. Se comprueba ya al
        # arrancar (si no se puede, el servicio no arranca) y luego se vuelve a
        # leer en cada petición (`token`).
        self._settings = settings
        ops.token_ops(self.base, settings)
        self.plataforma = ops_plataforma.localiza(self.base, settings)
        # Última pasada en seco por (modo, isins): la escritura exige que exista
        # y que el recuento aprobado sea el suyo.
        self.ultima_seco: dict[tuple, dict] = {}
        self.lock = threading.Lock()

    def settings_actuales(self) -> dict:
        try:
            return ops.carga_settings(self.base)
        except (OSError, ValueError):
            return self._settings

    @property
    def token(self) -> str:
        """El token vigente, leído en cada petición (es barato): si
        config/ops_token.txt se regenera o cambia settings.json con el servicio en
        marcha, no hace falta reiniciarlo (revisión, MEN-4)."""
        return ops.token_ops(self.base, self.settings_actuales())

    def mensajes_arranque(self, puerto: int) -> list[str]:
        settings = self.settings_actuales()
        lineas = [f"FondosDB ops en http://127.0.0.1:{puerto}  (Ctrl+C para parar)",
                  f"Token: {ops.origen_token(settings)}"]
        aviso = ops.aviso_token(settings)
        if aviso:
            lineas.append(aviso)
        return lineas

    # ----------------------------------------------------------- consultas
    def estado(self) -> dict:
        est = ops.estado(self.base, self.cola)
        est["plataforma"] = self.plataforma_estado()
        return est

    def plataforma_estado(self) -> dict:
        return {
            **ops_plataforma.disponible(self.plataforma),
            "ultimo_backup": ops_plataforma.ultimo_backup(self.plataforma),
            "backup_max_horas": ops_plataforma.BACKUP_MAX_HORAS,
            "corridas": ops_plataforma.corridas(self.base, limite=8),
        }

    def universo(self, q: str) -> list[dict]:
        filas = ops.lista_universo(self.base)
        q = (q or "").strip().upper()
        if not q:
            return filas
        return [f for f in filas if q in f["isin"] or q in (f.get("nombre") or "").upper()]

    def ficha(self, isin: str) -> dict:
        isin = isin.strip().upper()
        if not ops.RE_ISIN.match(isin):
            raise ErrorPeticion(400, "ISIN no válido")
        return {"isin": isin,
                "en_universo": any(f["isin"].strip().upper() == isin for f in ops.carga_fondos(self.base)),
                "ficha": ops.ficha_resumen(self.base, isin),
                "canonico": ops.canonico_resumen(self.base, isin)}

    # ------------------------------------------------------------ trabajos
    def _lanza(self, nombre: str, fn, parametros: dict) -> dict:
        tarea = self.cola.lanza(nombre, fn, parametros)
        if tarea is None:
            raise ErrorPeticion(409, "ya hay una tarea en marcha", {"tarea": self.cola.en_curso.snapshot(desde=10 ** 9)})
        return {"ok": True, "tarea": tarea.snapshot()}

    def alta(self, datos: dict) -> dict:
        isins = ops.extrae_isins(datos.get("texto"), datos.get("isins"))
        if not isins:
            raise ErrorPeticion(400, "No encuentro ningún ISIN")
        tipo = str(datos.get("tipo") or "").strip().lower()
        if tipo and tipo not in ops.TIPOS:
            raise ErrorPeticion(400, f"tipo desconocido: {tipo}")

        def fn(t: ops.Tarea):
            return ops.alta(self.base, isins, tipo, t.linea, t.avanza)
        return self._lanza("alta", fn, {"isins": isins, "tipo": tipo})

    def extraer(self, datos: dict) -> dict:
        isins = ops.extrae_isins(datos.get("texto"), datos.get("isins"))
        if not isins:
            raise ErrorPeticion(400, "No encuentro ningún ISIN")
        force = bool(datos.get("force"))
        sin_historico = bool(datos.get("sin_historico", False))

        def fn(t: ops.Tarea):
            return ops.extrae(self.base, isins, force, sin_historico, t.linea, t.avanza)
        return self._lanza("extraer", fn, {"isins": isins, "force": force})

    def canonico(self, datos: dict) -> dict:
        isins = ops.extrae_isins(datos.get("texto"), datos.get("isins"))

        def fn(t: ops.Tarea):
            return ops.canonico(self.base, isins, t.linea)
        return self._lanza("canonico", fn, {"isins": isins})

    def reclasificar(self, datos: dict) -> dict:
        # Síncrona y fuera de la cola (no debe esperar a una extracción larga):
        # la serializa con el alta y la baja `BLOQUEO_CONFIG`, dentro de ops.reclasifica.
        try:
            res = ops.reclasifica(self.base, str(datos.get("isin") or ""), str(datos.get("tipo") or ""))
        except ValueError as e:
            raise ErrorPeticion(400, str(e)) from e
        # Solo cambia el universo del extractor. Si pasa a acción y la maestra lo
        # tiene como fondo, la alta lo saltará (ya existe) y el republish lo
        # apartará: hay que reclasificarlo en la maestra (ALTA-13).
        siguiente = None
        if res["tipo"] == "accion" and res["tipo_anterior"] != "accion":
            siguiente = "reclasificar en la maestra: pasada en seco de la reclasificación (extrae, canónico y reclassify:stock)"
        return {"ok": True, **res, "siguiente": siguiente}

    # ----------------------------------------------------------- plataforma
    def _isins_y_modo(self, datos: dict) -> tuple[list[str], str]:
        isins = ops.extrae_isins(datos.get("texto"), datos.get("isins"))
        if not isins:
            raise ErrorPeticion(400, "No encuentro ningún ISIN")
        modo = str(datos.get("modo") or "alta").strip().lower()
        if modo not in ops_plataforma.MODOS:
            raise ErrorPeticion(400, f"modo desconocido: {modo} (alta | republish)")
        return isins, modo

    def _exige_plataforma(self) -> None:
        d = ops_plataforma.disponible(self.plataforma)
        if not (d["existe"] and d["scripts_ok"] and d["node_modules"] and d["npm"]):
            raise ErrorPeticion(503, "la plataforma de datos no está disponible en esta máquina", {"plataforma": d})

    def backup(self, _datos: dict) -> dict:
        self._exige_plataforma()

        def fn(t: ops.Tarea):
            return ops_plataforma.backup(self.plataforma, t.linea)
        return self._lanza("plataforma_backup", fn, {})

    def seco(self, datos: dict) -> dict:
        self._exige_plataforma()
        isins, modo = self._isins_y_modo(datos)
        clave = (modo, tuple(isins))

        def fn(t: ops.Tarea):
            res = ops_plataforma.pasada_en_seco(self.base, self.plataforma, isins, modo, t.linea)
            with self.lock:
                self.ultima_seco[clave] = {"escrituras": res["escrituras"], "run_id": res.get("run_id"), "tarea": t.id,
                                           "crear": res.get("crear")}
            return res
        return self._lanza("plataforma_seco", fn, {"isins": isins, "modo": modo})

    def escribir(self, datos: dict) -> dict:
        self._exige_plataforma()
        isins, modo = self._isins_y_modo(datos)
        clave = (modo, tuple(isins))
        with self.lock:
            previa = self.ultima_seco.get(clave)
        if not previa:
            raise ErrorPeticion(409, "primero la pasada en seco de estos mismos ISIN y modo")
        try:
            aprobacion = int(datos.get("aprobacion"))
        except (TypeError, ValueError):
            raise ErrorPeticion(400, "falta la aprobación: el número de escrituras de la pasada en seco") from None
        if aprobacion != previa["escrituras"]:
            raise ErrorPeticion(409, f"la pasada en seco previó {previa['escrituras']} escrituras y se han aprobado {aprobacion}")
        copia = ops_plataforma.ultimo_backup(self.plataforma)
        if not copia or not copia.get("vigente"):
            raise ErrorPeticion(409, "no hay copia de la maestra de las últimas 24 horas: haz la copia antes de escribir",
                                {"ultimo_backup": copia})

        def fn(t: ops.Tarea):
            res = ops_plataforma.escribir(self.base, self.plataforma, isins, modo, aprobacion, t.linea,
                                          esperados=previa.get("crear") if modo == "alta" else None)
            with self.lock:
                self.ultima_seco.pop(clave, None)
            return res
        return self._lanza("plataforma_escribir", fn, {"isins": isins, "modo": modo, "aprobacion": aprobacion})

    # ------------------------------------------------------- reclasificar
    def _isins_accion(self, datos: dict) -> list[str]:
        isins = ops.extrae_isins(datos.get("texto"), datos.get("isins"))
        if not isins:
            raise ErrorPeticion(400, "No encuentro ningún ISIN")
        tipos = {f["isin"].strip().upper(): (f.get("tipo") or "").strip() for f in ops.carga_fondos(self.base)}
        fuera = [i for i in isins if i not in tipos]
        if fuera:
            raise ErrorPeticion(400, f"no están en el universo: {', '.join(fuera)}")
        no_accion = [i for i in isins if tipos[i] != "accion"]
        if no_accion:
            raise ErrorPeticion(400, f"solo se reclasifica a acción: cambia antes el tipo a acción de {', '.join(no_accion)}")
        return isins

    def reclasificar_seco(self, datos: dict) -> dict:
        self._exige_plataforma()
        isins = self._isins_accion(datos)
        preparar = bool(datos.get("preparar", True))
        clave = ("reclasificar", tuple(isins))

        def fn(t: ops.Tarea):
            res = self._reclasificacion_en_seco(isins, preparar, t)
            with self.lock:
                self.ultima_seco[clave] = {"escrituras": res["reclasificables"], "run_id": res.get("run_id"), "tarea": t.id,
                                           "isins": [f["isin"] for f in res["filas"]
                                                     if f["accion"] in ops_plataforma.ACCIONES_RECLASIFICACION]}
            return res
        return self._lanza("plataforma_reclasificar_seco", fn, {"isins": isins, "preparar": preparar})

    def _reclasificacion_en_seco(self, isins: list[str], preparar: bool, t: ops.Tarea) -> dict:
        """Pasada en seco de la reclasificación. Con `preparar`, primero sin
        extraer nada: solo se extraen (por red) los ISIN cuyo canónico aún no es
        de acción; lo que la maestra ya tiene como acción, lo que no está en ella y
        lo que ya tiene canónico de acción no se vuelve a descargar."""
        if not preparar:
            return ops_plataforma.reclasificar(self.base, self.plataforma, isins, escribir=False, log_cb=t.linea)
        if not ops_plataforma.paquete_coherente(self.base)["coherente"]:
            t.linea("El canónico no es coherente: lo regenero (sin red) antes de la pasada en seco…")
            ops.canonico(self.base, isins, t.linea)
        res = ops_plataforma.reclasificar(self.base, self.plataforma, isins, escribir=False, log_cb=t.linea)
        pendientes = [f["isin"] for f in res["filas"] if f["accion"] == "SKIP" and f.get("razon") == "NO_STOCK_CANONICAL"]
        if not pendientes:
            t.linea("Nada que extraer: todos tienen ya canónico de acción, ya son acción en la maestra o no están en ella.")
            return res
        t.linea(f"Extrayendo como acción solo los que aún no tienen canónico de acción: {', '.join(pendientes)}")
        ops.extrae(self.base, pendientes, False, False, t.linea, t.avanza)
        t.linea("Regenerando el canónico…")
        ops.canonico(self.base, pendientes, t.linea)
        return ops_plataforma.reclasificar(self.base, self.plataforma, isins, escribir=False, log_cb=t.linea)

    def reclasificar_maestra(self, datos: dict) -> dict:
        self._exige_plataforma()
        isins = self._isins_accion(datos)
        clave = ("reclasificar", tuple(isins))
        with self.lock:
            previa = self.ultima_seco.get(clave)
        if not previa:
            raise ErrorPeticion(409, "primero la pasada en seco de la reclasificación de estos mismos ISIN")
        try:
            aprobacion = int(datos.get("aprobacion"))
        except (TypeError, ValueError):
            raise ErrorPeticion(400, "falta la aprobación: el número de activos a reclasificar de la pasada en seco") from None
        if aprobacion != previa["escrituras"]:
            raise ErrorPeticion(409, f"la pasada en seco encontró {previa['escrituras']} activo(s) a reclasificar y se han aprobado {aprobacion}")
        copia = ops_plataforma.ultimo_backup(self.plataforma)
        if not copia or not copia.get("vigente"):
            raise ErrorPeticion(409, "no hay copia de la maestra de las últimas 24 horas: haz la copia antes de reclasificar",
                                {"ultimo_backup": copia})

        def fn(t: ops.Tarea):
            res = ops_plataforma.reclasificar(self.base, self.plataforma, isins, escribir=True, log_cb=t.linea,
                                              esperado=aprobacion, esperados=previa.get("isins"))
            with self.lock:
                self.ultima_seco.pop(clave, None)
            return res
        return self._lanza("plataforma_reclasificar", fn, {"isins": isins, "aprobacion": aprobacion})

    def auditar(self, datos: dict) -> dict:
        self._exige_plataforma()
        isins = ops.extrae_isins(datos.get("texto"), datos.get("isins"))
        if not isins:
            raise ErrorPeticion(400, "No encuentro ningún ISIN")

        def fn(t: ops.Tarea):
            return ops_plataforma.auditar(self.base, self.plataforma, isins, t.linea)
        return self._lanza("plataforma_auditar", fn, {"isins": isins})

    # -------------------------------------------------------- correcciones
    def correcciones(self, isin: str | None = None) -> dict:
        from core.adquisicion import registro
        if isin is None:
            return {"correcciones": correcciones.lista(self.base),
                    "rutas_declaradas": correcciones.rutas_declaradas(registro.ADAPTADORES)}
        isin = isin.strip().upper()
        if not ops.RE_ISIN.match(isin):
            raise ErrorPeticion(400, f"ISIN no válido: {isin}")
        ficha = self._ficha_v2(isin)
        propias = correcciones.carga(self.base).get(isin) or {}
        return {"isin": isin, "con_ficha": ficha is not None,
                "correcciones": [{"isin": isin, "ruta": r, **c} for r, c in sorted(propias.items())],
                "campos": correcciones.campos(ficha, propias, registro.ADAPTADORES)}

    def corrige(self, datos: dict) -> dict:
        from core.schema import _get_path
        isin = str(datos.get("isin") or "").strip().upper()
        ruta = str(datos.get("ruta") or "").strip()
        if "valor" not in datos:
            raise ErrorPeticion(400, "falta «valor» (null borra el campo)")
        ficha = self._ficha_v2(isin) if ops.RE_ISIN.match(isin) else None
        actual = _get_path(ficha, ruta) if ficha and ruta else None
        try:
            # correcciones.pon (y quita) leen y reescriben correcciones.json bajo BLOQUEO_CONFIG.
            fila = correcciones.pon(self.base, isin, ruta, datos["valor"], str(datos.get("motivo") or ""),
                                    str(datos.get("autor") or ""), actual=actual,
                                    nueva=bool(datos.get("nueva")))
        except correcciones.ErrorCorreccion as e:
            raise ErrorPeticion(400, str(e)) from e
        return {"ok": True, "correccion": fila, "valor_actual": actual,
                "siguiente": "extraer el activo y regenerar el canónico para que la corrección llegue a la ficha y a la maestra"}

    def quita_correccion(self, isin: str, ruta: str) -> dict:
        isin = isin.strip().upper()
        if not correcciones.quita(self.base, isin, ruta):
            raise ErrorPeticion(404, f"no hay corrección de «{ruta}» para {isin}")
        return {"ok": True, "isin": isin, "ruta": ruta,
                "siguiente": "extraer el activo y regenerar el canónico para que vuelva el dato de la fuente"}

    def _ficha_v2(self, isin: str) -> dict | None:
        return ops._lee_json(self.base / "data" / "funds" / f"{isin}.json")

    # ------------------------------------------------------------ archivar
    def archivar_seco(self, datos: dict) -> dict:
        self._exige_plataforma()
        isins = ops.extrae_isins(datos.get("texto"), datos.get("isins"))
        if not isins:
            raise ErrorPeticion(400, "No encuentro ningún ISIN")
        motivo = str(datos.get("motivo") or "")
        clave = ("archivar", tuple(isins))

        def fn(t: ops.Tarea):
            res = ops_plataforma.archivar(self.base, self.plataforma, isins, escribir=False, motivo=motivo, log_cb=t.linea)
            with self.lock:
                self.ultima_seco[clave] = {"escrituras": res["archivables"], "run_id": res.get("run_id"), "tarea": t.id}
            return res
        return self._lanza("plataforma_archivar_seco", fn, {"isins": isins})

    def archivar(self, datos: dict) -> dict:
        self._exige_plataforma()
        isins = ops.extrae_isins(datos.get("texto"), datos.get("isins"))
        if not isins:
            raise ErrorPeticion(400, "No encuentro ningún ISIN")
        motivo = str(datos.get("motivo") or "")
        clave = ("archivar", tuple(isins))
        with self.lock:
            previa = self.ultima_seco.get(clave)
        if not previa:
            raise ErrorPeticion(409, "primero la pasada en seco del archivo de estos mismos ISIN")
        try:
            aprobacion = int(datos.get("aprobacion"))
        except (TypeError, ValueError):
            raise ErrorPeticion(400, "falta la aprobación: el número de activos a archivar de la pasada en seco") from None
        if aprobacion != previa["escrituras"]:
            raise ErrorPeticion(409, f"la pasada en seco encontró {previa['escrituras']} activo(s) y se han aprobado {aprobacion}")
        copia = ops_plataforma.ultimo_backup(self.plataforma)
        if not copia or not copia.get("vigente"):
            raise ErrorPeticion(409, "no hay copia de la maestra de las últimas 24 horas: haz la copia antes de archivar",
                                {"ultimo_backup": copia})

        def fn(t: ops.Tarea):
            archivo = ops_plataforma.archivar(self.base, self.plataforma, isins, escribir=True, motivo=motivo,
                                              log_cb=t.linea, esperado=aprobacion)
            with self.lock:
                self.ultima_seco.pop(clave, None)
            archivados = [f["isin"] for f in archivo["filas"] if (f.get("postverify") or {}).get("ok")]
            baja = None
            canonico = None
            if archivados:
                t.linea(f"Retirando del universo del extractor: {', '.join(archivados)}")
                baja = ops.baja(self.base, archivados, t.linea)
                t.linea("Regenerando el canónico sin los activos archivados…")
                canonico = ops.canonico(self.base, [], t.linea)
            elif archivo.get("escritura"):
                t.linea("Ningún activo superó la postverificación: el universo del extractor no se toca.")
            return {"archivo": archivo, "baja": baja, "canonico": canonico}
        return self._lanza("plataforma_archivar", fn, {"isins": isins, "aprobacion": aprobacion})

    def tarea(self, id_: str, desde: int) -> dict:
        t = self.cola.obtiene(id_)
        if t is None:
            raise ErrorPeticion(404, "tarea desconocida")
        return t.snapshot(desde=desde)


MENSAJE_401 = ("falta o no coincide X-Ops-Token. Arranca la app con iniciar-dev.bat, que le pasa el token "
               "(python main.py ops-token); si la app ya estaba abierta y el token ha cambiado (se regeneró "
               "config/ops_token.txt o cambió settings.json), ciérrala y vuelve a arrancarla con iniciar-dev.bat.")


class ErrorPeticion(Exception):
    def __init__(self, codigo: int, mensaje: str, extra: dict | None = None):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje
        self.extra = extra or {}


def _entero(q: dict, clave: str, defecto: int = 0) -> int:
    """Un parámetro entero de la query; si no es un número, 400 con su nombre."""
    valor = ((q.get(clave) or [""])[0] or "").strip()
    if not valor:
        return defecto
    try:
        return int(valor)
    except ValueError:
        raise ErrorPeticion(400, f"«{clave}» tiene que ser un número entero: {valor}") from None


def crea_manejador(servicio: Servicio):
    class Manejador(BaseHTTPRequestHandler):
        server_version = "fondosdb-ops/1"

        def log_message(self, *a):  # silencia el log por petición
            pass

        # ------------------------------------------------------- utilidades
        def _origen_permitido(self) -> str | None:
            origen = self.headers.get("Origin")
            if origen and origen in servicio.origenes:
                return origen
            return None

        def _cabeceras_cors(self) -> None:
            origen = self._origen_permitido()
            if origen:
                self.send_header("Access-Control-Allow-Origin", origen)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Ops-Token")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
                self.send_header("Access-Control-Max-Age", "600")

        def _json(self, obj, codigo: int = 200) -> None:
            cuerpo = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.send_header("Cache-Control", "no-store")
            self._cabeceras_cors()
            self.end_headers()
            self.wfile.write(cuerpo)

        def _cuerpo(self) -> dict:
            try:
                n = int(self.headers.get("Content-Length") or 0)
                if n > 1_000_000:
                    raise ErrorPeticion(413, "cuerpo demasiado grande")
                crudo = self.rfile.read(n) if n else b""
                self._cuerpo_leido = True
                datos = json.loads(crudo.decode("utf-8")) if n else {}
            except ValueError as e:
                raise ErrorPeticion(400, f"JSON no válido: {e}") from e
            if not isinstance(datos, dict):
                raise ErrorPeticion(400, "se esperaba un objeto JSON")
            return datos

        def _autoriza(self) -> None:
            # Host de este servidor: con DNS rebinding, una página ajena llega con
            # su propio nombre y, en los GET del mismo origen, sin cabecera
            # Origin; así leía estado, universo y registros (auditoría 16-10,
            # ALTA-15).
            host = self.headers.get("Host")
            if not red_local.host_local(host, self.server.server_address[1]):
                raise ErrorPeticion(403, f"Host no permitido: {(host or '').strip() or '(vacío)'}")
            origen = self.headers.get("Origin")
            if origen and not self._origen_permitido():
                raise ErrorPeticion(403, f"origen no permitido: {origen}")
            recibido = self.headers.get("X-Ops-Token") or ""
            if not hmac.compare_digest(recibido.encode("utf-8"), servicio.token.encode("utf-8")):
                raise ErrorPeticion(401, MENSAJE_401)

        def _descarta_cuerpo(self) -> None:
            # Un error antes de leer el cuerpo (Host, origen, token): se lee y se
            # descarta antes de contestar. Si el servidor cierra con datos sin
            # leer, Windows corta con un RST y el cliente puede no ver la respuesta.
            if getattr(self, "_cuerpo_leido", False):
                return
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return
            if 0 < n <= 1_000_000:
                self.rfile.read(n)
            self._cuerpo_leido = True

        def _despacha(self, fn) -> None:
            try:
                self._autoriza()
                self._json(fn())
            except ErrorPeticion as e:
                self._descarta_cuerpo()
                self._json({"ok": False, "error": e.mensaje, **e.extra}, e.codigo)
            except Exception as e:  # noqa: BLE001 - el servicio informa y sigue
                log.exception("ops_server: %s %s", self.command, self.path)
                self._descarta_cuerpo()
                self._json({"ok": False, "error": str(e)}, 500)

        # ---------------------------------------------------------- rutas
        def do_OPTIONS(self):
            self.send_response(204)
            self._cabeceras_cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            partes = urlsplit(self.path)
            ruta = partes.path.rstrip("/")
            q = parse_qs(partes.query)
            if ruta == "/api/ops/estado":
                self._despacha(servicio.estado)
            elif ruta == "/api/ops/universo":
                self._despacha(lambda: servicio.universo((q.get("q") or [""])[0]))
            elif ruta.startswith("/api/ops/ficha/"):
                self._despacha(lambda: servicio.ficha(ruta.rsplit("/", 1)[-1]))
            elif ruta == "/api/ops/plataforma/estado":
                self._despacha(servicio.plataforma_estado)
            elif ruta == "/api/ops/plataforma/corridas":
                self._despacha(lambda: {"corridas": ops_plataforma.corridas(servicio.base)})
            elif ruta == "/api/ops/correcciones":
                self._despacha(lambda: servicio.correcciones())
            elif ruta.startswith("/api/ops/correcciones/"):
                self._despacha(lambda: servicio.correcciones(unquote(ruta.rsplit("/", 1)[-1])))
            elif ruta == "/api/ops/tareas":
                self._despacha(lambda: {"tareas": servicio.cola.lista()})
            elif ruta.startswith("/api/ops/tareas/"):
                # `desde` se lee dentro de _despacha, ya autorizado: antes un
                # `?desde=abc` lanzaba ValueError fuera y cortaba la conexión.
                self._despacha(lambda: servicio.tarea(ruta.rsplit("/", 1)[-1], _entero(q, "desde")))
            else:
                self._json({"ok": False, "error": "no existe"}, 404)

        def do_POST(self):
            ruta = urlsplit(self.path).path.rstrip("/")
            acciones = {
                "/api/ops/alta": servicio.alta,
                "/api/ops/extraer": servicio.extraer,
                "/api/ops/canonico": servicio.canonico,
                "/api/ops/reclasificar": servicio.reclasificar,
                "/api/ops/plataforma/backup": servicio.backup,
                "/api/ops/plataforma/seco": servicio.seco,
                "/api/ops/plataforma/escribir": servicio.escribir,
                "/api/ops/plataforma/auditar": servicio.auditar,
                "/api/ops/plataforma/archivar-seco": servicio.archivar_seco,
                "/api/ops/plataforma/archivar": servicio.archivar,
                "/api/ops/plataforma/reclasificar-seco": servicio.reclasificar_seco,
                "/api/ops/plataforma/reclasificar": servicio.reclasificar_maestra,
                "/api/ops/correcciones": servicio.corrige,
            }
            accion = acciones.get(ruta)
            if accion is None:
                self._descarta_cuerpo()
                self._json({"ok": False, "error": "no existe"}, 404)
                return
            self._despacha(lambda: accion(self._cuerpo()))

        def do_DELETE(self):
            ruta = urlsplit(self.path).path.rstrip("/")
            prefijo = "/api/ops/correcciones/"
            partes = ruta[len(prefijo):].split("/", 1) if ruta.startswith(prefijo) else []
            if len(partes) != 2 or not partes[1]:
                self._json({"ok": False, "error": "no existe"}, 404)
                return
            self._despacha(lambda: servicio.quita_correccion(unquote(partes[0]), unquote(partes[1])))

    return Manejador


def crea_servidor(base: Path, puerto: int) -> ThreadingHTTPServer:
    servicio = Servicio(base)
    servidor = ThreadingHTTPServer(("127.0.0.1", puerto), crea_manejador(servicio))
    servidor.servicio = servicio  # type: ignore[attr-defined]
    return servidor


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--puerto", type=int, default=8766)
    args = p.parse_args(argv)
    try:
        servidor = crea_servidor(BASE, args.puerto)
    except (OSError, ConfigBloqueada, ops.TokenOpsInvalido) as e:
        # config/ no se puede escribir, el token no sirve, el puerto está ocupado…:
        # un mensaje, no un traceback (revisión, MEN-4).
        print(f"No se puede arrancar el servicio de operaciones: {e}", file=sys.stderr)
        return 1
    for linea in servidor.servicio.mensajes_arranque(servidor.server_address[1]):
        print(linea)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nParando.")
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
