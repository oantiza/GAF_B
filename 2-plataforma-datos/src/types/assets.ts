export type AssetType = 'FUND' | 'ETF' | 'STOCK' | 'INDEX' | 'OTHER' | 'UNKNOWN';

export interface AssetIdentity {
    name: string;
    currency?: string | null;
}

export interface AssetListing {
    listing_id: string;      
    ticker: string;
    currency?: string | null;
    exchange?: string;
    eodhd_code?: string | null;
    source_listing_id?: string | null;
    figi?: string | null;
    is_primary?: boolean;
    data_sources?: string[];
}

export interface AssetIdentifiers {
    isin?: string | null;
    ticker?: string | null;
    eodhd_code?: string | null;
    aliases?: string[];
}

export interface AssetClassification {
    asset_class?: string | null;
}

export interface Asset {
    asset_id: string;
    asset_type: AssetType;
    identity: AssetIdentity;
    identifiers?: AssetIdentifiers;
    listings: AssetListing[];
    classification?: AssetClassification;
    retrocession?: number | null;
}

export interface AssetPrice {
    asset_id: string;
    price_date: string; // YYYY-MM-DD
    close: number;
}
