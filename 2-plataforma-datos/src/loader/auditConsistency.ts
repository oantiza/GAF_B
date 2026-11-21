/**
 * src/loader/auditConsistency.ts — AUDIT READ-ONLY de integridad maestra vs canónico (F3).
 *
 * Para cada activo existente en la maestra: re-mapea su canónico con el MISMO mapper V1 y
 * compara, campo a campo, los campos QUE EL MAPPER POSEE (ignora enriquecidos de otras
 * tuberías: listings/metrics/price_series, y los aditivos schema_version/updated_at).
 * Detecta deriva entre lo cargado (viejo vs nuevo) y la fuente. NO escribe nada, NO usa gate.
 *
 *   npm run audit:consistency -- --input "<dir fondosdb>" --ids all [--limit N]
 *
 * Requiere FIREBASE_PROJECT_ID + credenciales de SOLO LECTURA. Nunca define el gate de escritura.
 *
 * Exige --input y la poblacion stock (CRIT-09, 16-10-2026): sin ellas aborta antes de leer la maestra. Antes
 * avisaba y seguia «solo con fondos», y las 74 acciones del canonico salian como deriva de fondo (y los
 * fondos, sin fondos.ndjson, tambien se mapean distinto): un F3 falso. Abortar no cuesta nada (es solo
 * lectura: se repite con --input) y el resultado del audit es una senal que decide escrituras.
 *
 * Las acciones NOT_READY/EXCLUDED que difieren de la maestra no cuentan como deriva (el republish las retiene y
 * republicar no las corrige): van en held_drift y held.json, y stock_not_ready_ids lista solo las pedidas.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { mapFondosDbFund } from '../ingestion/fondosdb/fondosDbMapper';
import { isStockCanonical } from '../ingestion/fondosdbStockAssets';
import { canonicalIssuesForAsset, CanonicalPackagePaths, readCanonicalPackage } from './packageReader';
import { ownedDrift } from './driftCriteria';
import { planHoldingsRepublish } from './holdingsRepublish';
import { loadStockPopulation, mergeOwnedDetailed, OwnershipConflictError, rewriteDrift, STOCK_HOLD_STATUSES } from './republish';
import { ALLOWED_PROJECT_IDS } from '../config/projectAllowlist';


// `live_missing` esperados. Debe quedar vacio salvo exclusiones temporales
// documentadas: cualquier ISIN aqui deja de ser senal del gate F3.
const EXPECTED_LIVE_MISSING = new Set<string>([]);

function getFlag(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function resolvePaths(argv: string[], env: NodeJS.ProcessEnv = process.env): CanonicalPackagePaths {
    const input = getFlag(argv, '--input') || env.FONDOSDB_INPUT_DIR || '';
    const exportBdbDir = getFlag(argv, '--export-bdb') || (input ? path.join(input, 'export_bdb') : '');
    if (!exportBdbDir || !fs.existsSync(exportBdbDir)) {
        throw new Error(`No encuentro export_bdb. Usa --input <dir>. (recibido: '${exportBdbDir}')`);
    }
    return {
        exportBdbDir,
        fondosNdjsonPath: input ? path.join(input, 'export', 'fondos.ndjson') : '',
        posicionesNdjsonPath: input ? path.join(input, 'export', 'posiciones.ndjson') : '',
        manifestPath: input ? path.join(input, 'export', 'manifest.json') : undefined,
        problematicReportPath: input ? path.join(input, 'reports', 'fondos_problematicos.md') : undefined,
        qualityCsvPath: input ? path.join(input, 'reports', 'calidad_resumen.csv') : undefined
    };
}

function getDb(env: NodeJS.ProcessEnv = process.env): admin.firestore.Firestore {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID ausente.');
    if (!ALLOWED_PROJECT_IDS.has(projectId)) throw new Error(`Project id fuera de allowlist: ${projectId}`);
    if (env.BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES) {
        throw new Error('SECURITY: este audit es read-only; no debe correr con el gate de escritura activo.');
    }
    if (!admin.apps.length) admin.initializeApp({ projectId });
    return admin.firestore();
}

export interface AuditDeps {
    /** Maestra a usar (los tests pasan una falsa); por defecto, la de FIREBASE_PROJECT_ID, solo lectura. */
    db?: admin.firestore.Firestore;
    env?: NodeJS.ProcessEnv;
}

/** El audit entero sobre unos argumentos; devuelve el resumen (que tambien deja en --out). No escribe en la maestra. */
export async function runAudit(argv: string[], deps: AuditDeps = {}): Promise<Record<string, any>> {
    const env = deps.env || process.env;
    const paths = resolvePaths(argv, env);
    const idsArg = getFlag(argv, '--ids') || 'all';
    const limit = getFlag(argv, '--limit') ? Number(getFlag(argv, '--limit')) : undefined;
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(getFlag(argv, '--out') || path.join(process.cwd(), 'runs'), `audit_${runId}`);
    fs.mkdirSync(outDir, { recursive: true });

    const pkg = readCanonicalPackage(paths);

    // Población de ACCIONES: se escribieron por la tubería stock (buildStockRow), NO por mapFondosDbFund.
    // El audit debe juzgar cada activo contra su propio oráculo. Obligatoria: sin --input, o si no se puede
    // leer o evaluar, se aborta antes de leer la maestra (ver cabecera).
    const inputDir = getFlag(argv, '--input') || env.FONDOSDB_INPUT_DIR || '';
    const stockRowByIsin = loadStockPopulation(inputDir, true);
    const db = deps.db || getDb(env);

    let candidates: string[];
    if (idsArg === 'all') candidates = [...new Set([
        ...pkg.rawByIsin.keys(),
        ...pkg.canonicalValidationIssues.map((issue) => issue.asset_id).filter((id): id is string => Boolean(id))
    ])];
    else if (fs.existsSync(idsArg)) candidates = fs.readFileSync(idsArg, 'utf-8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    else candidates = idsArg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (limit) candidates = candidates.slice(0, limit);

    const results = {
        matched: 0,
        drifted: 0,
        live_missing: 0,
        no_canonical: 0,
        canonical_invalid: 0,
        // Difieren del canonico, pero el merge del republish las dejaria igual (legado de la app que
        // conserva a proposito): no cuentan como deriva, igual que en el republish (rewriteDrift).
        unchanged_after_merge: 0,
        // Canonicos de accion sin fila stock: no se juzgan como fondo (CRIT-09).
        stock_without_row: 0,
        // Acciones NOT_READY/EXCLUDED que difieren de la maestra: el republish las retiene, asi que republicar no
        // las corrige. Van aparte (held.json) y no cuentan en drifted: la senal de acciones vuelve a 0 cuando
        // solo queda deriva retenida.
        held_drift: 0,
        holdings_checked: 0,
        holdings_stale: 0
    };
    const byPop = { fund: { matched: 0, drifted: 0 }, stock: { matched: 0, drifted: 0, held_drift: 0 } };
    const drifts: Array<{ asset_id: string; paths: string[] }> = [];
    const held: Array<{ asset_id: string; status: string; reasons: string[]; paths: string[] }> = [];
    const fieldCounter: Record<string, number> = {};
    const liveMissingIds: string[] = [];
    const noCanonicalIds: string[] = [];
    const canonicalInvalidIds: string[] = [];
    const stockWithoutRowIds: string[] = [];
    const holdingsStale: Array<{ asset_id: string; reasons: string[]; decision: string; expected_as_of_date: string | null; live_as_of_date: string | null }> = [];

    for (let i = 0; i < candidates.length; i += 250) {
        const chunk = candidates.slice(i, i + 250);
        const snaps = await db.getAll(...chunk.map((id) => db.doc(`assets/${id}`)));
        for (let j = 0; j < chunk.length; j++) {
            const isin = chunk[j];
            const snap = snaps[j];
            if (canonicalIssuesForAsset(pkg, isin).length > 0) {
                results.canonical_invalid++;
                canonicalInvalidIds.push(isin);
                continue;
            }
            if (!snap.exists) { results.live_missing++; liveMissingIds.push(isin); continue; }
            // Enrutado por población: la acción se juzga contra su root stock; el fondo contra el mapper V1.
            const isStock = stockRowByIsin.has(isin);
            let expected: any;
            if (isStock) {
                expected = stockRowByIsin.get(isin)!.root;
            } else {
                const entry = pkg.rawByIsin.get(isin);
                if (!entry) { results.no_canonical++; noCanonicalIds.push(isin); continue; }
                // Una accion sin fila stock nunca se juzga contra el mapper de fondos (CRIT-09).
                if (isStockCanonical(entry.data)) { results.stock_without_row++; stockWithoutRowIds.push(isin); continue; }
                const mapped = mapFondosDbFund(entry.file, entry.data, pkg.universalByIsin.get(isin), {
                    duplicateIsin: pkg.duplicateIsins.has(isin),
                    problematicFlags: pkg.problematicByIsin.get(isin)?.flags,
                    qualityFlags: pkg.qualityByIsin.get(isin)?.flags
                });
                if (!mapped.asset) { results.no_canonical++; noCanonicalIds.push(isin); continue; }
                if (mapped.asset.asset_type === 'STOCK') { results.stock_without_row++; stockWithoutRowIds.push(isin); continue; }
                expected = mapped.asset;
            }
            const live: any = snap.data() || {};
            let filtered = ownedDrift(expected, live, isStock);
            if (filtered.length > 0) {
                try {
                    const merged = mergeOwnedDetailed(live, expected, isStock, new Date().toISOString());
                    if (rewriteDrift(live, expected, merged.doc, isStock).length === 0) {
                        results.unchanged_after_merge++;
                        filtered = [];
                    }
                } catch (e: any) {
                    // Conflicto de dueno: el republish no la reescribe, pero sigue siendo deriva.
                    if (!(e instanceof OwnershipConflictError)) throw e;
                }
            }
            const pop = isStock ? byPop.stock : byPop.fund;
            const stockRow = stockRowByIsin.get(isin);
            // Retenida como en el republish; un cambio de tipo (reclasificacion) sigue siendo deriva.
            const isHeld = !!stockRow && STOCK_HOLD_STATUSES.has(stockRow.status) && (!live.asset_type || live.asset_type === expected.asset_type);
            if (filtered.length === 0) { results.matched++; pop.matched++; }
            else if (isHeld) {
                results.held_drift++;
                byPop.stock.held_drift++;
                held.push({ asset_id: isin, status: stockRow!.status, reasons: stockRow!.status_reasons || [], paths: [...new Set(filtered)].sort() });
            } else {
                results.drifted++; pop.drifted++;
                drifts.push({ asset_id: isin, paths: filtered });
                for (const p of filtered) {
                    const top = p.split('.')[0];
                    fieldCounter[top] = (fieldCounter[top] || 0) + 1;
                }
            }

            if (!isStock) {
                const holdings = pkg.holdingsByFundIsin.get(isin) || [];
                if (holdings.length > 0) {
                    results.holdings_checked++;
                    const holdingsPlan = await planHoldingsRepublish(
                        db,
                        isin,
                        holdings,
                        new Date().toISOString()
                    );
                    if (holdingsPlan.stale) {
                        results.holdings_stale++;
                        holdingsStale.push({
                            asset_id: isin,
                            reasons: holdingsPlan.reasons,
                            decision: holdingsPlan.decision,
                            expected_as_of_date: holdingsPlan.expected_as_of_date,
                            live_as_of_date: holdingsPlan.live_as_of_date
                        });
                    }
                }
            }
        }
    }

    const summary = {
        run_id: runId,
        checked: candidates.length,
        ...results,
        stock_population: stockRowByIsin.size,
        // Acciones pedidas que el republish no reescribe (NOT_READY/EXCLUDED): su deriva no se corrige republicando.
        stock_not_ready_ids: candidates
            .filter((id) => STOCK_HOLD_STATUSES.has(stockRowByIsin.get(id)?.status || ''))
            .sort(),
        held_drift_ids: held.map((item) => item.asset_id).sort(),
        stock_without_row_ids: [...stockWithoutRowIds].sort(),
        live_missing_ids: [...liveMissingIds].sort(),
        live_missing_unexpected: liveMissingIds.filter((id) => !EXPECTED_LIVE_MISSING.has(id)).sort(),
        no_canonical_ids: [...noCanonicalIds].sort(),
        canonical_invalid_ids: [...canonicalInvalidIds].sort(),
        canonical_validation_issues: pkg.canonicalValidationIssues,
        holdings_stale_ids: holdingsStale.map((item) => item.asset_id).sort(),
        by_population: byPop,
        drift_by_top_field: Object.fromEntries(Object.entries(fieldCounter).sort((a, b) => b[1] - a[1])),
        note: 'Routing por poblacion: acciones via buildStockRow (tuberia stock), fondos via mapFondosDbFund. Holdings compara as_of_date, hash logico y layout latest/chunks. Ignora listings/metrics/price_series, schema_version/updated_at, source_metadata y performance.valuation.* (refresh-owned). 0 escrituras.'
    };
    fs.writeFileSync(path.join(outDir, 'audit_summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'drifts.json'), JSON.stringify(drifts, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'holdings_drifts.json'), JSON.stringify(holdingsStale, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'held.json'), JSON.stringify(held, null, 2) + '\n', 'utf-8');

    console.log('[audit] consistencia maestra vs canonico (read-only)');
    console.log(`   checked=${summary.checked}  matched=${results.matched}  drifted=${results.drifted}  live_missing=${results.live_missing}  no_canonical=${results.no_canonical}`);
    console.log(`   por poblacion -> fondos: ${byPop.fund.matched} match / ${byPop.fund.drifted} drift · acciones: ${byPop.stock.matched} match / ${byPop.stock.drifted} drift / ${byPop.stock.held_drift} retenidas con deriva (held.json) (stock_pop=${stockRowByIsin.size}, sin fila stock=${results.stock_without_row})`);
    console.log(`   holdings_stale=${results.holdings_stale}/${results.holdings_checked}`);
    const liveMissingUnexpected = liveMissingIds.filter((id) => !EXPECTED_LIVE_MISSING.has(id));
    console.log(`   live_missing: ${results.live_missing} (esperados ${results.live_missing - liveMissingUnexpected.length}, inesperados ${liveMissingUnexpected.length})`);
    if (liveMissingUnexpected.length > 0) console.log('   live_missing INESPERADOS:', liveMissingUnexpected.slice(0, 20).join(', '));
    if (results.drifted > 0) {
        console.log('   deriva por campo (top):', JSON.stringify(summary.drift_by_top_field));
        console.log('   ejemplos:', drifts.slice(0, 5).map((d) => `${d.asset_id}:${d.paths.slice(0, 3).join(',')}`).join(' | '));
    }
    console.log(`[audit] artefactos en ${outDir}`);
    return summary;
}

async function main(): Promise<void> {
    await runAudit(process.argv.slice(2));
}

if (require.main === module) {
    main().catch((e) => {
        console.error('[audit] ERROR:', e?.message || e);
        process.exit(1);
    });
}
