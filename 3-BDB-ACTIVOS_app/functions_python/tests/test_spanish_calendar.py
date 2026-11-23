from datetime import date
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import spanish_calendar  # noqa: E402


def test_range_requires_iso_order_and_a_bounded_window():
    assert spanish_calendar._range(
        {"from": "2026-07-10", "to": "2026-08-01"},
        90,
        366,
    ) == ("2026-07-10", "2026-08-01")

    with pytest.raises(ValueError, match="AAAA-MM-DD"):
        spanish_calendar._range({"from": "10/07/2026"}, 90, 366)
    with pytest.raises(ValueError, match="anterior"):
        spanish_calendar._range({"from": "2026-07-11", "to": "2026-07-10"}, 90, 366)
    with pytest.raises(ValueError, match="366 dias"):
        spanish_calendar._range({"from": "2026-01-01", "to": "2027-02-01"}, 90, 366)


def test_invalid_request_returns_stable_contract_before_calling_sources(monkeypatch):
    monkeypatch.setattr(
        spanish_calendar,
        "_collect",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("sources should not run")),
    )

    result = spanish_calendar.get_dividends_calendar({
        "from": "2026-07-11",
        "to": "2026-07-10",
    })

    assert result["schema_version"] == "spanish-calendar.v2"
    assert result["source"] == "INVALID_REQUEST"
    assert result["items"] == []
    assert result["count"] == 0
    assert result["from"] == result["to"]


def test_collect_distinguishes_provider_failure_from_missing_configuration():
    failed = spanish_calendar._collect(
        [(lambda: (_ for _ in ()).throw(OSError("provider down")), "YAHOO")],
        sort_key=lambda item: item["id"],
        hint="not configured",
    )
    unavailable = spanish_calendar._collect(
        [(lambda: None, "YAHOO")],
        sort_key=lambda item: item["id"],
        hint="not configured",
    )

    assert failed["source"] == "ERROR"
    assert "provider down" not in failed["note"] and "YAHOO" in failed["note"]  # el detalle va al registro
    assert unavailable["source"] == "NOT_CONFIGURED"


def test_collect_preserves_partial_coverage_note():
    result = spanish_calendar._collect(
        [(lambda: ([{"id": 2}, {"id": 1}], "Cobertura parcial."), "YAHOO")],
        sort_key=lambda item: item["id"],
        hint="not configured",
    )

    assert result["source"] == "YAHOO_LIVE"
    assert result["count"] == 2
    assert [item["id"] for item in result["items"]] == [1, 2]
    assert result["note"] == "Cobertura parcial."


def test_yahoo_dice_de_que_fecha_es_el_importe(monkeypatch):
    """Yahoo da la próxima fecha ex y el último pago ya hecho. Sin su fecha, se leen como la misma cosa."""

    class Dividendos:
        index = [date(2026, 1, 8), date(2026, 7, 6)]
        iloc = [0.25, 0.427]

        def __len__(self):
            return 2

    class ConPago:
        calendar = {"Ex-Dividend Date": date(2027, 1, 12)}
        dividends = Dividendos()

    class SinPagos:
        calendar = {"Ex-Dividend Date": date(2027, 1, 13)}
        dividends = None

    spanish_calendar._CACHE.clear()
    monkeypatch.setattr(spanish_calendar, "IBEX35", ["IBE.MC", "NUEVA.MC"])
    monkeypatch.setattr(spanish_calendar, "_yahoo_ticker", lambda simbolo: ConPago() if simbolo == "IBE.MC" else SinPagos())
    items, _nota = spanish_calendar._yahoo_dividends("2027-01-01", "2027-02-01")
    assert items[0]["ex_date"] == "2027-01-12"
    assert items[0]["amount"] == 0.427
    assert items[0]["amount_ex_date"] == "2026-07-06"
    assert items[1]["amount"] is None
    assert items[1]["amount_ex_date"] is None
    spanish_calendar._CACHE.clear()


def test_yahoo_total_failure_is_not_reported_as_an_empty_calendar(monkeypatch):
    spanish_calendar._CACHE.clear()
    monkeypatch.setattr(spanish_calendar, "IBEX35", ["AAA.MC", "BBB.MC"])
    monkeypatch.setattr(
        spanish_calendar,
        "_yahoo_ticker",
        lambda _symbol: (_ for _ in ()).throw(OSError("Yahoo unavailable")),
    )

    with pytest.raises(RuntimeError, match="no está contestando"):
        spanish_calendar._yahoo_earnings("2026-07-10", "2026-08-24")


def test_yahoo_partial_response_is_declared_and_cached_per_value(monkeypatch):
    """Un valor que falla se declara; la caché es por valor, no por rango."""

    class ValidTicker:
        calendar = {
            "Earnings Date": "2026-07-20",
            "Earnings Average": 1.25,
            "Revenue Average": 1000000,
        }

    spanish_calendar._CACHE.clear()
    monkeypatch.setattr(spanish_calendar, "IBEX35", ["AAA.MC", "BBB.MC"])

    def fake_ticker(symbol):
        if symbol == "BBB.MC":
            raise OSError("temporary")
        return ValidTicker()

    monkeypatch.setattr(spanish_calendar, "_yahoo_ticker", fake_ticker)

    items, note = spanish_calendar._yahoo_earnings("2026-07-10", "2026-08-24")

    assert len(items) == 1
    assert items[0]["code"] == "AAA.MC"
    assert items[0]["date_estimated"] is False
    assert items[0]["eps_estimate"] == 1.25
    assert note == "Yahoo respondió para 1 de 2 componentes; pueden faltar anuncios."
    assert ("cal", "AAA.MC") in spanish_calendar._CACHE
    assert ("cal", "BBB.MC") not in spanish_calendar._CACHE  # el fallo no se guarda

    # Otro rango: AAA sale de la caché, solo se vuelve a pedir el que falló.
    pedidos = []

    def counting(symbol):
        pedidos.append(symbol)
        raise OSError("temporary")

    monkeypatch.setattr(spanish_calendar, "_yahoo_ticker", counting)
    items2, _ = spanish_calendar._yahoo_earnings("2026-07-01", "2026-07-31")
    assert pedidos == ["BBB.MC"]
    assert [i["code"] for i in items2] == ["AAA.MC"]
    spanish_calendar._CACHE.clear()


def test_yahoo_empty_for_all_35_is_not_a_complete_empty_sweep(monkeypatch):
    """Hallazgo 26: Yahoo bloqueando (calendar vacío) no es «no hay dividendos»."""

    class Vacio:
        calendar = {}

    spanish_calendar._CACHE.clear()
    assert len(spanish_calendar.IBEX35) == 35
    monkeypatch.setattr(spanish_calendar, "_yahoo_ticker", lambda _s: Vacio())
    monkeypatch.setattr(spanish_calendar, "_eodhd_enabled", lambda: False)
    monkeypatch.setattr(spanish_calendar, "_fmp_dividends", lambda _f, _t: None)

    result = spanish_calendar.get_dividends_calendar({"from": "2026-07-10", "to": "2026-08-10"})

    assert result["status"] == "SOURCE_NOT_RESPONDING"
    assert result["source"] == "ERROR"
    assert "Yahoo no está contestando" in result["note"]
    assert result["count"] == 0
    # Nada de larga duración: solo la marca corta de «Yahoo caído».
    assert not any(k[0] == "cal" for k in spanish_calendar._CACHE)
    exp, _ = spanish_calendar._CACHE[("yahoo_down",)]
    assert exp - time.time() <= spanish_calendar._YAHOO_DOWN_TTL + 1
    spanish_calendar._CACHE.clear()


def test_valid_sweep_without_announcements_is_no_data_in_range(monkeypatch):
    class SinAnuncio:
        calendar = {"Earnings Date": "2027-03-01"}

    spanish_calendar._CACHE.clear()
    monkeypatch.setattr(spanish_calendar, "_yahoo_ticker", lambda _s: SinAnuncio())
    monkeypatch.setattr(spanish_calendar, "_eodhd_enabled", lambda: False)
    monkeypatch.setattr(spanish_calendar, "_fmp_dividends", lambda _f, _t: None)

    result = spanish_calendar.get_dividends_calendar({"from": "2026-07-10", "to": "2026-08-10"})

    assert result["status"] == "NO_DATA_IN_RANGE"
    assert result["source"] == "YAHOO_LIVE"
    spanish_calendar._CACHE.clear()


def test_earnings_window_is_marked_as_estimated(monkeypatch):
    class Ventana:
        calendar = {"Earnings Date": [date(2026, 7, 20), date(2026, 7, 24)]}

    spanish_calendar._CACHE.clear()
    monkeypatch.setattr(spanish_calendar, "IBEX35", ["AAA.MC"])
    monkeypatch.setattr(spanish_calendar, "_yahoo_ticker", lambda _s: Ventana())

    items, _ = spanish_calendar._yahoo_earnings("2026-07-10", "2026-08-24")

    assert items[0]["report_date"] == "2026-07-20"  # igual que antes
    assert items[0]["date_estimated"] is True
    assert items[0]["report_date_window_end"] == "2026-07-24"
    spanish_calendar._CACHE.clear()


def test_dividend_amount_says_it_is_the_last_payment(monkeypatch):
    class T:
        calendar = {"Ex-Dividend Date": date(2026, 7, 12)}
        dividends = None

    spanish_calendar._CACHE.clear()
    monkeypatch.setattr(spanish_calendar, "IBEX35", ["AAA.MC"])
    monkeypatch.setattr(spanish_calendar, "_yahoo_ticker", lambda _s: T())
    items, _ = spanish_calendar._yahoo_dividends("2026-07-01", "2026-07-31")
    assert items[0]["amount_kind"] == "LAST_PAID"
    spanish_calendar._CACHE.clear()


def test_today_is_madrid_today(monkeypatch):
    monkeypatch.setattr(spanish_calendar, "madrid_today", lambda: date(2026, 7, 10))
    assert spanish_calendar._range({}, 90, 366) == ("2026-07-10", "2026-10-08")


def test_cache_put_bounds_entries_with_simple_eviction():
    """Auditoría 11-08 (D14): la caché queda acotada a _CACHE_MAX_ENTRIES."""
    spanish_calendar._CACHE.clear()
    for index in range(spanish_calendar._CACHE_MAX_ENTRIES + 5):
        spanish_calendar._cache_put(("div", str(index), str(index)), ([], None))

    assert len(spanish_calendar._CACHE) == spanish_calendar._CACHE_MAX_ENTRIES
    # Evicción por orden de inserción: las claves más antiguas ya no están.
    assert ("div", "0", "0") not in spanish_calendar._CACHE
    assert ("div", "5", "5") in spanish_calendar._CACHE
    spanish_calendar._CACHE.clear()


def test_get_earnings_adds_schema_count_and_requested_range(monkeypatch):
    monkeypatch.setattr(spanish_calendar, "_eodhd_enabled", lambda: False)
    monkeypatch.setattr(
        spanish_calendar,
        "_yahoo_earnings",
        lambda _from, _to: [{"code": "AAA.MC", "report_date": "2026-07-20"}],
    )
    monkeypatch.setattr(spanish_calendar, "_fmp_earnings", lambda _from, _to: None)

    result = spanish_calendar.get_earnings_calendar({
        "from": "2026-07-10",
        "to": "2026-08-24",
    })

    assert result["schema_version"] == "spanish-calendar.v2"
    assert result["source"] == "YAHOO_LIVE"
    assert result["count"] == 1
    assert result["status"] == "OK"
    assert result["from"] == "2026-07-10"
    assert result["to"] == "2026-08-24"


# --- Auditoria 20-11-2026 (P2-10) ----------------------------------------------------------------------------------

def test_la_cache_no_retiene_el_ticker_de_yfinance(monkeypatch):
    class T:
        calendar = {"Earnings Date": "2026-07-20"}

    spanish_calendar._CACHE.clear()
    monkeypatch.setattr(spanish_calendar, "IBEX35", ["AAA.MC"])
    monkeypatch.setattr(spanish_calendar, "_yahoo_ticker", lambda _s: T())
    spanish_calendar._yahoo_earnings("2026-07-10", "2026-08-24")
    entrada = spanish_calendar._CACHE[("cal", "AAA.MC")][1]
    assert set(entrada) == {"cal"}  # solo el calendario, ningun objeto de la libreria
    spanish_calendar._CACHE.clear()


def test_la_cache_aguanta_escrituras_a_la_vez_sin_romperse(monkeypatch):
    import threading

    spanish_calendar._CACHE.clear()
    monkeypatch.setattr(spanish_calendar, "_CACHE_MAX_ENTRIES", 8)
    errores = []

    def escribe(inicio):
        try:
            for i in range(inicio, inicio + 400):
                spanish_calendar._cache_put(("k", i), i)
                spanish_calendar._cache_get(("k", i))
        except Exception as exc:  # noqa: BLE001
            errores.append(exc)

    hilos = [threading.Thread(target=escribe, args=(n * 1000,)) for n in range(8)]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join()
    assert errores == []
    assert len(spanish_calendar._CACHE) <= 8
    spanish_calendar._CACHE.clear()


def test_el_fallo_de_una_fuente_no_llega_a_la_nota_con_su_detalle():
    secreto = "https://eodhd.com/api/calendar?api_token=SECRETO"
    resultado = spanish_calendar._collect(
        [(lambda: (_ for _ in ()).throw(OSError(secreto)), "EODHD")],
        sort_key=lambda item: item["id"],
        hint="sin fuente",
    )
    assert resultado["status"] == "SOURCE_NOT_RESPONDING"
    assert "SECRETO" not in resultado["note"] and "EODHD" in resultado["note"]
