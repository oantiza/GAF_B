# -*- coding: utf-8 -*-
"""Decision 96 (05-11-2026): los fondos bloqueados por `fund_history_policies.json`.

Los nueve revisados (`draw_after_review`) se dibujaban solo en Rendimiento, con su valor liquidativo y los dividendos del
extracto; el resto del programa (simulacion y frontera; y `metrics_refresh`, borrado el 21-11-2026 con la base vieja) no los lee. El motor de Rendimiento
(`portfolio_real/`) se borro el 17-11-2026 (decision A-188): sus pruebas de valoracion estan en la etiqueta de Git
`referencia-portfolio-real-2026-11-17`. Aqui queda lo que sigue vivo: la lista de los nueve y que nadie mas los lee.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fund_history_quality import policies, se_dibuja_tras_revision  # noqa: E402
from optimization.repository import PriceSeriesProblem, _load_asset_returns, asset_id_in_quarantine  # noqa: E402
from price_series_cache import cached_price_series, clear_price_series_cache  # noqa: E402

SCHRODER = "LU0321373184"  # uno de los nueve
BNY = "IE00BZ18VT34"  # uno de los nueve, con un punto quitado por la decision 54
POLAR = "XS0000000001"  # politica sintetica: bloqueo sin revision (IE00BF0GL212 se desbloqueo el 11-11-2026); fixture `bloqueo_sin_revision`
SANO = "LU0430492750"  # sin politica


@pytest.fixture(autouse=True)
def cache_limpia(monkeypatch, bloqueo_sin_revision):
    # Sin la linea de liberados: asi se ve lo que dice de verdad la cuarentena de divisa. Con ella, la prueba es la de `test_price_repair_releases.py`.
    monkeypatch.delenv("BDB_VERIFIED_PRICE_REPAIR_RELEASES", raising=False)
    clear_price_series_cache()
    yield
    clear_price_series_cache()


class Lector:
    """El valor liquidativo de 10, 9 y 9,90: baja 1 el dia que paga 1, y luego sube un 10 %."""

    def __init__(self, serie=(("2025-01-02", 10.0), ("2025-06-02", 9.0), ("2026-01-02", 9.9))):
        self.serie = serie
        self.lecturas = 0

    def get_assets_many(self, ids):
        return {i: {"asset_type": "FUND", "currency": "EUR"} for i in ids}

    def get_asset(self, asset_id):
        return {"asset_type": "FUND", "currency": "EUR"}

    def get_price_series(self, asset_id):
        self.lecturas += 1
        return [{
            "schema_version": "asset-price-series.v1.2", "asset_id": asset_id, "currency": "EUR", "series_type": "NAV",
            "points": [{"date": dia, "value": valor} for dia, valor in self.serie],
        }]


NUEVE = sorted(isin for isin, politica in policies().items() if politica.get("draw_after_review"))


def test_son_nueve_y_polar_no_esta():
    assert len(NUEVE) == 9
    assert SCHRODER in NUEVE and BNY in NUEVE
    assert POLAR not in NUEVE


def test_nadie_mas_lo_lee():
    """Decision 96: simulacion y frontera no se tocan: preguntan por estas dos puertas."""
    lector = Lector()
    assert asset_id_in_quarantine(SCHRODER) is True
    assert cached_price_series(lector, SCHRODER) == []
    with pytest.raises(PriceSeriesProblem):
        _load_asset_returns(lector, SCHRODER, lector.get_asset(SCHRODER), "3Y")


def test_la_marca_de_revision_es_la_de_la_politica():
    assert se_dibuja_tras_revision(SCHRODER) is True
    assert se_dibuja_tras_revision(POLAR) is False
    assert se_dibuja_tras_revision(SANO) is False
