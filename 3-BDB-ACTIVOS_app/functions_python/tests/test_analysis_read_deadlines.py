from types import SimpleNamespace
import pytest
from readmodel.firestore_client import FirestoreReader, _clear_read_caches
from optimization.firestore_reader import FirestoreOptimizationReader


def test_failed_batch_is_bounded_and_does_not_retry_each_asset_separately():
    _clear_read_caches()
    class DB:
        def collection(self, _name):return self
        def document(self, aid):return aid
        def get_all(self, refs, **kwargs):
            assert len(refs) == 40
            assert kwargs['timeout'] == 15 and kwargs['retry']._deadline == 15
            raise TimeoutError('read deadline')
    reader = FirestoreReader(DB(), read_timeout=15)
    reader.get_asset = lambda _aid: pytest.fail('batch failure must not start forty fallback reads')
    with pytest.raises(TimeoutError):reader.get_assets_many([f'A{i}' for i in range(40)])


def test_price_stream_has_total_retry_and_rpc_deadlines():
    class DB:
        def collection(self, _name):return self
        def document(self, _aid):return self
        def stream(self, **kwargs):
            assert kwargs['timeout'] == 15 and kwargs['retry']._deadline == 15
            return [SimpleNamespace(id='2026', to_dict=lambda: {'points': []})]
    reader = FirestoreOptimizationReader(DB())
    assert reader.get_price_series('A') == [{'points': [], 'document_id': '2026'}]
    assert reader.read_count == 1 and reader.write_count == 0
