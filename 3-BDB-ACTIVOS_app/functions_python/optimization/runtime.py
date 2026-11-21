"""Overlap first-use scientific imports with the request's independent I/O."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import importlib
import os
import threading
import time

from firebase_functions import logger

_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="solver-import")
_lock = threading.Lock()
_preparation = None


def _load_dependencies():
    # These are exactly the packages used by robust_engine.solve. No solver,
    # model or data is cached here; Python retains only its normal imports.
    for name in ("numpy", "pandas", "pypfopt", "sklearn.covariance"):
        started = time.perf_counter()
        importlib.import_module(name)
        logger.info("portfolio_solver_import", module=name, seconds=round(time.perf_counter() - started, 3))


def prepare_solver_at_startup():
    """Initialize only deployed numerical endpoints while startup CPU is allocated.

    Firebase discovery and every other endpoint remain lazy. Await completion so
    the server cannot suspend an unfinished background import between requests.
    """
    if os.environ.get("FUNCTION_TARGET") not in {"backtest_portfolio", "optimize_portfolio"}:
        return
    with prepare_solver_during_reads():
        pass


@contextmanager
def prepare_solver_during_reads(enabled=True):
    """One import job per process; never leave work running after the request.

    Import errors keep the existing solver error path: an unavailable optimizer
    must not suppress the rest of a horizon/backtest response.
    """
    global _preparation
    if not enabled:
        yield
        return
    with _lock:
        if _preparation is None or (_preparation.done() and _preparation.exception() is not None):
            _preparation = _pool.submit(_load_dependencies)
        pending = _preparation
    try:
        yield
    finally:
        try:
            pending.result()
        except Exception as exc:
            logger.warn("portfolio_solver_prepare_failed", error_type=type(exc).__name__)
