# -*- coding: utf-8 -*-
"""Comparador patrimonial F3: fiscalidad Bizkaia, ACT/360 y TIR real IPC."""
import os
import sys
from datetime import date

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import macro_reference as mr  # noqa: E402


# ---------------------------------------------------------------------------
# Escala marginal Bizkaia 2026
# ---------------------------------------------------------------------------

BRACKET_BOUNDARIES = [
    # umbral, cuota exacta en el umbral, tipo justo debajo, tipo justo encima
    (0.0, 0.0, 0.0, 0.19),
    (7_500.0, 1_425.0, 0.19, 0.20),
    (15_000.0, 2_925.0, 0.20, 0.22),
    (30_000.0, 6_225.0, 0.22, 0.24),
    (50_000.0, 11_025.0, 0.24, 0.255),
    (90_000.0, 21_225.0, 0.255, 0.26),
    (120_000.0, 29_025.0, 0.26, 0.265),
    (240_000.0, 60_825.0, 0.265, 0.27),
    (300_000.0, 77_025.0, 0.27, 0.28),
]


def test_impuesto_cero_para_base_no_positiva_o_invalida():
    assert mr.impuesto_ahorro_bizkaia(0.0) == 0.0
    assert mr.impuesto_ahorro_bizkaia(-1_500.0) == 0.0
    assert mr.impuesto_ahorro_bizkaia(None) == 0.0
    assert mr.impuesto_ahorro_bizkaia(float("inf")) == 0.0
    assert mr.impuesto_ahorro_bizkaia(True) == 0.0


@pytest.mark.parametrize(
    "threshold,tax_at,rate_below,rate_above",
    BRACKET_BOUNDARIES,
    ids=["0", "7500", "15000", "30000", "50000", "90000", "120000", "240000", "300000"],
)
def test_impuesto_debajo_en_y_encima_de_cada_frontera(
        threshold, tax_at, rate_below, rate_above):
    """Cobertura explícita de las tres posiciones en TODAS las fronteras."""
    delta = 0.01
    expected_below = max(0.0, tax_at - delta * rate_below)
    assert mr.impuesto_ahorro_bizkaia(threshold - delta) == pytest.approx(expected_below)
    assert mr.impuesto_ahorro_bizkaia(threshold) == pytest.approx(tax_at)
    assert mr.impuesto_ahorro_bizkaia(threshold + delta) == pytest.approx(
        tax_at + delta * rate_above
    )


def test_escala_serializable_coincide_con_la_constante():
    assert mr.bizkaia_tax_brackets_payload() == [
        {"threshold_eur": 0.0, "rate_pct": 19.0},
        {"threshold_eur": 7_500.0, "rate_pct": 20.0},
        {"threshold_eur": 15_000.0, "rate_pct": 22.0},
        {"threshold_eur": 30_000.0, "rate_pct": 24.0},
        {"threshold_eur": 50_000.0, "rate_pct": 25.5},
        {"threshold_eur": 90_000.0, "rate_pct": 26.0},
        {"threshold_eur": 120_000.0, "rate_pct": 26.5},
        {"threshold_eur": 240_000.0, "rate_pct": 27.0},
        {"threshold_eur": 300_000.0, "rate_pct": 28.0},
    ]
    assert mr.impuesto_ahorro_bizkaia(310_000.0) == pytest.approx(79_825.0)


# ---------------------------------------------------------------------------
# Curvas estáticas portadas del legacy
# ---------------------------------------------------------------------------

def test_tasa_anual_dentro_y_fuera_de_rango():
    assert mr._tasa_anual(mr.DEPOSIT_RATES_BY_YEAR, 2008) == pytest.approx(0.035)
    assert mr._tasa_anual(mr.DEPOSIT_RATES_BY_YEAR, 1999) == pytest.approx(0.02)
    assert mr._tasa_anual(mr.DEPOSIT_RATES_BY_YEAR, 2030) == pytest.approx(0.02)


def test_curvas_portadas_del_legacy():
    assert mr.DEPOSIT_RATES_BY_YEAR[2023] == 2.00
    assert mr.DEPOSIT_RATES_BY_YEAR[2016] == 0.10
    assert mr.LETRAS_RATES_BY_YEAR[2021] == -0.50
    assert mr.LETRAS_RATES_BY_YEAR[2023] == 3.38


# ---------------------------------------------------------------------------
# Depósito: ACT/360 y liquidación fiscal anual/final
# ---------------------------------------------------------------------------

def test_deposito_tipo_fijo_un_anio_completo():
    result = mr.simulate_deposito(
        [(date(2023, 1, 1), 10_000.0)], date(2024, 1, 1), rate_pct=3.6,
    )
    # 365 días ACT/360: 365 EUR; primer tramo fiscal 19 % = 69,35 EUR.
    assert result["valor_bruto"] == pytest.approx(10_365.0)
    assert result["intereses_brutos"] == pytest.approx(365.0)
    assert result["impuestos"] == pytest.approx(69.35)
    assert result["valor_neto"] == pytest.approx(10_295.65)


def test_deposito_anio_parcial_tributa_al_final():
    result = mr.simulate_deposito(
        [(date(2023, 1, 1), 10_000.0)], date(2023, 7, 1), rate_pct=3.6,
    )
    assert result["valor_bruto"] == pytest.approx(10_181.0)
    assert result["impuestos"] == pytest.approx(181.0 * 0.19)
    assert result["valor_neto"] == pytest.approx(10_181.0 - 181.0 * 0.19)


def test_deposito_varios_anios_renueva_capital_y_liquida_cada_anio():
    result = mr.simulate_deposito(
        [(date(2023, 1, 1), 10_000.0)], date(2025, 1, 1), rate_pct=3.6,
    )
    net_2023 = 10_000.0 + 365.0 * (1.0 - 0.19)
    interest_2024 = net_2023 * 0.036 * (366.0 / 360.0)
    expected_net = net_2023 + interest_2024 * (1.0 - 0.19)
    assert result["valor_bruto"] == pytest.approx(10_744.359)
    assert result["valor_neto"] == pytest.approx(expected_net)
    assert result["impuestos"] == pytest.approx(365.0 * 0.19 + interest_2024 * 0.19)


def test_deposito_aplica_escala_progresiva_en_cada_liquidacion():
    result = mr.simulate_deposito(
        [(date(2023, 1, 1), 1_000_000.0)], date(2024, 1, 1), rate_pct=10.0,
    )
    gross_interest = 1_000_000.0 * 0.10 * (365.0 / 360.0)
    expected_tax = mr.impuesto_ahorro_bizkaia(gross_interest)
    assert expected_tax > gross_interest * 0.19
    assert result["impuestos"] == pytest.approx(expected_tax)
    assert result["valor_neto"] == pytest.approx(1_000_000.0 + gross_interest - expected_tax)


def test_deposito_curva_historica_por_defecto():
    result = mr.simulate_deposito(
        [(date(2023, 1, 1), 10_000.0)], date(2024, 1, 1),
    )
    interest = 10_000.0 * 0.02 * (365.0 / 360.0)
    assert result["valor_bruto"] == pytest.approx(10_000.0 + interest)
    assert result["valor_neto"] == pytest.approx(10_000.0 + interest * 0.81)


def test_deposito_tipo_cero_varios_anios_no_genera_rendimiento_ni_impuesto():
    result = mr.simulate_deposito(
        [(date(2021, 1, 1), 10_000.0)], date(2025, 1, 1), rate_pct=0.0,
    )
    assert result == {
        "valor_neto": pytest.approx(10_000.0),
        "valor_bruto": pytest.approx(10_000.0),
        "intereses_brutos": pytest.approx(0.0),
        "impuestos": pytest.approx(0.0),
    }


def test_deposito_rechaza_tipo_fuera_de_rango():
    with pytest.raises(ValueError, match="rango -5..25"):
        mr.simulate_deposito(
            [(date(2023, 1, 1), 10_000.0)], date(2024, 1, 1), rate_pct=25.01,
        )


def test_deposito_reintegro_reduce_saldo():
    result = mr.simulate_deposito(
        [(date(2023, 1, 1), 10_000.0), (date(2023, 7, 1), -5_000.0)],
        date(2024, 1, 1),
        rate_pct=0.0,
    )
    assert result["valor_bruto"] == pytest.approx(5_000.0)
    assert result["valor_neto"] == pytest.approx(5_000.0)


# ---------------------------------------------------------------------------
# Letras: curva legacy y una única liquidación al vencimiento
# ---------------------------------------------------------------------------

def test_letras_tipo_negativo_reduce_saldo_sin_credito_fiscal():
    result = mr.simulate_letras(
        [(date(2020, 1, 1), 10_000.0)], date(2021, 1, 1),
    )
    expected = 10_000.0 + 10_000.0 * (-0.0046) * (366.0 / 360.0)
    assert result["valor_bruto"] == pytest.approx(expected)
    assert result["valor_neto"] == pytest.approx(expected)
    assert result["impuestos"] == 0.0


def test_letras_liquida_progresivo_una_vez_al_vencimiento():
    result = mr.simulate_letras(
        [(date(2022, 1, 1), 1_000_000.0)], date(2025, 1, 1),
    )
    expected_tax = mr.impuesto_ahorro_bizkaia(result["intereses_brutos"])
    assert expected_tax > 0
    assert result["impuestos"] == pytest.approx(expected_tax)
    assert result["valor_neto"] == pytest.approx(result["valor_bruto"] - expected_tax)


def test_letras_no_descuenta_impuesto_en_cada_renovacion_anual():
    result = mr.simulate_letras(
        [(date(2023, 1, 1), 100_000.0)], date(2025, 1, 1),
    )
    interest_2023 = 100_000.0 * 0.0338 * (365.0 / 360.0)
    gross_2023 = 100_000.0 + interest_2023
    interest_2024 = gross_2023 * 0.0341 * (366.0 / 360.0)
    expected_gross = gross_2023 + interest_2024
    expected_net = expected_gross - mr.impuesto_ahorro_bizkaia(interest_2023 + interest_2024)

    annual_net_2023 = gross_2023 - mr.impuesto_ahorro_bizkaia(interest_2023)
    annual_interest_2024 = annual_net_2023 * 0.0341 * (366.0 / 360.0)
    incorrectly_taxed_each_year = (
        annual_net_2023 + annual_interest_2024
        - mr.impuesto_ahorro_bizkaia(annual_interest_2024)
    )

    assert result["valor_bruto"] == pytest.approx(expected_gross)
    assert result["valor_neto"] == pytest.approx(expected_net)
    assert result["valor_neto"] != pytest.approx(incorrectly_taxed_each_year)


# ---------------------------------------------------------------------------
# XIRR con el año del proyecto (365,2425 días, como src/core/xirr.ts) y TIR real por deflactor mensual
# ---------------------------------------------------------------------------

def test_xirr_con_el_anio_del_proyecto_un_flujo_y_valor_final():
    result = mr.xirr([
        (date(2020, 1, 1), -1_000.0),
        (date(2021, 1, 1), 1_100.0),
    ])
    # 366 días de 2024. A mano: ln(1,1) = 0,0953102; por 365,2425/366 = 0,0951129; e^x - 1 = 9,9783 %.
    assert result == pytest.approx(1.1 ** (365.2425 / 366.0) - 1.0, rel=1e-6)
    assert result == pytest.approx(0.099783, abs=1e-5)


def test_xirr_con_el_anio_del_proyecto_rentabilidad_negativa():
    result = mr.xirr([
        (date(2020, 1, 1), -1_000.0),
        (date(2022, 1, 1), 810.0),
    ])
    assert result == pytest.approx(0.81 ** (365.2425 / 731.0) - 1.0, rel=1e-6)


def test_la_tir_no_cambia_al_pulsar_el_boton():
    """Era 54,55 % en pantalla y 54,51 % al pulsar: la misma aportación con dos años distintos."""
    final = 1_000.0 * 1.5455 ** (365.0 / 365.2425)
    flows = [(date(2025, 1, 1), -1_000.0), (date(2026, 1, 1), final)]
    assert mr.xirr(flows) == pytest.approx(0.5455, abs=1e-6)
    # Lo que daba con ACT/365, para que se vea que la diferencia era esa y no otra.
    assert final / 1_000.0 - 1.0 == pytest.approx(0.5451, abs=1e-4)


def test_la_misma_tir_que_la_pantalla_con_varias_aportaciones():
    """El ejemplo de la pantalla. La misma cifra en tests/xirr.test.ts, que la saca de src/core/xirr.ts."""
    flows = [(date(2021, 1, 15), -50_000.0), (date(2023, 6, 15), -20_000.0), (date(2026, 11, 4), 95_000.0)]
    tir = mr.xirr(flows)
    # Se comprueba sin xirr: esa tasa anula el valor actual con el año de 365,2425 días.
    valor_actual = sum(importe / (1 + tir) ** ((dia - flows[0][0]).days / 365.2425) for dia, importe in flows)
    assert abs(valor_actual) < 1e-4
    assert tir == pytest.approx(0.0611281, abs=1e-6)


def test_xirr_flujos_invalidos_devuelve_none():
    assert mr.xirr([(date(2020, 1, 1), -1_000.0)]) is None
    assert mr.xirr([(date(2020, 1, 1), -1_000.0), (date(2021, 1, 1), -500.0)]) is None
    assert mr.xirr([]) is None


# H2-09 (auditoria del 22-11-2026). Con todos los flujos el mismo día no pasa el tiempo: el valor actual es la suma de
# los flujos con cualquier tasa, y la TIR no está definida. Antes, si esa suma era cero, los dos extremos de la
# bisección daban 0 y el primer punto medio, (−0,95 + 5) / 2 = 2,025, «anulaba» el valor actual: 202,5 %.

def test_xirr_con_todos_los_flujos_el_mismo_dia_no_esta_definida():
    dia = date(2025, 1, 1)
    assert mr.xirr([(dia, -100.0), (dia, 100.0)]) is None  # antes, 2,025
    assert mr.xirr([(dia, -100.0), (dia, 105.0)]) is None
    assert mr.xirr([(dia, -60.0), (dia, -40.0), (dia, 100.0)]) is None  # antes, 2,025


def test_xirr_netea_los_flujos_del_mismo_dia():
    # −1.000 y −500 el 01-01-2020 pesan lo que −1.500; +1.650 el 01-01-2021 (366 días). A mano: 1.650 / 1.500 = 1,1,
    # la misma TIR que −1.000 → +1.100: 1,1^(365,2425/366) − 1 = 9,9783 %.
    neteado = mr.xirr([(date(2020, 1, 1), -1_000.0), (date(2020, 1, 1), -500.0), (date(2021, 1, 1), 1_650.0)])
    assert neteado == pytest.approx(1.1 ** (365.2425 / 366.0) - 1.0, rel=1e-6)
    # Un día cuyo neto es cero no cuenta: −100 y +100 el 01-06-2020 no cambian la TIR.
    con_un_dia_a_cero = mr.xirr([
        (date(2020, 1, 1), -1_000.0), (date(2020, 6, 1), -100.0), (date(2020, 6, 1), 100.0), (date(2021, 1, 1), 1_100.0),
    ])
    assert con_un_dia_a_cero == pytest.approx(1.1 ** (365.2425 / 366.0) - 1.0, rel=1e-6)
    # Y si lo único que queda tras netear es de un signo, no hay TIR: −1.000 hoy y −100 / +100 dentro de un año.
    assert mr.xirr([(date(2020, 1, 1), -1_000.0), (date(2021, 1, 1), -100.0), (date(2021, 1, 1), 100.0)]) is None


def test_una_aportacion_del_mismo_dia_que_el_final_no_da_tir_en_ninguna_alternativa():
    # El caso de la pantalla: 1.000 € aportados el mismo día de la fecha final. Letras y depósito valen 1.000 € ese día
    # (no ha pasado el tiempo) y daban 202,5 % con cualquier valor final de la cartera; la cartera, con 1.000 €, también.
    dia = date(2026, 11, 22)
    for valor_final in (1_050.0, 1_000.0):
        comparativa = mr.build_patrimonial_comparison([(dia, 1_000.0)], valor_final, dia)
        for nombre in ("cartera", "letras", "deposito"):
            alternativa = comparativa[nombre]
            assert alternativa["tir_nominal_bruta_pct"] is None, (valor_final, nombre)
            assert alternativa["tir_nominal_neta_pct"] is None, (valor_final, nombre)
            assert alternativa["tir_real_bruta_pct"] is None, (valor_final, nombre)
            assert alternativa["tir_real_neta_pct"] is None, (valor_final, nombre)
        # Los valores finales sí están: el importe de Letras y depósito es lo aportado.
        assert comparativa["letras"]["valor_final_bruto"] == 1_000.0
        assert comparativa["deposito"]["valor_final_bruto"] == 1_000.0


def test_la_tasa_devuelta_anula_siempre_el_valor_actual():
    # Unos flujos de signo alterno con dos cambios de signo y aportaciones el mismo día que el final: lo que devuelva
    # xirr se comprueba sin xirr, con el año de 365,2425 días.
    flows = [
        (date(2020, 1, 1), -10_000.0), (date(2021, 3, 1), 4_000.0), (date(2022, 7, 1), -3_000.0),
        (date(2024, 1, 1), -2_000.0), (date(2024, 1, 1), 13_500.0),
    ]
    tir = mr.xirr(flows)
    assert tir is not None
    valor_actual = sum(importe / (1 + tir) ** ((dia - flows[0][0]).days / 365.2425) for dia, importe in flows)
    assert abs(valor_actual) <= max(1e-6, 1e-9 * sum(abs(importe) for _, importe in flows))


def test_tir_real_por_ipc_con_deflacion_es_superior_a_nominal():
    flows = [(date(2023, 1, 1), -10_000.0), (date(2024, 1, 1), 10_000.0)]
    nominal = mr.xirr(flows)
    real = mr.tir_real_por_ipc(
        flows, {"2023-01": 100.0, "2024-01": 98.0}, date(2024, 1, 1),
    )
    assert nominal == pytest.approx(0.0)
    assert real == pytest.approx((10_000.0 / 9_800.0) ** (365.2425 / 365.0) - 1.0)
    assert real > nominal


def test_tir_real_deflacta_cada_flujo_con_su_mes_ipc():
    flows = [
        (date(2024, 1, 1), -1_000.0),
        (date(2025, 1, 1), -1_000.0),
        (date(2026, 1, 1), 2_200.0),
    ]
    ipc = {"2024-01": 120.0, "2025-01": 110.0, "2026-01": 100.0}
    expected_real_flows = [
        (date(2024, 1, 1), -1_000.0 * 100.0 / 120.0),
        (date(2025, 1, 1), -1_000.0 * 100.0 / 110.0),
        (date(2026, 1, 1), 2_200.0),
    ]

    result = mr.tir_real_por_ipc(flows, ipc, date(2026, 1, 1))
    assert result == pytest.approx(mr.xirr(expected_real_flows))
    assert result > mr.xirr(flows)


def test_tir_real_de_resultado_conocido():
    """Se ganó un 10 % con una inflación del 10 %: en euros de hoy no se ha ganado nada."""
    flows = [(date(2024, 3, 15), -1_000.0), (date(2025, 3, 15), 1_100.0)]
    assert mr.tir_real_por_ipc(flows, {"2024-03": 100.0, "2025-03": 110.0}, date(2025, 3, 15)) == pytest.approx(0.0, abs=1e-9)


def test_si_falta_un_mes_no_se_publica_la_tir_real():
    """Con factor 1, ese flujo se quedaba sin deflactar y la cifra se publicaba como real."""
    flows = [(date(2024, 3, 15), -1_000.0), (date(2024, 6, 15), -1_000.0), (date(2025, 3, 15), 2_300.0)]
    ipc = {"2024-03": 100.0, "2025-03": 110.0}
    assert mr.tir_real_por_ipc(flows, ipc, date(2025, 3, 15)) is None
    assert mr.tir_real_por_ipc(flows, {**ipc, "2024-06": 102.0}, date(2025, 3, 15)) is not None
    assert mr.meses_sin_ipc([(date(2024, 3, 15), 1_000.0), (date(2024, 6, 15), 1_000.0)], ipc, date(2025, 3, 15)) == ["2024-06"]


def test_una_aportacion_posterior_al_ultimo_ipc_tampoco_se_deflacta():
    flows = [(date(2026, 1, 15), -1_000.0), (date(2026, 11, 2), -1_000.0), (date(2026, 11, 4), 2_200.0)]
    assert mr.tir_real_por_ipc(flows, {"2026-01": 100.0, "2026-10": 102.0}, date(2026, 11, 4)) is None


def test_una_aportacion_de_la_fecha_final_no_necesita_ipc():
    """El valor final y lo que se aporte ese día ya están en euros de esa fecha."""
    flows = [(date(2026, 1, 15), -1_000.0), (date(2026, 11, 4), 1_100.0)]
    assert mr.tir_real_por_ipc(flows, {"2026-01": 100.0, "2026-10": 102.0}, date(2026, 11, 4)) is not None


def test_el_ipc_se_pide_desde_el_dia_1_del_mes():
    pedidas = []

    def responde(url):
        pedidas.append(url)
        return {"Data": [
            {"Fecha": 1_709_251_200_000, "Anyo": 2024, "FK_Periodo": 3, "Valor": 100.0},
            {"Fecha": 1_740_787_200_000, "Anyo": 2025, "FK_Periodo": 3, "Valor": 110.0},
        ]}

    original = mr._http_json
    mr._http_json = responde
    try:
        resultado = mr._ine_inflation("2024-03-15", "2025-03-15")
    finally:
        mr._http_json = original
    assert pedidas[0].endswith("?date=20240301:20250315")
    assert resultado["ipc_monthly"]["2024-03"] == 100.0


def test_get_macro_reference_pide_el_ipc_desde_la_primera_aportacion_y_dice_lo_que_falta(monkeypatch):
    pedidas = []

    def ine(inicio, fin):
        pedidas.append((inicio, fin))
        return {"total_pct": 10.0, "annual_pct": 10.0, "ipc_start": 100.0, "ipc_end": 110.0,
                "ipc_monthly": {"2024-01": 100.0, "2025-03": 110.0}}

    monkeypatch.setattr(mr, "_ine_inflation", ine)
    monkeypatch.setattr(mr, "_bde_letras", lambda _start, _end: 2.5)
    mr._result_cache.clear()
    result = mr.get_macro_reference({
        "start_date": "2024-03-01", "end_date": "2025-03-15", "final_value": 2_300.0,
        "flows": [{"date": "2024-01-20", "amount": 1_000.0}, {"date": "2024-06-15", "amount": 1_000.0}],
    })
    # Una aportación anterior a la fecha pedida también necesita su IPC.
    assert pedidas == [("2024-01-20", "2025-03-15")]
    cartera = result["comparison"]["cartera"]
    assert cartera["tir_nominal_bruta_pct"] is not None
    assert cartera["tir_real_bruta_pct"] is None
    assert cartera["tir_real_neta_pct"] is None
    assert result["notes"] == "TIR real no disponible: falta el IPC de 2024-06."
    mr._result_cache.clear()


def test_tir_real_por_ipc_sin_mapa_devuelve_none():
    flows = [(date(2023, 1, 1), -10_000.0), (date(2024, 1, 1), 11_000.0)]
    assert mr.tir_real_por_ipc(flows, None, date(2024, 1, 1)) is None
    assert mr.tir_real_por_ipc(flows, {}, date(2024, 1, 1)) is None


def test_ine_conserva_mapa_mensual_y_admite_inflacion_negativa(monkeypatch):
    monkeypatch.setattr(mr, "_http_json", lambda _url: {"Data": [
        {"Fecha": 1_672_531_200_000, "Anyo": 2023, "FK_Periodo": 1, "Valor": 100.0},
        {"Fecha": 1_704_067_200_000, "Anyo": 2024, "FK_Periodo": 1, "Valor": 98.0},
    ]})
    result = mr._ine_inflation("2023-01-01", "2024-01-01")
    assert result["ipc_monthly"] == {"2023-01": 100.0, "2024-01": 98.0}
    assert result["total_pct"] == pytest.approx(-2.0)
    # 365 días: la inflación anualizada con el mismo año que todo lo demás.
    assert result["annual_pct"] == pytest.approx((0.98 ** (365.2425 / 365.0) - 1.0) * 100.0)


# ---------------------------------------------------------------------------
# Comparativa completa y contrato de get_macro_reference
# ---------------------------------------------------------------------------

IPC_2023_2025 = {
    "2023-01": 100.0,
    "2024-01": 103.0,
    "2025-01": 106.09,
}


def test_build_patrimonial_comparison_liquida_cartera_al_final():
    comparison = mr.build_patrimonial_comparison(
        [(date(2023, 1, 1), 50_000.0)],
        60_000.0,
        date(2025, 1, 1),
        deposit_rate_pct=3.0,
        ipc_monthly=IPC_2023_2025,
    )
    assert set(comparison) == {"cartera", "letras", "deposito"}
    cartera = comparison["cartera"]
    # Plusvalía 10.000: 7.500*19% + 2.500*20% = 1.925.
    assert cartera["valor_final_bruto"] == pytest.approx(60_000.0)
    assert cartera["valor_final_neto"] == pytest.approx(58_075.0)
    assert cartera["tir_nominal_bruta_pct"] > cartera["tir_nominal_neta_pct"]
    assert cartera["tir_real_bruta_pct"] < cartera["tir_nominal_bruta_pct"]
    for alternative in ("letras", "deposito"):
        assert comparison[alternative]["valor_final_neto"] <= comparison[alternative]["valor_final_bruto"]
        assert comparison[alternative]["tir_real_neta_pct"] is not None


def test_build_patrimonial_comparison_rechaza_datos_invalidos():
    assert mr.build_patrimonial_comparison([], 60_000.0, date(2025, 1, 1)) is None
    assert mr.build_patrimonial_comparison(
        [(date(2023, 1, 1), 50_000.0)], 0.0, date(2025, 1, 1),
    ) is None
    assert mr.build_patrimonial_comparison(
        [(date(2026, 1, 1), 50_000.0)], 60_000.0, date(2025, 1, 1),
    ) is None
    assert mr.build_patrimonial_comparison(
        [(date(2023, 1, 1), 50_000.0)], 60_000.0, date(2025, 1, 1),
        deposit_rate_pct=99.0,
    ) is None


def test_parse_comparison_request_filtra_flujos_invalidos():
    parsed = mr._parse_comparison_request({
        "end_date": "2025-01-01",
        "final_value": 60_000,
        "flows": [
            {"date": "2023-01-01", "amount": 50_000},
            {"date": "fecha-mala", "amount": 1_000},
            {"date": "2026-01-01", "amount": 1_000},
            {"date": "2024-01-01", "amount": float("nan")},
            {"date": "2024-01-01", "amount": True},
            "no-es-dict",
        ],
        "deposit_rate_pct": 2.75,
    })
    assert parsed == ([(date(2023, 1, 1), 50_000.0)], 60_000.0, date(2025, 1, 1), 2.75)


def test_parse_comparison_request_rechaza_tipo_fuera_de_rango():
    with pytest.raises(ValueError, match="rango -5..25"):
        mr._parse_comparison_request({
            "end_date": "2025-01-01",
            "final_value": 60_000,
            "flows": [{"date": "2023-01-01", "amount": 50_000}],
            "deposit_rate_pct": 99.0,
        })


def test_parse_comparison_request_rechaza_payloads_abusivos_o_incompletos():
    assert mr._parse_comparison_request({}) is None
    assert mr._parse_comparison_request({"flows": [], "final_value": 1_000, "end_date": "2025-01-01"}) is None
    assert mr._parse_comparison_request({
        "flows": [{"date": "2023-01-01", "amount": 100}],
        "final_value": 0,
        "end_date": "2025-01-01",
    }) is None
    assert mr._parse_comparison_request({
        "flows": [{"date": "2023-01-01", "amount": 1}] * 1_001,
        "final_value": 1_000,
        "end_date": "2025-01-01",
    }) is None


def test_get_macro_reference_incluye_contrato_fiscal_progresivo(monkeypatch):
    monkeypatch.setattr(mr, "_ine_inflation", lambda _start, _end: {
        "total_pct": 6.09,
        "annual_pct": 3.0,
        "ipc_start": 100.0,
        "ipc_end": 106.09,
        "ipc_monthly": IPC_2023_2025,
    })
    monkeypatch.setattr(mr, "_bde_letras", lambda _start, _end: 2.5)
    mr._result_cache.clear()
    result = mr.get_macro_reference({
        "start_date": "2023-01-01",
        "end_date": "2025-01-01",
        "flows": [{"date": "2023-01-01", "amount": 50_000}],
        "final_value": 60_000,
        "deposit_rate_pct": 2.0,
    })
    assert "impuesto_bizkaia_pct" not in result
    assert result["bizkaia_tax_brackets"] == mr.bizkaia_tax_brackets_payload()
    assert result["deposit_rate_used_pct"] == 2.0
    assert result["deposit_rate_default_pct"] == mr.DEPOSIT_RATES_BY_YEAR[2026]
    assert result["comparison"]["cartera"]["valor_final_neto"] == pytest.approx(58_075.0)
    assert result["comparison"]["deposito"]["tir_real_neta_pct"] is not None


def test_get_macro_reference_respuesta_clasica_no_cambia(monkeypatch):
    monkeypatch.setattr(mr, "_ine_inflation", lambda _start, _end: {
        "total_pct": 6.09,
        "annual_pct": 3.0,
        "ipc_start": 100.0,
        "ipc_end": 106.09,
        "ipc_monthly": IPC_2023_2025,
    })
    monkeypatch.setattr(mr, "_bde_letras", lambda _start, _end: 2.5)
    mr._result_cache.clear()
    result = mr.get_macro_reference({
        "start_date": "2023-01-01", "end_date": "2025-01-01",
    })
    assert result["inflation_annual_pct"] == 3.0
    assert result["letras_avg_rate_pct"] == 2.5
    assert "comparison" not in result
    assert "bizkaia_tax_brackets" not in result
    assert "impuesto_bizkaia_pct" not in result


def test_get_macro_reference_cachea_resultados_limpios(monkeypatch):
    """Auditoría 11-08 (D13): la 2.ª llamada con el mismo payload no va a la red."""
    calls = []

    def fake_ine(_start, _end):
        calls.append("ine")
        return {"total_pct": 6.09, "annual_pct": 3.0, "ipc_start": 100.0,
                "ipc_end": 106.09, "ipc_monthly": IPC_2023_2025}

    monkeypatch.setattr(mr, "_ine_inflation", fake_ine)
    monkeypatch.setattr(mr, "_bde_letras", lambda _start, _end: 2.5)
    mr._result_cache.clear()

    payload = {"start_date": "2023-01-01", "end_date": "2025-01-01"}
    first = mr.get_macro_reference(dict(payload))
    second = mr.get_macro_reference(dict(payload))

    assert first == second
    assert calls == ["ine"]
    mr._result_cache.clear()


def test_get_macro_reference_no_cachea_fallos(monkeypatch):
    """Un fallo transitorio de INE/BdE no debe quedar fijado 6 h en caché."""
    monkeypatch.setattr(mr, "_ine_inflation",
                        lambda _start, _end: (_ for _ in ()).throw(OSError("INE caida")))
    monkeypatch.setattr(mr, "_bde_letras",
                        lambda _start, _end: (_ for _ in ()).throw(OSError("BdE caida")))
    mr._result_cache.clear()

    result = mr.get_macro_reference({"start_date": "2023-01-01", "end_date": "2025-01-01"})

    assert "INE" in result["notes"] and "BdE" in result["notes"]
    assert mr._result_cache == {}


# ---------------------------------------------------------------------------
# Hallazgo 27: cada dato dice de dónde sale y qué es
# ---------------------------------------------------------------------------

def _ine_ok(_start, _end):
    return {"total_pct": 6.09, "annual_pct": 3.0, "ipc_start": 100.0,
            "ipc_end": 106.09, "ipc_monthly": IPC_2023_2025}


_PAYLOAD_COMPARATIVA = {
    "start_date": "2023-01-01", "end_date": "2025-01-01",
    "flows": [{"date": "2023-01-01", "amount": 50_000}], "final_value": 60_000,
}


def test_source_solo_nombra_las_fuentes_que_respondieron(monkeypatch):
    monkeypatch.setattr(mr, "_ine_inflation", _ine_ok)
    monkeypatch.setattr(mr, "_bde_letras", lambda _s, _e: (_ for _ in ()).throw(OSError("BdE caida")))
    mr._result_cache.clear()

    result = mr.get_macro_reference({"start_date": "2023-01-01", "end_date": "2025-01-01"})

    assert "INE" in result["source"] and "BdE" not in result["source"]
    assert [x["status"] for x in result["sources"]] == ["OK", "ERROR"]
    assert result["sources"][0]["last_data"] == max(IPC_2023_2025)
    assert result["letras_avg_rate_pct"] is None
    mr._result_cache.clear()


def test_sin_ninguna_fuente_no_se_afirma_ninguna(monkeypatch):
    boom = lambda *_a: (_ for _ in ()).throw(OSError("caida"))  # noqa: E731
    monkeypatch.setattr(mr, "_ine_inflation", boom)
    monkeypatch.setattr(mr, "_bde_letras", boom)
    mr._result_cache.clear()
    result = mr.get_macro_reference({"start_date": "2023-01-01", "end_date": "2025-01-01"})
    assert result["source"] == "Ninguna fuente respondió"
    mr._result_cache.clear()


def test_letras_dice_su_periodo_real_y_la_fecha_de_su_ultimo_dato(monkeypatch):
    monkeypatch.setattr(mr, "_ine_inflation", _ine_ok)
    monkeypatch.setattr(mr, "_bde_letras", lambda _s, _e: (2.5, "2026-11-13"))
    mr._result_cache.clear()

    result = mr.get_macro_reference({"start_date": "2023-01-01", "end_date": "2025-01-01"})

    assert result["letras_avg_rate_pct"] == 2.5  # la cifra no cambia
    assert result["letras_period"]["kind"] == "LAST_12_MONTHS"
    assert result["letras_period"]["matches_request"] is False
    assert "BdE (Letras del Tesoro 1A), último dato 2026-11-13" in result["source"]

    coincide = mr._letras_matches_request("2025-11-13", "2026-11-13", "2026-11-13")
    assert coincide is True
    mr._result_cache.clear()


def test_tipos_de_tabla_y_supuestos_viajan_marcados(monkeypatch):
    monkeypatch.setattr(mr, "_ine_inflation", _ine_ok)
    monkeypatch.setattr(mr, "_bde_letras", lambda _s, _e: 2.5)
    mr._result_cache.clear()
    payload = dict(_PAYLOAD_COMPARATIVA, end_date="2026-06-30")

    result = mr.get_macro_reference(payload)

    assert result["deposit_rate_default_year"] == 2026
    assert result["deposit_rate_default_kind"] == "ASSUMPTION"
    assert result["deposit_rate_default_pct"] == mr.DEPOSIT_RATES_BY_YEAR[2026]
    tablas = result["rate_tables"]
    assert tablas["deposit"]["assumed_years"] == [2025, 2026]
    assert tablas["letras"]["measured_through_year"] == 2024
    kinds = {x["year"]: x["kind"] for x in result["rates_used"]}
    assert kinds == {2023: "TABLE", 2024: "TABLE", 2025: "ASSUMPTION", 2026: "ASSUMPTION"}
    usado = {x["year"]: x for x in result["rates_used"]}
    assert usado[2024]["deposit_pct"] == mr.DEPOSIT_RATES_BY_YEAR[2024]
    assert usado[2025]["letras_pct"] == mr.LETRAS_RATES_BY_YEAR[2025]
    mr._result_cache.clear()


def test_escala_irpf_dice_que_es_bizkaia_y_de_que_ejercicio(monkeypatch):
    monkeypatch.setattr(mr, "_ine_inflation", _ine_ok)
    monkeypatch.setattr(mr, "_bde_letras", lambda _s, _e: 2.5)
    mr._result_cache.clear()
    result = mr.get_macro_reference(dict(_PAYLOAD_COMPARATIVA))
    assert result["bizkaia_tax_scale"]["territory"] == "Bizkaia"
    assert result["bizkaia_tax_scale"]["fiscal_year"] == 2026
    mr._result_cache.clear()


def test_la_cache_no_depende_de_los_flujos_del_cliente(monkeypatch):
    llamadas = []

    def ine(inicio, fin):
        llamadas.append(inicio)
        return _ine_ok(inicio, fin)

    monkeypatch.setattr(mr, "_ine_inflation", ine)
    monkeypatch.setattr(mr, "_bde_letras", lambda _s, _e: 2.5)
    mr._result_cache.clear()

    a = mr.get_macro_reference(dict(_PAYLOAD_COMPARATIVA))
    b = mr.get_macro_reference(dict(_PAYLOAD_COMPARATIVA, final_value=70_000))
    c = mr.get_macro_reference(dict(_PAYLOAD_COMPARATIVA, flows=[{"date": "2023-01-01", "amount": 20_000}]))

    assert llamadas == ["2023-01-01"]  # una sola ida a las fuentes
    assert a["inflation_annual_pct"] == b["inflation_annual_pct"] == c["inflation_annual_pct"]
    # ...pero la comparativa sí cambia con los flujos
    assert a["comparison"]["cartera"]["valor_final_neto"] != b["comparison"]["cartera"]["valor_final_neto"]
    mr._result_cache.clear()


def test_bde_letras_toma_como_ultimo_dato_el_mas_reciente_aunque_venga_primero(monkeypatch):
    import io
    import json as _json

    cuerpo = _json.dumps([{
        "fechas": ["2026-11-11T09:15:00Z", "2026-11-10T09:15:00Z", "2025-11-11T09:15:00Z"],
        "valores": [1.99, 2.0, 2.01],
    }]).encode()

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

    monkeypatch.setattr(mr.urllib.request, "urlopen", lambda *_a, **_k: Resp(cuerpo))
    media, ultimo = mr._bde_letras("2025-11-01", "2026-11-15")
    assert media == pytest.approx((1.99 + 2.0 + 2.01) / 3)
    assert ultimo == "2026-11-11"


def test_los_textos_que_lee_el_asesor_llegan_con_sus_tildes(monkeypatch):
    monkeypatch.setattr(mr, "_ine_inflation", _ine_ok)
    monkeypatch.setattr(mr, "_bde_letras", lambda _s, _e: (2.5, "2026-11-13"))
    mr._result_cache.clear()

    result = mr.get_macro_reference(dict(_PAYLOAD_COMPARATIVA, end_date="2026-06-30"))

    textos = " ".join([
        result["source"],
        result["letras_period"]["note"],
        result["bizkaia_tax_scale"]["note"],
        result["rate_tables"]["deposit"]["origin"],
    ])
    for con_tilde in ("último dato", "últimos 12 meses", "código"):
        assert con_tilde in textos
    for sin_tilde in ("ultimo", "ultimos", "codigo", "respondio"):
        assert sin_tilde not in textos
    mr._result_cache.clear()
