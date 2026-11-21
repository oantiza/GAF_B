from datetime import date
import threading
import pytest
import portfolio_horizon as horizon


def test_batch_roots_parallel_prices_preserve_order_quality_and_ten_year_window(monkeypatch):
    gate = threading.Barrier(3)
    seen = []
    class Reader:
        max_parallel_reads = 3
        def get_assets_many(self, ids):
            assert ids == ['A', 'B', 'C', 'D']
            return {aid: {'asset_id': aid} for aid in ids}
        def get_asset(self, aid):
            raise AssertionError('root should be batched')
    def load(_reader, aid, root, window):
        assert window == '10Y' and root['asset_id'] == aid
        seen.append(aid)
        gate.wait(timeout=3)  # This fails if I/O accidentally becomes sequential.
        return {date(2020, 1, 1): ord(aid)}
    monkeypatch.setattr(horizon, '_root_exclusion_reason', lambda root, *_args, **_kwargs: 'QUALITY_BLOCKED' if root['asset_id'] == 'D' else None)
    monkeypatch.setattr(horizon, '_load_window_values', load)
    loaded, excluded = horizon._load_horizon_prices(Reader(), ['D', 'C', 'B', 'A'])
    assert list(loaded) == ['A', 'B', 'C'] and set(seen) == {'A', 'B', 'C'}
    assert loaded['A'] == {'2020-01-01': 65}
    assert excluded == [{'asset_id': 'D', 'reason': 'QUALITY_BLOCKED'}]


def test_parallel_and_sequential_loading_have_identical_results(monkeypatch):
    class Reader:
        max_parallel_reads = 1
        def get_asset(self, aid):return {'asset_id': aid}
    def load(_reader, aid, _root, _window):
        if aid == 'B':raise horizon.PriceSeriesProblem('FX_SERIES_MISSING')
        return {date(2020, 1, 1): 100}
    monkeypatch.setattr(horizon, '_root_exclusion_reason', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(horizon, '_load_window_values', load)
    reader = Reader()
    sequential = horizon._load_horizon_prices(reader, ['C', 'B', 'A'])
    reader.max_parallel_reads = 6
    assert horizon._load_horizon_prices(reader, ['C', 'B', 'A']) == sequential


def test_transport_failure_does_not_silently_publish_a_partial_portfolio(monkeypatch):
    class Reader:
        max_parallel_reads = 2
        def get_asset(self, aid):return {'asset_id': aid}
    monkeypatch.setattr(horizon, '_root_exclusion_reason', lambda *_args, **_kwargs: None)
    def fail(*_args):raise TimeoutError('database unavailable')
    monkeypatch.setattr(horizon, '_load_window_values', fail)
    with pytest.raises(TimeoutError):horizon._load_horizon_prices(Reader(), ['A', 'B'])
