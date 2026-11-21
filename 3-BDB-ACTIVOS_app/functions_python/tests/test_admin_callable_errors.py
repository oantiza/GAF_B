# -*- coding: utf-8 -*-
"""MEDIA-6 (auditoria 14-10-2026): errores del que llama y gates cerrados no salen
como 500 INTERNAL en las callables de administracion."""
import inspect
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import admin_panel  # noqa: E402
import main  # noqa: E402
import search_index  # noqa: E402
from firebase_functions import https_fn  # noqa: E402


class _Req:
    def __init__(self, data=None):
        self.auth = None
        self.app = None
        self.data = data or {}


@pytest.fixture(autouse=True)
def admin(monkeypatch):
    monkeypatch.setattr(main, "_require_admin", lambda req, **limits: "jefe")


def _call(callable_fn, data):
    # inspect.unwrap atraviesa flask_cors y el envoltorio HTTP de firebase_functions.
    return inspect.unwrap(callable_fn)(_Req(data))


def test_fund_quality_with_an_invalid_isin_is_invalid_argument(monkeypatch):
    def _no_db():
        raise AssertionError("un ISIN invalido no llega a Firestore")

    monkeypatch.setattr(admin_panel, "_db", _no_db)
    with pytest.raises(https_fn.HttpsError) as err:
        _call(main.admin_fund_quality, {"isin": "no-es-un-isin"})
    assert err.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT
    with pytest.raises(https_fn.HttpsError) as err:
        _call(main.admin_fund_quality, {"isin": 12345})
    assert err.value.code == https_fn.FunctionsErrorCode.INVALID_ARGUMENT


def test_fund_quality_with_a_valid_isin_still_answers(monkeypatch):
    monkeypatch.setattr(admin_panel, "fund_quality", lambda isin: {"profile": None, "isin": isin})
    assert _call(main.admin_fund_quality, {"isin": "LU0000000001"}) == {"profile": None, "isin": "LU0000000001"}


def test_reconcile_search_index_with_its_gate_closed_is_failed_precondition(monkeypatch):
    monkeypatch.setenv(main.MASTER_WRITE_ENV, "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    monkeypatch.delenv(search_index.SEARCH_INDEX_WRITE_ENV, raising=False)
    with pytest.raises(https_fn.HttpsError) as err:
        _call(main.admin_reconcile_search_index, {"write": True})
    assert err.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION
    assert "SEARCH_INDEX_WRITES_DISABLED" in str(err.value.message)


def test_reconcile_search_index_with_master_gate_closed_is_failed_precondition(monkeypatch):
    monkeypatch.delenv(main.MASTER_WRITE_ENV, raising=False)
    with pytest.raises(https_fn.HttpsError) as err:
        _call(main.admin_reconcile_search_index, {"write": True})
    assert err.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION


def test_search_index_gate_error_stays_a_runtime_error():
    assert issubclass(search_index.SearchIndexWritesDisabledError, RuntimeError)
