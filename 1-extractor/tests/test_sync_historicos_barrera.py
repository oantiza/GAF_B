# -*- coding: utf-8 -*-
"""Decisión 106 (05-11-2026): esta herramienta abre el proyecto de la clave que le pasen, y ninguna
orden lo nombra, así que un barrido por nombre no la veía. Con una clave de BDB se niega antes de
inicializar nada. Sin red y sin firebase-admin: el SDK es de mentira.
"""
import importlib.util
import sys
import types
from pathlib import Path

import pytest

RUTA = Path(__file__).resolve().parents[1] / "tools" / "sync_historicos.py"
BDB = "bbdd-activos-financieros"


def _herramienta(monkeypatch, proyecto_de_la_clave):
    iniciadas = []

    class Certificate:
        def __init__(self, ruta):
            self.ruta = ruta
            self.project_id = proyecto_de_la_clave

    credentials = types.ModuleType("firebase_admin.credentials")
    credentials.Certificate = Certificate
    firestore = types.ModuleType("firebase_admin.firestore")
    firestore.client = lambda: "cliente"
    firebase_admin = types.ModuleType("firebase_admin")
    firebase_admin.credentials = credentials
    firebase_admin.firestore = firestore
    firebase_admin.initialize_app = iniciadas.append
    monkeypatch.setitem(sys.modules, "firebase_admin", firebase_admin)
    monkeypatch.setitem(sys.modules, "firebase_admin.credentials", credentials)
    monkeypatch.setitem(sys.modules, "firebase_admin.firestore", firestore)

    spec = importlib.util.spec_from_file_location("sync_historicos_barrera", RUTA)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo, iniciadas


def test_con_una_clave_de_bdb_se_niega_antes_de_inicializar(monkeypatch):
    modulo, iniciadas = _herramienta(monkeypatch, BDB)
    with pytest.raises(RuntimeError, match="BDB"):
        modulo._conecta("clave-de-mentira.json")
    assert iniciadas == []


def test_la_negativa_no_es_systemexit_porque_app_py_la_leeria_como_falta_firebase_admin(monkeypatch):
    modulo, _ = _herramienta(monkeypatch, BDB)
    try:
        modulo._conecta("clave-de-mentira.json")
    except SystemExit:  # pragma: no cover
        pytest.fail("app.py convierte SystemExit en «Falta firebase-admin»")
    except RuntimeError:
        pass


def test_con_otra_clave_conecta_como_siempre(monkeypatch):
    modulo, iniciadas = _herramienta(monkeypatch, "otro-proyecto")
    assert modulo._conecta("clave-de-mentira.json") == "cliente"
    assert len(iniciadas) == 1
