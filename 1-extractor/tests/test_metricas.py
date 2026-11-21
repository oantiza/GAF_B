# -*- coding: utf-8 -*-
"""Métricas propias desde la serie de VL (fase 0 del plan sin Morningstar).

Series sintéticas con resultado conocido: lo que se prueba son las
convenciones (plazos, años naturales, ventanas mensuales, cierre de mes y paso
a EUR), que son las que hacen comparable el dato con el de Morningstar.
"""
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import metricas as m  # noqa: E402


def _diaria(desde: date, hasta: date, crecimiento_anual: float = 0.0, p0: float = 100.0):
    """VL de lunes a viernes con crecimiento compuesto constante."""
    out, d = [], desde
    while d <= hasta:
        if d.weekday() < 5:
            anos = (d - desde).days / 365.0
            out.append((d, p0 * (1 + crecimiento_anual) ** anos))
        d += timedelta(days=1)
    return out


def _tramos(hitos):
    """Un punto cada 30 dias entre cada dos hitos, en linea recta: el camino de los hitos, sin un hueco."""
    out = []
    for (a, pa), (b, pb) in zip(hitos, hitos[1:]):
        d = a
        while d < b:
            out.append((d, pa + (pb - pa) * (d - a).days / (b - a).days))
            d += timedelta(days=30)
    return out + [hitos[-1]]


def _mensual(valores, desde=(2021, 9)):
    y, mo = desde
    out = []
    for v in valores:
        out.append((m.ultimo_dia(date(y, mo, 1)), float(v)))
        mo += 1
        if mo == 13:
            y, mo = y + 1, 1
    return out


def test_normaliza_ordena_quita_repetidas_y_no_positivos():
    s = m.normaliza([(date(2026, 1, 3), 2.0), (date(2026, 1, 1), 1.0), (date(2026, 1, 3), 3.0),
                     (date(2026, 1, 2), 0.0), (date(2026, 1, 4), float("nan"))])
    assert s == [(date(2026, 1, 1), 1.0), (date(2026, 1, 3), 3.0)]


def test_resta_meses_ajusta_el_fin_de_mes():
    assert m.resta_meses(date(2026, 3, 31), 1) == date(2026, 2, 28)
    assert m.resta_meses(date(2026, 1, 15), 13) == date(2024, 12, 15)


def test_rentabilidades_anualizadas_de_un_crecimiento_constante():
    s = _diaria(date(2014, 1, 1), date(2026, 9, 30), crecimiento_anual=0.05)
    r = m.rentabilidades(s, date(2026, 9, 30))
    for plazo in ("3a_anualizada", "5a_anualizada", "10a_anualizada"):
        assert r[plazo] == pytest.approx(5.0, abs=0.05)
    assert r["1a"] == pytest.approx(5.0, abs=0.05)
    assert r["ytd"] == pytest.approx((1.05 ** (273 / 365) - 1) * 100, abs=0.05)


def test_sin_historia_suficiente_el_plazo_no_se_publica():
    s = _diaria(date(2024, 6, 1), date(2026, 9, 30), 0.03)
    r = m.rentabilidades(s)
    assert "1a" in r and "3a_anualizada" not in r and "5a_anualizada" not in r


def test_un_hueco_mayor_que_la_tolerancia_no_da_plazo():
    s = [(date(2025, 8, 1), 100.0), (date(2026, 9, 30), 110.0)]
    assert "1a" not in m.rentabilidades(s)        # el VL inicial es de 2 meses antes


def test_anos_naturales_solo_completos():
    s = _mensual([100, 101, 102, 103, 104, 110, 111, 112, 113, 114, 115, 116, 117, 121],
                 desde=(2024, 12))
    # dic-2024 100 -> dic-2025 117; 2026 (solo enero) está a medias
    assert m.por_ano_natural(s) == {"2025": 17.0}


def test_por_ano_natural_con_cierres_de_mes_reales():
    # Cierres de mes de un fondo de la muestra del 28-10 (regresión).
    v = ("122.8742 124.6639 115.9723 119.2252 114.6566 111.0254 111.8887 109.0025 107.7443 "
         "100.8647 109.9472 107.4247 102.9656 109.4753 110.2596 105.0514 112.331 112.8297 "
         "111.9927 112.33 112.641 116.479 116.9088 114.1197 111.0323 105.3089 112.6234 "
         "115.8654 116.2792 119.622 124.822 121.2445 124.4501 122.8444 124.5061 128.1787 "
         "129.2279 126.5863 129.3991 129.8544 133.93 134.3739 127.2862 126.1078 130.7337 "
         "129.0174 127.9482 133.2792 137.3909 136.2065 138.7719 140.7154 140.0394 143.9441 "
         "130.1689 132.4871 139.0568 139.2611 141.9471 144.3357 137.524").split()
    s = m.normaliza(_mensual(v))
    assert m.por_ano_natural(s) == {"2022": -11.8883, "2023": 10.294, "2024": 12.0735,
                                    "2025": 8.364}


def test_volatilidad_mensual_anualizada():
    # Alterna +1 % y -1 %: desviación conocida.
    precios, p = [], 100.0
    for i in range(37):
        precios.append(p)
        p *= 1.01 if i % 2 == 0 else 0.99
    s = _mensual(precios, desde=(2023, 8))
    fin = s[-1][0]
    r = m.riesgo(s, None, fin)
    rets = [b[1] / a[1] - 1 for a, b in zip(s, s[1:])]
    esperado = __import__("statistics").stdev(rets) * math.sqrt(12) * 100
    assert r["fecha"] == fin.isoformat()
    assert r["3a"]["volatilidad"] == pytest.approx(esperado, abs=1e-4)
    assert "sharpe" not in r["3a"]                  # sin €STR, sin Sharpe


def test_sharpe_con_estr_y_sin_estr_completo_no_hay():
    s = m.normaliza(_mensual([100 * (1.005 ** i) * (1.01 if i % 2 else 0.99) for i in range(13)],
                             desde=(2025, 9)))
    fin = s[-1][0]
    estr = [(date(2025, 9, 1) + timedelta(days=i), 2.4) for i in range(400)]
    r = m.riesgo(s, estr, fin)
    # Versión 3 (A-158): ya no es el 2,4 del tipo, es lo que el 2,4 rinde en esos 365 días con
    # base 360 y capitalizando. La cuenta a mano está en `test_metodo_v3.py`: 2,4357.
    assert r["1a"]["rf"] == pytest.approx(2.4357, abs=1e-4)
    assert isinstance(r["1a"]["sharpe"], float)
    corto = [x for x in estr if x[0] >= date(2026, 1, 1)]
    assert "sharpe" not in m.riesgo(s, corto, fin)["1a"]


def test_el_mes_a_medias_no_cuenta_salvo_cierre():
    s = _diaria(date(2025, 1, 1), date(2026, 10, 27), 0.04)
    assert m.riesgo(s)["fecha"] == "2026-09-30"
    assert m.cierre_mensual(s) == date(2026, 9, 30)


def test_cierre_mensual_con_el_ultimo_dia_en_fin_de_semana():
    # 31-10-2026 es sábado: el VL del viernes 30 cierra octubre.
    s = _diaria(date(2026, 1, 1), date(2026, 10, 30))
    assert m.cierre_mensual(s) == date(2026, 10, 31)
    assert m.cierre_mensual(s[:-1]) == date(2026, 9, 30)


def test_caida_maxima():
    # De 100 a 120, a 90 y a 130, con un punto cada mes para que no haya un hueco (decision 111): de 120 a 90 son -25 %.
    s = _tramos([(date(2023, 1, 2), 100.0), (date(2024, 1, 2), 120.0), (date(2024, 6, 3), 90.0), (date(2026, 1, 2), 130.0)])
    assert m.caida_maxima(s, anos=3, fin=date(2026, 1, 2)) == -25.0
    desde_el_pico = [punto for punto in s if punto[0] >= date(2024, 1, 2)]
    assert m.caida_maxima(desde_el_pico, anos=3) is None  # la serie no cubre la ventana


def test_a_eur_usa_el_cambio_del_dia_o_el_ultimo_reciente():
    s = [(date(2026, 1, 2), 110.0), (date(2026, 1, 5), 120.0), (date(2026, 2, 20), 100.0)]
    cambios = [(date(2026, 1, 2), 1.10), (date(2026, 1, 2), 1.10), (date(2026, 1, 2), 1.10)]
    # 5-ene sin cambio publicado: vale el del 2 (3 días); 20-feb, demasiado viejo.
    assert m.a_eur(s, cambios) == [(date(2026, 1, 2), pytest.approx(100.0)),
                                   (date(2026, 1, 5), pytest.approx(120 / 1.10))]
    assert m.a_eur(s, []) == []


def test_a_cierre_de_mes_el_plazo_arranca_en_el_cierre_anterior():
    # 31-08-2026 es lunes: el 1 mes a 30-09 arranca ahí, no en el viernes 28-08.
    s = [(date(2026, 8, 28), 100.0), (date(2026, 8, 31), 110.0), (date(2026, 9, 30), 121.0),
         (date(2026, 3, 31), 50.0), (date(2026, 4, 30), 60.0), (date(2026, 5, 30), 70.0), (date(2026, 6, 30), 80.0),
         (date(2026, 7, 31), 90.0)]
    s = m.normaliza(s)
    r = m.rentabilidades(s, date(2026, 9, 30))
    assert r["1m"] == pytest.approx(10.0)
    assert r["6m"] == pytest.approx(142.0)            # desde el 31-03
    # fuera de un cierre de mes, misma fecha del mes anterior
    s2 = m.normaliza([(date(2026, 8, 14), 100.0), (date(2026, 9, 14), 105.0)])
    assert m.rentabilidades(s2)["1m"] == pytest.approx(5.0)


def test_tramo_sin_rupturas():
    s = [(date(2021, 7, 14), 3097.37), (date(2021, 7, 15), 3087.94), (date(2021, 7, 16), 102.816),
         (date(2021, 7, 19), 101.92)]
    tramo, corte = m.tramo_sin_rupturas(s)
    assert corte == date(2021, 7, 16) and tramo == s[2:]
    normal = [(date(2026, 1, 1), 100.0), (date(2026, 1, 2), 70.0), (date(2026, 1, 5), 80.0)]
    assert m.tramo_sin_rupturas(normal) == (normal, None)     # -30 % no es ruptura


def test_sortino_castiga_solo_las_bajadas():
    """El Sortino es el mismo numerador que el Sharpe con otro denominador.

    Entra el 02-11-2026: el contrato declaraba sus cuatro ventanas y en el extractor
    la palabra «sortino» solo aparecía para clasificar un campo DEL PROVEEDOR.
    """
    # Serie con subidas y bajadas alternas: hay dispersión a los dos lados.
    s = m.normaliza(_mensual([100 * (1.005 ** i) * (1.01 if i % 2 else 0.99) for i in range(13)],
                             desde=(2025, 9)))
    fin = s[-1][0]
    estr = [(date(2025, 9, 1) + timedelta(days=i), 2.4) for i in range(400)]
    r = m.riesgo(s, estr, fin)

    sharpe, sortino = r["1a"]["sharpe"], r["1a"]["sortino"]
    assert isinstance(sortino, float)
    # Con dispersión a los dos lados, la desviación a la baja es MENOR que la total,
    # así que el Sortino sale por encima del Sharpe. Si algún día sale por debajo,
    # el denominador está mirando las subidas.
    assert sortino > sharpe

    # Y se calcula con el MISMO tipo libre de riesgo que el Sharpe: sin €STR no hay
    # ninguno de los dos.
    sin_estr = m.riesgo(s, None, fin)
    assert "sortino" not in sin_estr["1a"]
    assert "sharpe" not in sin_estr["1a"]


def test_una_serie_que_solo_sube_no_tiene_sortino():
    """Sin un solo mes por debajo del tipo libre de riesgo no hay desviación a la baja.

    El denominador es cero y la división no se hace: la clave no se escribe. Es la
    misma regla que el Sharpe con desviación cero, y la alternativa -un Sortino
    infinito, o un cero- afirmaría algo falso sobre el riesgo del fondo.
    """
    s = m.normaliza(_mensual([100 * (1.02 ** i) for i in range(13)], desde=(2025, 9)))
    fin = s[-1][0]
    estr = [(date(2025, 9, 1) + timedelta(days=i), 2.4) for i in range(400)]
    r = m.riesgo(s, estr, fin)
    assert isinstance(r["1a"]["sharpe"], float)
    assert "sortino" not in r["1a"]


def test_la_caida_maxima_sale_por_ventana_y_la_de_tres_anos_no_cambia():
    """`caidas_maximas` llama a `caida_maxima` una vez por ventana.

    Lo que se fija aquí es que la de 3 años siga dando lo mismo que antes -es la que
    ya estaba publicada- y que una ventana que la serie no cubre NO salga a cero.
    """
    s = _diaria(date(2022, 1, 1), date(2026, 9, 30), 0.0)
    # Un bache del 20 % en 2025, dentro de 1a y 3a.
    s = [(f, p * (0.8 if date(2025, 6, 1) <= f <= date(2025, 8, 31) else 1.0)) for f, p in s]
    por_ventana = m.caidas_maximas(s, fin=date(2026, 9, 30))

    assert por_ventana["3a"] == m.caida_maxima(s, anos=3, fin=date(2026, 9, 30))
    assert por_ventana["1a"] is not None
    assert "10a" not in por_ventana          # la serie son 4,7 años: no la cubre
    for clave, valor in por_ventana.items():
        assert valor <= 0, f"{clave} deberia ser negativa o cero"


def test_la_ventana_de_diez_anos_existe_y_exige_sus_meses():
    """121 cierres de mes consecutivos. Antes del 02-11-2026 la ventana no existía."""
    assert ("10a", 120) in m.VENTANAS_RIESGO
    corta = m.normaliza(_mensual([100 * (1.004 ** i) for i in range(61)], desde=(2021, 9)))
    assert "10a" not in m.riesgo(corta, None, corta[-1][0])
    larga = m.normaliza(_mensual([100 * (1.004 ** i) for i in range(145)], desde=(2014, 9)))
    assert "10a" in m.riesgo(larga, None, larga[-1][0])
