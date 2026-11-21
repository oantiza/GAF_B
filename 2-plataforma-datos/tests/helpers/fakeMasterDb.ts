import * as admin from 'firebase-admin';
import { FakeSearchIndexRef } from './fakeSearchIndexRef';
import { assertNoUndefinedFirestoreValue, cloneFirestoreValue } from './strictFirestoreValue';

/**
 * Maestra en memoria para ejecutar el republish entero (runRepublish) sin Firestore: documentos por ruta
 * con updateTime por version, update() con precondicion lastUpdateTime y FieldValue.delete(), create(),
 * set(), getAll() y collection('assets').get() (la reconciliacion del indice). `meta/search_index` es un
 * FakeSearchIndexRef. Registra cada escritura para comprobar que no hubo ninguna que no tocaba.
 */
export class FakeMasterDb {
    readonly documents = new Map<string, { data: Record<string, any>; version: number }>();
    readonly searchIndex: FakeSearchIndexRef;
    readonly writes: Array<{ kind: 'update' | 'create' | 'set'; path: string }> = [];
    /** Simula que la lectura completa de `assets` falla (p. ej. la reconciliacion del indice). */
    failCollectionGet: string | null = null;
    /**
     * Fallos de update() por ruta: 'error' lanza (escritura fallida); 'silent' responde bien pero no aplica
     * los datos (el postverify lo detecta).
     */
    readonly failUpdates = new Map<string, 'error' | 'silent'>();

    constructor(searchIndex: Record<string, any> | null = null) {
        this.searchIndex = new FakeSearchIndexRef(searchIndex);
    }

    put(path: string, data: Record<string, any>): void {
        this.documents.set(path, { data: cloneFirestoreValue(data), version: 1 });
    }

    data(path: string): Record<string, any> | undefined {
        const stored = this.documents.get(path);
        return stored ? cloneFirestoreValue(stored.data) : undefined;
    }

    doc(path: string): any {
        if (path === 'meta/search_index') return this.searchIndex;
        const self = this;
        const updateTime = (version: number) => admin.firestore.Timestamp.fromMillis(version * 1000);
        return {
            path,
            id: path.split('/').pop(),
            async get() {
                const stored = self.documents.get(path);
                return {
                    id: path.split('/').pop(),
                    exists: stored !== undefined,
                    updateTime: stored ? updateTime(stored.version) : undefined,
                    data: () => (stored ? cloneFirestoreValue(stored.data) : undefined)
                };
            },
            async update(data: Record<string, unknown>, precondition?: admin.firestore.Precondition) {
                const stored = self.documents.get(path);
                if (!stored) throw Object.assign(new Error(`5 NOT_FOUND: ${path}`), { code: 5 });
                if (precondition?.lastUpdateTime && !precondition.lastUpdateTime.isEqual(updateTime(stored.version))) {
                    throw Object.assign(new Error('9 FAILED_PRECONDITION'), { code: 9 });
                }
                const failure = self.failUpdates.get(path);
                if (failure === 'error') throw Object.assign(new Error(`14 UNAVAILABLE: ${path}`), { code: 14 });
                if (failure === 'silent') {
                    self.documents.set(path, { data: stored.data, version: stored.version + 1 });
                    self.writes.push({ kind: 'update', path });
                    return;
                }
                const next: Record<string, any> = { ...stored.data };
                for (const [key, value] of Object.entries(data)) {
                    if (value instanceof admin.firestore.FieldValue && value.isEqual(admin.firestore.FieldValue.delete())) delete next[key];
                    else {
                        assertNoUndefinedFirestoreValue(value, `${path}.${key}`);
                        next[key] = cloneFirestoreValue(value);
                    }
                }
                self.documents.set(path, { data: next, version: stored.version + 1 });
                self.writes.push({ kind: 'update', path });
            },
            async create(data: Record<string, unknown>) {
                if (self.documents.has(path)) throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 });
                self.documents.set(path, { data: cloneFirestoreValue(data), version: 1 });
                self.writes.push({ kind: 'create', path });
            },
            async set(data: Record<string, unknown>) {
                // ingestion_runs lleva serverTimestamp(): se guarda sin clonar.
                const previous = self.documents.get(path);
                self.documents.set(path, { data: { ...data }, version: (previous?.version || 0) + 1 });
                self.writes.push({ kind: 'set', path });
            }
        };
    }

    async getAll(...refs: Array<{ get: () => Promise<unknown> }>) {
        return Promise.all(refs.map((ref) => ref.get()));
    }

    /** Coleccion por ruta (`assets` o una subcoleccion como `assets/X/holdings/manifest/chunks`). */
    collection(name: string) {
        const depth = name.split('/').length + 1;
        return {
            get: async () => {
                if (this.failCollectionGet) throw new Error(this.failCollectionGet);
                const docs = [...this.documents.entries()]
                    .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === depth)
                    .map(([path, stored]) => ({ id: path.split('/').pop()!, ref: { path }, data: () => cloneFirestoreValue(stored.data) }));
                return { docs, size: docs.length };
            }
        };
    }
}
