# -*- coding: utf-8 -*-
"""Un valor liquidativo de justETF no es un precio de mercado, y a igual fecha manda la plaza de la serie.

Defecto medido el 09-11-2026 en el canónico `782e2c72…`: 22 de los 32 ETF llevaban como
`valoracion.vl` lo que justETF devuelve con `quoteTradingVenue: "NAV"`, que es el valor liquidativo
del emisor convertido a la divisa pedida. SPY (`US78462F1030`) salía a 658,70 EUR cuando SPY.US
cerró a 735,29 USD el mismo día, y la base lo publicaba como `MARKET_PRICE`. Dos causas, dos
arreglos:

- `fetchers.justetf` solo escribe precio si la cotización es de una plaza (no `NAV`, no ausente);
- `core.schema._aplica_frescura`, en un ETF y a igual fecha, da la tupla a EODHD antes que a la
  prioridad de siempre (`core.adquisicion.registro.DESEMPATE_FRESCURA`).

Las respuestas de justETF son las de la caché de ese día, copiadas tal cual.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adquisicion import nucleo, procedencia, registro  # noqa: E402
from core.adquisicion.adaptador import Adaptador, Contexto, Endpoint  # noqa: E402
from core.schema import merge, set_path  # noqa: E402
from fetchers import justetf  # noqa: E402

# cache/http/44792a1456bbedae82369230b77b17f46053313a.json (SPY, fetched_at 1794204685)
RESPUESTA_NAV = ('{"latestQuote":{"raw":658.70,"localized":"658.70"},"latestQuoteDate":"2026-11-06",'
                 '"previousQuote":{"raw":653.14,"localized":"653.14"},"previousQuoteDate":"2026-11-05",'
                 '"dtdPrc":{"raw":0.85,"localized":"0.85"},"dtdAmt":{"raw":5.56,"localized":"5.56"},'
                 '"quoteTradingVenue":"NAV","quoteLowHigh":{"low":{"raw":550.28,"localized":"550.28"},'
                 '"high":{"raw":695.84,"localized":"695.84"}}}')
# cache/http/e8743f42aeae34b560600d4a914709218f5b13f7.json (IE00B3Q19T94, fetched_at 1794202329)
RESPUESTA_XETRA = ('{"latestQuote":{"raw":222.88,"localized":"222.88"},"latestQuoteDate":"2026-11-06",'
                   '"previousQuote":{"raw":224.89,"localized":"224.89"},"previousQuoteDate":"2026-11-05",'
                   '"dtdPrc":{"raw":-0.89,"localized":"-0.89"},"dtdAmt":{"raw":-2.01,"localized":"-2.01"},'
                   '"quoteTradingVenue":"XETRA","quoteLowHigh":{"low":{"raw":174.17,"localized":"174.17"},'
                   '"high":{"raw":248.33,"localized":"248.33"}}}')


class _Respuesta:
    ok = True
    status = 200

    def __init__(self, texto: str, fetched_at: float = 1794204685.0):
        self._texto = texto
        self.fetched_at = fetched_at

    def json(self):
        return json.loads(self._texto)


class _Http:
    """Lo mínimo de `core.http.Http`: la cotización y nada más; la ficha completa no se pide."""
    sin_red = True
    cache_dir = None

    def __init__(self, texto: str):
        self.texto = texto
        self.pedido: list[dict] = []

    def get(self, url, params=None, **_k):
        assert "/api/etfs/" in url and url.endswith("/quote"), url
        self.pedido.append(dict(params or {}))
        return _Respuesta(self.texto)


def _cotiza(texto: str, isin: str = "US78462F1030", divisa: str = "EUR") -> tuple[dict, dict]:
    http = _Http(texto)
    with procedencia.activa("justetf") as reg:
        out = justetf.fetch(isin, http, {"divisa": divisa}, tipo="etf")
    return out, reg.endpoints


# ------------------------------------------------------------------ el fetcher
def test_una_cotizacion_nav_no_se_escribe_como_precio():
    out, endpoints = _cotiza(RESPUESTA_NAV)
    assert "valoracion" not in out                       # ni vl, ni vl_fecha, ni vl_divisa
    assert out["identificacion"]["tipo"] == "etf"        # que es un ETF lo sigue diciendo
    assert endpoints["justetf:quote"]["plaza"] == "NAV"
    assert endpoints["justetf:quote"]["usado_como_precio"] is False


def test_una_cotizacion_de_plaza_se_escribe_con_su_plaza_anotada():
    out, endpoints = _cotiza(RESPUESTA_XETRA, isin="IE00B3Q19T94")
    assert out["valoracion"] == {"vl": 222.88, "vl_fecha": "2026-11-06", "vl_divisa": "EUR"}
    assert endpoints["justetf:quote"]["plaza"] == "XETRA"
    assert endpoints["justetf:quote"]["usado_como_precio"] is True
    assert endpoints["justetf:quote"]["fetched_at"].startswith("2026-11-")


def test_la_divisa_es_la_de_la_cifra_que_justetf_convierte_a_la_pedida():
    # La respuesta no declara divisa (medido en las 33 de la caché: ninguna clave de divisa), y
    # justETF da la cifra en la que se le pide. Si se pide USD, la cifra es en USD y así se dice.
    assert not any("currency" in k.lower() or "divisa" in k.lower() for k in json.loads(RESPUESTA_XETRA))
    http = _Http(RESPUESTA_XETRA)
    out = justetf.fetch("IE00B3Q19T94", http, {"divisa": "USD"}, tipo="etf")
    assert http.pedido == [{"locale": "en", "currency": "USD"}]
    assert out["valoracion"]["vl_divisa"] == "USD"


@pytest.mark.parametrize("plaza", [None, "", "nav", "INAV"])
def test_sin_plaza_conocida_no_hay_precio(plaza):
    q = json.loads(RESPUESTA_XETRA)
    if plaza is None:
        q.pop("quoteTradingVenue")
    else:
        q["quoteTradingVenue"] = plaza
    out, endpoints = _cotiza(json.dumps(q))
    assert "valoracion" not in out
    assert endpoints["justetf:quote"]["usado_como_precio"] is False


def test_la_etiqueta_de_las_hojas_no_cambia():
    with procedencia.activa("justetf") as reg:
        justetf.fetch("IE00B3Q19T94", _Http(RESPUESTA_XETRA), {"divisa": "EUR"}, tipo="etf")
    assert reg.resuelve("valoracion.vl") == "justetf"


# ------------------------------------------------------------------ la fusión
JUSTETF_SPY = {"valoracion": {"vl": 658.70, "vl_fecha": "2026-11-06", "vl_divisa": "EUR"},
               "identificacion": {"tipo": "etf"}}
EODHD_SPY = {"valoracion": {"vl": 735.29, "vl_fecha": "2026-11-06", "vl_divisa": "USD"},
             "identificacion": {"simbolo_eodhd": "SPY.US"}}
PRIORIDAD = ["cnmv", "morningstar_lt", "justetf", "eodhd"]   # la de settings.json, con eodhd detrás


def test_a_igual_fecha_en_un_etf_gana_la_plaza_de_la_serie():
    d = merge([("justetf", JUSTETF_SPY), ("eodhd", EODHD_SPY)], PRIORIDAD, "US78462F1030",
              desempate_frescura=registro.DESEMPATE_FRESCURA["etf"])
    assert d["valoracion"] == {"vl": 735.29, "vl_fecha": "2026-11-06", "vl_divisa": "USD"}
    assert {r: d["meta"]["procedencia"][r] for r in ("valoracion.vl", "valoracion.vl_fecha",
                                                       "valoracion.vl_divisa")} == dict.fromkeys(
        ("valoracion.vl", "valoracion.vl_fecha", "valoracion.vl_divisa"), "eodhd")


def test_sin_desempate_la_prioridad_de_siempre_sigue_igual():
    d = merge([("justetf", JUSTETF_SPY), ("eodhd", EODHD_SPY)], PRIORIDAD, "US78462F1030")
    assert d["valoracion"]["vl"] == 658.70


def test_el_desempate_no_vence_a_una_fecha_mas_reciente():
    fresco = {"valoracion": {"vl": 660.10, "vl_fecha": "2026-11-09", "vl_divisa": "EUR"}}
    d = merge([("justetf", fresco), ("eodhd", EODHD_SPY)], PRIORIDAD, "US78462F1030",
              desempate_frescura=("eodhd",))
    assert d["valoracion"] == fresco["valoracion"]


def test_morningstar_tambien_cede_a_igual_fecha():
    ms = {"valoracion": {"vl": 355.75, "vl_fecha": "2026-11-06", "vl_divisa": "EUR"}}
    eod = {"valoracion": {"vl": 357.0, "vl_fecha": "2026-11-06", "vl_divisa": "EUR"}}
    d = merge([("morningstar_lt", ms), ("eodhd", eod)], PRIORIDAD, "IE00B3VWMM18",
              desempate_frescura=("eodhd",))
    assert d["valoracion"]["vl"] == 357.0


def _adaptador(id_, valoracion, orden):
    def fetch(isin, ctx):
        out: dict = {}
        for k, v in valoracion.items():
            set_path(out, f"valoracion.{k}", v)
        return out
    return Adaptador(id=id_, descripcion="", oficial=False, capacidades={"valoracion.*": "precio"},
                     endpoints=(Endpoint("e", "precio"),), fetch=fetch,
                     aplica=lambda i, t: True, orden=orden)


@pytest.mark.parametrize("tipo,gana", [("etf", 735.29), ("fondo", 658.70)])
def test_el_nucleo_aplica_el_desempate_solo_al_tipo_que_lo_declara(tmp_path, tipo, gana):
    adaptadores = [_adaptador("eodhd", EODHD_SPY["valoracion"], 15),
                   _adaptador("justetf", JUSTETF_SPY["valoracion"], 30)]
    ctx = Contexto(http=None, settings={"prioridad_fuentes": ["cnmv", "morningstar_lt", "justetf"]},
                   base=tmp_path)
    d = nucleo.adquiere("US78462F1030", tipo, ctx, adaptadores).datos
    assert d["valoracion"]["vl"] == gana
