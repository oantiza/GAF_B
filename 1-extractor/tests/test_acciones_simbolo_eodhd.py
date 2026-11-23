# -*- coding: utf-8 -*-
"""Acciones con símbolo EODHD conocido, retención de fundamentales y calidad
de las recién cotizadas (decisión 6.4 de la auditoría del 16-10, opción B).

Los casos llevan la forma de AENA (ES0105046009) y TSK (ES0105394003): EODHD
no los encuentra por ISIN (AENA figura con el ISIN de antes del desdoblamiento,
TSK cotiza desde el 13-05-2026) pero sí cotiza `AENA.MC` y `TSK.MC`. Sin red:
un HTTP de mentira que responde por sufijo de URL y un yfinance de mentira.
"""
import datetime as dt
import json
import logging
import re
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import adaptador_bdb  # noqa: E402
from core import update as update_pipeline  # noqa: E402
from core.adquisicion import registro, retencion  # noqa: E402
from core.adquisicion.adaptador import Contexto  # noqa: E402
from fetchers import eodhd  # noqa: E402

AENA, TSK = "ES0105046009", "ES0105394003"
DESCARGA = dt.datetime(2026, 10, 17, 6, 0, tzinfo=dt.timezone.utc).timestamp()


# ------------------------------------------------------------------ dobles
class _Resp:
    def __init__(self, status: int, payload):
        self.status = status
        self.text = json.dumps(payload)
        self.fetched_at = DESCARGA

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def json(self):
        return json.loads(self.text)


class _Http:
    """Responde por sufijo de URL (sin parámetros); lo demás, 404."""

    def __init__(self, rutas: dict):
        self.rutas = rutas
        self.pedidas: list[str] = []
        self.sin_red = False

    def get(self, url, params=None, **_kw):
        self.pedidas.append(url)
        for sufijo, (status, payload) in self.rutas.items():
            if url.endswith(sufijo):
                return _Resp(status, payload)
        return _Resp(404, [])


def _eod(desde: dt.date, hasta: dt.date, precio: float = 10.0) -> list[dict]:
    out, d, n = [], desde, 0
    while d <= hasta:
        if d.weekday() < 5:
            out.append({"date": d.isoformat(), "close": precio + n * 0.01,
                        "adjusted_close": precio + n * 0.01})
            n += 1
        d += dt.timedelta(days=1)
    return out


AENA_BUSQUEDA_CODIGO = [
    {"Code": "AENA", "Exchange": "MC", "Name": "Aena SA", "Type": "Common Stock",
     "Country": "Spain", "Currency": "EUR", "ISIN": "ES0105046017"},
    {"Code": "0R4Y", "Exchange": "LSE", "Name": "Aena SME S.A.", "Type": "Common Stock",
     "Country": "UK", "Currency": "EUR", "ISIN": None},
]
TSK_BUSQUEDA_ISIN = [
    {"Code": "TSK", "Exchange": "MC", "Name": "TSK Electrónica y Electricidad, S.A.",
     "Type": "Common Stock", "Country": "Spain", "Currency": "EUR", "ISIN": TSK},
]


def _rutas_aena(eod=None) -> dict:
    return {
        f"/search/{AENA}": (200, []),
        "/search/AENA": (200, AENA_BUSQUEDA_CODIGO),
        "/eod/AENA.MC": (200, _eod(dt.date(2015, 2, 11), dt.date(2026, 10, 16), 2.0) if eod is None else eod),
    }


INFO_YAHOO = {"marketCap": 41_000_000_000, "trailingPE": 18.9, "forwardPE": 16.4,
              "trailingEps": 1.45, "beta": 0.76, "fiftyTwoWeekHigh": 28.9,
              "fiftyTwoWeekLow": 22.0, "priceToBook": 4.1, "returnOnEquity": 0.244,
              "profitMargins": 0.335, "sector": "Industrials",
              "industry": "Airports & Air Services", "currency": "EUR"}


@pytest.fixture
def yahoo(monkeypatch):
    """yfinance de mentira: `yahoo["info"]` es lo que devuelve `.info`."""
    estado = {"info": dict(INFO_YAHOO), "simbolos": []}

    def ticker(sym):
        estado["simbolos"].append(sym)
        return types.SimpleNamespace(info=estado["info"])
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(Ticker=ticker))
    return estado


@pytest.fixture(autouse=True)
def _sin_estr_ni_token(monkeypatch):
    # Un dato cada día: desde el 21-11-2026 (P2-01) el €STR tiene que dar tipo a cada noche de la ventana, y
    # con uno al mes ya no hay Sharpe.
    estr = [{"date": dt.date(2014, 1, 1) + dt.timedelta(days=i), "value_pct": 2.0} for i in range(13 * 366)]
    monkeypatch.setattr(eodhd, "_ESTR_CACHE", estr)
    monkeypatch.setattr(eodhd, "_token", lambda _base: "demo")


def _correcciones(base: Path, isin: str, valores: dict) -> None:
    (base / "config").mkdir(parents=True, exist_ok=True)
    cuerpo = {isin: {ruta: {"valor": v, "motivo": "6.4 auditoria 16-10", "autor": "prueba",
                             "fecha": "2026-10-17T04:07:11Z"} for ruta, v in valores.items()}}
    (base / "config" / "correcciones.json").write_text(
        json.dumps({"version": 1, "correcciones": cuerpo}), encoding="utf-8")


# ---------------------------------------------------------- símbolo conocido
def test_la_correccion_gana_a_la_ficha_anterior(tmp_path):
    _correcciones(tmp_path, AENA, {"identificacion.simbolo_eodhd": "AENA.MC"})
    anterior = {"identificacion": {"simbolo_eodhd": "AENA.MCE"}}
    assert eodhd.simbolo_conocido(AENA, anterior, tmp_path) == "AENA.MC"


def test_sin_correccion_vale_el_de_la_ficha_anterior(tmp_path):
    assert eodhd.simbolo_conocido(AENA, {"identificacion": {"simbolo_eodhd": "AENA.MC"}}, tmp_path) == "AENA.MC"
    assert eodhd.simbolo_conocido(AENA, {"identificacion": {"simbolo_yahoo": "AENA.MC"}}, tmp_path) is None
    assert eodhd.simbolo_conocido(AENA, None, None) is None


def test_una_correccion_a_null_dice_que_no_tiene_codigo(tmp_path):
    _correcciones(tmp_path, AENA, {"identificacion.simbolo_eodhd": None})
    assert eodhd.simbolo_conocido(AENA, {"identificacion": {"simbolo_eodhd": "AENA.MC"}}, tmp_path) is None


@pytest.mark.parametrize("valor", ["AENA", ".MC", "AENA.", "", 7])
def test_un_simbolo_sin_codigo_o_sin_bolsa_no_vale(valor):
    assert eodhd.simbolo_conocido(AENA, {"identificacion": {"simbolo_eodhd": valor}}, None) is None


def test_con_simbolo_conocido_usa_eodhd_aunque_el_isin_no_se_encuentre(yahoo, monkeypatch):
    monkeypatch.setattr(eodhd, "_fetch_yahoo", lambda *_a: pytest.fail("no debe caer a Yahoo"))
    http = _Http(_rutas_aena())
    out = eodhd.fetch(AENA, http, {"divisa": "EUR"}, tipo="accion", simbolo_eodhd="AENA.MC")

    ident, hp = out["identificacion"], out["riesgo"]["historial_precios"]
    assert ident["simbolo_eodhd"] == "AENA.MC"
    assert ident["source_listing_id"] == "EODHD:AENA.MC"
    assert (ident["ticker"], ident["mercado"], ident["nombre"]) == ("AENA", "MC", "Aena SA")
    assert hp["source_history"] == "eodhd"
    assert hp["source_listing_id"] == "EODHD:AENA.MC"
    assert hp["first_date"] == "2015-02-11" and hp["history_quality_status"] == "COMPLETE"
    assert out["valoracion"]["vl_fecha"] == "2026-10-16"
    # Fundamentales: solo de Yahoo, con origen, fecha y cobertura.
    f = out["fundamentales"]
    assert (f["fuente"], f["source"], f["schema_version"]) == ("yahoo", "yahoo", "bdb.fundamentals-summary.v1")
    assert f["quality"]["coverage_status"] == "PARTIAL"
    assert f["quality"]["warnings"] == ["unofficial_source:yahoo"]
    assert dt.datetime.fromisoformat(f["fetched_at"]).tzinfo is not None
    assert ident["simbolo_yahoo"] == "AENA.MC" and yahoo["simbolos"] == ["AENA.MC"]
    # La serie se pide una sola vez.
    assert sum(u.endswith("/eod/AENA.MC") for u in http.pedidas) == 1


def test_la_identidad_sale_de_la_busqueda_por_isin_si_trae_ese_listado(yahoo):
    rutas = {f"/search/{TSK}": (200, TSK_BUSQUEDA_ISIN),
             "/search/TSK": (200, [{"Code": "TSK", "Exchange": "MC", "Name": "otro nombre"}]),
             "/eod/TSK.MC": (200, _eod(dt.date(2026, 5, 13), dt.date(2026, 10, 16), 5.0))}
    http = _Http(rutas)
    out = eodhd.fetch(TSK, http, {"divisa": "EUR"}, tipo="accion", simbolo_eodhd="TSK.MC")
    assert out["identificacion"]["nombre"] == "TSK Electrónica y Electricidad, S.A."
    assert not any(u.endswith("/search/TSK") for u in http.pedidas)
    assert out["riesgo"]["historial_precios"]["history_quality_status"] == "PARTIAL"


def test_si_el_simbolo_conocido_no_trae_serie_vuelve_a_lo_de_siempre_con_aviso(yahoo, monkeypatch, caplog):
    monkeypatch.setattr(eodhd, "_fetch_yahoo", lambda isin, _http, _base=None: {"identificacion": {"isin": isin, "x": 1}})
    http = _Http(_rutas_aena(eod=[]))
    with caplog.at_level(logging.WARNING, logger="fondosdb.eodhd"):
        out = eodhd.fetch(AENA, http, {"divisa": "EUR"}, tipo="accion", simbolo_eodhd="AENA.MC")
    assert out == {"identificacion": {"isin": AENA, "x": 1}}     # búsqueda por ISIN vacía -> Yahoo
    assert any("no devuelve serie EOD" in m for m in caplog.messages)
    assert any(u.endswith(f"/search/{AENA}") for u in http.pedidas)


def test_sin_simbolo_conocido_nada_cambia(yahoo, monkeypatch):
    monkeypatch.setattr(eodhd, "_fetch_yahoo", lambda isin, _http, _base=None: {"via": "yahoo"})
    http = _Http(_rutas_aena())
    assert eodhd.fetch(AENA, http, {"divisa": "EUR"}, tipo="accion") == {"via": "yahoo"}
    assert not any("/eod/" in u for u in http.pedidas)


def test_el_adaptador_pasa_el_simbolo_de_la_correccion_o_de_la_ficha_anterior(tmp_path, monkeypatch):
    vistos = []
    monkeypatch.setattr(eodhd, "fetch", lambda isin, *a, simbolo_eodhd=None, **k: vistos.append(simbolo_eodhd) or {})
    anterior = {"identificacion": {"simbolo_eodhd": "TSK.MC"}}
    for tipo in ("accion", "etf"):
        ctx = Contexto(http=None, settings={}, base=tmp_path, tipo=tipo, previo={"_anterior": anterior})
        registro._fetch_eodhd(TSK, ctx)
    _correcciones(tmp_path, TSK, {"identificacion.simbolo_eodhd": "TSK.MC"})
    registro._fetch_eodhd(TSK, Contexto(http=None, settings={}, base=tmp_path, tipo="accion"))
    assert vistos == ["TSK.MC", None, "TSK.MC"]


# ---------------------------------------------------- un ETF con símbolo corregido
# La forma de iShares Energy Storage el 05-11-2026: el buscador contesta vacío por ISIN, y por
# código da la cotización en dólares y sin ISIN.
ETF, STOR = "IE000DR59CI3", "STOR.AS"
STOR_BUSQUEDA_CODIGO = [
    {"Code": "STOR", "Exchange": "AS", "Name": "iShares Energy Storage & Hydrog", "Type": "ETF",
     "Country": "Netherlands", "Currency": "USD", "ISIN": None},
    {"Code": "STOR", "Exchange": "US", "Name": "otro valor", "Type": "Common Stock",
     "Country": "USA", "Currency": "USD", "ISIN": "US0000000000"},
]


def _rutas_stor() -> dict:
    return {
        f"/search/{ETF}": (200, []),
        "/search/STOR": (200, STOR_BUSQUEDA_CODIGO),
        "/eod/STOR.AS": (200, _eod(dt.date(2025, 2, 10), dt.date(2026, 11, 4), 5.0)),
    }


def test_el_adaptador_pasa_a_un_etf_la_correccion_y_no_la_ficha_anterior(tmp_path, monkeypatch):
    vistos = []
    monkeypatch.setattr(eodhd, "fetch", lambda isin, *a, simbolo_eodhd=None, **k: vistos.append(simbolo_eodhd) or {})
    anterior = {"identificacion": {"simbolo_eodhd": "OTRO.XETRA"}}
    _correcciones(tmp_path, ETF, {"identificacion.simbolo_eodhd": STOR})
    registro._fetch_eodhd(ETF, Contexto(http=None, settings={}, base=tmp_path, tipo="etf", previo={"_anterior": anterior}))
    assert vistos == [STOR]


def test_un_etf_con_correccion_usa_esa_cotizacion_aunque_el_isin_no_se_encuentre():
    http = _Http(_rutas_stor())
    out = eodhd.fetch(ETF, http, {"divisa": "EUR"}, tipo="etf", simbolo_eodhd=STOR)

    ident, hp = out["identificacion"], out["riesgo"]["historial_precios"]
    assert ident["simbolo_eodhd"] == STOR and ident["source_listing_id"] == f"EODHD:{STOR}"
    assert (ident["ticker"], ident["mercado"], ident["tipo"]) == ("STOR", "AS", "etf")
    assert hp["source_listing_id"] == f"EODHD:{STOR}" and hp["clase_de_serie"] == "PRECIO_DE_MERCADO"
    assert hp["first_date"] == "2025-02-10"
    # El precio va con la divisa de ESA cotización, que no es la de la clase ni la de otra fuente.
    assert out["valoracion"]["vl_divisa"] == "USD" and out["valoracion"]["vl_fecha"] == "2026-11-04"
    assert sum(u.endswith("/eod/STOR.AS") for u in http.pedidas) == 1


def test_un_etf_sin_correccion_sigue_saliendo_del_buscador_por_isin():
    http = _Http(_rutas_stor())
    assert eodhd.fetch(ETF, http, {"divisa": "EUR"}, tipo="etf") == {}
    assert not any("/eod/" in u or u.endswith("/search/STOR") for u in http.pedidas)


def _sin_fundamentals_de_eodhd(http: _Http) -> None:
    assert not [u for u in http.pedidas if "/fundamentals" in u], http.pedidas


def test_nunca_se_piden_los_fundamentales_de_eodhd(yahoo):
    """Óscar dio de baja los fundamentales de EODHD el 17-10: ni con el símbolo
    conocido ni resolviendo por ISIN se vuelve a pedir /api/fundamentals."""
    http = _Http(_rutas_aena())
    out = eodhd.fetch(AENA, http, {"divisa": "EUR"}, tipo="accion", simbolo_eodhd="AENA.MC")
    _sin_fundamentals_de_eodhd(http)
    assert out["fundamentales"]["source"] == "yahoo"
    http = _Http({f"/search/{TSK}": (200, TSK_BUSQUEDA_ISIN),
                  "/eod/TSK.MC": (200, _eod(dt.date(2026, 5, 13), dt.date(2026, 10, 16), 5.0))})
    out = eodhd.fetch(TSK, http, {"divisa": "EUR"}, tipo="accion")
    _sin_fundamentals_de_eodhd(http)
    assert out["identificacion"]["simbolo_eodhd"] == "TSK.MC" and out["fundamentales"]["source"] == "yahoo"


def test_ningun_modulo_del_extractor_pide_fundamentals_a_eodhd():
    raiz = Path(__file__).resolve().parents[1]
    fuentes = [p for carpeta in ("fetchers", "core", "tools") for p in (raiz / carpeta).rglob("*.py")]
    fuentes += [raiz / n for n in ("main.py", "app.py", "ops_server.py") if (raiz / n).exists()]
    # Una URL de petición, no una mención en un comentario.
    peticion = re.compile(r"(BASE_URL\}|eodhd\.com/api)/fundamentals")
    culpables = [p.relative_to(raiz).as_posix() for p in fuentes
                 if peticion.search(p.read_text(encoding="utf-8"))]
    assert culpables == []


# Deutsche Bank (DBK.DE) en Yahoo el 17-10, para comprobar unidades contra el
# resumen de EODHD de julio de su ficha (profit_margin 0.2265, insiders 8.527 %).
INFO_DBK = {"currency": "EUR", "financialCurrency": "EUR", "sector": "Financial Services",
            "industry": "Banks - Regional", "fullTimeEmployees": 89742, "marketCap": 55111069696,
            "enterpriseValue": -34864930816, "trailingPE": 8.914894, "forwardPE": 7.636728,
            "trailingPegRatio": 1.5782, "priceToSalesTrailing12Months": 1.8089962,
            "priceToBook": 0.69916564, "enterpriseToRevenue": -1.144, "enterpriseToEbitda": None,
            "profitMargins": 0.22715001, "operatingMargins": 0.33400002, "returnOnAssets": 0.00489,
            "returnOnEquity": 0.08891, "revenueGrowth": 0.087, "earningsQuarterlyGrowth": 0.097,
            "trailingEps": 3.29, "bookValue": 41.95, "revenuePerShare": 15.753, "dividendRate": 1.0,
            "trailingAnnualDividendRate": 1.0, "dividendYield": 3.43,
            "trailingAnnualDividendYield": 0.034340657, "payoutRatio": 0.3042,
            "exDividendDate": 1780012800, "sharesOutstanding": 1879000000, "floatShares": 1699649450,
            "heldPercentInsiders": 0.08712, "heldPercentInstitutions": 0.54734004,
            "targetMeanPrice": 34.20072, "beta": 1.036, "fiftyTwoWeekHigh": 35.845,
            "fiftyTwoWeekLow": 23.815, "fiftyDayAverage": 32.8079, "twoHundredDayAverage": 30.162725,
            "mostRecentQuarter": 1782777600, "currentPrice": 29.15,
            "longBusinessSummary": "Deutsche Bank Aktiengesellschaft, a stock corporation, provides..."}


def test_el_resumen_de_yahoo_tiene_la_forma_y_las_unidades_del_de_eodhd(yahoo):
    yahoo["info"] = INFO_DBK
    out: dict = {}
    assert eodhd._fundamentals_yahoo(out, "DBK", "XETRA") is True
    f = out["fundamentales"]
    assert yahoo["simbolos"] == ["DBK.DE"] and f["symbol"] == "DBK.DE"
    assert (f["source"], f["currency"], f["as_of_date"]) == ("yahoo", "EUR", "2026-06-30")
    assert f["profitability"]["profit_margin"] == pytest.approx(0.22715)       # fracción
    assert f["profitability"]["return_on_equity_ttm"] == pytest.approx(0.08891)
    assert f["capital"]["insiders_ratio"] == pytest.approx(8.712)               # porcentaje
    assert f["dividends"]["yield_ratio"] == pytest.approx(0.0343)               # fracción
    assert f["dividends"]["ex_dividend_date"] == "2026-05-29"
    assert f["valuation"]["pe_trailing"] == pytest.approx(8.914894)
    assert "ev_ebitda" not in f["valuation"]                                    # Yahoo no lo da
    assert f["quality"]["coverage_status"] == "PARTIAL"
    assert f["quality"]["coverage_ratio"] == pytest.approx(round(34 / 35, 4))
    # Los campos planos de siempre siguen ahí.
    assert (f["per"], f["roe_pct"], f["dividend_yield_pct"]) == (8.914894, 8.891, 3.43)
    ident = out["identificacion"]
    assert (ident["sector"], ident["industria"]) == ("Financial Services", "Banks - Regional")
    assert ident["descripcion"].startswith("Deutsche Bank")


def test_la_descripcion_que_ya_hay_no_se_pisa(yahoo):
    out = {"identificacion": {"descripcion": "la de antes", "sector": "Banca"}}
    eodhd._fundamentals_yahoo(out, "DBK", "XETRA")
    assert out["identificacion"]["descripcion"] == "la de antes"
    assert out["identificacion"]["sector"] == "Banca"


# -------------------------------------------------------- de punta a punta
FICHA_AENA_JULIO = {
    "identificacion": {"nombre": "Aena S.M.E., S.A.", "tipo": "accion", "isin": AENA, "ticker": "AENA",
                       "mercado": "MCE", "pais": "Spain", "divisa_base": "EUR", "simbolo_yahoo": "AENA.MC",
                       "sector": "Industrials", "industria": "Airports & Air Services",
                       "source_listing_id": "YAHOO:AENA.MC", "tipo_producto": "accion",
                       "clase_cubierta": False},
    "valoracion": {"vl": 26.16, "vl_divisa": "EUR", "vl_fecha": "2026-07-17"},
    "rentabilidad": {"fecha_dato": "2026-07-17", "trailing_pct": {
        "1a": {"fondo": 15.7}, "3a_anualizada": {"fondo": 28.16}, "5a_anualizada": {"fondo": 19.14}}},
    "riesgo": {"fecha_dato": "2026-07-17", "volatilidad_pct": {"3a": {"fondo": 19.95}},
               "sharpe": {"3a": {"fondo": 1.27}},
               "historial_precios": {"source_history": "yahoo", "source_listing_id": "YAHOO:AENA.MC",
                                     "first_date": "2015-02-11", "last_date": "2026-07-17",
                                     "observations_count": 2924, "history_quality_status": "COMPLETE"}},
    "fundamentales": {"market_cap": 39239999488.0, "per": 18.17, "roe_pct": 24.395, "source": "yahoo",
                      "fuente": "yahoo", "fetched_at": "2026-07-18T16:47:35+00:00",
                      "quality": {"coverage_status": "PARTIAL", "warnings": ["fallback_source:yahoo"]}},
    "meta": {"isin": AENA, "actualizado": "2026-07-18T16:47:35+00:00", "version_esquema": 2,
             "fuentes": {b: ["eodhd"] for b in ("identificacion", "valoracion", "rentabilidad",
                                                 "riesgo", "fundamentales")}, "errores": []},
    "calidad": {"score": 50, "bucket": "MEDIO", "esenciales": "5/10", "flags": []},
}


def _hojas(d, prefijo=""):
    for k, v in d.items():
        ruta = f"{prefijo}.{k}" if prefijo else k
        if isinstance(v, dict) and v:
            yield from _hojas(v, ruta)
        else:
            yield ruta


def _pipeline(base: Path, http) -> dict:
    return update_pipeline.ejecuta_pipeline(AENA, "accion", [], http, {"divisa": "EUR"}, False, base, True,
                                            print_cb=lambda _m: None)


def test_update_de_aena_con_la_correccion_pasa_a_eodhd_sin_perder_nada(tmp_path, yahoo, monkeypatch):
    # El reloj de la retencion, fijo a 114 dias de la ficha de julio (18-07): la retencion de fundamentales dura 120. Con el
    # reloj real, el ROE retenido caduco el 16-11-2026 y la prueba empezo a fallar sola (auditoria 16-11-2026, EXT-8).
    monkeypatch.setattr(retencion, "_hoy", lambda: dt.date(2026, 11, 9))
    _correcciones(tmp_path, AENA, {"identificacion.simbolo_eodhd": "AENA.MC", "identificacion.mercado": "MC"})
    (tmp_path / "data" / "funds").mkdir(parents=True)
    ruta = tmp_path / "data" / "funds" / f"{AENA}.json"
    ruta.write_text(json.dumps(FICHA_AENA_JULIO), encoding="utf-8")

    yahoo["info"] = {k: v for k, v in INFO_YAHOO.items() if k != "returnOnEquity"}
    res = _pipeline(tmp_path, _Http(_rutas_aena()))
    assert res["ok"], res
    nueva = json.loads(ruta.read_text(encoding="utf-8"))

    perdidas = {r for r in _hojas(FICHA_AENA_JULIO) if not r.startswith(("meta.", "calidad."))} \
        - set(_hojas(nueva))
    assert perdidas == set()
    ident, hp = nueva["identificacion"], nueva["riesgo"]["historial_precios"]
    assert (ident["simbolo_eodhd"], ident["source_listing_id"], ident["mercado"]) == \
        ("AENA.MC", "EODHD:AENA.MC", "MC")
    assert (hp["source_history"], hp["source_listing_id"]) == ("eodhd", "EODHD:AENA.MC")
    # Las correcciones ya coinciden con la fuente: quedan como redundantes.
    assert {r: c["redundante"] for r, c in nueva["meta"]["correcciones"].items()} == \
        {"identificacion.mercado": True, "identificacion.simbolo_eodhd": True}
    # El ROE que Yahoo ya no da se conserva, marcado.
    assert nueva["fundamentales"]["roe_pct"] == 24.395
    assert nueva["meta"]["procedencia"]["fundamentales.roe_pct"] == "retenido:eodhd@2026-07-18"
    assert nueva["fundamentales"]["source"] == "yahoo"
    assert nueva["fundamentales"]["fetched_at"] > "2026-07-18"
    # El canónico ya no es de Yahoo: ticker y bolsa componen el código EODHD real.
    stock = adaptador_bdb.convierte_accion(nueva)["ms"]["stock"]
    assert (stock["ticker"], stock["exchange"]) == ("AENA", "MC")
    assert stock["history_trace"]["source_history"] == "eodhd"
    assert stock["history_trace"]["source_listing_id"] == "EODHD:AENA.MC"
    assert stock["fundamentals"]["roe_pct"] == 24.395
