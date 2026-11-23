from copy import deepcopy
import pytest
from readmodel.mappers import map_asset_detail
from readmodel.repository import get_asset_detail, resolve_portfolio, search_assets
from optimization.repository import _root_exclusion_reason


@pytest.mark.parametrize("asset_id,asset_type,flag", [
    ("ES0158300410", "STOCK", "NON_INVESTABLE_SUSPENDED"),
    ("ES0125140A14", "STOCK", "NON_INVESTABLE_DELISTED"),
    ("ES0143416115", "STOCK", "NON_INVESTABLE_DELISTED"),
    ("LU1882457739", "FUND", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS"),
    ("LU1883319474", "FUND", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS"),
    ("LU1883342880", "FUND", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS"),
])
def test_reviewed_restriction_preserves_positions_metrics_and_historical_access(asset_id, asset_type, flag):
    reader = Reader([])
    reader.root.update(asset_id=asset_id, asset_type=asset_type)
    original = deepcopy(reader.root)
    detail = get_asset_detail(reader, asset_id)
    assert detail["is_investable"] is False
    assert detail["role"] == "INVESTABLE"
    assert detail["instrument_type"] == asset_type
    assert detail["metrics"]["annualized_return_3y"] == .04
    assert flag in detail["quality_flags"]
    assert "NON_INVESTABLE_CORPORATE_ACTION" not in detail["quality_flags"]
    assert "NON_INVESTABLE_BENCHMARK" not in detail["quality_flags"]
    assert search_assets(reader, "DUX")[0]["is_investable"] is False
    positions = [{"asset_id": asset_id, "weight": 1}]
    result = resolve_portfolio(reader, positions)
    assert result["positions"] == positions
    assert flag in result["rows"][0]["quality_flags"]
    assert result["rows"][0]["is_investable"] is False
    assert _root_exclusion_reason(reader.root, "EUR") == "NON_INVESTABLE"
    assert _root_exclusion_reason(reader.root, "EUR", allow_historical=True) is None
    assert reader.root == original


@pytest.mark.parametrize("asset_id", ["ES0110047919", "ES0162600003", "ES0183304080"])
def test_un_bloqueo_por_calidad_del_dato_dice_eso_y_sigue_bloqueando(asset_id):
    """Decision 75: Deoleo, Duro Felguera y Squirrel cotizan. Lo que falla es su serie, y eso es lo que se dice."""
    root = {"asset_id": asset_id, "asset_type": "STOCK", "identity": {"name": "X", "currency": "EUR"}}
    detail = map_asset_detail(root)
    assert detail["is_investable"] is False, "sigue sin poderse proponer"
    assert "QUALITY_BLOCKED" in detail["quality_flags"]
    assert [flag for flag in detail["quality_flags"] if flag.startswith("NON_INVESTABLE")] == []
    assert _root_exclusion_reason(root, "EUR") == "QUALITY_BLOCKED"
    assert _root_exclusion_reason(root, "EUR", allow_historical=True) == "QUALITY_BLOCKED", "y sigue fuera de lo historico"
    assert _root_exclusion_reason(root, "EUR", allow_historical=True, solo_dibujo=True) == "QUALITY_BLOCKED"


def test_lo_que_ya_no_se_puede_comprar_sigue_siendo_no_invertible():
    """Sin el control de calidad de por medio: una baja por la raiz y lo revisado con otro motivo."""
    baja = {"asset_id": "ES0000000001", "asset_type": "STOCK", "is_investable": False}
    assert _root_exclusion_reason(baja, "EUR") == "NON_INVESTABLE"
    assert _root_exclusion_reason(baja, "EUR", allow_historical=True) == "NON_INVESTABLE"
    assert "QUALITY_BLOCKED" not in map_asset_detail(baja)["quality_flags"]
    # NH Hotel Group era el ejemplo de esta baja hasta el 12-11-2026: Oscar la deja dada de alta, valorada a su ultimo precio, y
    # se mide en lo historico aunque no se le propongan pesos (`test_precio_congelado.py`).
    nh = {**baja, "asset_id": "ES0161560018"}
    assert _root_exclusion_reason(nh, "EUR") == "NON_INVESTABLE"
    assert _root_exclusion_reason(nh, "EUR", allow_historical=True) is None
    assert _root_exclusion_reason({"asset_id": "ES0125140A14", "asset_type": "STOCK"}, "EUR") == "NON_INVESTABLE"


def test_unrestricted_stock_and_successor_are_not_blocked_by_stale_prices():
    for asset_id, asset_type in [("ES0113900J37", "STOCK"), ("LU1882457143", "FUND")]:
        root = {"asset_id": asset_id, "asset_type": asset_type, "identity": {"currency": "EUR"}}
        assert map_asset_detail(root)["is_investable"] is True
        assert _root_exclusion_reason(root, "EUR") is None


class Reader:
    def __init__(self, flags):
        self.root = {'asset_id': 'ES0127097030', 'asset_type': 'FUND',
                     'identity': {'name': 'DUX Rentinver', 'currency': 'EUR'},
                     'quality': {'review_flags': flags}}

    def get_asset(self, asset_id):
        return deepcopy(self.root) if asset_id == self.root['asset_id'] else None

    def get_metrics_latest(self, asset_id):
        return {'windows': {'3y': {'annualized_return': .04}}}

    def get_holdings(self, asset_id):
        return None

    def list_assets(self, types=None, limit=20):
        return [deepcopy(self.root)]


def test_verified_merger_blocks_search_selection_and_resolution_without_deleting_history():
    reader = Reader(['DEREGISTERED_MERGER_VERIFIED'])
    original = deepcopy(reader.root)
    detail = get_asset_detail(reader, reader.root['asset_id'])
    assert detail['is_investable'] is False
    assert detail['instrument_type'] == 'FUND'
    assert detail['metrics']['annualized_return_3y'] == .04
    assert 'NON_INVESTABLE_CORPORATE_ACTION' in detail['quality_flags']
    assert 'NON_INVESTABLE_BENCHMARK' not in detail['quality_flags']
    assert search_assets(reader, 'DUX')[0]['is_investable'] is False
    positions = [{'asset_id': reader.root['asset_id'], 'weight': 1}]
    result = resolve_portfolio(reader, positions)
    assert result['positions'] == positions
    assert result['rows'][0]['is_investable'] is False
    assert reader.root == original
    assert _root_exclusion_reason(reader.root, 'EUR') == 'NON_INVESTABLE_CORPORATE_ACTION'
    assert _root_exclusion_reason(reader.root, 'EUR', allow_historical=True) is None


def test_incomplete_data_or_announced_merger_alone_does_not_exclude_a_fund():
    for flags in [[], ['MISSING_HOLDINGS'], ['MERGER_ANNOUNCED']]:
        reader = Reader(flags)
        assert map_asset_detail(reader.root)['is_investable'] is True
        assert _root_exclusion_reason(reader.root, 'EUR') is None


def test_benchmark_retains_its_distinct_exclusion_reason():
    root = {'asset_id': 'INDEX', 'asset_type': 'INDEX'}
    detail = map_asset_detail(root)
    assert detail['is_investable'] is False
    assert 'NON_INVESTABLE_BENCHMARK' in detail['quality_flags']
    assert 'NON_INVESTABLE_CORPORATE_ACTION' not in detail['quality_flags']
