import { describe, expect, it } from 'vitest';
import { validators } from '../contracts/validators';
import { buildHoldingsOperations, createOperationsAtomically, executePlan } from '../src/loader/writer';
import { buildSearchIndexDocument, foldForSearch, mergeSearchIndexDocument } from '../src/loader/searchIndex';
import { assertNoUndefinedFirestoreValue, cloneFirestoreValue } from './helpers/strictFirestoreValue';
import { FakeSearchIndexRef } from './helpers/fakeSearchIndexRef';

describe('loader search index and chunked holdings', () => {
    it('crea los documentos ausentes de un activo en un unico commit', async () => {
        const documents = new Map<string, Record<string, unknown>>([
            ['assets/A', { existing: true }]
        ]);
        const db = {
            doc: (path: string) => ({ path }),
            getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => ({ exists: documents.has(ref.path) })),
            batch: () => {
                const pending: Array<{ path: string; payload: Record<string, unknown> }> = [];
                return {
                    create: (ref: { path: string }, payload: Record<string, unknown>) => pending.push({ path: ref.path, payload }),
                    commit: async () => pending.forEach((item) => documents.set(item.path, item.payload))
                };
            }
        };

        const result = await createOperationsAtomically(db as any, [
            { path: 'assets/A', kind: 'root', asset_id: 'A', payload: { root: true } },
            { path: 'assets/A/metrics/latest', kind: 'metrics', asset_id: 'A', payload: { metrics: true } }
        ]);

        expect(result).toEqual({ created: 1, existing: 1 });
        expect(documents.get('assets/A/metrics/latest')).toEqual({ metrics: true });
    });

    it('no deja documentos parciales si falla el commit atomico', async () => {
        const documents = new Map<string, Record<string, unknown>>();
        const db = {
            doc: (path: string) => ({ path }),
            getAll: async (...refs: Array<{ path: string }>) => refs.map(() => ({ exists: false })),
            batch: () => ({
                create: () => undefined,
                commit: async () => { throw new Error('simulated batch failure'); }
            })
        };

        await expect(createOperationsAtomically(db as any, [
            { path: 'assets/A', kind: 'root', asset_id: 'A', payload: { root: true } },
            { path: 'assets/A/metrics/latest', kind: 'metrics', asset_id: 'A', payload: { metrics: true } }
        ])).rejects.toThrow('simulated batch failure');
        expect(documents.size).toBe(0);
    });

    it('normaliza nombres sin tildes para meta/search_index', () => {
        const doc = buildSearchIndexDocument(
            {
                rawFunds: [],
                rawByIsin: new Map(),
                universalByIsin: new Map(),
                holdingsByFundIsin: new Map(),
                problematicByIsin: new Map(),
                qualityByIsin: new Map(),
                duplicateIsins: new Set(),
                canonicalValidationIssues: []
            },
            new Map([
                ['ES0000000001', {
                    status: 'READY',
                    root: {
                        asset_type: 'STOCK',
                        identity: { name: 'Acción Ñandú Global', currency: 'EUR' },
                        identifiers: { ticker: 'NDU' },
                        classification: { asset_class: 'EQUITY' }
                    }
                }]
            ]),
            '2026-07-02T10:00:00.000Z'
        );

        expect(doc.count).toBe(1);
        expect(doc.entries[0].name_folded).toBe('accion nandu global');
        expect(foldForSearch('ÁÉÍÓÚ ü')).toBe('aeiou u');
        expect(validators.masterSearchIndex(doc).ok).toBe(true);
    });

    it('preserva durante load --write una entrada ajena al paquete', async () => {
        const existing = {
            schema_version: 'master.search-index.v1',
            updated_at: '2026-07-01T00:00:00.000Z',
            count: 1,
            entries: [{
                id: 'US0000000002',
                name: 'Activo incorporado desde la app',
                name_folded: 'activo incorporado desde la app',
                type: 'FUND'
            }]
        };
        const searchIndexRef = new FakeSearchIndexRef(existing);
        const db = {
            doc: (path: string) => path === 'meta/search_index'
                ? searchIndexRef
                : {
                    set: async (payload: unknown) => assertNoUndefinedFirestoreValue(payload),
                    create: async (payload: unknown) => assertNoUndefinedFirestoreValue(payload),
                    update: async (payload: unknown) => assertNoUndefinedFirestoreValue(payload),
                    get: async () => ({ exists: false })
                },
            collection: (path: string) => ({
                get: async () => {
                    if (path === 'assets') {
                        return {
                            docs: [
                                {
                                    id: 'US0000000002',
                                    data: () => ({ asset_type: 'FUND', identity: { name: 'Activo incorporado desde la app' } })
                                },
                                {
                                    id: 'ES0000000001',
                                    data: () => ({ asset_type: 'STOCK', identity: { name: 'Nueva entrada', currency: 'EUR' }, identifiers: { ticker: 'NUEVA' }, classification: { asset_class: 'EQUITY' } })
                                }
                            ],
                            size: 2
                        };
                    }
                    return { docs: [], size: 0 };
                }
            })
        };
        const pkg = {
            rawFunds: [],
            rawByIsin: new Map(),
            universalByIsin: new Map(),
            holdingsByFundIsin: new Map(),
            problematicByIsin: new Map(),
            qualityByIsin: new Map(),
            duplicateIsins: new Set(),
            canonicalValidationIssues: []
        } as any;
        const plan = {
            run_id: 'search-index-upsert-test',
            created_at: '2026-07-10T00:00:00.000Z',
            write: true,
            selection_mode: 'all',
            package_summary: {
                canonical_funds: 0,
                universal_funds: 0,
                funds_with_holdings: 0,
                duplicate_isins: 0
            },
            selection_count: 0,
            counts: {
                CREATE: 0,
                SKIP_EXISTS: 0,
                REVIEW_HOLD: 0,
                BLOCKED_REJECTED: 0,
                REEXPORT_REQUIRED: 0,
                INVALID_CONTRACT: 0
            },
            items: [],
            safety: { writes_executed: 0, deletes_executed: 0, dry_run: false }
        };
        const incomingRows = new Map([['ES0000000001', {
            status: 'READY',
            root: {
                asset_type: 'STOCK',
                identity: { name: 'Nueva entrada', currency: 'EUR' },
                identifiers: { ticker: 'NUEVA' },
                classification: { asset_class: 'EQUITY' }
            }
        }]]);

        const result = await executePlan(
            pkg,
            plan as any,
            { root: false, holdings: false },
            {
                FIREBASE_PROJECT_ID: 'gestor-activos-local',
                BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES'
            },
            incomingRows,
            db as any
        );

        expect(result.errors).toEqual([]);
        const stored = searchIndexRef.stored!;
        expect(stored.entries.map((entry: any) => entry.id)).toEqual(['ES0000000001', 'US0000000002']);
        // sin set(): solo escribe la reconciliacion, con precondicion (H06, ALTA-18)
        expect(searchIndexRef.writes.map((write) => write.kind)).toEqual(['update']);
        expect(stored.count).toBe(2);
        expect(validators.masterSearchIndex(stored).ok).toBe(true);
    });

    it('load --write: el indice solo lo escribe la reconciliacion; una accion NOT_READY que no existe viva nunca llega (ALTA-18)', async () => {
        const run = async (failAssets: boolean) => {
            const searchIndexRef = new FakeSearchIndexRef({
                schema_version: 'master.search-index.v1',
                updated_at: '2026-07-01T00:00:00.000Z',
                count: 1,
                entries: [{ id: 'US0000000002', name: 'Activo vivo', name_folded: 'activo vivo', type: 'FUND' }]
            });
            const db = {
                doc: (path: string) => path === 'meta/search_index'
                    ? searchIndexRef
                    : { set: async () => undefined, get: async () => ({ exists: false }) },
                collection: () => ({
                    get: async () => {
                        if (failAssets) throw new Error('assets no disponible');
                        return {
                            docs: [{ id: 'US0000000002', data: () => ({ asset_type: 'FUND', identity: { name: 'Activo vivo renombrado' } }) }],
                            size: 1
                        };
                    }
                })
            };
            const pkg = {
                rawFunds: [], rawByIsin: new Map(), universalByIsin: new Map(), holdingsByFundIsin: new Map(),
                problematicByIsin: new Map(), qualityByIsin: new Map(), duplicateIsins: new Set(), canonicalValidationIssues: []
            } as any;
            const plan = {
                run_id: 'search-index-alta-18', created_at: '2026-10-16T00:00:00.000Z', write: true, selection_mode: 'all',
                package_summary: { canonical_funds: 0, universal_funds: 0, funds_with_holdings: 0, duplicate_isins: 0 },
                selection_count: 1,
                counts: { CREATE: 0, SKIP_EXISTS: 0, REVIEW_HOLD: 0, BLOCKED_REJECTED: 1, REEXPORT_REQUIRED: 0, INVALID_CONTRACT: 0 },
                items: [],
                safety: { writes_executed: 0, deletes_executed: 0, dry_run: false }
            };
            // En la poblacion stock (como en cli.ts, con las excluidas), pero NOT_READY y sin raiz en la maestra.
            const notReady = new Map([['ES0000000003', {
                status: 'NOT_READY',
                status_reasons: ['FONDOSDB_BLOCKED'],
                root: { asset_type: 'STOCK', identity: { name: 'Accion bloqueada', currency: 'EUR' }, identifiers: { ticker: 'BLQ' } }
            }]]);
            const summary = await executePlan(pkg, plan as any, { root: true, holdings: false }, {
                FIREBASE_PROJECT_ID: 'gestor-activos-local',
                BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES: 'YES_I_UNDERSTAND_MASTER_DB_WRITES'
            }, notReady, db as any);
            return { summary, searchIndexRef };
        };

        const ok = await run(false);
        expect(ok.summary.errors).toEqual([]);
        expect(ok.searchIndexRef.writes).toHaveLength(1);
        for (const write of ok.searchIndexRef.writes) {
            expect((write.payload.entries as Array<{ id: string }>).map((entry) => entry.id)).not.toContain('ES0000000003');
        }
        expect(ok.searchIndexRef.stored!.entries).toEqual([
            { id: 'US0000000002', name: 'Activo vivo renombrado', name_folded: 'activo vivo renombrado', type: 'FUND' }
        ]);
        expect(ok.summary.writes_executed).toBe(1);

        // Si la reconciliacion falla no se ha escrito antes un indice sin filtrar: el vivo queda como estaba.
        const failed = await run(true);
        expect(failed.searchIndexRef.writes).toEqual([]);
        expect(failed.summary.errors).toEqual([{ path: 'meta/search_index', error: 'reconciliation: assets no disponible' }]);
    });

    it('actualiza por id sin duplicar y conserva el resto', () => {
        const incoming = {
            schema_version: 'master.search-index.v1',
            updated_at: '2026-07-10T00:00:00.000Z',
            count: 1,
            entries: [{ id: 'A', name: 'Nuevo', name_folded: 'nuevo', type: 'FUND' }]
        };
        const merged = mergeSearchIndexDocument({
            entries: [
                { id: 'A', name: 'Antiguo', name_folded: 'antiguo', type: 'FUND' },
                { id: 'B', name: 'Ajeno', name_folded: 'ajeno', type: 'ETF' }
            ]
        }, incoming);

        expect(merged.entries).toEqual([
            { id: 'A', name: 'Nuevo', name_folded: 'nuevo', type: 'FUND' },
            { id: 'B', name: 'Ajeno', name_folded: 'ajeno', type: 'ETF' }
        ]);
    });

    it('trocea holdings grandes en manifest CHUNKED y chunks validos', () => {
        const holdings = Array.from({ length: 2500 }).map((_, index) => ({
            asset_id: 'LU0000000001',
            source_fund_isin: 'LU0000000001',
            holding_id: `LU0000000001:H${index}:1`,
            as_of_date: '2026-06-30',
            name: `Holding ${index} ${'x'.repeat(280)}`,
            identifiers: { isin: null, ticker: `T${index}` },
            holding_type: 'equity',
            weight_pct: 0.04,
            currency: 'EUR',
            sector: 'Technology',
            country: 'ES',
            source_metadata: { source: 'FondosDB', file: 'export/posiciones.ndjson' }
        }));

        const ops = buildHoldingsOperations('LU0000000001', holdings as any, '2026-07-02T10:00:00.000Z');

        expect(ops[0].path).toBe('assets/LU0000000001/holdings/manifest');
        expect(ops[0].payload.storage_mode).toBe('CHUNKED');
        expect(ops[0].payload.holdings_count).toBe(2500);
        expect(ops.length).toBeGreaterThan(2);
        expect(validators.masterHoldingsV11(ops[0].payload).ok).toBe(true);

        const chunks = ops.slice(1);
        expect(chunks[0].path).toBe('assets/LU0000000001/holdings/manifest/chunks/chunk_0000');
        expect(chunks.every((op) => validators.masterHoldingsV11(op.payload).ok)).toBe(true);
        expect(chunks.reduce((acc, op) => acc + Number(op.payload.holdings_count || 0), 0)).toBe(2500);
    });
});
