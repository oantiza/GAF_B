# -*- coding: utf-8 -*-
"""BAJA-02 (auditoria 16-10-2026): el dia de negocio es el de Madrid, no el de UTC.

Ejecuta: pytest functions_python/tests/test_clock.py
"""
import datetime
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import clock  # noqa: E402

UTC = datetime.timezone.utc


@pytest.mark.parametrize("utc_now, madrid_day", [
    (datetime.datetime(2026, 10, 16, 23, 30, tzinfo=UTC), datetime.date(2026, 10, 17)),  # CEST, +2
    (datetime.datetime(2026, 10, 16, 21, 59, tzinfo=UTC), datetime.date(2026, 10, 16)),
    (datetime.datetime(2026, 12, 31, 23, 30, tzinfo=UTC), datetime.date(2027, 1, 1)),    # CET, +1
    (datetime.datetime(2026, 12, 31, 22, 59, tzinfo=UTC), datetime.date(2026, 12, 31)),
])
def test_madrid_today_sigue_la_hora_de_madrid(monkeypatch, utc_now, madrid_day):
    monkeypatch.setattr(clock, "_utc_now", lambda: utc_now)
    assert clock.madrid_today() == madrid_day
    # La prueba de que precios, panel y metricas usaban este mismo dia se fue el 21-11-2026 con esos tres modulos,
    # que eran de la base vieja.
