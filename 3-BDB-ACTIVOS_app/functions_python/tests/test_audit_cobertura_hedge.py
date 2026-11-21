# -*- coding: utf-8 -*-
"""Ronda 2 (14-10-2026): scripts/audit_cobertura_equivalencia.py infiere la cobertura de
divisa con la misma expresion que src/core/fundEquivalence.ts (mismos casos que
tests/fundEquivalence.test.ts)."""
import importlib.util
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[1] / "scripts" / "audit_cobertura_equivalencia.py"
_spec = importlib.util.spec_from_file_location("audit_cobertura_equivalencia", _PATH)
audit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit)


@pytest.mark.parametrize("name", [
    "Fidelity Funds World A Acc EUR Hedged",
    "BlackRock GF World Technology A2 EURH",
    "Nordea 1 Global Climate BP USDH",
    "Natixis Loomis Sayles US Growth H-EUR Acc",
    "Robeco Global Credits IH EUR-H",
    "JPM Global Bond A (acc) - EUR (hedged)",
    "Invesco Pan European A (EUR Hgd) Acc",
    "Fondo Renta Fija USD clase cubierta",
    "Man GLG Japan CoreAlpha Equity D H EUR",
    "Global Evolution Frontier Markets R EUR H",
    "M&G (Lux) Optimal Income Fund EUR A-H Acc",
    "Schroder ISF Global Gold A Accumulation PLN Hedged",
])
def test_clear_hedge_signals(name):
    assert audit.infer_hedged(name) is True


@pytest.mark.parametrize("name, expected", [
    ("Vanguard Global Bond Index Unhedged EUR", False),
    ("Fondo Global clase no cubierta", False),
    ("Pictet Global Megatrend H Acc", None),
    ("Carmignac Patrimoine Class H EUR", None),
    ("iShares Euro Govt Bond Interest Rate Hedged", None),
    ("PIMCO Euro Duration Hedged Income", None),
    ("Value B&H Fund", None),
    ("Fidelity Funds World A Acc EUR", None),
    ("USD High Yield Bond A Acc", None),
    ("", None),
])
def test_no_hedge_or_unhedged(name, expected):
    assert audit.infer_hedged(name) is expected


def test_family_key_drops_hedged_currency_tokens_like_the_frontend():
    assert audit.family_key("BlackRock GF World Gold A2 EURH") == audit.family_key("BlackRock GF World Gold A2 USD")
    assert audit.family_key("Schroder ISF Global Gold A Acc PLN Hedged") == "schroder isf global gold"
    assert audit.family_key("Invesco Pan European A (EUR Hgd) Acc") == "invesco pan european"
