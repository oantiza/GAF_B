"""La historia común mide de máximo a mínimo; las crisis, desde su primer día (decisión 115, 06-11-2026).

Antes la historia común medía del primer día de la historia común al punto más bajo, y una cartera que había subido
antes de caer daba una caída que no era una caída: con la muestra, −8,4 % junto a la COVID con el mismo mínimo y −22,2 %.
Ahora es la peor caída desde el máximo alcanzado hasta cada fecha, la duración va de ese máximo al mínimo y la
recuperación es la vuelta a ese máximo. Todo calculado a mano con series escritas aquí, no copiado de lo que da el código.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.stress_analytics import stress_windows  # noqa: E402


HOY = "2026-11-06"


def puntos(*filas):
    return [{"date": fecha, "value": valor} for fecha, valor in filas]


def escenario(resultado, cual):
    return next(item for item in resultado if item["id"] == cual)


def test_sube_cae_y_recupera_mide_desde_el_maximo():
    # A sube un 50 %, cae a 90 y vuelve a 160; B no se mueve. Con 50 % y 50 % el primer día, la cartera vale
    # 1 · 1,25 · 0,95 · 1,30 · 1,35. Desde el primer día al mínimo serían −5 %; desde el máximo, 0,95 / 1,25 − 1 = −24 %.
    series = {
        "A": puntos(("2019-01-01", 100), ("2020-01-01", 150), ("2020-06-01", 90), ("2021-06-01", 160), ("2023-01-02", 170)),
        "B": puntos(("2019-01-01", 100), ("2020-01-01", 100), ("2020-06-01", 100), ("2021-06-01", 100), ("2023-01-02", 100)),
    }
    comun = escenario(stress_windows(series, {"A": 50, "B": 50}, today=HOY), "COMMON_HISTORY")

    assert comun["drawdown_pct"] == pytest.approx(-24.0)
    assert comun["start_date"] == "2019-01-01"
    assert comun["end_date"] == "2023-01-02"
    assert comun["peak_date"] == "2020-01-01"
    assert comun["trough_date"] == "2020-06-01"
    # Del máximo al mínimo, 2020 bisiesto: 31 + 29 + 31 + 30 + 31.
    assert comun["duration_days"] == 152
    # Vuelve a 1,25 o más el 01-06-2021 (1,30): un año después del mínimo.
    assert comun["recovery_status"] == "RECOVERED"
    assert comun["recovery_date"] == "2021-06-01"
    assert comun["recovery_days"] == 365
    assert comun["remaining_to_recover_pct"] == 0.0
    # En el máximo A pesa 0,5 · 1,5 / 1,25 = 60 % y cae 90 / 150 − 1 = −40 %: resta 0,6 · −0,4 = −24 %, toda la caída.
    assert comun["worst_asset"]["asset_id"] == "A"
    assert comun["worst_asset"]["weight_pct"] == pytest.approx(60.0)
    assert comun["worst_asset"]["return_pct"] == pytest.approx(-40.0)
    assert comun["worst_asset"]["contribution_pct"] == pytest.approx(-24.0)
    assert comun["coverage"] == {"weight_pct": 100.0, "included_assets": 2, "total_assets": 2}
    assert comun["representative"] is True


def test_si_no_vuelve_al_maximo_no_hay_recuperacion_y_dice_cuanto_falta():
    # 25 % en A y 75 % en B: 1 · 1,2 · 0,96 · 1,055 · 1,125. Desde el máximo, 0,96 / 1,2 − 1 = −20 %, y al final está a
    # 1 − 1,125 / 1,2 = 6,25 % del máximo. Desde el primer día habrían sido −4 %, y recuperada en 2022.
    series = {
        "A": puntos(("2019-01-01", 100), ("2020-01-01", 120), ("2021-01-01", 60), ("2022-01-03", 80), ("2023-01-02", 90)),
        "B": puntos(("2019-01-01", 50), ("2020-01-01", 60), ("2021-01-01", 54), ("2022-01-03", 57), ("2023-01-02", 60)),
    }
    comun = escenario(stress_windows(series, {"A": 0.25, "B": 0.75}, today=HOY), "COMMON_HISTORY")

    assert comun["drawdown_pct"] == pytest.approx(-20.0)
    assert comun["peak_date"] == "2020-01-01"
    assert comun["trough_date"] == "2021-01-01"
    assert comun["duration_days"] == 366
    assert comun["recovery_status"] == "NOT_RECOVERED"
    assert comun["recovery_date"] is None
    assert comun["recovery_days"] is None
    assert comun["remaining_to_recover_pct"] == pytest.approx(6.25)
    # En el máximo A pesa 0,25 · 1,2 / 1,2 = 25 % y cae un 50 %: −12,5 %. B pesa 75 % y cae un 10 %: −7,5 %. Suman −20 %.
    assert comun["worst_asset"] == pytest.approx({
        "asset_id": "A", "weight_pct": 25.0, "return_pct": -50.0, "contribution_pct": -12.5,
    })


def test_la_crisis_sigue_desde_su_primer_dia_y_la_historia_comun_desde_el_maximo():
    # La misma serie: 100 el 19-02-2020, 110 el 02-03, 90 el 20-03. La COVID compara con su primer día, −10 %, y no tiene
    # máximo. La historia común compara con el máximo, 90 / 110 − 1 = −18,18 %, y vuelve a 110 el 01-06-2020. Los
    # puntos del 09-03 (105) y el 16-03 (100) bajan entre los dos: sin ellos, 18 días sin precio dentro de la COVID la
    # apartarían (N03, 22-11-2026), y ninguno es un máximo nuevo ni un mínimo.
    serie = puntos(
        ("2019-01-01", 100), ("2020-02-19", 100), ("2020-03-02", 110), ("2020-03-09", 105), ("2020-03-16", 100),
        ("2020-03-20", 90), ("2020-03-23", 95),
        ("2020-06-01", 110), ("2020-07-01", 111),
    )
    resultado = stress_windows({"A": serie}, {"A": 1.0}, today=HOY)
    covid = escenario(resultado, "COVID")
    comun = escenario(resultado, "COMMON_HISTORY")

    assert covid["drawdown_pct"] == pytest.approx(-10.0)
    assert covid["peak_date"] is None
    assert covid["start_date"] == "2020-02-19"
    assert covid["duration_days"] == 30

    assert comun["drawdown_pct"] == pytest.approx((90 / 110 - 1) * 100)
    assert comun["start_date"] == "2019-01-01"
    assert comun["peak_date"] == "2020-03-02"
    assert comun["trough_date"] == "2020-03-20"
    assert comun["duration_days"] == 18
    assert comun["recovery_date"] == "2020-06-01"
    assert comun["recovery_days"] == 73


def test_un_maximo_repetido_cuenta_desde_el_ultimo_dia_en_ese_nivel():
    # 120 el 03-06 y otra vez el 10-06: la caída empieza a contar el 10-06, como los episodios de caída del interno.
    serie = puntos(("2019-01-01", 100), ("2019-06-03", 120), ("2019-06-10", 120), ("2019-07-01", 90), ("2019-09-02", 125))
    comun = escenario(stress_windows({"A": serie}, {"A": 1.0}, today=HOY), "COMMON_HISTORY")

    assert comun["drawdown_pct"] == pytest.approx(-25.0)
    assert comun["peak_date"] == "2019-06-10"
    assert comun["duration_days"] == 21
    assert comun["recovery_date"] == "2019-09-02"
    assert comun["recovery_days"] == 63


def test_sin_datos_no_hay_maximo():
    resultado = stress_windows({}, {"A": 1.0}, today=HOY)
    assert all(item["peak_date"] is None for item in resultado)
