# -*- coding: utf-8 -*-
"""ALTA-06 (auditoria 14-10-2026): los scripts operativos de la raiz pasan por la
gobernanza de escritura, toman la divisa del LISTADO y limpian el buscador.

scripts/delete_asset.py, scripts/reload_from_eodhd.py y
scripts/load_missing_price_series.py escribian en la maestra solo con `--write`, sin
el gate de write_governance; tomaban la divisa origen de `asset.currency` (la de la
clase del fondo, no la de la cotizacion) con EUR por defecto; y delete_asset dejaba la
entrada en meta/search_index.
"""
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import master_project  # noqa: E402
import search_index  # noqa: E402
import write_governance  # noqa: E402
from tests.test_history_backfill_metrics import _Db  # noqa: E402

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def _load(name):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / ("%s.py" % name))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def no_gates(monkeypatch):
    monkeypatch.delenv(write_governance.MASTER_WRITE_ENV, raising=False)
    monkeypatch.delenv(search_index.SEARCH_INDEX_WRITE_ENV, raising=False)


def _forbidden_db():
    raise AssertionError("sin gate no se abre la maestra")


# --------------------------------------------------------------------------- gates

def test_load_missing_price_series_requires_the_gate_before_touching_firestore(monkeypatch, no_gates):
    lmps = _load("load_missing_price_series")
    monkeypatch.setattr(lmps, "_load_environment", lambda: None)
    monkeypatch.setattr(lmps, "_db", _forbidden_db)
    monkeypatch.setattr(sys, "argv", ["load_missing_price_series.py", "--write"])
    with pytest.raises(write_governance.MasterWritesDisabledError):
        lmps.main()


def test_reload_from_eodhd_requires_the_gate_before_touching_firestore(monkeypatch, no_gates):
    reload_mod = _load("reload_from_eodhd")
    lmps = _load("load_missing_price_series")
    monkeypatch.setattr(lmps, "_load_environment", lambda: None)
    monkeypatch.setattr(lmps, "_db", _forbidden_db)
    monkeypatch.setattr(reload_mod, "WRITE", True)
    with pytest.raises(write_governance.MasterWritesDisabledError):
        reload_mod.main()


def test_delete_asset_requires_both_gates_before_touching_firestore(monkeypatch, no_gates):
    delete_asset = _load("delete_asset")
    monkeypatch.setattr(delete_asset, "_db", _forbidden_db)
    with pytest.raises(write_governance.MasterWritesDisabledError):
        delete_asset.main(["IE00B5BMR087", "--write"])
    monkeypatch.setenv(write_governance.MASTER_WRITE_ENV, write_governance.MASTER_WRITE_CONFIRMATION)
    with pytest.raises(RuntimeError, match="SEARCH_INDEX_WRITES_DISABLED"):
        delete_asset.main(["IE00B5BMR087", "--write"])


def test_extend_history_requires_the_gate_before_touching_firestore(monkeypatch, no_gates):
    """Decision 106: lo recorria todo sin pedir nada. Y el .env no se carga antes del gate."""
    extend = _load("extend_history_to_15y")
    lmps = _load("load_missing_price_series")
    monkeypatch.setattr(lmps, "_load_environment", _forbidden_db)
    monkeypatch.setattr(lmps, "_db", _forbidden_db)
    monkeypatch.setattr(extend, "WRITE", True)
    with pytest.raises(write_governance.MasterWritesDisabledError):
        extend.main()


def test_repair_price_series_requires_the_gate_before_touching_firestore(monkeypatch, no_gates):
    """Decision 106: --fix-mixed-currency --write borraba documentos sin pedir nada."""
    repair = _load("repair_price_series")
    monkeypatch.setattr(repair, "_db", _forbidden_db)
    monkeypatch.setattr(sys, "argv", ["repair_price_series.py", "--fix-mixed-currency", "--write"])
    with pytest.raises(write_governance.MasterWritesDisabledError):
        repair.main()


def test_improve_fund_data_pide_el_gate_al_aplicar_antes_de_abrir_nada(tmp_path):
    """Decision 106: su seguro era el hash del plan, sin el gate de los demas."""
    entorno = {k: v for k, v in os.environ.items() if k != write_governance.MASTER_WRITE_ENV}
    resultado = subprocess.run(
        [sys.executable, str(SCRIPTS.parent / "functions_python" / "scripts" / "improve_fund_data.py"),
         "--output", str(tmp_path), "--apply-sha256", "abc"],
        env=entorno, capture_output=True, text=True, timeout=120,
    )
    assert resultado.returncode != 0
    assert write_governance.MASTER_WRITES_DISABLED_CODE in resultado.stderr


class _SinActivos:
    """Un Firestore sin ningun activo: lo justo para una pasada en seco."""

    def collection(self, _nombre):
        return self

    def stream(self):
        return []


def test_sin_write_repair_price_series_no_pide_gate_ni_borra(monkeypatch, no_gates, capsys):
    repair = _load("repair_price_series")
    monkeypatch.setattr(repair, "_db", _SinActivos)
    monkeypatch.setattr(sys, "argv", ["repair_price_series.py", "--fix-mixed-currency"])
    repair.main()
    salida = capsys.readouterr().out
    assert '"dry_run": true' in salida and '"cleanup_candidates": []' in salida


def test_sin_write_extend_history_no_pide_gate(monkeypatch, no_gates, capsys):
    extend = _load("extend_history_to_15y")
    lmps = _load("load_missing_price_series")
    monkeypatch.setattr(lmps, "_load_environment", lambda: None)
    monkeypatch.setattr(lmps, "_db", _SinActivos)
    monkeypatch.setattr(extend, "WRITE", False)
    extend.main()
    salida = capsys.readouterr().out
    assert '"dry_run": true' in salida and "DRY-RUN" in salida


# --------------------------------------------------------------------------- el proyecto (decision 106)

BDB = master_project.PROYECTO_DE_BDB


@pytest.mark.parametrize("nombre", ["load_missing_price_series", "repair_price_series", "delete_asset"])
def test_los_que_escriben_abren_el_proyecto_de_la_constante_y_nunca_el_de_bdb(monkeypatch, nombre):
    import firebase_admin
    from firebase_admin import firestore

    modulo = _load(nombre)
    llamadas = []
    monkeypatch.setattr(firebase_admin, "_apps", {})
    monkeypatch.setattr(firebase_admin, "initialize_app", lambda **kw: llamadas.append(kw))
    monkeypatch.setattr(firestore, "client", lambda: "cliente")
    if hasattr(modulo, "_load_env_file"):
        monkeypatch.setattr(modulo, "_load_env_file", lambda _ruta: None)

    for proyecto in ("gestor-activos-local", "bdb-gestor-de-activos"):
        llamadas.clear()
        monkeypatch.setenv("MASTER_PROJECT_ID", proyecto)
        assert modulo._db() == "cliente"
        assert llamadas == [{"options": {"projectId": proyecto}}]

    llamadas.clear()
    monkeypatch.setenv("MASTER_PROJECT_ID", BDB)
    with pytest.raises(RuntimeError, match="BDB"):
        modulo._db()
    assert llamadas == []


def test_los_dos_que_lo_heredan_pasan_por_el_mismo_cliente():
    """extend_history y reload_from_eodhd no nombran el proyecto: lo reciben de aqui."""
    lmps = _load("load_missing_price_series")
    assert _load("extend_history_to_15y").L._db is lmps._db
    assert _load("reload_from_eodhd").L._db is lmps._db


@pytest.mark.parametrize("nombre,argumentos", [
    ("plan_capitalgroup_refresh", ["--output", "{tmp}/salida"]),
    ("plan_price_history_repair", ["--assets", "IE00B4L5Y983", "--out", "{tmp}/salida"]),
    ("verify_price_currency", ["--out", "{tmp}/salida.json"]),
])
def test_los_que_leen_no_abren_bdb_aunque_se_declare(monkeypatch, tmp_path, nombre, argumentos):
    from google.cloud import firestore

    modulo = _load(nombre)
    monkeypatch.setattr(firestore, "Client", lambda **_kw: pytest.fail("no se abre ningun cliente"))
    monkeypatch.setenv("MASTER_PROJECT_ID", BDB)
    argv = [a.replace("{tmp}", tmp_path.as_posix()) for a in argumentos]
    monkeypatch.setattr(sys, "argv", ["%s.py" % nombre] + argv)
    with pytest.raises(RuntimeError, match="BDB"):
        modulo.main()


def test_verify_price_currency_no_pide_la_clave_al_secret_manager_de_bdb(monkeypatch):
    modulo = _load("verify_price_currency")
    monkeypatch.delenv("EODHD_API_KEY", raising=False)
    monkeypatch.setitem(modulo._TOKEN_CACHE, "valor", "")
    monkeypatch.setenv("SECRET_PROJECT_ID", BDB)
    with pytest.raises(RuntimeError, match="SECRET_PROJECT_ID"):
        modulo._token()


def test_verify_price_currency_ya_no_lee_el_env_de_bdb():
    fuente = (SCRIPTS / "verify_price_currency.py").read_text(encoding="utf-8")
    assert ".env.%s" % BDB not in fuente


def test_set_admin_se_niega_con_el_proyecto_de_bdb_antes_de_mirar_credenciales():
    """Con la puerta abierta y el proyecto de BDB: no llega ni a preguntar por ADC."""
    entorno = dict(os.environ)
    entorno[write_governance.MASTER_WRITE_ENV] = write_governance.MASTER_WRITE_CONFIRMATION
    resultado = subprocess.run(
        [sys.executable, str(SCRIPTS / "set_admin.py"), "nadie@example.com", "--project", BDB],
        env=entorno, capture_output=True, text=True, timeout=120,
    )
    assert resultado.returncode == 2
    assert "proyecto de BDB" in resultado.stdout


# --------------------------------------------------------------------------- divisa del listado

def _eodhd(currency_by_path):
    def _get(path, **params):
        for prefix, value in currency_by_path.items():
            if path.startswith(prefix):
                return value
        return []
    return _get


def test_load_missing_price_series_uses_the_listing_currency_not_the_root(monkeypatch):
    lmps = _load("load_missing_price_series")
    lmps._LISTING_CURRENCY.clear()
    store = {"assets/IE00B4ND3602": {"asset_id": "IE00B4ND3602", "currency": "USD",
                                     "identifiers": {"isin": "IE00B4ND3602"}}}
    monkeypatch.setattr(lmps, "resolve_symbol", lambda *a: lmps.ResolvedSymbol(
        symbol="NUKL.XETRA", currency="USD", source="search"))
    # El listado de Xetra cotiza en EUR aunque la ficha diga USD: no se convierte.
    monkeypatch.setattr(lmps, "_eodhd_get", _eodhd({"fundamentals/": "EUR"}))
    monkeypatch.setattr(lmps, "fetch_eod_points", lambda *a: [
        {"date": "2026-01-02", "adjusted_close": 10.0}, {"date": "2026-01-05", "adjusted_close": 11.0}])

    def _no_fx(*_a):
        raise AssertionError("una cotizacion en euros no se convierte")

    monkeypatch.setattr(lmps, "fetch_fx_rates", _no_fx)
    summary = lmps.process_asset(_Db(store), {"asset_id": "IE00B4ND3602", "type": "ETF"}, {}, False, Path("."))
    assert summary["source_currency"] == "EUR"
    assert summary["currency_metadata"] == "USD"
    assert summary["currency_mismatch"] is True
    assert summary["metrics_latest"]["status"] == "WOULD_CREATE"


def test_load_missing_price_series_never_assumes_eur(monkeypatch):
    lmps = _load("load_missing_price_series")
    lmps._LISTING_CURRENCY.clear()
    store = {"assets/LU0000000001": {"asset_id": "LU0000000001", "currency": "EUR"}}
    monkeypatch.setattr(lmps, "resolve_symbol", lambda *a: lmps.ResolvedSymbol(
        symbol="LU0000000001.EUFUND", currency="EUR", source="search"))
    monkeypatch.setattr(lmps, "_eodhd_get", _eodhd({"fundamentals/": "NA", "search/": []}))
    with pytest.raises(RuntimeError, match="No se asume EUR"):
        lmps.process_asset(_Db(store), {"asset_id": "LU0000000001", "type": "FUND"}, {}, False, Path("."))


def test_reload_from_eodhd_takes_the_listing_currency(monkeypatch):
    reload_mod = _load("reload_from_eodhd")
    lmps = _load("load_missing_price_series")
    lmps._LISTING_CURRENCY.clear()
    monkeypatch.setattr(lmps, "_eodhd_get", _eodhd({
        "fundamentals/": "NA",
        "search/": [{"Code": "LU0000000002", "Exchange": "EUFUND", "Currency": "USD"}],
    }))
    assert reload_mod.source_currency_for("LU0000000002.EUFUND") == ("USD", None)
    lmps._LISTING_CURRENCY.clear()
    monkeypatch.setattr(lmps, "_eodhd_get", _eodhd({"fundamentals/": "NA", "search/": []}))
    divisa, motivo = reload_mod.source_currency_for("LU0000000003.EUFUND")
    assert divisa is None and motivo == "DIVISA_NO_VALIDA"


# --------------------------------------------------------------------------- buscador

def test_search_index_without_removes_only_that_entry():
    current = {"schema_version": "master.search-index.v1", "count": 2, "entries": [
        {"id": "A", "name": "A", "name_folded": "a", "type": "FUND"},
        {"id": "B", "name": "B", "name_folded": "b", "type": "ETF"},
    ]}
    payload = search_index.search_index_without(current, "A", "2026-10-14T08:00:00.000Z")
    assert [e["id"] for e in payload["entries"]] == ["B"]
    assert payload["count"] == 1
    assert search_index.search_index_without(current, "ZZZ", "2026-10-14T08:00:00.000Z") is None


def test_delete_asset_removes_the_search_index_entry_after_archiving(monkeypatch, tmp_path):
    delete_asset = _load("delete_asset")
    calls = []

    class _Ref:
        def __init__(self, path):
            self.path, self.id = path, path.rsplit("/", 1)[-1]

        def get(self):
            class _S:
                exists = True

                def to_dict(self_inner):
                    return {"asset_id": "X"}
            return _S()

        def collections(self):
            return []

        def collection(self, name):
            return _Col("%s/%s" % (self.path, name))

        def set(self, data):
            calls.append(("set", self.path))

        def delete(self):
            calls.append(("delete", self.path))

    class _Col:
        def __init__(self, path):
            self.path = path

        def document(self, doc_id):
            return _Ref("%s/%s" % (self.path, doc_id))

    class _FakeDb:
        def collection(self, name):
            return _Col(name)

    monkeypatch.setattr(delete_asset, "remove_from_search_index",
                        lambda db, aid: calls.append(("search_index", aid)) or "RETIRADO")
    changed = delete_asset.process(_FakeDb(), ["IE00B5BMR087"], True, False, backup_dir=tmp_path)
    assert changed == 1
    assert calls == [("set", "_archived/IE00B5BMR087"), ("delete", "assets/IE00B5BMR087"),
                     ("search_index", "IE00B5BMR087")]
    assert list(tmp_path.glob("deleted-IE00B5BMR087-*.json")), "backup antes de tocar nada"


@pytest.mark.parametrize("guion", ["migrate_portfolios_uid", "migrate_ownership_v12", "migrate_provisional_roots"])
def test_las_migraciones_piden_el_cerrojo_general_antes_de_abrir_el_cliente(guion):
    """Hallazgo 31: solo pedian una frase escrita en su propia ayuda."""
    entorno = {k: v for k, v in os.environ.items() if k != write_governance.MASTER_WRITE_ENV}
    resultado = subprocess.run(
        [sys.executable, str(SCRIPTS.parent / "functions_python" / "scripts" / ("%s.py" % guion)), "--write", "--approval", "YES_I_UNDERSTAND_MASTER_DB_WRITES"],
        env=entorno, capture_output=True, text=True, timeout=120,
    )
    assert resultado.returncode != 0
    assert write_governance.MASTER_WRITES_DISABLED_CODE in resultado.stderr
