"""Propiedad de assets/{id}: bloqueos fuera de la maestra, migracion de las 6 raices y contratos v1.2."""
import re
from copy import deepcopy

import pytest

import asset_eligibility
from contract_validation import ContractValidationError, validate_contract
from optimization.repository import _root_exclusion_reason
from readmodel.mappers import map_asset_detail
from scripts.migrate_ownership_v12 import MigrationError, migrate_root, plan, restore_root

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


def fund_root(asset_id="LU0000000001", **extra):
    root = {
        "asset_id": asset_id, "asset_type": "FUND", "schema_version": "master.asset.v1.1",
        "identity": {"name": "Fondo de prueba", "currency": "EUR"},
        "product": {"product_type": "fund", "has_listing": False},
        "quality": {"status": "ACCEPTED", "warnings": [], "validation_errors": [], "review_flags": []},
        "source_metadata": {"source": "FondosDB"},
    }
    root.update(extra)
    return root


def evidence(asset_id, **extra):
    doc = {"sri": 4, "date": "2026-04-30", "url": "https://example.test/kid.pdf", "sha256": "ab" * 32,
           "document_type": "PRIIPS_KID", "verified_isin": asset_id, "source": "Robeco",
           "verified_at": "2026-09-29T17:41:57+00:00"}
    doc.update(extra)
    return doc


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


# --- migracion de las raices fuera de contrato ---

def test_migration_moves_the_manual_block_out_of_the_root_and_keeps_the_data_flag():
    root = stock_root(is_investable=False)
    root["quality"]["review_note"] = "A4 ..."
    with pytest.raises(ContractValidationError):
        validate_contract(root, "asset-stock.v1.1.schema.json")
    new, changes = migrate_root(root, asset_eligibility.selection_controls())
    assert "is_investable" not in new and "review_note" not in new["quality"]
    assert new["quality"]["review_flags"] == ["PRICE_HISTORY_ARTIFACT_UNRESOLVED"]
    assert len(changes) == 2
    validate_contract(new, "asset-stock.v1.1.schema.json")
    assert map_asset_detail(new)["is_investable"] is False


def test_migration_refuses_to_drop_a_block_that_is_not_in_the_controls_file():
    root = stock_root(asset_id="ES0000000006", is_investable=False)
    with pytest.raises(MigrationError):
        migrate_root(root, asset_eligibility.selection_controls())


def test_migration_normalizes_a_documentary_alta():
    root = fund_root(
        asset_id="ES0173985005", schema_version=None,
        source_metadata={"source": "Andbank/CNMV", "generated_at": "2026-09-29T17:48:30+00:00"},
        costs={"management_fee_pct": 0.9, "performance_fee_pct": 0, "entry_fee_max_pct": 0,
               "evidence": {"ongoing_and_transaction": evidence("ES0173985005", source="Andbank via Inversis"),
                            "management_and_depositary": {"url": "https://cnmv.test/folleto", "source": "CNMV",
                                                          "verified_isin": "ES0173985005"}}},
        risk={"sri_kid_1a7": 4, "sri_kid_evidence": evidence("ES0173985005")},
    )
    new, _changes = migrate_root(root, {})
    assert new["source_metadata"]["source"] == "MANUAL_DOCUMENTARY"
    assert new["source_metadata"]["source_detail"] == "Andbank/CNMV"
    assert new["costs"]["kid_evidence"]["document_type"] == "PRIIPS_KID"
    assert new["costs"]["evidence"]["source"] == "CNMV"
    assert new["costs"]["performance_fee_pct"] == 0
    assert new["schema_version"] == "master.asset.v1.2"
    validate_contract(new, "asset.v1.2.schema.json")


def test_migration_keeps_a_contractual_performance_fee_apart_from_the_kid_impact():
    root = fund_root(
        asset_id="LU0591059224", schema_version=None, source_metadata={"source": "Robeco"},
        costs={"performance_fee_pct": 15, "performance_fee_basis": "15% sobre el exceso frente al indice"},
    )
    new, _changes = migrate_root(root, {})
    assert "performance_fee_pct" not in new["costs"]
    assert new["costs"]["performance_fee_rate_pct"] == 15
    validate_contract(new, "asset.v1.2.schema.json")


def test_restore_returns_exactly_what_the_migration_changed():
    stock = stock_root(is_investable=False)
    stock["quality"]["review_note"] = "A4 ..."
    migrated, _ = migrate_root(stock, asset_eligibility.selection_controls())
    migrated["performance"] = {"valuation": {"vl": 1.5}}  # escrito despues por la app
    restored = restore_root(migrated, stock)
    assert restored["is_investable"] is False
    assert restored["quality"]["review_note"] == "A4 ..."
    assert restored["performance"] == {"valuation": {"vl": 1.5}}

    fund = fund_root(asset_id="LU0591059224", schema_version=None, source_metadata={"source": "Robeco"},
                     costs={"performance_fee_pct": 15, "performance_fee_basis": "15% sobre el exceso"})
    migrated, _ = migrate_root(fund, {})
    assert restore_root(migrated, fund) == fund


def test_migration_leaves_contract_roots_alone():
    roots = {"LU0000000001": fund_root(), BLOCKED: stock_root()}
    result = plan(deepcopy(roots), asset_eligibility.selection_controls())
    assert result["summary"]["counts"]["to_migrate"] == 0
    assert result["summary"]["counts"]["invalid_after"] == 0


# --- contratos ---

def test_asset_v12_accepts_v11_documents_and_typed_kid_evidence():
    validate_contract(fund_root(), "asset.v1.2.schema.json")
    root = fund_root(risk={"sri_kid_1a7": 4, "sri_kid_evidence": evidence("LU0000000001")},
                     regulatory={"version": 1, "sri": 4, "kid": {"url": "https://example.test/kid.pdf", "source": "dws",
                                                                   "costs": {"entry_pct": 5.0}}},
                     provenance={"version": 1, "acquired_at": None, "fields": {"regulatory.sri": "kid_gestora:dws"}})
    validate_contract(root, "asset.v1.2.schema.json")
    bad = deepcopy(root)
    bad["risk"]["sri_kid_evidence"].pop("verified_at")
    with pytest.raises(ContractValidationError):
        validate_contract(bad, "asset.v1.2.schema.json")
    with pytest.raises(ContractValidationError):
        validate_contract(fund_root(is_investable=False), "asset.v1.2.schema.json")


def test_metrics_v13_admits_the_kid_sri_label():
    doc = {"asset_id": "LU0000000001", "population": "fund", "source": "FONDOSDB_ROOT_ES",
           "updated_at": "2026-10-14T00:00:00Z", "windows": {}, "risk_score_source": "SRI_KID", "srri": 4}
    validate_contract(doc, "metrics.v1.3.schema.json")
    with pytest.raises(ContractValidationError):
        validate_contract(doc, "metrics.v1.2.schema.json")
