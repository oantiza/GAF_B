# -*- coding: utf-8 -*-
"""CRIT-01 (auditoria 16-10-2026, documental): .env.example recoge los gates y flags que
lee el codigo, nace con las escrituras cerradas y no trae secretos.

Ejecuta: pytest functions_python/tests/test_env_example.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _assignments():
    out = {}
    for line in (ROOT / ".env.example").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            out[key.strip()] = value.strip()
    return out


def test_los_gates_y_flags_que_lee_el_codigo_estan_documentados():
    import integrity_check
    import write_governance
    env = _assignments()
    source = "".join(p.read_text(encoding="utf-8") for p in ROOT.glob("*.py"))
    source += "".join(p.read_text(encoding="utf-8") for p in (ROOT / "optimization").glob("*.py"))
    for name in (write_governance.MASTER_WRITE_ENV, integrity_check.INTEGRITY_WRITE_ENV,
                 "PRICES_WRITE_ENABLED", "METRICS_WRITE_ENABLED", "SEARCH_INDEX_WRITE_ENABLED",
                 "BDB_APPCHECK_ENFORCE", "BDB_VERIFIED_PRICE_REPAIR_RELEASES"):
        assert name in env, name
        assert name in source, "%s ya no lo lee el codigo" % name


def test_una_instalacion_nueva_nace_con_las_escrituras_cerradas():
    env = _assignments()
    assert env["BDB_ACTIVOS_ENABLE_MASTER_WRITES"] == ""
    for gate in ("PRICES_WRITE_ENABLED", "METRICS_WRITE_ENABLED", "SEARCH_INDEX_WRITE_ENABLED",
                 "INTEGRITY_WRITE_ENABLED", "BDB_APPCHECK_ENFORCE"):
        assert env[gate] == "false", gate
    assert env["BDB_VERIFIED_PRICE_REPAIR_RELEASES"] == ""


def test_sin_secretos_ni_topes_que_el_entorno_real_no_usa():
    env = _assignments()
    assert not any(key.endswith(("_API_KEY", "_API_TOKEN", "_SECRET")) for key in env)
    # El entorno desplegado no define el tope de precios; el codigo usa 3600.
    assert "PRICE_REFRESH_MAX_READS" not in env
