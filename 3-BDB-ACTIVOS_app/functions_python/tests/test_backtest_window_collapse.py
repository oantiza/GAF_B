"""
El backtest debe cantar cuando la ventana comun colapsa (auditoria 06-09-2026, A3).

`backtest_portfolio` cruza las fechas comunes a TODOS los activos, asi que un solo
historico corto reduce la ventana de la cartera entera. Antes devolvia esa ventana
recortada sin ningun aviso y la pantalla la presentaba como «3A». Aqui se fija el
contrato del aviso: codigo en `warnings`, cifras y culpable en `coverage`.

Ejecuta: pytest functions_python/tests/test_backtest_window_collapse.py
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization import repository  # noqa: E402
from optimization.repository import (  # noqa: E402
    MIN_COMMON_OBSERVATIONS,
    MIN_WEEKS_PER_WINDOW_YEAR,
    _clear_price_series_cache,
    backtest_portfolio,
)
from test_rebased_min_history import CORTO, LARGO, LectorFalso  # noqa: E402


@pytest.fixture(autouse=True)
def limpia_cache():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


def corre(posiciones, window="3Y", frequency="WEEKLY", min_history=None):
    peticion = {"positions": posiciones, "window": window, "frequency": frequency}
    if min_history is not None:
        peticion["min_history"] = min_history
    return backtest_portfolio(LectorFalso(), peticion)


def test_avisa_y_nombra_al_activo_que_recorta_la_ventana():
    resp = corre([{"asset_id": LARGO, "weight": 0.9}, {"asset_id": CORTO, "weight": 0.1}])
    cobertura = resp["coverage"]
    assert cobertura["required_observations"] == MIN_COMMON_OBSERVATIONS["3Y"]
    assert cobertura["common_observations"] < cobertura["required_observations"]
    assert "WINDOW_COLLAPSED" in resp["warnings"]
    # El joven entra en marzo de 2026: es quien define el inicio comun.
    assert cobertura["window_start_limited_by"] == CORTO
    assert cobertura["first_date"] >= "2026-03-02"


def test_sin_aviso_cuando_el_historico_cubre_la_ventana():
    resp = corre([{"asset_id": LARGO, "weight": 1.0}])
    cobertura = resp["coverage"]
    assert cobertura["common_observations"] >= cobertura["required_observations"]
    assert "WINDOW_COLLAPSED" not in resp["warnings"]
    # Con un solo activo no hay recorte que atribuir.
    assert cobertura["window_start_limited_by"] is None


def test_el_tope_de_activos_deja_de_recortar_en_silencio(monkeypatch):
    monkeypatch.setattr(repository, "MAX_REBASED_SERIES_ASSETS", 1)
    resp = corre([{"asset_id": LARGO, "weight": 0.5}, {"asset_id": CORTO, "weight": 0.5}])
    assert resp["asset_ids"] == [LARGO]
    assert {"asset_id": CORTO, "reason": "ASSET_CAP_EXCEEDED"} in resp["excluded_assets"]


# --- 06-09-2026: el aviso se leia en la unidad equivocada ---------------------------
#
# La pantalla dibuja en DIARIO. El recuento de la cobertura eran dias y el minimo de la
# ventana, semanas: «320 observaciones semanales» sobre ano y medio, y el aviso del
# backend no saltaba nunca porque 320 dias superan un minimo de 156 semanas.

def test_en_diario_el_aviso_se_compara_y_se_dice_en_semanas():
    resp = corre(
        [{"asset_id": LARGO, "weight": 0.9}, {"asset_id": CORTO, "weight": 0.1}],
        frequency="DAILY",
    )
    cobertura = resp["coverage"]

    assert cobertura["measurement_frequency"] == "WEEKLY"
    assert cobertura["series_frequency"] == "DAILY"
    # Las dibujadas son dias; las medidas, semanas: no pueden ser el mismo numero.
    assert cobertura["measured_observations"] < cobertura["common_observations"]
    assert cobertura["measured_observations"] < cobertura["required_observations"]
    # Y el aviso sale, que era lo que no pasaba.
    assert "WINDOW_COLLAPSED" in resp["warnings"]


def test_en_diario_tambien_se_dice_quien_recorta_la_ventana():
    """La rama diaria no calculaba limites: el aviso salia sin culpable."""
    resp = corre(
        [{"asset_id": LARGO, "weight": 0.9}, {"asset_id": CORTO, "weight": 0.1}],
        frequency="DAILY",
    )
    assert resp["coverage"]["window_start_limited_by"] == CORTO


def test_apartar_al_corto_devuelve_la_ventana_entera_y_lo_dice():
    """La alternativa a encoger la ventana de todos: apartar a quien no llega."""
    completo = corre([{"asset_id": LARGO, "weight": 1.0}], frequency="DAILY")
    forzado = corre(
        [{"asset_id": LARGO, "weight": 0.9}, {"asset_id": CORTO, "weight": 0.1}],
        frequency="DAILY",
        min_history="ENFORCE",
    )

    assert forzado["asset_ids"] == [LARGO]
    motivos = {item["asset_id"]: item["reason"] for item in forzado["excluded_assets"]}
    assert motivos[CORTO] == "INSUFFICIENT_HISTORY"
    # La ventana vuelve a ser la del activo largo, no la del joven.
    assert forzado["coverage"]["first_date"] == completo["coverage"]["first_date"]
    assert "WINDOW_COLLAPSED" not in forzado["warnings"]


def test_por_defecto_entra_toda_la_cartera():
    """Apartar activos es una decision del asesor, no el comportamiento por omision."""
    resp = corre(
        [{"asset_id": LARGO, "weight": 0.9}, {"asset_id": CORTO, "weight": 0.1}],
        frequency="DAILY",
    )
    assert set(resp["asset_ids"]) == {LARGO, CORTO}


def test_el_minimo_de_cinco_anos_son_cinco_anos():
    """Valia 156 —el mismo numero que 3A, o sea tres anos de semanas—.

    29-09-2026 (B-01): el minimo dejo de ser el recuento exacto de semanas (260/520) y
    paso a 48 semanas por ano de ventana (240/480): el exacto no dejaba margen y una
    sola semana sin VL expulsaba fondos con el historico completo. Lo que fija esta
    prueba es que 5A exige cinco anos de semanas (con la misma holgura por ano que 3A
    y 10A), no que la cifra sea redonda.
    """
    assert MIN_COMMON_OBSERVATIONS["5Y"] == 5 * MIN_WEEKS_PER_WINDOW_YEAR == 240
    assert MIN_COMMON_OBSERVATIONS["5Y"] != MIN_COMMON_OBSERVATIONS["3Y"]
    assert MIN_COMMON_OBSERVATIONS["5Y"] > 0.9 * 5 * 52
    assert MIN_COMMON_OBSERVATIONS["10Y"] == 10 * MIN_WEEKS_PER_WINDOW_YEAR == 480
