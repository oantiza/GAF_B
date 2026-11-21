/**
 * src/loader/cli.ts — punto de entrada del cargador unico.
 *
 *   npx tsx src/loader/cli.ts --input <dir_fondosdb> --ids quality-ok --dry-run
 *   npx tsx src/loader/cli.ts --input <dir_fondosdb> --ids missing  --targets root,holdings --dry-run
 *   BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
 *     npx tsx src/loader/cli.ts --input <dir> --ids quality-ok --limit 5 --write
 *
 * Enruta por poblacion: las acciones (classification_v2.asset_type==='stock') se cargan por su
 * tuberia (buildStockRow -> master/asset-stock.v1); los fondos por el mapper V1 (master/asset.v1).
 * Dry-run por defecto. Escribe artefactos en runs/<run_id>/.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CanonicalPackagePaths, readCanonicalPackage } from './packageReader';
import { buildPlan, StockRowLite } from './planner';
import { annotatePlanDocuments, executePlan, getDb, getExistingAssetIds } from './writer';
import { evaluateStockRows, readStockRows } from '../ingestion/fondosdbStockAssets';
import { LoaderArgs, SelectionMode } from './types';

function getFlag(argv: string[], name: string): string | undefined {
    const idx = argv.indexOf(name);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
}
function hasFlag(argv: string[], name: string): boolean {
    return argv.includes(name);
}

function resolvePaths(argv: string[]): CanonicalPackagePaths {
    const input = getFlag(argv, '--input') || process.env.FONDOSDB_INPUT_DIR;
    const exportBdbDir = getFlag(argv, '--export-bdb') || process.env.FONDOSDB_EXPORT_BDB_DIR || (input ? path.join(input, 'export_bdb') : '');
    const fondosNdjsonPath = getFlag(argv, '--fondos') || process.env.FONDOSDB_FONDOS_NDJSON || (input ? path.join(input, 'export', 'fondos.ndjson') : '');
    const posicionesNdjsonPath = getFlag(argv, '--posiciones') || process.env.FONDOSDB_POSICIONES_NDJSON || (input ? path.join(input, 'export', 'posiciones.ndjson') : '');
    const manifestPath = getFlag(argv, '--manifest') || process.env.FONDOSDB_NDJSON_MANIFEST_PATH || (input ? path.join(input, 'export', 'manifest.json') : undefined);
    const problematicReportPath = input ? path.join(input, 'reports', 'fondos_problematicos.md') : undefined;
    const qualityCsvPath = input ? path.join(input, 'reports', 'calidad_resumen.csv') : undefined;

    if (!exportBdbDir || !fs.existsSync(exportBdbDir)) {
        throw new Error(`No encuentro export_bdb. Usa --input <dir> o --export-bdb <dir>. (recibido: '${exportBdbDir}')`);
    }
    return {
        exportBdbDir,
        fondosNdjsonPath,
        posicionesNdjsonPath,
        manifestPath,
        problematicReportPath: problematicReportPath && fs.existsSync(problematicReportPath) ? problematicReportPath : undefined,
        qualityCsvPath: qualityCsvPath && fs.existsSync(qualityCsvPath) ? qualityCsvPath : undefined
    };
}

function resolveSelectionArg(argv: string[]): { mode: SelectionMode; ids?: string[] } {
    const raw = getFlag(argv, '--ids') || 'quality-ok';
    if (raw === 'quality-ok' || raw === 'missing' || raw === 'all') return { mode: raw };
    if (fs.existsSync(raw)) {
        const ids = fs.readFileSync(raw, 'utf-8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        return { mode: 'list', ids };
    }
    return { mode: 'list', ids: raw.split(',').map((s) => s.trim()).filter(Boolean) };
}

function resolveTargets(argv: string[]): { root: boolean; holdings: boolean; metrics: boolean } {
    const raw = (getFlag(argv, '--targets') || 'root').split(',').map((s) => s.trim());
    return { root: raw.includes('root'), holdings: raw.includes('holdings'), metrics: raw.includes('metrics') };
}

function hasCredentials(): boolean {
    const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    return !!process.env.FIREBASE_PROJECT_ID && !!cred && fs.existsSync(path.resolve(process.cwd(), cred));
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const paths = resolvePaths(argv);
    const write = hasFlag(argv, '--write');
    const args: LoaderArgs = {
        ...paths,
        selection: resolveSelectionArg(argv),
        targets: resolveTargets(argv),
        includeReview: hasFlag(argv, '--include-review'),
        write,
        outputDir: '',
        limit: getFlag(argv, '--limit') ? Number(getFlag(argv, '--limit')) : undefined
    };

    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const runsBase = getFlag(argv, '--out') || process.env.FONDOSDB_LOADER_RUNS_DIR || path.join(process.cwd(), 'runs');
    const outputDir = path.join(runsBase, `loader_${runId}`);
    args.outputDir = outputDir;
    fs.mkdirSync(outputDir, { recursive: true });

    console.log(`[loader] export_bdb=${paths.exportBdbDir}`);
    console.log(`[loader] selection=${args.selection.mode} targets=${JSON.stringify(args.targets)} write=${write}`);

    const pkg = readCanonicalPackage(paths);
    console.log(`[loader] paquete: ${pkg.rawByIsin.size} canonicos, ${pkg.universalByIsin.size} universal, ${pkg.holdingsByFundIsin.size} con holdings`);

    // Poblacion ACCIONES: enrutado por poblacion (mismas reglas que el audit). Solo lectura del input.
    const inputDir = getFlag(argv, '--input') || process.env.FONDOSDB_INPUT_DIR || '';
    const stockRowByIsin = new Map<string, StockRowLite>();
    try {
        const stockResult = evaluateStockRows(readStockRows(inputDir), {});
        for (const row of [...stockResult.candidates, ...stockResult.excluded]) {
            stockRowByIsin.set(row.asset_id, { root: row.root, metrics: row.metrics, status: row.status, status_reasons: row.status_reasons });
        }
        if (stockResult.summary.NOT_READY > 0 || stockResult.summary.EXCLUDED > 0) {
            console.warn(`[loader] poblacion stock con blockers: NOT_READY=${stockResult.summary.NOT_READY} EXCLUDED=${stockResult.summary.EXCLUDED}`);
        }
    } catch (e: any) {
        const message = `no se pudo leer/evaluar la poblacion stock (${String(e?.message || e)})`;
        if (write || args.selection.mode === 'missing') {
            throw new Error(`${message}; abortado para evitar enrutar acciones por el mapper de fondos.`);
        }
        console.warn(`[loader] aviso: ${message}; se continua solo con fondos.`);
    }
    console.log(`[loader] poblacion stock: ${stockRowByIsin.size} acciones (via buildStockRow -> master/asset-stock.v1)`);

    // Lectura de existencia en la maestra (solo lectura). Requerida para --write y para --ids missing.
    let existing: Set<string> | null = null;
    const needMaster = write || args.selection.mode === 'missing';
    if (needMaster && !hasCredentials()) {
        throw new Error("Esta operacion necesita leer la maestra (FIREBASE_PROJECT_ID + credenciales). Para un dry-run offline usa --ids quality-ok o una lista.");
    }
    if (hasCredentials()) {
        try {
            const db = getDb();
            existing = await getExistingAssetIds(db, [...pkg.rawByIsin.keys()]);
            console.log(`[loader] maestra: ${existing.size} de ${pkg.rawByIsin.size} canonicos ya existen`);
        } catch (e: any) {
            if (needMaster) throw e;
            console.warn(`[loader] aviso: no se pudo leer la maestra (${String(e?.message || e)}); se continua en dry-run offline.`);
        }
    }

    // Documentos por activo y validacion de todos (cartera y metrics/latest incluidos), en seco igual que al escribir.
    const plan = annotatePlanDocuments(pkg, buildPlan(args, pkg, existing, runId, stockRowByIsin), args.targets, stockRowByIsin);
    fs.writeFileSync(path.join(outputDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outputDir, 'plan.md'), renderPlanMd(plan), 'utf-8');

    console.log(`[loader] plan (${plan.selection_count} seleccionados):`);
    for (const [action, n] of Object.entries(plan.counts)) if (n > 0) console.log(`   ${action.padEnd(18)} ${n}`);

    if (write) {
        const summary = await executePlan(pkg, plan, args.targets, process.env, stockRowByIsin);
        fs.writeFileSync(path.join(outputDir, 'write_summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');
        console.log(`[loader] ESCRITURA: ${summary.writes_executed} escritos, ${summary.skipped_existing} ya existian, postverify ${summary.postverify_ok}/${summary.postverify_ok + summary.postverify_failed}, ${summary.errors.length} errores`);
        if (summary.errors.length > 0 || summary.postverify_failed > 0) process.exitCode = 1;
    } else {
        console.log('[loader] DRY-RUN: 0 escrituras. Revisa el plan en plan.json antes de --write.');
    }
    console.log(`[loader] artefactos en ${outputDir}`);
}

function renderPlanMd(plan: ReturnType<typeof buildPlan>): string {
    const lines: string[] = [];
    lines.push(`# Loader run ${plan.run_id}`, '');
    lines.push(`- write: ${plan.write}`, `- seleccion: ${plan.selection_mode} (${plan.selection_count})`, '');
    lines.push(`- validacion canonica: ${plan.package_validation.status} (${plan.package_validation.issues.length} incidencias)`, '');
    lines.push('## Acciones');
    for (const [action, n] of Object.entries(plan.counts)) lines.push(`- ${action}: ${n}`);
    const blocked = plan.items.filter((i) => i.action === 'BLOCKED_REJECTED' || i.action === 'INVALID_CONTRACT');
    if (blocked.length) {
        lines.push('', '## Bloqueados (primeros 20)');
        for (const i of blocked.slice(0, 20)) lines.push(`- ${i.asset_id} [${i.action}] ${(i.reject_reasons[0] || i.contract_errors[0] || '').slice(0, 120)}`);
    }
    if (plan.package_validation.issues.length) {
        lines.push('', '## Canonicos en revision (primeros 20)');
        for (const issue of plan.package_validation.issues.slice(0, 20)) {
            const location = `${issue.file}${issue.line ? `:${issue.line}` : ''}`;
            lines.push(`- ${issue.asset_id || 'SIN_ISIN'} [${location}] ${(issue.errors[0] || '').slice(0, 160)}`);
        }
    }
    return lines.join('\n') + '\n';
}

main().catch((e) => {
    console.error('[loader] ERROR:', e?.message || e);
    process.exit(1);
});
