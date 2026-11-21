"""
Tests del gate runtime para escrituras sobre BBDD maestra.
Ejecuta: `python functions_python/tests/test_write_governance.py`
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import write_governance as W  # noqa: E402


def _with_env(value, fn):
    previous = os.environ.get(W.MASTER_WRITE_ENV)
    try:
        if value is None:
            os.environ.pop(W.MASTER_WRITE_ENV, None)
        else:
            os.environ[W.MASTER_WRITE_ENV] = value
        fn()
    finally:
        if previous is None:
            os.environ.pop(W.MASTER_WRITE_ENV, None)
        else:
            os.environ[W.MASTER_WRITE_ENV] = previous


def test_env_missing_disables_master_writes():
    _with_env(None, lambda: check(W.master_writes_enabled() is False, "env ausente => disabled"))


def test_env_incorrect_disables_master_writes():
    _with_env("YES", lambda: check(W.master_writes_enabled() is False, "env incorrecta => disabled"))


def test_env_exact_enables_master_writes():
    _with_env(
        W.MASTER_WRITE_CONFIRMATION,
        lambda: check(W.master_writes_enabled() is True, "env exacta => enabled"),
    )


def test_disabled_result_uses_contract_code():
    res = W.master_writes_disabled_result("scheduled_refresh_prices")
    check(res["code"] == W.MASTER_WRITES_DISABLED_CODE, "disabled_result devuelve codigo contractual")
    check(res["master_writes_mode"] == "disabled", "disabled_result devuelve modo disabled")


def test_require_blocks_when_disabled():
    def run_disabled():
        try:
            W.require_master_writes_enabled("admin_refresh_prices", actor_uid="u1")
        except W.MasterWritesDisabledError as exc:
            check(exc.operation == "admin_refresh_prices", "require off conserva operation")
            check(W.MASTER_WRITES_DISABLED_CODE in str(exc), "require off incluye codigo")
        else:
            raise AssertionError("require_master_writes_enabled debe bloquear si el gate esta off")

    _with_env(None, run_disabled)


def test_require_allows_when_enabled():
    _with_env(
        W.MASTER_WRITE_CONFIRMATION,
        lambda: check(W.require_master_writes_enabled("admin_refresh_prices") is None, "require on no lanza"),
    )


ok = 0


def check(condition, message):
    global ok
    assert condition, "FALLO: " + message
    ok += 1
    print("  ok:", message)


def run():
    test_env_missing_disables_master_writes()
    test_env_incorrect_disables_master_writes()
    test_env_exact_enables_master_writes()
    test_disabled_result_uses_contract_code()
    test_require_blocks_when_disabled()
    test_require_allows_when_enabled()
    print(f"\nWRITE GOVERNANCE OK: {ok} comprobaciones pasaron.")


if __name__ == "__main__":
    run()
