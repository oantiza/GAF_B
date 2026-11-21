"""La clave de una fuente no sale en un error (auditoría del 16-11-2026, EXT-5).

La clave de EODHD viaja como parámetro `api_token`. Cuando la conexión falla, `requests` escribe
la URL entera en su excepción, y de ahí pasaba al registro, a `meta.errores` de la ficha y a la
exportación. La clave de estas pruebas es inventada.
"""
import logging

import pytest
import requests

from core.http import Http, sin_claves

CLAVE = "clave-inventada-0123456789"
SETTINGS = {"reintentos": 2, "backoff_segundos": 0, "timeout_segundos": 1, "pausa_min_segundos": 0, "pausa_max_segundos": 0}


def test_el_valor_de_una_clave_se_tacha_y_lo_demas_se_queda():
    error = (f"HTTPSConnectionPool(host='eodhd.com', port=443): Max retries exceeded with url: "
             f"/api/eod/SAN.MC?api_token={CLAVE}&fmt=json&period=d (Caused by NameResolutionError)")
    limpio = sin_claves(error)
    assert CLAVE not in limpio
    assert "api_token=***&fmt=json&period=d" in limpio and "eodhd.com" in limpio and "NameResolutionError" in limpio
    # Otros nombres con los que viaja una clave, y un texto sin ninguna.
    assert sin_claves(f"https://x.test/v3?apikey={CLAVE}") == "https://x.test/v3?apikey=***"
    assert sin_claves(f"...?fmt=json&API_KEY={CLAVE}'") == "...?fmt=json&API_KEY=***'"
    assert sin_claves("sin cartera publicada") == "sin cartera publicada"
    assert sin_claves(ValueError("fecha=2026-11-16")) == "fecha=2026-11-16"


def test_un_fallo_de_red_no_deja_la_clave_en_la_excepcion_ni_en_el_registro(tmp_path, monkeypatch, caplog):
    http = Http(SETTINGS, tmp_path / "cache")
    monkeypatch.setattr(http, "_espera_educada", lambda url: None)

    def falla(url, params=None, **_kw):
        raise requests.ConnectionError(f"Max retries exceeded with url: /api/eod/SAN.MC?api_token={params['api_token']}&fmt=json")

    monkeypatch.setattr(http.session, "get", falla)
    with caplog.at_level(logging.WARNING, logger="fondosdb.http"), pytest.raises(ConnectionError) as error:
        http.get("https://eodhd.com/api/eod/SAN.MC", params={"api_token": CLAVE, "fmt": "json"}, force=True)
    assert CLAVE not in str(error.value) and "api_token=***" in str(error.value)
    assert caplog.records and all(CLAVE not in registro.getMessage() for registro in caplog.records)
