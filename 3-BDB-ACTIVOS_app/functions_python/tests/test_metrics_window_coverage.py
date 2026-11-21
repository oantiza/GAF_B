# -*- coding: utf-8 -*-
"""El recorrido de una ventana tiene que cubrir la ventana que dice ser.

`MIN_ANNUALIZATION_DAYS` impedia anualizar tramos absurdos, pero no impedia
etiquetar mal: un fondo con 428 dias de serie pasaba el suelo de 330 y su cifra
se guardaba como `windows["3y"]`. Comparando el calculo propio con el trailing
del proveedor al mismo corte (30-06-2026) sobre el backup del 06-09, esos casos
eran 8 de las 9 unicas desviaciones mayores de 1 punto en 596 fondos de
acumulacion.
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import ingest_asset
from fund_ingest import MIN_ANNUALIZATION_DAYS, MIN_WINDOW_COVERAGE, window_span_ok
import weekly_sampling

TRES_ANIOS = 365 * 3


def test_un_recorrido_completo_pasa():
    assert window_span_ok(TRES_ANIOS - 5, TRES_ANIOS) is True


def test_un_recorrido_de_catorce_meses_no_pasa_por_ventana_de_tres_anios():
    assert window_span_ok(428, TRES_ANIOS) is False


def test_el_mismo_recorrido_si_pasa_como_ventana_anual():
    # 428 dias cubren de sobra un anio: el tramo no es malo, lo era la etiqueta.
    assert window_span_ok(428, 365) is True


def test_el_suelo_de_anualizacion_sigue_mandando_en_la_ventana_anual():
    # 0,85 * 365 = 310 dias, por debajo del suelo de 330. Manda el suelo, que es
    # el que evita elevar tres meses a un anio.
    assert MIN_WINDOW_COVERAGE * 365 < MIN_ANNUALIZATION_DAYS
    # Sexta pasada, I-7: una sola definicion, comun con la cartera real.
    assert MIN_ANNUALIZATION_DAYS is weekly_sampling.MIN_ANNUALIZATION_DAYS
    assert window_span_ok(320, 365) is False
    assert window_span_ok(340, 365) is True


def test_sin_ventana_nominal_solo_aplica_el_suelo():
    # Compatibilidad con las llamadas que no declaran ventana.
    assert window_span_ok(400) is True
    assert window_span_ok(100) is False


def _serie(dias, valor_inicial=100.0, paso=0.02):
    inicio = date(2026, 6, 30) - timedelta(days=dias)
    return [{"date": inicio + timedelta(days=i), "value": valor_inicial + paso * i}
            for i in range(0, dias + 1)]


def test_una_ventana_corta_publica_volatilidad_pero_no_rentabilidad():
    # La decision anterior se mantiene: la volatilidad aguanta con pocas
    # observaciones y no depende de los extremos del tramo.
    ventana = ingest_asset._window_metrics(_serie(428), 0.0, nominal_days=TRES_ANIOS)

    assert ventana is not None
    assert ventana["annualized_volatility"] >= 0
    assert "annualized_return" not in ventana
    assert "method" not in ventana
    assert "sharpe_ratio" not in ventana


def test_una_ventana_completa_si_anualiza_y_declara_metodo():
    ventana = ingest_asset._window_metrics(_serie(TRES_ANIOS), 0.0, nominal_days=TRES_ANIOS)

    assert ventana["method"] == "GEOMETRIC_CAGR"
    assert ventana["frequency"] == "WEEKLY"  # A1 (auditoria 29-09): medido en semanal
    assert ventana["annualized_return"] > 0


def test_el_documento_no_publica_rentabilidad_a_diez_anios_con_cinco_de_serie():
    doc = ingest_asset.build_metrics_latest("ES0000000000", "FUND", _serie(365 * 5),
                                            "2026-09-10T00:00:00Z")

    assert "annualized_return" in doc["windows"]["5y"]
    assert "annualized_return" not in doc["windows"].get("10y", {})
