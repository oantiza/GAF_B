# -*- coding: utf-8 -*-
"""Ronda 2 (14-10-2026, ALTA-07): aviso cuando un meta/* agregado pasa de 800 KiB."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import integrity_check  # noqa: E402
import meta_size  # noqa: E402
import search_index  # noqa: E402
from tests.test_integrity_check import NOW, _healthy_db  # noqa: E402
from tests import test_search_index as si_fakes  # noqa: E402


def _big_entries(n=9000):
    # ~100 bytes por entrada -> ~900 KiB
    return [{"id": "ES%010d" % i, "name": "Fondo de prueba numero %06d con nombre largo" % i,
             "name_folded": "fondo de prueba numero %06d con nombre largo" % i, "type": "FUND"}
            for i in range(n)]


def test_document_size_follows_the_firestore_rules():
    assert meta_size.document_size("meta/x", {}) == (5 + 2) + 16 + 32
    assert meta_size._value_size({"a": "bc", "n": 1.5, "b": True, "z": None, "l": [1, 2]}) == (
        (2 + 3) + (2 + 8) + (2 + 1) + (2 + 1) + (2 + 16))


def test_small_documents_do_not_warn_and_large_ones_do(capsys):
    assert meta_size.size_warning("search_index", {"entries": _big_entries(10)}) is None
    assert meta_size.size_warning("search_index", None) is None
    warning = meta_size.size_warning("search_index", {"entries": _big_entries()})
    assert warning["severity"] == "WARN" and warning["check"] == "meta_document_size"
    assert "meta/search_index" in warning["detail"] and "800 KiB" in warning["detail"]
    assert "WARNING meta_document_size" in capsys.readouterr().out


def test_integrity_check_shows_the_size_warning():
    db = _healthy_db()
    entries = _big_entries()
    db.docs["meta/search_index"] = {"entries": entries}
    db.collections["assets"] = [e["id"] for e in entries]
    db.docs["meta/fund_data_quality"] = {"rows": [{"isin": "LU%010d" % i, "flags": ["A" * 90]} for i in range(9000)]}
    result = integrity_check.run_integrity_check(db=db, now=NOW)
    sizes = [p for p in result["problems"] if p["check"] == "meta_document_size"]
    assert {("meta/search_index" in p["detail"], "meta/fund_data_quality" in p["detail"]) for p in sizes} == {
        (True, False), (False, True)}
    assert result["status"] == "WARN"


def test_integrity_check_without_large_documents_stays_ok():
    result = integrity_check.run_integrity_check(db=_healthy_db(), now=NOW)
    assert result["status"] == "OK"
    assert not any(p["check"] == "meta_document_size" for p in result["problems"])


def test_a_failing_size_read_still_publishes_the_integrity_status(monkeypatch):
    """Revision de la ronda 2: como B-07, si falla una lectura al medir meta/*, el
    semaforo se publica igual, degradado a WARN con el motivo."""
    import admin_panel
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES", "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    monkeypatch.setenv("INTEGRITY_WRITE_ENABLED", "true")
    monkeypatch.setattr(admin_panel, "build_admin_inventory", lambda db, today, source_versions=None: {
        "schema_version": "admin-asset-inventory.v1", "generated_at": "2026-07-11T09:00:00+00:00",
        "count": 2, "rows": [], "source_versions": source_versions or {}})
    original = integrity_check._meta_doc

    def flaky(db, name):
        if name == "fund_data_quality":
            raise RuntimeError("503 Deadline Exceeded")
        return original(db, name)

    monkeypatch.setattr(integrity_check, "_meta_doc", flaky)
    db = _healthy_db()
    result = integrity_check.run_integrity_check(write=True, db=db, now=NOW)
    published = db.written["meta/integrity_status"]
    assert published["status"] == "WARN"
    assert any(p["check"] == "meta_document_size" and "503 Deadline Exceeded" in p["detail"]
               for p in published["problems"])
    assert result["status"] == "WARN"


def test_reconcile_reports_the_size_warning_without_changing_the_index(monkeypatch):
    roots = {"ES%010d" % i: si_fakes._root("Fondo de prueba numero %06d con nombre bastante largo" % i)
             for i in range(9000)}
    db = si_fakes.FakeDb(roots, {})
    monkeypatch.setattr(search_index, "require_master_writes_enabled", lambda _operation: None)
    monkeypatch.setattr(search_index, "require_search_index_writes_enabled", lambda _operation: None)
    result = search_index.reconcile_search_index(write=True, db=db)
    assert result["applied"] is True
    assert "meta/search_index" in result["size_warning"]
    assert set(db.index) == {"schema_version", "updated_at", "count", "entries"}, "misma estructura"
