import { describe, expect, it } from 'vitest';
import { mapFondosDbHoldings } from '../src/mappers/fondosHoldingsMapper';

describe('Fund position identity', () => {
  it('distinguishes currencies, contract dates and repeated rows without dropping weights', () => {
    const rows = [
      { name: 'Cash', currency: 'EUR', weight: 10 },
      { name: 'Cash', currency: 'USD', weight: 20 },
      { name: 'Bond', currency: 'EUR', maturity: '2030-01-01', weight: 30 },
      { name: 'Bond', currency: 'EUR', maturity: '2035-01-01', weight: 35 },
      { name: 'Cash', currency: 'EUR', weight: 5 }
    ];
    const result = mapFondosDbHoldings('LU0171304552', undefined, '2026-09-28', rows);
    expect(result.holdings_count).toBe(5);
    expect(result.total_reported_weight).toBe(100);
    expect(new Set(result.holdings!.map(row => row.holding_id)).size).toBe(5);
  });
  it('keeps identity through ordinary weight changes', () => {
    const row = { name: 'Cash', currency: 'USD', assetClass: 'Cash', weight: 100 };
    const first = mapFondosDbHoldings('LU0171304552', undefined, '2026-09-28', [row]);
    const next = mapFondosDbHoldings('LU0171304552', undefined, '2026-09-29', [{ ...row, weight: 95 }]);
    expect(next.holdings![0].holding_id).toBe(first.holdings![0].holding_id);
  });
});
