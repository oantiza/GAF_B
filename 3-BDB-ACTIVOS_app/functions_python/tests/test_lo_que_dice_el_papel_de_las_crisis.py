"""Lo que el informe de cliente dice de cada crisis, comprobado contra el cálculo (decisión 3).

El papel escribe que la cifra compara el primer día con el punto más bajo, que no se mide desde un máximo, que las
posiciones sin precio al inicio no entran y que el resto se lleva al 100 %. Si alguien cambia el cálculo, esta prueba
falla, y hay que cambiar también `src/core/crisisPasadas.ts` y el texto de la hoja. Resultados calculados a mano.
"""
from datetime import date, timedelta
import math

from optimization.stress_analytics import stress_windows


HOY = "2026-11-05"


def puntos(*filas):
    return [{"date": fecha, "value": valor} for fecha, valor in filas]


def observada(*filas):
    """`puntos`, con cada hueco de más de 14 días dentro de la COVID relleno cada 7 días con el precio anterior.

    N03 (22-11-2026): una serie con un hueco así dentro de la crisis se aparta (GAP_IN_WINDOW). Estas series se
    escribieron con dos o tres puntos y contaban con que el último precio se llevase hasta el siguiente; el relleno
    escribe ese mismo precio como observación, solo dentro de la crisis, y las cuentas a mano no cambian.
    """
    rellenas = []
    for (fecha, valor), (siguiente, _valor) in zip(filas, filas[1:] + ((None, None),)):
        rellenas.append((fecha, valor))
        if siguiente is None:
            continue
        a, b = date.fromisoformat(fecha), date.fromisoformat(siguiente)
        if (b - a).days > 14 and date(2020, 2, 19) <= a < date(2020, 3, 23):
            dia = a + timedelta(days=7)
            while dia < b and dia <= date(2020, 3, 23):
                rellenas.append((dia.isoformat(), valor))
                dia += timedelta(days=7)
    return puntos(*rellenas)


def covid(escenarios):
    return next(item for item in escenarios if item["id"] == "COVID")


def test_es_la_variacion_desde_el_primer_dia_y_no_desde_el_maximo():
    # Sube de 100 a 110 y cae a 90: desde el primer día, -10 %. De pico a valle serían -18,18 %.
    serie = observada(("2020-02-19", 100), ("2020-03-02", 110), ("2020-03-20", 90), ("2020-03-23", 95))
    resultado = covid(stress_windows({"A": serie}, {"A": 1.0}, today=HOY))
    assert math.isclose(resultado["drawdown_pct"], -10.0, abs_tol=1e-6)
    assert resultado["start_date"] == "2020-02-19"
    assert resultado["trough_date"] == "2020-03-20"
    assert resultado["end_date"] == "2020-03-23"
    assert not math.isclose(resultado["drawdown_pct"], (90 / 110 - 1) * 100, abs_tol=1e-6)


def test_los_pesos_son_los_de_hoy_y_no_se_reequilibra():
    # 60 % en A (cae un 20 %) y 40 % en B (cae un 10 %): 0,6 x 0,8 + 0,4 x 0,9 = 0,84, o sea -16 %.
    a = observada(("2020-02-19", 100), ("2020-03-23", 80))
    b = observada(("2020-02-19", 50), ("2020-03-23", 45))
    resultado = covid(stress_windows({"A": a, "B": b}, {"A": 0.6, "B": 0.4}, today=HOY))
    assert math.isclose(resultado["drawdown_pct"], -16.0, abs_tol=1e-6)
    assert resultado["coverage"] == {"weight_pct": 100.0, "included_assets": 2, "total_assets": 2}


def test_sin_precio_al_inicio_no_entra_y_el_resto_se_lleva_al_100():
    # B empieza después de la crisis: la cifra es la de A sola, y mide el 70 % de la cartera. A llega hasta donde B
    # (P1-06, 21-11-2026): una serie que acaba más de catorce días antes que la más reciente se aparta por parada.
    a = observada(("2020-02-19", 100), ("2020-03-23", 80), ("2021-06-01", 80))
    b = observada(("2021-01-04", 100), ("2021-06-01", 90))
    resultado = covid(stress_windows({"A": a, "B": b}, {"A": 0.7, "B": 0.3}, today=HOY))
    assert math.isclose(resultado["drawdown_pct"], -20.0, abs_tol=1e-6)
    assert resultado["coverage"] == {"weight_pct": 70.0, "included_assets": 1, "total_assets": 2}
    assert resultado["excluded_assets"] == [{"asset_id": "B", "reason": "NO_DATA_AT_WINDOW_START"}]
    assert resultado["representative"] is True


def test_por_debajo_del_umbral_se_calcula_y_no_es_representativa():
    a = observada(("2020-02-19", 100), ("2020-03-23", 80), ("2021-06-01", 80))
    b = observada(("2021-01-04", 100), ("2021-06-01", 90))
    resultado = covid(stress_windows({"A": a, "B": b}, {"A": 0.5999, "B": 0.4001}, today=HOY))
    assert math.isclose(resultado["drawdown_pct"], -20.0, abs_tol=1e-6)
    assert resultado["representative"] is False


def test_si_nunca_baja_del_primer_dia_el_cero_es_de_verdad():
    serie = observada(("2020-02-19", 100), ("2020-03-23", 105))
    resultado = covid(stress_windows({"A": serie}, {"A": 1.0}, today=HOY))
    assert resultado["drawdown_pct"] == 0.0
    assert resultado["trough_date"] == "2020-02-19"
    assert resultado["end_date"] == "2020-03-23"
    # P1-06: y lo dice su estado. Antes salía «RECOVERED» sin haber caído.
    assert resultado["recovery_status"] == "NO_DRAWDOWN"


def test_sin_ninguna_posicion_con_dato_no_hay_cifra():
    serie = puntos(("2023-01-02", 100), ("2023-06-01", 90))
    resultado = covid(stress_windows({"A": serie}, {"A": 1.0}, today=HOY))
    assert resultado["drawdown_pct"] is None
    assert resultado["reason"] == "NO_ELIGIBLE_ASSETS"
    assert resultado["configured_start_date"] == "2020-02-19"
    assert resultado["coverage"]["weight_pct"] == 0.0
