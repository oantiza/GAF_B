import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/loader/auditConsistency';
import { FakeMasterDb } from './helpers/fakeMasterDb';
import {
    liveRoot,
    liveRootWithDrift,
    NOT_READY_ISIN,
    NOT_READY_STOCK,
    READY_ISIN,
    READY_STOCK,
    SECOND_NOT_READY_ISIN,
    SECOND_NOT_READY_STOCK,
    tempOutDir,
    writeStockPackage
} from './helpers/stockPackage';

function readArtifact(summary: Record<string, any>, base: string, file: string): any {
    return JSON.parse(fs.readFileSync(path.join(base, `audit_${summary.run_id}`, file), 'utf-8'));
}

describe('audit:consistency y acciones retenidas (H3)', () => {
    it('la deriva de una accion NOT_READY va aparte: no cuenta en drifted y sale en held.json', async () => {
        const dir = writeStockPackage([READY_STOCK, NOT_READY_STOCK, SECOND_NOT_READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${READY_ISIN}`, liveRootWithDrift(dir, READY_ISIN));
        db.put(`assets/${NOT_READY_ISIN}`, liveRootWithDrift(dir, NOT_READY_ISIN));
        db.put(`assets/${SECOND_NOT_READY_ISIN}`, liveRoot(dir, SECOND_NOT_READY_ISIN));
        const out = tempOutDir();

        const summary = await runAudit(['--input', dir, '--ids', `${READY_ISIN},${NOT_READY_ISIN}`, '--out', out], { db: db as any, env: {} });

        expect(summary.drifted).toBe(1);
        expect(summary.held_drift).toBe(1);
        expect(summary.by_population.stock).toEqual({ matched: 0, drifted: 1, held_drift: 1 });
        expect(summary.held_drift_ids).toEqual([NOT_READY_ISIN]);
        // Solo las pedidas: la otra NOT_READY de la poblacion no esta en --ids.
        expect(summary.stock_not_ready_ids).toEqual([NOT_READY_ISIN]);
        expect(readArtifact(summary, out, 'held.json')).toEqual([
            { asset_id: NOT_READY_ISIN, status: 'NOT_READY', reasons: ['FONDOSDB_BLOCKED'], paths: ['identity.name'] }
        ]);
        expect(readArtifact(summary, out, 'drifts.json').map((d: any) => d.asset_id)).toEqual([READY_ISIN]);
        expect(db.writes).toEqual([]);
    });

    it('con solo deriva retenida, la senal de acciones vuelve a 0', async () => {
        const dir = writeStockPackage([READY_STOCK, NOT_READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${READY_ISIN}`, liveRoot(dir, READY_ISIN));
        db.put(`assets/${NOT_READY_ISIN}`, liveRootWithDrift(dir, NOT_READY_ISIN));

        const summary = await runAudit(['--input', dir, '--ids', 'all', '--out', tempOutDir()], { db: db as any, env: {} });

        expect(summary.drifted).toBe(0);
        expect(summary.by_population.stock.drifted).toBe(0);
        expect(summary.held_drift).toBe(1);
        expect(summary.matched).toBe(1);
    });

    it('una NOT_READY que la maestra tiene como fondo sigue siendo deriva (reclasificacion), no retenida', async () => {
        const dir = writeStockPackage([NOT_READY_STOCK]);
        const db = new FakeMasterDb();
        db.put(`assets/${NOT_READY_ISIN}`, { ...liveRoot(dir, NOT_READY_ISIN), asset_type: 'FUND' });

        const summary = await runAudit(['--input', dir, '--ids', 'all', '--out', tempOutDir()], { db: db as any, env: {} });

        expect(summary.drifted).toBe(1);
        expect(summary.held_drift).toBe(0);
    });

    it('sin --input aborta antes de leer la maestra', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        let touched = 0;
        const db = new Proxy({}, { get: () => { touched++; throw new Error('la maestra no se debia tocar'); } });

        await expect(runAudit(['--export-bdb', path.join(dir, 'export_bdb'), '--out', tempOutDir()], { db: db as any, env: {} }))
            .rejects.toThrow(/STOCK_POPULATION_UNAVAILABLE.*falta --input/);
        expect(touched).toBe(0);
    });

    it('held.json lleva las rutas ordenadas, como stock_held.json (R5)', async () => {
        const dir = writeStockPackage([NOT_READY_STOCK]);
        const db = new FakeMasterDb();
        const live = liveRoot(dir, NOT_READY_ISIN);
        // La deriva de TSK tras CRIT-10: ownedDrift la da como eodhd_code y luego aliases.
        db.put(`assets/${NOT_READY_ISIN}`, { ...live, identifiers: { ...live.identifiers, eodhd_code: 'TSK.MCE', aliases: [NOT_READY_ISIN, 'TSK', 'TSK.MCE', 'EODHD:TSK.MCE'] } });
        const out = tempOutDir();

        const summary = await runAudit(['--input', dir, '--ids', 'all', '--out', out], { db: db as any, env: {} });

        const held = readArtifact(summary, out, 'held.json');
        expect(held[0].paths).toEqual(['identifiers.aliases', 'identifiers.eodhd_code']);
    });

    it('sin maestra inyectada, getDb usa deps.env: allowlist, proyecto ausente y puerta de escritura (R5)', async () => {
        const dir = writeStockPackage([READY_STOCK]);
        const argv = ['--input', dir, '--ids', 'all', '--out', tempOutDir()];

        await expect(runAudit(argv, { env: {} })).rejects.toThrow('FIREBASE_PROJECT_ID ausente.');
        await expect(runAudit(argv, { env: { FIREBASE_PROJECT_ID: 'otro-proyecto' } })).rejects.toThrow('Project id fuera de allowlist: otro-proyecto');
        await expect(runAudit(argv, { env: { FIREBASE_PROJECT_ID: 'gestor-activos-local', BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES' } }))
            .rejects.toThrow('SECURITY: este audit es read-only');
    });
});
