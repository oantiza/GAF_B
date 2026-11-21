import { describe, expect, it } from 'vitest';
import { validators } from '../contracts/validators';
import { isValidIsin, mapFondosDbFund } from '../src/ingestion/fondosdb/fondosDbMapper';

describe('FondosDB mapper', () => {
    it('mapea identity, identifiers y costs sin crear listing ficticio', () => {
        const mapped = mapFondosDbFund('BE0946564383.json', {
            isin: 'BE0946564383',
            name: 'DPAM B - Equities NewGems Sustainable B Cap',
            currency: 'EUR',
            generated_at: '2026-06-12T08:05:26',
            report_date: '2026-05-31',
            ms: {
                category_morningstar: 'EAA Fund Global Large-Cap Growth Equity',
                costs: {
                    management_fee: 1.6,
                    ter: 1.73,
                    mifid_ongoing: 1.73486
                },
                fixed_income: {}
            },
            derived: {
                asset_class: 'RV',
                primary_region: 'Global',
                confidence: 0.9
            },
            classification_v2: {
                asset_type: 'equity',
                commercial_type: 'EAA Fund Global Large-Cap Growth Equity',
                vehicle_complexity: 'standard'
            },
            validation: {
                ok: true,
                diagnostics: { calidad_fondosdb: 'ALTO' }
            },
            quality: {
                ok: true,
                warnings: []
            }
        });

        expect(mapped.status).toBe('ACCEPTED');
        expect(mapped.asset?.asset_id).toBe('BE0946564383');
        expect(mapped.asset?.asset_type).toBe('FUND');
        expect(mapped.asset?.identity.name).toContain('DPAM');
        expect(mapped.asset?.identifiers?.isin).toBe('BE0946564383');
        expect(mapped.asset?.listings).toEqual([]);
        expect(mapped.asset?.costs?.ter_pct).toBe(1.73);
        expect(mapped.asset?.costs?.retrocession).toBeUndefined();
    });

    it('mapea rating Morningstar y rellena asset_mix.other residual', () => {
        const mapped = mapFondosDbFund('DE0005318406.json', {
            isin: 'DE0005318406',
            name: 'Example Fund',
            currency: 'EUR',
            rating_stars: 4,
            ms: {
                category_morningstar: 'EAA Fund Flexible Allocation',
                costs: {},
                fixed_income: {}
            },
            derived: { asset_class: 'MIXTO' },
            classification_v2: { asset_type: 'allocation' },
            portfolio_exposure_v2: {
                asset_mix: { equity: 0.4, bond: 0.3, cash: 0.1 }
            },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } }
        });

        expect(mapped.asset?.classification?.morningstar_rating).toBe(4);
        expect(mapped.asset?.portfolio_exposure?.asset_mix.other).toBeCloseTo(0.2, 6);
        expect(mapped.asset?.quality.review_flags).toContain('EXPOSURE_RESIDUAL_IMPUTED');
    });

    it('mapea ticker y listing primario para ETF cuando FondosDB lo trae', () => {
        const mapped = mapFondosDbFund('IE00B4L5Y983.json', {
            isin: 'IE00B4L5Y983',
            name: 'iShares Core MSCI World UCITS ETF USD (Acc)',
            currency: 'EUR',
            identifiers: {
                ticker: 'IWDA',
                exchange: 'XETRA',
                eodhd_code: 'IWDA.XETRA',
                source_listing_id: 'EODHD:IWDA.XETRA'
            },
            ms: {
                category_morningstar: 'RV Global Cap. Grande Blend',
                costs: {},
                fixed_income: {}
            },
            derived: { asset_class: 'RV', primary_region: 'Global' },
            classification_v2: {
                asset_type: 'equity',
                commercial_type: 'ETF RV Global',
                vehicle_complexity: 'index'
            },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } }
        });

        expect(mapped.status).toBe('ACCEPTED');
        expect(mapped.asset?.asset_type).toBe('ETF');
        expect(mapped.asset?.identifiers?.ticker).toBe('IWDA');
        expect(mapped.asset?.identifiers?.eodhd_code).toBe('IWDA.XETRA');
        expect(mapped.asset?.product.has_listing).toBe(true);
        expect(mapped.asset?.listings).toEqual([{
            listing_id: 'EODHD:IWDA.XETRA',
            ticker: 'IWDA',
            exchange: 'XETRA',
            currency: 'EUR',
            eodhd_code: 'IWDA.XETRA',
            source_listing_id: 'EODHD:IWDA.XETRA',
            is_primary: true,
            data_sources: ['fondosdb', 'eodhd']
        }]);
        expect(validators.masterAssetV11(mapped.asset).ok).toBe(true);
    });

    it('mapea listing minimo para ETF con ticker y sin mercado', () => {
        const mapped = mapFondosDbFund('IE000DR59CI3.json', {
            isin: 'IE000DR59CI3',
            name: 'iShares Energy Storage & Hydrogen UCITS ETF USD (Acc)',
            currency: 'USD',
            identifiers: {
                ticker: 'STOR',
                exchange: null,
                eodhd_code: null,
                source_listing_id: null
            },
            ms: {
                category_morningstar: 'RV Otros',
                costs: {},
                fixed_income: {}
            },
            derived: { asset_class: 'RV', primary_region: 'Global' },
            classification_v2: {
                asset_type: 'equity',
                commercial_type: 'ETF RV Sectorial',
                vehicle_complexity: 'index'
            },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } }
        });

        expect(mapped.status).toBe('ACCEPTED');
        expect(mapped.asset?.asset_type).toBe('ETF');
        expect(mapped.asset?.product.has_listing).toBe(true);
        expect(mapped.asset?.listings).toEqual([{
            listing_id: 'TICKER:STOR',
            ticker: 'STOR',
            currency: 'USD'
        }]);
        expect(validators.masterAssetV11(mapped.asset).ok).toBe(true);
    });

    it('mantiene ETF listable sin inventar listing cuando no hay ticker', () => {
        const mapped = mapFondosDbFund('IE00B3Q19T94.json', {
            isin: 'IE00B3Q19T94',
            name: 'Vanguard FTSE All-World UCITS ETF',
            currency: 'USD',
            identifiers: {
                ticker: null,
                exchange: null,
                eodhd_code: null,
                source_listing_id: null
            },
            ms: {
                category_morningstar: 'RV Global Cap. Grande Blend',
                costs: {},
                fixed_income: {}
            },
            derived: { asset_class: 'RV', primary_region: 'Global' },
            classification_v2: {
                asset_type: 'equity',
                commercial_type: 'ETF RV Global',
                vehicle_complexity: 'index'
            },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } }
        });

        expect(mapped.status).toBe('ACCEPTED');
        expect(mapped.asset?.asset_type).toBe('ETF');
        expect(mapped.asset?.product.has_listing).toBe(true);
        expect(mapped.asset?.identifiers?.ticker).toBeUndefined();
        expect(mapped.asset?.listings).toEqual([]);
        expect(validators.masterAssetV11(mapped.asset).ok).toBe(true);
    });

    it('prioriza identificacion.tipo sobre una heuristica de nombre', () => {
        const mapped = mapFondosDbFund('IE00B3Q19T94.json', {
            isin: 'IE00B3Q19T94',
            name: 'Index Tracker Global',
            currency: 'EUR',
            ms: { category_morningstar: 'RV Global', costs: {}, fixed_income: {} },
            derived: { asset_class: 'RV' },
            classification_v2: { asset_type: 'equity' },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } }
        }, {
            identificacion: { tipo: 'etf' }
        });

        expect(mapped.asset?.asset_type).toBe('ETF');
        expect(mapped.asset?.product.product_type).toBe('ETF');
    });

    it('no detecta ETF dentro de otra palabra en el fallback de nombre', () => {
        const mapped = mapFondosDbFund('BE0946564383.json', {
            isin: 'BE0946564383',
            name: 'BETFuture Global Fund',
            currency: 'EUR',
            ms: { category_morningstar: 'RV Global', costs: {}, fixed_income: {} },
            derived: { asset_class: 'RV' },
            classification_v2: { asset_type: 'equity' },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } }
        });

        expect(mapped.asset?.asset_type).toBe('FUND');
        expect(mapped.asset?.product.product_type).toBe('fund');
    });

    it('un tipo fondo explicito prevalece sobre ETF en el nombre', () => {
        const mapped = mapFondosDbFund('BE0946564383.json', {
            isin: 'BE0946564383',
            name: 'Global Opportunities ETF Selection',
            currency: 'EUR',
            ms: { category_morningstar: 'RV Global', costs: {}, fixed_income: {} },
            derived: { asset_class: 'RV' },
            classification_v2: { asset_type: 'equity' },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } }
        }, {
            identificacion: { tipo: 'fondo' }
        });

        expect(mapped.asset?.asset_type).toBe('FUND');
        expect(mapped.asset?.product.product_type).toBe('fund');
    });

    it('mapea RF y perfil fixed_income sin mezclarlo con price metrics', () => {
        const mapped = mapFondosDbFund('ES0116419005.json', {
            isin: 'ES0116419005',
            name: 'Cartera Renta Fija Horizonte 2026 FI',
            currency: 'EUR',
            ms: {
                category_morningstar: 'EAA Fund Fixed Term Bond',
                costs: {},
                fixed_income: {
                    effective_duration: 1.2,
                    yield_to_maturity: 2.4,
                    avg_credit_quality: 'A',
                    ytw_distribution: { '1_3': 0.5 },
                    maturity_allocation: { '1_3': 40 }
                }
            },
            derived: { asset_class: 'RF' },
            classification_v2: {
                asset_type: 'fixed_income',
                commercial_type: 'EAA Fund Fixed Term Bond'
            },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } }
        });

        expect(mapped.status).toBe('ACCEPTED');
        expect(mapped.asset?.fixed_income_profile?.yield_to_maturity).toBe(2.4);
        expect((mapped.asset as any)?.metrics_latest).toBeUndefined();
        expect((mapped.asset as any)?.price_series).toBeUndefined();
    });

    it('acepta duracion e YTM cero como valores RF presentes', () => {
        const mapped = mapFondosDbFund('ES0116419005.json', {
            isin: 'ES0116419005',
            name: 'Cartera Renta Fija Cero FI',
            currency: 'EUR',
            ms: {
                category_morningstar: 'EAA Fund Fixed Term Bond',
                costs: {},
                fixed_income: {
                    effective_duration: 0,
                    yield_to_maturity: 0,
                    avg_credit_quality: 'AAA'
                }
            },
            derived: { asset_class: 'RF' },
            classification_v2: {
                asset_type: 'fixed_income',
                commercial_type: 'EAA Fund Fixed Term Bond'
            },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } }
        });

        expect(mapped.status).toBe('ACCEPTED');
        expect(mapped.review_reasons).not.toContain(
            'RF critica sin duracion, yield o calidad crediticia completa.'
        );
        expect(mapped.asset?.fixed_income_profile?.effective_duration).toBe(0);
        expect(mapped.asset?.fixed_income_profile?.yield_to_maturity).toBe(0);
    });

    it('rechaza ISIN invalido', () => {
        const mapped = mapFondosDbFund('BAD.json', {
            isin: 'LU123',
            name: 'Bad Fund',
            currency: 'EUR',
            ms: { fixed_income: {} },
            derived: { asset_class: 'RV' },
            classification_v2: { asset_type: 'equity' }
        });

        expect(mapped.status).toBe('REJECTED');
        expect(mapped.reject_reasons.join(' ')).toContain('ISIN invalido');
    });

    it('valida checksum ISIN real', () => {
        expect(isValidIsin('BE0946564383')).toBe(true);
        expect(isValidIsin('BE0946564384')).toBe(false);
    });
});

describe('FondosDB mapper: indice de referencia oficial', () => {
    function canonico(classificationExtra: Record<string, unknown> = {}): any {
        return {
            isin: 'BE0946564383',
            name: 'DPAM B - Equities NewGems Sustainable B Cap',
            currency: 'EUR',
            generated_at: '2026-10-30T08:05:26',
            report_date: '2026-09-30',
            ms: { category_morningstar: 'EAA Fund Global Large-Cap Growth Equity', costs: { ter: 1.73 } },
            derived: { asset_class: 'RV', primary_region: 'Global', confidence: 0.9 },
            classification_v2: { asset_type: 'equity', ...classificationExtra },
            validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } },
            quality: { ok: true, warnings: [] }
        };
    }

    it('lleva el indice del canonico a classification y valida en v1.3', () => {
        const asset: any = mapFondosDbFund('BE0946564383.json', canonico({ official_benchmark: 'MSCI World NR EUR' })).asset;
        expect(asset.classification.official_benchmark).toBe('MSCI World NR EUR');
        expect(validators.masterAssetV13(asset)).toEqual({ ok: true, errors: [] });
    });

    it('recorta el texto de la fuente', () => {
        const asset: any = mapFondosDbFund('BE0946564383.json', canonico({ official_benchmark: '  MSCI World NR EUR  ' })).asset;
        expect(asset.classification.official_benchmark).toBe('MSCI World NR EUR');
    });

    it('omite la clave cuando la fuente no trae indice, y el fondo sigue valido en v1.2', () => {
        for (const valor of [undefined, null, '', '   ', 7]) {
            const asset: any = mapFondosDbFund('BE0946564383.json',
                canonico(valor === undefined ? {} : { official_benchmark: valor })).asset;
            expect('official_benchmark' in asset.classification).toBe(false);
            expect(validators.masterAssetV13(asset).ok).toBe(true);
            expect(validators.masterAssetV12(asset).ok).toBe(true);
        }
    });
});
