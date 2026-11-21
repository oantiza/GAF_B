# -*- coding: utf-8 -*-
"""MET-5 (auditoría integral del 16-11-2026): las pruebas del método comprueban EL VALOR.

Hasta aquí, la prueba del Sharpe mensual comprobaba que era un número; la del Sortino, que salía
por encima del Sharpe; y la de la volatilidad recalculaba la cifra con la misma fórmula que el
código. Con el tipo sin riesgo mal medido (MET-1) las tres habrían pasado igual.

Cada cifra esperada de este fichero sale de una cuenta hecha a mano, escrita en su comentario, y
ninguna se calcula con una función del módulo que se prueba.
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import metricas as m  # noqa: E402

# Trece cierres de mes, del 30-09-2025 al 30-09-2026: doce rentabilidades mensuales, la ventana de un año.
CIERRES = [date(2025, 9, 30), date(2025, 10, 31), date(2025, 11, 30), date(2025, 12, 31),
           date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30),
           date(2026, 5, 31), date(2026, 6, 30), date(2026, 7, 31), date(2026, 8, 31),
           date(2026, 9, 30)]

# El €STR al 3,6 % todos los días naturales: cada noche rinde 0,036/360 = 0,0001 justo (x).
# Un tramo de d noches rinde (1 + x)^d − 1 = d·x + d(d−1)/2·x² + d(d−1)(d−2)/6·x³ + …:
#   d = 31:  0,0031 + 465·10⁻⁸ + 4.495·10⁻¹² + 3·10⁻¹² = 0,003104654498
#   d = 30:  0,0030 + 435·10⁻⁸ + 4.060·10⁻¹² + 3·10⁻¹² = 0,003004354063
#   d = 28:  0,0028 + 378·10⁻⁸ + 3.276·10⁻¹² + 2·10⁻¹² = 0,002803783278
RF_DE_UN_TRAMO = {31: 0.003104654498, 30: 0.003004354063, 28: 0.002803783278}
ESTR_AL_3_6 = [(date(2025, 9, 1) + timedelta(days=i), 3.6) for i in range(400)]


def _fondo_con_exceso(excesos):
    """Un fondo que cada mes rinde lo que el €STR en esos mismos días MÁS el exceso que se le diga.

    El tipo de cada mes es la constante de arriba, escrita a mano: no se le pregunta al módulo."""
    serie, vl = [(CIERRES[0], 100.0)], 100.0
    for (a, b), exceso in zip(zip(CIERRES, CIERRES[1:]), excesos):
        vl *= 1 + RF_DE_UN_TRAMO[(b - a).days] + exceso
        serie.append((b, vl))
    return serie


def test_la_volatilidad_mensual_de_una_serie_que_alterna_mas_y_menos_uno_por_ciento():
    """36 rentabilidades mensuales, 18 de +1 % y 18 de −1 %. La media es 0 justo.

        varianza muestral = 36 × 0,01² / 35 = 0,0036 / 35 = 0,000102857
        desviación        = 0,0101419
        anualizada        = 0,0101419 × √12 = √(0,0036 × 12 / 35) = √0,0012342857 = 0,0351324

    En tanto por ciento, 3,5132."""
    precios, p = [100.0], 100.0
    for i in range(36):
        p *= 1.01 if i % 2 == 0 else 0.99
        precios.append(p)
    serie, y, mo = [], 2023, 9
    for precio in precios:
        serie.append((m.ultimo_dia(date(y, mo, 1)), precio))
        y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    r = m.riesgo(serie, None, serie[-1][0])
    assert r["3a"]["volatilidad"] == pytest.approx(3.5132, abs=1e-4)
    # Y a un año, con las 12 últimas (6 y 6): √(0,0012 × 12 / 11) = √0,00130909 = 0,0361814 → 3,6181.
    assert r["1a"]["volatilidad"] == pytest.approx(3.6181, abs=1e-4)


def test_el_sharpe_y_el_sortino_de_un_fondo_con_exceso_conocido_sobre_el_estr():
    """Doce meses con exceso sobre el €STR de +2 % y −1 % alternos (seis y seis).

        media del exceso            = (6 × 0,02 − 6 × 0,01) / 12 = 0,005
        desviación muestral         = cada mes se aparta 0,015 de la media:
                                      √(12 × 0,015² / 11) = √(0,0027 / 11) = 0,0156670
        Sharpe = 0,005 × 12 / (0,0156670 × √12) = 0,06 / 0,0542720 = √11 / 3 = 1,1055

        desviación a la baja        = solo cuentan los seis meses de −0,01, sobre los doce:
                                      √(6 × 0,01² / 12) = √0,00005 = 0,0070711
        Sortino = 0,005 × 12 / (0,0070711 × √12) = 0,06 / 0,0244949 = √6 = 2,4495

        tipo publicado de la ventana = lo que rindió el €STR en los doce tramos (siete de 31
        días, cuatro de 30 y uno de 28), que es su media por 12:
            7 × 0,003104654498 + 4 × 0,003004354063 + 0,002803783278 = 0,036553781 → 3,6554 %

    Con la versión 2, que restaba el 3,6 % entre 12 (0,003 justos cada mes), el exceso medio salía
    0,00504615 y el Sharpe 1,1176: esta prueba la habría parado. La de antes, no."""
    serie = _fondo_con_exceso([0.02, -0.01] * 6)
    r = m.riesgo(serie, ESTR_AL_3_6, serie[-1][0])["1a"]
    assert r["sharpe"] == pytest.approx(1.1055, abs=1e-4)
    assert r["sortino"] == pytest.approx(2.4495, abs=1e-4)
    assert r["rf"] == pytest.approx(3.6554, abs=1e-4)


def test_con_un_exceso_negativo_el_sharpe_y_el_sortino_salen_negativos_y_con_su_valor():
    """Los mismos doce meses al revés: −2 % y +1 % alternos.

        media del exceso  = −0,005, y la desviación muestral es la misma, 0,0156670
        Sharpe            = −√11 / 3 = −1,1055
        desviación a la baja = √(6 × 0,02² / 12) = √0,0002 = 0,0141421
        Sortino           = −0,06 / (0,0141421 × √12) = −0,06 / 0,0489898 = −1,2247  (−√6 / 2)

    El Sortino sale por DEBAJO del Sharpe: las bajadas son las grandes. La prueba anterior solo
    comprobaba «Sortino mayor que Sharpe», que aquí es falso y es lo correcto."""
    serie = _fondo_con_exceso([-0.02, 0.01] * 6)
    r = m.riesgo(serie, ESTR_AL_3_6, serie[-1][0])["1a"]
    assert r["sharpe"] == pytest.approx(-1.1055, abs=1e-4)
    assert r["sortino"] == pytest.approx(-1.2247, abs=1e-4)


def test_el_tipo_de_un_tramo_es_el_que_dice_la_cuenta_a_mano():
    """Las tres constantes de arriba, contra el módulo: si esto falla, el fallo es del tipo y no del ratio."""
    assert m.rf_entre(ESTR_AL_3_6, date(2025, 9, 30), date(2025, 10, 31)) == pytest.approx(0.003104654498, abs=1e-12)
    assert m.rf_entre(ESTR_AL_3_6, date(2025, 10, 31), date(2025, 11, 30)) == pytest.approx(0.003004354063, abs=1e-12)
    assert m.rf_entre(ESTR_AL_3_6, date(2026, 1, 31), date(2026, 2, 28)) == pytest.approx(0.002803783278, abs=1e-12)
