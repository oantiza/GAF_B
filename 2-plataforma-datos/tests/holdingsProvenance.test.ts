import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { validators } from '../contracts/validators';
import { buildHoldingsOperations } from '../src/loader/writer';
import { executeHoldingsRepublish, planHoldingsRepublish } from '../src/loader/holdingsRepublish';
import { mapHoldingsProvenance, validateHoldingsPayload } from '../src/loader/holdingsProvenance';
import { readCanonicalPackage } from '../src/loader/packageReader';
import { cloneFirestoreValue } from './helpers/strictFirestoreValue';

const clone = <T>(value: T): T => cloneFirestoreValue(value);
const NOW = '2026-10-14T00:00:00.000Z';
const SHA = 'ab'.repeat(32);

const procedencia = (cobertura: string, extra: Record<string, unknown> = {}) => ({
    fuente: 'morningstar_lt', endpoint: 'sal_position', id_fuente: 'F0GBR04PDI', url: null,
    obtenido: '2026-10-14T05:00:00+00:00', sha256_respuesta: SHA, fecha_de: 'detalle_posiciones',
    cobertura, posiciones_declaradas: 386, supresion_proveedor: cobertura === 'top_n', run_id: null, ...extra
});

function records(assetId: string, count: number, asOfDate: string, proc: Record<string, unknown> | null = null, namePadding = 0) {
    return Array.from({ length: count }, (_, index) => ({
        asset_id: assetId,
        source_fund_isin: assetId,
        holding_id: `${assetId}:H${index}:${index + 1}`,
        as_of_date: asOfDate,
        name: `Holding ${index} ${'x'.repeat(namePadding)}`,
        identifiers: { isin: null, ticker: `T${index}` },
        holding_type: 'rv',
        weight_pct: 100 / count,
        currency: 'EUR',
        sector: null,
        country: null,
        source_metadata: { source: 'FondosDB', file: 'export/posiciones.ndjson' },
        procedencia: proc
    })) as any[];
}

class DbMock {
    readonly documents = new Map<string, Record<string, any>>();
    doc(p: string) {
        return { path: p, get: async () => ({ exists: this.documents.has(p), data: () => clone(this.documents.get(p)) }) };
    }
    collection(p: string) {
        return {
            get: async () => ({
                docs: [...this.documents.entries()]
                    .filter(([d]) => d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes('/'))
                    .map(([d, payload]) => ({ id: d.slice(p.length + 1), ref: { path: d }, data: () => clone(payload) }))
            })
        };
    }
    batch() {
        const ops: Array<[string, Record<string, any> | null]> = [];
        return {
            set: (ref: { path: string }, payload: Record<string, any>) => ops.push([ref.path, clone(payload)]),
            delete: (ref: { path: string }) => ops.push([ref.path, null]),
            commit: async () => { for (const [p, v] of ops) { if (v) this.documents.set(p, v); else this.documents.delete(p); } }
        };
    }
}

function seed(db: DbMock, assetId: string, count: number, asOfDate: string) {
    for (const op of buildHoldingsOperations(assetId, records(assetId, count, asOfDate), '2026-09-28T00:00:00.000Z')) {
        db.documents.set(op.path, clone(op.payload as Record<string, any>));
    }
}

describe('procedencia de la cartera (master/holdings.v1.2)', () => {
    it('se copia del canonico a holdings/latest y valida el contrato', () => {
        const [op] = buildHoldingsOperations('LU0000000401', records('LU0000000401', 10, '2026-09-30', procedencia('top_n')), NOW);
        const payload = op.payload as any;
        expect(payload.schema_version).toBe('master.holdings.v1.2');
        expect(payload.provenance).toEqual({
            source: 'morningstar_lt', endpoint: 'sal_position', source_id: 'F0GBR04PDI', document_url: null,
            retrieved_at: '2026-10-14T05:00:00+00:00', response_sha256: SHA, as_of_date_basis: 'holdings_detail',
            coverage: 'TOP_N', declared_holdings_count: 386, provider_suppression: true, extractor_run_id: null
        });
        expect(validators.masterHoldingsV12(payload).ok).toBe(true);
        expect(validators.masterHoldingsV11(payload).ok).toBe(false);
    });

    it('sin procedencia no inventa una: el documento no lleva provenance y sigue validando', () => {
        const [op] = buildHoldingsOperations('LU0000000402', records('LU0000000402', 3, '2026-09-30'), NOW);
        expect((op.payload as any).provenance).toBeUndefined();
        expect(validateHoldingsPayload(op.payload as any).ok).toBe(true);
    });

    it('en una cartera troceada va en el manifest, no en los chunks', () => {
        const ops = buildHoldingsOperations('LU0000000403', records('LU0000000403', 2500, '2026-09-30', procedencia('completa'), 280), NOW);
        expect(ops[0].path.endsWith('/holdings/manifest')).toBe(true);
        expect((ops[0].payload as any).provenance.coverage).toBe('COMPLETE');
        for (const op of ops.slice(1)) {
            expect((op.payload as any).provenance).toBeUndefined();
            expect(validateHoldingsPayload(op.payload as any).ok).toBe(true);
        }
        expect(validateHoldingsPayload(ops[0].payload as any).ok).toBe(true);
    });

    it('un documento v1.1 valida tambien en v1.2', () => {
        const v11 = { storage_mode: 'SINGLE_DOCUMENT', holdings_count: 1, top10_weight: 100, as_of_date: '2026-06-30', holdings: [{ holding_id: 'a' }], schema_version: 'master.holdings.v1.1', updated_at: NOW };
        expect(validators.masterHoldingsV11(v11).ok).toBe(true);
        expect(validators.masterHoldingsV12(v11).ok).toBe(true);
    });

    it('normaliza valores desconocidos y descarta una huella mal formada', () => {
        expect(mapHoldingsProvenance(procedencia('rara', { sha256_respuesta: 'no-es-sha', fecha_de: 'x', posiciones_declaradas: -1 })))
            .toMatchObject({ coverage: 'UNKNOWN', response_sha256: null, as_of_date_basis: 'unknown', declared_holdings_count: null });
        expect(mapHoldingsProvenance({ fuente: '', cobertura: 'completa' })).toBeNull();
        expect(mapHoldingsProvenance(null)).toBeNull();
    });

    it('el lector del paquete adjunta la procedencia de cada linea a sus posiciones', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdings-procedencia-'));
        fs.mkdirSync(path.join(dir, 'export_bdb'));
        fs.mkdirSync(path.join(dir, 'export'));
        const line = { isin: 'LU0000000404', parte: 1, total_partes: 1, fecha: '2026-09-30', procedencia: procedencia('completa'), posiciones: [{ nombre: 'A', peso_pct: 60 }, { nombre: 'B', peso_pct: 40 }] };
        fs.writeFileSync(path.join(dir, 'export', 'posiciones.ndjson'), JSON.stringify(line) + '\n', 'utf-8');
        const pkg = readCanonicalPackage({
            exportBdbDir: path.join(dir, 'export_bdb'),
            fondosNdjsonPath: path.join(dir, 'export', 'fondos.ndjson'),
            posicionesNdjsonPath: path.join(dir, 'export', 'posiciones.ndjson')
        });
        const recs = pkg.holdingsByFundIsin.get('LU0000000404')!;
        expect(recs).toHaveLength(2);
        expect(recs[0].procedencia?.fuente).toBe('morningstar_lt');
        expect(pkg.canonicalValidationIssues).toEqual([]);
    });
});

describe('regla de cobertura: una parcial mas nueva no pisa una completa reciente', () => {
    it('canonico top N mas nuevo frente a una viva completa de 2 meses antes: se conserva la viva', async () => {
        const db = new DbMock();
        seed(db, 'LU0000000411', 40, '2026-07-31');
        const plan = await planHoldingsRepublish(db as any, 'LU0000000411', records('LU0000000411', 10, '2026-09-30', procedencia('top_n')), NOW);
        expect(plan.expected_coverage).toBe('TOP_N');
        expect(plan.decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
        expect(plan.replace).toBe(false);
        expect((await executeHoldingsRepublish(db as any, plan)).sets_executed).toBe(0);
    });

    it('si la viva completa tiene mas de 183 dias, gana la parcial mas nueva', async () => {
        const db = new DbMock();
        seed(db, 'LU0000000412', 40, '2026-02-28');
        const plan = await planHoldingsRepublish(db as any, 'LU0000000412', records('LU0000000412', 10, '2026-09-30', procedencia('top_n')), NOW);
        expect(plan.decision).toBe('REPLACE_NEWER');
        expect(plan.motive).toContain('le saca 214 dias (> 183)');
    });

    it('un canonico completo mas nuevo sustituye aunque traiga menos posiciones', async () => {
        const db = new DbMock();
        seed(db, 'LU0000000413', 40, '2026-07-31');
        // 30 de 40 es menos del 80 %: sin procedencia lo conservaria el recuento, pero declarado
        // COMPLETE no es una cartera parcial sino una cartera que ha cambiado.
        const plan = await planHoldingsRepublish(db as any, 'LU0000000413', records('LU0000000413', 30, '2026-09-30', procedencia('completa')), NOW);
        expect(plan.decision).toBe('REPLACE_NEWER');
    });

    it('sin procedencia en el canonico, el recuento conserva la viva (menos del 80 %)', async () => {
        const db = new DbMock();
        seed(db, 'LU0000000414', 40, '2026-07-31');
        const plan = await planHoldingsRepublish(db as any, 'LU0000000414', records('LU0000000414', 10, '2026-09-30'), NOW);
        expect(plan.decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
        // con el 80 % o mas, la fecha
        const db2 = new DbMock();
        seed(db2, 'LU0000000416', 40, '2026-07-31');
        const plan2 = await planHoldingsRepublish(db2 as any, 'LU0000000416', records('LU0000000416', 32, '2026-09-30'), NOW);
        expect(plan2.decision).toBe('REPLACE_NEWER');
    });

    it('una viva de 10 o menos posiciones no cuenta como completa frente a un canonico declarado parcial', async () => {
        const db = new DbMock();
        seed(db, 'LU0000000415', 10, '2026-07-31');
        // 7 de 10 seria corto por recuento: lo que decide es que el canonico lo declara y la viva no pasa de 10
        const plan = await planHoldingsRepublish(db as any, 'LU0000000415', records('LU0000000415', 7, '2026-09-30', procedencia('parcial')), NOW);
        expect(plan.decision).toBe('REPLACE_NEWER');
        expect(plan.motive).toContain('la mas antigua no tiene mas de 10 posiciones');
    });
});
