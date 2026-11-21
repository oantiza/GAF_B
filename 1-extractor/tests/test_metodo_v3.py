# -*- coding: utf-8 -*-
"""La versión 3 del método (decisiones A-158 y A-166 de Óscar, 16-11-2026).

Tres cambios a la vez, y cada cifra esperada de aquí sale de una cuenta a mano escrita junto a
su prueba, nunca de la salida del código:

- MET-1: el tipo sin riesgo de cada mes capitaliza con su base de días (`rf_entre`).
- MET-3: la volatilidad diaria se anualiza con las observaciones que hay (`metricas_diarias`).
- MET-2: un dato suelto que salta y vuelve se descarta con aviso (`sin_picos`).
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import metricas as m  # noqa: E402


def _habiles(desde: date, hasta: date) -> list[date]:
    return [desde + timedelta(days=i) for i in range((hasta - desde).days + 1)
            if (desde + timedelta(days=i)).weekday() < 5]


# ------------------------------------------------------------------ la versión
def test_la_version_ya_no_es_la_3():
    """La 4 llegó el 17-11-2026 (MET-6 y MET-7): lo que prueba este fichero sigue valiendo dentro de ella,
    y el sello se prueba en `test_metodo_v4.py`."""
    assert m.VERSION_METODO == 4


# ------------------------------------------------------------------ MET-1: el tipo capitaliza
class TestElTipoSinRiesgoCapitalizaConSuBaseDeDias:
    #: Un 3,6 % anual en act/360 es exactamente un 0,01 % por noche: 3,6 / 360 = 0,01.
    ESTR = [(d, 3.6) for d in _habiles(date(2026, 1, 2), date(2026, 1, 9))]

    def test_una_semana_con_su_fin_de_semana(self):
        """Del viernes 2 al viernes 9 de enero de 2026, al 3,6 %.

        El tipo del viernes 2 se devenga tres noches (viernes, sábado y domingo) y es interés
        simple dentro de su tramo: 1 + 0,036 × 3/360 = 1,0003. Los de lunes, martes, miércoles
        y jueves, una noche cada uno: 1,0001 cuatro veces, y 1,0001⁴ = 1,00040006000400010.

            1,0003 × 1,00040006000400010 = 1,00070018002200130…  →  0,0007001800220013

        Sin capitalizar serían 7 noches × 0,0001 = 0,0007 justos."""
        rf = m.rf_entre(self.ESTR, date(2026, 1, 2), date(2026, 1, 9))
        assert rf == pytest.approx(0.0007001800220013, abs=1e-15)

    def test_cada_noche_lleva_el_tipo_de_su_dia(self):
        """Lunes 5 al 1,8 % y martes 6 al 3,6 %, del lunes al miércoles 7.

            (1 + 0,018/360) × (1 + 0,036/360) = 1,00005 × 1,0001 = 1,000150005  →  0,000150005"""
        estr = [(date(2026, 1, 5), 1.8), (date(2026, 1, 6), 3.6), (date(2026, 1, 7), 9.9)]
        assert m.rf_entre(estr, date(2026, 1, 5), date(2026, 1, 7)) == pytest.approx(0.000150005, abs=1e-15)

    def test_es_la_base_360_y_no_un_doceavo(self):
        """Un mes de 31 días al 3,6 % con dato todos los días naturales: 1,0001³¹ − 1.

        1,0001³¹ = 1 + 31 × 0,0001 + (31 × 30 / 2) × 10⁻⁸ + (31 × 30 × 29 / 6) × 10⁻¹² + …
                 = 1 + 0,0031 + 0,00000465 + 0,000000004495 = 1,003104654495…

        La regla anterior daba 3,6 % / 12 = 0,003 justos: un 3,4 % menos de tipo, que es lo que
        un monetario se apuntaba como exceso sin haberlo ganado."""
        estr = [(date(2026, 1, 31) + timedelta(days=i), 3.6) for i in range(40)]
        assert m.rf_entre(estr, date(2026, 1, 31), date(2026, 3, 3)) == pytest.approx(0.003104654495, abs=1e-11)

    def test_sin_tipo_para_una_noche_no_hay_tipo(self):
        # El €STR empieza el viernes 2: la noche del jueves 1 no tiene tipo, y no se rellena hacia atrás.
        assert m.rf_entre(self.ESTR, date(2026, 1, 1), date(2026, 1, 9)) is None
        assert m.rf_entre([], date(2026, 1, 2), date(2026, 1, 9)) is None
        assert m.rf_entre(self.ESTR, date(2026, 1, 9), date(2026, 1, 9)) is None

    def test_un_tipo_viejo_no_se_arrastra_mas_de_siete_dias(self):
        """Con un solo dato, el del viernes 2 al 3,6 %.

        Hasta el sábado 10 cubre ocho noches, del 2 al 9: la última está a 7 días de su dato y
        vale. 1 + 0,036 × 8/360 = 1,0008. Hasta el domingo 11 haría falta cubrir la noche del
        10, a 8 días: ese tramo no tiene tipo."""
        uno = [(date(2026, 1, 2), 3.6)]
        assert m.RF_ARRASTRE_MAX_DIAS == 7
        assert m.rf_entre(uno, date(2026, 1, 2), date(2026, 1, 10)) == pytest.approx(0.0008, abs=1e-15)
        assert m.rf_entre(uno, date(2026, 1, 2), date(2026, 1, 11)) is None


def test_un_fondo_que_devenga_el_estr_no_tiene_exceso_y_por_eso_no_tiene_sharpe():
    """El caso de MET-1: un monetario que devenga exactamente el €STR.

    Con la versión 2 su Sharpe salía de 0,80 a 1,07: el tipo de cada mes era el €STR entre 12, y
    el fondo, que devenga en act/360 y capitaliza, «ganaba» la diferencia todos los meses.

    Ahora el tipo se mide entre las mismas dos fechas que la rentabilidad del fondo, así que el
    exceso de cada mes es cero. No hay nada que dividir y el Sharpe y el Sortino no salen, que es
    lo que dice la §3 del método para una desviación nula; la volatilidad sí sale, porque el
    fondo se mueve: lo que no se mueve es su exceso."""
    dias = _habiles(date(2025, 8, 1), date(2026, 10, 30))
    # Tipos distintos cada trimestre, para que no sea una constante la que cuadre.
    estr = [(d, 1.8 + 0.6 * ((d.month - 1) // 3)) for d in dias]
    fondo, vl = [], 100.0
    for hoy, manana in zip(dias, dias[1:]):
        fondo.append((hoy, vl))
        tipo = 1.8 + 0.6 * ((hoy.month - 1) // 3)
        vl *= 1 + tipo / 100 * (manana - hoy).days / 360
    fondo.append((dias[-1], vl))

    r = m.riesgo(fondo, estr, fin=date(2026, 10, 31))["1a"]
    assert r["volatilidad"] > 0
    assert "sharpe" not in r and "sortino" not in r
    assert r["rf"] > 0


def test_el_tipo_publicado_de_la_ventana_es_lo_que_rindio_el_estr():
    """Doce meses al 2,4 % con dato todos los días naturales, de 30-09-2025 a 30-09-2026.

    Cada noche capitaliza 0,024/360 = 6,6667 × 10⁻⁵ (x). Un mes de d días rinde (1 + x)^d − 1,
    y los doce suman, con Σd = 365, Σd(d−1)/2 = 5.373 y el término cúbico de 1,7 × 10⁻⁸:

        365 x + 5.373 x² + … = 0,02433333 + 0,00002388 + 0,00000002 = 0,02435723

    Su media por 12 es eso mismo: 2,4357 %. La versión 2 publicaba 2,4 justos, que era el tipo
    y no lo que el tipo rinde en 365 días con base 360."""
    estr = [(date(2025, 9, 1) + timedelta(days=i), 2.4) for i in range(400)]
    meses = [(2025, 9), (2025, 10), (2025, 11), (2025, 12), (2026, 1), (2026, 2), (2026, 3),
             (2026, 4), (2026, 5), (2026, 6), (2026, 7), (2026, 8), (2026, 9)]
    s = [(m.ultimo_dia(date(y, mo, 1)), 100 * (1.005 ** i) * (1.01 if i % 2 else 0.99))
         for i, (y, mo) in enumerate(meses)]
    r = m.riesgo(s, estr, s[-1][0])["1a"]
    assert r["rf"] == pytest.approx(2.4357, abs=1e-4)
    assert isinstance(r["sharpe"], float)


# ------------------------------------------------------------------ MET-3: la volatilidad diaria
def test_la_volatilidad_diaria_se_anualiza_con_las_observaciones_que_hay():
    """Un valor que cotiza un día de cada dos, con rentabilidades de +1 % y −1 % alternas.

    183 cotizaciones del 31-10-2025 al 30-10-2026, una cada dos días: 182 rentabilidades en 364
    días. Su media es cero (91 de cada signo) y su varianza muestral 182 × 0,01² / 181, así que
    la desviación típica es 0,01 × raíz(182/181) = 0,0100275863.

    Al año hay 182 × 365,25 / 364 = 182,625 rentabilidades de esas, y la volatilidad anualizada es

        0,0100275863 × raíz(182,625) × 100 = 0,0100275863 × 13,5138818 × 100 = 13,5512 %

    Con los 252 fijos de la versión 2 salía 0,0100275863 × 15,8745 × 100 = 15,9183 %: un 17 %
    de más, que es raíz(252 / 182,625)."""
    fin = date(2026, 10, 30)
    serie, precio = [], 100.0
    for k in range(183):
        serie.append((fin - timedelta(days=2 * (182 - k)), precio))
        precio *= 1.01 if k % 2 == 0 else 0.99
    r = m.metricas_diarias(serie, 1, None)
    assert r["observaciones"] == 183
    assert (r["fecha_inicio"], r["fecha_fin"]) == ("2025-10-31", "2026-10-30")
    assert r["volatilidad"] == pytest.approx(13.5512, abs=1e-4)
    # Y se reproduce con lo que la ficha publica: (observaciones − 1) × 365,25 / días.
    assert (r["observaciones"] - 1) * m.DIAS_DEL_ANO / 364 == pytest.approx(182.625)


def test_un_valor_que_cotiza_todos_los_dias_habiles_apenas_cambia():
    """De lunes a viernes sin festivos hay 261 sesiones al año, no 252: 365,25 × 5/7 = 260,9.

    Así que ni siquiera el valor más líquido se queda igual: raíz(260,9 / 252) = 1,0175, un 1,7 %
    relativo más. Con los festivos de una bolsa real (252 a 256 sesiones) la diferencia es de
    décimas de punto porcentual sobre una volatilidad del 20 %."""
    fin = date(2026, 10, 30)
    dias = _habiles(fin - timedelta(days=364), fin)
    serie, precio = [], 100.0
    for k, d in enumerate(dias):
        serie.append((d, precio))
        precio *= 1.01 if k % 2 == 0 else 0.99
    r = m.metricas_diarias(serie, 1, None)
    por_ano = (len(dias) - 1) * 365.25 / (dias[-1] - dias[0]).days
    assert por_ano == pytest.approx(260.9, abs=0.5)
    n = len(dias) - 1
    # Rentabilidades de ±1 %: la media no es cero si n es impar, y la cuenta lo recoge.
    media = (0.01 * ((n + 1) // 2) - 0.01 * (n // 2)) / n
    varianza = (((n + 1) // 2) * (0.01 - media) ** 2 + (n // 2) * (-0.01 - media) ** 2) / (n - 1)
    assert r["volatilidad"] == pytest.approx(varianza ** 0.5 * por_ano ** 0.5 * 100, abs=1e-4)


# ------------------------------------------------------------------ MET-2: el pico aislado
class TestUnDatoSueltoQueSaltaYVuelveSeDescarta:
    #: Carmignac Portfolio Investissement A EUR Acc (LU1299311164), el caso medido el 16-11-2026.
    CARMIGNAC = [(date(2013, 1, 8), 79.0), (date(2013, 1, 9), 79.2), (date(2013, 1, 10), 905.2),
                 (date(2013, 1, 11), 78.5), (date(2013, 1, 14), 78.9)]

    def test_el_pico_se_quita_y_se_dice(self):
        """79,2 → 905,2 es una ruptura (× 11,4), 905,2 → 78,5 es otra (÷ 11,5), y de 79,2 a 78,5
        hay un −0,9 %: la serie ha vuelto. Se quita el dato del día 10 y no se corta nada."""
        limpia, picos = m.sin_picos(self.CARMIGNAC)
        assert limpia == [p for p in self.CARMIGNAC if p[0] != date(2013, 1, 10)]
        assert picos == [{"fecha": "2013-01-10", "valor": 905.2, "anterior": 79.2, "siguiente": 78.5}]
        assert m.tramo_sin_rupturas(self.CARMIGNAC) == (limpia, None)

    def test_el_cambio_de_nivel_que_persiste_sigue_cortando(self):
        # BL-Global 75: de 3.087,94 a 102,816 y ahí se queda. No vuelve: no es un pico.
        s = [(date(2021, 7, 14), 3097.37), (date(2021, 7, 15), 3087.94), (date(2021, 7, 16), 102.816),
             (date(2021, 7, 19), 101.92)]
        assert m.sin_picos(s) == (s, [])
        assert m.tramo_sin_rupturas(s) == (s[2:], date(2021, 7, 16))

    def test_si_no_vuelve_a_su_nivel_no_es_un_pico(self):
        # 100 → 1.000 → 400: dos saltos, pero de 100 a 400 sigue habiendo ruptura (× 4). Corta en el último.
        s = [(date(2026, 1, 5), 100.0), (date(2026, 1, 6), 1000.0), (date(2026, 1, 7), 400.0),
             (date(2026, 1, 8), 404.0)]
        assert m.sin_picos(s) == (s, [])
        assert m.tramo_sin_rupturas(s) == (s[2:], date(2026, 1, 7))

    def test_el_salto_en_el_ultimo_dato_todavia_no_ha_vuelto(self):
        """El dato malo de HOY no se puede distinguir de un cambio de unidad hasta que llegue el de
        mañana. Hasta entonces corta, como antes; cuando vuelve, se quita y la serie reaparece."""
        hoy = [(date(2026, 11, 11), 100.0), (date(2026, 11, 12), 101.0), (date(2026, 11, 13), 1010.0)]
        assert m.sin_picos(hoy) == (hoy, [])
        assert m.tramo_sin_rupturas(hoy) == (hoy[2:], date(2026, 11, 13))
        manana = hoy + [(date(2026, 11, 16), 100.5)]
        tramo, corte = m.tramo_sin_rupturas(manana)
        assert corte is None and [f for f, _p in tramo] == [date(2026, 11, 11), date(2026, 11, 12), date(2026, 11, 16)]

    def test_dos_picos_separados_y_un_cambio_de_nivel_despues(self):
        """Dos picos (días 6 y 9) y, el día 13, un cambio de unidad de verdad (÷ 10 que se queda).
        Los picos se quitan y el corte queda donde está el cambio que persiste."""
        s = [(date(2026, 1, 5), 100.0), (date(2026, 1, 6), 10.0), (date(2026, 1, 7), 101.0),
             (date(2026, 1, 8), 102.0), (date(2026, 1, 9), 500.0), (date(2026, 1, 12), 103.0),
             (date(2026, 1, 13), 10.3), (date(2026, 1, 14), 10.4)]
        limpia, picos = m.sin_picos(s)
        assert [p["fecha"] for p in picos] == ["2026-01-06", "2026-01-09"]
        assert len(limpia) == 6
        assert m.tramo_sin_rupturas(s) == (s[6:], date(2026, 1, 13))

    def test_la_vuelta_se_mide_con_el_factor_de_la_ruptura(self):
        """Confirmado por Óscar el 17-11-2026 (A-182): «vuelve» es que de A a C no haya ruptura (factor 2).

        100 → 300 → 140: × 3 y ÷ 2,14 son rupturas, y 140/100 = 1,4 no lo es. Con el factor de hoy
        el 300 se quita. Con una vuelta más estrecha, la del 10 %, no sería un pico: ese es el
        parámetro `PICO_VUELTA_FACTOR`, que hoy vale lo mismo que `RUPTURA_FACTOR`."""
        s = [(date(2026, 1, 5), 100.0), (date(2026, 1, 6), 300.0), (date(2026, 1, 7), 140.0)]
        assert m.PICO_VUELTA_FACTOR == m.RUPTURA_FACTOR == 2.0
        assert [p["fecha"] for p in m.sin_picos(s)[1]] == ["2026-01-06"]
        assert m.sin_picos(s, vuelta=1.10) == (s, [])

    def test_una_serie_normal_no_cambia(self):
        normal = [(date(2026, 1, 1), 100.0), (date(2026, 1, 2), 70.0), (date(2026, 1, 5), 80.0)]
        assert m.sin_picos(normal) == (normal, [])
        assert m.sin_picos([]) == ([], [])
