# -*- coding: utf-8 -*-
"""Fecha de negocio en hora de Madrid, comun a los jobs y al panel de admin.

BAJA-02 (auditoria 16-10-2026): Cloud Run va en UTC y `date.today()` devolvia el
dia anterior entre las 00:00 y las 01:00/02:00 de Madrid. Una ejecucion manual a
esa hora pedia a EODHD hasta el dia anterior y el panel contaba un dia menos de
antiguedad. Los crons ya cuentan el dia en hora de Madrid (metrics_refresh).
"""
import datetime
from zoneinfo import ZoneInfo

MADRID = ZoneInfo("Europe/Madrid")


def _utc_now() -> datetime.datetime:
    """Punto unico para fijar el reloj en pruebas."""
    return datetime.datetime.now(datetime.timezone.utc)


def madrid_today() -> datetime.date:
    """Fecha de hoy en Europe/Madrid (horario de verano incluido)."""
    return _utc_now().astimezone(MADRID).date()
