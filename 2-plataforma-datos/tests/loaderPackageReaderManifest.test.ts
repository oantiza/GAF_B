import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { readCanonicalPackage } from '../src/loader/packageReader';
import { buildPlan } from '../src/loader/planner';

function sha1(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex');
}

function sha256File(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writePackage(manifestOverride: Record<string, unknown> = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-package-'));
    const exportDir = path.join(dir, 'export');
    const exportBdbDir = path.join(dir, 'export_bdb');
    fs.mkdirSync(exportDir, { recursive: true });
    fs.mkdirSync(exportBdbDir, { recursive: true });

    const isin = 'ES0123456789';
    const fundLine = JSON.stringify({ _id: isin, meta: { isin } });
    const positionLine = JSON.stringify({ isin, posiciones: [] });
    fs.writeFileSync(path.join(exportBdbDir, `${isin}.json`), `${JSON.stringify({ isin, name: 'Fund' })}\n`, 'utf-8');
    fs.writeFileSync(path.join(exportDir, 'fondos.ndjson'), `${fundLine}\n`, 'utf-8');
    fs.writeFileSync(path.join(exportDir, 'posiciones.ndjson'), `${positionLine}\n`, 'utf-8');
    fs.writeFileSync(path.join(exportDir, 'manifest.json'), JSON.stringify({
        esquema_version: 'fondosdb-ndjson.v1',
        conteos: { fondos: 1, posiciones: 1 },
        sha1_por_fondo: { [isin]: sha1(fundLine) },
        ...manifestOverride
    }, null, 2), 'utf-8');

    return {
        exportBdbDir,
        fondosNdjsonPath: path.join(exportDir, 'fondos.ndjson'),
        posicionesNdjsonPath: path.join(exportDir, 'posiciones.ndjson'),
        manifestPath: path.join(exportDir, 'manifest.json')
    };
}

function writeStrongPackage() {
    const paths = writePackage();
    const packageId = 'a'.repeat(64);
    const canonicalName = 'ES0123456789.json';
    const canonicalPath = path.join(paths.exportBdbDir, canonicalName);
    fs.writeFileSync(path.join(paths.exportBdbDir, '_resumen.json'), JSON.stringify({
        package_id: packageId,
        errores: 0,
        files: {
            [canonicalName]: { bytes: fs.statSync(canonicalPath).size, sha256: sha256File(canonicalPath) }
        }
    }), 'utf-8');
    const files = Object.fromEntries([
        paths.fondosNdjsonPath,
        paths.posicionesNdjsonPath
    ].map((file) => [path.basename(file), {
        bytes: fs.statSync(file).size,
        sha256: sha256File(file),
        line_count: 1
    }]));
    fs.writeFileSync(paths.manifestPath, JSON.stringify({
        esquema_version: 3,
        package_id: packageId,
        n_fondos: 1,
        n_lineas_posiciones: 1,
        files,
        fondos: [{ isin: 'ES0123456789', hash: sha1(fs.readFileSync(paths.fondosNdjsonPath, 'utf-8').trim()) }]
    }), 'utf-8');
    return paths;
}

describe('loader packageReader manifest validation', () => {
    it('acepta un paquete v3 enlazado por package_id y hashes SHA256', () => {
        const pkg = readCanonicalPackage(writeStrongPackage());
        expect(pkg.rawByIsin.has('ES0123456789')).toBe(true);
    });

    it('rechaza un fichero alterado despues de publicar el manifest v3', () => {
        const paths = writeStrongPackage();
        fs.appendFileSync(paths.posicionesNdjsonPath, '{}\n', 'utf-8');
        expect(() => readCanonicalPackage(paths)).toThrow(/bytes no coinciden|sha256 no coincide/);
    });

    it('rechaza export y export_bdb de snapshots distintos', () => {
        const paths = writeStrongPackage();
        const summaryPath = path.join(paths.exportBdbDir, '_resumen.json');
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        summary.package_id = 'b'.repeat(64);
        fs.writeFileSync(summaryPath, JSON.stringify(summary), 'utf-8');
        expect(() => readCanonicalPackage(paths)).toThrow(/snapshots distintos/);
    });

    it('valida conteos y sha1 por fondo antes de devolver el paquete', () => {
        const pkg = readCanonicalPackage(writePackage());

        expect(pkg.rawByIsin.has('ES0123456789')).toBe(true);
        expect(pkg.universalByIsin.has('ES0123456789')).toBe(true);
        expect(pkg.canonicalValidationIssues).toEqual([]);
    });

    it('falla con mensaje claro si el conteo del manifiesto no coincide', () => {
        expect(() => readCanonicalPackage(writePackage({ conteos: { fondos: 2, posiciones: 1 } })))
            .toThrow(/conteo fondos\.ndjson no cuadra/);
    });

    it('retiene en REVIEW un fondo canonico invalido incluso con include-review', () => {
        const paths = writePackage();
        fs.writeFileSync(
            path.join(paths.exportBdbDir, 'ES0123456789.json'),
            JSON.stringify({ isin: 'ES0123456789', name: 'Fund', currency: 123 }),
            'utf-8'
        );

        const pkg = readCanonicalPackage(paths);
        const plan = buildPlan({
            ...paths,
            selection: { mode: 'quality-ok' },
            targets: { root: true, holdings: true },
            includeReview: true,
            write: false,
            outputDir: 'unused'
        }, pkg, null, 'canonical-invalid-fund');

        expect(pkg.canonicalValidationIssues[0]).toMatchObject({
            source: 'export_bdb',
            file: 'ES0123456789.json',
            asset_id: 'ES0123456789'
        });
        expect(plan.package_validation.status).toBe('REVIEW');
        expect(plan.package_summary.canonical_invalid_documents).toBe(1);
        expect(plan.items[0].action).toBe('REVIEW_HOLD');
        expect(plan.items[0].contract_errors.join(' ')).toContain('must be string,null');
    });

    it('valida lineas de holdings y no incorpora una linea invalida', () => {
        const paths = writePackage();
        fs.writeFileSync(
            paths.posicionesNdjsonPath,
            `${JSON.stringify({
                isin: 'ES0123456789',
                posiciones: [{ nombre: 'Holding', peso_pct: 'no-es-numero' }]
            })}\n`,
            'utf-8'
        );

        const pkg = readCanonicalPackage(paths);

        expect(pkg.canonicalValidationIssues[0]).toMatchObject({
            source: 'posiciones.ndjson',
            line: 1,
            asset_id: 'ES0123456789'
        });
        expect(pkg.holdingsByFundIsin.has('ES0123456789')).toBe(false);
    });

    it('elige el contrato canonicalStock para canonicos de acciones', () => {
        const paths = writePackage();
        fs.writeFileSync(
            path.join(paths.exportBdbDir, 'ES0123456789.json'),
            JSON.stringify({
                isin: 'ES0123456789',
                name: 'Stock',
                classification_v2: { asset_type: 'stock' },
                ms: { stock: { ticker: 42 } }
            }),
            'utf-8'
        );

        const pkg = readCanonicalPackage(paths);

        expect(pkg.canonicalValidationIssues).toHaveLength(1);
        expect(pkg.canonicalValidationIssues[0].errors.join(' ')).toContain('/ms/stock/ticker');
    });
});
