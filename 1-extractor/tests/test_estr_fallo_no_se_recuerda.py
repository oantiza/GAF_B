# -*- coding: utf-8 -*-
"""EXT-10 (auditoría integral del 16-11-2026): una caída del BCE no deja a las acciones sin tipo hasta reiniciar.

`_serie_estr` guardaba en el módulo la lista vacía cuando el BCE fallaba. El módulo vive lo que vive el proceso, y la
consola puede vivir días: todas las acciones que se actualizaran después salían sin tipo sin riesgo y sin Sharpe,
aunque el BCE hubiera vuelto a contestar al minuto.

Aquí no hay red: un cliente HTTP de mentira contesta lo que cada caso necesita y cuenta las veces que se le pregunta.
"""
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fetchers import eodhd  # noqa: E402

CSV_BUENO = "TIME_PERIOD,OBS_VALUE\n2026-11-12,1.93\n2026-11-13,1.93\n"


class _Resp:
    def __init__(self, text, ok=True, status=200):
        self.text, self.ok, self.status = text, ok, status


class _Http:
    """Una pasada: contesta lo que diga `responde()` cada vez y cuenta las preguntas."""

    def __init__(self, responde):
        self.responde, self.preguntas = responde, 0

    def get(self, url, params=None, ttl_dias=None, force=False, familia=None, **_k):
        self.preguntas += 1
        respuesta = self.responde()
        if isinstance(respuesta, Exception):
            raise respuesta
        return respuesta


@pytest.fixture(autouse=True)
def sin_memoria(monkeypatch):
    monkeypatch.setattr(eodhd, "_ESTR_CACHE", None)


@pytest.mark.parametrize("fallo", [
    lambda: ConnectionError("sin red"),                    # la red no contesta
    lambda: _Resp("Service Unavailable", ok=False, status=503),   # el BCE contesta que no puede
    lambda: _Resp("TIME_PERIOD,OBS_VALUE\n"),              # contesta, pero sin una sola fila
    lambda: _Resp("<html>mantenimiento</html>"),           # contesta otra cosa
])
def test_un_fallo_del_bce_no_se_queda_en_el_modulo(fallo):
    caida = _Http(fallo)
    assert eodhd._serie_estr(caida) == []
    # Lo que no pasa ya: que el fallo quede guardado para todo el proceso.
    assert eodhd._ESTR_CACHE is None
    # La pasada siguiente —otro cliente— vuelve a preguntar, y esta vez el BCE contesta.
    buena = _Http(lambda: _Resp(CSV_BUENO))
    serie = eodhd._serie_estr(buena)
    assert buena.preguntas == 1
    assert serie == [{"date": date(2026, 11, 12), "value_pct": 1.93}, {"date": date(2026, 11, 13), "value_pct": 1.93}]


def test_dentro_de_la_misma_pasada_no_se_le_pregunta_una_vez_por_accion():
    """Con el BCE caído, 500 acciones no son 500 preguntas: el fallo vale para la pasada entera."""
    caida = _Http(lambda: _Resp("", ok=False, status=503))
    for _accion in range(5):
        assert eodhd._serie_estr(caida) == []
    assert caida.preguntas == 1


def test_lo_que_llega_bien_si_se_recuerda_y_no_se_vuelve_a_pedir():
    buena = _Http(lambda: _Resp(CSV_BUENO))
    primera = eodhd._serie_estr(buena)
    otra_pasada = _Http(lambda: ConnectionError("no debería preguntarse"))
    assert eodhd._serie_estr(otra_pasada) is primera
    assert (buena.preguntas, otra_pasada.preguntas) == (1, 0)
