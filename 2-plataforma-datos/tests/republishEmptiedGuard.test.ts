import { describe, expect, it } from 'vitest';
import {
    carriesData,
    emptiedPlatformPaths,
    isAbsenceMarker,
    isLegitimateRetirement,
    mergeOwnedDetailed,
    OwnershipConflictError
} from '../src/loader/republish';

/**
 * Guarda de vaciado del republish (14-10-2026). Casos con la forma de los reales del refresco de carteras:
 * cada test lleva el ISIN cuyo hueco reproduce.
 */
const NOW = '2026-10-14T00:00:00.000Z';

function fundRoot(extra: Record<string, unknown> = {}): any {
    return {
        asset_id: 'LU0000000001',
        asset_type: 'FUND',
        schema_version: 'master.asset.v1.2',
        identity: { name: 'Fondo de prueba', currency: 'EUR' },
        identifiers: { isin: 'LU0000000001' },
        listings: [],
        classification: { asset_class: 'RF', morningstar_rating: 3 },
        product: { product_type: 'fund', has_listing: false },
        costs: { management_fee_pct: 0.6, ter_pct: 0.82, mifid_ongoing_pct: 0.82 },
        performance: { returns: { trailing_pct: { '1a': { fondo: 1.4 } } }, valuation: null },
        risk: { srri_1a7: 4, sri_kid_1a7: 3 },
        sustainability: null,
        portfolio_exposure: { version: 'v2', asset_mix: { equity: 0, bond: 0.998, cash: 0.002, other: 0 }, warnings: [] },
        fixed_income_profile: null,
        quality: { status: 'ACCEPTED', warnings: [], validation_errors: [], review_flags: [] },
        source_metadata: { source: 'FondosDB', source_file: 'export_bdb/LU0000000001.json', universal_export_present: true, firestore_preview_only: true },
        ...extra
    };
}

function conflictOf(live: any, expected: any): OwnershipConflictError {
    try {
        mergeOwnedDetailed(live, expected, false, NOW);
    } catch (e) {
        if (e instanceof OwnershipConflictError) return e;
        throw e;
    }
    throw new Error('se esperaba un conflicto de vaciado');
}

/**
 * Lo que el merge conserva en vez de vaciar (31-10-2026). Un vaciado que la fuente ya no sirve
 * deja de abortar el documento: se conserva el valor vivo en esa ruta y se anota.
 */
function preservedOf(live: any, expected: any): string[] {
    return mergeOwnedDetailed(live, expected, false, NOW).preserved.map((row) => row.path);
}

/** Lo que el merge escribiria, sin la guarda (para mirar las rutas). */
function mergedOf(live: any, expected: any): any {
    return mergeOwnedDetailed(live, expected, false, NOW, { acceptCanonical: true }).doc;
}

const FI_LIVE = {
    effective_duration: 8.45, effective_maturity: 10.93241, avg_credit_quality: 'BBB', yield_to_maturity: 4.62198,
    modified_duration: 8.11542, credit_quality: { aaa: 0, a: 6.2, bbb: 81.6, bb: 12.0 },
    maturity_allocation: { '1_3': 0, '7_10': 21.57, over_10: 65.31 }, coupon_allocation: null
};

describe('carriesData', () => {
    it('un escalar 0 o false es dato; un objeto a cero, una lista vacia o null no', () => {
        expect(carriesData(0)).toBe(true);
        expect(carriesData(false)).toBe(true);
        expect(carriesData('')).toBe(false);
        expect(carriesData({ aaa: 0, bb: 0 })).toBe(false);
        expect(carriesData({ aaa: 0, bb: null, sub: { x: 0.2 } })).toBe(true);
        expect(carriesData([])).toBe(false);
        expect(carriesData({ warnings: ['x'], version: 'v2' })).toBe(false);
    });
});

describe('guarda de vaciado del republish', () => {
    it('LU0077500055: la renta fija pierde vencimiento, TIR y duracion modificada -> conflicto; --accept-canonical lo resuelve', () => {
        const live = fundRoot({ fixed_income_profile: FI_LIVE });
        const expected = fundRoot({
            fixed_income_profile: { ...FI_LIVE, effective_maturity: null, yield_to_maturity: null, modified_duration: null }
        });
        const merged = mergeOwnedDetailed(live, expected, false, NOW);
        expect(merged.preserved.map((row) => row.path)).toEqual([
            'fixed_income_profile.effective_maturity',
            'fixed_income_profile.yield_to_maturity',
            'fixed_income_profile.modified_duration'
        ]);
        expect(merged.preserved.every((row) => row.reason === 'fuente_retirada')).toBe(true);
        // Lo que importa: los valores vivos siguen ahi, y el documento SI se reescribe.
        expect(merged.doc.fixed_income_profile.yield_to_maturity).toBe(FI_LIVE.yield_to_maturity);
        expect(merged.doc.fixed_income_profile.effective_maturity).toBe(FI_LIVE.effective_maturity);
        const accepted = mergeOwnedDetailed(live, expected, false, NOW, { acceptCanonical: true });
        expect(accepted.doc.fixed_income_profile.yield_to_maturity).toBeNull();
    });

    it('LU1670722161: la calidad crediticia a cero y la exposicion de credito a null cuentan como vaciado', () => {
        const live = fundRoot({
            fixed_income_profile: FI_LIVE,
            portfolio_exposure: { asset_mix: { bond: 0.954, cash: 0.046 }, credit: { b: 0.2834, bb: 0.5524 } }
        });
        const expected = fundRoot({
            fixed_income_profile: { ...FI_LIVE, credit_quality: { aaa: 0, a: 0, bbb: 0, bb: 0 } },
            portfolio_exposure: { asset_mix: { bond: 0.954, cash: 0.046 }, credit: null }
        });
        expect(preservedOf(live, expected)).toEqual(['portfolio_exposure.credit', 'fixed_income_profile.credit_quality']);
    });

    it('LU1832969650: una asignacion imputada porque el extractor no la tiene es vaciado de asset_mix', () => {
        const live = fundRoot({ portfolio_exposure: { asset_mix: { equity: 0, bond: 0.155659, cash: 0.024343, other: 0.819997 } } });
        const expected = fundRoot({
            portfolio_exposure: { asset_mix: { equity: 0, bond: 0, cash: 0, other: 1 } },
            quality: { status: 'ACCEPTED', warnings: ['asset_allocation_unavailable'], validation_errors: [], review_flags: ['EXPOSURE_RESIDUAL_IMPUTED'] }
        });
        expect(preservedOf(live, expected)).toEqual(['portfolio_exposure.asset_mix']);
        // Si la maestra tampoco la tenia, no se pierde nada.
        const liveWithout = { ...expected, updated_at: NOW };
        expect(emptiedPlatformPaths(liveWithout, expected, false)).toEqual([]);
    });

    it('sin asignacion conocida, vaciar la renta fija no se da por retirada legitima', () => {
        const merged = fundRoot({
            portfolio_exposure: { asset_mix: { equity: 0, bond: 0, cash: 0, other: 1 } },
            quality: { status: 'ACCEPTED', warnings: ['asset_allocation_unavailable'], validation_errors: [], review_flags: [] }
        });
        expect(isLegitimateRetirement('fixed_income_profile.yield_to_maturity', merged)).toBe(false);
    });

    it('LU0995386439: renta fija a 0 % en la cartera nueva retira legitimamente sus bloques; la gestora no', () => {
        const live = fundRoot({
            classification: { asset_class: 'RV', morningstar_rating: 2 },
            portfolio_exposure: { asset_mix: { equity: 1, bond: 0 }, bond_types: { cash: 1 } },
            fixed_income_profile: { bond_sectors: { cash: 100 } },
            regulatory: { version: 1, management_company: 'EDM', domicile: 'LUX' }
        });
        const expected = fundRoot({
            classification: { asset_class: 'RV', morningstar_rating: null },
            portfolio_exposure: { asset_mix: { equity: 1, bond: 0 }, bond_types: null },
            fixed_income_profile: { bond_sectors: { cash: null } },
            regulatory: { version: 1, management_company: null, domicile: 'LUX' }
        });
        expect(preservedOf(live, expected)).toEqual(['regulatory.management_company']);
    });

    it('limite del 5 %: con la renta fija al 5 % vaciar sus bloques es conflicto; al 4,99 % es retirada legitima', () => {
        const at = (bond: number, duration: unknown) => fundRoot({
            portfolio_exposure: { asset_mix: { equity: 1 - bond, bond }, duration }
        });
        const live = at(0.05, { '1_3': 0.5, '3_5': 0.5 });
        expect(preservedOf(live, at(0.05, null))).toEqual(['portfolio_exposure.duration']);
        expect(emptiedPlatformPaths(at(0.0499, { '1_3': 0.5 }), at(0.0499, null), false)).toEqual([]);
        // ES0184949008: renta fija residual (0,001 %) que pierde los tramos de vencimiento.
        expect(emptiedPlatformPaths(at(0.00001, { '1_3': 0.5 }), at(0.00001, null), false)).toEqual([]);
    });

    it('renta variable a 0 % retira sectores y regiones; un rating retirado (estrellas, globos) nunca es conflicto', () => {
        const live = fundRoot({
            classification: { asset_class: 'RF', morningstar_rating: 4 },
            sustainability: { morningstar_sustainability_rating: 3, esg: { score: 20 } },
            portfolio_exposure: { asset_mix: { equity: 0, bond: 1 }, sectors: { technology: 0.2 }, equity_regions: { europe: 1 } }
        });
        const expected = fundRoot({
            classification: { asset_class: 'RF', morningstar_rating: null },
            sustainability: { morningstar_sustainability_rating: null, esg: { score: 21 } },
            portfolio_exposure: { asset_mix: { equity: 0, bond: 1 }, sectors: null, equity_regions: null }
        });
        expect(emptiedPlatformPaths(live, expected, false)).toEqual([]);
        expect(() => mergeOwnedDetailed(live, expected, false, NOW)).not.toThrow();
    });

    it('LU2240056445: un registro oficial que desaparece es conflicto aunque queden otros', () => {
        const registers = { cssf: { umbrella: 'LONVIA', share_class: 'RETAIL' }, esma: { status: 'Active' } };
        const live = fundRoot({ regulatory: { version: 1, registers } });
        const expected = fundRoot({ regulatory: { version: 1, registers: { esma: { status: 'Active' } } } });
        expect(preservedOf(live, expected)).toEqual(['regulatory.registers.cssf']);
    });

    it('ausente: una clave conocida (contrato o registros) es vaciado; una obsoleta no, el merge la limpia (MEDIA-9)', () => {
        const live = fundRoot({
            costs: { management_fee_pct: 0.6, ter_pct: 0.82, entry_fee_max_pct: 2.5, kid_evidence: { url: 'https://x.test/kid.pdf' } },
            risk: { srri_1a7: 4, sri_kid_1a7: 3, srri_fuente: 'morningstar' }
        });
        const expected = fundRoot({ costs: { management_fee_pct: 0.6, ter_pct: 0.82 }, risk: { srri_1a7: 4, sri_kid_1a7: 3 } });
        expect(emptiedPlatformPaths(live, mergedOf(live, expected), false)).toEqual(['costs.entry_fee_max_pct', 'costs.kid_evidence']);
    });

    it('un bloque entero que el canonico vacia se informa una vez, no hoja a hoja; si no lo trae, el merge lo conserva', () => {
        const live = fundRoot({ regulatory: { version: 1, kid: { url: 'https://x.test/kid.pdf', source: 'candriam' }, sri: 3 } });
        expect(preservedOf(live, fundRoot({ regulatory: null }))).toEqual(['regulatory']);
        expect(preservedOf(live, fundRoot({ regulatory: { version: 1, sri: null, kid: null } }))).toEqual(['regulatory']);
        expect(mergeOwnedDetailed(live, fundRoot(), false, NOW).doc.regulatory).toEqual(live.regulatory);
    });

    it('no es vaciado: un valor que cambia, lo que la maestra no tenia, ni lo que es de la app (performance.valuation)', () => {
        const live = fundRoot({
            fixed_income_profile: { yield_to_maturity: 4.6, effective_maturity: null },
            performance: { returns: { trailing_pct: { '1a': { fondo: 1.4 } } }, valuation: { nav: 10, as_of: '2026-10-13' } }
        });
        const expected = fundRoot({
            fixed_income_profile: { yield_to_maturity: 4.1, effective_maturity: null },
            performance: { returns: { trailing_pct: { '1a': { fondo: 1.5 } } }, valuation: null }
        });
        expect(emptiedPlatformPaths(live, expected, false)).toEqual([]);
        const merged = mergeOwnedDetailed(live, expected, false, NOW);
        expect(merged.doc.performance.valuation).toEqual({ nav: 10, as_of: '2026-10-13' });
    });

    it('lo que el merge conserva (renta fija documentada) no cuenta como vaciado', () => {
        const provenance = { yield_to_maturity: { source: 'trea', as_of_date: '2026-08-31' } };
        const live = fundRoot({ fixed_income_profile: { yield_to_maturity: 4.08, effective_duration: 1.2, field_provenance: provenance } });
        const expected = fundRoot({ fixed_income_profile: { yield_to_maturity: null, effective_duration: 1.2 } });
        expect(mergeOwnedDetailed(live, expected, false, NOW).doc.fixed_income_profile.yield_to_maturity).toBe(4.08);
    });

    it('un conflicto de legado que ademas vacia lleva las dos cosas, con el codigo del legado', () => {
        const evidence = { sri: 4, date: '2026-09-07', url: 'https://x.test/kid.pdf', sha256: 'ab'.repeat(32), document_type: 'PRIIPS_KID',
            verified_isin: 'LU0000000001', source: 'gestora', verified_at: '2026-09-28T07:46:12+00:00', verification_run: 'x' };
        const live = fundRoot({ risk: { srri_1a7: 4, sri_kid_1a7: 4, sri_kid_evidence: evidence }, regulatory: { version: 1, management_company: 'EDM' } });
        const expected = fundRoot({ risk: { srri_1a7: 4, sri_kid_1a7: 6 }, regulatory: { version: 1, management_company: null } });
        const e = conflictOf(live, expected);
        expect(e.code).toBe('REPUBLISH_LEGACY_CONFLICT');
        expect(e.paths[0]).toMatch(/^risk\.sri_kid_1a7 \(canonico 6, KID verificado 4\)$/);
        // Los vaciados ya no viajan con el conflicto: se conservan antes. Lo que sigue abortando el
        // documento es el desacuerdo de valor, que decide Oscar hasta que exista correcciones.json.
        expect(e.emptied).toEqual([]);
    });
});

/**
 * Marcadores de ausencia (31-10-2026). El extractor dejo de emitir "Not Benchmarked" como indice y
 * la guarda bloqueo los 89 republish: no distinguia corregir un centinela de perder un dato.
 */
describe('marcadores de ausencia', () => {
    const conIndice = (valor: unknown) =>
        fundRoot({ classification: { asset_class: 'RF', morningstar_rating: 3, official_benchmark: valor } });
    const sinIndice = fundRoot({ classification: { asset_class: 'RF', morningstar_rating: 3 } });

    it('quitar un centinela no es un vaciado', () => {
        expect(emptiedPlatformPaths(conIndice('Not Benchmarked'), sinIndice, false)).toEqual([]);
    });

    it('da igual como venga escrito', () => {
        for (const valor of ['Not Benchmarked', '  not benchmarked  ', 'NO BENCHMARK', 'N/A', 'none']) {
            expect(emptiedPlatformPaths(conIndice(valor), sinIndice, false)).toEqual([]);
        }
    });

    it('quitar un indice de verdad SIGUE siendo un vaciado', () => {
        expect(emptiedPlatformPaths(conIndice('MSCI World NR EUR'), sinIndice, false))
            .toEqual(['classification.official_benchmark']);
        expect(emptiedPlatformPaths(conIndice('Euribor 6M'), sinIndice, false))
            .toEqual(['classification.official_benchmark']);
    });

    it('la excepcion solo vale en las rutas que la declaran', () => {
        const vivo = fundRoot({ classification: { asset_class: 'none', morningstar_rating: 3 } });
        const nuevo = fundRoot({ classification: { morningstar_rating: 3 } });
        expect(emptiedPlatformPaths(vivo, nuevo, false)).toEqual(['classification.asset_class']);
    });

    it('isLegitimateRetirement pide la ruta y el valor vivo', () => {
        expect(isLegitimateRetirement('classification.official_benchmark', {}, 'Not Benchmarked')).toBe(true);
        expect(isLegitimateRetirement('classification.official_benchmark', {}, 'MSCI World NR EUR')).toBe(false);
        expect(isLegitimateRetirement('classification.official_benchmark', {})).toBe(false);
        expect(isAbsenceMarker('Not Benchmarked')).toBe(true);
        expect(isAbsenceMarker('MSCI World NR EUR')).toBe(false);
        expect(isAbsenceMarker(null)).toBe(false);
        expect(isAbsenceMarker(0)).toBe(false);
    });
});

/**
 * Lo que motivo conservar en vez de abortar (31-10-2026): doce fondos tenian su indice de referencia
 * listo en el canonico y no entraba, porque la guarda rechazaba el documento entero por OTRO campo
 * que la fuente habia dejado de servir.
 */
describe('un vaciado no secuestra las mejoras del mismo documento', () => {
    it('el indice entra aunque la renta fija pierda la TIR', () => {
        const live = fundRoot({
            classification: { asset_class: 'RF', morningstar_rating: 3 },
            fixed_income_profile: FI_LIVE
        });
        const expected = fundRoot({
            classification: { asset_class: 'RF', morningstar_rating: 3, official_benchmark: 'Euribor 6M' },
            fixed_income_profile: { ...FI_LIVE, yield_to_maturity: null }
        });
        const merged = mergeOwnedDetailed(live, expected, false, NOW);
        // La mejora entra...
        expect(merged.doc.classification.official_benchmark).toBe('Euribor 6M');
        // ...y el dato que la fuente retiro se conserva, anotado.
        expect(merged.doc.fixed_income_profile.yield_to_maturity).toBe(FI_LIVE.yield_to_maturity);
        expect(merged.preserved).toEqual([{
            path: 'fixed_income_profile.yield_to_maturity',
            reason: 'fuente_retirada',
            live: FI_LIVE.yield_to_maturity,
            canonical: null
        }]);
    });

    it('un desacuerdo de valor SIGUE abortando: eso lo decide Oscar', () => {
        const provenance = { yield_to_maturity: { source: 'trea', as_of_date: '2026-08-31' } };
        const live = fundRoot({ fixed_income_profile: { yield_to_maturity: 4.08, field_provenance: provenance } });
        const expected = fundRoot({
            classification: { asset_class: 'RF', morningstar_rating: 3, official_benchmark: 'Euribor 6M' },
            fixed_income_profile: { yield_to_maturity: 3.5 }
        });
        expect(() => mergeOwnedDetailed(live, expected, false, NOW)).toThrow(/documentado/);
    });

    it('no se conserva lo que la maestra tampoco tiene', () => {
        const live = fundRoot({ fixed_income_profile: { yield_to_maturity: 4.08 } });
        const expected = fundRoot({ fixed_income_profile: { yield_to_maturity: 4.08 } });
        expect(mergeOwnedDetailed(live, expected, false, NOW).preserved).toEqual([]);
    });
});
