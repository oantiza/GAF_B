# -*- coding: utf-8 -*-
"""P2-01 de la auditoría del 20-11-2026: los ceros y los huecos que `relativas` y `metricas_diarias` no miraban.

- Un fondo de valor liquidativo constante hacía saltar `relativas` con `StatisticsError` (la correlación de una serie
  constante no existe). Su beta es cero y su R² no se publica.
- El índice de las relativas podía tener un hueco de más de 33 días dentro de la ventana: solo se miraba el del fondo.
- El ratio de información dividía por cualquier tracking error mayor que cero, también por el ruido de coma flotante.
- En el camino diario, la media del €STR valía con un solo dato dentro de la ventana, y la volatilidad nula era `if vol`.
  Y desde la C-28 (21-11-2026), el €STR también tiene que llegar al final: más de 7 días parado, sin Sharpe.

Cada cifra esperada sale de una cuenta a mano, escrita al lado.
"""
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import metricas as m  # noqa: E402


def _fines_de_mes(desde: date, n: int) -> list[date]:
    """`n` últimos días de mes seguidos desde el mes de `desde`."""
    out, y, mo = [], desde.year, desde.month
    for _ in range(n):
        siguiente = date(y + mo // 12, mo % 12 + 1, 1)
        out.append(siguiente - timedelta(days=1))
        y, mo = siguiente.year, siguiente.month
    return out


def _niveles(fechas: list[date], rentabilidades: list[float], inicial: float = 100.0) -> list[tuple[date, float]]:
    serie, v = [(fechas[0], inicial)], inicial
    for f, r in zip(fechas[1:], rentabilidades):
        v *= 1 + r
        serie.append((f, v))
    return serie


# Un €STR del 0 % cada día: el tipo sin riesgo no mueve nada, y el alfa de Jensen es la rentabilidad media del fondo.
ESTR_CERO = [(date(2024, 12, 1) + timedelta(days=i), 0.0) for i in range(500)]


# ------------------------------------------------------------- fondo de valor liquidativo constante
def test_un_fondo_de_valor_constante_no_rompe_las_relativas_y_su_beta_es_cero():
    fechas = _fines_de_mes(date(2025, 1, 1), 13)            # 31-01-2025 .. 31-01-2026: trece cierres, doce meses
    indice = _niveles(fechas, [0.02, -0.01] * 6)             # +2 % y -1 % alternos
    fondo = [(f, 100.0) for f in fechas]
    r = m.relativas(fondo, indice, "TOTAL_RETURN", ESTR_CERO, fin=date(2026, 1, 31))["1a"]
    # Covarianza con una serie constante: cada término lleva (x - media de x) = 0, así que es 0 exacto.
    assert r["beta"] == 0.0
    # R² = correlación², y la correlación divide por la desviación del fondo, que es cero: no se publica.
    assert "r2" not in r
    # Diferencias fondo - índice: -2 % y +1 % alternos. Media -0,5 %; cada una se aparta 1,5 % de la media.
    # Desviación muestral = raíz(12 × 0,015² / 11); × raíz(12) × 100 = 18 / raíz(11) = 5,42720...
    assert r["tracking_error"] == pytest.approx(18 / math.sqrt(11), abs=1e-4)
    # Rentabilidad activa = (0 - 0,5 %) × 12 = -6,0 puntos.
    assert r["rentabilidad_activa"] == pytest.approx(-6.0, abs=1e-9)
    # Ratio de información = -6 / (18 / raíz(11)) = -raíz(11) / 3 = -1,10554...
    assert r["information_ratio"] == pytest.approx(-math.sqrt(11) / 3, abs=1e-4)
    # Alfa de Jensen con el €STR al 0 % y beta 0: la media del exceso del fondo, que es 0.
    assert r["jensen_alpha"] == pytest.approx(0.0, abs=1e-9)


# ------------------------------------------------------------- el hueco del índice
def _fondo_e_indice(cierre_octubre: date):
    """Fondo e índice con cierres de mes del 31-01-2023 al 30-06-2024. El índice cierra octubre de 2023 el día que se diga."""
    fechas = _fines_de_mes(date(2023, 1, 1), 18)
    rents = [0.01, -0.005, 0.02, -0.015, 0.008, 0.003] * 3
    fondo = _niveles(fechas, rents[:17])
    indice = _niveles(fechas, [r * 0.9 for r in rents[:17]])
    indice = [(cierre_octubre if f == date(2023, 10, 31) else f, p) for f, p in indice]
    return fondo, indice


def test_el_cierre_del_indice_que_lo_es_por_poco_no_es_un_hueco():
    # Control: el índice cierra octubre el día 31, como el fondo. La ventana de un año se publica.
    fondo, indice = _fondo_e_indice(date(2023, 10, 31))
    r = m.relativas(fondo, indice, "TOTAL_RETURN", fin=date(2024, 6, 30))
    assert "1a" in r and "beta" in r["1a"]


def test_un_hueco_del_indice_dentro_de_la_ventana_la_deja_sin_relativas():
    # El 24-10-2023 es martes: tras él quedan en octubre 25, 26, 27, 30 y 31, cinco laborables, así que es su cierre
    # (`CIERRE_LABORABLES_MAX` = 5). El siguiente dato es el 30-11-2023: 37 días sin un punto, más que los 33 del método.
    # La ventana de un año (los trece cierres del 30-06-2023 al 30-06-2024) lo contiene: no se publica. Hasta el
    # 21-11-2026 solo se miraba el hueco del fondo, y salía.
    assert date(2023, 10, 24).weekday() == 1 and m.es_cierre_de_mes(date(2023, 10, 24))
    assert (date(2023, 11, 30) - date(2023, 10, 24)).days == 37
    fondo, indice = _fondo_e_indice(date(2023, 10, 24))
    r = m.relativas(fondo, indice, "TOTAL_RETURN", fin=date(2024, 6, 30))
    assert "1a" not in r
    # Lo demás de la respuesta sigue: la fecha y la base, para que la ficha diga hasta dónde llegan las dos series.
    assert r["fecha"] == "2024-06-30" and r["base_indice"] == "TOTAL_RETURN"


# ------------------------------------------------------------- el ratio de información sobre ruido
def test_un_tracking_error_de_ruido_no_da_ratio_de_informacion():
    # El fondo es el índice multiplicado por 1 ± 1e-15 en meses alternos: las diferencias de rentabilidad son del orden
    # de 2e-15, muy por debajo del «exactamente cero» del método (1e-12). Antes, con `te > 0`, se publicaba un ratio de
    # información de 0,0 —la activa redondeada a cero entre un tracking error de 1e-13—, que no dice nada.
    fechas = _fines_de_mes(date(2025, 1, 1), 13)
    indice = _niveles(fechas, [0.02, -0.01] * 6)
    fondo = [(f, p * (1 + (1e-15 if k % 2 else -1e-15))) for k, (f, p) in enumerate(indice)]
    r = m.relativas(fondo, indice, "TOTAL_RETURN", ESTR_CERO, fin=date(2026, 1, 31))["1a"]
    assert "information_ratio" not in r
    assert r["tracking_error"] == 0.0 and r["rentabilidad_activa"] == 0.0
    assert r["beta"] == pytest.approx(1.0, abs=1e-9)


# ------------------------------------------------------------- el €STR del camino diario
FIN = date(2025, 12, 31)


def _diaria(desde: date = date(2024, 1, 1), hasta: date = FIN) -> list[tuple[date, float]]:
    """Un valor que cotiza de lunes a viernes y oscila: sube un 1 % y baja un 0,5 % alternos."""
    out, d, v, k = [], desde, 100.0, 0
    while d <= hasta:
        if d.weekday() < 5:
            out.append((d, v))
            v *= 1.01 if k % 2 == 0 else 0.995
            k += 1
        d += timedelta(days=1)
    return out


def _estr(desde: date = date(2019, 10, 1), hasta: date = FIN, sin=()) -> list[tuple[date, float]]:
    """Un €STR del 2 % cada día laborable, sin los días de `sin`."""
    out, d = [], desde
    while d <= hasta:
        if d.weekday() < 5 and d not in sin:
            out.append((d, 2.0))
        d += timedelta(days=1)
    return out


def _dias(desde: date, hasta: date) -> set[date]:
    return {desde + timedelta(days=i) for i in range((hasta - desde).days + 1)}


def test_con_el_estr_completo_hay_sharpe_y_el_tipo_es_la_media():
    r = m.metricas_diarias(_diaria(), 1, _estr())
    # Todos los datos del €STR de la ventana valen 2,0: su media es 2,0.
    assert r["rf_pct"] == 2.0
    assert r["sharpe"] is not None


def test_un_estr_que_empieza_despues_de_la_ventana_no_da_sharpe():
    # La ventana de un año empieza el 31-12-2024; el €STR, el 03-03-2025. Antes se promediaba lo que hubiera dentro.
    r = m.metricas_diarias(_diaria(), 1, _estr(desde=date(2025, 3, 3)))
    assert r["sharpe"] is None and r["rf_pct"] is None
    # Lo que no depende del tipo sigue igual que con el €STR completo.
    completo = m.metricas_diarias(_diaria(), 1, _estr())
    assert r["volatilidad"] == completo["volatilidad"] and r["rent_anualizada"] == completo["rent_anualizada"]


def test_un_solo_dato_de_estr_en_la_ventana_no_da_sharpe():
    # El caso de la auditoría: un único €STR, el del último día. El primer día de la ventana no tiene tipo.
    r = m.metricas_diarias(_diaria(), 1, [(FIN, 2.0)])
    assert r["sharpe"] is None and r["rf_pct"] is None


def test_un_tramo_sin_estr_de_siete_noches_vale_y_de_mas_no():
    # Sin el €STR del viernes 06-06-2025 al jueves 12-06: el del jueves 05-06 cubre las noches del 5 al 12. La del 12
    # tiene un tipo de 12 - 5 = 7 días, el máximo que se arrastra (`RF_ARRASTRE_MAX_DIAS`): hay Sharpe.
    assert date(2025, 6, 5).weekday() == 3
    siete = m.metricas_diarias(_diaria(), 1, _estr(sin=_dias(date(2025, 6, 6), date(2025, 6, 12))))
    assert siete["sharpe"] is not None
    # Quitando también el viernes 13: el siguiente es el lunes 16, y la noche del 15 tendría un tipo de 10 días.
    diez = m.metricas_diarias(_diaria(), 1, _estr(sin=_dias(date(2025, 6, 6), date(2025, 6, 13))))
    assert diez["sharpe"] is None and diez["rf_pct"] is None


def test_un_estr_que_acaba_antes_que_la_ventana_vale_siete_dias_y_no_mas():
    # C-28 (Óscar, 21-11-2026): el final se mira como en el mensual. El último precio es el del miércoles 31-12-2025, así
    # que la última noche de la ventana es la del 30-12. Con el €STR hasta el martes 23-12, esa noche tiene un tipo de
    # 30 - 23 = 7 días, el máximo que se arrastra: hay Sharpe, y `cobertura_rf` lo marca (decisión del 09-11-2026).
    assert date(2025, 12, 23).weekday() == 1
    siete = m.metricas_diarias(_diaria(), 1, _estr(hasta=date(2025, 12, 23)))
    assert siete["sharpe"] is not None and siete["rf_pct"] == 2.0
    # Hasta el lunes 22-12, de 8: sin tipo y sin Sharpe. Antes, con el final sin mirar, se publicaba igual.
    ocho = m.metricas_diarias(_diaria(), 1, _estr(hasta=date(2025, 12, 22)))
    assert ocho["sharpe"] is None and ocho["rf_pct"] is None
    assert ocho["volatilidad"] == siete["volatilidad"] and ocho["rent_anualizada"] == siete["rent_anualizada"]
    # Las dos semanas del caso de antes (hasta el 17-12) ya no dan Sharpe.
    assert m.metricas_diarias(_diaria(), 1, _estr(hasta=date(2025, 12, 17)))["sharpe"] is None


def test_una_volatilidad_de_ruido_no_da_sharpe():
    # Un precio que alterna 100 y 100 × (1 + 1e-14): la desviación de sus rentabilidades es de 1e-14, por debajo del
    # «exactamente cero» del método. Con `if vol` salía un Sharpe del orden de -10¹¹: un 2 % de €STR entre una
    # volatilidad de 10⁻¹¹ puntos.
    serie, d, k = [], date(2024, 1, 1), 0
    while d <= FIN:
        if d.weekday() < 5:
            serie.append((d, 100.0 * (1 + 1e-14) if k % 2 else 100.0))
            k += 1
        d += timedelta(days=1)
    r = m.metricas_diarias(serie, 1, _estr())
    assert r["volatilidad"] == 0.0
    assert r["sharpe"] is None


def test_el_ratio_de_informacion_divide_la_activa_sin_redondear():
    # El fondo rinde lo del índice más 5e-8 ± 1e-4 en meses alternos. Media de la diferencia: 5e-8, así que la activa es
    # 5e-8 × 12 × 100 = 0,00006 puntos, que a cuatro decimales se publica 0,0001. Cada diferencia se aparta 1e-4 de su
    # media: tracking error = 1e-4 × raíz(12/11) × raíz(12) × 100 = 0,12 / raíz(11) = 0,036181...
    # Ratio = 0,00006 × raíz(11) / 0,12 = 0,0005 × raíz(11) = 0,001658... -> 0,0017. Con la activa redondeada salía
    # 0,0001 × raíz(11) / 0,12 = 0,002764... -> 0,0028.
    fechas = _fines_de_mes(date(2025, 1, 1), 13)
    ri = [0.02, -0.01] * 6
    indice = _niveles(fechas, ri)
    fondo = _niveles(fechas, [r + 5e-8 + (1e-4 if k % 2 == 0 else -1e-4) for k, r in enumerate(ri)])
    r = m.relativas(fondo, indice, "TOTAL_RETURN", ESTR_CERO, fin=date(2026, 1, 31))["1a"]
    assert r["rentabilidad_activa"] == 0.0001
    assert r["tracking_error"] == pytest.approx(0.12 / math.sqrt(11), abs=1e-4)
    assert r["information_ratio"] == pytest.approx(0.0005 * math.sqrt(11), abs=1e-4)
    assert r["information_ratio"] != pytest.approx(0.0001 * math.sqrt(11) / 0.12, abs=1e-4)
