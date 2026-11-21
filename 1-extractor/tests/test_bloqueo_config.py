# -*- coding: utf-8 -*-
"""Las escrituras leer-modificar-escribir de config/ no se pisan (MEDIA-8).

En el servicio `ops` el alta corre en la cola (hilo de fondo) y reclasificar y
las correcciones son peticiones síncronas, cada una en su hilo. Sin bloqueo,
una reclasificación que había leído fondos.csv antes de que el alta añadiera
una fila la borraba al reescribirlo, y dos correcciones a la vez perdían una.
Cada prueba congela la primera operación entre la lectura y la escritura y
comprueba que la segunda espera y que al final están las dos.
"""
import json
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import correcciones, ops  # noqa: E402
from tests.test_correcciones import ADAPTADORES  # noqa: E402
from tests.test_ops import _base  # noqa: E402

ESPERA = 0.3  # lo que se da a la segunda operación para colarse si no hubiera bloqueo


def _congela_lectura(monkeypatch, modulo, nombre: str, hilo: str):
    """Hace que `modulo.nombre` (la lectura) se pare en el hilo `hilo` hasta `sigue`."""
    leido, sigue = threading.Event(), threading.Event()
    original = getattr(modulo, nombre)

    def lectura(*a, **k):
        datos = original(*a, **k)
        if threading.current_thread().name == hilo:
            leido.set()
            assert sigue.wait(5)
        return datos
    monkeypatch.setattr(modulo, nombre, lectura)
    return leido, sigue


def _en_hilo(nombre: str, fn, *args) -> tuple[threading.Thread, list]:
    errores: list = []

    def corre():
        try:
            fn(*args)
        except Exception as e:  # noqa: BLE001 - se comprueba después
            errores.append(e)
    hilo = threading.Thread(target=corre, name=nombre, daemon=True)
    hilo.start()
    return hilo, errores


def test_un_alta_no_se_pierde_si_coincide_con_una_reclasificacion(tmp_path, monkeypatch):
    base = _base(tmp_path)
    leido, sigue = _congela_lectura(monkeypatch, ops, "carga_fondos", "reclasifica")

    reclasifica, err1 = _en_hilo("reclasifica", ops.reclasifica, base, "LU0000000001", "etf")
    assert leido.wait(5)                      # ya leyó fondos.csv y aún no lo ha reescrito
    alta, err2 = _en_hilo("alta", ops._anade_a_universo, base, "LU0000000002", "Fondo Dos", "fondo")
    alta.join(ESPERA)
    assert alta.is_alive()                    # el alta espera al bloqueo
    sigue.set()
    reclasifica.join(5)
    alta.join(5)

    assert not err1 and not err2
    filas = {f["isin"]: f["tipo"] for f in ops.carga_fondos(base)}
    assert filas == {"LU0000000001": "etf", "LU0000000002": "fondo"}


def test_una_baja_y_una_reclasificacion_a_la_vez_conservan_las_dos(tmp_path, monkeypatch):
    base = _base(tmp_path)
    ops._anade_a_universo(base, "LU0000000002", "Fondo Dos", "fondo")
    leido, sigue = _congela_lectura(monkeypatch, ops, "carga_fondos", "baja")

    baja, err1 = _en_hilo("baja", ops.baja, base, ["LU0000000002"])
    assert leido.wait(5)
    recl, err2 = _en_hilo("reclasifica", ops.reclasifica, base, "LU0000000001", "accion")
    recl.join(ESPERA)
    assert recl.is_alive()
    sigue.set()
    baja.join(5)
    recl.join(5)

    assert not err1 and not err2
    assert {f["isin"]: f["tipo"] for f in ops.carga_fondos(base)} == {"LU0000000001": "accion"}


def test_dos_correcciones_a_la_vez_no_pierden_ninguna(tmp_path, monkeypatch):
    base = _base(tmp_path)
    leido, sigue = _congela_lectura(monkeypatch, correcciones, "carga", "primera")

    primera, err1 = _en_hilo("primera", correcciones.pon, base, "LU0000000001", "riesgo.sri_kid_1a7",
                             4, "KID de 2026-02", "oscar", ADAPTADORES, 5)
    assert leido.wait(5)
    segunda, err2 = _en_hilo("segunda", correcciones.pon, base, "LU0000000001",
                             "identificacion.domicilio", "LUX", "folleto: Luxemburgo", "oscar",
                             ADAPTADORES, "IRL")
    segunda.join(ESPERA)
    assert segunda.is_alive()
    sigue.set()
    primera.join(5)
    segunda.join(5)

    assert not err1 and not err2
    guardadas = json.loads((base / "config" / "correcciones.json").read_text(encoding="utf-8"))
    assert sorted(guardadas["correcciones"]["LU0000000001"]) == [
        "identificacion.domicilio", "riesgo.sri_kid_1a7"]


def test_quitar_una_correccion_espera_a_la_que_se_esta_poniendo(tmp_path, monkeypatch):
    base = _base(tmp_path)
    correcciones.pon(base, "LU0000000001", "identificacion.domicilio", "LUX", "folleto", "oscar",
                     adaptadores=ADAPTADORES, actual="IRL")
    leido, sigue = _congela_lectura(monkeypatch, correcciones, "carga", "pon")

    pon, err1 = _en_hilo("pon", correcciones.pon, base, "LU0000000001", "riesgo.sri_kid_1a7",
                         4, "KID de 2026-02", "oscar", ADAPTADORES, 5)
    assert leido.wait(5)
    quita, err2 = _en_hilo("quita", correcciones.quita, base, "LU0000000001",
                           "identificacion.domicilio")
    quita.join(ESPERA)
    assert quita.is_alive()
    sigue.set()
    pon.join(5)
    quita.join(5)

    assert not err1 and not err2
    assert [f["ruta"] for f in correcciones.lista(base)] == ["riesgo.sri_kid_1a7"]


# --- app.py y main.py (auditoría 16-10, ALTA-17a) ---------------------------
# Escribían fondos.csv con open("a"/"w"), sin BLOQUEO_CONFIG ni
# escritura atómica. En app.py «Alta masiva» va en segundo plano (ops.alta,
# con bloqueo) mientras «Añadir» atiende peticiones síncronas.

def _sin_red(monkeypatch, tipo="etf"):
    from fetchers import eodhd, morningstar_lt
    monkeypatch.setattr(eodhd, "clasifica_isin", lambda isin, *a, **k: tipo)
    monkeypatch.setattr(morningstar_lt, "resuelve", lambda isin, *a, **k: {"nombre": f"Nombre {isin}"})


def _espia_escritura_atomica(monkeypatch) -> list:
    from core import package_integrity
    rutas: list = []
    original = package_integrity.atomic_write_text

    def espia(ruta, contenido, *a, **k):
        rutas.append(Path(ruta).name)
        return original(ruta, contenido, *a, **k)
    monkeypatch.setattr(package_integrity, "atomic_write_text", espia)
    return rutas


def test_el_alta_de_app_espera_a_una_reclasificacion_en_curso(tmp_path, monkeypatch):
    import app
    import main
    base = _base(tmp_path)
    monkeypatch.setattr(app, "BASE", base)
    monkeypatch.setattr(main, "BASE", base)
    _sin_red(monkeypatch)
    escrituras = _espia_escritura_atomica(monkeypatch)
    leido, sigue = _congela_lectura(monkeypatch, ops, "carga_fondos", "reclasifica")

    recl, err1 = _en_hilo("reclasifica", ops.reclasifica, base, "LU0000000001", "accion")
    assert leido.wait(5)
    alta, err2 = _en_hilo("alta_app", app.añade_fondo, "LU0000000002", "Fondo Dos", "fondo")
    alta.join(ESPERA)
    assert alta.is_alive()                    # el alta de app.py espera al bloqueo
    sigue.set()
    recl.join(5)
    alta.join(5)

    assert not err1 and not err2
    assert {f["isin"]: f["tipo"] for f in ops.carga_fondos(base)} == {
        "LU0000000001": "accion", "LU0000000002": "etf"}
    assert escrituras.count("fondos.csv") == 2
    assert app.añade_fondo("LU0000000002", "", "fondo") == "LU0000000002 ya estaba en la lista"


def test_reclasifica_de_main_no_pierde_un_alta_hecha_mientras_consulta(tmp_path, monkeypatch):
    import main
    from fetchers import eodhd
    base = _base(tmp_path)
    (base / "config" / "fondos.csv").write_text(
        "isin,nombre,tipo\nLU0000000001,Fondo Uno,fondo\nLU0000000002,,accion\n", encoding="utf-8")
    (base / "data" / "funds" / "LU0000000004.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(main, "BASE", base)
    escrituras = _espia_escritura_atomica(monkeypatch)

    def clasifica(isin, *a, **k):
        if isin == "LU0000000002":            # mientras se consulta, entra un alta
            ops.anade_a_universo(base, "LU0000000003", "Fondo Tres", "fondo")
        return "etf"
    monkeypatch.setattr(eodhd, "clasifica_isin", clasifica)

    assert main.cmd_reclasifica(None) == 0

    assert [(f["isin"], f["tipo"]) for f in ops.carga_fondos(base)] == [
        ("LU0000000001", "fondo"), ("LU0000000002", "etf"),
        ("LU0000000003", "fondo"), ("LU0000000004", "etf")]
    assert escrituras == ["fondos.csv", "fondos.csv"]


def test_add_de_main_pasa_por_el_alta_con_bloqueo(tmp_path, monkeypatch):
    import argparse

    import main
    base = _base(tmp_path)
    monkeypatch.setattr(main, "BASE", base)
    _sin_red(monkeypatch, tipo="fondo")
    escrituras = _espia_escritura_atomica(monkeypatch)
    args = argparse.Namespace(isins=["LU0000000002", "LU0000000001"], nombre="", tipo="fondo")
    with ops.BLOQUEO_CONFIG:
        hilo, err = _en_hilo("add", main.cmd_add, args)
        hilo.join(ESPERA)
        assert hilo.is_alive()
    hilo.join(5)

    assert not err and escrituras == ["fondos.csv"]
    assert [(f["isin"], f["nombre"]) for f in ops.carga_fondos(base)] == [
        ("LU0000000001", "Fondo Uno"), ("LU0000000002", "Nombre LU0000000002")]


def test_quitar_desde_app_espera_a_una_reclasificacion_en_curso(tmp_path, monkeypatch):
    # NUEVO-1: «Quitar» reescribía fondos.csv sin bloqueo y podía borrar las
    # filas que un alta en segundo plano acababa de añadir.
    import app
    base = _base(tmp_path)
    ops.anade_a_universo(base, "LU0000000002", "Fondo Dos", "fondo")
    monkeypatch.setattr(app, "BASE", base)
    leido, sigue = _congela_lectura(monkeypatch, ops, "carga_fondos", "reclasifica")

    recl, err1 = _en_hilo("reclasifica", ops.reclasifica, base, "LU0000000001", "etf")
    assert leido.wait(5)
    quita, err2 = _en_hilo("quitar", app.quita_fondo, "LU0000000002")
    quita.join(ESPERA)
    assert quita.is_alive()
    sigue.set()
    recl.join(5)
    quita.join(5)

    assert not err1 and not err2
    assert {f["isin"]: f["tipo"] for f in ops.carga_fondos(base)} == {"LU0000000001": "etf"}
