"""
Politica de historico minimo en build_rebased_series (min_history=ENFORCE).

El grafico de evolucion del X-Ray pide ENFORCE para analizar la MISMA cartera que
la frontera: un fondo joven no debe encoger la ventana de todos los demas. El
comparador y la ficha de activo siguen con NONE, que es el valor por defecto.

Ejecuta: pytest functions_python/tests/test_rebased_min_history.py
"""
from datetime import date, timedelta
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.repository import (  # noqa: E402
    MIN_COMMON_OBSERVATIONS,
    _clear_price_series_cache,
    _min_history_days,
    build_rebased_series,
)

LARGO = "LU0000000LARGO"
CORTO = "LU0000000CORTO"
FIN = date(2026, 9, 1)


@pytest.fixture(autouse=True)
def limpia_cache():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


def dias_habiles(desde: date, hasta: date):
    dia = desde
    while dia <= hasta:
        if dia.weekday() < 5:
            yield dia
        dia += timedelta(days=1)


def raiz(asset_id: str, nombre: str) -> dict:
    return {
        "asset_id": asset_id,
        "asset_type": "FUND",
        "identity": {"name": nombre, "currency": "EUR"},
        "quality": {"status": "OK"},
    }


def serie(asset_id: str, desde: date) -> list:
    """Un doc por anio, puntos en dias habiles, subida suave y determinista."""
    por_anio = {}
    valor = 100.0
    for i, dia in enumerate(dias_habiles(desde, FIN)):
        valor *= 1.0 + 0.0002 + ((i % 5) - 2) * 0.00003
        por_anio.setdefault(dia.year, []).append(
            {"date": dia.isoformat(), "value": round(valor, 6)}
        )
    docs = []
    for anio, puntos in sorted(por_anio.items()):
        docs.append({
            "schema_version": "asset-price-series.v1.2",
            "asset_id": asset_id,
            "asset_type": "FUND",
            "series_type": "NAV",
            "source": "EODHD",
            "source_price_id": "EODHD:%s" % asset_id,
            "source_listing_id": "EODHD:%s" % asset_id,
            "document_id": "EODHD_%s_%d" % (asset_id, anio),
            "currency": "EUR",
            "interval": "1d",
            "year": anio,
            "points": puntos,
            "first_date": puntos[0]["date"],
            "last_date": puntos[-1]["date"],
            "observations_count": len(puntos),
            "history_quality_status": "COMPLETE",
            "updated_at": "2026-09-03T00:00:00Z",
        })
    return docs


class LectorFalso:
    def __init__(self):
        self.roots = {
            LARGO: raiz(LARGO, "Fondo con historico largo"),
            CORTO: raiz(CORTO, "Fondo joven"),
        }
        self.series = {
            LARGO: serie(LARGO, date(2020, 1, 1)),
            CORTO: serie(CORTO, date(2026, 3, 2)),
        }

    def get_asset(self, asset_id):
        return self.roots.get(asset_id)

    def get_price_series(self, asset_id):
        return self.series.get(asset_id, [])

    def set(self, *_a, **_k):  # pragma: no cover
        raise AssertionError("Las series rebasadas no deben escribir.")


def pide(**extra):
    peticion = {"asset_ids": [LARGO, CORTO], "window": "3Y"}
    peticion.update(extra)
    return build_rebased_series(LectorFalso(), peticion)


def test_umbral_en_dias_equivale_al_semanal_de_la_frontera():
    for ventana, semanas in MIN_COMMON_OBSERVATIONS.items():
        assert _min_history_days(ventana) == semanas * 7


def test_none_es_el_valor_por_defecto_y_no_excluye():
    """El comparador y la ficha de activo no deben cambiar de comportamiento."""
    for peticion in (pide(frequency="DAILY"), pide(frequency="DAILY", min_history="NONE")):
        assert peticion["coverage"]["included_assets"] == 2
        assert peticion["excluded_assets"] == []
        # El joven manda: la ventana comun no puede empezar antes de su primer dia.
        assert peticion["coverage"]["first_date"] >= "2026-03-02"


def test_enforce_excluye_al_corto_en_diario_y_libera_la_ventana():
    resp = pide(frequency="DAILY", min_history="ENFORCE")
    assert [s["asset_id"] for s in resp["series"]] == [LARGO]
    assert resp["coverage"]["included_assets"] == 1
    assert resp["coverage"]["requested_assets"] == 2
    # Ya no lo encoge el joven: la ventana arranca ~3 anios antes del ultimo dato.
    assert resp["coverage"]["first_date"] < "2024-01-01"
    assert resp["coverage"]["common_observations"] > 600

    (excluido,) = resp["excluded_assets"]
    assert excluido["asset_id"] == CORTO
    assert excluido["reason"] == "INSUFFICIENT_HISTORY"
    assert excluido["required"] == _min_history_days("3Y")
    assert excluido["observations"] < excluido["required"]
    assert excluido["window"] == "3Y"


def test_enforce_excluye_al_corto_tambien_en_semanal():
    resp = pide(frequency="WEEKLY", min_history="ENFORCE")
    assert [s["asset_id"] for s in resp["series"]] == [LARGO]
    (excluido,) = resp["excluded_assets"]
    assert excluido["reason"] == "INSUFFICIENT_HISTORY"
    # En semanal el umbral se cuenta en semanas, como en la frontera.
    assert excluido["required"] == MIN_COMMON_OBSERVATIONS["3Y"]


def test_enforce_con_solo_activos_cortos_devuelve_vacio_sin_reventar():
    lector = LectorFalso()
    resp = build_rebased_series(lector, {
        "asset_ids": [CORTO], "window": "3Y",
        "frequency": "DAILY", "min_history": "ENFORCE",
    })
    assert resp["series"] == []
    assert resp["dates"] == []
    assert resp["coverage"]["first_date"] is None
    assert resp["excluded_assets"][0]["reason"] == "INSUFFICIENT_HISTORY"


def test_politica_desconocida_cae_a_none():
    resp = pide(frequency="DAILY", min_history="LO_QUE_SEA")
    assert resp["coverage"]["included_assets"] == 2
    assert resp["excluded_assets"] == []