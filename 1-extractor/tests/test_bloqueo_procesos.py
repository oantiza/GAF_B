# -*- coding: utf-8 -*-
"""Las escrituras de config/ no se pisan entre procesos (decisión de Óscar, 17-10, 6.7c).

`BLOQUEO_CONFIG` es un `RLock`: solo ordena los hilos de un proceso. El servicio
`ops`, la interfaz `app.py` y la CLI son procesos distintos y escriben los mismos
ficheros (`fondos.csv`, `correcciones.json`). `bloqueo_config`
añade un bloqueo de fichero (`config/.bloqueo`, `msvcrt` o `fcntl`).

Las pruebas lanzan procesos de Python de verdad sobre una base en `tmp_path`.
"""
import os
import subprocess
import sys
import textwrap
import threading
import time
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import ops, package_integrity  # noqa: E402
from tests.test_ops import _base  # noqa: E402


def _proceso(codigo: str, *args: str) -> subprocess.Popen:
    preambulo = f"import sys; sys.path.insert(0, {str(RAIZ)!r})\n"
    return subprocess.Popen([sys.executable, "-c", preambulo + textwrap.dedent(codigo), *args],
                            cwd=str(RAIZ), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


RETIENE = """
    import time
    from pathlib import Path
    from core.package_integrity import bloqueo_config
    base, listo, segundos = Path(sys.argv[1]), Path(sys.argv[2]), float(sys.argv[3])
    with bloqueo_config(base):
        listo.write_text("si", encoding="utf-8")
        time.sleep(segundos)
"""


def _espera_fichero(ruta: Path, proceso: subprocess.Popen) -> None:
    for _ in range(200):
        if ruta.exists():
            return
        assert proceso.poll() is None, proceso.communicate()
        time.sleep(0.05)
    raise AssertionError("el otro proceso no llegó a coger el bloqueo")


def test_si_otro_proceso_tiene_config_se_espera_y_se_avisa_claro(tmp_path, monkeypatch):
    base = _base(tmp_path)
    antes = (base / "config" / "fondos.csv").read_bytes()
    otro = _proceso(RETIENE, str(base), str(tmp_path / "listo"), "3")
    try:
        _espera_fichero(tmp_path / "listo", otro)
        monkeypatch.setattr(package_integrity, "ESPERA_BLOQUEO_S", 0.5)
        t0 = time.monotonic()
        with pytest.raises(package_integrity.ConfigBloqueada) as exc:
            ops.anade_a_universo(base, "LU0000000002", "Fondo Dos", "fondo")
        assert time.monotonic() - t0 >= 0.45                       # esperó antes de rendirse
        mensaje = str(exc.value)
        assert "bloqueada por otro proceso" in mensaje and "no se ha escrito nada" in mensaje
        assert (base / "config" / "fondos.csv").read_bytes() == antes
    finally:
        otro.wait(10)
    # en cuanto el otro termina, se puede escribir
    assert ops.anade_a_universo(base, "LU0000000002", "Fondo Dos", "fondo") is True


def test_se_espera_a_que_el_otro_proceso_termine(tmp_path):
    base = _base(tmp_path)
    otro = _proceso(RETIENE, str(base), str(tmp_path / "listo"), "1")
    try:
        _espera_fichero(tmp_path / "listo", otro)
        t0 = time.monotonic()
        assert ops.anade_a_universo(base, "LU0000000002", "Fondo Dos", "fondo") is True
        assert time.monotonic() - t0 >= 0.3                        # esperó al otro
    finally:
        otro.wait(10)
    assert [f["isin"] for f in ops.carga_fondos(base)] == ["LU0000000001", "LU0000000002"]


ALTAS = """
    from pathlib import Path
    from core import ops
    base, letra = Path(sys.argv[1]), sys.argv[2]
    for i in range(25):
        ops.anade_a_universo(base, f"LU{letra}{i:08d}0", f"Fondo {letra}{i}", "fondo")
        if i % 5 == 0:
            ops.reclasifica(base, "LU0000000001", "etf" if i % 10 else "fondo")
    print("hecho")
"""


def test_dos_procesos_dando_de_alta_y_reclasificando_a_la_vez_no_pierden_filas(tmp_path):
    base = _base(tmp_path)
    procesos = [_proceso(ALTAS, str(base), letra) for letra in "AB"]
    salidas = [p.communicate(timeout=120) for p in procesos]
    for p, (out, err) in zip(procesos, salidas):
        assert p.returncode == 0, err
        assert out.strip() == "hecho"
    isins = [f["isin"] for f in ops.carga_fondos(base)]
    assert len(isins) == 1 + 2 * 25 and len(set(isins)) == len(isins)
    assert {f"LU{letra}{i:08d}0" for letra in "AB" for i in range(25)} <= set(isins)


def test_el_bloqueo_es_reentrante_en_el_mismo_proceso(tmp_path):
    base = _base(tmp_path)
    with package_integrity.bloqueo_config(base, espera=0.2):
        with package_integrity.bloqueo_config(base, espera=0.2):
            assert ops.anade_a_universo(base, "LU0000000002", "Fondo Dos", "fondo") is True
    # y se libera: otro proceso lo coge enseguida
    otro = _proceso(RETIENE, str(base), str(tmp_path / "listo"), "0")
    _espera_fichero(tmp_path / "listo", otro)
    assert otro.wait(10) == 0


# --- Sexta pasada: lectores sin bloqueo (IMP-1), y copias de config/ (MEN-7)

LECTOR = """
    import time
    from pathlib import Path
    from core import correcciones, ops
    from core.adquisicion import registro
    base, alto = Path(sys.argv[1]), Path(sys.argv[2])
    n = err = 0
    fin = time.monotonic() + 60
    while not alto.exists() and time.monotonic() < fin:
        try:
            ops.carga_fondos(base)
            registro._isins_es(base)
            correcciones.carga(base)
            n += 1
        except Exception as e:
            err += 1
            print("error:", type(e).__name__, e)
    print(f"lecturas={n} errores={err}")
"""


def test_lectores_concurrentes_no_hacen_fallar_las_altas(tmp_path):
    # Revisión de la quinta pasada, IMP-1: en Windows no se puede reemplazar un
    # fichero que otro proceso tiene abierto, aunque solo lo lea. Con dos
    # lectores en bucle fallaban 146 de 150 altas.
    base = _base(tmp_path)
    (base / "config" / "fondos.csv").write_text("isin,nombre,tipo\n" + "".join(
        f"LU{i:09d}0,Fondo {i},fondo\n" for i in range(300)), encoding="utf-8")
    alto = tmp_path / "alto"
    lectores = [_proceso(LECTOR, str(base), str(alto)) for _ in range(2)]
    try:
        time.sleep(1.0)
        resultados = [ops.anade_a_universo(base, f"LUW{i:08d}0", f"W{i}", "fondo") for i in range(60)]
    finally:
        alto.write_text("si", encoding="utf-8")
        salidas = [p.communicate(timeout=60) for p in lectores]
    assert all(resultados)
    assert len(ops.carga_fondos(base)) == 360
    for out, err in salidas:
        assert "errores=0" in out, out + err
        assert int(out.split("lecturas=")[1].split()[0]) > 0


@pytest.mark.skipif(os.name != "nt", reason="el reemplazo con el destino abierto solo falla en Windows")
def test_el_reemplazo_reintenta_y_si_sigue_abierto_lo_dice_claro(tmp_path, monkeypatch):
    destino = tmp_path / "fondos.csv"
    destino.write_text("viejo\n", encoding="utf-8")
    abierto = destino.open("rb")                  # un lector que tarda en cerrar
    threading.Timer(0.3, abierto.close).start()
    package_integrity.atomic_write_text(destino, "nuevo\n")
    assert destino.read_text(encoding="utf-8") == "nuevo\n"

    monkeypatch.setattr(package_integrity, "REINTENTOS_REEMPLAZO", 3)
    with destino.open("rb"):
        with pytest.raises(PermissionError, match="otro programa lo tiene abierto"):
            package_integrity.atomic_write_text(destino, "otro\n")
    assert destino.read_text(encoding="utf-8") == "nuevo\n"   # no se ha cambiado nada
    assert not list(tmp_path.glob(".*.tmp"))                 # ni queda el temporal


def test_config_se_puede_copiar_mientras_otro_proceso_la_bloquea(tmp_path):
    # MEN-7: msvcrt bloqueaba el byte 0 de config/.bloqueo y copiar config/
    # fallaba mientras duraba una escritura. Además, la copia no se lleva lo efímero.
    import shutil

    base = _base(tmp_path)
    (base / "config" / "ops_token.txt").write_text("t" * 43 + "\n", encoding="utf-8")
    (base / "config" / ".fondos.csv.abc.tmp").write_text("temporal", encoding="utf-8")
    otro = _proceso(RETIENE, str(base), str(tmp_path / "listo"), "3")
    try:
        _espera_fichero(tmp_path / "listo", otro)
        (base / "config" / package_integrity.FICHERO_BLOQUEO).read_bytes()    # se puede leer
        shutil.copytree(base / "config", tmp_path / "copia")                  # y copiar entero
        shutil.copytree(base / "config", tmp_path / "copia_limpia", ignore=package_integrity.ignora_efimeros())
    finally:
        otro.wait(10)
    assert sorted(p.name for p in (tmp_path / "copia_limpia").iterdir()) == ["fondos.csv", "settings.json"]
