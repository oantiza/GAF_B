import { describe, expect, it } from 'vitest';
import { validators } from '../contracts/validators';

function fundRoot(hasListing: boolean) {
  return {
    asset_id: 'LU0000000001',
    asset_type: 'FUND',
    identity: { name: 'Fondo de prueba', currency: 'EUR' },
    product: { product_type: 'FUND', has_listing: hasListing },
    quality: {
      status: 'ACCEPTED',
      warnings: [],
      validation_errors: [],
      review_flags: [],
    },
    source_metadata: { source: 'FondosDB' },
  };
}

describe('root contract corrections', () => {
  it('allows an unlisted fund to omit listings', () => {
    expect(validators.masterAssetV11(fundRoot(false))).toEqual({ ok: true, errors: [] });
  });

  it('still requires listings when the product declares a listing', () => {
    expect(validators.masterAssetV11(fundRoot(true)).ok).toBe(false);
  });

  it('allows canonical query aliases on stock roots', () => {
    const stock = {
      asset_id: 'ES0000000001',
      asset_type: 'STOCK',
      currency: 'EUR',
      economic_asset_class: 'EQUITY',
      identity: { name: 'Acción de prueba', currency: 'EUR' },
      identifiers: { isin: 'ES0000000001' },
      classification: {},
      product: { product_type: 'STOCK', has_listing: true },
      listings: [],
      quality: { warnings: [], validation_errors: [], review_flags: [], status: 'PROVISIONAL_ADMIN' },
      source_metadata: { source: 'EODHD' },
    };
    expect(validators.masterAssetStock(stock)).toEqual({ ok: true, errors: [] });
  });

  it('validates provisional EODHD market roots separately from funds', () => {
    const market = {
      asset_id: 'US0000000002',
      asset_type: 'ETF',
      schema_version: 'master.asset-eodhd-market.v1',
      identity: { name: 'ETF de prueba', currency: 'USD' },
      identifiers: { isin: 'US0000000002', ticker: 'TEST', eodhd_code: 'TEST.US', aliases: [] },
      classification: { asset_class: 'EQUITY', strategy_tags: [] },
      product: { product_type: 'ETF', has_listing: true },
      listings: [{ listing_id: 'EODHD:TEST.US', is_primary: true, data_sources: ['eodhd'] }],
      quality: { status: 'PROVISIONAL_ADMIN', warnings: [], validation_errors: [], review_flags: [] },
      source_metadata: { source: 'EODHD', universal_export_present: false },
    };
    expect(validators.masterAssetMarket(market)).toEqual({ ok: true, errors: [] });
  });
});
