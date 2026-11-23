"""Identidad estable de las posiciones de un fondo. Sin red ni escrituras.

Lo usa el lector de la base nueva (`readmodel/lector_base_nueva.py`) al servir la cartera de un fondo. El resto del modulo
-el inventario de calidad de fondos de la base vieja (`meta/fund_data_quality`: `refresh_inventory_if_due`, `inventory_row`,
`summary`, `history_span` y sus ayudantes) y la ficha de ingesta (`build_profile`, `sanitized`)- solo lo llamaban
`integrity_check`, `admin_panel` y `fund_ingest`, y se borro con ellos el 21-11-2026 (censo CENSO_BASE_VIEJA_2026-11-21.md,
decision 31; etiqueta referencia-base-vieja-2026-11-21).
"""
from collections import Counter
from copy import deepcopy
import hashlib
import json


def normalize_holdings(isin, holdings):
    """Keep every economic row; stable IDs include currency and instrument terms.

    A suffix distinguishes indistinguishable source rows without deleting them.
    Weights are excluded from the identity so ordinary rebalancing keeps IDs.
    """
    seen = Counter()
    result = []
    for original in holdings:
        row = deepcopy(original)
        if not any(row.get(k) for k in ('name', 'holding_name', 'isin', 'ticker', 'identifiers', 'currency')):
            result.append(row)
            continue
        row.setdefault('holding_name', row.get('name'))
        if 'holding_weight' not in row and isinstance(row.get('weight_pct'), (int, float)):
            row.update(holding_weight=row['weight_pct'], holding_weight_unit='percent')
        identity = {k: row.get(k) for k in ('holding_name', 'isin', 'ticker', 'identifiers', 'currency',
                    'instrument_type', 'holding_type', 'maturity', 'expiry', 'strike', 'contract', 'country')}
        digest = hashlib.sha256((isin+'|'+json.dumps(identity, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()[:24]
        seen[digest] += 1
        row['holding_id'] = digest if seen[digest] == 1 else f'{digest}-{seen[digest]}'
        result.append(row)
    return result
