# -*- coding: utf-8 -*-
"""Una ventana con hueco no se publica, sea la cifra que sea (decisión 111 de Óscar, 05-11-2026).

Resultados a mano, con series sintéticas: un punto cada día hábil salvo donde se quita a propósito.
"""
from datetime import date, timedelta

import pytest

from core import metricas as m
from core.update import quality_regression_reason
from fetchers import vl_fondos


def _diaria(desde: date, hasta: date, p0: float = 100.0, crecimiento_diario: float = 0.0002):
    out, d, p = [], desde, p0
    while d <= hasta:
        if d.weekday() < 5:
            out.append((d, p))
            p *= 1 + crecimiento_diario
        d += timedelta(days=1)
    return out


def _sin(serie, desde: date, hasta: date):
    """La serie sin los puntos estrictamente entre las dos fechas."""
    return [p for p in serie if not desde < p[0] < hasta]


CIERRE = date(2026, 10, 30)
SERIE = _diaria(date(2015, 1, 2), CIERRE)
# El caso de AB American Growth: sin puntos del 18-07-2018 al 07-09-2022.
CON_HUECO_DE_ANIOS = _sin(SERIE, date(2018, 7, 18), date(2022, 9, 7))


class TestQueEsUnHueco:
    @pytest.mark.parametrize("dias, es_hueco", [(33, False), (34, True)])
    def test_lo_que_separa_dos_cierres_de_mes_no_es_un_hueco_y_un_dia_mas_si(self, dias, es_hueco):
        """Versión 4 (Óscar, 17-11-2026): en el método mensual, 33 días."""
        a = date(2022, 3, 1)
        serie = [(a, 100.0), (a + timedelta(days=dias), 100.0)]
        assert (m.hueco_en_ventana(serie, date(2022, 3, 1)) is not None) is es_hueco

    @pytest.mark.parametrize("dias, es_hueco", [(31, False), (32, True)])
    def test_en_el_camino_diario_siguen_siendo_31(self, dias, es_hueco):
        a = date(2022, 3, 1)
        serie = [(a, 100.0), (a + timedelta(days=dias), 100.0)]
        assert (m.hueco_en_ventana(serie, a, maximo=m.HUECO_MAXIMO_DIAS_DIARIO) is not None) is es_hueco

    def test_dos_cierres_en_su_ultimo_laborable_pueden_separarse_33_dias(self):
        """Viernes 28-11-2025 (el 29 y el 30 son sábado y domingo) y miércoles 31-12-2025: 2 + 31 = 33 días.
        Hasta la versión 3 eso era un hueco, y un fondo que publica una vez al mes lo tenía."""
        serie = [(date(2025, 10, 31), 100.0), (date(2025, 11, 28), 100.0), (date(2025, 12, 31), 100.0)]
        assert (date(2025, 12, 31) - date(2025, 11, 28)).days == 33
        assert m.hueco_en_ventana(serie, date(2025, 10, 31)) is None

    def test_una_serie_de_un_punto_al_mes_no_tiene_ninguno(self):
        serie = [(m.ultimo_dia(date(2020 + i // 12, i % 12 + 1, 1)), 100.0) for i in range(60)]
        assert m.hueco_en_ventana(serie, date(2020, 1, 1)) is None

    def test_un_hueco_que_atraviesa_el_principio_de_la_ventana_cuenta(self):
        # Empieza antes de la ventana y acaba dentro: la ventana no se puede medir desde su arranque.
        assert m.hueco_en_ventana(CON_HUECO_DE_ANIOS, date(2021, 10, 29)) == (date(2018, 7, 18), date(2022, 9, 7))

    def test_un_hueco_anterior_a_la_ventana_no_cuenta(self):
        assert m.hueco_en_ventana(CON_HUECO_DE_ANIOS, date(2022, 9, 7)) is None

    def test_un_hueco_posterior_a_fin_no_cuenta(self):
        assert m.hueco_en_ventana(CON_HUECO_DE_ANIOS, date(2015, 6, 1), date(2018, 7, 1)) is None

    def test_que_la_serie_empiece_tarde_no_es_un_hueco(self):
        assert m.hueco_en_ventana(_diaria(date(2024, 1, 1), CIERRE), date(2020, 1, 1)) is None


class TestCadaCifra:
    def test_rentabilidad(self):
        fin = date(2026, 10, 30)
        sin_hueco = m.rentabilidades(SERIE, fin)
        con_hueco = m.rentabilidades(CON_HUECO_DE_ANIOS, fin)
        # A 3 años la ventana empieza después del hueco, y la cifra es la misma; a 5 y a 10 lo atraviesa.
        assert con_hueco["3a_anualizada"] == sin_hueco["3a_anualizada"]
        assert con_hueco["1a"] == sin_hueco["1a"]
        assert "5a_anualizada" not in con_hueco
        assert "10a_anualizada" not in con_hueco
        assert "10a_anualizada" in sin_hueco

    def test_riesgo(self):
        fin = date(2026, 10, 31)
        sin_hueco = m.riesgo(SERIE, None, fin)
        con_hueco = m.riesgo(CON_HUECO_DE_ANIOS, None, fin)
        assert con_hueco["3a"] == sin_hueco["3a"]
        assert "5a" not in con_hueco and "10a" not in con_hueco

    def test_riesgo_con_un_hueco_que_no_se_salta_ningun_cierre_de_mes(self):
        # 32 días entre el 04-08 y el 05-09: agosto tiene punto, y los meses siguen seguidos. Es el caso de Cementos Molins en 2022.
        serie = _sin(SERIE, date(2022, 8, 4), date(2022, 9, 5))
        fin = date(2026, 10, 31)
        assert "3a" in m.riesgo(serie, None, fin)
        assert "5a" not in m.riesgo(serie, None, fin)
        assert "5a" in m.riesgo(SERIE, None, fin)

    def test_caida_maxima(self):
        # La de AB: con el hueco solo mediría desde su final. Sin puntos del 2018 al 2022, a 5 años no hay cifra.
        fin = date(2026, 10, 30)
        assert m.caida_maxima(CON_HUECO_DE_ANIOS, anos=5, fin=fin) is None
        assert m.caida_maxima(CON_HUECO_DE_ANIOS, anos=3, fin=fin) == m.caida_maxima(SERIE, anos=3, fin=fin)
        assert set(m.caidas_maximas(CON_HUECO_DE_ANIOS, fin=fin)) == {"1a", "3a"}

    def test_el_camino_diario(self):
        serie = _sin(SERIE, date(2022, 11, 25), date(2023, 2, 24))  # 91 días: el parón de Innovative Solutions
        assert m.metricas_diarias(serie, 3) is not None
        assert m.metricas_diarias(serie, 5) is None
        assert m.metricas_diarias(SERIE, 5) is not None

    def test_contra_un_indice(self):
        indice = [(f, p * 2) for f, p in SERIE]
        fin = date(2026, 10, 31)
        con_hueco = m.relativas(_sin(SERIE, date(2022, 8, 4), date(2022, 9, 5)), indice, "TOTAL_RETURN", None, fin)
        assert "3a" in con_hueco and "5a" not in con_hueco
        assert "5a" in m.relativas(SERIE, indice, "TOTAL_RETURN", None, fin)

    def test_lo_que_queda_no_cambia_de_valor(self):
        # Solo se quitan ventanas: por eso no cambia la versión del método (§7 y §10).
        fin = date(2026, 10, 31)
        serie = _sin(SERIE, date(2019, 2, 1), date(2019, 5, 2))
        assert m.riesgo(serie, None, fin)["5a"] == m.riesgo(SERIE, None, fin)["5a"]
        assert m.rentabilidades(serie, fin)["5a_anualizada"] == m.rentabilidades(SERIE, fin)["5a_anualizada"]


class TestLoQueLeeLaFicha:
    def test_dice_el_hueco_y_las_ventanas_que_cuesta(self):
        assert m.huecos_por_ventana(CON_HUECO_DE_ANIOS, date(2026, 10, 31)) == [
            {"desde": "2018-07-18", "hasta": "2022-09-07", "dias": 1512, "ventanas": ["5a", "10a"]}
        ]

    def test_el_camino_diario_no_llega_a_diez_anios(self):
        serie = _sin(SERIE, date(2018, 2, 1), date(2018, 6, 1))
        assert m.huecos_por_ventana(serie, date(2026, 10, 30), diario=True) == []
        assert m.huecos_por_ventana(serie, date(2026, 10, 31))[0]["ventanas"] == ["10a"]

    def test_una_ventana_a_la_que_la_serie_no_llega_no_se_atribuye_al_hueco(self):
        # El de JPMorgan EUR Liquidity: empieza en 2018, con un hueco de 2019 a 2022. A 5 años falta por el hueco; a 10, porque no llega.
        serie = _sin(_diaria(date(2018, 12, 3), CIERRE), date(2019, 9, 24), date(2022, 9, 13))
        assert m.huecos_por_ventana(serie, date(2026, 10, 31))[0]["ventanas"] == ["5a"]

    def test_sin_huecos_no_se_escribe_nada(self):
        out: dict = {}
        vl_fondos._escribe_metricas(out, SERIE, "EUR")
        assert "huecos" not in out["riesgo"]["historial_precios"]

    def test_la_ficha_lo_lleva(self):
        out: dict = {}
        vl_fondos._escribe_metricas(out, CON_HUECO_DE_ANIOS, "EUR")
        assert out["riesgo"]["historial_precios"]["huecos"][0]["ventanas"] == ["5a", "10a"]
        assert "5a_anualizada" not in out["rentabilidad"]["trailing_pct"]


def _accion(con_cinco=True, huecos=None):
    d = {
        "identificacion": {"tipo": "accion", "nombre": "x", "ticker": "x", "mercado": "MC", "isin": "x"},
        "valoracion": {"vl": 1.0},
        "rentabilidad": {"trailing_pct": {"1a": {"fondo": 1.0}, "3a_anualizada": {"fondo": 1.0}}},
        "riesgo": {"volatilidad_pct": {"3a": {"fondo": 1.0}}, "sharpe": {"3a": {"fondo": 1.0}}, "historial_precios": {}},
    }
    if con_cinco:
        d["rentabilidad"]["trailing_pct"]["5a_anualizada"] = {"fondo": 1.0}
    if huecos:
        d["riesgo"]["historial_precios"]["huecos"] = huecos
    return d


class TestLaGuardaDeCalidad:
    def test_perder_una_ventana_sin_motivo_se_sigue_parando(self):
        assert quality_regression_reason(_accion(), _accion(con_cinco=False)) == "QUALITY_REGRESSION_BLOCKED: metrics_lost"

    def test_perderla_por_un_hueco_no_es_una_regresion(self):
        huecos = [{"desde": "2022-11-25", "hasta": "2023-02-24", "dias": 91, "ventanas": ["5a"]}]
        assert quality_regression_reason(_accion(), _accion(con_cinco=False, huecos=huecos)) is None
