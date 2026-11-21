"""Decisión 53: los seis adaptadores de emisor van en la pasada general, y cada instrumento se lee solo en el suyo."""
import json
from pathlib import Path

import pytest

from core.adquisicion import registro
from core.adquisicion.adaptador import Contexto
from core.adquisicion.planificador import planifica

RAIZ = Path(__file__).resolve().parents[1]
SEIS = ("ishares", "amundi", "xtrackers", "vanguard", "spdr", "invesco")


class HttpQueNoDebeUsarse:
    def __getattr__(self, nombre):
        raise AssertionError(f"el adaptador salió a red por un ISIN que no es suyo ({nombre})")


def _settings() -> dict:
    return json.loads((RAIZ / "config" / "settings.json").read_text(encoding="utf-8"))


def _ctx(nombre: str | None) -> Contexto:
    previo = {"_anterior": {"identificacion": {"nombre": nombre}}} if nombre else {}
    return Contexto(http=HttpQueNoDebeUsarse(), settings={}, base=RAIZ, tipo="etf", previo=previo)


def test_entran_sin_pedirlos_con_fuentes():
    plan = planifica("IE00B4L5Y983", "etf", registro.ADAPTADORES, fuentes_activas=_settings()["prioridad_fuentes"])
    assert set(SEIS) <= set(plan.ids())


def test_van_detras_de_las_fuentes_que_ya_mandaban():
    prioridad = _settings()["prioridad_fuentes"]
    assert prioridad[:3] == ["cnmv", "morningstar_lt", "justetf"]
    assert tuple(prioridad[3:9]) == SEIS
    # Decisión 58: el lector del EMT, detrás de los seis; solo escribe `mercado_objetivo`.
    assert prioridad[9:] == ["emt"]


def test_solo_escriben_su_bloque():
    for a in registro.ADAPTADORES:
        if a.id in SEIS:
            assert set(a.capacidades) == {"emisor.*", "series.vl_emisor"}


def test_una_accion_no_pasa_por_ninguno():
    plan = planifica("ES0148396007", "accion", registro.ADAPTADORES, fuentes_activas=_settings()["prioridad_fuentes"])
    assert not set(SEIS) & set(plan.ids())


def test_un_fondo_solo_pasa_por_vanguard():
    plan = planifica("IE0032126645", "fondo", registro.ADAPTADORES, fuentes_activas=_settings()["prioridad_fuentes"])
    assert set(SEIS) & set(plan.ids()) == {"vanguard"}


@pytest.mark.parametrize("fetch,nombre", [
    (registro._fetch_ishares, "Amundi Core Stoxx Europe 600 UCITS ETF Acc"),
    (registro._fetch_amundi, "iShares Core MSCI World UCITS ETF USD (Acc)"),
    (registro._fetch_xtrackers, "Invesco S&P 500 UCITS ETF"),
    (registro._fetch_vanguard, "State Street SPDR Bloomberg Euro Corporate Bond UCITS ETF"),
    (registro._fetch_spdr, "Vanguard S&P 500 UCITS ETF"),
    (registro._fetch_invesco, "Xtrackers MSCI World Health Care UCITS ETF 1C"),
])
def test_no_pregunta_por_un_isin_que_no_es_suyo(fetch, nombre):
    assert fetch("IE00B4L5Y983", _ctx(nombre)) == {}


@pytest.mark.parametrize("nombre,marcas", [
    ("iShares VII PLC - iShares MSCI EM Asia ETF USD Acc", ("ishares",)),
    ("Lyxor Core MSCI World", ("amundi", "lyxor")),
    ("db x-trackers MSCI World", ("xtrackers", "x-trackers")),
    ("State Street� SPDR� S&P 500� ETF Trust", ("spdr", "state street")),
    ("Vanguard U.S. 500 Stock Index Fund EUR Acc", ("vanguard",)),
    ("PowerShares QQQ", ("invesco", "powershares")),
])
def test_reconoce_su_marca(nombre, marcas):
    assert registro._es_de_la_familia(_ctx(nombre), *marcas)


def test_sin_ficha_anterior_pregunta():
    assert registro._es_de_la_familia(_ctx(None), "amundi")


@pytest.mark.parametrize("isin,tipo,entra", [
    ("IE00B4L5Y983", "etf", True), ("IE0032126645", "fondo", True), ("ES0148396007", "accion", False)])
def test_el_emt_entra_en_la_pasada_de_fondos_y_etf(isin, tipo, entra):
    plan = planifica(isin, tipo, registro.ADAPTADORES, fuentes_activas=_settings()["prioridad_fuentes"])
    assert ("emt" in plan.ids()) is entra
