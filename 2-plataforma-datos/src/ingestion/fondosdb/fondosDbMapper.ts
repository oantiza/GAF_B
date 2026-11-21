import { AssetType } from '../../types/assets';
import {
    FondosDbMappedAsset,
    FondosDbNormalizedAsset,
    FondosDbRawFund,
    FondosDbUniversalFund,
    isSupportedAssetType
} from './fondosDbTypes';
import { normalizeIsoUtcDateTime } from '../../utils/utcDates';

const ROOT_FIELDS_MAPPED_OR_REVIEWED = new Set([
    'generated_at',
    'isin',
    'name',
    'currency',
    'fileName',
    'stableBaseName',
    'report_date',
    'ms',
    'rating_stars',
    'derived',
    'classification_v2',
    'identificacion',
    'tipo',
    'portfolio_exposure_v2',
    'identifiers',
    'quality',
    'validation',
    'routing',
    'regulatory',
    'provenance'
]);

// Procedencias del canonico (provenance.fields) que son el KID PRIIPs oficial de la clase. El
// extractor solo adjunta un KID de estas fuentes tras comprobar el ISIN dentro del documento
// (kid_gestora) o pedirlo por ISIN al registro (CNMV, AMF GECO), y rechaza los de mas de 15 meses.
// `manual:` no cuenta: una correccion a mano no prueba por si sola que el SRI salga del KID.
const OFFICIAL_KID_PROVENANCE = /(^|\+)(kid_gestora:[a-z0-9_]+|cnmv_ficha:kid|amf_geco:kid)(\+|$)/;

const REGULATORY_KEYS = [
    'version', 'sri', 'srri', 'kid', 'mifid_ex_ante_costs', 'ucits', 'legal_framework', 'sfdr_article',
    'domicile', 'management_company', 'management_company_legal', 'management_company_lei', 'lei',
    'depositary', 'launch_date_class', 'launch_date_fund', 'isin_issue_date', 'registers', 'periodic_report'
] as const;

export function mapFondosDbFund(
    file: string,
    fund: FondosDbRawFund,
    universalFund?: FondosDbUniversalFund,
    context?: {
        duplicateIsin?: boolean;
        problematicFlags?: string[];
        qualityFlags?: string[];
    }
): FondosDbMappedAsset {
    const isin = normalizeIsin(fund.isin || undefined);
    const rejectReasons: string[] = [];
    const reviewReasons: string[] = [];
    const warnings: string[] = [];
    const problematicFlags = context?.problematicFlags || [];
    const qualityFlags = context?.qualityFlags || [];

    if (!isin) rejectReasons.push('asset_id ausente: FondosDB no trae ISIN.');
    if (isin && !isValidIsin(isin)) rejectReasons.push(`ISIN invalido: ${isin}.`);
    if (!fund.name) rejectReasons.push('identity.name ausente.');

    const assetType = normalizeFondosDbAssetType(fund, universalFund);
    if (assetType === 'UNKNOWN') rejectReasons.push('asset_type unknown impide clasificacion minima.');

    const qualityBucket = fund.validation?.diagnostics?.calidad_fondosdb || fund.quality?.bucket || universalFund?.calidad?.bucket || null;
    if (qualityBucket === 'BAJO') reviewReasons.push('calidad BAJO.');
    if (context?.duplicateIsin) reviewReasons.push('duplicado por ISIN.');
    if (problematicFlags.length > 0) reviewReasons.push(`fondo problematico: ${problematicFlags.join(';')}.`);
    if (qualityFlags.some(flag => flag.includes('asignacion_activos_sospechosa'))) reviewReasons.push('asset allocation sospechosa.');

    const fixedIncome = fund.ms?.fixed_income || {};
    const isFixedIncome = fund.derived?.asset_class === 'RF' || fund.classification_v2?.asset_type === 'fixed_income';
    if (isFixedIncome && (fixedIncome.effective_duration == null || fixedIncome.yield_to_maturity == null || !fixedIncome.avg_credit_quality)) {
        reviewReasons.push('RF critica sin duracion, yield o calidad crediticia completa.');
    }

    if (!fund.ms?.category_morningstar && !fund.classification_v2?.commercial_type) {
        reviewReasons.push('categoria/commercial_type incompleta.');
    }

    if (!fund.currency) reviewReasons.push('divisa base incompleta.');

    const unmappedFields = Object.keys(fund).filter(key => !ROOT_FIELDS_MAPPED_OR_REVIEWED.has(key));
    if (unmappedFields.length > 0) {
        warnings.push(`Campos raiz no mapeados explicitamente: ${unmappedFields.join(', ')}`);
    }

    if (rejectReasons.length > 0) {
        return {
            status: 'REJECTED',
            asset: null,
            rejected_record: {
                file,
                isin: fund.isin || null,
                name: fund.name || null,
                reject_reasons: rejectReasons
            },
            warnings,
            review_reasons: reviewReasons,
            reject_reasons: rejectReasons,
            unmapped_fields: unmappedFields,
            partially_mapped_fields: partiallyMappedFields(universalFund)
        };
    }

    const assetId = isin!;
    const productType = normalizeProductType(fund, universalFund, assetType);
    const listing = buildListing(fund, universalFund, productType);
    const isListableProduct = productType === 'ETF' || productType === 'ETC';
    const normalizedExposure = normalizePortfolioExposure(
        fund.portfolio_exposure_v2 || fund.derived?.portfolio_exposure || null
    );
    const regulatory = mapRegulatory(fund.regulatory);
    const provenance = mapProvenance(fund.provenance);
    const kidAttested = attestedKid(regulatory?.kid, provenance, assetId);
    const officialBenchmark = firstString(fund.classification_v2?.official_benchmark);
    const asset: FondosDbNormalizedAsset = {
        asset_id: assetId,
        asset_type: assetType,
        identity: {
            name: fund.name || assetId,
            currency: fund.currency || null
        },
        identifiers: {
            isin: assetId,
            ...(listing ? {
                ticker: listing.ticker,
                eodhd_code: listing.eodhd_code || null,
                aliases: uniqueStrings([assetId, listing.ticker, listing.eodhd_code, listing.listing_id])
            } : {})
        },
        listings: listing ? [listing] : [],
        classification: {
            asset_class: fund.derived?.asset_class || null,
            fondosdb_asset_class: fund.derived?.asset_class || null,
            fondosdb_asset_type: fund.classification_v2?.asset_type || null,
            asset_subtype: fund.derived?.asset_subtype || fund.classification_v2?.asset_subtype || null,
            region_primary: fund.derived?.primary_region || fund.classification_v2?.region_primary || null,
            strategy_tags: fund.classification_v2?.strategy_tags || [],
            confidence: fund.derived?.confidence ?? fund.classification_v2?.classification_confidence ?? null,
            morningstar_rating: morningstarRating(fund),
            // Solo cuando la fuente lo declara: un fondo sin indice mantiene la forma de v1.2.
            ...(officialBenchmark ? { official_benchmark: officialBenchmark } : {})
        },
        product: {
            product_type: productType,
            commercial_type: fund.classification_v2?.commercial_type || fund.ms?.category_morningstar || null,
            vehicle_complexity: fund.classification_v2?.vehicle_complexity || null,
            fund_name: fund.name || null,
            has_listing: isListableProduct || Boolean(listing)
        },
        costs: {
            management_fee_pct: numberOrNull(fund.ms?.costs?.management_fee),
            ter_pct: numberOrNull(fund.ms?.costs?.ter),
            mifid_ongoing_pct: numberOrNull(fund.ms?.costs?.mifid_ongoing),
            ...mapKidCosts(regulatory?.kid, kidAttested ? assetId : null)
        },
        performance: mapPerformance(universalFund),
        risk: withSriKidEvidence(mapRisk(universalFund), regulatory, provenance, fund.provenance, kidAttested ? assetId : null),
        sustainability: mapSustainability(fund, universalFund),
        portfolio_exposure: normalizedExposure.value,
        fixed_income_profile: mapFixedIncomeProfile(fund, universalFund),
        quality: {
            fondosdb_bucket: qualityBucket,
            fondosdb_ok: fund.quality?.ok ?? fund.validation?.ok ?? null,
            warnings: [
                ...(fund.quality?.warnings || []),
                ...(fund.validation?.warnings || [])
            ],
            validation_errors: fund.validation?.errors || [],
            review_flags: [...new Set([
                ...problematicFlags,
                ...qualityFlags,
                ...(normalizedExposure.residualImputed ? ['EXPOSURE_RESIDUAL_IMPUTED'] : [])
            ])],
            status: reviewReasons.length > 0 ? 'REVIEW' : 'ACCEPTED'
        },
        ...(regulatory ? { regulatory } : {}),
        ...(provenance ? { provenance } : {}),
        source_metadata: {
            source: 'FondosDB',
            source_file: `export_bdb/${file}`,
            generated_at: normalizeIsoUtcDateTime(fund.generated_at),
            report_date: fund.report_date || null,
            universal_export_present: !!universalFund,
            firestore_preview_only: true
        }
    };

    return {
        status: asset.quality.status,
        asset,
        warnings,
        review_reasons: reviewReasons,
        reject_reasons: [],
        unmapped_fields: unmappedFields,
        partially_mapped_fields: partiallyMappedFields(universalFund)
    };
}

export function normalizeIsin(isin?: string | null): string | null {
    if (!isin) return null;
    const cleaned = isin.replace(/\s+/g, '').toUpperCase();
    return cleaned || null;
}

export function isValidIsin(isin: string): boolean {
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return false;
    const rearranged = isin.slice(0, 11);
    let expanded = '';
    for (const char of rearranged) {
        const code = char.charCodeAt(0);
        expanded += code >= 65 && code <= 90 ? String(code - 55) : char;
    }
    const digits = expanded + isin[11];
    let sum = 0;
    let doubleDigit = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = Number(digits[i]);
        if (doubleDigit) {
            n *= 2;
            if (n > 9) n -= 9;
        }
        sum += n;
        doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
}

export function normalizeFondosDbAssetType(
    fund: FondosDbRawFund,
    universalFund?: FondosDbUniversalFund
): AssetType {
    const declaredType = firstString(
        fund.identificacion?.tipo,
        fund.tipo,
        universalFund?.identificacion?.tipo,
        universalFund?.identificacion?.tipo_producto
    )?.toUpperCase();
    const declaredMap: Record<string, AssetType> = {
        FONDO: 'FUND',
        FUND: 'FUND',
        ETF: 'ETF',
        ETC: 'OTHER',
        ACCION: 'STOCK',
        STOCK: 'STOCK',
        INDICE: 'INDEX',
        INDEX: 'INDEX'
    };
    if (declaredType && declaredMap[declaredType]) return declaredMap[declaredType];

    const classification = [
        fund.classification_v2?.product_type,
        fund.classification_v2?.asset_type,
        fund.classification_v2?.asset_subtype,
        fund.classification_v2?.commercial_type
    ].filter(Boolean).join(' ');
    let candidate: string = 'FUND';
    if (/\bETF\b/i.test(classification)) candidate = 'ETF';
    else if (/\bETC\b/i.test(classification)) candidate = 'OTHER';
    else if (fund.classification_v2?.asset_type === 'stock') candidate = 'STOCK';
    else {
        const name = String(fund.name || '');
        if (/\bETF\b/i.test(name)) candidate = 'ETF';
        else if (/\bETC\b/i.test(name)) candidate = 'OTHER';
    }
    if (!fund.classification_v2?.asset_type && !fund.derived?.asset_class && !declaredType) candidate = 'UNKNOWN';
    return isSupportedAssetType(candidate) ? candidate : 'UNKNOWN';
}

function normalizeProductType(
    fund: FondosDbRawFund,
    universalFund: FondosDbUniversalFund | undefined,
    assetType: AssetType
): string {
    const declaredType = firstString(
        fund.identificacion?.tipo,
        fund.tipo,
        universalFund?.identificacion?.tipo,
        universalFund?.identificacion?.tipo_producto
    )?.toUpperCase();
    if (declaredType === 'ETC') return 'ETC';
    if (declaredType === 'ETF') return 'ETF';
    if (declaredType === 'FONDO' || declaredType === 'FUND') return 'fund';
    if (declaredType === 'ACCION' || declaredType === 'STOCK') return 'stock';
    if (declaredType === 'INDICE' || declaredType === 'INDEX') return 'index';
    const classification = `${fund.classification_v2?.product_type || ''} ${fund.classification_v2?.commercial_type || ''}`;
    const fallbackName = String(fund.name || '');
    if (/\bETC\b/i.test(classification) || /\bETC\b/i.test(fallbackName)) return 'ETC';
    if (assetType === 'ETF') return 'ETF';
    if (assetType === 'STOCK') return 'stock';
    if (assetType === 'INDEX') return 'index';
    if (fund.classification_v2?.asset_type === 'money_market') return 'money_market_fund';
    return 'fund';
}

function buildListing(
    fund: FondosDbRawFund,
    universalFund: FondosDbUniversalFund | undefined,
    productType: string
): FondosDbNormalizedAsset['listings'][number] | null {
    if (productType !== 'ETF' && productType !== 'ETC') return null;
    const rawIdentifiers = fund.identifiers || {};
    const ticker = firstString(
        rawIdentifiers.ticker,
        fund.ms?.stock?.ticker,
        universalFund?.identificacion?.ticker
    );
    const exchange = firstString(
        rawIdentifiers.exchange,
        rawIdentifiers.mercado,
        fund.ms?.stock?.exchange,
        universalFund?.identificacion?.mercado
    );
    const currency = firstString(fund.currency, universalFund?.identificacion?.divisa_base);
    if (!ticker || !currency) return null;
    const eodhdCode = firstString(
        rawIdentifiers.eodhd_code,
        universalFund?.identificacion?.simbolo_eodhd,
        exchange ? `${ticker}.${exchange}` : null
    );
    const sourceListingId = firstString(
        rawIdentifiers.source_listing_id,
        universalFund?.identificacion?.source_listing_id,
        eodhdCode ? `EODHD:${eodhdCode}` : null
    );
    const listing: FondosDbNormalizedAsset['listings'][number] = {
        listing_id: sourceListingId || `EODHD:${ticker}.${exchange}`,
        ticker,
        currency
    };
    if (exchange) listing.exchange = exchange;
    if (eodhdCode) listing.eodhd_code = eodhdCode;
    if (sourceListingId) listing.source_listing_id = sourceListingId;
    if (exchange || eodhdCode) {
        listing.is_primary = true;
        listing.data_sources = uniqueStrings(['fondosdb', eodhdCode ? 'eodhd' : null]);
    }
    if (!sourceListingId && !eodhdCode && !exchange) listing.listing_id = `TICKER:${ticker}`;
    return listing;
}

function firstString(...values: any[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function mapPerformance(universalFund?: FondosDbUniversalFund): Record<string, any> | null {
    if (!universalFund?.rentabilidad && !universalFund?.valoracion && !universalFund?.distribuciones) return null;
    return {
        returns: universalFund.rentabilidad || null,
        valuation: universalFund.valoracion || null,
        distributions: universalFund.distribuciones || null
    };
}

function mapRisk(universalFund?: FondosDbUniversalFund): Record<string, any> | null {
    if (!universalFund?.riesgo) return null;
    return universalFund.riesgo;
}

/**
 * Bloque regulatorio del canonico (master.asset.v1.2). Copia solo las claves que declara el
 * contrato: si el extractor anade una, no rompe la validacion; aparece como deriva en el diff
 * de canonicos y se incorpora con una version nueva del contrato.
 */
export function mapRegulatory(raw: any): Record<string, any> | null {
    if (!isPlainObject(raw)) return null;
    const out: Record<string, any> = {};
    for (const key of REGULATORY_KEYS) {
        if (!(key in raw)) continue;
        const value = raw[key];
        if (key === 'kid') out.kid = mapKidDocument(value);
        else if (key === 'version') { if (Number.isInteger(value)) out.version = value; }
        else if (key === 'sri' || key === 'srri') out[key] = integerInRange(value, 1, 7);
        else if (key === 'ucits') out.ucits = typeof value === 'boolean' ? value : null;
        else if (key === 'mifid_ex_ante_costs' || key === 'registers' || key === 'periodic_report') out[key] = isPlainObject(value) ? value : null;
        else out[key] = scalarString(value);
    }
    return out;
}

const KID_COST_KEYS = ['entry_pct', 'exit_pct', 'management_and_other_pct', 'transaction_pct', 'performance_fee_pct'] as const;

function mapKidDocument(raw: any): Record<string, any> | null {
    if (!isPlainObject(raw)) return null;
    const url = firstString(raw.url);
    const source = firstString(raw.source);
    if (!url || !source) return null;
    const kid: Record<string, any> = { url, source };
    for (const key of ['sha256', 'date', 'language', 'manufacturer', 'verified_isin', 'document_type', 'checked_at']) {
        const value = firstString(raw[key]);
        if (value) kid[key] = value;
    }
    const years = numberOrNull(raw.recommended_holding_years);
    if (years !== null) kid.recommended_holding_years = years;
    const sri = integerInRange(raw.sri, 1, 7);
    if (sri !== null) kid.sri = sri;
    if (isPlainObject(raw.costs)) {
        const costs: Record<string, number> = {};
        for (const key of KID_COST_KEYS) {
            const value = numberOrNull(raw.costs[key]);
            if (value !== null) costs[key] = value;
        }
        kid.costs = costs;
    }
    return kid;
}

/** Procedencia compacta: ruta canonica -> 'fuente:endpoint'. endpoints/plan/dependency se quedan en el canonico. */
export function mapProvenance(raw: any): { version?: number; acquired_at: string | null; fields: Record<string, string | null> } | null {
    if (!isPlainObject(raw) || !isPlainObject(raw.fields)) return null;
    const fields: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(raw.fields)) fields[key] = typeof value === 'string' ? value : null;
    return {
        ...(Number.isInteger(raw.version) ? { version: raw.version } : {}),
        acquired_at: firstString(raw.acquired_at),
        fields
    };
}

/**
 * El KID del canonico vale como prueba de la clase si trae su propia atestacion de ISIN o si lo
 * adjunto un adaptador oficial (que comprueba el ISIN antes de aceptarlo).
 */
function attestedKid(kid: Record<string, any> | null | undefined, provenance: { fields: Record<string, string | null> } | null, isin: string): boolean {
    if (!kid) return false;
    if (kid.verified_isin) return kid.verified_isin === isin;
    return OFFICIAL_KID_PROVENANCE.test(String(provenance?.fields?.['regulatory.kid'] ?? ''));
}

/** Costes del KID PRIIPs (composicion de costes) con su documento. Sin la comision de rendimiento (ver abajo). */
function mapKidCosts(kid: Record<string, any> | null | undefined, verifiedIsin: string | null): Record<string, any> {
    if (!kid || !isPlainObject(kid.costs)) return {};
    const out: Record<string, any> = {};
    const pairs: Array<[string, string]> = [
        ['entry_fee_max_pct', 'entry_pct'],
        ['exit_fee_max_pct', 'exit_pct'],
        ['transaction_costs_pct', 'transaction_pct'],
        ['ongoing_costs_kid_pct', 'management_and_other_pct']
        // performance_fee_pct NO: el parser del KID lee la fila «Comisiones de rendimiento» tal cual y
        // en 76 KID del canonico del 13-10 es el tipo contractual (5-20 %), no el impacto anual. Se
        // queda en bruto en regulatory.kid.costs hasta que el extractor separe las dos cifras.
    ];
    for (const [target, source] of pairs) {
        const value = numberOrNull(kid.costs[source]);
        if (value !== null) out[target] = value;
    }
    if (Object.keys(out).length === 0) return {};
    out.kid_evidence = {
        url: kid.url,
        source: kid.source,
        document_type: 'PRIIPS_KID',
        ...(kid.sha256 ? { sha256: kid.sha256 } : {}),
        ...(kid.date ? { date: kid.date } : {}),
        ...(kid.language ? { language: kid.language } : {}),
        ...(verifiedIsin ? { verified_isin: verifiedIsin } : {})
    };
    return out;
}

/**
 * risk.sri_kid_evidence derivada de regulatory.kid: la misma forma que exige el read model
 * (readmodel/mappers.py) para etiquetar el SRI como SRI_KID. Solo se emite si el SRI del
 * canonico sale del propio KID (procedencia oficial o kid.sri explicito) y coincide con
 * risk.sri_kid_1a7. verified_at es la fecha en que el extractor descargo el documento.
 */
function withSriKidEvidence(
    risk: Record<string, any> | null,
    regulatory: Record<string, any> | null,
    provenance: { acquired_at: string | null; fields: Record<string, string | null> } | null,
    rawProvenance: any,
    verifiedIsin: string | null
): Record<string, any> | null {
    if (!risk || !verifiedIsin) return risk;
    const kid = regulatory?.kid;
    const sri = regulatory?.sri;
    if (!kid || !kid.sha256 || !kid.date || !Number.isInteger(sri)) return risk;
    const sriSource = String(provenance?.fields?.['regulatory.sri'] ?? '');
    const kidSri = Number.isInteger(kid.sri) ? kid.sri : (OFFICIAL_KID_PROVENANCE.test(sriSource) ? sri : null);
    if (kidSri !== sri || risk.sri_kid_1a7 !== sri) return risk;
    const verifiedAt = firstString(kid.checked_at, rawProvenance?.endpoints?.[sriSource]?.fetched_at, provenance?.acquired_at);
    if (!verifiedAt) return risk;
    return {
        ...risk,
        sri_kid_evidence: {
            sri,
            date: kid.date,
            url: kid.url,
            sha256: kid.sha256,
            document_type: 'PRIIPS_KID',
            verified_isin: verifiedIsin,
            source: kid.source,
            verified_at: verifiedAt,
            verification_run: `extractor:${sriSource || 'regulatory.kid.sri'}`,
            ...(kid.language ? { language: kid.language } : {}),
            ...(typeof kid.recommended_holding_years === 'number' ? { recommended_holding_years: kid.recommended_holding_years } : {})
        }
    };
}

function isPlainObject(value: any): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integerInRange(value: any, min: number, max: number): number | null {
    return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function scalarString(value: any): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function mapSustainability(fund: FondosDbRawFund, universalFund?: FondosDbUniversalFund): Record<string, any> | null {
    const sustainability = {
        morningstar_sustainability_rating: fund.ms?.sustainability_rating ?? null,
        esg: universalFund?.esg || null,
        sfdr: universalFund?.identificacion?.sfdr ?? null
    };
    if (sustainability.morningstar_sustainability_rating === null && sustainability.esg === null && sustainability.sfdr === null) return null;
    return sustainability;
}

function mapFixedIncomeProfile(fund: FondosDbRawFund, universalFund?: FondosDbUniversalFund): Record<string, any> | null {
    const fixedIncome = fund.ms?.fixed_income || null;
    const universalFixedIncome = universalFund?.cartera?.renta_fija || null;
    if (!fixedIncome && !universalFixedIncome) return null;
    return {
        effective_duration: numberOrNull(fixedIncome?.effective_duration),
        effective_maturity: numberOrNull(fixedIncome?.effective_maturity),
        avg_credit_quality: fixedIncome?.avg_credit_quality ?? null,
        credit_quality: fixedIncome?.credit_quality ?? null,
        maturity_allocation: fixedIncome?.maturity_allocation ?? null,
        coupon_allocation: fixedIncome?.coupon_allocation ?? null,
        modified_duration: numberOrNull(fixedIncome?.modified_duration),
        yield_to_maturity: numberOrNull(fixedIncome?.yield_to_maturity),
        yield_to_worst: numberOrNull(fixedIncome?.yield_to_worst),
        ytw_distribution: fixedIncome?.ytw_distribution ?? null,
        investment_grade_pct: numberOrNull(fixedIncome?.investment_grade_pct),
        high_yield_pct: numberOrNull(fixedIncome?.high_yield_pct),
        bond_sectors: fixedIncome?.bond_sectors ?? null,
        universal_vencimientos_pct: universalFixedIncome?.vencimientos_pct ?? null,
        universal_ytw_distribucion_pct: universalFixedIncome?.ytw_distribucion_pct ?? null
    };
}

function numberOrNull(value: any): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function morningstarRating(fund: FondosDbRawFund): number | null {
    const value = fund.ms?.rating_stars ?? fund.rating_stars;
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function normalizePortfolioExposure(exposure: any): {
    value: Record<string, any> | null;
    residualImputed: boolean;
} {
    if (!exposure || typeof exposure !== 'object') {
        return { value: exposure ?? null, residualImputed: false };
    }
    const assetMix = exposure.asset_mix;
    if (!assetMix || typeof assetMix !== 'object' || Array.isArray(assetMix)) {
        return { value: exposure, residualImputed: false };
    }

    const numericEntries = Object.entries(assetMix)
        .map(([key, value]) => [key, numberOrNull(value)] as const)
        .filter(([, value]) => value !== null) as Array<[string, number]>;
    if (numericEntries.length === 0) return { value: exposure, residualImputed: false };

    const sum = numericEntries.reduce((acc, [, value]) => acc + value, 0);
    if (sum >= 0.98) return { value: exposure, residualImputed: false };

    const residual = Math.max(0, 1 - sum);
    return {
        value: {
            ...exposure,
            asset_mix: {
                ...assetMix,
                other: Number(((numberOrNull(assetMix.other) || 0) + residual).toFixed(6))
            }
        },
        residualImputed: true
    };
}

function partiallyMappedFields(universalFund?: FondosDbUniversalFund): string[] {
    const fields = [
        'ms.objective',
        'ms.holdings_top10',
        'derived.style_bias',
        'universal.cartera'
    ];
    if (!universalFund) fields.push('export/fondos.ndjson');
    return fields;
}
