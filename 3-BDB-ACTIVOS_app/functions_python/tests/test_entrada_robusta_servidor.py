# -*- coding: utf-8 -*-
"""Entrada mal formada a las callables (auditoria 20-11-2026, P2-07): INVALID_ARGUMENT y no un 500.

Ejecuta: pytest functions_python/tests/test_entrada_robusta_servidor.py
"""
import inspect
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main  # noqa: E402
from firebase_functions import https_fn  # noqa: E402
from optimization.improvement_service import improve_portfolio  # noqa: E402
from optimization.repository import InvalidOptimizationRequest, backtest_portfolio  # noqa: E402

# Las callables que antes hacian `(req.data or {}).get(...)` y que ahora pasan por `_datos(req)`.
CALLABLES = [
    "optimize_portfolio", "get_price_series", "backtest_portfolio", "improve_portfolio",
    "get_macro_reference", "get_ecb_rates", "get_euro_yield_curve", "get_economic_calendar",
    "get_dividends_calendar", "get_earnings_calendar", "save_portfolio", "delete_portfolio",
    "admin_publish_report",
]
# Hasta el 21-11-2026 entraban tambien seis `admin_*` de la base vieja, borradas con ella.


class _Req:
    auth = None
    app = None

    def __init__(self, data):
        self.data = data


@pytest.fixture(autouse=True)
def sin_autenticacion(monkeypatch):
    monkeypatch.setattr(main, "_require_auth", lambda req, **_limites: "user1")
    monkeypatch.setattr(main, "_require_admin", lambda req, **_limites: "admin1")
    # Sin base: con `MASTER_PROJECT_ID=gestor-activos-local` los de verdad paran (solo saben leer la base nueva), y
    # aqui se prueba lo que pasa antes de leer nada.
    monkeypatch.setattr(main, "lector_de_optimizacion", lambda: object())
    monkeypatch.setattr(main, "almacen_de_carteras", lambda: object())


@pytest.mark.parametrize("nombre", CALLABLES)
@pytest.mark.parametrize("dato", [[1, 2], "cadena", 7])
def test_unos_datos_que_no_son_un_objeto_se_rechazan_como_argumento_invalido(nombre, dato):
    with pytest.raises(https_fn.HttpsError) as error:
        inspect.unwrap(getattr(main, nombre))(_Req(dato))
    assert error.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT


# --- pesos: Infinity y booleanos ----------------------------------------------------------------------------------

class _LectorQueNoSeLee:
    def __getattr__(self, nombre):
        raise AssertionError("la entrada mala se rechaza antes de leer nada")


def _posiciones(peso):
    return {"positions": [{"asset_id": "A", "weight": peso}, {"asset_id": "B", "weight": 0.5}]}


@pytest.mark.parametrize("peso", [float("inf"), float("-inf"), float("nan"), True, False, "inf"])
def test_backtest_rechaza_pesos_infinitos_o_booleanos(peso):
    with pytest.raises(InvalidOptimizationRequest):
        backtest_portfolio(_LectorQueNoSeLee(), _posiciones(peso))


@pytest.mark.parametrize("peso", [float("inf"), float("nan"), True, False, "inf"])
def test_improve_rechaza_pesos_infinitos_o_booleanos(peso):
    with pytest.raises(InvalidOptimizationRequest):
        improve_portfolio(_LectorQueNoSeLee(), {**_posiciones(peso), "candidates": {"A": ["C"]}, "window": "3Y"})


# --- imports perezosos de main.py (P2-10) -------------------------------------------------------------------------

def test_main_no_importa_al_arrancar_los_modulos_heredados_ni_el_informe_semanal():
    """Un proceso nuevo: importar main.py no trae weekly_report (ni lo que arrastra: curl_cffi), y aun asi sigue
    declarando sus 26 funciones. Los cuatro modulos heredados que tambien se cargaban tarde (admin_panel,
    history_backfill, ingest_asset, system_status) ya no existen: se borraron el 21-11-2026 con la base vieja."""
    import subprocess

    codigo = (
        "import sys, main\n"
        "cargados = [m for m in ('weekly_report','jsonschema','curl_cffi') if m in sys.modules]\n"
        "print('CARGADOS', cargados)\n"
        "print('FUNCIONES', sum(1 for n in dir(main) if hasattr(getattr(main, n), '__firebase_endpoint__')))\n"
    )
    salida = subprocess.run([sys.executable, "-W", "ignore", "-c", codigo],
                            cwd=os.path.join(os.path.dirname(__file__), ".."),
                            capture_output=True, text=True, env={**os.environ, "MASTER_PROJECT_ID": "bdb-gestor-de-activos"})
    assert "CARGADOS []" in salida.stdout, salida.stdout + salida.stderr
    assert "FUNCIONES 26" in salida.stdout, salida.stdout + salida.stderr
