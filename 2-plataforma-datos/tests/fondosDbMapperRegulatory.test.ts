import { describe, expect, it } from 'vitest';
import { validators } from '../contracts/validators';
import { mapFondosDbFund } from '../src/ingestion/fondosdb/fondosDbMapper';
import { buildFundMetricsLatest } from '../src/loader/metricsLatest';

const ISIN = 'BE0946564383';
const KID_URL = 'https://www.servicios.deutsche-bank.es/documentacionfondos/getDocumento?codDoc=BE0946564383&idioma=ES&codSus=KIID&codCont=NA';

function canonical(overrides: { kid?: any; sriSource?: string | null; kidSource?: string | null } = {}): any {
    const kid = overrides.kid === undefined ? {
        date: '2026-02-19', language: 'es', recommended_holding_years: 6,
        costs: { entry_pct: 2.0, exit_pct: 0.0, management_and_other_pct: 1.73, transaction_pct: 0.7, performance_fee_pct: 0.0 },
        url: KID_URL, source: 'deutsche_bank_es', sha256: '24f35816b635d0f4fe6272e536d22f20e4553b5051535f61c350f292dd6e4216'
    } : overrides.kid;
    const sriSource = overrides.sriSource === undefined ? 'kid_gestora:deutsche_bank_es' : overrides.sriSource;
    const kidSource = overrides.kidSource === undefined ? 'kid_gestora:deutsche_bank_es' : overrides.kidSource;
    return {
        isin: ISIN,
        name: 'DPAM B - Equities NewGems Sustainable B Cap',
        currency: 'EUR',
        generated_at: '2026-10-13T13:30:00',
        report_date: '2026-09-30',
        ms: { category_morningstar: 'EAA Fund Global Large-Cap Growth Equity', costs: { management_fee: 1.6, ter: 1.73, mifid_ongoing: 1.73 } },
        derived: { asset_class: 'RV', primary_region: 'Global', confidence: 0.9 },
        classification_v2: { asset_type: 'equity', commercial_type: 'EAA Fund Global Large-Cap Growth Equity' },
        validation: { ok: true, diagnostics: { calidad_fondosdb: 'ALTO' } },
        quality: { ok: true, warnings: [] },
        regulatory: {
            version: 1, sri: 4, srri: 6, kid,
            mifid_ex_ante_costs: { ongoing_pct: 1.73, transaction_pct: 0.7 },
            ucits: true, legal_framework: 'UCITS', sfdr_article: '8', domicile: 'BEL',
            management_company: 'Degroof Petercam', management_company_legal: null, management_company_lei: null,
            lei: null, depositary: null, launch_date_class: '2016-12-01', launch_date_fund: '2016-12-01',
            isin_issue_date: null, registers: { esma: { status: 'Active' } }, periodic_report: null,
            campo_futuro: 'no se copia'
        },
        provenance: {
            version: 1,
            fields: { 'regulatory.sri': sriSource, 'regulatory.kid': kidSource, name: 'morningstar_lt:ETFsnapshot' },
            sources: { morningstar_lt: { canonical_fields: 29 } },
            endpoints: { 'kid_gestora:deutsche_bank_es': { fetched_at: '2026-09-05T03:39:46+00:00', url: KID_URL } },
            plan: ['morningstar_lt', 'kid_gestora'],
            acquired_at: '2026-09-05T03:40:00+00:00',
            dependency: { canonical_fields_mapped: 36 }
        }
    };
}

const universal = { _id: ISIN, riesgo: { sri_kid_1a7: 4, srri_1a7: 6, volatilidad_pct: { '3a': { fondo: 17.3 } } } };

describe('mapper FondosDB: regulatory, provenance y KID (master.asset.v1.2)', () => {
    it('copia regulatory y una procedencia compacta, y valida el contrato', () => {
        const mapped = mapFondosDbFund(`${ISIN}.json`, canonical(), universal as any);
        const asset: any = mapped.asset;
        expect(asset.regulatory.kid).toMatchObject({ url: KID_URL, source: 'deutsche_bank_es', date: '2026-02-19' });
        expect(asset.regulatory.campo_futuro).toBeUndefined();
        expect(asset.provenance).toEqual({
            version: 1,
            acquired_at: '2026-09-05T03:40:00+00:00',
            fields: { 'regulatory.sri': 'kid_gestora:deutsche_bank_es', 'regulatory.kid': 'kid_gestora:deutsche_bank_es', name: 'morningstar_lt:ETFsnapshot' }
        });
        expect(mapped.warnings.join(' ')).not.toMatch(/regulatory|provenance/);
        expect(validators.masterAssetV12(asset)).toEqual({ ok: true, errors: [] });
        expect(validators.masterAssetV11(asset).ok).toBe(false);
    });

    it('lleva los costes del KID a costs con su documento, sin la comision de rendimiento', () => {
        const asset: any = mapFondosDbFund(`${ISIN}.json`, canonical(), universal as any).asset;
        expect(asset.costs).toMatchObject({
            management_fee_pct: 1.6, entry_fee_max_pct: 2.0, exit_fee_max_pct: 0.0, transaction_costs_pct: 0.7, ongoing_costs_kid_pct: 1.73
        });
        expect(asset.costs.performance_fee_pct).toBeUndefined();
        expect(asset.costs.kid_evidence).toMatchObject({ url: KID_URL, document_type: 'PRIIPS_KID', verified_isin: ISIN });
    });

    it('deriva risk.sri_kid_evidence del KID oficial con la forma que exige el read model', () => {
        const asset: any = mapFondosDbFund(`${ISIN}.json`, canonical(), universal as any).asset;
        expect(asset.risk.sri_kid_1a7).toBe(4);
        expect(asset.risk.sri_kid_evidence).toEqual({
            sri: 4, date: '2026-02-19', url: KID_URL, sha256: '24f35816b635d0f4fe6272e536d22f20e4553b5051535f61c350f292dd6e4216',
            document_type: 'PRIIPS_KID', verified_isin: ISIN, source: 'deutsche_bank_es',
            verified_at: '2026-09-05T03:39:46+00:00', verification_run: 'extractor:kid_gestora:deutsche_bank_es',
            language: 'es', recommended_holding_years: 6
        });
        expect(universal.riesgo).not.toHaveProperty('sri_kid_evidence');
    });

    it('no inventa evidencia si el SRI no sale del KID o el KID no esta fechado', () => {
        const fromMorningstar: any = mapFondosDbFund(`${ISIN}.json`, canonical({ sriSource: 'morningstar_lt:Mifid' }), universal as any).asset;
        expect(fromMorningstar.risk.sri_kid_evidence).toBeUndefined();
        const manual: any = mapFondosDbFund(`${ISIN}.json`, canonical({ sriSource: 'manual:oscar' }), universal as any).asset;
        expect(manual.risk.sri_kid_evidence).toBeUndefined();
        const undated = canonical();
        delete undated.regulatory.kid.date;
        expect((mapFondosDbFund(`${ISIN}.json`, undated, universal as any).asset as any).risk.sri_kid_evidence).toBeUndefined();
        const otherClass = canonical();
        otherClass.regulatory.kid.verified_isin = 'BE0000000000';
        const mismatch: any = mapFondosDbFund(`${ISIN}.json`, otherClass, universal as any).asset;
        expect(mismatch.risk.sri_kid_evidence).toBeUndefined();
        expect(mismatch.costs.kid_evidence.verified_isin).toBeUndefined();
    });

    it('un KID con su propio SRI explicito vale aunque el SRI se haya corregido a mano', () => {
        const explicit = canonical({ sriSource: 'manual:oscar' });
        explicit.regulatory.kid.sri = 4;
        explicit.regulatory.kid.verified_isin = ISIN;
        const asset: any = mapFondosDbFund(`${ISIN}.json`, explicit, universal as any).asset;
        expect(asset.risk.sri_kid_evidence).toMatchObject({ sri: 4, verified_isin: ISIN, verification_run: 'extractor:manual:oscar' });
    });

    it('sin bloque regulatory el fondo sigue como en v1.1', () => {
        const raw = canonical();
        delete raw.regulatory;
        delete raw.provenance;
        const asset: any = mapFondosDbFund(`${ISIN}.json`, raw, universal as any).asset;
        expect(asset.regulatory).toBeUndefined();
        expect(asset.provenance).toBeUndefined();
        expect(Object.keys(asset.costs)).toEqual(['management_fee_pct', 'ter_pct', 'mifid_ongoing_pct']);
        expect(validators.masterAssetV11(asset).ok).toBe(true);
    });
});

describe('metrics puente: SRRI frente a SRI del KID (metrics.v1.3)', () => {
    const base = { asset_id: ISIN, source_metadata: { generated_at: '2026-10-13T13:30:00Z' }, performance: { returns: { trailing_pct: {} } } };

    it('etiqueta SRI_KID cuando solo hay SRI PRIIPs', () => {
        const metrics: any = buildFundMetricsLatest({ ...base, risk: { sri_kid_1a7: 4 } });
        expect(metrics).toMatchObject({ srri: 4, risk_score_source: 'SRI_KID' });
        expect(validators.masterMetricsV13(metrics).ok).toBe(true);
        expect(validators.masterMetricsV12(metrics).ok).toBe(false);
    });

    it('el SRRI UCITS sigue mandando cuando existe', () => {
        const metrics: any = buildFundMetricsLatest({ ...base, risk: { srri_1a7: 6, sri_kid_1a7: 4 } });
        expect(metrics).toMatchObject({ srri: 6, risk_score_source: 'SRRI' });
    });
});
