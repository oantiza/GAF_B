import { Asset, AssetType } from '../../types/assets';

export type FondosDbQualityBucket = 'ALTO' | 'MEDIO' | 'BAJO' | 'BLOQUEADO' | string;
export type FondosDbImportStatus = 'ACCEPTED' | 'REVIEW' | 'REJECTED';

export interface FondosDbPackagePaths {
    inputDir: string;
    exportBdbDir: string;
    packageManifestPath: string;
    universalManifestPath: string;
    fondosNdjsonPath: string;
    posicionesNdjsonPath: string;
    problematicReportPath: string;
    qualityCsvPath: string;
    readmePath: string;
}

export interface FondosDbValidationIssue {
    severity: 'ERROR' | 'WARNING' | 'INFO';
    code: string;
    message: string;
    file?: string;
}

export interface FondosDbManifestValidation {
    status: 'OK' | 'BLOCKED_SAFE';
    input_dir: string;
    checked_at: string;
    export_bdb_exists: boolean;
    importable_json_count: number;
    invalid_json_count: number;
    resumen_json_present: boolean;
    resumen_json_imported: boolean;
    required_files: Record<string, boolean>;
    issues: FondosDbValidationIssue[];
}

export interface FondosDbRawFund {
    generated_at?: string;
    isin?: string | null;
    name?: string | null;
    currency?: string | null;
    report_date?: string | null;
    ms?: any;
    derived?: any;
    classification_v2?: any;
    portfolio_exposure_v2?: any;
    quality?: any;
    validation?: any;
    routing?: any;
    regulatory?: any;
    provenance?: any;
    [key: string]: any;
}

export interface FondosDbUniversalFund {
    identificacion?: any;
    costes?: any;
    rating?: any;
    valoracion?: any;
    rentabilidad?: any;
    riesgo?: any;
    cartera?: any;
    distribuciones?: any;
    meta?: any;
    calidad?: any;
    _id?: string;
    [key: string]: any;
}

export interface FondosDbPositionLine {
    isin: string;
    parte?: number;
    total_partes?: number;
    fecha?: string;
    posiciones?: FondosDbPosition[];
    /** De donde sale la cartera (extractor, export/posiciones.ndjson). Opcional: los paquetes anteriores no la traen. */
    procedencia?: FondosDbHoldingsProcedencia | null;
}

/** Procedencia de una cartera tal como la exporta el extractor (contrato canonical/fondosdb-holdings.v1). */
export interface FondosDbHoldingsProcedencia {
    fuente?: string | null;
    endpoint?: string | null;
    id_fuente?: string | null;
    url?: string | null;
    obtenido?: string | null;
    sha256_respuesta?: string | null;
    fecha_de?: string | null;
    cobertura?: string | null;
    posiciones_declaradas?: number | null;
    supresion_proveedor?: boolean | null;
    run_id?: string | null;
}

export interface FondosDbPosition {
    nombre?: string | null;
    isin?: string | null;
    ticker?: string | null;
    tipo?: string | null;
    peso_pct?: number | null;
    divisa?: string | null;
    sector?: string | null;
    pais?: string | null;
    [key: string]: any;
}

export interface FondosDbHoldingRecord {
    asset_id: string;
    source_fund_isin: string;
    holding_id: string;
    as_of_date?: string | null;
    name?: string | null;
    identifiers: {
        isin?: string | null;
        ticker?: string | null;
    };
    holding_type?: string | null;
    weight_pct?: number | null;
    currency?: string | null;
    sector?: string | null;
    country?: string | null;
    source_metadata: {
        source: 'FondosDB';
        file: string;
        part?: number;
        total_parts?: number;
    };
    raw_source_position?: FondosDbPosition;
    procedencia?: FondosDbHoldingsProcedencia | null;
}

export interface FondosDbNormalizedAsset extends Asset {
    product: {
        product_type: string;
        commercial_type?: string | null;
        vehicle_complexity?: string | null;
        fund_name?: string | null;
        has_listing: boolean;
    };
    classification?: Asset['classification'] & {
        fondosdb_asset_class?: string | null;
        fondosdb_asset_type?: string | null;
        asset_subtype?: string | null;
        region_primary?: string | null;
        strategy_tags?: string[];
        confidence?: number | null;
        morningstar_rating?: number | null;
    };
    costs?: {
        management_fee_pct?: number | null;
        ter_pct?: number | null;
        mifid_ongoing_pct?: number | null;
        retrocession?: number | null;
        // master.asset.v1.2: costes del KID PRIIPs (regulatory.kid.costs del canonico)
        entry_fee_max_pct?: number | null;
        exit_fee_max_pct?: number | null;
        transaction_costs_pct?: number | null;
        ongoing_costs_kid_pct?: number | null;
        kid_evidence?: Record<string, any> | null;
    };
    performance?: Record<string, any> | null;
    risk?: Record<string, any> | null;
    sustainability?: Record<string, any> | null;
    portfolio_exposure?: Record<string, any> | null;
    fixed_income_profile?: Record<string, any> | null;
    regulatory?: Record<string, any> | null;
    provenance?: { version?: number; acquired_at?: string | null; fields: Record<string, string | null> } | null;
    quality: {
        fondosdb_bucket?: FondosDbQualityBucket | null;
        fondosdb_ok?: boolean | null;
        warnings: string[];
        validation_errors: string[];
        review_flags: string[];
        status: FondosDbImportStatus;
    };
    source_metadata: {
        source: 'FondosDB';
        source_file: string;
        generated_at?: string | null;
        report_date?: string | null;
        universal_export_present: boolean;
        firestore_preview_only: true;
    };
}

export interface FondosDbMappedAsset {
    status: FondosDbImportStatus;
    asset: FondosDbNormalizedAsset | null;
    rejected_record?: Record<string, any>;
    warnings: string[];
    review_reasons: string[];
    reject_reasons: string[];
    unmapped_fields: string[];
    partially_mapped_fields: string[];
}

export interface FondosDbReaderResult {
    manifest: any | null;
    validation: FondosDbManifestValidation;
    rawFunds: Array<{ file: string; data: FondosDbRawFund }>;
    universalFundsByIsin: Map<string, FondosDbUniversalFund>;
    holdingsByFundIsin: Map<string, FondosDbHoldingRecord[]>;
    sourceFileManifest: Array<{ path: string; bytes: number; sha256: string }>;
    problematicByIsin: Map<string, { line: string; flags: string[]; bucket?: string; score?: number }>;
    qualityRowsByIsin: Map<string, { bucket?: string; score?: number; flags: string[] }>;
}

export interface FondosDbDryRunSummary {
    input_json: number;
    accepted: number;
    review: number;
    rejected: number;
    holdings: number;
    fixed_income_assets: number;
    ytw_distribution_assets: number;
    maturity_bucket_assets: number;
    sfdr_null_or_blank: number;
    without_listing: number;
    duplicate_isins: number;
    firestore_writes_executed: 0;
    firestore_deletes_executed: 0;
    base_real_writes: 0;
}

export interface FondosDbDryRunResult {
    validation: FondosDbManifestValidation;
    summary: FondosDbDryRunSummary;
    normalizedAssets: FondosDbNormalizedAsset[];
    normalizedHoldings: FondosDbHoldingRecord[];
    rejectedAssets: Record<string, any>[];
    warnings: Record<string, any>[];
    duplicateReport: Record<string, any>;
    qualitySummary: Record<string, any>;
    safetySummary: Record<string, any>;
    fieldMappingReport: string;
}

export function isSupportedAssetType(assetType: string): assetType is AssetType {
    return ['FUND', 'ETF', 'STOCK', 'INDEX', 'OTHER', 'UNKNOWN'].includes(assetType);
}
