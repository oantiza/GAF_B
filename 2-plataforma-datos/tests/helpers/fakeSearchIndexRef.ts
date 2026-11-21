import * as admin from 'firebase-admin';
import { assertNoUndefinedFirestoreValue, cloneFirestoreValue } from './strictFirestoreValue';

/**
 * `meta/search_index` en memoria con la semantica de Firestore que usa searchIndexWrite.ts:
 * updateTime por version, update() con precondicion lastUpdateTime (FAILED_PRECONDITION, code 9),
 * create() que falla si existe (ALREADY_EXISTS, code 6) y FieldValue.delete().
 * `beforeWrite` deja simular a otro escritor justo antes de cada escritura.
 */
export class FakeSearchIndexRef {
    stored: Record<string, any> | null;
    version = 1;
    writes: Array<{ kind: 'update' | 'create'; payload: Record<string, unknown> }> = [];
    rejected = 0;
    beforeWrite: ((ref: FakeSearchIndexRef) => void) | null = null;

    constructor(initial: Record<string, any> | null) {
        this.stored = initial ? cloneFirestoreValue(initial) : null;
    }

    private updateTime(): admin.firestore.Timestamp {
        return admin.firestore.Timestamp.fromMillis(this.version * 1000);
    }

    /** Escritura de otro proceso: cambia el documento y su updateTime. */
    externalWrite(doc: Record<string, any>): void {
        this.stored = cloneFirestoreValue(doc);
        this.version++;
    }

    async get() {
        const stored = this.stored;
        return {
            exists: stored !== null,
            updateTime: stored !== null ? this.updateTime() : undefined,
            data: () => (stored !== null ? cloneFirestoreValue(stored) : undefined)
        };
    }

    async update(data: Record<string, unknown>, precondition: admin.firestore.Precondition) {
        this.beforeWrite?.(this);
        assertNoUndefinedFirestoreValue(data);
        if (this.stored === null) throw Object.assign(new Error('5 NOT_FOUND: no document to update'), { code: 5 });
        if (!precondition?.lastUpdateTime || !precondition.lastUpdateTime.isEqual(this.updateTime())) {
            this.rejected++;
            throw Object.assign(new Error('9 FAILED_PRECONDITION: the stored version does not match the required base version.'), { code: 9 });
        }
        const next: Record<string, any> = { ...this.stored };
        for (const [key, value] of Object.entries(data)) {
            if (key.includes('.')) throw new Error(`fake: update() con ruta '${key}' no soportado`);
            if (value instanceof admin.firestore.FieldValue && value.isEqual(admin.firestore.FieldValue.delete())) delete next[key];
            else next[key] = cloneFirestoreValue(value);
        }
        this.stored = next;
        this.version++;
        this.writes.push({ kind: 'update', payload: data });
    }

    async create(data: Record<string, unknown>) {
        this.beforeWrite?.(this);
        if (this.stored !== null) {
            this.rejected++;
            throw Object.assign(new Error('6 ALREADY_EXISTS: Document already exists'), { code: 6 });
        }
        this.stored = cloneFirestoreValue(data);
        this.version++;
        this.writes.push({ kind: 'create', payload: data });
    }

    async set(): Promise<never> {
        throw new Error('fake: meta/search_index no se escribe con set() sin precondicion (H06)');
    }
}
