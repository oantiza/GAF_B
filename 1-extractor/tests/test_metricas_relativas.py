# -*- coding: utf-8 -*-
"""Metricas del fondo CONTRA un indice: beta, R2, alpha, activa y tracking error.

Lo que hace falta para calcularlas es la serie del indice, y en la maestra hay
cero activos de tipo indice. No es un problema de licencia insalvable: un fondo
indice de ACUMULACION es un ISIN, y un ISIN se trae igual que los 752 que ya se
traen. El tipo `indice` ya existe en el extractor y `_tipo_desde_eodhd` ya lo
devuelve; lo que falta es anadir los simbolos.

La regla que fija este modulo, y que es la parte que se puede equivocar en
silencio: con un indice de PRECIO no se puede calcular el alpha. Un indice de
precio excluye los dividendos, asi que el alpha y la rentabilidad activa contra
el salen infladas por el dividendo del indice —del orden de 1,3 puntos al anio
en el S&P 500, 2 en MSCI World, 3 en MSCI Europe—, que es diez o treinta veces
el sesgo de usar un proxy con comision. La beta y el R2 si aguantan, porque
miden co-movimiento y el dividendo entra como una deriva casi constante.
"""
import calendar
import random
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import metricas as m  # noqa: E402


def _fin_de_mes(k: int) -> date:
    y, mo = 2020 + k // 12, k % 12 + 1
    return date(y, mo, calendar.monthrange(y, mo)[1])


def _par(beta: float = 1.2, ruido: float = 0.004, meses: int = 72):
    """(serie del fondo, serie del indice) con una beta conocida."""
    random.seed(7)
    idx, fnd, vi, vf = [], [], 100.0, 100.0
    for k in range(meses):
        r = random.gauss(0.008, 0.04)
        vi *= 1 + r
        vf *= 1 + beta * r + random.gauss(0.001, ruido)
        d = _fin_de_mes(k)
        idx.append((d, vi))
        fnd.append((d, vf))
    return fnd, idx


# Un dato cada dia, como lo publica el BCE. Hasta la version 2 bastaba uno al mes, porque el tipo
# del mes era la media de lo que hubiera; desde la 3 (A-158) el tipo capitaliza noche a noche y un
# dato de hace mas de siete dias no se arrastra: con un dato al mes no habria alfa de Jensen.
ESTR = [(date(2019, 12, 1) + timedelta(days=i), 2.0) for i in range(3000)]


def test_recupera_la_beta_plantada():
    fnd, idx = _par(beta=1.2)
    r = m.relativas(fnd, idx, "TOTAL_RETURN", ESTR)["3a"]
    assert r["beta"] == pytest.approx(1.2, abs=0.05)
    assert r["r2"] > 95


def test_una_beta_distinta_sale_distinta():
    r6 = m.relativas(*_par(beta=0.6), "TOTAL_RETURN", ESTR)["3a"]
    assert r6["beta"] == pytest.approx(0.6, abs=0.05)


class TestLaBaseDelIndiceDecideQueSePuedeCalcular:
    """Es la regla del modulo, y la que evita publicar un alpha inflado."""

    def test_con_retorno_total_salen_las_cinco(self):
        r = m.relativas(*_par(), "TOTAL_RETURN", ESTR)["3a"]
        for k in ("beta", "r2", "jensen_alpha", "rentabilidad_activa",
                  "tracking_error", "information_ratio"):
            assert k in r, k

    def test_con_indice_de_PRECIO_no_sale_el_alpha_ni_la_activa(self):
        r = m.relativas(*_par(), "PRICE_RETURN", ESTR)["3a"]
        assert "beta" in r and "r2" in r and "tracking_error" in r
        assert "jensen_alpha" not in r
        assert "rentabilidad_activa" not in r
        assert "information_ratio" not in r

    def test_la_beta_y_el_R2_son_los_MISMOS_con_las_dos_bases(self):
        # Porque miden co-movimiento: el dividendo entra como deriva casi
        # constante y no toca la pendiente ni el ajuste.
        tr = m.relativas(*_par(), "TOTAL_RETURN", ESTR)["3a"]
        pr = m.relativas(*_par(), "PRICE_RETURN", ESTR)["3a"]
        assert tr["beta"] == pr["beta"]
        assert tr["r2"] == pr["r2"]

    def test_la_base_NO_se_adivina(self):
        with pytest.raises(ValueError):
            m.relativas(*_par(), "")
        with pytest.raises(ValueError):
            m.relativas(*_par(), "NR")


def test_sin_estr_no_hay_alpha_pero_si_activa_y_tracking_error():
    # Mismo patron que el Sharpe: el alpha de Jensen necesita el tipo libre de
    # riesgo, la rentabilidad activa y el tracking error no.
    r = m.relativas(*_par(), "TOTAL_RETURN", None)["3a"]
    assert "jensen_alpha" not in r
    assert "rentabilidad_activa" in r
    assert "tracking_error" in r


def test_cada_mes_del_fondo_se_empareja_con_el_MISMO_mes_del_indice():
    # Si el indice le falta un mes, no se puede desplazar la serie: habria que
    # comparar el fondo de marzo con el indice de febrero y la beta saldria de
    # cualquier cosa. Los meses sin pareja se descartan.
    fnd, idx = _par(meses=72)
    hueco = [(f, p) for f, p in idx if (f.year, f.month) != (2023, 6)]
    r = m.relativas(fnd, hueco, "TOTAL_RETURN", ESTR)
    # La ventana de 3 anios cruza el hueco, asi que no se publica; la de 1 si.
    assert "3a" not in r
    assert "1a" in r


def test_una_serie_corta_no_publica_la_ventana_larga():
    r = m.relativas(*_par(meses=20), "TOTAL_RETURN", ESTR)
    assert "1a" in r
    assert "3a" not in r and "5a" not in r


def test_un_indice_plano_no_da_beta_ni_R2():
    # Varianza cero: no se puede dividir. Sale el tracking error, que no divide.
    fnd, _ = _par()
    plano = [(f, 100.0) for f, _p in fnd]
    r = m.relativas(fnd, plano, "TOTAL_RETURN", ESTR)["3a"]
    assert "beta" not in r and "r2" not in r
    assert "tracking_error" in r


def test_el_tracking_error_de_un_clon_es_cero():
    fnd, _ = _par()
    r = m.relativas(fnd, fnd, "TOTAL_RETURN", ESTR)["3a"]
    assert r["beta"] == pytest.approx(1.0, abs=1e-6)
    assert r["r2"] == pytest.approx(100.0, abs=1e-6)
    assert r["tracking_error"] == pytest.approx(0.0, abs=1e-6)
    assert r["rentabilidad_activa"] == pytest.approx(0.0, abs=1e-6)


def test_la_fecha_y_la_base_viajan_con_las_cifras():
    r = m.relativas(*_par(), "TOTAL_RETURN", ESTR)
    assert r["base_indice"] == "TOTAL_RETURN"
    # La serie acaba en diciembre de 2025 y la fecha es NOVIEMBRE: el mes del
    # ultimo valor se excluye por estar a medias, igual que en `riesgo`. Que las
    # dos funciones fechen igual es lo que permite ponerlas en la misma fila.
    assert r["fecha"] == "2025-11-30"
