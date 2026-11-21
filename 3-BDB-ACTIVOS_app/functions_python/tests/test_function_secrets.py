# -*- coding: utf-8 -*-
"""
B-02 (auditoría 29-09-2026): toda función de main.py que llegue a EODHD debe declarar
el secreto EODHD_API_KEY en su decorador. `admin_refresh_prices`, `get_dividends_calendar`
y `get_earnings_calendar` no lo hacían y fallaban siempre en producción con
«EODHD_API_KEY no configurada», incluso en pasada en seco.

Se inspecciona main.py con `ast` (sin importarlo) para fijar la configuración de despliegue.

Los dos calendarios salieron de esta lista el 03-11-2026: el plan de EODHD no incluye su calendario
(422 y 403), su fuente real es Yahoo, y sin clave caen a ella. Lo fija la prueba de abajo.

Run: `python -m pytest functions_python/tests/test_function_secrets.py -q`
"""
import ast
import os

import pytest

MAIN_PY = os.path.join(os.path.dirname(__file__), "..", "main.py")

FUNCIONES_CON_EODHD = [
    "admin_refresh_prices",
    "admin_refresh_all_stale",
    "admin_ingest_asset",
    "scheduled_refresh_prices",
]


def _funciones_decoradas():
    with open(MAIN_PY, encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), filename=MAIN_PY)
    return {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef) and node.decorator_list}


def _keywords(fn: ast.FunctionDef) -> dict:
    """Argumentos con nombre del decorador on_call/on_schedule (el primero y único)."""
    decoradores = [d for d in fn.decorator_list if isinstance(d, ast.Call)]
    assert len(decoradores) == 1, f"{fn.name}: se esperaba un único decorador con argumentos"
    return {kw.arg: kw.value for kw in decoradores[0].keywords}


def _secretos(fn: ast.FunctionDef) -> list:
    valor = _keywords(fn).get("secrets")
    if valor is None:
        return []
    assert isinstance(valor, ast.List), f"{fn.name}: secrets debe ser una lista literal"
    return [ast.literal_eval(item) for item in valor.elts]


@pytest.mark.parametrize("nombre", FUNCIONES_CON_EODHD)
def test_las_funciones_que_llegan_a_eodhd_declaran_el_secreto(nombre):
    fn = _funciones_decoradas()[nombre]
    assert "EODHD_API_KEY" in _secretos(fn), f"{nombre} no declara secrets=[\"EODHD_API_KEY\"]"


def test_admin_refresh_prices_tiene_margen_para_reparar_todo_el_historico():
    fn = _funciones_decoradas()["admin_refresh_prices"]
    timeout = _keywords(fn).get("timeout_sec")
    assert timeout is not None and ast.literal_eval(timeout) >= 540


def test_las_callables_de_escritura_siguen_con_la_identidad_writer():
    decoradas = _funciones_decoradas()
    for nombre in ("admin_refresh_prices", "admin_refresh_all_stale", "admin_ingest_asset"):
        cuenta = _keywords(decoradas[nombre]).get("service_account")
        assert isinstance(cuenta, ast.Name) and cuenta.id == "WRITER_SERVICE_ACCOUNT", nombre


@pytest.mark.parametrize("nombre", ["get_dividends_calendar", "get_earnings_calendar"])
def test_los_calendarios_funcionan_sin_clave_con_yahoo(nombre, monkeypatch):
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import spanish_calendar as s

    assert _secretos(_funciones_decoradas()[nombre]) == []
    for variable in ("EODHD_API_KEY", "EODHD_API_TOKEN", "FMP_API_KEY", "FMP_API_TOKEN"):
        monkeypatch.delenv(variable, raising=False)
    s._CACHE.clear()
    fila = {"code": "SAN.MC", "name": None, "ex_date": "2026-12-01", "report_date": "2026-12-01"}
    monkeypatch.setattr(s, "_yahoo_dividends", lambda *_a: [dict(fila)])
    monkeypatch.setattr(s, "_yahoo_earnings", lambda *_a: [dict(fila)])
    resultado = getattr(s, nombre)({})
    s._CACHE.clear()
    assert resultado["source"] == "YAHOO_LIVE"
    assert resultado["count"] == 1


def test_los_calendarios_ponen_el_nombre_que_la_fuente_no_da(monkeypatch):
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import spanish_calendar as s

    for variable in ("EODHD_API_KEY", "EODHD_API_TOKEN", "FMP_API_KEY", "FMP_API_TOKEN"):
        monkeypatch.delenv(variable, raising=False)
    s._CACHE.clear()
    filas = [{"code": "NTGY.MC", "name": None, "report_date": "2026-12-01"},
             {"code": "XXX.MC", "name": None, "report_date": "2026-12-02"}]
    monkeypatch.setattr(s, "_yahoo_earnings", lambda *_a: filas)
    items = s.get_earnings_calendar({})["items"]
    s._CACHE.clear()
    assert items[0]["name"] == "Naturgy"
    assert items[1]["name"] is None
    assert set(s.NOMBRES_IBEX35) == set(s.IBEX35)
    assert len(s.IBEX35) == 35
