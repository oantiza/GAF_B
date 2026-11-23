"""Propiedad de assets/{id}: bloqueos fuera de la maestra (asset_selection_controls.json).

La migracion de las 6 raices (`scripts/migrate_ownership_v12.py`) y las pruebas de los contratos v1.2 de la maestra
(`contract_validation`) se fueron el 21-11-2026 con la base vieja (decisiones 31 y 39 del censo
CENSO_BASE_VIEJA_2026-11-21.md; etiqueta referencia-base-vieja-2026-11-21). Los bloqueos siguen vivos: los leen el
optimizador y los mappers con las dos formas de raiz.
"""
import re

import pytest

import asset_eligibility
from optimization.repository import _root_exclusion_reason
from readmodel.mappers import map_asset_detail

BLOCKED = "ES0105513008"  # SOLTEC POWER, bloqueada el 30-09 (A4)


def stock_root(asset_id=BLOCKED, **extra):
    root = {
        "asset_id": asset_id, "asset_type": "STOCK", "schema_version": "master.asset-stock.v1",
        "identity": {"name": "SOLTEC POWER", "currency": "EUR"},
        "identifiers": {"isin": asset_id, "ticker": "SOL", "eodhd_code": "SOL.MC", "aliases": [asset_id]},
        "classification": {"asset_class": "EQUITY", "strategy_tags": []},
        "product": {"product_type": "stock", "has_listing": True},
        "listings": [{"listing_id": "EODHD:SOL.MC", "is_primary": True, "data_sources": ["eodhd"]}],
        "quality": {"status": "PROVISIONAL_ADMIN", "warnings": [], "validation_errors": [],
                    "review_flags": ["PRICE_HISTORY_ARTIFACT_UNRESOLVED"]},
        "source_metadata": {"source": "EODHD"},
    }
    root.update(extra)
    return root


# --- bloqueos de seleccion: asset_selection_controls.json ---

def test_controls_file_declares_reason_note_and_date_for_every_block():
    controls = asset_eligibility.selection_controls()
    assert {"ES0105513008", "ES0110047919", "ES0162600003", "ES0183304080"} <= set(controls)
    for asset_id, control in controls.items():
        assert re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", asset_id)
        assert control["blocked"] is True
        assert control["reason"] and control["note"] and re.fullmatch(r"\d{4}-\d{2}-\d{2}", control["decided_at"])


def test_a_block_in_the_controls_file_excludes_without_any_field_in_the_root():
    root = stock_root()
    assert "is_investable" not in root
    assert map_asset_detail(root)["is_investable"] is False
    # Decision 75: el bloqueo sigue igual, y el motivo es el de verdad. Antes decia NON_INVESTABLE de una accion que cotiza.
    assert _root_exclusion_reason(root, "EUR") == "QUALITY_BLOCKED"
    # exclude_from_history: igual que el is_investable=false que sustituye
    assert _root_exclusion_reason(root, "EUR", allow_historical=True) == "QUALITY_BLOCKED"


def test_a_block_can_allow_historical_analyses(monkeypatch):
    monkeypatch.setattr(asset_eligibility, "selection_controls",
                        lambda: {BLOCKED: {"blocked": True, "exclude_from_history": False}})
    root = stock_root()
    assert _root_exclusion_reason(root, "EUR") == "NON_INVESTABLE"
    assert _root_exclusion_reason(root, "EUR", allow_historical=True) is None


def test_legacy_root_flag_still_blocks_until_migrated(monkeypatch):
    monkeypatch.setattr(asset_eligibility, "selection_controls", lambda: {})
    root = stock_root(is_investable=False)
    assert map_asset_detail(root)["is_investable"] is False
    assert _root_exclusion_reason(root, "EUR", allow_historical=True) == "NON_INVESTABLE"
    assert map_asset_detail(stock_root())["is_investable"] is True
