# -*- coding: utf-8 -*-
"""CRIT-01 (auditoria 16-10-2026, documental): .env.example recoge los flags que lee el
codigo, nace con App Check en observacion y no trae secretos.

21-11-2026: los gates de escritura de la maestra (`BDB_ACTIVOS_ENABLE_MASTER_WRITES`, los
`*_WRITE_ENABLED`) y los topes del refresco salieron del fichero con los escritores de la base
vieja que los leian (censo CENSO_BASE_VIEJA_2026-11-21.md, decision 31). Que no vuelvan sin un
lector lo fija la ultima prueba.

Ejecuta: pytest functions_python/tests/test_env_example.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

RETIRADAS = (
    "BDB_ACTIVOS_ENABLE_MASTER_WRITES", "PRICES_WRITE_ENABLED", "METRICS_WRITE_ENABLED",
    "SEARCH_INDEX_WRITE_ENABLED", "INTEGRITY_WRITE_ENABLED", "METRICS_REFRESH_BATCH_SIZE",
    "METRICS_REFRESH_MAX_READS", "PRICE_REFRESH_MAX_READS",
)


def _assignments():
    out = {}
    for line in (ROOT / ".env.example").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            out[key.strip()] = value.strip()
    return out


def _fuente():
    source = "".join(p.read_text(encoding="utf-8") for p in ROOT.glob("*.py"))
    for carpeta in ("optimization", "readmodel", "portfolios"):
        source += "".join(p.read_text(encoding="utf-8") for p in (ROOT / carpeta).glob("*.py"))
    return source


def test_los_flags_que_lee_el_codigo_estan_documentados():
    env = _assignments()
    source = _fuente()
    for name in ("BDB_APPCHECK_ENFORCE", "BDB_VERIFIED_PRICE_REPAIR_RELEASES", "MASTER_PROJECT_ID"):
        assert name in env, name
        assert name in source, "%s ya no lo lee el codigo" % name


def test_una_instalacion_nueva_nace_en_observacion_y_sin_liberaciones():
    env = _assignments()
    assert env["BDB_APPCHECK_ENFORCE"] == "false"
    assert env["BDB_VERIFIED_PRICE_REPAIR_RELEASES"] == ""


def test_sin_secretos():
    env = _assignments()
    assert not any(key.endswith(("_API_KEY", "_API_TOKEN", "_SECRET")) for key in env)


def test_ni_el_fichero_ni_el_codigo_traen_los_gates_de_la_base_vieja():
    env = _assignments()
    source = _fuente()
    for name in RETIRADAS:
        assert name not in env, "%s vuelve a .env.example sin nadie que la lea" % name
        assert name not in source, "%s la vuelve a leer el codigo: era de la base vieja" % name
