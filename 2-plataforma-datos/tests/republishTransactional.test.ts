import * as admin from 'firebase-admin';
import { describe, expect, it } from 'vitest';
import { buildRootUpdatePayload, countHoldingsDecision, holdingsDecisionRow, HoldingsDecisionRow, mergeOwned, writeMergedRootWithPrecondition, writeMetricsWithPrecondition } from '../src/loader/republish';
import { buildHoldingsOperations } from '../src/loader/writer';
import {
    coverageFromHoldingsReview,
    daysBetween,
    decideHoldingsRepublish,
    executeHoldingsRepublish,
    HOLDINGS_COVERAGE_MAX_AGE_DAYS,
    isShortHoldings,
    normalizeHoldingsDate,
    planHoldingsRepublish
} from '../src/loader/holdingsRepublish';
import { assertNoUndefinedFirestoreValue, cloneFirestoreValue } from './helpers/strictFirestoreValue';

function clone<T>(value: T): T {
    return cloneFirestoreValue(value);
}

class HoldingsDbMock {
    readonly documents = new Map<string, Record<string, any>>();
    readonly sets: string[] = [];
    readonly deletes: string[] = [];

    doc(path: string) {
        return {
            path,
            get: async () => {
                const value = this.documents.get(path);
                return { exists: value !== undefined, data: () => value ? clone(value) : undefined };
            },
            set: async (payload: Record<string, any>) => {
                assertNoUndefinedFirestoreValue(payload);
                this.documents.set(path, clone(payload));
                this.sets.push(path);
            },
            delete: async () => {
                this.documents.delete(path);
                this.deletes.push(path);
            }
        };
    }

    batch() {
        const operations: Array<{ kind: 'set' | 'delete'; path: string; payload?: Record<string, any> }> = [];
        return {
            set: (ref: { path: string }, payload: Record<string, any>) => {
                assertNoUndefinedFirestoreValue(payload);
                operations.push({ kind: 'set', path: ref.path, payload: clone(payload) });
            },
            delete: (ref: { path: string }) => operations.push({ kind: 'delete', path: ref.path }),
            commit: async () => {
                for (const operation of operations) {
                    if (operation.kind === 'set') {
                        this.documents.set(operation.path, clone(operation.payload!));
                        this.sets.push(operation.path);
                    } else {
                        this.documents.delete(operation.path);
                        this.deletes.push(operation.path);
                    }
                }
            }
        };
    }

    collection(path: string) {
        return {
            get: async () => {
                const prefix = `${path}/`;
                const docs = [...this.documents.entries()]
                    .filter(([documentPath]) => documentPath.startsWith(prefix) && !documentPath.slice(prefix.length).includes('/'))
                    .map(([documentPath, payload]) => ({
                        id: documentPath.slice(prefix.length),
                        ref: { path: documentPath },
                        data: () => clone(payload)
                    }));
                return { docs };
            }
        };
    }
}

function holdingRecords(assetId: string, count: number, namePadding = 0, asOfDate: string | null = '2026-06-30') {
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
        sector: 'Technology',
        country: 'ES',
        source_metadata: { source: 'FondosDB', file: 'export/posiciones.ndjson' }
    })) as any[];
}

function seedOperations(db: HoldingsDbMock, operations: ReturnType<typeof buildHoldingsOperations>) {
    for (const operation of operations) db.documents.set(operation.path, clone(operation.payload));
}

function validStockRoot() {
    return {
        asset_id: 'US0378331005',
        asset_type: 'STOCK',
        schema_version: 'master.asset-stock.v1',
        updated_at: '2026-07-02T12:00:00.000Z',
        identity: { name: 'Apple Inc.', currency: 'USD' },
        identifiers: { isin: 'US0378331005', ticker: 'AAPL', eodhd_code: 'AAPL.US', aliases: ['US0378331005', 'AAPL', 'AAPL.US'] },
        classification: { asset_class: 'EQUITY', fondosdb_asset_class: 'EQUITY', fondosdb_asset_type: 'stock', asset_subtype: 'common_stock', region_primary: 'US', strategy_tags: [], confidence: 1 },
        product: { product_type: 'stock', commercial_type: 'accion', vehicle_complexity: 'standard', has_listing: true },
        listings: [{
            listing_id: 'EODHD:AAPL.US',
            ticker: 'AAPL',
            exchange: 'US',
            currency: 'USD',
            eodhd_code: 'AAPL.US',
            source_listing_id: 'EODHD:AAPL.US',
            is_primary: true,
            data_sources: ['fondosdb', 'eodhd']
        }],
        performance: null,
        risk: null,
        fundamentals: null,
        portfolio_exposure: null,
        quality: { fondosdb_bucket: 'COMPLETO', fondosdb_ok: true, warnings: [], validation_errors: [], review_flags: [], history_trace: null },
        source_metadata: { source: 'FondosDB', source_file: 'export_bdb/US0378331005.json', generated_at: '2026-07-02T12:00:00.000Z', report_date: '2026-07-02', universal_export_present: true, source_history: 'eodhd', source_listing_id: 'EODHD:AAPL.US', firestore_import_block: 'test' }
    };
}

describe('republish transactional root writes', () => {
    it('limpia campos raiz legacy no contractuales en fondos', () => {
        const expected = {
            asset_id: 'IE00B4L5Y983',
            asset_type: 'ETF',
            identity: { name: 'iShares Core MSCI World UCITS ETF', currency: 'USD' },
            identifiers: { isin: 'IE00B4L5Y983', ticker: 'IWDA' },
            listings: [{ listing_id: 'TICKER:IWDA', ticker: 'IWDA', currency: 'USD' }],
            classification: { asset_class: 'RV' },
            product: { product_type: 'ETF', has_listing: true },
            costs: {},
            performance: null,
            risk: null,
            sustainability: null,
            portfolio_exposure: null,
            fixed_income_profile: null,
            quality: { warnings: [], validation_errors: [], review_flags: [], status: 'ACCEPTED' },
            source_metadata: { source: 'FondosDB', source_file: 'export_bdb/IE00B4L5Y983.json', universal_export_present: true, firestore_preview_only: true }
        };
        const live = { ...expected, currency: 'USD', source_mode: 'legacy' };

        const finalDoc = mergeOwned(live, expected, false, '2026-07-02T12:00:00.000Z');
        const payload = buildRootUpdatePayload(live, finalDoc) as Record<string, unknown>;

        expect(finalDoc.currency).toBeUndefined();
        expect(finalDoc.source_mode).toBeUndefined();
        expect(payload.currency).toBeDefined();
        expect(payload.source_mode).toBeDefined();
    });

    it('passes snapshot updateTime as lastUpdateTime precondition', async () => {
        const updateTime = admin.firestore.Timestamp.fromMillis(1000);
        let receivedPrecondition: admin.firestore.Precondition | undefined;
        const ref = {
            update: async (_data: admin.firestore.UpdateData<Record<string, unknown>>, precondition: admin.firestore.Precondition) => {
                receivedPrecondition = precondition;
            }
        };

        await writeMergedRootWithPrecondition(ref, { updateTime } as any, validStockRoot(), true);

        expect(receivedPrecondition).toEqual({ lastUpdateTime: updateTime });
    });

    it('fails cleanly when Firestore reports a concurrent update', async () => {
        const updateTime = admin.firestore.Timestamp.fromMillis(1000);
        const ref = {
            update: async () => {
                const err: any = new Error('FAILED_PRECONDITION: last update time changed');
                err.code = 9;
                throw err;
            }
        };

        await expect(
            writeMergedRootWithPrecondition(ref as any, { updateTime } as any, validStockRoot(), true)
        ).rejects.toThrow('REPUBLISH_CONCURRENT_MODIFICATION');
    });
});

describe('republish transactional metrics writes', () => {
    const validMetrics = {
        asset_id: 'US0378331005',
        population: 'stock',
        source: 'FONDOSDB_ROOT_ES',
        windows: {},
        risk_score_source: 'VOL_BUCKET',
        updated_at: '2026-07-12T00:00:00.000Z'
    };

    it('uses the snapshot precondition for metrics/latest', async () => {
        const updateTime = admin.firestore.Timestamp.fromMillis(2000);
        let receivedPrecondition: admin.firestore.Precondition | undefined;
        const ref = {
            update: async (_data: unknown, precondition: admin.firestore.Precondition) => {
                receivedPrecondition = precondition;
            },
            create: async () => undefined
        };

        await writeMetricsWithPrecondition(ref, { exists: true, updateTime } as any, validMetrics);

        expect(receivedPrecondition).toEqual({ lastUpdateTime: updateTime });
    });

    it('reports a concurrent metrics update instead of overwriting it', async () => {
        const error: any = new Error('FAILED_PRECONDITION');
        error.code = 9;
        const ref = {
            update: async () => { throw error; },
            create: async () => undefined
        };

        await expect(writeMetricsWithPrecondition(
            ref,
            { exists: true, updateTime: admin.firestore.Timestamp.fromMillis(2000) } as any,
            validMetrics
        )).rejects.toThrow('REPUBLISH_CONCURRENT_MODIFICATION');
    });
});

describe('republish holdings refresh', () => {
    it('rechaza undefined recursivo con la ruta del campo como el SDK real', async () => {
        const db = new HoldingsDbMock();

        await expect(db.doc('assets/LU0000000000/holdings/latest').set({
            holdings: [{ identifiers: { ticker: undefined } }]
        })).rejects.toThrow(
            'Cannot use undefined as a Firestore value at $.holdings[0].identifiers.ticker'
        );
    });

    it('genera operaciones de holdings sin valores undefined', () => {
        const operations = buildHoldingsOperations(
            'LU0000000000',
            [{ ...holdingRecords('LU0000000000', 1)[0], identifiers: { isin: null } }] as any,
            '2026-07-11T00:00:00.000Z'
        );

        expect(() => operations.forEach((operation) => {
            assertNoUndefinedFirestoreValue(operation.payload);
        })).not.toThrow();
    });

    it('no escribe cuando fecha, contenido y layout no cambian', async () => {
        const assetId = 'LU0000000001';
        const records = holdingRecords(assetId, 4);
        const db = new HoldingsDbMock();
        seedOperations(db, buildHoldingsOperations(assetId, records, '2026-07-01T00:00:00.000Z'));

        const plan = await planHoldingsRepublish(
            db as any,
            assetId,
            records,
            '2026-07-11T00:00:00.000Z'
        );
        const result = await executeHoldingsRepublish(db as any, plan);

        expect(plan.stale).toBe(false);
        expect(result).toEqual({ sets_executed: 0, deletes_executed: 0, postverify_ok: true });
        expect(db.sets).toEqual([]);
        expect(db.deletes).toEqual([]);
    });

    it('reescribe contenido cambiado y poda chunks sobrantes', async () => {
        const assetId = 'LU0000000002';
        const records = holdingRecords(assetId, 2500, 280);
        const db = new HoldingsDbMock();
        // La viva es anterior al canonico: con la regla «gana la mas reciente» se sustituye.
        const previous = buildHoldingsOperations(assetId, holdingRecords(assetId, 2500, 280, '2026-05-31'), '2026-06-01T00:00:00.000Z');
        expect(previous[0].path).toBe(`assets/${assetId}/holdings/manifest`);
        seedOperations(db, previous);
        const extraPath = `assets/${assetId}/holdings/manifest/chunks/chunk_9999`;
        db.documents.set(extraPath, {
            storage_mode: 'CHUNK',
            chunk_index: 9999,
            holdings_count: 1,
            holdings: [{ ...records[0], holding_id: `${assetId}:EXTRA:1` }],
            schema_version: 'master.holdings.v1.1',
            updated_at: '2026-07-01T00:00:00.000Z'
        });

        const plan = await planHoldingsRepublish(db as any, assetId, records, '2026-07-11T00:00:00.000Z');
        const result = await executeHoldingsRepublish(db as any, plan);

        expect(plan.stale).toBe(true);
        expect(plan.reasons).toContain('content_hash');
        expect(plan.delete_paths).toContain(extraPath);
        expect(result.deletes_executed).toBe(1);
        expect(db.deletes).toContain(extraPath);
        expect(db.documents.has(extraPath)).toBe(false);
    });

    it('migra CHUNKED a latest y elimina manifest y chunks', async () => {
        const assetId = 'LU0000000003';
        const db = new HoldingsDbMock();
        // El canonico (5) es corto frente a la viva (2500): solo sustituye porque la viva tiene mas de
        // 183 dias mas (regla de cobertura, D3).
        seedOperations(db, buildHoldingsOperations(
            assetId,
            holdingRecords(assetId, 2500, 280, '2025-12-01'),
            '2026-06-01T00:00:00.000Z'
        ));
        const currentPaths = [...db.documents.keys()];
        expect(currentPaths.some((documentPath) => documentPath.endsWith('/holdings/manifest'))).toBe(true);

        const plan = await planHoldingsRepublish(
            db as any,
            assetId,
            holdingRecords(assetId, 5, 0, '2026-06-30'),
            '2026-07-11T00:00:00.000Z'
        );
        const result = await executeHoldingsRepublish(db as any, plan);

        expect(plan.expected_mode).toBe('SINGLE_DOCUMENT');
        expect(plan.live_mode).toBe('CHUNKED');
        expect(result.postverify_ok).toBe(true);
        expect(db.documents.has(`assets/${assetId}/holdings/latest`)).toBe(true);
        expect([...db.documents.keys()].some((documentPath) => documentPath.includes('/holdings/manifest'))).toBe(false);
    });

    it('migra latest a CHUNKED y elimina latest', async () => {
        const assetId = 'LU0000000004';
        const db = new HoldingsDbMock();
        seedOperations(db, buildHoldingsOperations(
            assetId,
            holdingRecords(assetId, 5, 0, '2026-05-31'),
            '2026-06-01T00:00:00.000Z'
        ));

        const plan = await planHoldingsRepublish(
            db as any,
            assetId,
            holdingRecords(assetId, 2500, 280, '2026-06-30'),
            '2026-07-11T00:00:00.000Z'
        );
        const result = await executeHoldingsRepublish(db as any, plan);

        expect(plan.expected_mode).toBe('CHUNKED');
        expect(plan.live_mode).toBe('SINGLE_DOCUMENT');
        expect(plan.delete_paths).toContain(`assets/${assetId}/holdings/latest`);
        expect(result.postverify_ok).toBe(true);
        expect(db.documents.has(`assets/${assetId}/holdings/latest`)).toBe(false);
        expect(db.documents.has(`assets/${assetId}/holdings/manifest`)).toBe(true);
        expect([...db.documents.keys()].some((documentPath) => documentPath.includes('/manifest/chunks/'))).toBe(true);
    });

    it('no deja escrituras parciales si falla el commit de holdings', async () => {
        const assetId = 'LU0000000005';
        const db = new HoldingsDbMock();
        seedOperations(db, buildHoldingsOperations(
            assetId,
            holdingRecords(assetId, 4, 0, '2026-05-31'),
            '2026-06-01T00:00:00.000Z'
        ));
        const before = clone([...db.documents.entries()]);
        const plan = await planHoldingsRepublish(
            db as any,
            assetId,
            holdingRecords(assetId, 5, 0, '2026-06-30'),
            '2026-07-11T00:00:00.000Z'
        );
        (db as any).batch = () => ({
            set: () => undefined,
            delete: () => undefined,
            commit: async () => { throw new Error('simulated commit failure'); }
        });

        await expect(executeHoldingsRepublish(db as any, plan)).rejects.toThrow('simulated commit failure');
        expect([...db.documents.entries()]).toEqual(before);
    });
});

describe('republish de carteras: gana la mas reciente', () => {
    const NOW = '2026-10-14T00:00:00.000Z';

    function seedLive(db: HoldingsDbMock, assetId: string, count: number, asOfDate: string | null) {
        seedOperations(db, buildHoldingsOperations(assetId, holdingRecords(assetId, count, 0, asOfDate), '2026-09-28T00:00:00.000Z'));
        return clone([...db.documents.entries()]);
    }

    async function planAndRun(db: HoldingsDbMock, assetId: string, count: number, asOfDate: string | null) {
        const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, count, 0, asOfDate), NOW);
        const result = await executeHoldingsRepublish(db as any, plan);
        return { plan, result };
    }

    it('sustituye cuando la cartera del canonico es mas reciente', async () => {
        const assetId = 'LU0000000101';
        const db = new HoldingsDbMock();
        seedLive(db, assetId, 10, '2026-06-30');

        const { plan, result } = await planAndRun(db, assetId, 10, '2026-08-31');

        expect(plan.decision).toBe('REPLACE_NEWER');
        expect(plan.replace).toBe(true);
        expect(result.sets_executed).toBe(1);
        expect(db.documents.get(`assets/${assetId}/holdings/latest`)?.as_of_date).toBe('2026-08-31');
    });

    it('sustituye aunque el canonico mas reciente traiga menos posiciones, si no es corto', async () => {
        const assetId = 'LU0000000102';
        const db = new HoldingsDbMock();
        seedLive(db, assetId, 40, '2026-06-30');

        const { plan } = await planAndRun(db, assetId, 32, '2026-08-31');

        expect(plan.decision).toBe('REPLACE_NEWER');
        expect(db.documents.get(`assets/${assetId}/holdings/latest`)?.holdings_count).toBe(32);
    });

    it('conserva la viva cuando es mas reciente que el canonico', async () => {
        const assetId = 'LU0000000103';
        const db = new HoldingsDbMock();
        const before = seedLive(db, assetId, 10, '2026-08-31');

        const { plan, result } = await planAndRun(db, assetId, 12, '2026-06-30');

        expect(plan.stale).toBe(true);
        expect(plan.decision).toBe('KEEP_NEWER_LIVE');
        expect(plan.replace).toBe(false);
        expect(plan.set_operations).toEqual([]);
        expect(plan.delete_paths).toEqual([]);
        expect(result).toEqual({ sets_executed: 0, deletes_executed: 0, postverify_ok: true });
        expect(db.sets).toEqual([]);
        expect([...db.documents.entries()]).toEqual(before);
    });

    it('conserva una viva mas reciente con la forma de la pasada del 28-09 (holdings.v1.1)', async () => {
        const assetId = 'LU0000000104';
        const db = new HoldingsDbMock();
        db.documents.set(`assets/${assetId}/holdings/latest`, {
            storage_mode: 'SINGLE_DOCUMENT',
            as_of_date: '2026-08-31',
            holdings_count: 2,
            top10_weight: 9.5,
            schema_version: 'holdings.v1.1',
            updated_at: '2026-09-28T07:55:00.000Z',
            holdings: [
                { holding_id: 'h1', holding_name: 'Microsoft Corp', holding_weight: 5.5, holding_weight_unit: 'percent', source: 'factsheet' },
                { holding_id: 'h2', holding_name: 'Apple Inc', holding_weight: 4, holding_weight_unit: 'percent', source: 'factsheet' }
            ]
        });
        const before = clone([...db.documents.entries()]);

        const { plan } = await planAndRun(db, assetId, 2, '2026-06-30');

        expect(plan.decision).toBe('KEEP_NEWER_LIVE');
        expect(db.sets).toEqual([]);
        expect([...db.documents.entries()]).toEqual(before);
    });

    it('sustituye con la misma fecha si el canonico es mas completo', async () => {
        const assetId = 'LU0000000105';
        const db = new HoldingsDbMock();
        seedLive(db, assetId, 10, '2026-08-31');

        const { plan, result } = await planAndRun(db, assetId, 40, '2026-08-31');

        expect(plan.decision).toBe('REPLACE_MORE_COMPLETE');
        expect(result.postverify_ok).toBe(true);
        expect(db.documents.get(`assets/${assetId}/holdings/latest`)?.holdings_count).toBe(40);
    });

    it('conserva con la misma fecha si el canonico es menos completo', async () => {
        const assetId = 'LU0000000106';
        const db = new HoldingsDbMock();
        const before = seedLive(db, assetId, 40, '2026-08-31');

        const { plan } = await planAndRun(db, assetId, 10, '2026-08-31');

        expect(plan.decision).toBe('KEEP_MORE_COMPLETE');
        expect(plan.replace).toBe(false);
        expect([...db.documents.entries()]).toEqual(before);
    });

    it('conserva con la misma fecha y las mismas posiciones si el contenido difiere', async () => {
        const assetId = 'LU0000000107';
        const db = new HoldingsDbMock();
        const before = seedLive(db, assetId, 10, '2026-08-31');
        const records = holdingRecords(assetId, 10, 0, '2026-08-31').map((record, index) => (
            index === 0 ? { ...record, name: 'Otra posicion' } : record
        ));

        const plan = await planHoldingsRepublish(db as any, assetId, records, NOW);
        await executeHoldingsRepublish(db as any, plan);

        expect(plan.reasons).toContain('content_hash');
        expect(plan.decision).toBe('KEEP_SAME_DATE_TIE');
        expect([...db.documents.entries()]).toEqual(before);
    });

    it('repara la forma de guardarla si fecha y contenido coinciden', async () => {
        const assetId = 'LU0000000108';
        const db = new HoldingsDbMock();
        seedLive(db, assetId, 10, '2026-08-31');
        const latestPath = `assets/${assetId}/holdings/latest`;
        db.documents.set(latestPath, { ...db.documents.get(latestPath)!, holdings_count: 12 });

        const { plan, result } = await planAndRun(db, assetId, 10, '2026-08-31');

        expect(plan.reasons).toEqual(['holdings_count']);
        expect(plan.decision).toBe('REPAIR_LAYOUT');
        expect(result.postverify_ok).toBe(true);
        expect(db.documents.get(latestPath)?.holdings_count).toBe(10);
    });

    it('crea la cartera si no hay viva', async () => {
        const assetId = 'LU0000000109';
        const db = new HoldingsDbMock();

        const { plan, result } = await planAndRun(db, assetId, 10, null);

        expect(plan.decision).toBe('CREATE');
        expect(result.sets_executed).toBe(1);
    });

    it('conserva y avisa si la viva no tiene fecha', async () => {
        const assetId = 'LU0000000110';
        const db = new HoldingsDbMock();
        const before = seedLive(db, assetId, 10, null);

        const { plan } = await planAndRun(db, assetId, 40, '2026-08-31');

        expect(plan.decision).toBe('KEEP_UNDATED');
        expect(plan.replace).toBe(false);
        expect(plan.warning).toMatch(/^HOLDINGS_UNDATED: sin fecha valida en viva /);
        expect([...db.documents.entries()]).toEqual(before);
    });

    it('conserva y avisa si el canonico no tiene fecha', async () => {
        const assetId = 'LU0000000111';
        const db = new HoldingsDbMock();
        const before = seedLive(db, assetId, 10, '2026-06-30');

        const { plan } = await planAndRun(db, assetId, 40, null);

        expect(plan.decision).toBe('KEEP_UNDATED');
        expect(plan.warning).toMatch(/^HOLDINGS_UNDATED: sin fecha valida en canonico /);
        expect([...db.documents.entries()]).toEqual(before);
    });

    it('no escribe si la viva cambia entre el plan y la escritura', async () => {
        const assetId = 'LU0000000112';
        const db = new HoldingsDbMock();
        seedLive(db, assetId, 10, '2026-06-30');
        const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, 10, 0, '2026-08-31'), NOW);
        expect(plan.decision).toBe('REPLACE_NEWER');
        // Otro proceso escribe una cartera aun mas reciente despues del plan.
        seedOperations(db, buildHoldingsOperations(assetId, holdingRecords(assetId, 12, 0, '2026-09-30'), NOW));
        const before = clone([...db.documents.entries()]);

        await expect(executeHoldingsRepublish(db as any, plan)).rejects.toThrow('HOLDINGS_CONCURRENT_MODIFICATION');
        expect([...db.documents.entries()]).toEqual(before);
    });

    it('rechaza un plan que pide escribir con una decision de conservar', async () => {
        const assetId = 'LU0000000113';
        const db = new HoldingsDbMock();
        seedLive(db, assetId, 10, '2026-08-31');
        const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, 10, 0, '2026-06-30'), NOW);
        expect(plan.decision).toBe('KEEP_NEWER_LIVE');

        await expect(executeHoldingsRepublish(db as any, { ...plan, replace: true })).rejects.toThrow('HOLDINGS_REGRESSION_BLOCKED');
        expect(db.sets).toEqual([]);
    });

    it('cuenta en el resumen las sustituidas y las conservadas por motivo', async () => {
        const db = new HoldingsDbMock();
        const cases: Array<[string, number, string | null, number, string | null]> = [
            ['LU0000000121', 10, '2026-06-30', 10, '2026-08-31'], // REPLACE_NEWER
            ['LU0000000122', 40, '2026-06-30', 32, '2026-08-31'], // REPLACE_NEWER con menos posiciones (80 %: no es corto)
            ['LU0000000123', 10, '2026-08-31', 12, '2026-06-30'], // KEEP_NEWER_LIVE
            ['LU0000000124', 40, '2026-08-31', 10, '2026-08-31'], // KEEP_MORE_COMPLETE
            ['LU0000000125', 10, null, 10, '2026-08-31'], // KEEP_UNDATED
            ['LU0000000126', 40, '2026-06-30', 10, '2026-08-31'], // KEEP_COMPLETE_OLDER_LIVE (recuento, conserva)
            ['LU0000000127', 10, '2026-08-31', 40, '2026-06-30'], // REPLACE_COMPLETE_OLDER: viva declarada parcial
            ['LU0000000128', 40, '2025-12-31', 10, '2026-08-31'], // REPLACE_NEWER corto: la viva tiene 243 dias mas
            ['LU0000000129', 10, '2026-08-31', 40, '2026-06-30'] // KEEP_NEWER_LIVE: corta sin declarar, el recuento no retrocede
        ];
        const summary = {
            holdings_to_replace: 0,
            holdings_to_set: 0,
            holdings_to_delete: 0,
            holdings_kept_newer_live: 0,
            holdings_kept_complete_older_live: 0,
            holdings_kept_more_complete: 0,
            holdings_kept_same_date_tie: 0,
            holdings_kept_undated: 0,
            holdings_by_decision: {} as Record<string, number>,
            holdings_replace_complete_older: 0,
            holdings_replace_newer_but_shorter: 0,
            holdings_replace_newer_short: 0
        };
        const rows: HoldingsDecisionRow[] = [];
        for (const [assetId, liveCount, liveDate, canonicalCount, canonicalDate] of cases) {
            seedLive(db, assetId, liveCount, liveDate);
            if (assetId === 'LU0000000127') {
                // revision de la pasada del 28-09 que describe esta misma viva: parcial
                db.documents.set(`assets/${assetId}/fund_profile/latest`, {
                    holdings_review: { as_of_date: liveDate, available_positions: liveCount, full_holdings_loaded: false, review_flags: ['CARTERA_PUBLICADA_PARCIAL'] }
                });
            }
            const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, canonicalCount, 0, canonicalDate), NOW);
            countHoldingsDecision(summary, plan);
            rows.push(holdingsDecisionRow(plan));
        }

        expect(summary).toEqual({
            holdings_to_replace: 4,
            holdings_to_set: 4,
            holdings_to_delete: 0,
            holdings_kept_newer_live: 2,
            holdings_kept_complete_older_live: 1,
            holdings_kept_more_complete: 1,
            holdings_kept_same_date_tie: 0,
            holdings_kept_undated: 1,
            holdings_by_decision: {
                REPLACE_NEWER: 3,
                REPLACE_COMPLETE_OLDER: 1,
                KEEP_NEWER_LIVE: 2,
                KEEP_COMPLETE_OLDER_LIVE: 1,
                KEEP_MORE_COMPLETE: 1,
                KEEP_UNDATED: 1
            },
            holdings_replace_complete_older: 1,
            holdings_replace_newer_but_shorter: 2,
            holdings_replace_newer_short: 1
        });
        // holdings_replaced.json y holdings_kept.json llevan el motivo y la cobertura de cada decision.
        const row = (assetId: string) => rows.find((item) => item.asset_id === assetId)!;
        expect(row('LU0000000126').motive).toBe('se conserva la viva: la mas reciente no declara cobertura y tiene menos del 80 % de las posiciones; 62 dias (<= 183); canonico 10 posiciones a 2026-08-31 (UNKNOWN), viva 40 a 2026-06-30 (UNKNOWN)');
        expect(row('LU0000000127').motive).toBe('gana el canonico, mas completo: la mas reciente declara PARTIAL y la mas antigua tiene mas posiciones; 62 dias (<= 183); canonico 40 posiciones a 2026-06-30 (UNKNOWN), viva 10 a 2026-08-31 (PARTIAL)');
        expect(row('LU0000000127')).toMatchObject({ live_coverage: 'PARTIAL', live_coverage_source: 'holdings_review', expected_coverage: 'UNKNOWN' });
        expect(row('LU0000000128').motive).toMatch(/^gana el canonico, mas reciente: le saca 243 dias \(> 183\)/);
        expect(row('LU0000000129').motive).toMatch(/^se conserva la viva, mas reciente: no esta declarada parcial: el recuento no basta para retroceder/);
        expect(row('LU0000000125').motive).toBe('sin fecha valida en viva: no se compara');
        expect(rows.every((item) => item.motive.length > 0)).toBe(true);
    });

    it('normaliza la fecha de la cartera', () => {
        expect(normalizeHoldingsDate('2026-08-31')).toBe('2026-08-31');
        expect(normalizeHoldingsDate('2026-08-31T00:00:00.000Z')).toBe('2026-08-31');
        expect(normalizeHoldingsDate('2026-08')).toBeNull();
        expect(normalizeHoldingsDate('31/08/2026')).toBeNull();
        expect(normalizeHoldingsDate('')).toBeNull();
        expect(normalizeHoldingsDate(null)).toBeNull();
    });
});

describe('republish de carteras: regla unificada de cobertura', () => {
    const NOW = '2026-10-14T00:00:00.000Z';
    type Coverage = 'COMPLETE' | 'TOP_N' | 'PARTIAL' | 'UNKNOWN';

    function addDays(date: string, days: number): string {
        return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    }

    function tree(holdings_count: number, as_of_date: string | null, coverage: Coverage = 'UNKNOWN', declared: number | null = null) {
        return { mode: 'SINGLE_DOCUMENT' as const, as_of_date, content_hash: `h-${holdings_count}-${as_of_date}`, holdings_count, coverage, declared_holdings_count: declared };
    }

    /** [posiciones, fecha, cobertura declarada, posiciones declaradas] */
    type Side = [number, string | null, Coverage?, number?];
    function decide(canonical: Side, live: Side) {
        return decideHoldingsRepublish(tree(canonical[0], canonical[1], canonical[2], canonical[3] ?? null), tree(live[0], live[1], live[2], live[3] ?? null), true);
    }

    const COBERTURA: Record<Coverage, string> = { COMPLETE: 'completa', TOP_N: 'top_n', PARTIAL: 'parcial', UNKNOWN: 'desconocida' };
    function withProcedencia(records: any[], coverage: Coverage, declared: number = records.length) {
        const procedencia = {
            fuente: 'morningstar_lt', endpoint: 'sal_position', id_fuente: 'F0000TEST', url: null,
            obtenido: '2026-10-14T05:00:00+00:00', sha256_respuesta: 'ab'.repeat(32), fecha_de: 'detalle_posiciones',
            cobertura: COBERTURA[coverage], posiciones_declaradas: declared, supresion_proveedor: coverage !== 'COMPLETE', run_id: null
        };
        return records.map((record) => ({ ...record, procedencia }));
    }

    function seedLive(db: HoldingsDbMock, assetId: string, count: number, asOfDate: string, options: { provenance?: Coverage; reviewFull?: boolean } = {}) {
        const records = holdingRecords(assetId, count, 0, asOfDate);
        seedOperations(db, buildHoldingsOperations(assetId, options.provenance ? withProcedencia(records, options.provenance) : records, '2026-09-28T00:00:00.000Z'));
        if (options.reviewFull !== undefined) {
            // fund_profile/latest.holdings_review de la pasada del 28-09, describiendo esta misma viva
            db.documents.set(`assets/${assetId}/fund_profile/latest`, {
                holdings_review: options.reviewFull
                    ? { as_of_date: asOfDate, available_positions: count, full_holdings_loaded: true, run_id: 'fund-quality-phase2-2026-09-28' }
                    : { as_of_date: asOfDate, available_positions: count, full_holdings_loaded: false, review_flags: ['CARTERA_PUBLICADA_PARCIAL'], run_id: 'carteras-prioritarias-2026-09-28' }
            });
        }
        return clone([...db.documents.entries()]);
    }

    it('corta es menos del 80 % de las posiciones de la otra; el 80 % exacto no es corto', () => {
        expect(isShortHoldings(7, 10)).toBe(true);
        expect(isShortHoldings(8, 10)).toBe(false);
        expect(isShortHoldings(79, 100)).toBe(true);
        expect(isShortHoldings(80, 100)).toBe(false);
        expect(isShortHoldings(27, 35)).toBe(true); // 77,1 %
        expect(isShortHoldings(28, 35)).toBe(false); // 80 % exacto, sin error de coma flotante
        expect(HOLDINGS_COVERAGE_MAX_AGE_DAYS).toBe(183);
    });

    describe('B1: el recuento nunca hace retroceder una viva', () => {
        // Las tres vivas completas de la fase 2 (28-09) con pocas posiciones, como casos sinteticos.
        const fase2: Array<[string, number, string, number, string, number]> = [
            ['ES0116419005', 7, '2026-08-31', 20, '2026-03-31', 153],
            ['LU2278574715', 57, '2026-08-31', 72, '2026-05-31', 92],
            ['LU2337806421', 29, '2026-06-30', 38, '2026-03-31', 91]
        ];

        it.each(fase2)('%s: viva completa (holdings_review) de %i posiciones no vuelve al canonico mas antiguo', async (assetId, liveCount, liveDate, canonicalCount, canonicalDate, days) => {
            // dentro de los 183 dias: lo que la salva es que esta completa, no la fecha
            expect(daysBetween(canonicalDate, liveDate)).toBe(days);
            const db = new HoldingsDbMock();
            const before = seedLive(db, assetId, liveCount, liveDate, { reviewFull: true });
            const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, canonicalCount, 0, canonicalDate), NOW);
            const result = await executeHoldingsRepublish(db as any, plan);
            expect(plan.decision).toBe('KEEP_NEWER_LIVE');
            expect(plan.live_coverage).toBe('COMPLETE');
            expect(plan.live_coverage_source).toBe('holdings_review');
            expect(plan.motive).toContain('la mas reciente declara COMPLETE');
            expect(plan.motive).toContain(`canonico ${canonicalCount} posiciones a ${canonicalDate}`);
            expect(result.sets_executed).toBe(0);
            expect([...db.documents.entries()]).toEqual(before);
        });

        it.each(fase2)('%s: sin revision ni procedencia tampoco retrocede (el recuento solo conserva)', async (assetId, liveCount, liveDate, canonicalCount, canonicalDate) => {
            const db = new HoldingsDbMock();
            seedLive(db, assetId, liveCount, liveDate);
            const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, canonicalCount, 0, canonicalDate), NOW);
            expect(plan.live_coverage).toBe('UNKNOWN');
            expect(plan.decision).toBe('KEEP_NEWER_LIVE');
        });

        it('un canonico PARTIAL mas antiguo no sustituye a una viva mas reciente, aunque esta sea parcial', () => {
            expect(decide([40, '2026-06-30', 'PARTIAL'], [10, '2026-08-31', 'PARTIAL']).decision).toBe('KEEP_NEWER_LIVE');
            expect(decide([40, '2026-06-30', 'PARTIAL'], [10, '2026-08-31']).decision).toBe('KEEP_NEWER_LIVE');
        });

        it('un TOP_N de 10 no sustituye a una viva de 7', () => {
            expect(decide([10, '2026-06-30', 'TOP_N'], [7, '2026-08-31', 'PARTIAL']).decision).toBe('KEEP_NEWER_LIVE');
            expect(decide([10, '2026-06-30', 'TOP_N'], [7, '2026-08-31']).decision).toBe('KEEP_NEWER_LIVE');
        });
    });

    describe('b) viva mas reciente declarada parcial: gana el canonico mas completo', () => {
        it('informe semestral (Robeco LU0187079347: viva de 45 a 30-06, canonico de 386 a 31-05)', async () => {
            const assetId = 'LU0187079347';
            const db = new HoldingsDbMock();
            seedLive(db, assetId, 45, '2026-06-30', { reviewFull: false });
            const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, 386, 0, '2026-05-31'), NOW);
            const result = await executeHoldingsRepublish(db as any, plan);
            expect(plan.decision).toBe('REPLACE_COMPLETE_OLDER');
            expect(plan.live_coverage).toEqual('PARTIAL');
            expect(result.postverify_ok).toBe(true);
            const head = db.documents.get(`assets/${assetId}/holdings/latest`) ?? db.documents.get(`assets/${assetId}/holdings/manifest`);
            expect(head?.as_of_date).toBe('2026-05-31');
            expect(head?.holdings_count).toBe(386);
        });

        it('simetria: una viva PARTIAL de 1.269 sobre 1.270 declaradas no retrocede ante un COMPLETE mas antiguo', async () => {
            const assetId = 'LU0000000306';
            const db = new HoldingsDbMock();
            const live = withProcedencia(holdingRecords(assetId, 1269, 0, '2026-10-13'), 'PARTIAL', 1270);
            seedOperations(db, buildHoldingsOperations(assetId, live, '2026-10-14T00:00:00.000Z'));
            const before = clone([...db.documents.entries()]);
            const plan = await planHoldingsRepublish(db as any, assetId, withProcedencia(holdingRecords(assetId, 1305, 0, '2026-07-09'), 'COMPLETE'), NOW);
            expect(plan.live_coverage).toBe('PARTIAL');
            expect(plan.decision).toBe('KEEP_NEWER_LIVE');
            expect(plan.motive).toContain('de las 1270 que declara');
            expect((await executeHoldingsRepublish(db as any, plan)).sets_executed).toBe(0);
            expect([...db.documents.entries()]).toEqual(before);
            // la misma viva con 900 de 1.270 declaradas si es parcial y cede
            expect(decide([1305, '2026-07-09', 'COMPLETE'], [900, '2026-10-13', 'PARTIAL', 1270]).decision).toBe('REPLACE_COMPLETE_OLDER');
            // sin declaradas, se mide contra el canonico: 1.269 de 1.305 no cede
            expect(decide([1305, '2026-07-09', 'COMPLETE'], [1269, '2026-10-13', 'PARTIAL']).decision).toBe('KEEP_NEWER_LIVE');
        });

        it('la parcialidad puede venir de la provenance de la viva', async () => {
            const assetId = 'LU0000000301';
            const db = new HoldingsDbMock();
            seedLive(db, assetId, 10, '2026-08-31', { provenance: 'TOP_N' });
            const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, 40, 0, '2026-06-30'), NOW);
            expect(plan.live_coverage_source).toBe('provenance');
            expect(plan.decision).toBe('REPLACE_COMPLETE_OLDER');
        });

        it('la provenance de la viva manda sobre la revision del 28-09', async () => {
            const assetId = 'LU0000000302';
            const db = new HoldingsDbMock();
            seedLive(db, assetId, 10, '2026-08-31', { provenance: 'COMPLETE', reviewFull: false });
            const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, 40, 0, '2026-06-30'), NOW);
            expect(plan.live_coverage).toBe('COMPLETE');
            expect(plan.decision).toBe('KEEP_NEWER_LIVE');
        });

        it('la revision solo vale si describe esta cartera (misma fecha y posiciones) y declara algo fiable', () => {
            const live = { as_of_date: '2026-06-30', holdings_count: 45 };
            const partialPdf = { as_of_date: '2026-06-30', available_positions: 45, full_holdings_loaded: false, review_flags: ['CARTERA_PUBLICADA_PARCIAL'] };
            expect(coverageFromHoldingsReview(partialPdf, live)).toBe('PARTIAL');
            expect(coverageFromHoldingsReview({ as_of_date: '2026-06-30', available_positions: 45, full_holdings_loaded: true }, live)).toBe('COMPLETE');
            // otra cartera: otra fecha u otro recuento
            expect(coverageFromHoldingsReview({ ...partialPdf, as_of_date: '2026-05-31' }, live)).toBe('UNKNOWN');
            expect(coverageFromHoldingsReview({ ...partialPdf, available_positions: 44 }, live)).toBe('UNKNOWN');
            expect(coverageFromHoldingsReview({ ...partialPdf, available_positions: '45' }, live)).toBe('UNKNOWN');
            expect(coverageFromHoldingsReview(null, live)).toBe('UNKNOWN');
            // full_holdings_loaded false sin mas: no prueba nada
            expect(coverageFromHoldingsReview({ as_of_date: '2026-06-30', available_positions: 45, full_holdings_loaded: false }, live)).toBe('UNKNOWN');
            // fase 2 con top 10 (10 de 91 declaradas): parcial
            expect(coverageFromHoldingsReview({ as_of_date: '2026-06-30', available_positions: 10, reported_positions: 91, full_holdings_loaded: false, portfolio_suppression: '1' }, { as_of_date: '2026-06-30', holdings_count: 10 })).toBe('PARTIAL');
            // tablet-carteras: 105 frente a 82 o 402 frente a 403 no prueban nada
            const tablet = { as_of_date: '2026-07-31', full_holdings_loaded: false, review_flags: ['RECUENTO_POSICIONES_PENDIENTE', 'FECHAS_CARTERA_DISCREPANTES'] };
            expect(coverageFromHoldingsReview({ ...tablet, available_positions: 105, reported_positions: 82 }, { as_of_date: '2026-07-31', holdings_count: 105 })).toBe('UNKNOWN');
            expect(coverageFromHoldingsReview({ ...tablet, available_positions: 402, reported_positions: 403 }, { as_of_date: '2026-07-31', holdings_count: 402 })).toBe('UNKNOWN');
        });

        it('LU1254412460: un recuento declarado de otra fecha no hace parcial a la viva', async () => {
            // 37 filas del detalle del 31-07 que suman el 100 %; el 59 sale del resumen del 31-08
            const lu125 = {
                as_of_date: '2026-07-31', available_positions: 37, reported_positions: 59, full_holdings_loaded: false,
                net_weight_pct: 100.00004, detail_date: '2026-07-31', summary_date: '2026-08-31',
                review_flags: ['RECUENTO_POSICIONES_PENDIENTE', 'FECHAS_CARTERA_DISCREPANTES']
            };
            const live = { as_of_date: '2026-07-31', holdings_count: 37 };
            expect(coverageFromHoldingsReview(lu125, live)).toBe('UNKNOWN');
            // basta con una de las dos senales: la bandera o las fechas distintas
            expect(coverageFromHoldingsReview({ ...lu125, review_flags: ['RECUENTO_POSICIONES_PENDIENTE'] }, live)).toBe('UNKNOWN');
            expect(coverageFromHoldingsReview({ ...lu125, review_flags: ['FECHAS_CARTERA_DISCREPANTES'], summary_date: '2026-07-31' }, live)).toBe('UNKNOWN');
            // con resumen y detalle de la misma fecha y sin bandera, el recuento si cuenta
            expect(coverageFromHoldingsReview({ ...lu125, review_flags: ['RECUENTO_POSICIONES_PENDIENTE'], summary_date: '2026-07-31' }, live)).toBe('PARTIAL');

            const db = new HoldingsDbMock();
            seedLive(db, 'LU1254412460', 37, '2026-07-31');
            db.documents.set('assets/LU1254412460/fund_profile/latest', { holdings_review: lu125 });
            const plan = await planHoldingsRepublish(db as any, 'LU1254412460', holdingRecords('LU1254412460', 49, 0, '2026-06-30'), NOW);
            expect(plan.live_coverage).toBe('UNKNOWN');
            expect(plan.decision).toBe('KEEP_NEWER_LIVE');
        });

        it('declarada parcial, cede solo ante una de mas de 10 posiciones y mas que ella', () => {
            expect(decide([10, '2026-06-30'], [8, '2026-08-31', 'PARTIAL']).decision).toBe('KEEP_NEWER_LIVE');
            expect(decide([11, '2026-06-30'], [8, '2026-08-31', 'PARTIAL']).decision).toBe('REPLACE_COMPLETE_OLDER');
            expect(decide([15, '2026-06-30'], [20, '2026-08-31', 'PARTIAL']).decision).toBe('KEEP_NEWER_LIVE');
            // PARTIAL tambien necesita el 80 % en este sentido (simetria): 35 de 40 no cede, 30 de 40 si
            expect(decide([40, '2026-06-30'], [35, '2026-08-31', 'PARTIAL']).decision).toBe('KEEP_NEWER_LIVE');
            expect(decide([40, '2026-06-30'], [30, '2026-08-31', 'PARTIAL']).decision).toBe('REPLACE_COMPLETE_OLDER');
            // TOP_N no: 35 de 40 cede
            expect(decide([40, '2026-06-30'], [35, '2026-08-31', 'TOP_N']).decision).toBe('REPLACE_COMPLETE_OLDER');
        });

        it('limites de dias: 182 y 183 gana el canonico; 184 y 211 se conserva la viva', () => {
            const canonical = '2026-01-01';
            for (const days of [182, 183]) {
                expect(decide([100, canonical], [10, addDays(canonical, days), 'PARTIAL']).decision).toBe('REPLACE_COMPLETE_OLDER');
            }
            for (const days of [184, 211]) {
                const verdict = decide([100, canonical], [10, addDays(canonical, days), 'PARTIAL']);
                expect(verdict.decision).toBe('KEEP_NEWER_LIVE');
                expect(verdict.motive).toContain(`le saca ${days} dias (> 183)`);
            }
        });

        it('los dias son naturales (cambio de ano y bisiesto)', () => {
            // 2027-12-31 -> 2028-07-01: 183 dias, contando el 29-02-2028
            expect(decide([100, '2027-12-31'], [10, '2028-07-01', 'PARTIAL']).decision).toBe('REPLACE_COMPLETE_OLDER');
            expect(decide([100, '2027-12-31'], [10, '2028-07-02', 'PARTIAL']).decision).toBe('KEEP_NEWER_LIVE');
        });

        it('si la viva cambia entre el plan y la escritura, se para', async () => {
            const assetId = 'LU0000000303';
            const db = new HoldingsDbMock();
            seedLive(db, assetId, 10, '2026-08-31', { reviewFull: false });
            const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, 40, 0, '2026-06-30'), NOW);
            expect(plan.decision).toBe('REPLACE_COMPLETE_OLDER');
            seedOperations(db, buildHoldingsOperations(assetId, holdingRecords(assetId, 45, 0, '2026-09-30'), NOW));
            const before = clone([...db.documents.entries()]);

            await expect(executeHoldingsRepublish(db as any, plan)).rejects.toThrow('HOLDINGS_CONCURRENT_MODIFICATION');
            expect([...db.documents.entries()]).toEqual(before);
        });
    });

    describe('a) canonico mas reciente pero parcial: se conserva la viva mas completa', () => {
        it('por recuento, sin cobertura declarada: menos del 80 %; con el 80 % exacto gana el canonico', () => {
            expect(decide([7, '2026-08-31'], [10, '2026-06-30']).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
            expect(decide([79, '2026-08-31'], [100, '2026-06-30']).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
            expect(decide([8, '2026-08-31'], [10, '2026-06-30']).decision).toBe('REPLACE_NEWER');
            expect(decide([80, '2026-08-31'], [100, '2026-06-30']).decision).toBe('REPLACE_NEWER');
        });

        it('canonico declarado TOP_N o PARTIAL (la antigua KEEP_COMPLETE_OVER_PARTIAL, ya fundida)', () => {
            expect(decide([10, '2026-09-30', 'TOP_N'], [40, '2026-07-31']).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
            // TOP_N no necesita el 80 %: 35 de 40
            expect(decide([35, '2026-09-30', 'TOP_N'], [40, '2026-07-31']).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
            // PARTIAL sin posiciones declaradas, contra la viva: 30 de 40 (75 %) cede; 35 de 40 (87,5 %) no
            expect(decide([30, '2026-09-30', 'PARTIAL'], [40, '2026-07-31']).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
            expect(decide([35, '2026-09-30', 'PARTIAL'], [40, '2026-07-31']).decision).toBe('REPLACE_NEWER');
            // con posiciones declaradas, solo contra ellas
            expect(decide([35, '2026-09-30', 'PARTIAL', 50], [40, '2026-07-31']).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
            expect(decide([35, '2026-09-30', 'PARTIAL', 40], [40, '2026-07-31']).decision).toBe('REPLACE_NEWER');
            expect(decide([30, '2026-09-30', 'PARTIAL', 35], [40, '2026-07-31']).decision).toBe('REPLACE_NEWER');
            // la viva tiene que tener mas de 10 posiciones
            expect(decide([7, '2026-09-30', 'PARTIAL'], [10, '2026-07-31']).decision).toBe('REPLACE_NEWER');
        });

        it('IE00BYX5NX33: un canonico PARTIAL con 1.269 de 1.270 declaradas no cede ante la viva', async () => {
            const assetId = 'IE00BYX5NX33';
            const db = new HoldingsDbMock();
            // viva CHUNKED de 1.305 posiciones a 09-07, sin procedencia ni revision
            seedLive(db, assetId, 1305, '2026-07-09');
            const canonical = withProcedencia(holdingRecords(assetId, 1269, 0, '2026-10-13'), 'PARTIAL', 1270);
            const plan = await planHoldingsRepublish(db as any, assetId, canonical, NOW);
            expect(plan.expected_coverage).toBe('PARTIAL');
            expect(plan.live_coverage).toBe('UNKNOWN');
            expect(plan.decision).toBe('REPLACE_NEWER');
            expect(plan.motive).toContain('tiene al menos el 80 % de las posiciones de las 1270 que declara');
            // el mismo canonico con 1.269 de 2.000 declaradas si seria parcial y cederia
            expect(decide([1269, '2026-10-13', 'PARTIAL', 2000], [1305, '2026-07-09']).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
        });

        it('LU0208853944: con posiciones declaradas, el PARTIAL se mide solo contra ellas', async () => {
            // canonico de 121 de 123 declaradas (suma el 100 %), 92 dias mas nuevo que la viva de 152
            const assetId = 'LU0208853944';
            const db = new HoldingsDbMock();
            seedLive(db, assetId, 152, '2026-05-31');
            const plan = await planHoldingsRepublish(db as any, assetId, withProcedencia(holdingRecords(assetId, 121, 0, '2026-08-31'), 'PARTIAL', 123), NOW);
            expect(plan.decision).toBe('REPLACE_NEWER');
            expect(plan.motive).toContain('de las 123 que declara');
            // sin posiciones declaradas, 121 de 152 (79,6 %) si cederia
            expect(decide([121, '2026-08-31', 'PARTIAL'], [152, '2026-05-31']).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
        });

        it('canonico declarado COMPLETE: manda la fecha aunque traiga menos posiciones', () => {
            expect(decide([30, '2026-09-30', 'COMPLETE'], [40, '2026-07-31']).decision).toBe('REPLACE_NEWER');
            expect(decide([10, '2026-09-30', 'COMPLETE'], [40, '2026-07-31']).decision).toBe('REPLACE_NEWER');
        });

        it('una viva declarada parcial no se conserva frente a un canonico mas nuevo', () => {
            expect(decide([10, '2026-08-31'], [40, '2026-06-30', 'PARTIAL']).decision).toBe('REPLACE_NEWER');
            expect(decide([10, '2026-08-31', 'TOP_N'], [40, '2026-06-30', 'TOP_N']).decision).toBe('REPLACE_NEWER');
        });

        it('limites de dias: 182 y 183 se conserva la viva; 184 y 211 gana el canonico (tambien declarado TOP_N)', () => {
            const live = '2026-01-01';
            for (const days of [182, 183]) {
                expect(decide([10, addDays(live, days)], [100, live]).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
                expect(decide([10, addDays(live, days), 'TOP_N'], [100, live]).decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
            }
            for (const days of [184, 211]) {
                expect(decide([10, addDays(live, days)], [100, live]).decision).toBe('REPLACE_NEWER');
                // 211 dias son 6 meses de calendario (01-01 -> 31-07): la regla de meses ya no existe
                expect(decide([10, addDays(live, days), 'TOP_N'], [100, live]).decision).toBe('REPLACE_NEWER');
            }
        });

        it('en el republish la viva completa no se toca', async () => {
            const assetId = 'LU0000000304';
            const db = new HoldingsDbMock();
            const before = seedLive(db, assetId, 40, '2026-06-30');
            const plan = await planHoldingsRepublish(db as any, assetId, holdingRecords(assetId, 10, 0, '2026-08-31'), NOW);
            const result = await executeHoldingsRepublish(db as any, plan);
            expect(plan.decision).toBe('KEEP_COMPLETE_OLDER_LIVE');
            expect(plan.set_operations).toEqual([]);
            expect(result).toEqual({ sets_executed: 0, deletes_executed: 0, postverify_ok: true });
            expect([...db.documents.entries()]).toEqual(before);
        });

        it('la cobertura del canonico sale de su procedencia', async () => {
            const assetId = 'LU0000000305';
            const db = new HoldingsDbMock();
            seedLive(db, assetId, 40, '2026-07-31');
            const plan = await planHoldingsRepublish(db as any, assetId, withProcedencia(holdingRecords(assetId, 30, 0, '2026-09-30'), 'COMPLETE'), NOW);
            expect(plan.expected_coverage).toBe('COMPLETE');
            expect(plan.decision).toBe('REPLACE_NEWER');
        });
    });

    it('sin fecha no se compara nada: se conserva la viva y se avisa', () => {
        const liveUndated = decide([100, '2026-08-31'], [10, null, 'PARTIAL']);
        expect(liveUndated.decision).toBe('KEEP_UNDATED');
        expect(liveUndated.warning).toMatch(/^HOLDINGS_UNDATED: sin fecha valida en viva /);
        const canonicalUndated = decide([10, null, 'COMPLETE'], [100, '2026-08-31']);
        expect(canonicalUndated.decision).toBe('KEEP_UNDATED');
        expect(canonicalUndated.warning).toMatch(/^HOLDINGS_UNDATED: sin fecha valida en canonico /);
        expect(decide([100, '2026-08'], [10, '2026-08-31']).decision).toBe('KEEP_UNDATED');
    });

    it('con la misma fecha, COMPLETE declarado gana a TOP_N/PARTIAL declarados; si no, mas posiciones', () => {
        // un TOP_N de 12 no sustituye a un COMPLETE de 10, y al reves si
        expect(decide([12, '2026-08-31', 'TOP_N'], [10, '2026-08-31', 'COMPLETE']).decision).toBe('KEEP_MORE_COMPLETE');
        expect(decide([10, '2026-08-31', 'COMPLETE'], [12, '2026-08-31', 'TOP_N']).decision).toBe('REPLACE_MORE_COMPLETE');
        expect(decide([100, '2026-08-31', 'PARTIAL'], [10, '2026-08-31', 'COMPLETE']).decision).toBe('KEEP_MORE_COMPLETE');
        // sin declaracion enfrentada, manda el recuento
        expect(decide([10, '2026-08-31', 'COMPLETE'], [100, '2026-08-31']).decision).toBe('KEEP_MORE_COMPLETE');
        expect(decide([100, '2026-08-31', 'PARTIAL'], [10, '2026-08-31', 'TOP_N']).decision).toBe('REPLACE_MORE_COMPLETE');
        expect(decide([12, '2026-08-31', 'COMPLETE'], [10, '2026-08-31', 'COMPLETE']).decision).toBe('REPLACE_MORE_COMPLETE');
    });
});
