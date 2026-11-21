import { describe, expect, it } from 'vitest';
import { diffPaths, ownedDrift } from '../src/loader/driftCriteria';
import { mergeOwnedDetailed, rewriteDrift } from '../src/loader/republish';

const NOW = '2026-10-14T00:00:00.000Z';

function fundRoot(extra: Record<string, unknown> = {}): any {
    return {
        asset_id: 'LU0000000001',
        asset_type: 'FUND',
        schema_version: 'master.asset.v1.2',
        identity: { name: 'Fondo de prueba', currency: 'EUR' },
        identifiers: { isin: 'LU0000000001' },
        listings: [],
        classification: { asset_class: 'RV' },
        product: { product_type: 'fund', has_listing: false },
        costs: { management_fee_pct: 1, ter_pct: 1.2 },
        performance: { returns: { trailing_pct: { '1y': 5 } }, valuation: null },
        risk: { srri_1a7: 6, sri_kid_1a7: 4 },
        sustainability: null,
        portfolio_exposure: null,
        fixed_income_profile: null,
        quality: { status: 'ACCEPTED', warnings: [], validation_errors: [], review_flags: [] },
        source_metadata: { source: 'FondosDB', source_file: 'export_bdb/LU0000000001.json', universal_export_present: true, firestore_preview_only: true },
        ...extra
    };
}

function stockRoot(extra: Record<string, unknown> = {}): any {
    return {
        asset_id: 'US0000000001',
        asset_type: 'STOCK',
        schema_version: 'master.asset-stock.v1.1',
        currency: 'USD',
        identity: { name: 'Accion de prueba', currency: 'USD' },
        identifiers: { isin: 'US0000000001' },
        classification: { asset_class: 'EQUITY' },
        product: { product_type: 'stock' },
        listings: [],
        fundamentals: { pe_ratio: 20 },
        quality: { status: 'ACCEPTED' },
        source_metadata: { source: 'FondosDB' },
        ...extra
    };
}

describe('MEDIA-9: claves obsoletas en subobjetos del vivo', () => {
    it('una clave del vivo que el canonico ya no trae, dentro de un bloque de la plataforma, es deriva', () => {
        const expected = fundRoot();
        const live = fundRoot({ risk: { srri_1a7: 6, sri_kid_1a7: 4, srri_fuente: 'morningstar' } });
        expect(ownedDrift(expected, live, false)).toEqual(['risk.srri_fuente']);
    });

    it('tambien en niveles profundos', () => {
        const live = fundRoot({ performance: { returns: { trailing_pct: { '1y': 5, '15y': 2 } }, valuation: null } });
        expect(ownedDrift(fundRoot(), live, false)).toEqual(['performance.returns.trailing_pct.15y']);
    });

    it('una clave obsoleta con valor nulo no es deriva (nulo y ausente valen lo mismo)', () => {
        const live = fundRoot({ costs: { management_fee_pct: 1, ter_pct: 1.2, entry_fee_pct: null } });
        expect(ownedDrift(fundRoot(), live, false)).toEqual([]);
    });

    it('lo que es de la app segun x-owner-exceptions no es deriva: performance.valuation', () => {
        const valuation = { vl: 10.5, vl_fecha: '2026-10-13', fuente: 'price_refresh' };
        const expected = fundRoot({ performance: { returns: { trailing_pct: { '1y': 5 } } } });
        const live = fundRoot({ performance: { returns: { trailing_pct: { '1y': 5 } }, valuation } });
        expect(ownedDrift(expected, live, false)).toEqual([]);
        // ni siquiera cuando el canonico trae valuation: null (asi la emite el mapper)
        expect(ownedDrift(fundRoot(), live, false)).toEqual([]);
        // ni dentro de valuation
        expect(ownedDrift(fundRoot({ performance: { returns: { trailing_pct: { '1y': 5 } }, valuation: { vl: 9 } } }), live, false)).toEqual([]);
    });

    it('los bloques raiz de la app o legado no son deriva aunque difieran', () => {
        const expected = fundRoot({ holdings_summary: { positions_count: 10 }, fundamentals: { pe_ratio: 12 }, retrocession: 0.5 });
        const live = fundRoot({ holdings_summary: { positions_count: 99, extra: true }, fundamentals: { pe_ratio: 15, stale: 1 }, retrocession: 0.7 });
        expect(ownedDrift(expected, live, false)).toEqual([]);
    });

    it('fundamentals es de la plataforma en acciones (y currency, legado)', () => {
        const live = stockRoot({ currency: 'EUR', fundamentals: { pe_ratio: 20, dividend_yield: 1.5 } });
        expect(ownedDrift(stockRoot(), live, true)).toEqual(['fundamentals.dividend_yield']);
        // sin el tercer argumento se deduce de asset_type
        expect(ownedDrift(stockRoot(), live)).toEqual(['fundamentals.dividend_yield']);
    });

    it('las claves raiz que el canonico no trae no son deriva: el merge las conserva', () => {
        const expected = fundRoot();
        delete expected.sustainability;
        const live = fundRoot({ sustainability: { sfdr_article: 8 } });
        expect(ownedDrift(expected, live, false)).toEqual([]);
    });

    it('los bloques de otras tuberias siguen fuera (listings, source_metadata)', () => {
        const live = fundRoot({ listings: [{ ticker: 'X' }], source_metadata: { source: 'FondosDB', extra: 'x' } });
        expect(ownedDrift(fundRoot(), live, false)).toEqual([]);
    });

    it('diffPaths sin opciones no cambia (metricas y search_index): solo las claves del esperado', () => {
        const out: string[] = [];
        diffPaths({ a: { b: 1 } }, { a: { b: 1, c: 2 } }, '', out);
        expect(out).toEqual([]);
        const withStale: string[] = [];
        diffPaths({ a: { b: 1 } }, { a: { b: 1, c: 2 } }, '', withStale, { staleKeys: true });
        expect(withStale).toEqual(['a.c']);
    });

    it('coherente con el merge: la deriva por clave obsoleta se reescribe y luego desaparece', () => {
        const expected = fundRoot();
        const live = fundRoot({ risk: { srri_1a7: 6, sri_kid_1a7: 4, srri_fuente: 'morningstar' } });
        const merged = mergeOwnedDetailed(live, expected, false, NOW);
        expect(merged.doc.risk).toEqual({ srri_1a7: 6, sri_kid_1a7: 4 });
        // antes de MEDIA-9 rewriteDrift devolvia [] y la clave obsoleta no se limpiaba nunca
        expect(rewriteDrift(live, expected, merged.doc, false)).toEqual(['risk.srri_fuente']);
        const after = JSON.parse(JSON.stringify(merged.doc));
        expect(rewriteDrift(after, expected, merged.doc, false)).toEqual([]);
        expect(ownedDrift(expected, after, false)).toEqual([]);
    });

    it('lo que el merge conserva a proposito (evidencia SRI de la app) no obliga a reescribir', () => {
        const evidence = { sri: 4, date: '2026-09-07', source: 'morningstar_via_finect' };
        const live = fundRoot({ risk: { srri_1a7: 6, sri_kid_1a7: 4, sri_kid_evidence: evidence } });
        const expected = fundRoot();
        expect(ownedDrift(expected, live, false)).toEqual(['risk.sri_kid_evidence']);
        const merged = mergeOwnedDetailed(live, expected, false, NOW);
        expect(merged.legacyKept).toEqual(['risk.sri_kid_evidence']);
        expect(rewriteDrift(live, expected, merged.doc, false)).toEqual([]);
    });
});
