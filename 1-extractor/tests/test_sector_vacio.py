# -*- coding: utf-8 -*-
"""Un sector vacío es nulo.

Medido el 09-11-2026: en cuatro italianas (Snam, Unipol, IT0003242622 e IT0005366767) Yahoo entrega
sector e industria como `""`. `set_path` solo descarta `None`, así que la cadena vacía llegaba a la
ficha y la calidad contaba el sector como presente: 10/11 y nota 91, cuando son 9/11 y 82. Son las
únicas ocho hojas en blanco de las 1.322 fichas, y por eso el arreglo va en la lectura de Yahoo y
no en `set_path`, que usan 717 líneas del extractor.
"""
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import calidad  # noqa: E402
from fetchers import eodhd  # noqa: E402

# Lo que da Yahoo para Snam por la línea de Londres: PER sin capitalización, sector en blanco.
INFO_SNAM = {"trailingPE": 10.305857, "trailingEps": 0.461, "sector": "", "industry": "  ",
             "longBusinessSummary": "Snam S.p.A. builds and operates gas infrastructure."}


@pytest.fixture
def yahoo(monkeypatch):
    mod = types.ModuleType("yfinance")
    mod.Ticker = lambda _sym: types.SimpleNamespace(info=dict(INFO_SNAM))
    monkeypatch.setitem(sys.modules, "yfinance", mod)


def test_el_texto_vacio_o_de_espacios_es_nulo_y_el_resto_no_se_toca():
    assert eodhd._texto("") is None and eodhd._texto("   ") is None and eodhd._texto(None) is None
    assert eodhd._texto("Utilities") == "Utilities"
    assert eodhd._texto(" Utilities ") == " Utilities "


def test_un_sector_vacio_de_yahoo_no_llega_a_la_ficha_y_la_calidad_lo_cuenta(yahoo):
    out = {"identificacion": {"tipo": "accion", "nombre": "SNAM", "ticker": "0NQP", "mercado": "LSE"},
           "valoracion": {"vl": 4.75, "vl_fecha": "2026-11-06"},
           "riesgo": {"historial_precios": {"source_listing_id": "EODHD:SRG.MI",
                                            "first_date": "2015-01-02", "last_date": "2026-11-06"},
                      "volatilidad_pct": {"3a": {"fondo": 15.4}}},
           "rentabilidad": {"trailing_pct": {"1a": {"fondo": 18.2}, "3a_anualizada": {"fondo": 9.1}}}}
    assert eodhd._fundamentals_yahoo(out, "0NQP", "LSE") is True

    assert "sector" not in out["identificacion"] and "industria" not in out["identificacion"]
    assert out["identificacion"]["descripcion"] == INFO_SNAM["longBusinessSummary"]
    calidad.aplica(out)
    # Faltan el sector y la capitalización: 9 de 11, y no 10 con un sector que no existe.
    assert out["calidad"]["esenciales"] == "9/11"
    assert out["calidad"]["score"] == 82
