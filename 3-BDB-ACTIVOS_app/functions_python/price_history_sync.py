"""Cuarentena de series con un ajuste de precios dudoso, que lee el optimizador (`optimization/repository.py`).

Es lo que queda de la reparacion de series de la base vieja: la reparacion (`build_repair_plan`, `prepare_repair`,
`apply_repair`, `mark_repair_*`) escribia en `assets/…/price_series` y se borro el 21-11-2026 con el resto del codigo
de esa base (censo `CENSO_BASE_VIEJA_2026-11-21.md`, decision 31; etiqueta `referencia-base-vieja-2026-11-21`). La
cuarentena se queda por decision 38: sigue activa al optimizar, y `verified_price_repair_releases.json` dice que ISIN
libera el despliegue (decision 58).
"""
from __future__ import annotations

ADJUSTMENT_QUARANTINE_ASSETS = frozenset({
    "US0320951017",  # APH: split on 2026-09-03, old prices remain on the old scale.
    "ES0116870314",  # Naturgy: confirmed inconsistent dividend-adjustment versions.
})


def adjustment_problem(asset_id, docs=()):
    from price_repair_release import repair_released
    if asset_id in ADJUSTMENT_QUARANTINE_ASSETS and not repair_released(asset_id):
        return "PRICE_ADJUSTMENT_QUARANTINE"
    if any((doc.get("metadata") or {}).get("price_history_sync", {}).get("status") == "REPAIR_REQUIRED"
           for doc in docs or ()):
        return "PRICE_ADJUSTMENT_QUARANTINE"
    return None
