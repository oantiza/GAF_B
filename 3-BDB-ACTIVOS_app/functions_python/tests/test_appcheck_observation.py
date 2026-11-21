# -*- coding: utf-8 -*-
"""
C1 (auditoría 29-09): observación de App Check.

- `_require_auth` emite una línea JSON `app_check_observation` por llamada,
  con `present`/`missing`, origen, user-agent truncado y hash del uid (nunca
  el uid ni el correo en claro), y sigue sin rechazar cuando falta el token.
- `scripts/appcheck_report.py`: la agregación es pura y se prueba con un JSON
  simulado, sin llamar a gcloud.

Run: `python -m pytest functions_python/tests/test_appcheck_observation.py -q`
"""
import hashlib
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import main  # noqa: E402
import appcheck_report  # noqa: E402
import master_project  # noqa: E402


class FakeAuth:
    def __init__(self, uid="user-1", token=None):
        self.uid = uid
        self.token = {"email_verified": True, "email": "oscar@example.com"} if token is None else token


class FakeRaw:
    def __init__(self, headers=None, path="/"):
        self.headers = headers or {}
        self.path = path


class FakeReq:
    def __init__(self, auth=None, app=None, data=None, raw_request=None):
        self.auth = auth
        self.app = app
        self.data = data or {}
        if raw_request is not None:
            self.raw_request = raw_request


@pytest.fixture(autouse=True)
def _entorno(monkeypatch):
    monkeypatch.setattr(main, "EMAIL_VERIFIED_REQUIRED", True)
    monkeypatch.delenv("K_SERVICE", raising=False)
    yield


def _observations(capsys):
    out = capsys.readouterr().out
    lines = []
    for raw in out.splitlines():
        raw = raw.strip()
        if not raw.startswith("{"):
            continue
        entry = json.loads(raw)
        if entry.get("message") == main.APPCHECK_OBSERVATION_MESSAGE:
            lines.append(entry)
    return lines


# --- emisión desde _require_auth ------------------------------------------

def test_sin_token_emite_missing_y_no_rechaza(capsys, caplog):
    raw = FakeRaw(headers={"Origin": "http://localhost:5173",
                           "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/128"})
    req = FakeReq(auth=FakeAuth(uid="uid-secreto"), app=None, raw_request=raw)
    with caplog.at_level("WARNING"):
        assert main._require_auth(req, operation="get_asset_detail") == "uid-secreto"
    obs = _observations(capsys)
    assert len(obs) == 1
    entry = obs[0]
    assert entry["severity"] == "INFO"
    assert entry["app_check"] == "missing"
    assert entry["operation"] == "get_asset_detail"
    assert entry["origin"] == "http://localhost:5173"
    assert entry["client"] == "browser"
    assert entry["user_agent"].startswith("Mozilla/5.0")
    assert entry["uid_hash"] == hashlib.sha256(b"uid-secreto").hexdigest()[:12]
    # El warning ya documentado se conserva.
    assert any(r.getMessage() == "app_check_token_missing" for r in caplog.records)


def test_con_token_emite_present(capsys):
    raw = FakeRaw(headers={"Origin": "https://bdb-gestor-de-activos.web.app",
                           "User-Agent": "Mozilla/5.0"})
    req = FakeReq(auth=FakeAuth(uid="u1"), app=object(), raw_request=raw)
    main._require_auth(req, operation="list_portfolios")
    entry = _observations(capsys)[0]
    assert entry["app_check"] == "present"
    assert entry["origin"] == "https://bdb-gestor-de-activos.web.app"


def test_nunca_uid_ni_correo_en_claro(capsys):
    req = FakeReq(auth=FakeAuth(uid="uid-muy-secreto"), app=None,
                  raw_request=FakeRaw(headers={"User-Agent": "python-requests/2.31"}))
    main._require_auth(req, operation="search_assets")
    out = capsys.readouterr().out
    assert "uid-muy-secreto" not in out
    assert "oscar@example.com" not in out
    entry = json.loads([l for l in out.splitlines() if "app_check_observation" in l][0])
    assert len(entry["uid_hash"]) == 12
    assert entry["client"] == "script"
    assert entry["origin"] == "-"


def test_user_agent_truncado_a_80():
    ua = "Mozilla/5.0 " + "x" * 200
    req = FakeReq(auth=FakeAuth(), app=None, raw_request=FakeRaw(headers={"User-Agent": ua}))
    entry = main._observe_app_check(req, "u", "op")
    assert len(entry["user_agent"]) == 80
    assert entry["client"] == "browser"


def test_sin_raw_request_ni_user_agent(capsys):
    """Los tests existentes usan un FakeReq sin raw_request: no debe romper."""
    req = FakeReq(auth=FakeAuth(uid="u9"), app=None)
    assert main._require_auth(req) == "u9"
    entry = _observations(capsys)[0]
    assert entry["origin"] == "-"
    assert entry["user_agent"] == "-"
    assert entry["client"] == "unknown"
    assert entry["operation"] == "-"


def test_operation_derivada_de_k_service(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "admin-db-status")
    req = FakeReq(auth=FakeAuth(), app=None)
    assert main._observe_app_check(req, "u", None)["operation"] == "admin_db_status"


def test_operation_derivada_del_path(monkeypatch):
    req = FakeReq(auth=FakeAuth(), app=None, raw_request=FakeRaw(path="/get-system-status"))
    assert main._observe_app_check(req, "u", None)["operation"] == "get_system_status"


def test_require_admin_tambien_observa(capsys):
    req = FakeReq(auth=FakeAuth(uid="jefe", token={"email_verified": True, "admin": True}), app=None)
    assert main._require_admin(req) == "jefe"
    assert _observations(capsys)[0]["app_check"] == "missing"


def test_fallo_del_logger_no_rechaza(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("stdout roto")
    monkeypatch.setattr(main.fb_logger, "info", boom)
    req = FakeReq(auth=FakeAuth(uid="u7"), app=None)
    assert main._require_auth(req, operation="x") == "u7"


# --- agregación del script -------------------------------------------------

def _entry(app_check, operation, origin, client, ts="2026-09-30T04:30:00Z"):
    return {
        "timestamp": ts,
        "severity": "INFO",
        "jsonPayload": {
            "message": "app_check_observation",
            "app_check": app_check,
            "operation": operation,
            "origin": origin,
            "user_agent": "Mozilla/5.0" if client == "browser" else "curl/8",
            "client": client,
            "uid_hash": "abc123abc123",
        },
    }


PROD = "https://bdb-gestor-de-activos.web.app"


def test_aggregate_activable_cuando_produccion_100_con_token():
    entries = [
        _entry("present", "get_asset_detail", PROD, "browser", "2026-09-28T10:00:00Z"),
        _entry("present", "list_portfolios", PROD, "browser", "2026-09-29T10:00:00Z"),
        _entry("missing", "get_asset_detail", "http://localhost:5173", "browser"),
        _entry("missing", "get_system_status", "-", "script"),
        {"textPayload": "ruido que no es observación"},
        _entry("present", "list_portfolios", PROD, "browser"),
    ]
    s = appcheck_report.aggregate(entries)
    assert s["entries_total"] == 6
    assert (s["total"], s["present"], s["missing"]) == (5, 3, 2)
    assert s["missing_pct"] == 40.0
    assert s["first_timestamp"] == "2026-09-28T10:00:00Z"
    assert s["verdict"] == "Activable"
    assert s["production"] == {"origins": list(appcheck_report.PRODUCTION_ORIGINS), "total": 3, "missing": 0}
    ops = {r["key"]: r for r in s["by_operation"]}
    assert ops["get_asset_detail"]["missing"] == 1 and ops["get_asset_detail"]["total"] == 2
    assert ops["list_portfolios"]["missing"] == 0
    assert s["by_operation"][0]["key"] in ("get_asset_detail", "list_portfolios")  # orden por total desc
    assert {c["key"]: c["missing"] for c in s["by_client"]} == {"browser": 1, "script": 1}
    assert s["missing_combos"] == [
        {"origin": "-", "operation": "get_system_status", "client": "script", "count": 1},
        {"origin": "http://localhost:5173", "operation": "get_asset_detail", "client": "browser", "count": 1},
    ]
    assert s["would_break"] == [
        {"origin": "-", "client": "script"},
        {"origin": "http://localhost:5173", "client": "browser"},
    ]


def test_aggregate_no_activable_si_produccion_sin_token():
    entries = [
        _entry("present", "get_asset_detail", PROD, "browser"),
        _entry("missing", "get_asset_detail", "https://bdb-gestor-de-activos.firebaseapp.com", "browser"),
    ]
    s = appcheck_report.aggregate(entries)
    assert s["verdict"] == "No activable"
    assert s["production"]["total"] == 2 and s["production"]["missing"] == 1
    assert "50.0 %" in s["verdict_reason"]


def test_aggregate_sin_datos_de_produccion():
    s = appcheck_report.aggregate([_entry("missing", "x", "http://localhost:5173", "browser")])
    assert s["verdict"] == "Sin datos de producción"
    s_vacio = appcheck_report.aggregate([])
    assert s_vacio["total"] == 0 and s_vacio["missing_pct"] == 0.0


def test_render_text_en_castellano():
    s = appcheck_report.aggregate([
        _entry("present", "list_portfolios", PROD, "browser"),
        _entry("missing", "get_asset_detail", "http://localhost:5173", "browser"),
    ])
    txt = appcheck_report.render_text(s, days=7)
    assert "últimos 7 días" in txt
    assert "Por operación" in txt and "Por origen" in txt and "Por cliente" in txt
    assert "Veredicto: Activable" in txt
    assert "http://localhost:5173 (cliente: browser)" in txt


def test_main_con_input_sin_gcloud(tmp_path, capsys, monkeypatch):
    def no_gcloud(*a, **k):
        raise AssertionError("no debe invocarse gcloud con --input")
    monkeypatch.setattr(appcheck_report.subprocess, "run", no_gcloud)
    f = tmp_path / "entradas.json"
    f.write_text(json.dumps([_entry("present", "list_portfolios", PROD, "browser")]), encoding="utf-8")
    assert appcheck_report.main(["--input", str(f), "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["verdict"] == "Activable"


def test_gcloud_command_sin_espacios_en_el_filtro(monkeypatch):
    monkeypatch.setattr(appcheck_report.shutil, "which", lambda name: "C:\\gcloud\\gcloud.cmd")
    cmd = appcheck_report.gcloud_command("bdb-gestor-de-activos", 7, 20000)
    assert cmd[0].endswith("gcloud.cmd")
    assert cmd[1:3] == ["logging", "read"]
    assert " " not in cmd[3] and '"' not in cmd[3]
    assert "--freshness" in cmd and cmd[cmd.index("--freshness") + 1] == "7d"


def test_el_informe_no_mira_los_registros_de_bdb_aunque_se_le_pida(monkeypatch):
    """Decision 106: `--project` pasa por la misma comprobacion que el id de la maestra."""
    monkeypatch.setattr(appcheck_report, "fetch_entries", lambda *a: pytest.fail("no se llama a gcloud"))
    with pytest.raises(RuntimeError, match="--project"):
        appcheck_report.main(["--project", master_project.PROYECTO_DE_BDB])


def test_los_origenes_de_produccion_son_los_de_este_proyecto():
    assert appcheck_report.PRODUCTION_ORIGINS == (
        "https://bdb-gestor-de-activos.web.app",
        "https://bdb-gestor-de-activos.firebaseapp.com",
    )
