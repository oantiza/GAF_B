"""Primitivas compartidas para publicar paquetes completos y verificables."""
from __future__ import annotations

import contextlib
import hashlib
import os
import threading
import time
from pathlib import Path
from typing import Iterator
from uuid import uuid4

# Bloqueo de las escrituras leer-modificar-escribir de `config/` (fondos.csv y
# correcciones.json) dentro de un proceso. En el servicio `ops` el alta corre en
# la cola (un hilo de fondo) mientras reclasificar y las correcciones son
# peticiones síncronas, cada una en su hilo de ThreadingHTTPServer: sin él, una
# reclasificación que leyó fondos.csv antes de que el alta añadiera una fila la
# borraba al reescribirlo, y dos correcciones a la vez perdían una (MEDIA-8,
# auditoría 13-10). Reentrante para que una operación pueda llamar a otra.
# Entre procesos (CLI `main.py`, `app.py`, servicio `ops`) lo cubre
# `bloqueo_config`, que es lo que deben usar las escrituras.
BLOQUEO_CONFIG = threading.RLock()

# Bloqueo de fichero entre procesos (decisión de Óscar, 17-10, 6.7c).
FICHERO_BLOQUEO = ".bloqueo"
ESPERA_BLOQUEO_S = 30.0
# En Windows, `msvcrt.locking` bloquea de forma obligatoria los bytes que toca:
# se bloquea uno muy por detrás del final para que leer o copiar `config/`
# (también `.bloqueo`) no falle mientras dura una escritura (revisión, MEN-7).
_POSICION_BLOQUEO = 2 ** 30
# Lo que no se copia al hacer una copia de `config/`: el bloqueo, el token del
# servicio `ops` y los temporales de `atomic_write_text` (revisión, MEN-7).
EFIMEROS_CONFIG = (FICHERO_BLOQUEO, "ops_token.txt", ".*.tmp")
# Reemplazo atómico en Windows: falla con PermissionError si otro proceso tiene
# el destino abierto, aunque sea para leer. Se reintenta (revisión, IMP-1).
REINTENTOS_REEMPLAZO = 20
PAUSA_REEMPLAZO_S = 0.05
_TENIDOS: dict[str, list] = {}       # ruta del bloqueo -> [fichero abierto, profundidad]


class ConfigBloqueada(RuntimeError):
    """Otro proceso tiene `config/` bloqueado más tiempo del que se espera."""


@contextlib.contextmanager
def bloqueo_config(base: Path, espera: float | None = None) -> Iterator[None]:
    """`BLOQUEO_CONFIG` (entre hilos) más un bloqueo de fichero (entre procesos).

    `ops`, `app.py` y la CLI escriben en `config/` (`fondos.csv`,
    `correcciones.json`, el token de `ops`), y el `RLock` no se
    ve desde otro proceso. El de fichero es `config/.bloqueo`: con `msvcrt` en
    Windows y `fcntl` en POSIX. Lo libera el sistema si el proceso muere. Es
    reentrante en el mismo proceso, como el `RLock`. Si otro proceso lo tiene
    más de `espera` segundos (30 por defecto), lanza `ConfigBloqueada` con un
    mensaje que dice qué hacer."""
    ruta = (Path(base) / "config" / FICHERO_BLOQUEO).resolve()
    clave = str(ruta)
    with BLOQUEO_CONFIG:
        tenido = _TENIDOS.get(clave)
        if tenido is None:
            limite = ESPERA_BLOQUEO_S if espera is None else espera
            tenido = _TENIDOS[clave] = [_bloquea_fichero(ruta, limite), 0]
        tenido[1] += 1
        try:
            yield
        finally:
            tenido[1] -= 1
            if tenido[1] == 0:
                del _TENIDOS[clave]
                _libera_fichero(tenido[0])


def ignora_efimeros():
    """`ignore` para `shutil.copytree` de `config/`: sin `EFIMEROS_CONFIG`."""
    import shutil

    return shutil.ignore_patterns(*EFIMEROS_CONFIG)


def _intenta(fh) -> None:
    if os.name == "nt":
        import msvcrt
        fh.seek(_POSICION_BLOQUEO)
        msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def _bloquea_fichero(ruta: Path, espera: float):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    fh = open(ruta, "a+b")
    try:
        limite = time.monotonic() + espera
        while True:
            try:
                _intenta(fh)
                return fh
            except OSError:
                if time.monotonic() >= limite:
                    raise ConfigBloqueada(
                        f"config/ está bloqueada por otro proceso (la interfaz app.py, el servicio de "
                        f"operaciones o una orden de main.py) desde hace más de {espera:g} s, así que no "
                        f"se ha escrito nada. Espera a que termine y repite la operación; el bloqueo se "
                        f"libera solo cuando ese proceso acaba. Fichero de bloqueo: {ruta}") from None
                time.sleep(0.05)
    except BaseException:
        fh.close()
        raise


def _libera_fichero(fh) -> None:
    try:
        if os.name == "nt":
            import msvcrt
            fh.seek(_POSICION_BLOQUEO)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass                         # al cerrar se libera igualmente
    finally:
        fh.close()


def atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temp.open("w", encoding=encoding, newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        reemplaza(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def reemplaza(origen: Path, destino: Path) -> None:
    """`os.replace` con reintentos ante `PermissionError`.

    En Windows no se puede reemplazar un fichero que otro proceso tiene abierto,
    aunque solo lo lea: el bloqueo de `config/` lo toman los escritores, no los
    lectores. Con dos lectores en bucle fallaban 146 de 150 altas, y `ops.alta`
    cortaba el lote entero (revisión de la quinta pasada, IMP-1). Se reintenta
    `REINTENTOS_REEMPLAZO` veces cada `PAUSA_REEMPLAZO_S`; si el destino sigue
    abierto (Excel, un editor), error claro sin haber cambiado nada."""
    origen, destino = Path(origen), Path(destino)
    for intento in range(REINTENTOS_REEMPLAZO):
        try:
            origen.replace(destino)
            return
        except PermissionError as e:
            if intento == REINTENTOS_REEMPLAZO - 1:
                raise PermissionError(
                    f"No se pudo escribir {destino}: otro programa lo tiene abierto desde hace más de "
                    f"{REINTENTOS_REEMPLAZO * PAUSA_REEMPLAZO_S:g} s (¿Excel o un editor?). No se ha "
                    f"cambiado nada: ciérralo y repite la operación.") from e
            time.sleep(PAUSA_REEMPLAZO_S)


def lee_bytes(ruta: Path) -> bytes:
    """Lee un fichero de una vez y lo cierra enseguida, con los mismos reintentos.

    Los lectores de `config/` lo usan para tener el fichero abierto el menor
    tiempo posible: un lector que lo tiene abierto es lo que hace fallar el
    reemplazo de un escritor en Windows (IMP-1). Y si lo pilla justo en el
    reemplazo, reintenta en vez de fallar."""
    ruta = Path(ruta)
    for intento in range(REINTENTOS_REEMPLAZO):
        try:
            return ruta.read_bytes()
        except PermissionError:
            if intento == REINTENTOS_REEMPLAZO - 1:
                raise
            time.sleep(PAUSA_REEMPLAZO_S)
    raise AssertionError("inalcanzable")


def lee_csv(ruta: Path) -> list[dict]:
    """Las filas de un CSV de `config/` (UTF-8 con o sin BOM), leído de una vez."""
    import csv
    import io

    texto = lee_bytes(ruta).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(texto, newline="")))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def line_count(path: Path) -> int:
    with Path(path).open("rb") as handle:
        return sum(1 for line in handle if line.strip())


def file_record(path: Path, *, count_lines: bool = False) -> dict:
    record = {"bytes": Path(path).stat().st_size, "sha256": sha256_file(path)}
    if count_lines:
        record["line_count"] = line_count(path)
    return record


def source_snapshot_id(funds_dir: Path) -> str:
    """Id determinista: export y export_bdb coinciden si leen el mismo snapshot."""
    digest = hashlib.sha256()
    for path in sorted(Path(funds_dir).glob("*.json")):
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(sha256_file(path).encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()
