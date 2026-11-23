# -*- coding: utf-8 -*-
"""La baja que se sigue valorando a su ultimo precio: NH Hotel Group, decision de Oscar del 12-11-2026.

Se queda dada de alta como unico caso excepcional: hay clientes que la tienen, no se negocia y se espera una OPA de exclusion a
ese precio. Se decide por la marca de la politica (`PRICE_FROZEN_DELISTED` con su `frozen_price`), nunca por el ISIN, y las
demas bajas no cambian de trato.
"""
from datetime import date, timedelta
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import portfolio_horizon as h  # noqa: E402
from asset_eligibility import valorado_a_precio_congelado  # noqa: E402
from fund_history_quality import policies  # noqa: E402
from optimization.repository import _clear_price_series_cache, _root_exclusion_reason  # noqa: E402
from readmodel import lector_base_nueva as lector  # noqa: E402
from readmodel.mappers import map_asset_detail  # noqa: E402

NH = "ES0161560018"
ERCROS = "ES0125140A14"
ACCION_DE_BAJA = {
    "instrument_type": "STOCK",
    "identity": {"name": "Accion", "currency": "EUR"},
    "classification": {"asset_class": "EQUITY"},
    "availability": {"state": "DELISTED", "since": "2025-09-15"},
}


def test_es_un_solo_caso():
    congelados = sorted(isin for isin, politica in policies().items() if "PRICE_FROZEN_DELISTED" in (politica.get("flags") or []))
    assert congelados == [NH], (
        "PRICE_FROZEN_DELISTED es una excepcion de Oscar (12-11-2026) para NH Hotel Group: una baja que se queda dada de alta, "
        "valorada a su ultimo precio. Anadir otro instrumento con esta marca pide su decision, y entonces se cambia esta prueba. "
        f"Hoy la llevan: {congelados}"
    )


def test_la_marca_lleva_su_precio_y_su_fecha():
    politica = policies()[NH]
    assert politica["frozen_price"] == {"from": "2025-09-15", "value": 6.5}


def test_nh_se_puede_elegir_aunque_la_base_diga_que_no_cotiza():
    raiz = lector.raiz_vieja(NH, ACCION_DE_BAJA)
    assert raiz["is_investable"] is False, "la base sigue diciendo la verdad: no cotiza"
    assert valorado_a_precio_congelado(raiz)
    detalle = map_asset_detail(raiz)
    assert detalle["is_investable"] is True
    assert detalle["role"] == "INVESTABLE"
    assert "PRICE_FROZEN_DELISTED" in detalle["quality_flags"]
    assert not {"NON_INVESTABLE_DELISTED", "NON_INVESTABLE_CORPORATE_ACTION"} & set(detalle["quality_flags"])


def test_nh_se_mide_en_la_simulacion_y_no_se_le_proponen_pesos():
    raiz = lector.raiz_vieja(NH, ACCION_DE_BAJA)
    assert _root_exclusion_reason(raiz, "EUR", NH, allow_historical=True) is None
    assert _root_exclusion_reason(raiz, "EUR", NH) == "NON_INVESTABLE"


def test_ercros_sigue_de_baja_como_estaba():
    raiz = lector.raiz_vieja(ERCROS, {**ACCION_DE_BAJA, "availability": {"state": "DELISTED", "since": "2026-09-11"}})
    assert not valorado_a_precio_congelado(raiz)
    detalle = map_asset_detail(raiz)
    assert detalle["is_investable"] is False
    assert "NON_INVESTABLE_DELISTED" in detalle["quality_flags"]
    assert "PRICE_FROZEN_DELISTED" not in detalle["quality_flags"]
    assert _root_exclusion_reason(raiz, "EUR", ERCROS) == "NON_INVESTABLE"
    assert _root_exclusion_reason(raiz, "EUR", ERCROS, allow_historical=True) is None, "su historico se sigue midiendo, como antes"


def test_una_marca_sin_precio_no_abre_nada(monkeypatch):
    import fund_history_quality
    monkeypatch.setattr(fund_history_quality, "policy_for", lambda _id: {"flags": ["PRICE_FROZEN_DELISTED"]})
    assert not valorado_a_precio_congelado({"asset_id": "X"})


def _dias(desde, hasta):
    dia = desde
    while dia <= hasta:
        if dia.weekday() < 5:
            yield dia
        dia += timedelta(days=1)


class _Lector:
    """NH con la serie que guardaba la base vieja: cotiza hasta la congelacion y sigue plana a 6,50 hasta el 04-09-2026. Lo demas, al dia."""

    def __init__(self):
        self.puntos = {}
        for i, dia in enumerate(_dias(date(2019, 1, 1), date(2026, 11, 6))):
            self.puntos.setdefault("LONG", {})[dia.isoformat()] = 100 * math.exp(i * .0002 + .02 * math.sin(i / 11))
            if dia <= date(2026, 9, 4):
                valor = 6.5 if dia >= date(2025, 9, 25) else 5 + math.sin(i / 7) * .3 + i * .0005
                self.puntos.setdefault(NH, {})[dia.isoformat()] = valor

    def get_asset(self, aid):
        if aid == NH:
            return lector.raiz_vieja(NH, ACCION_DE_BAJA)
        return {"asset_id": aid, "asset_type": "ETF", "quality": {"status": "OK"}}

    def get_price_series(self, aid):
        return [{"schema_version": "asset-price-series.v1.2", "currency": "EUR", "interval": "1d",
                 "points": [{"date": d, "value": v} for d, v in self.puntos[aid].items()]}]


@pytest.fixture
def cache_limpia():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


def test_una_cartera_con_nh_lo_valora_plano_a_su_precio_desde_que_se_congelo(cache_limpia):
    lector_ = _Lector()
    hoy = date(2026, 11, 6)
    posiciones = [{"asset_id": "LONG", "weight": 90}, {"asset_id": NH, "weight": 10}]
    resultado = h.analyze_horizon(lector_, {"window": "3Y", "positions": posiciones}, today=hoy)
    simulacion = resultado["backtest"]
    assert set(simulacion["asset_ids"]) == {"LONG", NH}
    assert all(fuera["asset_id"] != NH for fuera in simulacion["excluded_assets"])
    assert resultado["coverage_weight_percent"] == pytest.approx(100)

    cargados, fuera, _raices = h._leer_precios_y_raices(lector_, [NH])
    assert fuera == []
    congelados = {d: v for d, v in cargados[NH].items() if d >= "2025-09-25"}
    assert set(congelados.values()) == {6.5}
    assert max(congelados) >= hoy.isoformat(), "la serie llega plana hasta la fecha de calculo"
    valores = [congelados[d] for d in sorted(congelados)]
    rendimientos = [b / a - 1 for a, b in zip(valores, valores[1:])]
    assert max(abs(r) for r in rendimientos) == 0, "cero rentabilidad y cero volatilidad desde la congelacion"


def test_p1_04_nh_no_aparta_a_los_demas_cuando_el_refresco_pasa_de_14_dias(cache_limpia):
    """P1-04 (auditoria del 20-11-2026). Catalogo refrescado el viernes 30-10-2026 y simulacion el viernes 20-11-2026: 21 dias.

    NH se prolonga plano hasta hoy al leerlo. Antes su ultimo dato fijaba el fin del periodo en el 20-11-2026, y LONG, con su
    ultimo dato 21 dias antes (21 > 14, el hueco que se puentea), salia con SERIES_ENDS_EARLY: la cartera se media con el 2 %
    de NH y la cobertura era un 2 %. Ahora el fin lo pone LONG: el viernes 30-10-2026, y la cobertura es 98 + 2 = 100 %."""
    lector_ = _Lector()
    lector_.puntos["LONG"] = {d: v for d, v in lector_.puntos["LONG"].items() if d <= "2026-10-30"}
    posiciones = [{"asset_id": "LONG", "weight": 98}, {"asset_id": NH, "weight": 2}]
    resultado = h.analyze_horizon(lector_, {"window": "3Y", "positions": posiciones}, today=date(2026, 11, 20))
    simulacion = resultado["backtest"]
    assert simulacion["excluded_assets"] == []
    assert set(simulacion["asset_ids"]) == {"LONG", NH}
    assert resultado["coverage_weight_percent"] == pytest.approx(100)
    assert simulacion["coverage"]["last_date"] == "2026-10-30"
    assert simulacion["weights_normalized"] == {"LONG": pytest.approx(0.98), NH: pytest.approx(0.02)}


def test_p1_04_una_cartera_solo_de_nh_sigue_midiendose_hasta_su_ultimo_dato():
    """Sin otro activo que ponga el fin, lo pone el congelado, como antes: el ultimo viernes hasta el 20-11-2026 es ese dia."""
    cargados = {NH: {d.isoformat(): 6.5 for d in _dias(date(2023, 1, 2), date(2026, 11, 20))}}
    periodo = h._periodo_comun(cargados, [], "3Y", {**h.references(), "assets": {}}, date(2026, 11, 20))
    assert periodo.ids == [NH] and periodo.dates[-1] == "2026-11-20"
