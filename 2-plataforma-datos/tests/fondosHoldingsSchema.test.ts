import { describe, it, expect } from 'vitest';
import { validateFundHolding, validateFundHoldingsPayload } from '../src/schemas/fondosHoldingsSchema';

describe('FondosDB Holdings Schema Validations (Pure TS)', () => {
    it('validates a valid holding with minimal required fields', () => {
        const validHolding = {
            holding_id: 'test_id_123',
            source: 'fondosdb',
            fund_asset_id: 'FUND_123',
            holding_name: 'Apple Inc',
            holding_weight: 4.5,
            holding_weight_unit: 'percent',
            instrument_type: 'equity',
        };
        const result = validateFundHolding(validHolding);
        expect(result.success).toBe(true);
    });

    it('rejects an invalid instrument_type', () => {
        const invalidHolding = {
            holding_id: 'test_id_123',
            source: 'fondosdb',
            fund_asset_id: 'FUND_123',
            holding_name: 'Weird Asset',
            holding_weight: 1.0,
            holding_weight_unit: 'percent',
            instrument_type: 'magic_bean', // invalid
        };
        const result = validateFundHolding(invalidHolding);
        expect(result.success).toBe(false);
        expect(result.errors).toContain('instrument_type is invalid');
    });

    it('allows a holding with no weight (nullable)', () => {
        const nullWeightHolding = {
            holding_id: 'test_id_123',
            source: 'fondosdb',
            fund_asset_id: 'FUND_123',
            holding_name: 'Unweighed Asset',
            holding_weight: null,
            holding_weight_unit: 'percent',
            instrument_type: 'unknown',
        };
        const result = validateFundHolding(nullWeightHolding);
        expect(result.success).toBe(true);
    });

    it('validates a complete payload', () => {
        const validPayload = {
            fund_asset_id: 'FUND_123',
            fund_isin: 'IE00B4L5Y983',
            holdings_count: 1,
            total_reported_weight: 100,
            holdings: [
                {
                    holding_id: 'test_id_123',
                    source: 'fondosdb',
                    fund_asset_id: 'FUND_123',
                    holding_name: 'Apple Inc',
                    holding_weight: 100,
                    holding_weight_unit: 'percent',
                    instrument_type: 'equity',
                }
            ],
            quality_summary: {
                missing_weights_count: 0,
                unknown_instrument_types_count: 0,
                coverage_ratio: 1,
                has_critical_warnings: false
            },
            warnings: []
        };
        const result = validateFundHoldingsPayload(validPayload);
        expect(result.success).toBe(true);
    });
});
