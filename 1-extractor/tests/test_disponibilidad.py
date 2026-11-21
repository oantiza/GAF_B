# -*- coding: utf-8 -*-
"""Los cinco estados de disponibilidad, y sobre todo los dos que se confunden (02-11-2026).

Con los casos reales que motivaron la pieza: las cinco espanolas que dejaron de cotizar,
las dos que estan fuera de alcance y siguen en la base, y el ISIN que ninguna fuente
resolvio nunca.
"""
import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adquisicion import disponibilidad as d  # noqa: E402

HOY = dt.date(2026, 11, 2)


def test_lo_normal_es_cotizar():
    assert d.decide(en_alcance=True, proveedor_contesto=True,
                    resuelve_ahora=True, resolvia_antes=True) == d.COTIZA


def test_el_alcance_manda_antes_que_todo_porque_no_se_pregunta():
    # LU1598757687 (ArcelorMittal) y FI4000297767: fuera por decision de Oscar.
    # A un instrumento fuera de alcance no se le piden datos, asi que no se puede
    # afirmar que cotice ni que no. El alcance va primero a proposito.
    for resuelve in (True, False):
        for contesto in (True, False):
            assert d.decide(en_alcance=False, proveedor_contesto=contesto,
                            resuelve_ahora=resuelve,
                            resolvia_antes=True) == d.FUERA_DE_ALCANCE


def test_dejo_de_cotizar_exige_que_el_proveedor_haya_contestado():
    # NH Hoteles (04-09) y Ercros (21-09): el proveedor contesta y ya no las resuelve,
    # y antes si. Esa es la unica combinacion que autoriza a decir que murio.
    assert d.decide(en_alcance=True, proveedor_contesto=True,
                    resuelve_ahora=False, resolvia_antes=True) == d.DEJO_DE_COTIZAR


def test_una_tarde_sin_red_NO_es_una_defuncion():
    # El estado que mas facil se confunde con el anterior, y el que mas dano hace:
    # sin esta rama, una caida de red marcaria medio catalogo como muerto.
    assert d.decide(en_alcance=True, proveedor_contesto=False,
                    resuelve_ahora=False, resolvia_antes=True) == d.SIN_DETERMINAR


def test_lo_que_nunca_se_resolvio_tampoco_es_una_defuncion():
    # La CAM no tuvo serie nunca. Marcarla como "dejo de cotizar" afirmaria que hubo un
    # antes que no existio.
    assert d.decide(en_alcance=True, proveedor_contesto=True,
                    resuelve_ahora=False, resolvia_antes=False) == d.NUNCA_RESUELTO


def test_los_cinco_estados_son_valores_distintos_y_ninguno_es_booleano():
    assert len(set(d.ESTADOS)) == 5
    assert all(isinstance(e, str) and e for e in d.ESTADOS)
    # Fundir los dos motivos de ausencia en uno repetiria el defecto que esto cierra.
    assert d.FUERA_DE_ALCANCE != d.DEJO_DE_COTIZAR
    assert d.SIN_DETERMINAR not in (d.DEJO_DE_COTIZAR, d.NUNCA_RESUELTO)


def test_ningun_estado_autoriza_a_borrar():
    # Un instrumento marcado deja de estar en el escaparate, no de existir: si un cliente
    # lo tuvo, su historia hace falta para sus informes.
    assert set(d.NUNCA_BORRAR) == set(d.ESTADOS)


def test_el_desde_no_se_pisa_mientras_el_estado_no_cambie():
    primera = d.marca(d.DEJO_DE_COTIZAR, hoy=dt.date(2026, 9, 4))
    assert primera["desde"] == "2026-09-04"
    despues = d.marca(d.DEJO_DE_COTIZAR, hoy=HOY, anterior=primera)
    # Lo que interesa de una accion que murio es el dia que dejo de resolverse, no el de
    # la ultima pasada.
    assert despues["desde"] == "2026-09-04"
    assert despues["visto"] == "2026-11-02"


def test_el_desde_se_renueva_cuando_el_estado_cambia_de_verdad():
    antes = d.marca(d.COTIZA, hoy=dt.date(2026, 7, 18))
    ahora = d.marca(d.FUERA_DE_ALCANCE, hoy=HOY, anterior=antes)
    assert ahora["desde"] == "2026-11-02"


def test_un_estado_inventado_se_rechaza_en_vez_de_colarse():
    with pytest.raises(ValueError):
        d.marca("no_disponible", hoy=HOY)
