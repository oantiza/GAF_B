import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import price_refresh  # noqa: E402


@pytest.mark.parametrize("source", ["CAPITALGROUP", "MARKIT_FT", "BLACKROCK", "MORNINGSTAR", "CARMIGNAC"])
@pytest.mark.parametrize("resolve", [False, True])
def test_reviewed_source_never_falls_back_to_an_older_eodhd_root_quote(monkeypatch, source, resolve):
    monkeypatch.setattr(price_refresh, "listing_currency", _no_llamar)
    monkeypatch.setattr(price_refresh, "fetch_eod", _no_llamar)
    root = {"performance": {"valuation": {"vl_source_listing_id": "EODHD:LU1295551144.EUFUND"}}}
    series = {"source_listing_id": source + ":LU1295551144", "source_currency": "EUR"}
    assert price_refresh._symbol_and_currency(series, root, resolve=resolve) == (None, None)


def test_convert_eur_uses_major_fx_for_gbx(monkeypatch):
    calls = []

    def fake_fetch_fx(ccy, from_date, to_date):
        calls.append(ccy)
        return ["2024-01-01"], [0.86]

    monkeypatch.setattr(price_refresh, "_fetch_fx", fake_fetch_fx)

    points, meta = price_refresh._convert_eur(
        [{"date": "2024-01-02", "adjusted_close": 172.0}],
        "GBX",
        {},
        "2024-01-01",
        "2024-01-02",
    )

    assert calls == ["GBP"]
    assert meta["fx_pair"] == "EURGBP.FOREX"
    assert meta["minor_scale"] == 0.01
    assert points[0]["value"] == 2.0


def test_convert_eur_reamplia_fx_para_activo_rezagado(monkeypatch):
    """Bug de la auditoria 27-07 (D2): la cache FX se poblaba con la ventana del
    primer activo y un rezagado de la misma divisa perdia todos sus puntos."""
    calls = []

    def fake_fetch_fx(ccy, from_date, to_date):
        calls.append((ccy, from_date))
        # Serie desde el from_date pedido: cubre exactamente la ventana solicitada.
        return [from_date], [1.1]

    monkeypatch.setattr(price_refresh, "_fetch_fx", fake_fetch_fx)
    fx_cache = {}

    # Activo al dia: puebla la cache con ventana reciente.
    al_dia, _ = price_refresh._convert_eur(
        [{"date": "2026-07-24", "adjusted_close": 110.0}],
        "USD", fx_cache, "2026-07-17", "2026-07-24",
    )
    # Activo rezagado (last_date antiguo): necesita FX desde 2023.
    rezagado, _ = price_refresh._convert_eur(
        [{"date": "2023-12-30", "adjusted_close": 220.0}],
        "USD", fx_cache, "2023-12-29", "2026-07-24",
    )

    assert calls == [("USD", "2026-07-17"), ("USD", "2023-12-29")]
    assert len(al_dia) == 1
    assert rezagado, "el activo rezagado no puede quedarse sin puntos convertidos"
    assert rezagado[0]["value"] == 200.0
    # Un tercer activo al dia reutiliza la serie ya ampliada: sin fetch extra.
    price_refresh._convert_eur(
        [{"date": "2026-07-24", "adjusted_close": 55.0}],
        "USD", fx_cache, "2026-07-17", "2026-07-24",
    )
    assert len(calls) == 2


def test_convert_eur_respeta_cache_prepoblada_sin_ventana(monkeypatch):
    """backfill/ingesta pre-pueblan fx_cache[major] = (dates, rates) con ventana
    constante 1990: nunca debe refetchearse por la logica de ventanas."""
    monkeypatch.setattr(
        price_refresh, "_fetch_fx",
        lambda *_a: (_ for _ in ()).throw(AssertionError("no debe llamarse")),
    )
    fx_cache = {"USD": (["1990-01-01"], [1.25])}

    points, meta = price_refresh._convert_eur(
        [{"date": "2024-05-02", "adjusted_close": 125.0}],
        "USD", fx_cache, "1990-01-01", "2024-05-02",
    )

    assert points[0]["value"] == 100.0
    assert meta["fx_pair"] == "EURUSD.FOREX"


def test_price_refresh_now_iso_is_utc_z():
    ts = price_refresh._now_iso()

    assert ts.endswith("Z")
    assert "+00:00" not in ts


def test_convert_eur_skips_rows_before_first_fx(monkeypatch):
    monkeypatch.setattr(price_refresh, "_fetch_fx", lambda *_args: (["2024-01-03"], [1.2]))

    points, _meta = price_refresh._convert_eur(
        [
            {"date": "2024-01-02", "adjusted_close": 120.0},
            {"date": "2024-01-03", "adjusted_close": 120.0},
        ],
        "USD",
        {},
        "2024-01-01",
        "2024-01-03",
    )

    # source_currency y fx_pair son constantes de la serie: van en el documento.
    assert points == [{
        "date": "2024-01-03",
        "value": 100.0,
        "source_value": 120.0,
        "fx_rate": 1.2,
    }]
    assert _meta["source_currency"] == "USD" and _meta["fx_pair"] == "EURUSD.FOREX"


def test_symbol_falls_back_to_eodhd_fund_valuation(monkeypatch):
    """El SIMBOLO puede salir de la ficha; la DIVISA la manda el listado.

    Auditoria de divisas (06-09-2026): antes se tomaba `vl_divisa` —la divisa de la
    clase del fondo— y con eso se convertian cotizaciones que ya venian en euros.
    """
    price_refresh.clear_listing_currency_cache()
    monkeypatch.setattr(price_refresh, "_eodhd_get", lambda path, **kw: (
        [{"Code": "LU0000000001", "Exchange": "EUFUND", "Currency": "USD"}] if path.startswith("search/") else None))
    serie = {"source_price_id": "NAV:LU0000000001", "source_currency": "EUR"}
    root = {"performance": {"valuation": {
        "vl_source_listing_id": "EODHD:LU0000000001.EUFUND",
        "vl_divisa": "USD",
    }}}

    symbol, currency = price_refresh._symbol_and_currency(serie, root)
    assert symbol == "LU0000000001.EUFUND"
    assert currency == "USD"

    # La vista previa no consulta al proveedor: devuelve el metadato tal cual —aqui el
    # «EUR» del documento de serie— y no escribe nada con el.
    price_refresh.clear_listing_currency_cache()
    monkeypatch.setattr(price_refresh, "_eodhd_get", _no_llamar)
    symbol, currency = price_refresh._symbol_and_currency(serie, root, resolve=False)
    assert (symbol, currency) == ("LU0000000001.EUFUND", "EUR")


def _no_llamar(*args, **kwargs):  # pragma: no cover - se invoca solo si hay regresion
    raise AssertionError("la vista previa no debe llamar al proveedor")


def test_fund_nav_update_uses_native_value_and_never_applies_to_stock():
    payload = price_refresh._fund_nav_update(
        "FUND",
        {"date": "2026-07-16", "value": 100.0, "source_value": 120.0},
        "USD",
        "LU0000000001.EUFUND",
        "2026-07-18T00:00:00.000Z",
        {"vl": 119.0, "vl_fecha": "2026-07-15", "vl_fuente": "morningstar"},
    )

    assert payload == {
        "vl": 120.0,
        "vl_fecha": "2026-07-16",
        "vl_divisa": "USD",
        "vl_fuente": "eodhd",
        "vl_source_listing_id": "EODHD:LU0000000001.EUFUND",
        "vl_fetched_at": "2026-07-18T00:00:00.000Z",
    }
    assert price_refresh._fund_nav_update(
        "STOCK", {"date": "2026-07-16", "value": 100.0}, "EUR", "AAPL.US", "now", {}
    ) is None


def test_fund_nav_update_preserves_newer_live_nav():
    assert price_refresh._fund_nav_update(
        "FUND",
        {"date": "2026-07-16", "value": 100.0},
        "EUR",
        "LU0000000001.EUFUND",
        "2026-07-18T00:00:00.000Z",
        {"vl": 101.0, "vl_fecha": "2026-07-17", "vl_fuente": "gestora"},
    ) is None
