# -*- coding: utf-8 -*-
"""BAJA-02 (auditoria 16-10-2026): el dia de negocio es el de Madrid, no el de UTC.

Ejecuta: pytest functions_python/tests/test_clock.py
"""
import datetime
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import admin_panel  # noqa: E402
import clock  # noqa: E402
import metrics_refresh  # noqa: E402
import price_refresh  # noqa: E402

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


def test_precios_panel_y_metricas_usan_el_mismo_dia(monkeypatch):
    # 23:30 UTC del 16-10 son las 01:30 del 17-10 en Madrid: date.today() del contenedor
    # (UTC) habria dado el 16.
    monkeypatch.setattr(clock, "_utc_now", lambda: datetime.datetime(2026, 10, 16, 23, 30, tzinfo=UTC))
    assert price_refresh._today() == "2026-10-17"
    assert admin_panel._today() == datetime.date(2026, 10, 17)
    assert metrics_refresh._madrid_today() == "2026-10-17"
