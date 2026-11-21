/**
 * src/loader/types.ts — tipos del cargador unico (data-platform / ingest).
 *
 * El cargador reemplaza los ~90 scripts de un solo uso por un comando parametrizado:
 *   load:fondosdb --ids <list|quality-ok|missing|all> [--dry-run|--write] [--targets root,holdings]
 *
 * Dry-run por defecto. Create-only. Sin deletes. Gate propio de plataforma. Postverify obligatorio.
 */

export type SelectionMode = 'list' | 'quality-ok' | 'missing' | 'all';

export interface LoaderTargets {
    root: boolean;
    holdings: boolean;
    metrics?: boolean;
}

export interface LoaderArgs {
    /** Directorio export_bdb/ de fondosdb (canonico, 1 JSON por activo). */
    exportBdbDir: string;
    /** export/fondos.ndjson (universal). */
    fondosNdjsonPath: string;
    /** export/posiciones.ndjson (holdings). */
    posicionesNdjsonPath: string;
    /** reports/fondos_problematicos.md (opcional, paridad de review). */
    problematicReportPath?: string;
    /** reports/calidad_resumen.csv (opcional, paridad de review). */
    qualityCsvPath?: string;

    selection: { mode: SelectionMode; ids?: string[] };
    /** Que se escribe: root asset, holdings/latest y/o metrics/latest. */
    targets: LoaderTargets;
    /** Incluir en CREATE los activos con status REVIEW (por defecto quedan en REVIEW_HOLD). */
    includeReview: boolean;
    /** false = dry-run (no toca Firestore). true = intenta escribir (requiere gate). */
    write: boolean;
    /** Carpeta de artefactos de la corrida: runs/<run_id>/. */
    outputDir: string;
    /** Limite opcional de activos (para pilotos, p.ej. 5). */
    limit?: number;
}

export type PlanAction =
    | 'CREATE' //            no existe en la maestra, mapeado OK -> se creara
    | 'SKIP_EXISTS' //       ya existe en la maestra -> se omite (create-only)
    | 'REVIEW_HOLD' //       el mapper marca REVIEW -> requiere visto bueno (no se escribe salvo --include-review)
    | 'BLOCKED_REJECTED' //  el mapper RECHAZA -> no se puede escribir
    | 'REEXPORT_REQUIRED' // no hay canonico para ese ISIN -> fondosdb debe re-exportar
    | 'INVALID_CONTRACT'; // el asset mapeado no valida master/asset.v1 -> bug, bloqueado

export type MapperStatus = 'ACCEPTED' | 'REVIEW' | 'REJECTED' | 'NO_CANONICAL';

export interface PlanItem {
    asset_id: string;
    action: PlanAction;
    mapper_status: MapperStatus;
    review_reasons: string[];
    reject_reasons: string[];
    contract_errors: string[];
    holdings_count: number;
    exists_in_master: boolean | null; // null = desconocido (dry-run sin lectura de maestra)
    root_path: string; //               assets/{asset_id}
    holdings_path: string | null; //    assets/{asset_id}/holdings/latest
    /**
     * Documentos que la escritura crea para este activo con los `targets` pedidos (raiz, cartera,
     * metrics/latest), en el orden del batch. Solo CREATE y SKIP_EXISTS; en SKIP_EXISTS la escritura
     * crea solo los que falten (create-only). Lo rellena annotatePlanDocuments.
     */
    documents?: string[];
}

export interface LoaderPlan {
    run_id: string;
    created_at: string;
    write: boolean;
    selection_mode: SelectionMode;
    package_summary: {
        canonical_funds: number;
        universal_funds: number;
        funds_with_holdings: number;
        duplicate_isins: number;
        canonical_invalid_documents: number;
    };
    package_validation: {
        status: 'OK' | 'REVIEW';
        issues: Array<{
            source: string;
            file: string;
            line?: number;
            asset_id: string | null;
            errors: string[];
        }>;
    };
    selection_count: number;
    counts: Record<PlanAction, number>;
    items: PlanItem[];
    safety: { writes_executed: number; deletes_executed: number; dry_run: boolean };
}

export interface WriteOperation {
    path: string;
    kind: 'root' | 'holdings' | 'metrics' | 'search_index';
    asset_id: string;
    payload: Record<string, unknown>;
}

export interface WriteSummary {
    run_id: string;
    executed_at: string;
    project_id: string;
    gate_ok: boolean;
    dry_run: boolean;
    planned_creates: number;
    skipped_existing: number;
    writes_executed: number;
    deletes_executed: 0;
    postverify_ok: number;
    postverify_failed: number;
    errors: Array<{ path: string; error: string }>;
}
