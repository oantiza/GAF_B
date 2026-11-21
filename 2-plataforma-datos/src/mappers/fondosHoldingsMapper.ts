import crypto from 'crypto';
import { FundHolding, FundHoldingsPayload, FundHoldingsQualitySummary } from '../schemas/fondosHoldingsSchema';

export interface RawHoldingInput {
    name?: string;
    weight?: number | string;
    isin?: string;
    ticker?: string;
    assetClass?: string;
    country?: string;
    currency?: string;
    maturity?: string;
    coupon?: number | string;
    creditRating?: string;
    [key: string]: any;
}

export function generateHoldingId(fundAssetId: string, holdingName: string, isin?: string, identity?: RawHoldingInput): string {
    // Position weights change without changing instrument identity.
    const terms = identity ? JSON.stringify([
        identity.currency, identity.assetClass, identity.ticker, identity.maturity,
        identity.coupon, identity.contract, identity.expiry, identity.strike
    ].map(value => value == null ? null : String(value).trim().toLowerCase())) : '';
    const uniqueString = `${fundAssetId}-${isin || ''}-${holdingName}-${terms}`.trim().toLowerCase();
    return crypto.createHash('sha256').update(uniqueString).digest('hex').substring(0, 16);
}

export function parseWeight(weightRaw: any): number | null {
    if (weightRaw === null || weightRaw === undefined) return null;
    if (typeof weightRaw === 'number') return weightRaw;
    if (typeof weightRaw === 'string') {
        const parsed = parseFloat(weightRaw.replace(/,/g, '.').replace(/%/g, ''));
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}

export function parseFiniteNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = typeof value === 'string'
        ? Number(value.replace(',', '.').replace('%', '').trim())
        : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function classifyInstrument(rawAssetClass?: string, isin?: string, name?: string): FundHolding['instrument_type'] {
    const rawLower = (rawAssetClass || '').toLowerCase();
    const nameLower = (name || '').toLowerCase();
    
    if (rawLower === 'rv' || rawLower.includes('renta variable') || rawLower.includes('equity') || rawLower.includes('acción') || rawLower.includes('accion') || rawLower.includes('stock')) return 'equity';
    if (rawLower === 'rf' || rawLower.includes('renta fija') || rawLower.includes('bond') || rawLower.includes('bono') || rawLower.includes('fixed income') || rawLower.includes('rf')) return 'bond';
    if (rawLower.includes('cash') || rawLower.includes('liquidez') || rawLower.includes('monetary') || rawLower.includes('money market')) return 'cash';
    if (rawLower.includes('fund') || rawLower.includes('fondo') || rawLower.includes('etf')) return 'fund';
    if (rawLower.includes('derivative') || rawLower.includes('future') || rawLower.includes('option') || rawLower.includes('swap')) return 'derivative';
    if (rawLower.includes('other') || rawLower.includes('otro')) return 'other';
    
    // Fallbacks based on name
    if (nameLower.includes('cash')) return 'cash';
    if (nameLower.includes('stock') || nameLower.includes('equity')) return 'equity';
    if (nameLower.includes('bond')) return 'bond';
    
    return 'unknown';
}

export function mapFondosDbHoldings(
    fundAssetId: string,
    fundIsin: string | undefined,
    asOfDate: string | undefined,
    rawHoldings: RawHoldingInput[],
    sourceMetadata: Record<string, unknown> = {}
): FundHoldingsPayload {
    const holdings: FundHolding[] = [];
    const warnings: string[] = [];
    const occurrences = new Map<string, number>();
    let totalWeight = 0;
    let missingWeightsCount = 0;
    let unknownInstrumentTypesCount = 0;

    for (const raw of rawHoldings) {
        const name = raw.name || 'Unknown Holding';
        const isin = raw.isin;
        const baseId = generateHoldingId(fundAssetId, name, isin, raw);
        const occurrence = (occurrences.get(baseId) ?? 0) + 1;
        occurrences.set(baseId, occurrence);
        // Preserve indistinguishable source rows; never drop economic positions.
        const holding_id = occurrence === 1 ? baseId : `${baseId}-${occurrence}`;
        const weight = parseWeight(raw.weight);
        
        if (weight === null) {
            missingWeightsCount++;
            warnings.push(`Holding "${name}" is missing a valid weight.`);
        } else {
            totalWeight += weight;
        }

        const instrument_type = classifyInstrument(raw.assetClass, isin, name);
        if (instrument_type === 'unknown') {
            unknownInstrumentTypesCount++;
        }

        const quality_flags: string[] = [];
        if (weight === null) quality_flags.push('MISSING_WEIGHT');
        if (instrument_type === 'unknown') quality_flags.push('UNKNOWN_INSTRUMENT_TYPE');
        const coupon = parseFiniteNumber(raw.coupon);
        if (raw.coupon !== null && raw.coupon !== undefined && raw.coupon !== '' && coupon === undefined) {
            quality_flags.push('INVALID_COUPON');
            warnings.push(`Holding "${name}" has an invalid coupon.`);
        }

        const holding: FundHolding = {
            holding_id,
            source: 'fondosdb',
            fund_asset_id: fundAssetId,
            fund_isin: fundIsin,
            holding_name: name,
            holding_weight: weight,
            holding_weight_unit: 'percent',
            instrument_type,
            currency: raw.currency,
            country: raw.country,
            sector: raw.sector,
            identifiers: {
                isin: raw.isin,
                ticker: raw.ticker,
            },
            isin: raw.isin,
            ticker: raw.ticker,
            maturity_date: raw.maturity,
            coupon,
            credit_quality: raw.creditRating,
            raw_source: raw,
            quality_flags,
        };

        holdings.push(holding);
    }

    // Sort holdings by weight descending
    holdings.sort((a, b) => {
        const wA = a.holding_weight ?? -1;
        const wB = b.holding_weight ?? -1;
        return wB - wA;
    });

    const top10_weight = holdings.slice(0, 10).reduce((acc, h) => acc + (h.holding_weight ?? 0), 0);

    if (totalWeight < 90 || totalWeight > 110) {
        warnings.push(`Total weight is suspicious: ${totalWeight.toFixed(2)}%`);
    }

    const quality_summary: FundHoldingsQualitySummary = {
        missing_weights_count: missingWeightsCount,
        unknown_instrument_types_count: unknownInstrumentTypesCount,
        coverage_ratio: holdings.length > 0 ? (holdings.length - unknownInstrumentTypesCount) / holdings.length : 0,
        has_critical_warnings: missingWeightsCount > (holdings.length * 0.1) || totalWeight < 90 || totalWeight > 110,
    };

    return {
        fund_asset_id: fundAssetId,
        fund_isin: fundIsin,
        as_of_date: asOfDate,
        holdings_count: holdings.length,
        total_reported_weight: Number(totalWeight.toFixed(4)),
        top10_weight: Number(top10_weight.toFixed(4)),
        holdings,
        quality_summary,
        warnings,
        source_metadata: {
            ...sourceMetadata,
            mapped_at: new Date().toISOString()
        }
    };
}
