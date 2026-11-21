import pytest

from analyze_portfolio import _build_prompt


@pytest.mark.parametrize('weight, displayed', [(0.6, '60 %'), (0.004, '0.4 %'), (0, '0 %'), (1, '100 %')])
def test_prompt_converts_fractional_weights_to_percent(weight, displayed):
    prompt = _build_prompt([{'asset_id': 'FUND', 'weight': weight}], {})
    assert f'- FUND: {displayed}' in prompt


@pytest.mark.parametrize('weight', [None, True, '0.6', float('nan'), float('inf'), -0.1, 60])
def test_prompt_does_not_invent_a_percentage_for_invalid_weights(weight):
    assert '- FUND: N/D' in _build_prompt([{'asset_id': 'FUND', 'weight': weight}], {})
