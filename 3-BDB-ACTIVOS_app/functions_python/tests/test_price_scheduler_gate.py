import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import price_refresh  # noqa: E402
import metrics_refresh  # noqa: E402


def _with_env(key, value, fn):
    previous = os.environ.get(key)
    try:
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
        fn()
    finally:
        if previous is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = previous


def test_price_scheduler_gate_blocks_when_env_missing():
    def run():
        try:
            price_refresh.require_price_scheduler_writes_enabled("scheduled_refresh_prices")
        except RuntimeError as exc:
            assert "PRICES_WRITES_DISABLED" in str(exc)
        else:
            raise AssertionError("PRICES_WRITE_ENABLED missing debe bloquear")

    _with_env(price_refresh.PRICE_SCHEDULER_WRITE_ENV, None, run)


def test_price_scheduler_gate_allows_true():
    _with_env(
        price_refresh.PRICE_SCHEDULER_WRITE_ENV,
        "true",
        lambda: price_refresh.require_price_scheduler_writes_enabled("scheduled_refresh_prices"),
    )


def test_price_scheduler_write_requires_master_gate_too():
    # S6b (decisión 27-07): el gate del scheduler se SUMA al maestro, no lo
    # sustituye. Con PRICES activado pero sin el cerrojo maestro → bloqueo.
    def run():
        try:
            price_refresh.refresh_stale_prices(write=True, scheduler_price_gate=True)
        except RuntimeError as exc:
            assert "MASTER_WRITES_DISABLED" in str(exc)
        else:
            raise AssertionError("sin gate maestro debe bloquear el scheduler")

    _with_env(
        "BDB_ACTIVOS_ENABLE_MASTER_WRITES",
        None,
        lambda: _with_env(price_refresh.PRICE_SCHEDULER_WRITE_ENV, "true", run),
    )


def test_metrics_write_gate_blocks_when_env_missing():
    def run():
        try:
            metrics_refresh.require_metrics_writes_enabled("scheduled_refresh_metrics")
        except RuntimeError as exc:
            assert "METRICS_WRITES_DISABLED" in str(exc)
        else:
            raise AssertionError("METRICS_WRITE_ENABLED missing debe bloquear")

    _with_env(metrics_refresh.METRICS_WRITE_ENV, None, run)


def test_metrics_write_gate_allows_true():
    _with_env(
        metrics_refresh.METRICS_WRITE_ENV,
        "true",
        lambda: metrics_refresh.require_metrics_writes_enabled("scheduled_refresh_metrics"),
    )


def test_refresh_candidate_filter_skips_non_isin_and_archived():
    assert price_refresh._is_active_canonical_asset("US0378331005", {"asset_id": "US0378331005"})
    assert not price_refresh._is_active_canonical_asset("EODHD_MSFT.US", {"asset_id": "EODHD_MSFT.US"})
    assert not price_refresh._is_active_canonical_asset(
        "US5949181045",
        {"asset_id": "US5949181045", "quality": {"status": "ARCHIVED_LEGACY"}},
    )
