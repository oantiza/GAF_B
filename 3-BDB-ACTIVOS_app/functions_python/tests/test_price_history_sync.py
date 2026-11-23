"""La cuarentena de series con ajuste dudoso (`price_history_sync.adjustment_problem`), que lee el optimizador.

Las pruebas de la reparacion de series de la base vieja (planes, reparacion atomica de `assets/…/price_series` y
`metrics/latest`, aplazamientos ante fallos de EODHD) se fueron el 21-11-2026 con ese codigo (decision 31 del censo
CENSO_BASE_VIEJA_2026-11-21.md; etiqueta referencia-base-vieja-2026-11-21). La cuarentena se queda (decision 38).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import price_history_sync as sync  # noqa: E402
import price_series_cache as cache  # noqa: E402
from optimization import repository  # noqa: E402

AID = "US0000000001"


def test_known_adjustment_errors_are_blocked_for_the_optimizer():
    for aid in sync.ADJUSTMENT_QUARANTINE_ASSETS:
        assert repository._root_exclusion_reason({"asset_type": "STOCK"}, "EUR", aid) == "QUALITY_BLOCKED"


def test_verified_release_is_explicit_and_does_not_override_new_quality_holds(monkeypatch):
    fx_id, adjustment_id = "IE000M7V94E1", "US0320951017"
    monkeypatch.delenv("BDB_VERIFIED_PRICE_REPAIR_RELEASES", raising=False)
    assert repository.asset_id_in_quarantine(fx_id)
    assert sync.adjustment_problem(adjustment_id)
    monkeypatch.setenv("BDB_VERIFIED_PRICE_REPAIR_RELEASES", fx_id + "," + adjustment_id)
    assert not repository.asset_id_in_quarantine(fx_id)
    assert sync.adjustment_problem(adjustment_id) is None
    assert repository.asset_id_in_quarantine("GB0005405286")
    assert sync.adjustment_problem(adjustment_id, [{"metadata": {
        "price_history_sync": {"status": "REPAIR_REQUIRED"}}}]) == "PRICE_ADJUSTMENT_QUARANTINE"
    assert repository._root_exclusion_reason({"asset_type": "ETF", "quality": {"status": "BLOCKED"}},
                                              "EUR", fx_id) == "QUALITY_BLOCKED"


def test_hot_price_cache_still_expires_after_a_remote_repair(monkeypatch):
    cache.clear_price_series_cache()
    clock = [0.0]
    monkeypatch.setattr(cache.time, "monotonic", lambda: clock[0])
    reader = type("Reader", (), {"value": 1, "get_price_series": lambda self, aid: [{"value": self.value}]})()
    assert cache.cached_price_series(reader, AID)[0]["value"] == 1
    clock[0] = 899
    assert cache.cached_price_series(reader, AID)[0]["value"] == 1
    reader.value = 2
    clock[0] = 901
    assert cache.cached_price_series(reader, AID)[0]["value"] == 2
    cache.clear_price_series_cache()
