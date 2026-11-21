import { describe, expect, it } from 'vitest';
import { validators } from '../contracts/validators';
import { FUND_OWNERSHIP, STOCK_OWNERSHIP, platformOwnedKeys, readOwnership } from '../src/loader/ownership';
import { mergeOwned, mergeOwnedDetailed, OwnershipConflictError, rewriteDrift } from '../src/loader/republish';
import { ownedDrift } from '../src/loader/driftCriteria';

const NOW = '2026-10-14T00:00:00.000Z';

function fundRoot(extra: Record<string, unknown> = {}): any {
    return {
        asset_id: 'LU0000000001',
        asset_type: 'FUND',
        schema_version: 'master.asset.v1.1',
        identity: { name: 'Fondo de prueba', currency: 'EUR' },
        identifiers: { isin: 'LU0000000001' },
        listings: [],
        classification: { asset_class: 'RV' },
        product: { product_type: 'fund', has_listing: false },
        costs: { management_fee_pct: 1, ter_pct: 1.2, mifid_ongoing_pct: 1.3 },
        performance: { returns: { trailing_pct: {} }, valuation: null },
        risk: { srri_1a7: 6, sri_kid_1a7: 4 },
        sustainability: null,
        portfolio_exposure: null,
        fixed_income_profile: null,
        quality: { status: 'ACCEPTED', warnings: [], validation_errors: [], review_flags: [] },
        source_metadata: { source: 'FondosDB', source_file: 'export_bdb/LU0000000001.json', universal_export_present: true, firestore_preview_only: true },
        ...extra
    };
}

function kidEvidence(extra: Record<string, unknown> = {}) {
    return {
        sri: 4, date: '2026-09-07', url: 'https://example.test/kid.pdf', sha256: 'ab'.repeat(32),
        document_type: 'PRIIPS_KID', verified_isin: 'LU0000000001', source: 'morningstar_via_finect',
        verified_at: '2026-09-28T07:46:12+00:00', verification_run: 'fund-quality-phase2-2026-09-28', ...extra
    };
}

describe('dueno de cada bloque, leido del contrato', () => {
    it('todas las claves raiz declaran x-owner', () => {
        expect(Object.keys(FUND_OWNERSHIP.owners).length).toBeGreaterThan(15);
        expect(() => readOwnership({ properties: { asset_id: {} } } as any)).toThrow(/CONTRACT_OWNER_MISSING/);
    });

    it('los bloques de la plataforma son los de antes mas regulatory y provenance', () => {
        expect(new Set(platformOwnedKeys(false))).toEqual(new Set([
            'asset_type', 'identity', 'identifiers', 'listings', 'classification', 'product', 'costs', 'performance',
            'risk', 'sustainability', 'portfolio_exposure', 'fixed_income_profile', 'quality', 'source_metadata',
            'regulatory', 'provenance'
        ]));
        expect(new Set(platformOwnedKeys(true))).toEqual(new Set([
            'asset_type', 'identity', 'identifiers', 'classification', 'product', 'listings', 'performance', 'risk',
            'fundamentals', 'portfolio_exposure', 'quality', 'source_metadata', 'provenance'
        ]));
        expect(FUND_OWNERSHIP.exceptions).toEqual([{ path: 'performance.valuation', owner: 'app' }]);
        expect(STOCK_OWNERSHIP.owners.currency).toBe('legado');
    });

    it('asset.v1.2 acepta todo documento v1.1 valido y rechaza claves raiz no declaradas', () => {
        const root = fundRoot();
        expect(validators.masterAssetV11(root).ok).toBe(true);
        expect(validators.masterAssetV12(root).ok).toBe(true);
        expect(validators.masterAssetV12({ ...root, is_investable: false }).ok).toBe(false);
        expect(validators.masterAssetV12({ ...root, quality: { ...root.quality, review_note: 'x' } }).ok).toBe(false);
    });

    it('asset.v1.3 anade el indice oficial y es superconjunto de v1.2', () => {
        const root = fundRoot();
        expect(validators.masterAssetV13(root).ok).toBe(true);

        const conIndice = { ...root, classification: { ...root.classification, official_benchmark: 'MSCI World NR EUR' } };
        expect(validators.masterAssetV13(conIndice).ok).toBe(true);
        // La frontera de version: el indice solo existe desde v1.3.
        expect(validators.masterAssetV12(conIndice).ok).toBe(false);

        // Un indice nulo es ausencia declarada; una cadena vacia no es un indice.
        expect(validators.masterAssetV13({ ...root, classification: { ...root.classification, official_benchmark: null } }).ok).toBe(true);
        expect(validators.masterAssetV13({ ...root, classification: { ...root.classification, official_benchmark: '' } }).ok).toBe(false);
    });
});

describe('mergeOwned no pisa lo que no es de la plataforma', () => {
    it('conserva app y legado, reemplaza la plataforma y borra solo claves declaradas obsoletas', () => {
        const live = fundRoot({
            holdings_summary: { has_holdings: true, full_holdings_loaded: false, positions_count: 10 },
            fundamentals: { source: 'legacy' },
            performance: { returns: { old: true }, valuation: { vl: 10, vl_fecha: '2026-10-13' } },
            currency: 'EUR'
        });
        const expected = fundRoot({ performance: { returns: { new: true }, valuation: null }, regulatory: { version: 1, sri: 4 } });
        const doc = mergeOwned(live, expected, false, NOW);
        expect(doc.holdings_summary).toEqual(live.holdings_summary);
        expect(doc.fundamentals).toEqual({ source: 'legacy' });
        expect(doc.performance).toEqual({ returns: { new: true }, valuation: { vl: 10, vl_fecha: '2026-10-13' } });
        expect(doc.regulatory).toEqual({ version: 1, sri: 4 });
        expect(doc.currency).toBeUndefined();
        expect(doc.schema_version).toBe('master.asset.v1.3');
        expect(validators.masterAssetV13(doc).ok).toBe(true);
    });

    it('no reescribe un documento con una clave raiz que el contrato no declara', () => {
        const live = fundRoot({ is_investable: false });
        expect(() => mergeOwned(live, fundRoot(), false, NOW)).toThrow(OwnershipConflictError);
    });

    it('una alta documental de la app solo pasa al canonico con decision explicita', () => {
        const live = fundRoot({ source_metadata: { source: 'MANUAL_DOCUMENTARY', source_detail: 'Robeco' } });
        expect(() => mergeOwned(live, fundRoot(), false, NOW)).toThrow(/REPUBLISH_MANUAL_DOCUMENTARY/);
        expect(mergeOwned(live, fundRoot(), false, NOW, { acceptCanonical: true }).source_metadata.source).toBe('FondosDB');
    });
});

describe('evidencia verificada por la app (transitorio hasta correcciones.json)', () => {
    it('conserva la evidencia si el canonico trae el mismo SRI y no la produce', () => {
        const live = fundRoot({ risk: { srri_1a7: 6, sri_kid_1a7: 4, sri_kid_evidence: kidEvidence() } });
        const result = mergeOwnedDetailed(live, fundRoot(), false, NOW);
        expect(result.doc.risk.sri_kid_evidence).toEqual(kidEvidence());
        expect(result.legacyKept).toEqual(['risk.sri_kid_evidence']);
    });

    it('la evidencia del canonico sustituye a la de la app cuando el SRI coincide', () => {
        const live = fundRoot({ risk: { srri_1a7: 6, sri_kid_1a7: 4, sri_kid_evidence: kidEvidence() } });
        const fromKid = kidEvidence({ source: 'deutsche_bank_es', verification_run: 'extractor:kid_gestora:deutsche_bank_es' });
        const expected = fundRoot({ risk: { srri_1a7: 6, sri_kid_1a7: 4, sri_kid_evidence: fromKid } });
        const result = mergeOwnedDetailed(live, expected, false, NOW);
        expect(result.doc.risk.sri_kid_evidence).toEqual(fromKid);
        expect(result.legacyKept).toEqual([]);
    });

    it('si el canonico contradice el SRI verificado no reescribe: conflicto para Oscar', () => {
        const live = fundRoot({ risk: { srri_1a7: 6, sri_kid_1a7: 4, sri_kid_evidence: kidEvidence() } });
        const expected = fundRoot({ risk: { srri_1a7: 6, sri_kid_1a7: 6 } });
        expect(() => mergeOwnedDetailed(live, expected, false, NOW)).toThrow(/canonico 6, KID verificado 4/);
        const accepted = mergeOwnedDetailed(live, expected, false, NOW, { acceptCanonical: true });
        expect(accepted.doc.risk).toEqual({ srri_1a7: 6, sri_kid_1a7: 6 });
    });

    it('renta fija documentada: rellena huecos del canonico y bloquea si lo contradice', () => {
        const provenance = { yield_to_maturity: { source: 'trea', as_of_date: '2026-08-31' } };
        const live = fundRoot({ fixed_income_profile: { yield_to_maturity: 4.08, effective_duration: null, field_provenance: provenance } });
        const gap = mergeOwnedDetailed(live, fundRoot({ fixed_income_profile: { yield_to_maturity: null, effective_duration: 1.2 } }), false, NOW);
        expect(gap.doc.fixed_income_profile).toEqual({ yield_to_maturity: 4.08, effective_duration: 1.2, field_provenance: provenance });
        expect(() => mergeOwnedDetailed(live, fundRoot({ fixed_income_profile: { yield_to_maturity: 3.5 } }), false, NOW))
            .toThrow(/fixed_income_profile.yield_to_maturity/);
    });
});

describe('rewriteDrift: lo que cambiaria de verdad al reescribir', () => {
    const provenance = { yield_to_maturity: { source: 'trea', as_of_date: '2026-08-31' } };
    const live = fundRoot({ fixed_income_profile: { yield_to_maturity: 4.08, effective_duration: 1.2, field_provenance: provenance } });

    it('renta fija documentada que el merge conserva: el canonico difiere pero no hay nada que escribir', () => {
        const expected = fundRoot({ fixed_income_profile: { yield_to_maturity: null, effective_duration: 1.2 } });
        expect(ownedDrift(expected, live)).toEqual(['fixed_income_profile.yield_to_maturity', 'fixed_income_profile.field_provenance']);
        const merged = mergeOwnedDetailed(live, expected, false, NOW);
        expect(rewriteDrift(live, expected, merged.doc, false)).toEqual([]);
    });

    it('si el canonico cambia otro campo, si hay que reescribir', () => {
        const expected = fundRoot({ fixed_income_profile: { yield_to_maturity: null, effective_duration: 1.5 } });
        const merged = mergeOwnedDetailed(live, expected, false, NOW);
        expect(rewriteDrift(live, expected, merged.doc, false)).toEqual(['fixed_income_profile.effective_duration']);
    });

    it('una clave raiz obsoleta en el vivo obliga a reescribir', () => {
        const withObsolete = { ...live, currency: 'EUR' };
        const expected = fundRoot({ fixed_income_profile: { yield_to_maturity: null, effective_duration: 1.2 } });
        const merged = mergeOwnedDetailed(withObsolete, expected, false, NOW);
        expect(merged.doc.currency).toBeUndefined();
        expect(rewriteDrift(withObsolete, expected, merged.doc, false)).toEqual(['currency']);
    });

    it('postverify: lo escrito coincide con el documento fusionado aunque no con el canonico', () => {
        const expected = fundRoot({ fixed_income_profile: { yield_to_maturity: null, effective_duration: 1.5 } });
        const merged = mergeOwnedDetailed(live, expected, false, NOW);
        const after = JSON.parse(JSON.stringify(merged.doc));
        expect(ownedDrift(expected, after)).toEqual(['fixed_income_profile.yield_to_maturity', 'fixed_income_profile.field_provenance']);
        expect(rewriteDrift(after, expected, merged.doc, false)).toEqual([]);
    });
});
