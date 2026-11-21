# -*- coding: utf-8 -*-
"""Rentabilidad por dividendo en porcentaje venga como venga (MEDIA-10) y
Sharpe del extractor etiquetado con la divisa de su serie (MEDIA-10b).

El canónico lleva `fundamentales.dividend_yield_pct` en porcentaje (2.38 =
2,38 %): EODHD lo da como fracción y se pasa con `_pct`, y la app lo divide
entre 100. Yahoo ha servido `dividendYield` como fracción (0.0238) y, desde
yfinance 0.2.54, como porcentaje (2.38). Regla: se toma como porcentaje y
solo se convierte si TODAS las referencias de unidad fija dicen que es fracción.
"""
import datetime as dt
import math
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fetchers import eodhd  # noqa: E402

# Aena (ES0105046009), info de Yahoo recortado: 4.17 % con precio 230,8 EUR.
AENA = {"currency": "EUR", "financialCurrency": "EUR", "currentPrice": 230.8,
        "dividendRate": 9.62, "trailingAnnualDividendYield": 0.0412,
        "fiveYearAvgDividendYield": 2.9, "marketCap": 3.4e10, "trailingPE": 17.0}


def _y(**info):
    return eodhd._yield_dividendo_yahoo_pct(info)


@pytest.mark.parametrize("entrada", [0.0417, 4.17])
def test_yahoo_en_fraccion_o_en_porcentaje_da_el_mismo_porcentaje(entrada):
    assert _y(**{**AENA, "dividendYield": entrada}) == 4.17


@pytest.mark.parametrize("referencia", [
    {"dividendRate": 9.62, "currentPrice": 230.8, "currency": "EUR", "financialCurrency": "EUR"},
    {"trailingAnnualDividendYield": 0.0412},
    {"fiveYearAvgDividendYield": 2.9},
])
@pytest.mark.parametrize("entrada", [0.0417, 4.17])
def test_basta_una_referencia_de_unidad_fija(referencia, entrada):
    assert _y(dividendYield=entrada, **referencia) == 4.17


def test_sin_referencias_se_toma_como_porcentaje_tambien_por_debajo_del_1():
    # Lo que da la versión fijada de yfinance: un 0,6 % real no se pierde.
    assert _y(dividendYield=0.6) == 0.6
    assert _y(dividendYield=4.17) == 4.17
    assert _y(dividendYield=0) == 0.0
    assert _y() is None


def test_con_referencias_discordantes_no_se_convierte():
    # 0,6 %: dividendRate/precio dice porcentaje (0,6) y la media de 5 años, ×100
    # desviada, dice fracción (60). Antes la mediana de dos (una media) publicaba 60.
    info = {"dividendYield": 0.6, "dividendRate": 0.6, "currentPrice": 100.0,
            "currency": "EUR", "financialCurrency": "EUR", "fiveYearAvgDividendYield": 60.0}
    assert _y(**info) == 0.6
    # Y con tres referencias, una sola discordante basta para no convertir.
    assert _y(**info, trailingAnnualDividendYield=0.6) == 0.6


def test_dos_referencias_de_acuerdo_si_convierten():
    info = {"dividendYield": 0.006, "dividendRate": 0.6, "currentPrice": 100.0,
            "currency": "EUR", "financialCurrency": "EUR", "trailingAnnualDividendYield": 0.0061}
    assert _y(**info) == 0.6


@pytest.mark.parametrize("divisa_dividendo,tasa", [("SEK", 9.0), ("NOK", 9.4), ("JPY", 130.0),
                                                   ("CZK", 21.0), ("ZAR", 16.0)])
def test_dividendrate_en_otra_divisa_que_el_precio_no_cuenta(divisa_dividendo, tasa):
    # Cotiza en EUR (precio 26) y reparte en otra divisa: el cociente sale 10 veces
    # o más desviado. Antes publicaba ~300 en vez de 3.
    info = {"dividendYield": 3.0, "currency": "EUR", "financialCurrency": divisa_dividendo,
            "currentPrice": 26.0, "dividendRate": tasa,
            "trailingAnnualDividendYield": tasa / 26.0}   # Yahoo hace el mismo cociente
    assert _y(**info) == 3.0
    assert _y(**info, fiveYearAvgDividendYield=2.8) == 3.0


def test_dividendrate_sin_divisas_conocidas_no_cuenta():
    info = {"dividendYield": 3.0, "currentPrice": 26.0, "dividendRate": 78.0}
    assert _y(**info) == 3.0                           # 78/26 = 300 % no tuerce nada
    assert _y(**{**info, "currency": "GBp", "financialCurrency": "GBP"}) == 3.0


@pytest.mark.parametrize("malo", [float("nan"), float("inf"), "nan", "inf", -1.0])
def test_nan_infinito_y_negativos_no_se_publican(malo):
    assert _y(**{**AENA, "dividendYield": malo}) is None


def test_referencias_nan_o_infinitas_se_ignoran():
    info = {"dividendYield": 0.0417, "trailingAnnualDividendYield": float("nan"),
            "fiveYearAvgDividendYield": float("inf"), "dividendRate": 9.62,
            "currentPrice": 230.8, "currency": "EUR", "financialCurrency": "EUR"}
    assert _y(**info) == 4.17                          # solo cuenta dividendRate/precio


@pytest.mark.parametrize("entrada", [0.0002, 0.02])
def test_un_rendimiento_bajo_no_se_confunde_con_uno_100_veces_mayor(entrada):
    info = {"dividendYield": entrada, "dividendRate": 0.04, "currentPrice": 180.0,
            "currency": "USD", "financialCurrency": "USD", "trailingAnnualDividendYield": 0.00022}
    assert _y(**info) == 0.02


def test_eodhd_y_las_dos_formas_de_yahoo_cuadran_en_el_canonico():
    assert eodhd._pct(0.0417) == _y(**{**AENA, "dividendYield": 0.0417}) \
        == _y(**{**AENA, "dividendYield": 4.17}) == 4.17


@pytest.mark.parametrize("entrada", [0.0417, 4.17])
def test_el_fallback_de_fundamentals_de_yahoo_escribe_porcentaje(monkeypatch, entrada):
    info = {**AENA, "dividendYield": entrada, "returnOnEquity": 0.25}
    falso = types.SimpleNamespace(Ticker=lambda _sym: types.SimpleNamespace(info=info))
    monkeypatch.setitem(sys.modules, "yfinance", falso)
    out: dict = {}
    assert eodhd._fundamentals_yahoo(out, "AENA", "MC") is True
    assert out["fundamentales"]["dividend_yield_pct"] == 4.17
    assert out["fundamentales"]["roe_pct"] == 25.0          # el resto de fracciones, igual que antes


# ------------------------------------------------------------------- Sharpe
class _RespuestaEstr:
    ok = True
    status = 200
    text = "TIME_PERIOD,OBS_VALUE\n2020-01-01,2.0\n2026-01-01,2.0\n"


class _RespuestaCaida:
    ok = False
    status = 503
    text = ""


class _Http:
    def __init__(self, respuesta):
        self.respuesta = respuesta

    def get(self, *_a, **_k):
        return self.respuesta


def _serie(dias=2200):
    inicio = dt.date(2020, 1, 1)
    return [{"date": inicio + dt.timedelta(days=i), "price": 100 + i * 0.05, "raw": {}}
            for i in range(dias)]


def _metricas(monkeypatch, respuesta, **kw) -> dict:
    monkeypatch.setattr(eodhd, "_ESTR_CACHE", None)
    out: dict = {}
    eodhd._aplica_metricas_historicas(out, _serie(), _Http(respuesta), "eodhd", "EODHD:AAPL.US", **kw)
    return out


def test_una_accion_en_dolares_se_calcula_en_euros(monkeypatch):
    from datetime import date, timedelta
    from fetchers import cambios_bce
    constante = [(date(2015, 1, 1) + timedelta(days=i), 2.0) for i in range(5000)]
    monkeypatch.setattr(cambios_bce, "cambios", lambda moneda, http: constante)
    en_euros = _metricas(monkeypatch, _RespuestaEstr(), divisa="EUR")
    en_dolares = _metricas(monkeypatch, _RespuestaEstr(), divisa="USD")

    traza = en_dolares["riesgo"]["historial_precios"]
    assert traza["divisa"] == "USD"
    assert traza["divisa_metricas"] == "EUR"
    assert traza["divisa_origen"] == "USD"
    assert traza["fx_source"] == "ECB_REFERENCE"
    assert traza["rf_referencia"] == "ESTR_EUR"
    # Un cambio constante no altera ni rentabilidad ni riesgo: la cifra debe coincidir.
    assert en_dolares["riesgo"]["sharpe"] == en_euros["riesgo"]["sharpe"]
    assert en_dolares["riesgo"]["sharpe"]["3a"]["fondo"] is not None


def test_la_accion_dice_con_que_version_del_metodo_se_calculo(monkeypatch):
    """A-158: hasta la versión 2 la ficha de una acción no llevaba sello y la plataforma ponía la versión de memoria.
    Sin él, una cifra de la versión 3 se etiquetaría como de la 2. Desde el 17-11-2026 la versión es la 4 (MET-6 y MET-7)."""
    traza = _metricas(monkeypatch, _RespuestaEstr(), divisa="EUR")["riesgo"]["historial_precios"]
    assert traza["metodo"] == ("core.metricas v4: rentabilidades diarias, en euros, volatilidad anualizada con las "
                               "observaciones de la ventana")
    # Sin divisa no se calcula nada, y entonces tampoco hay versión que decir.
    assert "metodo" not in _metricas(monkeypatch, _RespuestaEstr(), divisa=None)["riesgo"]["historial_precios"]


def test_divisa_desconocida_no_se_calcula(monkeypatch):
    for divisa in (None, ""):
        riesgo = _metricas(monkeypatch, _RespuestaEstr(), divisa=divisa)["riesgo"]
        traza = riesgo["historial_precios"]
        assert "divisa" not in traza
        assert traza["aviso_metricas"] == "sin_metricas_sin_cambio"
        assert "volatilidad_pct" not in riesgo


def test_sin_estr_no_hay_rf_referencia_ni_sharpe(monkeypatch):
    out = _metricas(monkeypatch, _RespuestaCaida(), divisa="EUR")
    traza = out["riesgo"]["historial_precios"]
    assert traza["divisa"] == "EUR"
    assert "rf_referencia" not in traza
    assert "sharpe" not in out["riesgo"]
    assert not math.isnan(out["riesgo"]["volatilidad_pct"]["3a"]["fondo"])
