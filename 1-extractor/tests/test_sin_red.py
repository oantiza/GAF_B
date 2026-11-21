# -*- coding: utf-8 -*-
"""En modo sin red no se sale a red tampoco por las librerías de terceros.

`Http(sin_red=True)` sirve de la caché o lanza `SinCache`, pero justetf_scraping,
yfinance y mstarpy hacen sus propias peticiones, sin pasar por `Http`: las
pasadas «sin red» (oráculo, regeneraciones de comprobación) no eran herméticas
y su resultado dependía de datos en vivo (auditoría 16-10, ALTA-17b).

Cada librería se sustituye por un módulo falso que apunta las llamadas; en
modo sin red no debe haber ninguna. Con red, sí: así se ve que la prueba llega
a la llamada.
"""
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.http import SinCache  # noqa: E402
from fetchers import eodhd, justetf, morningstar  # noqa: E402


class _Respuesta:
    def __init__(self, datos, status=200):
        self._datos, self.status, self.ok = datos, status, status == 200

    def json(self):
        return self._datos


class _HttpFalso:
    """Lo mínimo de `core.http.Http`: respuestas fijas por URL o `SinCache`."""

    def __init__(self, sin_red: bool, respuestas: dict | None = None):
        self.sin_red = sin_red
        self.respuestas = respuestas or {}

    def get(self, url, **_k):
        for trozo, datos in self.respuestas.items():
            if trozo in url:
                return _Respuesta(datos)
        raise SinCache(f"sin caché y sin red: {url}")


@pytest.fixture
def libreria(monkeypatch):
    """Instala un módulo falso que apunta cada llamada en `llamadas`."""
    llamadas: list = []

    def instala(nombre: str, **funciones):
        mod = types.ModuleType(nombre)
        for attr, devuelve in funciones.items():
            def fn(*a, _attr=attr, _devuelve=devuelve, **k):
                llamadas.append((nombre, _attr, a))
                return _devuelve(*a, **k) if callable(_devuelve) else _devuelve
            setattr(mod, attr, fn)
        monkeypatch.setitem(sys.modules, nombre, mod)
        return llamadas
    return instala


class _Ticker:
    info = {"marketCap": 1e9, "trailingPE": 20.0, "currency": "EUR", "longName": "X"}

    def history(self, **_k):
        return None


QUOTE = {"justetf.com/api/etfs": {"latestQuote": {"raw": 10.5}, "latestQuoteDate": "2026-10-15", "quoteTradingVenue": "XETRA"}}


@pytest.mark.parametrize("sin_red,esperadas", [(True, 0), (False, 1)])
def test_justetf_no_llama_a_justetf_scraping_sin_red(libreria, sin_red, esperadas):
    llamadas = libreria("justetf_scraping", get_etf_overview={"name": "ETF de prueba"})
    out = justetf.fetch("IE00B4L5Y983", _HttpFalso(sin_red, QUOTE), {"divisa": "EUR"}, tipo="etf")
    assert len(llamadas) == esperadas
    assert out["valoracion"]["vl"] == 10.5          # lo que sale de la caché se conserva
    assert ("nombre" in out.get("identificacion", {})) is (not sin_red)


@pytest.mark.parametrize("sin_red,esperadas", [(True, 0), (False, 1)])
def test_fundamentales_de_yahoo_sin_red_no_llaman_a_yfinance(libreria, sin_red, esperadas):
    llamadas = libreria("yfinance", Ticker=lambda *_a, **_k: _Ticker())
    out: dict = {}
    obtuvo = eodhd._fundamentals_yahoo(out, "SAN", "MC", _HttpFalso(sin_red))
    assert len(llamadas) == esperadas and obtuvo is (not sin_red)


@pytest.mark.parametrize("sin_red,esperadas", [(True, 0), (False, 1)])
def test_la_ficha_de_yahoo_sin_red_no_llama_a_yfinance(libreria, sin_red, esperadas):
    llamadas = libreria("yfinance", Ticker=lambda *_a, **_k: _Ticker())
    busqueda = {"finance.yahoo.com/v1/finance/search": {"quotes": [{"symbol": "SAN.MC", "quoteType": "EQUITY"}]}}
    out = eodhd._fetch_yahoo("ES0113900J37", _HttpFalso(sin_red, busqueda))
    assert len(llamadas) == esperadas
    assert (out == {}) is sin_red


def test_sin_bolsa_conocida_no_se_piden_fundamentales_a_yahoo_por_el_ticker_a_secas(libreria):
    """Auditoría del 16-11-2026 (EXT-9): «ABC» de una bolsa sin sufijo se pedía como el ABC americano."""
    llamadas = libreria("yfinance", Ticker=lambda *_a, **_k: _Ticker())
    assert eodhd._fundamentals_yahoo({}, "ABC", "NEO", _HttpFalso(False)) is False
    assert eodhd._fundamentals_yahoo({}, "ABC", "", _HttpFalso(False)) is False
    assert llamadas == []
    # Con bolsa conocida, también la americana, que no lleva sufijo, sí se piden.
    assert eodhd._fundamentals_yahoo({}, "ABC", "US", _HttpFalso(False)) is True
    assert len(llamadas) == 1


def test_si_yahoo_no_dice_la_divisa_la_ficha_no_la_inventa(libreria):
    class _SinDivisa(_Ticker):
        info = {"marketCap": 1e9, "longName": "X", "currentPrice": 12.5}

    busqueda = {"finance.yahoo.com/v1/finance/search": {"quotes": [{"symbol": "XYZ.MC", "quoteType": "EQUITY"}]}}
    libreria("yfinance", Ticker=lambda *_a, **_k: _SinDivisa())
    out = eodhd._fetch_yahoo("ES0113900J37", _HttpFalso(False, busqueda))
    assert "divisa_base" not in out["identificacion"] and "vl_divisa" not in out["valoracion"]
    assert out["valoracion"]["vl"] == 12.5
    libreria("yfinance", Ticker=lambda *_a, **_k: _Ticker())
    con = eodhd._fetch_yahoo("ES0113900J37", _HttpFalso(False, busqueda))
    assert con["identificacion"]["divisa_base"] == "EUR"


def test_una_accion_sin_fundamentales_en_cache_no_cae_a_yfinance(libreria, monkeypatch):
    # El camino real: EODHD resuelve el símbolo, los fundamentales no están en
    # caché (SinCache) y antes se caía a Yahoo, que salía a red.
    llamadas = libreria("yfinance", Ticker=lambda *_a, **_k: _Ticker())
    monkeypatch.setattr(eodhd, "_token", lambda base: "token")
    monkeypatch.setattr(eodhd, "_resuelve_simbolo", lambda *a, **k: {"Code": "SAN", "Exchange": "MC"})
    monkeypatch.setattr(eodhd, "_serie_eod_ajustada", lambda *a, **k: [])
    out = eodhd.fetch("ES0113900J37", _HttpFalso(True), {"divisa": "EUR"}, tipo="accion")
    assert llamadas == []
    assert out["identificacion"]["simbolo_eodhd"] == "SAN.MC"
    assert "fundamentales" not in out


@pytest.mark.parametrize("sin_red,esperadas", [(True, 0), (False, 1)])
def test_morningstar_sin_red_no_llama_a_mstarpy(libreria, sin_red, esperadas):
    def funds(*_a, **_k):
        raise LookupError("fondo de prueba no encontrado")  # basta con ver la llamada
    llamadas = libreria("mstarpy", Funds=funds)
    assert morningstar.fetch("LU0000000001", _HttpFalso(sin_red), {}) == {}
    assert len(llamadas) == esperadas
