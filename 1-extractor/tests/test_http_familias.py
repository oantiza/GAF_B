# -*- coding: utf-8 -*-
"""La caché HTTP lee con el TTL de cada familia de dato, no con uno único.

Motivación (descubrimiento 04-09): con un solo `cache_dias` de 7 días cada
pasada refrescaba los 29 endpoints de un fondo aunque solo cambiara el VL.
Estas pruebas fijan el contrato: el TTL se aplica al LEER (no invalida nada),
`sin_caducidad` sirve cualquier entrada, `sin_red` nunca sale a red y el host
retirado por Morningstar se sigue leyendo bajo el host nuevo.
"""
import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.http import Http, SinCache, cache_key  # noqa: E402

SETTINGS = {"cache_dias": 7, "rate_limit_segundos": 0, "jitter_segundos": 0,
            "ttl_dias_por_familia": {"precio": 1, "identidad": 365}}


def _guarda(cache_dir: Path, url: str, params: dict | None, edad_dias: float,
            texto: str = '{"ok": true}') -> None:
    payload = {"url": url, "status": 200, "text": texto,
               "fetched_at": time.time() - edad_dias * 86400}
    (cache_dir / f"{cache_key(url, params)}.json").write_text(
        json.dumps(payload), encoding="utf-8")


def test_el_ttl_depende_de_la_familia(tmp_path):
    http = Http(SETTINGS, tmp_path, sin_red=True)
    url = "https://ejemplo.test/a"
    _guarda(tmp_path, url, None, edad_dias=20)

    # 20 días es demasiado viejo para precio (1 d) ...
    with pytest.raises(SinCache):
        http.get(url, familia="precio")
    # ... y perfectamente válido para identidad (365 d)
    assert http.get(url, familia="identidad").desde_cache is True
    # sin familia se aplica el cache_dias de siempre (7 d)
    with pytest.raises(SinCache):
        http.get(url)


def test_sin_caducidad_sirve_cualquier_entrada(tmp_path):
    http = Http(SETTINGS, tmp_path, sin_caducidad=True, sin_red=True)
    url = "https://ejemplo.test/b"
    _guarda(tmp_path, url, None, edad_dias=400)

    r = http.get(url, familia="precio", ttl_dias=0.5)
    assert r.desde_cache is True
    assert r.fetched_at is not None


def test_las_familias_no_pedidas_se_sirven_de_cache_aunque_caduquen(tmp_path):
    http = Http(SETTINGS, tmp_path, sin_red=True, refrescar={"precio"})
    url = "https://ejemplo.test/c"
    _guarda(tmp_path, url, None, edad_dias=200)

    assert http.get(url, familia="cartera").desde_cache is True
    with pytest.raises(SinCache):
        http.get(url, familia="precio")


def test_el_host_retirado_se_lee_bajo_el_host_nuevo(tmp_path):
    http = Http(SETTINGS, tmp_path, sin_red=True)
    params = {"term": "LU0690375182", "page": 1}
    viejo = "https://tools.morningstar.es/api/rest.svc/klr5zyak8x/security/screener"
    nuevo = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener"
    _guarda(tmp_path, viejo, params, edad_dias=0.1, texto='{"rows": []}')

    r = http.get(nuevo, params=params, familia="precio")
    assert r.desde_cache is True
    assert r.json() == {"rows": []}


def test_las_estadisticas_cuentan_por_familia(tmp_path):
    http = Http(SETTINGS, tmp_path, sin_red=True)
    url = "https://ejemplo.test/d"
    _guarda(tmp_path, url, None, edad_dias=0)
    http.get(url, familia="identidad")
    with pytest.raises(SinCache):
        http.get("https://ejemplo.test/no-esta", familia="precio")

    e = http.estadisticas
    assert e["cache"] == 1 and e["sin_cache"] == 1 and e["red"] == 0
    assert e["por_familia"]["identidad"]["cache"] == 1
    assert e["por_familia"]["precio"]["sin_cache"] == 1
