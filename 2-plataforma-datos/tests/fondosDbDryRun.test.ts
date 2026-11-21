import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFondosDbPackage } from '../src/ingestion/fondosdb/fondosDbReader';

let inputDir: string;

beforeAll(() => {
    inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fondosdb-package-'));
    fs.mkdirSync(path.join(inputDir, 'export_bdb'));
    fs.mkdirSync(path.join(inputDir, 'export'));
    fs.mkdirSync(path.join(inputDir, 'reports'));
    fs.writeFileSync(path.join(inputDir, 'manifest_fondosdb_to_bbdd_activos_2026-06-12.json'), '{}');
    fs.writeFileSync(path.join(inputDir, 'README_OPERATIVO_FONDOSDB.md'), '# Fixture\n');
    fs.writeFileSync(path.join(inputDir, 'reports', 'fondos_problematicos.md'), '');
    fs.writeFileSync(path.join(inputDir, 'export', 'manifest.json'), '{}');
    fs.writeFileSync(path.join(inputDir, 'export', 'fondos.ndjson'), '');
    fs.writeFileSync(path.join(inputDir, 'export', 'posiciones.ndjson'), '');

    const fund = {
        isin: 'IE00B4L5Y983',
        name: 'Fondo autocontenido',
        currency: 'EUR',
        identificacion: { tipo: 'fondo' },
        derived: { asset_class: 'RV' },
        classification_v2: { asset_type: 'equity', commercial_type: 'fondo' },
        ms: { costs: {} },
        quality: { ok: true, warnings: [] },
        validation: { ok: true, warnings: [], errors: [] },
    };
    for (let index = 0; index < 496; index++) {
        fs.writeFileSync(
            path.join(inputDir, 'export_bdb', `${String(index).padStart(3, '0')}.json`),
            JSON.stringify(fund),
        );
    }
});

// El dry-run de importacion (fondosDbDryRun.ts) se borro el 17-11-2026 (decision A-160); el lector del paquete
// sigue vivo: lo usa load:fondosdb.
describe('FondosDB: lectura del paquete', () => {
    it('lee y valida un paquete completo sin modificarlo', () => {
        const manifestPath = path.join(inputDir, 'manifest_fondosdb_to_bbdd_activos_2026-06-12.json');
        const before = fs.statSync(manifestPath).mtimeMs;
        const reader = readFondosDbPackage(inputDir);
        const after = fs.statSync(manifestPath).mtimeMs;

        expect(reader.validation.status).toBe('OK');
        expect(reader.validation.importable_json_count).toBe(496);
        expect(reader.validation.resumen_json_imported).toBe(false);
        expect(reader.rawFunds).toHaveLength(496);
        expect(reader.validation.issues.filter(issue => issue.severity === 'ERROR')).toHaveLength(0);
        expect(after).toBe(before);
    }, 15_000);
});
