"""Auditoría de divisas (06-09-2026).

Dos fallos, dos reglas que estas pruebas fijan:

1. La divisa de conversión la manda el LISTADO del proveedor, no el metadato. Antes se
   heredaba del documento anterior o de la ficha, y así cinco ETF de Xetra que ya cotizan
   en euros se dividían otra vez por EUR/USD, y un ETF de Ámsterdam que cotiza en dólares
   se guardaba sin convertir.
2. El motor no excluye por la divisa de la FICHA —la de la clase, «USD Acc»— sino por la
   de la serie. Lo que sí queda fuera es lo que está en cuarentena por un error de divisa
   conocido y todavía sin reparar.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import price_refresh  # noqa: E402
from optimization import repository  # noqa: E402


def _sin_cache():
    price_refresh.clear_listing_currency_cache()


def test_divisa_del_listado_manda_sobre_el_metadato(monkeypatch):
    """NUKL.XETRA: la ficha dice USD, el listado dice EUR. Manda el listado."""
    _sin_cache()
    monkeypatch.setattr(price_refresh, "_eodhd_get", lambda path, **kw: "EUR")
    serie = {"source_listing_id": "EODHD:NUKL.XETRA", "source_currency": "USD"}
    symbol, currency = price_refresh._symbol_and_currency(serie, {})
    assert symbol == "NUKL.XETRA"
    assert currency == "EUR", "una cotización en euros no puede volver a convertirse"


def test_divisa_del_listado_obliga_a_convertir_aunque_el_metadato_diga_eur(monkeypatch):
    """STOR.AS: la serie decía EUR, el listado dice USD. Hay que convertir."""
    _sin_cache()
    monkeypatch.setattr(price_refresh, "_eodhd_get", lambda path, **kw: "USD")
    serie = {"source_listing_id": "EODHD:STOR.AS", "source_currency": "EUR"}
    symbol, currency = price_refresh._symbol_and_currency(serie, {})
    assert symbol == "STOR.AS"
    assert currency == "USD"


def test_sin_divisa_del_proveedor_no_se_asume_eur(monkeypatch):
    """Antes se caía a «EUR» y nacían las series mal convertidas. Ahora no se escribe."""
    _sin_cache()
    monkeypatch.setattr(price_refresh, "_eodhd_get", lambda path, **kw: None)
    serie = {"source_listing_id": "EODHD:XXXX.YY", "source_currency": "USD"}
    symbol, currency = price_refresh._symbol_and_currency(serie, {})
    assert symbol == "XXXX.YY"
    assert currency is None, "sin divisa del listado, el activo se salta con aviso"


def test_la_divisa_del_listado_se_cachea_por_simbolo(monkeypatch):
    _sin_cache()
    llamadas = []

    def _fake(path, **kw):
        llamadas.append(path)
        return "USD"

    monkeypatch.setattr(price_refresh, "_eodhd_get", _fake)
    assert price_refresh.listing_currency("AAPL.US") == "USD"
    assert price_refresh.listing_currency("AAPL.US") == "USD"
    assert len(llamadas) == 1


def test_conversion_conserva_la_escala_de_los_peniques(monkeypatch):
    """GBX son céntimos de libra: la escala se aplica antes del cambio."""
    _sin_cache()
    fx_cache = {"GBP": (["2026-01-02"], [0.85])}
    filas = [{"date": "2026-01-02", "close": 500.0, "adjusted_close": 500.0}]
    puntos, meta = price_refresh._convert_eur(filas, "GBX", fx_cache, "2026-01-01", "2026-01-03")
    assert meta["source_currency"] == "GBX"
    assert meta["minor_scale"] == 0.01
    # 500 peniques = 5 GBP; 5 / 0,85 = 5,88 EUR
    assert abs(puntos[0]["value"] - (5.0 / 0.85)) < 1e-6


def test_una_cotizacion_en_euros_no_se_convierte():
    puntos, meta = price_refresh._convert_eur(
        [{"date": "2026-01-02", "close": 47.05, "adjusted_close": 47.05}],
        "EUR", {}, "2026-01-01", "2026-01-03",
    )
    assert meta == {"source_currency": "EUR"}
    assert puntos[0]["value"] == 47.05


def test_ficha_en_dolares_con_serie_en_euros_ya_no_se_excluye():
    """El fallo de los 135: la ficha declara la divisa de la clase, no la de los precios."""
    root = {"asset_type": "ETF", "identity": {"currency": "USD"}, "quality": {"status": "ACCEPTED"}}
    assert repository._root_exclusion_reason(root, "EUR", "US0378331005") is None


def test_un_activo_en_cuarentena_por_divisa_sigue_fuera():
    """Su serie está etiquetada EUR y pasaría la comprobación del documento."""
    root = {"asset_type": "ETF", "identity": {"currency": "USD"}, "quality": {"status": "ACCEPTED"}}
    for asset_id in repository.FX_QUARANTINE_ASSET_IDS:
        assert repository._root_exclusion_reason(root, "EUR", asset_id) == "FX_QUARANTINE"


def test_los_seis_activos_conocidos_estan_en_cuarentena():
    esperados = {
        "IE000M7V94E1", "IE00B5BMR087", "IE00B3YCGJ38",
        "IE0002PG6CA6", "IE000X59ZHE2", "IE000DR59CI3",
    }
    assert esperados <= set(repository.FX_QUARANTINE_ASSET_IDS)


def test_la_calidad_y_el_tipo_siguen_excluyendo():
    bloqueado = {"asset_type": "ETF", "quality": {"status": "BLOCKED"}}
    assert repository._root_exclusion_reason(bloqueado, "EUR", "X") == "QUALITY_BLOCKED"
    no_invertible = {"asset_type": "INDEX", "quality": {"status": "ACCEPTED"}}
    assert repository._root_exclusion_reason(no_invertible, "EUR", "X") == "NON_INVESTABLE"


def test_una_serie_en_otra_divisa_sigue_excluida():
    """La comprobación buena, la del documento, no se toca."""
    class _Reader:
        def get_price_series(self, asset_id):
            return [{
                "schema_version": "asset-price-series.v1.2",
                "currency": "USD",
                "points": [{"date": "2026-01-02", "value": 10.0}],
            }]

    try:
        repository._load_asset_returns(_Reader(), "X", {}, "3Y")
    except repository.PriceSeriesProblem as problema:
        assert problema.reason == "FX_SERIES_MISSING"
    else:  # pragma: no cover
        raise AssertionError("una serie en dólares tiene que seguir excluyéndose")


def test_na_no_es_una_divisa(monkeypatch):
    """El proveedor devuelve «NA» en algunos fondos. Aceptarlo intentaría convertir
    con un par «EURNA.FOREX» que no existe y dejaría el activo sin actualizar."""
    for respuesta in ("NA", "N/A", "", "NONE", "unknown", "EURO", "US"):
        _sin_cache()
        monkeypatch.setattr(price_refresh, "_eodhd_get", lambda path, _r=respuesta, **kw: _r)
        assert price_refresh.listing_currency("X.Y") is None, respuesta
    _sin_cache()
    monkeypatch.setattr(price_refresh, "_eodhd_get", lambda path, **kw: "gbx")
    assert price_refresh.listing_currency("HSBA.LSE") == "GBX"


def test_hsbc_en_cuarentena_por_la_escala_de_los_peniques():
    """HSBA.LSE cotiza en peniques y se guardó como libras: los precios valen x100."""
    assert "GB0005405286" in repository.FX_QUARANTINE_ASSET_IDS


def test_la_divisa_de_un_fondo_se_resuelve_por_busqueda_cuando_fundamentales_dice_na(monkeypatch):
    """Segunda revisión de Astra: rechazar «NA» dejaba los fondos sin actualizar.
    La búsqueda exacta del proveedor sí publica su divisa."""
    _sin_cache()

    def _proveedor(path, **kw):
        if path.startswith("fundamentals/"):
            return "NA"
        if path.startswith("search/"):
            return [
                {"Code": "OTRO", "Exchange": "EUFUND", "Currency": "GBP"},
                {"Code": "IE0031333341", "Exchange": "EUFUND", "Currency": "USD"},
            ]
        return None

    monkeypatch.setattr(price_refresh, "_eodhd_get", _proveedor)
    assert price_refresh.listing_currency("IE0031333341.EUFUND") == "USD"


def test_si_ni_fundamentales_ni_busqueda_dan_divisa_no_se_escribe(monkeypatch):
    _sin_cache()
    monkeypatch.setattr(price_refresh, "_eodhd_get", lambda path, **kw: "NA" if path.startswith("fundamentals/") else [])
    assert price_refresh.listing_currency("XXXX.YY") is None


def test_la_busqueda_no_cuela_el_listado_de_otra_bolsa(monkeypatch):
    """Mismo código en otra bolsa puede cotizar en otra divisa: no vale."""
    _sin_cache()

    def _proveedor(path, **kw):
        if path.startswith("fundamentals/"):
            return "NA"
        return [{"Code": "AAA", "Exchange": "US", "Currency": "USD"}]

    monkeypatch.setattr(price_refresh, "_eodhd_get", _proveedor)
    assert price_refresh.listing_currency("AAA.XETRA") is None


# ---------------------------------------------------------------------------
# ALTA-03 (14-10-2026): un fallo transitorio del proveedor no es «sin divisa».
# ---------------------------------------------------------------------------

def test_un_fallo_del_proveedor_no_es_una_respuesta_definitiva():
    import fx_currency

    def _caido(path, params):
        raise price_refresh.TransientProviderError("EODHD HTTP 503")

    assert fx_currency.resolve_listing_currency("AAPL.US", _caido) == (None, fx_currency.PROVEEDOR_NO_DISPONIBLE)

    llamadas = []

    def _fundamentales_caidos(path, params):
        llamadas.append(path)
        if path.startswith("fundamentals/"):
            raise price_refresh.TransientProviderError("timeout")
        return [{"Code": "AAPL", "Exchange": "US", "Currency": "USD"}]

    # Si la busqueda si responde con divisa, el fallo de fundamentales no importa.
    assert fx_currency.resolve_listing_currency("AAPL.US", _fundamentales_caidos) == ("USD", None)


def test_el_fallo_transitorio_no_se_cachea_como_sin_divisa(monkeypatch):
    _sin_cache()
    estado = {"caido": True, "llamadas": 0}

    def _proveedor(path, **kw):
        estado["llamadas"] += 1
        if estado["caido"]:
            raise price_refresh.TransientProviderError("EODHD HTTP 503 for %s" % path)
        return "USD"

    reloj = {"t": 1000.0}
    monkeypatch.setattr(price_refresh, "_eodhd_get", _proveedor)
    monkeypatch.setattr(price_refresh.time, "monotonic", lambda: reloj["t"])

    assert price_refresh.listing_currency("AAPL.US") is None
    assert "AAPL.US" not in price_refresh._LISTING_CURRENCY_CACHE, "no se guarda como definitivo"
    llamadas_tras_fallo = estado["llamadas"]

    # Dentro del TTL corto no se vuelve a martillear al proveedor caido.
    reloj["t"] += price_refresh.LISTING_CURRENCY_FAILURE_TTL_S - 1
    assert price_refresh.listing_currency("AAPL.US") is None
    assert estado["llamadas"] == llamadas_tras_fallo

    # Pasado el TTL se vuelve a preguntar, y la respuesta buena si se cachea.
    estado["caido"] = False
    reloj["t"] += 2
    assert price_refresh.listing_currency("AAPL.US") == "USD"
    assert price_refresh._LISTING_CURRENCY_CACHE["AAPL.US"] == "USD"
    assert "AAPL.US" not in price_refresh._LISTING_CURRENCY_FAILURES
    _sin_cache()


def test_la_respuesta_definitiva_sin_divisa_si_se_cachea(monkeypatch):
    _sin_cache()
    llamadas = []

    def _proveedor(path, **kw):
        llamadas.append(path)
        return "NA" if path.startswith("fundamentals/") else []

    monkeypatch.setattr(price_refresh, "_eodhd_get", _proveedor)
    assert price_refresh.listing_currency("XXXX.YY") is None
    consultas = len(llamadas)
    assert price_refresh.listing_currency("XXXX.YY") is None
    assert price_refresh._LISTING_CURRENCY_CACHE["XXXX.YY"] is None
    assert len(llamadas) == consultas, "la respuesta definitiva no se vuelve a pedir"
    _sin_cache()


# ---------------------------------------------------------------------------
# Revision 14-10-2026: un 4xx (403/404) es respuesta definitiva; red, 5xx y 429 no.
# ---------------------------------------------------------------------------

def _http_error(code):
    import urllib.error
    return urllib.error.HTTPError("https://eodhd.test/x", code, "error", None, None)


def _envuelto(code):
    """Como `_eodhd_get`: un 4xx sale como RuntimeError con el HTTPError de causa."""
    try:
        raise RuntimeError("EODHD HTTP %s" % code) from _http_error(code)
    except RuntimeError as exc:
        return exc


def test_clasifica_rechazo_definitivo_y_fallo_transitorio():
    import fx_currency

    assert fx_currency.es_rechazo_definitivo(_envuelto(404)) is True
    assert fx_currency.es_rechazo_definitivo(_envuelto(403)) is True
    assert fx_currency.es_rechazo_definitivo(_envuelto(429)) is False, "cuota: transitorio"
    assert fx_currency.es_rechazo_definitivo(_envuelto(503)) is False
    transitorio = price_refresh.TransientProviderError("EODHD HTTP 503")
    transitorio.__cause__ = _http_error(503)
    assert fx_currency.es_rechazo_definitivo(transitorio) is False
    assert fx_currency.es_rechazo_definitivo(price_refresh.TransientProviderError("red")) is False
    assert fx_currency.es_rechazo_definitivo(ValueError("json roto")) is False


def test_un_4xx_es_respuesta_definitiva_y_se_cachea(monkeypatch):
    import fx_currency

    def _prohibido(path, params):
        raise _envuelto(403)

    assert fx_currency.resolve_listing_currency("AAA.XETRA", _prohibido) == (None, fx_currency.SIN_DIVISA)

    _sin_cache()
    llamadas = []

    def _proveedor(path, **kw):
        llamadas.append(path)
        raise _envuelto(404)

    monkeypatch.setattr(price_refresh, "_eodhd_get", _proveedor)
    assert price_refresh.listing_currency("ZZZ.XETRA") is None
    assert price_refresh._LISTING_CURRENCY_CACHE["ZZZ.XETRA"] is None, "404: definitiva"
    consultas = len(llamadas)
    assert price_refresh.listing_currency("ZZZ.XETRA") is None
    assert len(llamadas) == consultas
    _sin_cache()


def test_429_y_5xx_no_se_cachean_como_definitivos(monkeypatch):
    import fx_currency

    for code in (429, 500, 503):
        def _caido(path, params=None, _code=code, **kw):
            raise _envuelto(_code)

        assert fx_currency.resolve_listing_currency("AAA.XETRA", _caido) == (
            None, fx_currency.PROVEEDOR_NO_DISPONIBLE), code
        _sin_cache()
        monkeypatch.setattr(price_refresh, "_eodhd_get", _caido)
        assert price_refresh.listing_currency("BBB.XETRA") is None
        assert "BBB.XETRA" not in price_refresh._LISTING_CURRENCY_CACHE, code
        assert "BBB.XETRA" in price_refresh._LISTING_CURRENCY_FAILURES, code
    _sin_cache()
