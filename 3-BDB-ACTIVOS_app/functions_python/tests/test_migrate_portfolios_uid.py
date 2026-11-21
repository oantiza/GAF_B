import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.migrate_portfolios_uid import equivalent_portfolios  # noqa: E402


def test_equivalent_portfolios_ignores_only_owner_uid():
    source = {"name": "Cartera", "positions": [{"id": "A", "weight": 100}], "owner_uid": "old"}
    target = {"name": "Cartera", "positions": [{"id": "A", "weight": 100}], "owner_uid": "new"}
    assert equivalent_portfolios(source, target)


def test_equivalent_portfolios_detects_content_drift():
    source = {"name": "Cartera", "positions": [{"id": "A", "weight": 100}], "owner_uid": "old"}
    target = {"name": "Cartera", "positions": [{"id": "A", "weight": 90}], "owner_uid": "new"}
    assert not equivalent_portfolios(source, target)
