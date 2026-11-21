import { describe, it, expect } from 'vitest';
import { mapFondosDbHoldings, classifyInstrument, parseWeight } from '../src/mappers/fondosHoldingsMapper';

describe('FondosDB Holdings Mapper', () => {
    describe('parseWeight', () => {
        it('parses numbers correctly', () => {
            expect(parseWeight(4.5)).toBe(4.5);
            expect(parseWeight(0)).toBe(0);
        });

        it('parses strings correctly', () => {
            expect(parseWeight('4.5')).toBe(4.5);
            expect(parseWeight('4,5')).toBe(4.5);
            expect(parseWeight('4.5%')).toBe(4.5);
        });

        it('returns null for invalid values', () => {
            expect(parseWeight(null)).toBe(null);
            expect(parseWeight(undefined)).toBe(null);
            expect(parseWeight('invalid')).toBe(null);
        });
    });

    describe('classifyInstrument', () => {
        it('classifies equities', () => {
            expect(classifyInstrument('Equity')).toBe('equity');
            expect(classifyInstrument('Acción común')).toBe('equity');
            expect(classifyInstrument(undefined, undefined, 'Apple Stock')).toBe('equity');
        });

        it('classifies bonds', () => {
            expect(classifyInstrument('Bond')).toBe('bond');
            expect(classifyInstrument('Bono corporativo')).toBe('bond');
            expect(classifyInstrument('Fixed Income')).toBe('bond');
        });

        it('classifies cash', () => {
            expect(classifyInstrument('Cash')).toBe('cash');
            expect(classifyInstrument(undefined, undefined, 'Euro Cash Account')).toBe('cash');
        });

        it('returns unknown for unrecognized types', () => {
            expect(classifyInstrument('Weird Type')).toBe('unknown');
        });
    });

    describe('mapFondosDbHoldings', () => {
        it('maps a valid array of holdings', () => {
            const raw = [
                { name: 'Apple Inc', weight: '4.5', assetClass: 'Equity', isin: 'US0378331005' },
                { name: 'US Treasury', weight: 90, assetClass: 'Bond', maturity: '2030-01-01', coupon: 2.5 },
                { name: 'Cash', weight: 5.5, assetClass: 'Cash' }
            ];

            const result = mapFondosDbHoldings('FUND_123', 'IE0000000000', '2023-10-01', raw);
            const holdings = result.holdings!;
            
            expect(result.fund_asset_id).toBe('FUND_123');
            expect(result.holdings_count).toBe(3);
            expect(result.total_reported_weight).toBe(100);
            expect(result.warnings.length).toBe(0);
            expect(result.quality_summary.has_critical_warnings).toBe(false);
            expect(result.quality_summary.coverage_ratio).toBe(1);

            // Sorted descending
            expect(holdings[0].holding_name).toBe('US Treasury');
            expect(holdings[0].instrument_type).toBe('bond');
            expect(holdings[0].coupon).toBe(2.5);
            expect(holdings[1].holding_name).toBe('Cash');
            expect(holdings[2].holding_name).toBe('Apple Inc');
        });

        it('generates a warning for total weight outside 90-110%', () => {
            const raw = [
                { name: 'Apple Inc', weight: '50' }
            ];

            const result = mapFondosDbHoldings('FUND_123', undefined, undefined, raw);
            expect(result.total_reported_weight).toBe(50);
            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.warnings[0]).toContain('suspicious: 50.00%');
            expect(result.quality_summary.has_critical_warnings).toBe(true);
        });

        it('generates warnings for missing weights', () => {
            const raw = [
                { name: 'Apple Inc', weight: 'invalid' },
                { name: 'Microsoft', weight: 100 }
            ];

            const result = mapFondosDbHoldings('FUND_123', undefined, undefined, raw);
            expect(result.quality_summary.missing_weights_count).toBe(1);
            expect(result.holdings!.find(h => h.holding_name === 'Apple Inc')?.holding_weight).toBe(null);
            expect(result.holdings!.find(h => h.holding_name === 'Apple Inc')?.quality_flags).toContain('MISSING_WEIGHT');
        });

        it('omits non-finite coupons and records a quality flag', () => {
            const result = mapFondosDbHoldings('FUND_123', undefined, undefined, [
                { name: 'Invalid bond', weight: 100, assetClass: 'Bond', coupon: 'not-a-number' }
            ]);

            expect(result.holdings![0].coupon).toBeUndefined();
            expect(result.holdings![0].quality_flags).toContain('INVALID_COUPON');
            expect(result.warnings).toContain('Holding "Invalid bond" has an invalid coupon.');
            expect(JSON.stringify(result)).not.toContain('NaN');
        });
    });
});
