# -*- coding: utf-8 -*-
"""La busqueda de Yahoo por ISIN solo vale si el resultado ES ese ISIN.

Es de texto: con un ISIN que no existe puede devolver un valor parecido, y clasificar o fichar un valor con los
datos de otro es peor que no clasificarlo (pendiente «Datos fijos», 20-11-2026). El resultado no trae el ISIN
(medido sobre las respuestas en cache: 5 con un unico resultado y ninguno con campo `isin`), asi que sin el campo solo
vale el resultado unico.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fetchers import eodhd  # noqa: E402

ISIN = "ES0113900J37"


class _Respuesta:
    ok = True

    def __init__(self, quotes):
        self._quotes = quotes

    def json(self):
        return {"quotes": self._quotes}


class _Http:
    def __init__(self, quotes):
        self._quotes = quotes

    def get(self, url, **_k):
        return _Respuesta(self._quotes)


def _q(simbolo, tipo="EQUITY", **extra):
    return {"symbol": simbolo, "quoteType": tipo, **extra}


def test_un_unico_resultado_sin_isin_vale():
    # Es la forma de las 5 respuestas reales con resultado: busqueda exacta, un resultado, sin campo isin.
    assert eodhd._clasifica_yahoo(ISIN, _Http([_q("DESA.MC")])) == "accion"


def test_varios_resultados_sin_isin_es_una_coincidencia_aproximada_y_no_se_acepta_ninguno():
    assert eodhd._clasifica_yahoo(ISIN, _Http([_q("AAA.MC"), _q("BBB.MC", "ETF")])) is None


def test_si_el_resultado_trae_isin_tiene_que_coincidir():
    assert eodhd._clasifica_yahoo(ISIN, _Http([_q("OTRO.MC", isin="ES0000000000")])) is None
    assert eodhd._clasifica_yahoo(ISIN, _Http([_q("X.MC", isin="ES0000000000"), _q("SAN.MC", "ETF", isin=ISIN.lower())])) == "etf"


def test_sin_resultados_no_hay_clasificacion():
    assert eodhd._clasifica_yahoo(ISIN, _Http([])) is None


def test_el_filtro_directo():
    assert eodhd._quote_del_isin([], ISIN) is None
    assert eodhd._quote_del_isin([_q("A.MC")], ISIN)["symbol"] == "A.MC"
    assert eodhd._quote_del_isin([_q("A.MC"), _q("B.MC")], ISIN) is None
    assert eodhd._quote_del_isin([_q("A.MC", isin="XX"), _q("B.MC", isin=ISIN)], ISIN)["symbol"] == "B.MC"
