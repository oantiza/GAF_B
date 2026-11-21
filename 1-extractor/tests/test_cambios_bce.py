from datetime import date

import pytest

from fetchers import cambios_bce


class _Http:
    def __init__(self, texto="", ok=True):
        self.texto, self.ok, self.pedidas = texto, ok, []

    def get(self, url, **_kwargs):
        self.pedidas.append(url)
        return type("R", (), {"ok": self.ok, "status": 200 if self.ok else 500, "text": self.texto})


@pytest.fixture(autouse=True)
def _limpia():
    cambios_bce._memoria.clear()
    yield
    cambios_bce._memoria.clear()


CSV = "TIME_PERIOD,OBS_VALUE\n2026-01-02,1.25\n2026-01-01,\n"
SERIE = [(date(2026, 1, 2), 100.0), (date(2026, 1, 5), 125.0)]


def test_euros_no_pide_cambio_ni_toca_la_serie():
    http = _Http(CSV)
    assert cambios_bce.serie_en_euros(SERIE, "EUR", http) == SERIE
    assert http.pedidas == []


def test_dolares_se_convierten_con_el_ultimo_cambio():
    http = _Http(CSV)
    assert cambios_bce.serie_en_euros(SERIE, "USD", http) == [
        (date(2026, 1, 2), pytest.approx(80.0)), (date(2026, 1, 5), pytest.approx(100.0))
    ]
    assert "D.USD.EUR" in http.pedidas[0]


def test_los_peniques_piden_la_libra_y_se_escalan():
    http = _Http(CSV)
    resultado = cambios_bce.serie_en_euros([(date(2026, 1, 2), 1000.0)], "GBX", http)
    assert resultado == [(date(2026, 1, 2), pytest.approx(8.0))]
    assert "D.GBP.EUR" in http.pedidas[0]


def test_sin_divisa_o_sin_cambio_no_hay_serie():
    assert cambios_bce.serie_en_euros(SERIE, None, _Http(CSV)) == []
    assert cambios_bce.serie_en_euros(SERIE, "USD", _Http("", ok=False)) == []


def test_un_fallo_no_se_guarda_en_memoria():
    assert cambios_bce.cambios("USD", _Http("", ok=False)) == []
    assert cambios_bce.cambios("USD", _Http(CSV)) == [(date(2026, 1, 2), 1.25)]
