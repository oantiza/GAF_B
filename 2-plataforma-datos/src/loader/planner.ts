/**
 * src/loader/planner.ts — construye el PLAN (puro, sin I/O ni Firestore).
 *
 * Enrutado por poblacion:
 *  - ACCION (classification_v2.asset_type==='stock'): root ya construido por la tuberia stock
 *    (buildStockRow), validado contra master/asset-stock.v1.
 *  - FONDO: reusa el mapper V1 (mapFondosDbFund), validado contra master/asset.v1.
 * NO escribe nada.
 */
import { mapFondosDbFund } from '../ingestion/fondosdb/fondosDbMapper';
import { isStockCanonical } from '../ingestion/fondosdbStockAssets';
import { validateCurrentRoot } from './ownership';
import { FondosDbHoldingRecord } from '../ingestion/fondosdb/fondosDbTypes';
import { canonicalIssuesForAsset, CanonicalPackage } from './packageReader';
import { LoaderArgs, LoaderPlan, MapperStatus, PlanAction, PlanItem, SelectionMode } from './types';

/** Fila minima de la poblacion stock (subset de StockIngestRow) que el planner/writer necesitan. */
export type StockRowLite = { root: Record<string, any>; metrics?: Record<string, any>; status: string; status_reasons?: string[] };

/** Traduce el status de la tuberia stock (StockIngestStatus) al dominio MapperStatus del plan. */
function stockStatusToMapper(status: string): MapperStatus {
    if (status === 'READY') return 'ACCEPTED';
    if (status === 'EXCLUDED' || status === 'NOT_READY') return 'REJECTED';
    return 'REVIEW'; // READY_WITH_WARNING
}

/** Motivo de rechazo de un canonico de accion que no tiene fila en la poblacion stock. */
export const STOCK_WITHOUT_ROW_REASON = 'STOCK_WITHOUT_ROW: el canonico es una accion y no hay fila de la poblacion stock; no se trata como fondo.';

function emptyCounts(): Record<PlanAction, number> {
    return {
        CREATE: 0,
        SKIP_EXISTS: 0,
        REVIEW_HOLD: 0,
        BLOCKED_REJECTED: 0,
        REEXPORT_REQUIRED: 0,
        INVALID_CONTRACT: 0
    };
}

export function buildHoldingsSummary(records: FondosDbHoldingRecord[]): {
    holdings_count: number;
    top10_weight: number;
    as_of_date: string | null;
} {
    const weights = records.map((r) => r.weight_pct ?? 0);
    const top10 = [...weights].sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0);
    const asOf = records.find((r) => r.as_of_date)?.as_of_date ?? null;
    return { holdings_count: records.length, top10_weight: Number(top10.toFixed(4)), as_of_date: asOf };
}

/** Resuelve --ids al conjunto de ISIN objetivo. `existing` solo es necesario para 'missing'. */
export function resolveSelection(
    pkg: CanonicalPackage,
    mode: SelectionMode,
    ids: string[] | undefined,
    existing: Set<string> | null
): string[] {
    const all = [...new Set([
        ...pkg.rawByIsin.keys(),
        ...pkg.canonicalValidationIssues.map((issue) => issue.asset_id).filter((id): id is string => Boolean(id))
    ])];
    switch (mode) {
        case 'list':
            return (ids || []).map((s) => s.replace(/\s+/g, '').toUpperCase()).filter(Boolean);
        case 'all':
            return all;
        case 'quality-ok':
            return all.filter((isin) => {
                const entry = pkg.rawByIsin.get(isin);
                if (canonicalIssuesForAsset(pkg, isin).length > 0) return true;
                if (!entry) return false;
                const f = entry.data;
                return f.quality?.ok !== false && f.validation?.ok !== false;
            });
        case 'missing':
            if (!existing) {
                throw new Error("La seleccion 'missing' requiere lectura de la maestra (no disponible en dry-run offline).");
            }
            return all.filter((isin) => !existing.has(isin));
        default:
            return [];
    }
}

export function buildPlan(
    args: LoaderArgs,
    pkg: CanonicalPackage,
    existing: Set<string> | null,
    runId: string,
    stockRowByIsin: Map<string, StockRowLite> = new Map()
): LoaderPlan {
    let selection = resolveSelection(pkg, args.selection.mode, args.selection.ids, existing);
    if (typeof args.limit === 'number' && args.limit > 0) selection = selection.slice(0, args.limit);

    const items: PlanItem[] = [];
    const counts = emptyCounts();

    for (const isin of selection) {
        const rootPath = `assets/${isin}`;
        const records = pkg.holdingsByFundIsin.get(isin) || [];
        const holdingsCount = records.length;
        const holdingsPath = args.targets.holdings && holdingsCount > 0 ? `${rootPath}/holdings/latest` : null;
        const canonicalIssues = canonicalIssuesForAsset(pkg, isin);
        if (canonicalIssues.length > 0) {
            const reviewReasons = canonicalIssues.map((issue) =>
                `Canonico invalido en ${issue.file}${issue.line ? `:${issue.line}` : ''}.`
            );
            const item: PlanItem = {
                asset_id: isin,
                action: 'REVIEW_HOLD',
                mapper_status: 'REVIEW',
                review_reasons: reviewReasons,
                reject_reasons: [],
                contract_errors: canonicalIssues.flatMap((issue) => issue.errors),
                holdings_count: holdingsCount,
                exists_in_master: existing ? existing.has(isin) : null,
                root_path: rootPath,
                holdings_path: holdingsPath
            };
            items.push(item);
            counts[item.action]++;
            continue;
        }

        // --- Poblacion ACCION: juzgada contra master/asset-stock.v1 (root de buildStockRow). ---
        const stockRow = stockRowByIsin.get(isin);
        if (stockRow) {
            let action: PlanAction;
            let contractErrors: string[] = [];
            const res = validateCurrentRoot(stockRow.root, true);
            if (!res.ok) {
                action = 'INVALID_CONTRACT';
                contractErrors = res.errors.map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
            } else if (stockRow.status === 'NOT_READY' || stockRow.status === 'EXCLUDED') {
                action = 'BLOCKED_REJECTED';
            } else if (existing && existing.has(isin)) {
                action = 'SKIP_EXISTS';
            } else if (stockRow.status !== 'READY' && !args.includeReview) {
                action = 'REVIEW_HOLD';
            } else {
                action = 'CREATE';
            }
            const item: PlanItem = {
                asset_id: isin,
                action,
                mapper_status: stockStatusToMapper(stockRow.status),
                review_reasons: stockRow.status === 'READY_WITH_WARNING' ? (stockRow.status_reasons || []) : [],
                reject_reasons: stockRow.status === 'NOT_READY' || stockRow.status === 'EXCLUDED' ? (stockRow.status_reasons || []) : [],
                contract_errors: contractErrors,
                holdings_count: 0,
                exists_in_master: existing ? existing.has(isin) : null,
                root_path: rootPath,
                holdings_path: null
            };
            items.push(item);
            counts[item.action]++;
            continue;
        }

        // --- Poblacion FONDO: mapper V1 + master/asset.v1.1. ---
        const entry = pkg.rawByIsin.get(isin);
        if (!entry) {
            const item: PlanItem = {
                asset_id: isin,
                action: 'REEXPORT_REQUIRED',
                mapper_status: 'NO_CANONICAL',
                review_reasons: [],
                reject_reasons: ['Sin canonico en export_bdb: fondosdb debe re-exportar este ISIN.'],
                contract_errors: [],
                holdings_count: holdingsCount,
                exists_in_master: existing ? existing.has(isin) : null,
                root_path: rootPath,
                holdings_path: holdingsPath
            };
            items.push(item);
            counts[item.action]++;
            continue;
        }

        // Red de seguridad (CRIT-09): un canonico de accion sin fila de la poblacion stock nunca pasa por el
        // mapper de fondos, que lo tipa STOCK y el contrato de fondos lo admite; la alta lo crearia como fondo.
        // Pasa, p. ej., con --export-bdb distinto de <input>/export_bdb.
        if (isStockCanonical(entry.data)) {
            const item: PlanItem = {
                asset_id: isin,
                action: 'BLOCKED_REJECTED',
                mapper_status: 'REJECTED',
                review_reasons: [],
                reject_reasons: [STOCK_WITHOUT_ROW_REASON],
                contract_errors: [],
                holdings_count: holdingsCount,
                exists_in_master: existing ? existing.has(isin) : null,
                root_path: rootPath,
                holdings_path: null
            };
            items.push(item);
            counts[item.action]++;
            continue;
        }

        const universal = pkg.universalByIsin.get(isin);
        const mapped = mapFondosDbFund(entry.file, entry.data, universal, {
            duplicateIsin: pkg.duplicateIsins.has(isin),
            problematicFlags: pkg.problematicByIsin.get(isin)?.flags,
            qualityFlags: pkg.qualityByIsin.get(isin)?.flags
        });

        let action: PlanAction;
        let contractErrors: string[] = [];
        const rejectReasons = [...mapped.reject_reasons];

        if (mapped.status === 'REJECTED' || !mapped.asset) {
            action = 'BLOCKED_REJECTED';
        } else if (mapped.asset.asset_type === 'STOCK') {
            // Segunda red: el mapper la tipa accion por otra via (tipo declarado).
            action = 'BLOCKED_REJECTED';
            rejectReasons.push(STOCK_WITHOUT_ROW_REASON);
        } else {
            const res = validateCurrentRoot(mapped.asset, false);
            if (!res.ok) {
                action = 'INVALID_CONTRACT';
                contractErrors = res.errors.map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
            } else if (existing && existing.has(isin)) {
                action = 'SKIP_EXISTS';
            } else if (mapped.status === 'REVIEW' && !args.includeReview) {
                action = 'REVIEW_HOLD';
            } else {
                action = 'CREATE';
            }
        }

        const item: PlanItem = {
            asset_id: isin,
            action,
            mapper_status: mapped.status,
            review_reasons: mapped.review_reasons,
            reject_reasons: rejectReasons,
            contract_errors: contractErrors,
            holdings_count: holdingsCount,
            exists_in_master: existing ? existing.has(isin) : null,
            root_path: rootPath,
            holdings_path: holdingsPath
        };
        items.push(item);
        counts[item.action]++;
    }

    return {
        run_id: runId,
        created_at: new Date().toISOString(),
        write: args.write,
        selection_mode: args.selection.mode,
        package_summary: {
            canonical_funds: pkg.rawByIsin.size,
            universal_funds: pkg.universalByIsin.size,
            funds_with_holdings: pkg.holdingsByFundIsin.size,
            duplicate_isins: pkg.duplicateIsins.size,
            canonical_invalid_documents: pkg.canonicalValidationIssues.length
        },
        package_validation: {
            status: pkg.canonicalValidationIssues.length > 0 ? 'REVIEW' : 'OK',
            issues: pkg.canonicalValidationIssues
        },
        selection_count: selection.length,
        counts,
        items,
        safety: { writes_executed: 0, deletes_executed: 0, dry_run: !args.write }
    };
}
