import { FundHoldingsStorageMode, HOLDINGS_STORAGE_MODE } from '../holdings/holdingsStorage';

export interface FundHoldingInstrumentIdentity {
    isin?: string;
    ticker?: string;
    figi?: string;
}

export interface FundHolding {
    holding_id: string;
    source: 'fondosdb';
    fund_asset_id: string;
    fund_isin?: string;
    holding_name: string;
    holding_weight: number | null;
    holding_weight_unit: 'percent';
    instrument_type: 'equity' | 'bond' | 'fund' | 'cash' | 'derivative' | 'other' | 'unknown';
    currency?: string;
    country?: string;
    sector?: string;
    
    // Identifiers
    identifiers?: FundHoldingInstrumentIdentity;
    isin?: string;
    ticker?: string;
    figi?: string;
    
    // Bond specific
    maturity_date?: string;
    coupon?: number;
    credit_quality?: string;
    
    raw_source?: Record<string, unknown>;
    quality_flags: string[];
}

export interface FundHoldingsQualitySummary {
    missing_weights_count: number;
    unknown_instrument_types_count: number;
    coverage_ratio: number;
    has_critical_warnings: boolean;
}

export interface FundHoldingsChunk {
    fund_asset_id: string;
    chunk_index: number;
    chunk_id: string;
    holdings: FundHolding[];
    total_holdings_in_chunk: number;
    estimated_bytes: number;
}

export interface FundHoldingsPayload {
    fund_asset_id: string;
    fund_isin?: string;
    as_of_date?: string;
    holdings_count: number;
    total_reported_weight: number;
    top10_weight?: number;
    holdings?: FundHolding[];
    quality_summary: FundHoldingsQualitySummary;
    warnings: string[];
    source_metadata?: Record<string, unknown>;
    
    // Hybrid Storage additions
    storage_mode?: FundHoldingsStorageMode;
    chunks_count?: number;
    chunk_ids?: string[];
}

export interface FundHoldingsHybridPayloadPreview {
    manifest: FundHoldingsPayload;
    chunks: FundHoldingsChunk[];
}

export function validateFundHolding(holding: any): { success: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!holding) return { success: false, errors: ['Holding is null'] };
    if (!holding.holding_id) errors.push('holding_id is required');
    if (holding.source !== 'fondosdb') errors.push('source must be fondosdb');
    if (!holding.fund_asset_id) errors.push('fund_asset_id is required');
    if (!holding.holding_name) errors.push('holding_name is required');
    if (holding.holding_weight !== null && typeof holding.holding_weight !== 'number') errors.push('holding_weight must be number or null');
    if (holding.holding_weight_unit !== 'percent') errors.push('holding_weight_unit must be percent');
    if (!['equity', 'bond', 'fund', 'cash', 'derivative', 'other', 'unknown'].includes(holding.instrument_type)) {
        errors.push('instrument_type is invalid');
    }
    return { success: errors.length === 0, errors };
}

export function validateFundHoldingsPayload(payload: any): { success: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!payload) return { success: false, errors: ['Payload is null'] };
    if (!payload.fund_asset_id) errors.push('fund_asset_id is required');
    if (typeof payload.holdings_count !== 'number') errors.push('holdings_count must be number');
    if (typeof payload.total_reported_weight !== 'number') errors.push('total_reported_weight must be number');
    
    if (payload.storage_mode !== HOLDINGS_STORAGE_MODE.CHUNKED && !Array.isArray(payload.holdings)) {
        errors.push('holdings must be an array for SINGLE_DOCUMENT');
    }
    
    if (!payload.quality_summary) errors.push('quality_summary is required');
    
    if (Array.isArray(payload.holdings)) {
        for (const h of payload.holdings) {
            const res = validateFundHolding(h);
            if (!res.success) {
                errors.push(`Holding validation failed: ${res.errors.join(', ')}`);
            }
        }
    }
    return { success: errors.length === 0, errors };
}
