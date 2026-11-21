# -*- coding: utf-8 -*-
"""MEDIA-03 (auditoria 16-10-2026): la cache de series aguanta hilos concurrentes.

La instancia de Cloud Functions atiende varias peticiones a la vez. Antes, dos hilos
que caducaban o refrescaban el mismo activo podian hacer `del` sobre la misma clave y
el segundo saltaba con KeyError.

Ejecuta: pytest functions_python/tests/test_price_series_cache.py
"""
import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import price_series_cache as cache  # noqa: E402


class Lector:
    def __init__(self):
        self.reads = 0

    def get_price_series(self, asset_id):
        self.reads += 1
        time.sleep(0)  # cede el GIL: la lectura real de Firestore tambien lo hace
        return [{"points": [{"date": "2026-10-15", "value": 100.0}], "asset_id": asset_id}]


@pytest.fixture(autouse=True)
def limpia():
    cache.clear_price_series_cache()
    yield
    cache.clear_price_series_cache()


def test_hilos_concurrentes_sobre_los_mismos_activos_no_rompen(monkeypatch):
    # TTL 0: cada lectura caduca y refresca; es el caso que hacia chocar los `del`.
    monkeypatch.setattr(cache, "PRICE_SERIES_CACHE_TTL_SECONDS", 0)
    monkeypatch.setattr(cache, "PRICE_SERIES_CACHE_MAX_ASSETS", 2)
    previous_interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    lector = Lector()
    errores = []
    arranque = threading.Barrier(8)

    def trabajo(n):
        try:
            arranque.wait()
            for i in range(200):
                asset_id = "A%d" % ((n + i) % 3)
                assert cache.cached_price_series(lector, asset_id) is not None
                if i % 50 == 0:
                    cache.invalidate_price_series_cache(asset_id)
        except Exception as exc:  # pragma: no cover - es lo que el test vigila
            errores.append(exc)

    hilos = [threading.Thread(target=trabajo, args=(n,)) for n in range(8)]
    try:
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=60)
    finally:
        sys.setswitchinterval(previous_interval)
    assert not any(h.is_alive() for h in hilos)
    assert errores == []
    assert len(cache._PRICE_SERIES_CACHE) <= 2
    assert lector.reads > 0


def test_lru_e_invalidacion_se_conservan():
    lector = Lector()
    cache.cached_price_series(lector, "A")
    cache.cached_price_series(lector, "B")
    cache.cached_price_series(lector, "A")  # acierto: no relee y pasa al final
    assert lector.reads == 2
    assert list(cache._PRICE_SERIES_CACHE) == ["B", "A"]
    cache.invalidate_price_series_cache("A")
    cache.cached_price_series(lector, "A")
    assert lector.reads == 3


def test_el_ttl_caduca_con_el_reloj_y_un_acierto_no_lo_renueva(monkeypatch):
    # Segunda pasada (17-10-2026): reloj inyectado. El acierto reordena (LRU) pero conserva
    # la hora de carga: un activo leido a menudo se relee igual al cumplir el TTL, para ver
    # una reparacion hecha desde otra instancia.
    from types import SimpleNamespace
    reloj = SimpleNamespace(ahora=1000.0)
    monkeypatch.setattr(cache, "time", SimpleNamespace(monotonic=lambda: reloj.ahora))
    ttl = cache.PRICE_SERIES_CACHE_TTL_SECONDS
    lector = Lector()
    cache.cached_price_series(lector, "A")
    reloj.ahora += ttl - 1
    cache.cached_price_series(lector, "A")  # dentro del TTL: acierto
    assert lector.reads == 1
    reloj.ahora += 2  # TTL + 1 desde la carga, aunque hubo un acierto hace 2 s
    cache.cached_price_series(lector, "A")
    assert lector.reads == 2
    assert cache._PRICE_SERIES_CACHE["A"][1] == reloj.ahora  # recargado con la hora nueva
    reloj.ahora += ttl  # justo en el limite: sigue valiendo (<=)
    cache.cached_price_series(lector, "A")
    assert lector.reads == 2


def test_lo_leido_para_dibujar_no_lo_recibe_quien_mide():
    """Decision 53: Schroder esta bloqueado y revisado. Dos entradas, y cada una con lo suyo, en cualquier orden."""
    bloqueado = "LU0321373184"
    lector = Lector()
    assert cache.cached_price_series(lector, bloqueado, para_dibujar=True)
    assert cache.cached_price_series(lector, bloqueado) == []
    assert cache.cached_price_series(lector, bloqueado, para_dibujar=True)
    assert lector.reads == 2
    cache.invalidate_price_series_cache(bloqueado)
    assert cache.cached_price_series(lector, bloqueado) == []
    assert cache.cached_price_series(lector, bloqueado, para_dibujar=True)
    assert lector.reads == 4


def test_lo_que_no_esta_revisado_comparte_entrada_y_no_se_lee_dos_veces(bloqueo_sin_revision):
    lector = Lector()
    assert cache.cached_price_series(lector, "A", para_dibujar=True)
    assert cache.cached_price_series(lector, "A")
    assert lector.reads == 1
    # Un bloqueo sin revision sigue cerrado aunque se pida para dibujar.
    assert cache.cached_price_series(lector, "XS0000000001", para_dibujar=True) == []
