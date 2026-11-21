# -*- coding: utf-8 -*-
"""Fase 2: cableado backend de constraints (validate_request + resolucion de labels). Puro."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from optimization import repository as repo  # noqa: E402


def _base(**extra):
    d = {"schema_version": "portfolio-optimization-request.v1",
         "asset_ids": ["ES0000000001", "ES0000000002"], "window": "3Y",
         "base_currency": "EUR", "objective": "TARGET_RISK", "risk_slider": 5}
    d.update(extra)
    return d


def test_validate_parses_and_filters_group_constraints():
    req = repo.validate_request(_base(group_constraints=[
        {"dimension": "asset_class", "upper": {"RV": 0.6}, "lower": {"RF": 0.1}},
        {"dimension": "currency", "upper": {"USD": 0.3}},
        {"dimension": "bogus", "upper": {"X": 0.5}},   # dimension no permitida -> fuera
        {"dimension": "vehicle"},                        # sin bounds -> fuera
    ]))
    gc = req.group_constraints
    assert [g["dimension"] for g in gc] == ["asset_class", "currency"]
    assert gc[0]["upper"] == {"RV": 0.6} and gc[0]["lower"] == {"RF": 0.1}


def test_validate_group_constraints_must_be_list():
    with pytest.raises(Exception):
        repo.validate_request(_base(group_constraints={"no": "list"}))


def test_group_label_reads_contract_paths():
    root = {"identity": {"currency": "USD"},
            "classification": {"asset_class": "RV", "region_primary": "EUROPE", "asset_subtype": "LARGE"},
            "product": {"vehicle_complexity": "UCITS"}}
    assert repo._group_label(root, "currency") == "USD"
    assert repo._group_label(root, "asset_class") == "RV"
    assert repo._group_label(root, "region") == "EUROPE"
    assert repo._group_label(root, "subtype") == "LARGE"
    assert repo._group_label(root, "vehicle") == "UCITS"
    assert repo._group_label({}, "currency") == "UNKNOWN"
    assert repo._group_label({"classification": {}}, "asset_class") == "UNKNOWN"


def test_resolve_builds_full_mapper():
    class A:
        def __init__(self, aid, root): self.asset_id = aid; self.root = root
    assets = [A("ID_RV", {"classification": {"asset_class": "RV"}}),
              A("ID_RF", {"classification": {"asset_class": "RF"}})]
    res = repo._resolve_group_constraints([{"dimension": "asset_class", "upper": {"RV": 0.4}, "lower": {}}], assets)
    assert res[0]["mapper"] == {"ID_RV": "RV", "ID_RF": "RF"}
    assert res[0]["upper"] == {"RV": 0.4}


def test_resolve_none_when_empty():
    assert repo._resolve_group_constraints(None, []) is None


def test_target_group_exposures_all_dims():
    labels = {"asset_class": {"A": "RV", "B": "RF", "C": "RF"}, "currency": {"A": "EUR", "B": "EUR", "C": "USD"}}
    w = {"A": 0.5, "B": 0.3, "C": 0.2}
    exp = repo._target_group_exposures(w, labels)
    assert exp["asset_class"] == {"RV": 0.5, "RF": 0.5}
    assert exp["currency"] == {"EUR": 0.8, "USD": 0.2}
