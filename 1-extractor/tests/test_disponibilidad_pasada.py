# -*- coding: utf-8 -*-
"""De lo que ve una pasada a uno de los cinco estados, y cuando no se afirma nada.

Decision 14 de Oscar (02-11-2026), segunda parte: los cinco estados ya existian pero no
los escribia nadie. Aqui se prueba el puente -`desde_la_pasada`- y la pieza que le dice si
el instrumento resolvia antes, que es la que decide entre una defuncion y un "nunca".

Las dos pruebas que importan son las de callarse:

- `test_sin_saber_del_antes_no_se_elige` : el proveedor dice que no lo tiene y aqui no hay
  con que saber si lo tuvo. `DEJO_DE_COTIZAR` afirmaria una cotizacion anterior y
  `NUNCA_RESUELTO` que no la hubo. Es el caso real de cuatro de las cinco espanolas que
  dejaron de cotizar.
- `test_un_sin_determinar_anterior_no_borra_la_historia` : el fallo que tenia esta pieza al
  escribirla. Una tarde sin red deja la marca en `SIN_DETERMINAR`; si eso se lee como "no
  resolvia antes", a la pasada siguiente el instrumento pasa a `NUNCA_RESUELTO` y una
  empresa que cotizo anos queda escrita como si no hubiera existido.
"""
import io
import sys
import types
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import disponibilidad as d  # noqa: E402
from core.adquisicion.nucleo import _resolvia_antes  # noqa: E402


def estado(**kw):
    base = dict(en_alcance=True, contesto=True, resuelve_ahora=True, resolvia_antes=True)
    base.update(kw)
    return d.desde_la_pasada(**base)


def test_fuera_de_alcance_manda_sobre_todo_lo_demas():
    """A un instrumento fuera de alcance no se le pregunta, asi que no depende de respuestas."""
    assert estado(en_alcance=False) == d.FUERA_DE_ALCANCE
    assert estado(en_alcance=False, contesto=None, resuelve_ahora=False,
                  resolvia_antes=None) == d.FUERA_DE_ALCANCE


def test_si_no_se_pregunto_no_hay_marca():
    """El caso de los fondos y de una pasada sin red: el campo se queda ausente."""
    assert estado(contesto=None) is None
    assert estado(contesto=None, resuelve_ahora=False) is None


def test_lo_normal_es_cotizar():
    assert estado() == d.COTIZA


def test_si_no_contesto_no_es_una_defuncion():
    assert estado(contesto=False, resuelve_ahora=False) == d.SIN_DETERMINAR
    assert estado(contesto=False, resuelve_ahora=False, resolvia_antes=None) == d.SIN_DETERMINAR


def test_sin_saber_del_antes_no_se_elige():
    """Ni defuncion ni 'nunca': ninguna de las dos esta probada, asi que no hay marca."""
    assert estado(resuelve_ahora=False, resolvia_antes=None) is None


def test_con_el_antes_probado_si_se_elige():
    assert estado(resuelve_ahora=False, resolvia_antes=True) == d.DEJO_DE_COTIZAR
    assert estado(resuelve_ahora=False, resolvia_antes=False) == d.NUNCA_RESUELTO


# --- la prueba del "antes", que es de donde sale resolvia_antes ---

def ctx(base):
    return types.SimpleNamespace(base=base)


def test_la_marca_anterior_manda_cuando_dice_algo(tmp_path):
    c = ctx(tmp_path)
    assert _resolvia_antes("ES0000000001", c, None, {"estado": d.COTIZA}) is True
    assert _resolvia_antes("ES0000000001", c, None, {"estado": d.DEJO_DE_COTIZAR}) is True
    assert _resolvia_antes("ES0000000001", c, None, {"estado": d.NUNCA_RESUELTO}) is False


def test_un_sin_determinar_anterior_no_borra_la_historia(tmp_path):
    """El fallo que tenia esta pieza: un intento fallido no afirma nada de la cotizacion."""
    c = ctx(tmp_path)
    ficha = {"valoracion": {"vl": 12.5}}
    assert _resolvia_antes("ES0000000001", c, ficha, {"estado": d.SIN_DETERMINAR}) is True
    assert _resolvia_antes("ES0000000001", c, ficha, {"estado": d.FUERA_DE_ALCANCE}) is True
    # Y sin ninguna otra prueba, sigue siendo "no se sabe" y no un "no".
    assert _resolvia_antes("ES0000000001", c, None, {"estado": d.SIN_DETERMINAR}) is None


def test_la_ficha_anterior_con_vl_prueba_que_resolvia(tmp_path):
    c = ctx(tmp_path)
    assert _resolvia_antes("ES0000000001", c, {"valoracion": {"vl": 1.0}}, {}) is True
    assert _resolvia_antes("ES0000000001", c, {"valoracion": {}}, {}) is None


def test_el_historico_en_disco_tambien_prueba(tmp_path):
    """Cubre al instrumento que perdio la ficha pero dejo serie (ES0161560018)."""
    hist = tmp_path / "data" / "history"
    hist.mkdir(parents=True)
    with io.open(hist / "ES0161560018.jsonl", "w", encoding="utf-8") as f:
        f.write('{"fecha": "2026-09-21", "vl": 3.4}\n')
    assert _resolvia_antes("ES0161560018", ctx(tmp_path), None, {}) is True
    assert _resolvia_antes("ES0000000002", ctx(tmp_path), None, {}) is None


def test_un_historico_vacio_no_prueba_nada(tmp_path):
    hist = tmp_path / "data" / "history"
    hist.mkdir(parents=True)
    (hist / "ES0000000003.jsonl").touch()
    assert _resolvia_antes("ES0000000003", ctx(tmp_path), None, {}) is None
