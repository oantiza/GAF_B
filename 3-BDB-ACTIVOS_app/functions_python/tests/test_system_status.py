import os
import sys


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main  # noqa: E402
import system_status  # noqa: E402


class FakeSnapshot:
    def __init__(self, exists, data=None):
        self.exists = exists
        self._data = data

    def to_dict(self):
        return self._data


class FakeDocument:
    def __init__(self, db, document_id):
        self._db = db
        self._document_id = document_id

    def get(self):
        path = f"meta/{self._document_id}"
        self._db.reads.append(path)
        if self._document_id not in self._db.documents:
            return FakeSnapshot(False)
        return FakeSnapshot(True, self._db.documents[self._document_id])

    def set(self, _payload):
        raise AssertionError("La lectura de estado no puede escribir en Firestore.")


class FakeMetaCollection:
    def __init__(self, db):
        self._db = db

    def document(self, document_id):
        return FakeDocument(self._db, document_id)


class FakeDb:
    def __init__(self, documents=None):
        self.documents = documents or {}
        self.reads = []

    def collection(self, name):
        assert name == "meta"
        return FakeMetaCollection(self)


def test_read_system_status_maps_the_four_meta_documents_without_writes():
    documents = {
        "integrity_status": {"status": "OK", "checked_at": "2026-07-12T08:45:00Z"},
        "backup_status": {"completed_at": "2026-07-12T03:00:00Z"},
        "price_refresh": {"last_run": "2026-07-12T07:30:00Z"},
        "metrics_refresh": {"last_run": "2026-07-12T08:00:00Z", "cycle_completed": True},
    }
    db = FakeDb(documents)

    result = system_status.read_system_status(db=db)

    assert result == {
        "integrity": documents["integrity_status"],
        "backup": documents["backup_status"],
        "prices": documents["price_refresh"],
        "metrics": documents["metrics_refresh"],
    }
    assert db.reads == [
        "meta/integrity_status",
        "meta/backup_status",
        "meta/price_refresh",
        "meta/metrics_refresh",
        "meta/report_status_daily_report",
        "meta/report_status_weekly_report",
    ]


def test_read_system_status_returns_none_only_for_missing_documents():
    db = FakeDb({
        "integrity_status": {},
        "price_refresh": {"last_run": "2026-07-12T07:30:00Z"},
    })

    result = system_status.read_system_status(db=db)

    assert result == {
        "integrity": {},
        "backup": None,
        "prices": {"last_run": "2026-07-12T07:30:00Z"},
        "metrics": None,
    }


def test_get_system_status_callable_applies_admin_gate_that_includes_auth(monkeypatch):
    calls = []
    expected = {"integrity": None, "backup": None, "prices": None, "metrics": None}
    request = object()

    monkeypatch.setattr(main, "_require_admin", lambda req, **limits: calls.append(("admin", req)))
    monkeypatch.setattr(
        main.system_status,
        "read_system_status",
        lambda: calls.append(("read", None)) or expected,
    )

    callable_body = main.get_system_status
    while hasattr(callable_body, "__wrapped__"):
        callable_body = callable_body.__wrapped__
    result = callable_body(request)

    assert result == expected
    assert calls == [("admin", request), ("read", None)]
