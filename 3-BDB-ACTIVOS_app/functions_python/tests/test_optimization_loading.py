from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import threading
import time

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from optimization import repository as repo
from optimization import runtime
from test_optimization import make_large_reader, request


@pytest.fixture(autouse=True)
def clear_series():
    repo._clear_price_series_cache()
    yield
    repo._clear_price_series_cache()


class ParallelReader:
    max_parallel_reads = 6

    def __init__(self, underlying):
        self.underlying = underlying
        self.active = 0
        self.maximum = 0
        self.lock = threading.Lock()
        self.batch_calls = 0

    def get_asset(self, _aid):
        raise AssertionError("Roots must be fetched in one batch")

    def get_assets_many(self, ids):
        self.batch_calls += 1
        return {aid:self.underlying.roots.get(aid) for aid in ids}

    def get_price_series(self, aid):
        with self.lock:
            self.active += 1
            self.maximum = max(self.maximum, self.active)
        try:
            time.sleep(.01)
            return self.underlying.get_price_series(aid)
        finally:
            with self.lock:
                self.active -= 1


def test_transport_failure_is_not_hidden_as_partial_optimization():
    source = make_large_reader(8)
    parallel = ParallelReader(source)
    def failed(_aid):
        raise TimeoutError("read unavailable")
    source.get_price_series = failed
    with pytest.raises(TimeoutError, match="read unavailable"):
        repo.optimize_portfolio(parallel, request(asset_ids=list(source.roots), current_weights={aid:.125 for aid in source.roots}))
    assert parallel.active == 0


def test_batch_failure_does_not_fan_out_to_individual_reads():
    source = make_large_reader(3)
    parallel = ParallelReader(source)
    def failed(_ids):
        raise ConnectionError("batch unavailable")
    parallel.get_assets_many = failed
    with pytest.raises(ConnectionError, match="batch unavailable"):
        repo.optimize_portfolio(parallel, request(asset_ids=list(source.roots)))
    assert parallel.maximum == 0


def test_dependency_preparation_overlaps_reads_and_is_shared(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    entered = threading.Barrier(4)
    calls = []
    def prepare():
        calls.append(1)
        started.set()
        assert release.wait(3)
    monkeypatch.setattr(runtime, "_preparation", None)
    monkeypatch.setattr(runtime, "_load_dependencies", prepare)
    def request_work():
        with runtime.prepare_solver_during_reads():
            assert started.wait(3)
            entered.wait(timeout=3)
            release.set()
        assert release.is_set()
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _:request_work(), range(4)))
    with runtime.prepare_solver_during_reads():
        pass
    assert calls == [1]


def test_import_failure_does_not_mask_read_error_and_can_retry(monkeypatch):
    calls = []
    def failed():
        calls.append(1)
        raise ImportError("dependency unavailable")
    monkeypatch.setattr(runtime, "_preparation", None)
    monkeypatch.setattr(runtime, "_load_dependencies", failed)
    with pytest.raises(TimeoutError, match="data read"):
        with runtime.prepare_solver_during_reads():
            raise TimeoutError("data read")
    with runtime.prepare_solver_during_reads():
        pass
    assert len(calls) == 2


def test_nothing_to_solve_does_not_start_scientific_import_job(monkeypatch):
    def unexpected():
        raise AssertionError("must remain lazy")
    monkeypatch.setattr(runtime, "_preparation", None)
    monkeypatch.setattr(runtime, "_load_dependencies", unexpected)
    with runtime.prepare_solver_during_reads(False):
        pass
    assert runtime._preparation is None


@pytest.mark.parametrize("target", [None, "compare_assets", "scheduled_publish_daily_report"])
def test_startup_keeps_discovery_and_other_endpoints_lazy(monkeypatch, target):
    if target is None:
        monkeypatch.delenv("FUNCTION_TARGET", raising=False)
    else:
        monkeypatch.setenv("FUNCTION_TARGET", target)
    monkeypatch.setattr(runtime, "_preparation", None)
    monkeypatch.setattr(runtime, "_load_dependencies", lambda: pytest.fail("unexpected numerical import"))
    runtime.prepare_solver_at_startup()
    assert runtime._preparation is None


@pytest.mark.parametrize("target", ["backtest_portfolio", "optimize_portfolio"])
def test_numerical_endpoint_is_prepared_before_startup_returns(monkeypatch, target):
    monkeypatch.setenv("FUNCTION_TARGET", target)
    monkeypatch.setattr(runtime, "_preparation", None)
    completed = []
    monkeypatch.setattr(runtime, "_load_dependencies", lambda: completed.append(True))
    runtime.prepare_solver_at_startup()
    assert completed == [True]
    assert runtime._preparation.done()
    with runtime.prepare_solver_during_reads():
        pass
    assert completed == [True]
