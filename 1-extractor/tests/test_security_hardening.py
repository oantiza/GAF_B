from io import BytesIO

from core.http import cache_key
from fetchers.cnmv import _busca_isins_en_xml


def test_cache_key_remains_deterministic_for_non_security_use():
    first = cache_key("https://example.test/data", {"b": 2, "a": 1})
    second = cache_key("https://example.test/data", {"a": 1, "b": 2})

    assert first == second
    assert len(first) == 40


def test_cnmv_parser_rejects_xml_entities():
    payload = b"""<?xml version="1.0"?>
<!DOCTYPE data [<!ENTITY isin "ES0123456789">]>
<data><fund>&isin;</fund></data>
"""

    assert _busca_isins_en_xml(
        BytesIO(payload), {"ES0123456789"}
    ) == {}
