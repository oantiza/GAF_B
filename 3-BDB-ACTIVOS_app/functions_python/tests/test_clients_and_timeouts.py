# -*- coding: utf-8 -*-
"""MEDIA-7 (auditoria 14-10-2026): sin timeouts globales de socket al importar y sin un
cliente Firestore nuevo en cada llamada."""
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

import master_project  # noqa: E402
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


def test_el_lector_abre_un_solo_cliente_por_proceso_y_solo_de_la_base_nueva(monkeypatch):
    created = []

    class _FakeClient:
        def __init__(self, project=None):
            created.append(project)

    monkeypatch.setattr(firestore_client, "_client", None)
    monkeypatch.setattr(firestore_client.gcf, "Client", _FakeClient)
    monkeypatch.setenv(master_project.VARIABLE, master_project.PROYECTO_BASE_NUEVA)
    first = firestore_client.get_master_db()
    assert firestore_client.get_master_db() is first
    assert created == [master_project.PROYECTO_BASE_NUEVA]


def test_con_la_base_vieja_declarada_el_lector_para_nombrandola(monkeypatch):
    """21-11-2026: el codigo de la base vieja se borro. Con su id declarado, el cliente no se abre."""
    monkeypatch.setattr(firestore_client, "_client", None)
    monkeypatch.setattr(firestore_client.gcf, "Client", lambda project=None: pytest.fail("no debe abrir cliente"))
    monkeypatch.setenv(master_project.VARIABLE, master_project.PROYECTO_BASE_DE_SIEMPRE)
    with pytest.raises(master_project.BaseNuevaRequerida) as err:
        firestore_client.get_master_db()
    assert master_project.PROYECTO_BASE_DE_SIEMPRE in str(err.value)
    assert master_project.PROYECTO_BASE_NUEVA in str(err.value)
