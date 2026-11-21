# -*- coding: utf-8 -*-
"""
Ola A3 (A3.2): tests de los guardas _require_auth y _require_admin.

Son la única puerta de las 40 callables: cada rama (sin sesión, email sin
verificar, rate limit, claim admin; la allowlist ADMIN_UIDS se retiró en S-08) queda fijada aquí.

Run: `python -m pytest functions_python/tests/test_auth_gates.py -q`
"""
import inspect
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main  # noqa: E402
from firebase_functions import https_fn  # noqa: E402
from rate_limit import RateLimitExceeded  # noqa: E402


class FakeAuth:
    def __init__(self, uid="user-1", token=None):
        self.uid = uid
        self.token = {"email_verified": True} if token is None else token


class FakeReq:
    def __init__(self, auth=None, app=None, data=None):
        self.auth = auth
        self.app = app
        self.data = data or {}


@pytest.fixture(autouse=True)
def verified_required(monkeypatch):
    """Estado de producción por defecto: email verificado exigido."""
    monkeypatch.setattr(main, "EMAIL_VERIFIED_REQUIRED", True)
    yield


# --- _require_auth ---------------------------------------------------------

def test_sin_sesion_unauthenticated():
    with pytest.raises(https_fn.HttpsError) as err:
        main._require_auth(FakeReq(auth=None))
    assert err.value.code == https_fn.FunctionsErrorCode.UNAUTHENTICATED


def test_email_sin_verificar_permission_denied():
    req = FakeReq(auth=FakeAuth(token={"email_verified": False}))
    with pytest.raises(https_fn.HttpsError) as err:
        main._require_auth(req)
    assert err.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED
    assert "correo" in str(err.value.message).lower()


def test_token_sin_campo_email_verified_tambien_se_bloquea():
    req = FakeReq(auth=FakeAuth(token={}))
    with pytest.raises(https_fn.HttpsError) as err:
        main._require_auth(req)
    assert err.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED


def test_email_verificado_devuelve_uid():
    assert main._require_auth(FakeReq(auth=FakeAuth(uid="oscar"))) == "oscar"


def test_flag_desactivada_no_exige_verificacion(monkeypatch):
    monkeypatch.setattr(main, "EMAIL_VERIFIED_REQUIRED", False)
    req = FakeReq(auth=FakeAuth(uid="u2", token={"email_verified": False}))
    assert main._require_auth(req) == "u2"


# N-09 (tercera pasada, 17-10-2026): BDB_REQUIRE_EMAIL_VERIFIED falla cerrado, con el mismo
# criterio que parseEnabledUnlessOff del frontend (solo false/0/no/off lo apagan).

@pytest.mark.parametrize("value", ["false", "FALSE", " off ", "Off", "0", "no", "NO", "\tfalse\n"])
def test_interruptor_de_correo_verificado_solo_se_apaga_con_un_no_explicito(value):
    assert main._enabled_unless_off(value) is False


@pytest.mark.parametrize("value", [None, "", "   ", "true", " true", "TRUE", "on", "1", "yes", "si", "flase", "nope", "0.0"])
def test_cualquier_otro_valor_deja_activo_el_correo_verificado(value):
    assert main._enabled_unless_off(value) is True


def test_el_modulo_lee_el_interruptor_con_ese_criterio(monkeypatch):
    import ast
    tree = ast.parse(open(main.__file__, encoding="utf-8").read())
    assign = next(node for node in tree.body if isinstance(node, ast.Assign)
                  and any(getattr(t, "id", None) == "EMAIL_VERIFIED_REQUIRED" for t in node.targets))
    call = assign.value
    assert isinstance(call, ast.Call) and getattr(call.func, "id", None) == "_enabled_unless_off"
    inner = call.args[0]
    assert ast.literal_eval(inner.args[0]) == "BDB_REQUIRE_EMAIL_VERIFIED" and len(inner.args) == 1


def test_rate_limit_se_traduce_a_resource_exhausted(monkeypatch):
    class Limiter:
        def check(self, uid, operation, limit):
            raise RateLimitExceeded(retry_after_seconds=30)

    monkeypatch.setattr(main, "RATE_LIMITER", Limiter())
    with pytest.raises(https_fn.HttpsError) as err:
        main._require_auth(FakeReq(auth=FakeAuth()), operation="search", limit_per_minute=10)
    assert err.value.code == https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED
    assert "30" in str(err.value.message)


def test_sin_operation_no_pasa_por_el_limiter(monkeypatch):
    class Boom:
        def check(self, *args, **kwargs):
            raise AssertionError("no debe llamarse sin operation+limit")

    monkeypatch.setattr(main, "RATE_LIMITER", Boom())
    assert main._require_auth(FakeReq(auth=FakeAuth(uid="u3"))) == "u3"


# --- _require_admin --------------------------------------------------------

def test_admin_requiere_sesion():
    with pytest.raises(https_fn.HttpsError) as err:
        main._require_admin(FakeReq(auth=None))
    assert err.value.code == https_fn.FunctionsErrorCode.UNAUTHENTICATED


def test_usuario_normal_permission_denied():
    req = FakeReq(auth=FakeAuth(uid="normal", token={"email_verified": True}))
    with pytest.raises(https_fn.HttpsError) as err:
        main._require_admin(req)
    assert err.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED


def test_claim_admin_true_pasa():
    req = FakeReq(auth=FakeAuth(uid="jefe", token={"email_verified": True, "admin": True}))
    assert main._require_admin(req) == "jefe"


def test_claim_admin_no_booleano_no_cuela():
    req = FakeReq(auth=FakeAuth(uid="listillo", token={"email_verified": True, "admin": "true"}))
    with pytest.raises(https_fn.HttpsError):
        main._require_admin(req)


def test_allowlist_admin_uids_env_ya_no_abre_puerta(monkeypatch):
    """S-08 (auditoría 29-09): la allowlist ADMIN_UIDS se retiró; aunque la env
    siga definida en un despliegue viejo, solo pasa el claim."""
    monkeypatch.setenv("ADMIN_UIDS", "uid-a, uid-b")
    req = FakeReq(auth=FakeAuth(uid="uid-b", token={"email_verified": True}))
    with pytest.raises(https_fn.HttpsError) as err:
        main._require_admin(req)
    assert err.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED
    assert "ADMIN_UIDS" not in inspect.getsource(main._require_admin).split('"""')[-1]


def test_admin_sin_email_verificado_tambien_se_bloquea():
    req = FakeReq(auth=FakeAuth(uid="jefe", token={"email_verified": False, "admin": True}))
    with pytest.raises(https_fn.HttpsError) as err:
        main._require_admin(req)
    assert err.value.code == https_fn.FunctionsErrorCode.PERMISSION_DENIED


# --- ALTA-04 (auditoria 16-10-2026): limite de frecuencia en las de administracion ---

ADMIN_CALLABLES = {
    "admin_publish_report", "get_system_status", "admin_fund_quality", "admin_db_status",
    "admin_list_assets", "admin_asset_detail", "admin_refresh_all_stale", "admin_backfill_candidates",
    "admin_backfill_history", "admin_ingest_asset", "admin_reconcile_search_index",
    "admin_recompute_metric", "admin_refresh_prices",
}


def _admin_gate_calls():
    """{funcion: kwargs de su llamada a _require_admin} leidos del AST de main.py."""
    import ast
    tree = ast.parse(open(main.__file__, encoding="utf-8").read())
    out = {}
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef) or node.name == "_require_admin":
            continue
        for call in ast.walk(node):
            if isinstance(call, ast.Call) and getattr(call.func, "id", None) == "_require_admin":
                out[node.name] = {kw.arg: ast.literal_eval(kw.value) for kw in call.keywords}
    return out


def test_las_trece_callables_de_admin_nombran_operacion_y_limite():
    calls = _admin_gate_calls()
    assert set(calls) == ADMIN_CALLABLES
    for name, kwargs in calls.items():
        assert kwargs.get("operation") == name, name
        limit = kwargs.get("limit_per_minute")
        assert isinstance(limit, int) and 1 <= limit <= 60, (name, limit)
    # Segunda pasada (17-10-2026): el estado y el inventario de historicos se recargan al
    # cambiar de pestana y tras cada «Cargar» fila a fila (AdminBackfill.loadInventory);
    # con 6 y 4 por minuto se cortaba un uso legitimo.
    assert calls["admin_db_status"]["limit_per_minute"] >= 30
    assert calls["admin_backfill_candidates"]["limit_per_minute"] >= 30


def test_admin_con_limite_pasa_por_el_limiter(monkeypatch):
    seen = []

    class Limiter:
        def check(self, uid, operation, limit):
            seen.append((uid, operation, limit))

    monkeypatch.setattr(main, "RATE_LIMITER", Limiter())
    req = FakeReq(auth=FakeAuth(uid="jefe", token={"email_verified": True, "admin": True}))
    assert main._require_admin(req, operation="admin_db_status", limit_per_minute=6) == "jefe"
    assert seen == [("jefe", "admin_db_status", 6)]


def test_admin_db_status_agota_su_limite_con_resource_exhausted(monkeypatch):
    from rate_limit import UserRateLimiter
    monkeypatch.setattr(main, "RATE_LIMITER", UserRateLimiter())
    monkeypatch.setattr(main.admin_panel, "db_status", lambda sample=0: {"assets": 0})
    real_require_auth = main._require_auth

    def un_solo_intento(req, *, operation=None, limit_per_minute=None):
        return real_require_auth(req, operation=operation, limit_per_minute=1 if limit_per_minute else None)

    monkeypatch.setattr(main, "_require_auth", un_solo_intento)
    req = FakeReq(auth=FakeAuth(uid="jefe", token={"email_verified": True, "admin": True}))
    callable_body = inspect.unwrap(main.admin_db_status)
    assert callable_body(req)["assets"] == 0
    with pytest.raises(https_fn.HttpsError) as err:
        callable_body(req)
    assert err.value.code == https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED
