# -*- coding: utf-8 -*-
"""Lo que se deriva del nombre de la clase: la cobertura de divisa (core/derivados.py).

Una clase cubierta medida contra un índice sin cubrir no mide gestión: la diferencia es la
cobertura (medido el 04-11-2026: beta 0,86 y R² del 79 % de un fondo índice contra su propio
índice). Por eso `clase_cubierta` decide si se calculan relativas, y un falso «no cubierta» es
una cifra publicada que no es el gestor.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import derivados  # noqa: E402


def _cubierta(nombre):
    d = {"identificacion": {"nombre": nombre}}
    derivados._cobertura_divisa(d)
    return d["identificacion"].get("clase_cubierta"), d["identificacion"].get("divisa_cubierta")


@pytest.mark.parametrize("nombre", [
    # Las dos clases de Morgan Stanley que el 07-11-2026 pasaban por sin cubrir, y cuyo KID dice
    # «clase de participaciones con cobertura cambiaria» (decisión 27).
    "Morgan Stanley Investment Funds - US Advantage Fund AH (EUR)",
    "Morgan Stanley Investment Funds - Global Fixed Income Opportunities Fund AH (EUR)",
    "Fondo Z ZH (EUR) Acc",
])
def test_la_clase_con_la_H_pegada_y_la_divisa_entre_parentesis_es_cubierta(nombre):
    assert _cubierta(nombre) == (True, "EUR")


@pytest.mark.parametrize("nombre", [
    "Morgan Stanley Investment Funds - US Advantage Fund A (EUR)",
    "AB SICAV I - Select US Equity Portfolio A EUR Acc",
    "Fondo A (EUR) Acc",
])
def test_una_clase_sin_senal_de_cobertura_no_es_cubierta(nombre):
    assert _cubierta(nombre) == (False, None)


@pytest.mark.parametrize("nombre,divisa", [
    ("Vanguard Global Stock Index EUR Hedged Acc", "EUR"),
    ("Fondo B H USD", "USD"),
    ("Fondo C (H) EUR", None),
])
def test_los_patrones_de_siempre_siguen_valiendo(nombre, divisa):
    cubierta, div = _cubierta(nombre)
    assert cubierta is True
    if divisa:
        assert div == divisa
