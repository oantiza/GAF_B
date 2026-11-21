/**
 * src/loader/holdingsProvenance.ts — de donde sale cada cartera.
 *
 * El extractor exporta `procedencia` en cada linea de export/posiciones.ndjson (contrato
 * canonical/fondosdb-holdings.v1) y la plataforma la escribe como `provenance` en holdings/latest o
 * en el manifest (master/holdings.v1.2). Antes del 14-10-2026 ninguna cartera decia su fuente; la
 * pasada de calidad del 28-09 solo la dejo en fund_profile/latest.holdings_review.
 */
import { validators, ValidationResult } from '../../contracts/validators';
import { FondosDbHoldingRecord, FondosDbHoldingsProcedencia } from '../ingestion/fondosdb/fondosDbTypes';

export const MASTER_HOLDINGS_V11_SCHEMA_VERSION = 'master.holdings.v1.1';
export const MASTER_HOLDINGS_V12_SCHEMA_VERSION = 'master.holdings.v1.2';

export type HoldingsCoverage = 'COMPLETE' | 'TOP_N' | 'PARTIAL' | 'UNKNOWN';
export type HoldingsDateBasis = 'holdings_detail' | 'snapshot' | 'document' | 'unknown';

export interface HoldingsProvenance {
    source: string;
    endpoint: string | null;
    source_id: string | null;
    document_url: string | null;
    retrieved_at: string | null;
    response_sha256: string | null;
    as_of_date_basis: HoldingsDateBasis;
    coverage: HoldingsCoverage;
    declared_holdings_count: number | null;
    provider_suppression: boolean | null;
    extractor_run_id: string | null;
}

const COVERAGE: Record<string, HoldingsCoverage> = { completa: 'COMPLETE', top_n: 'TOP_N', parcial: 'PARTIAL' };
const DATE_BASIS: Record<string, HoldingsDateBasis> = {
    detalle_posiciones: 'holdings_detail',
    snapshot: 'snapshot',
    documento: 'document'
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** `procedencia` del canonico -> `provenance` de la maestra. Sin fuente no hay procedencia. */
export function mapHoldingsProvenance(procedencia: FondosDbHoldingsProcedencia | null | undefined): HoldingsProvenance | null {
    const source = text(procedencia?.fuente);
    if (!procedencia || !source) return null;
    const sha = text(procedencia.sha256_respuesta);
    const declared = procedencia.posiciones_declaradas;
    return {
        source,
        endpoint: text(procedencia.endpoint),
        source_id: text(procedencia.id_fuente),
        document_url: text(procedencia.url),
        retrieved_at: text(procedencia.obtenido),
        response_sha256: sha && /^[0-9a-f]{64}$/.test(sha) ? sha : null,
        as_of_date_basis: DATE_BASIS[String(procedencia.fecha_de ?? '')] ?? 'unknown',
        coverage: COVERAGE[String(procedencia.cobertura ?? '')] ?? 'UNKNOWN',
        declared_holdings_count: Number.isInteger(declared) && (declared as number) >= 0 ? (declared as number) : null,
        provider_suppression: typeof procedencia.supresion_proveedor === 'boolean' ? procedencia.supresion_proveedor : null,
        extractor_run_id: text(procedencia.run_id)
    };
}

/** Todas las partes de una cartera comparten procedencia: vale la primera que la traiga. */
export function holdingsProvenanceFromRecords(records: FondosDbHoldingRecord[]): HoldingsProvenance | null {
    for (const record of records) {
        const mapped = mapHoldingsProvenance(record.procedencia);
        if (mapped) return mapped;
    }
    return null;
}

export function validateHoldingsPayload(payload: Record<string, unknown>): ValidationResult {
    const version = payload.schema_version;
    if (version === MASTER_HOLDINGS_V12_SCHEMA_VERSION) return validators.masterHoldingsV12(payload);
    if (version === MASTER_HOLDINGS_V11_SCHEMA_VERSION) return validators.masterHoldingsV11(payload);
    return validators.masterHoldings(payload);
}
