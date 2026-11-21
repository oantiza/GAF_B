"""Caché de proceso de las series de precios de la maestra (ola 3b, T6g).

Una sola caché para TODOS los lectores de `price_series` — optimización,
backtest y frontera (y la cartera real, hasta que su motor se borró el 17-11-2026).
Antes `portfolio_real._load_price_points`
y `optimization._load_window_values` leían la subcolección documento a
documento en cada petición, esquivando la caché que ya usaba
`_load_asset_returns`: el pico matinal de ~45k lecturas/h observado en
producción (11-08) apuntaba a esta ruta.

TTL 15 min, cupo 250 activos, evicción LRU por timestamp. El lector es
duck-typed: solo necesita `get_price_series(asset_id) -> list[dict]`.

MEDIA-03 (auditoría 16-10-2026): la instancia atiende peticiones en paralelo
(set_global_options no fija concurrency=1) y dos hilos que caducaban o
refrescaban el mismo activo podían chocar en el `del` con KeyError. Las
mutaciones del diccionario van bajo `_LOCK`; la lectura de Firestore queda
fuera para no serializar las peticiones.

Decision 53 (05-11-2026): una serie bloqueada y revisada se puede pintar, y va con OTRA clave. Si compartiera entrada,
lo leido para dibujar llegaria a `_load_asset_returns`, que mide con lo que encuentra aqui. La cartera real la pide con esa clave a
sabiendas, por la decision 96: toma los pagos del extracto.
"""
import threading
import time
from typing import Dict, List, Tuple

PRICE_SERIES_CACHE_TTL_SECONDS = 15 * 60
PRICE_SERIES_CACHE_MAX_ASSETS = 250
_PRICE_SERIES_CACHE: Dict[str, Tuple[List[dict], float]] = {}
_LOCK = threading.Lock()
_SUFIJO_DE_DIBUJO = "#para_dibujar"


def clear_price_series_cache() -> None:
    """Clear all entries, primarily for isolated tests."""
    with _LOCK:
        _PRICE_SERIES_CACHE.clear()


def invalidate_price_series_cache(asset_id: str) -> None:
    """Invalidate a locally repaired series without evicting unrelated assets."""
    with _LOCK:
        _PRICE_SERIES_CACHE.pop(asset_id, None)
        _PRICE_SERIES_CACHE.pop(f"{asset_id}{_SUFIJO_DE_DIBUJO}", None)


def cached_price_series(reader, asset_id: str, *, para_dibujar: bool = False) -> List[dict]:
    from fund_history_quality import extend_frozen_price, se_dibuja_tras_revision, usable_documents
    # Solo tiene entrada propia lo que de verdad se lee distinto: lo demas comparte la de siempre y no se lee dos veces.
    para_dibujar = para_dibujar and se_dibuja_tras_revision(asset_id)
    clave = f"{asset_id}{_SUFIJO_DE_DIBUJO}" if para_dibujar else asset_id
    now = time.monotonic()
    with _LOCK:
        cached = _PRICE_SERIES_CACHE.pop(clave, None)
        if cached is not None:
            points, loaded_at = cached
            if now - loaded_at <= PRICE_SERIES_CACHE_TTL_SECONDS:
                # LRU and TTL are distinct: a frequently read asset must still reload
                # after a repair committed by another function instance.
                _PRICE_SERIES_CACHE[clave] = (points, loaded_at)
                return points

    points = usable_documents(asset_id, reader.get_price_series(asset_id), para_dibujar=para_dibujar)
    # 01-10-2026: precio congelado (valor excluido de cotizacion) prolongado plano
    # hasta hoy para TODOS los lectores de cartera; la maestra no se toca.
    points = extend_frozen_price(asset_id, points)
    with _LOCK:
        _PRICE_SERIES_CACHE.pop(clave, None)
        _PRICE_SERIES_CACHE[clave] = (points, now)
        while len(_PRICE_SERIES_CACHE) > PRICE_SERIES_CACHE_MAX_ASSETS:
            oldest_asset_id = next(iter(_PRICE_SERIES_CACHE))
            del _PRICE_SERIES_CACHE[oldest_asset_id]
    return points
