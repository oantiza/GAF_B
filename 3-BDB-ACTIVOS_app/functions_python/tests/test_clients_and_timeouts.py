# -*- coding: utf-8 -*-
"""MEDIA-7 (auditoria 14-10-2026): sin timeouts globales de socket al importar y sin un
cliente Firestore nuevo en cada llamada."""
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import admin_panel  # noqa: E402
import integrity_check  # noqa: E402
import master_project  # noqa: E402
import master_write_client  # noqa: E402
import metrics_refresh  # noqa: E402
import price_refresh  # noqa: E402
import search_index  # noqa: E402
import system_status  # noqa: E402
import weekly_report  # noqa: E402
from readmodel import firestore_client  # noqa: E402

FUNCTIONS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def test_importing_the_ai_modules_does_not_change_the_process_socket_timeout():
    code = (
        "import socket, analyze_portfolio, weekly_report; "
        "print(socket.getdefaulttimeout())"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=FUNCTIONS_DIR,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-500:]
    assert out.stdout.strip().splitlines()[-1] == "None"


def test_weekly_report_sets_the_timeout_on_the_request(monkeypatch):
    seen = {}

    def fake_post(url, **kwargs):
        seen.update(kwargs)
        response = weekly_report.curl_requests.Response()
        response.status_code = 200
        response.content = b'{"candidates": []}'
        return response

    monkeypatch.setattr(weekly_report.curl_requests, "post", fake_post)
    weekly_report._generate_content("gemini-3.1-pro-preview", "k", "hola", grounded=False, json_output=False)
    assert seen["timeout"] == weekly_report.GEMINI_REQUEST_TIMEOUT_SEC == 150


def test_read_paths_reuse_the_read_model_client(monkeypatch):
    class _Snap:
        exists = False

        def to_dict(self):
            return None

    class _Doc:
        def get(self):
            return _Snap()

    class _Col:
        def document(self, _id):
            return _Doc()

    class _Db:
        def collection(self, _name):
            return _Col()

    shared = _Db()
    calls = []
    monkeypatch.setattr(firestore_client, "get_master_db", lambda: calls.append(1) or shared)
    assert admin_panel._db() is shared
    assert admin_panel._db() is shared
    status = system_status.read_system_status()
    assert set(status) == {"integrity", "backup", "prices", "metrics"}
    assert len(calls) == 3


def test_writers_share_one_client_per_process(monkeypatch):
    created = []

    class _FakeClient:
        def __init__(self, project=None):
            created.append(project)

    monkeypatch.setattr(master_write_client, "_client", None)
    monkeypatch.setattr(master_write_client.gcf, "Client", _FakeClient)
    first = price_refresh._master_db()
    assert search_index._master_db() is first
    assert metrics_refresh._master_db() is first
    assert price_refresh._master_db() is first
    assert master_write_client.get_master_write_db() is first
    assert created == [master_project.master_project_id()]
    # El cliente del lector es otro objeto: no se mezclan.
    monkeypatch.setattr(firestore_client, "_client", None)
    monkeypatch.setattr(firestore_client.gcf, "Client", _FakeClient)
    assert firestore_client.get_master_db() is not first


def test_integrity_check_uses_the_writer_client_by_default(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(master_write_client, "get_master_write_db", lambda: sentinel)
    seen = {}

    def _stop(db, _collection):
        seen["db"] = db
        raise RuntimeError("stop")

    monkeypatch.setattr(integrity_check, "_doc_ids", _stop)
    try:
        integrity_check.run_integrity_check(write=False)
    except RuntimeError:
        pass
    assert seen["db"] is sentinel
