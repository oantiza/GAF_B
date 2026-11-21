import { describe, expect, it } from 'vitest';
import { validators } from '../contracts/validators';

function baseDoc() {
  return {
    schema_version: 'asset-price-series.v1.2',
    asset_id: 'US0378331005',
    asset_type: 'STOCK',
    series_type: 'ADJUSTED_CLOSE',
    source: 'EODHD',
    source_price_id: 'EODHD:AAPL.US',
    source_listing_id: 'EODHD:AAPL.US',
    document_id: 'EODHD_AAPL_US_2026',
    currency: 'EUR',
    interval: '1d',
    year: 2026,
    first_date: '2026-01-02',
    last_date: '2026-01-02',
    observations_count: 1,
    history_quality_status: 'COMPLETE',
    updated_at: '2026-07-10T00:00:00Z',
    points: [{ date: '2026-01-02', value: 100 }],
  };
}

describe('price-series.v1.2', () => {
  it('accepts canonical NAV points', () => {
    const doc = {
      ...baseDoc(),
      asset_id: 'LU0000000001',
      asset_type: 'FUND',
      series_type: 'NAV',
      source_currency: 'EUR',
    };
    expect(validators.masterPriceSeriesV12(doc)).toEqual({ ok: true, errors: [] });
  });

  it('accepts an explicitly monthly fund NAV series without pretending it is daily', () => {
    const doc = {
      ...baseDoc(),
      asset_id: 'LU0000000001',
      asset_type: 'FUND',
      series_type: 'NAV',
      source: 'MORNINGSTAR',
      interval: '1mo',
    };
    expect(validators.masterPriceSeriesV12(doc)).toEqual({ ok: true, errors: [] });
  });

  it('accepts OHLCV and FX traceability in the same persisted payload', () => {
    const doc = {
      ...baseDoc(),
      source_currency: 'USD',
      fx_pair: 'EURUSD.FOREX',
      fx_policy: 'price_EUR = price_source / EURUSD.FOREX',
      minor_scale: 1,
      points: [{
        date: '2026-01-02',
        value: 95,
        open: 94,
        high: 101,
        low: 93,
        close: 100,
        adjusted_close: 99,
        volume: 123456,
        source_currency: 'USD',
        source_value: 99,
        source_open: 98,
        source_high: 105,
        source_low: 97,
        source_close: 104,
        source_adjusted_close: 103,
        fx_pair: 'EURUSD.FOREX',
        fx_rate: 1.0842,
      }],
    };
    expect(validators.masterPriceSeriesV12(doc)).toEqual({ ok: true, errors: [] });
  });

  it('rejects non-positive canonical values and undeclared fields', () => {
    const doc = { ...baseDoc(), points: [{ date: '2026-01-02', value: 0, surprise: true }] };
    const result = validators.masterPriceSeriesV12(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
